/**
 * Heroes' Quest — two accounts, one per Shield of Arrav gang, each ending in the Heroes' Guild.
 *
 * Content facts (quests/quest_hero/scripts/{quest_hero,hero_journal}.rs2, npcs/{grip,grubor,trobert,
 * garv,charlie_the_cook}.rs2, locs/brimhaven_*.rs2, objs/{fire_feather,oily_fishing_rod}.rs2;
 * areas_heroes_guild/achietties.rs2, area_varrock/{straven,katrine}.rs2, area_brimhaven/
 * alfonse_the_waiter.rs2, area_port_sarim/gerrant.rs2, area_entrana/high_priest_of_entrana.rs2,
 * drop tables/{grip,entrana_firebird}.rs2, skill_fishing/fishing_spots/lavafish.rs2,
 * skill_herblore brew_potion.struct [blamish_oil]; spawns/locs from maps m43_49, m44_52, m44_155,
 * m45_152/153/151; walked locally on qlheroxp1/xb1/xs1, 2026-11-03):
 *
 *   Start (both): Achietties (2903,3510) "I'm a hero, may I apply to join?" -> 1, with 55 QP and
 *   Arrav (either gang), Lost City, Merlin's Crystal, Dragon Slayer done.
 *
 *   Phoenix (%phoenixgang complete)
 *   - Straven at 1 -> 2 (no choice). Alfonse (Shrimp and Parrot, 2793,3188) "Do you sell
 *     Gherkins?" -> 3. The kitchen door (herokitchendoor, 2788,3189) opens to a Phoenix at >= 3.
 *     Charlie (2790,3191) "I'm looking for a gherkin..." -> "I want to steal Scarface Pete's
 *     candlesticks." -> 4. The kitchen's west wall (herokitchenpanel, 2787,3190, Push) opens at
 *     >= 4 into Mr Olbors' garden (guard dogs, not aggressive).
 *   - Pete's side door (pete_sidedoor, 2781,3197) opens only from its north tile (z 3197) or to
 *     the Miscellaneous key used on it. Behind it a small room whose west wall at (2780,3198) is
 *     a snipable_wall (blockrange=no): an arrow slit into the mansion room where Grip comes when
 *     lured. Grip (lvl 22, 25hp, respawn 100) is attackable only by a Phoenix at >= 4; his death
 *     with a Phoenix aggressor at 4 -> 5, and drops Grips' keyring (obj_addall: anyone sees it,
 *     lootdrop lifetime). Fire Bolt through the slit (2780,3198 -> 2777,3198) lands.
 *   - With 5, a candlestick (from the partner) to Straven -> 6 + Thieves' armband.
 *
 *   Black Arm (%blackarmgang complete)
 *   - Katrine at 1: "Is there any way I can get the rank of master thief?" -> 7. Grubor's door
 *     (grubordoor, 2811,3170): "Four leaved clover." -> 8, then it opens to a Black Arm. Trobert
 *     (2806,3174) "So can you help me get Scarface Pete's candlesticks?" -> "I volunteer to
 *     undertake that mission!" -> 9 + Id papers.
 *   - Garv's door (garvdoor, 2774,3187): wearing a black full helm, platebody and platelegs with
 *     the papers held -> 10; then it opens to a Black Arm. Grip (2774,3192): talking hands the
 *     papers -> 11; "So what do my duties involve?" then "Anything I can do now?" gives the
 *     Miscellaneous key (tradeable) once.
 *   - Grip's cupboard (gripcbshut, 2775,3196) with a pirate guard within 4: "He won't notice me
 *     having a quick look." walks Grip to (2777,3198), in line with the slit, for a few ticks.
 *   - Grips' keyring on the treasure door (pete_treasuredoor, 2764,3197, from 2763,3197) at >= 11;
 *     the chest inside (2766,3199: Open, then Search) gives two candlesticks -> 12. One to the
 *     Phoenix partner; Katrine takes the other ("I have a candlestick now!") -> 13 + armband.
 *
 *   Feather (both): the Ice Queen (2866,9956, 104hp, not aggressive) always drops Ice gloves. Her
 *   cave is one pocket of White Wolf Mountain's ice caves, entered past the Rock slide (Mining 50
 *   + pickaxe) and five ladders (planIce below). Entrana's monks let gloves through (no
 *   armour_hands category). The firebird (2847,3386, 5hp) drops the feather to its killer;
 *   picking it up without Ice gloves worn burns.
 *   Eel (both): Gerrant (3013,3225) "I want to find out how to catch a lava eel." gives Blamish
 *   snail slime (needs a free slot). Harralander into a vial of water (Unfinished potion), the
 *   slime into that (Herblore 25) = Blamish oil; oil on a fishing rod = Oily fishing rod. The
 *   lava spots (2889-2891,9766, Fishing 53, bait) are behind Taverley dungeon's Dusty-key gate:
 *   the Jailer's key opens Velrak's cell, Velrak gives the Dusty key. A lava eel never burns
 *   (cooking_generic: burnt = cooked), Cooking 53.
 *   End: Achietties takes the feather, the eel and the armband from the PACK -> 15.
 *
 * The journal (hero_journal.rs2) counts items held, worn OR banked (~obj_gettotal), so the
 * item stages read the same after the naked prologue. Achietties checks the pack only.
 *
 * The pair: each account publishes its stage, what it holds and what it waits for in
 * bots/.quest-pairs/heroes-quest/<account>.json. Only the giver calls bot.trade; the receiver
 * stands at MEET (Brimhaven) in serveTrades. The kill is not a trade: the Phoenix side publishes
 * `ready: 'slit'` from the side room, the Black Arm side lures Grip until his keyring drops.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs';
import { join } from 'path';
import type { NearbyNpc, TradeItem } from '../../../sdk/types';
import type { Quest } from './run-quest';
import { driveDialog } from './dialog';
import { tickNow, ticksToMs, untilTicks } from './ticks';
import { findLoc, op, pos, useOn, where } from './plague-city';
import { KATRINE, talkStraven } from './shield-of-arrav';
import { DUSTY_GATE, DUSTY_GATE_OUTSIDE, GATE_TO_LADDER, JAIL_TO_GATE, JAILER_SPAWN, LADDER_DUNGEON, LADDER_SURFACE, LADDER_TO_JAIL, PRISON_DOOR, VELRAK_CELL_DOOR } from './taverley-dragons';
import { fetchDukeShield } from '../duke-shield';
import { depositAllInventory } from '../quest-supplies';

type Tile = { x: number; z: number; level?: number };

export const OBJ = {
    candlestick: 1577,
    armband: 1579,
    iceGloves: 1580,
    slime: 1581,
    blamishOil: 1582,
    feather: 1583,
    idPapers: 1584,
    oilyRod: 1585,
    miscKey: 1586,
    gripKeys: 1588,
    rawEel: 2148,
    eel: 2149,
    harralander: 255,
    unfinished: 97,
    vialOfWater: 227,
    fishingRod: 307,
    bait: 313,
    dustyKey: 1590,
    jailKey: 1591,
    blackHelm: 1165,
    blackBody: 1125,
    blackLegs: 1077,
} as const;

/** Fire Bolt (sdk/spells.ts): Magic 35, 3 air + 1 chaos with a staff of fire. */
const FIRE_BOLT = 1169;

export const ACHIETTIES = { x: 2903, z: 3510 };
const GERRANT = { x: 3013, z: 3225 };
/** Inside the castle-walled kitchen east of Falador west bank (range 2988,3365; Large door on its north side). */
const FALADOR_RANGE = { x: 2989, z: 3366 };

// ── Brimhaven
/** Where the pair trades: the street outside the Shrimp and Parrot. */
export const MEET = { x: 2795, z: 3178 };
const ALFONSE = { x: 2793, z: 3188 };
const KITCHEN_DOOR = { x: 2788, z: 3189 };
const KITCHEN_PANEL = { x: 2787, z: 3190 };
const CHARLIE = { x: 2790, z: 3191 };
const SIDE_DOOR = { x: 2781, z: 3197 };
/** Garden side of the side door. */
const SIDE_DOOR_OUTSIDE = { x: 2781, z: 3196 };
/** In the side room, in line with the arrow slit (2780,3198). */
export const SLIT = { x: 2780, z: 3198 };
const GARV_DOOR = { x: 2774, z: 3187 };
const GRIP_CUPBOARD = { x: 2775, z: 3196 };
/** Beside the cupboard, inside the room Grip is lured into. */
const CUPBOARD_STAND = { x: 2776, z: 3197 };
const TREASURE_DOOR = { x: 2764, z: 3197 };
const TREASURE_OUTSIDE = { x: 2763, z: 3197 };
const CANDLE_CHEST = { x: 2766, z: 3199 };
const GRUBOR_DOOR = { x: 2811, z: 3170 };
/** West of the door: the hideout is east and north of it (Grubor stands on the door's tile). */
const GRUBOR_OUTSIDE = { x: 2810, z: 3170 };
const TROBERT = { x: 2806, z: 3174 };
const PORT_SARIM_SEAMEN = { x: 3028, z: 3216 };
const MUSA_POINT = { x: 2925, z: 3143 };

