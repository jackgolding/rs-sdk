/**
 * Nature-rune essence running for jackthief (99 RC method): un-note at
 * Jiminua's Jungle Store, walk to the mysterious ruins, trade unnoted
 * essence (25 — jackthief keeps talisman + nats + coins). Only jackthief
 * has a nature talisman and enters the altar.
 *
 *   bun bots/quests/nature-essence-run.ts Jackpoo4
 *   bun bots/quests/nature-essence-run.ts jackthief --craft
 */
import { ActivitySession, BotSDK, deriveGatewayUrl, inEssenceMine, inMiningGuild } from '../../sdk/index';
import { BotActions } from '../../sdk/actions';
import { initPathfinding } from '../../sdk/pathfinding';
import { existsSync, readFileSync } from 'fs';
import { dirname, join } from 'path';
import { leaveMine } from './air-runes-shared';
import { installGracefulShutdown } from '../../sdk/runner';
import {
    closeUi as closeUiShared,
    crossGangplank,
    distTo as distToShared,
    leaveAdjacentClosedDoor,
    walkNear as walkNearShared
} from './movement';
import {
    ARDOUGNE_BANK,
    BRIMHAVEN_CUSTOMS,
    BRIMHAVEN_TO_JIMINUA,
    CAPTAIN_BARNABY,
    CATHERBY_BANK,
    closestFleetBank,
    FALADOR_EAST_BANK,
    GUILD_LADDER_DOWN,
    JIMINUA_SHOP,
    JIMINUA_TO_NATURE,
    MUSA_TO_JIMINUA,
    NATURE_ALTAR,
    NATURE_CRAFTER_STAND,
    NATURE_RUINS,
    NATURE_TO_JIMINUA,
    PORT_SARIM_DOCK,
    YANILLE_TO_BARNABY,
    SEERS_BANK
} from './tiles';

/** Jackthief inventory: talisman + nats + coins = 25 free slots. */
const LOAD = 25;
const BUY_STEP = 10;
const BOAT_GP = 30;
const ESSENCE = /^(pure essence|rune essence)$/i;
const PURE = /^pure essence$/i;
const TALISMAN = /^nature talisman$/i;
const NATS = /^nature rune$/i;
const COINS = /^coins$/i;
const SHOP_NPC = /^jiminua$/i;
const CRAFTER = /jackthief/i;
const RUNNERS = /jackpoo|jacklove/i;
/** Coin trades: only this essence squad, not Catherby shark fishers. */
const GP_MATES = /^(jackthief|jackpoo[1245]|jacklove[1235])$/i;
/** Keep one boat fare; dump the rest onto jackthief / needy runners. */
const GP_KEEP = 1000;
const GP_GIFT = 2000;
const KARAMJA_MEN = { x: 2889, z: 3173 };

const argv = process.argv.slice(2);
const botArg = argv.find((a) => !a.startsWith('-'));
const isCrafter = argv.includes('--craft') || /^jackthief$/i.test(botArg ?? '');

function loadBotEnv(): void {
    const envPath = botArg
        ? join(process.cwd(), 'bots', botArg, 'bot.env')
        : join(dirname(import.meta.path), 'bot.env');
    if (!existsSync(envPath)) {
        throw new Error(`bot.env not found at ${envPath}. Usage: bun bots/quests/nature-essence-run.ts {botname}`);
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

console.log('Warming pathfinder...');
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

console.log('Opening/attaching the game client...');
await sdk.connect();
const bot = new BotActions(sdk);
const session = new ActivitySession(sdk, bot, {
    name: isCrafter ? 'nature-craft' : 'nature-run',
    grindLogPath: GRIND_LOG,
    stallMs: 240_000,
    maxRecoveryTactics: 8
});

installGracefulShutdown();

let notedId: number | null = null;
let crafted = 0;
let handed = 0;
let packed = false;

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
        isDead: p?.isDead ?? false
    };
}

function distTo(x: number, z: number): number {
    return distToShared(sdk, x, z);
}

function occupiedSlots(): number {
    return sdk.getInventory().filter((i) => (i.count ?? 0) > 0).length;
}

function emptySlots(): number {
    return 28 - occupiedSlots();
}

function count(pattern: RegExp): number {
    return sdk.getInventory().filter((i) => pattern.test(i.name)).reduce((n, i) => n + (i.count ?? 1), 0);
}

function learnNotedId(): void {
    const stacked = sdk.getInventory().find((i) => ESSENCE.test(i.name) && (i.count ?? 0) > 1);
    if (stacked) notedId = stacked.id;
}

function isNoted(item: { id: number; name: string; count: number }): boolean {
    if (!ESSENCE.test(item.name)) return false;
    if (notedId != null) return item.id === notedId;
    return (item.count ?? 0) > 1;
}

function notedCount(): number {
    learnNotedId();
    return sdk.getInventory().filter(isNoted).reduce((n, i) => n + (i.count ?? 0), 0);
}

function unnotedCount(): number {
    learnNotedId();
    return sdk.getInventory().filter((i) => ESSENCE.test(i.name) && !isNoted(i)).length;
}

function inNatureAltar(x = pos().x, z = pos().z): boolean {
    return x >= 2360 && x <= 2440 && z >= 4790 && z <= 4880;
}

