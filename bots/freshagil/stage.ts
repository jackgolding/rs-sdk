import { runScript } from '../../sdk/runner';

// Truly fresh: tutorial skip + park at Ardougne market. No items, no cheats.
await runScript(async ({ bot, sdk }) => {
    await bot.skipTutorial().catch(() => {});
    await sdk.waitForTicks(3).catch(() => {});
    // Ardougne market (2662,3312): mx=41,lx=38,mz=51,lz=48
    await sdk.say('::tele 0,41,51,38,48');
    await sdk.waitForCondition((s) => (s.player?.worldX ?? 0) === 2662, 15_000).catch(() => {});
    await sdk.waitForTicks(8).catch(() => {});
    const p = sdk.getState()?.player;
    console.log(`FRESH-AT (${p?.worldX},${p?.worldZ} L${p?.level}) hp=${p?.hp}/${p?.maxHp}`);
}, {
    timeout: 120_000,
});
