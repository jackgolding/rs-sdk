/**
 * Edgeville dungeon melee — trapdoor / wildy-gate / loot / bank loop with the
 * best owned melee weapon (dragon longsword > rune axe/pickaxe > metal
 * longsword/scimitar/sword/battleaxe). Buys a better longsword at the Varrock
 * swordshop when Attack allows one and the bank has the coins.
 *
 *   bun bots/quests/edgeville-dungeon-melee.ts jacklove1 druids
 *   bun bots/quests/edgeville-dungeon-melee.ts jacklove3 thugs
 *   bun bots/quests/edgeville-dungeon-melee.ts jacklove1 druids --herb-swap
 *   bun bots/quests/edgeville-dungeon-melee.ts Jackpoo3 druids --weapon "mithril sword"
 *
 * Starts anywhere in Kandarin: walks Ardougne → Catherby → White Wolf → Edgeville.
 * Bury bones. Loot herbs, nature/law runes, rares, then other runes/coins.
 * Trains Strength up to Attack, then Defence up to that level, then one level
 * at a time: Attack, then Strength, then Defence. Re-picks after each level.
 * If all three are 99, stays on Aggressive. `--herb-swap` trades banked herbs to
 * jackthief for a dragon longsword when none is owned.
 * `--weapon "mithril sword"` withdraws and wields that bank item only, and skips
 * the Varrock swordshop upgrade.
 */
import { join } from 'path';
import { ActivitySession } from '../../sdk/index';
import { runScript } from '../../sdk/runner';
import { waitForPlayerState, walkKandarinToEdgeville } from './movement';

function flagValue(flag: string): string {
    const eq = process.argv.find((a) => a.startsWith(`${flag}=`));
    if (eq) return eq.slice(flag.length + 1).trim();
    const i = process.argv.indexOf(flag);
    const next = i >= 0 ? process.argv[i + 1] : undefined;
    return next && !next.startsWith('-') ? next.trim() : '';
}

/** Exact item name. Skips the swordshop and any better weapon in the bank. */
const PINNED_WEAPON = flagValue('--weapon');
const botName =
    process.argv.slice(2).find((arg, i) => {
        if (arg.startsWith('-') || /^(druids|thugs)$/i.test(arg)) return false;
        return process.argv[i + 1] !== '--weapon';
    }) ?? '';
const targetArg = process.argv.slice(2).find((a) => /^(druids|thugs)$/i.test(a)) ?? 'druids';
const HUNT_THUGS = /^thugs$/i.test(targetArg);
const HERB_SWAP = process.argv.includes('--herb-swap');
const GRIND_LOG = join(process.cwd(), 'bots', botName, 'grind.log');
const VARROCK_WEST_GATE = { x: 3175, z: 3429 };
const SWORDSHOP = { x: 3204, z: 3398 };
const SHOP_COINS = 5_000;
const SHOP_RETRY_MS = 45 * 60 * 1000;
const LOADOUT_RETRIES = 4;

const EDGEVILLE_BANK = { x: 3094, z: 3492 };
const TRAPDOOR = { x: 3095, z: 3468 };
const DUNGEON_LADDER = { x: 3096, z: 9867 };
const WILDY_GATE = { x: 3103, z: 9909 };
const DRUIDS = { x: 3114, z: 9929 };
const THUGS = { x: 3123, z: 9929 };
const CAMP = HUNT_THUGS ? THUGS : DRUIDS;
const NPC = HUNT_THUGS ? /^thug$/i : /^chaos druid$/i;
const SKELETON_LINE = 9940;
/** Underground wildy: z 9920 is level 1, every 8 tiles +1. Level 5 is z 9952. */
const WILDY_LEVEL_5 = 9952;
const FOOD_WITHDRAW_MIN = 2;
/** OSRS-style tolerance: 10 minutes in one 21×21 area, then NPCs stop hunting. */
const AGGRO_MS = 10 * 60 * 1000;
/** South of the camp's 21×21 box, at the wilderness gate — not red spiders / bone piles. */
const AGGRO_SOUTH = { x: 3108, z: 9914 };

const HERB =
    /^(herb|guam leaf|marrentill|tarromin|harralander|ranarr weed|toadflax|irit leaf|avantoe|kwuarm|cadantine|lantadyme|dwarf weed|torstol|.+ (leaf|weed))$/i;
const GOOD_RUNE = /^(nature|law|death|cosmic|blood|chaos) rune$/i;
const JUNK_RUNE = /^(air|mind|water|earth|fire|body) rune$/i;
const COINS = /^coins$/i;
const RARE =
    /^(uncut )?(sapphire|emerald|ruby|diamond|dragonstone)$|^snape grass$|^bronze longsword$|^iron med helm$|^iron battleaxe$|^steel axe$|^clue scroll|^loop half of a key$|^tooth half of a key$|^left half shield$|^dragon spear$/i;
