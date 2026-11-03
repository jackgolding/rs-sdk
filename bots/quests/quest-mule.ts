/**
 * Quest-bank mule: parks at Draynor bank holding QUEST_STOCK and serves
 * `quest-supply` DM requests from questing accounts.
 *
 *   bun bots/quests/quest-mule.ts {muleName} [--stock | --serve-only] [--train]
 *
 * Protocol: quester walks to Draynor bank, DMs
 * `quest-supply <label> x<count>, ...`, and waits in a receive trade. The
 * mule polls chat, withdraws from its own bank, and offers the trade.
 * Safe-stop native (already parked at Draynor; drain is a no-op walk).
 * Restock by trading the manifest over; low lines log WARN for top-up.
 *
 * --train: between requests, chop the Draynor trees beside the bank and fletch
 * the logs (lib/training.ts TREES/fletchFor pick tree and product by level),
 * banking the products. Chat is polled after every chop or fletch, and the
 * pack goes into the bank before a request is withdrawn.
 */
import { ActivitySession, BotSDK, deriveGatewayUrl } from '../../sdk/index';
import { installGracefulShutdown } from '../../sdk/runner';
import { BotActions } from '../../sdk/actions';
import { initPathfinding } from '../../sdk/pathfinding';
import { existsSync, readFileSync } from 'fs';
import { dirname, join } from 'path';
import { walkSendHops } from './movement';
import { QUEST_STOCK, ensureSupplied, isRestockRequest, muleBank, parseSupplyRequest } from './supply';
import type { TradeItem } from '../../sdk/types';
import { countItems } from './quest-lib';
import { TREES, fletchFor } from './lib/training';
import { tickNow } from './lib/ticks';

