import { runScript } from '../../sdk/runner';

await runScript(async ({ bot, sdk }) => {
    const pos = () => {
        const p = sdk.getState()?.player;
        return { x: p?.worldX ?? -1, z: p?.worldZ ?? -1, level: p?.level ?? -1 };
    };
    console.log('START', JSON.stringify(pos()));

    // Fresh accounts spawn on tutorial island — skip it first.
    await bot.skipTutorial().catch(() => {});
    await sdk.waitForTicks(3).catch(() => {});
    console.log('POST-TUT', JSON.stringify(pos()));

    // ::tele 0,38,53,42,44 == world (2474,3436) L0 = GNOME_START
    await sdk.say('::tele 0,38,53,42,44');
    await sdk.waitForCondition((s) => (s.player?.worldX ?? 0) >= 2470, 15_000).catch(() => {});
    await sdk.waitForTicks(3).catch(() => {});
    console.log('AFTER-TELE', JSON.stringify(pos()));

    const scanned = await sdk.scanNearbyLocs(40).catch(() => [] as any[]);
    console.log('SCANNED', scanned?.length ?? -1);
    const locs = (sdk.getNearbyLocs() ?? []).filter((l) =>
        /log|balance|net|pipe|rope|tree|branch|obstacle/i.test(l.name)
    );
    for (const l of locs) {
        console.log(
            `LOC name=${l.name} id=${l.id} @ ${l.x},${l.z} reach=${l.reachable} opts=${l.optionsWithIndex.map((o) => `${o.opIndex}:${o.text}`).join('|')}`
        );
    }
    console.log('MATCH-COUNT', locs.length);
}, {
    timeout: 150_000,
});
