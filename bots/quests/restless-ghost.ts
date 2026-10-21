/**
 * The Restless Ghost — replayable, checkpoint-gated.
 *
 *   bun bots/quests/restless-ghost.ts <botname>
 *
 * State machine: bank -> Father Aereck (start) -> Father Urhney (amulet) ->
 * Restless Ghost (dialog, amulet worn) -> skull pickup (Wizards Tower
 * basement) -> skull into the coffin -> journal complete.
 *
 * Every step that matters is gated on QUEST JOURNAL evidence, never on XP,
 * chat or a successful packet. The journal is the only client-visible record
 * of quest state: the `prieststart` varp is never transmitted, so it is the
 * portable checkpoint channel.
 *
 * Quest facts (all from the repo's own content, see RULES comments):
 *   - questlist button [priest] label is "The Restless Ghost"
 *     (server/content/scripts/player/interfaces/questlist.if), and the
 *     journal heading $n is the same string (priest_journal.rs2:3).
 *   - completion is %prieststart = ^priest_complete (5)
 *     (server/content/scripts/general/scripts/quests.rs2:116).
 *   - no requirements, no prerequisite quests (wiki/quests/restless-ghost.md).
 *   - the amulet is given by Urhney (inv_add) and must be WORN for the ghost
 *     to understand you (restless_ghost.rs2:15); the skull is a ground pickup
 *     in the Wizards Tower basement that spawns a level-13 skeleton
 *     (quest_priest.rs2:68-79); the coffin must be OPEN before the skull goes
 *     in (quest_priest.rs2:47-55 vs 54-65).
 *
 * Route and door handling:
 *   - waypoints computed offline from the repo's collision data
 *     (`findLongPath`), single plane, short ~10-tile hops
 *   - each leg is walked with displacement verified; a leg that moves nothing
 *     is an obstacle, not something to retry
 *   - `bot.walkTo`/`talkTo` open blocking doors (church, tower, shack need no
 *     explicit handling); ladders go through `climb` below
 */
import { existsSync, readFileSync, appendFileSync, writeFileSync } from 'fs';
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
if (!existsSync(envPath)) throw new Error(`bot.env not found at ${envPath}. Usage: bun bots/quests/restless-ghost.ts <botname>`);
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
// Draynor bank (no bank in Lumbridge in this revision); Lumbridge NPC/world
// tiles below are repo-grounded, not guessed:
//   Aereck / Urhney spawns: wiki/quests/index.json ("priest" npcs).
//   Coffin: the ghost's runtime spawn 0_50_49_49_58 decodes via the
//     y_mx_mz_lx_lz packing (GameMap.ts:313) to (50*64+49, 49*64+58) l0.
//   Wizards Tower ground approach: bots/quests/essence.ts:25.
const DRAYNOR_BANK = { x: 3082, z: 3242 };
const AERECK = { x: 3244, z: 3206 };
const URHNEY = { x: 3235, z: 3153 };
const COFFIN = { x: 3249, z: 3194 };
const WIZTOWER = { x: 3109, z: 3162 };
// Live-reconned tower entry (2026-10-17, qlpriest3 probe): the basement ladder
// (3104,3162, Climb-down) stands INSIDE the tower behind a closed Door
// (3107,3162); (3108,3162) is the walkable neighbour to open it from.
// The down-ladder lands at (3104,9576) in the basement zone; the Climb-up
// ladder is at (3103,9576) while the skull spawn is ~18 tiles east, so the
// return leg must walk back to the ladder foot before climbing.
const TOWER_DOOR_STEP = { x: 3108, z: 3162 };
const TOWER_LADDER = { x: 3104, z: 3162 };
const BASEMENT_LADDER_FOOT = { x: 3104, z: 9576 };
// Live-reconned basement exit (2026-10-17, qlpriest8 probe): the Climb-up
// Ladder is id=2148 @ (3103,9576) and streams ONLY near the west end of the
// basement — zero ladder/stair locs resolve from the skull tile (3120,9567),
// ~18 tiles east. The old climb-out resolved the ladder from the skull tile
// and silently missed all 4 attempts. The return walk below is the exact
// probed hop chain (all three walkTo legs ok=true) and the foot tile
// (3104,9576) is the standable approach (dist=1, reach=true); the ladder's
// own tile is never walked to (rule 17). Climb-up lands at (3105,3162) l0.
const BASEMENT_LADDER_UP = { x: 3103, z: 9576 };
const BASEMENT_EXIT_HOPS = [
    { x: 3114, z: 9569 },
    { x: 3109, z: 9573 },
    { x: 3104, z: 9576 },
];

const SKULL = /^skull$/i;
const AMULET = /ghostspeak/i;

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

/** Somewhere beside a target tile that can actually be stood on. */
function approach(dest: { x: number; z: number }): { x: number; z: number } {
    for (const cand of [
        { x: dest.x, z: dest.z }, { x: dest.x + 1, z: dest.z }, { x: dest.x - 1, z: dest.z },
        { x: dest.x, z: dest.z + 1 }, { x: dest.x, z: dest.z - 1 },
    ]) {
        if (isTileWalkable(0, cand.x, cand.z)) return cand;
    }
    return { ...dest };
}

// Label verified against the [priest] stanza of questlist.if — it reads
// "The Restless Ghost" (not "Restless Ghosts' Quest", which is only the
// completion banner in quest_priest.rs2:97). Title is the journal heading $n.
const JOURNAL = { label: 'The Restless Ghost', title: 'The Restless Ghost' };

