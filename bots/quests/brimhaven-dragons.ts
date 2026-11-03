/**
 * Iron and steel dragons in Brimhaven Dungeon: dragon platelegs, soul runes, prayer xp.
 *
 *   bun bots/quests/brimhaven-dragons.ts {botname}
 *
 * Route and obstacle tiles: learnings/brimhaven-dungeon.md (proven in-game,
 * qlck1 2026-10-31). Ardougne bank → Captain Barnaby (30gp) → Brimhaven →
 * Saniboch (875gp once per entry) → vines (axe, WC 10) → stepping stones
 * (Agility 12) → vines (WC 34) → vines (WC 34) → the dragon pit.
 *
 * Fight (metal_dragon.rs2): in melee range 3 of 4 attacks are a headbutt, which
 * Protect from Melee blanks, and 1 of 4 is dragonfire, which the dragonfire
 * shield caps. Prayer is up only while engaged. Dragon bones are buried where
 * they drop (the prayer xp is the point), the rest of the loot is kept: dragon
 * platelegs, soul runes, rune kit, bars, gems. Not wilderness: armour is worn.
 *
 * Out when food reaches LEAVE_FOOD or the pack is full: the same legs back,
 * the Exit by the entry, the customs boat to Ardougne, bank, repeat.
 */
import { ActivitySession, BotSDK, deriveGatewayUrl } from '../../sdk/index';
import { BotActions } from '../../sdk/actions';
import { initPathfinding } from '../../sdk/pathfinding';
import { existsSync, readFileSync } from 'fs';
import { dirname, join } from 'path';
import { installGracefulShutdown } from '../../sdk/runner';
import { PrayerFlicker } from './prayer-flick';
import { fetchDukeShield } from './duke-shield';
import { ensureAxeFromBob, hasAxe } from './bob-axes';
import { brewPrayerPotions } from './prayer-brew';
import { ANTIFIRE, AntifireUpkeep } from './lib/antifire';
import { requestFromMule } from './supply';
/** Last time this run asked jackthief for prayer potions. */
let lastPotAsk = 0;
/** Set when loot is picked up; cleared at the bank. */
let lootedThisTrip = false;
import { closeUi, crossGangplank, walkNear } from './movement';
import { foodHeal, healAtBank } from './food-heal';
import { ARDOUGNE_BANK, BRIMHAVEN_CUSTOMS, CAPTAIN_BARNABY } from './tiles';
import { crossAlKharidToll, inAlKharidRegion } from './alkharid-toll';
import { crossGnomeGate, inStronghold } from './lib/gnome-stronghold';
import type { Quest } from './lib/run-quest';

const SANIBOCH = { x: 2744, z: 3152 };
/** East Ardougne church altar (loc 409, maps/m40_51): a full prayer bar before every trip. */
const ARDOUGNE_ALTAR = { x: 2617, z: 3309 };
/** Seers' Village church altar (kbd-range.ts SEERS_ALTAR), a short walk from the Camelot teleport. */
const SEERS_ALTAR = { x: 2694, z: 3462 };
/**
 * No prayer potions, no trip (user, 2026-11-01): without them the bar is gone after one kill and
 * every kill cost a walk back out through the vines to an altar.
 */
const MIN_PRAYER_POTS = 2;
const DUNGEON_ENTRY = { x: 2713, z: 9564 };
const PIT = { x: 2708, z: 9442 };
const ENTRY_FEE = 875;
const BOAT_GP = 30;
const COINS_WANT = 1_000;
const FOOD_WANT = 18;
const PRAYER_POTS_WANT = 4;
const LEAVE_FOOD = 4;

/** One obstacle on the way in, crossed both ways. `inSide` is true on the dungeon-entry side. */
interface Leg {
    label: string;
    loc: RegExp;
    op: RegExp;
    /** Stand tile on the entry side, and on the pit side. */
    entrySide: { x: number; z: number };
    pitSide: { x: number; z: number };
    /** The loc to use from the pit side, when it is a different loc (the stones). */
    pitLoc?: { x: number; z: number };
    crossedIn: (x: number, z: number) => boolean;
    crossedOut: (x: number, z: number) => boolean;
}

const LEGS: Leg[] = [
    {
        label: 'vines 1',
        loc: /^vines$/i,
        op: /chop/i,
        entrySide: { x: 2691, z: 9564 },
        pitSide: { x: 2689, z: 9564 },
        crossedIn: (x) => x <= 2689,
        crossedOut: (x) => x >= 2691
    },
    {
        label: 'stepping stones',
        loc: /^stepping stone$/i,
        op: /jump/i,
        entrySide: { x: 2649, z: 9562 },
        pitSide: { x: 2647, z: 9557 },
        pitLoc: { x: 2647, z: 9558 },
        crossedIn: (_, z) => z <= 9557,
        crossedOut: (_, z) => z >= 9561
    },
    {
        label: 'vines 4',
        loc: /^vines$/i,
        op: /chop/i,
        entrySide: { x: 2674, z: 9479 },
        pitSide: { x: 2676, z: 9479 },
        crossedIn: (x) => x >= 2676,
        crossedOut: (x) => x <= 2674
    },
    {
        label: 'vines 5',
        loc: /^vines$/i,
        op: /chop/i,
        entrySide: { x: 2693, z: 9482 },
        pitSide: { x: 2695, z: 9482 },
        crossedIn: (x) => x >= 2695,
        crossedOut: (x) => x <= 2693
    }
];

