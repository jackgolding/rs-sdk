/**
 * Shades of Mort'ton — the route and mechanics (bots/quests/shades-of-mortton.ts is the definition).
 *
 * Content facts (quest_mortton/scripts/*.rs2, minigames/game_mortton/scripts/{flamtaer_temple,mortton_shades,
 * mortton_pyre}.rs2, general/scripts/book.rs2, _unpack/274/all.inv); flow cross-checked with rs-stun-toolkit's
 * q-shades-of-mortton.ts spec:
 *   - Mort'ton is south of Mort Myre (in through its gate: Nature Spirit started, lib/nature-spirit.ts intoSwamp).
 *   - Herbi Flax's house: the shelf (4062, 3481,3279) op1 gives the Diary; its book (opheld1 Read) flipped to the last
 *     page (book:com_86 = component 841, twelve times) -> 5. The table (4064, 3482,3278) op5 Search gives two unidentified
 *     tarromin (and a rogue's purse) once.
 *   - Serum 207: clean tarromin on a vial of water (tarromin unf, obj 95), ashes on it -> Serum 207 (3) — brewed AFTER
 *     reading the diary (-> 10). Each use on an afflicted Razmire (1253, 3489,3296) or Ulsquire (1251, 3496,3289) costs a
 *     dose and clears him for 200 ticks.
 *   - Razmire: "What are all these shadow creatures?" / "Yes, I'll dispatch..." (-> 15). Five Loar shades killed (-> 40,
 *     "That's all five Shades!"); each drops Loar remains. Razmire takes 2 of 5 held (-> 45) and opens his stores; Ulsquire
 *     takes 1 (-> 47); his "What can you tell me about that temple?" (-> 50).
 *   - Razmire's builders' store sells planks, limestone bricks and swamp paste; his general store a hammer, a tinderbox,
 *     olive oil(3) and vials of water. Each temple repair action with 1 plank + 1 brick + 5 paste held adds 800 to the
 *     resource pool; actions spend 7-70 of it (more at high Crafting) and raise the op'd wall a level once the build total
 *     passes 300 + 400 x its level. The first action -> 55; all 15 walls at level 10 -> 60 (Crafting 20, a hammer).
 *   - The altar (3506,3316) lights with a tinderbox at >= 10% sanctity (4091 -> 4090 for 99 ticks); olive oil used on the
 *     lit altar -> sacred oil (-> 65); 2 doses on logs -> pyre logs (-> 70); pyre logs on a funeral pyre (4093; 3507,3276)
 *     (-> 75), Loar remains on it, lit with a tinderbox (-> 80); Ulsquire (cleared) -> QUEST COMPLETE.
 */
import type { Quest } from './run-quest';
import { driveDialog } from './dialog';
import { tickNow, untilTicks } from './ticks';

interface Tile {
    x: number;
    z: number;
    level?: number;
}

export const NPC = { razmireAfflicted: 1253, razmire: 1254, ulsquireAfflicted: 1251, ulsquire: 1252, shadow: 1240, shade: 1241 } as const;
export const OBJ = { herb: 203, tarromin: 253, vial: 227, unf: 95, ashes: 592, diary: 3395, remains: 3396, logs: 1511, pyreLogs: 3438 } as const;
const SERUMS = [3410, 3408, 3412, 3414];
const OLIVE = [3422, 3424, 3426];
const SACRED = [3430, 3432, 3434];
const LOC = { shelf: 4062, table: 4064, altarBroken: 4092, altarUnlit: 4091, altarLit: 4090, pyre: 4093 } as const;
const BOOK_NEXT = 841;

export const HOUSE = { x: 3483, z: 3281 };
export const RAZMIRE = { x: 3489, z: 3295 };
export const ULSQUIRE = { x: 3496, z: 3290 };
const SHELF = { x: 3481, z: 3279 };
const TABLE = { x: 3482, z: 3278 };
const ALTAR = { x: 3506, z: 3316 };
const PYRE = { x: 3507, z: 3276 };
const PYRE_STAND = { x: 3506, z: 3277 };
const SHADE_ROAM: Tile[] = [
    { x: 3492, z: 3290 },
    { x: 3496, z: 3296 },
    { x: 3483, z: 3295 },
    { x: 3488, z: 3282 },
    { x: 3474, z: 3280 },
    { x: 3501, z: 3294 },
];

/** The temple's 15 walls: loc base id (level 0) and the tile to stand on (11 from inside, the 4 corners from outside). */
type Wall = { x: number; z: number; base: number; stand: Tile; corner: boolean };
const W = (x: number, z: number, sx: number, sz: number, corner = false): Wall => ({ x, z, base: corner ? 4079 : 4068, stand: { x: sx, z: sz }, corner });
const WALLS: Wall[] = [
    W(3504, 3315, 3505, 3315),
    W(3505, 3314, 3505, 3315),
    W(3504, 3316, 3505, 3316),
    W(3504, 3317, 3505, 3317),
    W(3505, 3318, 3505, 3317),
    W(3506, 3318, 3506, 3317),
    W(3507, 3318, 3507, 3317),
    W(3508, 3317, 3507, 3317),
    W(3508, 3316, 3507, 3316),
    W(3508, 3315, 3507, 3315),
    W(3507, 3314, 3507, 3315),
    W(3504, 3314, 3504, 3313, true),
    W(3508, 3314, 3508, 3313, true),
    W(3508, 3318, 3509, 3318, true),
    W(3504, 3318, 3503, 3318, true),
];

