/**
 * Holy Grail — Camelot, Entrana, Galahad, the Draynor Manor whistles and the Fisher King's realm.
 *
 * Content facts (quest_grail/scripts/*, area_camelot/scripts/{king_arthur,merlin}.rs2,
 * area_seers/scripts/brother_galahad.rs2, area_entrana/scripts/high_priest_of_entrana.rs2,
 * area_taverly/scripts/lady_of_the_lake.rs2; placements m43_54, m40_54, m44_52, m48_52, m46_54,
 * m41_73, m43_73, m42_50):
 *   - Merlin's workshop door (2764,3503,L1) opens only once the quest is started; entering spawns
 *     Merlin (2767,3500,L1). Talking to him: 2 -> 3.
 *   - Entrana's High Priest (2851,3349) spawns the crone beside him and runs her lines: 3 -> 4.
 *     The monks take nobody carrying weapons or armour.
 *   - Brother Galahad (2612,3474) at 4 with no napkin held: "I seek an item from the realm of the
 *     Fisher King." hands over the Holy table napkin.
 *   - Draynor Manor's top-floor door (3106,3361,L2): opening it with the napkin held and fewer than
 *     two whistles in the pack drops two Magic whistles at (3107,3359,L2).
 *   - A whistle (Blow) in the six heads' pocket on Karamja (2740-2743,3234-3237) goes to the dying
 *     realm (2806,4715); after Percival (9) to the restored one (2678,4715). Blown in either realm it
 *     comes back to (2741,3235), north of Brimhaven.
 *   - The Black Knight Titan (2791,4722, 142 hp) only dies to a wielder of Excalibur; its death puts
 *     you past it. Excalibur: the bank, or the Lady of the Lake (2924,3405) for 500 coins.
 *   - The fisherman (2802,4706) "Any idea how to get into the castle?" drops a Grail bell at
 *     (2762,4694); ringing it within 4 tiles of a maiden puts you inside (2761,4692). The Fisher King
 *     (2762,4688,L1): "You don't look too well." -> 8.
 *   - Percival is in the sacks at the goblin village (2960,3507): Open, "Your father wishes to speak
 *     to you." gives him a whistle -> 9.
 *   - The Holy grail lies at (2649,4684,L2) in the restored castle; Arthur (2764,3515) takes it.
 */
import type { Quest } from './run-quest';
import { driveDialog } from './dialog';
import { tickNow, untilTicks } from './ticks';
import { FARE, leaveJungle, toJungle } from './jungle-potion';
import { SAFE_BANKS } from '../safe-stops';
import { depositAllInventory } from '../quest-supplies';

interface Tile {
    x: number;
    z: number;
    level?: number;
}

export const OBJ = { napkin: 15, whistle: 16, bell: 17, feather: 18, grail: 19, excalibur: 35 } as const;

export const ARTHUR = { x: 2764, z: 3515 };
/** West of Merlin's workshop door (the door's east side is the workshop). */
const MERLIN_DOOR = { x: 2764, z: 3503, level: 1 };
const MERLIN_DOOR_OUT = { x: 2763, z: 3503, level: 1 };
const MERLIN = { x: 2767, z: 3500, level: 1 };
const GALAHAD = { x: 2612, z: 3474 };
const PORT_SARIM_MONK = { x: 3045, z: 3236 };
const HIGH_PRIEST = { x: 2851, z: 3349 };
const WHISTLE_DOOR = { x: 3106, z: 3361, level: 2 };
const WHISTLE_SPAWN = { x: 3107, z: 3359, level: 2 };
/** The six heads' pocket north of Brimhaven, where the whistle works. */
export const SIX_HEADS = { x: 2741, z: 3235 };
const TITAN = { x: 2791, z: 4722 };
const FISHERMAN = { x: 2802, z: 4706 };
const BELL_DROP = { x: 2762, z: 4694 };
const FISHER_KING = { x: 2762, z: 4688, level: 1 };
/** Beside the castle's spiral stairs (2761,4680, m43_73). */
const CASTLE_STAIRS_FOOT = { x: 2761, z: 4682 };
const GRAIL = { x: 2649, z: 4684, level: 2 };
/** The restored castle's spiral stairs (2648,4683, m41_73). */
const RESTORED_STAIRS_FOOT = { x: 2647, z: 4683 };
const SACKS = { x: 2960, z: 3507 };
const LADY = { x: 2924, z: 3405 };
// 20, not 15: jacklove2 and ABGARMY07 ran out against the Titan (hp 27, 19), 2026-11-04.
const TITAN_FOOD = 20;

