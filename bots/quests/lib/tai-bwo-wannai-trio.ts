/**
 * Tai Bwo Wannai Trio — the route and mechanics (bots/quests/tai-bwo-wannai-trio.ts is the definition).
 *
 * Content (server/content/scripts/quests/quest_tbwt/scripts/*.rs2, area_karamja/scripts/tbwt_timfraku.rs2,
 * skill_fishing/scripts/fishing_spots/tbwt.rs2, skill_combat/scripts/weapon_poison.rs2, skill_cooking cooking.rs2):
 *   - Timfraku (2780,3087 upstairs) starts it (Jungle Potion complete) and ends it once all four of Tamayu, Tinsay,
 *     Tiadeche and Lubufu are complete (tbwt_get_brother_completion, checked by each brother's "complete" talk).
 *   - Lubufu (2770,3169, south of Brimhaven): "Who are you?", then "Talk about him..." / "What do you do?" twice to
 *     "I could help collect the bait." -> 20 raw karambwanji from the Holy Lake (small net, fishing spot 1174,
 *     not stackable, partial hand-ins count) -> three questions -> apprentice ("Yes!") -> a Karambwan vessel. He
 *     hands out another when you hold none ("Actually, I've lost my Karambwan vessel.").
 *   - Tiadeche (2912,3118): talk, then the vessel loaded with a karambwanji used on him -> his catch (raw karambwan,
 *     "Yes") and he asks for Tinsay's crafting manual. Tinsay (once complete) sketches it from a vessel used on him.
 *   - Tamayu (2844,3042): talk ("When will you succeed?" -> Yes: the hunt cutscene), then 4 agility potion doses and
 *     an acceptable (not bronze) Karambwan-poisoned spear used on him, then "Take me on your next hunt" -> slain.
 *     The poison: raw karambwan cooked "poorly" (the only way before Tinsay's reward), ground with a pestle and
 *     mortar (poisonous karambwan paste), the spear used on the paste -> e.g. tbwt_iron_spear_kp. No shop sells a
 *     spear in 2004: jogres (east jungle) drop iron spears (4/129, jogre.rs2) besides their bones.
 *   - Tinsay (2764,2976): sliced banana in Karamjan rum (knife on banana, slices on the rum), a seaweed in monkey
 *     skin sandwich (monkeys dodge melee during the quest: shot with a bow; Tamayu skins the corpse once he is
 *     complete; seaweed on the skin), burnt Jogre bones (tinderbox on the bones, Firemaking 30) smothered in raw
 *     karambwanji paste and cooked (Cooking 30) -> marinated.
 */
import type { Quest } from './run-quest';
import { driveDialog } from './dialog';
import { tickNow, untilTicks } from './ticks';
import { toJungle } from './jungle-potion';
import { isFlagged } from '../../../sdk/pathfinding';

interface Tile {
    x: number;
    z: number;
    level?: number;
}

export const OBJ = {
    jogreBones: 3125,
    burntBones: 3127,
    burntBonesPaste: 3128,
    marinated: 3130,
    rawKarambwan: 3142,
    poorKarambwan: 3146,
    burntKarambwan: 3148,
    karambwanji: 3150,
    poisonPaste: 3153,
    karambwanjiPaste: 3155,
    vessel: 3157,
    vesselLoaded: 3159,
    manual: 3161,
    slicedBanana: 3162,
    bananaRum: 3164,
    stuffedBananaRum: 3165,
    monkeyCorpse: 3166,
    monkeySkin: 3167,
    sandwich: 3168,
    banana: 1963,
    rum: 431,
    seaweed: 401,
    pestle: 233,
    tinderbox: 590,
    knife: 946,
} as const;
/** Non-bronze karambwan-poisoned spears (iron..dragon): Tamayu's "acceptable" + "kp" flags. */
export const KP_SPEARS = [3171, 3172, 3173, 3174, 3175, 3176];
/** Spears that take the paste and count as acceptable (iron, steel, mithril, adamant, rune, dragon). */
export const SPEARS = [1239, 1241, 1243, 1245, 1247, 1249];
const AGILITY = /^agility potion\(\d\)$/i;

export const TIMFRAKU: Tile = { x: 2780, z: 3087, level: 1 };
/** loc 1747 ladder at (2782,3087): up to Timfraku. */
const TIMFRAKU_LADDER: Tile = { x: 2782, z: 3088 };
export const LUBUFU: Tile = { x: 2770, z: 3168 };
export const TIADECHE: Tile = { x: 2911, z: 3117 };
export const TAMAYU: Tile = { x: 2844, z: 3040 };
export const TINSAY: Tile = { x: 2764, z: 2978 };
const HOLY_LAKE: Tile = { x: 2800, z: 3015 };
const KARAMBWAN_SPOT: Tile = { x: 2769, z: 3164 };
const JOGRES: Tile = { x: 2925, z: 3055 };
const MONKEYS: Tile = { x: 2793, z: 2998 };
const ZAMBO: Tile = { x: 2925, z: 3143 };
const PLANTATION: Tile = { x: 2916, z: 3162 };
const BANANA_TREES = new Set([2073, 2074, 2075, 2076, 2077]);
const SEAWEED_SPAWNS: Tile[] = [
    { x: 2762, z: 3001 },
    { x: 2771, z: 2995 },
    { x: 2782, z: 2987 },
    { x: 2756, z: 3008 },
    { x: 2755, z: 3017 },
];

const pos = (q: Quest) => {
    const p = q.sdk.getState()?.player;
    return { x: p?.worldX ?? 0, z: p?.worldZ ?? 0, level: p?.level ?? 0 };
};
const where = (q: Quest) => `(${pos(q).x},${pos(q).z},L${pos(q).level})`;
const inv = (q: Quest) => q.sdk.getInventory();
export const held = (q: Quest, ...ids: number[]) => inv(q).filter((i) => ids.includes(i.id)).reduce((n, i) => n + (i.count ?? 1), 0);
const item = (q: Quest, ...ids: number[]) => inv(q).find((i) => ids.includes(i.id));
const messagesSince = (q: Quest, t0: number) => (q.sdk.getState()?.gameMessages ?? []).filter((m) => m.tick >= t0).map((m) => m.text);
const heard = (q: Quest, t0: number, re: RegExp) => messagesSince(q, t0).some((m) => re.test(m));
const free = (q: Quest) => 28 - inv(q).length;