const DRAGON = /^(iron|steel) dragon$/i;
const DRAGON_BONES = /^dragon bones$/i;
const COINS = /^coins$/i;
const PRAYER_POT = /^prayer potion\(\d\)$/i;
const SHIELD = /dragonfire shield|anti-?dragon/i;
/** Any axe gets through the vines (karam_dungeon.rs2 cross_vines); the best one chops fastest. */
const AXES = [/^rune axe$/i, /^adamant axe$/i, /^mithril axe$/i, /^black axe$/i, /^steel axe$/i, /^iron axe$/i, /^bronze axe$/i];
const WEAPONS = [/^dragon longsword$/i, /^dragon scimitar$/i, /^rune scimitar$/i, /^rune longsword$/i];
/** Best first in each slot. The user's tested kit: black d'hide, glory, dragon longsword. */
const ARMOUR = [
    /^(dragon|rune|adamant) (full helm|med helm)$/i,
    /^black d'?hide body$|^(rune|adamant) (platebody|chainbody)$/i,
    /^black d'?hide chaps$|^(dragon|rune|adamant) (platelegs|plateskirt)$/i,
    /^black d'?hide vamb(race)?s?$/i,
    /^amulet of glory\([1-4]\)$|^amulet of (power|strength)$/i
];
const SUPER_ATTACK = /^super attack\(\d\)$/i;
const LAW = /^law rune$/i;
const AIR = /^air rune$/i;
const EARTH = /^earth rune$/i;
import { DUELING_RING, hasDuelingRing, rubDuelingRing, wearDuelingRing } from './lib/dueling-ring';
const MAGIC_TAB = 6;
/** sdk/spells.ts: Camelot (Magic 45, 1 law 5 air), Lumbridge (Magic 31, 1 law 3 air 1 earth). */
const CAMELOT_TELEPORT = 1174;
const LUMBRIDGE_TELEPORT = 1167;
const SUPER_STRENGTH = /^super strength\(\d\)$/i;
/**
 * No iron/steel bars: every iron dragon drops 5 unnoted bars, which filled the pack and sent the
 * account banking after one kill (loadout study, 2026-11-01: 2 of 2 trips ended at 1 kill).
 */
const LOOT =
    /^(dragon (platelegs|plateskirt|med helm|spear|chainbody)|soul rune|law rune|death rune|blood rune|nature rune|rune .*|adamant(ite)? .*|runite bar|coal|uncut (sapphire|emerald|ruby|diamond|dragonstone)|clue scroll.*|half of a key|.*half of a key)$/i;

const argv = process.argv.slice(2);
const botArg = argv.find((a) => !a.startsWith('-'));

function loadBotEnv(): void {
    const envPath = botArg ? join(process.cwd(), 'bots', botArg, 'bot.env') : join(dirname(import.meta.path), 'bot.env');
    if (!existsSync(envPath)) throw new Error(`bot.env not found at ${envPath}. Usage: bun bots/quests/brimhaven-dragons.ts {botname}`);
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
    name: 'brimhaven-dragons',
    grindLogPath: join(process.cwd(), 'bots', username, 'grind.log'),
    stallMs: 240_000,
    maxRecoveryTactics: 6
});
installGracefulShutdown({ graceMs: 30_000 });

let kills = 0;
let buried = 0;

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
        hp: p?.hp ?? 10,
        maxHp: p?.maxHp ?? 10,
        isDead: p?.isDead ?? false,
        inCombat: p?.combat?.inCombat ?? false,
        targetType: p?.combat?.targetType ?? 'none',
        lifeId: p?.lifeId ?? 0
    };
}

function distTo(x: number, z: number): number {
    return Math.hypot(pos().x - x, pos().z - z);
}

function count(pattern: RegExp): number {
    return sdk
        .getInventory()
        .filter((i) => pattern.test(i.name))
        .reduce((n, i) => n + (i.count ?? 1), 0);
}

function foodCount(): number {
    return sdk.getInventory().filter((i) => foodHeal(i.name) > 0).reduce((n, i) => n + (i.count ?? 1), 0);
}

function occupied(): number {
    return sdk.getInventory().filter((i) => (i.count ?? 0) > 0).length;
}

function inDungeon(): boolean {
    return pos().z > 9000 && pos().x > 2620 && pos().x < 2780;
}

function inPit(): boolean {
    const p = pos();
    return p.z >= 9415 && p.z <= 9470 && p.x >= 2695 && p.x <= 2735;
}

function onKaramja(): boolean {
    const p = pos();
    return p.z < 9000 && p.x >= 2690 && p.x <= 2960 && p.z >= 2880 && p.z <= 3240;
}

function inArdougne(): boolean {
    const p = pos();
    return p.x >= 2560 && p.x < 2700 && p.z >= 3260 && p.z < 3340;
}

/** Which legs are behind us: the number crossed so far toward the pit, judged by position. */
function legsCrossed(): number {
    if (!inDungeon()) return -1;
    if (inPit() || LEGS[3]!.crossedIn(pos().x, pos().z) && pos().z < 9490) return 4;
    const p = pos();
    // Between stones and vines 4: west half, south of the stones.
    if (p.x < 2675 && p.z < 9557) return 2;
    // Between vines 4 and vines 5: the strip east of vines 4.
    if (p.x >= 2676 && p.x < 2695 && p.z < 9500) return 3;
    // Between vines 1 and the stones.
    if (p.x <= 2689 && p.z >= 9557) return 1;
    return 0;
}

async function eatIfNeeded(): Promise<void> {
    const p = pos();
    const danger = p.hp <= Math.floor(p.maxHp * 0.55);
    if (!danger && p.hp > p.maxHp - 22) return;
    const food = sdk.getInventory().filter((i) => foodHeal(i.name) > 0).sort((a, b) => foodHeal(b.name) - foodHeal(a.name))[0];
    if (!food) return;
    const r = await bot.eatFood(food);
    if (r.success) session.noteProgress('inventory', 'eat');
}

const antifire = new AntifireUpkeep(sdk, (m) => session.log('log', m));

async function drinkPrayerIfLow(): Promise<void> {
    const st = sdk.getPrayerState();
    if (!st || st.prayerPoints > Math.max(8, Math.floor(st.prayerLevel * 0.25))) return;
    const pot = sdk.findInventoryItem(PRAYER_POT);
    const drink = pot?.optionsWithIndex.find((o) => /drink/i.test(o.text));
    if (pot && drink) {
        await sdk.sendUseItem(pot.slot, drink.opIndex);
        await sdk.waitForTicks(2).catch(() => {});
    }
}

/** Protect from Melee, re-flicked for near-zero drain (prayer-flick.ts; user, 2026-11-01). */
const flicker = new PrayerFlicker(sdk, (m) => session.log('log', m));
let lastAttackAt = -1;

async function protectMelee(on: boolean): Promise<void> {
    flicker.set(on ? 'protect_from_melee' : null);
}

// ── bank ──────────────────────────────────────────────────────────────────────

function keep(name: string): boolean {
    return (
        COINS.test(name) ||
        foodHeal(name) > 0 ||
        PRAYER_POT.test(name) ||
        ANTIFIRE.test(name) ||
        SUPER_ATTACK.test(name) ||
        LAW.test(name) ||
        AIR.test(name) ||
        EARTH.test(name) ||
        DUELING_RING.test(name) ||
        SUPER_STRENGTH.test(name) ||
        SHIELD.test(name) ||
        AXES.some((p) => p.test(name)) ||
        WEAPONS.some((p) => p.test(name)) ||
        ARMOUR.some((p) => p.test(name))
    );
}

