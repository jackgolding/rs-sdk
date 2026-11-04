/**
 * Horror from the Deep — the route and mechanics (bots/quests/horror-from-the-deep.ts is the definition).
 *
 * Content facts (quest_horror/scripts/{quest_horror,basalt_rocks,horror_girlfriend,horror_lighthousekeeper,
 * horror_dagannoth}.rs2, area_barbarian_outpost/scripts/gunnjorn.rs2, skill_combat npc_combat.rs2); route cross-checked
 * with rs-stun-toolkit's q-horror.ts spec (whose "inside/outside" of the outpost gate is reversed — the outpost is EAST of
 * its gate, the basalt causeway WEST of it):
 *   - Basalt rocks (locs 4550..4559) from (2522,3594) north to the lighthouse causeway; spots 3/4 and 7/8 can slip
 *     (stat_random agility 5/255) and the tide sweeps you back to the shore.
 *   - Larrissa (1336, 2508,3634): "With what?", "But how can I help?", "Okay, I'll help!" (1).
 *   - Gunnjorn (607, 2540,3548) in the agility course's walled start, through the outpost (gate: Barcrawl) and its
 *     obstacle pipe (2287, 2552,3559; Agility 35): the lighthouse key.
 *   - The broken bridge (4615 at 2596,3608 / 4616 at 2598,3608): a plank + 4 nails + hammer on each half.
 *   - The lighthouse doorway (4577, 2509,3636): op1 with the key unlocks it; with both halves fixed op1 enters the copy
 *     (2445,4596) (2). Stairs (4568/4569, 2442,4600) to L2; tar, tinderbox, molten glass on the broken cog (4588,
 *     2443,4599) -> moved to the real lighthouse top (4).
 *   - Stairs top (4570, 2506,3641,L2) -> copy L1 -> L0; ladder (4383, 2445,4604) -> cave L1 (2519,4618). The strange wall:
 *     a fire, water, earth and air rune, a stab/slash weapon and an arrow used on the mid door (4543, 2514,4627; "Yes"
 *     each); then the far right door (4545, 2516,4627) from the south; ladder 4485 (2515,4630) down to Jossik (1335).
 *   - Jossik spawns the Dagannoth (jr4, 120 hp, ranged 8, any style hurts it; its death -> 5); Jossik again spawns the
 *     mother: air/water/fire/earth forms take only that element's spells, the melee form only melee, the ranged form
 *     only ranged (skipped: no bow). Forms change every 30 ticks. Her death: complete, teleported to (2515,10001,L1).
 */
import type { Quest } from './run-quest';
import { driveDialog } from './dialog';
import { tickNow, untilTicks } from './ticks';

interface Tile {
    x: number;
    z: number;
    level?: number;
}

export const OBJ = { key: 3848, casket: 3849 } as const;
const NPC = { larrissa: 1336, gunnjorn: 607, jossik: 1335, jr: 1347 };
const MOTHER: Record<number, 'air' | 'water' | 'earth' | 'fire' | 'melee' | 'ranged' | 'spawn'> = {
    1348: 'spawn',
    1349: 'spawn',
    1350: 'spawn',
    1351: 'air',
    1352: 'water',
    1353: 'fire',
    1354: 'earth',
    1355: 'ranged',
    1356: 'melee',
};
/** Blasts (Magic 41-59), death runes from the mule (sdk/spells.ts). */
const BLAST = { air: 1172, water: 1175, earth: 1177, fire: 1181 } as const;
const CAMELOT_TELEPORT = 1174;

