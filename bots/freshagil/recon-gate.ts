import { runScript } from '../../sdk/runner';

const toTele = (x: number, z: number) => {
    const mx = x >> 6;
    const lx = x - mx * 64;
    const mz = z >> 6;
    const lz = z - mz * 64;
    return `::tele 0,${mx},${mz},${lx},${lz}`;
};

await runScript(async ({ bot, sdk }) => {
    // Park just south of the stronghold gate, settle, dump the gate loc.
    await sdk.say(toTele(2459, 3378));
    await sdk.waitForCondition((s) => (s.player?.worldX ?? -1) === 2459, 15_000).catch(() => {});
    await sdk.waitForTicks(12).catch(() => {});
    const scanned = await sdk.scanNearbyLocs(12).catch(() => [] as any[]);
    const gates = (scanned ?? []).filter((l: any) => /gate|door|fence/i.test(l.name));
    console.log('GATE-LOCS ' + gates.map((l: any) => `${l.name}#${l.id}@${l.x},${l.z} reach=${l.reachable} opts=${l.options.join('/')}`).join(' ; '));
    // Try opening it and watch what happens (timing + walk-through).
    const gate = gates.find((l: any) => /^gate$/i.test(l.name));
    if (gate) {
        const r = await bot.interactLoc(gate, 'Open');
        console.log('OPEN-CLICK success=' + r.success);
        for (let i = 0; i < 6; i++) {
            await sdk.waitForTicks(5).catch(() => {});
            await sdk.scanNearbyLocs(8).catch(() => {});
            const g = (sdk.getNearbyLocs() ?? []).find((l: any) => l.id === gate.id && Math.abs(l.x - gate.x) <= 2 && Math.abs(l.z - gate.z) <= 2);
            const p = sdk.getState()?.player;
            console.log(`T+${i * 5}t gate=${g ? `${g.name} opts=${g.options.join('/')}` : 'GONE?'} pos=(${p?.worldX},${p?.worldZ})`);
        }
    }
}, {
    timeout: 180_000,
});
