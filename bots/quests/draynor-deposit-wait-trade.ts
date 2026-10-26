/**
 * Walk to Draynor bank, deposit everything (including coins / equipped items),
 * then wait to receive one trade from Jackthief.
 *
 *   bun bots/quests/draynor-deposit-wait-trade.ts jacklove1
 */
import { appendFileSync } from 'fs';
import { join } from 'path';
import { runScript } from '../../sdk/runner';
import { crossAlKharidToll } from './alkharid-toll';

const botName = process.argv.slice(2).find((a) => !a.startsWith('-')) ?? '';
const GRIND_LOG = join(process.cwd(), 'bots', botName, 'grind.log');

const COW_GATE = { x: 3253, z: 3266 };
const DRAYNOR_BANK = { x: 3092, z: 3243 };
const COINS = /^coins$/i;
const JACKTHIEF = /^Jackthief$/i;

const STANDS: Record<string, { x: number; z: number }> = {
    jacklove1: { x: 3091, z: 3245 },
    jacklove2: { x: 3094, z: 3245 },
    jacklove3: { x: 3095, z: 3242 },
    jacklove4: { x: 3091, z: 3241 },
    jacklove5: { x: 3088, z: 3243 }
};

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
    const count = (pattern: RegExp) =>
        sdk.getInventory().filter((i) => pattern.test(i.name)).reduce((n, i) => n + (i.count ?? 1), 0);
    const occupied = () => sdk.getInventory().filter((i) => (i.count ?? 0) > 0).length;

    const inAlKharid = () => {
        const p = pos();
        if (p.x >= 3268 && p.x < 3360 && p.z >= 3130 && p.z <= 3226) return true;
        if (p.x >= 3274 && p.x < 3360 && p.z >= 3227 && p.z <= 3235) return true;
        return false;
    };

    async function closeUi(): Promise<void> {
        for (let i = 0; i < 8; i++) {
            await bot.dismissBlockingUI();
            const dialog = sdk.getDialog();
            if (dialog?.isOpen) {
                const cont = dialog.options?.find((o) => /continue|click here/i.test(o.text));
                if (cont?.componentId) await sdk.sendClickComponent(cont.componentId);
                await sdk.sendClickDialog(cont?.index ?? 0);
                await sdk.waitForTicks(1).catch(() => {});
                continue;
            }
            if (sdk.getState()?.shop?.isOpen || sdk.getState()?.bank?.isOpen || sdk.getState()?.interface?.isOpen) {
                await bot.closeInterface();
                await sdk.waitForTicks(1).catch(() => {});
                continue;
            }
            break;
        }
    }

    async function walkNear(x: number, z: number, tolerance = 4): Promise<boolean> {
        if (distTo(x, z) <= tolerance) return true;
        const r = await bot.walkTo(x, z, Math.min(tolerance, 3));
        return r.success || distTo(x, z) <= tolerance + 2;
    }

    // Shared, proven crossing (alkharid-toll.ts): side by x=3268, talk to the Border
    // Guard on our side, answer "Yes, ok." by text, step off the fence tile.
    async function crossToll(wantEast: boolean): Promise<boolean> {
        await closeUi();
        const ok = await crossAlKharidToll(bot, sdk, wantEast, { log });
        log(ok ? `Toll ok @ ${pos().x},${pos().z}` : `Still ${pos().x},${pos().z} after toll`);
        return ok;
    }

    async function goDraynor(): Promise<void> {
        await closeUi();
        if (pos().x >= 3244 && pos().x <= 3264 && pos().z >= 3268 && pos().z <= 3298) {
            log(`Leaving cow pen @ ${pos().x},${pos().z}`);
            await walkNear(COW_GATE.x, COW_GATE.z, 2);
        }
        if (inAlKharid() || pos().x >= 3272) {
            log('Leaving Al Kharid via toll');
            if (!(await crossToll(false))) throw new Error('Could not leave Al Kharid');
        }
        if (pos().x > 3120) {
            if (pos().z < 3248) await walkNear(Math.min(pos().x, 3234), 3268, 6);
            await walkNear(3230, 3270, 6);
            await walkNear(3150, 3255, 6);
        }
        log(`Walking to Draynor bank from ${pos().x},${pos().z}`);
        if (!(await walkNear(DRAYNOR_BANK.x, DRAYNOR_BANK.z, 3))) {
            throw new Error(`Did not reach Draynor @ ${pos().x},${pos().z}`);
        }
    }

    await closeUi();
    log(`Draynor deposit-wait start @ ${pos().x},${pos().z} inv=${occupied()}`);
    await goDraynor();

    for (const worn of [...bot.getEquipment()]) {
        const r = await bot.unequipItem(worn);
        log(`Unequip ${worn.name}: ${r.success ? 'ok' : r.message}`);
    }

    if (!(sdk.getState()?.bank?.isOpen || (await bot.openBank()).success)) {
        throw new Error('Draynor bank open failed');
    }
    for (let i = 0; i < 40; i++) {
        const item = sdk.getInventory().find((it) => (it.count ?? 0) > 0);
        if (!item) break;
        const r = await bot.depositItem(item, -1);
        if (!r.success) {
            log(`Deposit ${item.name}: ${r.message}`);
            break;
        }
    }
    await bot.closeBank();
    log(`Banked all @ Draynor inv=${occupied()} @ ${pos().x},${pos().z}`);

    const stand = STANDS[botName] ?? DRAYNOR_BANK;
    await walkNear(stand.x, stand.z, 2);
    log(`Waiting for Jackthief trade @ ${pos().x},${pos().z}`);

    const served = await bot.serveTrades({
        from: JACKTHIEF,
        accept: (offer) => offer.length > 0,
        maxTrades: 1,
        timeout: 900_000,
        tradeTimeout: 120_000
    });
    log(
        `Received ${served.success ? 'ok' : served.message} (${served.reason ?? ''}) ` +
            `inv=${sdk
                .getInventory()
                .filter((i) => (i.count ?? 0) > 0)
                .map((i) => `${i.name}x${i.count}`)
                .join(', ') || 'empty'}`
    );
});
