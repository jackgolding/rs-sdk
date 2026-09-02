/**
 * Bank cargo, withdraw it as notes, and hand it to a partner standing nearby.
 *
 *   bun bots/quests/note-handoff.ts Jackpoo1 give jackthief
 *   bun bots/quests/note-handoff.ts jackthief receive Jackpoo1
 */
import { join } from 'path';
import { runScript } from '../../sdk/runner';
import { appendGrindLog } from '../../sdk/grind-log';
import { SEERS_BANK } from './tiles';
import { closeUi, distTo, playerPos, walkNear } from './movement';

const CARGO = /(logs$|^bow\s*string$)/i;
const KEEP = /^(coins|(bronze|iron|steel|black|mithril|adamant|rune) axe)$/i;

const positional: string[] = [];
for (const a of process.argv.slice(2)) {
    if (!a.startsWith('-')) positional.push(a);
}

function canon(name: string): string {
    if (/^jackpoo1$/i.test(name)) return 'Jackpoo1';
    if (/^jackthief$/i.test(name)) return 'jackthief';
    return name;
}

const botName = canon(positional[0] ?? '');
const role = (positional[1] ?? '').toLowerCase();
const partner = canon(positional[2] ?? '');
const GRIND_LOG = join(process.cwd(), 'bots', botName, 'grind.log');

if (!botName || (role !== 'give' && role !== 'receive') || !partner) {
    throw new Error('Usage: bun bots/quests/note-handoff.ts {name} {give|receive} {partner}');
}

function escapeRegex(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function isCargo(name: string): boolean {
    return CARGO.test(name);
}

function cargoStacks(sdk: import('../../sdk/index').BotSDK) {
    return sdk.getInventory().filter((i) => (i.count ?? 0) > 0 && isCargo(i.name));
}

function cargoSummary(sdk: import('../../sdk/index').BotSDK): string {
    return cargoStacks(sdk).map((i) => `${i.count} ${i.name}`).join(', ') || 'none';
}

function giveList(sdk: import('../../sdk/index').BotSDK) {
    const seen = new Set<string>();
    const give: { item: RegExp; amount: number }[] = [];
    for (const item of cargoStacks(sdk)) {
        const key = item.name.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        give.push({ item: new RegExp(`^${escapeRegex(item.name)}$`, 'i'), amount: -1 });
    }
    return give;
}

await runScript(async ({ bot, sdk }) => {
    const log = (level: 'LOG' | 'WARN' | 'ERROR', msg: string) => {
        console.log(`${level} ${msg}`);
        appendGrindLog(GRIND_LOG, `${new Date().toISOString()} ${level} ${msg}`);
    };

    function atSeersBank(): boolean {
        const p = playerPos(sdk);
        return p.x >= 2716 && p.x <= 2734 && p.z >= 3484 && p.z <= 3498;
    }

    async function openSeersBank(): Promise<boolean> {
        if (sdk.getState()?.bank?.isOpen) return true;
        if (!atSeersBank()) {
            log('LOG', `Walking to Seers bank from ${playerPos(sdk).x},${playerPos(sdk).z}`);
            await walkNear(bot, sdk, SEERS_BANK.x, SEERS_BANK.z, 8);
        }
        for (let i = 0; i < 5; i++) {
            if (sdk.getState()?.bank?.isOpen) break;
            const r = await bot.openBank();
            if (r.success || sdk.getState()?.bank?.isOpen) break;
            await sdk.waitForTicks(2);
        }
        if (!sdk.getState()?.bank?.isOpen) return false;
        await sdk
            .waitForCondition((s) => (s.bank?.items?.length ?? 0) > 0, 8_000)
            .catch(() => {});
        return true;
    }

    async function packNotes(): Promise<boolean> {
        if (!(await openSeersBank())) {
            log('ERROR', 'Could not open Seers bank');
            return false;
        }
        for (const item of [...sdk.getInventory()]) {
            if ((item.count ?? 0) <= 0 || KEEP.test(item.name)) continue;
            await bot.depositItem(item, -1);
        }
        const wanted = sdk.getBankItems().filter((i) => (i.count ?? 0) > 0 && isCargo(i.name));
        log('LOG', `Bank cargo: ${wanted.map((i) => `${i.count} ${i.name}`).join(', ') || 'none'}`);
        if (wanted.length === 0) {
            log('WARN', 'Bank has no logs or bowstrings');
            await bot.closeBank();
            return false;
        }
        for (const item of wanted) {
            const beforeId = item.id;
            const r = await bot.withdrawItem(item, -1, { asNote: true });
            const arrived = sdk.getInventory().find((i) => i.name === item.name);
            const noted = !!arrived && arrived.id !== beforeId;
            log(
                r.success && noted ? 'LOG' : 'WARN',
                `Note-withdraw ${item.name} x${item.count}: ${r.success ? 'ok' : r.message}${noted ? ' noted' : ' NOT noted'}`
            );
        }
        await bot.closeBank();
        log('LOG', `Packed ${cargoSummary(sdk)}`);
        return cargoStacks(sdk).length > 0;
    }

    await closeUi(bot, sdk);
    if (sdk.getTradeState().isOpen) await bot.declineTrade().catch(() => {});
    log('LOG', `note-handoff ${role} ${partner} @ ${playerPos(sdk).x},${playerPos(sdk).z}`);

    if (role === 'receive') {
        if (!atSeersBank()) await walkNear(bot, sdk, SEERS_BANK.x, SEERS_BANK.z, 8);
        const from = new RegExp(`^${escapeRegex(partner)}$`, 'i');
        log('LOG', `Waiting to receive from ${partner}`);
        const served = await bot.serveTrades({
            from,
            give: [],
            want: [],
            accept: () => true,
            timeout: 300_000,
            tradeTimeout: 90_000,
            maxTrades: 4
        });
        const last = served.trades[served.trades.length - 1];
        log(
            last?.success ? 'LOG' : 'WARN',
            `Receive ${last?.success ? 'ok' : last?.reason ?? served.reason} ${served.message} | ${cargoSummary(sdk)}`
        );
        return;
    }

    if (!(await packNotes())) return;
    if (!atSeersBank()) await walkNear(bot, sdk, SEERS_BANK.x, SEERS_BANK.z, 8);

    const give = giveList(sdk);
    if (give.length === 0) {
        log('WARN', 'Nothing noted to give');
        return;
    }
    log('LOG', `Giving ${partner}: ${cargoSummary(sdk)}`);
    const result = await bot.trade(partner, {
        give,
        want: [],
        retryOnBusy: true,
        requestTimeout: 120_000,
        timeout: 90_000
    });
    log(
        result.success ? 'LOG' : 'WARN',
        `Trade ${partner} ${result.success ? 'ok' : result.reason} ${result.message} leftover=${cargoSummary(sdk)}`
    );
});
