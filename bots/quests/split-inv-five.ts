/**
 * Walk to Draynor and give each Jacklove 1/5 of every inventory stack
 * (floor(count/5); leftovers stay).
 *
 *   bun bots/quests/split-inv-five.ts jackthief
 */
import { appendFileSync } from 'fs';
import { join } from 'path';
import { runScript } from '../../sdk/runner';

const botName = process.argv.slice(2).find((a) => !a.startsWith('-')) ?? '';
const GRIND_LOG = join(process.cwd(), 'bots', botName, 'grind.log');

const DRAYNOR_BANK = { x: 3092, z: 3243 };
const RECIPIENTS = ['Jacklove1', 'Jacklove2', 'Jacklove3', 'Jacklove4', 'Jacklove5'] as const;

await runScript(async ({ bot, sdk }) => {
    const log = (msg: string) => {
        const line = `${new Date().toISOString()} ${msg}`;
        console.log(msg);
        try {
            appendFileSync(GRIND_LOG, line + '\n');
        } catch {
            /* ignore */
        }
    };

    const pos = () => {
        const p = sdk.getState()?.player;
        return { x: p?.worldX ?? 0, z: p?.worldZ ?? 0 };
    };
    const distTo = (x: number, z: number) => Math.hypot(pos().x - x, pos().z - z);

    async function closeUi(): Promise<void> {
        await bot.dismissBlockingUI();
        if (sdk.getState()?.shop?.isOpen || sdk.getState()?.bank?.isOpen || sdk.getState()?.interface?.isOpen) {
            await bot.closeInterface();
        }
    }

    async function walkNear(x: number, z: number, tolerance = 4): Promise<boolean> {
        if (distTo(x, z) <= tolerance) return true;
        const r = await bot.walkTo(x, z, Math.min(tolerance, 3));
        return r.success || distTo(x, z) <= tolerance + 2;
    }

    type Share = { item: RegExp; amount: number; name: string };
    function snapshotShares(): Share[] {
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
            const amount = Math.floor(count / RECIPIENTS.length);
            if (amount < 1) {
                log(`Skip ${name} x${count} (not enough for 5-way split)`);
                continue;
            }
            shares.push({
                name,
                amount,
                item: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i')
            });
        }
        return shares;
    }

    await closeUi();
    log(`Split-five start @ ${pos().x},${pos().z}`);
    if (pos().z > 3280 || pos().x < 3060) {
        await walkNear(3015, 3275, 8);
        await walkNear(3075, 3260, 8);
    }
    if (!(await walkNear(DRAYNOR_BANK.x, DRAYNOR_BANK.z, 3))) {
        throw new Error(`Did not reach Draynor @ ${pos().x},${pos().z}`);
    }

    const shares = snapshotShares();
    log(`Share per Jacklove: ${shares.map((s) => `${s.name}x${s.amount}`).join(', ') || '(nothing)'}`);
    if (shares.length === 0) throw new Error('Nothing to split');

    for (const name of RECIPIENTS) {
        log(`Waiting for ${name}`);
        const arrived = await sdk
            .waitForCondition(
                (s) => s.nearbyPlayers.some((p) => new RegExp(`^${name}$`, 'i').test(p.name) && p.distance <= 12),
                600_000
            )
            .catch(() => null);
        if (!arrived) {
            log(`${name} never arrived`);
            continue;
        }
        log(`Trading ${name}`);
        const traded = await bot.trade(name, {
            give: shares.map((s) => ({ item: s.item, amount: s.amount })),
            retryOnBusy: true,
            requestTimeout: 180_000,
            timeout: 120_000
        });
        log(
            `Trade ${name}: ${traded.success ? 'ok' : traded.message} ` +
                `gave=${traded.gave?.map((g) => `${g.name}x${g.count}`).join(',') ?? 'none'}`
        );
        await sdk.waitForTicks(2);
    }

    log(
        `Split done leftover=${sdk
            .getInventory()
            .filter((i) => (i.count ?? 0) > 0)
            .map((i) => `${i.name}x${i.count}`)
            .join(', ')}`
    );
});
