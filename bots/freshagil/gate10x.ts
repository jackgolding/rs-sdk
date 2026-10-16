import { runScript } from '../../sdk/runner';
import { enterGnomeStronghold, GNOME_GATE } from '../quests/gnome-gate';
import { closeUi as closeUiShared, walkNear as walkNearShared } from '../quests/movement';
import { distTo as distToShared } from '../quests/movement';

const toTele = (x: number, z: number) => {
    const mx = x >> 6;
    const lx = x - mx * 64;
    const mz = z >> 6;
    const lz = z - mz * 64;
    return `::tele 0,${mx},${mz},${lx},${lz}`;
};

// Usage: bun bots/freshagil/gate10x.ts <botname> [count]
// Parks outside the gate (east corridor — never the south wall pocket),
// enters via the PRODUCTION entry fn, verifies inside, repeats.
const COUNT = parseInt(process.argv[3] ?? '10', 10);

await runScript(async ({ bot, sdk }) => {
    const pos = () => {
        const p = sdk.getState()?.player;
        return { x: p?.worldX ?? -1, z: p?.worldZ ?? -1, level: p?.level ?? -1 };
    };
    const log = (m: string) => console.log(m);
    const intent = (m: string) => console.log('INTENT ' + m);
    const walkNear = (x: number, z: number, t = 4) => walkNearShared(bot, sdk, x, z, t);
    const closeUi = () => closeUiShared(bot, sdk);
    const distTo = (x: number, z: number) => distToShared(sdk, x, z);

    await bot.skipTutorial().catch(() => {});
    let pass = 0;
    for (let i = 1; i <= COUNT; i++) {
        // Park east of the gate on VERIFIED walkable footing (2461-2463,3382
        // — the route stands there on foot; z=3380 tiles are trees/walls).
        await sdk.say(toTele(2463, 3382));
        await sdk.waitForCondition((s) => (s.player?.worldX ?? -1) === 2463, 15_000).catch(() => {});
        await sdk.waitForTicks(10).catch(() => {});
        // Footing check — refuse to test from inside collision.
        await sdk.sendWalk(2465, 3382, true);
        await sdk.waitForCondition((s) => (s.player?.worldX ?? 0) >= 2464, 8_000).catch(() => {});
        if ((sdk.getState()?.player?.worldX ?? 0) < 2464) {
            console.log(`ENTRY ${i}/${COUNT}: ABORT (bad footing — tele clipped a wall)`);
            continue;
        }
        const t0 = Date.now();
        const ok = await enterGnomeStronghold({ sdk, bot, log, intent, pos, walkNear, closeUi });
        const p = pos();
        const inside = p.z >= GNOME_GATE.z + 3 && distTo(2474, 3436) < 120;
        if (ok && inside) pass++;
        console.log(`ENTRY ${i}/${COUNT}: ${ok && inside ? 'PASS' : 'FAIL'} in ${((Date.now() - t0) / 1000).toFixed(1)}s @ (${p.x},${p.z})`);
    }
    console.log(`GATE10X-DONE pass=${pass}/${COUNT}`);
}, {
    timeout: 900_000,
});
