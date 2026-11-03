/**
 * Fishing Contest — the Hemenster competition and McGrubor's Wood's red vine worms.
 *
 * Content facts (quest_fishingcompo/scripts/*, area_seers/scripts/hemenster/*.rs2,
 * area_seers/scripts/mcgrubors_wood.rs2, area_white_wolf_mountain/scripts/mountain_dwarf.rs2;
 * placements m41_53, m41_54, m44_54):
 *   - The contest yard lies west of its gate (2642,3441/3442). From the east Morris checks the pass
 *     and lets you in; from the west you just walk out (Bonzo asks first if a competition is on).
 *   - Garlic used on the wall pipe (2636-2638,3446) is "stashed". Once Bonzo has your 5gp and seats
 *     you, a stashed pipe drives the Sinister Stranger off the pipes' spot (2637,3444) and the
 *     journal says "next to the pipes" (stage 3). Order does not matter.
 *   - Fishing there with a red vine worm catches a giant carp (any other spot or bait: sardines,
 *     shrimps); the third catch ends the round and a carp wins the trophy (stage 4).
 *   - Red vine worms: a spade on the vines (2627-2631,3492-3499) inside McGrubor's Wood, one a dig.
 *     The wood's gate is locked; the loose railing (2662,3500) squeezes you through either way.
 */
import type { Quest } from './run-quest';
import { driveDialog } from './dialog';
import { untilTicks } from './ticks';

interface Tile {
    x: number;
    z: number;
}

const CONTEST_GATE = { x: 2642, z: 3441 };
const OUTSIDE_GATE = { x: 2643, z: 3441 };
/** The pipes' fishing spot and the pipe beside it. */
const PIPE_SPOT = { x: 2637, z: 3444 };
/** Only the east pipe has a free tile in front of it (2638,3445): the other two face rocks. */
const PIPE = { x: 2638, z: 3446 };
const PIPE_FRONT = { x: 2638, z: 3445 };
const BONZO = { x: 2641, z: 3439 };
const RAILING = { x: 2662, z: 3500 };
/**
 * The railing's outside is its west tile: a lane (x 2653-2661, fenced on both sides) that walkTo
 * reaches from the south. Squeezing east lands inside the wood (2662,3500), and the vines connect.
 */
const RAILING_OUT = { x: 2661, z: 3500 };
const RAILING_IN = { x: 2662, z: 3500 };
const VINES = { x: 2629, z: 3494 };

const pos = (q: Quest) => {
    const p = q.sdk.getState()?.player;
    return { x: p?.worldX ?? 0, z: p?.worldZ ?? 0, level: p?.level ?? 0 };
};
const where = (q: Quest) => `(${pos(q).x},${pos(q).z})`;
const inBox = (p: Tile, x0: number, x1: number, z0: number, z1: number) => p.x >= x0 && p.x <= x1 && p.z >= z0 && p.z <= z1;

/** The contest yard, west of its gate (the gate tile itself is inside: Morris teleports you onto it). */
export const inContest = (p: Tile) => inBox(p, 2625, 2642, 3430, 3450);
/** McGrubor's Wood (outer fence x 2623-2678, z 3468-3508), less the lane outside the railing. */
export const inWood = (p: Tile) => inBox(p, 2624, 2677, 3470, 3507) && !inBox(p, 2653, 2661, 3470, 3503);

function cursor(q: Quest): number {
    return Math.max(0, ...(q.sdk.getState()?.gameMessages ?? []).map((m) => m.observationId ?? m.tick));
}
function said(q: Quest, since: number, text: RegExp): boolean {
    return (q.sdk.getState()?.gameMessages ?? []).some((m) => (m.observationId ?? m.tick) > since && text.test(m.text));
}

async function railing(q: Quest, wantIn: boolean): Promise<void> {
    for (let attempt = 1; attempt <= 4 && inWood(pos(q)) !== wantIn; attempt++) {
        if (Math.hypot(pos(q).x - RAILING.x, pos(q).z - RAILING.z) > 3) {
            const side = wantIn ? RAILING_OUT : RAILING_IN;
            const walk = await q.bot.walkTo(side.x, side.z, 0);
            if (!walk.success) q.log(`fishing: walk to the railing: ${walk.message}`);
        }
        await q.sdk.scanNearbyLocs(5).catch(() => undefined);
        const rail = (q.sdk.getNearbyLocs() ?? []).find((l) => l.x === RAILING.x && l.z === RAILING.z && /loose railing/i.test(l.name));
        if (!rail) {
            q.log(`fishing: no loose railing in view from ${where(q)}`);
            await q.sdk.waitForTicks(3);
            continue;
        }
        await q.bot.interactLoc(rail, /squeeze/i).catch(() => undefined);
        await untilTicks(q.sdk, () => inWood(pos(q)) === wantIn, 12);
    }
    if (inWood(pos(q)) !== wantIn) throw new Error(`fishing: could not squeeze ${wantIn ? 'into' : 'out of'} McGrubor's Wood (at ${where(q)})`);
}

