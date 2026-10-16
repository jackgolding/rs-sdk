/**
 * Buy dragon longswords and dragon daggers from Jakut in Zanaris, then bank them.
 *
 * The shelf holds 2 of each. A longsword is 100k gp (101k at stock 1) and a
 * dagger is 30k (about 30.3k at stock 1). Each line restocks one item every
 * 500 ticks (~5 minutes), so daggers get bought while the swords are empty.
 * Swords win when both are in stock. The dramen staff has to be wielded to
 * open the Lumbridge swamp shed. The market's west door charges one cut
 * diamond; the south door opens free from outside. A few diamonds are
 * carried so a toll does not empty the pouch.
 *
 *   bun bots/quests/zanaris-dlong.ts {botname}
 */
import { ActivitySession, BotSDK, deriveGatewayUrl, inEssenceMine as inEssenceMineCoords } from '../../sdk/index';
import { BotActions } from '../../sdk/actions';
import { initPathfinding } from '../../sdk/pathfinding';
import { closeUi, walkNear as stepNear } from './movement';
import { DRAYNOR_BANK, DWARVEN_STAIRS_UP, FALADOR_EAST_BANK } from './tiles';
import { existsSync, readFileSync } from 'fs';
import { dirname, join } from 'path';
import { installGracefulShutdown } from '../../sdk/runner';

const SHED = { x: 3203, z: 3169 };
const JAKUT = { x: 3252, z: 9572 };
const ZANARIS_BANK = { x: 3150, z: 9577 };
/** East market door. Jakut is on the far side; the doorman takes one cut diamond. */
const EAST_DOOR = { x: 3238, z: 9558 };
const EAST_OUTSIDE = { x: 3236, z: 9558 };
const ZANARIS_CROSS = { x: 3200, z: 9580 };
const VARROCK_EAST_BANK = { x: 3253, z: 3420 };
const TO_SHED = [
    { x: 3012, z: 3355 },
    { x: 3045, z: 3290 },
    { x: 3092, z: 3245 },
    { x: 3145, z: 3210 },
    { x: 3185, z: 3185 },
    SHED
];

/** 100k at full stock, 101k when one sword is left. */
const SWORD_COST = 110_000;
/** 30k at full stock, about 30.3k when one dagger is left. */
const DAGGER_COST = 35_000;
const TARGET_COINS = 2_000_000;
/** Unstackable. Enough for a few doorman tolls without eating the weapon slots. */
const DIAMOND_CARRY = 5;

const STAFF = /^dramen staff$/i;
const DIAMOND = /^diamond$/i;
const COINS = /^coins$/i;
const DLONG = /^dragon longsword$/i;
const DDAGGER = /^dragon dagger$/i;
const KEEP = /^(diamond|coins|dramen staff|dragon longsword|dragon dagger)$/i;

const argv = process.argv.slice(2);
const botArg = argv.find((a) => !a.startsWith('-'));
if (!botArg) throw new Error('Usage: bun bots/quests/zanaris-dlong.ts {botname}');

function loadBotEnv(): void {
    const envPath = existsSync(join(process.cwd(), 'bots', botArg!, 'bot.env'))
        ? join(process.cwd(), 'bots', botArg!, 'bot.env')
        : join(dirname(import.meta.path), 'bot.env');
    if (!existsSync(envPath)) {
        throw new Error(`bot.env not found at ${envPath}. Usage: bun bots/quests/zanaris-dlong.ts {botname}`);
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
    name: 'zanaris-dlong',
    grindLogPath: GRIND_LOG,
    stallMs: 12 * 60_000,
    maxRecoveryTactics: 8
});

installGracefulShutdown();

let swordsBought = 0;
let daggersBought = 0;

function log(msg: string): void {
    session.log('log', msg);
}

function pos() {
    const p = sdk.getState()?.player;
    return { x: p?.worldX ?? 0, z: p?.worldZ ?? 0, level: p?.level ?? 0, isDead: p?.isDead ?? false };
}

function distTo(x: number, z: number): number {
    return Math.hypot(pos().x - x, pos().z - z);
}

function count(pattern: RegExp): number {
    return sdk
        .getInventory()
        .filter((i) => pattern.test(i.name))
        .reduce((n, i) => n + (i.count ?? 1), 0);
}

