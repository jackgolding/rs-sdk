import { runScript } from '../../sdk/runner';

await runScript(async ({ sdk }) => {
    const targets: Array<[number, number]> = [
        [2465, 3378], [2455, 3378], [2470, 3380], [2462, 3382],
        [2470, 3382], [2450, 3382], [2459, 3390], [2465, 3385],
    ];
    for (const [x, z] of targets) {
        await sdk.sendWalk(x, z, true);
        await sdk.waitForCondition((s) => Math.hypot((s.player?.worldX ?? 0) - x, (s.player?.worldZ ?? 0) - z) <= 2, 8_000).catch(() => {});
        const p = sdk.getState()?.player;
        const ok = Math.hypot((p?.worldX ?? 0) - x, (p?.worldZ ?? 0) - z) <= 2;
        console.log(`WALK (${x},${z}): ${ok ? 'REACHED' : `stuck@(${p?.worldX},${p?.worldZ})`}`);
        // hop back to start (2459,3378) for the next probe
        await sdk.say('::tele 0,38,52,27,50');
        await sdk.waitForTicks(6).catch(() => {});
    }
}, {
    timeout: 300_000,
});
