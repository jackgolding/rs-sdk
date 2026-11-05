/**
 * Murder Mystery — solve Lord Sinclair's murder at the Sinclair Mansion, north of Seers' Village.
 *
 *   bun bots/quests/murder-mystery.ts {botname}
 *
 * Journal rules from quest_murder/scripts/murder_journal.rs2; mechanics from quest_murder.rs2,
 * murder_guard.rs2, the six family scripts and area_seers/poison_salesman.rs2. Tiles are content
 * placements (m42_55, m42_54).
 *
 * The murderer is random (%murdersus, set when the guard takes you on) and the game never says
 * who until a fingerprint matches. The guard closes the case only with all three proofs:
 *   - thread   the smashed window (2747,3577): its colour names two suspects (green Anna/David,
 *              red Bob/Carol, blue Elizabeth/Frank)
 *   - prints   flour on the dagger from the study, flypaper on that: the unknown print. The same on
 *              a suspect's silver item from their barrel; their print on the unknown one either
 *              matches ("exact match to X's") or is destroyed. Flour: an empty pot (lib/sources.ts,
 *              Arhein's store) filled at the mansion's flour barrel; flypaper from the sacks.
 *   - poison   the salesman in Seers' Village names the Sinclairs (progress 1), the murderer explains
 *              the poison (2), and the place they claimed to poison turns out untouched (3). The
 *              journal then reads "indisputable evidence".
 * A matched suspect's print stays in the pack (only a mismatch is destroyed), so a resumed run knows
 * the murderer from it. Reward 2000 coins, Crafting XP, 3 QP.
 */
import type { InventoryItem } from '../../sdk/types';
import { runQuest, type Quest } from './lib/run-quest';
import { driveDialog } from './lib/dialog';
import { untilTicks } from './lib/ticks';
import { leaveMansionUpstairs } from './lib/sinclair-mansion';

type Tile = { x: number; z: number; level?: number };

const GUARD = { x: 2739, z: 3577 };
const WINDOW = { x: 2747, z: 3577 };
/** In the study, beside the dagger (2746,3578) and the pungent pot (2747,3579). */
const DAGGER = { x: 2746, z: 3578 };
const FLOUR_BARREL = { x: 2735, z: 3582 };
const SACKS = { x: 2731, z: 3582 };
/** The poison salesman's two spawns, Seers' Village. */
const SALESMAN = [{ x: 2737, z: 3491 }, { x: 2695, z: 3495 }];

const OBJ = {
    potEmpty: 1931,
    potFlour: 1933,
    flypaper: 1811,
    dagger: 1813,
    unknownPrint: 1822,
    killersPrint: 1815,
    threads: { 1808: 'red', 1809: 'green', 1810: 'blue' } as Record<number, string>,
} as const;

interface Suspect {
    name: string;
    npc: RegExp;
    at: Tile;
    barrel: Tile;
    /** Their silver item, its floured form, and their print. */
    item: number;
    dusted: number;
    print: number;
    /** The place they say they poisoned. */
    loc: { at: Tile; name: RegExp };
    thread: string;
}

