import { runScript } from '../../sdk/runner';

await runScript(async ({ bot, sdk }) => {
    // Blade first (keep exit web needs slash), then scan the keep.
    if (!sdk.findInventoryItem(/axe|sword|scimitar|dagger|knife|claws|battleaxe|longsword/i)) {
        await sdk.say('::give knife 1');
        await sdk.waitForTicks(4).catch(() => {});
    }
    let blade = sdk.findInventoryItem(/axe|sword|scimitar|dagger|knife|claws|battleaxe|longsword/i);
    if (!blade) {
        await sdk.say('::give bronze_sword 1');
        await sdk.waitForTicks(4).catch(() => {});
        blade = sdk.findInventoryItem(/axe|sword|scimitar|dagger|knife|claws|battleaxe|longsword/i);
    }
    console.log('BLADE ' + (blade ? `${(blade as any).name}` : 'NONE'));
    const p = sdk.getState()?.player;
    console.log(`KEEP-AT (${p?.worldX},${p?.worldZ} L${p?.level})`);
    await sdk.waitForTicks(10).catch(() => {});
    const scanned = await sdk.scanNearbyLocs(30).catch(() => [] as any[]);
    console.log('KEEP-SCAN total=' + (scanned?.length ?? -1));
    for (const l of scanned ?? []) {
        if (/web|lever|ladder|door|gate|stairs/i.test(l.name)) {
            console.log(
                `KEEP-LOC name=${l.name} id=${l.id} @ ${l.x},${l.z} reach=${l.reachable} opts=${l.optionsWithIndex.map((o: any) => `${o.opIndex}:${o.text}`).join('|')}`
            );
        }
    }
    const npcs = sdk.getNearbyNpcs() ?? [];
    console.log('KEEP-NPCS ' + npcs.slice(0, 12).map((n: any) => `${n.name}@${n.x},${n.z}`).join(' ; '));
}, {
    timeout: 150_000,
});
