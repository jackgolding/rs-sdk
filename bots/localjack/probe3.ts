import { runScript } from '../../sdk/runner';

await runScript(async ({ sdk }) => {
    for (const level of [0, 1]) {
        // (2474,3436): mx=38,lx=42,mz=53,lz=44
        await sdk.say(`::tele ${level},38,53,42,44`);
        await sdk.waitForCondition(
            (s) => (s.player?.worldX ?? 0) === 2474 && (s.player?.level ?? -1) === level,
            20_000
        ).catch(() => {});
        await sdk.waitForTicks(15).catch(() => {});
        const p = sdk.getState()?.player;
        const scanned = await sdk.scanNearbyLocs(10).catch(() => [] as any[]);
        const log = (scanned ?? []).filter((l: any) => l.id === 2295 || /alance/i.test(l.name));
        console.log(
            `PLANE L${level} @ (${p?.worldX},${p?.worldZ} L${p?.level}) total=${scanned?.length} logmatch=${log.length} ` +
                log.map((l: any) => `${l.name}#${l.id}@${l.x},${l.z}`).join(' ; ')
        );
    }
}, {
    timeout: 180_000,
});
