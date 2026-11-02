/**
 * Unicorn horns (antipoison secondary) around Seers' Village / Camelot teleport.
 * Kills unicorns (and the two non-wilderness black unicorns on the Rellekka road),
 * loots the horn, buries the bones, banks at Seers. Repeats forever.
 *
 *   bun bots/quests/unicorns.ts {botname} [--no-bury] [--no-black] [--spots=south,east] [--bank-at=N]
 *
 * Spawns (server/content/maps *.jm2 NPC sections, npc 89 = unicorn, 133 = black unicorn),
 * none of them in the wilderness:
 *   south  m42_53  (2700,3423) (2700,3442)  2 unicorns, south of Seers
 *   east   m43_54  (2783,3466) (2791,3460)  2 unicorns, Seers-Catherby road
 *   north  m42_56  (2741,3605)              1 unicorn, Rellekka road
 *   black  m42_57  (2708,3672) (2730,3659)  2 black unicorns, Rellekka road
 * The four Taverley-side unicorns (m44_52, 2838-2863,3370-3378) have no route from
 * Seers, and the m50_57 black unicorns are wilderness — neither is used.
 *
 * Both kinds are level 15/27, not aggressive, always drop a horn, respawn 180 ticks
 * and wander 17 tiles. Spot choice is greedy on ticks-per-horn: max(walk, respawn
 * still due) / spawns, plus a penalty for spots where other players were seen
 * fighting them. With only four close spawns the bot mostly cycles south <-> east and
 * goes north when those are camped.
 *
 * Wields the best melee weapon it can find (equipped, pack, Seers bank). Eats below
 * half HP; with no food left it banks for food or waits out regen at the bank.
 * SIGTERM finishes the current fight and banks (exit 0). Otherwise it never exits 0:
 * recovery exhaust is restartable (70).
 *
 * WILDERNESS MODE (opt-in only: --spots=wild, never mixed with the Seers spots):
 *   bun bots/quests/unicorns.ts jacklove11 --spots=wild [--bank-at=12]
 * The 12 m50_57 black unicorns (3209-3244, 3668-3685; wilderness level 19-21).
 * Bank: Edgeville. Route: Edgeville ditch (3088,3518/3525), then sdk.sendWalk hops
 * (never bot.walkTo north of the ditch) via 3120,3535 / 3160,3565 / 3200,3605 /
 * 3209,3640 — 27 tiles of town plus ~154 wilderness tiles, the shortest of Edgeville
 * and Varrock west/east (pathfinder: 181 vs 256+ total). Kit: the cheapest decent
 * weapon (adamant first; never dragon) and food only — everything else worn or
 * carried is banked before crossing. Horns are banked every --bank-at (default 12).
 * Any non-fleet player in view who could attack us at this wilderness level, or
 * any player hit, sends it straight back south to the bank; repeated flights back off.
 */
import { existsSync, readFileSync } from 'fs';
import { dirname, join } from 'path';
import { ActivitySession, BotSDK, deriveGatewayUrl, inWilderness } from '../../sdk/index';
import { BotActions } from '../../sdk/actions';
import { initPathfinding } from '../../sdk/pathfinding';
import { installGracefulShutdown } from '../../sdk/runner';
import { DITCH_NORTH, DITCH_SOUTH, EDGEVILLE, SEERS_BANK } from './tiles';
import { closeUi, installWaitForTicksGuard, walkNear } from './movement';
import { travelTo } from './travel';
import { foodHeal } from './food-heal';
import { tickNow, ticksToMs, untilTicks } from './lib/ticks';
import { buyAtShop } from './quest-supplies';

type Spot = { name: string; x: number; z: number; radius: number; spawns: number; target: RegExp };

const UNICORN = /^unicorn$/i;
const BLACK_UNICORN = /^black unicorn$/i;
const ALL_SPOTS: Spot[] = [
    { name: 'south', x: 2700, z: 3432, radius: 22, spawns: 2, target: UNICORN },
    { name: 'east', x: 2787, z: 3463, radius: 22, spawns: 2, target: UNICORN },
    { name: 'north', x: 2741, z: 3605, radius: 20, spawns: 1, target: UNICORN },
    { name: 'black', x: 2719, z: 3666, radius: 24, spawns: 2, target: BLACK_UNICORN },
    // WILDERNESS — opt-in only (--spots=wild). m50_57: 12 black unicorns.
    { name: 'wild', x: 3225, z: 3675, radius: 22, spawns: 12, target: BLACK_UNICORN }
];
/** Wilderness legs north of the Edgeville ditch, south to north (black-unicorns.ts route). */
const WILD_ROUTE = [
    { x: 3120, z: 3535 },
    { x: 3160, z: 3565 },
    { x: 3200, z: 3605 },
    { x: 3209, z: 3640 },
    { x: 3222, z: 3672 }
];
/** Never fight or loot deeper than this (wilderness level 22). */
const WILD_MAX_Z = 3694;
const RESPAWN_TICKS = 180;
/** Ticks-per-horn added per contended visit (other players fighting the spot's unicorns). */
const CONTENTION_PENALTY = 60;
const argv = process.argv.slice(2);
const thenIdx = argv.indexOf('--then');
const ownArgs = thenIdx >= 0 ? argv.slice(0, thenIdx) : argv;
const spotsArg = ownArgs.find((a) => a.startsWith('--spots='))?.split('=')[1];
const WILD = !!spotsArg?.split(',').includes('wild');
if (WILD && spotsArg !== 'wild') throw new Error('--spots=wild cannot be mixed with the Seers spots');
const BANK = WILD ? EDGEVILLE : SEERS_BANK;
const BANK_NAME = WILD ? 'Edgeville' : 'Seers';
/** Camelot teleport lands in front of the castle, ~30 tiles from Seers bank. */
const CAMELOT_TELEPORT = 1174;
const MAGIC_TAB = 6;
const FAR_FROM_SEERS = 250;

