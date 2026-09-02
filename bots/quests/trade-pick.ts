/**
 * Walk to Varrock east, note all rune essence, trade it to Fatpig for a rune pickaxe.
 *
 *   bun bots/quests/trade-pick.ts Jackpoo2
 */
import { appendFileSync } from 'fs';
import { join } from 'path';
import { inEssenceMine as inEssenceMineCoords } from '../../sdk/index';
import { runScript } from '../../sdk/runner';

const FATPIG = /^Fatpig$/i;
const VARROCK_EAST = { x: 3253, z: 3420 };
const PICKAXE = /^(bronze|iron|steel|mithril|adamant|rune) pickaxe$/i;
const RUNE_PICK = /^rune pickaxe$/i;
const ESSENCE = /^(rune essence|pure essence)$/i;

const botName = process.argv.slice(2).find((a) => !a.startsWith('-')) ?? '';
const GRIND_LOG = join(process.cwd(), 'bots', botName, 'grind.log');

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
    const inMine = () => inEssenceMineCoords(pos().x, pos().z);
    const count = (pattern: RegExp) =>
        sdk.getInventory().filter((i) => pattern.test(i.name)).reduce((n, i) => n + (i.count ?? 1), 0);

    async function closeUi() {
        const dialog = sdk.getDialog();
        if (dialog?.isOpen) {
            const cont = dialog.options?.find((o) => /continue|click here/i.test(o.text));
            if (cont) await sdk.sendClickDialog(cont.index);
            else await sdk.sendClickDialog(0);
            await sdk.waitForTicks(1);
        }
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

    async function leaveMine(): Promise<void> {
        if (!inMine()) return;
        log('Leaving essence mine');
        for (let i = 0; i < 10 && inMine(); i++) {
            await closeUi();
            await sdk.scanNearbyLocs(12).catch(() => {});
            const portal =
                sdk.findNearbyLoc(/^portal$/i) ?? sdk.findNearbyLoc(/portal/i);
            if (!portal) {
                const p = pos();
                await walkNear(p.x + 12, p.z, 3);
                continue;
            }
            await bot.interactLoc(portal, /use|enter|climb/i);
            await sdk.waitForCondition(() => !inMine(), 10_000).catch(() => {});
        }
        if (inMine()) throw new Error(`Still in essence mine @ ${pos().x},${pos().z}`);
    }

    await closeUi();
    log(`Trade-pick start @ ${pos().x},${pos().z} runePick=${count(RUNE_PICK)} essence=${count(ESSENCE)}`);
    if (count(RUNE_PICK) > 0) {
        log('Already have a rune pickaxe');
        return;
    }

    await leaveMine();
    await closeUi();
    log('Banking at Varrock east');
    if (distTo(VARROCK_EAST.x, VARROCK_EAST.z) > 3) {
        await walkNear(VARROCK_EAST.x, VARROCK_EAST.z, 3);
    }
    if (!(sdk.getState()?.bank?.isOpen || (await bot.openBank()).success)) {
        throw new Error('Could not open Varrock east bank');
    }
    if (count(ESSENCE) > 0) await bot.depositItem(ESSENCE, -1);
    for (;;) {
        const junk = sdk.getInventory().find((i) => (i.count ?? 0) > 0 && !PICKAXE.test(i.name) && !ESSENCE.test(i.name));
        if (!junk) break;
        const r = await bot.depositItem(junk, -1);
        if (!r.success) break;
    }
    const bankEss = sdk.findBankItem(ESSENCE);
    if (bankEss && bankEss.count > 0) {
        const noted = await bot.withdrawItem(bankEss, -1, { asNote: true });
        log(`Noted essence: ${noted.success ? 'ok' : noted.message} inv=${count(ESSENCE)}`);
    } else {
        log('No essence in bank to note');
    }
    await bot.closeBank();

    if (distTo(VARROCK_EAST.x, VARROCK_EAST.z) > 4) {
        await walkNear(VARROCK_EAST.x, VARROCK_EAST.z, 3);
    }
    log(`Serving Fatpig trade essence=${count(ESSENCE)}`);
    const served = await bot.serveTrades({
        from: FATPIG,
        give: count(ESSENCE) > 0 ? [{ item: ESSENCE, amount: -1 }] : [],
        want: [{ item: RUNE_PICK, amount: 1 }],
        maxTrades: 1,
        timeout: 180_000,
        tradeTimeout: 120_000
    });
    log(`Serve ${served.success ? 'ok' : served.message} (${served.reason ?? ''}) runePick=${count(RUNE_PICK)}`);
    if (count(RUNE_PICK) < 1) {
        throw new Error(`Did not receive rune pickaxe: ${served.message}`);
    }
    const inv = sdk.findInventoryItem(RUNE_PICK);
    if (inv) await bot.equipItem(inv);
});
