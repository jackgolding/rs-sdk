/**
 * Tree Gnome Village — the maze, the village's loose railing, the ballista, the Khazard stronghold
 * and the warlord.
 *
 * Content facts (quest_tree/scripts/{quest_tree,khazard_warlord}.rs2, area_gnome/scripts/{king_bolren,
 * commander_montai,elkoy,gnomevillage_fence}.rs2; placements m39_49, m39_50):
 *   - King Bolren (2542,3169) is inside the fenced village (x 2515-2546, z 3161-3174; the railing is on the south edge of 2515,3161). The only way in
 *     on foot is the maze to (2515,3160), then the Loose Railing (2515,3161) "Squeeze-through"; it
 *     works both ways. Bolren's start and orb hand-in dialogs telejump you out to (2504,3191).
 *   - Commander Montai (2523,3211): 6 normal logs (inv_total(inv, logs)).
 *   - The Ballista (2508,3210) "Fire" from stage 4: three multi5 menus "0001".."0005", headed height,
 *     x and y. The answer is fixed in this build: height 4, x 3, y 5 (no tracker needs talking to).
 *   - The crumbled wall (2509,3253) "Climb-over" from its south side once the ballista hit (>= 5).
 *     It lands at (2509,3255); the diagonal door (2505,3256) opens to the ladder (2503,3252), up to the chest (2506,3259,L1): Open, then Search -> the orb (-> 6).
 *     A Khazard commander (lvl 48) attacks on the way. The stronghold door (2502,3250) only opens from
 *     inside (north).
 *   - The Khazard warlord (lvl 112, 170 hp, spawn 2457,3302, wanders 9) attacks on Talk-to; his death
 *     at stage 7 puts the orbs of protection in the pack (-> 8).
 */
import type { Quest } from './run-quest';
import { driveDialog } from './dialog';
import { tickNow, untilTicks } from './ticks';

interface Tile {
    x: number;
    z: number;
    level?: number;
}

/** The orb and the orbs share the name "Orb of protection". */
export const OBJ = { orb: 587, orbs: 588, amulet: 589 } as const;

export const MONTAI = { x: 2523, z: 3211 };
export const BOLREN = { x: 2542, z: 3169 };
const MAZE_END = { x: 2515, z: 3160 };
const RAILING = { x: 2515, z: 3161 };
const VILLAGE_SIDE = { x: 2515, z: 3161 };
const BALLISTA = { x: 2508, z: 3210 };
const WALL = { x: 2509, z: 3253 };
const LADDER = { x: 2503, z: 3252 };
/** The diagonal door between the crumbled wall's landing and the ladder room. */
const INNER_DOOR = { x: 2505, z: 3256 };
const CHEST = { x: 2506, z: 3259, level: 1 };
const DOOR = { x: 2502, z: 3250 };
export const WARLORD = { x: 2457, z: 3302 };
/** Ballista menus: header word -> the option to pick. */
const COORDS: Array<[RegExp, RegExp]> = [
    [/height-coordinate/i, /^0004$/],
    [/x-coordinate/i, /^0003$/],
    [/y-coordinate/i, /^0005$/],
];

const pos = (q: Quest) => {
    const p = q.sdk.getState()?.player;
    return { x: p?.worldX ?? 0, z: p?.worldZ ?? 0, level: p?.level ?? 0 };
};
const where = (q: Quest) => `(${pos(q).x},${pos(q).z},L${pos(q).level})`;
const inBox = (p: Tile, x0: number, x1: number, z0: number, z1: number) => p.x >= x0 && p.x <= x1 && p.z >= z0 && p.z <= z1;
export const held = (q: Quest, id: number) => q.sdk.getInventory().some((i) => i.id === id);

/** Inside the gnome village's fence (the railing's north side). */
export const inGnomeVillage = (p: Tile) => (p.level ?? 0) === 0 && (inBox(p, 2515, 2546, 3161, 3174) || inBox(p, 2522, 2541, 3159, 3160));
/** The Khazard stronghold: north of its door (2502,3250) and crumbled wall (2509,3253), both floors. */
export const inKhazardStronghold = (p: Tile) =>
    (p.level ?? 0) > 0 ? inBox(p, 2499, 2513, 3250, 3261) : inBox(p, 2500, 2505, 3251, 3258) || inBox(p, 2506, 2513, 3254, 3259);

