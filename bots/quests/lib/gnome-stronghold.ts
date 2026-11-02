/**
 * Tree Gnome Stronghold geometry for runner tasks (probed on the fast engine, 2026-10-31).
 *
 *   gate     gnome_gate.rs2 [oploc1,gnome_areagate]: the loc at (2459,3383) is 5 wide; Open
 *            walks the player to (2461,3385) north or (2461,3382) south, then forcemoves 3
 *            tiles through. The client pathfinder has no route through it, so bot.walkTo
 *            between Ardougne and the stronghold fails both ways. bot.interactLoc on the gate
 *            answered "I can't reach that!"; the raw sendInteractLoc crosses.
 *            With %femi_help = 0, Femi within 6 tiles turns an inward Open into her boxes
 *            dialog: "Sorry, I'm a bit busy." declines and the gate script carries on.
 *            Mid Grand Tree quest the guard refuses: leaving once released from the prison,
 *            entering once the lumber order is held. Both are a dialog and no crossing.
 *   tree     the Grand Tree's L1 holds a bank (booths 2448-2450,3481), and bridges join it to
 *            the Blurberry Bar (barman 2482,3487 L1) and a range (2482,3479 L1). One way up:
 *            the Tree Door (2464,3492)/(2466,3492), which walkTo does not open, then the
 *            ladder at (2466,3495).
 */
import type { Quest } from './run-quest';
import { tickNow, untilTicks } from './ticks';

interface Tile {
    x: number;
    z: number;
}

export const GNOME_GATE = { x: 2459, z: 3383 };
/** Walkable tiles a step clear of the gate on either side. */
const GATE_SOUTH = { x: 2461, z: 3380 };
const GATE_NORTH = { x: 2461, z: 3387 };
/** Outside the Tree Door, and the ladder's foot inside it. */
const TREE_OUTSIDE = { x: 2465, z: 3489 };
const TREE_LADDER_FOOT = { x: 2466, z: 3494 };
const TREE_LADDER = { x: 2466, z: 3495 };

/** Grand Tree bank, L1: the booths are at z 3481, stand south of them. */
export const GRAND_TREE_BANK = { x: 2449, z: 3483, level: 1 };
/** Blurberry Bar, L1 (gnome.npc blurberrybarmen: Trade opens blurberrybar, wanders 3). */
export const BLURBERRY_BAR = { x: 2481, z: 3488, level: 1 };
/** The range by the bar, L1 (loc 2728 at 2482,3479). */
export const BAR_RANGE = { x: 2482, z: 3480, level: 1 };
export const BAR_RANGE_LOC = { x: 2482, z: 3479, id: 2728 };
/**
 * Lure/Bait spots on the stronghold's south-west river (npc 0_37_53_freshfish, seven spawns
 * 2382-2391,3407-3423). walkTo stops at (2391,3422), a step from the eastern spots.
 */
export const STRONGHOLD_FISHING = { x: 2391, z: 3421 };

/** Inside the stronghold's walls (north of the gate), on any plane. */
export function inStronghold(t: Tile): boolean {
    return t.x >= 2370 && t.x <= 2505 && t.z > GNOME_GATE.z && t.z <= 3520;
}

const here = (q: Quest) => {
    const p = q.sdk.getState()?.player;
    return { x: p?.worldX ?? 0, z: p?.worldZ ?? 0, level: p?.level ?? 0 };
};

/** Text of an open dialog, for the log when the guard turns us back. */
function dialogText(q: Quest): string {
    const d = q.sdk.getDialog() as { isOpen?: boolean; allComponents?: Array<{ text?: string }> } | null;
    if (!d?.isOpen) return '';
    return (d.allComponents ?? []).map((c) => String(c?.text ?? '')).filter((t) => t && !/click here to continue/i.test(t)).join(' ');
}

/**
 * Through the gate, in (`inward`) or out. Already on the far side returns at once.
 * Throws with the guard's words when the gate will not let us through.
 */
