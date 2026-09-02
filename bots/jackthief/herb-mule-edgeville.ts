/**
 * Edgeville bank mule: pay each jacklove a dragon longsword, dragon dagger,
 * and 1000 essence for their herb haul.
 *
 *   bun bots/jackthief/herb-mule-edgeville.ts
 */
import { appendFileSync } from 'fs';
import { dirname, join } from 'path';
import { runScript } from '../../sdk/runner';

const GRIND_LOG = join(dirname(import.meta.path), 'grind.log');
const EDGEVILLE_BANK = { x: 3094, z: 3491 };
const LOVES = /^jacklove[1-5]$/i;
const DLONG = /^dragon longsword$/i;
const DDAGGER = /^dragon dagger/i;
const ESSENCE = /^(pure essence|rune essence)$/i;
const HERB =
    /^(herb|guam leaf|marrentill|tarromin|harralander|ranarr weed|toadflax|irit leaf|avantoe|kwuarm|cadantine|lantadyme|dwarf weed|torstol|.+ (leaf|weed))$/i;

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
    const countInv = (pattern: RegExp) =>
        sdk.getInventory().filter((i) => pattern.test(i.name)).reduce((n, i) => n + (i.count ?? 1), 0);

    async function closeUi(): Promise<void> {
        await bot.dismissBlockingUI();
        if (sdk.getState()?.shop?.isOpen) await bot.closeShop();
        if (sdk.getState()?.bank?.isOpen) await bot.closeBank();
        if (sdk.getState()?.interface?.isOpen) await bot.closeInterface();
    }

    async function openBank(): Promise<boolean> {
        if (sdk.getState()?.bank?.isOpen) return true;
        const walk = await bot.walkTo(EDGEVILLE_BANK.x, EDGEVILLE_BANK.z, 3);
        if (!walk.success) log(`walkTo bank: ${walk.message} @ ${pos().x},${pos().z}`);
        const opened = await bot.openBank();
        if (!opened.success) {
            log(`openBank failed: ${opened.message} @ ${pos().x},${pos().z}`);
            return false;
        }
        return true;
    }

    async function depositAll(): Promise<void> {
        for (let i = 0; i < 40; i++) {
            const item = sdk.getInventory().find((it) => (it.count ?? 0) > 0);
            if (!item) break;
            const r = await bot.depositItem(item, -1);
            log(`Deposit ${item.name}: ${r.success || r.partial ? 'ok' : r.message}`);
            if (!r.success && !r.partial) break;
        }
    }

    await closeUi();
    log(`Herb mule start @ ${pos().x},${pos().z}`);
    if (!(await openBank())) throw new Error('Could not open Edgeville bank');
    await depositAll();

    const bankDlong = sdk.findBankItem(DLONG)?.count ?? 0;
    const bankDagger = sdk.findBankItem(DDAGGER)?.count ?? 0;
    const bankEss = sdk.findBankItem(ESSENCE)?.count ?? 0;
    log(`Bank kits dlong=${bankDlong} dagger=${bankDagger} essence=${bankEss}`);
    if (bankDlong < 5 || bankDagger < 5 || bankEss < 5000) {
        await bot.closeBank();
        throw new Error(`Need 5 dlong, 5 dagger, 5000 essence (have ${bankDlong}/${bankDagger}/${bankEss})`);
    }
    await bot.closeBank();

    for (let n = 1; n <= 5; n++) {
        if (!(await openBank())) throw new Error(`Bank closed before kit ${n}`);
        await depositAll();
        const leftover = sdk.getInventory().filter((i) => (i.count ?? 0) > 0);
        if (leftover.length) log(`Inv not empty after deposit: ${leftover.map((i) => `${i.count} ${i.name}`).join(', ')}`);
        // Essence first while inv is empty so a 1000-stack (or notes) can land.
        let w3 = await bot.withdrawItem(ESSENCE, 1000, { asNote: false });
        if (countInv(ESSENCE) < 1000) {
            log(`Unnoted essence only ${countInv(ESSENCE)} — depositing and withdrawing notes`);
            const ess = sdk.findInventoryItem(ESSENCE);
            if (ess) await bot.depositItem(ess, -1);
            w3 = await bot.withdrawItem(ESSENCE, 1000, { asNote: true });
        }
        const w1 = await bot.withdrawItem(DLONG, 1);
        const w2 = await bot.withdrawItem(DDAGGER, 1);
        log(
            `Kit ${n}/5 withdraw dlong=${w1.success || w1.partial} dagger=${w2.success || w2.partial} ess=${w3.success || w3.partial} ` +
                `inv dlong=${countInv(DLONG)} dagger=${countInv(DDAGGER)} ess=${countInv(ESSENCE)}`
        );
        if (countInv(DLONG) < 1 || countInv(DDAGGER) < 1 || countInv(ESSENCE) < 1000) {
            await bot.closeBank();
            throw new Error(`Kit ${n} incomplete after withdraw`);
        }
        await bot.closeBank();

        const served = await bot.serveTrades({
            from: LOVES,
            give: [
                { item: DLONG, amount: 1 },
                { item: DDAGGER, amount: 1 },
                { item: ESSENCE, amount: 1000 }
            ],
            want: [{ item: HERB, amount: 1 }],
            maxTrades: 1,
            timeout: 10 * 60_000,
            tradeTimeout: 120_000
        });
        log(`Kit ${n}/5 served ${served.success ? 'ok' : served.message} (${served.reason ?? ''}) n=${served.trades.length}`);
        for (const t of served.trades) {
            log(
                `  ${t.partner ?? '?'}: ${t.success ? 'ok' : t.message} ` +
                    `gave=${t.gave.map((i) => `${i.count} ${i.name}`).join(', ') || '—'} ` +
                    `got=${t.received.map((i) => `${i.count} ${i.name}`).join(', ') || '—'}`
            );
        }
        if (!served.trades.some((t) => t.success)) {
            throw new Error(`Kit ${n} did not complete a trade`);
        }
    }

    if (await openBank()) {
        await depositAll();
        await bot.closeBank();
    }
    log('Herb mule done');
});
