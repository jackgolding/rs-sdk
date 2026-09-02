import { BotSDK, deriveGatewayUrl } from '../../sdk/index';
import { BotActions } from '../../sdk/actions';
import { initPathfinding } from '../../sdk/pathfinding';
import { readFileSync, appendFileSync } from 'fs';
import { dirname, join } from 'path';

const TARGET_LEVEL = 99;
const KEEP_FOOD = 10;
const PACK_SLOTS = 26;
const KEBAB_WANT = 6;
// Don't leave warriors for Karim while we still have a buffer of food.
const RESTOCK_FOOD_BELOW = 2;

const LUMBRIDGE_MEN = { x: 3222, z: 3218 };
const ALKHARID_GATE = { x: 3267, z: 3228 };
// East inner room of the palace — quieter than the south courtyard
const ALKHARID_WARRIORS = { x: 3301, z: 3166 };
const ALKHARID_WARRIOR_EAST_X = 3298;
const KEBAB_SELLER = { x: 3273, z: 3180 };
const ALKHARID_BANK = { x: 3268, z: 3167 };
const ARDOUGNE_MARKET = { x: 2662, z: 3312 };
const CAKE_SAFE = { x: 2669, z: 3310 };
const CAKE_STALL = { x: 2667, z: 3310 };
const CAKE_STALL_WEST = { x: 2655, z: 3311 };
// West side of the east stall — spam from here when the baker is in the safe-tile pocket.
const CAKE_SPAM = { x: 2666, z: 3310 };
const CAKE_SPOTS: { x: number; z: number; stall: { x: number; z: number }; name: string }[] = [
    { x: 2669, z: 3310, stall: CAKE_STALL, name: 'east-safe' },
    { x: 2669, z: 3312, stall: CAKE_STALL, name: 'east-north corner' },
    { x: 2668, z: 3308, stall: CAKE_STALL, name: 'east-south corner' },
    { x: 2670, z: 3309, stall: CAKE_STALL, name: 'east-se' },
    { x: 2656, z: 3310, stall: CAKE_STALL_WEST, name: 'west-se' },
    { x: 2653, z: 3310, stall: CAKE_STALL_WEST, name: 'west-sw corner' },
    { x: 2655, z: 3309, stall: CAKE_STALL_WEST, name: 'west-south' },
    { x: 2656, z: 3312, stall: CAKE_STALL_WEST, name: 'west-ne' }
];
const GEM_STALL = { x: 2669, z: 3303 };
const KNIGHTS = { x: 2652, z: 3318 };
const HOUSE_DOOR = { x: 2672, z: 3311 };
const HOUSE_DOOR_SOUTH = { x: 2672, z: 3305 };
const HOUSE_INSIDE = { x: 2674, z: 3309 };
const HOUSE_STAND = { x: 2674, z: 3311 };
const HOUSE_OUTSIDE = { x: 2669, z: 3311 };
const PALADINS = { x: 2653, z: 3315 };
const HEROES = { x: 2630, z: 3288 };
const SILK_MERCHANT = { x: 2656, z: 3301 };
const SILK_STALL = { x: 2658, z: 3314 };
const ARDOUGNE_BANK = { x: 2655, z: 3283 };
const DRAYNOR_BANK = { x: 3092, z: 3243 };
const BRIMHAVEN_CUSTOMS = { x: 2772, z: 3225 };
const MUSA_TO_BRIMHAVEN = [
    { x: 2864, z: 3154 },
    { x: 2812, z: 3176 },
    { x: 2772, z: 3225 }
];

const ARDOUGNE_WAYPOINTS = [
    { x: 3094, z: 3245 },
    { x: 2946, z: 3224 },
    { x: 2805, z: 3178 },
    { x: 2695, z: 3170 },
    { x: 2662, z: 3312 }
];

function loadBotEnv(): void {
    const envPath = join(dirname(import.meta.path), 'bot.env');
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
const GRIND_LOG = join(dirname(import.meta.path), 'grind.log');

function log(msg: string): void {
    console.log(msg);
    try {
        appendFileSync(GRIND_LOG, `${new Date().toISOString()} ${msg}\n`);
    } catch {
        /* ignore */
    }
}

console.log('Warming pathfinder...');
initPathfinding();

const sdk = new BotSDK({
    botUsername: username,
    password,
    gatewayUrl: deriveGatewayUrl(server),
    autoLaunchBrowser: true,
    browserLaunchTimeout: 90_000,
    readyTimeout: 45_000,
    connectTimeout: 60_000,
    showChat: false
});

console.log('Opening/attaching the game client...');
await sdk.connect();
const bot = new BotActions(sdk);

let lastLoggedLevel = 0;
let cakeSpotIndex = 0;
let lastIntent = '';

function intent(msg: string): void {
    if (msg === lastIntent) return;
    lastIntent = msg;
    console.log(`> ${msg}`);
}

function thievingLevel(): number {
    return sdk.getSkill('Thieving')?.baseLevel ?? 1;
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
        inCombat: p?.combat?.inCombat ?? false
    };
}

