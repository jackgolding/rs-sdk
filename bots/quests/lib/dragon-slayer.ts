/**
 * Dragon Slayer — the map pieces, the ship, Crandor and Elvarg.
 *
 * Content: quest_dragon/scripts/*.rs2, and oziach.rs2, guild_master, duke_horacio.rs2,
 * klarense, ned.rs2, oracle in the area scripts. Map facts from the .jm2 maps; the
 * maze route was checked offline against the collision map:
 *   - Melzar's Maze: the Maze key (Oziach) on the east door (2941,3248); the giant
 *     rat's key opens red door (2926,3253) to the ladder (2928,3256) up; the ghost's
 *     key opens orange door (2931,3253) to the ladder (2934,3254) up; the
 *     skeleton's key opens yellow door (2924,3249), then down at (2940,3240) and
 *     (2937,3240) to the ground floor and down again at (2932,3240) into the
 *     basement; the zombie's key opens blue (2931,9643), Melzar's magenta
 *     (2929,9652), the lesser demon's green (2936,9655); the chest (2935,9657)
 *     holds mappart1. Every key disintegrates in its door, so a retry kills again.
 *   - the Oracle (3015,3504) names the four items; Ice Mountain's trapdoor
 *     (3019,3450) leads to the magic door (3051,9840), which takes them from the
 *     west once, and the chest behind it (3057,9841) holds mappart3
 *   - Wormbrain, in Port Sarim's jail, sells mappart2 through the bars for 10,000
 *   - Klarense (3047,3204) sells the Lady Lumbridge for 2000; three planks (4 nails
 *     each, a hammer) on the hole (3047,9639, plane 1) in her hold; Ned (Draynor)
 *     takes the combined map and waits in the hold on plane 3, where "Yep lets go!"
 *     sails and wrecks her on Crandor (2851,3235)
 *   - Crandor: the rock opening (2833,3255) into the dungeon, Elvarg's gate
 *     (2847,9636); her death with our last hit completes the quest. Sailing resets
 *     the repairs and Ned's hire, so a second trip repairs and hires again.
 */
import type { NearbyNpc } from '../../../sdk/types';
import { NeedsStock, type Quest } from './run-quest';
import { depositAllInventory } from '../quest-supplies';
import { SAFE_BANKS } from '../safe-stops';
import { driveDialog } from './dialog';
import { itemPattern, SOURCES, type Need } from './sources';
import { tickNow, ticksToMs, untilTicks } from './ticks';

interface Tile {
    x: number;
    z: number;
}

const GUILD_DOOR = { x: 3191, z: 3363 };
export const OZIACH = { x: 3069, z: 3517 };
const DUKE = { x: 3210, z: 3222, level: 1 };
const LUMBRIDGE_STAIRS = { x: 3205, z: 3208 };
const KLARENSE = { x: 3047, z: 3204 };
export const NED = { x: 3100, z: 3258 };
/** South of his cell's railing (z 3183, the cell is 3013-3015 x 3184-3188); he answers within 3 tiles in line of sight. */
const WORMBRAIN_STAND = { x: 3016, z: 3183 };
const ORACLE = { x: 3015, z: 3504 };
const ICE_TRAPDOOR = { x: 3019, z: 3450 };
const ICE_LADDER = { x: 3019, z: 9850 };
const MAGIC_DOOR = { x: 3051, z: 9840 };
const ORACLE_CHEST = { x: 3057, z: 9841 };
const MAZE_DOOR = { x: 2941, z: 3248 };
const MAZE_CHEST = { x: 2935, z: 9657 };
const GANGPLANK = { x: 3047, z: 3205 };
const GANGPLANK_ID = 2593; // dragonshipgangplank_on
const SHIP_HOLE = { x: 3047, z: 9639 };
const HOLD_LADDER = { x: 3048, z: 9640 };
const CRANDOR_OPENING = { x: 2833, z: 3255 };
const ELVARG_GATE = { x: 2847, z: 9636 };

/** The key-holders' npc types (npc.pack). */
const MAZE_NPC = { rat: 748, ghost: 749, skeleton: 750, zombie: 751, demon: 752, melzar: 753 };

/** Obj ids: the three pieces share the name "Map part". */
export const MAZE_PART = 1535;
export const WORMBRAIN_PART = 1536;
export const ORACLE_PART = 1537;

/** Spellbook (sdk/spells.ts LUMBRIDGE_TELEPORT) and the magic tab, as lib/lost-city.ts. */
const LUMBRIDGE_TELEPORT = 1167;
const MAGIC_TAB = 6;

/** Elvarg: the longsword (Attack 60, Lost City), the Duke's shield, sharks; Lumbridge Teleport home. */
export const ELVARG_KIT: Need[] = [
    { item: 'shark', count: 20 },
    { item: 'air rune', count: 3 },
    { item: 'earth rune', count: 1 },
    { item: 'law rune', count: 1 },
];
export const SHIP_REPAIR: Need[] = [
    { item: 'plank', count: 3 },
    { item: 'nails', count: 12 },
    { item: 'hammer', count: 1 },
];

