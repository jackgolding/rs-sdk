/**
 * Wilderness black unicorns (3216, 3676), east of the Chaos Temple.
 * Range, bury bones, pick up unicorn horns. Bank 2 swordfish at Edgeville
 * and deposit every horn. Never bot.walkTo north of the ditch.
 *
 *   bun bots/quests/wildy-black-unicorns.ts fatpig
 */
import { existsSync, readFileSync } from 'fs';
import { dirname, join } from 'path';
import { ActivitySession, BotSDK, deriveGatewayUrl, inWilderness } from '../../sdk/index';
import { BotActions } from '../../sdk/actions';
import { findLongPath, initPathfinding } from '../../sdk/pathfinding';
import { EDGEVILLE } from './tiles';
import { closeUi } from './movement';
import { foodHeal, needsBankHeal } from './food-heal';
import { installGracefulShutdown } from '../../sdk/runner';

const CAMP = { x: 3216, z: 3676 };
const DITCH_NORTH = { x: 3195, z: 3525 };
const DITCH_SOUTH = { x: 3194, z: 3518 };
const FOOD_WITHDRAW = 2;
const RANGE_MAX = 9;
const HUNT_RADIUS = 32;
const SEND_STEP = 64;

const TO_CAMP = [
    { x: 3195, z: 3525 },
    { x: 3194, z: 3586 },
    { x: 3199, z: 3649 },
    { x: 3216, z: 3676 }
];

const UNICORN = /^black unicorn$/i;
const HORN = /^unicorn horn$/i;
const BONES = /^bones$/i;
const ARROW = /^(bronze|iron|steel|mithril|adamant|rune) arrows?$/i;
const ARROW_TIER = ['rune', 'adamant', 'mithril', 'steel', 'iron', 'bronze'];
const SWORDFISH = /^swordfish$/i;
const BOW = /bow/i;
const NO_AMMO = /no ammo left in your quiver/i;

function shouldKeep(name: string): boolean {
    return (
        SWORDFISH.test(name) ||
        ARROW.test(name) ||
        BOW.test(name) ||
        /dragonhide|d'hide|vambraces|leather boots|med helm|^coins$/i.test(name)
    );
}

const argv = process.argv.slice(2);
const botArg = argv.find((a) => !a.startsWith('-'));

function loadBotEnv(): void {
    const envPath = botArg
        ? join(process.cwd(), 'bots', botArg, 'bot.env')
        : join(dirname(import.meta.path), 'bot.env');
    if (!existsSync(envPath)) {
        throw new Error(`bot.env not found at ${envPath}. Usage: bun bots/quests/wildy-black-unicorns.ts {botname}`);
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
    name: 'wildy-black-unicorns',
    grindLogPath: GRIND_LOG,
    stallMs: 180_000,
    maxRecoveryTactics: 8
});

installGracefulShutdown({ graceMs: 30_000 });

let quiverEmpty = false;
let lastRange = 0;

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

function northOfDitch(): boolean {
    const p = pos();
    return inWilderness(p.x, p.z);
}

function atCamp(): boolean {
    return distTo(CAMP.x, CAMP.z) <= 16;
}

function occupied(): number {
    return sdk.getInventory().filter((i) => (i.count ?? 0) > 0).length;
}

function count(pattern: RegExp): number {
    return sdk.getInventory().filter((i) => pattern.test(i.name)).reduce((n, i) => n + (i.count ?? 1), 0);
}

function swordfishCount(): number {
    return sdk.getInventory().filter((i) => SWORDFISH.test(i.name)).length;
}

function hornCount(): number {
    return count(HORN);
}

function edible() {
    return sdk.getInventory().filter((i) => foodHeal(i.name) > 0 || (i.optionsWithIndex ?? []).some((o) => /eat/i.test(o.text)));
}

function foodCount(): number {
    return edible().length;
}

function arrowTier(name: string): number {
    const i = ARROW_TIER.findIndex((t) => name.toLowerCase().startsWith(t));
    return i < 0 ? 99 : i;
}