const HORN = /^unicorn horn$/i;
const BONES = /^bones$/i;
const LAW = /^law rune$/i;
const AIR = /^air rune$/i;
const FOOD_WITHDRAW = WILD ? 8 : 5;
/** Eat below this fraction of max HP (earlier in the wilderness: a PK can follow). */
const EAT_AT = WILD ? 0.7 : 0.5;
/** Best first; attack level each needs. */
const MAIN_WEAPONS: { pattern: RegExp; attack: number }[] = [
    { pattern: /^dragon longsword$/i, attack: 60 },
    { pattern: /^dragon scimitar$/i, attack: 60 },
    { pattern: /^dragon battleaxe$/i, attack: 60 },
    { pattern: /^rune scimitar$/i, attack: 40 },
    { pattern: /^rune longsword$/i, attack: 40 },
    { pattern: /^rune battleaxe$/i, attack: 40 },
    { pattern: /^adamant scimitar$/i, attack: 30 },
    { pattern: /^adamant longsword$/i, attack: 30 },
    { pattern: /^mithril scimitar$/i, attack: 20 },
    { pattern: /^black scimitar$/i, attack: 10 },
    { pattern: /^steel scimitar$/i, attack: 5 },
    { pattern: /^iron scimitar$/i, attack: 1 },
    { pattern: /^bronze scimitar$/i, attack: 1 }
];
/** Wilderness: cheap first, so a PK takes little. Rune only if nothing cheaper is banked; never dragon. */
const WILD_WEAPONS: { pattern: RegExp; attack: number }[] = [
    { pattern: /^adamant longsword$/i, attack: 30 },
    { pattern: /^adamant scimitar$/i, attack: 30 },
    { pattern: /^mithril (longsword|scimitar)$/i, attack: 20 },
    { pattern: /^black (longsword|scimitar)$/i, attack: 10 },
    { pattern: /^steel (longsword|scimitar)$/i, attack: 5 },
    { pattern: /^iron (longsword|scimitar)$/i, attack: 1 },
    { pattern: /^rune (scimitar|longsword)$/i, attack: 40 }
];
/**
 * `--ranged` (jacklove18, 2026-11-02): strung shortbows + iron/bronze arrows instead of melee.
 * Unstrung bows share the strung name, so bank picks go by obj id (RANGED_BOW_IDS); a bow or
 * arrows missing from the bank are bought at Hickton's in Catherby (oak shortbow, iron arrows).
 */
const RANGED = process.argv.includes('--ranged');
const RANGED_WEAPONS: { pattern: RegExp; attack: number }[] = [
    { pattern: /^magic shortbow$/i, attack: 50 },
    { pattern: /^yew shortbow$/i, attack: 40 },
    { pattern: /^maple shortbow$/i, attack: 30 },
    { pattern: /^willow shortbow$/i, attack: 20 },
    { pattern: /^oak shortbow$/i, attack: 5 },
    { pattern: /^shortbow$/i, attack: 1 },
];
/** Strung ids, same order as RANGED_WEAPONS. */
const RANGED_BOW_IDS = [861, 857, 853, 849, 843, 841];
const ARROWS = /^(iron|bronze) arrow$/i;
const HICKTON = { x: 2823, z: 3443, npc: /^hickton$/i };
const ARROW_BUY = 500;
const WEAPONS = WILD ? WILD_WEAPONS : RANGED ? RANGED_WEAPONS : MAIN_WEAPONS;
/** Never taken north of the ditch. */
const WILD_FORBIDDEN = /dragon|anti-?dragon|dragonfire/i;

const botArg = ownArgs.find((a) => !a.startsWith('-') && !a.endsWith('.ts'));
const BURY = !ownArgs.includes('--no-bury');
const BANK_AT = Number(ownArgs.find((a) => a.startsWith('--bank-at='))?.split('=')[1] ?? (WILD ? 12 : 0));
const SPOTS = ALL_SPOTS.filter((s) => {
    if (spotsArg) return spotsArg.split(',').includes(s.name);
    if (s.name === 'wild') return false;
    if (ownArgs.includes('--no-black')) return s.name !== 'black';
    return true;
});
if (!SPOTS.length) throw new Error(`--spots=${spotsArg} matches none of ${ALL_SPOTS.map((s) => s.name).join(',')}`);

function loadBotEnv(): void {
    const envPath = botArg ? join(process.cwd(), 'bots', botArg, 'bot.env') : join(dirname(import.meta.path), 'bot.env');
    if (!existsSync(envPath)) throw new Error(`bot.env not found at ${envPath}. Usage: bun bots/quests/unicorns.ts {botname}`);
    for (const line of readFileSync(envPath, 'utf-8').split('\n')) {
        const t = line.trim();
        if (!t || t.startsWith('#')) continue;
        const eq = t.indexOf('=');
        if (eq > 0) process.env[t.slice(0, eq)] = t.slice(eq + 1);
    }
}

loadBotEnv();
const username = process.env.BOT_USERNAME!;
initPathfinding();
const sdk = new BotSDK({
    botUsername: username,
    password: process.env.PASSWORD!,
    gatewayUrl: deriveGatewayUrl(process.env.SERVER),
    autoLaunchBrowser: false,
    browserLaunchTimeout: 90_000,
    readyTimeout: 45_000,
    connectTimeout: 60_000,
    showChat: false
});
await sdk.connect();
const bot = new BotActions(sdk);
const session = new ActivitySession(sdk, bot, {
    name: 'unicorns',
    grindLogPath: join(process.cwd(), 'bots', username, 'grind.log'),
    stallMs: 180_000,
    maxRecoveryTactics: 8
});
installGracefulShutdown({ graceMs: 30_000 });
installWaitForTicksGuard(sdk, session);

