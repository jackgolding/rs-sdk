import { BotSDK, deriveGatewayUrl } from '../../sdk/index';
import { BotActions } from '../../sdk/actions';
import { initPathfinding } from '../../sdk/pathfinding';
import { readFileSync, appendFileSync } from 'fs';
import { dirname, join } from 'path';

const EDGEVILLE_BANK = { x: 3094, z: 3492 };
const MONASTERY = { x: 3051, z: 3484 };
const LOWE = { x: 3232, z: 3423 };
/** West of Lowe / Varrock east bank so the Edgeville walk never climbs those stairs. */
const VARROCK_SQUARE = { x: 3210, z: 3429 };
/** Go to Lowe whenever the stack is below this — last trip spent only pocket gp. */
const ARROW_RESTOCK_BELOW = 800;
const LOWE_IRON_STOCK_BASE = 1500;
const IRON_ARROW_MAX_GP = 10;
const IRON_ARROW_MAX_BUY = 500;
const DUNGEON_LADDER = { x: 3096, z: 9867 };
const WILDY_GATE = { x: 3103, z: 9909 };
/** Southern chaos druids — giant skeletons wander the northern pack around 3104,9948. */
const DRUIDS = { x: 3114, z: 9929 };
const SKELETON_LINE = 9940;
/** combat_bow:specbar — Snapshot, 35% (350/1000). */
const COMBAT_BOW_SPECBAR = 7537;
const MSB_SPEC_COST = 350;
const SPEC_MAX = 1000;
const SPEC_REGEN = 100;
const SPEC_REGEN_TICKS = 50;

const HERB = /^(herb|guam leaf|marrentill|tarromin|harralander|ranarr weed|toadflax|irit leaf|avantoe|kwuarm|cadantine|lantadyme|dwarf weed|torstol)$/i;
const RUNE = /rune$/i;
const COINS = /^coins$/i;
const LOOT = /^(herb|guam leaf|marrentill|tarromin|harralander|ranarr weed|toadflax|irit leaf|avantoe|kwuarm|cadantine|lantadyme|dwarf weed|torstol|coins|.+ rune)$/i;
const BONES = /^bones$/i;
const SALMON = /^salmon$/i;
const TUNA = /^tuna$/i;
const SWORDFISH = /^swordfish$/i;
const SHARK = /^shark$/i;
const FOOD = /^(salmon|tuna|swordfish|shark)$/i;
const FOOD_PLAN = [
    { pattern: SALMON, amount: 20, name: 'salmon' },
    { pattern: TUNA, amount: 10, name: 'tuna' },
    { pattern: SWORDFISH, amount: 8, name: 'swordfish' },
    { pattern: SHARK, amount: 5, name: 'shark' },
] as const;
const ARROW = /^(bronze|iron|steel|mithril|adamant|rune) arrows?$/i;
const IRON_ARROW = /^iron arrows?$/i;
const BRONZE_ARROW = /^bronze arrows?$/i;
const BOW = /bow/i;
const KEEP = /^(coins|salmon|tuna|swordfish|shark|(bronze|iron|steel|mithril|adamant|rune) arrows?|.+bow)$/i;
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
    autoLaunchBrowser: 'auto',
    browserLaunchTimeout: 90_000,
    readyTimeout: 45_000,
    connectTimeout: 60_000,
    showChat: true
});

console.log('Opening/attaching the game client...');
await sdk.connect();
const bot = new BotActions(sdk);

let lastPrayerPoints = -1;
let loggedFlickReady = false;
let flickCount = 0;
let meleeOn = false;
let specEnergy = SPEC_MAX;
let specArmed = false;
let lastSpecRegenTick = -1;

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
        targetIndex: p?.combat?.targetIndex ?? -1,
    };
}

function distTo(x: number, z: number): number {
    const p = pos();
    return Math.hypot(p.x - x, p.z - z);
}

function inDungeon(): boolean {
    return pos().z > 6400;
}

function countItems(pattern: RegExp): number {
    return sdk.getInventory().filter((i) => pattern.test(i.name)).reduce((n, i) => n + i.count, 0);
}

function occupiedSlots(): number {
    return sdk.getInventory().filter((i) => (i.count ?? 0) > 0).length;
}

function herbSlots(): number {
    return sdk.getInventory().filter((i) => HERB.test(i.name)).length;
}

function foodCount(): number {
    return countItems(FOOD);
}

function findFood() {
    for (const plan of FOOD_PLAN) {
        const item = sdk.findInventoryItem(plan.pattern);
        if (item) return item;
    }
    return sdk.findInventoryItem(FOOD);
}

