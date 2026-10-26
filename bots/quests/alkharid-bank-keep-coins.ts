/**
 * Walk to Al Kharid bank, deposit everything except coins (and bronze pickaxe),
 * then pay the toll back west into Lumbridge.
 *
 *   bun bots/quests/alkharid-bank-keep-coins.ts jacklove1
 */
import { appendFileSync } from 'fs';
import { join } from 'path';
import { runScript } from '../../sdk/runner';
import { crossAlKharidToll } from './alkharid-toll';

const botName = process.argv.slice(2).find((a) => !a.startsWith('-')) ?? '';
const GRIND_LOG = join(process.cwd(), 'bots', botName, 'grind.log');

const ALKHARID_BANK = { x: 3269, z: 3167 };
const COW_GATE = { x: 3253, z: 3266 };
const KEEP = /^(coins|bronze pickaxe)$/i;
const COINS = /^coins$/i;

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
    const distTo = (x: number, z: number) => {
        const p = pos();
        return Math.hypot(p.x - x, p.z - z);
    };
    const count = (pattern: RegExp) =>
        sdk.getInventory().filter((i) => pattern.test(i.name)).reduce((n, i) => n + (i.count ?? 1), 0);

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

    const inAlKharid = () => {
        const p = pos();
        if (p.x >= 3268 && p.x < 3360 && p.z >= 3130 && p.z <= 3226) return true;
        if (p.x >= 3274 && p.x < 3360 && p.z >= 3227 && p.z <= 3235) return true;
        return false;
    };

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

    await closeUi();
    log(`Al Kharid bank-keep-coins start @ ${pos().x},${pos().z} gp=${count(COINS)}`);

    if (pos().z > 3268) {
        await walkNear(COW_GATE.x, COW_GATE.z, 2);
    }
    if (pos().x < 3272 && !(await crossToll(true))) {
        throw new Error('Could not enter Al Kharid');
    }
    await walkNear(ALKHARID_BANK.x, ALKHARID_BANK.z, 3);
    if (!(sdk.getState()?.bank?.isOpen || (await bot.openBank()).success)) {
        throw new Error('Al Kharid bank open failed');
    }
    for (let i = 0; i < 28; i++) {
        const junk = sdk.getInventory().find((it) => (it.count ?? 0) > 0 && !KEEP.test(it.name));
        if (!junk) break;
        await bot.depositItem(junk, -1);
    }
    await bot.closeBank();
    log(
        `Banked Al Kharid | kept ${sdk
            .getInventory()
            .filter((i) => (i.count ?? 0) > 0)
            .map((i) => `${i.name}x${i.count}`)
            .join(', ') || 'nothing'} gp=${count(COINS)}`
    );

    if (!(await crossToll(false))) {
        throw new Error('Could not leave Al Kharid');
    }
    log(`Back in Lumbridge @ ${pos().x},${pos().z}`);
});