function occupied(): number {
    return sdk.getInventory().filter((i) => (i.count ?? 0) > 0).length;
}

function invFull(): boolean {
    return occupied() >= 28;
}

function worn(pattern: RegExp): boolean {
    return !!sdk.findEquipmentItem(pattern);
}

function hasKit(): boolean {
    return worn(STAFF) && count(DIAMOND) >= 1;
}

function hasJunk(): boolean {
    return sdk.getInventory().some((i) => (i.count ?? 0) > 0 && !KEEP.test(i.name));
}

function holdingWeapons(): boolean {
    return count(DLONG) + count(DDAGGER) > 0;
}

/** Top up to 2M before a trip, and again once the pouch can't buy a dagger. */
function shouldTopUp(): boolean {
    if (count(COINS) >= TARGET_COINS) return false;
    if (count(COINS) < DAGGER_COST) return true;
    return !holdingWeapons();
}

function inZanaris(): boolean {
    const p = pos();
    return p.x >= 3050 && p.x <= 3400 && p.z >= 9400 && p.z < 9700;
}

function inDwarvenMine(): boolean {
    const p = pos();
    if (p.z < 9600 || p.z > 9920 || p.x < 2930 || p.x > 3072) return false;
    if (p.x >= 3014 && p.x <= 3058 && p.z <= 9755) return false;
    return true;
}

function onSurface(): boolean {
    const p = pos();
    return p.z < 9000 && !inEssenceMineCoords(p.x, p.z);
}

async function phase(name: string): Promise<void> {
    if (session.metrics().phase === name) return;
    await session.setPhase(name);
}

async function walkWaypoints(points: { x: number; z: number }[]): Promise<boolean> {
    const dest = points[points.length - 1]!;
    for (const point of points) {
        if (session.isStopped()) return false;
        if (distTo(point.x, point.z) <= 8) continue;
        if (Math.hypot(dest.x - point.x, dest.z - point.z) >= distTo(dest.x, dest.z) - 4) continue;
        session.setAnchor(point.x, point.z);
        await stepNear(bot, sdk, point.x, point.z, 6);
    }
    session.setAnchor(dest.x, dest.z);
    return stepNear(bot, sdk, dest.x, dest.z, 4) || distTo(dest.x, dest.z) <= 8;
}

async function climb(opt: RegExp): Promise<boolean> {
    const beforeZ = pos().z;
    await sdk.scanNearbyLocs(12).catch(() => {});
    const loc = (sdk.getNearbyLocs() ?? [])
        .filter((l) => /stair|ladder/i.test(l.name) && l.optionsWithIndex.some((o) => opt.test(o.text)))
        .sort((a, b) => (a.distance ?? 99) - (b.distance ?? 99))[0];
    if (!loc) return false;
    if ((loc.distance ?? 99) > 2) await stepNear(bot, sdk, loc.x, loc.z, 1);
    await bot.interactLoc(loc, opt);
    await sdk.waitForCondition(() => Math.abs(pos().z - beforeZ) > 8, 8_000).catch(() => {});
    return Math.abs(pos().z - beforeZ) > 8;
}

async function leaveDwarvenMine(): Promise<boolean> {
    for (let i = 0; i < 8 && inDwarvenMine(); i++) {
        await stepNear(bot, sdk, DWARVEN_STAIRS_UP.x, DWARVEN_STAIRS_UP.z, 2);
        await climb(/climb-up/i);
    }
    return !inDwarvenMine();
}

async function leaveEssenceMine(): Promise<boolean> {
    for (let attempt = 0; attempt < 6 && inEssenceMineCoords(pos().x, pos().z); attempt++) {
        await sdk.scanNearbyLocs(15).catch(() => {});
        const portal = (sdk.getNearbyLocs() ?? [])
            .filter((l) => /portal/i.test(l.name))
            .sort((a, b) => (a.distance ?? 99) - (b.distance ?? 99))[0];
        if (!portal) {
            await stepNear(bot, sdk, pos().x + 8, pos().z, 3);
            continue;
        }
        await bot.interactLoc(portal, /use|enter|exit/i);
        await sdk
            .waitForCondition(() => !inEssenceMineCoords(pos().x, pos().z), 8_000)
            .catch(() => {});
    }
    return !inEssenceMineCoords(pos().x, pos().z);
}

