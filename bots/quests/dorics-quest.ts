/**
 * Doric's Quest — replayable, checkpoint-gated.
 *
 *   bun bots/quests/dorics-quest.ts {botname}
 *
 * Banks at Falador West on startup (deposit-all, then withdraw only what the run
 * needs), starts the quest at Doric, mines 6 clay + 4 copper ore + 2 iron ore at
 * the Rimmington mine, hands them in at Doric, and banks out again.
 *
 * Content this encodes (never memory):
 *   server/content/scripts/quests/quest_doric/scripts/quest_doric.rs2
 *     %doricquest = 0  -> not started  ("I wanted to use your anvils." then
 *                        "Yes, I will get you materials." sets 10)
 *     %doricquest = 10 -> materials    (hands over 6 clay / 4 copper / 2 iron)
 *     else             -> post-complete
 *   doric_journal.rs2 -> journal heading "Dorics' Quest", list label "Doric's Quest"
 *   skill_mining/configs/mine.dbrow + rocks.loc -> clay/copper/iron rock loc ids
 *
 * Every step that matters is gated on QUEST JOURNAL evidence, never on XP, chat
 * or a successful packet (`doricquest` is not transmitted, so the journal is the
 * only client-visible record of stage).
 *
 * Tiles are from offline map data (`data/pack/.cache/maps-server.zip`, parsed
 * with the engine's own loc/coord layout), not from a guide:
 *   Doric            (2952,3451) L0
 *   Falador W bank   booths (2945..2949,3367); stand tile (2946,3369)
 *   Rimmington mine  clay (2986,3239) (2987,3240), copper (2976..2979,3245..3248),
 *                    iron (2968..2971,3237..3242) (2981,3233) (2982,3234)
 *   mine anchor      (2980,3242) — walkable, all three ores within 14 tiles
 */
import { existsSync, readFileSync, appendFileSync } from 'fs';
import { dirname, join } from 'path';

import { BotSDK, deriveGatewayUrl } from '../../sdk/index';
import { BotActions } from '../../sdk/actions';
import { initPathfinding, findLongPath } from '../../sdk/pathfinding';
import { ActivitySession } from '../../sdk/activity';
import { readJournalCheckpoint } from '../../quest-lab/journal-reader';
import type { JournalRule } from '../../quest-lab/evidence';
import { appendCheckpoint, createRun, safeRunId, summarizeRun, type RunHandle } from '../../quest-lab/records';
import { untilBankReady } from './settle';

// ── args / env ──────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const botArg = argv.find((a) => !a.startsWith('-'));
const envPath = botArg ? join(process.cwd(), 'bots', botArg, 'bot.env') : join(dirname(import.meta.path), 'bot.env');
if (!existsSync(envPath)) throw new Error(`bot.env not found at ${envPath}. Usage: bun bots/quests/dorics-quest.ts {botname}`);
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
    try {
        appendFileSync(GRIND_LOG, `${new Date().toISOString()} ${msg}\n`);
    } catch {
        /* ignore */
    }
};

// ── constants ───────────────────────────────────────────────────────────────
const FALADOR_BANK = { x: 2946, z: 3369 };
const DORIC = { x: 2952, z: 3451 };
/** Standable tile next to Doric, inside the hut (the door is masked for pathing). */
const DORIC_INSIDE = { x: 2952, z: 3450 };
const MINE_ANCHOR = { x: 2980, z: 3242 };

const PICKAXE = /^(bronze|iron|steel|mithril|adamant|rune) pickaxe$/i;
const CLAY = /^clay$/i;
const COPPER = /^copper ore$/i;
const IRON = /^iron ore$/i;

type Kind = 'clay' | 'copper' | 'iron';
const NEED: Record<Kind, number> = { clay: 6, copper: 4, iron: 2 };
const ITEM: Record<Kind, RegExp> = { clay: CLAY, copper: COPPER, iron: IRON };
/**
 * Rock loc ids, read from skill_mining/configs/mine.dbrow + rocks.loc. The loc
 * NAME for every rock is "Rocks", so a name match cannot tell clay from tin —
 * matching the id is the only way to mine the ore the quest asks for.
 */
const ROCK_IDS: Record<Kind, Set<number>> = {
    clay: new Set([2108, 2109, 2137, 2138]), // clayrock1/2, macro_clayrock1/2
    copper: new Set([2090, 2091, 2119, 2120]), // copperrock1/2, macro_copperrock1/2
    iron: new Set([2092, 2093, 2121, 2122]) // ironrock1/2, macro_ironrock1/2
};

const JOURNAL = { label: "Doric's Quest", title: "Dorics' Quest" };
// Journal rules from doric_journal.rs2 (%doricquest 0 / 10 / else).
const RULES: Record<Stage, JournalRule> = {
    not_started: { id: 'doric:not_started', kind: 'unstarted', all: ['I can start this quest by talking to Doric'] },
    started: { id: 'doric:started', kind: 'active', all: ['I need to collect some items and bring them to Doric'] },
    complete: { id: 'doric:complete', kind: 'complete', all: ['QUEST COMPLETE'] }
};
type Stage = 'not_started' | 'started' | 'complete';

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
    showChat: false
});

