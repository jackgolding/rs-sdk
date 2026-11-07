/**
 * Scorpion Catcher — Thormac's three Kharid scorpions.
 *
 * Content facts (quest_scorpcatcher/scripts/quest_scorpcatcher.rs2, area_seers/scripts/{thormac,seer}.rs2,
 * monastery/scripts/{abbot_langley,prayer_guild}.rs2, area_barbarian_outpost/scripts/outpost_gate.rs2,
 * skill_agility/scripts/barbarian_course.rs2):
 *   - Thormac (2702,3405,L3) in the Sorcerer's Tower gives the cage (0 -> 1). A Seer in Seers' Village:
 *     "I need to locate some scorpions." (-> 2), and again holding scorpion A (-> 3).
 *   - Scorpion A (2877,9796) in Taverley dungeon behind the secret "Old wall" (2875,9799), which only
 *     opens from 2 and is reached only past the Dusty-key gate and the blue dragons (lib/heroes-quest.ts).
 *   - Scorpion C (3058,3488,L1) upstairs in the Edgeville monastery: the ladder (3057,3483) wants the
 *     order's membership — Abbot Langley (3058,3484) takes Prayer 31.
 *   - Scorpion B (2552,3570) in the Barbarian Outpost. Its gate (2545,3569) wants Alfred Grimhand's
 *     Barcrawl; the course pipe (2552,3559) only joins the outpost to the course's walled start.
 *   - A cage used on a scorpion catches it; the cage changes id (a/b/c/ab/ac/bc/full). The full cage to
 *     Thormac completes.
 */
import type { Quest } from './run-quest';
import { driveDialog } from './dialog';
import { untilTicks } from './ticks';
import { dustyKey, leaveTaverley, toLava } from './heroes-quest';
import { fetchDukeShield } from '../duke-shield';

interface Tile {
    x: number;
    z: number;
    level?: number;
}

export const OBJ = { empty: 456, a: 457, ab: 458, ac: 459, b: 460, bc: 461, c: 462, full: 463 } as const;
export const CAGES = Object.values(OBJ);
const HAS: Record<'a' | 'b' | 'c', number[]> = {
    a: [OBJ.a, OBJ.ab, OBJ.ac, OBJ.full],
    b: [OBJ.b, OBJ.ab, OBJ.bc, OBJ.full],
    c: [OBJ.c, OBJ.ac, OBJ.bc, OBJ.full],
};

export const THORMAC = { x: 2702, z: 3405, level: 3 };
const TOWER_FOOT = { x: 2702, z: 3407 };
export const SEER = { x: 2709, z: 3473 };
const TAVERLEY_LADDER = { x: 2884, z: 3397 };
const SECRET_WALL = { x: 2875, z: 9799 };
const SCORPION_A = { x: 2877, z: 9796 };
const ABBOT = { x: 3058, z: 3484 };
const MONASTERY_LADDER = { x: 3057, z: 3483 };
const SCORPION_C = { x: 3058, z: 3488, level: 1 };
const SCORPION_B = { x: 2552, z: 3570 };

const pos = (q: Quest) => {
    const p = q.sdk.getState()?.player;
    return { x: p?.worldX ?? 0, z: p?.worldZ ?? 0, level: p?.level ?? 0 };
};
const where = (q: Quest) => `(${pos(q).x},${pos(q).z},L${pos(q).level})`;
const inBox = (p: Tile, x0: number, x1: number, z0: number, z1: number) => p.x >= x0 && p.x <= x1 && p.z >= z0 && p.z <= z1;
export const has = (q: Quest, which: 'a' | 'b' | 'c') => q.sdk.getInventory().some((i) => HAS[which].includes(i.id));
const cage = (q: Quest) => q.sdk.getInventory().find((i) => (CAGES as number[]).includes(i.id));

/** The Barbarian Outpost inside its wall (north of the pipe, east of the gate). */
export const inOutpost = (p: Tile) => (p.level ?? 0) === 0 && inBox(p, 2546, 2560, 3550, 3580);
/** The Sorcerer's Tower's upper floors. */
const inSorcererTower = (p: Tile) => (p.level ?? 0) > 0 && inBox(p, 2695, 2710, 3398, 3412);
export const inScorpionArea = (p: Tile) => inOutpost(p) || inSorcererTower(p) || ((p.level ?? 0) === 0 && inBox(p, 2868, 2897, 9788, 9812));