async function withdrawUpTo(pattern: RegExp, want: number): Promise<void> {
    const short = want - count(pattern);
    if (short <= 0) return;
    const item = sdk.findBankItem(pattern);
    if (item) await bot.withdrawItem(item, Math.min(short, item.count));
}

async function withdrawFirst(patterns: RegExp[]): Promise<void> {
    if (patterns.some((p) => sdk.findInventoryItem(p) || sdk.findEquipmentItem(p))) return;
    for (const p of patterns) {
        const item = sdk.findBankItem(p);
        if (item) {
            await bot.withdrawItem(item, 1);
            return;
        }
    }
}

async function leaveStronghold(): Promise<void> {
    const q = {
        bot,
        sdk,
        log,
        goTo: (t: { x: number; z: number }, tol = 2) => walkNear(bot, sdk, t.x, t.z, tol).then(() => undefined),
        climbTo: async (level: number) => {
            for (let i = 0; i < 4 && (sdk.getState()?.player?.level ?? 0) > level; i++) {
                const down = sdk.findNearbyLoc(/ladder|staircase|branch|rope|tree/i);
                const op = down?.optionsWithIndex.find((o) => /climb-down|climb down/i.test(o.text));
                if (!down || !op) break;
                await bot.interactLoc(down, op.text);
                await sdk.waitForTicks(4).catch(() => {});
            }
        }
    } as unknown as Quest;
    await crossGnomeGate(q, false).catch((e) => log(`stronghold: leaving: ${(e as Error).message}`));
}

