import { appendFileSync } from 'fs';
import { join } from 'path';
import { runScript } from '../../sdk/runner';

const PARTNER = /^Jackpoo3$/i;
const ARDY_BANK = { x: 2655, z: 3283 };
const CATHERBY_TO_ARDY = [
    { x: 2808, z: 3443 },
    { x: 2788, z: 3460 },
    { x: 2758, z: 3477 },
    { x: 2726, z: 3485 },
    { x: 2695, z: 3375 },
    { x: 2662, z: 3375 },
    { x: 2662, z: 3336 },
    { x: 2662, z: 3312 }
];
const SWORD = /^swordfish$/i;
const LOBSTER = /^lobster$/i;
const GRIND_LOG = join(import.meta.dir, 'grind.log');

await runScript(async ({ bot, sdk }) => {
    const log = (msg: string) => {
        console.log(msg);
        try {
            appendFileSync(GRIND_LOG, `${new Date().toISOString()} ${msg}\n`);
        } catch {
            /* ignore */
        }
    };
    const pos = () => {
        const p = sdk.getState()?.player;
        return { x: p?.worldX ?? 0, z: p?.worldZ ?? 0 };
    };
    const distTo = (x: number, z: number) => Math.hypot(pos().x - x, pos().z - z);

    async function walkNear(x: number, z: number, tol = 4) {
        if (distTo(x, z) <= tol) return true;
        const r = await bot.walkTo(x, z, Math.min(tol, 3));
        return r.success || distTo(x, z) <= tol + 2;
    }

    async function walkToArdy() {
        for (const wp of CATHERBY_TO_ARDY) {
            if (distTo(ARDY_BANK.x, ARDY_BANK.z) <= 10) break;
            await walkNear(wp.x, wp.z, 8);
        }
        await walkNear(ARDY_BANK.x, ARDY_BANK.z, 3);
    }

    async function depositAll() {
        for (let i = 0; i < 40; i++) {
            const item = sdk.getInventory().find((it) => (it.count ?? 0) > 0);
            if (!item) break;
            await bot.depositItem(item, -1);
        }
    }

    log(`Trade-food start @ ${pos().x},${pos().z}`);
    await bot.dismissBlockingUI();
    await walkToArdy();

    const opened = await bot.openBank();
    if (!opened.success && !sdk.getState()?.bank?.isOpen) {
        throw new Error(`Ardy bank open failed: ${opened.message}`);
    }
    await depositAll();

    const swordTotal = sdk.findBankItem(SWORD)?.count ?? 0;
    const lobTotal = sdk.findBankItem(LOBSTER)?.count ?? 0;
    const tradeSword = Math.floor(swordTotal / 2);
    const tradeLob = Math.floor(lobTotal / 2);
    log(
        `Bank counts swordfish=${swordTotal} lobster=${lobTotal} → trade ${tradeSword} swordfish + ${tradeLob} lobster (noted)`
    );

    if (tradeSword > 0) {
        const r = await bot.withdrawItem(SWORD, tradeSword, { asNote: true });
        log(`Withdraw noted swordfish x${tradeSword}: ${r.success ? 'ok' : r.message}`);
    }
    if (tradeLob > 0) {
        const r = await bot.withdrawItem(LOBSTER, tradeLob, { asNote: true });
        log(`Withdraw noted lobster x${tradeLob}: ${r.success ? 'ok' : r.message}`);
    }
    await bot.closeBank();

    const give = [
        ...(tradeSword > 0 ? [{ item: SWORD, amount: tradeSword }] : []),
        ...(tradeLob > 0 ? [{ item: LOBSTER, amount: tradeLob }] : [])
    ];
    if (give.length === 0) throw new Error('Nothing to trade');

    let traded = false;
    for (let attempt = 1; !traded && attempt <= 30; attempt++) {
        await walkNear(ARDY_BANK.x, ARDY_BANK.z, 4);
        const partner = sdk.findNearbyPlayer(PARTNER);
        if (!partner) {
            log(`Waiting for Jackpoo3 (${attempt})`);
            await sdk.waitForTicks(5);
            continue;
        }
        const r = await bot.trade(partner, {
            give,
            want: [],
            retryOnBusy: true,
            requestTimeout: 60_000,
            timeout: 120_000
        });
        log(`Trade Jackpoo3: ${r.success ? 'ok' : r.message}`);
        traded = r.success;
    }
    if (!traded) throw new Error('Trade to Jackpoo3 failed');
    log(`Trade done @ ${pos().x},${pos().z} — starting heroes thieving next`);
});