function arrowCount(): number {
    const worn = sdk.getEquipment().filter((i) => ARROW.test(i.name)).reduce((n, i) => n + (i.count ?? 0), 0);
    return worn + count(ARROW);
}

function noteAmmoChat(): void {
    if (sdk.getNewChat({ types: [0] }).some((m) => NO_AMMO.test(m.text))) quiverEmpty = true;
}

function rangedLevel(): number {
    return sdk.getSkill('Ranged')?.baseLevel ?? 1;
}

function rangedXp(): number {
    return sdk.getSkill('Ranged')?.experience ?? 0;
}

function isLoot(g: { name: string }): boolean {
    return HORN.test(g.name) || BONES.test(g.name);
}

function lootPriority(name: string): number {
    if (HORN.test(name)) return 0;
    if (BONES.test(name)) return 1;
    return 9;
}

async function ui(): Promise<void> {
    await closeUi(bot, sdk);
}

/** Pathfinder routes wildy walkTo back to Edgeville — sendWalk only north of the ditch. */
async function sendWalkTo(x: number, z: number, tolerance = 8): Promise<void> {
    await ui();
    if (distTo(x, z) <= tolerance) return;
    const hops: { x: number; z: number }[] = [];
    const path = findLongPath(0, pos().x, pos().z, x, z);
    if (path.length > 0) {
        let last = { x: pos().x, z: pos().z };
        for (const p of path) {
            if (Math.hypot(p.x - last.x, p.z - last.z) >= SEND_STEP) {
                hops.push({ x: p.x, z: p.z });
                last = { x: p.x, z: p.z };
            }
        }
    }
    hops.push({ x, z });
    for (const hop of hops) {
        if (pos().isDead) return;
        if (distTo(hop.x, hop.z) <= tolerance) continue;
        await sdk.sendWalk(hop.x, hop.z, true);
        await sdk
            .waitForCondition(
                (s) =>
                    s.player?.isDead === true ||
                    Math.hypot((s.player?.worldX ?? 0) - hop.x, (s.player?.worldZ ?? 0) - hop.z) <=
                        tolerance + 2,
                18_000
            )
            .catch(() => {});
        await ui();
        session.noteProgress('location', `${pos().x},${pos().z}`);
    }
}

function skipIfFarther(wp: { x: number; z: number }, dest: { x: number; z: number }): boolean {
    if (distTo(wp.x, wp.z) <= 8) return true;
    const remaining = distTo(dest.x, dest.z);
    const via = distTo(wp.x, wp.z) + Math.hypot(wp.x - dest.x, wp.z - dest.z);
    return via >= remaining - 6;
}

async function walkWaypointsSend(points: { x: number; z: number }[], dest: { x: number; z: number }): Promise<void> {
    for (const wp of points) {
        if (pos().isDead) return;
        await eatIfNeeded();
        if (skipIfFarther(wp, dest)) continue;
        await sendWalkTo(wp.x, wp.z, 8);
        session.noteProgress('location', `${wp.x},${wp.z}`);
    }
    if (!pos().isDead && distTo(dest.x, dest.z) > 6) await sendWalkTo(dest.x, dest.z, 4);
}

