/**
 * Quest-bank mule: parks at Draynor bank holding QUEST_STOCK and serves
 * `quest-supply` DM requests from questing accounts.
 *
 *   bun bots/quests/quest-mule.ts {muleName}
 *
 * Protocol: quester walks to Draynor bank, DMs
 * `quest-supply <label> x<count>, ...`, and waits in a receive trade. The
 * mule polls chat, withdraws from its own bank, and offers the trade.
 * Safe-stop native (already parked at Draynor; drain is a no-op walk).
 * Restock by trading the manifest over; low lines log WARN for top-up.
 */
import { ActivitySession, BotSDK, deriveGatewayUrl } from '../../sdk/index';
import { installGracefulShutdown } from '../../sdk/runner';
import { BotActions } from '../../sdk/actions';
import { initPathfinding } from '../../sdk/pathfinding';
import { existsSync, readFileSync } from 'fs';
import { dirname, join } from 'path';
import { walkSendHops } from './movement';
import { MULE_BANK, QUEST_STOCK, ensureSupplied, parseSupplyRequest } from './supply';
import { countItems } from './quest-lib';

const argv = process.argv.slice(2);
const botArg = argv.find((a) => !a.startsWith('-'));
// --stock: self-stock the manifest from verified shops (coins from the bank)
// instead of only serving. Unsourced lines (bowls, planks, nails, veg) still
// warn for operator follow-up.
const STOCK_MODE = argv.includes('--stock');

