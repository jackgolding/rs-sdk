/**
 * Wilderness black unicorns east of Edgeville (3209, 3672), wildy ~20.
 * They flee. Hop in short sendWalks, loot unicorn horns, bank at Edgeville.
 * Never bot.walkTo north of the ditch.
 *
 *   bun bots/quests/black-unicorns.ts Jackpoo5
 */
import { existsSync, readFileSync } from 'fs';
import { dirname, join } from 'path';
import { ActivitySession, BotSDK, deriveGatewayUrl, inWilderness } from '../../sdk/index';
import { BotActions } from '../../sdk/actions';
import { initPathfinding } from '../../sdk/pathfinding';
import { DITCH_NORTH, DITCH_SOUTH, EDGEVILLE } from './tiles';
import { closeUi, hopSend, installWaitForTicksGuard, leaveEdgevilleWilderness, playerPos, walkNear } from './movement';
import { foodHeal } from './food-heal';
import { installGracefulShutdown } from '../../sdk/runner';

const CAMP = { x: 3209, z: 3672 };
const HUNT = { minX: 3188, maxX: 3236, minZ: 3648, maxZ: 3696 };
const FOOD_WITHDRAW = 6;
const TO_CAMP = [
    { x: 3120, z: 3535 },
    { x: 3160, z: 3565 },
    { x: 3200, z: 3605 },
    { x: 3209, z: 3640 },
    CAMP
];
const TO_EDGE = [
    { x: 3212, z: 3424 },
    { x: 3130, z: 3450 },
    EDGEVILLE
];

const UNICORN = /^black unicorn$/i;
const HORN = /^unicorn horn$/i;
const SHARK = /^shark$/i;
const DLONG = /^dragon longsword$/i;
const FOOD = /shark|bass|swordfish|lobster|tuna|salmon|trout|pike|cod|shrimp|anchov/i;

const argv = process.argv.slice(2);
const botArg = argv.find((a) => !a.startsWith('-') && !a.endsWith('.ts'));

function loadBotEnv(): void {
    const envPath = botArg
        ? join(process.cwd(), 'bots', botArg, 'bot.env')
        : join(dirname(import.meta.path), 'bot.env');
    if (!existsSync(envPath)) {
        throw new Error(`bot.env not found at ${envPath}. Usage: bun bots/quests/black-unicorns.ts {botname}`);
    }
    for (const line of readFileSync(envPath, 'utf-8').split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eq = trimmed.indexOf('=');
        if (eq > 0) process.env[trimmed.slice(0, eq)] = trimmed.slice(eq + 1);
    }
}

loadBotEnv();

const username = process.env.BOT_USERNAME!;
const password = process.env.PASSWORD!;
const server = process.env.SERVER;
const GRIND_LOG = join(process.cwd(), 'bots', username, 'grind.log');

initPathfinding();

const sdk = new BotSDK({
    botUsername: username,
    password,
    gatewayUrl: deriveGatewayUrl(server),
    autoLaunchBrowser: false,
    browserLaunchTimeout: 90_000,
    readyTimeout: 45_000,
    connectTimeout: 60_000,
    showChat: false
});

await sdk.connect();
const bot = new BotActions(sdk);
const session = new ActivitySession(sdk, bot, {
    name: 'black-unicorns',
    grindLogPath: GRIND_LOG,
    stallMs: 180_000,
    maxRecoveryTactics: 8
});

installGracefulShutdown({ graceMs: 30_000 });
installWaitForTicksGuard(sdk, session);

let bankedHorns = 0;

function log(msg: string): void {
    session.log('log', msg);
}

function intent(msg: string): void {
    void session.showIntent(msg);
}

function pos() {
    const p = sdk.getState()?.player;
    return {
        x: p?.worldX ?? 0,
        z: p?.worldZ ?? 0,
        level: p?.level ?? 0,
        hp: p?.hp ?? 10,
        maxHp: p?.maxHp ?? 10,
        isDead: p?.isDead ?? false,
        inCombat: p?.combat?.inCombat ?? false,
        targetType: p?.combat?.targetType ?? 'none',
        targetIndex: p?.combat?.targetIndex ?? -1
    };
}

function dist(x: number, z: number): number {
    return Math.hypot(pos().x - x, pos().z - z);
}

function inHunt(x: number, z: number): boolean {
    return x >= HUNT.minX && x <= HUNT.maxX && z >= HUNT.minZ && z <= HUNT.maxZ;
}

function atCamp(): boolean {
    return dist(CAMP.x, CAMP.z) <= 15 && inHunt(pos().x, pos().z);
}

function occupied(): number {
    return sdk.getInventory().filter((i) => (i.count ?? 0) > 0).length;
}

