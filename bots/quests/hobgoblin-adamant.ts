/**
 * Hobgoblin mine adamant — Edgeville bank loop, wilderness.
 *
 *   bun bots/quests/hobgoblin-adamant.ts {botname}
 *
 * Mines the 7 adamant rocks at the hobgoblin mine (3080,3762), banks
 * Edgeville, repeats. Southbound uses the east road past Bandit Camp
 * (3110,z) staying south of the green dragons; northbound is the reverse.
 * Never bot.walkTo north of the ditch (pathfinder avoids wilderness).
 * On player combat with a dragon longsword worn: prays (best stack),
 * Cleave spec, retaliates, loots the kill (see anti-pk.ts). Without the
 * dlong worn, or when the fight turns bad, flees south immediately.
 * Carries 4 sharks into the wildy; heals to full after a fight.
 * Needs Mining 40 (adamantite) and a pickaxe in Edgeville bank.
 */
import { ActivitySession, BotSDK, deriveGatewayUrl } from '../../sdk/index';
import { BotActions } from '../../sdk/actions';
import { findLongPath, getDoorAt, initPathfinding } from '../../sdk/pathfinding';
import { existsSync, readFileSync } from 'fs';
import { dirname, join } from 'path';
import { foodHeal, needsBankHeal } from './food-heal';
import {
    BANDIT_CAMP,
    EAST_OF_BANDITS,
    HOBGOBLIN,
    clickAhead,
    hobToDitchHops,
    inGreenDragons,
    type Tile
} from './rune-rocks-route';
import { installGracefulShutdown } from '../../sdk/runner';
import { createAntiPk } from './anti-pk';

const EDGEVILLE_BANK = { x: 3094, z: 3492 };
const DITCH_NORTH = { x: 3088, z: 3525 };
const DITCH_SOUTH = { x: 3088, z: 3518 };

const TO_EDGEVILLE = [
    { x: 3104, z: 3291 },
    { x: 3079, z: 3419 },
    { x: 3094, z: 3492 }
];

const PICKAXE = /^(bronze|iron|steel|mithril|adamant|rune) pickaxe$/i;
const ADDY = /^adamantite ore$/i;
const ADDY_ROCK = /rocks adamant/i;
const DLONG = /^dragon longsword$/i;
const LEGS = /^rune platelegs$/i;
/** Sharks carried into the wildy per trip. */
const FOOD_TARGET = 12;
const SHARK = /^shark$/i;

const argv = process.argv.slice(2);
const botArg = argv.find((a) => !a.startsWith('-'));

