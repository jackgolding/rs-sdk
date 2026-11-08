/**
 * Consolidate an account's spare stock into a mule: log the whole bank, then trade over, as bank notes and in as
 * many trades as it takes, everything in the categories below. Gear, tools and quest items stay. A run-once task.
 *
 *   bun bots/quests/consolidate.ts {botname} [--mule=jackthief] [--keep-coins=50000] [--keep-food=100]
 *
 * User, 2026-11-08: coins and food above a float, gems (cut, uncut, dragonstones), ores and bars, herbs and
 * secondaries, runes, crystal keys and their halves, strung bows (jackthief alchs them). The bank list goes to
 * grind.log and bots/<Bot>/bank-now.json, so what each account held is on record.
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { runTask, type Quest } from './lib/run-quest';
import { dmMule, muleAccount, muleBank } from './supply';
import { ticksToMs, untilTicks } from './lib/ticks';
import type { BankItem } from '../../sdk/types';

const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const MULE = arg('mule') ?? 'jackthief';
const KEEP_COINS = Number(arg('keep-coins') ?? 50_000);
const KEEP_FOOD = Number(arg('keep-food') ?? 100);
const BOT = process.argv.slice(2).find((a) => !a.startsWith('-')) ?? '';

const FOOD = /^(shark|manta ray|sea turtle|monkfish|swordfish|lobster|bass|tuna|salmon|trout|cod|pike|karambwan|cooked karambwan)$/i;
const CATEGORIES: Array<{ name: string; re: RegExp }> = [
    { name: 'gems', re: /^(uncut )?(opal|jade|red topaz|sapphire|emerald|ruby|diamond|dragonstone|onyx)$/i },
    { name: 'ores and bars', re: /^((copper|tin|iron|silver|gold|mithril|adamantite|runite) ore|coal|(bronze|iron|steel|silver|gold|mithril|adamantite|runite) bar)$/i },
    { name: 'herbs', re: /^(herb|(grimy )?(guam leaf|marrentill|tarromin|harralander|ranarr weed|irit leaf|avantoe|kwuarm|cadantine|dwarf weed|torstol|lantadyme|snapdragon|toadflax))$/i },
    { name: 'secondaries', re: /^(snape grass|limpwurt root|eye of newt|red spiders' eggs|white berries|wine of zamorak|unicorn horn( dust)?|blue dragon scale|dragon scale dust|chocolate dust|potato cactus|jangerberries|toad's legs|crushed nest|bird nest|mort myre fungus)$/i },
    { name: 'runes', re: /^(air|water|earth|fire|mind|body|cosmic|chaos|nature|law|death|blood|soul|astral) rune$/i },
    { name: 'crystal keys', re: /^(crystal key|loop half of a key|tooth half of a key)$/i },
    { name: 'bows', re: /^((oak|willow|maple|yew|magic) )?longbow$/i },
];

const bankCount = (q: Quest, b: BankItem) => q.sdk.getBankItems().find((x) => x.id === b.id)?.count ?? 0;
const held = (q: Quest, id: number) => q.sdk.getInventory().filter((i) => i.id === id).reduce((n, i) => n + (i.count ?? 1), 0);

async function openBank(q: Quest): Promise<void> {
    if (q.sdk.getState()?.bank?.isOpen) return;
    const r = await q.bot.openBank();
    if (!r.success && !q.sdk.getState()?.bank?.isOpen) throw new Error(`consolidate: bank did not open: ${r.message}`);
}

/** What leaves this bank, and how much: categories whole, coins and food above their floats. */
function plan(q: Quest): Array<{ item: BankItem; amount: number; why: string }> {
    const out: Array<{ item: BankItem; amount: number; why: string }> = [];
    const food = q.sdk.getBankItems().filter((b) => FOOD.test(b.name)).sort((a, b) => b.count - a.count);
    let foodKept = 0;
    for (const b of q.sdk.getBankItems()) {
        if (b.count <= 0) continue;
        if (/^coins$/i.test(b.name)) {
            if (b.count > KEEP_COINS) out.push({ item: b, amount: b.count - KEEP_COINS, why: 'coins' });
            continue;
        }
        if (FOOD.test(b.name)) continue;
        const cat = CATEGORIES.find((c) => c.re.test(b.name));
        if (cat) out.push({ item: b, amount: b.count, why: cat.name });
    }
    // Food: keep the best-stocked lines up to the float, send the rest.
    for (const b of food) {
        const keep = Math.max(0, Math.min(b.count, KEEP_FOOD - foodKept));
        foodKept += keep;
        if (b.count - keep > 0) out.push({ item: b, amount: b.count - keep, why: 'food' });
    }
    return out;
}