const inBox = (p: Tile, x0: number, x1: number, z0: number, z1: number) => p.x >= x0 && p.x <= x1 && p.z >= z0 && p.z <= z1;
const pos = (q: Quest) => {
    const p = q.sdk.getState()?.player;
    return { x: p?.worldX ?? 0, z: p?.worldZ ?? 0, level: p?.level ?? 0 };
};
const where = (q: Quest) => `(${pos(q).x},${pos(q).z},L${pos(q).level})`;
const cheb = (a: Tile, b: Tile) => Math.max(Math.abs(a.x - b.x), Math.abs(a.z - b.z));

/** Mort'ton south of Mort Myre's box (lib/nature-spirit.ts inSwamp starts at z 3290 and takes the town's north half). */
export const inMorttonSouth = (p: Tile) => (p.level ?? 0) === 0 && inBox(p, 3471, 3520, 3255, 3289);
/** Anywhere in the town (the swamp's south edge included). */
const inMortton = (p: Tile) => (p.level ?? 0) === 0 && inBox(p, 3471, 3520, 3255, 3325);

const inv = (q: Quest) => q.sdk.getInventory();
const heldId = (q: Quest, ...ids: number[]) => inv(q).filter((i) => ids.includes(i.id)).reduce((n, i) => n + (i.count ?? 1), 0);
const itemId = (q: Quest, ...ids: number[]) => inv(q).find((i) => ids.includes(i.id));
export const serumDoses = (q: Quest) => inv(q).reduce((n, i) => n + (SERUMS.includes(i.id) ? [3, 4, 2, 1][SERUMS.indexOf(i.id)]! : 0), 0);
export const remainsHeld = (q: Quest) => heldId(q, OBJ.remains);

const messagesSince = (q: Quest, t0: number) => (q.sdk.getState()?.gameMessages ?? []).filter((m) => m.tick >= t0).map((m) => m.text);
const heard = (q: Quest, t0: number, re: RegExp) => messagesSince(q, t0).some((m) => re.test(m));
const npcsById = (q: Quest, ...ids: number[]) => (q.sdk.getNearbyNpcs() ?? []).filter((n) => ids.includes(n.id)).sort((a, b) => a.distance - b.distance);

async function closeDialogs(q: Quest): Promise<void> {
    if (q.sdk.getDialog()?.isOpen) await driveDialog(q.sdk, [], { ticks: 10 });
    if (q.sdk.getState()?.interface?.isOpen) await q.sdk.sendCloseModal().catch(() => undefined);
}

async function walk(q: Quest, t: Tile, tolerance = 1): Promise<boolean> {
    for (let i = 0; i < 3 && cheb(pos(q), t) > tolerance; i++) {
        await q.bot.walkTo(t.x, t.z, tolerance).catch(() => undefined);
        if (cheb(pos(q), t) > tolerance) await q.sdk.waitForTicks(2);
    }
    return cheb(pos(q), t) <= tolerance;
}

async function locById(q: Quest, id: number, at: Tile, within = 2) {
    await q.sdk.scanNearbyLocs(15).catch(() => undefined);
    const loc = (q.sdk.getNearbyLocs() ?? []).filter((l) => l.id === id).sort((a, b) => Math.hypot(a.x - at.x, a.z - at.z) - Math.hypot(b.x - at.x, b.z - at.z))[0];
    return loc && Math.hypot(loc.x - at.x, loc.z - at.z) <= within ? loc : undefined;
}

/** Op `op` on loc `id` at `at` until `done`. */
async function opLoc(q: Quest, id: number, at: Tile, op: number, done: () => boolean, label: string, tries = 4, ticks = 15): Promise<void> {
    for (let attempt = 1; attempt <= tries && !done(); attempt++) {
        await defend(q);
        await closeDialogs(q);
        if (cheb(pos(q), at) > 10) await walk(q, at, 2);
        const loc = await locById(q, id, at);
        await q.sdk.sendInteractLoc(loc?.x ?? at.x, loc?.z ?? at.z, id, op);
        await untilTicks(q.sdk, (s) => done() || !!s.dialog?.isOpen, ticks);
        if (q.sdk.getDialog()?.isOpen) await driveDialog(q.sdk, [], { done, ticks: 10 });
    }
    if (!done()) throw new Error(`mortton: ${label} failed at ${where(q)}`);
}

const FOOD = /^(shark|manta ray|monkfish|swordfish|lobster|bass|tuna)$/i;
async function eatIfLow(q: Quest, below = 0.55): Promise<void> {
    const p = q.sdk.getState()?.player;
    if (!p || p.hp > (p.maxHp ?? 10) * below) return;
    const food = inv(q).find((i) => FOOD.test(i.name));
    if (food) await q.bot.eatFood(food).catch(() => undefined);
}

/**
 * Protect from Melee nulls every Loar shade hit (mortton_shades.rs2), and shades walk to the temple while it is built:
 * keep it up from the shade hunt on, sipping prayer potions below 12 points.
 */
export async function prayMelee(q: Quest, on: boolean): Promise<void> {
    const pr = q.sdk.getPrayerState();
    const active = q.sdk.isPrayerActive('protect_from_melee');
    if (on && pr && pr.prayerPoints < 12) {
        const pot = inv(q).find((i) => /^prayer potion\(\d\)$/i.test(i.name));
        const op = pot?.optionsWithIndex.find((o) => /^drink$/i.test(o.text));
        if (pot && op) await q.sdk.sendUseItem(pot.slot, op.opIndex).catch(() => undefined);
    }
    if (on && !active && pr && pr.prayerLevel >= 43 && pr.prayerPoints > 0) await q.bot.activatePrayer('protect_from_melee').catch(() => undefined);
    if (!on && active) await q.bot.deactivatePrayer('protect_from_melee').catch(() => undefined);
}

