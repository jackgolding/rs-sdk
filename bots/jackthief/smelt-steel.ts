/**
 * Smelt bars at the Al Kharid furnace. Banks at Al Kharid.
 *
 *   bun bots/jackthief/smelt-steel.ts
 *
 * Order: steel (1 iron + 2 coal) → gold (1 gold ore) → mithril (1 mith + 4 coal)
 * → addy (1 addy + 6 coal). Stops when none of those can be made from bank stock.
 * Will not skip a recipe that still has ores if Smithing is too low.
 */
import { BotSDK, deriveGatewayUrl } from '../../sdk/index';
import { BotActions } from '../../sdk/actions';
import { initPathfinding } from '../../sdk/pathfinding';
import { readFileSync, appendFileSync } from 'fs';
import { dirname, join } from 'path';

const AL_KHARID_BANK = { x: 3269, z: 3167 };
const FURNACE = { x: 3271, z: 3186 };

const COAL = /^coal$/i;
const COINS = /^coins$/i;

type Recipe = {
    name: string;
    level: number;
    ore: RegExp;
    coalPerBar: number;
    bar: RegExp;
    dialog: RegExp;
};

const RECIPES: Recipe[] = [
    { name: 'steel', level: 30, ore: /^iron ore$/i, coalPerBar: 2, bar: /^steel bar$/i, dialog: /steel/i },
    { name: 'gold', level: 40, ore: /^gold ore$/i, coalPerBar: 0, bar: /^gold bar$/i, dialog: /gold/i },
    { name: 'mithril', level: 50, ore: /^mithril ore$/i, coalPerBar: 4, bar: /^mithril bar$/i, dialog: /mithril/i },
    { name: 'adamant', level: 70, ore: /^adamantite ore$/i, coalPerBar: 6, bar: /^adamantite bar$/i, dialog: /adamant/i }
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
    autoLaunchBrowser: 'auto',
    browserLaunchTimeout: 90_000,
    readyTimeout: 45_000,
    connectTimeout: 60_000,
    showChat: false
});

console.log('Opening/attaching the game client...');
await sdk.connect();
const bot = new BotActions(sdk);

let lastSmith = 0;
const sessionBars: Record<string, number> = { steel: 0, gold: 0, mithril: 0, adamant: 0 };

function pos() {
    const p = sdk.getState()?.player;
    return { x: p?.worldX ?? 0, z: p?.worldZ ?? 0, level: p?.level ?? 0 };
}

function distTo(x: number, z: number): number {
    return Math.hypot(pos().x - x, pos().z - z);
}

function smithing(): number {
    return sdk.getSkill('Smithing')?.baseLevel ?? 1;
}

function smithXp(): number {
    return sdk.getSkill('Smithing')?.experience ?? 0;
}

function count(pattern: RegExp): number {
    return sdk.getInventory().filter((i) => pattern.test(i.name)).reduce((n, i) => n + (i.count ?? 1), 0);
}

function slotsPerBar(recipe: Recipe): number {
    return 1 + recipe.coalPerBar;
}

function barsPerTrip(recipe: Recipe): number {
    return Math.floor(28 / slotsPerBar(recipe));
}

function invBarsPossible(recipe: Recipe): number {
    const ore = count(recipe.ore);
    if (recipe.coalPerBar <= 0) return ore;
    return Math.min(ore, Math.floor(count(COAL) / recipe.coalPerBar));
}

function bankCount(pattern: RegExp): number {
    return sdk.findBankItem(pattern)?.count ?? 0;
}

function bankBarsPossible(recipe: Recipe): number {
    const ore = bankCount(recipe.ore);
    if (recipe.coalPerBar <= 0) return ore;
    return Math.min(ore, Math.floor(bankCount(COAL) / recipe.coalPerBar));
}

function bankReady(): boolean {
    const s = sdk.getState();
    return !!(s?.bank?.isOpen && s?.interface?.isOpen);
}

async function closeUi(): Promise<void> {
    const s = sdk.getState();
    if (s?.shop?.isOpen || (s?.interface?.isOpen && !s?.bank?.isOpen)) {
        await bot.closeInterface();
    }
    await bot.dismissBlockingUI();
    const dialog = sdk.getDialog();
    if (dialog?.isOpen && dialog.options?.length === 1) {
        await sdk.sendClickDialog(dialog.options[0]!.index);
        await sdk.waitForTicks(1);
    }
}

async function walkNear(x: number, z: number, tolerance = 4): Promise<boolean> {
    if (distTo(x, z) <= tolerance) return true;
    const result = await bot.walkTo(x, z, Math.min(tolerance, 3));
    return result.success || distTo(x, z) <= tolerance + 2;
}

const TO_AL_KHARID = [
    { x: 3210, z: 3210 },
    { x: 3268, z: 3226 },
    { x: 3276, z: 3180 },
    { x: AL_KHARID_BANK.x, z: AL_KHARID_BANK.z }
];

