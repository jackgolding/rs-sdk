/**
 * Walk to Edgeville bank, deposit everything in the inventory (worn gear stays on),
 * then close the bank. Safe park/stop for Edgeville dungeon crews (druids/thugs):
 * climbs out of the dungeon first, so it works from the camp tile.
 *
 *   bun bots/quests/edgeville-bank-all.ts jacklove12
 *
 * One-shot like draynor-bank-all: restarts re-walk a near-zero leg and deposit
 * nothing, so it never over-delivers — safe to leave running as a stop.
 */
import { appendFileSync } from 'fs';
import { join } from 'path';
import { runScript } from '../../sdk/runner';

const botName = process.argv.slice(2).find((a) => !a.startsWith('-')) ?? '';
const GRIND_LOG = join(process.cwd(), 'bots', botName, 'grind.log');

const EDGEVILLE_BANK = { x: 3094, z: 3492 };
const DUNGEON_LADDER = { x: 3096, z: 9867 };
const WILDY_GATE = { x: 3103, z: 9909 };

await runScript(async ({ bot, sdk }) => {
    const log = (msg: string) => {
        const line = `${new Date().toISOString()} ${msg}`;
        console.log(msg);
        try {
            appendFileSync(GRIND_LOG, line + '\n');
        } catch {
            /* ignore */
        }
    };

    const pos = () => {
        const p = sdk.getState()?.player;
        return { x: p?.worldX ?? 0, z: p?.worldZ ?? 0 };
    };
    const distTo = (x: number, z: number) => {
        const p = pos();
        return Math.hypot(p.x - x, p.z - z);
    };
    const inDungeon = () => pos().z > 6400;

    log(`BANK-ALL start @ ${pos().x},${pos().z}`);

    // Climb out of the Edgeville dungeon (druids/thugs camp is underground).
    if (inDungeon()) {
        if (pos().z >= WILDY_GATE.z) {
            await bot.walkTo(WILDY_GATE.x, WILDY_GATE.z + 6, 3).catch(() => undefined);
            const gate = sdk.findNearbyLoc(/gate/i, { withOption: /open/i });
            if (gate) await bot.openDoor(gate).catch(() => undefined);
            await bot.walkTo(WILDY_GATE.x, WILDY_GATE.z - 6, 3).catch(() => undefined);
        }
        await bot.walkTo(DUNGEON_LADDER.x, DUNGEON_LADDER.z, 2).catch(() => undefined);
        const ladder = sdk.findNearbyLoc(/^ladder$/i, { withOption: /climb-up/i });
        if (ladder) {
            await bot.interactLoc(ladder, /climb-up/i).catch(() => undefined);
            await sdk.waitForCondition((s) => (s.player?.worldZ ?? 99999) < 6400, 10_000).catch(() => {});
        }
        log(`Surface ${!inDungeon()} @ ${pos().x},${pos().z}`);
        if (inDungeon()) {
            log(`BANK-ALL still in dungeon @ ${pos().x},${pos().z} — will retry next restart`);
            return;
        }
    }

    if (distTo(EDGEVILLE_BANK.x, EDGEVILLE_BANK.z) > 4) {
        const walk = await bot.walkTo(EDGEVILLE_BANK.x, EDGEVILLE_BANK.z, 3);
        if (!walk.success && distTo(EDGEVILLE_BANK.x, EDGEVILLE_BANK.z) > 6) {
            log(`BANK-ALL walk failed: ${walk.message}`);
            return;
        }
    }

    const opened = await bot.openBank();
    if (!opened.success) {
        log(`BANK-ALL could not open bank: ${opened.message}`);
        return;
    }

    let deposited = 0;
    for (let i = 0; i < 60; i++) {
        const item = sdk.getInventory().find((it) => (it.count ?? 0) > 0);
        if (!item) break;
        const r = await bot.depositItem(item, -1);
        if (!r.success && !r.partial) {
            log(`BANK-ALL deposit ${item.name} failed: ${r.message}`);
            break;
        }
        deposited++;
    }

    await bot.closeBank().catch(() => {});
    const left = sdk.getInventory().filter((it) => (it.count ?? 0) > 0).map((it) => it.name);
    log(`BANK-ALL done: ${deposited} stacks deposited, inventory left: ${left.length ? left.join(', ') : 'empty'}`);
});
