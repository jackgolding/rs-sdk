/**
 * Prince Ali Rescue — replayable, checkpoint-gated.
 *
 *   bun bots/quests/prince-ali-rescue.ts qlprince2
 *
 * State machine (server/content/scripts/quests/quest_prince/...):
 *   bank (Al-Kharid 3269,3167) -> Hassan (3302,3163, start) -> Osman
 *   (3286,3180) -> Leela checklist (3113,3263: key copy / rope / skin paste /
 *   pink skirt / wig) -> Guard Joe (3123,3245, beer) -> Lady Keli (3128,3244,
 *   tie with rope) -> Prince Ali (3123,3242, disguise + free) -> Hassan
 *   (return) -> journal complete.
 *
 * Label note (verified, not assumed): the quest LIST label is
 * `Prince Ali Rescue` (questlist.if option=, key `prince`) while the journal
 * HEADING is `The Rescue Of Prince Ali` (prince_journal.rs2 L97:
 * `~quest_journal("The Rescue Of Prince Ali", $text)`). The journal reader
 * needs `{ label: 'Prince Ali Rescue', title: 'The Rescue Of Prince Ali' }` —
 * a wrong label finds no button and fails every rule as 'unknown'.
 *
 * Every step that matters is gated on QUEST JOURNAL evidence, never on XP,
 * chat or a successful packet. The journal is the only client-visible record
 * of quest state: general quest varps are not exposed and most are never
 * transmitted, so it is the portable checkpoint channel. Completion is
 * `%princequest = ^prince_complete` (110, quests.rs2); the journal renders it
 * as QUEST COMPLETE. No prerequisites.
 *
 * Key copy: the duplicate cell key (princeskey) is made via Oskarl from a
 * bronze bar + key print — so the bank leg carries a bronze bar; the
 * checklist stage still verifies the copy in the journal/inventory.
 * Wig: blondwig is dyed from plainwig + yellowdye (quest_prince.rs2
 * make_blonde_wig); the bank leg accepts either.
 *
 * Route handling:
 *   - waypoints computed offline from the repo's collision data
 *     (`findLongPath`), single plane per leg
 *   - each leg is walked one waypoint at a time with displacement verified;
 *     a leg that moves nothing is an obstacle, not something to retry
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
if (!existsSync(envPath)) throw new Error(`bot.env not found at ${envPath}. Usage: bun bots/quests/prince-ali-rescue.ts <botname>`);
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
const ALKHARID_BANK = { x: 3269, z: 3167 };
const HASSAN = { x: 3302, z: 3163 };
const OSMAN = { x: 3286, z: 3180 };
const LEELA = { x: 3113, z: 3263 };
const JOE = { x: 3123, z: 3245 };
const KELI = { x: 3128, z: 3244 };
const PRINCE = { x: 3123, z: 3242 };

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

/** Somewhere beside the target that can actually be stood on. */
function approach(candidates: { x: number; z: number }[], fallback: { x: number; z: number }): { x: number; z: number } {
    for (const cand of candidates) {
        if (isTileWalkable(0, cand.x, cand.z)) return cand;
    }
    return fallback;
}

/** Supplies withdrawn from the bank; the journal checklist verifies them. */
const NEEDED = [
    { name: 'bronze_bar', pattern: /^bronze bar$/i }, // key copy via Oskarl
    { name: 'rope', pattern: /^rope$/i }, // tie up Lady Keli
    { name: 'skinpaste', pattern: /^(paste|skin paste)$/i }, // disguise
    { name: 'pink_skirt', pattern: /^pink skirt$/i }, // disguise
    { name: 'wig', pattern: /^wig$/i }, // blondwig (or plainwig + yellowdye)
    { name: 'beer', pattern: /^beer$/i }, // guard Joe
];

const KEY_COPY = { name: 'princeskey', pattern: /^bronze key$/i };

const JOURNAL = { label: 'Prince Ali Rescue', title: 'The Rescue Of Prince Ali' };