const spotState = new Map<string, { readyAt: number; contended: number; kills: number }>();
for (const s of SPOTS) spotState.set(s.name, { readyAt: 0, contended: 0, kills: 0 });
let current: Spot | null = null;
let kills = 0;
let looted = 0;
let buried = 0;
let bankedHorns = 0;
const startTick = tickNow(sdk);

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
        targetIndex: p?.combat?.targetIndex ?? -1
    };
}

/**
 * sdk inWilderness is z-only (z >= 3520), which flags the whole Rellekka road. The
 * game's own zones (area_wilderness wilderness_zones.dbrow: mapsquares 46_55..52_99)
 * also bound x to 2944..3391 — that is what PvP and the wilderness level use.
 */
function wildy(x: number, z: number): boolean {
    return inWilderness(x, z) && x >= 46 * 64 && x < 53 * 64;
}

/** Wilderness level as the game shows it (1 at z 3520..3527). */
function wildyLevel(z: number): number {
    return Math.floor((z - 3520) / 8) + 1;
}

function fleetNames(): Set<string> {
    try {
        const roster = JSON.parse(readFileSync(join(process.cwd(), 'bots', 'roster.json'), 'utf-8'));
        return new Set((roster.bots ?? []).map((b: { name?: string }) => (b.name ?? '').toLowerCase()).filter(Boolean));
    } catch {
        return new Set();
    }
}
const FLEET = fleetNames();

function dist(x: number, z: number): number {
    return Math.hypot(pos().x - x, pos().z - z);
}

function occupied(): number {
    return sdk.getInventory().filter((i) => (i.count ?? 0) > 0).length;
}

function count(pattern: RegExp): number {
    return sdk
        .getInventory()
        .filter((i) => pattern.test(i.name))
        .reduce((n, i) => n + (i.count ?? 1), 0);
}

function edible() {
    return sdk.getInventory().filter((i) => foodHeal(i.name) > 0);
}

function foodCount(): number {
    return edible().length;
}

function prayerXp(): number {
    return sdk.getSkillXp('Prayer') ?? 0;
}

function hpXp(): number {
    return sdk.getSkillXp('Hitpoints') ?? 0;
}

function elapsedTicks(): number {
    return Math.max(1, tickNow(sdk) - startTick);
}

function summary(): string {
    const total = bankedHorns + count(HORN);
    const perKTick = ((total * 1000) / elapsedTicks()).toFixed(1);
    return `horns ${total} (pack ${count(HORN)} banked ${bankedHorns}) kills ${kills} buried ${buried} ${perKTick}/1k ticks slots ${occupied()} food ${foodCount()}`;
}

function shouldBank(): boolean {
    if (occupied() >= 27) return true;
    if (WILD && foodCount() < 2) return true;
    if (BANK_AT > 0 && count(HORN) >= BANK_AT) return true;
    return false;
}

function inSpot(spot: Spot, x: number, z: number): boolean {
    return Math.hypot(x - spot.x, z - spot.z) <= spot.radius;
}

function atSpot(spot: Spot): boolean {
    return dist(spot.x, spot.z) <= Math.min(10, spot.radius);
}

// ---------------------------------------------------------------- weapon

function attackLevel(): number {
    return sdk.getSkill(RANGED ? 'Ranged' : 'Attack')?.baseLevel ?? 1;
}

/** Weapons the game refused to wield (e.g. dragon longsword before Lost City). */
const unwieldable = new Set<string>();

function weaponRank(name: string | undefined): number {
    if (!name || unwieldable.has(name.toLowerCase())) return WEAPONS.length;
    const i = WEAPONS.findIndex((w) => w.pattern.test(name) && w.attack <= attackLevel());
    return i < 0 ? WEAPONS.length : i;
}

function wornWeaponRank(): number {
    return Math.min(WEAPONS.length, ...sdk.getEquipment().map((e) => weaponRank(e?.name)));
}

function bestInPack() {
    return sdk
        .getInventory()
        .filter((i) => weaponRank(i.name) < WEAPONS.length)
        .sort((a, b) => weaponRank(a.name) - weaponRank(b.name))[0];
}

async function wieldBestInPack(): Promise<void> {
    for (let i = 0; i < 4; i++) {
        const item = bestInPack();
        if (!item || weaponRank(item.name) >= wornWeaponRank()) return;
        await sdk.waitForTicks(1).catch(() => {});
        const r = await bot.equipItem(item);
        if (r.success) {
            log(`Wielded ${item.name}`);
            return;
        }
        // Usually a quest requirement; skip it from now on (it is banked next trip).
        session.log('warn', `Equip ${item.name} failed: ${r.message} — not using it`);
        unwieldable.add(item.name.toLowerCase());
    }
}

function quiverCount(): number {
    return sdk.getEquipment().filter((e) => e && ARROWS.test(e.name)).reduce((n, e) => n + (e!.count ?? 1), 0);
}

/** Bow worn and arrows in the quiver; what is missing is bought at Hickton's (Catherby). */
async function rangedKit(): Promise<void> {
    const strungWorn = () => sdk.getEquipment().some((e) => e && RANGED_BOW_IDS.includes(e.id));
    const needBow = !strungWorn() && !sdk.getInventory().some((i) => RANGED_BOW_IDS.includes(i.id));
    const needArrows = quiverCount() + count(ARROWS) < 50;
    if (needBow || needArrows) {
        const items = [
            ...(needBow ? [{ pattern: attackLevel() >= 5 ? /^oak shortbow$/i : /^shortbow$/i, amount: 1, label: 'bow' }] : []),
            ...(needArrows ? [{ pattern: /^iron arrow$/i, amount: ARROW_BUY, label: 'iron arrows' }] : []),
        ];
        log(`ranged kit short (${items.map((i) => i.label).join(', ')}): Hickton's, Catherby`);
        await buyAtShop(
            { bot, sdk, log, intent: () => undefined, walkNear: (x: number, z: number, t = 3) => walkNear(bot, sdk, x, z, t), closeUi: () => closeUi(bot, sdk) },
            HICKTON,
            items
        ).catch((e) => session.log('warn', `Hickton: ${e instanceof Error ? e.message : String(e)}`));
        await closeUi(bot, sdk);
    }
    const bow = sdk.getInventory().find((i) => RANGED_BOW_IDS.includes(i.id));
    if (bow && !strungWorn()) await bot.equipItem(bow).catch(() => undefined);
    const arrows = sdk.findInventoryItem(ARROWS);
    if (arrows) await bot.equipItem(arrows).catch(() => undefined);
    if (!strungWorn()) session.log('warn', 'ranged: no strung bow worn');
}

