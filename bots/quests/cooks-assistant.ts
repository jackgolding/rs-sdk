/**
 * Cook's Assistant — replayable, checkpoint-gated.
 *
 *   bun bots/quests/cooks-assistant.ts qlcook2
 *
 * Banks at Draynor (Lumbridge has no bank in this revision), withdraws the
 * three ingredients — or gathers them in the world when the bank is short
 * (egg from the chicken farm, milk from the cow pen, flour milled from the
 * wheat field; empty vessels from the bank, else the Lumbridge general
 * store). Then walks to the Cook in Lumbridge Castle, runs the dialog and
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

// Gather constants live up here, next to NEEDED: bankForSupplies() runs before
// anything below it is initialized, and const declarations do not hoist.
const BUCKET_EMPTY = /^bucket$/i;
const POT_EMPTY = /^pot$/i;
const EGG = /^egg$/i;
const GRAIN = /^grain$/i;
const COINS = /^coins$/i;

const CHICKEN_COOP = { x: 3228, z: 3300 };
const COW_GATE = { x: 3253, z: 3266 };
const COW_PEN = { x: 3254, z: 3283 };
const WHEAT_FIELD = { x: 3160, z: 3300 };
const MILL_DOOR = { x: 3166, z: 3301 };
const MILL_CORE = { x: 3166, z: 3306 };
const LUMBRIDGE_SHOP = { x: 3211, z: 3246 };

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

const STAGE = await readStage();
log(`Quest stage at start: ${STAGE}`);
if (STAGE === 'complete') {
    log("Cook's Assistant is already complete — nothing to do");
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
else log('Supplies already carried; skipping the bank leg');

/** Deposit carry-over, then withdraw whatever ingredients are missing. */
async function bankForSupplies(): Promise<void> {
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
    log(`BANK SHORTFALL: ${detail} — sourcing in the world instead of idling`);
    session.log('warn', `bank shortfall: ${detail}; gathering`);
    await gatherIngredients(shortfall);
}