// Journal rules, read from the quest's own journal script
// (server/content/scripts/quests/quest_prince/scripts/prince_journal.rs2).
// Each rule keys on a sentence UNIQUE to its stage — the stages share long
// prefix prose, so a shared sentence would PASS for several stages at once.
const RULES: Record<string, JournalRule> = {
    unstarted: { id: 'prince:unstarted', kind: 'unstarted', all: ['speaking to Hassan'] },
    started: { id: 'prince:started', kind: 'active', all: ['speak to Osman for details'] },
    spoken_osman: { id: 'prince:spoken_osman', kind: 'active', all: ['Talk to Leela near Draynor Village for advice'] },
    prep_finished: { id: 'prince:prep_finished', kind: 'active', all: ['determine any weaknesses'] },
    guard_drunk: { id: 'prince:guard_drunk', kind: 'active', all: ['use some Rope to tie her up'] },
    tied_keli: { id: 'prince:tied_keli', kind: 'active', all: ['I can now free Prince Ali'] },
    saved: { id: 'prince:saved', kind: 'active', all: ['return to Hassan to claim my reward'] },
    complete: { id: 'prince:complete', kind: 'complete', all: ['QUEST COMPLETE'] },
};
type Stage = keyof typeof RULES;
const STAGE_ORDER: Stage[] = ['unstarted', 'started', 'spoken_osman', 'prep_finished', 'guard_drunk', 'tied_keli', 'saved', 'complete'];

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
    name: 'prince ali rescue',
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
const MODE = process.env.QUEST_LAB_MODE === 'staging' ? 'staging' : 'development';
const run = createRun(join(process.cwd(), 'quest-lab', 'runs'), safeRunId('prince', username, new Date().toISOString()), {
    questId: 'prince',
    account: username,
    mode: MODE,
    scriptHash: Bun.hash(await Bun.file(import.meta.path).text()).toString(16),
    fixtureHash: process.env.QUEST_LAB_FIXTURE_HASH ?? 'unrecorded',
    contentHash: process.env.QUEST_LAB_CONTENT_HASH ?? 'unrecorded',
    requiredCheckpoints: STAGE_ORDER,
});
log(`Run record: ${run.directory} (mode=${MODE})`);

