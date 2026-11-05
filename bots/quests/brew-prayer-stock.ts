/**
 * Brew the mule's banked ranarr into Prayer potion(3) at its own bank. Run-once todo item.
 *   bun bots/quests/brew-prayer-stock.ts {botname} [--max=N]
 */
import { runTask } from './lib/run-quest';
import { brewPrayerPotions } from './prayer-brew';

const maxArg = process.argv.find((a) => a.startsWith('--max='))?.slice(6);
const MAX = Number(maxArg ?? 60);

await runTask({
    id: 'brew-prayer-stock',
    hub: 'ardougne',
    task: async (q) => {
        if (!(MAX > 0)) throw new Error(`bad --max=${maxArg}`);
        const open = await q.bot.openBank();
        if (!open.success) throw new Error(`bank did not open: ${open.message}`);
        let total = 0;
        while (total < MAX) {
            const made = await brewPrayerPotions(q.bot, q.sdk, q.log, Math.min(9, MAX - total));
            if (made <= 0) break;
            total += made;
            const pots = q.sdk.getInventory().filter((i) => /^prayer potion/i.test(i.name));
            for (const p of pots) await q.bot.depositItem(p, -1);
        }
        if (total === 0) throw new Error('nothing brewed: no ranarr, vials or snape in this bank');
        q.log(`brew-prayer-stock: brewed ${total}`);
    },
});
