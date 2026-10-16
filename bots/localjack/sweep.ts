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
    for (let gx = 2430; gx <= 2500; gx += 18) {
        for (let gz = 3380; gz <= 3460; gz += 18) {
            await sdk.say(toTele(gx, gz, 0));
            await sdk.waitForTicks(2).catch(() => {});
            const scanned = await sdk.scanNearbyLocs(30).catch(() => [] as any[]);
            for (const l of scanned ?? []) {
                if (/alance|^log\b|log /i.test(l.name)) {
                    const key = `${l.name}@${l.x},${l.z}`;
                    if (!seen.has(key)) {
                        seen.add(key);
                        console.log(
                            `FOUND name=${l.name} id=${l.id} @ ${l.x},${l.z} opts=${(l.optionsWithIndex ?? []).map((o: any) => `${o.opIndex}:${o.text}`).join('|')}`
                        );
                    }
                }
            }
        }
    }
    const p = sdk.getState()?.player;
    console.log('SWEEP-DONE', JSON.stringify({ x: p?.worldX, z: p?.worldZ }), 'found=' + seen.size);
}, {
    timeout: 300_000,
});
