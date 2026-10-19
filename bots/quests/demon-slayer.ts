/**
 * Demon Slayer — replayable, checkpoint-gated.
 *
 *   bun bots/quests/demon-slayer.ts qldemon2
 *
 * State machine:
 *   bank (Varrock West) -> Gypsy Aris (Varrock square tent) -> Sir Prysin
 *   (Varrock Palace) -> 3 keys (palace-kitchen drain / Captain Rovin /
 *   Wizard Traiborn + 25 bones) -> Silverlight (Prysin) -> stone circle south
 *   of Varrock, Delrith fight -> journal complete.
 *
 * Every step that matters is gated on QUEST JOURNAL evidence, never on XP,
 * chat or a successful packet. The journal is the only client-visible record
 * of quest state: the general quest varps are not exposed, so it is the
 * portable checkpoint channel.
 *
 * Server sources (all paths under server/content):
 *   - scripts/quests/quest_demon/scripts/demon_journal.rs2 — the journal
 *     lines every rule below is quoted from (states: not_started,
 *     talked_aris, key_hunt incl. per-key lines, all-3, silverlight,
 *     complete)
 *   - scripts/quests/quest_demon/configs/demon.varp — demonstart stages:
 *     not_started=0, talked_aris=1, key_hunt=2, find_bones=3,
 *     got_traiborn_key=28, silverlight=29 (complete beyond that)
 *   - scripts/areas/area_varrock/scripts/gypsy.rs2 — Aris start dialog
 *   - scripts/areas/area_varrock/scripts/sir_prysin.rs2 — key-hunt briefing,
 *     all-3-keys handover of Silverlight
 *   - scripts/areas/area_varrock/scripts/captain_rovin.rs2 — key 2 dialog
 *     path ("this is important" -> "There's a demon...")
 *   - scripts/areas/area_draynor/scripts/traiborn.rs2 — key 1 ritual:
 *     25 bones, one per stage increment (find_bones..got_traiborn_key)
 *   - scripts/quests/quest_demon/scripts/demon_slayer.rs2 — drain key:
 *     bucket of water on the questdrain washes key 3 to the sewer
 *   - scripts/quests/quest_demon/scripts/delrith.rs2 — Delrith weakens on
 *     aggro; the banishing incantation is option 4,
 *     "Carlem Aber Camerinthum Purchai Gabindo"
 *   - scripts/general/scripts/quests.rs2:319 — completion is
 *     %demonstart=^demon_complete on questlist:demon ("Demon Slayer").
 *     No quest prerequisites.
 *
 * Known content gap (encoded defensively): the journal comments at
 * demon_journal.rs2:37-45 flag a missing-varp Traiborn bones-count line
 * ("Traiborn needs # more bones"). No rule below asserts a bones count, and
 * any UNKNOWN on a bones probe is treated as "keep handing bones", never as
 * a pass. UNKNOWN blocks promotion everywhere else.
 *
 * Route handling: waypoints computed offline from the repo's collision data
 * (`findLongPath`); each leg is walked one waypoint at a time with
 * displacement verified — a leg that moves nothing is an obstacle, not
 * something to retry. `bot.walkTo`/`talkTo` open blocking doors.
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
if (!existsSync(envPath)) throw new Error(`bot.env not found at ${envPath}. Usage: bun bots/quests/demon-slayer.ts <botname>`);
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
// Tiles below are staging points beside the real targets (NPCs wander a few
// tiles, doors and floor transitions are handled by walkTo/talkTo). They are
// approach tiles, not exact spawns — verify in game if a leg stalls.
const VARROCK_WEST_BANK = { x: 3186, z: 3436 };
const GYPSY_TENT = { x: 3205, z: 3424 };      // Gypsy Aris's tent, Varrock square
const PALACE_COURTYARD = { x: 3220, z: 3470 }; // Varrock Palace courtyard (staging only)
const PRYSIN_ROOM = { x: 3204, z: 3474 };     // palace west room where Sir Prysin stands (L0; verified live)
// HUMAN-VERIFIED STAIRCASE (user walked it live as qldemon2, position-traced):
// the correct staircase base is (3203,3496) L0 ground floor, directly below
// Rovin's room — NOT the west/east/kitchen towers (those lead to a decoy
// nook, an L1 dead pocket, an L1 dead pocket). One climb (possibly two quick
// climbs) lands at (3204,3497) L2 INSIDE Rovin's room. Rovin paces
// x3200-3206/z3494-3499 L2.
const ROVIN_STAIR_BASE = { x: 3203, z: 3496 };    // L0 staircase base (human-verified)
const ROVIN_STAIR_LANDING = { x: 3204, z: 3497 }; // L2 landing inside Rovin's room (human-verified)
// Rovin paces the guards' quarters (3200-3205, 3494-3498) behind a wall /
// furniture line the client router cannot cross from the west pocket around
// (3203,3493): a bot parked there reads "Cannot reach ... stops 3 tiles
// short". The z=3496 row is walkable straight across on L2 (verified against
// collision: 3203-3206 all '.'), so stand EAST of his pace box at (3206,3496)
// and wait for him to pace adjacent instead of talking across the room.
const ROVIN_STAND = { x: 3206, z: 3496 };     // L2-verified walkable east-side stand tile
const ROVIN_SHADOW = [                        // L2-verified walkable tiles hugging Rovin's pace box
    { x: 3206, z: 3496 }, { x: 3205, z: 3496 }, { x: 3204, z: 3496 },
    { x: 3203, z: 3496 }, { x: 3205, z: 3495 }, { x: 3204, z: 3495 },
];
const TRAIBORN_TOWER = { x: 3105, z: 3160 };  // Wizards' Tower, south of Draynor (ground approach)
const TOWER_STAIRS = { x: 3103, z: 3159 };    // tower L0 Staircase (Climb-up)
const TRAIBORN_L1 = { x: 3112, z: 3162 };     // Wizard Traiborn (level 1; verified live)
const SINK = { x: 3224, z: 3494 };            // palace kitchen sink (north wing, L0)
const DRAIN = { x: 3225, z: 3495 };           // questdrain beside the sink
const MANHOLE = { x: 3237, z: 3458 };         // palace-east manhole: Open, then Climb down to the sewer
// Where the washed-down key lands: demon_slayer.rs2 obj_add(0_50_154_25_41,
// ...) = 50*64+25, 154*64+41. NOTE the spawn lives only
// lootdrop_duration*3/2 = 300 ticks (~2 min): after the pour, go straight
// down with no detours or the key despawns before the pickup.
const SEWER_KEY_ROOM = { x: 3225, z: 9897 };
const SEWER_LADDER = { x: 3237, z: 9858 };    // sewer ladder (Climb-up) back to the manhole
const COMPLEX_LADDER = { x: 3230, z: 3504 };  // DEAD END, never use: ladder_cellar lands +6400z in a wall tile (3230,9904);
// The palace-north complex is left through its east door, never the sewer:
// Door (3243,3500) opens and walks straight out to (3247,3500) (verified live).
const COMPLEX_DOOR = { x: 3243, z: 3500 };
const COMPLEX_DOOR_OUT = { x: 3247, z: 3500 };
// Palace-north complex (kitchen/dining): walled, and long-path routing cannot
// leave it on its own (verified: PATHFINDING FAILED from inside). Leave
// through the east door — never the complex ladder (see COMPLEX_LADDER).
const NORTH_COMPLEX = { x1: 3215, z1: 3488, x2: 3245, z2: 3512 };
const inNorthComplex = (p: { x: number; z: number }) =>
    p.x >= NORTH_COMPLEX.x1 && p.x <= NORTH_COMPLEX.x2 && p.z >= NORTH_COMPLEX.z1 && p.z <= NORTH_COMPLEX.z2;
const STONE_CIRCLE = { x: 3225, z: 3366 };     // stone circle south of Varrock, Delrith's arena
const CHICKEN_COOP = { x: 3228, z: 3300 };     // east Lumbridge chicken coop (probe-verified in cooks-assistant.ts)
// Tower east pocket (ground floor): descending the wrong tower staircase
// lands here ~(3105,3160). Probe-verified 3x: the planner cannot route
// bank-ward from inside it — east hops target wall tiles of the north-east
// wall band ((3109,3175) is '#'; the east pocket Door (3107,3162) is not in
// the door mask), and only the west exit via (3102,3161) routes. Step out
// west before planning, mirroring the palace-north-complex escape below.
const TOWER_POCKET = { x1: 3104, z1: 3160, x2: 3107, z2: 3165 };
const inTowerPocket = (p: { x: number; z: number }) =>
    p.x >= TOWER_POCKET.x1 && p.x <= TOWER_POCKET.x2 && p.z >= TOWER_POCKET.z1 && p.z <= TOWER_POCKET.z2;
const TOWER_WEST_EXIT = [{ x: 3105, z: 3161 }, { x: 3103, z: 3161 }, { x: 3102, z: 3161 }];

const GYPSY_FEE_COINS = 1;   // "Cross my palm with silver" — one coin for the fortune
const TRAIBORN_BONES = 25;   // find_bones(3)..got_traiborn_key(28): one bone per stage
const DELRITH_INCANTATION = /carlem aber camerinthum purchai gabindo/i; // delrith.rs2 option 4

/**
 * Route waypoints are COMPUTED AT RUNTIME from the repo's collision data rather
 * than hardcoded. A hardcoded list only works from one start tile, and a bot
 * restarted mid-quest (or moved by a previous leg) would have to be repositioned
 * by hand. Planning from the live position removes that whole class of problem,
 * and collision data is a local file, so it costs nothing at runtime.
 */
const WAYPOINT_SPACING = 6;

function planWaypoints(from: { x: number; z: number }, to: { x: number; z: number }): { x: number; z: number }[] {
    const raw = findLongPath(0, from.x, from.z, to.x, to.z);
    if (raw.length === 0) return [to];
    // Walk the polyline, not just its corners: findLongPath returns sparse
    // corner points, and sampling only corners leaves 30+ tile hops that a
    // single closed door refuses wholesale. Subdivide every segment so no hop
    // exceeds WAYPOINT_SPACING — a hop that straddles a closed door then
    // starts close enough for the door to be in scan range for the open retry.
    const pts = [{ x: from.x, z: from.z }, ...raw.map(p => ({ x: p.x, z: p.z }))];
    const last = pts[pts.length - 1]!;
    if (last.x !== to.x || last.z !== to.z) pts.push({ x: to.x, z: to.z });
    const way: { x: number; z: number }[] = [];
    let prev = pts[0]!;
    for (let i = 1; i < pts.length; i++) {
        const cur = pts[i]!;
        let dx = cur.x - prev.x, dz = cur.z - prev.z;
        let dist = Math.hypot(dx, dz);
        while (dist > WAYPOINT_SPACING) {
            const t = WAYPOINT_SPACING / dist;
            const nx = Math.round(prev.x + dx * t), nz = Math.round(prev.z + dz * t);
            way.push({ x: nx, z: nz });
            prev = { x: nx, z: nz };
            dx = cur.x - prev.x; dz = cur.z - prev.z; dist = Math.hypot(dx, dz);
        }
        way.push(cur);
        prev = cur;
    }
    return way.filter((w, i) => i === 0 || Math.hypot(w.x - way[i - 1]!.x, w.z - way[i - 1]!.z) >= 1);
}

/** Somewhere beside a target tile that can actually be stood on. */
function approachTile(near: { x: number; z: number }): { x: number; z: number } {
    for (const cand of [
        { x: near.x, z: near.z + 1 }, { x: near.x - 1, z: near.z + 1 },
        { x: near.x + 1, z: near.z }, { x: near.x, z: near.z },
    ]) {
        if (isTileWalkable(0, cand.x, cand.z)) return cand;
    }
    return { x: near.x, z: near.z + 1 };
}