async function ensureAtAlKharid(): Promise<void> {
    if (distTo(AL_KHARID_BANK.x, AL_KHARID_BANK.z) <= 25 && pos().z < 6400) return;
    log('Walking to Al Kharid');
    for (const p of TO_AL_KHARID) {
        if (distTo(AL_KHARID_BANK.x, AL_KHARID_BANK.z) <= 25) break;
        await walkNear(p.x, p.z, 4);
    }
}

async function openAlKharidBank(): Promise<boolean> {
    await closeUi();
    if (distTo(AL_KHARID_BANK.x, AL_KHARID_BANK.z) > 8) {
        await walkNear(AL_KHARID_BANK.x, AL_KHARID_BANK.z, 3);
    }
    if (bankReady()) return true;
    if (sdk.getState()?.bank?.isOpen || sdk.getState()?.interface?.isOpen) {
        await bot.closeBank();
        await sdk.waitForTicks(1);
    }
    const opened = await bot.openBank();
    if (!opened.success) log(`openBank: ${opened.message}`);
    await sdk.waitForCondition(() => bankReady(), 5_000).catch(() => {});
    if (!bankReady()) {
        log(`Bank not ready after open (bank=${!!sdk.getState()?.bank?.isOpen} iface=${!!sdk.getState()?.interface?.isOpen})`);
        return false;
    }
    return true;
}

function isBar(name: string): boolean {
    return RECIPES.some((r) => r.bar.test(name));
}

async function bankBars(): Promise<void> {
    if (!(await openAlKharidBank())) return;
    const before = Object.fromEntries(RECIPES.map((r) => [r.name, count(r.bar)]));
    for (const item of [...sdk.getInventory()].filter((i) => isBar(i.name))) {
        await bot.depositItem(item, -1);
    }
    for (const r of RECIPES) {
        const deposited = before[r.name]! - count(r.bar);
        if (deposited > 0) {
            log(`Banked ${deposited} ${r.name} | session ${sessionBars[r.name]} | Smithing ${smithing()} (${smithXp()} xp)`);
        }
    }
    await bot.closeBank();
}

type PickResult =
    | { kind: 'recipe'; recipe: Recipe }
    | { kind: 'need_level'; recipe: Recipe }
    | { kind: 'empty' };

function pickRecipe(): PickResult {
    for (const recipe of RECIPES) {
        if (bankBarsPossible(recipe) <= 0 && invBarsPossible(recipe) <= 0) continue;
        if (smithing() < recipe.level) return { kind: 'need_level', recipe };
        return { kind: 'recipe', recipe };
    }
    return { kind: 'empty' };
}

async function logBankStock(): Promise<void> {
    const bits: string[] = [];
    for (const r of RECIPES) {
        bits.push(`${r.name} ore ${bankCount(r.ore)}`);
    }
    bits.push(`coal ${bankCount(COAL)}`);
    log(`Bank stock: ${bits.join(', ')} | Smithing ${smithing()}`);
}

async function restock(): Promise<
    | { kind: 'ok'; recipe: Recipe }
    | { kind: 'empty' }
    | { kind: 'need_level'; recipe: Recipe }
    | { kind: 'fail' }
> {
    if (!(await openAlKharidBank())) return { kind: 'fail' };
    for (const item of [...sdk.getInventory()].filter((i) => !COINS.test(i.name))) {
        await bot.depositItem(item, -1);
    }
    await logBankStock();
    const picked = pickRecipe();
    if (picked.kind !== 'recipe') {
        await bot.closeBank();
        return picked.kind === 'empty' ? { kind: 'empty' } : { kind: 'need_level', recipe: picked.recipe };
    }
    const recipe = picked.recipe;
    const bars = Math.min(barsPerTrip(recipe), bankBarsPossible(recipe));
    if (bars <= 0) {
        await bot.closeBank();
        return { kind: 'empty' };
    }
    if (!bankReady()) {
        log('Bank closed before withdraw');
        return { kind: 'fail' };
    }
    const r1 = await bot.withdrawItem(recipe.ore, bars);
    if (!r1.success && !r1.partial) {
        log(`Withdraw ${recipe.name} ore failed: ${r1.message} (${r1.reason ?? '?'})`);
        await bot.closeBank();
        return { kind: 'fail' };
    }
    if (recipe.coalPerBar > 0) {
        const r2 = await bot.withdrawItem(COAL, bars * recipe.coalPerBar);
        if (!r2.success && !r2.partial) {
            log(`Withdraw coal failed: ${r2.message} (${r2.reason ?? '?'})`);
            await bot.closeBank();
            return { kind: 'fail' };
        }
        log(`Withdraw ${bars} ${recipe.name} trip: ore ${r1.amountWithdrawn ?? '?'} coal ${r2.amountWithdrawn ?? '?'}`);
    } else {
        log(`Withdraw ${bars} ${recipe.name} trip: ore ${r1.amountWithdrawn ?? '?'}`);
    }
    await bot.closeBank();
    if (invBarsPossible(recipe) < 1) return { kind: 'fail' };
    return { kind: 'ok', recipe };
}

function findFurnace() {
    return (
        sdk.findNearbyLoc(/furnace/i, { withOption: /smelt/i }) ??
        (sdk.getNearbyLocs() ?? []).find((l) => /furnace/i.test(l.name) && l.optionsWithIndex.some((o) => /smelt/i.test(o.text))) ??
        null
    );
}