// ── Ice dungeon (White Wolf Mountain). Climbs move the player ±6400 in z (ladders.rs2).
const ICE_QUEEN = { x: 2866, z: 9956 };
/**
 * Burthorpe's mountain path reaches the ice caves only through the Rock slide (herorockslide,
 * 2838-2839,3517-3518; white_wolf_mountain.rs2: Mine, Mining 50 + a pickaxe, forcemoves you
 * across). Behind it a patch with ladders into pockets A and B. The caves are pockets joined by
 * ladders through more isolated mountain patches (findLongPath over the map, walked on qlheroxs1):
 * the Queen's pocket D is under a patch (2857-2859,3517-3519) reached only from pocket C, which is
 * entered from a patch (2823-2828,3507-3513) above pocket A's far end.
 */
const ROCKSLIDE = { x: 2838, z: 3517 };
/** West of the rockslide, on Burthorpe's side. */
const ROCKSLIDE_WEST = { x: 2837, z: 3517 };
/** Every ladder of the ice caves: surface ones go down, cave ones up (ladders.rs2: ±6400 in z). */
const ICE_LADDERS: Array<Tile & { up: boolean }> = [
    ...[[2848, 3513], [2845, 3516], [2848, 3519], [2857, 3517], [2859, 3519], [2823, 3513], [2824, 3507], [2827, 3510]].map(([x, z]) => ({ x: x!, z: z!, up: false })),
    ...[[2823, 9913], [2824, 9907], [2827, 9910], [2845, 9916], [2848, 9913], [2848, 9919], [2857, 9917], [2859, 9919], [2823, 9930], [2837, 9927], [2845, 9925]].map(([x, z]) => ({ x: x!, z: z!, up: true })),
];
const inBox = (p: Tile, x0: number, x1: number, z0: number, z1: number) => p.x >= x0 && p.x <= x1 && p.z >= z0 && p.z <= z1;
export const inIceDungeon = (p: Tile) => inBox(p, 2816, 2880, 9900, 9980);
/** The mountain patches only a ladder (or the rockslide) reaches: behind the rockslide (S1), S2, S3. */
const onS1 = (p: Tile) => inBox(p, 2840, 2851, 3512, 3521);
const onS2 = (p: Tile) => inBox(p, 2855, 2862, 3514, 3522);
const onS3 = (p: Tile) => inBox(p, 2818, 2830, 3503, 3515);
const onIcePatch = (p: Tile) => (p.level ?? 0) === 0 && (onS1(p) || onS2(p) || onS3(p));

// ── Taverley dungeon, behind the Dusty-key gate
const LAVA_SPOT = { x: 2890, z: 9767 };
/** The dragon pen (west of the gate) and the lava field south-west of it. */
export const inLavaSide = (p: Tile) => inBox(p, 2898, 2923, 9790, 9815) || inLavaField(p);
const inLavaField = (p: Tile) => inBox(p, 2875, 2910, 9750, 9789);
const inTaverleyDungeon = (p: Tile) => inBox(p, 2860, 2960, 9670, 9850);

// ── Brimhaven buildings walkTo cannot leave (their doors only open by quest state)
const inMansion = (p: Tile) => inBox(p, 2759, 2779, 3188, 3200);
const inSideRoom = (p: Tile) => inBox(p, 2780, 2782, 3197, 3199);
const inGarden = (p: Tile) => inBox(p, 2780, 2786, 3189, 3196) || inBox(p, 2783, 2790, 3194, 3199);
const inKitchen = (p: Tile) => inBox(p, 2788, 2792, 3190, 3193);
const inBlackArmHq = (p: Tile) => inBox(p, 2811, 2816, 3166, 3173) || inBox(p, 2805, 2815, 3174, 3178);
/**
 * West Brimhaven (the restaurant, the mansion, the hideout) behind the members' double gate at
 * (2816,3182): walkTo's route east to Musa Point stalls in the alley at (2804,3181) instead of
 * taking it (local, 2026-11-03), so the gate is crossed explicitly both ways.
 */
export const inBrimhavenWest = (p: Tile) => (p.level ?? 0) === 0 && inBox(p, 2760, 2815, 3150, 3200);
const GATE_WEST = { x: 2814, z: 3182 };
const GATE_EAST = { x: 2818, z: 3182 };
const inBrimhavenQuestRooms = (p: Tile) => (p.level ?? 0) === 0 && (inMansion(p) || inSideRoom(p) || inGarden(p) || inKitchen(p) || inBlackArmHq(p));

/**
 * Anywhere this quest leaves an account that run-quest's walk cannot route out of. The lava field
 * only, not the dragon pen in front of it: blue-dragon-scales.ts walks its own way out of the pen.
 */
export const inHeroesArea = (p: Tile) => inIceDungeon(p) || onIcePatch(p) || inLavaField(p) || inBrimhavenWest(p);

export type Gang = 'phoenix' | 'blackarm';
type Wanted = 'misckey' | 'candle';

export interface PairState {
    account: string;
    gang: Gang;
    partner: string;
    stage: string;
    has: { misckey: number; candle: number; keys: number };
    serving: Wanted | null;
    /** The Phoenix side at the arrow slit, staff on, waiting for Grip. */
    ready: 'slit' | null;
    beat: number;
}

export interface Pair {
    account: string;
    gang: Gang;
    partner: string;
}

const PAIR_DIR = () => join(process.cwd(), 'bots', '.quest-pairs', 'heroes-quest');
/** Partner silence (no new beat or stage) a hand-off waits out before failing. */
const PARTNER_SILENT_TICKS = 4000;
/** Max ticks one hand-off waits on a partner that is still making progress (~100 min on prod). */
const PARTNER_WAIT_TICKS = 20000;
const UNDERGROUND_Z = 6400;
let beat = 0;

const held = (q: Quest, id: number) =>
    [...q.sdk.getInventory(), ...q.sdk.getEquipment()].filter((i) => i.id === id).reduce((n, i) => n + (i.count ?? 1), 0);
export const holds = (q: Quest, id: number) => held(q, id) > 0;
const banked = (q: Quest, id: number) => q.sdk.getBankItems().some((b) => b.id === id);

export function publish(q: Quest, pair: Pair, serving: Wanted | null = null, ready: 'slit' | null = null): void {
    const state: PairState = {
        account: pair.account,
        gang: pair.gang,
        partner: pair.partner,
        stage: q.stage,
        has: { misckey: held(q, OBJ.miscKey), candle: held(q, OBJ.candlestick), keys: held(q, OBJ.gripKeys) },
        serving,
        ready,
        beat: ++beat,
    };
    try {
        mkdirSync(PAIR_DIR(), { recursive: true });
        const path = join(PAIR_DIR(), `${pair.account.toLowerCase()}.json`);
        writeFileSync(`${path}.tmp`, JSON.stringify(state) + '\n');
        renameSync(`${path}.tmp`, path);
    } catch (err) {
        q.log(`heroes: could not publish the pair state: ${(err as Error).message}`);
    }
}

export function readPartner(pair: Pair): PairState | null {
    const path = join(PAIR_DIR(), `${pair.partner.toLowerCase()}.json`);
    if (!existsSync(path)) return null;
    try {
        return JSON.parse(readFileSync(path, 'utf-8')) as PairState;
    } catch {
        return null;
    }
}

const describePartner = (p: PairState | null) =>
    p ? `${p.account} at ${p.stage}${p.serving ? `, waiting for ${p.serving}` : ''}${p.ready ? `, ready at the ${p.ready}` : ''} (misc key ${p.has.misckey}, candlesticks ${p.has.candle})` : 'no pair file yet';

/** Ticks since the partner's pair file last changed, tracked across polls. */
function silence(q: Quest, pair: Pair): () => number {
    let last = JSON.stringify(readPartner(pair));
    let at = tickNow(q.sdk);
    return () => {
        const now = JSON.stringify(readPartner(pair));
        // No pair file yet: a partner still queued for its start turn (two fleet-wide every 5 min)
        // is not a partner that stopped; only PARTNER_WAIT_TICKS bounds that wait.
        if (now !== last || now === 'null') {
            last = now;
            at = tickNow(q.sdk);
        }
        return tickNow(q.sdk) - at;
    };
}

const nameRe = (name: string) => new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i');

/** Stand at MEET and take trades from the partner until `done`. */
async function receive(q: Quest, pair: Pair, what: Wanted, item: RegExp, done: () => boolean): Promise<void> {
    if (done()) return;
    await toBrimhaven(q, MEET, 3);
    const t0 = tickNow(q.sdk);
    const quiet = silence(q, pair);
    let lastNote = -Infinity;
    q.log(`heroes: at the meeting spot, waiting for ${pair.partner} to trade the ${what}`);
    while (!done()) {
        const waited = tickNow(q.sdk) - t0;
        if (waited > PARTNER_WAIT_TICKS || quiet() > PARTNER_SILENT_TICKS) {
            publish(q, pair);
            throw new Error(`heroes: ${pair.partner} did not trade the ${what} in ${waited}t (silent ${quiet()}t; ${describePartner(readPartner(pair))})`);
        }
        if (waited - lastNote >= 300) {
            q.log(`heroes: waiting for the ${what} ${waited}t; partner ${describePartner(readPartner(pair))}`);
            lastNote = waited;
        }
        publish(q, pair, what);
        await q.bot
            .serveTrades({
                from: nameRe(pair.partner),
                give: [],
                accept: (offer: TradeItem[]) => (offer ?? []).some((i) => item.test(i.name ?? '')),
                maxTrades: 1,
                timeout: ticksToMs(100),
                tradeTimeout: ticksToMs(200),
            })
            .catch((e) => q.log(`heroes: serveTrades: ${(e as Error).message}`));
        await q.sdk.waitForTicks(1);
    }
    publish(q, pair);
    q.log(`heroes: received the ${what} from ${pair.partner} after ${tickNow(q.sdk) - t0}t`);
}

