/**
 * Bank yew/magic logs into strung bows. Uses bowstrings from the same bank
 * when they are there; otherwise cuts unstrung and deposits those.
 *
 * Each trip: knife + 13 logs + 13 bowstrings (unstackable), Make X cut, string, bank.
 * Highest product the character can make: magic long (85) → magic short (80)
 * → yew long (70) → yew short (65). Stays at the nearest of the known banks.
 *
 *   bun bots/quests/bank-fletch.ts jackthief
 */
import { ActivitySession, BotSDK, deriveGatewayUrl } from '../../sdk/index';
import { BotActions } from '../../sdk/actions';
import { initPathfinding } from '../../sdk/pathfinding';
import { existsSync, readFileSync } from 'fs';
import { dirname, join } from 'path';
import {
    ARDOUGNE_BANK,
    CATHERBY_BANK,
    DRAYNOR_BANK,
    EDGEVILLE,
    SEERS_BANK,
    type Tile
} from './tiles';
import { closeUi as closeUiShared, distTo as distToShared, walkNear as walkNearShared } from './movement';
import { resolveSkillDialogProduct } from '../../sdk/action-quantity';

const KNIFE = /^knife$/i;
const COINS = /^coins$/i;
const BOWSTRING = /^bow\s*string$/i;
const BOW = /^(yew|magic) (shortbow|longbow)$/i;
const KEEP = /^(coins|knife)$/i;
/** Unstackable strings + logs: 13 + 13 leaves knife (and coins) in the bag. */
const BATCH = 13;

type Tier = {
    logs: RegExp;
    label: string;
    product: string;
    level: number;
};

/** Best XP first. */
const TIERS: Tier[] = [
    { logs: /^magic logs$/i, label: 'magic logs', product: 'magic long', level: 85 },
    { logs: /^magic logs$/i, label: 'magic logs', product: 'magic short', level: 80 },
    { logs: /^yew logs$/i, label: 'yew logs', product: 'yew long', level: 70 },
    { logs: /^yew logs$/i, label: 'yew logs', product: 'yew short', level: 65 }
];

const BANKS: Tile[] = [ARDOUGNE_BANK, SEERS_BANK, CATHERBY_BANK, DRAYNOR_BANK, EDGEVILLE];

const argv = process.argv.slice(2);
const botArg = argv.find((a) => !a.startsWith('-'));

function loadBotEnv(): void {
    const envPath = botArg
        ? join(process.cwd(), 'bots', botArg, 'bot.env')
        : join(dirname(import.meta.path), 'bot.env');
    if (!existsSync(envPath)) {
        throw new Error(`bot.env not found at ${envPath}. Usage: bun bots/quests/bank-fletch.ts {botname}`);
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
    name: 'bank-fletch',
    grindLogPath: GRIND_LOG,
    maxRecoveryTactics: 8
});

let lastLoggedFl = 0;
let warnedNoStrings = false;
let home: Tile = ARDOUGNE_BANK;

function log(msg: string): void {
    session.log('log', msg);
}

function intent(msg: string): void {
    void session.showIntent(msg);
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
    return distToShared(sdk, x, z);
}

function fl(): number {
    return sdk.getSkill('Fletching')?.baseLevel ?? 1;
}

function flXp(): number {
    return sdk.getSkill('Fletching')?.experience ?? 0;
}

function occupiedSlots(): number {
    return sdk.getInventory().filter((i) => (i.count ?? 0) > 0).length;
}

function count(pattern: RegExp): number {
    return sdk.getInventory().filter((i) => pattern.test(i.name)).reduce((n, i) => n + (i.count ?? 1), 0);
}

function bankCount(pattern: RegExp): number {
    return sdk.getBankItems().filter((i) => pattern.test(i.name)).reduce((n, i) => n + (i.count ?? 0), 0);
}

function closestBank(): Tile {
    const p = pos();
    return BANKS.slice().sort((a, b) => Math.hypot(p.x - a.x, p.z - a.z) - Math.hypot(p.x - b.x, p.z - b.z))[0]!;
}

function isUnstrung(item: { name: string; optionsWithIndex?: { text: string }[] }): boolean {
    if (!BOW.test(item.name)) return false;
    return !(item.optionsWithIndex ?? []).some((o) => /wield/i.test(o.text));
}

