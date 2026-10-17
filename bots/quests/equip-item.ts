/**
 * Equip-kit one-shot: withdraw an item from a fleet bank and wield/wear it,
 * verify it is equipped, then hold DONE for the operator to switch back.
 *
 *   bun bots/quests/equip-item.ts ABGARMY03 --item='Fire battlestaff' --bank=falador-east
 *
 * Flags:
 *   --item=NAME    what to equip (default 'Fire battlestaff')
 *   --count=N      how many to hold equipped/inventory (default 1)
 *   --bank=NAME    which fleet bank (default 'catherby'; e.g. falador-east,
 *                  falador-west, draynor, seers, ardougne, yanille,
 *                  varrock-east, varrock-west, al-kharid, lumbridge, edgeville)
 *
 * Restarts are no-ops: an already-equipped bot logs DONE without touching
 * the bank. Switch back to the grind once every DONE is in.
 */
import { join } from 'path';
import { runScript } from '../../sdk/runner';
import { appendGrindLog } from '../../sdk/grind-log';
import { FLEET_BANKS } from './tiles';
import { closeUi, playerPos, walkNear } from './movement';

const positional: string[] = [];
const flags = new Map<string, string>();
for (const a of process.argv.slice(2)) {
    if (a.startsWith('--')) {
        const eq = a.indexOf('=');
        if (eq === -1) flags.set(a.slice(2), 'true');
        else flags.set(a.slice(2, eq), a.slice(eq + 1));
    } else positional.push(a);
}

function canon(name: string): string {
    if (/^abgarmy\d+$/i.test(name)) return name.toUpperCase();
    return name;
}

const botName = canon(positional[0] ?? '');
const itemLabel = flags.get('item') ?? 'Fire battlestaff';
const ITEM = new RegExp(`^${itemLabel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i');
const count = Math.max(1, parseInt(flags.get('count') ?? '1', 10) || 1);
const bankRaw = (flags.get('bank') ?? 'catherby').toLowerCase().replace(/[_\s]+/g, '-').replace(/-bank$/, '');
const MEET_BANK =
    FLEET_BANKS.find((b) => b.name.toLowerCase().replace(/\s+/g, '-') === bankRaw) ?? null;
if (!MEET_BANK) {
    throw new Error(
        `Unknown --bank=${flags.get('bank')!}: valid: ${FLEET_BANKS.map((b) => b.name.toLowerCase().replace(/\s+/g, '-')).join(', ')}`
    );
}
const GRIND_LOG = join(process.cwd(), 'bots', botName, 'grind.log');

if (!botName) {
    throw new Error(
        "Usage: bun bots/quests/equip-item.ts {name} [--item=NAME] [--count=N] [--bank=NAME]"
    );
}

function equippedCount(sdk: import('../../sdk/index').BotSDK): number {
    return sdk
        .getEquipment()
        .filter((i) => ITEM.test(i.name))
        .reduce((n, i) => n + (i.count ?? 1), 0);
}

function invCount(sdk: import('../../sdk/index').BotSDK): number {
    return sdk.getInventory().filter((i) => ITEM.test(i.name)).reduce((n, i) => n + (i.count ?? 0), 0);
}

await runScript(async ({ bot, sdk }) => {
    const log = (level: 'LOG' | 'WARN' | 'ERROR', msg: string) => {
        console.log(`${level} ${msg}`);
        appendGrindLog(GRIND_LOG, `${new Date().toISOString()} ${level} ${msg}`);
    };

    async function idleDone(msg: string): Promise<never> {
        log('LOG', `DONE ${msg}`);
        for (;;) {
            await sdk.waitForTicks(600).catch(() => {});
            log('LOG', `DONE holding: ${msg}`);
        }
        throw new Error('unreachable');
    }

    await closeUi(bot, sdk);
    await walkNear(bot, sdk, MEET_BANK.x, MEET_BANK.z, 6);

    if (equippedCount(sdk) >= 1) {
        return idleDone(`already wearing ${itemLabel} bank=${MEET_BANK.name} — nothing to do`);
    }

    if (!(sdk.isBankOpen() || (await bot.openBank()).success)) {
        throw new Error(`Bank did not open at ${MEET_BANK.name}`);
    }
    const bankStock: number = sdk
        .getBankItems()
        .filter((i) => ITEM.test(i.name))
        .reduce((n, i) => n + (i.count ?? 0), 0);
    if (bankStock < count && invCount(sdk) < count) {
        await closeUi(bot, sdk);
        return idleDone(`short ${itemLabel}: bank=${bankStock} inv=${invCount(sdk)} need=${count} — stock first`);
    }
    const need = Math.max(0, count - invCount(sdk));
    if (need > 0) {
        const w = await bot.withdrawItem(ITEM, need);
        if (!w.success && !w.partial) throw new Error(`Withdraw ${need} ${itemLabel} failed: ${w.message}`);
        log('LOG', `Withdrew ${itemLabel} inv=${invCount(sdk)} (${w.message})`);
    }
    await closeUi(bot, sdk);

    const target = sdk.findInventoryItem(ITEM);
    if (!target) throw new Error(`${itemLabel} not in inventory after withdraw — holding, operator check needed`);
    const eq = await bot.equipItem(ITEM);
    if (!eq.success) throw new Error(`Equip ${itemLabel} failed: ${eq.message}`);
    await sdk.waitForTicks(1);
    if (equippedCount(sdk) < 1) {
        throw new Error(`Equip ${itemLabel} UNVERIFIED: nothing matching in equipment — holding, operator check needed`);
    }
    if (sdk.isBankOpen()) await closeUi(bot, sdk);
    return idleDone(`wearing ${itemLabel} bank=${MEET_BANK.name} @ ${playerPos(sdk).x},${playerPos(sdk).z}`);
});
