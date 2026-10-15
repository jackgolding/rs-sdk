/**
 * Edgeville chaos druids — range. Startup: park rune pickaxe, note herbs,
 * mule notes to jacklove1. Then shortbow + bronze arrows (Fatpig loop);
 * at Ranged 50, magic shortbow + Snapshot spec on cooldown.
 *
 *   bun bots/quests/edgeville-range-druids.ts jacklove1
 */
import { join } from 'path';
import { ActivitySession } from '../../sdk/index';
import { runScript } from '../../sdk/runner';
import { walkKandarinToEdgeville } from './movement';

const botName =
    process.argv.slice(2).find((a) => !a.startsWith('-') && !/^(spiders|druids)$/i.test(a)) ?? '';
const HUNT_SPIDERS = process.argv.slice(2).some((a) => /^spiders$/i.test(a));
const IS_MULE = /^jacklove1$/i.test(botName) && !HUNT_SPIDERS;
/** Opt-in: jacklove2-5 trade herb notes to jacklove1, which must be ranging here too. */
const MULE_HERBS = process.argv.includes('--mule-herbs') && /^jacklove[1-5]$/i.test(botName);
const GRIND_LOG = join(process.cwd(), 'bots', botName, 'grind.log');
const STUCK_EXIT_MS = 30 * 60 * 1000;

const EDGEVILLE_BANK = { x: 3094, z: 3492 };
const VARROCK_SQUARE = { x: 3210, z: 3429 };
const LOWE = { x: 3232, z: 3423 };
const DUNGEON_LADDER = { x: 3096, z: 9867 };
const WILDY_GATE = { x: 3103, z: 9909 };
const DRUIDS = { x: 3114, z: 9929 };
/** Deadly red spiders — sit north so both egg piles are in range. */
const SPIDERS = { x: 3118, z: 9957 };
const EGG_SOUTH = { x: 3118, z: 9950 };
const EGG_NORTH = { x: 3118, z: 9958 };
const CAMP = HUNT_SPIDERS ? SPIDERS : DRUIDS;
const NPC = HUNT_SPIDERS ? /^(deadly )?red spider$/i : /^chaos druid$/i;
const EGGS = /^red spiders?'? eggs?$/i;
const SKELETON_LINE = 9940;
/** Underground wildy: z 9920 is level 1, every 8 tiles +1. Level 5 is z 9952. */
const WILDY_LEVEL_5 = 9952;
/** OSRS-style tolerance: 10 minutes in one 21×21 area, then NPCs stop hunting. */
const AGGRO_MS = 10 * 60 * 1000;
/** South of the camp's 21×21 box, at the wilderness gate — not red spiders / bone piles. */
const AGGRO_SOUTH = { x: 3108, z: 9914 };

const FOOD_WITHDRAW = /^jacklove3$/i.test(botName) ? 8 : 4;
const ARROW_WITHDRAW = 1000;
const ARROW_RESTOCK_BELOW = 80;
const COIN_WITHDRAW = 15_000;
const LOWE_BRONZE_STOCK = 2000;
const RANGED_MSB = 50;
const COMBAT_BOW_SPECBAR = 7537;
const MSB_SPEC_COST = 350;
const SPEC_MAX = 1000;
const SPEC_REGEN = 100;
const SPEC_REGEN_TICKS = 50;

const HERB =
    /^(herb|guam leaf|marrentill|tarromin|harralander|ranarr weed|toadflax|irit leaf|avantoe|kwuarm|cadantine|lantadyme|dwarf weed|torstol|.+ (leaf|weed))$/i;
const RUNE = /rune$/i;
const COINS = /^coins$/i;
const LOOT =
    /^(herb|guam leaf|marrentill|tarromin|harralander|ranarr weed|toadflax|irit leaf|avantoe|kwuarm|cadantine|lantadyme|dwarf weed|torstol|coins|.+ rune)$/i;
const BONES = /^bones$/i;
const FOOD = /^(tuna|bass|swordfish|lobster|shark)$/i;
const BRONZE_ARROW = /^bronze arrows?$/i;
const ARROW = /^(bronze|iron|steel|mithril|adamant|rune) arrows?$/i;
const MAGIC_SHORTBOW = /^magic shortbow$/i;
const SHORTBOW = /^shortbow$/i;
const LOWE_BOWS = [SHORTBOW, /^oak shortbow$/i, /^longbow$/i, /^oak longbow$/i];
const BOW = /bow/i;
const RUNE_PICK = /^rune pickaxe$/i;
const KEEP =
    /^(tuna|bass|swordfish|lobster|shark|coins|(bronze|iron|steel|mithril|adamant|rune) arrows?|magic shortbow|shortbow|.+bow)$/i;
const JACKLOVE1 = /^jacklove1$/i;
const JACKLOVE_WORKERS = /^jacklove[2-5]$/i;

