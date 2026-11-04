/**
 * In Search of the Myreque — the route and mechanics (bots/quests/in-search-of-the-myreque.ts is the definition).
 *
 * Content facts (quest_routequest/scripts/*.rs2, configs/quest_routequest.constant); the route follows
 * rs-stun-toolkit's q-in-search-of-the-myreque.ts spec, every id and tile re-checked against our maps:
 *   - Vanstrom Klause (sitting, Hair of the Dog, 3503,3476): "Why do they need help?" -> "Perhaps I could help you out
 *     here." -> "Yes, I'll do it!" (5). The six steel weapons are counted in the pack, never worn.
 *   - Cyreg Paddlehorn (Mort'ton dock, 3521,3285): with the weapons (10), the persuasion chain "...die without weapons",
 *     "Resourceful enough...", "...deaths are on your head!", "What kind of a man..." (15), then a druid pouch with >= 5
 *     charges and 3 planks ("Give wooden planks to Cyreg.", 20).
 *   - His rowboat (5051, 3523,3284): "Yes, I'll pay ten gold." -> the hollows (3498,3380) (25). The hollows' boat (5051,
 *     3498,3377) rows back to Mort'ton (3522,3284) for free.
 *   - The landing is a pocket: north only over the rotten bridge (3 rungs: plank + 10 nails + hammer each). Its north tree
 *     sets 52, which nothing reads. Curpile and the hideout doors are also a walk from Canifis's south-east (no gate), so
 *     this script rows back and walks round by Mort Myre and Canifis instead of carrying the bridge kit (3 planks, 30
 *     nails, a hammer).
 *   - Curpile Fyod (3508,3440), at >= 25: "I've come to help the Myreque..." then three random questions (choice5 with the
 *     question as header) -> 55. A wrong answer knocks you out to Mort'ton.
 *   - The wooden doors (5060/5061, 3510/3509,3447) at >= 55 -> underground (3500,9811) (60). The stalagmite (5050,
 *     3492,9824) op2, Agility 25 -> the hideout on level 3 (before 80) or level 0 (after; at 80 it calls the hound again).
 *   - Veliaf Hurtz (65), the five others (a bit each on their first page), Veliaf again: he takes the weapons (70), the
 *     cutscene, then the Skeleton Hellhound (level 97; att 70, def 100, str 110, 55 hp) at (3506,9834) L0 (80); its death
 *     (85). Veliaf: "How do I get out of here?" (90).
 *   - The hideout tunnel (5046, 3505,9831) -> (3491,9824); the false wall (5052, 3480,9837) at >= 90 -> the inn basement
 *     (95); the basement ladder (5054, 3477,9846) -> Canifis (3494,3464) (97). The Stranger (ex-Vanstrom): complete.
 *   - The underground doors (5056/5057, 3500/3501,9812) open from below at any stage -> (3509,3449) by Curpile.
 */
import type { Quest } from './run-quest';
import { driveDialog, talkThrough } from './dialog';
import { tickNow, untilTicks } from './ticks';
import { GROUPS, itemPattern } from './sources';
import { intoSwamp, inSwamp, leaveSwamp, toEastBank } from './nature-spirit';
import { survive } from './troll-stronghold';

interface Tile {
    x: number;
    z: number;
    level?: number;
}

export const OBJ = { pouchEmpty: 2957, pouch: 2958, sickleBlessed: 2963, pear: 2974, stem: 2972, fungus: 2970 } as const;
const LOC = {
    boat: 5051,
    doorL: 5061,
    doorR: 5060,
    stalagmite: 5050,
    tunnel: 5046,
    falseWall: 5052,
    basementLadder: 5054,
    underDoorL: 5056,
    underDoorR: 5057,
    pearBloomed: 3513,
    branchBloomed: 3511,
    logBloomed: 3509,
} as const;
const NPC = { hound: 1575 } as const;