type Spot = { id: number; x: number; z: number; land: Tile };
const SPOTS_N: Spot[] = [
    { id: 4550, x: 2522, z: 3595, land: { x: 2522, z: 3598 } },
    { id: 4552, x: 2522, z: 3600, land: { x: 2522, z: 3603 } },
    { id: 4554, x: 2518, z: 3611, land: { x: 2515, z: 3611 } },
    { id: 4556, x: 2514, z: 3613, land: { x: 2514, z: 3616 } },
    { id: 4558, x: 2514, z: 3617, land: { x: 2514, z: 3620 } },
];
const SPOTS_S: Spot[] = [
    { id: 4559, x: 2514, z: 3619, land: { x: 2514, z: 3616 } },
    { id: 4557, x: 2514, z: 3615, land: { x: 2514, z: 3612 } },
    { id: 4555, x: 2516, z: 3611, land: { x: 2518, z: 3610 } },
    { id: 4553, x: 2522, z: 3602, land: { x: 2522, z: 3599 } },
    { id: 4551, x: 2522, z: 3597, land: { x: 2522, z: 3594 } },
];
const BASALT_SHORE = { x: 2522, z: 3594 };
const LARRISSA = { x: 2508, z: 3634 };
const OUTPOST_GATE = { x: 2545, z: 3569, id: 2116 };
const PIPE = { x: 2552, z: 3559, id: 2287 };
const GUNNJORN = { x: 2540, z: 3548 };
const BRIDGE_L = { x: 2596, z: 3608, id: 4615 };
const BRIDGE_R = { x: 2598, z: 3608, id: 4616 };
const DOOR = { x: 2509, z: 3636, id: 4577 };
const COG = { x: 2443, z: 4599, id: 4588 };
const MID_DOOR = { x: 2514, z: 4627, id: 4543 };
const FAR_RIGHT_DOOR = { x: 2516, z: 4627, id: 4545 };
const JOSSIK_LADDER = { x: 2515, z: 4630, id: 4485 };
const JOSSIK = { x: 2517, z: 4632 };

const inBox = (p: Tile, x0: number, x1: number, z0: number, z1: number) => p.x >= x0 && p.x <= x1 && p.z >= z0 && p.z <= z1;
const pos = (q: Quest) => {
    const p = q.sdk.getState()?.player;
    return { x: p?.worldX ?? 0, z: p?.worldZ ?? 0, level: p?.level ?? 0 };
};
const where = (q: Quest) => `(${pos(q).x},${pos(q).z},L${pos(q).level})`;
const holds = (q: Quest, id: number) => q.sdk.getInventory().some((i) => i.id === id);

/** North of the basalt rocks: Larrissa, the lighthouse, the causeway up to the broken bridge (Rellekka's side, x >= 2598, excluded). */
export const onLighthouseSide = (p: Tile) => (p.level ?? 0) === 0 && inBox(p, 2490, 2597, 3595, 3660);
/** The lighthouse copy (m38_71) and the caves under it (m39_72), any floor. */
export const inLighthouse = (p: Tile) => inBox(p, 2432, 2560, 4544, 4671);
/** The post-quest cave the mother's death teleports you to (m39_156). */
const inPostQuestCave = (p: Tile) => inBox(p, 2496, 2559, 9984, 10047);
/** The real lighthouse's upper floors. */
const inLighthouseTop = (p: Tile) => (p.level ?? 0) > 0 && inBox(p, 2498, 2516, 3630, 3650);
/** The agility course's walled start, behind the pipe. */
const inCourseStart = (p: Tile) => (p.level ?? 0) === 0 && inBox(p, 2533, 2553, 3542, 3558);
const inOutpost = (p: Tile) => (p.level ?? 0) === 0 && inBox(p, 2546, 2560, 3559, 3580);
export const inHorrorArea = (p: Tile) => onLighthouseSide(p) || inLighthouse(p) || inPostQuestCave(p) || inLighthouseTop(p) || inCourseStart(p) || inOutpost(p);

const messagesSince = (q: Quest, t0: number) => (q.sdk.getState()?.gameMessages ?? []).filter((m) => m.tick >= t0).map((m) => m.text);
const heard = (q: Quest, t0: number, re: RegExp) => messagesSince(q, t0).some((m) => re.test(m));

async function locById(q: Quest, id: number, at: Tile, within = 3) {
    await q.sdk.scanNearbyLocs(15).catch(() => undefined);
    const loc = (q.sdk.getNearbyLocs() ?? []).filter((l) => l.id === id).sort((a, b) => Math.hypot(a.x - at.x, a.z - at.z) - Math.hypot(b.x - at.x, b.z - at.z))[0];
    return loc && Math.hypot(loc.x - at.x, loc.z - at.z) <= within ? loc : undefined;
}