function coins(): number {
    return sdk.findInventoryItem(/^coins$/i)?.count ?? 0;
}

function invFood(): string {
    const parts = FOOD_PLAN
        .map((p) => `${countItems(p.pattern)} ${p.name}`)
        .filter((s) => !s.startsWith('0 '));
    return parts.join(', ') || 'none';
}

function arrowCount(): number {
    const worn = sdk.getEquipment().filter((i) => ARROW.test(i.name)).reduce((n, i) => n + i.count, 0);
    return worn + countItems(ARROW);
}

function rangedLevel(): number {
    return sdk.getSkill('Ranged')?.baseLevel ?? 1;
}

function rangedXp(): number {
    return sdk.getSkill('Ranged')?.experience ?? 0;
}

function prayerPoints(): number {
    return sdk.getPrayerState()?.prayerPoints ?? 0;
}

function prayerBase(): number {
    return sdk.getPrayerState()?.prayerLevel ?? sdk.getSkill('Prayer')?.baseLevel ?? 0;
}

function prayerReady(): boolean {
    return prayerBase() >= 43 && prayerPoints() > 0;
}

async function intent(msg: string): Promise<void> {
    await sdk.showIntent(msg).catch(() => {});
}

async function walkNear(x: number, z: number, tolerance = 6): Promise<boolean> {
    if (pos().level > 0) await ensureGroundFloor();
    // From Varrock east bank / Lowe, a westbound walkTo climbs the bank stairs.
    if (pos().x > 3225 && x < 3200) await leaveVarrockEastBank();
    if (distTo(x, z) <= tolerance) return true;
    await prayerOff();
    const result = await bot.walkTo(x, z, Math.min(tolerance, 3));
    log(`walkTo(${x},${z}): ${result.success ? 'ok' : result.message} @ ${pos().x},${pos().z} L${pos().level}`);
    return result.success || distTo(x, z) <= tolerance + 2;
}

function tickSpecRegen(): void {
    const tick = sdk.getState()?.tick ?? 0;
    if (lastSpecRegenTick < 0) lastSpecRegenTick = tick;
    if (specEnergy >= SPEC_MAX) {
        lastSpecRegenTick = tick;
        return;
    }
    while (tick - lastSpecRegenTick >= SPEC_REGEN_TICKS && specEnergy < SPEC_MAX) {
        specEnergy = Math.min(SPEC_MAX, specEnergy + SPEC_REGEN);
        lastSpecRegenTick += SPEC_REGEN_TICKS;
    }
}

async function enableMsbSpec(): Promise<boolean> {
    tickSpecRegen();
    if (specEnergy < MSB_SPEC_COST) return false;
    if (specArmed) return true;
    await sdk.sendSetTab(0).catch(() => {});
    const r = await sdk.sendClickComponent(COMBAT_BOW_SPECBAR);
    if (!r.success) {
        log(`Spec bar click failed: ${r.message}`);
        return false;
    }
    specArmed = true;
    return true;
}

function noteSpecUsed(): void {
    if (!specArmed) return;
    specArmed = false;
    specEnergy = Math.max(0, specEnergy - MSB_SPEC_COST);
}

async function sendMeleeToggle(): Promise<void> {
    const r = await sdk.sendTogglePrayer(PROT_MELEE);
    if (!r.success) log(`Prayer toggle: ${r.message}`);
}

async function prayerOff(): Promise<void> {
    if (meleeOn || sdk.isPrayerActive(PROT_MELEE)) {
        await sendMeleeToggle();
        meleeOn = false;
    }
}

/**
 * Hard 1-tick flick: ON this tick, OFF the next. Always send the off packet —
 * do not wait for isPrayerActive (that lag was leaving protect on and draining).
 */
async function flickProtectMelee(): Promise<void> {
    if (!prayerReady()) {
        await prayerOff();
        return;
    }
    const pts = prayerPoints();
    if (lastPrayerPoints >= 0 && pts < lastPrayerPoints) {
        log(`Prayer DROPPED ${lastPrayerPoints} -> ${pts} (flick leaked)`);
    }
    lastPrayerPoints = pts;
    if (!loggedFlickReady) {
        log(`Prayer ${prayerBase()} pts ${pts} — 1-tick flicking protect from melee`);
        loggedFlickReady = true;
    }

    if (meleeOn || sdk.isPrayerActive(PROT_MELEE)) {
        await sendMeleeToggle();
        meleeOn = false;
    }

    const t0 = sdk.getState()?.tick ?? 0;
    await sendMeleeToggle();
    meleeOn = true;
    try {
        await sdk.waitForCondition((s) => (s.tick ?? 0) > t0, 700);
    } catch {
        /* off anyway */
    }
    await sendMeleeToggle();
    meleeOn = false;
    flickCount++;
    if (flickCount % 50 === 0) {
        log(`Flicked ${flickCount}x | prayer ${prayerPoints()}/${prayerBase()} (want no drain)`);
    }
}

