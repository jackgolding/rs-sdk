/**
 * Lost City — the leprechaun, Entrana and its dungeon, the Dramen tree.
 *
 * Map/content facts (quest_zanaris/*.rs2, area_entrana/*.rs2, maps m49_50,
 * m44_52, m44_152, m50_49, m50_149):
 *   - Shamus hides in the leprechauntree (3138,3212): chopping it (any axe)
 *     npc_adds him beside it
 *   - the Port Sarim monks (monk_of_entrana.rs2) refuse anyone carrying or
 *     wearing a weapon (axes included) or armour; runes, food and a knife pass
 *   - Entrana's dungeon ladder (2820,3374) goes through the cave monk's warning
 *     ("Well that is a risk I will have to take.") and drains 95% prayer; the only
 *     way out on foot is the Magic door (2874,9750) into level-32 Wilderness
 *   - the Dramen tree (2860,9734) needs an axe, which cannot be brought: the
 *     dungeon's zombies drop bronze axes. Chopping it at spoken_shamus spawns the
 *     tree spirit (level 101); once it is dead the tree gives a branch
 *   - a knife on the branch makes the staff (Crafting 31); the shed door
 *     (3202,3169, west edge) entered from outside with the staff WORN teleports
 *     into Zanaris and completes the quest; Zanaris' ladder (3222,9588) leads out
 */
import type { Quest } from './run-quest';
import { depositAllInventory } from '../quest-supplies';
import { SAFE_BANKS } from '../safe-stops';
import { driveDialog } from './dialog';
import { tickNow, ticksToMs, untilTicks } from './ticks';

interface Tile {
    x: number;
    z: number;
}

export const WARRIOR_CAMP = { x: 3145, z: 3202 };

/**
 * Melee or Wind Bolt for the tree spirit (level 101, defence 80, 85 hp, strength 95). Melee with
 * the dungeon's bronze axe needs a strong account: at Strength 37 / HP 52 25 sharks were gone
 * after two hits (fast gate, 2026-11-01). Weaker accounts cast Wind Bolt (2 air, 1 chaos), which
 * the fleet holds by the hundred thousand, instead of Fire Bolt's scarce fire runes.
 */
export function meleeSpirit(q: Quest): boolean {
    const lvl = (s: string) => q.sdk.getSkill(s)?.baseLevel ?? 1;
    return lvl('Attack') >= 70 && lvl('Strength') >= 70 && lvl('Hitpoints') >= 70;
}
const LEPRECHAUN_TREE = { x: 3138, z: 3212 };
const PORT_SARIM_MONK = { x: 3045, z: 3236 };
const ENTRANA_LADDER = { x: 2820, z: 3374 };
const ZOMBIES = { x: 2842, z: 9766 };
const DRAMEN_TREE = { x: 2860, z: 9734 };
const SHED_OUTSIDE = { x: 3201, z: 3169 };
const SHED_DOOR = { x: 3202, z: 3169 };

/** Spellbook component ids (sdk/spells.ts Spells.WIND_BOLT / LUMBRIDGE_TELEPORT). */
const WIND_BOLT = 1160;
const LUMBRIDGE_TELEPORT = 1167;
const MAGIC_TAB = 6;

const pos = (q: Quest) => {
    const p = q.sdk.getState()?.player;
    return { x: p?.worldX ?? 0, z: p?.worldZ ?? 0, level: p?.level ?? 0 };
};
const where = (q: Quest) => `(${pos(q).x},${pos(q).z})`;
/** Map square 44,151-152 (x 2816-2879). Taverley dungeon starts at x 2880: the old 2890 bound took a
 * Druidic Ritual run at the cauldron (2885,9797) for the Entrana dungeon and tried to teleport out. */
export const inDungeon = (q: Quest) => pos(q).z > 9700 && pos(q).z < 9800 && pos(q).x >= 2816 && pos(q).x <= 2879;
const onEntrana = (q: Quest) => pos(q).x >= 2800 && pos(q).x <= 2880 && pos(q).z >= 3320 && pos(q).z <= 3400;

