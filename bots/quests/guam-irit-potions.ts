/**
 * After Druidic Ritual: identify every bank herb the herblore level allows,
 * buy vials and eyes of newt from Jatix, fill the vials at the Falador
 * fountain, and brew Guam → attack potion(3) and Irit → super attack(3).
 *
 * Super attack needs herblore 45 (irit identify is 40). A bank of guams
 * does not reach that. When nothing left can be identified or brewed, the
 * script settles and hands off via `--then`.
 *
 *   bun bots/quests/guam-irit-potions.ts Jackpoo5 --then bots/quests/black-unicorns.ts
 */
import { existsSync, readFileSync } from 'fs';
import { dirname, join } from 'path';
import { ActivitySession, BotSDK, deriveGatewayUrl } from '../../sdk/index';
import { BotActions } from '../../sdk/actions';
import { initPathfinding } from '../../sdk/pathfinding';
import { FALADOR_WEST_BANK } from './tiles';
import { closeUi, distTo, leaveEdgevilleWilderness, playerPos, walkNear } from './movement';
import { scheduleHandoff } from './handoff';
import { installGracefulShutdown } from '../../sdk/runner';

const UNID_HERB = /^herb$/i;
const VIAL_WATER = /^vial of water$/i;
const EMPTY_VIAL = /^vial$/i;
const EYE = /^eye of newt$/i;
const COINS = /^coins$/i;
const UNF_POTION = /^unfinished potion$/i;
const GUAM = /^guam leaf$/i;
const IRIT = /^irit leaf$/i;
const ATTACK_POT = /^attack potion\(\d\)$/i;
const SUPER_POT = /^super attack\(\d\)$/i;

const GUAM_ID = 199;
const IRIT_ID = 209;
const JATIX = { x: 2899, z: 3427 };
const FOUNTAIN = { x: 2950, z: 3379 };

/** Identify levels from herbs.obj. Guam's missing param defaults to 3. */
const UNID_LEVELS: Record<number, number> = {
    199: 3,
    201: 5,
    203: 11,
    205: 20,
    207: 25,
    3049: 30,
    209: 40,
    211: 48,
    213: 54,
    3051: 59,
    215: 65,
    2485: 67,
    217: 70,
    219: 75
};

const argv = process.argv.slice(2);
const botArg = argv.find((a) => !a.startsWith('-') && !a.endsWith('.ts'));

function loadBotEnv(): void {
    const envPath = botArg
        ? join(process.cwd(), 'bots', botArg, 'bot.env')
        : join(dirname(import.meta.path), 'bot.env');
    if (!existsSync(envPath)) {
        throw new Error(`bot.env not found at ${envPath}. Usage: bun bots/quests/guam-irit-potions.ts {botname}`);
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
    name: 'guam-irit-potions',
    grindLogPath: GRIND_LOG,
    stallMs: 180_000,
    maxRecoveryTactics: 8
});

installGracefulShutdown({ graceMs: 30_000 });

function log(msg: string): void {
    session.log('log', msg);
}

function herbloreLevel(): number {
    return sdk.getSkill('Herblore')?.baseLevel ?? 1;
}

function herbloreXp(): number {
    return sdk.getSkill('Herblore')?.experience ?? 0;
}

function invCount(pattern: RegExp): number {
    return sdk
        .getInventory()
        .filter((i) => pattern.test(i.name))
        .reduce((n, i) => n + (i.count ?? 0), 0);
}

function bankCount(pred: (item: { id: number; name: string; count?: number }) => boolean): number {
    return sdk
        .getBankItems()
        .filter((i) => pred(i))
        .reduce((n, i) => n + (i.count ?? 0), 0);
}

function freeSlots(): number {
    return 28 - sdk.getInventory().filter((i) => (i.count ?? 0) > 0).length;
}

async function openFaladorBank(): Promise<boolean> {
    await bot.dismissBlockingUI();
    if (distTo(sdk, FALADOR_WEST_BANK.x, FALADOR_WEST_BANK.z) > 6) {
        await walkNear(bot, sdk, FALADOR_WEST_BANK.x, FALADOR_WEST_BANK.z, 3);
    }
    if (sdk.getState()?.bank?.isOpen) return true;
    const opened = await bot.openBank();
    if (!opened.success && !sdk.getState()?.bank?.isOpen) {
        session.log('warn', `openBank: ${opened.message}`);
        return false;
    }
    return !!sdk.getState()?.bank?.isOpen;
}

async function depositAll(): Promise<void> {
    for (let i = 0; i < 40; i++) {
        const item = sdk.getInventory().find((it) => (it.count ?? 0) > 0);
        if (!item) break;
        const r = await bot.depositItem(item, -1);
        if (!r.success && !r.partial) break;
    }
}

