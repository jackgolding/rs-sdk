/**
 * The Dig Site — the Exam Centre's three Earth Science exams, the expert's talisman, the shafts' explosive and
 * the Zarosian tablet.
 *
 * Content facts (quest_itexam/scripts/*.rs2, area_varrock/scripts/curator.rs2; placements m52_53/54, m52_153);
 * route cross-checked with rs-stun-toolkit's q-the-digsite.ts spec:
 *   - Examiner (3361,3342): "Can I take an exam?" -> letter (-> 1). The Varrock museum's curator stamps it when
 *     it is used on him; the stamped letter back to the examiner (-> 2).
 *   - Exam 1's samples: rock sample 3 in the bush (3357,3372) (stage <= 2); rock sample 2 by panning (a cup of tea
 *     to the panning guide (3375,3376) first, the tray (3369,3378), panning points (3376-3384,3372-3381), Search
 *     the muddy tray); rock sample 1 and a specimen brush by pickpocketing a digsite workman (Thieving 25).
 *     Sample 3 to the purple student (617), sample 1 to the green one (615), sample 2 to the orange one (616).
 *     Examiner: "Yes, I certainly am." and the answers -> trowel (-> 3).
 *   - Exam 2: one talk per student, then "I am ready for the next exam." (-> 4). Exam 3: the same, the purple
 *     student wants a cut opal, then "I am ready for the last exam..." (-> 5).
 *   - A trowel opens a barrel (3364,3378), an empty vial takes its liquid; the sacks (3359,3398) give a specimen
 *     jar; trowel on level-3 soil (3350-3357,3404-3412) with jar + brush: 1 in 20 the talisman. Talisman ->
 *     expert (3355,3334) -> scroll; liquid -> nitroglycerin. The scroll to a workman = the shaft permit (-> 6).
 *   - Rope on winch 2 (3370,3428), down: the workman below (3352,9821) gives his chest key after a lot of
 *     "please". Rope (3353,9817) up. The key on the chest (3374,3378), the open chest -> powder; expert -> ammonium
 *     nitrate. Nitroglycerin on nitrate, pestle on charcoal, ground charcoal on the mix.
 *   - Rope on winch 1 (3352,3417), down: an arcenia root (3365,9829) into the mix -> compound; on the bricks
 *     (3379,9825) (-> 7); the tinderbox from exactly (3379,9826) blows them (-> 8) and lands you in the cleared
 *     cave. The tablet (3374,9747), the rope (3370,9763) up, the tablet to the expert (complete).
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
    vial: 229, jar: 669, brush: 670, s1: 671, s2: 672, s3: 673, trowel: 676, tray: 677, trayMud: 679, talisman: 681,
    letter: 682, stamped: 683, cert2: 692, cert3: 693, scroll: 696, tablet: 699, powder: 700, nitrate: 701, liquid: 702,
    nitro: 703, ground: 704, pre: 705, post: 706, compound: 707, root: 708, key: 709, charcoal: 973, opal: 1609,
    pestle: 233, tinderbox: 590, rope: 954, tea: 1978,
} as const;
const NPC = { workman: 613, worker2: 614, student1: 615, student3: 616, student2: 617, examiner: 618, guide: 620, curator: 646 };

export const EXAMINER = { x: 3361, z: 3342 };
const EXPERT = { x: 3355, z: 3334 };
const CURATOR = { x: 3256, z: 3446 };
const GUIDE = { x: 3375, z: 3376 };
const TRAY = { x: 3369, z: 3378 };
const STUDENTS = { x: 3358, z: 3408 };
const DIG = { x: 3353, z: 3408 };
const BUSH = { x: 3357, z: 3372 };
const SACKS = { x: 3359, z: 3398 };
const BARREL = { x: 3364, z: 3378 };
const CHEST = { x: 3374, z: 3378 };
const WORKMEN = { x: 3358, z: 3386 };
const WINCH1 = { x: 3352, z: 3417 };
const WINCH2 = { x: 3370, z: 3428 };
const WORKER2 = { x: 3352, z: 9820 };
const ROPE_W = { x: 3353, z: 9817 };
const ROPE_E = { x: 3370, z: 9763 };
const BRICK = { x: 3379, z: 9825 };
const BLAST_STAND = { x: 3379, z: 9826 };
const ROOT_E = { x: 3365, z: 9829 };
const TABLET = { x: 3374, z: 9747 };
const PAN_POINTS: Tile[] = [{ x: 3378, z: 3374 }, { x: 3378, z: 3375 }, { x: 3379, z: 3377 }, { x: 3376, z: 3372 }, { x: 3381, z: 3378 }];
/** Level-3 soil ids by tile (maps m52_53): the dig is a trowel used on the soil loc. */
const SOIL_IDS = [2376, 2377, 2378];
const SOIL_TILES: Array<[number, number, number]> = [[3353, 3408, 2376], [3354, 3408, 2377], [3352, 3408, 2377], [3353, 3407, 2376], [3354, 3407, 2377], [3352, 3407, 2378]];