function isStrung(item: { name: string; optionsWithIndex?: { text: string }[] }): boolean {
    if (!BOW.test(item.name)) return false;
    return (item.optionsWithIndex ?? []).some((o) => /wield/i.test(o.text));
}

function unstrungBows() {
    return sdk.getInventory().filter((i) => (i.count ?? 0) > 0 && isUnstrung(i));
}

function strungBows() {
    return sdk.getInventory().filter((i) => (i.count ?? 0) > 0 && isStrung(i));
}

function pickTier(): Tier | null {
    const level = fl();
    for (const t of TIERS) {
        if (level < t.level) continue;
        if (count(t.logs) > 0 || bankCount(t.logs) > 0) return t;
    }
    return null;
}

async function closeUi(): Promise<void> {
    const dialog = sdk.getDialog();
    if (dialog?.isOpen) {
        const opts = dialog.options ?? [];
        const skillDlg = opts.some((o) => /make \d+|make x|short bow|long bow|arrow shaft/i.test(o.text));
        if (skillDlg) {
            await sdk.sendCloseModal();
            await sdk.waitForTicks(1).catch(() => {});
            return;
        }
    }
    await closeUiShared(bot, sdk);
}

async function walkNear(x: number, z: number, tolerance = 4): Promise<boolean> {
    return walkNearShared(bot, sdk, x, z, tolerance);
}

async function openHomeBank(): Promise<boolean> {
    if (sdk.getState()?.bank?.isOpen) return true;
    await closeUi();
    session.setAnchor(home.x, home.z);
    if (distTo(home.x, home.z) > 6) {
        intent(`Walking to bank ${home.x},${home.z}`);
        await walkNear(home.x, home.z, 3);
    }
    if (!sdk.getState()?.bank?.isOpen) {
        const r = await bot.openBank();
        if (!r.success && !sdk.getState()?.bank?.isOpen) {
            session.noteFailure('bank_open', r.message || 'Could not open bank');
            return false;
        }
    }
    await sdk
        .waitForCondition((s) => s.bank?.isOpen === true && (s.bank.items?.length ?? 0) > 0, 8_000)
        .catch(() => {});
    return !!sdk.getState()?.bank?.isOpen;
}

async function depositKeep(): Promise<void> {
    for (const item of [...sdk.getInventory()]) {
        if (KEEP.test(item.name)) continue;
        const r = await bot.depositItem(item, -1);
        if (!r.success && sdk.isBankOpen()) {
            await sdk.sendBankDeposit(item.slot, -1);
            await sdk.waitForTicks(1);
        }
    }
}

async function withdrawOne(pattern: RegExp): Promise<boolean> {
    if (sdk.findInventoryItem(pattern)) return true;
    const banked = sdk.findBankItem(pattern);
    if (!banked) return false;
    const r = await bot.withdrawItem(banked, 1);
    if (!r.success && sdk.isBankOpen()) {
        await sdk.sendBankWithdraw(banked.slot, 1);
        await sdk.waitForTicks(2);
    }
    return !!sdk.findInventoryItem(pattern);
}

async function withdrawUpTo(pattern: RegExp, amount: number): Promise<number> {
    if (amount <= 0) return 0;
    const before = count(pattern);
    const banked = sdk.findBankItem(pattern);
    if (!banked) return 0;
    const r = await bot.withdrawItem(banked, amount);
    if (!r.success && sdk.isBankOpen()) {
        await sdk.sendBankWithdraw(banked.slot, amount);
    }
    await sdk
        .waitForCondition(
            () => count(pattern) - before >= amount || occupiedSlots() >= 28,
            5_000
        )
        .catch(() => {});
    let got = count(pattern) - before;
    if (got < amount && occupiedSlots() < 28) {
        const again = sdk.findBankItem(pattern);
        const left = amount - got;
        if (again && left > 0) {
            await bot.withdrawItem(again, left);
            await sdk
                .waitForCondition(
                    () => count(pattern) - before >= amount || occupiedSlots() >= 28,
                    5_000
                )
                .catch(() => {});
        }
    }
    return Math.max(0, count(pattern) - before);
}

