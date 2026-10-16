import { runScript } from '../../sdk/runner';

// RickLive god-mode loadout, part 2: body/shield/weapon (dragon sword is quest-gated) + heal.
const ITEMS = ['rune_platebody', 'rune_kiteshield', 'rune_scimitar'];

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

    // Top up health (setstat sets base+current level).
    await sdk.say('::setstat hitpoints 99');
    await sdk.waitForTicks(3).catch(() => {});

    const st: any = sdk.getState();
    console.log(`HP: ${st?.player?.hp}/${st?.player?.maxHp}`);
    console.log(`EQUIPPED: ${(st?.equipment ?? []).map((e: any) => e.name).join(', ')}`);
}, { timeout: 120_000 });
