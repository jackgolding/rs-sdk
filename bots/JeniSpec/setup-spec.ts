import { runScript } from '../../sdk/runner';

await runScript(async ({ sdk }: any) => {
    // Spectator: park at Mage Bank exterior just south of the fighters
    await sdk.say('::tele 0,39,73,44,42');
    await sdk.waitForTicks(8).catch(() => {});
    await sdk.say('::getcoord');
    await sdk.waitForTicks(4).catch(() => {});
    const p = sdk.getState()?.player;
    console.log(`SPEC-READY (${p?.worldX},${p?.worldZ} L${p?.level})`);
}, { timeout: 90_000 });
