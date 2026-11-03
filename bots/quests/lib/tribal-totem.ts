/**
 * Tribal Totem — the R.P.D.T. depot, Wizard Cromperty's teleport block and Lord Handelmort's mansion.
 *
 * Content facts (quest_totem/scripts/quest_totem.rs2, area_ardougne_east/scripts/{rdpt_employee,
 * wizard_cromperty}.rs2, area_brimhaven/scripts/kangai_mau.rs2; placements m41_51, m43_49):
 *   - The depot (East Ardougne, 2644-2650,3271-3276): the "horncrate" (2650,3273) Investigate peels
 *     off its Handelmort label; the label on the teleport crate (2650,3271) -> 2; an R.P.D.T. employee
 *     "So, when are you going to deliver this crate?" -> 3.
 *   - Wizard Cromperty (2683,3326): "So what have you invented?" -> "Can I be teleported please?" ->
 *     "Yes, that sounds good. Teleport me!" lands at (2638,3321) in the mansion (-> 4).
 *   - The combination door (2634,3323): the tribal_door2 dials, set K-U-R-T (10,20,17,19) and Enter.
 *   - The trapped stairs (2631,3322): Search for traps (Thieving 21) first, then Climb-up lands at
 *     (2631,3321,L1); unsearched they drop you and hurt. The chest (2638,3324,L1) holds the totem.
 *   - The front door (2635,3321) only opens from inside.
 */
import type { Quest } from './run-quest';
import { driveDialog } from './dialog';
import { untilTicks } from './ticks';

interface Tile {
    x: number;
    z: number;
    level?: number;
}

export const OBJ = { label: 1858, totem: 1857 } as const;

const HORNCRATE = { x: 2650, z: 3273 };
const TELEPORT_CRATE = { x: 2650, z: 3271 };
const DEPOT = { x: 2646, z: 3273 };
export const CROMPERTY = { x: 2683, z: 3326 };
const COMBO_DOOR = { x: 2634, z: 3323 };
const TRAP_STAIRS = { x: 2631, z: 3322 };
const CHEST = { x: 2638, z: 3324, level: 1 };

/** tribal_door2 components (interface.pack): +1 on each dial, -1 on each dial, and Enter. */
const DIAL_UP = [765, 767, 769, 771];
const DIAL_DOWN = [764, 766, 768, 770];
const DIAL_ENTER = 774;
/** The dials' letters (com_43-46). */
const DIAL_TEXT = [760, 761, 762, 763];
const COMBINATION = [10, 20, 17, 19];
const COMBO_INTERFACE = 716;

const pos = (q: Quest) => {
    const p = q.sdk.getState()?.player;
    return { x: p?.worldX ?? 0, z: p?.worldZ ?? 0, level: p?.level ?? 0 };
};
const where = (q: Quest) => `(${pos(q).x},${pos(q).z},L${pos(q).level})`;
const inBox = (p: Tile, x0: number, x1: number, z0: number, z1: number) => p.x >= x0 && p.x <= x1 && p.z >= z0 && p.z <= z1;
export const held = (q: Quest, id: number) => q.sdk.getInventory().some((i) => i.id === id);

/** Lord Handelmort's mansion, both floors (walls x 2627-2641, z 3317-3327). */
export const inMansion = (p: Tile) => inBox(p, 2627, 2641, 3318, 3327);
/** West of the combination door: the stairs side. */
const pastComboDoor = (p: Tile) => p.x <= COMBO_DOOR.x - 1;

function cursor(q: Quest): number {
    return Math.max(0, ...(q.sdk.getState()?.gameMessages ?? []).map((m) => m.observationId ?? m.tick));
}
function said(q: Quest, since: number, text: RegExp): boolean {
    return (q.sdk.getState()?.gameMessages ?? []).some((m) => (m.observationId ?? m.tick) > since && text.test(m.text));
}

/** The loc `name` with option `opt` nearest `at` (within 3 tiles). */
async function locNear(q: Quest, at: Tile, name: RegExp, opt: RegExp) {
    await q.sdk.scanNearbyLocs(10).catch(() => undefined);
    const loc = (q.sdk.getNearbyLocs() ?? [])
        .filter((l) => name.test(l.name) && l.optionsWithIndex.some((o) => opt.test(o.text)))
        .sort((a, b) => Math.hypot(a.x - at.x, a.z - at.z) - Math.hypot(b.x - at.x, b.z - at.z))[0];
    return loc && Math.hypot(loc.x - at.x, loc.z - at.z) <= 3 ? loc : undefined;
}