console.log('Opening/attaching the game client...');
await sdk.connect();
const bot = new BotActions(sdk);

// stallMs is sized to the longest BLIND leg (the ~210-tile Rimmington trek emits
// no effect for minutes on a slow link); intent is not the stall clock.
const session = new ActivitySession(sdk, bot, {
    name: "doric's quest",
    grindLogPath: GRIND_LOG,
    stallMs: 600_000,
    maxRecoveryTactics: 6
});
await session.setPhase('start');

const pos = () => {
    const p = sdk.getState()?.player;
    return { x: p?.worldX ?? 0, z: p?.worldZ ?? 0, level: p?.level ?? 0 };
};
const cheb = (a: { x: number; z: number }, b: { x: number; z: number }) =>
    Math.max(Math.abs(a.x - b.x), Math.abs(a.z - b.z));
const invCount = (re: RegExp) => sdk.getInventory().filter((i) => re.test(i.name)).reduce((n, i) => n + (i.count ?? 1), 0);
const oreCount = (kind: Kind) => invCount(ITEM[kind]);
const missing = (kind: Kind) => Math.max(0, NEED[kind] - oreCount(kind));
const hasAllOres = () => (['clay', 'copper', 'iron'] as Kind[]).every((k) => missing(k) === 0);
const miningXp = () => sdk.getSkill('Mining')?.experience ?? 0;
const hasPickaxe = () => !!(sdk.findInventoryItem(PICKAXE) || sdk.findEquipmentItem(PICKAXE));
const oreLine = () => `clay=${oreCount('clay')}/${NEED.clay} copper=${oreCount('copper')}/${NEED.copper} iron=${oreCount('iron')}/${NEED.iron}`;

/**
 * A bound on every awaited SDK action. A client that dies mid-walk leaves
 * `bot.walkTo` awaiting an arrival that can never happen, and the run then hangs
 * silently until the harness kills it — which reads as a timeout, not as "the
 * controller went away". Bounding the await turns that into a named failure.
 */
function withTimeout<T>(work: Promise<T>, ms: number, what: string): Promise<T | null> {
    return Promise.race([work.catch(() => null), new Promise<null>((resolve) => setTimeout(() => resolve(null), ms))]).then(
        (v) => (v === null ? (log(`TIMEOUT ${what} after ${Math.round(ms / 1000)}s`), null) : v)
    );
}

/** Transport gate: no controller or a stale feed means every walk below is a no-op. */
function transportLost(): boolean {
    const age = sdk.getStateAge?.() ?? 0;
    return !sdk.isConnected() || age > 60_000;
}

async function guardTransport(): Promise<void> {
    for (let i = 0; i < 12 && transportLost(); i++) {
        await sdk.waitForTicks(5).catch(() => undefined);
    }
    if (transportLost()) {
        throw new Error(`controller/state lost (connected=${sdk.isConnected()} stateAge=${sdk.getStateAge?.() ?? '?'}ms) at ${pos().x},${pos().z}`);
    }
}

// ── durable run record ──────────────────────────────────────────────────────
const MODE = process.env.QUEST_LAB_MODE === 'staging' ? 'staging' : 'development';
let run: RunHandle | null = null;

function startRun(required: Stage[]): void {
    run = createRun(join(process.cwd(), 'quest-lab', 'runs'), safeRunId('doric', username, new Date().toISOString()), {
        questId: 'doric',
        account: username,
        mode: MODE,
        scriptHash: Bun.hash(readFileSync(import.meta.path, 'utf-8')).toString(16),
        fixtureHash: process.env.QUEST_LAB_FIXTURE_HASH ?? 'unrecorded',
        contentHash: process.env.QUEST_LAB_CONTENT_HASH ?? 'unrecorded',
        requiredCheckpoints: required
    });
    log(`Run record: ${run.directory} required=${required.join(',')}`);
}

/**
 * One journal read per attempt, ONE appended record for the final verdict.
 * Polling first matters because the journal write lags the action by ticks
 * (rule: a terminal checkpoint read PASS only after settling) — but recording
 * every probe would leave a stale FAIL in the evidence file.
 */
async function checkpoint(name: Stage, label: string, tries = 1): Promise<boolean> {
    if (!run) throw new Error('checkpoint attempted before the run record was created');
    await bot.dismissBlockingUI().catch(() => undefined);
    let read = await readJournalCheckpoint(sdk, JOURNAL, RULES[name]);
    for (let i = 1; i < tries && (read.verdict?.verdict ?? 'UNKNOWN') !== 'PASS'; i++) {
        await sdk.waitForTicks(5);
        read = await readJournalCheckpoint(sdk, JOURNAL, RULES[name]);
    }
    await bot.closeInterface().catch(() => undefined);
    const verdict = read.verdict?.verdict ?? 'UNKNOWN';
    appendCheckpoint(run.directory, {
        checkpointId: name,
        verdict,
        reason: read.reason,
        kind: RULES[name].kind,
        rawLines: read.rawLines
    });
    if (verdict !== 'PASS') {
        log(`CHECKPOINT ${name} ${verdict}: ${read.reason}`);
        for (const line of read.rawLines) log(`    raw: ${JSON.stringify(line.rawText)}`);
        session.log('warn', `checkpoint ${name} ${verdict}`);
        return false;
    }
    log(`CHECKPOINT ${name} PASS (${label}) — ${read.reason}`);
    session.log('log', `checkpoint ${name} PASS: ${label}`);
    return true;
}