/** Trade `give` to the partner at MEET once its pair file says it is serving `what` and it is in view. */
async function hand(q: Quest, pair: Pair, what: Wanted, give: { item: RegExp; amount: number }, delivered: (p: PairState) => boolean): Promise<void> {
    const t0 = tickNow(q.sdk);
    await toBrimhaven(q, MEET, 3);
    const quiet = silence(q, pair);
    let lastNote = -Infinity;
    for (;;) {
        const partner = readPartner(pair);
        if (partner && delivered(partner)) {
            q.log(`heroes: ${pair.partner} already has the ${what}`);
            return;
        }
        const waited = tickNow(q.sdk) - t0;
        if (waited > PARTNER_WAIT_TICKS || quiet() > PARTNER_SILENT_TICKS) throw new Error(`heroes: could not hand the ${what} to ${pair.partner} in ${waited}t (${describePartner(partner)})`);
        if (waited - lastNote >= 300) {
            q.log(`heroes: holding the ${what} for ${pair.partner} ${waited}t; partner ${describePartner(partner)}`);
            lastNote = waited;
        }
        publish(q, pair);
        const seen = q.sdk.findNearbyPlayer(nameRe(pair.partner));
        if (partner?.serving === what && seen) {
            const before = q.sdk.getInventory().filter((i) => give.item.test(i.name)).length;
            const res = await q.bot.trade(seen, { give: [give], want: [], requestTimeout: ticksToMs(60), timeout: ticksToMs(200), retryOnBusy: true });
            q.log(`heroes: trade ${what} -> ${pair.partner}: ${res.success ? 'done' : `failed (${res.reason ?? res.message})`}`);
            const after = q.sdk.getInventory().filter((i) => give.item.test(i.name)).length;
            if (res.success || after < before) {
                publish(q, pair);
                return;
            }
        }
        await q.sdk.waitForTicks(10);
    }
}

// ── travel

/** Pay the Port Sarim seamen (30gp) to Musa Point, down the gangplank. */
async function sailToKaramja(q: Quest): Promise<void> {
    if (q.count('coins') < 30) throw new Error(`heroes: ${q.count('coins')} coins, the Karamja fare is 30`);
    const t0 = tickNow(q.sdk);
    const onIsland = () => inBox(pos(q), 2740, 2990, 2880, 3240);
    for (let i = 0; i < 3 && !onIsland(); i++) {
        await q.talk(/^(captain tobias|seaman \w+)$/i, [/yes please/i], PORT_SARIM_SEAMEN);
        await untilTicks(q.sdk, onIsland, 30);
    }
    if (!onIsland()) throw new Error(`heroes: the boat to Karamja never sailed (at ${where(q)}, coins ${q.count('coins')})`);
    await driveDialog(q.sdk, [], { ticks: 10 });
    for (let i = 0; i < 5 && pos(q).level !== 0; i++) {
        await q.sdk.scanNearbyLocs(8).catch(() => undefined);
        const plank = q.sdk.findNearbyLoc(/gangplank/i, { withOption: /cross/i });
        if (plank) await q.bot.interactLoc(plank, /cross/i).catch(() => undefined);
        await untilTicks(q.sdk, (s) => (s.player?.level ?? 1) === 0, 10);
    }
    q.log(`heroes: sailed Port Sarim -> Karamja in ${tickNow(q.sdk) - t0}t`);
}

/** A Brimhaven tile from anywhere: the Musa Point boat when on the mainland, then the jungle road. */
export async function toBrimhaven(q: Quest, tile: Tile, tolerance = 3): Promise<void> {
    if (!inBox(pos(q), 2740, 2990, 2880, 3240)) {
        await q.goTo(PORT_SARIM_SEAMEN, 6);
        await sailToKaramja(q);
        await q.goTo(MUSA_POINT, 6);
    }
    // Inside a quest room with the target in another: out to the street first.
    if (inBrimhavenQuestRooms(pos(q)) && !sameRoom(pos(q), tile)) await leaveBrimhavenRooms(q);
    if (inBrimhavenWest({ ...tile, level: tile.level ?? 0 }) && !inBrimhavenWest(pos(q))) await crossBrimhavenGate(q, true);
    if (inBrimhavenWest(pos(q))) {
        // Inside the west side: a plain walk (run-quest's goTo would take us back out through the gate).
        const res = await q.bot.walkTo(tile.x, tile.z, tolerance);
        if (!res.success && Math.max(Math.abs(pos(q).x - tile.x), Math.abs(pos(q).z - tile.z)) > tolerance) {
            throw new Error(`heroes: walk to (${tile.x},${tile.z}) in Brimhaven failed: ${res.message} (${where(q)})`);
        }
        return;
    }
    await q.goTo(tile, tolerance);
}

/** Through the members' double gate at (2816,3182): it may stand open (other players, 500 ticks). */
export async function crossBrimhavenGate(q: Quest, toWest: boolean): Promise<void> {
    const done = () => inBrimhavenWest(pos(q)) === toWest;
    if (done()) return;
    const near = toWest ? GATE_EAST : GATE_WEST;
    const far = toWest ? GATE_WEST : GATE_EAST;
    if (inBrimhavenWest(pos(q))) {
        // From the alleys the walk to the gate is the stretch walkTo stalls on: the street north first.
        await q.bot.walkTo(2805, 3183, 1).catch(() => undefined);
    }
    await q.bot.walkTo(near.x, near.z, 1).catch(() => undefined);
    for (let attempt = 1; attempt <= 5 && !done(); attempt++) {
        await q.sdk.scanNearbyLocs(5).catch(() => undefined);
        const gate = (q.sdk.getNearbyLocs() ?? []).find((l) => l.x === 2816 && (l.z === 3182 || l.z === 3183) && l.optionsWithIndex.some((o) => /^open$/i.test(o.text)));
        if (gate) {
            await q.sdk.sendInteractLoc(gate.x, gate.z, gate.id, gate.optionsWithIndex.find((o) => /^open$/i.test(o.text))!.opIndex);
            await q.sdk.waitForTicks(3);
        }
        await q.sdk.sendWalk(far.x, far.z);
        await untilTicks(q.sdk, done, 12);
    }
    if (!done()) throw new Error(`heroes: could not get through Brimhaven's gate (${where(q)})`);
}

const sameRoom = (a: Tile, b: Tile) =>
    [inMansion, inSideRoom, inGarden, inKitchen, inBlackArmHq].some((f) => f(a) && f({ ...b, level: b.level ?? 0 }));

/** The door/panel at `at`, op'd until `done` (doors that teleport you through). */
async function through(q: Quest, at: Tile, name: RegExp, opt: RegExp, done: () => boolean, label: string, choices: Array<RegExp | string> = []): Promise<string> {
    return op(q, at, name, opt, done, label, choices, 15);
}

/** Out of the mansion, treasure room, side room, garden, kitchen or Black Arm HQ to the street. */
export async function leaveBrimhavenRooms(q: Quest): Promise<void> {
    const p = () => pos(q);
    if (inBox(p(), 2764, 2775, 3197, 3200)) {
        // The treasure room: its door lets you out from its own tile and locks behind you.
        await q.bot.walkTo(TREASURE_DOOR.x, TREASURE_DOOR.z, 0).catch(() => undefined);
        if (inBox(p(), 2764, 2775, 3197, 3200)) await through(q, TREASURE_DOOR, /^door$/i, /^open$/i, () => !inBox(p(), 2764, 2775, 3197, 3200), 'out of the treasure room');
    }
    if (inMansion(p())) {
        await q.bot.walkTo(GARV_DOOR.x, GARV_DOOR.z + 1, 0).catch(() => undefined);
        await through(q, GARV_DOOR, /^door$/i, /^open$/i, () => !inMansion(p()), 'out of the mansion', [/.*/]);
    }
    if (inSideRoom(p())) {
        await q.bot.walkTo(SIDE_DOOR.x, SIDE_DOOR.z, 0).catch(() => undefined);
        if (inSideRoom(p())) await through(q, SIDE_DOOR, /^door$/i, /^open$/i, () => !inSideRoom(p()), 'out of the side room');
    }
    if (inGarden(p())) {
        await q.bot.walkTo(KITCHEN_PANEL.x - 1, KITCHEN_PANEL.z, 0).catch(() => undefined);
        await through(q, KITCHEN_PANEL, /^wall$/i, /^push$/i, () => !inGarden(p()), 'through the kitchen wall');
    }
    if (inKitchen(p())) {
        await q.bot.walkTo(KITCHEN_DOOR.x, KITCHEN_DOOR.z + 1, 0).catch(() => undefined);
        await through(q, KITCHEN_DOOR, /^door$/i, /^open$/i, () => !inKitchen(p()), 'out of the kitchen');
    }
    if (inBlackArmHq(p())) {
        await q.bot.walkTo(GRUBOR_DOOR.x, GRUBOR_DOOR.z, 0).catch(() => undefined);
        await through(q, GRUBOR_DOOR, /^door$/i, /^open$/i, () => !inBlackArmHq(p()), 'out of the Black Arm hideout', [/.*/]);
    }
}

/** run-quest's goTo and prologue: out of anywhere this quest leaves an account stranded. */
export async function leaveHeroesAreas(q: Quest): Promise<void> {
    if (inBrimhavenQuestRooms(pos(q))) await leaveBrimhavenRooms(q);
    if (inBrimhavenWest(pos(q))) await crossBrimhavenGate(q, false);
    if (inIceDungeon(pos(q)) || onIcePatch(pos(q))) await leaveIceDungeon(q);
    if (inLavaSide(pos(q))) await leaveTaverley(q);
}