/** Island including Tai Bwo Wannai / nature ruins (south of Brimhaven). */
function onKaramja(x = pos().x, z = pos().z): boolean {
    return x > 2680 && x < 3010 && z > 2880 && z < 3270 && z < 6400;
}

function onMusa(): boolean {
    return onKaramja() && pos().x >= 2815 && pos().z >= 3125;
}

function inKandarin(x = pos().x, z = pos().z): boolean {
    if (onKaramja(x, z) || inNatureAltar(x, z)) return false;
    return x > 2400 && x < 2944 && z > 3070 && z < 3600 && z < 6400;
}

async function closeUi(): Promise<void> {
    await closeUiShared(bot, sdk);
}

async function walkNear(x: number, z: number, tolerance = 4): Promise<boolean> {
    return walkNearShared(bot, sdk, x, z, tolerance);
}

async function clickTile(x: number, z: number, tolerance = 3): Promise<boolean> {
    if (distTo(x, z) <= tolerance) return true;
    const deadline = Date.now() + 16_000;
    let stuck = 0;
    while (distTo(x, z) > tolerance && Date.now() < deadline && !session.isStopped()) {
        const before = pos();
        await sdk.sendWalk(x, z, true);
        await sdk
            .waitForCondition(
                (s) => Math.hypot((s.player?.worldX ?? 0) - x, (s.player?.worldZ ?? 0) - z) <= tolerance,
                3_000
            )
            .catch(() => {});
        if (distTo(x, z) <= tolerance) return true;
        if (Math.hypot(pos().x - before.x, pos().z - before.z) < 1) stuck++;
        else stuck = 0;
        if (stuck >= 4) break;
    }
    return distTo(x, z) <= tolerance + 2;
}

async function clickRoute(route: { x: number; z: number }[], dest: { x: number; z: number }): Promise<boolean> {
    for (const wp of route) {
        if (distTo(dest.x, dest.z) <= 4) return true;
        const remaining = distTo(dest.x, dest.z);
        const via = Math.hypot(wp.x - dest.x, wp.z - dest.z);
        if (via > remaining + 4) continue;
        if (distTo(wp.x, wp.z) <= 3) continue;
        intent(`Click ${wp.x},${wp.z}`);
        if (!(await clickTile(wp.x, wp.z, 3))) {
            session.log('warn', `slow hop ${wp.x},${wp.z} @ ${pos().x},${pos().z}`);
            await clickTile(wp.x, wp.z, 4);
        }
        if (distTo(wp.x, wp.z) <= 6) session.noteProgress('location', `${wp.x},${wp.z}`);
    }
    if (distTo(dest.x, dest.z) > 4) await clickTile(dest.x, dest.z, 3);
    return distTo(dest.x, dest.z) <= 10;
}

function shopEssence() {
    return sdk.getState()?.shop?.shopItems?.find((i) => ESSENCE.test(i.name) && i.count > 0) ?? null;
}

async function leaveGuild(): Promise<boolean> {
    if (!inMiningGuild(pos().x, pos().z)) return true;
    await session.setPhase('leave_guild');
    intent('Climbing out of the mining guild');
    for (let i = 0; i < 8 && inMiningGuild(pos().x, pos().z) && !session.isStopped(); i++) {
        await closeUi();
        if (distTo(GUILD_LADDER_DOWN.x, GUILD_LADDER_DOWN.z) > 4) {
            await walkNear(GUILD_LADDER_DOWN.x, GUILD_LADDER_DOWN.z, 2);
        }
        await sdk.scanNearbyLocs(8).catch(() => {});
        const ladder = (sdk.getNearbyLocs() ?? [])
            .filter((l) => /ladder/i.test(l.name) && l.optionsWithIndex.some((o) => /climb-up|climb.up/i.test(o.text)))
            .sort((a, b) => (a.distance ?? 99) - (b.distance ?? 99))[0];
        if (!ladder) {
            await walkNear(GUILD_LADDER_DOWN.x, GUILD_LADDER_DOWN.z, 1);
            continue;
        }
        await bot.interactLoc(ladder, /climb-up|climb.up/i);
        await sdk.waitForCondition((s) => !inMiningGuild(s.player?.worldX ?? 0, s.player?.worldZ ?? 0), 8_000).catch(() => {});
    }
    return !inMiningGuild(pos().x, pos().z);
}

async function leaveInstances(): Promise<void> {
    await closeUi();
    if (inEssenceMine(pos().x, pos().z)) await leaveMine(bot, sdk, log);
    if (inMiningGuild(pos().x, pos().z)) await leaveGuild();
    if (inNatureAltar() && !isCrafter) await leaveAltar();
}

function inMusaHouses(x = pos().x, z = pos().z): boolean {
    return x >= 2910 && x <= 2942 && z >= 3198 && z <= 3228;
}

async function leaveMusaHouses(): Promise<void> {
    if (!inMusaHouses()) return;
    intent('Leaving Musa houses');
    await closeUi();
    await sdk.sendWalk(2912, 3160, true);
    await sdk.waitForTicks(4).catch(() => {});
    if (inMusaHouses()) {
        await leaveAdjacentClosedDoor(sdk);
        await clickTile(2912, 3160, 4);
    }
}

function nearbyFleet() {
    return sdk
        .getNearbyPlayers()
        .filter((p) => GP_MATES.test(p.name) && p.name.toLowerCase() !== username.toLowerCase())
        .sort((a, b) => (a.distance ?? 99) - (b.distance ?? 99));
}

