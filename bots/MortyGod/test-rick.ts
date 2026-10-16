import { runScript } from '../../sdk/runner';

await runScript(async ({ bot, sdk }: any) => {
    await bot.skipTutorial().catch(() => {});
    await sdk.say('::tele 0,50,50,21,22');
    await sdk.waitForTicks(8).catch(() => {});
    const p0 = sdk.getState()?.player;
    console.log(`START (${p0?.worldX},${p0?.worldZ} L${p0?.level})`);

    // Rick should be in Lumbridge courtyard near (3221,3222)
    const npcs = (sdk.getState()?.npcs ?? []).map((n: any) => `${n.name}@(${n.x},${n.z})`).join(' | ');
    console.log('NEARBY-NPCS ' + npcs.slice(0, 400));
    const rick = sdk.findNearbyNpc(/rick/i);
    if (!rick) {
        console.log('RICK-NOT-FOUND');
        return;
    }
    console.log(`RICK-FOUND ${rick.name}@(${rick.x},${rick.z}) d=${rick.distance}`);

    const talk = await bot.talkTo(rick);
    console.log('TALK ' + talk.success + ' ' + talk.message);
    await sdk.waitForTicks(5).catch(() => {});
    let dlg = sdk.getState()?.dialog;
    console.log('DIALOG open=' + dlg?.isOpen + ' opts=' + JSON.stringify(dlg?.options?.map((o: any) => o.text)));
    // click through to the choice, pick Mage Bank
    for (let i = 0; i < 6; i++) {
        dlg = sdk.getState()?.dialog;
        if (!dlg?.isOpen) break;
        if (dlg.isWaiting) { await sdk.waitForTicks(2).catch(() => {}); continue; }
        const opts = dlg.options ?? [];
        const pick = opts.find((o: any) => /mage bank/i.test(o.text)) ?? opts[0];
        if (pick) await sdk.sendClickDialog(pick.index);
        else await sdk.sendClickDialog(0);
        await sdk.waitForTicks(3).catch(() => {});
    }
    const p1 = sdk.getState()?.player;
    console.log(`END (${p1?.worldX},${p1?.worldZ} L${p1?.level})`);
}, { timeout: 180_000 });
