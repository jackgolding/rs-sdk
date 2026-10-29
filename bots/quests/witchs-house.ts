/**
 * Witch's House — fetch the boy's ball from the witch's shed, Taverley.
 *
 *   bun bots/quests/witchs-house.ts {botname}
 *
 * Journal rules from quest_ball/scripts/ball_journal.rs2; mechanics from
 * quest_ball.rs2, witch.rs2 and witches_experiement.rs2. Tiles are content
 * placements (maps/m45_54 and its cellar m45_154). Items:
 *   - leather gloves  lib/sources.ts (Thessalia); worn for the cellar's shock gate
 *   - cheese          lib/sources.ts (Wydin); lures the mouse out of its hole
 *   - door key, magnet, shed key, ball: quest items taken in this script
 *
 * The garden: hedges fence the witch's patrol (z 3463, x 2904-2930) off from
 * the paths the player uses — the z 3460 strip, the x 2933 column by the shed
 * and the z 3466 strip to the fountain. witch.rs2 catches a player within 3
 * tiles of her in line of sight unless a hedge stands on the tile between, and
 * throws them out with the shed key and ball taken. So the paths are walked in
 * hops between hedge-covered tiles, only while she is far enough away.
 */
import { runQuest, type Quest } from './lib/run-quest';
import { tickNow, untilTicks } from './lib/ticks';

type Tile = { x: number; z: number };

const BOY = { x: 2928, z: 3456 };
/** Outside the front door (2901,3473); the key pot is beside it (2900,3474). */
const FRONT_DOOR_OUT = { x: 2900, z: 3473 };
const FRONT_DOOR = { x: 2901, z: 3473 };
const KEY_POT = { x: 2900, z: 3474 };
/** House interior. */
const CELLAR_LADDER = { x: 2907, z: 3476 };
const MOUSE_HOLE = { x: 2903, z: 3466 };
/**
 * The back porch (x 2901-2902, z 3466-3467) behind the door at (2902,3468): the
 * mouse hole is on its east wall, the back door (2901,3465) in its south wall.
 * The static pathfinder does not know that door, so it is opened by hand.
 */
const BACK_PORCH = { x: 2901, z: 3466 };
const PORCH_DOOR = { x: 2902, z: 3468 };
const MAIN_ROOM = { x: 2902, z: 3469 };
const BACK_DOOR = { x: 2901, z: 3465 };
/** Cellar (z + 6400): the ladder up, the shock gate (on the east edge of x 2902) and the magnet cupboard west of it. */
const CELLAR_UP = { x: 2907, z: 9876 };
const SHOCK_GATE = { x: 2902, z: 9873 };
/** Either leaf of the double shock gate passes; another player's pass swaps one out for 3 ticks. */
const SHOCK_GATE_LEAVES = [SHOCK_GATE, { x: 2902, z: 9874 }];
const MAGNET_CUPBOARD = { x: 2898, z: 9873 };
const FOUNTAIN = { x: 2909, z: 3470 };
const SHED_DOOR = { x: 2934, z: 3463 };

const WITCH = /^nora t\.? hagg$/i;
const EXPERIMENT = /^witches experiment/i;
const DOOR_KEY = /^door key$/i;
const SHED_KEY = /^key$/i;
const MAGNET = /^magnet$/i;
const BALL = /^ball$/i;

/** witch.rs2 huntall(npc_coord, 3, 0): she only looks this far. */
const WITCH_SIGHT = 3;
/** Ticks a hop's walk packet takes to land and the bot to start moving (latency + a tick of slack). */
const HOP_SLACK_TICKS = 3;