async function leaveUnderground(): Promise<boolean> {
    if (inZanaris() || onSurface()) return true;
    await phase('leave');
    if (inDwarvenMine()) {
        log(`Climbing out of the dwarven mine @ ${pos().x},${pos().z}`);
        return leaveDwarvenMine();
    }
    if (inEssenceMineCoords(pos().x, pos().z)) {
        log(`Leaving the essence mine @ ${pos().x},${pos().z}`);
        return leaveEssenceMine();
    }
    log(`Looking for a way up @ ${pos().x},${pos().z}`);
    for (let i = 0; i < 4 && !onSurface() && !inZanaris(); i++) {
        if (await climb(/climb-up|climb-down/i)) continue;
        break;
    }
    return onSurface() || inZanaris();
}

function nearestSurfaceBank(): { x: number; z: number } {
    const options = [FALADOR_EAST_BANK, DRAYNOR_BANK, VARROCK_EAST_BANK];
    return options.reduce((best, tile) => (distTo(tile.x, tile.z) < distTo(best.x, best.z) ? tile : best));
}

async function approach(x: number, z: number): Promise<boolean> {
    if (distTo(x, z) <= 6) return true;
    if (await stepNear(bot, sdk, x, z, 4)) return true;
    for (const [dx, dz] of [
        [2, 0],
        [-2, 0],
        [0, 2],
        [0, -2]
    ] as const) {
        if (await stepNear(bot, sdk, x + dx, z + dz, 2)) return distTo(x, z) <= 10;
    }
    return distTo(x, z) <= 10;
}

async function openTripBank(): Promise<boolean> {
    await closeUi(bot, sdk);
    const bank = inZanaris() ? ZANARIS_BANK : nearestSurfaceBank();
    session.setAnchor(bank.x, bank.z);
    if (inZanaris() && distTo(bank.x, bank.z) > 40) {
        await stepNear(bot, sdk, ZANARIS_CROSS.x, ZANARIS_CROSS.z, 6);
    }
    await approach(bank.x, bank.z);
    const opened = await bot.openBank();
    if (!opened.success) {
        session.noteFailure('bank', opened.message ?? `No bank @ ${pos().x},${pos().z}`);
        return false;
    }
    return true;
}

async function depositMatching(pattern: RegExp): Promise<number> {
    let deposited = 0;
    for (let i = 0; i < 28 && count(pattern) > 0; i++) {
        const before = count(pattern);
        await bot.depositItem(pattern, -1);
        const moved = before - count(pattern);
        if (moved <= 0) break;
        deposited += moved;
    }
    return deposited;
}

async function depositJunk(): Promise<void> {
    for (let i = 0; i < 28; i++) {
        const junk = sdk.getInventory().find((item) => (item.count ?? 0) > 0 && !KEEP.test(item.name));
        if (!junk) return;
        const result = await bot.depositItem(junk, -1);
        if (!result.success && sdk.getInventory().some((item) => item.id === junk.id)) return;
    }
}

async function withdrawKit(): Promise<boolean> {
    if (!worn(STAFF) && count(STAFF) < 1) {
        const withdrawn = await bot.withdrawItem(STAFF, 1);
        if (!withdrawn.success && count(STAFF) < 1) {
            session.stop('no_staff', 'Dramen staff is not in the bank');
            return false;
        }
        log('Withdrew dramen staff');
    }
    while (count(DIAMOND) < DIAMOND_CARRY && occupied() < 28) {
        const before = count(DIAMOND);
        if (!sdk.findBankItem(DIAMOND)) break;
        await bot.withdrawItem(DIAMOND, 1);
        if (count(DIAMOND) <= before) break;
    }
    if (count(DIAMOND) < 1) {
        const uncut = sdk.findBankItem(/^uncut diamond$/i);
        session.stop(
            'no_diamond',
            uncut ? 'Bank has an uncut diamond, not a cut diamond' : 'Cut diamond is not in the bank'
        );
        return false;
    }
    if (count(DIAMOND) > 0) log(`Cut diamonds in inventory: ${count(DIAMOND)}`);

    if (!(await withdrawCoins())) return false;
    return true;
}

function largestCoinStack(): { slot: number; id: number; name: string; count: number } | undefined {
    return (sdk.getState()?.bank.items ?? [])
        .filter((item) => COINS.test(item.name) && item.count > 0)
        .sort((a, b) => b.count - a.count)[0];
}