const pos = (q: Quest) => {
    const p = q.sdk.getState()?.player;
    return { x: p?.worldX ?? 0, z: p?.worldZ ?? 0, level: p?.level ?? 0 };
};
const where = (q: Quest) => `(${pos(q).x},${pos(q).z},L${pos(q).level})`;
const inBox = (p: Tile, x0: number, x1: number, z0: number, z1: number) => p.x >= x0 && p.x <= x1 && p.z >= z0 && p.z <= z1;
export const held = (q: Quest, id: number) => q.sdk.getInventory().filter((i) => i.id === id).reduce((n, i) => n + (i.count ?? 1), 0);
const wearing = (q: Quest, id: number) => q.sdk.getEquipment().some((i) => i.id === id);

/** The dying realm (m43_73) and the restored one (m41_73). */
export const inDyingRealm = (p: Tile) => inBox(p, 2752, 2815, 4672, 4735);
export const inRestoredRealm = (p: Tile) => inBox(p, 2624, 2687, 4672, 4735);
export const inRealm = (p: Tile) => inDyingRealm(p) || inRestoredRealm(p);
/** The six heads' pocket and the path down to Brimhaven: walkTo has no way off the island from here. */
const onBrimhavenNorth = (p: Tile) => (p.level ?? 0) === 0 && inBox(p, 2735, 2760, 3195, 3240);
/** Anywhere run-quest's goTo cannot walk out of on its own. */
export const inGrailArea = (p: Tile) => inRealm(p) || onBrimhavenNorth(p);

function cursor(q: Quest): number {
    return Math.max(0, ...(q.sdk.getState()?.gameMessages ?? []).map((m) => m.observationId ?? m.tick));
}
function said(q: Quest, since: number, text: RegExp): boolean {
    return (q.sdk.getState()?.gameMessages ?? []).some((m) => (m.observationId ?? m.tick) > since && text.test(m.text));
}

/** Use (Blow/Ring) the held item `id` and drive whatever dialog it opens; true once `done`. */
async function useHeld(q: Quest, id: number, done: () => boolean, ticks = 15): Promise<boolean> {
    const item = q.sdk.getInventory().find((i) => i.id === id);
    if (!item) throw new Error(`grail: not holding item ${id} (carrying ${q.sdk.getInventory().map((i) => i.name).join(', ') || 'nothing'})`);
    await q.sdk.sendUseItem(item.slot, 1);
    await untilTicks(q.sdk, (s) => done() || !!s.dialog?.isOpen, ticks);
    if (q.sdk.getDialog()?.isOpen) await driveDialog(q.sdk, [], { done, ticks: 30, log: q.log });
    return untilTicks(q.sdk, done, 4);
}

async function pickUp(q: Quest, id: number, near: Tile, want: number, label: string): Promise<void> {
    for (let i = 0; i < 10 && held(q, id) < want; i++) {
        const ground = (await q.sdk.scanGroundItems(10).catch(() => []))
            .filter((g) => g.id === id)
            .sort((a, b) => Math.hypot(a.x - near.x, a.z - near.z) - Math.hypot(b.x - near.x, b.z - near.z))[0];
        if (!ground) {
            await q.sdk.waitForTicks(3);
            continue;
        }
        const before = held(q, id);
        await q.sdk.sendPickup(ground.x, ground.z, ground.id);
        await untilTicks(q.sdk, (s) => held(q, id) > before || !!s.dialog?.isOpen, 15);
        if (q.sdk.getDialog()?.isOpen) await driveDialog(q.sdk, [], { ticks: 20, log: q.log });
    }
    if (held(q, id) < want) throw new Error(`grail: no ${label} to pick up near (${near.x},${near.z}) from ${where(q)}`);
}

// ── Camelot