async function bankTrip(): Promise<boolean> {
    await session.setPhase('bank');
    // Out by Camelot Teleport (user, 2026-11-01: teleport, not the walk back through the vines),
    // then the Seers altar and bank; the walk to Ardougne's docks follows a ready kit.
    if (inDungeon() && !(await emergencyTeleport()) && !(await leaveDungeon())) return false;
    if (onKaramja() && !(await sailToArdougne())) return false;
    if (nearSeers()) return seersBankTrip();
    // A grind handed over at Al Kharid (process-bank) starts east of the toll gate.
    if (inAlKharidRegion(pos())) await crossAlKharidToll(bot, sdk, false, { log });
    // An agility grind hands over inside the Gnome Stronghold: walkTo has no route through its gate.
    if (inStronghold(pos())) await leaveStronghold();
    intent('Banking at Ardougne');
    if (distTo(ARDOUGNE_BANK.x, ARDOUGNE_BANK.z) > 8) {
        const r = await bot.walkTo(ARDOUGNE_BANK.x, ARDOUGNE_BANK.z, 3);
        if (!r.success && distTo(ARDOUGNE_BANK.x, ARDOUGNE_BANK.z) > 10) await walkNear(bot, sdk, ARDOUGNE_BANK.x, ARDOUGNE_BANK.z, 3);
    }
    const opened = await bot.openBank();
    if (!opened.success) {
        session.noteFailure('bank', `openBank: ${opened.message}`);
        return false;
    }
    const banked: string[] = [];
    for (let i = 0; i < 28; i++) {
        const item = sdk.getInventory().find((it) => (it.count ?? 0) > 0 && !keep(it.name));
        if (!item) break;
        banked.push(`${item.name}x${item.count}`);
        const r = await bot.depositItem(item, -1);
        if (!r.success && !r.partial) break;
    }
    if (banked.length) log(`Banked loot: ${banked.join(', ')}`);
    lootedThisTrip = false;
    await healAtBank(bot, sdk, log);
    // One axe travels; spares (Bob's stock bought after a death) wait in the bank.
    const axesHeld = sdk.getInventory().filter((i) => AXES.some((a) => a.test(i.name)));
    for (const extra of axesHeld.slice(sdk.findEquipmentItem(/axe$/i) ? 0 : 1)) await bot.depositItem(extra, 1).catch(() => undefined);
    await withdrawUpTo(COINS, COINS_WANT);
    await withdrawFirst(AXES);
    await withdrawFirst(WEAPONS);
    await withdrawFirst([SHIELD]);
    for (const piece of ARMOUR) await withdrawFirst([piece]);
    await withdrawUpTo(PRAYER_POT, PRAYER_POTS_WANT);
    // Antifire: with the shield, iron/steel breath does nothing (lib/antifire.ts).
    await withdrawUpTo(ANTIFIRE, 2);
    await withdrawUpTo(SUPER_ATTACK, 1);
    // Two Camelot Teleports: the planned exit and an emergency one.
    await withdrawUpTo(LAW, 2);
    await withdrawUpTo(AIR, 10);
    await withdrawUpTo(EARTH, 1);
    if (!hasDuelingRing(sdk)) await withdrawUpTo(DUELING_RING, 1);
    await withdrawUpTo(SUPER_STRENGTH, 1);
    if (count(PRAYER_POT) < PRAYER_POTS_WANT) await brewPrayerPotions(bot, sdk, log, PRAYER_POTS_WANT - count(PRAYER_POT));
    const sharks = sdk.findBankItem(/^shark$/i) ? /^shark$/i : /^(swordfish|lobster)$/i;
    // Food fills what the kit leaves, keeping 3 slots for loot: 18 sharks on top of pots, runes,
    // a ring and boosts filled the pack and the full-pack rule banked again at once (×80, 2026-11-02).
    const nonFood = sdk.getInventory().filter((i) => (i.count ?? 0) > 0 && foodHeal(i.name) <= 0).length;
    await withdrawUpTo(sharks, Math.max(8, Math.min(FOOD_WANT, 25 - nonFood)) - (foodCount() - count(sharks)));
    await bot.closeBank();
    if (!sdk.findEquipmentItem(SHIELD) && !sdk.findInventoryItem(SHIELD)) await fetchDukeShield(bot, sdk, log);
    // No axe held or banked (lost on a death): Bob's in Lumbridge (bob-axes.ts).
    if (!hasAxe(sdk)) await ensureAxeFromBob(bot, sdk, log);
    await prayAtAltar();
    await wearDuelingRing(sdk, bot);
    for (const pattern of [...WEAPONS, SHIELD, ...ARMOUR]) {
        if (sdk.findEquipmentItem(pattern)) continue;
        const item = sdk.findInventoryItem(pattern);
        if (item) await bot.equipItem(item);
        if (WEAPONS.includes(pattern) && sdk.getEquipment().some((e) => WEAPONS.some((w) => w.test(e?.name ?? '')))) continue;
    }
    // No teleport, no trip (an emergency exit must exist before entering).
    // Camelot Teleport runes only: a ring's rub is interrupted by any hit, so it is no exit from a fight.
    const canTeleport = (sdk.getSkill('Magic')?.level ?? 1) >= 45 && count(LAW) >= 1 && count(AIR) >= 5;
    const potted = count(PRAYER_POT) >= MIN_PRAYER_POTS;
    const ready = potted && canTeleport && count(COINS) >= ENTRY_FEE + BOAT_GP * 2 && foodCount() > LEAVE_FOOD && AXES.some((p) => sdk.findInventoryItem(p) || sdk.findEquipmentItem(p)) && !!sdk.findEquipmentItem(SHIELD);
    log(`Kit coins=${count(COINS)} food=${foodCount()} pots=${count(PRAYER_POT)} shield=${!!sdk.findEquipmentItem(SHIELD)} worn=${sdk.getEquipment().filter(Boolean).map((e) => e!.name).join(',')} ready=${ready}`);
    session.noteProgress('bank', `food ${foodCount()}`);
    // jackthief, the max-stat mule, serves from this same Ardougne bank (supply.ts MULE_BANKS):
    // prayer potions, and any missing piece of the study's loadout (rune legs + berserker helm +
    // glory + dragon longsword + dragonfire shield, 2026-11-02).
    const has = (p: RegExp) => !!sdk.findEquipmentItem(p) || !!sdk.findInventoryItem(p);
    const gearMissing = [!has(SHIELD), !WEAPONS.some(has), !has(/^(rune|dragon) (platelegs|plateskirt)$/i), !has(/^(berserker|warrior|rune|dragon) (helm|full helm|med helm)$/i), !has(/^amulet of (glory|power|strength)/i)].filter(Boolean).length;
    // The trade lands in the pack: ask only for what fits (Jackpoo4's trade failed "no_space").
    const potRoom = Math.max(0, 28 - occupied() - gearMissing);
    const kitAsk = [
        ...(!potted && potRoom > 0 ? [{ label: 'prayer potion(3)', pattern: /^prayer potion\(3\)$/i, count: Math.min(9, potRoom) }] : []),
        ...(!has(SHIELD) ? [{ label: 'dragonfire shield', pattern: SHIELD, count: 1 }] : []),
        // No emergency exit: Camelot Teleport runes and a ring (ABGARMY10/Jackpoo1 had no air runes, 2026-11-02).
        ...(!canTeleport && count(AIR) < 10 ? [{ label: 'air rune', pattern: AIR, count: 200 }] : []),
        ...(!canTeleport && count(LAW) < 2 ? [{ label: 'law rune', pattern: LAW, count: 20 }] : []),
        ...(!hasDuelingRing(sdk) ? [{ label: 'ring of dueling(8)', pattern: /^ring of dueling\(8\)$/i, count: 1 }] : []),
        // jacklove16's antifire (2026-11-02): with the shield, iron/steel breath does nothing.
        ...(!count(ANTIFIRE) && potRoom > 2 ? [{ label: 'antifire potion(3)', pattern: /^antifire potion\(3\)$/i, count: 2 }] : []),
        ...(!WEAPONS.some(has) ? [{ label: 'dragon longsword', pattern: /^dragon longsword$/i, count: 1 }] : []),
        ...(!has(/^(rune|dragon) (platelegs|plateskirt)$/i) ? [{ label: 'rune platelegs', pattern: /^rune platelegs$/i, count: 1 }] : []),
        ...(!has(/^(berserker|warrior|rune|dragon) (helm|full helm|med helm)$/i) ? [{ label: 'berserker helm', pattern: /^berserker helm$/i, count: 1 }] : []),
        ...(!has(/^amulet of (glory|power|strength)/i) ? [{ label: 'amulet of glory', pattern: /^amulet of glory/i, count: 1 }] : [])
    ];
    if ((!potted || !ready) && kitAsk.length && Date.now() - lastPotAsk > 20 * 60_000) {
        lastPotAsk = Date.now();
        log(`kit short (${kitAsk.map((k) => k.label).join(', ')}): asking jackthief at the Ardougne bank`);
        const ok = await requestFromMule({ sdk, bot, session: null, log } as never, kitAsk, { mule: 'jackthief', timeoutMs: 5 * 60_000 });
        for (const pattern of [...WEAPONS, SHIELD, ...ARMOUR]) {
            if (sdk.findEquipmentItem(pattern)) continue;
            const item = sdk.findInventoryItem(pattern);
            if (item) await bot.equipItem(item).catch(() => undefined);
        }
        log(`mule jackthief: ${ok ? 'served' : 'not all served'}; pots ${count(PRAYER_POT)}`);
        return false;
    }
    if (!potted) {
        session.log('warn', `no prayer potions (${count(PRAYER_POT)} < ${MIN_PRAYER_POTS}, none to brew) — no trip; rechecking in 30 min`);
        const until = Date.now() + 30 * 60_000;
        while (Date.now() < until && !session.isStopped()) {
            session.maybeHeartbeat();
            await sdk.waitForTicks(50).catch(() => {});
        }
    } else if (!ready) {
        session.noteFailure('kit', 'missing coins, food, an axe or a dragonfire shield');
        await sdk.waitForTicks(200).catch(() => {});
    }
    return ready;
}

function nearSeers(): boolean {
    const p = pos();
    return p.z < 9000 && p.x >= 2680 && p.x <= 2780 && p.z >= 3430 && p.z <= 3520;
}

/** After a Camelot Teleport: the Seers altar, then the bank trip at Ardougne (it carries the kit). */
async function seersBankTrip(): Promise<boolean> {
    await prayAt(SEERS_ALTAR, 'Seers');
    intent('Walking to the Ardougne bank');
    const r = await bot.walkTo(ARDOUGNE_BANK.x, ARDOUGNE_BANK.z, 3);
    if (!r.success && distTo(ARDOUGNE_BANK.x, ARDOUGNE_BANK.z) > 10) await walkNear(bot, sdk, ARDOUGNE_BANK.x, ARDOUGNE_BANK.z, 3);
    return nearSeers() ? false : bankTrip();
}