async function crossDitchNorth(): Promise<boolean> {
    if (northOfDitch()) return true;
    intent('Crossing the east wilderness ditch (sendWalk)');
    if (distTo(DITCH_SOUTH.x, DITCH_SOUTH.z) > 8) {
        const r = await bot.walkTo(DITCH_SOUTH.x, DITCH_SOUTH.z, 3);
        if (!r.success && distTo(DITCH_SOUTH.x, DITCH_SOUTH.z) > 10) {
            session.noteFailure('ditch', `walkTo east ditch: ${r.message}`);
            return false;
        }
    }
    await sdk.sendWalk(DITCH_NORTH.x, DITCH_NORTH.z, true);
    await sdk
        .waitForCondition((s) => (s.player?.worldZ ?? 0) >= 3520 || s.player?.isDead === true, 12_000)
        .catch(() => {});
    if (!northOfDitch()) {
        await sdk.sendWalk(DITCH_NORTH.x, DITCH_NORTH.z, true);
        await sdk
            .waitForCondition((s) => (s.player?.worldZ ?? 0) >= 3520 || s.player?.isDead === true, 8_000)
            .catch(() => {});
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
    if (northOfDitch()) {
        await sdk.sendWalk(DITCH_SOUTH.x, DITCH_SOUTH.z, true);
        await sdk
            .waitForCondition((s) => (s.player?.worldZ ?? 0) < 3520 || s.player?.isDead === true, 8_000)
            .catch(() => {});
    }
    return !northOfDitch();
}

async function leaveWildy(): Promise<boolean> {
    if (!northOfDitch()) return true;
    if (session.metrics().phase !== 'escape') await session.setPhase('escape');
    intent('Leaving wilderness (sendWalk south)');
    await eatIfNeeded();
    await sendWalkTo(DITCH_NORTH.x, DITCH_NORTH.z, 6);
    if (northOfDitch() && !pos().isDead) await crossDitchSouth();
    return !northOfDitch();
}

async function goToCamp(): Promise<boolean> {
    if (atCamp()) return true;
    if (session.metrics().phase !== 'travel') await session.setPhase('travel');
    session.setAnchor(CAMP.x, CAMP.z);
    if (!northOfDitch()) {
        if ((swordfishCount() < 1 || swordfishCount() > FOOD_WITHDRAW) && !(await bankTrip())) return false;
        if (!(await crossDitchNorth())) {
            session.noteFailure('ditch', 'Could not cross wilderness ditch');
            return false;
        }
    }
    intent(`Wildy sendWalk to black unicorns @ ${CAMP.x},${CAMP.z}`);
    await walkWaypointsSend(TO_CAMP, CAMP);
    if (!atCamp() && !pos().isDead) await sendWalkTo(CAMP.x, CAMP.z, 6);
    if (atCamp()) session.noteProgress('location', 'black unicorns');
    return atCamp();
}

async function eatIfNeeded(): Promise<void> {
    const p = pos();
    const panic = p.targetType === 'player' || p.hp <= Math.max(35, Math.floor(p.maxHp * 0.4));
    if (!panic) return;
    const foods = edible().sort((a, b) => foodHeal(b.name) - foodHeal(a.name));
    const food = foods[0];
    if (!food) return;
    const r = await bot.eatFood(food);
    if (r.success) {
        session.noteProgress('inventory', 'eat');
        log(`Ate ${food.name} +${r.hpGained} HP ${pos().hp}/${pos().maxHp} swordfish=${swordfishCount()}`);
    }
}

async function setLongrange(): Promise<void> {
    const style = sdk.getState()?.combatStyle?.styles.find((s) => s.type === 'Longrange' || /long.?range/i.test(s.name));
    if (!style) return;
    if (sdk.getState()?.combatStyle?.currentStyle === style.index) return;
    await sdk.sendSetCombatStyle(style.index);
    await sdk.waitForCondition((s) => s.combatStyle?.currentStyle === style.index, 5_000).catch(() => {});
    log(`Combat style ${style.name} (${style.type})`);
}

async function equipArrows(): Promise<void> {
    const inv = sdk
        .getInventory()
        .filter((i) => ARROW.test(i.name))
        .sort((a, b) => arrowTier(a.name) - arrowTier(b.name));
    const worn = sdk.findEquipmentItem(ARROW);
    const best = inv[0];
    if (!best) return;
    const better = !worn || arrowTier(best.name) < arrowTier(worn.name);
    const same = !!worn && arrowTier(best.name) === arrowTier(worn.name);
    if (!better && !same) return;
    const r = await bot.equipItem(best);
    if (r.success) {
        quiverEmpty = false;
        log(`Wield ${best.count} ${best.name}`);
    }
}

async function buryBones(): Promise<void> {
    for (let i = 0; i < 8; i++) {
        await bot.dismissBlockingUI();
        const bones = sdk.findInventoryItem(BONES);
        if (!bones) return;
        const bury = bones.optionsWithIndex.find((o) => /bury/i.test(o.text));
        if (!bury) return;
        await sdk.sendUseItem(bones.slot, bury.opIndex);
        await sdk.waitForTicks(1);
    }
}

async function pickupNear(item: { x: number; z: number; id: number; name: string; count: number; distance: number }): Promise<boolean> {
    if (item.distance > 2) await sendWalkTo(item.x, item.z, 2);
    const before = sdk.getInventory().filter((i) => i.id === item.id).reduce((n, i) => n + (i.count ?? 1), 0);
    await sdk.sendPickup(item.x, item.z, item.id);
    try {
        await sdk.waitForCondition((s) => {
            const got = s.inventory.filter((i) => i.id === item.id).reduce((n, i) => n + (i.count ?? 1), 0) > before;
            const gone = !s.groundItems.some((g) => g.x === item.x && g.z === item.z && g.id === item.id);
            return got || gone || s.player?.isDead === true;
        }, 8_000);
    } catch {
        return false;
    }
    const got = sdk.getInventory().filter((i) => i.id === item.id).reduce((n, i) => n + (i.count ?? 1), 0) > before;
    if (got) {
        session.noteProgress('inventory', item.name);
        log(`Picked ${item.count} ${item.name} horns=${hornCount()}`);
        if (BONES.test(item.name)) await buryBones();
    }
    return got;
}

async function lootGround(): Promise<void> {
    for (let i = 0; i < 8; i++) {
        await eatIfNeeded();
        if (pos().hp <= 30) return;
        await buryBones();
        const ground = [...(sdk.getGroundItems() ?? [])];
        const item = ground
            .filter((g) => isLoot(g) && g.reachable !== false && (g.distance ?? 99) <= 12)
            .sort((a, b) => lootPriority(a.name) - lootPriority(b.name) || (a.distance ?? 99) - (b.distance ?? 99))[0];
        if (!item) return;
        if (occupied() >= 28 && !BONES.test(item.name)) {
            await buryBones();
            if (occupied() >= 28) return;
        }
        const ok = await pickupNear(item);
        if (!ok) return;
    }
}

function findUnicorn() {
    const mine = pos().targetIndex;
    return (
        (sdk.getNearbyNpcs() ?? [])
            .filter(
                (n) =>
                    UNICORN.test(n.name) &&
                    (n.hp === null || n.hp > 0) &&
                    n.optionsWithIndex.some((o) => /attack/i.test(o.text)) &&
                    (n.reachable !== false || (n.distance ?? 99) <= RANGE_MAX) &&
                    distTo(n.x, n.z) <= HUNT_RADIUS + 8
            )
            .sort((a, b) => {
                const aMine = a.index === mine ? 0 : 1;
                const bMine = b.index === mine ? 0 : 1;
                if (aMine !== bMine) return aMine - bMine;
                const aBusy = a.inCombat && a.index !== mine ? 1 : 0;
                const bBusy = b.inCombat && b.index !== mine ? 1 : 0;
                if (aBusy !== bBusy) return aBusy - bBusy;
                return (a.distance ?? 99) - (b.distance ?? 99);
            })[0] ?? null
    );
}

function hasUnicornTarget(): boolean {
    const p = pos();
    if (!p.inCombat || p.targetType !== 'npc' || p.targetIndex < 0) return false;
    const target = sdk.getNearbyNpcs().find((n) => n.index === p.targetIndex);
    return !!target && UNICORN.test(target.name) && (target.hp === null || target.hp > 0);
}

async function chaseUnicorn(): Promise<void> {
    if (!hasUnicornTarget()) return;
    const target = sdk.getNearbyNpcs().find((n) => n.index === pos().targetIndex);
    if (!target) return;
    const d = target.distance ?? 99;
    if (d > RANGE_MAX) {
        intent(`Chasing black unicorn (${d | 0} tiles)`);
        await sendWalkTo(target.x, target.z, 5);
    }
}

async function attackUnicorn(): Promise<void> {
    if (hasUnicornTarget()) {
        await waitFight();
        return;
    }
    const target = findUnicorn();
    if (!target) {
        if (distTo(CAMP.x, CAMP.z) > 8) await sendWalkTo(CAMP.x, CAMP.z, 6);
        else await sdk.waitForTicks(2);
        return;
    }
    const d = target.distance ?? 99;
    if (d > RANGE_MAX) await sendWalkTo(target.x, target.z, 5);
    const opt = target.optionsWithIndex.find((o) => /attack/i.test(o.text));
    if (!opt) return;
    intent(`Attack black unicorn @ ${target.x},${target.z}`);
    await sdk.sendInteractNpc(target.index, opt.opIndex);
    try {
        await sdk.waitForCondition((s) => {
            if (s.player?.isDead) return true;
            if (s.player?.combat?.inCombat && s.player.combat.targetIndex === target.index) return true;
            return !s.nearbyNpcs.some((n) => n.index === target.index && (n.hp === null || n.hp > 0));
        }, 8_000);
    } catch {
        /* recast next loop */
    }
    await waitFight();
}

async function waitFight(): Promise<void> {
    const started = Date.now();
    const xpBefore = rangedXp();
    while (hasUnicornTarget() && !pos().isDead && Date.now() - started < 45_000) {
        await bot.dismissBlockingUI();
        await eatIfNeeded();
        noteAmmoChat();
        if (quiverEmpty && arrowCount() <= 0) return;
        await chaseUnicorn();
        if (pos().targetType === 'player') return;
        if (pos().hp > 35) await lootGround();
        await sdk.waitForTicks(1);
    }
    if (rangedXp() > xpBefore) session.noteProgress('xp', `ranged ${rangedXp()}`);
    await buryBones();
    await lootGround();
    await equipArrows();
}

async function fleePlayer(): Promise<boolean> {
    if (pos().targetType !== 'player' || !pos().inCombat) return false;
    session.log('warn', `Player combat @ ${pos().x},${pos().z} — running south`);
    await eatIfNeeded();
    await leaveWildy();
    return true;
}

async function bankTrip(): Promise<boolean> {
    if (session.metrics().phase !== 'bank') await session.setPhase('bank');
    if (northOfDitch()) {
        if (!(await leaveWildy())) return false;
    }
    if (pos().isDead) return false;
    intent('Banking at Edgeville');
    if (distTo(EDGEVILLE.x, EDGEVILLE.z) > 6) {
        const r = await bot.walkTo(EDGEVILLE.x, EDGEVILLE.z, 3);
        if (!r.success && distTo(EDGEVILLE.x, EDGEVILLE.z) > 8) {
            session.noteFailure('bank', `walkTo Edgeville: ${r.message}`);
            return false;
        }
    }
    const opened = await bot.openBank();
    if (!opened.success) {
        session.noteFailure('bank', `openBank: ${opened.message}`);
        return false;
    }
    for (const item of sdk.getInventory()) {
        if ((item.count ?? 0) <= 0) continue;
        if (shouldKeep(item.name)) continue;
        await bot.depositItem(item, -1);
    }
    if (swordfishCount() > FOOD_WITHDRAW) {
        await bot.depositItem(SWORDFISH, swordfishCount() - FOOD_WITHDRAW);
    }
    const short = FOOD_WITHDRAW - swordfishCount();
    if (short > 0) {
        const r = await bot.withdrawItem(SWORDFISH, short);
        log(`Withdraw swordfish ${short}: ${r.success ? 'ok' : r.message}`);
    }
    if (arrowCount() < 50) {
        await bot.withdrawItem(ARROW, -1).catch(() => {});
    }
    await bot.closeBank();
    await equipArrows();
    const bow = sdk.findInventoryItem(BOW);
    if (bow && !sdk.findEquipmentItem(BOW)) await bot.equipItem(bow);
    await setLongrange();
    quiverEmpty = false;
    session.noteProgress('bank', `swordfish ${swordfishCount()} horns deposited`);
    log(`Loadout swordfish=${swordfishCount()} arrows=${arrowCount()} horns=${hornCount()} slots=${occupied()}`);
    return swordfishCount() > 0;
}

function shouldBank(): boolean {
    if (swordfishCount() < 1) return true;
    if (swordfishCount() > FOOD_WITHDRAW) return true;
    if (occupied() >= 27 && foodCount() > 0) return true;
    if (quiverEmpty && arrowCount() <= 0) return true;
    if (needsBankHeal(pos().hp, pos().maxHp) && swordfishCount() < FOOD_WITHDRAW) return true;
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
        name: 'to_camp',
        run: async () => goToCamp()
    },
    {
        name: 'bank_food',
        run: async () => {
            if (northOfDitch()) await leaveWildy();
            return bankTrip();
        }
    }
]);
session.setAnchor(CAMP.x, CAMP.z);

