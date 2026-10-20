/**
 * Bead harvester — farm imp beads for the quest accounts.
 *
 *   bun bots/beads-harvester.ts <bot> [--target=8] [--minutes=90] [--bank=draynor]
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

import { ActivitySession, BotSDK, deriveGatewayUrl } from '../sdk/index';
import { BotActions } from '../sdk/actions';
import { findLongPath, initPathfinding } from '../sdk/pathfinding';
import { installGracefulShutdown } from '../sdk/runner';
import { hopSend, playerPos, waitForPlayerState } from './quests/movement';
import { walkRoute } from './quests/walk-route';
import { FLEET_BANKS, type Tile } from './quests/tiles';

const argv = process.argv.slice(2);
const botArg = argv.find((a) => !a.startsWith('-'));
const flag = (name: string, fallback: string) => argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
if (!botArg) throw new Error('usage: beads-harvester.ts <bot> [--target=8] [--minutes=90] [--bank=draynor]');

const TARGET = Math.max(1, Number(flag('target', '8')));
const MINUTES = Math.max(1, Number(flag('minutes', '90')));
const BANK_SLUG = flag('bank', 'draynor');
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

const IMP_CAMP = { x: 3108, z: 3154 };
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

function planRoute(dest: Tile): Tile[] {
    try {
        const p = pos();
        const path = findLongPath(p.level, p.x, p.z, dest.x, dest.z) as Tile[] | null;
        if (!path || !path.length) return [{ x: dest.x, z: dest.z }];
        const out: Tile[] = [];
        for (let i = 0; i < path.length; i += 8) {
            const t = path[Math.min(i + 7, path.length - 1)]!;
            out.push({ x: t.x, z: t.z });
        }
        return out;
    } catch {
        return [{ x: dest.x, z: dest.z }];
    }
}

const host = {
    getPos: () => pos(),
    walk: (x: number, z: number) => hopSend(sdk, x, z, 10),
    waitTicks: (n: number) => sdk.waitForTicks(n),
};

async function travel(dest: Tile, what: string): Promise<void> {
    const res = await walkRoute(host, planRoute(dest), { maxHop: 10, tolerance: 3, log: (l) => log(`   ${l}`) });
    if (!res.ok) throw new Error(`could not reach ${what}: blocked ${res.blocked}`);
    log(`at ${what} (${res.at.x},${res.at.z}) l${res.at.level}`);
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
    log(`bank trip done — beads held ${beadCount()}/${TARGET}`);
}

let trips = 0;
let sinceTrip = 0;
const deadline = Date.now() + MINUTES * 60_000;

log(`harvesting ${TARGET} bead(s) at the imp camp; giving up after ${MINUTES} min`);
await travel(IMP_CAMP, 'imp camp');

while (beadCount() < TARGET) {
    if (Date.now() > deadline) {
        log(`time budget spent with ${beadCount()}/${TARGET} beads`);
        break;
    }
    if (!sdk.isConnected() || !sdk.getState()) {
        await sdk.waitForTicks(4);
        continue;
    }
    if (dist(IMP_CAMP.x, IMP_CAMP.z) > 10) await travel(IMP_CAMP, 'imp camp');

    // Restock when the bag fills or the food runs out.
    const bagFull = sdk.getInventory().filter((i) => (i.count ?? 0) > 0).length >= 26;
    if (foodCount() === 0 && vitals().hp <= Math.ceil(vitals().maxHp * 0.4)) {
        await bankTrip();
        trips++;
        sinceTrip = 0;
        continue;
    }
    if (bagFull || sinceTrip > 60) {
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
    for (let i = 0; i < 40 && vitals().inCombat; i++) await sdk.waitForTicks(1);
    await sdk.waitForTicks(2);
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

log(`finished with ${beadCount()}/${TARGET} beads after ${trips} trip(s)`);
await bankTrip().catch((error: unknown) => log(`final bank trip failed: ${(error as Error).message}`));
session.stop(beadCount() >= TARGET ? 'done' : 'stopped', `harvester: ${beadCount()}/${TARGET} beads`, { restartable: false });
while (true) await sdk.waitForTicks(100).catch(() => undefined);