// Garden paths, each tile adjacent to the next (maps/m45_54 collision).
const range = (a: number, b: number, f: (n: number) => Tile): Tile[] => {
    const out: Tile[] = [];
    const step = a <= b ? 1 : -1;
    for (let n = a; n !== b + step; n += step) out.push(f(n));
    return out;
};
/** Back door -> down the x 2901 column -> east along z 3460 -> up the x 2933 column to the shed door. */
const PORCH_TO_SHED: Tile[] = [
    ...range(3465, 3460, (z) => ({ x: 2901, z })),
    ...range(2902, 2933, (x) => ({ x, z: 3460 })),
    ...range(3461, 3463, (z) => ({ x: 2933, z })),
];
/** Shed door -> up the column -> west along z 3466 -> into the fountain's corner. */
const SHED_TO_FOUNTAIN: Tile[] = [
    ...range(3463, 3466, (z) => ({ x: 2933, z })),
    ...range(2932, 2912, (x) => ({ x, z: 3466 })),
    { x: 2912, z: 3467 },
    { x: 2911, z: 3467 },
    { x: 2911, z: 3468 },
];
const reverse = (p: Tile[]) => [...p].reverse();

/**
 * A path tile is covered when the witch cannot catch the player there:
 * witch.rs2 spares a player south of her with a `hedge` on the tile north of
 * them, and one north of her with a `hedge`/`hedgecorner` on the tile south.
 * Hedge placements: m45_54 rows z 3461 and z 3465.
 */
const HEDGE_3461 = new Set([2903, 2907, 2908, 2909, 2915, 2916, 2917, 2923, 2924, 2925, 2929, 2930, 2931]);
const HEDGE_3465 = new Set([2903, 2904, 2905, 2906, 2907, 2908, 2909, 2911, 2912, 2913, 2914, 2919, 2920, 2921, 2926, 2927, 2928, 2932]);
function covered(t: Tile): boolean {
    if (t.z === 3460) return HEDGE_3461.has(t.x);
    if (t.z === 3466) return HEDGE_3465.has(t.x);
    if (t.z === 3463) return true; // level with her patrol: dz = 0 is never caught
    return t.z >= 3467; // the fountain corner is beyond her sight
}

const cheb = (a: Tile, b: Tile) => Math.max(Math.abs(a.x - b.x), Math.abs(a.z - b.z));

function me(q: Quest): Tile & { level: number } {
    const p = q.sdk.getState()!.player!;
    return { x: p.worldX, z: p.worldZ, level: p.level };
}

const onPorch = (t: Tile) => t.x >= 2901 && t.x <= 2902 && t.z >= 3466 && t.z <= 3467;
const inHouse = (t: Tile) => t.x >= 2901 && t.x <= 2908 && t.z >= 3466 && t.z <= 3477;
const inShed = (t: Tile) => t.x >= SHED_DOOR.x && t.x <= 2938 && t.z >= 3459 && t.z <= 3467;
const onGardenPath = (t: Tile) => [...PORCH_TO_SHED, ...SHED_TO_FOUNTAIN].some((p) => cheb(p, t) === 0);

/**
 * Walk `path` (starting on one of its tiles) in hops from one covered tile to
 * the next, sending a hop only while the witch stays out of reach of every
 * uncovered tile in it for as long as the hop takes. Throws if she throws us out.
 */
async function sneak(q: Quest, path: Tile[], label: string): Promise<void> {
    let i = path.findIndex((t) => cheb(t, me(q)) === 0);
    if (i < 0 && covered(path[0]!) && cheb(path[0]!, me(q)) <= 4) {
        // Just off the start (the fountain's corner): step onto it.
        await q.sdk.sendWalk(path[0]!.x, path[0]!.z, true);
        if (await untilTicks(q.sdk, () => cheb(path[0]!, me(q)) === 0, 10)) i = 0;
    }
    if (i < 0) throw new Error(`${label}: not on the path (at ${me(q).x},${me(q).z})`);
    const t0 = tickNow(q.sdk);
    let waited = 0;
    while (i < path.length - 1) {
        let j = i + 1;
        while (j < path.length - 1 && !covered(path[j]!)) j++;
        const hop = path.slice(i + 1, j + 1);
        const ticks = Math.ceil(hop.length / 2) + HOP_SLACK_TICKS;
        const witch = q.sdk.findNearbyNpc(WITCH);
        const safe = !witch || hop.every((t) => covered(t) || cheb(t, witch) > WITCH_SIGHT + ticks);
        if (!safe) {
            await q.sdk.waitForTicks(1);
            if (++waited > 400) throw new Error(`${label}: the witch never left the path near (${path[i]!.x},${path[i]!.z})`);
            continue;
        }
        const dest = path[j]!;
        await q.sdk.sendWalk(dest.x, dest.z, true);
        const arrived = await untilTicks(q.sdk, () => cheb(me(q), dest) === 0, ticks + 8);
        if (!arrived) {
            const at = me(q);
            const k = path.findIndex((t) => cheb(t, at) === 0);
            if (k < 0) throw new Error(`${label}: thrown out of the garden — now at (${at.x},${at.z})`);
            i = k;
            continue;
        }
        i = j;
    }
    q.log(`${label}: ${tickNow(q.sdk) - t0}t (${waited}t waiting on the witch)`);
}

