/**
 * Craft air runes at the Falador east bank.
 *
 * One lap is the route from `rc-route.ts`, timed by `rc-trip.ts`: stand on
 * the booth tile with 27 unnoted rune essence and an air talisman, run to
 * the ruins, craft, portal out, deposit, withdraw the next load. A full
 * energy bar runs every pair of tiles on this route.
 *
 *   bun bots/quests/air-rune-craft.ts jacklove1
 */
import { existsSync, readFileSync } from 'fs';
import { dirname, join } from 'path';
import { ActivitySession, BotSDK, deriveGatewayUrl, inEssenceMine, inWilderness } from '../../sdk/index';
import { BotActions } from '../../sdk/actions';
import { closeUi, installWaitForTicksGuard, walkSendHops } from './movement';
import { inAirAltar, leaveMine } from './air-runes-shared';
import { airCycle } from './rc-trip';
import {
    AIR_ALTAR_ID,
    AIR_PORTAL,
    AIR_PORTAL_ID,
    AIR_RUINS_ID,
    planAirRoute,
    type AltarRoute,
    type Tile
} from './rc-route';
import {
    BANDIT_CAMP,
    EAST_OF_BANDITS,
    LAVA_MAZE_EAST,
    southOfLavaMaze,
    WILDY_TO_ROCKS
} from './rune-rocks-route';
import { DITCH_NORTH, DITCH_SOUTH } from './tiles';
import { installGracefulShutdown } from '../../sdk/runner';

const ESSENCE = /^rune essence$/i;
const TALISMAN = /^air talisman$/i;
const AIR = /^air rune$/i;
const LOAD = 27;
const RUINS_ANCHOR = { x: 2984, z: 3291 };
const ALTAR_ANCHOR = { x: 2843, z: 4833 };

const argv = process.argv.slice(2);
const botArg = argv.find((a) => !a.startsWith('-'));

function loadBotEnv(): void {
    const envPath = botArg
        ? join(process.cwd(), 'bots', botArg, 'bot.env')
        : join(dirname(import.meta.path), 'bot.env');
    if (!existsSync(envPath)) {
        throw new Error(`bot.env not found at ${envPath}. Usage: bun bots/quests/air-rune-craft.ts {botname}`);
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
const route: AltarRoute = planAirRoute();
const cycle = airCycle({
    outboundSteps: route.outboundSteps,
    toAltarSteps: route.toAltarSteps,
    toPortalSteps: route.toPortalSteps,
    returnSteps: route.returnSteps
});

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
    name: 'air-craft',
    grindLogPath: join(process.cwd(), 'bots', username, 'grind.log'),
    stallMs: 360_000
});

installGracefulShutdown({ graceMs: 30_000 });
installWaitForTicksGuard(sdk, session);

function log(msg: string): void {
    session.log('log', msg);
}

function pos(): { x: number; z: number; dead: boolean } {
    const p = sdk.getState()?.player;
    return { x: p?.worldX ?? 0, z: p?.worldZ ?? 0, dead: p?.isDead ?? false };
}

function dist(tile: Tile): number {
    const p = pos();
    return Math.hypot(p.x - tile.x, p.z - tile.z);
}

function count(pattern: RegExp): number {
    return sdk
        .getInventory()
        .filter((i) => pattern.test(i.name))
        .reduce((n, i) => n + (i.count ?? 1), 0);
}

function unnotedEssence(): number {
    return sdk.getInventory().filter((i) => ESSENCE.test(i.name) && (i.count ?? 0) === 1).length;
}

function rcLevel(): number {
    return sdk.getSkill('Runecraft')?.baseLevel ?? 1;
}

function isUnnotedEssence(item: { name: string; count?: number }): boolean {
    return ESSENCE.test(item.name) && (item.count ?? 0) === 1;
}

/** Sharks, air runes, noted essence, gear. The kept talisman and unnoted essence stay. */
function foreignItems() {
    const kept = sdk.getInventory().find((i) => TALISMAN.test(i.name) && (i.count ?? 0) > 0);
    return sdk.getInventory().filter((i) => {
        if ((i.count ?? 0) <= 0) return false;
        if (i.slot === kept?.slot) return false;
        if (isUnnotedEssence(i)) return false;
        return true;
    });
}

function foreignSummary(): string {
    const counts = new Map<string, number>();
    for (const item of foreignItems()) {
        counts.set(item.name, (counts.get(item.name) ?? 0) + (item.count ?? 1));
    }
    return [...counts.entries()].map(([name, n]) => `${name} x${n}`).join(', ');
}

/** Talisman plus unnoted essence, and nothing else. */
function bagReady(): boolean {
    return foreignItems().length === 0 && count(TALISMAN) >= 1 && unnotedEssence() >= 1 && count(AIR) === 0;
}

