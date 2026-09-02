import { BotSDK, deriveGatewayUrl } from '../../sdk/index';
import { BotActions } from '../../sdk/actions';
import { initPathfinding } from '../../sdk/pathfinding';
import { readFileSync, appendFileSync } from 'fs';
import { dirname, join } from 'path';

const EDGEVILLE_BANK = { x: 3094, z: 3492 };
const BARB_SPOTS = { x: 3104, z: 3430 };
const RANGE_LADDER = { x: 3083, z: 3513 };
/** East of loc_2728 (forceapproach=east). Do not walkTo the range tile — pathfinding drops to ground. */
const RANGE_STAND = { x: 3083, z: 3508 };
const KEEP = /^(coins|small fishing net|fishing rod|fly fishing rod|fishing bait|feather)$/i;
const RAW_FISH = /^raw /i;
const COOKED_OR_BURNT = /^(shrimps?|anchovies|sardine|herring|trout|pike|salmon|burnt (fish|shrimp)s?)$/i;

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

function pos() {
    const p = sdk.getState()?.player;
    return {
        x: p?.worldX ?? 0,
        z: p?.worldZ ?? 0,
        level: p?.level ?? 0,
        isDead: p?.isDead ?? false,
    };
}

function distTo(x: number, z: number): number {
    const p = pos();
    return Math.hypot(p.x - x, p.z - z);
}

function fishingLevel(): number {
    return sdk.getSkill('Fishing')?.baseLevel ?? 1;
}

function fishingXp(): number {
    return sdk.getSkill('Fishing')?.experience ?? 0;
}

function cookingXp(): number {
    return sdk.getSkill('Cooking')?.experience ?? 0;
}