/** Interact with the loc at `tile` (scene names are generic: Door, Gate, Cupboard). */
async function useLoc(q: Quest, at: Tile | Tile[], op: RegExp): Promise<void> {
    await q.sdk.scanNearbyLocs(10).catch(() => undefined);
    const tiles = Array.isArray(at) ? at : [at];
    const tile = tiles[0]!;
    const locs = q.sdk.getNearbyLocs() ?? [];
    const loc = tiles.map((t) => locs.find((l) => l.x === t.x && l.z === t.z && l.options.some((o) => op.test(o)))).find(Boolean);
    if (!loc) {
        const here = (q.sdk.getNearbyLocs() ?? []).filter((l) => cheb(l, tile) <= 1).map((l) => `${l.name}@${l.x},${l.z}[${l.options.join('/')}]`);
        throw new Error(`no ${op} loc at (${tile.x},${tile.z}) from (${me(q).x},${me(q).z}); near it: ${here.join(' ') || 'nothing'}`);
    }
    const r = await q.bot.interactLoc(loc, op);
    if (!r.success) throw new Error(`${loc.name} ${op} at (${loc.x},${loc.z}): ${r.message ?? r.reason ?? 'failed'}`);
}

/**
 * Op a door/gate/ladder at `tile` until `through()` holds. An op sent while the
 * player is still delayed (just off a ladder) is dropped by the server without a
 * word, so a click that changes nothing within 20 ticks is sent again.
 */
async function passLoc(q: Quest, tile: Tile | Tile[], op: RegExp, through: () => boolean, what: string): Promise<void> {
    for (let attempt = 1; attempt <= 8; attempt++) {
        // Doors here are shared: another player passing swaps the loc for a moment
        // (open_and_close_door2), and an op on the swapped loc does nothing.
        const sent = await useLoc(q, tile, op).then(
            () => true,
            (e) => (q.log(`${what}: attempt ${attempt} failed: ${(e as Error).message}`), false),
        );
        if (await untilTicks(q.sdk, through, sent ? 20 : 3 + (attempt % 3))) return;
        if (sent) q.log(`${what}: no effect after attempt ${attempt} (at ${me(q).x},${me(q).z}; ops rejected ${q.sdk.getState()?.opFeedback?.opRejectedCount ?? '?'})`);
    }
    throw new Error(`${what} did not work (at ${me(q).x},${me(q).z})`);
}

/** Close the mesbox a content script is blocked on, so whatever follows it (an inv_add) lands. */
async function drainModal(q: Quest, until: () => boolean, ticks = 30): Promise<boolean> {
    for (let t = 0; t < ticks && !until(); t++) {
        if (q.sdk.getState()?.dialog?.isOpen) await q.bot.dismissBlockingUI().catch(() => undefined);
        await q.sdk.waitForTicks(1);
    }
    return until();
}

/** Into the house by the front door, with the key from the pot beside it. */
async function enterHouse(q: Quest): Promise<void> {
    if (inHouse(me(q))) return;
    await q.goTo(FRONT_DOOR_OUT, 1);
    if (q.count(DOOR_KEY) < 1) {
        await useLoc(q, KEY_POT, /look-under/i);
        if (!(await drainModal(q, () => q.count(DOOR_KEY) > 0))) throw new Error('looked under the pot but no door key');
        q.log('door key from the pot');
    }
    await passLoc(q, FRONT_DOOR, /^open$/i, () => inHouse(me(q)), 'front door in');
}

