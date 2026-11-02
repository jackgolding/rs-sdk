/**
 * Range the dark wizards at the stone circle south of Varrock for their water and fire
 * talisman drops, training Ranged up to --until (user, 2026-11-02: the fleet has neither
 * talisman). Best shortbow the level allows and arrows from the bank, sharks to eat; loots
 * everything the wizards drop (bones buried) and its own arrows; banks at Varrock west. No strung
 * bow banked for the level: one from Lowe's (shortbow / oak shortbow).
 *
 *   bun bots/quests/dark-wizards-range.ts {botname} [--until=40] [--talismans=2]
 *
 * Logs "already complete" at the target level (todo-runner marks the item done on it).
 */
import { runTask, type Quest } from './lib/run-quest';
import { SAFE_BANKS } from './safe-stops';
import { buyAtShop } from './quest-supplies';
import { closeUi, walkNear } from './movement';

const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const UNTIL = Number(arg('until') ?? 99);
/** `--talismans=N`: done once the bank holds N water AND N fire talismans (user: at least 1, ideally 2). */
const TALISMANS = Number(arg('talismans') ?? 0);
const WATER_T = /^water talisman$/i;
const FIRE_T = /^fire talisman$/i;
const BANK = SAFE_BANKS['varrock-west'];
/** The stone circle the dark wizards (level 7 and 20) walk around. */
const CIRCLE = { x: 3226, z: 3370 };
/**
 * Best first: STRUNG shortbows by obj id, with the Ranged level each needs. An unstrung bow has
 * the same name (jacklove20's bank held unstrung oak/willow/maple shortbows), so names won't do.
 */
const BOWS: Array<[number, number, string]> = [
    [861, 50, 'magic shortbow'],
    [857, 40, 'yew shortbow'],
    [853, 30, 'maple shortbow'],
    [849, 20, 'willow shortbow'],
    [843, 5, 'oak shortbow'],
    [841, 1, 'shortbow'],
];
/** Lowe's Archery Emporium (archeryshop): shortbow and oak shortbow, the strung bows it sells. */
const LOWE = { x: 3232, z: 3423, npc: /^lowe$/i };
const ARROWS = /^(iron|bronze) arrow$/i;
const FOOD = /^(shark|swordfish|lobster|bass|tuna|monkfish)$/i;
const WIZARD = /^dark wizard$/i;
/** Bones are buried where they drop; everything else a wizard drops is looted (user, 2026-11-02). */
const BONES = /^bones$/i;
const FOOD_TAKE = 10;
const MAX_KILLS_PER_TRIP = 150;

const wornBowId = (q: Quest) => q.sdk.getEquipment().find((e) => e && BOWS.some(([id]) => id === e.id))?.id ?? null;
const levelOf = (id: number | null) => BOWS.find(([b]) => b === id)?.[1] ?? -1;
/** The best strung bow the level allows that is worn, carried or banked (bank must be open). */
function bestBow(q: Quest): number | null {
    const lvl = q.level('ranged');
    const have = new Set([wornBowId(q), ...q.sdk.getInventory().map((i) => i.id), ...(q.sdk.getBankItems() ?? []).map((b) => b.id)]);
    return BOWS.find(([id, need]) => need <= lvl && have.has(id))?.[0] ?? null;
}
/** The best bow Lowe sells for this level. */
const loweBow = (q: Quest) => (q.level('ranged') >= 5 ? { id: 843, re: /^oak shortbow$/i } : { id: 841, re: /^shortbow$/i });

const heldCount = (q: Quest, re: RegExp) => q.sdk.getInventory().filter((i) => re.test(i.name)).reduce((n, i) => n + (i.count ?? 1), 0);
const quiver = (q: Quest) => q.sdk.getEquipment().filter((e) => e && ARROWS.test(e.name)).reduce((n, e) => n + (e!.count ?? 1), 0);
const hp = (q: Quest) => q.sdk.getSkill('Hitpoints');
let bankTalismans = { water: 0, fire: 0 };

/**
 * A wizard another player is fighting: its facing target is a player slot + 32768 and that slot
 * is someone in view (our own slot is never in getNearbyPlayers). The circle is crowded, so these
 * are skipped rather than waited on (user, 2026-11-02).
 */
