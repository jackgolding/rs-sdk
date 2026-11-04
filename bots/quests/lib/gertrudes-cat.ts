/**
 * Gertrude's Cat — Fluffs in the abandoned lumber mill north-east of Varrock.
 *
 * Content facts (quest_fluffs/scripts/quest_fluffs.rs2, area_varrock/scripts/{gertrude,shilop,wilough}.rs2;
 * placements m49_53, m50_53, m51_54):
 *   - Gertrude (3151,3410), west of Varrock. Shilop and Wilough (3221,3434) in the square: "What will
 *     make you tell me?", "Okay then, I'll pay." — 100 coins (1 -> 2).
 *   - The mill's fence (3305,3493) "Climb-over" from the south; its ladder (3310,3509) up to Fluffs
 *     (3306,3512,L1). A bucket of milk on her (2 -> 3), then a seasoned sardine (raw sardine + doogle
 *     leaves; 3 -> 4), which also picks one of six crates for her kitten.
 *   - The crates are npcs ("Crate", op1 Search) at six spots on the mill's ground floor; the right one
 *     gives the kitten. The kitten on Fluffs (4 -> 5), then Gertrude (complete).
 *   - Doogle leaves spawn beside Gertrude's house (3151-3157,3399-3401); Gerrant's in Port Sarim sells
 *     raw sardines; the cows south-west of Varrock (3154-3197,3318-3342) give milk for a bucket.
 */
import type { Quest } from './run-quest';
import { driveDialog } from './dialog';
import { buyWaitingForRestock } from './sources';
import { untilTicks } from './ticks';

interface Tile {
    x: number;
    z: number;
    level?: number;
}

export const OBJ = { sardine: 327, seasoned: 1552, kitten: 1554, doogle: 1573, bucket: 1925, milk: 1927 } as const;

export const GERTRUDE = { x: 3151, z: 3410 };
export const BOYS = { x: 3221, z: 3434 };
const FENCE = { x: 3305, z: 3493 };
const MILL_LADDER = { x: 3310, z: 3509 };
const FLUFFS = { x: 3306, z: 3512, level: 1 };
const CRATES: Tile[] = [
    { x: 3298, z: 3514 },
    { x: 3303, z: 3506 },
    { x: 3305, z: 3500 },
    { x: 3307, z: 3507 },
    { x: 3310, z: 3499 },
    { x: 3311, z: 3511 },
];
const DOOGLE: Tile[] = [
    { x: 3151, z: 3399 },
    { x: 3152, z: 3399 },
    { x: 3152, z: 3401 },
    { x: 3156, z: 3401 },
    { x: 3157, z: 3400 },
];
const COWS = { x: 3175, z: 3328 };
const GERRANT = { x: 3013, z: 3225, npc: /^gerrant$/i };

const pos = (q: Quest) => {
    const p = q.sdk.getState()?.player;
    return { x: p?.worldX ?? 0, z: p?.worldZ ?? 0, level: p?.level ?? 0 };
};
const where = (q: Quest) => `(${pos(q).x},${pos(q).z},L${pos(q).level})`;
const inBox = (p: Tile, x0: number, x1: number, z0: number, z1: number) => p.x >= x0 && p.x <= x1 && p.z >= z0 && p.z <= z1;
export const held = (q: Quest, id: number) => q.sdk.getInventory().some((i) => i.id === id);

/** Inside the lumber mill's fence (the climb lands on 3493), both floors. */
export const inMillYard = (p: Tile) => inBox(p, 3290, 3330, 3493, 3525);

function cursor(q: Quest): number {
    return Math.max(0, ...(q.sdk.getState()?.gameMessages ?? []).map((m) => m.observationId ?? m.tick));
}
function said(q: Quest, since: number, text: RegExp): boolean {
    return (q.sdk.getState()?.gameMessages ?? []).some((m) => (m.observationId ?? m.tick) > since && text.test(m.text));
}

async function locNear(q: Quest, at: Tile, name: RegExp, opt?: RegExp, within = 2) {
    await q.sdk.scanNearbyLocs(15).catch(() => undefined);
    const loc = (q.sdk.getNearbyLocs() ?? [])
        .filter((l) => name.test(l.name) && (!opt || l.optionsWithIndex.some((o) => opt.test(o.text))))
        .sort((a, b) => Math.hypot(a.x - at.x, a.z - at.z) - Math.hypot(b.x - at.x, b.z - at.z))[0];
    return loc && Math.hypot(loc.x - at.x, loc.z - at.z) <= within ? loc : undefined;
}