/** Out of the house by the front door (it opens from inside without the key). */
async function leaveHouse(q: Quest): Promise<void> {
    if (!inHouse(me(q))) return;
    if (onPorch(me(q))) {
        await q.sdk.scanNearbyLocs(4).catch(() => undefined);
        const door = (q.sdk.getNearbyLocs() ?? []).find((l) => l.x === PORCH_DOOR.x && l.z === PORCH_DOOR.z && l.options.some((o) => /^open$/i.test(o)));
        if (door) await q.bot.openDoor(door);
        for (let attempt = 0; attempt < 3 && onPorch(me(q)); attempt++) {
            await q.sdk.sendWalk(MAIN_ROOM.x, MAIN_ROOM.z, true);
            await untilTicks(q.sdk, () => !onPorch(me(q)), 15);
        }
    }
    await q.goTo(FRONT_DOOR, 0);
    await passLoc(q, FRONT_DOOR, /^open$/i, () => !inHouse(me(q)), 'front door out');
}

/** Into the house and through the porch door onto the back porch. */
async function toPorch(q: Quest): Promise<void> {
    if (onPorch(me(q))) return;
    await enterHouse(q);
    await q.goTo(MAIN_ROOM, 0);
    await q.sdk.scanNearbyLocs(4).catch(() => undefined);
    const door = (q.sdk.getNearbyLocs() ?? []).find((l) => l.x === PORCH_DOOR.x && l.z === PORCH_DOOR.z && l.options.some((o) => /^open$/i.test(o)));
    if (door) await q.bot.openDoor(door);
    for (let attempt = 0; attempt < 3 && !onPorch(me(q)); attempt++) {
        await q.sdk.sendWalk(BACK_PORCH.x, BACK_PORCH.z, true);
        await untilTicks(q.sdk, () => onPorch(me(q)), 15);
    }
    if (!onPorch(me(q))) throw new Error(`could not get onto the back porch (at ${me(q).x},${me(q).z})`);
}

/** From the house out of the back door onto the garden path. */
async function intoGarden(q: Quest): Promise<void> {
    await toPorch(q);
    if (cheb(me(q), BACK_PORCH) > 0) {
        await q.sdk.sendWalk(BACK_PORCH.x, BACK_PORCH.z, true);
        await untilTicks(q.sdk, () => cheb(me(q), BACK_PORCH) === 0, 10);
    }
    await passLoc(q, BACK_DOOR, /^open$/i, () => me(q).z <= BACK_DOOR.z, 'back door out (is the mouse door unlocked?)');
}

/** Cellar: through the shock gate (gloves worn), magnet from the cupboard, back up. */
async function fetchMagnet(q: Quest): Promise<void> {
    const gloves = q.sdk.getInventory().find((i) => /^leather gloves$/i.test(i.name));
    if (gloves) await q.bot.equipItem(gloves);
    if (!q.sdk.getEquipment().some((i) => /^leather gloves$/i.test(i.name))) throw new Error('leather gloves not worn for the shock gate');
    if (me(q).z < 9000) {
        await enterHouse(q);
        await q.goTo(CELLAR_LADDER, 1);
        await passLoc(q, CELLAR_LADDER, /climb-down/i, () => me(q).z > 9000, 'cellar ladder down');
    }
    if (me(q).x > SHOCK_GATE.x) {
        await passLoc(q, SHOCK_GATE_LEAVES, /^open$/i, () => me(q).x <= SHOCK_GATE.x, 'shock gate west');
    }
    if (q.count(MAGNET) < 1) await searchCupboard(q);
    await passLoc(q, SHOCK_GATE_LEAVES, /^open$/i, () => me(q).x > SHOCK_GATE.x, 'shock gate east');
    await passLoc(q, CELLAR_UP, /climb-up/i, () => me(q).z < 9000, 'cellar ladder up');
}

