/**
 * Pick up dragonfire shields lying on the floor near the Duke's room, until the
 * bag is full or none are left within reach. Run after the drop loop is stopped.
 *
 *   bun bots/quests/jackthief-pickup-shields.ts jackthief
 */
import { appendFileSync } from 'fs';
import { join } from 'path';
import { runScript } from '../../sdk/runner';

const botName = process.argv.slice(2).find((a) => !a.startsWith('-')) ?? '';
const GRIND_LOG = join(process.cwd(), 'bots', botName, 'grind.log');

const FIRE_SHIELD = /dragonfire shield|anti-?dragon/i;
const MAX_MISSES = 3;

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

    const shieldsOnPerson = () =>
        sdk.getInventory().filter((i) => FIRE_SHIELD.test(i.name)).reduce((n, i) => n + (i.count ?? 1), 0);
    // getInventory() lists only occupied slots.
    const freeSlots = () => Math.max(0, 28 - sdk.getInventory().length);

    log(`PICKUP-SHIELDS start: ${shieldsOnPerson()} on me, ${freeSlots()} free slots`);

    let picked = 0;
    let misses = 0;
    while (freeSlots() > 0 && misses < MAX_MISSES) {
        const scanned = (await sdk.scanGroundItems(12).catch(() => null)) ?? [];
        const pushed = sdk.getGroundItems() ?? [];
        const pool = scanned.length ? scanned : pushed;
        const ground = pool
            .filter((g) => FIRE_SHIELD.test(g.name) && (g.reachable !== false || (g.distance ?? 99) === 0))
            .sort((a, b) => (a.distance ?? 99) - (b.distance ?? 99))[0];
        if (!ground) {
            misses++;
            await sdk.waitForTicks(2).catch(() => {});
            continue;
        }
        const before = shieldsOnPerson();
        const r = await bot.pickupItem(ground);
        await sdk.waitForTicks(1).catch(() => {});
        const gained = shieldsOnPerson() - before;
        if (gained > 0 || r.success) {
            picked += Math.max(gained, 1);
            misses = 0;
        } else {
            misses++;
            if (/inventory/i.test(r.message)) break;
        }
    }

    log(`PICKUP-SHIELDS done: picked ${picked}, ${shieldsOnPerson()} shields on me, ${freeSlots()} free slots`);
});