/** Banking does not restore prayer: the second trip fought at 13 points and died (qlck1). */
async function prayAtAltar(): Promise<void> {
    await prayAt(ARDOUGNE_ALTAR, 'Ardougne');
}

async function prayAt(altarTile: { x: number; z: number }, where: string): Promise<void> {
    const st = sdk.getPrayerState();
    if (!st || st.prayerPoints >= st.prayerLevel) return;
    intent(`Praying at the ${where} church altar`);
    await walkNear(bot, sdk, altarTile.x - 1, altarTile.z, 2);
    await sdk.scanNearbyLocs(6).catch(() => {});
    const altar = sdk.findNearbyLoc(/^altar$/i, { withOption: /pray/i });
    const op = altar?.optionsWithIndex.find((o) => /pray/i.test(o.text));
    if (altar && op) {
        await sdk.sendInteractLoc(altar.x, altar.z, altar.id, op.opIndex);
        await sdk.waitForCondition((s) => (s.skills.find((k) => k.name === 'Prayer')?.level ?? 0) >= st.prayerLevel, 10_000).catch(() => {});
    }
    log(`Altar: prayer ${sdk.getPrayerState()?.prayerPoints}/${st.prayerLevel}`);
}

// ── travel ────────────────────────────────────────────────────────────────────

async function clickBoatDialog(): Promise<void> {
    let closed = 0;
    for (let i = 0; i < 20; i++) {
        const dialog = sdk.getDialog();
        if (!dialog?.isOpen) {
            if (++closed >= 4) return;
            await sdk.waitForTicks(1).catch(() => {});
            continue;
        }
        closed = 0;
        if (dialog.isWaiting) {
            await sdk.waitForTicks(1).catch(() => {});
            continue;
        }
        const opts = dialog.options ?? [];
        const pick =
            opts.find((o) => /search away|nothing to hide/i.test(o.text)) ||
            opts.find((o) => /can i journey|journey on this ship/i.test(o.text)) ||
            opts.find((o) => /yes please/i.test(o.text)) ||
            opts.find((o) => /pay (the )?(fare|30)|30 coins/i.test(o.text)) ||
            opts.find((o) => /ardougne/i.test(o.text) && !/unusual|customs then/i.test(o.text)) ||
            opts.find((o) => /brimhaven|karamja/i.test(o.text) && !/crandor/i.test(o.text)) ||
            opts.find((o) => /yes/i.test(o.text) && !/crandor|bother|miss/i.test(o.text)) ||
            // The customs officer's fare: "Ok." / "Oh, I'll not bother then." (probed 2026-10-31).
            opts.find((o) => /^ok\.?$/i.test(o.text.trim()));
        await sdk.sendClickDialog(pick?.index ?? opts[0]?.index ?? 0);
        await sdk.waitForTicks(1).catch(() => {});
    }
}

async function sail(npc: RegExp, arrived: () => boolean): Promise<boolean> {
    const sailor = sdk.findNearbyNpc(npc, { reachable: true }) ?? sdk.findNearbyNpc(npc);
    if (!sailor) {
        session.noteFailure('boat', `no ${npc.source} at ${pos().x},${pos().z}`);
        return false;
    }
    await bot.talkTo(sailor);
    await clickBoatDialog();
    for (let i = 0; i < 40 && !arrived() && !session.isStopped(); i++) {
        if (sdk.getDialog()?.isOpen) await clickBoatDialog();
        await crossGangplank(bot, sdk);
        await sdk.waitForTicks(2).catch(() => {});
    }
    await crossGangplank(bot, sdk);
    log(`Boat landed @ ${pos().x},${pos().z} gp=${count(COINS)}`);
    return arrived();
}

async function sailToKaramja(): Promise<boolean> {
    intent('Ardougne docks → Brimhaven');
    await walkNear(bot, sdk, CAPTAIN_BARNABY.x, CAPTAIN_BARNABY.z, 4);
    return sail(/^captain barnaby$/i, onKaramja);
}

/**
 * Walk near a Karamja tile. A run resumed on the ship's deck (ABGARMY18 at 2776,3230 after a
 * restart) has no route ashore until it crosses the gangplank.
 */
async function walkAshore(x: number, z: number, tol: number): Promise<void> {
    await walkNear(bot, sdk, x, z, tol);
    if (distTo(x, z) <= tol + 4) return;
    const plank = sdk.findNearbyLoc(/gangplank/i);
    if (!plank || Math.hypot(plank.x - pos().x, plank.z - pos().z) > 8) return;
    log(`on the ship's deck @ ${pos().x},${pos().z}: crossing the gangplank`);
    await crossGangplank(bot, sdk);
    await walkNear(bot, sdk, x, z, tol);
}

async function sailToArdougne(): Promise<boolean> {
    intent('Brimhaven customs → Ardougne');
    await walkAshore(BRIMHAVEN_CUSTOMS.x, BRIMHAVEN_CUSTOMS.z, 4);
    return sail(/^customs officer$/i, inArdougne);
}

/** Pay Saniboch and go in through the dungeon entrance. */
async function enterDungeon(): Promise<boolean> {
    intent('Paying Saniboch');
    await walkAshore(SANIBOCH.x + 1, SANIBOCH.z + 2, 2);
    const saniboch = sdk.findNearbyNpc(/^saniboch$/i);
    const pay = saniboch?.optionsWithIndex.find((o) => /^pay$/i.test(o.text));
    if (saniboch && pay) {
        await sdk.sendInteractNpc(saniboch.index, pay.opIndex);
        for (let i = 0; i < 12; i++) {
            const d = sdk.getDialog();
            if (d?.isOpen && !d.isWaiting) {
                const yes = d.options.find((o) => /875 coins/i.test(o.text) && /here/i.test(o.text));
                await sdk.sendClickDialog(yes?.index ?? d.options[0]?.index ?? 0);
            }
            await sdk.waitForTicks(1).catch(() => {});
        }
    }
    await closeUi(bot, sdk);
    await sdk.scanNearbyLocs(6).catch(() => {});
    const door = sdk.findNearbyLoc(/^dungeon entrance$/i, { withOption: /enter/i });
    const enter = door?.optionsWithIndex.find((o) => /enter/i.test(o.text));
    if (door && enter) {
        await sdk.sendInteractLoc(door.x, door.z, door.id, enter.opIndex);
        await sdk.waitForCondition((s) => (s.player?.worldZ ?? 0) > 9000, 10_000).catch(() => {});
    }
    if (!inDungeon()) session.noteFailure('entry', `not in the dungeon after paying (coins ${count(COINS)})`);
    else log(`In Brimhaven Dungeon @ ${pos().x},${pos().z} coins=${count(COINS)}`);
    return inDungeon();
}

