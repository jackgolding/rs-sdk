/**
 * Brew potions from the account's own bank, at the bank, by obj id (unfinished potions all share
 * one name): herb + vial of water -> unfinished, secondary + unfinished -> potion(3). Antifire's
 * secondary is dragon scale dust, ground here from blue dragon scales with a pestle and mortar.
 * Made for jacklove16 (2026-11-02): Herblore 51 -> 69 on prayer potions and super attacks, then
 * antifire from the fleet's lantadyme and jacklove10's blue dragon scales.
 *
 *   bun bots/quests/herb-brew.ts {botname} --recipes=prayer,superattack[,antifire,attack] [--until=69]
 *
 * Recipes run in the order given, each while its ingredients last and the level allows.
 * `--until=N` stops the training recipes once Herblore reaches N (antifire is never cut short).
 * Logs "already complete" when nothing more can be brewed.
 */
import { runTask, type Quest } from './lib/run-quest';

const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const UNTIL = Number(arg('until') ?? 0);

interface Recipe {
    name: string;
    level: number;
    herb: number;
    unf: number;
    second: number;
    product: number;
    /** Training recipes stop at --until; product recipes (antifire) do not. */
    training: boolean;
}
const VIAL_OF_WATER = 227;
const BLUE_SCALE = 243;
const SCALE_DUST = 241;
const PESTLE = 233;
const RECIPES: Record<string, Recipe> = {
    attack: { name: 'attack potion', level: 3, herb: 249, unf: 91, second: 221, product: 121, training: true },
    prayer: { name: 'prayer potion', level: 38, herb: 257, unf: 99, second: 231, product: 139, training: true },
    superattack: { name: 'super attack', level: 45, herb: 259, unf: 101, second: 221, product: 145, training: true },
    antifire: { name: 'antifire potion', level: 69, herb: 2481, unf: 2483, second: SCALE_DUST, product: 2454, training: false },
};
const ORDER = (arg('recipes') ?? 'prayer,superattack').split(',').map((r) => r.trim()).filter((r) => RECIPES[r]);

const inv = (q: Quest, id: number) => q.sdk.getInventory().filter((i) => i.id === id).reduce((n, i) => n + (i.count ?? 1), 0);
const bank = (q: Quest, id: number) => (q.sdk.getBankItems() ?? []).filter((b) => b.id === id).reduce((n, b) => n + b.count, 0);
const herbLevel = (q: Quest) => q.sdk.getSkill('Herblore')?.baseLevel ?? 1;

async function openBank(q: Quest): Promise<void> {
    // Three tries: a single timeout ended ABGARMY09's run twice mid-brew (2026-11-03).
    let msg = '';
    for (let attempt = 1; attempt <= 3; attempt++) {
        if (q.sdk.getState()?.bank?.isOpen) return;
        const r = await q.bot.openBank();
        if (r.success) return;
        msg = r.message ?? '';
        await q.bot.closeInterface().catch(() => undefined);
        await q.sdk.waitForTicks(3).catch(() => undefined);
    }
    throw new Error(`openBank: ${msg}`);
}
async function depositAll(q: Quest, keep: number[] = []): Promise<void> {
    for (let i = 0; i < 28; i++) {
        const it = q.sdk.getInventory().find((x) => (x.count ?? 0) > 0 && !keep.includes(x.id));
        if (!it) break;
        const r = await q.bot.depositItem(it, -1);
        if (!r.success && !r.partial) break;
    }
}
async function withdraw(q: Quest, id: number, n: number): Promise<number> {
    const b = (q.sdk.getBankItems() ?? []).find((x) => x.id === id && x.count > 0);
    if (!b || n <= 0) return 0;
    const before = inv(q, id);
    await q.bot.withdrawItem(b, Math.min(n, b.count), { asNote: false });
    await q.sdk.waitForCondition(() => inv(q, id) > before, 3_000).catch(() => undefined);
    return inv(q, id) - before;
}

/** Use `a` on `b` until one runs out; each use consumes one `b` (waits for it). */
async function combine(q: Quest, a: number, b: number, times: number): Promise<void> {
    for (let i = 0; i < times; i++) {
        const x = q.sdk.getInventory().find((it) => it.id === a);
        const y = q.sdk.getInventory().find((it) => it.id === b);
        if (!x || !y) return;
        const had = inv(q, b);
        await q.sdk.sendUseItemOnItem(x.slot, y.slot);
        await q.sdk.waitForCondition(() => inv(q, b) < had, 4_000).catch(() => undefined);
        if (q.sdk.getDialog()?.isOpen) await q.bot.dismissBlockingUI().catch(() => undefined);
    }
}

/** Blue dragon scales -> dragon scale dust, a pack at a time, until `want` dust is banked. */
async function grindDust(q: Quest, want: number): Promise<void> {
    for (let pack = 0; pack < 60 && !q.stopRequested(); pack++) {
        await openBank(q);
        await depositAll(q, [PESTLE]);
        const have = bank(q, SCALE_DUST);
        if (have >= want || bank(q, BLUE_SCALE) === 0) return;
        if (inv(q, PESTLE) === 0 && (await withdraw(q, PESTLE, 1)) === 0) throw new Error('herb-brew: no pestle and mortar banked');
        const n = await withdraw(q, BLUE_SCALE, Math.min(27, want - have));
        await q.bot.closeBank();
        await combine(q, PESTLE, BLUE_SCALE, n);
        q.log(`grind: ${inv(q, SCALE_DUST)} dragon scale dust this pack`);
    }
}

