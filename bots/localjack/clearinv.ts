import { runScript } from '../../sdk/runner';

await runScript(async ({ sdk }) => {
    await sdk.say('::~clearinv inv');
    await sdk.waitForTicks(4).catch(() => {});
    let inv = sdk.getState()?.inventory ?? [];
    console.log('AFTER-CLEAR slots=' + inv.length);
    await sdk.say('::give shark 5');
    await sdk.waitForTicks(4).catch(() => {});
    inv = sdk.getState()?.inventory ?? [];
    console.log('AFTER-GIVE ' + inv.map((i: any) => `${i.name}x${i.count}`).join(', '));
}, {
    timeout: 90_000,
});