async function crossLeg(leg: Leg, inward: boolean): Promise<boolean> {
    const stand = inward ? leg.entrySide : leg.pitSide;
    const done = () => (inward ? leg.crossedIn(pos().x, pos().z) : leg.crossedOut(pos().x, pos().z));
    if (done()) return true;
    if (distTo(stand.x, stand.z) > 2) await bot.walkTo(stand.x, stand.z, 2);
    // Off the usual line (ABGARMY08 at 2667,9538 for 2 h, 2026-11-03): no route to this leg's
    // stand, and the nearest "vines" in reach were the wrong ones. Back to where the previous leg
    // comes out, then on to the stand.
    const idx = LEGS.indexOf(leg);
    if (distTo(stand.x, stand.z) > 3 && idx > 0) {
        const prev = inward ? LEGS[idx - 1]!.pitSide : (LEGS[idx + 1]?.entrySide ?? stand);
        log(`route: ${leg.label}: no way to ${stand.x},${stand.z} from ${pos().x},${pos().z}; via ${prev.x},${prev.z}`);
        await bot.walkTo(prev.x, prev.z, 2).catch(() => undefined);
        await bot.walkTo(stand.x, stand.z, 2).catch(() => undefined);
    }
    for (let attempt = 0; attempt < 8 && !done() && !pos().isDead; attempt++) {
        if (distTo(stand.x, stand.z) > 6) break; // not at this leg: chopping other vines does nothing
        await eatIfNeeded();
        await sdk.scanNearbyLocs(6).catch(() => {});
        const near = !inward && leg.pitLoc ? leg.pitLoc : null;
        const loc = (sdk.getNearbyLocs() ?? [])
            .filter((l) => leg.loc.test(l.name) && l.optionsWithIndex.some((o) => leg.op.test(o.text)))
            .sort((a, b) => (near ? Math.hypot(a.x - near.x, a.z - near.z) - Math.hypot(b.x - near.x, b.z - near.z) : (a.distance ?? 99) - (b.distance ?? 99)))[0];
        if (!loc) {
            await sdk.waitForTicks(3).catch(() => {});
            continue;
        }
        const op = loc.optionsWithIndex.find((o) => leg.op.test(o.text))!;
        await sdk.sendInteractLoc(loc.x, loc.z, loc.id, op.opIndex);
        await sdk.waitForCondition(() => done(), 14_000).catch(() => {});
        // A fall from the stones drops you back on the entry side: walk to the stand again.
        if (!done() && distTo(stand.x, stand.z) > 3) await bot.walkTo(stand.x, stand.z, 2);
    }
    if (!done()) session.noteFailure('route', `${leg.label} ${inward ? 'in' : 'out'} not crossed @ ${pos().x},${pos().z}`);
    return done();
}

async function goToPit(): Promise<boolean> {
    await session.setPhase('travel');
    // The vines need an axe, and a death can take it (ABGARMY18 went in without one): the bank
    // trip withdraws a spare or buys Bob's stock.
    if (!hasAxe(sdk)) {
        log('no axe for the vines: banking first');
        if (!(await bankTrip()) || !hasAxe(sdk)) return false;
        await session.setPhase('travel');
    }
    if (!inDungeon()) {
        // From anywhere but Ardougne the docks walk fails (jacklove2 from the Al Kharid toll):
        // bank at Ardougne first, which also tops up the kit.
        if (!onKaramja() && !inArdougne() && !(await bankTrip())) return false;
        if (!onKaramja() && !(await sailToKaramja())) return false;
        if (!(await enterDungeon())) return false;
    }
    for (let i = Math.max(0, legsCrossed()); i < LEGS.length; i++) {
        if (!(await crossLeg(LEGS[i]!, true))) return false;
    }
    if (distTo(PIT.x, PIT.z) > 10) await bot.walkTo(PIT.x, PIT.z, 4);
    return inPit();
}

async function leaveDungeon(): Promise<boolean> {
    await protectMelee(false);
    for (let i = Math.min(LEGS.length, legsCrossed()) - 1; i >= 0; i--) {
        if (!(await crossLeg(LEGS[i]!, false))) return false;
    }
    if (distTo(DUNGEON_ENTRY.x, DUNGEON_ENTRY.z) > 3) await bot.walkTo(DUNGEON_ENTRY.x, DUNGEON_ENTRY.z, 2);
    await sdk.scanNearbyLocs(4).catch(() => {});
    const exit = sdk.findNearbyLoc(/^exit$/i, { withOption: /leave/i });
    const op = exit?.optionsWithIndex.find((o) => /leave/i.test(o.text));
    if (exit && op) {
        await sdk.sendInteractLoc(exit.x, exit.z, exit.id, op.opIndex);
        await sdk.waitForCondition((s) => (s.player?.worldZ ?? 9999) < 9000, 10_000).catch(() => {});
    }
    log(`Left the dungeon @ ${pos().x},${pos().z}`);
    return !inDungeon();
}

// ── fight ─────────────────────────────────────────────────────────────────────

/**
 * Whose dragon is it: its facing target is a player slot + 32768. A slot of someone in view is
 * another player's fight; any other player slot is ours (our own slot is never in that list).
 */
function dragonTakenByOther(n: { targetIndex: number }): boolean {
    const t = n.targetIndex ?? -1;
    return t >= 32768 && (sdk.getNearbyPlayers() ?? []).some((p) => p.index === t - 32768);
}
function dragonOnMe(n: { targetIndex: number }): boolean {
    return (n.targetIndex ?? -1) >= 32768 && !dragonTakenByOther(n);
}

function pickDragon() {
    const live = (sdk.getNearbyNpcs() ?? []).filter(
        (n) => DRAGON.test(n.name) && (n.hp === null || n.hp > 0) && n.reachable !== false && !dragonTakenByOther(n) && n.optionsWithIndex.some((o) => /attack/i.test(o.text))
    );
    // A dragon already on us comes first: single combat refuses any other ("I'm already under
    // attack!"), and Jackpoo1 kept swinging at the nearest one instead (2026-11-02).
    // Then iron first (165 hp/def against steel's 210/215): a solo rune-scimitar steel kill took
    // ~600 ticks, past one prayer bar, and the headbutts that follow it ate a trip's food.
    const iron = (n: { name: string }) => (/^iron/i.test(n.name) ? 0 : 1);
    return live.sort((a, b) => Number(dragonOnMe(b)) - Number(dragonOnMe(a)) || iron(a) - iron(b) || (a.distance ?? 99) - (b.distance ?? 99))[0] ?? null;
}

