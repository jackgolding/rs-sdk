import { runScript } from '../../sdk/runner';

// Test setup: fast world + food, then exit so agility-route can take over.
await runScript(async ({ sdk }) => {
    await sdk.say('::speed 30');
    await sdk.waitForTicks(2).catch(() => {});
    await sdk.say('::give shark 20');
    await sdk.waitForTicks(2).catch(() => {});
    const st = sdk.getState();
    console.log(
        'SETUP inv=' + (st?.inventory?.length ?? -1) + ' ' +
            (st?.inventory ?? []).map((i: any) => `${i.name}x${i.count}`).join(', ')
    );
}, {
    timeout: 90_000,
});
