/**
 * Cook's Assistant — replayable, checkpoint-gated.
 *
 *   bun bots/quests/cooks-assistant.ts qlcook2
 *
 * Banks at Draynor (Lumbridge has no bank in this revision), withdraws the
 * three ingredients, walks to the Cook in Lumbridge Castle, runs the dialog and
 * hands them over.
 *
 * Every step that matters is gated on QUEST JOURNAL evidence, never on XP, chat
 * or a successful packet. The journal is the only client-visible record of
 * quest state: general quest varps are not exposed and most are never
 * transmitted (`cookquest` is not), so it is the portable checkpoint channel.
 *
 * Route and door handling:
 *   - waypoints computed offline from the repo's collision data
 *     (`findLongPath`), 15 waypoints, single plane, ~54 tiles
 *   - each leg is walked one waypoint at a time with displacement verified;
 *     a leg that moves nothing is an obstacle, not something to retry
 *   - `bot.walkTo`/`talkTo` open blocking doors, which is why the two castle
 *     kitchen doors (3213,3220) and (3207,3217) need no explicit handling
 */
import { existsSync, readFileSync, appendFileSync } from 'fs';
import { dirname, join } from 'path';

import { BotSDK, deriveGatewayUrl } from '../../sdk/index';
import { BotActions } from '../../sdk/actions';
import { initPathfinding, findLongPath, isTileWalkable } from '../../sdk/pathfinding';
import { ActivitySession } from '../../sdk/activity';
import { readJournalCheckpoint } from '../../quest-lab/journal-reader';
import { createRun, appendCheckpoint, summarizeRun, safeRunId } from '../../quest-lab/records';
import type { JournalRule } from '../../quest-lab/evidence';

// ── args / env ──────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const botArg = argv.find(a => !a.startsWith('-'));
const envPath = botArg
    ? join(process.cwd(), 'bots', botArg, 'bot.env')
    : join(dirname(import.meta.path), 'bot.env');
