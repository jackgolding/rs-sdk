import { runScript } from '../../sdk/runner';

async function cheat(sdk: any, cmd: string) {
    await sdk.say(cmd);
    await sdk.waitForTicks(3).catch(() => {});
}

await runScript(async ({ sdk }: any) => {
    for (const s of ['attack', 'defence', 'strength', 'hitpoints', 'ranged', 'prayer', 'magic']) {
        await cheat(sdk, `::setstat ${s} 99`);
    }
    await cheat(sdk, '::give white_apron 1');
    // Next to NPC Rick in Lumbridge courtyard
    await sdk.say('::tele 0,50,50,20,22');
    await sdk.waitForTicks(8).catch(() => {});
    const p = sdk.getState()?.player;
    console.log(`RICKLIVE-READY (${p?.worldX},${p?.worldZ} L${p?.level})`);
}, { timeout: 120_000 });