async function restock(): Promise<'work' | 'done' | 'fail'> {
    if (!(await openHomeBank())) return 'fail';
    const finished = strungBows().length + unstrungBows().length;
    await depositKeep();
    if (finished > 0) session.recordTrip(finished);

    if (!(await withdrawOne(KNIFE))) {
        await bot.closeBank();
        session.stop('no_knife', 'No knife in bank or inventory');
        return 'fail';
    }

    const tier = pickTier();
    if (!tier) {
        const leftover = sdk
            .getBankItems()
            .filter((i) => /^(yew|magic) logs$/i.test(i.name))
            .map((i) => `${i.count} ${i.name}`)
            .join(', ');
        await bot.closeBank();
        if (leftover) {
            session.stop('level', `Fletching ${fl()} too low for remaining ${leftover}`);
        } else {
            session.stop('done', `No yew/magic logs left | FL ${fl()}`);
        }
        return 'done';
    }

    const stringStock = bankCount(BOWSTRING);
    const logStock = bankCount(tier.logs);
    const free = 28 - occupiedSlots();
    const want = Math.min(
        BATCH,
        logStock,
        stringStock > 0 ? stringStock : BATCH,
        stringStock > 0 ? Math.floor(free / 2) : free
    );
    if (want < 1) {
        await bot.closeBank();
        session.noteFailure('restock', 'No free inventory for a 13+13 trip');
        return 'fail';
    }

    if (stringStock > 0) {
        const gotStrings = await withdrawUpTo(BOWSTRING, want);
        log(`Withdraw-X ${gotStrings} bowstrings`);
        warnedNoStrings = false;
    } else if (!warnedNoStrings) {
        session.log('warn', 'No bowstrings in bank — cutting unstrung only');
        warnedNoStrings = true;
    }

    const gotLogs = await withdrawUpTo(tier.logs, want);
    await bot.closeBank();
    session.noteProgress('bank', home.x + ',' + home.z);
    log(
        `Restock Withdraw-X ${gotLogs} ${tier.label} → ${tier.product} | FL ${fl()} | bank logs ${Math.max(0, logStock - gotLogs)} strings ${Math.max(0, stringStock - count(BOWSTRING))}`
    );
    return gotLogs > 0 || count(tier.logs) > 0 ? 'work' : 'fail';
}

function makeXForProduct(
    options: { index: number; text: string }[],
    product: string
): { index: number; text: string } | null {
    const target = resolveSkillDialogProduct(options, product);
    if (!target) return null;
    const i = options.findIndex((o) => o.index === target.index);
    if (i < 3) return null;
    const makeX = options[i - 3];
    if (!makeX || !/^make\s+x$/i.test(makeX.text)) return null;
    return makeX;
}

async function fletchInventory(tier: Tier): Promise<void> {
    if (!sdk.findInventoryItem(KNIFE) || !sdk.findInventoryItem(tier.logs)) return;
    await closeUi();
    await bot.dismissBlockingUI();
    const knife = sdk.findInventoryItem(KNIFE);
    const logs = sdk.findInventoryItem(tier.logs);
    if (!knife || !logs) return;

    const want = count(tier.logs);
    const xpBefore = flXp();
    const logsBefore = want;
    intent(`Make X ${want} ${tier.product}`);

    const use = await sdk.sendUseItemOnItem(knife.slot, logs.slot);
    if (!use.success) {
        session.noteFailure('fletch', use.message);
        return;
    }
    try {
        await sdk.waitForCondition((s) => s.dialog.isOpen, 5_000);
    } catch {
        session.noteFailure('fletch', 'Fletching dialog did not open');
        return;
    }

    const options = sdk.getDialog()?.options ?? [];
    const makeX = makeXForProduct(options, tier.product);
    if (!makeX) {
        const labels = options.map((o) => `${o.index}:${o.text}`).join(', ');
        session.noteFailure('fletch', `No Make X for "${tier.product}" (${labels})`);
        await sdk.sendCloseModal();
        return;
    }

    await sdk.sendClickDialog(makeX.index);
    const entered = await sdk.sendCountDialog(want);
    if (!entered.success) {
        session.noteFailure('fletch', entered.message);
        await sdk.sendCloseModal();
        return;
    }

    const deadline = Date.now() + want * 1_500 + 8_000;
    let lastLogs = count(tier.logs);
    let lastChange = Date.now();
    while (Date.now() < deadline && !session.isStopped()) {
        await bot.dismissBlockingUI();
        const left = count(tier.logs);
        if (left <= 0) break;
        if (left < lastLogs) {
            lastLogs = left;
            lastChange = Date.now();
            session.noteProgress('xp', 'fletching');
        } else if (Date.now() - lastChange > 8_000) {
            session.noteFailure('fletch', 'Make X batch stalled');
            break;
        }
        await sdk.waitForTicks(2).catch(() => {});
    }

    const made = logsBefore - count(tier.logs);
    if (made > 0 || flXp() > xpBefore) {
        session.noteProgress('xp', 'fletching');
        log(`Make X ${tier.product} x${made} | FL ${fl()}`);
    }
}

