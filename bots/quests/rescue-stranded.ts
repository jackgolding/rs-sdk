/**
 * Rescue an account a failed run left sealed inside a building or on an upper
 * floor, then park it AT a bank. Adapted from the quest-robustness template
 * (templates/rescue-stranded-account.ts).
 *
 *   bun bots/quests/rescue-stranded.ts <bot> --bank=draynor
 *   bun bots/quests/rescue-stranded.ts jacklove9 --bank=varrock-west
 *
 * Why: a quest that dies in a sealed pocket (an upstairs room, a cell, a
 * dungeon landing) cannot reach ANY later script's first leg — walkTo never
 * changes planes, and a pocket's door refuses a long plan — so every later
 * assignment fails identically at the same tile. The escape order is the
 * reusable part: descend first (chord-stepped, because walkTo refuses upstairs
 * legs), then open every door in reach and retry the walk, then bank.
 *
 * It is idempotent: on a healthy account it just walks to the bank and parks.
 *
 * END STATE: PARKED. The box relaunches an exit-0 script every ~16s, so this
 * never exits — it logs one line per 30 minutes while it holds the account.
 * A rescue that cannot free the account parks too, logging `RESCUE STUCK`, so
 * the failure is visible in grind.log instead of looking like a restart loop.
 */
import { appendFileSync } from 'fs';
import { join } from 'path';
import { runScript } from '../../sdk/runner';
import { nextWalkStep } from '../../sdk/activity';

const args = process.argv.slice(2);
const botName = args.find((a) => !a.startsWith('-')) ?? '';
const GRIND_LOG = join(process.cwd(), 'bots', botName, 'grind.log');

/** Banks by slug — the rescue meets the account at the nearest workable one. */
const BANKS: Record<string, { x: number; z: number }> = {
    draynor: { x: 3092, z: 3245 },
    'varrock-west': { x: 3185, z: 3436 },
    'varrock-east': { x: 3253, z: 3420 },
    edgeville: { x: 3094, z: 3492 },
    lumbridge: { x: 3208, z: 3220 },
    'falador-west': { x: 2946, z: 3369 },
    catherby: { x: 2809, z: 3441 }
};

function resolveBank(): { slug: string; x: number; z: number } {
    const raw = (args.find((a) => a.startsWith('--bank=')) ?? '--bank=draynor').slice('--bank='.length);
    const named = BANKS[raw.toLowerCase()];
    if (named) return { slug: raw.toLowerCase(), ...named };
    const pair = raw.split(',').map((n) => Number(n.trim()));
    if (pair.length === 2 && pair.every((n) => Number.isFinite(n) && n > 0)) {
        return { slug: `x${pair[0]},z${pair[1]}`, x: pair[0], z: pair[1] };
    }
    throw new Error(`unknown --bank=${raw}; use one of ${Object.keys(BANKS).join(', ')} or --bank=x,z`);
}

const BANK = resolveBank();

/**
 * Optional operator route (`--route=x,z;x,z;…`), computed offline from this
 * account's tile with `findLongPath` in the fleet checkout. Needed where walkTo
 * gives up: inside a building group it marks an unopenable door as impassable and
 * then reports no route at all, while the atlas still holds a clean path.
 */
const ROUTE: Array<{ x: number; z: number }> = (() => {
    const raw: string | undefined = (args as string[]).find((a: string) => a.startsWith('--route='));
    if (!raw) return [];
    const pairs = raw
        .slice('--route='.length)
        .split(';')
        .map((pair: string) => pair.split(',').map((n: string) => Number(n.trim())))
        .filter((p: number[]) => p.length === 2 && p.every((n: number) => Number.isFinite(n) && n > 0));
    return pairs.map(([x, z]: number[]) => ({ x, z }));
})();

