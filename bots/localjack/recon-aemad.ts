import { runScript } from '../../sdk/runner';

await runScript(async ({ sdk }) => {
    // Aemad's Adventuring Supplies, East Ardougne — find the shop NPC/booth.
    await sdk.say('::tele 0,41,51,42,48');
    await sdk.waitForTicks(12).catch(() => {});
    const p = sdk.getState()?.player;
    console.log(`AT-MARKET (${p?.worldX},${p?.worldZ} L${p?.level})`);
    const scanned = await sdk.scanNearbyLocs(25).catch(() => [] as any[]);
    const shops = (scanned ?? []).filter((l: any) => /shop|stall|booth|counter/i.test(l.name));
    console.log('SHOPS ' + shops.map((l: any) => `${l.name}#${l.id}@${l.x},${l.z} opts=${l.options.join('/')}`).join(' ; '));
    const npcs = sdk.getNearbyNpcs() ?? [];
    console.log('NPCS ' + npcs.slice(0, 20).map((n: any) => `${n.name}@${n.x},${n.z}`).join(' ; '));
}, {
    timeout: 120_000,
});