async function closeDialogs(q: Quest): Promise<void> {
    if (q.sdk.getDialog()?.isOpen) await driveDialog(q.sdk, [], { ticks: 10 });
    if (q.sdk.getState()?.interface?.isOpen) await q.sdk.sendCloseModal().catch(() => undefined);
}

// ── the jungle's pockets
//
// Two places the quest needs are walled off from the rest of Karamja by collision (sdk/pathfinding flood fill; the
// client refuses the walk, "client_rejected", staging 2026-11-04): the east jungle (Tiadeche, the jogres; x 2889-3004,
// z 2950-3119) is reached over the river's stepping stones at (2925,2948-2950) (shortcuts.rs2 _karamja_stepping_stone,
// an agility roll: a slip washes you back), and Tinsay's ruin (x 2759-2791, z 2970-2989) over the climbing rocks at
// (2792/2794, 2978-2980) (quest_zombiequeen.rs2 zqclimbingrocks: Agility 15 from the east, a roll either way).

const WALK = 2359552;
const WN = 2, WE = 8, WS = 32, WW = 128;
function flood(sx: number, sz: number): Set<string> {
    const blocked = (x: number, z: number) => isFlagged(x, z, 0, WALK & ~(WN | WE | WS | WW));
    const wall = (x: number, z: number, f: number) => isFlagged(x, z, 0, f);
    const moves: Array<[number, number, number, number]> = [
        [0, 1, WN, WS],
        [0, -1, WS, WN],
        [1, 0, WE, WW],
        [-1, 0, WW, WE],
    ];
    const seen = new Set<string>([`${sx},${sz}`]);
    const todo: Array<[number, number]> = [[sx, sz]];
    while (todo.length && seen.size < 20_000) {
        const [x, z] = todo.pop()!;
        for (const [mx, mz, o, i] of moves) {
            const nx = x + mx;
            const nz = z + mz;
            const k = `${nx},${nz}`;
            if (seen.has(k) || blocked(nx, nz) || wall(x, z, o) || wall(nx, nz, i)) continue;
            seen.add(k);
            todo.push([nx, nz]);
        }
    }
    return seen;
}
let pockets: { east: Set<string>; tinsay: Set<string> } | null = null;
type Pocket = 'east' | 'tinsay' | 'main';
export function pocketOf(p: Tile): Pocket {
    if ((p.level ?? 0) !== 0 || p.x < 2755 || p.x > 3005 || p.z < 2945 || p.z > 3120) return 'main';
    pockets ??= { east: flood(2925, 2952), tinsay: flood(2763, 2978) };
    // On the stepping stones (blocked tiles): still across the river.
    if (p.x === 2925 && p.z >= 2948 && p.z <= 2950) return 'east';
    // NPC spawn squares can be blocked tiles (Tiadeche's): an open neighbour decides.
    for (const [dx, dz] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const n = `${p.x + dx},${p.z + dz}`;
        if (pockets.east.has(n)) return 'east';
        if (pockets.tinsay.has(n)) return 'tinsay';
    }
    return 'main';
}

/** Lubufu's beach to Musa Point along Brimhaven's back street (4-dir BFS on the collision, doors closed). */
const BRIMHAVEN_STREET: Tile[] = [
    { x: 2772, z: 3174 },
    { x: 2787, z: 3175 },
    { x: 2798, z: 3180 },
    { x: 2812, z: 3182 },
    { x: 2826, z: 3182 },
    { x: 2826, z: 3166 },
    { x: 2842, z: 3158 },
    { x: 2865, z: 3157 },
    { x: 2887, z: 3155 },
    { x: 2906, z: 3152 },
    { x: 2924, z: 3146 },
];
const STONES_SOUTH: Tile = { x: 2925, z: 2947 };
const STONES_NORTH: Tile = { x: 2925, z: 2951 };
const ROCKS_EAST: Tile = { x: 2795, z: 2979 };
const ROCKS_WEST: Tile = { x: 2791, z: 2979 };

/** Over the stepping stones, one stone at a time, until in `want`. */
async function crossStones(q: Quest, want: Pocket): Promise<void> {
    const north = want === 'east';
    const across = () => (north ? pos(q).z >= 2951 && pocketOf(pos(q)) === 'east' : pocketOf(pos(q)) === 'main');
    for (let attempt = 1; attempt <= 15 && !across(); attempt++) {
        await closeDialogs(q);
        const p = pos(q);
        const onStones = p.x === 2925 && p.z >= 2948 && p.z <= 2950;
        if (!onStones) {
            const start = north ? STONES_SOUTH : STONES_NORTH;
            if (p.x !== start.x || p.z !== start.z) {
                if (north) await toJungle(q, start, 0);
                else await q.bot.walkTo(start.x, start.z, 0).catch(() => undefined);
            }
        }
        const z = pos(q).z + (north ? 1 : -1);
        const stone = ({ 2950: 2333, 2949: 2334, 2948: 2335 } as Record<number, number>)[z];
        if (stone === undefined) {
            // Off the end of the stones: one step onto land.
            await q.sdk.sendWalk(2925, north ? 2951 : 2947, false).catch(() => undefined);
            await q.sdk.waitForTicks(3);
            continue;
        }
        const t0 = tickNow(q.sdk);
        const before = pos(q);
        await q.sdk.sendInteractLoc(2925, z, stone, 1);
        await untilTicks(q.sdk, () => pos(q).z !== before.z || pos(q).x !== before.x, 12);
        await untilTicks(q.sdk, () => heard(q, t0, /make the jump|washed up|half drowned/i), 10);
        if (heard(q, t0, /slip and fall/i)) q.log(`tbwt: slipped off the stepping stones (attempt ${attempt})`);
        await q.sdk.waitForTicks(1);
    }
    if (!across()) throw new Error(`tbwt: could not cross the stepping stones to the ${want} side (at ${where(q)})`);
}