const BONES = /^bones$/i;

function isLoot(name: string): boolean {
    if (JUNK_RUNE.test(name)) return false;
    return HERB.test(name) || GOOD_RUNE.test(name) || RARE.test(name) || COINS.test(name);
}

function lootPriority(name: string): number {
    if (GOOD_RUNE.test(name)) return 0;
    if (HERB.test(name)) return 1;
    if (RARE.test(name)) return 2;
    if (COINS.test(name)) return 3;
    if (BONES.test(name)) return 9;
    return 5;
}
const FOOD = /^(tuna|bass|swordfish|lobster|cod|salmon|trout|shark)$/i;
const FOOD_PREFERENCE = ['Trout', 'Cod', 'Salmon', 'Tuna', 'Bass', 'Lobster', 'Swordfish', 'Shark'];
const DLONG = /^dragon longsword$/i;
const DDAGGER = /^dragon dagger/i;
const ESSENCE = /^(pure essence|rune essence)$/i;
const WEAPON =
    /^(dragon longsword|rune (axe|pickaxe)|(adamant|mithril|black|steel|iron|bronze) (longsword|scimitar|sword|battleaxe))$/i;
const METALS = ['bronze', 'iron', 'steel', 'black', 'mithril', 'adamant', 'rune', 'dragon'] as const;
const METAL_ATTACK: Record<(typeof METALS)[number], number> = {
    bronze: 1,
    iron: 1,
    steel: 5,
    black: 10,
    mithril: 20,
    adamant: 30,
    rune: 40,
    dragon: 60
};
/** Swordshop longsword, then sword, best first. */
const SHOP_TIERS = ['adamant', 'mithril', 'black', 'steel', 'iron', 'bronze'] as const;
const JACKTHIEF = /^Jackthief$/i;
const CYCLE = ['Attack', 'Strength', 'Defence'] as const;

function weaponRank(name: string): number {
    if (!WEAPON.test(name)) return -1;
    const metal = METALS.findIndex((m) => name.toLowerCase().startsWith(m));
    const shape = /longsword|scimitar/i.test(name) ? 2 : /pickaxe|axe$/i.test(name) && /^rune/i.test(name) ? 1 : /sword/i.test(name) ? 1 : 0;
    return metal * 10 + shape;
}

function weaponAttackReq(name: string): number {
    const metal = METALS.find((m) => name.toLowerCase().startsWith(m));
    return metal ? METAL_ATTACK[metal] : 1;
}

