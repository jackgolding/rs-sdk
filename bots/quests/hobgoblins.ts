/**
 * Crafting Guild peninsula hobgoblins: snape grass, limpwurt, herbs, RDT.
 * Bank at Falador east when the bag is full.
 *
 *   bun bots/quests/hobgoblins.ts jackthief
 */
import { existsSync, readFileSync } from 'fs';
import { dirname, join } from 'path';
import { ActivitySession, BotSDK, deriveGatewayUrl, inWilderness } from '../../sdk/index';
import { BotActions } from '../../sdk/actions';
import { initPathfinding } from '../../sdk/pathfinding';
import {
    CRAFTING_GUILD_HOBS,
    FALADOR_EAST_BANK,
    TO_CRAFTING_GUILD_HOBS,
    TO_FALADOR_EAST_FROM_HOBS
} from './tiles';
import { closeUi as closeUiShared } from './movement';
import { foodHeal } from './food-heal';
import { installGracefulShutdown } from '../../sdk/runner';

const CAMP = CRAFTING_GUILD_HOBS;
const BANK = FALADOR_EAST_BANK;
const DITCH_NORTH = { x: 3088, z: 3525 };
const DITCH_SOUTH = { x: 3088, z: 3518 };
const HUNT_RADIUS = 18;

const HOBGOBLIN = /^hobgoblin$/i;
const LIMPWURT = /^limpwurt root$/i;
const SNAPE = /^snape grass$/i;
const UNID = /^(herb|unidentified herb)$/i;
const HERB =
    /^(herb|unidentified herb|guam leaf|marrentill|tarromin|harralander|ranarr weed|toadflax|irit leaf|avantoe|kwuarm|snapdragon|cadantine|lantadyme|dwarf weed|torstol)$/i;
const GEM = /^(uncut )?(sapphire|emerald|ruby|diamond|dragonstone)$/i;
const KEY_HALF = /half of a key/i;
const RDT_RARE = /^(nature talisman|dragon spear|shield left half)$/i;
const DLONG = /^dragon longsword$/i;
/** combat_hacksword:specbar — Cleave, 25% (250/1000). */
const HACKSWORD_SPECBAR = 7587;
const DLONG_SPEC_COST = 250;
const SPEC_MAX = 1000;
const SPEC_REGEN = 100;
const SPEC_REGEN_TICKS = 50;

const argv = process.argv.slice(2);
const botArg = argv.find((a) => !a.startsWith('-'));

function loadBotEnv(): void {
    const envPath = botArg
        ? join(process.cwd(), 'bots', botArg, 'bot.env')
        : join(dirname(import.meta.path), 'bot.env');
    if (!existsSync(envPath)) {
        throw new Error(`bot.env not found at ${envPath}. Usage: bun bots/quests/hobgoblins.ts {botname}`);
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
    name: 'hobgoblins',
    grindLogPath: GRIND_LOG,
    stallMs: 180_000,
    maxRecoveryTactics: 8
});

installGracefulShutdown();

const identifyFailedSlots = new Set<number>();
let bankedLimp = 0;
let bankedHerb = 0;
let bankedSnape = 0;
let lastHpXp = 0;
let specEnergy = SPEC_MAX;
let specArmed = false;
let lastSpecRegenTick = -1;

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

function distTo(x: number, z: number): number {
    return Math.hypot(pos().x - x, pos().z - z);
}