export const ANSWERS = [
    /^the study of the earth,? its contents,? and history/i, /^all that have passed the appropriate earth sciences exam/i, /^gloves and boots to be worn at all times/i,
    /^samples taken in rough form/i, /^finds must be carefully handled,? and gloves worn/i, /^always handle with care;? strike cleanly/i,
    /^samples cleaned,? and carried only in specimen jars/i, /^brush carefully and slowly using short strokes/i, /^handle bones very carefully/i,
];

const pos = (q: Quest) => {
    const p = q.sdk.getState()?.player;
    return { x: p?.worldX ?? 0, z: p?.worldZ ?? 0, level: p?.level ?? 0 };
};
const where = (q: Quest) => `(${pos(q).x},${pos(q).z},L${pos(q).level})`;
const inBox = (p: Tile, x0: number, x1: number, z0: number, z1: number) => p.x >= x0 && p.x <= x1 && p.z >= z0 && p.z <= z1;
export const held = (q: Quest, id: number) => q.sdk.getInventory().some((i) => i.id === id);
const inv = (q: Quest, id: number) => q.sdk.getInventory().find((i) => i.id === id);
const near = (q: Quest, t: Tile) => Math.hypot(pos(q).x - t.x, pos(q).z - t.z);

/** The two shafts under the dig site. */
export const inDigShafts = (p: Tile) => inBox(p, 3330, 3400, 9730, 9850);

function cursor(q: Quest): number {
    return Math.max(0, ...(q.sdk.getState()?.gameMessages ?? []).map((m) => m.observationId ?? m.tick));
}
function said(q: Quest, since: number, text: RegExp): boolean {
    return (q.sdk.getState()?.gameMessages ?? []).some((m) => (m.observationId ?? m.tick) > since && text.test(m.text));
}

async function locAt(q: Quest, at: Tile, id?: number, name?: RegExp, within = 2) {
    await q.sdk.scanNearbyLocs(15).catch(() => undefined);
    return (q.sdk.getNearbyLocs() ?? [])
        .filter((l) => (id === undefined || l.id === id) && (!name || name.test(l.name)))
        .filter((l) => Math.hypot(l.x - at.x, l.z - at.z) <= within)
        .sort((a, b) => Math.hypot(a.x - at.x, a.z - at.z) - Math.hypot(b.x - at.x, b.z - at.z))[0];
}

async function walk(q: Quest, t: Tile, tol = 1): Promise<void> {
    if (near(q, t) <= tol) return;
    const r = await q.bot.walkTo(t.x, t.z, tol).catch((e) => ({ success: false, message: String(e) }));
    if (!r.success) q.log(`dig: walk (${t.x},${t.z}): ${r.message}`);
}

