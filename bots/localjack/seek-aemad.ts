import { runScript } from '../../sdk/runner';

const toTele = (x: number, z: number) => {
    const mx = x >> 6;
    const lx = x - mx * 64;
    const mz = z >> 6;
    const lz = z - mz * 64;
    return `::tele 0,${mx},${mz},${lx},${lz}`;
};

await runScript(async ({ sdk }) => {
    // Aemad's shop is indoors just north of East Ardougne market — check candidates with long settles.
    for (const [gx, gz] of [[2610, 3328], [2615, 3335], [2605, 3330], [2620, 3325], [2610, 3340]]) {
        await sdk.say(toTele(gx, gz));
        await sdk.waitForCondition((s) => (s.player?.worldX ?? -1) === gx, 15_000).catch(() => {});
        await sdk.waitForTicks(15).catch(() => {});
        const npcs = sdk.getNearbyNpcs() ?? [];
        const keepers = npcs.filter((n) => /aemad|kortan|shopkeeper|shop keeper/i.test(n.name));
        console.log(`SHOP-SEEK (${gx},${gz}): ` + (keepers.length ? keepers.map((n: any) => `${n.name}@${n.x},${n.z}`).join(' ; ') : `no keeper (${npcs.length} npcs around)`));
        if (keepers.length) break;
    }
}, {
    timeout: 240_000,
});