const pos = (q: Quest) => {
    const p = q.sdk.getState()?.player;
    return { x: p?.worldX ?? 0, z: p?.worldZ ?? 0, level: p?.level ?? 0 };
};
const where = (q: Quest) => `(${pos(q).x},${pos(q).z},L${pos(q).level})`;
const holdsId = (q: Quest, id: number) => q.sdk.getInventory().some((i) => i.id === id);
const wearing = (q: Quest, item: RegExp) => q.sdk.getEquipment().some((i) => item.test(i.name));
const has = (q: Quest, item: RegExp) => !!q.sdk.findInventoryItem(item) || wearing(q, item);

export const onCrandor = (q: Quest) => {
    const p = pos(q);
    return (p.x >= 2800 && p.x <= 2875 && p.z >= 3220 && p.z <= 3320) || (p.x >= 2810 && p.x <= 2880 && p.z >= 9590 && p.z <= 9680);
};
const inHold = (q: Quest) => {
    const p = pos(q);
    return p.x >= 3036 && p.x <= 3060 && p.z >= 9630 && p.z <= 9650;
};

/** Op `opt` on the loc named `name` at `at` (current plane) until `done`, driving any dialog. */
async function op(q: Quest, at: Tile, name: RegExp, opt: RegExp, done: () => boolean, label: string, choices: RegExp[] = []): Promise<void> {
    for (let attempt = 1; attempt <= 4; attempt++) {
        if (done()) return;
        if (q.sdk.getDialog()?.isOpen) await driveDialog(q.sdk, choices, { done, ticks: 80, log: q.log });
        if (done()) return;
        await q.sdk.scanNearbyLocs(15).catch(() => undefined);
        const loc = (q.sdk.getNearbyLocs() ?? []).find((l) => l.x === at.x && l.z === at.z && name.test(l.name) && l.optionsWithIndex.some((o) => opt.test(o.text)));
        if (!loc) {
            const near = (q.sdk.getNearbyLocs() ?? []).filter((l) => Math.abs(l.x - at.x) <= 3 && Math.abs(l.z - at.z) <= 3).map((l) => `${l.name}@${l.x},${l.z}[${l.options.join('/')}]`);
            q.log(`dragon: ${label}: no ${name} with ${opt} at (${at.x},${at.z}) from ${where(q)} (attempt ${attempt}); near: ${near.join(' ')}`);
            await q.sdk.waitForTicks(3);
            continue;
        }
        await q.sdk.sendInteractLoc(at.x, at.z, loc.id, loc.optionsWithIndex.find((o) => opt.test(o.text))!.opIndex);
        await untilTicks(q.sdk, (s) => done() || !!s.dialog?.isOpen, 40);
        if (q.sdk.getDialog()?.isOpen) await driveDialog(q.sdk, choices, { done, ticks: 80, log: q.log });
        if (await untilTicks(q.sdk, done, 8)) return;
        q.log(`dragon: ${label} did not take from ${where(q)} (attempt ${attempt})`);
    }
    throw new Error(`dragon: ${label} failed at ${where(q)}`);
}

/** Use a held item on the loc at `at` until `done`. */
async function useOn(q: Quest, item: RegExp, at: Tile, label: string, done: () => boolean): Promise<void> {
    for (let attempt = 1; attempt <= 4 && !done(); attempt++) {
        const held = q.sdk.findInventoryItem(item);
        if (!held) throw new Error(`dragon: ${label}: no ${item} held`);
        await q.sdk.scanNearbyLocs(15).catch(() => undefined);
        const loc = (q.sdk.getNearbyLocs() ?? []).find((l) => l.x === at.x && l.z === at.z);
        if (!loc) {
            q.log(`dragon: ${label}: nothing at (${at.x},${at.z}) from ${where(q)}`);
            await q.sdk.waitForTicks(3);
            continue;
        }
        await q.sdk.sendUseItemOnLoc(held.slot, at.x, at.z, loc.id);
        await untilTicks(q.sdk, (s) => done() || !!s.dialog?.isOpen, 40);
        if (q.sdk.getDialog()?.isOpen) await driveDialog(q.sdk, [], { done, ticks: 40, log: q.log });
        if (await untilTicks(q.sdk, done, 6)) return;
        q.log(`dragon: ${label} did not take from ${where(q)} (attempt ${attempt})`);
    }
    if (!done()) throw new Error(`dragon: ${label} failed at ${where(q)}`);
}

const pageKey = (q: Quest) => JSON.stringify([q.sdk.getDialog()?.isOpen, q.sdk.getDialog()?.text, (q.sdk.getDialog()?.options ?? []).map((o) => o.text)]);

/**
 * Talk to an npc, picking each of `picks` at most once, best first among what the
 * menu offers (Oziach's menus offer again the questions already asked).
 * `direct`: op the npc without walking (Wormbrain, behind bars).
 */