// ── Phoenix gang

export async function startAtAchietties(q: Quest): Promise<void> {
    await q.talk(/^achietties$/i, [/i'm a hero/i, /start looking for all those things/i], ACHIETTIES);
}

export async function askStraven(q: Quest): Promise<void> {
    await talkStraven(q, []);
}

export async function askAlfonse(q: Quest): Promise<void> {
    await toBrimhaven(q, ALFONSE, 4);
    await q.talk(/^alfonse the waiter$/i, [/do you sell gherkins/i]);
}

/** Into the kitchen (a Phoenix at >= 3), Charlie. */
export async function askCharlie(q: Quest): Promise<void> {
    await enterKitchen(q);
    await q.talk(/^charlie the cook$/i, [/looking for a gherkin/i, /steal scarface pete's candlesticks/i]);
}

async function enterKitchen(q: Quest): Promise<void> {
    if (inKitchen(pos(q))) return;
    await toBrimhaven(q, { x: KITCHEN_DOOR.x, z: KITCHEN_DOOR.z }, 0);
    await through(q, KITCHEN_DOOR, /^door$/i, /^open$/i, () => inKitchen(pos(q)), 'into the kitchen');
}

/** Kitchen -> garden -> side room (the Miscellaneous key on the side door), at the slit. */
async function toSlit(q: Quest): Promise<void> {
    if (!inSideRoom(pos(q))) {
        if (!inGarden(pos(q))) {
            await enterKitchen(q);
            await through(q, KITCHEN_PANEL, /^wall$/i, /^push$/i, () => inGarden(pos(q)), 'through the kitchen wall');
        }
        await q.bot.walkTo(SIDE_DOOR_OUTSIDE.x, SIDE_DOOR_OUTSIDE.z, 0).catch(() => undefined);
        await useOn(q, OBJ.miscKey, SIDE_DOOR, /^door$/i, () => inSideRoom(pos(q)), 'the Miscellaneous key on the side door', 15);
    }
    await stepTo(q, SLIT);
}

/** A plain client walk onto one tile (a few tries). */
async function stepTo(q: Quest, t: Tile): Promise<void> {
    for (let i = 0; i < 4 && (pos(q).x !== t.x || pos(q).z !== t.z); i++) {
        await q.sdk.sendWalk(t.x, t.z);
        await untilTicks(q.sdk, () => pos(q).x === t.x && pos(q).z === t.z, 10);
    }
}

const grip = (q: Quest): NearbyNpc | undefined => (q.sdk.getNearbyNpcs() ?? []).find((n) => /^grip$/i.test(n.name));
/** Grip in the room behind the slit, where a bolt through it lands. */
const gripAtSlit = (n: NearbyNpc | undefined) => !!n && n.z >= 3197 && n.x >= 2776 && n.x <= 2779;
/** Black Arm stages once Grip's keyring has been used (the chest is looted). */
const BLACKARM_PAST_KILL = new Set(['b_chest', 'b_armband', 'b_gloves', 'b_feather', 'b_slime', 'b_rod', 'b_raw', 'b_items', 'complete']);
const keysOnGround = (q: Quest) => (q.sdk.getState()?.groundItems ?? []).find((g) => g.id === OBJ.gripKeys);

/**
 * Phoenix at 4: the Miscellaneous key from the partner, the staff on, at the slit; Fire Bolt
 * whenever the partner's lure brings Grip in line, until his keyring is on the floor.
 */
export async function killGrip(q: Quest, pair: Pair): Promise<void> {
    publish(q, pair);
    if (!holds(q, OBJ.miscKey) && !inSideRoom(pos(q))) await receive(q, pair, 'misckey', /^miscellaneous key$/i, () => holds(q, OBJ.miscKey));
    const staff = q.sdk.getInventory().find((i) => /^(staff of fire|fire battlestaff)$/i.test(i.name));
    if (staff) await q.bot.equipItem(staff);
    if (!q.sdk.getEquipment().some((i) => /^(staff of fire|fire battlestaff)$/i.test(i.name))) throw new Error('heroes: no fire staff to wield for Fire Bolt');
    await toSlit(q);
    q.log(`heroes: at the arrow slit ${where(q)}; waiting for ${pair.partner} to lure Grip`);
    const t0 = tickNow(q.sdk);
    const quiet = silence(q, pair);
    let casts = 0;
    let lastNote = -Infinity;
    let sawKeys = false;
    while (!sawKeys) {
        const waited = tickNow(q.sdk) - t0;
        if (waited > PARTNER_WAIT_TICKS || quiet() > PARTNER_SILENT_TICKS) {
            publish(q, pair);
            throw new Error(`heroes: Grip never came to the slit in ${waited}t (${casts} casts; ${describePartner(readPartner(pair))})`);
        }
        if (waited - lastNote >= 300) {
            q.log(`heroes: at the slit ${waited}t, ${casts} casts; partner ${describePartner(readPartner(pair))}`);
            lastNote = waited;
        }
        publish(q, pair, null, 'slit');
        if (q.count('air rune') < 3 || q.count('chaos rune') < 1) throw new Error(`heroes: out of Fire Bolt runes after ${casts} casts`);
        // The partner can pick the keyring up before we see it on the floor.
        const partner = readPartner(pair);
        if (keysOnGround(q) || (partner && (partner.has.keys > 0 || BLACKARM_PAST_KILL.has(partner.stage)))) {
            sawKeys = true;
            break;
        }
        const g = grip(q);
        if (gripAtSlit(g)) {
            if (pos(q).x !== SLIT.x || pos(q).z !== SLIT.z) await stepTo(q, SLIT);
            const res = await q.bot.castSpell(g!, FIRE_BOLT, ticksToMs(8)).catch((e) => ({ success: false, message: (e as Error).message }));
            casts++;
            if (!res.success && casts % 5 === 1) q.log(`heroes: Fire Bolt on Grip #${casts}: ${res.message}`);
            continue;
        }
        await q.sdk.waitForTicks(1);
    }
    publish(q, pair);
    q.log(`heroes: Grip is down (${casts} casts, ${tickNow(q.sdk) - t0}t); his keyring is on the floor`);
    // Stay out of the way until the partner has the keyring (it is theirs to pick up).
    await untilTicks(q.sdk, () => !keysOnGround(q), 100);
}

/** Phoenix at 5: a candlestick from the partner, to Straven. */
export async function candleToStraven(q: Quest, pair: Pair): Promise<void> {
    publish(q, pair);
    if (!holds(q, OBJ.candlestick)) await receive(q, pair, 'candle', /^pete's candlestick$/i, () => holds(q, OBJ.candlestick));
    await leaveHeroesAreas(q);
    await talkStraven(q, []);
}

// ── Black Arm gang

export async function askKatrine(q: Quest): Promise<void> {
    await q.talk(/^katrine$/i, [/rank of master thief/i], KATRINE);
}

/** Grubor, through the hideout door: the password. */
export async function passwordToGrubor(q: Quest): Promise<void> {
    await toBrimhaven(q, GRUBOR_OUTSIDE, 0);
    for (let attempt = 1; attempt <= 3; attempt++) {
        const door = await findLoc(q, GRUBOR_DOOR, /^door$/i, /^open$/i);
        if (!door) {
            await q.sdk.waitForTicks(3);
            continue;
        }
        await q.sdk.sendInteractLoc(door.x, door.z, door.id, door.optionsWithIndex.find((o) => /^open$/i.test(o.text))!.opIndex);
        await untilTicks(q.sdk, (s) => !!s.dialog?.isOpen, 15);
        const seen = await driveDialog(q.sdk, [/four leaved clover/i], { ticks: 60, log: q.log });
        if (/unbarred|one of the gang/i.test(seen)) return;
        q.log(`heroes: Grubor (attempt ${attempt}): ${seen.slice(0, 160)}`);
    }
}

export async function volunteerToTrobert(q: Quest): Promise<void> {
    if (!inBlackArmHq(pos(q))) {
        await toBrimhaven(q, GRUBOR_OUTSIDE, 0);
        await through(q, GRUBOR_DOOR, /^door$/i, /^open$/i, () => inBlackArmHq(pos(q)), 'into the Black Arm hideout');
    }
    await q.talk(/^trobert$/i, [/help me get scarface pete's candlesticks/i, /i volunteer/i]);
}

const BLACK = [OBJ.blackHelm, OBJ.blackBody, OBJ.blackLegs];
async function wearBlack(q: Quest): Promise<void> {
    for (const id of BLACK) {
        const it = q.sdk.getInventory().find((i) => i.id === id);
        if (it) await q.bot.equipItem(it).catch(() => undefined);
    }
    const worn = BLACK.filter((id) => q.sdk.getEquipment().some((i) => i.id === id)).length;
    if (worn < 3) throw new Error(`heroes: only ${worn}/3 pieces of black armour worn for Garv`);
}

/** In black armour with the papers, past Garv. */
export async function pastGarv(q: Quest): Promise<void> {
    await wearBlack(q);
    await toBrimhaven(q, GARV_DOOR, 0);
    await through(q, GARV_DOOR, /^door$/i, /^open$/i, () => inMansion(pos(q)), "Garv's door", [/.*/]).catch((e) => q.log(`heroes: ${(e as Error).message}`));
}

async function enterMansion(q: Quest): Promise<void> {
    if (inMansion(pos(q))) return;
    await toBrimhaven(q, GARV_DOOR, 0);
    await through(q, GARV_DOOR, /^door$/i, /^open$/i, () => inMansion(pos(q)), 'into the mansion', [/.*/]);
}

/** Papers to Grip, and his Miscellaneous key. */
export async function reportToGrip(q: Quest): Promise<void> {
    await enterMansion(q);
    await q.talk(/^grip$/i, [/what do my duties involve/i, /anything i can do now/i]);
    if (!holds(q, OBJ.miscKey) && !banked(q, OBJ.miscKey)) {
        await q.talk(/^grip$/i, [/what do my duties involve/i, /anything i can do now/i]);
    }
}

/** Partner stages before the kill (it still needs the Miscellaneous key). */
// The stage id at the start is plain 'unstarted' (heroes-quest.ts): missing it here made a Black
// Arm half read a just-started partner as past Grip — "jacklove13 already has the misckey" — and
// go lure with the key still in its pack, deadlocking both halves (2026-11-03).
const PHOENIX_BEFORE_GRIP = new Set(['unstarted', 'p_unstarted', 'p_started', 'p_straven', 'p_alfonse', 'p_charlie']);

/**
 * Black Arm at 11: the Miscellaneous key to the partner, then Grip's cupboard until his keyring
 * drops, the keyring on the treasure door, and the chest's two candlesticks.
 */
export async function lootTreasure(q: Quest, pair: Pair): Promise<void> {
    publish(q, pair);
    const partner = readPartner(pair);
    if (!holds(q, OBJ.gripKeys) && (!partner || (PHOENIX_BEFORE_GRIP.has(partner.stage) && partner.has.misckey === 0))) {
        if (!holds(q, OBJ.miscKey)) await reportToGrip(q);
        await hand(q, pair, 'misckey', { item: /^miscellaneous key$/i, amount: 1 }, (p) => p.has.misckey > 0 || !PHOENIX_BEFORE_GRIP.has(p.stage));
    }
    if (!holds(q, OBJ.gripKeys)) await lureGrip(q, pair);
    // The keyring on the treasure door from the corridor west of it; the room is entered there.
    const inTreasure = () => inBox(pos(q), 2764, 2775, 3197, 3200);
    if (!inTreasure()) {
        await enterMansion(q);
        await q.bot.walkTo(TREASURE_OUTSIDE.x, TREASURE_OUTSIDE.z, 0).catch(() => undefined);
        await useOn(q, OBJ.gripKeys, TREASURE_DOOR, /^door$/i, inTreasure, "Grips' keyring on the treasure room door", 15);
    }
    for (let attempt = 1; attempt <= 5 && held(q, OBJ.candlestick) < 2; attempt++) {
        const open = await findLoc(q, CANDLE_CHEST, /^chest$/i, /^search$/i);
        const loc = open ?? (await findLoc(q, CANDLE_CHEST, /^chest$/i, /^open$/i));
        if (!loc) {
            await q.sdk.waitForTicks(3);
            continue;
        }
        const opt = loc.optionsWithIndex.find((o) => /^(search|open)$/i.test(o.text))!;
        // A raw op: walkTo would route out of the room (its door is shut behind us).
        await q.sdk.sendInteractLoc(loc.x, loc.z, loc.id, opt.opIndex);
        await untilTicks(q.sdk, (s) => !!s.dialog?.isOpen || held(q, OBJ.candlestick) >= 2, 15);
        if (q.sdk.getDialog()?.isOpen) await driveDialog(q.sdk, [], { ticks: 20 });
    }
    if (held(q, OBJ.candlestick) < 1) throw new Error(`heroes: no candlestick from the treasure chest (${where(q)})`);
    q.log(`heroes: ${held(q, OBJ.candlestick)} candlesticks from Pete's chest`);
    await leaveBrimhavenRooms(q);
}

/** Open Grip's cupboard (a guard objects, we insist: Grip walks over) until his keyring drops; pick it up. */
async function lureGrip(q: Quest, pair: Pair): Promise<void> {
    const t0 = tickNow(q.sdk);
    const quiet = silence(q, pair);
    let lures = 0;
    let lastNote = -Infinity;
    await enterMansion(q);
    await q.bot.walkTo(CUPBOARD_STAND.x, CUPBOARD_STAND.z, 0).catch(() => undefined);
    while (!holds(q, OBJ.gripKeys)) {
        const waited = tickNow(q.sdk) - t0;
        const partner = readPartner(pair);
        if (waited > PARTNER_WAIT_TICKS || quiet() > PARTNER_SILENT_TICKS) throw new Error(`heroes: no keyring after ${lures} lures in ${waited}t (${describePartner(partner)})`);
        if (waited - lastNote >= 300) {
            q.log(`heroes: by Grip's cupboard ${waited}t, ${lures} lures; partner ${describePartner(partner)}`);
            lastNote = waited;
        }
        publish(q, pair);
        const keys = keysOnGround(q);
        if (keys) {
            const res = await q.bot.pickupItem(keys).catch((e) => ({ success: false, message: (e as Error).message }));
            if (!res.success) q.log(`heroes: pick up Grips' keyring: ${res.message}`);
            await untilTicks(q.sdk, () => holds(q, OBJ.gripKeys), 8);
            continue;
        }
        if (partner?.ready !== 'slit') {
            await q.sdk.waitForTicks(5);
            continue;
        }
        const g = grip(q);
        // Grip is respawning or already over by the slit: wait rather than lure again.
        if (!g || gripAtSlit(g)) {
            await q.sdk.waitForTicks(2);
            continue;
        }
        const cb = (await findLoc(q, GRIP_CUPBOARD, /^cupboard$/i, /^search$/i)) ?? (await findLoc(q, GRIP_CUPBOARD, /^cupboard$/i, /^open$/i));
        if (!cb) {
            await q.sdk.waitForTicks(3);
            continue;
        }
        lures++;
        await q.sdk.sendInteractLoc(cb.x, cb.z, cb.id, cb.optionsWithIndex.find((o) => /^(search|open)$/i.test(o.text))!.opIndex);
        await untilTicks(q.sdk, (s) => !!s.dialog?.isOpen, 10);
        if (q.sdk.getDialog()?.isOpen) await driveDialog(q.sdk, [/won't notice me/i], { ticks: 30, done: () => !!keysOnGround(q) });
        // Back on the stand: the cupboard's approach tile can be one off.
        await untilTicks(q.sdk, () => !!keysOnGround(q), 12);
    }
    q.log(`heroes: picked up Grips' keyring after ${lures} lures (${tickNow(q.sdk) - t0}t)`);
}

/** Black Arm at 12: one candlestick to the partner (unless it already has its armband), then Katrine. */
/** Phoenix stages that still need a candlestick from us (the kill done, Straven not yet paid). */
const PHOENIX_BEFORE_ARMBAND = new Set(['unstarted', 'p_unstarted', 'p_started', 'p_straven', 'p_alfonse', 'p_charlie', 'p_grip']);
/** The partner has its candlestick, or is past needing one. */
const phoenixHasCandle = (p: PairState) => p.has.candle > 0 || !PHOENIX_BEFORE_ARMBAND.has(p.stage);

export async function candleToKatrine(q: Quest, pair: Pair): Promise<void> {
    publish(q, pair);
    const partner = readPartner(pair);
    if (held(q, OBJ.candlestick) >= 2 || !partner || !phoenixHasCandle(partner)) {
        await hand(q, pair, 'candle', { item: /^pete's candlestick$/i, amount: 1 }, phoenixHasCandle);
    }
    await leaveHeroesAreas(q);
    await q.talk(/^katrine$/i, [/i have a candlestick now/i], KATRINE);
}

/**
 * Black Arm, any later stage: a Phoenix partner still at p_grip waiting on a candlestick we hold
 * (a resumed run, or a hand-off that went wrong) gets it before we go on.
 */
export async function settleCandle(q: Quest, pair: Pair): Promise<void> {
    if (pair.gang !== 'blackarm' || !holds(q, OBJ.candlestick)) return;
    const partner = readPartner(pair);
    if (!partner || phoenixHasCandle(partner)) return;
    q.log(`heroes: ${pair.partner} is still owed a candlestick`);
    await hand(q, pair, 'candle', { item: /^pete's candlestick$/i, amount: 1 }, phoenixHasCandle);
}

// ── Feather (both)

const FOOD = /^(shark|lobster|swordfish|monkfish|bass|tuna|trout|salmon)$/i;
async function eatIfLow(q: Quest, below = 0.5): Promise<void> {
    const p = q.sdk.getState()?.player;
    if (!p || p.hp > (p.maxHp ?? 10) * below) return;
    const food = q.sdk.getInventory().find((i) => FOOD.test(i.name));
    if (food) await q.bot.eatFood(food).catch(() => undefined);
}

/** Kill the nearest `npc` until `done` (bounded); eats below half hp. */
async function kill(q: Quest, npc: RegExp, done: () => boolean, ticks: number, label: string): Promise<boolean> {
    const t0 = tickNow(q.sdk);
    let attacks = 0;
    while (!done() && tickNow(q.sdk) - t0 < ticks) {
        if (q.sdk.getDialog()?.isOpen) await driveDialog(q.sdk, [], { ticks: 6 });
        await eatIfLow(q);
        const me = q.sdk.getState()?.player;
        const target = (q.sdk.getNearbyNpcs() ?? []).filter((n) => npc.test(n.name) && n.reachable !== false).sort((a, b) => a.distance - b.distance)[0];
        if (!target) {
            await q.sdk.waitForTicks(4);
            continue;
        }
        if (!me?.combat?.inCombat || me.combat.targetIndex !== target.index) {
            attacks++;
            const res = await q.bot.attack(target, ticksToMs(20)).catch((e) => ({ success: false, message: (e as Error).message }));
            if (!res.success && attacks % 5 === 1) q.log(`heroes: attack ${label} #${attacks}: ${res.message}`);
        }
        await q.sdk.waitForTicks(2);
    }
    return done();
}

/** Down (or up) the ladder near `at` (approaching it is part of the op). */
async function climb(q: Quest, at: Tile, up: boolean): Promise<void> {
    const opt = up ? /climb-up/i : /climb-down/i;
    const wasUnder = pos(q).z >= UNDERGROUND_Z;
    const moved = () => (pos(q).z >= UNDERGROUND_Z) !== wasUnder;
    for (let i = 0; i < 4 && !moved(); i++) {
        await q.sdk.scanNearbyLocs(15).catch(() => undefined);
        const ladder = (q.sdk.getNearbyLocs() ?? []).find((l) => /ladder/i.test(l.name) && l.x === at.x && l.z === at.z);
        if (!ladder) {
            await q.bot.walkTo(at.x + 1, at.z, 1).catch(() => undefined);
            continue;
        }
        // A raw op: bot.interactLoc refuses these ladders ("destination tile is blocked"); the
        // server walks us to their approach side (forceapproach east).
        const o = ladder.optionsWithIndex.find((x) => opt.test(x.text));
        if (!o) throw new Error(`heroes: the ladder at (${at.x},${at.z}) has no ${opt} option`);
        const res = await q.sdk.sendInteractLoc(ladder.x, ladder.z, ladder.id, o.opIndex);
        if (!(await untilTicks(q.sdk, moved, 30))) q.log(`heroes: ladder (${at.x},${at.z}): ${res.message} (at ${where(q)})`);
    }
    if (!moved()) throw new Error(`heroes: the ladder at (${at.x},${at.z}) did not take us (${where(q)})`);
}

type Pathfinding = typeof import('../../../sdk/pathfinding');
let pathfinding: Pathfinding | null = null;
/** Loaded on first use, not at the top: run-quest imports this module for every quest. */
const loadPathfinding = async () => (pathfinding ??= await import('../../../sdk/pathfinding'));

/** findLongPath over the map lands exactly on (x,z) from `from` (there are no doors in the caves). */
function reaches(pf: Pathfinding, from: Tile, x: number, z: number): boolean {
    if (from.x === x && from.z === z) return true;
    if (!pf.isTileWalkable(0, x, z)) return false;
    const path = pf.findLongPath(0, from.x, from.z, x, z, 2000);
    const last = path[path.length - 1];
    return !!last && last.x === x && last.z === z;
}

/** A walkable tile beside `t` that `from` reaches. Exact: pockets C and D are only a wall apart. */
function besideReached(pf: Pathfinding, from: Tile, t: Tile): Tile | null {
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (reaches(pf, from, t.x + dx!, t.z + dz!)) return { x: t.x + dx!, z: t.z + dz! };
    return null;
}

type IceStep = { ladder: Tile & { up: boolean }; from: Tile };

/**
 * The ladders to climb from `start` until `goal` holds: a breadth-first search over the caves'
 * pockets and the mountain patches between them (each climb moves the player ±6400 in z).
 */
export async function planIce(start: Tile, goal: (pf: Pathfinding, at: Tile) => boolean): Promise<IceStep[] | null> {
    const pf = await loadPathfinding();
    const queue: Array<{ at: Tile; plan: IceStep[] }> = [{ at: start, plan: [] }];
    const used = new Set<string>();
    while (queue.length) {
        const { at, plan } = queue.shift()!;
        if (goal(pf, at)) return plan;
        if (plan.length >= 8) continue;
        const under = at.z >= UNDERGROUND_Z;
        for (const l of ICE_LADDERS) {
            const key = `${l.x},${l.z}`;
            if (used.has(key) || l.up !== under) continue;
            const from = besideReached(pf, at, l);
            if (!from) continue;
            used.add(key);
            queue.push({ at: { x: from.x, z: from.z + (l.up ? -UNDERGROUND_Z : UNDERGROUND_Z) }, plan: [...plan, { ladder: l, from }] });
        }
    }
    return null;
}

export const atQueen = (pf: Pathfinding, at: Tile) => at.z >= UNDERGROUND_Z && !!besideReached(pf, at, ICE_QUEEN);
export const onBurthorpeSide = (pf: Pathfinding, at: Tile) => at.z < UNDERGROUND_Z && reaches(pf, at, ROCKSLIDE_WEST.x, ROCKSLIDE_WEST.z);

async function climbPlan(q: Quest, plan: IceStep[]): Promise<void> {
    for (const step of plan) {
        if (pos(q).x !== step.from.x || pos(q).z !== step.from.z) await q.bot.walkTo(step.from.x, step.from.z, 0).catch(() => undefined);
        await climb(q, step.ladder, step.ladder.up);
    }
}

/** Up to Burthorpe's side of White Wolf Mountain from anywhere in the ice caves. */
export async function leaveIceDungeon(q: Quest): Promise<void> {
    if (!inIceDungeon(pos(q)) && !onIcePatch(pos(q))) return;
    const plan = await planIce(pos(q), onBurthorpeSide);
    if (!plan) throw new Error(`heroes: no way out of the ice caves from ${where(q)}`);
    q.log(`heroes: out of the ice caves by ${plan.map((s) => `(${s.ladder.x},${s.ladder.z})`).join(' ')}`);
    await climbPlan(q, plan);
    if (inIceDungeon(pos(q)) || onIcePatch(pos(q))) throw new Error(`heroes: still in the ice caves at ${where(q)}`);
}

/** The Ice Queen's gloves: the ice caves' ladder chain to her pocket, kill her, pick them up. */
export async function iceGloves(q: Quest): Promise<void> {
    const got = () => holds(q, OBJ.iceGloves);
    if (got()) return;
    await wieldBest(q);
    if (!(await planIce(pos(q), atQueen))?.length && !atQueen(await loadPathfinding(), pos(q))) {
        // On Burthorpe's side (no ladder in reach): the rockslide first.
        if (!inIceDungeon(pos(q)) && !onIcePatch(pos(q))) await throughRockslide(q);
    }
    const plan = await planIce(pos(q), atQueen);
    if (!plan) throw new Error(`heroes: no way to the Ice Queen from ${where(q)}`);
    q.log(`heroes: to the Ice Queen by ${plan.map((s) => `(${s.ladder.x},${s.ladder.z})`).join(' ')}`);
    await climbPlan(q, plan);
    const t0 = tickNow(q.sdk);
    for (let attempt = 1; attempt <= 3 && !got(); attempt++) {
        await q.bot.walkTo(ICE_QUEEN.x, ICE_QUEEN.z, 4).catch(() => undefined);
        let drop: Tile | null = null;
        await kill(
            q,
            /^ice queen$/i,
            () => {
                const g = (q.sdk.getState()?.groundItems ?? []).find((i) => i.id === OBJ.iceGloves);
                if (g) drop = { x: g.x, z: g.z };
                return !!g || got();
            },
            1500,
            'the Ice Queen'
        );
        for (let i = 0; i < 5 && drop && !got(); i++) {
            const g = (q.sdk.getState()?.groundItems ?? []).find((it) => it.id === OBJ.iceGloves);
            if (!g) break;
            await q.bot.pickupItem(g).catch(() => undefined);
            await untilTicks(q.sdk, got, 8);
        }
    }
    if (!got()) throw new Error(`heroes: no Ice gloves from the Ice Queen (${where(q)})`);
    q.log(`heroes: Ice gloves in ${tickNow(q.sdk) - t0}t`);
    await leaveIceDungeon(q);
}

/** Mine the Rock slide from Burthorpe's side: the script forcemoves us across onto patch S1. */
async function throughRockslide(q: Quest): Promise<void> {
    if (onS1(pos(q))) return;
    await q.goTo(ROCKSLIDE_WEST, 0);
    for (let attempt = 1; attempt <= 4 && !onS1(pos(q)); attempt++) {
        await q.sdk.scanNearbyLocs(5).catch(() => undefined);
        const rocks = (q.sdk.getNearbyLocs() ?? []).find((l) => /^rock slide$/i.test(l.name) && Math.abs(l.x - ROCKSLIDE.x) <= 1 && Math.abs(l.z - ROCKSLIDE.z) <= 1);
        const mine = rocks?.optionsWithIndex.find((o) => /^mine$/i.test(o.text));
        if (!rocks || !mine) {
            // Someone else is mid-crossing (it is an invisible wall for a few ticks).
            await q.sdk.waitForTicks(4);
            continue;
        }
        await q.sdk.sendInteractLoc(rocks.x, rocks.z, rocks.id, mine.opIndex);
        await untilTicks(q.sdk, (s) => onS1(pos(q)) || !!s.dialog?.isOpen, 15);
        if (q.sdk.getDialog()?.isOpen) {
            const seen = await driveDialog(q.sdk, [], { ticks: 10 });
            if (/pickaxe|mining level/i.test(seen)) throw new Error(`heroes: the rockslide: ${seen.slice(0, 120)}`);
        }
    }
    if (!onS1(pos(q))) throw new Error(`heroes: could not get past the Rock slide (${where(q)})`);
    q.log(`heroes: through the Rock slide ${where(q)}`);
}

/** Wield the best melee weapon held (the prologue withdrew it as a need). */
async function wieldBest(q: Quest): Promise<void> {
    const order = [/^dragon (scimitar|longsword)$/i, /^rune (scimitar|longsword)$/i, /^adamant (scimitar|longsword)$/i, /scimitar$/i];
    for (const re of order) {
        const w = q.sdk.getInventory().find((i) => re.test(i.name));
        if (w) {
            await q.bot.equipItem(w).catch(() => undefined);
            return;
        }
    }
}

const ENTRANA_DOCK_MONK = { x: 3045, z: 3236 };
const FIREBIRD = { x: 2847, z: 3386 };
const onEntrana = (q: Quest) => inBox(pos(q), 2800, 2880, 3320, 3400);

/** Ice gloves on, to Entrana (nothing the monks refuse), the firebird, its feather. */
export async function firebirdFeather(q: Quest): Promise<void> {
    const got = () => holds(q, OBJ.feather);
    if (got()) return;
    if (!holds(q, OBJ.iceGloves)) throw new Error('heroes: no Ice gloves for the firebird feather');
    /** Left at the Draynor bank for the trip (the monks refuse weapons and armour), taken back after. */
    const left = new Map<number, number>();
    const { SAFE_BANKS } = await import('../safe-stops');
    if (!onEntrana(q)) {
        // Everything worn comes off (the gloves go back on over there).
        for (const worn of q.sdk.getEquipment()) await q.bot.unequipItem(worn).catch(() => undefined);
        const allowed = (name: string, id: number) => id === OBJ.iceGloves || /^coins$/i.test(name) || / rune$/i.test(name) || FOOD.test(name);
        if (q.sdk.getInventory().some((i) => !allowed(i.name, i.id))) {
            for (const i of q.sdk.getInventory()) if (!allowed(i.name, i.id)) left.set(i.id, (left.get(i.id) ?? 0) + (i.count ?? 1));
            await q.goTo(SAFE_BANKS.draynor, 4);
            await depositAllInventory(q.supply, [/^ice gloves$/i, /^coins$/i, / rune$/i, FOOD]);
            await q.bot.closeBank().catch(() => undefined);
        }
        for (let i = 0; i < 3 && !onEntrana(q); i++) {
            await q.talk(/^monk of entrana$/i, [/yes,? okay,? i'?m ready to go/i], ENTRANA_DOCK_MONK);
            await untilTicks(q.sdk, () => onEntrana(q) || pos(q).level > 0, 40);
            await driveDialog(q.sdk, [], { ticks: 20 });
            for (let j = 0; j < 4 && pos(q).level > 0; j++) {
                await q.sdk.scanNearbyLocs(10).catch(() => undefined);
                const plank = q.sdk.findNearbyLoc(/gangplank/i);
                if (plank) await q.bot.interactLoc(plank, /cross/i).catch(() => undefined);
                await untilTicks(q.sdk, () => pos(q).level === 0, 15);
            }
        }
        if (!onEntrana(q)) throw new Error(`heroes: the monks did not sail us to Entrana (at ${where(q)}; carrying ${q.sdk.getInventory().map((i) => i.name).join(', ')})`);
    }
    const gloves = q.sdk.getInventory().find((i) => i.id === OBJ.iceGloves);
    if (gloves) await q.bot.equipItem(gloves);
    if (!q.sdk.getEquipment().some((i) => i.id === OBJ.iceGloves)) throw new Error('heroes: could not wear the Ice gloves');
    await q.goTo(FIREBIRD, 8);
    const t0 = tickNow(q.sdk);
    for (let attempt = 1; attempt <= 5 && !got(); attempt++) {
        await kill(q, /^entrana fire bird$/i, () => got() || (q.sdk.getState()?.groundItems ?? []).some((g) => g.id === OBJ.feather), 600, 'the firebird');
        for (let i = 0; i < 5 && !got(); i++) {
            const f = (q.sdk.getState()?.groundItems ?? []).find((g) => g.id === OBJ.feather);
            if (!f) break;
            await q.bot.pickupItem(f).catch(() => undefined);
            await untilTicks(q.sdk, got, 8);
        }
    }
    if (!got()) throw new Error(`heroes: no firebird feather (${where(q)})`);
    q.log(`heroes: firebird feather in ${tickNow(q.sdk) - t0}t`);
    if (left.size) {
        // run-quest's goTo sails back with the monks first.
        await q.goTo(SAFE_BANKS.draynor, 4);
        if ((await q.bot.openBank()).success) {
            for (const [id, count] of left) {
                const b = q.sdk.getBankItems().find((it) => it.id === id);
                if (b) await q.bot.withdrawItem(b, Math.min(count, b.count ?? count)).catch(() => undefined);
                await q.sdk.waitForTicks(1);
            }
            await q.bot.closeBank().catch(() => undefined);
        }
        q.log(`heroes: took back what the Entrana trip left at Draynor; carrying ${q.sdk.getInventory().map((i) => i.name).join(', ')}`);
    }
}

// ── Eel (both)

export async function askGerrant(q: Quest): Promise<void> {
    await q.talk(/^gerrant$/i, [/catch a lava eel/i], GERRANT);
}

/** Harralander into the vial, the slime into that, the oil on the rod. */
export async function oilyRod(q: Quest): Promise<void> {
    const combine = async (a: number, b: number, made: number, label: string) => {
        if (holds(q, made)) return;
        const x = q.sdk.getInventory().find((i) => i.id === a);
        const y = q.sdk.getInventory().find((i) => i.id === b);
        if (!x || !y) throw new Error(`heroes: ${label}: missing ${!x ? a : b} (carrying ${q.sdk.getInventory().map((i) => i.name).join(', ')})`);
        await q.sdk.sendUseItemOnItem(x.slot, y.slot);
        await untilTicks(q.sdk, (s) => !!s.dialog?.isOpen || holds(q, made), 10);
        if (q.sdk.getDialog()?.isOpen && !holds(q, made)) await driveDialog(q.sdk, [/^make/i, /.*/], { ticks: 20, done: () => holds(q, made) });
        await untilTicks(q.sdk, () => holds(q, made), 10);
        if (!holds(q, made)) throw new Error(`heroes: ${label} did not make ${made}`);
    };
    if (!holds(q, OBJ.blamishOil) && !holds(q, OBJ.oilyRod)) {
        await combine(OBJ.harralander, OBJ.vialOfWater, OBJ.unfinished, 'harralander into the vial of water');
        await combine(OBJ.slime, OBJ.unfinished, OBJ.blamishOil, 'slime into the potion');
    }
    if (!holds(q, OBJ.oilyRod)) await combine(OBJ.blamishOil, OBJ.fishingRod, OBJ.oilyRod, 'the oil on the fishing rod');
    q.log('heroes: Oily fishing rod made');
}

/** Through the cauldron room's Prison door (suits of armour may wake on the first opens). */
async function throughPrisonDoor(q: Quest, toWest: boolean): Promise<void> {
    const westSide = () => pos(q).x < PRISON_DOOR.x;
    if (westSide() === toWest) return;
    const fromWest = westSide();
    const side = { x: fromWest ? PRISON_DOOR.x - 1 : PRISON_DOOR.x, z: PRISON_DOOR.z };
    await stepTo(q, side);
    for (let attempt = 1; attempt <= 6 && westSide() === fromWest; attempt++) {
        await q.sdk.scanNearbyLocs(3).catch(() => undefined);
        const door = (q.sdk.getNearbyLocs() ?? []).find((l) => /^prison door$/i.test(l.name) && l.x === PRISON_DOOR.x && Math.abs(l.z - PRISON_DOOR.z) <= 1 && l.optionsWithIndex.some((o) => /^open$/i.test(o.text)));
        if (!door) {
            await q.sdk.waitForTicks(2);
            continue;
        }
        await q.sdk.sendInteractLoc(door.x, door.z, door.id, door.optionsWithIndex.find((o) => /^open$/i.test(o.text))!.opIndex);
        await untilTicks(q.sdk, () => westSide() !== fromWest, 6);
    }
    if (westSide() === fromWest) throw new Error(`heroes: could not get through the Prison door at ${where(q)}`);
}

/** A recorded Taverley route (lib/taverley-dragons.ts); the PRISON_DOOR waypoint means "cross it". */
async function walkRoute(q: Quest, route: Tile[], toWest: boolean): Promise<void> {
    for (const wp of route) {
        if (wp.x === PRISON_DOOR.x && wp.z === PRISON_DOOR.z) {
            await throughPrisonDoor(q, toWest);
            continue;
        }
        const near = () => Math.max(Math.abs(pos(q).x - wp.x), Math.abs(pos(q).z - wp.z)) <= 2;
        for (let send = 1; send <= 3 && !near(); send++) {
            await q.sdk.sendWalk(wp.x, wp.z);
            let last = pos(q);
            let still = 0;
            await untilTicks(
                q.sdk,
                () => {
                    if (near()) return true;
                    const p = pos(q);
                    still = p.x === last.x && p.z === last.z ? still + 1 : 0;
                    last = p;
                    return still >= 4;
                },
                40
            );
            if (!near()) {
                // A closed gate on the way (the iron gate at 2898,9831): open the nearest.
                await q.sdk.scanNearbyLocs(3).catch(() => undefined);
                const gate = (q.sdk.getNearbyLocs() ?? []).find(
                    (l) => /^(gate|door)$/i.test(l.name) && !(l.x === DUSTY_GATE.x && l.z === DUSTY_GATE.z) && (l.distance ?? 99) <= 3 && l.optionsWithIndex.some((o) => /^open$/i.test(o.text))
                );
                if (gate) await q.sdk.sendInteractLoc(gate.x, gate.z, gate.id, gate.optionsWithIndex.find((o) => /^open$/i.test(o.text))!.opIndex);
            }
        }
        if (!near()) await q.bot.walkTo(wp.x, wp.z, 2).catch(() => undefined);
    }
}

const nearestIndex = (q: Quest, route: Tile[]) =>
    route.map((t, i) => ({ i, d: Math.hypot(t.x - pos(q).x, t.z - pos(q).z) })).sort((a, b) => a.d - b.d)[0]!.i;

/** Down the Taverley ladder. */
async function intoTaverley(q: Quest): Promise<void> {
    if (inTaverleyDungeon(pos(q))) return;
    await q.goTo(LADDER_SURFACE, 1);
    await climb(q, LADDER_SURFACE, false);
}

/** Velrak's Dusty key: the Jailer's key on his cell, then ask him. */
export async function dustyKey(q: Quest): Promise<void> {
    if (holds(q, OBJ.dustyKey)) return;
    await intoTaverley(q);
    await walkRoute(q, LADDER_TO_JAIL.slice(nearestIndex(q, LADDER_TO_JAIL)), false);
    const inCell = () => pos(q).z < VELRAK_CELL_DOOR.z && Math.abs(pos(q).x - VELRAK_CELL_DOOR.x) <= 4;
    for (let attempt = 1; attempt <= 3 && !holds(q, OBJ.jailKey) && !inCell(); attempt++) {
        await q.bot.walkTo(JAILER_SPAWN.x, JAILER_SPAWN.z, 4).catch(() => undefined);
        await kill(q, /^jailer$/i, () => holds(q, OBJ.jailKey) || (q.sdk.getState()?.groundItems ?? []).some((g) => g.id === OBJ.jailKey), 800, 'the Jailer');
        for (let i = 0; i < 5 && !holds(q, OBJ.jailKey); i++) {
            const k = (q.sdk.getState()?.groundItems ?? []).find((g) => g.id === OBJ.jailKey);
            if (!k) break;
            await q.bot.pickupItem(k).catch(() => undefined);
            await untilTicks(q.sdk, () => holds(q, OBJ.jailKey), 8);
        }
    }
    if (!inCell()) {
        if (!holds(q, OBJ.jailKey)) throw new Error(`heroes: no Jail key from the Jailer (${where(q)})`);
        await q.bot.walkTo(VELRAK_CELL_DOOR.x, VELRAK_CELL_DOOR.z, 0).catch(() => undefined);
        await useOn(q, OBJ.jailKey, VELRAK_CELL_DOOR, /door/i, inCell, "the Jail key on Velrak's cell", 15);
    }
    await q.talk(/^velrak the explorer$/i, [/anywhere good to explore/i, /yes please/i]);
    if (!holds(q, OBJ.dustyKey)) throw new Error('heroes: Velrak did not hand over the Dusty key');
    // Out of the cell: the door lets you out without a key.
    await op(q, VELRAK_CELL_DOOR, /door/i, /^open$/i, () => !inCell(), "out of Velrak's cell", [], 10);
    q.log('heroes: Dusty key from Velrak');
}

/** Dusty key on the gate, through the dragon pen to the lava. */
export async function toLava(q: Quest): Promise<void> {
    if (inLavaSide(pos(q))) return;
    await intoTaverley(q);
    if (pos(q).x < PRISON_DOOR.x) await walkRoute(q, [...GATE_TO_LADDER].reverse(), false);
    else await walkRoute(q, JAIL_TO_GATE.slice(nearestIndex(q, JAIL_TO_GATE)), false);
    await q.bot.walkTo(DUSTY_GATE_OUTSIDE.x, DUSTY_GATE_OUTSIDE.z, 0).catch(() => undefined);
    for (let attempt = 1; attempt <= 4 && !inLavaSide(pos(q)); attempt++) {
        await q.sdk.scanNearbyLocs(4).catch(() => undefined);
        const gate = (q.sdk.getNearbyLocs() ?? []).find((l) => l.x === DUSTY_GATE.x && l.z === DUSTY_GATE.z);
        const key = q.sdk.getInventory().find((i) => i.id === OBJ.dustyKey);
        if (!key) throw new Error('heroes: no Dusty key at the gate');
        if (!gate) {
            await q.sdk.waitForTicks(6);
            continue;
        }
        await q.sdk.sendUseItemOnLoc(key.slot, gate.x, gate.z, gate.id);
        await untilTicks(q.sdk, () => inLavaSide(pos(q)), 10);
    }
    if (!inLavaSide(pos(q))) throw new Error(`heroes: the Dusty-key gate did not let us in (${where(q)})`);
}

/** Out through the gate (no key needed going out), round to the ladder and up. */
export async function leaveTaverley(q: Quest): Promise<void> {
    if (inLavaSide(pos(q))) {
        await q.bot.walkTo(DUSTY_GATE.x - 1, DUSTY_GATE.z, 0).catch(() => undefined);
        await op(q, DUSTY_GATE, /gate|door/i, /^open$/i, () => !inLavaSide(pos(q)), 'out through the Dusty-key gate', [], 10);
    }
    if (inTaverleyDungeon(pos(q))) {
        if (pos(q).x >= PRISON_DOOR.x) await walkRoute(q, GATE_TO_LADDER.slice(nearestIndex(q, GATE_TO_LADDER)), true);
        await q.bot.walkTo(LADDER_DUNGEON.x, LADDER_DUNGEON.z, 1).catch(() => undefined);
        await climb(q, LADDER_DUNGEON, true);
    }
}

/** Dragonfire shield on (the pen's blue dragons breathe), the Dusty key, the lava spot, bait until an eel bites. */
export async function catchEel(q: Quest): Promise<void> {
    const got = () => holds(q, OBJ.rawEel) || holds(q, OBJ.eel);
    if (got()) return;
    if (!holds(q, OBJ.oilyRod)) throw new Error('heroes: no Oily fishing rod');
    let shield = q.sdk.getInventory().find((i) => /dragonfire shield|anti-?dragon shield/i.test(i.name));
    if (!shield && !q.sdk.getEquipment().some((i) => /dragonfire shield|anti-?dragon shield/i.test(i.name))) {
        await fetchDukeShield(q.bot, q.sdk, q.log);
        shield = q.sdk.getInventory().find((i) => /dragonfire shield|anti-?dragon shield/i.test(i.name));
    }
    if (shield) await q.bot.equipItem(shield).catch(() => undefined);
    await wieldBest(q);
    await dustyKey(q);
    await toLava(q);
    const t0 = tickNow(q.sdk);
    await q.bot.walkTo(LAVA_SPOT.x, LAVA_SPOT.z, 1).catch(() => undefined);
    while (!got() && tickNow(q.sdk) - t0 < 3000) {
        if (q.count('fishing bait') < 1) throw new Error('heroes: out of fishing bait at the lava');
        await eatIfLow(q);
        const spot = (q.sdk.getNearbyNpcs() ?? []).filter((n) => /^fishing spot$/i.test(n.name)).sort((a, b) => a.distance - b.distance)[0];
        if (!spot) {
            await q.sdk.waitForTicks(5);
            continue;
        }
        await q.bot.interactNpc(spot, /^bait$/i).catch(() => undefined);
        await untilTicks(q.sdk, () => got() || !!q.sdk.getDialog()?.isOpen, 40);
        if (q.sdk.getDialog()?.isOpen) await driveDialog(q.sdk, [], { ticks: 10 });
    }
    if (!got()) throw new Error(`heroes: no lava eel in ${tickNow(q.sdk) - t0}t`);
    q.log(`heroes: raw lava eel in ${tickNow(q.sdk) - t0}t`);
    await leaveTaverley(q);
}

/** Cook the raw lava eel on the range by Falador's west bank (it never burns). */
export async function cookEel(q: Quest): Promise<void> {
    if (holds(q, OBJ.eel)) return;
    await leaveHeroesAreas(q);
    await q.goTo(FALADOR_RANGE, 0);
    for (let attempt = 1; attempt <= 3 && !holds(q, OBJ.eel); attempt++) {
        await q.sdk.scanNearbyLocs(8).catch(() => undefined);
        const range = (q.sdk.getNearbyLocs() ?? []).find((l) => /^range$/i.test(l.name));
        const raw = q.sdk.getInventory().find((i) => i.id === OBJ.rawEel);
        if (!range || !raw) throw new Error(`heroes: ${!raw ? 'no raw lava eel' : 'no range'} at ${where(q)}`);
        await q.bot.useItemOnLoc(raw, range).catch(() => undefined);
        await untilTicks(q.sdk, (s) => holds(q, OBJ.eel) || !!s.dialog?.isOpen, 15);
        if (q.sdk.getDialog()?.isOpen) await driveDialog(q.sdk, [/.*/], { ticks: 20, done: () => holds(q, OBJ.eel) });
        await untilTicks(q.sdk, () => holds(q, OBJ.eel), 10);
    }
    if (!holds(q, OBJ.eel)) throw new Error('heroes: the lava eel did not cook');
}

/** All three in the pack: Achietties. A lost armband: the gang leader gives a spare first. */
export async function handIn(q: Quest, gang: Gang): Promise<void> {
    if (!holds(q, OBJ.armband)) {
        if (gang === 'phoenix') await talkStraven(q, []);
        else await q.talk(/^katrine$/i, [/.*/], KATRINE);
    }
    await q.talk(/^achietties$/i, [], ACHIETTIES);
}

// re-exported for the entry script's stage table
export { held };
