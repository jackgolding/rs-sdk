/**
 * Kalphite Queen team raid: dragon chainbody (1/128), amulet of power, jewels.
 *
 *   bun bots/quests/kalphite-queen.ts {botname} [--team-min=4]
 *
 * Route and fight: learnings/kalphite-queen.md (probed in-game, qlck1 2026-11-01).
 *   Al Kharid bank -> Shantay (pass) -> Shantay guard -> desert run (13 legs, under the
 *   150-tick heat timer) -> rope on the burrow (3227,3108) -> lair plane 2 (3483,9510) ->
 *   chamber entrance (3509,9497) -> rope, climb -> the Queen's level (3508,9493) -> Queen
 *   at (3474,9496). The chamber is multiway: the whole team shares each kill.
 * Her magic (kalphite_queen_mage_huntall) bounces across every player, so everyone prays
 * Protect from Magic and eats through the ranged and melee. A rope stays tied for a while,
 * so a team needs one per entrance, not one each.
 * Out by Lumbridge Teleport (the lair is not wilderness), next to the Al Kharid toll.
 */
import { ActivitySession, BotSDK, deriveGatewayUrl } from '../../sdk/index';
import { BotActions } from '../../sdk/actions';
import { findLongPath, initPathfinding } from '../../sdk/pathfinding';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { installGracefulShutdown } from '../../sdk/runner';
import { closeUi, walkNear } from './movement';
import { foodHeal } from './food-heal';
import { AL_KHARID_BANK } from './tiles';
import { crossAlKharidToll, eastOfToll } from './alkharid-toll';
import { brewPrayerPotions } from './prayer-brew';
import { leaveMine } from './air-runes-shared';

const SHANTAY = { x: 3304, z: 3127, npc: /^shantay$/i };
/** Ned, Draynor: rope 15gp ("I would like some rope", lib/sources.ts). Lumbridge Teleport lands next door. */
const NED = { x: 3099, z: 3258 };
const SHANTAY_GATE = { x: 3304, z: 3119 };
const BURROW = { x: 3228, z: 3110 };
const LAIR_LANDING = { x: 3483, z: 9510 };
const CHAMBER_ENTRANCE = { x: 3507, z: 9497 };
const QUEEN = { x: 3478, z: 9496 };
const FOOD_WANT = 20;
const LEAVE_FOOD = 5;
const PRAYER_POTS_WANT = 4;
const MAGIC_TAB = 6;
const LUMBRIDGE_TELEPORT = 1167;

const QUEEN_NPC = /^kalphite queen$/i;
const ROPE = /^rope$/i;
const PASS = /^shantay pass$/i;
const COINS = /^coins$/i;
const SHARK = /^shark$/i;
const PRAYER_POT = /^prayer potion\(\d\)$/i;
const ANTIPOISON = /^antipoison\(\d\)$/i;
const LAW = /^law rune$/i;
const AIR = /^air rune$/i;
const EARTH = /^earth rune$/i;
const WEAPONS = [/^dragon longsword$/i, /^dragon scimitar$/i, /^rune scimitar$/i, /^rune longsword$/i];
const ARMOUR = [
    /^(dragon|rune|adamant) (full helm|med helm)$/i,
    /^black d'?hide body$|^(rune|adamant) (platebody|chainbody)$/i,
    /^black d'?hide chaps$|^(dragon|rune|adamant) (platelegs|plateskirt)$/i,
    /^(dragonfire shield|anti-dragon shield|rune kiteshield|rune sq shield)$/i,
    /^amulet of glory\(\d\)$|^amulet of (power|strength)$/i
];
const LOOT = /^(dragon chainbody|dragon .*|amulet of power|wine of zamorak|.*(diamond|ruby|emerald|sapphire|dragonstone).*|rune .*|.*half of a key|clue scroll.*|law rune|death rune|blood rune|coins)$/i;

