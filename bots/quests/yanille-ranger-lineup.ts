/**
 * Equip each 80+ ranger's best range gear, then line them against the Yanille
 * bank wall (one tile south of the stack, spread on x).
 *
 * Skips jackthief (manual Chrome).
 *
 *   bun bots/quests/yanille-ranger-lineup.ts
 */
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { BotSDK, deriveGatewayUrl } from '../../sdk/index';
import { BotActions } from '../../sdk/actions';
import { initPathfinding } from '../../sdk/pathfinding';
import { ROOT } from '../../.cursor/skills/wake-fleet/scripts/roster';
import { FRESH_STATE_MS, formatStateAge } from '../../sdk/gateway-state';
import { closeUi, playerPos } from './movement';

const RANGERS = ['fatpig', 'jacklove1', 'jacklove2', 'jacklove3', 'jacklove5'] as const;
const LINE_Z = 3091;
const LINE_X0 = 2611;

const RANKS: RegExp[][] = [
    [
        /crystal bow/i,
        /^magic shortbow$/i,
        /^magic longbow$/i,
        /^yew shortbow$/i,
        /^yew longbow$/i,
        /^maple shortbow$/i,
        /^maple longbow$/i,
        /^willow shortbow$/i,
        /^willow longbow$/i,
        /^oak shortbow$/i,
        /^shortbow$/i
    ],
    [/^rune arrows?$/i, /^adamant arrows?$/i, /^mithril arrows?$/i, /^steel arrows?$/i, /^iron arrows?$/i, /^bronze arrows?$/i],
    [/robin hood hat/i, /archer helm/i, /^coif$/i, /^leather cowl$/i],
    [
        /black d'?hide body|black dragonhide body/i,
        /red d'?hide body|red dragonhide body/i,
        /blue d'?hide body|blue dragonhide body/i,
        /green d'?hide body|green dragonhide body|^dragonhide body$/i,
        /^studded body$/i,
        /^hardleather body$/i,
        /^leather body$/i
    ],
    [
        /black d'?hide chaps|black dragonhide chaps/i,
        /red d'?hide chaps|red dragonhide chaps/i,
        /blue d'?hide chaps|blue dragonhide chaps/i,
        /green d'?hide chaps|green dragonhide chaps|^dragonhide chaps$/i,
        /^studded chaps$/i,
        /^leather chaps$/i
    ],
    [
        /black d'?hide vambraces|black dragonhide vambraces/i,
        /red d'?hide vambraces/i,
        /blue d'?hide vambraces/i,
        /^dragon vambraces$/i,
        /green d'?hide vambraces/i,
        /leather vambraces/i
    ],
    [/ranger boots/i, /snakeskin boots/i, /^leather boots$/i],
    [/ranging cape/i, /legend'?s cape/i, /obsidian cape/i, /team cape/i],
    [/amulet of fury/i, /amulet of glory/i, /amulet of power/i, /amulet of accuracy/i, /amulet of strength/i],
    [/archers.? ring/i, /ring of life/i, /ring of recoil/i]
];

type Piece = { name: string; id: number; count: number; where: 'worn' | 'inv' | 'bank' };

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

function pool(sdk: BotSDK): Piece[] {
    const out: Piece[] = [];
    for (const i of sdk.getEquipment()) {
        if ((i.count ?? 0) > 0) out.push({ name: i.name, id: i.id, count: i.count, where: 'worn' });
    }
    for (const i of sdk.getInventory()) {
        if ((i.count ?? 0) > 0) out.push({ name: i.name, id: i.id, count: i.count, where: 'inv' });
    }
    for (const i of sdk.getBankItems()) {
        if ((i.count ?? 0) > 0) out.push({ name: i.name, id: i.id, count: i.count, where: 'bank' });
    }
    return out;
}

function bestIn(items: Piece[], ranks: RegExp[]): Piece | null {
    for (const re of ranks) {
        const hit = items.find((i) => re.test(i.name));
        if (hit) return hit;
    }
    return null;
}

function isArrow(name: string): boolean {
    return /arrows?$/i.test(name);
}

async function setupRanger(name: string, tileX: number): Promise<string> {
    const env = loadEnv(name);
    const sdk = new BotSDK({
        botUsername: env.BOT_USERNAME || name,
        password: env.PASSWORD || '',
        gatewayUrl: env.GATEWAY_URL || deriveGatewayUrl(env.SERVER || 'rs-sdk-demo.fly.dev'),
        connectionMode: 'control',
        autoReconnect: false,
        autoLaunchBrowser: false,
        showChat: false,
        connectTimeout: 12_000,
        readyTimeout: 10_000
    });

    try {
        await sdk.connect();
        const age = sdk.getStateAge();
        if (age > FRESH_STATE_MS) return `${name}: skipped (no live state, ${formatStateAge(age)})`;

        const bot = new BotActions(sdk);
        await bot.dismissBlockingUI();
        await closeUi(bot, sdk);

        const opened = sdk.getState()?.bank?.isOpen ? { success: true } : await bot.openBank(8_000);
        if (!opened.success && !sdk.getState()?.bank?.isOpen) {
            return `${name}: failed to open bank (${opened.message})`;
        }
        await sdk.waitForCondition((s) => (s.bank?.items?.length ?? 0) > 0, 5_000).catch(() => {});

        const wanted = RANKS.map((ranks) => bestIn(pool(sdk), ranks)).filter((p): p is Piece => Boolean(p));
        const fromBank = wanted.filter((p) => p.where === 'bank');
        if (fromBank.length) {
            const empty = 28 - sdk.getInventory().filter((i) => (i.count ?? 0) > 0).length;
            if (empty < fromBank.length) {
                const junk = sdk.getInventory().find((i) => /shark|lobster|swordfish|tuna|wine|harpoon/i.test(i.name));
                if (junk) await bot.depositItem(junk, -1);
            }
            for (const piece of fromBank) {
                const amount = isArrow(piece.name) ? -1 : 1;
                const r = await bot.withdrawItem(new RegExp(`^${piece.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i'), amount, {
                    asNote: false
                });
                console.log(`[${name}] withdraw ${piece.name}: ${r.success || r.partial ? 'ok' : r.message}`);
            }
        }

        await bot.closeBank();
        await sdk.waitForCondition((s) => s.bank?.isOpen === false, 3_000).catch(() => {});

        const worn: string[] = [];
        for (const piece of wanted) {
            if (piece.where === 'worn' && sdk.findEquipmentItem(new RegExp(`^${piece.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i'))) {
                worn.push(`${piece.name} (already)`);
                continue;
            }
            const inv = sdk.findInventoryItem(new RegExp(`^${piece.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i'));
            if (!inv) {
                worn.push(`${piece.name} (missing)`);
                continue;
            }
            const r = await bot.equipItem(inv);
            worn.push(`${piece.name}${r.success ? '' : ` (${r.message})`}`);
        }

        await sdk.sendWalk(tileX, LINE_Z, true);
        await sdk.waitForCondition((s) => s.player?.worldX === tileX && s.player?.worldZ === LINE_Z, 8_000).catch(() => {});
        await sdk.waitForTicks(2).catch(() => {});
        const p = playerPos(sdk);
        return `${name}: ${p.x},${p.z} | ${worn.join(', ') || 'no range gear found'}`;
    } catch (error) {
        return `${name}: failed ${error instanceof Error ? error.message : String(error)}`;
    } finally {
        try {
            sdk.disconnect();
        } catch {
            // ignore
        }
    }
}

initPathfinding();
console.log(`[ranger-lineup] ${RANGERS.length} rangers → z=${LINE_Z} (skip jackthief)`);
const results = await Promise.all(RANGERS.map((name, i) => setupRanger(name, LINE_X0 + i)));
for (const line of results) console.log(line);
