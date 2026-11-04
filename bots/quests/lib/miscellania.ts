/**
 * Throne of Miscellania — the route and mechanics (bots/quests/throne-of-miscellania.ts is the definition).
 *
 * Content facts (quest_misc/scripts/*.rs2, area_miscellania/scripts/{weed_herbs,flower_girl,gardener_gunnhild,misc_sailor}.rs2,
 * quest_viking/scripts/viking_sailor.rs2; maps m39_60, m40_60, m41_57):
 *   - The Rellekka sailor (2629,3693) "Let's go!" (Fremennik Trials done) -> Miscellania's pier (2580,3845); the pier's sailor
 *     (2581,3847) sails back to (2629,3692).
 *   - The castle (L1 by the stairs at 2505,3848 south / 2505,3871 north): King Vargas (2501,3859) behind the throne-room
 *     doors (2506,3857 / 2506,3863; the door guard grants an audience to a Heroes' Guild member), Advisor Ghrim (2499,3857)
 *     in there too, Prince Brand (2502,3852) south of it, Princess Astrid (2502,3868) north.
 *   - Queen Sigrid (2612,3877 L1, Etceteria; stairs 2613,3867).
 *   - %misc_quest: Vargas 0 -> 10 (approval reset to 32/127); Sigrid 10 -> 20; Vargas 20 -> 30; Sigrid 30 -> 40; Brand
 *     40 -> 50 + awful anthem; Ghrim 50 -> 60 (good anthem, queued); Sigrid 60 -> 70 + treaty (queued); Vargas 70 -> 80;
 *     Derrik (2551,3897) "I have a slightly strange request..." + iron bar -> giant nib, nib on logs -> giant pen; Vargas
 *     80 -> 90, and at 90 with Astrid's yes (affection 40) and approval >= 96 -> complete.
 *   - Courting Astrid (male): each talk asks one question (answers shuffled); stage 1 also wants flowers (the flower girl,
 *     2514,3866: 15gp) and the Dance emote in her room, stage 2 a bow, stage 3 the Blow Kiss emote, then a ring.
 *   - Approval: weeding the herbs (2524-2530,3847-3855; worn sickle, Herblore 35) gives +1 each (Gunnhild sells sickles).
 */
import type { Quest } from './run-quest';
import { driveDialog } from './dialog';
import { tickNow, untilTicks } from './ticks';
import { readJournalCheckpoint } from '../../../quest-lab/journal-reader';

interface Tile {
    x: number;
    z: number;
    level?: number;
}

export const RELLEKKA_SAILOR = { x: 2629, z: 3692 };
const MISC_SAILOR = { x: 2581, z: 3846 };
const CASTLE_STAIRS_S = { x: 2505, z: 3848 };
const CASTLE_STAIRS_N = { x: 2505, z: 3871 };
const ETC_STAIRS = { x: 2613, z: 3867 };
const THRONE_DOOR_S = { id: 4672, x: 2506, z: 3857 };
const AT = {
    vargas: { x: 2502, z: 3860 },
    ghrim: { x: 2500, z: 3858 },
    brand: { x: 2502, z: 3853 },
    astrid: { x: 2501, z: 3868 },
    sigrid: { x: 2612, z: 3875 },
    derrik: { x: 2551, z: 3896 },
    flowers: { x: 2514, z: 3865 },
    weeds: { x: 2528, z: 3851 },
};
const EMOTE = { dance: 166, blowKiss: 11100 };
const HERBS = /^herbs$/i;

const pos = (q: Quest) => {
    const p = q.sdk.getState()?.player;
    return { x: p?.worldX ?? 0, z: p?.worldZ ?? 0, level: p?.level ?? 0 };
};
const where = (q: Quest) => `(${pos(q).x},${pos(q).z},L${pos(q).level})`;
const cheb = (a: Tile, b: Tile) => Math.max(Math.abs(a.x - b.x), Math.abs(a.z - b.z));
const held = (q: Quest, re: RegExp) => q.sdk.getInventory().some((i) => re.test(i.name));
const messagesSince = (q: Quest, t0: number) => (q.sdk.getState()?.gameMessages ?? []).filter((m) => m.tick >= t0).map((m) => m.text);
const heard = (q: Quest, t0: number, re: RegExp) => messagesSince(q, t0).some((m) => re.test(m));

