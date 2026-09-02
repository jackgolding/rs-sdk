/**
 * Open the nearest bank and print its contents.
 *
 *   bun bots/quests/print-bank.ts fatpig
 */
import { runScript } from '../../sdk/runner';
import { CATHERBY_BANK, ARDOUGNE_BANK } from './tiles';
import { playerPos, walkNear } from './movement';

const botName = process.argv.slice(2).find((a) => !a.startsWith('-')) ?? '';
if (!botName) throw new Error('Usage: bun bots/quests/print-bank.ts {name}');

await runScript(async ({ bot, sdk }) => {
    if (sdk.getTradeState().isOpen) await bot.declineTrade().catch(() => {});
    await sdk.sendCloseModal().catch(() => {});

    const usableBooth = () =>
        (sdk.getNearbyLocs() ?? [])
            .filter((l) => /bank booth/i.test(l.name) && (l.optionsWithIndex?.length ?? 0) > 0)
            .sort((a, b) => (a.distance ?? 99) - (b.distance ?? 99))[0];

    const p = playerPos(sdk);
    const already = usableBooth();
    if (already && (already.distance ?? 99) <= 3) {
        console.log(`Booth in range ${already.x},${already.z} d=${already.distance}`);
    } else {
        const catherby = Math.hypot(p.x - CATHERBY_BANK.x, p.z - CATHERBY_BANK.z);
        const ardy = Math.hypot(p.x - ARDOUGNE_BANK.x, p.z - ARDOUGNE_BANK.z);
        const dest = catherby <= ardy ? { x: 2809, z: 3441 } : ARDOUGNE_BANK;
        if (catherby <= ardy && p.z < 3440) {
            console.log(`North of booths from ${p.x},${p.z}`);
            await walkNear(bot, sdk, 2816, 3443, 3);
        }
        if (Math.min(catherby, ardy) > 6) {
            console.log(`Walking to bank from ${p.x},${p.z}`);
            await walkNear(bot, sdk, dest.x, dest.z, 3);
        }
    }

    const opened = await bot.openBank(8_000);
    if (!opened.success && !sdk.getState()?.bank?.isOpen) {
        const booth = usableBooth();
        if (booth) {
            console.log(`openBank missed — clicking ${booth.name} @ ${booth.x},${booth.z}`);
            await bot.interactLoc(booth, /use.quickly|bank/i);
            await sdk.waitForCondition((s) => s.bank?.isOpen === true, 6_000).catch(() => {});
        }
    }
    if (!sdk.getState()?.bank?.isOpen) {
        console.log(`Bank open failed: ${opened.message}`);
        return;
    }
    await sdk.waitForTicks(1);
    const items = sdk
        .getBankItems()
        .filter((i) => (i.count ?? 0) > 0)
        .sort((a, b) => (b.count ?? 0) - (a.count ?? 0));
    const coins = items.find((i) => /^coins?$/i.test(i.name));
    const loc = playerPos(sdk);
    console.log(`BANK ${botName} @ ${loc.x},${loc.z}`);
    console.log(`gold: ${(coins?.count ?? 0).toLocaleString()}`);
    for (const i of items) {
        if (/^coins?$/i.test(i.name)) continue;
        console.log(`${(i.count ?? 0).toLocaleString()} ${i.name}`);
    }
    await bot.closeBank();
});