/**
 * The account's real stage. UNKNOWN is "not ready" (the side interface streams
 * in late after login), so a bounded poll — never an immediate verdict, and
 * never a fall-through to "start over".
 */
async function readStage(tries = 12): Promise<Stage | 'unknown'> {
    let last: Stage | 'unknown' = 'unknown';
    for (let i = 0; i < tries; i++) {
        for (const name of ['complete', 'started', 'not_started'] as Stage[]) {
            const read = await readJournalCheckpoint(sdk, JOURNAL, RULES[name]);
            if (read.verdict?.verdict === 'PASS') {
                await bot.closeInterface().catch(() => undefined);
                log(`  stage probe ${name}: PASS (${read.reason})`);
                return name;
            }
            last = 'unknown';
        }
        await sdk.waitForTicks(4);
    }
    await bot.closeInterface().catch(() => undefined);
    return last;
}

// ── bank ────────────────────────────────────────────────────────────────────
async function openBankHere(): Promise<boolean> {
    if (sdk.getState()?.bank?.isOpen) return true;
    await bot.closeInterface().catch(() => undefined);
    const first = (await withTimeout(bot.openBank(), 20_000, 'open bank')) ?? { success: false, message: 'timeout' };
    if (first.success) {
        await untilBankReady(sdk, { log });
        return true;
    }
    // A booth can refuse from the tile we stopped on: step to the stand tile once.
    await bot.walkTo(FALADOR_BANK.x, FALADOR_BANK.z, 1).catch(() => undefined);
    await sdk.waitForTicks(2);
    const retry = (await withTimeout(bot.openBank(), 20_000, 'reopen bank')) ?? { success: false, message: 'timeout' };
    if (!retry.success) return false;
    await untilBankReady(sdk, { log });
    return true;
}

/** Deposit one stack per round from LIVE state (a stale list re-targets emptied slots). */
async function depositEverything(): Promise<number> {
    let deposited = 0;
    for (let guard = 0; guard < 30; guard++) {
        const item = sdk.getInventory().find((i) => (i.count ?? 0) > 0);
        if (!item) break;
        const res = await bot.depositItem(item, -1);
        if (!res.success) {
            log(`deposit ${item.name} failed: ${res.message ?? '?'}`);
            break;
        }
        deposited += item.count ?? 1;
    }
    return deposited;
}

/**
 * Start banked: deposit everything, hand back worn junk, then withdraw only the
 * pack this run needs (a pickaxe, plus any ore an earlier pass banked — cheaper
 * than a second trip and it is what makes a resume cheap). The ores are NOT
 * stocked by the fixture: the deficit is mined, which is what proves the mining
 * leg.
 */
async function bankForQuest(): Promise<void> {
    await bot.dismissBlockingUI().catch(() => undefined);
    if (!(await goToFaladorWest('the Falador West bank'))) {
        throw new Error(`could not reach the Falador West bank at ${pos().x},${pos().z}`);
    }
    if (!(await openBankHere())) throw new Error(`could not open the Falador West bank at ${pos().x},${pos().z}`);

    const carried = sdk.getInventory().filter((i) => (i.count ?? 0) > 0).length;
    if (carried > 0) {
        const n = await depositEverything();
        log(`Deposited ${n} item(s) of carry-over inventory`);
        session.noteProgress('bank', 'deposited carry-over inventory');
    }

    for (const worn of sdk.getEquipment().filter((i) => (i.count ?? 0) > 0 && !PICKAXE.test(i.name))) {
        log(`Unequipping ${worn.name}`);
        await bot.unequipItem(worn).catch(() => undefined);
    }
    if (sdk.getInventory().some((i) => (i.count ?? 0) > 0)) await depositEverything();

    // Withdraws need a verified-open bank, at the point of use.
    if (!(await openBankHere())) throw new Error('bank closed before the withdraw phase');
    if (!hasPickaxe()) {
        const pick = sdk.findBankItem(PICKAXE);
        if (!pick) throw new Error('no pickaxe in the bank — the fixture must stock one (bronze_pickaxe)');
        const res = await bot.withdrawItem(pick, 1);
        log(`withdrew ${pick.name}: ${res.success}${res.success ? '' : ` (${res.message ?? '?'})`}`);
    }
    if (!hasPickaxe()) throw new Error('pickaxe withdraw did not land');

    // Ore already banked by an earlier pass: take it back before mining. Ores are
    // UNSTACKABLE, so one at a time against the live count.
    for (const kind of ['clay', 'copper', 'iron'] as Kind[]) {
        for (let guard = 0; guard < NEED[kind] && missing(kind) > 0; guard++) {
            const bankItem = sdk.findBankItem(ITEM[kind]);
            if (!bankItem) break;
            const before = oreCount(kind);
            const res = await bot.withdrawItem(bankItem, 1);
            if (!res.success || oreCount(kind) <= before) break;
        }
    }
    await bot.closeInterface().catch(() => undefined);
    log(`Bag after banking: pick=yes ${oreLine()} slots=${sdk.getInventory().filter((i) => (i.count ?? 0) > 0).length}`);
}

