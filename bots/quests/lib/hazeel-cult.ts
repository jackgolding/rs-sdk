/**
 * Hazeel Cult (the Carnilleans' side) — the cult cave south of the Carnillean house, the sewer valves,
 * the raft to the hideout, and Butler Jones' cupboard.
 *
 * Content facts (quest_hazeelcult/scripts/*, configs/*; placements m40_50, m40_51, m40_151):
 *   - The cave entrance (2585,3233) Enter lands at (2570,9686); its stairs (2570,9683) Climb-up come
 *     out at (2587,3237). Clivet stands by the raft (2566,9683).
 *   - Clivet, then "What do you mean?" and "You're crazy, I'd never help you." sets the good side
 *     (stage 4); he jumps on the raft and is gone until he respawns.
 *   - The five sewer valves above: 1 (2562,3247), 2 (2572,3263), 3 (2585,3245), 4 (2597,3263),
 *     5 (2609,3243). The raft (2567,9679) only goes as far as the run of set valves from 1: valves
 *     1, 2, 4 and 5 Turn-right, valve 3 Turn-left. All five: the end of the passage (2606,9692).
 *   - Alomone (2609,9670, level 13) attacks when spoken to; his death drops the Carnillean armour
 *     (good side) and moves the stage to 6. Any other raft floats back to the cave entrance.
 *   - Ceril must take the armour upstairs (on the ground floor he only says "Come with me
 *     upstairs!"): the house's first floor has Ceril (2573,3268), Jones (2573,3269) and the cupboard
 *     (2573,3267). Ceril pays Jones instead (stage 7); then the cupboard's Search, with both of them
 *     within 6 tiles, exposes Jones and completes the quest.
 */
import type { Quest } from './run-quest';
import { driveDialog } from './dialog';
import { tickNow, untilTicks } from './ticks';

interface Tile {
    x: number;
    z: number;
    level?: number;
}

export const CERIL = { x: 2565, z: 3271 };
export const CERIL_UPSTAIRS = { x: 2573, z: 3268, level: 1 };
const CUPBOARD = { x: 2573, z: 3267, level: 1 };
/** Beside the house's staircase (2568,3268): goTo climbs where it stands, so walk here first. */
const STAIRS_FOOT = { x: 2569, z: 3269 };

async function upstairs(q: Quest): Promise<void> {
    if (pos(q).level === 1) return;
    await q.goTo(STAIRS_FOOT, 2);
    await q.climbTo(1);
}
const CAVE_ENTRANCE = { x: 2585, z: 3233 };
const CAVE_STAIRS = { x: 2570, z: 9683 };
const CLIVET = { x: 2566, z: 9683 };
const MAIN_RAFT = { x: 2567, z: 9679 };
const HIDEOUT_END = { x: 2606, z: 9692 };
const ALOMONE = { x: 2609, z: 9670 };
/** Valve tile, and the option that sets it (lib comment above). */
const VALVES: Array<{ at: Tile; turn: RegExp }> = [
    { at: { x: 2562, z: 3247 }, turn: /turn-right/i },
    { at: { x: 2572, z: 3263 }, turn: /turn-right/i },
    { at: { x: 2585, z: 3245 }, turn: /turn-left/i },
    { at: { x: 2597, z: 3263 }, turn: /turn-right/i },
    { at: { x: 2609, z: 3243 }, turn: /turn-right/i },
];

const pos = (q: Quest) => {
    const p = q.sdk.getState()?.player;
    return { x: p?.worldX ?? 0, z: p?.worldZ ?? 0, level: p?.level ?? 0 };
};
const where = (q: Quest) => `(${pos(q).x},${pos(q).z},L${pos(q).level})`;
const inBox = (p: Tile, x0: number, x1: number, z0: number, z1: number) => p.x >= x0 && p.x <= x1 && p.z >= z0 && p.z <= z1;

/** The cult cave and the sewer passage to the hideout (m40_151). */
export const inCultCave = (p: Tile) => inBox(p, 2560, 2623, 9664, 9727);
const atHideout = (p: Tile) => inBox(p, 2596, 2623, 9664, 9700);
export const hasArmour = (q: Quest) => q.count(/^carnillean armour$/i) > 0;

function cursor(q: Quest): number {
    return Math.max(0, ...(q.sdk.getState()?.gameMessages ?? []).map((m) => m.observationId ?? m.tick));
}
function said(q: Quest, since: number, text: RegExp): boolean {
    return (q.sdk.getState()?.gameMessages ?? []).some((m) => (m.observationId ?? m.tick) > since && text.test(m.text));
}

