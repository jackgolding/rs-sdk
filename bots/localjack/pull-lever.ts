import { runScript } from '../../sdk/runner';

await runScript(async ({ bot, sdk }) => {
    const p0 = sdk.getState()?.player;
    console.log(`PULL-FROM (${p0?.worldX},${p0?.worldZ} L${p0?.level})`);
    await sdk.scanNearbyLocs(15).catch(() => {});
    const lever = (sdk.getNearbyLocs() ?? []).find((l) => l.id === 1814);
    console.log('LEVER ' + (lever ? `found @ ${lever.x},${lever.z}` : 'NOT FOUND'));
    if (lever) {
        await bot.walkTo(lever.x, lever.z, 1);
        const r = await bot.interactLoc(lever, 'Pull');
        console.log('PULL-CLICK success=' + r.success);
        await sdk.waitForCondition((s) => {
            const dx = Math.abs((s.player?.worldX ?? 0) - 2561);
            const dz = Math.abs((s.player?.worldZ ?? 0) - 3311);
            return Math.max(dx, dz) > 30;
        }, 20_000).catch(() => {});
        await sdk.waitForTicks(8).catch(() => {});
    }
    const p1 = sdk.getState()?.player;
    console.log(`LANDED (${p1?.worldX},${p1?.worldZ} L${p1?.level})`);
    const scanned = await sdk.scanNearbyLocs(25).catch(() => [] as any[]);
    console.log('KEEP-SCAN total=' + (scanned?.length ?? -1));
    for (const l of scanned ?? []) {
        if (/web|lever|ladder|door|gate|stairs/i.test(l.name)) {
            console.log(
                `KEEP-LOC name=${l.name} id=${l.id} @ ${l.x},${l.z} reach=${l.reachable} opts=${l.optionsWithIndex.map((o: any) => `${o.opIndex}:${o.text}`).join('|')}`
            );
        }
    }
}, {
    timeout: 150_000,
});
