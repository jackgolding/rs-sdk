/**
 * Imp Catcher — replayable, checkpoint-gated.
 *
 *   bun bots/quests/imp-catcher.ts qlimp2
 *
 * Banks at Draynor, climbs to Mizgog on the top floor of the Wizards' Tower,
 * takes the quest, kills Imps until the four beads are held, then returns to
 * Mizgog and hands them over for the Amulet of Accuracy.
 *
 * Every step that matters is gated on QUEST JOURNAL evidence, never on XP,
 * chat or a successful packet. The journal is the only client-visible record
 * of quest state: the `%imp` varp is not exposed, so it is the portable
 * checkpoint channel.
 *
 * Route and plane handling:
 *   - waypoints computed offline from the repo's collision data
 *     (`findLongPath`), single plane per leg, ~10-tile spacing
 *   - each leg is walked one waypoint at a time with displacement verified;
 *     a leg that moves nothing is an obstacle, not something to retry
 *   - `bot.walkTo`/`talkTo` open blocking doors; tower stairs are climbed
 *     with explicit climb-up/climb-down loc interactions, each followed by
 *     a settle (ticks) plus a rescan of NPCs from fresh state — entity
 *     listings go stale across a teleport/plane change
 */
import { existsSync, readFileSync, appendFileSync } from 'fs';
import { dirname, join } from 'path';

import { BotSDK, Machine, deriveGatewayUrl } from '../../sdk/index';
import { BotActions } from '../../sdk/actions';
import { initPathfinding, findLongPath, isTileWalkable } from '../../sdk/pathfinding';
import { ActivitySession } from '../../sdk/activity';
import { readJournalCheckpoint } from '../../quest-lab/journal-reader';
import { createRun, appendCheckpoint, summarizeRun, safeRunId } from '../../quest-lab/records';
import type { JournalRule } from '../../quest-lab/evidence';
import { graph, type ImpCtx, type ImpStage } from './imp-catcher.graph';

// ── args / env ──────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const botArg = argv.find(a => !a.startsWith('-'));
const envPath = botArg
    ? join(process.cwd(), 'bots', botArg, 'bot.env')
    : join(dirname(import.meta.path), 'bot.env');
if (!existsSync(envPath)) throw new Error(`bot.env not found at ${envPath}. Usage: bun bots/quests/imp-catcher.ts <botname>`);
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
const DRAYNOR_BANK = { x: 3082, z: 3242 };
// NOTE: (3108,3160) is the door loc itself and is NOT walkable — the planner
// ends the route at (3109,3160), and bot.walkTo measures arrival in Chebyshev
// tiles, so aiming at the wall tile made the final leg a no-op success the
// script then misread as BLOCKED (dev run qlimp1 at 3111,3163: chebyshev 3,
// euclidean 3.6). Aim at the walkable tile outside the door.
const TOWER_DOOR = { x: 3109, z: 3160 };
const MIZGOG = { x: 3104, z: 3163, level: 2 };
/** Walkable tile inside the tower ground floor (verified against collision). */
const TOWER_INTERIOR = { x: 3105, z: 3161 };
/** Imp hunting ground: open field south of the Wizards' Tower. */
const IMP_CAMP = { x: 3108, z: 3154 };
const HUNT_RADIUS = 30;
const FOOD_RE = /trout|salmon|tuna|swordfish|shark|lobster|bread|cooked meat|stew|shrimp|anchovies|sardine/i;
const FOOD_WITHDRAW = 5;

const BEADS = [
    { name: 'black_bead', pattern: /^black bead$/i },
    { name: 'red_bead', pattern: /^red bead$/i },
    { name: 'white_bead', pattern: /^white bead$/i },
    { name: 'yellow_bead', pattern: /^yellow bead$/i },
];
const IMP = /^imp$/i;

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

/** Somewhere beside Mizgog that can actually be stood on. */
function mizgogApproach(): { x: number; z: number } {
    for (const cand of [{ x: 3104, z: 3164 }, { x: 3103, z: 3163 }, { x: 3105, z: 3163 }, { x: 3104, z: 3162 }]) {
        if (isTileWalkable(2, cand.x, cand.z)) return cand;
    }
    return { x: 3104, z: 3164 };
}