/**
 * The magnet cupboard is shared: Open swaps it for the open cupboard (Search/Shut)
 * for everyone, and another player's Shut or Open can land between our two
 * clicks. So each try re-scans, does whichever op the cupboard offers now, and
 * stops only when the magnet is in the inventory.
 */
async function searchCupboard(q: Quest): Promise<void> {
    const t0 = tickNow(q.sdk);
    for (let attempt = 1; attempt <= 12; attempt++) {
        await q.bot.dismissBlockingUI().catch(() => undefined);
        await q.sdk.scanNearbyLocs(10).catch(() => undefined);
        const cb = (q.sdk.getNearbyLocs() ?? []).find((l) => l.x === MAGNET_CUPBOARD.x && l.z === MAGNET_CUPBOARD.z);
        const op = cb?.options.find((o) => /^search$/i.test(o)) ?? cb?.options.find((o) => /^open$/i.test(o));
        if (cb && op) {
            const r = await q.bot.interactLoc(cb, new RegExp(`^${op}$`, 'i')).catch((e) => ({ success: false, message: (e as Error).message }) as { success: boolean; message?: string });
            if (/^search$/i.test(op)) {
                if (await drainModal(q, () => q.count(MAGNET) > 0, 20)) {
                    q.log(`magnet from the cupboard: ${tickNow(q.sdk) - t0}t, ${attempt} tries`);
                    return;
                }
            } else if (r.success) {
                // Opened: wait for the swap to Search before the next try.
                await untilTicks(q.sdk, () => (q.sdk.getNearbyLocs() ?? []).some((l) => l.x === MAGNET_CUPBOARD.x && l.z === MAGNET_CUPBOARD.z && l.options.some((o) => /^search$/i.test(o))), 10);
                continue;
            }
            q.log(`cupboard ${op} try ${attempt}: no magnet${r.success ? '' : ` (${r.message ?? 'failed'})`}`);
        } else {
            q.log(`cupboard try ${attempt}: no cupboard op at (${MAGNET_CUPBOARD.x},${MAGNET_CUPBOARD.z}) [${cb?.options.join('/') ?? 'missing'}]`);
        }
        await q.sdk.waitForTicks(1 + attempt % 3); // back off off-beat from the other players
    }
    throw new Error(`no magnet from the cupboard after 12 tries (at ${me(q).x},${me(q).z})`);
}

/** Cheese on the mouse hole brings out the mouse; the magnet goes on its harness. */
async function magnetTheMouse(q: Quest): Promise<void> {
    if (q.count(MAGNET) < 1) throw new Error('no magnet for the mouse');
    await toPorch(q);
    // The mouse is shared: anyone's cheese deletes the mouse out and brings a new
    // one, anyone's magnet takes it away (quest_ball.rs2). Any mouse will do for
    // our magnet, so put the magnet on whichever is out, and cheese the hole again
    // only when none is.
    const t0 = tickNow(q.sdk);
    const mouseOut = () => q.sdk.findNearbyNpc(/^mouse$/i);
    for (let attempt = 1; q.count(MAGNET) > 0; attempt++) {
        if (tickNow(q.sdk) - t0 > 400) throw new Error(`magnet on the mouse did not take after ${attempt - 1} tries (cheese left ${q.count(/^cheese$/i)})`);
        await q.bot.dismissBlockingUI().catch(() => undefined);
        const mouse = mouseOut();
        if (mouse) {
            await q.bot.useItemOnNpc(q.sdk.findInventoryItem(MAGNET)!, mouse).catch(() => undefined);
            if (await drainModal(q, () => q.count(MAGNET) === 0, 20)) break;
            q.log(`magnet try ${attempt}: the mouse went before the magnet landed`);
            continue;
        }
        const cheese = q.sdk.findInventoryItem(/^cheese$/i);
        if (!cheese) {
            // Out of cheese: another player's mouse may still come out.
            if (!(await untilTicks(q.sdk, () => !!mouseOut(), 30))) q.log(`magnet try ${attempt}: no cheese and no mouse out`);
            continue;
        }
        await q.sdk.scanNearbyLocs(6).catch(() => undefined);
        const hole = q.sdk.findNearbyLoc(/^mouse hole$/i);
        if (!hole) throw new Error(`no mouse hole from (${me(q).x},${me(q).z})`);
        await q.bot.useItemOnLoc(cheese, hole);
        if (!(await drainModal(q, () => !!mouseOut(), 30))) q.log(`cheese try ${attempt}: no mouse came out`);
    }
    q.log(`magnet on the mouse: ${tickNow(q.sdk) - t0}t`);
}