/** Over the climbing rocks into or out of Tinsay's ruin. */
async function climbRocks(q: Quest, want: Pocket): Promise<void> {
    const west = want === 'tinsay';
    for (let attempt = 1; attempt <= 10 && pocketOf(pos(q)) !== want; attempt++) {
        await closeDialogs(q);
        const start = west ? ROCKS_EAST : ROCKS_WEST;
        if (west) await toJungle(q, start, 0);
        else await q.bot.walkTo(start.x, start.z, 0).catch(() => undefined);
        const before = pos(q);
        await q.sdk.sendInteractLoc(west ? 2794 : 2792, 2979, 2231, 1);
        await untilTicks(q.sdk, () => Math.abs(pos(q).x - before.x) >= 3 || pocketOf(pos(q)) === want, 15);
        await q.sdk.waitForTicks(2);
    }
    if (pocketOf(pos(q)) !== want) throw new Error(`tbwt: could not climb the rocks to ${want} (at ${where(q)})`);
}

/** Out of a pocket onto the main jungle. */
export async function leavePocket(q: Quest): Promise<void> {
    const from = pocketOf(pos(q));
    if (from === 'east') await crossStones(q, 'main');
    if (from === 'tinsay') await climbRocks(q, 'main');
}

/**
 * Tamayu's hunts play in an instance off the map (m39_71: x 2496-2559, z 4544-4607 — inside lib/horror.ts's lighthouse
 * box, so a goTo from there "left" the lighthouse with Camelot Teleport, staging qltb2). Wait for the teleport back.
 */
export const inHuntCutscene = (p: Tile) => p.x >= 2496 && p.x <= 2559 && p.z >= 4544 && p.z <= 4607;
export async function waitOutCutscene(q: Quest): Promise<void> {
    if (!inHuntCutscene(pos(q))) return;
    await untilTicks(q.sdk, () => !inHuntCutscene(pos(q)), 150);
    if (q.sdk.getDialog()?.isOpen) await followDialog(q, []);
    if (inHuntCutscene(pos(q))) throw new Error(`tbwt: still in Tamayu's hunt cutscene at ${where(q)} after 150t`);
}

/** On Karamja (Barnaby's boat from Ardougne first), then to `t` (through the pockets' crossings). */
export async function go(q: Quest, t: Tile, tolerance = 3): Promise<void> {
    await waitOutCutscene(q);
    if ((t.level ?? 0) > 0 && pos(q).level === 0) {
        await leavePocket(q);
        // Upstairs (Timfraku's hut): to the foot of its ladder first, or goTo climbs the nearest one anywhere.
        await toJungle(q, TIMFRAKU_LADDER, 2);
        await q.goTo(t, tolerance);
        return;
    }
    if ((t.level ?? 0) === 0 && pos(q).level > 0) await q.climbTo(0);
    const want = pocketOf(t);
    // Out of a pocket first: the Musa Point leg below starts on the main jungle (qltb5 left Tinsay's ruin for Zambo and
    // took walkTo's route through the Brimhaven house, staging 2026-11-04).
    if (pocketOf(pos(q)) !== want) await leavePocket(q);
    // Between the jungle and Musa Point: Brimhaven's back street by hand. walkTo's route went in through a house door
    // and stuck at (2804,3177) every time (qltb1, staging 2026-11-04; jungle-potion.ts noted the same gap).
    const musa = (p: Tile) => p.x >= 2840 && p.z >= 3130 && p.z <= 3200;
    if (pocketOf(pos(q)) === 'main' && want === 'main' && musa(t) !== musa(pos(q)) && pos(q).level === 0) {
        const legs = musa(t) ? BRIMHAVEN_STREET : [...BRIMHAVEN_STREET].reverse();
        let from = 0;
        if (musa(t)) await toJungle(q, legs[0]!, 3);
        else from = Math.max(0, legs.findIndex((w) => Math.hypot(w.x - pos(q).x, w.z - pos(q).z) < 40));
        for (const w of legs.slice(from)) {
            for (let i = 0; i < 3 && Math.hypot(w.x - pos(q).x, w.z - pos(q).z) > 3; i++) await q.bot.walkTo(w.x, w.z, 2).catch(() => undefined);
        }
    }
    if (pocketOf(pos(q)) !== want) {
        if (want === 'east') await crossStones(q, 'east');
        if (want === 'tinsay') await climbRocks(q, 'tinsay');
    }
    if (want === 'main') await toJungle(q, t, tolerance);
    else {
        for (let i = 0; i < 3 && Math.max(Math.abs(pos(q).x - t.x), Math.abs(pos(q).z - t.z)) > tolerance; i++) {
            await q.bot.walkTo(t.x, t.z, tolerance).catch(() => undefined);
        }
    }
}

const npc = (q: Quest, re: RegExp) =>
    (q.sdk.getNearbyNpcs() ?? []).filter((n) => re.test(n.name)).sort((a, b) => a.distance - b.distance)[0];

/** Talk to `name` near `at` and drive the dialog with `choices`, up to `tries` times until `done`. */
export async function talk(q: Quest, name: RegExp, at: Tile, choices: Array<RegExp | string>, done: () => boolean | Promise<boolean>, label: string, tries = 4): Promise<string> {
    let text = '';
    for (let attempt = 1; attempt <= tries; attempt++) {
        if (await done()) return text;
        await closeDialogs(q);
        await go(q, at, 4);
        // No `at` for q.talk: its goTo has no way into the pockets (go() above handles them).
        text += await q.talk(name, choices);
        text += await followDialog(q, choices);
        await waitOutCutscene(q);
        text += await followDialog(q, choices);
        await closeDialogs(q);
    }
    if (!(await done())) throw new Error(`tbwt: ${label} not done at ${where(q)} (${text.slice(-200)})`);
    return text;
}

/**
 * Drive the dialog through the scripts' if_close + p_delay gaps (Tiadeche's vessel trial closes it for 10 ticks before
 * the "Accept Tiadeche's offer?" choice; driveDialog alone gives up after 5 and left the offer unanswered, staging).
 */
async function followDialog(q: Quest, choices: Array<RegExp | string>): Promise<string> {
    let text = '';
    for (let round = 0; round < 6; round++) {
        if (!(await untilTicks(q.sdk, (s) => !!s.dialog?.isOpen, round === 0 ? 2 : 15))) break;
        text += await driveDialog(q.sdk, choices, { ticks: 80, log: q.log });
    }
    return text;
}