/** Miscellania and Etceteria, any plane. */
export const inMiscArea = (p: Tile) => p.x >= 2490 && p.x <= 2640 && p.z >= 3835 && p.z <= 3905;
const inThroneRoom = (p: Tile) => (p.level ?? 0) === 1 && p.x >= 2495 && p.x <= 2505 && p.z >= 3857 && p.z <= 3863;

async function finishDialog(q: Quest, choices: RegExp[] = [], done?: () => boolean): Promise<string> {
    let text = '';
    for (let i = 0; i < 6 && q.sdk.getDialog()?.isOpen && !done?.(); i++) text += await driveDialog(q.sdk, choices, { done, ticks: 40, log: q.log });
    return text;
}

async function walk(q: Quest, to: Tile, tolerance = 1): Promise<void> {
    for (let attempt = 1; attempt <= 3 && cheb(pos(q), to) > tolerance; attempt++) {
        if (q.sdk.getDialog()?.isOpen) await finishDialog(q);
        const res = await q.bot.walkTo(to.x, to.z, tolerance).catch((e) => ({ success: false, message: String(e) }));
        if (res.success || cheb(pos(q), to) <= tolerance + 1) return;
        q.log(`misc: walk to (${to.x},${to.z}) from ${where(q)}: ${res.message}`);
        await q.sdk.waitForTicks(2);
    }
}

/** Talk to the nearest `npc` (no travel) and drive the dialog. */
async function talkHere(q: Quest, npc: RegExp, choices: RegExp[], label: string, done?: () => boolean): Promise<string> {
    await untilTicks(q.sdk, () => !!q.sdk.findNearbyNpc(npc), 10);
    const target = q.sdk.findNearbyNpc(npc);
    if (!target) throw new Error(`misc: no ${label} in view at ${where(q)}`);
    const res = await q.bot.talkTo(target).catch((e) => ({ success: false, message: String(e) }));
    if (!res.success && !q.sdk.getDialog()?.isOpen) q.log(`misc: talk to ${label}: ${res.message}`);
    await untilTicks(q.sdk, (s) => !!s.dialog?.isOpen, 10);
    const text = await finishDialog(q, choices, done);
    q.log(`misc: ${label}: ${text.slice(0, 240)}`);
    return text;
}

// ── travel