/** Op1 on a loc by id (blind when the scan does not show it) until `done`. */
async function opLoc(q: Quest, loc: { id: number; x: number; z: number }, done: () => boolean, label: string, choices: RegExp[] = [], tries = 4, ticks = 12): Promise<void> {
    for (let attempt = 1; attempt <= tries && !done(); attempt++) {
        const seen = await locById(q, loc.id, loc, 2);
        await q.sdk.sendInteractLoc(seen?.x ?? loc.x, seen?.z ?? loc.z, loc.id, 1);
        await untilTicks(q.sdk, (s) => done() || !!s.dialog?.isOpen, ticks);
        if (q.sdk.getDialog()?.isOpen) await driveDialog(q.sdk, choices, { done, ticks: 20 });
        await untilTicks(q.sdk, done, 3);
    }
    if (!done()) throw new Error(`horror: ${label} failed at ${where(q)}`);
}

const FOOD = /^(shark|manta ray|monkfish|swordfish|lobster|bass|tuna)$/i;
async function eatIfLow(q: Quest, below = 0.55): Promise<void> {
    const p = q.sdk.getState()?.player;
    if (!p || p.hp > (p.maxHp ?? 10) * below) return;
    const food = q.sdk.getInventory().find((i) => FOOD.test(i.name));
    if (food) await q.bot.eatFood(food).catch(() => undefined);
}

// ── getting about

/** The basalt causeway, north or south: op the next spot not yet passed; a slip sends us back to redo. */
async function basalt(q: Quest, north: boolean): Promise<void> {
    const spots = north ? SPOTS_N : SPOTS_S;
    const past = (s: Spot) => (north ? pos(q).z >= s.land.z : pos(q).z <= s.land.z);
    // Across already (the bridge, once a half is planked, can let a walk round by Rellekka onto the causeway).
    const across = () => (north ? onLighthouseSide(pos(q)) && !inBox(pos(q), 2514, 2524, 3595, 3619) : !onLighthouseSide(pos(q)));
    if (across()) return;
    if (north && pos(q).z < BASALT_SHORE.z) await q.goTo(BASALT_SHORE, 1);
    if (across()) return;
    const t0 = tickNow(q.sdk);
    while (spots.some((s) => !past(s)) && !across() && tickNow(q.sdk) - t0 < 500) {
        await eatIfLow(q);
        const next = spots.find((s) => !past(s))!;
        const before = pos(q);
        await q.sdk.sendInteractLoc(next.x, next.z, next.id, 1);
        await untilTicks(q.sdk, () => past(next) || heard(q, t0, /tide sweeps you back/) && (pos(q).x !== before.x || pos(q).z !== before.z), 15);
        await q.sdk.waitForTicks(1);
        // A slip lands us back on the shore side: walk back to the causeway's start before the next op.
        if (north && pos(q).z < SPOTS_N[0]!.z - 1 && Math.hypot(pos(q).x - BASALT_SHORE.x, pos(q).z - BASALT_SHORE.z) > 2) await q.bot.walkTo(BASALT_SHORE.x, BASALT_SHORE.z, 1).catch(() => undefined);
    }
    if (!across() && spots.some((s) => !past(s))) throw new Error(`horror: basalt rocks ${north ? 'north' : 'south'} failed at ${where(q)}`);
}

