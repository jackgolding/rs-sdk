/**
 * Split jackthief inventory 5 ways onto the parked rangers, then kit each
 * ranger: adamant helm, 100 mithril knives, anti-dragonfire shield, green
 * d'hide chaps, green d'hide vambraces.
 *
 * Rangers should already be in accept-any-trade mode.
 *
 *   bun bots/quests/yanille-split-and-gear.ts split
 *   bun bots/quests/yanille-split-and-gear.ts gear
 */
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { BotSDK, deriveGatewayUrl } from '../../sdk/index';
import { BotActions } from '../../sdk/actions';
import { initPathfinding } from '../../sdk/pathfinding';
import { ROOT } from '../../.cursor/skills/wake-fleet/scripts/roster';
import { FRESH_STATE_MS, formatStateAge } from '../../sdk/gateway-state';
import { closeUi, playerPos } from './movement';

const GIVER = 'jackthief';
const RANGERS = ['fatpig', 'jacklove1', 'jacklove2', 'jacklove3', 'jacklove5'] as const;
const CHUNK = 16;

const HELM = [/adamant full helm/i, /adamant med helm/i];
const KNIVES = /^mithril knives?$/i;
const SHIELD = /anti-?dragon(fire)? shield|^dragonfire shield$/i;
const CHAPS = /green d'?hide chaps|green dragonhide chaps|^dragonhide chaps$/i;
const VAMBS = /green d'?hide vambraces|green dragonhide vambraces|^dragon vambraces$/i;
const KNIFE_NEED = 100;

const MODE = (process.argv[2] ?? '').toLowerCase();
if (MODE !== 'split' && MODE !== 'gear') {
    throw new Error('Usage: bun bots/quests/yanille-split-and-gear.ts split|gear');
}

