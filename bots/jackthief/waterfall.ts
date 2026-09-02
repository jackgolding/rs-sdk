/**
 * Waterfall Quest — Jackthief.
 *
 *   bun bots/jackthief/waterfall.ts
 *
 * Almera → raft → Hudon → rope across → Hadley's book → Golrie's pebble
 * → Glarial's tomb (no weapons/armour/runes) → waterfall dungeon → chalice.
 *
 * Rope and elemental runes are withdrawn from the bank. Protect from melee
 * stays on in the gnome cave and waterfall dungeon (fire giants).
 */
import { BotSDK, deriveGatewayUrl } from '../../sdk/index';
import { BotActions } from '../../sdk/actions';
import { initPathfinding, nearestWalkableTile } from '../../sdk/pathfinding';
import { readFileSync, appendFileSync } from 'fs';
import { dirname, join } from 'path';

const ALMERA = { x: 2522, z: 3498 };
const RAFT = { x: 2510, z: 3494 };
const ISLAND = { x: 2512, z: 3481 };
/** South edge of Hudon's island — rope-on-rock inzone + AP range. */
const ISLAND_SHOT = { x: 2512, z: 3476 };
const LEDGE = { x: 2511, z: 3463 };
const HADLEY = { x: 2516, z: 3428 };
/** Quest bookcase — tourist centre upstairs, loc 1989. Stand west of it. */
const HADLEY_BOOKCASE = { x: 2520, z: 3426 };
const HADLEY_BOOKCASE_STAND = { x: 2519, z: 3427 };
const QUEST_BOOKCASE_ID = 1989;
const WASHED = { x: 2527, z: 3413 };
const TOMBSTONE = { x: 2557, z: 3444 };
/** Glarial’s tomb interior — chest (amulet) then coffin (urn), then the entry ladder. */
const TOMB_CHEST = { x: 2530, z: 9844 };
const TOMB_COFFIN = { x: 2542, z: 9811 };
const TOMB_LADDER = { x: 2556, z: 9844 };
const BOLREN = { x: 2542, z: 3169 };
const GNOME_LADDER = { x: 2533, z: 3155 };
const GNOME_DUNGEON_LADDER = { x: 2533, z: 9555 };
const GOLRIE = { x: 2515, z: 9581 };
const GOLRIE_GATE = { x: 2515, z: 9575 };
const GOLRIE_GATE_ID = 1991;
/** Quest crate (loc 1990) in the east store room — not the pile by the bats. */
const GOLRIE_CRATE = { x: 2548, z: 9565 };
const GOLRIE_CRATE_ID = 1990;
const SOUTH_ARDY_BANK = { x: 2655, z: 3283 };
const NORTH_ARDY_BANK = { x: 2618, z: 3332 };
const AEMAD = { x: 2613, z: 3294 };
const ARDY_CHURCH = { x: 2614, z: 3306 };
const WF_CRATE = { x: 2589, z: 9888 };
const WF_DOOR = { x: 2566, z: 9902 };
const WF_PILLARS = { x: 2565, z: 9912 };
const WF_STATUE = { x: 2566, z: 9914 };

const TO_FALLS = [
    { x: 2618, z: 3332 },
    { x: 2580, z: 3375 },
    { x: 2540, z: 3395 },
    { x: 2512, z: 3430 },
    { x: 2512, z: 3496 }
];
const TO_GNOME = [
    { x: 2610, z: 3290 },
    { x: 2560, z: 3260 },
    { x: 2520, z: 3230 },
    { x: 2505, z: 3194 }
];
/**
 * East Ardougne → tomb. Stay east of the Fishing Guild (door 2611,3398).
 * 2605,3410 is inside the guild and needs 68 Fishing.
 */
const TO_TOMB = [
    { x: 2618, z: 3332 },
    { x: 2634, z: 3375 },
    { x: 2640, z: 3420 },
    { x: 2575, z: 3438 }
];

