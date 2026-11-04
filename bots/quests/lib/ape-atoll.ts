/**
 * Monkey Madness on Ape Atoll (chapters 2-4): the jail, Garkor, Zooknock's cave, the warehouse, the
 * temple, the monkey child, the greegree, Awowogei, the zoo monkey and the Jungle Demon.
 *
 * Content facts (quest_mm/scripts/*.rs2; placements m42_42, m42_43, m43_42, m43_43, m42_143, m43_142,
 * m43_143; rs-stun-toolkit q-monkeymadness.ts walked the same route):
 *   - As a human every monkey guard knocks you out (named guards always, the others 1 in 10) and a
 *     ravine archer's arrow does 1 time in 20 (aa_monkey_guard.rs2, mm_archer.rs2): you wake in the jail
 *     cell (2770-2776,2793-2794). Wearing a greegree, none of them touch you.
 *   - The jail door (4799 at 2771,2795) is a thieving pick (stat_random 95/295). Two gorilla guards
 *     (Aberab 1432, Trefaji 1431) patrol (2768,2798) (2770,2798) (2772,2801) (2772,2796) (2771,2796) and
 *     back, punching a human within 1 tile with line of sight (mm_jail_patrol); after the third north
 *     pause the active one walks west into the hand-over corner (2764-2769,2800-2804) and the other one
 *     starts. Out = west along z 2799 to (2762,2799).
 *   - Garkor (1411, 2805,2762) east of the hall. Zooknock (1425, 2804,9145) at the end of the cave
 *     under the beach ladder (4780 at 2763,2703; out by 4781 at 2763,9103).
 *   - The warehouse: secure door 4710 (2764,2764); the dentures crate 4715 (2767,2769, "Yes"); the crate
 *     over the hole 4714 (2769,2765, "Yes, I'm sure.") drops to the cellar (2801,9169-ish), the mould
 *     crate 4724 (2782,9172, "Yes"), the east rope 4728 (2798,9169) up.
 *   - The bridge ladder 4743 (2803,2734) up to L2 and the jumping square 4745 (2803,2727,L2) down to the
 *     beach; monkeys cannot jump (mm_jumping_square), they use the ravine gate 4787 (2719,2766).
 *   - The temple trapdoor (2807,2785: 4879 closed, 4880 open; reached from 2806,2785) is guarded by
 *     size-2 gorillas (1460) that only reach a human within 3 of their spawns. Below: the wall of flame
 *     4765 (stand on 2809,9191) turns the enchanted bar into the unstrung amulet; the rope 4881
 *     (2808,9201) back up.
 *   - The monkey child (1452) in the garden (2740-2746,2792-2798): amulet worn, "Well I'll be a monkey's
 *     uncle!", "How many bananas did Aunty want?", 5+ bananas, then 100 ticks later the talisman. The
 *     Aunt (1454) calls the guards when she is within 5 and on our side of the garden edge.
 *   - Zooknock: talisman + Karamja monkey bones -> the greegree and the chapter 3 cutscene (main 4).
 */
import type { Quest } from './run-quest';
import { readJournalCheckpoint } from '../../../quest-lab/journal-reader';
import { tickNow, untilTicks } from './ticks';
import { cursor, drive, held, OBJ, opLoc, said, talkTo, walk, where, worn, type Tile } from './monkey-madness';

const pos = (q: Quest) => {
    const p = q.sdk.getState()?.player;
    return { x: p?.worldX ?? 0, z: p?.worldZ ?? 0, level: p?.level ?? 0 };
};
const inBox = (p: Tile, x0: number, x1: number, z0: number, z1: number) => p.x >= x0 && p.x <= x1 && p.z >= z0 && p.z <= z1;
const cheb = (a: Tile, b: Tile) => Math.max(Math.abs(a.x - b.x), Math.abs(a.z - b.z));

export const NPC = {
    archers: [1456, 1457, 1458],
    jailGuards: [1431, 1432],
    templeGuards: [1460],
    melee: [1447, 1459, 1460, 1465, 1466, 1467, 1471, 1473, 1477, 1478, 1479],
    garkor: 1411,
    zooknock: 1425,
    child: 1452,
    aunt: 1454,
};

interface Mob {
    id: number;
    index: number;
    x: number;
    z: number;
    d: number;
}
function mobs(q: Quest, ids: number[]): Mob[] {
    const me = pos(q);
    return (q.sdk.getState()?.nearbyNpcs ?? [])
        .filter((n) => ids.includes(n.id))
        .map((n) => {
            const x = n.tileX ?? n.x;
            const z = n.tileZ ?? n.z;
            return { id: n.id, index: n.index, x, z, d: cheb(me, { x, z }) };
        });
}

export const inJail = (p: Tile) => p.level === 0 && inBox(p, 2770, 2776, 2793, 2795);
/** The atoll's beach strip south of the ravine (Lumdo's landing, the cave ladder). */
export const onBeach = (p: Tile) => p.level === 0 && p.z <= 2726 && p.z > 2688 && p.x >= 2690 && p.x <= 2815;
/** Zooknock's cave and the warehouse cellar (z + 6400). */
export const inAtollCaves = (p: Tile) => inBox(p, 2688, 2815, 9088, 9215);
/** Zooknock's cave under the beach (m42_142, m43_142). */
export const inZooknockCave = (p: Tile) => inBox(p, 2688, 2815, 9088, 9151);
/** Under the temple: the wall of flame and the rope up (m43_143, east). */
export const inTempleCave = (p: Tile) => inBox(p, 2800, 2815, 9180, 9215);
/** The warehouse cellar (m43_143, west of the temple cave). */
export const inCellar = (p: Tile) => inBox(p, 2752, 2815, 9152, 9215) && !inTempleCave(p);
/** The atoll's surface, both levels. */
export const onAtollSurface = (p: Tile) => inBox(p, 2688, 2815, 2688, 2815);
const inTemple = (p: Tile) => p.level === 0 && inBox(p, 2786, 2812, 2774, 2793);
const greegreeOn = (q: Quest) => worn(q, OBJ.greegree);

// ── safety: eat, protection prayers by threat, prayer potions, antipoison

const PRAYERS = ['protect_from_melee', 'protect_from_missiles', 'protect_from_magic'] as const;
type Protect = (typeof PRAYERS)[number];

export class Safety {
    /** Overrides the prayer the threat picks (null = by threat). */
    want: Protect | null = null;
    private on = false;
    private loop: Promise<void> | null = null;
    constructor(private readonly q: Quest) {}

    start(): void {
        if (this.on) return;
        this.on = true;
        this.loop = this.run().catch((e) => this.q.log(`mm safety: ${(e as Error).message}`));
    }

    async stop(): Promise<void> {
        this.on = false;
        this.want = null;
        await this.loop;
        for (const p of PRAYERS) if (this.q.sdk.isPrayerActive(p)) await this.q.sdk.sendTogglePrayer(p).catch(() => undefined);
    }

    private item(re: RegExp) {
        return this.q.sdk.getInventory().find((i) => re.test(i.name));
    }

    private async run(): Promise<void> {
        const q = this.q;
        let lastEat = -9;
        let lastPot = -9;
        let lastPray = -9;
        let since = cursor(q);
        let lastLog = -999;
        while (this.on) {
            const t = tickNow(q.sdk);
            if (t - lastLog >= 150) {
                lastLog = t;
                const inv = q.sdk.getInventory();
                const n = (re: RegExp) => inv.filter((i) => re.test(i.name)).length;
                q.log(`mm safety: hp ${q.sdk.getSkill('hitpoints')?.level}/${q.sdk.getSkill('hitpoints')?.baseLevel} prayer ${q.sdk.getSkill('prayer')?.level} sharks ${n(/^shark$/i)} pots ${n(/^prayer potion/i)} at (${pos(q).x},${pos(q).z},L${pos(q).level}) want ${this.want ?? 'auto'}`);
            }
            const hp = q.sdk.getSkill('hitpoints');
            const pr = q.sdk.getSkill('prayer');
            const cur = hp?.level ?? 99;
            const max = hp?.baseLevel ?? 99;
            const critical = cur <= Math.max(14, Math.floor(max * 0.25));
            const dialog = !!q.sdk.getDialog()?.isOpen;
            const me = pos(q);
            // A quest page is closed by any inventory or prayer click: only in an emergency.
            if (!dialog || critical) {
                if (cur <= Math.floor(max * (this.want === 'protect_from_magic' ? 0.7 : 0.65)) && t - lastEat >= 3) {
                    const food = this.item(/^(shark|monkfish|lobster|swordfish|karambwan|cooked karambwan)$/i);
                    if (food) {
                        await q.sdk.sendUseItem(food.slot, 1).catch(() => undefined);
                        lastEat = t;
                    }
                }
                if (said(q, since, /you have been poisoned|poison/i) && !said(q, since, /immune|cure/i) && t - lastPot >= 2) {
                    const ap = this.item(/^(antipoison|superantipoison)\(\d\)$/i);
                    if (ap) {
                        await q.sdk.sendUseItem(ap.slot, 1).catch(() => undefined);
                        lastPot = t;
                    }
                }
                since = cursor(q);
                const vial = this.item(/^vial$/i);
                if (vial && !dialog) await q.sdk.sendDropItem(vial.slot).catch(() => undefined);
                const onAtoll = onAtollSurface(me) || inAtollCaves(me);
                const meleeAdj = mobs(q, NPC.melee).some((m) => m.d <= 2);
                // Prayer only against a threat in reach: a whole chapter under Protect from Missiles drank
                // 15 doses before the temple and the account died there (qlmmA, 2026-11-05).
                const meleeNear = meleeAdj || mobs(q, NPC.melee).some((m) => m.d <= 3);
                const archersNear = mobs(q, NPC.archers).some((m) => m.d <= 7);
                const want: Protect | null = !onAtoll ? null :
                    this.want ?? (!onAtoll || greegreeOn(q) ? null : meleeNear && (meleeAdj || !archersNear) ? 'protect_from_melee' : archersNear && cur < max * 0.9 ? 'protect_from_missiles' : meleeNear ? 'protect_from_melee' : null);
                if (want && !q.sdk.isPrayerActive(want) && (pr?.level ?? 0) > 0 && t - lastPray >= 2) {
                    // Exclusive: lighting one puts the other out server-side.
                    await q.sdk.sendTogglePrayer(want).catch(() => undefined);
                    lastPray = t;
                } else if (!want) {
                    for (const p of PRAYERS) if (q.sdk.isPrayerActive(p) && t - lastPray >= 2) {
                        await q.sdk.sendTogglePrayer(p).catch(() => undefined);
                        lastPray = t;
                    }
                }
                if (want && (pr?.level ?? 0) < (this.want === 'protect_from_magic' ? 30 : 15) && t - lastPot >= 3) {
                    const pot = this.item(/^prayer potion\(\d\)$/i);
                    if (pot) {
                        await q.sdk.sendUseItem(pot.slot, 1).catch(() => undefined);
                        lastPot = t;
                    }
                }
            }
            await q.sdk.waitForTicks(1).catch(() => undefined);
        }
    }
}

