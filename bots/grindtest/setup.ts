import { runScript } from '../../sdk/runner';

// Pre-grind setup: fast world. Run BEFORE the route (one SDK slot).
await runScript(async ({ bot, sdk }) => {
    await bot.skipTutorial().catch(() => {});
    await sdk.say('::speed 30');
    await sdk.waitForTicks(3).catch(() => {});
    const p = sdk.getState()?.player;
    console.log(`GRIND-READY (${p?.worldX},${p?.worldZ} L${p?.level})`);
}, {
    timeout: 120_000,
});
