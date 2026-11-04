/**
 * Sea Slug — Caroline's family on the fishing platform west of Witchaven.
 *
 * Content facts (quest_seaslug/scripts/quest_seaslug.rs2, area_ardougne_east/scripts/{caroline,
 * holgart_ardougne}.rs2, area_fishing_platform/scripts/*.rs2; placements m42_51, m43_51):
 *   - Caroline (2716,3302) and Holgart (2720,3306) on the shore. Holgart wants swamp paste (2 -> 3),
 *     sold by the Port Khazard general store (khazardshop stock 500), then rows to the platform
 *     (2782,3273). He rows back from the platform's Holgart (2782,3276) to the shore (2722,3305), but
 *     at 4 (Kennith found) he rows only to Kent's island, and the island's Holgart only back to the
 *     platform once Kent is seen: the quest's noHubAt keeps a resumed run offshore.
 *   - The platform's ladder (2784,3286) up; with the quest past 6 only a lit torch in the pack stops
 *     the fishermen knocking you off it.
 *   - Kennith hides behind the crates (2763-2764,3287, L1) inside his cabin (door 1530 at 2764,3285) —
 *     "Shout-across" talks to him:
 *     3 -> 4, 7 -> 8, 9 -> 10.
 *   - At 4 the platform's Holgart rows to the island (2795,3320, -> 5); Kent (2793,3321) pulls a slug
 *     off you (-> 6); the island's Holgart rows back.
 *   - Bailey (2763,3276) gives an unlit torch. Damp sticks (2784,3289) + broken glass (2765,3278 /
 *     2765,3289) -> dry sticks; "Light" them (Firemaking 30, random) lights the torch (6 -> 7).
 *   - The loose panel (2765,3288, L1) Kick at 8 -> 9; the crane (2768,3286, L1) Rotate from z >= 3289
 *     at 10 -> 11. Caroline then completes it.
 */
import type { Quest } from './run-quest';
import { driveDialog } from './dialog';
import { untilTicks } from './ticks';

interface Tile {
    x: number;
    z: number;
    level?: number;
}

export const OBJ = { torchLit: 594, torchUnlit: 596, damp: 1467, dry: 1468, glass: 1469, paste: 1941 } as const;

export const CAROLINE = { x: 2716, z: 3302 };
export const HOLGART_SHORE = { x: 2720, z: 3306 };
const HOLGART_PLATFORM = { x: 2782, z: 3276 };
const HOLGART_ISLAND = { x: 2799, z: 3320 };
const KENT = { x: 2793, z: 3321 };
const BAILEY = { x: 2763, z: 3276 };
const LADDER = { x: 2784, z: 3286 };
const CRATES = { x: 2764, z: 3287 };
const PANEL = { x: 2765, z: 3288 };
const CRANE = { x: 2768, z: 3286 };
const DAMP_STICKS = { x: 2784, z: 3289 };
const GLASS: Tile[] = [{ x: 2765, z: 3278 }, { x: 2765, z: 3289 }];

const pos = (q: Quest) => {
    const p = q.sdk.getState()?.player;
    return { x: p?.worldX ?? 0, z: p?.worldZ ?? 0, level: p?.level ?? 0 };
};
const where = (q: Quest) => `(${pos(q).x},${pos(q).z},L${pos(q).level})`;
const inBox = (p: Tile, x0: number, x1: number, z0: number, z1: number) => p.x >= x0 && p.x <= x1 && p.z >= z0 && p.z <= z1;
export const held = (q: Quest, id: number) => q.sdk.getInventory().some((i) => i.id === id);

/** The fishing platform, both floors. */
export const onPlatform = (p: Tile) => inBox(p, 2755, 2800, 3268, 3295);
/** Kent's island. */
export const onIsland = (p: Tile) => inBox(p, 2785, 2810, 3310, 3330);
export const inSeaSlugArea = (p: Tile) => onPlatform(p) || onIsland(p);

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

