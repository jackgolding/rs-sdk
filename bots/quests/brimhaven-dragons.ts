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
import { fetchDukeShield } from './duke-shield';
import { brewPrayerPotions } from './prayer-brew';
import { closeUi, crossGangplank, walkNear } from './movement';
import { foodHeal } from './food-heal';
import { ARDOUGNE_BANK, BRIMHAVEN_CUSTOMS, CAPTAIN_BARNABY } from './tiles';
import { crossAlKharidToll, inAlKharidRegion } from './alkharid-toll';

const SANIBOCH = { x: 2744, z: 3152 };
/** East Ardougne church altar (loc 409, maps/m40_51): a full prayer bar before every trip. */
const ARDOUGNE_ALTAR = { x: 2617, z: 3309 };
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
const MAGIC_TAB = 6;
/** sdk/spells.ts: Camelot (Magic 45, 1 law 5 air), Lumbridge (Magic 31, 1 law 3 air 1 earth). */
const CAMELOT_TELEPORT = 1174;
const LUMBRIDGE_TELEPORT = 1167;
const SUPER_STRENGTH = /^super strength\(\d\)$/i;
const LOOT =
    /^(dragon (platelegs|plateskirt|med helm|spear|chainbody)|soul rune|law rune|death rune|blood rune|nature rune|rune .*|adamant(ite)? .*|steel bar|iron bar|runite bar|coal|uncut (sapphire|emerald|ruby|diamond|dragonstone)|clue scroll.*|half of a key|.*half of a key)$/i;

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

async function protectMelee(on: boolean): Promise<void> {
    const active = sdk.isPrayerActive('protect_from_melee');
    if (on && !active && (sdk.getPrayerState()?.prayerPoints ?? 0) > 0) await bot.activatePrayer('protect_from_melee');
    if (!on && active) await bot.deactivatePrayer('protect_from_melee');
}

// ── bank ──────────────────────────────────────────────────────────────────────

