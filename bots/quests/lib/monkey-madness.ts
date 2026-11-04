/**
 * Monkey Madness — King Narnode's missing 10th squad, Ape Atoll, Awowogei and the Jungle Demon.
 *
 * Content facts (quest_mm/scripts/*.rs2, configs/quest_mm.*; placements m37_154, m38_54, m40_51,
 * m40_70, m41_70, m42_43, m43_42, m43_43, m43_142, m45_42, m46_46, m46_47). The rs-stun-toolkit's
 * q-monkeymadness.ts (a spec, never run) walked the same route at rev 289.
 *
 * Chapter 1
 *   - King Narnode (Grand Tree trunk, 2466,3497): "Yes" -> seal (mm_gnome_royal_seal 4004), main 1.
 *   - Glider (pilot on L3, "Can you take me on the glider?", glidermap 802: com 824 Gandius, 825 the
 *     Grand Tree). The shipyard gate (2945,3041): the worker sees the seal (main 2) and lets us in.
 *     Caranock (2956,3025) -> caranock 3. Out by the gate, the Gandius pilot (2970,2973) home.
 *   - Narnode -> orders (4005; p_delay 3 while he writes). Daero, the Grand Tree bar L1 (2484,3486):
 *     three topics, each "Return to previous menu", then "Leave..." / "Who is it?" -> blindfolded to
 *     the hangar (2393,9892). Daero there (Waydar within 14) -> started_reinit.
 *   - The Reinitialisation Panel (4871 at 2394,9883) opens reinitialisation_puzzle (11126): a 5x5
 *     sliding board on com 11130, [opheld5,_mm_reinit] moves a tile into the hole. Solved: a cutscene,
 *     then the second hangar (2649,4507). Daero (Waydar within 14) -> daero_complete; Waydar "Yes" ->
 *     Crash Island (2893,2725).
 *   - Waydar there (-> arrived_island), Lumdo (2891,2724: seal shown, won't take us), Waydar "I cannot
 *     convince Lumdo..." (Lumdo within 10) -> the chapter 2 cutscene -> Ape Atoll (2801,2707), main 3.
 *   - The hangars' Teleportation Device (4868-4870) drops us by the Gnomeball pitch (2393,3466).
 */
import type { Quest } from './run-quest';
import type { NearbyLoc } from '../../../sdk/types';
import { driveDialog } from './dialog';
import { settle, talkNarnode, upTree, inShipyard, leaveShipyard } from './grand-tree';
import { tickNow, untilTicks } from './ticks';

export interface Tile {
    x: number;
    z: number;
    level?: number;
}

/** Obj ids (pack/obj.pack). */
export const OBJ = {
    seal: 4004,
    orders: 4005,
    dentures: 4006,
    enchantedBar: 4007,
    mould: 4020,
    amulet: 4021,
    amuletUnstrung: 4022,
    talisman: 4023,
    greegree: 4031,
    backpackMonkey: 4033,
    sigil: 4035,
    monkeyBones: 3183,
    banana: 1963,
    goldBar: 2357,
} as const;

/** reinitialisation_01..24 are 3904, 3906, ... 3950 (each with a cert id between). */
const PUZZLE_FIRST = 3904;
const PUZZLE_IF = 11126;
const PUZZLE_BOARD = 11130;
const GLIDERMAP = 802;
const GLIDER_GANDIUS = 824;
const GLIDER_GRAND_TREE = 825;

const GANDIUS_PILOT = { x: 2970, z: 2973 };
const SHIPYARD_GATE = { x: 2945, z: 3041 };
const CARANOCK = { x: 2956, z: 3025 };
const DAERO_BAR = { x: 2484, z: 3486, level: 1 };
const PANEL = { x: 2394, z: 9883, id: 4871 };
const HANGAR2 = { x: 2649, z: 4507 };
export const ATOLL_LANDING = { x: 2801, z: 2707 };

const pos = (q: Quest) => {
    const p = q.sdk.getState()?.player;
    return { x: p?.worldX ?? 0, z: p?.worldZ ?? 0, level: p?.level ?? 0 };
};
export const where = (q: Quest) => `(${pos(q).x},${pos(q).z},L${pos(q).level})`;
const inBox = (p: Tile, x0: number, x1: number, z0: number, z1: number) => p.x >= x0 && p.x <= x1 && p.z >= z0 && p.z <= z1;
const cheb = (a: Tile, b: Tile) => Math.max(Math.abs(a.x - b.x), Math.abs(a.z - b.z));
export const held = (q: Quest, id: number) => q.sdk.getInventory().some((i) => i.id === id);
export const worn = (q: Quest, id: number) => q.sdk.getEquipment().some((i) => i.id === id);