function isKeptWeapon(name: string): boolean {
    return weaponRank(name) < WEAPONS.length && weaponRank(name) <= weaponRank(bestInPack()?.name);
}

// ---------------------------------------------------------------- eating

async function eatIfNeeded(): Promise<void> {
    const p = pos();
    if (p.hp >= Math.max(8, Math.ceil(p.maxHp * EAT_AT))) return;
    const food = edible().sort((a, b) => foodHeal(a.name) - foodHeal(b.name))[0];
    if (!food) return;
    const r = await bot.eatFood(food);
    if (r.success) {
        session.noteProgress('inventory', 'eat');
        log(`Ate ${food.name} +${r.hpGained} HP ${pos().hp}/${pos().maxHp} food=${foodCount()}`);
    }
}

function tooHurt(): boolean {
    const p = pos();
    return foodCount() === 0 && p.hp < Math.ceil(p.maxHp * (WILD ? 0.6 : 0.35));
}

// ---------------------------------------------------------------- wilderness

function norm(name: string): string {
    return name.toLowerCase().replace(/[\s_]/g, '');
}
const FLEET_NORM = new Set([...FLEET].map(norm));

/** A non-fleet player in view who could attack us here (combat gap <= wilderness level). */
function threat() {
    const p = pos();
    if (!wildy(p.x, p.z)) return null;
    const me = norm(username);
    const myCb = sdk.getState()?.player?.combatLevel ?? 3;
    return (
        (sdk.getNearbyPlayers() ?? []).find((pl) => {
            const n = norm(pl.name ?? '');
            if (!n || n === me || FLEET_NORM.has(n)) return false;
            if (!wildy(pl.x, pl.z)) return false;
            const lvl = Math.min(wildyLevel(p.z), wildyLevel(pl.z));
            return Math.abs((pl.combatLevel ?? 0) - myCb) <= lvl + 2 && (pl.distance ?? 99) <= 24;
        }) ?? null
    );
}

function danger(): string | null {
    if (!WILD || !wildy(pos().x, pos().z)) return null;
    const p = pos();
    if (p.inCombat && p.targetType === 'player') return 'attacked by a player';
    const t = threat();
    if (t) return `${t.name} (cb ${t.combatLevel}) ${Math.round(t.distance ?? 0)} tiles`;
    return null;
}

let flights = 0;
let lastFlightTick = -1_000_000;

/** One leg in <=12-tile sendWalk hops (never bot.walkTo north of the ditch). */
async function wildHop(x: number, z: number, north: boolean): Promise<boolean> {
    for (let i = 0; i < 30 && !pos().isDead; i++) {
        const d = dist(x, z);
        if (d <= 4) return true;
        if (north && danger()) return false;
        if (!north && pos().hp < Math.ceil(pos().maxHp * 0.5)) await eatIfNeeded();
        // Aggressive skeletons by the ditch: auto-retaliate pins us in place, so finish the
        // fight (they are level 25) rather than re-sending walks that never land.
        if (pos().inCombat && pos().targetType === 'npc') {
            await untilTicks(sdk, () => !pos().inCombat || pos().isDead || (north && !!danger()), 40);
            await eatIfNeeded();
            continue;
        }
        const step = Math.min(12, d);
        const tx = Math.round(pos().x + ((x - pos().x) / d) * step);
        const tz = Math.round(pos().z + ((z - pos().z) / d) * step);
        const sx = pos().x;
        const sz = pos().z;
        await sdk.sendWalk(tx, tz, true);
        await untilTicks(sdk, () => Math.hypot(pos().x - tx, pos().z - tz) <= 2 || pos().isDead || pos().inCombat, step * 2 + 4);
        if (pos().x === sx && pos().z === sz && !pos().inCombat) {
            // Blocked straight line: side-step and let the next hop re-aim.
            await sdk.sendWalk(sx + (i % 2 === 0 ? 3 : -3), sz + (z > sz ? 2 : -2), true);
            await sdk.waitForTicks(3).catch(() => {});
        }
    }
    return dist(x, z) <= 6;
}

async function crossDitch(northward: boolean): Promise<boolean> {
    const done = () => (northward ? pos().z >= 3520 : pos().z < 3520) || pos().isDead;
    if (done()) return true;
    const to = northward ? DITCH_NORTH : DITCH_SOUTH;
    intent(`Crossing the Edgeville ditch ${northward ? 'north' : 'south'}`);
    for (let i = 0; i < 3 && !done(); i++) {
        await sdk.sendWalk(to.x, to.z, true);
        await untilTicks(sdk, done, 20);
    }
    return done();
}

async function leaveWild(): Promise<boolean> {
    if (!wildy(pos().x, pos().z)) return true;
    if (session.metrics().phase !== 'escape') await session.setPhase('escape');
    intent('Leaving the wilderness');
    // Two passes: a skeleton fight on the way can use up one leg's hops.
    for (let pass = 0; pass < 2 && wildy(pos().x, pos().z) && !pos().isDead; pass++) {
        const south = [...WILD_ROUTE].reverse().filter((w) => w.z < pos().z - 4);
        for (const wp of [...south, DITCH_NORTH]) {
            if (!wildy(pos().x, pos().z) || pos().isDead) break;
            await wildHop(wp.x, wp.z, false);
        }
        await crossDitch(false);
    }
    const ok = !wildy(pos().x, pos().z);
    if (!ok && !pos().isDead) session.noteFailure('ditch', `still in the wilderness @ ${pos().x},${pos().z}`);
    return ok;
}