/** Use the first held item of `ids` on `name` and drive the dialog. */
export async function useOnNpc(q: Quest, ids: number[], name: RegExp, at: Tile, choices: Array<RegExp | string>, done: () => boolean | Promise<boolean>, label: string, tries = 4): Promise<void> {
    for (let attempt = 1; attempt <= tries; attempt++) {
        if (await done()) return;
        await closeDialogs(q);
        const it = item(q, ...ids);
        if (!it) throw new Error(`tbwt: ${label}: nothing to use (${ids.join(',')})`);
        await go(q, at, 4);
        const n = npc(q, name);
        if (!n) {
            q.log(`tbwt: ${label}: ${name} not in view at ${where(q)}`);
            await q.sdk.waitForTicks(3);
            continue;
        }
        const r = await q.bot.useItemOnNpc(it, n).catch((e: Error) => ({ success: false, message: e.message }));
        if (!r.success) q.log(`tbwt: ${label}: ${r.message}`);
        await untilTicks(q.sdk, (s) => !!s.dialog?.isOpen, 10);
        await followDialog(q, choices);
        await closeDialogs(q);
        await q.sdk.waitForTicks(2);
    }
    if (!(await done())) throw new Error(`tbwt: ${label} not done at ${where(q)}`);
}

/** Use inventory item `a` on `b` until `done`. */
async function useOn(q: Quest, a: number[], b: number[], done: () => boolean, label: string): Promise<void> {
    for (let attempt = 0; attempt < 4 && !done(); attempt++) {
        await closeDialogs(q);
        const x = item(q, ...a);
        const y = item(q, ...b);
        if (!x || !y) throw new Error(`tbwt: ${label}: missing ${!x ? a.join(',') : b.join(',')}`);
        await q.sdk.sendUseItemOnItem(x.slot, y.slot);
        await untilTicks(q.sdk, (s) => done() || !!s.dialog?.isOpen, 6);
        if (q.sdk.getDialog()?.isOpen) await driveDialog(q.sdk, [], { done, ticks: 10 });
    }
    if (!done()) throw new Error(`tbwt: ${label} did not combine at ${where(q)}`);
}

// ── the start and the end

export async function startQuest(q: Quest, started: () => Promise<boolean>): Promise<void> {
    await talk(
        q,
        /^timfraku$/i,
        TIMFRAKU,
        [/i am a roving adventurer/i, /trufitus sent me/i, /your gratitude is all i deserve/i, /^yes$/i],
        started,
        'Timfraku (start)'
    );
}

export async function finishQuest(q: Quest, complete: () => Promise<boolean>): Promise<void> {
    await talk(q, /^timfraku$/i, TIMFRAKU, [/eternal gratitude accepted/i], complete, 'Timfraku (reward)');
}

// ── Lubufu

export async function lubufuBait(q: Quest, done: () => Promise<boolean>): Promise<void> {
    await talk(
        q,
        /^lubufu$/i,
        LUBUFU,
        [/i could help collect the bait/i, /could do with the help/i, /talk about him/i, /^what do you do\?/i, /what do you use for bait/i, /^who are you\?/i],
        done,
        'Lubufu (bait)',
        5
    );
}

/** The Holy Lake's karambwanji spot: net until holding `want` (or the pack is full). Shrimps are dropped. */
export async function fishKarambwanji(q: Quest, want: number): Promise<void> {
    if (held(q, OBJ.karambwanji) >= want) return;
    if (!q.count('small fishing net')) throw new Error('tbwt: no small fishing net');
    await go(q, HOLY_LAKE, 4);
    const t0 = tickNow(q.sdk);
    let lastSend = -99;
    let lastCount = held(q, OBJ.karambwanji);
    let progressAt = t0;
    while (held(q, OBJ.karambwanji) < want && (free(q) > 0 || inv(q).some((i) => /^raw shrimps?$/i.test(i.name)))) {
        if (tickNow(q.sdk) - t0 > 1500) throw new Error(`tbwt: karambwanji: ${held(q, OBJ.karambwanji)}/${want} after 1500t`);
        for (const s of inv(q).filter((i) => /^raw shrimps?$/i.test(i.name))) await q.bot.dropItem(s, 'all').catch(() => undefined);
        if (q.sdk.getDialog()?.isOpen) await closeDialogs(q);
        const n = held(q, OBJ.karambwanji);
        if (n !== lastCount) {
            lastCount = n;
            progressAt = tickNow(q.sdk);
        }
        if (tickNow(q.sdk) - progressAt > 30 && tickNow(q.sdk) - lastSend > 10) lastSend = -99;
        if (tickNow(q.sdk) - lastSend > 25 || tickNow(q.sdk) - progressAt > 30) {
            const spot = (q.sdk.getNearbyNpcs() ?? []).filter((x) => x.id === 1174).sort((a, b) => a.distance - b.distance)[0];
            if (!spot) {
                await go(q, HOLY_LAKE, 3);
                await q.sdk.waitForTicks(3);
                continue;
            }
            await q.sdk.sendInteractNpc(spot.index, 1);
            lastSend = tickNow(q.sdk);
            progressAt = tickNow(q.sdk);
        }
        await q.sdk.waitForTicks(2);
    }
    q.log(`tbwt: ${held(q, OBJ.karambwanji)} karambwanji in ${tickNow(q.sdk) - t0}t`);
}

/** 20 karambwanji to Lubufu, in as many trips as the pack takes. */
export async function feedLubufu(q: Quest, given: () => Promise<boolean>): Promise<void> {
    for (let trip = 1; trip <= 4 && !(await given()); trip++) {
        // Two spare: one for Tiadeche's vessel, one ground into paste for Tinsay's bones (Lubufu takes only what he lacks).
        await fishKarambwanji(q, 22);
        const before = held(q, OBJ.karambwanji);
        await useOnNpc(q, [OBJ.karambwanji], /^lubufu$/i, LUBUFU, [], () => held(q, OBJ.karambwanji) < before, 'karambwanji to Lubufu', 2).catch((e: Error) => q.log(e.message));
    }
    if (!(await given())) throw new Error('tbwt: Lubufu still short of karambwanji after 4 trips');
}

/** Three questions, then "Yes!" to the apprenticeship: the vessel. */
export async function apprentice(q: Quest, done: () => Promise<boolean>): Promise<void> {
    await talk(q, /^lubufu$/i, LUBUFU, [/^yes!?$/i, /^what is a karambwan\?/i], done, 'Lubufu (apprentice)', 5);
}

/** A vessel from Lubufu (only when none is held). */
export async function vesselFromLubufu(q: Quest): Promise<void> {
    if (held(q, OBJ.vessel, OBJ.vesselLoaded)) return;
    await talk(q, /^lubufu$/i, LUBUFU, [/lost my karambwan vessel/i, /it floated away/i], () => held(q, OBJ.vessel, OBJ.vesselLoaded) > 0, 'Lubufu (vessel)');
}