/** Op on the loc named `name` near `at` (nearest such loc to it) until `done`, driving dialogs with `choices`. */
async function op(q: Quest, at: Tile, name: RegExp, opt: RegExp, done: () => boolean, label: string, choices: RegExp[] = []): Promise<void> {
    for (let attempt = 1; attempt <= 4; attempt++) {
        if (done()) return;
        if (q.sdk.getDialog()?.isOpen) await driveDialog(q.sdk, choices, { done, ticks: 80, log: q.log });
        if (done()) return;
        await q.sdk.scanNearbyLocs(12).catch(() => undefined);
        const loc = (q.sdk.getNearbyLocs() ?? [])
            .filter((l) => name.test(l.name) && l.optionsWithIndex.some((o) => opt.test(o.text)))
            .sort((a, b) => Math.hypot(a.x - at.x, a.z - at.z) - Math.hypot(b.x - at.x, b.z - at.z))[0];
        if (!loc || Math.hypot(loc.x - at.x, loc.z - at.z) > 3) {
            q.log(`lostcity: ${label}: no ${name} with ${opt} near (${at.x},${at.z}) from ${where(q)} (attempt ${attempt})`);
            await q.sdk.waitForTicks(3);
            continue;
        }
        await q.sdk.sendInteractLoc(loc.x, loc.z, loc.id, loc.optionsWithIndex.find((o) => opt.test(o.text))!.opIndex);
        await untilTicks(q.sdk, (s) => done() || !!s.dialog?.isOpen, 30);
        if (q.sdk.getDialog()?.isOpen) await driveDialog(q.sdk, choices, { done, ticks: 80, log: q.log });
        if (await untilTicks(q.sdk, done, 8)) return;
        q.log(`lostcity: ${label} did not take from ${where(q)} (attempt ${attempt})`);
    }
    throw new Error(`lostcity: ${label} failed at ${where(q)}`);
}

/** Chop the leprechaun's tree so Shamus comes out, then talk to him. */
export async function talkShamus(q: Quest): Promise<void> {
    const shamus = () => !!q.sdk.findNearbyNpc(/^shamus$/i);
    if (!shamus()) {
        await q.goTo(LEPRECHAUN_TREE, 3);
        await op(q, LEPRECHAUN_TREE, /^tree$/i, /^chop$/i, shamus, 'chop the leprechaun tree');
    }
    await q.talk(/^shamus$/i, [/how does it fit in a shed/i]);
}

/**
 * Off to Entrana: bank everything the monks would refuse (keep runes, food,
 * coins and the knife), sail from Port Sarim, down the dungeon ladder.
 */