async function talkPicks(q: Quest, npc: RegExp, picks: RegExp[], opts: { at?: Tile & { level?: number }; direct?: boolean } = {}): Promise<string> {
    if (opts.at) await q.goTo(opts.at, opts.direct ? 0 : 4);
    await untilTicks(q.sdk, () => !!q.sdk.findNearbyNpc(npc), 15);
    const target = q.sdk.findNearbyNpc(npc);
    if (!target) throw new Error(`dragon: no ${npc} near ${where(q)}`);
    if (opts.direct) {
        const talk = target.optionsWithIndex?.find((o) => /talk/i.test(o.text));
        await q.sdk.sendInteractNpc(target.index, talk?.opIndex ?? 1, { route: false });
    } else {
        const res = await q.bot.talkTo(target);
        if (!res.success) q.log(`dragon: talk ${target.name}: ${res.message}`);
    }
    const left = [...picks];
    const seen: string[] = [];
    const t0 = tickNow(q.sdk);
    while (tickNow(q.sdk) - t0 < 400) {
        if (!q.sdk.getDialog()?.isOpen && !(await untilTicks(q.sdk, (s) => !!s.dialog?.isOpen, seen.length ? 6 : 15))) break;
        const options = q.sdk.getDialog()?.options ?? [];
        const before = pageKey(q);
        const cont = options.find((o) => /click here to continue/i.test(o.text));
        if (cont) {
            await q.sdk.sendClickDialog(cont.index);
        } else if (options.length) {
            const i = left.findIndex((p) => options.some((o) => p.test(o.text)));
            if (i < 0) {
                q.log(`dragon: ${npc}: no pick for ${JSON.stringify(options.map((o) => o.text))}`);
                break;
            }
            const opt = options.find((o) => left[i]!.test(o.text))!;
            seen.push(`> ${opt.text}`);
            left.splice(i, 1);
            await q.sdk.sendClickDialog(opt.index);
        } else {
            await q.sdk.waitForTicks(1);
            continue;
        }
        await untilTicks(q.sdk, () => pageKey(q) !== before, 8);
    }
    q.log(`dragon: talked to ${target.name}: ${seen.join(' ') || '(no choices)'}`);
    return seen.join(' ');
}

// ── Starting: the Guildmaster and Oziach

/**
 * The Guild master, inside the Champions' Guild: its door (3191,3363, 32 QP) moves
 * us through by script, and walkTo's own door handling reports it cant_reach.
 */
export async function talkGuildmaster(q: Quest): Promise<void> {
    const inside = () => pos(q).level === 0 && pos(q).z < GUILD_DOOR.z && Math.abs(pos(q).x - GUILD_DOOR.x) <= 8 && pos(q).z >= GUILD_DOOR.z - 12;
    if (!inside()) {
        await q.goTo({ x: GUILD_DOOR.x, z: GUILD_DOOR.z + 1 }, 1);
        await op(q, GUILD_DOOR, /door/i, /open/i, inside, "Champions' Guild door");
    }
    await talkPicks(q, /^guild master$/i, [/rune plate mail body/i]);
}

/** Oziach: the quest, then everything he knows (the Maze key comes with "the first piece"). */
export async function talkOziach(q: Quest): Promise<void> {
    await talkPicks(
        q,
        /^oziach$/i,
        [
            /sell me some rune plate/i,
            /guildmaster of the champions/i,
            /how am i meant to prove/i,
            /will i need anything to defeat/i,
            /where can i find this dragon/i,
            /first piece of the map/i,
            /second piece of the map/i,
            /third piece of the map/i,
            /antidragon shield/i,
            /ok i'll try and get everything/i,
        ],
        { at: OZIACH }
    );
}

// ── Map pieces

/**
 * Kill the maze's key-holder for the key it drops (all six are "Key"). Matched by npc type:
 * each floor also has plain namesakes that drop nothing (four "Ghost"s beside
 * dragonslayer_ghost, six giant rats, five skeletons; m45_50/m45_150). False when none is about.
 */
async function killForKey(q: Quest, npc: number, label: string): Promise<boolean> {
    const keys = () => q.count(/^key$/i);
    const before = keys();
    const t0 = tickNow(q.sdk);
    let lastSeen = t0;
    let target: NearbyNpc | undefined;
    while (keys() <= before && tickNow(q.sdk) - t0 < 900) {
        const drop = q.sdk.findGroundItem(/^key$/i, { reachable: true });
        if (drop && drop.distance <= 12) {
            await q.bot.pickupItem(drop);
            await untilTicks(q.sdk, () => keys() > before, 10);
            continue;
        }
        // Reachable ones first; "unreachable" is often only a plain closed door (the ghost's floor), which a walk opens.
        target = (q.sdk.getNearbyNpcs() ?? [])
            .filter((n) => n.id === npc && (n.hp ?? 1) > 0)
            .sort((a, b) => Number(a.reachable === false) - Number(b.reachable === false) || a.distance - b.distance)[0];
        if (target && target.reachable === false && target.distance > 1) {
            await q.bot.walkTo(target.x, target.z, 1).catch(() => undefined);
        }
        if (!target) {
            // Its kill-drop window: a respawn takes a while; nothing in sight at all means it is not this room.
            if (tickNow(q.sdk) - lastSeen > 120) break;
            await q.sdk.waitForTicks(4);
            continue;
        }
        lastSeen = tickNow(q.sdk);
        if ((tickNow(q.sdk) - t0) % 150 < 3) {
            const keysOnFloor = (q.sdk.getGroundItems() ?? []).filter((g) => /^key$/i.test(g.name)).map((g) => `${g.x},${g.z}${g.reachable === false ? '(unreachable)' : ''}`);
            const them = (q.sdk.getNearbyNpcs() ?? []).filter((n) => n.id === npc).map((n) => `${n.name}#${n.index}@${n.x},${n.z} d${n.distance}${n.reachable === false ? ' unreachable' : ''} hp${n.hp}`);
            q.log(`dragon: ${label}: ${them.join('; ')} | keys on the floor: ${keysOnFloor.join(' ') || 'none'} | me ${where(q)} target ${q.sdk.getState()?.player?.combat?.targetIndex}`);
        }
        await eatIfLow(q);
        const me = q.sdk.getState()?.player;
        // The maze's rats join in: while one is on us, every attack on the key-holder is
        // "I'm already under attack!" (901 ticks of it on the ghost's floor, 2026-10-30). Kill it first.
        const pest = (q.sdk.getNearbyNpcs() ?? []).find((n) => n.id !== npc && n.inCombat && n.distance <= 1 && (n.hp ?? 1) > 0);
        if (pest && me?.combat?.targetIndex !== pest.index) {
            const res = await q.bot.attack(pest, ticksToMs(10));
            if (!res.success) q.log(`dragon: ${label}: the ${pest.name} on us: ${res.message}`);
            await q.sdk.waitForTicks(2);
            continue;
        }
        if (pest) {
            await q.sdk.waitForTicks(2);
            continue;
        }
        if (!me?.combat?.inCombat || me.combat.targetIndex !== target.index) {
            const res = await q.bot.attack(target, ticksToMs(10));
            if (!res.success) q.log(`dragon: ${label}: ${res.message}`);
        }
        await q.sdk.waitForTicks(2);
    }
    const got = keys() > before;
    q.log(`dragon: ${label}'s key ${got ? 'taken' : 'NOT found'} in ${tickNow(q.sdk) - t0}t at ${where(q)}`);
    return got;
}