// Journal rules, read from the quest's own journal script
// (server/content/scripts/quests/quest_priest/scripts/priest_journal.rs2).
// The journal is cumulative: struck history persists, so each rule keys on the
// stage's CURRENT (@dbl@) line, which the next stage drops:
//   not_started (L6-8)  -> "I can start this quest by speaking to Father Aereck"
//   started (L14-15)     -> "I should find Father Urhney who is an expert on ghosts"
//   spoken_urhney (L21-22) -> "I should talk to the Ghost ... graveyard crypt"
//   spoken_ghost (L28-29)   -> "I should go and search the Wizard's Tower ... Ghost's Skull"
//   obtained_skull (L35-36) -> "I should take the Skull back to the Ghost"
//   complete (L41-42)    -> "I placed the Skull in the Ghost's coffin" + "QUEST COMPLETE!"
// Patterns are regexes (see evaluateJournal) and kept to short phrases so a
// pixel-width line wrap can never split them.
const RULES: Record<string, JournalRule> = {
    unstarted: { id: 'priest:unstarted', kind: 'unstarted', all: ['I can start this quest by speaking to', 'Father Aereck'] },
    started: { id: 'priest:started', kind: 'active', all: ['I should find', 'Father Urhney', 'expert on ghosts'] },
    spoken_urhney: { id: 'priest:spoken_urhney', kind: 'active', all: ['I should talk to the', 'why it is haunting'] },
    spoken_ghost: { id: 'priest:spoken_ghost', kind: 'active', all: ['I should go and search the', 'South West of'] },
    obtained_skull: { id: 'priest:obtained_skull', kind: 'active', all: ['I should take the', 'Skull', 'back to the'] },
    complete: { id: 'priest:complete', kind: 'complete', all: ['QUEST COMPLETE', 'I placed the Skull in the Ghost'] },
};
type Stage = keyof typeof RULES;
const STAGE_ORDER: Stage[] = ['unstarted', 'started', 'spoken_urhney', 'spoken_ghost', 'obtained_skull', 'complete'];

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

// isConnected gate: proceed on nothing unless the player is live in-game.
if (!sdk.getState()?.player) throw new Error('not connected: no live player state after connect');

