/**
 * Observatory Quest — the professor's reception south-west of Ardougne, the goblin cavern under it and
 * the observatory dome.
 *
 * Content facts (quest_itgronigen/scripts/*.rs2; placements m37/38_49, m37_147):
 *   - Professor (2438,3186) in the reception: "I'd like to have a look through that telescope.",
 *     "Sounds interesting, what can I do for you?" (0 -> 1). Then three planks (-> 2), a bronze bar
 *     (-> 3), molten glass (-> 4), the lens mould (-> 5, the glass comes back), the lens (-> 6).
 *   - The reception's ladder (2444,3191) drops into the cavern at (2420,9459); back up by the ladder
 *     (2420,9460). The keep gate (2390-2391,9457) is locked from the north until the keep key from the
 *     chest at (2428,9419) (Open, then Search) unlocks it for good; a goblin guard (2391,9458) attacks.
 *     The lens mould is under the sack (2389,9454) south of the gate.
 *   - Molten glass used on the mould -> lens (no skill roll).
 *   - The dome: ladder (2423,9439) up to (2440,3165); the telescope (2440,3157) with the professor
 *     (2439,3160) beside it opens the sky; close it and his dialog runs the reward (-> complete).
 *     Down again by the dome's ladder (2440,3164).
 */
import type { Quest } from './run-quest';
import { driveDialog } from './dialog';
import { tickNow, untilTicks } from './ticks';

interface Tile {
    x: number;
    z: number;
    level?: number;
}

export const OBJ = { plank: 960, bronzeBar: 2349, moltenGlass: 1775, lens: 603, mould: 602, keepKey: 601 } as const;

export const PROFESSOR = { x: 2438, z: 3186 };
const RECEPTION_LADDER = { x: 2444, z: 3191 };
const CAVERN_LADDER_UP = { x: 2420, z: 9460 };
const KEY_CHEST = { x: 2428, z: 9419 };
const GATE_NORTH = { x: 2391, z: 9458 };
const MOULD_SACK = { x: 2389, z: 9454 };
const DOME_LADDER_UP = { x: 2423, z: 9439 };
const DOME_LADDER_DOWN = { x: 2440, z: 3164 };
const TELESCOPE = { x: 2440, z: 3157 };

const pos = (q: Quest) => {
    const p = q.sdk.getState()?.player;
    return { x: p?.worldX ?? 0, z: p?.worldZ ?? 0, level: p?.level ?? 0 };
};
const where = (q: Quest) => `(${pos(q).x},${pos(q).z},L${pos(q).level})`;
const inBox = (p: Tile, x0: number, x1: number, z0: number, z1: number) => p.x >= x0 && p.x <= x1 && p.z >= z0 && p.z <= z1;
export const held = (q: Quest, id: number) => q.sdk.getInventory().some((i) => i.id === id);
const inv = (q: Quest, id: number) => q.sdk.getInventory().find((i) => i.id === id);

/** The goblin cavern under the reception and the dome. */
export const inObsCavern = (p: Tile) => inBox(p, 2365, 2440, 9405, 9500);
/** The dome on its cliff (no walk down). */
export const inDome = (p: Tile) => (p.level ?? 0) === 0 && inBox(p, 2433, 2447, 3154, 3167);
export const inObservatoryArea = (p: Tile) => inObsCavern(p) || inDome(p);

function cursor(q: Quest): number {
    return Math.max(0, ...(q.sdk.getState()?.gameMessages ?? []).map((m) => m.observationId ?? m.tick));
}
function said(q: Quest, since: number, text: RegExp): boolean {
    return (q.sdk.getState()?.gameMessages ?? []).some((m) => (m.observationId ?? m.tick) > since && text.test(m.text));
}

async function locNear(q: Quest, at: Tile, name: RegExp, opt?: RegExp, within = 2) {
    await q.sdk.scanNearbyLocs(15).catch(() => undefined);
    const loc = (q.sdk.getNearbyLocs() ?? [])
        .filter((l) => name.test(l.name) && (!opt || l.optionsWithIndex.some((o) => opt.test(o.text))))
        .sort((a, b) => Math.hypot(a.x - at.x, a.z - at.z) - Math.hypot(b.x - at.x, b.z - at.z))[0];
    return loc && Math.hypot(loc.x - at.x, loc.z - at.z) <= within ? loc : undefined;
}