async function stringInventory(): Promise<void> {
    while (!session.isStopped()) {
        await closeUi();
        await bot.dismissBlockingUI();
        const string = sdk.findInventoryItem(BOWSTRING);
        const bow = unstrungBows()[0];
        if (!string || !bow) break;
        intent(`Stringing ${bow.name}`);
        const xpBefore = flXp();
        const unstrungBefore = unstrungBows().length;
        const use = await sdk.sendUseItemOnItem(string.slot, bow.slot);
        if (!use.success) {
            session.noteFailure('string', use.message);
            break;
        }
        await sdk
            .waitForCondition(() => flXp() > xpBefore || unstrungBows().length < unstrungBefore, 5_000)
            .catch(() => {});
        if (flXp() > xpBefore || unstrungBows().length < unstrungBefore) {
            session.noteProgress('xp', 'string');
        } else {
            session.noteFailure('string', `no effect on ${bow.name}`);
            break;
        }
    }
}

async function tick(): Promise<void> {
    await closeUi();
    const tier = pickTier();
    const cutPhase = tier ? `cut_${tier.product.replace(/\s+/g, '_')}` : '';
    if (tier && sdk.findInventoryItem(KNIFE) && sdk.findInventoryItem(tier.logs)) {
        if (session.metrics().phase !== cutPhase) await session.setPhase(cutPhase);
        await fletchInventory(tier);
    }
    if (unstrungBows().length > 0 && sdk.findInventoryItem(BOWSTRING)) {
        if (session.metrics().phase !== 'string') await session.setPhase('string');
        await stringInventory();
    }
    const stillCutting = !!tier && !!sdk.findInventoryItem(tier.logs);
    const stillStringing = unstrungBows().length > 0 && !!sdk.findInventoryItem(BOWSTRING);
    if (stillCutting || stillStringing) return;

    if (session.metrics().phase !== 'bank') await session.setPhase('bank');
    const result = await restock();
    if (result === 'fail') await sdk.waitForTicks(3);
}

session.registerRecovery([
    {
        name: 'bank',
        run: async () => {
            await walkNear(home.x, home.z, 3);
            return distTo(home.x, home.z) <= 8;
        }
    }
]);

try {
    lastLoggedFl = fl();
    home = closestBank();
    session.setAnchor(home.x, home.z);
    await bot.skipTutorial();
    await closeUi();
    log(`Bank-fletch start FL ${lastLoggedFl} (${flXp()} xp) @ ${pos().x},${pos().z} → bank ${home.x},${home.z}`);

    await session.setPhase('bank');
    const first = await restock();
    if (first === 'fail' && !session.isStopped()) {
        session.stop('setup', 'Could not restock logs from bank');
    }

    while (!session.isStopped()) {
        if (session.needsRecovery()) {
            if ((await session.recover()) === 'exhausted') break;
            continue;
        }
        await closeUi();
        if (pos().isDead) {
            await sdk.waitForCondition((s) => !s.player.isDead, 45_000).catch(() => {});
            continue;
        }
        if (fl() !== lastLoggedFl) {
            log(`LEVEL UP Fletching ${fl()} | ${pickTier()?.product ?? 'no logs'}`);
            lastLoggedFl = fl();
            session.noteProgress('xp', `fl ${fl()}`);
        }
        if (fl() >= 99) {
            session.stop('done', `Fletching ${fl()}`);
            break;
        }
        await tick();
    }

    const stop = session.metrics().stopReason;
    if (stop) log(`stopped ${stop.code} @ ${stop.location.x},${stop.location.z}`);
} catch (err) {
    session.stop('script_error', err instanceof Error ? err.message : String(err));
    console.error('Script error:', err);
    throw err;
} finally {
    console.log('Disconnecting SDK; browser client can stay open.');
    await sdk.disconnect();
}
