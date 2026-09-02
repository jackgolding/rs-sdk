/**
 * Rune Mysteries, then mine rune essence (the unbound stones — "pure ess").
 *
 *   bun bots/quests/rune-mysteries.ts {botname}
 *   bun bots/quests/rune-mysteries.ts {botname} --quest-only
 *
 * Starts the Duke Horacio → Sedridor → Aubury → Sedridor loop, then banks
 * essence via Aubury's teleport (Varrock east bank). Kandarin bots bank
 * everything and die to respawn in Lumbridge.
 */
import { BotSDK, deriveGatewayUrl } from '../../sdk/index';
import { BotActions } from '../../sdk/actions';
import { initPathfinding } from '../../sdk/pathfinding';
import { existsSync, readFileSync, appendFileSync } from 'fs';
import { dirname, join } from 'path';

const DUKE = { x: 3212, z: 3220 };
const CASTLE_STAIRS = { x: 3205, z: 3208 };
const WIZARD_TOWER = { x: 3109, z: 3162 };
const AUBURY = { x: 3253, z: 3401 };
/** Typical essence-rock cluster after an Aubury teleport (Jackpoo2 landings). */
const ESSENCE_ROCKS = { x: 2926, z: 4818 };
const VARROCK_EAST_BANK = { x: 3253, z: 3420 };
const BOBS_AXES = { x: 3232, z: 3203 };
const ARDOUGNE_BANK = { x: 2655, z: 3283 };
const HEROES = { x: 2630, z: 3288 };
const LUMBRIDGE_MEN = { x: 3222, z: 3218 };
const TOWER_TO_VARROCK = [
    { x: 3109, z: 3162 },
    { x: 3105, z: 3290 },
    { x: 3080, z: 3420 },
    { x: 3180, z: 3430 },
    { x: 3253, z: 3401 }
];
const VARROCK_TO_TOWER = [...TOWER_TO_VARROCK].reverse();
const LUMBRIDGE_TO_TOWER = [
    { x: 3210, z: 3212 },
    { x: 3140, z: 3208 },
    { x: 3109, z: 3162 }
];

const PICKAXE = /^(bronze|iron|steel|mithril|adamant|rune) pickaxe$/i;
const ESSENCE = /^(rune essence|pure essence)$/i;
const TALISMAN = /^air talisman$/i;
const PACKAGE = /^research package$/i;
const NOTES = /^notes$/i;
const QUEST_KEEP =
    /^(air talisman|research package|research notes|notes|(bronze|iron|steel|mithril|adamant|rune) pickaxe|coins)$/i;
const FOOD = /lobster|swordfish|tuna|shark|wine/i;

const argv = process.argv.slice(2);
const botArg = argv.find((a) => !a.startsWith('-'));
const questOnly = argv.includes('--quest-only');

function loadBotEnv(): void {
    const envPath = botArg
        ? join(process.cwd(), 'bots', botArg, 'bot.env')
        : join(dirname(import.meta.path), 'bot.env');
    if (!existsSync(envPath)) {
        throw new Error(`bot.env not found at ${envPath}. Usage: bun bots/quests/rune-mysteries.ts {botname}`);
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
let lastLoggedMine = 0;
let essenceBanked = 0;

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
        isDead: p?.isDead ?? false,
        inCombat: p?.combat?.inCombat ?? false,
        animId: p?.animId ?? -1,
        lifeId: p?.lifeId
    };
}

function distTo(x: number, z: number): number {
    return Math.hypot(pos().x - x, pos().z - z);
}

function mining(): number {
    return sdk.getSkill('Mining')?.baseLevel ?? 1;
}

function miningXp(): number {
    return sdk.getSkill('Mining')?.experience ?? 0;
}

function occupiedSlots(): number {
    return sdk.getInventory().filter((i) => (i.count ?? 0) > 0).length;
}

/** Essence is unstackable; CLI may group stacks. Bank before the last slot. */
function bagFull(): boolean {
    return occupiedSlots() >= 27 || count(ESSENCE) >= 24;
}

function count(pattern: RegExp): number {
    return sdk.getInventory().filter((i) => pattern.test(i.name)).reduce((n, i) => n + (i.count ?? 1), 0);
}

function coinCount(): number {
    return sdk.findInventoryItem(/^coins$/i)?.count ?? 0;
}

function hasPickaxe(): boolean {
    return !!(sdk.findInventoryItem(PICKAXE) || sdk.findEquipmentItem(PICKAXE));
}

function has(pattern: RegExp): boolean {
    return !!sdk.findInventoryItem(pattern);
}

function npcHas(pattern: RegExp, option: RegExp): boolean {
    const npc = sdk.findNearbyNpc(pattern);
    return !!npc?.optionsWithIndex.some((o) => option.test(o.text));
}

