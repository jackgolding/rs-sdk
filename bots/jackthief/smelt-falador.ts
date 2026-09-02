/**
 * Smelt bars at the Falador furnace. Banks at Falador west.
 *
 *   bun bots/jackthief/smelt-falador.ts
 *
 * Order: rune (1 runite + 8 coal) → addy (1 addy + 6 coal) → gold (1 gold)
 * → mith (1 mith + 4 coal) → steel (1 iron + 2 coal). Skips a recipe with
 * no stock or if Smithing is too low. Logs cumulative bars to date in grind.log.
 */
import { BotSDK, deriveGatewayUrl } from '../../sdk/index';
import { BotActions } from '../../sdk/actions';
import { initPathfinding } from '../../sdk/pathfinding';
import { Spells } from '../../sdk/spells';
import { readFileSync, appendFileSync, existsSync } from 'fs';
import { dirname, join } from 'path';

const FALADOR_WEST_BANK = { x: 2945, z: 3368 };
const FURNACE = { x: 2974, z: 3369 };
const MAGIC_TAB = 6;

const COAL = /^coal$/i;
const WATER = /^water rune$/i;
const LAW = /^law rune$/i;
const AIR = /^air rune$/i;

type Recipe = {
    name: string;
    level: number;
    ore: RegExp;
    coalPerBar: number;
    bar: RegExp;
    make10: RegExp;
};

