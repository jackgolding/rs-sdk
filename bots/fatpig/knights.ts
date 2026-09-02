import { BotSDK, deriveGatewayUrl } from '../../sdk/index';
import { BotActions } from '../../sdk/actions';
import { initPathfinding } from '../../sdk/pathfinding';
import { readFileSync, appendFileSync } from 'fs';
import { dirname, join } from 'path';

const PARTNER = 'Jackthief';
const TARGET_LEVEL = 99;
const RESTOCK_FOOD_BELOW = 1;
const INV_KEEP_FREE = 3;
const EAT_MISSING_HP = 14;
const MULE_FOOD = /^(tuna|swordfish|shark)$/i;
const WINE = /^jug of wine$/i;
const EMPTY_JUG = /^jug$/i;
const FOOD = /kebab|cake|bread|chocolate|slice|meat|shrimp|anchov|tuna|swordfish|lobster|shark|salmon|trout|pike|bass|herring|sardine|mackerel|wine/i;
const SLASH = /^(bronze |iron |steel |mithril |adamant |rune )?(axe|sword|scimitar|dagger|claws|battleaxe|longsword|2h sword)$|^knife$/i;

const HOUSE_DOOR = { x: 2672, z: 3311 };
const HOUSE_DOOR_SOUTH = { x: 2672, z: 3305 };
const HOUSE_STAND = { x: 2674, z: 3311 };
const HOUSE_OUTSIDE = { x: 2669, z: 3311 };
const ARDOUGNE_BANK = { x: 2655, z: 3283 };
const ARDOUGNE_MARKET = { x: 2662, z: 3312 };
const KNIGHTS = { x: 2652, z: 3318 };
const PALADINS = { x: 2653, z: 3315 };
const HEROES = { x: 2630, z: 3288 };
const CATHERBY_BANK = { x: 2808, z: 3443 };
/** West of Legends Guild and Keep Le Faye. Stay on the north road — do not cut east through locked house doors. */
const ARDY_TO_CATHERBY = [
    { x: 2662, z: 3336 },
    { x: 2662, z: 3375 },
    { x: 2695, z: 3375 },
    { x: 2726, z: 3485 },
    { x: 2758, z: 3477 },
    { x: 2788, z: 3460 },
    { x: 2808, z: 3443 }
];
const CATHERBY_TO_ARDY = [
    { x: 2788, z: 3460 },
    { x: 2758, z: 3477 },
    { x: 2726, z: 3485 },
    { x: 2695, z: 3375 },
    { x: 2662, z: 3375 },
    { x: 2662, z: 3336 },
    { x: 2662, z: 3312 }
];
const LUMBRIDGE_MEN = { x: 3222, z: 3218 };
const DRAYNOR_BANK = { x: 3092, z: 3243 };
const EDGEVILLE = { x: 3094, z: 3492 };
const BOBS_AXES = { x: 3232, z: 3203 };
/** Deserted Keep lever — pulls to East Ardougne (2562, 3311). */
const WILDY_LEVER = { x: 3154, z: 3924 };
const WILDY_TO_LEVER = [
    { x: 3088, z: 3525 },
    { x: 3102, z: 3610 },
    { x: 3110, z: 3700 },
    { x: 3125, z: 3790 },
    { x: 3140, z: 3865 },
    { x: 3154, z: 3924 }
];
const PORT_SARIM_DOCK = { x: 3029, z: 3217 };
const BRIMHAVEN_CUSTOMS = { x: 2772, z: 3225 };
const MUSA_TO_BRIMHAVEN = [
    { x: 2864, z: 3154 },
    { x: 2836, z: 3188 },
    { x: 2798, z: 3208 },
    { x: 2772, z: 3225 }
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
    showChat: true
});

console.log('Opening/attaching the game client...');
await sdk.connect();
const bot = new BotActions(sdk);

let lastIntent = '';
let lastLoggedLevel = 0;

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

function inArdougne(): boolean {
    const p = pos();
    return p.x > 2500 && p.x < 2720 && p.z > 3240 && p.z < 3355 && p.z < 6400;
}

function nearSeersCatherby(): boolean {
    const p = pos();
    return p.x >= 2700 && p.x <= 2870 && p.z >= 3320 && p.z < 3520 && p.z < 6400;
}

/** Keep Le Faye — giant bats behind the door at ~2752,3409. */
function inKeepLeFaye(): boolean {
    const p = pos();
    return p.x >= 2746 && p.x <= 2772 && p.z >= 3390 && p.z <= 3422 && p.z < 6400;
}

/** Mithril gates (2728,3349) and the courtyard north of them. */
function inLegendsGuild(): boolean {
    const p = pos();
    return p.x >= 2714 && p.x <= 2742 && p.z >= 3344 && p.z <= 3388 && p.z < 6400;
}

function onKaramja(): boolean {
    const p = pos();
    return p.x > 2680 && p.x < 3010 && p.z > 3040 && p.z < 3270;
}

function onMusa(): boolean {
    return onKaramja() && pos().x >= 2815;
}

