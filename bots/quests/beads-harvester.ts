/**
 * Bead harvester — farm imp beads for the quest accounts.
 *
 *   bun bots/quests/beads-harvester.ts <bot> [--target=8] [--minutes=90] [--bank=draynor]
 *
 * Why this exists: Imp Catcher needs one of each of four beads, and the drop rate
 * makes a fresh account hunt for tens of minutes. Beads are tradeable, so the
 * sane split is a dedicated harvester that fills a bank and a quest script that
 * withdraws one of each (`imp-catcher.ts` takes banked beads before hunting).
 *
 * The quest script keeps its own hunt path: if the bank is empty it still works,
 * just slowly. This script never touches the quest — it kills imps, keeps beads,
 * banks the rest.
 *
 * Movement uses the offline planner + hop walker (`walk-route`), never
 * `bot.walkTo` for long legs: the client pathfinder has no graph for stretches of
 * the map and a blocked leg records itself in `travel-gaps.jsonl`.
 */
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

import { ActivitySession, BotSDK, deriveGatewayUrl } from '../../sdk/index';
import { BotActions } from '../../sdk/actions';
import { findLongPath, initPathfinding } from '../../sdk/pathfinding';
import { installGracefulShutdown } from '../../sdk/runner';
import { hopSend, playerPos, waitForPlayerState } from './movement';
import { travelTo } from './travel';
import { FLEET_BANKS, type Tile } from './tiles';

const argv = process.argv.slice(2);
const botArg = argv.find((a) => !a.startsWith('-'));
const flag = (name: string, fallback: string) => argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
if (!botArg) throw new Error('usage: beads-harvester.ts <bot> [--camp=ardougne] [--target=8|0] [--minutes=0] [--trip-kills=60] [--bank=<slug>]');

/**
 * Camps, from the map data (`quest-lab-npcfind.ts imp`), not from habit:
 *
 *   9 imps  (2632,3218)  Ardougne Monastery / Tower of Life   <- best single camp
 *   8 imps  (2610,3126)  Ardougne south coast
 *   8 imps  (2845,3175)  Observatory
 *   0 imps  (3108,3154)  Wizards' Tower  <- what the quest script had inherited
 *
 * The quest's camp has NO static imp spawns within 40 tiles; a "hunt" there is
 * waiting for wanderers, which is why a 30-minute hunt produced under four beads.
 */
const CAMPS = {
    // (2632,3218) is inside a tree cluster (probe-camp.ts walkability grid); the
    // camp tile must be open ground, and the hunt radius covers the spawns.
    ardougne: { tile: { x: 2634, z: 3220 }, bank: 'ardougne', imps: 9 },
    'ardougne-south': { tile: { x: 2610, z: 3126 }, bank: 'yanille', imps: 8 },
    observatory: { tile: { x: 2845, z: 3175 }, bank: 'yanille', imps: 8 },
    'wizards-tower': { tile: { x: 3108, z: 3154 }, bank: 'draynor', imps: 0 },
} as const;
type CampName = keyof typeof CAMPS;
const CAMP_NAME = flag('camp', 'ardougne') as CampName;
if (!(CAMP_NAME in CAMPS)) throw new Error(`unknown camp '${CAMP_NAME}' (have: ${Object.keys(CAMPS).join(', ')})`);
const CAMP = CAMPS[CAMP_NAME];
const IMP_CAMP = CAMP.tile;

const TARGET = Math.max(0, Number(flag('target', '0')));
// 0 = run until stopped (a standing harvester); >0 = give up after that long.
const MINUTES = Math.max(0, Number(flag('minutes', '0')));
const TRIP_KILLS = Math.max(10, Number(flag('trip-kills', '60')));
const BANK_SLUG = flag('bank', CAMP.bank);
const BANK = FLEET_BANKS.find((b) => b.name.toLowerCase().replace(/\s+/g, '-') === BANK_SLUG);
if (!BANK) throw new Error(`unknown bank '${BANK_SLUG}' (have: ${FLEET_BANKS.map((b) => b.name.toLowerCase().replace(/\s+/g, '-')).join(', ')})`);