/** Op a loc (by id or name near `at`), driving any dialog; true once `done`. */
async function opLoc(q: Quest, at: Tile, sel: { id?: number; name?: RegExp }, opt: RegExp, done: () => boolean, label: string, choices: RegExp[] = []): Promise<void> {
    for (let attempt = 1; attempt <= 4 && !done(); attempt++) {
        const loc = await locAt(q, at, sel.id, sel.name, 3);
        const o = loc?.optionsWithIndex.find((x) => opt.test(x.text));
        if (!loc || !o) {
            q.log(`dig: ${label}: no loc ${sel.id ?? sel.name} with ${opt} near (${at.x},${at.z}) from ${where(q)}`);
            await q.sdk.waitForTicks(3);
            continue;
        }
        await q.sdk.sendInteractLoc(loc.x, loc.z, loc.id, o.opIndex);
        await untilTicks(q.sdk, (s) => done() || !!s.dialog?.isOpen, 20);
        if (q.sdk.getDialog()?.isOpen) await driveDialog(q.sdk, choices, { done, ticks: 60, log: q.log });
        await untilTicks(q.sdk, done, 6);
    }
    if (!done()) throw new Error(`dig: ${label} failed at ${where(q)}`);
}

async function useOnLoc(q: Quest, item: number, at: Tile, sel: { id?: number; name?: RegExp }, done: () => boolean, label: string, choices: RegExp[] = []): Promise<void> {
    for (let attempt = 1; attempt <= 4 && !done(); attempt++) {
        const it = inv(q, item);
        const loc = await locAt(q, at, sel.id, sel.name, 3);
        if (!it || !loc) throw new Error(`dig: ${label}: item ${!!it} loc ${!!loc} at ${where(q)}`);
        await q.bot.useItemOnLoc(it, loc).catch(() => undefined);
        await untilTicks(q.sdk, (s) => done() || !!s.dialog?.isOpen, 20);
        if (q.sdk.getDialog()?.isOpen) await driveDialog(q.sdk, choices, { done, ticks: 60, log: q.log });
        await untilTicks(q.sdk, done, 6);
    }
    if (!done()) throw new Error(`dig: ${label} failed at ${where(q)}`);
}

/** The npc of type `id` nearest `at` (several students and workmen share names). */
async function npcOf(q: Quest, id: number, at: Tile) {
    if (near(q, at) > 12) await walk(q, at, 3);
    await untilTicks(q.sdk, () => q.sdk.getNearbyNpcs().some((n) => n.id === id), 10);
    return (q.sdk.getNearbyNpcs() ?? []).filter((n) => n.id === id).sort((a, b) => (a.distance ?? 99) - (b.distance ?? 99));
}

async function talkId(q: Quest, id: number, at: Tile, choices: RegExp[], done?: () => boolean): Promise<string> {
    let seen = '';
    for (let attempt = 0; attempt < 4; attempt++) {
        const cands = await npcOf(q, id, at);
        const npc = cands[attempt % Math.max(1, Math.min(cands.length, 3))];
        if (!npc) throw new Error(`dig: no npc ${id} near (${at.x},${at.z}) from ${where(q)}`);
        const r = await q.bot.talkTo(npc).catch((e) => ({ success: false, message: String(e) }));
        if (!r.success) {
            q.log(`dig: talk npc ${id}: ${r.message}`);
            continue;
        }
        seen = await driveDialog(q.sdk, choices, { ticks: 150, done, log: q.log });
        if (seen) return seen;
    }
    return seen;
}

async function giveNpc(q: Quest, id: number, item: number, at: Tile, done: () => boolean, label: string, choices: RegExp[] = []): Promise<void> {
    for (let attempt = 0; attempt < 4 && !done(); attempt++) {
        const it = inv(q, item);
        if (!it) throw new Error(`dig: ${label}: item ${item} not held`);
        const npc = (await npcOf(q, id, at))[0];
        if (!npc) throw new Error(`dig: ${label}: no npc ${id} near (${at.x},${at.z})`);
        await q.bot.useItemOnNpc(it, npc).catch(() => undefined);
        await untilTicks(q.sdk, (s) => done() || !!s.dialog?.isOpen, 12);
        if (q.sdk.getDialog()?.isOpen) await driveDialog(q.sdk, choices, { ticks: 80, done, log: q.log });
        await untilTicks(q.sdk, done, 6);
    }
    if (!done()) throw new Error(`dig: ${label} failed at ${where(q)}`);
}

