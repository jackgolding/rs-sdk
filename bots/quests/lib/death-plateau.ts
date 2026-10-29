/**
 * Death Plateau — Burthorpe's buildings and the quest's hand-made steps.
 *
 * Map facts (maps/m45_55, m44_55, m44_56, m35_74; quest_death.rs2):
 *   - Eohric is on the castle's first floor: the castle stairs (2897,3566) are
 *     approached from the south (forceapproach=south) and land on (2897,3569) L1
 *   - Harold is on the Toad and Chicken's first floor (stairs 2914,3539), in the
 *     room behind death_harold_door (2906,3543, south edge): from the landing it
 *     is a knock ("Come in!") that teleports you in once Eohric has named him;
 *     from inside it just opens
 *   - the stone mechanism slots and the five stone ball spawns (2893,3561-3565)
 *     are outside the equipment room, west of the castle
 *   - Saba's cave: entrance (2857,3578) teleports to (2269,4752); exit (2268,4750)
 *   - Tenzing's hut: front door (2822,3555, east edge) knocks until Saba has sent
 *     you; yard gates (2824,3554-3555); back door (2820,3557, north edge); the
 *     stile (2817,3562) onto the secret path; the scout zone is the 8x8 zone at
 *     (2864,3608) — stepping into it sets the quest's "scouted" stage
 */
import type { Quest } from './run-quest';
import { driveDialog } from './dialog';
import { tickNow, untilTicks } from './ticks';

interface Tile {
    x: number;
    z: number;
}

export const DENULTH = { x: 2896, z: 3528 };
export const DUNSTAN = { x: 2919, z: 3574 };
export const TOSTIG = { x: 2906, z: 3540 };

const CASTLE_STAIRS_FOOT = { x: 2897, z: 3564 };
const INN_STAIRS_FOOT = { x: 2913, z: 3541 };
const HAROLD_DOOR = { x: 2906, z: 3543 };
const SABA_CAVE = { x: 2857, z: 3578 };
const SABA_CAVE_EXIT = { x: 2268, z: 4750 };
const HUT_YARD_OUTSIDE = { x: 2826, z: 3555 };
const HUT_FRONT_DOOR = { x: 2822, z: 3555 };
const HUT_BACK_DOOR = { x: 2820, z: 3557 };
const STILE = { x: 2817, z: 3562 };
/** The secret path north of the stile, walked in short chords (the client will not plan it in one go). */
const SECRET_PATH: Tile[] = [
    // m44_55/m44_56 collision: a one-tile lane at x 2817 to z 3588, then north-east
    // along the ridge to the z 3609 ledge that runs east into the scout zone.
    { x: 2817, z: 3563 },
    { x: 2817, z: 3575 },
    { x: 2817, z: 3586 },
    { x: 2820, z: 3589 },
    { x: 2826, z: 3592 },
    { x: 2831, z: 3596 },
    { x: 2834, z: 3601 },
    { x: 2840, z: 3603 },
    { x: 2844, z: 3607 },
    { x: 2848, z: 3609 },
    { x: 2856, z: 3609 },
    { x: 2861, z: 3610 },
    // In the scout zone (2864-2871 x 3608-3615).
    { x: 2867, z: 3609 },
]

const pos = (q: Quest) => {
    const p = q.sdk.getState()?.player;
    return { x: p?.worldX ?? 0, z: p?.worldZ ?? 0, level: p?.level ?? 0 };
};
const where = (q: Quest) => `(${pos(q).x},${pos(q).z},L${pos(q).level})`;
const box = (x0: number, x1: number, z0: number, z1: number, level = 0) => (q: Quest) => {
    const p = pos(q);
    return p.level === level && p.x >= x0 && p.x <= x1 && p.z >= z0 && p.z <= z1;
};
const inHaroldRoom = box(2900, 2908, 3534, 3542, 1);
const inInnUpstairs = box(2899, 2916, 3533, 3547, 1);
const inCastleUpstairs = box(2886, 2912, 3549, 3580, 1);
const inSabaCave = (q: Quest) => pos(q).z > 4000;
export const inHut = box(2812, 2822, 3549, 3557);
const inYard = box(2823, 2824, 3550, 3561);
/** North of the stile up to the scout zone (not the street outside Saba's cave, 2858,3577). */
const onSecretPath = (q: Quest) => {
    const p = pos(q);
    return p.level === 0 && ((p.x >= 2800 && p.x <= 2830 && p.z >= 3563 && p.z <= 3606) || (p.x > 2830 && p.x <= 2872 && p.z >= 3600 && p.z <= 3615));
};