// ── Tiadeche

export async function meetTiadeche(q: Quest, done: () => Promise<boolean>): Promise<void> {
    await talk(q, /^tiadeche$/i, TIADECHE, [/^what is a karambwan\?/i], done, 'Tiadeche (intro)');
}

/** A loaded vessel on Tiadeche: his catch ("Yes") and the manual errand. */
export async function vesselToTiadeche(q: Quest, done: () => Promise<boolean>, caught: () => Promise<boolean>): Promise<void> {
    // Caught already (the offer left unanswered): a talk moves him on to the manual errand.
    if (await caught()) return void (await talk(q, /^tiadeche$/i, TIADECHE, [], done, 'Tiadeche (after his catch)'));
    if (!held(q, OBJ.vessel, OBJ.vesselLoaded)) await vesselFromLubufu(q);
    if (!held(q, OBJ.vesselLoaded)) {
        await fishKarambwanji(q, 1);
        await useOn(q, [OBJ.karambwanji], [OBJ.vessel], () => held(q, OBJ.vesselLoaded) > 0, 'karambwanji into the vessel');
    }
    await useOnNpc(q, [OBJ.vesselLoaded], /^tiadeche$/i, TIADECHE, [/^yes$/i], done, 'loaded vessel to Tiadeche');
}

export async function manualToTiadeche(q: Quest, done: () => Promise<boolean>, errand: () => Promise<boolean>): Promise<void> {
    // Tinsay only sketches the manual while Tiadeche waits for it (tbwt_tiadeche request_manual).
    if (!held(q, OBJ.manual) && !(await errand())) await talk(q, /^tiadeche$/i, TIADECHE, [], errand, 'Tiadeche (the manual errand)');
    if (!held(q, OBJ.manual)) {
        await vesselFromLubufu(q);
        await useOnNpc(q, [OBJ.vessel, OBJ.vesselLoaded], /^tinsay$/i, TINSAY, [], () => held(q, OBJ.manual) > 0, 'vessel to Tinsay');
    }
    await useOnNpc(q, [OBJ.manual], /^tiadeche$/i, TIADECHE, [], done, 'manual to Tiadeche');
}

// ── fires, cooking, grinding

/** Light logs where we stand (stepping off any fire first) and return the fire loc. */
async function lightFire(q: Quest) {
    const fire = () => (q.sdk.getNearbyLocs() ?? []).find((l) => /^fire$/i.test(l.name) && l.distance <= 3);
    await q.sdk.scanNearbyLocs(5).catch(() => undefined);
    if (fire()) return fire()!;
    for (let attempt = 0; attempt < 4; attempt++) {
        if (!q.count('logs')) throw new Error('tbwt: no logs for a fire');
        const r = await q.bot.burnLogs(/^logs$/i).catch((e: Error) => ({ success: false, message: e.message }));
        await q.sdk.scanNearbyLocs(5).catch(() => undefined);
        if (fire()) return fire()!;
        q.log(`tbwt: fire: ${r.message}`);
        // "You can't light a fire here": a step aside.
        const p = pos(q);
        await q.bot.walkTo(p.x + 1 + attempt, p.z, 0).catch(() => undefined);
    }
    throw new Error(`tbwt: could not light a fire at ${where(q)}`);
}

/** Cook item `id` on a fire until it becomes something else. */
async function cookOnFire(q: Quest, id: number, label: string): Promise<void> {
    for (let attempt = 0; attempt < 4 && held(q, id); attempt++) {
        const fire = await lightFire(q);
        await closeDialogs(q);
        const it = item(q, id)!;
        const before = held(q, id);
        await q.sdk.sendUseItemOnLoc(it.slot, fire.x, fire.z, fire.id);
        await untilTicks(q.sdk, (s) => held(q, id) < before || !!s.dialog?.isOpen, 10);
        if (q.sdk.getDialog()?.isOpen) await driveDialog(q.sdk, [/^cook|^1$|make 1|poorly/i], { done: () => held(q, id) < before, ticks: 10 });
        await untilTicks(q.sdk, () => held(q, id) < before, 8);
    }
    if (held(q, id)) throw new Error(`tbwt: ${label} did not cook at ${where(q)}`);
}

async function grind(q: Quest, id: number, product: number, label: string): Promise<void> {
    if (!held(q, OBJ.pestle)) throw new Error('tbwt: no pestle and mortar');
    await useOn(q, [OBJ.pestle], [id], () => held(q, product) > 0, label);
}

// ── Tamayu

export async function meetTamayu(q: Quest, done: () => Promise<boolean>): Promise<void> {
    await talk(q, /^tamayu$/i, TAMAYU, [/^when will you succeed\?/i, /^yes$/i], done, 'Tamayu (intro)');
}

/** The first hunt (the cutscene): "When will you succeed?" -> Yes. */
export async function firstHunt(q: Quest, done: () => Promise<boolean>): Promise<void> {
    await talk(q, /^tamayu$/i, TAMAYU, [/^when will you succeed\?/i, /^yes$/i], done, 'Tamayu (first hunt)');
    await untilTicks(q.sdk, () => false, 4);
}

/**
 * A karambwan-poisoned spear: the raw karambwan (Tiadeche's catch) cooked poorly and ground, and a non-bronze spear
 * from the jogres; jogre bones kept for Tinsay.
 */
export async function kpSpear(q: Quest): Promise<void> {
    if (held(q, ...KP_SPEARS)) return;
    if (!held(q, OBJ.poisonPaste)) {
        if (!held(q, OBJ.poorKarambwan)) {
            // Tiadeche's catch: if it was not taken at the hand-in, he hands it over at his next talk (received bit unset).
            if (!held(q, OBJ.rawKarambwan)) await talk(q, /^tiadeche$/i, TIADECHE, [/^no, not yet/i], () => held(q, OBJ.rawKarambwan) > 0, 'Tiadeche (his catch)', 1).catch((e: Error) => q.log(e.message));
            if (!held(q, OBJ.rawKarambwan)) await fishKarambwan(q);
            await cookOnFire(q, OBJ.rawKarambwan, 'the raw karambwan');
            if (!held(q, OBJ.poorKarambwan)) {
                q.log('tbwt: the karambwan burnt — another from the vessel');
                await kpSpear(q);
                return;
            }
        }
        await grind(q, OBJ.poorKarambwan, OBJ.poisonPaste, 'the poorly cooked karambwan');
    }
    if (!held(q, ...SPEARS)) await huntJogres(q, () => held(q, ...SPEARS) > 0 && held(q, OBJ.jogreBones, OBJ.burntBones, OBJ.burntBonesPaste, OBJ.marinated) > 0, 'a non-bronze spear');
    // The spear used on the paste (weapon_poison.rs2 opheldu,tbwt_poisonous_karambwan_paste).
    await useOn(q, SPEARS, [OBJ.poisonPaste], () => held(q, ...KP_SPEARS) > 0, 'the spear on the poisonous paste');
}

