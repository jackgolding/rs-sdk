/**
 * Walk to Falador east bank, deposit everything in the inventory (worn gear
 * stays on), then close the bank. The Falador-east equivalent of
 * draynor-bank-all.ts: routes via the Rimmington/Falador south road so it works
 * from the Rimmington mine, the crafters and the Lumbridge side alike.
 *
 *   bun bots/quests/falador-bank-all.ts jacklove1
 */
import { appendFileSync } from 'fs';
import { join } from 'path';
import { runScript } from '../../sdk/runner';
import { initPathfinding } from '../../sdk/pathfinding';

const botName = process.argv.slice(2).find((a) => !a.startsWith('-')) ?? '';
const GRIND_LOG = join(process.cwd(), 'bots', botName, 'grind.log');

const FALADOR_EAST_BANK = { x: 3012, z: 3355 };
/** Shortcut via Falador south-east; the same corridor rimmington-iron uses. */
const APPROACH = [
    { x: 3010, z: 3265 },
    { x: 3007, z: 3340 }
];

initPathfinding();

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
    const distTo = (x: number, z: number) => Math.hypot(pos().x - x, pos().z - z);
    const bagSlots = () => sdk.getInventory().filter((i) => (i.count ?? 0) > 0).length;

    async function closeUi(): Promise<void> {
        const s = sdk.getState();
        if (s?.shop?.isOpen || s?.bank?.isOpen || s?.interface?.isOpen) await bot.closeInterface();
        await bot.dismissBlockingUI();
    }

    async function walkNear(x: number, z: number, tolerance = 4): Promise<boolean> {
        if (distTo(x, z) <= tolerance) return true;
        const r = await bot.walkTo(x, z, Math.min(tolerance, 3));
        return r.success || distTo(x, z) <= tolerance + 2;
    }

    async function openToward(tx: number, tz: number): Promise<void> {
        const door = (sdk.getNearbyLocs() ?? [])
            .filter(
                (l) =>
                    /door|gate/i.test(l.name) &&
                    l.reachable !== false &&
                    l.optionsWithIndex.some((o) => /^open$/i.test(o.text))
            )
            .sort((a, b) => Math.hypot(a.x - tx, a.z - tz) - Math.hypot(b.x - tx, b.z - tz))[0];
        if (door && (door.distance ?? 99) <= 10) await bot.openDoor(door);
    }

    async function openBank(): Promise<boolean> {
        for (let attempt = 0; attempt < 6; attempt++) {
            if (sdk.getState()?.bank?.isOpen) return true;
            const r = await bot.openBank();
            if (r.success || sdk.getState()?.bank?.isOpen) return true;
            await sdk.waitForTicks(2);
        }
        return !!sdk.getState()?.bank?.isOpen;
    }

    log(`BANK-ALL start @ ${pos().x},${pos().z} L${pos().level} slots=${bagSlots()}`);

    await closeUi();
    if (pos().level > 0) log(`BANK-ALL warning: on level ${pos().level}, walking anyway`);

    if (distTo(FALADOR_EAST_BANK.x, FALADOR_EAST_BANK.z) > 4) {
        for (const p of APPROACH) {
            if (distTo(FALADOR_EAST_BANK.x, FALADOR_EAST_BANK.z) <= 8) break;
            // Only hop via the corridor when it is on the way, not a detour.
            if (Math.hypot(FALADOR_EAST_BANK.x - p.x, FALADOR_EAST_BANK.z - p.z) >= distTo(FALADOR_EAST_BANK.x, FALADOR_EAST_BANK.z)) continue;
            await walkNear(p.x, p.z, 6);
        }
        await openToward(FALADOR_EAST_BANK.x, FALADOR_EAST_BANK.z);
        await walkNear(FALADOR_EAST_BANK.x, FALADOR_EAST_BANK.z, 2);
    }
    log(`BANK-ALL at bank @ ${pos().x},${pos().z} d=${distTo(FALADOR_EAST_BANK.x, FALADOR_EAST_BANK.z).toFixed(1)}`);

    if (!(await openBank())) {
        log(`BANK-ALL bank open failed @ ${pos().x},${pos().z} — will retry next restart`);
        return;
    }

    let deposited = 0;
    for (let pass = 0; pass < 4; pass++) {
        const item = sdk.getInventory().find((i) => (i.count ?? 0) > 0);
        if (!item) break;
        const r = await bot.depositItem(item, -1);
        if (r.success) deposited++;
        else await sdk.waitForTicks(1);
    }
    await bot.closeBank();
    await closeUi();
    log(`BANK-ALL done: ${deposited} stack(s) deposited, slots left=${bagSlots()} @ ${pos().x},${pos().z}`);
});