async function bankInventory(): Promise<boolean> {
    await closeUi(bot, sdk);
    if (!(await openFaladorBank())) return false;
    await depositAll();
    session.captureBankStock();
    await bot.closeBank();
    return sdk.getInventory().filter((i) => (i.count ?? 0) > 0).length === 0;
}

async function withdrawCoins(): Promise<number> {
    if (invCount(COINS) >= 2_000) return invCount(COINS);
    if (!(await openFaladorBank())) return invCount(COINS);
    await depositAll();
    const coins = sdk.findBankItem(COINS);
    if (coins && (coins.count ?? 0) > 0) await bot.withdrawItem(coins, -1);
    await bot.closeBank();
    return invCount(COINS);
}

async function buy(pattern: RegExp, qty: number): Promise<number> {
    let bought = 0;
    let fails = 0;
    while (bought < qty && fails < 6) {
        await closeUi(bot, sdk);
        const gp = await withdrawCoins();
        if (gp < 2) {
            session.log('warn', `Not enough coins (${gp}) for ${pattern}`);
            break;
        }
        if (freeSlots() < 1) {
            if (!(await bankInventory())) break;
            await withdrawCoins();
        }
        if (distTo(sdk, JATIX.x, JATIX.z) > 6) await walkNear(bot, sdk, JATIX.x, JATIX.z, 3);
        if (playerPos(sdk).level > 0) {
            const stairs = sdk.findNearbyLoc(/stair/i);
            if (stairs) await bot.interactLoc(stairs, /climb-down|climb.down/i);
        }
        const opened = sdk.getState()?.shop?.isOpen || (await bot.openShop(/^jatix$/i)).success;
        if (!opened && !sdk.getState()?.shop?.isOpen) {
            fails++;
            session.log('warn', `Jatix shop closed @ ${playerPos(sdk).x},${playerPos(sdk).z}`);
            await sdk.waitForTicks(4);
            continue;
        }
        const line = sdk.getState()?.shop?.shopItems.find((i) => pattern.test(i.name)) ?? null;
        const price = Math.max(1, line?.buyPrice ?? 5);
        if (!line || line.count <= 0 || invCount(COINS) < price) {
            await bot.closeShop();
            if (!line || line.count <= 0) {
                session.log('warn', `Jatix out of ${pattern}`);
                await sdk.waitForTicks(20);
            }
            fails++;
            continue;
        }
        const want = Math.min(qty - bought, freeSlots(), line.count, Math.floor(invCount(COINS) / price));
        if (want <= 0) {
            await bot.closeShop();
            break;
        }
        const result = await bot.buyFromShop(line, want);
        const n = result.amountBought ?? 0;
        bought += n;
        log(`Bought ${n}/${want} ${line.name} @ ${price}gp | shop left ${line.count - n} | ${invCount(COINS)}gp`);
        await bot.closeShop();
        if (n <= 0) {
            fails++;
            await sdk.waitForTicks(8);
            continue;
        }
        fails = 0;
        session.noteProgress('shop', line.name);
        if (freeSlots() < 2) {
            if (!(await bankInventory())) break;
        }
    }
    await bankInventory();
    return bought;
}

async function fillVials(): Promise<number> {
    let filled = 0;
    for (let loads = 0; loads < 20; loads++) {
        await closeUi(bot, sdk);
        if (!(await openFaladorBank())) break;
        await depositAll();
        const empty = sdk.getBankItems().find((i) => EMPTY_VIAL.test(i.name) && (i.count ?? 0) > 0);
        if (!empty) {
            await bot.closeBank();
            break;
        }
        const take = Math.min(27, empty.count ?? 0);
        await bot.withdrawItem(empty, take);
        await bot.closeBank();
        if (invCount(EMPTY_VIAL) < 1) break;

        if (distTo(sdk, FOUNTAIN.x, FOUNTAIN.z) > 8) await walkNear(bot, sdk, FOUNTAIN.x, FOUNTAIN.z, 4);
        await sdk.scanNearbyLocs(20).catch(() => {});
        const source =
            sdk.findNearbyLoc(/^fountain$/i) ?? sdk.findNearbyLoc(/^sink$/i) ?? sdk.findNearbyLoc(/fountain|sink/i);
        if (!source) {
            session.log('warn', `No fountain or sink @ ${playerPos(sdk).x},${playerPos(sdk).z}`);
            await bankInventory();
            break;
        }
        let misses = 0;
        while (invCount(EMPTY_VIAL) > 0 && misses < 4) {
            const vial = sdk.findInventoryItem(EMPTY_VIAL);
            if (!vial) break;
            const before = invCount(VIAL_WATER);
            await bot.useItemOnLoc(vial, source);
            await sdk.waitForTicks(1);
            if (invCount(VIAL_WATER) > before) {
                filled++;
                misses = 0;
            } else misses++;
        }
        log(`Filled ${filled} vials of water`);
        if (!(await bankInventory())) break;
        if (misses >= 4) break;
    }
    return filled;
}

