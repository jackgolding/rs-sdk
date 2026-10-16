/**
 * King Black Dragon — mith knives from the SW-pillar safespot.
 *
 * Accurate until Ranged 99, Longrange until Defence 99, then Rapid.
 * After each kill: pick up knives, then loot, then walk back onto the pillar.
 * Never bot.walkTo on the surface wilderness. Attack from the stand tile with
 * sendInteractNpc(..., { route: false }) so porcelain does not chase.
 *
 * Live loadout (Yanille stack, 2026-09-04): all five wear mith knives ×500,
 * dragonfire shield, d'hide chaps, dragon vambraces, adamant full helm.
 * Dragonhide body: jacklove5 + fatpig only. Glory: fatpig (uncharged).
 * fatpig is 99 range/def → Rapid. jacklove3 is def 97. Others def 99, range 87–89.
 *
 * Travel is Yanille/Ardougne → Ardougne wilderness lever → keep web →
 * southwest to the lesser-demon KBD ladder. Mith knives do not slash the
 * web; wait for a kitchen knife (`^knife$`, not "Mithril knife").
 *
 *   bun bots/quests/kbd-range.ts jacklove1
 */
import { existsSync, readFileSync } from 'fs';
import { dirname, join } from 'path';
import { ActivitySession, BotSDK, deriveGatewayUrl, inWilderness } from '../../sdk/index';
import { BotActions } from '../../sdk/actions';
import { initPathfinding } from '../../sdk/pathfinding';
import {
    ARDOUGNE_BANK,
    ARDOUGNE_LEVER_DOOR,
    ARDOUGNE_WILDY_LEVER,
    DESERTED_KEEP_LEVER,
    EDGEVILLE,
    KEEP_ROAD_X,
    KEEP_WEB,
    KEEP_WEB_NORTH,
    KEEP_WEB_SOUTH,
    YANILLE_BANK,
    YANILLE_TO_ARDY_LEVER
} from './tiles';
import { closeUi, leaveAdjacentClosedDoor, walkNear } from './movement';
import { foodHeal, needsBankHeal } from './food-heal';
import { LAVA_MAZE_EAST, southOfLavaMaze } from './rune-rocks-route';
import { installGracefulShutdown } from '../../sdk/runner';

/** Stalagmite loc_542 is (2707, 9818). Stand one tile west — KBD is east. */
const SAFESPOT = { x: 2706, z: 9818 };
/** East of the pillar, in knife range of a west-walking KBD. */
const LURE = { x: 2711, z: 9818 };
const EXIT_LEVER = { x: 2717, z: 9801 };
const ENTRY_LEVER = { x: 3067, z: 10253 };
const KBD_LADDER = { x: 3017, z: 3849 };
const GATE = { x: 3008, z: 3849 };
const SPIDER_GATE = { x: 3224, z: 3904 };
const TREE_HOP = 3;
const FOOD_WITHDRAW = 12;
const ANTIPOISON_WITHDRAW = 2;
const PRAYER_POT_WITHDRAW = 2;
const KNIFE_RESTOCK_BELOW = 80;

/** Keep (north) → lesser-demon gate. Stay on x=3135 until south of the members fence. */
const KEEP_TO_LADDER = [
    { x: KEEP_ROAD_X, z: 3954 },
    { x: KEEP_ROAD_X, z: 3895 },
    { x: KEEP_ROAD_X, z: 3865 },
    { x: 3078, z: 3848 },
    { x: 3040, z: 3848 },
    { x: 3008, z: 3848 },
    { x: 3017, z: 3848 }
];
const LADDER_TO_KEEP = [...KEEP_TO_LADDER].reverse();

const KBD = /^king black dragon$/i;
const KNIVES = /^mithril kni(fe|ves)$/i;
const DRAGON_BONES = /^dragon bones$/i;
const BLACK_HIDE = /^black d'?hide$/i;
const SHARK = /^shark$/i;
const ANTIPOISON = /^antipoison(\(\d\))?$/i;
const PRAYER_POT = /^prayer potion(\(\d\))?$/i;
const EMPTY_VIAL = /^vial$/i;
const KITCHEN_KNIFE = /^knife$/i;
const FIRE_SHIELD = /dragonfire shield|anti-?dragon/i;
const DHIDE_BODY = /^dragonhide body$/i;
const DHIDE_CHAPS = /^dragonhide chaps$/i;
const VAMBRACES = /^dragon vambraces$/i;
const HELM = /^(adamant|rune) (full helm|med helm)$/i;
const BOOTS = /^(leather|climbing) boots$/i;
const CHARGED_GLORY = /amulet of glory\([1-4]\)/i;
const ANY_GLORY = /amulet of glory/i;
const ARROW = /arrows?$/i;
const SHORTBOW = /shortbow/i;
const RARE =
    /rune longsword|adamant platebody|dragon med|rune axe|adamant axe|runite bar|adamantite bar|amulet of strength|shark|clue scroll|half of a key|left half|shield left half|^(uncut )?(sapphire|emerald|ruby|diamond|dragonstone)$/i;
const GEAR =
    /mithril kni|dragonfire shield|anti-?dragon|dragonhide (body|chaps)|dragon vambraces|(adamant|rune) (full helm|med helm)|amulet of glory|(leather|climbing) boots/i;

const argv = process.argv.slice(2);
const botArg = argv.find((a) => !a.startsWith('-'));