/** Karambwan from Lubufu's spot with a loaded vessel (Fishing 65): only when Tiadeche's catch burnt. */
async function fishKarambwan(q: Quest): Promise<void> {
    if (q.level('fishing') < 65) throw new Error(`tbwt: no raw karambwan, and Fishing ${q.level('fishing')} < 65 to catch one`);
    await vesselFromLubufu(q);
    for (let attempt = 0; attempt < 40 && !held(q, OBJ.rawKarambwan); attempt++) {
        if (!held(q, OBJ.vesselLoaded)) {
            // Bait for several lowerings at once: the lake and Lubufu's spot are ~150 tiles apart.
            if (!held(q, OBJ.karambwanji)) await fishKarambwanji(q, Math.min(10, held(q, OBJ.karambwanji) + free(q) - 2));
            await useOn(q, [OBJ.karambwanji], [OBJ.vessel], () => held(q, OBJ.vesselLoaded) > 0, 'karambwanji into the vessel');
        }
        await go(q, KARAMBWAN_SPOT, 3);
        const spot = (q.sdk.getNearbyNpcs() ?? []).find((n) => n.id === 1178);
        if (!spot) throw new Error(`tbwt: no karambwan spot near ${where(q)}`);
        await q.sdk.sendInteractNpc(spot.index, 1);
        await untilTicks(q.sdk, () => !held(q, OBJ.vesselLoaded) || held(q, OBJ.rawKarambwan) > 0, 15);
    }
    if (!held(q, OBJ.rawKarambwan)) throw new Error('tbwt: no karambwan caught in 40 tries');
}

/** Jogres in the east jungle until `done` (always drop their bones; 4/129 an iron spear). Bronze spears are left. */
async function huntJogres(q: Quest, done: () => boolean, label: string): Promise<void> {
    await go(q, JOGRES, 6);
    const w = inv(q).find((i) => /scimitar|longsword|sword|battleaxe|mace|warhammer|whip|dagger/i.test(i.name));
    if (w) await q.bot.equipItem(w).catch(() => undefined);
    const t0 = tickNow(q.sdk);
    let kills = 0;
    const loot = (id: number) => SPEARS.includes(id) || (id === OBJ.jogreBones && !held(q, OBJ.jogreBones, OBJ.burntBones, OBJ.burntBonesPaste, OBJ.marinated));
    // Jogres are aggressive and come in packs: qltb2 died to them on 6 sharks (staging 2026-11-04). Protect from Melee
    // nulls NPC melee; without it (or food), back off over the river before the hp runs out.
    const pray = async (on: boolean) => {
        const pr = q.sdk.getPrayerState();
        const active = q.sdk.isPrayerActive('protect_from_melee');
        if (on && !active && pr && pr.prayerLevel >= 43 && pr.prayerPoints > 0) await q.bot.activatePrayer('protect_from_melee').catch(() => undefined);
        if (!on && active) await q.bot.deactivatePrayer('protect_from_melee').catch(() => undefined);
    };
    try {
        while (!done()) {
            if (tickNow(q.sdk) - t0 > 4000) throw new Error(`tbwt: ${label}: none after 4000t (${kills} jogres)`);
            await pray(true);
            await eatIfLow(q);
            const me = q.sdk.getState()?.player;
            if (me && me.hp < (me.maxHp ?? 10) * 0.4 && !inv(q).some((i) => FOOD.test(i.name))) {
                await leavePocket(q).catch(() => undefined);
                throw new Error(`tbwt: ${label}: out of food at ${me.hp} hp after ${kills} jogres — retreated`);
            }
            // Room for the loot: bronze spears and spare bones go.
            for (const junk of inv(q).filter((i) => i.id === 1237 || (i.id === OBJ.jogreBones && held(q, OBJ.jogreBones) > 1))) await q.bot.dropItem(junk, 1).catch(() => undefined);
            await q.sdk.scanGroundItems(8).catch(() => undefined);
            const g = (q.sdk.getState()?.groundItems ?? []).find((x) => loot(x.id) && x.distance <= 8);
            if (g && free(q) > 0) {
                await q.bot.pickupItem(g).catch(() => undefined);
                await q.sdk.waitForTicks(2);
                continue;
            }
            const j = (q.sdk.getNearbyNpcs() ?? []).filter((n) => /^jogre$/i.test(n.name) && !n.inCombat && n.reachable !== false).sort((a, b) => a.distance - b.distance)[0];
            if (!j) {
                await go(q, JOGRES, 4);
                await q.sdk.waitForTicks(4);
                continue;
            }
            const r = await q.bot.attack(j, 12_000).catch(() => ({ success: false }));
            if (r.success) {
                kills++;
                await untilTicks(q.sdk, (s) => !(s.nearbyNpcs ?? []).some((n) => n.index === j.index && n.distance <= 8 && (n.hp ?? 1) > 0), 80);
                await q.sdk.waitForTicks(2);
            }
        }
    } finally {
        await pray(false);
    }
    q.log(`tbwt: ${label} after ${kills} jogres, ${tickNow(q.sdk) - t0}t`);
}

const FOOD = /^(shark|manta ray|monkfish|swordfish|lobster|bass|tuna|trout|salmon)$/i;
async function eatIfLow(q: Quest): Promise<void> {
    const p = q.sdk.getState()?.player;
    if (!p || p.hp > (p.maxHp ?? 10) * 0.5) return;
    const f = inv(q).find((i) => FOOD.test(i.name));
    if (f) await q.bot.eatFood(f).catch(() => undefined);
}