async function walk(q: Quest, to: Tile, tolerance = 1): Promise<void> {
    const res = await q.bot.walkTo(to.x, to.z, tolerance);
    if (!res.success) q.log(`seaslug: walk to (${to.x},${to.z}): ${res.message} (at ${where(q)})`);
}

/** Talk to `npc` near `at` on the platform/island (no goTo: run-quest would row us ashore first). */
async function talkHere(q: Quest, npc: RegExp, at: Tile, choices: RegExp[] = []): Promise<string> {
    if (pos(q).level !== 0) await down(q);
    if (Math.hypot(pos(q).x - at.x, pos(q).z - at.z) > 6) {
        if (onPlatform(pos(q))) await step(q, at.x, at.z + 1, 2);
        else await walk(q, at, 3);
    }
    const seen = await q.talk(npc, choices);
    return seen + (await driveDialog(q.sdk, choices, { ticks: 20, log: q.log }));
}

// ── ashore

/** Holgart rows us out to the platform (paste on hand at 2; any stage after). */
export async function rowOut(q: Quest): Promise<void> {
    if (onPlatform(pos(q))) return;
    if (onIsland(pos(q))) {
        await talkHere(q, /^holgart$/i, HOLGART_ISLAND, []);
    } else {
        await q.talk(/^holgart$/i, [/okay,? lets do it/i, /will you take me there/i, /okay,? let'?s do it/i], HOLGART_SHORE);
    }
    await untilTicks(q.sdk, (s) => !!s.dialog?.isOpen || onPlatform(pos(q)), 10);
    await driveDialog(q.sdk, [], { ticks: 15, log: q.log });
    if (!(await untilTicks(q.sdk, () => onPlatform(pos(q)), 10))) throw new Error(`seaslug: Holgart did not row us to the platform (at ${where(q)})`);
    q.log(`seaslug: on the fishing platform at ${where(q)}`);
}

/** The platform's Holgart rows us back to the shore. */
export async function rowAshore(q: Quest): Promise<void> {
    if (onIsland(pos(q))) await rowOut(q);
    if (!onPlatform(pos(q))) return;
    await talkHere(q, /^holgart$/i, HOLGART_PLATFORM, [/okay,? let'?s go back/i]);
    if (!(await untilTicks(q.sdk, () => !inSeaSlugArea(pos(q)), 12))) throw new Error(`seaslug: Holgart did not row us ashore (at ${where(q)})`);
    await driveDialog(q.sdk, [], { ticks: 10 });
    q.log(`seaslug: back ashore at ${where(q)}`);
}

// ── the platform
//
// The platform is a bridged (LinkBelow) map square: its lower deck is the map file's level 1. The
// lite client showed the wrong deck's locs until SceneLite.staticLevel (2026-11-05); the ladders,
// panel and crane still go by raw ops at known coords/ids, which do not depend on the scene.

/** Platform locs: [x, z, loc id, op]. Ids from loc.pack (slugladder 2517, laddertop 1746, ...). */
const RAW = {
    ladderUp: [LADDER.x, LADDER.z, 2517, 1],
    ladderDown: [LADDER.x, LADDER.z, 1746, 1],
    panel: [PANEL.x, PANEL.z, 2518, 1],
    crane: [CRANE.x, CRANE.z, 2520, 1],
} as const;

/**
 * Walk to a tile on the platform; true once within `tolerance`. walkTo opens Kennith's cabin door on
 * the way (a run resumed inside the cabin found it shut again); a plain walk is the fallback when a
 * fisherman blocks the one-tile walkways.
 */
async function step(q: Quest, x: number, z: number, tolerance = 0): Promise<boolean> {
    const near = () => Math.abs(pos(q).x - x) <= tolerance && Math.abs(pos(q).z - z) <= tolerance;
    for (let attempt = 0; attempt < 3 && !near(); attempt++) {
        const res = await q.bot.walkTo(x, z, tolerance).catch((e) => ({ success: false, message: String(e) }));
        if (near()) break;
        if (!res.success) q.log(`seaslug: walk to (${x},${z}): ${res.message} (at ${where(q)})`);
        await q.sdk.sendWalk(x, z, true);
        await untilTicks(q.sdk, near, 20);
    }
    return near();
}

async function rawOp(q: Quest, loc: readonly [number, number, number, number], done: () => boolean, label: string, ticks = 15): Promise<void> {
    for (let attempt = 1; attempt <= 3 && !done(); attempt++) {
        const since = cursor(q);
        await q.sdk.sendInteractLoc(loc[0], loc[1], loc[2], loc[3]);
        await untilTicks(q.sdk, (s) => done() || !!s.dialog?.isOpen || said(q, since, /can't reach/i), ticks);
        if (q.sdk.getDialog()?.isOpen) await driveDialog(q.sdk, [], { done, ticks: 40, log: q.log });
        await untilTicks(q.sdk, done, 4);
        if (said(q, since, /can't reach/i)) q.log(`seaslug: ${label}: can't reach it from ${where(q)}`);
    }
    if (!done()) throw new Error(`seaslug: ${label} failed at ${where(q)}`);
}

async function up(q: Quest): Promise<void> {
    if (pos(q).level === 1) return;
    await step(q, LADDER.x - 1, LADDER.z, 1);
    await rawOp(q, RAW.ladderUp, () => pos(q).level === 1, 'up the platform ladder');
}

async function down(q: Quest): Promise<void> {
    if (pos(q).level === 0) return;
    await step(q, LADDER.x - 1, LADDER.z, 1);
    await rawOp(q, RAW.ladderDown, () => pos(q).level === 0, 'down the platform ladder');
}

/**
 * Shout across the crates to Kennith (upper deck, kennithwall: Kennith within 5 of the tile 2 north
 * of us). The crates stand inside his cabin, behind its door (1530 at 2764,3285): q.reach opens it.
 * Before the lite client's bridge fix (SceneLite.staticLevel) the client saw the lower deck's locs
 * up here and the door op was "I can't reach that!" (qlqbss1, 2026-11-04).
 */
export async function shoutKennith(q: Quest): Promise<void> {
    await rowOut(q);
    await up(q);
    const since = cursor(q);
    const opened = () => !!q.sdk.getDialog()?.isOpen || said(q, since, /doesn't seem interested/i);
    for (let attempt = 1; attempt <= 3 && !opened(); attempt++) {
        if (pos(q).level !== 1) await up(q);
        // Toward the cabin first: the crates are out of the scan from the ladder end of the deck.
        if (Math.hypot(pos(q).x - CRATES.x, pos(q).z - CRATES.z) > 6) await step(q, 2766, 3286, 1);
        await q.reach(/^crates$/i, /shout/i);
        const crates = await locNear(q, CRATES, /^crates$/i, /shout/i, 2);
        if (!crates) throw new Error(`seaslug: no crates by Kennith's cabin (at ${where(q)})`);
        const res = await q.bot.interactLoc(crates, /shout/i);
        if (!res.success) q.log(`seaslug: shout across the crates: ${res.message}`);
        await untilTicks(q.sdk, opened, 15);
    }
    if (!opened()) throw new Error(`seaslug: no answer from Kennith across the crates (at ${where(q)})`);
    await driveDialog(q.sdk, [], { ticks: 40, log: q.log });
}

/** Holgart to the island, Kent, Holgart back (4 -> 6). */
export async function seeKent(q: Quest, toIsland: boolean): Promise<void> {
    if (!onIsland(pos(q))) {
        await rowOut(q);
        if (toIsland) {
            await talkHere(q, /^holgart$/i, HOLGART_PLATFORM, []);
            await untilTicks(q.sdk, () => onIsland(pos(q)), 12);
            await driveDialog(q.sdk, [], { ticks: 10 });
        }
    }
    if (!onIsland(pos(q))) throw new Error(`seaslug: not on Kent's island (at ${where(q)})`);
    await talkHere(q, /^kent$/i, KENT, []);
    await q.sdk.waitForTicks(6);
}

async function pickUp(q: Quest, id: number, spots: Tile[], label: string): Promise<void> {
    for (const spot of spots) {
        if (held(q, id)) return;
        await step(q, spot.x, spot.z, 1);
        for (let i = 0; i < 4 && !held(q, id); i++) {
            const g = (q.sdk.getState()?.groundItems ?? []).find((it) => it.id === id && Math.hypot(it.x - spot.x, it.z - spot.z) <= 2);
            if (!g) {
                await q.sdk.waitForTicks(3);
                continue;
            }
            await q.bot.pickupItem(g).catch(() => undefined);
            await untilTicks(q.sdk, () => held(q, id), 8);
        }
    }
    if (!held(q, id)) throw new Error(`seaslug: no ${label} at ${spots.map((s) => `(${s.x},${s.z})`).join(' ')} (from ${where(q)})`);
}

/** Bailey's torch, the damp sticks dried with the glass, lit (6 -> 7). */
export async function lightTorch(q: Quest): Promise<void> {
    await rowOut(q);
    if (held(q, OBJ.torchLit)) return;
    if (!held(q, OBJ.torchUnlit)) await talkHere(q, /^bailey$/i, BAILEY, []);
    if (!held(q, OBJ.torchUnlit)) throw new Error('seaslug: Bailey gave no torch');
    if (!held(q, OBJ.dry)) {
        if (pos(q).level !== 0) await down(q);
        await pickUp(q, OBJ.damp, [DAMP_STICKS], 'damp sticks');
        await pickUp(q, OBJ.glass, GLASS, 'broken glass');
        const glass = q.sdk.getInventory().find((i) => i.id === OBJ.glass)!;
        const damp = q.sdk.getInventory().find((i) => i.id === OBJ.damp)!;
        await q.sdk.sendUseItemOnItem(glass.slot, damp.slot);
        await untilTicks(q.sdk, () => held(q, OBJ.dry), 10);
        if (!held(q, OBJ.dry)) throw new Error('seaslug: the glass did not dry the sticks');
    }
    for (let attempt = 1; attempt <= 30 && !held(q, OBJ.torchLit) && held(q, OBJ.dry); attempt++) {
        const sticks = q.sdk.getInventory().find((i) => i.id === OBJ.dry)!;
        const since = cursor(q);
        await q.sdk.sendUseItem(sticks.slot);
        await untilTicks(q.sdk, () => held(q, OBJ.torchLit) || said(q, since, /die out|nothing happens/i), 10);
        if (said(q, since, /Firemaking level of 30/i)) throw new Error('seaslug: Firemaking 30 needed to light the sticks');
    }
    if (!held(q, OBJ.torchLit)) throw new Error('seaslug: the torch would not light');
    q.log('seaslug: the torch is lit');
}

/** Kick the loose panel by Kennith (8 -> 9), from the deck east of it. */
export async function kickPanel(q: Quest): Promise<void> {
    await rowOut(q);
    await up(q);
    await step(q, 2766, 3288);
    const since = cursor(q);
    await rawOp(q, RAW.panel, () => said(q, since, /kick the loose panel/i), 'kick the loose panel', 15);
    await untilTicks(q.sdk, () => said(q, since, /opening big enough|nothing interesting/i), 12);
}

/** Rotate the crane from its north side (z >= 3289; 10 -> 11). */
export async function rotateCrane(q: Quest): Promise<void> {
    await rowOut(q);
    await up(q);
    await step(q, 2768, 3290);
    const since = cursor(q);
    await rawOp(q, RAW.crane, () => said(q, since, /rotate the crane around|get closer/i), 'rotate the crane', 15);
    if (said(q, since, /get closer/i)) throw new Error(`seaslug: the crane wants us closer (at ${where(q)})`);
    await untilTicks(q.sdk, () => said(q, since, /lower kennith/i), 15);
}

/** Off the platform or the island toward the mainland (run-quest's goTo). */
export async function leaveSeaSlug(q: Quest): Promise<void> {
    if (!inSeaSlugArea(pos(q))) return;
    if (onPlatform(pos(q)) && pos(q).level > 0) await down(q);
    await rowAshore(q);
}