const argv = process.argv.slice(2);
const botArg = argv.find((a) => !a.startsWith('-'));
const TEAM_MIN = Number(argv.find((a) => a.startsWith('--team-min='))?.split('=')[1] ?? 4);
const TEAM_FRESH_MS = 120_000;
const TEAM_WAIT_MS = 30 * 60_000;

function loadBotEnv(): void {
    const envPath = botArg ? join(process.cwd(), 'bots', botArg, 'bot.env') : join(dirname(import.meta.path), 'bot.env');
    if (!existsSync(envPath)) throw new Error(`bot.env not found at ${envPath}. Usage: bun bots/quests/kalphite-queen.ts {botname}`);
    for (const line of readFileSync(envPath, 'utf-8').split('\n')) {
        const t = line.trim();
        if (!t || t.startsWith('#')) continue;
        const eq = t.indexOf('=');
        if (eq > 0) process.env[t.slice(0, eq)] = t.slice(eq + 1);
    }
}

loadBotEnv();
const username = process.env.BOT_USERNAME!;
const TEAM_DIR = join(process.cwd(), 'bots', '.kq-team');
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
    name: 'kalphite-queen',
    grindLogPath: join(process.cwd(), 'bots', username, 'grind.log'),
    stallMs: 300_000,
    maxRecoveryTactics: 6
});
installGracefulShutdown({ graceMs: 30_000 });

let kills = 0;

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
        lifeId: p?.lifeId ?? 0
    };
}

function distTo(x: number, z: number): number {
    return Math.hypot(pos().x - x, pos().z - z);
}

function count(p: RegExp): number {
    return sdk.getInventory().filter((i) => p.test(i.name)).reduce((n, i) => n + (i.count ?? 1), 0);
}

function foodCount(): number {
    return sdk.getInventory().filter((i) => foodHeal(i.name) > 0).reduce((n, i) => n + (i.count ?? 1), 0);
}

function inLair(): boolean {
    return pos().z > 9400 && pos().z < 9600 && pos().x > 3440 && pos().x < 3560;
}

function inChamber(): boolean {
    return inLair() && pos().level === 0;
}

function inDesert(): boolean {
    return pos().z < 3117 && pos().z > 2800 && pos().x > 3150 && pos().x < 3400 && !inLair();
}

// ── team rendezvous (same shape as kbd-range --melee) ─────────────────────────

function checkIn(where: 'bank' | 'lair'): void {
    try {
        mkdirSync(TEAM_DIR, { recursive: true });
        writeFileSync(join(TEAM_DIR, username), JSON.stringify({ at: Date.now(), where }));
    } catch {
        /* best effort */
    }
}

function atBank(): string[] {
    try {
        return readdirSync(TEAM_DIR).filter((n) => {
            try {
                const t = JSON.parse(readFileSync(join(TEAM_DIR, n), 'utf8')) as { at: number; where: string };
                return Date.now() - t.at < TEAM_FRESH_MS && t.where === 'bank';
            } catch {
                return false;
            }
        });
    } catch {
        return [];
    }
}

async function waitForTeam(): Promise<void> {
    if (TEAM_MIN <= 1) return;
    const started = Date.now();
    let said = 0;
    while (!session.isStopped() && Date.now() - started < TEAM_WAIT_MS) {
        checkIn('bank');
        const here = atBank();
        if (here.length >= TEAM_MIN) {
            log(`Team ready (${here.length}/${TEAM_MIN}): ${here.join(', ')} — heading out`);
            setTimeout(() => checkIn('lair'), 60_000);
            return;
        }
        if (Date.now() - said > 60_000) {
            said = Date.now();
            log(`Waiting for the team at Al Kharid: ${here.length}/${TEAM_MIN} (${here.join(', ')})`);
        }
        session.noteProgress('phase', `team ${here.length}`);
        await sdk.waitForTicks(5).catch(() => {});
    }
    while (!session.isStopped() && atBank().length < 2) {
        checkIn('bank');
        await sdk.waitForTicks(20).catch(() => {});
    }
    log(`Team wait ran out with ${atBank().length}/${TEAM_MIN} — going in`);
}

