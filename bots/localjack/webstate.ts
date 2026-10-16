import { runScript } from '../../sdk/runner';

await runScript(async ({ sdk }) => {
    const p = sdk.getState()?.player;
    console.log(`AT (${p?.worldX},${p?.worldZ} L${p?.level})`);
    await sdk.scanNearbyLocs(15).catch(() => {});
    const webs = (sdk.getNearbyLocs() ?? []).filter((l) => /web/i.test(l.name) && Math.abs(l.x - 3158) <= 4 && Math.abs(l.z - 3951) <= 4);
    console.log('WEBS ' + webs.map((l: any) => `${l.name}#${l.id}@${l.x},${l.z}`).join(' ; '));
}, {
    timeout: 90_000,
});