async function joinPrayerGuild(): Promise<boolean> {
    const abbot = sdk.findNearbyNpc(/abbot langley/i) ?? sdk.findNearbyNpc(/abbot/i);
    if (!abbot) {
        log('No Abbot Langley nearby to join the order');
        return false;
    }
    await prayerOff();
    const talked = await bot.talkTo(abbot);
    if (!talked.success && !sdk.getDialog()?.isOpen) {
        log(`Talk Abbot: ${talked.message}`);
        return false;
    }
    for (let i = 0; i < 8; i++) {
        const dialog = sdk.getDialog();
        if (!dialog?.isOpen) break;
        const join = dialog.options.find((o) => /further into the monastery|join your order/i.test(o.text));
        if (join) {
            await sdk.clickDialogByText(new RegExp(join.text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'));
            await sdk.waitForTicks(1);
            continue;
        }
        const cont = dialog.options.find((o) => /click here to continue/i.test(o.text));
        if (cont) {
            await sdk.sendClickDialog(cont.index);
            await sdk.waitForTicks(1);
            continue;
        }
        await sdk.sendClickDialog(dialog.options[0]?.index ?? 0);
        await sdk.waitForTicks(1);
    }
    log('Asked Abbot Langley to join the order');
    return true;
}

async function ensureGroundFloor(): Promise<void> {
    for (let i = 0; i < 8 && pos().level > 0; i++) {
        if (await climbMonasteryLadder(/climb-down/i)) break;
        const loc = sdk.findNearbyLoc(/ladder|stair/i, { withOption: /down/i });
        if (loc) {
            await bot.interactLoc(loc, /down/i);
            await sdk.waitForCondition((s) => (s.player?.level ?? 1) === 0, 8_000).catch(() => {});
        }
        await sdk.waitForTicks(1);
    }
    if (pos().level > 0) log(`Still upstairs @ ${pos().x},${pos().z} L${pos().level}`);
}

async function climbMonasteryLadder(dir: RegExp): Promise<boolean> {
    const before = pos().level;
    const ladder = sdk.findNearbyLoc(/ladder/i, { withOption: dir });
    if (!ladder) return false;
    await prayerOff();
    await bot.interactLoc(ladder, dir);
    try {
        await sdk.waitForCondition((s) => (s.player?.level ?? before) !== before || s.dialog.isOpen, 8_000);
    } catch {
        /* try again */
    }
    if (sdk.getDialog()?.isOpen) {
        log('Ladder blocked by monk dialog — joining order');
        await joinPrayerGuild();
        return pos().level !== before;
    }
    return pos().level !== before;
}

async function rechargePrayer(): Promise<boolean> {
    const pts = prayerPoints();
    const max = prayerBase();
    if (pts >= max && max >= 43) {
        log(`Prayer already ${pts}/${max}`);
        lastPrayerPoints = pts;
        return true;
    }
    await intent('recharge prayer at monastery');
    log(`Recharge prayer ${pts}/${max} at monastery`);
    await walkNear(MONASTERY.x, MONASTERY.z, 6);

    for (let attempt = 0; attempt < 6 && pos().level === 0; attempt++) {
        const climbed = await climbMonasteryLadder(/climb-up/i);
        if (climbed) break;
        if (attempt === 1 || sdk.findNearbyNpc(/abbot/i)) {
            await joinPrayerGuild();
        }
        await sdk.waitForTicks(1);
    }
    if (pos().level === 0) {
        log(`Still ground floor @ ${pos().x},${pos().z} — cannot reach monastery altar`);
        return prayerPoints() >= prayerBase();
    }

    const altar = sdk.findNearbyLoc(/^altar$/i, { withOption: /pray/i }) ?? sdk.findNearbyLoc(/altar/i);
    if (!altar) {
        log(`No altar upstairs @ ${pos().x},${pos().z} L${pos().level}`);
    } else {
        const before = prayerPoints();
        await bot.interactLoc(altar, /pray/i);
        try {
            await sdk.waitForCondition((s) => (s.prayers?.prayerPoints ?? 0) > before, 8_000);
        } catch {
            /* already full or miss */
        }
        log(`Altar pray ${before} -> ${prayerPoints()}/${prayerBase()}`);
    }

    for (let i = 0; i < 4 && pos().level > 0; i++) {
        if (await climbMonasteryLadder(/climb-down/i)) break;
        await sdk.waitForTicks(1);
    }
    await ensureGroundFloor();
    lastPrayerPoints = prayerPoints();
    loggedFlickReady = false;
    return prayerPoints() >= prayerBase();
}

async function openBankAt(x: number, z: number): Promise<boolean> {
    await prayerOff();
    if (sdk.getState()?.shop?.isOpen) await bot.closeShop();
    if (sdk.getState()?.bank?.isOpen) return true;
    if (sdk.getState()?.interface?.isOpen && !sdk.getState()?.bank?.isOpen) await bot.closeInterface();
    await walkNear(x, z, 4);
    if (sdk.getState()?.bank?.isOpen) return true;
    const opened = await bot.openBank();
    if (!opened.success) {
        log(`openBank failed: ${opened.message}`);
        return false;
    }
    return true;
}

async function withdrawFood(): Promise<void> {
    for (const plan of FOOD_PLAN) {
        const have = countItems(plan.pattern);
        const inBank = sdk.findBankItem(plan.pattern)?.count ?? 0;
        if (have <= 0 && inBank <= 0) continue;
        if (have < plan.amount && inBank > 0) {
            const r = await bot.withdrawItem(plan.pattern, plan.amount - have);
            log(`Withdraw ${plan.name}: ${r.success || r.partial} now ${countItems(plan.pattern)}`);
        }
        if (countItems(plan.pattern) > 0) return;
    }
}

async function leaveVarrockEastBank(): Promise<void> {
    if (pos().level > 0) {
        const down = sdk.findNearbyLoc(/stair|ladder/i, { withOption: /down/i });
        if (down) {
            await bot.interactLoc(down, /down/i);
            await sdk.waitForCondition((s) => (s.player?.level ?? 1) === 0, 8_000).catch(() => {});
        }
        await ensureGroundFloor();
    }
    if (pos().x > 3225 || pos().level > 0) {
        await walkNear(VARROCK_SQUARE.x, VARROCK_SQUARE.z, 4);
    }
}

async function restockArrowsAtLowe(): Promise<void> {
    log(`Arrows low (${arrowCount()}) — withdraw bank coins, then Lowe`);
    await intent('withdraw coins, buy arrows at Lowe');
    const atLoweWithCash = distTo(LOWE.x, LOWE.z) <= 12 && coins() >= 100;
    if (!atLoweWithCash) {
        if (!(await openBankAt(EDGEVILLE_BANK.x, EDGEVILLE_BANK.z))) return;
        const bankGp = sdk.findBankItem(/^coins$/i)?.count ?? 0;
        if (bankGp > 0) {
            const r = await bot.withdrawItem(/^coins$/i, -1);
            log(`Withdrew coins for Lowe: ${r.success || r.partial} (bank had ${bankGp}) now ${coins()}gp`);
        } else {
            log(`Bank has no coins — inventory ${coins()}gp`);
        }
        await bot.closeBank();
    } else {
        log(`Already at Lowe with ${coins()}gp — buying now`);
        if (sdk.getState()?.bank?.isOpen) await bot.closeBank();
    }
    if (coins() < 1) {
        log('No coins for Lowe');
        return;
    }
    if (!sdk.getState()?.shop?.isOpen) {
        await walkNear(LOWE.x, LOWE.z, 3);
        const opened = await bot.openShop(/lowe/i);
        if (!opened.success && !sdk.getState()?.shop?.isOpen) {
            log(`Lowe shop failed: ${opened.message}`);
            return;
        }
    }
    const shopLine = (pattern: RegExp) =>
        sdk.getState()?.shop?.shopItems.find((i) => pattern.test(i.name)) ?? null;
    const countOf = (pattern: RegExp) =>
        (sdk.findEquipmentItem(pattern)?.count ?? 0) + countItems(pattern);
    const liveBuyPrice = (line: { count: number; baseCost?: number }) => {
        const cfg = sdk.getState()?.shop?.shopConfig;
        const cost = line.baseCost || 1;
        const haggle = cfg?.haggle ?? 10;
        const sellMult = cfg?.sellMultiplier ?? 1000;
        const stockDiff = (line.count ?? 0) - LOWE_IRON_STOCK_BASE;
        const raw = Math.min(1000, Math.max(-5000, stockDiff * haggle));
        return Math.max(1, Math.floor((cost * Math.max(100, sellMult - raw)) / 1000));
    };
    // buyFromShop waits for inventory after every Buy-10 (~1s each, then the
    // 60s deadline aborts at ~350). Burst Buy-10 packets and wait a tick.
    const buyAll = async (
        pattern: RegExp,
        label: string,
        opts?: { maxPrice?: number; maxBuy?: number }
    ) => {
        const before = countOf(pattern);
        let stall = 0;
        while (stall < 4 && coins() >= 1) {
            const line = shopLine(pattern);
            if (!line || line.count <= 0) break;
            const boughtSoFar = countOf(pattern) - before;
            if (opts?.maxBuy != null && boughtSoFar >= opts.maxBuy) {
                log(`Stop ${label} at ${boughtSoFar} (max ${opts.maxBuy})`);
                break;
            }
            if (opts?.maxPrice != null) {
                const price = liveBuyPrice(line);
                if (price > opts.maxPrice) {
                    log(`Stop ${label} at ${price}gp (cap ${opts.maxPrice}gp) shelf ${line.count}`);
                    break;
                }
            }
            if (coins() < Math.max(1, liveBuyPrice(line))) break;
            const stockBefore = line.count;
            const room = opts?.maxBuy != null ? opts.maxBuy - boughtSoFar : stockBefore;
            const nearPriceCap = opts?.maxPrice != null && liveBuyPrice(line) >= opts.maxPrice - 2;
            const clicks = nearPriceCap
                ? 1
                : Math.min(8, Math.ceil(Math.min(stockBefore, Math.max(10, room)) / 10));
            for (let n = 0; n < clicks; n++) {
                const r = await sdk.sendShopBuy(line.slot, 10);
                if (!r.success) {
                    log(`Buy ${label} send failed: ${r.message}`);
                    stall = 99;
                    break;
                }
            }
            await sdk.waitForTicks(1);
            const stockAfter = shopLine(pattern)?.count ?? 0;
            if (stockAfter >= stockBefore) stall++;
            else stall = 0;
        }
        const bought = countOf(pattern) - before;
        log(`Bought ${bought} ${label} | shelf ${shopLine(pattern)?.count ?? 0} | ${coins()}gp left`);
        return bought;
    };
    const iron = shopLine(IRON_ARROW);
    const bronze = shopLine(BRONZE_ARROW);
    log(`Lowe iron ${iron?.count ?? 0} bronze ${bronze?.count ?? 0} | ${coins()}gp`);
    await buyAll(BRONZE_ARROW, 'bronze arrow');
    await buyAll(IRON_ARROW, 'iron arrow', { maxPrice: IRON_ARROW_MAX_GP, maxBuy: IRON_ARROW_MAX_BUY });
    await bot.closeShop();
    await equipGear();
    await leaveVarrockEastBank();
}

async function depositJunk(): Promise<void> {
    for (let i = 0; i < 40; i++) {
        const item = sdk.getInventory().find((it) => !KEEP.test(it.name));
        if (!item) break;
        const r = await bot.depositItem(
            new RegExp(`^${item.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i'),
            -1
        );
        log(`Deposit ${item.name}: ${r.success || r.partial} ${r.message ?? ''}`);
        if (!r.success && !r.partial) break;
    }
}

async function climbIntoDungeon(): Promise<boolean> {
    if (inDungeon()) return true;
    await prayerOff();
    await walkNear(3095, 3468, 1);
    for (let attempt = 0; attempt < 4 && !inDungeon(); attempt++) {
        const trap = sdk.findNearbyLoc(/trapdoor/i);
        log(`Trapdoor try ${attempt}: ${trap ? `${trap.name} [${trap.optionsWithIndex.map((o) => o.text).join(', ')}]` : 'none'} @ ${pos().x},${pos().z}`);
        if (!trap) {
            await sdk.waitForTicks(1);
            continue;
        }
        if (trap.optionsWithIndex.some((o) => /^open$/i.test(o.text))) {
            await bot.interactLoc(trap, /^open$/i);
            await sdk.waitForCondition(
                (s) => (s.nearbyLocs ?? []).some((l) => /trapdoor/i.test(l.name) && l.optionsWithIndex.some((o) => /climb-down/i.test(o.text))),
                6_000
            ).catch(() => {});
        }
        const down = sdk.findNearbyLoc(/trapdoor/i, { withOption: /climb-down/i });
        if (down) {
            await bot.interactLoc(down, /climb-down/i);
            await sdk.waitForCondition((s) => (s.player?.worldZ ?? 0) > 6400, 8_000).catch(() => {});
        }
    }
    log(`Dungeon ${inDungeon()} @ ${pos().x},${pos().z}`);
    return inDungeon();
}

async function climbToSurface(): Promise<boolean> {
    if (!inDungeon()) return true;
    await prayerOff();
    await eatIfNeeded();
    // Walk west to the gate first — a direct south path from the druids
    // (3114,9905) routes east into the wall at ~3133,9927.
    if (pos().z >= WILDY_GATE.z) {
        await walkNear(WILDY_GATE.x, WILDY_GATE.z + 6, 3);
        const gate = sdk.findNearbyLoc(/gate/i, { withOption: /open/i });
        if (gate) await bot.openDoor(gate);
        await walkNear(WILDY_GATE.x, WILDY_GATE.z - 6, 3);
    }
    await walkNear(DUNGEON_LADDER.x, DUNGEON_LADDER.z, 2);
    const ladder = sdk.findNearbyLoc(/^ladder$/i, { withOption: /climb-up/i });
    if (ladder) {
        await bot.interactLoc(ladder, /climb-up/i);
        await sdk.waitForCondition((s) => (s.player?.worldZ ?? 0) < 6400, 10_000).catch(() => {});
    }
    log(`Surface ${!inDungeon()} @ ${pos().x},${pos().z}`);
    return !inDungeon();
}

async function setRapid(): Promise<void> {
    const style = sdk.getState()?.combatStyle?.styles.find(
        (s) => s.type === 'Rapid' || /rapid/i.test(s.name)
    );
    if (!style) return;
    if (sdk.getState()?.combatStyle?.currentStyle === style.index) return;
    await sdk.sendSetCombatStyle(style.index);
    await sdk.waitForCondition((s) => s.combatStyle?.currentStyle === style.index, 5_000).catch(() => {});
    log(`Combat style ${style.name} (${style.type})`);
}

async function equipGear(): Promise<void> {
    if (!sdk.findEquipmentItem(BOW)) {
        const bow = sdk.findInventoryItem(BOW);
        if (bow) {
            const r = await bot.equipItem(bow);
            log(`Equip ${bow.name}: ${r.success ? 'ok' : r.message}`);
        }
    }
    const iron = sdk.findInventoryItem(IRON_ARROW);
    const bronze = sdk.findInventoryItem(BRONZE_ARROW);
    const any = sdk.findInventoryItem(ARROW);
    const worn = sdk.findEquipmentItem(ARROW);
    const best = iron ?? (IRON_ARROW.test(worn?.name ?? '') ? null : bronze ?? any);
    if (best) {
        const r = await bot.equipItem(best);
        if (r.success) log(`Wield ${best.count} ${best.name}`);
    }
    await setRapid();
}

async function prepareLoadout(): Promise<void> {
    await prayerOff();
    await intent('bank food');
    if (inDungeon()) await climbToSurface();
    await ensureGroundFloor();
    const atLoweWithCash = distTo(LOWE.x, LOWE.z) <= 12 && coins() >= 100;
    if (atLoweWithCash && sdk.getState()?.shop?.isOpen) {
        await restockArrowsAtLowe();
    }
    await leaveVarrockEastBank();
    if (prayerPoints() < prayerBase() || prayerBase() < 43) {
        await rechargePrayer();
    }
    if (!(await openBankAt(EDGEVILLE_BANK.x, EDGEVILLE_BANK.z))) return;

    await depositJunk();
    if (!sdk.findEquipmentItem(BOW) && !sdk.findInventoryItem(BOW)) {
        await bot.withdrawItem(BOW, 1).catch(() => {});
    }
    if (arrowCount() < ARROW_RESTOCK_BELOW) {
        if ((sdk.findBankItem(IRON_ARROW)?.count ?? 0) > 0) await bot.withdrawItem(IRON_ARROW, -1).catch(() => {});
        else if ((sdk.findBankItem(BRONZE_ARROW)?.count ?? 0) > 0) await bot.withdrawItem(BRONZE_ARROW, -1).catch(() => {});
    }
    await withdrawFood();
    const needLowe = arrowCount() < ARROW_RESTOCK_BELOW;
    log(`Loadout food=${foodCount()} (${invFood()}) arrows=${arrowCount()} prayer=${prayerPoints()}/${prayerBase()} bow=${sdk.findEquipmentItem(BOW)?.name ?? sdk.findInventoryItem(BOW)?.name ?? 'none'}${needLowe ? ' — restocking arrows' : ''}`);
    if (needLowe) {
        await restockArrowsAtLowe();
        if (!(await openBankAt(EDGEVILLE_BANK.x, EDGEVILLE_BANK.z))) return;
        await withdrawFood();
    }
    if (coins() > 0 && (needLowe || atLoweWithCash)) {
        const r = await bot.depositItem(/^coins$/i, -1);
        log(`Deposited leftover coins: ${r.success || r.partial} now ${coins()}gp`);
    }
    await bot.closeBank();
    await equipGear();
}

async function goToDruids(): Promise<void> {
    if (!inDungeon() && !(await climbIntoDungeon())) return;
    if (pos().z < WILDY_GATE.z - 4) {
        await walkNear(WILDY_GATE.x, WILDY_GATE.z - 2, 3);
        const gate = sdk.findNearbyLoc(/gate/i, { withOption: /open/i });
        if (gate) await bot.openDoor(gate);
    }
    await walkNear(DRUIDS.x, DRUIDS.z, 6);
}

function nearbySkeleton() {
    return (sdk.getNearbyNpcs() ?? []).find(
        (n) => /^skeleton$/i.test(n.name) && (n.distance ?? 99) <= 3
    ) ?? null;
}

async function fleeSkeletons(): Promise<boolean> {
    const skel = nearbySkeleton();
    if (!skel && pos().z < SKELETON_LINE) return false;
    log(`Skeleton nearby ${skel?.x ?? '?'},${skel?.z ?? pos().z} — backing south`);
    await walkNear(DRUIDS.x, DRUIDS.z - 4, 3);
    return true;
}

async function eatIfNeeded(): Promise<void> {
    const p = pos();
    if (p.hp > p.maxHp - 9 && p.hp > p.maxHp * 0.55) return;
    const food = findFood();
    if (!food) return;
    const r = await bot.eatFood(food);
    if (r.success) log(`Ate ${food.name} +${r.hpGained} HP ${pos().hp}/${pos().maxHp} left=${foodCount()}`);
}

async function buryBones(): Promise<void> {
    for (let i = 0; i < 8; i++) {
        const bones = sdk.findInventoryItem(BONES);
        if (!bones) return;
        const buryOpt = bones.optionsWithIndex.find((o) => /bury/i.test(o.text));
        if (!buryOpt) return;
        await sdk.sendUseItem(bones.slot, buryOpt.opIndex);
        await sdk.waitForTicks(1);
    }
}

function isArrowStack(g: { name: string; count: number }): boolean {
    return ARROW.test(g.name) && (g.count ?? 0) >= 5;
}

async function lootGround(): Promise<void> {
    for (let i = 0; i < 8; i++) {
        await buryBones();
        if (occupiedSlots() >= 28) break;
        const item = (sdk.getGroundItems() ?? [])
            .filter((g) =>
                (LOOT.test(g.name) || BONES.test(g.name) || isArrowStack(g)) &&
                g.reachable !== false &&
                (g.distance ?? 99) <= 8
            )
            .sort((a, b) => {
                const pri = (g: typeof a) =>
                    isArrowStack(g) ? 0 : RUNE.test(g.name) || COINS.test(g.name) || HERB.test(g.name) ? 1 : 2;
                const d = pri(a) - pri(b);
                if (d !== 0) return d;
                return (a.distance ?? 99) - (b.distance ?? 99);
            })[0];
        if (!item) return;
        const r = await bot.pickupItem(item);
        if (!r.success) {
            log(`Pickup ${item.name} x${item.count} failed: ${r.message}`);
            return;
        }
        if (isArrowStack(item)) log(`Picked ${item.count} ${item.name}`);
    }
}

function findDruid() {
    const druids = (sdk.getNearbyNpcs() ?? [])
        .filter((n) =>
            /^chaos druid$/i.test(n.name) &&
            (n.hp === null || n.hp > 0) &&
            n.z < SKELETON_LINE &&
            n.optionsWithIndex.some((o) => /attack/i.test(o.text)) &&
            (n.reachable !== false)
        )
        .sort((a, b) => (a.distance ?? 99) - (b.distance ?? 99));
    const myTarget = pos().targetIndex;
    const free = druids.filter((d) => !d.inCombat || d.index === myTarget);
    return free[0] ?? null;
}

function hasValidNpcTarget(): boolean {
    const p = pos();
    if (!p.inCombat || p.targetType !== 'npc' || p.targetIndex < 0) return false;
    const target = sdk.getNearbyNpcs().find((n) => n.index === p.targetIndex);
    return !!target && (target.hp === null || target.hp > 0);
}

async function waitForDruidFight(): Promise<void> {
    const started = Date.now();
    while (hasValidNpcTarget() && !pos().isDead && Date.now() - started < 25_000) {
        await bot.dismissBlockingUI();
        await flickProtectMelee();
        await eatIfNeeded();
        if (arrowCount() <= 0) return;
        await lootGround();
    }
}

async function shootDruid(): Promise<void> {
    if (hasValidNpcTarget()) {
        await waitForDruidFight();
        return;
    }

    const target = findDruid();
    if (!target) {
        await flickProtectMelee();
        if (distTo(DRUIDS.x, DRUIDS.z) > 8) await walkNear(DRUIDS.x, DRUIDS.z, 5);
        else await sdk.waitForTicks(1);
        return;
    }

    if ((target.distance ?? 99) > 7) {
        await walkNear(target.x, target.z, 6);
    }

    await flickProtectMelee();
    const specced = await enableMsbSpec();
    const opt = target.optionsWithIndex.find((o) => /attack/i.test(o.text));
    if (!opt) return;
    const r = await sdk.sendInteractNpc(target.index, opt.opIndex);
    if (!r.success) {
        log(`Attack ${target.name}: ${r.message}`);
        return;
    }
    try {
        await sdk.waitForCondition((s) => {
            if (s.player?.combat?.inCombat) return true;
            const gone = !s.nearbyNpcs.some((n) => n.index === target.index && (n.hp === null || n.hp > 0));
            return gone;
        }, 8_000);
    } catch {
        /* recast next loop */
    }
    const noPower = (sdk.getState()?.gameMessages ?? []).some((m) => /enough power/i.test(m.text));
    if (noPower) {
        specArmed = false;
        specEnergy = Math.min(specEnergy, MSB_SPEC_COST - 1);
        log(`Spec not enough power — energy tracked ${specEnergy}`);
    } else if (specced) {
        noteSpecUsed();
    }
    await waitForDruidFight();
}

try {
    log(
        `Range chaos druids (rapid + melee-protect flick). Ranged ${rangedLevel()} (${rangedXp()} xp) ` +
        `Prayer ${prayerPoints()}/${prayerBase()} @ ${pos().x},${pos().z} arrows=${arrowCount()} food=${foodCount()}`
    );
    await bot.dismissBlockingUI();
    if (sdk.getState()?.shop?.isOpen) await bot.closeShop();
    if (sdk.getState()?.bank?.isOpen) await bot.closeBank();
    await prayerOff();

    await equipGear();
    // Stay at the druids regardless of prayer. Bank only for food, arrows, or a full pack.
    if (!(inDungeon() && foodCount() > 0 && arrowCount() >= ARROW_RESTOCK_BELOW)) {
        await prepareLoadout();
        await goToDruids();
    }
    await setRapid();
    lastPrayerPoints = prayerPoints();

    let lastLevel = rangedLevel();
    while (true) {
        await bot.dismissBlockingUI();
        await flickProtectMelee();

        if (pos().isDead) {
            await prayerOff();
            log('Died — waiting to respawn');
            await sdk.waitForCondition((s) => !s.player.isDead, 60_000).catch(() => {});
            log(`Respawned @ ${pos().x},${pos().z}`);
            await prepareLoadout();
            await goToDruids();
            continue;
        }

        if (pos().targetType === 'player' && pos().inCombat) {
            log('Player combat — running to ladder');
            await prayerOff();
            await walkNear(DUNGEON_LADDER.x, DUNGEON_LADDER.z, 4);
            await climbToSurface();
            await prepareLoadout();
            await goToDruids();
            continue;
        }

        const level = rangedLevel();
        if (level !== lastLevel) {
            log(`LEVEL UP Ranged ${level} (${rangedXp()} xp) | food ${foodCount()} herbs ${herbSlots()} arrows ${arrowCount()} prayer ${prayerPoints()}/${prayerBase()}`);
            lastLevel = level;
        }

        await eatIfNeeded();
        if (await fleeSkeletons()) continue;

        if (foodCount() === 0 || occupiedSlots() >= 28 || arrowCount() <= 0) {
            log(`Banking food=${foodCount()} herbs=${herbSlots()} arrows=${arrowCount()} prayer=${prayerPoints()} slots=${occupiedSlots()}`);
            await prepareLoadout();
            if (foodCount() === 0) {
                log('Out of salmon/tuna/swordfish/shark — stopping');
                break;
            }
            if (arrowCount() <= 0) {
                log('Still no arrows after Lowe — stopping');
                break;
            }
            await goToDruids();
            continue;
        }

        await lootGround();
        await equipGear();
        await intent(`range druids ${level} | ${arrowCount()} arr | food ${foodCount()} | pray ${prayerPoints()}/${prayerBase()}`);
        await shootDruid();
        await lootGround();
    }
} catch (err) {
    console.error('Script error:', err);
    throw err;
} finally {
    await prayerOff();
    console.log('Disconnecting SDK; browser client can stay open.');
    await sdk.disconnect();
}