async function op(q: Quest, at: Tile, name: RegExp, opt: RegExp, done: () => boolean, label: string, ticks = 15): Promise<void> {
    for (let attempt = 1; attempt <= 4 && !done(); attempt++) {
        const loc = await locNear(q, at, name, opt);
        if (!loc) {
            q.log(`fluffs: ${label}: no ${name} with ${opt} near (${at.x},${at.z}) from ${where(q)}`);
            await q.sdk.waitForTicks(3);
            continue;
        }
        await q.sdk.sendInteractLoc(loc.x, loc.z, loc.id, loc.optionsWithIndex.find((o) => opt.test(o.text))!.opIndex);
        await untilTicks(q.sdk, (s) => done() || !!s.dialog?.isOpen, ticks);
        if (q.sdk.getDialog()?.isOpen) await driveDialog(q.sdk, [], { done, ticks: 30, log: q.log });
        await untilTicks(q.sdk, done, 4);
    }
    if (!done()) throw new Error(`fluffs: ${label} failed at ${where(q)}`);
}

// ── supplies

/** A bucket of milk from the cows south-west of Varrock (a bucket from the bank or a store). */
export async function getMilk(q: Quest): Promise<void> {
    if (held(q, OBJ.milk)) return;
    if (!held(q, OBJ.bucket)) await q.ensure('bucket', 1);
    await q.goTo(COWS, 6);
    for (let attempt = 1; attempt <= 8 && !held(q, OBJ.milk); attempt++) {
        const cow = q.sdk.findNearbyNpc(/^cow$/i, { reachable: true }) ?? q.sdk.findNearbyNpc(/^cow$/i);
        if (!cow) {
            await q.goTo(COWS, 3);
            await q.sdk.waitForTicks(5);
            continue;
        }
        await q.bot.useItemOnNpc(/^bucket$/i, cow).catch(() => undefined);
        await untilTicks(q.sdk, () => held(q, OBJ.milk), 10);
    }
    if (!held(q, OBJ.milk)) throw new Error(`fluffs: no milk from the cows (at ${where(q)})`);
    q.log('fluffs: milked a cow');
}

/** Doogle leaves by Gertrude's house and a raw sardine from Gerrant, rubbed together. */
export async function getSeasonedSardine(q: Quest): Promise<void> {
    if (held(q, OBJ.seasoned)) return;
    if (!held(q, OBJ.doogle)) {
        await q.goTo(DOOGLE[0]!, 3);
        for (let round = 0; round < 6 && !held(q, OBJ.doogle); round++) {
            await q.sdk.scanGroundItems(10).catch(() => undefined);
            const leaf = (q.sdk.getState()?.groundItems ?? []).find((g) => g.id === OBJ.doogle);
            if (!leaf) {
                await q.sdk.waitForTicks(10);
                continue;
            }
            await q.bot.pickupItem(leaf).catch(() => undefined);
            await untilTicks(q.sdk, () => held(q, OBJ.doogle), 8);
        }
        if (!held(q, OBJ.doogle)) throw new Error('fluffs: no doogle leaves by Gertrude\'s house');
    }
    if (!held(q, OBJ.sardine)) await buyWaitingForRestock(q, GERRANT, 'raw sardine', 1);
    const leaf = q.sdk.getInventory().find((i) => i.id === OBJ.doogle)!;
    const fish = q.sdk.getInventory().find((i) => i.id === OBJ.sardine)!;
    await q.sdk.sendUseItemOnItem(leaf.slot, fish.slot);
    await untilTicks(q.sdk, (s) => held(q, OBJ.seasoned) || !!s.dialog?.isOpen, 10);
    await driveDialog(q.sdk, [], { ticks: 6 });
    if (!held(q, OBJ.seasoned)) throw new Error('fluffs: the sardine did not season');
    q.log('fluffs: seasoned a sardine');
}

// ── the mill

/** Over the mill's fence from the south. */
async function intoMill(q: Quest): Promise<void> {
    if (inMillYard(pos(q))) return;
    await q.goTo({ x: FENCE.x, z: FENCE.z - 1 }, 0);
    await op(q, FENCE, /fence/i, /climb/i, () => inMillYard(pos(q)), 'over the mill fence');
}

/** Out of the mill yard over its fence. */
export async function leaveMill(q: Quest): Promise<void> {
    if (!inMillYard(pos(q))) return;
    // "Fluffs has run off home" is still on screen after the kitten: walks are refused under it.
    if (q.sdk.getDialog()?.isOpen) await driveDialog(q.sdk, [], { ticks: 15 });
    await q.bot.dismissBlockingUI().catch(() => undefined);
    if (pos(q).level > 0) await op(q, MILL_LADDER, /ladder/i, /climb-down/i, () => pos(q).level === 0, 'down the mill ladder');
    // From inside, the climb starts on the fence's own tile: get within reach first (the mill's door on the way).
    for (let attempt = 1; attempt <= 3; attempt++) {
        const walk = await q.goTo({ x: FENCE.x, z: FENCE.z + 2 }, 1).then(() => ({ success: true, message: "" }), (e) => ({ success: false, message: String(e) }));
        if (walk.success) break;
        q.log(`fluffs: walk to the mill fence: ${walk.message}`);
        // Shut in the mill (its door, 3302,3503: "Stuck at (3307,3508)", 2026-11-04).
        await q.sdk.scanNearbyLocs(10).catch(() => undefined);
        const door = (q.sdk.getNearbyLocs() ?? [])
            .filter((l) => /^door$/i.test(l.name) && l.reachable !== false && l.optionsWithIndex.some((o) => /^open$/i.test(o.text)))
            .sort((a, b) => (a.distance ?? 99) - (b.distance ?? 99))[0];
        if (door) await q.bot.openDoor(door).catch(() => undefined);
        // The client's own path stays "Stuck at (3307,3508)" with the door open (qlqbgc3,
        // 2026-11-04): let the server path the walk.
        await q.sdk.sendWalk(FENCE.x, FENCE.z + 2, true).catch(() => undefined);
        await untilTicks(q.sdk, () => Math.hypot(pos(q).x - FENCE.x, pos(q).z - FENCE.z - 2) <= 2, 30);
        if (Math.hypot(pos(q).x - FENCE.x, pos(q).z - FENCE.z - 2) <= 2) break;
    }
    await op(q, FENCE, /fence/i, /climb/i, () => !inMillYard(pos(q)), 'back over the mill fence');
}