function distTo(x: number, z: number): number {
    const p = pos();
    return Math.hypot(p.x - x, p.z - z);
}

function coinCount(): number {
    return sdk.findInventoryItem(/coins/i)?.count ?? 0;
}

function countItems(pattern: RegExp): number {
    return sdk.getInventory().filter((i) => pattern.test(i.name)).reduce((n, i) => n + i.count, 0);
}

function foodCount(): number {
    return countItems(/kebab|cake|bread|chocolate|slice|meat|shrimp|anchov/i);
}

function lootCount(): number {
    return countItems(/silk|sapphire|emerald|ruby|diamond|gem|spice|fur|silver/i);
}

async function clickYesOrContinue(): Promise<void> {
    for (let i = 0; i < 12; i++) {
        const dialog = sdk.getDialog();
        if (!dialog?.isOpen) {
            await new Promise((r) => setTimeout(r, 150));
            continue;
        }
        if (dialog.isWaiting) {
            await sdk.waitForTicks(1);
            continue;
        }
        const yes = dialog.options.find((o) => /yes/i.test(o.text));
        await sdk.sendClickDialog(yes?.index ?? 0);
        await sdk.waitForTicks(1);
    }
}

async function walkNear(x: number, z: number, tolerance = 8): Promise<boolean> {
    if (distTo(x, z) <= tolerance) return true;
    const result = await bot.walkTo(x, z, Math.min(tolerance, 3));
    return result.success || distTo(x, z) <= tolerance + 2;
}

async function crossAlKharidGate(): Promise<void> {
    if (pos().x >= 3272) return;
    if (coinCount() < 10) {
        console.log('Need 10 gp for the toll — pickpocketing first');
        return;
    }
    console.log('Crossing Al Kharid toll gate (talk to Border Guard)...');
    await walkNear(ALKHARID_GATE.x, ALKHARID_GATE.z, 3);
    const guard = sdk.findNearbyNpc(/^border guard$/i) ?? sdk.findNearbyNpc(/border guard/i);
    if (!guard) {
        console.log('No Border Guard nearby');
        return;
    }
    await bot.talkTo(guard);
    await clickYesOrContinue();
    for (let i = 0; i < 20 && pos().x < 3272; i++) {
        if (sdk.getDialog()?.isOpen) await clickYesOrContinue();
        await sdk.waitForTicks(1);
    }
    if (pos().x < 3272) {
        console.log(`Still west of the gate at ${pos().x},${pos().z}`);
    } else {
        console.log(`Through the gate at ${pos().x},${pos().z}`);
    }
}

async function leaveAlKharid(): Promise<void> {
    if (pos().x < 3272) return;
    if (coinCount() < 10) {
        console.log('Need 10 gp to leave through the toll');
        return;
    }
    console.log('Leaving Al Kharid through the toll gate...');
    await walkNear(3278, 3228, 4);
    const guard = sdk.findNearbyNpc(/^border guard$/i) ?? sdk.findNearbyNpc(/border guard/i);
    if (!guard) {
        console.log('No Border Guard on the Al Kharid side');
        return;
    }
    await bot.talkTo(guard);
    await clickYesOrContinue();
    for (let i = 0; i < 25 && pos().x >= 3272; i++) {
        if (sdk.getDialog()?.isOpen) await clickYesOrContinue();
        await sdk.waitForTicks(1);
    }
    console.log(`After toll: (${pos().x},${pos().z})`);
}

function inArdougne(): boolean {
    const p = pos();
    return p.x < 2750 && p.x > 2500 && p.z > 3240;
}

function onKaramja(): boolean {
    const p = pos();
    return p.x > 2680 && p.x < 3010 && p.z > 3040 && p.z < 3270;
}