/**
 * Op `opt` on the loc named `name` at `at` until `done`, driving any dialog it opens
 * with `choices`. The client walks to the loc itself, as for a click; bot.walkTo to
 * a door tile first cost ~60s a door in Harold's room (2026-10-29).
 */
async function op(q: Quest, at: Tile, name: RegExp, opt: RegExp, done: () => boolean, label: string, choices: RegExp[] = []): Promise<void> {
    for (let attempt = 1; attempt <= 4; attempt++) {
        if (done()) return;
        await q.sdk.scanNearbyLocs(10).catch(() => undefined);
        const loc = (q.sdk.getNearbyLocs() ?? []).find((l) => l.x === at.x && l.z === at.z && name.test(l.name) && l.optionsWithIndex.some((o) => opt.test(o.text)));
        if (!loc) {
            q.log(`death: ${label}: no ${name} with ${opt} at (${at.x},${at.z}) from ${where(q)} (attempt ${attempt})`);
            await q.sdk.waitForTicks(3);
            continue;
        }
        await q.sdk.sendInteractLoc(at.x, at.z, loc.id, loc.optionsWithIndex.find((o) => opt.test(o.text))!.opIndex);
        await untilTicks(q.sdk, (s) => done() || !!s.dialog?.isOpen, 40);
        if (q.sdk.getDialog()?.isOpen) await driveDialog(q.sdk, choices, { done, ticks: 80, log: q.log });
        if (await untilTicks(q.sdk, done, 5)) return;
        q.log(`death: ${label} did not take from ${where(q)} (attempt ${attempt})`);
    }
    throw new Error(`death: ${label} failed at ${where(q)}`);
}

/** Walk to an exact tile with client-planned clicks of at most 6 tiles each. */
async function chord(q: Quest, to: Tile, label: string, tolerance = 2): Promise<void> {
    const near = () => Math.max(Math.abs(pos(q).x - to.x), Math.abs(pos(q).z - to.z)) <= tolerance;
    for (let tries = 0; tries < 20 && !near(); tries++) {
        const from = pos(q);
        const dx = to.x - from.x;
        const dz = to.z - from.z;
        const len = Math.max(Math.abs(dx), Math.abs(dz));
        const k = Math.min(1, 6 / Math.max(len, 1));
        const hop = { x: from.x + Math.round(dx * k), z: from.z + Math.round(dz * k) };
        await q.sdk.sendWalk(hop.x, hop.z, true);
        await untilTicks(q.sdk, () => pos(q).x === hop.x && pos(q).z === hop.z, 12);
        if (pos(q).x === from.x && pos(q).z === from.z) q.log(`death: ${label}: hop to (${hop.x},${hop.z}) did not move from ${where(q)}`);
    }
    if (!near()) throw new Error(`death: ${label}: stuck at ${where(q)} short of (${to.x},${to.z})`);
}

// ── Burthorpe castle (Eohric)

export async function toEohric(q: Quest): Promise<void> {
    await leaveAnywhere(q);
    if (!inCastleUpstairs(q)) {
        if (pos(q).level !== 0) await q.climbTo(0);
        await q.goTo(CASTLE_STAIRS_FOOT, 1);
        await q.climbTo(1);
    }
    await untilTicks(q.sdk, () => !!q.sdk.findNearbyNpc(/^eohric$/i), 10);
}