export async function seeMerlin(q: Quest): Promise<void> {
    // goTo walks to the same x,z on L0 and stops there ("arrived on the wrong floor", ABGARMY20 2/2 and
    // jacklove2, 2026-11-04): climb Camelot's stairs toward the workshop first.
    if (pos(q).level !== 1) {
        await q.goTo({ x: MERLIN_DOOR_OUT.x, z: MERLIN_DOOR_OUT.z }, 6);
        if (pos(q).level !== 1) await q.climbTo(1, MERLIN_DOOR_OUT);
    }
    await q.goTo(MERLIN_DOOR_OUT, 1);
    for (let attempt = 1; attempt <= 3 && !q.sdk.findNearbyNpc(/^merlin$/i); attempt++) {
        await q.sdk.scanNearbyLocs(5).catch(() => undefined);
        const door = (q.sdk.getNearbyLocs() ?? []).find((l) => l.x === MERLIN_DOOR.x && l.z === MERLIN_DOOR.z && /door/i.test(l.name));
        if (door?.optionsWithIndex.some((o) => /^open$/i.test(o.text))) {
            await q.sdk.sendInteractLoc(door.x, door.z, door.id, door.optionsWithIndex.find((o) => /^open$/i.test(o.text))!.opIndex);
            await untilTicks(q.sdk, () => pos(q).x > MERLIN_DOOR.x || !!q.sdk.findNearbyNpc(/^merlin$/i), 10);
        }
        if (pos(q).x <= MERLIN_DOOR.x) {
            await q.sdk.sendWalk(MERLIN.x - 1, MERLIN.z, true);
            await untilTicks(q.sdk, () => pos(q).x > MERLIN_DOOR.x, 10);
        }
        await untilTicks(q.sdk, () => !!q.sdk.findNearbyNpc(/^merlin$/i), 5);
    }
    if (!q.sdk.findNearbyNpc(/^merlin$/i)) throw new Error(`grail: Merlin did not appear in his workshop (at ${where(q)})`);
    await q.talk(/^merlin$/i, []);
}

// ── Entrana

const onEntrana = (q: Quest) => inBox(pos(q), 2800, 2880, 3320, 3400);