/** Through the outpost gate (Barcrawl) inward or outward. */
async function outpostGate(q: Quest, inward: boolean): Promise<void> {
    const done = () => (inward ? pos(q).x > OUTPOST_GATE.x : pos(q).x <= OUTPOST_GATE.x);
    if (done()) return;
    if (inward) await q.goTo({ x: OUTPOST_GATE.x - 1, z: OUTPOST_GATE.z }, 1);
    else await q.bot.walkTo(OUTPOST_GATE.x + 1, OUTPOST_GATE.z, 1).catch(() => undefined);
    for (let attempt = 1; attempt <= 4 && !done(); attempt++) {
        await q.sdk.sendInteractLoc(OUTPOST_GATE.x, OUTPOST_GATE.z, OUTPOST_GATE.id, 1);
        await untilTicks(q.sdk, (s) => done() || !!s.dialog?.isOpen, 10);
        if (q.sdk.getDialog()?.isOpen) {
            const text = await driveDialog(q.sdk, [], { ticks: 20 });
            if (/barbarians only|barcrawl/i.test(text)) throw new Error("horror: the Barbarian Outpost's gate wants Alfred Grimhand's Barcrawl done");
        }
        if (!done()) await q.sdk.waitForTicks(3);
    }
    if (!done()) throw new Error(`horror: not through the outpost gate (at ${where(q)})`);
}

/** Camelot Teleport (Magic 45, 1 law + 5 air); true once it lands. */
async function camelot(q: Quest): Promise<boolean> {
    if ((q.sdk.getSkill('magic')?.level ?? 0) < 45 || q.count('law rune') < 1 || q.count('air rune') < 5) return false;
    const from = pos(q);
    for (let attempt = 1; attempt <= 3; attempt++) {
        await q.sdk.sendSetTab(6).catch(() => undefined);
        await q.sdk.waitForTicks(1);
        await q.sdk.sendClickComponent(CAMELOT_TELEPORT);
        if (await untilTicks(q.sdk, () => Math.hypot(pos(q).x - from.x, pos(q).z - from.z) > 30 || pos(q).level !== from.level, 8)) {
            q.log(`horror: Camelot Teleport to ${where(q)}`);
            return true;
        }
    }
    return false;
}

/** run-quest's goTo/prologue: out of the lighthouse, its caves, the causeway and the outpost's course. */
export async function leaveHorror(q: Quest): Promise<void> {
    if (q.sdk.getDialog()?.isOpen) await driveDialog(q.sdk, [], { ticks: 10 });
    for (const p of ['protect_from_missiles', 'protect_from_melee'] as const) if (q.sdk.isPrayerActive(p)) await q.bot.deactivatePrayer(p).catch(() => undefined);
    if (inLighthouse(pos(q)) || inPostQuestCave(pos(q)) || inLighthouseTop(pos(q))) {
        if (!(await camelot(q))) throw new Error(`horror: in the lighthouse at ${where(q)} with no Camelot Teleport runes (1 law, 5 air)`);
    }
    if (onLighthouseSide(pos(q)) && !(await camelot(q))) await basalt(q, false);
    if (inCourseStart(pos(q))) await opLoc(q, PIPE, () => !inCourseStart(pos(q)), 'the pipe back into the outpost', [], 4, 20);
    if (inOutpost(pos(q))) await outpostGate(q, false);
}

// ── the quest

/** Over the basalt rocks to Larrissa: the quest (1). */
export async function start(q: Quest): Promise<void> {
    await basalt(q, true);
    await q.talk(/^larrissa$/i, [/^with what\?/i, /^but how can i help\?/i, /^okay, i'll help!?/i, /^i'll see what i can do/i], LARRISSA);
}

/** Back over the rocks, through the outpost and its pipe to Gunnjorn: the lighthouse key. */
export async function getKey(q: Quest): Promise<void> {
    if (holds(q, OBJ.key)) return;
    if (onLighthouseSide(pos(q))) await basalt(q, false);
    await outpostGate(q, true);
    if (!inCourseStart(pos(q))) {
        await q.bot.walkTo(PIPE.x, PIPE.z + 2, 0).catch(() => undefined);
        await opLoc(q, PIPE, () => inCourseStart(pos(q)), 'through the obstacle pipe (Agility 35)', [], 4, 20);
    }
    await q.talk(/^gunnjorn$/i, []);
    if (!holds(q, OBJ.key)) throw new Error('horror: Gunnjorn gave no key');
    await opLoc(q, PIPE, () => !inCourseStart(pos(q)), 'the pipe back into the outpost', [], 4, 20);
    await outpostGate(q, false);
}