async function smeltBatch(recipe: Recipe): Promise<number> {
    await closeUi();
    if (invBarsPossible(recipe) < 1) return 0;
    if (distTo(FURNACE.x, FURNACE.z) > 6) {
        await walkNear(FURNACE.x, FURNACE.z, 2);
    }
    const beforeBars = count(recipe.bar);
    const beforeXp = smithXp();
    const ore = sdk.findInventoryItem(recipe.ore);
    if (!ore) return 0;
    let furnace = findFurnace();
    if (!furnace) {
        await sdk.scanNearbyLocs(10).catch(() => {});
        furnace = findFurnace();
    }
    if (!furnace) {
        log(`No smeltable furnace @ ${pos().x},${pos().z}`);
        return 0;
    }
    const use = await sdk.sendUseItemOnLoc(ore.slot, furnace.x, furnace.z, furnace.id);
    if (!use.success) {
        log(`use ore on furnace: ${use.message}`);
        return 0;
    }
    await sdk.waitForCondition((s) => s.dialog?.isOpen || count(recipe.bar) > beforeBars, 8_000).catch(() => {});
    const dialog = sdk.getDialog();
    if (dialog?.isOpen) {
        const opts = dialog.options ?? [];
        const productAt = opts.findIndex((o) => recipe.dialog.test(o.text) && !/^make\s+/i.test(o.text));
        const grouped10 = productAt >= 2 ? opts[productAt - 2] : undefined;
        const make10 =
            (grouped10 && /^make\s+10$/i.test(grouped10.text) ? grouped10 : undefined) ??
            opts.find((o) => /^make\s+10$/i.test(o.text));
        const product = productAt >= 0 ? opts[productAt] : undefined;
        if (make10) {
            await sdk.sendClickDialog(make10.index);
        } else if (product) {
            await sdk.sendClickDialog(product.index);
        } else {
            await sdk.clickDialogByText(recipe.dialog).catch(() => sdk.sendClickDialog(0));
        }
    }
    const progressed = () =>
        count(recipe.bar) > beforeBars || smithXp() > beforeXp || invBarsPossible(recipe) === 0;
    await sdk.waitForCondition(progressed, 25_000).catch(() => {});
    let lastBars = count(recipe.bar);
    while (invBarsPossible(recipe) > 0) {
        const prev = lastBars;
        await sdk
            .waitForCondition(() => count(recipe.bar) > prev || invBarsPossible(recipe) === 0, 8_000)
            .catch(() => {});
        lastBars = count(recipe.bar);
        if (lastBars <= prev) break;
    }
    await closeUi();
    const made = count(recipe.bar) - beforeBars;
    if (made > 0) {
        sessionBars[recipe.name] = (sessionBars[recipe.name] ?? 0) + made;
        log(
            `Smelted +${made} ${recipe.name} | inv ${count(recipe.bar)} bars | ore ${count(recipe.ore)}${
                recipe.coalPerBar ? ` coal ${count(COAL)}` : ''
            }`
        );
    }
    return made;
}

function sessionSummary(): string {
    return RECIPES.map((r) => `${sessionBars[r.name] ?? 0} ${r.name}`).join(', ');
}

try {
    lastSmith = smithing();
    await bot.dismissBlockingUI();
    log(`Bar smelt start Smithing ${lastSmith} (${smithXp()} xp) @ ${pos().x},${pos().z} — steel → gold → mith → addy`);

    await ensureAtAlKharid();

    let recipe: Recipe | null = RECIPES.find((r) => invBarsPossible(r) >= 1 && smithing() >= r.level) ?? null;

    while (true) {
        await closeUi();
        if (smithing() !== lastSmith) {
            log(`LEVEL UP Smithing ${smithing()}`);
            lastSmith = smithing();
        }
        if (!recipe || invBarsPossible(recipe) < 1) {
            if (RECIPES.some((r) => count(r.bar) > 0)) await bankBars();
            const stocked = await restock();
            if (stocked.kind === 'ok') {
                if (!recipe || recipe.name !== stocked.recipe.name) {
                    log(`Now smelting ${stocked.recipe.name}`);
                }
                recipe = stocked.recipe;
            } else if (stocked.kind === 'empty') {
                break;
            } else if (stocked.kind === 'need_level') {
                log(
                    `Need Smithing ${stocked.recipe.level} for ${stocked.recipe.name} (have ${smithing()}) — not skipping to a later bar`
                );
                break;
            } else {
                await sdk.waitForTicks(3);
                recipe = null;
                continue;
            }
        }
        const made = await smeltBatch(recipe);
        if (made <= 0 && invBarsPossible(recipe) > 0) {
            await sdk.waitForTicks(2);
            continue;
        }
        if (invBarsPossible(recipe) < 1 && count(recipe.bar) > 0) await bankBars();
    }

    log(`Done — session ${sessionSummary()} | Smithing ${smithing()} (${smithXp()} xp)`);
} catch (err) {
    console.error('Script error:', err);
    throw err;
} finally {
    console.log('Disconnecting SDK; browser client can stay open.');
    await sdk.disconnect();
}