/** Sail to Entrana with nothing a monk would refuse (all worn and carried gear banked first). */
async function toEntrana(q: Quest): Promise<void> {
    if (onEntrana(q)) return;
    await q.goTo(SAFE_BANKS.draynor, 4);
    await depositAllInventory(q.supply, [/^coins$/i, /^holy table napkin$/i, /^magic whistle$/i]);
    await q.bot.closeBank().catch(() => undefined);
    await q.talk(/^monk of entrana$/i, [/yes,? okay,? i'?m ready to go/i], PORT_SARIM_MONK);
    const before = pos(q);
    const sailed = () => onEntrana(q) || pos(q).level > 0 || Math.hypot(pos(q).x - before.x, pos(q).z - before.z) > 40;
    if (!(await untilTicks(q.sdk, sailed, 40))) throw new Error(`grail: the monks did not sail us (at ${where(q)}; carrying ${q.sdk.getInventory().map((i) => i.name).join(', ')})`);
    await driveDialog(q.sdk, [], { ticks: 20, log: q.log });
    for (let i = 0; i < 4 && pos(q).level > 0; i++) {
        await q.sdk.scanNearbyLocs(10).catch(() => undefined);
        const plank = q.sdk.findNearbyLoc(/gangplank/i, { withOption: /cross/i });
        if (plank) await q.bot.interactLoc(plank, /cross/i).catch(() => undefined);
        await untilTicks(q.sdk, () => pos(q).level === 0, 15);
    }
    if (!onEntrana(q)) throw new Error(`grail: not on Entrana after the boat (at ${where(q)})`);
    q.log(`grail: on Entrana at ${where(q)}`);
}

/** The High Priest calls the crone, who sends us to the six heads: 3 -> 4. */
export async function seeCrone(q: Quest): Promise<void> {
    await toEntrana(q);
    const seen = await q.talk(/^high priest$/i, [/ok,? i will go searching/i], HIGH_PRIEST);
    if (!/six heads/i.test(seen)) q.log(`grail: the priest/crone said: ${seen.slice(0, 200)}`);
}

// ── the napkin, the whistles, Excalibur

export async function getNapkin(q: Quest): Promise<void> {
    if (held(q, OBJ.napkin)) return;
    const seen = await q.talk(/^galahad$/i, [/i seek an item from the realm of the fisher king/i, /i have lost the holy table napkin/i], GALAHAD);
    if (!held(q, OBJ.napkin)) throw new Error(`grail: Galahad gave no napkin: ${seen.slice(0, 200)}`);
    q.log('grail: the holy table napkin from Galahad');
}

/** Two whistles (one for us, one for Percival) from Draynor Manor's top floor. */
export async function getWhistles(q: Quest, want = 2): Promise<void> {
    if (held(q, OBJ.whistle) >= want) return;
    await getNapkin(q);
    const { enterManor } = await import('./draynor-manor');
    if (pos(q).level === 0) await enterManor(q);
    await q.goTo({ x: WHISTLE_DOOR.x - 1, z: WHISTLE_DOOR.z, level: 2 }, 2);
    for (let attempt = 1; attempt <= 4 && held(q, OBJ.whistle) < want; attempt++) {
        await q.sdk.scanNearbyLocs(6).catch(() => undefined);
        const door = (q.sdk.getNearbyLocs() ?? []).find((l) => l.x === WHISTLE_DOOR.x && l.z === WHISTLE_DOOR.z && /door/i.test(l.name));
        // Each Open (either way through) drops two whistles while we hold the napkin and fewer than two.
        if (door?.optionsWithIndex.some((o) => /^open$/i.test(o.text))) {
            await q.sdk.sendInteractLoc(door.x, door.z, door.id, door.optionsWithIndex.find((o) => /^open$/i.test(o.text))!.opIndex);
            await q.sdk.waitForTicks(3);
        } else if (!door) {
            q.log(`grail: no whistle door in view from ${where(q)}`);
        }
        await q.sdk.sendWalk(WHISTLE_SPAWN.x, WHISTLE_SPAWN.z, true);
        await untilTicks(q.sdk, () => Math.hypot(pos(q).x - WHISTLE_SPAWN.x, pos(q).z - WHISTLE_SPAWN.z) <= 1, 10);
        await pickUp(q, OBJ.whistle, WHISTLE_SPAWN, want, 'magic whistle').catch((e) => q.log(`grail: ${(e as Error).message}`));
    }
    if (held(q, OBJ.whistle) < want) throw new Error(`grail: only ${held(q, OBJ.whistle)} magic whistles from the manor`);
    q.log(`grail: ${held(q, OBJ.whistle)} magic whistles`);
}

/** Excalibur: banked (Draynor, on the way back from the manor), else the Lady of the Lake for 500. */
const FOOD = /^(shark|monkfish|swordfish|lobster)$/i;

export async function getExcalibur(q: Quest): Promise<void> {
    const armed = () => held(q, OBJ.excalibur) > 0 || wearing(q, OBJ.excalibur);
    if (armed() && q.sdk.getInventory().filter((i) => FOOD.test(i.name)).length >= TITAN_FOOD) return;
    await q.goTo(SAFE_BANKS.draynor, 4);
    await q.bot.openBank().catch(() => undefined);
    const banked = q.sdk.getBankItems().find((b) => b.id === OBJ.excalibur);
    if (banked && !armed()) {
        await q.bot.withdrawItem(banked, 1);
        await untilTicks(q.sdk, () => held(q, OBJ.excalibur) > 0, 6);
    }
    // Food for the Titan (142 hp, max hit ~15 on an unarmoured account) when the bank has it.
    const food = q.sdk.getBankItems().find((b) => FOOD.test(b.name));
    const eating = q.sdk.getInventory().filter((i) => FOOD.test(i.name)).length;
    if (food && eating < TITAN_FOOD) {
        await q.bot.withdrawItem(food, Math.min(TITAN_FOOD - eating, food.count));
        await q.sdk.waitForTicks(2);
    }
    await q.bot.closeBank().catch(() => undefined);
    // None banked: sharks are mule stock (lib/sources.ts) — NEEDS STOCK rather than a Titan fight
    // on hitpoints alone, which ran out at hp 22 with the Titan standing (2026-11-03).
    if (q.sdk.getInventory().filter((i) => FOOD.test(i.name)).length < 5) await q.ensure('shark', TITAN_FOOD);
    await q.bot.openBank().catch(() => undefined);
    // The Brimhaven fare and the Lady's price, while the bank is open.
    const coins = q.sdk.findBankItem(/^coins$/i);
    const want = (held(q, OBJ.excalibur) ? 0 : 500) + FARE * 2 + 20 - q.count('coins');
    if (coins && want > 0) await q.bot.withdrawItem(coins, Math.min(want, coins.count));
    await q.bot.closeBank().catch(() => undefined);
    if (armed()) return void q.log('grail: Excalibur in hand');
    await q.ensure('coins', 500 + FARE * 2);
    await q.talk(/^the lady of the lake$/i, [/i seek the sword excalibur/i], LADY);
    if (!held(q, OBJ.excalibur)) throw new Error('grail: the Lady of the Lake kept Excalibur');
    q.log('grail: Excalibur from the Lady of the Lake (500 coins)');
}

// ── the realm

/** To the six heads and through: needs a whistle. Lands in the dying or restored realm. */
async function enterRealm(q: Quest): Promise<void> {
    if (inRealm(pos(q))) return;
    if (q.count('coins') < FARE) await q.ensure('coins', FARE * 2);
    await toJungle(q, SIX_HEADS, 1);
    if (!inBox(pos(q), 2740, 2743, 3234, 3237)) {
        await q.bot.walkTo(SIX_HEADS.x, SIX_HEADS.z, 0).catch(() => undefined);
    }
    if (!(await useHeld(q, OBJ.whistle, () => inRealm(pos(q)), 10))) throw new Error(`grail: the whistle did nothing at ${where(q)}`);
    q.log(`grail: into the ${inDyingRealm(pos(q)) ? 'dying' : 'restored'} realm at ${where(q)}`);
}

/** Out of the realm by whistle, then off Karamja by the Brimhaven boat toward `dest`. */
export async function leaveGrail(q: Quest, dest: Tile): Promise<void> {
    if (inRealm(pos(q))) {
        if (pos(q).level !== 0) await q.climbTo(0);
        if (!held(q, OBJ.whistle)) throw new Error(`grail: in the realm at ${where(q)} with no whistle to leave by`);
        if (!(await useHeld(q, OBJ.whistle, () => !inRealm(pos(q)), 10))) throw new Error(`grail: the whistle did not take us out (at ${where(q)})`);
        q.log(`grail: out of the realm at ${where(q)}`);
    }
    if (onBrimhavenNorth(pos(q)) && !onBrimhavenNorth(dest) && !inRealm(dest)) await leaveJungle(q, dest);
}

/** Fight the Titan with Excalibur wielded until its death puts us past it. */
async function beatTitan(q: Quest): Promise<void> {
    // Past it already: west of its gap or anywhere near the castle.
    const past = () => pos(q).x <= TITAN.x - 1 || pos(q).level > 0;
    if (past()) return;
    const weapon = q.sdk.getInventory().find((i) => i.id === OBJ.excalibur);
    if (weapon) await q.bot.equipItem(weapon);
    if (!wearing(q, OBJ.excalibur)) throw new Error('grail: Excalibur is not wielded for the Titan');
    const since = cursor(q);
    const t0 = tickNow(q.sdk);
    while (!said(q, since, /defeated the black knight titan/i) && tickNow(q.sdk) - t0 < 600) {
        if (said(q, since, /something more to beat the titan/i)) throw new Error('grail: the Titan healed — Excalibur not counted');
        const hp = q.sdk.getSkill('hitpoints');
        if (hp && hp.level < hp.baseLevel * 0.5) {
            const food = q.sdk.getInventory().find((i) => i.optionsWithIndex?.some((o) => /^eat$/i.test(o.text)));
            if (food) await q.bot.eatFood(food).catch(() => undefined);
            else if (hp.level < 30) {
                // Out of the fight by whistle (the Titan never moves): a retry restocks at Draynor.
                await useHeld(q, OBJ.whistle, () => !inRealm(pos(q)), 10).catch(() => false);
                throw new Error(`grail: out of food against the Titan (hp ${hp.level}) — whistled out to ${where(q)}`);
            }
        }
        if (!q.sdk.getState()?.player?.combat?.inCombat) {
            const titan = q.sdk.findNearbyNpc(/^black knight titan$/i);
            if (!titan) {
                await q.goTo({ x: TITAN.x + 2, z: TITAN.z }, 2);
                continue;
            }
            const res = await q.bot.attack(titan);
            if (!res.success) q.log(`grail: attack the Titan: ${res.message}`);
        }
        await untilTicks(q.sdk, () => said(q, since, /defeated the black knight titan|something more/i) || !q.sdk.getState()?.player?.combat?.inCombat, 8);
    }
    if (!said(q, since, /defeated the black knight titan/i)) throw new Error(`grail: the Titan still stands after ${tickNow(q.sdk) - t0}t`);
    q.log(`grail: the Black Knight Titan fell in ${tickNow(q.sdk) - t0}t; at ${where(q)}`);
    await driveDialog(q.sdk, [], { ticks: 10 });
}

/** The fisherman's bell, rung by a maiden at the castle: inside. */
async function intoCastle(q: Quest): Promise<void> {
    const inside = () => pos(q).level > 0 || inBox(pos(q), 2755, 2770, 4680, 4693);
    if (inside()) return;
    if (!held(q, OBJ.bell)) {
        await q.talk(/^fisherman$/i, [/any idea how to get into the castle/i], FISHERMAN);
        await q.goTo(BELL_DROP, 2);
        await pickUp(q, OBJ.bell, BELL_DROP, 1, 'grail bell');
    }
    for (let attempt = 1; attempt <= 4 && !inside(); attempt++) {
        const maiden = q.sdk.findNearbyNpc(/^grail maiden$/i);
        if (!maiden || maiden.distance > 3) {
            await q.goTo(BELL_DROP, 2);
            const m = q.sdk.findNearbyNpc(/^grail maiden$/i);
            if (m) {
                await q.sdk.sendWalk(m.x, m.z + 1, true);
                await untilTicks(q.sdk, () => (q.sdk.findNearbyNpc(/^grail maiden$/i)?.distance ?? 9) <= 2, 8);
            }
        }
        await useHeld(q, OBJ.bell, inside, 10);
    }
    if (!inside()) throw new Error(`grail: the bell did not let us in (at ${where(q)})`);
    q.log(`grail: inside the Grail castle at ${where(q)}`);
}

/**
 * Open the doors nearest an npc until the client can route to it. The Fisher King's room on the
 * castle's first floor: walkTo went round by the battlements to a shut door and talkTo found "no
 * waypoints" (2026-11-03).
 */
async function reachNpc(q: Quest, npc: RegExp): Promise<void> {
    for (let i = 0; i < 5; i++) {
        await untilTicks(q.sdk, () => !!q.sdk.findNearbyNpc(npc), 5);
        const target = q.sdk.findNearbyNpc(npc);
        if (!target) throw new Error(`grail: no ${npc} in view from ${where(q)}`);
        if (target.reachable !== false) return;
        await q.sdk.scanNearbyLocs(12).catch(() => undefined);
        const door = (q.sdk.getNearbyLocs() ?? [])
            .filter((l) => /door/i.test(l.name) && l.optionsWithIndex.some((o) => /^open$/i.test(o.text)) && l.reachable !== false)
            .sort((a, b) => Math.hypot(a.x - target.x, a.z - target.z) - Math.hypot(b.x - target.x, b.z - target.z))[0];
        if (!door) throw new Error(`grail: ${target.name} is not reachable from ${where(q)} and no door opens toward it`);
        q.log(`grail: opening the door at (${door.x},${door.z}) toward ${target.name}`);
        await q.bot.openDoor(door).catch(() => undefined);
        await q.sdk.waitForTicks(2);
    }
}

/** The whole crone -> percival leg: napkin, whistles, Excalibur, Karamja, Titan, the Fisher King. */
export async function toFisherKing(q: Quest): Promise<void> {
    if (!inRealm(pos(q))) {
        await getWhistles(q, 2);
        await getExcalibur(q);
        await enterRealm(q);
    }
    if (inRestoredRealm(pos(q))) throw new Error('grail: in the restored realm before Percival — the journal says otherwise');
    await beatTitan(q);
    await intoCastle(q);
    // The stairs (spiral 2761,4680) are 12 tiles south of the bell's landing, past the hall doors:
    // out of climbTo's sight from there.
    // The hall doors between the bell's landing and the stairs: shut, the route is "5 tiles short" (ABGARMY05 ×2,
    // 2026-11-04). Open the nearest closed door and walk again.
    for (let attempt = 1; attempt <= 3 && pos(q).level === 0 && Math.hypot(pos(q).x - CASTLE_STAIRS_FOOT.x, pos(q).z - CASTLE_STAIRS_FOOT.z) > 2; attempt++) {
        const ok = await q.goTo(CASTLE_STAIRS_FOOT, 2).then(() => true).catch((e) => {
            q.log(`grail: to the castle stairs (attempt ${attempt}): ${(e as Error).message.slice(0, 120)}`);
            return false;
        });
        if (ok) break;
        await q.sdk.scanNearbyLocs(8).catch(() => undefined);
        const door = (q.sdk.getNearbyLocs() ?? [])
            .filter((l) => /door/i.test(l.name) && l.options.some((o) => /^open$/i.test(o)))
            .sort((a, b) => Math.hypot(a.x - pos(q).x, a.z - pos(q).z) - Math.hypot(b.x - pos(q).x, b.z - pos(q).z))[0];
        if (!door) break;
        q.log(`grail: opening ${door.name} at (${door.x},${door.z})`);
        await q.bot.openDoor(door).catch(() => undefined);
        await q.sdk.waitForTicks(2);
    }
    if (pos(q).level === 0) await q.climbTo(1, FISHER_KING);
    await reachNpc(q, /^the fisher king$/i);
    const seen = await q.talk(/^the fisher king$/i, [/you don'?t look too well/i]);
    if (!/percival/i.test(seen)) q.log(`grail: the Fisher King said: ${seen.slice(0, 200)}`);
}

/** Percival from the goblin village sacks; he takes a whistle (one stays for the trip back). */
export async function freePercival(q: Quest): Promise<void> {
    if (inGrailArea(pos(q))) await leaveGrail(q, SACKS);
    // A spare to give and one to travel on.
    if (held(q, OBJ.whistle) < 2) await getWhistles(q, 2);
    await q.goTo({ x: SACKS.x + 1, z: SACKS.z }, 2);
    const since = cursor(q);
    for (let attempt = 1; attempt <= 3; attempt++) {
        if (q.sdk.findNearbyNpc(/^sir percival$/i)) {
            await q.talk(/^sir percival$/i, [/your father wishes to speak to you/i]);
            return;
        }
        await q.sdk.scanNearbyLocs(5).catch(() => undefined);
        const sacks = (q.sdk.getNearbyLocs() ?? []).find((l) => l.x === SACKS.x && l.z === SACKS.z && /sacks/i.test(l.name));
        if (!sacks) throw new Error(`grail: no sacks at (${SACKS.x},${SACKS.z}) from ${where(q)}`);
        const res = await q.bot.interactLoc(sacks, /^open$/i);
        if (!res.success) q.log(`grail: open the sacks: ${res.message}`);
        await untilTicks(q.sdk, (s) => !!s.dialog?.isOpen, 10);
        if (q.sdk.getDialog()?.isOpen) {
            const seen = await driveDialog(q.sdk, [/your father wishes to speak to you/i], { ticks: 80, log: q.log });
            if (/see you there/i.test(seen) || said(q, since, /see you there/i)) return;
        }
    }
}

/** The restored realm: the Grail from the castle's top floor, then out. */
export async function fetchGrail(q: Quest): Promise<void> {
    if (!held(q, OBJ.grail)) {
        if (!held(q, OBJ.whistle)) await getWhistles(q, 1);
        if (!inRestoredRealm(pos(q))) {
            if (inDyingRealm(pos(q))) await leaveGrail(q, SIX_HEADS);
            await enterRealm(q);
        }
        // Spiral stairs (2648,4683) to L1, its ladder (2651,4684) to L2: climb from beside them.
        if (pos(q).level === 0) await q.goTo(RESTORED_STAIRS_FOOT, 2);
        if (pos(q).level < 2) await q.climbTo(2, GRAIL);
        await q.goTo(GRAIL, 2);
        await pickUp(q, OBJ.grail, GRAIL, 1, 'holy grail');
        q.log('grail: holding the Holy Grail');
    }
    await leaveGrail(q, ARTHUR);
}