function gpGiftAmount(): number {
    return Math.min(GP_GIFT, Math.max(0, count(COINS) - GP_KEEP));
}

function inCatherby(x = pos().x, z = pos().z): boolean {
    return x >= 2788 && x <= 2875 && z >= 3415 && z <= 3498;
}

async function pickpocketHere(): Promise<boolean> {
    await closeUi();
    const npc =
        sdk.findNearbyNpc(/^(man|woman|farmer)$/i, { reachable: true }) ??
        sdk.findNearbyNpc(/^(man|woman|farmer)$/i);
    if (!npc) return false;
    const before = count(COINS);
    intent(`Pickpocketing ${npc.name} for boat fare (${before} gp)`);
    const result = await bot.pickpocketNpc(npc);
    if (result.reason === 'stunned') await sdk.waitForTicks(6).catch(() => {});
    if (count(COINS) > before) {
        session.noteProgress('inventory', `gp ${count(COINS)}`);
        log(`GP ${count(COINS)} @ ${pos().x},${pos().z}`);
        return true;
    }
    return false;
}

async function askFleetGp(min: number): Promise<boolean> {
    const mates = nearbyFleet().filter((p) => (p.distance ?? 99) <= 12);
    if (!mates.length) return false;
    const need = min - count(COINS);
    if (need <= 0) return true;
    for (const mate of mates) {
        intent(`Asking ${mate.name} for ${need} gp`);
        const r = await bot.trade(mate.name, {
            give: [],
            want: [{ item: COINS, amount: need }],
            retryOnBusy: true,
            requestTimeout: 8_000,
            timeout: 15_000
        });
        log(`GP from ${mate.name}: ${r.success ? 'ok' : r.message} gp=${count(COINS)}`);
        if (count(COINS) >= min) return true;
    }
    return count(COINS) >= min;
}

async function askCrafterGp(min: number): Promise<boolean> {
    if (count(COINS) >= min) return true;
    if (isCrafter) return false;
    await session.setPhase('mule_gp');
    if (!(await goRuins())) return count(COINS) >= min;
    if (!(await waitForCrafter(90_000))) {
        log(`jackthief not at ruins for gp @ ${pos().x},${pos().z}`);
        return false;
    }
    const need = Math.max(min - count(COINS), GP_GIFT);
    intent(`Asking jackthief for ${need} gp`);
    const r = await bot.trade(CRAFTER, {
        give: [],
        want: [{ item: COINS, amount: need }],
        retryOnBusy: true,
        requestTimeout: 45_000,
        timeout: 60_000
    });
    log(`GP from jackthief: ${r.success ? 'ok' : r.message} gp=${count(COINS)}`);
    return count(COINS) >= min;
}

/** Boat / shop gold comes from jackthief. Pickpocket only if he is missing. */
async function ensureGp(min: number): Promise<boolean> {
    if (count(COINS) >= min) return true;
    if (await askCrafterGp(min)) return true;
    await session.setPhase('boat_gp');
    if (inCatherby() && distTo(2816, 3442) > 8) await clickTile(2816, 3442, 4);
    const deadline = Date.now() + 60_000;
    while (count(COINS) < min && Date.now() < deadline && !session.isStopped()) {
        if (!(await pickpocketHere())) await sdk.waitForTicks(3).catch(() => {});
    }
    log(`Boat gp ${count(COINS)}/${min} @ ${pos().x},${pos().z}`);
    return count(COINS) >= min;
}

async function seedShopGp(min: number): Promise<boolean> {
    if (count(COINS) >= min) return true;
    return askCrafterGp(min);
}

async function clickBoatDialog(): Promise<void> {
    let closed = 0;
    for (let i = 0; i < 20; i++) {
        const dialog = sdk.getDialog();
        if (!dialog?.isOpen) {
            closed++;
            if (closed >= 4) return;
            await new Promise((r) => setTimeout(r, 250));
            continue;
        }
        closed = 0;
        if (dialog.isWaiting) {
            await sdk.waitForTicks(1).catch(() => {});
            continue;
        }
        const opts = dialog.options ?? [];
        const pick =
            opts.find((o) => /search away|nothing to hide/i.test(o.text)) ||
            opts.find((o) => /can i journey|journey on this ship/i.test(o.text)) ||
            opts.find((o) => /yes please/i.test(o.text)) ||
            opts.find((o) => /pay (the )?(fare|30)|30 coins/i.test(o.text)) ||
            opts.find((o) => /ardougne/i.test(o.text) && !/unusual|customs then/i.test(o.text)) ||
            opts.find((o) => /brimhaven|karamja/i.test(o.text) && !/crandor/i.test(o.text)) ||
            opts.find((o) => /yes/i.test(o.text) && !/crandor|bother|miss/i.test(o.text));
        log(`Boat dialog -> ${pick?.text ?? 'continue'}`);
        await sdk.sendClickDialog(pick?.index ?? 0);
        await sdk.waitForTicks(1).catch(() => {});
    }
}