async function op(q: Quest, at: Tile, name: RegExp, opt: RegExp, done: () => boolean, label: string, ticks = 20): Promise<void> {
    for (let attempt = 1; attempt <= 4 && !done(); attempt++) {
        const loc = await locNear(q, at, name, opt);
        if (!loc) {
            q.log(`observatory: ${label}: no ${name} with ${opt} near (${at.x},${at.z}) from ${where(q)}`);
            await q.sdk.waitForTicks(3);
            continue;
        }
        await q.sdk.sendInteractLoc(loc.x, loc.z, loc.id, loc.optionsWithIndex.find((o) => opt.test(o.text))!.opIndex);
        await untilTicks(q.sdk, (s) => done() || !!s.dialog?.isOpen, ticks);
        if (q.sdk.getDialog()?.isOpen) await driveDialog(q.sdk, [], { done, ticks: 30, log: q.log });
        await untilTicks(q.sdk, done, 4);
    }
    if (!done()) throw new Error(`observatory: ${label} failed at ${where(q)}`);
}

/**
 * The reception's professor. Both professors share a name and the dome's is in view from the road:
 * from 15 tiles off, talkTo picked him and failed "no path" (qlqcobs1). Stand beside this one first.
 */
export async function talkProfessor(q: Quest, choices: RegExp[] = []): Promise<string> {
    await q.goTo(PROFESSOR, 2);
    return q.talk(/^observatory professor$/i, choices);
}

async function intoCavern(q: Quest): Promise<void> {
    if (inObsCavern(pos(q))) return;
    if (inDome(pos(q))) {
        await op(q, DOME_LADDER_DOWN, /ladder/i, /climb-down/i, () => inObsCavern(pos(q)), 'down the dome ladder');
        return;
    }
    await q.goTo({ x: RECEPTION_LADDER.x, z: RECEPTION_LADDER.z - 1 }, 2);
    await op(q, RECEPTION_LADDER, /ladder/i, /climb-down/i, () => inObsCavern(pos(q)), 'down the reception ladder');
}

/** Kill whatever goblin is attacking (the gate guard). */
async function fightOff(q: Quest): Promise<void> {
    const t0 = tickNow(q.sdk);
    while (tickNow(q.sdk) - t0 < 200) {
        const guard = (q.sdk.getNearbyNpcs() ?? []).find((n) => /^goblin guard$/i.test(n.name) && (n.distance ?? 99) <= 4);
        if (!guard) return;
        await q.bot.attack(guard).catch(() => undefined);
        await untilTicks(q.sdk, () => !q.sdk.getNearbyNpcs().some((n) => n.index === guard.index), 40);
    }
}

export async function fetchMould(q: Quest): Promise<void> {
    if (held(q, OBJ.mould)) return;
    await intoCavern(q);
    // The keep key first (the gate is locked from the north until a key opens it once).
    const t0 = tickNow(q.sdk);
    await q.bot.walkTo(GATE_NORTH.x, GATE_NORTH.z + 1, 1).catch(() => undefined);
    let through = false;
    const since = cursor(q);
    const gate = await locNear(q, { x: 2391, z: 9457 }, /keep gate/i, /open/i, 2);
    if (gate) {
        await q.sdk.sendInteractLoc(gate.x, gate.z, gate.id, gate.optionsWithIndex.find((o) => /open/i.test(o.text))!.opIndex);
        await untilTicks(q.sdk, () => pos(q).z <= 9457 || said(q, since, /gate is locked/i), 12);
        through = pos(q).z <= 9457;
    }
    if (!through) {
        if (!held(q, OBJ.keepKey)) {
            await q.bot.walkTo(KEY_CHEST.x, KEY_CHEST.z + 1, 1).catch(() => undefined);
            await op(q, KEY_CHEST, /^chest$/i, /^open$/i, () => !!q.sdk.getNearbyLocs().some((l) => /^chest$/i.test(l.name) && Math.hypot(l.x - KEY_CHEST.x, l.z - KEY_CHEST.z) < 1 && l.optionsWithIndex.some((o) => /search/i.test(o.text))), 'opening the key chest').catch((e) => q.log(`observatory: ${(e as Error).message}`));
            await op(q, KEY_CHEST, /^chest$/i, /search/i, () => held(q, OBJ.keepKey), 'searching the key chest');
            q.log(`observatory: keep key (${tickNow(q.sdk) - t0}t)`);
        }
        await q.bot.walkTo(GATE_NORTH.x, GATE_NORTH.z + 1, 1).catch(() => undefined);
        const g = await locNear(q, { x: 2391, z: 9457 }, /keep gate/i, undefined, 2);
        const key = inv(q, OBJ.keepKey);
        if (!g || !key) throw new Error(`observatory: no keep gate (${!!g}) or key (${!!key}) at ${where(q)}`);
        await q.bot.useItemOnLoc(key, g).catch(() => undefined);
        await untilTicks(q.sdk, () => pos(q).z <= 9457, 12);
    }
    if (pos(q).z > 9457) throw new Error(`observatory: not through the keep gate (at ${where(q)})`);
    await fightOff(q);
    await op(q, MOULD_SACK, /sack/i, /search/i, () => held(q, OBJ.mould), 'the sack over the mould');
    await fightOff(q);
    q.log(`observatory: lens mould (${tickNow(q.sdk) - t0}t)`);
}

