import { runScript } from '../../sdk/runner';

// Complete every quest via the ::cq debugproc (needs two gang/side choices), then wear the rune platebody.
await runScript(async ({ sdk, bot }: any) => {
    await sdk.say('::~cq');

    for (let i = 0; i < 10; i++) {
        await sdk.waitForTicks(4).catch(() => {});
        const d: any = sdk.getDialog();
        if (!d?.isOpen) continue;
        const opts = (d.options ?? []).map((o: any) => o.text).join(' / ');
        console.log(`dialog: "${d.text ?? ''}" opts=[${opts}]`);
        let r: any = await sdk.clickDialogByText(/black arm/i).catch(() => null);
        if (!r?.success) r = await sdk.clickDialogByText(/armadyl/i).catch(() => null);
        if (!r?.success) r = await sdk.sendClickDialog(0).catch(() => null);
        console.log(`  clicked: ${r?.success} ${r?.message ?? ''}`);
    }

    await sdk.waitForTicks(6).catch(() => {});
    const res: any = await bot.equipItem(/rune platebody/i).catch((e: any) => ({ success: false, message: String(e) }));
    console.log(`rune_platebody: ${res?.success ? 'EQUIPPED' : 'no - ' + (res?.message ?? '?')}`);
    const st: any = sdk.getState();
    console.log('EQUIP: ' + (st?.equipment ?? []).map((e: any) => e.name).join(', '));
}, { timeout: 150_000 });