async function examiner(q: Quest, choices: RegExp[], done: () => boolean): Promise<void> {
    for (let attempt = 0; attempt < 3 && !done(); attempt++) {
        await talkId(q, NPC.examiner, EXAMINER, choices, done);
        await untilTicks(q.sdk, done, 4);
    }
}

async function combine(q: Quest, a: number, b: number, made: number, label: string): Promise<void> {
    for (let attempt = 1; attempt <= 3 && !held(q, made); attempt++) {
        const x = inv(q, a);
        const y = inv(q, b);
        if (!x || !y) throw new Error(`dig: ${label}: missing ${!x ? a : b}`);
        await q.sdk.sendUseItemOnItem(x.slot, y.slot);
        await untilTicks(q.sdk, (s) => held(q, made) || !!s.dialog?.isOpen, 8);
        if (q.sdk.getDialog()?.isOpen) await driveDialog(q.sdk, [], { ticks: 20, done: () => held(q, made) });
        await untilTicks(q.sdk, () => held(q, made), 6);
    }
    if (!held(q, made)) throw new Error(`dig: ${label} made nothing`);
}

/** Drop what digging and panning pile up (keeps the quest items and the dig kit). */
async function dropJunk(q: Quest): Promise<void> {
    const keep = new Set<number>(Object.values(OBJ) as number[]);
    for (const it of q.sdk.getInventory()) {
        if (keep.has(it.id) || /^(coins|shark|rope)$/i.test(it.name)) continue;
        if (q.sdk.getInventory().length < 24) break;
        await q.sdk.sendDropItem(it.slot).catch(() => undefined);
        await q.sdk.waitForTicks(1);
    }
}

// ── 0 -> 1 -> 2

export async function takeLetter(q: Quest): Promise<void> {
    await examiner(q, [/can i take an exam/i], () => held(q, OBJ.letter));
}

export async function stampLetter(q: Quest): Promise<void> {
    if (!held(q, OBJ.stamped)) {
        if (!held(q, OBJ.letter)) await takeLetter(q);
        await q.goTo(CURATOR, 4);
        await giveNpc(q, NPC.curator, OBJ.letter, CURATOR, () => held(q, OBJ.stamped), 'the curator\'s stamp');
    }
    // The bush's sample answers only up to stage 2: on the way back.
    if (!held(q, OBJ.s3)) {
        await q.goTo({ x: BUSH.x, z: BUSH.z - 1 }, 2);
        await opLoc(q, BUSH, { name: /bush/i }, /search/i, () => held(q, OBJ.s3), 'the bush\'s rock sample');
    }
    await q.goTo(EXAMINER, 4);
    await examiner(q, [], () => !held(q, OBJ.stamped));
}

// ── 2 -> 3: samples and exam 1

