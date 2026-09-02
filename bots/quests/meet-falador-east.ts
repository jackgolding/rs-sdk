/**
 * Walk to Falador east bank and stop.
 *
 *   bun bots/quests/meet-falador-east.ts Jackpoo2
 *   bun bots/quests/meet-falador-east.ts Jackpoo4
 *   bun bots/quests/meet-falador-east.ts Jackpoo5
 */
import { runScript } from '../../sdk/runner';
import { inMiningGuild } from '../../sdk/index';

const BANK = { x: 3012, z: 3355 };
const LADDER_DOWN = { x: 3019, z: 9739 };
const TO_BANK_FROM_RIMMINGTON = [
    { x: 3010, z: 3265 },
    { x: 3007, z: 3340 },
    { x: 3012, z: 3355 }
];

await runScript(async ({ bot, sdk }) => {
    const pos = () => {
        const p = sdk.getState()!.player;
        return { x: p.worldX, z: p.worldZ };
    };
    const dist = (x: number, z: number) => Math.hypot(pos().x - x, pos().z - z);

    await bot.closeInterface();

    if (inMiningGuild(pos().x, pos().z)) {
        console.log(`Guild @ ${pos().x},${pos().z} — climbing out`);
        if (dist(LADDER_DOWN.x, LADDER_DOWN.z) > 2) {
            const walk = await bot.walkTo(LADDER_DOWN.x, LADDER_DOWN.z, 2);
            console.log('ladder walk', walk.message);
        }
        const ladder = sdk.findNearbyLoc(/ladder/i);
        if (!ladder) {
            console.log('No ladder nearby');
            return;
        }
        const climb = await bot.interactLoc(ladder, /climb-up/i);
        console.log('climb', climb.message);
        await sdk.waitForCondition(() => !inMiningGuild(pos().x, pos().z), 10_000);
    }

    const p = pos();
    if (p.z < 3300) {
        console.log(`Rimmington-side @ ${p.x},${p.z}`);
        for (const wp of TO_BANK_FROM_RIMMINGTON) {
            if (dist(wp.x, wp.z) <= 8) continue;
            const r = await bot.walkTo(wp.x, wp.z, 6);
            console.log(`wp ${wp.x},${wp.z}`, r.message);
        }
    }

    const r = await bot.walkTo(BANK.x, BANK.z, 2);
    const here = pos();
    console.log(`arrive ${here.x},${here.z}`, r.message);
}, { timeout: 180_000 });
