/**
 * Watchtower — the Yanille Watchtower's wizard, the Feldip ogres, Gu'Tanoth, the skavid caves and the
 * ogre shamans' enclave.
 *
 * Content facts (quest_itwatchtower/scripts/*.rs2; placements m38/39/40_46..48, m39/40_147):
 *   - Wizard on the tower's top floor (2549,3112,L2): ground ladder (2544,3111, a guard's line, then
 *     L1), L1 ladder (2549,3111) up. Lever (2543,3115,L2). Lit candle spawn (2547,3114) in the tower.
 *   - Fingernails in the bush at (2544,3134), searched from stage 1; the wizard takes them (1 -> 2).
 *   - Og (2506,3116): "I seek entrance…" -> Toban key. Grew (2513,3084) on the river island west of
 *     Yanille (rope on the tree at 2499,3087 to swing on; out by the rope swing 2511,3090 -> 2511,3096):
 *     "Don't eat me…", then again with Gorad's tooth -> relic part 2 + crystal 1. Toban (2576,3027)
 *     and Gorad (2577,3021, level 68) on the plateau reached by the cave at (2499,2989) (in at 2576,3029;
 *     out by the ladder 2575,3029 -> 2500,2988): Toban wants dragon bones (part 3); Gorad's death gives
 *     the tooth (queue, < stage 4); the chest (2575,3031) + key -> stolen gold, to Og (part 1).
 *   - The three parts used on the wizard -> ogre relic (-> 3). The west gate's guard (2505,3062): talk
 *     (sets "looking for relic", pushes you down the hill), then the relic on him (-> 4, inside).
 *   - City guard (2541,3031): "I seek passage into the skavid caves." (-> 5), a death rune on him ->
 *     skavid map (-> 6).
 *   - Skavid caves (map + a lit light source): cave entrances in the city, each to its own chamber at
 *     z 9405-9475. Scared skavid (cave 5) teaches the words; four talkers want Ig (cave 2), Ar (cave 3),
 *     Cur (cave 4), Nod (cave 1); the mad skavid (cave 6, past the chasm jump 2531,3029) answers
 *     Ar cur -> Gor, Bidith ig -> Cur, Cur tanath -> Bidith, Gor nod -> Tanath (crystal 2, -> 7).
 *     Nightshade spawns in caves 2 (2530,9462) and 6 (2528,9415); cave 6 has the hole to Yanille.
 *   - Nightshade on the enclave guard (2507,3036) -> the shaman cave at (2588,9410) (-> 8). Out by its
 *     cave (2598,9468) -> (2540,3054). Bats in the cave drop bat bones.
 *   - Wizard (-> 9). Guam + vial of water, + jangerberries (island spawns), + ground bat bones -> ogre
 *     potion; on the wizard -> magic ogre potion (-> 10). Second nightshade into the cave, the potion on
 *     six shamans (the sixth gives crystal 3), mine the Rock of Dalgroth (2590,9449; Mining 40) for
 *     crystal 4. Wizard with all four (-> 11), the lever (complete).
 */
import type { Quest } from './run-quest';
import { driveDialog } from './dialog';
import { tickNow, untilTicks } from './ticks';

interface Tile {
    x: number;
    z: number;
    level?: number;
}

export const OBJ = {
    litCandle: 33,
    guamvial: 91,
    vialWater: 227,
    pestle: 233,
    jangerberries: 247,
    guam: 249,
    batBones: 530,
    dragonBones: 536,
    deathRune: 560,
    rope: 954,
    relic: 2372,
    part1: 2373,
    part2: 2374,
    part3: 2375,
    map: 2376,
    tooth: 2377,
    key: 2378,
    crystal1: 2380,
    crystal2: 2381,
    crystal3: 2382,
    crystal4: 2383,
    fingernails: 2384,
    guamjanger: 2390,
    groundBones: 2391,
    gold: 2393,
    potion: 2394,
    magicPotion: 2395,
    scroll: 2396,
    robe: 2397,
    nightshade: 2398,
} as const;

export const WIZARD = { x: 2549, z: 3113, level: 2 };
const TOWER_LADDER = { x: 2544, z: 3111 };
const CLIMB_ROCKS = { x: 2548, z: 3119 };
const TOWER_LADDER_L1 = { x: 2549, z: 3111, level: 1 };
const LEVER = { x: 2543, z: 3115, level: 2 };
const CANDLE_SPAWN = { x: 2547, z: 3114 };
const NAIL_BUSH = { x: 2544, z: 3134 };
export const OG = { x: 2506, z: 3116 };
const ROPE_TREE = { x: 2499, z: 3087 };
const ROPE_TREE_STAND = { x: 2501, z: 3087 };
const SWING_OUT = { x: 2511, z: 3090 };
const SWING_OUT_STAND = { x: 2511, z: 3091 };
const GREW = { x: 2513, z: 3084 };
const JANGER_SPAWNS: Tile[] = [
    { x: 2510, z: 3090 },
    { x: 2512, z: 3080 },
    { x: 2516, z: 3086 },
    { x: 2517, z: 3082 },
];
const TOBAN_CAVE = { x: 2499, z: 2989 };
const TOBAN = { x: 2576, z: 3027 };
const GORAD = { x: 2577, z: 3021 };
const TOBAN_CHEST = { x: 2575, z: 3031 };
const TOBAN_LADDER = { x: 2575, z: 3029 };
const WEST_GATE_OUT = { x: 2509, z: 3062 };
const CITY_GUARD = { x: 2541, z: 3031 };
const ENCLAVE_GUARD = { x: 2507, z: 3037 };
const CHASM_JUMP = { x: 2531, z: 3029 };
const SHAMAN_EXIT = { x: 2598, z: 9468 };
const DALGROTH = { x: 2590, z: 9449 };
const SHAMAN_BATS = { x: 2614, z: 9421 };

/** Skavid cave entrances (city side) and the npc each chamber holds. */
const CAVES = {
    scared: { cave: { x: 2553, z: 3033 }, npc: /^skavid$/i, at: { x: 2499, z: 9433 } },
    nod: { cave: { x: 2560, z: 3022 }, npc: /^skavid$/i, at: { x: 2503, z: 9415 }, word: /^nod\.?$/i },
    cur: { cave: { x: 2552, z: 3052 }, npc: /^skavid$/i, at: { x: 2500, z: 9451 }, word: /^cur\.?$/i },
    ar: { cave: { x: 2539, z: 3052 }, npc: /^skavid$/i, at: { x: 2515, z: 9452 }, word: /^ar\.?$/i },
    ig: { cave: { x: 2522, z: 3068 }, npc: /^skavid$/i, at: { x: 2530, z: 9465 }, word: /^ig\.?$/i, shade: { x: 2530, z: 9462 } },
    mad: { cave: { x: 2527, z: 3011 }, npc: /^mad skavid$/i, at: { x: 2523, z: 9411 }, shade: { x: 2528, z: 9415 } },
} as const;
const YANILLE_HOLE = { x: 2530, z: 9415 };

