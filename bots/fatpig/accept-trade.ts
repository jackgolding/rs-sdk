import { runScript } from '../../sdk/runner';

await runScript(async ({ bot }) => {
    const result = await bot.serveTrades({
        from: /jackthief/i,
        accept: () => true,
        timeout: 90_000,
        maxTrades: 1
    });
    console.log('Serve result:', result);
    return result;
});
