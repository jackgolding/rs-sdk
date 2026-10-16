import { runScript } from '../../sdk/runner';

await runScript(async ({ bot, sdk }) => {
    // 1. Slash the keep web (3158,3951) and step north through it.
    // Server coin-flips the cut (50%) — retry until "Slashed web" shows.
    // Plain Slash op-clicks fail here: use the knife ON the web (oplocu).
    await bot.walkTo(3158, 3953, 2);
    let cut = false;
    for (let i = 0; i < 8 && !cut; i++) {
        await sdk.scanNearbyLocs(15).catch(() => {});
        const web = (sdk.getNearbyLocs() ?? []).find((l) => l.id === 733);
        if (web) {
            const r = await bot.useItemOnLoc(/^knife$/i, web).catch((e: any) => ({ success: false, message: String(e?.message ?? e) }));
            console.log(`SLASH-TRY ${i} success=${(r as any).success} ${(r as any).message ?? ''}`);
            await sdk.waitForTicks(4).catch(() => {});
        }
        await sdk.scanNearbyLocs(15).catch(() => {});
        cut = (sdk.getNearbyLocs() ?? []).some((l) => /^slashed web$/i.test(l.name) && Math.abs(l.x - 3158) <= 2 && Math.abs(l.z - 3951) <= 2);
    }
    console.log('WEB-CUT ' + cut);
    await sdk.sendWalk(3158, 3955, true);
    await sdk.waitForCondition((s) => (s.player?.worldZ ?? 0) >= 3953, 12_000).catch(() => {});
    const p1 = sdk.getState()?.player;
    console.log(`PAST-WEB (${p1?.worldX},${p1?.worldZ} L${p1?.level})`);
    // 2. West on the north road to x=3135, then to the Mage ladder (3091,3957).
    await sdk.sendWalk(3135, 3955, true);
    await sdk.waitForCondition((s) => (s.player?.worldX ?? 9999) <= 3140, 25_000).catch(() => {});
    await sdk.sendWalk(3091, 3957, true);
    await sdk.waitForCondition((s) => Math.hypot((s.player?.worldX ?? 0) - 3091, (s.player?.worldZ ?? 0) - 3957) < 8, 25_000).catch(() => {});
    const p2 = sdk.getState()?.player;
    console.log(`AT-MAGE (${p2?.worldX},${p2?.worldZ} L${p2?.level})`);
    await sdk.scanNearbyLocs(20).catch(() => {});
    const ladder = (sdk.getNearbyLocs() ?? []).filter((l) => /ladder/i.test(l.name));
    console.log('LADDERS ' + ladder.map((l: any) => `${l.name}#${l.id}@${l.x},${l.z}`).join(' ; '));
}, {
    timeout: 240_000,
});
