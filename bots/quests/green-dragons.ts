/**
 * Wilderness green dragons (3078, 3810), south of the lava maze.
 * Melee, bury dragon bones, loot hides / nature runes / rares.
 * Bank at Edgeville: 16 swordfish, one super attack dose (leftover pot stays in bank).
 * Never bot.walkTo north of the ditch.
 *
 *   bun bots/quests/green-dragons.ts jackthief
 */
import { existsSync, readFileSync } from 'fs';
import { dirname, join } from 'path';
import { ActivitySession, BotSDK, deriveGatewayUrl, inWilderness } from '../../sdk/index';
import { BotActions } from '../../sdk/actions';
import { initPathfinding } from '../../sdk/pathfinding';
import { EDGEVILLE } from './tiles';
import { closeUi } from './movement';
import { foodHeal, needsBankHeal } from './food-heal';
import { LAVA_MAZE_EAST, southOfLavaMaze } from './rune-rocks-route';

const CAMP = { x: 3078, z: 3810 };
const DITCH_NORTH = { x: 3088, z: 3525 };
const DITCH_SOUTH = { x: 3088, z: 3518 };
const FOOD_WITHDRAW = 16;
const HUNT_RADIUS = 22;
/** Keep south of the lava-maze walls (~z 3820). Chasing to 3836 sendWalks around lava. */
const HUNT = { minX: 3052, maxX: 3112, minZ: 3776, maxZ: 3818 };

const TO_CAMP = [
    { x: 3088, z: 3525 },
    { x: 3102, z: 3610 },
    { x: 3110, z: 3700 },
    { x: 3115, z: 3780 },
    { x: 3078, z: 3810 }
];
/** East-road tile south of the maze — same hop rune-rocks uses out of this pocket. */
const ROAD_SOUTH_OF_LAVA = { x: 3115, z: 3780 };
/** North–south road used by moss-giants; trees west of x~3090 trap long sendWalks. */
const CORRIDOR_X = 3102;
/** Glory is blocked above wildy 30 → z > 3752. */
const GLORY_SAFE_Z = 3748;
/** Off-road (dead trees). On the dirt road a long hop is safe — moss giants used ~90. */
const TREE_HOP = 3;
const ROAD_HOP = 32;
/** 32-tile sendWalks next to the maze scenic-route north into lava. */
const LAVA_HOP_Z = 3780;

const DRAGON = /^green dragon$/i;
const DRAGON_BONES = /^dragon bones$/i;
const ANY_BONES = /bones$/i;
const HIDE = /^(green )?dragonhide$/i;
const NATURE = /^nature runes?$/i;
const RARE =
    /dragon spear|dragon med(ium)? helm|half of a key|left half|shield left half|^clue scroll|nature talisman|^(uncut )?(sapphire|emerald|ruby|diamond|dragonstone)$|^rune dagger$|^adamant full helm$/i;
const SWORDFISH = /^swordfish$/i;
const SUPER_ATTACK = /^super attack(\(\d\))?$/i;
const EMPTY_VIAL = /^vial$/i;
const DLONG = /^dragon longsword$/i;
const FIRE_SHIELD = /dragonfire shield|anti-?dragon/i;
const CHARGED_GLORY = /amulet of glory\([1-4]\)/i;
const ANY_GLORY = /amulet of glory/i;
const GEAR =
    /d'?hide body|d'?hide chaps|dragon vambraces|dragon longsword|dragonfire shield|anti-?dragon|rune (full helm|platelegs)|amulet of glory|cape of saradomin|climbing boots|ring of wealth/i;

function shouldKeep(name: string): boolean {
    if (HIDE.test(name) || NATURE.test(name) || RARE.test(name) || ANY_BONES.test(name) || EMPTY_VIAL.test(name)) {
        return false;
    }
    return SWORDFISH.test(name) || SUPER_ATTACK.test(name) || GEAR.test(name);
}

function isLoot(name: string): boolean {
    return HIDE.test(name) || NATURE.test(name) || RARE.test(name) || ANY_BONES.test(name);
}

function lootPriority(name: string): number {
    if (RARE.test(name)) return 0;
    if (NATURE.test(name)) return 1;
    if (HIDE.test(name)) return 2;
    if (ANY_BONES.test(name)) return 3;
    return 9;
}

const argv = process.argv.slice(2);
const botArg = argv.find((a) => !a.startsWith('-'));