async function sail(npcName: RegExp, destCheck: () => boolean): Promise<boolean> {
    if (count(COINS) < BOAT_GP) {
        session.noteFailure('boat', `Need ${BOAT_GP}gp, have ${count(COINS)}`);
        return false;
    }
    const npc = sdk.findNearbyNpc(npcName, { reachable: true }) ?? sdk.findNearbyNpc(npcName);
    if (!npc) {
        session.noteFailure('boat', `No sailor @ ${pos().x},${pos().z}`);
        return false;
    }
    const start = pos();
    await bot.talkTo(npc);
    await clickBoatDialog();
    for (let i = 0; i < 40 && !destCheck() && !session.isStopped(); i++) {
        if (sdk.getDialog()?.isOpen) await clickBoatDialog();
        await crossGangplank(bot, sdk);
        if (Math.hypot(pos().x - start.x, pos().z - start.z) > 40 && destCheck()) break;
        await sdk.waitForTicks(2).catch(() => {});
    }
    await crossGangplank(bot, sdk);
    log(`After boat @ ${pos().x},${pos().z} gp=${count(COINS)}`);
    return destCheck();
}

async function reachJiminua(): Promise<boolean> {
    if (inNatureAltar()) return false;
    if (distTo(JIMINUA_SHOP.x, JIMINUA_SHOP.z) <= 6) return true;
    await session.setPhase('travel');
    await leaveInstances();

    if (onKaramja()) {
        await leaveMusaHouses();
        session.setAnchor(JIMINUA_SHOP.x, JIMINUA_SHOP.z);
        intent('Walking to Jiminua');
        const fromMusa = onMusa() || pos().x >= 2815;
        const route = fromMusa ? MUSA_TO_JIMINUA : BRIMHAVEN_TO_JIMINUA;
        if (!(await clickRoute(route, JIMINUA_SHOP))) {
            await walkNear(JIMINUA_SHOP.x, JIMINUA_SHOP.z, 6);
        }
        return distTo(JIMINUA_SHOP.x, JIMINUA_SHOP.z) <= 10;
    }

    if (inKandarin()) {
        if (count(COINS) < BOAT_GP) await ensureGp(BOAT_GP);
        intent('Ardougne docks → Brimhaven');
        if (pos().z < 3200) await clickRoute(YANILLE_TO_BARNABY, CAPTAIN_BARNABY);
        await walkNear(CAPTAIN_BARNABY.x, CAPTAIN_BARNABY.z, 4);
        if (!(await sail(/^captain barnaby$/i, () => onKaramja()))) return false;
        return reachJiminua();
    }

    intent('Port Sarim → Musa Point');
    if (count(COINS) < BOAT_GP) await ensureGp(BOAT_GP);
    await walkNear(PORT_SARIM_DOCK.x, PORT_SARIM_DOCK.z, 4);
    const sailor =
        sdk.findNearbyNpc(/^captain tobias$/i) ??
        sdk.findNearbyNpc(/^seaman /i) ??
        sdk.findNearbyNpc(/sailor|seaman|captain tobias/i);
    if (!sailor) {
        session.noteFailure('boat', `No Port Sarim sailor @ ${pos().x},${pos().z}`);
        return false;
    }
    if (!(await sail(new RegExp(`^${sailor.name}$`, 'i'), () => onKaramja()))) return false;
    return reachJiminua();
}

async function leaveKaramja(): Promise<boolean> {
    if (!onKaramja() && !inNatureAltar()) return true;
    if (inNatureAltar()) await leaveAltar();
    await session.setPhase('leave_island');
    if (count(COINS) < BOAT_GP) await seedShopGp(BOAT_GP);
    if (count(COINS) < BOAT_GP) await ensureGp(BOAT_GP);
    intent('Brimhaven customs → Ardougne');
    await clickRoute([...BRIMHAVEN_TO_JIMINUA].reverse(), BRIMHAVEN_CUSTOMS);
    await clickTile(BRIMHAVEN_CUSTOMS.x, BRIMHAVEN_CUSTOMS.z, 3);
    const ok = await sail(/^customs officer$/i, () => !onKaramja());
    log(`Left Karamja @ ${pos().x},${pos().z} ok=${ok}`);
    return ok || !onKaramja();
}

async function goShop(): Promise<boolean> {
    if (inNatureAltar()) return false;
    session.setAnchor(JIMINUA_SHOP.x, JIMINUA_SHOP.z);
    if (distTo(JIMINUA_SHOP.x, JIMINUA_SHOP.z) <= 4) return true;
    if (onKaramja()) {
        await leaveMusaHouses();
        intent('Walking to Jiminua');
        const fromMusa = onMusa() || pos().x >= 2815;
        const route = distTo(NATURE_RUINS.x, NATURE_RUINS.z) <= 20
            ? NATURE_TO_JIMINUA
            : fromMusa
              ? MUSA_TO_JIMINUA
              : BRIMHAVEN_TO_JIMINUA;
        if (!(await clickRoute(route, JIMINUA_SHOP))) {
            await walkNear(JIMINUA_SHOP.x, JIMINUA_SHOP.z, 6);
        }
        return distTo(JIMINUA_SHOP.x, JIMINUA_SHOP.z) <= 8;
    }
    return reachJiminua();
}

