/**
 * Ernest the Chicken — replayable, checkpoint-gated.
 *
 *   bun bots/quests/ernest-chicken.ts qlhaunt2
 *
 * Banks a spade at Draynor (Lumbridge has no bank in this revision), talks to
 * Veronica outside Draynor Manor, climbs to Professor Oddenstein on the top
 * floor, then collects his three machine parts:
 *   - rubber tube: spade on the compost heap -> closet key -> unlock the
 *     closet behind the ground-floor staircase -> pick up the tube
 *   - pressure gauge: poison + fish food (ground spawns in the manor) ->
 *     poisoned fish food on the garden fountain -> search the fountain
 *   - oil can: basement lever maze -> pick up the can -> climb back out
 * Hands all three to Oddenstein and verifies QUEST COMPLETE in the journal.
 *
 * Every step that matters is gated on QUEST JOURNAL evidence, never on XP,
 * chat or a successful packet. The journal is the only client-visible record
 * of quest state: general quest varps are not exposed and most are never
 * transmitted, so it is the portable checkpoint channel.
 *
 * Route and door handling:
 *   - waypoints computed offline from the repo's collision data
 *     (`findLongPath`), single plane per leg, verified one hop at a time;
 *     a leg that moves nothing is an obstacle, not something to retry
 *   - `bot.walkTo`/`talkTo` open blocking doors, which is why the internal
 *     manor doors need no explicit handling
 *   - the manor FRONT door is one-way (opens from the outside only, see
 *     learnings/draynor-manor.md): entry is via MANOR_DOOR from the north,
 *     exit is via the east-wing escape doors (3119,3356) and (3123,3360)
 *   - floor changes use the stairs scanner (nearest stair/ladder loc with a
 *     climb option), never a hardcoded stair tile: a restart mid-quest can
 *     leave the bot on any level
 *
 * Content sources (all in-repo, no guide drift):
 *   - stages: server/content/scripts/quests/quest_haunted/scripts/haunted_journal.rs2
 *     not_started L5-6 (speak to Veronica) / started L7-8 (find Ernest in the
 *     manor) / spoken_to_oddenstein L9-27 (three parts, per-item @str@/@dre@)
 *     / complete L28-30 (QUEST COMPLETE!)
 *   - quest list label: server/content/scripts/player/interfaces/questlist.if
 *     [haunted] option= / text= "Ernest the Chicken"
 *   - Veronica start + Oddenstein parts/hand-in dialogs:
 *     server/content/scripts/areas/area_draynor/scripts/veronica.rs2 and
 *     professor_oddenstein.rs2
 *   - compost/key, fountain/gauge, poisoned-food mechanics:
 *     server/content/scripts/quests/quest_haunted/scripts/quest_haunted.rs2
 */
import { existsSync, readFileSync, appendFileSync } from 'fs';
import { dirname, join } from 'path';

import { BotSDK, deriveGatewayUrl } from '../../sdk/index';
import { BotActions } from '../../sdk/actions';
import { initPathfinding, findLongPath, isTileWalkable } from '../../sdk/pathfinding';
import { ActivitySession } from '../../sdk/activity';
import { QUEST_JOURNAL_TAB, readJournalCheckpoint, readSideInterface } from '../../quest-lab/journal-reader';
import { createRun, appendCheckpoint, summarizeRun, safeRunId } from '../../quest-lab/records';
import type { JournalRule } from '../../quest-lab/evidence';

// ── args / env ──────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const botArg = argv.find(a => !a.startsWith('-'));
const envPath = botArg
    ? join(process.cwd(), 'bots', botArg, 'bot.env')
    : join(dirname(import.meta.path), 'bot.env');
if (!existsSync(envPath)) throw new Error(`bot.env not found at ${envPath}. Usage: bun bots/quests/ernest-chicken.ts <botname>`);
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
/** Veronica's engine spawn (map n48_52, Aggie-validated unpack): south of the manor grounds. */
const VERONICA = { x: 3110, z: 3330 };
/** Compost heap west of the manor (probe-verified (3084,3360), option Search). */
const COMPOST_HEAP = { x: 3084, z: 3360 };
/** Manor front door: enter from the OUTSIDE (north) only — it cannot be opened from inside. */
const MANOR_DOOR = { x: 3108, z: 3355 };
/** East-wing escape route out of the manor (learnings/draynor-manor.md). */
const ESCAPE_DOOR_1 = { x: 3119, z: 3356 };
const ESCAPE_DOOR_2 = { x: 3123, z: 3360 };

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

/** Somewhere beside a target that can actually be stood on. */
function walkableNear(t: { x: number; z: number }): { x: number; z: number } {
    for (const cand of [
        { x: t.x, z: t.z }, { x: t.x + 1, z: t.z }, { x: t.x - 1, z: t.z },
        { x: t.x, z: t.z + 1 }, { x: t.x, z: t.z - 1 },
    ]) {
        if (isTileWalkable(0, cand.x, cand.z)) return cand;
    }
    return { x: t.x, z: t.z };
}

/** Items the bank leg must provide. Everything else is found inside the manor. */
const NEEDED = [
    { name: 'spade', pattern: /^spade$/i },
];

/**
 * Quest items that must survive banking: a resume must never deposit the key,
 * the parts, or the poisoned food it already carries.
 */
const KEEP = [
    /^spade$/i,
    /^key$/i, // closet_key ("Key", smelly)
    /^oil can$/i,
    /^pressure gauge$/i,
    /^rubber tube$/i,
    /^fish food$/i,
    /^poison$/i,
    /^poisoned fish food$/i,
];

const OIL_CAN = /^oil can$/i;
const PRESSURE_GAUGE = /^pressure gauge$/i;
const RUBBER_TUBE = /^rubber tube$/i;
const CLOSET_KEY = /^key$/i;
const FISH_FOOD = /^fish food$/i;
const POISON = /^poison$/i;
const POISONED_FOOD = /^poisoned fish food$/i;

// Label from questlist.if [haunted] option=, title from ~quest_journal("Ernest the Chicken", ...).
const JOURNAL = { label: 'Ernest the Chicken', title: 'Ernest the Chicken' };