/** Red vine worms from the vines in McGrubor's Wood (a spade, one worm a dig). */
export async function digVineWorms(q: Quest, count: number): Promise<void> {
    await q.ensure('spade', 1);
    try {
        await railing(q, true);
        const walk = await q.bot.walkTo(VINES.x, VINES.z, 3);
        if (!walk.success) q.log(`fishing: walk to the vines: ${walk.message}`);
        for (let misses = 0; misses < 6 && q.count('red vine worm') < count; ) {
            await q.sdk.scanNearbyLocs(8).catch(() => undefined);
            const vine = (q.sdk.getNearbyLocs() ?? [])
                .filter((l) => /^vine$/i.test(l.name) && l.optionsWithIndex.some((o) => /^check$/i.test(o.text)) && l.reachable !== false)
                .sort((a, b) => (a.distance ?? 99) - (b.distance ?? 99))[0];
            if (!vine) {
                misses++;
                q.log(`fishing: no reachable vine near ${where(q)}`);
                await q.bot.walkTo(VINES.x + (misses % 3) - 1, VINES.z, 2).catch(() => undefined);
                continue;
            }
            const before = q.count('red vine worm');
            await q.bot.interactLoc(vine, /^check$/i).catch(() => undefined);
            if (await untilTicks(q.sdk, () => q.count('red vine worm') > before, 10)) misses = 0;
            else misses++;
        }
    } finally {
        if (inWood(pos(q))) await railing(q, false);
    }
    if (q.count('red vine worm') < count) throw new Error(`fishing: only ${q.count('red vine worm')}/${count} red vine worms`);
}

/** Into the yard past Morris (the pass). */
export async function enterContest(q: Quest): Promise<void> {
    for (let attempt = 1; attempt <= 3 && !inContest(pos(q)); attempt++) {
        await q.goTo(OUTSIDE_GATE, 1);
        await q.sdk.scanNearbyLocs(5).catch(() => undefined);
        const gate = (q.sdk.getNearbyLocs() ?? [])
            .filter((l) => /^gate$/i.test(l.name) && l.x === CONTEST_GATE.x && Math.abs(l.z - CONTEST_GATE.z) <= 1 && l.optionsWithIndex.some((o) => /^open$/i.test(o.text)))
            .sort((a, b) => (a.distance ?? 99) - (b.distance ?? 99))[0];
        if (!gate) {
            q.log(`fishing: no contest gate in view from ${where(q)}`);
            await q.sdk.waitForTicks(3);
            continue;
        }
        await q.sdk.sendInteractLoc(gate.x, gate.z, gate.id, gate.optionsWithIndex.find((o) => /^open$/i.test(o.text))!.opIndex);
        await untilTicks(q.sdk, (s) => inContest(pos(q)) || !!s.dialog?.isOpen, 12);
        if (q.sdk.getDialog()?.isOpen) await driveDialog(q.sdk, [], { done: () => inContest(pos(q)), ticks: 40, log: q.log });
        await untilTicks(q.sdk, () => inContest(pos(q)), 5);
    }
    if (!inContest(pos(q))) throw new Error(`fishing: Morris did not let us in (at ${where(q)}; pass held: ${q.count(/^fishing pass$/i) > 0})`);
    q.log(`fishing: in the contest at ${where(q)}`);
}

