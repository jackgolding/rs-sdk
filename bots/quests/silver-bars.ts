/**
 * Silver bars for jackthief's mule stock (Nature Spirit's sickle; jackthief had none and
 * jacklove13's run timed out waiting on one, 2026-11-05). All in Al Kharid: silver rocks in
 * the mine, ore used on the furnace one bar at a time (smelting.rs2 smelt_ore_single, no
 * interface), bars banked. Mining 20 + Smithing 20.
 *
 *   bun bots/quests/silver-bars.ts {botname} [--bars=20]
 *
 * Counts bars in the bank, so a restart carries on. Hand them over afterwards with
 * mule-produce.ts --deliver=jackthief --give=silver bar:N.
 */
import { runTask, type Quest } from './lib/run-quest';
import { AL_KHARID_MINE, mineAt } from './lib/mining';
import { untilTicks } from './lib/ticks';
import { SAFE_BANKS } from './safe-stops';

const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const WANT = Number(arg('bars') ?? 20);
const BANK = SAFE_BANKS['al-kharid'];
/** Beside the real furnace (process-bank.ts: 2781 at 3272,3185; 2785 at 3273,3184 is a decoy). */
const FURNACE_STAND = { x: 3275, z: 3185 };
const ORE = /^silver ore$/i;
const BAR = /^silver bar$/i;

async function bankBars(q: Quest): Promise<number> {
    await q.goTo(BANK, 3);
    const r = await q.bot.openBank();
    if (!r.success) throw new Error(`silver: bank would not open: ${r.message}`);
    for (const it of q.sdk.getInventory().filter((i) => BAR.test(i.name) || ORE.test(i.name))) await q.bot.depositItem(it, -1).catch(() => undefined);
    await q.sdk.waitForTicks(2);
    const banked = q.sdk.findBankItem(BAR)?.count ?? 0;
    await q.bot.closeBank();
    return banked;
}

async function smeltAll(q: Quest): Promise<number> {
    await q.goTo(FURNACE_STAND, 1);
    let made = 0;
    for (let guard = 0; guard < 30; guard++) {
        const ore = q.sdk.getInventory().find((i) => ORE.test(i.name));
        if (!ore) break;
        const furnace = (q.sdk.getNearbyLocs() ?? []).find((l) => /furnace/i.test(l.name) && l.optionsWithIndex.some((o) => /smelt/i.test(o.text)));
        if (!furnace) throw new Error('silver: no furnace with a Smelt option in view');
        const before = q.count('silver bar');
        await q.bot.useItemOnLoc(ore, furnace).catch(() => undefined);
        if (await untilTicks(q.sdk, () => q.count('silver bar') > before, 12)) made++;
        if (q.sdk.getDialog()?.isOpen) await q.bot.dismissBlockingUI().catch(() => undefined);
    }
    return made;
}

await runTask({
    id: 'silver-bars',
    hub: 'al-kharid',
    needs: [{ item: 'pickaxe', count: 1 }],
    task: async (q) => {
        if (q.level('mining') < 20 || q.level('smithing') < 20) throw new Error(`silver: needs Mining 20 + Smithing 20 (have ${q.level('mining')}/${q.level('smithing')})`);
        let banked = await bankBars(q);
        q.log(`silver: ${banked}/${WANT} bars banked at the start`);
        for (let trip = 0; banked < WANT && trip < 20 && !q.stopRequested(); trip++) {
            const room = 28 - q.sdk.getInventory().length;
            const take = Math.min(room, WANT - banked);
            if (take <= 0) throw new Error('silver: no pack room for ore');
            await mineAt(q, 'silver ore', AL_KHARID_MINE, { count: q.count('silver ore') + take });
            if (q.count('silver ore') === 0) throw new Error('silver: mined no silver ore at Al Kharid');
            const made = await smeltAll(q);
            banked = await bankBars(q);
            q.log(`silver: trip ${trip + 1}: smelted ${made}; ${banked}/${WANT} bars banked`);
        }
        if (banked < WANT) throw new Error(`silver: only ${banked}/${WANT} bars banked`);
    },
});
