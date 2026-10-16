import { runScript } from '../../sdk/runner';

await runScript(async ({ bot, sdk }) => {
    const w = await bot.walkTo(2459, 3382, 1);
    console.log(`WALKTO success=${w.success} msg=${w.message}`);
    await sdk.waitForTicks(3).catch(() => {});
    let p = sdk.getState()?.player;
    console.log(`AFTER-WALKTO (${p?.worldX},${p?.worldZ})`);
    await sdk.sendWalk(2459, 3382, true);
    await sdk.waitForCondition((s) => (s.player?.worldZ ?? 0) >= 3381, 10_000).catch(() => {});
    p = sdk.getState()?.player;
    console.log(`AFTER-SENDWALK (${p?.worldX},${p?.worldZ})`);
}, {
    timeout: 120_000,
});