async function eatIfLow(q: Quest): Promise<void> {
    const p = q.sdk.getState()?.player;
    if (!p || p.hp > (p.maxHp || 99) * 0.55) return;
    const food = q.sdk.findInventoryItem(/^shark$/i) ?? q.sdk.getInventory().find((i) => i.optionsWithIndex.some((o) => /^eat$/i.test(o.text)));
    if (food) await q.bot.eatFood(food).catch(() => undefined);
}

/** Kill for the key, then use it on its door: the key disintegrates as the door lets us through. */
async function keyedDoor(q: Quest, npc: number, label: string, door: Tile, through: () => boolean): Promise<void> {
    if (through()) return;
    if (q.count(/^key$/i) < 1 && !(await killForKey(q, npc, label))) throw new Error(`dragon: no key from the ${label} at ${where(q)}`);
    // The door takes the key as it moves us through (open_and_close_door); which side of the
    // wall the door's own tile is differs per door, so the key going is the evidence.
    const before = q.count(/^key$/i);
    const from = pos(q);
    await useOn(q, /^key$/i, door, `${label}'s door`, () => q.count(/^key$/i) < before);
    await untilTicks(q.sdk, () => pos(q).x !== from.x || pos(q).z !== from.z, 4);
    await q.sdk.waitForTicks(2);
}

const climb = (q: Quest, at: Tile, opt: RegExp, done: () => boolean, label: string) => op(q, at, /^ladder$/i, opt, done, label);

/** Melzar's Maze, east door to the basement chest (route in the header). */
export async function mazePiece(q: Quest): Promise<void> {
    if (holdsId(q, MAZE_PART)) return;
    const p = () => pos(q);
    const below = () => p().z > 9600 && p().z < 9700 && p().x >= 2915 && p().x <= 2945;
    const inMaze = () => p().x >= 2915 && p().x <= 2941 && p().z >= 3236 && p().z <= 3262;
    if (!below()) {
        if (p().level === 0 && !inMaze()) {
            if (!q.sdk.findInventoryItem(/^maze key$/i)) {
                q.log('dragon: no Maze key — Oziach hands out another');
                await talkOziach(q);
                if (!q.sdk.findInventoryItem(/^maze key$/i)) throw new Error('dragon: Oziach gave no Maze key');
            }
            await q.goTo({ x: MAZE_DOOR.x + 1, z: MAZE_DOOR.z }, 0);
            await useOn(q, /^maze key$/i, MAZE_DOOR, 'maze door', () => p().x < MAZE_DOOR.x);
        }
        // Ground floor: the rat's red door, then up to the ghost's floor.
        if (p().level === 0 && p().z >= 3243) {
            await keyedDoor(q, MAZE_NPC.rat, 'giant rat', { x: 2926, z: 3253 }, () => p().x < 2926 || p().z >= 3254);
            await climb(q, { x: 2928, z: 3256 }, /climb-up/i, () => p().level === 1, 'maze ladder up (2928,3256)');
        }
        if (p().level === 1 && p().x <= 2931 && p().z >= 3243) {
            await keyedDoor(q, MAZE_NPC.ghost, 'ghost', { x: 2931, z: 3253 }, () => p().x > 2931);
            await climb(q, { x: 2934, z: 3254 }, /climb-up/i, () => p().level === 2, 'maze ladder up (2934,3254)');
        }
        if (p().level === 2 && p().z >= 3249) {
            await keyedDoor(q, MAZE_NPC.skeleton, 'skeleton', { x: 2924, z: 3249 }, () => p().z < 3249);
        }
        if (p().level === 2) {
            await q.goTo({ x: 2940, z: 3241, level: 2 }, 1).catch((e) => q.log(`dragon: to the L2 ladder: ${e}`));
            await climb(q, { x: 2940, z: 3240 }, /climb-down/i, () => p().level === 1, 'maze ladder down (2940,3240)');
        }
        if (p().level === 1) {
            await climb(q, { x: 2937, z: 3240 }, /climb-down/i, () => p().level === 0, 'maze ladder down (2937,3240)');
        }
        await climb(q, { x: 2932, z: 3240 }, /climb-down/i, below, 'maze ladder to the basement (2932,3240)');
    }
    // Basement: zombie (blue), Melzar (magenta), the lesser demon (green), the chest.
    if (p().z <= 9643) await keyedDoor(q, MAZE_NPC.zombie, 'zombie', { x: 2931, z: 9643 }, () => p().z > 9643);
    if (p().z <= 9652 && p().x <= 2932) await keyedDoor(q, MAZE_NPC.melzar, 'Melzar', { x: 2929, z: 9652 }, () => p().z > 9652);
    if (p().z <= 9655) await keyedDoor(q, MAZE_NPC.demon, 'lesser demon', { x: 2936, z: 9655 }, () => p().z > 9655);
    await chestPiece(q, MAZE_CHEST, MAZE_PART, 'maze chest');
    await leaveMaze(q);
}