function has(pattern: RegExp): boolean {
    return !!sdk.findInventoryItem(pattern);
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

function countBank(pattern: RegExp): number {
    return (sdk.getBankItems() ?? []).filter((i) => pattern.test(i.name)).reduce((n, i) => n + i.count, 0);
}

let bankFeathers = -1;
let bankBait = -1;
let bankRaw = -1;

function rememberBank(): void {
    bankFeathers = countBank(/^feather$/i);
    bankBait = countBank(/^fishing bait$/i);
    bankRaw = countBank(RAW_FISH);
}

async function intent(msg: string): Promise<void> {
    await sdk.showIntent(msg).catch(() => {});
}

async function walkNear(x: number, z: number, tolerance = 6): Promise<boolean> {
    if (distTo(x, z) <= tolerance) return true;
    const result = await bot.walkTo(x, z, Math.min(tolerance, 3));
    log(`walkTo(${x},${z}): ${result.success ? 'ok' : result.message} @ ${pos().x},${pos().z}`);
    return result.success || distTo(x, z) <= tolerance + 2;
}

async function openBankAt(x: number, z: number): Promise<boolean> {
    if (pos().level !== 0) await climbToGround();
    if (sdk.getState()?.shop?.isOpen) await bot.closeShop();
    if (sdk.getState()?.bank?.isOpen) return true;
    if (sdk.getState()?.interface?.isOpen && !sdk.getState()?.bank?.isOpen) {
        await bot.closeInterface();
    }
    await walkNear(x, z, 4);
    if (sdk.getState()?.bank?.isOpen) {
        rememberBank();
        return true;
    }
    const opened = await bot.openBank();
    if (!opened.success) {
        log(`openBank failed: ${opened.message}`);
        return false;
    }
    rememberBank();
    return true;
}

async function depositJunk(): Promise<void> {
    for (let i = 0; i < 40; i++) {
        const item = sdk.getInventory().find((it) => !KEEP.test(it.name));
        if (!item) break;
        const r = await bot.depositItem(new RegExp(`^${item.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i'), -1);
        log(`Deposit ${item.name}: ${r.success || r.partial} ${r.message ?? ''}`);
        if (!r.success && !r.partial) break;
    }
}

async function climbToGround(): Promise<void> {
    if (pos().level === 0) return;
    const ladder =
        sdk.findNearbyLoc(/^ladder$/i, { withOption: /climb-down/i }) ??
        sdk.findNearbyLoc(/^staircase$/i, { withOption: /climb-down|walk-down/i });
    if (!ladder) {
        log('No down ladder — walking toward range house');
        await walkNear(RANGE_LADDER.x, RANGE_LADDER.z, 2);
    }
    const down =
        sdk.findNearbyLoc(/^ladder$/i, { withOption: /climb-down/i }) ??
        sdk.findNearbyLoc(/^staircase$/i, { withOption: /climb-down|walk-down/i });
    if (down) {
        await bot.interactLoc(down, /climb-down|walk-down/i);
        await sdk.waitForCondition((s) => s.player.level === 0, 12_000).catch(() => {});
    }
    log(`Floor ${pos().level} @ ${pos().x},${pos().z}`);
}

async function floorWalk(x: number, z: number, tolerance = 1): Promise<boolean> {
    const startLevel = pos().level;
    if (distTo(x, z) <= tolerance && pos().level === startLevel) return true;
    await sdk.sendWalk(x, z, true);
    try {
        await sdk.waitForCondition((s) => {
            if (s.player.level !== startLevel) return true;
            return Math.hypot(s.player.worldX - x, s.player.worldZ - z) <= tolerance;
        }, 8_000);
    } catch {
        /* timed out */
    }
    if (pos().level !== startLevel) {
        log(`floorWalk dropped to ${pos().level} — abort`);
        return false;
    }
    return distTo(x, z) <= tolerance + 1;
}

function findRange() {
    const ranges = (sdk.getNearbyLocs() ?? []).filter(
        (l) => /^range$/i.test(l.name) && l.level === pos().level
    );
    return ranges.find((l) => l.reachable) ?? ranges[0] ?? null;
}

async function goToRange(): Promise<boolean> {
    if (pos().level !== 1) {
        await climbToGround();
        await walkNear(RANGE_LADDER.x, RANGE_LADDER.z, 2);
        const ladder = sdk.findNearbyLoc(/^ladder$/i, { withOption: /climb-up/i });
        if (!ladder) {
            log('No climb-up ladder at Edgeville range house');
            return false;
        }
        await bot.interactLoc(ladder, /climb-up/i);
        await sdk.waitForCondition((s) => s.player.level === 1, 12_000).catch(() => {});
    }
    if (pos().level !== 1) {
        log(`Failed to climb: floor ${pos().level} @ ${pos().x},${pos().z}`);
        return false;
    }
    await floorWalk(RANGE_STAND.x, RANGE_STAND.z, 1);
    const range = findRange();
    log(`Upstairs ${pos().level} range=${range ? `${range.id} ${range.x},${range.z} reach=${range.reachable}` : 'none'} @ ${pos().x},${pos().z}`);
    return !!range;
}

async function withdrawFishingGear(): Promise<void> {
    if (!(await openBankAt(EDGEVILLE_BANK.x, EDGEVILLE_BANK.z))) return;
    if (!has(/^fishing rod$/i)) await bot.withdrawItem(/^fishing rod$/i, 1).catch(() => {});
    if (!has(/^fly fishing rod$/i)) await bot.withdrawItem(/fly fishing rod/i, 1).catch(() => {});
    if (countItems(/^feather$/i) === 0) await bot.withdrawItem(/^feather$/i, -1).catch(() => {});
    if (countItems(/^fishing bait$/i) === 0) await bot.withdrawItem(/fishing bait/i, -1).catch(() => {});
    rememberBank();
    await bot.closeBank();
    log(`Gear fly=${has(/^fly fishing rod$/i)} rod=${has(/^fishing rod$/i)} feathers=${countItems(/^feather$/i)}(+bank ${bankFeathers}) bait=${countItems(/^fishing bait$/i)}(+bank ${bankBait})`);
}

async function depositCatch(): Promise<void> {
    if (!inventoryIsFull() && sdk.getInventory().filter((i) => !KEEP.test(i.name)).length === 0) return;
    const dump = sdk.getInventory().filter((i) => !KEEP.test(i.name));
    if (dump.length === 0) return;
    log(`Banking ${dump.map((i) => i.name).join(', ')}`);
    await intent('bank fish');
    if (!(await openBankAt(EDGEVILLE_BANK.x, EDGEVILLE_BANK.z))) return;
    for (const item of [...sdk.getInventory()]) {
        if (KEEP.test(item.name)) continue;
        await bot.depositItem(item, -1);
    }
    if (countItems(/^feather$/i) === 0) await bot.withdrawItem(/^feather$/i, -1).catch(() => {});
    if (countItems(/^feather$/i) === 0 && countItems(/^fishing bait$/i) === 0) {
        await bot.withdrawItem(/fishing bait/i, -1).catch(() => {});
    }
    rememberBank();
    await bot.closeBank();
}

function suppliesLeft(): { feathers: number; bait: number } {
    const feathers = countItems(/^feather$/i) + Math.max(0, bankFeathers);
    const bait = countItems(/^fishing bait$/i) + Math.max(0, bankBait);
    return { feathers, bait };
}

function methodForSupplies(): { name: 'lure' | 'bait'; option: RegExp } | null {
    if (countItems(/^feather$/i) > 0 && has(/^fly fishing rod$/i)) {
        return { name: 'lure', option: /lure/i };
    }
    if (countItems(/^fishing bait$/i) > 0 && has(/^fishing rod$/i)) {
        return { name: 'bait', option: /bait/i };
    }
    return null;
}

function findSpot(option: RegExp) {
    const spots = (sdk.getNearbyNpcs() ?? []).filter((n) => /fishing spot/i.test(n.name));
    const withOpt = spots.filter((s) => s.optionsWithIndex.some((o) => option.test(o.text)));
    return withOpt[0] ?? spots[0] ?? null;
}

async function fishOnce(method: { name: 'lure' | 'bait'; option: RegExp }): Promise<void> {
    let spot = findSpot(method.option);
    if (!spot || (spot.distance ?? 99) > 8) {
        await walkNear(BARB_SPOTS.x, BARB_SPOTS.z, 4);
        spot = findSpot(method.option);
    }
    if (!spot) {
        log('No fishing spot nearby');
        await walkNear(
            Math.round(BARB_SPOTS.x + (Math.random() * 4 - 2)),
            Math.round(BARB_SPOTS.z + (Math.random() * 4 - 2)),
            3
        );
        return;
    }
    const match = spot.optionsWithIndex.find((o) => method.option.test(o.text));
    if (!match) {
        log(`Spot options: ${spot.optionsWithIndex.map((o) => o.text).join(', ')}`);
        await sdk.waitForTicks(1);
        return;
    }

    const invBefore = occupiedSlots();
    const xpBefore = fishingXp();
    const started = Date.now();
    await sdk.sendInteractNpc(spot.index, match.opIndex);

    try {
        await sdk.waitForCondition((s) => {
            if (s.dialog.isOpen) return true;
            if (s.interface?.isOpen && !s.shop?.isOpen && !s.bank?.isOpen) return true;
            if (s.inventory.filter((i) => (i.count ?? 0) > 0).length >= 28) return true;
            const fishing = s.skills.find((sk) => sk.name === 'Fishing');
            const gained = (fishing?.experience ?? 0) > xpBefore || s.inventory.length > invBefore;
            const idle = (s.player?.animId ?? -1) === -1;
            if (gained && idle) return true;
            if (!gained && idle && Date.now() - started > 2500) return true;
            return false;
        }, 8_000);
    } catch {
        /* recast immediately */
    }
}

async function cookInventory(): Promise<void> {
    if (countItems(RAW_FISH) === 0) return;
    if (!(await goToRange())) return;
    await intent('cook fish');

    let idleCasts = 0;
    while (countItems(RAW_FISH) > 0 && idleCasts < 50) {
        if (pos().level !== 1) {
            log('Left the range floor — climbing back');
            if (!(await goToRange())) break;
        }

        const dialog = sdk.getDialog();
        if (dialog?.isOpen) {
            const cook = dialog.options.find((o) => /cook/i.test(o.text));
            await sdk.sendClickDialog(cook?.index ?? dialog.options[0]?.index ?? 0);
            await sdk.waitForTicks(1);
            idleCasts = 0;
            continue;
        }

        const raw = sdk.findInventoryItem(RAW_FISH);
        const range = findRange();
        if (!raw || !range) {
            log(`Cook stuck: raw=${raw?.name ?? 'none'} range=${!!range} floor=${pos().level} locs=${(sdk.getNearbyLocs() ?? []).map((l) => l.name).slice(0, 8).join(',')}`);
            if (!(await goToRange())) break;
            idleCasts++;
            continue;
        }

        if (distTo(RANGE_STAND.x, RANGE_STAND.z) > 2) {
            await floorWalk(RANGE_STAND.x, RANGE_STAND.z, 1);
        }

        const xpBefore = cookingXp();
        const rawBefore = countItems(RAW_FISH);
        const r = await sdk.sendUseItemOnLoc(raw.slot, range.x, range.z, range.id);
        if (!r.success) log(`sendUseItemOnLoc: ${r.message}`);

        try {
            await sdk.waitForCondition((s) => {
                if (s.dialog.isOpen) return true;
                const xp = s.skills.find((sk) => sk.name === 'Cooking')?.experience ?? 0;
                if (xp > xpBefore) return true;
                const rawNow = s.inventory.filter((i) => RAW_FISH.test(i.name)).reduce((n, i) => n + i.count, 0);
                return rawNow < rawBefore;
            }, 6_000);
        } catch {
            /* recast — this game cooks one fish per use */
        }

        if (cookingXp() === xpBefore && countItems(RAW_FISH) === rawBefore) {
            idleCasts++;
            if (idleCasts === 1 || idleCasts % 10 === 0) {
                log(`Cook miss ${idleCasts} ${raw.name} on ${range.name}(${range.x},${range.z}) @ ${pos().x},${pos().z} L${pos().level}`);
            }
        } else {
            idleCasts = 0;
        }
    }
    log(`Cooked inventory, raw left=${countItems(RAW_FISH)} cooking ${sdk.getSkill('Cooking')?.baseLevel} (${cookingXp()} xp)`);
}

async function bankCooked(): Promise<void> {
    const dump = sdk.getInventory().filter((i) => !KEEP.test(i.name));
    if (dump.length === 0) return;
    log(`Banking cooked: ${dump.map((i) => i.name).join(', ')}`);
    if (!(await openBankAt(EDGEVILLE_BANK.x, EDGEVILLE_BANK.z))) return;
    await depositJunk();
    rememberBank();
    await bot.closeBank();
}

async function withdrawRawFish(): Promise<boolean> {
    if (!(await openBankAt(EDGEVILLE_BANK.x, EDGEVILLE_BANK.z))) return false;
    rememberBank();
    const seen = new Set<string>();
    const raws = (sdk.getBankItems() ?? []).filter((i) => {
        if (!RAW_FISH.test(i.name) || seen.has(i.name)) return false;
        seen.add(i.name);
        return true;
    });
    log(`Bank raw: ${raws.map((i) => `${i.count} ${i.name}`).join(', ') || 'none'} (bank open=${sdk.getState()?.bank?.isOpen})`);
    if (raws.length === 0) {
        await bot.closeBank();
        return false;
    }
    for (const item of raws) {
        if (occupiedSlots() >= 28) break;
        const r = await bot.withdrawItem(item, -1);
        log(`Withdraw ${item.name}: ${r.success || r.partial} ${r.message ?? ''}`);
        if (occupiedSlots() >= 28) break;
    }
    rememberBank();
    await bot.closeBank();
    log(`Bank raw remaining=${bankRaw}. Withdrew: ${sdk.getInventory().filter((i) => RAW_FISH.test(i.name)).map((i) => `${i.count} ${i.name}`).join(', ')}`);
    return countItems(RAW_FISH) > 0;
}

async function cookAllBankedFish(): Promise<void> {
    log('Fishing supplies gone — cooking everything at Edgeville range');
    if (countItems(RAW_FISH) > 0) {
        await cookInventory();
        await bankCooked();
    }
    while (await withdrawRawFish()) {
        await cookInventory();
        await bankCooked();
    }
    log(`Cooking done. Cooking ${sdk.getSkill('Cooking')?.baseLevel} (${cookingXp()} xp)`);
}

try {
    console.log(`Cook all banked fish on Edgeville range. Fishing ${fishingLevel()} Cooking ${sdk.getSkill('Cooking')?.baseLevel} @ ${pos().x},${pos().z} L${pos().level}`);
    await bot.dismissBlockingUI();
    if (sdk.getState()?.shop?.isOpen) await bot.closeShop();
    if (sdk.getState()?.bank?.isOpen) await bot.closeBank();

    await cookAllBankedFish();
    log(`Done. Fishing ${fishingLevel()} Cooking ${sdk.getSkill('Cooking')?.baseLevel} (${cookingXp()} xp)`);
} catch (err) {
    console.error('Script error:', err);
    throw err;
} finally {
    console.log('Disconnecting SDK; browser client can stay open.');
    await sdk.disconnect();
}