/** Checkpoint gate. UNKNOWN is a failure like any other here: proceed on nothing. */
async function checkpoint(name: Stage, label: string): Promise<boolean> {
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

// ── 1. what stage is this account actually at? ──────────────────────────────
// Read the journal BEFORE banking. A finished quest has nothing left to do,
// and a bot resumed mid-quest should bank only for what it still lacks.
// Banking first made a completed quest report "insufficient stock" instead
// of "already complete" — and walked to the bank to do it.
await session.setPhase('inspect');

/** The first stage rule that PASSes is the account's real stage. */
async function readStage(): Promise<Stage | 'unknown'> {
    for (const name of [...STAGE_ORDER].reverse()) {
        const read = await readJournalCheckpoint(sdk, JOURNAL, RULES[name]!);
        log(`  stage probe ${name}: ${read.verdict?.verdict ?? 'UNKNOWN'} (${read.reason})`);
        if (read.verdict?.verdict === 'PASS') return name;
    }
    return 'unknown';
}

/** True once the account's journal has reached at least the given stage. */
async function atLeast(stage: Stage): Promise<boolean> {
    const cur = await readStage();
    if (cur === 'unknown') return false;
    return STAGE_ORDER.indexOf(cur) >= STAGE_ORDER.indexOf(stage);
}

const STAGE = await readStage();
log(`Quest stage at start: ${STAGE}`);
if (STAGE === 'complete') {
    log('Prince Ali Rescue is already complete — nothing to do');
    session.log('log', 'quest already complete; nothing to do');
    sdk.disconnect();
    process.exit(0);
}
if (STAGE === 'unknown') throw new Error('could not determine the quest stage from the journal');

// ── 2. bank, but only for supplies we still lack ────────────────────────────
await session.setPhase('bank');
const needsBanking = STAGE === 'unstarted' || STAGE === 'started' || STAGE === 'spoken_osman'
    ? NEEDED.some(n => invCount(n.pattern) === 0) && invCount(KEY_COPY.pattern) === 0
    : STAGE === 'prep_finished'
      ? invCount(/^beer$/i) === 0
      : false;
await bot.dismissBlockingUI();
if (needsBanking) await bankForSupplies();
else log('Supplies already carried (or no longer needed at this stage); skipping the bank leg');

/** Withdraw whatever quest supplies are missing. Never buys food. */
async function bankForSupplies(): Promise<void> {
    // A bot may be anywhere on restart, so travel to the bank first rather
    // than assuming the start tile.
    if (distTo(ALKHARID_BANK) > 8) await travelTo(ALKHARID_BANK, 'Al-Kharid bank');

    if (!(await bot.openBank()).success) {
        await bot.closeInterface();
        await bot.walkTo(ALKHARID_BANK.x - 1, ALKHARID_BANK.z, 1);
        if (!(await bot.openBank()).success) throw new Error('could not open Al-Kharid bank for withdrawal');
    }
    await sdk.waitForTicks(2);

    const bankItems = sdk.getState()?.bank?.items ?? [];
    const have = (re: RegExp) => bankItems.filter(i => re.test(i.name)).reduce((n, i) => n + (i.count ?? 0), 0);
    const shortfall = NEEDED.filter(n => invCount(n.pattern) + have(n.pattern) < 1);
    if (shortfall.length) {
        const detail = shortfall.map(n => `${n.name}(inv=${invCount(n.pattern)} bank=${have(n.pattern)} need=1)`).join(' ');
        log(`INSUFFICIENT STOCK: ${detail} — idling instead of crash-looping`);
        session.log('warn', `insufficient stock: ${detail}`);
        process.exit(0);
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
    log(`Bag: ${NEEDED.map(n => `${n.name}x${invCount(n.pattern)}`).join(' ')} keycopyx${invCount(KEY_COPY.pattern)}`);
}

// ── travel ──────────────────────────────────────────────────────────────────
/**
 * Walk to a destination via planned waypoints. Each leg is verified: a leg
 * that moves nothing is an obstacle, and retrying the same bearing cannot
 * help.
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

/**
 * Talk to an NPC and drain the dialog fully. The option list fills only as
 * the NPC's opening lines are clicked through, so a single sample reads an
 * empty set; after picking, keep clicking until the dialog closes so the
 * server reaches its stage-advance line.
 */
async function talkDrain(npc: RegExp, what: string, picks: RegExp[]): Promise<void> {
    const talked = await bot.talkTo(npc);
    if (!talked.success) throw new Error(`could not talk to ${what}: ${talked.message ?? '?'}`);
    const used = new Set<number>();
    for (let i = 0; i < 40; i++) {
        const dialog = sdk.getDialog();
        if (!dialog?.isOpen) {
            await sdk.waitForTicks(1);
            if (!sdk.getDialog()?.isOpen && i > 2) break;
            continue;
        }
        const options = dialog.options ?? [];
        const pick = picks.map(re => options.find(o => !used.has(o.index) && re.test(o.text))).find(Boolean)
            ?? options.find(o => !used.has(o.index));
        if (pick) {
            used.add(pick.index);
            log(`dialog (${what}) -> ${pick.text}`);
            await sdk.sendClickDialog(pick.index);
        } else {
            await sdk.sendClickDialog(dialog.continueIndex ?? 0);
        }
        await sdk.waitForTicks(2);
    }
    await bot.dismissBlockingUI();
}

// ── 3. start the quest via Hassan, only from the unstarted stage ────────────
await session.setPhase('travel');
if (STAGE === 'unstarted') {
    // Gate BEFORE acting: the quest must really be unstarted, or the dialog
    // below acts on an assumption.
    if (!(await checkpoint('unstarted', 'quest not yet started'))) {
        throw new Error('unstarted checkpoint failed before starting the quest');
    }
    await travelTo(approach(
        [{ x: 3302, z: 3164 }, { x: 3301, z: 3163 }, { x: 3303, z: 3163 }, { x: 3302, z: 3162 }],
        HASSAN,
    ), 'Hassan');
    await session.setPhase('start-quest');
    await talkDrain(/^hassan$/i, 'Hassan', [/can i help|need some help|desert/i]);
    if (!(await checkpoint('started', 'accepted the quest, Osman requested'))) {
        throw new Error('started checkpoint failed after speaking to Hassan');
    }
} else {
    log('Resuming mid-quest: Hassan start already journal-confirmed');
}

// ── 4. Osman for the briefing ───────────────────────────────────────────────
if (!(await atLeast('spoken_osman'))) {
    await session.setPhase('osman');
    await travelTo(approach(
        [{ x: 3286, z: 3181 }, { x: 3285, z: 3180 }, { x: 3287, z: 3180 }, { x: 3286, z: 3179 }],
        OSMAN,
    ), 'Osman');
    await talkDrain(/^osman$/i, 'Osman', [/first thing i must do|what is the first/i]);
    if (!(await checkpoint('spoken_osman', 'Osman briefed, Leela checklist open'))) {
        throw new Error('spoken_osman checkpoint failed after speaking to Osman');
    }
} else {
    log('Resuming: Osman briefing already journal-confirmed');
}

// ── 5. Leela checklist: key copy / rope / paste / skirt / wig ──────────────
if (!(await atLeast('prep_finished'))) {
    await session.setPhase('leela');
    await travelTo(approach(
        [{ x: 3113, z: 3264 }, { x: 3112, z: 3263 }, { x: 3114, z: 3263 }, { x: 3113, z: 3262 }],
        LEELA,
    ), 'Leela');
    await talkDrain(/^leela$/i, 'Leela', [/advice|disguise|prince/i]);
    // The journal checklist flips each line struck-through as items arrive;
    // prep_finished is the journal proof the set is accepted. Log what the
    // bag holds so a stall names its missing piece.
    log(`Checklist bag: keycopyx${invCount(KEY_COPY.pattern)} ropex${invCount(/^rope$/i)} pastex${invCount(/paste/i)} skirtx${invCount(/skirt/i)} wigx${invCount(/wig/i)} beerx${invCount(/^beer$/i)}`);
    if (!(await checkpoint('prep_finished', 'Leela prep accepted, guard weakness known'))) {
        throw new Error('prep_finished checkpoint failed: checklist incomplete — restock and resume');
    }
} else {
    log('Resuming: Leela checklist already journal-confirmed');
}

// ── 6. Guard Joe: beer ──────────────────────────────────────────────────────
if (!(await atLeast('guard_drunk'))) {
    await session.setPhase('guard');
    await travelTo(approach(
        [{ x: 3123, z: 3246 }, { x: 3122, z: 3245 }, { x: 3124, z: 3245 }, { x: 3123, z: 3244 }],
        JOE,
    ), 'Guard Joe');
    await talkDrain(/^joe$/i, 'Guard Joe', [/beer here, fancy one|beer/i]);
    if (!(await checkpoint('guard_drunk', 'guard drunk, Keli tie-up open'))) {
        throw new Error('guard_drunk checkpoint failed after plying the guard');
    }
} else {
    log('Resuming: guard already drunk per journal');
}

// ── 7. Lady Keli: tie with rope ─────────────────────────────────────────────
if (!(await atLeast('tied_keli'))) {
    await session.setPhase('keli');
    await travelTo(approach(
        [{ x: 3128, z: 3245 }, { x: 3127, z: 3244 }, { x: 3129, z: 3244 }, { x: 3128, z: 3243 }],
        KELI,
    ), 'Lady Keli');
    // Gate on resulting state: useItemOnNpc success is weak (idle ticks read
    // as success), so the journal stage is the proof, not the result flag.
    const tie = await bot.useItemOnNpc(/^rope$/i, /^lady keli$/i);
    log(`tie Keli: ok=${tie.success}${tie.success ? '' : ` (${tie.message ?? tie.reason ?? '?'})`}`);
    await bot.dismissBlockingUI();
    if (!(await checkpoint('tied_keli', 'Keli tied, Prince freeing open'))) {
        throw new Error('tied_keli checkpoint failed after tying Keli');
    }
} else {
    log('Resuming: Keli already tied per journal');
}

// ── 8. Prince Ali: disguise + free ──────────────────────────────────────────
if (!(await atLeast('saved'))) {
    await session.setPhase('free');
    await travelTo(approach(
        [{ x: 3123, z: 3243 }, { x: 3122, z: 3242 }, { x: 3124, z: 3242 }, { x: 3123, z: 3241 }],
        PRINCE,
    ), 'Prince Ali');
    // Disguise handoff + cell unlock run through the Prince dialog; the
    // journal (not the click result) proves the rescue took.
    await talkDrain(/^prince ali$/i, 'Prince Ali', [/disguise|escape|free/i]);
    await bot.dismissBlockingUI();
    if (!(await checkpoint('saved', 'Prince disguised and freed, return to Hassan'))) {
        throw new Error('saved checkpoint failed after freeing the Prince');
    }
} else {
    log('Resuming: Prince already freed per journal');
}

// ── 9. Return to Hassan, verify completion by the journal ───────────────────
await session.setPhase('return');
await travelTo(approach(
    [{ x: 3302, z: 3164 }, { x: 3301, z: 3163 }, { x: 3303, z: 3163 }, { x: 3302, z: 3162 }],
    HASSAN,
), 'Hassan (return)');
await talkDrain(/^hassan$/i, 'Hassan', [/reward|prince|rescued/i]);
await bot.dismissBlockingUI();

await session.setPhase('verify');
if (!(await checkpoint('complete', 'journal reports QUEST COMPLETE'))) {
    throw new Error('completion checkpoint failed: journal does not report the quest complete');
}

session.log('log', 'Prince Ali Rescue verified complete');
session.noteProgress('inventory', 'quest complete (journal-verified)');
const summary = summarizeRun(run.directory);
if (!summary.ok) {
    // Every declared checkpoint must carry a PASS before this counts as done.
    throw new Error(`promotion gate failed: missing/unpassed ${JSON.stringify(summary.missing)}`);
}
log(`Run record verified: ${summary.ok} (${summary.missing.length} outstanding)`);
log(`DONE Prince Ali Rescue verified via journal at (${pos().x},${pos().z})`);
log(`Metrics: ${JSON.stringify(session.metrics())}`);

sdk.disconnect();
process.exit(0);