async function flee(reason: string): Promise<void> {
    flights++;
    lastFlightTick = tickNow(sdk);
    session.log('warn', `FLEE (${reason}) @ ${pos().x},${pos().z} wildy L${wildyLevel(pos().z)} flight ${flights} | ${summary()}`);
    await eatIfNeeded();
    await leaveWild();
    current = null;
}

/** Only the weapon (cheap, never dragon) and food north of the ditch. */
function kitSafe(): boolean {
    for (const e of sdk.getEquipment()) {
        if (!e?.name) continue;
        if (WILD_FORBIDDEN.test(e.name) || weaponRank(e.name) >= WEAPONS.length) return false;
    }
    return sdk
        .getInventory()
        .every((i) => !i.name || foodHeal(i.name) > 0 || HORN.test(i.name) || BONES.test(i.name) || (!WILD_FORBIDDEN.test(i.name) && weaponRank(i.name) < WEAPONS.length));
}

/** Take off everything but a cheap first-choice weapon, so the bank trip deposits it. */
async function stripForWild(): Promise<void> {
    for (const e of sdk.getEquipment()) {
        if (!e?.name) continue;
        if (!WILD_FORBIDDEN.test(e.name) && weaponRank(e.name) === 0) continue;
        if (occupied() >= 27) break;
        const r = await bot.unequipItem(e);
        if (!r.success) session.log('warn', `Unequip ${e.name} failed: ${r.message}`);
        else log(`Took off ${e.name} (not taken into the wilderness)`);
    }
}

async function goWild(spot: Spot): Promise<boolean> {
    if (!wildy(pos().x, pos().z)) {
        const wait = 100 * Math.min(flights, 6) - (tickNow(sdk) - lastFlightTick);
        if (flights > 0 && wait > 0) {
            intent(`Waiting ${wait}t at the bank after flight ${flights}`);
            log(`Backing off ${wait}t after ${flights} flight(s)`);
            await untilTicks(sdk, () => false, wait);
        }
        if (!kitSafe()) {
            session.log('warn', 'Kit not wilderness-safe — banking first');
            await bankTrip();
            if (!kitSafe()) {
                session.noteFailure('kit', 'cannot make the kit wilderness-safe');
                await sdk.waitForTicks(50).catch(() => {});
                return false;
            }
        }
        if (dist(DITCH_SOUTH.x, DITCH_SOUTH.z) > 6 && !(await walkTo(DITCH_SOUTH.x, DITCH_SOUTH.z, 3))) return false;
        if (!(await crossDitch(true))) {
            session.noteFailure('ditch', `could not cross north @ ${pos().x},${pos().z}`);
            return false;
        }
    }
    for (const wp of WILD_ROUTE) {
        if (wp.z <= pos().z + 4 && dist(spot.x, spot.z) < Math.hypot(wp.x - spot.x, wp.z - spot.z) + 4) continue;
        const why = danger();
        if (why) {
            await flee(why);
            return false;
        }
        if (!(await wildHop(wp.x, wp.z, true))) {
            const d = danger();
            if (d) await flee(d);
            return false;
        }
    }
    log(`At wild unicorns @ ${pos().x},${pos().z} wildy L${wildyLevel(pos().z)}`);
    return atSpot(spot) || (await wildHop(spot.x, spot.z, true));
}

// ---------------------------------------------------------------- travel

async function walkTo(x: number, z: number, tolerance: number): Promise<boolean> {
    if (dist(x, z) <= tolerance) return true;
    if (wildy(pos().x, pos().z) || wildy(x, z)) return wildHop(x, z, wildy(x, z) && z > pos().z);
    // Level-up dialogs (Prayer from burying) block walking; travelTo does not dismiss them.
    await closeUi(bot, sdk);
    if (await walkNear(bot, sdk, x, z, tolerance)) return true;
    if (pos().level > 0 || dist(x, z) > tolerance) {
        const r = await travelTo(sdk, bot, { x, z }, { tolerance, log: (m) => log(`travel: ${m}`) });
        if (r.ok) return true;
        await closeUi(bot, sdk);
        await walkNear(bot, sdk, x, z, tolerance);
    }
    return dist(x, z) <= tolerance + 2;
}

async function teleportCamelotIfFar(): Promise<void> {
    if (WILD || dist(BANK.x, BANK.z) <= FAR_FROM_SEERS) return;
    const magic = sdk.getSkill('Magic')?.baseLevel ?? 1;
    if (magic < 45 || count(LAW) < 1 || count(AIR) < 5 || wildy(pos().x, pos().z)) return;
    intent('Camelot teleport');
    await closeUi(bot, sdk);
    await sdk.sendSetTab(MAGIC_TAB).catch(() => {});
    await sdk.waitForTicks(1).catch(() => {});
    await sdk.sendClickComponent(CAMELOT_TELEPORT);
    const ok = await untilTicks(sdk, () => dist(BANK.x, BANK.z) < 80, 12);
    log(ok ? `Camelot teleport -> ${pos().x},${pos().z}` : 'Camelot teleport did not land');
}

// ---------------------------------------------------------------- bank

async function goToBank(): Promise<boolean> {
    await closeUi(bot, sdk);
    if (wildy(pos().x, pos().z) && !(await leaveWild())) return false;
    await teleportCamelotIfFar();
    intent(`Walking to ${BANK_NAME} bank`);
    session.setAnchor(BANK.x, BANK.z);
    await walkTo(BANK.x, BANK.z, 4);
    return dist(BANK.x, BANK.z) <= 10;
}

