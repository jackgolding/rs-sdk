/**
 * Shortbow + arrows at one wilderness camp. At Ranged 50, equip a magic
 * shortbow and fire Snapshot whenever the special bar is full. Rapid until
 * Ranged 99, then Longrange. Withdraw 3 food at Defence 90+, otherwise 8.
 * Arrow piles of 5+ are picked up. Every rune, herb, and half of a key on the ground
 * is picked up too, then deposited on the next bank trip. An empty quiver
 * banks, then buys bronze or iron arrows at Lowe's in Varrock.
 *
 * `clear` buys every iron arrow on the Hickton shelf, then every bronze
 * arrow, before the camp. Later restocks stay capped.
 *
 * Surface camps do not hop straight at the interior tile. Bandit Camp's
 * south side is lava (x 3023–3050, z 3654–3686) and the east side is a
 * pond, so the walk goes north of the water and then west. Dark Warriors' Fortress
 * sits behind a cliff at z=3618; the walk stops on the open row at z=3615.
 *
 *   bun bots/quests/wildy-range.ts jacklove6 druids
 *
 * Camps: druids, thugs (Edgeville dungeon), edge-thugs, dark-warriors,
 * bandits, hobgoblins (surface, low/medium combat).
 */
import { join } from 'path';
import { ActivitySession } from '../../sdk/index';
import { runScript } from '../../sdk/runner';
import { inWilderness } from '../../sdk/regions';
import { installWaitForTicksGuard, playerPos, walkKandarinToEdgeville, walkNear as moveNear } from './movement';
import { CATHERBY_BANK, WHITE_WOLF_TO_CATHERBY } from './tiles';

const STUCK_EXIT_MS = 30 * 60 * 1000;
const FOOD_AT_90_DEF = 3;
const FOOD_BELOW_90_DEF = 8;
const EAT_FLOOR = 14;

const EDGEVILLE_BANK = { x: 3094, z: 3492 };
const VARROCK_SQUARE = { x: 3210, z: 3429 };
const LOWE = { x: 3232, z: 3423 };
const HICKTON = { x: 2822, z: 3442 };
const ARCHERY_SHOPS = {
    lowe: { label: 'Lowe', npc: /lowe/i, x: LOWE.x, z: LOWE.z, bronze: 2000, iron: 1500 },
    hickton: { label: 'Hickton', npc: /hickton/i, x: HICKTON.x, z: HICKTON.z, bronze: 1000, iron: 800 }
} as const;
const DITCH_SOUTH = { x: 3088, z: 3516 };
const DITCH_NORTH = { x: 3088, z: 3525 };
const TRAPDOOR = { x: 3095, z: 3468 };
const DUNGEON_LADDER = { x: 3096, z: 9867 };
const WILDY_GATE = { x: 3103, z: 9909 };
const SKELETON_LINE = 9940;

type Camp = {
    label: string;
    npc: RegExp;
    x: number;
    z: number;
    dungeon: boolean;
};

const CAMPS: Record<string, Camp> = {
    druids: { label: 'chaos druids', npc: /^chaos druid$/i, x: 3114, z: 9929, dungeon: true },
    thugs: { label: 'thugs', npc: /^thug$/i, x: 3123, z: 9929, dungeon: true },
    'edge-thugs': { label: 'Edgeville thugs', npc: /^thug$/i, x: 3160, z: 3568, dungeon: false },
    'dark-warriors': { label: 'dark warriors', npc: /^dark warrior$/i, x: 3026, z: 3632, dungeon: false },
    bandits: { label: 'bandits', npc: /^bandit$/i, x: 3034, z: 3700, dungeon: false },
    hobgoblins: { label: 'hobgoblins', npc: /^hobgoblin$/i, x: 3075, z: 3748, dungeon: false }
};

const shopId = (process.argv.slice(2).find((arg) => arg === 'hickton' || arg === 'lowe') ?? 'lowe') as keyof typeof ARCHERY_SHOPS;
const ARCHERY = ARCHERY_SHOPS[shopId];
const clearShelf = process.argv.includes('clear');
const botName = process.argv.slice(2).find((arg) => !arg.startsWith('-') && !CAMPS[arg] && arg !== 'hickton' && arg !== 'lowe' && arg !== 'clear') ?? '';
const campId = process.argv.slice(2).find((arg) => CAMPS[arg]) ?? 'druids';
const GRIND_LOG = join(process.cwd(), 'bots', botName, 'grind.log');

const CAMP = CAMPS[campId] ?? CAMPS.druids!;
const SHIFT = [
    [0, 0],
    [2, 0],
    [-2, 0],
    [0, 2],
    [0, -2],
    [3, 1],
    [-3, 1]
] as const;
const nameHash = [...botName].reduce((sum, ch) => sum + ch.charCodeAt(0), 0);
const shift = SHIFT[nameHash % SHIFT.length]!;
/** Courtyard tiles. The old anchor (3026, 3632) plus a shift lands on the west wall. */
const FORT_OFFSETS = [
    [0, 0],
    [2, 0],
    [-2, 0],
    [0, 2],
    [0, -2],
    [1, 1],
    [-1, -1]
] as const;
const fortShift = FORT_OFFSETS[nameHash % FORT_OFFSETS.length]!;
const STAND =
    campId === 'dark-warriors'
        ? { x: 3029 + fortShift[0], z: 3630 + fortShift[1] }
        : { x: CAMP.x + shift[0], z: CAMP.z + shift[1] };

const FOOD = /^(shark|swordfish|lobster|tuna|bass|salmon|trout)$/i;
const FOOD_ORDER = [/^shark$/i, /^swordfish$/i, /^lobster$/i, /^tuna$/i, /^bass$/i, /^salmon$/i, /^trout$/i];
const COINS = /^coins$/i;
const SHORTBOW = /^shortbow$/i;
const MAGIC_SHORTBOW = /^magic shortbow$/i;
const BRONZE_IRON_ARROW = /^(bronze|iron) arrows?$/i;
const ARROW = /^(bronze|iron|steel|mithril|adamant|rune) arrows?$/i;
const ARROW_TIERS = [/^rune arrows?$/i, /^adamant arrows?$/i, /^mithril arrows?$/i, /^steel arrows?$/i, /^iron arrows?$/i, /^bronze arrows?$/i];
/** Left out of KEEP on purpose: depositJunk banks them. */
const HERB =
    /^(herb|unidentified herb|guam leaf|marrentill|tarromin|harralander|ranarr weed|irit leaf|avantoe|kwuarm|cadantine|dwarf weed|torstol|snake weed|ardrigal|sito foil|volencia moss|rogues purse|lantadyme|toadflax|snapdragon)$/i;