/** The first hangar (blindfolded in under the Gnomeball pitch). */
export const inHangar1 = (p: Tile) => inBox(p, 2368, 2431, 9856, 9919);
/** The second hangar (after reinitialisation) and its cutscene square. */
export const inHangar2 = (p: Tile) => inBox(p, 2560, 2687, 4480, 4543);
/** Crash Island (mapsquare 45_42). */
export const onCrashIsland = (p: Tile) => inBox(p, 2880, 2943, 2688, 2751);
/** Ape Atoll, surface and its caves (m42-43_42-43, m42-43_142-143). */
export const onApeAtoll = (p: Tile) => inBox(p, 2688, 2815, 2688, 2815) || inBox(p, 2688, 2815, 9088, 9215);
/** The Gandius side of Karamja the gliders land on, outside the shipyard. */
const atGandius = (p: Tile) => inBox(p, 2900, 3000, 2950, 3060) && !inShipyard(p);

export function cursor(q: Quest): number {
    return Math.max(0, ...(q.sdk.getState()?.gameMessages ?? []).map((m) => m.observationId ?? m.tick));
}
export function said(q: Quest, since: number, text: RegExp): boolean {
    return (q.sdk.getState()?.gameMessages ?? []).some((m) => (m.observationId ?? m.tick) > since && text.test(m.text));
}
const modal = (q: Quest) => (q.sdk.getState()?.interface?.isOpen ? q.sdk.getState()!.interface.interfaceId : -1);

/** Close a main modal (chapter screens) a quest step opened. */
export async function closeMain(q: Quest): Promise<void> {
    for (let i = 0; i < 4 && modal(q) !== -1; i++) {
        await q.sdk.sendCloseModal().catch(() => undefined);
        await untilTicks(q.sdk, () => modal(q) === -1, 3);
    }
}

export async function walk(q: Quest, to: Tile, tolerance = 1): Promise<boolean> {
    const res = await q.bot.walkTo(to.x, to.z, tolerance).catch((e) => ({ success: false, message: String(e) }));
    if (!res.success) q.log(`mm: walk to (${to.x},${to.z}): ${res.message} (at ${where(q)})`);
    return cheb(pos(q), to) <= tolerance + 1;
}

/** Drive dialogs that reopen across p_delays and cutscenes until `done` or none opens for `gap` ticks. */
export async function drive(q: Quest, choices: Array<RegExp | string>, ticks: number, done?: () => boolean, gap = 12): Promise<string> {
    const t0 = tickNow(q.sdk);
    let seen = '';
    while (tickNow(q.sdk) - t0 < ticks && !done?.()) {
        if (!q.sdk.getDialog()?.isOpen && !(await untilTicks(q.sdk, (s) => !!s.dialog?.isOpen || !!done?.(), gap))) break;
        if (done?.()) break;
        seen += await driveDialog(q.sdk, choices, { done, ticks: ticks - (tickNow(q.sdk) - t0), log: q.log });
        // Stopped on a choice page none of `choices` answers: leave it to the caller.
        const d = q.sdk.getDialog();
        if (d?.isOpen && (d.options ?? []).length && !(d.options ?? []).some((o) => /click here to continue/i.test(o.text))) break;
        await q.sdk.waitForTicks(1);
    }
    return seen;
}