async function locNear(q: Quest, at: Tile, name: RegExp, opt?: RegExp, within = 2) {
    await q.sdk.scanNearbyLocs(15).catch(() => undefined);
    const loc = (q.sdk.getNearbyLocs() ?? [])
        .filter((l) => name.test(l.name) && (!opt || l.optionsWithIndex.some((o) => opt.test(o.text))))
        .sort((a, b) => Math.hypot(a.x - at.x, a.z - at.z) - Math.hypot(b.x - at.x, b.z - at.z))[0];
    return loc && Math.hypot(loc.x - at.x, loc.z - at.z) <= within ? loc : undefined;
}

async function op(q: Quest, at: Tile, name: RegExp, opt: RegExp, done: () => boolean, label: string, choices: RegExp[] = [], ticks = 15): Promise<void> {
    for (let attempt = 1; attempt <= 4 && !done(); attempt++) {
        const loc = await locNear(q, at, name, opt);
        if (!loc) {
            q.log(`scorp: ${label}: no ${name} with ${opt} near (${at.x},${at.z}) from ${where(q)}`);
            await q.sdk.waitForTicks(3);
            continue;
        }
        await q.sdk.sendInteractLoc(loc.x, loc.z, loc.id, loc.optionsWithIndex.find((o) => opt.test(o.text))!.opIndex);
        await untilTicks(q.sdk, (s) => done() || !!s.dialog?.isOpen, ticks);
        if (q.sdk.getDialog()?.isOpen) await driveDialog(q.sdk, choices, { done, ticks: 40, log: q.log });
        await untilTicks(q.sdk, done, 4);
    }
    if (!done()) throw new Error(`scorp: ${label} failed at ${where(q)}`);
}

/** The held cage on the Kharid scorpion nearest `at` until scorpion `which` is in it. */
async function catchScorpion(q: Quest, which: 'a' | 'b' | 'c', at: Tile): Promise<void> {
    for (let attempt = 1; attempt <= 12 && !has(q, which); attempt++) {
        // A sting poisons: eat first (qlqcsc2 was at 9 hp at the monastery).
        const hp = q.sdk.getSkill('hitpoints')?.level ?? 99;
        if (hp < 50) {
            const food = q.sdk.getInventory().find((i) => /^(shark|lobster|swordfish|monkfish)$/i.test(i.name));
            if (food) await q.bot.eatFood(food).catch(() => undefined);
        }
        const scorpion = (q.sdk.getNearbyNpcs() ?? [])
            .filter((n) => /^kharid scorpion$/i.test(n.name))
            .sort((a, b) => Math.hypot(a.x - at.x, a.z - at.z) - Math.hypot(b.x - at.x, b.z - at.z))[0];
        const held = cage(q);
        if (!held) throw new Error('scorp: no scorpion cage');
        if (!scorpion) {
            await q.bot.walkTo(at.x, at.z, 2).catch(() => undefined);
            await q.sdk.waitForTicks(3);
            continue;
        }
        // Walk up and use the cage (the high-level call opens doors on the way; the monastery's
        // L1 door can shut the scorpion in a side room).
        const r = await q.bot.useItemOnNpc(held, scorpion).catch((e) => ({ success: false, message: String(e) }));
        if (!r.success) q.log(`scorp: cage on the scorpion: ${r.message}`);
        await untilTicks(q.sdk, () => has(q, which), 10);
    }
    if (!has(q, which)) throw new Error(`scorp: scorpion ${which.toUpperCase()} not caught (at ${where(q)})`);
    q.log(`scorp: caught scorpion ${which.toUpperCase()}`);
}

// ── Thormac and the seers

/** Up the Sorcerer's Tower to Thormac (three ladders). */
export async function talkThormac(q: Quest, choices: RegExp[]): Promise<void> {
    if (!inSorcererTower(pos(q))) await q.goTo(TOWER_FOOT, 2);
    if (pos(q).level < 3) await q.climbTo(3);
    await q.talk(/^thormac$/i, choices);
    await driveDialog(q.sdk, choices, { ticks: 15, log: q.log });
}

export async function leaveSorcererTower(q: Quest): Promise<void> {
    if (inSorcererTower(pos(q))) await q.climbTo(0);
}

/** A seer in Seers' Village; the looking glass has delays between its pages. */
export async function talkSeer(q: Quest): Promise<void> {
    await q.talk(/^seer$/i, [/i need to locate some scorpions/i], SEER);
    for (let i = 0; i < 3; i++) {
        if (!(await untilTicks(q.sdk, (s) => !!s.dialog?.isOpen, 15))) break;
        await driveDialog(q.sdk, [/i need to locate some scorpions/i], { ticks: 60, log: q.log });
    }
}