export async function toDungeon(q: Quest): Promise<void> {
    if (inDungeon(q)) return;
    if (!onEntrana(q)) {
        await q.goTo(SAFE_BANKS.draynor, 4);
        // The monks refuse anyone wearing weapons or armour: everything worn comes off first
        // (jackquests wore its melee training gear to the boat, 2026-11-02).
        for (const worn of q.sdk.getEquipment().filter(Boolean)) await q.bot.unequipItem(worn!).catch(() => undefined);
        await depositAllInventory(q.supply, [/rune$/i, /^shark$/i, /^coins$/i, /^knife$/i]);
        await q.bot.closeBank().catch(() => undefined);
        await q.talk(/^monk of entrana$/i, [/yes,? okay,? i'?m ready to go/i], PORT_SARIM_MONK);
        // Measured from the monk, not Draynor: the walk there is itself >40 tiles, which read as
        // "sailed" and sent jackquests across the sea from Port Sarim (2026-11-02).
        const before = pos(q);
        const sailed = () => onEntrana(q) || pos(q).level > 0 || Math.hypot(pos(q).x - before.x, pos(q).z - before.z) > 40;
        if (!(await untilTicks(q.sdk, sailed, 40))) {
            throw new Error(`lostcity: the monks did not sail us (at ${where(q)}; carrying ${q.sdk.getInventory().map((i) => i.name).join(', ')})`);
        }
        await driveDialog(q.sdk, [], { ticks: 20, log: q.log });
        if (pos(q).level > 0) {
            // Landed on the ship's deck: over the gangplank.
            await q.sdk.scanNearbyLocs(10).catch(() => undefined);
            const plank = q.sdk.findNearbyLoc(/gangplank/i);
            if (plank) await q.bot.interactLoc(plank, /cross/i);
            await untilTicks(q.sdk, () => pos(q).level === 0, 15);
        }
        if (!onEntrana(q)) throw new Error(`lostcity: not on Entrana after the boat (at ${where(q)})`);
        q.log(`lostcity: on Entrana at ${where(q)}`);
    }
    // The ladder is one-way: without Lumbridge Teleport's runes the only way out is dying
    // (jacklove6 and jacklove18 went down with a law rune and nothing else, 2026-10-29).
    const short = [['law rune', 1], ['air rune', 3], ['earth rune', 1]].filter(([r, n]) => q.count(r as string) < (n as number));
    if (short.length) throw new Error(`lostcity: not climbing down without Lumbridge Teleport runes (short ${short.map(([r]) => r).join(', ')})`);
    await q.goTo({ x: ENTRANA_LADDER.x + 1, z: ENTRANA_LADDER.z + 1 }, 2);
    await op(q, ENTRANA_LADDER, /^ladder$/i, /climb-down/i, () => inDungeon(q), 'Entrana dungeon ladder', [/risk i will have to take/i]);
}

/** Bronze axes drop from the dungeon's zombies; nothing heavier may be brought to Entrana. */
async function bronzeAxe(q: Quest): Promise<void> {
    const have = () => q.count(/^bronze axe$/i) > 0;
    if (have()) return;
    const t0 = tickNow(q.sdk);
    let kills = 0;
    while (!have() && tickNow(q.sdk) - t0 < 1500) {
        // Unarmed against aggressive zombies: a jackquests-stats run (Strength 37) died here with
        // 3 sharks uneaten, the loop never ate (2026-11-01).
        await eatIfLow(q);
        const drop = q.sdk.findGroundItem(/^bronze axe$/i, { reachable: true });
        if (drop) {
            await q.bot.pickupItem(drop);
            await untilTicks(q.sdk, have, 8);
            continue;
        }
        const zombie = (q.sdk.getNearbyNpcs() ?? [])
            .filter((n) => /^zombie$/i.test(n.name) && n.reachable !== false && (!n.inCombat || n.targetIndex === -1))
            .sort((a, b) => a.distance - b.distance)[0];
        if (!zombie) {
            if (Math.hypot(pos(q).x - ZOMBIES.x, pos(q).z - ZOMBIES.z) > 6) await q.bot.walkTo(ZOMBIES.x, ZOMBIES.z, 3);
            await q.sdk.waitForTicks(4);
            continue;
        }
        const res = await q.bot.attack(zombie, ticksToMs(15));
        if (res.success) {
            kills++;
            for (let t = 0; t < 30; t++) {
                await eatIfLow(q);
                if (await untilTicks(q.sdk, (s) => !!q.sdk.findGroundItem(/^bronze axe$/i) || !(s.nearbyNpcs ?? []).some((n) => n.index === zombie.index && (n.hp ?? 1) > 0), 2)) break;
            }
            await q.sdk.waitForTicks(2);
        }
    }
    q.log(`lostcity: bronze axe ${have() ? 'found' : 'NOT found'} after ${kills} zombies (${tickNow(q.sdk) - t0}t)`);
    if (!have()) throw new Error('lostcity: no bronze axe from the zombies');
}

/** Topped up whenever a shark's 20 fits: the spirit (strength 95) and a zombie can land together. */
async function eatToFull(q: Quest): Promise<void> {
    const p = q.sdk.getState()?.player;
    if (!p || p.hp > (p.maxHp ?? 10) - 22) return;
    const food = q.sdk.findInventoryItem(/^shark$/i);
    if (food) await q.bot.eatFood(food).catch(() => undefined);
}

async function eatIfLow(q: Quest): Promise<void> {
    const p = q.sdk.getState()?.player;
    // The spirit (strength 95) can hit ~20: a low-HP account eats well above half.
    if (!p || p.hp > Math.max((p.maxHp ?? 10) * 0.5, 25)) return;
    const food = q.sdk.findInventoryItem(/^shark$/i);
    if (food) await q.bot.eatFood(food).catch(() => undefined);
}

/**
 * Chop the Dramen tree; at spoken_shamus that brings out the tree spirit, killed here in melee
 * with the zombies' bronze axe wielded, or with Wind Bolt (meleeSpirit): tree_spirit.rs2 only
 * checks the kill.
 * Runes were the bottleneck: Fire Bolt's 120 fire runes stalled two accounts for an hour (user,
 * 2026-11-01: "doable just with 20 sharks and a bronze hatchet").
 */
export async function spiritAndBranch(q: Quest, branch: boolean): Promise<void> {
    await bronzeAxe(q);
    const melee = meleeSpirit(q);
    q.log(`lostcity: tree spirit by ${melee ? 'melee (bronze axe)' : 'Wind Bolt'}`);
    const axe = q.sdk.findInventoryItem(/^bronze axe$/i);
    if (axe && melee) {
        await q.bot.equipItem(axe).catch(() => undefined);
        await untilTicks(q.sdk, () => q.sdk.getEquipment().some((i) => /^bronze axe$/i.test(i.name)), 5);
    }
    await q.bot.walkTo(DRAMEN_TREE.x, DRAMEN_TREE.z + 2, 2);
    const t0 = tickNow(q.sdk);
    let attacks = 0;
    for (let round = 0; round < 6 && tickNow(q.sdk) - t0 < 2000; round++) {
        if (branch && q.count('dramen branch') > 0) return;
        const spirit = () => (q.sdk.getNearbyNpcs() ?? []).find((n) => /^tree spirit$/i.test(n.name) && (n.hp ?? 1) > 0);
        if (!spirit()) {
            await q.sdk.scanNearbyLocs(8).catch(() => undefined);
            const tree = q.sdk.findNearbyLoc(/^dramen tree$/i, { withOption: /chop/i });
            if (!tree) throw new Error(`lostcity: no Dramen tree from ${where(q)}`);
            const before = q.count('dramen branch');
            await q.sdk.sendInteractLoc(tree.x, tree.z, tree.id, tree.optionsWithIndex.find((o) => /chop/i.test(o.text))!.opIndex);
            await untilTicks(q.sdk, () => !!spirit() || q.count('dramen branch') > before || !!q.sdk.getDialog()?.isOpen, 20);
            await driveDialog(q.sdk, [], { ticks: 20, log: q.log });
            if (!spirit()) {
                // No spirit and no branch: the stage has moved on (spirit dead) or the chop was refused.
                if (!branch) return;
                continue;
            }
        }
        while (spirit() && tickNow(q.sdk) - t0 < 2000) {
            await eatToFull(q);
            const s = spirit();
            if (!s) break;
            if (q.count(/^shark$/i) === 0 && (q.sdk.getState()?.player?.hp ?? 99) < (q.sdk.getState()?.player?.maxHp ?? 99) * 0.4) {
                await teleportOut(q);
                throw new Error(`lostcity: out of food against the tree spirit after ${attacks} attacks; teleported out`);
            }
            if (!melee) {
                // A bolt (2 air, 1 chaos) only while Lumbridge Teleport's 3 air stay behind.
                if (q.count('air rune') < 5 || q.count('chaos rune') < 1) {
                    await teleportOut(q);
                    throw new Error(`lostcity: out of Wind Bolt runes after ${attacks} casts; teleported out`);
                }
                const res = await q.bot.castSpell(s, WIND_BOLT, ticksToMs(8));
                attacks++;
                if (!res.success) {
                    q.log(`lostcity: wind bolt #${attacks}: ${res.message}`);
                    await q.sdk.waitForTicks(2);
                }
                continue;
            }
            const p = q.sdk.getState()?.player;
            if (!(p?.combat?.inCombat && p.combat.targetType === 'npc')) {
                const op = s.optionsWithIndex.find((o) => /attack/i.test(o.text));
                if (op) {
                    await q.sdk.sendInteractNpc(s.index, op.opIndex);
                    attacks++;
                }
            }
            await q.sdk.waitForTicks(2);
        }
        await driveDialog(q.sdk, [], { ticks: 20, log: q.log });
        q.log(`lostcity: tree spirit gone after ${attacks} attacks (${tickNow(q.sdk) - t0}t, hp ${q.sdk.getState()?.player?.hp}, sharks ${q.count(/^shark$/i)})`);
        if (!branch) return;
    }
}

/** cut_dramenstaff: knife on the branch. */
export async function carveStaff(q: Quest): Promise<void> {
    const knife = q.sdk.findInventoryItem(/^knife$/i);
    const branch = q.sdk.findInventoryItem(/^dramen branch$/i);
    if (!knife || !branch) throw new Error(`lostcity: carve needs a knife (${!!knife}) and a branch (${!!branch})`);
    await q.sdk.sendUseItemOnItem(knife.slot, branch.slot);
    if (!(await untilTicks(q.sdk, () => q.count('dramen staff') > 0, 10))) throw new Error('lostcity: the branch did not become a staff');
}

/** Lumbridge Teleport out of the dungeon (it is one-way: the ladder up does not exist). */
export async function teleportOut(q: Quest): Promise<void> {
    if (!inDungeon(q) && !onEntrana(q)) return;
    const out = () => !inDungeon(q) && !onEntrana(q);
    for (let attempt = 1; attempt <= 3 && !out(); attempt++) {
        await driveDialog(q.sdk, [], { ticks: 10, log: q.log });
        // The spell button only takes once the magic tab is open (one click was dropped, 2026-10-29).
        await q.sdk.sendSetTab(MAGIC_TAB).catch(() => undefined);
        await q.sdk.waitForTicks(1);
        await q.sdk.sendClickComponent(LUMBRIDGE_TELEPORT);
        if (await untilTicks(q.sdk, out, 12)) break;
        q.log(`lostcity: Lumbridge Teleport attempt ${attempt} did not take (at ${where(q)}; runes air ${q.count('air rune')} earth ${q.count('earth rune')} law ${q.count('law rune')})`);
    }
    if (!out()) throw new Error(`lostcity: Lumbridge Teleport did not take (at ${where(q)})`);
    await q.sdk.waitForTicks(3);
}

/** Staff worn, through the shed door from outside: Zanaris, quest complete. */
export async function enterZanaris(q: Quest): Promise<void> {
    await teleportOut(q);
    const inZanaris = () => pos(q).z > 9000;
    // The staff goes on at the door: worn on the walk there, walkTo opened the shed
    // door on its own and was teleported into Zanaris mid-walk (2026-10-29).
    await q.goTo(SHED_OUTSIDE, 0).catch((e) => {
        if (!inZanaris()) throw e;
    });
    if (inZanaris()) return;
    const staff = q.sdk.findInventoryItem(/^dramen staff$/i);
    if (staff) {
        await q.bot.equipItem(staff);
        await untilTicks(q.sdk, () => q.sdk.getEquipment().some((i) => /^dramen staff$/i.test(i.name)), 5);
    }
    await op(q, SHED_DOOR, /^door$/i, /^open$/i, inZanaris, 'shed door');
    await q.sdk.waitForTicks(3);
}

/**
 * A new Dramen staff for an account past the spirit (staff_made, or tree_chopped)
 * that lost its staff or branch: Entrana, a zombie's bronze axe, a branch off the
 * tree (no spirit once it is dead), the knife, and Lumbridge Teleport back.
 * jacklove6 sat at staff_made with no staff anywhere (2026-10-30).
 */
export async function dramenStaff(q: Quest): Promise<void> {
    // The staff is not spawnable, so prepare never gathered its inputs: a banked branch
    // went straight to carving without a knife (jacklove18, 2026-10-30).
    await q.ensure('knife', 1);
    if (q.count('dramen branch') === 0) {
        await q.ensure('air rune', 3);
        await q.ensure('earth rune', 1);
        await q.ensure('law rune', 1);
        await toDungeon(q);
        await spiritAndBranch(q, true);
    }
    await carveStaff(q);
    await teleportOut(q);
}