const JOURNAL = { label: 'Imp Catcher', title: 'Imp Catcher' };

// Journal rules, read from the quest's own journal script
// (server/content/scripts/quests/quest_imp/scripts/imp_journal.rs2):
//   not_started (L5) -> "I can start this quest by talking to Wizard Mizgog
//     in the Wizards' Tower."
//   started (L8) -> "I have spoken to Wizard Mizgog." plus the 4-bead
//     checklist (L14-36), or "I have collected all the missing beads ..."
//     once every bead is held (L11)
//   complete (L39) -> "... an Amulet of Accuracy.|QUEST COMPLETE!"
// The complete text repeats "I have spoken to Wizard Mizgog.", so the active
// rule excludes QUEST COMPLETE via `none`.
const RULES: Record<string, JournalRule> = {
    unstarted: { id: 'imp:unstarted', kind: 'unstarted', all: ['I can start this quest by talking to Wizard Mizgog'] },
    active: { id: 'imp:active', kind: 'active', all: ['I have spoken to Wizard Mizgog'], none: ['QUEST COMPLETE'] },
    complete: { id: 'imp:complete', kind: 'complete', all: ['QUEST COMPLETE', 'Amulet of Accuracy'] },
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
    name: 'imp catcher',
    grindLogPath: GRIND_LOG,
    maxRecoveryTactics: 8,
});
const intent = (msg: string) => { void session.showIntent(msg); };

await session.setPhase('start');

const pos = () => {
    const p = sdk.getState()?.player;
    return {
        x: p?.worldX ?? 0, z: p?.worldZ ?? 0, level: p?.level ?? 0,
        hp: p?.hp ?? 10, maxHp: p?.maxHp ?? 10, inCombat: p?.combat?.inCombat ?? false,
    };
};
const distTo = (t: { x: number; z: number }) => Math.hypot(pos().x - t.x, pos().z - t.z);
/**
 * Chebyshev tiles — the same metric bot.walkTo uses for its arrival tolerance
 * (sdk/actions-helpers.ts). A waypoint inside walkTo's tolerance is a no-op
 * success ('Already at destination'), so the per-leg gate must agree with it:
 * comparing euclidean here declared a no-op leg BLOCKED instead of arrived.
 */
const chebTo = (t: { x: number; z: number }) => Math.max(Math.abs(pos().x - t.x), Math.abs(pos().z - t.z));
const invCount = (pattern: RegExp) =>
    sdk.getInventory().filter(i => pattern.test(i.name)).reduce((n, i) => n + (i.count ?? 1), 0);
const beadCount = () => BEADS.filter(b => invCount(b.pattern) > 0).length;
const hasAllBeads = () => BEADS.every(b => invCount(b.pattern) > 0);
const foodCount = () => invCount(FOOD_RE);

