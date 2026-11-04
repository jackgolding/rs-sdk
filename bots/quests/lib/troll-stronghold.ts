/**
 * Troll Stronghold — the route and mechanics (bots/quests/troll-stronghold.ts is the definition).
 *
 * Content facts (quest_troll/scripts/*.rs2, quest_death/scripts/death_ig_commander.rs2, death_smithy.rs2, death_sherpa.rs2,
 * drop tables troll_commander.rs2 / mountain_troll.rs2; maps m44_55..m45_57, m44_157, m45_156):
 *   - Denulth (2896,3528) starts it once Death Plateau is done. Tenzing (in his hut, 2820,3556) sells climbing boots for 12gp.
 *   - Death Plateau rocks (2880,3594 bottom / 2880,3595 top): worn climbing boots, both ways. Troll climbing rocks
 *     (2856,3612): boots only from the south (z 3611), Agility 15. Two more rock pairs east of the band: (2859 top/2860
 *     bottom, 3626) and (2878 bottom/2879 top, 3622). (2834,3628) joins the band to the secret door's pocket.
 *   - The arena (2897-2924, 3598-3628): entrance doors (2897,3618/3619) open freely; Dad (2911,3612) fights to < 20 hp,
 *     then "Stop! You win" -> 20. The north exit (2916,3629) only opens at >= 20.
 *   - North of the arena: troll pass entrance (2903,3644) -> (2907,10019); pass exit (2906,10036) -> Trollheim (2908,3654).
 *     The other pair: entrance (2907,3652) -> (2907,10035), exit (2906,10017) -> (2904,3643).
 *   - Stronghold door (2839,3689) -> L2 (2837,10090); top exit (2838,10090 L2) -> (2840,3690). Troll Generals on L2 drop
 *     the prison key while %troll_quest < 30 and none is held or banked.
 *   - Stairs: L2 stairstop (2843,10108) -> L1 (2841,10108); prison door (2848,10107 L1) takes the key once (-> 30) and
 *     then opens freely; L1 stairstop (2852,10107) -> L0 (2852,10105); L0 stairs (2852,10106) -> L1 (2852,10109).
 *   - Prison L0: Twig (2832,10079) and Berry (2832,10083) asleep; Pickpocket (op3, Thieving 30) or kill for cell keys
 *     1/2. Godric's cell door (2832,10078) with key 1 -> 40; Eadgar's (2832,10082) with key 2 frees Eadgar (needed for
 *     Eadgar's Ruse). Back exit (2823,10048) -> (2827,3646) and from then on the secret door (2827,3647) lets you in.
 *   - Dunstan (2919,3574) at 40: the law talisman, QUEST COMPLETE.
 */
import type { Quest } from './run-quest';
import { driveDialog } from './dialog';
import { tickNow, untilTicks } from './ticks';
import { inHut, leaveAnywhere, toTenzing } from './death-plateau';

interface Tile {
    x: number;
    z: number;
    level?: number;
}

export const DENULTH = { x: 2896, z: 3528 };
export const DUNSTAN = { x: 2919, z: 3574 };
const DAD = { x: 2911, z: 3612 };
export const NPC = { dad: 1125, general: [1115, 1116, 1117], twig: 1128, berry: 1129, godric: 1114, eadgar: 1113 } as const;
const LOC = {
    deathBottom: { id: 3723, x: 2880, z: 3594 },
    deathTop: { id: 3722, x: 2880, z: 3595 },
    rocksSouth: { id: 3748, x: 2856, z: 3612 },
    rocksWest: { id: 3748, x: 2834, z: 3628 },
    midTop: { id: 3790, x: 2859, z: 3626 },
    midBottom: { id: 3791, x: 2860, z: 3626 },
    eastBottom: { id: 3791, x: 2878, z: 3622 },
    eastTop: { id: 3790, x: 2879, z: 3622 },
    arenaIn: { id: 3782, x: 2897, z: 3618 },
    arenaOut: { id: 3785, x: 2916, z: 3629 },
    passSouth: { id: 3757, x: 2903, z: 3644 },
    passNorth: { id: 3757, x: 2907, z: 3652 },
    passExitNorth: { id: 3758, x: 2906, z: 10036 },
    passExitSouth: { id: 3758, x: 2906, z: 10017 },
    strongholdDoor: { id: 3771, x: 2839, z: 3689 },
    topExit: { id: 3774, x: 2838, z: 10090 },
    l2Down: { id: 3789, x: 2843, z: 10108 },
    l1Up: { id: 3788, x: 2842, z: 10108 },
    prisonDoor: { id: 3780, x: 2848, z: 10107 },
    l1Down: { id: 3789, x: 2852, z: 10107 },
    l0Up: { id: 3788, x: 2852, z: 10106 },
    l0UpEast: { id: 3788, x: 2852, z: 10061 },
    backExit: { id: 3761, x: 2823, z: 10048 },
    secretDoor: { id: 3762, x: 2827, z: 3647 },
    godricCell: { id: 3767, x: 2832, z: 10078 },
    eadgarCell: { id: 3765, x: 2832, z: 10082 },
    eadgarCaveExit: { id: 3760, x: 2892, z: 10072 },
    /** Trollheim's cave mouth (quest_troll.rs2:129-134): Eadgar's home (L2) once he is freed, else an empty L0 cave. */
    eadgarCave: { id: 3759, x: 2892, z: 3672 },
    /** L1 west's stairs down to the storeroom side of L0 (Eadgar's Ruse), and back up. */
    l1DownEast: { id: 3789, x: 2852, z: 10061 },
} as const;