function loadBotEnv(): void {
    const envPath = botArg
        ? join(process.cwd(), 'bots', botArg, 'bot.env')
        : join(dirname(import.meta.path), 'bot.env');
    if (!existsSync(envPath)) {
        throw new Error(`bot.env not found at ${envPath}. Usage: bun bots/quests/green-dragons.ts {botname}`);
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
    name: 'green-dragons',
    grindLogPath: GRIND_LOG,
    stallMs: 180_000,
    maxRecoveryTactics: 8
});

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

function inHuntBox(x: number, z: number): boolean {
    return x >= HUNT.minX && x <= HUNT.maxX && z >= HUNT.minZ && z <= HUNT.maxZ;
}

function atCamp(): boolean {
    return distTo(CAMP.x, CAMP.z) <= 12 && inHuntBox(pos().x, pos().z);
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

function edible() {
    return sdk.getInventory().filter((i) => foodHeal(i.name) > 0 || (i.optionsWithIndex ?? []).some((o) => /eat/i.test(o.text)));
}

function foodCount(): number {
    return edible().length;
}

function hpXp(): number {
    return sdk.getSkill('Hitpoints')?.experience ?? 0;
}

function attackBoosted(): boolean {
    const sk = sdk.getSkill('Attack');
    if (!sk) return false;
    return sk.level > sk.baseLevel;
}

async function ui(): Promise<void> {
    await closeUi(bot, sdk);
}

function wildyLevel(z: number): number {
    if (z < 3520) return 0;
    return Math.floor((z - 3520) / 8) + 1;
}

function skipIfFarther(wp: { x: number; z: number }, dest: { x: number; z: number }): boolean {
    if (distTo(wp.x, wp.z) <= 8) return true;
    const remaining = distTo(dest.x, dest.z);
    const via = Math.hypot(wp.x - dest.x, wp.z - dest.z);
    return via >= remaining - 6;
}

/**
 * Wait until this hop finishes — not until the first step. Re-issuing walk on
 * any movement cancels run and stutters 1 tile at a time.
 */
async function hopToward(x: number, z: number, tolerance = 4): Promise<boolean> {
    await bot.dismissBlockingUI();
    for (let i = 0; i < 80 && !pos().isDead; i++) {
        const p = pos();
        const d = Math.hypot(p.x - x, p.z - z);
        if (d <= tolerance) return true;
        const onRoad = Math.abs(p.x - CORRIDOR_X) <= 8;
        const destOnRoad = Math.abs(x - CORRIDOR_X) <= 12;
        const nearLava = p.z >= LAVA_HOP_Z || z >= LAVA_HOP_Z;
        const hop = !nearLava && onRoad && destOnRoad ? ROAD_HOP : TREE_HOP;
        const step = Math.min(hop, Math.max(1, d));
        let tx: number;
        let tz: number;
        if (!nearLava && onRoad && destOnRoad && Math.abs(z - p.z) >= Math.abs(x - p.x)) {
            tx = CORRIDOR_X;
            tz = p.z + Math.sign(z - p.z) * step;
        } else {
            tx = Math.round(p.x + ((x - p.x) / d) * step);
            tz = Math.round(p.z + ((z - p.z) / d) * step);
        }
        const sx = p.x;
        const sz = p.z;
        await sdk.sendWalk(tx, tz, true);
        const hopTol = Math.max(2, Math.min(6, step / 4));
        await sdk
            .waitForCondition((s) => {
                if (s.player?.isDead) return true;
                const px = s.player?.worldX ?? 0;
                const pz = s.player?.worldZ ?? 0;
                return Math.hypot(px - tx, pz - tz) <= hopTol || Math.hypot(px - x, pz - z) <= tolerance;
            }, Math.max(5_000, step * 400))
            .catch(() => {});
        if (pos().x === sx && pos().z === sz) {
            const roadX = nearLava ? ROAD_SOUTH_OF_LAVA.x : CORRIDOR_X;
            const ux = sx === roadX ? sx + (i % 2 === 0 ? TREE_HOP : -TREE_HOP) : sx + Math.sign(roadX - sx) * TREE_HOP;
            const uz = nearLava ? sz - TREE_HOP : sz - 2;
            await sdk.sendWalk(ux, uz, true);
            await sdk.waitForTicks(2).catch(() => {});
        } else {
            session.noteProgress('location', `${pos().x},${pos().z}`);
        }
    }
    return distTo(x, z) <= tolerance + 2;
}

async function walkWaypointsSend(points: { x: number; z: number }[], dest: { x: number; z: number }): Promise<void> {
    for (const wp of points) {
        if (pos().isDead) return;
        await eatIfNeeded();
        const lavaExit =
            wp.x === ROAD_SOUTH_OF_LAVA.x &&
            wp.z === ROAD_SOUTH_OF_LAVA.z &&
            southOfLavaMaze(pos().x, pos().z);
        if (!lavaExit && skipIfFarther(wp, dest)) continue;
        await hopToward(wp.x, wp.z, 6);
    }
    if (!pos().isDead && distTo(dest.x, dest.z) > 6) await hopToward(dest.x, dest.z, 4);
}

/** East onto the road, then south — never hop east along the lava line at camp z. */
async function leaveLavaPocket(): Promise<void> {
    if (!southOfLavaMaze(pos().x, pos().z)) return;
    intent(`Leaving lava-maze south pocket @ ${pos().x},${pos().z}`);
    // West inside the maze: east onto the road first. Already at x≥3100: only
    // south — LAVA_MAZE_EAST is north of camp and walk-loops on the lava.
    if (pos().x < 3100 && pos().z >= 3820) {
        await hopToward(LAVA_MAZE_EAST.x, LAVA_MAZE_EAST.z, 4);
    }
    await hopToward(ROAD_SOUTH_OF_LAVA.x, ROAD_SOUTH_OF_LAVA.z, 4);
}

async function crossDitchNorth(): Promise<boolean> {
    if (northOfDitch()) return true;
    intent('Crossing the Edgeville wilderness ditch (sendWalk)');
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
    await hopToward(DITCH_NORTH.x, DITCH_NORTH.z, 4);
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

async function gloryToEdgeville(): Promise<boolean> {
    if (wildyLevel(pos().z) > 30) return false;
    if (occupied() >= 28) {
        await buryBones();
        if (occupied() >= 28) {
            const food = edible()[0];
            if (food) await bot.eatFood(food);
        }
    }
    if (occupied() >= 28) return false;
    let glory = sdk.findInventoryItem(CHARGED_GLORY);
    if (!glory) {
        const worn = sdk.findEquipmentItem(ANY_GLORY);
        if (worn) {
            await bot.unequipItem(worn);
            glory = sdk.findInventoryItem(CHARGED_GLORY) ?? sdk.findInventoryItem(ANY_GLORY);
        }
    }
    if (!glory || !CHARGED_GLORY.test(glory.name)) {
        const inv = sdk.findInventoryItem(ANY_GLORY);
        if (inv && !sdk.findEquipmentItem(ANY_GLORY)) await bot.equipItem(inv);
        return false;
    }
    const rub = glory.optionsWithIndex.find((o) => /rub/i.test(o.text));
    if (!rub) return false;
    intent('Rub glory → Edgeville');
    await sdk.sendUseItem(glory.slot, rub.opIndex);
    await sdk.waitForCondition((s) => s.dialog?.isOpen === true, 4_000).catch(() => {});
    const click = await sdk.clickDialogByText(/edgeville/i);
    if (!click.success) {
        session.log('warn', `glory dialog: ${click.message}`);
        return false;
    }
    await sdk
        .waitForCondition((s) => (s.player?.worldZ ?? 0) < 3520 || s.player?.isDead === true, 8_000)
        .catch(() => {});
    const ok = !northOfDitch();
    if (ok) log(`Glory to Edgeville`);
    const leftover = sdk.findInventoryItem(ANY_GLORY);
    if (leftover && !sdk.findEquipmentItem(ANY_GLORY)) await bot.equipItem(leftover);
    return ok;
}

async function leaveWildy(): Promise<boolean> {
    if (!northOfDitch()) return true;
    if (session.metrics().phase !== 'escape') await session.setPhase('escape');
    intent('Leaving wilderness');
    await leaveLavaPocket();
    if (Math.abs(pos().x - CORRIDOR_X) > 4) {
        await hopToward(CORRIDOR_X, Math.min(pos().z, ROAD_SOUTH_OF_LAVA.z), 3);
    }
    if (wildyLevel(pos().z) > 30) {
        await hopToward(CORRIDOR_X, GLORY_SAFE_Z, 4);
    }
    if (await gloryToEdgeville()) return true;
    await hopToward(DITCH_NORTH.x, DITCH_NORTH.z, 4);
    if (northOfDitch() && !pos().isDead) await crossDitchSouth();
    return !northOfDitch();
}

async function goToCamp(): Promise<boolean> {
    if (atCamp()) return true;
    if (session.metrics().phase !== 'travel') await session.setPhase('travel');
    session.setAnchor(CAMP.x, CAMP.z);
    if (!northOfDitch()) {
        if (swordfishCount() < 4 && !(await bankTrip())) return false;
        if (!(await crossDitchNorth())) {
            session.noteFailure('ditch', 'Could not cross wilderness ditch');
            return false;
        }
    }
    intent(`Wildy sendWalk to green dragons @ ${CAMP.x},${CAMP.z}`);
    if (southOfLavaMaze(pos().x, pos().z) && (pos().z > ROAD_SOUTH_OF_LAVA.z + 4 || pos().x < 3110)) {
        await leaveLavaPocket();
    }
    await walkWaypointsSend(TO_CAMP, CAMP);
    if (!atCamp() && !pos().isDead) await hopToward(CAMP.x, CAMP.z, 6);
    if (atCamp()) session.noteProgress('location', 'green dragons');
    return atCamp();
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
        log(`Ate ${food.name} +${r.hpGained} HP ${pos().hp}/${pos().maxHp} swordfish=${swordfishCount()}`);
    }
}

async function buryBones(): Promise<void> {
    for (let i = 0; i < 8; i++) {
        await bot.dismissBlockingUI();
        const bones = sdk.findInventoryItem(DRAGON_BONES) ?? sdk.findInventoryItem(ANY_BONES);
        if (!bones) return;
        const bury = bones.optionsWithIndex.find((o) => /bury/i.test(o.text));
        if (!bury) return;
        const xpBefore = sdk.getSkill('Prayer')?.experience ?? 0;
        await sdk.sendUseItem(bones.slot, bury.opIndex);
        await sdk.waitForTicks(1);
        const xpAfter = sdk.getSkill('Prayer')?.experience ?? 0;
        if (xpAfter > xpBefore) {
            session.noteProgress('xp', `prayer ${xpAfter}`);
            log(`Buried ${bones.name} +${xpAfter - xpBefore} prayer xp`);
        }
    }
}

async function pickupNear(item: { x: number; z: number; id: number; name: string; count: number; distance: number }): Promise<boolean> {
    if (item.distance > 2) {
        await sdk.sendWalk(item.x, item.z, true);
        await sdk.waitForTicks(2).catch(() => {});
    }
    const before = sdk.getInventory().filter((i) => i.id === item.id).reduce((n, i) => n + (i.count ?? 1), 0);
    await sdk.sendPickup(item.x, item.z, item.id);
    try {
        await sdk.waitForCondition((s) => {
            const got = s.inventory.filter((i) => i.id === item.id).reduce((n, i) => n + (i.count ?? 1), 0) > before;
            const gone = !s.groundItems.some((g) => g.x === item.x && g.z === item.z && g.id === item.id);
            return got || gone || s.player?.isDead === true;
        }, 4_000);
    } catch {
        return false;
    }
    const got = sdk.getInventory().filter((i) => i.id === item.id).reduce((n, i) => n + (i.count ?? 1), 0) > before;
    if (got) {
        session.noteProgress('inventory', item.name);
        log(`Picked ${item.count} ${item.name}`);
        if (ANY_BONES.test(item.name)) await buryBones();
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
            .filter((g) => isLoot(g.name) && g.reachable !== false && (g.distance ?? 99) <= 12)
            .sort((a, b) => lootPriority(a.name) - lootPriority(b.name) || (a.distance ?? 99) - (b.distance ?? 99))[0];
        if (!item) return;
        if (occupied() >= 28 && !ANY_BONES.test(item.name)) {
            await buryBones();
            if (occupied() >= 28) return;
        }
        const ok = await pickupNear(item);
        if (!ok) break;
    }
}

function findDragon() {
    const mine = pos().targetIndex;
    return (
        (sdk.getNearbyNpcs() ?? [])
            .filter(
                (n) =>
                    DRAGON.test(n.name) &&
                    (n.hp === null || n.hp > 0) &&
                    n.optionsWithIndex.some((o) => /attack/i.test(o.text)) &&
                    inHuntBox(n.x, n.z) &&
                    (n.reachable !== false || (n.distance ?? 99) <= 8) &&
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

function hasDragonTarget(): boolean {
    const p = pos();
    if (!p.inCombat || p.targetType !== 'npc' || p.targetIndex < 0) return false;
    const target = sdk.getNearbyNpcs().find((n) => n.index === p.targetIndex);
    return !!target && DRAGON.test(target.name) && (target.hp === null || target.hp > 0);
}

async function chaseDragon(): Promise<void> {
    if (!hasDragonTarget()) return;
    const target = sdk.getNearbyNpcs().find((n) => n.index === pos().targetIndex);
    if (!target) return;
    if (!inHuntBox(target.x, target.z)) return;
    const d = target.distance ?? 99;
    if (d <= 1) return;
    intent(`Chase green dragon (${d | 0} tiles)`);
    if (d > 3) await hopToward(target.x, target.z, 2);
    else await sdk.sendWalk(target.x, target.z, true);
    await sdk.waitForTicks(1);
    const opt = target.optionsWithIndex.find((o) => /attack/i.test(o.text));
    if (opt) await sdk.sendInteractNpc(target.index, opt.opIndex);
}

async function attackDragon(): Promise<void> {
    if (hasDragonTarget()) {
        await waitFight();
        return;
    }
    const target = findDragon();
    if (!target) {
        if (distTo(CAMP.x, CAMP.z) > 8) await hopToward(CAMP.x, CAMP.z, 6);
        else await sdk.waitForTicks(2);
        return;
    }
    const d = target.distance ?? 99;
    if (d > 1) {
        if (d > 3) await hopToward(target.x, target.z, 2);
        else await sdk.sendWalk(target.x, target.z, true);
        await sdk.waitForTicks(1);
    }
    const opt = target.optionsWithIndex.find((o) => /attack/i.test(o.text));
    if (!opt) return;
    intent(`Attack green dragon @ ${target.x},${target.z}`);
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
    const xpBefore = hpXp();
    while (hasDragonTarget() && !pos().isDead && Date.now() - started < 90_000) {
        await bot.dismissBlockingUI();
        await eatIfNeeded();
        if (pos().targetType === 'player') return;
        await chaseDragon();
        await sdk.waitForTicks(1);
    }
    if (hpXp() > xpBefore) {
        session.noteProgress('xp', `hp ${hpXp()}`);
        log(
            `Kill green dragon +${hpXp() - xpBefore} hp xp | hides=${count(HIDE)} nats=${count(NATURE)} swordfish=${swordfishCount()}`
        );
    }
    await buryBones();
    await lootGround();
}

async function fleePlayer(): Promise<boolean> {
    if (pos().targetType !== 'player' || !pos().inCombat) return false;
    session.log('warn', `Player combat @ ${pos().x},${pos().z} — running south`);
    await eatIfNeeded();
    await leaveWildy();
    return true;
}

async function drinkSuperAttack(): Promise<void> {
    await ui();
    if (attackBoosted()) {
        log(`Attack already boosted ${sdk.getSkill('Attack')?.level}/${sdk.getSkill('Attack')?.baseLevel} — skip dose`);
        return;
    }
    const pot = sdk.findInventoryItem(SUPER_ATTACK);
    if (!pot) {
        log('WARN no super attack in inventory after bank');
        return;
    }
    const drink = pot.optionsWithIndex.find((o) => /drink/i.test(o.text));
    if (!drink) {
        log(`WARN ${pot.name} has no drink option`);
        return;
    }
    const before = pot.name;
    const atkBefore = sdk.getSkill('Attack')?.level ?? 0;
    await sdk.sendUseItem(pot.slot, drink.opIndex);
    await sdk.waitForTicks(2);
    log(`Drank ${before} Attack ${atkBefore} → ${sdk.getSkill('Attack')?.level}`);
}

async function depositPotionRemainder(): Promise<void> {
    const leftover = sdk.findInventoryItem(SUPER_ATTACK) ?? sdk.findInventoryItem(EMPTY_VIAL);
    if (!leftover) return;
    const opened = await bot.openBank();
    if (!opened.success) return;
    await bot.depositItem(leftover, -1);
    await bot.closeBank();
}

async function equipGear(): Promise<void> {
    const dlong = sdk.findInventoryItem(DLONG);
    if (dlong && !sdk.findEquipmentItem(DLONG)) await bot.equipItem(dlong);
    const shield = sdk.findInventoryItem(FIRE_SHIELD);
    if (shield && !sdk.findEquipmentItem(FIRE_SHIELD)) await bot.equipItem(shield);
    const glory = sdk.findInventoryItem(CHARGED_GLORY) ?? sdk.findInventoryItem(ANY_GLORY);
    if (glory && !sdk.findEquipmentItem(ANY_GLORY)) await bot.equipItem(glory);
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
    // One deposit-all per item id. Looping the opening snapshot re-clicks
    // empty hide slots after the first -1 dump and waits 5s each.
    for (let i = 0; i < 12; i++) {
        const item = sdk.getInventory().find((it) => (it.count ?? 0) > 0 && !shouldKeep(it.name));
        if (!item) break;
        const r = await bot.depositItem(item, -1);
        if (!r.success && !r.partial) {
            session.noteFailure('bank', `deposit ${item.name}: ${r.message}`);
            break;
        }
    }
    if (swordfishCount() > FOOD_WITHDRAW) {
        await bot.depositItem(SWORDFISH, swordfishCount() - FOOD_WITHDRAW);
    }
    const short = FOOD_WITHDRAW - swordfishCount();
    if (short > 0) {
        const r = await bot.withdrawItem(SWORDFISH, short);
        log(`Withdraw swordfish ${short}: ${r.success ? 'ok' : r.message}`);
    }
    if (!sdk.findInventoryItem(SUPER_ATTACK) && !attackBoosted()) {
        const bankPot = sdk.findBankItem(SUPER_ATTACK);
        if (bankPot) {
            const r = await bot.withdrawItem(bankPot, 1);
            log(`Withdraw ${bankPot.name}: ${r.success ? 'ok' : r.message}`);
        } else {
            log('WARN no super attack in bank');
        }
    }
    if (!sdk.findEquipmentItem(DLONG) && !sdk.findInventoryItem(DLONG)) {
        const bankDlong = sdk.findBankItem(DLONG);
        if (bankDlong) await bot.withdrawItem(bankDlong, 1);
    }
    if (!sdk.findEquipmentItem(FIRE_SHIELD) && !sdk.findInventoryItem(FIRE_SHIELD)) {
        const bankShield = sdk.findBankItem(FIRE_SHIELD);
        if (bankShield) await bot.withdrawItem(bankShield, 1);
    }
    const wornGlory = sdk.findEquipmentItem(ANY_GLORY);
    if (wornGlory && !CHARGED_GLORY.test(wornGlory.name)) {
        await bot.unequipItem(wornGlory);
    }
    const uncharged = sdk.findInventoryItem(/^amulet of glory$/i);
    if (uncharged) await bot.depositItem(uncharged, 1);
    if (!sdk.findEquipmentItem(CHARGED_GLORY) && !sdk.findInventoryItem(CHARGED_GLORY)) {
        const charged = sdk
            .getBankItems()
            .filter((i) => CHARGED_GLORY.test(i.name))
            .sort((a, b) => (b.name > a.name ? 1 : -1))[0];
        if (charged) {
            const r = await bot.withdrawItem(charged, 1);
            log(`Withdraw ${charged.name}: ${r.success ? 'ok' : r.message}`);
        }
    }
    await bot.closeBank();
    await equipGear();
    await drinkSuperAttack();
    await depositPotionRemainder();
    session.noteProgress('bank', `swordfish ${swordfishCount()}`);
    log(
        `Loadout swordfish=${swordfishCount()} slots=${occupied()} Attack ${sdk.getSkill('Attack')?.level}/${sdk.getSkill('Attack')?.baseLevel}`
    );
    return swordfishCount() > 0;
}

function shouldBank(): boolean {
    if (swordfishCount() < 2) return true;
    if (occupied() >= 26 && foodCount() > 0) return true;
    if (needsBankHeal(pos().hp, pos().maxHp) && foodCount() === 0) return true;
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
    log(
        `Green dragons @ ${pos().x},${pos().z} | Atk ${sdk.getSkill('Attack')?.level} HP ${pos().hp}/${pos().maxHp} ` +
            `swordfish=${swordfishCount()} hides=${count(HIDE)}`
    );

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

        await eatIfNeeded();
        if (await fleePlayer()) {
            if (!pos().isDead) await bankTrip();
            continue;
        }

        if (shouldBank()) {
            log(`Banking swordfish=${swordfishCount()} slots=${occupied()} hides=${count(HIDE)}`);
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
        await attackDragon();
    }
} catch (err) {
    session.stop('script_error', err instanceof Error ? err.message : String(err));
    console.error('Script error:', err);
} finally {
    await session.finalizeStop();
    await sdk.disconnect();
}