function cursor(q: Quest): number {
    return Math.max(0, ...(q.sdk.getState()?.gameMessages ?? []).map((m) => m.observationId ?? m.tick));
}
function said(q: Quest, since: number, text: RegExp): boolean {
    return (q.sdk.getState()?.gameMessages ?? []).some((m) => (m.observationId ?? m.tick) > since && text.test(m.text));
}

/** The loc `name` with option `opt` nearest `at` (within 3 tiles). */
async function locNear(q: Quest, at: Tile, name: RegExp, opt: RegExp) {
    await q.sdk.scanNearbyLocs(12).catch(() => undefined);
    const loc = (q.sdk.getNearbyLocs() ?? [])
        .filter((l) => name.test(l.name) && l.optionsWithIndex.some((o) => opt.test(o.text)))
        .sort((a, b) => Math.hypot(a.x - at.x, a.z - at.z) - Math.hypot(b.x - at.x, b.z - at.z))[0];
    return loc && Math.hypot(loc.x - at.x, loc.z - at.z) <= 3 ? loc : undefined;
}

/** Op a loc near `at` until `done()`; dialogs it opens are clicked through. */
async function op(q: Quest, at: Tile, name: RegExp, opt: RegExp, done: () => boolean, label: string, ticks = 15): Promise<void> {
    for (let attempt = 1; attempt <= 4 && !done(); attempt++) {
        const loc = await locNear(q, at, name, opt);
        if (!loc) {
            q.log(`tree: ${label}: no ${name} with ${opt} near (${at.x},${at.z}) from ${where(q)}`);
            await q.sdk.waitForTicks(3);
            continue;
        }
        await q.sdk.sendInteractLoc(loc.x, loc.z, loc.id, loc.optionsWithIndex.find((o) => opt.test(o.text))!.opIndex);
        await untilTicks(q.sdk, (s) => done() || !!s.dialog?.isOpen, ticks);
        if (q.sdk.getDialog()?.isOpen) await driveDialog(q.sdk, [], { done, ticks: 40, log: q.log });
        await untilTicks(q.sdk, done, 4);
    }
    if (!done()) throw new Error(`tree: ${label} failed at ${where(q)}`);
}

// ── the village

/** Through the maze and the loose railing to the village side. */
export async function enterGnomeVillage(q: Quest): Promise<void> {
    if (inGnomeVillage(pos(q))) return;
    await q.goTo(MAZE_END, 1);
    await op(q, RAILING, /^loose railing$/i, /squeeze/i, () => inGnomeVillage(pos(q)), 'squeeze into the village', 10);
    q.log(`tree: into the gnome village at ${where(q)}`);
}

/** Out by the loose railing to the maze side; walkTo routes the maze from there. */
export async function leaveGnomeVillage(q: Quest): Promise<void> {
    if (!inGnomeVillage(pos(q))) return;
    await q.sdk.sendCloseModal().catch(() => undefined);
    if (Math.hypot(pos(q).x - VILLAGE_SIDE.x, pos(q).z - VILLAGE_SIDE.z) > 2) {
        const walk = await q.bot.walkTo(VILLAGE_SIDE.x, VILLAGE_SIDE.z, 1);
        if (!walk.success) q.log(`tree: walk to the railing: ${walk.message}`);
    }
    await op(q, RAILING, /^loose railing$/i, /squeeze/i, () => !inGnomeVillage(pos(q)), 'squeeze out of the village', 10);
    q.log(`tree: out of the gnome village at ${where(q)}`);
}

/** Into the village, then King Bolren's dialog. */
export async function seeBolren(q: Quest, choices: RegExp[]): Promise<void> {
    await enterGnomeVillage(q);
    await q.talk(/^king bolren$/i, choices, BOLREN);
    // The ending's chant and walk run through a queue after the dialog: let it finish.
    await driveDialog(q.sdk, [], { ticks: 30, log: q.log });
}

// ── the battlefield