function takenByOther(q: Quest, npc: { targetIndex: number }): boolean {
    const t = npc.targetIndex ?? -1;
    if (t < 32768) return false;
    return (q.sdk.getNearbyPlayers() ?? []).some((p) => p.index === t - 32768);
}
function targetsMe(q: Quest, npc: { targetIndex: number }): boolean {
    const t = npc.targetIndex ?? -1;
    return t >= 32768 && !takenByOther(q, npc);
}
/** Other players within `r` tiles of a spot. */
function crowd(q: Quest, at: { x: number; z: number }, r: number): number {
    return (q.sdk.getNearbyPlayers() ?? []).filter((p) => Math.hypot(p.x - at.x, p.z - at.z) <= r).length;
}
/** Free wizards: the ones already on us first, then near and away from other players. */
function pickWizard(q: Quest) {
    const score = (n: { distance: number; x: number; z: number }) => n.distance + 4 * crowd(q, n, 3);
    return (q.sdk.getNearbyNpcs() ?? [])
        .filter((n) => WIZARD.test(n.name) && n.reachable !== false && n.hp !== 0 && !takenByOther(q, n))
        .sort((a, b) => Number(targetsMe(q, b)) - Number(targetsMe(q, a)) || score(a) - score(b))[0];
}
/** Four sides of the dolmen; with nothing free, wait on the one with the fewest other players. */
const SIDES = [
    { x: CIRCLE.x, z: CIRCLE.z + 6 },
    { x: CIRCLE.x, z: CIRCLE.z - 6 },
    { x: CIRCLE.x + 6, z: CIRCLE.z },
    { x: CIRCLE.x - 6, z: CIRCLE.z },
];
function quietSide(q: Quest) {
    return [...SIDES].sort((a, b) => crowd(q, a, 6) - crowd(q, b, 6))[0]!;
}
const talismansDone = () => TALISMANS > 0 && bankTalismans.water >= TALISMANS && bankTalismans.fire >= TALISMANS;

/** Bank the pack, take the best bow, every arrow and some food; wear bow and arrows. */
async function restock(q: Quest): Promise<boolean> {
    const { sdk, bot } = q;
    await q.goTo(BANK, 3);
    const opened = await bot.openBank();
    if (!opened.success) throw new Error(`openBank: ${opened.message}`);
    for (let i = 0; i < 28; i++) {
        const item = sdk.getInventory().find((it) => (it.count ?? 0) > 0);
        if (!item) break;
        const r = await bot.depositItem(item, -1);
        if (!r.success && !r.partial) break;
    }
    const banked = (re: RegExp) => (sdk.getBankItems() ?? []).filter((b) => re.test(b.name)).reduce((n, b) => n + b.count, 0);
    bankTalismans = { water: banked(WATER_T), fire: banked(FIRE_T) };
    // Strung bows only (by id); the best the level allows, else one from Lowe.
    let bow = bestBow(q);
    const lowe = loweBow(q);
    if (bow === null || levelOf(bow) < levelOf(lowe.id)) bow = null;
    if (bow !== null && wornBowId(q) !== bow) {
        const b = (sdk.getBankItems() ?? []).find((x) => x.id === bow);
        if (b) await bot.withdrawItem(b, 1, { asNote: false });
    }
    const arrows = sdk.findBankItem(/^iron arrow$/i) ?? sdk.findBankItem(/^bronze arrow$/i);
    if (arrows) await bot.withdrawItem(arrows, arrows.count);
    const food = sdk.findBankItem(FOOD);
    if (food) await bot.withdrawItem(food, Math.min(FOOD_TAKE, food.count));
    const coins = sdk.findBankItem(/^coins$/i);
    if (bow === null && coins) await bot.withdrawItem(coins, Math.min(coins.count, 1000));
    await sdk.waitForTicks(2).catch(() => undefined);
    await bot.closeBank();
    if (bow === null) {
        q.log(`no strung bow banked for Ranged ${q.level('ranged')}: buying one from Lowe`);
        await buyAtShop(
            { bot, sdk, log: q.log, intent: () => undefined, walkNear: (x: number, z: number, t = 3) => walkNear(bot, sdk, x, z, t), closeUi: () => closeUi(bot, sdk) },
            LOWE,
            [{ pattern: lowe.re, amount: 1, label: 'bow' }]
        ).catch((e) => q.log(`Lowe: ${e instanceof Error ? e.message : String(e)}`));
        await closeUi(bot, sdk);
        bow = sdk.getInventory().find((i) => i.id === lowe.id) ? lowe.id : null;
        if (bow === null) throw new Error('no strung bow banked and Lowe sold none');
    }
    if (wornBowId(q) !== bow) {
        const bowItem = sdk.getInventory().find((i) => i.id === bow);
        if (bowItem) {
            const r = await bot.equipItem(bowItem);
            if (!r.success) q.log(`equip ${bowItem.name}: ${r.message}`);
            await sdk.waitForCondition(() => wornBowId(q) === bow, 3_000).catch(() => undefined);
        }
    }
    if (wornBowId(q) !== bow) throw new Error(`could not wield bow ${bow}`);
    // Coins left over from Lowe go back next restock.
    const arrowItem = sdk.findInventoryItem(ARROWS);
    if (arrowItem) await bot.equipItem(arrowItem);
    await sdk.waitForTicks(2).catch(() => undefined);
    q.log(`restock: bank holds ${bankTalismans.water} water / ${bankTalismans.fire} fire talismans`);
    q.log(`restock: ${sdk.getEquipment().filter(Boolean).map((e) => `${e!.name}${(e!.count ?? 1) > 1 ? ` x${e!.count}` : ''}`).join(', ')} | food ${heldCount(q, FOOD)} | Ranged ${q.level('ranged')}`);
    return quiver(q) > 0;
}