/** Agility potion doses until Tamayu has 4 ("increased his agility" in the journal), then the spear, then the hunt. */
export async function armTamayu(q: Quest, agile: () => Promise<boolean>, armed: () => Promise<boolean>, slain: () => Promise<boolean>): Promise<void> {
    await kpSpear(q);
    for (let i = 0; i < 4 && !(await agile()); i++) {
        if (!inv(q).some((x) => AGILITY.test(x.name))) throw new Error('tbwt: Tamayu needs more agility potion doses and none are held');
        const ids = inv(q).filter((x) => AGILITY.test(x.name)).map((x) => x.id);
        const before = inv(q).filter((x) => AGILITY.test(x.name)).length;
        await useOnNpc(q, ids, /^tamayu$/i, TAMAYU, [], () => inv(q).filter((x) => AGILITY.test(x.name)).length < before, 'agility potion to Tamayu', 2);
    }
    if (!(await armed())) await useOnNpc(q, KP_SPEARS, /^tamayu$/i, TAMAYU, [], () => !held(q, ...KP_SPEARS), 'the poisoned spear to Tamayu', 2);
    await talk(q, /^tamayu$/i, TAMAYU, [/take me on your next hunt/i], slain, 'Tamayu (the killing hunt)');
    await untilTicks(q.sdk, () => false, 4);
}

// ── Tinsay