function hornCount(): number {
    return sdk.getInventory().filter((i) => HORN.test(i.name)).reduce((n, i) => n + (i.count ?? 1), 0);
}

function foodCount(): number {
    return sdk.getInventory().filter((i) => foodHeal(i.name) > 0).length;
}

function edible() {
    return sdk.getInventory().filter((i) => foodHeal(i.name) > 0);
}

async function ui(): Promise<void> {
    await closeUi(bot, sdk);
}

async function eatIfNeeded(): Promise<void> {
    const p = pos();
    if (p.hp >= Math.max(40, Math.floor(p.maxHp * 0.5))) return;
    const foods = edible().sort((a, b) => foodHeal(b.name) - foodHeal(a.name));
    const food = foods[0];
    if (!food) return;
    const r = await bot.eatFood(food);
    if (r.success) {
        session.noteProgress('inventory', 'eat');
        log(`Ate ${food.name} +${r.hpGained} HP ${pos().hp}/${pos().maxHp} food=${foodCount()}`);
    }
}

function attackedByPlayer(): boolean {
    return pos().inCombat && pos().targetType === 'player';
}

async function crossDitchSouth(): Promise<boolean> {
    if (!inWilderness(pos().x, pos().z)) return true;
    intent('Crossing south out of wilderness');
    await hopSend(sdk, DITCH_NORTH.x, DITCH_NORTH.z, 8);
    await sdk.sendWalk(DITCH_SOUTH.x, DITCH_SOUTH.z, true);
    await sdk
        .waitForCondition((s) => (s.player?.worldZ ?? 0) < 3520 || s.player?.isDead === true, 12_000)
        .catch(() => {});
    if (inWilderness(pos().x, pos().z)) {
        await sdk.sendWalk(DITCH_SOUTH.x, DITCH_SOUTH.z, true);
        await sdk
            .waitForCondition((s) => (s.player?.worldZ ?? 0) < 3520 || s.player?.isDead === true, 8_000)
            .catch(() => {});
    }
    return !inWilderness(pos().x, pos().z);
}

async function leaveWildy(): Promise<boolean> {
    if (!inWilderness(pos().x, pos().z)) return true;
    if (session.metrics().phase !== 'escape') await session.setPhase('escape');
    await leaveEdgevilleWilderness(sdk);
    if (inWilderness(pos().x, pos().z) && !pos().isDead) await crossDitchSouth();
    return !inWilderness(pos().x, pos().z);
}

async function crossDitchNorth(): Promise<boolean> {
    if (inWilderness(pos().x, pos().z)) return true;
    intent('Crossing the Edgeville wilderness ditch');
    await hopSend(sdk, DITCH_SOUTH.x, DITCH_SOUTH.z, 8);
    await sdk.sendWalk(DITCH_NORTH.x, DITCH_NORTH.z, true);
    await sdk
        .waitForCondition((s) => (s.player?.worldZ ?? 0) >= 3520 || s.player?.isDead === true, 12_000)
        .catch(() => {});
    if (!inWilderness(pos().x, pos().z)) {
        await sdk.sendWalk(DITCH_NORTH.x, DITCH_NORTH.z, true);
        await sdk
            .waitForCondition((s) => (s.player?.worldZ ?? 0) >= 3520 || s.player?.isDead === true, 8_000)
            .catch(() => {});
    }
    return inWilderness(pos().x, pos().z);
}

async function goToEdgeville(): Promise<boolean> {
    await ui();
    if (pos().isDead) {
        await sdk.waitForCondition((s) => s.player?.isDead !== true, 20_000).catch(() => {});
        await sdk.waitForTicks(3);
        log(`Respawned @ ${pos().x},${pos().z}`);
    }
    if (inWilderness(pos().x, pos().z) && !(await leaveWildy())) return false;
    if (dist(EDGEVILLE.x, EDGEVILLE.z) <= 8) return true;
    intent('Walking to Edgeville bank');
    session.setAnchor(EDGEVILLE.x, EDGEVILLE.z);
    if (pos().x >= 3180 && pos().z < 3480) {
        for (const wp of TO_EDGE) {
            if (dist(EDGEVILLE.x, EDGEVILLE.z) <= 8) break;
            await walkNear(bot, sdk, wp.x, wp.z, 6);
        }
    }
    if (dist(EDGEVILLE.x, EDGEVILLE.z) > 8) await walkNear(bot, sdk, EDGEVILLE.x, EDGEVILLE.z, 4);
    return dist(EDGEVILLE.x, EDGEVILLE.z) <= 10;
}