async function panning(q: Quest): Promise<void> {
    if (held(q, OBJ.s2)) return;
    if (held(q, OBJ.tea)) {
        await talkId(q, NPC.guide, GUIDE, [], () => !held(q, OBJ.tea));
    }
    if (!held(q, OBJ.tray) && !held(q, OBJ.trayMud)) {
        await walk(q, TRAY, 2);
        for (let i = 0; i < 6 && !held(q, OBJ.tray); i++) {
            await q.sdk.scanGroundItems(8).catch(() => undefined);
            const g = (q.sdk.getState()?.groundItems ?? []).find((it) => it.id === OBJ.tray);
            if (g) await q.bot.pickupItem(g).catch(() => undefined);
            await untilTicks(q.sdk, () => held(q, OBJ.tray), 10);
        }
        if (!held(q, OBJ.tray)) throw new Error('dig: no panning tray');
    }
    const t0 = tickNow(q.sdk);
    let pans = 0;
    while (!held(q, OBJ.s2) && tickNow(q.sdk) - t0 < 1500) {
        await dropJunk(q);
        const mud = inv(q, OBJ.trayMud);
        if (mud) {
            // opheld2 = Search the muddy tray (area_digsite.rs2:34).
            await q.sdk.sendUseItem(mud.slot, 2).catch(() => undefined);
            await untilTicks(q.sdk, (s) => !held(q, OBJ.trayMud) || !!s.dialog?.isOpen, 8);
            if (q.sdk.getDialog()?.isOpen) await driveDialog(q.sdk, [], { ticks: 10 });
            continue;
        }
        const pt = PAN_POINTS[pans % PAN_POINTS.length]!;
        const loc = await locAt(q, pt, 2363, undefined, 2);
        if (!loc) {
            await walk(q, pt, 2);
            continue;
        }
        const since = cursor(q);
        await q.sdk.sendInteractLoc(loc.x, loc.z, loc.id, loc.optionsWithIndex[0]?.opIndex ?? 1);
        pans++;
        await untilTicks(q.sdk, (s) => held(q, OBJ.trayMud) || !!s.dialog?.isOpen, 12);
        if (q.sdk.getDialog()?.isOpen) await driveDialog(q.sdk, [], { ticks: 10 });
        if (said(q, since, /forget it/i)) throw new Error('dig: the panning guide blocks the pan (no tea?)');
    }
    if (!held(q, OBJ.s2)) throw new Error(`dig: no rock sample 2 after ${pans} pans`);
    q.log(`dig: rock sample 2 after ${pans} pans (${tickNow(q.sdk) - t0}t)`);
}

async function pickpocket(q: Quest): Promise<void> {
    const t0 = tickNow(q.sdk);
    while ((!held(q, OBJ.s1) || !held(q, OBJ.brush)) && tickNow(q.sdk) - t0 < 900) {
        await dropJunk(q);
        const w = (await npcOf(q, NPC.workman, WORKMEN))[0];
        if (!w) {
            await walk(q, WORKMEN, 3);
            continue;
        }
        const r = await q.bot.pickpocketNpc(w).catch((e) => ({ success: false, message: String(e) }));
        if (!r.success && /stun/i.test(r.message)) await q.sdk.waitForTicks(8);
        if (q.sdk.getDialog()?.isOpen) await driveDialog(q.sdk, [], { ticks: 10 });
        await q.sdk.waitForTicks(1);
    }
    if (!held(q, OBJ.s1) || !held(q, OBJ.brush)) throw new Error(`dig: pickpocketing left sample ${held(q, OBJ.s1)} brush ${held(q, OBJ.brush)}`);
    q.log(`dig: rock sample 1 + brush (${tickNow(q.sdk) - t0}t)`);
}

export async function examOne(q: Quest): Promise<void> {
    if (!held(q, OBJ.trowel)) {
        await panning(q);
        await pickpocket(q);
        if (held(q, OBJ.s3)) await giveNpc(q, NPC.student2, OBJ.s3, STUDENTS, () => !held(q, OBJ.s3), 'sample 3 to the purple student');
        if (held(q, OBJ.s1)) await giveNpc(q, NPC.student1, OBJ.s1, STUDENTS, () => !held(q, OBJ.s1), 'sample 1 to the green student');
        if (held(q, OBJ.s2)) await giveNpc(q, NPC.student3, OBJ.s2, STUDENTS, () => !held(q, OBJ.s2), 'sample 2 to the orange student');
    }
    await examiner(q, [/yes,? i certainly am/i, ...ANSWERS], () => held(q, OBJ.trowel) || false);
    if (!held(q, OBJ.trowel)) await examiner(q, [/yes,? i certainly am/i, ...ANSWERS], () => held(q, OBJ.trowel));
}

// ── 3 -> 4 -> 5: exams 2 and 3

async function studentTips(q: Quest): Promise<void> {
    for (const id of [NPC.student1, NPC.student3, NPC.student2]) await talkId(q, id, STUDENTS, []);
}

export async function examTwo(q: Quest, passed: () => Promise<boolean>): Promise<void> {
    await studentTips(q);
    await examiner(q, [/i am ready for the next exam/i, ...ANSWERS], () => held(q, OBJ.cert2));
    if (!held(q, OBJ.cert2) && !(await passed())) throw new Error('dig: exam 2 not passed');
}