const VANSTROM = { x: 3503, z: 3476 };
const CANIFIS = { x: 3503, z: 3470 };
const CYREG = { x: 3520, z: 3286 };
const MORTTON_BOAT = { x: 3523, z: 3284 };
const HOLLOWS_BOAT = { x: 3498, z: 3377 };
const CURPILE = { x: 3508, z: 3442 };
const DOORS = { x: 3510, z: 3447 };
const STALAGMITE = { x: 3492, z: 9824 };
const TUNNEL = { x: 3505, z: 9831 };
const FALSE_WALL = { x: 3480, z: 9837 };
const BASEMENT_LADDER = { x: 3477, z: 9846 };
const UNDER_DOORS = { x: 3500, z: 9812 };
const VELIAF = { x: 3506, z: 9837 };
/** A pear bush (3437,3348) cardinal-south: every sickle cast blooms it first (lib/nature-spirit.ts PEAR_AT). */
const PEAR_AT = { x: 3437, z: 3349 };

const inBox = (p: Tile, x0: number, x1: number, z0: number, z1: number) => p.x >= x0 && p.x <= x1 && p.z >= z0 && p.z <= z1;
const pos = (q: Quest) => {
    const p = q.sdk.getState()?.player;
    return { x: p?.worldX ?? 0, z: p?.worldZ ?? 0, level: p?.level ?? 0 };
};
const where = (q: Quest) => `(${pos(q).x},${pos(q).z},L${pos(q).level})`;
const cheb = (a: Tile, b: Tile) => Math.max(Math.abs(a.x - b.x), Math.abs(a.z - b.z));

// ── regions
/** The boat's landing in the hollows: a pocket, out by the bridge or the boat (offline pathfinder, 2026-11-04). */
export const inLanding = (p: Tile) => (p.level ?? 0) === 0 && inBox(p, 3481, 3519, 3372, 3429);
/** North of the bridge: Curpile and the hideout doors, a walk from Canifis's south-east. */
export const inNorthHollows = (p: Tile) => (p.level ?? 0) === 0 && inBox(p, 3496, 3525, 3430, 3457);
/** Mort'ton's dock and streets south of Mort Myre's box (z < 3290). */
export const inMorttonDock = (p: Tile) => (p.level ?? 0) === 0 && inBox(p, 3471, 3530, 3260, 3289);
/** m54_153: the tunnels, the hideout (levels 0 and 3), the cutscene rooms (1, 2) and the inn basement. */
export const inUnderground = (p: Tile) => inBox(p, 3456, 3519, 9792, 9855);
export const inHideout = (p: Tile) => inBox(p, 3498, 3520, 9828, 9848);
export const inBasement = (p: Tile) => (p.level ?? 0) === 0 && inBox(p, 3468, 3488, 9837, 9850);
export const inMyrequeArea = (p: Tile) => inLanding(p) || inNorthHollows(p) || inMorttonDock(p) || inUnderground(p);

const countId = (q: Quest, id: number) => q.sdk.getInventory().filter((i) => i.id === id).reduce((n, i) => n + (i.count ?? 1), 0);
export const pouchCharges = (q: Quest) => countId(q, OBJ.pouch);
const held = (q: Quest, re: RegExp) => q.sdk.getInventory().filter((i) => re.test(i.name)).reduce((n, i) => n + (i.count ?? 1), 0);

async function locById(q: Quest, id: number, at: Tile, within = 2) {
    await q.sdk.scanNearbyLocs(15).catch(() => undefined);
    const loc = (q.sdk.getNearbyLocs() ?? []).filter((l) => l.id === id).sort((a, b) => Math.hypot(a.x - at.x, a.z - at.z) - Math.hypot(b.x - at.x, b.z - at.z))[0];
    return loc && Math.hypot(loc.x - at.x, loc.z - at.z) <= within ? loc : undefined;
}

async function closeDialogs(q: Quest): Promise<void> {
    if (q.sdk.getDialog()?.isOpen) await driveDialog(q.sdk, [], { ticks: 10 });
    if (q.sdk.getState()?.interface?.isOpen) await q.sdk.sendCloseModal().catch(() => undefined);
}

