import { runScript } from '../../sdk/runner';

await runScript(async ({ sdk }) => {
    await sdk.say('::give knife 1');
    await sdk.waitForTicks(3).catch(() => {});
    await sdk.say('::give shark 20');
    await sdk.waitForTicks(3).catch(() => {});
    // Park mid-course on L2 (rope platform) at level 52 state.
    await sdk.say('::tele 2,38,53,44,28');
    await sdk.waitForCondition((s) => (s.player?.level ?? -1) === 2, 15_000).catch(() => {});
    await sdk.waitForTicks(5).catch(() => {});
    const p = sdk.getState()?.player;
    const inv = sdk.getState()?.inventory ?? [];
    console.log(`STAGED (${p?.worldX},${p?.worldZ} L${p?.level}) inv=${inv.length} ` + inv.map((i: any) => `${i.name}x${i.count}`).join(','));
}, {
    timeout: 120_000,
});