// ── durable run record ──────────────────────────────────────────────────────
// Checkpoint evidence is written verbatim as the run proceeds, so an audit does
// not depend on the script's own stdout or on telemetry that sampling truncates.
const MODE = process.env.QUEST_LAB_MODE === 'staging' ? 'staging' : 'development';
const run = createRun(join(process.cwd(), 'quest-lab', 'runs'), safeRunId('imp', username, new Date().toISOString()), {
    questId: 'imp',
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

// ── 1. what stage is this account actually at? ──────────────────────────────
// Read the journal BEFORE banking. A finished quest has nothing left to do, and
// a bot resumed mid-quest should bank only for what it still lacks. Banking
// first made a completed quest report "insufficient stock" instead of "already
// complete" — and walked to Draynor to do it.
await session.setPhase('inspect');

/** The first stage rule that PASSes is the account's real stage. */
async function readStage(): Promise<'unstarted' | 'active' | 'complete' | 'unknown'> {
    for (const name of ['complete', 'active', 'unstarted'] as const) {
        const read = await readJournalCheckpoint(sdk, JOURNAL, RULES[name]!);
        log(`  stage probe ${name}: ${read.verdict?.verdict ?? 'UNKNOWN'} (${read.reason})`);
        if (read.verdict?.verdict === 'PASS') return name;
    }
    return 'unknown';
}

// The decision that follows lives in `imp-catcher.graph.ts` (`inspect`), not
// here: this file supplies the probe, the graph routes on the answer.

/**
 * Deposit carry-over (never the beads — they are the quest), then top up food.
 * Food is opportunistic, never mandatory: imps are level 2 and the fallback
 * refills mid-hunt, so an empty food stock warns instead of idling the run.
 */
async function bankForSupplies(): Promise<void> {
    // A bot may be anywhere on restart (mid-quest, or left by an earlier leg), so
    // travel to the bank first rather than assuming the start tile.
    if (distTo(DRAYNOR_BANK) > 8) await travelTo(DRAYNOR_BANK, 'Draynor bank');

    const keep = (name: string) => BEADS.some(b => b.pattern.test(name)) || FOOD_RE.test(name);
    const junk = sdk.getInventory().filter(i => (i.count ?? 0) > 0 && !keep(i.name));
    if (junk.length > 0) {
        log(`Depositing ${junk.length} carried stack(s) before withdrawing`);
        if (!(await bot.openBank()).success) throw new Error(`could not open bank at ${pos().x},${pos().z}`);
        for (const item of junk) await bot.depositItem(item, -1);
        session.noteProgress('bank', 'deposited carry-over inventory');
    }

    // Pre-check stock before the first withdraw: read the bank once, then act.
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
    const bankFood = bankItems.filter(i => FOOD_RE.test(i.name)).reduce((n, i) => n + (i.count ?? 0), 0);
    log(`Stock pre-check: food inv=${foodCount()} bank=${bankFood} beads=${beadCount()}/4`);
    if (foodCount() === 0 && bankFood === 0) {
        log('No food stocked anywhere — proceeding without (imps are level 2); fallback refills if stock appears');
        session.log('warn', 'no food in inventory or bank; hunting without');
    } else if (foodCount() < FOOD_WITHDRAW && bankFood > 0) {
        // The interface can drop between the open check and the withdraw.
        if (!sdk.getState()?.bank?.isOpen && !(await bot.openBank()).success) {
            throw new Error('bank closed before withdrawing food');
        }
        const res = await bot.withdrawItem(FOOD_RE, Math.min(FOOD_WITHDRAW - foodCount(), bankFood));
        log(`withdrew food: ${res.success}${res.success ? '' : ` (${res.message ?? '?'})`}`);
        if (res.success) session.noteProgress('bank', `withdrew food (now ${foodCount()})`);
    }
    await bot.closeInterface();
    log(`Bag: foodx${foodCount()} beads=${beadCount()}/4`);
}

// ── world helpers (unchanged by the conversion) ─────────────────────────────
async function travelTo(dest: { x: number; z: number }, what: string): Promise<void> {
    const waypoints = planWaypoints(pos(), dest);
    log(`Route to ${what}: ${waypoints.length} waypoint(s) from (${pos().x},${pos().z}) to (${dest.x},${dest.z})`);
    for (let i = 0; i < waypoints.length; i++) {
        const wp = waypoints[i]!;
        const before = pos();
        // Match walkTo's own arrival notion (chebyshev <= tolerance): inside
        // it the call is a no-op success, which is arrival, not a stall.
        if (chebTo(wp) <= 3) continue;

        let moved = false;
        for (let attempt = 0; attempt < 3 && !moved; attempt++) {
            const res = await bot.walkTo(wp.x, wp.z, 3);
            await sdk.waitForTicks(2);
            const after = pos();
            const step = Math.hypot(after.x - before.x, after.z - before.z);
            moved = step >= 1 || chebTo(wp) <= 3;
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
 * Settle + rescan after a teleport or plane change. Entity listings go stale
 * across a plane change, so wait for ticks to land and re-read NPCs from fresh
 * state rather than trusting the pre-climb snapshot.
 */
async function settleAndRescan(what: string): Promise<void> {
    await sdk.waitForTicks(3);
    await bot.dismissBlockingUI();
    const st = sdk.getState();
    log(`Settled after ${what} at (${pos().x},${pos().z}) l${pos().level}, ${st?.nearbyNpcs?.length ?? 0} npcs in view`);
}

/** Climb the tower stairs one level at a time until the target plane is reached. */
async function climbTo(targetLevel: number, what: string): Promise<void> {
    for (let i = 0; i < 6 && pos().level !== targetLevel; i++) {
        const up = pos().level < targetLevel;
        await goToStairs(up);
        const opt = up ? /climb-up|climb up/i : /climb-down|climb down/i;
        const stairs = nearestLoc(/staircase|ladder/i, opt, 4);
        if (!stairs) {
            await settleAndRescan('stairs rescan');
            continue;
        }
        // Pass the entity: a RegExp could re-resolve to a same-named neighbour
        // after the approach walk.
        const res = await bot.interactLoc(stairs, opt);
        log(`climb ${up ? 'up' : 'down'} ${stairs.name} (${stairs.x},${stairs.z}) -> ${what}: ok=${res.success}${res.success ? '' : ` (${res.message ?? '?'})`}`);
        await settleAndRescan(`climb ${up ? 'up' : 'down'}`);
    }
    if (pos().level !== targetLevel) throw new Error(`could not reach level ${targetLevel} for ${what}: at l${pos().level}`);
}

/** Nearest loc offering an option, from fresh state. Distances are Chebyshev. */
function nearestLoc(nameRe: RegExp, optRe: RegExp, maxDist = 15) {
    return (sdk.getNearbyLocs() ?? [])
        .filter(l =>
            nameRe.test(l.name) &&
            l.optionsWithIndex.some(o => optRe.test(o.text)) &&
            (l.distance ?? 99) <= maxDist)
        .sort((a, b) => (a.distance ?? 99) - (b.distance ?? 99))[0] ?? null;
}

/** Nearest walkable tile adjacent to a loc on the current level. */
function adjacentTile(l: { x: number; z: number }): { x: number; z: number } | null {
    const lvl = pos().level;
    const cands: { x: number; z: number }[] = [];
    for (let dx = -1; dx <= 1; dx++) {
        for (let dz = -1; dz <= 1; dz++) {
            if (dx === 0 && dz === 0) continue;
            if (isTileWalkable(lvl, l.x + dx, l.z + dz)) cands.push({ x: l.x + dx, z: l.z + dz });
        }
    }
    cands.sort((a, b) => Math.hypot(a.x - pos().x, a.z - pos().z) - Math.hypot(b.x - pos().x, b.z - pos().z));
    return cands[0] ?? null;
}

/**
 * Get inside the tower ground floor. The offline planner routes AROUND the
 * closed door (an open around-path exists) and the arrival tolerance then
 * accepts a tile outside — the climb that follows fails with the stairs
 * unreachable behind the wall (dev run qlimp2 at (3102,3161): Staircase
 * reachable=false). So: open the nearest openable door explicitly, then walk
 * to a verified interior tile instead of trusting the planned route.
 */
async function enterTower(): Promise<void> {
    for (let i = 0; i < 4 && chebTo(TOWER_INTERIOR) > 2; i++) {
        const door = nearestLoc(/door/i, /open/i, 14);
        if (door) {
            log(`opening tower door @ (${door.x},${door.z})`);
            const opened = await bot.interactLoc(door, /open/i);
            log(`door open: ok=${opened.success}${opened.success ? '' : ` (${opened.message ?? '?'})`}`);
            await sdk.waitForTicks(2);
        }
        const w = await bot.walkTo(TOWER_INTERIOR.x, TOWER_INTERIOR.z, 2);
        await sdk.waitForTicks(2);
        log(`enter leg ${i + 1}: at (${pos().x},${pos().z}) l${pos().level} ok=${w.success}`);
    }
    if (chebTo(TOWER_INTERIOR) > 3) throw new Error(`could not enter the tower: at (${pos().x},${pos().z}) l${pos().level}`);
    log(`Inside the tower at (${pos().x},${pos().z}) l${pos().level}`);
}

/**
 * Stand adjacent to the stairs offering the needed climb option. The engine
 * answers "can't reach" from 2+ tiles out even when the tiles between look
 * open, so adjacency is a precondition, not an optimization.
 */
async function goToStairs(up: boolean): Promise<void> {
    const opt = up ? /climb-up|climb up/i : /climb-down|climb down/i;
    for (let i = 0; i < 4; i++) {
        const stairs = nearestLoc(/staircase|ladder/i, opt, 20);
        if (!stairs) {
            await settleAndRescan('stairs scan');
            continue;
        }
        if (Math.max(Math.abs(pos().x - stairs.x), Math.abs(pos().z - stairs.z)) <= 1) {
            log(`At the ${stairs.name} (${stairs.x},${stairs.z})`);
            return;
        }
        const adj = adjacentTile(stairs);
        if (!adj) throw new Error(`no walkable tile beside ${stairs.name} (${stairs.x},${stairs.z})`);
        log(`approaching ${stairs.name} via (${adj.x},${adj.z})`);
        await bot.walkTo(adj.x, adj.z, 1);
        await sdk.waitForTicks(2);
    }
    const stairs = nearestLoc(/staircase|ladder/i, opt, 20);
    if (!stairs || Math.max(Math.abs(pos().x - stairs.x), Math.abs(pos().z - stairs.z)) > 1) {
        throw new Error(`could not reach the stairs: at (${pos().x},${pos().z}) l${pos().level}`);
    }
}

// ── bead hunt helpers ───────────────────────────────────────────────────────
async function collectBeads(): Promise<void> {
    const deadline = Date.now() + 45 * 60_000;
    let sinceBankTrip = 0;
    while (!hasAllBeads()) {
        if (Date.now() > deadline) throw new Error(`bead hunt timed out with ${beadCount()}/4 beads`);
        // Gate the loop on a live connection and fresh state: stale snapshots
        // after a teleport list NPCs that are no longer there.
        if (!sdk.isConnected()) {
            log('Gateway disconnected mid-hunt — waiting for reconnect');
            await sdk.waitForTicks(5);
            continue;
        }
        if (!sdk.getState()) {
            await sdk.waitForTicks(2);
            continue;
        }
        await eatIfNeeded();

        // Productive consume fallback: out of food -> bank, deposit loot (never
        // beads), top up, return to camp. No per-attempt noteFailure — the loop
        // just keeps producing until the beads are held.
        if (pos().hp <= Math.ceil(pos().maxHp * 0.3) && foodCount() === 0) {
            log('Low HP with no food — banking fallback, then resuming the hunt');
            await foodFallbackTrip();
            sinceBankTrip = 0;
            continue;
        }
        if (sinceBankTrip > 40) {
            await foodFallbackTrip();
            sinceBankTrip = 0;
            continue;
        }

        const imp = findImp();
        if (!imp) {
            if (distTo(IMP_CAMP) > 10) await travelTo(IMP_CAMP, 'imp hunting ground');
            else await sdk.waitForTicks(3);
            sinceBankTrip++;
            continue;
        }
        if ((imp.distance ?? 99) > 6) {
            const before = pos();
            await bot.walkTo(imp.x, imp.z, 3);
            await sdk.waitForTicks(1);
            const step = Math.hypot(pos().x - before.x, pos().z - before.z);
            if (step < 1) log(`imp approach stalled at (${before.x},${before.z}); rescanning`);
            continue;
        }
        intent(`Attacking imp @ ${imp.x},${imp.z} (beads ${beadCount()}/4)`);
        const atk = await bot.attack(imp);
        if (!atk.success) {
            await sdk.waitForTicks(1);
            continue;
        }
        await waitFight();
        await lootBeads();
        sinceBankTrip++;
    }
    log(`All four beads held: ${BEADS.map(b => `${b.name}x${invCount(b.pattern)}`).join(' ')}`);
    session.log('log', 'all four beads collected');
}

function findImp() {
    return (sdk.getNearbyNpcs() ?? [])
        .filter(n =>
            IMP.test(n.name) &&
            (n.hp === null || n.hp > 0) &&
            n.optionsWithIndex.some(o => /attack/i.test(o.text)) &&
            (n.reachable !== false || (n.distance ?? 99) <= 9) &&
            Math.hypot(n.x - pos().x, n.z - pos().z) <= HUNT_RADIUS + 8)
        .sort((a, b) => (a.distance ?? 99) - (b.distance ?? 99))[0] ?? null;
}

/** Wait out the fight, then settle so the drop table is visible before looting. */
async function waitFight(): Promise<void> {
    for (let i = 0; i < 40; i++) {
        if (!pos().inCombat) break;
        await sdk.waitForTicks(1);
    }
    await sdk.waitForTicks(2);
}

async function lootBeads(): Promise<void> {
    const before = beadCount();
    for (let i = 0; i < 6; i++) {
        const drop = [...(sdk.getGroundItems() ?? [])]
            .filter(g => /bead$/i.test(g.name) && g.reachable !== false && (g.distance ?? 99) <= 12)
            .sort((a, b) => (a.distance ?? 99) - (b.distance ?? 99))[0];
        if (!drop) break;
        const ok = await bot.pickupItem(drop);
        await sdk.waitForTicks(1);
        if (!ok.success) break;
    }
    if (beadCount() > before) {
        log(`Bead loot: now ${beadCount()}/4 held`);
        session.noteProgress('inventory', `bead ${beadCount()}/4`);
    }
}

async function eatIfNeeded(): Promise<void> {
    if (pos().hp > Math.ceil(pos().maxHp * 0.5) || foodCount() === 0) return;
    const res = await bot.eatFood();
    log(`eat: ok=${res.success} hp=${pos().hp}/${pos().maxHp}`);
}

/**
 * Productive fallback when food runs out: bank at Draynor (deposit loot, never
 * beads), withdraw food if stocked, return to camp with settle+rescan.
 */
async function foodFallbackTrip(): Promise<void> {
    await session.setPhase('fallback-bank');
    intent('Restocking food at Draynor');
    await travelTo(DRAYNOR_BANK, 'Draynor bank (fallback)');
    await bot.dismissBlockingUI();
    if (!(await bot.openBank()).success) {
        await bot.closeInterface();
        await bot.walkTo(DRAYNOR_BANK.x - 1, DRAYNOR_BANK.z, 1);
        if (!(await bot.openBank()).success) throw new Error('could not open Draynor bank on fallback trip');
    }
    await sdk.waitForTicks(2);
    const keep = (name: string) => BEADS.some(b => b.pattern.test(name)) || FOOD_RE.test(name);
    for (const item of sdk.getInventory().filter(i => (i.count ?? 0) > 0 && !keep(i.name))) {
        await bot.depositItem(item, -1);
    }
    const bankItems = sdk.getState()?.bank?.items ?? [];
    const bankFood = bankItems.filter(i => FOOD_RE.test(i.name)).reduce((n, i) => n + (i.count ?? 0), 0);
    if (bankFood > 0 && foodCount() < FOOD_WITHDRAW) {
        if (!sdk.getState()?.bank?.isOpen && !(await bot.openBank()).success) {
            throw new Error('bank closed before fallback food withdrawal');
        }
        const res = await bot.withdrawItem(FOOD_RE, Math.min(FOOD_WITHDRAW - foodCount(), bankFood));
        log(`fallback withdrew food: ${res.success} (now ${foodCount()})`);
        if (res.success) session.noteProgress('bank', 'fallback food restock');
    } else {
        log(`fallback: no food to restock (bank=${bankFood}); resuming hunt regardless`);
    }
    await bot.closeInterface();
    await session.setPhase('collect');
    await travelTo(IMP_CAMP, 'imp hunting ground (return)');
    await settleAndRescan('fallback return');
}

// ── 3. run the declared flow ────────────────────────────────────────────────
// The flow (stage routing, bank, travel, start, bead hunt, hand-in, verify, and
// every recovery edge) is declared in `imp-catcher.graph.ts`:
//   bun sdk/fsm-cli.ts bots/quests/imp-catcher.graph.ts

/** Click through a conversation, preferring the stated choices, then clear the UI. */
async function drainDialog(preferred: RegExp[]): Promise<void> {
    for (let i = 0; i < 30; i++) {
        const dialog = sdk.getDialog();
        if (!dialog?.isOpen) {
            await sdk.waitForTicks(1);
            if (!sdk.getDialog()?.isOpen && i > 2) break;
            continue;
        }
        const options = dialog.options ?? [];
        const pick = preferred.map((re) => options.find((o) => re.test(o.text))).find(Boolean) ?? options[0];
        if (pick) {
            log(`dialog -> ${pick.text}`);
            await sdk.sendClickDialog(pick.index);
        }
        await sdk.waitForTicks(2);
    }
    await bot.dismissBlockingUI();
}

/** Route to the top floor of the Wizards' Tower, where Mizgog stands. */
async function travelToMizgog(): Promise<void> {
    intent('Heading to Wizard Mizgog');
    if (pos().level !== 0 || distTo(TOWER_DOOR) > 6) await travelTo(TOWER_DOOR, 'Wizards Tower door');
    await enterTower();
    await goToStairs(true);
    if (pos().level !== MIZGOG.level) await climbTo(MIZGOG.level, 'Mizgog floor');
    await settleAndRescan('tower climb');
    await travelTo(mizgogApproach(), 'Wizard Mizgog');
}

async function acceptQuest(): Promise<{ started: boolean; reason?: string }> {
    intent('Starting Imp Catcher');
    const talked = await bot.talkTo(/^wizard mizgog$/i);
    if (!talked.success) return { started: false, reason: `could not talk to Mizgog: ${talked.message ?? '?'}` };
    await drainDialog([/give me a quest please/i, /give me a quest!/i, /i'?ll try/i]);
    if (!(await checkpoint('active', 'accepted the quest, beads requested'))) {
        return { started: false, reason: 'active checkpoint failed after accepting the quest' };
    }
    return { started: true };
}

/** The hunt: descend the tower, get to the camp, collect until all four beads are held. */
async function huntBeads(): Promise<void> {
    if (pos().level !== 0) await climbTo(0, 'tower ground');
    await settleAndRescan('tower descent');
    if (distTo(IMP_CAMP) > 8) await travelTo(IMP_CAMP, 'imp hunting ground');
    await settleAndRescan('arrival at hunting ground');
    if (hasAllBeads()) {
        log('All four beads already held; skipping the hunt');
        return;
    }
    intent('Hunting imps for beads');
    await collectBeads();
}

async function handIn(): Promise<void> {
    intent('Returning the beads to Mizgog');
    await travelTo(TOWER_DOOR, 'Wizards Tower door (return)');
    await enterTower();
    await goToStairs(true);
    if (pos().level !== MIZGOG.level) await climbTo(MIZGOG.level, 'Mizgog floor (return)');
    await settleAndRescan('return climb');
    await travelTo(mizgogApproach(), 'Wizard Mizgog (return)');

    if (!hasAllBeads()) throw new Error(`reached Mizgog without all beads (${beadCount()}/4)`);
    const again = await bot.talkTo(/^wizard mizgog$/i);
    if (!again.success) throw new Error(`could not talk to Mizgog to hand in: ${again.message ?? '?'}`);
    await drainDialog([/i'?ve got all four beads|all four beads/i]);
}

const ctx: ImpCtx = {
    stage: null,
    readStage,
    checkpoint: (name, label) => checkpoint(name, label),
    bankForSupplies,
    travelToMizgog,
    acceptQuest,
    huntBeads,
    handIn,
    promotionGate: () => summarizeRun(run.directory),
    log,
};

const machine = new Machine(graph, {
    onEnter: (state) => {
        if (!state.startsWith('$')) void session.setPhase(state).catch(() => undefined);
    },
    onTransition: (e) =>
        session.event(
            'transition',
            {
                machine: e.machine,
                from: e.from,
                to: e.to,
                via: e.via,
                reason: e.reason,
                visit: e.visit,
                durationMs: e.durationMs,
                elapsedMs: e.elapsedMs,
                edgeRepeats: e.edgeRepeats,
            },
            `${e.from} -> ${e.to} (${e.via})${e.reason ? `: ${e.reason}` : ''}`,
        ),
    stopping: () => session.isStoppedOrRequested(),
});

const result = await machine.run(ctx);
log(`route: ${result.path.join(' -> ')}`);

if (result.outcome === 'failed') {
    log(`FAILED — ${result.reason}`);
    session.stop('failed', `imp catcher failed: ${result.reason}`, { restartable: false });
    sdk.disconnect();
    process.exit(1);
}

session.log('log', 'Imp Catcher verified complete');
session.noteProgress('inventory', 'quest complete (journal-verified)');
log(`DONE Imp Catcher verified via journal at (${pos().x},${pos().z}) in ${Math.round(result.elapsedMs / 1000)}s (${result.transitions.length} transitions)`);
log(`Metrics: ${JSON.stringify(session.metrics())}`);

session.stop('done', 'Imp Catcher complete', { restartable: false });
sdk.disconnect();
process.exit(0);