if (!existsSync(envPath)) throw new Error(`bot.env not found at ${envPath}. Usage: bun bots/quests/cooks-assistant.ts <botname>`);
for (const line of readFileSync(envPath, 'utf-8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq > 0) process.env[t.slice(0, eq)] = t.slice(eq + 1);
}
const username = process.env.BOT_USERNAME!;
const password = process.env.PASSWORD!;
const GRIND_LOG = join(process.cwd(), 'bots', username, 'grind.log');
const log = (msg: string) => {
    console.log(msg);
    try { appendFileSync(GRIND_LOG, `${new Date().toISOString()} ${msg}\n`); } catch { /* ignore */ }
};

// ── constants ───────────────────────────────────────────────────────────────
const DRAYNOR_BANK = { x: 3092, z: 3243 };
const COOK = { x: 3209, z: 3215 };

/**
 * Route waypoints are COMPUTED AT RUNTIME from the repo's collision data rather
 * than hardcoded. A hardcoded list only works from one start tile, and a bot
 * restarted mid-quest (or moved by a previous leg) would have to be repositioned
 * by hand. Planning from the live position removes that whole class of problem,
 * and collision data is a local file, so it costs nothing at runtime.
 */
const WAYPOINT_SPACING = 10;

function planWaypoints(from: { x: number; z: number }, to: { x: number; z: number }): { x: number; z: number }[] {
    const raw = findLongPath(0, from.x, from.z, to.x, to.z);
    if (raw.length === 0) return [to];
    const way: { x: number; z: number }[] = [{ x: raw[0]!.x, z: raw[0]!.z }];
    let last = raw[0]!;
    for (let i = 1; i < raw.length; i++) {
        const p = raw[i]!;
        if (Math.hypot(p.x - last.x, p.z - last.z) >= WAYPOINT_SPACING || i === raw.length - 1) {
            way.push({ x: p.x, z: p.z });
            last = p;
        }
    }
    return way;
}

/** Somewhere beside the Cook that can actually be stood on. */
function cookApproach(): { x: number; z: number } {
    for (const cand of [{ x: 3209, z: 3216 }, { x: 3208, z: 3216 }, { x: 3210, z: 3215 }, { x: 3209, z: 3214 }]) {
        if (isTileWalkable(0, cand.x, cand.z)) return cand;
    }
    return { x: 3209, z: 3216 };
}

const NEEDED = [
    { name: 'egg', pattern: /^egg$/i, id: 1944 },
    { name: 'bucket_milk', pattern: /^bucket of milk$/i, id: 1927 },
    { name: 'pot_flour', pattern: /^pot of flour$/i, id: 1933 },
];

const JOURNAL = { label: "Cook's Assistant", title: "The Cook's Quest" };

// Journal rules, read from the quest's own journal script
// (server/content/scripts/quests/quest_cook/scripts/cook_journal.rs2):
//   state 0 -> "I can start this quest by speaking to the Cook ..."
//   state 1 -> "... I need to bring him the following ingredients"
//   complete -> "... QUEST COMPLETE!"
const RULES: Record<string, JournalRule> = {
    unstarted: { id: 'cook:unstarted', kind: 'unstarted', all: ['I can start this quest by speaking to the Cook'] },
    active: { id: 'cook:active', kind: 'active', all: ['bring him the following ingredients'] },
    complete: { id: 'cook:complete', kind: 'complete', all: ['QUEST COMPLETE'] },
};

// ── setup ───────────────────────────────────────────────────────────────────
console.log('Warming pathfinder...');
initPathfinding();

const sdk = new BotSDK({
    botUsername: username,
    password,
    gatewayUrl: deriveGatewayUrl(process.env.SERVER),
    autoLaunchBrowser: true,
    browserLaunchTimeout: 90_000,
    readyTimeout: 45_000,
    connectTimeout: 60_000,
    showChat: false,
});

console.log('Opening/attaching the game client...');
await sdk.connect();
const bot = new BotActions(sdk);

// ActivitySession needs the live sdk + bot, so it is built here, not up front.
const session = new ActivitySession(sdk, bot, {
    name: "cook's assistant",
    grindLogPath: GRIND_LOG,
    maxRecoveryTactics: 8,
});

await session.setPhase('start');

const pos = () => {
    const p = sdk.getState()?.player;
    return { x: p?.worldX ?? 0, z: p?.worldZ ?? 0, level: p?.level ?? 0 };
};
const distTo = (t: { x: number; z: number }) => Math.hypot(pos().x - t.x, pos().z - t.z);
const invCount = (pattern: RegExp) =>
    sdk.getInventory().filter(i => pattern.test(i.name)).reduce((n, i) => n + (i.count ?? 1), 0);

// ── durable run record ──────────────────────────────────────────────────────
// Checkpoint evidence is written verbatim as the run proceeds, so an audit does
// not depend on the script's own stdout or on telemetry that sampling truncates.
const MODE = process.env.QUEST_LAB_MODE === 'staging' ? 'staging' : 'development';
const run = createRun(join(process.cwd(), 'quest-lab', 'runs'), safeRunId('cook', username, new Date().toISOString()), {
    questId: 'cook',
    account: username,
    mode: MODE,
    scriptHash: Bun.hash(await Bun.file(import.meta.path).text()).toString(16),
    fixtureHash: process.env.QUEST_LAB_FIXTURE_HASH ?? 'unrecorded',
    contentHash: process.env.QUEST_LAB_CONTENT_HASH ?? 'unrecorded',
    requiredCheckpoints: ['unstarted', 'active', 'complete'],
});
log(`Run record: ${run.directory} (mode=${MODE})`);

/** Checkpoint gate. UNKNOWN is a failure like any other here: proceed on nothing. */
async function checkpoint(name: keyof typeof RULES, label: string): Promise<boolean> {
    const read = await readJournalCheckpoint(sdk, JOURNAL, RULES[name]!);
    const verdict = read.verdict?.verdict ?? 'UNKNOWN';
    appendCheckpoint(run.directory, {
        checkpointId: name,
        verdict,
        reason: read.reason,
        kind: RULES[name]!.kind,
        rawLines: read.rawLines,
    });
    if (verdict !== 'PASS') {
        log(`CHECKPOINT ${name} ${verdict}: ${read.reason}`);
        if (read.rawLines.length) {
            for (const line of read.rawLines) log(`    raw: ${JSON.stringify(line.rawText)}`);
        }
        session.log('warn', `checkpoint ${name} ${verdict}`);
        return false;
    }
    log(`CHECKPOINT ${name} PASS (${label}) — ${read.reason}`);
    session.log('log', `checkpoint ${name} PASS: ${label}`);
    return true;
}

// ── 1. bank ─────────────────────────────────────────────────────────────────
await session.setPhase('bank');
await bot.dismissBlockingUI();

// A bot may be anywhere on restart (mid-quest, or left by an earlier leg), so
// travel to the bank first rather than assuming the start tile.
if (distTo(DRAYNOR_BANK) > 8) await travelTo(DRAYNOR_BANK, 'Draynor bank');

const junk = sdk.getInventory().filter(i => (i.count ?? 0) > 0);
if (junk.length > 0) {
    log(`Depositing ${junk.length} carried stack(s) before withdrawing`);
    if (!(await bot.openBank()).success) throw new Error(`could not open bank at ${pos().x},${pos().z}`);
    for (const item of junk) await bot.depositItem(item, -1);
    session.noteProgress('bank', 'deposited carry-over inventory');
}

// Pre-check stock before the first withdraw: an empty bank must idle cleanly,
// not throw mid-run.
await bot.closeInterface();
if (!(await bot.openBank()).success) {
    // Booths can fail to open from a tile, and contents read empty right after
    // open: close, step to the booth, retry once before declaring failure.
    await bot.closeInterface();
    await bot.walkTo(DRAYNOR_BANK.x - 1, DRAYNOR_BANK.z, 1);
    if (!(await bot.openBank()).success) throw new Error('could not open Draynor bank for withdrawal');
}
await sdk.waitForTicks(2);

const bankItems = sdk.getState()?.bank?.items ?? [];
const have = (re: RegExp) => bankItems.filter(i => re.test(i.name)).reduce((n, i) => n + (i.count ?? 0), 0);
const shortfall = NEEDED.filter(n => invCount(n.pattern) + have(n.pattern) < 1);
if (shortfall.length) {
    const detail = shortfall.map(n => `${n.name}(inv=${invCount(n.pattern)} bank=${have(n.pattern)} need=1)`).join(' ');
    log(`INSUFFICIENT STOCK: ${detail} — idling instead of crash-looping`);
    session.log('warn', `insufficient stock: ${detail}`);
    await process.exit(0);
}

for (const need of NEEDED) {
    if (invCount(need.pattern) > 0) continue;
    // The interface can drop between the open check and the withdraw.
    if (!sdk.getState()?.bank?.isOpen && !(await bot.openBank()).success) {
        throw new Error(`bank closed before withdrawing ${need.name}`);
    }
    const res = await bot.withdrawItem(need.pattern, 1);
    log(`withdrew ${need.name}: ${res.success}${res.success ? '' : ` (${res.message ?? '?'})`}`);
    if (!res.success) throw new Error(`could not withdraw ${need.name}`);
}
await bot.closeInterface();
log(`Bag: ${NEEDED.map(n => `${n.name}x${invCount(n.pattern)}`).join(' ')}`);

// ── travel ──────────────────────────────────────────────────────────────────
/**
 * Walk to a destination via planned waypoints. Each leg is verified: a leg that
 * moves nothing is an obstacle, and retrying the same bearing cannot help.
 */
async function travelTo(dest: { x: number; z: number }, what: string): Promise<void> {
    const waypoints = planWaypoints(pos(), dest);
    log(`Route to ${what}: ${waypoints.length} waypoint(s) from (${pos().x},${pos().z}) to (${dest.x},${dest.z})`);
    for (let i = 0; i < waypoints.length; i++) {
        const wp = waypoints[i]!;
        const before = pos();
        if (Math.hypot(before.x - wp.x, before.z - wp.z) <= 3) continue;

        let moved = false;
        for (let attempt = 0; attempt < 3 && !moved; attempt++) {
            const res = await bot.walkTo(wp.x, wp.z, 3);
            await sdk.waitForTicks(2);
            const after = pos();
            const step = Math.hypot(after.x - before.x, after.z - before.z);
            moved = step >= 1 || Math.hypot(after.x - wp.x, after.z - wp.z) <= 3;
            log(`leg ${i + 1}/${waypoints.length} -> (${wp.x},${wp.z}) moved=${step.toFixed(1)} at (${after.x},${after.z}) l${after.level} ok=${res.success}`);
        }
        if (!moved) {
            const now = pos();
            throw new Error(`BLOCKED leg ${i + 1} to ${what}: no progress at (${now.x},${now.z}) l${now.level}, ${Math.round(distTo(wp))} tiles short of (${wp.x},${wp.z})`);
        }
    }
    const at = pos();
    if (distTo(dest) > 6) throw new Error(`did not reach ${what}: at (${at.x},${at.z}) l${at.level}, ${Math.round(distTo(dest))} tiles short`);
    log(`Arrived ${what} at (${at.x},${at.z}) l${at.level}`);
}

// ── 3. pre-flight checkpoint: the quest must still be unstarted ─────────────
if (!(await checkpoint('unstarted', 'quest not yet started'))) {
    throw new Error('unstarted checkpoint failed before starting the quest');
}

// ── travel to the Cook (route planned from wherever we are) ─────────────────
await session.setPhase('travel');
await travelTo(cookApproach(), 'the Cook');

// ── 4. start the quest ──────────────────────────────────────────────────────
await session.setPhase('start-quest');
const talked = await bot.talkTo(/^cook$/i);
if (!talked.success) throw new Error(`could not talk to the Cook: ${talked.message ?? '?'}`);

for (let i = 0; i < 30; i++) {
    const dialog = sdk.getDialog();
    if (!dialog?.isOpen) {
        await sdk.waitForTicks(1);
        if (!sdk.getDialog()?.isOpen && i > 2) break;
        continue;
    }
    const options = dialog.options ?? [];
    const pick = options.find(o => /yes, i'?ll help you/i.test(o.text))
        ?? options.find(o => /what'?s wrong/i.test(o.text))
        ?? options[0];
    if (pick) {
        log(`dialog -> ${pick.text}`);
        await sdk.sendClickDialog(pick.index);
    }
    await sdk.waitForTicks(2);
}
await bot.dismissBlockingUI();

if (!(await checkpoint('active', 'accepted the quest, ingredients requested'))) {
    throw new Error('active checkpoint failed after accepting the quest');
}

// ── 5. hand in ──────────────────────────────────────────────────────────────
await session.setPhase('hand-in');
const again = await bot.talkTo(/^cook$/i);
if (!again.success) throw new Error(`could not talk to the Cook to hand in: ${again.message ?? '?'}`);
for (let i = 0; i < 30; i++) {
    const dialog = sdk.getDialog();
    if (!dialog?.isOpen) {
        await sdk.waitForTicks(1);
        if (!sdk.getDialog()?.isOpen && i > 2) break;
        continue;
    }
    const options = dialog.options ?? [];
    const pick = options.find(o => /i now have everything|milk, flour, and an egg/i.test(o.text)) ?? options[0];
    if (pick) log(`dialog -> ${pick.text}`);
    if (pick) await sdk.sendClickDialog(pick.index);
    await sdk.waitForTicks(2);
}
await bot.dismissBlockingUI();

// ── 6. completion is proven by the journal, never by XP or a chat line ──────
await session.setPhase('verify');
if (!(await checkpoint('complete', 'journal reports QUEST COMPLETE'))) {
    throw new Error('completion checkpoint failed: journal does not report the quest complete');
}

session.log('log', "Cook's Assistant verified complete");
session.noteProgress('inventory', 'quest complete (journal-verified)');
const summary = summarizeRun(run.directory);
if (!summary.ok) {
    // Every declared checkpoint must carry a PASS before this counts as done.
    throw new Error(`promotion gate failed: missing/unpassed ${JSON.stringify(summary.missing)}`);
}
log(`Run record verified: ${summary.ok} (${summary.missing.length} outstanding)`);
log(`DONE Cook's Assistant verified via journal at (${pos().x},${pos().z})`);
log(`Metrics: ${JSON.stringify(session.metrics())}`);

sdk.disconnect();
process.exit(0);