try {
    await bot.skipTutorial();
    await ui();
    lastRange = rangedLevel();
    log(
        `Black unicorns @ ${pos().x},${pos().z} | Ranged ${lastRange} (${rangedXp()} xp) ` +
            `HP ${pos().hp}/${pos().maxHp} swordfish=${swordfishCount()} arrows=${arrowCount()} horns=${hornCount()}`
    );
    await setLongrange();
    await equipArrows();
    noteAmmoChat();

    let deathsThisSession = 0;
    const MAX_DEATHS_PER_SESSION = 3;

    while (!session.isStopped()) {
        session.maybeHeartbeat();
        if (session.needsRecovery()) {
            if ((await session.recover()) === 'exhausted') break;
            continue;
        }
        await ui();

        if (pos().isDead) {
            deathsThisSession++;
            await waitRespawn();
            if (deathsThisSession >= MAX_DEATHS_PER_SESSION) {
                session.stopRestartable('death_cap', `Died ${deathsThisSession} times this session`);
                break;
            }
            if (shouldBank() || swordfishCount() === 0) {
                if (northOfDitch()) await leaveWildy();
                await bankTrip();
                if (swordfishCount() === 0) {
                    session.stop('cannot_regear', 'No swordfish in bank after death');
                    break;
                }
            }
            continue;
        }

        const range = rangedLevel();
        if (range !== lastRange) {
            log(`LEVEL UP Ranged ${range} (${rangedXp()} xp) | swordfish ${swordfishCount()} horns ${hornCount()}`);
            lastRange = range;
            session.noteProgress('xp', `ranged ${range}`);
        }

        await eatIfNeeded();
        if (await fleePlayer()) {
            if (!pos().isDead) await bankTrip();
            continue;
        }

        if (shouldBank()) {
            log(`Banking swordfish=${swordfishCount()} horns=${hornCount()} slots=${occupied()} arrows=${arrowCount()}`);
            if (northOfDitch()) await leaveWildy();
            if (pos().isDead) continue;
            if (!(await bankTrip())) {
                await sdk.waitForTicks(5);
                continue;
            }
            continue;
        }

        if (!atCamp() && distTo(CAMP.x, CAMP.z) > HUNT_RADIUS) {
            await goToCamp();
            continue;
        }

        if (session.metrics().phase !== 'hunt') await session.setPhase('hunt');
        session.setAnchor(CAMP.x, CAMP.z);
        await lootGround();
        await attackUnicorn();
    }
} catch (err) {
    session.stop('script_error', err instanceof Error ? err.message : String(err));
    console.error('Script error:', err);
} finally {
    await session.finalizeStop();
    await sdk.disconnect();
}