/** Bones first (the prayer xp is the point), then runes and rares, then the bars. */
function lootRank(name: string): number {
    if (DRAGON_BONES.test(name)) return 0;
    if (/rune$|^dragon |half of a key|clue/i.test(name)) return 1;
    return 2;
}

async function lootAndBury(): Promise<void> {
    // One pick per item, judged by the pack: five iron bars share one tile and id, so
    // "gone from the ground" never fired and each pick waited 5s while the pile was
    // taken (qlck1 lost the bones and 15 blood runes that way).
    for (let i = 0; i < 12; i++) {
        const ground = (sdk.getGroundItems() ?? []).filter((g) => (DRAGON_BONES.test(g.name) || LOOT.test(g.name)) && g.reachable !== false && (g.distance ?? 99) <= 8);
        const item = ground.sort((a, b) => lootRank(a.name) - lootRank(b.name) || (a.distance ?? 99) - (b.distance ?? 99))[0];
        if (!item || (occupied() >= 28 && !DRAGON_BONES.test(item.name))) break;
        const held = () => sdk.getInventory().filter((x) => x.id === item.id).reduce((n, x) => n + (x.count ?? 1), 0);
        const before = held();
        lootedThisTrip = true;
        await sdk.sendPickup(item.x, item.z, item.id);
        await sdk.waitForCondition(() => held() > before, 4_000).catch(() => {});
        if (held() > before && !DRAGON_BONES.test(item.name)) {
            log(`Loot: ${held() - before} ${item.name}`);
            session.recordGain(item.name, held() - before);
        }
        if (DRAGON_BONES.test(item.name)) await buryBones();
    }
    await buryBones();
}

async function buryBones(): Promise<void> {
    for (const bones of sdk.getInventory().filter((i) => DRAGON_BONES.test(i.name))) {
        const bury = bones.optionsWithIndex.find((o) => /bury/i.test(o.text));
        if (!bury) continue;
        await sdk.sendUseItem(bones.slot, bury.opIndex);
        await sdk.waitForTicks(2).catch(() => {});
        buried++;
    }
}

/**
 * Emergency exit (user: no deaths). Brimhaven Dungeon is not wilderness: Camelot (Seers, then the
 * walk to Ardougne) or Lumbridge Teleport lands at once. Three farm deaths were prayer running dry.
 */
async function emergencyTeleport(): Promise<boolean> {
    await protectMelee(false);
    const magic = sdk.getSkill('Magic')?.level ?? 1;
    const spell = magic >= 45 && count(LAW) >= 1 && count(AIR) >= 5 ? CAMELOT_TELEPORT : magic >= 31 && count(LAW) >= 1 && count(AIR) >= 3 && count(EARTH) >= 1 ? LUMBRIDGE_TELEPORT : 0;
    if (spell) {
        await sdk.sendSetTab(MAGIC_TAB).catch(() => {});
        await sdk.waitForTicks(1).catch(() => {});
        await sdk.sendClickComponent(spell);
    } else if (hasDuelingRing(sdk)) {
        // Last resort only: the rub's destination choice is closed by any hit (ring_of_dueling.rs2
        // p_choice3), so it cannot get out of a fight — Jackpoo1 died trying, 2026-11-02.
        await rubDuelingRing(sdk, bot, /castle wars/i, () => !inDungeon());
    } else {
        return false;
    }
    await sdk.waitForCondition((st) => (st.player?.worldZ ?? 0) < 9000, 12_000).catch(() => {});
    session.log('warn', `Emergency teleport ${inDungeon() ? 'FAILED' : 'out'} @ ${pos().x},${pos().z}`);
    return !inDungeon();
}

/** A dose of super attack / super strength when the boost has worn off: shorter kills, less prayer. */
async function boost(): Promise<void> {
    for (const [pot, skill] of [[SUPER_ATTACK, 'Attack'], [SUPER_STRENGTH, 'Strength']] as const) {
        const sk = sdk.getSkill(skill);
        if (!sk || sk.level > sk.baseLevel + 3) continue;
        const item = sdk.findInventoryItem(pot);
        const drink = item?.optionsWithIndex.find((o) => /drink/i.test(o.text));
        if (item && drink) {
            await sdk.sendUseItem(item.slot, drink.opIndex);
            await sdk.waitForTicks(2).catch(() => {});
        }
    }
}

/**
 * Stab (the longsword's Lunge): iron and steel dragons have stabdefence 50 against slashdefence 70
 * (karamja.npc), and the dragon longsword's stab bonus is 58 to slash 69, so stab lands ~8% more
 * often (attack/defence roll ratio 1.07 against 0.99).
 */
async function setStabStyle(): Promise<void> {
    const cs = sdk.getState()?.combatStyle;
    const stab = cs?.styles.find((s) => s.damageType === 'Stab');
    if (!cs || !stab || cs.currentStyle === stab.index) return;
    await sdk.sendSetCombatStyle(stab.index);
    await sdk.waitForCondition((s) => s.combatStyle?.currentStyle === stab.index, 5_000).catch(() => {});
    log(`Style ${stab.name} (stab) on ${cs.weaponName}`);
}