/** Everything the wizards drop near us: talismans, runes, herbs, rare-drop-table items, our arrows; bones buried. */
async function loot(q: Quest): Promise<number> {
    let got = 0;
    for (let i = 0; i < 12; i++) {
        if (q.sdk.getInventory().length >= 28) break;
        const g = q.sdk.findGroundItem(/./, { reachable: true });
        if (!g || (g.distance ?? 99) > 6) break;
        const before = q.sdk.getInventory().reduce((n, it) => n + (it.count ?? 1), 0);
        await q.bot.pickupItem(g).catch(() => undefined);
        await q.sdk.waitForCondition(() => q.sdk.getInventory().reduce((n, it) => n + (it.count ?? 1), 0) > before, 4_000).catch(() => undefined);
        if (/talisman$/i.test(g.name)) {
            got++;
            q.log(`LOOT ${g.name}`);
        } else if (!BONES.test(g.name) && !ARROWS.test(g.name)) q.log(`loot ${g.name}${(g.count ?? 1) > 1 ? ` x${g.count}` : ''}`);
    }
    for (const bone of q.sdk.getInventory().filter((it) => BONES.test(it.name))) {
        const bury = bone.optionsWithIndex.find((o) => /bury/i.test(o.text));
        if (!bury) continue;
        await q.sdk.sendUseItem(bone.slot, bury.opIndex).catch(() => undefined);
        await q.sdk.waitForTicks(2).catch(() => undefined);
    }
    // Picked-up arrows go back in the quiver.
    const arrows = q.sdk.findInventoryItem(ARROWS);
    if (arrows) await q.bot.equipItem(arrows).catch(() => undefined);
    return got;
}

await runTask({
    id: 'dark-wizards-range',
    hub: 'varrock-west',
    task: async (q) => {
        const { sdk, bot } = q;
        let kills = 0;
        let talismans = 0;
        while (!q.stopRequested()) {
            if (q.level('ranged') >= UNTIL) {
                q.log(`dark-wizards-range: Ranged ${q.level('ranged')} >= ${UNTIL}, ${kills} kills, ${talismans} talismans — already complete`);
                return;
            }
            if (!(await restock(q))) throw new Error('no iron or bronze arrows left');
            if (talismansDone()) {
                q.log(`dark-wizards-range: bank holds ${bankTalismans.water} water and ${bankTalismans.fire} fire talismans, Ranged ${q.level('ranged')}, ${kills} kills — already complete`);
                return;
            }
            const bowAt = q.level('ranged');
            await q.goTo(CIRCLE, 6);
            let tripKills = 0;
            while (!q.stopRequested() && tripKills < MAX_KILLS_PER_TRIP) {
                const h = hp(q);
                if (h && h.level < h.baseLevel * 0.5) {
                    const food = sdk.findInventoryItem(FOOD);
                    if (!food) break;
                    await bot.eatFood(food).catch(() => undefined);
                    continue;
                }
                if (quiver(q) === 0 && !sdk.findInventoryItem(ARROWS)) break;
                if (sdk.getInventory().length >= 27) break;
                // A better bow unlocked (oak 5, willow 20, maple 30): go get it.
                if (BOWS.some(([, need]) => need > bowAt && need <= q.level('ranged'))) break;
                if (q.level('ranged') >= UNTIL) break;
                if (TALISMANS > 0 && bankTalismans.water + heldCount(q, WATER_T) >= TALISMANS && bankTalismans.fire + heldCount(q, FIRE_T) >= TALISMANS) break;
                const npc = pickWizard(q);
                if (!npc) {
                    const side = quietSide(q);
                    const me = sdk.getState()?.player;
                    if (!me || Math.hypot(me.worldX - side.x, me.worldZ - side.z) > 3) await q.goTo(side, 2).catch(() => undefined);
                    else await sdk.waitForTicks(2).catch(() => undefined);
                    continue;
                }
                // A short wait for the fight to start: a contested wizard fails fast and the next is tried.
                const r = await bot.attack(npc, 2_000).catch(() => null);
                if (!r?.success) continue;
                // Until it dies (gone from view or 0 hp); straight on to another the moment someone
                // else has it, or our fight stalls for 4 ticks.
                let idle = 0;
                for (let t = 0; t < 80; t++) {
                    await sdk.waitForTicks(1).catch(() => undefined);
                    const n = sdk.getNearbyNpcs().find((x) => x.index === npc.index);
                    if (!n || n.hp === 0) {
                        kills++;
                        tripKills++;
                        break;
                    }
                    if (takenByOther(q, n)) break;
                    idle = sdk.getState()?.player?.combat.inCombat ? 0 : idle + 1;
                    if (idle >= 4) break;
                }
                talismans += await loot(q);
                if (kills % 25 === 0 && tripKills > 0) q.log(`kills ${kills} | Ranged ${q.level('ranged')} | arrows ${quiver(q)} | talismans looted ${talismans}`);
            }
        }
        q.log('dark-wizards-range: stop requested');
    },
});
