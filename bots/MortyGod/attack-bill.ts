import { runScript } from '../../sdk/runner';

await runScript(async ({ sdk }: any) => {
    let st = sdk.getState();
    console.log(`[ab3] me lvl=${st?.player?.combatLevel} hp=${st?.player?.hp ?? st?.player?.hitpoints}`);
    // eat lobsters to full
    for (let i = 0; i < 6; i++) {
        st = sdk.getState();
        const inv = (st?.inventory ?? []) as any[];
        const lob = inv.find((x: any) => /lobster/i.test(x.name));
        if (!lob) { console.log('[ab3] no lobster left'); break; }
        const r = await sdk.sendUseItem(lob.slot, 1).catch((e: any) => ({ ok: false, err: String(e) }));
        console.log(`[ab3] eat ${i}:`, JSON.stringify(r)?.slice(0, 200));
        await sdk.waitForTicks(4).catch(() => {});
    }
    st = sdk.getState();
    const nps = (st?.nearbyPlayers ?? []) as any[];
    for (const p of nps) console.log(`[ab3] nearby ${p.name} lvl=${p.combatLevel} idx=${p.index}`);
    const bill = nps.find((p: any) => /billpk/i.test(p.name));
    if (!bill) { console.log('[ab3] Bill not visible'); return; }
    const atk = await sdk.sendInteractPlayer(bill.index, 2).catch((e: any) => ({ ok: false, err: String(e) }));
    console.log('[ab3] attack result:', JSON.stringify(atk)?.slice(0, 500));
    await sdk.waitForTicks(8).catch(() => {});
    const st2 = sdk.getState();
    const msgs = ((st2 as any)?.gameMessages ?? []).slice(-5).map((m: any) => m.text).join(' | ');
    console.log('[ab3] msgs:', msgs.slice(0, 400));
    console.log(`[ab3] end hp=${(st2?.player as any)?.hp ?? (st2?.player as any)?.hitpoints} inv=${(st2?.inventory ?? []).map((x: any) => x.name).join(',').slice(0, 200)}`);
}, { timeout: 120_000 });
