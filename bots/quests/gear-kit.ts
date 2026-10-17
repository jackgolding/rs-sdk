/**
 * Dragon-kit staging one-shot: walk to a fleet bank, then for EACH --item=
 * ensure one is worn (already-worn skip, inventory equip, else bank
 * withdraw + equip + verify). Ends holding DONE at the bank for the
 * operator. Quest/stock shortfalls park as DONE lines (no crash loop) so
 * the operator can sort them at the bank:
 *
 *   bun bots/quests/gear-kit.ts ABGARMY09 --bank=varrock-east \
 *     --item='Dragon longsword' --item='Dragonfire shield' \
 *     --item='Dragon vambraces' --item='Dragonhide chaps'
 *
 * Restarts are no-ops per item: worn items are skipped, inventory items are
 * equipped without touching the bank. Leave staged until switched back.
 */
import { join } from 'path';
import { runScript } from '../../sdk/runner';
import { appendGrindLog } from '../../sdk/grind-log';
import { inWilderness, type BotSDK } from '../../sdk/index';
import { FLEET_BANKS } from './tiles';
import { closeUi, leaveEdgevilleWilderness, playerPos, walkNear } from './movement';

const positional: string[] = [];
const items: string[] = [];
let bankFlag = 'varrock-east';
for (const a of process.argv.slice(2)) {
    if (a.startsWith('--item=')) items.push(a.slice('--item='.length));
    else if (a.startsWith('--bank=')) bankFlag = a.slice('--bank='.length);
    else if (!a.startsWith('--')) positional.push(a);
}

function canon(name: string): string {
    if (/^abgarmy\d+$/i.test(name)) return name.toUpperCase();
    return name;
}

const botName = canon(positional[0] ?? '');
const KIT = items.length > 0 ? items : ['Dragon longsword', 'Dragonfire shield', 'Dragon vambraces', 'Dragonhide chaps'];
const bankRaw = bankFlag.toLowerCase().replace(/[_\s]+/g, '-').replace(/-bank$/, '');
const MEET_BANK = FLEET_BANKS.find((b) => b.name.toLowerCase().replace(/\s+/g, '-') === bankRaw) ?? null;
if (!MEET_BANK) {
    throw new Error(
        `Unknown --bank=${bankFlag}: valid: ${FLEET_BANKS.map((b) => b.name.toLowerCase().replace(/\s+/g, '-')).join(', ')}`
    );
}
const GRIND_LOG = join(process.cwd(), 'bots', botName, 'grind.log');

if (!botName) {
    throw new Error("Usage: bun bots/quests/gear-kit.ts {name} --bank=NAME --item=NAME [--item=NAME ...]");
}

const esc = (s: string): RegExp => new RegExp(`^${s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i');

function equippedCount(sdk: BotSDK, rx: RegExp): number {
    return sdk
        .getEquipment()
        .filter((i) => rx.test(i.name))
        .reduce((n, i) => n + (i.count ?? 1), 0);
}

function invCount(sdk: BotSDK, rx: RegExp): number {
    return sdk.getInventory().filter((i) => rx.test(i.name)).reduce((n, i) => n + (i.count ?? 0), 0);
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
    const start = playerPos(sdk);
    if (inWilderness(start.x, start.z)) {
        log('LOG', `Leaving wilderness from ${start.x},${start.z} before banking`);
        await leaveEdgevilleWilderness(sdk).catch((e) => log('WARN', `wildy exit: ${e instanceof Error ? e.message : String(e)}`));
    }
    await walkNear(bot, sdk, MEET_BANK.x, MEET_BANK.z, 6);

    const worn: string[] = [];
    const short: string[] = [];
    for (const itemLabel of KIT) {
        const rx = esc(itemLabel);
        if (equippedCount(sdk, rx) >= 1) {
            log('LOG', `Kit ${itemLabel}: already worn — skip`);
            worn.push(itemLabel);
            continue;
        }
        if (invCount(sdk, rx) < 1) {
            if (!(sdk.isBankOpen() || (await bot.openBank()).success)) {
                throw new Error(`Bank did not open at ${MEET_BANK.name} (needed ${itemLabel})`);
            }
            const bankStock: number = sdk
                .getBankItems()
                .filter((i) => rx.test(i.name))
                .reduce((n, i) => n + (i.count ?? 0), 0);
            if (bankStock < 1) {
                await closeUi(bot, sdk);
                log('LOG', `Kit ${itemLabel}: short bank=${bankStock} inv=0 — operator sort`);
                short.push(`${itemLabel} (no stock)`);
                continue;
            }
            const w = await bot.withdrawItem(rx, 1);
            if (!w.success && !w.partial) throw new Error(`Withdraw 1 ${itemLabel} failed: ${w.message}`);
            log('LOG', `Withdrew ${itemLabel} inv=${invCount(sdk, rx)} (${w.message})`);
            await closeUi(bot, sdk);
        }
        const target = sdk.findInventoryItem(rx);
        if (!target) {
            log('LOG', `Kit ${itemLabel}: not in inventory after withdraw — operator sort`);
            short.push(`${itemLabel} (not in inv)`);
            continue;
        }
        const eq = await bot.equipItem(rx);
        if (!eq.success) {
            log('LOG', `Kit ${itemLabel}: CANNOT-WIELD ${eq.message} — needs quest/level, operator sort`);
            short.push(`${itemLabel} (cannot wield)`);
            continue;
        }
        await sdk.waitForTicks(1);
        if (equippedCount(sdk, rx) < 1) {
            throw new Error(`Equip ${itemLabel} UNVERIFIED: nothing matching in equipment — holding, operator check needed`);
        }
        log('LOG', `Kit ${itemLabel}: wearing now`);
        worn.push(itemLabel);
    }
    if (sdk.isBankOpen()) await closeUi(bot, sdk);
    const at = playerPos(sdk);
    const summary = `kit bank=${MEET_BANK.name} @ ${at.x},${at.z} worn=[${worn.join('|') || 'none'}]${short.length > 0 ? ` SHORT=[${short.join('|')}]` : ''}`;
    return idleDone(summary);
});