async function goRuins(): Promise<boolean> {
    if (inNatureAltar()) return true;
    session.setAnchor(NATURE_RUINS.x, NATURE_RUINS.z);
    if (distTo(NATURE_RUINS.x, NATURE_RUINS.z) <= 4) return true;
    if (!onKaramja() && !(await reachJiminua())) return false;
    // Already on the Jiminua→ruins click-path (south/east of the hut).
    const onJunglePath = pos().z <= 3124 && pos().x >= 2766 && pos().x <= 2872;
    if (!onJunglePath && distTo(JIMINUA_SHOP.x, JIMINUA_SHOP.z) > 8) {
        intent('To Jiminua before the jungle path');
        if (!(await goShop())) return false;
    }
    intent('Walking to nature ruins');
    if (!(await clickRoute(JIMINUA_TO_NATURE, NATURE_RUINS))) {
        session.noteFailure('walk_ruins', `Could not reach ruins @ ${pos().x},${pos().z}`);
        return false;
    }
    return distTo(NATURE_RUINS.x, NATURE_RUINS.z) <= 10;
}

async function openJiminua(): Promise<boolean> {
    if (sdk.getState()?.shop?.isOpen) return true;
    await closeUi();
    if (!(await goShop())) return false;
    await sdk.scanNearbyLocs(10).catch(() => {});
    const door = sdk.findNearbyLoc(/door/i, { withOption: /open/i });
    if (door && !sdk.findNearbyNpc(SHOP_NPC)) {
        await bot.openDoor(door);
        await sdk.waitForTicks(2).catch(() => {});
    }
    const npc = sdk.findNearbyNpc(SHOP_NPC, { reachable: true }) ?? sdk.findNearbyNpc(SHOP_NPC);
    if (!npc) {
        session.noteFailure('shop_open', `Jiminua not visible @ ${pos().x},${pos().z}`);
        return false;
    }
    const opened = await bot.openShop(npc);
    if (!opened.success && !sdk.getState()?.shop?.isOpen) {
        session.noteFailure('shop_open', opened.message || 'Jiminua shop did not open');
        return false;
    }
    return !!sdk.getState()?.shop?.isOpen;
}

async function buyShopEssence(label: string): Promise<void> {
    let stale = 0;
    while (unnotedCount() < LOAD && occupiedSlots() < 28 && stale < 4 && !session.isStopped()) {
        const line = shopEssence();
        if (!line) break;
        const take = Math.min(BUY_STEP, LOAD - unnotedCount(), line.count, 28 - occupiedSlots());
        if (take < 1) break;
        const before = unnotedCount();
        const gp = count(COINS);
        if (gp < (line.buyPrice ?? 1)) {
            log(`Shop buy skip: need ${line.buyPrice}gp, have ${gp}`);
            break;
        }
        intent(`Buying ${take} ${label}`);
        const bought = await bot.buyFromShop(ESSENCE, take);
        await sdk.waitForTicks(1).catch(() => {});
        if (unnotedCount() <= before) {
            stale++;
            log(`Buy ${label} ${take}: ${bought.message} ess ${before} -> ${unnotedCount()}`);
        } else {
            stale = 0;
            session.noteProgress('shop', `unnoted ${unnotedCount()}`);
        }
    }
}

async function unnoteEssence(): Promise<boolean> {
    const need = LOAD - unnotedCount();
    if (need <= 0) return true;

    await session.setPhase('unnote');
    if (!(await openJiminua())) return false;

    await buyShopEssence('stock');
    if (unnotedCount() >= LOAD) {
        await bot.closeShop();
        log(`Unnote done ess=${unnotedCount()} notes=${notedCount()} gp=${count(COINS)} (shop stock)`);
        return true;
    }

    const line = shopEssence();
    const buyPrice = line?.buyPrice ?? 6;
    if (line && count(COINS) < buyPrice) {
        await bot.closeShop();
        if (await seedShopGp(Math.max(80, buyPrice * LOAD))) {
            if (await openJiminua()) await buyShopEssence('unnote');
        }
        await bot.closeShop();
        log(`Unnote done ess=${unnotedCount()} notes=${notedCount()} gp=${count(COINS)}`);
        return unnotedCount() > 0;
    }

    // Only sell notes if the shop has none — selling into an overstocked shop pays 0gp.
    if (!shopEssence() && notedCount() > 0) {
        learnNotedId();
        const sell = Math.min(need, notedCount());
        intent(`Selling ${sell} noted essence`);
        let soldTotal = 0;
        while (soldTotal < sell && !session.isStopped()) {
            const notes = sdk.getInventory().find(isNoted);
            if (!notes) break;
            const step = Math.min(10, sell - soldTotal);
            const gpBefore = count(COINS);
            const before = notedCount();
            const sold = await bot.sellToShop(notes, step);
            const dropped = Math.max(0, before - notedCount());
            const gpGain = count(COINS) - gpBefore;
            log(`Sell ${step} notes: dropped=${dropped} gp+${gpGain} ${sold.success || sold.partial ? 'ok' : sold.message}`);
            if (dropped < 1) break;
            if (gpGain < 1) {
                session.log('warn', 'Jiminua paid 0gp for essence — stop selling');
                break;
            }
            soldTotal += Math.min(dropped, step);
            session.noteProgress('shop', `sold ${soldTotal}`);
            await sdk.waitForTicks(1).catch(() => {});
        }
        await buyShopEssence('unnote');
    }

    await bot.closeShop();
    log(`Unnote done ess=${unnotedCount()} notes=${notedCount()} gp=${count(COINS)}`);
    return unnotedCount() > 0;
}