/** A risen shade on us (it closes any interface we open): kill it first. */
async function defend(q: Quest, maxTicks = 80, within = 2, shadows = false): Promise<void> {
    const t0 = tickNow(q.sdk);
    let last = -99;
    while (tickNow(q.sdk) - t0 < maxTicks) {
        // `shadows`: also the dormant Loar Shadows (1240), which rise into shades beside you — one a tile from
        // Razmire kept closing his store (ABGARMY20, 2026-11-05).
        const on = (shadows ? npcsById(q, NPC.shade, NPC.shadow) : npcsById(q, NPC.shade)).filter((n) => n.distance <= within);
        if (!on.length) return;
        await eatIfLow(q);
        if (q.sdk.getDialog()?.isOpen) await closeDialogs(q);
        if (tickNow(q.sdk) - last >= 5) {
            await q.sdk.sendInteractNpc(on[0]!.index, 2);
            last = tickNow(q.sdk);
        }
        await q.sdk.waitForTicks(1);
    }
}

async function wieldWeapon(q: Quest): Promise<void> {
    const w = inv(q).find((i) => /scimitar|longsword|sword|battleaxe|mace|warhammer|whip/i.test(i.name));
    if (w) await q.bot.equipItem(w).catch(() => undefined);
}

// ── getting there and away

/** From the Varrock side: under the Salve, through Mort Myre's gate, south to Mort'ton. */
export async function toMortton(q: Quest): Promise<void> {
    if (inMortton(pos(q))) return;
    const { intoSwamp } = await import('./nature-spirit');
    await intoSwamp(q).catch((e: Error) => {
        throw new Error(`mortton: ${e.message} — Mort Myre's gate needs Nature Spirit started (bots/quests/nature-spirit.ts)`);
    });
    // walkTo, not goTo: goTo would leave Nature Spirit's swamp for the Varrock side first.
    for (let i = 0; i < 4 && !inMortton(pos(q)); i++) await q.bot.walkTo(HOUSE.x, HOUSE.z + 6, 3).catch(() => undefined);
    if (!inMortton(pos(q))) throw new Error(`mortton: could not cross Mort Myre to Mort'ton (at ${where(q)})`);
    q.log(`mortton: in Mort'ton ${where(q)}`);
}

/** run-quest: Mort'ton's south half is outside Mort Myre's box — north into the swamp, where Nature Spirit's hook takes over. */
export async function leaveMortton(q: Quest): Promise<void> {
    await closeDialogs(q);
    await prayMelee(q, false);
    for (let i = 0; i < 3 && inMorttonSouth(pos(q)); i++) await q.bot.walkTo(3490, 3300, 2).catch(() => undefined);
    if (inMorttonSouth(pos(q))) throw new Error(`mortton: could not walk north out of Mort'ton (at ${where(q)})`);
    // run-quest's Nature Spirit hook has already run for this walk: take the swamp's own way out now.
    const { leaveNatureSpirit } = await import('./nature-spirit');
    await leaveNatureSpirit(q);
}

/** Walk inside Mort'ton (goTo would leave the swamp for the Varrock side first). */
async function goInTown(q: Quest, t: Tile, tolerance = 2): Promise<void> {
    await toMortton(q);
    if (!(await walk(q, t, tolerance))) throw new Error(`mortton: could not walk to (${t.x},${t.z}) from ${where(q)}`);
}

// ── the diary and the serum

/** The diary off the shelf, read to its last page (-> 5); the table's herbs while here. */
export async function readDiary(q: Quest, read: () => Promise<boolean>): Promise<void> {
    await goInTown(q, HOUSE, 2);
    if (!heldId(q, OBJ.diary)) await opLoc(q, LOC.shelf, SHELF, 1, () => heldId(q, OBJ.diary) > 0, 'the diary off the shelf');
    await searchTable(q);
    // Identified at once: a resumed run's prologue banks the pack, and "Tarromin" is the only unambiguous name to withdraw.
    await identifyHerbs(q);
    for (let attempt = 1; attempt <= 4 && !(await read()); attempt++) {
        await defend(q);
        await closeDialogs(q);
        const diary = itemId(q, OBJ.diary);
        if (!diary) throw new Error('mortton: no diary to read');
        // The journal check above leaves the quest scroll (8134) open; the Read op does nothing under a modal.
        await q.sdk.sendCloseModal().catch(() => undefined);
        await q.sdk.waitForTicks(1);
        const op = diary.optionsWithIndex.find((o) => /^read$/i.test(o.text));
        await q.sdk.sendUseItem(diary.slot, op?.opIndex ?? 1);
        // An objbox page first ("You prepare to read the book"), then the book (interface 837).
        const book = () => q.sdk.getState()?.interface?.interfaceId === 837;
        const lastPage = () => /index of solution/i.test(JSON.stringify(q.sdk.getState()?.interface?.textComponents ?? []));
        await untilTicks(q.sdk, (s) => !!s.dialog?.isOpen || book(), 10);
        for (let k = 0; k < 4 && !book() && q.sdk.getDialog()?.isOpen; k++) {
            await q.sdk.sendClickDialog(0).catch(() => undefined);
            await untilTicks(q.sdk, () => book(), 4);
        }
        if (!book()) {
            q.log(`mortton: the diary's book did not open (attempt ${attempt})`);
            continue;
        }
        for (let page = 0; page < 16 && !lastPage(); page++) {
            await q.sdk.sendClickComponent(BOOK_NEXT).catch(() => undefined);
            await q.sdk.waitForTicks(1);
        }
        q.log(`mortton: diary last page ${lastPage()}`);
        await q.sdk.sendCloseModal().catch(() => undefined);
        await q.sdk.waitForTicks(3);
    }
    if (!(await read())) throw new Error('mortton: the diary did not reach its last page');
}