/** The shed key from the fountain, and in at the shed door with it. */
async function intoShed(q: Quest): Promise<void> {
    if (inShed(me(q))) return;
    if (!onGardenPath(me(q))) await intoGarden(q);
    const start = me(q);
    if (PORCH_TO_SHED.some((t) => cheb(t, start) === 0)) await sneak(q, PORCH_TO_SHED, 'porch → shed');
    if (q.count(SHED_KEY) < 1) {
        await sneak(q, SHED_TO_FOUNTAIN, 'shed → fountain');
        await useLoc(q, FOUNTAIN, /^check$/i);
        if (!(await drainModal(q, () => q.count(SHED_KEY) > 0))) throw new Error('checked the fountain but no shed key');
        await sneak(q, reverse(SHED_TO_FOUNTAIN), 'fountain → shed');
    }
    // The shed admits one player at a time: with someone inside, the key gets
    // "I think I can hear someone inside!" (quest_ball.rs2). Wait outside on the
    // door tile (level with the witch's patrol, so never caught) and try again.
    const t0 = tickNow(q.sdk);
    for (let attempt = 1; !inShed(me(q)); attempt++) {
        if (tickNow(q.sdk) - t0 > 1500) throw new Error(`shed door did not let us in after ${attempt - 1} tries (at ${me(q).x},${me(q).z})`);
        await q.bot.dismissBlockingUI().catch(() => undefined);
        await q.sdk.scanNearbyLocs(4).catch(() => undefined);
        const door = (q.sdk.getNearbyLocs() ?? []).find((l) => l.x === SHED_DOOR.x && l.z === SHED_DOOR.z);
        if (!door) {
            await q.sdk.waitForTicks(2); // swapped for a moment by a player passing through
            continue;
        }
        const cursor = newestMessageId(q);
        if (door.options.some((o) => /^open$/i.test(o)) && q.count(SHED_KEY) < 1) {
            await q.bot.interactLoc(door, /^open$/i); // opens without the key once the experiment is dead
        } else {
            await q.bot.useItemOnLoc(q.sdk.findInventoryItem(SHED_KEY)!, door);
        }
        if (await untilTicks(q.sdk, () => inShed(me(q)), 20)) break;
        const occupied = someoneInside(q, cursor);
        q.log(`shed door attempt ${attempt}: not in${occupied ? ' — someone is inside, waiting' : ''} (at ${me(q).x},${me(q).z})`);
        await q.bot.dismissBlockingUI().catch(() => undefined);
        await q.sdk.waitForTicks(occupied ? 30 : 4);
    }
    q.log(`into the shed: ${tickNow(q.sdk) - t0}t`);
}

function newestMessageId(q: Quest): number {
    const msgs = q.sdk.getState()?.gameMessages ?? [];
    return msgs.reduce((m, x) => Math.max(m, x.observationId ?? 0), 0);
}

function someoneInside(q: Quest, after: number): boolean {
    const st = q.sdk.getState();
    const texts = [
        ...(st?.gameMessages ?? []).filter((m) => (m.observationId ?? 0) > after).map((m) => m.text),
        st?.dialog?.isOpen ? JSON.stringify(st.dialog) : '',
    ];
    return texts.some((t) => /hear someone inside/i.test(t ?? ''));
}