async function fightOne(): Promise<void> {
    const target = pickDragon();
    if (!target) {
        await protectMelee(false);
        await lootAndBury();
        if (distTo(PIT.x, PIT.z) > 8) await bot.walkTo(PIT.x, PIT.z, 4);
        await sdk.waitForTicks(3).catch(() => {});
        return;
    }
    await protectMelee(true);
    await setStabStyle();
    await boost();
    const attack = target.optionsWithIndex.find((o) => /attack/i.test(o.text))!;
    const xp0 = sdk.getSkill('Hitpoints')?.experience ?? 0;
    const started = Date.now();
    let ticks = 0;
    intent(`Fighting ${target.name}`);
    await sdk.sendInteractNpc(target.index, attack.opIndex);
    while (!pos().isDead && !session.isStopped() && Date.now() - started < 240_000) {
        const still = (sdk.getNearbyNpcs() ?? []).find((n) => n.index === target.index && DRAGON.test(n.name));
        if (!still || (still.hp !== null && still.hp <= 0)) break;
        // Another player took it, or a different dragon is on us: re-pick (the one on us first).
        if (dragonTakenByOther(still)) break;
        const attacker = (sdk.getNearbyNpcs() ?? []).find((n) => DRAGON.test(n.name) && n.index !== target.index && dragonOnMe(n) && (n.hp === null || n.hp > 0));
        if (attacker && !dragonOnMe(still)) break;
        await bot.dismissBlockingUI();
        await eatIfNeeded();
        await antifire.maybeDrink();
        await drinkPrayerIfLow();
        await protectMelee(true);
        const prayerOut = (sdk.getPrayerState()?.prayerPoints ?? 99) < 10 && !sdk.findInventoryItem(PRAYER_POT);
        // Teleport out (Camelot runes are required for the trip) at 2 food left, or low hp with no
        // prayer left — never walk out under dragons (user, 2026-11-02, after Jackpoo1's death).
        if (foodCount() <= 2 || (pos().hp < pos().maxHp * 0.5 && prayerOut)) {
            session.log('warn', `Leaving by teleport: food ${foodCount()} at ${pos().hp}/${pos().maxHp}`);
            await emergencyTeleport();
            return;
        }
        if ((sdk.getPrayerState()?.prayerPoints ?? 0) === 0 && !sdk.findInventoryItem(PRAYER_POT)) {
            session.log('warn', `Out of prayer at ${pos().hp}/${pos().maxHp} — leaving`);
            return;
        }
        // A prayer toggle cancels the attack (p_clearpendingaction): re-attack after one.
        if (!(pos().inCombat && pos().targetType === 'npc') || flicker.toggledAt >= lastAttackAt) {
            lastAttackAt = (sdk.getState()?.tick ?? 0);
            await sdk.sendInteractNpc(target.index, attack.opIndex);
        }
        if (++ticks % 20 === 0) {
            const hits = (sdk.getState()?.gameMessages ?? []).slice(-3).map((m) => m.text).join(' | ');
            log(`fight ${target.name} hp=${pos().hp}/${pos().maxHp} melee-prayer=${sdk.isPrayerActive('protect_from_melee')} pts=${sdk.getPrayerState()?.prayerPoints} shield=${!!sdk.findEquipmentItem(SHIELD)} food=${foodCount()} :: ${hits}`);
        }
        await sdk.waitForTicks(1).catch(() => {});
    }
    const xp = (sdk.getSkill('Hitpoints')?.experience ?? 0) - xp0;
    if (xp > 0 && !pos().isDead) {
        kills++;
        session.noteProgress('xp', `kill ${kills}`);
        // The drop lands a few ticks after the death animation: wait for the bones.
        await sdk.waitForCondition((st) => st.groundItems.some((g) => DRAGON_BONES.test(g.name) && Math.abs(g.x - st.player.worldX) + Math.abs(g.z - st.player.worldZ) <= 10), 8_000).catch(() => {});
        await lootAndBury();
        log(`${target.name} dead (#${kills}) in ${Math.round((Date.now() - started) / 1000)}s +${xp} hp xp food=${foodCount()} buried=${buried} prayer=${sdk.getPrayerState()?.prayerPoints}`);
    }
}

function shouldBank(): boolean {
    if (foodCount() <= LEAVE_FOOD) return true;
    // Without prayer the headbutts land, and an iron kill costs ~90 points (qlck1: 99 -> 9).
    // Out before starting a fight the bar cannot finish: a second fight at 7 points died.
    const st = sdk.getPrayerState();
    // On prod a dragon-longsword iron kill takes 120-180s, past a 79-point bar (ABGARMY18 died
    // with prayer 0 after kill #2): without a potion, only a near-full bar starts a fight.
    if (inPit() && st && st.prayerPoints < st.prayerLevel * 0.9 && !sdk.findInventoryItem(PRAYER_POT)) return true;
    // Full of LOOT, not of kit: only after something was picked up this trip.
    if (occupied() >= 27 && lootedThisTrip) return true;
    return false;
}

async function waitRespawn(): Promise<void> {
    const life = pos().lifeId;
    log(`Died @ ${pos().x},${pos().z} — waiting respawn`);
    await sdk.waitForCondition((s) => !s.player.isDead && s.player.lifeId !== life, 60_000).catch(() => {});
    await closeUi(bot, sdk);
    await fetchDukeShield(bot, sdk, log);
    // The respawn is in Lumbridge, next to Bob's axes: replace a lost axe before the walk back.
    await ensureAxeFromBob(bot, sdk, log);
}

session.registerRecovery([
    { name: 'to_pit', run: async () => goToPit() },
    { name: 'bank', run: async () => bankTrip() }
]);
session.setAnchor(PIT.x, PIT.z);

try {
    await bot.skipTutorial();
    await closeUi(bot, sdk);
    log(`Brimhaven dragons @ ${pos().x},${pos().z} food=${foodCount()} coins=${count(COINS)} agility=${sdk.getSkill('Agility')?.baseLevel} wc=${sdk.getSkill('Woodcutting')?.baseLevel}`);
    if ((sdk.getSkill('Agility')?.baseLevel ?? 1) < 12) {
        session.stop('agility', 'needs Agility 12 for the stepping stones');
    } else if (!inDungeon() && (foodCount() <= LEAVE_FOOD || count(COINS) < ENTRY_FEE + BOAT_GP)) {
        await bankTrip();
    }
    while (!session.isStopped()) {
        if (session.needsRecovery()) {
            if ((await session.recover()) === 'exhausted') break;
            continue;
        }
        session.maybeHeartbeat();
        if (pos().isDead) {
            await waitRespawn();
            continue;
        }
        await closeUi(bot, sdk);
        await eatIfNeeded();
        if (shouldBank()) {
            await bankTrip();
            continue;
        }
        if (!inPit()) {
            if (!(await goToPit())) continue;
        }
        if (session.metrics().phase !== 'dragons') await session.setPhase('dragons');
        await fightOne();
    }
} catch (err) {
    session.stop('script_error', err instanceof Error ? err.message : String(err));
    console.error('Script error:', err);
} finally {
    log(`stopped: kills=${kills} buried=${buried}`);
    await session.finalizeStop();
    await sdk.disconnect();
}