async function clickBoatDialog(): Promise<void> {
    for (let i = 0; i < 20; i++) {
        const dialog = sdk.getDialog();
        if (!dialog?.isOpen) {
            await new Promise((r) => setTimeout(r, 200));
            continue;
        }
        if (dialog.isWaiting) {
            await sdk.waitForTicks(1);
            continue;
        }
        const opts = dialog.options ?? [];
        const pick =
            opts.find((o) => /search away|nothing to hide/i.test(o.text)) ||
            opts.find((o) => /^ok\.?$/i.test(o.text)) ||
            opts.find((o) => /yes please|journey|ship/i.test(o.text)) ||
            opts.find((o) => /yes/i.test(o.text) && !/crandor|bother|miss/i.test(o.text));
        log(`Boat dialog -> ${pick?.text ?? 'continue'} (${opts.map((o) => o.text).join(' | ')})`);
        await sdk.sendClickDialog(pick?.index ?? 0);
        await sdk.waitForTicks(1);
    }
}

async function crossGangplank(): Promise<void> {
    const plank = sdk.findNearbyLoc(/gangplank/i);
    if (!plank) return;
    const opt = plank.optionsWithIndex.find((o) => /cross|board/i.test(o.text));
    log(`Crossing gangplank`);
    if (opt) await sdk.sendInteractLoc(plank.x, plank.z, plank.id, opt.opIndex);
    else await bot.interactLoc(plank, /cross|board/i);
    await sdk.waitForTicks(5);
}

async function karamjaToArdougne(): Promise<void> {
    if (inArdougne()) return;
    if (!onKaramja()) return;

    if (pos().x >= 2815) {
        log('On Musa Point — walking west to Brimhaven (do not talk to Musa customs)');
        for (const wp of MUSA_TO_BRIMHAVEN) {
            if (inArdougne() || pos().x < 2815) break;
            await walkNear(wp.x, wp.z, 8);
        }
        await walkNear(BRIMHAVEN_CUSTOMS.x, BRIMHAVEN_CUSTOMS.z, 5);
    }

    if (pos().x >= 2815) {
        log(`Still east of Brimhaven at (${pos().x},${pos().z})`);
        return;
    }

    log('Talking to Customs officer for the Ardougne boat (30gp)...');
    const officer = sdk.findNearbyNpc(/^customs officer$/i) ?? sdk.findNearbyNpc(/customs officer/i);
    if (!officer) {
        await walkNear(BRIMHAVEN_CUSTOMS.x, BRIMHAVEN_CUSTOMS.z, 4);
    }
    const customs = sdk.findNearbyNpc(/^customs officer$/i) ?? sdk.findNearbyNpc(/customs officer/i);
    if (!customs) {
        log('No Customs officer at Brimhaven');
        return;
    }
    const startX = pos().x;
    await bot.talkTo(customs);
    await clickBoatDialog();
    for (let i = 0; i < 40 && !inArdougne(); i++) {
        await crossGangplank();
        if (sdk.getDialog()?.isOpen) await clickBoatDialog();
        if (Math.abs(pos().x - startX) > 40) break;
        await sdk.waitForTicks(2);
    }
    log(`After Brimhaven boat: (${pos().x},${pos().z})`);
}

async function walkToArdougne(): Promise<void> {
    if (distTo(ARDOUGNE_MARKET.x, ARDOUGNE_MARKET.z) < 40) return;
    log('Walking to East Ardougne (land route)...');
    const direct = await bot.walkTo(ARDOUGNE_MARKET.x, ARDOUGNE_MARKET.z);
    if (direct.success || distTo(ARDOUGNE_MARKET.x, ARDOUGNE_MARKET.z) < 40) return;
    for (const wp of ARDOUGNE_WAYPOINTS) {
        await walkNear(wp.x, wp.z, 10);
    }
}

async function reachArdougneMarket(): Promise<void> {
    if (distTo(ARDOUGNE_MARKET.x, ARDOUGNE_MARKET.z) < 25) return;
    // Only disembark if we are still on the ship (south of the dock tiles).
    if (pos().z < 3271 && sdk.findNearbyLoc(/gangplank/i)) {
        log('Leaving the Ardougne docks');
        await crossGangplank();
        await sdk.waitForTicks(3);
    }
    await walkNear(ARDOUGNE_MARKET.x, ARDOUGNE_MARKET.z, 8);
}

async function dropJunk(): Promise<void> {
    const junk = sdk.getInventory().filter((i) =>
        /bones|ashes|beer|jug|vial|empty|cabbage|onion|potato|logs/i.test(i.name)
    );
    for (const item of junk.slice(0, 8)) {
        await bot.dropItem(item, 'all');
    }
}