async function ensureSupplies(): Promise<void> {
    if (!(await openFaladorBank())) return;
    const guam =
        bankCount((i) => i.id === GUAM_ID || GUAM.test(i.name)) +
        sdk.getInventory().filter((i) => i.id === GUAM_ID || GUAM.test(i.name)).reduce((n, i) => n + (i.count ?? 0), 0);
    const irit =
        bankCount((i) => i.id === IRIT_ID || IRIT.test(i.name)) +
        sdk.getInventory().filter((i) => i.id === IRIT_ID || IRIT.test(i.name)).reduce((n, i) => n + (i.count ?? 0), 0);
    const waters = bankCount((i) => VIAL_WATER.test(i.name));
    const empties = bankCount((i) => EMPTY_VIAL.test(i.name));
    const eyes = bankCount((i) => EYE.test(i.name));
    await bot.closeBank();
    const need = guam + irit;
    log(`Supplies guam=${guam} irit=${irit} vials=${waters} empty=${empties} eyes=${eyes} need=${need}`);
    const buyVials = Math.max(0, need - waters - empties);
    const buyEyes = Math.max(0, need - eyes);
    if (buyVials > 0) await buy(EMPTY_VIAL, buyVials);
    if (buyEyes > 0) await buy(EYE, buyEyes);
    if (buyVials > 0 || empties > 0) await fillVials();
}

async function identifyAllUnids(): Promise<boolean> {
    let identifiedAny = false;
    for (let loads = 0; loads < 40; loads++) {
        await bot.dismissBlockingUI();
        if (!(await openFaladorBank())) break;
        await depositAll();
        const currentLvl = herbloreLevel();
        const eligible = sdk
            .getBankItems()
            .find((i) => UNID_HERB.test(i.name) && (i.count ?? 0) > 0 && (UNID_LEVELS[i.id] ?? 99) <= currentLvl);
        if (!eligible) {
            const blocked = sdk
                .getBankItems()
                .filter((i) => UNID_HERB.test(i.name) && (i.count ?? 0) > 0)
                .map((i) => `${i.count} id ${i.id} needs ${UNID_LEVELS[i.id] ?? '?'}`)
                .join(', ');
            if (blocked) log(`Unids still grimy @ Herblore ${currentLvl}: ${blocked}`);
            await bot.closeBank();
            break;
        }
        log(`Withdrawing unids id ${eligible.id} req ${UNID_LEVELS[eligible.id]} x${eligible.count}`);
        await bot.withdrawItem(eligible, 28);
        await bot.closeBank();

        let slotIdentified = 0;
        for (const item of [...sdk.getInventory()]) {
            if (!UNID_HERB.test(item.name) || (item.count ?? 0) <= 0) continue;
            const xpBefore = herbloreXp();
            await sdk.sendUseItem(item.slot, 1);
            await sdk.waitForTicks(1);
            if (herbloreXp() > xpBefore) {
                slotIdentified++;
                identifiedAny = true;
                session.noteProgress('xp', 'identify');
            }
        }
        const named = sdk
            .getInventory()
            .filter((i) => !UNID_HERB.test(i.name) && /leaf|weed|marrentill|tarromin|harralander|ranarr|irit|avantoe|kwuarm|cadantine|lantadyme|dwarf|torstol|toadflax|snapdragon/i.test(i.name))
            .map((i) => i.name)
            .filter((name, i, arr) => arr.indexOf(name) === i);
        log(`Identified ${slotIdentified} (${named.join(', ') || 'none'}) | Herblore ${herbloreLevel()} (${herbloreXp()} xp)`);
        if (await openFaladorBank()) {
            await depositAll();
            await bot.closeBank();
        }
        if (slotIdentified === 0) break;
    }
    return identifiedAny;
}