export async function examThree(q: Quest, passed: () => Promise<boolean>): Promise<void> {
    await talkId(q, NPC.student1, STUDENTS, []);
    await talkId(q, NPC.student3, STUDENTS, []);
    // The purple student: one talk asks for an opal, the next takes it.
    await talkId(q, NPC.student2, STUDENTS, []);
    if (held(q, OBJ.opal)) await talkId(q, NPC.student2, STUDENTS, [], () => !held(q, OBJ.opal));
    await examiner(q, [/i am ready for the last exam/i, ...ANSWERS], () => held(q, OBJ.cert3));
    if (!held(q, OBJ.cert3) && !(await passed())) throw new Error('dig: exam 3 not passed');
}

// ── 5 -> 6: liquid, talisman, permit

async function liquid(q: Quest): Promise<void> {
    if (held(q, OBJ.liquid) || held(q, OBJ.nitro)) return;
    await walk(q, { x: BARREL.x, z: BARREL.z - 1 }, 2);
    // The trowel levers the lid ("Great! It's opened it." is a chat page, not a message), then the vial.
    for (let attempt = 1; attempt <= 4 && !held(q, OBJ.liquid); attempt++) {
        const barrel = await locAt(q, BARREL, 2359, undefined, 3);
        const trowel = inv(q, OBJ.trowel);
        if (!barrel || !trowel) throw new Error(`dig: barrel ${!!barrel} trowel ${!!trowel} at ${where(q)}`);
        await q.bot.useItemOnLoc(trowel, barrel).catch(() => undefined);
        await untilTicks(q.sdk, (s) => !!s.dialog?.isOpen, 15);
        await driveDialog(q.sdk, [], { ticks: 15 });
        const vial = inv(q, OBJ.vial);
        if (!vial) throw new Error('dig: no empty vial for the barrel');
        await q.bot.useItemOnLoc(vial, barrel).catch(() => undefined);
        await untilTicks(q.sdk, (s) => held(q, OBJ.liquid) || !!s.dialog?.isOpen, 15);
        await driveDialog(q.sdk, [], { ticks: 15 });
    }
    if (!held(q, OBJ.liquid)) throw new Error('dig: no liquid from the barrel');
}

async function talisman(q: Quest): Promise<void> {
    if (held(q, OBJ.talisman) || held(q, OBJ.scroll)) return;
    if (!held(q, OBJ.jar)) {
        await walk(q, { x: SACKS.x, z: SACKS.z - 1 }, 2);
        await opLoc(q, SACKS, { id: 2356 }, /search/i, () => held(q, OBJ.jar), 'the specimen jar sacks');
    }
    await walk(q, DIG, 0);
    const t0 = tickNow(q.sdk);
    let digs = 0;
    while (!held(q, OBJ.talisman) && digs < 300 && tickNow(q.sdk) - t0 < 3000) {
        await dropJunk(q);
        const tr = inv(q, OBJ.trowel);
        if (!tr) throw new Error('dig: no trowel');
        const [x, z, id] = SOIL_TILES[digs % SOIL_TILES.length]!;
        const since = cursor(q);
        await q.sdk.sendUseItemOnLoc(tr.slot, x, z, id);
        digs++;
        await untilTicks(q.sdk, (s) => held(q, OBJ.talisman) || said(q, since, /you find|you dig/i) || !!s.dialog?.isOpen, 14);
        await untilTicks(q.sdk, (s) => held(q, OBJ.talisman) || said(q, since, /you find/i) || !!s.dialog?.isOpen, 10);
        if (q.sdk.getDialog()?.isOpen) await driveDialog(q.sdk, [], { ticks: 10 });
    }
    if (!held(q, OBJ.talisman)) throw new Error(`dig: no talisman after ${digs} digs`);
    q.log(`dig: talisman after ${digs} digs (${tickNow(q.sdk) - t0}t)`);
    void SOIL_IDS;
}