/** walkTo, not goTo: goTo would leave this area (and Mort Myre) for the Varrock side first. */
async function walk(q: Quest, t: Tile, tolerance = 1): Promise<boolean> {
    for (let i = 0; i < 3 && cheb(pos(q), t) > tolerance; i++) {
        await q.bot.walkTo(t.x, t.z, tolerance).catch(() => undefined);
        if (cheb(pos(q), t) > tolerance) await q.sdk.waitForTicks(2);
    }
    return cheb(pos(q), t) <= tolerance;
}

/** Op `op` on loc `id` near `at` until `done`, driving any dialog with `choices` (blind op when the scan misses it). */
async function opLoc(q: Quest, id: number, at: Tile, op: number, done: () => boolean, label: string, opts: { choices?: RegExp[]; tries?: number; ticks?: number; walk?: boolean } = {}): Promise<void> {
    for (let attempt = 1; attempt <= (opts.tries ?? 4) && !done(); attempt++) {
        await closeDialogs(q);
        // walk: false lets the client route to the loc itself: the SDK's walkTo treats the tunnels' exit doors as a
        // passage and opening them puts you back on the surface (qlqhmy1, 2026-11-04).
        if (opts.walk !== false && cheb(pos(q), at) > 10) await walk(q, at, 2);
        const loc = await locById(q, id, at, opts.walk === false ? 4 : 2);
        await q.sdk.sendInteractLoc(loc?.x ?? at.x, loc?.z ?? at.z, id, op);
        await untilTicks(q.sdk, (s) => done() || !!s.dialog?.isOpen, opts.ticks ?? 20);
        if (q.sdk.getDialog()?.isOpen) await driveDialog(q.sdk, opts.choices ?? [], { done, ticks: 40 });
        await untilTicks(q.sdk, done, 6);
        if (!done()) q.log(`myq: ${label}: attempt ${attempt} did not take at ${where(q)}`);
    }
    if (!done()) throw new Error(`myq: ${label} failed at ${where(q)}`);
}

/** The best melee weapon held, wielded (never a steel quest weapon: Veliaf counts the pack only). */
export async function wieldWeapon(q: Quest): Promise<void> {
    const names = (GROUPS['melee weapon'] ?? []).filter((m) => q.level(m.skill) >= m.level).map((m) => itemPattern(m.item));
    if (q.sdk.getEquipment().some((e) => names.some((p) => p.test(e.name)))) return;
    const w = q.sdk.getInventory().find((i) => names.some((p) => p.test(i.name)));
    if (w) await q.bot.equipItem(w).catch(() => undefined);
}

// ── getting about

/** From anywhere on the Varrock side (or Morytania's bank): to Canifis. */
export async function toCanifis(q: Quest): Promise<void> {
    if (inUnderground(pos(q))) await leaveUnderground(q);
    if (inLanding(pos(q))) await rowBack(q);
    if (inMorttonDock(pos(q))) await walk(q, { x: 3485, z: 3300 }, 3);
    // North of the bridge is inside Nature Spirit's swamp box but a walk from Canifis: no gate.
    if (!inNorthHollows(pos(q))) {
        if (inSwamp(pos(q))) await leaveSwamp(q);
        await toEastBank(q);
    }
    if (!(await walk(q, CANIFIS, 3))) throw new Error(`myq: could not walk to Canifis (at ${where(q)})`);
}

/** From the landing: the hollows' boat back to Mort'ton. */
async function rowBack(q: Quest): Promise<void> {
    if (!inLanding(pos(q))) return;
    await opLoc(q, LOC.boat, HOLLOWS_BOAT, 1, () => !inLanding(pos(q)), 'the boat back to Mort\'ton', { tries: 4, ticks: 30 });
    await untilTicks(q.sdk, () => inMorttonDock(pos(q)) || !q.sdk.getState()?.interface?.isOpen, 20);
    q.log(`myq: rowed back to ${where(q)}`);
}