/** Herbi Flax's table: two unidentified tarromin, once (needs 3 free slots). */
async function searchTable(q: Quest): Promise<void> {
    if (heldId(q, OBJ.herb, OBJ.tarromin, OBJ.unf) + serumDoses(q) > 0) return;
    const t0 = tickNow(q.sdk);
    const done = () => heldId(q, OBJ.herb) > 0 || heard(q, t0, /find nothing/i);
    await opLoc(q, LOC.table, TABLE, 5, done, "Herbi Flax's table", 3);
}

/** Identify the table's herbs (a banked "Herb" pair is ambiguous with the rogue's purse; Tarromin is not). */
export async function identifyHerbs(q: Quest): Promise<void> {
    for (const herb of inv(q).filter((i) => /^herb$/i.test(i.name))) {
        const op = herb.optionsWithIndex.find((o) => /identify|clean/i.test(o.text));
        await q.sdk.sendUseItem(herb.slot, op?.opIndex ?? 1).catch(() => undefined);
        await untilTicks(q.sdk, () => !inv(q).some((i) => i.slot === herb.slot && /^herb$/i.test(i.name)), 4);
    }
}

/** A brew's makings held: tarromin (or a herb to identify) and a vial of water, or the unfinished potion; and ashes. */
export const canBrew = (q: Quest) => q.level('herblore') >= 15 && heldId(q, OBJ.ashes) > 0 && (heldId(q, OBJ.unf) > 0 || (heldId(q, OBJ.tarromin, OBJ.herb) > 0 && heldId(q, OBJ.vial) > 0));

/** Serum 207: identify the herbs, tarromin into vials of water, ashes in (-> 10). Brews `count` (3 doses each). */
export async function brewSerum(q: Quest, count = 2): Promise<void> {
    if (q.level('herblore') < 15) throw new Error(`mortton: Serum 207 needs Herblore 15 (have ${q.level('herblore')})`);
    await closeDialogs(q);
    await identifyHerbs(q);
    const combine = async (a: number, b: number, product: number, label: string) => {
        const before = heldId(q, product);
        for (let attempt = 0; attempt < 4 && heldId(q, product) === before; attempt++) {
            const x = itemId(q, a);
            const y = itemId(q, b);
            if (!x || !y) return false;
            await closeDialogs(q);
            await q.sdk.sendUseItemOnItem(x.slot, y.slot);
            await untilTicks(q.sdk, (s) => heldId(q, product) > before || !!s.dialog?.isOpen, 5);
            // A "make how many?" box for the unf potion: one.
            if (q.sdk.getDialog()?.isOpen) await driveDialog(q.sdk, [/^make 1|^1$|unfinished|tarromin/i], { done: () => heldId(q, product) > before, ticks: 8 });
        }
        if (heldId(q, product) === before) throw new Error(`mortton: ${label} did not combine`);
        return true;
    };
    for (let made = 0; made < count && serumDoses(q) < 3 * count; made++) {
        if (!heldId(q, OBJ.unf)) {
            if (!(await combine(OBJ.tarromin, OBJ.vial, OBJ.unf, 'tarromin on a vial of water'))) break;
        }
        const t0 = tickNow(q.sdk);
        const doses = serumDoses(q);
        await combine(OBJ.ashes, OBJ.unf, SERUMS[0]!, 'ashes on the tarromin potion');
        if (serumDoses(q) <= doses && heard(q, t0, /.*/)) q.log(`mortton: brew: ${messagesSince(q, t0).slice(-2).join(' / ')}`);
    }
    if (serumDoses(q) < 1) throw new Error('mortton: no Serum 207 brewed');
    q.log(`mortton: ${serumDoses(q)} doses of Serum 207`);
}

/**
 * Serum on an afflicted Razmire or Ulsquire (or a plain talk while he is still cleared) and drive his dialog with
 * `choices` until `done`.
 */