const argv = process.argv.slice(2);
const botArg = argv.find((a) => !a.startsWith('-'));
// --stock: self-stock the manifest from verified shops (coins from the bank)
// instead of only serving. Unsourced lines (bowls, planks, nails, veg) still
// warn for operator follow-up.
const STOCK_MODE = argv.includes('--stock');
// --serve-only: a mule for a few lines only (jacklove4's imp beads) — no
// QUEST_STOCK audit, which would warn about every Dragon Slayer line it never holds.
const SERVE_ONLY = argv.includes('--serve-only');
/** This mule's bank (supply.ts MULE_BANKS: jackthief at Ardougne, the rest at Draynor). */
const MULE_BANK = muleBank(botArg ?? '');
// --train: Woodcutting + Fletching at the Draynor trees while no request is waiting.
const TRAIN = argv.includes('--train');

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
    // Requests arrive as DMs ('quest-supply …'); showChat:false filters every
    // player message, DMs included, so the mule never saw one (jacklove4, 2026-10-29).
    showChat: true,
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
    // Far away (jackthief moving to its Ardougne post from Varrock): the pathfinder, then hops.
    if (Math.hypot(p.x - MULE_BANK.x, p.z - MULE_BANK.z) > 30) await bot.walkTo(MULE_BANK.x, MULE_BANK.z, 3).catch(() => undefined);
    if (Math.hypot(pos().x - MULE_BANK.x, pos().z - MULE_BANK.z) > 6) {
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
    tick?: number;
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

async function serveOnce(from: string, needs: Array<{ label: string; count: number }>, noted = false): Promise<boolean> {
    // Withdraw everything first so a half-stock request fails before trading.
    if (!(await openBank())) {
        session.log('warn', `mule: bank would not open for ${from}`);
        return false;
    }
    // Bank the pack first, always: a restock received as the mule was stopping (150 prayer
    // potions, 2026-11-03) stayed in the pack, and the stock count reads only the bank (have=0).
    await depositPack();
    // Serve what is in stock: one line out (nails, 2026-11-01) used to send nothing at all,
    // and the requester then went without the lines this mule did hold. The requester takes a
    // partial trade (supply.ts accepts any offered line) and asks its next mule for the rest.
    const give: Array<{ item: RegExp; amount: number }> = [];
    const served: string[] = [];
    for (const need of needs) {
        const pattern = new RegExp(`^${need.label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i');
        const have = bankCount(pattern);
        if (have < need.count) {
            session.log('warn', `mule: low stock ${need.label} have=${have} need=${need.count} (RESTOCK)`);
        }
        const match = (sdk.getBankItems?.() ?? []).find((i) => pattern.test(i.name) && (i.count ?? 0) > 0);
        if (!match) {
            session.log('warn', `mule: out of ${need.label} for ${from}`);
            continue;
        }
        const before = countItems(sdk, pattern);
        // `noted` requests (bank top-ups) take the whole amount as notes: one slot, one trade.
        await bot.withdrawItem(match, Math.min(need.count, match.count ?? need.count), { asNote: noted });
        await sdk.waitForTicks(2).catch(() => undefined);
        const amount = countItems(sdk, pattern) - before;
        if (amount <= 0) {
            session.log('warn', `mule: withdraw of ${need.label} for ${from} gave nothing (pack full?)`);
            continue;
        }
        give.push({ item: pattern, amount });
        let total = amount;
        // Noted requests take every stack sharing the name (grimy herbs are all "Herb", one id
        // per herb): one note slot per stack, each offered whole (-1), as an offered stack
        // leaves the pack and the same pattern then finds the next (user, 2026-11-03: herbs).
        for (let extra = 0; noted && total < need.count && extra < 20; extra++) {
            const taken = new Set(sdk.getInventory().filter((i) => pattern.test(i.name)).map((i) => i.id));
            const next = (sdk.getBankItems?.() ?? []).find((i) => pattern.test(i.name) && (i.count ?? 0) > 0 && !taken.has(i.id));
            if (!next) break;
            const was = countItems(sdk, pattern);
            await bot.withdrawItem(next, Math.min(need.count - total, next.count ?? need.count), { asNote: true });
            await sdk.waitForTicks(2).catch(() => undefined);
            const got = countItems(sdk, pattern) - was;
            if (got <= 0) break;
            give.push({ item: pattern, amount: -1 });
            total += got;
        }
        // Several stacks: the first is offered whole too, so each entry takes one stack.
        if (total > amount) give[give.findIndex((g) => g.item === pattern)]!.amount = -1;
        served.push(`${need.label} x${total}`);
    }
    await bot.closeBank().catch(() => undefined);
    if (give.length === 0) {
        session.log('warn', `mule: nothing in stock for ${from}`);
        return false;
    }
    log(`mule: serving ${from}: ${served.join(', ')}`);
    // The requester waits in serveTrades (the receiving half), so the mule must send
    // the trade request: both sides serving deadlocked every request (2026-10-29).
    try {
        const res = await bot.trade(from, {
            give,
            want: [],
            timeout: 240_000,
            requestTimeout: 60_000,
            rejectAfterMs: 180_000,
            retryOnBusy: true,
        });
        log(`mule: trade with ${from} ${res.success ? 'ok' : `failed (${res.reason ?? res.message})`}`);
        session.noteProgress(res.success ? 'trade' : 'location', `mule serve ${from} ${res.success ? 'ok' : 'failed'}`);
        if (!res.success && (await openBank().catch(() => false))) {
            // Back in the bank, so a failed hand-off does not pile beads up in the inventory.
            for (const g of give) await bot.depositItem(g.item, -1).catch(() => undefined);
            await bot.closeBank().catch(() => undefined);
        }
        return res.success;
    } catch {
        return false;
    }
}

/**
 * A producer (supply.ts MULE_RESTOCKERS: jackthief) DMed `quest-restock`: bank the pack,
 * take its trade (it sends; the receiver must only serve — two crossing trade calls race
 * "is busy"), then bank what came over. Noted stacks deposit as items.
 */
async function receiveRestock(from: string): Promise<void> {
    // Ready at once: the restocker requests its trade ~8 ticks after its DM, and a bank visit
    // first (~20 s) missed it every time (ABGARMY09's prayer potions, 2026-11-03). Bank only when
    // the pack could not take a noted stack or two.
    if (sdk.getInventory().length > 24 && (await openBank().catch(() => false))) {
        await depositPack();
        await bot.closeBank().catch(() => undefined);
    }
    log(`mule: restock from ${from}: waiting for its trade`);
    const before = new Map(sdk.getInventory().map((i) => [i.name, i.count ?? 1]));
    const res = await bot
        .serveTrades({
            from: new RegExp(`^${from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i'),
            give: [],
            accept: (offer: TradeItem[]) => (offer ?? []).length > 0,
            maxTrades: 1,
            timeout: 180_000,
            tradeTimeout: 120_000,
            rejectAfterMs: 90_000,
        } as never)
        .catch(() => undefined);
    const got = sdk
        .getInventory()
        .map((i) => ({ name: i.name, n: (i.count ?? 1) - (before.get(i.name) ?? 0) }))
        .filter((i) => i.n > 0);
    const traded = (res as { trades?: unknown[] } | undefined)?.trades?.length ?? 0;
    log(`mule: restock from ${from} ${traded ? 'received' : 'got no trade'}: ${got.map((i) => `${i.name} x${i.n}`).join(', ') || 'nothing'}`);
    session.noteProgress(got.length ? 'trade' : 'location', `mule restock ${from}`);
    if (await openBank().catch(() => false)) {
        await depositPack();
        await bot.closeBank().catch(() => undefined);
    }
}

// ── --train ─────────────────────────────────────────────────────────────────

const AXES: Array<{ name: RegExp; level: number }> = [
    { name: /^rune axe$/i, level: 41 },
    { name: /^adamant axe$/i, level: 31 },
    { name: /^mithril axe$/i, level: 21 },
    { name: /^black axe$/i, level: 11 },
    { name: /^steel axe$/i, level: 6 },
    { name: /^iron axe$/i, level: 1 },
    { name: /^bronze axe$/i, level: 1 },
];
const KNIFE = /^knife$/i;
const LOGS = /^(willow |oak )?logs$/i;
/** Training stays this close to the bank, so a requester at the booth is always in view. */
const TRAIN_RADIUS = 25;
/** Why training stopped for this run (missing tools); serving carries on. */
let trainOff = '';
let fletchMisses = 0;

const level = (skill: string) => sdk.getSkill(skill)?.baseLevel ?? 1;
const isTool = (name: string) => KNIFE.test(name) || AXES.some((a) => a.name.test(name));
const hasAxe = () => sdk.getInventory().some((i) => AXES.some((a) => a.name.test(i.name)));
const hasKnife = () => !!sdk.findInventoryItem(KNIFE);
const packFull = () => sdk.getInventory().length >= 28;

/** Bank everything in the pack (bank already open). */
async function depositPack(keepTools = false): Promise<void> {
    for (const item of sdk.getInventory()) {
        if ((item.count ?? 0) <= 0 || (keepTools && isTool(item.name))) continue;
        await bot.depositItem(item, -1).catch(() => undefined);
    }
    await sdk.waitForTicks(1).catch(() => undefined);
}

/** Bank the products and logs, withdraw the best usable axe and a knife. */
async function bankForTraining(): Promise<void> {
    await parkAtDraynor().catch(() => undefined);
    if (!(await openBank().catch(() => false))) return;
    await depositPack(true);
    const bank = sdk.getBankItems?.() ?? [];
    if (!hasAxe()) {
        const axe = AXES.filter((a) => level('Woodcutting') >= a.level)
            .map((a) => bank.find((i) => a.name.test(i.name) && (i.count ?? 0) > 0))
            .find(Boolean);
        if (axe) await bot.withdrawItem(axe, 1).catch(() => undefined);
    }
    if (!hasKnife()) {
        const knife = bank.find((i) => KNIFE.test(i.name) && (i.count ?? 0) > 0);
        if (knife) await bot.withdrawItem(knife, 1).catch(() => undefined);
    }
    await sdk.waitForTicks(2).catch(() => undefined);
    await bot.closeBank().catch(() => undefined);
    session.noteProgress('bank', 'mule train bank');
    if (!hasAxe() || !hasKnife()) {
        trainOff = `no ${hasAxe() ? 'knife' : 'axe'} in the bank`;
        session.log('warn', `mule: training off — ${trainOff}`);
    }
}

/** One short unit of training (a chop, a fletch, or a bank trip), so chat is read between units. */
async function trainStep(): Promise<void> {
    if (sdk.getState()?.bank?.isOpen) await bot.closeBank().catch(() => undefined);
    if (!hasAxe() || !hasKnife()) return bankForTraining();
    const product = fletchFor(level('Fletching'), level('Woodcutting'));
    const want = new RegExp(`^${product.logs ? `${product.logs} ` : ''}logs$`, 'i');
    if (packFull()) {
        // Shafts stack, so fletching plain logs frees the pack; bows fill it and get banked.
        if (sdk.findInventoryItem(want) && fletchMisses < 3) {
            const before = countItems(sdk, want);
            const res = await bot.fletchLogs(product.label);
            await sdk.waitForTicks(1).catch(() => undefined);
            if (countItems(sdk, want) < before) {
                fletchMisses = 0;
                session.noteProgress('xp', `fletch ${product.label}`);
            } else {
                fletchMisses++;
                session.log('warn', `mule: fletching ${product.label}: ${res.message}`);
            }
            return;
        }
        fletchMisses = 0;
        return bankForTraining();
    }
    const spec = TREES.find((t) => t.logs === product.logs) ?? TREES[TREES.length - 1]!;
    const p = pos();
    if (Math.hypot(p.x - spec.spot.x, p.z - spec.spot.z) > 10) {
        await walkSendHops(sdk, [spec.spot], spec.spot, 4).catch(() => undefined);
    }
    const tree = (sdk.getNearbyLocs() ?? [])
        .filter(
            (l) =>
                spec.tree.test(l.name) &&
                l.reachable !== false &&
                l.options.some((o) => /chop/i.test(o)) &&
                Math.max(Math.abs(l.x - MULE_BANK.x), Math.abs(l.z - MULE_BANK.z)) <= TRAIN_RADIUS
        )
        .sort((a, b) => a.distance - b.distance)[0];
    if (!tree) {
        await sdk.waitForTicks(5).catch(() => undefined);
        return;
    }
    // Logs of a tier the levels have outgrown would block the pack: bank them with the products.
    if (sdk.getInventory().some((i) => LOGS.test(i.name) && !want.test(i.name))) return bankForTraining();
    const res = await bot.chopTree(tree);
    if (res.success) session.noteProgress('xp', `chop ${tree.name}`);
}

try {
    while (!session.isStoppedOrRequested()) {
        if (session.stopRequested) {
            if (TRAIN && (await openBank().catch(() => false))) {
                await depositPack();
                await bot.closeBank().catch(() => undefined);
            }
            await parkAtDraynor().catch(() => undefined);
            session.stop('stopped', 'mule drained at Draynor bank', { restartable: false });
            break;
        }
        // Training walks off to the trees; serveOnce's bank open brings the mule back.
        if (!TRAIN || trainOff) await parkAtDraynor().catch(() => undefined);
        // Stock audit each round; low lines warn for operator top-up.
        if (!SERVE_ONLY && (await openBank().catch(() => false))) {
            for (const [label, target] of Object.entries(QUEST_STOCK)) {
                const have = bankCount(new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i'));
                if (have < target) session.log('warn', `mule stock low: ${label} ${have}/${target}`);
            }
            if (STOCK_MODE) await stockUp();
            await bot.closeBank().catch(() => undefined);
        }
        const seen = new Set<string>();
        // A queue re-read before every item, restock DMs jumping it: read once per round, a restock
        // DM sat behind minutes of serving, went stale (>120t) and ABGARMY09's 150 prayer potions
        // were never taken, 10 attempts twice (2026-11-03).
        const queue: ChatMsg[] = [];
        const latest = new Map<string, number>();
        const pull = () => {
            for (const m of readNewChat()) {
                const f = String(m.from ?? m.sender ?? '');
                latest.set(f, Math.max(latest.get(f) ?? -1, m.tick ?? 0));
                if (isRestockRequest(f, String(m.text ?? ''))) queue.unshift(m);
                else queue.push(m);
            }
        };
        pull();
        for (let guard = 0; queue.length > 0 && guard < 200; guard++) {
            pull();
            const msg = queue.shift()!;
            const text = String(msg.text ?? '');
            const from = String(msg.from ?? msg.sender ?? '');
            if (!from || seen.has(from + text)) continue;
            seen.add(from + text);
            if (isRestockRequest(from, text)) {
                // A restocker trades ~8 ticks after its DM and gives up ~150 later (mule-produce): an
                // older DM left the mule waiting 3 min apiece for trades that never came (muster, 2026-11-02).
                const age = msg.tick ? tickNow(sdk) - msg.tick : 0;
                if (age > 120) {
                    log(`mule: skipping stale restock from ${from} (${age}t old)`);
                    continue;
                }
                if (TRAIN) await parkAtDraynor().catch(() => undefined);
                await receiveRestock(from);
                continue;
            }
            const req = parseSupplyRequest(from, text);
            if (!req) continue;
            // Requesters stop waiting (quests ~600 ticks, noted top-ups ~2400): serving later only
            // fails "no_response"/"player_not_found" and backs up the queue (jacklove5's 05:41 shield
            // ask was served 06:42, after the KBD accounts' asks queued up, 2026-11-03).
            const reqAge = msg.tick ? tickNow(sdk) - msg.tick : 0;
            const superseded = (msg.tick ?? 0) < (latest.get(from) ?? 0);
            if (superseded || reqAge > (req.noted ? 2300 : 550)) {
                log(`mule: skipping ${superseded ? 'superseded' : 'stale'} request from ${from} (${reqAge}t old)`);
                continue;
            }
            log(`mule: request from ${from}: ${req.needs.map((n) => `${n.label} x${n.count}`).join(', ')}`);
            if (TRAIN) await parkAtDraynor().catch(() => undefined);
            await serveOnce(from, req.needs, req.noted);
        }
        session.noteProgress('location', 'mule park');
        if (TRAIN && !trainOff) await trainStep();
        else await sdk.waitForTicks(20).catch(() => undefined);
    }
} catch (err) {
    session.stop('script_error', err instanceof Error ? err.message : String(err), { restartable: true });
    throw err;
} finally {
    await session.finalizeStop().catch(() => undefined);
    await sdk.disconnect();
}