async function enterAltar(): Promise<boolean> {
    if (inNatureAltar()) return true;
    if (count(TALISMAN) < 1) {
        session.noteFailure('enter', 'No nature talisman');
        return false;
    }
    await session.setPhase('enter');
    await closeUi();
    if (!(await goRuins())) return false;
    await sdk.scanNearbyLocs(10).catch(() => {});
    intent('Using nature talisman on ruins');
    const used = await bot.useItemOnLoc(TALISMAN, /mysterious ruins/i);
    if (!used.success) {
        session.noteFailure('enter', used.message || 'talisman on ruins failed');
        return false;
    }
    await sdk.waitForCondition((s) => inNatureAltar(s.player?.worldX ?? 0, s.player?.worldZ ?? 0), 12_000).catch(() => {});
    const ok = inNatureAltar();
    if (ok) {
        log(`Entered nature altar @ ${pos().x},${pos().z}`);
        session.noteProgress('location', `${pos().x},${pos().z}`);
    } else {
        session.noteFailure('enter', `Still outside @ ${pos().x},${pos().z}`);
    }
    return ok;
}

async function leaveAltar(): Promise<boolean> {
    if (!inNatureAltar()) return true;
    await session.setPhase('leave');
    intent('Leaving nature altar');
    for (let i = 0; i < 8 && inNatureAltar() && !session.isStopped(); i++) {
        await closeUi();
        await sdk.scanNearbyLocs(12).catch(() => {});
        const portal = sdk.findNearbyLoc(/^portal$/i);
        if (!portal) {
            await walkNear(NATURE_ALTAR.x, NATURE_ALTAR.z, 6);
            continue;
        }
        await bot.interactLoc(portal, /use|enter/i);
        await sdk
            .waitForCondition((s) => !inNatureAltar(s.player?.worldX ?? 0, s.player?.worldZ ?? 0), 10_000)
            .catch(() => {});
    }
    const ok = !inNatureAltar();
    if (!ok) session.noteFailure('leave', `Still in altar @ ${pos().x},${pos().z}`);
    return ok;
}

async function craft(): Promise<boolean> {
    if (unnotedCount() < 1) return false;
    if (!inNatureAltar() && !(await enterAltar())) return false;
    await session.setPhase('craft');
    session.setAnchor(NATURE_ALTAR.x, NATURE_ALTAR.z);
    await walkNear(NATURE_ALTAR.x, NATURE_ALTAR.z, 3);
    await sdk.scanNearbyLocs(10).catch(() => {});

    const before = unnotedCount();
    const xpBefore = sdk.getSkill('Runecraft')?.experience ?? 0;
    const natsBefore = count(NATS);
    intent(`Crafting ${before} nature runes`);
    const craftedOk = await bot.interactLoc(/^altar$/i, /craft-rune/i);
    await sdk
        .waitForCondition(
            (s) =>
                unnotedCount() < before ||
                (s.skills.find((sk) => /runecraft/i.test(sk.name))?.experience ?? 0) > xpBefore,
            8_000
        )
        .catch(() => {});
    await closeUi();

    const made = Math.max(0, before - unnotedCount());
    const nats = count(NATS) - natsBefore;
    if (made > 0) {
        crafted += made;
        session.noteProgress('xp', `nats ${nats} ess ${made}`);
        log(
            `Craft ${made} ess → ${nats} nats | total ess ${crafted} nats=${count(NATS)} xp=${sdk.getSkill('Runecraft')?.experience ?? 0}`
        );
        return true;
    }
    session.noteFailure('craft', craftedOk.message || 'no essence consumed');
    return false;
}

const KEEP_RUNNER = /^(coins|pure essence|rune essence)$/i;
const KEEP_CRAFTER = /^(coins|nature talisman|nature rune|pure essence|rune essence)$/i;

