import { runScript } from '../../sdk/runner';

await runScript(async ({ sdk }) => {
    const p = sdk.getState()?.player;
    console.log(`YOU-ARE-HERE (${p?.worldX},${p?.worldZ} L${p?.level})`);
    const scanned = await sdk.scanNearbyLocs(25).catch(() => [] as any[]);
    const logs = (scanned ?? []).filter(
        (l: any) => l.id === 2295 || /alance/i.test(l.name)
    );
    console.log(
        'SCANNED=' + (scanned?.length ?? -1) + ' ' +
            (logs.length
                ? logs.map((l: any) => `${l.name}#${l.id}@${l.x},${l.z} lvl=${l.level} opts=${l.options.join('/')}`).join(' ; ')
                : 'no-log-in-scan')
    );
}, {
    timeout: 90_000,
});