let safety: Safety | null = null;
/** The run's one safety loop (started by every atoll step, stopped by leaveAtoll / the quest's end). */
export function safe(q: Quest): Safety {
    if (!safety) safety = new Safety(q);
    safety.start();
    return safety;
}
export async function unsafe(): Promise<void> {
    if (safety) await safety.stop();
    safety = null;
}

/** Continue level-up and knockout pages (the objbox after a knockout, Lumo's jail lines). */
async function clearPages(q: Quest): Promise<void> {
    if (q.sdk.getDialog()?.isOpen) await drive(q, [], 15, undefined, 2);
}

// ── the jail

const JAIL_DOOR = { x: 2771, z: 2795, id: 4799 };
const JAIL_EXIT = { x: 2762, z: 2799 };
const JAIL_PATH: Tile[] = [{ x: 2771, z: 2796 }, { x: 2770, z: 2797 }, { x: 2769, z: 2798 }, { x: 2767, z: 2798 }, { x: 2765, z: 2799 }, { x: 2763, z: 2799 }];
const RAVINE_STAND = { x: 2720, z: 2752 };

/** Stand where the ravine archers shoot until one of them knocks us out (into the village's jail). */
export async function getJailed(q: Quest, label: string): Promise<void> {
    if (inJail(pos(q))) return;
    safe(q);
    const t0 = tickNow(q.sdk);
    // Server-pathed legs from the beach: walkTo stalled 300+ ticks "opening" a pineapple plant on the way (qlmmB).
    const legs: Tile[] = [{ x: 2760, z: 2712 }, { x: 2732, z: 2724 }, { x: 2721, z: 2742 }, RAVINE_STAND];
    while (!inJail(pos(q)) && tickNow(q.sdk) - t0 < 1500) {
        await clearPages(q);
        if (cheb(pos(q), RAVINE_STAND) > 3 && pos(q).z < 6400 && !inJail(pos(q))) {
            const i = onBeach(pos(q)) ? 0 : legs.findIndex((l) => l.z > pos(q).z - 2);
            for (const leg of legs.slice(Math.max(0, i))) {
                if (inJail(pos(q))) break;
                await q.sdk.sendWalk(leg.x, leg.z, true);
                await untilTicks(q.sdk, () => cheb(pos(q), leg) <= 2 || inJail(pos(q)), 25);
            }
            if (cheb(pos(q), RAVINE_STAND) > 3 && !inJail(pos(q))) await walk(q, RAVINE_STAND, 2);
        }
        await q.sdk.waitForTicks(1);
    }
    if (!inJail(pos(q))) throw new Error(`mm: ${label}: no knockout at the ravine (at ${where(q)})`);
    q.log(`mm: ${label}: jailed at ${where(q)}`);
}

/**
 * Out of the jail cell: pick the lock during the active guard's third north pause (or once it heads
 * west for the hand-over), then run west along z 2799 once it is in the hand-over corner and the next
 * tiles are clear of both guards.
 */
export async function escapeJail(q: Quest, label: string): Promise<void> {
    if (!inJail(pos(q)) && !inBox(pos(q), 2765, 2775, 2796, 2803)) return;
    safe(q);
    q.log(`mm: ${label}: in the jail (${(q.sdk.getState()?.gameMessages ?? []).slice(-4).map((m) => m.text).join(' | ')})`);
    const isNorth = (g: Tile) => g.x === 2772 && g.z === 2801;
    const isWest = (g: Tile) => g.z <= 2799 && g.x <= 2770;
    const inHandover = (g: Tile) => g.x >= 2763 && g.x <= 2769 && g.z >= 2800;
    let active = -1;
    let norths = 0;
    let wasNorth = false;
    let lastX = -1;
    let westward = false;
    let lastPick = -9;
    let lastLog = -99;
    const t0 = tickNow(q.sdk);
    while (tickNow(q.sdk) - t0 < 1500) {
        const me = pos(q);
        if (me.x <= 2764 && me.z >= 2797 && me.z <= 2800) break;
        checkSupplies(q, label);
        if (q.sdk.getDialog()?.isOpen) await q.sdk.sendClickDialog(0).catch(() => undefined);
        const gs = mobs(q, NPC.jailGuards);
        const act = gs.find((g) => !inHandover(g)) ?? null;
        if (act && act.index !== active) {
            active = act.index;
            norths = 0;
            wasNorth = false;
        }
        if (act) {
            if (lastX >= 0 && act.x !== lastX) westward = act.x < lastX;
            lastX = act.x;
            if (isWest(act) && !westward) norths = 0;
            if (isNorth(act) && !wasNorth) norths++;
            wasNorth = isNorth(act);
        }
        const t = tickNow(q.sdk);
        if (t - lastLog >= 20) {
            lastLog = t;
            q.log(`mm: ${label}: me (${me.x},${me.z}) guards ${gs.map((g) => `${g.x},${g.z}`).join(' ')} norths ${norths}`);
        }
        const near = (p: Tile, d: number) => gs.some((g) => Math.max(Math.abs(g.x - p.x), Math.abs(g.z - p.z), Math.abs(g.x + 1 - p.x), Math.abs(g.z + 1 - p.z)) <= d && cheb(g, p) <= d);
        if (inJail(me)) {
            const window = !act || (isNorth(act) && norths >= 3) || (norths >= 3 && westward && (isWest(act) || act.z >= 2799));
            if (window && t - lastPick >= 3) {
                lastPick = t;
                await q.sdk.sendInteractLoc(JAIL_DOOR.x, JAIL_DOOR.z, JAIL_DOOR.id, 1);
            }
        } else {
            const goNow = !act || inHandover(act) || act.x <= 2768;
            const i = JAIL_PATH.findIndex((p) => p.x === me.x && p.z === me.z);
            const next = JAIL_PATH.slice(i + 1, i + 4);
            if (goNow && next.every((p) => !near(p, 1))) await q.sdk.sendWalk(JAIL_EXIT.x, JAIL_EXIT.z, true);
        }
        await q.sdk.waitForTicks(1);
    }
    const me = pos(q);
    if (!(me.x <= 2764)) throw new Error(`mm: ${label}: still in the jail (at ${where(q)})`);
    q.log(`mm: ${label}: out of the jail at ${where(q)}`);
}

/** Walk in the village as a human: a knockout puts us in the jail; escape and walk again. */
export async function villageWalk(q: Quest, to: Tile, label: string, tolerance = 1, via: Tile[] = []): Promise<void> {
    for (let k = 0; k < 5; k++) {
        await clearPages(q);
        checkSupplies(q, label);
        if (inJail(pos(q))) await escapeJail(q, `${label} (escape ${k + 1})`);
        for (const v of k === 0 ? via : via.slice(-1)) {
            await walk(q, v, 1);
            if (inJail(pos(q))) break;
        }
        if (inJail(pos(q))) continue;
        await walk(q, to, tolerance);
        if (!inJail(pos(q)) && cheb(pos(q), to) <= tolerance + 1) return;
    }
    throw new Error(`mm: village walk ${label} did not arrive (at ${where(q)})`);
}

// ── Garkor

const GARKOR_STAND = { x: 2806, z: 2762 };

/** Into the village by the jail, Garkor's story (-> garkor_speak_zooknock). */
export async function meetGarkor(q: Quest): Promise<void> {
    safe(q);
    if (!inJail(pos(q)) && !inVillage(pos(q))) await getJailed(q, 'jail (to the village)');
    const told = () => said(q, since, /find my squad mage|have you spoken to zooknock/i) || seen.includes('squad mage');
    let seen = '';
    const since = cursor(q);
    for (let k = 0; k < 4 && !told(); k++) {
        await villageWalk(q, GARKOR_STAND, 'to Garkor', 1);
        seen += await talkTo(q, /^garkor$/i, [/.*/], { label: 'Garkor', ticks: 120 }).catch((e) => String(e));
        if (/squad mage|spoken to zooknock/i.test(seen)) break;
    }
}

/** The village inside its walls (the jail, the hall, the warehouses, the temple, the garden). */
export const inVillage = (p: Tile) => p.level === 0 && inBox(p, 2725, 2812, 2740, 2810) && !inBox(p, 2700, 2730, 2740, 2770);

// ── the warehouse and its cellar

const WH_DOOR = { x: 2764, z: 2764, id: 4710 };
/** Inside the warehouse's south room (door 2764,2764; the crates; the sleeping monkey west of it). */
const inWarehouse = (p: Tile) => p.level === 0 && inBox(p, 2764, 2771, 2764, 2771);
const WH_PATH: Tile[] = [{ x: 2764, z: 2765 }, { x: 2767, z: 2765 }, { x: 2767, z: 2766 }, { x: 2768, z: 2767 }, { x: 2768, z: 2769 }];