export async function permit(q: Quest): Promise<void> {
    await liquid(q);
    await talisman(q);
    if (held(q, OBJ.talisman)) await giveNpc(q, 619, OBJ.talisman, EXPERT, () => held(q, OBJ.scroll), 'the talisman to the expert');
    if (held(q, OBJ.liquid)) await giveNpc(q, 619, OBJ.liquid, EXPERT, () => held(q, OBJ.nitro), 'the liquid to the expert');
    await giveNpc(q, NPC.workman, OBJ.scroll, WORKMEN, () => !held(q, OBJ.scroll), 'the scroll to a workman');
}

// ── 6 -> 7 -> 8 -> complete: the shafts

async function down(q: Quest, winch: Tile, id: number): Promise<void> {
    if (inDigShafts(pos(q))) return;
    await walk(q, { x: winch.x, z: winch.z - 1 }, 2);
    // A rope tied once stays tied (itexam bits): operate first, tie only when "does not reach the bottom".
    const since = cursor(q);
    await opLoc(q, winch, { id }, /operate|use|climb/i, () => inDigShafts(pos(q)) || said(q, since, /does not reach the bottom/i), 'the winch', [/yes/i]);
    if (!inDigShafts(pos(q))) {
        const r0 = q.count('rope');
        const rope = inv(q, OBJ.rope);
        const loc = await locAt(q, winch, id, undefined, 3);
        if (!rope || !loc) throw new Error(`dig: rope ${!!rope} winch ${!!loc} at ${where(q)}`);
        await q.bot.useItemOnLoc(rope, loc).catch(() => undefined);
        await untilTicks(q.sdk, () => q.count('rope') < r0 || inDigShafts(pos(q)), 15);
        await driveDialog(q.sdk, [], { ticks: 8 });
        await opLoc(q, winch, { id }, /operate|use|climb/i, () => inDigShafts(pos(q)), 'down the winch', [/yes/i]);
    }
}

export async function leaveShafts(q: Quest): Promise<void> {
    if (!inDigShafts(pos(q))) return;
    if (q.sdk.getDialog()?.isOpen) await driveDialog(q.sdk, [], { ticks: 10 });
    const rope = pos(q).z < 9792 ? ROPE_E : ROPE_W;
    await walk(q, rope, 2);
    await opLoc(q, rope, { name: /rope/i }, /climb/i, () => !inDigShafts(pos(q)), 'up the rope');
}

export async function chestKey(q: Quest): Promise<void> {
    if (held(q, OBJ.powder) || held(q, OBJ.nitrate) || held(q, OBJ.pre) || held(q, OBJ.post) || held(q, OBJ.compound)) return;
    if (!held(q, OBJ.key)) {
        await down(q, WINCH2, 2351);
        await talkId(q, NPC.worker2, WORKER2, [
            /i have been invited to research here/i, /do you know where to find a chest key/i, /i don'?t suppose i could use it/i,
            /^please\?/i, /aww\.\.\. go on/i, /^pretty please!$/i, /pretty please with sugar on top/i,
        ], () => held(q, OBJ.key));
        if (!held(q, OBJ.key)) throw new Error('dig: no chest key from the workman below');
        await leaveShafts(q);
    }
    await walk(q, { x: CHEST.x, z: CHEST.z - 1 }, 2);
    await useOnLoc(q, OBJ.key, CHEST, { name: /chest/i }, () => !held(q, OBJ.key), 'the key on the chest');
    await opLoc(q, CHEST, { name: /chest/i }, /search|open/i, () => held(q, OBJ.powder), 'the chest\'s powder');
    await giveNpc(q, 619, OBJ.powder, EXPERT, () => held(q, OBJ.nitrate), 'the powder to the expert');
}