/** 2M uses the withdraw-X prompt, which sometimes never opens. Retry, then take the stack. */
async function withdrawCoins(): Promise<boolean> {
    for (let attempt = 1; attempt <= 4 && count(COINS) < TARGET_COINS; attempt++) {
        const have = count(COINS);
        const banked = largestCoinStack();
        if (!banked) break;
        const take = Math.min(TARGET_COINS - have, banked.count);
        const withdrawn = await bot.withdrawItem(banked, take);
        const gained = count(COINS) - have;
        if (gained > 0) {
            log(`Withdrew ${gained} coins (now ${count(COINS)})`);
            continue;
        }
        log(`Coin withdraw attempt ${attempt} failed: ${withdrawn.message}`);
        const submitted = await sdk.sendCountDialog(take);
        if (submitted.success) {
            await sdk.waitForCondition(() => count(COINS) > have, 5_000).catch(() => {});
            if (count(COINS) > have) {
                log(`Withdrew ${count(COINS) - have} coins from the amount prompt (now ${count(COINS)})`);
            }
        }
        await sdk.waitForTicks(2);
    }

    if (count(COINS) < TARGET_COINS) {
        const have = count(COINS);
        const banked = largestCoinStack();
        if (banked && banked.count > have) {
            log(`Withdraw-X missed, taking the coin stack of ${banked.count}`);
            await bot.withdrawItem(banked, -1);
            const gained = count(COINS) - have;
            if (gained > 0) log(`Withdrew ${gained} coins (now ${count(COINS)})`);
        }
    }

    if (count(COINS) > TARGET_COINS) {
        const extra = count(COINS) - TARGET_COINS;
        const deposited = await bot.depositItem(COINS, extra);
        if (count(COINS) > TARGET_COINS && !deposited.success) {
            log(`Keeping ${count(COINS)} coins; could not deposit the extra ${extra}: ${deposited.message}`);
        } else {
            log(`Put back extra coins (now ${count(COINS)})`);
        }
    }

    if (count(COINS) < DAGGER_COST) {
        session.stop('no_coins', `Need ${DAGGER_COST} gp for a dragon dagger, have ${count(COINS)}`);
        return false;
    }
    return true;
}

async function bankTrip(depositWeapons: boolean): Promise<boolean> {
    await phase('bank');
    if (!(await openTripBank())) return false;
    if (depositWeapons) {
        const swords = await depositMatching(DLONG);
        const daggers = await depositMatching(DDAGGER);
        const deposited = swords + daggers;
        if (deposited > 0) {
            session.recordTrip(deposited);
            log(`Banked ${swords} dragon longswords and ${daggers} dragon daggers`);
            session.noteProgress('bank', `${deposited} dragon weapons`);
        }
    }
    await depositJunk();
    const ok = await withdrawKit();
    session.captureBankStock();
    await bot.closeBank();
    if (!ok || session.isStopped()) return false;
    if (!worn(STAFF)) {
        const equipped = await bot.equipItem(STAFF);
        if (!equipped.success) {
            session.stop('no_staff', equipped.message ?? 'Could not wield the dramen staff');
            return false;
        }
        log('Wielded dramen staff');
    }
    if (hasJunk()) {
        if (await openTripBank()) {
            await depositJunk();
            await bot.closeBank();
        }
    }
    log(
        `Kit staff=${worn(STAFF)} diamond=${count(DIAMOND)} coins=${count(COINS)} swords=${count(DLONG)} daggers=${count(DDAGGER)} @ ${pos().x},${pos().z}`
    );
    return hasKit() && count(COINS) >= DAGGER_COST;
}