const RE = {
    boots: /^climbing boots$/i,
    prisonKey: /^prison key$/i,
    cell1: /^cell key 1$/i,
    cell2: /^cell key 2$/i,
    food: /^(shark|manta ray|monkfish|swordfish|lobster|bass|tuna)$/i,
};

export type Area =
    | 'south'
    | 'plateau'
    | 'band'
    | 'mid'
    | 'arenaWest'
    | 'arena'
    | 'north'
    | 'pass'
    | 'trollheim'
    | 'xpocket'
    | 'l2'
    | 'l1w'
    | 'l1e'
    | 'prison'
    | 'l0east'
    | 'eadgar'
    | 'other';

const inBox = (p: Tile, x0: number, x1: number, z0: number, z1: number) => p.x >= x0 && p.x <= x1 && p.z >= z0 && p.z <= z1;
const pos = (q: Quest) => {
    const p = q.sdk.getState()?.player;
    return { x: p?.worldX ?? 0, z: p?.worldZ ?? 0, level: p?.level ?? 0 };
};
const where = (q: Quest) => `(${pos(q).x},${pos(q).z},L${pos(q).level})`;

/** Which part of the troll country `p` is in ('other' outside it). */
export function areaOf(p: Tile): Area {
    const lv = p.level ?? 0;
    if (p.z > 6400) {
        if (inBox(p, 2880, 2905, 10060, 10100)) return 'eadgar';
        if (lv === 0 && inBox(p, 2880, 2935, 10000, 10045)) return 'pass';
        if (inBox(p, 2816, 2879, 10040, 10120)) {
            if (lv === 2) return 'l2';
            if (lv === 1) return p.x >= 2848 && p.z >= 10100 ? 'l1e' : 'l1w';
            return p.x <= 2843 || p.z >= 10102 ? 'prison' : 'l0east';
        }
        return 'other';
    }
    if (lv !== 0) return 'other';
    // Troll Romance's landing pocket below Trollweiss (2778-2803,3714-3735): walled off from Trollheim (lib/troll-romance.ts).
    if (inBox(p, 2778, 2803, 3714, 3735)) return 'other';
    if (inBox(p, 2897, 2924, 3598, 3628)) return 'arena';
    if (inBox(p, 2895, 2935, 3629, 3647)) return 'north';
    if (inBox(p, 2812, 2842, 3629, 3652)) return 'xpocket';
    if (inBox(p, 2780, 2940, 3648, 3760)) return 'trollheim';
    if (inBox(p, 2880, 2896, 3605, 3635)) return 'arenaWest';
    if (inBox(p, 2861, 2879, 3612, 3635)) return 'mid';
    if (inBox(p, 2828, 2860, 3613, 3628)) return 'band';
    // Above the Death Plateau rocks, the secret path's ledge included (it joins at the scout zone).
    if (inBox(p, 2833, 2895, 3595, 3612)) return 'plateau';
    return 'other';
}

/** run-quest's goTo/prologue hook: anywhere past the Death Plateau rocks, in the pass, Trollheim or the stronghold. */
export const inTrollArea = (p: Tile) => areaOf(p) !== 'other';

const STAGE_ORDER = ['unstarted', 'started', 'defeated_dad', 'entered_prison', 'freed_godric', 'complete'];
/**
 * Set by quests that need Troll Stronghold done (Eadgar's Ruse, Troll Romance): their q.stage is their own journal
 * stage, so every Troll Stronghold gate (Dad beaten, the prison door, the secret door) reads as passed.
 */
let trollComplete = false;
export function assumeTrollStrongholdDone(): void {
    trollComplete = true;
}
const stageAtLeast = (q: Quest, id: string) => trollComplete || STAGE_ORDER.indexOf(q.stage) >= STAGE_ORDER.indexOf(id);
/** The prison door opens without the key once %troll_quest >= 30. */
const canPassPrisonDoor = (q: Quest) => stageAtLeast(q, 'entered_prison') || q.count(RE.prisonKey) > 0;

const messagesSince = (q: Quest, t0: number) => (q.sdk.getState()?.gameMessages ?? []).filter((m) => m.tick >= t0).map((m) => m.text);
const heard = (q: Quest, t0: number, re: RegExp) => messagesSince(q, t0).some((m) => re.test(m));

async function eatIfLow(q: Quest, below = 0.6): Promise<void> {
    const p = q.sdk.getState()?.player;
    if (!p || p.hp > (p.maxHp ?? 10) * below) return;
    const food = q.sdk.getInventory().find((i) => RE.food.test(i.name));
    if (food) await q.bot.eatFood(food).catch(() => undefined);
}

/**
 * Eat and drink in the background while a blocking walk or fight runs: bot.walkTo does not return until it arrives, and
 * the plateau's trolls killed a staging account mid-walk with 13 sharks held (qlqftr2, 2026-11-04). Eating does not stop
 * the walk. Returns the stop function.
 */