async function upToFluffs(q: Quest): Promise<void> {
    await intoMill(q);
    if (pos(q).level === 1) return;
    await q.bot.walkTo(MILL_LADDER.x, MILL_LADDER.z - 1, 1).catch(() => undefined);
    await op(q, MILL_LADDER, /ladder/i, /climb-up/i, () => pos(q).level === 1, 'up the mill ladder');
}

/** Use held item `id` on Fluffs until `done()`. */
export async function feedFluffs(q: Quest, id: number, done: () => boolean, label: string): Promise<void> {
    await upToFluffs(q);
    for (let attempt = 1; attempt <= 4 && !done(); attempt++) {
        const cat = q.sdk.findNearbyNpc(/^gertrudes cat$/i);
        if (!cat || !held(q, id)) {
            await q.sdk.waitForTicks(3);
            continue;
        }
        await q.bot.useItemOnNpc(new RegExp(`^${q.sdk.getInventory().find((i) => i.id === id)!.name}$`, 'i'), cat).catch(() => undefined);
        await untilTicks(q.sdk, (s) => done() || !!s.dialog?.isOpen, 12);
        if (q.sdk.getDialog()?.isOpen) await driveDialog(q.sdk, [], { done, ticks: 30, log: q.log });
        await untilTicks(q.sdk, done, 6);
    }
    if (!done()) throw new Error(`fluffs: ${label} failed at ${where(q)}`);
    // The kitten's hand-in walks both cats off (p_delay 4) before "Fluffs has run off home": the item
    // leaves the pack first, and walking under that mesbox stuck the exit at (3307,3508) (qlqbgc4).
    if (id === OBJ.kitten && (await untilTicks(q.sdk, (s) => !!s.dialog?.isOpen, 12))) await driveDialog(q.sdk, [], { ticks: 15, log: q.log });
    q.log(`fluffs: ${label}`);
    void FLUFFS;
}

/** Search the six crates on the ground floor for the kitten. */
export async function findKitten(q: Quest): Promise<void> {
    if (held(q, OBJ.kitten)) return;
    await intoMill(q);
    if (pos(q).level > 0) await op(q, MILL_LADDER, /ladder/i, /climb-down/i, () => pos(q).level === 0, 'down the mill ladder');
    const todo = [...CRATES];
    const misses: Record<string, number> = {};
    while (todo.length && !held(q, OBJ.kitten)) {
        todo.sort((a, b) => Math.hypot(a.x - pos(q).x, a.z - pos(q).z) - Math.hypot(b.x - pos(q).x, b.z - pos(q).z));
        const spot = todo.shift()!;
        const crate = (q.sdk.getNearbyNpcs() ?? []).find((n) => /^crate$/i.test(n.name) && n.x === spot.x && n.z === spot.z);
        if (!crate) {
            await q.bot.walkTo(spot.x, spot.z, 2).catch(() => undefined);
        }
        const crateAt = () => (q.sdk.getNearbyNpcs() ?? []).find((n) => /^crate$/i.test(n.name) && Math.abs(n.x - spot.x) <= 1 && Math.abs(n.z - spot.z) <= 1);
        // Right after the ladder the npc list lags (two crates read as missing, 2026-11-04).
        await untilTicks(q.sdk, () => !!crateAt(), 6);
        const target = crateAt();
        if (!target) {
            q.log(`fluffs: no crate at (${spot.x},${spot.z}) from ${where(q)}`);
            if ((misses[`${spot.x},${spot.z}`] = (misses[`${spot.x},${spot.z}`] ?? 0) + 1) < 3) todo.push(spot);
            continue;
        }
        const since = cursor(q);
        await q.sdk.sendInteractNpc(target.index, 1);
        await untilTicks(q.sdk, (s) => held(q, OBJ.kitten) || !!s.dialog?.isOpen || said(q, since, /find nothing/i), 20);
        if (q.sdk.getDialog()?.isOpen) await driveDialog(q.sdk, [], { ticks: 10 });
    }
    if (!held(q, OBJ.kitten)) throw new Error('fluffs: no kitten in any crate');
    q.log('fluffs: found the kitten');
}