/** Up out of the tunnels: the basement ladder, else out of the hideout and the doors by Curpile. */
async function leaveUnderground(q: Quest): Promise<void> {
    await closeDialogs(q);
    if (inBasement(pos(q))) {
        await opLoc(q, LOC.basementLadder, BASEMENT_LADDER, 1, () => !inUnderground(pos(q)), 'the basement ladder');
        return;
    }
    // The hideout (level 3 before the ambush) and the cutscene rooms: the tunnel on our own level.
    if (inHideout(pos(q)) || pos(q).level !== 0) {
        const lvl = pos(q).level;
        await q.sdk.scanNearbyLocs(20).catch(() => undefined);
        const tunnel = (q.sdk.getNearbyLocs() ?? []).filter((l) => l.id === LOC.tunnel).sort((a, b) => (a.distance ?? 99) - (b.distance ?? 99))[0];
        const at = tunnel ?? TUNNEL;
        await opLoc(q, LOC.tunnel, at, 1, () => !inHideout(pos(q)) || pos(q).level !== lvl, 'out of the hideout tunnel');
    }
    if (!inUnderground(pos(q))) return;
    await walk(q, { x: UNDER_DOORS.x, z: UNDER_DOORS.z + 1 }, 1);
    await opLoc(q, LOC.underDoorL, UNDER_DOORS, 1, () => !inUnderground(pos(q)), 'the underground doors', { ticks: 15 });
    q.log(`myq: out of the tunnels at ${where(q)}`);
}

/** run-quest's goTo/prologue: out of the hollows, the tunnels and Mort'ton's dock, onto Canifis's side or into the swamp. */
export async function leaveMyreque(q: Quest): Promise<void> {
    await closeDialogs(q);
    if (inUnderground(pos(q))) await leaveUnderground(q);
    if (inLanding(pos(q))) await rowBack(q);
    // Mort'ton's dock: into Mort Myre's box, where run-quest's Nature Spirit hook takes it to the gate.
    if (inMorttonDock(pos(q))) await walk(q, { x: 3485, z: 3300 }, 3);
    if (inNorthHollows(pos(q))) await walk(q, CANIFIS, 3);
    if (inMyrequeArea(pos(q))) throw new Error(`myq: still in the Myreque's area at ${where(q)}`);
}

// ── the druid pouch

const bloomed = (q: Quest) => countId(q, OBJ.pear) + countId(q, OBJ.stem) + countId(q, OBJ.fungus);

/** Cyreg wants >= 5 charges: bloom by the pear bush north of Filliman's camp, pick three, fill (3 a pear). */
export async function topUpPouch(q: Quest, want = 10): Promise<void> {
    if (pouchCharges(q) >= want) return;
    if (!q.sdk.getInventory().some((i) => i.id === OBJ.sickleBlessed)) {
        if (pouchCharges(q) >= 5) return;
        throw new Error(`myq: druid pouch at ${pouchCharges(q)} charges and no blessed sickle (Nature Spirit's) to refill it`);
    }
    // From Mort'ton's dock (a resumed run) the swamp is a walk north; intoSwamp would go round by the Varrock side.
    if (inMorttonDock(pos(q))) await walk(q, { x: 3485, z: 3300 }, 3);
    await intoSwamp(q);
    for (let round = 0; round < 3 && pouchCharges(q) < want; round++) {
        await walk(q, PEAR_AT, 0);
        const t0 = tickNow(q.sdk);
        while (bloomed(q) < 3 && tickNow(q.sdk) - t0 < 200) {
            await q.sdk.scanNearbyLocs(3).catch(() => undefined);
            const ripe = (q.sdk.getNearbyLocs() ?? [])
                .filter((l) => [LOC.pearBloomed, LOC.branchBloomed, LOC.logBloomed].includes(l.id as 3513) && cheb(l, pos(q)) <= 1)
                .sort((a, b) => (a.distance ?? 9) - (b.distance ?? 9))[0];
            if (ripe) {
                const before = bloomed(q);
                await q.sdk.sendInteractLoc(ripe.x, ripe.z, ripe.id, 2);
                await untilTicks(q.sdk, () => bloomed(q) > before, 8);
                if (cheb(pos(q), PEAR_AT) > 0) await walk(q, PEAR_AT, 0);
                continue;
            }
            if ((q.sdk.getSkill('prayer')?.level ?? 0) <= 0) {
                q.log('myq: out of prayer points for the sickle');
                break;
            }
            const sickle = q.sdk.getInventory().find((i) => i.id === OBJ.sickleBlessed);
            if (!sickle) break;
            await q.sdk.sendUseItem(sickle.slot, 3);
            await q.sdk.waitForTicks(3);
        }
        const pouch = q.sdk.getInventory().find((i) => i.id === OBJ.pouch || i.id === OBJ.pouchEmpty);
        if (!pouch || bloomed(q) === 0) break;
        const before = pouchCharges(q);
        await q.sdk.sendUseItem(pouch.slot, 1);
        await untilTicks(q.sdk, () => pouchCharges(q) > before, 8);
        q.log(`myq: druid pouch ${before} -> ${pouchCharges(q)} charges`);
    }
    if (pouchCharges(q) < 5) throw new Error(`myq: druid pouch at ${pouchCharges(q)} charges after the top-up`);
}