export async function serumTalk(q: Quest, who: 'razmire' | 'ulsquire', choices: Array<RegExp | string>, done: () => boolean | Promise<boolean>, label: string): Promise<string> {
    const [afflicted, clear, at] = who === 'razmire' ? [NPC.razmireAfflicted, NPC.razmire, RAZMIRE] : [NPC.ulsquireAfflicted, NPC.ulsquire, ULSQUIRE];
    let text = '';
    for (let round = 1; round <= 5; round++) {
        if (await done()) return text;
        await defend(q);
        await closeDialogs(q);
        if (!npcsById(q, afflicted, clear).length || cheb(pos(q), at) > 8) await goInTown(q, at, 3);
        const n = npcsById(q, afflicted, clear)[0];
        if (!n) {
            q.log(`mortton: ${label}: ${who} not in view at ${where(q)}`);
            await q.sdk.waitForTicks(3);
            continue;
        }
        if (n.distance > 2) await walk(q, { x: n.tileX ?? n.x, z: n.tileZ ?? n.z }, 1);
        if (n.id === clear) await q.sdk.sendInteractNpc(n.index, 1);
        else {
            // Out of serum: brew another from the pack's tarromin (the prologue's budget brought a vial and ashes per herb).
            if (!itemId(q, ...SERUMS) && canBrew(q)) await brewSerum(q, 1);
            const serum = itemId(q, ...SERUMS);
            if (!serum) throw new Error(`mortton: ${label}: no Serum 207 left (tarromin ${heldId(q, OBJ.tarromin, OBJ.herb)}, unf ${heldId(q, OBJ.unf)}, vials ${heldId(q, OBJ.vial)}, ashes ${heldId(q, OBJ.ashes)})`);
            await q.sdk.sendUseItemOnNpc(serum.slot, n.index);
        }
        await untilTicks(q.sdk, (s) => !!s.dialog?.isOpen, 15);
        if (!q.sdk.getDialog()?.isOpen) {
            q.log(`mortton: ${label} round ${round}: no dialog (npc ${n.id} at ${n.tileX ?? n.x},${n.tileZ ?? n.z}; me ${where(q)})`);
            continue;
        }
        text += await driveDialog(q.sdk, choices, { ticks: 60, log: q.log });
        // The dialog's last choice can open a store: closeDialogs would close it again (its sendCloseModal fires on
        // any open main modal), so every buy then failed with "Failed to buy from shop" (ABGARMY20, jacklove16,
        // 2026-11-05). The modal shows in state a tick after the dialog ends, so give `done` a few ticks first.
        for (let i = 0; i < 3; i++) {
            if (await done()) return text;
            await q.sdk.waitForTicks(1);
        }
        await closeDialogs(q);
    }
    if (!(await done())) throw new Error(`mortton: ${label} not done`);
    return text;
}

// ── the shades

/** Five Loar shades killed (-> 40) and five remains held for Razmire (2), Ulsquire (1) and the pyre. */
export async function killShades(q: Quest, done: () => Promise<boolean>): Promise<void> {
    await toMortton(q);
    await wieldWeapon(q);
    const t0 = tickNow(q.sdk);
    let target = -1;
    let lastAttack = -99;
    let lastCheck = -99;
    let lastLog = -99;
    let roam = 0;
    let killedAll = false;
    const skip = new Map<number, number>();
    let progressAt = tickNow(q.sdk);
    let xp = combatXp(q);
    // Free slots for the remains: the empty vials and the diary (read) go.
    for (const junk of inv(q).filter((i) => /^vial$/i.test(i.name) || i.id === OBJ.diary)) if (inv(q).length > 22) await q.bot.dropItem(junk, 'all').catch(() => undefined);
    try {
        while (!killedAll || remainsHeld(q) < 5) {
            if (tickNow(q.sdk) - t0 > 1500) throw new Error(`mortton: shades not done after 1500 ticks (remains ${remainsHeld(q)})`);
            await prayMelee(q, true);
            await eatIfLow(q);
            if (q.sdk.getDialog()?.isOpen) await closeDialogs(q);
            if (heard(q, t0, /all five shades/i)) killedAll = true;
            if (!killedAll && tickNow(q.sdk) - lastCheck > 40) {
                lastCheck = tickNow(q.sdk);
                if (await done()) killedAll = true;
            }
            // Remains vanish after 200 ticks: pick them up even mid-fight.
            await q.sdk.scanGroundItems(10).catch(() => undefined);
            const drop = q.sdk.findGroundItem(/^loar remains$/i);
            if (drop && remainsHeld(q) < 5 && inv(q).length < 28) {
                await q.bot.pickupItem(drop).catch(() => undefined);
                await untilTicks(q.sdk, () => !q.sdk.findGroundItem(/^loar remains$/i), 4);
                continue;
            }
            const now = combatXp(q);
            if (now !== xp) {
                xp = now;
                progressAt = tickNow(q.sdk);
            }
            const shades = npcsById(q, NPC.shadow, NPC.shade).filter((n) => (skip.get(n.index) ?? -1) < tickNow(q.sdk));
            let t = shades.find((n) => n.index === target) ?? shades[0];
            // A shade behind a ruin wall: no xp for 15 ticks on one target — skip it a while.
            if (t && t.index === target && tickNow(q.sdk) - progressAt > 15 && tickNow(q.sdk) - lastAttack < 30) {
                skip.set(t.index, tickNow(q.sdk) + 150);
                target = -1;
                progressAt = tickNow(q.sdk);
                continue;
            }
            if (!t) {
                await walk(q, SHADE_ROAM[roam++ % SHADE_ROAM.length]!, 2);
                await q.sdk.waitForTicks(2);
                continue;
            }
            if (t.index !== target || tickNow(q.sdk) - lastAttack >= 6) {
                if (t.index !== target) progressAt = tickNow(q.sdk);
                target = t.index;
                await q.sdk.sendInteractNpc(t.index, 2);
                lastAttack = tickNow(q.sdk);
            }
            if (tickNow(q.sdk) - lastLog >= 100) {
                lastLog = tickNow(q.sdk);
                q.log(`mortton: shades +${tickNow(q.sdk) - t0}t: all five ${killedAll}, remains ${remainsHeld(q)}, in view ${shades.length}, hp ${q.sdk.getState()?.player?.hp}, prayer ${q.sdk.getPrayerState()?.prayerPoints}`);
            }
            await q.sdk.waitForTicks(1);
        }
    } finally {
        await defend(q);
    }
    q.log(`mortton: five shades down, ${remainsHeld(q)} remains, ${tickNow(q.sdk) - t0}t`);
}
const combatXp = (q: Quest) => ['attack', 'strength', 'defence', 'hitpoints'].reduce((n, k) => n + (q.sdk.getSkill(k)?.experience ?? 0), 0);

