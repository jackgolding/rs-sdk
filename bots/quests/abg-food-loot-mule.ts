/**
 * ABGARMY01 overnight mule: park at the Ardougne bank and 1-to-1 swap
 * noted fish for thieving loot. Thieves walk in when they need food.
 *
 *   bun bots/quests/abg-food-loot-mule.ts ABGARMY01
 *
 * Does not run the clock tree. Skips ABGARMY06. Prefers swordfish/bass/tuna
 * over dumping the whole cod pile on one visitor.
 */
import { ActivitySession, BotSDK, deriveGatewayUrl } from '../../sdk/index';
import { BotActions } from '../../sdk/actions';
import { initPathfinding } from '../../sdk/pathfinding';
import { existsSync, readFileSync } from 'fs';
import { dirname, join } from 'path';
import type { TradeTimingsMs } from '../../sdk/types';
import { ARDOUGNE_BANK } from './tiles';
import { closeUi, playerPos, walkNear } from './movement';
import { FOOD_MULE, FOOD_MULE_FROM, FOOD_PACK_ORDER, FOOD_PER_TRADE, foodPackGive } from './tree-trade-plan';

const FOOD = /^(cod|bass|tuna|swordfish|lobster|shark|jug of wine)$/i;
const SLASH =
    /^(bronze |iron |steel |mithril |adamant |rune )?(axe|sword|scimitar|dagger|claws|battleaxe|longsword|2h sword)$|^knife$/i;
const WINE = /^jug of wine$/i;
const BANK_WHEN_SLOTS = 20;
const PACK_WHEN_FOOD_BELOW = 200;
const NOTE_TOGGLE = 5386;
const SERVE_MS = 5 * 60_000;
const SERVE_MAX_TRADES = 20;

const argv = process.argv.slice(2);
const botArg = argv.find((a) => !a.startsWith('-')) ?? FOOD_MULE;

