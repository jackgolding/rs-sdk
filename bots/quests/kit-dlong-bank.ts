/**
 * One-shot kit job: at Edgeville bank, unequip everything worn, deposit
 * the whole pack except the rune pickaxe (coins included — wildy-safe),
 * withdraw a dragon longsword and wear it.
 *
 *   bun bots/quests/kit-dlong-bank.ts jackthief
 *
 * Idempotent: when the dlong is already worn and the pack holds only the
 * pick, it logs KIT-DONE and returns (restarts no-op — switch forward
 * promptly anyway).
 */
import { appendFileSync } from 'fs';
import { join } from 'path';
import { runScript } from '../../sdk/runner';

const botName = process.argv.slice(2).find((a) => !a.startsWith('-')) ?? '';
const GRIND_LOG = join(process.cwd(), 'bots', botName, 'grind.log');

const EDGEVILLE_BANK = { x: 3094, z: 3492 };
const PICK = /^(bronze|iron|steel|mithril|adamant|rune) pickaxe$/i;
const DLONG = /^dragon longsword$/i;

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
    const dist = (x: number, z: number) => {
        const p = pos();
        return Math.hypot(p.x - x, p.z - z);
    };
    const worn = () => (sdk.getEquipment() ?? []).filter((e) => (e.count ?? 0) > 0);
    const pack = () => sdk.getInventory().filter((i) => (i.count ?? 0) > 0);

    const kitDone =
        worn().length === 1 &&
        DLONG.test(worn()[0]!.name) &&
        pack().every((i) => PICK.test(i.name));
    const p0 = pos();
    log(`kit-dlong start @ ${p0.x},${p0.z} worn=[${worn().map((e) => e.name).join(',')}] pack=[${pack().map((i) => `${i.name}x${i.count}`).join(',')}]`);
    if (kitDone) {
        log('KIT-DONE: dlong worn, pack holds only the pick');
        return;
    }

    if (dist(EDGEVILLE_BANK.x, EDGEVILLE_BANK.z) > 4) {
        log('Walking to Edgeville bank');
        const w = await bot.walkTo(EDGEVILLE_BANK.x, EDGEVILLE_BANK.z, 3);
        if (!w.success && dist(EDGEVILLE_BANK.x, EDGEVILLE_BANK.z) > 6) {
            log(`KIT stuck: ${w.message}`);
            return;
        }
    }
    const opened = await bot.openBank();
    if (!opened.success && !sdk.getState()?.bank?.isOpen) {
        log(`KIT stuck: bank did not open: ${opened.message}`);
        return;
    }

    // Unequip everything worn.
    for (let i = 0; i < 12 && worn().length > 0; i++) {
        const item = worn()[0]!;
        const r = await bot.unequipItem(new RegExp(`^${item.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i'));
        if (!r.success) {
            log(`unequip ${item.name}: ${r.message}`);
            break;
        }
    }
    await sdk.waitForTicks(2).catch(() => undefined);

    // Deposit the whole pack except the pick (coins too — wildy-safe).
    for (const item of pack()) {
        if (PICK.test(item.name)) continue;
        await bot.depositItem(new RegExp(`^${item.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i'), -1);
    }

    // Withdraw + wear the dragon longsword.
    if (!sdk.findEquipmentItem(DLONG)) {
        const banked = (sdk.getBankItems?.() ?? []).find((b) => DLONG.test(b.name));
        if (!banked) {
            log('KIT stuck: no dragon longsword in bank');
        } else {
            const w = await bot.withdrawItem(banked, 1, { asNote: false });
            log(`withdraw dlong: ${w.success ? 'ok' : w.message}`);
            const inv = sdk.findInventoryItem(DLONG);
            if (inv) {
                const e = await bot.equipItem(inv);
                log(`wear dlong: ${e.success ? 'ok' : e.message}`);
            }
        }
    }
    await bot.closeBank().catch(() => undefined);
    const done =
        worn().length === 1 &&
        DLONG.test(worn()[0]!.name) &&
        pack().every((i) => PICK.test(i.name));
    log(
        `KIT-${done ? 'DONE' : 'STUCK'} worn=[${worn().map((e) => e.name).join(',')}] pack=[${pack().map((i) => `${i.name}x${i.count}`).join(',')}]`
    );
});