// ── supplies

/**
 * Razmire's stores (open from stage 45): buy `items` from the general or builders' store. Every shade swing closes the
 * open interface, hit or not (mortton_shades.rs2 shade_playerhit if_close): risen shades near us are killed first and
 * the store is reopened as often as it takes.
 */
export async function buyFromRazmire(q: Quest, store: 'general' | 'building', items: Array<[RegExp, number]>): Promise<void> {
    const want = () => items.filter(([re, n]) => q.count(re) < n);
    if (!want().length) return;
    const menu = store === 'general' ? [/can i see the general store/i, /can you open a store for me/i] : [/can i see the building store/i, /running out of building materials/i, /can you open a store for me/i];
    const open = () => !!q.sdk.getState()?.shop?.isOpen;
    // Every shade swing closes the store (mortton_shades.rs2 shade_playerhit if_close), and the client then shows an
    // empty shelf for a tick: clear shades over a wider radius before each round, and allow more rounds.
    for (let round = 1; round <= 25 && want().length; round++) {
        await prayMelee(q, true);
        await defend(q, 200, 10, true);
        if (!open()) await serumTalk(q, 'razmire', menu, () => open(), `Razmire's ${store} store`).catch((e: Error) => q.log(e.message));
        for (const [re, n] of want()) {
            if (!open()) break;
            const short = n - q.count(re);
            // Razmire's general store publishes no item list to the client ("lists nothing", jacklove16 2026-11-05):
            // buy olive oil by its fixed slot (razmiregeneralstore stock8 = oliveoil3, slot 7).
            const listed = (q.sdk.getState()?.shop?.shopItems ?? []).length > 0;
            if (!listed && store === 'general' && re.test('Olive oil(3)')) {
                const before = q.count(re);
                for (let i = 0; i < short; i++) await q.sdk.sendShopBuy(7, 1).catch(() => undefined);
                await untilTicks(q.sdk, () => q.count(re) > before, 6);
                q.log(`mortton: olive oil by slot 7: ${before} → ${q.count(re)}`);
                continue;
            }
            const r = await q.bot.buyFromShop(re, Math.min(short, 20)).catch((e) => ({ success: false, message: String(e) }));
            if (!r.success && open()) {
                // What the store actually lists (jacklove16 could not buy olive oil it stocks 150 of, 2026-11-04).
                const shop = q.sdk.getState()?.shop;
                q.log(`mortton: buy ${re}: ${r.message}; shop "${shop?.title ?? '?'}" lists ${(shop?.shopItems ?? []).map((i) => `${i.name}×${i.count}`).join(', ').slice(0, 300) || 'nothing'}; coins ${q.count(/^coins$/i)}, free ${28 - q.sdk.getInventory().length}`);
            }
        }
    }
    if (open()) await q.bot.closeShop().catch(() => undefined);
    // Olive oil the store would not sell (jacklove16 ×2, 2026-11-04: "Failed to buy", then "not found"):
    // Ulsquire hands out one olive oil(3) after the rebuild (ulsquire_shauncy.rs2 ulsquire_temple_built).
    if (want().some(([re]) => re.test('Olive oil(3)'))) {
        q.log("mortton: no olive oil from Razmire — asking Ulsquire for his");
        await serumTalk(q, 'ulsquire', [/what should i do when the temple is built/i], () => !want().some(([re]) => re.test('Olive oil(3)')), "Ulsquire's olive oil").catch((e: Error) => q.log(e.message));
    }
    if (want().length) throw new Error(`mortton: Razmire's ${store} store: still short ${want().map(([re, n]) => `${re} ${n - q.count(re)}`).join(', ')}`);
}

// ── the temple

const wallLevel = (q: Quest, w: Wall): number => {
    const loc = (q.sdk.getNearbyLocs() ?? []).find((l) => l.x === w.x && l.z === w.z && l.id >= w.base && l.id <= w.base + 10);
    return loc ? loc.id - w.base : -1;
};