function questDone(): boolean {
    // Teleport is on the NPC before the quest is finished; using it prints
    // "need to have completed the Rune Mysteries". Notes/package mean we are not done.
    if (has(NOTES) || has(PACKAGE)) {
        questComplete = false;
        return false;
    }
    if (questComplete) return true;
    const msgs = sdk.getState()?.gameMessages ?? [];
    if (msgs.some((m) => /you have completed the.*mysteries of the runes/i.test(m.text))) {
        questComplete = true;
        return true;
    }
    return false;
}

function inKandarin(): boolean {
    const p = pos();
    return p.x > 2400 && p.x < 2878 && p.z > 3200 && p.z < 3550 && p.z < 6400;
}

function onKaramja(): boolean {
    const p = pos();
    return p.x > 2680 && p.x < 3010 && p.z > 3040 && p.z < 3270;
}

function inWizardBasement(): boolean {
    const p = pos();
    return p.x >= 3088 && p.x <= 3124 && p.z >= 9520 && p.z <= 9610;
}

function inEssenceMine(): boolean {
    if (sdk.findNearbyLoc(/rune essence/i, { withOption: /mine/i })) return true;
    const p = pos();
    return p.x >= 2860 && p.x <= 3040 && p.z >= 4760 && p.z <= 4940;
}

function packedEmpty(): boolean {
    const worn = bot.getEquipment().filter((i) => (i.count ?? 0) > 0);
    const extra = worn.filter((i) => !PICKAXE.test(i.name));
    return occupiedSlots() === 0 && extra.length === 0;
}

