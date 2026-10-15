/**
 * One-off smithing errand: withdraw bars + hammer, walk to Doric's anvil,
 * smith a product count, bank the output, exit 0.
 *
 *   bun bots/quests/smith-order.ts Jackpoo2 nails 12 --bar='steel bar'
 *
 * Safe-stop aware (drains to the nearest bank). Product names resolve via
 * the SDK smithing table (nails, knives, arrowheads, ...).
 */
import { ActivitySession, BotSDK, deriveGatewayUrl } from '../../sdk/index';
import { installGracefulShutdown } from '../../sdk/runner';
import { BotActions } from '../../sdk/actions';
import { initPathfinding } from '../../sdk/pathfinding';
import { existsSync, readFileSync } from 'fs';
import { dirname, join } from 'path';
import { walkSendHops } from './movement';
import { DORIC_ANVIL } from './tiles';
import { goToBank, nearestBank, parkAtBank } from './safe-stops';
import { SHOP_SOURCES, buyFromShops } from './supply';

const argv = process.argv.slice(2);
const botArg = argv.find((a) => !a.startsWith('-'));
const positional = argv.filter((a) => !a.startsWith('-'));
const flags = new Map<string, string>();
for (const a of argv.filter((x) => x.startsWith('--'))) {
    const eq = a.indexOf('=');
    if (eq < 0) flags.set(a.slice(2), 'true');
    else flags.set(a.slice(2, eq), a.slice(eq + 1));
}
const product = (positional[1] ?? 'nails').toLowerCase();
const want = Number(positional[2] ?? 12);
const barLabel = flags.get('bar') ?? 'steel bar';
const BAR = new RegExp(`^${barLabel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i');
const HAMMER = /^hammer$/i;

function loadBotEnv(): void {
    const envPath = botArg ? join(process.cwd(), 'bots', botArg, 'bot.env') : join(dirname(import.meta.path), 'bot.env');
    if (!existsSync(envPath)) throw new Error(`bot.env not found at ${envPath}`);
    for (const line of readFileSync(envPath, 'utf-8').split('\n')) {
        const t = line.trim();
        if (!t || t.startsWith('#')) continue;
        const eq = t.indexOf('=');
        if (eq > 0) process.env[t.slice(0, eq)] = t.slice(eq + 1);
    }
}

loadBotEnv();
const username = process.env.BOT_USERNAME!;
const password = process.env.PASSWORD!;
const GRIND_LOG = join(process.cwd(), 'bots', username, 'grind.log');

initPathfinding();
const sdk = new BotSDK({
    botUsername: username,
    password,
    gatewayUrl: deriveGatewayUrl(process.env.SERVER),
    autoLaunchBrowser: false,
    readyTimeout: 45_000,
    connectTimeout: 60_000,
    showChat: false,
});
await sdk.connect();
const bot = new BotActions(sdk);
const session = new ActivitySession(sdk, bot, { name: 'smith-order', grindLogPath: GRIND_LOG, stallMs: 300_000 });
installGracefulShutdown({ graceMs: 180_000 });

const here = () => {
    const p = sdk.getState()?.player;
    return `${p?.worldX ?? 0},${p?.worldZ ?? 0}`;
};
const count = (re: RegExp) =>
    sdk.getInventory().reduce((n, i) => n + (re.test(i.name) && (i.count ?? 0) > 0 ? (i.count ?? 1) : 0), 0);
const PROD = new RegExp(`^${product.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}s?$`, 'i');

try {
    // Gear up at the nearest bank (wait for a live controller first —
    // lite sessions flap, and walks on a dead socket throw).
    await sdk.waitForConnection(90_000).catch(() => undefined);
    const home = nearestBank(sdk);
    if (!(await goToBank(sdk, home))) throw new Error(`could not reach ${home} bank`);
    if (!(await bot.openBank()).success && !sdk.getState()?.bank?.isOpen) throw new Error('bank did not open');
    for (const [re, n, label] of [[BAR, want, barLabel], [HAMMER, 1, 'hammer']] as const) {
        if (count(re) >= n) continue;
        const match = (sdk.getBankItems?.() ?? []).find((i) => re.test(i.name));
        if (!match) throw new Error(`no ${label} in bank`);
        await bot.withdrawItem(match, n - count(re));
        await sdk.waitForTicks(2).catch(() => undefined);
    }
    await bot.closeBank().catch(() => undefined);
    if (count(HAMMER) < 1) {
        // Tostig (Burthorpe) stocks hammers 1 gp — buy one en route.
        const sctx = {
            sdk,
            bot,
            session,
            log: (m: string) => session.log('log', m),
        };
        const shops = SHOP_SOURCES['hammer'] ?? [];
        if (shops.length > 0) {
            await buyFromShops(sctx, { pattern: HAMMER, count: 1, label: 'hammer' }).catch(() => 0);
        }
    }
    if (count(HAMMER) < 1) throw new Error('no hammer in bank or shops — buy one at a general store first');
    session.log('log', `geared: bars=${count(BAR)} hammer=${count(HAMMER)} -> Doric anvil`);

    // Walk to the anvil and smith until the count lands (or 25 min).
    const deadline = Date.now() + 25 * 60_000;
    while (count(PROD) < want && Date.now() < deadline) {
        if (session.stopRequested) break;
        await sdk.waitForConnection(60_000).catch(() => undefined);
        const p = sdk.getState()?.player;
        if (!p || Math.hypot(p.worldX - DORIC_ANVIL.x, p.worldZ - DORIC_ANVIL.z) > 4) {
            await walkSendHops(sdk, [DORIC_ANVIL], DORIC_ANVIL, 3);
            continue;
        }
        const r = await bot.smithAtAnvil(product, { barPattern: BAR, timeout: 25_000 });
        session.log(r.success ? 'log' : 'warn', `smith ${product}: ${r.message} have=${count(PROD)}/${want}`);
        if (!r.success && /level|bar|hammer/i.test(r.message)) throw new Error(`smith blocked: ${r.message}`);
        await sdk.waitForTicks(2).catch(() => undefined);
    }
    const made = count(PROD);

    // Bank the output and exit clean.
    await parkAtBank(sdk, bot, home, { timeoutMs: 180_000 });
    session.log(made >= want ? 'log' : 'warn', `smith-order ${product} made=${made}/${want} @ ${here()}`);
    session.stop(made >= want ? 'done' : 'stuck', `smith-order ${product} ${made}/${want}`, {
        restartable: made < want,
    });
} catch (err) {
    session.stop('script_error', err instanceof Error ? err.message : String(err), { restartable: true });
    throw err;
} finally {
    await session.finalizeStop().catch(() => undefined);
    await sdk.disconnect();
}