async function packBank(): Promise<boolean> {
    await leaveInstances();
    if (onKaramja() || inNatureAltar()) {
        if (!(await leaveKaramja())) {
            session.noteFailure('bank', `Still on Karamja @ ${pos().x},${pos().z}`);
            return false;
        }
    }
    const bank = inKandarin() ? { name: 'Ardougne', ...ARDOUGNE_BANK } : closestFleetBank(pos().x, pos().z).bank;
    await session.setPhase('bank');
    intent(`Banking at ${bank.name}`);
    session.setAnchor(bank.x, bank.z);
    let opened = sdk.getState()?.bank?.isOpen;
    for (let i = 0; i < 5 && !opened; i++) {
        if (i > 0) {
            const p = pos();
            await walkNear(p.x + (i % 2 === 0 ? 3 : -3), p.z - 2, 1);
        }
        if (distTo(bank.x, bank.z) > 2) await walkNear(bank.x, bank.z, 2);
        opened = (await bot.openBank()).success || !!sdk.getState()?.bank?.isOpen;
    }
    if (!opened) {
        session.noteFailure('bank', `Could not open ${bank.name}`);
        return false;
    }
    await sdk.waitForCondition((s) => (s.bank?.items?.length ?? 0) > 0, 8_000).catch(() => {});

    const keep = isCrafter ? KEEP_CRAFTER : KEEP_RUNNER;
    const bankGp = sdk.findBankItem(/coins?/i);
    log(`Bank gp=${bankGp?.count ?? 0} inv gp=${count(COINS)}`);
    if (bankGp && (bankGp.count ?? 0) > 0) {
        const w = await bot.withdrawItem(bankGp, -1);
        log(`Withdraw coins: ${w.success ? 'ok' : w.message} gp=${count(COINS)}`);
    }

    for (let pass = 0; pass < 10; pass++) {
        const junk = sdk.getInventory().find((i) => (i.count ?? 0) > 0 && !keep.test(i.name));
        if (!junk) break;
        const r = await bot.depositItem(junk, -1);
        if (!r.success) break;
    }

    const coinsLeft = sdk.findBankItem(/coins?/i);
    if (coinsLeft && (coinsLeft.count ?? 0) > 0) {
        const w = await bot.withdrawItem(coinsLeft, -1);
        log(`Withdraw leftover coins: ${w.success ? 'ok' : w.message} gp=${count(COINS)}`);
    }

    if (isCrafter && count(TALISMAN) < 1) {
        let t = await bot.withdrawItem(TALISMAN, 1);
        if (!t.success || count(TALISMAN) < 1) {
            await bot.closeBank();
            const extras = [CATHERBY_BANK, SEERS_BANK, ARDOUGNE_BANK, FALADOR_EAST_BANK];
            for (const extra of extras) {
                if (distTo(extra.x, extra.z) <= 8) continue;
                log(`Talisman missing at ${bank.name}, trying ${extra.x},${extra.z}`);
                await walkNear(extra.x, extra.z, 3);
                if (!(sdk.getState()?.bank?.isOpen || (await bot.openBank()).success)) continue;
                t = await bot.withdrawItem(TALISMAN, 1);
                await bot.closeBank();
                if (count(TALISMAN) > 0) break;
            }
        }
        if (count(TALISMAN) < 1) {
            session.stop('no_talisman', `No nature talisman in nearby banks`);
            return false;
        }
    }

    if (!isCrafter) {
        const pure = sdk.findBankItem(PURE) ?? sdk.findBankItem(ESSENCE);
        if (pure && (pure.count ?? 0) > 0) {
            const w = await bot.withdrawItem(pure, -1, { asNote: true });
            log(`Note-withdraw ${pure.name} x${pure.count}: ${w.success ? 'ok' : w.message} notes=${notedCount()}`);
        }
    }

    await bot.closeBank();
    packed = true;
    log(
        `Packed @ ${bank.name} gp=${count(COINS)} notes=${notedCount()} ess=${unnotedCount()} talisman=${count(TALISMAN)}`
    );
    return isCrafter ? count(TALISMAN) > 0 : notedCount() + unnotedCount() > 0;
}

async function waitForCrafter(ms = 180_000): Promise<boolean> {
    const deadline = Date.now() + ms;
    while (Date.now() < deadline && !session.isStopped()) {
        const p = sdk.findNearbyPlayer(CRAFTER);
        if (p && (p.distance ?? 99) <= 12) return true;
        intent('Waiting for jackthief at the ruins');
        session.noteProgress('location', `wait ${pos().x},${pos().z}`);
        await sdk.waitForTicks(8).catch(() => {});
    }
    const p = sdk.findNearbyPlayer(CRAFTER);
    return !!p && (p.distance ?? 99) <= 12;
}

async function handoff(): Promise<boolean> {
    await session.setPhase('trade');
    if (!(await goRuins())) return false;
    learnNotedId();
    const unnoted = sdk.getInventory().find((i) => ESSENCE.test(i.name) && !isNoted(i));
    if (!unnoted) return false;
    if (!(await waitForCrafter())) {
        log(`Trade jackthief: not nearby @ ${pos().x},${pos().z}`);
        await sdk.waitForTicks(8).catch(() => {});
        return false;
    }
    const before = unnotedCount();
    const offer = Math.min(LOAD, before);
    intent(`Trading ${offer} essence to jackthief`);
    const opened = await bot.tradeWith(CRAFTER, 45_000, { retryOnBusy: true });
    if (!opened.success || !sdk.getTradeState().isOpen) {
        log(`Trade jackthief: ${opened.message}`);
        await sdk.waitForTicks(5).catch(() => {});
        return false;
    }
    await sdk.sendOfferItem(unnoted.slot, offer);
    await sdk
        .waitForCondition(
            (s) => (s.trade?.myOffer ?? []).some((o) => ESSENCE.test(o.name) && (o.count ?? 0) >= 1),
            8_000
        )
        .catch(() => {});
    for (let i = 0; i < 4 && sdk.getTradeState().isOpen && !session.isStopped(); i++) {
        const acc = await bot.acceptTrade(25_000);
        if (!sdk.getTradeState().isOpen) {
            log(`Accept: ${acc.message}`);
            break;
        }
        if (acc.reason === 'declined') {
            log(`Trade declined: ${acc.message}`);
            break;
        }
    }
    if (sdk.getTradeState().isOpen) await bot.declineTrade().catch(() => {});
    const gave = before - unnotedCount();
    if (gave > 0) {
        handed += gave;
        session.noteProgress('inventory', `gave ${gave}`);
    }
    log(`Trade jackthief: gave ${gave} ess leftover=${unnotedCount()} notes=${notedCount()} total=${handed}`);
    return gave > 0;
}