/** Talk to `npc` (nearest; walk near `at` first) and drive the dialog, until `done` (or one pass when absent). */
export async function talkTo(q: Quest, npc: RegExp, choices: Array<RegExp | string>, opts: { at?: Tile; done?: () => boolean; ticks?: number; tries?: number; label?: string } = {}): Promise<string> {
    let seen = '';
    const label = opts.label ?? String(npc);
    for (let attempt = 1; attempt <= (opts.tries ?? 3) && !opts.done?.(); attempt++) {
        if (q.sdk.getDialog()?.isOpen) await q.sdk.sendCloseModal().catch(() => undefined);
        if (opts.at && (cheb(pos(q), opts.at) > 8 || !q.sdk.findNearbyNpc(npc))) await walk(q, opts.at, 2);
        await untilTicks(q.sdk, () => !!q.sdk.findNearbyNpc(npc), 6);
        const target = q.sdk.findNearbyNpc(npc, { reachable: true }) ?? q.sdk.findNearbyNpc(npc);
        if (!target) {
            q.log(`mm: ${label}: not in view from ${where(q)}`);
            await q.sdk.waitForTicks(3);
            continue;
        }
        const res = await q.bot.talkTo(target);
        if (!res.success) {
            q.log(`mm: ${label}: ${res.message}`);
            // A raw op the server paths itself (an npc the client cannot route to).
            await q.sdk.sendInteractNpc(target.index, 1).catch(() => undefined);
        }
        await untilTicks(q.sdk, (s) => !!s.dialog?.isOpen || !!opts.done?.(), 12);
        seen += await drive(q, choices, opts.ticks ?? 120, opts.done);
        if (!opts.done) return seen;
    }
    if (opts.done && !opts.done()) throw new Error(`mm: ${label}: not done after talking (at ${where(q)})`);
    return seen;
}

export async function locNear(q: Quest, at: Tile, name: RegExp, opt?: RegExp, within = 3): Promise<NearbyLoc | undefined> {
    await q.sdk.scanNearbyLocs(15).catch(() => undefined);
    const loc = (q.sdk.getNearbyLocs() ?? [])
        .filter((l) => name.test(l.name) && (!opt || l.optionsWithIndex.some((o) => opt.test(o.text))))
        .sort((a, b) => Math.hypot(a.x - at.x, a.z - at.z) - Math.hypot(b.x - at.x, b.z - at.z))[0];
    return loc && Math.hypot(loc.x - at.x, loc.z - at.z) <= within ? loc : undefined;
}

/** Op a loc near `at` (by name, else the raw id) until `done`; its dialogs take `choices`. */
export async function opLoc(q: Quest, at: Tile & { id?: number }, name: RegExp, opt: RegExp, done: () => boolean, label: string, choices: Array<RegExp | string> = [], ticks = 20): Promise<void> {
    for (let attempt = 1; attempt <= 4 && !done(); attempt++) {
        if (q.sdk.getDialog()?.isOpen) await drive(q, choices, 30, done);
        if (done()) break;
        const loc = await locNear(q, at, name, opt);
        if (loc) await q.sdk.sendInteractLoc(loc.x, loc.z, loc.id, loc.optionsWithIndex.find((o) => opt.test(o.text))!.opIndex);
        else if (at.id) await q.sdk.sendInteractLoc(at.x, at.z, at.id, 1);
        else {
            q.log(`mm: ${label}: no ${name} near (${at.x},${at.z}) from ${where(q)}`);
            await q.sdk.waitForTicks(3);
            continue;
        }
        await untilTicks(q.sdk, (s) => done() || !!s.dialog?.isOpen, ticks);
        if (q.sdk.getDialog()?.isOpen) await drive(q, choices, 60, done);
        await untilTicks(q.sdk, done, 4);
    }
    if (!done()) throw new Error(`mm: ${label} failed at ${where(q)}`);
}

// ── Chapter 1

/** Narnode: "Start Monkey Madness?" Yes -> the seal. */
export async function startQuest(q: Quest): Promise<void> {
    await talkNarnode(q, [/^yes$/i]);
    await closeMain(q);
}

/** A gnome pilot's glider: "Can you take me on the glider?", then the glider map's `button`. */
async function glider(q: Quest, pilotAt: Tile, button: number, arrived: () => boolean, label: string): Promise<void> {
    for (let attempt = 1; attempt <= 3 && !arrived(); attempt++) {
        await talkTo(q, /^gnome pilot$/i, [/can you take me on the glider/i], { at: pilotAt, done: () => modal(q) === GLIDERMAP || arrived(), ticks: 40, label });
        if (modal(q) === GLIDERMAP) await q.sdk.sendClickComponent(button);
        await untilTicks(q.sdk, arrived, 15);
    }
    if (!arrived()) throw new Error(`mm: ${label}: the glider did not land (at ${where(q)})`);
    await closeMain(q);
    q.log(`mm: ${label}: landed at ${where(q)}`);
}

