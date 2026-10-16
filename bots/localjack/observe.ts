import { runScript } from '../../sdk/runner';

// Passive observer: user drives localjack in the browser, we report
// position + any Log-balance sighting through the SDK.
await runScript(async ({ bot, sdk }) => {
    await bot.skipTutorial().catch(() => {});
    for (let i = 0; i < 150; i++) {
        const p = sdk.getState()?.player;
        const scanned = await sdk.scanNearbyLocs(25).catch(() => [] as any[]);
        const logs = (scanned ?? []).filter(
            (l: any) => l.id === 2295 || /alance/i.test(l.name)
        );
        console.log(
            `T+${i * 3}s pos=(${p?.worldX},${p?.worldZ} L${p?.level}) scanned=${scanned?.length} ` +
                (logs.length
                    ? 'LOG: ' + logs.map((l: any) => `${l.name}#${l.id}@${l.x},${l.z} lvl=${l.level} opts=${l.options.join('/')}`).join(' ; ')
                    : 'no-log-in-scan')
        );
        await sdk.waitForTicks(7).catch(() => {});
    }
    console.log('OBSERVER-DONE');
}, {
    timeout: 500_000,
});