/**
 * Out of the maze: the basement's ladders come up inside it, and the only way out
 * of the entrance room is the Maze key on the east door again (its plain op is
 * always "securely locked"; the funexit doors only open towards the entrance).
 */
export async function leaveMaze(q: Quest): Promise<void> {
    const inside = () => {
        const p = pos(q);
        return (p.x >= 2915 && p.x <= 2940 && p.z >= 3236 && p.z <= 3262) || (p.x >= 2915 && p.x <= 2945 && p.z >= 9630 && p.z <= 9665);
    };
    if (!inside()) return;
    await q.goTo({ x: MAZE_DOOR.x - 1, z: MAZE_DOOR.z }, 0);
    if (!q.sdk.findInventoryItem(/^maze key$/i)) throw new Error(`dragon: in Melzar's Maze at ${where(q)} without the Maze key`);
    await useOn(q, /^maze key$/i, MAZE_DOOR, 'maze door out', () => pos(q).x >= MAZE_DOOR.x);
}

/** Open, then search, a quest chest until its map part arrives. */
async function chestPiece(q: Quest, at: Tile, part: number, label: string): Promise<void> {
    const got = () => holdsId(q, part);
    const isOpen = () => (q.sdk.getNearbyLocs() ?? []).some((l) => l.x === at.x && l.z === at.z && l.options.some((o) => /search/i.test(o)));
    for (let attempt = 1; attempt <= 3 && !got(); attempt++) {
        await q.sdk.scanNearbyLocs(10).catch(() => undefined);
        if (!isOpen()) await op(q, at, /^chest$/i, /^open$/i, isOpen, `${label} open`);
        await op(q, at, /^chest$/i, /search/i, got, `${label} search`).catch((e) => q.log(String(e)));
        await driveDialog(q.sdk, [], { ticks: 10, log: q.log });
    }
    if (!got()) throw new Error(`dragon: no map part from the ${label}`);
}

/** The Oracle, then through Ice Mountain's magic door with the four items, and the chest. */
export async function oraclePiece(q: Quest): Promise<void> {
    if (holdsId(q, ORACLE_PART)) return;
    const below = () => pos(q).z > 9000;
    if (!below()) {
        await talkPicks(q, /^oracle$/i, [/seek a piece of the map/i], { at: ORACLE });
        await q.goTo({ x: ICE_TRAPDOOR.x, z: ICE_TRAPDOOR.z + 1 }, 1);
        await q.sdk.scanNearbyLocs(5).catch(() => undefined);
        const shut = () => (q.sdk.getNearbyLocs() ?? []).some((l) => l.x === ICE_TRAPDOOR.x && l.z === ICE_TRAPDOOR.z && l.options.some((o) => /^open$/i.test(o)));
        if (shut()) await op(q, ICE_TRAPDOOR, /^trapdoor$/i, /^open$/i, () => !shut(), 'Ice Mountain trapdoor open');
        await op(q, ICE_TRAPDOOR, /^trapdoor$/i, /climb-down/i, below, 'Ice Mountain trapdoor');
    }
    if (pos(q).x < MAGIC_DOOR.x) {
        await q.goTo({ x: MAGIC_DOOR.x - 1, z: MAGIC_DOOR.z, level: 0 }, 0);
        await op(q, MAGIC_DOOR, /^door$/i, /^open$/i, () => pos(q).x >= MAGIC_DOOR.x, 'magic door');
    }
    await chestPiece(q, ORACLE_CHEST, ORACLE_PART, 'oracle chest');
    // Back to the trapdoor's ladder (3019,9850): goTo's way out of underground climbs the ladder beside us,
    // and from the magic door it planned to the wrong end of the mine.
    if (pos(q).x >= MAGIC_DOOR.x) await op(q, MAGIC_DOOR, /^door$/i, /^open$/i, () => pos(q).x < MAGIC_DOOR.x, 'magic door out');
    await q.goTo({ x: ICE_LADDER.x, z: ICE_LADDER.z + 1, level: 0 }, 1);
    await op(q, ICE_LADDER, /^ladder$/i, /climb-up/i, () => pos(q).z < 9000, 'Ice Mountain ladder up');
}

