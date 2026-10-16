import { runScript } from '../../sdk/runner';

async function cheat(sdk: any, cmd: string) {
    await sdk.say(cmd);
    await sdk.waitForTicks(3).catch(() => {});
}

await runScript(async ({ sdk }: any) => {
    // Jerry the snail: durable, harmless (1 attack, can't hurt anyone)
    for (const [s, l] of [['attack', 1], ['defence', 99], ['strength', 1], ['hitpoints', 99],
            ['ranged', 1], ['prayer', 1], ['magic', 1]] as [string, number][]) {
        await cheat(sdk, `::setstat ${s} ${l}`);
    }
    // To Mage Bank where the crew is
    await sdk.say('::tele 0,39,73,44,44');
    await sdk.waitForTicks(8).catch(() => {});
    const p = sdk.getState()?.player;
    console.log(`JERRY-READY (${p?.worldX},${p?.worldZ} L${p?.level})`);
}, { timeout: 120_000 });