/** Glider to Gandius, the shipyard gate (seal), Caranock. */
export async function investigateShipyard(q: Quest): Promise<void> {
    if (!inShipyard(pos(q)) && !atGandius(pos(q))) {
        await upTree(q, 3);
        await glider(q, { x: 2464, z: 3501 }, GLIDER_GANDIUS, () => atGandius(pos(q)), 'glider to Gandius');
    }
    if (!inShipyard(pos(q))) {
        await walk(q, { x: SHIPYARD_GATE.x - 1, z: SHIPYARD_GATE.z }, 1);
        // mm_main 1: the worker sees the seal and teleports us through (shipyardworker.rs2 -> mm_shipyardworker_dialogue).
        await opLoc(q, SHIPYARD_GATE, /^gate$/i, /^open$/i, () => inShipyard(pos(q)), 'the shipyard gate', [/glough sent me/i, /^ka\.?$/i, /^lu\.?$/i, /^min\.?$/i], 30);
    }
    await talkTo(q, /^g\.l\.o\. caranock$|^caranock$/i, [], { at: CARANOCK, label: 'Caranock' });
}

/** Out of the shipyard and the Gandius glider back to the Grand Tree. */
export async function homeFromKaramja(q: Quest): Promise<void> {
    if (inShipyard(pos(q))) await leaveShipyard(q);
    if (atGandius(pos(q))) await glider(q, GANDIUS_PILOT, GLIDER_GRAND_TREE, () => inBox(pos(q), 2440, 2490, 3480, 3515), 'glider to the Grand Tree');
}

/** Narnode's handwritten orders (he writes for 3 ticks). */
export async function getOrders(q: Quest): Promise<void> {
    await homeFromKaramja(q);
    await talkNarnode(q, []);
    await untilTicks(q.sdk, () => held(q, OBJ.orders), 8);
    await drive(q, [], 20);
}

/** Daero at the bar: the three topics, then Leave... -> blindfolded to the hangar. */
export async function daeroToHangar(q: Quest): Promise<void> {
    if (inHangar1(pos(q)) || inHangar2(pos(q))) return;
    await upTree(q, 1);
    const topics = [/^talk about the journey/i, /^talk about the 10th squad/i, /^talk about caranock/i];
    const used = new Set<number>();
    const inHangar = () => inHangar1(pos(q)) || inHangar2(pos(q));
    for (let attempt = 1; attempt <= 3 && !inHangar(); attempt++) {
        await talkTo(q, /^daero$/i, [], { at: DAERO_BAR, done: () => !!q.sdk.getDialog()?.options?.length || inHangar(), ticks: 20, label: 'Daero (bar)' }).catch((e) => q.log(String(e)));
        const t0 = tickNow(q.sdk);
        while (!inHangar() && tickNow(q.sdk) - t0 < 300) {
            const d = q.sdk.getDialog();
            if (!d?.isOpen) {
                if (!(await untilTicks(q.sdk, (s) => !!s.dialog?.isOpen || inHangar(), 10))) break;
                continue;
            }
            const opts = d.options ?? [];
            const has = (re: RegExp) => opts.find((o) => re.test(o.text));
            const cont = has(/click here to continue/i);
            let pick = cont ?? has(/^leave\.\.\.$/i) ?? has(/^who is it\?$/i) ?? has(/^yes$/i) ?? has(/return to previous menu/i);
            if (!pick) {
                const i = topics.findIndex((re, n) => !used.has(n) && has(re));
                if (i >= 0) {
                    used.add(i);
                    pick = has(topics[i]!);
                }
            }
            // All three seen but no Leave yet (the bits are set inside the submenus): go round again.
            if (!pick && topics.every((_, n) => used.has(n))) {
                used.clear();
                continue;
            }
            if (!pick) {
                await q.sdk.waitForTicks(1);
                continue;
            }
            const before = JSON.stringify(opts);
            await q.sdk.sendClickDialog(pick.index);
            await untilTicks(q.sdk, () => JSON.stringify(q.sdk.getDialog()?.options ?? []) !== before || inHangar(), 8);
        }
    }
    if (!(await untilTicks(q.sdk, inHangar, 15))) throw new Error(`mm: Daero did not take us to the hangar (at ${where(q)})`);
    await drive(q, [], 20);
    q.log(`mm: in the hangar at ${where(q)}`);
}

