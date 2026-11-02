/**
 * Top an account's bank up from a mule at its bank, as bank notes in one trade. Made for the 2026-11-02 Ardougne muster: vials of water and snape grass to the
 * dragon accounts that already bank ranarr, so they brew their own prayer potions.
 *
 *   bun bots/quests/top-up.ts {botname} --want="vial of water=40,snape grass=30" [--mule=jackthief]
 *
 * `want` is what the bank should hold afterwards. Logs "already complete" once it does.
 */
import { runTask } from './lib/run-quest';
import { requestFromMule } from './supply';

const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const MULE = arg('mule') ?? 'jackthief';
const WANT = (arg('want') ?? '')
    .split(',')
    .map((s) => s.split('=').map((x) => x.trim()))
    .filter(([label, n]) => label && Number(n) > 0)
    .map(([label, n]) => ({ label: label!, target: Number(n), pattern: new RegExp(`^${esc(label!)}$`, 'i') }));

await runTask({
    id: 'top-up',
    hub: 'ardougne',
    task: async (q) => {
        const { sdk, bot } = q;
        if (WANT.length === 0) throw new Error('usage: top-up.ts <bot> --want="label=n,label=n" [--mule=jackthief]');
        const banked = (p: RegExp) => (sdk.getBankItems() ?? []).filter((b) => p.test(b.name)).reduce((n, b) => n + b.count, 0);
        const held = (p: RegExp) => sdk.getInventory().filter((i) => p.test(i.name)).reduce((n, i) => n + (i.count ?? 1), 0);
        let empty = 0;
        for (let round = 1; round <= 12; round++) {
            const opened = await bot.openBank();
            if (!opened.success) throw new Error(`openBank: ${opened.message}`);
            for (let i = 0; i < 28; i++) {
                const item = sdk.getInventory().find((it) => (it.count ?? 0) > 0);
                if (!item) break;
                const r = await bot.depositItem(item, -1);
                if (!r.success && !r.partial) break;
            }
            await sdk.waitForTicks(2).catch(() => undefined);
            const short = WANT.map((w) => ({ ...w, missing: w.target - banked(w.pattern) })).filter((w) => w.missing > 0);
            q.log(`top-up round ${round}: ${WANT.map((w) => `${w.label} ${banked(w.pattern)}/${w.target}`).join(', ')}`);
            await bot.closeBank();
            if (short.length === 0) {
                q.log(`top-up: bank holds every target — already complete`);
                return;
            }
            // As bank notes: every line whole, in one trade (user, 2026-11-02).
            const needs = short.map((w) => ({ label: w.label, pattern: w.pattern, count: w.missing }));
            const before = needs.map((n) => held(n.pattern));
            await requestFromMule({ sdk, bot, session: null, log: q.log } as never, needs, { mule: MULE, timeoutMs: 5 * 60_000, noted: true });
            const got = needs.reduce((n, need, i) => n + held(need.pattern) - before[i]!, 0);
            if (got > 0) empty = 0;
            else if (++empty >= 2) throw new Error(`${MULE} served nothing twice (${needs.map((n) => n.label).join(', ')})`);
        }
        throw new Error('top-up: targets not reached in 12 rounds');
    },
});