// ── A: Taverley dungeon

/** The room behind the secret wall (2875,9799), south of it. */
const inSecretRoom = (p: Tile) => (p.level ?? 0) === 0 && inBox(p, 2868, 2884, 9788, 9798);

/**
 * Scorpion A: behind the secret wall (loc 2117, 2875,9799), which only joins the dungeon past the Dusty-key
 * gate (2924,9803) and the blue dragons' pen (rs-stun-toolkit's probe: from the entrance side it stalls at
 * 2880,9801). lib/heroes-quest.ts gets the Dusty key from Velrak and opens the gate; a dragonfire shield worn
 * for the pen. The wall opens only from stage 2 (the Seer's hint) and walks you through itself.
 */
export async function scorpionA(q: Quest): Promise<void> {
    if (has(q, 'a')) return;
    if (!inSecretRoom(pos(q))) {
        let shield = q.sdk.getInventory().find((i) => /dragonfire shield|anti-?dragon shield/i.test(i.name));
        if (!shield && !q.sdk.getEquipment().some((i) => /dragonfire shield|anti-?dragon shield/i.test(i.name))) {
            await fetchDukeShield(q.bot, q.sdk, q.log);
            shield = q.sdk.getInventory().find((i) => /dragonfire shield|anti-?dragon shield/i.test(i.name));
        }
        if (shield) await q.bot.equipItem(shield).catch(() => undefined);
        const weapon = q.sdk.getInventory().find((i) => /scimitar|longsword|sword|whip|battleaxe/i.test(i.name));
        if (weapon) await q.bot.equipItem(weapon).catch(() => undefined);
        await dustyKey(q);
        await toLava(q);
        await q.bot.walkTo(SECRET_WALL.x, SECRET_WALL.z, 1).catch(() => undefined);
        for (let attempt = 1; attempt <= 4 && !inSecretRoom(pos(q)); attempt++) {
            if (Math.hypot(pos(q).x - SECRET_WALL.x, pos(q).z - SECRET_WALL.z) > 2) await q.bot.walkTo(SECRET_WALL.x, SECRET_WALL.z, 0).catch(() => undefined);
            await q.sdk.sendInteractLoc(SECRET_WALL.x, SECRET_WALL.z, 2117, 1);
            await untilTicks(q.sdk, (s) => inSecretRoom(pos(q)) || !!s.dialog?.isOpen, 12);
            if (q.sdk.getDialog()?.isOpen) await driveDialog(q.sdk, [], { ticks: 10 });
        }
        if (!inSecretRoom(pos(q))) throw new Error(`scorp: the secret wall did not open (at ${where(q)}; Seer's hint first)`);
    }
    await guarded(q, () => catchScorpion(q, 'a', SCORPION_A));
    // The walk back to the ladder crosses the inner dungeon (a fresh staging run died on it after catching A):
    // teleport out instead — Camelot lands beside the Seers, the next stop.
    if (!(await teleportOut(q))) await guarded(q, () => leaveSecretRoom(q));
}

const FOOD = /^(shark|manta ray|sea turtle|monkfish|swordfish|lobster|bass|tuna)$/i;
async function eatIfLow(q: Quest, below = 0.6): Promise<void> {
    const p = q.sdk.getState()?.player;
    if (!p || p.hp > (p.maxHp ?? 10) * below) return;
    const food = q.sdk.getInventory().find((i) => FOOD.test(i.name));
    if (food) await q.bot.eatFood(food).catch(() => undefined);
}

/**
 * Run `fn` under Protect from Melee (Prayer 43) with food eaten below 60% hp every tick — the Taverley inner
 * dungeon's poison spiders, hellhounds and demons hit a passer-by hard. Prayer goes off again afterwards.
 */
async function guarded<T>(q: Quest, fn: () => Promise<T>): Promise<T> {
    const pray = (q.sdk.getPrayerState()?.prayerLevel ?? 0) >= 43;
    if (pray) await q.bot.activatePrayer('protect_from_melee').catch(() => undefined);
    let running = true;
    const watch = (async () => {
        while (running) {
            await eatIfLow(q).catch(() => undefined);
            const pr = q.sdk.getPrayerState();
            if (pray && pr && pr.prayerPoints > 0 && !q.sdk.isPrayerActive('protect_from_melee')) await q.bot.activatePrayer('protect_from_melee').catch(() => undefined);
            await q.sdk.waitForTicks(1).catch(() => undefined);
        }
    })();
    try {
        return await fn();
    } finally {
        running = false;
        await watch;
        if (pray && q.sdk.isPrayerActive('protect_from_melee')) await q.bot.deactivatePrayer('protect_from_melee').catch(() => undefined);
    }
}