const pos = (q: Quest) => {
    const p = q.sdk.getState()?.player;
    return { x: p?.worldX ?? 0, z: p?.worldZ ?? 0, level: p?.level ?? 0 };
};
const where = (q: Quest) => `(${pos(q).x},${pos(q).z},L${pos(q).level})`;
const inBox = (p: Tile, x0: number, x1: number, z0: number, z1: number) => p.x >= x0 && p.x <= x1 && p.z >= z0 && p.z <= z1;
export const held = (q: Quest, id: number) => q.sdk.getInventory().some((i) => i.id === id);
const inv = (q: Quest, id: number) => q.sdk.getInventory().find((i) => i.id === id);
const near = (q: Quest, t: Tile, r: number) => Math.hypot(pos(q).x - t.x, pos(q).z - t.z) <= r;

/** The tower's upper floors. */
const inTower = (p: Tile) => (p.level ?? 0) > 0 && inBox(p, 2538, 2556, 3105, 3122);
/** Grew's river island. */
export const onGrewIsland = (p: Tile) => (p.level ?? 0) === 0 && inBox(p, 2503, 2522, 3076, 3093);
/** Toban's plateau, east of the city. */
export const onTobanPlateau = (p: Tile) => (p.level ?? 0) === 0 && inBox(p, 2565, 2592, 3012, 3040);
/** The skavid caves (each entrance its own chamber). */
export const inSkavidCaves = (p: Tile) => inBox(p, 2490, 2560, 9400, 9480);
/** The ogre shamans' enclave. */
export const inShamanCave = (p: Tile) => inBox(p, 2561, 2630, 9400, 9480);
/** Gu'Tanoth inside its walls (the hill north of the gates is outside). */
export const inGutanoth = (p: Tile) => (p.level ?? 0) === 0 && inBox(p, 2496, 2564, 3005, 3062) && !onTobanPlateau(p) && !(p.x >= 2504 && p.z >= 3055);
export const inWatchtowerArea = (p: Tile) => inTower(p) || onGrewIsland(p) || onTobanPlateau(p) || inSkavidCaves(p) || inShamanCave(p) || onGuardLedge(p) || inSouthCity(p);

function cursor(q: Quest): number {
    return Math.max(0, ...(q.sdk.getState()?.gameMessages ?? []).map((m) => m.observationId ?? m.tick));
}
function said(q: Quest, since: number, text: RegExp): boolean {
    return (q.sdk.getState()?.gameMessages ?? []).some((m) => (m.observationId ?? m.tick) > since && text.test(m.text));
}

async function locNear(q: Quest, at: Tile, name: RegExp, opt?: RegExp, within = 3) {
    await q.sdk.scanNearbyLocs(15).catch(() => undefined);
    const loc = (q.sdk.getNearbyLocs() ?? [])
        .filter((l) => name.test(l.name) && (!opt || l.optionsWithIndex.some((o) => opt.test(o.text))))
        .sort((a, b) => Math.hypot(a.x - at.x, a.z - at.z) - Math.hypot(b.x - at.x, b.z - at.z))[0];
    return loc && Math.hypot(loc.x - at.x, loc.z - at.z) <= within ? loc : undefined;
}

/** Op a loc near `at` until `done()`; drives any dialog it opens with `choices`. */
async function op(q: Quest, at: Tile, name: RegExp, opt: RegExp, done: () => boolean, label: string, choices: RegExp[] = [], ticks = 20): Promise<void> {
    for (let attempt = 1; attempt <= 4 && !done(); attempt++) {
        const loc = await locNear(q, at, name, opt);
        if (!loc) {
            q.log(`watchtower: ${label}: no ${name} with ${opt} near (${at.x},${at.z}) from ${where(q)}`);
            await q.sdk.waitForTicks(3);
            continue;
        }
        await q.sdk.sendInteractLoc(loc.x, loc.z, loc.id, loc.optionsWithIndex.find((o) => opt.test(o.text))!.opIndex);
        await untilTicks(q.sdk, (s) => done() || !!s.dialog?.isOpen, ticks);
        if (q.sdk.getDialog()?.isOpen) await driveDialog(q.sdk, choices, { done, ticks: 40, log: q.log });
        await untilTicks(q.sdk, done, 6);
    }
    if (!done()) throw new Error(`watchtower: ${label} failed at ${where(q)}`);
}

async function npcNear(q: Quest, name: RegExp, at: Tile) {
    await untilTicks(q.sdk, () => !!q.sdk.findNearbyNpc(name), 8);
    return (q.sdk.getNearbyNpcs() ?? [])
        .filter((n) => name.test(n.name))
        .sort((a, b) => Math.hypot(a.x - at.x, a.z - at.z) - Math.hypot(b.x - at.x, b.z - at.z))[0];
}

/** Use inventory item `id` on the npc nearest `at`, driving the dialog it opens; true once `done()`. */
async function useOnNpc(q: Quest, id: number, name: RegExp, at: Tile, done: () => boolean, label: string, choices: RegExp[] = []): Promise<void> {
    for (let attempt = 1; attempt <= 4 && !done(); attempt++) {
        const item = inv(q, id);
        if (!item) throw new Error(`watchtower: ${label}: no item ${id} held`);
        const npc = await npcNear(q, name, at);
        if (!npc) {
            q.log(`watchtower: ${label}: no ${name} near (${at.x},${at.z}) from ${where(q)}`);
            await q.sdk.waitForTicks(3);
            continue;
        }
        const r = await q.bot.useItemOnNpc(item, npc).catch((e) => ({ success: false, message: String(e) }));
        if (!r.success) q.log(`watchtower: ${label}: ${r.message}`);
        await untilTicks(q.sdk, (s) => done() || !!s.dialog?.isOpen, 12);
        if (q.sdk.getDialog()?.isOpen) await driveDialog(q.sdk, choices, { ticks: 60, log: q.log });
        await untilTicks(q.sdk, done, 6);
    }
    if (!done()) throw new Error(`watchtower: ${label} failed at ${where(q)}`);
}