const envPath = join(process.cwd(), 'bots', botArg, 'bot.env');
if (!existsSync(envPath)) throw new Error(`bot.env not found at ${envPath}`);
for (const line of readFileSync(envPath, 'utf-8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq > 0) process.env[t.slice(0, eq)] = t.slice(eq + 1);
}
const username = process.env.BOT_USERNAME!;

const IMP = /^imp$/i;
const BEAD = /bead$/i;
const FOOD = /shark|lobster|swordfish|trout|salmon|tuna|bass|monkfish/i;
const HUNT_RADIUS = 18;
const MAX_TRIPS = 40;

initPathfinding();

const sdk = new BotSDK({
    botUsername: username,
    password: process.env.PASSWORD!,
    gatewayUrl: deriveGatewayUrl(process.env.SERVER),
    autoLaunchBrowser: false,
    readyTimeout: 45_000,
    connectTimeout: 60_000,
    autoReconnect: false,
    showChat: false,
});
await sdk.connect();
const bot = new BotActions(sdk);
const GRIND_LOG = join(process.cwd(), 'bots', username, 'grind.log');
const session = new ActivitySession(sdk, bot, { name: 'bead-harvester', grindLogPath: GRIND_LOG, stallMs: 300_000, maxRecoveryTactics: 8 });
installGracefulShutdown({ graceMs: 120_000 });

const log = (message: string): void => {
    session.log('log', message);
    void session.showIntent(message).catch(() => undefined);
    console.log(`[beads] ${message}`);
};
const pos = () => playerPos(sdk);
/** hp/maxHp/inCombat live on the player state, not in the position helper. */
const vitals = () => {
    const p = sdk.getState()?.player as { hp?: number; maxHp?: number; inCombat?: boolean } | undefined;
    return { hp: p?.hp ?? 99, maxHp: p?.maxHp ?? 99, inCombat: p?.inCombat === true };
};
const beadCount = () => sdk.getInventory().filter((i) => BEAD.test(i.name)).reduce((n, i) => n + (i.count ?? 1), 0);
const foodCount = () => sdk.getInventory().filter((i) => FOOD.test(i.name)).reduce((n, i) => n + (i.count ?? 1), 0);
const dist = (x: number, z: number) => Math.hypot(pos().x - x, pos().z - z);

/**
 * Walk to a destination using the shared chained traveller.
 *
 * A camp is a radius, not a tile — trees and boulders in the monastery grounds
 * block the last few tiles, and an imp in view is all the camp is for.
 */
/**
 * Last-resort escape when every hop is refused: a bot can end up boxed in a
 * stall/store room (observed live: jacklove4 sat at 2648,3265 among Counters,
 * Tables, Crates and Bullrushes with every 10-tile and 6-tile chord refused, for
 * four hours, banking nothing). Transport was healthy -- a fresh controller
 * walked fine from the same tile -- so the cure is geometry: open the door we are
 * behind, then nudge one tile at a time until the client accepts a step.
 */
async function escapeStuck(why: string): Promise<boolean> {
    const from = pos();
    log(`stuck escape @ ${from.x},${from.z}: ${why}`);
    await sdk.scanNearbyLocs(8).catch(() => undefined);
    const doors = (sdk.getNearbyLocs() ?? [])
        .filter((l) => /door|gate/i.test(l.name ?? '') && (l.distance ?? 99) <= 7)
        .sort((a, b) => (a.distance ?? 99) - (b.distance ?? 99));
    for (const door of doors) {
        if (!door.optionsWithIndex.some((o) => /^open$/i.test(o.text))) continue;
        const opened = await bot.interactLoc(door, /^open$/i).catch(() => ({ success: false } as any));
        log(`  opened ${door.name ?? 'door'} @ ${door.x},${door.z}: ${opened?.success ?? false}`);
        await sdk.waitForTicks(3);
        if (Math.hypot(pos().x - from.x, pos().z - from.z) >= 1) return true;
    }
    // One-tile nudges in every direction: a short raw step is what the client
    // accepts when a chord across a corner is refused.
    for (const [dx, dz] of [[0, 1], [1, 0], [0, -1], [-1, 0], [1, 1], [-1, -1], [1, -1], [-1, 1]] as [number, number][]) {
        const tx = from.x + dx;
        const tz = from.z + dz;
        await sdk.sendWalk(tx, tz, false).catch(() => undefined);
        for (let i = 0; i < 6; i++) {
            await sdk.waitForTicks(1);
            if (Math.hypot(pos().x - from.x, pos().z - from.z) >= 1) {
                log(`  nudged to ${pos().x},${pos().z} (${dx},${dz})`);
                return true;
            }
        }
    }
    const near = (sdk.getNearbyLocs() ?? []).filter((l) => (l.distance ?? 99) <= 3).map((l) => l.name);
    log(`  still stuck — nothing within 3 tiles: ${near.join(', ') || '(none)'}`);
    return false;
}

async function travel(dest: Tile, what: string): Promise<void> {
    // Accept "short" only when the spot is genuinely good enough to work from:
    // an imp merely IN SIGHT is not — that rule let the harvester declare a spot
    // 47 tiles from the camp "the camp" and then harvest nothing forever.
    const acceptShort = what.includes('camp')
        ? (d: number) => {
            if (d <= 6) return true;
            const imp = findImp();
            return imp !== null && (imp.distance ?? 99) <= 8 && imp.reachable !== false;
        }
        : undefined;

    let res = await travelTo(sdk, bot, dest, { log: (l: string) => log(`   ${l}`), acceptShortOf: acceptShort });
    if (!res.ok) {
        // One escape attempt, then re-plan from wherever the nudge landed.
        await escapeStuck(res.reason ?? 'travel failed');
        res = await travelTo(sdk, bot, dest, { log: (l: string) => log(`   ${l}`), acceptShortOf: acceptShort, maxPlans: 12 });
    }
    if (!res.ok) throw new Error(`could not reach ${what}: ${res.reason}`);
    log(`at ${what} (${res.at.x},${res.at.z}) l${res.at.level}${res.reason ? ` (${res.reason})` : ''}`);
}

function findImp() {
    return (sdk.getNearbyNpcs() ?? [])
        .filter(
            (n) =>
                IMP.test(n.name) &&
                (n.hp === null || n.hp > 0) &&
                n.optionsWithIndex.some((o) => /attack/i.test(o.text)) &&
                (n.reachable !== false || (n.distance ?? 99) <= 9) &&
                Math.hypot(n.x - pos().x, n.z - pos().z) <= HUNT_RADIUS + 8,
        )
        .sort((a, b) => (a.distance ?? 99) - (b.distance ?? 99))[0] ?? null;
}

/**
 * Wear the best weapon this account can actually wield.
 *
 * The harvester is armed for two reasons: a wandering imp/dog that aggroes is
 * killable instead of shrugged off, and an account that is parked at a camp with
 * 1M coins should not be swinging its fists. The ladder is static on purpose
 * (tier + wield level), sourced from the bank/inventory only — a shop trip for a
 * weapon is a quest-style errand, not something a harvester should do mid-run.
 * Wield failures are silent engine-side, so the equip is verified against
 * `getState().equipment` and logged with before/after names.
 */
const WEAPON_LADDER: { name: RegExp; label: string; level: number }[] = [
    { name: /^dragon (longsword|scimitar)$/i, label: 'dragon longsword', level: 60 },
    { name: /^rune (scimitar|longsword)$/i, label: 'rune scimitar', level: 40 },
    { name: /^adamant (scimitar|longsword)$/i, label: 'adamant scimitar', level: 30 },
    { name: /^mithril (scimitar|longsword)$/i, label: 'mithril scimitar', level: 20 },
    { name: /^black (scimitar|longsword)$/i, label: 'black scimitar', level: 10 },
    { name: /^steel (scimitar|longsword)$/i, label: 'steel scimitar', level: 5 },
    { name: /^iron (scimitar|longsword)$/i, label: 'iron scimitar', level: 1 },
    { name: /^bronze (scimitar|longsword)$/i, label: 'bronze scimitar', level: 1 },
];

async function armUp(): Promise<void> {
    const attack = sdk.getSkill('Attack')?.baseLevel ?? 1;
    const worn = (sdk.getState()?.equipment ?? []).map(e => e.name).join(',') || '(nothing)';
    const carry = sdk.getInventory();
    log(`armoury: Attack ${attack}, wielding ${worn}`);

    // Already holding something from the top of the ladder? Leave it alone.
    const best = WEAPON_LADDER.find(w => attack >= w.level);
    if (!best) { log('armoury: no ladder entry usable at Attack 1'); return; }
    if (carry.some(i => best.name.test(i.name)) || (sdk.getState()?.equipment ?? []).some(e => best.name.test(e.name))) {
        const held = carry.find(i => best.name.test(i.name)) ?? (sdk.getState()?.equipment ?? []).find(e => best.name.test(e.name));
        if (held && !(sdk.getState()?.equipment ?? []).some(e => e.name === held.name)) {
            const res = await bot.equipItem(held).catch(() => ({ success: false } as any));
            log(`armoury: equipped ${held.name}: ${res?.success ?? false}`);
        }
        return;
    }

    // Otherwise walk the ladder from the top: wield level first, then stock.
    let bankItems = sdk.getState()?.bank?.items ?? [];
    if (!sdk.getState()?.bank?.isOpen && !(await bot.openBank().success)) {
        log('armoury: bank not open — skipping the weapon step');
        return;
    }
    await sdk.waitForTicks(2);
    bankItems = sdk.getState()?.bank?.items ?? [];
    for (const step of WEAPON_LADDER) {
        if (attack < step.level) continue;
        const inBank = bankItems.find(i => step.name.test(i.name));
        if (!inBank) continue;
        if (!sdk.getState()?.bank?.isOpen && !(await bot.openBank().success)) {
            log('armoury: bank closed before the withdraw');
            return;
        }
        const got = await bot.withdrawItem(inBank, 1).catch(() => ({ success: false } as any));
        await sdk.waitForTicks(2);
        log(`armoury: withdrew ${inBank.name}: ${got?.success ?? false}`);
        const held = sdk.getInventory().find(i => step.name.test(i.name));
        if (!held) { log('armoury: withdraw did not land in the bag'); continue; }
        await bot.closeInterface().catch(() => undefined);
        const worn2 = await bot.equipItem(held).catch(() => ({ success: false } as any));
        await sdk.waitForTicks(2);
        const nowWorn = (sdk.getState()?.equipment ?? []).some(e => e.name === held.name);
        log(`armoury: equipped ${held.name} (${step.label}): ok=${worn2?.success ?? false} worn=${nowWorn}`);
        if (nowWorn) return;
    }
    log(`armoury: nothing on the ladder banked for Attack ${attack} — wielding ${worn}`);
}

async function bankTrip(): Promise<void> {
    session.setPhase('bank').catch(() => undefined);
    await travel({ x: BANK.x, z: BANK.z }, `${BANK.name} bank`);
    if (!(await bot.openBank()).success) {
        await bot.closeInterface();
        if (!(await bot.openBank()).success) throw new Error('could not open the bank on a harvester trip');
    }
    await sdk.waitForTicks(2);
    // Keep beads and food; everything else (loot) goes in.
    for (const item of sdk.getInventory().filter((i) => (i.count ?? 0) > 0 && !BEAD.test(i.name) && !FOOD.test(i.name))) {
        await bot.depositItem(item, -1);
    }
    await bot.closeInterface();
    session.noteProgress('bank', `banked loot; beads held ${beadCount()}`);
    log(`bank trip done — beads held ${beadCount()}${TARGET > 0 ? `/${TARGET}` : ''}`);
    reportRate();
}

let trips = 0;
let sinceTrip = 0;
let attacks = 0;
let kills = 0;
const startedAt = Date.now();

/** An imp is dead when nothing with its name stands within 2 tiles of where it was. */
function stillAlive(x: number, z: number): boolean {
    return (sdk.getNearbyNpcs() ?? []).some(
        (n) => IMP.test(n.name) && (n.hp === null || n.hp > 0) && Math.hypot(n.x - x, n.z - z) <= 2,
    );
}

/** One line of measured rate, not a guess: beads per kill and per hour. */
function reportRate(): void {
    const hours = (Date.now() - startedAt) / 3_600_000;
    const perKill = kills > 0 ? (beadCount() / kills).toFixed(3) : '—';
    const perHour = hours > 0.02 ? (beadCount() / hours).toFixed(1) : '—';
    log(`rate: ${kills} kills, ${attacks} attacks, ${beadCount()} beads held (${perKill}/kill, ${perHour}/hour, ${trips} trip(s))`);
}
const deadline = MINUTES > 0 ? Date.now() + MINUTES * 60_000 : Number.POSITIVE_INFINITY;
let lastKillAt = Date.now();

log(
    `harvesting ${TARGET > 0 ? `${TARGET} bead(s)` : 'continuously'} at '${CAMP_NAME}' (${IMP_CAMP.x},${IMP_CAMP.z}, ${CAMP.imps} static spawns) -> ${BANK.name} bank; ${MINUTES > 0 ? `budget ${MINUTES} min` : 'until stopped'}`,
);
// Bank first so the armoury step has stock to withdraw, then walk to the camp.
await travel({ x: BANK.x, z: BANK.z }, `${BANK.name} bank`);
await armUp().catch((err: unknown) => log(`armoury step failed: ${String(err)}`));
await travel(IMP_CAMP, 'imp camp');

while (TARGET <= 0 || beadCount() < TARGET) {
    if (session.isStoppedOrRequested()) {
        log('stop requested — banking and finishing');
        break;
    }
    if (Date.now() > deadline) {
        log(`time budget spent with ${beadCount()}/${TARGET} beads`);
        break;
    }
    if (!sdk.isConnected() || !sdk.getState()) {
        await sdk.waitForTicks(4);
        continue;
    }
    if (dist(IMP_CAMP.x, IMP_CAMP.z) > 10) await travel(IMP_CAMP, 'imp camp');
    // If nothing dies for a long stretch we are parked somewhere useless: escape
    // once and force a fresh plan instead of cycling the same refused hops.
    if (Date.now() - lastKillAt > 8 * 60_000) {
        log(`no kill for ${Math.round((Date.now() - lastKillAt) / 60000)} min — forcing a stuck escape`);
        lastKillAt = Date.now();
        await escapeStuck('no kills while standing still');
    }

    // Restock when the bag fills or the food runs out.
    const bagFull = sdk.getInventory().filter((i) => (i.count ?? 0) > 0).length >= 26;
    if (foodCount() === 0 && vitals().hp <= Math.ceil(vitals().maxHp * 0.4)) {
        await bankTrip();
        trips++;
        sinceTrip = 0;
        continue;
    }
    if (bagFull || sinceTrip > TRIP_KILLS) {
        if (trips >= MAX_TRIPS) {
            log('trip budget spent');
            break;
        }
        await bankTrip();
        trips++;
        sinceTrip = 0;
        continue;
    }

    const imp = findImp();
    if (!imp) {
        await sdk.waitForTicks(3);
        sinceTrip++;
        continue;
    }
    if ((imp.distance ?? 99) > 6) {
        await bot.walkTo(imp.x, imp.z, 3).catch(() => undefined);
        await sdk.waitForTicks(1);
        continue;
    }
    const attack = await bot.attack(imp);
    if (!attack.success) {
        await sdk.waitForTicks(1);
        continue;
    }
    attacks++;
    lastKillAt = Date.now();
    const targetX = imp.x;
    const targetZ = imp.z;
    for (let i = 0; i < 40 && vitals().inCombat; i++) await sdk.waitForTicks(1);
    await sdk.waitForTicks(2);
    if (!stillAlive(targetX, targetZ)) kills++;
    for (let i = 0; i < 6; i++) {
        const drop = [...(sdk.getGroundItems() ?? [])]
            .filter((g) => BEAD.test(g.name) && g.reachable !== false && (g.distance ?? 99) <= 12)
            .sort((a, b) => (a.distance ?? 99) - (b.distance ?? 99))[0];
        if (!drop) break;
        const before = beadCount();
        await bot.pickupItem(drop);
        await sdk.waitForTicks(1);
        if (beadCount() > before) session.noteProgress('inventory', `bead ${beadCount()}/${TARGET}`);
    }
    sinceTrip++;
}

log(`finished with ${beadCount()} bead(s) after ${trips} trip(s)`);
reportRate();
await bankTrip().catch((error: unknown) => log(`final bank trip failed: ${(error as Error).message}`));
const reached = TARGET > 0 && beadCount() >= TARGET;
session.stop(reached ? 'done' : 'stopped', `harvester: ${beadCount()} bead(s), ${kills} kills`, { restartable: false });
while (true) await sdk.waitForTicks(100).catch(() => undefined);
