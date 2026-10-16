import { runScript } from '../../sdk/runner';

await runScript(async ({ bot, sdk }) => {
    await sdk.scanNearbyLocs(15).catch(() => {});
    const lever = (sdk.getNearbyLocs() ?? []).find((l) => l.id === 1814);
    if (!lever) {
        console.log('NO-LEVER');
        return;
    }
    await bot.walkTo(lever.x, lever.z, 1);
    await bot.interactLoc(lever, 'Pull');
    await sdk.waitForTicks(5).catch(() => {});
    const d = sdk.getDialog();
    console.log('DIALOG ' + JSON.stringify({ open: d?.isOpen, text: (d as any)?.text?.slice(0, 120), options: (d as any)?.options }));
    if (d?.isOpen) {
        const opts = (d as any)?.options ?? [];
        const yes = opts.findIndex((o: any) => /yes|pull|continue|teleport/i.test(o?.text ?? o ?? ''));
        console.log('YES-IDX ' + yes);
        if (yes >= 0) {
            await sdk.sendClickDialog((opts[yes] as any)?.index ?? yes);
            await sdk.waitForTicks(5).catch(() => {});
        }
    }
    await sdk.waitForCondition((s) => {
        const dx = Math.abs((s.player?.worldX ?? 0) - 2561);
        const dz = Math.abs((s.player?.worldZ ?? 0) - 3311);
        return Math.max(dx, dz) > 30;
    }, 20_000).catch(() => {});
    await sdk.waitForTicks(8).catch(() => {});
    const p1 = sdk.getState()?.player;
    console.log(`LANDED2 (${p1?.worldX},${p1?.worldZ} L${p1?.level})`);
}, {
    timeout: 150_000,
});