/**
 * Long-leg travel: plan with the offline collision data, then walk ONE planned
 * waypoint at a time through `bot.walkTo` (which owns door opening and its own
 * arrival detection), verifying displacement on each leg.
 *
 * Why not the shared `bots/quests/travel.ts` here: its hop primitive
 * (`hopSend`) re-issues a 10-tile walk whenever its 4s arrival window lapses,
 * which interrupts the walk already in progress — measured live on this world at
 * ~9 tiles/minute on the bank -> Rimmington leg (36 tiles in 4 minutes) while the
 * same bot walked 1-2 tiles/second in bursts. That is a shared-layer defect
 * (reported to the parent, not fixed here); this local loop is the shape the
 * passing Cook's Assistant reference uses.
 */
const WAYPOINT_SPACING = 10;

function planWaypoints(from: { x: number; z: number }, to: { x: number; z: number }): { x: number; z: number }[] {
    const raw = findLongPath(pos().level, from.x, from.z, to.x, to.z) as { x: number; z: number }[];
    if (!raw || raw.length === 0) return [{ x: to.x, z: to.z }];
    const way: { x: number; z: number }[] = [];
    let last = raw[0]!;
    way.push({ x: last.x, z: last.z });
    for (let i = 1; i < raw.length; i++) {
        const p = raw[i]!;
        if (Math.hypot(p.x - last.x, p.z - last.z) >= WAYPOINT_SPACING || i === raw.length - 1) {
            way.push({ x: p.x, z: p.z });
            last = p;
        }
    }
    // Only append the destination when the plan actually gets there: a truncated
    // plan plus a hand-appended 200-tile leg is a walk the client refuses.
    const lastPlan = raw[raw.length - 1]!;
    if (Math.hypot(lastPlan.x - to.x, lastPlan.z - to.z) <= 10 && cheb(way[way.length - 1]!, to) > 2) {
        way.push({ x: to.x, z: to.z });
    } else if (Math.hypot(lastPlan.x - to.x, lastPlan.z - to.z) > 10) {
        log(`plan to ${to.x},${to.z} is TRUNCATED at ${lastPlan.x},${lastPlan.z}`);
    }
    return way;
}

/**
 * Walk to an AREA target (a bank booth row, a mine, an NPC's hut): arriving
 * within `acceptRadius` tiles is success, because the target tile itself is
 * often unwalkable (rock, booth, doorway).
 */
async function goToArea(dest: { x: number; z: number }, what: string, acceptRadius: number): Promise<boolean> {
    // Budget the leg by DISTANCE, not a flat 8 minutes. A fleet account can start
    // the quest anywhere on the map: the 2026-10-24 rollout failed on every account
    // that began >100 tiles out (ABGARMY12 walking in from the Rimmington mine was
    // still 59 tiles short when the 8-minute clock expired — moving the whole way,
    // at a measured ~5-6 s/tile under fleet load). The old flat deadline turned a
    // healthy walk into `could not reach the Falador West bank` + exit 1.
    const tilesShort = Math.round(cheb(pos(), dest));
    const deadline = Date.now() + Math.min(40 * 60_000, Math.max(12 * 60_000, tilesShort * 8_000));

    let frontier = '';
    let nudges = 0;
    for (let plan = 0; plan < 12 && Date.now() < deadline; plan++) {
        if (cheb(pos(), dest) <= acceptRadius) {
            log(`Arrived ${what} at (${pos().x},${pos().z}) l${pos().level}`);
            session.noteProgress('location', `reached ${what}`);
            return true;
        }
        await guardTransport();
        const waypoints = planWaypoints(pos(), dest);
        log(`Route to ${what}: ${waypoints.length} waypoint(s) from (${pos().x},${pos().z}) to (${dest.x},${dest.z})`);
        for (const wp of waypoints) {
            if (cheb(pos(), dest) <= acceptRadius) break;
            await bot.dismissBlockingUI().catch(() => undefined);
            const before = pos();
            if (cheb(before, wp) <= 3) continue;
            const res = (await withTimeout(bot.walkTo(wp.x, wp.z, 3), 120_000, `walkTo ${wp.x},${wp.z}`)) ?? { success: false, message: 'timeout' };
            const after = pos();
            const moved = Math.hypot(after.x - before.x, after.z - before.z);
            log(`  leg -> (${wp.x},${wp.z}) from (${before.x},${before.z}) moved=${moved.toFixed(1)} at (${after.x},${after.z}) l${after.level} ok=${res.success}`);
            if (moved < 1) {
                // Same bearing, shorter step: a 10-tile chord is accepted by the
                // client and refused by the server far more often than 4 tiles.
                const dx = wp.x - after.x;
                const dz = wp.z - after.z;
                const len = Math.max(1, Math.hypot(dx, dz));
                const step = Math.min(4, len);
                await bot.walkTo(Math.round(after.x + (dx / len) * step), Math.round(after.z + (dz / len) * step), 0).catch(() => undefined);
                await sdk.waitForTicks(2);
                if (pos().x !== after.x || pos().z !== after.z) session.noteProgress('location', `short step toward ${what}`);
            } else {
                session.noteProgress('location', `toward ${what}`);
            }
            if (Date.now() > deadline) break;
        }
        const key = `${pos().x},${pos().z}`;
        if (key === frontier) {
            // Stuck frontier: a shut door (or a masked gap) makes every re-plan
            // answer the same tile. Nudge the bot before giving up — open what is
            // adjacent, take one short step toward the bank, re-plan from there.
            log(`travel to ${what}: plan frontier stuck at (${key}) — ${Math.round(cheb(pos(), dest))} tiles short`);
            nudges++;
            if (nudges > 2) break;
            const door = sdk.findNearbyLoc(/^(door|gate|large door)$/i, { withOption: /^open$/i });
            if (door) {
                await bot.interactLoc(door, /^open$/i).catch(() => undefined);
                await sdk.waitForTicks(3);
                log(`  opened ${door.name} @ ${door.x},${door.z}`);
            }
            const now = pos();
            const dx = dest.x - now.x;
            const dz = dest.z - now.z;
            const len = Math.max(1, Math.hypot(dx, dz));
            await bot.walkTo(Math.round(now.x + (dx / len) * 4), Math.round(now.z + (dz / len) * 4), 0).catch(() => undefined);
            await sdk.waitForTicks(3);
            log(`  nudge ${nudges}/2 -> (${pos().x},${pos().z})`);
            if (`${pos().x},${pos().z}` === key) nudges = 99;
            continue;
        }
        frontier = key;
    }
    if (cheb(pos(), dest) <= acceptRadius) {
        session.noteProgress('location', `reached ${what}`);
        return true;
    }
    log(`travel to ${what} failed: at (${pos().x},${pos().z}), ${Math.round(cheb(pos(), dest))} tiles short of (${dest.x},${dest.z})`);
    return false;
}