async function closeUi(): Promise<void> {
    await bot.dismissBlockingUI();
    const dialog = sdk.getDialog();
    if (dialog?.isOpen) {
        const opts = dialog.options ?? [];
        const continueOnly =
            opts.length <= 1 || opts.every((o) => /click here to continue|please wait/i.test(o.text));
        const decline = opts.find((o) => /no thank you|i'?m not interested|never mind/i.test(o.text));
        if (continueOnly && opts[0]) {
            await sdk.sendClickDialog(opts[0].index);
            await sdk.waitForTicks(1);
        } else if (decline) {
            await sdk.sendClickDialog(decline.index);
            await sdk.waitForTicks(1);
        }
    }
    if (sdk.getState()?.shop?.isOpen) {
        await bot.closeShop();
    } else if (sdk.getState()?.bank?.isOpen) {
        await bot.closeBank();
    } else if (sdk.getState()?.interface?.isOpen) {
        await bot.closeInterface();
    }
    await bot.dismissBlockingUI();
}

/** Shop NPCs must not be fought. Walk to the east bank to drop combat. */
async function fleeCombat(): Promise<void> {
    if (!pos().inCombat) return;
    if (inKandarin() || onKaramja()) return;
    intent('Leaving combat');
    await walkNear(VARROCK_EAST_BANK.x, VARROCK_EAST_BANK.z, 3);
}

/** Click continues; on a multi-option page pick the first matching choice. */
async function chat(choices: RegExp[] = [], max = 40): Promise<string[]> {
    const seen: string[] = [];
    let closed = 0;
    for (let i = 0; i < max; i++) {
        const dialog = sdk.getDialog();
        if (!dialog?.isOpen) {
            closed++;
            if (closed >= 3) break;
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
    const result = await bot.walkTo(x, z, Math.min(tolerance, 3));
    return result.success || distTo(x, z) <= tolerance + 2;
}

async function walkWaypoints(points: { x: number; z: number }[]): Promise<void> {
    const dest = points[points.length - 1]!;
    for (const p of points) {
        if (distTo(p.x, p.z) <= 8) continue;
        if (Math.hypot(dest.x - p.x, dest.z - p.z) >= distTo(dest.x, dest.z) - 4) continue;
        await walkNear(p.x, p.z, 6);
    }
    if (distTo(dest.x, dest.z) > 6) await walkNear(dest.x, dest.z, 4);
}

async function openToward(tx: number, tz: number): Promise<void> {
    const door = (sdk.getNearbyLocs() ?? [])
        .filter(
            (l) =>
                /door|gate/i.test(l.name) &&
                l.reachable !== false &&
                l.optionsWithIndex.some((o) => /^open$/i.test(o.text))
        )
        .sort((a, b) => Math.hypot(a.x - tx, a.z - tz) - Math.hypot(b.x - tx, b.z - tz))[0];
    if (door && (door.distance ?? 99) <= 10) await bot.openDoor(door);
}

/** The tower door blocks Varrock pathfinding until it is opened. */
async function leaveWizardTower(): Promise<void> {
    if (pos().z >= 3172 || pos().x < 3088 || pos().x > 3124 || pos().z > 6400) return;
    intent('Leaving Wizards Tower');
    for (let i = 0; i < 8 && pos().z < 3172; i++) {
        await openToward(3104, 3210);
        const door = (sdk.getNearbyLocs() ?? [])
            .filter(
                (l) =>
                    /door/i.test(l.name) && l.optionsWithIndex.some((o) => /^open$/i.test(o.text))
            )
            .sort((a, b) => (a.distance ?? 99) - (b.distance ?? 99))[0];
        if (door) await bot.openDoor(door);
        if (await walkNear(3104, 3210, 4)) return;
        await sdk.sendWalk(pos().x, pos().z + 2, true);
        await sdk.waitForTicks(2);
    }
}

async function climb(want: 'up' | 'down'): Promise<boolean> {
    const opt = want === 'up' ? /climb-up|climb.up|go-up/i : /climb-down|climb.down|go-down/i;
    const beforeZ = pos().z;
    const beforeLevel = pos().level;
    for (let i = 0; i < 6; i++) {
        const loc = (sdk.getNearbyLocs() ?? [])
            .filter((l) => /stair|ladder/i.test(l.name) && l.optionsWithIndex.some((o) => opt.test(o.text)))
            .sort(
                (a, b) =>
                    (a.reachable === false ? 1 : 0) - (b.reachable === false ? 1 : 0) ||
                    (a.distance ?? 99) - (b.distance ?? 99)
            )[0];
        if (!loc) {
            await sdk.scanNearbyLocs(8).catch(() => {});
            await sdk.waitForTicks(1);
            continue;
        }
        intent(`Climb ${want} ${loc.name} @ ${loc.x},${loc.z}`);
        if ((loc.distance ?? 99) > 2) await walkNear(loc.x, loc.z, 1);
        const match = loc.optionsWithIndex.find((o) => opt.test(o.text));
        if (match && (loc.distance ?? 99) <= 2) {
            await sdk.sendInteractLoc(loc.x, loc.z, loc.id, match.opIndex);
        } else {
            await bot.interactLoc(loc, opt);
        }
        await sdk
            .waitForCondition((s) => {
                const p = s.player;
                if (!p) return false;
                return p.level !== beforeLevel || Math.abs((p.worldZ ?? p.z) - beforeZ) > 8;
            }, 8_000)
            .catch(() => {});
        await closeUi();
        if (pos().level !== beforeLevel || Math.abs(pos().z - beforeZ) > 8) return true;
    }
    return false;
}

async function talk(pattern: RegExp): Promise<boolean> {
    await closeUi();
    const npc = sdk.findNearbyNpc(pattern, { reachable: true }) ?? sdk.findNearbyNpc(pattern);
    if (!npc) return false;
    const r = await bot.talkTo(npc);
    if (!r.success) {
        log(`talk ${npc.name}: ${r.message}`);
        return false;
    }
    await sdk.waitForTicks(1);
    return true;
}

async function bankAt(spot: { x: number; z: number }, keep = QUEST_KEEP): Promise<boolean> {
    await closeUi();
    if (distTo(spot.x, spot.z) > 8) await walkNear(spot.x, spot.z, 3);
    if (!(sdk.getState()?.bank?.isOpen || (await bot.openBank()).success)) {
        log(`Bank open failed @ ${spot.x},${spot.z}`);
        return false;
    }
    for (const item of [...sdk.getInventory()]) {
        if (keep.test(item.name)) continue;
        await bot.depositItem(item, -1);
    }
    if (coinCount() < 80) {
        const coins = sdk.findBankItem(/^coins$/i);
        if (coins) await bot.withdrawItem(coins, Math.min(200, coins.count));
    }
    if (!hasPickaxe()) {
        const pick =
            sdk.findBankItem(/^rune pickaxe$/i) ??
            sdk.findBankItem(/^adamant pickaxe$/i) ??
            sdk.findBankItem(/^mithril pickaxe$/i) ??
            sdk.findBankItem(/^steel pickaxe$/i) ??
            sdk.findBankItem(/^iron pickaxe$/i) ??
            sdk.findBankItem(PICKAXE);
        if (pick) {
            const r = await bot.withdrawItem(pick, 1);
            log(`Withdraw ${pick.name}: ${r.success ? 'ok' : r.message}`);
        }
    }
    const foodHeld = sdk.getInventory().filter((i) => FOOD.test(i.name) && i.count === 1).length;
    if (foodHeld < 2) {
        const food =
            sdk.findBankItem(/^lobster$/i) ??
            sdk.findBankItem(/^swordfish$/i) ??
            sdk.findBankItem(/^tuna$/i);
        if (food) await bot.withdrawItem(food, Math.min(3, food.count), { asNote: false });
    }
    await bot.closeBank();
    return true;
}

async function buyPickaxe(): Promise<boolean> {
    if (hasPickaxe()) return true;
    if (pos().level > 0) await climb('down');
    intent("Buying a bronze pickaxe from Bob's");
    // South of the castle first — a courtyard trapdoor used to steal the walk.
    if (pos().x < 3238 && pos().z > 3210) {
        await walkNear(3224, 3203, 3);
    }
    await walkNear(BOBS_AXES.x, BOBS_AXES.z, 2);
    await openToward(BOBS_AXES.x, BOBS_AXES.z);

    let opened = await bot.openShop(/^bob$/i);
    if (!opened.success && !sdk.getState()?.shop?.isOpen) {
        log(`openShop Bob: ${opened.message} — retrying Trade`);
        const trade = await bot.interactNpc(/^bob$/i, /trade/i);
        log(`trade Bob: ${trade.success ? 'ok' : trade.message}`);
        await sdk.waitForCondition((s) => s.shop?.isOpen, 8_000).catch(() => {});
    }
    if (!sdk.getState()?.shop?.isOpen && sdk.getDialog()?.isOpen) {
        await chat([/have you anything to sell/i]);
        await sdk.waitForCondition((s) => s.shop?.isOpen, 8_000).catch(() => {});
    }
    if (!sdk.getState()?.shop?.isOpen) {
        const npcs = (sdk.getNearbyNpcs() ?? [])
            .slice(0, 8)
            .map((n) => `${n.name}[${n.options.join(',')}] d=${n.distance}`)
            .join('; ');
        const locs = (sdk.getNearbyLocs() ?? [])
            .filter((l) => /door|gate|trap/i.test(l.name))
            .slice(0, 6)
            .map((l) => `${l.name}@${l.x},${l.z}[${l.options.join(',')}]`)
            .join('; ');
        log(`Bob shop still closed @ ${pos().x},${pos().z}. Nearby: ${npcs || 'none'} | ${locs || 'no doors'}`);
        return false;
    }
    if (coinCount() < 1) {
        log('No coins for a pickaxe');
        await bot.closeShop();
        return false;
    }
    const bought = await bot.buyFromShop(/bronze pickaxe/i, 1);
    log(`Buy bronze pickaxe: ${bought.success ? 'ok' : bought.message}`);
    await bot.closeShop();
    return hasPickaxe();
}

async function equipPickaxe(): Promise<void> {
    const inv = sdk.findInventoryItem(PICKAXE);
    if (inv && !sdk.findEquipmentItem(PICKAXE)) await bot.equipItem(inv);
}

async function goToDuke(): Promise<boolean> {
    await closeUi();
    if (inWizardBasement()) {
        await climb('up');
        return false;
    }
    if (pos().level > 1) await climb('down');
    if (sdk.findNearbyNpc(/duke/i) && pos().level === 1) return true;

    intent('Walking to Duke Horacio');
    if (pos().level > 0 && distTo(CASTLE_STAIRS.x, CASTLE_STAIRS.z) > 30) await climb('down');
    if (distTo(CASTLE_STAIRS.x, CASTLE_STAIRS.z) > 6) {
        await walkNear(CASTLE_STAIRS.x, CASTLE_STAIRS.z, 2);
    }
    await openToward(CASTLE_STAIRS.x, CASTLE_STAIRS.z);
    if (pos().level < 1) await climb('up');
    if (pos().level !== 1) return false;
    await openToward(DUKE.x, DUKE.z);
    await walkNear(DUKE.x, DUKE.z, 2);
    return !!sdk.findNearbyNpc(/duke/i);
}

async function goToSedridor(): Promise<boolean> {
    await closeUi();
    if (sdk.findNearbyNpc(/sedridor/i)) return true;
    if (inEssenceMine()) {
        await exitEssencePortal();
        return false;
    }
    if (!inWizardBasement()) {
        intent('Walking to Wizards Tower basement');
        if (pos().level > 0) await climb('down');
        if (distTo(WIZARD_TOWER.x, WIZARD_TOWER.z) > 12) {
            if (pos().z > 3300 && pos().x > 3150) await walkWaypoints(VARROCK_TO_TOWER);
            else if (pos().x > 3180) await walkWaypoints(LUMBRIDGE_TO_TOWER);
            else await walkNear(WIZARD_TOWER.x, WIZARD_TOWER.z, 3);
        }
        await openToward(WIZARD_TOWER.x, WIZARD_TOWER.z);
        await walkNear(WIZARD_TOWER.x, WIZARD_TOWER.z, 2);
        if (!(await climb('down'))) {
            log(`Could not climb into the tower basement @ ${pos().x},${pos().z} lv${pos().level}`);
            return false;
        }
    }
    await openToward(3103, 9571);
    await walkNear(3103, 9571, 2);
    return !!sdk.findNearbyNpc(/sedridor/i);
}

async function goToAubury(): Promise<boolean> {
    await closeUi();
    if (sdk.findNearbyNpc(/aubury/i)) return true;
    if (inEssenceMine()) {
        await exitEssencePortal();
        return false;
    }
    if (inWizardBasement()) {
        await climb('up');
        return false;
    }
    if (pos().level > 0) await climb('down');
    await leaveWizardTower();
    intent('Walking to Aubury in Varrock');
    if (distTo(AUBURY.x, AUBURY.z) > 20) {
        if (pos().x < 3150 && pos().z < 3300) await walkWaypoints(TOWER_TO_VARROCK);
        else if (pos().x < 3180 && pos().z > 3300) await walkNear(3180, 3430, 4);
        else await walkNear(AUBURY.x, AUBURY.z, 3);
    }
    await openToward(AUBURY.x, AUBURY.z);
    await walkNear(AUBURY.x, AUBURY.z, 2);
    if (!sdk.findNearbyNpc(/aubury/i)) {
        await openToward(AUBURY.x, AUBURY.z);
        await walkNear(AUBURY.x, AUBURY.z, 1);
    }
    return !!sdk.findNearbyNpc(/aubury/i);
}

async function depositEverything(): Promise<boolean> {
    await closeUi();
    if (distTo(ARDOUGNE_BANK.x, ARDOUGNE_BANK.z) > 8) {
        intent('Walking to Ardougne bank to dump everything');
        await walkNear(ARDOUGNE_BANK.x, ARDOUGNE_BANK.z, 3);
    }
    for (let round = 0; round < 6 && !packedEmpty(); round++) {
        if (!(sdk.getState()?.bank?.isOpen || (await bot.openBank()).success)) {
            log(`Bank open failed while stripping @ ${pos().x},${pos().z}`);
            return false;
        }
        for (const item of [...sdk.getInventory()]) {
            if ((item.count ?? 0) <= 0) continue;
            await bot.depositItem(item, -1);
        }
        await bot.closeBank();
        const worn = bot.getEquipment().filter((i) => (i.count ?? 0) > 0 && !PICKAXE.test(i.name));
        if (worn[0]) {
            intent(`Unequipping ${worn[0].name}`);
            await bot.unequipItem(worn[0]);
        }
    }
    const empty = packedEmpty();
    log(`Strip-and-bank ${empty ? 'ok' : 'still carrying stuff'} inv=${occupiedSlots()} worn=${bot.getEquipment().length}`);
    return empty;
}

function findSuicideNpc() {
    return (
        sdk.findNearbyNpc(/^hero$/i, { reachable: true }) ??
        sdk.findNearbyNpc(/^paladin$/i, { reachable: true }) ??
        sdk.findNearbyNpc(/^knight of ardougne$/i, { reachable: true }) ??
        sdk.findNearbyNpc(/^hero$/i) ??
        sdk.findNearbyNpc(/^paladin$/i) ??
        sdk.findNearbyNpc(/^knight of ardougne$/i)
    );
}

/** Bank every item, then die to a hero/paladin so we respawn in Lumbridge. */
async function suicideToLumbridge(): Promise<void> {
    if (pos().isDead) return;
    if (!inKandarin() && !onKaramja()) return;

    if (pos().inCombat) {
        intent(`Waiting to die (${pos().hp}/${pos().maxHp} hp) — not eating`);
        await sdk.waitForCondition((s) => !!s.player?.isDead, 45_000).catch(() => {});
        return;
    }

    if (!packedEmpty()) {
        await depositEverything();
        return;
    }

    if (distTo(HEROES.x, HEROES.z) > 8) {
        intent('Walking to heroes to die');
        await walkNear(HEROES.x, HEROES.z, 4);
        return;
    }

    const npc = findSuicideNpc();
    if (!npc) {
        log('No hero/paladin/knight nearby to die on');
        await walkNear(HEROES.x, HEROES.z, 3);
        return;
    }

    const life = pos().lifeId;
    intent(`Attacking ${npc.name} — Lumbridge respawn (keep pickaxe)`);
    const r = await bot.attack(npc, 8_000);
    log(`Suicide attack ${npc.name}: ${r.success ? 'ok' : r.message} HP ${pos().hp} combat=${pos().inCombat}`);
    if (!r.success && !pos().inCombat && !pos().isDead) {
        await sdk.waitForTicks(2);
        return;
    }
    await sdk
        .waitForCondition((s) => !!s.player?.isDead || (life !== undefined && s.player?.lifeId !== life), 45_000)
        .catch(() => {});
    if (pos().isDead || (life !== undefined && pos().lifeId !== life)) {
        log(`Died @ ${pos().x},${pos().z} — waiting for Lumbridge`);
    }
}

async function pickpocketForCoins(): Promise<void> {
    if (coinCount() >= 1) return;
    intent('Pickpocketing a Lumbridge man for pickaxe money');
    if (distTo(LUMBRIDGE_MEN.x, LUMBRIDGE_MEN.z) > 8) await walkNear(LUMBRIDGE_MEN.x, LUMBRIDGE_MEN.z, 3);
    const npc =
        sdk.findNearbyNpc(/^man$/i, { reachable: true }) ??
        sdk.findNearbyNpc(/^woman$/i, { reachable: true }) ??
        sdk.findNearbyNpc(/^(man|woman)$/i);
    if (!npc) return;
    await bot.pickpocketNpc(npc);
}

async function reachLumbridge(): Promise<boolean> {
    if (sdk.findNearbyNpc(/duke/i) || (pos().x > 3180 && pos().x < 3240 && pos().z > 3200 && pos().z < 3235 && pos().z < 6400)) {
        return true;
    }
    if (inKandarin() || onKaramja()) {
        await suicideToLumbridge();
        return false;
    }
    if (pos().z > 6400) {
        await climb('up');
        return false;
    }
    if (pos().level > 0) await climb('down');
    intent('Walking to Lumbridge castle');
    await walkNear(CASTLE_STAIRS.x, CASTLE_STAIRS.z, 4);
    return distTo(CASTLE_STAIRS.x, CASTLE_STAIRS.z) <= 12;
}

async function startWithDuke(): Promise<void> {
    if (!(await goToDuke())) return;
    if (!(await talk(/duke/i))) return;
    const seen = await chat([
        /have you any quests/i,
        /sure, no problem/i
    ]);
    const text = seen.join(' | ');
    log(`Duke: ${text.slice(0, 240)}`);
    if (/no, all is well/i.test(text)) {
        questComplete = true;
        log('Rune Mysteries already complete (Duke)');
    }
    if (has(/air talisman/i)) log('Have air talisman');
    await closeUi();
}

async function talkSedridor(): Promise<void> {
    if (!(await goToSedridor())) return;
    await openToward(3103, 9571);
    const hadNotes = has(NOTES);
    if (hadNotes) {
        const npc = sdk.findNearbyNpc(/sedridor/i);
        const notes = sdk.findInventoryItem(NOTES);
        if (npc && notes) {
            intent('Using research notes on Sedridor');
            await bot.useItemOnNpc(notes, npc);
            await chat([/ok, here you are/i, /yes, certainly/i, /notes/i]);
        }
    }
    if (has(NOTES) || !hadNotes) {
        if (!(await talk(/sedridor/i))) return;
    }
    const seen = await chat([
        /looking for the head wizard/i,
        /ok, here you are/i,
        /yes, certainly/i,
        /notes/i,
        /can you teleport me to the rune essence/i
    ]);
    const text = seen.join(' | ');
    log(`Sedridor: ${text.slice(0, 280)}`);
    if (/can you teleport me to the rune essence/i.test(text) && !has(NOTES) && !has(PACKAGE)) {
        questComplete = true;
        log('QUEST COMPLETE Rune Mysteries (Sedridor offers essence teleport)');
    }
    if (hadNotes && !has(NOTES) && has(TALISMAN)) {
        questComplete = true;
        log('QUEST COMPLETE Rune Mysteries');
    }
    if (has(/research package/i)) log('Have research package');
    await closeUi();
}

async function talkAubury(): Promise<void> {
    if (has(NOTES) && !has(PACKAGE)) {
        await closeUi();
        return;
    }
    if (!(await goToAubury())) return;
    if (has(PACKAGE)) {
        const npc = sdk.findNearbyNpc(/aubury/i);
        if (npc) {
            const pkg = sdk.findInventoryItem(PACKAGE);
            if (pkg) {
                intent('Using research package on Aubury');
                await bot.useItemOnNpc(pkg, npc);
                await chat([]);
            }
        }
    }
    if (!(await talk(/aubury/i))) return;
    const seen = await chat([/package for you/i]);
    const text = seen.join(' | ');
    log(`Aubury: ${text.slice(0, 240)}`);
    if (has(NOTES)) log('Have research notes (item name: Notes)');
    if (sdk.getState()?.shop?.isOpen) await bot.closeShop();
    await closeUi();
}

async function exitEssencePortal(): Promise<boolean> {
    for (let attempt = 0; attempt < 5 && inEssenceMine(); attempt++) {
        await closeUi();
        let portal = sdk.findNearbyLoc(/^portal$/i) ?? sdk.findNearbyLoc(/portal/i);
        if (!portal) {
            await sdk.scanNearbyLocs(20).catch(() => {});
            portal = sdk.findNearbyLoc(/portal/i);
        }
        if (!portal) {
            intent('Walking to the essence portal');
            await walkNear(2885, 4850, 4);
            continue;
        }
        if ((portal.distance ?? 99) > 2) await walkNear(portal.x, portal.z, 1);
        intent('Stepping through the essence portal');
        await bot.interactLoc(portal, /use|enter|climb/i);
        await sdk
            .waitForCondition((s) => {
                const z = s.player?.worldZ ?? 0;
                const x = s.player?.worldX ?? 0;
                return !(x >= 2860 && x <= 3040 && z >= 4760 && z <= 4940);
            }, 8_000)
            .catch(() => {});
        if (!inEssenceMine()) return true;
    }
    return !inEssenceMine();
}

function teleportStagger(): number {
    let h = 0;
    for (let i = 0; i < username.length; i++) h += username.charCodeAt(i);
    return (h % 5) + 1;
}

async function teleportToEssence(): Promise<boolean> {
    if (inEssenceMine()) return true;
    await fleeCombat();
    await closeUi();
    if (pos().inCombat) return false;
    if (!sdk.findNearbyNpc(/aubury/i) && !sdk.findNearbyNpc(/sedridor/i) && !sdk.findNearbyNpc(/cromperty/i)) {
        if (!(await goToAubury())) return false;
    }
    await sdk.waitForTicks(teleportStagger());
    const teleporter =
        sdk.findNearbyNpc(/aubury/i) ??
        sdk.findNearbyNpc(/sedridor/i) ??
        sdk.findNearbyNpc(/cromperty/i);
    if (!teleporter) return false;
    if (pos().inCombat) {
        await fleeCombat();
        return false;
    }
    const teleOpt = teleporter.optionsWithIndex.find((o) => /teleport/i.test(o.text));
    if (!teleOpt) {
        log(`No Teleport on ${teleporter.name} [${teleporter.options.join(',')}] — not talking (avoids Attack/shop)`);
        await openToward(teleporter.x, teleporter.z);
        await walkNear(teleporter.x, teleporter.z, 1);
        return false;
    }
    const beforeTick = sdk.getState()?.tick ?? 0;
    intent(`Teleport via ${teleporter.name}`);
    const r = await bot.interactNpc(teleporter, /teleport/i);
    if (!r.success) log(`teleport: ${r.message}`);
    await sdk.waitForCondition(() => inEssenceMine(), 12_000).catch(() => {});
    const refused = (sdk.getState()?.gameMessages ?? []).some(
        (m) => m.tick > beforeTick && /need to have completed the rune mysteries/i.test(m.text)
    );
    if (refused) {
        questComplete = false;
        log('Teleport refused — Rune Mysteries is not finished');
        return false;
    }
    return inEssenceMine();
}

function findEssenceRock() {
    const match = (l: { name: string; optionsWithIndex: { text: string }[]; distance?: number }) =>
        /rune essence/i.test(l.name) && l.optionsWithIndex.some((o) => /^mine$/i.test(o.text));
    return (
        (sdk.getNearbyLocs() ?? [])
            .filter(match)
            .sort((a, b) => (a.distance ?? 99) - (b.distance ?? 99))[0] ??
        sdk.findNearbyLoc(/rune essence/i, { withOption: /mine/i }) ??
        null
    );
}

async function mineEssence(): Promise<boolean> {
    const before = count(ESSENCE);
    const xpBefore = miningXp();
    if (bagFull()) return false;
    let rock = findEssenceRock();
    if (!rock) {
        await sdk.scanNearbyLocs(20).catch(() => {});
        rock = findEssenceRock();
    }
    if (!rock) {
        intent('Walking toward essence rocks');
        await walkNear(ESSENCE_ROCKS.x, ESSENCE_ROCKS.z, 6);
        await sdk.scanNearbyLocs(20).catch(() => {});
        rock = findEssenceRock();
    }
    if (!rock) {
        const names = (sdk.getNearbyLocs() ?? []).map((l) => l.name).slice(0, 8).join(', ');
        log(`No essence rock nearby @ ${pos().x},${pos().z} locs=${names}`);
        await sdk.waitForTicks(2);
        return false;
    }
    intent(`Mine ${rock.name} @ ${rock.x},${rock.z}`);
    const r = await bot.interactLoc(rock, /mine/i);
    await sdk
        .waitForCondition(
            (s) =>
                s.inventory.filter((i) => ESSENCE.test(i.name)).reduce((n, i) => n + (i.count ?? 1), 0) > before ||
                s.inventory.filter((i) => (i.count ?? 0) > 0).length >= 28 ||
                (s.skills.find((sk) => sk.name === 'Mining')?.experience ?? 0) > xpBefore,
            18_000
        )
        .catch(() => {});
    await closeUi();
    if (count(ESSENCE) > before || miningXp() > xpBefore) return true;
    if (!r.success) log(`mine: ${r.message}`);
    await sdk.waitForTicks(2);
    return count(ESSENCE) > before;
}

async function ensureBankClosed(): Promise<boolean> {
    for (let attempt = 0; attempt < 4; attempt++) {
        await bot.dismissBlockingUI();
        if (!sdk.getState()?.bank?.isOpen && !sdk.getState()?.interface?.isOpen) return true;
        const closed = await bot.closeBank();
        if (!closed.success) log(`closeBank: ${closed.message}`);
        await sdk.waitForTicks(1);
    }
    const stuck = sdk.getState()?.bank?.isOpen || sdk.getState()?.interface?.isOpen;
    if (stuck) log('Bank interface still open after close retries');
    return !stuck;
}

async function bankEssence(): Promise<void> {
    if (inEssenceMine()) {
        await exitEssencePortal();
        return;
    }
    if (inWizardBasement()) {
        await climb('up');
        return;
    }
    if (pos().level > 0) await climb('down');
    await leaveWizardTower();
    await closeUi();
    intent('Banking rune essence at Varrock east');
    if (distTo(VARROCK_EAST_BANK.x, VARROCK_EAST_BANK.z) > 20) {
        if (pos().x < 3150 && pos().z < 3300) await walkWaypoints(TOWER_TO_VARROCK);
    }
    if (distTo(VARROCK_EAST_BANK.x, VARROCK_EAST_BANK.z) > 8) {
        await walkNear(VARROCK_EAST_BANK.x, VARROCK_EAST_BANK.z, 3);
    }
    if (!(sdk.getState()?.bank?.isOpen || (await bot.openBank()).success)) {
        log('Varrock east bank open failed');
        return;
    }
    const before = count(ESSENCE);
    if (before > 0) await bot.depositItem(ESSENCE, -1);
    for (;;) {
        const junk = sdk.getInventory().find((i) => (i.count ?? 0) > 0 && !PICKAXE.test(i.name));
        if (!junk) break;
        const r = await bot.depositItem(junk, -1);
        if (!r.success) break;
    }
    essenceBanked += before - count(ESSENCE);
    if (!hasPickaxe()) {
        const pick = sdk.findBankItem(PICKAXE);
        if (pick) await bot.withdrawItem(pick, 1);
    }
    if (!(await ensureBankClosed())) return;
    log(`Banked essence | trip left ${count(ESSENCE)} | session ~${essenceBanked} | Mining ${mining()} (${miningXp()} xp)`);
}

try {
    lastLoggedMine = mining();
    await bot.skipTutorial();
    await closeUi();
    questDone();
    if (!questComplete && !has(NOTES) && !has(PACKAGE)) {
        if (inEssenceMine() || count(ESSENCE) > 0) {
            questComplete = true;
            log('Quest already done (in essence mine or carrying essence)');
        } else if (mining() >= 20) {
            // Empty at the bank after a restart — do not walk back to the Duke.
            questComplete = true;
            log(`Quest already done (Mining ${mining()}, no package/notes)`);
        }
    }
    log(
        `Rune Mysteries start Mining ${lastLoggedMine} (${miningXp()} xp) @ ${pos().x},${pos().z} lv${pos().level} ` +
            `gp=${coinCount()} pick=${sdk.findEquipmentItem(PICKAXE)?.name ?? sdk.findInventoryItem(PICKAXE)?.name ?? 'none'} ` +
            `questComplete=${questComplete} until=${questOnly ? 'quest only' : 'mine essence'}`
    );

    while (true) {
        await closeUi();
        if (pos().inCombat && !inKandarin() && !onKaramja()) {
            await fleeCombat();
            continue;
        }
        if (pos().isDead) {
            intent('Dead — waiting to respawn in Lumbridge');
            await sdk.waitForCondition((s) => !s.player.isDead, 45_000).catch(() => {});
            log(`Respawned @ ${pos().x},${pos().z} lv${pos().level}`);
            continue;
        }
        if (mining() !== lastLoggedMine) {
            log(`LEVEL UP Mining ${mining()}`);
            lastLoggedMine = mining();
        }
        questDone();
        if (!questComplete && !has(NOTES) && !has(PACKAGE) && mining() >= 20) {
            questComplete = true;
        }

        if (!questComplete) {
            if (inKandarin() || onKaramja()) {
                await suicideToLumbridge();
                continue;
            }
            if (has(NOTES)) {
                await talkSedridor();
                continue;
            }
            if (has(PACKAGE)) {
                await talkAubury();
                continue;
            }
            if (has(TALISMAN)) {
                await talkSedridor();
                continue;
            }
            if (sdk.findNearbyNpc(/aubury/i) && has(PACKAGE)) {
                await talkAubury();
                continue;
            }
            if (sdk.findNearbyNpc(/sedridor/i) && !questComplete) {
                await talkSedridor();
                continue;
            }
            if (!(await reachLumbridge())) continue;
            if (!hasPickaxe()) {
                if (coinCount() < 1) await pickpocketForCoins();
                await buyPickaxe();
                if (!hasPickaxe()) continue;
            }
            await startWithDuke();
            continue;
        }

        if (questOnly) {
            log(`Done. Rune Mysteries complete. Mining ${mining()} (${miningXp()} xp)`);
            break;
        }

        if (!hasPickaxe()) {
            if (distTo(VARROCK_EAST_BANK.x, VARROCK_EAST_BANK.z) < 40 || distTo(AUBURY.x, AUBURY.z) < 40) {
                await bankEssence();
            }
            if (!hasPickaxe()) await buyPickaxe();
            if (!hasPickaxe()) {
                await sdk.waitForTicks(5);
                continue;
            }
        }
        await equipPickaxe();

        if (bagFull() || (count(ESSENCE) > 0 && occupiedSlots() >= 26 && !inEssenceMine())) {
            await bankEssence();
            continue;
        }

        if (!inEssenceMine()) {
            if (inWizardBasement()) {
                await climb('up');
                continue;
            }
            if (!sdk.findNearbyNpc(/aubury/i)) {
                await goToAubury();
                continue;
            }
            await teleportToEssence();
            continue;
        }

        await mineEssence();
    }
} catch (err) {
    console.error('Script error:', err);
    throw err;
} finally {
    console.log('Disconnecting SDK; browser client can stay open.');
    await sdk.disconnect();
}