/** Wormbrain sells his piece through the bars for 10,000. */
export async function wormbrainPiece(q: Quest): Promise<void> {
    if (holdsId(q, WORMBRAIN_PART)) return;
    if (q.count('coins') < 10_000) throw new Error(`dragon: Wormbrain wants 10,000 coins, holding ${q.count('coins')}`);
    for (let attempt = 1; attempt <= 3 && !holdsId(q, WORMBRAIN_PART); attempt++) {
        await q.goTo(WORMBRAIN_STAND, 0);
        // He wanders his cell: wait until he is within talking range of the railing.
        await untilTicks(q.sdk, () => (q.sdk.findNearbyNpc(/^wormbrain$/i)?.distance ?? 99) <= 3, 60);
        await talkPicks(q, /^wormbrain$/i, [/piece of map that i need/i, /pay you for the map piece/i, /10,000 it is/i], { direct: true });
        await untilTicks(q.sdk, () => holdsId(q, WORMBRAIN_PART), 4);
    }
    if (!holdsId(q, WORMBRAIN_PART)) throw new Error(`dragon: Wormbrain did not sell his piece (coins ${q.count('coins')}, at ${where(q)})`);
}

/** All three pieces into the Crandor map. */
async function combineMap(q: Quest): Promise<void> {
    if (q.count('crandor map') > 0) return;
    const a = q.sdk.getInventory().find((i) => i.id === MAZE_PART);
    const b = q.sdk.getInventory().find((i) => i.id === WORMBRAIN_PART);
    if (!a || !b || !holdsId(q, ORACLE_PART)) throw new Error('dragon: not all three map parts to combine');
    await q.sdk.sendUseItemOnItem(a.slot, b.slot);
    await untilTicks(q.sdk, () => q.count('crandor map') > 0 || !!q.sdk.getDialog()?.isOpen, 10);
    await driveDialog(q.sdk, [], { ticks: 10, log: q.log });
    if (q.count('crandor map') < 1) throw new Error('dragon: the map parts did not combine');
}

/** The three pieces in a walk order (maze, Port Sarim, Ice Mountain), then the map. */
export async function crandorMap(q: Quest): Promise<void> {
    if (q.count('crandor map') > 0) return;
    await leaveShip(q);
    if (holdsId(q, MAZE_PART)) await leaveMaze(q);
    const sword = q.sdk.findInventoryItem(/^dragon longsword$/i);
    if (sword && !wearing(q, /^dragon longsword$/i)) await q.bot.equipItem(sword).catch(() => undefined);
    await mazePiece(q);
    await wormbrainPiece(q);
    await oraclePiece(q);
    await combineMap(q);
}

// ── The ship

export async function buyShip(q: Quest): Promise<void> {
    await talkPicks(q, /^klarense$/i, [/could buy it/i, /yep, sounds good/i], { at: KLARENSE });
}

/** Aboard the Lady Lumbridge and down into her hold (plane 1 while she leaks; 3 to Ned once hired with the map). */
async function toHold(q: Quest): Promise<void> {
    if (inHold(q)) return;
    if (pos(q).level === 0) {
        await q.bot.closeInterface().catch(() => undefined);
        await q.goTo({ x: GANGPLANK.x, z: GANGPLANK.z - 2 }, 1);
        // The gangplank sits on a bridged plane-1 tile (the server has it on plane 0); the client
        // does not list it, so it is op'd by its id.
        for (let attempt = 1; attempt <= 4 && pos(q).level === 0; attempt++) {
            const res = await q.sdk.sendInteractLoc(GANGPLANK.x, GANGPLANK.z, GANGPLANK_ID, 1);
            if (await untilTicks(q.sdk, () => pos(q).level > 0, 20)) break;
            q.log(`dragon: gangplank did not take from ${where(q)} (attempt ${attempt}): ${res.message ?? ''}`);
        }
        if (pos(q).level === 0) throw new Error(`dragon: could not board the Lady Lumbridge from ${where(q)}`);
    }
    await q.sdk.scanNearbyLocs(10).catch(() => undefined);
    const down = q.sdk.findNearbyLoc(/^ladder$/i, { withOption: /climb-down/i });
    if (!down) throw new Error(`dragon: no ladder down on deck at ${where(q)}`);
    await op(q, { x: down.x, z: down.z }, /^ladder$/i, /climb-down/i, () => inHold(q), 'ladder to the hold');
}

/** Up the hold's ladder to the deck (a repaired hold drops the next climb onto Ned's plane). */
async function toDeck(q: Quest): Promise<void> {
    if (!inHold(q)) return;
    await op(q, HOLD_LADDER, /^ladder$/i, /climb-up/i, () => !inHold(q), 'hold ladder up');
}