/** One pack of a recipe: herbs + vials -> unfinished, then + secondary. Returns potions made. */
async function brewPack(q: Quest, r: Recipe): Promise<number> {
    await openBank(q);
    await depositAll(q);
    // Unfinished potions already banked (an interrupted pack) are finished first.
    const unfBanked = bank(q, r.unf);
    if (unfBanked > 0 && bank(q, r.second) > 0) {
        const n = Math.min(14, unfBanked, bank(q, r.second));
        await withdraw(q, r.unf, n);
        await withdraw(q, r.second, n);
    } else {
        const n = Math.min(9, bank(q, r.herb), bank(q, VIAL_OF_WATER), bank(q, r.second));
        if (n <= 0) return 0;
        await withdraw(q, r.herb, n);
        await withdraw(q, VIAL_OF_WATER, n);
        await withdraw(q, r.second, n);
    }
    await q.bot.closeBank();
    const before = inv(q, r.product);
    await combine(q, r.herb, VIAL_OF_WATER, inv(q, r.herb));
    await combine(q, r.second, r.unf, inv(q, r.unf));
    return inv(q, r.product) - before;
}

/** Identify levels from herbs.obj (guam-irit-potions.ts). Grimy herbs are all named "Herb". */
const UNID_LEVELS: Record<number, number> = {
    199: 3, 201: 5, 203: 11, 205: 20, 207: 25, 3049: 30, 209: 40, 211: 48, 213: 54, 3051: 59, 215: 65, 2485: 67, 217: 70, 219: 75,
};

/**
 * Identify every grimy herb the level allows, 28 at a time (op1 on each), so the swarm's herb
 * hand-overs to jackthief become brewable (user, 2026-11-03). Returns herbs identified.
 */
async function identifyBank(q: Quest): Promise<number> {
    let total = 0;
    for (let load = 0; load < 80 && !q.stopRequested(); load++) {
        await openBank(q);
        await depositAll(q);
        const lvl = herbLevel(q);
        const grimy = (q.sdk.getBankItems() ?? []).find((b) => /^herb$/i.test(b.name) && b.count > 0 && (UNID_LEVELS[b.id] ?? 99) <= lvl);
        if (!grimy) break;
        await q.bot.withdrawItem(grimy, Math.min(28, grimy.count), { asNote: false });
        await q.sdk.waitForCondition(() => q.sdk.getInventory().some((i) => /^herb$/i.test(i.name)), 3_000).catch(() => undefined);
        await q.bot.closeBank();
        let n = 0;
        for (const it of [...q.sdk.getInventory()]) {
            if (!/^herb$/i.test(it.name)) continue;
            const before = q.sdk.getInventory().filter((i) => /^herb$/i.test(i.name)).length;
            await q.sdk.sendUseItem(it.slot, 1);
            await q.sdk.waitForCondition(() => q.sdk.getInventory().filter((i) => /^herb$/i.test(i.name)).length < before, 2_000).catch(() => undefined);
            n++;
        }
        total += n;
        if (n === 0) break;
    }
    if (total) q.log(`identify: ${total} grimy herbs identified (Herblore ${herbLevel(q)})`);
    return total;
}

function canBrew(q: Quest, r: Recipe): boolean {
    if (herbLevel(q) < r.level) return false;
    if (r.training && UNTIL > 0 && herbLevel(q) >= UNTIL) return false;
    const second = r.second === SCALE_DUST ? bank(q, SCALE_DUST) + bank(q, BLUE_SCALE) : bank(q, r.second);
    return second > 0 && (bank(q, r.unf) > 0 || (bank(q, r.herb) > 0 && bank(q, VIAL_OF_WATER) > 0));
}

await runTask({
    id: 'herb-brew',
    hub: 'ardougne',
    task: async (q) => {
        const made = new Map<string, number>();
        const lvl0 = herbLevel(q);
        await identifyBank(q);
        for (const key of ORDER) {
            const r = RECIPES[key]!;
            let misses = 0;
            while (!q.stopRequested() && misses < 2) {
                await openBank(q);
                if (!canBrew(q, r)) break;
                if (r.second === SCALE_DUST && bank(q, SCALE_DUST) < 9) {
                    await grindDust(q, Math.min(bank(q, r.herb) + bank(q, r.unf), 200));
                    await openBank(q);
                }
                const n = await brewPack(q, r);
                made.set(r.name, (made.get(r.name) ?? 0) + n);
                q.log(`brew: ${n} ${r.name} (Herblore ${herbLevel(q)}, total ${made.get(r.name)})`);
                misses = n > 0 ? 0 : misses + 1;
            }
        }
        await openBank(q);
        await depositAll(q);
        q.log(`herb-brew: ${[...made].map(([k, v]) => `${v} ${k}`).join(', ') || 'nothing'}; Herblore ${lvl0} -> ${herbLevel(q)} — already complete`);
    },
});