// ── The Toad and Chicken (Harold, Tostig)

/** Into Harold's room on the inn's first floor (knocking if it is shut to us). */
export async function toHarold(q: Quest): Promise<void> {
    if (inHaroldRoom(q)) return;
    await leaveAnywhere(q);
    if (!inInnUpstairs(q)) {
        if (pos(q).level !== 0) await q.climbTo(0);
        await q.goTo(INN_STAIRS_FOOT, 1);
        await q.climbTo(1);
    }
    await op(q, HAROLD_DOOR, /^door$/i, /^open$/i, () => inHaroldRoom(q) && !q.sdk.getDialog()?.isOpen, "Harold's door in");
}

async function leaveHarold(q: Quest): Promise<void> {
    if (!inHaroldRoom(q)) return;
    const t0 = tickNow(q.sdk);
    await op(q, HAROLD_DOOR, /^door$/i, /^open$/i, () => !inHaroldRoom(q), "Harold's door out");
    q.log(`death: out of Harold's room in ${tickNow(q.sdk) - t0}t`);
}

/**
 * Harold's dice (death_guard_equiproom.rs2): ask to gamble, stake `bet` at the
 * count prompt, roll, and close the result modal (its p_pausebutton) so the
 * haroldgamble_end queue runs. Drunk, every roll wins; a stake above his purse
 * (100gp from Denulth) makes him write the IOU.
 */
export async function gambleForIou(q: Quest, bet: number): Promise<void> {
    const iou = () => q.count('iou') > 0 || q.count('combination') > 0;
    for (let round = 1; round <= 3 && !iou(); round++) {
        await toHarold(q);
        // A drink's pages (if_close, npc anims, "Now THAT hit the spot!") can still be pending.
        await settleDialog(q);
        const seen = await q.talk(/^harold$/i, [/would you like to gamble/i]);
        q.log(`death: gamble round ${round}: ${seen.slice(-160)}`);
        if (!/would you like to gamble/i.test(seen)) continue;
        let staked = false;
        for (let i = 0; i < 10 && !staked; i++) {
            staked = (await q.sdk.sendCountDialog(bet)).success;
            if (!staked) await q.sdk.waitForTicks(2);
        }
        if (!staked) {
            q.log('death: the count prompt never took the stake');
            continue;
        }
        // Harold's "here goes" page(s), then the dice modal un-hides its Roll button.
        let rolled = false;
        for (let t = 0; t < 60 && !rolled; t++) {
            const roll = (q.sdk.getState()?.interface?.options ?? []).find((o) => /roll/i.test(o.text));
            if (roll) {
                rolled = (await q.sdk.sendClickComponent(roll.componentId)).success;
            } else if (q.sdk.getDialog()?.isOpen) {
                await driveDialog(q.sdk, [], { ticks: 10, log: q.log });
            } else await q.sdk.waitForTicks(1);
        }
        if (!rolled) {
            q.log(`death: no Roll button (interface ${JSON.stringify(q.sdk.getState()?.interface?.options?.map((o) => o.text) ?? [])})`);
            continue;
        }
        await q.sdk.waitForTicks(6);
        await q.bot.closeInterface().catch(() => undefined);
        await untilTicks(q.sdk, (s) => iou() || !!s.dialog?.isOpen, 15);
        await driveDialog(q.sdk, [], { done: () => iou() && !q.sdk.getDialog()?.isOpen, ticks: 60, log: q.log });
        await untilTicks(q.sdk, iou, 10);
    }
    if (!iou()) throw new Error('death: Harold never wrote the IOU');
}

/** Let a dialog that reopens after a pause (anims, p_delay) arrive and drive it to its end. */
export async function settleDialog(q: Quest): Promise<void> {
    for (let i = 0; i < 3; i++) {
        if (!(await untilTicks(q.sdk, (s) => !!s.dialog?.isOpen, 8))) return;
        await driveDialog(q.sdk, [], { ticks: 40, log: q.log });
    }
}