// ── dialog ──────────────────────────────────────────────────────────────────
/**
 * Click one option per page: a page with several options is a real CHOICE (pick
 * the stated answer), a lone "Click here to continue" is a CONTINUE page. The
 * repeated-click bug that answers a choice as option 1 is avoided by never
 * re-clicking an unchanged page until it has visibly stalled.
 */
function pageSignature(dialog: ReturnType<typeof sdk.getDialog>): string {
    const options = (dialog?.options ?? []).map((o) => o.text).join('|');
    return `${dialog?.text ?? ''}#${options}`;
}

async function drainDialog(preferred: RegExp[], maxPages = 40): Promise<string[]> {
    const seen: string[] = [];
    let lastSig = '';
    let same = 0;
    let closedFor = 0;
    for (let i = 0; i < maxPages; i++) {
        const dialog = sdk.getDialog();
        if (!dialog?.isOpen) {
            closedFor++;
            if (closedFor >= 3 && i > 0) break;
            await sdk.waitForTicks(1);
            continue;
        }
        closedFor = 0;
        if (dialog.isWaiting) {
            await sdk.waitForTicks(1);
            continue;
        }
        for (const c of dialog.allComponents ?? []) if (c.text) seen.push(c.text);
        if (dialog.text) seen.push(dialog.text);
        const options = dialog.options ?? [];
        for (const o of options) seen.push(o.text);
        const sig = pageSignature(dialog);
        same = sig === lastSig ? same + 1 : 0;
        lastSig = sig;
        if (same > 3 && same % 3 !== 0) {
            await sdk.waitForTicks(1);
            continue;
        }
        const isChoice = options.length > 1 && !options.every((o) => /^click here to continue$/i.test(o.text));
        const pick = isChoice
            ? (preferred.map((re) => options.find((o) => re.test(o.text))).find(Boolean) ?? options[0])
            : options[0];
        if (!pick) {
            await sdk.waitForTicks(1);
            continue;
        }
        log(`dialog -> ${pick.text}`);
        await sdk.sendClickDialog(pick.index);
        await sdk.waitForTicks(2);
    }
    await bot.dismissBlockingUI().catch(() => undefined);
    return seen;
}

