import { runScript } from '../../sdk/runner';

const toTele = (x: number, z: number, level = 0) => {
    const mx = x >> 6;
    const lx = x - mx * 64;
    const mz = z >> 6;
    const lz = z - mz * 64;
    return `::tele ${level},${mx},${mz},${lx},${lz}`;
};

await runScript(async ({ sdk }) => {
    const seen = new Set<string>();
    for (const level of [1, 2, 0]) {
        for (let gx = 2380; gx <= 2500; gx += 20) {
            for (let gz = 3360; gz <= 3470; gz += 20) {
                await sdk.say(toTele(gx, gz, level));
                await sdk.waitForTicks(2).catch(() => {});
                const scanned = await sdk.scanNearbyLocs(30).catch(() => [] as any[]);
                for (const l of scanned ?? []) {
                    if (/alance/i.test(l.name)) {
                        const key = `${l.name}@${l.x},${l.z}`;
                        if (!seen.has(key)) {
                            seen.add(key);
                            console.log(
                                `FOUND L? name=${l.name} id=${l.id} @ ${l.x},${l.z} opts=${(l.optionsWithIndex ?? []).map((o: any) => `${o.opIndex}:${o.text}`).join('|')}`
                            );
                        }
                    }
                }
            }
        }
        const p = sdk.getState()?.player;
        console.log(`LEVEL-DONE L${level}`, JSON.stringify({ x: p?.worldX, z: p?.worldZ, l: p?.level }), 'found=' + seen.size);
    }
}, {
    timeout: 500_000,
});