const FOOD = /shark|swordfish|lobster|tuna|monkfish|salmon|wine|cake|bread|meat|anchov/i;
const ROPE = /^rope$/i;
const AIR = /^air rune$/i;
const WATER = /^water rune$/i;
const EARTH = /^earth rune$/i;
const PEBBLE = /glarial'?s pebble/i;
const AMULET = /glarial'?s amulet/i;
const URN = /glarial'?s urn/i;
const BOOK = /book on baxtorian/i;
const KEY = /key/i;
const SEEDS = /mithril seed/i;
const BOW = /bow/i;
const ARROW = /^(bronze|iron|steel|mithril|adamant|rune) arrows?$/i;
const DHIDE = /dragonhide|dragon vambraces/i;
const KEEP_QUEST =
    /^(rope|air rune|water rune|earth rune|coins|glarial'?s pebble|glarial'?s amulet|glarial'?s urn|book on baxtorian|key|shark|swordfish|lobster|tuna|salmon)/i;
const PROT_MELEE = 'protect_from_melee' as const;

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

let lastIntent = '';
let questComplete = false;
let bookRead = false;
let hudonThisVisit = false;
const attackXpStart = sdk.getSkill('Attack')?.experience ?? 0;

function intent(msg: string): void {
    if (msg === lastIntent) return;
    lastIntent = msg;
    console.log(`> ${msg}`);
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
    return Math.hypot(pos().x - x, pos().z - z);
}

function occupiedSlots(): number {
    return sdk.getInventory().filter((i) => (i.count ?? 0) > 0).length;
}

function count(pattern: RegExp): number {
    return sdk.getInventory().filter((i) => pattern.test(i.name)).reduce((n, i) => n + (i.count ?? 1), 0);
}

function coinCount(): number {
    return sdk.findInventoryItem(/^coins$/i)?.count ?? 0;
}

function foodCount(): number {
    return count(FOOD);
}

function prayerPoints(): number {
    return sdk.getPrayerState()?.prayerPoints ?? 0;
}

function prayerBase(): number {
    return sdk.getPrayerState()?.prayerLevel ?? sdk.getSkill('Prayer')?.baseLevel ?? 0;
}

function locWithOp(name: RegExp, op: RegExp) {
    return sdk.findNearbyLoc(name, { withOption: op }) ??
        (sdk.getNearbyLocs() ?? []).find(
            (l) => name.test(l.name) && (l.options ?? []).some((o) => op.test(o))
        );
}

async function closeUi(): Promise<void> {
    const dialog = sdk.getDialog();
    if (dialog?.isOpen) {
        const decline = dialog.options?.find((o) =>
            /no thank|not now|never mind|i'?m afraid i'?m in a rush/i.test(o.text)
        );
        if (decline) {
            await sdk.sendClickDialog(decline.index);
            await sdk.waitForTicks(1);
        }
    }
    if (sdk.getState()?.shop?.isOpen || sdk.getState()?.bank?.isOpen || sdk.getState()?.interface?.isOpen) {
        await bot.closeInterface();
    }
    await bot.dismissBlockingUI();
}

async function chat(choices: RegExp[] = [], max = 40, until?: () => boolean): Promise<string[]> {
    const seen: string[] = [];
    let closed = 0;
    const closedLimit = until ? 25 : 8;
    for (let i = 0; i < max; i++) {
        if (until?.()) return seen;
        const dialog = sdk.getDialog();
        if (!dialog?.isOpen) {
            closed++;
            if (closed >= closedLimit) break;
            await sdk.waitForTicks(1);
            continue;
        }
        closed = 0;
        if (dialog.isWaiting) {
            await sdk.waitForTicks(1);
            continue;
        }
        const opts = dialog.options ?? [];
        for (const o of opts) seen.push(o.text);
        if (opts.length <= 1 || opts.every((o) => /click here to continue/i.test(o.text))) {
            await sdk.sendClickDialog(opts[0]?.index ?? 0);
            await sdk.waitForTicks(1);
            continue;
        }
        let picked = false;
        for (const c of choices) {
            const match = opts.find((o) => c.test(o.text));
            if (match) {
                log(`Dialog -> ${match.text}`);
                await sdk.sendClickDialog(match.index);
                picked = true;
                break;
            }
        }
        if (!picked) break;
        await sdk.waitForTicks(1);
    }
    return seen;
}

async function walkNear(x: number, z: number, tolerance = 4): Promise<boolean> {
    if (distTo(x, z) <= tolerance) return true;
    if (onIsland() && !(x >= 2508 && x <= 2518 && z >= 3476 && z <= 3486)) {
        log(`skip walk to ${x},${z} — stranded on Hudon island`);
        return false;
    }
    const dest = nearestWalkableTile(pos().level, x, z) ?? { x, z };
    const result = await bot.walkTo(dest.x, dest.z, Math.min(tolerance, 3));
    if (!result.success) log(`walk ${x},${z} -> ${dest.x},${dest.z}: ${result.message} now ${pos().x},${pos().z}`);
    return result.success || distTo(x, z) <= tolerance + 2;
}

async function walkWaypoints(points: { x: number; z: number }[]): Promise<void> {
    const dest = points[points.length - 1]!;
    for (const p of points) {
        if (distTo(p.x, p.z) <= 8) continue;
        if (Math.hypot(dest.x - p.x, dest.z - p.z) >= distTo(dest.x, dest.z) - 4) continue;
        await eatIfLow();
        await walkNear(p.x, p.z, 6);
    }
    if (distTo(dest.x, dest.z) > 6) await walkNear(dest.x, dest.z, 4);
}

async function eatIfLow(threshold = 40): Promise<void> {
    if (pos().isDead) return;
    if (pos().hp >= Math.min(threshold, pos().maxHp - 4)) return;
    const food = sdk.findInventoryItem(FOOD);
    if (!food) return;
    intent(`Eating ${food.name} at ${pos().hp}/${pos().maxHp}`);
    await bot.eatFood(food);
}

async function meleeOn(): Promise<void> {
    if (prayerBase() < 43 || prayerPoints() <= 0) return;
    if (sdk.isPrayerActive(PROT_MELEE)) return;
    const r = await bot.activatePrayer(PROT_MELEE);
    if (r.success) log(`Protect from melee on (${prayerPoints()}/${prayerBase()})`);
    else log(`Protect from melee: ${r.message}`);
}

async function meleeOff(): Promise<void> {
    if (!sdk.isPrayerActive(PROT_MELEE)) return;
    await bot.deactivatePrayer(PROT_MELEE);
}

function inGnomeDungeon(): boolean {
    return pos().z >= 9500 && pos().z < 9800;
}

function inTomb(): boolean {
    return pos().z >= 9800 && pos().z < 9856;
}

function inWaterfallDungeon(): boolean {
    return pos().z >= 9856;
}

function onIsland(): boolean {
    return pos().z < 6400 && pos().x >= 2508 && pos().x <= 2518 && pos().z >= 3476 && pos().z <= 3486;
}

function onLedge(): boolean {
    return distTo(LEDGE.x, LEDGE.z) <= 6 && pos().z < 6400;
}

async function waitMoved(fromX: number, fromZ: number, timeout = 20_000): Promise<boolean> {
    try {
        await sdk.waitForCondition(() => distTo(fromX, fromZ) > 3 || pos().z !== fromZ, timeout);
        return distTo(fromX, fromZ) > 3 || pos().z !== fromZ;
    } catch {
        return distTo(fromX, fromZ) > 3 || pos().z !== fromZ;
    }
}

async function openBankHere(): Promise<boolean> {
    if (sdk.getState()?.bank?.isOpen) return true;
    const r = await bot.openBank();
    if (r.success || sdk.getState()?.bank?.isOpen) return true;
    const booth = locWithOp(/bank booth/i, /use-quickly|use/i);
    if (booth) {
        await bot.interactLoc(booth, /use-quickly|use/i);
        try {
            await sdk.waitForCondition((s) => !!s.bank?.isOpen, 8_000);
        } catch {
            /* ignore */
        }
    }
    return !!sdk.getState()?.bank?.isOpen;
}

async function depositAllExcept(keep: RegExp): Promise<void> {
    if (!(await openBankHere())) return;
    for (const item of [...sdk.getInventory()]) {
        if (keep.test(item.name)) continue;
        await bot.depositItem(item, -1);
    }
}

async function unequipAll(): Promise<void> {
    for (const item of [...sdk.getEquipment()]) {
        await bot.unequipItem(item);
    }
}

async function withdrawPat(pattern: RegExp, amount: number): Promise<number> {
    if (!sdk.getState()?.bank?.isOpen) return count(pattern);
    const have = count(pattern);
    if (have >= amount) return have;
    const item = sdk.findBankItem(pattern);
    if (!item) return have;
    await bot.withdrawItem(item, Math.min(amount - have, item.count));
    return count(pattern);
}

async function buy(npc: RegExp, at: { x: number; z: number }, item: RegExp, amount: number): Promise<boolean> {
    if (count(item) >= amount) return true;
    await walkNear(at.x, at.z, 4);
    await closeUi();
    const opened = await bot.openShop(npc);
    if (!opened.success && !sdk.getState()?.shop?.isOpen) {
        const n = sdk.findNearbyNpc(npc);
        if (n) await bot.interactNpc(n, /trade/i);
    }
    if (!sdk.getState()?.shop?.isOpen) {
        log(`Could not open shop for ${npc}`);
        return false;
    }
    const need = amount - count(item);
    const bought = await bot.buyFromShop(item, need);
    log(bought.message);
    await bot.closeShop();
    return count(item) >= amount;
}

function tombReady(): boolean {
    if (sdk.getEquipment().length > 0) return false;
    if (count(PEBBLE) < 1) return false;
    for (const item of sdk.getInventory()) {
        if (PEBBLE.test(item.name) || FOOD.test(item.name)) continue;
        return false;
    }
    return true;
}

async function rechargePrayer(): Promise<void> {
    if (prayerPoints() >= Math.min(40, prayerBase())) return;
    intent(`Recharging prayer at East Ardougne church (${prayerPoints()}/${prayerBase()})`);
    await meleeOff();
    await walkNear(ARDY_CHURCH.x, ARDY_CHURCH.z, 4);
    const altar = locWithOp(/^altar$/i, /pray/i) ?? sdk.findNearbyLoc(/altar/i);
    if (!altar) {
        log(`No church altar @ ${pos().x},${pos().z}`);
        return;
    }
    const before = prayerPoints();
    await bot.interactLoc(altar, /pray/i);
    try {
        await sdk.waitForCondition((s) => (s.prayers?.prayerPoints ?? 0) > before, 8_000);
    } catch {
        /* already full */
    }
    log(`Altar ${before} -> ${prayerPoints()}/${prayerBase()}`);
}

async function ensureSupplies(): Promise<boolean> {
    if (count(ROPE) >= 1 && foodCount() >= 1 && pos().hp > 20) {
        log(`Already supplied rope=${count(ROPE)} food=${foodCount()} hp=${pos().hp}/${pos().maxHp} pray=${prayerPoints()}/${prayerBase()}`);
        return true;
    }
    await goBank();
    if (!(await openBankHere())) {
        log('Bank did not open');
        return false;
    }
    const dusty = sdk.findInventoryItem(/dusty key/i);
    if (dusty) await bot.depositItem(dusty, -1);
    if (coinCount() < 50) await withdrawPat(/^coins$/i, 200);
    await withdrawPat(FOOD, 12);
    await withdrawPat(ROPE, 1);
    const bankAir = sdk.findBankItem(AIR)?.count ?? 0;
    const bankWater = sdk.findBankItem(WATER)?.count ?? 0;
    const bankEarth = sdk.findBankItem(EARTH)?.count ?? 0;
    log(`Bank runes air=${bankAir} water=${bankWater} earth=${bankEarth} rope=${sdk.findBankItem(ROPE)?.count ?? count(ROPE)}`);
    await bot.closeBank();
    await eatIfLow(pos().maxHp - 2);

    if (count(ROPE) < 1) {
        intent('Rope missing from bank — buying one at Aemad');
        await buy(/aemad/i, AEMAD, ROPE, 1);
    }

    log(`Supplies rope=${count(ROPE)} food=${foodCount()} gp=${coinCount()} hp=${pos().hp}/${pos().maxHp} pray=${prayerPoints()}/${prayerBase()}`);
    return count(ROPE) >= 1 && foodCount() >= 1;
}

async function talkAlmera(): Promise<void> {
    if (onIsland() || onLedge()) return;
    intent('Talking to Almera');
    await walkWaypoints(TO_FALLS);
    await walkNear(ALMERA.x, ALMERA.z, 3);
    const npc = sdk.findNearbyNpc(/^almera$/i);
    if (!npc) {
        log('Almera not nearby');
        return;
    }
    await bot.talkTo(npc);
    await chat([/how can i help/i]);
}

async function boardRaft(): Promise<boolean> {
    if (!onIsland()) {
        intent('Boarding the log raft');
        await walkNear(RAFT.x, RAFT.z, 3);
        const raft = locWithOp(/log raft/i, /board/i) ?? sdk.findNearbyLoc(/log raft/i);
        if (!raft) {
            log('Raft not nearby');
            return false;
        }
        hudonThisVisit = false;
        await bot.interactLoc(raft, /board/i);
        try {
            await sdk.waitForCondition(() => onIsland(), 25_000);
        } catch {
            /* still chatting or delayed teleport */
        }
        log(`After raft @ ${pos().x},${pos().z} island=${onIsland()}`);
    }
    if (onIsland()) await talkHudon();
    return onIsland();
}

async function talkHudon(): Promise<void> {
    if (!onIsland() || hudonThisVisit) return;
    intent('Talking to Hudon');
    // Raft crash plays two delays before the forced Hudon dialog.
    await sdk.waitForTicks(10);
    try {
        await sdk.waitForCondition((s) => !!s.dialog?.isOpen, 8_000);
    } catch {
        /* may need a manual talk */
    }
    await chat([]);

    const hudon = sdk.findNearbyNpc(/^hudon$/i);
    if (!hudon) {
        log('Hudon not on the island');
        hudonThisVisit = true;
        return;
    }
    if (sdk.getDialog()?.isOpen) {
        await chat([]);
        hudonThisVisit = true;
        log(`Hudon done @ ${pos().x},${pos().z}`);
        return;
    }
    // Don't walk onto Hudon — he can sit on an unwalkable tile. Approach-talk from the island.
    const r = await sdk.sendTalkToNpc(hudon.index);
    log(`Hudon talk: ${r.message} dist=${hudon.distance}`);
    try {
        await sdk.waitForCondition((s) => !!s.dialog?.isOpen, 6_000);
    } catch {
        /* ignore */
    }
    if (!sdk.getDialog()?.isOpen) {
        log('Hudon dialog did not open — stepping south on the island');
        await walkNear(ISLAND_SHOT.x, ISLAND_SHOT.z + 2, 1);
        const again = sdk.findNearbyNpc(/^hudon$/i);
        if (again) {
            await sdk.sendTalkToNpc(again.index);
            try {
                await sdk.waitForCondition((s) => !!s.dialog?.isOpen, 8_000);
            } catch {
                /* ignore */
            }
        }
    }
    await chat([]);
    hudonThisVisit = true;
    log(`Hudon done @ ${pos().x},${pos().z}`);
}

async function useOnLocHere(
    itemPat: RegExp,
    loc: { x: number; z: number; id: number; name: string },
    arrived: () => boolean,
    timeout = 15_000
): Promise<boolean> {
    const item = sdk.findInventoryItem(itemPat);
    if (!item) {
        log(`useOnLocHere: no ${itemPat}`);
        return false;
    }
    const r = await sdk.sendUseItemOnLoc(item.slot, loc.x, loc.z, loc.id);
    if (!r.success) {
        log(`useOnLocHere ${item.name} -> ${loc.name}: ${r.message}`);
        return false;
    }
    try {
        await sdk.waitForCondition(() => arrived() || onLedge(), timeout);
    } catch {
        /* animation may not move us */
    }
    log(`useOnLocHere ${item.name} -> ${loc.name} now ${pos().x},${pos().z}`);
    return arrived() || onLedge();
}

async function ropeAcross(): Promise<boolean> {
    if (count(ROPE) < 1) {
        log('No rope on island — cannot cross');
        return false;
    }
    await talkHudon();
    await sdk.scanNearbyLocs(16);
    const locs = (sdk.getNearbyLocs() ?? []).map((l) => `${l.name}(${l.options.join('/')})`).join(', ');
    log(`Island locs @ ${pos().x},${pos().z}: ${locs || 'none'}`);

    intent('Walking to the south edge of the island for the rope shot');
    await walkNear(ISLAND_SHOT.x, ISLAND_SHOT.z, 1);
    log(`Shot tile @ ${pos().x},${pos().z} (want ${ISLAND_SHOT.x},${ISLAND_SHOT.z})`);

    intent('Rope on the river rock — do not swim');
    const rock = locWithOp(/^rock$/i, /swim/i) ?? sdk.findNearbyLoc(/^rock$/i);
    if (!rock) {
        log('No rock on island');
        return false;
    }
    // Success is being pulled onto the rock (z drops below the island), not a 2-tile shuffle.
    if (!(await useOnLocHere(ROPE, rock, () => pos().z <= rock.z + 5, 25_000))) {
        log(`Rope-on-rock did not cross — still ${pos().x},${pos().z} rock=${rock.x},${rock.z}`);
        return false;
    }

    intent('Rope on the dead tree — do not climb');
    await sdk.scanNearbyLocs(12);
    const tree = locWithOp(/dead tree/i, /climb/i) ?? sdk.findNearbyLoc(/dead tree/i);
    if (!tree) {
        log(`Dead tree not nearby @ ${pos().x},${pos().z}`);
        return false;
    }
    await useOnLocHere(ROPE, tree, () => onLedge() || distTo(LEDGE.x, LEDGE.z) <= 6, 15_000);
    log(`After tree @ ${pos().x},${pos().z} ledge=${onLedge()}`);
    return onLedge() || distTo(LEDGE.x, LEDGE.z) <= 8;
}

async function getInBarrel(): Promise<void> {
    if (!onLedge()) {
        log(`Skip barrel — already off the ledge @ ${pos().x},${pos().z}`);
        return;
    }
    intent('Getting in the barrel (first-visit ride down to Hadley — not a fail)');
    const barrel = locWithOp(/^barrel$/i, /get in/i) ?? sdk.findNearbyLoc(/^barrel$/i);
    if (!barrel) return;
    const { x, z } = pos();
    const op = (barrel.options ?? []).findIndex((o) => /get in/i.test(o));
    await sdk.sendInteractLoc(barrel.x, barrel.z, barrel.id, op >= 0 ? op + 1 : 1);
    await waitMoved(x, z, 20_000);
}

async function enterWaterfallDoor(): Promise<void> {
    const amulet = sdk.findInventoryItem(AMULET);
    if (amulet) await bot.equipItem(amulet);
    await meleeOn();
    intent('Opening the waterfall ledge');
    const ledge = locWithOp(/^ledge$/i, /open/i) ?? sdk.findNearbyLoc(/^ledge$/i);
    if (!ledge) {
        log('Ledge door not nearby');
        return;
    }
    const { x, z } = pos();
    await bot.interactLoc(ledge, /open/i);
    await waitMoved(x, z, 20_000);
}

async function climbHadleyStairs(wantUp: boolean): Promise<boolean> {
    const opt = wantUp ? /climb-up|climb.up/i : /climb-down|climb.down/i;
    const stairs = (sdk.getNearbyLocs() ?? [])
        .filter((l) => /stair|ladder/i.test(l.name) && (l.options ?? []).some((o) => opt.test(o)))
        .sort((a, b) => {
            const da = Math.hypot(a.x - HADLEY.x, a.z - HADLEY.z);
            const db = Math.hypot(b.x - HADLEY.x, b.z - HADLEY.z);
            return da - db || (a.distance ?? 99) - (b.distance ?? 99);
        })[0];
    if (!stairs) return false;
    const before = pos().level;
    await bot.interactLoc(stairs, opt);
    try {
        await sdk.waitForCondition((s) => (s.player?.level ?? before) !== before, 8_000);
    } catch {
        /* ignore */
    }
    return pos().level !== before;
}

async function readBaxtorianBook(): Promise<boolean> {
    intent("Searching Hadley's tourist-centre bookcase for Book on Baxtorian");
    await walkNear(HADLEY.x, HADLEY.z, 4);
    if (pos().level !== 1) await climbHadleyStairs(true);
    await walkNear(HADLEY_BOOKCASE_STAND.x, HADLEY_BOOKCASE_STAND.z, 0);
    await sdk.scanNearbyLocs(16);
    const cases = (sdk.getNearbyLocs() ?? []).filter((l) => /bookcase/i.test(l.name));
    log(
        `Hadley floor ${pos().level} bookcases: ` +
            (cases.map((l) => `id=${l.id} @ ${l.x},${l.z} r=${l.reachable}`).join('; ') || 'none')
    );
    const bookcase =
        cases.find((l) => l.id === QUEST_BOOKCASE_ID) ??
        cases.find((l) => l.x === HADLEY_BOOKCASE.x && l.z === HADLEY_BOOKCASE.z) ??
        null;
    if (!bookcase) {
        log('Quest bookcase (id 1989) not on this floor');
        if (pos().level > 0) await climbHadleyStairs(false);
        return false;
    }
    // Confirmed stand tile is west of the loc (2519,3427), not east.
    await walkNear(HADLEY_BOOKCASE_STAND.x, HADLEY_BOOKCASE_STAND.z, 0);
    log(`Searching quest bookcase id=${bookcase.id} from ${pos().x},${pos().z}`);
    await bot.interactLoc(bookcase, /search/i);
    try {
        await sdk.waitForCondition(() => count(BOOK) > 0, 8_000);
    } catch {
        await sdk.waitForTicks(4);
    }
    const book = sdk.findInventoryItem(BOOK);
    if (!book) {
        const msgs = (sdk.getState()?.gameMessages ?? []).slice(-4).map((m) => m.text);
        log(`No book after searching id=${bookcase.id}: ${msgs.join(' | ')}`);
        if (pos().level > 0) await climbHadleyStairs(false);
        return false;
    }
    intent('Reading Book on Baxtorian');
    await sdk.sendUseItem(book.slot, 1);
    await sdk.waitForTicks(3);
    await bot.closeInterface();
    bookRead = true;
    log('Read Book on Baxtorian');
    if (pos().level > 0) await climbHadleyStairs(false);
    return true;
}

async function climbGnomeDungeon(): Promise<boolean> {
    if (inGnomeDungeon()) return true;
    if (pos().level > 0) {
        intent("Climbing down Hadley's stairs before leaving");
        await climbHadleyStairs(false);
    }
    await rechargePrayer();
    intent('Walking the gnome maze to the dungeon');
    await walkWaypoints(TO_GNOME);
    await walkNear(GNOME_LADDER.x, GNOME_LADDER.z, 6);
    if (distTo(GNOME_LADDER.x, GNOME_LADDER.z) > 8) {
        await walkNear(BOLREN.x, BOLREN.z, 6);
        await walkNear(GNOME_LADDER.x, GNOME_LADDER.z, 4);
    }
    await sdk.scanNearbyLocs(16);
    const ladder = locWithOp(/ladder/i, /climb/i) ?? sdk.findNearbyLoc(/ladder/i);
    if (!ladder) {
        log(`No gnome ladder @ ${pos().x},${pos().z}`);
        return false;
    }
    await bot.interactLoc(ladder, /climb/i);
    try {
        await sdk.waitForCondition(() => inGnomeDungeon(), 12_000);
    } catch {
        /* ignore */
    }
    return inGnomeDungeon();
}

async function rescueGolrie(): Promise<void> {
    if (count(PEBBLE) > 0) return;
    if (!(await climbGnomeDungeon())) return;
    await meleeOn();
    if (count(KEY) < 1) {
        intent('Searching crates for Golrie’s key');
        await closeUi();
        await walkNear(GOLRIE_CRATE.x, GOLRIE_CRATE.z, 2);
        for (let i = 0; i < 6 && count(KEY) < 1; i++) {
            await closeUi();
            await eatIfLow();
            await meleeOn();
            await sdk.scanNearbyLocs(12);
            const crates = (sdk.getNearbyLocs() ?? []).filter((l) => /^crate$/i.test(l.name));
            log(`Crates @ ${pos().x},${pos().z}: ` + crates.map((l) => `id=${l.id} @ ${l.x},${l.z}`).join('; '));
            const crate =
                crates.find((l) => l.id === GOLRIE_CRATE_ID) ??
                crates.find((l) => l.x === GOLRIE_CRATE.x && l.z === GOLRIE_CRATE.z) ??
                null;
            if (!crate) {
                log('Quest crate not in view — walking east store room');
                await walkNear(GOLRIE_CRATE.x, GOLRIE_CRATE.z, 1);
                continue;
            }
            await walkNear(crate.x, crate.z, 1);
            await bot.interactLoc(crate, /search/i);
            try {
                await sdk.waitForCondition(() => count(KEY) > 0, 6_000);
            } catch {
                await sdk.waitForTicks(3);
            }
        }
        if (count(KEY) < 1) log(`No Golrie key after searching crate @ ${pos().x},${pos().z}`);
    }
    intent('Unlocking Golrie');
    await walkNear(GOLRIE.x, GOLRIE.z, 4);
    const door = locWithOp(/^door$/i, /open/i) ?? sdk.findNearbyLoc(/^door$/i);
    const key = sdk.findInventoryItem(KEY);
    if (key && door) {
        await bot.useItemOnLoc(key, door, { timeout: 12_000 });
    } else if (door) {
        await bot.interactLoc(door, /open/i);
    }
    intent('Talking to Golrie — wait through the floor-search pause for the pebble');
    for (let n = 0; n < 3 && count(PEBBLE) < 1; n++) {
        const golrie = sdk.findNearbyNpc(/^golrie$/i);
        if (!golrie) {
            await walkNear(GOLRIE.x, GOLRIE.z, 2);
            continue;
        }
        await bot.talkTo(golrie);
        const seen = await chat([], 80, () => count(PEBBLE) > 0);
        log(`Golrie chat attempt ${n + 1}: pebble=${count(PEBBLE)} seen=${seen.slice(-4).join(' | ')}`);
    }
    log(`Pebble=${count(PEBBLE)} @ ${pos().x},${pos().z}`);
}

async function openGolrieGate(): Promise<boolean> {
    await sdk.scanNearbyLocs(12);
    const door =
        (sdk.getNearbyLocs() ?? []).find((l) => l.id === GOLRIE_GATE_ID) ??
        locWithOp(/^door$/i, /open/i) ??
        sdk.findNearbyLoc(/^door$/i);
    if (!door) {
        log(`Golrie gate not in view @ ${pos().x},${pos().z}`);
        return distTo(GOLRIE_GATE.x, GOLRIE_GATE.z) > 8;
    }
    // Standing on the door tile counts as outside ("Golrie has locked himself in").
    // Step north into the cell, then Open from one tile inside.
    if (pos().z <= GOLRIE_GATE.z) {
        log(`On/outside the gate @ ${pos().x},${pos().z} — stepping back to Golrie`);
        await sdk.sendWalk(GOLRIE.x, GOLRIE.z, true);
        try {
            await sdk.waitForCondition(() => pos().z > GOLRIE_GATE.z + 1, 8_000);
        } catch {
            /* still on the bars */
        }
    }
    await sdk.sendWalk(GOLRIE_GATE.x, GOLRIE_GATE.z + 2, true);
    await sdk.waitForTicks(4);
    log(`Opening Golrie gate from ${pos().x},${pos().z} (inside=${pos().z > GOLRIE_GATE.z})`);
    const { x, z } = pos();
    await sdk.sendInteractLoc(door.x, door.z, door.id, 1);
    await waitMoved(x, z, 8_000);
    return pos().z < GOLRIE_GATE.z;
}

async function climbOutTomb(): Promise<void> {
    if (!inTomb()) return;
    await eatIfLow();
    intent('Climbing out of Glarial’s tomb');
    await walkNear(TOMB_LADDER.x, TOMB_LADDER.z, 2);
    await sdk.scanNearbyLocs(12);
    const ladder = locWithOp(/ladder/i, /climb/i) ?? sdk.findNearbyLoc(/ladder/i);
    if (!ladder) {
        log(`No tomb ladder @ ${pos().x},${pos().z}`);
        return;
    }
    await bot.interactLoc(ladder, /climb/i);
    try {
        await sdk.waitForCondition(() => pos().z < 6400, 12_000);
    } catch {
        /* ignore */
    }
    log(`After tomb climb-out @ ${pos().x},${pos().z} tomb=${inTomb()}`);
}

async function climbOut(): Promise<void> {
    if (inTomb()) {
        await climbOutTomb();
        return;
    }
    if (!inGnomeDungeon()) return;
    await meleeOff();
    if (distTo(GOLRIE.x, GOLRIE.z) < 12) {
        intent('Opening Golrie’s gate from the inside');
        await openGolrieGate();
    }
    intent('Climbing out of the gnome dungeon');
    await walkNear(GNOME_DUNGEON_LADDER.x, GNOME_DUNGEON_LADDER.z, 2);
    await sdk.scanNearbyLocs(16);
    const ladder = locWithOp(/ladder/i, /climb/i) ?? sdk.findNearbyLoc(/ladder/i);
    if (!ladder) {
        log(`No dungeon ladder @ ${pos().x},${pos().z}`);
        return;
    }
    const { z } = pos();
    await bot.interactLoc(ladder, /climb/i);
    try {
        await sdk.waitForCondition(() => pos().z < z - 100, 12_000);
    } catch {
        /* ignore */
    }
    log(`After climb-out @ ${pos().x},${pos().z} dungeon=${inGnomeDungeon()}`);
}

async function goBank(): Promise<void> {
    await meleeOff();
    if (sdk.getState()?.bank?.isOpen) return;
    if (locWithOp(/bank booth/i, /use-quickly|use/i)) return;
    if (distTo(SOUTH_ARDY_BANK.x, SOUTH_ARDY_BANK.z) <= 8) return;
    if (distTo(NORTH_ARDY_BANK.x, NORTH_ARDY_BANK.z) <= 8) return;
    intent('Walking to Ardougne bank');
    if (inTomb()) await climbOutTomb();
    if (distTo(TOMBSTONE.x, TOMBSTONE.z) < 80) {
        await walkWaypoints([...TO_TOMB].reverse());
    }
    const dest = distTo(SOUTH_ARDY_BANK.x, SOUTH_ARDY_BANK.z) <= distTo(NORTH_ARDY_BANK.x, NORTH_ARDY_BANK.z)
        ? SOUTH_ARDY_BANK
        : NORTH_ARDY_BANK;
    await walkNear(dest.x, dest.z, 3);
}

async function prepTomb(): Promise<boolean> {
    if (inGnomeDungeon()) await climbOut();
    if (tombReady()) return true;
    intent('Banking ALL weapons and armour before Glarial’s tomb');
    await goBank();
    await unequipAll();
    if (!(await openBankHere())) {
        log('Bank did not open for tomb prep');
        return false;
    }
    await depositAllExcept(PEBBLE);
    await withdrawPat(PEBBLE, 1);
    await withdrawPat(FOOD, 8);
    await bot.closeBank();
    log(
        `Tomb prep inv=${sdk.getInventory().map((i) => `${i.count ?? 1} ${i.name}`).join(', ') || 'empty'} ` +
            `gear=${sdk.getEquipment().map((e) => e.name).join(',') || 'none'} ready=${tombReady()}`
    );
    return tombReady();
}

async function lootTomb(): Promise<void> {
    if (!inTomb()) {
        if (!tombReady()) {
            log(`Refusing tombstone — still carrying: ${sdk.getInventory().map((i) => i.name).join(', ')}`);
            return;
        }
        intent('Using Glarial’s pebble on the tombstone');
        await walkWaypoints(TO_TOMB);
        await walkNear(TOMBSTONE.x, TOMBSTONE.z, 4);
        await sdk.scanNearbyLocs(12);
        const stone = sdk.findNearbyLoc(/tombstone/i);
        const pebble = sdk.findInventoryItem(PEBBLE);
        if (!stone || !pebble) {
            log(`Tombstone/pebble missing @ ${pos().x},${pos().z}`);
            return;
        }
        await bot.useItemOnLoc(pebble, stone, { timeout: 20_000 });
        try {
            await sdk.waitForCondition(() => inTomb(), 15_000);
        } catch {
            log(`Tomb did not open — banned items? gear=${sdk.getEquipment().map((e) => e.name).join(',')}`);
            return;
        }
    }
    intent('Looting Glarial’s tomb');
    await eatIfLow(60);

    if (count(AMULET) < 1) {
        await walkNear(TOMB_CHEST.x, TOMB_CHEST.z, 3);
        await eatIfLow();
        await sdk.scanNearbyLocs(12);
        const chestClosed = locWithOp(/closed chest/i, /open/i) ?? sdk.findNearbyLoc(/closed chest/i);
        if (chestClosed) {
            await bot.interactLoc(chestClosed, /open/i);
            await sdk.waitForTicks(2);
        }
        const chestOpen = locWithOp(/open chest/i, /search/i) ?? sdk.findNearbyLoc(/open chest/i);
        if (chestOpen) {
            await bot.interactLoc(chestOpen, /search/i);
            await sdk.waitForTicks(2);
        }
        if (count(AMULET) < 1) log(`No amulet yet @ ${pos().x},${pos().z}`);
    }

    if (count(URN) < 1) {
        await walkNear(TOMB_COFFIN.x, TOMB_COFFIN.z, 3);
        await eatIfLow();
        await sdk.scanNearbyLocs(12);
        const coffin = locWithOp(/tomb of glarial/i, /search/i) ?? sdk.findNearbyLoc(/tomb of glarial/i);
        if (coffin) {
            await bot.interactLoc(coffin, /search/i);
            await sdk.waitForTicks(2);
        }
        if (count(URN) < 1) log(`No urn yet @ ${pos().x},${pos().z}`);
    }

    log(`Tomb loot amulet=${count(AMULET)} urn=${count(URN)}`);
    if (count(AMULET) > 0 && count(URN) > 0) await climbOutTomb();
}

async function prepDungeon(): Promise<boolean> {
    intent('Withdrawing gear, amulet, urn, runes, rope, food');
    await goBank();
    await rechargePrayer();
    await goBank();
    if (!(await openBankHere())) return false;
    for (const item of [...sdk.getInventory()]) {
        if (AMULET.test(item.name) || URN.test(item.name) || KEEP_QUEST.test(item.name)) continue;
        if (BOW.test(item.name) || ARROW.test(item.name) || DHIDE.test(item.name)) continue;
        await bot.depositItem(item, -1);
    }
    await withdrawPat(BOW, 1);
    await withdrawPat(/dragonhide body/i, 1);
    await withdrawPat(/dragonhide chaps/i, 1);
    await withdrawPat(/dragon vambraces/i, 1);
    await withdrawPat(ARROW, 200);
    await withdrawPat(AMULET, 1);
    await withdrawPat(URN, 1);
    await withdrawPat(ROPE, 1);
    await withdrawPat(AIR, 6);
    await withdrawPat(WATER, 6);
    await withdrawPat(EARTH, 6);
    await withdrawPat(FOOD, 12);
    await bot.closeBank();

    for (const p of [BOW, /dragonhide body/i, /dragonhide chaps/i, /dragon vambraces/i, ARROW]) {
        const item = sdk.findInventoryItem(p);
        if (item) await bot.equipItem(item);
    }
    const amulet = sdk.findInventoryItem(AMULET);
    if (amulet) await bot.equipItem(amulet);

    const ok = count(URN) >= 1 && (count(AMULET) >= 1 || !!sdk.findEquipmentItem(AMULET)) && count(AIR) >= 6;
    log(
        `Dungeon kit urn=${count(URN)} amulet=${count(AMULET) || !!sdk.findEquipmentItem(AMULET)} ` +
            `air=${count(AIR)} water=${count(WATER)} earth=${count(EARTH)} rope=${count(ROPE)} ` +
            `food=${foodCount()} pray=${prayerPoints()}/${prayerBase()} ok=${ok}`
    );
    return ok;
}

async function placeRunesAndFinish(): Promise<void> {
    await meleeOn();
    await eatIfLow(50);
    if (count(KEY) < 1) {
        intent('Searching waterfall crate for the key');
        await walkNear(WF_CRATE.x, WF_CRATE.z, 3);
        const crate = sdk.findNearbyLoc(/^crate$/i);
        if (crate) {
            await bot.interactLoc(crate, /search/i);
            await sdk.waitForTicks(3);
        }
    }
    const key = sdk.findInventoryItem(KEY);
    intent('Unlocking the puzzle-room door');
    await walkNear(WF_DOOR.x, WF_DOOR.z, 3);
    await meleeOn();
    const door = sdk.findNearbyLoc(/^door$/i);
    if (key && door) await bot.useItemOnLoc(key, door, { timeout: 12_000 });
    else if (door) await bot.interactLoc(door, /open/i);

    intent('Placing air/water/earth runes on all six pillars');
    await walkNear(WF_PILLARS.x, WF_PILLARS.z, 4);
    await sdk.scanNearbyLocs(16);
    const pillars = (sdk.getNearbyLocs() ?? []).filter((l) => /^pillar$/i.test(l.name));
    for (const pillar of pillars) {
        await eatIfLow(40);
        await meleeOn();
        for (const rune of [AIR, EARTH, WATER]) {
            if (count(rune) < 1) continue;
            await bot.useItemOnLoc(rune, pillar, { timeout: 8_000 });
            await sdk.waitForTicks(1);
        }
    }

    const worn = sdk.findEquipmentItem(AMULET);
    if (worn) await bot.unequipItem(worn);
    intent('Using Glarial’s amulet on the statue');
    await walkNear(WF_STATUE.x, WF_STATUE.z, 3);
    const statue = sdk.findNearbyLoc(/statue of glarial/i);
    const amulet = sdk.findInventoryItem(AMULET);
    if (statue && amulet) {
        const { x, z } = pos();
        await bot.useItemOnLoc(amulet, statue, { timeout: 15_000 });
        await waitMoved(x, z, 15_000);
    }

    await meleeOff();
    while (occupiedSlots() > 23) {
        const drop = sdk.findInventoryItem(FOOD);
        if (!drop) break;
        await bot.eatFood(drop);
    }
    intent('Using Glarial’s urn on the Chalice of eternity');
    const chalice = sdk.findNearbyLoc(/chalice of eternity/i);
    const urn = sdk.findInventoryItem(URN);
    if (chalice && urn) {
        await bot.useItemOnLoc(urn, chalice, { timeout: 15_000 });
        await sdk.waitForTicks(4);
    }
}

function sawComplete(): boolean {
    if (count(SEEDS) > 0) return true;
    const xp = sdk.getSkill('Attack')?.experience ?? 0;
    if (xp - attackXpStart >= 13_000) return true;
    const msgs = sdk.getState()?.gameMessages ?? [];
    return msgs.some((m) => /completed the waterfall/i.test(m.text));
}

try {
    await bot.skipTutorial();
    await closeUi();
    log(
        `Waterfall start Attack ${sdk.getSkill('Attack')?.baseLevel} Strength ${sdk.getSkill('Strength')?.baseLevel} ` +
            `@ ${pos().x},${pos().z} hp=${pos().hp}/${pos().maxHp} gp=${coinCount()} food=${foodCount()} ` +
            `pray=${prayerPoints()}/${prayerBase()}`
    );

    const tombTrip = count(PEBBLE) > 0 && count(AMULET) < 1;
    if (tombTrip) {
        log('Pebble in pack — skipping rope/food restock, depositing weapons and armour first');
    }
    if (!tombTrip && !(await ensureSupplies())) {
        log('Missing rope/food from bank — stopping');
    } else {
        while (!questComplete) {
            await closeUi();
            await eatIfLow();
            if (pos().isDead) {
                await meleeOff();
                intent('Dead — waiting to respawn');
                await sdk.waitForCondition((s) => !s.player.isDead, 45_000).catch(() => {});
                continue;
            }
            if (sawComplete()) {
                questComplete = true;
                break;
            }
            if (!onIsland()) hudonThisVisit = false;

            if (inWaterfallDungeon()) {
                await placeRunesAndFinish();
                if (sawComplete()) questComplete = true;
                continue;
            }
            if (inTomb()) {
                await lootTomb();
                continue;
            }
            if (inGnomeDungeon()) {
                if (count(PEBBLE) < 1) await rescueGolrie();
                await climbOut();
                continue;
            }

            if (count(AMULET) > 0 && count(URN) > 0) {
                if (!(sdk.findEquipmentItem(AMULET) || count(AIR) >= 6)) {
                    await prepDungeon();
                }
                if (onLedge()) {
                    await enterWaterfallDoor();
                    continue;
                }
                if (onIsland()) {
                    await ropeAcross();
                    continue;
                }
                await talkAlmera();
                await boardRaft();
                continue;
            }

            if (count(PEBBLE) > 0 && count(AMULET) < 1) {
                if (!tombReady()) {
                    if (!(await prepTomb())) continue;
                }
                await lootTomb();
                continue;
            }

            if (onLedge() && count(AMULET) < 1) {
                await getInBarrel();
                continue;
            }
            if (onIsland()) {
                await ropeAcross();
                continue;
            }

            if ((bookRead || count(BOOK) > 0 || count(PEBBLE) > 0) && count(PEBBLE) < 1) {
                if (count(BOOK) > 0 && !bookRead) {
                    const book = sdk.findInventoryItem(BOOK);
                    if (book) {
                        await sdk.sendUseItem(book.slot, 1);
                        await sdk.waitForTicks(2);
                        await bot.closeInterface();
                        bookRead = true;
                    }
                }
                await rescueGolrie();
                continue;
            }

            if (distTo(HADLEY.x, HADLEY.z) < 20 && distTo(WASHED.x, WASHED.z) < 30 && !bookRead && count(PEBBLE) < 1) {
                const found = await readBaxtorianBook();
                if (found) continue;
                log('Quest bookcase did not give the book — will retry after Hudon if needed');
                await talkAlmera();
                await boardRaft();
                continue;
            }

            if (distTo(RAFT.x, RAFT.z) < 12 || distTo(ALMERA.x, ALMERA.z) < 12) {
                await talkAlmera();
                await boardRaft();
                continue;
            }

            intent('Heading to Almera at Baxtorian Falls');
            await walkWaypoints(TO_FALLS);
            await talkAlmera();
            await boardRaft();
        }
    }

    await meleeOff();
    log(
        `Waterfall ${questComplete ? 'complete' : 'stopped'} Attack ${sdk.getSkill('Attack')?.baseLevel} ` +
            `(${sdk.getSkill('Attack')?.experience} xp) Strength ${sdk.getSkill('Strength')?.baseLevel} ` +
            `inv=${sdk.getInventory().map((i) => `${i.count ?? 1} ${i.name}`).join(', ')}`
    );
} catch (err) {
    console.error('Script error:', err);
    throw err;
} finally {
    try {
        if (sdk.isPrayerActive(PROT_MELEE)) await bot.deactivatePrayer(PROT_MELEE);
    } catch {
        /* ignore */
    }
    console.log('Disconnecting SDK; browser client can stay open.');
    await sdk.disconnect();
}