/** A full craft load. The booth stand tile is not required — opening the bank steps off it. */
function craftLoad(): boolean {
    return foreignItems().length === 0 && count(TALISMAN) >= 1 && unnotedEssence() >= LOAD && count(AIR) === 0;
}

function loaded(): boolean {
    return bagReady() && dist(route.stand) <= 1;
}

function closer(tile: Tile, before: { x: number; z: number }, after: { x: number; z: number }): boolean {
    const from = Math.hypot(before.x - tile.x, before.z - tile.z);
    const to = Math.hypot(after.x - tile.x, after.z - tile.z);
    return to < from - 0.5;
}

/**
 * 3-tile sendWalk steps. A single chord from 3102,3610 to the ditch never
 * leaves the tile, and noting that chord as location progress keeps the
 * stall timer alive. Only a step that gets closer is progress.
 */
async function hop(tile: Tile): Promise<void> {
    session.setAnchor(tile.x, tile.z);
    let stuck = 0;
    for (let i = 0; i < 48 && dist(tile) > 6 && !pos().dead; i++) {
        const d = dist(tile);
        const step = Math.min(3, d);
        const tx = Math.round(pos().x + ((tile.x - pos().x) / d) * step);
        const tz = Math.round(pos().z + ((tile.z - pos().z) / d) * step);
        const before = pos();
        await sdk.sendWalk(tx, tz, true);
        await sdk
            .waitForCondition(
                (s) =>
                    s.player?.isDead === true ||
                    Math.hypot((s.player?.worldX ?? 0) - tx, (s.player?.worldZ ?? 0) - tz) <= 2 ||
                    Math.hypot((s.player?.worldX ?? 0) - tile.x, (s.player?.worldZ ?? 0) - tile.z) <= 6,
                6_000
            )
            .catch(() => {});
        const after = pos();
        if (closer(tile, before, after)) {
            stuck = 0;
            session.noteProgress('location', `${after.x},${after.z}`);
            continue;
        }
        stuck++;
        await sdk.sendWalk(before.x + (stuck % 2 === 0 ? 2 : -2), before.z - 1, true);
        await sdk.waitForTicks(2);
        if (stuck >= 4) {
            session.log('warn', `Wildy hop stuck @ ${pos().x},${pos().z} toward ${tile.x},${tile.z}`);
            break;
        }
    }
}

async function leaveWilderness(): Promise<void> {
    const p = pos();
    if (!inWilderness(p.x, p.z) || p.dead) return;
    // Repeating setPhase refreshes the stall timer, so a standstill never recovers.
    if (session.metrics().phase !== 'wildy') await session.setPhase('wildy');
    if (southOfLavaMaze(p.x, p.z)) await hop(LAVA_MAZE_EAST);
    const here = pos();
    if (here.x >= BANDIT_CAMP.xMin && here.x <= BANDIT_CAMP.xMax && here.z >= BANDIT_CAMP.zMin && here.z <= BANDIT_CAMP.zMax) {
        await hop(EAST_OF_BANDITS);
    }
    for (const tile of [...WILDY_TO_ROCKS].reverse()) {
        if (pos().dead || !inWilderness(pos().x, pos().z)) break;
        if (pos().z <= tile.z + 4 && dist(tile) > 40) continue;
        await hop(tile);
    }
    if (inWilderness(pos().x, pos().z) && !pos().dead) {
        await hop(DITCH_NORTH);
        await sdk.sendWalk(DITCH_SOUTH.x, DITCH_SOUTH.z, true);
        await sdk
            .waitForCondition((s) => (s.player?.worldZ ?? 0) < 3520 || s.player?.isDead === true, 12_000)
            .catch(() => {});
    }
    if (inWilderness(pos().x, pos().z) && !pos().dead && !closer(DITCH_NORTH, p, pos())) {
        session.noteFailure('wildy', `Still in wilderness @ ${pos().x},${pos().z}`);
    }
}

async function walkExact(tile: Tile): Promise<boolean> {
    session.setAnchor(tile.x, tile.z);
    if (dist(tile) === 0) return true;
    // A 1-tile step through a crowded booth is a sendWalk. walkTo pathfinds around the pile and hangs.
    if (dist(tile) > 4) {
        await bot.walkTo(tile.x, tile.z, 0);
        if (dist(tile) === 0) return true;
        if (dist(tile) > 4) return false;
    }
    await sdk.sendWalk(tile.x, tile.z, true);
    await sdk
        .waitForCondition(
            (s) => Math.hypot((s.player?.worldX ?? 0) - tile.x, (s.player?.worldZ ?? 0) - tile.z) === 0,
            8_000
        )
        .catch(() => {});
    return dist(tile) === 0;
}

/**
 * Deposit every item except one air talisman. An extra talisman is deposited
 * one at a time: amount -1 would bank the whole talisman stack.
 */