// Journal rules, read from the quest's own journal script
// (server/content/scripts/quests/quest_haunted/scripts/haunted_journal.rs2):
//   not_started -> "I can start this quest by speaking to Veronica ..."
//   started     -> "I need to find Ernest / He went into Draynor Manor ..."
//   parts       -> "I need to bring Dr Oddenstein parts for his machine" (+ per-item lines)
//   complete    -> "... QUEST COMPLETE!"
const RULES: Record<string, JournalRule> = {
    unstarted: { id: 'haunted:unstarted', kind: 'unstarted', all: ['I can start this quest by speaking to', 'Veronica'] },
    started: { id: 'haunted:started', kind: 'active', all: ['I need to find', 'Draynor Manor'] },
    parts: { id: 'haunted:parts', kind: 'active', all: ['parts for his machine'] },
    complete: { id: 'haunted:complete', kind: 'complete', all: ['QUEST COMPLETE'] },
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
// setPhase routes intent through showIntent (roster-telemetry gate); the
// recovery budget covers the 3 built-in tactics plus the bank/area legs below.
const session = new ActivitySession(sdk, bot, {
    name: 'ernest the chicken',
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
const run = createRun(join(process.cwd(), 'quest-lab', 'runs'), safeRunId('haunted', username, new Date().toISOString()), {
    questId: 'haunted',
    account: username,
    mode: MODE,
    scriptHash: Bun.hash(await Bun.file(import.meta.path).text()).toString(16),
    fixtureHash: process.env.QUEST_LAB_FIXTURE_HASH ?? 'unrecorded',
    contentHash: process.env.QUEST_LAB_CONTENT_HASH ?? 'unrecorded',
    requiredCheckpoints: ['unstarted', 'started', 'parts', 'complete'],
});
log(`Run record: ${run.directory} (mode=${MODE})`);

/**
 * The quest-tab side interface streams in late after login (qlpriest9 showed
 * the same "no side interface" UNKNOWN burst, then read fine on a settled
 * client). readJournalCheckpoint only allows 4 ticks after setTab, so park on
 * the quest tab until the side interface is actually published — bounded, so a
 * genuinely broken tab still fails loudly instead of hanging the run.
 */
async function awaitQuestTab(why: string): Promise<void> {
    if (readSideInterface(sdk)) return;
    await sdk.sendSetTab(QUEST_JOURNAL_TAB).catch(() => {});
    try {
        await sdk.waitForCondition(
            s => !!s.sideInterface && s.sideInterface.interfaceId !== -1,
            30_000,
        );
        log(`quest tab settled for ${why}`);
    } catch {
        log(`quest tab side interface never published for ${why} — probes will report UNKNOWN`);
    }
}

/** Checkpoint gate. UNKNOWN is a failure like any other here: proceed on nothing. */
async function checkpoint(name: keyof typeof RULES, label: string): Promise<boolean> {
    await awaitQuestTab(name);
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
// Read the journal BEFORE banking. A finished quest has nothing left to do, and
// a bot resumed mid-quest should bank only for what it still lacks. Banking
// first made a completed quest report "insufficient stock" instead of "already
// complete" — and walked to Draynor to do it.
await session.setPhase('inspect');

/** The first stage rule that PASSes is the account's real stage. */
async function readStage(): Promise<'unstarted' | 'started' | 'parts' | 'complete' | 'unknown'> {
    await awaitQuestTab('stage probe');
    for (const name of ['complete', 'parts', 'started', 'unstarted'] as const) {
        const read = await readJournalCheckpoint(sdk, JOURNAL, RULES[name]!);
        log(`  stage probe ${name}: ${read.verdict?.verdict ?? 'UNKNOWN'} (${read.reason})`);
        if (read.verdict?.verdict === 'PASS') return name;
    }
    return 'unknown';
}

const STAGE = await readStage();
log(`Quest stage at start: ${STAGE}`);
if (STAGE === 'complete') {
    // Record the fresh journal evidence in this run's record, then exit.
    await checkpoint('complete', `already complete at (${pos().x},${pos().z}) l${pos().level}`);
    log('Ernest the Chicken is already complete — nothing to do');
    session.log('log', 'quest already complete; nothing to do');
    sdk.disconnect();
    process.exit(0);
}
if (STAGE === 'unknown') throw new Error('could not determine the quest stage from the journal');

// ── 2. bank, but only for supplies we still lack ────────────────────────────
await session.setPhase('bank');
const needsBanking = NEEDED.some(n => invCount(n.pattern) === 0);
await bot.dismissBlockingUI();
if (needsBanking) await bankForSupplies();
else log('Spade already carried; skipping the bank leg');

/** Deposit carry-over (keeping quest items), then withdraw a spade if missing. */
async function bankForSupplies(): Promise<void> {
// A bot may be anywhere on restart (mid-quest, or left by an earlier leg), so
// travel to the bank first rather than assuming the start tile.
if (distTo(DRAYNOR_BANK) > 8) await travelTo(DRAYNOR_BANK, 'Draynor bank');

const junk = sdk.getInventory().filter(i =>
    (i.count ?? 0) > 0 && !KEEP.some(k => k.test(i.name)));
if (junk.length > 0) {
    log(`Depositing ${junk.length} non-quest stack(s) before withdrawing`);
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
}

// ── travel ──────────────────────────────────────────────────────────────────
/**
 * Manor recovery, mirrored on Ghost's exitTower: a walkTo that moves nothing
 * is usually shut doors on the path (run 11 parked on Door@(3109,3358) for
 * three attempts while the loc view went stale). Collision data calls door
 * tiles walkable, so the plan looks fine while the server refuses every step.
 * Refresh the loc view, open EVERY shut door/gate in reach, settle, and let
 * the next walk attempt re-route — displacement stays the gate. An open
 * attempt may report "Nothing happened" while still flipping the door, so the
 * walk is retried regardless.
 */
async function openNearbyDoors(what: string): Promise<void> {
    await sdk.scanNearbyLocs(12).catch(() => {});
    const shut = (sdk.getNearbyLocs() ?? [])
        .filter(l => /door|gate/i.test(l.name)
            && (l.distance ?? 99) <= 6
            && l.optionsWithIndex.some(o => /^open$/i.test(o.text)))
        .sort((a, b) => (a.distance ?? 99) - (b.distance ?? 99));
    if (shut.length === 0) {
        log(`no shut door in reach for ${what}`);
        return;
    }
    for (const door of shut) {
        const r = await bot.interactLoc(door, /open/i);
        log(`open ${door.name} at (${door.x},${door.z}) for ${what}: ${r.success ? 'ok' : `FAILED ${r.reason ?? ''} ${r.message ?? ''}`}`);
        await sdk.waitForTicks(2);
    }
    await sdk.waitForTicks(2);
}

/**
 * Walk to a destination via planned waypoints. Each leg is verified: a leg that
 * moves nothing is an obstacle, and retrying the same bearing cannot help.
 */
/**
 * Escape a sealed pocket by raw stepping, then re-plan from the new tile.
 *
 * The compost leg died at (3085,3349) — "range 11 of (3084,3360)" — because that
 * tile is inside a walled void: the collision data shows every walkable face of
 * the heap (3083,3360 / 3084,3359 / 3086,3360 / 3082,3360 / 3084,3362) DOES
 * route to the manor's front door in 24-28 tiles, so the heap was never the
 * problem — the bot was standing somewhere the planner cannot leave. walkTo
 * reports "no waypoints" there and the leg BLOCKS.
 *
 * Same shape as demon-slayer's tower pocket: open whatever door is in reach,
 * then raw-sendWalk toward the anchor until displacement is real, fanning out
 * when a straight step is refused. Returns true once we moved.
 */
async function escapePocket(anchor: { x: number; z: number }, what: string): Promise<boolean> {
    const start = pos();
    await openNearbyDoors(what);
    await sdk.scanNearbyLocs(10).catch(() => undefined);
    for (const loc of (sdk.getNearbyLocs() ?? []).filter(l => /door|gate/i.test(l.name ?? '') && (l.distance ?? 99) <= 8)) {
        const opt = loc.optionsWithIndex?.[0]?.text ?? 'Open';
        await bot.interactLoc(loc, new RegExp(`^${opt}$`, 'i')).catch(() => undefined);
        await sdk.waitForTicks(2);
        if (Math.hypot(pos().x - start.x, pos().z - start.z) >= 1) {
            log(`pocket escape: ${loc.name ?? 'door'} @ ${loc.x},${loc.z} (${opt}) moved us to (${pos().x},${pos().z})`);
            break;
        }
    }
    for (let round = 0; round < 8; round++) {
        const before = pos();
        if (Math.hypot(before.x - anchor.x, before.z - anchor.z) < 6) return true;
        // Straight at the anchor first, then a fan of short steps.
        const dx = anchor.x - before.x;
        const dz = anchor.z - before.z;
        const d = Math.hypot(dx, dz) || 1;
        const tries = [
            { x: Math.round(before.x + (dx / d) * Math.min(2, d)), z: Math.round(before.z + (dz / d) * Math.min(2, d)) },
            { x: before.x + 1, z: before.z }, { x: before.x - 1, z: before.z },
            { x: before.x, z: before.z + 1 }, { x: before.x, z: before.z - 1 },
            { x: before.x + 1, z: before.z + 1 }, { x: before.x - 1, z: before.z - 1 },
            { x: before.x + 1, z: before.z - 1 }, { x: before.x - 1, z: before.z + 1 },
        ];
        for (const t of tries) {
            await sdk.sendWalk(t.x, t.z, true).catch(() => undefined);
            await sdk.waitForTicks(2);
            const after = pos();
            if (Math.hypot(after.x - before.x, after.z - before.z) >= 0.5) {
                log(`pocket escape: raw step (${t.x},${t.z}) -> (${after.x},${after.z})`);
                break;
            }
        }
        if (Math.hypot(pos().x - before.x, pos().z - before.z) < 0.5) {
            log(`pocket escape: no direction moved from (${before.x},${before.z}) — pocket is sealed`);
            return false;
        }
    }
    log(`pocket escape: at (${pos().x},${pos().z}) from (${start.x},${start.z})`);
    return true;
}

async function travelTo(dest: { x: number; z: number }, what: string): Promise<void> {
    let waypoints = planWaypoints(pos(), dest);
    log(`Route to ${what}: ${waypoints.length} waypoint(s) from (${pos().x},${pos().z}) to (${dest.x},${dest.z})`);
    // "1 waypoint" means the planner gave up and returned the goal alone — from a
    // sealed pocket that is the signature. Raw-step out, then plan again.
    if (waypoints.length <= 1 && Math.hypot(pos().x - dest.x, pos().z - dest.z) > 4) {
        if (await escapePocket(dest, what)) {
            waypoints = planWaypoints(pos(), dest);
            log(`Route to ${what} (after pocket escape): ${waypoints.length} waypoint(s) from (${pos().x},${pos().z})`);
        }
    }
    for (let i = 0; i < waypoints.length; i++) {
        const wp = waypoints[i]!;
        const before = pos();
        if (Math.hypot(before.x - wp.x, before.z - wp.z) <= 3) continue;

        let moved = false;
        for (let attempt = 0; attempt < 3 && !moved; attempt++) {
            // Tolerance 1, not 3: walkTo measures Chebyshev, so tol 3 no-ops
            // ("Already at destination") a full 3 tiles out and travelTo then
            // BLOCKEDs on zero displacement (fountain run 06:04: cheb 3,
            // euclid 3.6, three instant-ok legs). Arrival-within-3 is still
            // accepted via the hypot check below.
            const res = await bot.walkTo(wp.x, wp.z, 1);
            await sdk.waitForTicks(2);
            const after = pos();
            const step = Math.hypot(after.x - before.x, after.z - before.z);
            moved = step >= 1 || Math.hypot(after.x - wp.x, after.z - wp.z) <= 3;
            log(`leg ${i + 1}/${waypoints.length} -> (${wp.x},${wp.z}) moved=${step.toFixed(1)} at (${after.x},${after.z}) l${after.level} ok=${res.success}`);
            if (!moved && attempt < 2) await openNearbyDoors(what);
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
 * Push through the manor FRONT door to a known interior anchor. travelTo
 * stops at the door tile, and interior locs (closet, ladder, ground spawns)
 * are invisible from outside — resolving them from the door tile throws
 * "no X visible" (closet run, 2026-10-18). The door opens from the outside
 * only, so this must run while the bot is still outside.
 */
async function enterManor(what: string): Promise<void> {
    await openNearbyDoors(`manor entry (${what})`);
    await travelTo({ x: 3108, z: 3362 }, `manor interior (${what})`);
}

/**
 * Drain an NPC dialog to completion, preferring quest-advancing options.
 * Options fill only as opening lines are clicked through, so a single read
 * returns an empty set indistinguishable from "nothing to say" — keep polling
 * until the dialog closes, and never fall back to options[0] on a pattern
 * miss (option 0 is usually the decline).
 */
async function drainDialog(prefer: RegExp[], what: string): Promise<void> {
    let pickedSomething = false;
    for (let i = 0; i < 40; i++) {
        const dialog = sdk.getDialog();
        if (!dialog?.isOpen) {
            await sdk.waitForTicks(1);
            if (!sdk.getDialog()?.isOpen && i > 2) break;
            continue;
        }
        const options = dialog.options ?? [];
        if (options.length === 0) {
            await sdk.sendClickDialog(0).catch(() => {});
            await sdk.waitForTicks(2);
            continue;
        }
        let pick = undefined as undefined | { text: string; index: number };
        for (const re of prefer) {
            const found = options.find(o => re.test(o.text));
            if (found) { pick = found; break; }
        }
        if (!pick) {
            log(`dialog (${what}): no preferred option among [${options.map(o => JSON.stringify(o.text)).join(' | ')}] — clicking through`);
            await sdk.sendClickDialog(options[0]!.index).catch(() => {});
            await sdk.waitForTicks(2);
            continue;
        }
        log(`dialog (${what}) -> ${pick.text}`);
        pickedSomething = true;
        await sdk.sendClickDialog(pick.index);
        await sdk.waitForTicks(2);
    }
    await bot.dismissBlockingUI();
    if (!pickedSomething) log(`dialog (${what}): no preferred option was ever offered`);
}

/**
 * Climb between floors via the nearest stair/ladder loc offering a climb
 * option. Stair tiles are not hardcoded: a mid-quest restart can leave the bot
 * on any level, so scan, interact, and verify the plane actually changed.
 */
async function climbTo(targetLevel: number, what: string): Promise<void> {
    for (let i = 0; i < 10 && pos().level !== targetLevel; i++) {
        const wantUp = pos().level < targetLevel;
        const opt = wantUp ? /climb-up|climb up|walk-up|walk up|go-up|go up/i : /climb-down|climb down|walk-down|walk down|go-down|go down/i;
        const stairs = (sdk.getNearbyLocs() ?? [])
            .filter(l => /stair|ladder/i.test(l.name) && l.optionsWithIndex.some(o => opt.test(o.text)))
            .sort((a, b) => (a.distance ?? 99) - (b.distance ?? 99))[0];
        if (!stairs) {
            log(`climbTo ${what}: no ${wantUp ? 'up' : 'down'} stairs/ladder visible at (${pos().x},${pos().z}) l${pos().level}`);
            throw new Error(`cannot climb to level ${targetLevel} for ${what}: no stairs visible`);
        }
        const before = pos().level;
        const r = await bot.interactLoc(stairs, opt);
        log(`climb ${stairs.name} ${wantUp ? 'up' : 'down'}: ${r.success ? 'ok' : `FAILED ${r.reason ?? ''} ${r.message ?? ''}`}`);
        await sdk.waitForCondition(s => (s.player?.level ?? before) !== before, 8_000).catch(() => {});
        await sdk.waitForTicks(2);
    }
    if (pos().level !== targetLevel) throw new Error(`still level ${pos().level} after climbing for ${what}`);
    log(`On level ${targetLevel} for ${what} at (${pos().x},${pos().z})`);
}

/**
 * Pick up a ground item by name and VERIFY it landed in the bag.
 * interact/pickup success is weak ("dispatched, no error seen"), so the
 * inventory delta is the only proof the server acted.
 */
async function pickupVerified(pattern: RegExp, what: string): Promise<void> {
    if (invCount(pattern) > 0) {
        log(`${what} already carried; skipping pickup`);
        return;
    }
    const before = invCount(pattern);
    const r = await bot.pickupItem(pattern);
    log(`pickup ${what}: ${r.success ? 'ok' : `FAILED ${r.message ?? '?'}`}`);
    await sdk.waitForTicks(2);
    if (invCount(pattern) <= before) {
        throw new Error(`pickup of ${what} reported ${r.success ? 'ok' : 'failure'} but the bag shows no ${what}`);
    }
    log(`${what} in bag (x${invCount(pattern)})`);
    session.log('log', `picked up ${what}`);
}

/** Use an inventory item on a nearby loc and verify the server acted. */
async function useOnLocVerified(item: RegExp, loc: RegExp, locOpt: RegExp | undefined, what: string, opts?: { eastFirst?: boolean; resolveLoc?: () => unknown; expectMsg?: RegExp }): Promise<void> {
    const sigBefore = JSON.stringify(sdk.getInventory().map(i => `${i.name}x${i.count ?? 1}`));
    // Message baseline goes BEFORE the click dispatches: the waiter can time
    // out while the server still acts (closet key: "Timeout using Key on
    // Door" with "You unlock the door." already in flight) — a baseline
    // taken after the use would miss those lines and fail falsely.
    const msgLen = () => (((sdk.getState() as unknown as { gameMessages?: unknown[] })?.gameMessages ?? []).length);
    const msgBase = msgLen();
    const resolve = async () => (opts?.resolveLoc ? opts.resolveLoc() : resolveLocOrThrow(loc, locOpt!, what)) as unknown as { x: number; z: number } & Parameters<typeof bot.useItemOnLoc>[1];
    const r = locOpt
        ? await (async () => {
            // Nearby-loc entities carry the distance of the last scan, not a
            // live one: a heap first seen from ~10 tiles still reads >2 after
            // we walk adjacent, so useItemOnLoc's internal walkTo re-paths to
            // the (blocked) loc tile, detours wildly, and the waiter times out
            // mid-walk (runs 10/12/14/15). Rescan before resolving so the
            // entity — and its distance — are live; the internal walk is then
            // correctly skipped and the use dispatches in place.
            await sdk.scanNearbyLocs(12).catch(() => {});
            await stepToUseRange(await resolve(), what, opts);
            await sdk.scanNearbyLocs(12).catch(() => {});
            return bot.useItemOnLoc(item, await resolve());
        })()
        : await bot.useItemOnLoc(item, loc);
    log(`use-on-loc ${what}: ${r.success ? 'ok' : `FAILED ${r.reason ?? ''} ${r.message ?? ''}`}`);
    // Server effects land on delays AFTER the use returns (compost dig:
    // p_delay(2) before the key grant — a fixed 3-tick sample threw falsely
    // on a fresh account while "You find a small key." was still in flight).
    // Poll for the effect instead of sampling once. Message matches must be
    // NEW (after this use): the ring still holds the entry unlock's
    // "you go through the door" minutes later.
    const bagSig = () => JSON.stringify(sdk.getInventory().map(i => `${i.name}x${i.count ?? 1}`));
    const freshMsgs = () => {
        const all = ((sdk.getState() as unknown as { gameMessages?: { text: string }[] })?.gameMessages ?? []).map(m => m.text);
        return (all.length >= msgBase ? all.slice(msgBase) : all.slice(-6)).filter(t => opts?.expectMsg!.test(t));
    };
    const msgHit = () => opts?.expectMsg ? freshMsgs().length > 0 : false;
    for (let i = 0; i < 10 && bagSig() === sigBefore && !msgHit(); i++) {
        await sdk.waitForTicks(2);
    }
    // Unlock-style uses consume nothing (the key stays), so a bag delta can
    // never prove them — match the server's own success message instead.
    if (opts?.expectMsg) {
        const seen = freshMsgs();
        if (seen.length === 0) {
            const ring = ((sdk.getState() as unknown as { gameMessages?: { text: string }[] })?.gameMessages ?? []).slice(-5).map(m => m.text);
            throw new Error(`use-on-loc ${what} showed no ${opts.expectMsg} since the click; ring=[${ring.join(' | ')}] — the click was rejected or hit a decoy`);
        }
        session.log('log', `used item for ${what}`);
        return;
    }
    const sigAfter = JSON.stringify(sdk.getInventory().map(i => `${i.name}x${i.count ?? 1}`));
    if (sigBefore === sigAfter) {
        throw new Error(`use-on-loc ${what} changed nothing in the bag — the click was rejected or hit a decoy`);
    }
    session.log('log', `used item for ${what}`);
}

/**
 * Stand USE-adjacent to a resolved loc entity before clicking it — never
 * click from the waypoint. Digwatch (run 14) caught the failure mode: the
 * use dispatched with the heap ~10 tiles off, the server's APLOCU approach
 * wandered 25 tiles and died with "I can't reach that!", and the waiter
 * timed out with an untouched bag. Standing INSIDE a wide footprint is the
 * same failure (the heap is 2x2 blockwalk), so stand on the nearest walkable
 * tile at Chebyshev distance exactly 2 from the loc origin: outside any
 * footprint a 2-wide loc can have, inside approach range. Displacement is
 * verified — a step that moves nothing throws instead of clicking from afar.
 *
 * Compost-heap east face (east-dig probe 2026-10-18, mule qlhaunt2): the heap
 * footprint (3084..3085,3360..3361) has a wall/fence segment directly west
 * (x3080-3081, z3360-3361 in the collision grid), so EVERY west-side stand
 * (16/16 runs + 2 mule probes from (3082,3358)) dies with client cant_reach
 * ("no route... Prefer reachable"), a 25-tile APLOCU drag to (3093,3345),
 * and a use timeout with an untouched bag. From (3086,3360), cheb 2 with no
 * wall between, the same spade->heap use resolves IN PLACE (no wander) and
 * the key lands in ~2s. Pass { eastFirst: true } for the heap so the stand
 * tile is picked on the heap's open face even when the bot arrives from the
 * west; other locs keep nearest-first.
 */
async function stepToUseRange(loc: { x: number; z: number }, what: string, opts?: { eastFirst?: boolean }): Promise<void> {
    const cheb = () => Math.max(Math.abs(pos().x - loc.x), Math.abs(pos().z - loc.z));
    if (cheb() === 2) {
        log(`in use range for ${what} at (${pos().x},${pos().z}), loc at (${loc.x},${loc.z})`);
        return;
    }
    const order = [[2, 0], [-2, 0], [0, 2], [0, -2], [2, 2], [2, -2], [-2, 2], [-2, -2]];
    const dist = (t: { x: number; z: number }) => Math.hypot(t.x - pos().x, t.z - pos().z);
    const cands = order
        .map(([dx, dz]) => ({ x: loc.x + dx!, z: loc.z + dz! }))
        .filter(t => isTileWalkable(0, t.x, t.z))
        .sort((a, b) => {
            // eastFirst: stand tiles east of the loc origin (dx > 0) sort
            // before all others — the compost heap's only open face. Within
            // each side, nearest-first as before.
            if (opts?.eastFirst) {
                const ae = a.x > loc.x ? 0 : 1;
                const be = b.x > loc.x ? 0 : 1;
                if (ae !== be) return ae - be;
            }
            return dist(a) - dist(b);
        });
    if (cands.length === 0) throw new Error(`no standable use-range tile for ${what} at (${loc.x},${loc.z})`);
    const before = pos();
    const target = cands[0]!;
    const res = await bot.walkTo(target.x, target.z, 0);
    await sdk.waitForTicks(2);
    const after = pos();
    const step = Math.hypot(after.x - before.x, after.z - before.z);
    log(`use-range step for ${what} -> (${target.x},${target.z}) moved=${step.toFixed(1)} at (${after.x},${after.z}) ok=${res.success}; loc-range now ${cheb()}`);
    if (cheb() > 2) {
        throw new Error(`could not reach use range for ${what}: at (${after.x},${after.z}), range ${cheb()} of (${loc.x},${loc.z}) — refusing to click from afar`);
    }
}

async function resolveLocOrThrow(name: RegExp, withOption: RegExp, what: string) {
    const loc = sdk.findNearbyLoc(name, { withOption });
    if (!loc) throw new Error(`${what}: no ${name} with option ${withOption} visible at (${pos().x},${pos().z}) l${pos().level}`);
    return loc;
}

/** Maze lever coordinates (square 48_152: l48_152 decode + live dumps). */
const MAZE_LEVERS = {
    A: { x: 3108, z: 9745 }, B: { x: 3118, z: 9752 }, C: { x: 3112, z: 9760 },
    D: { x: 3108, z: 9767 }, E: { x: 3097, z: 9767 }, F: { x: 3096, z: 9765 },
} as const;
type MazeLever = keyof typeof MAZE_LEVERS;

/** Last game-message lines matching a pattern (the ring holds stale lines). */
function recentMsgs(re: RegExp, n = 3): string[] {
    const all = ((sdk.getState() as unknown as { gameMessages?: { text: string }[] })?.gameMessages ?? []).slice(-n).map(m => m.text);
    return all.filter(t => re.test(t));
}

/**
 * Set a maze lever closed-loop: inspect (truthful "The lever is up/down",
 * probed 2026-10-18: "up" <=> bit clear), pull on mismatch, re-inspect. No
 * bit assumptions — lever bits persist across runs until the basement
 * up-ladder reset fires. Bounded: throws loudly instead of oscillating.
 */
async function setMazeLever(name: MazeLever, want: 'up' | 'down', why: string): Promise<void> {
    const at = MAZE_LEVERS[name];
    for (let i = 0; i < 4; i++) {
        await sdk.scanNearbyLocs(14).catch(() => {});
        const found = (sdk.getNearbyLocs() ?? []).find(l => l.x === at.x && l.z === at.z);
        if (!found) throw new Error(`maze ${why}: lever ${name} not visible at (${pos().x},${pos().z}) l${pos().level} — wrong room?`);
        if ((found.distance ?? 99) > 3) {
            // Stance fallback: the first walkable adjacent tile that travelTo
            // actually reaches wins (a broken-pattern door tile on the way
            // poisons planning, so never commit to one stance).
            const cands = [
                { x: at.x + 1, z: at.z }, { x: at.x - 1, z: at.z },
                { x: at.x, z: at.z + 1 }, { x: at.x, z: at.z - 1 },
            ].filter(t => isTileWalkable(0, t.x, t.z));
            let arrived = false;
            for (const c of cands) {
                try {
                    await travelTo(c, `lever ${name} (${why})`);
                    arrived = true;
                    break;
                } catch { /* next stance */ }
            }
            if (!arrived) throw new Error(`maze ${why}: lever ${name} unreachable from (${pos().x},${pos().z}) — all stances failed`);
            await sdk.scanNearbyLocs(14).catch(() => {});
        }
        const live = (sdk.getNearbyLocs() ?? []).find(l => l.x === at.x && l.z === at.z) ?? found;
        await bot.interactLoc(live, /inspect/i);
        await sdk.waitForTicks(3);
        const seen = recentMsgs(/the lever is (up|down)/i, 2);
        const state = seen.length ? (/down/i.test(seen[seen.length - 1]!) ? 'down' as const : 'up' as const) : null;
        log(`maze ${why}: lever ${name} inspect -> ${state ?? 'UNREAD'} (want ${want})`);
        if (state === want) { session.log('log', `maze lever ${name} ${want} (${why})`); return; }
        if (state === null && i >= 1) throw new Error(`maze ${why}: lever ${name} state unreadable twice — refusing blind pulls`);
        const pull = await bot.interactLoc(live, /pull/i);
        log(`maze ${why}: pull lever ${name}: ${pull.success ? 'ok' : `FAILED ${pull.reason ?? ''} ${pull.message ?? ''}`}`);
        await sdk.waitForTicks(2);
    }
    throw new Error(`maze ${why}: lever ${name} never settled on ${want}`);
}

/**
 * Single-shot maze walk: one bot.walkTo, verified, retried — NO travelTo
 * planning. travelTo's locked-door avoidance reroutes around OPENED maze
 * doors whose lever pattern a later pull broke (they stay walkable while
 * their window lives, but the planner refuses them and strands the bot
 * north). A single walkTo pushes through the live window. Bounded.
 */
async function mazeWalkTo(x: number, z: number, why: string): Promise<void> {
    for (let attempt = 0; attempt < 3; attempt++) {
        await bot.walkTo(x, z, 1).catch(() => {});
        await sdk.waitForTicks(3);
        const left = Math.hypot(pos().x - x, pos().z - z);
        log(`maze ${why}: walk ${attempt + 1}/3 at (${pos().x},${pos().z}) left=${left.toFixed(1)}`);
        if (left <= 3) return;
    }
    throw new Error(`maze ${why}: could not walk to (${x},${z}) from (${pos().x},${pos().z})`);
}

/**
 * Raw maze walk: server-side sendWalk with NO door interaction. For crossing
 * an OPENED door whose pattern a later pull broke: any click marks it locked
 * and poisons planning, but the live window stays walkable. Bounded.
 */
async function rawMazeWalkTo(x: number, z: number, why: string): Promise<void> {
    for (let attempt = 0; attempt < 3; attempt++) {
        await sdk.sendWalk(x, z, true).catch(() => {});
        await sdk.waitForTicks(3);
        const left = Math.hypot(pos().x - x, pos().z - z);
        log(`maze ${why}: raw walk ${attempt + 1}/3 at (${pos().x},${pos().z}) left=${left.toFixed(1)}`);
        if (left <= 3) return;
    }
    throw new Error(`maze ${why}: raw walk to (${x},${z}) failed from (${pos().x},${pos().z})`);
}

/** Wiki door# -> maze loc coords (l48_152 decode, loc.sym ids 137-145). */
const MAZE_DOORS = {
    d1: { x: 3108, z: 9758 }, // 4to7
    d2: { x: 3105, z: 9760 }, // 4to5
    d3: { x: 3102, z: 9758 }, // 5to8
    d4: { x: 3100, z: 9760 }, // 5to6
    d5: { x: 3097, z: 9763 }, // 3to6
    d6: { x: 3100, z: 9765 }, // 2to3
    d7: { x: 3105, z: 9765 }, // 1to2
    d8: { x: 3102, z: 9763 }, // 2to5
    d9: { x: 3100, z: 9755 }, // 8to9
} as const;

/**
 * Far-side room boxes: opened maze doors teleport to fixed destinations,
 * so arrival inside the far room is the only proof the server acted.
 */
const ROOM4 = { x0: 3104, x1: 3114, z0: 9757, z1: 9764 };
const ROOM5 = { x0: 3099, x1: 3106, z0: 9757, z1: 9764 };
const ROOM8 = { x0: 3099, x1: 3106, z0: 9752, z1: 9759 };
const ROOM6 = { x0: 3093, x1: 3101, z0: 9757, z1: 9764 };
const ROOM9 = { x0: 3088, x1: 3101, z0: 9752, z1: 9758 };
const ROOM2 = { x0: 3099, x1: 3106, z0: 9762, z1: 9768 };
const ROOM1 = { x0: 3104, x1: 3113, z0: 9762, z1: 9768 };
const ENCL = { x0: 3094, x1: 3100, z0: 9762, z1: 9768 };
type RoomBox = typeof ROOM4;

/**
 * Open a wiki-order maze door and VERIFY by arrival in the far-side room
 * box. `ensure` lists ONLY levers reachable from the door's area:
 * setMazeLever travels to a stance, and routing across the maze for a far
 * lever rams locked doors — levers elsewhere are covered by the door-1
 * canary (which proves the all-UP baseline) plus bit persistence within
 * one descent (bits reset only on ascent/teleport).
 */
async function openMazeDoorBox(
    door: { x: number; z: number }, label: string,
    approach: { x: number; z: number }, far: { x: number; z: number },
    expect: RoomBox, ensure: [MazeLever, 'up' | 'down'][], why: string,
): Promise<void> {
    for (let attempt = 0; attempt < 3; attempt++) {
        for (const [name, want] of ensure) {
            await setMazeLever(name, want, `${label} (${why})`);
        }
        await mazeWalkTo(approach.x, approach.z, `${label} stance (${why})`);
        await sdk.scanNearbyLocs(14).catch(() => {});
        const d = (sdk.getNearbyLocs() ?? []).find(l => l.x === door.x && l.z === door.z);
        if (!d) throw new Error(`maze ${why}: door ${label} not visible at (${pos().x},${pos().z})`);
        const r = await bot.interactLoc(d, /open/i);
        log(`maze ${why}: open ${label} ${attempt + 1}/3: ${r.success ? 'ok' : `FAILED ${r.reason ?? ''} ${r.message ?? ''}`}`);
        await sdk.waitForTicks(3);
        let p = pos();
        if (p.x < expect.x0 || p.x > expect.x1 || p.z < expect.z0 || p.z > expect.z1) {
            // The Open teleports through; if it only opened, step far side.
            await bot.walkTo(far.x, far.z, 1).catch(() => {});
            await sdk.waitForTicks(2);
            p = pos();
        }
        if (p.x >= expect.x0 && p.x <= expect.x1 && p.z >= expect.z0 && p.z <= expect.z1) {
            log(`maze ${why}: through ${label} at (${p.x},${p.z})`);
            session.log('log', `maze opened ${label} (${why})`);
            return;
        }
        log(`maze ${why}: not through ${label} at (${p.x},${p.z}) — retrying`);
    }
    throw new Error(`maze ${why}: door ${label} never opened after 3 attempts at (${pos().x},${pos().z})`);
}

/**
 * The closet door's display name is "Door" (loc closet_door, type id 131) at
 * (3107,3367) behind the ground-floor staircase — a /closet/ name regex can
 * never match it ("no closet door visible" x3, 2026-10-18). Probe-identified:
 * plain Open on this exact door replies "The door is locked.", and loc.pack
 * maps 131=closet_door. Resolve by coordinates, never by name.
 */
function findClosetDoor() {
    return (sdk.getNearbyLocs() ?? []).find(l =>
        l.x === 3107 && l.z === 3367 && l.optionsWithIndex.some(o => /open|unlock/i.test(o.text)));
}

/**
 * Step back west through the closet door when the bot is east of it. A
 * key-use can carry the bot THROUGH to the east side (run 05:25 ended at
 * (3108,3367)); the shut door is unroutable — offline data masks doors
 * walkable, so the planner rams it and travelTo BLOCKEDs. No-op elsewhere.
 */
async function exitClosetIfEast(why: string): Promise<void> {
    if (pos().level !== 0 || pos().x <= 3107 || Math.abs(pos().z - 3367) > 2) return;
    log(`East of the closet door at (${pos().x},${pos().z}) (${why}) — stepping back out with the key`);
    const resolveCloset = () => {
        const c = findClosetDoor();
        if (!c) throw new Error(`closet door lost at (${pos().x},${pos().z}) l${pos().level}`);
        return c;
    };
    // The key-door teleports to a FIXED side (east), so a key-use from the
    // east side prints success without displacing: the real exit is walking
    // west through the opened door. Re-key if the window reverted.
    for (let i = 0; i < 3 && pos().x > 3107; i++) {
        await useOnLocVerified(CLOSET_KEY, /door/i, /open|unlock/i, 'exit closet with key', { resolveLoc: resolveCloset, expectMsg: /you unlock the door|you go through the door/i });
        await bot.walkTo(3106, 3367, 1).catch(() => {});
        await sdk.waitForTicks(2);
        log(`closet exit walk ${i + 1}/3 at (${pos().x},${pos().z})`);
    }
    if (pos().x > 3107) throw new Error(`key-exit left the bot east of the closet at (${pos().x},${pos().z})`);
    log('Back west of the closet door');
}

/**
 * Step east through the open bookcase passage with verified displacement.
 * travelTo no-ops within 3 tiles, which strands the bot west of the revert.
 */
async function stepOutOfSecretPassage(why: string): Promise<void> {
    for (let i = 0; i < 3 && pos().x <= 3096; i++) {
        const w = await bot.walkTo(3098, 3358, 0);
        await sdk.waitForTicks(2);
        log(`secret-room exit step ${i + 1}/3 at (${pos().x},${pos().z}) ok=${w.success} (${why})`);
        if (pos().x <= 3096 && i < 2) {
            if (pos().z > 3359) {
                await bot.walkTo(3098, 3358, 0).catch(() => {});
                await sdk.waitForTicks(2);
            } else {
                await sdk.scanNearbyLocs(14).catch(() => {});
                const lv = (sdk.getNearbyLocs() ?? []).find(l => l.x === 3096 && l.z === 3357);
                if (!lv) break;
                await bot.interactLoc(lv, /pull/i);
                await sdk.waitForTicks(2);
            }
        }
    }
    if (pos().x <= 3096) throw new Error(`secret-room exit shut at (${pos().x},${pos().z}) (${why}) — passage reverted`);
}

/**
 * Step out of the secret-room nook when the bot is west of the bookcase
 * passage. A previous run can leave the bot at the basement ladder top
 * (3092,3361) with the passage reverted: the nook has no static exit, so
 * every travelTo out rams the closed bookcase and BLOCKEDs. Pulling Lever
 * 160 @ (3096,3357) teleports east out ("The lever opens the secret
 * door!"). No-op anywhere else (maze z>=9000 excluded by the z window).
 */
async function exitSecretNookIfInside(why: string): Promise<void> {
    const p = pos();
    if (p.level !== 0 || p.z >= 9000 || p.x > 3096 || p.z < 3340 || p.z > 3380) return;
    log(`Inside the secret-room nook at (${p.x},${p.z}) (${why}) — pulling the exit lever`);
    await travelTo({ x: 3096, z: 3356 }, `secret room lever (${why})`);
    await sdk.scanNearbyLocs(14).catch(() => {});
    const lever = (sdk.getNearbyLocs() ?? []).find(l => l.x === 3096 && l.z === 3357);
    if (!lever) throw new Error(`secret-room exit lever lost at (${pos().x},${pos().z}) l${pos().level}`);
    const r = await bot.interactLoc(lever, /pull/i);
    log(`pull secret-room lever (${why}): ${r.success ? 'ok' : `FAILED ${r.reason ?? ''} ${r.message ?? ''}`}`);
    await sdk.waitForTicks(2);
    // The pull opens the passage briefly (bookcase tiles x3096 z3358/3359):
    // step east THROUGH it now (see stepOutOfSecretPassage).
    await stepOutOfSecretPassage(why);
    log(`Out of the secret nook at (${pos().x},${pos().z})`);
}

// ── 3. Veronica: start the quest, only from the unstarted stage ─────────────
if (STAGE === 'unstarted') {
// Gate BEFORE acting: the quest must really be unstarted, or the dialog below
// acts on an assumption.
if (!(await checkpoint('unstarted', 'quest not yet started'))) {
    throw new Error('unstarted checkpoint failed before starting the quest');
}
await session.setPhase('veronica');
await travelTo(walkableNear(VERONICA), 'Veronica');
const talked = await bot.talkTo(/^veronica$/i);
if (!talked.success) throw new Error(`could not talk to Veronica: ${talked.message ?? '?'}`);
await drainDialog([/sounds like a quest/i], 'veronica-start');
if (!(await checkpoint('started', 'accepted the quest, Ernest sought in the manor'))) {
    throw new Error('started checkpoint failed after talking to Veronica');
}
} else {
    log('Resuming mid-quest: the Veronica start is already journal-confirmed');
}

// ── 4. enter the manor and climb to Oddenstein ───────────────────────────────
// Unstick first: a previous run can leave the bot east of the locked closet
// door (3107,3367), from which NO travelTo can route (the planner masks the
// shut door walkable and rams it). This must precede every travelTo.
await exitClosetIfEast('start');
await exitSecretNookIfInside('start');
await session.setPhase('manor');
// The front door opens from the outside only: approach from the north and let
// walkTo open it, then head up two floors. talkTo walks to the NPC itself, so
// the top-floor travel is implicit once the stairs are climbed.
await travelTo(walkableNear(MANOR_DOOR), 'manor entrance');
await climbTo(2, 'professor oddenstein');

// ── 5. Oddenstein: learn Ernest is a chicken, take the parts request ─────────
const stageNow = await readStage();
if (stageNow === 'started') {
    await session.setPhase('oddenstein');
    const prof = await bot.talkTo(/^professor oddenstein$/i);
    if (!prof.success) throw new Error(`could not talk to Oddenstein: ${prof.message ?? '?'}`);
    // veronica.rs2 handlers switch on the quest varp: unless THIS dialog
    // advances started -> spoken_to_oddenstein, every later step is refused.
    await drainDialog([/looking for a guy called ernest/i, /change him back this instant/i, /better change him back|find them|look out for them/i], 'oddenstein-parts');
    if (!(await checkpoint('parts', 'Oddenstein requested the three machine parts'))) {
        throw new Error('parts checkpoint failed after talking to Oddenstein');
    }
} else {
    log(`Resuming with parts request already journal-confirmed (stage=${stageNow})`);
}

// ── 6. collect the three parts (ground level first, basement last) ──────────
await session.setPhase('parts');
await climbTo(0, 'parts collection');

// Leave via the east wing: the front door cannot be opened from inside and a
// pathfinder routed through it traps the bot in the manor.
log('Leaving the manor via the east-wing escape doors');
for (const door of [ESCAPE_DOOR_1, ESCAPE_DOOR_2]) {
    await travelTo(walkableNear(door), `escape door (${door.x},${door.z})`);
}

// ── 6a. rubber tube: spade -> compost heap -> closet key -> closet ───────────
// A key-use can carry the bot THROUGH the closet door to its east side
// (run 05:25 ended at (3108,3367)); the shut door is unroutable, so step
// back out before anything else. Runs whether or not the tube is already
// carried: a mid-escape death can also leave the bot inside.
await exitClosetIfEast('tube resume');
if (invCount(RUBBER_TUBE) === 0) {
    await session.setPhase('tube');
    if (invCount(CLOSET_KEY) === 0) {
        if (invCount(/^spade$/i) === 0) throw new Error('no spade for the compost heap — bank leg failed');
        await travelTo(walkableNear(COMPOST_HEAP), 'compost heap');
        const heap = sdk.findNearbyLoc(/compost heap/i, { withOption: /search|dig/i });
        if (!heap) throw new Error(`no compost heap visible at (${pos().x},${pos().z}) l${pos().level}`);
        await useOnLocVerified(/^spade$/i, /compost heap/i, /search|dig/i, 'dig compost for closet key', { eastFirst: true });
        if (invCount(CLOSET_KEY) === 0) throw new Error('dug the compost heap but found no key');
        log('Closet key in bag');
    } else {
        log('Closet key already carried');
    }
    // The locked closet is behind the ground-floor staircase: re-enter from
    // the outside, then use the key on the closet door.
    await travelTo(walkableNear(MANOR_DOOR), 'manor entrance (closet)');
    await enterManor('closet');
    // The closet door's display name is "Door" (loc closet_door, type id 131)
    // at (3107,3367) behind the ground-floor staircase — a /closet/ name
    // regex can never match it, which threw "no closet door visible" three
    // runs in a row. Probe-identified 2026-10-18: plain Open on this exact
    // door replies "The door is locked.", and loc.pack maps 131=closet_door.
    // Resolve by coordinates, never by name (see findClosetDoor).
    // A previous run may have left the door open (window): the open door
    // offers no Open/Unlock option, so resolve by door state first. A closed
    // door always takes the key (the unlock teleports inside — idempotent).
    // Tube visibility alone proves nothing: scans see through the wall.
    await travelTo({ x: 3107, z: 3366 }, 'closet door');
    const closet = findClosetDoor();
    if (closet) {
        // Stand south of the door, never ON its tile: walkTo parks on the loc
        // tile and the use then times out from inside the footprint (run 05:25).
        const resolveCloset = () => {
            const c = findClosetDoor();
            if (!c) throw new Error(`closet door lost at (${pos().x},${pos().z}) l${pos().level}`);
            return c;
        };
        await useOnLocVerified(CLOSET_KEY, /door/i, /open|unlock/i, 'unlock closet with key', { resolveLoc: resolveCloset, expectMsg: /you unlock the door/i });
    } else {
        await sdk.scanGroundItems(12).catch(() => {});
        const tubeSeen = (sdk.getGroundItems() ?? []).some(i => RUBBER_TUBE.test(i.name));
        if (!tubeSeen) throw new Error(`no closet door visible at (${pos().x},${pos().z}) l${pos().level} and no tube in sight`);
        log('closet already open with the tube visible — skipping the key');
    }
    await pickupVerified(RUBBER_TUBE, 'rubber tube');
    // The unlock can leave the bot east of the door (tube room side) — step
    // back out before the escape legs, which cannot route through it.
    await exitClosetIfEast('post-unlock');
    await climbTo(0, 'tube exit');
    log('Leaving the manor via the east-wing escape doors (tube done)');
    for (const door of [ESCAPE_DOOR_1, ESCAPE_DOOR_2]) {
        await travelTo(walkableNear(door), `escape door (${door.x},${door.z})`);
    }
} else {
    log('Rubber tube already carried');
}

// ── 6b. pressure gauge: poison + fish food -> fountain -> search ─────────────
if (invCount(PRESSURE_GAUGE) === 0) {
    await session.setPhase('gauge');
    // Both are ground spawns inside the manor (ground floor): pick up by name
    // — pickupItem walks there itself — and verify each lands in the bag.
    await travelTo(walkableNear(MANOR_DOOR), 'manor entrance (fish food)');
    await enterManor('fish food');
    await pickupVerified(POISON, 'poison');
    // Fish food spawns on level 1 (Fish food@(3108,3356), upper sweep
    // 2026-10-18) — the ground floor has no spawn, so pickupVerified fails
    // there every time. Climb, grab, descend.
    await climbTo(1, 'fish food');
    await pickupVerified(FISH_FOOD, 'fish food');
    await climbTo(0, 'fish food down');
    if (invCount(POISONED_FOOD) === 0) {
        // A resume after a successful poisoning holds neither the poisoned
        // food (spent) nor the ingredients (consumed) — the fountain flag is
        // already set server-side, so go straight to the Search.
        if (invCount(POISON) > 0 && invCount(FISH_FOOD) > 0) {
        const poisonItem = sdk.findInventoryItem(POISON);
        const foodItem = sdk.findInventoryItem(FISH_FOOD);
        if (!poisonItem || !foodItem) throw new Error('poison + fish food not both in the bag for combining');
        const use = await sdk.sendUseItemOnItem(poisonItem.slot, foodItem.slot);
        log(`combine poison + fish food: ${use.success ? 'ok' : `FAILED ${use.message ?? '?'}`}`);
        await sdk.waitForTicks(3);
        if (invCount(POISONED_FOOD) === 0) throw new Error('combined poison + fish food but no poisoned fish food appeared');
        log('Poisoned fish food in bag');
        session.log('log', 'made poisoned fish food');
        } else {
            log('No poisoned food and no ingredients — fountain already poisoned on an earlier run, going straight to search');
        }
    } else {
        log('Poisoned fish food already carried');
    }
    // The fountain is NOT in the east garden: map data (l48_52) places
    // hauntedfountain (type id 153) at (3087,3334), south-west of the manor
    // (probe-verified 2026-10-18: "Fountain" id=153 opts=[Search]). Travel
    // there first — resolving from the escape doors sees nothing (run 05:50).
    log('Leaving the manor via the east-wing escape doors (fountain)');
    for (const door of [ESCAPE_DOOR_1, ESCAPE_DOOR_2]) {
        await travelTo(walkableNear(door), `escape door (${door.x},${door.z})`);
    }
    await travelTo({ x: 3087, z: 3337 }, 'fountain');
    const fountain = sdk.findNearbyLoc(/fountain/i, { withOption: /search/i });
    if (!fountain) throw new Error(`no fountain visible at (${pos().x},${pos().z}) l${pos().level}`);
    await travelTo({ x: fountain.x, z: fountain.z }, 'fountain');
    await useOnLocVerified(POISONED_FOOD, /fountain/i, /search/i, 'poison fountain piranhas');
    // The piranha kill chain runs on server delays AFTER the use returns
    // (pour -> eating -> "... then die", flag set last). Searching before the
    // final line runs the unpoisoned branch (bite, no gauge), and a search
    // whose waiter times out can also land server-side late — so settle on
    // the flag's own message (bounded; an old poisoning has scrolled past,
    // in which case the flag is long set), then search with per-attempt
    // verification instead of one blind click.
    try {
        await sdk.waitForCondition(
            s => (((s as unknown as { gameMessages?: { text: string }[] })?.gameMessages ?? []).some(m => /then die and float to the surface/i.test(m.text))),
            90_000,
        );
        log('piranhas dead — fountain flag set, searching');
    } catch {
        log('die message not seen (old poisoning, flag long set) — searching anyway');
    }
    await sdk.waitForTicks(3);
    for (let attempt = 0; attempt < 3 && invCount(PRESSURE_GAUGE) === 0; attempt++) {
        // Rescan before every Search: a stale-distance entity makes
        // interactLoc's internal walkTo re-path to the blocked tile and time
        // out mid-walk (fountain runs 06:15/06:21).
        await sdk.scanNearbyLocs(12).catch(() => {});
        const search = await bot.interactLoc(await resolveLocOrThrow(/fountain/i, /search/i, 'search fountain for gauge'), /search/i);
        log(`search fountain ${attempt + 1}/3: ${search.success ? 'ok' : `FAILED ${search.reason ?? ''} ${search.message ?? ''}`}`);
        await sdk.waitForTicks(5);
    }
    await sdk.waitForTicks(3);
    if (invCount(PRESSURE_GAUGE) === 0) throw new Error('searched the poisoned fountain but found no pressure gauge');
    log('Pressure gauge in bag');
} else {
    log('Pressure gauge already carried');
}

// ── 6c. oil can: basement lever maze ─────────────────────────────────────────
// ENTRY (probe-verified 2026-10-18): puzzle_ladder_top ("Ladder",
// Climb-down, type id 133) @ (3092,3362) sits in a nook with NO static door
// — every direct approach cant_reachs. Entry is the SECRET BOOKCASE DOOR:
// Search Bookcase 155/156 @ (3097,3358/3359) from the east face (3098,3358)
// prints "You've found a secret door!" and teleports the bot to (3096,3358),
// from which the ladder is reachable. EXIT mirrors it: pull Lever 160 @
// (3096,3357) ("The lever opens the secret door!") teleports back east.
// The passage reverts after minutes, so entry AND exit go through these
// teleports — never assume the passage is still open.
// The crypt stairs (3115,3357 -> crypt (3077,9771)) are a DEAD END: coffin
// + med helm, no levers, no oil can (probed same day).
// MAZE (square 48_152, l48_152 decode + loc.sym 137-145 + collision map):
// levers A(3108,9745) B(3118,9752) C(3112,9760) D(3108,9767) E(3097,9767)
// F(3096,9765); wiki doors 1=4to7(3108,9758) 2=4to5(3105,9760)
// 3=5to8(3102,9758) 4=5to6(3100,9760) 5=3to6(3097,9763) 6=2to3(3100,9765)
// 7=1to2(3105,9765) 8=2to5(3102,9763) 9=8to9(3100,9755); oil can ground
// spawn @ (3092,9755) (far west room past door 9). Solved in OSRS Wiki
// order with per-door lever ensures + far-room arrival verification;
// the east side (C+D) and the south (S) are open floor.
if (invCount(OIL_CAN) === 0) {
    await session.setPhase('oil-can');
    await travelTo(walkableNear(MANOR_DOOR), 'manor entrance (basement)');
    await enterManor('basement');
    // Secret bookcase entry (or already inside): the ladder nook has no
    // static door, so check whether the down ladder is already reachable;
    // otherwise Search a bookcase from the east face, which teleports
    // through ("You've found a secret door!").
    await sdk.scanNearbyLocs(14).catch(() => {});
    const ladderSeen = (sdk.getNearbyLocs() ?? []).find(l =>
        /ladder/i.test(l.name) && l.optionsWithIndex.some(o => /climb-down/i.test(o.text)));
    const ladderOpen = !!ladderSeen
        && (ladderSeen as unknown as { reachable?: boolean }).reachable !== false
        && pos().x <= 3096;
    if (!ladderOpen) {
        await travelTo({ x: 3098, z: 3358 }, 'bookcase east face');
        await sdk.scanNearbyLocs(14).catch(() => {});
        const bc = (sdk.getNearbyLocs() ?? [])
            .filter(l => /bookcase/i.test(l.name) && l.optionsWithIndex.some(o => /search/i.test(o.text)))
            .sort((a, b) => (a.distance ?? 99) - (b.distance ?? 99))[0];
        if (!bc) throw new Error(`no searchable bookcase at (${pos().x},${pos().z}) l${pos().level} for the secret door`);
        const rs = await bot.interactLoc(bc, /search/i);
        log(`search bookcase for secret door: ${rs.success ? 'ok' : `FAILED ${rs.reason ?? ''} ${rs.message ?? ''}`}`);
        await sdk.waitForTicks(5);
        const doorMsg = recentMsgs(/secret door/i, 4);
        if (pos().x > 3096 && doorMsg.length === 0) {
            throw new Error(`bookcase search at (${pos().x},${pos().z}) showed no secret door — entry failed`);
        }
        log(`through secret door at (${pos().x},${pos().z})${doorMsg.length ? ` (${doorMsg[doorMsg.length - 1]})` : ''}`);
    } else {
        log(`secret passage already open at (${pos().x},${pos().z}) — skipping bookcase search`);
    }
    await travelTo({ x: 3091, z: 3362 }, 'basement ladder');
    await sdk.scanNearbyLocs(14).catch(() => {});
    const ladderTop = (sdk.getNearbyLocs() ?? []).find(l => l.x === 3092 && l.z === 3362);
    if (!ladderTop) throw new Error(`no down ladder visible at (${pos().x},${pos().z}) l${pos().level}`);
    const down = await bot.interactLoc(ladderTop, /climb-down/i);
    log(`descend to basement: ${down.success ? 'ok' : `FAILED ${down.reason ?? ''} ${down.message ?? ''}`}`);
    await sdk.waitForTicks(5);
    // climb_ladder teleports to map square 48_152 (landing ~(3116,9754)).
    // The maze below must never run on the wrong floor: run 06:32 descended
    // nowhere and spent 64 steps yanking east-wing doors 30 tiles off.
    if (pos().z < 9000) throw new Error(`descend reported ${down.success ? 'ok' : 'failure'} but still at (${pos().x},${pos().z}) l${pos().level} — refusing to maze the manor`);

    // Wiki-order closed-loop solve (OSRS Wiki "Oil can" steps, verified
    // against quest_haunted.rs2 _haunted_door: lever bit N DOWN opens —
    // A=0 B=1 C=2 D=3 E=4 F=5, inspect "up" <=> bit clear):
    //   B,A DOWN; door 1 =4to7; D DOWN; doors 2 =4to5, 3 =5to8;
    //   B,A UP; doors 3 =5to8, 4 =5to6, 5 =3to6; E,F DOWN;
    //   doors 6 =2to3, 7 =1to2; C DOWN; doors 7, 6; E UP;
    //   doors 6, 8 =2to5, 3; door 9 =8to9; can @ (3092,9755).
    // Wiki# -> loc coords from the l48_152 decode (loc.sym 137-145);
    // every pattern re-derived from the rs2 above (the endgame 2to5/5to8
    // alt clauses match the post-E-up state exactly). The east side
    // (rooms 1+4, C+D levers) is open floor — no divider — and the south
    // (S) is open from south-central to the ladder room.
    // Door 1 is the canary: it needs A,B DOWN with C,D,E,F UP, so it only
    // opens from a clean all-UP baseline. Lever bits persist across runs
    // until the ascent/teleport reset fires, so a canary failure means a
    // prior mid-maze session left stray DOWNs — recover to the ladder,
    // ascend (reset), descend, and restart the solve once.
    log(`In the lever maze at (${pos().x},${pos().z})`);
    for (let mazeAttempt = 0; mazeAttempt < 2; mazeAttempt++) {
        try {
            // -- B,A DOWN; door 1 (landing -> east-mid) --
            await openMazeDoorBox(MAZE_DOORS.d1, 'door 1', { x: 3110, z: 9758 }, { x: 3106, z: 9760 }, ROOM4, [['A', 'down'], ['B', 'down']], 'landing to east-mid');
            // -- D DOWN; doors 2 (east-mid -> lower-mid), 3 (lower-mid -> south-central) --
            await openMazeDoorBox(MAZE_DOORS.d2, 'door 2', { x: 3107, z: 9760 }, { x: 3103, z: 9760 }, ROOM5, [['D', 'down']], 'east-mid to lower-mid');
            await openMazeDoorBox(MAZE_DOORS.d3, 'door 3 south', { x: 3102, z: 9760 }, { x: 3102, z: 9756 }, ROOM8, [], 'lower-mid to south-central');
            // -- B,A UP happens in the south while S2 still holds: 5to8 +
            // 4to5 re-open pattern-satisfied; 4to7's pattern broke with D,
            // so its live window is crossed RAW (no clicks).
            await openMazeDoorBox(MAZE_DOORS.d3, 'door 3 north (return)', { x: 3102, z: 9756 }, { x: 3102, z: 9761 }, ROOM5, [], 'return for B,A up');
            await openMazeDoorBox(MAZE_DOORS.d2, 'door 2 east (return)', { x: 3103, z: 9760 }, { x: 3107, z: 9760 }, ROOM4, [], 'return for B,A up');
            await rawMazeWalkTo(3111, 9758, '4to7 window east (return)');
            if (pos().x < 3108) {
                log('maze return: 4to7 window shut — recovering via rooms to reset');
                await openMazeDoorBox(MAZE_DOORS.d2, 'door 2 west (recover)', { x: 3107, z: 9760 }, { x: 3103, z: 9760 }, ROOM5, [], 'window-shut recovery');
                await openMazeDoorBox(MAZE_DOORS.d3, 'door 3 south (recover)', { x: 3102, z: 9760 }, { x: 3102, z: 9756 }, ROOM8, [], 'window-shut recovery');
                await mazeWalkTo(3110, 9755, 'ladder room (recover)');
                await mazeWalkTo(3116, 9754, 'ladder (recover)');
                throw new Error('MAZE-RESTART 4to7 window shut, recovered to ladder');
            }
            await setMazeLever('B', 'up', 'wiki B up');
            await setMazeLever('A', 'up', 'wiki A up');
            // -- doors 3 (south-central -> lower-mid), 4 (-> lower-west), 5 (-> enclosure) --
            await openMazeDoorBox(MAZE_DOORS.d3, 'door 3 north', { x: 3102, z: 9756 }, { x: 3102, z: 9761 }, ROOM5, [], 'south-central to lower-mid');
            await openMazeDoorBox(MAZE_DOORS.d4, 'door 4', { x: 3102, z: 9760 }, { x: 3098, z: 9760 }, ROOM6, [], 'lower-mid to lower-west');
            await openMazeDoorBox(MAZE_DOORS.d5, 'door 5', { x: 3097, z: 9761 }, { x: 3097, z: 9765 }, ENCL, [], 'lower-west to enclosure');
            // -- E,F DOWN (in-enclosure); doors 6 (-> upper-mid), 7 (-> upper-east) --
            await openMazeDoorBox(MAZE_DOORS.d6, 'door 6 east', { x: 3098, z: 9765 }, { x: 3102, z: 9765 }, ROOM2, [['E', 'down'], ['F', 'down']], 'enclosure to upper-mid');
            await openMazeDoorBox(MAZE_DOORS.d7, 'door 7 east', { x: 3103, z: 9765 }, { x: 3107, z: 9765 }, ROOM1, [], 'upper-mid to upper-east');
            // -- C DOWN (east side open floor); doors 7, 6 back --
            await openMazeDoorBox(MAZE_DOORS.d7, 'door 7 west', { x: 3107, z: 9765 }, { x: 3103, z: 9765 }, ROOM2, [['C', 'down']], 'upper-east to upper-mid');
            await openMazeDoorBox(MAZE_DOORS.d6, 'door 6 west', { x: 3102, z: 9765 }, { x: 3098, z: 9765 }, ENCL, [], 'upper-mid to enclosure');
            // -- E UP (in-enclosure); doors 6, 8 (-> lower-mid), 3 (-> south-central) --
            await openMazeDoorBox(MAZE_DOORS.d6, 'door 6 east again', { x: 3098, z: 9765 }, { x: 3102, z: 9765 }, ROOM2, [['E', 'up']], 'enclosure to upper-mid');
            await openMazeDoorBox(MAZE_DOORS.d8, 'door 8', { x: 3102, z: 9765 }, { x: 3102, z: 9761 }, ROOM5, [], 'upper-mid to lower-mid');
            await openMazeDoorBox(MAZE_DOORS.d3, 'door 3 south again', { x: 3102, z: 9760 }, { x: 3102, z: 9756 }, ROOM8, [], 'lower-mid to south-central');
            // -- door 9 (-> oil-can room); grab the can --
            await openMazeDoorBox(MAZE_DOORS.d9, 'door 9', { x: 3102, z: 9755 }, { x: 3098, z: 9755 }, ROOM9, [], 'south-central to oil-can room');
            await mazeWalkTo(3092, 9755, 'oil can');
            await pickupVerified(OIL_CAN, 'oil can');
            log('Oil can in bag');
            session.log('log', 'recovered oil can from basement (wiki order)');
            // Exit: 8to9 is still S6-satisfied (E up, F down); the south is
            // open floor from south-central to the ladder room — no doors.
            await openMazeDoorBox(MAZE_DOORS.d9, 'door 9 east (exit)', { x: 3098, z: 9755 }, { x: 3102, z: 9755 }, ROOM8, [], 'oil-can room exit');
            await mazeWalkTo(3110, 9756, 'ladder room (exit)');
            await mazeWalkTo(3116, 9754, 'maze exit');
            break;
        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            const atLadder = Math.hypot(pos().x - 3116, pos().z - 9754) <= 4 && pos().z >= 9000;
            if (mazeAttempt === 0 && /MAZE-RESTART|door 1.*never opened/i.test(msg) && atLadder) {
                log(`maze solve attempt 1 failed (${msg}) — ascending to reset lever bits and restarting once`);
                await sdk.scanNearbyLocs(16).catch(() => {});
                const ladderReset = (sdk.getNearbyLocs() ?? []).find(l => l.x === 3117 && l.z === 9754);
                if (!ladderReset) throw new Error(`maze reset: no up ladder at (${pos().x},${pos().z}) after: ${msg}`);
                const resetUp = await bot.interactLoc(ladderReset, /climb-up|climb up/i);
                log(`maze reset ascend: ${resetUp.success ? 'ok' : `FAILED ${resetUp.reason ?? ''} ${resetUp.message ?? ''}`}`);
                await sdk.waitForTicks(5);
                if (pos().z >= 9000) throw new Error(`maze reset ascend failed at (${pos().x},${pos().z}) after: ${msg}`);
                await travelTo({ x: 3091, z: 3362 }, 'basement ladder (retry)');
                await sdk.scanNearbyLocs(14).catch(() => {});
                const ladderRetry = (sdk.getNearbyLocs() ?? []).find(l => l.x === 3092 && l.z === 3362);
                if (!ladderRetry) throw new Error(`maze reset: no down ladder at (${pos().x},${pos().z}) after: ${msg}`);
                const resetDown = await bot.interactLoc(ladderRetry, /climb-down/i);
                log(`maze reset descend: ${resetDown.success ? 'ok' : `FAILED ${resetDown.reason ?? ''} ${resetDown.message ?? ''}`}`);
                await sdk.waitForTicks(5);
                if (pos().z < 9000) throw new Error(`maze reset descend failed at (${pos().x},${pos().z}) after: ${msg}`);
                log(`maze reset: back in the maze at (${pos().x},${pos().z}), restarting solve`);
                continue;
            }
            throw e;
        }
    }
    await sdk.scanNearbyLocs(16).catch(() => {});
    const ladderUp = (sdk.getNearbyLocs() ?? []).find(l => l.x === 3117 && l.z === 9754);
    if (!ladderUp) throw new Error(`no up ladder visible at (${pos().x},${pos().z}) l${pos().level}`);
    const up = await bot.interactLoc(ladderUp, /climb-up|climb up/i);
    log(`ascend from basement: ${up.success ? 'ok' : `FAILED ${up.reason ?? ''} ${up.message ?? ''}`}`);
    await sdk.waitForTicks(5);
    if (pos().z >= 9000) throw new Error(`ascend reported ${up.success ? 'ok' : 'failure'} but still at (${pos().x},${pos().z}) — still in the maze`);
    log(`Back in the manor at (${pos().x},${pos().z})`);
    // The ascent lands inside the secret room, whose bookcase passage has
    // usually reverted by now: pull Lever 160 (teleports east out).
    await sdk.scanNearbyLocs(14).catch(() => {});
    const roomLever = (sdk.getNearbyLocs() ?? []).find(l => l.x === 3096 && l.z === 3357);
    if (roomLever && pos().x <= 3096) {
        if ((roomLever.distance ?? 99) > 3) await travelTo({ x: 3096, z: 3356 }, 'secret room lever');
        await sdk.scanNearbyLocs(14).catch(() => {});
        const liveLever = (sdk.getNearbyLocs() ?? []).find(l => l.x === 3096 && l.z === 3357) ?? roomLever;
        const leverPull = await bot.interactLoc(liveLever, /pull/i);
        log(`pull secret-room lever: ${leverPull.success ? 'ok' : `FAILED ${leverPull.reason ?? ''} ${leverPull.message ?? ''}`}`);
        await sdk.waitForTicks(5);
    }
    if (pos().x <= 3096) {
        // Lever exit didn't displace (passage still open?) — step out east
        // with verified displacement, never travelTo (no-ops within 3).
        await stepOutOfSecretPassage('post-ascent');
    }
    log(`Out of the secret room at (${pos().x},${pos().z})`);
    // Leave via the east wing so the hand-in legs below start clean.
    for (const door of [ESCAPE_DOOR_1, ESCAPE_DOOR_2]) {
        await travelTo(walkableNear(door), `escape door (${door.x},${door.z})`);
    }
} else {
    log('Oil can already carried');
}

// ── 7. hand in: all three parts to Oddenstein ────────────────────────────────
await session.setPhase('hand-in');
// Fresh parts PASS with the current tile: on a resume the pre-hand-in
// journal still carries the parts request, so re-affirm it for the record.
if (!(await checkpoint('parts', 'all three parts held, ready to hand in'))) {
    throw new Error('parts checkpoint failed before handing in');
}
for (const need of [
    { re: OIL_CAN, name: 'oil can' },
    { re: PRESSURE_GAUGE, name: 'pressure gauge' },
    { re: RUBBER_TUBE, name: 'rubber tube' },
]) {
    if (invCount(need.re) === 0) throw new Error(`cannot hand in: ${need.name} missing from the bag`);
}
log(`Hand-in bag: oil can x${invCount(OIL_CAN)} gauge x${invCount(PRESSURE_GAUGE)} tube x${invCount(RUBBER_TUBE)}`);
await travelTo(walkableNear(MANOR_DOOR), 'manor entrance (hand-in)');
await climbTo(2, 'oddenstein hand-in');
const hand = await bot.talkTo(/^professor oddenstein$/i);
if (!hand.success) throw new Error(`could not talk to Oddenstein to hand in: ${hand.message ?? '?'}`);
// The hand-in plays out through chat/mes lines once the items are held — drain
// fully so the server reaches the stage-advance line.
await drainDialog([/i have everything/i, /give 'em here/i], 'oddenstein-hand-in');
await bot.dismissBlockingUI();
// The quest completes on server delays AFTER the dialog closes (if_close,
// then mes lines on p_delay 1+2+2+1, then Ernest's chats): a single journal
// sample races the completion and fails falsely. Poll for the journal flip
// while clicking through Ernest's chats instead.
let handedIn = false;
for (let i = 0; i < 30 && !handedIn; i++) {
    const dialog = sdk.getDialog();
    if (dialog?.isOpen) {
        const options = dialog.options ?? [];
        if (options.length === 0) {
            await sdk.sendClickDialog(0).catch(() => {});
        } else {
            log(`hand-in poll: unexpected options [${options.map(o => JSON.stringify(o.text)).join(' | ')}] — waiting, not blind-picking`);
        }
        await sdk.waitForTicks(2);
        continue;
    }
    await sdk.waitForTicks(4);
    await awaitQuestTab('hand-in poll');
    const read = await readJournalCheckpoint(sdk, JOURNAL, RULES.complete!);
    handedIn = read.verdict?.verdict === 'PASS';
    if (!handedIn && i % 3 === 0) log(`hand-in poll ${i + 1}/30: not complete yet (${read.reason})`);
}
if (!handedIn) throw new Error('hand-in dialog drained but the journal never flipped to COMPLETE');

// ── 8. completion is proven by the journal, never by XP or a chat line ──────
await session.setPhase('verify');
if (!(await checkpoint('complete', 'journal reports QUEST COMPLETE'))) {
    throw new Error('completion checkpoint failed: journal does not report the quest complete');
}

session.log('log', 'Ernest the Chicken verified complete');
session.noteProgress('inventory', 'quest complete (journal-verified)');
const summary = summarizeRun(run.directory);
if (!summary.ok) {
    // Every declared checkpoint must carry a PASS before this counts as done.
    throw new Error(`promotion gate failed: missing/unpassed ${JSON.stringify(summary.missing)}`);
}
log(`Run record verified: ${summary.ok} (${summary.missing.length} outstanding)`);
log(`DONE Ernest the Chicken verified via journal at (${pos().x},${pos().z})`);
log(`Metrics: ${JSON.stringify(session.metrics())}`);

sdk.disconnect();
process.exit(0);