// The Draynor Manor staircase option reads `Walk-down`, not `Climb-down` — an
// exact-word regex left a plane-1 bot looping `no climb-down in scan` forever.
const DOWN = /(climb|walk|go|step)[-. ]?down|^down$/i;
const OPEN = /^open$/i;
const STAIR = /stair|ladder/i;

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
    const sleep = (n: number) => sdk.waitForTicks(n).catch(() => undefined);
    /**
     * Every SDK call here is bounded: a refused or unanswered action must not
     * hang the rescue (an unbounded sendWalk/interact left a real run silent for
     * minutes with the loop never reaching its next log line).
     */
    const bound = async <T>(p: Promise<T> | undefined, ms = 8000): Promise<T | undefined> => {
        if (!p) return undefined;
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
            return await Promise.race([
                p.catch(() => undefined),
                new Promise<undefined>((r) => {
                    timer = setTimeout(() => r(undefined), ms);
                })
            ]);
        } finally {
            if (timer) clearTimeout(timer);
        }
    };
    const locs = () => (sdk.getNearbyLocs() ?? []) as Array<{
        name?: string;
        x: number;
        z: number;
        distance?: number;
        options?: string[];
        optionsWithIndex?: Array<{ text?: string }>;
    }>;
    const hasOption = (l: { options?: string[]; optionsWithIndex?: Array<{ text?: string }> }, re: RegExp) =>
        (l.optionsWithIndex ?? []).some((o) => re.test(o.text ?? '')) || (l.options ?? []).some((t) => re.test(t));
    const dump = (why: string) => {
        const p = pos();
        const near = locs()
            .filter((l) => STAIR.test(l.name ?? '') || /door|gate/i.test(l.name ?? ''))
            .map((l) => `${l.name}@${l.x},${l.z}[${(l.options ?? []).join('/')}]`)
            .slice(0, 8);
        log(`${why} @ ${p.x},${p.z} L${p.level} | ${near.join(' ') || '(no stairs/doors in scan)'}`);
    };

    /** Chord-step to a tile: walkTo refuses legs on an upper plane. */
    const chordTo = async (x: number, z: number, hops = 12) => {
        for (let i = 0; i < hops; i++) {
            const p = pos();
            if (Math.hypot(p.x - x, p.z - z) <= 1) return true;
            const step = nextWalkStep(p, { x, z }, 3);
            const before = `${p.x},${p.z}`;
            await bound(sdk.sendWalk(step.x, step.z, true) as never, 5000);
            await sleep(2);
            if (`${pos().x},${pos().z}` === before) return false;
        }
        return Math.hypot(pos().x - x, pos().z - z) <= 2;
    };

    const openDoors = async (max = 3) => {
        await bound(sdk.scanNearbyLocs(12) as never, 6000);
        // Nearest few only: each interactLoc walks to the door first (~10s with its
        // own retries), so a room with 27 doors costs minutes per pass.
        const doors = locs()
            .filter((l) => hasOption(l, OPEN))
            .sort((a, b) => (a.distance ?? 99) - (b.distance ?? 99))
            .slice(0, max);
        let n = 0;
        for (const door of doors) {
            await bound(bot.interactLoc(door as never, OPEN) as never, 6000);
            n++;
            await sleep(2);
        }
        return n;
    };

    /**
     * Walk an operator-supplied route (`--route=x,z;x,z;…`) with raw hops.
     *
     * Why not walkTo: inside a building group walkTo marks a door it cannot open
     * as impassable for the rest of the session and then reports no route at all,
     * even though the collision atlas holds a clean path (Draynor Manor grounds ->
     * Draynor bank is 66 waypoints). The route is computed offline from the
     * account's tile; waypoints already behind the bot are skipped, and a
     * waypoint that refuses three hops is abandoned so one bad tile cannot wedge
     * the leg.
     */
    const walkRoute = async (route: Array<{ x: number; z: number }>) => {
        let done = 0;
        for (let i = 0; i < route.length; i++) {
            const wp = route[i];
            if (Math.hypot(pos().x - wp.x, pos().z - wp.z) <= 2) continue;
            let refused = 0;
            for (let hop = 0; hop < 6 && refused < 3; hop++) {
                const p = pos();
                if (Math.hypot(p.x - wp.x, p.z - wp.z) <= 2) break;
                if (Math.hypot(p.x - wp.x, p.z - wp.z) > 12) break; // drifted away from this leg
                const step = nextWalkStep(p, wp, 3);
                const before = `${p.x},${p.z}`;
                await bound(sdk.sendWalk(step.x, step.z, true) as never, 5000);
                await sleep(2);
                if (`${pos().x},${pos().z}` === before) {
                    refused++;
                    await openDoors(2);
                }
            }
            if (refused < 3) done++;
            if (i % 10 === 0) log(`route ${i + 1}/${route.length} @ ${pos().x},${pos().z} (${done} cleared)`);
        }
        log(`route walked: ${done}/${route.length} waypoints cleared -> @ ${pos().x},${pos().z} L${pos().level}`);
        return Math.hypot(pos().x - BANK.x, pos().z - BANK.z) <= 6;
    };

    log(`RESCUE start @ ${pos().x},${pos().z} L${pos().level} bank=${BANK.slug}(${BANK.x},${BANK.z})`);

    // 1. Descend to plane 0. walkTo never changes planes, so this is chord steps
    //    to the nearest climb-down and a verified plane change per round.
    let sweeps = 0;
    for (let round = 0; round < 16 && pos().level > 0; round++) {
        await bound(sdk.scanNearbyLocs(20) as never, 6000);
        const downs = locs()
            .filter((l) => hasOption(l, DOWN))
            .sort((a, b) => (a.distance ?? 99) - (b.distance ?? 99));
        const stairs = downs[0];
        if (!stairs) {
            const opened = await openDoors();
            // A staircase whose options we can see may be the way off this plane
            // once we stand on it — approach the nearest one anyway.
            const near = locs()
                .filter((l) => STAIR.test(l.name ?? ''))
                .sort((a, b) => (a.distance ?? 99) - (b.distance ?? 99))[0];
            if (near && sweeps < 8) {
                sweeps++;
                log(`no climb-down in scan (doors opened ${opened}) — approaching ${near.name}@${near.x},${near.z}`);
                await chordTo(near.x, near.z);
            } else {
                // Sweep the room: the down-stair is usually one screen away.
                sweeps++;
                const p = pos();
                const ring = [
                    { x: p.x + 5, z: p.z },
                    { x: p.x, z: p.z + 5 },
                    { x: p.x - 5, z: p.z },
                    { x: p.x, z: p.z - 5 }
                ];
                const t = ring[sweeps % ring.length];
                log(`no climb-down and no staircase in scan — sweeping to ${t.x},${t.z}`);
                await chordTo(t.x, t.z, 4);
            }
            if (sweeps > 14) {
                dump('STILL ON AN UPPER FLOOR — no staircase in reach');
                break;
            }
            continue;
        }
        const before = pos().level;
        log(`climbing down ${stairs.name}@${stairs.x},${stairs.z} from L${before}`);
        if (Math.hypot(pos().x - stairs.x, pos().z - stairs.z) > 2) await chordTo(stairs.x, stairs.z);
        await bound(bot.interactLoc(stairs as never, DOWN) as never, 8000);
        for (let i = 0; i < 12 && pos().level === before; i++) await sleep(2);
        log(`  plane now L${pos().level} @ ${pos().x},${pos().z}`);
    }
    const grounded = pos().level === 0;

    /**
     * Last-resort escape from a pocket the pathfinder cannot leave: raw
     * sendWalk hops toward the bank (walkTo reports `no waypoints` from inside
     * a sealed room), opening doors and probing the 8 neighbours whenever a hop
     * is refused. Returns true once a hop actually moved the bot.
     */
    const hopOut = async (round: number) => {
        let moved = 0;
        for (let h = 0; h < 12; h++) {
            const p = pos();
            if (Math.hypot(p.x - BANK.x, p.z - BANK.z) <= 3) break;
            const step = nextWalkStep(p, BANK, 3);
            const before = `${p.x},${p.z}`;
            await bound(sdk.sendWalk(step.x, step.z, true) as never, 5000);
            await sleep(2);
            if (`${pos().x},${pos().z}` !== before) {
                moved++;
                continue;
            }
            const opened = await openDoors();
            let escaped = false;
            for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) {
                const q = pos();
                await bound(sdk.sendWalk(q.x + dx, q.z + dz, true) as never, 5000);
                await sleep(1);
                if (`${pos().x},${pos().z}` !== `${q.x},${q.z}`) {
                    escaped = true;
                    moved++;
                    break;
                }
            }
            if (!escaped) log(`hop ${h + 1} refused at ${pos().x},${pos().z} (doors opened ${opened}) — no exit step`);
        }
        log(`hop-out round ${round + 1}: moved ${moved} hops -> @ ${pos().x},${pos().z} L${pos().level}`);
        return moved > 0;
    };

    // 2. Walk out and reach the bank. A sealed pocket refuses a long plan, so
    //    every round opens the doors in reach, retries walkTo, then falls back to
    //    raw hops. Success is proven by the BANK OPENING, not by distance (the
    //    target bank is often only a few tiles from the pocket).
    let banked = false;
    for (let round = 0; round < 14 && grounded && !banked; round++) {
        if (ROUTE.length) {
            // A supplied route is authoritative: walk it raw, then bank.
            await walkRoute(ROUTE);
        } else {
            const walk = (await bound(bot.walkTo(BANK.x, BANK.z, 3) as never, 20000)) ?? { success: false, message: 'walkTo timed out' };
            const p = pos();
            log(`walk attempt ${round + 1}: ok=${(walk as { success?: boolean }).success} @ ${p.x},${p.z} L${p.level}`);
            if (!(walk as { success?: boolean }).success) {
                const opened = await openDoors();
                log(`doors opened ${opened}`);
                if (round < 6) await hopOut(round);
            }
        }
        // 20s: openBank walks to the nearest booth first, and a 10s bound cut it
        // short on a bot standing two tiles from the Varrock West booth.
        const bank = ((await bound(bot.openBank() as never, 20000)) as { success?: boolean; message?: string }) ?? {
            success: false,
            message: 'openBank timed out'
        };
        if (bank.success) {
            banked = true;
            break;
        }
        log(`bank closed at ${pos().x},${pos().z} (${(bank as { message?: string }).message ?? 'unknown'})`);
        await sleep(2);
    }

    if (banked) {
        await sleep(2);
        for (let pass = 0; pass < 24; pass++) {
            const item = sdk.getInventory().find((i) => (i.count ?? 0) > 0);
            if (!item) break;
            await bound(bot.depositItem(item, -1) as never, 8000);
        }
        await bound(bot.closeBank() as never, 8000);
    }

    const p = pos();
    const verdict = banked ? 'PARKED at bank' : grounded ? 'STUCK — no bank reached' : 'STUCK — still on an upper floor';
    log(`RESCUE ${verdict} @ ${p.x},${p.z} L${p.level} bank=${BANK.slug} bag=${sdk.getInventory().length} slots`);

    // 3. Hold the account. Never exit 0 — a relaunch would redo the whole rescue.
    for (;;) {
        await new Promise((r) => setTimeout(r, 30 * 60 * 1000));
        const q = pos();
        log(`RESCUE still parked (${verdict}) @ ${q.x},${q.z} L${q.level}`);
    }
});