async function talkDoric(): Promise<boolean> {
    if (cheb(pos(), DORIC_INSIDE) > 12) {
        if (!(await goToArea(DORIC_INSIDE, 'Doric', 6))) log(`Doric travel short at ${pos().x},${pos().z}`);
    }
    for (let attempt = 0; attempt < 3; attempt++) {
        await bot.dismissBlockingUI().catch(() => undefined);
        // Doric stands INSIDE his hut and the collision data masks its door, so a
        // planned route stops on the wall line (2952,3448) and `talkTo` answers
        // "not reachable ... closed door". `walkTo` at the interior tile opens the
        // door on the way (proven live: the accept talk lands from (2952,3450)),
        // so close the last two tiles that way before every talk.
        if (cheb(pos(), DORIC_INSIDE) > 1) {
            log(`stepping inside to Doric @ ${pos().x},${pos().z} (attempt ${attempt + 1}/3)`);
            await bot.walkTo(DORIC_INSIDE.x, DORIC_INSIDE.z, 1).catch(() => undefined);
            await sdk.waitForTicks(2);
        }
        if (sdk.findNearbyNpc(/^doric$/i)) {
            const talked = (await withTimeout(bot.talkTo(/^doric$/i), 45_000, 'talkTo Doric')) ?? { success: false, message: 'timeout' };
            if (talked.success) return true;
            log(`talk Doric: ${talked.message ?? '?'}`);
        } else {
            log(`Doric not in view @ ${pos().x},${pos().z} (attempt ${attempt + 1}/3)`);
        }
        await sdk.waitForTicks(3);
    }
    log(`could not reach Doric @ ${pos().x},${pos().z} l${pos().level}`);
    return false;
}

/** Accept the quest: the journal must move to `started`, or the hand-in can never work. */
async function acceptQuest(): Promise<boolean> {
    for (let attempt = 0; attempt < 3; attempt++) {
        if (!(await talkDoric())) continue;
        const seen = await drainDialog([/i wanted to use your anvils/i, /yes, i will get you materials/i]);
        log(`Doric accept talk (attempt ${attempt + 1}): ${seen.slice(-6).join(' | ')}`);
        if (await checkpoint('started', 'quest accepted, Doric wants 6 clay / 4 copper / 2 iron', 6)) return true;
        log('accept talk did not move the journal to started — re-talking');
    }
    return false;
}

// ── mining ──────────────────────────────────────────────────────────────────
/**
 * Rocks that just produced nothing (depleted, or held by another miner). On the
 * live server the nearest iron rock is strip-mined by other players, and
 * re-clicking a DEPLETED rock returns `Nothing happened` forever — the loc stays
 * in the scan with its `Mine` option, so a nearest-first picker hammers one dead
 * tile until the run's budget is gone. Observed on the first canary: 6 clay and
 * 4 copper landed, then eight identical `Nothing happened interacting with Rocks
 * iron ore` lines at (2969,3240) and no ore.
 */
const rockCooldown = new Map<string, number>();
const ROCK_COOLDOWN_MS = 12_000;
const cooldownKey = (rock: { x: number; z: number }) => `${rock.x},${rock.z}`;
const coolRock = (rock: { x: number; z: number }) => rockCooldown.set(cooldownKey(rock), Date.now() + ROCK_COOLDOWN_MS);

async function findRock(kind: Kind) {
    const locs = await sdk.scanNearbyLocs(16).catch(() => [] as ReturnType<typeof sdk.getNearbyLocs>);
    const now = Date.now();
    const candidates = (locs ?? [])
        .filter((l) => ROCK_IDS[kind].has(l.id) && l.optionsWithIndex.some((o) => /^mine$/i.test(o.text)))
        .sort((a, b) => (a.distance ?? 99) - (b.distance ?? 99));
    const fresh = candidates.filter((l) => (rockCooldown.get(cooldownKey(l)) ?? 0) <= now);
    if (fresh.length) return fresh[0]!;
    // Every rock of this kind is cooling: pick the one whose cooldown expires
    // first so a single-rock site still makes progress instead of idling forever.
    return candidates.sort((a, b) => (rockCooldown.get(cooldownKey(a)) ?? 0) - (rockCooldown.get(cooldownKey(b)) ?? 0))[0] ?? null;
}

/** Walk adjacent to the rock: a `Mine` click from >2 tiles dies `I can't reach that!`. */
async function approach(rock: { x: number; z: number }): Promise<boolean> {
    if (cheb(pos(), rock) <= 2) return true;
    // The rock's own tile is unwalkable, so walk AT it with tolerance 2 and let
    // the client stop on the nearest standable neighbour.
    await withTimeout(bot.walkTo(rock.x, rock.z, 2), 45_000, 'approach rock');
    await sdk.waitForTicks(2);
    return cheb(pos(), rock) <= 2;
}

/**
 * One ore of `kind`. Gated on the INVENTORY COUNT RISING (an XP or click receipt
 * proves nothing about the bag), with a bounded wait because a mining swing
 * self-queues and only lands on a successful roll.
 */
async function mineOne(kind: Kind): Promise<boolean> {
    const before = oreCount(kind);
    const xpBefore = miningXp();
    const rock = await findRock(kind);
    if (!rock) {
        log(`no ${kind} rock in view @ ${pos().x},${pos().z} (${oreLine()})`);
        return false;
    }
    if (!(await approach(rock))) {
        log(`${kind} rock @ ${rock.x},${rock.z} still ${cheb(pos(), rock)} tiles away @ ${pos().x},${pos().z}`);
        coolRock(rock);
        return false;
    }
    const res = (await withTimeout(bot.interactLoc(rock, /^mine$/i), 30_000, `mine ${kind}`)) ?? { success: false, message: 'timeout' };
    if (!res.success) log(`mine ${kind} @ ${rock.x},${rock.z}: ${res.message ?? '?'}`);
    // Bounded wait on the BAG, not on the click receipt: a mining swing
    // self-queues server-side and only lands on a successful roll.
    const deadline = Date.now() + 20_000;
    while (Date.now() < deadline && oreCount(kind) <= before) await sdk.waitForTicks(2);
    const gainedOre = oreCount(kind) > before;
    // No ore from an adjacent swing means the rock is depleted or contested:
    // skip it for a respawn cycle rather than clicking the same tile again.
    if (!gainedOre) coolRock(rock);
    if (miningXp() > xpBefore) session.noteProgress('xp', `mining ${miningXp() - xpBefore} xp`);
    if (gainedOre) {
        session.noteProgress('inventory', `${kind} ${oreCount(kind)}/${NEED[kind]}`);
        log(`mined ${kind} -> ${oreLine()}`);
        return true;
    }
    return false;
}

