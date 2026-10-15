/**
 * Unstuck helper: closes dialogs/trades, opens blocking doors, walks to safe ground.
 *
 *   bun bots/quests/unstuck.ts jacklove1
 */
import { runScript } from '../../sdk/runner';
import { playerPos, closeUi } from './movement';

const botName = process.argv.slice(2).find((a) => !a.startsWith('-')) ?? '';
if (!botName) throw new Error('Usage: bun bots/quests/unstuck.ts {name}');

await runScript(async ({ bot, sdk }) => {
    console.log(`[unstuck] Starting unstuck for ${botName}...`);
    await closeUi(bot, sdk);
    if (sdk.getTradeState().isOpen) {
        await bot.declineTrade().catch(() => {});
    }

    const p = playerPos(sdk);
    console.log(`[unstuck] Initial position: (${p.x}, ${p.z}) Level ${p.level}`);

    const locs = sdk.getNearbyLocs();
    console.log(`[unstuck] Nearby locs count: ${locs.length}`);
    for (const l of locs) {
        if (/door|gate/i.test(l.name)) {
            console.log(`[unstuck] Door: ${l.name} id=${l.id} @ (${l.x},${l.z}) dist=${l.distance} options=${JSON.stringify(l.optionsWithIndex)}`);
        }
    }

    const door = locs.find((l) => /door|gate/i.test(l.name) && (l.distance ?? 99) <= 2);
    if (door) {
        const openOpt = door.optionsWithIndex.find((o) => /^open$/i.test(o.text));
        const opIndex = openOpt?.opIndex ?? 1;
        console.log(`[unstuck] Clicking door at (${door.x}, ${door.z}) with opIndex ${opIndex}, id ${door.id}`);
        const res = await sdk.sendInteractLoc(door.x, door.z, door.id, opIndex);
        console.log(`[unstuck] sendInteractLoc result:`, res);
        await sdk.waitForTicks(3);
    }

    // Step through the door
    console.log(`[unstuck] Stepping outside to (2816, 3449)...`);
    await sdk.sendWalk(2816, 3449, true);
    await sdk.waitForTicks(4);

    const pMid = playerPos(sdk);
    console.log(`[unstuck] Position after step: (${pMid.x}, ${pMid.z})`);

    // Walk to Catherby bank
    console.log(`[unstuck] Walking to Catherby Bank (2809, 3441)...`);
    await bot.walkTo(2809, 3441, 2);

    const pEnd = playerPos(sdk);
    console.log(`[unstuck] Final position: (${pEnd.x}, ${pEnd.z})`);
});
