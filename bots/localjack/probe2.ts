import { runScript } from '../../sdk/runner';

await runScript(async ({ sdk }) => {
    await sdk.say('::tele 0,38,53,42,44');
    await sdk.waitForTicks(10).catch(() => {});
    for (const r of [8, 22, 40]) {
        const scanned = await sdk.scanNearbyLocs(r).catch(() => [] as any[]);
        const p = sdk.getState()?.player;
        const near = (scanned ?? []).filter(
            (l: any) => Math.abs(l.x - 2474) <= 6 && Math.abs(l.z - 3435) <= 6
        );
        console.log(
            `RADIUS ${r} @ (${p?.worldX},${p?.worldZ} L${p?.level}) total=${scanned?.length} near6=${near.length} ` +
                near.map((l: any) => `${l.name}@${l.x},${l.z}`).join(' ; ')
        );
    }
}, {
    timeout: 120_000,
});
