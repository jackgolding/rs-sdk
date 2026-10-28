/**
 * Cooking primitives shared by item sources: water, dough, and a range that is
 * not quest-gated. Tiles and gotchas from the pre-runner knights-sword.ts
 * (read off the live world 2026-10-27):
 *
 *   - Empty jug spawns in the Lumbridge castle kitchen at (3212,3212); only
 *     Sink 873 at (3205,3215) fills it. The Varrock palace Sink 874 looks
 *     identical and is NOT a water source.
 *   - Range 114 (Lumbridge castle) is the Cook's Assistant range: until that
 *     quest is complete, using food on it silently does nothing. The palace
 *     kitchen range 2728 at (3221,3497) is a plain range.
 *   - Flour + water opens "Bread / Pastry / Pizza / Pitta"; the option reads
 *     "Pastry dough." so match it unanchored.
 *   - A level gate on a range is a ~mesbox: no game message, the text is only in
 *     the dialog's components.
 */
import type { Quest } from './run-quest';
import { untilTicks } from './ticks';

export const LUMBRIDGE_KITCHEN_JUG = { x: 3211, z: 3213 };
const LUMBRIDGE_SINK = { x: 3205, z: 3215, id: 873 };
export const PALACE_KITCHEN = { x: 3222, z: 3492 };
const PALACE_RANGE_ID = 2728;
const WATER = /^jug of water$/i;

/** One jug of water: pick up the kitchen's empty jug if needed, fill it at Sink 873. */
export async function fetchJugOfWater(q: Quest): Promise<void> {
    if (q.count(WATER) > 0) return;
    if (q.count(/^jug$/i) < 1) {
        await q.goTo(LUMBRIDGE_KITCHEN_JUG, 3);
        // The jug respawns; wait for it rather than giving up on the first empty scan.
        for (let i = 0; i < 20 && q.count(/^jug$/i) < 1; i++) {
            await q.sdk.scanGroundItems(10).catch(() => undefined);
            const jug = q.sdk.findGroundItem(/^jug$/i);
            if (jug) {
                await q.bot.pickupItem(jug).catch(() => undefined);
                await untilTicks(q.sdk, (s) => s.inventory.some((i) => /^jug$/i.test(i.name)), 6);
            } else await q.sdk.waitForTicks(5);
        }
        if (q.count(/^jug$/i) < 1) throw new Error('no empty jug at the Lumbridge kitchen spawn');
    }
    await q.goTo(LUMBRIDGE_SINK, 1);
    const jug = q.sdk.findInventoryItem(/^jug$/i)!;
    await q.sdk.sendUseItemOnLoc(jug.slot, LUMBRIDGE_SINK.x, LUMBRIDGE_SINK.z, LUMBRIDGE_SINK.id).catch(() => undefined);
    await untilTicks(q.sdk, (s) => s.inventory.some((i) => WATER.test(i.name)), 10);
    if (q.count(WATER) < 1) throw new Error('Sink 873 did not fill the jug');
}

/** Flour + water → the dough named by `option` (e.g. /pastry dough/i). */
export async function makeDough(q: Quest, want: RegExp, option: RegExp): Promise<void> {
    if (q.count(want) > 0) return;
    const flour = q.sdk.findInventoryItem(/^pot of flour$/i);
    const water = q.sdk.findInventoryItem(WATER);
    if (!flour || !water) throw new Error('dough needs a pot of flour and a jug of water');
    await q.sdk.sendUseItemOnItem(flour.slot, water.slot).catch(() => undefined);
    await untilTicks(q.sdk, (s) => !!s.dialog?.isOpen, 6);
    for (let i = 0; i < 6 && q.count(want) < 1; i++) {
        const dialog = q.sdk.getDialog();
        if (!dialog?.isOpen) {
            await q.sdk.waitForTicks(2);
            continue;
        }
        const pick = (dialog.options ?? []).find((o) => option.test(o.text));
        await q.sdk.sendClickDialog(pick ? pick.index : 0);
        await untilTicks(q.sdk, (s) => s.inventory.some((it) => want.test(it.name)), 6);
    }
    if (q.count(want) < 1) throw new Error(`could not make ${want.source}`);
}

/** Use one inventory item on another and wait for the inventory to change. */
export async function combine(q: Quest, from: RegExp, onto: RegExp, makes: RegExp): Promise<void> {
    const a = q.sdk.findInventoryItem(from);
    const b = q.sdk.findInventoryItem(onto);
    if (!a || !b) throw new Error(`combine: need ${from.source} and ${onto.source}`);
    await q.sdk.sendUseItemOnItem(a.slot, b.slot).catch(() => undefined);
    await untilTicks(q.sdk, (s) => s.inventory.some((i) => makes.test(i.name)), 8);
    await q.bot.dismissBlockingUI();
}

/** Text of a blocking ~mesbox (level gates), which never reaches gameMessages. */
function mesbox(q: Quest): string {
    const dialog = q.sdk.getDialog() as { isOpen?: boolean; allComponents?: Array<{ text?: string }> } | null;
    if (!dialog?.isOpen) return '';
    return (dialog.allComponents ?? [])
        .map((c) => String(c?.text ?? ''))
        .filter((t) => t && !/click here to continue/i.test(t))
        .join(' ');
}

/**
 * Cook one `item` on the palace kitchen range. Returns 'cooked' when `cooked`
 * appeared, 'burnt' when the item turned into something else, and throws on a
 * level gate (the mesbox names the level).
 */
export async function cookAtPalaceRange(q: Quest, item: RegExp, cooked: RegExp): Promise<'cooked' | 'burnt'> {
    await q.goTo(PALACE_KITCHEN, 3);
    await q.sdk.scanNearbyLocs(12).catch(() => undefined);
    const range = (q.sdk.getNearbyLocs() ?? []).find((l) => l.id === PALACE_RANGE_ID);
    if (!range) throw new Error(`no range ${PALACE_RANGE_ID} in the palace kitchen`);
    await q.goTo({ x: range.x, z: range.z }, 1);
    const raw = q.sdk.findInventoryItem(item);
    if (!raw) throw new Error(`nothing matching ${item.source} to cook`);
    const before = q.count(item);
    const hadCooked = q.count(cooked);
    await q.sdk.sendUseItemOnLoc(raw.slot, range.x, range.z, range.id).catch(() => undefined);
    await untilTicks(q.sdk, (s) => !!mesbox(q) || s.inventory.filter((i) => item.test(i.name)).length < before, 12);
    const box = mesbox(q);
    if (box) {
        await q.bot.dismissBlockingUI();
        if (/level of \d+/i.test(box)) throw new Error(`range refused: ${box.slice(0, 120)}`);
    }
    await q.bot.dismissBlockingUI();
    return q.count(cooked) > hadCooked ? 'cooked' : 'burnt';
}
