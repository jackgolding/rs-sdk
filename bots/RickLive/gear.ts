import { runScript } from '../../sdk/runner';

// RickLive god-mode loadout: grant + equip a flashy set.
const ITEMS = [
    'dragon_med_helm',
    'dragon_chain',
    'dragon_platelegs',
    'dragon_shield',
    'dragon_longsword',
    'amulet_of_glory',
];

await runScript(async ({ sdk, bot }: any) => {
    for (const item of ITEMS) {
        await sdk.say(`::give ${item} 1`);
        await sdk.waitForTicks(2).catch(() => {});
    }

    for (const item of ITEMS) {
        const pattern = new RegExp(item.replace(/_/g, ' '), 'i');
        const res = await bot.equipItem(pattern).catch((e: any) => ({ success: false, message: String(e) }));
        console.log(`${item}: ${res?.success ? 'equipped' : 'FAILED - ' + (res?.message ?? '?')}`);
    }

    const st: any = sdk.getState();
    const eq = (st?.equipment ?? []).map((e: any) => e.name).join(', ');
    const inv = (st?.inventory ?? []).map((e: any) => `${e.name}x${e.count}`).join(', ');
    console.log(`EQUIPPED: ${eq}`);
    console.log(`INV: ${inv}`);
}, { timeout: 120_000 });
