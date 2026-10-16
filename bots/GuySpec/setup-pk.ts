import { runScript } from '../../sdk/runner';

const CAPE = process.env.PK_CAPE ?? 'red_cape';

async function cheat(sdk: any, cmd: string) {
    await sdk.say(cmd);
    await sdk.waitForTicks(3).catch(() => {});
}

await runScript(async ({ sdk }: any) => {
    await sdk.say('::getcoord');
    await sdk.waitForTicks(4).catch(() => {});

    // F2P pure stats: 40 atk (rune scim), 99 str/hp/range/mage, 1 def/prayer
    const stats: [string, number][] = [
        ['attack', 40], ['defence', 1], ['strength', 99], ['hitpoints', 99],
        ['ranged', 99], ['prayer', 1], ['magic', 99],
        ['cooking', 1], ['woodcutting', 1], ['fletching', 1], ['fishing', 1],
        ['firemaking', 1], ['crafting', 1], ['smithing', 1], ['mining', 1],
        ['herblore', 1], ['agility', 1], ['thieving', 1], ['slayer', 1],
        ['farming', 1], ['runecraft', 1],
    ];
    for (const [s, l] of stats) {
        await cheat(sdk, `::setstat ${s} ${l}`);
    }

    // F2P pure PK kit (verified obj names, no underscores on runes)
    const gives: [string, number][] = [
        ['rune_scimitar', 1], ['oak_shortbow', 1], ['iron_arrow', 300],
        ['staff_of_air', 1], ['airrune', 300], ['chaosrune', 200], ['deathrune', 100],
        ['amulet_of_strength', 1], ['monkrobetop', 1], ['monkrobebottom', 1],
        ['coif', 1], ['leather_vambraces', 1], ['leather_gloves', 1],
        [CAPE, 1], ['lobster', 25],
    ];
    for (const [item, n] of gives) {
        await cheat(sdk, `::give ${item} ${n}`);
    }

    // Mage Bank exterior, wilderness: 2540,4716 = 0,39,73,44,44
    await sdk.say('::tele 0,39,73,44,44');
    await sdk.waitForTicks(8).catch(() => {});
    await sdk.say('::getcoord');
    await sdk.waitForTicks(4).catch(() => {});

    const p = sdk.getState()?.player;
    const inv = sdk.getState()?.inventory ?? [];
    const msgs = (sdk.getState()?.gameMessages ?? []).slice(-3).map((m: any) => m.text ?? m.message ?? '').join(' | ');
    console.log(`PK-READY (${p?.worldX},${p?.worldZ} L${p?.level}) inv=${inv.length} ` + inv.map((i: any) => `${i.name}x${i.count}`).join(','));
    console.log('COORD-ECHO ' + msgs);
}, { timeout: 180_000 });