function keep(name: string): boolean {
    return (
        COINS.test(name) ||
        foodHeal(name) > 0 ||
        PRAYER_POT.test(name) ||
        SUPER_ATTACK.test(name) ||
        LAW.test(name) ||
        AIR.test(name) ||
        EARTH.test(name) ||
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

async function bankTrip(): Promise<boolean> {
    await session.setPhase('bank');
    if (inDungeon()) {
        if (!(await leaveDungeon())) return false;
    }
    if (onKaramja() && !(await sailToArdougne())) return false;
    // A grind handed over at Al Kharid (process-bank) starts east of the toll gate.
    if (inAlKharidRegion(pos())) await crossAlKharidToll(bot, sdk, false, { log });
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
    await withdrawUpTo(COINS, COINS_WANT);
    await withdrawFirst(AXES);
    await withdrawFirst(WEAPONS);
    await withdrawFirst([SHIELD]);
    for (const piece of ARMOUR) await withdrawFirst([piece]);
    await withdrawUpTo(PRAYER_POT, PRAYER_POTS_WANT);
    await withdrawUpTo(SUPER_ATTACK, 1);
    await withdrawUpTo(LAW, 1);
    await withdrawUpTo(AIR, 5);
    await withdrawUpTo(EARTH, 1);
    await withdrawUpTo(SUPER_STRENGTH, 1);
    if (count(PRAYER_POT) < PRAYER_POTS_WANT) await brewPrayerPotions(bot, sdk, log, PRAYER_POTS_WANT - count(PRAYER_POT));
    const sharks = sdk.findBankItem(/^shark$/i) ? /^shark$/i : /^(swordfish|lobster)$/i;
    await withdrawUpTo(sharks, FOOD_WANT - (foodCount() - count(sharks)));
    await bot.closeBank();
    if (!sdk.findEquipmentItem(SHIELD) && !sdk.findInventoryItem(SHIELD)) await fetchDukeShield(bot, sdk, log);
    await prayAtAltar();
    for (const pattern of [...WEAPONS, SHIELD, ...ARMOUR]) {
        if (sdk.findEquipmentItem(pattern)) continue;
        const item = sdk.findInventoryItem(pattern);
        if (item) await bot.equipItem(item);
        if (WEAPONS.includes(pattern) && sdk.getEquipment().some((e) => WEAPONS.some((w) => w.test(e?.name ?? '')))) continue;
    }
    const ready = count(COINS) >= ENTRY_FEE + BOAT_GP * 2 && foodCount() > LEAVE_FOOD && AXES.some((p) => sdk.findInventoryItem(p) || sdk.findEquipmentItem(p)) && !!sdk.findEquipmentItem(SHIELD);
    log(`Kit coins=${count(COINS)} food=${foodCount()} pots=${count(PRAYER_POT)} shield=${!!sdk.findEquipmentItem(SHIELD)} worn=${sdk.getEquipment().filter(Boolean).map((e) => e!.name).join(',')} ready=${ready}`);
    session.noteProgress('bank', `food ${foodCount()}`);
    if (!ready) {
        session.noteFailure('kit', 'missing coins, food, an axe or a dragonfire shield');
        await sdk.waitForTicks(200).catch(() => {});
    }
    return ready;
}

/** Banking does not restore prayer: the second trip fought at 13 points and died (qlck1). */
async function prayAtAltar(): Promise<void> {
    const st = sdk.getPrayerState();
    if (!st || st.prayerPoints >= st.prayerLevel) return;
    intent('Praying at the Ardougne church altar');
    await walkNear(bot, sdk, ARDOUGNE_ALTAR.x - 1, ARDOUGNE_ALTAR.z, 2);
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

async function sailToArdougne(): Promise<boolean> {
    intent('Brimhaven customs → Ardougne');
    await walkNear(bot, sdk, BRIMHAVEN_CUSTOMS.x, BRIMHAVEN_CUSTOMS.z, 4);
    return sail(/^customs officer$/i, inArdougne);
}

/** Pay Saniboch and go in through the dungeon entrance. */
async function enterDungeon(): Promise<boolean> {
    intent('Paying Saniboch');
    await walkNear(bot, sdk, SANIBOCH.x + 1, SANIBOCH.z + 2, 2);
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
    for (let attempt = 0; attempt < 8 && !done() && !pos().isDead; attempt++) {
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

function pickDragon() {
    const live = (sdk.getNearbyNpcs() ?? []).filter(
        (n) => DRAGON.test(n.name) && (n.hp === null || n.hp > 0) && n.reachable !== false && n.optionsWithIndex.some((o) => /attack/i.test(o.text))
    );
    // Iron first (165 hp/def against steel's 210/215): a solo rune-scimitar steel kill took
    // ~600 ticks, past one prayer bar, and the headbutts that follow it ate a trip's food.
    const iron = (n: { name: string }) => (/^iron/i.test(n.name) ? 0 : 1);
    return live.sort((a, b) => iron(a) - iron(b) || (a.distance ?? 99) - (b.distance ?? 99))[0] ?? null;
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
    if (!spell) return false;
    await sdk.sendSetTab(MAGIC_TAB).catch(() => {});
    await sdk.waitForTicks(1).catch(() => {});
    await sdk.sendClickComponent(spell);
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
        await bot.dismissBlockingUI();
        await eatIfNeeded();
        await drinkPrayerIfLow();
        await protectMelee(true);
        const prayerOut = (sdk.getPrayerState()?.prayerPoints ?? 99) < 10 && !sdk.findInventoryItem(PRAYER_POT);
        if (pos().hp < pos().maxHp * 0.5 && (foodCount() <= 4 || prayerOut)) {
            await emergencyTeleport();
            return;
        }
        if ((foodCount() <= 2 && pos().hp < pos().maxHp * 0.6) || ((sdk.getPrayerState()?.prayerPoints ?? 0) === 0 && !sdk.findInventoryItem(PRAYER_POT))) {
            session.log('warn', `Low on food (${foodCount()}) at ${pos().hp}/${pos().maxHp} — leaving`);
            return;
        }
        if (!(pos().inCombat && pos().targetType === 'npc')) await sdk.sendInteractNpc(target.index, attack.opIndex);
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
    if (occupied() >= 27) return true;
    return false;
}

async function waitRespawn(): Promise<void> {
    const life = pos().lifeId;
    log(`Died @ ${pos().x},${pos().z} — waiting respawn`);
    await sdk.waitForCondition((s) => !s.player.isDead && s.player.lifeId !== life, 60_000).catch(() => {});
    await closeUi(bot, sdk);
    await fetchDukeShield(bot, sdk, log);
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