async function takeEssence(): Promise<void> {
    await session.setPhase('serve');
    if (inNatureAltar()) await leaveAltar();
    if (!(await goRuins())) return;
    if (distTo(NATURE_RUINS.x, NATURE_RUINS.z) > 10) return;
    await walkNear(NATURE_CRAFTER_STAND.x, NATURE_CRAFTER_STAND.z, 1);
    const gift = Math.min(GP_GIFT, Math.max(0, count(COINS) - GP_KEEP));
    intent(`Waiting for runners ess=${unnotedCount()} gift ${gift}gp`);
    const served = await bot.serveTrades({
        from: RUNNERS,
        give: gift >= BOAT_GP ? [{ item: COINS, amount: gift }] : [],
        want: [],
        accept: (offer) => {
            const ess = offer
                .filter((i) => ESSENCE.test(i.name))
                .reduce((n, i) => n + (i.count ?? 0), 0);
            if (ess < 1) return offer.every((i) => (i.count ?? 0) < 1) || offer.length === 0;
            return ess <= emptySlots();
        },
        maxTrades: 1,
        timeout: 90_000,
        tradeTimeout: 60_000,
        until: () => unnotedCount() >= LOAD || emptySlots() === 0
    });
    const last = served.trades.at(-1);
    log(
        `Serve: ${served.reason} ${last ? (last.success ? 'ok' : last.message) : served.message} ess=${unnotedCount()}`
    );
    if (last?.success) session.noteProgress('inventory', `ess ${unnotedCount()}`);
}

async function runnerTick(): Promise<void> {
    await closeUi();
    learnNotedId();

    if (unnotedCount() > 0) {
        await handoff();
        return;
    }

    if (notedCount() > 0) {
        if (!(await unnoteEssence())) await sdk.waitForTicks(3).catch(() => {});
        return;
    }

    if (!packed || count(COINS) < 1) {
        if (!(await packBank())) {
            session.stop('done', `No essence to run after handing ${handed}`);
        }
        return;
    }

    session.stop('done', `Out of essence after handing ${handed}, gp=${count(COINS)}`);
}

async function crafterTick(): Promise<void> {
    await closeUi();
    learnNotedId();

    if (inNatureAltar()) {
        if (unnotedCount() > 0) {
            await craft();
            return;
        }
        await leaveAltar();
        return;
    }

    if (unnotedCount() >= LOAD || (unnotedCount() > 0 && emptySlots() === 0)) {
        await craft();
        return;
    }

    if (count(TALISMAN) < 1) {
        packed = false;
        if (!(await packBank())) return;
    }

    if (!onKaramja() && !inNatureAltar()) {
        if (!(await reachJiminua())) return;
    }

    await takeEssence();
    if (unnotedCount() > 0) await craft();
}

session.registerRecovery([
    {
        name: 'unnote',
        run: async () => {
            if (isCrafter || unnotedCount() > 0 || notedCount() < 1) return false;
            return unnoteEssence();
        }
    },
    {
        name: 'leave_altar',
        run: async () => {
            if (!inNatureAltar()) return true;
            if (isCrafter && unnotedCount() > 0) return craft();
            return leaveAltar();
        }
    },
    {
        name: 'shop',
        run: async () => {
            if (inNatureAltar() || isCrafter) return false;
            await goShop();
            return distTo(JIMINUA_SHOP.x, JIMINUA_SHOP.z) <= 10;
        }
    },
    {
        name: 'ruins',
        run: async () => {
            if (inNatureAltar()) return true;
            if (onKaramja() && distTo(JIMINUA_SHOP.x, JIMINUA_SHOP.z) > 10) await goShop();
            await goRuins();
            return distTo(NATURE_RUINS.x, NATURE_RUINS.z) <= 10;
        }
    },
    {
        name: 'boat',
        run: async () => {
            if (onKaramja() || inNatureAltar()) return true;
            return reachJiminua();
        }
    }
]);

try {
    log(`Nature ${isCrafter ? 'crafter' : 'runner'} connecting @ ${pos().x},${pos().z}`);
    await closeUi();
    await bot.skipTutorial();
    await closeUi();
    learnNotedId();
    log(
        `Nature ${isCrafter ? 'crafter' : 'runner'} start @ ${pos().x},${pos().z} notes=${notedCount()} ess=${unnotedCount()} talisman=${count(TALISMAN)} gp=${count(COINS)} rc=${sdk.getSkill('Runecraft')?.baseLevel ?? 0}`
    );

    if (isCrafter) {
        if (count(TALISMAN) < 1 && !inNatureAltar()) {
            await packBank();
        }
    } else if (notedCount() + unnotedCount() < 1) {
        await packBank();
    }

    while (!session.isStopped()) {
        if (session.needsRecovery()) {
            if ((await session.recover()) === 'exhausted') break;
            continue;
        }
        if (pos().isDead) {
            await sdk.waitForCondition((s) => !s.player.isDead, 45_000).catch(() => {});
            continue;
        }
        session.maybeHeartbeat();
        if (isCrafter) await crafterTick();
        else await runnerTick();
    }
} catch (err) {
    session.stop('script_error', err instanceof Error ? err.message : String(err));
    console.error('Script error:', err);
} finally {
    const stop = session.metrics().stopReason;
    if (stop) {
        log(
            `stopped ${stop.code} @ ${stop.location.x},${stop.location.z} handed=${handed} crafted=${crafted} nats=${count(NATS)}`
        );
    }
    await session.finalizeStop();
    await sdk.disconnect();
}