/** opheld1 on the IOU: it turns out to be the combination. */
export async function readIou(q: Quest): Promise<void> {
    const iou = q.sdk.findInventoryItem(/^iou$/i);
    if (!iou) return;
    const read = iou.optionsWithIndex.find((o) => /read/i.test(o.text));
    await q.sdk.sendUseItem(iou.slot, read?.opIndex ?? 1);
    await untilTicks(q.sdk, (s) => !!s.dialog?.isOpen || q.count('combination') > 0, 10);
    await driveDialog(q.sdk, [], { ticks: 40, log: q.log });
    await q.bot.closeInterface().catch(() => undefined);
}

// ── The stone mechanism

/** Obj ids of the five stone balls (quest_death.obj; spawns at 2893,3561-3565) and their slots per the combination. */
const BALLS = [
    { color: 'blue', id: 3110, slot: { x: 2894, z: 3562 } },
    { color: 'yellow', id: 3111, slot: { x: 2895, z: 3562 } },
    { color: 'red', id: 3109, slot: { x: 2894, z: 3563 } },
    { color: 'purple', id: 3112, slot: { x: 2895, z: 3563 } },
    { color: 'green', id: 3113, slot: { x: 2895, z: 3564 } },
];
const BALL_SPAWNS = { x: 2893, z: 3563 };

/**
 * Pick up the five balls and place each on its slot (Red N of Blue, Yellow S of
 * Purple, Green N of Purple, Blue W of Yellow, Purple E of Red). Placing the
 * last correct one unlocks the door while the quest is at found_combo.
 */
export async function placeBalls(q: Quest): Promise<void> {
    await leaveAnywhere(q);
    await q.goTo(BALL_SPAWNS, 1);
    const held = (id: number) => q.sdk.getInventory().some((i) => i.id === id);
    const placed = (b: (typeof BALLS)[number]) => (q.sdk.getState()?.groundItems ?? []).some((g) => g.id === b.id && g.x === b.slot.x && g.z === b.slot.z);
    for (const b of BALLS) {
        for (let i = 0; i < 4 && !held(b.id) && !placed(b); i++) {
            const scanned = (await q.sdk.scanGroundItems(8).catch(() => undefined)) ?? q.sdk.getState()?.groundItems ?? [];
            const ground = scanned.find((g) => g.id === b.id && !BALLS.some((s) => s.slot.x === g.x && s.slot.z === g.z));
            if (!ground) {
                await q.sdk.waitForTicks(3);
                continue;
            }
            await q.bot.pickupItem(ground);
            await untilTicks(q.sdk, () => held(b.id), 10);
        }
    }
    for (const b of BALLS) {
        if (placed(b)) continue;
        const ball = q.sdk.getInventory().find((i) => i.id === b.id);
        if (!ball) throw new Error(`death: no ${b.color} stone ball (held or on its slot)`);
        await q.sdk.scanNearbyLocs(6).catch(() => undefined);
        const mech = (q.sdk.getNearbyLocs() ?? []).find((l) => l.x === b.slot.x && l.z === b.slot.z && /stone mechanism/i.test(l.name));
        if (!mech) throw new Error(`death: no stone mechanism at (${b.slot.x},${b.slot.z})`);
        await q.sdk.sendUseItemOnLoc(ball.slot, b.slot.x, b.slot.z, mech.id);
        await untilTicks(q.sdk, () => !held(b.id), 15);
        q.log(`death: ${b.color} ball ${held(b.id) ? 'NOT placed' : 'placed'} at (${b.slot.x},${b.slot.z})`);
    }
}

// ── Saba's cave

export async function talkSaba(q: Quest): Promise<void> {
    if (!inSabaCave(q)) {
        await leaveAnywhere(q);
        await q.goTo(SABA_CAVE, 2);
        await op(q, SABA_CAVE, /cave entrance/i, /enter/i, () => inSabaCave(q), 'Saba cave in');
    }
    await q.talk(/^saba$/i, [/another way up death plateau/i]);
}