export async function makeLens(q: Quest): Promise<void> {
    if (held(q, OBJ.lens)) return;
    const glass = inv(q, OBJ.moltenGlass);
    const mould = inv(q, OBJ.mould);
    if (!glass || !mould) throw new Error(`observatory: lens needs molten glass (${!!glass}) and the mould (${!!mould})`);
    await q.sdk.sendUseItemOnItem(glass.slot, mould.slot);
    await untilTicks(q.sdk, (s) => held(q, OBJ.lens) || !!s.dialog?.isOpen, 10);
    if (q.sdk.getDialog()?.isOpen) await driveDialog(q.sdk, [], { ticks: 10 });
    if (!held(q, OBJ.lens)) throw new Error('observatory: the mould made no lens');
}

/** Through the cavern to the dome, the telescope, and the professor's reading. */
export async function telescope(q: Quest, done: () => Promise<boolean>): Promise<void> {
    if (!inDome(pos(q))) {
        await intoCavern(q);
        await q.bot.walkTo(DOME_LADDER_UP.x, DOME_LADDER_UP.z + 1, 1).catch(() => undefined);
        await op(q, DOME_LADDER_UP, /ladder/i, /climb-up/i, () => inDome(pos(q)), 'up to the dome');
    }
    for (let attempt = 1; attempt <= 3; attempt++) {
        await q.bot.walkTo(TELESCOPE.x, TELESCOPE.z + 1, 1).catch(() => undefined);
        const scope = await locNear(q, TELESCOPE, /telescope/i, /use/i, 2);
        if (!scope) throw new Error(`observatory: no telescope at ${where(q)}`);
        await q.sdk.sendInteractLoc(scope.x, scope.z, scope.id, scope.optionsWithIndex.find((o) => /use/i.test(o.text))!.opIndex);
        // A blank modal flashes, the professor's "Well done" dialog, then the sky (interface 3702).
        // His constellation reading is queued behind the sky: close it and the reading opens (qlqcobs1).
        await untilTicks(q.sdk, (s) => !!s.dialog?.isOpen, 20);
        if (q.sdk.getDialog()?.isOpen) await driveDialog(q.sdk, [], { ticks: 30, log: q.log });
        await untilTicks(q.sdk, (s) => !!s.interface?.isOpen && s.interface.interfaceId !== 8134, 15);
        if (q.sdk.getState()?.interface?.isOpen) {
            await q.sdk.waitForTicks(2);
            await q.sdk.sendCloseModal().catch(() => undefined);
        }
        await untilTicks(q.sdk, (s) => !!s.dialog?.isOpen, 15);
        await driveDialog(q.sdk, [/i can see a constellation/i, /what am i looking at/i], { ticks: 60, log: q.log });
        if (await done()) return;
    }
}

export async function leaveObservatory(q: Quest): Promise<void> {
    if (q.sdk.getDialog()?.isOpen) await driveDialog(q.sdk, [], { ticks: 10 });
    if (inDome(pos(q))) await op(q, DOME_LADDER_DOWN, /ladder/i, /climb-down/i, () => inObsCavern(pos(q)), 'down the dome ladder');
    if (inObsCavern(pos(q))) {
        if (pos(q).z <= 9457 && pos(q).x < 2400) {
            // South of the keep gate: back through it (it opens freely from this side).
            await q.bot.walkTo(2391, 9456, 1).catch(() => undefined);
            await op(q, { x: 2391, z: 9457 }, /keep gate/i, /open/i, () => pos(q).z >= 9458, 'back through the keep gate');
        }
        await q.bot.walkTo(CAVERN_LADDER_UP.x, CAVERN_LADDER_UP.z - 1, 1).catch(() => undefined);
        await op(q, CAVERN_LADDER_UP, /ladder/i, /climb-up/i, () => !inObsCavern(pos(q)), 'up to the reception');
    }
}