async function emptyInventory(): Promise<boolean> {
    const summary = foreignSummary();
    if (summary) log(`Emptying inventory: ${summary}`);
    for (let pass = 0; pass < 40 && foreignItems().length > 0; pass++) {
        const junk = foreignItems()[0];
        if (!junk) break;
        const amount = TALISMAN.test(junk.name) ? 1 : -1;
        const before = foreignItems().length;
        const deposited = await bot.depositItem(junk, amount);
        if (foreignItems().length < before) continue;
        session.noteFailure('bank', `Could not deposit ${junk.name}: ${deposited.message}`);
        return false;
    }
    const left = foreignSummary();
    if (left) {
        session.noteFailure('bank', `Inventory not empty: ${left}`);
        return false;
    }
    return true;
}

/** East booth, then the west bank. Staying on a closed booth is what burns the restart cap. */
async function openFaladorBank(): Promise<boolean> {
    if (sdk.getState()?.bank?.isOpen) return true;
    if ((await bot.openBank()).success) return true;
    const here = pos();
    if (here.x === 0 && here.z === 0) return false;
    session.log('warn', `Falador east bank stayed closed @ ${here.x},${here.z} — hopping to the west bank`);
    await walkSendHops(
        sdk,
        [
            { x: 3012, z: 3364 },
            { x: 2988, z: 3368 },
            { x: 2964, z: 3372 },
            { x: 2946, z: 3368 }
        ],
        { x: 2946, z: 3368 },
        4
    );
    return sdk.getState()?.bank?.isOpen === true || (await bot.openBank()).success;
}

/** Open, empty the bag, withdraw 27 essence and the talisman, close. */
async function bankLap(): Promise<boolean> {
    await session.setPhase('bank');
    const here = pos();
    if (here.x === 0 && here.z === 0) {
        session.log('warn', 'No live position — waiting for the client before banking');
        await sdk.waitForTicks(5).catch(() => {});
        return false;
    }
    await closeUi(bot, sdk);
    const booth = sdk.findNearbyLoc(/bank booth/i, { reachable: true });
    const besideBooth = booth != null && (booth.distance ?? 99) <= 4;
    if (!besideBooth && !(await walkExact(route.stand))) {
        session.log('warn', `Could not reach Falador east @ ${pos().x},${pos().z} — trying the west bank`);
        if (!(await openFaladorBank())) {
            session.noteFailure('bank', `Could not reach Falador east @ ${pos().x},${pos().z}`);
            return false;
        }
    }
    if (!(await openFaladorBank())) {
        session.noteFailure('bank', 'Could not open Falador east or west bank');
        return false;
    }
    const air = count(AIR);
    if (air > 0) {
        const deposited = await bot.depositItem(AIR, -1);
        if (deposited.success && count(AIR) === 0) {
            session.recordTrip(air);
            log(`Air ${air} runes | trip ${session.metrics().trips} | rc ${rcLevel()}`);
        }
    }
    if (!(await emptyInventory())) return false;
    if (count(TALISMAN) < 1) {
        const withdrawn = await bot.withdrawItem(TALISMAN, 1);
        if (count(TALISMAN) < 1) {
            if (!sdk.findBankItem(TALISMAN)) {
                session.stop('no_talisman', 'No air talisman in inventory or Falador east bank');
            } else {
                session.noteFailure('bank', `Air talisman withdraw failed: ${withdrawn.message}`);
            }
            return false;
        }
    }
    const need = LOAD - unnotedEssence();
    if (need > 0) {
        // All fills the free slots (27 once the talisman is in the bag). A
        // typed 27 opens the X dialog and that click was not landing.
        const withdrawn = await bot.withdrawItem(ESSENCE, -1);
        if (unnotedEssence() < 1) {
            if (!sdk.findBankItem(ESSENCE)) {
                session.stop('out_of_essence', 'No unnoted rune essence left in the Falador east bank');
            } else {
                session.noteFailure('bank', `Essence withdraw failed: ${withdrawn.message}`);
            }
            return false;
        }
    }
    if (!bagReady()) {
        session.noteFailure('bank', `Inventory not a craft load: ${foreignSummary() || 'missing essence or talisman'}`);
        return false;
    }
    session.captureBankStock();
    const load = unnotedEssence();
    await bot.closeBank();
    session.noteProgress('bank', `essence ${load}`);
    log(`Load ${load} essence talisman ${count(TALISMAN)} @ ${route.stand.x},${route.stand.z}`);
    return true;
}