// ── Tenzing's hut and the secret way

/** Into the hut by its front door (a knock — "I'm not the milkman" — until Saba has sent us). */
export async function toTenzing(q: Quest): Promise<void> {
    if (inHut(q)) return;
    await leaveAnywhere(q);
    if (!inYard(q)) {
        await q.goTo(HUT_YARD_OUTSIDE, 1);
        await q.bot.walkTo(HUT_FRONT_DOOR.x + 1, HUT_FRONT_DOOR.z, 0);
    }
    await op(q, HUT_FRONT_DOOR, /^door$/i, /^open$/i, () => inHut(q) && !q.sdk.getDialog()?.isOpen, "Tenzing's front door in");
}

async function leaveHut(q: Quest): Promise<void> {
    if (!inHut(q)) return;
    await op(q, HUT_FRONT_DOOR, /^door$/i, /^open$/i, () => !inHut(q), "Tenzing's front door out");
    // The yard's gates: walkTo opens them on the way out.
    const res = await q.bot.walkTo(HUT_YARD_OUTSIDE.x, HUT_YARD_OUTSIDE.z, 1);
    if (!res.success) q.log(`death: out of Tenzing's yard: ${res.message} at ${where(q)}`);
}

/** Out the back door, over the stile and up the secret path until the scout zone fires. */
export async function scoutSecretWay(q: Quest, done: () => boolean): Promise<void> {
    if (!onSecretPath(q)) {
        await toTenzing(q);
        await op(q, HUT_BACK_DOOR, /^door$/i, /^open$/i, () => !inHut(q), "Tenzing's back door");
        await op(q, STILE, /^stile$/i, /climb/i, () => pos(q).z > STILE.z, 'stile north');
    }
    const start = SECRET_PATH.reduce((best, wp, i) => (Math.hypot(wp.x - pos(q).x, wp.z - pos(q).z) < Math.hypot(SECRET_PATH[best]!.x - pos(q).x, SECRET_PATH[best]!.z - pos(q).z) ? i : best), 0);
    for (const wp of SECRET_PATH.slice(start)) {
        if (done()) break;
        await chord(q, wp, 'secret path', wp === SECRET_PATH[SECRET_PATH.length - 1] ? 1 : 2);
    }
    await untilTicks(q.sdk, (s) => done() || !!s.dialog?.isOpen, 10);
    await driveDialog(q.sdk, [], { ticks: 20, log: q.log });
}

/** Back down the secret path, over the stile, and out through the hut. */
async function leaveSecretPath(q: Quest): Promise<void> {
    if (!onSecretPath(q)) return;
    const start = SECRET_PATH.reduce((best, wp, i) => (Math.hypot(wp.x - pos(q).x, wp.z - pos(q).z) < Math.hypot(SECRET_PATH[best]!.x - pos(q).x, SECRET_PATH[best]!.z - pos(q).z) ? i : best), 0);
    for (const wp of SECRET_PATH.slice(0, start + 1).reverse()) await chord(q, wp, 'secret path back', wp === SECRET_PATH[0] ? 1 : 2);
    await op(q, STILE, /^stile$/i, /climb/i, () => pos(q).z < STILE.z, 'stile south');
    await op(q, HUT_BACK_DOOR, /^door$/i, /^open$/i, () => inHut(q), "Tenzing's back door in");
    await leaveHut(q);
}

/** From any of the quest's pockets (Harold's room, the cave, the hut, the secret path) back onto Burthorpe's streets. */
export async function leaveAnywhere(q: Quest): Promise<void> {
    if (q.sdk.getDialog()?.isOpen) await driveDialog(q.sdk, [], { ticks: 20, log: q.log });
    await leaveHarold(q);
    if (inSabaCave(q)) await op(q, SABA_CAVE_EXIT, /cave exit/i, /exit/i, () => !inSabaCave(q), 'Saba cave out');
    await leaveSecretPath(q);
    await leaveHut(q);
}