export async function meetTinsay(q: Quest, done: () => Promise<boolean>): Promise<void> {
    await talk(q, /^tinsay$/i, TINSAY, [/^no\.?$/i, /i'll be back later/i], done, 'Tinsay (intro)');
}

/** Karamjan rum from Zambo and a banana from the plantation (Musa Point), sliced into the rum. */
export async function bananaRum(q: Quest, done: () => Promise<boolean>): Promise<void> {
    if (!held(q, OBJ.bananaRum)) {
        if (!held(q, OBJ.rum)) {
            const { buyWaitingForRestock } = await import('./sources');
            await go(q, ZAMBO, 4);
            await buyWaitingForRestock(q, { ...ZAMBO, npc: /^zambo$/i }, 'karamjan rum', 1);
        }
        if (!held(q, OBJ.slicedBanana)) {
            if (!held(q, OBJ.banana)) await pickBanana(q);
            await useOn(q, [OBJ.knife], [OBJ.banana], () => held(q, OBJ.slicedBanana) > 0, 'knife on the banana');
        }
        await useOn(q, [OBJ.slicedBanana], [OBJ.rum], () => held(q, OBJ.bananaRum) > 0, 'sliced banana into the rum');
    }
    await useOnNpc(q, [OBJ.bananaRum], /^tinsay$/i, TINSAY, [], done, 'banana rum to Tinsay');
}

async function pickBanana(q: Quest): Promise<void> {
    await go(q, PLANTATION, 3);
    const t0 = tickNow(q.sdk);
    while (!held(q, OBJ.banana) && tickNow(q.sdk) - t0 < 600) {
        await q.sdk.scanNearbyLocs(15).catch(() => undefined);
        const tree = (q.sdk.getNearbyLocs() ?? []).filter((l) => BANANA_TREES.has(l.id) && l.reachable !== false).sort((a, b) => a.distance - b.distance)[0];
        if (!tree) {
            await q.sdk.waitForTicks(10);
            continue;
        }
        await q.sdk.sendInteractLoc(tree.x, tree.z, tree.id, 1);
        await untilTicks(q.sdk, (s) => held(q, OBJ.banana) > 0 || !!s.dialog?.isOpen, 12);
        await closeDialogs(q);
    }
    if (!held(q, OBJ.banana)) throw new Error('tbwt: no banana from the plantation');
}

/** A monkey shot (they dodge melee during the quest), Tamayu skins it, seaweed in the skin. */
export async function sandwich(q: Quest, done: () => Promise<boolean>): Promise<void> {
    if (!held(q, OBJ.sandwich)) {
        if (!held(q, OBJ.monkeySkin)) {
            if (!held(q, OBJ.monkeyCorpse)) await shootMonkey(q);
            await useOnNpc(q, [OBJ.monkeyCorpse], /^tamayu$/i, TAMAYU, [], () => held(q, OBJ.monkeySkin) > 0, 'monkey corpse to Tamayu');
        }
        if (!held(q, OBJ.seaweed)) await pickSeaweed(q);
        await useOn(q, [OBJ.seaweed], [OBJ.monkeySkin], () => held(q, OBJ.sandwich) > 0, 'seaweed into the monkey skin');
    }
    await useOnNpc(q, [OBJ.sandwich], /^tinsay$/i, TINSAY, [], done, 'sandwich to Tinsay');
}

async function shootMonkey(q: Quest): Promise<void> {
    const bow = inv(q).find((i) => /(long|short)bow$/i.test(i.name)) ?? q.sdk.getEquipment().find((i) => /(long|short)bow$/i.test(i.name));
    if (!bow) throw new Error('tbwt: no bow to shoot a monkey');
    if (inv(q).includes(bow)) await q.bot.equipItem(bow).catch(() => undefined);
    const arrows = inv(q).find((i) => /arrow$/i.test(i.name));
    if (arrows) await q.bot.equipItem(arrows).catch(() => undefined);
    await go(q, MONKEYS, 4);
    const t0 = tickNow(q.sdk);
    try {
        while (!held(q, OBJ.monkeyCorpse) && tickNow(q.sdk) - t0 < 1200) {
            await q.sdk.scanGroundItems(10).catch(() => undefined);
            const corpse = (q.sdk.getState()?.groundItems ?? []).find((g) => g.id === OBJ.monkeyCorpse && g.distance <= 12);
            if (corpse) {
                await q.bot.pickupItem(corpse).catch(() => undefined);
                await q.sdk.waitForTicks(2);
                continue;
            }
            const m = (q.sdk.getNearbyNpcs() ?? []).filter((n) => /^monkey$/i.test(n.name) && !n.inCombat).sort((a, b) => a.distance - b.distance)[0];
            if (!m) {
                await go(q, MONKEYS, 3);
                await q.sdk.waitForTicks(4);
                continue;
            }
            await q.bot.attack(m, 10_000).catch(() => undefined);
            await untilTicks(q.sdk, (s) => !(s.nearbyNpcs ?? []).some((n) => n.index === m.index && (n.hp ?? 1) > 0) || (s.groundItems ?? []).some((g) => g.id === OBJ.monkeyCorpse), 30);
        }
    } finally {
        const w = inv(q).find((i) => /scimitar|longsword|sword|battleaxe|mace|warhammer|whip/i.test(i.name));
        if (w) await q.bot.equipItem(w).catch(() => undefined);
    }
    if (!held(q, OBJ.monkeyCorpse)) throw new Error('tbwt: no monkey corpse after 1200t');
}

async function pickSeaweed(q: Quest): Promise<void> {
    for (let round = 0; round < 3 && !held(q, OBJ.seaweed); round++) {
        for (const s of SEAWEED_SPAWNS) {
            if (held(q, OBJ.seaweed)) break;
            await go(q, s, 3);
            await q.sdk.scanGroundItems(6).catch(() => undefined);
            const g = (q.sdk.getState()?.groundItems ?? []).find((x) => x.id === OBJ.seaweed && x.distance <= 6);
            if (!g) continue;
            await q.bot.pickupItem(g).catch(() => undefined);
            await untilTicks(q.sdk, () => held(q, OBJ.seaweed) > 0, 8);
        }
        if (!held(q, OBJ.seaweed)) await q.sdk.waitForTicks(30);
    }
    if (!held(q, OBJ.seaweed)) throw new Error('tbwt: no seaweed on the west coast');
}

/** Jogre bones burnt (tinderbox, Firemaking 30), smothered in raw karambwanji paste, marinated on a fire. */
export async function marinatedBones(q: Quest, done: () => Promise<boolean>): Promise<void> {
    if (!held(q, OBJ.marinated)) {
        if (!held(q, OBJ.burntBonesPaste)) {
            if (!held(q, OBJ.burntBones)) {
                if (!held(q, OBJ.jogreBones)) await huntJogres(q, () => held(q, OBJ.jogreBones) > 0, 'jogre bones');
                await burnBones(q);
            }
            if (!held(q, OBJ.karambwanjiPaste)) {
                await fishKarambwanji(q, 1);
                await grind(q, OBJ.karambwanji, OBJ.karambwanjiPaste, 'a raw karambwanji');
            }
            await useOn(q, [OBJ.burntBones], [OBJ.karambwanjiPaste], () => held(q, OBJ.burntBonesPaste) > 0, 'the paste on the burnt bones');
        }
        await cookOnFire(q, OBJ.burntBonesPaste, 'the pasted bones');
        if (!held(q, OBJ.marinated)) throw new Error('tbwt: the pasted bones did not marinate');
    }
    await useOnNpc(q, [OBJ.marinated], /^tinsay$/i, TINSAY, [], done, 'marinated bones to Tinsay');
}

/** Bones dropped and lit (light_jogre_bones_inv); the burnt bones land on the fire's tile 25-50 ticks later. */
async function burnBones(q: Quest): Promise<void> {
    if (q.level('firemaking') < 30) throw new Error(`tbwt: burning Jogre bones needs Firemaking 30 (have ${q.level('firemaking')})`);
    for (let attempt = 0; attempt < 4 && !held(q, OBJ.burntBones); attempt++) {
        await closeDialogs(q);
        const t0 = tickNow(q.sdk);
        const at = pos(q);
        if (held(q, OBJ.jogreBones)) await useOn(q, [OBJ.jogreBones], [OBJ.tinderbox], () => !held(q, OBJ.jogreBones) || heard(q, t0, /can't light a fire here/i), 'tinderbox on the jogre bones');
        if (heard(q, t0, /can't light a fire here/i)) {
            await q.bot.walkTo(at.x + 2, at.z, 0).catch(() => undefined);
            continue;
        }
        await untilTicks(q.sdk, () => heard(q, t0, /bones begin to burn/i), 60);
        await untilTicks(q.sdk, () => (q.sdk.getState()?.groundItems ?? []).some((g) => g.id === OBJ.burntBones), 80);
        for (let i = 0; i < 20 && !held(q, OBJ.burntBones); i++) {
            await q.sdk.scanGroundItems(5).catch(() => undefined);
            const g = (q.sdk.getState()?.groundItems ?? []).find((x) => x.id === OBJ.burntBones || x.id === OBJ.jogreBones);
            if (!g) {
                await q.sdk.waitForTicks(5);
                continue;
            }
            await q.bot.pickupItem(g).catch(() => undefined);
            await q.sdk.waitForTicks(2);
            if (held(q, OBJ.jogreBones)) break; // picked the unlit bones back up: light again
        }
    }
    if (!held(q, OBJ.burntBones)) throw new Error(`tbwt: no burnt Jogre bones at ${where(q)}`);
}

// ── run-quest hooks

const inBox = (p: Tile, x0: number, x1: number, z0: number, z1: number) => p.x >= x0 && p.x <= x1 && p.z >= z0 && p.z <= z1;
/**
 * Where run-quest's own Karamja exits do not reach: Timfraku's upstairs (climbTo(0) would pick any ladder) and
 * Brimhaven town (north of its z 3200 Karamja box: a run stopped at the docks had no route home, staging 2026-11-04).
 */
export const inTbwtIsland = (p: Tile) =>
    inHuntCutscene(p) ||
    ((p.level ?? 0) === 1 && inBox(p, 2774, 2790, 3080, 3095)) || ((p.level ?? 0) === 0 && inBox(p, 2690, 2800, 3140, 3240)) || pocketOf(p) !== 'main';

/** Down Timfraku's ladder, and from Brimhaven by Barnaby's boat to Ardougne (lib/jungle-potion.ts leaveJungle). */
export async function leaveTbwt(q: Quest, tile: Tile): Promise<void> {
    await waitOutCutscene(q);
    if (pos(q).level === 1) await q.climbTo(0);
    if (pocketOf(pos(q)) !== 'main' && pocketOf({ ...tile, level: tile.level ?? 0 }) !== pocketOf(pos(q))) await leavePocket(q);
    const { leaveJungle, onIsland } = await import('./jungle-potion');
    if (onIsland({ ...tile })) return;
    if (!inBox(pos(q), 2690, 2800, 3140, 3240) && !onIsland(pos(q))) return;
    // jungle-potion's island box starts at x 2740: the customs officers' side of the docks.
    if (pos(q).x < 2745) await q.bot.walkTo(2772, 3225, 4).catch(() => undefined);
    await leaveJungle(q, tile);
}