/** Mine `kind` until the need is met, bounded, with a visible stall signal. */
async function mineUntil(kind: Kind): Promise<void> {
    const budget = Math.max(30, NEED[kind] * 14);
    let misses = 0;
    let streakWarned = false;
    for (let attempt = 0; attempt < budget && missing(kind) > 0; attempt++) {
        await guardTransport();
        if (pos().isDead) {
            log('died while mining — waiting to respawn');
            await sdk.waitForCondition((s) => !s.player.isDead, 45_000).catch(() => undefined);
            continue;
        }
        if (!(await findRock(kind))) {
            // Rocks deplete for 6-10 ticks: step back to the anchor and rescan
            // rather than clicking at a stale loc list.
            if (cheb(pos(), MINE_ANCHOR) > 4) await goToArea(MINE_ANCHOR, 'the mine anchor', 8);
            await sdk.waitForTicks(4);
            continue;
        }
        if (await mineOne(kind)) {
            misses = 0;
            streakWarned = false;
            continue;
        }
        misses++;
        if (misses >= 8 && !streakWarned) {
            streakWarned = true;
            log(`stall: ${misses} consecutive ${kind} swings with no ore (${oreLine()}) @ ${pos().x},${pos().z}`);
            session.log('warn', `mining stall on ${kind} (${misses} misses, ${oreLine()})`);
        }
        await sdk.waitForTicks(3);
    }
    if (missing(kind) > 0) log(`mining short: ${kind} still ${missing(kind)} short (${oreLine()})`);
}

async function collectOres(): Promise<void> {
    if (hasAllOres()) return;
    await bot.dismissBlockingUI().catch(() => undefined);
    await session.setPhase('mine');
    if (!(await goToArea(MINE_ANCHOR, 'the Rimmington mine', 12))) {
        throw new Error(`could not reach the Rimmington mine at ${pos().x},${pos().z}`);
    }
    for (const kind of ['clay', 'copper', 'iron'] as Kind[]) {
        if (missing(kind) === 0) continue;
        await mineUntil(kind);
    }
    if (!hasAllOres()) {
        throw new Error(`gathering failed: mined short of the quest's needs (${oreLine()})`);
    }
    log(`Bag: ${oreLine()} slots=${sdk.getInventory().filter((i) => (i.count ?? 0) > 0).length}`);
}

// ── hand-in ─────────────────────────────────────────────────────────────────
async function handIn(): Promise<boolean> {
    await session.setPhase('handin');
    for (let attempt = 0; attempt < 3; attempt++) {
        if (!(await talkDoric())) continue;
        const seen = await drainDialog([/i have everything you need/i]);
        log(`Doric hand-in talk (attempt ${attempt + 1}): ${seen.slice(-6).join(' | ')}`);
        // The completion runs through a queue after the dialog, and the journal
        // write follows it: settle before judging, never sample once.
        for (let i = 0; i < 10; i++) {
            await sdk.waitForTicks(4);
            if (await checkpoint('complete', 'journal reports QUEST COMPLETE', 2)) return true;
        }
        log('journal still not complete after the hand-in talk');
    }
    return false;
}

// ── bank out ────────────────────────────────────────────────────────────────
/**
 * The Falador West bank approach. From the NORTH the static plan crosses the
 * closed gap at (2964-2967,3397): the planner rates it ~11 tiles, the client
 * refuses it, and the logger then reports "33 tiles short" on a leg the plan
 * thinks is short. Come round the east gate and walk the booth row instead.
 * Waypoints verified in collision data (all walkable at plane 0).
 */
const FALADOR_APPROACH = [
    { x: 3012, z: 3364 },
    { x: 2988, z: 3368 },
    { x: 2964, z: 3372 },
    { x: 2946, z: 3368 }
];

async function goToFaladorWest(what: string): Promise<boolean> {
    if (cheb(pos(), FALADOR_BANK) <= 6) return true;
    for (const wp of FALADOR_APPROACH) {
        if (cheb(pos(), FALADOR_BANK) <= 6) break;
        if (cheb(pos(), wp) <= 4) continue;
        await withTimeout(bot.walkTo(wp.x, wp.z, 4), 120_000, `approach ${wp.x},${wp.z}`).catch(() => undefined);
        await sdk.waitForTicks(1);
        log(`Falador approach -> (${wp.x},${wp.z}): now (${pos().x},${pos().z}) ${Math.round(cheb(pos(), FALADOR_BANK))} from the bank`);
        session.noteProgress('location', `Falador approach ${wp.x},${wp.z}`);
    }
    if (cheb(pos(), FALADOR_BANK) <= 6) return true;
    // Still short: let the planner try from where we actually stand.
    return goToArea(FALADOR_BANK, what, 4);
}

