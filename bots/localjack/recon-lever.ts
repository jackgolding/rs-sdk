import { runScript } from '../../sdk/runner';

const toTele = (x: number, z: number, level = 0) => {
    const mx = x >> 6;
    const lx = x - mx * 64;
    const mz = z >> 6;
    const lz = z - mz * 64;
    return `::tele ${level},${mx},${mz},${lx},${lz}`;
};

await runScript(async ({ sdk }) => {
    // East Ardougne lever hut (2561,3311), door (2564,3310)
    await sdk.say(toTele(2561, 3311, 0));
    await sdk.waitForCondition((s) => (s.player?.worldX ?? 0) === 2561, 15_000).catch(() => {});
    await sdk.waitForTicks(12).catch(() => {});
    const scanned = await sdk.scanNearbyLocs(15).catch(() => [] as any[]);
    console.log('HUT-SCAN total=' + (scanned?.length ?? -1));
    for (const l of scanned ?? []) {
        if (/lever|door|gate/i.test(l.name)) {
            console.log(
                `HUT-LOC name=${l.name} id=${l.id} @ ${l.x},${l.z} reach=${l.reachable} opts=${l.optionsWithIndex.map((o: any) => `${o.opIndex}:${o.text}`).join('|')}`
            );
        }
    }
}, {
    timeout: 120_000,
});
