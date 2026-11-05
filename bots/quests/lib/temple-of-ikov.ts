/**
 * Temple of Ikov — Lucien's errand under Hemenster, finished the Armadyl way.
 *
 * Content facts (quest_ikov/scripts/*.rs2, general_use/scripts/web.rs2; placements m41/42_152..154); route
 * cross-checked with rs-stun-toolkit's q-temple-of-ikov.ts spec:
 *   - Lucien (2573,3321) in the Flying Horse Inn: "I'm a mighty hero!", "That sounds like a laugh!" -> his pendant
 *     (0 -> 10).
 *   - The cellar ladder (2677,3405) -> (2677,9804). Dark stairs (2651,9808) need a lit light (else the dark room);
 *     below, the Boots of lightness (2654,9767) behind a web (2654,9766): a knife slashes it. Stairs up (2638,9763).
 *   - The door of fear (2661-2662,9815) opens northward only with Lucien's pendant worn. The lava bridge
 *     (2648-2650,9828-9829) carries you only with total weight < 0 (the boots worn are -10 lb). The lever (2637,9819).
 *   - The lever on its bracket (2671,9804), pulled, opens the south gate (2661-2662,9803) from the north. Six chests
 *     beyond hide 1-5 ice arrows in one (re-rolled after each find).
 *   - Trap lever (2665,9855): Search (Thieving 42) disables it (-> 20), Pull (-> 30); its door (2648,9857) opens.
 *     The Fire Warrior's door (2646,9870) spawns him: only ice arrows from a bow of level 40+ hurt him (-> 40).
 *   - Winelda (2656,9875): "Yes I do!" (-> 50), again with 20 limpwurt roots: she teleports you over the lava
 *     (2664,9876) (-> 60). The secret door (2643,9892); a Guardian of Armadyl (Lucien's pendant OFF): "I seek the Staff
 *     of Armadyl.", "Lucien will give me a grand reward for it!", "You're right, it's time for my yearly bath.",
 *     "Ok! I'll help!" -> Armadyl pendant (-> 70). Lucien (3176,3476) in his house north of Varrock, killed wearing it.
 */
import type { Quest } from './run-quest';
import { driveDialog } from './dialog';
import { tickNow, untilTicks } from './ticks';

interface Tile {
    x: number;
    z: number;
    level?: number;
}

export const OBJ = { iceArrow: 78, lever: 83, pendantL: 86, pendantA: 87, boots: 88, litCandle: 33, knife: 946, root: 225 } as const;
const NPC = { lucien1: 273, lucien2: 272, winelda: 276, warrior: 277 };

export const LUCIEN = { x: 2573, z: 3321 };
const CELLAR_LADDER = { x: 2677, z: 3405 };
const STAIRS_DOWN = { x: 2651, z: 9808 };
const STAIRS_UP = { x: 2638, z: 9763 };
const WEB = { x: 2654, z: 9766 };
const BOOTS = { x: 2654, z: 9767 };
const FEAR_GATE = { x: 2661, z: 9815, id: 95 };
const SOUTH_GATE = { x: 2662, z: 9803, id: 89 };
const LEVER = { x: 2637, z: 9819 };
const BRACKET = { x: 2671, z: 9804 };
const TRAP_LEVER = { x: 2665, z: 9855 };
const TRAP_DOOR = { x: 2648, z: 9857 };
const FW_DOOR = { x: 2646, z: 9870 };
const WINELDA = { x: 2656, z: 9875 };
const SECRET_DOOR = { x: 2643, z: 9892 };
const LUCIEN_DOOR = { x: 3176, z: 3481 };
const LUCIEN2 = { x: 3176, z: 3476 };
const CHESTS: Tile[] = [{ x: 2710, z: 9850 }, { x: 2719, z: 9838 }, { x: 2729, z: 9850 }, { x: 2738, z: 9835 }, { x: 2747, z: 9848 }, { x: 2745, z: 9821 }];

const pos = (q: Quest) => {
    const p = q.sdk.getState()?.player;
    return { x: p?.worldX ?? 0, z: p?.worldZ ?? 0, level: p?.level ?? 0 };
};
const where = (q: Quest) => `(${pos(q).x},${pos(q).z},L${pos(q).level})`;
const inBox = (p: Tile, x0: number, x1: number, z0: number, z1: number) => p.x >= x0 && p.x <= x1 && p.z >= z0 && p.z <= z1;
export const held = (q: Quest, id: number) => q.sdk.getInventory().some((i) => i.id === id);
const worn = (q: Quest, id: number) => q.sdk.getEquipment().some((i) => i.id === id || (id === OBJ.boots && /boots of lightness/i.test(i.name)));
const inv = (q: Quest, id: number) => q.sdk.getInventory().find((i) => i.id === id);
const countOf = (q: Quest, id: number) => [...q.sdk.getInventory(), ...q.sdk.getEquipment()].filter((i) => i.id === id).reduce((n, i) => n + (i.count ?? 1), 0);

