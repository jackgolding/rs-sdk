import { runScript } from '../../sdk/runner';

const toTele = (x: number, z: number) => {
    const mx = x >> 6;
    const lx = x - mx * 64;
    const mz = z >> 6;
    const lz = z - mz * 64;
    return `::tele 0,${mx},${mz},${lx},${lz}`;
};

await runScript(async ({ bot, sdk }) => {
    // East approach (walkable — the route reaches 2460,3382 on foot).
    await sdk.say(toTele(2465, 3380));
    await sdk.waitForCondition((s) => (s.player?.worldX ?? -1) === 2465, 15_000).catch(() => {});
    await sdk.waitForTicks(10).catch(() => {});
    // Footing check: step east — proves the tele tile is walkable.
    await sdk.sendWalk(2467, 3380, true);
    await sdk.waitForCondition((s) => (s.player?.worldX ?? 0) >= 2466, 8_000).catch(() => {});
    let p = sdk.getState()?.player;
    console.log(`FOOTING (${p?.worldX},${p?.worldZ})`);
    // Approach the gate from the east and open it.
    await bot.walkTo(2461, 3382, 1);
    await sdk.waitForTicks(3).catch(() => {});
    p = sdk.getState()?.player;
    console.log(`AT-GATE (${p?.worldX},${p?.worldZ})`);
    await sdk.scanNearbyLocs(10).catch(() => {});
    const gate = (sdk.getNearbyLocs() ?? []).find((l: any) => l.id === 190);
    console.log(`GATE ${gate ? `reach=${gate.reachable} opts=${gate.options.join('/')}` : 'MISSING'}`);
    if (gate) {
        const r = await bot.interactLoc(gate, 'Open');
        console.log('OPEN success=' + r.success);
        await sdk.waitForTicks(2).catch(() => {});
        await sdk.sendWalk(2459, 3388, true);
        await sdk.waitForCondition((s) => (s.player?.worldZ ?? 0) >= 3386, 12_000).catch(() => {});
        p = sdk.getState()?.player;
        console.log(`THROUGH? (${p?.worldX},${p?.worldZ})`);
    }
}, {
    timeout: 200_000,
});
