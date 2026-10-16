import { runScript } from '../../sdk/runner';

await runScript(async ({ bot, sdk }) => {
    await bot.walkTo(2459, 3382, 1);
    await sdk.waitForTicks(3).catch(() => {});
    await sdk.scanNearbyLocs(8).catch(() => {});
    let gate = (sdk.getNearbyLocs() ?? []).find((l: any) => l.id === 190);
    console.log(`ADJACENT gate=${gate ? `reach=${gate.reachable} opts=${gate.options.join('/')}` : 'MISSING'} pos=(${sdk.getState()?.player?.worldX},${sdk.getState()?.player?.worldZ})`);
    if (gate) {
        const r = await bot.interactLoc(gate, 'Open');
        console.log('OPEN success=' + r.success);
        // Walk through at once — no waiting for the gate to re-close.
        await sdk.sendWalk(2459, 3388, true);
        await sdk.waitForCondition((s) => (s.player?.worldZ ?? 0) >= 3386, 12_000).catch(() => {});
        const p = sdk.getState()?.player;
        console.log(`THROUGH? (${p?.worldX},${p?.worldZ})`);
        await sdk.scanNearbyLocs(8).catch(() => {});
        gate = (sdk.getNearbyLocs() ?? []).find((l: any) => l.id === 190);
        console.log(`GATE-NOW ${gate ? `${gate.name} opts=${gate.options.join('/')}` : 'MISSING'}`);
    }
}, {
    timeout: 150_000,
});