async function pickSpawn(q: Quest, id: number, at: Tile, label: string, waitTicks = 30): Promise<boolean> {
    const before = q.sdk.getInventory().filter((i) => i.id === id).reduce((n, i) => n + i.count, 0);
    const t0 = tickNow(q.sdk);
    while (tickNow(q.sdk) - t0 < waitTicks) {
        await q.sdk.scanGroundItems(10).catch(() => undefined);
        const g = (q.sdk.getState()?.groundItems ?? []).filter((it) => it.id === id).sort((a, b) => Math.hypot(a.x - at.x, a.z - at.z) - Math.hypot(b.x - at.x, b.z - at.z))[0];
        if (!g) {
            await q.sdk.waitForTicks(4);
            continue;
        }
        await q.bot.pickupItem(g).catch(() => undefined);
        const got = await untilTicks(q.sdk, () => q.sdk.getInventory().filter((i) => i.id === id).reduce((n, i) => n + i.count, 0) > before, 10);
        if (got) {
            q.log(`watchtower: picked up ${label}`);
            return true;
        }
    }
    return false;
}

// ── The tower

async function upTower(q: Quest): Promise<void> {
    if (pos(q).level === 2 && inTower(pos(q))) return;
    if (pos(q).level === 0) {
        // The ground ladder's guard refuses until the quest is started: the climbing rocks
        // on the north wall (Agility 18) land on the first floor at any stage.
        await q.goTo({ x: CLIMB_ROCKS.x, z: CLIMB_ROCKS.z + 1 }, 1);
        await op(q, CLIMB_ROCKS, /climbing rocks/i, /climb/i, () => pos(q).level === 1, 'up the tower\'s climbing rocks').catch(async (e) => {
            q.log(`watchtower: ${(e as Error).message} — trying the ladder`);
            await q.goTo({ x: TOWER_LADDER.x, z: TOWER_LADDER.z + 1 }, 1);
            await op(q, TOWER_LADDER, /ladder/i, /climb-up/i, () => pos(q).level === 1, 'up the tower ladder');
        });
    }
    if (pos(q).level === 1) await op(q, TOWER_LADDER_L1, /ladder/i, /climb-up/i, () => pos(q).level === 2, 'up to the wizard');
}

export async function leaveTower(q: Quest): Promise<void> {
    if (pos(q).level === 2) await op(q, TOWER_LADDER_L1, /ladder/i, /climb-down/i, () => pos(q).level === 1, 'down from the wizard');
    if (pos(q).level === 1) await op(q, TOWER_LADDER, /ladder/i, /climb-down/i, () => pos(q).level === 0, 'down the tower');
}

/** Talk to the wizard (top floor), choosing `choices`. */
export async function wizard(q: Quest, choices: RegExp[] = []): Promise<string> {
    await upTower(q);
    return q.talk(/^watchtower wizard$/i, choices);
}

/** Use an item on the wizard (relic parts, the ogre potion, the crystals). */
async function useOnWizard(q: Quest, id: number, done: () => boolean, label: string): Promise<void> {
    await upTower(q);
    await useOnNpc(q, id, /^watchtower wizard$/i, WIZARD, done, label);
}

/** A light for the skavid caves: the candle on the tower's ground floor, else the candle source. */
export async function ensureLight(q: Quest): Promise<void> {
    if (held(q, OBJ.litCandle) || q.count(/^lit (candle|torch|black candle)$|^(bullseye )?lantern$/i) > 0) return;
    await leaveTower(q);
    await q.goTo(CANDLE_SPAWN, 3).catch(() => undefined);
    if (await pickSpawn(q, OBJ.litCandle, CANDLE_SPAWN, 'the tower\'s lit candle', 20)) return;
    await q.ensure('lit candle', 1);
}

// ── 0 -> 1 -> 2

export async function start(q: Quest): Promise<void> {
    await wizard(q, [/what'?s the matter/i, /so how come the spell doesn'?t work/i, /can i be of help/i]);
}

export async function fingernails(q: Quest): Promise<void> {
    if (!held(q, OBJ.fingernails)) {
        await leaveTower(q);
        await q.goTo({ x: NAIL_BUSH.x, z: NAIL_BUSH.z - 1 }, 2);
        await op(q, NAIL_BUSH, /^bush$/i, /search/i, () => held(q, OBJ.fingernails), 'the fingernail bush');
    }
    await wizard(q, [/what do you suggest i do/i, /so what do i do/i]);
}

// ── 2 -> 3: the three relic parts