async function enterZanaris(): Promise<boolean> {
    if (inZanaris()) return true;
    if (!worn(STAFF)) return false;
    await phase('shed');
    log(`Walking to the Lumbridge swamp shed from ${pos().x},${pos().z}`);
    await walkWaypoints(TO_SHED);
    if (inZanaris()) {
        log(`Entered Zanaris @ ${pos().x},${pos().z}`);
        session.noteProgress('location', 'zanaris');
        return true;
    }
    if (distTo(SHED.x, SHED.z) > 8) {
        session.noteFailure('shed', `Could not reach the shed @ ${pos().x},${pos().z}`);
        return false;
    }
    for (let i = 0; i < 6 && !inZanaris() && !session.isStopped(); i++) {
        await closeUi(bot, sdk);
        await sdk.scanNearbyLocs(10).catch(() => {});
        const door = (sdk.getNearbyLocs() ?? [])
            .filter((l) => /door/i.test(l.name))
            .sort((a, b) => (a.distance ?? 99) - (b.distance ?? 99))[0];
        if (!door) {
            await stepNear(bot, sdk, SHED.x, SHED.z, 1);
            continue;
        }
        await bot.interactLoc(door, /open/i);
        await sdk.waitForCondition(() => inZanaris(), 8_000).catch(() => {});
        if (!inZanaris()) await stepNear(bot, sdk, door.x + (i % 2 === 0 ? 1 : -1), door.z, 1);
    }
    if (!inZanaris()) {
        session.noteFailure('shed', `Shed did not open Zanaris @ ${pos().x},${pos().z}`);
        return false;
    }
    log(`Entered Zanaris @ ${pos().x},${pos().z}`);
    session.noteProgress('location', 'zanaris');
    return true;
}

async function answerDoorman(): Promise<void> {
    for (let i = 0; i < 8; i++) {
        const dialog = sdk.getDialog();
        if (!dialog?.isOpen) return;
        const blob = `${dialog.text ?? ''} ${dialog.options.map((option) => option.text).join(' ')}`;
        if (!/okay|diamond|trading tax/i.test(blob)) return;
        const okay = dialog.options.find((option) => /^okay/i.test(option.text));
        if (okay) {
            if (count(DIAMOND) < 1) return;
            const before = count(DIAMOND);
            await sdk.clickDialogByText(/^okay/i);
            await sdk.waitForTicks(3);
            if (count(DIAMOND) < before) log(`Paid the doorman a diamond (${count(DIAMOND)} left)`);
            continue;
        }
        await sdk.sendClickDialog(dialog.options[0]?.index ?? 0);
        await sdk.waitForTicks(1);
    }
}

/** Pay the east gate. Standing west of it is outside; Jakut is to the east. */
async function enterMarket(): Promise<void> {
    if (sdk.findNearbyNpc(/^jakut$/i) || distTo(JAKUT.x, JAKUT.z) <= 10) return;
    await answerDoorman();
    if (pos().x > EAST_DOOR.x) return;
    if (distTo(EAST_OUTSIDE.x, EAST_OUTSIDE.z) > 2) {
        await stepNear(bot, sdk, EAST_OUTSIDE.x, EAST_OUTSIDE.z, 1);
        await answerDoorman();
    }
    if (pos().x > EAST_DOOR.x) return;
    await sdk.scanNearbyLocs(8).catch(() => {});
    const door = (sdk.getNearbyLocs() ?? [])
        .filter((loc) => /door/i.test(loc.name) && Math.hypot(loc.x - EAST_DOOR.x, loc.z - EAST_DOOR.z) <= 2)
        .sort((a, b) => (a.distance ?? 99) - (b.distance ?? 99))[0];
    if (!door) return;
    const open = door.optionsWithIndex.find((option) => /^open$/i.test(option.text));
    if (open) await sdk.sendInteractLoc(door.x, door.z, door.id, open.opIndex);
    else await bot.interactLoc(door, /open/i);
    await sdk.waitForTicks(3);
    await answerDoorman();
}

async function goToJakut(): Promise<boolean> {
    if (sdk.findNearbyNpc(/^jakut$/i)) return true;
    await phase('shop');
    await enterMarket();
    await stepNear(bot, sdk, JAKUT.x, JAKUT.z, 4);
    await answerDoorman();
    return !!sdk.findNearbyNpc(/^jakut$/i) || distTo(JAKUT.x, JAKUT.z) <= 8;
}

let loggedShop = false;

async function openJakut(): Promise<boolean> {
    if (sdk.getState()?.shop?.isOpen) return true;
    if (!(await goToJakut())) {
        session.noteFailure('shop', `Jakut not visible @ ${pos().x},${pos().z}`);
        return false;
    }
    const opened = await bot.openShop(/^jakut$/i);
    if (!opened.success && sdk.getDialog()?.isOpen) {
        await sdk.clickDialogByText(/yes please/i);
        await sdk.waitForCondition((s) => s.shop.isOpen, 8_000).catch(() => {});
    }
    if (!sdk.getState()?.shop?.isOpen) {
        session.noteFailure('shop', opened.message ?? 'Jakut shop did not open');
        return false;
    }
    if (!loggedShop) {
        loggedShop = true;
        const items = sdk.getState()?.shop?.shopItems ?? [];
        log(
            `Shop ${sdk.getState()?.shop?.title}: ${items.map((item) => `${item.name} x${item.count}`).join(', ') || 'empty'}`
        );
    }
    return true;
}