/** Camelot (45: 1 law, 5 air) or Falador (37: 1 law, 3 air, 1 water) Teleport; true once `done` holds. */
async function castTeleport(q: Quest, done: () => boolean, label: string, camelotOnly = false): Promise<boolean> {
    const magic = q.sdk.getSkill('magic')?.level ?? 1;
    const spells = [
        { name: 'Camelot', id: 1174, ok: magic >= 45 && q.count('law rune') >= 1 && q.count('air rune') >= 5 },
        { name: 'Falador', id: 1170, ok: !camelotOnly && magic >= 37 && q.count('law rune') >= 1 && q.count('air rune') >= 3 && q.count('water rune') >= 1 },
    ].filter((s) => s.ok);
    for (const s of spells) {
        for (let attempt = 1; attempt <= 3 && !done(); attempt++) {
            await q.sdk.sendSetTab(6).catch(() => undefined);
            await q.sdk.waitForTicks(1);
            await q.sdk.sendClickComponent(s.id);
            await untilTicks(q.sdk, done, 8);
        }
        if (done()) {
            q.log(`scorp: ${s.name} Teleport ${label} to ${where(q)}`);
            return true;
        }
    }
    q.log(`scorp: no teleport ${label} (magic ${magic}, law ${q.count('law rune')}, air ${q.count('air rune')})`);
    return false;
}

/** Out of the Taverley dungeon by teleport. */
const teleportOut = (q: Quest) => castTeleport(q, () => pos(q).z < 6400, 'out of Taverley');

/** Camelot Teleport from far away (the monastery) back toward the outpost and Thormac; walks when it cannot. */
export async function toCamelot(q: Quest): Promise<void> {
    if (Math.hypot(pos(q).x - 2757, pos(q).z - 3478) < 150) return;
    const from = pos(q);
    await castTeleport(q, () => Math.hypot(pos(q).x - from.x, pos(q).z - from.z) > 50, 'to Camelot', true);
}

/** Out of the secret room (the wall again), then lib/heroes-quest.ts's way out of Taverley. */
export async function leaveSecretRoom(q: Quest): Promise<void> {
    for (let attempt = 1; attempt <= 4 && inSecretRoom(pos(q)); attempt++) {
        await q.bot.walkTo(SECRET_WALL.x, SECRET_WALL.z - 1, 0).catch(() => undefined);
        await q.sdk.sendInteractLoc(SECRET_WALL.x, SECRET_WALL.z, 2117, 1);
        await untilTicks(q.sdk, () => !inSecretRoom(pos(q)), 12);
    }
    await outOfWallSide(q);
}

/** North of the secret wall is not joined to the entrance ladder (qlqcsc1 stuck at 2880,9801): back east to the Dusty-key gate. */
const nearWallSide = (p: Tile) => (p.level ?? 0) === 0 && inBox(p, 2868, 2897, 9788, 9812);
async function outOfWallSide(q: Quest): Promise<void> {
    if (nearWallSide(pos(q))) {
        await q.sdk.scanNearbyLocs(10).catch(() => undefined);
        const ladder = (q.sdk.getNearbyLocs() ?? []).find((l) => /ladder/i.test(l.name) && l.optionsWithIndex.some((o) => /climb-up/i.test(o.text)));
        if (!ladder || ladder.reachable === false) await q.bot.walkTo(2921, 9803, 2).catch(() => undefined);
    }
    await leaveTaverley(q);
}

// ── C: the monastery

export async function scorpionC(q: Quest): Promise<void> {
    if (has(q, 'c')) return;
    if (pos(q).level === 0) {
        await q.goTo({ x: MONASTERY_LADDER.x, z: MONASTERY_LADDER.z + 1 }, 2);
        const up = () => pos(q).level === 1;
        const ladder = await locNear(q, MONASTERY_LADDER, /ladder/i, /climb-up/i, 1);
        if (ladder) {
            await q.sdk.sendInteractLoc(ladder.x, ladder.z, ladder.id, ladder.optionsWithIndex.find((o) => /climb-up/i.test(o.text))!.opIndex);
            await untilTicks(q.sdk, (s) => up() || !!s.dialog?.isOpen, 15);
            // Not a member yet: the Abbot (beside the ladder) asks; Prayer 31 joins.
            if (q.sdk.getDialog()?.isOpen) await driveDialog(q.sdk, [/can i join your order/i], { ticks: 30, log: q.log });
        }
        if (!up()) await q.talk(/^abbot langley$/i, [/how do i get further into the monastery/i, /can i join your order/i], ABBOT);
        await op(q, MONASTERY_LADDER, /ladder/i, /climb-up/i, up, 'up the monastery ladder', [/can i join your order/i]);
    }
    await catchScorpion(q, 'c', SCORPION_C);
    await q.climbTo(0);
}