let guarding = false;
export function survive(q: Quest, below = 0.6): () => void {
    // One guard at a time: nested calls (goToArea inside a guarded fight) would eat twice.
    if (guarding) return () => undefined;
    guarding = true;
    let busy = false;
    let lastEat = -99;
    let lastDrink = -99;
    const timer = setInterval(() => {
        if (busy) return;
        busy = true;
        (async () => {
            const p = q.sdk.getState()?.player;
            const now = tickNow(q.sdk);
            if (p && p.hp > 0 && p.hp <= (p.maxHp ?? 10) * below && now - lastEat >= 3) {
                const food = q.sdk.getInventory().find((i) => RE.food.test(i.name));
                const op = food?.optionsWithIndex.find((o) => /^eat$/i.test(o.text));
                if (food && op) {
                    lastEat = now;
                    await q.sdk.sendUseItem(food.slot, op.opIndex).catch(() => undefined);
                }
            }
            const pr = q.sdk.getPrayerState();
            if (pr && pr.prayerPoints < 15 && now - lastDrink >= 3) {
                const pot = q.sdk.getInventory().find((i) => /^prayer potion\(\d\)$/i.test(i.name));
                const op = pot?.optionsWithIndex.find((o) => /^drink$/i.test(o.text));
                if (pot && op) {
                    lastDrink = now;
                    await q.sdk.sendUseItem(pot.slot, op.opIndex).catch(() => undefined);
                }
            }
        })()
            .catch(() => undefined)
            .finally(() => {
                busy = false;
            });
    }, 300);
    return () => {
        clearInterval(timer);
        guarding = false;
    };
}

/** Protect from Melee (Prayer 43) while it has points; off when `on` is false. */
export async function prayMelee(q: Quest, on: boolean): Promise<void> {
    const active = q.sdk.isPrayerActive('protect_from_melee');
    const pr = q.sdk.getPrayerState();
    if (on && !active && pr && pr.prayerLevel >= 43 && pr.prayerPoints > 0) await q.bot.activatePrayer('protect_from_melee').catch(() => undefined);
    if (!on && active) await q.bot.deactivatePrayer('protect_from_melee').catch(() => undefined);
}

/** Drink a prayer potion below 15 points (none held: nothing). */
async function topUpPrayer(q: Quest): Promise<void> {
    if ((q.sdk.getPrayerState()?.prayerPoints ?? 99) >= 15) return;
    const pot = q.sdk.getInventory().find((i) => /^prayer potion\(\d\)$/i.test(i.name));
    if (pot) await q.sdk.sendUseItem(pot.slot, 1).catch(() => undefined);
}

const worn = (q: Quest, re: RegExp) => q.sdk.getEquipment().some((i) => re.test(i.name));

async function wearBoots(q: Quest): Promise<void> {
    if (worn(q, RE.boots)) return;
    const boots = q.sdk.getInventory().find((i) => RE.boots.test(i.name));
    if (!boots) throw new Error(`troll: no climbing boots held for the rocks at ${where(q)}`);
    await q.bot.equipItem(boots).catch(() => undefined);
    if (!(await untilTicks(q.sdk, () => worn(q, RE.boots), 4))) throw new Error('troll: could not wear the climbing boots');
}

/** Best melee weapon held: wielded for the fights. */
export async function wieldWeapon(q: Quest): Promise<void> {
    const weapon = q.sdk.getInventory().find((i) => /scimitar|longsword|sword|whip|battleaxe|mace|warhammer|halberd/i.test(i.name));
    if (weapon) await q.bot.equipItem(weapon).catch(() => undefined);
}

/** Op1 on the loc (by id, nearest to `at`) until `done`; blind op when the scan does not show it. */
async function opLoc(q: Quest, loc: { id: number; x: number; z: number }, done: () => boolean, label: string, tries = 4, ticks = 15): Promise<void> {
    for (let attempt = 1; attempt <= tries && !done(); attempt++) {
        await eatIfLow(q);
        await q.sdk.scanNearbyLocs(15).catch(() => undefined);
        const seen = (q.sdk.getNearbyLocs() ?? []).filter((l) => l.id === loc.id && Math.hypot(l.x - loc.x, l.z - loc.z) <= 2).sort((a, b) => Math.hypot(a.x - loc.x, a.z - loc.z) - Math.hypot(b.x - loc.x, b.z - loc.z))[0];
        await q.sdk.sendInteractLoc(seen?.x ?? loc.x, seen?.z ?? loc.z, loc.id, 1);
        await untilTicks(q.sdk, (s) => done() || !!s.dialog?.isOpen, ticks);
        if (q.sdk.getDialog()?.isOpen) await driveDialog(q.sdk, [], { done, ticks: 15 });
        await untilTicks(q.sdk, done, 3);
        if (!done()) q.log(`troll: ${label}: attempt ${attempt} did not take at ${where(q)}`);
    }
    if (!done()) throw new Error(`troll: ${label} failed at ${where(q)}`);
}

/** Walk to a tile inside one area (the area's own pathing; no goTo, which would leave the troll country first). */
async function walk(q: Quest, to: Tile, tolerance = 1): Promise<void> {
    if (Math.max(Math.abs(pos(q).x - to.x), Math.abs(pos(q).z - to.z)) <= tolerance) return;
    for (let attempt = 1; attempt <= 3; attempt++) {
        await eatIfLow(q);
        const res = await q.bot.walkTo(to.x, to.z, tolerance).catch((e) => ({ success: false, message: String(e) }));
        if (res.success || Math.max(Math.abs(pos(q).x - to.x), Math.abs(pos(q).z - to.z)) <= tolerance + 1) return;
        q.log(`troll: walk to (${to.x},${to.z}) from ${where(q)}: ${res.message}`);
        await q.sdk.waitForTicks(2);
    }
}

const at = (q: Quest, a: Area) => () => areaOf(pos(q)) === a;

/**
 * L1 west is cut in two by an interior door (2837,10063): the stairs and prison door north, the kitchen and the storeroom
 * stairs south (Eadgar's Ruse). The client will not plan through it from afar ("Stuck"); from its doorstep walkTo opens it.
 */
async function walkL1w(q: Quest, to: Tile, tolerance: number): Promise<void> {
    const north = (t: Tile) => t.z >= 10064;
    if (north(pos(q)) !== north(to)) await walk(q, north(pos(q)) ? { x: 2838, z: 10066 } : { x: 2837, z: 10062 }, 1);
    await walk(q, to, tolerance);
}
export { walkL1w };