const RECIPES: Recipe[] = [
    { name: 'rune', level: 85, ore: /^runite ore$/i, coalPerBar: 8, bar: /^runite bar$/i, make10: /smelt\s+10.*rune/i },
    { name: 'adamant', level: 70, ore: /^adamantite ore$/i, coalPerBar: 6, bar: /^adamantite bar$/i, make10: /smelt\s+10.*adamant/i },
    { name: 'gold', level: 40, ore: /^gold ore$/i, coalPerBar: 0, bar: /^gold bar$/i, make10: /smelt\s+10.*gold/i },
    { name: 'mithril', level: 50, ore: /^mithril ore$/i, coalPerBar: 4, bar: /^mithril bar$/i, make10: /smelt\s+10.*mithril/i },
    { name: 'steel', level: 30, ore: /^iron ore$/i, coalPerBar: 2, bar: /^steel bar$/i, make10: /smelt\s+10.*steel/i }
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

function emptyTotals(): Record<string, number> {
    return Object.fromEntries(RECIPES.map((r) => [r.name, 0]));
}

function loadTotals(): Record<string, number> {
    const totals = emptyTotals();
    if (!existsSync(GRIND_LOG)) return totals;
    try {
        const text = readFileSync(GRIND_LOG, 'utf-8');
        const matches = [...text.matchAll(/Bars to date:\s*([^\n]+)/g)];
        const last = matches.at(-1)?.[1];
        if (!last) return totals;
        for (const r of RECIPES) {
            const m = last.match(new RegExp(`${r.name}\\s+(\\d+)`, 'i'));
            if (m) totals[r.name] = Number(m[1]);
        }
    } catch {
        /* ignore */
    }
    return totals;
}

function formatTotals(totals: Record<string, number>): string {
    return RECIPES.map((r) => `${r.name} ${totals[r.name] ?? 0}`).join(' | ');
}

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

let lastSmith = 0;
const sessionBars = emptyTotals();
const totalsToDate = loadTotals();

function pos() {
    const p = sdk.getState()?.player;
    return { x: p?.worldX ?? 0, z: p?.worldZ ?? 0, level: p?.level ?? 0 };
}

function distTo(x: number, z: number): number {
    return Math.hypot(pos().x - x, pos().z - z);
}

function inFalador(): boolean {
    const p = pos();
    return p.x >= 2935 && p.x <= 3030 && p.z >= 3325 && p.z <= 3398 && p.z < 6400;
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

const TO_FALADOR_WEST = [
    { x: 2810, z: 3444 },
    { x: 2868, z: 3426 },
    { x: 2893, z: 3427 },
    { x: 2932, z: 3436 },
    { x: 2965, z: 3382 },
    { x: FALADOR_WEST_BANK.x, z: FALADOR_WEST_BANK.z }
];

async function tryFaladorTeleport(): Promise<boolean> {
    if (count(WATER) < 1 || count(LAW) < 1 || count(AIR) < 3) return false;
    if ((sdk.getSkill('Magic')?.baseLevel ?? 0) < 37) return false;
    const before = pos();
    await sdk.sendSetTab(MAGIC_TAB);
    await sdk.waitForTicks(1);
    await sdk.sendClickComponent(Spells.FALADOR_TELEPORT);
    await sdk.waitForCondition(() => Math.hypot(pos().x - before.x, pos().z - before.z) > 40, 8_000).catch(() => {});
    return Math.hypot(pos().x - before.x, pos().z - before.z) > 40;
}

async function ensureAtFalador(): Promise<void> {
    if (inFalador() || distTo(FALADOR_WEST_BANK.x, FALADOR_WEST_BANK.z) <= 25) return;
    if (await tryFaladorTeleport()) {
        log(`Falador teleport @ ${pos().x},${pos().z}`);
        return;
    }
    log('Walking to Falador west bank');
    for (const p of TO_FALADOR_WEST) {
        if (inFalador() || distTo(FALADOR_WEST_BANK.x, FALADOR_WEST_BANK.z) <= 12) break;
        await walkNear(p.x, p.z, 4);
    }
}

async function openWestBank(): Promise<boolean> {
    await closeUi();
    if (distTo(FALADOR_WEST_BANK.x, FALADOR_WEST_BANK.z) > 8) {
        await walkNear(FALADOR_WEST_BANK.x, FALADOR_WEST_BANK.z, 3);
    }
    if (bankReady()) return true;
    if (sdk.getState()?.bank?.isOpen || sdk.getState()?.interface?.isOpen) {
        await bot.closeInterface();
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

function logBarsToDate(): void {
    log(`Bars to date: ${formatTotals(totalsToDate)} | session ${formatTotals(sessionBars)} | Smithing ${smithing()} (${smithXp()} xp)`);
}

async function bankBars(): Promise<void> {
    if (!(await openWestBank())) return;
    const before = Object.fromEntries(RECIPES.map((r) => [r.name, count(r.bar)]));
    for (const item of [...sdk.getInventory()].filter((i) => isBar(i.name))) {
        await bot.depositItem(item, -1);
    }
    let depositedAny = false;
    for (const r of RECIPES) {
        const deposited = before[r.name]! - count(r.bar);
        if (deposited > 0) {
            depositedAny = true;
            sessionBars[r.name] = (sessionBars[r.name] ?? 0) + deposited;
            totalsToDate[r.name] = (totalsToDate[r.name] ?? 0) + deposited;
            log(`Banked ${deposited} ${r.name}`);
        }
    }
    if (depositedAny) logBarsToDate();
    await bot.closeBank();
}

type PickResult =
    | { kind: 'recipe'; recipe: Recipe }
    | { kind: 'empty' };

function pickRecipe(): PickResult {
    for (const recipe of RECIPES) {
        const have = bankBarsPossible(recipe) + invBarsPossible(recipe);
        if (have <= 0) continue;
        if (smithing() < recipe.level) {
            log(`Skip ${recipe.name}: need Smithing ${recipe.level} (have ${smithing()})`);
            continue;
        }
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

async function restock(): Promise<{ kind: 'ok'; recipe: Recipe } | { kind: 'empty' } | { kind: 'fail' }> {
    if (!(await openWestBank())) return { kind: 'fail' };
    for (const item of [...sdk.getInventory()]) {
        await bot.depositItem(item, -1);
    }
    await logBankStock();
    const picked = pickRecipe();
    if (picked.kind !== 'recipe') {
        await bot.closeBank();
        return { kind: 'empty' };
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

async function clickMake10(recipe: Recipe): Promise<boolean> {
    const dialog = sdk.getDialog();
    if (!dialog?.isOpen) return false;
    const clicked = await sdk.clickDialogByText(recipe.make10);
    if (clicked.success) return true;
    const opts = dialog.options ?? [];
    const make10 = opts.find((o) => recipe.make10.test(o.text) || /smelt\s+10/i.test(o.text) || /^make\s+10$/i.test(o.text));
    if (make10) {
        await sdk.sendClickDialog(make10.index);
        return true;
    }
    return false;
}

async function smeltBatch(recipe: Recipe): Promise<number> {
    await closeUi();
    if (invBarsPossible(recipe) < 1) return 0;
    if (distTo(FURNACE.x, FURNACE.z) > 6) {
        await walkNear(FURNACE.x, FURNACE.z, 2);
    }
    const beforeBars = count(recipe.bar);
    const beforeXp = smithXp();
    let furnace = findFurnace();
    if (!furnace) {
        await sdk.scanNearbyLocs(10).catch(() => {});
        furnace = findFurnace();
    }
    if (!furnace) {
        log(`No smeltable furnace @ ${pos().x},${pos().z}`);
        return 0;
    }
    const opened = await bot.interactLoc(furnace, /smelt/i);
    if (!opened.success) {
        const ore = sdk.findInventoryItem(recipe.ore);
        if (!ore) return 0;
        const use = await sdk.sendUseItemOnLoc(ore.slot, furnace.x, furnace.z, furnace.id);
        if (!use.success) {
            log(`smelt: ${opened.message}; use ore: ${use.message}`);
            return 0;
        }
    }
    await sdk.waitForCondition((s) => s.dialog?.isOpen || count(recipe.bar) > beforeBars, 8_000).catch(() => {});
    if (sdk.getDialog()?.isOpen) {
        if (!(await clickMake10(recipe))) {
            log(`No Smelt 10 for ${recipe.name}: ${(sdk.getDialog()?.options ?? []).map((o) => o.text).join(' | ')}`);
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
        log(
            `Smelted +${made} ${recipe.name} | inv ${count(recipe.bar)} bars | ore ${count(recipe.ore)}${
                recipe.coalPerBar ? ` coal ${count(COAL)}` : ''
            }`
        );
    }
    return made;
}

try {
    lastSmith = smithing();
    await bot.dismissBlockingUI();
    log(
        `Falador smelt start Smithing ${lastSmith} (${smithXp()} xp) @ ${pos().x},${pos().z} — rune → addy → gold → mith → steel | ${formatTotals(totalsToDate)} to date`
    );

    await ensureAtFalador();

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

    log(`Done — session ${formatTotals(sessionBars)} | Bars to date: ${formatTotals(totalsToDate)} | Smithing ${smithing()} (${smithXp()} xp)`);
} catch (err) {
    console.error('Script error:', err);
    throw err;
} finally {
    console.log('Disconnecting SDK; lite client can stay open.');
    await sdk.disconnect();
}