async function bankTrip(): Promise<boolean> {
    if (session.metrics().phase !== 'bank') await session.setPhase('bank');
    if (!(await goToBank())) {
        session.noteFailure('bank_walk', `Could not reach ${BANK_NAME} bank from ${pos().x},${pos().z}`);
        return false;
    }
    if (WILD) {
        await closeUi(bot, sdk);
        await stripForWild();
    }
    if (!(sdk.getState()?.bank?.isOpen || (await bot.openBank()).success)) {
        session.noteFailure('bank_open', `${BANK_NAME} bank open failed`);
        return false;
    }
    const before = count(HORN);
    for (let i = 0; i < 40; i++) {
        const item = sdk
            .getInventory()
            .find(
                (it) =>
                    (it.count ?? 0) > 0 &&
                    foodHeal(it.name) <= 0 &&
                    !(RANGED && ARROWS.test(it.name)) &&
                    (WILD ? WILD_FORBIDDEN.test(it.name) || weaponRank(it.name) > 0 || !isKeptWeapon(it.name) : !isKeptWeapon(it.name) && !LAW.test(it.name) && !AIR.test(it.name))
            );
        if (!item) break;
        if (HORN.test(item.name)) session.recordGain(item.name, item.count ?? 1);
        const r = await bot.depositItem(item, -1);
        if (!r.success && !r.partial) break;
    }
    const deposited = before - count(HORN);
    if (deposited > 0) {
        bankedHorns += deposited;
        session.recordTrip(deposited);
    }
    // Best weapon: bank stock beats what is worn only if it ranks higher.
    const bankWeapon = WEAPONS.map((w, i) => ({
        i,
        item: w.attack > attackLevel() ? null : RANGED ? (sdk.getBankItems() ?? []).find((b) => b.id === RANGED_BOW_IDS[i] && b.count > 0) ?? null : sdk.findBankItem(w.pattern),
    })).find(
        (b) => b.item && !unwieldable.has(b.item.name.toLowerCase())
    );
    if (bankWeapon?.item && bankWeapon.i < wornWeaponRank() && bankWeapon.i < weaponRank(bestInPack()?.name)) {
        await bot.withdrawItem(bankWeapon.item, 1, { asNote: false });
        await untilTicks(sdk, () => !!bestInPack(), 6);
    }
    if (RANGED) {
        const arrows = sdk.findBankItem(/^iron arrow$/i) ?? sdk.findBankItem(/^bronze arrow$/i);
        if (arrows) await bot.withdrawItem(arrows, arrows.count);
        const coins = sdk.findBankItem(/^coins$/i);
        const noBow = !bankWeapon?.item && wornWeaponRank() >= WEAPONS.length && !bestInPack();
        if ((noBow || (!arrows && quiverCount() < 50)) && coins) await bot.withdrawItem(coins, Math.min(coins.count, 15_000));
    }
    const haveFood = foodCount();
    if (haveFood < FOOD_WITHDRAW) {
        const food = sdk
            .getState()
            ?.bank?.items?.filter((b) => foodHeal(b.name) > 0 && (b.count ?? 0) > 0)
            .sort((a, b) => foodHeal(a.name) - foodHeal(b.name))[0];
        if (food) await bot.withdrawItem(food, Math.min(FOOD_WITHDRAW - haveFood, food.count ?? 0));
    }
    session.captureBankStock();
    await bot.closeBank();
    await closeUi(bot, sdk);
    await wieldBestInPack();
    if (RANGED) await rangedKit();
    session.noteProgress('bank', BANK_NAME);
    if (WILD && deposited > 0 && flights > 0 && tickNow(sdk) - lastFlightTick > 600) flights = 0;
    log(`Banked ${deposited} horns | trip ${session.metrics().trips} | ${summary()}`);
    return !shouldBank();
}

async function restAtBank(): Promise<void> {
    if (!(await goToBank())) return;
    intent(`Out of food: regenerating at ${BANK_NAME} bank`);
    log(`Resting at bank HP ${pos().hp}/${pos().maxHp} (no food)`);
    await untilTicks(sdk, () => pos().hp >= Math.ceil(pos().maxHp * 0.8), 600);
    session.noteProgress('location', 'rested');
}

// ---------------------------------------------------------------- hunting

function chooseSpot(): Spot {
    const now = tickNow(sdk);
    let best: Spot = SPOTS[0]!;
    let bestScore = Infinity;
    for (const s of SPOTS) {
        const st = spotState.get(s.name)!;
        const walk = s === current && atSpot(s) ? 0 : Math.hypot(pos().x - s.x, pos().z - s.z);
        const wait = Math.max(walk, st.readyAt - now);
        const score = wait / s.spawns + st.contended * CONTENTION_PENALTY;
        if (score < bestScore) {
            bestScore = score;
            best = s;
        }
    }
    return best;
}

function mine(n: { index: number }): boolean {
    const p = pos();
    return p.targetType === 'npc' && p.targetIndex === n.index;
}

/** Someone else is on it: in combat, or damaged in the last few ticks, and not by us. */
function busyElsewhere(n: { index: number; inCombat: boolean; lastCombatTick: number | null; hp: number | null; maxHp: number | null }): boolean {
    if (mine(n)) return false;
    if (n.inCombat) return true;
    if (n.lastCombatTick !== null && (sdk.getState()?.tick ?? 0) - n.lastCombatTick < 10) return true;
    return n.hp !== null && n.maxHp !== null && n.hp < n.maxHp;
}

function spotNpcs(spot: Spot) {
    return (sdk.getNearbyNpcs() ?? []).filter(
        (n) =>
            spot.target.test(n.name) &&
            (n.hp === null || n.hp > 0) &&
            n.optionsWithIndex.some((o) => /attack/i.test(o.text)) &&
            inSpot(spot, n.x, n.z) &&
            (spot.name === 'wild' ? n.z <= WILD_MAX_Z : !wildy(n.x, n.z))
    );
}

