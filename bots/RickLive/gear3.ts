import { runScript } from '../../sdk/runner';

await runScript(async ({ sdk, bot }: any) => {
    for (const item of ['rune_chainbody', 'dragon_chainbody', 'black_chainbody', 'iron_platebody']) {
        await sdk.say(`::give ${item} 1`);
        await sdk.waitForTicks(2).catch(() => {});
        const res = await bot.equipItem(new RegExp(item.replace(/_/g, ' '), 'i')).catch((e: any) => ({ success: false, message: String(e) }));
        console.log(`${item}: ${res?.success ? 'EQUIPPED' : 'no - ' + (res?.message ?? '?')}`);
        if (res?.success) break;
    }
    const st: any = sdk.getState();
    console.log('EQUIP: ' + (st?.equipment ?? []).map((e: any) => e.name).join(', '));
    console.log('INV: ' + (st?.inventory ?? []).map((e: any) => `${e.name}x${e.count}`).join(', '));
}, { timeout: 90_000 });