/** Hand the account back clean. Runs AFTER the completion checkpoint: WARN only, never throw. */
async function bankOut(): Promise<void> {
    try {
        await session.setPhase('bankout');
        if (!(await goToFaladorWest('the Falador West bank'))) {
            log(`WARN bank-out travel failed at ${pos().x},${pos().z}`);
            return;
        }
        if (!(await openBankHere())) {
            log('WARN bank-out could not open the bank');
            return;
        }
        for (const worn of sdk.getEquipment().filter((i) => (i.count ?? 0) > 0)) {
            await bot.unequipItem(worn).catch(() => undefined);
        }
        const n = await depositEverything();
        await bot.closeInterface().catch(() => undefined);
        log(`Banked out: ${n} item(s), bag now ${sdk.getInventory().filter((i) => (i.count ?? 0) > 0).length} slot(s)`);
    } catch (error) {
        log(`WARN bank-out failed (non-fatal): ${(error as Error).message}`);
    }
}

// ── run ─────────────────────────────────────────────────────────────────────
async function main(): Promise<void> {
    log(
        `Doric's Quest start Mining ${sdk.getSkill('Mining')?.baseLevel ?? 0} (${miningXp()} xp) @ ` +
            `${pos().x},${pos().z} l${pos().level} pick=${hasPickaxe() ? 'yes' : 'no'} ` +
            `inv=${sdk.getInventory().filter((i) => (i.count ?? 0) > 0).length}`
    );

    // Stage probe BEFORE any side effect: a finished account must not bank, and a
    // resume must not be asked for a stage it cannot demonstrate.
    const stage = await readStage();
    log(`Quest stage at start: ${stage}`);
    const required: Stage[] =
        stage === 'complete' ? ['complete'] : stage === 'started' ? ['started', 'complete'] : ['not_started', 'started', 'complete'];
    startRun(required);

    if (stage === 'complete') {
        log("Doric's Quest is already complete — nothing to do");
        if (!(await checkpoint('complete', 'journal reports QUEST COMPLETE', 3))) {
            throw new Error('promotion gate failed: journal does not report the quest complete');
        }
        const summary = summarizeRun(run!.directory);
        if (!summary.ok) throw new Error(`promotion gate failed: missing/unpassed ${JSON.stringify(summary.missing)}`);
        // Exit AT ONCE: the brief the canary tier and the fleet todo-runner invoke under
        // requires an already-finished account to write the checkpoint and leave, with no
        // bank-out and no supply trek. A finished account has nothing to bank here.
        log("DONE Doric's Quest (already complete)");
        return;
    }

    if (stage === 'not_started' && !(await checkpoint('not_started', 'quest not yet started'))) {
        log('WARN not_started checkpoint did not read PASS; continuing (the run will fail honestly if it cannot be proven)');
    }

    await session.setPhase('bank');
    await bankForQuest();

    // Mine BEFORE talking to Doric. The quest varp only gates the HAND-IN dialog,
    // so accepting and handing the ores over in one visit is legal (quest_doric.rs2:
    // the accept sets %doricquest=10 and the next talk goes to doric_materials) —
    // and it removes a 210-tile round trip from a route that is already the run's
    // longest leg (bank 3369 -> mine 3242 is ~131 tiles; the mine -> Doric leg is 210).
    await collectOres();

    if (stage === 'started') {
        // A resume still has to PROVE the stage it resumed at, but must not re-run
        // the accept chain (re-picking a start option can reset the varp).
        if (!(await checkpoint('started', 'resumed mid-quest', 2))) {
            throw new Error('started checkpoint failed on resume: the journal does not report the quest as started');
        }
        log('Resume: quest already started — going straight to the ores');
    } else if (!(await acceptQuest())) {
        throw new Error('started checkpoint never passed: the quest did not start (dialog)');
    }

    if (!(await handIn())) throw new Error('hand-in did not complete the quest (journal never read QUEST COMPLETE)');

    const summary = summarizeRun(run!.directory);
    if (!summary.ok) throw new Error(`promotion gate failed: missing/unpassed ${JSON.stringify(summary.missing)}`);
    session.noteProgress('inventory', 'quest complete (journal-verified)');
    log(`DONE Doric's Quest verified via journal at ${pos().x},${pos().z} — checkpoints ${required.join(',')}`);
    await bankOut();
}

let code = 0;
try {
    await main();
    session.stop('done', "Doric's Quest complete", { restartable: false });
} catch (error) {
    code = 1;
    log(`FAILED — ${(error as Error).message}`);
    session.stop('failed', `doric's quest failed: ${(error as Error).message}`, { restartable: false });
} finally {
    await sdk.disconnect().catch(() => undefined);
}
process.exit(code);