function findTarget(spot: Spot) {
    return (
        spotNpcs(spot)
            .filter((n) => n.reachable !== false && !busyElsewhere(n))
            .sort((a, b) => (mine(a) ? 0 : 1) - (mine(b) ? 0 : 1) || (a.distance ?? 99) - (b.distance ?? 99))[0] ?? null
    );
}

async function buryBones(): Promise<void> {
    if (!BURY) return;
    for (let i = 0; i < 4; i++) {
        const bone = sdk.findInventoryItem(BONES);
        const op = bone?.optionsWithIndex.find((o) => /bury/i.test(o.text));
        if (!bone || !op) return;
        const xp = prayerXp();
        await sdk.sendUseItem(bone.slot, op.opIndex);
        if (await untilTicks(sdk, () => prayerXp() > xp || !sdk.getInventory().some((it) => it.slot === bone.slot && BONES.test(it.name)), 4)) {
            buried++;
        }
        await sdk.waitForTicks(1).catch(() => {});
    }
}

function isLoot(name: string): boolean {
    return HORN.test(name) || (BURY && BONES.test(name)) || (RANGED && ARROWS.test(name));
}

async function loot(spot: Spot): Promise<void> {
    for (let i = 0; i < 6; i++) {
        if (pos().isDead || danger()) return;
        let ground = sdk.getGroundItems() ?? [];
        if (i === 0) {
            const scanned = await sdk.scanGroundItems(10).catch(() => null);
            if (scanned) ground = scanned;
        }
        // A horn always takes a slot; bones only while there's room to spare (they get buried).
        const free = 28 - occupied();
        const item = ground
            .filter(
                (g) =>
                    isLoot(g.name) &&
                    g.reachable !== false &&
                    (g.distance ?? 99) <= 10 &&
                    (inSpot(spot, g.x, g.z) || (g.distance ?? 99) <= 4) &&
                    (spot.name !== 'wild' || g.z <= WILD_MAX_Z) &&
                    (HORN.test(g.name) ? free >= 1 : free >= 2)
            )
            .sort((a, b) => (HORN.test(a.name) ? 0 : 1) - (HORN.test(b.name) ? 0 : 1) || (a.distance ?? 99) - (b.distance ?? 99))[0];
        if (!item) return;
        const pattern = HORN.test(item.name) ? HORN : RANGED && ARROWS.test(item.name) ? ARROWS : BONES;
        const before = count(pattern);
        intent(`Loot ${item.name} @ ${item.x},${item.z}`);
        const r = await bot.pickupItem(item);
        const got = await untilTicks(sdk, () => count(pattern) > before || pos().isDead, 12);
        if (RANGED && pattern === ARROWS && got) {
            const a = sdk.findInventoryItem(ARROWS);
            if (a) await bot.equipItem(a).catch(() => undefined);
        }
        if (!got) {
            if (!r.success) session.noteFailure('loot', r.message);
            return;
        }
        session.noteProgress('inventory', item.name);
        if (pattern === HORN) {
            looted++;
            log(`Horn @ ${spot.name}${wildy(pos().x, pos().z) ? ` wildy L${wildyLevel(pos().z)}` : ''} | ${summary()}`);
        } else {
            await buryBones();
        }
    }
}

async function fightOne(spot: Spot, target: NonNullable<ReturnType<typeof findTarget>>): Promise<boolean> {
    const xpBefore = hpXp();
    intent(`Attack ${target.name} @ ${target.x},${target.z} (${spot.name})`);
    session.setAnchor(target.x, target.z);
    if (wildy(pos().x, pos().z) && (target.distance ?? 99) > 5) await wildHop(target.x, target.z, true);
    if (danger()) return false;
    const r = await bot.attack(target, ticksToMs(20));
    if (!r.success) {
        session.noteFailure('attack', r.message);
        return false;
    }
    // Black unicorns flee: re-attack while it is alive, still in the spot and nobody else took it.
    for (let t = 0; t < 150 && !pos().isDead; ) {
        await eatIfNeeded();
        if (danger()) return false;
        const live = sdk.getNearbyNpcs().find((n) => n.index === target.index);
        if (!live || (live.hp !== null && live.hp <= 0)) break;
        if (!inSpot(spot, live.x, live.z) && (live.distance ?? 99) > 6) break;
        if (spot.name === 'wild' && live.z > WILD_MAX_Z) break;
        if (!mine(live) && !pos().inCombat) {
            if (busyElsewhere(live) && live.inCombat) break;
            await bot.attack(live, ticksToMs(12)).catch(() => null);
        }
        await sdk.waitForTicks(1);
        t++;
        if (!sdk.getNearbyNpcs().some((n) => n.index === target.index && (n.hp === null || n.hp > 0))) break;
    }
    const killed = hpXp() > xpBefore && !sdk.getNearbyNpcs().some((n) => n.index === target.index && (n.hp === null || n.hp > 0));
    if (killed) {
        kills++;
        const st = spotState.get(spot.name)!;
        st.kills++;
        session.noteProgress('xp', `kill ${spot.name}`);
        await untilTicks(sdk, () => (sdk.getGroundItems() ?? []).some((g) => HORN.test(g.name) && (g.distance ?? 99) <= 10), 6);
    }
    await loot(spot);
    return killed;
}