function loadBotEnv(): void {
    const envPath = botArg
        ? join(process.cwd(), 'bots', botArg, 'bot.env')
        : join(dirname(import.meta.path), 'bot.env');
    if (!existsSync(envPath)) {
        throw new Error(`bot.env not found at ${envPath}. Usage: bun bots/quests/quest-mule.ts {botname}`);
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

initPathfinding();

const sdk = new BotSDK({
    botUsername: username,
    password,
    gatewayUrl: deriveGatewayUrl(server),
    autoLaunchBrowser: false,
    browserLaunchTimeout: 90_000,
    readyTimeout: 45_000,
    connectTimeout: 60_000,
    showChat: false,
});

await sdk.connect();
const bot = new BotActions(sdk);
const session = new ActivitySession(sdk, bot, {
    name: 'quest-mule',
    grindLogPath: GRIND_LOG,
    stallMs: 600_000,
    maxRecoveryTactics: 4,
});

installGracefulShutdown({ graceMs: 120_000 });

function log(msg: string): void {
    session.log('log', msg);
}

function pos(): { x: number; z: number } {
    const p = sdk.getState()?.player;
    return { x: p?.worldX ?? 0, z: p?.worldZ ?? 0 };
}

function bankCount(pattern: RegExp): number {
    return (sdk.getBankItems?.() ?? []).reduce(
        (n, i) => n + (pattern.test(i.name) && (i.count ?? 0) > 0 ? (i.count ?? 0) : 0),
        0
    );
}

async function parkAtDraynor(): Promise<void> {
    const p = pos();
    if (Math.hypot(p.x - MULE_BANK.x, p.z - MULE_BANK.z) > 6) {
        await walkSendHops(sdk, [MULE_BANK], MULE_BANK, 4);
    }
}

async function openBank(): Promise<boolean> {
    if (sdk.getState()?.bank?.isOpen) return true;
    const opened = await bot.openBank();
    return opened.success || !!sdk.getState()?.bank?.isOpen;
}

/**
 * --stock mode: top up every below-target manifest line through the full
 * chain minus the mule itself (bank, shops, dialog, gather). Unsourced
 * lines are skipped (audit already warned) — craft/farm follow-ups.
 */
async function stockUp(): Promise<void> {
    const mctx = {
        sdk,
        bot,
        session,
        log: (m: string) => session.log('log', m),
    };
    // One float withdrawal while the bank is open: later buys run with the
    // bank closed (modal conflicts) and cannot top up mid-round.
    const onHand = sdk
        .getInventory()
        .reduce((n, i) => n + (/^coins$/i.test(i.name) ? (i.count ?? 0) : 0), 0);
    if (onHand < 100_000) {
        const match = (sdk.getBankItems?.() ?? []).find((i) => /^coins$/i.test(i.name));
        if (match) {
            await bot.withdrawItem(match, 100_000 - onHand).catch(() => undefined);
            await sdk.waitForTicks(2).catch(() => undefined);
        }
    }
    for (const [label, target] of Object.entries(QUEST_STOCK)) {
        if (label === 'coins') continue;
        const pattern = new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i');
        const haveBank = bankCount(pattern);
        const haveInv = countItems(sdk, pattern);
        if (haveBank + haveInv >= target) continue;
        const missing = await ensureSupplied(mctx, [{ pattern, count: target - haveBank - haveInv, label }]).catch(
            () => [{ pattern, count: 1, label }]
        );
        if (missing.length === 0) session.log('log', `mule stocked ${label} (bank ${haveBank} -> target ${target})`);
    }
    // Re-open (shops close modals) and deposit everything but the coin float.
    if (await openBank().catch(() => false)) {
        for (const item of sdk.getInventory()) {
            if ((item.count ?? 0) <= 0 || /^coins$/i.test(item.name)) continue;
            await bot.depositItem(item, -1).catch(() => undefined);
        }
    }
}

interface ChatMsg {
    type?: number;
    from?: string;
    sender?: string;
    text?: string;
}

function readNewChat(): ChatMsg[] {
    try {
        const reader = (sdk as unknown as { getNewChat?: (o?: unknown) => unknown }).getNewChat;
        if (typeof reader === 'function') return (reader.call(sdk, {}) ?? []) as ChatMsg[];
        const history = (sdk as unknown as { getChat?: (o?: unknown) => unknown }).getChat;
        if (typeof history === 'function') return ((history.call(sdk, { limit: 20 }) ?? []) as ChatMsg[]).slice(-5);
    } catch {
        /* chat unavailable */
    }
    return [];
}

async function serveOnce(from: string, needs: Array<{ label: string; count: number }>): Promise<boolean> {
    // Withdraw everything first so a half-stock request fails before trading.
    if (!(await openBank())) {
        session.log('warn', `mule: bank would not open for ${from}`);
        return false;
    }
    const give: Array<{ item: RegExp; amount: number }> = [];
    for (const need of needs) {
        const pattern = new RegExp(`^${need.label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i');
        const have = bankCount(pattern);
        if (have < need.count) {
            session.log('warn', `mule: low stock ${need.label} have=${have} need=${need.count} (RESTOCK)`);
        }
        const match = (sdk.getBankItems?.() ?? []).find((i) => pattern.test(i.name));
        if (!match) {
            session.log('warn', `mule: out of ${need.label} for ${from}`);
            await bot.closeBank().catch(() => undefined);
            return false;
        }
        await bot.withdrawItem(match, Math.min(need.count, match.count ?? need.count));
        await sdk.waitForTicks(2).catch(() => undefined);
        give.push({ item: pattern, amount: need.count });
    }
    await bot.closeBank().catch(() => undefined);
    log(`mule: serving ${from}: ${needs.map((n) => `${n.label} x${n.count}`).join(', ')}`);
    try {
        const served = (await bot.serveTrades({
            from: new RegExp(`^${from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i'),
            give,
            want: [],
            maxTrades: 1,
            timeout: 5 * 60_000,
            tradeTimeout: 90_000,
            rejectAfterMs: 60_000,
        } as never)) as { trades?: unknown[] } | null;
        const done = !!served?.trades?.length;
        session.noteProgress(done ? 'trade' : 'location', `mule serve ${from} ${done ? 'ok' : 'timeout'}`);
        return done;
    } catch {
        return false;
    }
}

try {
    while (!session.isStoppedOrRequested()) {
        if (session.stopRequested) {
            await parkAtDraynor().catch(() => undefined);
            session.stop('stopped', 'mule drained at Draynor bank', { restartable: false });
            break;
        }
        await parkAtDraynor().catch(() => undefined);
        // Stock audit each round; low lines warn for operator top-up.
        if (await openBank().catch(() => false)) {
            for (const [label, target] of Object.entries(QUEST_STOCK)) {
                const have = bankCount(new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i'));
                if (have < target) session.log('warn', `mule stock low: ${label} ${have}/${target}`);
            }
            if (STOCK_MODE) await stockUp();
            await bot.closeBank().catch(() => undefined);
        }
        const seen = new Set<string>();
        for (const msg of readNewChat()) {
            const text = String(msg.text ?? '');
            const from = String(msg.from ?? msg.sender ?? '');
            if (!from || seen.has(from + text)) continue;
            seen.add(from + text);
            const req = parseSupplyRequest(from, text);
            if (!req) continue;
            log(`mule: request from ${from}: ${req.needs.map((n) => `${n.label} x${n.count}`).join(', ')}`);
            await serveOnce(from, req.needs);
        }
        session.noteProgress('location', 'mule park');
        await sdk.waitForTicks(20).catch(() => undefined);
    }
} catch (err) {
    session.stop('script_error', err instanceof Error ? err.message : String(err), { restartable: true });
    throw err;
} finally {
    await session.finalizeStop().catch(() => undefined);
    await sdk.disconnect();
}