/** Fire the ballista with the fixed coordinates: 4 -> 5. */
export async function fireBallista(q: Quest): Promise<void> {
    await q.goTo({ x: BALLISTA.x, z: BALLISTA.z - 2 }, 2);
    for (let attempt = 1; attempt <= 3; attempt++) {
        const loc = await locNear(q, BALLISTA, /^ballista$/i, /^fire$/i);
        if (!loc) throw new Error(`tree: no ballista near ${where(q)}`);
        const since = cursor(q);
        await q.sdk.sendInteractLoc(loc.x, loc.z, loc.id, loc.optionsWithIndex.find((o) => /^fire$/i.test(o.text))!.opIndex);
        const t0 = tickNow(q.sdk);
        let missed = false;
        let hit = false;
        while (tickNow(q.sdk) - t0 < 80) {
            if (!(await untilTicks(q.sdk, (s) => !!s.dialog?.isOpen, 10))) break;
            const d = q.sdk.getDialog()!;
            const text = (d.allComponents ?? []).map((c) => c.text).join(' ');
            if (/missed the target/i.test(text)) missed = true;
            if (/reduced to rubble/i.test(text)) hit = true;
            const options = d.options ?? [];
            const cont = options.find((o) => /click here to continue/i.test(o.text));
            const row = COORDS.find(([head]) => head.test(text));
            const pick = cont ?? (row ? options.find((o) => row[1].test(o.text.trim())) : undefined);
            if (!pick) {
                q.log(`tree: ballista menu with no pick: ${JSON.stringify(options.map((o) => o.text))} / ${text.slice(0, 80)}`);
                break;
            }
            const before = JSON.stringify(d.options) + text;
            await q.sdk.sendClickDialog(pick.index);
            await untilTicks(q.sdk, () => {
                const n = q.sdk.getDialog();
                return !n?.isOpen || JSON.stringify(n.options) + (n.allComponents ?? []).map((c) => c.text).join(' ') !== before;
            }, 8);
        }
        if (said(q, since, /missed the target/i)) missed = true;
        if (hit) {
            q.log('tree: the ballista hit the Khazard stronghold');
            return;
        }
        q.log(`tree: ballista attempt ${attempt} ${missed ? 'missed' : 'did not register'}`);
    }
    throw new Error('tree: the ballista never hit the stronghold');
}

/** Kill whatever is attacking us (the Khazard commander) before it interrupts a climb. */
async function fightOff(q: Quest, npc: RegExp): Promise<void> {
    const t0 = tickNow(q.sdk);
    while (tickNow(q.sdk) - t0 < 100) {
        const foe = q.sdk.findNearbyNpc(npc);
        if (!foe || (foe.distance ?? 99) > 3 || !q.sdk.getState()?.player?.combat?.inCombat) return;
        await eatIfLow(q);
        const res = await q.bot.attack(foe);
        if (!res.success) q.log(`tree: attack ${foe.name}: ${res.message}`);
        await untilTicks(q.sdk, () => !q.sdk.findNearbyNpc(npc), 15);
    }
}

async function eatIfLow(q: Quest): Promise<void> {
    const hp = q.sdk.getSkill('hitpoints');
    if (!hp || hp.level >= hp.baseLevel * 0.55) return;
    const food = q.sdk.getInventory().find((i) => i.optionsWithIndex?.some((o) => /^eat$/i.test(o.text)));
    if (food) await q.bot.eatFood(food).catch(() => undefined);
}

/** Over the crumbled wall, up to the chest, the orb: 5 -> 6. */
export async function takeOrb(q: Quest): Promise<void> {
    if (held(q, OBJ.orb)) return;
    if (!inKhazardStronghold(pos(q))) {
        await q.goTo({ x: WALL.x, z: WALL.z - 1 }, 0);
        await op(q, WALL, /^crumbled wall$/i, /climb-over/i, () => inKhazardStronghold(pos(q)), 'climb the crumbled wall', 12);
        await untilTicks(q.sdk, () => q.sdk.getState()?.player?.animId === -1, 4);
        q.log(`tree: over the crumbled wall at ${where(q)}`);
    }
    await fightOff(q, /^khazard commander$/i);
    if (pos(q).level === 0) {
        const door = await locNear(q, INNER_DOOR, /^door$/i, /^open$/i);
        if (door) {
            await q.bot.openDoor(door).catch(() => undefined);
            await q.sdk.waitForTicks(2);
        }
        await op(q, LADDER, /^ladder$/i, /climb-up/i, () => pos(q).level === 1, 'climb the stronghold ladder', 15);
    }
    const open = () => !!q.sdk.getNearbyLocs()?.some((l) => /^open chest$/i.test(l.name) && Math.hypot(l.x - CHEST.x, l.z - CHEST.z) <= 1);
    await op(q, CHEST, /chest/i, /^(open|search)$/i, () => open() || held(q, OBJ.orb), 'open the chest', 15);
    await op(q, CHEST, /^open chest$/i, /^search$/i, () => held(q, OBJ.orb), 'search the chest', 15);
    q.log('tree: took the orb of protection');
    await fightOff(q, /^khazard commander$/i);
}

