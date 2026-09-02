/**
 * Solo nature-rune loop: un-note 24 pure/rune essence at Jiminua's Jungle
 * Store (sell notes, buy back 10 at a time), walk to the nature ruins, use
 * the talisman, craft, portal out, walk back to the shop.
 *
 *   bun bots/quests/nature-runes.ts jackthief
 */
import { ActivitySession, BotSDK, deriveGatewayUrl } from '../../sdk/index';
import { BotActions } from '../../sdk/actions';
import { initPathfinding } from '../../sdk/pathfinding';
import { existsSync, readFileSync } from 'fs';
import { dirname, join } from 'path';
import { JIMINUA_SHOP, JIMINUA_TO_NATURE, NATURE_ALTAR, NATURE_RUINS, NATURE_TO_JIMINUA } from './tiles';
import {
    closeUi as closeUiShared,
    distTo as distToShared,
    walkNear as walkNearShared
} from './movement';

const LOAD = 24;
const BUY_STEP = 10;
const ESSENCE = /^(rune essence|pure essence)$/i;
const TALISMAN = /^nature talisman$/i;
const NATS = /^nature rune$/i;
const COINS = /^coins$/i;
const SHOP_NPC = /^jiminua$/i;

const argv = process.argv.slice(2);
const botArg = argv.find((a) => !a.startsWith('-'));

function loadBotEnv(): void {
    const envPath = botArg
        ? join(process.cwd(), 'bots', botArg, 'bot.env')
        : join(dirname(import.meta.path), 'bot.env');
    if (!existsSync(envPath)) {
        throw new Error(`bot.env not found at ${envPath}. Usage: bun bots/quests/nature-runes.ts {botname}`);
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
    name: 'nature-runes',
    grindLogPath: GRIND_LOG,
    stallMs: 240_000,
    maxRecoveryTactics: 8
});

/** Cert id of noted essence, learned from the first stack with count > 1. */
let notedId: number | null = null;
let crafted = 0;

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

async function closeUi(): Promise<void> {
    await closeUiShared(bot, sdk);
}

async function walkNear(x: number, z: number, tolerance = 4): Promise<boolean> {
    return walkNearShared(bot, sdk, x, z, tolerance);
}

/** Click each stored tile in order. Jungle walkTo pathfinds through trees. */
async function clickTile(x: number, z: number, tolerance = 3): Promise<boolean> {
    if (distTo(x, z) <= tolerance) return true;
    const deadline = Date.now() + 8_000;
    let stuck = 0;
    while (distTo(x, z) > tolerance && Date.now() < deadline && !session.isStopped()) {
        const before = pos();
        await sdk.sendWalk(x, z, true);
        await sdk
            .waitForCondition(
                (s) => Math.hypot((s.player?.worldX ?? 0) - x, (s.player?.worldZ ?? 0) - z) <= tolerance,
                2_500
            )
            .catch(() => {});
        if (distTo(x, z) <= tolerance) return true;
        if (Math.hypot(pos().x - before.x, pos().z - before.z) < 1) stuck++;
        else stuck = 0;
        if (stuck >= 2) break;
    }
    return distTo(x, z) <= tolerance + 2;
}

async function clickRoute(route: { x: number; z: number }[], dest: { x: number; z: number }): Promise<boolean> {
    for (const wp of route) {
        if (distTo(dest.x, dest.z) <= 4) return true;
        const remaining = distTo(dest.x, dest.z);
        const via = Math.hypot(wp.x - dest.x, wp.z - dest.z);
        if (via >= remaining - 2) continue;
        if (distTo(wp.x, wp.z) <= 3) continue;
        intent(`Click ${wp.x},${wp.z}`);
        if (!(await clickTile(wp.x, wp.z, 3))) {
            session.log('warn', `skip hop ${wp.x},${wp.z} @ ${pos().x},${pos().z}`);
            continue;
        }
        session.noteProgress('location', `${wp.x},${wp.z}`);
    }
    if (distTo(dest.x, dest.z) > 4) await clickTile(dest.x, dest.z, 3);
    return distTo(dest.x, dest.z) <= 8;
}

function shopEssence() {
    return sdk.getState()?.shop?.shopItems?.find((i) => ESSENCE.test(i.name) && i.count > 0) ?? null;
}

async function goShop(): Promise<boolean> {
    if (inNatureAltar()) return false;
    session.setAnchor(JIMINUA_SHOP.x, JIMINUA_SHOP.z);
    if (distTo(JIMINUA_SHOP.x, JIMINUA_SHOP.z) <= 4) return true;
    intent('Walking to Jiminua');
    if (!(await clickRoute(NATURE_TO_JIMINUA, JIMINUA_SHOP))) {
        session.noteFailure('walk_shop', `Could not reach Jiminua @ ${pos().x},${pos().z}`);
        return false;
    }
    return distTo(JIMINUA_SHOP.x, JIMINUA_SHOP.z) <= 8;
}