/** The shapeshifter: glob, spider, bear, wolf — each form replaces the last when it dies. */
async function killExperiment(q: Quest): Promise<void> {
    const t0 = tickNow(q.sdk);
    const won = () => (q.sdk.getState()?.gameMessages ?? []).some((m) => /shapeshifter once and for all/i.test(m.text));
    let idle = 0;
    while (tickNow(q.sdk) - t0 < 600 && !won()) {
        const foe = q.sdk.findNearbyNpc(EXPERIMENT);
        if (!foe) {
            if (++idle > 20) break;
            await q.sdk.waitForTicks(1);
            continue;
        }
        idle = 0;
        q.log(`fighting ${foe.name}`);
        await q.bot.attack(foe).catch(() => undefined);
        await untilTicks(q.sdk, () => won() || q.sdk.findNearbyNpc(EXPERIMENT)?.name !== foe.name, 60);
    }
    q.log(`experiment fight: ${tickNow(q.sdk) - t0}t${won() ? '' : ' (no kill message)'}`);
}

/** Take the ball in the shed, back out the way we came, out through the house. */
async function takeBallOut(q: Quest): Promise<void> {
    if (q.count(BALL) < 1) {
        await intoShed(q);
        // A shared floor spawn: if another player just took it, it respawns.
        await untilTicks(q.sdk, () => !!q.sdk.findGroundItem(BALL), 200);
        const ball = q.sdk.findGroundItem(BALL);
        if (!ball) throw new Error(`no ball on the shed floor (at ${me(q).x},${me(q).z})`);
        await q.bot.pickupItem(ball);
        if (!(await untilTicks(q.sdk, () => q.count(BALL) > 0, 30))) throw new Error('ball not picked up');
    }
    if (inShed(me(q))) {
        await passLoc(q, SHED_DOOR, /^open$/i, () => !inShed(me(q)), 'shed door out');
    }
    if (onGardenPath(me(q))) {
        const at = me(q);
        const back = reverse(PORCH_TO_SHED);
        if (!back.some((t) => cheb(t, at) === 0)) await sneak(q, reverse(SHED_TO_FOUNTAIN), 'fountain → shed');
        await sneak(q, back, 'shed → porch');
        await passLoc(q, BACK_DOOR, /^open$/i, () => inHouse(me(q)), 'back door in');
    }
    await leaveHouse(q);
}

const rule = (id: string, kind: 'unstarted' | 'active' | 'complete', text: string) => ({ id: `ball:${id}`, kind, all: [text] });

await runQuest({
    id: 'ball',
    hub: 'falador-east',
    // The cupboard gives no second magnet while one is banked (quest_ball.rs2 obj_gettotal);
    // a run resumed after found_magnet banked it in the prologue (ABGARMY08, 2026-10-29).
    carry: ['magnet'],
    journal: { label: "Witch's House", title: "Witch's House" },
    stages: [
        { id: 'unstarted', rule: rule('not_started', 'unstarted', 'I can start this quest by speaking to the') },
        { id: 'started', rule: rule('started', 'active', 'I should find a way into the') },
        { id: 'found_magnet', rule: rule('found_magnet', 'active', 'in a cupboard in the basement') },
        // Varps 3 (unlocked) and 5 (read the diary after) share this text.
        { id: 'unlocked', rule: rule('unlocked', 'active', 'how to unlock the back door') },
        { id: 'defeated', rule: rule('defeated', 'active', 'is dead I should return the') },
        { id: 'complete', rule: rule('complete', 'complete', 'QUEST COMPLETE') },
    ],
    transitions: [
        {
            from: 'unstarted',
            to: 'started',
            at: BOY,
            talk: { npc: /^boy$/i, choices: [/what's the matter/i, /ok, i'll see what i can do/i] },
        },
        {
            from: 'started',
            to: 'found_magnet',
            needs: [{ item: 'leather gloves', count: 1 }],
            run: fetchMagnet,
        },
        {
            from: 'found_magnet',
            to: 'unlocked',
            needs: [{ item: 'cheese', count: 2 }], // a second in case another player's cheese steals our mouse
            run: magnetTheMouse,
        },
        {
            from: 'unlocked',
            to: 'defeated',
            run: async (q) => {
                await intoShed(q);
                await killExperiment(q);
            },
        },
        {
            from: 'defeated',
            to: 'complete',
            run: async (q) => {
                await takeBallOut(q);
                await q.talk(/^boy$/i, [], BOY);
            },
        },
    ],
});