async function bankTrip(): Promise<boolean> {
    if (session.metrics().phase !== 'bank') await session.setPhase('bank');
    if (!(await goToEdgeville())) {
        session.noteFailure('bank_walk', 'Could not reach Edgeville');
        return false;
    }
    if (!(sdk.getState()?.bank?.isOpen || (await bot.openBank()).success)) {
        session.noteFailure('bank_open', 'Edgeville bank open failed');
        return false;
    }
    const before = hornCount();
    for (let i = 0; i < 40; i++) {
        const item = sdk.getInventory().find((it) => (it.count ?? 0) > 0 && !FOOD.test(it.name) && !DLONG.test(it.name));
        if (!item) break;
        if (HORN.test(item.name)) session.recordGain(item.name, item.count ?? 1);
        const r = await bot.depositItem(item, -1);
        if (!r.success && !r.partial) break;
    }
    const deposited = before - hornCount();
    if (deposited > 0) {
        bankedHorns += deposited;
        session.recordTrip(deposited);
        session.noteProgress('bank', 'unicorn horn');
        log(`Banked ${deposited} unicorn horns | trip ${session.metrics().trips} total ${bankedHorns}`);
    }
    if (!sdk.findEquipmentItem(DLONG) && !sdk.findInventoryItem(DLONG)) {
        const weapon = sdk.findBankItem(DLONG);
        if (weapon) await bot.withdrawItem(weapon, 1);
    }
    const haveFood = foodCount();
    if (haveFood < FOOD_WITHDRAW) {
        const sharks = sdk.findBankItem(SHARK);
        if (sharks) await bot.withdrawItem(sharks, Math.min(FOOD_WITHDRAW - haveFood, sharks.count ?? 0));
    }
    session.captureBankStock();
    await bot.closeBank();
    const weapon = sdk.findInventoryItem(DLONG);
    if (weapon && !sdk.findEquipmentItem(DLONG)) await bot.equipItem(weapon);
    return foodCount() >= 1;
}

async function goToCamp(): Promise<boolean> {
    await ui();
    if (attackedByPlayer()) {
        log(`Player attack @ ${pos().x},${pos().z} — leaving`);
        await eatIfNeeded();
        await leaveWildy();
        return false;
    }
    if (atCamp()) return true;
    if (session.metrics().phase !== 'travel') await session.setPhase('travel');
    session.setAnchor(CAMP.x, CAMP.z);
    if (foodCount() < 1 && !(await bankTrip())) return false;
    if (!inWilderness(pos().x, pos().z)) {
        if (dist(EDGEVILLE.x, EDGEVILLE.z) > 20) {
            if (!(await goToEdgeville())) return false;
        }
        if (!(await crossDitchNorth())) {
            session.noteFailure('ditch', 'Could not cross wilderness ditch');
            return false;
        }
    }
    intent(`Wildy sendWalk to black unicorns @ ${CAMP.x},${CAMP.z}`);
    for (const wp of TO_CAMP) {
        if (pos().isDead || attackedByPlayer()) return false;
        if (atCamp()) break;
        await eatIfNeeded();
        await hopSend(sdk, wp.x, wp.z, pos().z >= 3780 ? 3 : 12);
    }
    if (!atCamp() && !pos().isDead) await hopSend(sdk, CAMP.x, CAMP.z, 8);
    if (atCamp()) session.noteProgress('location', 'black unicorns');
    return atCamp();
}

function findUnicorn() {
    const mine = pos().targetIndex;
    return (
        (sdk.getNearbyNpcs() ?? [])
            .filter(
                (n) =>
                    UNICORN.test(n.name) &&
                    (n.hp === null || n.hp > 0) &&
                    n.optionsWithIndex.some((o) => /attack/i.test(o.text)) &&
                    inHunt(n.x, n.z)
            )
            .sort((a, b) => {
                const aMine = a.index === mine ? 0 : 1;
                const bMine = b.index === mine ? 0 : 1;
                if (aMine !== bMine) return aMine - bMine;
                return (a.distance ?? 99) - (b.distance ?? 99);
            })[0] ?? null
    );
}

async function lootHorns(): Promise<void> {
    if (occupied() >= 27) return;
    for (let i = 0; i < 8; i++) {
        if (pos().isDead || attackedByPlayer() || occupied() >= 27) return;
        let ground = sdk.getGroundItems() ?? [];
        if (i === 0) {
            const scanned = await sdk.scanGroundItems(12).catch(() => null);
            if (scanned) ground = scanned;
        }
        const item = ground
            .filter((g) => HORN.test(g.name) && (g.distance ?? 99) <= 12 && (inHunt(g.x, g.z) || (g.distance ?? 99) <= 6))
            .sort((a, b) => (a.distance ?? 99) - (b.distance ?? 99))[0];
        if (!item) return;
        const before = hornCount();
        intent(`Loot unicorn horn @ ${item.x},${item.z}`);
        if ((item.distance ?? 99) > 2) await hopSend(sdk, item.x, item.z, 3);
        await bot.pickupItem(item);
        await sdk
            .waitForCondition((s) => {
                const got = s.inventory.filter((inv) => HORN.test(inv.name)).reduce((n, inv) => n + (inv.count ?? 1), 0);
                return got > before || s.player?.isDead === true;
            }, 6_000)
            .catch(() => {});
        const after = hornCount();
        if (after > before) {
            session.noteProgress('inventory', 'unicorn horn');
            log(`Horn ${bankedHorns + after} | inv ${after} @ ${pos().x},${pos().z}`);
        } else return;
    }
}