/** Repair the temple until its 15 walls stand at level 10 (55 on the first action, 60 when done). */
export async function repairTemple(q: Quest, done: () => Promise<boolean>, resupply: () => Promise<void>): Promise<void> {
    if (!q.count(/^hammer$/i)) throw new Error('mortton: no hammer for the temple');
    await goInTown(q, WALLS[0]!.stand, 1);
    const t0 = tickNow(q.sdk);
    let xp0 = q.sdk.getSkill('crafting')?.experience ?? 0;
    let build = 0;
    let actions = 0;
    let current: Wall | null = null;
    let lastSend = -99;
    let lastXpAt = tickNow(q.sdk);
    let lastLog = -99;
    let lastCheck = tickNow(q.sdk);
    let resupplies = 0;
    let lastStarve = -999;
    while (true) {
        if (tickNow(q.sdk) - t0 > 3000) throw new Error(`mortton: the temple not done after 3000 ticks (${actions} actions)`);
        await prayMelee(q, true);
        await eatIfLow(q);
        await q.sdk.scanNearbyLocs(8).catch(() => undefined);
        const levels = WALLS.map((w) => wallLevel(q, w));
        // The walls are world state (another player's repair stands for 9000 ticks), but the stage moves only on our own
        // repair action at 100%: with every wall up, keep acting on a finished wall until the journal says so.
        const allUp = levels.every((l) => l >= 10);
        if ((allUp || tickNow(q.sdk) - lastCheck > 60) && (lastCheck = tickNow(q.sdk)) && (await done())) break;
        if (allUp) {
            const w = WALLS[1]!;
            if (tickNow(q.sdk) - lastSend > 6) {
                if (cheb(pos(q), w.stand) > 0) await walk(q, w.stand, 0);
                await q.sdk.sendInteractLoc(w.x, w.z, w.base + 10, 1);
                lastSend = tickNow(q.sdk);
            }
            if (q.sdk.getDialog()?.isOpen) {
                const text = await driveDialog(q.sdk, [], { ticks: 6 });
                if (/resources needed|material resource/i.test(text)) {
                    if (++resupplies > 6) throw new Error('mortton: the temple is still out of resources after six trips to Razmire');
                    await resupply();
                }
            }
            await q.sdk.waitForTicks(2);
            continue;
        }
        const xp = q.sdk.getSkill('crafting')?.experience ?? 0;
        if (xp > xp0) {
            // 5 xp per resource spent; the build total gains 5 per resource.
            build += Math.round(xp - xp0);
            xp0 = xp;
            actions++;
            lastXpAt = tickNow(q.sdk);
        }
        if (q.sdk.getDialog()?.isOpen) {
            const text = await driveDialog(q.sdk, [], { ticks: 6 });
            if (/resources needed|material resource/i.test(text)) {
                if (++resupplies > 6) throw new Error('mortton: the temple is still out of resources after six trips to Razmire');
                q.log(`mortton: temple resources out after ${actions} actions — to Razmire's builders' store`);
                await resupply();
                current = null;
                continue;
            }
        }
        // A shade on us while the prayer is down: kill it first.
        if (!q.sdk.isPrayerActive('protect_from_melee')) await defend(q, 150);
        // One wall at a time, up to 10: an action repeats by itself on the wall it was given (p_oploc), and the build
        // total is shared, so a wall that cannot level yet still banks build for the rest. Hopping walls every action
        // cost a walk and a re-send each (30 actions in 300 ticks against 55 staying put, staging 2026-11-04). The
        // xp-based build estimate is off by the server's xp rate, so it only feeds the log.
        const open = WALLS.filter((w, i) => levels[i]! >= 0 && levels[i]! < 10);
        if (!open.length) {
            // Walls out of view (the scan missed them): stand back in the middle and look again.
            await walk(q, WALLS[0]!.stand, 1);
            await q.sdk.waitForTicks(2);
            continue;
        }
        const next: Wall = current && open.includes(current) ? current : [...open].sort((a, b) => Number(a.corner) - Number(b.corner) || cheb(a.stand, pos(q)) - cheb(b.stand, pos(q)))[0]!;
        // Out of resources shows as a mesbox, which the next shade swing closes unread (if_close): no crafting xp for 40
        // ticks with nothing held to add (qlqfsm4 crawled from 117 to 120 actions in 350 ticks) is the same signal.
        const holding = q.count(/^plank$/i) > 0 && q.count(/^limestone brick$/i) > 0 && q.count(/^swamp paste$/i) >= 5;
        if (!holding && actions > 0 && tickNow(q.sdk) - lastXpAt > 40 && tickNow(q.sdk) - lastStarve > 100) {
            lastStarve = tickNow(q.sdk);
            if (++resupplies > 6) throw new Error('mortton: the temple is still out of resources after six trips to Razmire');
            q.log(`mortton: no repair progress for ${tickNow(q.sdk) - lastXpAt}t after ${actions} actions — resources out, to Razmire's builders' store`);
            await resupply();
            current = null;
            lastXpAt = tickNow(q.sdk);
            continue;
        }
        const stale = tickNow(q.sdk) - lastXpAt > 8 && tickNow(q.sdk) - lastSend > 8;
        if (next !== current || stale) {
            current = next;
            if (cheb(pos(q), next.stand) > 0) await walk(q, next.stand, 0);
            const l = levels[WALLS.indexOf(next)]!;
            await q.sdk.sendInteractLoc(next.x, next.z, next.base + l, 1);
            lastSend = tickNow(q.sdk);
        }
        if (tickNow(q.sdk) - lastLog >= 100) {
            lastLog = tickNow(q.sdk);
            q.log(`mortton: temple +${tickNow(q.sdk) - t0}t: ${actions} actions, build ~${build}, walls ${levels.join(',')}; planks ${q.count(/^plank$/i)} bricks ${q.count(/^limestone brick$/i)} paste ${q.count(/^swamp paste$/i)}`);
        }
        await q.sdk.waitForTicks(1);
    }
    q.log(`mortton: temple repaired in ${tickNow(q.sdk) - t0}t (${actions} actions)`);
}