const SUSPECTS: Suspect[] = [
    { name: 'Anna', npc: /^anna$/i, at: { x: 2734, z: 3575 }, barrel: { x: 2733, z: 3575, level: 0 }, item: 1796, dusted: 1797, print: 1816, loc: { at: { x: 2730, z: 3572 }, name: /compost heap/i }, thread: 'green' },
    { name: 'Bob', npc: /^bob$/i, at: { x: 2748, z: 3559 }, barrel: { x: 2733, z: 3578, level: 0 }, item: 1798, dusted: 1799, print: 1817, loc: { at: { x: 2730, z: 3559 }, name: /beehive/i }, thread: 'red' },
    { name: 'Carol', npc: /^carol$/i, at: { x: 2734, z: 3581, level: 1 }, barrel: { x: 2733, z: 3581, level: 1 }, item: 1800, dusted: 1801, print: 1818, loc: { at: { x: 2736, z: 3573 }, name: /drain/i }, thread: 'red' },
    { name: 'David', npc: /^david$/i, at: { x: 2739, z: 3581 }, barrel: { x: 2733, z: 3578, level: 1 }, item: 1802, dusted: 1803, print: 1819, loc: { at: { x: 2740, z: 3574, level: 1 }, name: /spiders' nest/i }, thread: 'green' },
    { name: 'Elizabeth', npc: /^elizabeth$/i, at: { x: 2746, z: 3581, level: 1 }, barrel: { x: 2747, z: 3581, level: 1 }, item: 1804, dusted: 1805, print: 1820, loc: { at: { x: 2747, z: 3563 }, name: /fountain/i }, thread: 'blue' },
    { name: 'Frank', npc: /^frank$/i, at: { x: 2742, z: 3577 }, barrel: { x: 2747, z: 3577, level: 1 }, item: 1806, dusted: 1807, print: 1821, loc: { at: { x: 2746, z: 3573 }, name: /crest/i }, thread: 'blue' },
];

const pos = (q: Quest) => {
    const p = q.sdk.getState()?.player;
    return { x: p?.worldX ?? 0, z: p?.worldZ ?? 0, level: p?.level ?? 0 };
};
const where = (q: Quest) => `(${pos(q).x},${pos(q).z},L${pos(q).level})`;
const held = (q: Quest, id: number): InventoryItem | undefined => q.sdk.getInventory().find((i) => i.id === id);
const has = (q: Quest, id: number) => !!held(q, id);

function cursor(q: Quest): number {
    return Math.max(0, ...(q.sdk.getState()?.gameMessages ?? []).map((m) => m.observationId ?? m.tick));
}
function linesSince(q: Quest, since: number): string {
    return (q.sdk.getState()?.gameMessages ?? [])
        .filter((m) => (m.observationId ?? m.tick) > since)
        .map((m) => m.text)
        .join(' / ');
}
function dialogText(q: Quest): string {
    const d = q.sdk.getDialog();
    return d?.isOpen ? (d.allComponents ?? []).map((c) => c.text).filter(Boolean).join(' ') : '';
}

const downstairs = (q: Quest) => leaveMansionUpstairs(q);

/** Walk to `at` (any floor), op the loc named `name` nearest it with `opt`, drive the dialog with `choices`. Returns messages + dialog text. */
async function opLoc(q: Quest, at: Tile, name: RegExp, opt: RegExp, done: (() => boolean) | null, label: string, choices: Array<RegExp | string> = []): Promise<string> {
    try {
        return await opLocHere(q, at, name, opt, done, label, choices);
    } finally {
        if ((at.level ?? 0) > 0) await downstairs(q);
    }
}

async function opLocHere(q: Quest, at: Tile, name: RegExp, opt: RegExp, done: (() => boolean) | null, label: string, choices: Array<RegExp | string> = []): Promise<string> {
    // No `done`: an investigation, one look is the answer.
    const finished = done ?? (() => false);
    let seen = '';
    for (let attempt = 1; attempt <= 4; attempt++) {
        if (finished()) return seen;
        // goTo to an upstairs tile from the ground floor does not climb ("arrived on the wrong floor" on
        // jacklove2, ABGARMY06, jacklove7, 2026-11-04): get near on our floor, then climb to theirs.
        const lvl = at.level ?? 0;
        const here = q.sdk.getState()?.player?.level ?? 0;
        if (here !== lvl) {
            if (lvl > here) await q.goTo({ x: at.x, z: at.z }, 6).catch((e) => q.log(`murder: ${label}: ${(e as Error).message.slice(0, 100)}`));
            await q.climbTo(lvl, { x: at.x, z: at.z }).catch((e) => q.log(`murder: ${label}: climb: ${(e as Error).message.slice(0, 100)}`));
        }
        await q.goTo({ x: at.x, z: at.z, level: lvl }, 3);
        // Barrels and the like sit in rooms behind shut doors ("I can't reach that!" from Anna's).
        await q.reach(name, opt).catch((e) => q.log(`murder: ${label}: ${(e as Error).message}`));
        await q.sdk.scanNearbyLocs(10).catch(() => undefined);
        const loc = (q.sdk.getNearbyLocs() ?? [])
            .filter((l) => name.test(l.name) && l.optionsWithIndex.some((o) => opt.test(o.text)))
            .sort((a, b) => Math.hypot(a.x - at.x, a.z - at.z) - Math.hypot(b.x - at.x, b.z - at.z))[0];
        if (!loc) {
            q.log(`murder: ${label}: no ${name} with ${opt} near (${at.x},${at.z}) from ${where(q)}`);
            await q.sdk.waitForTicks(3);
            continue;
        }
        const since = cursor(q);
        const res = await q.bot.interactLoc(loc, opt);
        if (!res.success) q.log(`murder: ${label}: ${res.message}`);
        await untilTicks(q.sdk, (s) => finished() || !!s.dialog?.isOpen || linesSince(q, since).length > 0, 15);
        if (q.sdk.getDialog()?.isOpen) seen += ' ' + dialogText(q) + ' ' + (await driveDialog(q.sdk, choices, { done: finished, ticks: 60, log: q.log }));
        await untilTicks(q.sdk, finished, 4);
        const said = linesSince(q, since);
        seen += ' ' + said;
        if (finished()) return seen;
        if (!done && seen.trim() && !/can't reach/i.test(said)) return seen;
        q.log(`murder: ${label} attempt ${attempt}: ${seen.trim().slice(0, 160) || 'nothing'}`);
    }
    if (!finished()) throw new Error(`murder: ${label} failed at ${where(q)}: ${seen.slice(0, 200)}`);
    return seen;
}

/** Use inventory item `src` on `dst` (both ids); tries the other way round if nothing happens. */
async function useOn(q: Quest, src: number, dst: number, done: () => boolean, label: string): Promise<string> {
    let seen = '';
    for (const [a, b] of [
        [src, dst],
        [dst, src],
    ] as const) {
        const ia = held(q, a);
        const ib = held(q, b);
        if (!ia || !ib) throw new Error(`murder: ${label}: missing ${!ia ? a : b} (carrying ${q.sdk.getInventory().map((i) => i.name).join(', ')})`);
        const since = cursor(q);
        await q.sdk.sendUseItemOnItem(ia.slot, ib.slot);
        await untilTicks(q.sdk, (s) => done() || !!s.dialog?.isOpen, 8);
        if (q.sdk.getDialog()?.isOpen) seen += ' ' + dialogText(q) + ' ' + (await driveDialog(q.sdk, [], { ticks: 30, log: q.log }));
        await untilTicks(q.sdk, done, 3);
        seen += ' ' + linesSince(q, since);
        if (done() || /don't seem to be the same|exact match/i.test(seen)) return seen;
    }
    throw new Error(`murder: ${label} did nothing: ${seen.slice(0, 200)}`);
}

// ── evidence

function threadColour(q: Quest): string | null {
    for (const i of q.sdk.getInventory()) if (OBJ.threads[i.id]) return OBJ.threads[i.id]!;
    return null;
}

async function takeThread(q: Quest): Promise<string> {
    if (!threadColour(q)) {
        await opLoc(q, WINDOW, /smashed window/i, /investigate/i, () => !!threadColour(q), 'window thread');
    }
    const colour = threadColour(q);
    if (!colour) throw new Error('murder: no thread from the window');
    q.log(`murder: ${colour} thread — suspects ${SUSPECTS.filter((s) => s.thread === colour).map((s) => s.name).join(' / ')}`);
    return colour;
}

async function takeDagger(q: Quest): Promise<void> {
    if (has(q, OBJ.dagger) || has(q, OBJ.unknownPrint) || has(q, OBJ.killersPrint)) return;
    await q.goTo({ x: DAGGER.x, z: DAGGER.z, level: 0 }, 1);
    for (let i = 0; i < 4 && !has(q, OBJ.dagger); i++) {
        const ground = (await q.sdk.scanGroundItems(6).catch(() => [])).find((g) => g.id === OBJ.dagger);
        if (!ground) throw new Error(`murder: no dagger in the study (from ${where(q)})`);
        await q.sdk.sendPickup(ground.x, ground.z, ground.id);
        await untilTicks(q.sdk, (s) => has(q, OBJ.dagger) || !!s.dialog?.isOpen, 10);
        if (q.sdk.getDialog()?.isOpen) await driveDialog(q.sdk, [], { ticks: 20, log: q.log });
    }
    if (!has(q, OBJ.dagger)) throw new Error('murder: could not take the dagger');
    q.log('murder: took the dagger');
}

/** A pot of flour from the mansion's barrel (the empty pot comes back after every dusting). */
async function flour(q: Quest): Promise<void> {
    if (has(q, OBJ.potFlour)) return;
    if (!has(q, OBJ.potEmpty)) await q.ensure('pot', 1);
    await opLoc(q, FLOUR_BARREL, /barrel of flour/i, /take from/i, () => has(q, OBJ.potFlour), 'flour barrel');
}

async function flypaper(q: Quest): Promise<void> {
    if (has(q, OBJ.flypaper)) return;
    await opLoc(q, SACKS, /^sacks$/i, /investigate/i, () => has(q, OBJ.flypaper), 'sacks', [/yes,? it might be useful/i]);
}

/** Flour then flypaper on `item` (its floured form `dusted`), giving `print`. */
async function liftPrint(q: Quest, item: number, dusted: number, print: number, label: string): Promise<void> {
    if (has(q, print)) return;
    if (!has(q, dusted)) {
        await flour(q);
        await useOn(q, OBJ.potFlour, item, () => has(q, dusted), `flour on ${label}`);
    }
    await flypaper(q);
    await useOn(q, OBJ.flypaper, dusted, () => has(q, print), `flypaper on ${label}`);
    q.log(`murder: lifted ${label}'s print`);
}

/** The suspect whose print matched, from the pack (a mismatched print is destroyed). */
const matched = (q: Quest) => (has(q, OBJ.killersPrint) ? SUSPECTS.find((s) => has(q, s.print)) : undefined);

/** Fingerprints: the unknown print against each thread suspect until one matches. */
async function solvePrints(q: Quest, colour: string): Promise<Suspect | null> {
    if (has(q, OBJ.killersPrint)) return matched(q) ?? null;
    await takeDagger(q);
    if (!has(q, OBJ.unknownPrint)) await liftPrint(q, OBJ.dagger, OBJ.dagger + 1, OBJ.unknownPrint, 'the dagger');
    for (const s of SUSPECTS.filter((x) => x.thread === colour)) {
        if (!has(q, s.print)) {
            if (!has(q, s.item) && !has(q, s.dusted)) {
                await opLoc(q, s.barrel, new RegExp(`^${s.name}s' barrel$`, 'i'), /search/i, () => has(q, s.item), `${s.name}'s barrel`);
            }
            await liftPrint(q, s.item, s.dusted, s.print, s.name);
        }
        const said = await useOn(q, s.print, OBJ.unknownPrint, () => has(q, OBJ.killersPrint) || !has(q, s.print), `${s.name}'s print on the unknown print`);
        if (has(q, OBJ.killersPrint)) {
            q.log(`murder: the prints match ${s.name}`);
            return s;
        }
        q.log(`murder: not ${s.name} (${said.trim().slice(0, 80)})`);
    }
    throw new Error(`murder: no ${colour}-thread suspect's print matched`);
}

async function salesman(q: Quest): Promise<void> {
    for (const at of SALESMAN) {
        const seen = await q.talk(/^poison salesman$/i, [/talk about the murder mystery/i, /who did you sell poison to/i], at);
        if (/bought a bottle/i.test(seen)) return;
        q.log(`murder: salesman at (${at.x},${at.z}): ${seen.slice(0, 120) || 'no dialog'}`);
    }
    throw new Error('murder: the poison salesman never named the Sinclairs');
}

/** Salesman, the suspect's poison story, then their poisoned place. True once it proves them a liar. */
async function poisonProof(q: Quest, s: Suspect): Promise<boolean> {
    // Upstairs suspects (Carol, Elizabeth): climb first — talk's goTo does not (jacklove2 wrong floor, 2026-11-05).
    if ((s.at.level ?? 0) > (q.sdk.getState()?.player?.level ?? 0)) {
        await q.goTo({ x: s.at.x, z: s.at.z }, 6).catch((e) => q.log(`murder: ${s.name}: ${(e as Error).message.slice(0, 100)}`));
        await q.climbTo(s.at.level ?? 0, { x: s.at.x, z: s.at.z }).catch((e) => q.log(`murder: ${s.name}: climb: ${(e as Error).message.slice(0, 100)}`));
    }
    const seen = await q.talk(s.npc, [/why'?d you buy poison/i], s.at);
    await downstairs(q);
    if (!/poison/i.test(seen)) q.log(`murder: ${s.name} said nothing of poison: ${seen.slice(0, 120)}`);
    const found = await opLoc(q, s.loc.at, s.loc.name, /investigate/i, null, `${s.name}'s ${s.loc.name.source}`);
    const proven = /certainly clear nobody|definitely don't seem poisoned/i.test(found);
    q.log(`murder: ${s.name}'s ${s.loc.name.source}: ${proven ? 'never poisoned — the lie' : 'poisoned'}`);
    return proven;
}

/** Thread, prints and poison: the journal moves to "indisputable evidence". */
async function investigate(q: Quest): Promise<void> {
    const colour = await takeThread(q);
    const murderer = await solvePrints(q, colour);
    await salesman(q);
    const candidates = murderer ? [murderer] : SUSPECTS.filter((s) => s.thread === colour);
    for (const s of candidates) if (await poisonProof(q, s)) return;
    throw new Error(`murder: no poison lie proven for ${candidates.map((s) => s.name).join('/')}`);
}

/** An empty pot for the flour barrel, until the prints are done (a pot of flour counts). */
const potNeed = (q: Quest) => (q.count(/^killers' print$/i) ? [] : [{ item: 'pot', count: 1, or: 'pot of flour' }]);

const stage = (id: string, kind: 'unstarted' | 'active' | 'complete', all: string[], none: string[] = []) => ({
    id,
    rule: { id: `murder:${id}`, kind, all, none },
});

await runQuest({
    id: 'murder',
    hub: 'seers',
    // Shared barrels and locs are per player; the guard and family are not contested. Default slots.
    carry: [
        OBJ.potEmpty,
        OBJ.potFlour,
        OBJ.flypaper,
        OBJ.dagger,
        OBJ.dagger + 1,
        OBJ.unknownPrint,
        OBJ.killersPrint,
        ...Object.keys(OBJ.threads).map(Number),
        ...SUSPECTS.flatMap((s) => [s.item, s.dusted, s.print]),
    ],
    journal: { label: 'Murder Mystery', title: 'Murder Mystery' },
    stages: [
        stage('unstarted', 'unstarted', ['I can start this quest by speaking to']),
        stage('started', 'active', ['examine the crime scene'], ['indisputable evidence']),
        stage('proven', 'active', ['indisputable evidence'], ['QUEST COMPLETE']),
        stage('complete', 'complete', ['QUEST COMPLETE']),
    ],
    transitions: [
        { from: 'unstarted', to: 'started', at: GUARD, needs: potNeed, talk: { npc: /^guard$/i, choices: [/sure,? i'?ll help/i] } },
        { from: 'started', to: 'proven', needs: potNeed, run: (q) => investigate(q) },
        { from: 'proven', to: 'complete', at: GUARD, talk: { npc: /^guard$/i, choices: [/i know who did it/i] } },
    ],
});
