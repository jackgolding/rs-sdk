import { runScript } from '../../sdk/runner';

async function cheat(sdk: any, cmd: string) {
    await sdk.say(cmd);
    await sdk.waitForTicks(3).catch(() => {});
}

await runScript(async ({ sdk }: any) => {
    // God-mode body: maxed, parked in the arena near the action
    for (const s of ['attack', 'defence', 'strength', 'hitpoints', 'ranged', 'prayer', 'magic']) {
        await cheat(sdk, `::setstat ${s} 99`);
    }
    await cheat(sdk, '::give red_cape 1');
    await sdk.say('::tele 0,48,61,22,52');
    await sdk.waitForTicks(8).catch(() => {});
    const p = sdk.getState()?.player;
    console.log(`GOD-READY (${p?.worldX},${p?.worldZ} L${p?.level})`);
}, { timeout: 120_000 });
