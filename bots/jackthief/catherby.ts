import { BotSDK, deriveGatewayUrl } from '../../sdk/index';
import { BotActions } from '../../sdk/actions';
import { initPathfinding } from '../../sdk/pathfinding';
import { Spells } from '../../sdk/spells';
import { readFileSync, appendFileSync } from 'fs';
import { dirname, join } from 'path';

/** Camelot teleport landing (tele_coord 0_43_54_5_22). */
const CAMELOT = { x: 2757, z: 3478 };
const BANK = { x: 2808, z: 3443 };
const HARRY = { x: 2834, z: 3445 };
/** Net/Harpoon (sharks) hop along these tiles. West first — east is usually Cage/Harpoon tuna. */
const PIER = [
    { x: 2837, z: 3431 },
    { x: 2845, z: 3429 },
    { x: 2854, z: 3423 },
    { x: 2860, z: 3426 },
];
/** RS2 minimap is ~25 tiles; scanGroundItems default is only 15. */
const MINIMAP_RADIUS = 25;
/** South of the range house — door faces the beach path. */
const RANGE_OUTSIDE = { x: 2816, z: 3439 };
const RANGE_STAND = { x: 2816, z: 3442 };
const EDGEVILLE_BANK = { x: 3094, z: 3492 };
const DUNGEON_LADDER = { x: 3096, z: 9867 };
const WILDY_GATE = { x: 3103, z: 9909 };
const MAGIC_TAB = 6;
const COIN_WITHDRAW = 100;
const FISHER_MULE = 'Fatpig';
const COOKED_FOOD = /^(tuna|swordfish|pike|lobster|shark|salmon|trout|bass|cake)$/i;

const KEEP = /^harpoon$/i;
const RAW = /^raw (tuna|swordfish|shark)$/i;
const RAW_ANY = /^raw /i;
const COOKED = /^(tuna|swordfish|shark)$/i;
const BURNT = /^burnt (fish|swordfish|tuna|shark)$/i;
const FISH_ANY = /^(raw )?(tuna|swordfish|shark)$|^burnt /i;
const RAW_SHARK = /^raw shark$/i;

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

function fmtSec(ms: number): string {
    return `${(ms / 1000).toFixed(1)}s`;
}