const JOURNAL = { label: 'Demon Slayer', title: 'Demon Slayer' };

// Journal rules, quoted from the quest's own journal script
// (server/content/scripts/quests/quest_demon/scripts/demon_journal.rs2):
//   not_started -> "I can start this quest by speaking to the Gypsy in the
//     tent in Varrock's main square..."
//   talked_aris -> "...I should ask Sir Prysin in Varrock Palace where it is."
//   key_hunt    -> "Sir Prysin needs 3 keys before he can give me Silverlight."
//     + per-key lines: "The 1st Key was dropped down the palace kitchen
//     drains." / "The 2nd Key is with Captain Rovin in Varrock Palace." /
//     "The 3rd Key is with Wizard Traiborn at the Wizards' Tower..." — or,
//     when carried, "I have the Nth Key with me."
//   all-3       -> "Now I have all 3 keys I should go and speak to Sir Prysin
//     and collect the magical sword Silverlight from him."
//   silverlight -> "Now I should go to the stone circle south of the city and
//     destroy Delrith using Silverlight!"
//   complete    -> "...Using its power I managed to destroy the demon Delrith
//     like the great hero Wally did many years before. QUEST COMPLETE!"
//
// Defensive note: the journal's commented-out Traiborn bones-count block
// (lines 37-45) has no backing varp, so NO rule asserts a bones count. The
// Traiborn leg is driven by inventory (key in bag?) plus the have/third-key
// journal lines, never by a number the server cannot render.
const RULES: Record<string, JournalRule> = {
    unstarted: { id: 'demon:unstarted', kind: 'unstarted', all: ['I can start this quest by speaking to the', 'Gypsy'] },
    talked_aris: { id: 'demon:talked_aris', kind: 'active', all: ['I should ask', 'Sir Prysin', 'where it is'] },
    key_hunt: { id: 'demon:key_hunt', kind: 'active', all: ['needs', '3 keys', 'before he can give me'] },
    key1_missing: { id: 'demon:key1_missing', kind: 'active', all: ['1st Key', 'palace kitchen drains'] },
    key1_have: { id: 'demon:key1_have', kind: 'active', all: ['I have the 1st Key with me'] },
    key2_missing: { id: 'demon:key2_missing', kind: 'active', all: ['2nd Key', 'Captain Rovin'] },
    key2_have: { id: 'demon:key2_have', kind: 'active', all: ['I have the 2nd Key with me'] },
    key3_missing: { id: 'demon:key3_missing', kind: 'active', all: ['3rd Key', 'Wizard Traiborn'] },
    key3_have: { id: 'demon:key3_have', kind: 'active', all: ['I have the 3rd Key with me'] },
    all_3: { id: 'demon:all_3', kind: 'active', all: ['all 3 keys', 'collect the magical sword', 'Silverlight'] },
    silverlight: { id: 'demon:silverlight', kind: 'active', all: ['stone circle south of the city', 'Delrith', 'Silverlight'] },
    complete: { id: 'demon:complete', kind: 'complete', all: ['QUEST COMPLETE', 'destroy the demon Delrith'] },
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
    name: 'demon slayer',
    grindLogPath: GRIND_LOG,
    maxRecoveryTactics: 8,
});

await session.setPhase('start');

const pos = () => {
    const p = sdk.getState()?.player;
    return { x: p?.worldX ?? 0, z: p?.worldZ ?? 0, level: p?.level ?? 0 };
};
const distTo = (t: { x: number; z: number }) => Math.hypot(pos().x - t.x, pos().z - t.z);
/** Arrival in walkTo's own metric: Chebyshev tiles within its tolerance. */
const arrivedCheb = (a: { x: number; z: number }, b: { x: number; z: number }, tol = 3) =>
    Math.max(Math.abs(a.x - b.x), Math.abs(a.z - b.z)) <= tol;
const invCount = (pattern: RegExp) =>
    sdk.getInventory().filter(i => pattern.test(i.name)).reduce((n, i) => n + (i.count ?? 1), 0);
const hasKey = () => invCount(/^key$/i) > 0;

/**
 * Withdraw up to `target` of `pattern`, surviving the bank interface dropping
 * mid-sequence (rule 9) and partial fills ("Withdrew Trout x2 of 5"). Needs
 * are recomputed from the live bag every attempt, so a timeout that still
 * moved items only tops up the remainder. Throws only when the item is
 * provably absent or still short after reopen retries.
 */
async function withdrawUpTo(pattern: RegExp, target: number, what: string, perCall = Number.MAX_SAFE_INTEGER): Promise<void> {
    for (let attempt = 0; attempt < 6; attempt++) {
        const need = target - invCount(pattern);
        if (need <= 0) return;
        if (!sdk.getState()?.interface?.isOpen) {
            log(`bank not open before ${what} withdraw — reopening`);
            await bot.closeInterface();
            if (!(await bot.openBank()).success) continue;
            await sdk.waitForTicks(2);
        }
        // Small takes: a 5-trout take lands 2-in-window then stalls, so
        // stackables go in capped round trips with the need recomputed after
        // each (verified live).
        const res = await bot.withdrawItem(pattern, Math.min(need, perCall));
        log(`withdrew ${what} (need ${need}): ${res.success}${res.success ? '' : ` (${res.message ?? '?'})`}`);
        await sdk.waitForTicks(1);
        if ((res as any).reason === 'item_not_found') throw new Error(`could not withdraw ${what}: not in bank`);
        if (!res.success) {
            // A timeout may mean the server already considers the bank closed
            // while the client flag still reads open: force a fresh open
            // rather than trusting isOpen on the next attempt.
            log(`forced bank reopen after failed ${what} withdraw`);
            await bot.closeInterface();
            await sdk.waitForTicks(1);
            if (!(await bot.openBank()).success) continue;
            await sdk.waitForCondition(s => ((s as any).bank?.items?.length ?? 0) > 0, 8_000).catch(() => {});
            await sdk.waitForTicks(2);
        }
    }
    const short = target - invCount(pattern);
    if (short > 0) throw new Error(`could not withdraw ${what}: still ${short} short after reopen retries`);
}

// ── durable run record ──────────────────────────────────────────────────────
// Checkpoint evidence is written verbatim as the run proceeds, so an audit does
// not depend on the script's own stdout or on telemetry that sampling truncates.
const MODE = process.env.QUEST_LAB_MODE === 'staging' ? 'staging' : 'development';
const run = createRun(join(process.cwd(), 'quest-lab', 'runs'), safeRunId('demon', username, new Date().toISOString()), {
    questId: 'demon',
    account: username,
    mode: MODE,
    scriptHash: Bun.hash(await Bun.file(import.meta.path).text()).toString(16),
    fixtureHash: process.env.QUEST_LAB_FIXTURE_HASH ?? 'unrecorded',
    contentHash: process.env.QUEST_LAB_CONTENT_HASH ?? 'unrecorded',
    requiredCheckpoints: ['unstarted', 'talked_aris', 'key_hunt', 'all_3', 'silverlight', 'complete'],
});
log(`Run record: ${run.directory} (mode=${MODE})`);

/**
 * The quest-tab side interface streams in late after login (ernest's qlpriest9
 * showed the same "no side interface" UNKNOWN burst, then read fine on a
 * settled client). readJournalCheckpoint only allows 4 ticks after setTab, so
 * park on the quest tab until the side interface is actually published —
 * bounded, so a genuinely broken tab still fails loudly instead of hanging
 * the run. Early UNKNOWNs are not-ready, not evidence.
 */