async function goRuins(): Promise<boolean> {
    if (inNatureAltar()) return true;
    session.setAnchor(NATURE_RUINS.x, NATURE_RUINS.z);
    if (distTo(NATURE_RUINS.x, NATURE_RUINS.z) <= 4) return true;
    intent('Walking to nature ruins');
    if (!(await clickRoute(JIMINUA_TO_NATURE, NATURE_RUINS))) {
        session.noteFailure('walk_ruins', `Could not reach ruins @ ${pos().x},${pos().z}`);
        return false;
    }
    return distTo(NATURE_RUINS.x, NATURE_RUINS.z) <= 8;
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

function sellAmount(): number {
    const notes = notedCount();
    if (notes < 1) return 0;
    const notesSlotFrees = notes <= LOAD;
    const freeAfter = 28 - occupiedSlots() + (notesSlotFrees ? 1 : 0);
    return Math.min(LOAD, notes, Math.max(0, freeAfter));
}

async function unnoteEssence(): Promise<boolean> {
    const need = LOAD - unnotedCount();
    if (need <= 0) return true;
    if (notedCount() < 1) return unnotedCount() > 0;

    await session.setPhase('unnote');
    if (!(await openJiminua())) return false;

    const sell = Math.min(sellAmount(), need);
    if (sell > 0) {
        learnNotedId();
        const notes = sdk.getInventory().find(isNoted);
        if (!notes) {
            await bot.closeShop();
            return unnotedCount() > 0;
        }
        intent(`Selling ${sell} noted essence`);
        const sold = await bot.sellToShop(notes, sell);
        log(`Sell ${sell} notes: ${sold.success || sold.partial ? 'ok' : sold.message} sold=${sold.amountSold ?? 0}`);
        if ((sold.amountSold ?? 0) < 1) {
            session.noteFailure('shop_sell', sold.message || 'sold 0 notes');
            await bot.closeShop();
            return false;
        }
        session.noteProgress('shop', `sold ${sold.amountSold}`);
        await sdk.waitForTicks(1).catch(() => {});
    }

    let stale = 0;
    while (unnotedCount() < LOAD && occupiedSlots() < 28 && stale < 4 && !session.isStopped()) {
        const line = shopEssence();
        if (!line) break;
        const take = Math.min(BUY_STEP, LOAD - unnotedCount(), line.count, 28 - occupiedSlots());
        if (take < 1) break;
        const before = unnotedCount();
        const gp = count(COINS);
        if (gp < (line.buyPrice ?? 1)) {
            session.noteFailure('shop_gp', `need gp, have ${gp}`);
            break;
        }
        intent(`Buying ${take} essence`);
        const bought = await bot.buyFromShop(ESSENCE, take);
        await sdk.waitForTicks(1).catch(() => {});
        if (unnotedCount() <= before) {
            stale++;
            log(`Buy ${take}: ${bought.message} ess ${before} -> ${unnotedCount()}`);
        } else {
            stale = 0;
            session.noteProgress('shop', `unnoted ${unnotedCount()}`);
        }
    }

    await bot.closeShop();
    log(`Unnote done ess=${unnotedCount()} notes=${notedCount()} gp=${count(COINS)} nats=${count(NATS)}`);
    return unnotedCount() > 0;
}

async function enterAltar(): Promise<boolean> {
    if (inNatureAltar()) return true;
    if (count(TALISMAN) < 1) {
        session.stop('no_talisman', 'No nature talisman in inventory');
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
        log(`Craft ${made} ess → ${nats} nats | total ess ${crafted} nats=${count(NATS)} xp=${sdk.getSkill('Runecraft')?.experience ?? 0}`);
        return true;
    }
    session.noteFailure('craft', craftedOk.message || 'no essence consumed');
    return false;
}

async function tick(): Promise<void> {
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

    if (unnotedCount() > 0) {
        await craft();
        return;
    }

    if (notedCount() > 0) {
        if (!(await unnoteEssence())) await sdk.waitForTicks(3).catch(() => {});
        return;
    }

    session.stop('done', `Out of essence after ${crafted} crafted, nats=${count(NATS)}`);
}

session.registerRecovery([
    {
        name: 'leave_altar',
        run: async () => {
            if (!inNatureAltar()) return true;
            return leaveAltar();
        }
    },
    {
        name: 'shop',
        run: async () => {
            if (inNatureAltar()) return false;
            await goShop();
            return distTo(JIMINUA_SHOP.x, JIMINUA_SHOP.z) <= 10;
        }
    },
    {
        name: 'ruins',
        run: async () => {
            if (inNatureAltar()) return true;
            if (unnotedCount() < 1) return false;
            await goRuins();
            return distTo(NATURE_RUINS.x, NATURE_RUINS.z) <= 10;
        }
    }
]);

try {
    await bot.skipTutorial();
    await closeUi();
    learnNotedId();
    log(
        `Nature runes start @ ${pos().x},${pos().z} notes=${notedCount()} ess=${unnotedCount()} talisman=${count(TALISMAN)} nats=${count(NATS)} gp=${count(COINS)} rc=${sdk.getSkill('Runecraft')?.baseLevel ?? 0}`
    );

    if (count(TALISMAN) < 1 && !inNatureAltar()) {
        session.stop('no_talisman', 'Need a nature talisman in inventory');
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
        await tick();
    }
} catch (err) {
    session.stop('script_error', err instanceof Error ? err.message : String(err));
    console.error('Script error:', err);
} finally {
    const stop = session.metrics().stopReason;
    if (stop) log(`stopped ${stop.code} @ ${stop.location.x},${stop.location.z} crafted=${crafted} nats=${count(NATS)}`);
    await session.finalizeStop();
    await sdk.disconnect();
}