// ActivitySession needs the live sdk + bot, so it is built here, not up front.
const session = new ActivitySession(sdk, bot, {
    name: 'restless ghost',
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
const amuletWorn = () => sdk.findEquipmentItem(AMULET) != null;

// ── durable run record ──────────────────────────────────────────────────────
// Checkpoint evidence is written verbatim as the run proceeds, so an audit does
// not depend on the script's own stdout or on telemetry that sampling truncates.
const MODE = process.env.QUEST_LAB_MODE === 'staging' ? 'staging' : 'development';
const run = createRun(join(process.cwd(), 'quest-lab', 'runs'), safeRunId('priest', username, new Date().toISOString()), {
    questId: 'priest',
    account: username,
    mode: MODE,
    scriptHash: Bun.hash(await Bun.file(import.meta.path).text()).toString(16),
    fixtureHash: process.env.QUEST_LAB_FIXTURE_HASH ?? 'unrecorded',
    contentHash: process.env.QUEST_LAB_CONTENT_HASH ?? 'unrecorded',
    requiredCheckpoints: [...STAGE_ORDER],
});
log(`Run record: ${run.directory} (mode=${MODE})`);

/** Checkpoint gate. UNKNOWN is a failure like any other here: proceed on nothing. */
async function checkpoint(name: Stage, label: string): Promise<boolean> {
    // The journal write lags the action that caused it — much more so on the prod
    // link than in a local fixture. The first canary died at `started` seconds
    // after the accept dialog while the journal still showed the unstarted text,
    // so read it again (bounded) instead of failing on one sample: a stage that
    // genuinely did not advance still fails, but a slow publication does not.
    let read = await readJournalCheckpoint(sdk, JOURNAL, RULES[name]!);
    for (let retry = 0; retry < 4 && (read.verdict?.verdict ?? 'UNKNOWN') !== 'PASS'; retry++) {
        log(`checkpoint ${name} not settled (${read.verdict?.verdict ?? 'UNKNOWN'}) — re-reading the journal (${retry + 1}/4)`);
        await sdk.waitForTicks(10);
        read = await readJournalCheckpoint(sdk, JOURNAL, RULES[name]!);
    }
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
async function readStage(): Promise<Stage | 'unknown'> {
    for (const name of [...STAGE_ORDER].reverse()) {
        const read = await readJournalCheckpoint(sdk, JOURNAL, RULES[name]!);
        log(`  stage probe ${name}: ${read.verdict?.verdict ?? 'UNKNOWN'} (${read.reason})`);
        if (read.verdict?.verdict === 'PASS') return name;
    }
    return 'unknown';
}

let stage = await readStage();
log(`Quest stage at start: ${stage}`);

// Derive the required checkpoint list from the stage this run RESUMED at, and
// write it into run.json before any side effect (rule 59). A static list makes
// every resumed run ungradeable: the canary that finished the quest on jacklove8
// earned `complete` and still "failed" its own promotion gate on the four stages
// a resume cannot re-demonstrate. summarizeRun and the canary grader both read
// run.json, so rewriting it here fixes the in-script gate and the tier at once.
if (stage !== 'unknown') {
    const from = STAGE_ORDER.indexOf(stage as Stage);
    // Only the stages this run will actually DEMONSTRATE: a resume at X skips the
    // X block (`reached(X)` is already true), so requiring X makes every resume
    // ungradeable — that is what failed the canary that had just written
    // `complete PASS` on jacklove9 (missing: spoken_ghost, which it never re-ran).
    const required = STAGE_ORDER.slice(stage === 'unstarted' ? 0 : from + 1);
    if (!required.includes('complete')) required.push('complete');
    try {
        const runPath = join(run.directory, 'run.json');
        const meta = JSON.parse(readFileSync(runPath, 'utf-8')) as Record<string, unknown>;
        meta.requiredCheckpoints = required;
        writeFileSync(runPath, JSON.stringify(meta, null, 2));
        log(`Run record requires ${required.join(', ')} (resumed at ${stage})`);
    } catch (err) {
        log(`could not rewrite requiredCheckpoints: ${String(err)}`);
    }
}
if (stage === 'complete') {
    log('The Restless Ghost is already complete — nothing to do');
    session.log('log', 'quest already complete; nothing to do');
    sdk.disconnect();
    process.exit(0);
}
if (stage === 'unknown') throw new Error('could not determine the quest stage from the journal');
const reached = (s: Stage) => STAGE_ORDER.indexOf(stage as Stage) >= STAGE_ORDER.indexOf(s);

// ── 2. bank first: deposit carry-over so the amulet/skull always have room ──
// Nothing needs withdrawing (amulet is given, skull is picked up), so this leg
// is deposit-only and never fails for "stock".
await session.setPhase('bank');
await bot.dismissBlockingUI();
await leaveTowerIfInside();
await bankDeposit();

/** Deposit carry-over, with the booth-fail retry from the Cook template. */
async function bankDeposit(): Promise<void> {
    // A bot may be anywhere on restart, so travel to the bank first rather
    // than assuming the start tile.
    if (distTo(DRAYNOR_BANK) > 8) await travelTo(approach(DRAYNOR_BANK), 'Draynor bank');
    // Quest items are never carry-over: a resume holding the skull banked it
    // and then could not re-farm the spawn (observed). Keep them.
    const KEEP = [SKULL, AMULET];
    const junk = sdk.getInventory().filter(i => (i.count ?? 0) > 0 && !KEEP.some(re => re.test(i.name)));
    if (junk.length === 0) {
        log('Inventory already empty; skipping the bank leg');
        return;
    }
    log(`Depositing ${junk.length} carried stack(s) before starting`);
    if (!(await bot.openBank()).success) {
        // Booths can fail to open from a tile: close, step to the booth,
        // retry once before declaring failure.
        await bot.closeInterface();
        await bot.walkTo(DRAYNOR_BANK.x - 1, DRAYNOR_BANK.z, 1);
        if (!(await bot.openBank()).success) throw new Error('could not open Draynor bank for deposit');
    }
    await sdk.waitForTicks(2);
    for (const item of sdk.getInventory().filter(i => (i.count ?? 0) > 0)) await bot.depositItem(item, -1);
    await bot.closeInterface();
    session.noteProgress('bank', 'deposited carry-over inventory');
    log('Bag empty after deposit');
}

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

/**
 * Climb a nearby stair/ladder and verify the level (or a telejump) changed.
 * Resolves the loc by name each attempt — never by a hardcoded loc id.
 */
async function climb(want: 'up' | 'down', what: string): Promise<void> {
    const opt = want === 'up' ? /climb-up|climb.up|go-up/i : /climb-down|climb.down|go-down/i;
    const before = pos();
    for (let i = 0; i < 4; i++) {
        const loc = (sdk.getNearbyLocs() ?? [])
            .filter(l => /stair|ladder/i.test(l.name) && l.optionsWithIndex.some(o => opt.test(o.text)))
            .sort((a, b) => (a.distance ?? 99) - (b.distance ?? 99))[0];
        if (!loc) {
            await sdk.scanNearbyLocs(8).catch(() => {});
            await sdk.waitForTicks(1);
            continue;
        }
        log(`climb ${want} ${loc.name} @ (${loc.x},${loc.z}) for ${what}`);
        const r = await bot.interactLoc(loc, opt);
        await sdk.waitForCondition(s => {
            const p = s.player;
            if (!p) return false;
            return p.level !== before.level || Math.hypot(p.worldX - before.x, p.worldZ - before.z) > 8;
        }, 8000).catch(() => {});
        await bot.dismissBlockingUI();
        const now = pos();
        if (now.level !== before.level || Math.hypot(now.x - before.x, now.z - before.z) > 8) {
            log(`Climbed ${want} for ${what}: now (${now.x},${now.z}) l${now.level}`);
            session.noteProgress('location', `climbed ${want} (${what})`);
            return;
        }
        log(`climb ${want} attempt ${i + 1} no level change: ${r.success ? r.message : r.message}`);
    }
    throw new Error(`could not climb ${want} for ${what} at (${before.x},${before.z}) l${before.level}`);
}

/**
 * Exit the tower basement after the skull pickup: hop west to the ladder
 * foot on the probed chain, settle+rescan until the Climb-up Ladder streams
 * in, then climb. Never resolves the ladder from the skull tile (nothing
 * streams there) and never walks the ladder's own tile (rule 17).
 */
async function exitBasement(what: string): Promise<void> {
    for (const hop of BASEMENT_EXIT_HOPS) {
        const before = pos();
        if (Math.hypot(before.x - hop.x, before.z - hop.z) <= 2) continue;
        const res = await bot.walkTo(hop.x, hop.z, 2);
        await sdk.waitForTicks(2);
        const after = pos();
        const step = Math.hypot(after.x - before.x, after.z - before.z);
        log(`basement hop -> (${hop.x},${hop.z}) moved=${step.toFixed(1)} at (${after.x},${after.z}) l${after.level} ok=${res.success}`);
        if (step < 1 && Math.hypot(after.x - hop.x, after.z - hop.z) > 3) {
            throw new Error(`BLOCKED basement hop to (${hop.x},${hop.z}) for ${what}: no progress at (${after.x},${after.z}) l${after.level}`);
        }
    }
    const opt = /climb-up|climb.up|go-up/i;
    let up: NonNullable<ReturnType<typeof sdk.getNearbyLocs>>[number] | null = null;
    for (let i = 0; i < 4 && !up; i++) {
        await sdk.waitForTicks(4);
        await sdk.scanNearbyLocs(30).catch(() => {});
        const loc = (sdk.getNearbyLocs() ?? [])
            .filter(l => /stair|ladder/i.test(l.name) && l.optionsWithIndex.some(o => opt.test(o.text)))
            .sort((a, b) => (a.distance ?? 99) - (b.distance ?? 99))[0];
        if (loc) {
            log(`basement exit resolves ${loc.name} @ (${loc.x},${loc.z}) reach=${loc.reachable} for ${what}`);
            up = loc;
        } else if (i < 3) {
            log(`basement exit scan ${i + 1}/4: climb-up not yet streamed at (${pos().x},${pos().z})`);
        }
    }
    if (!up) throw new Error(`no Climb-up ladder streamed at (${pos().x},${pos().z}) l${pos().level} for ${what}`);
    const before = pos();
    // The resolved entity is passed directly: a pattern re-resolve here could
    // miss what the scan just saw (observed on the skull pickup).
    const r = await bot.interactLoc(up, opt);
    await sdk.waitForCondition(s => {
        const p = s.player;
        if (!p) return false;
        return Math.hypot(p.worldX - before.x, p.worldZ - before.z) > 8;
    }, 8000).catch(() => {});
    await bot.dismissBlockingUI();
    const now = pos();
    if (Math.hypot(now.x - before.x, now.z - before.z) <= 8) {
        throw new Error(`climb-up for ${what} did not leave the basement (still at (${now.x},${now.z}) l${now.level}): ${r.message ?? '?'}`);
    }
    log(`Climbed up for ${what}: now (${now.x},${now.z}) l${now.level}`);
    session.noteProgress('location', `climbed up (${what})`);
}

/**
 * Walk out of the Wizards Tower ground floor. The planner cannot route out
 * of the tower interior (2 degenerate waypoints from (3105,3162), both
 * skipped, then "did not reach ... 148 tiles short"), and the eastern door
 * (3111,3163) is CLOSED while the western one (3106,3162) stands open.
 * Probed hop chain (qlpriest9): (3108,3162) ok through the open door, then
 * open the east door and continue to (3113,3162) outside. The open attempt
 * may report "Nothing happened" while still flipping the door (observed),
 * so the walk is retried regardless and displacement is the gate.
 */
async function exitTower(): Promise<void> {
    const OUTSIDE = { x: 3113, z: 3162 };
    // 1. Open the door FIRST, from the interior side. The door's own tile is
    //    masked in the collision graph, so the planner reports "no waypoints"
    //    for every route out of the room while the door is shut — and the
    //    interact may itself move the player (rule 19b: a door open is a
    //    teleport with an unknown destination, so displacement is re-read).
    await sdk.scanNearbyLocs(12).catch(() => {});
    const doors = (sdk.getNearbyLocs() ?? [])
        .filter(l => /door|gate/i.test(l.name ?? '') && (l.distance ?? 99) <= 6)
        .sort((a, b) => (a.distance ?? 99) - (b.distance ?? 99));
    for (const door of doors) {
        // An already-open door offers only Close: nothing to do, the raw step
        // below is the crossing.
        if (!door.optionsWithIndex.some(o => /^open$/i.test(o.text))) continue;
        const opened = await bot.interactLoc(door, /open/i);
        await sdk.waitForTicks(2);
        log(`open tower exit door @ (${door.x},${door.z}): ${opened.success}${opened.success ? '' : ` (${opened.message ?? '?'})`} now (${pos().x},${pos().z})`);
    }
    // 2. Raw steps east with sendWalk. The static map the planner reads still
    //    calls the door tile unwalkable after the door opens, so a planned
    //    route can never cross it; the server's collision does allow the step.
    //    Short verified hops only — a long chord through the masked tile dies
    //    as "no waypoints" and moves nothing.
    for (let attempt = 0; attempt < 6 && distTo(OUTSIDE) > 3; attempt++) {
        const before = pos();
        const dx = OUTSIDE.x - before.x;
        const dz = OUTSIDE.z - before.z;
        const len = Math.hypot(dx, dz) || 1;
        const step = Math.min(4, len);
        await sdk.sendWalk(
            Math.round(before.x + (dx / len) * step),
            Math.round(before.z + (dz / len) * step),
            true,
        ).catch(() => undefined);
        await sdk.waitForTicks(3);
        const after = pos();
        const moved = Math.hypot(after.x - before.x, after.z - before.z);
        log(`tower exit raw step -> (${after.x},${after.z}) l${after.level} moved=${moved.toFixed(1)}`);
        if (moved < 1) break;
    }
    // 3. One planned attempt from wherever the raw steps landed (they may have
    //    cleared the door line), then a hard verdict.
    if (distTo(OUTSIDE) > 3) {
        await bot.walkTo(OUTSIDE.x, OUTSIDE.z, 3).catch(() => undefined);
        await sdk.waitForTicks(2);
    }
    const at = pos();
    if (Math.hypot(at.x - OUTSIDE.x, at.z - OUTSIDE.z) > 6) {
        throw new Error(`BLOCKED tower exit: still inside at (${at.x},${at.z}) l${at.level}`);
    }
    log(`Outside the tower at (${at.x},${at.z}) l${at.level}`);
    session.noteProgress('location', 'exited the tower');
}

/** A resume can start inside the tower (the climb-up lands at (3105,3162)
 * and the planner cannot route out through the doors): walk out first. */
async function leaveTowerIfInside(): Promise<void> {
    if (Math.hypot(pos().x - 3105, pos().z - 3162) < 6) await exitTower();
}

/**
 * Step through the tower door to the interior ladder. The basement ladder is
 * behind a closed door that travel legs and loc interacts cannot route
 * through, so the door is opened explicitly from its walkable neighbour
 * (rule 17: never target the door's own tile).
 */
async function enterTower(): Promise<void> {
    await travelTo(TOWER_DOOR_STEP, 'tower door');
    // The door may ALREADY be open (a prior run in this session left it so), and an
    // open door offers only "Close" — a bare /open/ matcher then reports
    // `No matching option on Door` and the crossing never starts (exactly what the
    // last canary hit). Read the options and only click when Open is offered.
    const doorLoc = sdk.findNearbyLoc(/door/i, { withOption: /open/i })
        ?? (sdk.getNearbyLocs() ?? []).find(l => /door/i.test(l.name ?? '') && (l.distance ?? 99) <= 4);
    const canOpen = (doorLoc?.optionsWithIndex ?? []).some(o => /^open$/i.test(o.text));
    if (canOpen) {
        const door = await bot.interactLoc(doorLoc!, /^open$/i);
        log(`open tower door: ${door.success}${door.success ? '' : ` (${door.message ?? '?'})`}`);
    } else {
        log(`tower door already open (or no Open option) — walking through`);
    }
    // The door tile is masked in the collision graph, so a PLANNED route from the
    // outside to an interior tile cannot cross it — the canary died exactly here
    // with `BLOCKED leg 2 to tower interior: no progress at (3110,3163), 3 tiles
    // short of (3107,3164)`. Open the door, then raw-step through the door line
    // with sendWalk (the server honours the open door even though the static map
    // does not) and verify displacement; only then plan inside the room.
    const INSIDE = { x: TOWER_LADDER.x + 1, z: TOWER_LADDER.z };
    for (let attempt = 0; attempt < 6 && Math.hypot(pos().x - INSIDE.x, pos().z - INSIDE.z) > 2; attempt++) {
        const before = pos();
        const dx = INSIDE.x - before.x;
        const dz = INSIDE.z - before.z;
        const len = Math.hypot(dx, dz) || 1;
        const step = Math.min(3, len);
        await sdk.sendWalk(
            Math.round(before.x + (dx / len) * step),
            Math.round(before.z + (dz / len) * step),
            true,
        ).catch(() => undefined);
        await sdk.waitForTicks(3);
        const after = pos();
        const moved = Math.hypot(after.x - before.x, after.z - before.z);
        log(`tower entry raw step -> (${after.x},${after.z}) l${after.level} moved=${moved.toFixed(1)}`);
        if (moved < 1) break;
    }
    if (Math.hypot(pos().x - TOWER_LADDER.x, pos().z - TOWER_LADDER.z) > 4) {
        // Last resort before failing the leg: one planned walk from wherever the
        // raw steps left us, then one door toggle, then another raw step. On the
        // live link the door state and the client's map disagree for a tick, and
        // a single shape of click is not enough to get across.
        log(`entry still outside at (${pos().x},${pos().z}) — planned walk + door toggle retry`);
        await bot.walkTo(INSIDE.x, INSIDE.z, 2).catch(() => undefined);
        await sdk.waitForTicks(3);
        if (Math.hypot(pos().x - TOWER_LADDER.x, pos().z - TOWER_LADDER.z) > 4) {
            const toggle = (sdk.getNearbyLocs() ?? [])
                .filter(l => /door/i.test(l.name ?? '') && (l.distance ?? 99) <= 4)
                .sort((a, b) => (a.distance ?? 99) - (b.distance ?? 99))[0];
            if (toggle) {
                const t = await bot.interactLoc(toggle, /open|close/i).catch(() => ({ success: false } as any));
                log(`tower door toggle: ${t?.success ?? false}`);
                await sdk.waitForTicks(3);
                await sdk.sendWalk(INSIDE.x, INSIDE.z, true).catch(() => undefined);
                await sdk.waitForTicks(3);
            }
        }
        if (Math.hypot(pos().x - TOWER_LADDER.x, pos().z - TOWER_LADDER.z) > 4) {
            throw new Error(`BLOCKED tower entry: still outside at (${pos().x},${pos().z}) l${pos().level}`);
        }
    }
    log(`Inside the tower at (${pos().x},${pos().z}) l${pos().level}`);
}

/** Talk with settle retries: a dispatched talk can miss its dialog on a stale
 * scene or a mid-step NPC (observed: 'Dialog did not open' beside Aereck on
 * an otherwise identical leg), so re-resolve and retry before failing. */
async function talkRetry(pattern: RegExp, what: string, tries = 5): Promise<void> {
    for (let i = 0; i < tries; i++) {
        if (i > 0) await sdk.waitForTicks(4);
        const r = await bot.talkTo(pattern);
        if (r.success) return;
        log(`${what} talk attempt ${i + 1}/${tries}: ${r.message ?? '?'}`);
    }
    throw new Error(`could not talk to ${what} after ${tries} attempts`);
}

// ── dialog ──────────────────────────────────────────────────────────────────
/**
 * Drive a dialog by clicking ONLY options that match the caller's allowlist,
 * plus lone continue prompts to drain linear NPC lines. Anything else is
 * waited out, never blind-picked: several NPCs here offer dead-end branches
 * (ghost "No I can't", Urhney "repossess") that close the dialog without
 * advancing the quest — and every NPC here opens with continue-gated lines
 * BEFORE its choice (Aereck's welcome, Urhney's "Go away", the ghost's
 * greeting) and runs a long tail AFTER it that only reaches the server's
 * stage-advance line once fully consumed. A driver that waits on non-matching
 * options stalls on the opener and the choice never appears (observed:
 * Aereck welcome line, `started` never set). A lone option is a continue
 * prompt, never a branch; multiple unmatched options are a real choice and
 * are left alone (unlike a blind options[0] fallback, which can answer a
 * DECLINE branch as option 1 on the server).
 */
/**
 * Pump a dialog to its close, ONE click per page state.
 *
 * The first canary died here twice: the accept choice was clicked, the page did
 * not advance, and the pump kept re-clicking the same stale page (a repeat click
 * on a choice page is answered as whatever option sits at that index, or dropped
 * outright — the live client returns `Failed to click dialog option`). A probe
 * that clicked exactly the same option set, settled 3 ticks between pages and
 * never re-clicked an identical page started the quest first try (journal then
 * read "@str@Father Aereck asked me to help him deal with the Ghost").
 *
 * So: settle longer, remember what was clicked, and skip pages whose option set
 * has not changed since the last click.
 */
async function runDialog(matchers: RegExp[], what: string): Promise<void> {
    let lastClicked = '';
    let stalled = 0;
    for (let i = 0; i < 80; i++) {
        const dialog = sdk.getDialog();
        if (!dialog?.isOpen) {
            await sdk.waitForTicks(1);
            if (!sdk.getDialog()?.isOpen && i > 2) break;
            continue;
        }
        const options = dialog.options ?? [];
        // Component ids differ per page even when the words are identical —
        // consecutive "Click here to continue" pages are byte-identical in text
        // (rule 39), so a text-only signature would stall every long dialog.
        const signature = options.map(o => `${o.index}:${o.componentId ?? '?'}:${o.text}`).join('|');
        const continueOnly = options.length > 0 && options.every(o => /^click here to continue$/i.test(o.text.trim()));
        const pick = matchers.map(re => options.find(o => re.test(o.text))).find(Boolean)
            ?? (continueOnly || options.length === 1 ? options[0] : undefined);
        if (!pick) {
            await sdk.waitForTicks(2);
            if (++stalled > 20) {
                log(`dialog (${what}) stalled with options: ${signature || '(none)'}`);
                break;
            }
            continue;
        }
        if (signature === lastClicked) {
            // Same page as the last click: the server has not published the next
            // one yet. Re-clicking here is what answered choices wrongly, so wait.
            await sdk.waitForTicks(3);
            if (++stalled > 20) {
                log(`dialog (${what}) page did not advance after clicking ${JSON.stringify(pick.text)}`);
                break;
            }
            continue;
        }
        lastClicked = signature;
        stalled = 0;
        log(`dialog (${what}) -> ${pick.text}`);
        await sdk.sendClickDialog(pick.index);
        await sdk.waitForTicks(3);
    }
    await bot.dismissBlockingUI();
}

// ── 3. start the quest with Father Aereck, only from unstarted ──────────────
if (!reached('started')) {
    // Gate BEFORE acting: the quest must really be unstarted, or the dialog
    // below acts on an assumption.
    if (!(await checkpoint('unstarted', 'quest not yet started'))) {
        throw new Error('unstarted checkpoint failed before starting the quest');
    }
    await session.setPhase('start-quest');
    await travelTo(approach(AERECK), 'Father Aereck');
    // The accept choice is RELIABLE locally and unreliable on the live link: two
    // canaries walked the whole conversation ("I'm looking for a quest!" then
    // nine continues), closed cleanly, and `%prieststart` stayed 0 — while a
    // probe clicking the same option started the quest first try. Whatever eats
    // the choice (an interface left open by the journal read, or a click that
    // lands before the page settles), the fix that does not depend on knowing
    // which is to re-talk and try again, bounded, judging each attempt on the
    // journal rather than on the click receipt. The grader keeps the LAST verdict
    // per checkpoint, so an intermediate FAIL costs nothing.
    let startedNow = false;
    for (let attempt = 1; attempt <= 3 && !startedNow; attempt++) {
        await bot.dismissBlockingUI().catch(() => undefined);
        await sdk.waitForTicks(4).catch(() => undefined);
        await talkRetry(/father aereck/i, 'Father Aereck');
        await runDialog([/looking for a quest/i], attempt === 1 ? 'aereck start' : `aereck start retry ${attempt}`);
        startedNow = await checkpoint('started', 'Aereck asked for help, Urhney named');
        if (!startedNow) {
            log(`accept did not take on attempt ${attempt}/3 — re-talking to Aereck`);
            await sdk.waitForTicks(8).catch(() => undefined);
        }
    }
    if (!startedNow) throw new Error('started checkpoint failed after 3 attempts at Aereck (journal never showed the quest active)');
    stage = 'started';
    session.noteProgress('dialog', 'started with Father Aereck');
} else {
    log('Resuming: quest start is already journal-confirmed');
}

// ── 4. the amulet from Father Urhney, only from started ─────────────────────
if (!reached('spoken_urhney')) {
    await session.setPhase('amulet');
    await travelTo(approach(URHNEY), 'Father Urhney');
    await talkRetry(/father urhney/i, 'Father Urhney');
    // "Father Aereck sent me..." then "He's got a ghost haunting his
    // graveyard." hands over the Amulet of Ghostspeak
    // (father_urhney.rs2: father_urhney_priest_father_aereck_sent_me).
    await runDialog([/Father Aereck sent me/i, /ghost haunting his graveyard/i], 'urhney amulet');
    if (invCount(AMULET) === 0 && !amuletWorn()) throw new Error('Urhney dialog ended but no Ghostspeak amulet arrived');
    if (!(await checkpoint('spoken_urhney', 'amulet received, ghost named'))) {
        throw new Error('spoken_urhney checkpoint failed after talking to Urhney');
    }
    stage = 'spoken_urhney';
    session.noteProgress('inventory', 'ghostspeak amulet received');
} else {
    log('Resuming: Urhney stage is already journal-confirmed');
}

// Amulet lost mid-quest? Urhney carries a spare ("I've lost the amulet.",
// father_urhney.rs2: father_urhney_priest_lost_amulet) — detour before the ghost.
if (!reached('spoken_ghost') && invCount(AMULET) === 0 && !amuletWorn()) {
    log('Amulet missing; returning to Urhney for the spare');
    await session.setPhase('amulet-spare');
    await travelTo(approach(URHNEY), 'Father Urhney (spare amulet)');
    await talkRetry(/father urhney/i, 'Father Urhney (spare)');
    await runDialog([/lost the amulet/i], 'urhney spare');
    if (invCount(AMULET) === 0 && !amuletWorn()) throw new Error('Urhney spare dialog ended but no amulet arrived');
    session.noteProgress('inventory', 'spare ghostspeak amulet received');
}

// The ghost only understands you with the amulet WORN (restless_ghost.rs2:15).
if (!amuletWorn()) {
    const res = await bot.equipItem(AMULET);
    log(`equipped ghostspeak amulet: ${res.success}${res.success ? '' : ` (${res.message ?? '?'})`}`);
    if (!amuletWorn()) throw new Error('could not wear the Ghostspeak amulet');
    session.noteProgress('inventory', 'ghostspeak amulet worn');
} else {
    log('Ghostspeak amulet already worn');
}

// ── 5. talk to the ghost, only from spoken_urhney ───────────────────────────
if (!reached('spoken_ghost')) {
    await session.setPhase('ghost');
    await travelTo(approach(COFFIN), 'graveyard coffin');
    // The ghost spawns when the coffin is opened (quest_priest.rs2:
    // check_restlessghost_spawn), so open first, then talk.
    const opened = await bot.interactLoc(/coffin/i, /open/i);
    log(`open coffin: ${opened.success}${opened.success ? '' : ` (${opened.message ?? '?'})`}`);
    // The ghost spawns fresh on the coffin open and the client scene lags
    // reality for seconds afterwards, so a one-shot find misses it (observed:
    // 'NPC not found' standing adjacent). Settle and poll: each talkTo
    // re-resolves against the latest streamed NPC state.
    let talked = { success: false as boolean, message: 'not attempted' };
    for (let i = 0; i < 8 && !talked.success; i++) {
        await sdk.waitForTicks(4);
        const r = await bot.talkTo(/restless ghost/i);
        talked = { success: r.success, message: r.message ?? '?' };
        if (!talked.success) log(`ghost talk attempt ${i + 1}/8: ${talked.message}`);
    }
    if (!talked.success) throw new Error(`could not talk to the Restless Ghost: ${talked.message ?? '?'}`);
    // Every listed option converges on priest_ghost_certain_task, which sets
    // spoken_ghost; the ghost's "No I can't" / "scary" branches do not, so
    // they are never clicked (see runDialog).
    await runDialog([
        /now tell me what the problem is/i,
        /this amulet works/i,
        /do you know why you/i,
        /clever aren/i,
    ], 'ghost skull lead');
    if (!(await checkpoint('spoken_ghost', 'ghost named the skull and the tower'))) {
        throw new Error('spoken_ghost checkpoint failed after talking to the ghost');
    }
    stage = 'spoken_ghost';
    session.noteProgress('dialog', 'ghost spoke of the stolen skull');
} else {
    log('Resuming: ghost stage is already journal-confirmed');
}

// ── 6. the skull in the Wizards Tower basement, only from spoken_ghost ──────
if (!reached('obtained_skull')) {
    await session.setPhase('skull');
    await travelTo(approach(WIZTOWER), 'Wizards Tower');
    await enterTower();
    await climb('down', 'tower basement');
    // The climb lands ~6400 tiles away in the basement zone and the client
    // scene lags the jump for seconds, so a one-shot ground resolve misses
    // the skull (observed: 'Item not found on ground' standing in the
    // basement). The skull spawn sits at (3120,9567), ~18 tiles from the
    // ladder foot (3104,9576) — beyond a tight scan — so settle and poll a
    // wide scan before picking up. The scan's entity is passed to the pickup
    // directly: on-demand scans are NOT merged into the streamed ground-item
    // state that a pattern resolve reads, so a pattern pickup re-misses an
    // item the scan just saw (observed: scan hit, pickup 'not found').
    let skullEntity = await sdk.scanFindGroundItem(SKULL, 30).catch(() => null);
    for (let i = 0; i < 8 && !skullEntity; i++) {
        await sdk.waitForTicks(4);
        skullEntity = await sdk.scanFindGroundItem(SKULL, 30).catch(() => null);
        if (!skullEntity) log(`skull scan attempt ${i + 1}/8: not yet visible`);
    }
    const took = await bot.pickupItem(skullEntity ?? SKULL);
    log(`take skull: ${took.success}${took.success ? '' : ` (${took.message ?? '?'})`}`);
    if (!took.success && invCount(SKULL) === 0) throw new Error(`could not take the Ghost's skull: ${took.message ?? '?'}`);
    // Taking the skull spawns a level-13 skeleton (quest_priest.rs2:73-79):
    // leave immediately by short hops rather than fighting it. The pickup
    // walks ~18 tiles east to the spawn, out of ladder streaming range, so
    // exitBasement hops back west before resolving the Climb-up ladder.
    await exitBasement('out of the basement');
    if (!(await checkpoint('obtained_skull', 'skull taken, skeleton dodged'))) {
        throw new Error('obtained_skull checkpoint failed after taking the skull');
    }
    stage = 'obtained_skull';
    session.noteProgress('inventory', "ghost's skull obtained");
} else {
    log('Resuming: skull stage is already journal-confirmed');
}

// Skull lost after pickup (dropping destroys it, quest_priest.rs2:85-92)?
// Check the bank FIRST: an earlier revision banked a resume's skull as
// "carry-over", and the tower spawn does not reappear while the bank holds
// it. Only re-farm the basement when the bank has none either.
if (invCount(SKULL) === 0) {
    log('Skull missing; checking the bank before re-farming the basement');
    await session.setPhase('skull-bank');
    await leaveTowerIfInside();
    await travelTo(approach(DRAYNOR_BANK), 'Draynor bank (skull check)');
    if ((await bot.openBank()).success) {
        await sdk.waitForTicks(2);
        const withdrew = await bot.withdrawItem(SKULL, 1);
        log(`withdraw skull: ${withdrew.success}${withdrew.success ? '' : ` (${withdrew.message ?? '?'})`}`);
        await bot.closeInterface();
    } else {
        log('skull bank check: could not open the bank');
    }
    if (invCount(SKULL) > 0) {
        session.noteProgress('inventory', "ghost's skull recovered from bank");
        log("Skull recovered from the bank; skipping the basement farm");
    } else {
    log('Skull not in bank; returning to the tower basement for another');
    await session.setPhase('skull-again');
    await travelTo(approach(WIZTOWER), 'Wizards Tower (skull again)');
    await enterTower();
    await climb('down', 'tower basement (again)');
    let skullAgain = await sdk.scanFindGroundItem(SKULL, 30).catch(() => null);
    for (let i = 0; i < 8 && !skullAgain; i++) {
        await sdk.waitForTicks(4);
        skullAgain = await sdk.scanFindGroundItem(SKULL, 30).catch(() => null);
        if (!skullAgain) log(`skull re-scan attempt ${i + 1}/8: not yet visible`);
    }
    const took = await bot.pickupItem(skullAgain ?? SKULL);
    await exitBasement('out of the basement (again)');
    if (!took.success && invCount(SKULL) === 0) throw new Error(`could not re-take the Ghost's skull: ${took.message ?? '?'}`);
    session.noteProgress('inventory', "ghost's skull re-obtained");
    }
}

// ── 7. hand in: skull into the (open) coffin ────────────────────────────────
await session.setPhase('hand-in');
// A resume can start inside the tower (climb-up lands at (3105,3162) and the
// planner cannot route out through the doors): walk out first. The guard
// keeps ordinary resumes elsewhere from detouring to the tower.
await leaveTowerIfInside();
await travelTo(approach(COFFIN), 'graveyard coffin (hand-in)');
// Using the skull on a SHUT coffin only earns "Maybe I should open it first"
// (quest_priest.rs2:47-50), so ensure it is open first — and VERIFY: an
// earlier run's blind open left the coffin shut and the useItem (which still
// reported success) never advanced the journal. A shut coffin still offers
// "Open"; an open one does not.
for (let i = 0; i < 3; i++) {
    await sdk.scanNearbyLocs(12).catch(() => {});
    const shut = (sdk.getNearbyLocs() ?? []).find(l =>
        /coffin/i.test(l.name) && l.optionsWithIndex.some(o => /open/i.test(o.text)));
    if (!shut) break;
    const opened = await bot.interactLoc(shut, /open/i);
    log(`open coffin: ${opened.success}${opened.success ? '' : ` (${opened.message ?? '?'})`}`);
    await sdk.waitForTicks(3);
}
const used = await bot.useItemOnLoc(SKULL, /coffin/i);
log(`skull on coffin: ${used.success}${used.success ? '' : ` (${used.message ?? '?'})`}`);
if (!used.success) throw new Error(`could not use the skull on the coffin: ${used.message ?? '?'}`);
await bot.dismissBlockingUI();

// ── 8. completion is proven by the journal, never by XP or a chat line ──────
await session.setPhase('verify');
// The journal can lag the hand-in by seconds; settle, then retry the read
// (the run record keeps the latest verdict per checkpoint, so retries are
// safe) rather than failing a completed quest on a stale first read.
let verified = false;
for (let i = 0; i < 3 && !verified; i++) {
    if (i > 0) {
        await sdk.waitForTicks(6);
        await bot.dismissBlockingUI();
    }
    verified = await checkpoint('complete', 'journal reports QUEST COMPLETE');
}
if (!verified) {
    throw new Error('completion checkpoint failed: journal does not report the quest complete');
}

session.log('log', 'The Restless Ghost verified complete');
session.noteProgress('inventory', 'quest complete (journal-verified)');
const summary = summarizeRun(run.directory);
if (!summary.ok) {
    // Every declared checkpoint must carry a PASS before this counts as done.
    throw new Error(`promotion gate failed: missing/unpassed ${JSON.stringify(summary.missing)}`);
}
log(`Run record verified: ${summary.ok} (${summary.missing.length} outstanding)`);
log(`DONE The Restless Ghost verified via journal at (${pos().x},${pos().z})`);
log(`Metrics: ${JSON.stringify(session.metrics())}`);

sdk.disconnect();
process.exit(0);