/** Rellekka -> Miscellania by the longship. */
export async function toIsland(q: Quest): Promise<void> {
    if (inMiscArea(pos(q))) return;
    await q.goTo(RELLEKKA_SAILOR, 3);
    for (let i = 0; i < 3 && !inMiscArea(pos(q)); i++) {
        await talkHere(q, /^sailor$/i, [/^let's go/i], 'the Rellekka sailor', () => inMiscArea(pos(q)));
        await untilTicks(q.sdk, () => inMiscArea(pos(q)), 15);
    }
    if (!inMiscArea(pos(q))) throw new Error(`misc: the Rellekka sailor did not sail (at ${where(q)}) — Fremennik Trials done?`);
    // The arrival message box opens a tick or two after the landing.
    await untilTicks(q.sdk, (s) => !!s.dialog?.isOpen, 6);
    await finishDialog(q);
}

/** Down to the ground floor (castle or Etceteria's palace). */
async function ground(q: Quest): Promise<void> {
    if (pos(q).level === 0) return;
    if (inThroneRoom(pos(q))) await leaveThroneRoom(q);
    await q.climbTo(0, pos(q).x > 2590 ? ETC_STAIRS : pos(q).z > 3860 ? CASTLE_STAIRS_N : CASTLE_STAIRS_S);
}

/** run-quest hook: off the islands by the pier's sailor. */
export async function leaveIsland(q: Quest): Promise<void> {
    if (!inMiscArea(pos(q))) return;
    await finishDialog(q);
    await ground(q);
    await walk(q, MISC_SAILOR, 3);
    for (let i = 0; i < 3 && inMiscArea(pos(q)); i++) {
        await talkHere(q, /^sailor$/i, [/^let's go/i], 'the Miscellania sailor', () => !inMiscArea(pos(q)));
        await untilTicks(q.sdk, () => !inMiscArea(pos(q)), 15);
    }
    if (inMiscArea(pos(q))) throw new Error(`misc: the Miscellania sailor did not sail (at ${where(q)})`);
    await untilTicks(q.sdk, (s) => !!s.dialog?.isOpen, 6);
    await finishDialog(q);
}

/** Up into the castle's first floor by the stairs nearest `toward`. */
async function castleL1(q: Quest, toward: Tile): Promise<void> {
    await toIsland(q);
    if (pos(q).level === 1 && pos(q).x < 2530) return;
    await ground(q);
    const stairs = toward.z > 3860 ? CASTLE_STAIRS_N : CASTLE_STAIRS_S;
    await walk(q, { x: stairs.x, z: stairs.z + (stairs === CASTLE_STAIRS_N ? 1 : -1) }, 2);
    await q.climbTo(1, stairs);
}

/** Into the throne room by its south door: the guard grants the audience (Heroes' Quest) the first time. */
async function throneRoom(q: Quest): Promise<void> {
    if (inThroneRoom(pos(q))) return;
    await castleL1(q, THRONE_DOOR_S);
    await walk(q, { x: THRONE_DOOR_S.x, z: THRONE_DOOR_S.z - 1 }, 1);
    for (let i = 0; i < 5 && !inThroneRoom(pos(q)); i++) {
        await q.sdk.scanNearbyLocs(5).catch(() => undefined);
        const door = (q.sdk.getNearbyLocs() ?? []).find((l) => /throne room door/i.test(l.name) && cheb(l, THRONE_DOOR_S) <= 1);
        if (door && door.options?.some((o) => /^open$/i.test(o))) await q.sdk.sendInteractLoc(door.x, door.z, door.id, 1);
        await untilTicks(q.sdk, (s) => !!s.dialog?.isOpen || inThroneRoom(pos(q)), 8);
        if (q.sdk.getDialog()?.isOpen) {
            const text = await finishDialog(q);
            if (/Heroes' Guild, he will definitely/i.test(text)) throw new Error("misc: the door guard wants Heroes' Quest done");
            continue;
        }
        if (!inThroneRoom(pos(q))) await walk(q, AT.vargas, 1);
    }
    if (!inThroneRoom(pos(q))) throw new Error(`misc: could not get into the throne room (at ${where(q)})`);
}

async function leaveThroneRoom(q: Quest): Promise<void> {
    for (let i = 0; i < 5 && inThroneRoom(pos(q)); i++) {
        await walk(q, { x: THRONE_DOOR_S.x - 1, z: THRONE_DOOR_S.z }, 0);
        await q.sdk.sendInteractLoc(THRONE_DOOR_S.x, THRONE_DOOR_S.z, THRONE_DOOR_S.id, 1);
        await q.sdk.waitForTicks(2);
        await q.sdk.sendWalk(THRONE_DOOR_S.x, THRONE_DOOR_S.z - 1);
        await untilTicks(q.sdk, () => !inThroneRoom(pos(q)), 5);
    }
}

/** Up to Queen Sigrid's floor in Etceteria. */
async function toSigrid(q: Quest): Promise<void> {
    await toIsland(q);
    if (pos(q).level === 1 && pos(q).x > 2590) return;
    await ground(q);
    await walk(q, { x: ETC_STAIRS.x - 1, z: ETC_STAIRS.z - 1 }, 2);
    await q.climbTo(1, ETC_STAIRS);
}

// ── the people

export async function talkVargas(q: Quest, label: string, choices: RegExp[] = []): Promise<string> {
    await throneRoom(q);
    return talkHere(q, /^king vargas$/i, choices, `Vargas (${label})`);
}
export async function talkSigrid(q: Quest, label: string): Promise<string> {
    await toSigrid(q);
    await walk(q, AT.sigrid, 2);
    return talkHere(q, /^queen sigrid$/i, [], `Sigrid (${label})`);
}
export async function brandAnthem(q: Quest): Promise<void> {
    await castleL1(q, AT.brand);
    if (inThroneRoom(pos(q))) await leaveThroneRoom(q);
    await walk(q, AT.brand, 2);
    await talkHere(q, /^prince brand$/i, [], 'Brand (anthem)', () => held(q, /^awful anthem$/i));
    await untilTicks(q.sdk, () => held(q, /^awful anthem$/i), 4);
}
export async function ghrimAnthem(q: Quest): Promise<void> {
    await throneRoom(q);
    // His menu loops after the anthem: stop on the swap (queued, lands once the dialog closes).
    await talkHere(q, /^advisor ghrim$/i, [], 'Ghrim (anthem)', () => !!q.sdk.getDialog()?.options?.some((o) => /meant to be doing again/i.test(o.text)));
    await q.bot.closeInterface().catch(() => undefined);
    await untilTicks(q.sdk, () => held(q, /^good anthem$/i), 6);
}

/** Derrik's giant nib (iron bar), then the nib on logs: the giant pen. */
export async function giantPen(q: Quest): Promise<void> {
    if (held(q, /^giant pen$/i)) return;
    if (!held(q, /^giant nib$/i)) {
        await toIsland(q);
        await ground(q);
        await walk(q, AT.derrik, 2);
        await talkHere(q, /^derrik$/i, [/slightly strange request/i], 'Derrik', () => held(q, /^giant nib$/i));
        await untilTicks(q.sdk, () => held(q, /^giant nib$/i), 4);
        if (!held(q, /^giant nib$/i)) throw new Error('misc: Derrik made no giant nib (an iron bar held, stage 80?)');
    }
    for (let i = 0; i < 3 && !held(q, /^giant pen$/i); i++) {
        const nib = q.sdk.findInventoryItem(/^giant nib$/i);
        const log = q.sdk.findInventoryItem(/^(logs|oak logs|willow logs|maple logs|yew logs|magic logs|achey tree logs)$/i);
        if (!nib || !log) throw new Error('misc: a giant nib and logs needed for the pen');
        await q.sdk.sendUseItemOnItem(nib.slot, log.slot);
        await untilTicks(q.sdk, () => held(q, /^giant pen$/i), 4);
    }
    if (!held(q, /^giant pen$/i)) throw new Error('misc: no giant pen');
}

// ── the marriage

const JOURNAL = { label: 'Throne of Miscellania', title: 'Throne of Miscellania' };
type Sdk = Parameters<typeof readJournalCheckpoint>[0];
async function journalSays(q: Quest, re: string): Promise<boolean> {
    const r = await readJournalCheckpoint(q.sdk as unknown as Sdk, JOURNAL, { id: 'misc:probe', kind: 'active', all: [re], none: [] });
    return r.verdict?.verdict === 'PASS';
}
export const married = (q: Quest) => journalSays(q, '(Princess|Prince) agreed to marry me');
export const needsSupport = (q: Quest) => journalSays(q, 'I need to get the support');

/** Princess Astrid's right answers, whatever order the menu shows them in (princess_astrid.rs2). */
// Order matters: the first pattern any option matches is taken. "Hahahaha!" is right for the admirers (stage 1) and wrong
// for the history (stage 2, beside "What happened next?").
const ASTRID_ANSWERS = [
    /^what happened next/i,
    /^archery is a noble art/i,
    /^hahahaha/i,
    /^he's been very helpful/i,
    /^i'm quite fond of it myself/i,
    /^that sounds like a good idea/i,
    /^and what a great bard he makes/i,
    /^i suppose you don't have much opportunity/i,
    /^it's a lovely little country/i,
];

/** Emotes in her room (misc_quest.rs2: the emote only counts in her room's zone). */
async function emote(q: Quest, id: number, label: string): Promise<string> {
    await walk(q, AT.astrid, 1);
    const t0 = tickNow(q.sdk);
    await q.sdk.sendClickComponent(id);
    await untilTicks(q.sdk, (s) => !!s.dialog?.isOpen, 8);
    const text = await finishDialog(q);
    q.log(`misc: ${label} emote: ${text.slice(0, 120) || messagesSince(q, t0).join(' | ')}`);
    return text;
}

async function give(q: Quest, item: RegExp, label: string): Promise<string> {
    const it = q.sdk.findInventoryItem(item);
    if (!it) throw new Error(`misc: no ${label} for Astrid`);
    const astrid = q.sdk.findNearbyNpc(/^princess astrid$/i);
    if (!astrid) throw new Error(`misc: Astrid not in view (at ${where(q)})`);
    await q.bot.useItemOnNpc(it, astrid).catch(() => undefined);
    await untilTicks(q.sdk, (s) => !!s.dialog?.isOpen, 8);
    const text = await finishDialog(q, [/^yes$/i]);
    q.log(`misc: gave ${label}: ${text.slice(0, 160)}`);
    return text;
}

/** Flowers from the flower girl (15gp for a bunch). */
export async function buyFlowers(q: Quest): Promise<void> {
    if (held(q, /^flowers$/i)) return;
    await toIsland(q);
    await ground(q);
    await walk(q, AT.flowers, 3);
    await talkHere(q, /^flower girl$/i, [/^yes, please/i], 'the flower girl', () => held(q, /^flowers$/i));
    if (!held(q, /^flowers$/i)) throw new Error('misc: the flower girl sold no flowers (15 coins held?)');
}

/** Court Princess Astrid until the journal says she agreed (male characters). */
export async function court(q: Quest, bow: RegExp, ring: RegExp): Promise<void> {
    for (let round = 0; round < 40; round++) {
        if (await married(q)) return;
        if (!held(q, /^flowers$/i) && round === 0) await buyFlowers(q).catch((e: Error) => q.log(e.message));
        await castleL1(q, AT.astrid);
        if (inThroneRoom(pos(q))) await leaveThroneRoom(q);
        await walk(q, AT.astrid, 2);
        const text = await talkHere(q, /^princess astrid$/i, ASTRID_ANSWERS, `Astrid (${round})`);
        if (/good day, madam/i.test(text) || /find some way to turn back into a man/i.test(text)) {
            throw new Error('misc: a female character courts Prince Brand — not supported yet');
        }
        if (/> /.test(text) || /you have to marry somebody|not yet told me your name|growing quite fond|shortlist/i.test(text)) continue;
        // A greeting only: this stage's questions are answered and a gift or an emote is pending.
        if (/good day, princess/i.test(text) && !/hello, dear/i.test(text)) {
            await give(q, bow, 'a bow');
        } else if (/hello, dear/i.test(text)) {
            await emote(q, EMOTE.blowKiss, 'Blow Kiss');
            if (held(q, ring)) await give(q, ring, 'a ring');
        } else {
            if (held(q, /^flowers$/i)) await give(q, /^flowers$/i, 'flowers');
            await emote(q, EMOTE.dance, 'Dance');
        }
    }
    if (!(await married(q))) throw new Error('misc: Astrid has not agreed after 40 rounds');
}

// ── the people's support

const SICKLE = /^(iron sickle|silver sickle|silver sickle\s?\(b\))$/i;
const wornSickle = (q: Quest) => q.sdk.getEquipment().some((i) => SICKLE.test(i.name));

/** A sickle worn: one held, else Gardener Gunnhild's (15gp). */
async function wearSickle(q: Quest): Promise<void> {
    if (wornSickle(q)) return;
    if (!held(q, SICKLE)) {
        await walk(q, AT.weeds, 3);
        await talkHere(q, /^gardener gunnhild$/i, [/what do you have for sale/i, /iron sickle, please/i], 'Gunnhild', () => held(q, SICKLE));
    }
    const s = q.sdk.findInventoryItem(SICKLE);
    if (!s) throw new Error('misc: no sickle (15 coins for Gunnhild?)');
    await q.bot.equipItem(s).catch(() => undefined);
    await untilTicks(q.sdk, () => wornSickle(q), 4);
}

/**
 * Weed `target` herb patches (+1 approval each; Vargas reset it to 32 of 127 and wants 96), then the sickle back into the
 * pack (the epilogue banks the pack, not what is worn).
 */
export async function weedForSupport(q: Quest, target: number): Promise<void> {
    await toIsland(q);
    await ground(q);
    await walk(q, AT.weeds, 3);
    await wearSickle(q);
    const t0 = tickNow(q.sdk);
    let weeded = 0;
    let lastWeedTick = Math.max(-1, ...(q.sdk.getState()?.gameMessages ?? []).filter((m) => /manage to weed some herbs/i.test(m.text)).map((m) => m.tick));
    const rest = new Map<string, number>();
    while (tickNow(q.sdk) - t0 < 2500) {
        if (weeded >= target) break;
        if (q.sdk.getDialog()?.isOpen) {
            const text = await finishDialog(q);
            if (/don't trouble yourself further/i.test(text)) break;
        }
        await q.sdk.scanNearbyLocs(8).catch(() => undefined);
        const now = tickNow(q.sdk);
        const herb = (q.sdk.getNearbyLocs() ?? [])
            .filter((l) => HERBS.test(l.name) && l.options?.some((o) => /^weed$/i.test(o)) && (rest.get(`${l.x},${l.z}`) ?? 0) <= now)
            .sort((a, b) => cheb(a, pos(q)) - cheb(b, pos(q)))[0];
        if (!herb) {
            await q.sdk.waitForTicks(3);
            continue;
        }
        const before = tickNow(q.sdk);
        // A success is a NEW "You manage to weed" line: the last one's tick can equal this op's start tick, and counting it
        // again doubled the tally (qlqgms2 counted 114 for ~57 real, 2026-11-04).
        const seen = lastWeedTick;
        const fresh = () => (q.sdk.getState()?.gameMessages ?? []).filter((m) => m.tick > seen && /manage to weed some herbs/i.test(m.text)).map((m) => m.tick);
        await q.sdk.sendInteractLoc(herb.x, herb.z, herb.id, 1);
        const ok = await untilTicks(q.sdk, () => fresh().length > 0, 16);
        if (ok) lastWeedTick = Math.max(...fresh());
        rest.set(`${herb.x},${herb.z}`, tickNow(q.sdk) + (ok ? 50 : 8));
        if (ok) weeded++;
        if (heard(q, before, /need a sickle|level 35 herblore/i)) throw new Error('misc: weeding wants a worn sickle and Herblore 35');
    }
    q.log(`misc: weeded ${weeded} patches in ${tickNow(q.sdk) - t0}t`);
    const worn = q.sdk.getEquipment().find((i) => SICKLE.test(i.name));
    if (worn) await q.bot.unequipItem(worn).catch(() => undefined);
}

/** Weed, then ask Vargas: his "not yet very supportive" means more weeding (approval is not readable otherwise). */
export async function supportAndCrown(q: Quest): Promise<void> {
    // 64 lifts 32 to 96; a resumed run starts higher, and the flower girl and Gunnhild add a little.
    let batch = 66;
    for (let round = 0; round < 6; round++) {
        await weedForSupport(q, batch);
        const text = await talkVargas(q, 'the coronation');
        if (!/not yet very supportive/i.test(text)) return;
        batch = 16;
    }
    throw new Error('misc: the population is still not supportive after 6 rounds of weeding');
}