/** A plank on each half of the broken bridge (4 nails each, a hammer). */
export async function bridge(q: Quest, fixed: () => Promise<boolean>): Promise<void> {
    if (await fixed()) return;
    await basalt(q, true);
    await q.goTo({ x: BRIDGE_L.x - 1, z: BRIDGE_L.z }, 1);
    // The bridge's replies are mesboxes (dialog pages), not game messages: judge by the planks held.
    const use = async (spot: typeof BRIDGE_L, label: string) => {
        const planks = () => q.count(/^plank$/i);
        const before = planks();
        let seen = '';
        const done = () => planks() < before || /already fixed this half/i.test(seen);
        for (let attempt = 1; attempt <= 3 && !done(); attempt++) {
            const plank = q.sdk.getInventory().find((i) => /^plank$/i.test(i.name));
            if (!plank) throw new Error(`horror: no plank for the ${label} half of the bridge`);
            await q.sdk.sendUseItemOnLoc(plank.slot, spot.x, spot.z, spot.id);
            await untilTicks(q.sdk, (s) => done() || !!s.dialog?.isOpen, 10);
            if (q.sdk.getDialog()?.isOpen) seen += await driveDialog(q.sdk, [], { ticks: 8 });
        }
        if (!done()) throw new Error(`horror: the ${label} half of the bridge would not take the plank (${seen.slice(0, 120)})`);
    };
    await use(BRIDGE_L, 'west');
    // Over the gap to the east half.
    await opLoc(q, BRIDGE_L, () => pos(q).x >= BRIDGE_R.x, 'over the gap', [], 4, 10);
    await use(BRIDGE_R, 'east');
    await opLoc(q, BRIDGE_R, () => pos(q).x <= BRIDGE_L.x - 1, 'back over the bridge', [], 4, 10);
}

/** The key in the lighthouse door, then in (2). */
export async function enterLighthouse(q: Quest): Promise<void> {
    if (inLighthouse(pos(q))) return;
    await basalt(q, true);
    await q.goTo({ x: DOOR.x, z: DOOR.z - 1 }, 1);
    await opLoc(q, DOOR, () => inLighthouse(pos(q)), 'into the lighthouse', [], 5, 8);
}

/** Up the copy's stairs; tar, tinderbox and glass on the broken cog (4). */
export async function fixLight(q: Quest): Promise<void> {
    await enterLighthouse(q);
    for (let i = 0; i < 4 && pos(q).level < 2 && inLighthouse(pos(q)); i++) {
        await q.sdk.scanNearbyLocs(8).catch(() => undefined);
        const stairs = (q.sdk.getNearbyLocs() ?? []).filter((l) => /staircase/i.test(l.name)).sort((a, b) => (a.distance ?? 9) - (b.distance ?? 9))[0];
        if (!stairs) throw new Error(`horror: no lighthouse stairs at ${where(q)}`);
        const up = stairs.optionsWithIndex.find((o) => /climb-up|climb up/i.test(o.text)) ?? stairs.optionsWithIndex[0];
        const lvl = pos(q).level;
        await q.sdk.sendInteractLoc(stairs.x, stairs.z, stairs.id, up?.opIndex ?? 1);
        await untilTicks(q.sdk, (s) => (s.player?.level ?? lvl) !== lvl || !!s.dialog?.isOpen, 10);
        if (q.sdk.getDialog()?.isOpen) await driveDialog(q.sdk, [/^climb up/i], { ticks: 8 });
        await untilTicks(q.sdk, (s) => (s.player?.level ?? lvl) !== lvl, 5);
    }
    if (pos(q).level !== 2) throw new Error(`horror: not at the top of the lighthouse (${where(q)})`);
    const repaired = () => !inLighthouse(pos(q));
    // Each item's own reply: a late reply to the last item must not count for the next (the tinderbox needs the tar first).
    const steps: Array<[RegExp, RegExp]> = [
        [/^swamp tar$/i, /swamp tar to make|already put tar/i],
        [/^tinderbox$/i, /light the torch|already lit|not seem to be flammable/i],
        [/^molten glass$/i, /repair the lens|already repaired/i],
    ];
    for (let round = 1; round <= 2 && !repaired(); round++) {
        for (const [name, reply] of steps) {
            if (repaired()) break;
            const t0 = tickNow(q.sdk);
            for (let attempt = 1; attempt <= 3 && !repaired() && !heard(q, t0, reply); attempt++) {
                const item = q.sdk.getInventory().find((i) => name.test(i.name));
                if (!item) break;
                await q.sdk.sendUseItemOnLoc(item.slot, COG.x, COG.z, COG.id);
                await untilTicks(q.sdk, () => repaired() || heard(q, t0, reply), 10);
            }
            await q.sdk.waitForTicks(1);
        }
    }
    if (!(await untilTicks(q.sdk, repaired, 6))) {
        const missing = steps.map(([name]) => name).filter((name) => !q.sdk.getInventory().some((i) => name.test(i.name)));
        throw new Error(`horror: the lighthouse light is not repaired${missing.length ? ` (not held: ${missing.map(String).join(', ')})` : ''}`);
    }
}