await runTask({
    id: 'consolidate',
    hub: 'ardougne',
    task: async (q) => {
        const account = muleAccount(MULE);
        if (account.toLowerCase() === BOT.toLowerCase()) return void q.log('consolidate: this account is the mule — already complete');
        await q.goTo(muleBank(MULE), 3);
        await openBank(q);
        for (const i of q.sdk.getInventory()) await q.bot.depositItem(i, -1).catch(() => undefined);
        await q.sdk.waitForTicks(2);
        const bank = q.sdk.getBankItems().filter((b) => b.count > 0).map((b) => ({ name: b.name, id: b.id, count: b.count }));
        q.log(`consolidate: bank (${bank.length} lines): ${bank.map((b) => `${b.name} x${b.count}`).join(', ')}`);
        try {
            writeFileSync(join(process.cwd(), 'bots', BOT, 'bank-now.json'), JSON.stringify({ at: new Date().toISOString(), items: bank }, null, 1));
        } catch {
            /* the record is a convenience */
        }
        let todo = plan(q);
        q.log(`consolidate: sending ${todo.map((t) => `${t.item.name} x${t.amount}`).join(', ') || 'nothing'}`);
        for (let batch = 1; todo.length && batch <= 12 && !q.stopRequested(); batch++) {
            await openBank(q);
            const give: Array<{ item: RegExp; amount: number }> = [];
            const sent: string[] = [];
            for (const t of todo.slice(0, 27)) {
                const line = q.sdk.getBankItems().find((b) => b.id === t.item.id && b.count > 0);
                if (!line) continue;
                const before = held(q, line.id) + held(q, line.id + 1);
                await q.bot.withdrawItem(line, Math.min(t.amount, line.count), { asNote: true }).catch(() => undefined);
                await untilTicks(q.sdk, () => held(q, line.id) + held(q, line.id + 1) > before, 4);
                const got = held(q, line.id) + held(q, line.id + 1) - before;
                if (got <= 0) continue;
                const esc = line.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                give.push({ item: new RegExp(`^${esc}$`, 'i'), amount: got });
                sent.push(`${line.name} x${got}`);
            }
            await q.bot.closeBank().catch(() => undefined);
            if (!give.length) break;
            let ok = false;
            for (let attempt = 1; attempt <= 10 && !ok && !q.stopRequested(); attempt++) {
                if (attempt > 1) await q.sdk.waitForTicks(40);
                await dmMule(q.sdk, account, 'quest-restock');
                await q.sdk.waitForTicks(8);
                const res = await q.bot.trade(account, { give, want: [], timeout: ticksToMs(300), requestTimeout: ticksToMs(150), rejectAfterMs: ticksToMs(150), retryOnBusy: true });
                ok = res.success;
                q.log(`consolidate: batch ${batch} trade with ${MULE} ${ok ? 'ok' : `failed (${res.reason ?? res.message})`}: ${sent.join(', ')}`);
            }
            if (!ok) {
                await openBank(q);
                for (const i of q.sdk.getInventory()) await q.bot.depositItem(i, -1).catch(() => undefined);
                throw new Error(`consolidate: ${MULE} never took batch ${batch}`);
            }
            await openBank(q);
            todo = plan(q).filter((t) => bankCount(q, t.item) > 0);
        }
        q.log('consolidate: already complete');
    },
});