function wearingDlong(): boolean {
    return !!sdk.findEquipmentItem(DLONG);
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

async function enableDlongSpec(): Promise<boolean> {
    tickSpecRegen();
    if (!wearingDlong()) return false;
    if (specEnergy < DLONG_SPEC_COST) return false;
    if (specArmed) return true;
    await sdk.sendSetTab(0).catch(() => {});
    const r = await sdk.sendClickComponent(HACKSWORD_SPECBAR);
    if (!r.success) {
        session.log('warn', `Spec bar click failed: ${r.message}`);
        return false;
    }
    specArmed = true;
    log(`Spec Cleave armed ${Math.floor(specEnergy / 10)}%`);
    return true;
}

function noteSpecUsed(): void {
    if (!specArmed) return;
    specArmed = false;
    specEnergy = Math.max(0, specEnergy - DLONG_SPEC_COST);
}

function drainGameChat(): void {
    sdk.getNewChat({ types: [0] });
}

function noteSpecRejected(): void {
    const noPower = sdk.getNewChat({ types: [0] }).some((m) => /enough power/i.test(m.text));
    if (!noPower) return;
    specArmed = false;
    specEnergy = Math.min(specEnergy, DLONG_SPEC_COST - 1);
    session.log('warn', `Spec not enough power — energy tracked ${specEnergy}`);
}

function resetSpec(): void {
    specEnergy = SPEC_MAX;
    specArmed = false;
    lastSpecRegenTick = -1;
}

function occupied(): number {
    return sdk.getInventory().filter((i) => (i.count ?? 0) > 0).length;
}

function count(pattern: RegExp): number {
    return sdk.getInventory().filter((i) => pattern.test(i.name)).reduce((n, i) => n + (i.count ?? 1), 0);
}

function herbSlots(): number {
    return sdk.getInventory().filter((i) => HERB.test(i.name)).length;
}

function hpXp(): number {
    return sdk.getSkillXp('Hitpoints') ?? sdk.getSkill('Hitpoints')?.experience ?? 0;
}

function herbloreXp(): number {
    return sdk.getSkillXp('Herblore') ?? sdk.getSkill('Herblore')?.experience ?? 0;
}

function bagFull(): boolean {
    return occupied() >= 28;
}

function atCamp(): boolean {
    return distTo(CAMP.x, CAMP.z) <= HUNT_RADIUS;
}

function inHuntBox(x: number, z: number): boolean {
    return x >= 2888 && x <= 2928 && z >= 3278 && z <= 3318;
}

function northOfDitch(): boolean {
    return inWilderness(pos().x, pos().z);
}

function shouldKeep(name: string): boolean {
    return DLONG.test(name);
}

function isLoot(name: string): boolean {
    return LIMPWURT.test(name) || SNAPE.test(name) || HERB.test(name) || GEM.test(name) || KEY_HALF.test(name) || RDT_RARE.test(name);
}

function lootPriority(name: string): number {
    if (KEY_HALF.test(name) || RDT_RARE.test(name)) return 0;
    if (GEM.test(name)) return 1;
    if (LIMPWURT.test(name)) return 2;
    if (HERB.test(name)) return 3;
    if (SNAPE.test(name)) return 4;
    return 9;
}

function edible() {
    return sdk.getInventory().filter((i) => foodHeal(i.name) > 0 || (i.optionsWithIndex ?? []).some((o) => /eat/i.test(o.text)));
}

function foodCount(): number {
    return edible().reduce((n, i) => n + (i.count ?? 1), 0);
}

function lootSummary(): string {
    return (
        `limp ${count(LIMPWURT)} herb ${herbSlots()} snape ${count(SNAPE)} gem ${count(GEM)} ` +
        `key ${count(KEY_HALF)} food ${foodCount()} spec ${Math.floor(specEnergy / 10)}% slots ${occupied()}`
    );
}

async function ui(): Promise<void> {
    await closeUiShared(bot, sdk);
}

async function hop(x: number, z: number, tolerance = 8): Promise<boolean> {
    if (distTo(x, z) <= tolerance) return true;
    if (pos().hp <= Math.max(30, pos().maxHp - 20)) await eatIfNeeded();
    await openToward(x, z);
    const result = await bot.walkTo(x, z, Math.min(tolerance, 6));
    return result.success || distTo(x, z) <= tolerance + 3;
}

async function walkNear(x: number, z: number, tolerance = 4): Promise<boolean> {
    return hop(x, z, tolerance);
}

async function walkWaypoints(points: { x: number; z: number }[]): Promise<void> {
    const dest = points[points.length - 1];
    if (!dest) return;
    for (const wp of points) {
        if (distTo(dest.x, dest.z) <= 10) return;
        const remaining = distTo(dest.x, dest.z);
        const via = Math.hypot(wp.x - dest.x, wp.z - dest.z);
        if (via >= remaining - 4) continue;
        if (distTo(wp.x, wp.z) <= 10) continue;
        await hop(wp.x, wp.z, 10);
    }
    if (distTo(dest.x, dest.z) > 8) await hop(dest.x, dest.z, 8);
}

async function sendWalkTo(x: number, z: number, tolerance = 8): Promise<void> {
    await ui();
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
    await ui();
}

async function leaveWildy(): Promise<boolean> {
    if (!northOfDitch()) return true;
    intent('Leaving wilderness via Edgeville ditch');
    session.setAnchor(DITCH_SOUTH.x, DITCH_SOUTH.z);
    const south = [
        { x: 3110, z: 3700 },
        { x: 3102, z: 3610 },
        { x: 3088, z: 3525 }
    ];
    for (const p of south) {
        if (!northOfDitch()) break;
        if (p.z > pos().z + 8) continue;
        await sendWalkTo(p.x, p.z, 8);
    }
    await sendWalkTo(DITCH_NORTH.x, DITCH_NORTH.z, 6);
    await sdk.sendWalk(DITCH_SOUTH.x, DITCH_SOUTH.z, true);
    await sdk.waitForCondition((s) => (s.player?.worldZ ?? 0) < 3520 || s.player?.isDead === true, 12_000).catch(() => {});
    const ok = !northOfDitch();
    if (!ok) session.noteFailure('ditch', 'Still north of wilderness ditch');
    return ok;
}

async function openToward(tx: number, tz: number): Promise<void> {
    const door = (sdk.getNearbyLocs() ?? [])
        .filter(
            (l) =>
                /door|gate/i.test(l.name) &&
                l.reachable !== false &&
                l.optionsWithIndex.some((o) => /^open$/i.test(o.text))
        )
        .sort((a, b) => Math.hypot(a.x - tx, a.z - tz) - Math.hypot(b.x - tx, a.z - tz))[0];
    if (door && (door.distance ?? 99) <= 10) await bot.openDoor(door);
}

async function eatIfNeeded(): Promise<void> {
    const p = pos();
    if (p.hp > Math.max(40, p.maxHp - 20)) return;
    const foods = edible().sort((a, b) => foodHeal(b.name) - foodHeal(a.name));
    const food = foods[0];
    if (!food) return;
    const r = await bot.eatFood(food);
    if (r.success) {
        session.noteProgress('inventory', 'eat');
        log(`Ate ${food.name} +${r.hpGained} HP ${pos().hp}/${pos().maxHp}`);
    }
}

async function identifyHerbs(): Promise<void> {
    for (let i = 0; i < 12; i++) {
        const herb = sdk.getInventory().find((it) => UNID.test(it.name) && !identifyFailedSlots.has(it.slot));
        if (!herb) return;
        const opt = herb.optionsWithIndex.find((o) => /identify/i.test(o.text));
        if (!opt) {
            identifyFailedSlots.add(herb.slot);
            continue;
        }
        const xpBefore = herbloreXp();
        await sdk.sendUseItem(herb.slot, opt.opIndex);
        await sdk.waitForTicks(1).catch(() => {});
        await ui();
        if (herbloreXp() > xpBefore) {
            const named = sdk.getInventory().find((it) => it.slot === herb.slot);
            log(`Identified ${named?.name ?? 'herb'} +${herbloreXp() - xpBefore} herblore xp`);
            session.noteProgress('xp', 'identify');
            continue;
        }
        identifyFailedSlots.add(herb.slot);
    }
}

async function lootGround(): Promise<boolean> {
    if (bagFull()) return false;
    let picked = false;
    for (let i = 0; i < 10; i++) {
        await eatIfNeeded();
        if (bagFull() || pos().isDead) break;
        let ground = sdk.getGroundItems() ?? [];
        if (i === 0) {
            const scanned = await sdk.scanGroundItems(12).catch(() => null);
            if (scanned) ground = scanned;
        }
        const item = ground
            .filter(
                (g) =>
                    isLoot(g.name) &&
                    g.reachable !== false &&
                    (g.distance ?? 99) <= 16 &&
                    (inHuntBox(g.x, g.z) || SNAPE.test(g.name) || (g.distance ?? 99) <= 6)
            )
            .sort((a, b) => lootPriority(a.name) - lootPriority(b.name) || (a.distance ?? 99) - (b.distance ?? 99))[0];
        if (!item) break;
        const before = sdk.getInventory().filter((inv) => inv.id === item.id).reduce((n, inv) => n + (inv.count ?? 1), 0);
        intent(`Loot ${item.name} @ ${item.x},${item.z}`);
        const r = await bot.pickupItem(item);
        await sdk
            .waitForCondition((s) => {
                const got = s.inventory.filter((inv) => inv.id === item.id).reduce((n, inv) => n + (inv.count ?? 1), 0) > before;
                return got || s.player?.isDead === true;
            }, 6_000)
            .catch(() => {});
        const after = sdk.getInventory().filter((inv) => inv.id === item.id).reduce((n, inv) => n + (inv.count ?? 1), 0);
        if (after > before) {
            picked = true;
            session.noteProgress('inventory', item.name);
            if (LIMPWURT.test(item.name)) log(`Looted limpwurt root | ${lootSummary()}`);
            else if (SNAPE.test(item.name)) log(`Picked snape grass | ${lootSummary()}`);
            else if (HERB.test(item.name)) log(`Looted ${item.name} | ${lootSummary()}`);
            else log(`Looted ${item.name} | ${lootSummary()}`);
            await identifyHerbs();
        } else if (!r.success) {
            session.noteFailure('loot', r.message);
            break;
        }
    }
    return picked;
}

function findHobgoblin() {
    const mine = pos().targetIndex;
    return (
        (sdk.getNearbyNpcs() ?? [])
            .filter(
                (n) =>
                    HOBGOBLIN.test(n.name) &&
                    (n.hp === null || n.hp > 0) &&
                    n.optionsWithIndex.some((o) => /attack/i.test(o.text)) &&
                    inHuntBox(n.x, n.z) &&
                    n.reachable !== false
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

function hasHobTarget(): boolean {
    const p = pos();
    if (!p.inCombat || p.targetType !== 'npc' || p.targetIndex < 0) return false;
    const target = sdk.getNearbyNpcs().find((n) => n.index === p.targetIndex);
    return !!target && HOBGOBLIN.test(target.name) && (target.hp === null || target.hp > 0);
}

async function waitFight(): Promise<void> {
    const started = Date.now();
    const xpBefore = hpXp();
    while (hasHobTarget() && !pos().isDead && Date.now() - started < 45_000) {
        await bot.dismissBlockingUI();
        await eatIfNeeded();
        if (pos().targetType === 'player') return;
        await enableDlongSpec();
        await sdk.waitForTicks(1);
    }
    noteSpecUsed();
    if (hpXp() > xpBefore) {
        session.noteProgress('xp', `hp ${hpXp()}`);
        log(`Kill hobgoblin +${hpXp() - xpBefore} hp xp | ${lootSummary()}`);
    }
    lastHpXp = hpXp();
    await lootGround();
    await identifyHerbs();
    if (!atCamp() && distTo(CAMP.x, CAMP.z) > HUNT_RADIUS) {
        await walkNear(CAMP.x, CAMP.z, 6);
    }
}

async function fight(): Promise<void> {
    if (hasHobTarget()) {
        await waitFight();
        return;
    }
    const target = findHobgoblin();
    if (!target) {
        if (distTo(CAMP.x, CAMP.z) > 8) await walkNear(CAMP.x, CAMP.z, 5);
        else await sdk.waitForTicks(2);
        return;
    }
    const xpBefore = hpXp();
    intent(`Attack hobgoblin @ ${target.x},${target.z}`);
    session.setAnchor(target.x, target.z);
    drainGameChat();
    const specced = await enableDlongSpec();
    const r = await bot.attack(target, 8_000);
    noteSpecRejected();
    if (!r.success) {
        session.noteFailure('attack', r.message);
        return;
    }
    if (specced && specArmed) noteSpecUsed();
    if (!hasHobTarget()) {
        await sdk
            .waitForCondition(
                (s) =>
                    s.player?.isDead === true ||
                    (s.player?.combat?.inCombat === true && s.player.combat.targetIndex === target.index) ||
                    !s.nearbyNpcs.some((n) => n.index === target.index && (n.hp === null || n.hp > 0)),
                8_000
            )
            .catch(() => {});
    }
    if (hasHobTarget()) await waitFight();
    else if (hpXp() > xpBefore) {
        session.noteProgress('xp', `hp ${hpXp()}`);
        log(`Kill hobgoblin +${hpXp() - xpBefore} hp xp | ${lootSummary()}`);
        await lootGround();
    }
}

async function goToBank(): Promise<boolean> {
    await ui();
    if (northOfDitch() && !(await leaveWildy())) return false;
    if (pos().z > 6400) return false;
    intent('Walking to Falador east bank');
    session.setAnchor(BANK.x, BANK.z);
    if (distTo(BANK.x, BANK.z) > 8) {
        if (pos().x > 3120 && pos().z < 3300) {
            await walkWaypoints([
                { x: 3160, z: 3250 },
                { x: 3088, z: 3250 },
                { x: 3007, z: 3297 },
                BANK
            ]);
        } else {
            await walkWaypoints(TO_FALADOR_EAST_FROM_HOBS);
        }
    }
    await openToward(BANK.x, BANK.z);
    await hop(BANK.x, BANK.z, 3);
    return distTo(BANK.x, BANK.z) <= 8;
}

async function goToCamp(): Promise<boolean> {
    await ui();
    if (northOfDitch() && !(await leaveWildy())) return false;
    if (atCamp()) return true;
    intent(`Walking to crafting guild hobgoblins @ ${CAMP.x},${CAMP.z}`);
    session.setAnchor(CAMP.x, CAMP.z);
    if (distTo(CAMP.x, CAMP.z) > 12) {
        await walkWaypoints(TO_CRAFTING_GUILD_HOBS);
    }
    if (!atCamp()) await hop(CAMP.x, CAMP.z, 8);
    const ok = atCamp();
    if (ok) session.noteProgress('location', 'hobgoblins');
    else session.noteFailure('camp_walk', `Still ${pos().x},${pos().z}`);
    return ok;
}

async function bankTrip(): Promise<boolean> {
    if (session.metrics().phase !== 'bank') await session.setPhase('bank');
    await identifyHerbs();
    if (!(await goToBank())) {
        session.noteFailure('bank_walk', 'Could not reach Falador east');
        return false;
    }
    if (!(sdk.getState()?.bank?.isOpen || (await bot.openBank()).success)) {
        session.noteFailure('bank_open', 'Falador east bank open failed');
        return false;
    }
    for (const item of sdk.getInventory()) {
        const name = item.name?.trim();
        if (!name || (item.count ?? 0) < 1) continue;
        if (LIMPWURT.test(name) || SNAPE.test(name) || /herb/i.test(name)) session.recordGain(name, item.count ?? 1);
    }
    const beforeLimp = count(LIMPWURT);
    const beforeHerb = herbSlots();
    const beforeSnape = count(SNAPE);
    for (let i = 0; i < 40; i++) {
        const item = sdk.getInventory().find((it) => (it.count ?? 0) > 0 && !shouldKeep(it.name));
        if (!item) break;
        const r = await bot.depositItem(item, -1);
        if (!r.success && !r.partial) break;
    }
    if (!sdk.findEquipmentItem(DLONG) && !sdk.findInventoryItem(DLONG)) {
        const bankDlong = sdk.findBankItem(DLONG);
        if (bankDlong) await bot.withdrawItem(bankDlong, 1);
    }
    session.captureBankStock();
    await bot.closeBank();
    const invDlong = sdk.findInventoryItem(DLONG);
    if (invDlong && !sdk.findEquipmentItem(DLONG)) await bot.equipItem(invDlong);
    identifyFailedSlots.clear();
    const limp = beforeLimp - count(LIMPWURT);
    const herbs = beforeHerb - herbSlots();
    const snape = beforeSnape - count(SNAPE);
    bankedLimp += Math.max(0, limp);
    bankedHerb += Math.max(0, herbs);
    bankedSnape += Math.max(0, snape);
    const deposited = limp + herbs + snape;
    if (deposited > 0) session.recordTrip(deposited);
    session.noteProgress('bank', 'falador east');
    log(
        `Banked limp ${Math.max(0, limp)} herb ${Math.max(0, herbs)} snape ${Math.max(0, snape)} | ` +
            `trip ${session.metrics().trips} total limp ${bankedLimp} herb ${bankedHerb} snape ${bankedSnape} | ${lootSummary()}`
    );
    return occupied() < 27;
}

session.registerRecovery([
    {
        name: 'leave_wildy',
        run: async () => northOfDitch() && (await leaveWildy())
    },
    {
        name: 'bank_if_full',
        run: async () => {
            if (!bagFull() && occupied() < 20) return false;
            return bankTrip();
        }
    },
    {
        name: 'walk_camp',
        run: async () => {
            if (bagFull()) return false;
            return goToCamp();
        }
    }
]);

try {
    await bot.skipTutorial();
    await ui();
    lastHpXp = hpXp();
    log(
        `Hobgoblin start HP ${pos().hp}/${pos().maxHp} herblore ${sdk.getSkill('Herblore')?.baseLevel} ` +
            `@ ${pos().x},${pos().z} weapon=${sdk.findEquipmentItem(DLONG)?.name ?? sdk.findInventoryItem(DLONG)?.name ?? 'none'} ` +
            `spec ${Math.floor(specEnergy / 10)}% | ${lootSummary()}`
    );

    while (!session.isStopped()) {
        if (session.needsRecovery()) {
            if ((await session.recover()) === 'exhausted') break;
            continue;
        }
        await ui();
        if (pos().isDead) {
            resetSpec();
            await sdk.waitForCondition((s) => !s.player.isDead, 45_000).catch(() => {});
            continue;
        }
        session.maybeHeartbeat();
        await eatIfNeeded();
        await identifyHerbs();

        if (northOfDitch()) {
            await leaveWildy();
            continue;
        }

        if (bagFull() || (occupied() >= 26 && !atCamp())) {
            log(`Banking ${lootSummary()}`);
            await bankTrip();
            continue;
        }

        if (!atCamp()) {
            if (session.metrics().phase !== 'travel') await session.setPhase('travel');
            await goToCamp();
            continue;
        }

        if (session.metrics().phase !== 'hunt') await session.setPhase('hunt');
        session.setAnchor(CAMP.x, CAMP.z);
        await lootGround();
        if (bagFull()) continue;
        await fight();
        if (hpXp() !== lastHpXp) lastHpXp = hpXp();
    }
} catch (err) {
    session.stop('script_error', err instanceof Error ? err.message : String(err));
    console.error('Script error:', err);
} finally {
    const stop = session.metrics().stopReason;
    if (stop) log(`stopped ${stop.code} @ ${stop.location.x},${stop.location.z}`);
    await session.finalizeStop();
    await sdk.disconnect();
}