await runScript(async ({ bot, sdk }) => {
    const session = new ActivitySession(sdk, bot, {
        name: 'edgeville-dungeon-melee',
        grindLogPath: GRIND_LOG,
        stallMs: 300_000
    });
    const log = (msg: string) => session.log('log', msg);

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
    /** 5292 is the bank. `bank.isOpen` can lag a frame behind the modal. */
    const bankUiOpen = () => {
        const s = sdk.getState();
        return !!(s?.bank?.isOpen || s?.interface?.interfaceId === 5292);
    };
    /** Booth options are Withdraw 1/5/10/All. Any other amount opens Withdraw-X and stalls. */
    const bankChunk = (need: number, available: number) => {
        const cap = Math.max(1, Math.min(need, available));
        if (cap >= 10) return 10;
        if (cap >= 5) return 5;
        return 1;
    };
    const inDungeon = () => pos().z > 6400;
    const count = (pattern: RegExp) =>
        sdk.getInventory().filter((i) => pattern.test(i.name)).reduce((n, i) => n + (i.count ?? 1), 0);
    const occupied = () => sdk.getInventory().filter((i) => (i.count ?? 0) > 0).length;
    const canEat = (item: { optionsWithIndex?: { text: string }[] }) =>
        (item.optionsWithIndex ?? []).some((o) => /eat/i.test(o.text));
    const foodCount = () =>
        sdk
            .getInventory()
            .filter((i) => FOOD.test(i.name) && canEat(i))
            .reduce((n, i) => n + (i.count ?? 1), 0);
    const herbSlots = () => sdk.getInventory().filter((i) => HERB.test(i.name)).length;
    const skill = (name: (typeof CYCLE)[number]) => sdk.getSkill(name)?.baseLevel ?? 1;
    /** Names whose equip failed (Lost City for dragon, too-low Attack). Never retried this run. */
    const cantWield = new Set<string>();
    const canWieldDlong = () => !cantWield.has('dragon longsword');
    const isPinned = (name: string) => !PINNED_WEAPON || name.toLowerCase() === PINNED_WEAPON.toLowerCase();
    const wieldable = (name: string) =>
        isPinned(name) &&
        WEAPON.test(name) &&
        !cantWield.has(name.toLowerCase()) &&
        weaponAttackReq(name) <= skill('Attack');
    const ownedWeapons = () =>
        [...sdk.getEquipment(), ...sdk.getInventory()].filter((i) => (i.count ?? 1) > 0 && wieldable(i.name));
    const hasWeapon = () => ownedWeapons().length > 0;
    const bestOwnedRank = () => Math.max(-1, ...ownedWeapons().map((i) => weaponRank(i.name)));
    const shouldKeep = (name: string) => FOOD.test(name) || wieldable(name) || /^coins$/i.test(name);
    /** Low Defence takes real damage from druids; 99 Defence barely eats. */
    const foodWithdraw = () => (skill('Defence') < 40 ? 8 : skill('Defence') < 70 ? 5 : FOOD_WITHDRAW_MIN);
    let lastShopTry = 0;
    let bankHasNoFood = false;

    /**
     * Strength catches Attack, then Defence catches that level, then one
     * level at a time: Attack, then Strength, then Defence.
     */
    function nextMeleeSkill(): (typeof CYCLE)[number] {
        const atk = skill('Attack');
        const str = skill('Strength');
        const def = skill('Defence');
        if (str < atk && str < 99) return 'Strength';
        if (def < atk && def < 99) return 'Defence';
        if (atk < 99) return 'Attack';
        if (str < 99) return 'Strength';
        if (def < 99) return 'Defence';
        return 'Strength';
    }

    let train: (typeof CYCLE)[number] = nextMeleeSkill();
    let trainAt = skill(train);
    let aggroSince = Date.now();
    let packCalmSince: number | null = null;
    let resettingAggro = false;

    async function closeUi(): Promise<void> {
        await bot.dismissBlockingUI();
        if (sdk.getState()?.shop?.isOpen) await bot.closeShop();
        if (sdk.getState()?.bank?.isOpen) await bot.closeBank();
        if (sdk.getState()?.interface?.isOpen) await bot.closeInterface();
    }

    async function intent(msg: string): Promise<void> {
        await sdk.showIntent(msg).catch(() => {});
    }

    async function walkNear(x: number, z: number, tolerance = 6): Promise<boolean> {
        if (pos().hp <= Math.max(12, pos().maxHp - 10)) await eatIfNeeded();
        if (inDungeon() && z < 6400) await climbToSurface();
        if (inDungeon() && z >= SKELETON_LINE) z = SKELETON_LINE - 2;
        if (distTo(x, z) <= tolerance) return true;
        const r = await bot.walkTo(x, z, Math.min(tolerance, 3));
        if (!r.success) log(`walkTo(${x},${z}): ${r.message} @ ${pos().x},${pos().z}`);
        return r.success || distTo(x, z) <= tolerance + 2;
    }

    async function eatIfNeeded(): Promise<void> {
        const p = pos();
        if (p.hp > Math.max(18, p.maxHp - 10)) return;
        const food = sdk.findInventoryItem(FOOD);
        if (!food) return;
        const r = await bot.eatFood(food);
        if (r.success) log(`Ate ${food.name} +${r.hpGained} HP ${pos().hp}/${pos().maxHp} left=${foodCount()}`);
        else log(`Eat failed: ${r.message} HP ${p.hp}/${p.maxHp}`);
    }

    async function buryBones(): Promise<void> {
        for (let i = 0; i < 8; i++) {
            await bot.dismissBlockingUI();
            const bones = sdk.findInventoryItem(BONES);
            if (!bones) return;
            const buryOpt = bones.optionsWithIndex.find((o) => /bury/i.test(o.text));
            if (!buryOpt) return;
            await sdk.sendUseItem(bones.slot, buryOpt.opIndex);
            await sdk.waitForTicks(1);
        }
    }

    async function trainMelee(): Promise<void> {
        const all99 = CYCLE.every((s) => skill(s) >= 99);
        if (all99) {
            train = 'Strength';
            trainAt = skill(train);
        } else {
            const next = nextMeleeSkill();
            if (next !== train) {
                const prev = train;
                train = next;
                trainAt = skill(train);
                log(`LEVEL UP ${prev} — next ${train} (atk ${skill('Attack')} str ${skill('Strength')} def ${skill('Defence')})`);
            }
        }
        for (let attempt = 0; attempt < 3; attempt++) {
            const cs = sdk.getState()?.combatStyle;
            if (!cs?.known) {
                await sdk.waitForTicks(2);
                continue;
            }
            const style = all99
                ? (cs.styles.find((s) => /aggressive/i.test(s.type) || /aggressive/i.test(s.name)) ??
                   cs.styles.find((s) => s.trainsSkills.includes('Strength') && s.trainsSkills.length === 1))
                : (cs.styles.find((s) => s.trainsSkills.includes(train) && s.trainsSkills.length === 1) ??
                   cs.styles.find((s) => s.trainsSkills.includes(train)));
            if (!style || cs.currentStyle === style.index) return;
            await sdk.sendSetCombatStyle(style.index);
            const switched = await sdk
                .waitForCondition((s) => s.combatStyle?.currentStyle === style.index, 8_000)
                .then(() => true)
                .catch(() => false);
            if (!switched) continue;
            log(`Style ${style.name} → ${train} (atk ${skill('Attack')} str ${skill('Strength')} def ${skill('Defence')})`);
            return;
        }
    }

    async function equipWeapon(): Promise<void> {
        for (let attempt = 0; attempt < 4; attempt++) {
            const worn = sdk.getEquipment().find((i) => WEAPON.test(i.name));
            const best = sdk
                .getInventory()
                .filter((i) => wieldable(i.name))
                .sort((a, b) => weaponRank(b.name) - weaponRank(a.name))[0];
            if (!best || (worn && weaponRank(worn.name) >= weaponRank(best.name))) return;
            const r = await bot.equipItem(best);
            await sdk.waitForTicks(1);
            if (sdk.findEquipmentItem(new RegExp(`^${best.name}$`, 'i'))) {
                log(`Equip ${best.name}: ok`);
                return;
            }
            cantWield.add(best.name.toLowerCase());
            log(`Cannot wield ${best.name} (${r.message}) — trying the next weapon`);
        }
    }

    async function openEdgevilleBank(): Promise<boolean> {
        if (inDungeon()) await climbToSurface();
        if (sdk.getState()?.shop?.isOpen) await bot.closeShop();
        if (bankUiOpen()) {
            if (distTo(EDGEVILLE_BANK.x, EDGEVILLE_BANK.z) <= 10) return true;
            await bot.closeBank();
        }
        await travelFromKandarin();
        if (pos().x > 3120 || pos().z < 3460) {
            if (pos().z < 3320) await walkNear(3088, 3320, 8);
            if (pos().z < 3420) await walkNear(3088, 3420, 8);
        }
        await walkNear(EDGEVILLE_BANK.x, EDGEVILLE_BANK.z, 4);
        if (bankUiOpen()) return true;
        const opened = await bot.openBank();
        if (!opened.success && !bankUiOpen()) {
            log(`openBank failed: ${opened.message}`);
            return false;
        }
        return true;
    }

    /** Ardougne / Catherby / Seers → White Wolf → Edgeville. Banks for fish first. */
    async function travelFromKandarin(): Promise<void> {
        if (inDungeon() || pos().x >= 2990) return;
        log(`Kandarin start @ ${pos().x},${pos().z} — walking to Edgeville over White Wolf`);
        await intent('Kandarin → White Wolf → Edgeville');
        if (foodCount() < foodWithdraw()) {
            const opened = await bot.openBank();
            if (opened.success) {
                await depositJunk();
                await withdrawFood();
                await bot.closeBank();
            } else {
                log(`Kandarin bank failed: ${opened.message}`);
            }
        }
        await equipWeapon();
        await walkKandarinToEdgeville(bot, sdk, { eat: eatIfNeeded, walkNear });
        log(`Kandarin walk done @ ${pos().x},${pos().z} hp ${pos().hp}/${pos().maxHp} food ${foodCount()}`);
    }

    async function depositJunk(): Promise<void> {
        const worn = sdk.getEquipment().some((i) => WEAPON.test(i.name));
        const bestInv = sdk
            .getInventory()
            .filter((i) => wieldable(i.name))
            .sort((a, b) => weaponRank(b.name) - weaponRank(a.name))[0];
        const keep = (it: { name: string; slot: number }) =>
            FOOD.test(it.name) || (!worn && !!bestInv && it.slot === bestInv.slot);
        for (let i = 0; i < 40; i++) {
            const item = sdk.getInventory().find((it) => (it.count ?? 0) > 0 && !keep(it));
            if (!item) break;
            const r = await bot.depositItem(item, -1);
            log(`Deposit ${item.name}: ${r.success || r.partial ? 'ok' : r.message}`);
            if (!r.success && !r.partial) break;
        }
        for (let i = 0; i < 8; i++) {
            const noted = sdk.getInventory().find((it) => FOOD.test(it.name) && !canEat(it));
            if (!noted) break;
            const r = await bot.depositItem(noted, -1);
            log(`Deposit noted ${noted.name}: ${r.success || r.partial ? 'ok' : r.message}`);
            if (!r.success && !r.partial) break;
        }
        const extraFood = foodCount() - foodWithdraw();
        for (let n = 0; n < extraFood; n++) {
            const r = await bot.depositItem(FOOD, 1);
            if (!r.success && !r.partial) {
                log(`Park extra food: ${r.message} now ${foodCount()}`);
                break;
            }
        }
        if (extraFood > 0) log(`Park extra food now ${foodCount()}`);
    }

    /** Cheapest stocked fish first; skips 0-count bank placeholders. */
    function bestBankFood() {
        const rank = (name: string) => {
            const i = FOOD_PREFERENCE.findIndex((f) => f.toLowerCase() === name.toLowerCase());
            return i < 0 ? FOOD_PREFERENCE.length : i;
        };
        return (sdk.getState()?.bank?.items ?? [])
            .filter((i) => (i.count ?? 0) > 0 && FOOD.test(i.name))
            .sort((a, b) => rank(a.name) - rank(b.name))[0];
    }

    async function withdrawFood(): Promise<void> {
        let ones = false;
        let stuck = 0;
        for (let i = 0; i < 12 && foodCount() < foodWithdraw(); i++) {
            const bankFood = bestBankFood();
            if (!bankFood) {
                const listed = (sdk.getState()?.bank?.items ?? []).length;
                if (listed > 0) {
                    bankHasNoFood = true;
                    session.log('warn', 'Bank has no stocked food');
                } else {
                    session.log('warn', 'Bank item list empty');
                }
                break;
            }
            const before = foodCount();
            const need = foodWithdraw() - before;
            const qty = ones ? 1 : bankChunk(need, bankFood.count ?? need);
            const r = await bot.withdrawItem(bankFood, qty, { asNote: false });
            if (foodCount() === before) await sdk.waitForTicks(2);
            log(`Withdraw ${bankFood.name} x${qty}: ${foodCount() > before || r.success || r.partial ? 'ok' : r.message} now ${foodCount()}`);
            const leftoverNotes = sdk.getInventory().find((it) => FOOD.test(it.name) && !canEat(it));
            if (leftoverNotes) {
                log(`${leftoverNotes.name} came out noted — depositing`);
                await bot.depositItem(leftoverNotes, -1);
            }
            if (foodCount() > before) {
                stuck = 0;
                continue;
            }
            ones = true;
            stuck++;
            if (stuck >= 2) break;
        }
    }

    function bestBankWeapon() {
        const bank = sdk.getState()?.bank?.items ?? [];
        return bank
            .filter((i) => (i.count ?? 0) > 0 && wieldable(i.name) && (canWieldDlong() || !DLONG.test(i.name)))
            .sort((a, b) => weaponRank(b.name) - weaponRank(a.name))[0];
    }

    async function withdrawLoadout(): Promise<void> {
        const bankBest = bestBankWeapon();
        if (bankBest && weaponRank(bankBest.name) > bestOwnedRank()) {
            const r = await bot.withdrawItem(bankBest, 1);
            log(`Withdraw ${bankBest.name}: ${r.success || r.partial ? 'ok' : r.message}`);
        }
        await withdrawFood();
    }

    /** Best swordshop tier this Attack level can wield, or null. */
    function shopTarget(): (typeof SHOP_TIERS)[number] | null {
        return SHOP_TIERS.find((m) => METAL_ATTACK[m] <= skill('Attack')) ?? null;
    }

    function wantsShopUpgrade(): boolean {
        if (PINNED_WEAPON) return false;
        const tier = shopTarget();
        if (!tier) return false;
        if (Date.now() - lastShopTry < SHOP_RETRY_MS) return false;
        const bankRank = Math.max(-1, ...[bestBankWeapon()].filter(Boolean).map((i) => weaponRank(i!.name)));
        const have = Math.max(bestOwnedRank(), bankRank);
        return weaponRank(`${tier} longsword`) > have;
    }

    /** Withdraws coins at the open Edgeville bank, buys at Varrock, walks back. */
    async function buyShopUpgrade(): Promise<void> {
        const tier = shopTarget();
        if (!tier) return;
        lastShopTry = Date.now();
        const bankCoins = sdk.findBankItem(/^coins$/i)?.count ?? 0;
        if (bankCoins < 40) {
            log(`Swordshop skipped — ${bankCoins} gp banked`);
            return;
        }
        const r = await bot.withdrawItem(/^coins$/i, Math.min(SHOP_COINS, bankCoins));
        log(`Withdraw coins for swordshop: ${r.success || r.partial ? 'ok' : r.message}`);
        await bot.closeBank();
        await intent(`Varrock swordshop — ${tier} longsword`);
        await walkNear(VARROCK_WEST_GATE.x, VARROCK_WEST_GATE.z, 6);
        await walkNear(SWORDSHOP.x, SWORDSHOP.z, 3);
        const opened = await bot.openShop(/^shop (keeper|assistant)$/i);
        if (!opened.success) {
            log(`Swordshop open failed: ${opened.message}`);
        } else {
            const coins = () => sdk.findInventoryItem(/^coins$/i)?.count ?? 0;
            const items = sdk.getState()?.shop?.shopItems ?? [];
            const startAt = SHOP_TIERS.indexOf(tier);
            let bought = false;
            for (const metal of SHOP_TIERS.slice(startAt)) {
                for (const shape of ['longsword', 'sword']) {
                    const name = `${metal} ${shape}`;
                    if (weaponRank(name) <= bestOwnedRank()) continue;
                    const line = items.find((i) => i.name.toLowerCase() === name && (i.count ?? 0) > 0);
                    if (!line || (line.buyPrice ?? Infinity) > coins()) continue;
                    const buy = await bot.buyFromShop(line, 1);
                    if (!buy.success) await sdk.waitForTicks(4);
                    const arrived = buy.success || !!sdk.findInventoryItem(new RegExp(`^${name}$`, 'i'));
                    log(`Buy ${name} @ ${line.buyPrice}gp: ${arrived ? 'ok' : buy.message}`);
                    if (arrived) {
                        bought = true;
                        break;
                    }
                }
                if (bought) break;
            }
            if (!bought) log(`Swordshop: nothing better affordable (gp ${coins()})`);
            await bot.closeShop();
        }
        await equipWeapon();
        await walkNear(VARROCK_WEST_GATE.x, VARROCK_WEST_GATE.z, 6);
    }

    async function prepareLoadout(): Promise<void> {
        await intent(`Edgeville bank — ${foodWithdraw()} food + best melee weapon`);
        if (inDungeon()) await climbToSurface();
        if (!(await openEdgevilleBank())) return;
        await depositJunk();
        await withdrawLoadout();
        for (let i = 0; i < 4 && bankUiOpen(); i++) {
            await bot.closeBank();
            await sdk.waitForTicks(1);
        }
        await equipWeapon();
        if (wantsShopUpgrade()) {
            if (!(await openEdgevilleBank())) return;
            await buyShopUpgrade();
            if (!(await openEdgevilleBank())) return;
            await depositJunk();
            await withdrawLoadout();
            await bot.closeBank();
            await equipWeapon();
        }
        log(
            `Loadout food=${foodCount()} weapon=${sdk.getEquipment().find((i) => WEAPON.test(i.name))?.name ?? 'none'}`
        );
    }

    // Bank ops time out during gateway hiccups even when the bank holds food.
    async function prepareLoadoutWithRetry(): Promise<boolean> {
        for (let attempt = 0; attempt < LOADOUT_RETRIES; attempt++) {
            if (attempt > 0) {
                session.log('warn', `No food after bank — retry ${attempt}/${LOADOUT_RETRIES - 1} in 60s`);
                await new Promise((r) => setTimeout(r, 60_000));
                await waitForPlayerState(sdk);
            }
            await prepareLoadout();
            if (foodCount() > 0) return true;
        }
        return false;
    }

    function herbUnits(): number {
        return sdk.getInventory().filter((i) => HERB.test(i.name)).reduce((n, i) => n + (i.count ?? 1), 0);
    }

    function hasDlong(): boolean {
        return !!(sdk.findEquipmentItem(DLONG) || sdk.findInventoryItem(DLONG));
    }

    async function depositAll(): Promise<void> {
        for (let i = 0; i < 40; i++) {
            const item = sdk.getInventory().find((it) => (it.count ?? 0) > 0);
            if (!item) break;
            const r = await bot.depositItem(item, -1);
            log(`Deposit ${item.name}: ${r.success || r.partial ? 'ok' : r.message}`);
            if (!r.success && !r.partial) break;
        }
    }

    async function withdrawAllHerbs(): Promise<number> {
        // Leave 3 slots for the dragon kit coming back.
        for (let i = 0; i < 28 && occupied() < 25; i++) {
            const herb = sdk.findBankItem(HERB);
            if (!herb) break;
            const r = await bot.withdrawItem(herb, -1);
            log(`Withdraw ${herb.name}: ${r.success || r.partial ? 'ok' : r.message}`);
            if (!r.success && !r.partial) break;
        }
        return herbUnits();
    }

    async function swapHerbsForDragon(): Promise<void> {
        if (hasDlong()) return;
        await intent('Edgeville — herbs for dragon kit (jackthief)');
        if (inDungeon()) await climbToSurface();
        if (!(await openEdgevilleBank())) return;
        if (canWieldDlong() && sdk.findBankItem(DLONG) && !hasDlong()) {
            const r = await bot.withdrawItem(DLONG, 1);
            log(`Already banked dlong: ${r.success || r.partial ? 'ok' : r.message}`);
            await bot.closeBank();
            await equipWeapon();
            return;
        }
        await depositAll();
        const herbs = await withdrawAllHerbs();
        await bot.closeBank();
        log(`Herbs for jackthief: ${herbs}`);
        if (herbs < 1) {
            log('No herbs to trade — continuing with current weapon');
            return;
        }

        const give = Array.from({ length: herbs }, () => ({ item: HERB, amount: 1 as const }));
        let traded = false;
        let attempt = 0;
        while (!traded) {
            attempt++;
            await intent(`waiting to trade jackthief — ${herbs} herbs (${attempt})`);
            const partner = sdk.findNearbyPlayer(JACKTHIEF);
            if (!partner) {
                log(`Waiting to trade jackthief (${attempt}) @ ${pos().x},${pos().z}`);
                if (distTo(EDGEVILLE_BANK.x, EDGEVILLE_BANK.z) > 6) {
                    await walkNear(EDGEVILLE_BANK.x, EDGEVILLE_BANK.z, 3);
                }
                await sdk.waitForTicks(10);
                continue;
            }
            log(`jackthief in range — sending trade (${attempt})`);
            const r = await bot.trade(partner, {
                give,
                want: [
                    { item: DLONG, amount: 1 },
                    { item: DDAGGER, amount: 1 },
                    { item: ESSENCE, amount: 1000 }
                ],
                retryOnBusy: true,
                requestTimeout: 90_000,
                timeout: 120_000
            });
            log(
                `Trade jackthief: ${r.success ? 'ok' : r.message} ` +
                    `got=${r.received.map((i) => `${i.count} ${i.name}`).join(', ') || '—'}`
            );
            traded = r.success;
            if (!traded) await sdk.waitForTicks(5);
        }

        if (!(await openEdgevilleBank())) return;
        await depositAll();
        if (canWieldDlong() && sdk.findBankItem(DLONG)) {
            const r = await bot.withdrawItem(DLONG, 1);
            log(`Withdraw dlong: ${r.success || r.partial ? 'ok' : r.message}`);
        }
        await bot.closeBank();
        await equipWeapon();
        if (!canWieldDlong()) log('Dragon longsword parked — melee continues on rune pickaxe');
    }

    async function climbIntoDungeon(): Promise<boolean> {
        if (inDungeon()) return true;
        await travelFromKandarin();
        if (pos().x < 2990) return false;
        await walkNear(TRAPDOOR.x, TRAPDOOR.z, 1);
        for (let attempt = 0; attempt < 4 && !inDungeon(); attempt++) {
            const trap = sdk.findNearbyLoc(/trapdoor/i);
            log(
                `Trapdoor try ${attempt}: ${trap ? `${trap.name} [${trap.optionsWithIndex.map((o) => o.text).join(', ')}]` : 'none'} @ ${pos().x},${pos().z}`
            );
            if (!trap) {
                await sdk.waitForTicks(1);
                continue;
            }
            if (trap.optionsWithIndex.some((o) => /^open$/i.test(o.text))) {
                await bot.interactLoc(trap, /^open$/i);
                await sdk
                    .waitForCondition(
                        (s) =>
                            (s.nearbyLocs ?? []).some(
                                (l) => /trapdoor/i.test(l.name) && l.optionsWithIndex.some((o) => /climb-down/i.test(o.text))
                            ),
                        6_000
                    )
                    .catch(() => {});
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

    async function goToCamp(): Promise<void> {
        for (let i = 0; i < 3 && bankUiOpen(); i++) await bot.closeBank();
        if (!inDungeon() && !(await climbIntoDungeon())) return;
        if (pos().z < WILDY_GATE.z - 4) {
            await walkNear(WILDY_GATE.x, WILDY_GATE.z - 2, 3);
            const gate = sdk.findNearbyLoc(/gate/i, { withOption: /open/i });
            if (gate) await bot.openDoor(gate);
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

    async function lootGround(): Promise<void> {
        for (let i = 0; i < 12; i++) {
            await eatIfNeeded();
            await buryBones();
            if (occupied() >= 28) break;
            const scanned = await sdk.scanGroundItems(8).catch(() => sdk.getGroundItems() ?? []);
            const item = scanned
                .filter(
                    (g) =>
                        (isLoot(g.name) || BONES.test(g.name)) &&
                        g.reachable !== false &&
                        (g.distance ?? 99) <= 8 &&
                        (g.z ?? 0) < SKELETON_LINE
                )
                .sort((a, b) => {
                    const d = lootPriority(a.name) - lootPriority(b.name);
                    if (d !== 0) return d;
                    return (a.distance ?? 99) - (b.distance ?? 99);
                })[0];
            if (!item) return;
            const r = await bot.pickupItem(item);
            if (!r.success) {
                log(`Pickup ${item.name} failed: ${r.message}`);
                if (/full|no space|inventory/i.test(r.message ?? '')) break;
                continue;
            }
        }
        await buryBones();
    }

    function findTarget() {
        const mine = pos().targetIndex;
        const npcs = (sdk.getNearbyNpcs() ?? [])
            .filter(
                (n) =>
                    NPC.test(n.name) &&
                    (n.hp === null || n.hp > 0) &&
                    n.z < SKELETON_LINE &&
                    n.optionsWithIndex.some((o) => /attack/i.test(o.text)) &&
                    n.reachable !== false
            )
            .sort((a, b) => (a.distance ?? 99) - (b.distance ?? 99));
        const free = npcs.filter((n) => !n.inCombat || n.index === mine);
        return free[0] ?? null;
    }

    function hasValidNpcTarget(): boolean {
        const p = pos();
        if (!p.inCombat || p.targetType !== 'npc' || p.targetIndex < 0) return false;
        const target = sdk.getNearbyNpcs().find((n) => n.index === p.targetIndex);
        return (
            !!target &&
            NPC.test(target.name) &&
            target.z < SKELETON_LINE &&
            (target.hp === null || target.hp > 0)
        );
    }

    async function fight(): Promise<void> {
        if (hasValidNpcTarget()) {
            const until = Date.now() + 25_000;
            while (hasValidNpcTarget() && !pos().isDead && Date.now() < until) {
                await bot.dismissBlockingUI();
                await eatIfNeeded();
                await trainMelee();
                await lootGround();
            }
            return;
        }
        const target = findTarget();
        if (!target) {
            if (!inDungeon()) await goToCamp();
            else if (distTo(CAMP.x, CAMP.z) > 8) await walkNear(CAMP.x, CAMP.z, 5);
            else await sdk.waitForTicks(1);
            return;
        }
        const r = await bot.attack(target, 8_000);
        if (!r.success) log(`Attack ${target.name}: ${r.message}`);
    }

    await waitForPlayerState(sdk);
    log(
        `Edgeville melee ${HUNT_THUGS ? 'thugs' : 'chaos druids'} ` +
            `atk ${skill('Attack')} str ${skill('Strength')} def ${skill('Defence')} ` +
            `weapon ${PINNED_WEAPON || 'best'} @ ${pos().x},${pos().z}`
    );
    await trainMelee();
    await closeUi();
    if (HERB_SWAP) await swapHerbsForDragon();
    while (!(await prepareLoadoutWithRetry())) {
        if (bankHasNoFood) {
            session.stop('needs_supplies', `No food after loadout @ ${pos().x},${pos().z}`);
            await session.finalizeStop();
            return;
        }
        session.log('warn', 'Bank click missed — retrying loadout in 20s');
        await new Promise((r) => setTimeout(r, 20_000));
        await waitForPlayerState(sdk);
    }
    if (!hasWeapon()) session.log('warn', 'No wieldable weapon — fighting unarmed');
    await goToCamp();
    await trainMelee();

    while (true) {
        await bot.dismissBlockingUI();
        if (CYCLE.every((s) => skill(s) >= 99)) {
            session.stop('goal_reached', 'Attack, Strength and Defence are 99');
            break;
        }
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

        await trainMelee();
        await eatIfNeeded();
        if (await fleeSkeletons()) continue;
        if (await maybeResetAggro()) continue;

        if (foodCount() === 0 || occupied() >= 28) {
            log(`Banking food=${foodCount()} herbs=${herbSlots()} slots=${occupied()}`);
            if (!(await prepareLoadoutWithRetry())) {
                session.stop('needs_supplies', 'Out of food after bank');
                break;
            }
            await goToCamp();
            continue;
        }

        await lootGround();
        await intent(
            `${HUNT_THUGS ? 'thugs' : 'druids'} ${train} ` +
                `a${skill('Attack')} s${skill('Strength')} d${skill('Defence')} food ${foodCount()}`
        );
        await fight();
        await lootGround();
    }
    await session.finalizeStop();
});