export async function crossGnomeGate(q: Quest, inward: boolean): Promise<void> {
    const crossed = () => inStronghold(here(q)) === inward;
    if (crossed()) return;
    // From the tree's L1 or its shut trunk: climbTo and walkTo have no way out of either.
    if (!inward) await leaveGrandTree(q);
    if (here(q).level !== 0) await q.climbTo(0);
    const side = inward ? GATE_SOUTH : GATE_NORTH;
    let refused = '';
    // 8 tries: other players hold the gate open (no Open option for 5 ticks) and declining Femi's
    // boxes ends that attempt — the gate only lets you through on the next (gnome_gate.rs2).
    for (let attempt = 1; attempt <= 8 && !crossed(); attempt++) {
        await q.goTo(side, 2);
        await q.sdk.scanNearbyLocs(8).catch(() => undefined);
        const gate = (q.sdk.getNearbyLocs() ?? []).find(
            (l) => /^gate$/i.test(l.name) && Math.abs(l.x - GNOME_GATE.x) <= 2 && Math.abs(l.z - GNOME_GATE.z) <= 2 && l.optionsWithIndex.some((o) => /^open$/i.test(o.text)),
        );
        if (!gate) {
            // Someone else is mid-crossing: the gate is swapped for its open model for 5 ticks.
            q.log(`gnome gate: no closed gate in view at ${here(q).x},${here(q).z} (try ${attempt})`);
            await q.sdk.waitForTicks(6);
            continue;
        }
        const op = gate.optionsWithIndex.find((o) => /^open$/i.test(o.text))!;
        await q.sdk.sendInteractLoc(gate.x, gate.z, gate.id, op.opIndex);
        for (let t = 0; t < 30 && !crossed(); t++) {
            const d = q.sdk.getDialog();
            if (d?.isOpen) {
                const text = dialogText(q);
                if (/halt|not to let you in|can not leave|you'll have to leave/i.test(text)) refused = text;
                const busy = d.options.find((o) => /busy/i.test(o.text));
                if (busy) q.log('gnome gate: Femi asked for help with her boxes; declining');
                await q.sdk.sendClickDialog(busy ? busy.index : (d.options[0]?.index ?? 0));
            }
            await q.sdk.waitForTicks(1);
        }
        if (refused && !crossed()) break;
    }
    if (!crossed()) {
        throw new Error(`could not pass the Gnome Stronghold gate ${inward ? 'inward' : 'outward'} (at ${here(q).x},${here(q).z})${refused ? `: the guard says "${refused.slice(0, 160)}" — the Grand Tree quest state blocks it` : ''}`);
    }
    q.log(`gnome gate: ${inward ? 'into' : 'out of'} the stronghold at ${here(q).x},${here(q).z}`);
}

/** Open the Tree Door if it is shut and walk to `to` (plane 0) through it. */
async function throughTreeDoor(q: Quest, to: Tile): Promise<void> {
    for (let attempt = 0; attempt < 3; attempt++) {
        const res = await q.bot.walkTo(to.x, to.z, 1);
        if (res.success && Math.hypot(here(q).x - to.x, here(q).z - to.z) <= 2) return;
        await q.sdk.scanNearbyLocs(8).catch(() => undefined);
        const door = (q.sdk.getNearbyLocs() ?? [])
            .filter((l) => /^tree door$/i.test(l.name) && l.options?.some((o) => /^open$/i.test(o)))
            .sort((a, b) => (a.distance ?? 99) - (b.distance ?? 99))[0];
        if (door) await q.bot.openDoor(door).catch(() => undefined);
        else await q.sdk.waitForTicks(2);
    }
    throw new Error(`could not get through the Grand Tree's door to (${to.x},${to.z}); at ${here(q).x},${here(q).z},L${here(q).level}`);
}

/** Up into the Grand Tree's L1 (bank, bar, range) from anywhere inside the stronghold. */
export async function climbGrandTree(q: Quest): Promise<void> {
    if (here(q).level === 1 && Math.hypot(here(q).x - TREE_LADDER.x, here(q).z - TREE_LADDER.z) < 60) return;
    if (here(q).level !== 0) await q.climbTo(0);
    await q.goTo(TREE_OUTSIDE, 3);
    await throughTreeDoor(q, TREE_LADDER_FOOT);
    for (let attempt = 0; attempt < 3 && here(q).level === 0; attempt++) {
        await q.sdk.scanNearbyLocs(6).catch(() => undefined);
        const ladder = q.sdk.findNearbyLoc(/^ladder$/i, { withOption: /^climb-up$/i });
        if (!ladder) throw new Error(`no ladder up inside the Grand Tree (at ${here(q).x},${here(q).z})`);
        await q.bot.interactLoc(ladder, /^climb-up$/i).catch(() => undefined);
        await untilTicks(q.sdk, (s) => (s.player?.level ?? 0) === 1, 15);
    }
    if (here(q).level !== 1) throw new Error(`could not climb the Grand Tree's ladder (at ${here(q).x},${here(q).z},L${here(q).level})`);
}

/**
 * The agility course's raised platforms (gnome-course.ts STEPS): L1 above the net
 * (2471-2476,3422-3424) and L2 either side of the balancing rope (2472-2488,3418-3421).
 * A grind stopped mid-lap leaves the account up there, where the Grand Tree's ladder
 * is nowhere in view (jacklove15 at 2483,3420,L2 failed Dragon Slayer twice).
 */
function onCoursePlatform(p: { x: number; z: number; level: number }): boolean {
    return p.level > 0 && p.x >= 2470 && p.x <= 2490 && p.z >= 3415 && p.z <= 3426;
}

/** Finish the lap's obstacles down to the ground: branch up, rope east, branch down. */
async function leaveCoursePlatform(q: Quest): Promise<void> {
    for (let attempt = 0; attempt < 8 && here(q).level !== 0; attempt++) {
        await q.sdk.scanNearbyLocs(8).catch(() => undefined);
        const down = q.sdk.findNearbyLoc(/^tree branch$/i, { withOption: /^climb-down$/i, reachable: true });
        const rope = q.sdk.findNearbyLoc(/^balancing rope$/i, { withOption: /walk-on/i, reachable: true });
        const up = q.sdk.findNearbyLoc(/^tree branch$/i, { withOption: /^climb$/i, reachable: true });
        const level = here(q).level;
        if (down) {
            await q.bot.interactLoc(down, /^climb-down$/i).catch(() => undefined);
            await untilTicks(q.sdk, (s) => (s.player?.level ?? 1) === 0, 15);
        } else if (level === 2 && rope) {
            await q.bot.interactLoc(rope, /walk-on/i).catch(() => undefined);
            await untilTicks(q.sdk, (s) => (s.player?.worldX ?? 0) >= 2483, 20);
        } else if (level === 1 && up) {
            await q.bot.interactLoc(up, /^climb$/i).catch(() => undefined);
            await untilTicks(q.sdk, (s) => (s.player?.level ?? 1) === 2, 15);
        } else {
            await q.sdk.waitForTicks(2);
        }
    }
    if (here(q).level !== 0) throw new Error(`could not get down off the agility course (at ${here(q).x},${here(q).z},L${here(q).level})`);
    q.log(`gnome course: down off the platforms at ${here(q).x},${here(q).z}`);
}

/** Down from the Grand Tree's L1 and out of its door, onto the stronghold's ground. */
export async function leaveGrandTree(q: Quest): Promise<void> {
    if (onCoursePlatform(here(q))) return leaveCoursePlatform(q);
    if (here(q).level === 0) {
        // Inside the trunk with the door shut, walkTo has no way out.
        if (Math.abs(here(q).x - TREE_LADDER.x) <= 3 && here(q).z >= 3492 && here(q).z <= 3498) await throughTreeDoor(q, TREE_OUTSIDE);
        return;
    }
    if (here(q).level === 1) await q.goTo({ ...TREE_LADDER_FOOT, level: 1 }, 1);
    for (let attempt = 0; attempt < 3 && here(q).level !== 0; attempt++) {
        await q.sdk.scanNearbyLocs(6).catch(() => undefined);
        const ladder = q.sdk.findNearbyLoc(/ladder/i, { withOption: /^climb-down$/i });
        if (!ladder) throw new Error(`no ladder down in the Grand Tree (at ${here(q).x},${here(q).z},L${here(q).level})`);
        await q.bot.interactLoc(ladder, /^climb-down$/i).catch(() => undefined);
        await untilTicks(q.sdk, (s) => (s.player?.level ?? 1) === 0, 15);
    }
    if (here(q).level !== 0) throw new Error(`could not climb down the Grand Tree (at ${here(q).x},${here(q).z},L${here(q).level})`);
    await throughTreeDoor(q, TREE_OUTSIDE);
}

/** Hudo's Grand Tree Groceries, L1 (gnome.npc gnome_hudo, spawn 2448,3509 L1; gnome.inv gnomeshop_hudo). */
export const GRAND_TREE_GROCERIES = { x: 2448, z: 3508, level: 1 };
const GROCERIES_RESTOCK_TICKS = 600;

/**
 * Buy `item` from Hudo until holding `count` (dwellberries, chocolate dust, bucket of milk...),
 * waiting out a restock (bounded), then back down and out of the tree.
 */
export async function buyGroceries(q: Quest, item: RegExp, label: string, count: number): Promise<void> {
    const held = () => q.sdk.getInventory().filter((i) => item.test(i.name)).reduce((n, i) => n + (i.count ?? 1), 0);
    if (held() >= count) return;
    await crossGnomeGate(q, true);
    await climbGrandTree(q);
    await q.goTo(GRAND_TREE_GROCERIES, 3);
    const t0 = tickNow(q.sdk);
    let opened = await q.bot.openShop(/^hudo$/i);
    if (!opened.success && !q.sdk.getState()?.shop?.isOpen) {
        await q.sdk.waitForTicks(3);
        opened = await q.bot.openShop(/^hudo$/i);
    }
    if (!q.sdk.getState()?.shop?.isOpen) throw new Error(`Hudo's shop did not open: ${opened.message}`);
    const stock = () => q.sdk.getState()?.shop?.shopItems?.find((s) => item.test(s.name));
    if (!stock()) throw new Error(`Hudo does not sell ${label}`);
    let lastBuy = tickNow(q.sdk);
    while (held() < count && q.sdk.getState()?.shop?.isOpen) {
        const s = stock();
        if (s && s.count > 0) {
            const had = held();
            const r = await q.bot.buyFromShop(item, Math.min(s.count, count - had));
            if (held() === had) {
                q.log(`groceries: buy ${label}: ${r.message}`);
                await q.sdk.waitForTicks(2);
            }
            lastBuy = tickNow(q.sdk);
            continue;
        }
        if (tickNow(q.sdk) - lastBuy > GROCERIES_RESTOCK_TICKS) break;
        q.log(`groceries: ${label} out of stock — waiting for a restock`);
        await untilTicks(q.sdk, () => (stock()?.count ?? 0) > 0 || !q.sdk.getState()?.shop?.isOpen, GROCERIES_RESTOCK_TICKS);
    }
    await q.bot.closeShop().catch(() => undefined);
    q.log(`groceries: ${held()}/${count} ${label} from Hudo (${tickNow(q.sdk) - t0}t)`);
    await leaveGrandTree(q);
}
