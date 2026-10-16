import { runScript } from '../../sdk/runner';

await runScript(async ({ bot, sdk }) => {
    for (let i = 0; i < 4; i++) {
        await sdk.scanNearbyLocs(10).catch(() => {});
        const gate = (sdk.getNearbyLocs() ?? []).find((l: any) => Math.abs(l.x - 2459) <= 2 && Math.abs(l.z - 3383) <= 2 && /gate/i.test(l.name));
        console.log(`TRY ${i} gate=${gate ? `${gate.name}#${gate.id} reach=${gate.reachable} opts=${gate.options.join('/')}` : 'MISSING'}`);
        if (!gate) break;
        if (/open/i.test(gate.options.join('/'))) {
            const r = await bot.interactLoc(gate, 'Open');
            console.log(`OPEN-${i} success=${r.success}`);
            await sdk.waitForTicks(2).catch(() => {});
        } else {
            console.log(`GATE ALREADY OPEN-ish, walking north`);
        }
        await sdk.sendWalk(2459, 3389, true);
        await sdk.waitForCondition((s) => (s.player?.worldZ ?? 0) >= 3386, 8_000).catch(() => {});
        const p = sdk.getState()?.player;
        console.log(`POS-${i} (${p?.worldX},${p?.worldZ})`);
        if ((p?.worldZ ?? 0) >= 3386) break;
    }
}, {
    timeout: 200_000,
});