async function craftHere(): Promise<boolean> {
    await session.setPhase('craft');
    const before = unnotedEssence();
    const xp = sdk.getSkill('Runecraft')?.experience ?? 0;
    await sdk.scanNearbyLocs(8).catch(() => {});
    const altar = sdk.findNearbyLoc(/^altar$/i);
    if (altar) await bot.interactLoc(altar, /craft-rune/i);
    else await sdk.sendInteractLoc(ALTAR_ANCHOR.x, ALTAR_ANCHOR.z, AIR_ALTAR_ID, 1);
    const bound = await sdk
        .waitForCondition((s) => {
            const ess = s.inventory.filter((i) => ESSENCE.test(i.name) && (i.count ?? 0) === 1).length;
            const gained = (s.skills.find((sk) => /runecraft/i.test(sk.name))?.experience ?? 0) > xp;
            const said = s.gameMessages.some((m) => /bind the temple/i.test(m.text));
            return ess < before || gained || said;
        }, 8_000)
        .catch(() => false);
    if (!bound) {
        session.noteFailure('craft', 'Altar did not bind essence');
        return false;
    }
    // p_delay(3) resumes four ticks after the op. An earlier portal click is dropped.
    await sdk.waitForTicks(4);
    return unnotedEssence() < before;
}

async function enterAndCraft(): Promise<boolean> {
    await session.setPhase('ruins');
    if (!inAirAltar(pos().x, pos().z)) {
        if (!(await walkExact(route.approach))) {
            session.noteFailure('ruins', `Approach failed @ ${pos().x},${pos().z}`);
            return false;
        }
        const tali = sdk.findInventoryItem(TALISMAN);
        if (!tali) {
            session.stop('no_talisman', 'Air talisman missing before the ruins');
            return false;
        }
        await sdk.sendUseItemOnLoc(tali.slot, RUINS_ANCHOR.x, RUINS_ANCHOR.z, AIR_RUINS_ID);
        const entered = await sdk
            .waitForCondition((s) => inAirAltar(s.player?.worldX ?? 0, s.player?.worldZ ?? 0), 12_000)
            .catch(() => false);
        if (!entered) {
            session.noteFailure('ruins', `Talisman did not enter @ ${pos().x},${pos().z}`);
            return false;
        }
    }
    if (!(await walkExact(route.altarStand))) {
        session.noteFailure('altar', `Altar stand failed @ ${pos().x},${pos().z}`);
        return false;
    }
    return craftHere();
}

async function leaveAltar(): Promise<boolean> {
    if (!inAirAltar(pos().x, pos().z)) return true;
    await session.setPhase('portal');
    if (!(await walkExact(route.portalStand))) return false;
    await sdk.scanNearbyLocs(6).catch(() => {});
    const portal = sdk.findNearbyLoc(/^portal$/i);
    if (portal) await bot.interactLoc(portal, /use/i);
    else await sdk.sendInteractLoc(AIR_PORTAL.x, AIR_PORTAL.z, AIR_PORTAL_ID, 1);
    const left = await sdk
        .waitForCondition((s) => !inAirAltar(s.player?.worldX ?? 0, s.player?.worldZ ?? 0), 10_000)
        .catch(() => false);
    return left;
}

try {
    log(
        `Air cycle ${cycle.ticks} ticks (${(cycle.ms / 1000).toFixed(1)}s) ` +
            `stand ${route.stand.x},${route.stand.z} approach ${route.approach.x},${route.approach.z} ` +
            `${Math.round(cycle.essencePerHour)} essence/h`
    );
    for (;;) {
        if (session.isStopped()) break;
        if (session.needsRecovery()) {
            await session.recover();
            if (session.isStopped()) break;
            continue;
        }
        if (pos().dead) {
            await sdk.waitForCondition((s) => s.player?.isDead !== true, 20_000).catch(() => {});
            continue;
        }
        await closeUi(bot, sdk);
        if (inEssenceMine(pos().x, pos().z)) {
            await leaveMine(bot, sdk, log);
            continue;
        }
        if (inWilderness(pos().x, pos().z)) {
            await leaveWilderness();
            continue;
        }
        if (inAirAltar(pos().x, pos().z)) {
            if (unnotedEssence() > 0) await craftHere();
            await leaveAltar();
            continue;
        }
        // A full load beside the booth is ready. Demanding stand 3012,3355
        // reopens the bank forever when the pile is on 3011,3355.
        if (!craftLoad() || dist(route.stand) > 12) {
            await bankLap();
            if (session.isStopped()) break;
            if (!craftLoad() && !loaded()) continue;
        }
        const started = Date.now();
        if (!(await enterAndCraft())) continue;
        if (!(await leaveAltar())) continue;
        await bankLap();
        if (session.isStopped()) break;
        if (!craftLoad() && !loaded()) continue;
        const sec = ((Date.now() - started) / 1000).toFixed(1);
        log(`Lap ${sec}s planned ${(cycle.ms / 1000).toFixed(1)}s`);
    }
} catch (err) {
    session.stopRestartable('script_error', err instanceof Error ? err.message : String(err));
} finally {
    await session.finalizeStop();
    await sdk.disconnect();
}