async function locNear(q: Quest, at: Tile, name: RegExp, opt: RegExp, within = 3) {
    await q.sdk.scanNearbyLocs(12).catch(() => undefined);
    const loc = (q.sdk.getNearbyLocs() ?? [])
        .filter((l) => name.test(l.name) && l.optionsWithIndex.some((o) => opt.test(o.text)))
        .sort((a, b) => Math.hypot(a.x - at.x, a.z - at.z) - Math.hypot(b.x - at.x, b.z - at.z))[0];
    return loc && Math.hypot(loc.x - at.x, loc.z - at.z) <= within ? loc : undefined;
}

/** Op the loc nearest `at` and drive what it opens; true once `done`. */
async function op(q: Quest, at: Tile, name: RegExp, opt: RegExp, done: () => boolean, label: string, choices: Array<RegExp | string> = []): Promise<void> {
    for (let attempt = 1; attempt <= 4 && !done(); attempt++) {
        const loc = await locNear(q, at, name, opt);
        if (!loc) {
            q.log(`hazeel: ${label}: no ${name} with ${opt} near (${at.x},${at.z}) from ${where(q)}`);
            await q.sdk.waitForTicks(3);
            continue;
        }
        const res = await q.bot.interactLoc(loc, opt).catch((e) => ({ success: false, message: String(e) }));
        if (!res.success) q.log(`hazeel: ${label}: ${res.message}`);
        await untilTicks(q.sdk, (s) => done() || !!s.dialog?.isOpen, 15);
        if (q.sdk.getDialog()?.isOpen) await driveDialog(q.sdk, choices, { done, ticks: 40, log: q.log });
        await untilTicks(q.sdk, done, 4);
    }
    if (!done()) throw new Error(`hazeel: ${label} failed at ${where(q)}`);
}

// ── the cave

export async function enterCave(q: Quest): Promise<void> {
    if (inCultCave(pos(q))) return;
    await q.goTo(CAVE_ENTRANCE, 3);
    await op(q, CAVE_ENTRANCE, /cave entrance/i, /^enter$/i, () => inCultCave(pos(q)), 'enter the cult cave');
    q.log(`hazeel: in the cult cave at ${where(q)}`);
}

/** Up the cave stairs (from the hideout, any raft back to the entrance first). */
export async function leaveCave(q: Quest): Promise<void> {
    if (!inCultCave(pos(q))) return;
    if (Math.hypot(pos(q).x - CAVE_STAIRS.x, pos(q).z - CAVE_STAIRS.z) > 12) {
        // Any raft but the entrance's floats back to it; the hideout's is at the passage end (2606,9693).
        if (atHideout(pos(q))) await q.bot.walkTo(HIDEOUT_END.x, HIDEOUT_END.z, 2).catch(() => undefined);
        const raft = (await q.sdk.scanNearbyLocs(15).catch(() => q.sdk.getNearbyLocs() ?? []))
            .filter((l) => /^raft$/i.test(l.name) && !(l.x === MAIN_RAFT.x && l.z === MAIN_RAFT.z))
            .sort((a, b) => (a.distance ?? 99) - (b.distance ?? 99))[0];
        if (!raft) throw new Error(`hazeel: no raft back from ${where(q)}`);
        await q.bot.interactLoc(raft, /board/i).catch(() => undefined);
        await untilTicks(q.sdk, (s) => !!s.dialog?.isOpen || Math.hypot(pos(q).x - CAVE_STAIRS.x, pos(q).z - CAVE_STAIRS.z) <= 8, 20);
        if (q.sdk.getDialog()?.isOpen) await driveDialog(q.sdk, [], { ticks: 20, log: q.log });
    }
    await op(q, CAVE_STAIRS, /stairs/i, /climb-up/i, () => !inCultCave(pos(q)), 'the cave stairs');
    q.log(`hazeel: out of the cave at ${where(q)}`);
}

/** Clivet: refuse the cult (good side). */
export async function refuseClivet(q: Quest): Promise<void> {
    await enterCave(q);
    await q.talk(/^clivet$/i, [/what do you mean/i, /you'?re crazy,? i'?d never help you/i], CLIVET);
}

// ── valves, raft, Alomone

export async function setValves(q: Quest): Promise<void> {
    if (inCultCave(pos(q))) await leaveCave(q);
    for (const [i, v] of VALVES.entries()) {
        await q.goTo(v.at, 2);
        const loc = await locNear(q, v.at, /sewer valve/i, v.turn);
        if (!loc) throw new Error(`hazeel: no sewer valve ${i + 1} at (${v.at.x},${v.at.z}) from ${where(q)}`);
        const since = cursor(q);
        await q.bot.interactLoc(loc, v.turn).catch(() => undefined);
        await untilTicks(q.sdk, (s) => !!s.dialog?.isOpen || said(q, since, /turn the large metal valve/i), 15);
        const seen = q.sdk.getDialog()?.isOpen ? await driveDialog(q.sdk, [], { ticks: 20, log: q.log }) : '';
        q.log(`hazeel: valve ${i + 1} ${v.turn.source.replace(/\\/g, '')}${/rushing water/i.test(seen) || said(q, since, /rushing water/i) ? '' : ' (no answer seen)'}`);
    }
}

