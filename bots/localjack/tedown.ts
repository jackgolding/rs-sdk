import { runScript } from '../../sdk/runner';

await runScript(async ({ sdk }) => {
    await sdk.say('::tele 0,38,53,42,44');
    await sdk.waitForCondition((s) => (s.player?.level ?? -1) === 0, 15_000).catch(() => {});
    await sdk.waitForTicks(5).catch(() => {});
    const p = sdk.getState()?.player;
    console.log(`NOW-AT (${p?.worldX},${p?.worldZ} L${p?.level})`);
}, {
    timeout: 90_000,
});