/** From the hold or the deck back onto Port Sarim's pier. */
export async function leaveShip(q: Quest): Promise<void> {
    await toDeck(q);
    const p = pos(q);
    if (p.level === 0 || Math.abs(p.x - GANGPLANK.x) > 8 || Math.abs(p.z - GANGPLANK.z) > 8) return;
    await q.sdk.scanNearbyLocs(10).catch(() => undefined);
    const plank = q.sdk.findNearbyLoc(/gangplank/i, { withOption: /cross/i });
    await op(q, plank ? { x: plank.x, z: plank.z } : { x: GANGPLANK.x, z: GANGPLANK.z + 1 }, /gangplank/i, /cross/i, () => pos(q).level === 0, 'gangplank off');
}

/** Three planks (4 nails each, a hammer) on the hole; the last one lifts us a plane. */
export async function repairShip(q: Quest, stayAboard = false): Promise<void> {
    await toHold(q);
    for (let plank = 0; plank < 4 && pos(q).level === 1; plank++) {
        if (q.count('plank') < 1) throw new Error('dragon: out of planks with the hole open');
        const before = q.count('plank');
        await useOn(q, /^plank$/i, SHIP_HOLE, 'ship hole', () => q.count('plank') < before);
        await driveDialog(q.sdk, [], { ticks: 10, log: q.log });
    }
    await driveDialog(q.sdk, [], { ticks: 10, log: q.log });
    if (!stayAboard) await leaveShip(q);
}

/** Ned, hired (or hired again after a trip), and handed the map when it is held. */
export async function hireNed(q: Quest): Promise<void> {
    await talkPicks(q, /^ned$/i, [/could you take me to the island of crandor/i, /take me to crandor again/i, /so are you going to take me/i], { at: NED });
    if (q.count('crandor map') > 0) await talkPicks(q, /^ned$/i, [/so are you going to take me/i], { at: NED });
}

/** From the hold, Ned sails for Crandor; the ship wrecks on its shore. */
export async function sailToCrandor(q: Quest): Promise<void> {
    for (let attempt = 1; attempt <= 3 && !onCrandor(q); attempt++) {
        await toHold(q);
        if (!(await untilTicks(q.sdk, () => !!q.sdk.findNearbyNpc(/^ned$/i), 6))) {
            q.log(`dragon: no Ned in the hold at ${where(q)} (attempt ${attempt}) — up and down again`);
            await toDeck(q);
            continue;
        }
        await talkPicks(q, /^ned$/i, [/yep lets go/i]);
        await untilTicks(q.sdk, () => onCrandor(q), 40);
        await driveDialog(q.sdk, [], { ticks: 40, log: q.log });
    }
    if (!onCrandor(q)) throw new Error(`dragon: did not reach Crandor (at ${where(q)})`);
    q.log(`dragon: wrecked on Crandor at ${where(q)}`);
}

/** The Duke's shield: he gives one to a knight who asked Oziach and holds none. */
async function dukeShield(q: Quest): Promise<void> {
    // goTo changes plane where it stands: first the castle's stairs on the ground floor.
    if (pos(q).level !== 1) {
        await q.goTo(LUMBRIDGE_STAIRS, 2);
        await q.climbTo(1);
    }
    await talkPicks(q, /^duke horacio$/i, [/seek a shield/i], { at: DUKE });
    await q.climbTo(0);
    if (!has(q, /^dragonfire shield$/i)) throw new Error('dragon: the Duke gave no shield');
}

async function wear(q: Quest, item: RegExp, why: string): Promise<void> {
    if (wearing(q, item)) return;
    const held = q.sdk.findInventoryItem(item);
    if (!held) throw new Error(`dragon: no ${item} to wear`);
    if (q.sdk.getState()?.bank?.isOpen) await q.bot.closeBank().catch(() => undefined);
    await q.bot.equipItem(held);
    if (!(await untilTicks(q.sdk, () => wearing(q, item), 5))) throw new Error(`dragon: could not wear ${held.name} (${why})`);
}

/**
 * Elvarg's kit from the hub bank: longsword and shield worn, sharks and the
 * teleport's runes held, alongside `keep` (the repair kit on a second trip). The
 * shield comes from the Duke when none is banked.
 */
export async function kitUp(q: Quest, keep: RegExp[] = []): Promise<void> {
    await q.goTo(SAFE_BANKS.draynor, 4);
    await depositAllInventory(q.supply, keep);
    const take = async (item: string, count: number) => {
        const have = q.count(item);
        if (have >= count) return;
        const banked = q.sdk.findBankItem(itemPattern(item));
        if (banked) await q.bot.withdrawItem(banked, Math.min(banked.count, count - have));
        await untilTicks(q.sdk, () => q.count(item) >= count, 6);
    };
    await take('dragon longsword', 1);
    await take('dragonfire shield', 1);
    await q.bot.closeBank().catch(() => undefined);
    if (q.count('dragon longsword') < 1) throw new NeedsStock([{ item: 'dragon longsword', count: 1 }]);
    await wear(q, /^dragon longsword$/i, 'Attack 60 and Lost City complete');
    if (q.count('dragonfire shield') > 0) await wear(q, /^dragonfire shield$/i, "the Duke's shield");
    await q.bot.openBank();
    await untilTicks(q.sdk, (s) => !!s.bank?.isOpen, 10);
    for (const n of ELVARG_KIT) await take(n.item, n.count);
    await q.bot.closeBank().catch(() => undefined);
    // Mule lines short now means unstocked; the rest (Betty's runes) are sourced here.
    const short = ELVARG_KIT.filter((n) => SOURCES[n.item]?.mule && q.count(n.item) < n.count).map((n) => ({ item: n.item, count: n.count - q.count(n.item) }));
    if (short.length) throw new NeedsStock(short);
    for (const n of ELVARG_KIT) if (q.count(n.item) < n.count) await q.ensure(n.item, n.count);
    if (!wearing(q, /^dragonfire shield$/i)) {
        await dukeShield(q);
        await wear(q, /^dragonfire shield$/i, "the Duke's shield");
    }
    q.log(`dragon: kitted for Elvarg (${q.sdk.getEquipment().map((e) => e.name).join(', ')}; ${q.count('shark')} sharks)`);
}