/** Daero in the hangar with Waydar near: the introductions (-> started_reinit), or after it daero_complete. */
export async function daeroInHangar(q: Quest): Promise<void> {
    await talkTo(q, /^daero$/i, [/how do i leave/i], { label: 'Daero (hangar)', ticks: 150 });
}

/** Read the puzzle board: board[slot] = tile 1..24, 0 = the hole. */
function readBoard(q: Quest): number[] | null {
    const inv = q.sdk.getState()?.interface?.inventories?.find((i) => i.componentId === PUZZLE_BOARD);
    if (!inv || inv.size !== 25) return null;
    const board = new Array<number>(25).fill(0);
    for (const it of inv.items) board[it.slot] = ((it.id - PUZZLE_FIRST) >> 1) + 1;
    return board;
}

/** The hangar's reinitialisation panel: open it, solve the 5x5 sliding board, wait out the cutscene. */
export async function reinitialise(q: Quest): Promise<void> {
    const { solvePuzzle } = await import('./mm-puzzle');
    if (inHangar2(pos(q))) return;
    for (let attempt = 1; attempt <= 3 && !inHangar2(pos(q)); attempt++) {
        if (cheb(pos(q), PANEL) > 3) await walk(q, { x: PANEL.x, z: PANEL.z + 1 }, 1);
        if (modal(q) !== PUZZLE_IF) {
            await opLoc(q, PANEL, /^reinitialisation panel$/i, /^operate$/i, () => modal(q) === PUZZLE_IF && !!readBoard(q), 'the reinitialisation panel', [], 15).catch((e) => q.log(String(e)));
        }
        let board = readBoard(q);
        if (modal(q) !== PUZZLE_IF || !board) continue;
        let plan = solvePuzzle(board);
        if (!plan) throw new Error(`mm: no solution for the board ${board.join(',')}`);
        q.log(`mm: puzzle ${board.join(',')} -> ${plan.length} moves`);
        const t0 = tickNow(q.sdk);
        while (plan.length && modal(q) === PUZZLE_IF && tickNow(q.sdk) - t0 < 2000) {
            const slot = plan[0]!;
            const hole = board.indexOf(0);
            await q.sdk.sendUseItem(slot, 5, PUZZLE_BOARD);
            // The move lands when the board shows the tile in the old hole.
            const moved = await untilTicks(q.sdk, () => {
                const b = readBoard(q);
                return !b || modal(q) !== PUZZLE_IF || (b[slot] === 0 && b[hole] !== 0);
            }, 6);
            const now = readBoard(q);
            if (!now || modal(q) !== PUZZLE_IF) break;
            if (moved) {
                board = now;
                plan = plan.slice(1);
            } else if (now.join() !== board.join()) {
                // Out of step with the server: plan again from what it shows.
                board = now;
                plan = solvePuzzle(board) ?? [];
            }
        }
        if (modal(q) === PUZZLE_IF) {
            q.log(`mm: puzzle not solved yet (board ${readBoard(q)?.join(',')})`);
            continue;
        }
        // settimer(hangar_cutscene, 3): fade, the gliders unfold, then the second hangar.
        if (await untilTicks(q.sdk, () => inHangar2(pos(q)), 60)) break;
    }
    if (!inHangar2(pos(q))) throw new Error(`mm: reinitialisation did not finish (at ${where(q)})`);
    await drive(q, [], 10);
    q.log(`mm: reinitialised; second hangar at ${where(q)}`);
}

/** Daero (-> daero_complete), Waydar "Yes" -> Crash Island, and Waydar there (-> arrived_island). */
export async function flyToCrashIsland(q: Quest): Promise<void> {
    if (!onCrashIsland(pos(q))) {
        // Resumed on the mainland: Daero's blindfold back to the (reinitialised) hangar.
        if (!inHangar2(pos(q))) await daeroToHangar(q);
        if (!inHangar2(pos(q))) throw new Error(`mm: not in the reinitialised hangar (at ${where(q)})`);
        await talkTo(q, /^daero$/i, [], { at: { x: 2648, z: 4512 }, label: 'Daero (reinitialised)' });
        await talkTo(q, /^waydar$/i, [/^yes$/i], { done: () => onCrashIsland(pos(q)), label: 'Waydar (fly)', ticks: 60 });
        await closeMain(q);
    }
    await talkTo(q, /^waydar$/i, [/what shall we do now/i], { label: 'Waydar (Crash Island)' });
}