async function op(q: Quest, at: Tile, name: RegExp, opt: RegExp, done: () => boolean, label: string, ticks = 15): Promise<void> {
    for (let attempt = 1; attempt <= 4 && !done(); attempt++) {
        const loc = await locNear(q, at, name, opt);
        if (!loc) {
            q.log(`totem: ${label}: no ${name} with ${opt} near (${at.x},${at.z}) from ${where(q)}`);
            await q.sdk.waitForTicks(3);
            continue;
        }
        await q.sdk.sendInteractLoc(loc.x, loc.z, loc.id, loc.optionsWithIndex.find((o) => opt.test(o.text))!.opIndex);
        await untilTicks(q.sdk, (s) => done() || !!s.dialog?.isOpen, ticks);
        if (q.sdk.getDialog()?.isOpen) await driveDialog(q.sdk, [], { done, ticks: 40, log: q.log });
        await untilTicks(q.sdk, done, 4);
    }
    if (!done()) throw new Error(`totem: ${label} failed at ${where(q)}`);
}

/** The label off the Handelmort crate onto Cromperty's: 1 -> 2. */
export async function swapLabel(q: Quest, marked: () => boolean): Promise<void> {
    await q.goTo(DEPOT, 3);
    if (!held(q, OBJ.label)) await op(q, HORNCRATE, /crate/i, /investigate|search/i, () => held(q, OBJ.label), 'peel the label');
    for (let attempt = 1; attempt <= 3 && held(q, OBJ.label); attempt++) {
        const crate = (await q.sdk.scanNearbyLocs(8).catch(() => q.sdk.getNearbyLocs() ?? []))
            .filter((l) => /crate/i.test(l.name))
            .sort((a, b) => Math.hypot(a.x - TELEPORT_CRATE.x, a.z - TELEPORT_CRATE.z) - Math.hypot(b.x - TELEPORT_CRATE.x, b.z - TELEPORT_CRATE.z))[0];
        if (!crate) throw new Error(`totem: no crate at (${TELEPORT_CRATE.x},${TELEPORT_CRATE.z}) from ${where(q)}`);
        const label = q.sdk.getInventory().find((i) => i.id === OBJ.label)!;
        await q.sdk.sendUseItemOnLoc(label.slot, crate.x, crate.z, crate.id);
        await untilTicks(q.sdk, (s) => !held(q, OBJ.label) || !!s.dialog?.isOpen, 15);
        if (q.sdk.getDialog()?.isOpen) await driveDialog(q.sdk, [], { ticks: 30, log: q.log });
    }
    if (held(q, OBJ.label) && !marked()) throw new Error('totem: the label would not go on the teleport crate');
}

/** Into the mansion by Cromperty's teleport (needs the crate delivered). */
export async function teleportIn(q: Quest): Promise<void> {
    if (inMansion(pos(q))) return;
    await q.talk(/^wizard cromperty$/i, [/so what have you invented/i, /can i be teleported please/i, /yes,? that sounds good/i], CROMPERTY);
    if (!(await untilTicks(q.sdk, () => inMansion(pos(q)), 15))) throw new Error(`totem: Cromperty's teleport did not land in the mansion (at ${where(q)})`);
    q.log(`totem: teleported into Handelmort's mansion at ${where(q)}`);
}

/** Set the four dials to K-U-R-T and press Enter. Each dial is read back from its text and nudged until it shows its letter. */
async function dialCombination(q: Quest): Promise<boolean> {
    const letterOf = (i: number) => {
        const c = (q.sdk.getState()?.interface?.textComponents ?? []).find((t) => t.componentId === DIAL_TEXT[i]);
        return (c?.text ?? '').trim().toUpperCase();
    };
    for (let i = 0; i < 4; i++) {
        const want = String.fromCharCode(65 + COMBINATION[i]!);
        for (let clicks = 0; clicks < 30 && letterOf(i) !== want; clicks++) {
            const now = letterOf(i);
            const at = now.length === 1 ? now.charCodeAt(0) - 65 : 0;
            // The shorter way round the 26 letters.
            const up = (COMBINATION[i]! - at + 26) % 26 <= 13;
            await q.sdk.sendClickComponent(up ? DIAL_UP[i]! : DIAL_DOWN[i]!);
            await untilTicks(q.sdk, () => letterOf(i) !== now, 5);
        }
        if (letterOf(i) !== want) q.log(`totem: dial ${i + 1} shows "${letterOf(i)}", wanted ${want}`);
    }
    const since = cursor(q);
    await q.sdk.sendClickComponent(DIAL_ENTER);
    await untilTicks(q.sdk, () => said(q, since, /combination seems correct|combination is incorrect/i), 10);
    return said(q, since, /combination seems correct/i);
}

