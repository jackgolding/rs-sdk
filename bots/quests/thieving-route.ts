/**
 * Shared thieving route: Lumbridge men → Al Kharid warriors →
 * wilderness lever to Ardougne → knights / paladins / heroes.
 *
 *   bun bots/quests/thieving-route.ts ABGARMY01
 *   bun bots/quests/thieving-route.ts Jackpoo3
 *
 * Jackpoo3 and fatpig also buy Aemad bronze arrows (or ranging-guild tips).
 */
import { ActivitySession, BotSDK, deriveGatewayUrl } from '../../sdk/index';
import { BotActions } from '../../sdk/actions';
import { initPathfinding } from '../../sdk/pathfinding';
import { existsSync, readFileSync } from 'fs';
import { dirname, join } from 'path';
import {
    AEMAD_SHOP,
    ARDOUGNE_BANK,
    ARDOUGNE_MARKET,
    ARDY_TO_CATHERBY,
    ARDY_TO_RANGING,
    CATHERBY_BANK,
    CATHERBY_TO_ARDY,
    DARGAUD,
    DRAYNOR_BANK,
    EDGEVILLE,
    HOUSE_DOOR,
    HOUSE_DOOR_SOUTH,
    HOUSE_OUTSIDE,
    HOUSE_STAND,
    HANDELMORT_SAFE_EAST,
    inHandelmortMansion,
    LUMBRIDGE_MEN,
    PORT_SARIM_DOCK,
    RANGING_CHICKENS,
    RANGING_GUILD_DOOR
} from './tiles';
import {
    recoverStun as recoverStunShared,
    recoverGangplank,
    recoverLeverOscillation,
    leaveAdjacentClosedDoor,
    walkNear as walkNearShared
} from './movement';
import { foodHp } from './food-heal';
import { FOOD_MULE, usesFoodMule } from './tree-trade-plan';

const TARGET_LEVEL = 99;
const RESTOCK_FOOD_BELOW = 1;
const INV_PACK_LOOT_AT = 26;
const INV_KEEP_FREE = 3;
const EAT_MISSING_HP = 14;
/** Un-noted fish heals; best-heal-first for eating and bank withdraw. */
const THIEVE_FISH = ['swordfish', 'bass', 'lobster', 'tuna', 'cod'] as const;
const THIEVE_FISH_RE = /^(swordfish|bass|lobster|tuna|cod)$/i;
const MULE_FOOD = /^(tuna|swordfish|lobster|shark|cod|bass|jug of wine)$/i;
const WINE = /^jug of wine$/i;
const EMPTY_JUG = /^jug$/i;
const FOOD = /kebab|cake|bread|chocolate|slice|meat|shrimp|anchov|tuna|swordfish|lobster|shark|salmon|trout|pike|bass|cod|herring|sardine|mackerel|wine/i;
const SWORD = /^(bronze |iron |steel )?sword$/i;
const SLASH = /^(bronze |iron |steel |mithril |adamant |rune )?(axe|sword|scimitar|dagger|claws|battleaxe|longsword|2h sword)$|^knife$/i;

const LOGOUT_TAB = 10;
const LOGOUT_BUTTON = 2458;
const KNIGHTS = { x: 2652, z: 3318 };
const PALADINS = { x: 2653, z: 3315 };
const HEROES = { x: 2630, z: 3288 };
const EDGEVILLE_BANK = { x: 3094, z: 3492 };
const BRONZE_ARROW = /^bronze arrows?$/i;
const RUNE_TIPS = /^rune arrowtips?$/i;
const BRONZE_COIN_WITHDRAW = 2_500;
const TIPS_COIN_WITHDRAW = 50_000;
const BOBS_AXES = { x: 3232, z: 3203 };
const ALKHARID_GATE = { x: 3267, z: 3228 };
const ALKHARID_WARRIORS = { x: 3301, z: 3166 };
const KEBAB_SELLER = { x: 3273, z: 3180 };
/** North around the toll: Lumbridge → south-Varrock → Al Kharid mine → town. */
const ALKHARID_NORTH_BYPASS = [
    { x: 3225, z: 3295 },
    { x: 3232, z: 3325 },
    { x: 3258, z: 3338 },
    { x: 3288, z: 3332 },
    { x: 3300, z: 3295 },
    { x: 3295, z: 3240 },
    { x: 3280, z: 3190 },
    { x: 3273, z: 3180 }
];
const ALKHARID_GATE_GIVEUP_MS = 60_000;
/** West Lumbridge chicken farm — used only before the wildy run. */
const LUMBY_CHICKENS = { x: 3185, z: 3277 };
/** Kitchen knife spawn SE of Lumbridge castle — use-on-web slashes the keep web. */
const LUMBY_KNIFE = { x: 3224, z: 3202 };
const TARGET_HP = 30;
const MIN_THIEVE_HP = 15;
/** Deserted Keep lever — pulls to East Ardougne (2562, 3311). */
const WILDY_LEVER = { x: 3154, z: 3924 };
/** North keep web (3158,3951) is a wall tile — never sendWalk onto it or the client routes south around the keep. */
const KEEP_WEB = { x: 3158, z: 3951 };
/** Walkable tile just north of the web. */
const WEB_STAND = { x: 3158, z: 3953 };
/** Members wildy gate east of the giant spiders — around the keep fence. */
const SPIDER_GATE = { x: 3224, z: 3904 };
const WILDY_TO_LEVER = [
    { x: 3088, z: 3525 },
    { x: 3102, z: 3610 },
    { x: 3110, z: 3700 },
    { x: 3125, z: 3790 },
    { x: 3135, z: 3865 },
    { x: 3135, z: 3895 },
    { x: 3135, z: 3954 },
    { x: 3158, z: 3953 }
];
const BRIMHAVEN_CUSTOMS = { x: 2772, z: 3225 };
const MUSA_TO_BRIMHAVEN = [
    { x: 2864, z: 3154 },
    { x: 2836, z: 3188 },
    { x: 2798, z: 3208 },
    { x: 2772, z: 3225 }
];

const argv = process.argv.slice(2);
const botArg = argv.find((a) => !a.startsWith('-'));

function loadBotEnv(): void {
    const envPath = botArg
        ? join(process.cwd(), 'bots', botArg, 'bot.env')
        : join(dirname(import.meta.path), 'bot.env');
    if (!existsSync(envPath)) {
        throw new Error(`bot.env not found at ${envPath}. Usage: bun bots/quests/thieving-route.ts {botname}`);
    }
    for (const line of readFileSync(envPath, 'utf-8').split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eq = trimmed.indexOf('=');
        if (eq > 0) process.env[trimmed.slice(0, eq)] = trimmed.slice(eq + 1);
    }
}

loadBotEnv();

const username = process.env.BOT_USERNAME!;
const password = process.env.PASSWORD!;
const server = process.env.SERVER;
const GRIND_LOG = join(process.cwd(), 'bots', username, 'grind.log');
const SHOP_ARROWS = /^(Jackpoo3|fatpig)$/i.test(username);

let session!: ActivitySession;

function log(msg: string): void {
    session.log('log', msg);
}

initPathfinding();

const sdk = new BotSDK({
    botUsername: username,
    password,
    gatewayUrl: deriveGatewayUrl(server),
    autoLaunchBrowser: false,
    browserLaunchTimeout: 90_000,
    readyTimeout: 45_000,
    connectTimeout: 60_000,
    showChat: true
});

await sdk.connect();
const bot = new BotActions(sdk);
session = new ActivitySession(sdk, bot, {
    name: 'thieving',
    grindLogPath: GRIND_LOG,
    maxRecoveryTactics: 8,
    // Lumbridge → Edgeville → lever is a single walkTo that exceeds the 2 min
    // default; stall recovery then walkTo(Ardougne) and dies on White Wolf.
    stallMs: 8 * 60_000
});

let lastLoggedLevel = 0;

function intent(msg: string): void {
    void session.showIntent(msg);
}

async function enterPhase(name: string): Promise<void> {
    if (session.metrics().phase === name) return;
    await session.setPhase(name);
}

async function tickSession(): Promise<boolean> {
    if (session.isStopped()) return false;
    if (session.needsRecovery()) {
        return (await session.recover()) === 'resumed';
    }
    return true;
}

function rangedLevel(): number {
    return sdk.getSkill('Ranged')?.baseLevel ?? 1;
}

function buyRuneTips(): boolean {
    return SHOP_ARROWS && rangedLevel() > 40;
}

function shopItemPattern(): RegExp {
    return buyRuneTips() ? RUNE_TIPS : BRONZE_ARROW;
}

function thievingLevel(): number {
    return sdk.getSkill('Thieving')?.baseLevel ?? 1;
}

function bankItemLabel(name: string, count: number): string {
    if (/^coins?$/i.test(name)) return 'gold';
    const n = name.toLowerCase();
    if (count !== 1 && /rune$/i.test(n)) return `${n}s`;
    return n;
}

function logBank(): void {
    const items = sdk.getBankItems().filter((i) => (i.count ?? 0) > 0);
    const hp = foodHp(items);
    const parts = items.map((i) => `${i.count} ${bankItemLabel(i.name, i.count)}`);
    session.log('log', `banked hp=${hp}${parts.length ? ` ${parts.join(' ')}` : ''}`);
}

function pos() {
    const p = sdk.getState()?.player;
    return {
        x: p?.worldX ?? 0,
        z: p?.worldZ ?? 0,
        level: p?.level ?? 0,
        hp: p?.hp ?? 10,
        maxHp: p?.maxHp ?? 10,
        isDead: p?.isDead ?? false,
        inCombat: p?.combat?.inCombat ?? false
    };
}

function inArdougne(): boolean {
    const p = pos();
    return p.x > 2500 && p.x < 2720 && p.z > 3240 && p.z < 3355 && p.z < 6400;
}

function nearSeersCatherby(): boolean {
    const p = pos();
    // Catherby / Seers / west slope of White Wolf. Taverley starts ~2884.
    return p.x >= 2680 && p.x <= 2878 && p.z >= 3320 && p.z < 3520 && p.z < 6400;
}

/** Already west of White Wolf — never walk to Edgeville/Draynor from here. */
function inKandarin(): boolean {
    const p = pos();
    return (
        inArdougne() ||
        nearSeersCatherby() ||
        onKaramja() ||
        inKeepLeFaye() ||
        inLegendsGuild() ||
        (p.x > 2400 && p.x < 2878 && p.z > 3200 && p.z < 3550 && p.z < 6400)
    );
}

/** Keep Le Faye — giant bats behind the door at ~2752,3409. */
function inKeepLeFaye(): boolean {
    const p = pos();
    return p.x >= 2746 && p.x <= 2772 && p.z >= 3390 && p.z <= 3422 && p.z < 6400;
}

/** Mithril gates (2728,3349) and the courtyard north of them. */
function inLegendsGuild(): boolean {
    const p = pos();
    return p.x >= 2714 && p.x <= 2742 && p.z >= 3344 && p.z <= 3388 && p.z < 6400;
}

function onKaramja(): boolean {
    const p = pos();
    return p.x > 2680 && p.x < 3010 && p.z > 3040 && p.z < 3270;
}

function onMusa(): boolean {
    return onKaramja() && pos().x >= 2815;
}