function shopCount(pattern: RegExp): number {
    return sdk.getState()?.shop?.shopItems?.find((item) => pattern.test(item.name))?.count ?? 0;
}

async function buyOne(pattern: RegExp, label: string): Promise<'bought' | 'bank' | 'retry'> {
    await phase('buy');
    const before = count(pattern);
    const bought = await bot.buyFromShop(pattern, 1);
    const gained = count(pattern) - before;
    if (gained > 0) {
        if (pattern === DLONG) swordsBought += gained;
        else daggersBought += gained;
        const n = pattern === DLONG ? swordsBought : daggersBought;
        log(
            `Bought ${label} #${n} inv=${occupied()}/28 coins=${count(COINS)} stock=${shopCount(pattern)}`
        );
        session.noteProgress('shop', label);
        return 'bought';
    }
    const message = bought.message ?? 'buy failed';
    if (/coin|space|inventory/i.test(message)) return 'bank';
    session.noteFailure('buy', message);
    await sdk.waitForTicks(2);
    return 'retry';
}

async function buyUntilNeedBank(): Promise<void> {
    let emptyPolls = 0;
    while (!session.isStopped()) {
        if (session.needsRecovery()) return;
        if (invFull()) return;
        if (!(await openJakut())) return;
        const swords = shopCount(DLONG);
        const daggers = shopCount(DDAGGER);
        const coins = count(COINS);
        if (swords > 0 && coins >= SWORD_COST) {
            const result = await buyOne(DLONG, 'dragon longsword');
            if (result === 'bank') return;
            emptyPolls = 0;
            continue;
        }
        if (swords > 0 && coins < SWORD_COST) return;
        if (daggers > 0 && coins >= DAGGER_COST) {
            const result = await buyOne(DDAGGER, 'dragon dagger');
            if (result === 'bank') return;
            emptyPolls = 0;
            continue;
        }
        if (coins < DAGGER_COST) return;
        await phase('wait-stock');
        emptyPolls++;
        if (emptyPolls === 1 || emptyPolls % 20 === 0) {
            log(
                `Waiting for Jakut stock swords=${swords} daggers=${daggers} inv=${occupied()}/28 coins=${coins}`
            );
        }
        if (emptyPolls % 15 === 0) await bot.closeShop();
        await sdk.waitForTicks(5);
    }
}

try {
    await bot.skipTutorial();
    log(`Zanaris dlong start @ ${pos().x},${pos().z}`);
    if (!(await leaveUnderground())) {
        session.stop('stuck', `Could not leave ${pos().x},${pos().z}`);
    }

    while (!session.isStopped()) {
        if (session.needsRecovery()) {
            if ((await session.recover()) === 'exhausted') break;
            continue;
        }
        if (pos().isDead) {
            await sdk.waitForCondition((s) => !s.player?.isDead, 45_000).catch(() => {});
            continue;
        }
        await answerDoorman();
        const depositWeapons =
            invFull() || (holdingWeapons() && count(COINS) < DAGGER_COST && occupied() >= 27);
        if (!inZanaris()) {
            if (!hasKit() || hasJunk() || shouldTopUp() || invFull()) {
                if (!(await bankTrip(depositWeapons))) continue;
            }
            if (!(await enterZanaris())) continue;
            continue;
        }
        if (!hasKit() || hasJunk() || invFull() || shouldTopUp()) {
            if (!(await bankTrip(depositWeapons))) continue;
            continue;
        }
        await buyUntilNeedBank();
    }

    const stop = session.metrics().stopReason;
    if (stop) log(`stopped ${stop.code} @ ${stop.location.x},${stop.location.z}`);
} catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('Script error:', err);
    session.stopRestartable('script_error', message);
} finally {
    await session.finalizeStop();
    console.log('Disconnecting SDK; game client can stay open.');
    await sdk.disconnect();
}