function loadBotEnv(): void {
    const envPath = botArg
        ? join(process.cwd(), 'bots', botArg, 'bot.env')
        : join(dirname(import.meta.path), 'bot.env');
    if (!existsSync(envPath)) {
        throw new Error(`bot.env not found at ${envPath}. Usage: bun bots/quests/hobgoblin-adamant.ts {botname}`);
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

console.log('Warming pathfinder...');
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

console.log('Opening/attaching the game client...');
await sdk.connect();
const bot = new BotActions(sdk);
const session = new ActivitySession(sdk, bot, {
    name: 'hobgoblin-adamant',
    grindLogPath: GRIND_LOG,
    stallMs: 480_000,
    maxRecoveryTactics: 8
});

installGracefulShutdown();

const antiPk = createAntiPk({ sdk, bot, log });

let banked = 0;
let deaths = 0;
let foodShort = false;

function log(msg: string): void {
    session.log('log', msg);
}

function intent(msg: string): void {
    void session.showIntent(msg);
}

function pos() {
    const p = sdk.getState()?.player;
    const hpSkill = sdk.getSkill('Hitpoints');
    return {
        x: p?.worldX ?? 0,
        z: p?.worldZ ?? 0,
        level: p?.level ?? 0,
        hp: hpSkill?.level ?? p?.hp ?? 10,
        maxHp: hpSkill?.baseLevel ?? p?.maxHp ?? 10,
        isDead: p?.isDead ?? false,
        inCombat: p?.combat?.inCombat ?? false,
        targetType: p?.combat?.targetType ?? 'none',
        lifeId: p?.lifeId ?? 0
    };
}

function distTo(x: number, z: number): number {
    return Math.hypot(pos().x - x, pos().z - z);
}

function northOfDitch(): boolean {
    return pos().z >= 3520 && pos().z < 6400;
}

function atHobgoblin(): boolean {
    const p = pos();
    if (p.x >= 3065 && p.x <= 3100 && p.z >= 3740 && p.z <= 3778) return true;
    return distTo(HOBGOBLIN.x, HOBGOBLIN.z) <= 12;
}

function mining(): number {
    return sdk.getSkill('Mining')?.baseLevel ?? 1;
}

function miningXp(): number {
    return sdk.getSkill('Mining')?.experience ?? 0;
}

function countAddy(): number {
    return sdk.getInventory().filter((i) => ADDY.test(i.name)).reduce((n, i) => n + (i.count ?? 1), 0);
}

function occupiedSlots(): number {
    return sdk.getInventory().filter((i) => (i.count ?? 0) > 0).length;
}

function freeSlots(): number {
    return 28 - occupiedSlots();
}

function hasPickaxe(): boolean {
    return !!(sdk.findInventoryItem(PICKAXE) || sdk.findEquipmentItem(PICKAXE));
}

function foodCount(): number {
    return sdk
        .getInventory()
        .filter((i) => (i.count ?? 0) > 0 && foodHeal(i.name) > 0)
        .reduce((n, i) => n + (i.count ?? 1), 0);
}

function isFood(name: string): boolean {
    return foodHeal(name) > 0;
}

function kept(name: string): boolean {
    if (PICKAXE.test(name)) return true;
    if (DLONG.test(name)) return true;
    if (LEGS.test(name)) return true;
    return isFood(name);
}

function extras() {
    return sdk.getInventory().filter((i) => (i.count ?? 0) > 0 && !kept(i.name));
}

/** Full bag (no free slot for another ore) or holding ore south of the ditch. */
function shouldBank(): boolean {
    if (!hasPickaxe()) return true;
    if (freeSlots() <= 0 && countAddy() > 0) return true;
    if (!northOfDitch() && (countAddy() > 0 || extras().length > 0)) return true;
    return false;
}

function needsHeal(): boolean {
    const p = pos();
    return needsBankHeal(p.hp, p.maxHp);
}

/** Attacked by a player — never retaliate, flee south. */
function seePker(): boolean {
    if (!northOfDitch()) return false;
    const combat = sdk.getState()?.player?.combat;
    return combat?.inCombat === true && combat?.targetType === 'player';
}

/**
 * PK pressure, confirmed OR suspected. Confirmed = our combat target is a
 * player. Suspected = we took damage in the last few ticks with a player
 * standing next to us while our target is something else (usually a
 * hobgoblin we auto-retaliated against first). Without this the bot stands
 * in NPC combat and gets beaten to death without ever noticing the PKer.
 */
function pkPressure(): boolean {
    if (!northOfDitch()) return false;
    const s = sdk.getState();
    const combat = s?.player?.combat;
    if (!combat) return false;
    if (combat.inCombat === true && combat.targetType === 'player') return true;
    const tick = s?.tick ?? 0;
    const lastDmg = combat.lastDamageTick ?? -1;
    if (lastDmg < 0 || tick - lastDmg > 4) return false;
    return (s?.nearbyPlayers ?? []).some((p) => (p.distance ?? 99) <= 4);
}

const MONASTERY = { x: 3051, z: 3484 };

function prayerPoints(): number {
    return sdk.getPrayerState()?.prayerPoints ?? 0;
}

function prayerBase(): number {
    return sdk.getPrayerState()?.prayerLevel ?? sdk.getSkill('Prayer')?.baseLevel ?? 0;
}

async function joinPrayerGuild(): Promise<boolean> {
    const abbot = sdk.findNearbyNpc(/abbot langley/i) ?? sdk.findNearbyNpc(/abbot/i);
    if (!abbot) {
        log('No Abbot Langley nearby to join the order');
        return false;
    }
    const talked = await bot.talkTo(abbot);
    if (!talked.success && !sdk.getDialog()?.isOpen) {
        log(`Talk Abbot: ${talked.message}`);
        return false;
    }
    for (let i = 0; i < 8; i++) {
        const dialog = sdk.getDialog();
        if (!dialog?.isOpen) break;
        const join = dialog.options.find((o) => /further into the monastery|join your order/i.test(o.text));
        if (join) {
            await sdk.clickDialogByText(new RegExp(join.text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'));
            await sdk.waitForTicks(1);
            continue;
        }
        const cont = dialog.options.find((o) => /click here to continue/i.test(o.text));
        if (cont) {
            await sdk.sendClickDialog(cont.index);
            await sdk.waitForTicks(1);
            continue;
        }
        await sdk.sendClickDialog(dialog.options[0]?.index ?? 0);
        await sdk.waitForTicks(1);
    }
    log('Asked Abbot Langley to join the order');
    return true;
}

async function climbMonasteryLadder(dir: RegExp): Promise<boolean> {
    const before = pos().level;
    const ladder = sdk.findNearbyLoc(/ladder/i, { withOption: dir });
    if (!ladder) return false;
    await bot.interactLoc(ladder, dir);
    try {
        await sdk.waitForCondition((s) => (s.player?.level ?? before) !== before || s.dialog.isOpen, 8_000);
    } catch {
        /* try again */
    }
    if (sdk.getDialog()?.isOpen) {
        log('Ladder blocked by monk dialog — joining order');
        await joinPrayerGuild();
        return pos().level !== before;
    }
    return pos().level !== before;
}

async function ensureGroundFloor(): Promise<void> {
    for (let i = 0; i < 8 && pos().level > 0; i++) {
        if (await climbMonasteryLadder(/climb-down/i)) break;
        const loc = sdk.findNearbyLoc(/ladder|stair/i, { withOption: /down/i });
        if (loc) {
            await bot.interactLoc(loc, /down/i);
            await sdk.waitForCondition((s) => (s.player?.level ?? 1) === 0, 8_000).catch(() => {});
        }
        await sdk.waitForTicks(1);
    }
    if (pos().level > 0) log(`Still upstairs @ ${pos().x},${pos().z} L${pos().level}`);
}

/** Top up prayer at the Edgeville monastery altar (proven in range-druids). */
async function rechargePrayer(): Promise<boolean> {
    const pts = prayerPoints();
    const max = prayerBase();
    if (pts >= max) return true;
    intent('Recharge prayer at monastery');
    log(`Recharge prayer ${pts}/${max} at monastery`);
    // Bank to monastery in short hops (single long walkTos no-op).
    for (const hop of [
        { x: 3070, z: 3490 },
        { x: MONASTERY.x, z: MONASTERY.z }
    ]) {
        if (distTo(hop.x, hop.z) > 6) await walkNear(hop.x, hop.z, 4);
    }
    for (let attempt = 0; attempt < 6 && pos().level === 0; attempt++) {
        if (await climbMonasteryLadder(/climb-up/i)) break;
        if (attempt === 1 || sdk.findNearbyNpc(/abbot/i)) await joinPrayerGuild();
        await sdk.waitForTicks(1);
    }
    if (pos().level === 0) {
        log(`Still ground floor @ ${pos().x},${pos().z} — cannot reach monastery altar`);
        return prayerPoints() >= prayerBase();
    }
    const altar = sdk.findNearbyLoc(/^altar$/i, { withOption: /pray/i }) ?? sdk.findNearbyLoc(/altar/i);
    if (!altar) {
        log(`No altar upstairs @ ${pos().x},${pos().z} L${pos().level}`);
    } else {
        const before = prayerPoints();
        await bot.interactLoc(altar, /pray/i);
        try {
            await sdk.waitForCondition((s) => (s.prayers?.prayerPoints ?? 0) > before, 8_000);
        } catch {
            /* already full or miss */
        }
        log(`Altar pray ${before} -> ${prayerPoints()}/${prayerBase()}`);
    }
    await ensureGroundFloor();
    return prayerPoints() >= prayerBase();
}

function bankFood() {
    return sdk
        .getBankItems()
        .filter((i) => (i.count ?? 0) > 0 && foodHeal(i.name) > 0)
        .sort((a, b) => foodHeal(b.name) - foodHeal(a.name))[0] ?? null;
}

function invEdible() {
    return sdk.getInventory().find(
        (i) =>
            (i.count ?? 0) > 0 &&
            foodHeal(i.name) > 0 &&
            (i.optionsWithIndex ?? []).some((o) => /eat/i.test(o.text))
    );
}

async function closeUi(): Promise<void> {
    const dialog = sdk.getDialog();
    if (dialog?.isOpen) {
        if (
            dialog.options?.every((o) => /click here to continue|continue/i.test(o.text)) ||
            (dialog.options?.length ?? 0) <= 1
        ) {
            await sdk.sendClickDialog(dialog.options?.[0]?.index ?? 0);
            await sdk.waitForTicks(1).catch(() => {});
        }
    }
    if (sdk.getState()?.shop?.isOpen || sdk.getState()?.bank?.isOpen || sdk.getState()?.interface?.isOpen) {
        await bot.closeInterface();
    }
    await bot.dismissBlockingUI();
}

async function openNearbyGate(): Promise<void> {
    await sdk.scanNearbyLocs(10).catch(() => {});
    const closed =
        sdk.findNearbyLoc(/^(door|gate)$/i, { withOption: /^open$/i }) ??
        sdk.findNearbyLoc(/door|gate/i, { withOption: /open/i });
    if (closed && (closed.distance ?? 99) <= 5) {
        intent(`Opening ${closed.name} @ ${closed.x},${closed.z}`);
        await bot.openDoor(closed);
        await sdk.waitForTicks(2).catch(() => {});
    }
}

/** Chaos temple double door is masked walkable. Open it before a hop crosses it. */
async function openDoorAhead(hop: Tile): Promise<void> {
    const here = pos();
    const dx = hop.x - here.x;
    const dz = hop.z - here.z;
    const steps = Math.max(Math.abs(dx), Math.abs(dz));
    let near = false;
    for (let i = 0; i <= steps; i++) {
        const x = here.x + Math.round((dx * i) / Math.max(steps, 1));
        const z = here.z + Math.round((dz * i) / Math.max(steps, 1));
        if (Math.max(Math.abs(x - here.x), Math.abs(z - here.z)) > 6) break;
        if (getDoorAt(0, x, z)) {
            near = true;
            break;
        }
    }
    if (!near) return;
    await sdk.scanNearbyLocs(8).catch(() => {});
    const door = (sdk.getNearbyLocs() ?? [])
        .filter((l) => /door|gate/i.test(l.name) && l.optionsWithIndex.some((o) => /^open$/i.test(o.text)))
        .sort((a, b) => (a.distance ?? 99) - (b.distance ?? 99))[0];
    const open = door?.optionsWithIndex.find((o) => /^open$/i.test(o.text));
    if (!door || !open) return;
    log(`Opening ${door.name} @ ${door.x},${door.z}`);
    await sdk.sendInteractLoc(door.x, door.z, door.id, open.opIndex);
    await sdk.waitForTicks(3).catch(() => {});
}

async function sendWalkHop(x: number, z: number, tolerance = 5, timeoutMs = 6_000): Promise<boolean> {
    await closeUi();
    if (distTo(x, z) <= tolerance) return true;
    const startZ = pos().z;
    const startX = pos().x;
    await sdk.sendWalk(x, z, true);
    const moved = await sdk
        .waitForCondition(
            (s) =>
                s.player?.isDead === true ||
                Math.hypot((s.player?.worldX ?? 0) - x, (s.player?.worldZ ?? 0) - z) <= tolerance + 1 ||
                (s.player?.worldX ?? startX) !== startX ||
                (s.player?.worldZ ?? startZ) !== startZ,
            timeoutMs
        )
        .then(() => true)
        .catch(() => false);
    await closeUi();
    return moved;
}

/**
 * One sendWalk, then keep moving until near the tile. Returning on the
 * first step made the wilderness loop re-click every tile and drop to a walk.
 */
async function runClick(x: number, z: number): Promise<boolean> {
    await closeUi();
    if (distTo(x, z) <= 5) return true;
    const sent = await sdk.sendWalk(x, z, true);
    if (!sent.success) return false;
    let lastX = pos().x;
    let lastZ = pos().z;
    let still = 0;
    const deadline = Date.now() + 8_000;
    while (Date.now() < deadline && !pos().isDead) {
        if (distTo(x, z) <= 5) return true;
        await sdk.waitForTicks(1).catch(() => {});
        if (pos().x === lastX && pos().z === lastZ) {
            still++;
            if (still >= 5) return false;
        } else {
            still = 0;
            lastX = pos().x;
            lastZ = pos().z;
        }
    }
    return distTo(x, z) <= 8;
}

/** Raw sendWalk — pathfinder avoids wilderness and loops the Edgeville ditch. */
async function sendWalkTo(x: number, z: number, tolerance = 8): Promise<void> {
    await closeUi();
    if (distTo(x, z) <= tolerance) return;
    await sdk.sendWalk(x, z, true);
    await sdk
        .waitForCondition(
            (s) =>
                s.player?.isDead === true ||
                Math.hypot((s.player?.worldX ?? 0) - x, (s.player?.worldZ ?? 0) - z) <= tolerance + 2,
            18_000
        )
        .catch(() => {});
    await closeUi();
    await sdk.waitForTicks(1).catch(() => {});
}

/** One 3-tile sendWalk. Refuses a step that enters the green-dragon box. */
async function stepToward(tile: Tile): Promise<boolean> {
    const path = findLongPath(0, pos().x, pos().z, tile.x, tile.z).filter((p) => p.x !== pos().x || p.z !== pos().z);
    let travelled = 0;
    let prev = { x: pos().x, z: pos().z };
    let pick: Tile | null = null;
    for (const p of path) {
        if (inGreenDragons(p.x, p.z)) {
            pick = null;
            break;
        }
        travelled += Math.hypot(p.x - prev.x, p.z - prev.z);
        prev = p;
        if (travelled >= 3) {
            pick = { x: p.x, z: p.z };
            break;
        }
    }
    const before = pos();
    if (!pick) {
        const tx = pos().x;
        const tz = pos().z >= 3770 && pos().z < 3878 ? Math.max(3756, pos().z - 3) : pos().z;
        if (tx === pos().x && tz === pos().z) return false;
        await sendWalkHop(tx, tz, 1, 4_000);
    } else {
        await sendWalkHop(pick.x, pick.z, 1, 4_000);
    }
    return pos().x !== before.x || pos().z !== before.z;
}

async function walkNear(x: number, z: number, tolerance = 4): Promise<boolean> {
    if (distTo(x, z) <= tolerance) return true;
    await openNearbyGate();
    const result = await bot.walkTo(x, z, Math.min(tolerance, 3));
    return result.success || distTo(x, z) <= tolerance + 2;
}

/** Closest hop that does not aim back through the green dragons. */
function resumeHop(hops: Tile[]): number {
    const here = pos();
    let idx = 0;
    let best = Infinity;
    for (let i = 0; i < hops.length; i++) {
        const hop = hops[i]!;
        const d = Math.hypot(here.x - hop.x, here.z - hop.z);
        if (d < best) {
            best = d;
            idx = i;
        }
    }
    return idx;
}

async function walkHops(hops: Tile[], arrive: () => boolean, label: string): Promise<boolean> {
    let cursor = resumeHop(hops);
    let stuck = 0;
    let cursorStaticSince = Date.now();
    let lastCursor = cursor;
    for (let n = 0; n < 280 && !arrive() && !pos().isDead; n++) {
        session.maybeHeartbeat();
        if (pkPressure()) return false;
        if (arrive()) return true;
        // Advance past any hop already reached: 6 matches the success
        // radius below AND runClick's no-op radius (5). A tighter bound
        // deadbands here — dist 5 neither advances nor moves (hop 38 stall).
        while (cursor < hops.length - 1 && distTo(hops[cursor]!.x, hops[cursor]!.z) <= 6) cursor++;
        if (cursor >= hops.length) return arrive();
        const click = clickAhead(pos(), hops, cursor, (x, z) => getDoorAt(0, x, z) != null);
        const hop = click.tile;
        if (distTo(hop.x, hop.z) <= 6) {
            cursor = Math.max(cursor, click.index) + 1;
            continue;
        }
        const before = pos();
        await openDoorAhead(hop);
        const moved = click.straight ? await runClick(hop.x, hop.z) : await stepToward(hop);
        if (distTo(hop.x, hop.z) <= 6) {
            cursor = click.index + 1;
            stuck = 0;
        } else if (!moved && pos().x === before.x && pos().z === before.z) {
            stuck++;
            if (stuck >= 4) {
                session.noteFailure('wildy_hop', `${label} stuck @ ${pos().x},${pos().z} toward ${hop.x},${hop.z}`);
                return false;
            }
        } else {
            stuck = 0;
        }
        // Cross-iteration guard: cursor pinned with no advance for 90s means
        // the success/advance radii disagree again — fail loud, never spin.
        if (cursor !== lastCursor) {
            lastCursor = cursor;
            cursorStaticSince = Date.now();
        } else if (Date.now() - cursorStaticSince > 90_000) {
            session.noteFailure('wildy_hop_static', `${label} cursor pinned at ${cursor} @ ${pos().x},${pos().z}`);
            return false;
        }
        if (n % 8 === 0) session.noteProgress('location', `${pos().x},${pos().z}`);
        if (n % 10 === 0) {
            const dest = hops[hops.length - 1]!;
            log(`Walk ${label} @ ${pos().x},${pos().z} -> ${dest.x},${dest.z} (${Math.round(Math.hypot(pos().x - dest.x, pos().z - dest.z))} tiles, hop ${cursor}/${hops.length})`);
        }
    }
    return arrive();
}

async function crossDitchNorth(): Promise<boolean> {
    if (northOfDitch()) return true;
    intent('Crossing the Edgeville wilderness ditch (sendWalk)');
    await sdk.sendWalk(DITCH_NORTH.x, DITCH_NORTH.z, true);
    await sdk
        .waitForCondition((s) => (s.player?.worldZ ?? 0) >= 3520 || s.player?.isDead === true, 12_000)
        .catch(() => {});
    await closeUi();
    if (!northOfDitch()) {
        await sdk.sendWalk(DITCH_NORTH.x, DITCH_NORTH.z, true);
        await sdk
            .waitForCondition((s) => (s.player?.worldZ ?? 0) >= 3520 || s.player?.isDead === true, 8_000)
            .catch(() => {});
        await closeUi();
    }
    return northOfDitch();
}

async function crossDitchSouth(): Promise<boolean> {
    if (!northOfDitch()) return true;
    intent('Crossing south out of wilderness (sendWalk)');
    await sendWalkTo(DITCH_NORTH.x, DITCH_NORTH.z, 6);
    await sdk.sendWalk(DITCH_SOUTH.x, DITCH_SOUTH.z, true);
    await sdk
        .waitForCondition((s) => (s.player?.worldZ ?? 0) < 3520 || s.player?.isDead === true, 12_000)
        .catch(() => {});
    await closeUi();
    if (northOfDitch()) {
        await sdk.sendWalk(DITCH_SOUTH.x, DITCH_SOUTH.z, true);
        await sdk
            .waitForCondition((s) => (s.player?.worldZ ?? 0) < 3520 || s.player?.isDead === true, 8_000)
            .catch(() => {});
        await closeUi();
    }
    return !northOfDitch();
}

function inBanditCamp(): boolean {
    const p = pos();
    return p.x >= BANDIT_CAMP.xMin && p.x <= BANDIT_CAMP.xMax && p.z >= BANDIT_CAMP.zMin && p.z <= BANDIT_CAMP.zMax;
}

async function escapeBanditCamp(): Promise<void> {
    if (!inBanditCamp()) return;
    intent(`Leaving Bandit Camp east @ ${EAST_OF_BANDITS.x},${EAST_OF_BANDITS.z}`);
    for (let i = 0; i < 8 && inBanditCamp() && !pos().isDead; i++) {
        await sendWalkTo(EAST_OF_BANDITS.x, Math.max(pos().z, EAST_OF_BANDITS.z), 6);
    }
}

let northHops: Tile[] | null = null;
function ditchToHobHops(): Tile[] {
    northHops ??= [...hobToDitchHops()].reverse();
    return northHops;
}

// Cross-call spin guard: walkHops failing from the same tile twice in a row
// means zero progress — cool down so the main loop can never hot-spin.
let lastHobWalk = { x: -1, z: -1, repeats: 0 };
async function goToHob(): Promise<boolean> {
    if (atHobgoblin()) return true;
    if (session.metrics().phase !== 'wildy') await session.setPhase('wildy');
    if (!northOfDitch()) {
        if (!(await bankTrip())) return false;
        if (!(await crossDitchNorth())) {
            session.noteFailure('ditch', 'Could not cross wilderness ditch');
            return false;
        }
    }
    if (inBanditCamp()) await escapeBanditCamp();
    session.setAnchor(HOBGOBLIN.x, HOBGOBLIN.z);
    intent('Hobgoblin mine adamant, east road');
    const ok = await walkHops(ditchToHobHops(), () => atHobgoblin(), 'north');
    const p = pos();
    if (!ok && !atHobgoblin()) {
        if (p.x === lastHobWalk.x && p.z === lastHobWalk.z) {
            lastHobWalk.repeats++;
            session.noteFailure('wildy_noprogress', `north stalled @ ${p.x},${p.z} x${lastHobWalk.repeats}`);
            await sdk.waitForTicks(10).catch(() => {});
        } else {
            lastHobWalk = { x: p.x, z: p.z, repeats: 0 };
        }
    } else {
        lastHobWalk = { x: p.x, z: p.z, repeats: 0 };
    }
    return ok;
}

async function leaveWildy(): Promise<boolean> {
    if (!northOfDitch()) return true;
    if (session.metrics().phase !== 'escape') await session.setPhase('escape');
    if (pos().z < 3600 && distTo(DITCH_NORTH.x, DITCH_NORTH.z) <= 20) {
        await crossDitchSouth();
        return !northOfDitch();
    }
    intent('Leaving hobgoblin mine south, east of Bandit Camp');
    await walkHops(hobToDitchHops(), () => !northOfDitch() || distTo(DITCH_NORTH.x, DITCH_NORTH.z) <= 6, 'south');
    if (northOfDitch() && !pos().isDead && distTo(DITCH_NORTH.x, DITCH_NORTH.z) <= 30) await crossDitchSouth();
    return !northOfDitch();
}

async function goToSurfaceBank(): Promise<boolean> {
    await closeUi();
    if (northOfDitch()) return false;
    if (distTo(EDGEVILLE_BANK.x, EDGEVILLE_BANK.z) <= 8) return true;
    await openNearbyGate();
    intent('Walking to Edgeville bank');
    session.setAnchor(EDGEVILLE_BANK.x, EDGEVILLE_BANK.z);
    for (const p of TO_EDGEVILLE) {
        if (northOfDitch()) return false;
        if (distTo(p.x, p.z) <= 8) continue;
        await walkNear(p.x, p.z, 6);
    }
    if (!northOfDitch() && distTo(EDGEVILLE_BANK.x, EDGEVILLE_BANK.z) > 6) {
        await walkNear(EDGEVILLE_BANK.x, EDGEVILLE_BANK.z, 4);
    }
    return distTo(EDGEVILLE_BANK.x, EDGEVILLE_BANK.z) <= 8;
}

/** Eat at Edgeville, then deposit leftover food — do not take a feast into the wild. */
async function eatAtBank(): Promise<void> {
    const p = pos();
    if (p.hp >= p.maxHp - 3) return;
    if (!(sdk.getState()?.bank?.isOpen || (await bot.openBank()).success)) {
        session.noteFailure('bank_open', 'Edgeville bank open failed (eat)');
        return;
    }
    const best = bankFood();
    if (!best) {
        session.log('warn', `No bank food to eat @ ${p.hp}/${p.maxHp}`);
        await bot.closeBank();
        return;
    }
    const missing = pos().maxHp - pos().hp;
    const heal = Math.max(foodHeal(best.name), 1);
    const take = Math.min(best.count ?? 1, Math.max(1, Math.ceil(missing / heal) + 1), 10);
    intent(`Withdrawing ${take} ${best.name} to eat (${pos().hp}/${pos().maxHp})`);
    await bot.withdrawItem(best, take, { asNote: false });
    await bot.closeBank();
    let bites = 0;
    while (pos().hp < pos().maxHp - 3 && bites < 12) {
        const food = invEdible();
        if (!food) break;
        const before = pos().hp;
        const r = await bot.eatFood(food);
        if (!r.success) break;
        await sdk.waitForCondition((s) => (s.player?.hp ?? 0) > before, 4_000).catch(() => {});
        bites++;
        session.noteProgress('inventory', 'eat');
    }
}

async function armTrip(): Promise<void> {
    // Trip food is sharks: prefer them over whatever heals best.
    const best = sdk.findBankItem(SHARK) ?? bankFood();
    const have = foodCount();
    if (have < FOOD_TARGET && best) {
        const take = Math.min(FOOD_TARGET - have, best.count ?? 0);
        if (take > 0) {
            const r = await bot.withdrawItem(best, take, { asNote: false });
            log(`Withdraw ${take} ${best.name}: ${r.success || r.partial ? 'ok' : r.message}`);
        }
    }
    foodShort = foodCount() < FOOD_TARGET && (sdk.findBankItem(/./)?.count ?? 0) !== -1 && bankFood() == null;
    if (foodShort) session.log('warn', `Only ${foodCount()} food — Edgeville bank has no more`);
}

async function bankTrip(): Promise<boolean> {
    if (session.metrics().phase !== 'deposit') await session.setPhase('deposit');
    const fromX = pos().x;
    const fromZ = pos().z;
    if (!(await goToSurfaceBank())) {
        const nowDist = distTo(EDGEVILLE_BANK.x, EDGEVILLE_BANK.z);
        if (pos().x !== fromX || pos().z !== fromZ) {
            log(`Toward Edgeville @ ${pos().x},${pos().z} (${Math.round(nowDist)} tiles)`);
            return false;
        }
        session.noteFailure('bank_walk', 'Could not reach Edgeville');
        return false;
    }
    if (!(sdk.getState()?.bank?.isOpen || (await bot.openBank()).success)) {
        session.noteFailure('bank_open', 'Edgeville bank open failed');
        return false;
    }
    const before = countAddy();
    for (const item of sdk.getInventory()) {
        const name = item.name?.trim();
        if (!name || !ADDY.test(name)) continue;
        if ((item.count ?? 0) > 0) session.recordGain(name, item.count ?? 1);
    }
    for (;;) {
        const item = extras().find((i) => ADDY.test(i.name)) ?? extras()[0];
        if (!item) break;
        // Keep the pickaxe and trip food; deposit everything else (ore first).
        if (PICKAXE.test(item.name) || (isFood(item.name) && foodCount() <= FOOD_TARGET)) break;
        const r = await bot.depositItem(item, -1);
        if (!r.success) break;
    }
    // Deposits above skip kept food; sweep remaining ore-only extras.
    for (;;) {
        const item = sdk
            .getInventory()
            .filter((i) => (i.count ?? 0) > 0 && ADDY.test(i.name))[0];
        if (!item) break;
        const r = await bot.depositItem(item, -1);
        if (!r.success) break;
    }
    if (!hasPickaxe()) {
        const pick =
            sdk.findBankItem(/^rune pickaxe$/i) ??
            sdk.findBankItem(/^adamant pickaxe$/i) ??
            sdk.findBankItem(PICKAXE);
        if (pick) await bot.withdrawItem(pick, 1);
    }
    session.captureBankStock();
    await bot.closeBank();
    // Re-wear kit after a PK death: keepers land in the pack, and unworn
    // gear means flee-only. Wields from the pack, never the bank.
    for (const pat of [DLONG, LEGS]) {
        if (!sdk.findEquipmentItem(pat)) {
            const carried = sdk.findInventoryItem(pat);
            if (carried) {
                const e = await bot.equipItem(carried);
                log(`Re-wear ${carried.name}: ${e.success ? 'ok' : e.message}`);
            }
        }
    }
    await eatAtBank();
    // Re-open for the food top-up (eatAtBank closed the bank).
    if (sdk.getState()?.bank?.isOpen || (await bot.openBank()).success) {
        await armTrip();
        // Keep the fight kit stocked: dlong + rune legs. Either may be lost
        // to a death or (before the kept() fix) a deposit sweep — pull from
        // the bank when neither worn nor carried. The pick is never at risk:
        // with only dlong + pick + legs as valuables all three are keepers.
        for (const [pat, label] of [[DLONG, 'dlong'], [LEGS, 'legs']] as const) {
            if (!sdk.findEquipmentItem(pat) && !sdk.findInventoryItem(pat)) {
                const stocked = sdk.findBankItem(pat);
                if (stocked) {
                    const w = await bot.withdrawItem(stocked, 1, { asNote: false });
                    log(`Withdraw ${label}: ${w.success || w.partial ? 'ok' : w.message}`);
                } else {
                    session.log('warn', `No ${label} in bank to restock`);
                }
            }
        }
        session.captureBankStock();
        await bot.closeBank();
    }
    const deposited = before - countAddy();
    if (deposited > 0) {
        banked += deposited;
        session.recordTrip(deposited);
    }
    session.noteProgress('bank', 'edgeville');
    log(`Banked ${deposited} addy | trip ${session.metrics().trips} total ${banked} | deaths ${deaths} | Mining ${mining()} (${miningXp()} xp)`);
    // Top up prayer at the monastery while at Edgeville (skips when full).
    await rechargePrayer();
    // Re-stage at the bank tile (the trip — and goToHob after it — assumes it).
    for (const hop of [
        { x: 3070, z: 3490 },
        { x: EDGEVILLE_BANK.x, z: EDGEVILLE_BANK.z }
    ]) {
        if (distTo(hop.x, hop.z) > 6) await walkNear(hop.x, hop.z, 4);
    }
    return hasPickaxe();
}

function addyRocks() {
    return (sdk.getNearbyLocs() ?? [])
        .filter(
            (l) =>
                ADDY_ROCK.test(l.name) &&
                l.optionsWithIndex.some((o) => /^mine$/i.test(o.text)) &&
                l.reachable !== false
        )
        .sort((a, b) => (a.distance ?? 99) - (b.distance ?? 99));
}

async function eatWild(): Promise<void> {
    // Conserve trip food for PK fights: ignore NPC chip damage out here and
    // eat only below half HP. The bank heals to full for free, and the
    // post-PK path heals to full from the trip stock.
    while (pos().hp <= Math.floor(pos().maxHp / 2) && !pos().isDead) {
        const food = invEdible();
        if (!food) break;
        const before = pos().hp;
        const r = await bot.eatFood(food);
        if (!r.success) break;
        await sdk.waitForCondition((s) => (s.player?.hp ?? 0) > before, 4_000).catch(() => {});
    }
}

/** Heal to FULL hp (post-fight) — eats everything edible until topped. */
async function healToFull(): Promise<void> {
    let bites = 0;
    while (pos().hp < pos().maxHp && !pos().isDead && bites < 12) {
        const food = invEdible();
        if (!food) break;
        const before = pos().hp;
        const r = await bot.eatFood(food);
        if (!r.success) break;
        await sdk.waitForCondition((s) => (s.player?.hp ?? 0) > before, 4_000).catch(() => {});
        bites++;
        session.noteProgress('inventory', 'eat');
    }
    log(`Heal-to-full ${pos().hp}/${pos().maxHp} (${bites} bites, ${foodCount()} food left)`);
}

/** PKer on us: fight back with the dlong if worn, else flee south. */
async function handlePker(): Promise<void> {
    if (!antiPk.wearingDlong()) {
        log('Player attack, no dlong worn — fleeing south, no retaliation');
        await leaveWildy();
        if (pos().isDead) return;
        await bankTrip();
        return;
    }
    const fb = await antiPk.fightBackIfPked();
    log(`PK fight: ${fb.reason}`);
    // Stay in the fight eating: one shark was never enough against a spec
    // dump. Keep topping up until combat drops, we die, food runs out, or
    // the cap hits. Prayer + spec + retaliation are already running.
    const end = Date.now() + 75_000;
    for (;;) {
        if (pos().isDead) return;
        if (Date.now() >= end) break;
        const c = sdk.getState()?.player?.combat;
        if (c?.inCombat !== true) break;
        const p = pos();
        if (p.hp < p.maxHp - 10) {
            const food = invEdible();
            if (!food) break;
            const before = p.hp;
            const r = await bot.eatFood(food);
            if (!r.success) break;
            session.noteProgress('inventory', 'eat');
            await sdk.waitForCondition((s) => (s.player?.hp ?? 0) > before, 4_000).catch(() => {});
        } else {
            await sdk.waitForTicks(2).catch(() => {});
        }
    }
    if (pos().isDead) return;
    const loot = await antiPk.lootKill();
    if (loot.picked > 0) session.noteProgress('inventory', 'pk-loot');
    await healToFull();
    // Prayers off after the fight — no point draining points at the mine.
    await bot.deactivateAllPrayers().catch(() => {});
    // Fight turned bad (still hurt, no food): bank and re-arm.
    if (needsHeal() && foodCount() === 0) {
        log('Post-fight hurt with no food — banking to re-arm');
        if (northOfDitch()) await leaveWildy();
        if (pos().isDead) return;
        await bankTrip();
    }
}

async function mineAddy(): Promise<boolean> {
    await closeUi();
    if (!atHobgoblin() || freeSlots() <= 0) return false;
    let rocks = addyRocks();
    if (!rocks.length) {
        await sdk.scanNearbyLocs(12).catch(() => {});
        rocks = addyRocks();
    }
    if (!rocks.length) {
        session.noteFailure('addy', `No adamant rock nearby @ ${pos().x},${pos().z}`);
        return false;
    }
    const rock = rocks[0]!;
    if ((rock.distance ?? 99) > 2) await sendWalkTo(rock.x, rock.z, 2);
    const before = countAddy();
    const xpBefore = miningXp();
    const life = pos().lifeId;
    const mine = rock.optionsWithIndex.find((o) => /^mine$/i.test(o.text));
    intent(`Mine ${rock.name} @ ${rock.x},${rock.z}`);
    if (mine) await sdk.sendInteractLoc(rock.x, rock.z, rock.id, mine.opIndex);
    await sdk
        .waitForCondition(
            (s) =>
                s.player?.isDead === true ||
                s.player?.lifeId !== life ||
                s.inventory.filter((i) => ADDY.test(i.name)).reduce((n, i) => n + (i.count ?? 1), 0) > before ||
                (s.skills.find((sk) => sk.name === 'Mining')?.experience ?? 0) > xpBefore ||
                pkPressure(),
            20_000
        )
        .catch(() => {});
    await closeUi();
    await eatWild();
    if (countAddy() > before || miningXp() > xpBefore) {
        session.noteProgress('xp', 'adamant');
        log(`Mined addy ${countAddy()} free=${freeSlots()} @ ${pos().x},${pos().z}`);
        return true;
    }
    if (pkPressure() || pos().isDead) return false;
    session.noteFailure('addy', `Nothing from ${rock.name}`);
    return false;
}

async function mineAllAddy(): Promise<void> {
    if (session.metrics().phase !== 'addy') await session.setPhase('addy');
    let dry = 0;
    while (!pos().isDead && freeSlots() > 0 && dry < 3 && !pkPressure()) {
        session.maybeHeartbeat();
        if (!atHobgoblin()) return;
        if (needsHeal() && foodCount() === 0) return;
        if (needsHeal()) await eatWild();
        const mined = await mineAddy();
        if (mined) dry = 0;
        else {
            dry++;
            if (dry < 3) await sdk.waitForTicks(4).catch(() => {});
        }
    }
    log(`Hobgoblin clear addy ${countAddy()} free=${freeSlots()} @ ${pos().x},${pos().z}`);
}

async function waitRespawn(): Promise<void> {
    const life = pos().lifeId;
    deaths++;
    log(`Died life ${life} @ ${pos().x},${pos().z} ore=${countAddy()} — waiting respawn`);
    intent('Dead — waiting Lumbridge respawn');
    await sdk.waitForCondition((s) => !s.player?.isDead && s.player?.lifeId !== life, 45_000).catch(() => {});
    await closeUi();
    session.noteProgress('location', 'respawn');
}

session.registerRecovery([
    {
        name: 'heal',
        run: async () => {
            if (!needsHeal()) return false;
            if (foodCount() > 0) {
                await eatWild();
                return !needsHeal();
            }
            if (northOfDitch()) await leaveWildy();
            return bankTrip();
        }
    },
    {
        name: 'bank_ore',
        run: async () => {
            if (!shouldBank()) return false;
            if (northOfDitch()) await leaveWildy();
            return bankTrip();
        }
    },
    {
        name: 'to_hob',
        run: async () => {
            if (shouldBank()) return false;
            return goToHob();
        }
    }
]);

let deathsThisSession = 0;
const MAX_DEATHS_PER_SESSION = 3;
let startHeal = true;

try {
    await bot.skipTutorial();
    await closeUi();
    log(
        `Hobgoblin adamant start Mining ${mining()} (${miningXp()} xp) ` +
            `@ ${pos().x},${pos().z} hp=${pos().hp}/${pos().maxHp} pick=${sdk.findEquipmentItem(PICKAXE)?.name ?? sdk.findInventoryItem(PICKAXE)?.name ?? 'none'}`
    );

    if (mining() < 40) {
        session.stop('mining_level', `Mining ${mining()} — adamant needs 40`);
    }

    while (!session.isStopped()) {
        session.maybeHeartbeat();
        await closeUi();
        if (pos().isDead) {
            deathsThisSession++;
            await waitRespawn();
            if (deathsThisSession >= MAX_DEATHS_PER_SESSION) {
                session.stopRestartable('death_cap', `Died ${deathsThisSession} times this session`);
                break;
            }
            if (!hasPickaxe()) {
                if (northOfDitch()) await leaveWildy();
                await bankTrip();
                if (!hasPickaxe()) {
                    session.stop('cannot_regear', 'No pickaxe in bank after death');
                    break;
                }
            }
            continue;
        }
        if (seePker() || pkPressure()) {
            await handlePker();
            if (pos().isDead) continue;
            continue;
        }
        if (session.needsRecovery()) {
            if ((await session.recover()) === 'exhausted') break;
            continue;
        }
        if (startHeal) {
            startHeal = false;
            if (pos().hp < pos().maxHp - 8) {
                log(`Start heal ${pos().hp}/${pos().maxHp} — Edgeville eat then hobgoblin`);
                if (northOfDitch()) await leaveWildy();
                if (pos().isDead) continue;
                await bankTrip();
                continue;
            }
        }
        if (needsHeal() && foodCount() === 0) {
            if (northOfDitch()) await leaveWildy();
            if (pos().isDead) continue;
            await bankTrip();
            continue;
        }
        if (shouldBank()) {
            if (northOfDitch()) await leaveWildy();
            if (pos().isDead) continue;
            await bankTrip();
            continue;
        }
        if (!hasPickaxe()) {
            if (northOfDitch()) await leaveWildy();
            await bankTrip();
            if (!hasPickaxe()) {
                session.stop('no_pickaxe', 'No pickaxe after bank — check Edgeville');
                break;
            }
            continue;
        }
        if (atHobgoblin() && freeSlots() > 0) {
            if (session.metrics().phase !== 'addy') await session.setPhase('addy');
            await mineAllAddy();
            continue;
        }
        if (!atHobgoblin()) {
            await goToHob();
            continue;
        }
        if (session.metrics().phase !== 'addy') await session.setPhase('addy');
        await mineAddy();
    }

    const stop = session.metrics().stopReason;
    if (stop) log(`stopped ${stop.code} @ ${stop.location.x},${stop.location.z}`);
} catch (err) {
    console.error('Script error:', err);
} finally {
    await session.finalizeStop();
    console.log('Disconnecting SDK; browser client can stay open.');
    await sdk.disconnect();
}
