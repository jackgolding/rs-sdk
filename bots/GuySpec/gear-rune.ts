import { runScript } from '../../sdk/runner';

async function cheat(sdk: any, cmd: string) {
    await sdk.say(cmd);
    await sdk.waitForTicks(3).catch(() => {});
}

await runScript(async ({ sdk }: any) => {
    // Fresh loadout: wipe backpack (worn gear untouched)
    await cheat(sdk, '~clearinv');

    // Re-apply pure stats in case the earlier pass was cut short
    const stats: [string, number][] = [
        ['attack', 40], ['defence', 1], ['strength', 99], ['hitpoints', 99],
        ['ranged', 99], ['prayer', 1], ['magic', 99],
    ];
    for (const [s, l] of stats) {
        await cheat(sdk, `::setstat ${s} ${l}`);
    }

    // Pure kit + full rune + r2h
    const gives: [string, number][] = [
        ['rune_scimitar', 1], ['oak_shortbow', 1], ['iron_arrow', 300],
        ['staff_of_air', 1], ['airrune', 300], ['chaosrune', 200], ['deathrune', 100],
        ['amulet_of_strength', 1], ['monkrobetop', 1], ['monkrobebottom', 1],
        ['coif', 1], ['leather_vambraces', 1], ['leather_gloves', 1],
        ['green_cape', 1],
        ['rune_full_helm', 1], ['rune_platebody', 1], ['rune_platelegs', 1],
        ['rune_kiteshield', 1], ['rune_2h_sword', 1],
        ['lobster', 15],
    ];
    for (const [item, n] of gives) {
        await cheat(sdk, `::give ${item} ${n}`);
    }

    // Back to Mage Bank exterior
    await sdk.say('::tele 0,39,73,44,44');
    await sdk.waitForTicks(8).catch(() => {});
    const p = sdk.getState()?.player;
    const inv = sdk.getState()?.inventory ?? [];
    console.log(`RUNE-READY (${p?.worldX},${p?.worldZ} L${p?.level}) inv=${inv.length} ` + inv.map((i: any) => `${i.name}x${i.count}`).join(','));
}, { timeout: 180_000 });