// ── combat helpers ────────────────────────────────────────────────────────────

async function eatIfNeeded(): Promise<void> {
    const p = pos();
    const danger = p.hp <= Math.floor(p.maxHp * 0.55);
    if (!danger && p.hp > p.maxHp - 22) return;
    const food = sdk.getInventory().filter((i) => foodHeal(i.name) > 0).sort((a, b) => foodHeal(b.name) - foodHeal(a.name))[0];
    if (food) await bot.eatFood(food);
}

async function drink(p: RegExp): Promise<void> {
    const pot = sdk.findInventoryItem(p);
    const op = pot?.optionsWithIndex.find((o) => /drink/i.test(o.text));
    if (pot && op) {
        await sdk.sendUseItem(pot.slot, op.opIndex);
        await sdk.waitForTicks(2).catch(() => {});
    }
}

async function keepUp(): Promise<void> {
    await eatIfNeeded();
    const st = sdk.getPrayerState();
    if (st && st.prayerPoints < Math.max(10, st.prayerLevel * 0.3)) await drink(PRAYER_POT);
    if ((sdk.getState()?.gameMessages ?? []).slice(-3).some((m) => /poison/i.test(m.text ?? ''))) await drink(ANTIPOISON);
    const active = sdk.isPrayerActive('protect_from_magic');
    if (!active && (sdk.getPrayerState()?.prayerPoints ?? 0) > 0 && inChamber()) await bot.activatePrayer('protect_from_magic');
}

// ── bank ──────────────────────────────────────────────────────────────────────

function keep(name: string): boolean {
    return (
        COINS.test(name) ||
        foodHeal(name) > 0 ||
        PRAYER_POT.test(name) ||
        ANTIPOISON.test(name) ||
        ROPE.test(name) ||
        PASS.test(name) ||
        /^shantay disclaimer$/i.test(name) ||
        LAW.test(name) ||
        AIR.test(name) ||
        EARTH.test(name) ||
        WEAPONS.some((w) => w.test(name)) ||
        ARMOUR.some((a) => a.test(name))
    );
}

async function withdraw(p: RegExp, want: number): Promise<void> {
    const short = want - count(p);
    const item = short > 0 ? sdk.findBankItem(p) : null;
    if (item) await bot.withdrawItem(item, Math.min(short, item.count));
}

async function bankTrip(): Promise<boolean> {
    await session.setPhase('bank');
    if (inLair()) await teleportOut();
    // A grind handed over in the rune essence mine (ABGARMY09) is in an instance: portal out first.
    await leaveMine(bot, sdk, log);
    await buyRopes();
    if (!eastOfToll(pos())) await crossAlKharidToll(bot, sdk, true, { log });
    if (distTo(AL_KHARID_BANK.x, AL_KHARID_BANK.z) > 8) await walkNear(bot, sdk, AL_KHARID_BANK.x, AL_KHARID_BANK.z, 3);
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
    await withdraw(COINS, 300);
    for (const w of WEAPONS) {
        if (sdk.findEquipmentItem(w) || sdk.findInventoryItem(w)) break;
        const item = sdk.findBankItem(w);
        if (item) {
            await bot.withdrawItem(item, 1);
            break;
        }
    }
    for (const a of ARMOUR) {
        if (sdk.findEquipmentItem(a) || sdk.findInventoryItem(a)) continue;
        const item = sdk.findBankItem(a);
        if (item) await bot.withdrawItem(item, 1);
    }
    await withdraw(ROPE, 2);
    await withdraw(PASS, 1);
    await withdraw(LAW, 1);
    await withdraw(AIR, 3);
    await withdraw(EARTH, 1);
    await withdraw(ANTIPOISON, 2);
    await withdraw(PRAYER_POT, PRAYER_POTS_WANT);
    if (count(PRAYER_POT) < PRAYER_POTS_WANT) await brewPrayerPotions(bot, sdk, log, PRAYER_POTS_WANT - count(PRAYER_POT));
    // Leave 3 slots: the Shantay pass is bought after banking, and the loot needs room
    // (jackthief: "No inventory space to buy Shantay pass").
    const free = 28 - sdk.getInventory().filter((i) => (i.count ?? 0) > 0).length;
    await withdraw(SHARK, Math.min(FOOD_WANT, count(SHARK) + free - 3));
    // Whatever else the pack holds (other food, brewed potions), end with 3 free slots.
    const freeNow = 28 - sdk.getInventory().filter((i) => (i.count ?? 0) > 0).length;
    if (freeNow < 3 && count(SHARK) > 0) await bot.depositItem(SHARK, Math.min(count(SHARK), 3 - freeNow)).catch(() => undefined);
    await bot.closeBank();
    for (const p of [...WEAPONS, ...ARMOUR]) {
        if (sdk.findEquipmentItem(p)) continue;
        const item = sdk.findInventoryItem(p);
        if (item) await bot.equipItem(item);
    }
    const ready = foodCount() > LEAVE_FOOD && WEAPONS.some((w) => sdk.findEquipmentItem(w));
    log(`Kit food=${foodCount()} pots=${count(PRAYER_POT)} ropes=${count(ROPE)} pass=${count(PASS)} anti=${count(ANTIPOISON)} worn=${sdk.getEquipment().filter(Boolean).map((e) => e!.name).join(',')} ready=${ready}`);
    if (!ready) {
        session.noteFailure('kit', 'no weapon or food');
        await sdk.waitForTicks(200).catch(() => {});
    }
    return ready;
}