function loadEnv(name: string): Record<string, string> {
    const path = join(ROOT, 'bots', name, 'bot.env');
    if (!existsSync(path)) throw new Error(`Missing bot.env for ${name}`);
    const env: Record<string, string> = {};
    for (const line of readFileSync(path, 'utf8').split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eq = trimmed.indexOf('=');
        if (eq > 0) env[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
    }
    return env;
}

function connect(name: string, mode: 'control' | 'observe' = 'control'): BotSDK {
    const env = loadEnv(name);
    return new BotSDK({
        botUsername: env.BOT_USERNAME || name,
        password: env.PASSWORD || '',
        gatewayUrl: env.GATEWAY_URL || deriveGatewayUrl(env.SERVER || 'rs-sdk-demo.fly.dev'),
        connectionMode: mode,
        autoReconnect: false,
        autoLaunchBrowser: false,
        showChat: false,
        connectTimeout: 20_000,
        readyTimeout: 15_000
    });
}

function escapeRe(name: string): RegExp {
    return new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i');
}

function invCount(sdk: BotSDK, re: RegExp): number {
    return sdk.getInventory().filter((i) => re.test(i.name)).reduce((n, i) => n + (i.count ?? 0), 0);
}

function wornCount(sdk: BotSDK, re: RegExp): number {
    return sdk.getEquipment().filter((i) => re.test(i.name)).reduce((n, i) => n + (i.count ?? 0), 0);
}

function worn(sdk: BotSDK, re: RegExp): boolean {
    return wornCount(sdk, re) > 0;
}

function totalCount(sdk: BotSDK, re: RegExp): number {
    return invCount(sdk, re) + wornCount(sdk, re);
}

function bestName(sdk: BotSDK, ranks: RegExp[]): string | null {
    const pool = [
        ...sdk.getEquipment().filter((i) => (i.count ?? 0) > 0),
        ...sdk.getInventory().filter((i) => (i.count ?? 0) > 0),
        ...sdk.getBankItems().filter((i) => (i.count ?? 0) > 0)
    ];
    for (const re of ranks) {
        const hit = pool.find((i) => re.test(i.name));
        if (hit) return hit.name;
    }
    return null;
}

type Share = { name: string; amount: number; item: RegExp };

function snapshotShares(sdk: BotSDK, ways: number): Share[] {
    const byKey = new Map<string, { name: string; count: number }>();
    for (const it of sdk.getInventory()) {
        if ((it.count ?? 0) <= 0) continue;
        const key = `${it.id}:${it.name}`;
        const cur = byKey.get(key);
        if (cur) cur.count += it.count ?? 1;
        else byKey.set(key, { name: it.name, count: it.count ?? 1 });
    }
    const shares: Share[] = [];
    for (const { name, count } of byKey.values()) {
        const amount = Math.floor(count / ways);
        if (amount < 1) {
            console.log(`[split] skip ${name} x${count} (not enough for ${ways}-way)`);
            continue;
        }
        shares.push({ name, amount, item: escapeRe(name) });
    }
    return shares;
}

function chunks<T>(items: T[], size: number): T[][] {
    const out: T[][] = [];
    for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
    return out;
}

async function runSplit(): Promise<void> {
    const sdk = connect(GIVER);
    try {
        await sdk.connect();
        const age = sdk.getStateAge();
        if (age > FRESH_STATE_MS) {
            throw new Error(`${GIVER} has no live state (${formatStateAge(age)}) — cannot split inventory`);
        }
        const bot = new BotActions(sdk);
        await bot.dismissBlockingUI();
        await closeUi(bot, sdk);
        const p = playerPos(sdk);
        console.log(`[split] ${GIVER} @ ${p.x},${p.z}`);
        const pending: string[] = [];
        for (const name of RANGERS) {
            const peek = connect(name, 'observe');
            try {
                await peek.connect();
                if (invCount(peek, /adamant full helm/i) > 0) {
                    console.log(`[split] ${name} already has a share — skip`);
                    continue;
                }
            } finally {
                try {
                    peek.disconnect();
                } catch {
                    /* ignore */
                }
            }
            pending.push(name);
        }
        const shares = snapshotShares(sdk, pending.length || 1);
        console.log(
            `[split] ${pending.length} remaining; per ranger: ${shares.map((s) => `${s.name}x${s.amount}`).join(', ') || '(nothing)'}`
        );
        if (!shares.length) throw new Error('Nothing to split');

        for (const name of pending) {
            const nearby = sdk.findNearbyPlayer(new RegExp(`^${name}$`, 'i'));
            if (!nearby) {
                console.log(`[split] ${name} not nearby — skip`);
                continue;
            }
            const recv = connect(name);
            try {
                await recv.connect();
                const recvBot = new BotActions(recv);
                await recvBot.dismissBlockingUI();
                await closeUi(recvBot, recv);
                for (const [i, batch] of chunks(shares, CHUNK).entries()) {
                    console.log(`[split] ${name} batch ${i + 1}/${Math.ceil(shares.length / CHUNK)}`);
                    const serving = recvBot.serveTrades({
                        from: /^jackthief$/i,
                        maxTrades: 1,
                        timeout: 120_000,
                        tradeTimeout: 120_000
                    });
                    await Bun.sleep(400);
                    const traded = await bot.trade(name, {
                        give: batch.map((s) => ({ item: s.item, amount: s.amount })),
                        retryOnBusy: true,
                        requestTimeout: 90_000,
                        timeout: 120_000
                    });
                    const served = await serving;
                    const last = served.trades[served.trades.length - 1];
                    const gave = traded.gave?.map((g) => `${g.name}x${g.count}`).join(',') ?? 'none';
                    console.log(
                        `[split] ${name}: giver=${traded.success ? 'ok' : traded.message} recv=${last?.success ? 'ok' : last?.message ?? served.message} gave=${gave}`
                    );
                    if (!traded.success) throw new Error(`Trade to ${name} failed: ${traded.message}`);
                    await sdk.waitForTicks(2);
                }
            } finally {
                try {
                    recv.disconnect();
                } catch {
                    /* ignore */
                }
            }
        }
        const leftover = sdk
            .getInventory()
            .filter((i) => (i.count ?? 0) > 0)
            .map((i) => `${i.name}x${i.count}`)
            .join(', ');
        console.log(`[split] leftover ${leftover || '(empty)'}`);
    } finally {
        try {
            sdk.disconnect();
        } catch {
            /* ignore */
        }
    }
}

function canEquip(item: { optionsWithIndex?: Array<{ text: string }> } | null): boolean {
    return Boolean(item?.optionsWithIndex?.some((o) => /wield|wear|equip/i.test(o.text)));
}

async function wear(bot: BotActions, sdk: BotSDK, re: RegExp, label: string): Promise<string> {
    if (worn(sdk, re)) return `${label} (already)`;
    const inv = sdk.getInventory().find((i) => re.test(i.name) && canEquip(i));
    if (!inv) return `${label} (missing)`;
    const r = await bot.equipItem(inv);
    return `${label}${r.success ? '' : ` (${r.message})`}`;
}

async function gearOne(name: string): Promise<string> {
    const sdk = connect(name);
    try {
        await sdk.connect();
        const age = sdk.getStateAge();
        if (age > FRESH_STATE_MS) return `${name}: skipped (no live state, ${formatStateAge(age)})`;
        const bot = new BotActions(sdk);
        await bot.dismissBlockingUI();
        await closeUi(bot, sdk);

        const helmName = bestName(sdk, HELM);
        const helmRe = helmName ? escapeRe(helmName) : /adamant (full )?helm/i;
        const kitRes = [helmRe, SHIELD, CHAPS, VAMBS];
        const noted = sdk
            .getInventory()
            .filter((i) => kitRes.some((re) => re.test(i.name)) && !canEquip(i))
            .sort((a, b) => b.slot - a.slot);

        const needUnnote = kitRes.filter((re) => !worn(sdk, re) && noted.some((i) => re.test(i.name)));
        if (noted.length) {
            const opened = sdk.getState()?.bank?.isOpen ? { success: true } : await bot.openBank(8_000);
            if (!opened.success && !sdk.getState()?.bank?.isOpen) {
                return `${name}: failed to open bank (${opened.message})`;
            }
            await sdk.waitForCondition((s) => (s.bank?.items?.length ?? 0) > 0, 5_000).catch(() => {});
            for (const item of noted) {
                await sdk.sendBankDeposit(item.slot, -1);
                await sdk.waitForTicks(1).catch(() => {});
                console.log(`[gear] ${name}: deposited noted ${item.name} slot ${item.slot}`);
            }
            for (const re of needUnnote) {
                const r = await bot.withdrawItem(re, 1, { asNote: false });
                console.log(`[gear] ${name}: unnote ${re}: ${r.success || r.partial ? 'ok' : r.message}`);
            }
            await bot.closeBank();
            await sdk.waitForCondition((s) => s.bank?.isOpen === false, 4_000).catch(() => {});
            await sdk.waitForCondition((s) => s.inventory.some((i) => KNIVES.test(i.name)), 5_000).catch(() => {});
        }

        const wornBits = [
            await wear(bot, sdk, helmRe, helmName ?? 'addy helm'),
            await wear(bot, sdk, KNIVES, 'mithril knife'),
            await wear(bot, sdk, SHIELD, 'anti-dragon shield'),
            await wear(bot, sdk, CHAPS, 'green chaps'),
            await wear(bot, sdk, VAMBS, 'green vambraces')
        ];
        const knives = totalCount(sdk, KNIVES);
        const p = playerPos(sdk);
        return `${name}: ${p.x},${p.z} knives=${knives} | ${wornBits.join(', ')}`;
    } catch (error) {
        return `${name}: failed ${error instanceof Error ? error.message : String(error)}`;
    } finally {
        try {
            sdk.disconnect();
        } catch {
            /* ignore */
        }
    }
}

initPathfinding();
if (MODE === 'split') {
    await runSplit();
} else {
    const lines = await Promise.all(RANGERS.map(gearOne));
    for (const line of lines) console.log(line);
}