/** One hop from `a` toward `dest`. */
async function hop(q: Quest, a: Area, dest: Area): Promise<void> {
    const back = SOUTHWARD.has(dest) || CHAIN.indexOf(dest) < CHAIN.indexOf(a);
    // Toward the prison with the back exit opened (by Godric's rescue, or by any trip out through it): the secret door
    // beats the whole north loop. Tried from the prison stage on; "don't know how" sends us round the long way.
    const viaSecret = PRISON_SIDE.has(dest) && (stageAtLeast(q, 'freed_godric') || (stageAtLeast(q, 'entered_prison') && !secretShut));
    switch (a) {
        case 'south':
            await wearBoots(q);
            await q.goTo({ x: 2880, z: 3592 }, 2);
            await walk(q, { x: 2880, z: 3593 }, 0);
            return opLoc(q, LOC.deathBottom, () => pos(q).z >= 3596, 'Death Plateau rocks up');
        case 'plateau':
            if (back) {
                // No boots (a Death Plateau run restarted on its scout zone): down the secret path and out through Tenzing's hut.
                if (q.count(RE.boots) === 0 && !worn(q, RE.boots)) return leaveAnywhere(q);
                await wearBoots(q);
                await walk(q, { x: 2880, z: 3596 }, 0);
                return opLoc(q, LOC.deathTop, () => pos(q).z <= 3593, 'Death Plateau rocks down');
            }
            await wearBoots(q);
            await walk(q, { x: 2856, z: 3611 }, 0);
            return opLoc(q, LOC.rocksSouth, at(q, 'band'), 'troll rocks (2856,3612) north', 8);
        case 'band':
            if (back) {
                await walk(q, { x: 2856, z: 3613 }, 0);
                return opLoc(q, LOC.rocksSouth, at(q, 'plateau'), 'troll rocks (2856,3612) south', 8);
            }
            if (viaSecret || dest === 'xpocket') {
                await walk(q, { x: 2834, z: 3627 }, 0);
                return opLoc(q, LOC.rocksWest, at(q, 'xpocket'), 'troll rocks (2834,3628) north', 8);
            }
            await walk(q, { x: 2858, z: 3626 }, 0);
            return opLoc(q, LOC.midTop, at(q, 'mid'), 'rocks east (2859,3626)', 8);
        case 'mid':
            if (back) {
                await walk(q, { x: 2861, z: 3626 }, 0);
                return opLoc(q, LOC.midBottom, at(q, 'band'), 'rocks west (2860,3626)', 8);
            }
            await walk(q, { x: 2877, z: 3622 }, 0);
            return opLoc(q, LOC.eastBottom, at(q, 'arenaWest'), 'rocks east (2878,3622)', 8);
        case 'arenaWest':
            if (back) {
                await walk(q, { x: 2880, z: 3622 }, 0);
                return opLoc(q, LOC.eastTop, at(q, 'mid'), 'rocks west (2879,3622)', 8);
            }
            await walk(q, { x: 2896, z: 3618 }, 0);
            return opLoc(q, LOC.arenaIn, at(q, 'arena'), 'arena entrance');
        case 'arena':
            if (back) {
                await walk(q, { x: 2898, z: 3618 }, 1);
                return opLoc(q, LOC.arenaIn, at(q, 'arenaWest'), 'arena entrance (out west)');
            }
            if (!stageAtLeast(q, 'defeated_dad')) throw new Error('troll: the arena exit needs Dad beaten');
            await walk(q, { x: 2916, z: 3628 }, 0);
            return opLoc(q, LOC.arenaOut, at(q, 'north'), 'arena exit (north)');
        case 'north':
            if (back) {
                await walk(q, { x: 2916, z: 3630 }, 0);
                return opLoc(q, LOC.arenaOut, at(q, 'arena'), 'arena exit (back south)');
            }
            await walk(q, { x: 2904, z: 3643 }, 1);
            return opLoc(q, LOC.passSouth, at(q, 'pass'), 'troll pass entrance (south)');
        case 'pass': {
            // Which half we landed in decides the exit: the south half (z < 10027) leads back to the arena's north side.
            const exit = back ? LOC.passExitSouth : LOC.passExitNorth;
            await walk(q, { x: exit.x + 1, z: exit.z + (back ? 1 : -1) }, 1);
            return opLoc(q, exit, () => pos(q).z < 6400, `troll pass exit (${back ? 'south' : 'north'})`);
        }
        case 'trollheim':
            if (dest === 'eadgar') {
                await walk(q, { x: 2892, z: 3674 }, 1);
                return opLoc(q, LOC.eadgarCave, () => pos(q).z > 6400, "Eadgar's cave entrance");
            }
            // Troll Stronghold done: back south through the stronghold and the prison's back door, not the troll pass and the
            // arena (its mountain trolls took a staging account from 80 hp to dead on the way, qlqgea1 2026-11-04).
            if (back && !(trollComplete && dest !== 'pass' && dest !== 'north' && dest !== 'arena')) {
                await walk(q, { x: 2907, z: 3654 }, 1);
                return opLoc(q, LOC.passNorth, at(q, 'pass'), 'troll pass entrance (north)');
            }
            await walk(q, { x: 2840, z: 3690 }, 1);
            // The hall behind the door has Troll Generals (30+ a hit): prayer up before going in.
            await prayMelee(q, true);
            return opLoc(q, LOC.strongholdDoor, at(q, 'l2'), 'stronghold door');
        case 'xpocket':
            if (back || !viaSecret) {
                await walk(q, { x: 2834, z: 3629 }, 0);
                return opLoc(q, LOC.rocksWest, at(q, 'band'), 'troll rocks (2834,3628) south', 8);
            }
            await walk(q, { x: 2827, z: 3646 }, 1);
            {
                const t0 = tickNow(q.sdk);
                const shut = () => heard(q, t0, /don't know how to open the secret door/i);
                await opLoc(q, LOC.secretDoor, () => pos(q).z > 6400 || shut(), 'secret door', 2);
                if (shut()) {
                    secretShut = true;
                    q.log('troll: the secret door is shut to us (back exit never opened) — the long way round');
                }
            }
            return;
        case 'l2':
            if (UP_TOP.has(dest) || (back && !canPassPrisonDoor(q))) {
                await walk(q, { x: 2839, z: 10090 }, 1);
                return opLoc(q, LOC.topExit, at(q, 'trollheim'), 'stronghold top exit');
            }
            await walk(q, { x: 2843, z: 10109 }, 1);
            return opLoc(q, LOC.l2Down, at(q, 'l1w'), 'stairs down to L1');
        case 'l1w':
            if (dest === 'l0east') {
                await walkL1w(q, { x: 2852, z: 10060 }, 1);
                return opLoc(q, LOC.l1DownEast, at(q, 'l0east'), 'stairs down to the storeroom side');
            }
            if (UP_TOP.has(dest) || (back && !canPassPrisonDoor(q))) {
                await walkL1w(q, { x: 2841, z: 10108 }, 1);
                return opLoc(q, LOC.l1Up, at(q, 'l2'), 'stairs up to L2');
            }
            await walkL1w(q, { x: 2847, z: 10107 }, 0);
            return opLoc(q, LOC.prisonDoor, at(q, 'l1e'), 'prison door');
        case 'l1e':
            if (dest === 'l1w' || dest === 'l2' || dest === 'l0east' || UP_TOP.has(dest)) {
                await walk(q, { x: 2849, z: 10107 }, 0);
                return opLoc(q, LOC.prisonDoor, at(q, 'l1w'), 'prison door (out)');
            }
            await walk(q, { x: 2852, z: 10108 }, 1);
            return opLoc(q, LOC.l1Down, at(q, 'prison'), 'stairs down to the prison');
        case 'prison':
            if (dest === 'l1e' || dest === 'l1w' || dest === 'l2' || dest === 'l0east' || UP_TOP.has(dest)) {
                await walk(q, { x: 2852, z: 10105 }, 1);
                return opLoc(q, LOC.l0Up, at(q, 'l1e'), 'prison stairs up');
            }
            await walk(q, { x: 2823, z: 10050 }, 1);
            return opLoc(q, LOC.backExit, at(q, 'xpocket'), 'prison back exit');
        case 'l0east':
            if (inStoreroom(pos(q))) return escapeStoreroom(q);
            // The stairs (2852,10061) are entered from the north on L0.
            await walk(q, { x: 2852, z: 10062 }, 1);
            return opLoc(q, LOC.l0UpEast, at(q, 'l1w'), 'storeroom stairs up');
        case 'eadgar':
            await walk(q, { x: 2893, z: 10073 }, 1);
            return opLoc(q, LOC.eadgarCaveExit, () => pos(q).z < 6400, "Eadgar's cave exit");
        default:
            throw new Error(`troll: no route from ${a} ${where(q)} to ${dest}`);
    }
}

/** Eadgar's Ruse's goutweed storeroom (L0 east, behind 3810 at 2869,10085, whose door tile is inside). */
const STORE_DOOR = { id: 3810, x: 2869, z: 10085 };
export const inStoreroom = (p: Tile) =>
    (p.level ?? 0) === 0 && p.z > 6400 && ((p.x >= 2849 && p.x <= 2868 && p.z >= 10073 && p.z <= 10093) || (p.x === STORE_DOOR.x && p.z === STORE_DOOR.z));

/** Out through the storeroom door: it opens freely from its own tile and shuts itself behind you. */
export async function escapeStoreroom(q: Quest): Promise<void> {
    for (let i = 0; i < 4 && inStoreroom(pos(q)); i++) {
        await walk(q, STORE_DOOR, 0);
        await q.sdk.sendInteractLoc(STORE_DOOR.x, STORE_DOOR.z, STORE_DOOR.id, 1);
        await q.sdk.waitForTicks(2);
        await q.sdk.sendWalk(STORE_DOOR.x, STORE_DOOR.z - 1);
        await untilTicks(q.sdk, () => !inStoreroom(pos(q)), 5);
    }
    if (inStoreroom(pos(q))) throw new Error(`troll: stuck in the storeroom (at ${where(q)})`);
}

/** Set when the secret door says the back exit was never opened from inside. */
let secretShut = false;

/** Forward order from Burthorpe to the prison, the way the quest goes. */
const CHAIN: Area[] = ['south', 'plateau', 'band', 'mid', 'arenaWest', 'arena', 'north', 'pass', 'trollheim', 'l2', 'l1w', 'l1e', 'prison'];
const SOUTHWARD = new Set<Area>(['south', 'plateau']);
const PRISON_SIDE = new Set<Area>(['l2', 'l1w', 'l1e', 'prison', 'l0east']);
/** Reached from inside the stronghold by its top exit (L2), not the prison's back door. */
const UP_TOP = new Set<Area>(['trollheim', 'eadgar']);
/** Burthorpe's side of the troll country: the Death Plateau and the band of rocks to the secret door. */
const SOUTH_SIDE = new Set<Area>(['south', 'plateau', 'band', 'xpocket']);
const ARENA_SIDE = new Set<Area>(['mid', 'arenaWest', 'arena', 'north']);
/** Side areas off the chain: Eadgar's cave hangs off Trollheim, the storeroom side of L0 off L1 west. */
const SIDE: Partial<Record<Area, Area>> = { eadgar: 'trollheim', l0east: 'l1w' };

/** Hop through the troll country until in `dest` (at most 16 hops). Protect from Melee on the way when it can. */
export async function goToArea(q: Quest, dest: Area): Promise<void> {
    const stop = survive(q);
    try {
        await hops(q, dest);
    } finally {
        stop();
    }
}

async function hops(q: Quest, dest: Area): Promise<void> {
    for (let k = 0; k < 16; k++) {
        if (q.sdk.getDialog()?.isOpen) await driveDialog(q.sdk, [], { ticks: 10 });
        let a = areaOf(pos(q));
        if (a === dest) return;
        if (a === 'other') {
            if (dest === 'south') return;
            a = 'south';
        }
        // A side area is entered from its parent; until there, route to the parent. Inside the stronghold the parent
        // (Trollheim) is reached by the top exit (UP_TOP), so the side area itself is passed on as the destination.
        const parent = SIDE[dest];
        let step = parent && a !== parent && !(PRISON_SIDE.has(a) && UP_TOP.has(dest)) ? parent : dest;
        // Troll Stronghold done: up to Trollheim through the secret door, the prison and the stronghold's top exit rather
        // than the arena and the troll pass (mountain trolls all the way).
        if (trollComplete && UP_TOP.has(dest) && SOUTH_SIDE.has(a)) step = 'prison';
        // ...and from the arena side (Troll Romance's Arrg fight ends in the arena) back west to the secret door.
        if (trollComplete && PRISON_SIDE.has(dest) && ARENA_SIDE.has(a)) step = 'band';
        await eatIfLow(q);
        await topUpPrayer(q);
        // Prayer is the budget for the fights (Dad, the Troll Generals hit 30+ through no armour): only the stronghold's
        // halls, where the generals and mountain trolls roam, get it on the way. The plateau's trolls are left to the food
        // (qlqftr2/3 reached L2 with 0-41 points after praying the whole route, and died to a general).
        await prayMelee(q, a === 'l2' || a === 'l1w' || a === 'l1e');
        q.log(`troll: ${a} -> ${step} from ${where(q)} hp ${q.sdk.getState()?.player?.hp} melee prayer ${q.sdk.isPrayerActive('protect_from_melee')} (${q.sdk.getPrayerState()?.prayerPoints ?? '?'} pts)`);
        await hop(q, a, step);
    }
    if (areaOf(pos(q)) !== dest) throw new Error(`troll: could not reach ${dest} (in ${areaOf(pos(q))} at ${where(q)})`);
}

/** run-quest: out of the troll country to Burthorpe's side of the Death Plateau rocks. */
export async function leaveTrollArea(q: Quest): Promise<void> {
    try {
        await goToArea(q, 'south');
        // The plateau's west ledge is the secret path: walkTo from Burthorpe's side picks up from there.
    } finally {
        await prayMelee(q, false);
    }
}

// ── the quest

/** Denulth: "How goes your fight with the trolls?" -> "Is there anything I can do to help?" -> "I'll get Godric back!" (10). */
export async function start(q: Quest): Promise<void> {
    await q.talk(/^denulth$/i, [/how goes your fight with the trolls/i, /is there anything i can do to help/i, /i'll get godric back/i], DENULTH);
}

/** Climbing boots held or worn; Tenzing sells them for 12gp after Death Plateau. */
export async function ensureBoots(q: Quest): Promise<void> {
    if (q.count(RE.boots) > 0 || worn(q, RE.boots)) return;
    if (q.count('coins') < 12) throw new Error('troll: 12 coins needed for climbing boots');
    await toTenzing(q);
    if (!inHut(q)) throw new Error(`troll: not in Tenzing's hut (${where(q)})`);
    // His menu loops back after a sale: buy once, then "Nothing, thanks!" (the static choice list bought four pairs).
    const tenzing = q.sdk.findNearbyNpc(/^tenzing$/i);
    if (!tenzing) throw new Error(`troll: Tenzing not in view (${where(q)})`);
    await q.bot.talkTo(tenzing).catch(() => undefined);
    await driveDialog(q.sdk, [/can i buy some climbing boots/i, /ok, sounds good/i], { done: () => q.count(RE.boots) > 0, ticks: 40, log: q.log });
    await driveDialog(q.sdk, [/nothing, thanks/i], { ticks: 15 });
    if (q.count(RE.boots) < 1) throw new Error('troll: Tenzing sold no climbing boots');
    q.log('troll: bought climbing boots from Tenzing');
}

/** Into the arena and Dad down to < 20 hp: "Stop! You win" -> "I'll be going now." (20). */
export async function fightDad(q: Quest, done: () => Promise<boolean>): Promise<void> {
    await wieldWeapon(q);
    await goToArea(q, 'arena');
    await wieldWeapon(q);
    const t0 = tickNow(q.sdk);
    let lastAttack = -99;
    let lastLog = -99;
    let lastCheck = tickNow(q.sdk);
    let won = false;
    while (!won && tickNow(q.sdk) - t0 < 900) {
        await eatIfLow(q, 0.55);
        await topUpPrayer(q);
        await prayMelee(q, true);
        const d = q.sdk.getDialog();
        if (d?.isOpen) {
            const text = await driveDialog(q.sdk, [/i'll be going now/i, /i accept your challenge/i], { ticks: 10 });
            if (/stop! you win|i'll be going now/i.test(text)) won = true;
            continue;
        }
        if (heard(q, t0, /don't need to fight him again/i)) won = true;
        // Dad's swing throws the player 7 tiles; the arena timer resets him if we leave the arena's zone.
        if (areaOf(pos(q)) !== 'arena') await goToArea(q, 'arena');
        const dad = (q.sdk.getNearbyNpcs() ?? []).find((n) => n.id === NPC.dad);
        if (!dad) {
            if (tickNow(q.sdk) - lastAttack > 20) await walk(q, DAD, 3);
            await q.sdk.waitForTicks(2);
            continue;
        }
        const fighting = q.sdk.getState()?.player?.combat?.inCombat ?? false;
        if ((!fighting && tickNow(q.sdk) - lastAttack >= 4) || tickNow(q.sdk) - lastAttack >= 12) {
            await q.sdk.sendInteractNpc(dad.index, 2);
            lastAttack = tickNow(q.sdk);
        }
        if (tickNow(q.sdk) - lastLog >= 20) {
            lastLog = tickNow(q.sdk);
            const me = q.sdk.getState()?.player;
            q.log(`troll: Dad hp ${dad.hp ?? '?'}/${dad.maxHp ?? '?'}; me ${me?.hp}/${me?.maxHp} at ${where(q)}`);
        }
        await q.sdk.waitForTicks(1);
        if (tickNow(q.sdk) - lastCheck >= 15) {
            lastCheck = tickNow(q.sdk);
            if (await done()) won = true;
        }
    }
    for (let i = 0; i < 6 && q.sdk.getDialog()?.isOpen; i++) await driveDialog(q.sdk, [/i'll be going now/i], { ticks: 10 });
    await prayMelee(q, false);
    if (!won && !(await done())) throw new Error(`troll: Dad not beaten in ${tickNow(q.sdk) - t0}t`);
    q.log(`troll: Dad beaten in ${tickNow(q.sdk) - t0}t`);
}

/** A Troll General on L2 for the prison key (dropped while %troll_quest < 30 and none is held/banked). */
async function prisonKey(q: Quest): Promise<void> {
    if (q.count(RE.prisonKey) > 0) return;
    await goToArea(q, 'l2');
    await wieldWeapon(q);
    const t0 = tickNow(q.sdk);
    let target: number | null = null;
    let lastAttack = -99;
    let lastWalk = -99;
    let lastLog = -99;
    while (q.count(RE.prisonKey) < 1 && tickNow(q.sdk) - t0 < 1200) {
        await eatIfLow(q, 0.55);
        await topUpPrayer(q);
        await prayMelee(q, true);
        if (q.sdk.getDialog()?.isOpen) await driveDialog(q.sdk, [], { ticks: 5 });
        await q.sdk.scanGroundItems(12).catch(() => undefined);
        const key = q.sdk.findGroundItem(RE.prisonKey);
        if (key) {
            await q.bot.pickupItem(key).catch(() => undefined);
            await untilTicks(q.sdk, () => q.count(RE.prisonKey) > 0, 6);
            continue;
        }
        if (areaOf(pos(q)) !== 'l2') await goToArea(q, 'l2');
        const generals = (q.sdk.getNearbyNpcs() ?? []).filter((n) => (NPC.general as readonly number[]).includes(n.id) && (n.hp ?? 1) > 0).sort((a, b) => a.distance - b.distance);
        const mine = generals.find((n) => n.index === target) ?? generals.find((n) => !n.inCombat) ?? generals[0];
        if (!mine) {
            await q.sdk.waitForTicks(3);
            continue;
        }
        const fighting = q.sdk.getState()?.player?.combat?.inCombat ?? false;
        // The L2 hall is a maze of walls: the attack's own short route stalls at a wall (qlqftr3 stood at (2835,10086) with
        // a general four tiles off behind it for 300t). The long pathfinder walks round first.
        // Not gated on our own combat flag: a mountain troll on us (harmless under the prayer) kept it set while the
        // attack stalled at the wall (qlqftr4).
        if (mine.distance > 2 && tickNow(q.sdk) - lastWalk > 8) {
            lastWalk = tickNow(q.sdk);
            await walk(q, { x: mine.tileX ?? mine.x, z: mine.tileZ ?? mine.z }, 1);
            lastAttack = -99;
        }
        if (mine.index !== target || (!fighting && tickNow(q.sdk) - lastAttack >= 4) || tickNow(q.sdk) - lastAttack >= 15) {
            target = mine.index;
            await q.sdk.sendInteractNpc(mine.index, 2);
            lastAttack = tickNow(q.sdk);
        }
        if (tickNow(q.sdk) - lastLog >= 20) {
            lastLog = tickNow(q.sdk);
            const me = q.sdk.getState()?.player;
            q.log(`troll: general hp ${mine.hp ?? '?'}; me ${me?.hp}/${me?.maxHp} at ${where(q)}`);
        }
        await q.sdk.waitForTicks(1);
    }
    if (q.count(RE.prisonKey) < 1) throw new Error(`troll: no prison key after ${tickNow(q.sdk) - t0}t`);
    q.log(`troll: prison key in ${tickNow(q.sdk) - t0}t`);
}

/** Over the plateau, through the arena and the pass to the stronghold, a general's key, and the prison door (30). */
export async function enterPrison(q: Quest, done: () => Promise<boolean>): Promise<void> {
    await wieldWeapon(q);
    if (!PRISON_SIDE.has(areaOf(pos(q))) || areaOf(pos(q)) === 'l2') await prisonKey(q);
    try {
        await goToArea(q, 'l1e');
    } finally {
        await prayMelee(q, false);
    }
    for (let i = 0; i < 4 && !(await done()); i++) await q.sdk.waitForTicks(3);
}

/** A cell key from its sleeping guard: Pickpocket (Thieving 30), else kill and pick it up. */
async function cellKey(q: Quest, guard: number, key: RegExp, label: string, post: Tile): Promise<void> {
    if (q.count(key) > 0) return;
    // The prison stairs land ~28 tiles from the cells: Twig and Berry are out of view from there (qlqftr5 waited 600t).
    await walk(q, post, 2);
    const t0 = tickNow(q.sdk);
    let lastLog = -99;
    while (q.count(key) < 1 && tickNow(q.sdk) - t0 < 600) {
        await eatIfLow(q, 0.55);
        await topUpPrayer(q);
        if (q.sdk.getDialog()?.isOpen) await driveDialog(q.sdk, [], { ticks: 5 });
        await q.sdk.scanGroundItems(10).catch(() => undefined);
        const drop = q.sdk.findGroundItem(key);
        if (drop) {
            await q.bot.pickupItem(drop).catch(() => undefined);
            await untilTicks(q.sdk, () => q.count(key) > 0, 6);
            continue;
        }
        const npc = (q.sdk.getNearbyNpcs() ?? []).filter((n) => n.name.toLowerCase() === label && (n.hp ?? 1) > 0).sort((a, b) => a.distance - b.distance)[0];
        if (!npc) {
            if (tickNow(q.sdk) - lastLog >= 15) {
                lastLog = tickNow(q.sdk);
                q.log(`troll: no ${label} in view at ${where(q)}`);
            }
            await walk(q, post, 2);
            await q.sdk.waitForTicks(3);
            continue;
        }
        if (npc.distance > 2) await walk(q, { x: npc.tileX ?? npc.x, z: npc.tileZ ?? npc.z }, 1);
        const fighting = (q.sdk.getState()?.player?.combat?.inCombat ?? false) || npc.inCombat;
        const canPick = npc.id === guard && q.level('thieving') >= 30 && !fighting;
        if (tickNow(q.sdk) - lastLog >= 15) {
            lastLog = tickNow(q.sdk);
            q.log(`troll: ${label} #${npc.id} ${canPick ? 'pickpocket' : 'attack'} (hp ${npc.hp ?? '?'}) at ${where(q)}`);
        }
        // Prayer stays up: a failed pick wakes the guard, and the prison's hall is next to the generals' stairs.
        await prayMelee(q, true);
        if (canPick) {
            const before = tickNow(q.sdk);
            await q.sdk.sendInteractNpc(npc.index, 3);
            await untilTicks(q.sdk, () => q.count(key) > 0 || heard(q, before, /fail to pick|find nothing|during combat/i), 8);
            if (heard(q, before, /find nothing/i)) throw new Error(`${label} has no key for us (that prisoner is already out)`);
        } else {
            await q.sdk.sendInteractNpc(npc.index, 2);
            await q.sdk.waitForTicks(4);
        }
    }
    if (q.count(key) < 1) throw new Error(`troll: no ${label}'s key after ${tickNow(q.sdk) - t0}t`);
}

/** Unlock a cell door with its key (the key is used up). */
async function unlockCell(q: Quest, cell: { id: number; x: number; z: number }, key: RegExp, label: string): Promise<void> {
    const t0 = tickNow(q.sdk);
    const done = () => q.count(key) === 0 || heard(q, t0, /no need to do this|already unlocked/i);
    await walk(q, { x: cell.x + 1, z: cell.z }, 1);
    await opLoc(q, cell, done, `${label}'s cell door`, 4, 10);
    for (let i = 0; i < 6 && q.sdk.getDialog()?.isOpen; i++) await driveDialog(q.sdk, [], { ticks: 10 });
}

async function unlockEadgar(q: Quest): Promise<void> {
    await cellKey(q, NPC.berry, RE.cell2, 'berry', { x: 2834, z: 10083 });
    await unlockCell(q, LOC.eadgarCell, RE.cell2, 'Eadgar');
}

/**
 * Eadgar's Ruse on an account whose Troll Stronghold left Eadgar in his cell: Berry's key (pickpocketed, or killed for)
 * opens it. Throws "has no key for us" when Eadgar is already out.
 */
export async function freeEadgar(q: Quest): Promise<void> {
    await goToArea(q, 'prison');
    await wieldWeapon(q);
    try {
        await unlockEadgar(q);
    } finally {
        await prayMelee(q, false);
    }
}

/** In the prison: Eadgar first (Eadgar's Ruse needs him home), then Godric (40). */
export async function freePrisoners(q: Quest, done: () => Promise<boolean>): Promise<void> {
    await goToArea(q, 'prison');
    await wieldWeapon(q);
    try {
        // Eadgar: no journal stage of its own; a failure (already out: Berry has nothing) does not stop Godric.
        try {
            await unlockEadgar(q);
        } catch (e) {
            q.log(`troll: Eadgar not freed (${(e as Error).message})`);
        }
        await cellKey(q, NPC.twig, RE.cell1, 'twig', { x: 2834, z: 10079 });
        await unlockCell(q, LOC.godricCell, RE.cell1, 'Godric');
    } finally {
        await prayMelee(q, false);
    }
    for (let i = 0; i < 5 && !(await done()); i++) await q.sdk.waitForTicks(3);
}

/** Out by the back exit, down the rocks to Dunstan: the law talisman. */
export async function handIn(q: Quest): Promise<void> {
    await leaveTrollArea(q);
    await q.talk(/^dunstan$/i, [/has godric returned home/i], DUNSTAN);
}