/** The entrance raft, all valves set, to the hideout. */
async function rideToHideout(q: Quest): Promise<void> {
    if (atHideout(pos(q))) return;
    await enterCave(q);
    for (let attempt = 1; attempt <= 3 && !atHideout(pos(q)); attempt++) {
        const since = cursor(q);
        await op(q, MAIN_RAFT, /^raft$/i, /board/i, () => atHideout(pos(q)) || !inBox(pos(q), 2560, 2575, 9670, 9690) || said(q, since, /will not move/i), 'board the raft');
        await driveDialog(q.sdk, [], { ticks: 15, log: q.log });
        if (said(q, since, /will not move/i)) throw new Error('hazeel: the raft will not move — the valves are not set');
        if (!atHideout(pos(q))) q.log(`hazeel: the raft stopped at ${where(q)} — a valve is wrong`);
    }
    if (!atHideout(pos(q))) throw new Error(`hazeel: the raft never reached the hideout (at ${where(q)})`);
}

/** Talk to Alomone (he attacks), kill him, take the armour he drops. */
export async function killAlomone(q: Quest): Promise<void> {
    if (hasArmour(q)) return;
    await rideToHideout(q);
    const t0 = tickNow(q.sdk);
    while (!hasArmour(q) && tickNow(q.sdk) - t0 < 400) {
        const armour = (await q.sdk.scanGroundItems(12).catch(() => [])).find((g) => /^carnillean armour$/i.test(g.name));
        if (armour) {
            await q.bot.pickupItem(armour).catch(() => undefined);
            await untilTicks(q.sdk, () => hasArmour(q), 10);
            continue;
        }
        const alomone = q.sdk.findNearbyNpc(/^alomone$/i);
        if (!alomone) {
            await q.goTo(ALOMONE, 3);
            await q.sdk.waitForTicks(3);
            continue;
        }
        if (!q.sdk.getState()?.player?.combat?.inCombat) {
            const res = await q.bot.attack(alomone);
            if (!res.success) q.log(`hazeel: attack Alomone: ${res.message}`);
        }
        await untilTicks(q.sdk, () => !q.sdk.findNearbyNpc(/^alomone$/i) || !q.sdk.getState()?.player?.combat?.inCombat, 20);
    }
    if (!hasArmour(q)) throw new Error(`hazeel: no Carnillean armour after ${tickNow(q.sdk) - t0}t`);
    q.log('hazeel: Alomone dead, holding the Carnillean armour');
}

// ── the house

/** The armour to Ceril upstairs (he pays Jones instead): 6 -> 7. */
export async function returnArmour(q: Quest): Promise<void> {
    if (inCultCave(pos(q))) await leaveCave(q);
    await upstairs(q);
    await q.talk(/^ceril carnillean$/i, [], CERIL_UPSTAIRS);
}

/** The cupboard by Jones upstairs: poison and the amulet, with Ceril and Jones beside it. */
export async function searchCupboard(q: Quest, done: () => boolean): Promise<void> {
    await upstairs(q);
    await q.goTo(CUPBOARD, 2);
    for (let attempt = 1; attempt <= 4 && !done(); attempt++) {
        const open = await locNear(q, CUPBOARD, /^cupboard$/i, /^search$/i, 2);
        if (!open) {
            await op(q, CUPBOARD, /^cupboard$/i, /^open$/i, () => !!q.sdk.getNearbyLocs()?.some((l) => /^cupboard$/i.test(l.name) && l.options?.some((o) => /^search$/i.test(o))), 'open the cupboard');
            continue;
        }
        const near = (re: RegExp) => (q.sdk.findNearbyNpc(re)?.distance ?? 99) <= 5;
        if (!near(/^ceril carnillean$/i) || !near(/^butler jones$/i)) q.log('hazeel: Ceril or Jones is not beside the cupboard — searching anyway');
        await q.bot.interactLoc(open, /^search$/i).catch(() => undefined);
        await untilTicks(q.sdk, (s) => !!s.dialog?.isOpen || done(), 15);
        if (q.sdk.getDialog()?.isOpen) await driveDialog(q.sdk, [], { done, ticks: 200, log: q.log });
        await untilTicks(q.sdk, done, 6);
    }
}