/** The temple's dungeon (both planes under Hemenster). */
export const inIkovDungeon = (p: Tile) => inBox(p, 2620, 2760, 9730, 9920);
const northSide = (p: Tile) => p.z >= 9815 && p.x < 2683;
const southSide = (p: Tile) => p.z <= 9802 || p.x >= 2683;

function cursor(q: Quest): number {
    return Math.max(0, ...(q.sdk.getState()?.gameMessages ?? []).map((m) => m.observationId ?? m.tick));
}
function said(q: Quest, since: number, text: RegExp): boolean {
    return (q.sdk.getState()?.gameMessages ?? []).some((m) => (m.observationId ?? m.tick) > since && text.test(m.text));
}

async function walk(q: Quest, t: Tile, tol = 1): Promise<void> {
    const r = await q.bot.walkTo(t.x, t.z, tol).catch((e) => ({ success: false, message: String(e) }));
    if (!r.success) q.log(`ikov: walk (${t.x},${t.z}): ${r.message}`);
}

/** A raw loc op (ids from the maps: several of these locs never reach the client's list). */
async function rawOp(q: Quest, x: number, z: number, id: number, op: number, done: () => boolean, label: string, choices: RegExp[] = [], tries = 4): Promise<void> {
    for (let attempt = 1; attempt <= tries && !done(); attempt++) {
        await q.sdk.sendInteractLoc(x, z, id, op);
        await untilTicks(q.sdk, (s) => done() || !!s.dialog?.isOpen, 20);
        if (q.sdk.getDialog()?.isOpen) await driveDialog(q.sdk, choices, { done, ticks: 60, log: q.log });
        await untilTicks(q.sdk, done, 6);
    }
    if (!done()) throw new Error(`ikov: ${label} failed at ${where(q)}`);
}

async function pickUp(q: Quest, id: number, at: Tile, label: string, ticks = 40): Promise<void> {
    const t0 = tickNow(q.sdk);
    const n0 = countOf(q, id);
    while (countOf(q, id) <= n0 && tickNow(q.sdk) - t0 < ticks) {
        await q.sdk.scanGroundItems(8).catch(() => undefined);
        const g = (q.sdk.getState()?.groundItems ?? []).filter((it) => it.id === id).sort((a, b) => Math.hypot(a.x - at.x, a.z - at.z) - Math.hypot(b.x - at.x, b.z - at.z))[0];
        if (!g) {
            await q.sdk.waitForTicks(3);
            continue;
        }
        await q.bot.pickupItem(g).catch(() => undefined);
        await untilTicks(q.sdk, () => countOf(q, id) > n0, 10);
    }
    if (countOf(q, id) <= n0) throw new Error(`ikov: no ${label} at (${at.x},${at.z})`);
}

async function wear(q: Quest, id: number): Promise<void> {
    const it = inv(q, id);
    if (!it) return;
    await q.bot.equipItem(it).catch(() => undefined);
    await untilTicks(q.sdk, () => worn(q, id), 4);
}
async function unwear(q: Quest, id: number): Promise<void> {
    for (let i = 0; i < 4; i++) {
        const it = q.sdk.getEquipment().find((e) => e.id === id);
        if (!it) return;
        await q.bot.unequipItem(it).catch(() => undefined);
        await q.sdk.waitForTicks(2);
    }
}

const hp = (q: Quest) => q.sdk.getSkill('hitpoints')?.level ?? 99;
async function eatIfLow(q: Quest, below = 50): Promise<void> {
    for (let i = 0; i < 3 && hp(q) < below; i++) {
        const food = q.sdk.getInventory().find((it) => /^(shark|lobster|swordfish|monkfish|tuna|bass)$/i.test(it.name));
        if (!food) return;
        await q.bot.eatFood(food).catch(() => undefined);
        await q.sdk.waitForTicks(2);
    }
}

