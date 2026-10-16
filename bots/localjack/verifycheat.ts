import { runScript } from '../../sdk/runner';

await runScript(async ({ sdk }) => {
    await sdk.say('::getcoord');
    await sdk.waitForTicks(4).catch(() => {});
    const msgs = sdk.getState()?.gameMessages ?? [];
    console.log('CHAT-TAIL ' + msgs.slice(-5).map((m: any) => m.text ?? m.message ?? JSON.stringify(m)).join(' | '));
    await sdk.say('::give shark 5');
    await sdk.waitForTicks(4).catch(() => {});
    const inv = sdk.getState()?.inventory ?? [];
    console.log('INV-SHARKS ' + inv.filter((i: any) => /shark/i.test(i.name)).map((i: any) => `${i.name}x${i.count}`).join(', '));
}, {
    timeout: 90_000,
});