/** The magical monkey talking dentures and down the hole under the crate to the cellar. */
export async function warehouse(q: Quest, needDentures = true): Promise<void> {
    safe(q);
    if (inAtollCaves(pos(q))) return;
    if (!inVillage(pos(q)) && !inJail(pos(q))) await getJailed(q, 'jail (to the warehouse)');
    for (let k = 0; k < 6 && pos(q).z < 6400; k++) {
        if (!inWarehouse(pos(q))) {
            await villageWalk(q, { x: 2764, z: 2763 }, 'the warehouse door', 0, pos(q).x > 2795 ? [{ x: 2806, z: 2772 }, { x: 2790, z: 2765 }, { x: 2776, z: 2770 }] : [{ x: 2776, z: 2770 }]);
            for (let i = 0; i < 3 && pos(q).z < 2764; i++) {
                await q.sdk.sendInteractLoc(WH_DOOR.x, WH_DOOR.z, WH_DOOR.id, 1);
                await untilTicks(q.sdk, () => pos(q).z >= 2764, 6);
            }
            if (pos(q).z < 2764) continue;
            // Around the sleeping monkey's room: tile by tile along the wall.
            for (const t of WH_PATH.slice(1)) {
                await q.sdk.sendWalk(t.x, t.z, false);
                await untilTicks(q.sdk, () => cheb(pos(q), t) === 0 || inJail(pos(q)), 6);
            }
        }
        if (inJail(pos(q))) continue;
        // A spider or scorpion chewing on us closes every crate page (npc hits if_close): kill it first.
        if (needDentures && !held(q, OBJ.dentures)) {
            await fightOff(q, NPC.melee, 'dentures crate');
            await opLoc(q, { x: 2767, z: 2769, id: 4715 }, /^crate$/i, /^search$/i, () => held(q, OBJ.dentures) && !q.sdk.getDialog()?.isOpen, 'the dentures crate', [/^yes$/i], 20).catch((e) => q.log(String(e)));
        }
        if (inJail(pos(q)) || (needDentures && !held(q, OBJ.dentures))) continue;
        await fightOff(q, NPC.melee, 'hole crate');
        await opLoc(q, { x: 2769, z: 2765, id: 4714 }, /^crate$/i, /^search$/i, () => pos(q).z > 6400, 'the crate over the hole', [/^yes, i'?m sure/i], 20).catch((e) => q.log(String(e)));
    }
    if (pos(q).z < 6400) throw new Error(`mm: not down the warehouse hole (at ${where(q)})`);
    await drive(q, [], 10);
}

/** The monkey amulet mould in the cellar, then up the east rope (a run for the bridge follows). */
export async function cellar(q: Quest): Promise<void> {
    safe(q);
    if (!held(q, OBJ.mould) && inCellar(pos(q))) {
        if (q.sdk.getInventory().length >= 28) {
            const food = q.sdk.getInventory().find((i) => /^shark$/i.test(i.name));
            if (food) await q.sdk.sendUseItem(food.slot, 1);
            await q.sdk.waitForTicks(2);
        }
        await walk(q, { x: 2782, z: 9171 }, 1);
        await fightOff(q, NPC.melee, 'mould crate');
        await opLoc(q, { x: 2782, z: 9172, id: 4724 }, /^crate$/i, /^search$/i, () => held(q, OBJ.mould) && !q.sdk.getDialog()?.isOpen, 'the mould crate', [/^yes$/i], 20);
    }
    if (inCellar(pos(q))) {
        await walk(q, { x: 2798, z: 9170 }, 1);
        await opLoc(q, { x: 2798, z: 9169, id: 4728 }, /rope/i, /climb/i, () => pos(q).z < 6400, 'the east rope', [], 10);
    }
}

// ── the beach and Zooknock's cave

const BRIDGE_N = { x: 2803, z: 2735 };
const CAVE_LADDER = { x: 2763, z: 2703, id: 4780 };
const CAVE_EXIT = { x: 2763, z: 9103, id: 4781 };
const ZOOKNOCK_AT = { x: 2804, z: 9144 };

/** From the village side (human): the bridge ladder to L2, the jumping square down to the beach. */
export async function toBeach(q: Quest): Promise<void> {
    for (let k = 0; k < 4 && !onBeach(pos(q)); k++) {
        // Died on the way (Lumbridge): nothing left to walk out of.
        if (!onAtollSurface(pos(q)) && !inAtollCaves(pos(q))) return;
        await clearPages(q);
        if (inJail(pos(q))) await escapeJail(q, `to the beach (escape ${k + 1})`);
        if (greegreeOn(q)) return ravineGate(q, false);
        if (pos(q).level === 0) {
            await walk(q, BRIDGE_N, 1);
            if (inJail(pos(q))) continue;
            await opLoc(q, { x: 2803, z: 2734, id: 4743 }, /ladder/i, /climb-up/i, () => pos(q).level === 2 || inJail(pos(q)), 'the bridge ladder', [], 8).catch((e) => q.log(String(e)));
        }
        if (pos(q).level === 2) {
            for (let i = 0; i < 3 && !onBeach(pos(q)) && !inJail(pos(q)); i++) {
                await q.sdk.sendInteractLoc(2803, 2727, 4745, 1);
                await untilTicks(q.sdk, () => onBeach(pos(q)) || inJail(pos(q)), 12);
            }
        }
    }
    if (!onBeach(pos(q))) throw new Error(`mm: not on the beach (at ${where(q)})`);
}

/** Down the beach ladder and along the cave to Zooknock. */
export async function toZooknock(q: Quest): Promise<void> {
    const s = safe(q);
    if (inCellar(pos(q))) await cellar(q);
    if (inTempleCave(pos(q))) await leaveTemple(q);
    if (!inZooknockCave(pos(q))) {
        for (let j = 0; j < 3 && (inJail(pos(q)) || cheb(pos(q), { x: 2763, z: 2704 }) > 3); j++) {
            if (!onBeach(pos(q))) await toBeach(q);
            await walk(q, { x: 2763, z: 2704 }, 1);
        }
        await opLoc(q, CAVE_LADDER, /ladder/i, /climb-down/i, () => pos(q).z > 6400, 'the cave ladder', [], 8);
    }
    s.want = 'protect_from_melee';
    await walk(q, ZOOKNOCK_AT, 2);
    if (cheb(pos(q), ZOOKNOCK_AT) > 4) await walk(q, ZOOKNOCK_AT, 2);
    s.want = null;
}

/** Up the cave's ladder to the beach. */
export async function leaveCave(q: Quest): Promise<void> {
    if (!inZooknockCave(pos(q))) return;
    const s = safe(q);
    s.want = 'protect_from_melee';
    if (!inZooknockCave(pos(q))) throw new Error(`mm: in the atoll caves away from the beach ladder (at ${where(q)})`);
    await walk(q, { x: 2763, z: 9104 }, 1);
    await opLoc(q, CAVE_EXIT, /ladder/i, /climb-up/i, () => pos(q).z < 6400, 'the cave ladder up', [], 8);
    s.want = null;
}

/** Zooknock's story, then the amulet items (gold bar, dentures, mould) -> the enchanted bar. */
export async function zooknockAmulet(q: Quest): Promise<void> {
    await toZooknock(q);
    // His story (found -> told -> learned -> mission -> need_items) ends on a menu: the amulet question
    // once, then its sub-menu's "I'll be back later.". A cave mob's hit closes the story halfway (qlmmD's
    // gold bar was refused): talk again until the journal lists the items he is collecting.
    for (let k = 0; k < 4 && !/collecting items for Zooknock/i.test(await journalProse(q)); k++) {
        await fightOff(q, NPC.melee, 'Zooknock');
        await talkTo(q, /^zooknock$/i, [/what do we need for the monkey amulet/i], { label: 'Zooknock', ticks: 250 });
        if (q.sdk.getDialog()?.isOpen) await drive(q, [/i'?ll be back later/i], 20);
        await q.sdk.sendCloseModal().catch(() => undefined);
    }
    for (const id of [OBJ.goldBar, OBJ.dentures, OBJ.mould]) {
        if (!held(q, id)) continue;
        await useOnNpc(q, id, /^zooknock$/i, () => !held(q, id) && !q.sdk.getDialog()?.isOpen, `Zooknock: item ${id}`);
    }
    if (!held(q, OBJ.enchantedBar)) q.log('mm: Zooknock has not made the enchanted bar yet');
}

/** Use held item `id` on the nearest `npc` until `done`. */
export async function useOnNpc(q: Quest, id: number, npc: RegExp, done: () => boolean, label: string): Promise<void> {
    for (let k = 0; k < 3 && !done(); k++) {
        await clearPages(q);
        const item = q.sdk.getInventory().find((i) => i.id === id);
        const n = q.sdk.findNearbyNpc(npc);
        if (!item || !n) throw new Error(`mm: ${label}: ${item ? 'npc' : 'item'} not here (at ${where(q)})`);
        await q.bot.useItemOnNpc(item, n).catch(() => undefined);
        await untilTicks(q.sdk, (s) => !!s.dialog?.isOpen || done(), 15);
        await drive(q, [/.*/], 40, done);
    }
    if (!done()) throw new Error(`mm: ${label} failed (at ${where(q)})`);
}

// ── the temple, the wall of flame, the amulet

/** The trapdoor guards' spawns (m43_43 npc 1460, SW tiles): they hold a human only within 3 of these. */
const GUARD_SPAWNS: Tile[] = [{ x: 2803, z: 2785 }, { x: 2805, z: 2783 }, { x: 2805, z: 2786 }];
const inGuardReach = (t: Tile) => GUARD_SPAWNS.some((g) => {
    const dx = Math.abs(t.x - g.x);
    const dz = Math.abs(t.z - g.z);
    return Math.max(dx, dz) <= 3 && !(dx === 3 && dz === 3);
});

/** Auto-retaliate on/off (combat tab: 150 on, 151 off; player_controls.rs2). */
export async function setRetaliate(q: Quest, on: boolean): Promise<void> {
    if (q.sdk.getState()?.autoRetaliateEnabled === undefined || q.sdk.getState()?.autoRetaliateEnabled === on) return;
    for (let attempt = 1; attempt <= 3 && q.sdk.getState()?.autoRetaliateEnabled !== on; attempt++) {
        await q.sdk.sendSetTab(12).catch(() => undefined);
        await q.sdk.waitForTicks(1);
        await q.sdk.sendClickComponent(on ? 150 : 151);
        await untilTicks(q.sdk, (st) => st.autoRetaliateEnabled === on, 4);
    }
    await q.sdk.sendSetTab(3).catch(() => undefined);
}

const TRAPDOOR = { x: 2807, z: 2785 };
const TRAPDOOR_STAND = { x: 2806, z: 2785 };
const TEMPLE_ROPE = { x: 2808, z: 9201, id: 4881 };

/** Kill the temple guard (a size-2 gorilla) right next to us: they box the trapdoor. */
async function fightOff(q: Quest, ids: number[], label: string): Promise<boolean> {
    let fought = false;
    for (let k = 0; k < 3; k++) {
        const foe = mobs(q, ids).find((m) => m.d <= 2);
        if (!foe) break;
        fought = true;
        q.log(`mm: ${label}: fighting npc ${foe.id} at (${foe.x},${foe.z})`);
        if (q.sdk.getDialog()?.isOpen) await q.sdk.sendCloseModal().catch(() => undefined);
        await q.sdk.sendInteractNpc(foe.index, 2).catch(() => undefined);
        await untilTicks(q.sdk, () => !mobs(q, ids).some((m) => m.index === foe.index), 60);
    }
    return fought;
}

/** Down the temple trapdoor, the enchanted bar on the wall of flame, string it, wear it, back up. */
export async function makeAmulet(q: Quest): Promise<void> {
    const s = safe(q);
    const done = () => worn(q, OBJ.amulet);
    if (done()) return;
    if (!held(q, OBJ.amulet) && !held(q, OBJ.amuletUnstrung)) {
        if (!held(q, OBJ.enchantedBar)) throw new Error('mm: no enchanted gold bar for the wall of flame');
        if (inZooknockCave(pos(q))) await leaveCave(q);
        if (inCellar(pos(q))) await cellar(q);
        if (!inTempleCave(pos(q))) {
            if (!inVillage(pos(q)) && !inJail(pos(q))) await getJailed(q, 'jail (to the temple)');
            s.want = 'protect_from_melee';
            // Auto-retaliate off: a guard's hit (0 under Protect from Melee) otherwise turns the trapdoor op
            // into a fight with it (auto_retaliate.rs2 p_opnpc), and fighting them killed qlmmA.
            await setRetaliate(q, false);
            try {
                const t0 = tickNow(q.sdk);
                let inReach = tickNow(q.sdk);
                while (pos(q).z < 6400 && tickNow(q.sdk) - t0 < 900) {
                    await clearPages(q);
                    checkSupplies(q, 'the temple trapdoor');
                    if (inJail(pos(q))) await escapeJail(q, 'temple (escape)');
                    const me = pos(q);
                    if (!inGuardReach(me)) inReach = tickNow(q.sdk);
                    if (cheb(me, TRAPDOOR_STAND) === 0) {
                        await q.sdk.scanNearbyLocs(3).catch(() => undefined);
                        const td = (q.sdk.getNearbyLocs() ?? []).find((l) => l.x === TRAPDOOR.x && l.z === TRAPDOOR.z && /trapdoor/i.test(l.name));
                        const opt = td?.optionsWithIndex.find((o) => /climb-down/i.test(o.text)) ?? td?.optionsWithIndex.find((o) => /open/i.test(o.text));
                        if (td && opt) await q.sdk.sendInteractLoc(td.x, td.z, td.id, opt.opIndex);
                        await untilTicks(q.sdk, () => pos(q).z > 6400, 4);
                        continue;
                    }
                    if (tickNow(q.sdk) - inReach >= 30) {
                        // Boxed by the guards: out of their reach (they drop us and wander home), then again.
                        q.log(`mm: temple: boxed at (${me.x},${me.z}) by guards ${mobs(q, NPC.templeGuards).map((m) => `${m.x},${m.z}`).join(' ')}: backing off`);
                        await walk(q, { x: 2797, z: 2785 }, 1);
                        await q.sdk.waitForTicks(10);
                        inReach = tickNow(q.sdk);
                        continue;
                    }
                    if (cheb(me, { x: 2803, z: 2785 }) > 3 && !inGuardReach(me)) await walk(q, { x: 2802, z: 2785 }, 1);
                    await q.sdk.sendWalk(TRAPDOOR_STAND.x, TRAPDOOR_STAND.z, false);
                    await untilTicks(q.sdk, () => cheb(pos(q), TRAPDOOR_STAND) === 0, 4);
                }
            } finally {
                await setRetaliate(q, true);
            }
            if (pos(q).z < 6400) throw new Error(`mm: not down the temple trapdoor (at ${where(q)})`);
        }
        await walk(q, { x: 2809, z: 9191 }, 0);
        for (let k = 0; k < 3 && !held(q, OBJ.amuletUnstrung); k++) {
            const bar = q.sdk.getInventory().find((i) => i.id === OBJ.enchantedBar);
            if (!bar) break;
            await q.sdk.sendUseItemOnLoc(bar.slot, 2809, 9191, 4765);
            await untilTicks(q.sdk, () => held(q, OBJ.amuletUnstrung), 8);
            await clearPages(q);
        }
        if (!held(q, OBJ.amuletUnstrung)) throw new Error(`mm: the wall of flame made no amulet (at ${where(q)})`);
    }
    for (let k = 0; k < 4 && !held(q, OBJ.amulet) && !worn(q, OBJ.amulet); k++) {
        await clearPages(q);
        const a = q.sdk.getInventory().find((i) => i.id === OBJ.amuletUnstrung);
        const w = q.sdk.getInventory().find((i) => /^ball of wool$/i.test(i.name));
        if (!a || !w) throw new Error('mm: no ball of wool to string the amulet');
        await q.sdk.sendUseItemOnItem(w.slot, a.slot);
        await untilTicks(q.sdk, () => held(q, OBJ.amulet), 6);
    }
    for (let k = 0; k < 3 && !worn(q, OBJ.amulet); k++) {
        const a = q.sdk.getInventory().find((i) => i.id === OBJ.amulet);
        if (a) await q.bot.equipItem(a).catch(() => undefined);
        await untilTicks(q.sdk, () => worn(q, OBJ.amulet), 4);
    }
    if (!worn(q, OBJ.amulet)) throw new Error('mm: could not wear the monkey speak amulet');
    q.log('mm: wearing the amulet of monkey speak');
}

/** Up the temple rope and out of the temple west, round the guards (auto-retaliate off). */
export async function leaveTemple(q: Quest): Promise<void> {
    const s = safe(q);
    s.want = 'protect_from_melee';
    await setRetaliate(q, false);
    try {
        if (inTempleCave(pos(q))) {
            await walk(q, { x: 2808, z: 9202 }, 1);
            await opLoc(q, TEMPLE_ROPE, /rope/i, /climb/i, () => pos(q).z < 6400, 'the temple rope', [], 8);
        }
        const t0 = tickNow(q.sdk);
        let stuck = 0;
        let dips = 0;
        while (inTemple(pos(q)) && pos(q).x > 2796 && tickNow(q.sdk) - t0 < 1200) {
            checkSupplies(q, 'the temple exit');
            await clearPages(q);
            const before = pos(q);
            // The outer aisles (z 2777 / z 2793) skirt the guards' reach.
            const aisle = before.z <= 2785 ? { x: 2797, z: 2777 } : { x: 2797, z: 2793 };
            await q.sdk.sendWalk(aisle.x, aisle.z, true);
            await untilTicks(q.sdk, () => cheb(pos(q), before) > 0, 4);
            stuck = cheb(pos(q), before) === 0 ? stuck + 1 : 0;
            if (stuck >= 8) {
                stuck = 0;
                dips++;
                q.log(`mm: temple exit: boxed at ${where(q)} by ${mobs(q, NPC.templeGuards).filter((m) => m.d <= 2).length} guards (try ${dips})`);
                // Boxed in by the guards: down the trapdoor and up the rope again (a new random landing,
                // and off the floor every guard drops us); fighting them killed qlmmA. Only from the stand:
                // boxed elsewhere, fight the guard holding us (Protect from Melee: their hits are 0).
                if (cheb(pos(q), TRAPDOOR_STAND) === 0 || (cheb(pos(q), TRAPDOOR_STAND) <= 1 && dips % 2 === 1)) {
                    await q.sdk.sendWalk(TRAPDOOR_STAND.x, TRAPDOOR_STAND.z, false);
                    await untilTicks(q.sdk, () => cheb(pos(q), TRAPDOOR_STAND) === 0, 4);
                    await q.sdk.scanNearbyLocs(3).catch(() => undefined);
                    const td = (q.sdk.getNearbyLocs() ?? []).find((l) => l.x === TRAPDOOR.x && l.z === TRAPDOOR.z && /trapdoor/i.test(l.name));
                    const opt = td?.optionsWithIndex.find((o) => /climb-down/i.test(o.text)) ?? td?.optionsWithIndex.find((o) => /open/i.test(o.text));
                    if (td && opt) await q.sdk.sendInteractLoc(td.x, td.z, td.id, opt.opIndex);
                    if (await untilTicks(q.sdk, () => pos(q).z > 6400, 6)) {
                        await q.sdk.waitForTicks(8);
                        await walk(q, { x: 2808, z: 9202 }, 1);
                        await opLoc(q, TEMPLE_ROPE, /rope/i, /climb/i, () => pos(q).z < 6400, 'the temple rope', [], 8);
                    }
                } else {
                    await setRetaliate(q, true);
                    await fightOff(q, NPC.templeGuards, 'temple exit');
                    await setRetaliate(q, false);
                }
            }
        }
    } finally {
        await setRetaliate(q, true);
    }
    s.want = null;
    if (inTemple(pos(q)) && pos(q).x > 2796) throw new Error(`mm: the temple exit: still boxed in by the guards (at ${where(q)})`);
}

// ── the monkey child

/** East of the garden's south gate (2743,2791), the way in: the long grass north of it has no way into the garden (qlmmB walked round by the Aunt's house and was jailed). */
const GARDEN_WAIT = { x: 2750, z: 2791 };
const GATE = { x: 2743, z: 2791 };
const inGarden = (t: Tile) => inBox(t, 2740, 2746, 2792, 2798);
const inHouse = (t: Tile) => inBox(t, 2733, 2739, 2792, 2794);

/** The monkey child: uncle, bananas, 100 ticks, the talisman; dodging the Aunt. */
export async function talisman(q: Quest): Promise<void> {
    safe(q);
    if (held(q, OBJ.talisman)) return;
    if (!worn(q, OBJ.amulet)) throw new Error('mm: the monkey child needs the amulet of monkey speak worn');
    if (!inVillage(pos(q)) && !inJail(pos(q))) await getJailed(q, 'jail (to the child)');
    await villageWalk(q, GARDEN_WAIT, 'the garden', 1);
    const answers = [/well i'?ll be a monkey'?s uncle/i, /how many bananas did aunty want/i, /^yes/i];
    let given = held(q, OBJ.banana) ? -1 : tickNow(q.sdk);
    let lastOp = -9;
    const t0 = tickNow(q.sdk);
    let lastLog = -99;
    while (!held(q, OBJ.talisman) && tickNow(q.sdk) - t0 < 2500) {
        checkSupplies(q, 'the monkey child');
        if (inJail(pos(q))) {
            q.log(`mm: the garden: jailed (${(q.sdk.getState()?.gameMessages ?? []).slice(-3).map((m) => m.text).join(' | ')})`);
            await villageWalk(q, GARDEN_WAIT, 'the garden (again)', 1);
            continue;
        }
        const t = tickNow(q.sdk);
        const me = pos(q);
        const aunt = mobs(q, [NPC.aunt])[0];
        const meIn = inGarden(me);
        const auntIn = !!aunt && inGarden(aunt);
        if (t - lastLog >= 25) {
            lastLog = t;
            const c = mobs(q, [NPC.child])[0];
            q.log(`mm: the garden: me (${me.x},${me.z}) aunt ${aunt ? `${aunt.x},${aunt.z}` : '-'} child ${c ? `${c.x},${c.z}` : '-'} dialog ${!!q.sdk.getDialog()?.isOpen} bananas ${q.count('banana')}`);
        }
        if (given < 0 && !held(q, OBJ.banana)) {
            given = t;
            q.log('mm: bananas given; 100 ticks for the talisman');
        }
        const safeAt = (p: Tile) => !aunt || cheb(aunt, p) > 5 || inGarden(aunt) !== inGarden(p) || (inHouse(aunt) && !inBox(p, 2732, 2739, 2789, 2796));
        const wantTalk = given < 0 || t - given >= 100;
        const mayEnter = aunt ? inHouse(aunt) || (!auntIn && cheb(aunt, GATE) > 6) : true;
        if ((meIn && auntIn) || (!meIn && !safeAt(me)) || (!wantTalk && (meIn || cheb(me, GARDEN_WAIT) > 0)) || (!meIn && !mayEnter && cheb(me, GARDEN_WAIT) > 0)) {
            if (q.sdk.getDialog()?.isOpen && meIn && auntIn) await q.sdk.sendCloseModal().catch(() => undefined);
            if (cheb(me, GARDEN_WAIT) > 0) await q.sdk.sendWalk(GARDEN_WAIT.x, GARDEN_WAIT.z, true);
        } else if (!meIn && !mayEnter) {
            // waiting at the garden's east side
        } else if (q.sdk.getDialog()?.isOpen) {
            const d = q.sdk.getDialog()!;
            const opts = d.options ?? [];
            const cont = opts.find((o) => /click here to continue/i.test(o.text));
            // A continue goes as option 0 (a bare resume the client refuses on a choice page): clicking the
            // continue button's index 1 every tick landed on the next page's FIRST choice once the page
            // turned ("I'm a monkey's brother!" instead of the uncle, qlmmChld2 2026-11-05).
            const pick = cont ? null : answers.map((re) => opts.find((o) => re.test(o.text))).find(Boolean);
            if (cont) await q.sdk.sendClickDialog(0);
            else if (pick) {
                const before = JSON.stringify(opts);
                await q.sdk.sendClickDialog(pick.index);
                await untilTicks(q.sdk, () => JSON.stringify(q.sdk.getDialog()?.options ?? []) !== before, 4);
            }
        } else if (wantTalk && t - lastOp >= 4) {
            const c = q.sdk.findNearbyNpc(/^monkey child$/i);
            if (c) {
                await q.sdk.sendInteractNpc(c.index, 1);
                lastOp = t;
            }
        }
        await q.sdk.waitForTicks(1);
    }
    if (!held(q, OBJ.talisman)) throw new Error(`mm: no talisman from the monkey child (bananas ${q.count('banana')})`);
    q.log('mm: holding the monkey talisman');
}

/** Zooknock: the talisman and the Karamja monkey bones -> the greegree; the chapter 3 cutscene. */
export async function zooknockGreegree(q: Quest): Promise<void> {
    await toZooknock(q);
    for (const id of [OBJ.talisman, OBJ.monkeyBones]) {
        if (!held(q, id) || held(q, OBJ.greegree)) continue;
        await fightOff(q, NPC.melee, 'Zooknock');
        await useOnNpc(q, id, /^zooknock$/i, () => (!held(q, id) || held(q, OBJ.greegree)) && !q.sdk.getDialog()?.isOpen, `Zooknock: item ${id}`);
    }
    await untilTicks(q.sdk, () => held(q, OBJ.greegree), 10);
    if (!held(q, OBJ.greegree)) {
        // He has both but his spell was cut short (p_delay 4 before the greegree; qlmmD came away with
        // nothing): more monkey remains, "use these instead?" Yes, runs it again (mm_zooknock.rs2).
        const has = await zooknockHas(q);
        if (has.talisman && has.bones) {
            if (!held(q, OBJ.monkeyBones)) throw new Error('mm: Zooknock needs monkey bones again (his greegree spell was cut short)');
            await fightOff(q, NPC.melee, 'Zooknock');
            await useOnNpc(q, OBJ.monkeyBones, /^zooknock$/i, () => (!held(q, OBJ.monkeyBones) || held(q, OBJ.greegree)) && !q.sdk.getDialog()?.isOpen, 'Zooknock: bones again');
            await untilTicks(q.sdk, () => held(q, OBJ.greegree), 10);
        }
    }
    // The chapter 3 cutscene: pages, a walk trigger, back in the cave.
    const t0 = tickNow(q.sdk);
    while (tickNow(q.sdk) - t0 < 400) {
        if (q.sdk.getDialog()?.isOpen) await drive(q, [/.*/], 60, undefined, 6);
        else if (!(await untilTicks(q.sdk, (s) => !!s.dialog?.isOpen, 10))) {
            if (inAtollCaves(pos(q))) break;
            const p = pos(q);
            await q.sdk.sendWalk(p.x, p.z + 1, false).catch(() => undefined);
        }
    }
    await q.sdk.sendCloseModal().catch(() => undefined);
    if (!held(q, OBJ.greegree)) throw new Error(`mm: no greegree from Zooknock (at ${where(q)})`);
    q.log('mm: holding the Karamja monkey greegree');
}

// ── the greegree, the ravine gate

/** Wear the greegree ("whilst in combat" for 10 ticks after a hit: fight the attacker off first). */
export async function wearGreegree(q: Quest): Promise<void> {
    await wearAmulet(q);
    for (let k = 0; k < 12 && !greegreeOn(q); k++) {
        await clearPages(q);
        const since = cursor(q);
        const g = q.sdk.getInventory().find((i) => i.id === OBJ.greegree);
        if (!g) throw new Error('mm: no greegree held');
        // Its option is "Hold" ([opheld2,_mm_greegree] checks the zone and combat): bot.equipItem knows Wield/Wear only.
        await q.sdk.sendUseItem(g.slot, 2).catch(() => undefined);
        if (await untilTicks(q.sdk, () => greegreeOn(q), 4)) break;
        if (said(q, since, /whilst in combat/i)) {
            await fightOff(q, NPC.melee, 'greegree');
            // The archers keep a human in combat from range: into the long jungle grass (they cannot
            // shoot into it, mm_archer.rs2) for the 10 ticks, then equip (qlmmC on the beach, 2026-11-05).
            await q.sdk.scanNearbyLocs(12).catch(() => undefined);
            const grass = (q.sdk.getNearbyLocs() ?? [])
                .filter((l) => [4812, 4813, 4814].includes(l.id) && l.reachable !== false)
                .sort((a, b) => (a.distance ?? 99) - (b.distance ?? 99))[0];
            if (grass) {
                await q.sdk.sendWalk(grass.x, grass.z, true);
                await untilTicks(q.sdk, () => pos(q).x === grass.x && pos(q).z === grass.z, 12);
            }
            await q.sdk.waitForTicks(11);
        }
    }
    if (!greegreeOn(q)) throw new Error('mm: could not wear the greegree');
}

/** The ravine gate (monkeys only), north to the village side or south to the beach side. */
export async function ravineGate(q: Quest, north: boolean): Promise<void> {
    const done = () => (north ? pos(q).z >= 2768 : pos(q).z <= 2765) && pos(q).x >= 2712 && pos(q).x <= 2730;
    if (done()) return;
    if (!greegreeOn(q)) await wearGreegree(q);
    // From Garkor's side of the hall: round the Elder Guard by the strip at z 2755 (he blocks the doorway gap).
    if (!north && cheb(pos(q), { x: 2801, z: 2757 }) <= 6) {
        for (const t of [{ x: 2804, z: 2755 }, { x: 2795, z: 2755 }]) {
            await q.sdk.sendWalk(t.x, t.z, true);
            await untilTicks(q.sdk, () => cheb(pos(q), t) <= 1, 20);
        }
    }
    const stand = north ? { x: 2720, z: 2765 } : { x: 2720, z: 2767 };
    await walk(q, stand, 0);
    for (let k = 0; k < 3 && cheb(pos(q), stand) > 0; k++) {
        await q.sdk.sendWalk(stand.x, stand.z, false);
        await untilTicks(q.sdk, () => cheb(pos(q), stand) === 0, 6);
    }
    for (let k = 0; k < 3 && !done(); k++) {
        await q.sdk.sendInteractLoc(2719, 2766, 4787, 1);
        await untilTicks(q.sdk, done, 10);
        await clearPages(q);
    }
    if (!done()) throw new Error(`mm: the ravine gate ${north ? 'north' : 'south'} (at ${where(q)})`);
}


// ── to and from the atoll

const LUMDO_ATOLL = { x: 2803, z: 2709 };
const DAERO_BAR = { x: 2484, z: 3486, level: 1 };

/** From the mainland (or Crash Island / the hangar): Daero's blindfold, Waydar's glider, Lumdo's boat. */
export async function toAtoll(q: Quest): Promise<void> {
    const { inHangar2, onCrashIsland, onApeAtoll } = await import('./monkey-madness');
    const { upTree } = await import('./grand-tree');
    if (onApeAtoll(pos(q))) return;
    if (!onCrashIsland(pos(q))) {
        if (!inHangar2(pos(q))) {
            await upTree(q, 1);
            await talkTo(q, /^daero$/i, [/^yes/i], { at: DAERO_BAR, done: () => inHangar2(pos(q)), ticks: 60, label: 'Daero (back to the hangar)' });
            await drive(q, [], 10);
        }
        await talkTo(q, /^waydar$/i, [/^yes$/i], { done: () => onCrashIsland(pos(q)), ticks: 60, label: 'Waydar (to Crash Island)' });
        await q.sdk.sendCloseModal().catch(() => undefined);
    }
    await talkTo(q, /^lumdo$/i, [], { done: () => onApeAtoll(pos(q)), ticks: 40, label: 'Lumdo (to the atoll)' });
    await drive(q, [], 10);
    q.log(`mm: on Ape Atoll at ${where(q)}`);
}

/** Off the atoll to the Gnomeball pitch: out of caves/jail/village, Lumdo to Crash Island, Waydar home. */
export async function leaveAtoll(q: Quest): Promise<void> {
    const { onCrashIsland, onApeAtoll } = await import('./monkey-madness');
    if (onApeAtoll(pos(q))) {
        safe(q);
        if (inTempleCave(pos(q))) await leaveTemple(q);
        else if (inCellar(pos(q))) await cellar(q);
        else if (inZooknockCave(pos(q))) await leaveCave(q);
        // Holding the greegree (chapter 3 on): out as a monkey. As a human the guards jail us on the way to the
        // beach, and after the demon (Zooknock drops us at the village's west, sharks spent) the jail escape gave
        // up "out of food and prayer" (qlkmm1, staging 2026-11-04). The whole atoll is mm_greegree_zone.
        if (!greegreeOn(q) && q.sdk.getInventory().some((i) => i.id === OBJ.greegree) && onAtollSurface(pos(q))) {
            await wearGreegree(q).catch((e) => q.log(`mm: leaving the atoll: greegree not on (${(e as Error).message})`));
            if (greegreeOn(q)) q.log(`mm: leaving the atoll as a monkey from ${where(q)}`);
        }
        if (inJail(pos(q))) await escapeJail(q, 'leaving the atoll');
        if (inHall(pos(q))) await leaveHall(q);
        if (!onBeach(pos(q))) {
            if (greegreeOn(q)) await ravineGate(q, false);
            else await toBeach(q);
        }
        if (onApeAtoll(pos(q))) await talkTo(q, /^lumdo$/i, [/crash island/i], { at: LUMDO_ATOLL, done: () => onCrashIsland(pos(q)), ticks: 40, label: 'Lumdo (to Crash Island)' });
    }
    await unsafe();
    if (onCrashIsland(pos(q))) {
        await talkTo(q, /^waydar$/i, [/return to your kingdom|take me back to your kingdom/i], { done: () => !onCrashIsland(pos(q)), ticks: 60, label: 'Waydar (home)' });
        await q.sdk.sendCloseModal().catch(() => undefined);
    }
    q.log(`mm: off the atoll at ${where(q)}`);
}

// ── the journal's item lines and kit

/** The Monkey Madness journal's raw lines (tags intact: @str@ = done). */
export async function journalRaw(q: Quest): Promise<string> {
    await q.sdk.sendCloseModal().catch(() => undefined);
    const read = await readJournalCheckpoint(q.sdk, { label: 'Monkey Madness', title: 'Monkey Madness' }, { id: 'mm:raw', kind: 'active', all: [] });
    await q.sdk.sendCloseModal().catch(() => undefined);
    return read.rawLines.map((l) => l.rawText).join('\n');
}

/** The Monkey Madness journal as prose: tags stripped, the pixel-width line breaks joined by spaces. */
export async function journalProse(q: Quest): Promise<string> {
    return (await journalRaw(q)).replace(/@\w{3}@/g, '').replace(/\s+/g, ' ');
}

/** What Zooknock already has (journal: "@str@ - A gold bar." once handed). */
export async function zooknockHas(q: Quest): Promise<{ goldBar: boolean; mould: boolean; dentures: boolean; talisman: boolean; bones: boolean }> {
    const raw = await journalRaw(q);
    const has = (text: string) => new RegExp(`@str@\\s*-\\s*${text}`, 'i').test(raw);
    // Short prefixes: the client wraps "An authentic magical monkey / talisman." by pixel width, and a
    // whole-phrase match missed the handed talisman (qlmmD went back to the monkey child).
    return {
        goldBar: has('A gold bar'),
        mould: has('A monkey amulet'),
        dentures: has('Something to do'),
        talisman: has('An authentic'),
        bones: has('Some kind of'),
    };
}

/** The amulet of monkey speak back on (a bank visit takes everything off). */
export async function wearAmulet(q: Quest): Promise<void> {
    for (let k = 0; k < 3 && !worn(q, OBJ.amulet); k++) {
        const a = q.sdk.getInventory().find((i) => i.id === OBJ.amulet);
        if (!a) return;
        await q.bot.equipItem(a).catch(() => undefined);
        await untilTicks(q.sdk, () => worn(q, OBJ.amulet), 4);
    }
}

/** Wield the best melee weapon held (not over the greegree), and the amulet of monkey speak. */
export async function arm(q: Quest): Promise<void> {
    await wearAmulet(q);
    if (greegreeOn(q)) return;
    if (q.sdk.getEquipment().some((i) => /scimitar|longsword|sword|whip|battleaxe|mace|dagger|axe/i.test(i.name))) return;
    const w = q.sdk.getInventory().find((i) => /(dragon|rune|adamant|mithril|black|steel|iron) (scimitar|longsword)/i.test(i.name));
    if (w) {
        await q.bot.equipItem(w).catch(() => undefined);
        await untilTicks(q.sdk, () => q.sdk.getEquipment().some((i) => i.id === w.id), 4);
    }
}

/** Chapter 2, up to the enchanted bar: Garkor's story is done; dentures, mould, gold bar to Zooknock. */
export async function amuletItems(q: Quest): Promise<void> {
    safe(q);
    await arm(q);
    let has = await zooknockHas(q);
    const needDentures = !has.dentures && !held(q, OBJ.dentures);
    const needMould = !has.mould && !held(q, OBJ.mould);
    if ((needDentures || needMould) && !inAtollCaves(pos(q))) await warehouse(q, needDentures);
    if (inCellar(pos(q))) await cellar(q);
    await zooknockAmulet(q);
    has = await zooknockHas(q);
    if (!held(q, OBJ.enchantedBar) && !(has.goldBar && has.mould && has.dentures)) throw new Error(`mm: Zooknock still needs amulet items (${JSON.stringify(has)})`);
}

/** Chapter 2's end: the amulet of monkey speak, the child's talisman, the greegree. */
export async function greegreeItems(q: Quest): Promise<void> {
    safe(q);
    await arm(q);
    const has = await zooknockHas(q);
    if (!has.talisman && !held(q, OBJ.talisman)) {
        if (!worn(q, OBJ.amulet) && !held(q, OBJ.amulet) && !held(q, OBJ.amuletUnstrung)) {
            // The temple's guards killed two of three accounts that went in half-stocked (qlmmA, qlmmD):
            // full food and prayer first.
            await topUp(q, FIGHT_WANTS.map((w) => ({ ...w, min: w.label === 'shark' ? 10 : w.label === 'prayer potion' ? 4 : w.min })).concat([
                { re: /^ball of wool$/i, count: 1, min: 1, label: 'ball of wool' },
            ]));
            const { toAtoll: back } = await import('./ape-atoll');
            await back(q);
            safe(q);
            await arm(q);
        }
        if (!worn(q, OBJ.amulet)) await makeAmulet(q);
        await leaveTemple(q);
        await talisman(q);
    }
    if (inTempleCave(pos(q))) await leaveTemple(q);
    await zooknockGreegree(q);
}

// ── Chapter 3: a Karamja monkey

const ELDER = { x: 2801, z: 2755 };
const THRONE = { x: 2802, z: 2765, id: 4771 };
const ADVISERS = [1449, 1450];
/** Awowogei's hall behind the Elder Guard (rs-stun-toolkit inHallK; z 2758 is the doorway outside it). */
const inHall = (p: Tile) => p.level === 0 && inBox(p, 2795, 2806, 2759, 2770) && !inBox(p, 2805, 2810, 2759, 2765);
/** Kruk's ravine pocket below the walkway (2729,2766) east of the west watchtower. */
const ZOO = { x: 2597, z: 3277 };
export const inZooCage = (t: Tile) => inBox(t, 2598, 2600, 3274, 3278) || inBox(t, 2600, 2604, 3276, 3282) || inBox(t, 2605, 2606, 3276, 3281);

/**
 * To Garkor's nook as a monkey from the ravine gate side: the planner routes past the Elder Guard
 * (2801,2757), who blocks the gap (qlmmC stuck at 2800,2758 eight times). Round him by the open strip at
 * z 2755, as rs-stun-toolkit does after talking to him.
 */
async function toGarkor(q: Quest): Promise<void> {
    if (cheb(pos(q), GARKOR_STAND) <= 1) return;
    if (pos(q).z <= 2760 || cheb(pos(q), { x: 2801, z: 2757 }) <= 6) {
        for (const t of [{ x: 2795, z: 2755 }, { x: 2804, z: 2755 }]) {
            await q.sdk.sendWalk(t.x, t.z, true);
            await untilTicks(q.sdk, () => cheb(pos(q), t) <= 1, 20);
        }
    }
    await walk(q, GARKOR_STAND, 1);
}

/**
 * The doorway's Elder Guard (mm_elder_guard_2, npc 1462): from inside he forcemoves a monkey out south, from
 * outside (Kruk spoken) he lets it in. The one inside the hall (1461) only growls.
 */
async function elderGuard(q: Quest, done: () => boolean, label: string): Promise<void> {
    for (let k = 0; k < 4 && !done(); k++) {
        if (q.sdk.getDialog()?.isOpen) await drive(q, [/leave now|speak with awowogei again/i, /.*/], 20, done);
        const g = (q.sdk.getState()?.nearbyNpcs ?? []).find((n) => n.id === 1462);
        if (!g) {
            await walk(q, ELDER, 2);
            continue;
        }
        const res = await q.bot.talkTo(g).catch((e) => ({ success: false, message: String(e) }));
        if (!res.success) await q.sdk.sendInteractNpc(g.index, 1).catch(() => undefined);
        await untilTicks(q.sdk, (st) => !!st.dialog?.isOpen || done(), 10);
        await drive(q, [/leave now|speak with awowogei again/i, /.*/], 40, done);
        await untilTicks(q.sdk, done, 6);
    }
    if (!done()) throw new Error(`mm: ${label}: the Elder Guard did not move us (at ${where(q)})`);
}

/** Out of Awowogei's hall by the doorway's Elder Guard. */
async function leaveHall(q: Quest): Promise<void> {
    await elderGuard(q, () => !inHall(pos(q)), 'out of the hall');
}

/** Greegree on, out of Zooknock's cave, through the ravine gate, Garkor (seek alliance) and the Elder Guard. */
export async function seekAlliance(q: Quest): Promise<void> {
    safe(q);
    await wearGreegree(q);
    if (inZooknockCave(pos(q))) await leaveCave(q);
    if (!inVillage(pos(q))) await ravineGate(q, true);
    await toGarkor(q);
    await talkTo(q, /^garkor$/i, [/.*/], { at: GARKOR_STAND, label: 'Garkor (alliance)', ticks: 120 });
    await talkTo(q, /^elder guard$/i, [/.*/], { at: ELDER, label: 'Elder Guard', ticks: 40 }).catch((e) => q.log(String(e)));
}

/** Kruk's pocket by the watchtowers, Kruk's escort, Awowogei's throne (advisers near), out by the Elder Guard. */
export async function awowogeiMission(q: Quest, missionGiven: () => Promise<boolean>): Promise<void> {
    safe(q);
    await wearGreegree(q);
    if (inZooknockCave(pos(q))) await leaveCave(q);
    if (!(await missionGiven())) {
        if (!inHall(pos(q))) {
            if (onBeach(pos(q)) || (pos(q).z <= 2765 && pos(q).x <= 2730)) await ravineGate(q, true);
            if (cheb(pos(q), { x: 2801, z: 2757 }) <= 3) for (const t of [{ x: 2804, z: 2755 }, { x: 2795, z: 2755 }]) await walk(q, t, 0);
            // The west watchtower (from the west), the walkway, the east tower down into Kruk's pocket.
            await walk(q, { x: 2712, z: 2766 }, 0);
            await opLoc(q, { x: 2713, z: 2766, id: 4775 }, /ladder/i, /climb-up/i, () => pos(q).level === 2, 'the west watchtower', [], 8);
            await walk(q, { x: 2730, z: 2766 }, 0);
            await opLoc(q, { x: 2729, z: 2766, id: 4776 }, /ladder/i, /climb-down/i, () => pos(q).level === 0, 'the east watchtower', [], 8);
            await talkTo(q, /^kruk$/i, [/.*/], { done: () => inHall(pos(q)), label: 'Kruk', ticks: 60 });
        }
        const seen = { text: '' };
        for (let k = 0; k < 8 && !/with one of the captives/i.test(seen.text); k++) {
            await untilTicks(q.sdk, () => ADVISERS.every((id) => mobs(q, [id]).some((m) => m.d <= 6)), 40);
            await walk(q, { x: 2802, z: 2764 }, 0);
            await q.sdk.sendInteractLoc(THRONE.x, THRONE.z, THRONE.id, 1);
            await untilTicks(q.sdk, (st) => !!st.dialog?.isOpen, 10);
            seen.text += await drive(q, [/.*/], 80);
        }
        if (!(await missionGiven())) throw new Error(`mm: Awowogei gave no captive mission (at ${where(q)})`);
    }
    if (inHall(pos(q))) await leaveHall(q);
}

/** Leave the atoll for the zoo: the backpack monkey, then on foot (no teleports) back to the Grand Tree. */
export async function zooMonkey(q: Quest): Promise<void> {
    const { onApeAtoll, onCrashIsland } = await import('./monkey-madness');
    await wearAmulet(q);
    if (!held(q, OBJ.backpackMonkey) && !inZooCage(pos(q))) {
        if (onApeAtoll(pos(q)) || onCrashIsland(pos(q))) await leaveAtoll(q);
        await unsafe();
        if (worn(q, OBJ.greegree)) {
            await q.bot.unequipItem(/greegree/i).catch(() => undefined);
            await untilTicks(q.sdk, () => !greegreeOn(q), 4);
        }
        await q.goTo(ZOO, 3);
        await wearGreegree(q);
        await talkTo(q, /^monkey minder$/i, [/.*/], { done: () => inZooCage(pos(q)), label: 'the monkey minder (in)', ticks: 40 });
    }
    if (!held(q, OBJ.backpackMonkey)) {
        // A zoo monkey (npc 1463, Talk-to), not one of the plain monkeys (132) caged with them.
        for (let k = 0; k < 4 && !held(q, OBJ.backpackMonkey); k++) {
            const m = mobs(q, [1463]).sort((a, b) => a.d - b.d)[0];
            const n = m ? (q.sdk.getState()?.nearbyNpcs ?? []).find((x) => x.index === m.index) : undefined;
            if (!n) {
                await q.sdk.waitForTicks(3);
                continue;
            }
            const res = await q.bot.talkTo(n).catch((e) => ({ success: false, message: String(e) }));
            if (!res.success) await q.sdk.sendInteractNpc(n.index, 1).catch(() => undefined);
            await untilTicks(q.sdk, (st) => !!st.dialog?.isOpen || held(q, OBJ.backpackMonkey), 10);
            await drive(q, [], 30);
        }
        if (!held(q, OBJ.backpackMonkey)) throw new Error(`mm: no zoo monkey in the backpack (at ${where(q)})`);
        await leaveZooCage(q);
    }
}

/**
 * The zoo to the Grand Tree on foot: every teleport (spells, spirit trees) deletes the backpack monkey
 * (teleport.rs2 post_tele_checks), and run-quest's goTo would take the spirit trees.
 */
export async function homeOnFoot(q: Quest): Promise<void> {
    const { inStronghold } = await import('./gnome-stronghold');
    const gate = { x: 2461, z: 3379 };
    if (!inStronghold(pos(q))) {
        // walkTo plans the whole mainland (round West Ardougne's wall); travelTo/goTo could take a spirit tree.
        for (let k = 0; k < 6 && cheb(pos(q), gate) > 4; k++) await walk(q, gate, 3);
        const { crossGnomeGate } = await import('./gnome-stronghold');
        await crossGnomeGate(q, true);
    }
    for (const leg of [{ x: 2461, z: 3420 }, { x: 2465, z: 3460 }, { x: 2465, z: 3489 }]) {
        for (let k = 0; k < 3 && cheb(pos(q), leg) > 4; k++) await walk(q, leg, 3);
    }
    if (!held(q, OBJ.backpackMonkey)) throw new Error('mm: the backpack monkey is gone (a teleport on the way?)');
}

/** Out of the zoo's monkey cage: greegree off, the minder telejumps a human out (mm_monkey_minder.rs2). */
export async function leaveZooCage(q: Quest): Promise<void> {
    if (!inZooCage(pos(q))) return;
    if (greegreeOn(q)) {
        await q.bot.unequipItem(/greegree/i).catch(() => undefined);
        await untilTicks(q.sdk, () => !greegreeOn(q), 4);
    }
    await talkTo(q, /^monkey minder$/i, [/.*/], { done: () => !inZooCage(pos(q)), label: 'the monkey minder (out)', ticks: 40 });
}

/** Back on the atoll with the zoo monkey: greegree, the gate, the Elder Guard, the throne. */
export async function deliverMonkey(q: Quest): Promise<void> {
    safe(q);
    await wearGreegree(q);
    if (!inVillage(pos(q))) await ravineGate(q, true);
    if (!inHall(pos(q))) {
        await walk(q, ELDER, 2);
        await elderGuard(q, () => inHall(pos(q)), 'into the hall');
    }
    for (let k = 0; k < 3 && held(q, OBJ.backpackMonkey); k++) {
        await walk(q, { x: 2802, z: 2764 }, 0);
        await q.sdk.sendInteractLoc(THRONE.x, THRONE.z, THRONE.id, 1);
        await untilTicks(q.sdk, (st) => !!st.dialog?.isOpen || !held(q, OBJ.backpackMonkey), 10);
        await drive(q, [/.*/], 80);
    }
    if (held(q, OBJ.backpackMonkey)) throw new Error('mm: Awowogei did not take the zoo monkey');
    if (inHall(pos(q))) await leaveHall(q);
}

// ── Chapter 4: the sigil and the Jungle Demon

/** Garkor: the chapter 4 cutscene (away and back), then the sigil. */
export async function garkorSigil(q: Quest): Promise<void> {
    safe(q);
    await wearGreegree(q);
    if (!inVillage(pos(q))) await ravineGate(q, true);
    const sigil = () => held(q, OBJ.sigil) || worn(q, OBJ.sigil);
    for (let k = 0; k < 4 && !sigil(); k++) {
        await toGarkor(q);
        await talkTo(q, /^garkor$/i, [/.*/], { at: GARKOR_STAND, label: 'Garkor (chapter 4)', ticks: 200, done: () => sigil() });
        // The cutscene takes us away (1_41_71) and back; its pages pause on walk triggers.
        const t0 = tickNow(q.sdk);
        while (!sigil() && tickNow(q.sdk) - t0 < 400) {
            if (q.sdk.getDialog()?.isOpen) await drive(q, [/.*/], 60, sigil, 6);
            else if (!(await untilTicks(q.sdk, (st) => !!st.dialog?.isOpen || sigil(), 8))) {
                if (cheb(pos(q), GARKOR_STAND) <= 4 && pos(q).level === 0) break;
                const p = pos(q);
                await q.sdk.sendWalk(p.x, p.z + 1, false).catch(() => undefined);
            }
        }
        await q.sdk.sendCloseModal().catch(() => undefined);
    }
    if (!sigil()) throw new Error(`mm: no sigil from Garkor (at ${where(q)})`);
}

const inArena = (p: Tile) => p.level === 1 && inBox(p, 2688, 2751, 9152, 9215);
const DEMON = 1472;

export interface Want {
    re: RegExp;
    /** Withdraw up to this many. */
    count: number;
    /** Restock when holding fewer than this. */
    min: number;
    label: string;
}

const have = (q: Quest, re: RegExp) => q.sdk.getInventory().filter((i) => re.test(i.name)).reduce((n, i) => n + (i.count ?? 1), 0);

/**
 * Off the atoll to the Grand Tree's bank (L1, 2449,3483) when any `want` is under its `min`, and withdraw
 * up to `count` of each. Only empty vials are deposited: every quest item stays in the pack. The caller
 * goes back (toAtoll: Daero's bar is on the same floor).
 */
export async function topUp(q: Quest, wants: Want[]): Promise<void> {
    if (wants.every((w) => have(q, w.re) >= w.min)) return;
    q.log(`mm: restocking (${wants.filter((w) => have(q, w.re) < w.min).map((w) => `${w.label} ${have(q, w.re)}/${w.min}`).join(', ')})`);
    const { onApeAtoll, onCrashIsland, inHangar1, inHangar2 } = await import('./monkey-madness');
    restocking = true;
    try {
        if (onApeAtoll(pos(q)) || onCrashIsland(pos(q))) await leaveAtoll(q);
    } finally {
        restocking = false;
    }
    if (inHangar1(pos(q)) || inHangar2(pos(q))) {
        const { leaveHangar } = await import('./monkey-madness');
        await leaveHangar(q);
    }
    const { climbGrandTree, GRAND_TREE_BANK, inStronghold, crossGnomeGate } = await import('./gnome-stronghold');
    if (!inStronghold(pos(q))) await crossGnomeGate(q, true);
    await climbGrandTree(q);
    await walk(q, GRAND_TREE_BANK, 3);
    const opened = await q.bot.openBank();
    if (!opened.success) throw new Error(`mm: restock: the bank did not open (${opened.message})`);
    for (const it of [...q.sdk.getInventory()]) if (/^vial$/i.test(it.name)) await q.bot.depositItem(it, -1).catch(() => undefined);
    for (const w of wants) {
        for (let k = 0; k < 4 && have(q, w.re) < w.count && q.sdk.getInventory().length < 28; k++) {
            const b = q.sdk.getBankItems().find((i) => w.re.test(i.name));
            if (!b) {
                await q.sdk.waitForTicks(2);
                continue;
            }
            await q.bot.withdrawItem(b, Math.min(w.count - have(q, w.re), 28 - q.sdk.getInventory().length)).catch(() => undefined);
            await q.sdk.waitForTicks(1);
        }
        if (have(q, w.re) < w.min) throw new Error(`mm: restock: the bank has only ${have(q, w.re)}/${w.min} ${w.label}`);
    }
    await q.bot.closeBank().catch(() => undefined);
    q.log(`mm: restocked at the Grand Tree bank`);
}

/** Food and prayer for the atoll as a human; quest items on top (chapterWants). */
export const FIGHT_WANTS: Want[] = [
    { re: /^shark$/i, count: 12, min: 5, label: 'shark' },
    { re: /^prayer potion\(\d\)$/i, count: 6, min: 2, label: 'prayer potion' },
    { re: /^antipoison\(\d\)$/i, count: 1, min: 0, label: 'antipoison' },
];

/** Nothing left to keep a human alive on the atoll: give the step up (its retry restocks first). */
export function outOfSupplies(q: Quest): boolean {
    const hp = q.sdk.getSkill('hitpoints');
    const cur = hp?.level ?? 99;
    const max = hp?.baseLevel ?? 99;
    const food = have(q, /^(shark|monkfish|lobster|swordfish)$/i);
    const pots = have(q, /^prayer potion\(\d\)$/i);
    const prayer = q.sdk.getSkill('prayer')?.level ?? 0;
    // Early: the way out to the bank (the cave's zombies, the archers) is itself a fight; qlmmD left
    // Zooknock's cave at hp 24 with no food and died on the way.
    return (food <= 3 && cur < max * 0.7) || (food <= 4 && pots === 0 && prayer < 10 && cur < max * 0.8);
}
/** Set while topUp leaves the atoll: the way out cannot give up for want of food. */
let restocking = false;
function checkSupplies(q: Quest, label: string): void {
    if (greegreeOn(q) || restocking) return;
    if (outOfSupplies(q)) throw new Error(`mm: ${label}: out of food and prayer (hp ${q.sdk.getSkill('hitpoints')?.level}) — restock`);
}

/** The sigil (worn, 10 ticks) to the arena, the Jungle Demon by melee under Protect from Magic. */
export async function jungleDemon(q: Quest): Promise<void> {
    if (!inArena(pos(q))) {
        await topUp(q, [
            { re: /^shark$/i, count: 20, min: 14, label: 'shark' },
            { re: /^prayer potion\(\d\)$/i, count: 4, min: 3, label: 'prayer potion' },
        ]);
    }
    const s = safe(q);
    if (greegreeOn(q)) {
        await q.bot.unequipItem(/greegree/i).catch(() => undefined);
        await untilTicks(q.sdk, () => !greegreeOn(q), 4);
    }
    await arm(q);
    for (let k = 0; k < 3 && !inArena(pos(q)); k++) {
        const sg = q.sdk.getInventory().find((i) => i.id === OBJ.sigil);
        if (sg) await q.bot.equipItem(sg).catch(() => undefined);
        if (await untilTicks(q.sdk, () => inArena(pos(q)), 40)) break;
        if (worn(q, OBJ.sigil)) {
            await q.bot.unequipItem(/sigil/i).catch(() => undefined);
            await untilTicks(q.sdk, () => !worn(q, OBJ.sigil), 4);
        }
    }
    if (!inArena(pos(q))) throw new Error(`mm: the sigil did not take us to the demon (at ${where(q)})`);
    s.want = 'protect_from_magic';
    let seen = false;
    let lastAttack = -9;
    const t0 = tickNow(q.sdk);
    while (tickNow(q.sdk) - t0 < 1500) {
        if (q.sdk.getDialog()?.isOpen) await q.sdk.sendClickDialog(0).catch(() => undefined);
        if (!inArena(pos(q))) throw new Error(`mm: out of the arena mid-fight (at ${where(q)}) — died?`);
        const d = mobs(q, [DEMON])[0];
        if (d) {
            seen = true;
            const t = tickNow(q.sdk);
            const c = q.sdk.getState()?.player?.combat;
            const fighting = c?.targetType === 'npc' && c.targetIndex === d.index;
            if (!fighting && t - lastAttack >= 4) {
                await q.sdk.sendInteractNpc(d.index, 2).catch(() => undefined);
                lastAttack = t;
            }
        } else if (seen && (await untilTicks(q.sdk, () => !mobs(q, [DEMON]).length, 4))) break;
        await q.sdk.waitForTicks(1);
    }
    s.want = null;
    if (mobs(q, [DEMON]).length || !seen) throw new Error(`mm: the Jungle Demon is not dead (at ${where(q)})`);
    q.log('mm: the Jungle Demon is dead');
    await drive(q, [/.*/], 20);
    // Garkor (-> finished), then Zooknock teleports us out to the village's west (2712,2784).
    await talkTo(q, /^garkor$/i, [/.*/], { label: 'Garkor (after the demon)', ticks: 80 }).catch((e) => q.log(String(e)));
    await talkTo(q, /^zooknock$/i, [/.*/], { done: () => !inArena(pos(q)), label: 'Zooknock (out)', ticks: 40 });
}

export const inDemonArena = inArena;