for (const need of NEEDED) {
    if (invCount(need.pattern) > 0) continue;
    // Gathering legs end far from any booth; come back before withdrawing.
    if (distTo(DRAYNOR_BANK) > 8) await travelTo(DRAYNOR_BANK, 'Draynor bank');
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

// ── self-sourcing: a bank shortfall is a detour, not a failure ───────────────
// Mechanics, all read from server/content (never assumed):
//   egg: chickens lay eggs on an AI timer (general/.../flavour_text/chickens.rs2)
//     — camp the farm and pick the ground spawn up.
//   milk: use an empty bucket on a Cow (npc/scripts/cow_milking.rs2, [opnpcu,cow]).
//   flour: pick Wheat (op2 Pick -> grain), use grain on the Hopper upstairs,
//     Operate the Hopper controls, use an empty pot on the Flour bin downstairs
//     (general_use/scripts/windmills.rs2).
// Tiles below are probe-verified on the local world (probe-cookgather):
//   mill doors (3166-3167,3302), flour bin (3166,3307) L0,
//   hopper (3166,3307) L2, controls (3166,3305) L2,
//   wheat field x3154-3164 z3294-3306, cow pen x3244-3264 z3268-3298,
//   Lumbridge general store (3211,3246) stocks Pot 1gp / Bucket 2gp.
async function openBankHere(): Promise<boolean> {
    if (sdk.getState()?.bank?.isOpen) return true;
    await bot.closeInterface();
    return (await bot.openBank()).success;
}

async function ensureCoins(min: number): Promise<boolean> {
    if (invCount(COINS) >= min) return true;
    if (!(await openBankHere())) return false;
    const coins = sdk.findBankItem(COINS);
    if (coins) await bot.withdrawItem(coins, Math.min(min + 50, coins.count ?? min + 50));
    await bot.closeInterface();
    return invCount(COINS) >= min;
}

/** Empty vessel from the bank, else bought at the Lumbridge general store. */
async function stockEmptyVessel(pattern: RegExp, label: string): Promise<boolean> {
    if (invCount(pattern) > 0) return true;
    if (await openBankHere()) {
        const item = sdk.findBankItem(pattern);
        if (item) {
            const res = await bot.withdrawItem(item, 1);
            log(`withdrew ${label} from bank: ${res.success}`);
        }
    }
    if (invCount(pattern) > 0) {
        await bot.closeInterface();
        return true;
    }
    await bot.closeInterface();
    if (!(await ensureCoins(10))) {
        log(`no coins for a shop ${label}`);
        return false;
    }
    await travelTo(LUMBRIDGE_SHOP, 'the Lumbridge general store');
    await bot.dismissBlockingUI();
    if (!(await bot.openShop(/shop\s*(keeper|assistant)/i)).success) {
        log(`could not open the Lumbridge general store for ${label}`);
        return false;
    }
    const buy = await bot.buyFromShop(pattern, 1);
    log(`bought ${label}: ${buy.success}${buy.success ? '' : ` (${buy.message ?? '?'})`}`);
    await bot.closeShop();
    return invCount(pattern) > 0;
}

async function gatherEgg(): Promise<void> {
    if (invCount(EGG) > 0) return;
    await bot.closeInterface();
    // Static egg spawns, probe-verified: two Egg piles in the east Lumbridge
    // chicken coop ((3229,3299) and (3226,3301), plus a Bucket at (3225,3294)).
    // Hens themselves never lay in this revision (the chicken type configures
    // no `timer`, so [ai_timer,_chicken] never fires), so this takes the
    // static spawns and only waits briefly for a respawn — it never camps.
    await travelTo(CHICKEN_COOP, 'the Lumbridge chicken coop');
    for (let i = 0; i < 20 && invCount(EGG) === 0; i++) {
        const pile = sdk.findGroundItem(EGG) ?? await sdk.scanFindGroundItem(EGG, 20).catch(() => null);
        if (pile) {
            const res = await bot.pickupItem(pile);
            log(`picked up egg: ${res.success}${res.success ? '' : ` (${res.message ?? '?'})`}`);
        } else if (i % 5 === 0) {
            log(`waiting for an egg respawn @ (${pos().x},${pos().z}) (${i}/20)`);
        }
        if (invCount(EGG) === 0) await sdk.waitForTicks(8);
    }
    if (invCount(EGG) === 0) {
        throw new Error('gathering failed: no egg in the coop (static spawns empty and hens do not lay in this revision; bank an egg first)');
    }
    log('Bag: eggx1 (gathered)');
}

async function gatherMilk(): Promise<void> {
    const MILK = NEEDED[1]!.pattern;
    if (invCount(MILK) > 0) return;
    if (!(await stockEmptyVessel(BUCKET_EMPTY, 'bucket'))) {
        throw new Error('gathering failed: no empty bucket (bank or Lumbridge general store)');
    }
    await bot.closeInterface();
    await travelTo(COW_GATE, 'the cow-pen gate');
    await travelTo(COW_PEN, 'the dairy cows');
    for (let i = 0; i < 6 && invCount(MILK) === 0; i++) {
        // Fresh scan every attempt: cows wander, a carried target is stale.
        await sdk.scanNearbyLocs(8).catch(() => {});
        const cow = sdk.findNearbyNpc(/^cow$/i);
        if (!cow) {
            log(`no cow in range @ (${pos().x},${pos().z}) l${pos().level} (${i}/6)`);
            await sdk.waitForTicks(6);
            continue;
        }
        const res = await bot.useItemOnNpc(BUCKET_EMPTY, cow);
        log(`milked cow @ (${cow.x},${cow.z}): ${res.success}${res.success ? '' : ` (${res.message ?? '?'})`}`);
        await sdk.waitForTicks(3);
    }
    if (invCount(MILK) === 0) throw new Error('gathering failed: milking produced no bucket of milk');
    log('Bag: bucket of milk x1 (gathered)');
}

/** Climb inside the mill. Stairs are re-scanned every attempt: a plane change
 *  rebuilds the scene, so a carried loc list is stale (settle-and-RETRY). */
async function climbMillTo(targetLevel: number): Promise<void> {
    for (let i = 0; i < 8 && pos().level !== targetLevel; i++) {
        const wantUp = pos().level < targetLevel;
        const opt = wantUp ? /climb-up|climb.up|go-up|go.up/i : /climb-down|climb.down|go-down|go.down/i;
        await sdk.scanNearbyLocs(10).catch(() => {});
        await sdk.waitForTicks(2);
        await sdk.scanNearbyLocs(10).catch(() => {});
        const stairs = (sdk.getNearbyLocs() ?? [])
            .filter((l) => /stair|ladder/i.test(l.name) && l.optionsWithIndex.some((o) => opt.test(o.text)))
            .sort((a, b) => (a.distance ?? 99) - (b.distance ?? 99))[0];
        if (!stairs) {
            log(`no stairs in range @ (${pos().x},${pos().z}) l${pos().level}; stepping to the mill core`);
            await travelTo(MILL_CORE, 'the mill interior');
            continue;
        }
        const before = pos().level;
        log(`Climb ${wantUp ? 'up' : 'down'} ${stairs.name} @ (${stairs.x},${stairs.z})`);
        await bot.interactLoc(stairs, opt);
        await sdk.waitForCondition((s) => (s.player?.level ?? before) !== before, 8_000).catch(() => {});
        await bot.closeInterface();
    }
    if (pos().level !== targetLevel) {
        throw new Error(`gathering failed: stuck at mill level ${pos().level}, wanted ${targetLevel}`);
    }
}

async function gatherFlour(): Promise<void> {
    const FLOUR = NEEDED[2]!.pattern;
    if (invCount(FLOUR) > 0) return;
    if (!(await stockEmptyVessel(POT_EMPTY, 'pot'))) {
        throw new Error('gathering failed: no empty pot (bank or Lumbridge general store)');
    }
    await bot.closeInterface();
    if (invCount(GRAIN) === 0) {
        await travelTo(WHEAT_FIELD, 'the wheat field');
        for (let i = 0; i < 8 && invCount(GRAIN) === 0; i++) {
            await sdk.scanNearbyLocs(10).catch(() => {});
            const wheat = sdk.findNearbyLoc(/^wheat$/i);
            if (!wheat) {
                log(`no wheat in range @ (${pos().x},${pos().z}) (${i}/8)`);
                await sdk.waitForTicks(4);
                continue;
            }
            const res = await bot.interactLoc(wheat, /pick/i);
            log(`picked wheat: ${res.success}${res.success ? '' : ` (${res.message ?? '?'})`}`);
            await sdk.waitForTicks(3);
        }
        if (invCount(GRAIN) === 0) throw new Error('gathering failed: no grain from the wheat field');
    }
    await travelTo(MILL_DOOR, 'the mill door');
    await climbMillTo(2);
    await sdk.scanNearbyLocs(10).catch(() => {});
    await sdk.waitForTicks(2);
    await sdk.scanNearbyLocs(10).catch(() => {});
    const hopper = sdk.findNearbyLoc(/^hopper$/i);
    if (!hopper) throw new Error(`gathering failed: no hopper in range @ (${pos().x},${pos().z}) l${pos().level}`);
    const fill = await bot.useItemOnLoc(GRAIN, hopper);
    log(`grain into the hopper: ${fill.success}${fill.success ? '' : ` (${fill.message ?? '?'})`}`);
    if (!fill.success) throw new Error(`gathering failed: the hopper rejected the grain (${fill.message ?? '?'})`);
    await sdk.waitForTicks(2);
    await sdk.scanNearbyLocs(10).catch(() => {});
    const controls = sdk.findNearbyLoc(/^hopper controls$/i);
    if (!controls) throw new Error('gathering failed: no hopper controls in range');
    const lever = await bot.interactLoc(controls, /operate/i);
    log(`operated the hopper: ${lever.success}${lever.success ? '' : ` (${lever.message ?? '?'})`}`);
    await sdk.waitForTicks(2);
    await climbMillTo(0);
    await bot.closeInterface();
    await sdk.scanNearbyLocs(10).catch(() => {});
    await sdk.waitForTicks(2);
    await sdk.scanNearbyLocs(10).catch(() => {});
    const bin = sdk.findNearbyLoc(/^flour bin$/i);
    if (!bin) throw new Error(`gathering failed: no flour bin in range @ (${pos().x},${pos().z}) l${pos().level}`);
    const fillPot = await bot.useItemOnLoc(POT_EMPTY, bin);
    log(`pot from the flour bin: ${fillPot.success}${fillPot.success ? '' : ` (${fillPot.message ?? '?'})`}`);
    await sdk.waitForTicks(2);
    if (invCount(FLOUR) === 0) throw new Error('gathering failed: the flour bin gave no flour');
    log('Bag: pot of flour x1 (gathered)');
}

async function gatherIngredients(shortfall: typeof NEEDED): Promise<void> {
    // We are AT the bank right now, and the gather legs go far from any
    // booth: take every empty vessel plus shop coins up front. A later
    // stockEmptyVessel can only shop (its bank open fails away from a booth).
    await prestockVessels(shortfall);
    for (const need of shortfall) {
        if (need.name === 'egg') await gatherEgg();
        else if (need.name === 'bucket_milk') await gatherMilk();
        else if (need.name === 'pot_flour') await gatherFlour();
        if (invCount(need.pattern) < 1) throw new Error(`gathering failed: still no ${need.name}`);
    }
    await bot.closeInterface();
    log(`Bag: ${NEEDED.map(n => `${n.name}x${invCount(n.pattern)}`).join(' ')}`);
}

/** One bank visit for all vessels + shop coins, before any travel. */
async function prestockVessels(shortfall: typeof NEEDED): Promise<void> {
    const wants: RegExp[] = [];
    if (shortfall.some(n => n.name === 'bucket_milk')) wants.push(BUCKET_EMPTY);
    if (shortfall.some(n => n.name === 'pot_flour')) wants.push(POT_EMPTY);
    if (!(await openBankHere())) {
        throw new Error('gathering failed: the bank would not open for vessels');
    }
    for (const w of wants) {
        if (invCount(w) > 0) continue;
        const item = sdk.findBankItem(w);
        if (item) {
            const res = await bot.withdrawItem(item, 1);
            log(`prestocked vessel: ${res.success}`);
        }
    }
    if (invCount(COINS) < 10) {
        const coins = sdk.findBankItem(COINS);
        if (coins) await bot.withdrawItem(coins, Math.min(60, coins.count ?? 60));
    }
    await bot.closeInterface();
    log(`Vessels: bucketx${invCount(BUCKET_EMPTY)} potx${invCount(POT_EMPTY)} coinsx${invCount(COINS)}`);
}

// ── travel ──────────────────────────────────────────────────────────────────
/**
 * Open a closed gate/door blocking the way. Called every leg: a gate the
 * planner cannot path through reads as zero-progress otherwise, and retrying
 * the same bearing cannot help.
 */
async function openBlocking(): Promise<void> {
    await sdk.scanNearbyLocs(8).catch(() => {});
    const gate = (sdk.getNearbyLocs() ?? [])
        .filter((l) => /gate|door/i.test(l.name) && (l.distance ?? 99) <= 8
            && l.optionsWithIndex.some((o) => /^open$/i.test(o.text)))
        .sort((a, b) => (a.distance ?? 99) - (b.distance ?? 99))[0];
    if (!gate) return;
    log(`Opening ${gate.name} @ (${gate.x},${gate.z})`);
    await bot.openDoor(gate);
    await sdk.waitForTicks(2);
}

/**
 * Step off an open gate/door tile we are standing on. An open gate reads
 * Close instead of Open, so the opener above ignores it — but the pathfinder
 * refuses to route FROM the gate tile, stalling every leg at zero progress.
 */
async function stepOffOpenGate(): Promise<void> {
    await sdk.scanNearbyLocs(4).catch(() => {});
    const under = (sdk.getNearbyLocs() ?? []).find((l) => /gate|door/i.test(l.name)
        && (l.distance ?? 99) < 1 && l.optionsWithIndex.some((o) => /^close$/i.test(o.text)));
    if (!under) return;
    const p = pos();
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
        const nx = p.x + dx!, nz = p.z + dz!;
        if (nx === under.x && nz === under.z) continue;
        if (!isTileWalkable(0, nx, nz)) continue;
        log(`Stepping off open ${under.name} @ (${under.x},${under.z}) to (${nx},${nz})`);
        await bot.walkTo(nx, nz, 0);
        await sdk.waitForTicks(2);
        return;
    }
    log(`Stuck on open ${under.name} @ (${under.x},${under.z}): no walkable neighbor`);
}

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

        await openBlocking();
        await stepOffOpenGate();
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

// ── 3. travel to the Cook (route planned from wherever we are) ──────────────
await session.setPhase('travel');
await travelTo(cookApproach(), 'the Cook');

// ── 4. start the quest, only from the unstarted stage ───────────────────────
if (STAGE === 'unstarted') {
// Gate BEFORE acting: the quest must really be unstarted, or the dialog below
// acts on an assumption.
if (!(await checkpoint('unstarted', 'quest not yet started'))) {
    throw new Error('unstarted checkpoint failed before starting the quest');
}
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
} else {
    log('Resuming mid-quest: the ingredients request is already journal-confirmed');
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