async function ogKey(q: Quest): Promise<void> {
    if (held(q, OBJ.key) || held(q, OBJ.gold) || held(q, OBJ.part1)) return;
    await q.talk(/^og$/i, [/i seek entrance to the city of ogres/i, /i have lost the key/i, /i haven'?t got it yet/i], OG);
    if (!held(q, OBJ.key) && !held(q, OBJ.part1)) q.log('watchtower: Og gave no key (helped already?)');
}

async function upPlateau(q: Quest): Promise<void> {
    if (onTobanPlateau(pos(q))) return;
    await q.goTo({ x: TOBAN_CAVE.x, z: TOBAN_CAVE.z - 1 }, 2);
    await op(q, TOBAN_CAVE, /cave entrance/i, /enter/i, () => onTobanPlateau(pos(q)), 'into Toban\'s cave');
}

export async function leavePlateau(q: Quest): Promise<void> {
    if (!onTobanPlateau(pos(q))) return;
    await q.bot.walkTo(TOBAN_LADDER.x, TOBAN_LADDER.z - 1, 1).catch(() => undefined);
    await op(q, TOBAN_LADDER, /ladder/i, /climb-down/i, () => !onTobanPlateau(pos(q)), 'down Toban\'s ladder');
}

async function killGorad(q: Quest): Promise<void> {
    const t0 = tickNow(q.sdk);
    while (!held(q, OBJ.tooth) && tickNow(q.sdk) - t0 < 600) {
        const gorad = await npcNear(q, /^gorad$/i, GORAD);
        if (!gorad) {
            await q.bot.walkTo(GORAD.x, GORAD.z, 3).catch(() => undefined);
            await q.sdk.waitForTicks(5);
            continue;
        }
        await eatIfLow(q);
        const since = cursor(q);
        await q.bot.attack(gorad).catch(() => undefined);
        if (said(q, since, /don't need to fight him now|already got his tooth/i)) throw new Error('watchtower: Gorad cannot be fought yet (Grew not asked?)');
        await untilTicks(q.sdk, () => held(q, OBJ.tooth) || !q.sdk.findNearbyNpc(/^gorad$/i) || hp(q) < 40, 40);
        if (q.sdk.getDialog()?.isOpen) await driveDialog(q.sdk, [], { ticks: 10 });
    }
    if (!held(q, OBJ.tooth)) throw new Error(`watchtower: no tooth from Gorad (at ${where(q)})`);
    q.log(`watchtower: Gorad's tooth (${tickNow(q.sdk) - t0}t)`);
}

const hp = (q: Quest) => q.sdk.getSkill('hitpoints')?.level ?? 99;
async function eatIfLow(q: Quest, below = 50): Promise<void> {
    for (let i = 0; i < 3 && hp(q) < below; i++) {
        const food = q.sdk.getInventory().find((it) => /^(shark|lobster|swordfish|monkfish|trout|salmon|tuna|bass)$/i.test(it.name));
        if (!food) return;
        await q.bot.eatFood(food).catch(() => undefined);
        await q.sdk.waitForTicks(2);
    }
}

async function plateau(q: Quest): Promise<void> {
    const needToban = !held(q, OBJ.part3);
    const needTooth = !held(q, OBJ.tooth) && !held(q, OBJ.part2);
    const needGold = !held(q, OBJ.gold) && !held(q, OBJ.part1) && held(q, OBJ.key);
    if (!needToban && !needTooth && !needGold) return;
    await upPlateau(q);
    if (needToban) {
        // First visit: "I seek entrance…", "I could do something for you…"; with the bones the same talk hands them over.
        for (let i = 0; i < 2 && !held(q, OBJ.part3); i++) {
            await q.talk(/^toban$/i, [/i seek entrance to the city of ogres/i, /i could do something for you/i, /i can'?t find the relic part/i]);
        }
        if (!held(q, OBJ.part3)) throw new Error('watchtower: Toban gave no relic part for the dragon bones');
    }
    if (needGold) {
        await q.bot.walkTo(TOBAN_CHEST.x, TOBAN_CHEST.z + 1, 1).catch(() => undefined);
        await op(q, TOBAN_CHEST, /^chest$/i, /open/i, () => held(q, OBJ.gold), 'Toban\'s chest');
    }
    if (needTooth) await killGorad(q);
    await leavePlateau(q);
}

async function swingOntoIsland(q: Quest): Promise<void> {
    if (onGrewIsland(pos(q))) return;
    if (!held(q, OBJ.rope)) await q.ensure('rope', 1);
    await q.goTo(ROPE_TREE_STAND, 1);
    for (let attempt = 1; attempt <= 3 && !onGrewIsland(pos(q)); attempt++) {
        const tree = await locNear(q, ROPE_TREE, /tree|branch/i, undefined, 1);
        const rope = inv(q, OBJ.rope);
        if (!tree || !rope) throw new Error(`watchtower: no rope tree (${!!tree}) or rope (${!!rope}) at ${where(q)}`);
        await q.bot.useItemOnLoc(rope, tree).catch(() => undefined);
        await untilTicks(q.sdk, () => onGrewIsland(pos(q)), 15);
    }
    if (!onGrewIsland(pos(q))) throw new Error(`watchtower: the rope swing onto Grew's island failed at ${where(q)}`);
}

export async function leaveIsland(q: Quest): Promise<void> {
    if (!onGrewIsland(pos(q))) return;
    await q.bot.walkTo(SWING_OUT_STAND.x, SWING_OUT_STAND.z, 0).catch(() => undefined);
    await op(q, SWING_OUT, /ropeswing/i, /swing/i, () => !onGrewIsland(pos(q)), 'the rope swing off Grew\'s island');
}

async function grewIsland(q: Quest): Promise<void> {
    const needGrew = !held(q, OBJ.part2) || !held(q, OBJ.crystal1);
    const needBerries = q.count('jangerberries') < 1 && !held(q, OBJ.guamjanger) && !held(q, OBJ.potion) && !held(q, OBJ.magicPotion);
    if (!needGrew && !needBerries) return;
    await swingOntoIsland(q);
    // Grew must be asked before Gorad can be fought ("You don't need to fight him now."), so the
    // island is visited twice: once to ask (and pick jangerberries), once with the tooth.
    if (needGrew && !held(q, OBJ.tooth) && !held(q, OBJ.part2)) {
        await q.talk(/^grew$/i, [/don'?t eat me/i], GREW);
    } else if (needGrew) {
        for (let i = 0; i < 3 && !(held(q, OBJ.part2) && held(q, OBJ.crystal1)); i++) {
            await q.talk(/^grew$/i, [/don'?t eat me/i, ...(held(q, OBJ.part2) ? [] : [/i'?ve lost the relic part/i]), /i'?ve lost the crystal/i], GREW);
        }
        if (!held(q, OBJ.part2)) throw new Error('watchtower: Grew gave no relic part for the tooth');
    }
    if (needBerries) {
        for (const spot of JANGER_SPAWNS) {
            if (q.count('jangerberries') >= 1) break;
            await pickSpawn(q, OBJ.jangerberries, spot, 'jangerberries', 12);
        }
    }
    await leaveIsland(q);
}

export async function relicParts(q: Quest): Promise<void> {
    if (held(q, OBJ.relic)) return;
    await ogKey(q);
    if (!held(q, OBJ.tooth) && !held(q, OBJ.part2)) await grewIsland(q);
    await plateau(q);
    if (held(q, OBJ.gold)) await q.talk(/^og$/i, [/i have your gold/i], OG);
    if (!held(q, OBJ.part1)) throw new Error('watchtower: no relic part 1 from Og');
    await grewIsland(q);
    for (const part of [OBJ.part1, OBJ.part2, OBJ.part3]) {
        if (held(q, OBJ.relic)) break;
        if (!held(q, part)) continue;
        await useOnWizard(q, part, () => !held(q, part), `relic part ${part} on the wizard`);
    }
    await untilTicks(q.sdk, () => held(q, OBJ.relic), 10);
    if (!held(q, OBJ.relic)) {
        // Stage 3 with the relic lost: the wizard copies another.
        await wizard(q, [/i have lost the relic/i]);
    }
    if (!held(q, OBJ.relic)) throw new Error('watchtower: the wizard made no relic');
}

// ── 3 -> 4 -> 5 -> 6: the city

export async function relicToGuard(q: Quest, entered: () => Promise<boolean>): Promise<void> {
    await leaveTower(q);
    for (let attempt = 1; attempt <= 3; attempt++) {
        await q.goTo(WEST_GATE_OUT, 3);
        // The first talk sets "looking for a relic" and pushes you down the hill; the next takes the relic.
        await useOnNpc(q, OBJ.relic, /^ogre guard$/i, { x: 2505, z: 3062 }, () => !q.sdk.getDialog()?.isOpen && pos(q).x <= 2503 && pos(q).z < 3070, 'the relic on the gate guard');
        if (await entered()) return;
        q.log(`watchtower: gate guard pass ${attempt}: at ${where(q)}`);
        await q.talk(/^ogre guard$/i, [], { x: 2505, z: 3062 }).catch(() => '');
        if (await entered()) return;
    }
}

// Gu'Tanoth's three parts (offline pathing, ogre_trader.rs2, quest_itwatchtower.rs2):
//   west  — inside the west gate: the market (rock cake stall 2506,3023), the enclave guard, the
//           battlement's west side (2506,3011). walkTo reaches it through the west gate (stage >= 4).
//   south — past the battlement (2507,3011-3012; guard3 wants a rock cake once): the jump (2530,3026,
//           20 coins, Agility 25) north to the city guards, cave 6, the east gate's inside.
//   guards — the city guards' ledge (2541,3031); back south by the free jump (2531,3029).
const BATTLEMENT = { x: 2507, z: 3011 };
const CAKE_STALL = { x: 2506, z: 3023 };
const JUMP_NORTH = { x: 2530, z: 3026 };
export const onGuardLedge = (p: Tile) => (p.level ?? 0) === 0 && inBox(p, 2528, 2547, 3028, 3036);
/** Inside the east gate (guard1's gold bar): the bridge to cave 6, not joined to the south side. */
export const inEastCity = (p: Tile) => (p.level ?? 0) === 0 && (inBox(p, 2529, 2565, 3005, 3016) || inBox(p, 2541, 2565, 3005, 3027));
export const inSouthCity = (p: Tile) => (p.level ?? 0) === 0 && inBox(p, 2508, 2547, 3005, 3027) && !inEastCity(p);
const EAST_GATE = { x: 2550, z: 3030 };
const CAVE6_STAND = { x: 2529, z: 3013 };

/** Through the east gate: its guard wants a gold bar once ("Bring me a bar of pure gold"), then lets you by. */
async function intoEastCity(q: Quest): Promise<void> {
    if (inEastCity(pos(q))) return;
    await q.goTo(EAST_GATE, 2);
    for (let attempt = 1; attempt <= 3 && !inEastCity(pos(q)); attempt++) {
        if (!q.count('gold bar')) await q.ensure('gold bar', 1);
        await q.goTo(EAST_GATE, 2);
        const guard = await npcNear(q, /^ogre guard$/i, { x: 2550, z: 3030 });
        if (guard) {
            await q.bot.talkTo(guard).catch(() => undefined);
            await driveDialog(q.sdk, [], { ticks: 60, done: () => inEastCity(pos(q)), log: q.log });
        }
        await untilTicks(q.sdk, () => inEastCity(pos(q)), 6);
        if (!inEastCity(pos(q))) {
            // Gold already paid: the gate opens like any other.
            await op(q, { x: 2549, z: 3028 }, /city gate/i, /open/i, () => inEastCity(pos(q)), 'the east gate', [], 10).catch(() => undefined);
        }
    }
    if (!inEastCity(pos(q))) throw new Error(`watchtower: not through the east gate (at ${where(q)})`);
}

async function rockCake(q: Quest): Promise<void> {
    if (q.count(/^rock cake$/i)) return;
    await q.goTo({ x: CAKE_STALL.x, z: CAKE_STALL.z + 1 }, 1);
    const t0 = tickNow(q.sdk);
    while (tickNow(q.sdk) - t0 < 400 && !q.count(/^rock cake$/i)) {
        // The cake trader (spawn 2506,3020) catches a thief within 3 tiles and barely wanders
        // (qlqcwt1 waited him out and failed): kill him (level 70), then take a cake while he respawns.
        const trader = (q.sdk.getNearbyNpcs() ?? []).find((n) => /^ogre trader$/i.test(n.name) && Math.hypot(n.x - CAKE_STALL.x, n.z - CAKE_STALL.z) <= 5);
        if (trader) {
            await eatIfLow(q);
            await q.bot.attack(trader).catch(() => undefined);
            await untilTicks(q.sdk, () => !q.sdk.getNearbyNpcs().some((n) => n.index === trader.index), 60);
            await q.bot.walkTo(CAKE_STALL.x, CAKE_STALL.z + 1, 0).catch(() => undefined);
            continue;
        }
        const stall = await locNear(q, CAKE_STALL, /^counter$/i, /steal/i, 2);
        if (!stall) {
            await q.sdk.waitForTicks(4);
            continue;
        }
        await q.sdk.sendInteractLoc(stall.x, stall.z, stall.id, stall.optionsWithIndex.find((o) => /steal/i.test(o.text))!.opIndex);
        await untilTicks(q.sdk, (s) => !!q.count(/^rock cake$/i) || !!s.dialog?.isOpen, 8);
        if (q.sdk.getDialog()?.isOpen) await driveDialog(q.sdk, [], { ticks: 10 });
    }
    if (!q.count(/^rock cake$/i)) throw new Error(`watchtower: no rock cake from the stall (at ${where(q)})`);
}

/** West side -> south side over the battlement (a rock cake for guard3 the first time). */
async function intoSouth(q: Quest): Promise<void> {
    if (inSouthCity(pos(q))) return;
    if (onGuardLedge(pos(q))) {
        await q.bot.walkTo(CHASM_JUMP.x, CHASM_JUMP.z + 1, 1).catch(() => undefined);
        await op(q, CHASM_JUMP, /^rock$/i, /jump/i, () => inSouthCity(pos(q)), 'the jump back south', [], 15);
        return;
    }
    await q.goTo({ x: BATTLEMENT.x - 1, z: BATTLEMENT.z }, 1);
    const over = () => inSouthCity(pos(q));
    const climb = async () => {
        const wall = await locNear(q, BATTLEMENT, /battlement/i, /climb/i, 2);
        if (!wall) throw new Error(`watchtower: no battlement at ${where(q)}`);
        await q.sdk.sendInteractLoc(wall.x, wall.z, wall.id, wall.optionsWithIndex.find((o) => /climb/i.test(o.text))!.opIndex);
        await untilTicks(q.sdk, (s) => over() || !!s.dialog?.isOpen, 12);
        if (q.sdk.getDialog()?.isOpen) await driveDialog(q.sdk, [/but i am a friend to ogres/i], { ticks: 40, done: over });
        await untilTicks(q.sdk, over, 8);
    };
    await climb();
    for (let attempt = 1; attempt <= 3 && !over(); attempt++) {
        await rockCake(q);
        await q.goTo({ x: BATTLEMENT.x - 1, z: BATTLEMENT.z }, 1);
        const cake = q.sdk.getInventory().find((i) => /^rock cake$/i.test(i.name));
        const guard = await npcNear(q, /^ogre guard$/i, BATTLEMENT);
        if (cake && guard) {
            await q.bot.useItemOnNpc(cake, guard).catch(() => undefined);
            await untilTicks(q.sdk, (s) => over() || !!s.dialog?.isOpen, 10);
            if (q.sdk.getDialog()?.isOpen) await driveDialog(q.sdk, [], { ticks: 40, done: over });
            await untilTicks(q.sdk, over, 10);
        }
        if (!over()) await climb();
    }
    if (!over()) throw new Error(`watchtower: not over the battlement (at ${where(q)})`);
}

/** South side -> west side back over the battlement (free once guard3 has his cake). */
async function outOfSouth(q: Quest): Promise<void> {
    if (onGuardLedge(pos(q))) await intoSouth(q);
    if (!inSouthCity(pos(q))) return;
    await q.bot.walkTo(BATTLEMENT.x + 1, BATTLEMENT.z, 1).catch(() => undefined);
    await op(q, BATTLEMENT, /battlement/i, /climb/i, () => !inSouthCity(pos(q)), 'back over the battlement', [/but i am a friend to ogres/i], 15);
}

/** To the city guards' ledge: the battlement, then the paid jump. */
async function toGuardLedge(q: Quest): Promise<void> {
    if (onGuardLedge(pos(q))) return;
    await intoSouth(q);
    if (q.count('coins') < 20) await q.ensure('coins', 20);
    await q.bot.walkTo(JUMP_NORTH.x, JUMP_NORTH.z - 1, 1).catch(() => undefined);
    // The rock (tanothjump1, loc 2830) sits on the bridge plane: the client never lists it, but the
    // server takes the op from the ground (qlqcwt1 probe).
    for (let attempt = 1; attempt <= 3 && !onGuardLedge(pos(q)); attempt++) {
        await q.sdk.sendInteractLoc(JUMP_NORTH.x, JUMP_NORTH.z, 2830, 1);
        await untilTicks(q.sdk, (s) => onGuardLedge(pos(q)) || !!s.dialog?.isOpen, 12);
        if (q.sdk.getDialog()?.isOpen) await driveDialog(q.sdk, [/okay,? i'?ll pay it/i], { ticks: 40, log: q.log });
        await untilTicks(q.sdk, () => onGuardLedge(pos(q)), 6);
    }
    if (!onGuardLedge(pos(q))) throw new Error(`watchtower: the paid jump to the city guards failed at ${where(q)}`);
}

export async function cityGuardRiddle(q: Quest): Promise<void> {
    await toGuardLedge(q);
    await q.talk(/^city guard$/i, [/i seek passage into the skavid caves/i]);
}

export async function deathRuneToGuard(q: Quest): Promise<void> {
    if (!held(q, OBJ.deathRune)) await q.ensure('death rune', 1);
    await toGuardLedge(q);
    await useOnNpc(q, OBJ.deathRune, /^city guard$/i, CITY_GUARD, () => held(q, OBJ.map), 'the death rune on the city guard');
}

// ── 6 -> 7: the skavid caves

async function enterCave(q: Quest, cave: Tile): Promise<void> {
    if (inSkavidCaves(pos(q))) await leaveSkavidCaves(q);
    await q.goTo(cave, 4);
    await op(q, cave, /cave entrance/i, /enter/i, () => inSkavidCaves(pos(q)), `into the skavid cave at (${cave.x},${cave.z})`, [], 15);

}

export async function leaveSkavidCaves(q: Quest): Promise<void> {
    if (!inSkavidCaves(pos(q))) return;
    await q.sdk.scanNearbyLocs(20).catch(() => undefined);
    const exit = (q.sdk.getNearbyLocs() ?? [])
        .filter((l) => (/cave exit/i.test(l.name) && l.optionsWithIndex.some((o) => /leave/i.test(o.text))) || (/^hole$/i.test(l.name) && l.optionsWithIndex.some((o) => /climb/i.test(o.text))) || /climbing rope/i.test(l.name))
        .sort((a, b) => (a.distance ?? 99) - (b.distance ?? 99))[0];
    if (!exit) throw new Error(`watchtower: no way out of the skavid caves at ${where(q)}`);
    await op(q, exit, new RegExp(`^${exit.name}$`, 'i'), /leave|climb/i, () => !inSkavidCaves(pos(q)), 'out of the skavid caves', [], 20);
}

async function skavidTalk(q: Quest, npc: RegExp, at: Tile, choose: (text: string) => RegExp | null, done: () => boolean, label: string): Promise<void> {
    for (let attempt = 1; attempt <= 6 && !done(); attempt++) {
        const target = await npcNear(q, npc, at);
        if (!target) throw new Error(`watchtower: no ${label} near (${at.x},${at.z}) from ${where(q)}`);
        const since = cursor(q);
        const r = await q.bot.talkTo(target).catch((e) => ({ success: false, message: String(e) }));
        if (!r.success) q.log(`watchtower: ${label}: ${r.message}`);
        let text = '';
        const t0 = tickNow(q.sdk);
        while (tickNow(q.sdk) - t0 < 60) {
            if (!(await untilTicks(q.sdk, (s) => !!s.dialog?.isOpen, 8))) break;
            const d = q.sdk.getDialog()!;
            text += ' ' + (d.allComponents ?? []).map((c) => c.text).join(' ');
            const cont = d.options.find((o) => /click here to continue/i.test(o.text));
            if (cont) {
                // Wait for the page to move: a second "continue" on index 1 lands on the answer
                // page's first option ("Cur."), a wrong word for three of the four (qlqcwt4).
                const sig = JSON.stringify((d.allComponents ?? []).map((c) => c.text));
                await q.sdk.sendClickDialog(cont.index);
                await untilTicks(q.sdk, () => JSON.stringify((q.sdk.getDialog()?.allComponents ?? []).map((c) => c.text)) !== sig, 8);
                continue;
            }
            const want = choose(text);
            const pick = want && d.options.find((o) => want.test(o.text));
            if (!pick) {
                q.log(`watchtower: ${label}: no answer for "${text.slice(-80)}" in ${JSON.stringify(d.options.map((o) => o.text))}`);
                break;
            }
            await q.sdk.sendClickDialog(pick.index);
            await q.sdk.waitForTicks(2);
        }
        await untilTicks(q.sdk, () => done() || said(q, since, /understood you|already talked|wrong|upset/i), 6);
        if (said(q, since, /already talked to this skavid|understood you/i)) return;
    }
}

/** The scared skavid's lesson, the four words, the mad skavid's crystal; nightshade from caves 2 and 6. */
export async function skavidCaves(q: Quest, done: () => boolean): Promise<void> {
    if (!held(q, OBJ.map)) {
        // Lost: the city guard hands out a copy.
        await q.talk(/^city guard$/i, [/i have lost the map/i], CITY_GUARD);
        if (!held(q, OBJ.map)) throw new Error('watchtower: no skavid map');
    }
    await ensureLight(q);
    // From the guards' ledge back to the west side (the hill's caves are walked to from there).
    if (onGuardLedge(pos(q)) || inSouthCity(pos(q))) await outOfSouth(q);
    // Scared skavid: "Okay, okay, I'm not going to hurt you."
    await enterCave(q, CAVES.scared.cave);
    // Several chambers' skavids share the name and are in view: the one nearest its spot.
    {
        const scared = await npcNear(q, /^scared skavid$/i, CAVES.scared.at);
        if (!scared) throw new Error(`watchtower: no scared skavid at ${where(q)}`);
        await q.bot.talkTo(scared).catch(() => undefined);
        await driveDialog(q.sdk, [/okay,? okay,? i'?m not going to hurt you/i], { ticks: 120, log: q.log });
    }
    for (const key of ['nod', 'cur', 'ar', 'ig'] as const) {
        const c = CAVES[key];
        await enterCave(q, c.cave);
        await skavidTalk(q, c.npc, c.at, () => c.word, () => false, `the ${key} skavid`);
        if ('shade' in c && q.count('nightshade') < 2) await pickSpawn(q, OBJ.nightshade, c.shade, 'nightshade', 10);
    }
    await leaveSkavidCaves(q);
    // The mad skavid's cave opens past the east gate (a gold bar for its guard, once).
    await intoEastCity(q);
    await q.bot.walkTo(CAVE6_STAND.x, CAVE6_STAND.z, 1).catch(() => undefined);
    await op(q, CAVES.mad.cave, /cave entrance/i, /enter/i, () => inSkavidCaves(pos(q)), 'into the mad skavid\'s cave', [], 15);
    const answer = (t: string) =>
        /ar cur/i.test(t) ? /^gor\.?$/i : /bidith ig/i.test(t) ? /^cur\.?$/i : /cur tanath/i.test(t) ? /^bidith\.?$/i : /gor nod/i.test(t) ? /^tanath\.?$/i : null;
    await skavidTalk(q, CAVES.mad.npc, CAVES.mad.at, answer, () => held(q, OBJ.crystal2) || done(), 'the mad skavid');
    for (let i = 0; i < 6 && !held(q, OBJ.crystal2); i++) await skavidTalk(q, CAVES.mad.npc, CAVES.mad.at, answer, () => held(q, OBJ.crystal2), 'the mad skavid');
    if (q.count('nightshade') < 2) await pickSpawn(q, OBJ.nightshade, CAVES.mad.shade, 'nightshade', 10);
    // Out by the hole into Yanille.
    await q.bot.walkTo(YANILLE_HOLE.x, YANILLE_HOLE.z + 1, 1).catch(() => undefined);
    await op(q, YANILLE_HOLE, /^hole$/i, /climb/i, () => !inSkavidCaves(pos(q)), 'the hole to Yanille', [], 15);
    if (!held(q, OBJ.crystal2)) throw new Error('watchtower: the mad skavid gave no crystal');
}

// ── 7 -> 8 -> 9 -> 10: the shamans' enclave and the potion

async function intoEnclave(q: Quest): Promise<void> {
    if (inShamanCave(pos(q))) return;
    if (!held(q, OBJ.nightshade)) {
        await skavidNightshade(q);
    }
    await q.goTo(ENCLAVE_GUARD, 4);
    await useOnNpc(q, OBJ.nightshade, /^enclave guard$/i, ENCLAVE_GUARD, () => inShamanCave(pos(q)), 'nightshade on the enclave guard');
}

/** Another nightshade: cave 2's spawn (the map and a light needed). */
async function skavidNightshade(q: Quest): Promise<void> {
    await ensureLight(q);
    await enterCave(q, CAVES.ig.cave);
    await pickSpawn(q, OBJ.nightshade, CAVES.ig.shade, 'nightshade', 120);
    await leaveSkavidCaves(q);
    if (!held(q, OBJ.nightshade)) throw new Error('watchtower: no nightshade in cave 2');
}

export async function leaveEnclave(q: Quest): Promise<void> {
    if (!inShamanCave(pos(q))) return;
    await q.bot.walkTo(SHAMAN_EXIT.x, SHAMAN_EXIT.z - 1, 2).catch(() => undefined);
    await op(q, SHAMAN_EXIT, /cave entrance/i, /enter/i, () => !inShamanCave(pos(q)), 'out of the shamans\' cave', [], 20);
}

/** Bat bones from the enclave's bats (they always drop them). */
async function enclaveBatBones(q: Quest): Promise<void> {
    const t0 = tickNow(q.sdk);
    while (q.count('bat bones') < 1 && !held(q, OBJ.groundBones) && tickNow(q.sdk) - t0 < 400) {
        const bat = await npcNear(q, /^bat$/i, pos(q));
        if (!bat) {
            await q.bot.walkTo(SHAMAN_BATS.x, SHAMAN_BATS.z, 3).catch(() => undefined);
            await q.sdk.waitForTicks(4);
            continue;
        }
        await q.bot.attack(bat).catch(() => undefined);
        await untilTicks(q.sdk, () => !q.sdk.getNearbyNpcs().some((n) => n.index === bat.index), 30);
        await pickSpawn(q, OBJ.batBones, { x: bat.x, z: bat.z }, 'bat bones', 8);
    }
}

export async function enclaveFirst(q: Quest): Promise<void> {
    await intoEnclave(q);
    await enclaveBatBones(q).catch((e) => q.log(`watchtower: bat bones: ${(e as Error).message}`));
    await leaveEnclave(q);
}

export async function potionLesson(q: Quest): Promise<void> {
    await wizard(q);
}

async function useItemOnItem(q: Quest, a: number, b: number, made: number, label: string): Promise<void> {
    for (let attempt = 1; attempt <= 3 && !held(q, made); attempt++) {
        const x = inv(q, a);
        const y = inv(q, b);
        if (!x || !y) throw new Error(`watchtower: ${label}: missing ${!x ? a : b}`);
        await q.sdk.sendUseItemOnItem(x.slot, y.slot);
        await untilTicks(q.sdk, (s) => held(q, made) || !!s.dialog?.isOpen, 8);
        if (q.sdk.getDialog()?.isOpen) await driveDialog(q.sdk, [/./], { ticks: 15, done: () => held(q, made) });
        await untilTicks(q.sdk, () => held(q, made), 6);
    }
    if (!held(q, made)) throw new Error(`watchtower: ${label} made nothing`);
}

/** Guam into water, then jangerberries, then ground bat bones (any other order explodes). */
export async function brewPotion(q: Quest): Promise<void> {
    if (held(q, OBJ.potion) || held(q, OBJ.magicPotion)) return;
    if (!held(q, OBJ.groundBones)) {
        if (q.count('bat bones') < 1) await q.ensure('bat bones', 1);
        if (!held(q, OBJ.pestle)) await q.ensure('pestle and mortar', 1);
        await useItemOnItem(q, OBJ.pestle, OBJ.batBones, OBJ.groundBones, 'grinding the bat bones');
    }
    if (!held(q, OBJ.guamjanger)) {
        if (!held(q, OBJ.guamvial)) {
            if (q.count('guam leaf') < 1) await q.ensure('guam leaf', 1);
            if (q.count('vial of water') < 1) await q.ensure('vial of water', 1);
            await useItemOnItem(q, OBJ.guam, OBJ.vialWater, OBJ.guamvial, 'guam into water');
        }
        if (q.count('jangerberries') < 1) await grewIsland(q);
        await useItemOnItem(q, OBJ.jangerberries, OBJ.guamvial, OBJ.guamjanger, 'jangerberries into the guam');
    }
    await useItemOnItem(q, OBJ.groundBones, OBJ.guamjanger, OBJ.potion, 'bat bones into the potion');
}

export async function enchantPotion(q: Quest): Promise<void> {
    await brewPotion(q);
    if (held(q, OBJ.magicPotion)) return;
    await useOnWizard(q, OBJ.potion, () => held(q, OBJ.magicPotion), 'the ogre potion on the wizard');
}

/** Six shamans dissolved by the potion (the sixth drops crystal 3), then the Rock of Dalgroth (crystal 4). */
export async function shamans(q: Quest): Promise<void> {
    await intoEnclave(q);
    const t0 = tickNow(q.sdk);
    while (!held(q, OBJ.crystal3) && tickNow(q.sdk) - t0 < 1500) {
        if (!held(q, OBJ.magicPotion)) throw new Error('watchtower: the magic ogre potion is gone before the sixth shaman');
        await eatIfLow(q);
        const shaman = (q.sdk.getNearbyNpcs() ?? []).filter((n) => /^ogre shaman$/i.test(n.name)).sort((a, b) => (a.distance ?? 99) - (b.distance ?? 99))[0];
        if (!shaman) {
            // Spawns at (2577,9451) (2582,9437) (2592,9436) (2599,9461) (2606,9438) (2607,9451).
            const spots = [{ x: 2592, z: 9440 }, { x: 2580, z: 9444 }, { x: 2604, z: 9446 }, { x: 2599, z: 9458 }];
            await q.bot.walkTo(spots[Math.floor(Math.random() * spots.length)]!.x, spots[0]!.z, 3).catch(() => undefined);
            await q.sdk.waitForTicks(5);
            continue;
        }
        const since = cursor(q);
        await q.bot.useItemOnNpc(inv(q, OBJ.magicPotion)!, shaman).catch(() => undefined);
        await untilTicks(q.sdk, (s) => said(q, since, /dissolves/i) || !!s.dialog?.isOpen, 20);
        if (q.sdk.getDialog()?.isOpen) await driveDialog(q.sdk, [], { ticks: 10 });
    }
    if (!held(q, OBJ.crystal3)) throw new Error(`watchtower: no crystal from the shamans after ${tickNow(q.sdk) - t0}t`);
    q.log(`watchtower: six shamans gone (${tickNow(q.sdk) - t0}t)`);
    await mineDalgroth(q);
    await leaveEnclave(q);
}

async function mineDalgroth(q: Quest): Promise<void> {
    if (held(q, OBJ.crystal4)) return;
    await q.bot.walkTo(DALGROTH.x, DALGROTH.z - 1, 2).catch(() => undefined);
    await op(q, DALGROTH, /rock of dalgroth/i, /^mine$/i, () => held(q, OBJ.crystal4), 'mining the Rock of Dalgroth', [], 25);
}

// ── 10 -> 11 -> complete

export async function crystalsToWizard(q: Quest): Promise<void> {
    await wizard(q, [/i have found another crystal/i]);
}

export async function pullLever(q: Quest): Promise<void> {
    await upTower(q);
    await q.bot.walkTo(LEVER.x + 1, LEVER.z, 1).catch(() => undefined);
    const since = cursor(q);
    await op(q, LEVER, /^lever$/i, /pull/i, () => said(q, since, /forcefield activates|no effect/i), 'the shield lever', [], 15);
    await q.sdk.waitForTicks(6);
    if (q.sdk.getDialog()?.isOpen) await driveDialog(q.sdk, [], { ticks: 40 });
    const scroll = inv(q, OBJ.scroll);
    if (scroll) {
        // Read it: the Watchtower Teleport, and stage 14.
        await q.sdk.sendUseItem(scroll.slot).catch(() => undefined);
        await q.sdk.waitForTicks(3);
        if (q.sdk.getDialog()?.isOpen) await driveDialog(q.sdk, [], { ticks: 20 });
    }
}

// ── Getting out

export async function leaveWatchtowerArea(q: Quest, dest: Tile): Promise<void> {
    if (q.sdk.getDialog()?.isOpen) await driveDialog(q.sdk, [], { ticks: 15 });
    if (inSkavidCaves(pos(q)) && !inSkavidCaves(dest)) await leaveSkavidCaves(q);
    if (inShamanCave(pos(q)) && !inShamanCave(dest)) await leaveEnclave(q);
    if (onTobanPlateau(pos(q)) && !onTobanPlateau(dest)) await leavePlateau(q);
    if (onGrewIsland(pos(q)) && !onGrewIsland(dest)) await leaveIsland(q);
    if (inTower(pos(q)) && !inTower(dest)) await leaveTower(q);
    // The guards' ledge and the south side: the free jump south, then back over the battlement;
    // walkTo then leaves by the west gate.
    if ((onGuardLedge(pos(q)) && !onGuardLedge(dest)) || (inSouthCity(pos(q)) && !inSouthCity(dest))) await outOfSouth(q);
}