/**
 * Two ropes each from Ned: one carrier's ropes stranded the first prod team at the chamber
 * entrance when that carrier bounced off the Shantay gate. Only on the Lumbridge side of the toll.
 */
async function buyRopes(): Promise<void> {
    if (count(ROPE) >= 2 || eastOfToll(pos())) return;
    if (count(COINS) < 30) return;
    intent('Buying rope from Ned in Draynor');
    await walkNear(bot, sdk, NED.x, NED.z, 3);
    for (let misses = 0; misses < 3 && count(ROPE) < 2; ) {
        const ned = sdk.findNearbyNpc(/^ned$/i);
        if (!ned) break;
        const before = count(ROPE);
        await bot.talkTo(ned).catch(() => undefined);
        for (let i = 0; i < 14 && count(ROPE) === before; i++) {
            const d = sdk.getDialog();
            if (d?.isOpen && !d.isWaiting) {
                const pick = d.options.find((o) => /would like some rope|sell me some rope|yes/i.test(o.text));
                await sdk.sendClickDialog(pick?.index ?? d.options[0]?.index ?? 0);
            }
            await sdk.waitForTicks(1).catch(() => {});
        }
        await closeUi(bot, sdk);
        misses = count(ROPE) > before ? 0 : misses + 1;
    }
    log(`Ropes from Ned: ${count(ROPE)}`);
}

// ── travel ────────────────────────────────────────────────────────────────────

async function buyPass(): Promise<void> {
    if (count(PASS) > 0) return;
    const { buyAtShop } = await import('./quest-supplies');
    // The pass lands a few ticks after the buy, with the shop still open: the first prod team
    // reached the gate with pass=0 and turned back. Close the shop and wait for it.
    for (let attempt = 0; attempt < 2 && count(PASS) === 0; attempt++) {
        await buyAtShop(
            { bot, sdk, log, intent, walkNear: (x, z, t = 3) => walkNear(bot, sdk, x, z, t), closeUi: () => closeUi(bot, sdk) },
            SHANTAY,
            [{ pattern: PASS, amount: 1, label: 'shantay pass' }]
        ).catch((e) => log(`Shantay shop: ${e instanceof Error ? e.message : String(e)}`));
        await closeUi(bot, sdk);
        await sdk.waitForCondition(() => count(PASS) > 0, 5_000).catch(() => {});
    }
    log(`Shantay pass ${count(PASS) > 0 ? 'bought' : 'NOT bought'} (coins ${count(COINS)})`);
}

