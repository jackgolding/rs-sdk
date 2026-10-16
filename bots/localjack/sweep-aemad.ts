import { runScript } from '../../sdk/runner';

const toTele = (x: number, z: number) => {
    const mx = x >> 6;
    const lx = x - mx * 64;
    const mz = z >> 6;
    const lz = z - mz * 64;
    return `::tele 0,${mx},${mz},${lx},${lz}`;
};

await runScript(async ({ sdk }) => {
    for (let gx = 2520; gx <= 2700; gx += 30) {
        for (let gz = 3250; gz <= 3350; gz += 30) {
            await sdk.say(toTele(gx, gz));
            await sdk.waitForTicks(6).catch(() => {});
            const npcs = sdk.getNearbyNpcs() ?? [];
            for (const n of npcs) {
                if (/aemad|shopkeeper|shop keeper|trader/i.test(n.name)) {
                    console.log(`SHOP-NPC name=${n.name}@${n.x},${n.z} (via ${gx},${gz})`);
                }
            }
        }
    }
    console.log('AEMAD-SWEEP-DONE');
}, {
    timeout: 300_000,
});