// ── Elvarg

/** Lumbridge Teleport (the runes are in the kit): Crandor has no way home but the Karamja wall. */
export async function teleportHome(q: Quest): Promise<void> {
    if (!onCrandor(q)) return;
    for (let attempt = 1; attempt <= 3 && onCrandor(q); attempt++) {
        await driveDialog(q.sdk, [], { ticks: 10, log: q.log });
        await q.sdk.sendSetTab(MAGIC_TAB).catch(() => undefined);
        await q.sdk.waitForTicks(1);
        await q.sdk.sendClickComponent(LUMBRIDGE_TELEPORT);
        if (await untilTicks(q.sdk, () => !onCrandor(q), 12)) break;
        q.log(`dragon: Lumbridge Teleport attempt ${attempt} did not take (at ${where(q)})`);
    }
    if (onCrandor(q)) throw new Error(`dragon: Lumbridge Teleport off Crandor did not take (at ${where(q)})`);
    await q.sdk.waitForTicks(3);
}

/**
 * Wreck to lair: the rock opening, Elvarg's gate, then the fight; home by teleport.
 * Her death (our last hit) queues dragon_complete: 18,650 Strength and Defence XP each.
 */
export async function slayElvarg(q: Quest): Promise<void> {
    const xp0 = { str: q.sdk.getSkillXp('strength') ?? 0, def: q.sdk.getSkillXp('defence') ?? 0 };
    const done = () => (q.sdk.getSkillXp('strength') ?? 0) - xp0.str >= 18_000 && (q.sdk.getSkillXp('defence') ?? 0) - xp0.def >= 18_000;
    await wear(q, /^dragon longsword$/i, 'Attack 60 and Lost City complete');
    await wear(q, /^dragonfire shield$/i, "the Duke's shield");
    if (pos(q).z < 9000) {
        await q.goTo({ x: CRANDOR_OPENING.x, z: CRANDOR_OPENING.z - 1 }, 2);
        await op(q, CRANDOR_OPENING, /^rock opening$/i, /climb-down/i, () => pos(q).z > 9000, 'Crandor rock opening');
    }
    // The gate's own tile is the lair side: its wall is on the west edge.
    const inLair = (x: number) => x >= ELVARG_GATE.x;
    if (!inLair(pos(q).x)) {
        await q.goTo({ x: ELVARG_GATE.x - 1, z: ELVARG_GATE.z, level: 0 }, 0);
        // One fighter at a time: kill credit needs the most damage and the last hit.
        const t0 = tickNow(q.sdk);
        let noted = false;
        while (tickNow(q.sdk) - t0 < 1200 && q.sdk.getNearbyPlayers().some((pl) => inLair(pl.x))) {
            if (!noted) q.log("dragon: another player in Elvarg's lair — waiting");
            noted = true;
            await q.sdk.waitForTicks(5);
        }
        await op(q, ELVARG_GATE, /^gate$/i, /^open$/i, () => inLair(pos(q).x), "Elvarg's gate");
    }
    const t0 = tickNow(q.sdk);
    let attacks = 0;
    while (!done() && tickNow(q.sdk) - t0 < 1500) {
        await eatIfLow(q);
        if (q.sdk.getState()?.prayers?.prayerPoints && !q.sdk.isPrayerActive('protect_from_melee')) await q.bot.activatePrayer('protect_from_melee').catch(() => undefined);
        const elvarg = q.sdk.findNearbyNpc(/^elvarg$/i);
        if (!elvarg) {
            await q.sdk.waitForTicks(3);
            continue;
        }
        const me = q.sdk.getState()?.player;
        if (!me?.combat?.inCombat || me.combat.targetIndex !== elvarg.index) {
            attacks++;
            const res = await q.bot.attack(elvarg, ticksToMs(10));
            if (!res.success) q.log(`dragon: attack Elvarg #${attacks}: ${res.message}`);
        }
        await q.sdk.waitForTicks(2);
    }
    await q.bot.deactivateAllPrayers().catch(() => undefined);
    const me = q.sdk.getState()?.player;
    q.log(`dragon: Elvarg ${done() ? 'slain' : 'NOT slain'} in ${tickNow(q.sdk) - t0}t (${attacks} attacks, hp ${me?.hp}/${me?.maxHp}, ${q.count('shark')} sharks left)`);
    if (!done()) throw new Error(`dragon: Elvarg not slain (at ${where(q)})`);
    await driveDialog(q.sdk, [], { ticks: 10, log: q.log });
    await q.bot.closeInterface().catch(() => undefined);
    await teleportHome(q);
}