/** Down to the cave, the strange wall, the far right door and the ladder to Jossik. */
export async function toJossik(q: Quest): Promise<void> {
    const atJossik = () => inLighthouse(pos(q)) && pos(q).level === 0 && pos(q).x > 2500;
    if (atJossik()) return;
    if (!inLighthouse(pos(q))) {
        if (inLighthouseTop(pos(q))) await opLoc(q, { id: 4570, x: 2506, z: 3641 }, () => inLighthouse(pos(q)), 'the lighthouse stairs down');
        else await enterLighthouse(q);
    }
    // In the copy: down to L0, then its ladder to the cave.
    for (let i = 0; i < 3 && inLighthouse(pos(q)) && pos(q).x < 2500 && pos(q).level > 0; i++) {
        await q.sdk.scanNearbyLocs(8).catch(() => undefined);
        const stairs = (q.sdk.getNearbyLocs() ?? []).filter((l) => /staircase/i.test(l.name)).sort((a, b) => (a.distance ?? 9) - (b.distance ?? 9))[0];
        if (!stairs) break;
        const down = stairs.optionsWithIndex.find((o) => /climb-down|climb down/i.test(o.text)) ?? stairs.optionsWithIndex[0];
        const lvl = pos(q).level;
        await q.sdk.sendInteractLoc(stairs.x, stairs.z, stairs.id, down?.opIndex ?? 1);
        await untilTicks(q.sdk, (s) => (s.player?.level ?? lvl) !== lvl || !!s.dialog?.isOpen, 10);
        if (q.sdk.getDialog()?.isOpen) await driveDialog(q.sdk, [/^climb down/i], { ticks: 8 });
        await untilTicks(q.sdk, (s) => (s.player?.level ?? lvl) !== lvl, 5);
    }
    if (pos(q).x < 2500) await opLoc(q, { id: 4383, x: 2445, z: 4604 }, () => pos(q).x > 2500, 'the ladder down to the cave');
    if (pos(q).level === 1 && pos(q).z < MID_DOOR.z) {
        await q.bot.walkTo(MID_DOOR.x, MID_DOOR.z - 1, 0).catch(() => undefined);
        await strangeWall(q);
        await q.bot.walkTo(FAR_RIGHT_DOOR.x, FAR_RIGHT_DOOR.z - 1, 0).catch(() => undefined);
        await opLoc(q, FAR_RIGHT_DOOR, () => pos(q).z >= FAR_RIGHT_DOOR.z, 'through the far right door');
    }
    if (pos(q).level === 1) await opLoc(q, JOSSIK_LADDER, () => pos(q).level === 0, 'the ladder down to Jossik');
    if (!atJossik()) throw new Error(`horror: not in Jossik's cave (${where(q)})`);
}