async function bankValuables(bankSpot: { x: number; z: number }): Promise<void> {
    const gp = coinCount();
    const loot = lootCount();
    if (gp < 400 && loot === 0) {
        if (sdk.getInventory().length >= 26) await dropJunk();
        return;
    }

    console.log(`Banking at (${bankSpot.x},${bankSpot.z}) — ${gp} gp, ${loot} loot stacks`);
    intent('Banking coins and loot');
    await walkNear(bankSpot.x, bankSpot.z, 6);
    const opened = await bot.openBank();
    if (!opened.success) {
        console.log(`openBank failed: ${opened.message}`);
        return;
    }
    const keepGp = Math.min(coinCount(), 50);
    if (coinCount() > 50) await bot.depositItem(/coins/i, coinCount() - 50);
    if (keepGp === 0 && coinCount() === 0) {
        await bot.withdrawItem(/coins/i, 50).catch(() => {});
    }
    await bot.depositItem(/silk|sapphire|emerald|ruby|diamond|uncut|spice|fur|silver/i, -1);
    const keepFood = Math.min(foodCount(), KEEP_FOOD);
    if (foodCount() > keepFood) {
        await bot.depositItem(/kebab|cake|bread|chocolate|slice/i, -1);
        const short = KEEP_FOOD - foodCount();
        if (short > 0) await bot.withdrawItem(/^cake$/i, short).catch(() => {});
    }
    await bot.closeBank();
}

async function buyKebabs(want = KEBAB_WANT): Promise<void> {
    if (foodCount() >= RESTOCK_FOOD_BELOW || coinCount() < 2) return;
    console.log('Buying kebabs...');
    await walkNear(KEBAB_SELLER.x, KEBAB_SELLER.z, 4);
    const seller = sdk.findNearbyNpc(/kebab/i);
    if (!seller) return;
    const needed = want - foodCount();
    for (let n = 0; n < needed && coinCount() >= 1; n++) {
        await bot.talkTo(seller);
        await clickYesOrContinue();
        await sdk.waitForTicks(1);
    }
}