function loadBotEnv(): void {
    const envPath = botArg
        ? join(process.cwd(), 'bots', botArg, 'bot.env')
        : join(dirname(import.meta.path), 'bot.env');
    if (!existsSync(envPath)) {
        throw new Error(`bot.env not found at ${envPath}. Usage: bun bots/quests/kbd-range.ts {botname}`);
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

initPathfinding();

const sdk = new BotSDK({
    botUsername: username,
    password,
    gatewayUrl: deriveGatewayUrl(server),
    autoLaunchBrowser: false,
    browserLaunchTimeout: 90_000,
    readyTimeout: 45_000,
    connectTimeout: 60_000,
    showChat: false
});

await sdk.connect();
const bot = new BotActions(sdk);
const session = new ActivitySession(sdk, bot, {
    name: 'kbd-range',
    grindLogPath: GRIND_LOG,
    stallMs: 180_000,
    maxRecoveryTactics: 8
});

installGracefulShutdown({ graceMs: 30_000 });

function log(msg: string): void {
    session.log('log', msg);
}

function intent(msg: string): void {
    void session.showIntent(msg);
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
        inCombat: p?.combat?.inCombat ?? false,
        targetType: p?.combat?.targetType ?? 'none',
        targetIndex: p?.combat?.targetIndex ?? -1,
        lifeId: p?.lifeId ?? 0
    };
}

function distTo(x: number, z: number): number {
    return Math.hypot(pos().x - x, pos().z - z);
}

function chebyshev(x: number, z: number): number {
    return Math.max(Math.abs(pos().x - x), Math.abs(pos().z - z));
}

function northOfDitch(): boolean {
    return inWilderness(pos().x, pos().z);
}

function inKbdLair(): boolean {
    const p = pos();
    return p.x >= 2688 && p.x < 2752 && p.z >= 9792 && p.z < 9856;
}

function inLeverDungeon(): boolean {
    const p = pos();
    return p.x >= 3008 && p.x < 3072 && p.z >= 10240 && p.z < 10304;
}

function inArdougne(): boolean {
    const p = pos();
    return p.x > 2500 && p.x < 2720 && p.z > 3240 && p.z < 3355 && p.z < 6400;
}

function insideKeep(): boolean {
    const p = pos();
    return p.x >= 3148 && p.x <= 3165 && p.z >= 3918 && p.z <= 3948;
}

function atKeepWeb(): boolean {
    const p = pos();
    return p.z >= 3946 && distTo(KEEP_WEB.x, KEEP_WEB.z) <= 18;
}

function northOfKeepWeb(): boolean {
    return pos().z >= 3952 && pos().x >= 3130 && pos().x <= 3170;
}

function westOfKeepRoad(): boolean {
    const p = pos();
    return p.x < 3148 && p.z >= 3840 && p.z < 6400;
}

function nearKeepLever(): boolean {
    return distTo(DESERTED_KEEP_LEVER.x, DESERTED_KEEP_LEVER.z) <= 10 || insideKeep();
}

function inMembersGateCorridor(): boolean {
    const p = pos();
    return p.x >= 3148 && p.z >= 3895 && p.z < 3906;
}

function onSafespot(): boolean {
    return chebyshev(SAFESPOT.x, SAFESPOT.z) === 0;
}

function occupied(): number {
    return sdk.getInventory().filter((i) => (i.count ?? 0) > 0).length;
}

function count(pattern: RegExp): number {
    const worn = sdk.getEquipment().filter((i) => pattern.test(i.name)).reduce((n, i) => n + (i.count ?? 1), 0);
    const inv = sdk.getInventory().filter((i) => pattern.test(i.name)).reduce((n, i) => n + (i.count ?? 1), 0);
    return worn + inv;
}

function sharkSlots(): number {
    return sdk.getInventory().filter((i) => SHARK.test(i.name)).reduce((n, i) => n + (i.count ?? 1), 0);
}

function edible() {
    return sdk.getInventory().filter((i) => foodHeal(i.name) > 0);
}

function foodCount(): number {
    return edible().reduce((n, i) => n + (i.count ?? 1), 0);
}

function rangedLevel(): number {
    return sdk.getSkill('Ranged')?.baseLevel ?? 1;
}

function defenceLevel(): number {
    return sdk.getSkill('Defence')?.baseLevel ?? 1;
}

function knifeRange(): number {
    return defenceLevel() >= 99 && rangedLevel() >= 99 ? 4 : rangedLevel() >= 99 ? 6 : 4;
}

function wantedStyle(): 'Accurate' | 'Longrange' | 'Rapid' {
    if (rangedLevel() < 99) return 'Accurate';
    if (defenceLevel() < 99) return 'Longrange';
    return 'Rapid';
}

function isLoot(name: string): boolean {
    return KNIVES.test(name) || DRAGON_BONES.test(name) || BLACK_HIDE.test(name) || RARE.test(name);
}

function lootPriority(name: string): number {
    if (KNIVES.test(name)) return 0;
    if (RARE.test(name)) return 1;
    if (BLACK_HIDE.test(name)) return 2;
    if (DRAGON_BONES.test(name)) return 3;
    return 9;
}

function shouldKeep(name: string): boolean {
    if (SHORTBOW.test(name) || ARROW.test(name) || EMPTY_VIAL.test(name)) return false;
    if (SHARK.test(name)) return true;
    if (ANTIPOISON.test(name) || PRAYER_POT.test(name)) return true;
    if (KITCHEN_KNIFE.test(name)) return true;
    return GEAR.test(name);
}

function skipIfFarther(wp: { x: number; z: number }, dest: { x: number; z: number }): boolean {
    if (distTo(wp.x, wp.z) <= 8) return true;
    const remaining = distTo(dest.x, dest.z);
    const via = Math.hypot(wp.x - dest.x, wp.z - dest.z);
    return via >= remaining - 6;
}

async function ui(): Promise<void> {
    await closeUi(bot, sdk);
}

async function hopToward(x: number, z: number, tolerance = 4): Promise<boolean> {
    await bot.dismissBlockingUI();
    for (let i = 0; i < 80 && !pos().isDead; i++) {
        const p = pos();
        const d = Math.hypot(p.x - x, p.z - z);
        if (d <= tolerance) return true;
        const onKeepRoad = Math.abs(p.x - KEEP_ROAD_X) <= 8 && p.z >= 3840;
        const destOnKeepRoad = Math.abs(x - KEEP_ROAD_X) <= 8 && z >= 3840;
        const step = Math.min(TREE_HOP, Math.max(1, d));
        let tx: number;
        let tz: number;
        if (onKeepRoad && destOnKeepRoad && Math.abs(z - p.z) >= Math.abs(x - p.x)) {
            tx = KEEP_ROAD_X;
            tz = p.z + Math.sign(z - p.z) * step;
        } else {
            tx = Math.round(p.x + ((x - p.x) / d) * step);
            tz = Math.round(p.z + ((z - p.z) / d) * step);
        }
        if (tx === KEEP_WEB.x && tz === KEEP_WEB.z) {
            const stand = webStandFor(p.z);
            tx = stand.x;
            tz = stand.z;
        }
        const sx = p.x;
        const sz = p.z;
        await sdk.sendWalk(tx, tz, true);
        await sdk
            .waitForCondition((s) => {
                if (s.player?.isDead) return true;
                const px = s.player?.worldX ?? 0;
                const pz = s.player?.worldZ ?? 0;
                return Math.hypot(px - tx, pz - tz) <= 2 || Math.hypot(px - x, pz - z) <= tolerance;
            }, 5_000)
            .catch(() => {});
        if (pos().x === sx && pos().z === sz) {
            const ux = sx + (i % 2 === 0 ? TREE_HOP : -TREE_HOP);
            const uz = sz + Math.sign(z - sz || -1) * TREE_HOP;
            await sdk.sendWalk(ux, uz, true);
            await sdk.waitForTicks(2).catch(() => {});
        } else {
            session.noteProgress('location', `${pos().x},${pos().z}`);
        }
    }
    return distTo(x, z) <= tolerance + 2;
}

function webStandFor(z: number): { x: number; z: number } {
    return z >= 3951 ? KEEP_WEB_NORTH : KEEP_WEB_SOUTH;
}

async function walkWaypointsSend(
    points: { x: number; z: number }[],
    dest: { x: number; z: number }
): Promise<void> {
    for (const wp of points) {
        if (pos().isDead) return;
        await eatIfNeeded();
        if (skipIfFarther(wp, dest)) continue;
        await hopToward(wp.x, wp.z, 6);
    }
    if (!pos().isDead && distTo(dest.x, dest.z) > 6) await hopToward(dest.x, dest.z, 4);
}

async function setThrownStyle(): Promise<void> {
    const want = wantedStyle();
    const style = sdk.getState()?.combatStyle?.styles.find((s) => s.type === want || s.name === want);
    if (!style) {
        session.log('warn', `No ${want} style (weapon=${sdk.getState()?.combatStyle?.weaponName})`);
        return;
    }
    if (sdk.getState()?.combatStyle?.currentStyle === style.index) return;
    await sdk.sendSetCombatStyle(style.index);
    await sdk.waitForCondition((s) => s.combatStyle?.currentStyle === style.index, 5_000).catch(() => {});
    log(`Style ${want} (ranged ${rangedLevel()} def ${defenceLevel()})`);
}

async function equipLoadout(): Promise<void> {
    const wornArrows = sdk.findEquipmentItem(ARROW);
    if (wornArrows) await bot.unequipItem(wornArrows);
    const pieces = [KNIVES, FIRE_SHIELD, DHIDE_BODY, DHIDE_CHAPS, VAMBRACES, HELM, BOOTS, CHARGED_GLORY, ANY_GLORY];
    for (const pattern of pieces) {
        if (sdk.findEquipmentItem(pattern)) continue;
        const item = sdk.findInventoryItem(pattern);
        if (item) await bot.equipItem(item);
    }
    await setThrownStyle();
}

async function eatIfNeeded(): Promise<void> {
    const p = pos();
    if (p.hp >= p.maxHp) return;
    const foods = edible().sort((a, b) => foodHeal(b.name) - foodHeal(a.name));
    const danger = p.hp <= Math.max(50, Math.floor(p.maxHp * 0.55));
    const food = foods.find((f) => p.hp + foodHeal(f.name) <= p.maxHp) ?? (danger ? foods[0] : null);
    if (!food) return;
    const r = await bot.eatFood(food);
    if (r.success) {
        session.noteProgress('inventory', 'eat');
        log(`Ate ${food.name} +${r.hpGained} HP ${pos().hp}/${pos().maxHp} sharks=${sharkSlots()}`);
    }
}

async function drinkPrayerIfLow(): Promise<void> {
    const pts = sdk.getPrayerState()?.prayerPoints ?? 0;
    const max = sdk.getPrayerState()?.prayerLevel ?? 1;
    if (pts > Math.max(10, Math.floor(max * 0.35))) return;
    const pot = sdk.findInventoryItem(PRAYER_POT);
    if (!pot) return;
    const drink = pot.optionsWithIndex.find((o) => /drink/i.test(o.text));
    if (!drink) return;
    await sdk.sendUseItem(pot.slot, drink.opIndex);
    await sdk.waitForTicks(2);
}

async function drinkAntipoison(): Promise<void> {
    const msgs = sdk.getState()?.recentMessages ?? [];
    const poisoned = msgs.some((m) => /poison/i.test(m.text ?? ''));
    if (!poisoned) return;
    const pot = sdk.findInventoryItem(ANTIPOISON);
    if (!pot) return;
    const drink = pot.optionsWithIndex.find((o) => /drink/i.test(o.text));
    if (!drink) return;
    await sdk.sendUseItem(pot.slot, drink.opIndex);
    await sdk.waitForTicks(2);
}

function findKbd() {
    return (
        (sdk.getNearbyNpcs() ?? []).find(
            (n) => KBD.test(n.name) && (n.hp === null || n.hp > 0) && n.optionsWithIndex.some((o) => /attack/i.test(o.text))
        ) ?? null
    );
}

async function attackFromTile(route: boolean): Promise<boolean> {
    const target = findKbd();
    if (!target) return false;
    const opt = target.optionsWithIndex.find((o) => /attack/i.test(o.text));
    if (!opt) return false;
    await sdk.sendInteractNpc(target.index, opt.opIndex, { route });
    return true;
}

async function interactNamed(name: RegExp, option: RegExp, near: { x: number; z: number }): Promise<boolean> {
    const loc =
        (sdk.getNearbyLocs() ?? []).find(
            (l) => name.test(l.name) && (l.optionsWithIndex ?? []).some((o) => option.test(o.text)) && (l.distance ?? 99) <= 8
        ) ?? null;
    if (!loc) {
        if (distTo(near.x, near.z) > 2) {
            if (inWilderness(pos().x, pos().z) || inLeverDungeon()) await sdk.sendWalk(near.x, near.z, true);
            else await bot.walkTo(near.x, near.z, 1);
            await sdk.waitForTicks(2).catch(() => {});
        }
        return false;
    }
    const opt = loc.optionsWithIndex.find((o) => option.test(o.text));
    if (!opt) return false;
    await sdk.sendInteractLoc(loc.x, loc.z, loc.id, opt.opIndex);
    return true;
}

function itemCountById(id: number): number {
    return sdk
        .getInventory()
        .concat(sdk.getEquipment())
        .filter((i) => i.id === id)
        .reduce((n, i) => n + (i.count ?? 1), 0);
}

async function pickupNear(item: { x: number; z: number; id: number; name: string; count: number }): Promise<boolean> {
    if (Math.hypot(pos().x - item.x, pos().z - item.z) > 2) {
        await bot.walkTo(item.x, item.z, 1);
        await sdk.waitForTicks(2).catch(() => {});
    }
    const before = itemCountById(item.id);
    await sdk.sendPickup(item.x, item.z, item.id);
    try {
        await sdk.waitForCondition((s) => {
            const got =
                s.inventory.concat(s.equipment).filter((i) => i.id === item.id).reduce((n, i) => n + (i.count ?? 1), 0) >
                before;
            const gone = !s.groundItems.some((g) => g.x === item.x && g.z === item.z && g.id === item.id);
            return got || gone || s.player?.isDead === true;
        }, 4_000);
    } catch {
        return false;
    }
    const got = itemCountById(item.id) > before;
    if (got) {
        session.noteProgress('inventory', item.name);
        log(`Picked ${item.count} ${item.name}`);
    }
    return got;
}

async function lootAfterKill(): Promise<void> {
    for (let i = 0; i < 12; i++) {
        await eatIfNeeded();
        const scanned = await sdk.scanGroundItems(8).catch(() => []);
        const ground = [...(sdk.getGroundItems() ?? []), ...scanned];
        const unique = new Map<string, (typeof ground)[0]>();
        for (const g of ground) {
            if (!isLoot(g.name) || g.reachable === false) continue;
            unique.set(`${g.x},${g.z},${g.id}`, g);
        }
        const item = [...unique.values()].sort(
            (a, b) => lootPriority(a.name) - lootPriority(b.name) || (a.distance ?? 99) - (b.distance ?? 99)
        )[0];
        if (!item) break;
        if (occupied() >= 28 && !KNIVES.test(item.name) && !DRAGON_BONES.test(item.name)) break;
        const ok = await pickupNear(item);
        if (!ok) break;
    }
    if (!sdk.findEquipmentItem(KNIVES)) {
        const stack = sdk.findInventoryItem(KNIVES);
        if (stack) await bot.equipItem(stack);
    }
}

async function returnToSafespot(): Promise<void> {
    if (onSafespot()) return;
    intent(`Safespot ${SAFESPOT.x},${SAFESPOT.z}`);
    await bot.walkTo(SAFESPOT.x, SAFESPOT.z, 0);
}

async function lureAndKill(): Promise<void> {
    if (!inKbdLair()) return;
    await setThrownStyle();
    const kbd = findKbd();
    if (!kbd) {
        await returnToSafespot();
        await sdk.waitForTicks(3);
        return;
    }
    if (!onSafespot()) {
        if (distTo(kbd.x, kbd.z) > knifeRange() + 4) {
            intent(`Lure KBD from ${LURE.x},${LURE.z}`);
            await bot.walkTo(LURE.x, LURE.z, 0);
            await attackFromTile(false);
            await sdk.waitForTicks(2);
        }
        await returnToSafespot();
    }
    const xpBefore = sdk.getSkill('Ranged')?.experience ?? 0;
    const knivesBefore = count(KNIVES);
    intent(`Range KBD from safespot (${wantedStyle()})`);
    const started = Date.now();
    while (findKbd() && !pos().isDead && Date.now() - started < 180_000) {
        await bot.dismissBlockingUI();
        await eatIfNeeded();
        if (!onSafespot()) await returnToSafespot();
        await attackFromTile(false);
        await sdk.waitForTicks(1);
    }
    if (!findKbd() && (sdk.getSkill('Ranged')?.experience ?? 0) >= xpBefore) {
        session.noteProgress('xp', `ranged ${sdk.getSkill('Ranged')?.experience}`);
        log(
            `KBD dead +${(sdk.getSkill('Ranged')?.experience ?? 0) - xpBefore} range xp knives=${count(KNIVES)} (was ${knivesBefore})`
        );
        await lootAfterKill();
        await returnToSafespot();
        if (count(KNIVES) > knivesBefore || sdk.findInventoryItem(DRAGON_BONES) || sdk.findInventoryItem(BLACK_HIDE)) {
            log(
                `Looted knives=${count(KNIVES)} bones=${count(DRAGON_BONES)} hide=${count(BLACK_HIDE)} @ ${pos().x},${pos().z}`
            );
        }
    }
}

async function dismissLeverWarning(): Promise<void> {
    for (let i = 0; i < 8; i++) {
        const dialog = sdk.getDialog();
        if (!dialog?.isOpen) return;
        const pick =
            dialog.options.find((o) => /don't show|brave|yes please/i.test(o.text)) ||
            dialog.options.find((o) => /continue|click here/i.test(o.text)) ||
            dialog.options.find((o) => /yes/i.test(o.text));
        await sdk.sendClickDialog(pick?.index ?? 0);
        await sdk.waitForTicks(2).catch(() => {});
    }
}

async function webIsPassable(): Promise<boolean> {
    await sdk.scanNearbyLocs(10).catch(() => {});
    if (sdk.findNearbyLoc(/^slashed web$/i)) return true;
    const blocking = sdk.findNearbyLoc(/^web$/i, { withOption: /slash/i });
    return !blocking;
}

async function slashOrWaitForWeb(stand: { x: number; z: number }): Promise<boolean> {
    if (await webIsPassable()) return true;
    if (distTo(stand.x, stand.z) > 2) {
        await sdk.sendWalk(stand.x, stand.z, true);
        await sdk.waitForTicks(2).catch(() => {});
    }
    for (let i = 0; i < 36 && !pos().isDead; i++) {
        if (await webIsPassable()) return true;
        const web = sdk.findNearbyLoc(/^web$/i);
        const knife = sdk.findInventoryItem(KITCHEN_KNIFE);
        if (knife && web) {
            intent('Slash keep web with kitchen knife');
            await bot.useItemOnLoc(knife, web);
            await sdk.waitForTicks(3);
            continue;
        }
        if (i % 4 === 0) {
            log(`Web up @ ${pos().x},${pos().z} — waiting for kitchen knife slash`);
            intent('Waiting at keep web for slash');
        }
        await eatIfNeeded();
        await sdk.sendWalk(stand.x, stand.z, true);
        await sdk.waitForTicks(4);
    }
    return webIsPassable();
}

async function exitKeepNorth(): Promise<boolean> {
    if (northOfKeepWeb() || westOfKeepRoad()) return true;
    intent('Keep web — slash or wait, then walk north');
    await hopToward(KEEP_WEB_SOUTH.x, KEEP_WEB_SOUTH.z, 2);
    if (!(await slashOrWaitForWeb(KEEP_WEB_SOUTH))) return false;
    await sdk.sendWalk(KEEP_WEB_NORTH.x, KEEP_WEB_NORTH.z, true);
    await sdk
        .waitForCondition((s) => (s.player?.worldZ ?? 0) >= 3952 || s.player?.isDead === true, 8_000)
        .catch(() => {});
    return northOfKeepWeb() || westOfKeepRoad();
}

async function enterKeepFromNorth(): Promise<boolean> {
    if (insideKeep() || nearKeepLever()) return true;
    intent('Keep web — enter from the north stand');
    await hopToward(KEEP_WEB_NORTH.x, KEEP_WEB_NORTH.z, 2);
    if (!(await slashOrWaitForWeb(KEEP_WEB_NORTH))) return false;
    await sdk.sendWalk(DESERTED_KEEP_LEVER.x, DESERTED_KEEP_LEVER.z, true);
    await sdk
        .waitForCondition((s) => {
            const x = s.player?.worldX ?? 0;
            const z = s.player?.worldZ ?? 0;
            return (x >= 3148 && x <= 3165 && z >= 3918 && z <= 3948) || s.player?.isDead === true;
        }, 8_000)
        .catch(() => {});
    return insideKeep() || nearKeepLever();
}

async function openNearbyGate(): Promise<void> {
    await sdk.scanNearbyLocs(12).catch(() => {});
    const gate = (sdk.getNearbyLocs() ?? []).find(
        (l) => /gate/i.test(l.name) && (l.optionsWithIndex ?? []).some((o) => /^open$/i.test(o.text))
    );
    if (!gate) return;
    const open = gate.optionsWithIndex.find((o) => /^open$/i.test(o.text));
    if (open) await sdk.sendInteractLoc(gate.x, gate.z, gate.id, open.opIndex);
    else await bot.openDoor(gate);
    await sdk.waitForTicks(2);
}

async function leaveMembersCorridor(headingNorth: boolean): Promise<void> {
    if (!inMembersGateCorridor()) return;
    if (headingNorth) {
        intent('Members corridor — east to spider gate, then north');
        await sdk.sendWalk(SPIDER_GATE.x, SPIDER_GATE.z, true);
        await sdk.waitForTicks(4);
        await openNearbyGate();
        await sdk.sendWalk(SPIDER_GATE.x, 3910, true);
        await sdk.waitForTicks(5);
        await sdk.sendWalk(KEEP_ROAD_X, Math.min(pos().z, 3908), true);
        await sdk.waitForTicks(4);
        return;
    }
    intent('Members corridor — south off the fence, then west to KBD');
    await sdk.sendWalk(Math.min(pos().x, 3172), 3868, true);
    await sdk.waitForTicks(5);
}

async function pullArdyLever(): Promise<boolean> {
    if (northOfDitch() || insideKeep() || nearKeepLever()) return true;
    intent(`Ardougne wilderness lever ${ARDOUGNE_WILDY_LEVER.x},${ARDOUGNE_WILDY_LEVER.z}`);
    for (const wp of YANILLE_TO_ARDY_LEVER) {
        if (northOfDitch() || distTo(ARDOUGNE_WILDY_LEVER.x, ARDOUGNE_WILDY_LEVER.z) <= 4) break;
        if (skipIfFarther(wp, ARDOUGNE_WILDY_LEVER)) continue;
        await walkNear(bot, sdk, wp.x, wp.z, 6);
    }
    if (distTo(ARDOUGNE_WILDY_LEVER.x, ARDOUGNE_WILDY_LEVER.z) > 3) {
        await walkNear(bot, sdk, ARDOUGNE_LEVER_DOOR.x, ARDOUGNE_LEVER_DOOR.z, 2);
        await leaveAdjacentClosedDoor(sdk);
        await walkNear(bot, sdk, ARDOUGNE_WILDY_LEVER.x, ARDOUGNE_WILDY_LEVER.z, 1);
    }
    for (let i = 0; i < 6 && !northOfDitch(); i++) {
        await leaveAdjacentClosedDoor(sdk);
        await dismissLeverWarning();
        const pulled = await interactNamed(/^lever$/i, /pull/i, ARDOUGNE_WILDY_LEVER);
        await dismissLeverWarning();
        if (!pulled) await sdk.waitForTicks(2);
        await sdk
            .waitForCondition((s) => {
                const x = s.player?.worldX ?? 0;
                const z = s.player?.worldZ ?? 0;
                return (x >= 3140 && x <= 3170 && z >= 3910 && z <= 3940) || s.player?.isDead === true;
            }, 10_000)
            .catch(() => {});
        if (insideKeep() || nearKeepLever()) {
            log(`Ardy lever → keep (${pos().x},${pos().z})`);
            return true;
        }
    }
    return insideKeep() || nearKeepLever();
}

async function pullKeepLeverToArdy(): Promise<boolean> {
    if (inArdougne()) return true;
    if (!nearKeepLever() && !insideKeep()) {
        if (!(await enterKeepFromNorth())) return false;
    }
    intent('Pull keep lever → Ardougne');
    for (let i = 0; i < 6 && !inArdougne(); i++) {
        if (pos().inCombat) await sdk.sendWalk(DESERTED_KEEP_LEVER.x, DESERTED_KEEP_LEVER.z, true);
        await interactNamed(/^lever$/i, /pull/i, DESERTED_KEEP_LEVER);
        await sdk
            .waitForCondition((s) => {
                const x = s.player?.worldX ?? 0;
                const z = s.player?.worldZ ?? 0;
                return (x > 2500 && x < 2720 && z > 3240 && z < 3355) || s.player?.isDead === true;
            }, 8_000)
            .catch(() => {});
    }
    if (inArdougne()) log(`Keep lever → Ardougne (${pos().x},${pos().z})`);
    return inArdougne();
}

async function walkKeepRoadToLadder(): Promise<boolean> {
    if (inMembersGateCorridor()) await leaveMembersCorridor(false);
    await walkWaypointsSend(KEEP_TO_LADDER, { x: KBD_LADDER.x, z: KBD_LADDER.z - 1 });
    if (distTo(GATE.x, GATE.z) <= 8) await openNearbyGate();
    if (distTo(KBD_LADDER.x, KBD_LADDER.z) > 3) await hopToward(KBD_LADDER.x, KBD_LADDER.z - 1, 2);
    return distTo(KBD_LADDER.x, KBD_LADDER.z) <= 6;
}

async function walkLadderToKeep(): Promise<boolean> {
    if (southOfLavaMaze(pos().x, pos().z) && pos().x < KEEP_ROAD_X - 4) {
        await hopToward(LAVA_MAZE_EAST.x, LAVA_MAZE_EAST.z, 4);
    }
    if (inMembersGateCorridor()) await leaveMembersCorridor(true);
    await walkWaypointsSend(LADDER_TO_KEEP, KEEP_WEB_NORTH);
    return atKeepWeb() || northOfKeepWeb() || insideKeep();
}

async function leaveWildy(): Promise<boolean> {
    if (inKbdLair()) {
        intent('Pull exit lever');
        await interactNamed(/^lever$/i, /pull/i, EXIT_LEVER);
        await sdk
            .waitForCondition((s) => {
                const x = s.player?.worldX ?? 0;
                const z = s.player?.worldZ ?? 0;
                return z >= 10240 || s.player?.isDead === true || (x === pos().x && z !== pos().z && z < 9792);
            }, 8_000)
            .catch(() => {});
    }
    if (inLeverDungeon()) {
        intent('Climb out of KBD dungeon');
        await interactNamed(/^ladder$/i, /climb/i, { x: 3069, z: 10256 });
        await sdk
            .waitForCondition((s) => (s.player?.worldZ ?? 0) < 6400 || s.player?.isDead === true, 8_000)
            .catch(() => {});
    }
    if (!northOfDitch() && !inKbdLair() && !inLeverDungeon()) return true;
    if (session.metrics().phase !== 'escape') await session.setPhase('escape');
    if (!(await walkLadderToKeep())) return false;
    return pullKeepLeverToArdy();
}

async function climbKbdLadder(): Promise<boolean> {
    if (inLeverDungeon() || inKbdLair()) return true;
    await bot.activatePrayer('protect_from_melee').catch(() => {});
    intent('Climb KBD ladder');
    const beforeZ = pos().z;
    await interactNamed(/^ladder$/i, /climb/i, KBD_LADDER);
    await sdk
        .waitForCondition((s) => (s.player?.worldZ ?? 0) >= 10240 || s.player?.isDead === true, 8_000)
        .catch(() => {});
    const ok = inLeverDungeon();
    if (!ok && pos().z === beforeZ) {
        await sdk.sendWalk(KBD_LADDER.x, KBD_LADDER.z, true);
        await sdk.waitForTicks(2);
        await interactNamed(/^ladder$/i, /climb/i, KBD_LADDER);
        await sdk
            .waitForCondition((s) => (s.player?.worldZ ?? 0) >= 10240 || s.player?.isDead === true, 6_000)
            .catch(() => {});
    }
    await bot.deactivatePrayer('protect_from_melee').catch(() => {});
    return inLeverDungeon();
}

async function pullEntryLever(): Promise<boolean> {
    if (inKbdLair()) return true;
    intent('Pull KBD lever');
    await interactNamed(/^lever$/i, /pull/i, ENTRY_LEVER);
    await sdk.waitForCondition((s) => {
        const x = s.player?.worldX ?? 0;
        const z = s.player?.worldZ ?? 0;
        return (x >= 2688 && x < 2752 && z >= 9792 && z < 9856) || s.player?.isDead === true;
    }, 8_000).catch(() => {});
    return inKbdLair();
}

async function goToLair(): Promise<boolean> {
    if (inKbdLair()) return true;
    if (session.metrics().phase !== 'travel') await session.setPhase('travel');
    if (inLeverDungeon()) return pullEntryLever();
    if (!northOfDitch()) {
        if (!(await pullArdyLever())) return false;
    }
    if (insideKeep() || nearKeepLever() || (atKeepWeb() && pos().z < 3952)) {
        if (!(await exitKeepNorth())) return false;
    }
    if (distTo(KBD_LADDER.x, KBD_LADDER.z) > 6) {
        if (!(await walkKeepRoadToLadder())) return false;
    }
    if (!(await climbKbdLadder())) return false;
    return pullEntryLever();
}

async function withdrawCount(pattern: RegExp, want: number): Promise<void> {
    const have = sdk.getInventory().filter((i) => pattern.test(i.name)).reduce((n, i) => n + (i.count ?? 1), 0);
    const short = want - have;
    if (short <= 0) return;
    const bank = sdk.findBankItem(pattern);
    if (!bank) return;
    const r = await bot.withdrawItem(bank, short);
    log(`Withdraw ${bank.name} ${short}: ${r.success ? 'ok' : r.message}`);
}

async function bankTrip(): Promise<boolean> {
    if (session.metrics().phase !== 'bank') await session.setPhase('bank');
    if (northOfDitch() || inKbdLair() || inLeverDungeon()) {
        if (!(await leaveWildy())) return false;
    }
    if (pos().isDead) return false;
    const banks = [ARDOUGNE_BANK, YANILLE_BANK, EDGEVILLE];
    const bankTile = banks.reduce((best, tile) => (distTo(tile.x, tile.z) < distTo(best.x, best.z) ? tile : best));
    intent(`Banking at ${bankTile.x},${bankTile.z}`);
    if (distTo(bankTile.x, bankTile.z) > 8) {
        const r = await bot.walkTo(bankTile.x, bankTile.z, 3);
        if (!r.success && distTo(bankTile.x, bankTile.z) > 10) {
            session.noteFailure('bank', `walkTo bank: ${r.message}`);
            return false;
        }
    }
    const opened = await bot.openBank();
    if (!opened.success) {
        session.noteFailure('bank', `openBank: ${opened.message}`);
        return false;
    }
    const wornArrows = sdk.findEquipmentItem(ARROW);
    if (wornArrows) await bot.unequipItem(wornArrows);
    for (let i = 0; i < 16; i++) {
        const item = sdk.getInventory().find((it) => (it.count ?? 0) > 0 && !shouldKeep(it.name));
        if (!item) break;
        const r = await bot.depositItem(item, -1);
        if (!r.success && !r.partial) break;
    }
    if (sharkSlots() > FOOD_WITHDRAW) await bot.depositItem(SHARK, sharkSlots() - FOOD_WITHDRAW);
    const extraAnti = sdk.getInventory().filter((i) => ANTIPOISON.test(i.name)).length - ANTIPOISON_WITHDRAW;
    if (extraAnti > 0) await bot.depositItem(ANTIPOISON, extraAnti);
    const extraPray = sdk.getInventory().filter((i) => PRAYER_POT.test(i.name)).length - PRAYER_POT_WITHDRAW;
    if (extraPray > 0) await bot.depositItem(PRAYER_POT, extraPray);
    await withdrawCount(SHARK, FOOD_WITHDRAW);
    await withdrawCount(ANTIPOISON, ANTIPOISON_WITHDRAW);
    await withdrawCount(PRAYER_POT, PRAYER_POT_WITHDRAW);
    if (!sdk.findInventoryItem(KITCHEN_KNIFE)) await withdrawCount(KITCHEN_KNIFE, 1);
    if (count(KNIVES) < KNIFE_RESTOCK_BELOW) {
        const bankKnives = sdk.findBankItem(KNIVES);
        if (bankKnives) await bot.withdrawItem(bankKnives, Math.min(500, bankKnives.count));
    }
    for (const pattern of [FIRE_SHIELD, DHIDE_BODY, DHIDE_CHAPS, VAMBRACES, HELM, BOOTS, CHARGED_GLORY]) {
        if (sdk.findEquipmentItem(pattern) || sdk.findInventoryItem(pattern)) continue;
        const bankItem = sdk.findBankItem(pattern);
        if (bankItem) await bot.withdrawItem(bankItem, 1);
    }
    await bot.closeBank();
    await equipLoadout();
    session.noteProgress('bank', `sharks ${sharkSlots()} knives ${count(KNIVES)}`);
    log(
        `Loadout sharks=${sharkSlots()} knives=${count(KNIVES)} body=${!!sdk.findEquipmentItem(DHIDE_BODY)} ` +
            `dfs=${!!sdk.findEquipmentItem(FIRE_SHIELD)} glory=${sdk.findEquipmentItem(ANY_GLORY)?.name ?? 'none'} ` +
            `style=${wantedStyle()} slots=${occupied()}`
    );
    return sharkSlots() > 0 && count(KNIVES) > 0 && !!sdk.findEquipmentItem(FIRE_SHIELD);
}

function shouldBank(): boolean {
    if (count(KNIVES) < 20) return true;
    if (sharkSlots() < 2 && foodCount() < 2) return true;
    if (occupied() >= 26) return true;
    if (needsBankHeal(pos().hp, pos().maxHp) && foodCount() === 0) return true;
    if (!sdk.findEquipmentItem(FIRE_SHIELD) && !sdk.findInventoryItem(FIRE_SHIELD)) return true;
    return false;
}

async function waitRespawn(): Promise<void> {
    const life = pos().lifeId;
    log(`Died life ${life} @ ${pos().x},${pos().z} — waiting respawn`);
    intent('Dead — waiting respawn');
    await sdk.waitForCondition((s) => !s.player.isDead && s.player.lifeId !== life, 60_000).catch(() => {});
    await ui();
    session.noteProgress('location', 'respawn');
}

session.registerRecovery([
    {
        name: 'to_lair',
        run: async () => goToLair()
    },
    {
        name: 'bank_food',
        run: async () => bankTrip()
    }
]);
session.setAnchor(SAFESPOT.x, SAFESPOT.z);

try {
    await bot.skipTutorial();
    await ui();
    log(
        `KBD mith knives @ ${pos().x},${pos().z} | r${rangedLevel()} d${defenceLevel()} ${wantedStyle()} ` +
            `knives=${count(KNIVES)} sharks=${sharkSlots()} dfs=${!!sdk.findEquipmentItem(FIRE_SHIELD)} ` +
            `body=${!!sdk.findEquipmentItem(DHIDE_BODY)}`
    );
    if (!sdk.findEquipmentItem(FIRE_SHIELD)) {
        session.log('warn', 'No dragonfire shield worn — packing at bank first');
    }
    if (shouldBank() || sharkSlots() > FOOD_WITHDRAW + 4 || sdk.findInventoryItem(SHORTBOW) || sdk.findEquipmentItem(ARROW)) {
        await bankTrip();
    } else {
        await equipLoadout();
    }
    await session.run(async () => {
        await ui();
        await eatIfNeeded();
        await drinkAntipoison();
        await drinkPrayerIfLow();
        if (pos().isDead) {
            await waitRespawn();
            return;
        }
        if (pos().targetType === 'player' && pos().inCombat) {
            session.log('warn', `Player combat @ ${pos().x},${pos().z}`);
            await leaveWildy();
            return;
        }
        if (shouldBank()) {
            await bankTrip();
            return;
        }
        if (!inKbdLair()) {
            if (!(await goToLair())) return;
        }
        session.setAnchor(SAFESPOT.x, SAFESPOT.z);
        if (session.metrics().phase !== 'kbd') await session.setPhase('kbd');
        await lureAndKill();
    });
} finally {
    await sdk.disconnect();
}