async function brew(herbPattern: RegExp, minLevel: number, label: string): Promise<boolean> {
    if (herbloreLevel() < minLevel) return false;
    let brewedAny = false;
    for (let batches = 0; batches < 30; batches++) {
        await bot.dismissBlockingUI();
        if (!(await openFaladorBank())) break;
        await depositAll();
        const cleanHerb = sdk.findBankItem(herbPattern);
        const secondary = sdk.findBankItem(EYE);
        const vials = sdk.findBankItem(VIAL_WATER);
        const batchSize = Math.min(14, cleanHerb?.count ?? 0, secondary?.count ?? 0, vials?.count ?? 0);
        if (batchSize <= 0) {
            await bot.closeBank();
            break;
        }
        await bot.withdrawItem(cleanHerb!, batchSize);
        await bot.withdrawItem(vials!, batchSize);
        await bot.closeBank();

        for (let i = 0; i < batchSize; i++) {
            const herb = sdk.findInventoryItem(herbPattern);
            const vial = sdk.findInventoryItem(VIAL_WATER);
            if (!herb || !vial) break;
            await sdk.sendUseItemOnItem(herb.slot, vial.slot);
            await sdk.waitForTicks(2);
            await bot.dismissBlockingUI();
        }

        if (!(await openFaladorBank())) break;
        await bot.withdrawItem(secondary!, batchSize);
        await bot.closeBank();

        const xpBefore = herbloreXp();
        let mixed = 0;
        for (let i = 0; i < batchSize; i++) {
            const unf = sdk.findInventoryItem(UNF_POTION);
            const sec = sdk.findInventoryItem(EYE);
            if (!unf || !sec) break;
            await sdk.sendUseItemOnItem(sec.slot, unf.slot);
            await sdk.waitForTicks(2);
            await bot.dismissBlockingUI();
            mixed++;
        }
        const xpGained = herbloreXp() - xpBefore;
        if (xpGained <= 0) {
            session.log('warn', `${label} mix gave no XP (mixed attempts ${mixed})`);
            if (await openFaladorBank()) {
                await depositAll();
                await bot.closeBank();
            }
            break;
        }
        brewedAny = true;
        session.noteProgress('xp', label);
        log(`Brewed ${label} x${mixed} | +${xpGained} XP | Herblore ${herbloreLevel()} (${herbloreXp()} xp)`);
        if (await openFaladorBank()) {
            await depositAll();
            session.captureBankStock();
            await bot.closeBank();
        }
    }
    return brewedAny;
}

session.registerRecovery([
    {
        name: 'close_ui',
        run: async () => {
            await closeUi(bot, sdk);
            return true;
        }
    },
    {
        name: 'leave_wildy',
        run: async () => {
            const p = playerPos(sdk);
            if (p.z < 3520 || p.z >= 6400) return false;
            return leaveEdgevilleWilderness(sdk);
        }
    }
]);

try {
    await bot.skipTutorial();
    await closeUi(bot, sdk);
    if (playerPos(sdk).z >= 3520 && playerPos(sdk).z < 6400) {
        log(`Leaving wilderness @ ${playerPos(sdk).x},${playerPos(sdk).z}`);
        await leaveEdgevilleWilderness(sdk);
    }
    log(
        `Potion start Herblore ${herbloreLevel()} (${herbloreXp()} xp) @ ${playerPos(sdk).x},${playerPos(sdk).z}`
    );
    if (herbloreLevel() < 3) {
        session.stop('needs-quest', `Herblore ${herbloreLevel()} — Druidic Ritual still required`);
    } else {
        await session.setPhase('supplies');
        await ensureSupplies();
        let idle = 0;
        while (!session.isStopped() && idle < 2) {
            if (session.needsRecovery()) {
                if ((await session.recover()) === 'exhausted') break;
                continue;
            }
            session.maybeHeartbeat();
            await session.setPhase('brew');
            const identified = await identifyAllUnids();
            const attack = await brew(GUAM, 3, 'attack');
            const superAttack = await brew(IRIT, 45, 'super attack');
            if (identified || attack || superAttack) {
                idle = 0;
                continue;
            }
            idle++;
        }
        if (await openFaladorBank()) {
            const guamLeft = bankCount((i) => i.id === GUAM_ID || GUAM.test(i.name));
            const iritLeft = bankCount((i) => i.id === IRIT_ID || IRIT.test(i.name));
            const attackN = bankCount((i) => ATTACK_POT.test(i.name));
            const superN = bankCount((i) => SUPER_POT.test(i.name));
            await bot.closeBank();
            log(
                `POTIONS_SETTLED Herblore ${herbloreLevel()} (${herbloreXp()} xp) | attack ${attackN} super ${superN} | guam left ${guamLeft} irit left ${iritLeft}`
            );
            if (iritLeft > 0 && herbloreLevel() < 45) {
                log(
                    `Irit still grimy or unbrewed: identify needs 40, super attack needs 45, have ${herbloreLevel()}`
                );
            }
        }
        scheduleHandoff(username);
    }
} catch (err) {
    session.stop('script_error', err instanceof Error ? err.message : String(err));
    console.error('Script error:', err);
    throw err;
} finally {
    await session.finalizeStop();
    await sdk.disconnect();
}