/** Out of the yard (Bonzo asks first while a round is on: we never quit one, so only after it). */
export async function leaveContest(q: Quest): Promise<void> {
    for (let attempt = 1; attempt <= 3 && inContest(pos(q)); attempt++) {
        await q.sdk.scanNearbyLocs(12).catch(() => undefined);
        const gate = (q.sdk.getNearbyLocs() ?? [])
            .filter((l) => /^gate$/i.test(l.name) && l.x === CONTEST_GATE.x && Math.abs(l.z - CONTEST_GATE.z) <= 1 && l.optionsWithIndex.some((o) => /^open$/i.test(o.text)))
            .sort((a, b) => (a.distance ?? 99) - (b.distance ?? 99))[0];
        if (!gate) {
            await q.sdk.sendWalk(CONTEST_GATE.x - 1, CONTEST_GATE.z, true);
            await q.sdk.waitForTicks(4);
            continue;
        }
        await q.sdk.sendInteractLoc(gate.x, gate.z, gate.id, gate.optionsWithIndex.find((o) => /^open$/i.test(o.text))!.opIndex);
        await untilTicks(q.sdk, (s) => !inContest(pos(q)) || !!s.dialog?.isOpen, 15);
        // "So you're calling it quits?" — only while a round is on; quitting resets the entry.
        if (q.sdk.getDialog()?.isOpen) await driveDialog(q.sdk, [/yes,? i'?ll compete again another day/i], { done: () => !inContest(pos(q)), ticks: 30, log: q.log });
        await untilTicks(q.sdk, () => !inContest(pos(q)), 5);
    }
    if (inContest(pos(q))) throw new Error(`fishing: could not leave the contest yard (at ${where(q)})`);
}

/** Garlic into the pipe (moves the stranger off the pipes' spot once seated). */
export async function stashGarlic(q: Quest): Promise<boolean> {
    const garlic = q.sdk.getInventory().find((i) => /^garlic$/i.test(i.name));
    if (!garlic) return false;
    if (pos(q).x !== PIPE_FRONT.x || pos(q).z !== PIPE_FRONT.z) {
        await q.sdk.sendWalk(PIPE_FRONT.x, PIPE_FRONT.z, true);
        await untilTicks(q.sdk, () => pos(q).x === PIPE_FRONT.x && pos(q).z === PIPE_FRONT.z, 15);
    }
    await q.sdk.scanNearbyLocs(10).catch(() => undefined);
    const pipe = (q.sdk.getNearbyLocs() ?? [])
        .filter((l) => /pipe/i.test(l.name) && l.z === PIPE.z && l.x >= 2636 && l.x <= 2638)
        .sort((a, b) => Math.hypot(a.x - PIPE.x, a.z - PIPE.z) - Math.hypot(b.x - PIPE.x, b.z - PIPE.z))[0];
    if (!pipe) throw new Error(`fishing: no pipe near (${PIPE.x},${PIPE.z}) from ${where(q)}`);
    const since = cursor(q);
    await q.sdk.sendUseItemOnLoc(garlic.slot, pipe.x, pipe.z, pipe.id);
    await untilTicks(q.sdk, (s) => said(q, since, /stash the garlic/i) || !!s.dialog?.isOpen, 15);
    if (q.sdk.getDialog()?.isOpen) await driveDialog(q.sdk, [], { ticks: 30, log: q.log });
    const ok = said(q, since, /stash the garlic/i);
    q.log(`fishing: garlic ${ok ? 'stashed in the pipe' : 'not taken by the pipe'}`);
    return ok;
}

/** Pay Bonzo and take a place. */
export async function enterRound(q: Quest): Promise<void> {
    await q.talk(/^bonzo$/i, [/i'?ll enter the competition please/i], BONZO);
}

/** Three catches at the pipes' spot with red vine worms; the third ends the round. */
export async function fishCarp(q: Quest, won: () => boolean): Promise<void> {
    const rod = q.sdk.getInventory().find((i) => /^fishing rod$/i.test(i.name));
    if (!rod) throw new Error('fishing: no fishing rod');
    for (let casts = 0; casts < 8 && !won(); casts++) {
        if (q.count('red vine worm') < 1) throw new Error('fishing: out of red vine worms before the round ended');
        const spot = (q.sdk.getNearbyNpcs() ?? [])
            .filter((n) => /^fishing spot$/i.test(n.name))
            .sort((a, b) => Math.hypot(a.x - PIPE_SPOT.x, a.z - PIPE_SPOT.z) - Math.hypot(b.x - PIPE_SPOT.x, b.z - PIPE_SPOT.z))[0];
        if (!spot || Math.hypot(spot.x - PIPE_SPOT.x, spot.z - PIPE_SPOT.z) > 2) throw new Error(`fishing: no fishing spot by the pipes (from ${where(q)})`);
        const since = cursor(q);
        const worms = q.count('red vine worm');
        await q.sdk.sendInteractNpc(spot.index, 1);
        await untilTicks(q.sdk, (s) => q.count('red vine worm') < worms || !!s.dialog?.isOpen || won(), 20);
        if (q.sdk.getDialog()?.isOpen) {
            const seen = await driveDialog(q.sdk, [], { done: won, ticks: 60, log: q.log });
            if (/my spot|sinister|this is my/i.test(seen) && q.count('red vine worm') === worms) throw new Error(`fishing: the Sinister Stranger still holds the pipes' spot: ${seen.slice(0, 160)}`);
        }
        await untilTicks(q.sdk, won, 6);
        if (said(q, since, /giant carp/i)) q.log('fishing: caught a giant carp');
    }
    if (!won()) throw new Error('fishing: the round ended without the trophy');
}