async function awaitQuestTab(why: string): Promise<void> {
    if (readSideInterface(sdk)) return;
    await sdk.sendSetTab(QUEST_JOURNAL_TAB).catch(() => {});
    // Extended settle: when attached to a live browser-tab session (a watcher
    // keeps the account online, so autoLaunchBrowser skips its own client),
    // the quest-list side interface only publishes after THAT client shows the
    // Quest journal tab — sendSetTab is a local highlight and sends nothing
    // server-side. Wait up to 2 min, saying so, before probes report UNKNOWN.
    const t0 = Date.now();
    while (Date.now() - t0 < 120_000) {
        await sdk.waitForTicks(5);
        if (readSideInterface(sdk)) {
            log(`quest tab settled for ${why} after ${Math.round((Date.now() - t0) / 1000)}s`);
            return;
        }
        const el = Math.round((Date.now() - t0) / 1000);
        if (el % 15 < 5) log(`waiting for the quest-tab side interface (${el}s/120s for ${why}) — if watching in a browser, open the Quest journal tab`);
    }
    log(`quest tab side interface never published for ${why} — probes will report UNKNOWN`);
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

/**
 * Drive a multi-page NPC dialog. Each round, the first option matching the
 * earliest unmatched pick wins; unmatched option lists fall through to the
 * first option so quest dialogs never stall on flavour branches. Returns when
 * the dialog stays closed.
 */
async function driveDialog(picks: RegExp[], maxRounds = 40): Promise<void> {
    let quiet = 0;
    for (let i = 0; i < maxRounds; i++) {
        const dialog = sdk.getDialog();
        if (!dialog?.isOpen) {
            await sdk.waitForTicks(1);
            if (!sdk.getDialog()?.isOpen && ++quiet > 2) break;
            continue;
        }
        quiet = 0;
        const options = dialog.options ?? [];
        // Dialog pages with no options just need a tick to advance.
        if (options.length === 0) {
            await sdk.waitForTicks(2);
            continue;
        }
        const pick = picks.map(re => options.find(o => re.test(o.text))).find(Boolean) ?? options[0];
        if (pick) {
            log(`dialog -> ${pick.text}`);
            await sdk.sendClickDialog(pick.index);
        }
        await sdk.waitForTicks(2);
    }
    await bot.dismissBlockingUI();
}

// ── 1. what stage is this account actually at? ──────────────────────────────
// Read the journal BEFORE banking. A finished quest has nothing left to do, and
// a bot resumed mid-quest should bank only for what it still lacks. Banking
// first made completed quests report "insufficient stock" instead of "already
// complete" — and walk across the map to do it.
await session.setPhase('inspect');

/**
 * The first stage rule that PASSes is the account's real stage. Probes run
 * complete-first so a finished account exits before touching anything; the
 * all-3 probe precedes key_hunt because both live under the same key_hunt
 * varp arm and only the carried-keys line distinguishes them.
 */
type Stage = 'unstarted' | 'talked_aris' | 'key_hunt' | 'all_3' | 'silverlight' | 'complete' | 'unknown';
async function readStage(): Promise<Stage> {
    await awaitQuestTab('stage probe');
    for (const name of ['complete', 'silverlight', 'all_3', 'key_hunt', 'talked_aris', 'unstarted'] as const) {
        const read = await readJournalCheckpoint(sdk, JOURNAL, RULES[name]!);
        log(`  stage probe ${name}: ${read.verdict?.verdict ?? 'UNKNOWN'} (${read.reason})`);
        if (read.verdict?.verdict === 'PASS') {
            if (name === 'all_3') return 'all_3';
            return name;
        }
    }
    return 'unknown';
}

const STAGE = await readStage();
log(`Quest stage at start: ${STAGE}`);
if (STAGE === 'complete') {
    log('Demon Slayer is already complete — nothing to do');
    session.log('log', 'quest already complete; nothing to do');
    sdk.disconnect();
    process.exit(0);
}
if (STAGE === 'unknown') throw new Error('could not determine the quest stage from the journal');

// ── travel ──────────────────────────────────────────────────────────────────
/**
 * Interact with a loc from beside it, trying every walkable neighbouring tile
 * until `verify()` passes. The engine's reach check is directional: a ladder
 * against a wall answers "Can't reach that" from the wrong side even at cheb
 * 1 (verified live at the palace-north ladder (3230,3504): adjacent-south
 * reads cant_reach). One blind interact from wherever the bot stands is never
 * enough for a ladder — always go through here.
 */
async function interactLocFromSides(loc: any, option: RegExp, verify: () => boolean, what: string): Promise<boolean> {
    const sides = [
        { x: loc.x + 1, z: loc.z }, { x: loc.x - 1, z: loc.z },
        { x: loc.x, z: loc.z + 1 }, { x: loc.x, z: loc.z - 1 },
        { x: loc.x + 1, z: loc.z + 1 }, { x: loc.x - 1, z: loc.z - 1 },
        { x: loc.x + 1, z: loc.z - 1 }, { x: loc.x - 1, z: loc.z + 1 },
    ].filter(t => { try { return isTileWalkable(pos().level, t.x, t.z); } catch { return false; } })
        .sort((a, b) => Math.max(Math.abs(a.x - pos().x), Math.abs(a.z - pos().z))
            - Math.max(Math.abs(b.x - pos().x), Math.abs(b.z - pos().z)));
    for (const side of sides) {
        if (Math.max(Math.abs(side.x - pos().x), Math.abs(side.z - pos().z)) > 0) {
            await bot.walkTo(side.x, side.z, 1);
            await sdk.waitForTicks(2);
        }
        const r = await bot.interactLoc(loc, option);
        log(`${what} from (${side.x},${side.z}): ${r.success}${r.success ? '' : ` (${(r as any).reason ?? ''} ${(r as any).message ?? ''})`}`);
        if (r.success) {
            // Arrival-delay climbs (p_arrivedelay) land ticks AFTER dispatch:
            // hold still and poll. Walking to the next side cancels the climb
            // — that exact race burned two full runs at the complex ladder.
            try {
                await sdk.waitForCondition(() => verify() as unknown as boolean, 15_000);
            } catch { /* still false — try the next side */ }
            await sdk.waitForTicks(2);
            if (verify()) return true;
        } else {
            await sdk.waitForTicks(3);
            if (verify()) return true;
        }
    }
    return false;
}
/**
 * Walk to a destination via planned waypoints. Each leg is verified: a leg that
 * moves nothing is an obstacle, and retrying the same bearing cannot help.
 */
async function travelTo(dest: { x: number; z: number }, what: string): Promise<void> {
    // Escape the tower east pocket first: descending the wrong tower stairs
    // strands the bot here, and long-path routing cannot leave it (east hops
    // target wall tiles; only the west exit routes — see TOWER_POCKET). Step
    // out west along the probe-verified tiles before planning anything.
    if (pos().level === 0 && pos().z <= 9000 && inTowerPocket(pos()) && !inTowerPocket(dest)) {
        log(`In the tower east pocket at (${pos().x},${pos().z}) — stepping out west before ${what}`);
        // TEMP-DEBUG: dump every loc in scan so the shut-west-door opener can
        // be identified precisely (name + options + tile).
        try {
            const all = (sdk.getNearbyLocs() ?? []).map(l => `${l.name}@(${l.x},${l.z})[${(l.optionsWithIndex ?? []).map(o => o.text).join('/')}]`);
            log(`POCKET-SCAN (${all.length} locs): ${all.join(' | ').slice(0, 2000)}`);
        } catch (e) { log(`POCKET-SCAN failed: ${(e as Error).message}`); }
        // Bug-escape: both planners disagree with live routing around this
        // room (static door mask vs live door states), so don't plan — probe.
        // Primary: SOUTH out the main entrance. The south/main doors are
        // published and openable (proven every climb), so open-then-step
        // micro-hops with freshly opened doors thread the interior while
        // the west/east edges have no openable loc when shut. Fallback: hop
        // toward every plausible exit, keeping whichever moves, until CLEAR.
        // Clear means outside the rect AND past a line (x<=3102 west,
        // x>=3108 east, z<=3157 south): (3103,3161) reads "outside" but plans
        // a route that cuts back east through the open door into the pocket
        // and wedges (observed BLOCKED). walkTo auto-opens published shut
        // doors en route.
        const SOUTH_OUT = [
            { x: 3106, z: 3159 }, { x: 3106, z: 3158 }, { x: 3107, z: 3158 },
            { x: 3108, z: 3158 }, { x: 3108, z: 3156 },
        ];
        const EXITS = [
            { x: 3102, z: 3161 }, { x: 3100, z: 3161 },
            { x: 3109, z: 3166 }, { x: 3111, z: 3167 }, { x: 3109, z: 3175 }, { x: 3113, z: 3181 },
            { x: 3106, z: 3158 }, { x: 3108, z: 3157 },
        ];
        const clearOfPocket = (p: { x: number; z: number }) =>
            !inTowerPocket(p) && (p.x <= 3102 || p.x >= 3108 || p.z <= 3157);
        let out = pos();
        // South sequence first: tightly coupled open-then-step, since the
        // doors shut on minute timers.
        if (inTowerPocket(out)) {
            for (const tile of SOUTH_OUT) {
                await openNearbyDoors(`tower pocket exit south (${what})`, 5);
                const before = pos();
                if (Math.hypot(tile.x - before.x, tile.z - before.z) > 14) break;
                await bot.walkTo(tile.x, tile.z, 1);
                await sdk.waitForTicks(2);
                out = pos();
                log(`pocket exit south -> (${tile.x},${tile.z}) at (${out.x},${out.z})`);
                if (clearOfPocket(out)) break;
                if (Math.hypot(out.x - before.x, out.z - before.z) < 1) {
                    log(`pocket exit south stalled at (${out.x},${out.z}) — falling back to probing`);
                    break;
                }
            }
        }
        for (let round = 0; round < 12 && !clearOfPocket(out); round++) {
            await openNearbyDoors(`tower pocket exit (${what})`, 5);
            let moved = false;
            for (const hop of EXITS) {
                if (Math.hypot(hop.x - out.x, hop.z - out.z) > 14) continue;
                const before = out;
                const r = await bot.walkTo(hop.x, hop.z, 2);
                await sdk.waitForTicks(2);
                out = pos();
                const step = Math.hypot(out.x - before.x, out.z - before.z);
                if (step >= 1) {
                    moved = true;
                    log(`pocket exit hop -> (${hop.x},${hop.z}) moved=${step.toFixed(1)} at (${out.x},${out.z}) ok=${(r as any).success}`);
                    // Door-line residue: walkTo with tolerance stops one tile
                    // short of the line ((3103,3161) reads near enough), and
                    // later hops wander off again — nudge exact immediately,
                    // before any other hop moves away.
                    if (!clearOfPocket(out) && Math.abs(out.x - 3102) + Math.abs(out.z - 3161) <= 2) {
                        const n = await bot.walkTo(3102, 3161, 0);
                        await sdk.waitForTicks(2);
                        out = pos();
                        log(`pocket door-line nudge -> (3102,3161): ok=${(n as any).success} at (${out.x},${out.z})`);
                    }
                    if (clearOfPocket(out)) break;
                }
            }
            out = pos();
            if (!clearOfPocket(out)) log(`pocket exit round ${round + 1}/12 still inside/unclear at (${out.x},${out.z}) moved=${moved} — reopening`);
        }
        out = pos();
        if (!clearOfPocket(out)) throw new Error(`could not leave the tower east pocket for ${what} (at ${out.x},${out.z})`);
        log(`Out of the pocket at (${out.x},${out.z}) l${out.level}`);
    }
    // Escape the palace-north complex first: long-path routing cannot leave it
    // on its own, so go out the east door (COMPLEX_DOOR opens; the walk out to
    // COMPLEX_DOOR_OUT is verified live). Never the complex ladder — its
    // cellar exit is a wall tile and the climb never lands.
    if (pos().level === 0 && pos().z <= 9000 && inNorthComplex(pos()) && !inNorthComplex(dest)) {
        log(`In the palace-north complex — leaving through the east door before ${what}`);
        let out = false;
        for (let round = 0; round < 3 && !out; round++) {
            await travelTo({ x: 3242, z: 3500 }, 'the complex east door');
            const door = (sdk.getNearbyLocs() ?? [])
                .filter(l => /door/i.test(l.name ?? '')
                    && Math.abs(l.x - COMPLEX_DOOR.x) + Math.abs(l.z - COMPLEX_DOOR.z) < 6)
                .sort((a, b) => (a.distance ?? 99) - (b.distance ?? 99))[0];
            if (door && door.optionsWithIndex.some(o => /open/i.test(o.text))) {
                const opened = await bot.interactLoc(door, /open/i);
                log(`opened the complex east door: ${opened.success}${opened.success ? '' : ` (${(opened as any).message ?? '?'})`}`);
                await sdk.waitForTicks(2);
            }
            for (const step of [{ x: 3243, z: 3500 }, { x: 3245, z: 3500 }, { ...COMPLEX_DOOR_OUT }]) {
                await bot.walkTo(step.x, step.z, 1);
                await sdk.waitForTicks(1);
                if (!inNorthComplex(pos())) break;
            }
            out = !inNorthComplex(pos());
            if (!out) log(`still inside the complex at (${pos().x},${pos().z}) — retrying the door (round ${round + 2}/3)`);
        }
        if (!out) throw new Error(`could not leave the palace-north complex (at ${pos().x},${pos().z})`);
        log(`Out of the complex at (${pos().x},${pos().z}) l${pos().level}`);
    }
    // A resume can leave the bot in the sewer (z ~98xx) while the target is on
    // the surface: plane-0 pathfinding cannot cross that boundary, so climb
    // out first. (Observed: a sewer resume planned bank legs into the void.)
    if (pos().z > 9000 && dest.z <= 9000) {
        log(`In the sewer at (${pos().x},${pos().z}) — climbing out before ${what}`);
        // Always use the manhole ladder: the key-room ladder exits into the
        // walled palace-north complex (observed: surfaced at 3230,3505 with
        // no routable path back into the palace).
        await travelTo({ ...SEWER_LADDER }, 'the sewer ladder');
        const lad = (sdk.getNearbyLocs() ?? []).find(l => /ladder/i.test(l.name ?? '')
            && l.optionsWithIndex.some(o => /climb[- ]up/i.test(o.text)));
        if (!lad) throw new Error('no climb-up ladder visible at the sewer ladder tile');
        if (!(await interactLocFromSides(lad, /climb[- ]up/i, () => pos().z <= 9000,
            `sewer climb ${lad.name} at (${lad.x},${lad.z})`))) throw new Error('could not climb out of the sewer');
        log(`Out of the sewer at (${pos().x},${pos().z}) l${pos().level}`);
    }
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
            moved = step >= 1 || arrivedCheb(after, wp);
            log(`leg ${i + 1}/${waypoints.length} -> (${wp.x},${wp.z}) moved=${step.toFixed(1)} at (${after.x},${after.z}) l${after.level} ok=${res.success}${res.success ? '' : ` (${(res as any).message ?? '?'})`}`);
        }
        if (!moved) {
            // A closed door on the bearing reads as "Stuck": open the nearest
            // openable doors, then retry the leg once before any detour.
            // Palace doors auto-close (Large door @ 3212,3470 and the outer
            // doors @ 3209/3216,3458), so a route that walked clean minutes
            // ago can refuse wholesale — short hops keep the door in scan
            // range when the retry runs.
            const doors = (sdk.getNearbyLocs() ?? [])
                .filter(l => /door/i.test(l.name ?? '') && l.optionsWithIndex.some(o => /open/i.test(o.text)))
                .sort((a, b) => (a.distance ?? 99) - (b.distance ?? 99)).slice(0, 3);
            for (const door of doors) {
                const open = await bot.interactLoc(door, /open/i);
                log(`opened ${door.name} at (${door.x},${door.z}) for leg ${i + 1}/${waypoints.length}: ${open.success}`);
                await sdk.waitForTicks(2);
            }
            if (doors.length) {
                const retry = await bot.walkTo(wp.x, wp.z, 3);
                await sdk.waitForTicks(2);
                const afterRetry = pos();
                const stepRetry = Math.hypot(afterRetry.x - before.x, afterRetry.z - before.z);
                moved = stepRetry >= 1 || arrivedCheb(afterRetry, wp);
                log(`retry ${i + 1}/${waypoints.length} -> (${wp.x},${wp.z}) moved=${stepRetry.toFixed(1)} at (${afterRetry.x},${afterRetry.z}) l${afterRetry.level} ok=${retry.success}`);
            }
        }
        if (!moved) {
            // A sampled waypoint can sit on a door tile (an unwalkable
            // target): step to a verified walkable tile beside it and carry
            // on. The next leg's walkTo opens the door itself.
            const alt = approachTile(wp);
            if (alt.x !== wp.x || alt.z !== wp.z) {
                const detour = await bot.walkTo(alt.x, alt.z, 3);
                await sdk.waitForTicks(2);
                const after = pos();
                const step = Math.hypot(after.x - before.x, after.z - before.z);
                moved = step >= 1 || arrivedCheb(after, wp, 4);
                log(`detour -> (${alt.x},${alt.z}) moved=${step.toFixed(1)} at (${after.x},${after.z}) l${after.level} ok=${detour.success}`);
            }
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

// ── 2. bank, but only for supplies the current stage still lacks ─────────────
// NEED_* were once frozen at startup: a run banked at `unstarted` (coins+food)
// never stocked the bones/bucket the later key legs need, so the drain leg
// threw `no bucket` and the Traiborn re-bank withdrew nothing. Needs are
// recomputed from a fresh stage probe on EVERY bank visit, and the key hunt
// re-banks after the Prysin briefing (section 4/5 boundary).
//
// A second lesson is bag budget (28 slots): 25 bones + bucket + 5 food = 31
// does NOT fit, so each visit stocks ONE leg's list, never the whole quest:
//   briefing -> bucket + fight food (drain-ready)
//   bones    -> 25 bones + carried keys (ritual trip, no food refresh)
//   fight    -> food + carried Silverlight (Delrith-ready)
type BankPurpose = 'briefing' | 'bones' | 'fight' | 'none';
function needsFor(stage: Stage, purpose: BankPurpose): { coins: number; bones: boolean; bucket: boolean; food: boolean } {
    return {
        coins: purpose === 'briefing' && stage === 'unstarted' ? GYPSY_FEE_COINS : 0,
        bones: purpose === 'bones' && invCount(/^bones$/i) < TRAIBORN_BONES,
        bucket: purpose === 'briefing' && invCount(/^bucket/i) === 0,
        food: (purpose === 'briefing' || purpose === 'fight') && invCount(/^(trout|salmon|tuna|lobster|swordfish|shark|meat|bread|cake)/i) < 5,
    };
}

/** Which shopping list each quest point needs. `all_3` needs nothing (keys stay carried). */
function purposeFor(stage: Stage): BankPurpose {
    if (stage === 'all_3') return 'none';
    if (stage === 'silverlight') return 'fight';
    return 'briefing';
}

/**
 * Bone-farming fallback (human-directed): when the bank cannot cover
 * Traiborn's 25-bone need, earn exactly the measured deficit from Lumbridge
 * chickens — kill, loot bones, bank them at Varrock West — instead of idling.
 * Bounded (kill cap + time box); returns bones gained. Hens are level 1 and
 * never fight back, so no food or weapon is needed. A zero return keeps the
 * caller's clean idle as the final backstop.
 */
async function farmBones(deficit: number): Promise<number> {
    await session.setPhase('farm-bones');
    const FARM_MAX_KILLS = deficit + 5;      // 1:1 drops expected; slack for lost loot
    const FARM_MAX_MS = 10 * 60_000;         // time box for the whole trip
    const startBones = invCount(/^bones$/i);
    log(`Bone farm start: deficit=${deficit} carried=${startBones} (cap ${FARM_MAX_KILLS} kills, 10 min)`);
    await ensureLevel0('bone farm');
    await travelTo(approachTile(CHICKEN_COOP), 'the Lumbridge chicken coop');
    let kills = 0;
    const t0 = Date.now();
    while (invCount(/^bones$/i) - startBones < deficit && kills < FARM_MAX_KILLS && Date.now() - t0 < FARM_MAX_MS) {
        let bird = (sdk.getNearbyNpcs() ?? []).find(n => /^chicken$/i.test(n.name ?? ''));
        if (!bird) {
            // Coop wander/respawn: wait a beat, then one small reposition to
            // pull distant birds into scan before giving up the round.
            await sdk.waitForTicks(6);
            bird = (sdk.getNearbyNpcs() ?? []).find(n => /^chicken$/i.test(n.name ?? ''));
            if (!bird) {
                const step = await bot.walkTo(CHICKEN_COOP.x - 3, CHICKEN_COOP.z + 3, 3);
                await sdk.waitForTicks(4);
                bird = (sdk.getNearbyNpcs() ?? []).find(n => /^chicken$/i.test(n.name ?? ''));
                if (!bird) {
                    log(`farm: no chickens in scan (round ${kills + 1}, moved=${step.success}) — waiting for respawn`);
                    await sdk.waitForTicks(10);
                    continue;
                }
            }
        }
        const idx = (bird as any).index;
        const atk = await bot.attack(bird as any);
        if (!atk.success) {
            log(`farm kill ${kills + 1}: attack failed (${(atk as any).message ?? (atk as any).reason ?? '?'}) — retrying`);
            await sdk.waitForTicks(4);
            continue;
        }
        // Wait for the kill (bird leaves scan) — prompt loot beats despawn.
        for (let i = 0; i < 30; i++) {
            await sdk.waitForTicks(2);
            if (!(sdk.getNearbyNpcs() ?? []).some(n => (n as any).index === idx)) break;
        }
        kills++;
        const before = invCount(/^bones$/i);
        for (let l = 0; l < 3; l++) {
            const pk = await bot.pickupItem(/^bones$/i);
            await sdk.waitForTicks(2);
            if (invCount(/^bones$/i) > before) break;
            if (!pk.success && /not found/i.test((pk as any).message ?? (pk as any).reason ?? '')) break;
        }
        log(`farm kill ${kills}: bones=${invCount(/^bones$/i)} (+${invCount(/^bones$/i) - startBones}/${deficit})`);
    }
    const gained = invCount(/^bones$/i) - startBones;
    log(`Bone farm kills done: +${gained}/${deficit} bones (${kills} kills in ${Math.round((Date.now() - t0) / 1000)}s)`);
    if (gained > 0) {
        await travelTo(VARROCK_WEST_BANK, 'Varrock West bank (farm deposit)');
        await bot.closeInterface();
        if ((await bot.openBank()).success) {
            const dep = await bot.depositItem(/^bones$/i, -1);
            log(`farm deposit bones: ${dep.success}`);
            await sdk.waitForTicks(3);
        } else {
            log('farm deposit FAILED: bank would not open — carrying the bones on');
        }
        await bot.closeInterface();
    }
    session.log('log', `bone farm +${gained}/${deficit} (${kills} kills)`);
    return gained;
}

async function bankForSupplies(purpose: BankPurpose): Promise<void> {
    if (purpose === 'none') {
        log('No bank list for this quest point; skipping');
        return;
    }
    // Fast path: the bag already holds everything this purpose needs, and any
    // keys/Silverlight the stage implies are carried (a completed bank visit
    // always pulls banked keys back, and legs never deposit, so carried keys
    // mean none are banked). Skip the trip: a resume parked upstairs must not
    // climb down for a no-op bank.
    {
        const stageNow = await readStage();
        const pre = needsFor(stageNow, purpose);
        const nothingNeeded = !pre.coins && !pre.bones && !pre.bucket && !pre.food;
        const keysOk = stageNow === 'unstarted' || stageNow === 'talked_aris'
            || (stageNow === 'silverlight' ? invCount(/^silverlight$/i) > 0 : invCount(/^key$/i) > 0);
        if (nothingNeeded && keysOk) {
            log(`Bank fast-path: bag already holds everything for ${purpose} at stage ${stageNow} (keys=${invCount(/^key$/i)}) — skipping the trip`);
            return;
        }
        log(`Bank fast-path declined for ${purpose} at stage ${stageNow} (needs coins=${pre.coins} bones=${pre.bones} bucket=${pre.bucket} food=${pre.food})`);
    }
    // A bot may be anywhere on restart (mid-quest, or left by an earlier leg),
    // on any level: come down to L0 first, because the travel below plans on
    // plane-0 data and an L1/L2 start routes into the void.
    await ensureLevel0('bank');
    if (distTo(VARROCK_WEST_BANK) > 8) await travelTo(VARROCK_WEST_BANK, 'Varrock West bank');

    // Reset any bank session wedged open by a previous dead run. A controller
    // that dies mid-bank leaves the server-side session open, and later
    // opens/actions silently no-op against it (observed twice: deposits and
    // withdraws both going nowhere across resumes while fresh probes work).
    await bot.closeInterface();
    await sdk.waitForTicks(3);

    // Fresh needs: the stage may have advanced since the last bank visit
    // (unstarted -> key_hunt in one run), so re-probe instead of trusting
    // whatever the run started with. Computed AFTER the deposit-all below:
    // needs read from a full bag skip every withdraw and the deposit then
    // empties the bag (observed: Bag 0/0/0 after a resume bank).
    const junk = sdk.getInventory().filter(i => (i.count ?? 0) > 0);
    if (junk.length > 0) {
        log(`Depositing ${junk.length} carried stack(s) before withdrawing`);
        if (!(await bot.openBank()).success) throw new Error(`could not open bank at ${pos().x},${pos().z}`);
        for (const item of junk) {
            const dep = await bot.depositItem(item, -1);
            if (!dep.success) log(`deposit ${item.name} FAILED: ${(dep as any).message ?? (dep as any).reason ?? '?'}`);
        }
        // Settle: bulk deposits apply over several ticks, and withdrawing
        // into the storm times out against a moving bag/bank. Poll the live
        // bag empty before touching the bank again.
        for (let i = 0; i < 20; i++) {
            const left = sdk.getInventory().filter(i => (i.count ?? 0) > 0).length;
            if (left === 0) break;
            await sdk.waitForTicks(2);
        }
        log(`post-deposit bag stacks: ${sdk.getInventory().filter(i => (i.count ?? 0) > 0).length}`);
        await sdk.waitForTicks(3);
        // The deposit must LAND: a wedged bank session eats deposits silently
        // (success returned, bag unchanged — observed). Retry once behind a
        // session reset; refuse loudly rather than withdrawing into the wedge.
        let left = sdk.getInventory().filter(i => (i.count ?? 0) > 0).length;
        if (left > 0) {
            log(`deposit incomplete (${left} stacks remain) — resetting bank session and retrying once`);
            await bot.closeInterface();
            await sdk.waitForTicks(3);
            if (!(await bot.openBank()).success) throw new Error('bank would not reopen for deposit retry');
            await sdk.waitForTicks(3);
            for (const item of sdk.getInventory().filter(i => (i.count ?? 0) > 0)) {
                const dep = await bot.depositItem(item, -1);
                if (!dep.success) log(`deposit-retry ${item.name} FAILED: ${(dep as any).message ?? (dep as any).reason ?? '?'}`);
            }
            for (let i = 0; i < 20; i++) {
                left = sdk.getInventory().filter(i => (i.count ?? 0) > 0).length;
                if (left === 0) break;
                await sdk.waitForTicks(2);
            }
            log(`post-retry bag stacks: ${left}`);
            if (left > 0) throw new Error(`bank deposit will not land (${left} stacks stuck in the bag) — refusing a wedged session`);
        }
        session.noteProgress('bank', 'deposited carry-over inventory');
    }

    // Pre-check stock before the first withdraw: an empty bank must idle cleanly,
    // not throw mid-run.
    await bot.closeInterface();
    if (!(await bot.openBank()).success) {
        // Booths can fail to open from a tile, and contents read empty right after
        // open: close, step to the booth, retry once before declaring failure.
        await bot.closeInterface();
        await bot.walkTo(VARROCK_WEST_BANK.x - 1, VARROCK_WEST_BANK.z, 1);
        if (!(await bot.openBank()).success) throw new Error('could not open Varrock West bank for withdrawal');
    }
    // Contents sync lags the open flag: wait for items, not just isOpen.
    await sdk.waitForCondition(s => ((s as any).bank?.items?.length ?? 0) > 0, 8_000).catch(() => {});
    await sdk.waitForTicks(2);

    let bankItems = sdk.getState()?.bank?.items ?? [];
    const have = (re: RegExp) => bankItems.filter(i => re.test(i.name)).reduce((n, i) => n + (i.count ?? 0), 0);
    // Needs are read from the post-deposit bag, never the arrival bag.
    const needs = needsFor(await readStage(), purpose);
    log(`Bank needs: coins=${needs.coins} bones=${needs.bones} bucket=${needs.bucket} food=${needs.food}`);
    const measureShortfall = (): string[] => {
        const s: string[] = [];
        if (needs.coins && invCount(/^coins$/i) + have(/^coins$/i) < needs.coins) s.push(`coins(inv=${invCount(/^coins$/i)} bank=${have(/^coins$/i)} need=${needs.coins})`);
        if (needs.bones && invCount(/^bones$/i) + have(/^bones$/i) < TRAIBORN_BONES) s.push(`bones(inv=${invCount(/^bones$/i)} bank=${have(/^bones$/i)} need=${TRAIBORN_BONES})`);
        if (needs.bucket && invCount(/^bucket/i) + have(/^bucket/i) < 1) s.push('bucket(empty)');
        if (needs.food && have(/^(trout|salmon|tuna|lobster|swordfish|shark)/i) < 5) s.push('food');
        return s;
    };
    const idleOnShortfall = (list: string[]): never => {
        log(`INSUFFICIENT STOCK: ${list.join(' ')} — idling instead of crash-looping`);
        session.log('warn', `insufficient stock: ${list.join(' ')}`);
        process.exit(0);
        throw new Error('unreachable');
    };
    let shortfall = measureShortfall();
    if (shortfall.length) {
        // Bone-farming fallback: Traiborn's 25-bone ritual is the only stock
        // earnable in the field. Farm exactly the measured bones deficit from
        // Lumbridge chickens (kill, loot, bank), then re-measure. Anything
        // else short — or a failed/empty farm — keeps the clean idle below.
        const bonesShort = needs.bones
            ? Math.max(0, TRAIBORN_BONES - invCount(/^bones$/i) - have(/^bones$/i))
            : 0;
        const otherShort = shortfall.filter(s => !s.startsWith('bones('));
        if (bonesShort > 0 && otherShort.length === 0) {
            log(`Bones shortfall is ${bonesShort} — farming the deficit at Lumbridge before idling`);
            await farmBones(bonesShort);
            await bot.closeInterface();
            if (!(await bot.openBank()).success) throw new Error('could not reopen Varrock West bank after bone farming');
            await sdk.waitForCondition(s => ((s as any).bank?.items?.length ?? 0) > 0, 8_000).catch(() => {});
            await sdk.waitForTicks(2);
            bankItems = sdk.getState()?.bank?.items ?? [];
            shortfall = measureShortfall();
        }
        if (shortfall.length) idleOnShortfall(shortfall);
    }

    // Warm-up round-trip: the first withdraw after opening the bank flakes
    // (stale contents sync) — bones-first times out with zero arriving, while
    // a 1-coin withdraw first lands and the same bones take then lands 25
    // (verified live). Sacrifice a cheap stack, then put it straight back.
    const warmPattern = have(/^coins$/i) > 0
        ? /^coins$/i
        : /^(trout|salmon|tuna|lobster|swordfish|shark)/i;
    if (have(warmPattern) > 0) {
        await withdrawUpTo(warmPattern, invCount(warmPattern) + 1, 'warm-up');
        const back = await bot.depositItem(warmPattern, 1);
        log(`warm-up round-trip returned: ${back.success}`);
        await sdk.waitForTicks(1);
    }

    // Non-quest keys/silverlight live in the bank on a resumed run; pull them
    // back before heading out so later legs see the true inventory.
    const bankedKeys = have(/^key$/i);
    if (bankedKeys > 0 && invCount(/^key$/i) === 0) {
        await withdrawUpTo(/^key$/i, bankedKeys, 'banked keys');
    }
    if (invCount(/^silverlight$/i) === 0 && have(/^silverlight$/i) > 0) {
        await withdrawUpTo(/^silverlight$/i, 1, 'banked Silverlight');
    }
    if (needs.coins && invCount(/^coins$/i) < needs.coins) {
        await withdrawUpTo(/^coins$/i, needs.coins, 'coins');
    }
    if (needs.bones && invCount(/^bones$/i) < TRAIBORN_BONES) {
        await withdrawUpTo(/^bones$/i, TRAIBORN_BONES, 'bones');
    }
    if (needs.bucket && invCount(/^bucket$/i) === 0) {
        // Live display name is "Bucket", not the content debug name.
        await withdrawUpTo(/^bucket$/i, 1, 'bucket');
    }
    if (needs.food && invCount(/^(trout|salmon|tuna|lobster|swordfish|shark)/i) < 5) {
        await withdrawUpTo(/^(trout|salmon|tuna|lobster|swordfish|shark)/i, 5, 'food', 2);
    }
    await bot.closeInterface();
    log(`Bag: coins=${invCount(/^coins$/i)} bones=${invCount(/^bones$/i)} buckets=${invCount(/^bucket/i)} keys=${invCount(/^key$/i)}`);
}

await session.setPhase('bank');
await bot.dismissBlockingUI();
{
    // The opening list follows the stage: briefing needs early, fight needs
    // late, all_3 needs nothing (keys stay carried). Later visits re-probe
    // inside bankForSupplies.
    await bankForSupplies(purposeFor(STAGE));
}

/**
 * Open nearby closed doors (nearest first). Palace doors auto-close, and a
 * shut quarter door partitions L2 into pockets that read as unroutable
 * ("stops N tiles short ... separate room?"). Call before any L2 approach or
 * climb — climbTo legs cannot route through a closed door on their own.
 */
async function openNearbyDoors(what: string, max = 3): Promise<number> {
    const doors = (sdk.getNearbyLocs() ?? [])
        .filter(l => /door/i.test(l.name ?? '') && l.optionsWithIndex.some(o => /open/i.test(o.text)))
        .sort((a, b) => (a.distance ?? 99) - (b.distance ?? 99)).slice(0, max);
    for (const d of doors) {
        const o = await bot.interactLoc(d, /open/i);
        log(`opened ${d.name} at (${d.x},${d.z}) for ${what}: ${o.success}${o.success ? '' : ` (${(o as any).message ?? '?'})`}`);
        await sdk.waitForTicks(2);
    }
    return doors.length;
}

/**
 * Climb between floors via the nearest stair/ladder loc offering a climb
 * option. Stair tiles are not hardcoded: a mid-quest restart can leave the bot
 * on any level, so scan, interact, and verify the plane actually changed.
 * (Same pattern as ernest-chicken.ts climbTo.)
 */
async function climbTo(targetLevel: number, what: string): Promise<void> {
    for (let i = 0; i < 6 && pos().level !== targetLevel; i++) {
        // Doors first: a shut quarter door partitions the floor and every
        // approach below refuses wholesale until it is open.
        await openNearbyDoors(`climb to ${targetLevel} (${what})`);
        const wantUp = pos().level < targetLevel;
        const opt = wantUp ? /climb-up|climb up|go-up|go up/i : /climb-down|climb down|go-down|go down/i;
        // Try several candidates, nearest first: the nearest stairs can sit
        // behind furniture the interactor cannot cross (Rovin's nook), while
        // the next one over is reachable. Step adjacent before interacting —
        // the routed walk threads furniture better than a raw interact.
        const cands = (sdk.getNearbyLocs() ?? [])
            .filter(l => /stair|ladder/i.test(l.name ?? '') && l.optionsWithIndex.some(o => opt.test(o.text)))
            .sort((a, b) => (a.distance ?? 99) - (b.distance ?? 99)).slice(0, 4);
        if (!cands.length) {
            throw new Error(`cannot climb to level ${targetLevel} for ${what}: no ${wantUp ? 'up' : 'down'} stairs visible at (${pos().x},${pos().z}) l${pos().level}`);
        }
        const before = pos().level;
        let climbed = false;
        for (const stairs of cands) {
            const d = Math.max(Math.abs(stairs.x - pos().x), Math.abs(stairs.z - pos().z));
            if (d > 1) {
                // Step to a walkable tile BESIDE the stairs, never onto the
                // stair tile itself: stair tiles read blocked on some floors
                // (Rovin's L2 Staircase at (3203,3497) is '#'), and walking at
                // the blocked tile refuses wholesale. Every 8-neighbour is
                // cheb 1 from the stairs, so the interact below stays in range.
                const adj = [
                    { x: stairs.x + 1, z: stairs.z }, { x: stairs.x - 1, z: stairs.z },
                    { x: stairs.x, z: stairs.z + 1 }, { x: stairs.x, z: stairs.z - 1 },
                    { x: stairs.x + 1, z: stairs.z + 1 }, { x: stairs.x - 1, z: stairs.z - 1 },
                    { x: stairs.x + 1, z: stairs.z - 1 }, { x: stairs.x - 1, z: stairs.z + 1 },
                ].filter(t => { try { return isTileWalkable(pos().level, t.x, t.z); } catch { return false; } })
                    .sort((a, b) => Math.max(Math.abs(a.x - pos().x), Math.abs(a.z - pos().z))
                        - Math.max(Math.abs(b.x - pos().x), Math.abs(b.z - pos().z)));
                const step = adj[0] ?? { x: stairs.x, z: stairs.z };
                const w = await bot.walkTo(step.x, step.z, 1);
                log(`approach ${stairs.name} at (${stairs.x},${stairs.z}) via (${step.x},${step.z}) for climb: ${w.success}`);
                await sdk.waitForTicks(2);
            }
            const r = await bot.interactLoc(stairs, opt);
            log(`climb ${stairs.name} ${wantUp ? 'up' : 'down'} at (${stairs.x},${stairs.z}): ${r.success ? 'ok' : `FAILED ${r.reason ?? ''} ${r.message ?? ''}`}`);
            if (!r.success) continue;
            await sdk.waitForCondition(s => (s.player?.level ?? before) !== before, 8_000).catch(() => {});
            await sdk.waitForTicks(2);
            if (pos().level !== before) { climbed = true; break; }
        }
        if (!climbed) throw new Error(`could not climb ${wantUp ? 'up' : 'down'} for ${what}: every approach failed at (${pos().x},${pos().z}) l${pos().level}`);
    }
    if (pos().level !== targetLevel) throw new Error(`still level ${pos().level} after climbing for ${what}`);
    log(`On level ${targetLevel} for ${what} at (${pos().x},${pos().z})`);
}

// ── 3. Gypsy Aris: start the quest, only from the unstarted stage ──────────
if (STAGE === 'unstarted') {
    // Gate BEFORE acting: the quest must really be unstarted, or the dialog below
    // acts on an assumption.
    if (!(await checkpoint('unstarted', 'quest not yet started'))) {
        throw new Error('unstarted checkpoint failed before starting the quest');
    }
    await session.setPhase('start-quest');
    await travelTo(approachTile(GYPSY_TENT), 'the Gypsy tent');
    const gypsy = await bot.talkTo(/^gypsy$/i);
    if (!gypsy.success) throw new Error(`could not talk to the Gypsy: ${gypsy.message ?? '?'}`);
    // Fortune path: accept immediately ("Ok, here you go." pays the coin),
    // take the future, agree to help. Flavour branches fall through to the
    // first option via driveDialog.
    await driveDialog([/ok, here you go|yes, please|go on then/i, /i'?ll (help|do it|try)|accept/i, /delrith/i]);

    if (!(await checkpoint('talked_aris', 'Aris told the future, Prysin named'))) {
        throw new Error('talked_aris checkpoint failed after the fortune');
    }
} else {
    log('Resuming mid-quest: the fortune is already journal-confirmed');
}

// ── 4. Sir Prysin: the key-hunt briefing ────────────────────────────────────
if (STAGE === 'unstarted' || STAGE === 'talked_aris') {
    if (STAGE === 'talked_aris') {
        if (!(await checkpoint('talked_aris', 'reconfirmed before the palace leg'))) {
            throw new Error('talked_aris checkpoint failed on resume');
        }
    }
    await session.setPhase('prysin');
    // Prysin stands in the palace west room (L0), out of talk range from the
    // courtyard — walk inside first (walkTo opens the palace doors).
    await travelTo(approachTile(PRYSIN_ROOM), "Sir Prysin's room");
    const prysin = await talkToWithDoors(/^sir prysin$/i, 'Sir Prysin (briefing)');
    if (!prysin.success) throw new Error(`could not talk to Sir Prysin: ${prysin.message ?? '?'}`);
    // "Gypsy Aris said I should come and talk to you." -> "I need to find
    // Silverlight." -> hear out the three-key split (drain / Rovin / Traiborn).
    await driveDialog([
        /gypsy aris said/i, /i need to find silverlight/i, /he'?s back|crystal ball/i,
        /can you give me your key|so give me the keys|why is this a problem/i,
        /what does the drain lead to|where can i find captain rovin|where does the wizard live|better go key hunting/i,
    ]);

    if (!(await checkpoint('key_hunt', 'Prysin set the three-key hunt'))) {
        throw new Error('key_hunt checkpoint failed after the Prysin briefing');
    }
    // The briefing names the shopping list (bucket + fight food for the drain
    // leg). Bones come later on their own trip (bag budget: 25 bones + 5 food
    // does not fit 28 slots). The opening bank ran at `unstarted` and skipped
    // both, so stock them now.
    await session.setPhase('bank');
    await bankForSupplies('briefing');
} else {
    log('Resuming mid-quest: the key hunt is already journal-confirmed');
}

// ── 5. the three keys, in any order — each gated on its own journal line ───
await session.setPhase('keys');

/** Talk, opening nearby closed doors first: quarter doors (Rovin L2, Prysin
 *  room) read as "Cannot reach" to a plain talkTo when shut. Wanderers get a
 *  proximity wait first: Rovin paces behind furniture the client router cannot
 *  cross, so talking the moment he wanders adjacent skips routing entirely. */
async function talkToWithDoors(pattern: RegExp, who: string, closeBudgetMs = 15000) {
    const t0 = Date.now();
    while (Date.now() - t0 < closeBudgetMs) {
        const npc = (sdk.getNearbyNpcs() ?? []).find(n => pattern.test(n.name ?? ''));
        const p = pos();
        if (npc && Math.max(Math.abs((npc as any).x - p.x), Math.abs((npc as any).z - p.z)) <= 2) {
            log(`${who} is adjacent at (${(npc as any).x},${(npc as any).z}) — talking directly`);
            break;
        }
        await sdk.waitForTicks(3);
    }
    for (let attempt = 0; attempt < 3; attempt++) {
        const t = await bot.talkTo(pattern);
        if (t.success) return t;
        log(`talkTo ${who} attempt ${attempt + 1}: ${t.message ?? '?'}`);
        const doors = (sdk.getNearbyLocs() ?? [])
            .filter(l => /door/i.test(l.name ?? '') && l.optionsWithIndex.some(o => /open/i.test(o.text)))
            .sort((a, b) => (a.distance ?? 99) - (b.distance ?? 99)).slice(0, 3);
        if (!doors.length) return t;
        for (const d of doors) {
            const o = await bot.interactLoc(d, /open/i);
            log(`opened ${d.name} at (${d.x},${d.z}) for ${who}: ${o.success}`);
            await sdk.waitForTicks(2);
        }
    }
    return await bot.talkTo(pattern);
}

/** Surface legs assume level 0: come back down first (sewers excluded — the
 *  z-guard owns those). */
async function ensureLevel0(what: string): Promise<void> {
    if (pos().level !== 0 && pos().z <= 9000) {
        log(`On level ${pos().level} at (${pos().x},${pos().z}) — climbing down for ${what}`);
        await climbTo(0, what);
    }
}

/** True while the bot stands inside the SE-shaft landing pocket (Rovin's room, L2). */
const inRovinPocket = () => pos().level === 2
    && Math.hypot(pos().x - ROVIN_STAIR_LANDING.x, pos().z - ROVIN_STAIR_LANDING.z) <= 6;

/**
 * Descend the SE shaft back to L0 — the SAME shaft climbed up
 * (L2 Staircase ~(3203,3497) -> ... -> L0 base (3203,3496)). The shaft may
 * need two quick downs (L2 -> L1 mid-landing -> L0). Stair selection is
 * pinned: the L2 pick must sit inside the shaft column, later picks are the
 * nearest down-stairs within 6 tiles of the landing (a mid-landing is tiny;
 * the shaft stairs are adjacent). NEVER the west shaft, NEVER a generic
 * nearest-pick (that is how runs ended up descending the decoy).
 * Must be called from INSIDE the landing pocket — the pocket is only
 * enterable via climb-up from L0, and only exitable via this shaft.
 */
async function descendSEShaft(what: string): Promise<void> {
    for (let i = 0; i < 4 && pos().level !== 0; i++) {
        const first = pos().level === 2;
        const stairs = (sdk.getNearbyLocs() ?? [])
            .filter(l => /stair/i.test(l.name ?? '')
                && l.optionsWithIndex.some(o => /climb[- ]down|go[- ]down/i.test(o.text))
                && (first
                    ? (l.x >= 3202 && l.x <= 3205 && l.z >= 3495 && l.z <= 3498)
                    : Math.max(Math.abs(l.x - pos().x), Math.abs(l.z - pos().z)) <= 6))
            .sort((a, b) => (a.distance ?? 99) - (b.distance ?? 99))[0];
        if (!stairs) throw new Error(`SE shaft stairs not in scan for ${what} at (${pos().x},${pos().z}) l${pos().level}`);
        const before = pos().level;
        log(`SE-shaft descent ${i + 1} for ${what}: ${stairs.name} at (${stairs.x},${stairs.z}) from l${before}`);
        if (!(await interactLocFromSides(stairs, /climb[- ]down|go[- ]down/i,
            () => pos().level !== before,
            `SE-shaft descent ${i + 1} at (${stairs.x},${stairs.z})`))) {
            throw new Error(`SE-shaft descent ${i + 1} failed for ${what} at (${pos().x},${pos().z}) l${pos().level}`);
        }
        log(`descent ${i + 1} landed at (${pos().x},${pos().z}) l${pos().level}`);
        await sdk.waitForTicks(2);
    }
    if (pos().level !== 0) throw new Error(`SE shaft did not reach L0 for ${what} (at ${pos().x},${pos().z} l${pos().level})`);
    log(`Down the SE shaft for ${what}: at (${pos().x},${pos().z}) l0`);
}

/** True when the bag already holds a Silverlight key (all three share the name "Key"). */
const keyTotal = () => invCount(/^key$/i);

/** Drain key (journal "1st Key"): wash it to the sewer, then go down and take it. */
async function drainKey(): Promise<void> {
    if (await checkpoint('key1_have', 'drain key already carried')) {
        log('Drain key already held; skipping the sewer leg');
        return;
    }
    if (!(await checkpoint('key1_missing', 'drain key still outstanding'))) {
        log('key1 probe UNKNOWN — attempting the drain leg anyway (inventory decides)');
    }
    // The drain needs a bucket OF WATER: fill at the palace kitchen sink
    // (north wing, L0) first. The sink lists no click options, so the fill is
    // verified by the bag, never by the click result. Live display names are
    // "Bucket" / "bucket of water", not the content debug names.
    if (invCount(/^bucket of water$/i) === 0) {
        if (invCount(/^bucket$/i) === 0) {
            log('No bucket for the drain key — re-banking');
            await bankForSupplies('briefing');
            if (invCount(/^bucket$/i) === 0) throw new Error('no bucket for the drain key after re-banking');
        }
        await travelTo(approachTile(SINK), 'the palace kitchen sink');
        const fill = await bot.useItemOnLoc(/^bucket$/i, /sink/i);
        log(`filled bucket at the sink: ${fill.success}${fill.success ? '' : ` (${fill.message ?? '?'})`}`);
        await sdk.waitForTicks(2);
        if (invCount(/^bucket of water$/i) === 0) throw new Error('bucket is still empty after using it on the kitchen sink — the fill click was rejected');
    }
    await travelTo(approachTile(DRAIN), 'the kitchen drain');
    const pour = await bot.useItemOnLoc(/^bucket of water$/i, /drain/i);
    log(`poured water down the drain: ${pour.success}${pour.success ? '' : ` (${pour.message ?? '?'})`}`);
    if (!pour.success) throw new Error('could not use the bucket of water on the drain');
    // The key washes down to the sewer: open the palace-east manhole, climb
    // down (lands ~3237,9857 L0; ladder back up at 3237,9858), then take it.
    await travelTo(approachTile(MANHOLE), 'the palace manhole');
    const cover = (sdk.getNearbyLocs() ?? []).find(l => /manhole/i.test(l.name ?? '')
        && l.optionsWithIndex.some(o => /climb[- ]down/i.test(o.text)));
    if (!cover) {
        const open = await bot.interactLoc(/manhole/i, /open/i);
        log(`opened the manhole: ${open.success}${open.success ? '' : ` (${open.reason ?? ''} ${open.message ?? ''})`}`);
        if (!open.success) throw new Error('could not open the palace manhole');
        // The loc options swap a few ticks after the open (Manhole(Open) ->
        // Manhole(Climb down)): poll for the descent, never one-shot it.
        await sdk.waitForCondition(() => ((sdk.getNearbyLocs() ?? []).some(l => /manhole/i.test(l.name ?? '')
            && l.optionsWithIndex.some(o => /climb[- ]down/i.test(o.text)))) as unknown as boolean, 10_000).catch(() => {});
        await sdk.waitForTicks(3);
    }
    const descent = (sdk.getNearbyLocs() ?? []).find(l => /manhole/i.test(l.name ?? '')
        && l.optionsWithIndex.some(o => /climb[- ]down/i.test(o.text)));
    if (!descent) throw new Error('manhole offers no climb-down after opening');
    const beforeDesc = pos();
    if (!(await interactLocFromSides(descent, /climb[- ]down/i,
        () => pos().z > 9000 || pos().x !== beforeDesc.x || pos().z !== beforeDesc.z,
        `manhole climb at (${descent.x},${descent.z})`))) throw new Error('could not climb down into the sewer');
    await sdk.waitForTicks(6);
    log(`In the sewer at (${pos().x},${pos().z}) l${pos().level}`);
    await travelTo(approachTile(SEWER_KEY_ROOM), 'the washed-down key');
    const keysBefore = keyTotal();
    const take = await bot.pickupItem(/^key$/i);
    log(`picked up the drain key: ${take.success}${take.success ? '' : ` (${take.message ?? '?'})`}`);
    await sdk.waitForTicks(2);
    if (keyTotal() <= keysBefore) throw new Error('drain-key pickup changed nothing in the bag — the key is not where expected');
    if (!(await checkpoint('key1_have', 'drain key recovered'))) {
        throw new Error('key1_have checkpoint failed after the sewer pickup');
    }
}

/** Rovin key (journal "2nd Key"): the palace-guard captain hands it over. */
async function rovinKey(): Promise<void> {
    if (await checkpoint('key2_have', 'Rovin key already carried')) {
        log('Rovin key already held; skipping the captain');
        return;
    }
    if (!(await checkpoint('key2_missing', 'Rovin key still outstanding'))) {
        log('key2 probe UNKNOWN — attempting the Rovin leg anyway (inventory decides)');
    }
    await session.setPhase('keys-rovin');
    // HUMAN-VERIFIED ROUTE (qldemon2 walkthrough): the staircase at
    // ROVIN_STAIR_BASE (3203,3496) L0 climbs straight into Rovin's room at
    // ROVIN_STAIR_LANDING (3204,3497) L2 — one climb, possibly two quick
    // climbs. Never the west/east/kitchen towers (decoy pockets).
    // The landing pocket is enterable ONLY via climb-up from L0 and exitable
    // ONLY down the same SE shaft: talk in place, never walk out mid-leg.
    // A bot caged in the L2 north pocket (past the furniture band) cannot
    // reach the shaft — that needs rescue, not retries: fail loudly.
    if (!inRovinPocket()) {
        if (pos().level === 2) {
            throw new Error(`NORTH-POCKET: bot L2 at (${pos().x},${pos().z}) outside the landing pocket — the furniture band blocks the SE shaft from here; manual rescue (or a fresh account) required, not retries`);
        }
        await ensureLevel0('Captain Rovin (verified stairs)');
        // Rule 17: approachTile stands on a walkable neighbour, never the
        // stair's own tile.
        await travelTo(approachTile(ROVIN_STAIR_BASE), 'the verified Rovin staircase (L0 base)');
        for (let climb = 0; climb < 3 && pos().level !== 2; climb++) {
            const stairs = (sdk.getNearbyLocs() ?? [])
                .filter(l => /stair|ladder/i.test(l.name ?? '')
                    && Math.abs(l.x - ROVIN_STAIR_BASE.x) + Math.abs(l.z - ROVIN_STAIR_BASE.z) < 10
                    && l.optionsWithIndex.some(o => /climb[- ]up|go[- ]up/i.test(o.text)))
                .sort((a, b) => (a.distance ?? 99) - (b.distance ?? 99))[0];
            if (!stairs) throw new Error(`verified staircase not in scan at (${pos().x},${pos().z}) l${pos().level} — expected near (${ROVIN_STAIR_BASE.x},${ROVIN_STAIR_BASE.z})`);
            const before = pos().level;
            log(`verified-stair climb ${climb + 1}: ${stairs.name} at (${stairs.x},${stairs.z}) from l${before}`);
            if (!(await interactLocFromSides(stairs, /climb[- ]up|go[- ]up/i,
                () => pos().level !== before,
                `verified stair climb ${climb + 1} at (${stairs.x},${stairs.z})`))) {
                throw new Error(`verified staircase climb ${climb + 1} failed at (${pos().x},${pos().z}) l${pos().level}`);
            }
            log(`climb ${climb + 1} landed at (${pos().x},${pos().z}) l${pos().level}`);
            await sdk.waitForTicks(2);
        }
        if (pos().level !== 2) throw new Error(`verified staircase did not reach L2 (at ${pos().x},${pos().z} l${pos().level})`);
        if (!inRovinPocket()) throw new Error(`climb landed L2 at (${pos().x},${pos().z}) outside the landing pocket — expected ~(${ROVIN_STAIR_LANDING.x},${ROVIN_STAIR_LANDING.z})`);
        log(`At the top inside the pocket: (${pos().x},${pos().z}) l${pos().level}`);
    } else {
        log(`Already inside the landing pocket at (${pos().x},${pos().z}) — talking in place`);
    }
    // Verify Rovin is actually in scan at the top before talking.
    {
        let seen = (sdk.getNearbyNpcs() ?? []).find(n => /^captain rovin$/i.test(n.name ?? ''));
        if (!seen) {
            log('Rovin not in scan at the top — waiting 6 ticks and rescanning once');
            await sdk.waitForTicks(6);
            seen = (sdk.getNearbyNpcs() ?? []).find(n => /^captain rovin$/i.test(n.name ?? ''));
        }
        log(`Rovin in scan at top: ${seen ? `YES at (${(seen as any).x},${(seen as any).z}) r=${(seen as any).reachable}` : 'NO (he paces in/out of range; waiting for a pass)'}`);
    }
    // POCKET TALK: stand ground at the landing — walking out to shadow him
    // leaves the pocket through the furniture band and cannot come back.
    // Rovin paces the whole room and passes through the pocket; poll fast
    // (1 tick) and talk the instant he is adjacent and the client router
    // agrees he is reachable.
    let talked = false;
    const rovinT0 = Date.now();
    while (Date.now() - rovinT0 < 150_000 && !talked) {
        const npc: any = (sdk.getNearbyNpcs() ?? []).find(n => /^captain rovin$/i.test(n.name ?? ''));
        const p = pos();
        const cheb = npc ? Math.max(Math.abs(npc.x - p.x), Math.abs(npc.z - p.z)) : 99;
        if (npc && cheb <= 1 && npc.reachable !== false) {
            log(`Rovin adjacent+reachable at (${npc.x},${npc.z}) — talking directly`);
            const t = await bot.talkTo(/^captain rovin$/i);
            if (t.success) { talked = true; break; }
            log(`talkTo Rovin failed: ${t.message ?? '?'} — waiting for the next pass`);
        }
        await sdk.waitForTicks(1);
    }
    if (!talked) {
        log('Rovin never came adjacent+reachable in the pocket — falling back to door-aware talk');
        const rovin = await talkToWithDoors(/^captain rovin$/i, 'Captain Rovin', 30000);
        if (!rovin.success) throw new Error(`could not talk to Captain Rovin: ${rovin.message ?? '?'}`);
    }
    // Server dialog (captain_rovin.rs2): option 3 "Yes I know, but this is
    // important." -> option 1 "There's a demon who wants to invade this
    // city." -> auto chat ("Is it a powerful demon?" / "Yes, very." / ...) ->
    // "Yes you are right. Here you go." + key. The gate above only offers the
    // third option while %demonstart is in the key hunt.
    await driveDialog([/but this is important/i, /demon who wants to invade this city/i]);
    if (!(await checkpoint('key2_have', 'Rovin key received'))) {
        throw new Error('key2_have checkpoint failed after Captain Rovin');
    }
    // Down the SAME SE shaft — never the west shaft, never a generic climb
    // (the Traiborn/bank legs below assume L0 and would route into the void).
    await descendSEShaft('Rovin room exit');
    log('Rovin leg done');
}

/** Traiborn key (journal "3rd Key"): 25 bones for the closet ritual. */
async function traibornKey(): Promise<void> {
    if (await checkpoint('key3_have', 'Traiborn key already carried')) {
        log('Traiborn key already held; skipping the wizard');
        return;
    }
    if (!(await checkpoint('key3_missing', 'Traiborn key still outstanding'))) {
        log('key3 probe UNKNOWN — attempting the Traiborn leg anyway (inventory decides)');
    }
    await session.setPhase('keys-traiborn');
    // Server truth (traiborn.rs2): %demonstart runs find_bones(3) up to
    // got_traiborn_key(28), +1 per bone handed, and the key is granted ONLY
    // on landing EXACTLY 28 ("Hurrah! That's all 25"). Two ways this leg
    // burned ~150 bones with the varp pinned at 3, both now closed by
    // construction:
    //   1. Overshoot: one talk drains EVERY carried bone, so handing 25 from
    //      a resumed 3+k skips past 28 (no Hurrah, no key, bones gone) and
    //      later talks fall back into the pre-ritual chat. Every handover
    //      below therefore carries EXACTLY ONE bone: +1 steps from any state
    //      in [3,28) land exactly on 28 — overshoot is impossible.
    //   2. Reset: the "I'll get the bones for you" starter re-arms
    //      %demonstart=find_bones(3), wiping all progress. The starter chain
    //      runs at most ONCE per run, and only when the opening options
    //      actually offer the key question (ritual never started). Observed
    //      dialog decides, never a flag: a resume mid-ritual opens straight
    //      into the bones handover (no options at all).
    // The handover path is auto-chat only, so the waiter below clicks
    // "continue" pages (dismissBlockingUI never answers multi-option
    // choices) and stays until the dialog closes on its own — full drain, no
    // early exit — watching for Hurrah vs "I still need more".
    let handedBones = 0;
    let starterUsed = false;
    /** The opening options of the current talk (empty while auto-chat runs). */
    async function awaitOpening(): Promise<{ isOpen: boolean; options: { text: string }[] }> {
        for (let i = 0; i < 20; i++) {
            const d = sdk.getDialog();
            if (d?.isOpen) return { isOpen: true, options: (d.options ?? []).map(o => ({ text: o.text })) };
            await sdk.waitForTicks(1);
        }
        return { isOpen: false, options: [] };
    }
    /** Pump continue-pages until the handover closes itself. Never picks. */
    async function awaitHandoverDrained(): Promise<{ hurrah: boolean; more: boolean }> {
        let hurrah = false, more = false, warned = false;
        let closedStreak = 0;
        for (let i = 0; i < 100 && closedStreak < 3; i++) {
            const d = sdk.getDialog();
            const texts: string[] = [];
            if (d?.text) texts.push(d.text);
            for (const c of d?.allComponents ?? []) if (c.text) texts.push(c.text);
            const joined = texts.join(' | ');
            if (!hurrah && /hurrah/i.test(joined)) {
                hurrah = true;
                log(`Traiborn HURRAH: ${joined.slice(0, 200)}`);
            }
            if (!more && /still need more/i.test(joined)) {
                more = true;
                log(`Traiborn needs more: ${joined.slice(0, 200)}`);
            }
            if ((d?.options ?? []).length > 1) {
                // The bones path never offers a choice: log and refuse rather
                // than risk the reset pick or a fall-through options[0].
                if (!warned) {
                    warned = true;
                    log(`WARN: unexpected choice mid-handover — picking nothing: ${(d?.options ?? []).map(o => JSON.stringify(o.text)).join(' / ')}`);
                }
                await sdk.waitForTicks(2);
                continue;
            }
            if (!d?.isOpen) {
                closedStreak++;
                await sdk.waitForTicks(1);
                continue;
            }
            closedStreak = 0;
            await bot.dismissBlockingUI();
            await sdk.waitForTicks(1);
        }
        await bot.dismissBlockingUI();
        return { hurrah, more };
    }
    /** Stage exactly one bone in the bag (keys untouched). Farms when empty. */
    async function fetchExactlyOneBone(): Promise<void> {
        for (let attempt = 0; attempt < 4 && invCount(/^bones$/i) !== 1; attempt++) {
            if (attempt > 0) log(`single-bone fetch retry ${attempt + 1}/4 (carried=${invCount(/^bones$/i)})`);
            await ensureLevel0('single bone');
            await travelTo(VARROCK_WEST_BANK, 'Varrock West bank (single bone)');
            await bot.closeInterface();
            await sdk.waitForTicks(2);
            if (!(await bot.openBank()).success) continue;
            await sdk.waitForCondition(s => ((s as any).bank?.items?.length ?? 0) > 0, 8_000).catch(() => {});
            await sdk.waitForTicks(2);
            const carried = invCount(/^bones$/i);
            if (carried > 1) {
                const dep = await bot.depositItem(/^bones$/i, carried - 1);
                log(`trim bones to one: ${dep.success}${dep.success ? '' : ` (${(dep as any).message ?? (dep as any).reason ?? '?'})`}`);
                await sdk.waitForTicks(3);
            } else if (carried === 0) {
                const bankBones = (sdk.getState()?.bank?.items ?? [])
                    .filter(i => /^bones$/i.test(i.name))
                    .reduce((n, i) => n + (i.count ?? 0), 0);
                if (bankBones < 1) {
                    await bot.closeInterface();
                    const need = Math.max(1, TRAIBORN_BONES - handedBones);
                    log(`bank holds no bones — farming ${need} at Lumbridge (handed=${handedBones})`);
                    const gained = await farmBones(need);
                    if (gained < 1) {
                        log('INSUFFICIENT STOCK: no bones in bank/bag/field — idling instead of crash-looping');
                        session.log('warn', 'insufficient stock: bones');
                        process.exit(0);
                        throw new Error('unreachable');
                    }
                    continue;
                }
                try {
                    await withdrawUpTo(/^bones$/i, 1, 'single bone');
                } catch (e) {
                    log(`single-bone withdraw failed (${(e as Error).message}) — retrying behind a session reset`);
                    await bot.closeInterface();
                    await sdk.waitForTicks(2);
                    continue;
                }
            }
            await bot.closeInterface();
            await sdk.waitForTicks(1);
        }
        if (invCount(/^bones$/i) !== 1) throw new Error(`could not stage exactly one bone (carried=${invCount(/^bones$/i)})`);
        log(`single bone staged (handed so far: ${handedBones})`);
    }
    // The bones-count journal line has no backing varp (see header), so the
    // loop below is driven by inventory: hand single bones until the key
    // lands. Tower routing assumes level 0 (a resume can park upstairs).
    await ensureLevel0('Traiborn');
    for (let round = 0; round < 30 && keyTotal() < 3 && !(await checkpoint('key3_have', `Traiborn round ${round}`)); round++) {
        await fetchExactlyOneBone();
        await travelTo(approachTile(TRAIBORN_TOWER), "the Wizards' Tower");
        // Breadcrumbs: tiles stood on minutes ago are the highest-probability
        // moves after the talk (door states hold for minutes, not hours).
        // Post-talk the bot reverse-walks these before any bank trip, so the
        // next fetch usually starts outside the pocket and never needs the
        // probe-escape below.
        const entryA = { ...pos() };
        await travelTo(approachTile(TOWER_STAIRS), 'the tower stairs');
        const entryB = { ...pos() };
        await climbTo(1, 'Traiborn');
        await travelTo(approachTile(TRAIBORN_L1), 'Traiborn');
        for (let talk = 0; talk < 2; talk++) {
            const bonesBefore = invCount(/^bones$/i);
            const wiz = await talkToWithDoors(/^traiborn$/i, 'Traiborn');
            if (!wiz.success) throw new Error(`could not talk to Traiborn: ${wiz.message ?? '?'}`);
            const opening = await awaitOpening();
            const offersStarter = opening.options.some(o => /key given to you by sir prysin/i.test(o.text));
            if (offersStarter && !starterUsed && handedBones === 0) {
                // Ritual never started (or an overshoot fell back here): run
                // the key-question chain exactly once. It hands over nothing.
                log('Traiborn opening offers the key question and no bones handed yet — running the starter chain ONCE');
                await driveDialog([
                    /key given to you by sir prysin/i, /keys knocking around|looking after it/i,
                    /i'?ll (get|help).{0,20}bones/i,
                ]);
                starterUsed = true;
                break;
            }
            if (offersStarter) log('WARN: key question re-offered after ritual progress — refusing the starter (reset risk); handover wait only');
            const res = await awaitHandoverDrained();
            const bonesAfter = invCount(/^bones$/i);
            handedBones += Math.max(0, bonesBefore - bonesAfter);
            if (res.hurrah) log(`Hurrah confirmed after ${handedBones} handed this run`);
            if (keyTotal() >= 3) break;
            if (bonesAfter < bonesBefore) break; // progress banked; next round
            if (talk === 0) {
                log('handover drained nothing — re-talking once before leaving the tower');
                continue;
            }
            log('handover drained nothing twice — leaving the tower; next round retries');
            break;
        }
        await sdk.waitForTicks(2);
        log(`Traiborn round ${round + 1}: bones left=${invCount(/^bones$/i)} keys=${keyTotal()} handed=${handedBones}`);
        // Leave the tower while the doors are still as found: reverse-walk
        // the entry breadcrumbs (minutes fresh) so the next fetch starts
        // outside the pocket. Falls through to the probe-escape on failure.
        if (keyTotal() < 3) {
            await ensureLevel0('post-talk exit');
            for (const t of [entryB, entryA]) {
                await openNearbyDoors('post-talk exit', 5);
                const beforeExit = pos();
                if (Math.hypot(t.x - beforeExit.x, t.z - beforeExit.z) > 16) continue;
                await bot.walkTo(t.x, t.z, 2);
                await sdk.waitForTicks(2);
                log(`post-talk exit -> (${t.x},${t.z}) at (${pos().x},${pos().z})`);
            }
            log(`post-talk exit ends at (${pos().x},${pos().z}) l${pos().level}`);
        }
    }
    if (!(await checkpoint('key3_have', 'Traiborn key received'))) {
        throw new Error('key3_have checkpoint failed after the bones ritual');
    }
}

await drainKey();
await rovinKey();
await traibornKey();

// ── 6. all three keys -> Silverlight ────────────────────────────────────────
if (!(await checkpoint('all_3', 'all three keys held, Prysin owes Silverlight'))) {
    // Inventory is the tiebreaker: the journal all-3 line only renders while
    // the keys are carried, so a banked key reads as key_hunt, not all_3.
    if (keyTotal() < 3) throw new Error(`all_3 checkpoint failed with ${keyTotal()} keys in the bag`);
    log('all_3 journal line unreadable but 3 keys carried — proceeding to Prysin');
}
await session.setPhase('silverlight');
// The Traiborn trip ends a floor up; come back down before palace routing.
await ensureLevel0('Silverlight handover');
await travelTo(approachTile(PRYSIN_ROOM), 'Varrock Palace');
const prysinAgain = await talkToWithDoors(/^sir prysin$/i, 'Sir Prysin (Silverlight)');
if (!prysinAgain.success) throw new Error(`could not talk to Sir Prysin for Silverlight: ${prysinAgain.message ?? '?'}`);
// "I've got all three keys!" -> Prysin takes them and hands over Silverlight.
await driveDialog([/i'?ve got all three keys|got them all/i, /where.*keys were|still looking/i]);
await sdk.waitForTicks(2);
if (invCount(/^silverlight$/i) === 0) throw new Error('Prysin did not hand over Silverlight');
log('Silverlight received');

if (!(await checkpoint('silverlight', 'sword reclaimed, Delrith named'))) {
    throw new Error('silverlight checkpoint failed after receiving the sword');
}

// ── 7. stone circle: the Delrith fight ──────────────────────────────────────
await session.setPhase('fight');
// The bones trip carried no food (bag budget), so stock the fight food now
// while still in Varrock — Silverlight rides along via the banked re-withdraw.
await bankForSupplies('fight');
await travelTo(approachTile(STONE_CIRCLE), 'the stone circle');
const wield = await bot.equipItem(/^silverlight$/i);
log(`wielded Silverlight: ${wield.success}${wield.success ? '' : ` (${wield.message ?? '?'})`}`);
if (!wield.success) throw new Error('could not wield Silverlight for the Delrith fight');

// Delrith must be damaged with Silverlight equipped: on aggro he collapses
// into his weakened form and the banishing incantation dialog opens. Melee him
// until the dialog appears, then answer option 4 — the ONLY correct line
// ("Carlem Aber Camerinthum Purchai Gabindo"); the other three restore him to
// full strength and the fight restarts.
let banished = false;
for (let round = 0; round < 10 && !banished; round++) {
    const fight = await bot.attack(/^delrith$/i);
    log(`attack Delrith round ${round + 1}: ${fight.success}${fight.success ? '' : ` (${fight.message ?? '?'})`}`);
    for (let i = 0; i < 15; i++) {
        await sdk.waitForTicks(2);
        const dialog = sdk.getDialog();
        if (dialog?.isOpen && (dialog.options ?? []).length > 0) {
            const pick = (dialog.options ?? []).find(o => DELRITH_INCANTATION.test(o.text))
                ?? (dialog.options ?? []).find(o => /carlem|purchai|camerinthum|gabindo/i);
            if (pick) {
                log(`incantation -> ${pick.text}`);
                await sdk.sendClickDialog(pick.index);
                await sdk.waitForTicks(3);
                await bot.dismissBlockingUI();
                banished = true;
                break;
            }
        }
        // Wrong incantations restore Delrith: keep fighting only while the
        // journal still names him as the target.
        if (i === 14) await bot.dismissBlockingUI();
    }
    if (!banished && !(await checkpoint('silverlight', `still hunting Delrith after round ${round + 1}`))) {
        log('silverlight line gone mid-fight — checking for completion instead');
        break;
    }
}

// ── 8. completion is proven by the journal, never by XP or a chat line ─────
await session.setPhase('verify');
if (!(await checkpoint('complete', 'journal reports QUEST COMPLETE'))) {
    throw new Error('completion checkpoint failed: journal does not report the quest complete');
}

session.log('log', 'Demon Slayer verified complete');
session.noteProgress('inventory', 'quest complete (journal-verified)');
const summary = summarizeRun(run.directory);
if (!summary.ok) {
    // Every declared checkpoint must carry a PASS before this counts as done.
    throw new Error(`promotion gate failed: missing/unpassed ${JSON.stringify(summary.missing)}`);
}
log(`Run record verified: ${summary.ok} (${summary.missing.length} outstanding)`);
log(`DONE Demon Slayer verified via journal at (${pos().x},${pos().z})`);
log(`Metrics: ${JSON.stringify(session.metrics())}`);

sdk.disconnect();
process.exit(0);