async function fightUnicorn(): Promise<void> {
    if (attackedByPlayer()) return;
    const target = findUnicorn();
    if (!target) {
        if (dist(CAMP.x, CAMP.z) > 8) await hopSend(sdk, CAMP.x, CAMP.z, 6);
        else await sdk.waitForTicks(2);
        return;
    }
    intent(`Attack black unicorn @ ${target.x},${target.z}`);
    session.setAnchor(target.x, target.z);
    const opt = target.optionsWithIndex.find((o) => /attack/i.test(o.text));
    if (!opt) return;
    for (let hop = 0; hop < 10 && !pos().isDead && !attackedByPlayer(); hop++) {
        const live = sdk.getNearbyNpcs().find((n) => n.index === target.index);
        if (!live || (live.hp !== null && live.hp <= 0)) break;
        if (!inHunt(live.x, live.z)) break;
        if ((live.distance ?? 99) > 2) {
            await hopSend(sdk, live.x, live.z, 3);
            continue;
        }
        await sdk.sendInteractNpc(live.index, opt.opIndex, { route: false });
        await sdk
            .waitForCondition(
                (s) =>
                    s.player?.isDead === true ||
                    (s.player?.combat?.inCombat === true && s.player.combat.targetIndex === target.index) ||
                    !s.nearbyNpcs.some((n) => n.index === target.index && (n.hp === null || n.hp > 0)),
                6_000
            )
            .catch(() => {});
        break;
    }
    const started = Date.now();
    while (pos().inCombat && pos().targetIndex === target.index && !pos().isDead && Date.now() - started < 40_000) {
        await eatIfNeeded();
        if (attackedByPlayer()) return;
        const live = sdk.getNearbyNpcs().find((n) => n.index === target.index);
        if (live && inHunt(live.x, live.z) && (live.distance ?? 99) > 4) {
            await hopSend(sdk, live.x, live.z, 3);
            await sdk.sendInteractNpc(live.index, opt.opIndex, { route: false });
        }
        await sdk.waitForTicks(1);
    }
    await lootHorns();
}

session.registerRecovery([
    {
        name: 'leave_player',
        run: async () => {
            if (!attackedByPlayer() && !inWilderness(pos().x, pos().z)) return false;
            if (attackedByPlayer()) return leaveWildy();
            return false;
        }
    },
    {
        name: 'bank_if_full',
        run: async () => {
            if (occupied() < 26 && foodCount() >= 1 && !pos().isDead) return false;
            return bankTrip();
        }
    },
    {
        name: 'walk_camp',
        run: async () => {
            if (occupied() >= 26 || foodCount() < 1) return false;
            return goToCamp();
        }
    }
]);

try {
    await bot.skipTutorial();
    await ui();
    log(
        `Black unicorn start HP ${pos().hp}/${pos().maxHp} @ ${pos().x},${pos().z} ` +
            `weapon=${sdk.findEquipmentItem(DLONG)?.name ?? sdk.findInventoryItem(DLONG)?.name ?? 'none'} food=${foodCount()}`
    );
    while (!session.isStopped()) {
        if (session.needsRecovery()) {
            if ((await session.recover()) === 'exhausted') break;
            continue;
        }
        session.maybeHeartbeat();
        if (pos().isDead) {
            await sdk.waitForTicks(5);
            continue;
        }
        if (attackedByPlayer()) {
            log(`Player attack @ ${pos().x},${pos().z}`);
            await eatIfNeeded();
            await leaveWildy();
            continue;
        }
        if (occupied() >= 26 || foodCount() < 1) {
            if (!(await bankTrip())) {
                session.noteFailure('bank', 'bank trip failed');
                await sdk.waitForTicks(5);
            }
            continue;
        }
        await session.setPhase('hunt');
        if (!(await goToCamp())) {
            await sdk.waitForTicks(3);
            continue;
        }
        await eatIfNeeded();
        await lootHorns();
        await fightUnicorn();
    }
} catch (err) {
    session.stop('script_error', err instanceof Error ? err.message : String(err));
    console.error('Script error:', err);
    throw err;
} finally {
    await session.finalizeStop();
    await sdk.disconnect();
}