/** The combination door, then through it to the stairs side. */
async function passComboDoor(q: Quest): Promise<void> {
    for (let attempt = 1; attempt <= 3 && !pastComboDoor(pos(q)); attempt++) {
        await q.sdk.scanNearbyLocs(10).catch(() => undefined);
        const door = (q.sdk.getNearbyLocs() ?? []).find((l) => l.x === COMBO_DOOR.x && l.z === COMBO_DOOR.z && /door/i.test(l.name));
        if (!door) throw new Error(`totem: no combination door near ${where(q)}`);
        if (door.reachable === false) {
            // The hall door (2636,3323) between the teleport's landing and the combination door,
            // shut: "I can't reach that!" on every try (2026-11-03).
            const hall = (q.sdk.getNearbyLocs() ?? [])
                .filter((l) => /door/i.test(l.name) && !(l.x === door.x && l.z === door.z) && l.reachable !== false && l.optionsWithIndex.some((o) => /^open$/i.test(o.text)))
                .sort((a, b) => Math.hypot(a.x - door.x, a.z - door.z) - Math.hypot(b.x - door.x, b.z - door.z))[0];
            if (hall) {
                q.log(`totem: opening the door at (${hall.x},${hall.z}) toward the combination door`);
                await q.bot.openDoor(hall).catch(() => undefined);
                await q.sdk.waitForTicks(2);
            }
        }
        await q.sdk.sendInteractLoc(door.x, door.z, door.id, door.optionsWithIndex.find((o) => /^open$/i.test(o.text))!.opIndex);
        const opened = await untilTicks(q.sdk, (s) => pastComboDoor(pos(q)) || s.interface?.interfaceId === COMBO_INTERFACE || !!s.interface?.isOpen, 12);
        if (q.sdk.getState()?.interface?.isOpen) {
            const ok = await dialCombination(q);
            q.log(`totem: combination ${ok ? 'accepted' : 'REFUSED'}`);
            await q.bot.closeInterface().catch(() => undefined);
            continue; // the door opens on the next Open
        }
        if (!opened) q.log(`totem: the combination door did nothing (attempt ${attempt})`);
        await untilTicks(q.sdk, () => pastComboDoor(pos(q)), 4);
        if (!pastComboDoor(pos(q))) {
            // Open, not walked through: step west.
            await q.sdk.sendWalk(COMBO_DOOR.x - 1, COMBO_DOOR.z, true);
            await untilTicks(q.sdk, () => pastComboDoor(pos(q)), 6);
        }
    }
    if (!pastComboDoor(pos(q))) throw new Error(`totem: could not get past the combination door (at ${where(q)})`);
}

/** Search the stairs for the trap, climb, open the chest, take the totem; back down and out. */
export async function stealTotem(q: Quest): Promise<void> {
    if (held(q, OBJ.totem)) return;
    if (pos(q).level === 0) {
        await passComboDoor(q);
        const since = cursor(q);
        await op(q, TRAP_STAIRS, /stair/i, /investigate|search/i, () => said(q, since, /trap in these stairs|don't find anything/i) || !!q.sdk.getDialog()?.isOpen, 'search the stairs');
        await driveDialog(q.sdk, [], { ticks: 20, log: q.log });
        await op(q, TRAP_STAIRS, /stair/i, /climb-up|climb up|walk-up/i, () => pos(q).level === 1 || said(q, since, /fallen through a trap/i), 'climb the stairs', 25);
        if (pos(q).level !== 1) throw new Error(`totem: the stairs trap dropped us (at ${where(q)})`);
    }
    // The chest room's door on the first floor (it failed from the stairs' top, 2631,3321,L1).
    await q.reach(/^chest$/i).catch((e) => q.log(`totem: ${(e as Error).message}`));
    await op(
        q,
        CHEST,
        /chest/i,
        /^(open|search)$/i,
        () => held(q, OBJ.totem),
        'the totem chest',
    );
    q.log('totem: took the tribal totem');
}

/** Out of the mansion: downstairs, then its front door (opens from inside). */
export async function leaveMansion(q: Quest): Promise<void> {
    if (!inMansion(pos(q))) return;
    if (pos(q).level > 0) await q.climbTo(0);
    const walk = await q.bot.walkTo(2635, 3315, 2);
    if (!walk.success) q.log(`totem: walk out of the mansion: ${walk.message}`);
    if (inMansion(pos(q))) throw new Error(`totem: still in Handelmort's mansion at ${where(q)}`);
}