function onDockedShip(): boolean {
    if (inArdougne()) return false;
    if (pos().level < 1) return false;
    const locs = sdk.getNearbyLocs() ?? [];
    return locs.some((l) => /gangplank|ship's (ladder|wheel)|anchor/i.test(l.name));
}

function inWilderness(): boolean {
    const p = pos();
    return p.z >= 3520 && p.z < 6400 && p.x >= 2944 && p.x < 3392;
}

function slashItem() {
    return bot.findEquippedItem(SLASH) ?? sdk.findInventoryItem(SLASH);
}

function wildySword() {
    return bot.findEquippedItem(SWORD) ?? sdk.findInventoryItem(SWORD);
}

/** Slash weapon equipped (sword or axe), inventory otherwise empty. */
function packedForWildy(): boolean {
    if (bot.findEquippedItem(/shield|defender/i)) return false;
    const extra = sdk.getInventory().filter((i) => (i.count ?? 0) > 0 && !SLASH.test(i.name));
    return extra.length === 0 && !!slashItem();
}

function nearestPreWildyBank() {
    return distTo(DRAYNOR_BANK.x, DRAYNOR_BANK.z) <= distTo(EDGEVILLE_BANK.x, EDGEVILLE_BANK.z)
        ? DRAYNOR_BANK
        : EDGEVILLE_BANK;
}

async function bankForWildy(): Promise<boolean> {
    if (inWilderness() || pos().z >= 3508) return packedForWildy() || !!slashItem();
    if (inKandarin()) {
        log('Already west of White Wolf — not walking to Edgeville for a wildy pack');
        return false;
    }
    if (packedForWildy()) return true;

    if (await leaveAdjacentClosedDoor(sdk)) {
        log(`Left a closed building @ ${pos().x},${pos().z} — walking to wildy bank`);
    } else {
        const boxed = (sdk.getNearbyLocs() ?? []).filter(
            (l) => /door|gate/i.test(l.name) && (l.distance ?? 99) <= 2
        );
        if (boxed.length) {
            log(
                `Still boxed in @ ${pos().x},${pos().z} doors=${boxed
                    .map((d) => `${d.name}@${d.x},${d.z}[${(d.options ?? []).join('/')}]`)
                    .join('; ')}`
            );
        }
    }

    const bank = nearestPreWildyBank();
    intent(`Banking at ${bank === DRAYNOR_BANK ? 'Draynor' : 'Edgeville'} — wildy run takes a sword only`);
    await walkNear(bank.x, bank.z, 4);
    const opened = await bot.openBank();
    if (!opened.success && !sdk.getState()?.bank?.isOpen) {
        log(`Wildy bank open failed: ${opened.message}`);
        return false;
    }

    const shield = bot.findEquippedItem(/shield|defender/i);
    if (shield) await bot.unequipItem(shield);
    const wrongWep = bot.findEquippedItem(/bow|pickaxe|mace/i);
    if (wrongWep) await bot.unequipItem(wrongWep);

    for (let n = 0; n < 28; n++) {
        const junk = sdk.getInventory().find((i) => (i.count ?? 0) > 0 && !SLASH.test(i.name));
        if (!junk) break;
        await bot.depositItem(junk, -1);
        await sdk.waitForTicks(1);
    }
    const extraSlash = sdk.getInventory().filter((i) => SLASH.test(i.name));
    if (bot.findEquippedItem(SLASH) && extraSlash.length) {
        await bot.depositItem(extraSlash[0]!, extraSlash[0]!.count);
    } else if (extraSlash.length > 1) {
        await bot.depositItem(extraSlash[1]!, extraSlash[1]!.count);
    }

    if (!slashItem()) {
        const fromBank =
            sdk.findBankItem(/^(bronze |iron |steel )?sword$/i) ??
            sdk.findBankItem(/iron axe/i) ??
            sdk.findBankItem(/bronze axe/i) ??
            sdk.findBankItem(/^knife$/i) ??
            sdk.findBankItem(SLASH);
        if (fromBank) {
            const r = await bot.withdrawItem(fromBank, 1);
            log(`Withdraw slash ${fromBank.name} ${r.success ? 'ok' : r.message}`);
        } else {
            log('No sword or axe in bank to slash the keep web');
        }
    }
    await bot.closeBank();

    if (!slashItem()) {
        const gotKnife = await pickupLumbyKnife();
        log(`Lumbridge knife ${gotKnife ? 'ok' : 'missing'} — kitchen knife works if used on the web`);
        if (!gotKnife) await ensureSlashWeapon();
    }

    const weapon = slashItem();
    if (weapon && !/^knife$/i.test(weapon.name) && !bot.findEquippedItem(SLASH)) await bot.equipItem(weapon);
    const stillShield = bot.findEquippedItem(/shield|defender/i);
    if (stillShield) await bot.unequipItem(stillShield);

    const packed = packedForWildy();
    log(`Wildy pack ${packed ? 'ok' : 'still has extras'} slash=${slashItem()?.name ?? 'none'} inv=${occupiedSlots()}`);
    return packed;
}

function distTo(x: number, z: number): number {
    const p = pos();
    return Math.hypot(p.x - x, p.z - z);
}

function coinCount(): number {
    return sdk.findInventoryItem(/^coins$/i)?.count ?? 0;
}

function occupiedSlots(): number {
    return sdk.getInventory().filter((i) => (i.count ?? 0) > 0).length;
}

/** Un-noted fish / jug of wine. Noted mule fish stack (`count > 1`). */
function foodCount(): number {
    return sdk.getInventory().filter((i) => THIEVE_FISH_RE.test(i.name) && i.count === 1).length
        + sdk.getInventory().filter((i) => WINE.test(i.name)).length;
}

function emergencySharks(): number {
    return sdk.getInventory().filter((i) => /^shark$/i.test(i.name) && i.count === 1).length;
}

function hasThieveFood(): boolean {
    return foodCount() >= RESTOCK_FOOD_BELOW || emergencySharks() > 0;
}

function notedFood() {
    return sdk.getInventory().filter((i) => MULE_FOOD.test(i.name) && i.count > 1);
}

function isMuleKeep(name: string): boolean {
    return (
        THIEVE_FISH_RE.test(name) ||
        MULE_FOOD.test(name) ||
        WINE.test(name) ||
        EMPTY_JUG.test(name) ||
        SLASH.test(name) ||
        /^kebab$/i.test(name) ||
        /^shark$/i.test(name)
    );
}

function muleLootGiveList(): { item: RegExp; amount: number }[] {
    const give: { item: RegExp; amount: number }[] = [];
    const seen = new Set<string>();
    for (const item of sdk.getInventory()) {
        const count = item.count ?? 0;
        if (count <= 0 || isMuleKeep(item.name)) continue;
        const key = item.name.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        give.push({
            item: new RegExp(`^${item.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i'),
            amount: -1
        });
    }
    return give;
}

async function packNotedLootForMule(): Promise<void> {
    await bot.closeInterface();
    await leaveHouse();
    intent('Noting banked loot for ABGARMY01');
    await walkNear(ARDOUGNE_BANK.x, ARDOUGNE_BANK.z, 3);
    const opened = await bot.openBank();
    if (!opened.success && !sdk.getState()?.bank?.isOpen) {
        log(`Bank open failed for mule loot: ${opened.message}`);
        return;
    }
    await sdk
        .waitForCondition((s) => s.bank?.isOpen === true && (s.bank.items?.length ?? 0) > 0, 5_000)
        .catch(() => {});

    for (let n = 0; n < 28; n++) {
        const item = sdk.getInventory().find((i) => (i.count ?? 0) > 0 && !isMuleKeep(i.name));
        if (!item) break;
        const r = await bot.depositItem(item, -1);
        if (!r.success && !r.partial) break;
    }
    await sdk.waitForTicks(1);

    const lootNames = [
        ...new Set(
            sdk
                .getBankItems()
                .filter(
                    (i) =>
                        (i.count ?? 0) > 0 &&
                        !isMuleKeep(i.name) &&
                        !/^coins$/i.test(i.name)
                )
                .map((i) => i.name)
        )
    ];
    const packed: string[] = [];
    for (const name of lootNames) {
        const re = new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i');
        const bankItem = sdk.findBankItem(re);
        if (!bankItem || (bankItem.count ?? 0) <= 0) continue;
        const count = bankItem.count ?? 0;
        const r = await bot.withdrawItem(bankItem, -1, { asNote: true });
        packed.push(`${count} ${name}${r.success || r.partial ? '' : ` (${r.message})`}`);
    }

    const bankCoins = sdk.findBankItem(/^coins$/i)?.count ?? 0;
    if (bankCoins > 0) {
        const before = coinCount();
        const r = await bot.withdrawItem(/^coins$/i, bankCoins);
        await sdk.waitForCondition(() => coinCount() > before, 5_000).catch(() => {});
        packed.push(`${coinCount()} coins${r.success ? '' : ` (${r.message})`}`);
    }
    await bot.closeBank();
    log(`Packed mule loot: ${packed.join(', ') || `inv ${coinCount()} gp`}`);
}

function hasUnpackagedLoot(): boolean {
    return sdk.getInventory().some((i) => (i.count ?? 0) > 0 && !isMuleKeep(i.name));
}

/** Note loot at the bank during the grind so the mule visit is trade-only. */
async function maybePackLootWhileGrinding(): Promise<void> {
    if (!usesFoodMule(username) || !inArdougne()) return;
    if (occupiedSlots() < INV_PACK_LOOT_AT) return;
    if (muleLootGiveList().length > 0) return;
    if (!hasUnpackagedLoot()) return;
    intent('Inv full — noting loot at bank (off swap window)');
    log(`Pack loot trigger inv=${occupiedSlots()}/28 @ ${pos().x},${pos().z}`);
    await packNotedLootForMule();
    await walkNear(KNIGHTS.x, KNIGHTS.z, 4);
}

/** Spread bank arrivals so ABGARMY01 is not serving a full crowd at once. */
function muleBankStaggerMs(): number {
    const n = Number.parseInt(username.match(/\d+/)?.[0] ?? '', 10);
    if (!Number.isFinite(n)) return 0;
    return Math.max(0, (n - 2) % 19) * 5_000;
}

/** Walk to 01 at the Ardougne bank, give loot, take noted fish. */
async function swapFoodWithMule(): Promise<boolean> {
    if (!usesFoodMule(username) || !inArdougne()) return false;
    const swapStart = Date.now();
    let stepMs = swapStart;
    const mark = (label: string) => {
        const now = Date.now();
        log(`Mule swap +${now - swapStart}ms ${label} (+${now - stepMs}ms)`);
        stepMs = now;
    };

    await leaveHouse();
    await leaveHandelmortMansion();
    mark('left house/mansion');
    const stagger = muleBankStaggerMs();
    if (stagger > 0) {
        log(`Mule swap stagger ${stagger}ms`);
        await new Promise((r) => setTimeout(r, stagger));
    }
    intent(`Trading loot → ${FOOD_MULE} for food at bank`);
    await walkNear(ARDOUGNE_BANK.x, ARDOUGNE_BANK.z, 3);
    mark(`walked to bank @ ${pos().x},${pos().z}`);
    await bot.closeInterface();
    await bot.declineTrade().catch(() => {});
    if (muleLootGiveList().length === 0) {
        if (hasUnpackagedLoot()) {
            session.log('warn', 'Mule swap: no noted loot — pack during grind, not at trade tile');
            return false;
        }
        log('Mule swap: nothing to offer — skipping');
        return false;
    }
    mark(`loot ready (${muleLootGiveList().length} stacks)`);
    const give = muleLootGiveList().slice(0, 12);
    const loot = give.length
        ? sdk
              .getInventory()
              .filter((i) => (i.count ?? 0) > 0 && !isMuleKeep(i.name))
              .map((i) => `${i.count} ${i.name}`)
              .join(', ')
        : 'nothing';
    log(`Mule swap → ${FOOD_MULE} offering ${loot}`);
    const tradeStart = Date.now();
    const result = await bot.trade(FOOD_MULE, {
        give,
        want: [{ item: MULE_FOOD, amount: 1 }],
        requestTimeout: 30_000,
        timeout: 75_000,
        retryOnBusy: true
    });
    const t = result.timingsMs;
    const timing =
        t != null
            ? ` request=${t.requestMs ?? '?'} offer=${t.offerMs ?? '?'} accept=${t.acceptWaitMs ?? '?'} confirm=${t.confirmMs ?? '?'} session=${t.sessionMs ?? '?'}`
            : '';
    log(`Mule swap trade +${Date.now() - tradeStart}ms${timing}`);
    const noted = notedFood()
        .map((i) => `${i.count} ${i.name}`)
        .join(', ') || 'none';
    if (result.success) {
        log(
            `Mule swap ok got ${result.received.map((i) => `${i.count} ${i.name}`).join(', ') || 'nothing'} | eat-food=${foodCount()} notes=${noted} total=${Date.now() - swapStart}ms`
        );
        session.noteProgress('inventory', 'mule food');
    } else {
        session.log(
            'warn',
            `Mule swap failed ${result.reason} ${result.message} | notes=${noted} total=${Date.now() - swapStart}ms${timing}`
        );
    }
    return result.success;
}

const SHARK_EAT_BELOW_HP = 10;
const KEEP_EMERGENCY_SHARKS = 4;

function findEatFood(skip?: RegExp) {
    const candidates = [
        ...THIEVE_FISH.map((name) =>
            sdk.getInventory().find((i) => new RegExp(`^${name}$`, 'i').test(i.name) && i.count === 1)
        ),
        sdk.getInventory().find((i) => WINE.test(i.name)),
        pos().hp < SHARK_EAT_BELOW_HP
            ? sdk.getInventory().find((i) => /^shark$/i.test(i.name) && i.count === 1)
            : null,
        sdk.getInventory().find((i) => /^kebab$/i.test(i.name) && i.count === 1),
    ].filter(Boolean) as { name: string; slot: number; optionsWithIndex: { text: string; opIndex: number }[] }[];
    return candidates.find((i) => !skip?.test(i.name)) ?? null;
}

async function recoverLowHp(): Promise<boolean> {
    let skip: RegExp | undefined;
    for (let tries = 0; tries < 5; tries++) {
        const food = findEatFood(skip);
        if (!food) break;
        log(`Low HP recovery: trying ${food.name} at ${pos().hp}/${pos().maxHp}`);
        if (await consumeHeal(food)) return true;
        skip = new RegExp(`^${food.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i');
    }
    if (inAlKharid() || onAlKharidToll()) {
        if (Date.now() >= kebabBuyBlockedUntil) await buyTenKebabs();
        await eatIfNeeded();
        await sdk.waitForTicks(8);
        return true;
    }
    // Bank tuna is the Ardougne (55+) restock. nearestBank() is Catherby until
    // we're actually in/near Ardougne — don't walk there from Lumbridge/Edgeville.
    if (!inWilderness() && (inArdougne() || distTo(ARDOUGNE_BANK.x, ARDOUGNE_BANK.z) < 120)) {
        intent(`HP ${pos().hp} — stepping toward bank`);
        await walkNear(ARDOUGNE_BANK.x, ARDOUGNE_BANK.z, 8);
        if (!hasThieveFood()) {
            const bank = await ensureFood();
            if (!hasThieveFood() && bank.opened) {
                await logoutOutOfFood();
                return false;
            }
        }
    }
    await sdk.waitForTicks(8);
    return true;
}

async function dropEmptyJugs(): Promise<void> {
    for (let n = 0; n < 28; n++) {
        const jug = sdk.findInventoryItem(EMPTY_JUG);
        if (!jug) return;
        await sdk.sendDropItem(jug.slot);
        await sdk.waitForTicks(1);
    }
}

async function consumeHeal(item: { name: string; slot: number; optionsWithIndex: { text: string; opIndex: number }[] }): Promise<boolean> {
    const hpBefore = pos().hp;
    const drink = item.optionsWithIndex.find((o) => /drink/i.test(o.text));
    if (drink) {
        await sdk.sendUseItem(item.slot, drink.opIndex);
        await sdk.waitForTicks(2);
        await dropEmptyJugs();
        return pos().hp > hpBefore;
    }
    const result = await bot.eatFood(item);
    await dropEmptyJugs();
    return result.success && (result.hpGained > 0 || pos().hp > hpBefore);
}

async function walkNear(x: number, z: number, tolerance = 6): Promise<boolean> {
    if (distTo(x, z) <= tolerance) return true;
    if (onGateLine(x, z)) {
        x = x < 3270 ? 3258 : 3276;
        z = 3220;
    }
    if (onGateLine(pos().x, pos().z) || destCrossesAlKharidToll(x, z)) {
        await clickYesOrContinue(x > pos().x);
        await sdk.sendWalk(x, z, true);
        await sdk.waitForTicks(6);
        return distTo(x, z) <= tolerance + 4;
    }
    const result = await walkNearShared(bot, sdk, x, z, tolerance);
    return result;
}

function destCrossesAlKharidToll(x: number, z: number): boolean {
    const p = pos();
    const west = p.x < 3270;
    const destWest = x < 3270;
    if (west === destWest) return false;
    return Math.min(p.z, z) <= 3232 && Math.max(p.z, z) >= 3224;
}

async function eatIfNeeded(): Promise<void> {
    let skip: RegExp | undefined;
    for (let n = 0; n < 6; n++) {
        const { hp, maxHp } = pos();
        const need = Math.min(EAT_MISSING_HP, Math.max(4, maxHp - MIN_THIEVE_HP));
        if (hp >= MIN_THIEVE_HP && maxHp - hp < need) return;
        const food = findEatFood(skip);
        if (!food) return;
        intent(`Eating ${food.name} (${hp} hp)`);
        if (await consumeHeal(food)) continue;
        // Stun / busy tick rejects the eat with no message. Waiting it out and
        // retrying the same food is what stops the 16hp → 2hp death spiral.
        log(`Eat ${food.name} failed at ${hp}/${maxHp} hp — waiting stun then retry`);
        await sdk.waitForTicks(8);
        if (await consumeHeal(food)) continue;
        log(`Eat ${food.name} failed at ${pos().hp}/${pos().maxHp} hp — trying next food`);
        skip = new RegExp(`^${food.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i');
        await sdk.waitForTicks(2);
    }
}

function tooLowToThieve(): boolean {
    return pos().hp < MIN_THIEVE_HP;
}

/** Interior of the market-east house. Door tiles (2672,3311) and (2672,3305) are NOT inside. */
function inHouse(x: number, z: number): boolean {
    return x >= 2673 && x <= 2676 && z >= 3307 && z <= 3311;
}

function onHouseDoorTile(): boolean {
    const p = pos();
    return p.x === 2672 && p.z >= 3304 && p.z <= 3312;
}

async function stepOffHouseDoor(): Promise<void> {
    if (!onHouseDoorTile()) return;
    intent('Stepping west off the locked/closed house door');
    await sdk.sendWalk(HOUSE_OUTSIDE.x, HOUSE_OUTSIDE.z, true);
    await sdk.waitForTicks(3);
    if (onHouseDoorTile()) await walkNear(HOUSE_OUTSIDE.x, HOUSE_OUTSIDE.z, 1);
}

function knights() {
    return (sdk.getNearbyNpcs() ?? []).filter((n) => /^knight of ardougne$/i.test(n.name));
}

function knightInHouse() {
    return (
        knights()
            .filter((n) => inHouse(n.tileX ?? n.x, n.tileZ ?? n.z))
            .sort((a, b) => (a.distance ?? 99) - (b.distance ?? 99))[0] ?? null
    );
}

async function closeDoorAt(x: number, z: number): Promise<void> {
    const door = (sdk.getNearbyLocs() ?? []).find((l) => l.x === x && l.z === z && /door|gate/i.test(l.name));
    if (!door) return;
    const close = door.optionsWithIndex.find((o) => /^close$/i.test(o.text));
    if (!close) return;
    if (distTo(x, z) > 2) await walkNear(x, z, 1);
    await sdk.sendInteractLoc(door.x, door.z, door.id, close.opIndex);
    await sdk.waitForTicks(2);
}

async function sealHouseDoors(): Promise<void> {
    await closeDoorAt(HOUSE_DOOR.x, HOUSE_DOOR.z);
    await closeDoorAt(HOUSE_DOOR_SOUTH.x, HOUSE_DOOR_SOUTH.z);
}

async function openHouseDoor(): Promise<void> {
    await walkNear(HOUSE_OUTSIDE.x, HOUSE_OUTSIDE.z, 1);
    const door = (sdk.getNearbyLocs() ?? []).find(
        (l) => l.x === HOUSE_DOOR.x && l.z === HOUSE_DOOR.z && /door|gate/i.test(l.name)
    );
    if (door) await bot.openDoor(door);
    else await bot.openDoor();
    await sdk.waitForTicks(2);
}

async function enterHouseAndSeal(): Promise<boolean> {
    await stepOffHouseDoor();
    if (!inHouse(pos().x, pos().z)) {
        await openHouseDoor();
        const walked = await walkNear(HOUSE_STAND.x, HOUSE_STAND.z, 1);
        if (!walked || !inHouse(pos().x, pos().z)) {
            log(`Could not enter knight house @ ${pos().x},${pos().z} — skipping trap`);
            await stepOffHouseDoor();
            await walkNear(HOUSE_OUTSIDE.x, HOUSE_OUTSIDE.z, 1);
            return false;
        }
    } else if (distTo(HOUSE_STAND.x, HOUSE_STAND.z) > 1) {
        await walkNear(HOUSE_STAND.x, HOUSE_STAND.z, 1);
    }
    await sealHouseDoors();
    return inHouse(pos().x, pos().z);
}

async function leaveHouse(): Promise<void> {
    if (!inHouse(pos().x, pos().z) && !onHouseDoorTile()) return;
    await openHouseDoor();
    await walkNear(HOUSE_OUTSIDE.x, HOUSE_OUTSIDE.z, 1);
    await stepOffHouseDoor();
}

async function leaveHandelmortMansion(): Promise<void> {
    const p = pos();
    if (!inHandelmortMansion(p.x, p.z)) return;
    intent('Leaving Handelmort mansion — guard dogs');
    log(`Leaving mansion yard @ ${p.x},${p.z}`);
    const dest = HANDELMORT_SAFE_EAST;
    const hops = [
        { x: Math.min(p.x + 5, dest.x), z: p.z },
        { x: dest.x, z: p.z },
        dest
    ];
    for (const hop of hops) {
        if (!inHandelmortMansion(pos().x, pos().z)) return;
        const until = Date.now() + 12_000;
        while (
            distTo(hop.x, hop.z) > 2 &&
            inHandelmortMansion(pos().x, pos().z) &&
            Date.now() < until
        ) {
            void sdk.sendWalk(hop.x, hop.z, true).catch(() => {});
            await new Promise((r) => setTimeout(r, 500));
        }
    }
}

async function recoverStun(): Promise<void> {
    await recoverStunShared(sdk, eatIfNeeded);
}

function pick<T>(xs: T[]): T {
    return xs[Math.floor(Math.random() * xs.length)]!;
}

async function pm(text: string): Promise<void> {
    log(`(quiet) ${text}`);
}

function logPick(result: { success: boolean; reason?: string }, _npc: { name: string }): 'ok' | 'stunned' | 'fail' {
    if (result.reason === 'stunned') return 'stunned';
    return result.success ? 'ok' : 'fail';
}

function findPickNpc(pattern: RegExp) {
    return sdk.findNearbyNpc(pattern, { reachable: true }) ?? sdk.findNearbyNpc(pattern);
}

async function clickPickpocket(npc: { index: number; name: string }): Promise<'ok' | 'stunned' | 'fail'> {
    if (tooLowToThieve()) {
        await eatIfNeeded();
        return 'fail';
    }
    const fresh =
        (sdk.getNearbyNpcs() ?? []).find((n) => n.index === npc.index) ??
        findPickNpc(new RegExp(`^${npc.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i'));
    if (!fresh) return 'fail';
    const pickOpt = fresh.optionsWithIndex.find((o) => /pickpocket/i.test(o.text));
    if (!pickOpt) return 'fail';

    const xpBefore = sdk.getSkill('Thieving')?.experience ?? 0;
    const tickBefore = sdk.getState()?.tick ?? 0;
    await sdk.sendInteractNpc(fresh.index, pickOpt.opIndex);

    try {
        await sdk.waitForCondition((s) => {
            const xp = s.skills.find((sk) => sk.name === 'Thieving')?.experience ?? 0;
            if (xp > xpBefore) return true;
            for (const msg of s.gameMessages) {
                if (msg.tick <= tickBefore) continue;
                const t = msg.text.toLowerCase();
                if (
                    t.includes('stunned') ||
                    t.includes('caught') ||
                    t.includes('you fail to pick') ||
                    t.includes("you're stunned")
                ) {
                    return true;
                }
            }
            return false;
        }, 3_500);
    } catch {
        return 'fail';
    }

    if ((sdk.getSkill('Thieving')?.experience ?? 0) > xpBefore) return 'ok';
    return 'stunned';
}

async function spamPickpocket(
    findNpc: () => { index: number; name: string } | null | undefined,
    label: string
): Promise<'ok' | 'stunned' | 'fail' | 'none'> {
    let npc = findNpc();
    if (!npc) return 'none';
    intent(`Spamming ${label}`);
    let last: 'ok' | 'stunned' | 'fail' = 'fail';
    const until = Date.now() + 20_000;
    while (Date.now() < until) {
        if (pos().isDead) return last;
        if (tooLowToThieve()) {
            await eatIfNeeded();
            intent(`HP ${pos().hp} — not pickpocketing under ${MIN_THIEVE_HP}`);
            return last;
        }
        if (sdk.getDialog()?.isOpen) await bot.dismissBlockingUI();
        if (inHandelmortMansion(pos().x, pos().z)) {
            await leaveHandelmortMansion();
            continue;
        }
        if (!inHouse(pos().x, pos().z) && knightInHouse() && !/trapped/i.test(label)) {
            return last;
        }

        npc = findNpc();
        if (!npc) return last === 'fail' ? 'none' : last;

        last = await clickPickpocket(npc);
        logPick(
            { success: last === 'ok', reason: last === 'ok' ? undefined : last },
            npc
        );

        if (last === 'ok') {
            await eatIfNeeded();
            continue;
        }
        if (last === 'stunned') {
            await recoverStun();
            continue;
        }
    }
    return last;
}

async function pickpocketOpen(pattern: RegExp, spot: { x: number; z: number }, label: string): Promise<'ok' | 'stunned' | 'fail' | 'none'> {
    if (inHouse(pos().x, pos().z)) await leaveHouse();
    if (!findPickNpc(pattern)) {
        intent(`Walking to ${label}s`);
        await walkNear(spot.x, spot.z, 4);
    }
    return spamPickpocket(() => findPickNpc(pattern), label);
}

async function pickpocketBest(): Promise<'ok' | 'stunned' | 'fail' | 'none'> {
    await stepOffHouseDoor();
    await leaveHandelmortMansion();

    if (inHouse(pos().x, pos().z) || onHouseDoorTile()) await leaveHouse();

    const level = thievingLevel();
    if (level >= 80) {
        if (!findPickNpc(/^hero$/i) && distTo(HEROES.x, HEROES.z) > 8) {
            intent('Walking to heroes');
            await walkNear(HEROES.x, HEROES.z, 4);
        }
        const hero = await spamPickpocket(() => findPickNpc(/^hero$/i), 'hero');
        if (hero !== 'none') return hero;
        const pal = await pickpocketOpen(/^paladin$/i, PALADINS, 'paladin');
        if (pal !== 'none') return pal;
    }
    if (level >= 70) {
        const r = await pickpocketOpen(/^paladin$/i, PALADINS, 'paladin');
        if (r !== 'none') return r;
    }
    return pickpocketOpen(/^knight of ardougne$/i, KNIGHTS, 'knight');
}

async function dismissLegendsGuard(): Promise<void> {
    for (let i = 0; i < 16; i++) {
        const dialog = sdk.getDialog();
        if (!dialog?.isOpen) return;
        const opts = dialog.options ?? [];
        const pick =
            opts.find((o) => /ok thanks|it's ok thanks|some other time|no thanks/i.test(o.text)) ||
            opts.find((o) => /click here to continue/i.test(o.text));
        log(`Legends guard dialog -> ${pick?.text ?? 'continue'} (${opts.map((o) => o.text).join(' | ')})`);
        await sdk.sendClickDialog(pick?.index ?? 0);
        await sdk.waitForTicks(1);
    }
}

async function leaveLegendsGuild(): Promise<void> {
    if (!inLegendsGuild() && !sdk.getDialog()?.isOpen) return;
    intent('Leaving the Legends Guild gates — going around, not in');
    await dismissLegendsGuard();
    const inside = pos().z > 3349 && pos().x >= 2718 && pos().x <= 2736;
    if (inside) {
        await walkNear(2728, 3351, 1);
        const gate = sdk.findNearbyLoc(/gate/i, { withOption: /open/i });
        if (gate) await bot.openDoor(gate);
        await sdk.waitForTicks(2);
        await dismissLegendsGuard();
    }
    await sdk.sendWalk(2695, 3375, true);
    await sdk.waitForTicks(8);
    await dismissLegendsGuard();
    await walkNear(2695, 3375, 4);
}

async function leaveKeepLeFaye(): Promise<void> {
    if (!inKeepLeFaye()) return;
    intent('Leaving Keep Le Faye — bats, going west to Seers');
    const door = sdk.findNearbyLoc(/door|gate/i, { withOption: /open/i });
    if (door) await bot.openDoor(door);
    await sdk.sendWalk(2726, 3485, true);
    await sdk.waitForTicks(8);
    await walkNear(2726, 3485, 6);
}

async function walkWaypoints(wps: { x: number; z: number }[]): Promise<void> {
    await stepOffHouseDoor();
    await leaveLegendsGuild();
    await leaveKeepLeFaye();
    const dest = wps[wps.length - 1]!;
    for (const wp of wps) {
        if (inLegendsGuild()) await leaveLegendsGuild();
        if (inKeepLeFaye()) await leaveKeepLeFaye();
        if (distTo(dest.x, dest.z) <= 8) return;
        const remaining = distTo(dest.x, dest.z);
        const via = Math.hypot(wp.x - dest.x, wp.z - dest.z);
        if (via >= remaining - 6) continue;
        await walkNear(wp.x, wp.z, 8);
    }
    if (distTo(dest.x, dest.z) > 6) await walkNear(dest.x, dest.z, 6);
}

function nearestBank() {
    return distTo(CATHERBY_BANK.x, CATHERBY_BANK.z) <= distTo(ARDOUGNE_BANK.x, ARDOUGNE_BANK.z)
        ? CATHERBY_BANK
        : ARDOUGNE_BANK;
}

async function withdrawBankFood(): Promise<{ opened: boolean; count: number }> {
    await stepOffHouseDoor();
    await leaveHouse();
    const bank =
        inArdougne() || distTo(ARDOUGNE_BANK.x, ARDOUGNE_BANK.z) < 120
            ? ARDOUGNE_BANK
            : nearestBank();
    intent(`Walking to ${bank === ARDOUGNE_BANK ? 'Ardougne' : 'Catherby'} bank for fish food`);
    let opened = false;
    for (let attempt = 0; attempt < 4; attempt++) {
        await walkNear(bank.x, bank.z, 3);
        if (distTo(bank.x, bank.z) > 10) {
            log(`Bank walk attempt ${attempt + 1} still ${Math.round(distTo(bank.x, bank.z))}t from ${bank.x},${bank.z}`);
            await stepOffHouseDoor();
            continue;
        }
        const r = await bot.openBank();
        opened = r.success || !!sdk.getState()?.bank?.isOpen;
        if (opened) break;
        log(`Bank open attempt ${attempt + 1} failed: ${r.message}`);
        await sdk.waitForTicks(2);
    }
    if (!opened) {
        log('Could not open bank — staying put, not walking to Catherby');
        return { opened: false, count: foodCount() };
    }
    const toBank = sdk.getInventory().filter((i) => (i.count ?? 0) > 0);
    if (toBank.length) {
        log(`Depositing all inventory before food: ${toBank.map((i) => `${i.count} ${i.name}`).join(', ')}`);
    }
    for (let n = 0; n < 28; n++) {
        const item = sdk.getInventory().find((i) => (i.count ?? 0) > 0);
        if (!item) break;
        const r = await bot.depositItem(item, -1);
        if (!r.success && !r.partial) {
            log(`Deposit ${item.name} failed: ${r.message}`);
            break;
        }
    }
    await sdk.waitForTicks(1);
    await sdk
        .waitForCondition((s) => s.bank?.isOpen === true && (s.bank.items?.length ?? 0) > 0, 5_000)
        .catch(() => {});
    logBank();
    for (const name of THIEVE_FISH) {
        const space = 28 - occupiedSlots() - INV_KEEP_FREE;
        if (space <= 0) break;
        const re = new RegExp(`^${name}$`, 'i');
        const inBank = sdk.findBankItem(re)?.count ?? 0;
        if (inBank <= 0) continue;
        const take = Math.min(inBank, space);
        const r = await bot.withdrawItem(re, take, { asNote: false });
        log(`Bank ${name} x${take} ${r.success ? 'ok' : r.message}`);
    }
    if (foodCount() < RESTOCK_FOOD_BELOW) {
        const space = 28 - occupiedSlots() - INV_KEEP_FREE;
        const inBank = sdk.findBankItem(WINE)?.count ?? 0;
        if (space > 0 && inBank > 0) {
            const take = Math.min(inBank, space, 12);
            const r = await bot.withdrawItem(WINE, take, { asNote: false });
            log(`Bank jug of wine x${take} ${r.success ? 'ok' : r.message}`);
        }
        const sharksHeld = sdk.getInventory().filter((i) => /^shark$/i.test(i.name) && i.count === 1).length;
        const sharkSpace = 28 - occupiedSlots() - INV_KEEP_FREE;
        const sharksBank = sdk.findBankItem(/^shark$/i)?.count ?? 0;
        if (sharksHeld < KEEP_EMERGENCY_SHARKS && sharkSpace > 0 && sharksBank > 0) {
            const take = Math.min(sharksBank, sharkSpace, KEEP_EMERGENCY_SHARKS - sharksHeld);
            const r = await bot.withdrawItem(/^shark$/i, take, { asNote: false });
            log(`Bank emergency shark x${take} ${r.success ? 'ok' : r.message}`);
        }
    }
    await bot.closeBank();
    const fishPack = Object.fromEntries(
        THIEVE_FISH.map((name) => [
            name,
            sdk.getInventory().filter((i) => new RegExp(`^${name}$`, 'i').test(i.name) && i.count === 1).length,
        ])
    );
    const wine = sdk.getInventory().filter((i) => WINE.test(i.name)).length;
    const shark = sdk.getInventory().filter((i) => /^shark$/i.test(i.name) && i.count === 1).length;
    log(
        `Bank pack fish=${JSON.stringify(fishPack)} wine=${wine} shark=${shark} (eat shark only below ${SHARK_EAT_BELOW_HP} hp)`
    );
    return { opened: true, count: foodCount() };
}

async function unnoteFood(): Promise<number> {
    return (await withdrawBankFood()).count;
}

async function ensureFood(): Promise<{ opened: boolean; ok: boolean }> {
    if (hasThieveFood() && notedFood().length === 0) return { opened: true, ok: true };
    await recoverStun();
    if (usesFoodMule(username) && inArdougne()) {
        if (hasUnpackagedLoot() && muleLootGiveList().length === 0) {
            log('ensureFood: unpackaged loot — noting at bank before mule swap');
            await packNotedLootForMule();
        }
        await swapFoodWithMule();
        if (hasThieveFood()) return { opened: true, ok: true };
        if (notedFood().length > 0) {
            const unnoted = await withdrawBankFood();
            if (hasThieveFood()) return { opened: unnoted.opened, ok: true };
        }
    }
    const bank = await withdrawBankFood();
    if (hasThieveFood()) return { opened: bank.opened, ok: true };
    return { opened: bank.opened, ok: hasThieveFood() };
}

function shopHeldCount(): number {
    const pattern = shopItemPattern();
    return sdk.getInventory().filter((i) => pattern.test(i.name)).reduce((n, i) => n + (i.count ?? 0), 0);
}

function shopLine() {
    const pattern = shopItemPattern();
    return sdk.getState()?.shop?.shopItems?.find((i) => pattern.test(i.name)) ?? null;
}

function aemadNpc() {
    return sdk.findNearbyNpc(/^(aemad|kortan)$/i, { reachable: true });
}

function dargaudNpc() {
    return (
        sdk.findNearbyNpc(/^bow and arrow salesman$/i, { reachable: true }) ??
        sdk.findNearbyNpc(/bow and arrow/i, { reachable: true })
    );
}

function inRangingGuild(): boolean {
    const p = pos();
    return p.x >= 2659 && p.x <= 2685 && p.z >= 3415 && p.z <= 3445;
}

async function stepEastFromGuildGate(): Promise<void> {
    const p = pos();
    if (p.x >= 2657 && p.x <= 2661 && p.z >= 3434 && p.z <= 3442) {
        await sdk.sendWalk(2665, 3437, true);
        await sdk.waitForTicks(3);
    }
}

async function enterRangingGuild(): Promise<boolean> {
    if (inRangingGuild()) {
        await stepEastFromGuildGate();
        return true;
    }
    const p = pos();
    if (p.x >= 2657 && p.x <= 2661 && p.z >= 3434 && p.z <= 3442) {
        await stepEastFromGuildGate();
        if (inRangingGuild()) return true;
        await walkNear(DARGAUD.x, DARGAUD.z, 4);
        return inRangingGuild();
    }
    await walkWaypoints(ARDY_TO_RANGING);
    await walkNear(RANGING_GUILD_DOOR.x, RANGING_GUILD_DOOR.z, 2);
    const door =
        sdk.findNearbyLoc(/^guild door$/i, { withOption: /open/i }) ?? sdk.findNearbyLoc(/^guild door$/i);
    if (door) await bot.openDoor(door);
    else await bot.openDoor();
    await walkNear(2665, 3437, 2);
    await sdk.waitForCondition(() => inRangingGuild(), 8_000).catch(() => {});
    return inRangingGuild();
}

async function leaveRangingGuild(): Promise<void> {
    if (!inRangingGuild() && !(pos().x >= 2657 && pos().x <= 2661 && pos().z >= 3434 && pos().z <= 3442)) {
        return;
    }
    await stepEastFromGuildGate();
    await walkNear(DARGAUD.x, DARGAUD.z, 4);
    await walkNear(RANGING_GUILD_DOOR.x + 2, RANGING_GUILD_DOOR.z - 2, 2);
    const door =
        sdk.findNearbyLoc(/^guild door$/i, { withOption: /open/i }) ?? sdk.findNearbyLoc(/^guild door$/i);
    if (door) await bot.openDoor(door);
    await sdk.waitForCondition(() => !inRangingGuild(), 8_000).catch(() => {});
}

async function openAemadShop(): Promise<boolean> {
    await bot.dismissBlockingUI();
    if (sdk.getState()?.bank?.isOpen) await bot.closeBank();
    if (sdk.getState()?.shop?.isOpen) await bot.closeShop();
    let npc = aemadNpc();
    if (!npc || (npc.distance ?? 99) > 10) {
        await walkNear(AEMAD_SHOP.x, AEMAD_SHOP.z, 4);
        npc = aemadNpc();
    }
    if (!npc) {
        session.noteFailure('aemad_shop', 'Aemad/Kortan not visible');
        return false;
    }
    const opened = await bot.openShop(npc);
    if (!opened.success && !sdk.getState()?.shop?.isOpen) {
        session.noteFailure('aemad_shop', opened.message || 'shop open failed');
        return false;
    }
    log(`Opened ${sdk.getState()?.shop?.title ?? 'shop'} via ${npc.name}`);
    return true;
}

async function openDargaudShop(): Promise<boolean> {
    await bot.dismissBlockingUI();
    if (sdk.getState()?.bank?.isOpen) await bot.closeBank();
    if (sdk.getState()?.shop?.isOpen) await bot.closeShop();
    if (!(await enterRangingGuild())) {
        session.noteFailure('dargaud_shop', 'Could not enter ranging guild');
        return false;
    }
    let npc = dargaudNpc();
    if (!npc || (npc.distance ?? 99) > 10) {
        await walkNear(DARGAUD.x, DARGAUD.z, 3);
        npc = dargaudNpc();
    }
    if (!npc) {
        session.noteFailure('dargaud_shop', 'Bow and Arrow salesman not visible');
        return false;
    }
    const opened = await bot.openShop(npc);
    if (!opened.success && !sdk.getState()?.shop?.isOpen) {
        session.noteFailure('dargaud_shop', opened.message || 'shop open failed');
        return false;
    }
    return true;
}

async function depositShopItems(): Promise<void> {
    if (inRangingGuild()) await leaveRangingGuild();
    const pattern = shopItemPattern();
    const held = shopHeldCount();
    if (held <= 0 && coinCount() < 1) return;
    await walkNear(ARDOUGNE_BANK.x, ARDOUGNE_BANK.z, 3);
    const opened = await bot.openBank();
    if (!opened.success && !sdk.getState()?.bank?.isOpen) return;
    if (held > 0) await bot.depositItem(pattern, -1);
    if (sdk.findInventoryItem(/^coins$/i)) await bot.depositItem(/^coins$/i, -1);
    await sdk.waitForTicks(1);
    await sdk
        .waitForCondition((s) => s.bank?.isOpen === true && (s.bank.items?.length ?? 0) > 0, 5_000)
        .catch(() => {});
    logBank();
    session.noteProgress('bank', 'shop deposit');
    await bot.closeBank();
}

async function buyShelfStock(): Promise<void> {
    const line = shopLine();
    const stockAtOpen = line?.count ?? 0;
    const slot = line?.slot;
    const before = shopHeldCount();
    if (slot == null || stockAtOpen <= 0) return;
    const clicks = Math.ceil(stockAtOpen / 10);
    for (let n = 0; n < clicks && coinCount() >= 1; n++) {
        const r = await sdk.sendShopBuy(slot, 10);
        if (!r.success) break;
    }
    await sdk.waitForCondition(() => (shopLine()?.count ?? 0) <= 0 || coinCount() < 1, 15_000).catch(() => {});
    log(`Bought ${shopHeldCount() - before} (shop had ${stockAtOpen}, holding ${shopHeldCount()}, ${coinCount()}gp)`);
}

async function buyAndBankShopStock(): Promise<void> {
    if (!SHOP_ARROWS) return;
    await enterPhase('shop');
    await stepOffHouseDoor();
    await leaveHouse();
    const tips = buyRuneTips();
    const pattern = shopItemPattern();
    const wantGp = tips ? TIPS_COIN_WITHDRAW : BRONZE_COIN_WITHDRAW;
    if (coinCount() < wantGp) {
        intent(tips ? 'Withdrawing coins for rune arrowtips' : 'Withdrawing coins to buy bronze arrows');
        await walkNear(ARDOUGNE_BANK.x, ARDOUGNE_BANK.z, 3);
        const opened = await bot.openBank();
        if (opened.success || sdk.getState()?.bank?.isOpen) {
            if (occupiedSlots() >= 28 && !sdk.findInventoryItem(/^coins$/i)) {
                const dump = sdk.getInventory().find((i) => !FOOD.test(i.name) && !/^coins$/i.test(i.name));
                if (dump) await bot.depositItem(dump, -1);
            }
            const need = Math.max(1, wantGp - coinCount());
            await bot.withdrawItem(/^coins$/i, need);
            await bot.closeBank();
        }
        if (coinCount() < 1) return;
    }
    if (occupiedSlots() >= 27 && shopHeldCount() === 0) {
        await walkNear(ARDOUGNE_BANK.x, ARDOUGNE_BANK.z, 3);
        const opened = await bot.openBank();
        if (opened.success || sdk.getState()?.bank?.isOpen) {
            const dump = sdk.getInventory().find(
                (i) => !FOOD.test(i.name) && !/^coins$/i.test(i.name) && !pattern.test(i.name)
            );
            if (dump) await bot.depositItem(dump, -1);
            await bot.closeBank();
        }
    }
    if (tips) {
        intent('Buying rune arrowtips at the ranging guild');
        if (!(await openDargaudShop())) return;
    } else {
        intent('Spam buying bronze arrows at Aemad');
        if (!(await openAemadShop())) return;
    }
    await buyShelfStock();
    await bot.closeShop();
    if (tips) await leaveRangingGuild();
    if (shopHeldCount() > 0 || coinCount() > 0) await depositShopItems();
}

async function logoutOutOfFood(): Promise<void> {
    await bot.dismissBlockingUI();
    if (sdk.getState()?.shop?.isOpen) await bot.closeShop();
    if (sdk.getState()?.bank?.isOpen) await bot.closeBank();
    await sdk.sendSetTab(LOGOUT_TAB);
    await sdk.waitForTicks(1);
    await sdk.sendClickComponent(LOGOUT_BUTTON);
    await sdk.waitForCondition((s) => s.inGame === false, 15_000).catch(() => {});
    session.stop('out_of_food', 'no food in bank');
}

async function clickBoatDialog(): Promise<void> {
    let closedStreak = 0;
    for (let i = 0; i < 24; i++) {
        const dialog = sdk.getDialog();
        if (!dialog?.isOpen) {
            closedStreak++;
            if (closedStreak >= 4) return;
            await new Promise((r) => setTimeout(r, 250));
            continue;
        }
        closedStreak = 0;
        if (dialog.isWaiting) {
            await sdk.waitForTicks(1);
            continue;
        }
        const opts = dialog.options ?? [];
        const pick =
            opts.find((o) => /search away|nothing to hide/i.test(o.text)) ||
            opts.find((o) => /^ok\.?$/i.test(o.text)) ||
            opts.find((o) => /yes please|pay 30|30 coins|ardougne/i.test(o.text)) ||
            opts.find((o) => /can i journey/i.test(o.text)) ||
            opts.find((o) => /yes/i.test(o.text) && !/crandor|bother|miss|customs/i.test(o.text));
        log(`Boat dialog -> ${pick?.text ?? 'continue'} (${opts.map((o) => o.text).join(' | ')})`);
        await sdk.sendClickDialog(pick?.index ?? 0);
        await sdk.waitForTicks(1);
    }
}

async function crossGangplank(): Promise<void> {
    const plank = sdk.findNearbyLoc(/gangplank/i);
    if (!plank) return;
    const opt = plank.optionsWithIndex.find((o) => /cross|board/i.test(o.text));
    log('Crossing gangplank');
    if (opt) await sdk.sendInteractLoc(plank.x, plank.z, plank.id, opt.opIndex);
    else await bot.interactLoc(plank, /cross|board/i);
    await sdk.waitForTicks(5);
}

async function leaveDockedShip(): Promise<void> {
    if (!onDockedShip()) return;
    log(`On a docked ship at (${pos().x},${pos().z}) lv${pos().level} — getting off`);
    for (let i = 0; i < 6 && onDockedShip(); i++) {
        await crossGangplank();
        await sdk.waitForTicks(2);
    }
}

async function pickpocketMen(): Promise<void> {
    await eatIfNeeded();
    // Keep going on low HP — Lumbridge respawn is next to the men. Do not bank.
    await clickYesOrContinue();
    if (onAlKharidToll() || (pos().x >= 3264 && pos().x <= 3273 && pos().z >= 3220 && pos().z <= 3232)) {
        await stepOffTollWest();
    }
    if (distTo(LUMBRIDGE_MEN.x, LUMBRIDGE_MEN.z) > 8) {
        intent('Walking to Lumbridge men');
        await walkNear(LUMBRIDGE_MEN.x, LUMBRIDGE_MEN.z, 4);
    }
    await bot.dismissBlockingUI();
    const npc =
        sdk.findNearbyNpc(/^man$/i, { reachable: true }) ??
        sdk.findNearbyNpc(/^woman$/i, { reachable: true }) ??
        sdk.findNearbyNpc(/^(man|woman)$/i);
    if (!npc) {
        await walkNear(LUMBRIDGE_MEN.x, LUMBRIDGE_MEN.z, 3);
        await sdk.waitForTicks(2);
        return;
    }
    const result = await bot.pickpocketNpc(npc);
    if (result.reason === 'stunned') await sdk.waitForTicks(6);
}

function kebabCount(): number {
    return sdk.getInventory().filter((i) => /^kebab$/i.test(i.name)).reduce((n, i) => n + i.count, 0);
}

function inAlKharid(): boolean {
    const p = pos();
    if (p.z >= 6400) return false;
    // South of the north toll is the city. x=3268 is the west wall / gate column.
    if (p.x >= 3268 && p.x < 3360 && p.z >= 3130 && p.z <= 3226) return true;
    if (p.x >= 3274 && p.x < 3360 && p.z >= 3227 && p.z <= 3235) return true;
    return false;
}

function onAlKharidToll(): boolean {
    const p = pos();
    return p.x >= 3266 && p.x <= 3273 && p.z >= 3224 && p.z <= 3232;
}

function onGateLine(x = pos().x, z = pos().z): boolean {
    return x >= 3266 && x <= 3274 && z >= 3225 && z <= 3231;
}

async function clickYesOrContinue(payToll = true): Promise<void> {
    for (let i = 0; i < 20; i++) {
        const dialog = sdk.getDialog();
        if (!dialog?.isOpen) return;
        const opts = dialog.options ?? [];
        const yesOk = opts.find((o) => /yes,?\s*ok/i.test(o.text));
        const noThanks = opts.find((o) => /no thank/i.test(o.text));
        const yes = opts.find((o) => /\byes\b/i.test(o.text));
        const cont = opts.find((o) => /continue/i.test(o.text));
        if (yesOk && noThanks) {
            await sdk.sendClickDialog(payToll && coinCount() >= 10 ? yesOk.index : noThanks.index);
        } else if (yesOk) {
            await sdk.sendClickDialog(payToll && coinCount() >= 10 ? yesOk.index : 0);
        } else if (cont) {
            await sdk.clickDialogByText(/continue/i);
            if (sdk.getDialog()?.isOpen) await sdk.sendClickDialog(0);
            if (sdk.getDialog()?.isOpen) await sdk.sendClickDialog(cont.index);
        } else if (yes) {
            await sdk.sendClickDialog(yes.index);
        } else {
            await sdk.sendClickDialog(0);
            if (opts[0] && sdk.getDialog()?.isOpen) await sdk.sendClickDialog(opts[0].index);
        }
        await sdk.waitForTicks(1);
    }
}

async function stepOffTollWest(opts?: { skipBypass?: boolean }): Promise<void> {
    if (!opts?.skipBypass && (await maybeBypassAlKharidWestExit())) return;
    if (clearedAlKharidWest()) {
        alkharidWestExitSince = 0;
        return;
    }
    intent('Leaving the toll westward — not walking the gate line');
    await clickYesOrContinue(false);
    await sdk.sendWalk(LUMBY_CHICKENS.x, LUMBY_CHICKENS.z, true);
    await sdk.waitForTicks(6);
}

async function dropStarterJunk(force = false): Promise<void> {
    const junk =
        /^(tinderbox|bucket|pot|small fishing net|bronze pickaxe|shortbow|bronze arrow|air rune|mind rune|water rune|earth rune|body rune|wooden shield|bronze axe|bronze dagger|bronze sword|shrimps|bread)$/i;
    for (let i = 0; i < 28 && (force || occupiedSlots() > 20); i++) {
        const item = sdk.getInventory().find((it) => junk.test(it.name));
        if (!item) break;
        await sdk.sendDropItem(item.slot);
        await sdk.waitForTicks(1);
    }
}

function kebabStandTile(): { x: number; z: number } {
    const n = Number.parseInt(username.replace(/\D/g, ''), 10) || 0;
    const offsets = [
        { x: 0, z: 0 },
        { x: 1, z: 0 },
        { x: -1, z: 0 },
        { x: 0, z: 1 },
        { x: 0, z: -1 },
        { x: 1, z: 1 },
        { x: -1, z: 1 },
        { x: 1, z: -1 }
    ];
    const o = offsets[n % offsets.length]!;
    return { x: KEBAB_SELLER.x + o.x, z: KEBAB_SELLER.z + o.z };
}

async function freeSlotsForKebabs(need: number): Promise<void> {
    for (let pass = 0; pass < 32 && 28 - occupiedSlots() < need; pass++) {
        for (const re of [/shield|defender/i, /bow|arrow/i, /axe|sword|dagger|scimitar|mace|spear/i]) {
            const worn = bot.findEquippedItem(re);
            if (worn) await bot.unequipItem(worn);
        }
        await dropStarterJunk(true);
        const drop = sdk.getInventory().find(
            (i) => !/^coins$/i.test(i.name) && !/^kebab$/i.test(i.name) && !FOOD.test(i.name)
        );
        if (!drop) break;
        await sdk.sendDropItem(drop.slot);
        await sdk.waitForTicks(1);
    }
}

async function buyKebabDialog(): Promise<boolean> {
    for (let i = 0; i < 12; i++) {
        const dialog = sdk.getDialog();
        if (!dialog?.isOpen) return false;
        if (dialog.isWaiting) {
            await sdk.waitForTicks(1);
            continue;
        }
        const buy = dialog.options.find((o) => /yes|kebab|buy|please/i.test(o.text));
        if (buy) {
            await sdk.sendClickDialog(buy.index);
            await sdk.waitForTicks(2);
            return true;
        }
        const cont = dialog.options.find((o) => /continue/i.test(o.text));
        if (cont) {
            await sdk.sendClickDialog(cont.index);
            await sdk.waitForTicks(1);
            continue;
        }
        if (dialog.options[0]) {
            await sdk.sendClickDialog(dialog.options[0].index);
            await sdk.waitForTicks(1);
            continue;
        }
        return false;
    }
    return false;
}

async function buyTenKebabs(): Promise<void> {
    if (Date.now() < kebabBuyBlockedUntil) return;

    const target = Math.min(5, kebabCount() + Math.max(0, 28 - occupiedSlots()));
    if (kebabCount() >= target || coinCount() < 1) return;

    await freeSlotsForKebabs(Math.min(5, target - kebabCount()));
    const want = Math.min(5, kebabCount() + Math.max(0, 28 - occupiedSlots()));
    if (kebabCount() >= want) {
        log(`No room for kebabs (${occupiedSlots()}/28 slots used)`);
        return;
    }

    intent(`Buying kebabs (${kebabCount()} → ${want})`);
    const stand = kebabStandTile();
    await walkNear(stand.x, stand.z, 2);

    const seller =
        sdk.findNearbyNpc(/kebab/i, { reachable: true }) ?? sdk.findNearbyNpc(/kebab/i);
    if (seller?.inCombat) {
        log('Kebab seller in combat — skipping buy for 90s');
        kebabBuyBlockedUntil = Date.now() + 90_000;
        return;
    }

    let stale = 0;
    const deadline = Date.now() + 20_000;
    while (kebabCount() < want && coinCount() >= 1 && Date.now() < deadline && stale < 5) {
        await bot.dismissBlockingUI();
        const npc =
            sdk.findNearbyNpc(/kebab/i, { reachable: true }) ?? sdk.findNearbyNpc(/kebab/i);
        if (!npc) {
            log('Kebab seller not visible');
            stale++;
            await sdk.waitForTicks(4);
            continue;
        }
        if (npc.inCombat) {
            log('Kebab seller in combat — skipping buy for 90s');
            kebabBuyBlockedUntil = Date.now() + 90_000;
            return;
        }

        const before = kebabCount();
        const talk = await bot.talkTo(npc);
        if (!talk.success) {
            log(`Kebab talk failed: ${talk.message}`);
            stale++;
            await sdk.waitForTicks(2);
            continue;
        }
        await sdk.waitForCondition((s) => s.dialog?.isOpen === true, 4_000).catch(() => {});
        if (!(await buyKebabDialog())) await clickYesOrContinue(false);
        await bot.dismissBlockingUI();

        if (kebabCount() > before) stale = 0;
        else stale++;
        if (28 - occupiedSlots() <= 0) await freeSlotsForKebabs(1);
    }
    if (kebabCount() === 0) kebabBuyBlockedUntil = Date.now() + 90_000;
    log(`Kebab restock: ${kebabCount()} held, ${coinCount()} gp`);
}

async function payAlKharidToll(): Promise<void> {
    await clickYesOrContinue(true);
    const gate = sdk.getNearbyLocs().find((l) => /gate/i.test(l.name) && l.x >= 3265 && l.x <= 3274 && l.z >= 3225 && l.z <= 3231);
    if (!gate) return;
    await sdk.sendInteractLoc(gate.x, gate.z, gate.id, 1);
    await sdk.waitForTicks(2);
    await clickYesOrContinue(true);
}

let alkharidGateSince = 0;
let alkharidWestExitSince = 0;
let kebabBuyBlockedUntil = 0;

function clearedAlKharidWest(): boolean {
    const p = pos();
    return p.x < 3264 && !inAlKharid() && !onGateLine();
}

/** True while attempting Al Kharid → Lumbridge/west through the toll gate. */
function trackingAlKharidWestExit(): boolean {
    if (clearedAlKharidWest()) {
        alkharidWestExitSince = 0;
        return false;
    }
    if (inAlKharid() && distTo(ALKHARID_GATE.x, ALKHARID_GATE.z) > 14) {
        alkharidWestExitSince = 0;
        return false;
    }
    // Inner city / east side of the gate only — not Lumbridge-side toll attempts.
    return inAlKharid() || (onGateLine() && pos().x >= 3268);
}

async function maybeBypassAlKharidWestExit(): Promise<boolean> {
    if (!trackingAlKharidWestExit()) return false;
    if (!alkharidWestExitSince) alkharidWestExitSince = Date.now();
    if (Date.now() - alkharidWestExitSince < ALKHARID_GATE_GIVEUP_MS) return false;
    alkharidWestExitSince = 0;
    await walkAroundAlKharidGateWest();
    return true;
}

async function walkAroundAlKharidGate(): Promise<void> {
    intent('Al Kharid gate stuck >1 min — walking north around through the mine');
    log(`Bypassing Al Kharid gate (enter) from ${pos().x},${pos().z}`);
    await clickYesOrContinue(false);
    if (onAlKharidToll() || onGateLine()) await stepOffTollWest({ skipBypass: true });
    for (const wp of ALKHARID_NORTH_BYPASS) {
        if (inAlKharid() && !onGateLine()) {
            alkharidGateSince = 0;
            return;
        }
        await walkNear(wp.x, wp.z, 8);
    }
    alkharidGateSince = 0;
}

async function walkAroundAlKharidGateWest(): Promise<void> {
    intent('Al Kharid → Lumbridge stuck >1 min — walking north around the gate');
    log(`Bypassing Al Kharid gate (west exit) from ${pos().x},${pos().z}`);
    await clickYesOrContinue(false);
    if (onGateLine() && inAlKharid()) {
        await sdk.sendWalk(3295, 3240, true);
        await sdk.waitForTicks(4);
    }
    for (const wp of [...ALKHARID_NORTH_BYPASS].reverse()) {
        if (clearedAlKharidWest()) {
            alkharidWestExitSince = 0;
            return;
        }
        await walkNear(wp.x, wp.z, 8);
    }
    await walkNear(3225, 3295, 8);
    alkharidWestExitSince = 0;
}

async function crossAlKharidGate(): Promise<void> {
    if (inAlKharid() && !onGateLine()) {
        alkharidGateSince = 0;
        return;
    }
    if (!alkharidGateSince) alkharidGateSince = Date.now();
    if (Date.now() - alkharidGateSince >= ALKHARID_GATE_GIVEUP_MS) {
        await walkAroundAlKharidGate();
        return;
    }
    await clickYesOrContinue(true);
    if (coinCount() < 10) {
        await stepOffTollWest();
        return;
    }
    intent('Paying the toll, then walking south into Al Kharid');
    if (pos().x <= 3268) {
        await sdk.sendWalk(3261, 3220, true);
        await sdk.waitForTicks(3);
        await payAlKharidToll();
    }
    await clickYesOrContinue(true);
    await sdk.sendWalk(KEBAB_SELLER.x, KEBAB_SELLER.z, true);
    await sdk.waitForTicks(8);
}

async function leaveAlKharid(): Promise<void> {
    if (await maybeBypassAlKharidWestExit()) return;
    if (pos().x <= 3268 && !inAlKharid()) {
        alkharidWestExitSince = 0;
        await stepOffTollWest();
        return;
    }
    if (!inAlKharid() && !onAlKharidToll()) {
        alkharidWestExitSince = 0;
        return;
    }
    intent('Paying the toll once, then walking west to chickens');
    await clickYesOrContinue(true);
    if (pos().z >= 3225) {
        await sdk.sendWalk(3276, 3220, true);
        await sdk.waitForTicks(4);
    }
    await payAlKharidToll();
    await clickYesOrContinue(true);
    await sdk.sendWalk(LUMBY_CHICKENS.x, LUMBY_CHICKENS.z, true);
    await sdk.waitForTicks(8);
}

/** Pay toll and walk west/north toward Edgeville — not Lumbridge chickens. */
async function exitAlKharidWest(): Promise<void> {
    if (await maybeBypassAlKharidWestExit()) return;
    if (pos().x <= 3268 && !inAlKharid()) {
        alkharidWestExitSince = 0;
        if (onAlKharidToll() || onGateLine()) await stepOffTollWest();
        return;
    }
    if (!inAlKharid() && !onAlKharidToll()) {
        alkharidWestExitSince = 0;
        return;
    }

    if (distTo(ALKHARID_GATE.x, ALKHARID_GATE.z) > 6) {
        intent('Walking north to Al Kharid toll gate');
        await walkNear(ALKHARID_GATE.x, ALKHARID_GATE.z, 4);
        return;
    }

    intent('Paying toll, walking west toward Edgeville / wildy lever');
    await clickYesOrContinue(true);
    if (pos().z >= 3225) {
        await sdk.sendWalk(3276, 3220, true);
        await sdk.waitForTicks(4);
    }
    await payAlKharidToll();
    await clickYesOrContinue(true);
    await sdk.sendWalk(3215, 3255, true);
    await sdk.waitForTicks(8);
}

async function trainWarriors(): Promise<void> {
    await eatIfNeeded();
    // Kebabs, not Catherby bank. Buy food before bailing on low HP.
    await clickYesOrContinue();
    if (onAlKharidToll() && inAlKharid()) {
        intent('On the inner side of the toll — walking south into Al Kharid');
        for (let i = 0; i < 10 && onAlKharidToll(); i++) {
            await clickYesOrContinue();
            const stand = kebabStandTile();
            await sdk.sendWalk(stand.x, stand.z, true);
            await sdk.waitForTicks(2);
        }
        return;
    }
    if (onAlKharidToll() && !inAlKharid()) {
        if (coinCount() >= 10) await crossAlKharidGate();
        else await stepOffTollWest();
        return;
    }
    if (!inAlKharid()) {
        if (coinCount() < 10) {
            await pickpocketMen();
            return;
        }
        await crossAlKharidGate();
        if (!inAlKharid()) return;
    }
    if (kebabCount() < 2 && Date.now() >= kebabBuyBlockedUntil) await buyTenKebabs();
    if (distTo(ALKHARID_WARRIORS.x, ALKHARID_WARRIORS.z) > 8) {
        intent('Walking to Al Kharid warriors');
        await walkNear(ALKHARID_WARRIORS.x, ALKHARID_WARRIORS.z, 4);
    }
    await bot.dismissBlockingUI();
    const npc =
        sdk.findNearbyNpc(/^al-kharid warrior$/i, { reachable: true }) ??
        sdk.findNearbyNpc(/^al-kharid warrior$/i);
    if (!npc) {
        await walkNear(ALKHARID_WARRIORS.x, ALKHARID_WARRIORS.z, 3);
        return;
    }
    const result = await bot.pickpocketNpc(npc);
    if (result.reason === 'stunned') {
        await eatIfNeeded();
        await sdk.waitForTicks(6);
    }
}

async function openNearbyFarmGate(): Promise<void> {
    const gate = (sdk.getNearbyLocs() ?? []).find(
        (l) =>
            /gate|door/i.test(l.name) &&
            l.optionsWithIndex.some((o) => /^open$/i.test(o.text)) &&
            (l.distance ?? 99) <= 4 &&
            !(l.x >= 3265 && l.x <= 3274 && l.z >= 3225 && l.z <= 3231)
    );
    if (gate) await bot.openDoor(gate);
}

async function ensureUnarmedPunch(): Promise<void> {
    const weapon = bot.findEquippedItem(/sword|dagger|scimitar|axe|bow|mace|spear|claws|whip/i);
    if (weapon) await bot.unequipItem(weapon);
    const shield = bot.findEquippedItem(/shield|defender/i);
    if (shield) await bot.unequipItem(shield);
    const cs = sdk.getState()?.combatStyle;
    if (!cs) return;
    const punch =
        cs.styles.find((s) => /^punch$/i.test(s.name)) ??
        cs.styles.find((s) => s.type === 'Accurate' && s.trainsSkills.includes('Attack'));
    if (punch && cs.currentStyle !== punch.index) await sdk.sendSetCombatStyle(punch.index);
}

function findChicken() {
    const hens = (sdk.getNearbyNpcs() ?? []).filter(
        (n) => /^chicken$/i.test(n.name) && n.optionsWithIndex.some((o) => /^attack$/i.test(o.text))
    );
    const byDist = (a: (typeof hens)[0], b: (typeof hens)[0]) => (a.distance ?? 99) - (b.distance ?? 99);
    const free = hens.filter((n) => !n.inCombat && n.reachable !== false).sort(byDist);
    if (free[0]) return free[0];
    const reachable = hens.filter((n) => n.reachable !== false).sort(byDist);
    return reachable[0] ?? hens.sort(byDist)[0] ?? null;
}

async function buryBones(): Promise<void> {
    for (let i = 0; i < 12; i++) {
        const bones = sdk.findInventoryItem(/^bones$/i);
        if (!bones) break;
        const bury = bones.optionsWithIndex.find((o) => /bury/i.test(o.text));
        if (!bury) break;
        const slot = bones.slot;
        await sdk.sendUseItem(slot, bury.opIndex);
        await sdk.waitForCondition(
            (s) => !s.inventory.some((it) => it.slot === slot && /^bones$/i.test(it.name)),
            3_000
        ).catch(() => {});
    }
}

async function lootFeathersAndBones(): Promise<void> {
    await buryBones();
    await sdk.scanGroundItems(12).catch(() => {});
    for (let i = 0; i < 16; i++) {
        const items = sdk.getGroundItems() ?? [];
        const nearby = items
            .filter((g) => (g.distance ?? 99) <= 8)
            .sort((a, b) => (a.distance ?? 99) - (b.distance ?? 99));
        const feathers = nearby.find((g) => /feather/i.test(g.name) && g.reachable !== false) ?? nearby.find((g) => /feather/i.test(g.name));
        const bones = nearby.find((g) => /^bones$/i.test(g.name) && g.reachable !== false) ?? nearby.find((g) => /^bones$/i.test(g.name));
        const item = feathers ?? bones;
        if (!item) break;
        const alreadyHave = sdk.findInventoryItem(new RegExp(`^${item.name}$`, 'i'));
        if (occupiedSlots() >= 27 && !alreadyHave) {
            await buryBones();
            if (occupiedSlots() >= 27) break;
        }
        const r = await bot.pickupItem(item);
        if (!r.success) {
            if (item.reachable === false) break;
            continue;
        }
        if (/^bones$/i.test(item.name)) await buryBones();
    }
    await buryBones();
}

function chickenSpot() {
    if (inKandarin() || inArdougne()) return RANGING_CHICKENS;
    return LUMBY_CHICKENS;
}

async function punchChickens(): Promise<void> {
    await clickYesOrContinue(false);
    await eatIfNeeded();
    if (pos().maxHp >= TARGET_HP) return;
    if (inWilderness()) return;

    if (inHouse(pos().x, pos().z) || onHouseDoorTile()) await leaveHouse();
    if (inLegendsGuild()) await leaveLegendsGuild();
    if (inKeepLeFaye()) await leaveKeepLeFaye();

    const spot = chickenSpot();
    if (spot === LUMBY_CHICKENS) {
        if (inAlKharid() || (onAlKharidToll() && pos().x >= 3269)) {
            await leaveAlKharid();
            return;
        }
        if (onAlKharidToll()) {
            await clickYesOrContinue(false);
            await sdk.sendWalk(LUMBY_CHICKENS.x, LUMBY_CHICKENS.z, true);
            await sdk.waitForTicks(4);
            return;
        }
    }

    await ensureUnarmedPunch();
    await lootFeathersAndBones();

    if (pos().inCombat) {
        intent(`Punching chicken — HP ${pos().maxHp}/${TARGET_HP}`);
        await sdk.waitForTicks(2);
        await lootFeathersAndBones();
        return;
    }

    if (distTo(spot.x, spot.z) > 10) {
        const where = spot === RANGING_CHICKENS ? 'ranging guild' : 'Lumbridge';
        intent(`Walking to ${where} chickens (HP ${pos().maxHp} → ${TARGET_HP})`);
        await walkNear(spot.x, spot.z, 4);
        await openNearbyFarmGate();
        return;
    }

    await openNearbyFarmGate();
    const hen = findChicken();
    if (!hen) {
        intent('No chicken — looting feathers and bones');
        await lootFeathersAndBones();
        await sdk.sendWalk(spot.x, spot.z, true);
        await sdk.waitForTicks(2);
        return;
    }

    const attackOpt = hen.optionsWithIndex.find((o) => /^attack$/i.test(o.text));
    if (!attackOpt) return;
    const hx = hen.tileX ?? hen.x;
    const hz = hen.tileZ ?? hen.z;
    if ((hen.distance ?? 99) > 1) {
        await sdk.sendWalk(hx, hz, true);
        await sdk.waitForTicks(1);
    }
    intent(`Attacking chicken @ ${hx},${hz} d=${hen.distance} — HP ${pos().maxHp}/${TARGET_HP}`);
    await sdk.sendInteractNpc(hen.index, attackOpt.opIndex);
    await sdk.waitForCondition((s) => !!s.player?.combat?.inCombat, 4_000).catch(() => {});
    await lootFeathersAndBones();
}

async function portSarimToMusa(): Promise<void> {
    if (onKaramja() || inArdougne()) return;
    intent('Port Sarim sailor → Musa Point (30gp)');
    await walkNear(PORT_SARIM_DOCK.x, PORT_SARIM_DOCK.z, 4);
    const sailor =
        sdk.findNearbyNpc(/^captain tobias$/i) ??
        sdk.findNearbyNpc(/^seaman /i) ??
        sdk.findNearbyNpc(/sailor|seaman|captain tobias/i);
    if (!sailor) {
        log('No sailor at Port Sarim');
        return;
    }
    const startX = pos().x;
    await bot.talkTo(sailor);
    await clickBoatDialog();
    for (let i = 0; i < 40 && !onKaramja(); i++) {
        await crossGangplank();
        if (sdk.getDialog()?.isOpen) await clickBoatDialog();
        if (Math.abs(pos().x - startX) > 40) break;
        await sdk.waitForTicks(2);
    }
    log(`After Port Sarim boat: (${pos().x},${pos().z}) gp=${coinCount()}`);
}

async function musaToBrimhaven(): Promise<void> {
    if (!onMusa()) return;
    log('Walking Musa Point → Brimhaven (skip Musa customs, skip Grubor house)');
    for (const wp of MUSA_TO_BRIMHAVEN) {
        if (!onMusa()) break;
        await walkNear(wp.x, wp.z, 8);
    }
    await leaveGruborHouse();
    await walkNear(BRIMHAVEN_CUSTOMS.x, BRIMHAVEN_CUSTOMS.z, 5);
}

/** Heroes' Quest hideout (Grubor/Trobert) at ~2811,3170 — walkTo loves that locked door. */
async function leaveGruborHouse(): Promise<void> {
    const p = pos();
    if (p.x < 2792 || p.x > 2830 || p.z > 3194) return;
    const dialog = sdk.getDialog();
    if (dialog?.isOpen) {
        await sdk.sendClickDialog(dialog.options[0]?.index ?? 0);
        await sdk.waitForTicks(1);
    }
    log(`Leaving Grubor house (${p.x},${p.z}) — going north around it`);
    await sdk.sendWalk(2806, 3196, true);
    await sdk.waitForTicks(5);
    await walkNear(2798, 3208, 4);
}

async function brimhavenToArdougne(): Promise<void> {
    if (inArdougne()) return;
    if (!onKaramja() || onMusa()) return;
    await leaveDockedShip();
    await leaveGruborHouse();
    intent('Brimhaven customs → Ardougne (30gp)');
    await walkNear(BRIMHAVEN_CUSTOMS.x, BRIMHAVEN_CUSTOMS.z, 4);
    const customs =
        sdk.findNearbyNpc(/^customs officer$/i) ?? sdk.findNearbyNpc(/customs officer/i);
    if (!customs) {
        log('No Customs officer at Brimhaven');
        return;
    }
    await bot.talkTo(customs);
    await clickBoatDialog();
    for (let i = 0; i < 20 && !inArdougne(); i++) {
        if (sdk.getDialog()?.isOpen) await clickBoatDialog();
        else if (onDockedShip()) await leaveDockedShip();
        await sdk.waitForTicks(2);
    }
    log(`After Brimhaven boat: (${pos().x},${pos().z}) gp=${coinCount()}`);
}

async function pickupLumbyKnife(): Promise<boolean> {
    if (sdk.findInventoryItem(/^knife$/i)) return true;
    intent('Picking up the Lumbridge knife spawn to slash the keep web');
    await walkNear(LUMBY_KNIFE.x, LUMBY_KNIFE.z, 2);
    for (let i = 0; i < 24; i++) {
        await sdk.scanGroundItems(8).catch(() => {});
        const knife =
            sdk.findGroundItem(/^knife$/i) ??
            (sdk.getGroundItems() ?? []).find((g) => /^knife$/i.test(g.name) && (g.distance ?? 99) <= 6);
        if (knife) {
            const r = await bot.pickupItem(knife);
            if (r.success || sdk.findInventoryItem(/^knife$/i)) return true;
        }
        await sdk.waitForTicks(2);
    }
    return !!sdk.findInventoryItem(/^knife$/i);
}

async function ensureSlashWeapon(): Promise<boolean> {
    if (slashItem()) return true;
    const equipped = bot.findEquippedItem(SLASH);
    if (equipped) return true;
    const inv = sdk.findInventoryItem(SLASH);
    if (inv) {
        if (/^knife$/i.test(inv.name)) return true;
        await bot.equipItem(inv);
        return !!bot.findEquippedItem(SLASH);
    }

    intent('Need a slash weapon for the wildy web — checking Draynor bank');
    await walkNear(DRAYNOR_BANK.x, DRAYNOR_BANK.z, 5);
    const opened = await bot.openBank();
    if (opened.success) {
        await bot.withdrawItem(/bronze (axe|sword|dagger)$/i, 1).catch(() => {});
        await bot.closeBank();
    }
    const fromBank = sdk.findInventoryItem(SLASH);
    if (fromBank) {
        await bot.equipItem(fromBank);
        if (bot.findEquippedItem(SLASH)) return true;
    }

    if (coinCount() < 16) {
        intent(`Need 16gp for a bronze axe (${coinCount()} gp)`);
        await pickpocketMen();
        return false;
    }
    intent("Buying a bronze axe from Bob's");
    await walkNear(BOBS_AXES.x, BOBS_AXES.z, 4);
    const shop = await bot.openShop(/bob/i);
    if (!shop.success && !sdk.getState()?.shop?.isOpen) {
        log(`Bob shop failed: ${shop.message}`);
        return false;
    }
    await bot.buyFromShop(/^bronze axe$/i, 1);
    await bot.closeShop();
    const axe = sdk.findInventoryItem(/^bronze axe$/i);
    if (axe) await bot.equipItem(axe);
    return !!bot.findEquippedItem(SLASH);
}

function atKeepWeb(): boolean {
    const p = pos();
    return p.z >= 3946 && distTo(KEEP_WEB.x, KEEP_WEB.z) <= 18;
}

function insideKeep(): boolean {
    const p = pos();
    return p.x >= 3148 && p.x <= 3165 && p.z >= 3918 && p.z <= 3948;
}

function nearLever(): boolean {
    return distTo(WILDY_LEVER.x, WILDY_LEVER.z) <= 10 || insideKeep();
}

/** Against the keep fence (south or east). Direct walks to the web/lever pin you here. */
function againstKeepFence(): boolean {
    const p = pos();
    if (atKeepWeb() || insideKeep() || nearLever()) return false;
    if (p.x >= 3162 && p.x <= 3196 && p.z >= 3908 && p.z <= 3956) return true;
    if (p.x >= 3144 && p.x <= 3176 && p.z >= 3906 && p.z <= 3922) return true;
    return false;
}

function eastOfKeep(): boolean {
    return againstKeepFence();
}

/** West of the members gate at the z≈3895–3905 blockage — NOT at the 3135,3865 north-road waypoint. */
function needsSpiderGateDetour(): boolean {
    const p = pos();
    return p.z >= 3895 && p.z < 3906 && p.x < 3140;
}

/** East of the members gate, south of the north fence — must walk north through the gate. */
function inMembersGateCorridor(): boolean {
    const p = pos();
    return p.x >= 3148 && p.z >= 3895 && p.z < 3906;
}

async function openNearbyWildyGate(): Promise<boolean> {
    await sdk.scanNearbyLocs(16).catch(() => {});
    const gate =
        sdk.findNearbyLoc(/^gate$/i, { withOption: /open/i }) ??
        (sdk.getNearbyLocs() ?? []).find(
            (l) => /gate/i.test(l.name) && l.optionsWithIndex.some((o) => /open/i.test(o.text))
        );
    if (!gate) return false;
    const open = gate.optionsWithIndex.find((o) => /open/i.test(o.text));
    if (open) await sdk.sendInteractLoc(gate.x, gate.z, gate.id, open.opIndex);
    else await bot.openDoor(gate);
    await sdk.waitForTicks(2);
    return true;
}

async function walkNorthPastMembersGate(): Promise<void> {
    intent('Members gate — walk east to gate, open if closed, walk north through');
    const p = pos();
    if (distTo(SPIDER_GATE.x, SPIDER_GATE.z) > 6) {
        await sdk.sendWalk(SPIDER_GATE.x, SPIDER_GATE.z, true);
        await sdk.waitForTicks(4);
    }
    await openNearbyWildyGate();
    await sdk.sendWalk(SPIDER_GATE.x, 3910, true);
    await sdk.waitForTicks(5);
    if (pos().z < 3906) {
        await sdk.sendWalk(SPIDER_GATE.x + 2, SPIDER_GATE.z, true);
        await sdk.waitForTicks(3);
        await openNearbyWildyGate();
        await sdk.sendWalk(SPIDER_GATE.x + 2, 3910, true);
        await sdk.waitForTicks(5);
    }
}

async function crossMembersWildyGate(): Promise<void> {
    if (inMembersGateCorridor()) {
        await walkNorthPastMembersGate();
        return;
    }
    intent('Members gate — walk east, open if closed, pass through');
    const p = pos();
    const eastX = Math.min(SPIDER_GATE.x, Math.max(p.x + 10, 3155));
    await sdk.sendWalk(eastX, p.z, true);
    await sdk.waitForTicks(4);
    await openNearbyWildyGate();
    if (pos().x < 3148) {
        await sdk.sendWalk(SPIDER_GATE.x, SPIDER_GATE.z, true);
        await sdk.waitForTicks(4);
        await openNearbyWildyGate();
    }
    if (pos().x < 3148) {
        await sdk.sendWalk(3195, SPIDER_GATE.z, true);
        await sdk.waitForTicks(4);
    }
}

function wildySpread(): { x: number; z: number } {
    const n = [...username].reduce((a, c) => a + c.charCodeAt(0), 0);
    return { x: (n % 5) - 2, z: (n % 3) - 1 };
}

function nearbyJackpoo(): boolean {
    return (sdk.getNearbyPlayers() ?? []).some(
        (p) => /^jackpoo/i.test(p.name) && (p.distance ?? 99) <= 8
    );
}

async function slashKeepWeb(): Promise<boolean> {
    if (insideKeep() || nearLever()) return true;
    await sdk.scanNearbyLocs(10).catch(() => {});
    if (sdk.findNearbyLoc(/^slashed web$/i)) return true;
    const web =
        sdk.findNearbyLoc(/^web$/i, { withOption: /slash/i }) ?? sdk.findNearbyLoc(/^web$/i);
    if (!web) return insideKeep() || distTo(WILDY_LEVER.x, WILDY_LEVER.z) < 8;
    if (!slashItem()) return false;
    const slash = slashItem();
    if (slash && !/^knife$/i.test(slash.name) && !bot.findEquippedItem(SLASH)) await bot.equipItem(slash);
    const opt = web.optionsWithIndex.find((o) => /slash/i.test(o.text));
    if ((web.distance ?? 99) > 2) {
        await sdk.sendWalk(WEB_STAND.x, WEB_STAND.z, true);
        await sdk.waitForTicks(2);
    }
    const knife = sdk.findInventoryItem(/^knife$/i);
    if (knife) await bot.useItemOnLoc(knife, web);
    else if (opt) await sdk.sendInteractLoc(web.x, web.z, web.id, opt.opIndex);
    else await bot.interactLoc(web, /slash/i);
    await sdk.waitForTicks(2);
    return !!sdk.findNearbyLoc(/^slashed web$/i) || !sdk.findNearbyLoc(/^web$/i, { withOption: /slash/i });
}

async function walkWildyToLever(): Promise<void> {
    const off = wildySpread();
    if (nearLever() || insideKeep() || atKeepWeb()) return;

    if (distTo(WILDY_LEVER.x, WILDY_LEVER.z) <= 16) {
        intent('Walking to the wilderness lever');
        await sdk.sendWalk(WILDY_LEVER.x, WILDY_LEVER.z, true);
        await sdk.waitForTicks(4);
        return;
    }

    // Just through the members gate — slide west onto x≈3135 before heading north.
    if (pos().x >= 3148 && pos().z >= 3906 && pos().z <= 3914 && !atKeepWeb()) {
        intent('North of members gate — west to the north road');
        await sdk.sendWalk(3135, Math.min(pos().z, 3908), true);
        await sdk.waitForTicks(5);
        return;
    }

    if (againstKeepFence()) {
        const south = Math.max(3908, Math.min(pos().z, 3908));
        if (pos().z > 3908) {
            intent('Keep fence — step south off the wall (not back to 44 wild)');
            await sdk.sendWalk(Math.min(pos().x, 3172), 3908, true);
        } else {
            intent('South of keep — west around to the web, staying north of 44 wild');
            await sdk.sendWalk(3135, south, true);
        }
        await sdk.waitForTicks(6);
        return;
    }

    // Staging tile south of the members gate fence — walk north in steps, not 3865→3954 in one hop.
    if (pos().x <= 3140 && pos().z >= 3860 && pos().z < 3895 && !atKeepWeb()) {
        intent('North road — walking up to the members gate line');
        await sdk.sendWalk(3135, Math.min(3895, pos().z + 12), true);
        await sdk.waitForTicks(5);
        return;
    }

    if (needsSpiderGateDetour()) {
        await crossMembersWildyGate();
        return;
    }

    if (inMembersGateCorridor()) {
        await walkNorthPastMembersGate();
        return;
    }

    // Drifted east off x≈3135 on the south wildy road — not at the gate line (z≥3860).
    if (pos().z < 3860 && pos().x >= 3150 && !atKeepWeb()) {
        intent('Rejoining north road to keep web');
        await sdk.sendWalk(3135, pos().z, true);
        await sdk.waitForTicks(4);
        return;
    }

    if (pos().z < 3895) {
        for (const wp of WILDY_TO_LEVER) {
            if (inArdougne() || atKeepWeb() || insideKeep() || nearLever()) return;
            if (pos().z >= 3895) break;
            if (distTo(wp.x, wp.z) <= 7) continue;
            if (pos().z >= wp.z - 3) continue;
            const spread = wp.z >= 3860 ? { x: 0, z: 0 } : off;
            intent(`Wildy around keep to web ${wp.x + spread.x},${wp.z}`);
            await eatIfNeeded();
            await sdk.sendWalk(wp.x + spread.x, wp.z + spread.z, true);
            await sdk.waitForTicks(5);
            return;
        }
        return;
    }

    if (pos().z >= 3906 && pos().z < 3946 && pos().x < 3148 && distTo(3135, 3954) > 6 && !atKeepWeb()) {
        intent('North road — walking to keep web');
        await sdk.sendWalk(3135, 3954, true);
        await sdk.waitForTicks(5);
        return;
    }

    if (!atKeepWeb() && !nearLever()) {
        if (pos().z >= 3946) {
            intent('North of keep — walking to the web stand tile');
            await sdk.sendWalk(WEB_STAND.x, WEB_STAND.z, true);
        } else if (pos().z >= 3906) {
            intent('Approaching keep web');
            await eatIfNeeded();
            await sdk.sendWalk(WEB_STAND.x, WEB_STAND.z, true);
        } else if (pos().x >= 3148 && pos().z >= 3895) {
            intent('East of gate — walking north to the gate opening');
            await sdk.sendWalk(Math.min(pos().x, SPIDER_GATE.x), 3902, true);
        }
        await sdk.waitForTicks(5);
    }
}

async function pullWildyLever(): Promise<boolean> {
    if (!nearLever() && (eastOfKeep() || (!atKeepWeb() && distTo(KEEP_WEB.x, KEEP_WEB.z) > 8))) {
        await walkWildyToLever();
        return inArdougne();
    }

    await sdk.scanNearbyLocs(10).catch(() => {});
    const webUp = !!sdk.findNearbyLoc(/^web$/i, { withOption: /slash/i });
    const slashed = !!sdk.findNearbyLoc(/^slashed web$/i);

    if (!nearLever() && webUp && !slashed) {
        if (!slashItem()) {
            intent('No slash weapon — waiting at the web for another bot to cut it');
            await sdk.waitForTicks(4);
            return inArdougne();
        }
        await slashKeepWeb();
        if (!insideKeep() && !sdk.findNearbyLoc(/^slashed web$/i)) {
            intent('Web still up — not walking to the lever (that paths around to 44 wild)');
            return inArdougne();
        }
    }

    if (!nearLever() && !insideKeep() && !slashed && webUp) return inArdougne();

    if (!nearLever()) {
        await sdk.sendWalk(WILDY_LEVER.x, WILDY_LEVER.z, true);
        await sdk.waitForTicks(3);
    }
    for (let i = 0; i < 8 && !inArdougne(); i++) {
        await eatIfNeeded();
        if (pos().inCombat && nearLever()) await sdk.sendWalk(WILDY_LEVER.x, WILDY_LEVER.z, true);
        const lever =
            sdk.findNearbyLoc(/^lever$/i, { withOption: /pull/i }) ?? sdk.findNearbyLoc(/^lever$/i);
        if (!lever || lever.reachable === false) {
            if (nearLever() || insideKeep()) {
                intent('In the keep — pulling the lever, not walking to the web');
                await sdk.waitForTicks(1);
                continue;
            }
            if (!slashItem()) {
                intent('Lever gated — waiting for the web to be slashed');
                await sdk.waitForTicks(3);
                break;
            }
            await slashKeepWeb();
            if (eastOfKeep()) break;
            continue;
        }
        intent('Pulling the wilderness lever to Ardougne');
        await bot.interactLoc(lever, /pull/i);
        const dialog = sdk.getDialog();
        if (dialog?.isOpen) {
            const pick =
                dialog.options.find((o) => /don't show|brave|yes please/i.test(o.text)) ||
                dialog.options.find((o) => /yes/i.test(o.text));
            await sdk.sendClickDialog(pick?.index ?? 0);
            await sdk.waitForTicks(2);
        }
        await sdk.waitForCondition((s) => {
            const x = s.player?.worldX ?? 0;
            const z = s.player?.worldZ ?? 0;
            return x < 2750 && x > 2500 && z > 3240;
        }, 8_000).catch(() => {});
        if (inArdougne()) {
            log(`Wildy lever → Ardougne (${pos().x},${pos().z})`);
            return true;
        }
        await sdk.waitForTicks(1);
    }
    return inArdougne();
}

async function returnToArdougne(): Promise<void> {
    session.noteProgress('location', `${pos().x},${pos().z}`);
    await leaveAdjacentClosedDoor(sdk);
    if (inArdougne()) {
        if (pos().z < 3271 && sdk.findNearbyLoc(/gangplank/i)) {
            await crossGangplank();
            await sdk.waitForTicks(3);
        }
        return;
    }
    const p = pos();
    if (p.x > 2500 && p.x < 2720 && p.z >= 3355 && p.z < 3480 && p.z < 6400) {
        intent('Walking south from ranging guild to Ardougne');
        await walkNear(ARDOUGNE_MARKET.x, ARDOUGNE_MARKET.z, 6);
        return;
    }
    await leaveDockedShip();
    if (inAlKharid() || onAlKharidToll()) {
        await exitAlKharidWest();
        if (inAlKharid() || onAlKharidToll()) return;
        if (distTo(EDGEVILLE.x, EDGEVILLE.z) > 20) {
            await walkNear(EDGEVILLE.x, EDGEVILLE.z, 8);
        }
        return;
    }
    if (inLegendsGuild() || sdk.getDialog()?.isOpen) {
        await leaveLegendsGuild();
        await walkWaypoints(CATHERBY_TO_ARDY);
        return;
    }
    if (onMusa()) {
        await musaToBrimhaven();
        return;
    }
    if (onKaramja()) {
        await brimhavenToArdougne();
        return;
    }

    if (nearSeersCatherby()) {
        intent('Walking Catherby/Seers → Ardougne');
        await walkWaypoints(CATHERBY_TO_ARDY);
        return;
    }

    if (inWilderness() || pos().z >= 3508) {
        if (pos().z < 3524) {
            intent('Crossing the wilderness ditch — not walking back to the bank');
            await sdk.sendWalk(3088, 3528, true);
            await sdk.waitForTicks(4);
            return;
        }
        if (distTo(WILDY_LEVER.x, WILDY_LEVER.z) > 12) await walkWildyToLever();
        await pullWildyLever();
        return;
    }

    if (!packedForWildy()) {
        await bankForWildy();
        return;
    }

    if (distTo(EDGEVILLE.x, EDGEVILLE.z) > 12) {
        intent('Walking to Edgeville, then north to the wildy lever');
        await walkNear(EDGEVILLE.x, EDGEVILLE.z, 6);
        return;
    }
    await sdk.sendWalk(3088, 3528, true);
    await sdk.waitForTicks(4);
}

session.registerRecovery([
    {
        name: 'recover_stun',
        maxConsecutive: 2,
        run: async () => {
            await recoverStun();
            return false;
        }
    },
    {
        name: 'return_ardougne',
        maxConsecutive: 2,
        run: async () => {
            await returnToArdougne();
            return inArdougne();
        }
    },
    {
        name: 'restock_food',
        maxConsecutive: 2,
        run: async () => {
            if (!inArdougne()) return false;
            await ensureFood();
            return hasThieveFood();
        }
    },
    {
        name: 'recover_gangplank',
        maxConsecutive: 2,
        run: async () => recoverGangplank(bot, sdk)
    },
    {
        name: 'recover_lever',
        maxConsecutive: 2,
        run: async () => recoverLeverOscillation(bot, sdk)
    }
]);

try {
    lastLoggedLevel = thievingLevel();
    session.log('log', `Thieving ${lastLoggedLevel} @ ${pos().x},${pos().z} gp=${coinCount()} food=${foodCount()}`);
    if (usesFoodMule(username)) {
        session.log(
            'log',
            `Food restock: own bank, then 1-to-1 with ${FOOD_MULE} @ ${ARDOUGNE_BANK.x},${ARDOUGNE_BANK.z}`
        );
    }
    await clickYesOrContinue();
    const p0 = pos();
    if (p0.x >= 3050 && p0.x <= 3150 && p0.z >= 3050 && p0.z <= 3135) {
        await bot.skipTutorial();
    }
    await bot.dismissBlockingUI();
    sdk.getNewChat();
    lastLoggedLevel = thievingLevel();

    while (true) {
        if (!(await tickSession())) break;
        session.maybeHeartbeat();
        await bot.dismissBlockingUI();
        if (pos().isDead) {
            intent('Dead — waiting to respawn');
            session.noteFailure('dead', 'waiting to respawn');
            await sdk.waitForCondition((s) => !s.player.isDead, 45_000).catch(() => {});
            session.noteProgress('location', 'respawned');
            continue;
        }

        await eatIfNeeded();
        await dropEmptyJugs();
        const level = thievingLevel();
        if (level !== lastLoggedLevel) {
            session.log('log', `LEVEL UP Thieving ${level} | ${coinCount()} gp | food ${foodCount()}`);
            session.noteProgress('xp', `thieving ${level}`);
            await pm(pick([
                `jackkk thieving ${level} now`,
                `level ${level} thieving!! piggy is so good`,
                `i hit ${level} thieving, still not dead`
            ]));
            lastLoggedLevel = level;
        }

        // Men / Al Kharid warriors restock at the kebab shop. recoverLowHp()
        // walks to Ardougne/Catherby bank food — only for 55+ heroes.
        if (level < 25) {
            await enterPhase('men');
            await pickpocketMen();
            session.noteProgress('xp', 'men');
            continue;
        }
        if (level < 55) {
            await enterPhase('warriors');
            await trainWarriors();
            session.noteProgress('xp', 'warriors');
            continue;
        }

        if (inAlKharid() || pos().x >= 3269) {
            await enterPhase('travel_ardougne');
            await returnToArdougne();
            continue;
        }
        if (onAlKharidToll() || onGateLine() || distTo(ALKHARID_GATE.x, ALKHARID_GATE.z) < 8) {
            await stepOffTollWest();
            continue;
        }

        if (tooLowToThieve()) {
            intent(`HP ${pos().hp} — not pickpocketing under ${MIN_THIEVE_HP}`);
            session.noteFailure('low_hp', `hp ${pos().hp}`);
            if (!(await recoverLowHp())) {
                session.stop('low_hp', `could not recover above ${MIN_THIEVE_HP}`);
                break;
            }
            continue;
        }

        if (inLegendsGuild()) {
            await leaveLegendsGuild();
        }
        if (inKeepLeFaye()) {
            await leaveKeepLeFaye();
        }

        if (pos().maxHp < TARGET_HP && !inWilderness()) {
            await enterPhase('chickens');
            await punchChickens();
            continue;
        }

        if (!inArdougne()) {
            await enterPhase('travel_ardougne');
            if (inKandarin()) {
                await returnToArdougne();
                continue;
            }
            if (!inWilderness() && pos().z < 3508 && !packedForWildy()) {
                await bankForWildy();
                continue;
            }
            const slash = slashItem();
            if (slash && !bot.findEquippedItem(SLASH)) await bot.equipItem(slash);
            await returnToArdougne();
            continue;
        }

        if (notedFood().length > 0) {
            await enterPhase('restock_food');
            await ensureFood();
            continue;
        }
        if (!hasThieveFood()) {
            await enterPhase('restock_food');
            const food = await ensureFood();
            if (!hasThieveFood() && notedFood().length === 0) {
                if (usesFoodMule(username)) {
                    log(`Still no food after mule/bank — waiting on ${FOOD_MULE}`);
                    await sdk.waitForTicks(15);
                    continue;
                }
                if (food.opened) {
                    await logoutOutOfFood();
                    break;
                }
                continue;
            }
            if (SHOP_ARROWS) await buyAndBankShopStock();
            continue;
        }

        await enterPhase('pickpocket');
        const result = await pickpocketBest();
        if (result === 'ok') {
            session.noteProgress('xp', 'pickpocket');
            await maybePackLootWhileGrinding();
            continue;
        }
        if (result === 'stunned' || result === 'fail') {
            session.noteFailure(result, 'pickpocket');
            await recoverStun();
            continue;
        }

        await sdk.waitForTicks(2);
    }
} catch (err) {
    session.stop('script_error', err instanceof Error ? err.message : String(err));
    console.error('Script error:', err);
} finally {
    await session.finalizeStop();
    await sdk.disconnect();
}