/** One each of fire/water/earth/air rune, a stab/slash weapon and an arrow into the mid door. */
async function strangeWall(q: Quest): Promise<void> {
    const parts: Array<[string, RegExp]> = [
        ['fire rune', /^fire rune$/i],
        ['water rune', /^water rune$/i],
        ['earth rune', /^earth rune$/i],
        ['air rune', /^air rune$/i],
        ['weapon', /^bronze dagger$/i],
        ['arrow', /^bronze arrow$/i],
    ];
    for (const [label, re] of parts) {
        const t0 = tickNow(q.sdk);
        const placed = () => heard(q, t0, /you place an? .* into the slot|there is no space to put/i);
        for (let attempt = 1; attempt <= 3 && !placed(); attempt++) {
            const item = q.sdk.getInventory().find((i) => re.test(i.name));
            if (!item) throw new Error(`horror: no ${label} for the strange wall`);
            await q.sdk.sendUseItemOnLoc(item.slot, MID_DOOR.x, MID_DOOR.z, MID_DOOR.id);
            await untilTicks(q.sdk, (s) => placed() || !!s.dialog?.isOpen, 10);
            if (q.sdk.getDialog()?.isOpen) await driveDialog(q.sdk, [/^yes$/i], { done: placed, ticks: 15 });
            await untilTicks(q.sdk, placed, 4);
        }
        if (!placed()) throw new Error(`horror: the strange wall would not take the ${label}`);
    }
}

/** Protect from Missiles while it has points (the Dagannoth and the mother's ranged volleys). */
async function prayMissiles(q: Quest): Promise<void> {
    const pr = q.sdk.getPrayerState();
    if (!pr || pr.prayerLevel < 40 || pr.prayerPoints <= 0) return;
    if (!q.sdk.isPrayerActive('protect_from_missiles')) await q.bot.activatePrayer('protect_from_missiles').catch(() => undefined);
}

async function topUpPrayer(q: Quest): Promise<void> {
    if ((q.sdk.getSkill('prayer')?.level ?? 99) >= 15) return;
    const pot = q.sdk.getInventory().find((i) => /^prayer potion\(\d\)$/i.test(i.name));
    if (pot) await q.sdk.sendUseItem(pot.slot, 1).catch(() => undefined);
}

const npcOf = (q: Quest, ids: number[]) => (q.sdk.getNearbyNpcs() ?? []).filter((n) => ids.includes(n.id)).sort((a, b) => a.distance - b.distance)[0];
const motherIds = Object.keys(MOTHER).map(Number);