function loadBotEnv(): void {
    const envPath = join(process.cwd(), 'bots', botArg, 'bot.env');
    const fallback = join(dirname(import.meta.path), 'bot.env');
    const path = existsSync(envPath) ? envPath : fallback;
    if (!existsSync(path)) {
        throw new Error(`bot.env not found at ${envPath}. Usage: bun bots/quests/abg-food-loot-mule.ts ABGARMY01`);
    }
    for (const line of readFileSync(path, 'utf-8').split('\n')) {
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

initPathfinding();

const sdk = new BotSDK({
    botUsername: username,
    password,
    gatewayUrl: deriveGatewayUrl(server),
    autoLaunchBrowser: false,
    browserLaunchTimeout: 90_000,
    readyTimeout: 45_000,
    connectTimeout: 60_000,
    showChat: true
});

await sdk.connect();
const bot = new BotActions(sdk);
const session = new ActivitySession(sdk, bot, {
    name: 'abg-food-loot-mule',
    grindLogPath: GRIND_LOG,
    stallMs: 8 * 60_000
});

function log(msg: string): void {
    session.log('log', msg);
}

function pos() {
    return playerPos(sdk);
}

function usedSlots(): number {
    return sdk.getInventory().filter((i) => (i.count ?? 0) > 0).length;
}

function countFood(): number {
    return sdk.getInventory().filter((i) => FOOD.test(i.name)).reduce((n, i) => n + (i.count ?? 1), 0);
}

function foodSummary(): string {
    const parts: string[] = [];
    for (const name of FOOD_PACK_ORDER) {
        const n = sdk
            .getInventory()
            .filter((i) => new RegExp(`^${name}$`, 'i').test(i.name))
            .reduce((s, i) => s + (i.count ?? 1), 0);
        if (n > 0) parts.push(`${n} ${name}`);
    }
    return parts.join(', ') || 'none';
}

function timingLine(t?: TradeTimingsMs): string {
    if (!t) return '';
    const parts: string[] = [];
    if (t.waitRequestMs != null) parts.push(`waitReq=${t.waitRequestMs}`);
    if (t.requestMs != null) parts.push(`request=${t.requestMs}`);
    if (t.offerMs != null) parts.push(`offer=${t.offerMs}`);
    if (t.acceptWaitMs != null) parts.push(`accept=${t.acceptWaitMs}`);
    if (t.confirmMs != null) parts.push(`confirm=${t.confirmMs}`);
    if (t.sessionMs != null) parts.push(`session=${t.sessionMs}`);
    return parts.length ? ` ${parts.join(' ')}` : '';
}

function serveSummary(served: import('../../sdk/types').ServeTradesResult, wallMs: number, waiting: string[]): void {
    const ok = served.trades.filter((t) => t.success).length;
    const byReason = new Map<string, number>();
    for (const t of served.trades) {
        const key = t.success ? 'ok' : (t.reason ?? 'fail');
        byReason.set(key, (byReason.get(key) ?? 0) + 1);
    }
    const reasons = [...byReason.entries()].map(([k, n]) => `${k}:${n}`).join(' ');
    log(
        `Serve end reason=${served.reason ?? '?'} wall=${wallMs}ms ok=${ok}/${served.trades.length} sessions [${reasons}] customers=${waiting.length ? waiting.join(',') : 'none'}`
    );
}

function itemsLine(items: { name: string; count?: number }[]): string {
    return (
        items
            .filter((i) => (i.count ?? 0) > 0)
            .map((i) => `${i.count} ${i.name}`)
            .join(', ') || 'nothing'
    );
}

function offerLabel(give: { item: RegExp; amount: number }[]): string {
    return (
        give
            .map((g) => {
                const name = FOOD_PACK_ORDER.find((n) => g.item.test(n)) ?? g.item.source;
                return `${g.amount} ${name}`;
            })
            .join(', ') || 'none'
    );
}

function nearbyCustomers(): string[] {
    return (sdk.getNearbyPlayers() ?? [])
        .map((p) => p.name)
        .filter((n) => FOOD_MULE_FROM.test(n));
}

function isKeep(name: string): boolean {
    return FOOD.test(name) || SLASH.test(name) || WINE.test(name) || /^kebab$/i.test(name);
}

/** Gift food even if they brought nothing; never take fish back. */
function acceptOffer(theirOffer: TradeItem[]): boolean {
    return !theirOffer.some((i) => FOOD.test(i.name) && (i.count ?? 0) > 0);
}

function foodGive() {
    return foodPackGive(
        FOOD_PACK_ORDER.map((name) => ({
            name,
            count: sdk
                .getInventory()
                .filter((i) => new RegExp(`^${name}$`, 'i').test(i.name))
                .reduce((s, i) => s + (i.count ?? 1), 0)
        }))
    );
}

async function tickSession(): Promise<boolean> {
    if (session.isStopped()) return false;
    if (session.needsRecovery()) return (await session.recover()) === 'resumed';
    return true;
}

async function atBank(): Promise<void> {
    await closeUi(bot, sdk);
    await walkNear(bot, sdk, ARDOUGNE_BANK.x, ARDOUGNE_BANK.z, 3);
}

async function bankLoot(): Promise<void> {
    await atBank();
    const opened = await bot.openBank();
    if (!opened.success && !sdk.getState()?.bank?.isOpen) {
        session.log('warn', `Bank open failed: ${opened.message}`);
        return;
    }
    for (let i = 0; i < 40; i++) {
        const item = sdk.getInventory().find((it) => (it.count ?? 0) > 0 && !isKeep(it.name));
        if (!item) break;
        const r = await bot.depositItem(item, -1);
        if (!r.success && !r.partial) break;
    }
    await sdk.waitForTicks(1);
    await bot.closeBank();
    log(`Banked loot, ${usedSlots()} inv slots @ ${pos().x},${pos().z}`);
    session.noteProgress('bank', 'loot');
}

async function packFood(): Promise<number> {
    await atBank();
    const opened = await bot.openBank();
    if (!opened.success && !sdk.getState()?.bank?.isOpen) {
        session.log('warn', `Bank open failed: ${opened.message}`);
        return countFood();
    }
    for (let i = 0; i < 40; i++) {
        const item = sdk.getInventory().find((it) => (it.count ?? 0) > 0 && !isKeep(it.name));
        if (!item) break;
        const r = await bot.depositItem(item, -1);
        if (!r.success && !r.partial) break;
    }
    await sdk.waitForTicks(1);
    if (!sdk.getState()?.bank?.noteMode) {
        log('Clicking bank note toggle');
        await sdk.sendClickComponent(NOTE_TOGGLE);
        await sdk.waitForTicks(2);
    }
    for (const name of FOOD_PACK_ORDER) {
        const re = new RegExp(`^${name}$`, 'i');
        const bankItem = sdk.findBankItem(re);
        if (!bankItem || (bankItem.count ?? 0) <= 0) continue;
        const before = countFood();
        await sdk.sendBankWithdraw(bankItem.slot, -1);
        await sdk.waitForCondition(() => countFood() > before, 3_000).catch(() => {});
    }
    await bot.closeBank();
    log(`Packed notes: ${foodSummary()}`);
    session.noteProgress('bank', `food ${countFood()}`);
    return countFood();
}

try {
    session.log('log', `Bank 1-to-1 mule @ ${pos().x},${pos().z} food=${foodSummary()} exp=per_trade:${FOOD_PER_TRADE} serve_ms:${SERVE_MS} max_trades:${SERVE_MAX_TRADES}`);
    await closeUi(bot, sdk);
    await bot.dismissBlockingUI();
    session.setAnchor(ARDOUGNE_BANK.x, ARDOUGNE_BANK.z);

    while (true) {
        if (!(await tickSession())) break;
        await bot.dismissBlockingUI();
        session.maybeHeartbeat();

        if (usedSlots() >= BANK_WHEN_SLOTS) {
            await session.setPhase('bank');
            await bankLoot();
        }
        if (countFood() < PACK_WHEN_FOOD_BELOW) {
            await session.setPhase('pack');
            const packed = await packFood();
            if (packed <= 0) {
                session.log('warn', 'No noted fish in bank — waiting');
                await session.setPhase('idle');
                await atBank();
                await sdk.waitForTicks(20);
                continue;
            }
        }

        const give = foodGive();
        if (give.length === 0) {
            session.log('warn', 'Nothing to hand out — packing');
            await packFood();
            await sdk.waitForTicks(8);
            continue;
        }

        await session.setPhase('serve');
        await atBank();
        const giveLabel = offerLabel(give);
        const waiting = nearbyCustomers();
        log(`Serve start offering ${giveLabel} food=${foodSummary()} customers=${waiting.length ? waiting.join(', ') : 'none'}`);
        session.noteProgress('location', 'serving');
        const serveStart = Date.now();
        const served = await bot.serveTrades({
            from: FOOD_MULE_FROM,
            give,
            accept: acceptOffer,
            timeout: SERVE_MS,
            tradeTimeout: 60_000,
            maxTrades: SERVE_MAX_TRADES,
            rejectAfterMs: 20_000,
            onTrade: (result) => {
                const tag = timingLine(result.timingsMs);
                if (result.success) {
                    log(
                        `Swap ok ${result.partner ?? '?'}: gave ${itemsLine(result.gave)} got ${itemsLine(result.received)} | left ${foodSummary()}${tag}`
                    );
                    session.noteProgress('inventory', result.partner ?? 'swap');
                } else {
                    session.log(
                        'warn',
                        `Swap fail ${result.partner ?? '?'} ${result.reason ?? ''} ${result.message}${tag}`
                    );
                }
            }
        });
        serveSummary(served, Date.now() - serveStart, waiting);
        const ok = served.trades.filter((t) => t.success).length;
        if (ok === 0 && waiting.length > 0) {
            session.log(
                'warn',
                `No swap ${served.reason ?? ''} offering ${giveLabel} customers=${waiting.join(', ')}`
            );
        }
    }
} catch (err) {
    session.stop('script_error', err instanceof Error ? err.message : String(err));
    console.error('Script error:', err);
    throw err;
} finally {
    await sdk.disconnect();
}