// ── the steps

/** Vanstrom in the Hair of the Dog: the quest (5). */
export async function start(q: Quest, started: () => Promise<boolean>): Promise<void> {
    await toCanifis(q);
    for (let attempt = 1; attempt <= 3 && !(await started()); attempt++) {
        await walk(q, VANSTROM, 3);
        const seen = await talkThrough(q.sdk, q.bot, /^vanstrom klause$/i, [/yes, i'll do it/i, /perhaps i could help you/i, /why do they need help/i], q.log);
        q.log(`myq: Vanstrom: ${seen.slice(-160)}`);
    }
}

/** Through Mort Myre (topping the pouch up on the way) to Cyreg: the persuasion chain and the planks (20). */
export async function cyreg(q: Quest, agreed: () => Promise<boolean>): Promise<void> {
    await topUpPouch(q);
    if (!inMorttonDock(pos(q))) await intoSwamp(q);
    for (let attempt = 1; attempt <= 3 && !(await agreed()); attempt++) {
        if (!(await walk(q, CYREG, 3))) throw new Error(`myq: could not cross Mort Myre to Cyreg (at ${where(q)})`);
        if (pouchCharges(q) < 5) throw new Error(`myq: the swamp's ghasts left the pouch at ${pouchCharges(q)} charges`);
        const seen = await talkThrough(
            q.sdk,
            q.bot,
            /^cyreg paddlehorn$/i,
            [/die without weapons/i, /resourceful enough/i, /deaths are on your head/i, /what kind of a man/i, /^give wooden planks/i],
            q.log
        );
        q.log(`myq: Cyreg: ${seen.slice(-200)}`);
    }
}

/** Cyreg's rowboat to the hollows (25). */
export async function boat(q: Quest, landed: () => Promise<boolean>): Promise<void> {
    if (!inMorttonDock(pos(q))) {
        if (inLanding(pos(q))) return;
        await intoSwamp(q);
        await walk(q, CYREG, 3);
    }
    for (let attempt = 1; attempt <= 4 && !inLanding(pos(q)); attempt++) {
        await closeDialogs(q);
        const loc = await locById(q, LOC.boat, MORTTON_BOAT);
        await q.sdk.sendInteractLoc(loc?.x ?? MORTTON_BOAT.x, loc?.z ?? MORTTON_BOAT.z, LOC.boat, 1);
        // Cyreg asks for the fare (a chat dialog), then a 13-tick journey (an interface) lands us.
        if (await untilTicks(q.sdk, (s) => !!s.dialog?.isOpen || inLanding(pos(q)), 20)) {
            await driveDialog(q.sdk, [/yes, i'll pay ten gold/i], { done: () => inLanding(pos(q)), ticks: 30, log: q.log });
        }
        if (!(await untilTicks(q.sdk, () => inLanding(pos(q)), 30))) q.log(`myq: boat attempt ${attempt}: still at ${where(q)} (coins ${q.count('coins')})`);
    }
    if (!inLanding(pos(q))) throw new Error(`myq: Cyreg's boat never left (at ${where(q)})`);
    // "You arrive at the hollows." follows the landing as a mesbox; open over the journal it read UNKNOWN and the
    // runner never recorded 25 (qlqhmy2, 2026-11-04). Let it show, close it, and see the journal move before returning.
    await untilTicks(q.sdk, (s) => !!s.dialog?.isOpen, 8);
    await closeDialogs(q);
    for (let i = 0; i < 4 && !(await landed()); i++) {
        await q.sdk.waitForTicks(3);
        await closeDialogs(q);
    }
    q.log(`myq: at the hollows ${where(q)}`);
}

const ANSWERS: Array<[RegExp, RegExp]> = [
    [/youngest/i, /^ivan strom$/i],
    [/only female/i, /^sani piliu$/i],
    [/leader/i, /^veliaf hurtz$/i],
    [/scholar/i, /^polmafi ferdygris$/i],
    [/boatman/i, /^cyreg paddlehorn$/i],
    [/family/i, /^drakan$/i],
];

/** Back from the landing by the boat, round by Canifis to Curpile: his three questions (55). */
export async function curpile(q: Quest, answered: () => Promise<boolean>): Promise<void> {
    if (!inNorthHollows(pos(q))) {
        await toCanifis(q);
        if (!(await walk(q, CURPILE, 2))) throw new Error(`myq: could not walk from Canifis to Curpile (at ${where(q)})`);
    }
    for (let attempt = 1; attempt <= 3 && !(await answered()); attempt++) {
        if (inMorttonDock(pos(q)) || !inNorthHollows(pos(q))) {
            // Knocked out to Mort'ton by a wrong answer: round again.
            await toCanifis(q);
            await walk(q, CURPILE, 2);
        }
        await talkThrough(q.sdk, q.bot, /^curpile fyod$/i, [/come to help the myreque/i], q.log);
        // Three choice pages, the question in the header.
        const t0 = tickNow(q.sdk);
        let last = '';
        while (tickNow(q.sdk) - t0 < 80) {
            const d = q.sdk.getDialog();
            if (!d?.isOpen) {
                if (!(await untilTicks(q.sdk, (s) => !!s.dialog?.isOpen, 6))) break;
                continue;
            }
            const options = d.options ?? [];
            const cont = options.find((o) => /click here to continue/i.test(o.text));
            if (cont || !options.length) {
                await driveDialog(q.sdk, [], { ticks: 4, done: () => !!q.sdk.getDialog()?.options?.some((o) => !/click here to continue/i.test(o.text)) });
                continue;
            }
            const header = [(d.text ?? ''), ...(d.allComponents ?? []).map((c) => c.text ?? '')].join(' ');
            const ans = ANSWERS.find(([qre]) => qre.test(header));
            const pick = ans ? options.find((o) => ans[1].test(o.text.trim())) : undefined;
            const sig = header + '|' + options.map((o) => o.text).join('|');
            if (!pick) {
                q.log(`myq: Curpile: no answer for ${JSON.stringify(header.slice(0, 120))} ${JSON.stringify(options.map((o) => o.text))}`);
                break;
            }
            if (sig === last) {
                await q.sdk.waitForTicks(1);
                continue;
            }
            last = sig;
            q.log(`myq: Curpile asks ${header.match(/(youngest|only female|leader|scholar|boatman|family)/i)?.[0]}: ${pick.text}`);
            await q.sdk.sendClickDialog(pick.index);
            await untilTicks(q.sdk, () => JSON.stringify(q.sdk.getDialog()?.options?.map((o) => o.text) ?? []) !== JSON.stringify(options.map((o) => o.text)), 8);
        }
        await closeDialogs(q);
    }
}

/** The wooden doors by Curpile -> the tunnels (60). */
export async function enterDoors(q: Quest): Promise<void> {
    if (inUnderground(pos(q))) return;
    if (!inNorthHollows(pos(q))) {
        await toCanifis(q);
        await walk(q, CURPILE, 2);
    }
    await walk(q, { x: DOORS.x, z: DOORS.z - 1 }, 1);
    await opLoc(q, LOC.doorR, DOORS, 1, () => inUnderground(pos(q)), 'the hideout doors', { ticks: 15 });
    q.log(`myq: underground at ${where(q)}`);
}

/** Past the stalagmite (Agility 25) into the hideout; at stage 80 this calls the hound again. */
export async function intoHideout(q: Quest): Promise<void> {
    if (inHideout(pos(q))) return;
    if (!inUnderground(pos(q)) || inBasement(pos(q))) {
        if (inBasement(pos(q))) await leaveUnderground(q);
        await enterDoors(q);
    }
    if (q.level('agility') < 25) throw new Error(`myq: Agility ${q.level('agility')}/25 for the stalagmite`);
    await opLoc(q, LOC.stalagmite, STALAGMITE, 2, () => inHideout(pos(q)), 'the stalagmite squeeze', { ticks: 40, walk: false });
    q.log(`myq: in the hideout ${where(q)}`);
}

async function talkHere(q: Quest, npc: RegExp, choices: RegExp[] = []): Promise<string> {
    await closeDialogs(q);
    if (!(await untilTicks(q.sdk, () => !!q.sdk.findNearbyNpc(npc), 10))) {
        await walk(q, VELIAF, 3);
    }
    return talkThrough(q.sdk, q.bot, npc, choices, q.log);
}

/** Veliaf's first talk (65). */
export async function meetVeliaf(q: Quest): Promise<void> {
    await intoHideout(q);
    const seen = await talkHere(q, /^veliaf hurtz$/i, [/^ok,? thanks/i]);
    q.log(`myq: Veliaf: ${seen.slice(-120)}`);
}

const MEMBERS = [/^sani piliu$/i, /^harold evans$/i, /^radigad ponfit$/i, /^polmafi ferdygris$/i, /^ivan strom$/i];

/** The five others (a bit each on their first page), then Veliaf takes the weapons and the cutscene runs (70 -> 80). */
export async function weaponsToVeliaf(q: Quest, ambushed: () => Promise<boolean>, saved: () => Promise<boolean>): Promise<void> {
    await intoHideout(q);
    // The guard on before the cutscene: the hound attacks the moment it ends, and auto-retaliate fights it.
    const stop = survive(q, 0.55);
    try {
    if (held(q, /^steel warhammer$/i) > 0) {
        for (const m of MEMBERS) {
            await talkHere(q, m, [/^ok,? thanks/i]);
            await closeDialogs(q);
        }
    }
    for (let attempt = 1; attempt <= 3 && !(await ambushed()); attempt++) {
        await talkHere(q, /^veliaf hurtz$/i, [/^ok,? thanks/i]);
        // The cutscene: ~50 ticks of delays, then the hound.
        await untilTicks(q.sdk, () => houndNear(q) || (!q.sdk.getDialog()?.isOpen && !q.sdk.getState()?.interface?.isOpen && pos(q).level === 0 && inHideout(pos(q))), 200);
        await closeDialogs(q);
        await untilTicks(q.sdk, () => houndNear(q), 20);
    }
    } finally {
        stop();
    }
    // Finish the hound here (it is on us already): the journal can go 70 -> 85 within this step.
    if (houndNear(q)) await killHound(q, saved);
}

const hound = (q: Quest) => (q.sdk.getNearbyNpcs() ?? []).filter((n) => n.id === NPC.hound || /^skeleton hellhound$/i.test(n.name)).sort((a, b) => a.distance - b.distance)[0];
const houndNear = (q: Quest) => !!hound(q);

/** Kill the Skeleton Hellhound (85). At 80 with no hound in view, out the tunnel and back past the stalagmite calls it. */
export async function killHound(q: Quest, saved: () => Promise<boolean>): Promise<void> {
    await wieldWeapon(q);
    const stop = survive(q, 0.55);
    try {
        if (!inHideout(pos(q)) || !(await untilTicks(q.sdk, () => houndNear(q), 8))) {
            if (inHideout(pos(q))) await leaveUnderground(q).catch(() => undefined);
            if (!inUnderground(pos(q)) || !inHideout(pos(q))) await intoHideout(q);
            await untilTicks(q.sdk, () => houndNear(q), 15);
        }
        const t0 = tickNow(q.sdk);
        let lastAttack = -99;
        while (tickNow(q.sdk) - t0 < 600) {
            if (await quickSaved()) break;
            if (q.sdk.getDialog()?.isOpen) await driveDialog(q.sdk, [], { ticks: 4 });
            const h = hound(q);
            if (!h) {
                await q.sdk.waitForTicks(3);
                if (!hound(q) && (await saved())) break;
                continue;
            }
            const inCombat = q.sdk.getState()?.player?.combat?.inCombat ?? false;
            if (!inCombat || tickNow(q.sdk) - lastAttack > 16) {
                await q.bot.attack(h).catch(() => undefined);
                lastAttack = tickNow(q.sdk);
            }
            await q.sdk.waitForTicks(2);
        }
        q.log(`myq: hellhound fight ${tickNow(q.sdk) - t0}t, hp ${q.sdk.getState()?.player?.hp}`);
    } finally {
        stop();
    }
    async function quickSaved(): Promise<boolean> {
        // Its drop (big bones) beside us and no hound: dead. The journal confirms.
        const bones = (q.sdk.getState()?.groundItems ?? []).some((g) => /^big bones$/i.test(g.name) && (g.distance ?? 99) <= 10);
        return bones && !hound(q) && (await saved());
    }
}

/** Veliaf: "How do I get out of here?" (90). */
export async function askWayOut(q: Quest): Promise<void> {
    await intoHideout(q);
    const seen = await talkHere(q, /^veliaf hurtz$/i, [/how do i get out of here/i, /^ok,? thanks/i]);
    q.log(`myq: Veliaf: ${seen.slice(-120)}`);
}

/** Out of the hideout's tunnel to the false wall, through it into the inn basement (95). */
export async function falseWall(q: Quest): Promise<void> {
    if (inBasement(pos(q))) return;
    if (!inUnderground(pos(q))) await intoHideout(q);
    if (inHideout(pos(q))) {
        const lvl = pos(q).level;
        await opLoc(q, LOC.tunnel, TUNNEL, 1, () => !inHideout(pos(q)) || pos(q).level !== lvl, 'out of the hideout tunnel');
    }
    await opLoc(q, LOC.falseWall, FALSE_WALL, 1, () => inBasement(pos(q)), 'the false wall', { ticks: 40, walk: false });
}

/** The basement ladder up to Canifis (97). */
export async function basementLadder(q: Quest): Promise<void> {
    if (!inBasement(pos(q))) await falseWall(q);
    await opLoc(q, LOC.basementLadder, BASEMENT_LADDER, 1, () => !inUnderground(pos(q)), 'the basement ladder');
}

/** The Stranger in the Hair of the Dog: complete. */
export async function stranger(q: Quest, done: () => Promise<boolean>): Promise<void> {
    if (inUnderground(pos(q))) await leaveUnderground(q);
    await toCanifis(q);
    for (let attempt = 1; attempt <= 3 && !(await done()); attempt++) {
        await walk(q, VANSTROM, 3);
        await talkThrough(q.sdk, q.bot, /^(stranger|vanstrom klause)$/i, [], q.log);
        await q.sdk.waitForTicks(4);
        await closeDialogs(q);
    }
}