/** Jossik spawns the Dagannoth: kill it in melee under Protect from Missiles (5). */
export async function killDagannoth(q: Quest, done: () => Promise<boolean>): Promise<void> {
    await toJossik(q);
    const weapon = q.sdk.getInventory().find((i) => /scimitar|longsword|sword|whip|battleaxe|mace/i.test(i.name) && !/bronze dagger/i.test(i.name));
    if (weapon) await q.bot.equipItem(weapon).catch(() => undefined);
    // The Dagannoth's first volleys land while Jossik is still talking (staging: 99 -> 52 hp before the fight loop):
    // prayer up and fed before the talk.
    await prayMissiles(q);
    for (let i = 0; i < 4; i++) await eatIfLow(q, 0.8);
    if (!npcOf(q, [NPC.jr])) {
        await q.talk(/^jossik$/i, []);
        await untilTicks(q.sdk, () => !!npcOf(q, [NPC.jr, ...motherIds]), 10);
    }
    const t0 = tickNow(q.sdk);
    let last = -99;
    let lastLog = -99;
    while (npcOf(q, [NPC.jr]) && tickNow(q.sdk) - t0 < 600) {
        await eatIfLow(q);
        await prayMissiles(q);
        if (tickNow(q.sdk) - lastLog >= 10) {
            lastLog = tickNow(q.sdk);
            const me = q.sdk.getState()?.player;
            q.log(`horror: jr fight hp ${me?.hp}/${me?.maxHp} missiles ${q.sdk.isPrayerActive('protect_from_missiles')} prayer ${q.sdk.getSkill('prayer')?.level} near ${(q.sdk.getNearbyNpcs() ?? []).filter((n) => n.distance < 8).map((n) => `${n.name}#${n.id}`).join(',')}`);
        }
        if (q.sdk.getDialog()?.isOpen) await driveDialog(q.sdk, [], { ticks: 4 });
        const jr = npcOf(q, [NPC.jr]);
        if (jr && tickNow(q.sdk) - last >= 6) {
            await q.sdk.sendInteractNpc(jr.index, 2);
            last = tickNow(q.sdk);
        }
        await q.sdk.waitForTicks(1);
    }
    // Its death queues a chatplayer and Jossik's three lines: let them all play out, or the journal read meets an open
    // chat box and comes back UNKNOWN.
    for (let quiet = 0, i = 0; quiet < 3 && i < 30; i++) {
        if (q.sdk.getDialog()?.isOpen) {
            quiet = 0;
            await driveDialog(q.sdk, [], { ticks: 10 });
        } else quiet++;
        await q.sdk.waitForTicks(1);
    }
    for (let i = 0; i < 4 && !(await done()); i++) await q.sdk.waitForTicks(3);
    q.log(`horror: the Dagannoth in ${tickNow(q.sdk) - t0}t`);
}

/** Jossik again: the mother. Each form takes only its own style (ranged form waited out). */
export async function killMother(q: Quest, done: () => boolean): Promise<void> {
    await toJossik(q);
    const weapon = q.sdk.getInventory().find((i) => /scimitar|longsword|sword|whip|battleaxe|mace/i.test(i.name) && !/bronze dagger/i.test(i.name));
    if (weapon) await q.bot.equipItem(weapon).catch(() => undefined);
    await prayMissiles(q);
    for (let i = 0; i < 4; i++) await eatIfLow(q, 0.8);
    if (!npcOf(q, motherIds)) {
        await q.talk(/^jossik$/i, []);
        await untilTicks(q.sdk, () => !!npcOf(q, motherIds), 10);
    }
    if (!npcOf(q, motherIds)) throw new Error('horror: the Dagannoth mother never appeared');
    const t0 = tickNow(q.sdk);
    let lastForm = '';
    let lastSend = -99;
    let magicXp = q.sdk.getSkill('magic')?.experience ?? 0;
    while (!done() && tickNow(q.sdk) - t0 < 1200) {
        await eatIfLow(q);
        await topUpPrayer(q);
        await prayMissiles(q);
        if (q.sdk.getDialog()?.isOpen) await driveDialog(q.sdk, [], { ticks: 4 });
        const m = npcOf(q, motherIds);
        if (!m) {
            await q.sdk.waitForTicks(2);
            continue;
        }
        const form = MOTHER[m.id]!;
        const xp = q.sdk.getSkill('magic')?.experience ?? 0;
        const castLanded = xp !== magicXp;
        const due = form !== lastForm || (form === 'melee' ? tickNow(q.sdk) - lastSend >= 5 : castLanded || tickNow(q.sdk) - lastSend >= 6);
        if (due && form !== 'spawn' && form !== 'ranged') {
            if (form === 'melee') await q.sdk.sendInteractNpc(m.index, 2);
            else await q.sdk.sendSpellOnNpc(m.index, BLAST[form]);
            lastSend = tickNow(q.sdk);
            magicXp = xp;
            if (form !== lastForm) q.log(`horror: mother -> ${form} (my hp ${q.sdk.getState()?.player?.hp})`);
        }
        lastForm = form;
        await q.sdk.waitForTicks(1);
    }
    if (q.sdk.isPrayerActive('protect_from_missiles')) await q.bot.deactivatePrayer('protect_from_missiles').catch(() => undefined);
    if (!done()) throw new Error(`horror: the mother did not die in ${tickNow(q.sdk) - t0}t`);
    q.log(`horror: the mother in ${tickNow(q.sdk) - t0}t`);
    // The post-quest dialogue, then out of the post-quest cave (its L1 has no stairs run-quest's climbTo can use).
    for (let quiet = 0, i = 0; quiet < 3 && i < 30; i++) {
        if (q.sdk.getDialog()?.isOpen) {
            quiet = 0;
            await driveDialog(q.sdk, [], { ticks: 10 });
        } else quiet++;
        await q.sdk.waitForTicks(1);
    }
}