async function stealCakes(want = 4): Promise<void> {
    if (foodCount() >= want) return;
    console.log('Stealing cakes...');
    await walkNear(CAKE_SAFE.x, CAKE_SAFE.z, 2);
    for (let i = 0; i < 8 && foodCount() < want; i++) {
        await bot.dismissBlockingUI();
        const stall =
            (sdk.getNearbyLocs() ?? []).find(
                (l) => l.x === CAKE_STALL.x && l.z === CAKE_STALL.z && l.optionsWithIndex.some((o) => /steal/i.test(o.text))
            ) ?? sdk.findNearbyLoc(/baker'?s stall|cake stall|stall/i, { withOption: /steal/i });
        if (!stall) break;
        await bot.interactLoc(stall, /steal/i);
        await sdk.waitForTicks(3);
    }
}

async function stealGems(): Promise<boolean> {
    if (sdk.getInventory().length >= 26) return false;
    await walkNear(GEM_STALL.x, GEM_STALL.z, 3);
    const stall = sdk.findNearbyLoc(/gem stall/i, { withOption: /steal/i }) ?? sdk.findNearbyLoc(/gem stall/i);
    if (!stall) return false;
    const before = sdk.getInventory().length;
    const result = await bot.interactLoc(stall, /steal/i);
    await sdk.waitForTicks(3);
    return result.success || sdk.getInventory().length > before;
}

async function stealSilk(want = 4): Promise<void> {
    if (countItems(/silk/i) >= want) return;
    if (sdk.getInventory().length >= 26) return;
    await walkNear(SILK_STALL.x, SILK_STALL.z, 2);
    for (let i = 0; i < 8 && countItems(/silk/i) < want && sdk.getInventory().length < 26; i++) {
        await bot.dismissBlockingUI();
        const stall =
            sdk.findNearbyLoc(/silk stall/i, { withOption: /steal/i }) ??
            (sdk.getNearbyLocs() ?? []).find(
                (l) => l.x === SILK_STALL.x && l.z === SILK_STALL.z && l.optionsWithIndex.some((o) => /steal/i.test(o.text))
            );
        if (!stall) break;
        await bot.interactLoc(stall, /steal/i);
        await sdk.waitForTicks(3);
    }
}

async function sellSilk(): Promise<void> {
    if (countItems(/silk/i) === 0) return;
    console.log('Selling silk to the merchant...');
    await walkNear(SILK_MERCHANT.x, SILK_MERCHANT.z, 4);
    const merchant = sdk.findNearbyNpc(/silk/i);
    if (!merchant) return;
    while (countItems(/silk/i) > 0) {
        await bot.talkTo(merchant);
        for (let i = 0; i < 16; i++) {
            const dialog = sdk.getDialog();
            if (!dialog?.isOpen) {
                await new Promise((r) => setTimeout(r, 150));
                continue;
            }
            const sell = dialog.options.find((o) => /sell|yes|60|sure/i.test(o.text));
            await sdk.sendClickDialog(sell?.index ?? 0);
            await sdk.waitForTicks(1);
        }
        if (sdk.getDialog()?.isOpen) await bot.closeInterface();
        if (countItems(/silk/i) === 0) break;
        await sdk.waitForTicks(1);
    }
}

async function eatIfNeeded(): Promise<void> {
    const { hp, maxHp } = pos();
    // `hp > 14 && hp > 65%` never holds at 10 max HP, so the old check ate
    // every tick (including at full HP) and then restocked kebabs.
    if (hp >= maxHp) return;
    const eatBelow = Math.min(maxHp - 1, Math.max(7, Math.floor(maxHp * 0.65)));
    if (hp > eatBelow) return;
    const food = sdk.findInventoryItem(/kebab|cake|bread|chocolate|slice|meat|shrimp/i);
    if (!food) return;
    console.log(`Eating ${food.name} at ${hp} hp`);
    intent(`Eating ${food.name} (${hp} hp)`);
    await bot.eatFood(food);
}

function inHouse(x: number, z: number): boolean {
    return x >= 2672 && x <= 2676 && z >= 3306 && z <= 3312;
}

function knights(): ReturnType<typeof sdk.getNearbyNpcs> {
    return (sdk.getNearbyNpcs() ?? []).filter((n) => /^knight of ardougne$/i.test(n.name));
}

function knightInHouse() {
    return (
        knights()
            .filter((n) => inHouse(n.tileX ?? n.x, n.tileZ ?? n.z))
            .sort((a, b) => (a.distance ?? 99) - (b.distance ?? 99))[0] ?? null
    );
}

function playerInHouse(): boolean {
    return (sdk.getNearbyPlayers() ?? []).some((p) => inHouse(p.worldX ?? p.x ?? 0, p.worldZ ?? p.z ?? 0));
}

async function closeDoorAt(x: number, z: number): Promise<void> {
    const door = (sdk.getNearbyLocs() ?? []).find((l) => l.x === x && l.z === z && /door|gate/i.test(l.name));
    if (!door) return;
    const close = door.optionsWithIndex.find((o) => /^close$/i.test(o.text));
    if (!close) return;
    if (distTo(x, z) > 2) await walkNear(x, z, 1);
    await sdk.sendInteractLoc(door.x, door.z, door.id, close.opIndex);
    await sdk.waitForTicks(2);
}

async function sealHouseDoors(): Promise<void> {
    await closeDoorAt(HOUSE_DOOR.x, HOUSE_DOOR.z);
    await closeDoorAt(HOUSE_DOOR_SOUTH.x, HOUSE_DOOR_SOUTH.z);
}

async function openHouseDoor(): Promise<void> {
    await walkNear(HOUSE_OUTSIDE.x, HOUSE_OUTSIDE.z, 1);
    const door = (sdk.getNearbyLocs() ?? []).find(
        (l) => l.x === HOUSE_DOOR.x && l.z === HOUSE_DOOR.z && /door|gate/i.test(l.name)
    );
    if (door) await bot.openDoor(door);
    else await bot.openDoor();
    await sdk.waitForTicks(2);
}

async function enterHouseAndSeal(): Promise<void> {
    if (!inHouse(pos().x, pos().z)) {
        await openHouseDoor();
        await walkNear(HOUSE_STAND.x, HOUSE_STAND.z, 1);
    } else if (distTo(HOUSE_STAND.x, HOUSE_STAND.z) > 1) {
        await walkNear(HOUSE_STAND.x, HOUSE_STAND.z, 0);
    }
    await sealHouseDoors();
}

async function recoverStun(): Promise<void> {
    await eatIfNeeded();
    await sdk.waitForTicks(6);
    await eatIfNeeded();
}

async function fleeGuards(): Promise<void> {
    if (!pos().inCombat) return;
    await eatIfNeeded();
    const trapped = knightInHouse();
    if (trapped) {
        intent('Combat — running to house stand tile');
        await sdk.sendWalk(HOUSE_STAND.x, HOUSE_STAND.z, true);
    } else {
        intent('Combat — breaking line of sight at cake stall');
        cakeSpotIndex = 0;
        await sdk.sendWalk(CAKE_SAFE.x, CAKE_SAFE.z, true);
    }
    await sdk.waitForTicks(4);
    await eatIfNeeded();
}

async function lureKnightIntoHouse(): Promise<boolean> {
    if (knightInHouse()) return true;
    if (foodCount() < 4) return false;
    intent('Luring a knight into the NE house');
    const knight =
        knights().sort((a, b) => (a.distance ?? 99) - (b.distance ?? 99))[0] ??
        sdk.findNearbyNpc(/^knight of ardougne$/i);
    if (!knight) return false;

    await openHouseDoor();
    await walkNear(HOUSE_INSIDE.x, HOUSE_INSIDE.z, 1);
    await eatIfNeeded();
    await bot.attack(knight, 4000).catch(() => {});
    await sdk.sendWalk(HOUSE_INSIDE.x, HOUSE_INSIDE.z, true);
    await sdk.waitForTicks(6);
    await eatIfNeeded();

    if (!knightInHouse()) {
        await sdk.sendWalk(HOUSE_OUTSIDE.x, HOUSE_OUTSIDE.z, true);
        await eatIfNeeded();
        return false;
    }

    await sealHouseDoors();
    await eatIfNeeded();
    for (let i = 0; i < 20 && pos().inCombat; i++) {
        await eatIfNeeded();
        await sdk.waitForTicks(2);
    }
    log(`Lure result: knight inside=${!!knightInHouse()} combat=${pos().inCombat}`);
    return !!knightInHouse();
}

async function pickpocketKnight(): Promise<'ok' | 'stunned' | 'fail' | 'none'> {
    let npc = knightInHouse();
    if (!npc && playerInHouse()) {
        intent('Joining the house trap');
        await enterHouseAndSeal();
        npc = knightInHouse();
    }
    if (!npc) {
        await lureKnightIntoHouse();
        npc = knightInHouse();
    }
    if (!npc) {
        intent('Waiting at the house for a trapped knight');
        await walkNear(HOUSE_OUTSIDE.x, HOUSE_OUTSIDE.z, 2);
        return 'none';
    }

    await enterHouseAndSeal();
    npc = knightInHouse() ?? npc;
    return pickpocketOne(npc);
}

function cakeCount(): number {
    return countItems(/^cake$/i);
}

const STARTER_GEAR =
    /bronze axe|tinderbox|fishing net|bucket|pot$|pickaxe|bronze dagger|bronze sword|wooden shield|shortbow|bronze arrow|air rune|mind rune|water rune|earth rune|body rune|shrimps/i;

async function pickupStarterGear(): Promise<number> {
    let picked = 0;
    for (let i = 0; i < 40; i++) {
        const item = (sdk.getGroundItems() ?? []).find((g) => STARTER_GEAR.test(g.name));
        if (!item) break;
        intent(`Picking up ${item.name}`);
        const result = await bot.pickupItem(item);
        if (result.success) {
            picked++;
            log(`Picked up ${item.name}`);
        } else {
            console.log(`Could not pick up ${item.name}: ${result.message}`);
            await sdk.waitForTicks(1);
        }
    }
    return picked;
}

async function bankStarterGear(): Promise<void> {
    const gear = () => sdk.getInventory().filter((i) => STARTER_GEAR.test(i.name));
    if (gear().length === 0) return;
    intent('Banking starter gear at Draynor');
    await walkNear(DRAYNOR_BANK.x, DRAYNOR_BANK.z, 6);
    const opened = await bot.openBank();
    if (!opened.success) {
        console.log(`openBank failed: ${opened.message}`);
        return;
    }
    for (const item of gear()) {
        const dep = await bot.depositItem(item, -1);
        log(`Banked ${item.name}: ${dep.success ? 'ok' : dep.message}`);
    }
    await bot.closeBank();
}

function bakerTile(): { x: number; z: number } | null {
    const baker = sdk.findNearbyNpc(/^baker$/i);
    if (!baker) return null;
    return { x: baker.tileX ?? baker.x, z: baker.tileZ ?? baker.z };
}

/** Baker in the pocket around the east safe tile (barrel/boxes/stall) — he can see us there. */
function bakerInSafeTriangle(): boolean {
    const baker = bakerTile();
    if (!baker) return false;
    return Math.max(Math.abs(baker.x - CAKE_SAFE.x), Math.abs(baker.z - CAKE_SAFE.z)) <= 1;
}

async function runToBankToReset(): Promise<void> {
    intent('Still in combat — running to bank to reset');
    await walkNear(ARDOUGNE_BANK.x, ARDOUGNE_BANK.z, 4);
    for (let i = 0; i < 25 && pos().inCombat; i++) {
        await eatIfNeeded();
        await sdk.waitForTicks(2);
    }
    await eatIfNeeded();
}

async function stealEastCakes(): Promise<void> {
    if (pos().inCombat) {
        await eatIfNeeded();
        if (distTo(CAKE_SAFE.x, CAKE_SAFE.z) > 1) {
            intent('Guards — back to the safe tile');
            await sdk.sendWalk(CAKE_SAFE.x, CAKE_SAFE.z, true);
            await sdk.waitForTicks(5);
        }
        if (pos().inCombat) await runToBankToReset();
        return;
    }

    const stand = bakerInSafeTriangle() ? CAKE_SPAM : CAKE_SAFE;
    if (stand === CAKE_SPAM) intent('Baker in the safe triangle — spamming the west side');
    else intent('Stealing cakes on the safe tile');

    if (distTo(stand.x, stand.z) > 0) {
        await sdk.sendWalk(stand.x, stand.z, true);
        await sdk.waitForTicks(2);
        if (distTo(stand.x, stand.z) > 1) await walkNear(stand.x, stand.z, 0);
    }

    const stall =
        (sdk.getNearbyLocs() ?? []).find(
            (l) =>
                l.x === CAKE_STALL.x &&
                l.z === CAKE_STALL.z &&
                l.optionsWithIndex.some((o) => /steal/i.test(o.text))
        ) ?? sdk.findNearbyLoc(/baker'?s stall/i, { withOption: /steal/i });
    if (!stall || (stall.x === CAKE_STALL_WEST.x && stall.z === CAKE_STALL_WEST.z)) {
        await sdk.waitForTicks(2);
        return;
    }
    const opt = stall.optionsWithIndex.find((o) => /steal/i.test(o.text));
    const before = foodCount();
    if (opt) await sdk.sendInteractLoc(stall.x, stall.z, stall.id, opt.opIndex);
    else await bot.interactLoc(stall, /steal/i);
    await sdk.waitForTicks(2);
    if (foodCount() > before) {
        console.log(
            `stole food @ ${stand === CAKE_SPAM ? 'west-spam' : 'east-safe'} | inv food ${foodCount()} cakes ${cakeCount()} | empty ${28 - sdk.getInventory().length}`
        );
    }
}

async function restockCakes(): Promise<void> {
    if (sdk.getInventory().length >= PACK_SLOTS && foodCount() >= 8) return;
    cakeSpotIndex = 0;
    console.log(`Filling pack with cakes (${foodCount()} food, ${sdk.getInventory().length} slots)`);
    intent(`Stealing cakes until the pack is full (${foodCount()} food)`);
    for (let i = 0; i < 80 && sdk.getInventory().length < PACK_SLOTS; i++) {
        await bot.dismissBlockingUI();
        await eatIfNeeded();
        await stealEastCakes();
    }
    cakeSpotIndex = 0;
    log(`Cake pack: ${foodCount()} food in ${sdk.getInventory().length} slots`);
}

async function bankCakesTrip(): Promise<number> {
    await fleeGuards();
    console.log(`Banking cakes — pack food ${foodCount()} cakes ${cakeCount()}`);
    await walkNear(ARDOUGNE_BANK.x, ARDOUGNE_BANK.z, 4);
    const opened = await bot.openBank();
    if (!opened.success) {
        console.log(`openBank failed: ${opened.message}`);
        return -1;
    }
    const keep = Math.min(foodCount(), KEEP_FOOD);
    if (foodCount() > keep) {
        await bot.depositItem(/^cake$/i, -1);
        await bot.depositItem(/chocolate slice|bread/i, -1);
        const short = KEEP_FOOD - foodCount();
        if (short > 0) await bot.withdrawItem(/^cake$/i, short).catch(() => {});
    }
    const banked = sdk.findBankItem(/^cake$/i)?.count ?? 0;
    log(`Bank cakes: ${banked} | keeping ${foodCount()} food in pack`);
    await bot.closeBank();
    return banked;
}

async function pickpocketOne(npc: NonNullable<ReturnType<typeof sdk.findNearbyNpc>>): Promise<'ok' | 'stunned' | 'fail'> {
    intent(`Pickpocketing ${npc.name}`);
    const result = await bot.pickpocketNpc(npc);
    const skill = sdk.getSkill('Thieving');
    console.log(
        `${result.success ? 'ok' : result.reason} ${npc.name} | Thieving ${skill?.baseLevel} (${skill?.experience} xp) | ${coinCount()} gp | HP ${pos().hp}`
    );
    if (result.reason === 'stunned') return 'stunned';
    return result.success ? 'ok' : 'fail';
}

async function handlePickpocket(result: 'ok' | 'stunned' | 'fail' | 'none', idle: string): Promise<void> {
    if (result === 'ok') return;
    if (result === 'stunned') {
        intent('Stunned — recovering');
        await recoverStun();
        return;
    }
    intent(idle);
    await sdk.waitForTicks(3);
}

async function pickpocketCitizen(): Promise<'ok' | 'stunned' | 'fail' | 'none'> {
    if (distTo(LUMBRIDGE_MEN.x, LUMBRIDGE_MEN.z) > 8) {
        intent('Walking to Lumbridge men');
        await walkNear(LUMBRIDGE_MEN.x, LUMBRIDGE_MEN.z, 4);
    }
    const npc =
        sdk.findNearbyNpc(/^man$/i, { reachable: true }) ??
        sdk.findNearbyNpc(/^woman$/i, { reachable: true }) ??
        sdk.findNearbyNpc(/^(man|woman)$/i);
    if (!npc) {
        await walkNear(LUMBRIDGE_MEN.x, LUMBRIDGE_MEN.z, 3);
        return 'none';
    }
    return pickpocketOne(npc);
}

async function pickpocketWarrior(): Promise<'ok' | 'stunned' | 'fail' | 'none'> {
    if (pos().x < 3272) {
        if (coinCount() < 10) {
            intent('Need 10gp for the Al Kharid toll — pickpocketing men');
            return pickpocketCitizen();
        }
        await crossAlKharidGate();
        if (pos().x < 3272) return 'fail';
    }
    await buyKebabs();
    if (distTo(ALKHARID_WARRIORS.x, ALKHARID_WARRIORS.z) > 8) {
        intent('Walking to Al Kharid warriors');
        await walkNear(ALKHARID_WARRIORS.x, ALKHARID_WARRIORS.z, 3);
    }
    const npc =
        sdk.findNearbyNpc(/^al-kharid warrior$/i, { reachable: true }) ??
        sdk.findNearbyNpc(/^al-kharid warrior$/i);
    if (!npc) return 'none';
    return pickpocketOne(npc);
}

try {
    lastLoggedLevel = thievingLevel();
    console.log(`Goal: Thieving ${TARGET_LEVEL} — men → warriors → house-trap knights.`);
    intent(`Skipping tutorial if needed (Thieving ${lastLoggedLevel})`);
    await bot.skipTutorial();
    const recovered = await pickupStarterGear();
    log(`Recovered ${recovered} starter items from the ground`);
    await bankStarterGear();
    lastLoggedLevel = thievingLevel();
    intent(`Thieving grind to ${TARGET_LEVEL} (now ${lastLoggedLevel})`);

    while (thievingLevel() < TARGET_LEVEL) {
        await bot.dismissBlockingUI();

        if (pos().isDead) {
            intent('Dead — waiting to respawn');
            await sdk.waitForCondition((s) => !s.player.isDead, 45_000).catch(() => {});
            continue;
        }

        await eatIfNeeded();

        const level = thievingLevel();
        if (level !== lastLoggedLevel) {
            log(`LEVEL UP Thieving ${level} | ${coinCount()} gp | food ${foodCount()}`);
            lastLoggedLevel = level;
        }

        if (level < 25) {
            await handlePickpocket(await pickpocketCitizen(), 'No man/woman nearby — waiting at Lumbridge castle');
            continue;
        }

        if (level < 55) {
            await handlePickpocket(await pickpocketWarrior(), 'No warrior nearby — waiting in the palace');
            continue;
        }

        await fleeGuards();
        if (pos().inCombat) {
            await eatIfNeeded();
            await sdk.waitForTicks(3);
            continue;
        }

        if (!inArdougne()) {
            intent('Traveling to East Ardougne');
            if (onKaramja()) await karamjaToArdougne();
            else {
                await leaveAlKharid();
                await walkToArdougne();
            }
            continue;
        }

        if (coinCount() >= 1200) await bankValuables(ARDOUGNE_BANK);

        if (sdk.getInventory().length < PACK_SLOTS || foodCount() < 8) {
            await restockCakes();
            continue;
        }

        const result = await pickpocketKnight();
        if (result === 'ok') continue;
        if (result === 'stunned') {
            intent('Stunned — eating in place');
            await recoverStun();
            continue;
        }

        intent('No trapped knight — waiting at the house');
        await walkNear(HOUSE_OUTSIDE.x, HOUSE_OUTSIDE.z, 2);
        await sdk.waitForTicks(3);
    }

    await bankValuables(ARDOUGNE_BANK);
    const done = sdk.getSkill('Thieving');
    console.log(`Finished: Thieving ${done?.baseLevel} (${done?.experience} xp) | ${coinCount()} gp | food ${foodCount()}`);
} catch (err) {
    console.error('Script error:', err);
    throw err;
} finally {
    console.log('Disconnecting SDK; browser client can stay open.');
    await sdk.disconnect();
}