const RUNE = / rune$/i;
const KEY_HALF = /^half of a key$/i;
const KEEP =
    /^(shark|swordfish|lobster|tuna|bass|salmon|trout|coins|(bronze|iron|steel|mithril|adamant|rune) arrows?|magic shortbow|shortbow)$/i;
const RANGED_MSB = 50;
const ARROW_WITHDRAW = 1000;
const ARROW_RESTOCK_BELOW = 80;
const ARROW_LEAVE = 15;
const COIN_WITHDRAW = 15_000;
const COMBAT_BOW_SPECBAR = 7537;
const MSB_SPEC_COST = 350;
const SPEC_MAX = 1000;
const SPEC_REGEN = 100;
const SPEC_REGEN_TICKS = 50;
/** Bandit Camp lava. A straight hop from the ditch to the tents crosses it. */
const LAVA = { xMin: 3023, xMax: 3050, zMin: 3654, zMax: 3686 };

await runScript(async ({ bot, sdk }) => {
    const session = new ActivitySession(sdk, bot, {
        name: 'wildy-range',
        grindLogPath: GRIND_LOG,
        stallMs: 300_000
    });
    installWaitForTicksGuard(sdk, session);
    session.setAnchor(STAND.x, STAND.z);
    const log = (msg: string) => session.log('log', msg);

    const pos = () => {
        const p = playerPos(sdk);
        const player = sdk.getState()?.player;
        return {
            ...p,
            hp: player?.hp ?? 10,
            maxHp: player?.maxHp ?? 10,
            isDead: player?.isDead ?? false,
            inCombat: player?.combat?.inCombat ?? false,
            targetType: player?.combat?.targetType ?? 'none',
            targetIndex: player?.combat?.targetIndex ?? -1
        };
    };
    const inDungeon = () => pos().z > 6400;
    const onSurfaceWildy = () => inWilderness(pos().x, pos().z);
    const countItems = (pattern: RegExp) =>
        sdk.getInventory().filter((item) => pattern.test(item.name)).reduce((sum, item) => sum + item.count, 0);
    const foodCount = () => countItems(FOOD);
    const arrowCount = () => {
        const worn = sdk.getEquipment().filter((item) => ARROW.test(item.name)).reduce((sum, item) => sum + item.count, 0);
        return worn + countItems(ARROW);
    };
    const canWield = (item: { optionsWithIndex?: { text: string }[] } | null | undefined) =>
        !!item?.optionsWithIndex?.some((opt) => /wield|wear|equip/i.test(opt.text));
    const hasMagicShortbow = () =>
        !!(sdk.findEquipmentItem(MAGIC_SHORTBOW) || canWield(sdk.findInventoryItem(MAGIC_SHORTBOW)));
    const hasShortbow = () => !!(sdk.findEquipmentItem(SHORTBOW) || canWield(sdk.findInventoryItem(SHORTBOW)));
    /** Plain shortbow until 50. A magic shortbow in the bag is not a usable bow before then. */
    const hasBow = () => hasShortbow() || (wantMsb() && hasMagicShortbow());
    const wantMsb = () => rangedLevel() >= RANGED_MSB;
    const firesAnyArrow = () => !!(sdk.findEquipmentItem(MAGIC_SHORTBOW) || (wantMsb() && hasMagicShortbow()));
    const canFire = (name: string) => (firesAnyArrow() ? ARROW : BRONZE_IRON_ARROW).test(name);
    const coins = () => sdk.findInventoryItem(COINS)?.count ?? 0;
    const lootPieces = () => countItems(HERB) + countItems(RUNE) + countItems(KEY_HALF);
    const rangedXp = () => sdk.getSkill('Ranged')?.experience ?? 0;
    const rangedLevel = () => sdk.getSkill('Ranged')?.baseLevel ?? 1;
    const defenceLevel = () => sdk.getSkill('Defence')?.baseLevel ?? 1;
    const foodTarget = () => (defenceLevel() >= 90 ? FOOD_AT_90_DEF : FOOD_BELOW_90_DEF);
    const wantedStyle = () => (rangedLevel() >= 99 ? 'Longrange' : 'Rapid');
    const occupied = () => sdk.getInventory().filter((item) => (item.count ?? 0) > 0).length;

    let specEnergy = SPEC_MAX;
    let specArmed = false;
    let lastSpecRegenTick = -1;
    let msbMissing = false;
    let watchXp = rangedXp();
    let watchAt = Date.now();
    setInterval(() => {
        const xp = rangedXp();
        if (xp !== watchXp) {
            watchXp = xp;
            watchAt = Date.now();
        } else if (Date.now() - watchAt > STUCK_EXIT_MS) {
            console.error(`[watchdog] no Ranged XP for ${Math.round(STUCK_EXIT_MS / 60000)}m — exiting for relaunch`);
            process.exit(1);
        }
    }, 60_000).unref();

    async function eatIfNeeded(): Promise<void> {
        const here = pos();
        if (here.hp > Math.max(EAT_FLOOR, here.maxHp - 16)) return;
        const food = sdk.findInventoryItem(FOOD);
        if (!food) return;
        const ate = await bot.eatFood(food);
        if (ate.success) log(`Ate ${food.name} +${ate.hpGained} HP ${pos().hp}/${pos().maxHp} left=${foodCount()}`);
    }

    async function openAdjacent(): Promise<void> {
        const door = sdk.findNearbyLoc(/door|gate/i, { withOption: /open/i });
        if (door && (door.distance ?? 99) <= 4) await bot.openDoor(door);
    }

    async function hopToward(x: number, z: number, tolerance = 4, maxStep = 8): Promise<boolean> {
        for (let step = 0; step < 80 && Math.hypot(pos().x - x, pos().z - z) > tolerance; step++) {
            if (pos().isDead) return false;
            await bot.dismissBlockingUI();
            await eatIfNeeded();
            await openAdjacent();
            const here = pos();
            const dist = Math.hypot(here.x - x, here.z - z);
            const reach = Math.min(maxStep, dist);
            const nx = Math.round(here.x + ((x - here.x) / dist) * reach);
            const nz = Math.round(here.z + ((z - here.z) / dist) * reach);
            const before = `${here.x},${here.z}`;
            await sdk.sendWalk(nx, nz, true);
            await sdk
                .waitForCondition((s) => {
                    const px = s.player?.worldX ?? 0;
                    const pz = s.player?.worldZ ?? 0;
                    return Math.hypot(px - nx, pz - nz) <= 3 || `${px},${pz}` !== before;
                }, 8_000)
                .catch(() => {});
            session.noteProgress('location', `${pos().x},${pos().z}`);
            if (`${pos().x},${pos().z}` === before) {
                if (maxStep <= 2) break;
                await sdk.sendWalk(here.x + (step % 2 === 0 ? 2 : -2), here.z + 1, true);
                await sdk.waitForTicks(2).catch(() => {});
            }
        }
        return Math.hypot(pos().x - x, pos().z - z) <= tolerance + 3;
    }

    async function walkSurface(x: number, z: number, tolerance = 4): Promise<boolean> {
        if (onSurfaceWildy() || z >= 3520) return hopToward(x, z, tolerance);
        const walked = await moveNear(bot, sdk, x, z, tolerance);
        session.noteProgress('location', `${pos().x},${pos().z}`);
        return walked;
    }

    async function crossDitchNorth(): Promise<boolean> {
        if (onSurfaceWildy()) return true;
        if (pos().x < 2990) {
            log(`Kandarin @ ${pos().x},${pos().z} — walking to the ditch`);
            await walkKandarinToEdgeville(bot, sdk, { eat: eatIfNeeded });
        }
        await walkSurface(DITCH_SOUTH.x, DITCH_SOUTH.z, 3);
        await sdk.sendWalk(DITCH_NORTH.x, DITCH_NORTH.z, true);
        await sdk
            .waitForCondition((s) => (s.player?.worldZ ?? 0) >= 3520 || s.player?.isDead === true, 12_000)
            .catch(() => {});
        return onSurfaceWildy();
    }

    async function crossDitchSouth(): Promise<boolean> {
        if (!onSurfaceWildy()) return true;
        const here = pos();
        if (here.x >= 3020 && here.x <= 3042 && here.z >= 3620 && here.z <= 3643) {
            await hopToward(3024, 3626, 2, 2);
            let locs = sdk.getNearbyLocs() ?? [];
            if (!locs.some((loc) => /door/i.test(loc.name))) locs = await sdk.scanNearbyLocs(12);
            for (const door of locs.filter((loc) => /door/i.test(loc.name) && loc.optionsWithIndex.some((opt) => /^open$/i.test(opt.text))).slice(0, 2)) {
                const opt = door.optionsWithIndex.find((entry) => /^open$/i.test(entry.text));
                if (!opt) continue;
                await sdk.sendInteractLoc(door.x, door.z, door.id, opt.opIndex);
                await sdk.waitForTicks(2);
            }
            await hopToward(3034, 3615, 3, 3);
        }
        await hopToward(DITCH_NORTH.x, DITCH_NORTH.z, 4);
        await sdk.sendWalk(DITCH_SOUTH.x, DITCH_SOUTH.z, true);
        await sdk
            .waitForCondition((s) => (s.player?.worldZ ?? 0) < 3520 || s.player?.isDead === true, 12_000)
            .catch(() => {});
        return !onSurfaceWildy();
    }

    async function climbIntoDungeon(): Promise<boolean> {
        if (inDungeon()) return true;
        if (onSurfaceWildy()) await crossDitchSouth();
        await walkSurface(TRAPDOOR.x, TRAPDOOR.z, 2);
        for (let attempt = 0; attempt < 4 && !inDungeon(); attempt++) {
            const trap = sdk.findNearbyLoc(/trapdoor/i);
            if (!trap) {
                await sdk.waitForTicks(1);
                continue;
            }
            if (trap.optionsWithIndex.some((opt) => /^open$/i.test(opt.text))) {
                await bot.interactLoc(trap, /^open$/i);
                await sdk.waitForTicks(2);
            }
            const down = sdk.findNearbyLoc(/trapdoor/i, { withOption: /climb-down/i });
            if (down) {
                await bot.interactLoc(down, /climb-down/i);
                await sdk.waitForCondition((s) => (s.player?.worldZ ?? 0) > 6400, 8_000).catch(() => {});
            }
        }
        return inDungeon();
    }

    async function climbToSurface(): Promise<boolean> {
        if (!inDungeon()) return true;
        await eatIfNeeded();
        if (pos().z >= WILDY_GATE.z) {
            await moveNear(bot, sdk, WILDY_GATE.x, WILDY_GATE.z - 6, 3);
            const gate = sdk.findNearbyLoc(/gate/i, { withOption: /open/i });
            if (gate) await bot.openDoor(gate);
        }
        await moveNear(bot, sdk, DUNGEON_LADDER.x, DUNGEON_LADDER.z, 2);
        const ladder = sdk.findNearbyLoc(/^ladder$/i, { withOption: /climb-up/i });
        if (ladder) {
            await bot.interactLoc(ladder, /climb-up/i);
            await sdk.waitForCondition((s) => (s.player?.worldZ ?? 0) < 6400, 10_000).catch(() => {});
        }
        return !inDungeon();
    }

    async function leaveDanger(): Promise<void> {
        if (inDungeon()) {
            await climbToSurface();
            return;
        }
        if (onSurfaceWildy()) await crossDitchSouth();
    }

    async function openEdgevilleBank(): Promise<boolean> {
        if (inDungeon()) await climbToSurface();
        if (onSurfaceWildy()) await crossDitchSouth();
        if (pos().x < 2990) {
            log(`Kandarin @ ${pos().x},${pos().z} — walking to Edgeville`);
            await walkKandarinToEdgeville(bot, sdk, { eat: eatIfNeeded });
        }
        if (sdk.getState()?.bank?.isOpen && Math.hypot(pos().x - EDGEVILLE_BANK.x, pos().z - EDGEVILLE_BANK.z) <= 8) {
            return true;
        }
        await walkSurface(EDGEVILLE_BANK.x, EDGEVILLE_BANK.z, 4);
        if (sdk.getState()?.bank?.isOpen) return true;
        const opened = await bot.openBank();
        if (!opened.success) log(`openBank failed: ${opened.message}`);
        return opened.success || sdk.getState()?.bank?.isOpen === true;
    }

    async function depositJunk(): Promise<void> {
        for (let i = 0; i < 40; i++) {
            const item = sdk.getInventory().find((entry) => (entry.count ?? 0) > 0 && !KEEP.test(entry.name));
            if (!item) break;
            const deposited = await bot.depositItem(
                new RegExp(`^${item.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i'),
                -1
            );
            if (!deposited.success && !deposited.partial) break;
        }
    }

    async function withdrawFood(): Promise<void> {
        const want = foodTarget();
        if (foodCount() > want) {
            for (const pattern of [...FOOD_ORDER].reverse()) {
                if (foodCount() <= want) break;
                if (!sdk.getInventory().some((item) => (item.count ?? 0) > 0 && pattern.test(item.name))) continue;
                const deposited = await bot.depositItem(pattern, -1);
                log(`Deposit extra food: ${deposited.success || deposited.partial} now ${foodCount()}`);
            }
        }
        let have = foodCount();
        if (have >= want) return;
        for (const pattern of FOOD_ORDER) {
            if (have >= want) break;
            const stocked = (sdk.getState()?.bank?.items ?? []).find((item) => (item.count ?? 0) > 0 && pattern.test(item.name));
            if (!stocked) continue;
            const took = await bot.withdrawItem(stocked, Math.min(want - have, stocked.count));
            log(`Withdraw ${stocked.name}: ${took.success || took.partial}`);
            have = foodCount();
        }
    }

    function bestArrowStack() {
        const tiers = firesAnyArrow() ? ARROW_TIERS : [/^iron arrows?$/i, /^bronze arrows?$/i];
        for (const pattern of tiers) {
            const worn = sdk.findEquipmentItem(pattern);
            if (worn && canFire(worn.name)) return worn;
            const held = sdk.findInventoryItem(pattern);
            if (held && canFire(held.name)) return held;
        }
        return null;
    }

    async function equipGear(): Promise<void> {
        if (wantMsb() && !sdk.findEquipmentItem(MAGIC_SHORTBOW)) {
            const magic = sdk.findInventoryItem(MAGIC_SHORTBOW);
            if (magic) {
                const equipped = await bot.equipItem(magic);
                log(`Equip magic shortbow: ${equipped.success ? 'ok' : equipped.message}`);
            }
        }
        if (!sdk.findEquipmentItem(SHORTBOW)) {
            const bow = sdk.findInventoryItem(SHORTBOW);
            if (bow) {
                const equipped = await bot.equipItem(bow);
                log(`Equip ${bow.name}: ${equipped.success ? 'ok' : equipped.message}`);
            }
        }
        const arrows = bestArrowStack();
        if (arrows && !sdk.findEquipmentItem(new RegExp(`^${arrows.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i'))) {
            const equipped = await bot.equipItem(arrows);
            if (equipped.success) log(`Wield ${arrows.count} ${arrows.name}`);
        }
        const want = wantedStyle();
        const style = sdk.getState()?.combatStyle?.styles.find((entry) => entry.type === want || new RegExp(`^${want}$`, 'i').test(entry.name));
        if (style && sdk.getState()?.combatStyle?.currentStyle !== style.index) {
            await sdk.sendSetCombatStyle(style.index);
            log(`Combat style ${want}`);
        }
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
        const clicked = await sdk.sendClickComponent(COMBAT_BOW_SPECBAR);
        if (!clicked.success) {
            log(`Spec bar click failed: ${clicked.message}`);
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

    async function withdrawBowAndArrows(): Promise<void> {
        if (wantMsb() && !hasMagicShortbow()) {
            const noted = sdk.getInventory().find((item) => MAGIC_SHORTBOW.test(item.name) && !canWield(item));
            if (noted) {
                const parked = await bot.depositItem(MAGIC_SHORTBOW, -1);
                log(`Deposit noted magic shortbow: ${parked.success || parked.partial}`);
            }
            const magic = sdk.findBankItem(MAGIC_SHORTBOW);
            if (magic) {
                const took = await bot.withdrawItem(magic, 1, { asNote: false });
                log(`Withdraw magic shortbow: ${took.success || took.partial}`);
                msbMissing = !(took.success || took.partial || hasMagicShortbow());
            } else {
                msbMissing = true;
                log('No magic shortbow in bank at 50 range');
            }
        }
        if (!hasShortbow()) {
            await bot.withdrawItem(SHORTBOW, 1, { asNote: false }).catch(() => {});
        }
        if (arrowCount() < ARROW_RESTOCK_BELOW) {
            for (const pattern of firesAnyArrow() ? ARROW_TIERS : [/^iron arrows?$/i, /^bronze arrows?$/i]) {
                if (arrowCount() >= ARROW_WITHDRAW) break;
                const stocked = sdk.findBankItem(pattern);
                if (!stocked || stocked.count <= 0) continue;
                const took = await bot.withdrawItem(stocked, Math.min(ARROW_WITHDRAW - arrowCount(), stocked.count));
                log(`Withdraw ${stocked.name}: ${took.success || took.partial} now ${arrowCount()}`);
            }
        }
    }

    async function restockArrowsAtLowe(): Promise<void> {
        if (arrowCount() >= ARROW_RESTOCK_BELOW) return;
        if (!(await openEdgevilleBank())) return;
        await depositJunk();
        await withdrawBowAndArrows();
        if (arrowCount() >= ARROW_RESTOCK_BELOW) {
            log(`Bank arrows cover the quiver (${arrowCount()})`);
            await bot.closeBank();
            return;
        }
        if (coins() < COIN_WITHDRAW) {
            const bankGp = sdk.findBankItem(COINS)?.count ?? 0;
            if (bankGp > 0) {
                const took = await bot.withdrawItem(COINS, Math.min(COIN_WITHDRAW - coins(), bankGp));
                log(`Withdraw coins for Lowe: ${took.success || took.partial} now ${coins()}gp`);
            }
        }
        await bot.closeBank();
        if (coins() < 1) {
            log('No coins for Lowe');
            return;
        }
        if (shopId === 'hickton' && pos().x > 2900) {
            for (const tile of WHITE_WOLF_TO_CATHERBY) {
                if (Math.hypot(pos().x - tile.x, pos().z - tile.z) <= 6) continue;
                await hopToward(tile.x, tile.z, 4, 6);
            }
        } else if (shopId === 'lowe' && (pos().x > 3225 || pos().x < 3180)) {
            await moveNear(bot, sdk, VARROCK_SQUARE.x, VARROCK_SQUARE.z, 4);
        }
        await moveNear(bot, sdk, ARCHERY.x, ARCHERY.z, 3);
        const opened = await bot.openShop(ARCHERY.npc);
        if (!opened.success && !sdk.getState()?.shop?.isOpen) {
            log(`${ARCHERY.label} shop failed: ${opened.message}`);
            return;
        }
        if (!hasShortbow() && !wantMsb()) {
            const bowLine = sdk.getState()?.shop?.shopItems.find((item) => SHORTBOW.test(item.name));
            if (bowLine && bowLine.count > 0 && coins() >= 50) {
                const bought = await bot.buyFromShop(SHORTBOW, 1);
                log(`Buy shortbow at ${ARCHERY.label}: ${bought.success || bought.partial ? 'ok' : bought.message}`);
            } else {
                log(`${ARCHERY.label} has no shortbow in stock`);
            }
        }
        const tiers = [
            { name: 'bronze', pattern: /^bronze arrows?$/i, stock: ARCHERY.bronze },
            { name: 'iron', pattern: /^iron arrows?$/i, stock: ARCHERY.iron }
        ];
        const tier =
            tiers.find((entry) => (sdk.getState()?.shop?.shopItems.find((item) => entry.pattern.test(item.name))?.count ?? 0) > 0) ??
            tiers[0]!;
        const shopLine = () => sdk.getState()?.shop?.shopItems.find((item) => tier.pattern.test(item.name)) ?? null;
        const liveBuyPrice = (line: { count: number; baseCost?: number }) => {
            const cfg = sdk.getState()?.shop?.shopConfig;
            const cost = line.baseCost || 1;
            const haggle = cfg?.haggle ?? 10;
            const sellMult = cfg?.sellMultiplier ?? 1000;
            const raw = Math.min(1000, Math.max(-5000, ((line.count ?? 0) - tier.stock) * haggle));
            return Math.max(1, Math.floor((cost * Math.max(100, sellMult - raw)) / 1000));
        };
        const before = arrowCount();
        let stall = 0;
        while (stall < 4 && coins() >= 1 && arrowCount() - before < ARROW_WITHDRAW) {
            const line = shopLine();
            if (!line || line.count <= 0 || coins() < liveBuyPrice(line)) break;
            const stockBefore = line.count;
            const room = ARROW_WITHDRAW - (arrowCount() - before);
            const clicks = Math.min(8, Math.ceil(Math.min(stockBefore, Math.max(10, room)) / 10));
            for (let n = 0; n < clicks; n++) {
                const bought = await sdk.sendShopBuy(line.slot, 10);
                if (!bought.success) {
                    log(`Buy ${tier.name} send failed: ${bought.message}`);
                    stall = 99;
                    break;
                }
            }
            await sdk.waitForTicks(1);
            if ((shopLine()?.count ?? 0) >= stockBefore) stall++;
            else stall = 0;
        }
        log(`Bought ${arrowCount() - before} ${tier.name} arrows at ${ARCHERY.label} | ${coins()}gp | total ${arrowCount()}`);
        await bot.closeShop();
        await equipGear();
        if (shopId === 'lowe' && pos().x > 3225) await moveNear(bot, sdk, VARROCK_SQUARE.x, VARROCK_SQUARE.z, 4);
    }

    function shopPrice(line: { count: number; baseCost?: number }, initial: number): number {
        const cfg = sdk.getState()?.shop?.shopConfig;
        const cost = line.baseCost || 1;
        const haggle = cfg?.haggle ?? 10;
        const sellMult = cfg?.sellMultiplier ?? 1000;
        const raw = Math.min(1000, Math.max(-5000, ((line.count ?? 0) - initial) * haggle));
        return Math.max(1, Math.floor((cost * Math.max(100, sellMult - raw)) / 1000));
    }

    async function openCatherbyBank(): Promise<boolean> {
        if (sdk.getState()?.shop?.isOpen) await bot.closeShop();
        if (inDungeon()) await climbToSurface();
        if (onSurfaceWildy()) await crossDitchSouth();
        if (pos().x > 2900) {
            for (const tile of WHITE_WOLF_TO_CATHERBY) {
                if (Math.hypot(pos().x - tile.x, pos().z - tile.z) <= 6) continue;
                await hopToward(tile.x, tile.z, 4, 6);
            }
        }
        if (sdk.getState()?.bank?.isOpen && Math.hypot(pos().x - CATHERBY_BANK.x, pos().z - CATHERBY_BANK.z) <= 8) return true;
        await moveNear(bot, sdk, CATHERBY_BANK.x, CATHERBY_BANK.z, 4);
        if (sdk.getState()?.bank?.isOpen) return true;
        const opened = await bot.openBank();
        if (!opened.success) log(`Catherby bank failed: ${opened.message}`);
        return opened.success || sdk.getState()?.bank?.isOpen === true;
    }

    async function openArcheryShop(): Promise<boolean> {
        await moveNear(bot, sdk, ARCHERY.x, ARCHERY.z, 2);
        for (let attempt = 0; attempt < 4 && !sdk.getState()?.shop?.isOpen; attempt++) {
            const door = sdk.findNearbyLoc(/door/i, { withOption: /open/i });
            if (door && (door.distance ?? 99) <= 5) await bot.openDoor(door);
            await sdk.sendWalk(ARCHERY.x, ARCHERY.z, true);
            await sdk.waitForTicks(2).catch(() => {});
            const opened = await bot.openShop(ARCHERY.npc);
            if (opened.success || sdk.getState()?.shop?.isOpen) return true;
            const dialog = sdk.getDialog();
            if (dialog?.isOpen) {
                const choice = dialog.options.find((option) => /trade|yes|shop/i.test(option.text)) ?? dialog.options[0];
                if (choice) await sdk.sendClickDialog(choice.index);
                await sdk.waitForCondition((state) => state.shop?.isOpen === true, 8_000).catch(() => {});
            }
            log(`${ARCHERY.label} shop attempt ${attempt + 1}: ${opened.message}`);
        }
        return sdk.getState()?.shop?.isOpen === true;
    }

    /** Buy the live shelf down to zero. Stops when the next arrow costs more than the purse. */
    async function buyOut(name: string, pattern: RegExp, initial: number): Promise<number> {
        const before = arrowCount();
        let stall = 0;
        while (stall < 4) {
            const line = sdk.getState()?.shop?.shopItems.find((item) => pattern.test(item.name)) ?? null;
            if (!line || line.count <= 0) break;
            if (coins() < shopPrice(line, initial)) {
                log(`${ARCHERY.label} ${name} costs ${shopPrice(line, initial)}gp, purse ${coins()}gp, shelf ${line.count}`);
                break;
            }
            const stockBefore = line.count;
            const clicks = Math.min(8, Math.ceil(stockBefore / 10));
            for (let n = 0; n < clicks; n++) {
                const bought = await sdk.sendShopBuy(line.slot, 10);
                if (!bought.success) {
                    log(`Buy ${name} send failed: ${bought.message}`);
                    break;
                }
            }
            await sdk.waitForTicks(1);
            const left = sdk.getState()?.shop?.shopItems.find((item) => pattern.test(item.name))?.count ?? 0;
            if (left >= stockBefore) stall++;
            else stall = 0;
        }
        const gained = arrowCount() - before;
        const left = sdk.getState()?.shop?.shopItems.find((item) => pattern.test(item.name))?.count ?? 0;
        log(`Bought ${gained} ${name} arrows at ${ARCHERY.label} | shelf ${left} | ${coins()}gp | total ${arrowCount()}`);
        return gained;
    }

    async function clearHicktonShelf(): Promise<void> {
        await session.setPhase('shop');
        log(`Clearing ${ARCHERY.label} iron then bronze arrows`);
        if (!(await openCatherbyBank())) return;
        await depositJunk();
        if (!hasShortbow() && !wantMsb()) {
            const took = await bot.withdrawItem(SHORTBOW, 1, { asNote: false }).catch(() => null);
            log(`Withdraw shortbow: ${took?.success || took?.partial ? 'ok' : (took?.message ?? 'none in bank')}`);
        }
        const bankGp = sdk.findBankItem(COINS)?.count ?? 0;
        const purse = 80_000;
        if (coins() < purse && bankGp > 0) {
            const took = await bot.withdrawItem(COINS, Math.min(purse - coins(), bankGp));
            log(`Withdraw coins for ${ARCHERY.label}: ${took.success || took.partial} now ${coins()}gp`);
        }
        await bot.closeBank();
        if (coins() < 1) {
            log(`No coins for ${ARCHERY.label}`);
            return;
        }
        if (!(await openArcheryShop())) {
            log(`${ARCHERY.label} shop did not open`);
            return;
        }
        if (!hasShortbow() && !wantMsb()) {
            const bowLine = sdk.getState()?.shop?.shopItems.find((item) => SHORTBOW.test(item.name));
            if (bowLine && bowLine.count > 0 && coins() >= shopPrice(bowLine, 4)) {
                const bought = await bot.buyFromShop(SHORTBOW, 1);
                log(`Buy shortbow at ${ARCHERY.label}: ${bought.success || bought.partial ? 'ok' : bought.message}`);
            }
        }
        await buyOut('iron', /^iron arrows?$/i, ARCHERY.iron);
        await buyOut('bronze', /^bronze arrows?$/i, ARCHERY.bronze);
        await bot.closeShop();
        await equipGear();
        if (await openCatherbyBank()) {
            await bot.depositItem(/dragonfire shield/i, -1).catch(() => {});
            if (coins() > 0) await bot.depositItem(COINS, -1);
            await depositJunk();
            await bot.closeBank();
        }
        log(`Hickton clear done food=${foodCount()} arrows=${arrowCount()} bow=${hasBow()} coins=${coins()}gp`);
    }

    async function prepareLoadout(): Promise<void> {
        await session.setPhase('bank');
        if (!(await openEdgevilleBank())) return;
        await depositJunk();
        await withdrawFood();
        await withdrawBowAndArrows();
        log(
            `Loadout food=${foodCount()}/${foodTarget()} def=${defenceLevel()} style=${wantedStyle()} arrows=${arrowCount()} bow=${hasBow()} msb=${hasMagicShortbow()}`
        );
        await bot.closeBank();
        if (arrowCount() < ARROW_RESTOCK_BELOW) await restockArrowsAtLowe();
        await equipGear();
        session.noteProgress('bank', `food ${foodCount()} arrows ${arrowCount()}`);
    }

    async function followRoute(points: { x: number; z: number; step?: number; tol?: number }[]): Promise<boolean> {
        for (const point of points) {
            if (pos().isDead) return false;
            const tol = point.tol ?? 2;
            if (Math.hypot(pos().x - point.x, pos().z - point.z) <= tol) continue;
            await hopToward(point.x, point.z, tol, point.step ?? 4);
            if (Math.hypot(pos().x - point.x, pos().z - point.z) > tol) {
                log(`Route stalled @ ${pos().x},${pos().z} toward ${point.x},${point.z}`);
                return false;
            }
        }
        return true;
    }

    async function openDoorHere(): Promise<void> {
        let locs = sdk.getNearbyLocs() ?? [];
        if (!locs.some((loc) => /door/i.test(loc.name))) locs = await sdk.scanNearbyLocs(12);
        const doors = locs
            .filter((loc) => /door/i.test(loc.name) && loc.optionsWithIndex.some((opt) => /^open$/i.test(opt.text)))
            .sort((a, b) => (a.distance ?? 99) - (b.distance ?? 99));
        for (const door of doors.slice(0, 2)) {
            const opt = door.optionsWithIndex.find((entry) => /^open$/i.test(entry.text));
            if (!opt) continue;
            const sent = await sdk.sendInteractLoc(door.x, door.z, door.id, opt.opIndex);
            log(`Open door @ ${door.x},${door.z}: ${sent.success ? 'ok' : sent.message}`);
            await sdk.waitForTicks(2);
        }
    }

    async function walkBanditCamp(): Promise<void> {
        const here = pos();
        // Already past the trees on the east edge of the tents.
        if (here.z >= 3694 && here.z <= 3710 && here.x >= 3018 && here.x <= 3042) {
            await hopToward(STAND.x, STAND.z, 2, 2);
            return;
        }
        const points: { x: number; z: number; step?: number; tol?: number }[] = [];
        if (here.x <= LAVA.xMax && here.z <= LAVA.zMax) {
            points.push({ x: LAVA.xMax + 22, z: Math.min(here.z, LAVA.zMin - 2), step: 4 });
        }
        if (here.z < 3690) {
            if (here.x < 3090 || here.z < 3605) points.push({ x: 3108, z: 3612, step: 6, tol: 3 });
            points.push({ x: 3110, z: 3700, step: 6, tol: 3 });
        }
        // The pond and a spear wall close the south shore. Go north of the water, then west.
        if (here.z < 3708) points.push({ x: 3071, z: Math.max(here.z, 3695), step: 1, tol: 0 });
        points.push(
            { x: 3071, z: 3711, step: 3, tol: 2 },
            { x: 3042, z: 3711, step: 4, tol: 2 },
            { x: 3042, z: 3708, step: 4, tol: 1 },
            { x: 3041, z: 3705, step: 4, tol: 1 },
            { x: 3036, z: 3705, step: 1, tol: 1 },
            { x: 3036, z: 3702, step: 1, tol: 1 },
            { x: STAND.x, z: STAND.z, step: 1, tol: 2 }
        );
        await followRoute(points);
    }

    async function walkDarkFortress(): Promise<void> {
        const here = pos();
        const inside = here.x >= 3020 && here.x <= 3042 && here.z >= 3620 && here.z <= 3643;
        if (inside) {
            await hopToward(STAND.x, STAND.z, 3, 3);
            return;
        }
        const points: { x: number; z: number; step?: number; tol?: number }[] = [];
        if (here.z < 3608 || here.x > 3088) points.push({ x: 3102, z: 3614, step: 6, tol: 3 });
        if (here.z > 3644) {
            points.push({ x: 3060, z: 3648, step: 4, tol: 3 });
            points.push({ x: 3060, z: 3614, step: 4, tol: 3 });
        }
        // The west cliff (x=3016) and the south cliff (z=3618) are not walkable.
        // Drop to the open row at z=3615 before moving east, then stop on that row.
        if (here.x < 3020 && here.z > 3616) {
            points.push({ x: 3013, z: here.z, step: 1, tol: 0 });
            points.push({ x: 3013, z: 3615, step: 1, tol: 1 });
        } else if (here.x >= 3044 && here.z > 3616) {
            // 3046,3620 is a tree stump. Step west, then down the open staircase.
            points.push(
                { x: 3044, z: 3621, step: 1, tol: 0 },
                { x: 3045, z: 3619, step: 1, tol: 0 },
                { x: 3045, z: 3618, step: 1, tol: 0 },
                { x: 3044, z: 3617, step: 1, tol: 0 },
                { x: 3043, z: 3616, step: 1, tol: 0 }
            );
        }
        points.push({ x: 3034, z: 3615, step: 1, tol: 2 });
        const atCliff = await followRoute(points);
        if (!atCliff) return;
        await openDoorHere();
        await hopToward(3024, 3626, 2, 2);
        await openDoorHere();
        if (pos().z >= 3620 && pos().x >= 3020 && pos().x <= 3042) await hopToward(STAND.x, STAND.z, 3, 2);
    }

    async function goToCamp(): Promise<void> {
        await session.setPhase(CAMP.label);
        await eatIfNeeded();
        if (CAMP.dungeon) {
            if (!(await climbIntoDungeon())) return;
            if (pos().z < WILDY_GATE.z - 2) {
                await moveNear(bot, sdk, WILDY_GATE.x, WILDY_GATE.z - 2, 3);
                const gate = sdk.findNearbyLoc(/gate/i, { withOption: /open/i });
                if (gate) await bot.openDoor(gate);
            }
            if (pos().z >= SKELETON_LINE) await moveNear(bot, sdk, STAND.x, SKELETON_LINE - 4, 3);
            await moveNear(bot, sdk, STAND.x, STAND.z, 4);
        } else {
            if (inDungeon()) await climbToSurface();
            if (!(await crossDitchNorth())) {
                log(`Ditch did not open @ ${pos().x},${pos().z}`);
                return;
            }
            if (campId === 'bandits') await walkBanditCamp();
            else if (campId === 'dark-warriors') await walkDarkFortress();
            else await hopToward(STAND.x, STAND.z, 5);
        }
        const dist = Math.round(Math.hypot(pos().x - STAND.x, pos().z - STAND.z));
        log(`Camp ${CAMP.label} @ ${pos().x},${pos().z} dist ${dist}`);
        session.noteProgress('location', `${pos().x},${pos().z}`);
    }

    function atCamp(): boolean {
        return Math.hypot(pos().x - STAND.x, pos().z - STAND.z) <= (CAMP.dungeon ? 12 : 10);
    }

    function findTarget() {
        return (sdk.getNearbyNpcs() ?? [])
            .filter(
                (npc) =>
                    CAMP.npc.test(npc.name) &&
                    (npc.hp === null || npc.hp > 0) &&
                    npc.optionsWithIndex.some((opt) => /attack/i.test(opt.text)) &&
                    npc.reachable !== false &&
                    (CAMP.dungeon ? npc.z < SKELETON_LINE : true)
            )
            .sort((a, b) => Number(a.inCombat) - Number(b.inCombat) || (a.distance ?? 99) - (b.distance ?? 99))[0];
    }

    async function keepRange(): Promise<void> {
        const here = pos();
        if (!here.inCombat || here.targetType !== 'npc') return;
        const target = sdk.getNearbyNpcs().find((npc) => npc.index === here.targetIndex);
        if ((target?.distance ?? 99) > 1) return;
        if (CAMP.dungeon) {
            await moveNear(bot, sdk, STAND.x, STAND.z - 3, 2);
            return;
        }
        const dx = pos().x - (target?.x ?? pos().x);
        const dz = pos().z - (target?.z ?? pos().z);
        const scale = Math.max(1, Math.hypot(dx, dz));
        await sdk.sendWalk(Math.round(pos().x + (dx / scale) * 3), Math.round(pos().z + (dz / scale) * 3), true);
        await sdk.waitForTicks(1).catch(() => {});
    }

    function inLava(x: number, z: number): boolean {
        return x >= LAVA.xMin && x <= LAVA.xMax && z >= LAVA.zMin && z <= LAVA.zMax;
    }

    /** Half keys first, then arrow stacks, then runes, then herbs. */
    function lootRank(name: string, count: number): number | null {
        if (KEY_HALF.test(name)) return 0;
        if (canFire(name) && count >= 5) return 1;
        if (RUNE.test(name)) return 2;
        if (HERB.test(name)) return 3;
        return null;
    }

    async function pickupGroundLoot(): Promise<void> {
        for (let i = 0; i < 12; i++) {
            if (occupied() >= 28 || pos().isDead) return;
            const ground = sdk.getGroundItems() ?? [];
            const stack = ground
                .filter((item) => {
                    if (lootRank(item.name, item.count ?? 0) === null) return false;
                    return item.reachable !== false && (item.distance ?? 99) <= 10 && !inLava(item.x, item.z);
                })
                .sort(
                    (a, b) =>
                        (lootRank(a.name, a.count ?? 0) ?? 9) - (lootRank(b.name, b.count ?? 0) ?? 9) ||
                        (a.distance ?? 99) - (b.distance ?? 99)
                )[0];
            if (!stack) return;
            if ((stack.distance ?? 99) > 2) {
                if (CAMP.dungeon) await moveNear(bot, sdk, stack.x, stack.z, 1);
                else await hopToward(stack.x, stack.z, 1, 3);
            }
            const picked = await bot.pickupItem(stack);
            if (!picked.success) {
                log(`Pickup ${stack.count} ${stack.name}: ${picked.message}`);
                return;
            }
            log(`Picked ${stack.count} ${stack.name}`);
            if (ARROW.test(stack.name)) await equipGear();
        }
    }

    async function shoot(): Promise<void> {
        await pickupGroundLoot();
        const target = findTarget();
        if (!target) {
            if (!atCamp()) await goToCamp();
            else await sdk.waitForTicks(2);
            return;
        }
        const distance = target.distance ?? 99;
        if (distance > 8) {
            if (CAMP.dungeon) await moveNear(bot, sdk, target.x, target.z, 6);
            else await hopToward(target.x, target.z, 6, 4);
        }
        const specced = await enableMsbSpec();
        const opt = target.optionsWithIndex.find((entry) => /attack/i.test(entry.text));
        if (!opt) return;
        const sent = await sdk.sendInteractNpc(target.index, opt.opIndex);
        if (!sent.success) {
            log(`Attack ${target.name}: ${sent.message}`);
            return;
        }
        const noPower = (sdk.getState()?.gameMessages ?? []).some((message) => /enough power/i.test(message.text));
        if (noPower) {
            specArmed = false;
            specEnergy = Math.min(specEnergy, MSB_SPEC_COST - 1);
            log(`Spec not enough power — energy tracked ${specEnergy}`);
        } else if (specced) {
            noteSpecUsed();
        }
        const xpBefore = rangedXp();
        const started = Date.now();
        while (Date.now() - started < 20_000 && !pos().isDead) {
            await bot.dismissBlockingUI();
            await eatIfNeeded();
            await keepRange();
            const still = sdk.getNearbyNpcs().find((npc) => npc.index === target.index);
            if (still?.hp === 0) break;
            if (!pos().inCombat && Date.now() - started > 4_000) break;
            await sdk.waitForTicks(1);
        }
        await sdk.waitForTicks(1);
        await pickupGroundLoot();
        const gained = rangedXp() - xpBefore;
        if (gained > 0) {
            session.noteProgress('xp', `ranged +${gained}`);
            log(`Ranged xp +${gained} level ${rangedLevel()} total ${rangedXp()}`);
            watchXp = rangedXp();
            watchAt = Date.now();
        }
    }

    let lastLevel = rangedLevel();
    let skipFoodTrim = false;
    log(
        `Range ${CAMP.label} via ${ARCHERY.label} (${wantedStyle()}). Ranged ${lastLevel} Defence ${defenceLevel()} @ ${pos().x},${pos().z} arrows=${arrowCount()} food=${foodCount()}/${foodTarget()}`
    );
    await bot.dismissBlockingUI();
    if (clearShelf && shopId === 'hickton') await clearHicktonShelf();
    await equipGear();
    if (
        !hasBow() ||
        (wantMsb() && !hasMagicShortbow() && !msbMissing) ||
        foodCount() === 0 ||
        foodCount() > foodTarget() ||
        arrowCount() < ARROW_LEAVE
    ) {
        await prepareLoadout();
    }
    await goToCamp();

    while (!session.isStopped()) {
        if (session.needsRecovery()) {
            if ((await session.recover()) !== 'resumed') break;
        }
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
            log('Player combat — leaving');
            await leaveDanger();
            await prepareLoadout();
            await goToCamp();
            continue;
        }
        const level = rangedLevel();
        if (level !== lastLevel) {
            log(`LEVEL UP Ranged ${level} (${rangedXp()} xp)`);
            lastLevel = level;
            if (level >= RANGED_MSB) msbMissing = false;
            if (level >= 99) log('Ranged 99 — switching to Longrange');
        }
        await eatIfNeeded();
        if (CAMP.dungeon && (pos().z >= SKELETON_LINE || sdk.getNearbyNpcs().some((npc) => /^skeleton$/i.test(npc.name) && (npc.distance ?? 99) <= 6))) {
            log('Backing off skeletons');
            await moveNear(bot, sdk, STAND.x, Math.min(STAND.z, SKELETON_LINE - 6), 3);
            continue;
        }
        const leavingForSupplies =
            foodCount() === 0 || arrowCount() < ARROW_LEAVE || !hasBow() || (wantMsb() && !hasMagicShortbow() && !msbMissing);
        if (!leavingForSupplies && atCamp() && occupied() < 28) await pickupGroundLoot();
        if (wantMsb() && !hasMagicShortbow() && !msbMissing) {
            log(`Ranged ${level} — banking for a magic shortbow`);
            await prepareLoadout();
            await goToCamp();
            continue;
        }
        const tooMuchFood = !skipFoodTrim && foodCount() > foodTarget();
        if (foodCount() === 0 || arrowCount() < ARROW_LEAVE || !hasBow() || occupied() >= 26 || tooMuchFood) {
            const beforeFood = foodCount();
            log(`Banking food=${beforeFood}/${foodTarget()} arrows=${arrowCount()} loot=${lootPieces()} slots=${occupied()}`);
            await prepareLoadout();
            if (beforeFood > foodTarget() && foodCount() > foodTarget()) skipFoodTrim = true;
            if (foodCount() <= foodTarget()) skipFoodTrim = false;
            if (foodCount() === 0 || arrowCount() <= 0 || !hasBow()) {
                session.stop('needs_supplies', `food=${foodCount()} arrows=${arrowCount()} bow=${hasBow()}`);
                break;
            }
            await goToCamp();
            continue;
        }
        if (!atCamp()) {
            await goToCamp();
            continue;
        }
        await equipGear();
        await shoot();
    }
    await session.finalizeStop();
});