/**
 * Through the Shantay pass: "Go-through" on the gate loc (shantay_pass_henge_doorway) takes the
 * pass, shows the poster ("Yeah, that poster doesn't scare me!") and moves you 3 tiles south.
 * Talking to "Shantay Guard" can reach one of the four ordinary guards (probed 2026-11-01).
 */
async function throughShantayGate(): Promise<boolean> {
    if (inDesert()) return true;
    await walkNear(bot, sdk, SHANTAY_GATE.x, SHANTAY_GATE.z + 2, 2);
    for (let attempt = 0; attempt < 3 && !inDesert(); attempt++) {
        // The gate guard (shantay_guard_still, Talk-to only, by the gate) rather than the gate loc:
        // a replayed loc Go-through from the desert side sends you back north for free and the
        // pass is gone (ABGARMY17 on prod); a replayed Talk-to only reopens his dialog.
        const guard = (sdk.getNearbyNpcs() ?? [])
            .filter((n) => /^shantay guard$/i.test(n.name) && !n.optionsWithIndex.some((o) => /attack/i.test(o.text)))
            .sort((a, b) => Math.hypot(a.x - SHANTAY_GATE.x, a.z - SHANTAY_GATE.z) - Math.hypot(b.x - SHANTAY_GATE.x, b.z - SHANTAY_GATE.z))[0];
        await sdk.scanNearbyLocs(6).catch(() => {});
        const gate = sdk.findNearbyLoc(/^shantay pass$/i, { withOption: /go-through/i });
        const op = gate?.optionsWithIndex.find((o) => /go-through/i.test(o.text));
        if (guard) {
            const talk = guard.optionsWithIndex.find((o) => /talk/i.test(o.text));
            if (talk) await sdk.sendInteractNpc(guard.index, talk.opIndex);
        } else if (gate && op) {
            await sdk.sendInteractLoc(gate.x, gate.z, gate.id, op.opIndex);
        } else {
            session.noteFailure('gate', `no Shantay gate guard or gate in view at ${pos().x},${pos().z}`);
            return false;
        }
        const south = (st: { player?: { worldZ?: number } | null }) => (st.player?.worldZ ?? 9999) < 3117;
        for (let i = 0; i < 30 && !inDesert(); i++) {
            const d = sdk.getDialog();
            if (d?.isOpen) {
                if (!d.isWaiting) {
                    const pick = d.options.find((o) => /doesn't scare me|go into the desert/i.test(o.text));
                    await sdk.sendClickDialog(pick?.index ?? d.options[0]?.index ?? 0);
                }
                await sdk.waitForTicks(1).catch(() => {});
                if (inDesert()) {
                    await sdk.sendWalk(SHANTAY_GATE.x - 3, SHANTAY_GATE.z - 8, true).catch(() => {});
                    break;
                }
                continue;
            }
            // Event-driven, not a tick poll: jackthief was through and bounced back north by
            // the replayed Go-through inside one poll. Walk south the moment the state says south.
            const through = await sdk.waitForCondition((st) => south(st) || !!st.dialog?.isOpen, 1_500).then(() => inDesert()).catch(() => false);
            if (through) {
                await sdk.sendWalk(SHANTAY_GATE.x - 3, SHANTAY_GATE.z - 8, true).catch(() => {});
                break;
            }
        }
        // The Go-through replays on arrival and, from the desert side, the gate sends you back
        // north for free (qlck1 bounced to 3304,3118): walk south at once to drop it.
        if (inDesert()) {
            await sdk.sendWalk(SHANTAY_GATE.x - 3, SHANTAY_GATE.z - 8, true).catch(() => {});
            await sdk.waitForTicks(3).catch(() => {});
        }
    }
    log(`Shantay gate ${inDesert() ? 'through' : 'not passed'} @ ${pos().x},${pos().z} pass=${count(PASS)}`);
    return inDesert();
}

async function walkLegs(level: number, to: { x: number; z: number }): Promise<boolean> {
    const legs = findLongPath(level, pos().x, pos().z, to.x, to.z);
    for (const leg of legs) {
        if (pos().isDead) return false;
        await keepUp();
        await bot.walkTo(leg.x, leg.z, 2).catch(() => undefined);
    }
    return distTo(to.x, to.z) <= 4;
}

/** Tie a rope if none is tied (anyone's rope will do), then climb. */
async function ropeAndClimb(entrance: RegExp, arrived: () => boolean): Promise<boolean> {
    for (let attempt = 0; attempt < 4 && !arrived(); attempt++) {
        await sdk.scanNearbyLocs(6).catch(() => {});
        const tied = sdk.findNearbyLoc(entrance, { withOption: /climb/i });
        if (tied) {
            const op = tied.optionsWithIndex.find((o) => /climb/i.test(o.text))!;
            await sdk.sendInteractLoc(tied.x, tied.z, tied.id, op.opIndex);
            await sdk.waitForCondition(() => arrived(), 10_000).catch(() => {});
            continue;
        }
        const hole = sdk.findNearbyLoc(entrance);
        const rope = sdk.findInventoryItem(ROPE);
        if (!hole || !rope) {
            session.noteFailure('rope', `${hole ? 'no rope to tie' : 'no entrance in view'} at ${pos().x},${pos().z}`);
            await sdk.waitForTicks(10).catch(() => {});
            continue;
        }
        await bot.useItemOnLoc(rope, hole);
        await sdk.waitForTicks(3).catch(() => {});
    }
    return arrived();
}

async function goToQueen(): Promise<boolean> {
    await session.setPhase('travel');
    if (!inLair()) {
        if (!eastOfToll(pos()) || distTo(AL_KHARID_BANK.x, AL_KHARID_BANK.z) > 15) {
            if (!(await bankTrip())) return false;
        }
        await waitForTeam();
        await buyPass();
        if (!(await throughShantayGate())) return false;
        intent('Across the desert to the Kalphite burrow');
        await walkLegs(0, BURROW);
        if (!(await ropeAndClimb(/tunnel|entrance|burrow|hole/i, () => inLair()))) return false;
        log(`In the Kalphite lair @ ${pos().x},${pos().z} L${pos().level}`);
    }
    if (!inChamber()) {
        intent('To the Queen chamber');
        if (distTo(CHAMBER_ENTRANCE.x, CHAMBER_ENTRANCE.z) > 4) await walkLegs(pos().level, CHAMBER_ENTRANCE);
        if (!(await ropeAndClimb(/tunnel|entrance|hole/i, () => inChamber()))) return false;
        log(`In the Queen chamber @ ${pos().x},${pos().z}`);
    }
    if (distTo(QUEEN.x, QUEEN.z) > 10) await walkLegs(0, QUEEN);
    return inChamber();
}

async function teleportOut(): Promise<boolean> {
    if (!inLair()) return true;
    await bot.deactivatePrayer('protect_from_magic').catch(() => undefined);
    if (count(LAW) >= 1 && count(AIR) >= 3 && count(EARTH) >= 1) {
        await sdk.sendSetTab(MAGIC_TAB).catch(() => {});
        await sdk.waitForTicks(1).catch(() => {});
        await sdk.sendClickComponent(LUMBRIDGE_TELEPORT);
        await sdk.waitForCondition((s) => (s.player?.worldZ ?? 9999) < 9000, 12_000).catch(() => {});
    }
    log(inLair() ? 'No teleport out (runes) — still in the lair' : `Teleported out to ${pos().x},${pos().z}`);
    return !inLair();
}

// ── fight ─────────────────────────────────────────────────────────────────────

function queen() {
    return (sdk.getNearbyNpcs() ?? []).find((n) => QUEEN_NPC.test(n.name) && (n.hp === null || n.hp > 0) && n.optionsWithIndex.some((o) => /attack/i.test(o.text))) ?? null;
}

async function loot(): Promise<void> {
    for (let i = 0; i < 10; i++) {
        const g = (sdk.getGroundItems() ?? []).filter((x) => LOOT.test(x.name) && (x.distance ?? 99) <= 10 && x.reachable !== false).sort((a, b) => (a.distance ?? 99) - (b.distance ?? 99))[0];
        if (!g || sdk.getInventory().filter((x) => (x.count ?? 0) > 0).length >= 28) break;
        const had = sdk.getInventory().filter((x) => x.id === g.id).reduce((n, x) => n + (x.count ?? 1), 0);
        await sdk.sendPickup(g.x, g.z, g.id);
        await sdk.waitForCondition(() => sdk.getInventory().filter((x) => x.id === g.id).reduce((n, x) => n + (x.count ?? 1), 0) > had, 4_000).catch(() => {});
        log(`Loot: ${g.count} ${g.name}`);
        session.recordGain(g.name, g.count);
    }
}

async function fight(): Promise<void> {
    checkIn('lair');
    const q = queen();
    if (!q) {
        await bot.deactivatePrayer('protect_from_magic').catch(() => undefined);
        await loot();
        await sdk.waitForTicks(3).catch(() => {});
        return;
    }
    const started = Date.now();
    const xp0 = sdk.getSkill('Hitpoints')?.experience ?? 0;
    log(`Queen up — team=${(sdk.getNearbyPlayers() ?? []).length + 1} food=${foodCount()} prayer=${sdk.getPrayerState()?.prayerPoints}`);
    while (!pos().isDead && !session.isStopped() && Date.now() - started < 600_000) {
        const target = queen();
        if (!target) break;
        await bot.dismissBlockingUI();
        await keepUp();
        if (foodCount() <= 2 && pos().hp < pos().maxHp * 0.6) {
            session.log('warn', `Low on food (${foodCount()}) — leaving the chamber`);
            return;
        }
        if (!(pos().inCombat && pos().targetType === 'npc')) {
            const op = target.optionsWithIndex.find((o) => /attack/i.test(o.text))!;
            await sdk.sendInteractNpc(target.index, op.opIndex);
        }
        await sdk.waitForTicks(1).catch(() => {});
    }
    if (!pos().isDead && (sdk.getSkill('Hitpoints')?.experience ?? 0) > xp0 && !queen()) {
        kills++;
        session.noteProgress('xp', `queen ${kills}`);
        log(`Kalphite Queen dead (#${kills}) in ${Math.round((Date.now() - started) / 1000)}s food=${foodCount()} prayer=${sdk.getPrayerState()?.prayerPoints}`);
        await sdk.waitForTicks(3).catch(() => {});
        await loot();
    }
}

session.registerRecovery([
    { name: 'to_queen', run: async () => goToQueen() },
    { name: 'bank', run: async () => bankTrip() }
]);
session.setAnchor(QUEEN.x, QUEEN.z);

try {
    await closeUi(bot, sdk);
    log(`Kalphite Queen @ ${pos().x},${pos().z} L${pos().level} food=${foodCount()} team-min=${TEAM_MIN}`);
    while (!session.isStopped()) {
        if (session.needsRecovery()) {
            if ((await session.recover()) === 'exhausted') break;
            continue;
        }
        session.maybeHeartbeat();
        if (pos().isDead) {
            const life = pos().lifeId;
            log(`Died @ ${pos().x},${pos().z}`);
            await sdk.waitForCondition((s) => !s.player.isDead && s.player.lifeId !== life, 60_000).catch(() => {});
            continue;
        }
        await closeUi(bot, sdk);
        if (foodCount() <= LEAVE_FOOD) {
            await bankTrip();
            continue;
        }
        if (!inChamber()) {
            if (!(await goToQueen())) continue;
        }
        if (session.metrics().phase !== 'queen') await session.setPhase('queen');
        await fight();
    }
} catch (err) {
    session.stop('script_error', err instanceof Error ? err.message : String(err));
    console.error('Script error:', err);
} finally {
    log(`stopped: kills=${kills}`);
    await session.finalizeStop();
    await sdk.disconnect();
}