/** Fight everything free at a spot, then mark when it will next have unicorns. */
async function huntSpot(spot: Spot): Promise<void> {
    const st = spotState.get(spot.name)!;
    let firstKill: number | null = null;
    let sawBusy = false;
    for (let round = 0; round < 12 && !session.isStoppedOrRequested(); round++) {
        if (pos().isDead || shouldBank() || tooHurt() || danger()) return;
        await eatIfNeeded();
        await loot(spot);
        const target = findTarget(spot);
        if (!target) {
            if (spotNpcs(spot).some((n) => busyElsewhere(n))) sawBusy = true;
            // Wandering unicorns may be just out of view of the spot centre.
            if (round === 0 && dist(spot.x, spot.z) > 4) {
                if (spot.name === 'wild') await wildHop(spot.x, spot.z, true);
                else await walkTo(spot.x, spot.z, 3);
                continue;
            }
            break;
        }
        if (await fightOne(spot, target)) {
            if (firstKill === null) firstKill = tickNow(sdk);
        }
    }
    const now = tickNow(sdk);
    st.readyAt = (firstKill ?? now - RESPAWN_TICKS / 2) + RESPAWN_TICKS;
    if (sawBusy && firstKill === null) st.contended = Math.min(st.contended + 1, 5);
    else if (firstKill !== null) st.contended = Math.max(0, st.contended - 1);
    if (sawBusy) log(`Spot ${spot.name} contested (level ${st.contended})`);
}

async function hunt(): Promise<void> {
    const spot = chooseSpot();
    if (spot !== current || !atSpot(spot)) {
        if (session.metrics().phase !== 'travel') await session.setPhase('travel');
        intent(`Walking to ${spot.name} unicorns @ ${spot.x},${spot.z}`);
        session.setAnchor(spot.x, spot.z);
        current = spot;
        if (!(spot.name === 'wild' ? await goWild(spot) : await walkTo(spot.x, spot.z, 6))) {
            if (spot.name === 'wild') {
                current = null;
                return;
            }
            session.noteFailure('spot_walk', `Could not reach ${spot.name} from ${pos().x},${pos().z}`);
            // Try another spot next round instead of hammering the same route.
            spotState.get(spot.name)!.readyAt = tickNow(sdk) + RESPAWN_TICKS;
            current = null;
            await sdk.waitForTicks(3).catch(() => {});
            return;
        }
        session.noteProgress('location', spot.name);
    }
    if (session.metrics().phase !== 'hunt') await session.setPhase('hunt');
    const st = spotState.get(spot.name)!;
    if (!findTarget(spot) && st.readyAt > tickNow(sdk)) {
        // Nothing here yet and this is still the best spot: wait in short slices so a
        // wandering or respawned unicorn is picked up as soon as it appears.
        await untilTicks(sdk, () => !!findTarget(spot) || !!danger(), Math.min(30, st.readyAt - tickNow(sdk)));
        if (!findTarget(spot)) return;
    }
    await huntSpot(spot);
}

session.registerRecovery([
    {
        name: 'bank_if_full',
        run: async () => {
            if (!shouldBank()) return false;
            return bankTrip();
        }
    },
    {
        name: 'walk_bank',
        run: async () => goToBank()
    }
]);

try {
    await bot.skipTutorial();
    await closeUi(bot, sdk);
    log(
        `Unicorns start @ ${pos().x},${pos().z} HP ${pos().hp}/${pos().maxHp} attack ${attackLevel()} ` +
            `weapon=${sdk.getEquipment().find((e) => weaponRank(e?.name) < WEAPONS.length)?.name ?? 'none'} ` +
            `spots=${SPOTS.map((s) => s.name).join(',')} bury=${BURY} | ${summary()}`
    );
    if (wildy(pos().x, pos().z) && !WILD) session.stop('wilderness', `started in the wilderness @ ${pos().x},${pos().z}`, { restartable: true });
    if (WILD) {
        log(`WILDERNESS mode: Edgeville bank, bank every ${BANK_AT} horns, fleet ${FLEET.size} names ignored`);
        if (wildy(pos().x, pos().z)) await leaveWild();
        if (!kitSafe() || foodCount() < FOOD_WITHDRAW / 2 || wornWeaponRank() > 0) await bankTrip();
    } else {
        await wieldBestInPack();
        // Kit up first if the bank may hold a better weapon or food.
        if (!session.isStopped() && (wornWeaponRank() > 3 || foodCount() === 0)) await bankTrip();
    }

    while (!session.isStoppedOrRequested()) {
        if (session.needsRecovery()) {
            if ((await session.recover()) === 'exhausted') break;
            continue;
        }
        session.maybeHeartbeat();
        if (pos().isDead) {
            await untilTicks(sdk, () => !pos().isDead, 100);
            await sdk.waitForTicks(3).catch(() => {});
            log(`Respawned @ ${pos().x},${pos().z}`);
            current = null;
            continue;
        }
        await closeUi(bot, sdk);
        await eatIfNeeded();
        if (wildy(pos().x, pos().z) && !WILD) {
            session.stop('wilderness', `in the wilderness @ ${pos().x},${pos().z}`, { restartable: true });
            break;
        }
        const why = danger();
        if (why) {
            await flee(why);
            continue;
        }
        if (shouldBank()) {
            log(`Banking | ${summary()}`);
            if (!(await bankTrip())) await sdk.waitForTicks(5).catch(() => {});
            if (WILD && foodCount() < 2 && !wildy(pos().x, pos().z)) {
                session.log('warn', `No food in the ${BANK_NAME} bank — not entering the wilderness; waiting 600t`);
                await untilTicks(sdk, () => false, 600);
            }
            current = null;
            continue;
        }
        if (tooHurt()) {
            if (!(await bankTrip()) || foodCount() === 0) await restAtBank();
            current = null;
            continue;
        }
        await hunt();
    }
    if (session.stopRequested) {
        log(`Stop requested — banking | ${summary()}`);
        await session.drainToBank(async () => {
            await bankTrip();
            return count(HORN) === 0;
        });
    }
} catch (err) {
    session.stop('script_error', err instanceof Error ? err.message : String(err));
    console.error('Script error:', err);
} finally {
    log(`stopped | ${summary()} looted ${looted}`);
    await session.finalizeStop();
    await sdk.disconnect();
}