/** Down the ladder and out the stronghold's door (it opens from inside). */
export async function leaveKhazardStronghold(q: Quest): Promise<void> {
    if (!inKhazardStronghold(pos(q))) return;
    if (pos(q).level > 0) await op(q, LADDER, /^ladder$/i, /climb-down/i, () => pos(q).level === 0, 'climb down the stronghold ladder', 15);
    for (let attempt = 1; attempt <= 3 && inKhazardStronghold(pos(q)); attempt++) {
        const walk = await q.bot.walkTo(DOOR.x, DOOR.z - 2, 1);
        if (walk.success && !inKhazardStronghold(pos(q))) break;
        const door = await locNear(q, DOOR, /^door$/i, /^open$/i);
        if (door) {
            await q.sdk.sendInteractLoc(door.x, door.z, door.id, door.optionsWithIndex.find((o) => /^open$/i.test(o.text))!.opIndex);
            await untilTicks(q.sdk, () => !inKhazardStronghold(pos(q)), 8);
        }
        if (inKhazardStronghold(pos(q))) {
            await q.sdk.sendWalk(DOOR.x, DOOR.z - 1, true);
            await untilTicks(q.sdk, () => !inKhazardStronghold(pos(q)), 8);
        }
    }
    if (inKhazardStronghold(pos(q))) throw new Error(`tree: still in the Khazard stronghold at ${where(q)}`);
    q.log(`tree: out of the Khazard stronghold at ${where(q)}`);
}

// ── the warlord

/** Kill the Khazard warlord: his death puts the orbs in the pack (7 -> 8). */
export async function killWarlord(q: Quest): Promise<void> {
    if (held(q, OBJ.orbs)) return;
    await leaveKhazardStronghold(q);
    const weapon = q.sdk.getInventory().find((i) => /(scimitar|longsword)$/i.test(i.name));
    if (weapon) await q.bot.equipItem(weapon).catch(() => undefined);
    const t0 = tickNow(q.sdk);
    while (!held(q, OBJ.orbs) && tickNow(q.sdk) - t0 < 900) {
        await eatIfLow(q);
        const hp = q.sdk.getSkill('hitpoints');
        if (hp && hp.level < 25 && !q.sdk.getInventory().some((i) => i.optionsWithIndex?.some((o) => /^eat$/i.test(o.text)))) {
            throw new Error(`tree: out of food against the warlord (hp ${hp.level})`);
        }
        if (q.sdk.getDialog()?.isOpen) {
            await driveDialog(q.sdk, [], { done: () => held(q, OBJ.orbs), ticks: 20, log: q.log });
            continue;
        }
        if (q.sdk.getState()?.player?.combat?.inCombat) {
            await untilTicks(q.sdk, () => held(q, OBJ.orbs) || !!q.sdk.getDialog()?.isOpen || !q.sdk.getState()?.player?.combat?.inCombat, 8);
            continue;
        }
        const warlord = q.sdk.findNearbyNpc(/^khazard warlord$/i);
        if (!warlord) {
            await q.goTo(WARLORD, 4);
            await untilTicks(q.sdk, () => !!q.sdk.findNearbyNpc(/^khazard warlord$/i), 10);
            continue;
        }
        const res = await q.bot.attack(warlord);
        if (!res.success) {
            q.log(`tree: attack the warlord: ${res.message}`);
            await q.sdk.waitForTicks(3);
        }
        await untilTicks(q.sdk, () => held(q, OBJ.orbs) || !!q.sdk.getDialog()?.isOpen, 8);
    }
    if (!held(q, OBJ.orbs)) throw new Error(`tree: no orbs after ${tickNow(q.sdk) - t0}t at the warlord`);
    await driveDialog(q.sdk, [], { ticks: 10 });
    q.log(`tree: the warlord fell; holding the orbs of protection (${tickNow(q.sdk) - t0}t)`);
}