export async function compound(q: Quest): Promise<void> {
    if (held(q, OBJ.compound)) return;
    if (!held(q, OBJ.pre) && !held(q, OBJ.post)) await combine(q, OBJ.nitrate, OBJ.nitro, OBJ.pre, 'nitroglycerin into the nitrate');
    if (!held(q, OBJ.ground) && !held(q, OBJ.post)) await combine(q, OBJ.charcoal, OBJ.pestle, OBJ.ground, 'grinding charcoal');
    if (!held(q, OBJ.post)) await combine(q, OBJ.pre, OBJ.ground, OBJ.post, 'charcoal into the mix');
    await down(q, WINCH1, 2350);
    if (!held(q, OBJ.root)) {
        await walk(q, ROOT_E, 2);
        for (let i = 0; i < 20 && !held(q, OBJ.root); i++) {
            await q.sdk.scanGroundItems(10).catch(() => undefined);
            const g = (q.sdk.getState()?.groundItems ?? []).filter((it) => it.id === OBJ.root).sort((a, b) => Math.hypot(a.x - pos(q).x, a.z - pos(q).z) - Math.hypot(b.x - pos(q).x, b.z - pos(q).z))[0];
            if (g) await q.bot.pickupItem(g).catch(() => undefined);
            await untilTicks(q.sdk, () => held(q, OBJ.root), g ? 10 : 6);
        }
        if (!held(q, OBJ.root)) throw new Error('dig: no arcenia root');
    }
    await combine(q, OBJ.post, OBJ.root, OBJ.compound, 'the arcenia root into the mix');
}

export async function pourCompound(q: Quest): Promise<void> {
    await compound(q);
    await walk(q, BLAST_STAND, 0);
    await useOnLoc(q, OBJ.compound, BRICK, { id: 2362 }, () => !held(q, OBJ.compound), 'the compound on the bricks');
}

export async function blast(q: Quest): Promise<void> {
    if (!inDigShafts(pos(q))) await down(q, WINCH1, 2350);
    for (let attempt = 1; attempt <= 6 && pos(q).z >= 9792; attempt++) {
        await walk(q, BLAST_STAND, 0);
        if (pos(q).x !== BLAST_STAND.x || pos(q).z !== BLAST_STAND.z) {
            await q.sdk.sendWalk(BLAST_STAND.x, BLAST_STAND.z, true).catch(() => undefined);
            await untilTicks(q.sdk, () => pos(q).x === BLAST_STAND.x && pos(q).z === BLAST_STAND.z, 8);
        }
        const tb = inv(q, OBJ.tinderbox);
        if (!tb) throw new Error('dig: no tinderbox for the blast');
        await q.sdk.sendUseItemOnLoc(tb.slot, BRICK.x, BRICK.z, 2362);
        await untilTicks(q.sdk, (s) => pos(q).z < 9792 || !!s.dialog?.isOpen, 20);
        if (q.sdk.getDialog()?.isOpen) await driveDialog(q.sdk, [], { ticks: 60, done: () => pos(q).z < 9792 });
        await untilTicks(q.sdk, () => pos(q).z < 9792, 10);
    }
    if (pos(q).z >= 9792) throw new Error(`dig: the blast did not go off (at ${where(q)})`);
}

export async function tabletToExpert(q: Quest, done: () => Promise<boolean>): Promise<void> {
    if (!held(q, OBJ.tablet)) {
        if (!inDigShafts(pos(q)) || pos(q).z >= 9792) await blast(q);
        await walk(q, TABLET, 2);
        for (let i = 0; i < 10 && !held(q, OBJ.tablet); i++) {
            await q.sdk.scanGroundItems(10).catch(() => undefined);
            const g = (q.sdk.getState()?.groundItems ?? []).find((it) => it.id === OBJ.tablet);
            if (g) await q.bot.pickupItem(g).catch(() => undefined);
            await untilTicks(q.sdk, () => held(q, OBJ.tablet), 10);
        }
        if (!held(q, OBJ.tablet)) throw new Error('dig: no stone tablet');
    }
    await leaveShafts(q);
    await q.goTo(EXPERT, 4);
    await giveNpc(q, 619, OBJ.tablet, EXPERT, () => !held(q, OBJ.tablet), 'the tablet to the expert');
    await untilTicks(q.sdk, () => false, 4);
    void done;
}
