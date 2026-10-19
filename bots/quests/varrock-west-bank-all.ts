/**
 * Walk to Varrock West bank, deposit everything in the inventory (worn gear stays on),
 * then close the bank and park. Safe-stop: restarts re-walk a near-zero leg and
 * deposit nothing, so it never over-delivers.
 *
 * Approach from the east side of the booths — crowded booths read UNREACHABLE
 * from the west side.
 *
 *   bun bots/quests/varrock-west-bank-all.ts ABGARMY10
 */
import { appendFileSync } from 'fs';
import { join } from 'path';
import { runScript } from '../../sdk/runner';

const botName = process.argv.slice(2).find((a) => !a.startsWith('-')) ?? '';
const GRIND_LOG = join(process.cwd(), 'bots', botName, 'grind.log');

/** Varrock west bank booths (south of the GE table). */
const BANK = { x: 3186, z: 3436 };
/** Open tile east of the booths. */
const BANK_EAST = { x: 3195, z: 3440 };
const CASTLE_STAIRS = { x: 3205, z: 3208 };

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
        return { x: p?.worldX ?? 0, z: p?.worldZ ?? 0, level: p?.level ?? 0 };
    };
    const distTo = (x: number, z: number) => {
        const p = pos();
        return Math.hypot(p.x - x, p.z - z);
    };

    log(`BANK-ALL start @ ${pos().x},${pos().z} L${pos().level} -> Varrock west`);

    // The Duke's room is upstairs in Lumbridge castle; the bank route starts on the ground floor.
    for (let i = 0; i < 3 && pos().level > 0; i++) {
        if (distTo(CASTLE_STAIRS.x, CASTLE_STAIRS.z) > 3) await bot.walkTo(CASTLE_STAIRS.x, CASTLE_STAIRS.z, 2);
        await sdk.scanNearbyLocs(8).catch(() => {});
        const loc = (sdk.getNearbyLocs() ?? [])
            .filter(
                (l) =>
                    /stair|ladder/i.test(l.name) &&
                    Math.hypot(l.x - CASTLE_STAIRS.x, l.z - CASTLE_STAIRS.z) <= 4 &&
                    (l.optionsWithIndex ?? []).some((o) => /climb-down|climb.down/i.test(o.text))
            )
            .sort((a, b) => (a.distance ?? 99) - (b.distance ?? 99))[0];
        if (!loc) {
            log(`BANK-ALL no castle stairs down near ${pos().x},${pos().z} L${pos().level}`);
            break;
        }
        const match = loc.optionsWithIndex.find((o) => /climb-down|climb.down/i.test(o.text));
        if (!match) break;
        const before = pos().level;
        await sdk.sendInteractLoc(loc.x, loc.z, loc.id, match.opIndex);
        await sdk.waitForCondition((s) => (s.player?.level ?? before) !== before, 8_000).catch(() => {});
    }

    if (distTo(BANK_EAST.x, BANK_EAST.z) > 4) {
        const walk = await bot.walkTo(BANK_EAST.x, BANK_EAST.z, 3);
        if (!walk.success && distTo(BANK_EAST.x, BANK_EAST.z) > 6) {
            log(`BANK-ALL walk failed: ${walk.message}`);
            return;
        }
    }

    let opened = await bot.openBank();
    if (!opened.success) {
        await bot.walkTo(BANK_EAST.x, BANK_EAST.z, 2).catch(() => undefined);
        await sdk.waitForTicks(2).catch(() => {});
        opened = await bot.openBank();
    }
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
