import { runScript } from '../../sdk/runner';

await runScript(async ({ sdk }: any) => {
    const before = (sdk.getState()?.gameMessages ?? []).length;
    await sdk.say('~cq');
    for (let i = 0; i < 12; i++) {
        await sdk.waitForTicks(3).catch(() => {});
        const st: any = sdk.getState();
        const d: any = sdk.getDialog();
        const msgs = (st?.gameMessages ?? []).map((m: any) => m.text ?? m.message ?? JSON.stringify(m));
        const tail = msgs.slice(-3).join(' | ');
        console.log(`t${i} dialog=${d?.isOpen ? JSON.stringify(d).slice(0, 200) : 'none'} msgs: ${tail}`);
        if (d?.isOpen) {
            let r: any = await sdk.clickDialogByText(/black arm/i).catch(() => null);
            if (!r?.success) r = await sdk.clickDialogByText(/armadyl/i).catch(() => null);
            if (!r?.success) r = await sdk.sendClickDialog(0).catch(() => null);
            console.log(`  clicked ${r?.success} ${r?.message ?? ''}`);
        }
    }
}, { timeout: 150_000 });
