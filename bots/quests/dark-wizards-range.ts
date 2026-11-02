/**
 * Range the dark wizards at the stone circle south of Varrock for their water and fire
 * talisman drops, training Ranged up to --until (user, 2026-11-02: the fleet has neither
 * talisman). Best shortbow the level allows and arrows from the bank, sharks to eat; loots
 * talismans and runes and picks its own arrows back up; banks at Varrock west.
 *
 *   bun bots/quests/dark-wizards-range.ts {botname} [--until=40]
 *
 * Logs "already complete" at the target level (todo-runner marks the item done on it).
 */
import { runTask, type Quest } from './lib/run-quest';
import { SAFE_BANKS } from './safe-stops';

const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const UNTIL = Number(arg('until') ?? 40);
const BANK = SAFE_BANKS['varrock-west'];
/** The stone circle the dark wizards (level 7 and 20) walk around. */
const CIRCLE = { x: 3226, z: 3370 };
/** Best first: the bow the Ranged level allows. */
const BOWS: Array<[RegExp, number]> = [
    [/^maple shortbow$/i, 30],
    [/^willow shortbow$/i, 20],
    [/^oak shortbow$/i, 5],
    [/^shortbow$/i, 1],
];
const ARROWS = /^(iron|bronze) arrow$/i;
const FOOD = /^(shark|swordfish|lobster|bass|tuna|monkfish)$/i;
const WIZARD = /^dark wizard$/i;
const LOOT = /talisman$|^(nature|law|chaos|death|blood|cosmic|mind|body|water|fire|earth|air) rune$/i;
const FOOD_TAKE = 10;
const MAX_KILLS_PER_TRIP = 150;

function bestBow(q: Quest): RegExp | null {
    const lvl = q.level('ranged');
    for (const [re, need] of BOWS) {
        if (lvl < need) continue;
        if (q.sdk.findEquipmentItem(re) || q.sdk.findInventoryItem(re) || q.sdk.findBankItem(re)) return re;
    }
    return null;
}

const heldCount = (q: Quest, re: RegExp) => q.sdk.getInventory().filter((i) => re.test(i.name)).reduce((n, i) => n + (i.count ?? 1), 0);
const quiver = (q: Quest) => q.sdk.getEquipment().filter((e) => e && ARROWS.test(e.name)).reduce((n, e) => n + (e!.count ?? 1), 0);
const hp = (q: Quest) => q.sdk.getSkill('Hitpoints');

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
    const bow = bestBow(q);
    if (!bow) throw new Error('no shortbow the Ranged level allows in the bank or worn');
    if (!sdk.findEquipmentItem(bow)) {
        const b = sdk.findBankItem(bow);
        if (b) await bot.withdrawItem(b, 1);
    }
    const arrows = sdk.findBankItem(/^iron arrow$/i) ?? sdk.findBankItem(/^bronze arrow$/i);
    if (arrows) await bot.withdrawItem(arrows, arrows.count);
    const food = sdk.findBankItem(FOOD);
    if (food) await bot.withdrawItem(food, Math.min(FOOD_TAKE, food.count));
    await sdk.waitForTicks(2).catch(() => undefined);
    await bot.closeBank();
    const bowItem = sdk.findInventoryItem(bow);
    if (bowItem) await bot.equipItem(bowItem);
    const arrowItem = sdk.findInventoryItem(ARROWS);
    if (arrowItem) await bot.equipItem(arrowItem);
    await sdk.waitForTicks(2).catch(() => undefined);
    q.log(`restock: ${sdk.getEquipment().filter(Boolean).map((e) => `${e!.name}${(e!.count ?? 1) > 1 ? ` x${e!.count}` : ''}`).join(', ')} | food ${heldCount(q, FOOD)} | Ranged ${q.level('ranged')}`);
    return quiver(q) > 0;
}

/** Talismans, runes and our own arrows near the circle. */
async function loot(q: Quest): Promise<number> {
    let got = 0;
    for (let i = 0; i < 8; i++) {
        if (q.sdk.getInventory().length >= 28) break;
        const g = q.sdk.findGroundItem(LOOT, { reachable: true }) ?? q.sdk.findGroundItem(ARROWS, { reachable: true });
        if (!g || (g.distance ?? 99) > 8) break;
        const before = heldCount(q, LOOT) + heldCount(q, ARROWS);
        await q.bot.pickupItem(g).catch(() => undefined);
        await q.sdk.waitForCondition(() => heldCount(q, LOOT) + heldCount(q, ARROWS) > before, 4_000).catch(() => undefined);
        if (/talisman$/i.test(g.name)) {
            got++;
            q.log(`LOOT ${g.name}`);
        }
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
                const npc = sdk.findNearbyNpc(WIZARD, { reachable: true });
                if (!npc) {
                    await q.goTo(CIRCLE, 4).catch(() => undefined);
                    await sdk.waitForTicks(3).catch(() => undefined);
                    continue;
                }
                const r = await bot.attack(npc).catch(() => null);
                if (!r?.success) {
                    await sdk.waitForTicks(2).catch(() => undefined);
                    continue;
                }
                // Until it dies (gone from view or 0 hp) or the fight stops for 10 ticks.
                let idle = 0;
                for (let t = 0; t < 80; t++) {
                    await sdk.waitForTicks(1).catch(() => undefined);
                    const n = sdk.getNearbyNpcs().find((x) => x.index === npc.index);
                    if (!n || n.hp === 0) {
                        kills++;
                        tripKills++;
                        break;
                    }
                    idle = sdk.getState()?.player?.combat.inCombat ? 0 : idle + 1;
                    if (idle >= 10) break;
                }
                talismans += await loot(q);
                if (kills % 25 === 0 && tripKills > 0) q.log(`kills ${kills} | Ranged ${q.level('ranged')} | arrows ${quiver(q)} | talismans looted ${talismans}`);
            }
        }
        q.log('dark-wizards-range: stop requested');
    },
});