/** Lumdo (seal, refuses), Waydar "I cannot convince Lumdo..." -> the chapter 2 cutscene -> Ape Atoll. */
export async function toApeAtoll(q: Quest): Promise<void> {
    const atoll = () => onApeAtoll(pos(q)) && cheb(pos(q), ATOLL_LANDING) <= 12;
    if (!atoll() && !onCrashIsland(pos(q))) {
        // Resumed on the mainland: the hangar and Waydar's glider back to Crash Island.
        if (!inHangar2(pos(q))) await daeroToHangar(q);
        await talkTo(q, /^waydar$/i, [/^yes$/i], { done: () => onCrashIsland(pos(q)), label: 'Waydar (fly)', ticks: 60 });
        await closeMain(q);
    }
    for (let attempt = 1; attempt <= 3 && !atoll(); attempt++) {
        if (onCrashIsland(pos(q))) {
            await talkTo(q, /^lumdo$/i, [], { label: 'Lumdo' });
            const convince = /i cannot convince lumdo/i;
            await talkTo(q, /^waydar$/i, [convince], { label: 'Waydar (convince)', done: () => !onCrashIsland(pos(q)) || atoll(), ticks: 300 }).catch((e) => q.log(String(e)));
        }
        // The cutscene runs off the island (2596,4581) with pages and a walk trigger, then lands on the atoll.
        const t0 = tickNow(q.sdk);
        while (!atoll() && !onCrashIsland(pos(q)) && tickNow(q.sdk) - t0 < 400) {
            if (q.sdk.getDialog()?.isOpen) await drive(q, [/.*/], 60, atoll, 6);
            else if (!(await untilTicks(q.sdk, (s) => !!s.dialog?.isOpen || atoll(), 10))) {
                // Paused cutscene: a walk click fires its walk trigger (mm_ch2_walktrigger).
                const p = pos(q);
                await q.sdk.sendWalk(p.x, p.z + 1, false).catch(() => undefined);
            }
        }
    }
    if (!atoll()) throw new Error(`mm: not on Ape Atoll after the chapter 2 cutscene (at ${where(q)})`);
    await closeMain(q);
    await drive(q, [], 10);
    q.log(`mm: on Ape Atoll at ${where(q)}`);
}

/** Out of the hangars by their Teleportation Device (-> the Gnomeball pitch). */
export async function leaveHangar(q: Quest): Promise<void> {
    if (!inHangar1(pos(q)) && !inHangar2(pos(q))) return;
    for (let attempt = 1; attempt <= 3 && (inHangar1(pos(q)) || inHangar2(pos(q))); attempt++) {
        await q.sdk.scanNearbyLocs(30).catch(() => undefined);
        const dev = (q.sdk.getNearbyLocs() ?? []).filter((l) => /^teleportation device$/i.test(l.name)).sort((a, b) => (a.distance ?? 99) - (b.distance ?? 99))[0];
        if (!dev) throw new Error(`mm: no Teleportation Device in view (at ${where(q)})`);
        await q.bot.interactLoc(dev, /operate/i).catch(() => undefined);
        await untilTicks(q.sdk, () => !inHangar1(pos(q)) && !inHangar2(pos(q)), 15);
    }
    q.log(`mm: out of the hangar at ${where(q)}`);
}


/** Places run-quest's goTo cannot walk out of: the hangars, Crash Island, Ape Atoll and its caves. */
export const inMonkeyMadnessArea = (p: Tile) => inHangar1(p) || inHangar2(p) || onCrashIsland(p) || onApeAtoll(p) || inZooMonkeyCage(p);
/** Ardougne zoo's monkey cage (mm_monkey_minder.rs2 zones, m40_51). */
const inZooMonkeyCage = (t: Tile) => (t.level ?? 0) === 0 && (inBox(t, 2598, 2600, 3274, 3278) || inBox(t, 2600, 2604, 3276, 3282) || inBox(t, 2605, 2606, 3276, 3281));

/** Out toward the mainland from wherever the quest left us. */
export async function leaveMonkeyMadness(q: Quest): Promise<void> {
    if (inHangar1(pos(q)) || inHangar2(pos(q))) return leaveHangar(q);
    const { leaveAtoll, leaveZooCage } = await import('./ape-atoll');
    if (inZooMonkeyCage(pos(q))) return leaveZooCage(q);
    await leaveAtoll(q);
}