function onDockedShip(): boolean {
    if (inArdougne()) return false;
    if (pos().level < 1) return false;
    const locs = sdk.getNearbyLocs() ?? [];
    return locs.some((l) => /gangplank|ship's (ladder|wheel)|anchor/i.test(l.name));
}

function inWilderness(): boolean {
    const p = pos();
    return p.z >= 3520 && p.z < 6400 && p.x >= 2944 && p.x < 3392;
}

function slashItem() {
    return (
        bot.findEquippedItem(SLASH) ??
        sdk.findInventoryItem(SLASH)
    );
}

function distTo(x: number, z: number): number {
    const p = pos();
    return Math.hypot(p.x - x, p.z - z);
}

function coinCount(): number {
    return sdk.findInventoryItem(/^coins$/i)?.count ?? 0;
}

function occupiedSlots(): number {
    return sdk.getInventory().filter((i) => (i.count ?? 0) > 0).length;
}

/** Un-noted tuna / swordfish / jug of wine. Never count sharks. */
function foodCount(): number {
    return sdk.getInventory().filter((i) => /^(tuna|swordfish)$/i.test(i.name) && i.count === 1).length
        + sdk.getInventory().filter((i) => WINE.test(i.name)).length
        + sdk.getInventory().filter((i) => /^(trout|pike|salmon|bass|lobster)$/i.test(i.name) && i.count === 1).length;
}

function notedFood() {
    return sdk.getInventory().filter((i) => MULE_FOOD.test(i.name) && i.count > 1);
}

function findEatFood() {
    const tuna = sdk.getInventory().find((i) => /^tuna$/i.test(i.name) && i.count === 1);
    const sword = sdk.getInventory().find((i) => /^swordfish$/i.test(i.name) && i.count === 1);
    const wine = sdk.getInventory().find((i) => WINE.test(i.name));
    if (tuna) return tuna;
    if (sword) return sword;
    if (wine) return wine;
    return sdk.getInventory().find((i) => /^(trout|pike|salmon|bass|lobster|cake)$/i.test(i.name) && i.count === 1) ?? null;
}

async function dropEmptyJugs(): Promise<void> {
    for (let n = 0; n < 28; n++) {
        const jug = sdk.findInventoryItem(EMPTY_JUG);
        if (!jug) return;
        await sdk.sendDropItem(jug.slot);
        await sdk.waitForTicks(1);
    }
}

async function consumeHeal(item: { name: string; slot: number; optionsWithIndex: { text: string; opIndex: number }[] }): Promise<void> {
    const drink = item.optionsWithIndex.find((o) => /drink/i.test(o.text));
    if (drink) {
        await sdk.sendUseItem(item.slot, drink.opIndex);
        await sdk.waitForTicks(2);
        await dropEmptyJugs();
        return;
    }
    await bot.eatFood(item);
    await dropEmptyJugs();
}

async function walkNear(x: number, z: number, tolerance = 6): Promise<boolean> {
    if (distTo(x, z) <= tolerance) return true;
    const result = await bot.walkTo(x, z, Math.min(tolerance, 3));
    return result.success || distTo(x, z) <= tolerance + 2;
}

async function eatIfNeeded(): Promise<void> {
    for (let n = 0; n < 6; n++) {
        const { hp, maxHp } = pos();
        if (maxHp - hp < EAT_MISSING_HP) return;
        const food = findEatFood();
        if (!food) return;
        console.log(`Eating ${food.name} at ${hp}/${maxHp} hp (missing ${maxHp - hp})`);
        intent(`Eating ${food.name} (${hp} hp)`);
        await consumeHeal(food);
    }
}

/** Interior of the market-east house. Door tiles (2672,3311) and (2672,3305) are NOT inside. */
function inHouse(x: number, z: number): boolean {
    return x >= 2673 && x <= 2676 && z >= 3307 && z <= 3311;
}

function onHouseDoorTile(): boolean {
    const p = pos();
    return p.x === 2672 && p.z >= 3304 && p.z <= 3312;
}

async function stepOffHouseDoor(): Promise<void> {
    if (!onHouseDoorTile()) return;
    intent('Stepping west off the locked/closed house door');
    await sdk.sendWalk(HOUSE_OUTSIDE.x, HOUSE_OUTSIDE.z, true);
    await sdk.waitForTicks(3);
    if (onHouseDoorTile()) await walkNear(HOUSE_OUTSIDE.x, HOUSE_OUTSIDE.z, 1);
}

function knights() {
    return (sdk.getNearbyNpcs() ?? []).filter((n) => /^knight of ardougne$/i.test(n.name));
}

function knightInHouse() {
    return (
        knights()
            .filter((n) => inHouse(n.tileX ?? n.x, n.tileZ ?? n.z))
            .sort((a, b) => (a.distance ?? 99) - (b.distance ?? 99))[0] ?? null
    );
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

async function enterHouseAndSeal(): Promise<boolean> {
    await stepOffHouseDoor();
    if (!inHouse(pos().x, pos().z)) {
        await openHouseDoor();
        const walked = await walkNear(HOUSE_STAND.x, HOUSE_STAND.z, 1);
        if (!walked || !inHouse(pos().x, pos().z)) {
            log(`Could not enter knight house @ ${pos().x},${pos().z} — skipping trap`);
            await stepOffHouseDoor();
            await walkNear(HOUSE_OUTSIDE.x, HOUSE_OUTSIDE.z, 1);
            return false;
        }
    } else if (distTo(HOUSE_STAND.x, HOUSE_STAND.z) > 1) {
        await walkNear(HOUSE_STAND.x, HOUSE_STAND.z, 1);
    }
    await sealHouseDoors();
    return inHouse(pos().x, pos().z);
}

async function leaveHouse(): Promise<void> {
    if (!inHouse(pos().x, pos().z) && !onHouseDoorTile()) return;
    await openHouseDoor();
    await walkNear(HOUSE_OUTSIDE.x, HOUSE_OUTSIDE.z, 1);
    await stepOffHouseDoor();
}

async function recoverStun(): Promise<void> {
    await eatIfNeeded();
    await sdk.waitForTicks(8);
    await eatIfNeeded();
}

function pick<T>(xs: T[]): T {
    return xs[Math.floor(Math.random() * xs.length)]!;
}

async function pm(text: string): Promise<void> {
    log(`(quiet) ${text}`);
}

function partnerPms(): string[] {
    return sdk
        .getNewChat({ types: [3] })
        .filter((m) => m.sender.toLowerCase().includes(PARTNER.toLowerCase()))
        .map((m) => m.text);
}

function logPick(result: { success: boolean; reason?: string }, npc: { name: string }): 'ok' | 'stunned' | 'fail' {
    const skill = sdk.getSkill('Thieving');
    console.log(
        `${result.success ? 'ok' : result.reason} ${npc.name} | Thieving ${skill?.baseLevel} (${skill?.experience} xp) | ${coinCount()} gp | food ${foodCount()} | HP ${pos().hp}`
    );
    if (result.reason === 'stunned') return 'stunned';
    return result.success ? 'ok' : 'fail';
}

function findPickNpc(pattern: RegExp) {
    return sdk.findNearbyNpc(pattern, { reachable: true }) ?? sdk.findNearbyNpc(pattern);
}

async function clickPickpocket(npc: { index: number; name: string }): Promise<'ok' | 'stunned' | 'fail'> {
    const fresh =
        (sdk.getNearbyNpcs() ?? []).find((n) => n.index === npc.index) ??
        findPickNpc(new RegExp(`^${npc.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i'));
    if (!fresh) return 'fail';
    const pickOpt = fresh.optionsWithIndex.find((o) => /pickpocket/i.test(o.text));
    if (!pickOpt) return 'fail';

    const xpBefore = sdk.getSkill('Thieving')?.experience ?? 0;
    const tickBefore = sdk.getState()?.tick ?? 0;
    await sdk.sendInteractNpc(fresh.index, pickOpt.opIndex);

    try {
        await sdk.waitForCondition((s) => {
            const xp = s.skills.find((sk) => sk.name === 'Thieving')?.experience ?? 0;
            if (xp > xpBefore) return true;
            for (const msg of s.gameMessages) {
                if (msg.tick <= tickBefore) continue;
                const t = msg.text.toLowerCase();
                if (
                    t.includes('stunned') ||
                    t.includes('caught') ||
                    t.includes('you fail to pick') ||
                    t.includes("you're stunned")
                ) {
                    return true;
                }
            }
            return false;
        }, 3_500);
    } catch {
        return 'fail';
    }

    if ((sdk.getSkill('Thieving')?.experience ?? 0) > xpBefore) return 'ok';
    return 'stunned';
}

async function spamPickpocket(
    findNpc: () => { index: number; name: string } | null | undefined,
    label: string
): Promise<'ok' | 'stunned' | 'fail' | 'none'> {
    let npc = findNpc();
    if (!npc) return 'none';
    intent(`Spamming ${label}`);
    let last: 'ok' | 'stunned' | 'fail' = 'fail';
    const until = Date.now() + 20_000;
    while (Date.now() < until) {
        if (pos().isDead) return last;
        if (foodCount() < RESTOCK_FOOD_BELOW) return last;
        if (sdk.getDialog()?.isOpen) await bot.dismissBlockingUI();
        if (!inHouse(pos().x, pos().z) && knightInHouse() && !/trapped/i.test(label)) {
            return last;
        }

        npc = findNpc();
        if (!npc) return last === 'fail' ? 'none' : last;

        last = await clickPickpocket(npc);
        logPick(
            { success: last === 'ok', reason: last === 'ok' ? undefined : last },
            npc
        );

        if (last === 'ok') {
            await eatIfNeeded();
            continue;
        }
        if (last === 'stunned') {
            await recoverStun();
            continue;
        }
    }
    return last;
}

async function pickpocketOpen(pattern: RegExp, spot: { x: number; z: number }, label: string): Promise<'ok' | 'stunned' | 'fail' | 'none'> {
    if (inHouse(pos().x, pos().z)) await leaveHouse();
    if (!findPickNpc(pattern)) {
        intent(`Walking to ${label}s`);
        await walkNear(spot.x, spot.z, 4);
    }
    return spamPickpocket(() => findPickNpc(pattern), label);
}

async function pickpocketBest(): Promise<'ok' | 'stunned' | 'fail' | 'none'> {
    await stepOffHouseDoor();

    if (knightInHouse()) {
        const entered = await enterHouseAndSeal();
        if (entered) return spamPickpocket(() => knightInHouse(), 'trapped knight');
    }

    if (inHouse(pos().x, pos().z) || onHouseDoorTile()) await leaveHouse();

    const level = thievingLevel();
    if (level >= 80) {
        if (!findPickNpc(/^hero$/i)) {
            intent('Walking to heroes');
            await walkNear(HEROES.x, HEROES.z, 4);
        }
        const r = await spamPickpocket(() => findPickNpc(/^hero$/i), 'hero');
        if (r !== 'none') return r;
        await sdk.waitForTicks(2);
        return 'none';
    }
    if (level >= 70) {
        const r = await pickpocketOpen(/^paladin$/i, PALADINS, 'paladin');
        if (r !== 'none') return r;
    }
    return pickpocketOpen(/^knight of ardougne$/i, KNIGHTS, 'knight');
}

async function dismissLegendsGuard(): Promise<void> {
    for (let i = 0; i < 16; i++) {
        const dialog = sdk.getDialog();
        if (!dialog?.isOpen) return;
        const opts = dialog.options ?? [];
        const pick =
            opts.find((o) => /ok thanks|it's ok thanks|some other time|no thanks/i.test(o.text)) ||
            opts.find((o) => /click here to continue/i.test(o.text));
        log(`Legends guard dialog -> ${pick?.text ?? 'continue'} (${opts.map((o) => o.text).join(' | ')})`);
        await sdk.sendClickDialog(pick?.index ?? 0);
        await sdk.waitForTicks(1);
    }
}

async function leaveLegendsGuild(): Promise<void> {
    if (!inLegendsGuild() && !sdk.getDialog()?.isOpen) return;
    intent('Leaving the Legends Guild gates — going around, not in');
    await dismissLegendsGuard();
    const inside = pos().z > 3349 && pos().x >= 2718 && pos().x <= 2736;
    if (inside) {
        await walkNear(2728, 3351, 1);
        const gate = sdk.findNearbyLoc(/gate/i, { withOption: /open/i });
        if (gate) await bot.openDoor(gate);
        await sdk.waitForTicks(2);
        await dismissLegendsGuard();
    }
    await sdk.sendWalk(2695, 3375, true);
    await sdk.waitForTicks(8);
    await dismissLegendsGuard();
    await walkNear(2695, 3375, 4);
}

async function leaveKeepLeFaye(): Promise<void> {
    if (!inKeepLeFaye()) return;
    intent('Leaving Keep Le Faye — bats, going west to Seers');
    const door = sdk.findNearbyLoc(/door|gate/i, { withOption: /open/i });
    if (door) await bot.openDoor(door);
    await sdk.sendWalk(2726, 3485, true);
    await sdk.waitForTicks(8);
    await walkNear(2726, 3485, 6);
}

async function walkWaypoints(wps: { x: number; z: number }[]): Promise<void> {
    await stepOffHouseDoor();
    await leaveLegendsGuild();
    await leaveKeepLeFaye();
    const dest = wps[wps.length - 1]!;
    for (const wp of wps) {
        if (inLegendsGuild()) await leaveLegendsGuild();
        if (inKeepLeFaye()) await leaveKeepLeFaye();
        if (distTo(dest.x, dest.z) <= 8) return;
        const remaining = distTo(dest.x, dest.z);
        const via = Math.hypot(wp.x - dest.x, wp.z - dest.z);
        if (via >= remaining - 6) continue;
        await walkNear(wp.x, wp.z, 8);
    }
    if (distTo(dest.x, dest.z) > 6) await walkNear(dest.x, dest.z, 6);
}

function nearestBank() {
    return distTo(CATHERBY_BANK.x, CATHERBY_BANK.z) <= distTo(ARDOUGNE_BANK.x, ARDOUGNE_BANK.z)
        ? CATHERBY_BANK
        : ARDOUGNE_BANK;
}

async function withdrawBankFood(): Promise<{ opened: boolean; count: number }> {
    await stepOffHouseDoor();
    await leaveHouse();
    const bank =
        inArdougne() || distTo(ARDOUGNE_BANK.x, ARDOUGNE_BANK.z) < 120
            ? ARDOUGNE_BANK
            : nearestBank();
    intent(`Walking to ${bank === ARDOUGNE_BANK ? 'Ardougne' : 'Catherby'} bank for tuna/swordfish`);
    let opened = false;
    for (let attempt = 0; attempt < 4; attempt++) {
        await walkNear(bank.x, bank.z, 3);
        if (distTo(bank.x, bank.z) > 10) {
            log(`Bank walk attempt ${attempt + 1} still ${Math.round(distTo(bank.x, bank.z))}t from ${bank.x},${bank.z}`);
            await stepOffHouseDoor();
            continue;
        }
        const r = await bot.openBank();
        opened = r.success || !!sdk.getState()?.bank?.isOpen;
        if (opened) break;
        log(`Bank open attempt ${attempt + 1} failed: ${r.message}`);
        await sdk.waitForTicks(2);
    }
    if (!opened) {
        log('Could not open bank — staying put, not walking to Catherby');
        return { opened: false, count: foodCount() };
    }
    for (const item of [...sdk.getInventory()].filter((i) => MULE_FOOD.test(i.name) && i.count > 1)) {
        await bot.depositItem(item, -1);
    }
    for (const shark of [...sdk.getInventory()].filter((i) => /^shark$/i.test(i.name))) {
        await bot.depositItem(shark, -1);
    }
    for (const name of ['tuna', 'swordfish']) {
        const space = 28 - occupiedSlots() - INV_KEEP_FREE;
        if (space <= 0) break;
        const re = new RegExp(`^${name}$`, 'i');
        const inBank = sdk.findBankItem(re)?.count ?? 0;
        if (inBank <= 0) continue;
        const take = Math.min(inBank, space);
        const r = await bot.withdrawItem(re, take, { asNote: false });
        log(`Bank ${name} x${take} ${r.success ? 'ok' : r.message}`);
    }
    if (foodCount() < RESTOCK_FOOD_BELOW) {
        const space = 28 - occupiedSlots() - INV_KEEP_FREE;
        const inBank = sdk.findBankItem(WINE)?.count ?? 0;
        if (space > 0 && inBank > 0) {
            const take = Math.min(inBank, space, 12);
            const r = await bot.withdrawItem(WINE, take, { asNote: false });
            log(`Bank jug of wine x${take} ${r.success ? 'ok' : r.message}`);
        }
    }
    await bot.closeBank();
    const tuna = sdk.getInventory().filter((i) => /^tuna$/i.test(i.name) && i.count === 1).length;
    const sword = sdk.getInventory().filter((i) => /^swordfish$/i.test(i.name) && i.count === 1).length;
    const wine = sdk.getInventory().filter((i) => WINE.test(i.name)).length;
    log(`Bank pack tuna=${tuna} sword=${sword} wine=${wine}`);
    return { opened: true, count: foodCount() };
}

async function unnoteFood(): Promise<number> {
    return (await withdrawBankFood()).count;
}

async function ensureFood(): Promise<boolean> {
    if (foodCount() >= RESTOCK_FOOD_BELOW && notedFood().length === 0) return true;
    await recoverStun();
    const bank = await withdrawBankFood();
    if (bank.count >= RESTOCK_FOOD_BELOW) {
        log('Bank had food — not walking to Jackthief');
        return true;
    }
    if (!bank.opened) return false;
    log('Bank is actually empty of tuna/swordfish — going to Jackthief');
    return restockFromJackthief();
}

async function restockFromJackthief(): Promise<boolean> {

    intent(`Walking to ${PARTNER} at Catherby bank for noted food`);
    await pm(pick([
        'jackkk piggy is starving, walking to catherby bank for noted fish',
        'hey jack, coming to catherby for food notes, save me some swordfish',
        'i ate all my cakes : ( meet me at catherby bank?'
    ]));
    await walkWaypoints(ARDY_TO_CATHERBY);
    await walkNear(CATHERBY_BANK.x, CATHERBY_BANK.z, 4);
    await pm(pick([
        "im at catherby bank!! trade me when u get here",
        "sitting at catherby bank piggy is ready for snacks",
        "here, catherby bank, noted fish pleaseee"
    ]));
    log(`Waiting for ${PARTNER} to trade at Catherby | gp=${coinCount()} food=${foodCount()}`);
    if (sdk.getState()?.trade?.isOpen) await bot.declineTrade().catch(() => {});

    intent(`Waiting for ${PARTNER} to open trade (accept only)`);
    const give = coinCount() > 0 ? [{ item: /^coins$/i, amount: -1 as const }] : [];
    const served = await bot.serveTrades({
        from: new RegExp(`^${PARTNER}$`, 'i'),
        give,
        want: [{ item: MULE_FOOD, amount: 1 }],
        maxTrades: 1,
        timeout: 4 * 60_000,
        tradeTimeout: 90_000
    });
    const last = served.trades[served.trades.length - 1];
    log(
        `Serve trade ${last?.success ? 'ok' : last?.reason ?? served.reason} ${served.message} | food ${foodCount()} notes ${notedFood().map((i) => `${i.count} ${i.name}`).join(', ') || 'none'} gp ${coinCount()}`
    );
    if (last?.success || foodCount() > 0 || notedFood().length > 0) {
        await unnoteFood();
        return foodCount() > 0 || notedFood().length > 0;
    }
    log(`${PARTNER} did not complete a food trade`);
    if (notedFood().length > 0) await unnoteFood();
    return foodCount() >= RESTOCK_FOOD_BELOW;
}

async function clickBoatDialog(): Promise<void> {
    let closedStreak = 0;
    for (let i = 0; i < 24; i++) {
        const dialog = sdk.getDialog();
        if (!dialog?.isOpen) {
            closedStreak++;
            if (closedStreak >= 4) return;
            await new Promise((r) => setTimeout(r, 250));
            continue;
        }
        closedStreak = 0;
        if (dialog.isWaiting) {
            await sdk.waitForTicks(1);
            continue;
        }
        const opts = dialog.options ?? [];
        const pick =
            opts.find((o) => /search away|nothing to hide/i.test(o.text)) ||
            opts.find((o) => /^ok\.?$/i.test(o.text)) ||
            opts.find((o) => /yes please|pay 30|30 coins|ardougne/i.test(o.text)) ||
            opts.find((o) => /can i journey/i.test(o.text)) ||
            opts.find((o) => /yes/i.test(o.text) && !/crandor|bother|miss|customs/i.test(o.text));
        log(`Boat dialog -> ${pick?.text ?? 'continue'} (${opts.map((o) => o.text).join(' | ')})`);
        await sdk.sendClickDialog(pick?.index ?? 0);
        await sdk.waitForTicks(1);
    }
}

async function crossGangplank(): Promise<void> {
    const plank = sdk.findNearbyLoc(/gangplank/i);
    if (!plank) return;
    const opt = plank.optionsWithIndex.find((o) => /cross|board/i.test(o.text));
    log('Crossing gangplank');
    if (opt) await sdk.sendInteractLoc(plank.x, plank.z, plank.id, opt.opIndex);
    else await bot.interactLoc(plank, /cross|board/i);
    await sdk.waitForTicks(5);
}

async function leaveDockedShip(): Promise<void> {
    if (!onDockedShip()) return;
    log(`On a docked ship at (${pos().x},${pos().z}) lv${pos().level} — getting off`);
    for (let i = 0; i < 6 && onDockedShip(); i++) {
        await crossGangplank();
        await sdk.waitForTicks(2);
    }
}

async function pickpocketMen(): Promise<void> {
    if (distTo(LUMBRIDGE_MEN.x, LUMBRIDGE_MEN.z) > 8) {
        intent('Walking to Lumbridge men');
        await walkNear(LUMBRIDGE_MEN.x, LUMBRIDGE_MEN.z, 4);
    }
    await bot.dismissBlockingUI();
    const npc =
        sdk.findNearbyNpc(/^man$/i, { reachable: true }) ??
        sdk.findNearbyNpc(/^woman$/i, { reachable: true }) ??
        sdk.findNearbyNpc(/^(man|woman)$/i);
    if (!npc) {
        await walkNear(LUMBRIDGE_MEN.x, LUMBRIDGE_MEN.z, 3);
        await sdk.waitForTicks(2);
        return;
    }
    const result = await bot.pickpocketNpc(npc);
    console.log(`${result.success ? 'ok' : result.reason} ${npc.name} | ${coinCount()} gp`);
    if (result.reason === 'stunned') await sdk.waitForTicks(6);
}

async function portSarimToMusa(): Promise<void> {
    if (onKaramja() || inArdougne()) return;
    intent('Port Sarim sailor → Musa Point (30gp)');
    await walkNear(PORT_SARIM_DOCK.x, PORT_SARIM_DOCK.z, 4);
    const sailor =
        sdk.findNearbyNpc(/^captain tobias$/i) ??
        sdk.findNearbyNpc(/^seaman /i) ??
        sdk.findNearbyNpc(/sailor|seaman|captain tobias/i);
    if (!sailor) {
        log('No sailor at Port Sarim');
        return;
    }
    const startX = pos().x;
    await bot.talkTo(sailor);
    await clickBoatDialog();
    for (let i = 0; i < 40 && !onKaramja(); i++) {
        await crossGangplank();
        if (sdk.getDialog()?.isOpen) await clickBoatDialog();
        if (Math.abs(pos().x - startX) > 40) break;
        await sdk.waitForTicks(2);
    }
    log(`After Port Sarim boat: (${pos().x},${pos().z}) gp=${coinCount()}`);
}

async function musaToBrimhaven(): Promise<void> {
    if (!onMusa()) return;
    log('Walking Musa Point → Brimhaven (skip Musa customs, skip Grubor house)');
    for (const wp of MUSA_TO_BRIMHAVEN) {
        if (!onMusa()) break;
        await walkNear(wp.x, wp.z, 8);
    }
    await leaveGruborHouse();
    await walkNear(BRIMHAVEN_CUSTOMS.x, BRIMHAVEN_CUSTOMS.z, 5);
}

/** Heroes' Quest hideout (Grubor/Trobert) at ~2811,3170 — walkTo loves that locked door. */
async function leaveGruborHouse(): Promise<void> {
    const p = pos();
    if (p.x < 2792 || p.x > 2830 || p.z > 3194) return;
    const dialog = sdk.getDialog();
    if (dialog?.isOpen) {
        await sdk.sendClickDialog(dialog.options[0]?.index ?? 0);
        await sdk.waitForTicks(1);
    }
    log(`Leaving Grubor house (${p.x},${p.z}) — going north around it`);
    await sdk.sendWalk(2806, 3196, true);
    await sdk.waitForTicks(5);
    await walkNear(2798, 3208, 4);
}

async function brimhavenToArdougne(): Promise<void> {
    if (inArdougne()) return;
    if (!onKaramja() || onMusa()) return;
    await leaveDockedShip();
    await leaveGruborHouse();
    intent('Brimhaven customs → Ardougne (30gp)');
    await walkNear(BRIMHAVEN_CUSTOMS.x, BRIMHAVEN_CUSTOMS.z, 4);
    const customs =
        sdk.findNearbyNpc(/^customs officer$/i) ?? sdk.findNearbyNpc(/customs officer/i);
    if (!customs) {
        log('No Customs officer at Brimhaven');
        return;
    }
    await bot.talkTo(customs);
    await clickBoatDialog();
    for (let i = 0; i < 20 && !inArdougne(); i++) {
        if (sdk.getDialog()?.isOpen) await clickBoatDialog();
        else if (onDockedShip()) await leaveDockedShip();
        await sdk.waitForTicks(2);
    }
    log(`After Brimhaven boat: (${pos().x},${pos().z}) gp=${coinCount()}`);
}

async function ensureSlashWeapon(): Promise<boolean> {
    const equipped = bot.findEquippedItem(SLASH);
    if (equipped) return true;
    const inv = sdk.findInventoryItem(SLASH);
    if (inv) {
        await bot.equipItem(inv);
        return !!bot.findEquippedItem(SLASH);
    }

    intent('Need a slash weapon for the wildy web — checking Draynor bank');
    await walkNear(DRAYNOR_BANK.x, DRAYNOR_BANK.z, 5);
    const opened = await bot.openBank();
    if (opened.success) {
        await bot.withdrawItem(/bronze (axe|sword|dagger)$/i, 1).catch(() => {});
        await bot.closeBank();
    }
    const fromBank = sdk.findInventoryItem(SLASH);
    if (fromBank) {
        await bot.equipItem(fromBank);
        if (bot.findEquippedItem(SLASH)) return true;
    }

    if (coinCount() < 16) {
        intent(`Need 16gp for a bronze axe (${coinCount()} gp)`);
        await pickpocketMen();
        return false;
    }
    intent("Buying a bronze axe from Bob's");
    await walkNear(BOBS_AXES.x, BOBS_AXES.z, 4);
    const shop = await bot.openShop(/bob/i);
    if (!shop.success && !sdk.getState()?.shop?.isOpen) {
        log(`Bob shop failed: ${shop.message}`);
        return false;
    }
    await bot.buyFromShop(/^bronze axe$/i, 1);
    await bot.closeShop();
    const axe = sdk.findInventoryItem(/^bronze axe$/i);
    if (axe) await bot.equipItem(axe);
    return !!bot.findEquippedItem(SLASH);
}

async function slashKeepWeb(): Promise<boolean> {
    const slashed = sdk.findNearbyLoc(/^slashed web$/i);
    if (slashed) return true;
    const web =
        sdk.findNearbyLoc(/^web$/i, { withOption: /slash/i }) ?? sdk.findNearbyLoc(/^web$/i);
    if (!web) return distTo(WILDY_LEVER.x, WILDY_LEVER.z) < 8;
    if (!bot.findEquippedItem(SLASH)) {
        const inv = sdk.findInventoryItem(SLASH);
        if (inv) await bot.equipItem(inv);
    }
    const knife = sdk.findInventoryItem(/^knife$/i);
    if (knife) {
        await bot.useItemOnLoc(knife, web);
    } else {
        await bot.interactLoc(web, /slash/i);
    }
    await sdk.waitForTicks(2);
    return !!sdk.findNearbyLoc(/^slashed web$/i) || !sdk.findNearbyLoc(/^web$/i, { withOption: /slash/i });
}

async function pullWildyLever(): Promise<boolean> {
    await walkNear(WILDY_LEVER.x, WILDY_LEVER.z, 4);
    for (let i = 0; i < 8 && !inArdougne(); i++) {
        await eatIfNeeded();
        if (pos().inCombat) {
            await sdk.sendWalk(WILDY_LEVER.x, WILDY_LEVER.z, true);
        }
        const lever =
            sdk.findNearbyLoc(/^lever$/i, { withOption: /pull/i }) ?? sdk.findNearbyLoc(/^lever$/i);
        if (!lever || !lever.reachable) {
            await slashKeepWeb();
            continue;
        }
        intent('Pulling the wilderness lever to Ardougne');
        await bot.interactLoc(lever, /pull/i);
        const dialog = sdk.getDialog();
        if (dialog?.isOpen) {
            const pick =
                dialog.options.find((o) => /don't show|brave|yes please/i.test(o.text)) ||
                dialog.options.find((o) => /yes/i.test(o.text));
            await sdk.sendClickDialog(pick?.index ?? 0);
            await sdk.waitForTicks(2);
        }
        await sdk.waitForCondition((s) => {
            const x = s.player?.worldX ?? 0;
            const z = s.player?.worldZ ?? 0;
            return x < 2750 && x > 2500 && z > 3240;
        }, 8_000).catch(() => {});
        if (inArdougne()) {
            log(`Wildy lever → Ardougne (${pos().x},${pos().z})`);
            return true;
        }
        await sdk.waitForTicks(1);
    }
    return inArdougne();
}

async function walkWildyToLever(): Promise<void> {
    intent('Wilderness run to the Deserted Keep lever');
    for (const wp of WILDY_TO_LEVER) {
        if (inArdougne()) return;
        if (distTo(WILDY_LEVER.x, WILDY_LEVER.z) < 8) break;
        await eatIfNeeded();
        if (pos().inCombat) await sdk.sendWalk(wp.x, wp.z, true);
        else await walkNear(wp.x, wp.z, 10);
    }
    await walkNear(WILDY_LEVER.x, WILDY_LEVER.z, 6);
}

async function returnToArdougne(): Promise<void> {
    if (inArdougne()) {
        if (pos().z < 3271 && sdk.findNearbyLoc(/gangplank/i)) {
            await crossGangplank();
            await sdk.waitForTicks(3);
        }
        return;
    }
    await leaveDockedShip();
    if (inLegendsGuild() || sdk.getDialog()?.isOpen) {
        await leaveLegendsGuild();
        await walkWaypoints(CATHERBY_TO_ARDY);
        return;
    }
    if (onMusa()) {
        await musaToBrimhaven();
        return;
    }
    if (onKaramja()) {
        await brimhavenToArdougne();
        return;
    }

    if (nearSeersCatherby()) {
        intent('Walking Catherby/Seers → Ardougne');
        await walkWaypoints(CATHERBY_TO_ARDY);
        return;
    }

    if (inWilderness()) {
        if (distTo(WILDY_LEVER.x, WILDY_LEVER.z) > 12) await walkWildyToLever();
        await pullWildyLever();
        return;
    }

    if (distTo(EDGEVILLE.x, EDGEVILLE.z) > 12) {
        intent('Walking to Edgeville, then north to the wildy lever');
        await walkNear(EDGEVILLE.x, EDGEVILLE.z, 6);
        return;
    }
    await walkWildyToLever();
    await pullWildyLever();
}

try {
    lastLoggedLevel = thievingLevel();
    console.log(`Goal: Thieving ${TARGET_LEVEL} — trapped knights, else heroes > paladins > knights. ${PARTNER} mules noted food at Catherby.`);
    await bot.skipTutorial();
    await bot.dismissBlockingUI();
    sdk.getNewChat();
    lastLoggedLevel = thievingLevel();
    log(`Join-trap then heroes/paladins/knights Thieving ${lastLoggedLevel} @ ${pos().x},${pos().z} gp=${coinCount()} food=${foodCount()}`);
    console.log('Never attacking knights. Trapped knights first, else heroes > paladins > knights.');

    while (true) {
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
            await pm(pick([
                `jackkk thieving ${level} now`,
                `level ${level} thieving!! piggy is so good`,
                `i hit ${level} thieving, still not dead`
            ]));
            lastLoggedLevel = level;
        }

        if (inLegendsGuild()) {
            await leaveLegendsGuild();
        }
        if (inKeepLeFaye()) {
            await leaveKeepLeFaye();
        }

        if (!inArdougne()) {
            if (foodCount() >= RESTOCK_FOOD_BELOW && notedFood().length === 0) {
                await returnToArdougne();
                continue;
            }
            if (nearSeersCatherby() && foodCount() < RESTOCK_FOOD_BELOW) {
                await ensureFood();
                continue;
            }
            await returnToArdougne();
            continue;
        }

        if (foodCount() < RESTOCK_FOOD_BELOW || notedFood().length > 0) {
            await ensureFood();
            continue;
        }

        const result = await pickpocketBest();
        if (result === 'ok') continue;
        if (result === 'stunned' || result === 'fail') {
            await recoverStun();
            continue;
        }

        await sdk.waitForTicks(2);
    }

    const done = sdk.getSkill('Thieving');
    console.log(`Finished: Thieving ${done?.baseLevel} (${done?.experience} xp) | ${coinCount()} gp | food ${foodCount()}`);
} catch (err) {
    console.error('Script error:', err);
    throw err;
} finally {
    console.log('Disconnecting SDK; browser client can stay open.');
    await sdk.disconnect();
}