function rate(count: number, ms: number): string {
    if (ms <= 0) return 'n/a';
    return `${((count * 60_000) / ms).toFixed(1)}/min`;
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

let pendingFatpigTrade = false;

function fatpigWaitingAtBank(): boolean {
    const p = sdk.findNearbyPlayer(new RegExp(`^${FISHER_MULE}$`, 'i'));
    if (!p) return false;
    return distTo(BANK.x, BANK.z) <= 12 && (p.distance ?? 99) <= 12;
}

function pollFatpigMule(): boolean {
    if (fatpigWaitingAtBank()) pendingFatpigTrade = true;
    return pendingFatpigTrade;
}

function foodGive() {
    const specs: { item: RegExp; amount: -1 }[] = [];
    for (const name of ['lobster', 'swordfish', 'tuna', 'shark', 'pike', 'salmon', 'trout', 'bass', 'cake']) {
        const re = new RegExp(`^${name}$`, 'i');
        if (countItems(re) > 0) specs.push({ item: re, amount: -1 });
    }
    return specs;
}

async function withdrawAllCookedNotes(): Promise<number> {
    for (const name of ['lobster', 'swordfish', 'tuna', 'shark', 'pike', 'salmon', 'trout', 'bass', 'cake']) {
        const re = new RegExp(`^${name}$`, 'i');
        const inBank = sdk.findBankItem(re)?.count ?? 0;
        if (inBank <= 0) continue;
        const r = await bot.withdrawItem(re, -1, { asNote: true }).catch(() => null);
        log(`Noted ALL ${name} (${inBank}) ${r?.success ? 'ok' : r?.message ?? 'fail'}`);
    }
    return countItems(COOKED_FOOD);
}

async function giveAllFoodToFatpig(): Promise<boolean> {
    log(`${FISHER_MULE} at Catherby bank — handing over ALL cooked food`);
    await intent('give Fatpig all cooked notes');
    if (!(await openBankAt(BANK.x, BANK.z))) return false;
    await depositJunk();
    const packed = await withdrawAllCookedNotes();
    if (!hasHarpoon()) await bot.withdrawItem(/^harpoon$/i, 1).catch(() => {});
    await bot.closeBank();
    log(`Packed ALL notes ${packed} for ${FISHER_MULE} | ${invSummary(COOKED_FOOD)}`);

    await walkNear(BANK.x, BANK.z, 4);
    if (sdk.getState()?.trade?.isOpen) await bot.declineTrade().catch(() => {});

    let traded = false;
    const deadline = Date.now() + 4 * 60_000;
    while (Date.now() < deadline && foodGive().length > 0) {
        await bot.dismissBlockingUI();
        const pig = sdk.findNearbyPlayer(new RegExp(`^${FISHER_MULE}$`, 'i'));
        if (pig) {
            const result = await bot.trade(pig, {
                give: foodGive(),
                requestTimeout: 30_000,
                timeout: 60_000,
                retryOnBusy: true
            });
            log(`Give ${FISHER_MULE} ${result.success ? 'ok' : result.reason} ${result.message} | ${invSummary()}`);
            if (result.success) {
                traded = true;
                break;
            }
        } else {
            await intent(`Waiting at Catherby bank for ${FISHER_MULE}`);
        }
        await sdk.waitForTicks(3);
    }

    pendingFatpigTrade = fatpigWaitingAtBank() && foodGive().length > 0;
    if (await openBankAt(BANK.x, BANK.z)) {
        await depositJunk();
        if (!hasHarpoon()) await bot.withdrawItem(/^harpoon$/i, 1).catch(() => {});
        await bot.closeBank();
    }
    if (!traded) log(`${FISHER_MULE} did not take the notes — banking them, back to fishing`);
    return traded;
}

function pos() {
    const p = sdk.getState()?.player;
    return {
        x: p?.worldX ?? 0,
        z: p?.worldZ ?? 0,
        isDead: p?.isDead ?? false,
    };
}

function distTo(x: number, z: number): number {
    const p = pos();
    return Math.hypot(p.x - x, p.z - z);
}

function inDungeon(): boolean {
    return pos().z > 6400;
}

function inCatherby(): boolean {
    const p = pos();
    return p.x >= 2788 && p.x <= 2860 && p.z >= 3420 && p.z <= 3460 && p.z < 6400;
}

function nearCamelot(): boolean {
    return distTo(CAMELOT.x, CAMELOT.z) < 20 && pos().z < 6400;
}

function countItems(pattern: RegExp): number {
    return sdk.getInventory().filter((i) => pattern.test(i.name)).reduce((n, i) => n + i.count, 0);
}

function occupiedSlots(): number {
    return sdk.getInventory().filter((i) => (i.count ?? 0) > 0).length;
}

function inventoryIsFull(): boolean {
    return occupiedSlots() >= 28;
}

function coins(): number {
    return sdk.findInventoryItem(/^coins$/i)?.count ?? 0;
}

function hasHarpoon(): boolean {
    return !!sdk.findInventoryItem(/^harpoon$/i);
}

function fishingXp(): number {
    return sdk.getSkill('Fishing')?.experience ?? 0;
}

function cookingXp(): number {
    return sdk.getSkill('Cooking')?.experience ?? 0;
}

function invSummary(pattern: RegExp = /./): string {
    const parts = sdk.getInventory()
        .filter((i) => pattern.test(i.name) && (i.count ?? 0) > 0)
        .map((i) => `${i.count} ${i.name}`);
    return parts.join(', ') || 'empty';
}

async function intent(msg: string): Promise<void> {
    await sdk.showIntent(msg).catch(() => {});
}

async function walkNear(x: number, z: number, tolerance = 6): Promise<boolean> {
    if (distTo(x, z) <= tolerance) return true;
    const started = Date.now();
    const from = pos();
    const result = await bot.walkTo(x, z, Math.min(tolerance, 3));
    const ok = result.success || distTo(x, z) <= tolerance + 2;
    log(`walk ${from.x},${from.z} -> ${x},${z} ${fmtSec(Date.now() - started)} ${ok ? 'ok' : result.message} now ${pos().x},${pos().z} (${Math.round(distTo(x, z))}t)`);
    return ok;
}

async function openBankAt(x: number, z: number): Promise<boolean> {
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

async function depositJunk(): Promise<void> {
    for (let i = 0; i < 40; i++) {
        const item = sdk.getInventory().find((it) => !KEEP.test(it.name));
        if (!item) break;
        const r = await bot.depositItem(
            new RegExp(`^${item.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i'),
            -1
        );
        if (!r.success && !r.partial) {
            log(`Deposit ${item.name} failed: ${r.message}`);
            break;
        }
    }
}

async function climbToSurface(): Promise<boolean> {
    if (!inDungeon()) return true;
    if (pos().z >= WILDY_GATE.z) {
        await walkNear(3114, WILDY_GATE.z - 4, 4);
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

function canCamelotTele(): { ok: boolean; why: string } {
    const magic = sdk.getSkill('Magic')?.baseLevel ?? 0;
    if (magic < 45) return { ok: false, why: `Magic ${magic} < 45` };
    const law = countItems(/^law rune$/i);
    const air = countItems(/^air rune$/i);
    const airStaff = !!(sdk.findEquipmentItem(/staff of air/i) || sdk.findInventoryItem(/staff of air/i));
    if (law < 1) return { ok: false, why: `no law rune (have ${law})` };
    if (!airStaff && air < 5) return { ok: false, why: `need 5 air runes (have ${air})` };
    return { ok: true, why: `Magic ${magic} law ${law} air ${air}` };
}

async function withdrawTeleRunes(): Promise<boolean> {
    const need = canCamelotTele();
    if (need.ok) return true;
    log(`Need tele runes: ${need.why}`);
    if (inDungeon()) {
        if (!(await climbToSurface())) return false;
    }
    if (!(await openBankAt(EDGEVILLE_BANK.x, EDGEVILLE_BANK.z))) return false;
    if (countItems(/^law rune$/i) < 1) await bot.withdrawItem(/^law rune$/i, 5).catch(() => {});
    if (countItems(/^air rune$/i) < 5 && !sdk.findEquipmentItem(/staff of air/i)) {
        await bot.withdrawItem(/^air rune$/i, 20).catch(() => {});
    }
    await bot.closeBank();
    const after = canCamelotTele();
    log(`After Edgeville withdraw: ${after.why}`);
    return after.ok;
}

async function camelotTeleport(): Promise<boolean> {
    if (nearCamelot() || inCatherby()) {
        log(`Already west: ${pos().x},${pos().z}`);
        return true;
    }
    if (!canCamelotTele().ok && !(await withdrawTeleRunes())) {
        log('Cannot Camelot teleport — missing Magic 45 or runes');
        return false;
    }

    const start = pos();
    const started = Date.now();
    await intent('camelot tele');
    await sdk.sendSetTab(MAGIC_TAB);
    await sdk.waitForTicks(1);
    await sdk.sendClickComponent(Spells.CAMELOT_TELEPORT);
    try {
        await sdk.waitForCondition((s) => {
            const x = s.player?.worldX ?? 0;
            const z = s.player?.worldZ ?? 0;
            return Math.hypot(x - CAMELOT.x, z - CAMELOT.z) < 12;
        }, 10_000);
    } catch {
        /* fall through */
    }
    const landed = distTo(CAMELOT.x, CAMELOT.z) < 12;
    log(`Camelot tele ${fmtSec(Date.now() - started)} ${start.x},${start.z} -> ${pos().x},${pos().z} ${landed ? 'ok' : 'FAILED'}`);
    return landed;
}

async function buyHarpoon(): Promise<boolean> {
    if (hasHarpoon()) return true;
    if (coins() < 5) {
        log(`Need 5gp for harpoon, have ${coins()}`);
        return false;
    }
    const started = Date.now();
    await intent('buy harpoon');
    await walkNear(HARRY.x, HARRY.z, 3);
    const opened = await bot.openShop(/harry/i);
    if (!opened.success && !sdk.getState()?.shop?.isOpen) {
        log(`Harry shop failed: ${opened.message}`);
        return false;
    }
    const bought = await bot.buyFromShop(/^harpoon$/i, 1);
    log(`Buy harpoon: ${bought.success || bought.partial} ${bought.message ?? ''} ${fmtSec(Date.now() - started)}`);
    await bot.closeShop();
    return hasHarpoon();
}

async function setupBankAndHarpoon(): Promise<boolean> {
    const started = Date.now();
    await intent('catherby bank');
    if (!(await openBankAt(BANK.x, BANK.z))) return false;

    if (!hasHarpoon()) await bot.withdrawItem(/^harpoon$/i, 1).catch(() => {});
    if (!hasHarpoon() && coins() < COIN_WITHDRAW) {
        const r = await bot.withdrawItem(/^coins$/i, COIN_WITHDRAW);
        log(`Withdraw coins: ${r.success || r.partial} got ${r.amountWithdrawn ?? '?'} now ${coins()}gp`);
    }
    await depositJunk();
    if (!hasHarpoon()) await bot.withdrawItem(/^harpoon$/i, 1).catch(() => {});
    await bot.closeBank();
    log(`Bank setup ${fmtSec(Date.now() - started)} harpoon=${hasHarpoon()} gp=${coins()} inv=${invSummary()}`);

    if (!hasHarpoon()) {
        if (!(await buyHarpoon())) return false;
        if (coins() > 20 && (await openBankAt(BANK.x, BANK.z))) {
            await bot.depositItem(/^coins$/i, -1).catch(() => {});
            await bot.closeBank();
        }
    }
    return hasHarpoon();
}

function spotHas(spot: { optionsWithIndex: { text: string }[] }, option: RegExp): boolean {
    return spot.optionsWithIndex.some((o) => option.test(o.text));
}

function pierNear(x: number, z: number): { x: number; z: number } {
    return [...PIER].sort((a, b) => Math.hypot(a.x - x, a.z - z) - Math.hypot(b.x - x, b.z - z))[0]!;
}

/** Net+Harpoon = sharks. Cage+Harpoon = tuna/swordfish — never click those. */
function findSharkSpot() {
    const spots = (sdk.getNearbyNpcs() ?? []).filter((n) => /fishing spot/i.test(n.name));
    const sharks = spots.filter(
        (s) => spotHas(s, /^harpoon$/i) && spotHas(s, /^net$/i) && !spotHas(s, /^cage$/i)
    );
    return sharks.sort((a, b) => (a.distance ?? 99) - (b.distance ?? 99))[0] ?? null;
}

let pierHunt = 0;
let sharkAim: { x: number; z: number } | null = null;

async function huntSharkSpot(): Promise<NonNullable<ReturnType<typeof findSharkSpot>> | null> {
    let spot = findSharkSpot();
    if (spot && (spot.distance ?? 99) <= 8) return spot;
    if (spot) {
        await walkNear(spot.x, spot.z, 2);
        return findSharkSpot();
    }
    const wp = sharkAim ? pierNear(sharkAim.x, sharkAim.z) : PIER[pierHunt++ % PIER.length]!;
    const nearby = (sdk.getNearbyNpcs() ?? [])
        .filter((n) => /fishing spot/i.test(n.name))
        .map((n) => `${n.optionsWithIndex.map((o) => o.text).join('/')}@${n.x},${n.z}`);
    log(`Shark hunt ${wp.x},${wp.z} @ ${pos().x},${pos().z} nearby=${nearby.join(' ') || 'none'}${sharkAim ? ` loot@${sharkAim.x},${sharkAim.z}` : ''}`);
    await walkNear(wp.x, wp.z, 3);
    return findSharkSpot();
}

let skipSharkUntil = 0;

async function scanMinimapSharks() {
    const items = await sdk.scanGroundItems(MINIMAP_RADIUS);
    const sharks = items
        .filter((i) => RAW_SHARK.test(i.name))
        .sort((a, b) => (a.distance ?? 99) - (b.distance ?? 99));
    if (sharks[0]) sharkAim = { x: sharks[0].x, z: sharks[0].z };
    else sharkAim = null;
    return sharks;
}

async function pickupDroppedSharks(): Promise<number> {
    if (Date.now() < skipSharkUntil) return 0;
    let sharks = await scanMinimapSharks();
    if (sharks.length === 0) return 0;

    const nearest = sharks[0]!;
    if ((nearest.distance ?? 99) > 5) {
        const wp = pierNear(nearest.x, nearest.z);
        log(`Minimap ${sharks.length} raw shark @ ${nearest.x},${nearest.z} (${nearest.distance?.toFixed(0)}t) — moving to ${wp.x},${wp.z}`);
        await walkNear(wp.x, wp.z, 3);
        sharks = await scanMinimapSharks();
    }

    let picked = 0;
    for (let i = 0; i < 8; i++) {
        const shark =
            sdk.findGroundItem(RAW_SHARK, { reachable: true }) ??
            sharks.find((s) => s.reachable !== false) ??
            null;
        if (!shark) break;
        if (inventoryIsFull()) {
            const tuna = sdk.findInventoryItem(/^raw tuna$/i);
            if (!tuna) break;
            await sdk.sendDropItem(tuna.slot);
            await sdk.waitForTicks(1);
            log(`Dropped tuna for raw shark @ ${shark.x},${shark.z}`);
        }
        if (inventoryIsFull()) break;
        const r = await bot.pickupItem(shark);
        if (!r.success) {
            skipSharkUntil = Date.now() + 8_000;
            log(`Pickup raw shark failed: ${r.message} — skip 8s`);
            break;
        }
        picked++;
        log(`Picked raw shark (${shark.distance?.toFixed(0)}t) ${shark.x},${shark.z}`);
        sharks = sharks.filter((s) => !(s.x === shark.x && s.z === shark.z));
    }
    return picked;
}

async function openRangeDoor(): Promise<void> {
    const door = sdk.findNearbyLoc(/^door$/i, { withOption: /^open$/i });
    if (!door) return;
    if ((door.distance ?? 99) > 6) return;
    await bot.openDoor(door);
}

function findRange() {
    const ranges = (sdk.getNearbyLocs() ?? []).filter((l) => /^range$/i.test(l.name));
    return ranges.find((l) => l.reachable) ?? ranges[0] ?? null;
}

async function goToRange(): Promise<boolean> {
    if (distTo(RANGE_STAND.x, RANGE_STAND.z) > 3) {
        await walkNear(RANGE_OUTSIDE.x, RANGE_OUTSIDE.z, 2);
        await openRangeDoor();
        await walkNear(RANGE_STAND.x, RANGE_STAND.z, 1);
    }
    await openRangeDoor();
    const range = findRange();
    if (!range) {
        log(`No range @ ${pos().x},${pos().z} locs=${(sdk.getNearbyLocs() ?? []).map((l) => l.name).slice(0, 10).join(',')}`);
        return false;
    }
    return true;
}

async function fishInventory(): Promise<{ tuna: number; sword: number; sharks: number; xp: number; idleMs: number; clicks: number }> {
    const startXp = fishingXp();
    const startTuna = countItems(/^raw tuna$/i);
    const startSword = countItems(/^raw swordfish$/i);
    const startShark = countItems(RAW_SHARK);
    let idleMs = 0;
    let clicks = 0;
    let noSpot = 0;

    while (!inventoryIsFull()) {
        await bot.dismissBlockingUI();
        if (pos().isDead) break;
        pollFatpigMule();
        if (pendingFatpigTrade) break;

        await pickupDroppedSharks();
        if (inventoryIsFull()) break;

        let spot = findSharkSpot();
        if (!spot || (spot.distance ?? 99) > 8) {
            const walkStart = Date.now();
            spot = await huntSharkSpot();
            idleMs += Date.now() - walkStart;
        }
        if (!spot) {
            noSpot++;
            if (noSpot === 1 || noSpot % 5 === 0) {
                const nearby = (sdk.getNearbyNpcs() ?? [])
                    .filter((n) => /fishing spot/i.test(n.name))
                    .map((n) => `${n.optionsWithIndex.map((o) => o.text).join('/') || '?'}@${n.x},${n.z}`);
                log(`No net/harpoon shark spot (${noSpot}) @ ${pos().x},${pos().z} nearby=${nearby.join(' ') || 'none'}`);
            }
            await sdk.waitForTicks(1);
            continue;
        }
        noSpot = 0;

        const match = spot.optionsWithIndex.find((o) => /^harpoon$/i.test(o.text));
        if (!match) {
            log(`Spot options: ${spot.optionsWithIndex.map((o) => o.text).join(', ')}`);
            await sdk.waitForTicks(1);
            continue;
        }

        const invBefore = occupiedSlots();
        const xpBefore = fishingXp();
        const started = Date.now();
        clicks++;
        await sdk.sendInteractNpc(spot.index, match.opIndex);

        try {
            await sdk.waitForCondition((s) => {
                if (s.dialog.isOpen) return true;
                if (s.inventory.filter((i) => (i.count ?? 0) > 0).length >= 28) return true;
                const xp = s.skills.find((sk) => sk.name === 'Fishing')?.experience ?? 0;
                const gained = xp > xpBefore || s.inventory.length > invBefore;
                const idle = (s.player?.animId ?? -1) === -1;
                if (gained && idle) return true;
                if (!gained && idle && Date.now() - started > 2500) return true;
                return false;
            }, 8_000);
        } catch {
            /* recast */
        }

        if (fishingXp() === xpBefore && occupiedSlots() === invBefore) {
            idleMs += Date.now() - started;
        }
    }

    await pickupDroppedSharks();
    return {
        tuna: countItems(/^raw tuna$/i) - startTuna,
        sword: countItems(/^raw swordfish$/i) - startSword,
        sharks: countItems(RAW_SHARK) - startShark,
        xp: fishingXp() - startXp,
        idleMs,
        clicks,
    };
}

async function cookInventory(rawPat: RegExp = RAW): Promise<{ cooked: number; burnt: number; xp: number; leftover: number }> {
    const rawStart = countItems(rawPat);
    if (rawStart === 0) return { cooked: 0, burnt: 0, xp: 0, leftover: 0 };

    if (!(await goToRange())) return { cooked: 0, burnt: 0, xp: 0, leftover: rawStart };

    await intent('cook fish');
    const startXp = cookingXp();
    const startBurnt = countItems(BURNT);
    const startCooked = countItems(COOKED);
    let idleCasts = 0;

    while (countItems(rawPat) > 0 && idleCasts < 40) {
        await bot.dismissBlockingUI();
        pollFatpigMule();
        const dialog = sdk.getDialog();
        if (dialog?.isOpen) {
            const cook = dialog.options.find((o) => /cook/i.test(o.text));
            await sdk.sendClickDialog(cook?.index ?? dialog.options[0]?.index ?? 0);
            await sdk.waitForTicks(1);
            idleCasts = 0;
            continue;
        }

        if (distTo(RANGE_STAND.x, RANGE_STAND.z) > 2) {
            await walkNear(RANGE_STAND.x, RANGE_STAND.z, 1);
            await openRangeDoor();
        }

        const raw = sdk.findInventoryItem(rawPat);
        const range = findRange();
        if (!raw || !range) {
            log(`Cook stuck raw=${raw?.name ?? 'none'} range=${!!range} @ ${pos().x},${pos().z}`);
            idleCasts++;
            if (!(await goToRange())) break;
            continue;
        }

        const xpBefore = cookingXp();
        const rawBefore = countItems(rawPat);
        const r = await sdk.sendUseItemOnLoc(raw.slot, range.x, range.z, range.id);
        if (!r.success) log(`useItemOnLoc: ${r.message}`);

        try {
            await sdk.waitForCondition((s) => {
                if (s.dialog.isOpen) return true;
                const xp = s.skills.find((sk) => sk.name === 'Cooking')?.experience ?? 0;
                if (xp > xpBefore) return true;
                const rawNow = s.inventory.filter((i) => rawPat.test(i.name)).reduce((n, i) => n + i.count, 0);
                return rawNow < rawBefore;
            }, 5_000);
        } catch {
            /* recast — this game cooks one fish per use */
        }

        if (cookingXp() === xpBefore && countItems(rawPat) === rawBefore) {
            idleCasts++;
            if (idleCasts === 1 || idleCasts % 8 === 0) {
                log(`Cook miss ${idleCasts} ${raw.name} on ${range.name}(${range.x},${range.z}) @ ${pos().x},${pos().z}`);
            }
        } else {
            idleCasts = 0;
        }
    }

    return {
        cooked: countItems(COOKED) - startCooked,
        burnt: countItems(BURNT) - startBurnt,
        xp: cookingXp() - startXp,
        leftover: countItems(rawPat),
    };
}

async function withdrawRawFromBank(): Promise<boolean> {
    if (!(await openBankAt(BANK.x, BANK.z))) return false;
    await depositJunk();
    if (!hasHarpoon()) await bot.withdrawItem(/^harpoon$/i, 1).catch(() => {});
    const seen = new Set<string>();
    const raws = (sdk.getBankItems() ?? []).filter((i) => {
        if (!RAW_ANY.test(i.name) || seen.has(i.name)) return false;
        seen.add(i.name);
        return true;
    });
    log(`Bank raw: ${raws.map((i) => `${i.count} ${i.name}`).join(', ') || 'none'}`);
    if (raws.length === 0) {
        await bot.closeBank();
        return false;
    }
    for (const item of raws) {
        if (occupiedSlots() >= 27) break;
        const r = await bot.withdrawItem(item, -1, { asNote: false });
        log(`Withdraw ${item.name}: ${r.success || r.partial} ${r.message ?? ''}`);
        if (occupiedSlots() >= 27) break;
    }
    await bot.closeBank();
    log(`Withdrew raw: ${invSummary(RAW_ANY)}`);
    return countItems(RAW_ANY) > 0;
}

async function cookAllBankedFish(): Promise<void> {
    log('Cooking everything raw in the bank before fishing');
    await intent('cook all banked raw fish');
    let n = 0;
    const dumpCooked = async (): Promise<void> => {
        if (!(await openBankAt(BANK.x, BANK.z))) return;
        await depositJunk();
        if (!hasHarpoon()) await bot.withdrawItem(/^harpoon$/i, 1).catch(() => {});
        await bot.closeBank();
    };
    if (countItems(RAW_ANY) > 0) {
        pollFatpigMule();
        if (pendingFatpigTrade) {
            await giveAllFoodToFatpig();
            return;
        }
        const cooked = await cookInventory(RAW_ANY);
        n++;
        log(`Bank-cook ${n}: ${cooked.cooked} cooked ${cooked.burnt} burnt leftover ${cooked.leftover}`);
        await dumpCooked();
    }
    while (await withdrawRawFromBank()) {
        pollFatpigMule();
        if (pendingFatpigTrade || fatpigWaitingAtBank()) {
            await giveAllFoodToFatpig();
            return;
        }
        const cooked = await cookInventory(RAW_ANY);
        n++;
        log(`Bank-cook ${n}: ${cooked.cooked} cooked ${cooked.burnt} burnt leftover ${cooked.leftover}`);
        await dumpCooked();
    }
    log(`Bank cook-all done after ${n} inventories. Cooking ${sdk.getSkill('Cooking')?.baseLevel}`);
}

type TripStats = {
    n: number;
    totalMs: number;
    fishMs: number;
    cookMs: number;
    walkMs: number;
    bankMs: number;
    tuna: number;
    sword: number;
    sharks: number;
    cooked: number;
    burnt: number;
    fishXp: number;
    cookXp: number;
};

const session: TripStats = {
    n: 0, totalMs: 0, fishMs: 0, cookMs: 0, walkMs: 0, bankMs: 0,
    tuna: 0, sword: 0, sharks: 0, cooked: 0, burnt: 0, fishXp: 0, cookXp: 0,
};

function logSession(): void {
    if (session.n === 0) return;
    const t = session.totalMs;
    log(
        `SESSION ${session.n} trips ${fmtSec(t)} | ` +
        `fish ${session.tuna}t/${session.sword}s/${session.sharks}sk (${rate(session.tuna + session.sword + session.sharks, t)}) | ` +
        `cook ${session.cooked} burnt ${session.burnt}` +
        `${session.cooked + session.burnt > 0 ? ` (${((100 * session.burnt) / (session.cooked + session.burnt)).toFixed(1)}%)` : ''} | ` +
        `split fish ${((100 * session.fishMs) / t).toFixed(0)}% cook ${((100 * session.cookMs) / t).toFixed(0)}% walk ${((100 * session.walkMs) / t).toFixed(0)}% bank ${((100 * session.bankMs) / t).toFixed(0)}% | ` +
        `Fish ${sdk.getSkill('Fishing')?.baseLevel} (+${session.fishXp}xp) Cook ${sdk.getSkill('Cooking')?.baseLevel} (+${session.cookXp}xp)`
    );
}

async function bankCatch(): Promise<void> {
    pollFatpigMule();
    if (!(await openBankAt(BANK.x, BANK.z))) return;
    await depositJunk();
    if (!hasHarpoon()) await bot.withdrawItem(/^harpoon$/i, 1).catch(() => {});
    await bot.closeBank();
    if (pendingFatpigTrade || fatpigWaitingAtBank()) await giveAllFoodToFatpig();
}

async function runTrip(n: number): Promise<void> {

    const tripStart = Date.now();
    let fishMs = 0;
    let cookMs = 0;
    let walkMs = 0;
    let bankMs = 0;

    await intent(`shark trip ${n}`);
    if (!findSharkSpot()) {
        const t = Date.now();
        await huntSharkSpot();
        walkMs += Date.now() - t;
    }

    const fishStart = Date.now();
    const catch_ = await fishInventory();
    fishMs += Date.now() - fishStart;
    const caught = catch_.tuna + catch_.sword + catch_.sharks;
    log(
        `trip ${n} FISH ${fmtSec(fishMs)} | ${caught} fish (${catch_.tuna} tuna, ${catch_.sword} sword, ${catch_.sharks} shark loot) ` +
        `${rate(caught, fishMs)} | +${catch_.xp}xp | idle ${fmtSec(catch_.idleMs)} clicks ${catch_.clicks} | ${invSummary(FISH_ANY)}`
    );

    await pickupDroppedSharks();

    let cooked = { cooked: 0, burnt: 0, xp: 0, leftover: countItems(RAW) };
    if (pendingFatpigTrade || fatpigWaitingAtBank()) {
        log('Fatpig waiting — banking raw and handing over cooked notes');
    } else {
        const toRange = Date.now();
        await intent('cook on way to bank');
        cooked = await cookInventory();
        cookMs += Date.now() - toRange;
        const burnPct = cooked.cooked + cooked.burnt > 0
            ? `${((100 * cooked.burnt) / (cooked.cooked + cooked.burnt)).toFixed(1)}%`
            : 'n/a';
        log(
            `trip ${n} COOK ${fmtSec(cookMs)} | ${cooked.cooked} cooked ${cooked.burnt} burnt (${burnPct}) ` +
            `+${cooked.xp}xp leftover ${cooked.leftover} | ${invSummary(FISH_ANY)}`
        );
    }

    const toBank = Date.now();
    await intent('bank fish');
    await bankCatch();
    bankMs += Date.now() - toBank;
    log(`trip ${n} BANK ${fmtSec(bankMs)} harpoon=${hasHarpoon()} inv=${occupiedSlots()} @ ${pos().x},${pos().z}`);

    const total = Date.now() - tripStart;
    walkMs = Math.max(0, total - fishMs - cookMs - bankMs);
    log(
        `trip ${n} TOTAL ${fmtSec(total)} | fish ${fmtSec(fishMs)} (${((100 * fishMs) / total).toFixed(0)}%) ` +
        `cook ${fmtSec(cookMs)} (${((100 * cookMs) / total).toFixed(0)}%) ` +
        `bank ${fmtSec(bankMs)} (${((100 * bankMs) / total).toFixed(0)}%) ` +
        `other/walk ${fmtSec(walkMs)} | ${rate(caught, total)} caught`
    );

    session.n++;
    session.totalMs += total;
    session.fishMs += fishMs;
    session.cookMs += cookMs;
    session.walkMs += walkMs;
    session.bankMs += bankMs;
    session.tuna += catch_.tuna;
    session.sword += catch_.sword;
    session.sharks += catch_.sharks;
    session.cooked += cooked.cooked;
    session.burnt += cooked.burnt;
    session.fishXp += catch_.xp;
    session.cookXp += cooked.xp;
    logSession();
}

try {
    const fish = sdk.getSkill('Fishing');
    const cook = sdk.getSkill('Cooking');
    const magic = sdk.getSkill('Magic');
    log(
        `Catherby harpoon sharks. Fish ${fish?.baseLevel} Cook ${cook?.baseLevel} Magic ${magic?.baseLevel} ` +
        `@ ${pos().x},${pos().z} harpoon=${hasHarpoon()} gp=${coins()}. ` +
        `When ${FISHER_MULE} is at the bank, hand over ALL cooked food.`
    );
    await bot.dismissBlockingUI();
    if (sdk.getState()?.shop?.isOpen) await bot.closeShop();
    if (sdk.getState()?.bank?.isOpen) await bot.closeBank();
    sdk.getNewChat();

    if (pos().isDead) {
        await sdk.waitForCondition((s) => !s.player.isDead, 45_000).catch(() => {});
    }

    if (!inCatherby()) {
        if (!(await camelotTeleport())) {
            log(`Camelot failed @ ${pos().x},${pos().z} — walking to Catherby bank`);
            await walkNear(BANK.x, BANK.z, 6);
        }
        if (!inCatherby()) {
            throw new Error(`Could not reach Catherby @ ${pos().x},${pos().z}`);
        }
    }

    if (!(await setupBankAndHarpoon())) {
        throw new Error(`Could not get a harpoon @ ${pos().x},${pos().z} gp=${coins()}`);
    }

    pollFatpigMule();
    if (pendingFatpigTrade || fatpigWaitingAtBank()) await giveAllFoodToFatpig();

    await cookAllBankedFish();

    let trip = 1;
    while (true) {
        await bot.dismissBlockingUI();
        pollFatpigMule();
        if (pos().isDead) {
            log('Died — waiting to respawn');
            await sdk.waitForCondition((s) => !s.player.isDead, 60_000).catch(() => {});
            log(`Respawned @ ${pos().x},${pos().z}`);
            if (!inCatherby()) {
                if (!(await camelotTeleport())) await walkNear(BANK.x, BANK.z, 6);
            }
            await setupBankAndHarpoon();
            continue;
        }
        if (pendingFatpigTrade || fatpigWaitingAtBank()) {
            await giveAllFoodToFatpig();
        }
        if (!hasHarpoon()) {
            log('Lost harpoon — restocking');
            if (!(await setupBankAndHarpoon())) {
                log('Cannot restock harpoon — stopping');
                break;
            }
        }
        await runTrip(trip);
        trip++;
        pollFatpigMule();
        if (pendingFatpigTrade || fatpigWaitingAtBank()) await giveAllFoodToFatpig();
    }
} catch (err) {
    console.error('Script error:', err);
    throw err;
} finally {
    logSession();
    console.log('Disconnecting SDK; browser client can stay open.');
    await sdk.disconnect();
}