// ── B: the Barbarian Outpost, through its gate (Alfred Grimhand's Barcrawl)
//
// The course pipe (2552,3559) is no way in: it joins the outpost to the course's walled start
// (2550-2553,3550-3558), which is reached only from the outpost or the rope swing (barbarian_course.rs2,
// maps m39_55). The gate (loc 2116, 2545,3569) opens for anyone who has done the Barcrawl; otherwise its
// guard talks instead (barbarian_outpost_guard.rs2).

const OUTPOST_GATE = { x: 2545, z: 3569 };

async function throughGate(q: Quest, inward: boolean): Promise<void> {
    const done = () => inOutpost(pos(q)) === inward;
    if (done()) return;
    if (inward) await q.goTo({ x: OUTPOST_GATE.x - 1, z: OUTPOST_GATE.z }, 1);
    else await q.bot.walkTo(OUTPOST_GATE.x + 1, OUTPOST_GATE.z, 1).catch(() => undefined);
    for (let attempt = 1; attempt <= 4 && !done(); attempt++) {
        await q.sdk.sendInteractLoc(OUTPOST_GATE.x, OUTPOST_GATE.z, 2116, 1);
        await untilTicks(q.sdk, (s) => done() || !!s.dialog?.isOpen, 12);
        if (q.sdk.getDialog()?.isOpen) {
            const text = await driveDialog(q.sdk, [], { ticks: 30 });
            if (/barbarians only|barcrawl/i.test(text)) throw new Error("scorp: the Barbarian Outpost's gate wants Alfred Grimhand's Barcrawl done");
        }
    }
    if (!done()) throw new Error(`scorp: not through the outpost gate (at ${where(q)})`);
}

export async function scorpionB(q: Quest): Promise<void> {
    if (!has(q, 'b')) {
        await throughGate(q, true);
        await catchScorpion(q, 'b', SCORPION_B);
    }
    await throughGate(q, false);
}

/** The agility course's pipe, the way between the outpost's yard and the course's walled-off pocket south of it. */
const COURSE_PIPE = { x: 2552, z: 3559 };

/**
 * Out of the agility course's pocket, which has no walking route to the gate: every later quest failed
 * here "not through the outpost gate" after a failed Horror run left ABGARMY06 inside (2026-11-07).
 */
async function outOfCoursePocket(q: Quest): Promise<void> {
    // The pipe's own row is still the pocket side.
    if (!inOutpost(pos(q)) || pos(q).z > COURSE_PIPE.z) return;
    for (let attempt = 1; attempt <= 4 && pos(q).z <= COURSE_PIPE.z; attempt++) {
        const pipe = await locNear(q, COURSE_PIPE, /^obstacle pipe$/i, /squeeze/i, 2);
        if (!pipe) throw new Error(`scorp: no obstacle pipe near ${where(q)}`);
        const op = pipe.optionsWithIndex.find((o) => /squeeze/i.test(o.text))!;
        await q.sdk.sendInteractLoc(pipe.x, pipe.z, pipe.id, op.opIndex);
        await untilTicks(q.sdk, () => pos(q).z > COURSE_PIPE.z, 12);
    }
    if (pos(q).z <= COURSE_PIPE.z) throw new Error(`scorp: the obstacle pipe did not take us out (at ${where(q)})`);
    q.log(`scorp: out of the agility course's pocket at ${where(q)}`);
}

export async function leaveOutpost(q: Quest): Promise<void> {
    await outOfCoursePocket(q);
    if (inOutpost(pos(q))) await throughGate(q, false);
}

export async function leaveScorpionArea(q: Quest): Promise<void> {
    if ((inSecretRoom(pos(q)) || nearWallSide(pos(q))) && !(await teleportOut(q))) {
        await guarded(q, async () => {
            if (inSecretRoom(pos(q))) await leaveSecretRoom(q);
            else await outOfWallSide(q);
        });
    }
    await leaveOutpost(q);
    await leaveSorcererTower(q);
}
