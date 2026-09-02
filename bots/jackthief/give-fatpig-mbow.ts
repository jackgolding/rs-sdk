import { runScript } from '../../sdk/runner';

await runScript(async ({ bot, sdk }) => {
    await bot.dismissBlockingUI();
    const opened = await bot.openBank();
    if (!opened.success) throw new Error(opened.message);
    await bot.withdrawItem(/magic longbow/i, 1);
    await bot.withdrawItem(/rune arrow/i, 1000);
    await bot.closeBank();
    const result = await bot.trade(/^fatpig$/i, {
        give: [
            { item: /magic longbow/i, amount: 1 },
            { item: /rune arrow/i, amount: 1000 }
        ],
        accept: () => true,
        timeout: 60_000,
        requestTimeout: 45_000,
        retryOnBusy: true
    });
    console.log('Trade result:', result);
    return result;
});