/** Light the altar (it reverts 99 ticks after the last repair at 100%: one more action re-arms it), then the oil (-> 65). */
export async function sacredOil(q: Quest, resupply?: () => Promise<void>): Promise<void> {
    await goInTown(q, { x: 3506, z: 3315 }, 1);
    const lit = async () => !!(await locById(q, LOC.altarLit, ALTAR, 0));
    const t0 = tickNow(q.sdk);
    let repairNext = false;
    while (!(await lit())) {
        if (tickNow(q.sdk) - t0 > 400) throw new Error('mortton: the altar would not light');
        await prayMelee(q, true);
        await defend(q);
        await closeDialogs(q);
        const unlit = await locById(q, LOC.altarUnlit, ALTAR, 0);
        if (unlit && !repairNext) {
            // Lighting is a Firemaking roll and needs 10% sanctity ("You haven't sanctified enough"): a failed try is
            // followed by a repair action, which raises the sanctity.
            await walk(q, { x: 3506, z: 3315 }, 0);
            await q.sdk.sendInteractLoc(ALTAR.x, ALTAR.z, LOC.altarUnlit, 1);
            const t1 = tickNow(q.sdk);
            await untilTicks(q.sdk, (s) => !!s.dialog?.isOpen || heard(q, t1, /light the temple fire/i), 12);
            const text = q.sdk.getDialog()?.isOpen ? await driveDialog(q.sdk, [], { ticks: 6 }) : '';
            repairNext = /sanctified enough/i.test(text);
            if (!repairNext) await untilTicks(q.sdk, () => heard(q, t1, /light the temple fire/i), 10);
        } else {
            // Broken again (it stays unbroken 99 ticks after a repair at 100%), or the sanctity is low: one repair action
            // on a finished wall re-arms it and adds sanctity. Out of resources, the caller's resupply buys a set.
            const w = WALLS[1]!;
            await walk(q, w.stand, 0);
            await q.sdk.sendInteractLoc(w.x, w.z, w.base + 10, 1);
            await untilTicks(q.sdk, (s) => !!s.dialog?.isOpen, 8);
            if (q.sdk.getDialog()?.isOpen) {
                const text = await driveDialog(q.sdk, [], { ticks: 6 });
                if (/resources needed|material resource/i.test(text)) {
                    if (!resupply) throw new Error('mortton: the altar needs a repair action and the temple has no resources');
                    await resupply();
                }
            }
            repairNext = false;
        }
    }
    const oil = itemId(q, ...OLIVE);
    if (!oil) throw new Error('mortton: no olive oil (2+ doses) for the sacred flame');
    for (let attempt = 0; attempt < 4 && !itemId(q, ...SACRED); attempt++) {
        const o = itemId(q, ...OLIVE);
        if (!o) break;
        await closeDialogs(q);
        await q.sdk.sendUseItemOnLoc(o.slot, ALTAR.x, ALTAR.z, LOC.altarLit);
        await untilTicks(q.sdk, () => !!itemId(q, ...SACRED), 8);
        if (q.sdk.getDialog()?.isOpen) await closeDialogs(q);
    }
    if (!itemId(q, ...SACRED)) throw new Error('mortton: the olive oil did not turn sacred');
}

/** Sacred oil on logs: pyre logs (-> 70). */
export async function pyreLogs(q: Quest): Promise<void> {
    for (let attempt = 0; attempt < 4 && !heldId(q, OBJ.pyreLogs); attempt++) {
        const oil = itemId(q, ...SACRED);
        const logs = itemId(q, OBJ.logs);
        if (!oil || !logs) throw new Error(`mortton: pyre logs need sacred oil and logs (oil ${!!oil}, logs ${!!logs})`);
        await closeDialogs(q);
        await q.sdk.sendUseItemOnItem(oil.slot, logs.slot);
        await untilTicks(q.sdk, () => heldId(q, OBJ.pyreLogs) > 0, 5);
    }
    if (!heldId(q, OBJ.pyreLogs)) throw new Error('mortton: no pyre logs');
}

/** Pyre logs on the funeral pyre (-> 75), the remains on them, lit with a tinderbox (-> 80). */
export async function burnShade(q: Quest, lit: () => Promise<boolean>): Promise<void> {
    await goInTown(q, PYRE_STAND, 1);
    const t0 = tickNow(q.sdk);
    if (heldId(q, OBJ.pyreLogs)) {
        for (let attempt = 0; attempt < 4 && heldId(q, OBJ.pyreLogs); attempt++) {
            await defend(q);
            await closeDialogs(q);
            const logs = itemId(q, OBJ.pyreLogs)!;
            await walk(q, PYRE_STAND, 0);
            await q.sdk.sendUseItemOnLoc(logs.slot, PYRE.x, PYRE.z, LOC.pyre);
            await untilTicks(q.sdk, () => !heldId(q, OBJ.pyreLogs) || heard(q, t0, /already started|can't do that/i), 8);
        }
        if (heldId(q, OBJ.pyreLogs)) throw new Error(`mortton: the pyre logs stayed in the pack (${messagesSince(q, t0).slice(-2).join(' / ')})`);
    }
    // The pyre's loc changes with each step: use what stands on its tile.
    const pyreLoc = async () => {
        await q.sdk.scanNearbyLocs(5).catch(() => undefined);
        return (q.sdk.getNearbyLocs() ?? []).find((l) => l.x === PYRE.x && l.z === PYRE.z);
    };
    const before = remainsHeld(q);
    for (let attempt = 0; attempt < 4 && remainsHeld(q) === before; attempt++) {
        const l = await pyreLoc();
        const r = itemId(q, OBJ.remains);
        if (!l || !r) throw new Error(`mortton: remains on the pyre: pyre ${l?.id} remains ${!!r}`);
        await closeDialogs(q);
        await q.sdk.sendUseItemOnLoc(r.slot, l.x, l.z, l.id);
        await untilTicks(q.sdk, () => remainsHeld(q) < before, 6);
    }
    if (remainsHeld(q) === before) throw new Error(`mortton: the remains would not go on the pyre (${messagesSince(q, t0).slice(-2).join(' / ')})`);
    for (let attempt = 0; attempt < 8 && !(await lit()); attempt++) {
        const l = await pyreLoc();
        if (!l) break;
        await closeDialogs(q);
        await q.sdk.sendInteractLoc(l.x, l.z, l.id, 1);
        await untilTicks(q.sdk, () => heard(q, t0, /spirit|released|failed to light/i), 15);
    }
    await untilTicks(q.sdk, () => false, 4);
}