async function gate(q: Quest, g: { x: number; z: number; id: number }, through: () => boolean, stand: Tile, label: string): Promise<void> {
    if (through()) return;
    for (let attempt = 1; attempt <= 4 && !through(); attempt++) {
        await walk(q, stand, 0);
        const since = cursor(q);
        await q.sdk.sendInteractLoc(g.x, g.z, g.id, 1);
        await untilTicks(q.sdk, (s) => through() || !!s.dialog?.isOpen, 15);
        if (q.sdk.getDialog()?.isOpen) await driveDialog(q.sdk, [], { ticks: 15, done: through });
        if (!through() && said(q, since, /terror overcomes|won't open/i)) throw new Error(`ikov: ${label}: refused`);
    }
    if (!through()) throw new Error(`ikov: ${label}: not through (at ${where(q)})`);
}

// ── 0 -> 10

/** Wear the bow so a full kit has a slot for what Lucien hands over (the pack is otherwise 28 exactly). */
async function freeASlot(q: Quest): Promise<void> {
    if (q.sdk.getInventory().length < 28) return;
    const bow = q.sdk.getInventory().find((i) => /(yew|magic) (short|long)bow$/i.test(i.name));
    if (bow) await q.bot.equipItem(bow).catch(() => undefined);
}

export async function start(q: Quest): Promise<void> {
    await freeASlot(q);
    await q.talk(/^lucien$/i, [/i'?m a mighty hero/i, /that sounds like a laugh/i], LUCIEN);
}

/**
 * Lucien's pendant (worn to open the door of fear). A full pack at the start talk left jacklove4 without
 * one, and the door refused (2026-11-04). lucien.rs2: any talk while none is held, worn or banked gives
 * another.
 */
async function ensurePendant(q: Quest): Promise<void> {
    if (held(q, OBJ.pendantL) || worn(q, OBJ.pendantL)) return;
    q.log('ikov: no pendant of Lucien — back to Lucien for another');
    if (inIkovDungeon(pos(q))) await leaveIkov(q);
    await freeASlot(q);
    await q.talk(/^lucien$/i, [], LUCIEN);
    await driveDialog(q.sdk, [], { ticks: 20, log: q.log });
    if (!held(q, OBJ.pendantL)) throw new Error('ikov: Lucien gave no pendant');
    await intoDungeon(q);
}

// ── 10 -> 40: boots, lever, arrows, trap, Fire Warrior

async function intoDungeon(q: Quest): Promise<void> {
    if (inIkovDungeon(pos(q))) return;
    await q.goTo({ x: CELLAR_LADDER.x, z: CELLAR_LADDER.z - 1 }, 1);
    await rawOp(q, CELLAR_LADDER.x, CELLAR_LADDER.z, 1754, 1, () => inIkovDungeon(pos(q)), 'the Hemenster cellar ladder');
}

async function boots(q: Quest): Promise<void> {
    if (countOf(q, OBJ.boots) || worn(q, OBJ.boots)) return;
    if (!held(q, OBJ.litCandle)) await q.ensure('lit candle', 1);
    if (!q.count('knife')) await q.ensure('knife', 1);
    await walk(q, { x: STAIRS_DOWN.x + 3, z: STAIRS_DOWN.z + 1 }, 1);
    await rawOp(q, STAIRS_DOWN.x, STAIRS_DOWN.z, 98, 1, () => pos(q).z < 9790, 'the dark stairs down');
    if (Math.hypot(pos(q).x - 2641, pos(q).z - 9764) > 4) throw new Error(`ikov: landed in the dark (no light?) at ${where(q)}`);
    // The web: a knife slashes it (50% a try).
    for (let attempt = 1; attempt <= 12; attempt++) {
        await q.sdk.scanNearbyLocs(6).catch(() => undefined);
        const web = (q.sdk.getNearbyLocs() ?? []).find((l) => /web/i.test(l.name) && Math.hypot(l.x - WEB.x, l.z - WEB.z) < 1);
        if (!web || !web.optionsWithIndex.some((o) => /slash/i.test(o.text))) break;
        const knife = q.sdk.getInventory().find((i) => /^knife$/i.test(i.name));
        if (knife) await q.bot.useItemOnLoc(knife, web).catch(() => undefined);
        await q.sdk.waitForTicks(4);
    }
    // The pack is full (20 roots, qlqcik4: "not enough space"): eat a shark for the boots' slot. The knife
    // stays: the web grows back in 100 ticks and a resumed run may find itself shut in with the boots.
    if (q.sdk.getInventory().length >= 28) {
        const food = q.sdk.getInventory().find((i) => /^shark$/i.test(i.name));
        if (food) await q.bot.eatFood(food).catch(() => undefined);
        await q.sdk.waitForTicks(2);
    }
    // One shared ground spawn: another account (Jackpoo5 alongside jacklove20, 2026-11-04) can take it; wait out a respawn.
    await pickUp(q, OBJ.boots, BOOTS, 'Boots of lightness', 300);
    await rawOp(q, STAIRS_UP.x, STAIRS_UP.z, 96, 1, () => pos(q).z > 9790, 'the dark stairs up');
    // The candle is done too (and weighs on the bridge).
    const candle = inv(q, OBJ.litCandle);
    if (candle) await q.sdk.sendDropItem(candle.slot).catch(() => undefined);
}

async function crossBridge(q: Quest, dir: 'west' | 'east'): Promise<void> {
    const onFar = () => (dir === 'west' ? pos(q).x <= 2647 && pos(q).z >= 9827 && pos(q).z <= 9830 : pos(q).x >= 2651 && pos(q).z >= 9827 && pos(q).z <= 9831);
    const from = dir === 'west' ? { x: 2651, z: 9829 } : { x: 2647, z: 9829 };
    const step = dir === 'west' ? { x: 2650, z: 9829 } : { x: 2648, z: 9829 };
    const since = cursor(q);
    for (let k = 0; k < 3 && !onFar(); k++) {
        await walk(q, from, 0);
        await q.sdk.sendWalk(step.x, step.z, true).catch(() => undefined);
        await untilTicks(q.sdk, onFar, 10);
        if (said(q, since, /bridge gives way/i)) throw new Error('ikov: the lava bridge gave way (weight must be below 0 with the boots on)');
    }
    if (!onFar()) throw new Error(`ikov: not over the bridge ${dir} (at ${where(q)})`);
}

async function leverPiece(q: Quest): Promise<void> {
    if (held(q, OBJ.lever)) return;
    await ensurePendant(q);
    await wear(q, OBJ.boots);
    await wear(q, OBJ.pendantL);
    await gate(q, FEAR_GATE, () => northSide(pos(q)), { x: 2661, z: 9814 }, 'the door of fear north');
    await crossBridge(q, 'west');
    await pickUp(q, OBJ.lever, LEVER, 'lever', 60);
    await crossBridge(q, 'east');
    await gate(q, FEAR_GATE, () => !northSide(pos(q)), { x: 2661, z: 9815 }, 'the door of fear south');
}

async function pullBracket(q: Quest): Promise<void> {
    await walk(q, { x: BRACKET.x, z: BRACKET.z + 1 }, 0);
    if (held(q, OBJ.lever)) {
        const it = inv(q, OBJ.lever)!;
        await q.sdk.sendUseItemOnLoc(it.slot, BRACKET.x, BRACKET.z, 86);
        await untilTicks(q.sdk, (s) => !!s.dialog?.isOpen || !held(q, OBJ.lever), 12);
        if (q.sdk.getDialog()?.isOpen) await driveDialog(q.sdk, [], { ticks: 10 });
    }
    // The mended lever (87) lasts 200 ticks.
    let pulled = false;
    for (let attempt = 1; attempt <= 4 && !pulled; attempt++) {
        await q.sdk.sendInteractLoc(BRACKET.x, BRACKET.z, 87, 1);
        await untilTicks(q.sdk, (s) => !!s.dialog?.isOpen, 10);
        const text = await driveDialog(q.sdk, [], { ticks: 15 });
        pulled = /clunking of some hidden machinery/i.test(text);
    }
    if (!pulled) q.log('ikov: no "clunking" seen after the lever pull; trying the south gate anyway');
}

async function iceArrows(q: Quest, want: number): Promise<void> {
    if (countOf(q, OBJ.iceArrow) >= want) return;
    await gate(q, SOUTH_GATE, () => southSide(pos(q)), { x: 2662, z: 9804 }, 'the south gate');
    const t0 = tickNow(q.sdk);
    let pending = new Set(CHESTS.map((_, i) => i));
    let cur = -1;
    while (countOf(q, OBJ.iceArrow) < want && tickNow(q.sdk) - t0 < 1200) {
        await eatIfLow(q);
        if (!pending.size) pending = new Set(CHESTS.map((_, i) => i));
        let pick = cur >= 0 && pending.has(cur) ? cur : -1;
        if (pick < 0) pick = [...pending].sort((a, b) => Math.hypot(CHESTS[a]!.x - pos(q).x, CHESTS[a]!.z - pos(q).z) - Math.hypot(CHESTS[b]!.x - pos(q).x, CHESTS[b]!.z - pos(q).z))[0]!;
        const c = CHESTS[pick]!;
        if (Math.hypot(pos(q).x - c.x, pos(q).z - c.z) > 2) await walk(q, c, 1);
        const n0 = countOf(q, OBJ.iceArrow);
        const since = cursor(q);
        // Open (closed chest 103), then Search the open one (104); either op is dropped when its id is not there.
        await q.sdk.sendInteractLoc(c.x, c.z, 103, 1);
        await q.sdk.waitForTicks(3);
        await q.sdk.sendInteractLoc(c.x, c.z, 104, 1);
        await untilTicks(q.sdk, (s) => countOf(q, OBJ.iceArrow) > n0 || said(q, since, /find nothing/i) || !!s.dialog?.isOpen, 10);
        if (q.sdk.getDialog()?.isOpen) await driveDialog(q.sdk, [], { ticks: 8 });
        cur = pick;
        if (countOf(q, OBJ.iceArrow) > n0) pending = new Set(CHESTS.map((_, i) => i));
        else if (said(q, since, /find nothing/i)) pending.delete(pick);
    }
    if (countOf(q, OBJ.iceArrow) < want) throw new Error(`ikov: only ${countOf(q, OBJ.iceArrow)} ice arrows from the chests`);
    q.log(`ikov: ${countOf(q, OBJ.iceArrow)} ice arrows (${tickNow(q.sdk) - t0}t)`);
    await gate(q, SOUTH_GATE, () => !southSide(pos(q)), { x: 2662, z: 9802 }, 'the south gate back');
}

/** The armed lever's pit (2682,9854): its ladder (2682,9849) climbs back to (2665,9849). */
const inTrapPit = (p: Tile) => inBox(p, 2674, 2690, 9845, 9862);
async function outOfTrapPit(q: Quest): Promise<void> {
    if (!inTrapPit(pos(q))) return;
    await walk(q, { x: 2682, z: 9850 }, 1);
    await rawOp(q, 2682, 9849, 101, 1, () => !inTrapPit(pos(q)), 'the trap pit ladder');
}

async function trapLever(q: Quest): Promise<void> {
    if (pos(q).z >= 9858) return;
    await outOfTrapPit(q);
    await gate(q, FEAR_GATE, () => northSide(pos(q)), { x: 2661, z: 9814 }, 'the door of fear north');
    await walk(q, TRAP_LEVER, 1);
    // Search first (a mesbox, not a game message): pulling an armed lever drops you in the pit (qlqcik2).
    let disabled = false;
    for (let attempt = 1; attempt <= 3 && !disabled; attempt++) {
        await q.sdk.sendInteractLoc(TRAP_LEVER.x, TRAP_LEVER.z, 91, 2);
        await untilTicks(q.sdk, (s) => !!s.dialog?.isOpen, 15);
        const text = await driveDialog(q.sdk, [], { ticks: 15 });
        disabled = /disable the trap/i.test(text);
        if (/find nothing/i.test(text)) break; // already past it (%ikov >= 40) or Thieving < 42
    }
    if (!disabled) q.log('ikov: the trap lever search found no trap (already disabled?)');
    for (let attempt = 1; attempt <= 4 && pos(q).z < 9858; attempt++) {
        await q.sdk.sendInteractLoc(TRAP_LEVER.x, TRAP_LEVER.z, 91, 1);
        await q.sdk.waitForTicks(4);
        await walk(q, { x: TRAP_DOOR.x, z: TRAP_DOOR.z }, 0);
        await q.sdk.sendInteractLoc(TRAP_DOOR.x, TRAP_DOOR.z, 92, 1);
        await untilTicks(q.sdk, () => pos(q).z >= 9858, 10);
    }
    if (pos(q).z < 9858) throw new Error(`ikov: the trap lever's door stayed shut (Thieving 42?) at ${where(q)}`);
}

async function fireWarrior(q: Quest): Promise<void> {
    const bow = q.sdk.getInventory().find((i) => /(yew|magic) (short|long)bow$/i.test(i.name));
    if (bow) await q.bot.equipItem(bow).catch(() => undefined);
    await wear(q, OBJ.iceArrow);
    const t0 = tickNow(q.sdk);
    let warrior = q.sdk.getNearbyNpcs().find((n) => n.id === NPC.warrior);
    if (!warrior) {
        await walk(q, { x: FW_DOOR.x, z: FW_DOOR.z - 1 }, 0);
        await q.sdk.sendInteractLoc(FW_DOOR.x, FW_DOOR.z, 93, 1);
        await untilTicks(q.sdk, () => q.sdk.getNearbyNpcs().some((n) => n.id === NPC.warrior) || pos(q).z >= 9871, 20);
        if (pos(q).z >= 9871) return; // already dead (%ikov >= 40): the door lets us through
        warrior = q.sdk.getNearbyNpcs().find((n) => n.id === NPC.warrior);
        if (!warrior) throw new Error('ikov: the Fire Warrior did not appear');
    }
    let lastNote = 0;
    while (tickNow(q.sdk) - t0 < 700) {
        await eatIfLow(q);
        if (q.sdk.getDialog()?.isOpen) await driveDialog(q.sdk, [], { ticks: 4 });
        const w = q.sdk.getNearbyNpcs().find((n) => n.id === NPC.warrior);
        if (!w) break;
        if (!q.sdk.getEquipment().some((e) => e.id === OBJ.iceArrow)) {
            if (held(q, OBJ.iceArrow)) await wear(q, OBJ.iceArrow);
            else await pickUp(q, OBJ.iceArrow, { x: w.x, z: w.z }, 'ice arrows under him', 20).then(() => wear(q, OBJ.iceArrow), () => undefined);
            if (!q.sdk.getEquipment().some((e) => e.id === OBJ.iceArrow)) throw new Error('ikov: out of ice arrows mid-fight');
        }
        const r = await q.bot.attack(w).catch((e) => ({ success: false, message: String(e) }));
        // Two prod timeouts (jacklove4, ABGARMY06, 2026-11-05) left no trace of why: log the fight.
        if (tickNow(q.sdk) - lastNote >= 100) {
            lastNote = tickNow(q.sdk);
            const me = q.sdk.getState()?.player;
            q.log(`ikov: fighting the Fire Warrior ${tickNow(q.sdk) - t0}t: attack ${r.success ? 'ok' : r.message}; him ${JSON.stringify({ hp: w.healthPercent, x: w.x, z: w.z, d: w.distance })} me (${me?.worldX},${me?.worldZ}) hp ${q.sdk.getSkill('Hitpoints')?.level} arrows ${countOf(q, OBJ.iceArrow)}`);
        }
        await q.sdk.waitForTicks(6);
    }
    if (q.sdk.getNearbyNpcs().some((n) => n.id === NPC.warrior)) throw new Error('ikov: the Fire Warrior fight timed out');
    q.log(`ikov: Fire Warrior dead (${tickNow(q.sdk) - t0}t)`);
}

export async function toFireWarrior(q: Quest): Promise<void> {
    // Free pack slots: the bow and Lucien's pendant are worn from the start.
    const bow = q.sdk.getInventory().find((i) => /(yew|magic) (short|long)bow$/i.test(i.name));
    if (bow) await q.bot.equipItem(bow).catch(() => undefined);
    // Lost (qlqcik4 came back without it): Lucien hands another to anyone holding none, banked included.
    if (!countOf(q, OBJ.pendantL) && !inIkovDungeon(pos(q))) await q.talk(/^lucien$/i, [], LUCIEN);
    await wear(q, OBJ.pendantL);
    await intoDungeon(q);
    if (pos(q).z < 9858) {
        await outOfTrapPit(q);
        await boots(q);
        await wear(q, OBJ.boots);
        await wear(q, OBJ.pendantL);
        // A resumed run holding its arrows is past the lever (the gate bit stays set).
        if (countOf(q, OBJ.iceArrow) < 10) {
            await leverPiece(q);
            await pullBracket(q);
            await iceArrows(q, 10);
        }
        await trapLever(q);
    }
    await fireWarrior(q);
}

// ── 40 -> 60 -> 70

/** A resumed run starts at the hub: boots and pendant on, down the cellar, past the trap lever. */
async function backIntoDungeon(q: Quest): Promise<void> {
    if (!inIkovDungeon(pos(q)) && !inExitRoom(pos(q))) {
        await wear(q, OBJ.boots);
        await wear(q, OBJ.pendantL);
        await intoDungeon(q);
    }
    if (inIkovDungeon(pos(q)) && pos(q).z < 9858) await trapLever(q);
}

export async function winelda(q: Quest): Promise<void> {
    // Resumed at "warrior"/"winelda" from the hub (Jackpoo5, jacklove20 walked for the Fire Warrior's
    // door from Ardougne and never met Winelda, 2026-11-04).
    await backIntoDungeon(q);
    for (let attempt = 1; attempt <= 4 && pos(q).z < 9871; attempt++) {
        await walk(q, { x: FW_DOOR.x, z: FW_DOOR.z - 1 }, 0);
        await q.sdk.sendInteractLoc(FW_DOOR.x, FW_DOOR.z, 93, 1);
        await untilTicks(q.sdk, () => pos(q).z >= 9871, 12);
    }
    const landed = () => Math.hypot(pos(q).x - 2664, pos(q).z - 9876) <= 3;
    await q.talk(/^winelda$/i, [/^yes i do!?$/i]);
    if (!landed()) await q.talk(/^winelda$/i, [/^yes i do!?$/i]);
    await untilTicks(q.sdk, landed, 10);
    if (!landed()) throw new Error(`ikov: Winelda did not teleport us (roots: ${q.count('limpwurt root')})`);
}

export async function guardian(q: Quest): Promise<void> {
    // A resumed run at "paid" starts at the hub (ABGARMY17 walked for the secret door from Ardougne,
    // 2026-11-04): back down the cellar, through the Fire Warrior's door and across the lava with Winelda.
    await backIntoDungeon(q);
    if (inIkovDungeon(pos(q)) && pos(q).z < 9871) await winelda(q);
    await unwear(q, OBJ.pendantL);
    if (pos(q).z < 9893) {
        await walk(q, SECRET_DOOR, 1);
        await rawOp(q, SECRET_DOOR.x, SECRET_DOOR.z, 1586, 1, () => pos(q).z >= 9893, 'the secret door');
    }
    // The guardian's dialog sometimes does not open on the first Talk-to (ABGARMY17 threw here after
    // one miss, 2026-11-04): a few tries, closing any half-open page between them.
    for (let attempt = 1; attempt <= 4 && !held(q, OBJ.pendantA); attempt++) {
        await q.talk(/^guardian of armadyl$/i, [/i seek the staff of armadyl/i, /lucien will give me a grand reward/i, /it'?s time for my yearly bath/i, /ok! i'?ll help/i]).catch((e) => q.log(`ikov: guardian talk ${attempt}: ${(e as Error).message}`));
        if (held(q, OBJ.pendantA)) break;
        if (q.sdk.getDialog()?.isOpen) await driveDialog(q.sdk, [/i seek the staff of armadyl/i, /lucien will give me a grand reward/i, /it'?s time for my yearly bath/i, /ok! i'?ll help/i], { ticks: 20, log: q.log });
        await untilTicks(q.sdk, () => held(q, OBJ.pendantA), 3);
    }
    if (!held(q, OBJ.pendantA)) throw new Error('ikov: no Armadyl pendant');
}

// ── 70 -> complete

export async function killLucien(q: Quest, done: () => Promise<boolean>): Promise<void> {
    await wear(q, OBJ.pendantA);
    // A bow with an empty quiver refuses every attack ("no ammo left", qlqcik5): fists or a melee weapon.
    for (const eq of q.sdk.getEquipment()) if (/bow$|arrow/i.test(eq.name)) await q.bot.unequipItem(eq).catch(() => undefined);
    const melee = q.sdk.getInventory().find((i) => /scimitar|sword|whip|battleaxe|mace|dagger/i.test(i.name));
    if (melee) await q.bot.equipItem(melee).catch(() => undefined);
    await q.goTo({ x: LUCIEN_DOOR.x, z: LUCIEN_DOOR.z + 1 }, 2);
    await rawOp(q, LUCIEN_DOOR.x, LUCIEN_DOOR.z, 102, 1, () => pos(q).z <= 3480, 'Lucien\'s door').catch((e) => q.log(`ikov: ${(e as Error).message}`));
    const t0 = tickNow(q.sdk);
    while (!(await done()) && tickNow(q.sdk) - t0 < 400) {
        await eatIfLow(q);
        if (q.sdk.getDialog()?.isOpen) await driveDialog(q.sdk, [], { ticks: 6 });
        const l = q.sdk.getNearbyNpcs().find((n) => n.id === NPC.lucien2);
        if (!l) {
            await walk(q, LUCIEN2, 3);
            continue;
        }
        await q.bot.attack(l).catch(() => undefined);
        await untilTicks(q.sdk, () => !q.sdk.getNearbyNpcs().some((n) => n.id === NPC.lucien2), 20);
    }
}

/** The locked cellar room above the temple's ladder (shiny-key door 2657,3496). */
const inExitRoom = (p: Tile) => (p.level ?? 0) === 0 && inBox(p, 2653, 2661, 3489, 3495);

/** Camelot (45: 1 law, 5 air), Falador (37: 1 law, 3 air, 1 water) or Lumbridge (31: 1 law, 3 air, 1 earth). */
async function teleportOut(q: Quest): Promise<boolean> {
    const magic = q.sdk.getSkill('magic')?.baseLevel ?? 1;
    const spells = [
        { id: 1174, ok: magic >= 45 && q.count('law rune') >= 1 && q.count('air rune') >= 5 },
        { id: 1170, ok: magic >= 37 && q.count('law rune') >= 1 && q.count('air rune') >= 3 && q.count('water rune') >= 1 },
        { id: 1167, ok: magic >= 31 && q.count('law rune') >= 1 && q.count('air rune') >= 3 && q.count('earth rune') >= 1 },
    ].filter((s) => s.ok);
    const from = pos(q);
    for (const s of spells) {
        for (let attempt = 1; attempt <= 3; attempt++) {
            await q.sdk.sendSetTab(6).catch(() => undefined);
            await q.sdk.waitForTicks(1);
            await q.sdk.sendClickComponent(s.id);
            if (await untilTicks(q.sdk, () => Math.hypot(pos(q).x - from.x, pos(q).z - from.z) > 30, 8)) {
                q.log(`ikov: teleported out to ${where(q)}`);
                return true;
            }
        }
    }
    q.log(`ikov: no teleport runes to leave the temple (law ${q.count('law rune')}, air ${q.count('air rune')})`);
    return false;
}

export const inIkovArea = (p: Tile) => inIkovDungeon(p) || inExitRoom(p);

export async function leaveIkov(q: Quest): Promise<void> {
    if (inExitRoom(pos(q))) {
        await teleportOut(q);
        return;
    }
    if (!inIkovDungeon(pos(q))) return;
    if (q.sdk.getDialog()?.isOpen) await driveDialog(q.sdk, [], { ticks: 10 });
    // Past the lava there is no walk back: the ladder by the temple (2659,9892) climbs into a room shut by the
    // shiny-key door (2657,3496; qlqcik3 stuck there). Teleport out instead (rs-stun-toolkit uses a glory).
    if ((inIkovDungeon(pos(q)) && pos(q).z >= 9870) || inExitRoom(pos(q))) {
        if (await teleportOut(q)) return;
    }
    // The guardians' temple: back through the secret door, then the ladder up beside it (2659,9892).
    if (pos(q).z >= 9893 && pos(q).x < 2655) {
        // "Push" opens the wall for a few ticks; walk through while it is open (qlqcik3 pushed and stayed put).
        for (let attempt = 1; attempt <= 4 && pos(q).z >= 9893; attempt++) {
            await walk(q, { x: SECRET_DOOR.x, z: SECRET_DOOR.z + 1 }, 0);
            await q.sdk.sendInteractLoc(SECRET_DOOR.x, SECRET_DOOR.z, 1586, 1);
            await q.sdk.waitForTicks(3);
            await q.sdk.sendWalk(SECRET_DOOR.x, SECRET_DOOR.z - 2, true).catch(() => undefined);
            await untilTicks(q.sdk, () => pos(q).z <= 9891, 8);
        }
        if (pos(q).z >= 9893) q.log(`ikov: still north of the secret door at ${where(q)}`);
    }
    if (pos(q).z >= 9870 && pos(q).z <= 9892) {
        await walk(q, { x: 2658, z: 9892 }, 1);
        await rawOp(q, 2659, 9892, 1755, 1, () => !inIkovDungeon(pos(q)), 'the ladder up by the temple').catch((e) => q.log(`ikov: ${(e as Error).message}`));
    }
    if (!inIkovDungeon(pos(q))) return;
    // Past the lava (Winelda's side) or beyond the trap door: a ladder up beside the guardians, else back to the cellar.
    await q.sdk.scanNearbyLocs(25).catch(() => undefined);
    const ladder = (q.sdk.getNearbyLocs() ?? []).filter((l) => /ladder/i.test(l.name) && l.optionsWithIndex.some((o) => /climb-up/i.test(o.text)) && l.reachable !== false).sort((a, b) => (a.distance ?? 99) - (b.distance ?? 99))[0];
    if (ladder) {
        await q.bot.interactLoc(ladder, /climb-up/i).catch(() => undefined);
        await untilTicks(q.sdk, () => !inIkovDungeon(pos(q)), 20);
    }
    if (inIkovDungeon(pos(q)) && pos(q).z <= 9790) {
        // Shut in with the boots by the regrown web: slash it again.
        if (pos(q).z >= WEB.z + 1 && Math.abs(pos(q).x - WEB.x) <= 2) {
            if (!q.sdk.getInventory().some((it) => /^knife$/i.test(it.name))) await pickUp(q, OBJ.knife, WEB, 'knife', 10).catch(() => undefined);
            for (let i = 0; i < 8; i++) {
                await q.sdk.scanNearbyLocs(4).catch(() => undefined);
                const web = (q.sdk.getNearbyLocs() ?? []).find((l) => /web/i.test(l.name) && Math.hypot(l.x - WEB.x, l.z - WEB.z) < 1 && l.optionsWithIndex.some((o) => /slash/i.test(o.text)));
                const knife = q.sdk.getInventory().find((it) => /^knife$/i.test(it.name));
                if (!web || !knife) break;
                await q.bot.useItemOnLoc(knife, web).catch(() => undefined);
                await q.sdk.waitForTicks(4);
            }
        }
        await walk(q, { x: STAIRS_UP.x + 1, z: STAIRS_UP.z }, 1);
        await rawOp(q, STAIRS_UP.x, STAIRS_UP.z, 96, 1, () => pos(q).z > 9790, 'the dark stairs up').catch(() => undefined);
    }
    if (inIkovDungeon(pos(q)) && northSide(pos(q))) await gate(q, FEAR_GATE, () => !northSide(pos(q)), { x: 2661, z: 9815 }, 'the door of fear south').catch(() => undefined);
    if (inIkovDungeon(pos(q)) && southSide(pos(q)) && pos(q).z <= 9802) await gate(q, SOUTH_GATE, () => !southSide(pos(q)), { x: 2662, z: 9802 }, 'the south gate back').catch(() => undefined);
    if (inIkovDungeon(pos(q))) {
        await walk(q, { x: 2677, z: 9806 }, 1);
        await rawOp(q, 2677, 9805, 1755, 1, () => !inIkovDungeon(pos(q)), 'the cellar ladder up');
    }
}