await runScript(async ({ bot, sdk }) => {
    const session = new ActivitySession(sdk, bot, {
        name: 'edgeville-range-druids',
        grindLogPath: GRIND_LOG,
        stallMs: 300_000
    });
    const log = (msg: string) => session.log('log', msg);

    let specEnergy = SPEC_MAX;
    let specArmed = false;
    let lastSpecRegenTick = -1;
    let aggroSince = Date.now();
    let packCalmSince: number | null = null;
    let resettingAggro = false;

    const pos = () => {
        const p = sdk.getState()?.player;
        return {
            x: p?.worldX ?? 0,
            z: p?.worldZ ?? 0,
            level: p?.level ?? 0,
            hp: p?.hp ?? 10,
            maxHp: p?.maxHp ?? 10,
            isDead: p?.isDead ?? false,
            inCombat: p?.combat?.inCombat ?? false,
            targetType: p?.combat?.targetType ?? 'none',
            targetIndex: p?.combat?.targetIndex ?? -1
        };
    };
    const distTo = (x: number, z: number) => Math.hypot(pos().x - x, pos().z - z);
    const inDungeon = () => pos().z > 6400;
    const countItems = (pattern: RegExp) =>
        sdk.getInventory().filter((i) => pattern.test(i.name)).reduce((n, i) => n + i.count, 0);
    const occupiedSlots = () => sdk.getInventory().filter((i) => (i.count ?? 0) > 0).length;
    const herbSlots = () => sdk.getInventory().filter((i) => HERB.test(i.name)).length;
    const eggCount = () => countItems(EGGS);
    const foodCount = () => countItems(FOOD);
    let eggPatrolNorth = true;
    const findFood = () => sdk.findInventoryItem(FOOD);
    const arrowCount = () => {
        const worn = sdk.getEquipment().filter((i) => ARROW.test(i.name)).reduce((n, i) => n + i.count, 0);
        return worn + countItems(ARROW);
    };
    const coins = () => sdk.findInventoryItem(COINS)?.count ?? 0;
    const rangedLevel = () => sdk.getSkill('Ranged')?.baseLevel ?? 1;
    const rangedXp = () => sdk.getSkill('Ranged')?.experience ?? 0;
    // Some awaits never settle once the SDK controller drops ("no controller
    // attached" for hours); exit non-zero so launchd relaunches the job.
    let watchXp = rangedXp();
    let watchXpAt = Date.now();
    setInterval(() => {
        const xp = rangedXp();
        if (xp !== watchXp) {
            watchXp = xp;
            watchXpAt = Date.now();
        } else if (Date.now() - watchXpAt > STUCK_EXIT_MS) {
            console.error(`[watchdog] no Ranged XP for ${Math.round(STUCK_EXIT_MS / 60000)}m — exiting for relaunch`);
            process.exit(1);
        }
    }, 60_000).unref();
    const hasMagicShortbow = () =>
        !!(sdk.findEquipmentItem(MAGIC_SHORTBOW) || sdk.findInventoryItem(MAGIC_SHORTBOW));
    const hasShortbow = () => !!(sdk.findEquipmentItem(SHORTBOW) || sdk.findInventoryItem(SHORTBOW));
    const hasBow = () =>
        hasMagicShortbow() || hasShortbow() || !!(sdk.findEquipmentItem(BOW) || sdk.findInventoryItem(BOW));
    const hasPickaxe = () => !!(sdk.findEquipmentItem(RUNE_PICK) || sdk.findInventoryItem(RUNE_PICK));
    const hasHerbs = () => herbSlots() > 0;
    const wantMsb = () => rangedLevel() >= RANGED_MSB;

    async function intent(msg: string): Promise<void> {
        await sdk.showIntent(msg).catch(() => {});
    }

    async function closeUi(): Promise<void> {
        await bot.dismissBlockingUI();
        if (sdk.getState()?.shop?.isOpen) await bot.closeShop();
        if (sdk.getState()?.bank?.isOpen) await bot.closeBank();
        if (sdk.getState()?.interface?.isOpen) await bot.closeInterface();
    }

    async function ensureGroundFloor(): Promise<void> {
        for (let i = 0; i < 8 && pos().level > 0; i++) {
            const loc = sdk.findNearbyLoc(/ladder|stair/i, { withOption: /down/i });
            if (loc) {
                await bot.interactLoc(loc, /down/i);
                await sdk.waitForCondition((s) => (s.player?.level ?? 1) === 0, 8_000).catch(() => {});
            }
            await sdk.waitForTicks(1);
        }
    }

    async function leaveVarrockEastBank(): Promise<void> {
        if (pos().level > 0) {
            const down = sdk.findNearbyLoc(/stair|ladder/i, { withOption: /down/i });
            if (down) {
                await bot.interactLoc(down, /down/i);
                await sdk.waitForCondition((s) => (s.player?.level ?? 1) === 0, 8_000).catch(() => {});
            }
            await ensureGroundFloor();
        }
        if (pos().x > 3225 || pos().level > 0) {
            await bot.walkTo(VARROCK_SQUARE.x, VARROCK_SQUARE.z, 4);
            log(`Left Varrock east @ ${pos().x},${pos().z}`);
        }
    }

    async function eatIfNeeded(): Promise<void> {
        const p = pos();
        if (p.hp > 16) return;
        const food = findFood();
        if (!food) return;
        const r = await bot.eatFood(food);
        if (r.success) log(`Ate ${food.name} +${r.hpGained} HP ${pos().hp}/${pos().maxHp} left=${foodCount()}`);
        else log(`Eat failed: ${r.message} HP ${p.hp}/${p.maxHp}`);
    }

    async function walkNear(x: number, z: number, tolerance = 6): Promise<boolean> {
        if (pos().hp <= 16) await eatIfNeeded();
        if (pos().level > 0) await ensureGroundFloor();
        if (inDungeon() && z < 6400) await climbToSurface();
        if (!inDungeon() && z > 6400) {
            await climbIntoDungeon();
            if (!inDungeon()) return false;
        }
        if (!HUNT_SPIDERS && inDungeon() && z >= SKELETON_LINE) z = SKELETON_LINE - 2;
        if (pos().x > 3225 && x < 3200) await leaveVarrockEastBank();
        if (distTo(x, z) <= tolerance) return true;
        const result = await bot.walkTo(x, z, Math.min(tolerance, 3));
        log(`walkTo(${x},${z}): ${result.success ? 'ok' : result.message} @ ${pos().x},${pos().z} L${pos().level}`);
        return result.success || distTo(x, z) <= tolerance + 2;
    }

    async function openBankAt(x: number, z: number): Promise<boolean> {
        if (inDungeon()) await climbToSurface();
        if (sdk.getState()?.shop?.isOpen) await bot.closeShop();
        if (sdk.getState()?.bank?.isOpen) {
            if (distTo(x, z) <= 8) return true;
            await bot.closeBank();
        }
        if (sdk.getState()?.interface?.isOpen && !sdk.getState()?.bank?.isOpen) await bot.closeInterface();
        if (!inDungeon() && pos().x < 2990 && x >= 2990) {
            log(`Kandarin @ ${pos().x},${pos().z} — walking to Edgeville over White Wolf`);
            await walkKandarinToEdgeville(bot, sdk, { eat: eatIfNeeded, walkNear });
        }
        await walkNear(x, z, 4);
        if (sdk.getState()?.bank?.isOpen) return true;
        const opened = await bot.openBank();
        if (!opened.success) {
            log(`openBank failed: ${opened.message}`);
            return false;
        }
        return true;
    }

    async function climbIntoDungeon(): Promise<boolean> {
        if (inDungeon()) return true;
        await walkNear(3095, 3468, 1);
        for (let attempt = 0; attempt < 4 && !inDungeon(); attempt++) {
            const trap = sdk.findNearbyLoc(/trapdoor/i);
            log(`Trapdoor try ${attempt}: ${trap ? trap.name : 'none'} @ ${pos().x},${pos().z}`);
            if (!trap) {
                await sdk.waitForTicks(1);
                continue;
            }
            if (trap.optionsWithIndex.some((o) => /^open$/i.test(o.text))) {
                await bot.interactLoc(trap, /^open$/i);
                await sdk.waitForCondition(
                    (s) =>
                        (s.nearbyLocs ?? []).some(
                            (l) => /trapdoor/i.test(l.name) && l.optionsWithIndex.some((o) => /climb-down/i.test(o.text))
                        ),
                    6_000
                ).catch(() => {});
            }
            const down = sdk.findNearbyLoc(/trapdoor/i, { withOption: /climb-down/i });
            if (down) {
                await bot.interactLoc(down, /climb-down/i);
                await sdk.waitForCondition((s) => (s.player?.worldZ ?? 0) > 6400, 8_000).catch(() => {});
            }
        }
        log(`Dungeon ${inDungeon()} @ ${pos().x},${pos().z}`);
        return inDungeon();
    }

    async function climbToSurface(): Promise<boolean> {
        if (!inDungeon()) return true;
        await eatIfNeeded();
        if (pos().z >= WILDY_GATE.z) {
            await walkNear(WILDY_GATE.x, WILDY_GATE.z + 6, 3);
            const gate = sdk.findNearbyLoc(/gate/i, { withOption: /open/i });
            if (gate) await bot.openDoor(gate);
            await walkNear(WILDY_GATE.x, WILDY_GATE.z - 6, 3);
        }
        await walkNear(DUNGEON_LADDER.x, DUNGEON_LADDER.z, 2);
        const ladder = sdk.findNearbyLoc(/^ladder$/i, { withOption: /climb-up/i });
        if (ladder) {
            await bot.interactLoc(ladder, /climb-up/i);
            await sdk.waitForCondition((s) => (s.player?.worldZ ?? 0) < 6400, 10_000).catch(() => {});
        }
        log(`Surface ${!inDungeon()} @ ${pos().x},${pos().z}`);
        return !inDungeon();
    }

    async function depositJunk(): Promise<void> {
        for (let i = 0; i < 40; i++) {
            const item = sdk.getInventory().find((it) => !KEEP.test(it.name));
            if (!item) break;
            const r = await bot.depositItem(
                new RegExp(`^${item.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i'),
                -1
            );
            log(`Deposit ${item.name}: ${r.success || r.partial} ${r.message ?? ''}`);
            if (!r.success && !r.partial) break;
        }
        if (sdk.findInventoryItem(COINS)) {
            const r = await bot.depositItem(COINS, -1);
            log(`Deposit coins: ${r.success || r.partial} ${r.message ?? ''}`);
        }
    }

    async function ensureBankOpen(): Promise<boolean> {
        if (sdk.getState()?.bank?.isOpen) return true;
        const opened = await bot.openBank();
        if (!opened.success) {
            log(`Re-open bank failed: ${opened.message}`);
            return false;
        }
        return true;
    }

    async function parkPickaxe(): Promise<void> {
        if (sdk.findEquipmentItem(RUNE_PICK)) {
            const r = await bot.unequipItem(RUNE_PICK);
            log(`Unequip rune pickaxe: ${r.success ? 'ok' : r.message}`);
        }
        if (!(await ensureBankOpen())) return;
        if (sdk.findInventoryItem(RUNE_PICK)) {
            const r = await bot.depositItem(RUNE_PICK, -1);
            log(`Deposit rune pickaxe: ${r.success || r.partial} ${r.message ?? ''}`);
        }
    }

    async function noteAllHerbs(): Promise<number> {
        while (sdk.findInventoryItem(HERB)) {
            const herb = sdk.findInventoryItem(HERB)!;
            const r = await bot.depositItem(herb, -1);
            log(`Deposit herb ${herb.name}: ${r.success || r.partial} ${r.message ?? ''}`);
            if (!r.success && !r.partial) break;
        }
        for (let i = 0; i < 40; i++) {
            const herb = sdk.findBankItem(HERB);
            if (!herb) break;
            const r = await bot.withdrawItem(herb, -1, { asNote: true });
            log(`Note ${herb.name}: ${r.success || r.partial} ${r.message ?? ''} now ${herbSlots()} herb slots`);
            if (!r.success && !r.partial) break;
        }
        return herbSlots();
    }

    function herbGiveSpecs(): { item: RegExp; amount: number }[] {
        const ids = [...new Set(sdk.getInventory().filter((i) => HERB.test(i.name)).map((i) => i.id))];
        return ids.map(() => ({ item: HERB, amount: -1 }));
    }

    async function dumpPickAndMuleHerbs(): Promise<void> {
        if (hasBow() && !hasPickaxe()) return;
        if (!hasPickaxe() && !hasHerbs()) return;
        await intent(IS_MULE ? 'note herbs, receive from jacklove2-5' : 'note herbs, trade jacklove1');
        if (inDungeon()) await climbToSurface();
        await ensureGroundFloor();
        if (sdk.findEquipmentItem(RUNE_PICK)) {
            const r = await bot.unequipItem(RUNE_PICK);
            log(`Unequip rune pickaxe: ${r.success ? 'ok' : r.message}`);
        }
        if (!(await openBankAt(EDGEVILLE_BANK.x, EDGEVILLE_BANK.z))) return;
        await parkPickaxe();
        if (!(await ensureBankOpen())) return;
        const noted = await noteAllHerbs();
        log(`Noted herbs for jacklove1: ${noted} slots`);
        await bot.closeBank();

        if (IS_MULE) {
            log('Serving jacklove herb trades');
            await intent('serving jacklove2-5 herb notes');
            const served = await bot.serveTrades({
                from: JACKLOVE_WORKERS,
                accept: (offer) => offer.some((i) => HERB.test(i.name)),
                maxTrades: 4,
                timeout: 8 * 60_000,
                tradeTimeout: 120_000
            });
            log(`Serve herbs: ${served.message} completed=${served.trades.filter((t) => t.success).length}`);
            if (!(await openBankAt(EDGEVILLE_BANK.x, EDGEVILLE_BANK.z))) return;
            await parkPickaxe();
            while (sdk.findInventoryItem(HERB)) {
                const herb = sdk.findInventoryItem(HERB)!;
                await bot.depositItem(herb, -1);
            }
            await bot.closeBank();
            return;
        }

        if (noted < 1) {
            log('No herbs to trade — continuing');
            return;
        }

        const give = herbGiveSpecs();
        let traded = false;
        let attempt = 0;
        while (!traded) {
            attempt++;
            await intent(`waiting to trade jacklove1 — ${herbSlots()} herb slots (${attempt})`);
            const partner = sdk.findNearbyPlayer(JACKLOVE1);
            if (!partner) {
                log(`Waiting to trade jacklove1 (${attempt}) @ ${pos().x},${pos().z}`);
                if (distTo(EDGEVILLE_BANK.x, EDGEVILLE_BANK.z) > 6) {
                    await waitNearBank();
                }
                await sdk.waitForTicks(10);
                continue;
            }
            log(`jacklove1 in range — sending trade (${attempt})`);
            const r = await bot.trade(partner, {
                give,
                want: [],
                retryOnBusy: true,
                requestTimeout: 180_000,
                timeout: 120_000
            });
            log(`Trade jacklove1: ${r.success ? 'ok' : r.message}`);
            traded = r.success;
            if (!traded) await sdk.waitForTicks(5);
        }
    }

    async function waitNearBank(): Promise<void> {
        await walkNear(EDGEVILLE_BANK.x, EDGEVILLE_BANK.z, 3);
    }

    async function restockArrowsAtLowe(): Promise<void> {
        if (arrowCount() >= ARROW_RESTOCK_BELOW) {
            log(`Arrows ok (${arrowCount()}) — skip Lowe`);
            return;
        }
        log(`Bank-run Lowe restock arrows=${arrowCount()} bow=${hasBow()} gp=${coins()}`);
        await intent('buy bronze arrows at Lowe');
        if (!(await openBankAt(EDGEVILLE_BANK.x, EDGEVILLE_BANK.z))) return;
        await depositJunk();
        if (!hasBow()) {
            const r = await bot.withdrawItem(SHORTBOW, 1);
            if (!(r.success || r.partial)) await bot.withdrawItem(BOW, 1).catch(() => {});
            log(`Withdraw bow: ${hasBow()}`);
        }
        if (coins() < COIN_WITHDRAW) {
            const bankGp = sdk.findBankItem(COINS)?.count ?? 0;
            if (bankGp > 0) {
                const r = await bot.withdrawItem(COINS, Math.min(COIN_WITHDRAW - coins(), bankGp));
                log(`Withdraw coins for Lowe: ${r.success || r.partial} now ${coins()}gp`);
            }
        }
        await bot.closeBank();
        if (coins() < 1) {
            log('No coins for Lowe');
            return;
        }

        await walkNear(LOWE.x, LOWE.z, 3);
        const opened = await bot.openShop(/lowe/i);
        if (!opened.success && !sdk.getState()?.shop?.isOpen) {
            log(`Lowe shop failed: ${opened.message}`);
            return;
        }

        if (!hasBow()) {
            // Lowe stocks only 4 shortbows; fall back down the list when they sell out.
            const items = sdk.getState()?.shop?.shopItems ?? [];
            const bowLine = LOWE_BOWS.map((b) => items.find((i) => b.test(i.name) && i.count > 0)).find(Boolean);
            if (bowLine) {
                const r = await bot.buyFromShop(bowLine, 1);
                if (!r.success) await sdk.waitForTicks(4);
                log(`Buy ${bowLine.name}: ${r.success || hasBow() ? 'ok' : r.message}`);
                await equipGear();
            } else {
                log('Lowe has no bows in stock');
            }
        }

        // A plain shortbow fires bronze and iron only.
        const tiers = [
            { name: 'bronze', pattern: BRONZE_ARROW, stock: LOWE_BRONZE_STOCK },
            { name: 'iron', pattern: /^iron arrows?$/i, stock: 1500 }
        ];
        const tier =
            tiers.find((t) => (sdk.getState()?.shop?.shopItems.find((i) => t.pattern.test(i.name))?.count ?? 0) > 0) ??
            tiers[0]!;
        const shopLine = () => sdk.getState()?.shop?.shopItems.find((i) => tier.pattern.test(i.name)) ?? null;
        const liveBuyPrice = (line: { count: number; baseCost?: number }) => {
            const cfg = sdk.getState()?.shop?.shopConfig;
            const cost = line.baseCost || 1;
            const haggle = cfg?.haggle ?? 10;
            const sellMult = cfg?.sellMultiplier ?? 1000;
            const stockDiff = (line.count ?? 0) - tier.stock;
            const raw = Math.min(1000, Math.max(-5000, stockDiff * haggle));
            return Math.max(1, Math.floor((cost * Math.max(100, sellMult - raw)) / 1000));
        };

        const before = arrowCount();
        let stall = 0;
        while (stall < 4 && coins() >= 1 && arrowCount() - before < ARROW_WITHDRAW) {
            const line = shopLine();
            if (!line || line.count <= 0) break;
            if (coins() < liveBuyPrice(line)) break;
            const stockBefore = line.count;
            const room = ARROW_WITHDRAW - (arrowCount() - before);
            const clicks = Math.min(8, Math.ceil(Math.min(stockBefore, Math.max(10, room)) / 10));
            for (let n = 0; n < clicks; n++) {
                const r = await sdk.sendShopBuy(line.slot, 10);
                if (!r.success) {
                    log(`Buy ${tier.name} send failed: ${r.message}`);
                    stall = 99;
                    break;
                }
            }
            await sdk.waitForTicks(1);
            const stockAfter = shopLine()?.count ?? 0;
            if (stockAfter >= stockBefore) stall++;
            else stall = 0;
        }
        log(
            `Bought ${arrowCount() - before} ${tier.name} arrows | shelf ${shopLine()?.count ?? 0} | ${coins()}gp | total ${arrowCount()}`
        );
        await bot.closeShop();
        await equipGear();
        await leaveVarrockEastBank();
    }

    async function withdrawFoodAndSpareArrows(): Promise<void> {
        if (wantMsb() && !hasMagicShortbow()) {
            const bow = sdk.findBankItem(MAGIC_SHORTBOW);
            if (bow) {
                const r = await bot.withdrawItem(bow, 1, { asNote: false });
                log(`Withdraw magic shortbow: ${r.success || r.partial}`);
            } else {
                log('No magic shortbow in bank at 50 range');
            }
        }
        if (!hasBow()) {
            await bot.withdrawItem(SHORTBOW, 1).catch(() => {});
            if (!hasBow()) await bot.withdrawItem(BOW, 1).catch(() => {});
        }
        const extra = arrowCount() - ARROW_WITHDRAW;
        if (extra > 0 && sdk.findInventoryItem(BRONZE_ARROW)) {
            const r = await bot.depositItem(BRONZE_ARROW, extra);
            log(`Park extra arrows: ${r.success || r.partial} now ${arrowCount()}`);
        }
        const needArrows = ARROW_WITHDRAW - arrowCount();
        if (needArrows > 0) {
            const bankArrows = sdk.findBankItem(BRONZE_ARROW)?.count ?? 0;
            if (bankArrows > 0) {
                const r = await bot.withdrawItem(BRONZE_ARROW, Math.min(needArrows, bankArrows));
                log(`Bank bronze arrows: ${r.success || r.partial} now ${arrowCount()}`);
            }
        }
        const extraFood = foodCount() - FOOD_WITHDRAW;
        if (extraFood > 0 && sdk.findInventoryItem(FOOD)) {
            const r = await bot.depositItem(FOOD, extraFood);
            log(`Park extra food: ${r.success || r.partial} now ${foodCount()}`);
        }
        const haveFood = foodCount();
        if (haveFood < FOOD_WITHDRAW) {
            const stocked = (sdk.getState()?.bank?.items ?? []).find((i) => (i.count ?? 0) > 0 && FOOD.test(i.name));
            const bankFood = stocked?.count ?? 0;
            if (stocked && bankFood > 0) {
                const r = await bot.withdrawItem(stocked, Math.min(FOOD_WITHDRAW - haveFood, bankFood));
                log(`Withdraw food: ${r.success || r.partial} now ${foodCount()}`);
            }
        }
    }

    async function setRapid(): Promise<void> {
        const style = sdk.getState()?.combatStyle?.styles.find((s) => s.type === 'Rapid' || /rapid/i.test(s.name));
        if (!style) {
            log(
                `No Rapid style (tab known=${sdk.getState()?.combatStyle?.known} weapon=${sdk.getState()?.combatStyle?.weaponName})`
            );
            return;
        }
        if (sdk.getState()?.combatStyle?.currentStyle === style.index) return;
        await sdk.sendSetCombatStyle(style.index);
        await sdk.waitForCondition((s) => s.combatStyle?.currentStyle === style.index, 5_000).catch(() => {});
        log(`Combat style ${style.name} (${style.type}) trains ${style.trainsSkills.join('+')}`);
    }

    function tickSpecRegen(): void {
        const tick = sdk.getState()?.tick ?? 0;
        if (lastSpecRegenTick < 0) lastSpecRegenTick = tick;
        if (specEnergy >= SPEC_MAX) {
            lastSpecRegenTick = tick;
            return;
        }
        while (tick - lastSpecRegenTick >= SPEC_REGEN_TICKS && specEnergy < SPEC_MAX) {
            specEnergy = Math.min(SPEC_MAX, specEnergy + SPEC_REGEN);
            lastSpecRegenTick += SPEC_REGEN_TICKS;
        }
    }

    async function enableMsbSpec(): Promise<boolean> {
        if (!sdk.findEquipmentItem(MAGIC_SHORTBOW)) return false;
        tickSpecRegen();
        if (specEnergy < MSB_SPEC_COST) return false;
        if (specArmed) return true;
        await sdk.sendSetTab(0).catch(() => {});
        const r = await sdk.sendClickComponent(COMBAT_BOW_SPECBAR);
        if (!r.success) {
            log(`Spec bar click failed: ${r.message}`);
            return false;
        }
        specArmed = true;
        return true;
    }

    function noteSpecUsed(): void {
        if (!specArmed) return;
        specArmed = false;
        specEnergy = Math.max(0, specEnergy - MSB_SPEC_COST);
    }

    async function equipGear(): Promise<void> {
        if (wantMsb() && !sdk.findEquipmentItem(MAGIC_SHORTBOW)) {
            const magic = sdk.findInventoryItem(MAGIC_SHORTBOW);
            if (magic) {
                const r = await bot.equipItem(magic);
                log(`Equip magic shortbow: ${r.success ? 'ok' : r.message}`);
            }
        }
        if (!sdk.findEquipmentItem(BOW)) {
            const bow = sdk.findInventoryItem(SHORTBOW) ?? sdk.findInventoryItem(BOW);
            if (bow) {
                const r = await bot.equipItem(bow);
                log(`Equip ${bow.name}: ${r.success ? 'ok' : r.message}`);
            }
        }
        const arrows = sdk.findInventoryItem(BRONZE_ARROW) ?? sdk.findInventoryItem(ARROW);
        if (arrows) {
            const r = await bot.equipItem(arrows);
            if (r.success) log(`Wield ${arrows.count} ${arrows.name}`);
        }
        await setRapid();
    }

    async function prepareLoadout(): Promise<void> {
        await intent(`bank, shortbow + bronze arrows, ${FOOD_WITHDRAW} food`);
        if (inDungeon()) await climbToSurface();
        await ensureGroundFloor();
        await leaveVarrockEastBank();
        if (!(await openBankAt(EDGEVILLE_BANK.x, EDGEVILLE_BANK.z))) return;
        await depositJunk();
        await withdrawFoodAndSpareArrows();
        await bot.closeBank();
        await restockArrowsAtLowe();
        if (!(await openBankAt(EDGEVILLE_BANK.x, EDGEVILLE_BANK.z))) return;
        await depositJunk();
        await withdrawFoodAndSpareArrows();
        log(
            `Loadout food=${foodCount()} arrows=${arrowCount()} bow=${sdk.findEquipmentItem(BOW)?.name ?? sdk.findInventoryItem(BOW)?.name ?? 'none'}`
        );
        await bot.closeBank();
        await equipGear();
    }

    async function goToCamp(): Promise<void> {
        if (!inDungeon() && !(await climbIntoDungeon())) return;
        if (pos().z < WILDY_GATE.z - 4) {
            await walkNear(WILDY_GATE.x, WILDY_GATE.z - 2, 3);
            const gate = sdk.findNearbyLoc(/gate/i, { withOption: /open/i });
            if (gate) await bot.openDoor(gate);
        }
        if (HUNT_SPIDERS) {
            await walkNear(3105, 9943, 3);
            const northGate = sdk.findNearbyLoc(/gate/i, { withOption: /open/i });
            if (northGate) await bot.openDoor(northGate);
        }
        await walkNear(CAMP.x, CAMP.z, 6);
        aggroSince = Date.now();
        packCalmSince = null;
    }

    function nearbySkeleton() {
        return (
            (sdk.getNearbyNpcs() ?? []).find(
                (n) =>
                    /^skeleton$/i.test(n.name) &&
                    (n.hp === null || n.hp > 0) &&
                    (n.distance ?? 99) <= 8
            ) ?? null
        );
    }

    function fightingSkeleton(): boolean {
        const p = pos();
        if (!p.inCombat || p.targetType !== 'npc' || p.targetIndex < 0) return false;
        const target = sdk.getNearbyNpcs().find((n) => n.index === p.targetIndex);
        return !!target && /^skeleton$/i.test(target.name);
    }

    async function fleeSkeletons(): Promise<boolean> {
        if (HUNT_SPIDERS) return false;
        const tooNorth = pos().z >= SKELETON_LINE || pos().z >= WILDY_LEVEL_5;
        const skel = nearbySkeleton();
        if (!tooNorth && !skel && !fightingSkeleton()) return false;
        log(
            `Backing south` +
                (skel ? ` (skeleton ${skel.x},${skel.z})` : '') +
                (fightingSkeleton() ? ' (in skeleton combat)' : '') +
                (tooNorth ? ` (z ${pos().z})` : '')
        );
        await walkNear(CAMP.x, CAMP.z - 8, 3);
        if (pos().z >= SKELETON_LINE) await walkNear(AGGRO_SOUTH.x, AGGRO_SOUTH.z, 3);
        return true;
    }

    function packIsCalmBesideUs(): boolean {
        if (pos().inCombat) return false;
        return (sdk.getNearbyNpcs() ?? []).some(
            (n) =>
                NPC.test(n.name) &&
                !n.inCombat &&
                (n.hp === null || n.hp > 0) &&
                (n.distance ?? 99) <= 3
        );
    }

    async function resetAggro(): Promise<void> {
        resettingAggro = true;
        log(`Aggro reset — south to gate (${AGGRO_SOUTH.x},${AGGRO_SOUTH.z})`);
        await eatIfNeeded();
        await walkNear(AGGRO_SOUTH.x, AGGRO_SOUTH.z, 3);
        await eatIfNeeded();
        await sdk.waitForTicks(2);
        await walkNear(CAMP.x, CAMP.z, 5);
        aggroSince = Date.now();
        packCalmSince = null;
        resettingAggro = false;
        log(`Back at camp after aggro reset @ ${pos().x},${pos().z}`);
    }

    async function maybeResetAggro(): Promise<boolean> {
        if (HUNT_SPIDERS) return false;
        if (resettingAggro) return false;
        if (!inDungeon() || distTo(CAMP.x, CAMP.z) > 20) return false;
        if (pos().inCombat) {
            packCalmSince = null;
            return false;
        }
        if (packIsCalmBesideUs()) {
            packCalmSince ??= Date.now();
        } else {
            packCalmSince = null;
        }
        const timedOut = Date.now() - aggroSince >= AGGRO_MS;
        const lostEarly = packCalmSince !== null && Date.now() - packCalmSince >= 12_000;
        if (!timedOut && !lostEarly) return false;
        log(timedOut ? '10 min aggro timer — resetting' : 'Pack standing idle beside us — resetting');
        await resetAggro();
        return true;
    }

    async function keepRange(): Promise<void> {
        const p = pos();
        if (!p.inCombat || p.targetType !== 'npc') return;
        const target = sdk.getNearbyNpcs().find((n) => n.index === p.targetIndex);
        if ((target?.distance ?? 99) > 2) return;
        if (HUNT_SPIDERS) await walkNear(CAMP.x, CAMP.z, 3);
        else await walkNear(CAMP.x, CAMP.z - 5, 2);
    }

    async function buryBones(): Promise<void> {
        for (let i = 0; i < 8; i++) {
            const bones = sdk.findInventoryItem(BONES);
            if (!bones) return;
            const buryOpt = bones.optionsWithIndex.find((o) => /bury/i.test(o.text));
            if (!buryOpt) return;
            await sdk.sendUseItem(bones.slot, buryOpt.opIndex);
            await sdk.waitForTicks(1);
        }
    }

    function isArrowStack(g: { name: string; count: number }): boolean {
        return ARROW.test(g.name) && (g.count ?? 0) >= 5;
    }

    async function lootGround(): Promise<void> {
        for (let i = 0; i < 8; i++) {
            await eatIfNeeded();
            if (pos().hp <= 16) return;
            if (!HUNT_SPIDERS) await buryBones();
            if (occupiedSlots() >= 28) break;
            const ground = HUNT_SPIDERS
                ? await sdk.scanGroundItems(20)
                : (sdk.getGroundItems() ?? []);
            const item = ground
                .filter(
                    (g) =>
                        (HUNT_SPIDERS
                            ? EGGS.test(g.name) || isArrowStack(g)
                            : LOOT.test(g.name) || BONES.test(g.name) || isArrowStack(g)) &&
                        g.reachable !== false &&
                        (g.distance ?? 99) <= (HUNT_SPIDERS && EGGS.test(g.name) ? 16 : 8)
                )
                .sort((a, b) => {
                    const pri = (g: typeof a) =>
                        HUNT_SPIDERS
                            ? EGGS.test(g.name)
                                ? 0
                                : 1
                            : isArrowStack(g)
                              ? 0
                              : RUNE.test(g.name) || COINS.test(g.name) || HERB.test(g.name)
                                ? 1
                                : 2;
                    const d = pri(a) - pri(b);
                    if (d !== 0) return d;
                    return (a.distance ?? 99) - (b.distance ?? 99);
                })[0];
            if (!item) return;
            if ((item.distance ?? 99) > 2) await walkNear(item.x, item.z, 1);
            const r = await bot.pickupItem(item);
            if (!r.success) {
                log(`Pickup ${item.name} x${item.count} failed: ${r.message}`);
                return;
            }
            if (isArrowStack(item) || EGGS.test(item.name)) log(`Picked ${item.count} ${item.name}`);
        }
    }

    function findTarget() {
        const druids = (sdk.getNearbyNpcs() ?? [])
            .filter(
                (n) =>
                    NPC.test(n.name) &&
                    (n.hp === null || n.hp > 0) &&
                    (HUNT_SPIDERS ? n.z >= SKELETON_LINE - 2 : n.z < SKELETON_LINE) &&
                    n.optionsWithIndex.some((o) => /attack/i.test(o.text)) &&
                    n.reachable !== false
            )
            .sort((a, b) => (a.distance ?? 99) - (b.distance ?? 99));
        const myTarget = pos().targetIndex;
        const free = druids.filter((d) => !d.inCombat || d.index === myTarget);
        return free[0] ?? null;
    }

    function hasValidNpcTarget(): boolean {
        const p = pos();
        if (!p.inCombat || p.targetType !== 'npc' || p.targetIndex < 0) return false;
        const target = sdk.getNearbyNpcs().find((n) => n.index === p.targetIndex);
        return !!target && NPC.test(target.name) && (target.hp === null || target.hp > 0);
    }

    async function waitForDruidFight(): Promise<void> {
        const started = Date.now();
        while (hasValidNpcTarget() && !pos().isDead && Date.now() - started < 25_000) {
            await bot.dismissBlockingUI();
            await eatIfNeeded();
            await keepRange();
            if (arrowCount() <= 0) return;
            if (pos().hp <= 16) continue;
            await lootGround();
        }
    }

    async function shootDruid(): Promise<void> {
        if (hasValidNpcTarget()) {
            await waitForDruidFight();
            return;
        }

        const target = findTarget();
        if (!target) {
            if (HUNT_SPIDERS) await waitForEggs();
            else if (distTo(CAMP.x, CAMP.z) > 8) await walkNear(CAMP.x, CAMP.z, 5);
            else await sdk.waitForTicks(1);
            return;
        }

        const d = target.distance ?? 99;
        if (d > 8) await walkNear(target.x, target.z, 7);
        else if (d <= 2) {
            if (HUNT_SPIDERS) await walkNear(CAMP.x, CAMP.z, 3);
            else await walkNear(CAMP.x, CAMP.z - 5, 2);
        }

        const specced = await enableMsbSpec();
        const opt = target.optionsWithIndex.find((o) => /attack/i.test(o.text));
        if (!opt) return;
        const r = await sdk.sendInteractNpc(target.index, opt.opIndex);
        if (!r.success) {
            log(`Attack ${target.name}: ${r.message}`);
            return;
        }
        try {
            await sdk.waitForCondition((s) => {
                if (s.player?.combat?.inCombat) return true;
                const gone = !s.nearbyNpcs.some((n) => n.index === target.index && (n.hp === null || n.hp > 0));
                return gone;
            }, 8_000);
        } catch {
            /* recast next loop */
        }
        const noPower = (sdk.getState()?.gameMessages ?? []).some((m) => /enough power/i.test(m.text));
        if (noPower) {
            specArmed = false;
            specEnergy = Math.min(specEnergy, MSB_SPEC_COST - 1);
            log(`Spec not enough power — energy tracked ${specEnergy}`);
        } else if (specced) {
            noteSpecUsed();
        }
        await waitForDruidFight();
    }

    async function waitForEggs(): Promise<void> {
        const ground = await sdk.scanGroundItems(20);
        const eggs = ground.filter((g) => EGGS.test(g.name) && g.reachable !== false);
        if (eggs.length > 0) {
            const nearest = eggs.sort((a, b) => (a.distance ?? 99) - (b.distance ?? 99))[0];
            await walkNear(nearest.x, nearest.z, 1);
            await lootGround();
            return;
        }
        const dest = eggPatrolNorth ? EGG_NORTH : EGG_SOUTH;
        eggPatrolNorth = !eggPatrolNorth;
        log(`Waiting for eggs @ ${dest.x},${dest.z} (have ${eggCount()})`);
        await walkNear(dest.x, dest.z, 2);
        await sdk.waitForTicks(8);
    }

    log(
        `Range ${HUNT_SPIDERS ? 'deadly red spiders (eggs, no bury)' : 'chaos druids'} (rapid). Ranged ${rangedLevel()} (${rangedXp()} xp) @ ${pos().x},${pos().z} arrows=${arrowCount()} food=${foodCount()}`
    );
    await closeUi();

    if (!HUNT_SPIDERS && MULE_HERBS) await dumpPickAndMuleHerbs();
    await equipGear();
    if (
        !(
            inDungeon() &&
            hasBow() &&
            foodCount() >= FOOD_WITHDRAW &&
            arrowCount() >= ARROW_RESTOCK_BELOW
        )
    ) {
        await prepareLoadout();
    }
    await goToCamp();
    await setRapid();


    let lastRange = rangedLevel();
    while (true) {
        await bot.dismissBlockingUI();

        if (pos().isDead) {
            log('Died — waiting to respawn');
            await sdk.waitForCondition((s) => !s.player.isDead, 60_000).catch(() => {});
            log(`Respawned @ ${pos().x},${pos().z}`);
            await prepareLoadout();
            await goToCamp();
            continue;
        }

        if (pos().targetType === 'player' && pos().inCombat) {
            log('Player combat — running to ladder');
            await walkNear(DUNGEON_LADDER.x, DUNGEON_LADDER.z, 4);
            await climbToSurface();
            await prepareLoadout();
            await goToCamp();
            continue;
        }

        const range = rangedLevel();
        if (range >= 99 && !HUNT_SPIDERS) {
            session.stop('goal_reached', 'Ranged is 99');
            break;
        }
        if (range !== lastRange) {
            log(
                `LEVEL UP Ranged ${range} (${rangedXp()} xp) | food ${foodCount()} herbs ${herbSlots()} arrows ${arrowCount()}`
            );
            const crossedMsb = lastRange < RANGED_MSB && range >= RANGED_MSB;
            lastRange = range;
            if (crossedMsb) {
                await prepareLoadout();
                await goToCamp();
                continue;
            }
        }

        await eatIfNeeded();
        await keepRange();
        if (await fleeSkeletons()) continue;
        if (await maybeResetAggro()) continue;

        if (foodCount() === 0 || occupiedSlots() >= 28 || arrowCount() <= 0) {
            log(`Banking food=${foodCount()} herbs=${herbSlots()} arrows=${arrowCount()} slots=${occupiedSlots()}`);
            await prepareLoadout();
            if (foodCount() === 0) {
                session.stop('needs_supplies', 'Out of food after bank');
                break;
            }
            if (arrowCount() <= 0) {
                session.stop('needs_supplies', 'Out of arrows after bank');
                break;
            }
            if (!hasBow()) {
                session.stop('needs_supplies', 'No bow after bank');
                break;
            }
            await goToCamp();
            continue;
        }

        await lootGround();
        await equipGear();
        await intent(
            HUNT_SPIDERS
                ? `red spiders r${range} | eggs | ${arrowCount()} arr | food ${foodCount()}`
                : `rapid druids r${range} | ${arrowCount()} arr | food ${foodCount()}${wantMsb() ? ' msb' : ''}`
        );
        await shootDruid();
        await lootGround();
    }
    await session.finalizeStop();
});
