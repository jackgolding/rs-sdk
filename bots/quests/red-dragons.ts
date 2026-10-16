/**
 * Red dragon isle melee for 90+ attack accounts.
 *
 * Tank-first pack: jacklove1 (the tank) grabs aggro on a fresh dragon, DPS
 * (the rest of the pack) piles the tank's dragon ~2 ticks later so the
 * dragon sticks on the tank instead of bouncing between attackers. DPS never
 * starts a fresh fight — if the tank has no target they hold position.
 *
 * Hunters bring their own dragonfire/anti-dragon shield and dragon longsword:
 * they take 20 sharks, swordfish, or tuna and kill red dragons
 * south of the gate at (3201, 3856). They clump on jacklove1, pile the same
 * dragon, then walk the isle together for the next. Spec on cooldown, bury
 * bones, and pick up drops on the stack.
 *
 * Banks are one shared bank. Before the ditch they empty the whole bag at
 * Varrock east (3253, 3420), unequip whatever they are wearing and deposit
 * it, equip a dragon longsword and a dragonfire shield, and withdraw 20
 * sharks (swordfish, then tuna). The inventory that crosses into the
 * wilderness is only those 20 food. None of those in the bank: cook raw
 * food at Catherby, or harpoon sharks there, then return to Varrock east
 * and withdraw again. A full bag or an empty belly restocks at the Mage
 * Arena the same way. A player attack: Protect from Melee, run south, log out.
 *
 *   bun bots/quests/red-dragons.ts jacklove1
 * DPS (default) piles the tank's dragon 2 ticks after it engages. Tune with
 *   bun bots/quests/red-dragons.ts jacklove2 --tank=jacklove1 --dps-delay=3
 */
import { spawn } from 'child_process';
import { existsSync, readFileSync } from 'fs';
import { dirname, join } from 'path';
import { ActivitySession, BotSDK, deriveGatewayUrl, inWilderness } from '../../sdk/index';
import { BotActions } from '../../sdk/actions';
import { initPathfinding } from '../../sdk/pathfinding';
import {
    CATHERBY_BANK,
    VARROCK_EAST_BANK,
    WHITE_WOLF_TO_CATHERBY,
    type Tile
} from './tiles';
import {
    closeUi,
    installWaitForTicksGuard,
    walkKandarinToEdgeville,
    walkNear,
    walkSendHops
} from './movement';
import { foodHeal } from './food-heal';
import { installGracefulShutdown } from '../../sdk/runner';

const FOOD_PACK = 20;
const DLONG = /^dragon longsword$/i;
const FIRE_SHIELD = /dragonfire shield|anti-?dragon/i;
const DRAGON = /^red dragon$/i;
const BONES = /bones$/i;
const SHARK = /^shark$/i;
const SWORDFISH = /^swordfish$/i;
const TUNA = /^tuna$/i;
const TRIP_FOOD = [SHARK, SWORDFISH, TUNA];
const RAW = /^raw /i;
const RUNE_BUY = [
    { pattern: /cosmic rune/i, label: 'cosmic' },
    { pattern: /law rune/i, label: 'law' },
    { pattern: /nature rune/i, label: 'nature' }
] as const;

/** combat_hacksword:specbar — Cleave, 25% (250/1000). */
const HACKSWORD_SPECBAR = 7587;
const DLONG_SPEC_COST = 250;
const SPEC_MAX = 1000;
const SPEC_REGEN = 100;
const SPEC_REGEN_TICKS = 50;

const CASTLE_STAIRS = { x: 3205, z: 3208 };
const DITCH_NORTH = { x: 3088, z: 3525 };
const DITCH_SOUTH = { x: 3088, z: 3518 };
const CAMP = { x: 3200, z: 3834 };
const LEAD_ARG = process.argv.find((a) => a.startsWith('--lead='));
const LEAD = LEAD_ARG ? new RegExp(`^${LEAD_ARG.slice('--lead='.length)}$`, 'i') : /^jacklove1$/i;
const FOLLOW = 3;
/**
 * Tank-first aggro: the tank (default jacklove1) attacks a fresh dragon
 * immediately; DPS waits for the dragon to show engaged, then holds another
 * DPS_DELAY_TICKS before piling on, so the dragon sticks on the tank.
 * Override with --tank=<name>, --lead=<name> and --dps-delay=<ticks>.
 */
const TANK_ARG = process.argv.find((a) => a.startsWith('--tank='));
const TANK = TANK_ARG ? new RegExp(`^${TANK_ARG.slice('--tank='.length)}$`, 'i') : LEAD;
const DPS_DELAY_ARG = process.argv.find((a) => a.startsWith('--dps-delay='));
const DPS_DELAY_TICKS = Math.max(0, parseInt(DPS_DELAY_ARG?.split('=')[1] ?? '2', 10) || 0);
const HUNT = { minX: 3176, maxX: 3226, minZ: 3812, maxZ: 3854 };
/** Circuit over the wiki spawn samples so the pack walks the whole isle. */
const PATROL: Tile[] = [
    { x: 3200, z: 3834 },
    { x: 3181, z: 3850 },
    { x: 3190, z: 3834 },
    { x: 3184, z: 3820 },
    { x: 3213, z: 3819 },
    { x: 3220, z: 3836 },
    { x: 3202, z: 3846 }
];
const DRAGON_GATE = { x: 3201, z: 3856 };
const GATE_NORTH = { x: 3202, z: 3862 };
const GATE_SOUTH = { x: 3202, z: 3848 };
const LOGOUT_TAB = 10;
const LOGOUT_BUTTON = 2458;
const MEMBERS_GATE = { x: 3224, z: 3904 };
const MAGE_BANK = { x: 2534, z: 4714 };
const MAGE_LADDER = { x: 3091, z: 3957 };
/** Between the two hut webs. Do not walk here until both are slashed. */
const MAGE_WEB = { x: 3094, z: 3957 };
/** East of the hut — slash from here, then step west to the ladder. */
const MAGE_WEB_EAST = { x: 3096, z: 3957 };
const RANGE_OUTSIDE = { x: 2816, z: 3439 };
const RANGE_STAND = { x: 2816, z: 3443 };
const HARRY = { x: 2834, z: 3445 };
const PIER = { x: 2854, z: 3423 };

/** East of the lava maze, then the south side of the members fence, then the gate. */
const DITCH_TO_GATE: Tile[] = [
    { x: 3088, z: 3550 },
    { x: 3102, z: 3610 },
    { x: 3110, z: 3700 },
    { x: 3124, z: 3851 },
    { x: 3158, z: 3900 },
    { x: 3224, z: 3902 },
    GATE_NORTH
];
const GATE_TO_MEMBERS: Tile[] = [
    { x: 3214, z: 3884 },
    { x: 3224, z: 3902 }
];
const MEMBERS_TO_MAGE: Tile[] = [
    { x: 3165, z: 3957 },
    { x: 3129, z: 3957 },
    { x: 3108, z: 3956 },
    MAGE_WEB_EAST
];
const DITCH_TO_LUMBRIDGE: Tile[] = [
    { x: 3100, z: 3434 },
    { x: 3126, z: 3378 },
    { x: 3160, z: 3290 },
    { x: 3205, z: 3222 }
];

const argv = process.argv.slice(2);
const botArg = argv.find((a) => !a.startsWith('-'));

function loadBotEnv(): void {
    const envPath = botArg
        ? join(process.cwd(), 'bots', botArg, 'bot.env')
        : join(dirname(import.meta.path), 'bot.env');
    if (!existsSync(envPath)) {
        throw new Error(`bot.env not found at ${envPath}. Usage: bun bots/quests/red-dragons.ts {botname}`);
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
    name: 'red-dragons',
    grindLogPath: GRIND_LOG,
    stallMs: 180_000,
    maxRecoveryTactics: 8
});

installGracefulShutdown({ graceMs: 30_000 });
installWaitForTicksGuard(sdk, session);

let packed = false;
let specEnergy = SPEC_MAX;
let specArmed = false;
let lastSpecRegenTick = -1;
let patrolAt = 0;

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

function inMageBank(): boolean {
    const p = pos();
    if (p.z > 4500 && p.x < 2700) return true;
    // OFFLINE-OBSERVED 2026-10-15: the live Mage-bank interior sits at
    // ~(6208,6464) (snapshot of jacklove5+jacklove2 mid-retreat via the
    // Mage ladder path). The old x<2700 bound never matches it, which
    // strands the bot: neither the Mage branch nor Varrock prep applies.
    // Bounds are generous on purpose; the interior is a closed hall.
    return p.z >= 6400 && p.z <= 6520 && p.x >= 6150 && p.x <= 6260;
}

function wildySurface(): boolean {
    const p = pos();
    return inWilderness(p.x, p.z) && !inMageBank();
}

function onIsle(): boolean {
    const p = pos();
    return p.x >= HUNT.minX && p.x <= HUNT.maxX + 4 && p.z >= 3800 && p.z <= HUNT.maxZ;
}

function inHuntBox(x: number, z: number): boolean {
    return x >= HUNT.minX && x <= HUNT.maxX && z >= HUNT.minZ && z <= HUNT.maxZ;
}

function occupied(): number {
    return sdk.getInventory().filter((i) => (i.count ?? 0) > 0).length;
}

function countInv(pattern: RegExp): number {
    return sdk.getInventory()
        .filter((i) => pattern.test(i.name))
        .reduce((n, i) => n + (i.count ?? 1), 0);
}

function foodCount(): number {
    return sdk.getInventory()
        .filter((i) => foodHeal(i.name) > 0 && (i.count ?? 0) > 0)
        .reduce((n, i) => n + (i.count ?? 1), 0);
}

function isTripFood(name: string): boolean {
    return TRIP_FOOD.some((pattern) => pattern.test(name));
}

function tripFoodCount(): number {
    return sdk.getInventory()
        .filter((i) => isTripFood(i.name) && (i.count ?? 0) > 0)
        .reduce((n, i) => n + (i.count ?? 1), 0);
}

function bankTripFood(): number {
    return TRIP_FOOD.reduce((n, pattern) => n + (sdk.findBankItem(pattern)?.count ?? 0), 0);
}

/** Wilderness entry bag: sharks, swordfish, or tuna. Sword and shield are worn. */
function bagIsTripFood(): boolean {
    return sdk.getInventory().every((i) => (i.count ?? 0) <= 0 || isTripFood(i.name));
}

function wearingShield(): boolean {
    return !!sdk.findEquipmentItem(FIRE_SHIELD);
}

/** Worn sword and shield, bag is exactly 20 trip food and nothing else. */
function wildyKitReady(): boolean {
    return wearingDlong() && wearingShield() && tripFoodCount() === FOOD_PACK && occupied() === FOOD_PACK && bagIsTripFood();
}

function bagSummary(): string {
    const items = sdk.getInventory().filter((i) => (i.count ?? 0) > 0);
    if (items.length === 0) return 'empty';
    return items.map((i) => `${i.count} ${i.name}`).join(', ');
}

function shieldsOnPerson(): number {
    const worn = sdk.findEquipmentItem(FIRE_SHIELD) ? 1 : 0;
    return worn + countInv(FIRE_SHIELD);
}

function bagFull(): boolean {
    return occupied() >= 27;
}

function wearingDlong(): boolean {
    return !!sdk.findEquipmentItem(DLONG);
}

function isLead(): boolean {
    return LEAD.test(username);
}

function isTank(): boolean {
    return TANK.test(username);
}

function role(): string {
    return isTank() ? 'tank' : 'dps';
}

const PACK_NAME = /^(jackpoo|jacklove|abgarmy)\d+$/i;
const MIN_PACK = 3;

function findLead() {
    return sdk.getNearbyPlayers().find((p) => LEAD.test(p.name)) ?? null;
}

function stackedWithLead(): boolean {
    const lead = findLead();
    return !!lead && distTo(lead.x, lead.z) <= 1;
}

function packStacked(): number {
    return sdk.getNearbyPlayers().filter((p) => PACK_NAME.test(p.name) && (p.distance ?? 99) <= 2).length;
}

/** Follow jacklove1. Do not sendWalk after Follow — that cancels it. Rally at CAMP if he is out of view. */
async function stickTogether(): Promise<void> {
    if (isLead()) return;
    const lead = findLead();
    if (lead && inHuntBox(lead.x, lead.z)) {
        const d = distTo(lead.x, lead.z);
        if (d <= 0) return;
        if (d <= 1) {
            await sdk.sendWalk(lead.x, lead.z, true);
            return;
        }
        intent(`Follow jacklove1 @ ${lead.x},${lead.z}`);
        await sdk.sendInteractPlayer(lead.index, FOLLOW);
        await sdk
            .waitForCondition((s) => {
                const him = (s.nearbyPlayers ?? []).find((p) => LEAD.test(p.name));
                if (!him) return true;
                return Math.hypot((s.player?.worldX ?? 0) - him.x, (s.player?.worldZ ?? 0) - him.z) <= 1;
            }, 5_000)
            .catch(() => {});
        return;
    }
    if (distTo(CAMP.x, CAMP.z) > 1) {
        intent('Rally at camp for jacklove1');
        await hopToward(CAMP.x, CAMP.z, 1);
    }
}

async function patrolIsle(): Promise<void> {
    const dest = PATROL[patrolAt % PATROL.length]!;
    if (distTo(dest.x, dest.z) <= 2) {
        patrolAt = (patrolAt + 1) % PATROL.length;
    }
    const next = PATROL[patrolAt % PATROL.length]!;
    session.setAnchor(next.x, next.z);
    intent(`Pack patrol ${next.x},${next.z}`);
    await hopToward(next.x, next.z, 2);
}

async function ui(): Promise<void> {
    await closeUi(bot, sdk);
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

function noteSpecRejected(): void {
    const noPower = sdk.getNewChat({ types: [0] }).some((m) => /enough power/i.test(m.text));
    if (!noPower) return;
    specArmed = false;
    specEnergy = Math.min(specEnergy, DLONG_SPEC_COST - 1);
    session.log('warn', `Spec not enough power — energy tracked ${specEnergy}`);
}

async function eatIfNeeded(): Promise<void> {
    const EAT_AT = 50;
    for (let n = 0; n < 4; n++) {
        if (pos().hp > EAT_AT) return;
        const foods = sdk
            .getInventory()
            .filter((i) => foodHeal(i.name) > 0 && (i.count ?? 0) > 0)
            .sort((a, b) => foodHeal(b.name) - foodHeal(a.name));
        const food = foods[0];
        if (!food) return;
        const r = await bot.eatFood(food);
        if (!r.success) return;
        session.noteProgress('inventory', 'eat');
        log(`Ate ${food.name} +${r.hpGained} HP ${pos().hp}/${pos().maxHp}`);
    }
}

async function flickMelee(): Promise<void> {
    if (!isTank()) return;
    if (hasDragonTarget() && !pos().isDead) {
        const r = await bot.activatePrayer('protect_from_melee').catch(() => null);
        if (r && r.success && r.reason !== 'already_active') log(`Prayer melee on (${r.message})`);
    } else {
        await bot.deactivatePrayer('protect_from_melee').catch(() => {});
    }
}

async function preferAggressive(): Promise<void> {
    const cs = sdk.getState()?.combatStyle;
    if (!cs) return;
    const style = cs.styles.find((s) => /aggressive/i.test(s.name) || s.type === 'Aggressive');
    if (!style || cs.currentStyle === style.index) return;
    await sdk.sendSetCombatStyle(style.index);
    log(`Combat style ${style.name}`);
}

async function unequipAll(): Promise<void> {
    for (const worn of sdk.getEquipment()) {
        if ((worn.count ?? 0) < 1) continue;
        // OFFLINE-ONLY (jacklove local test): keep the forged melee kit worn.
        // The local wield click no-ops (sendUseItem succeeds, nothing equips),
        // so stripping the sword strands the bot barehanded. Live wield is fine.
        if (DLONG.test(worn.name) || FIRE_SHIELD.test(worn.name)) continue;
        const r = await bot.unequipItem(worn);
        if (!r.success) session.log('warn', `Unequip ${worn.name}: ${r.message}`);
    }
}

async function equipWorn(): Promise<void> {
    if (!wearingDlong()) {
        const sword = sdk.findInventoryItem(DLONG);
        if (sword) {
            const r = await bot.equipItem(sword);
            log(`Equip dragon longsword: ${r.success ? 'ok' : r.message}`);
        }
    }
    if (!wearingShield()) {
        const shield = sdk.findInventoryItem(FIRE_SHIELD);
        if (shield) {
            const r = await bot.equipItem(shield);
            log(`Equip dragonfire shield: ${r.success ? 'ok' : r.message}`);
        }
    }
    if (wearingDlong()) await preferAggressive();
}

async function hopToward(x: number, z: number, tolerance = 4): Promise<void> {
    for (let i = 0; i < 50 && !pos().isDead; i++) {
        const d = distTo(x, z);
        if (d <= tolerance) return;
        await eatIfNeeded();
        const step = Math.min(10, Math.max(1, d));
        const tx = Math.round(pos().x + ((x - pos().x) / d) * step);
        const tz = Math.round(pos().z + ((z - pos().z) / d) * step);
        const sx = pos().x;
        const sz = pos().z;
        await sdk.sendWalk(tx, tz, true);
        await sdk
            .waitForCondition((s) => {
                if (s.player?.isDead) return true;
                const px = s.player?.worldX ?? 0;
                const pz = s.player?.worldZ ?? 0;
                return Math.hypot(px - tx, pz - tz) <= 3 || Math.hypot(px - x, pz - z) <= tolerance;
            }, 8_000)
            .catch(() => {});
        if (pos().x === sx && pos().z === sz) {
            await sdk.sendWalk(sx + (i % 2 === 0 ? 2 : -2), sz + 1, true);
            await sdk.waitForTicks(2).catch(() => {});
        } else {
            session.noteProgress('location', `${pos().x},${pos().z}`);
        }
    }
}

async function hopPath(points: Tile[]): Promise<void> {
    for (const wp of points) {
        if (pos().isDead) return;
        if (distTo(wp.x, wp.z) <= 8) continue;
        await hopToward(wp.x, wp.z, 6);
    }
}

async function walkSafe(x: number, z: number, tolerance = 5): Promise<void> {
    if (wildySurface() || inMageBank()) {
        await hopToward(x, z, tolerance);
        return;
    }
    await walkNear(bot, sdk, x, z, tolerance);
}

async function openGateNear(x: number, z: number): Promise<void> {
    await sdk.scanNearbyLocs(14).catch(() => {});
    const gates = (sdk.getNearbyLocs() ?? []).filter(
        (l) =>
            /gate/i.test(l.name) &&
            Math.hypot(l.x - x, l.z - z) <= 5 &&
            (l.optionsWithIndex ?? []).some((o) => /^open$/i.test(o.text))
    );
    for (const gate of gates) {
        const open = gate.optionsWithIndex.find((o) => /^open$/i.test(o.text));
        if (!open) continue;
        intent(`Opening gate @ ${gate.x},${gate.z}`);
        await sdk.sendInteractLoc(gate.x, gate.z, gate.id, open.opIndex);
        await sdk.waitForTicks(2).catch(() => {});
    }
}

async function depositInventory(): Promise<void> {
    await depositExcept(() => false);
}

async function depositExcept(keep: (name: string) => boolean): Promise<void> {
    for (let i = 0; i < 40; i++) {
        const item = sdk.getInventory().find((it) => (it.count ?? 0) > 0 && !keep(it.name));
        if (!item) return;
        const r = await bot.depositItem(item, -1);
        if (!r.success && !r.partial) {
            session.log('warn', `Deposit ${item.name}: ${r.message}`);
            return;
        }
    }
}

function exactName(name: string): RegExp {
    return new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i');
}

/** Fill the bag with raw food from the open bank so Catherby can cook it. */
async function withdrawRawToCook(): Promise<number> {
    let got = 0;
    for (let n = 0; n < 28 && occupied() < 26; n++) {
        const raw = (sdk.getBankItems() ?? []).find((i) => RAW.test(i.name) && (i.count ?? 0) > 0);
        if (!raw) break;
        const nGot = await withdrawPattern(exactName(raw.name), 26 - occupied());
        if (nGot < 1) break;
        got += nGot;
    }
    if (got > 0) log(`Withdrew ${got} raw food to cook`);
    return got;
}

async function withdrawPattern(pattern: RegExp, amount: number): Promise<number> {
    const banked = sdk.findBankItem(pattern);
    if (!banked || amount < 1) return 0;
    const n = Math.min(amount, banked.count ?? 1);
    const before = countInv(pattern);
    await bot.withdrawItem(banked, n, { asNote: false });
    return Math.max(0, countInv(pattern) - before);
}

async function clickThroughBanker(): Promise<void> {
    let sawOpen = false;
    for (let i = 0; i < 16; i++) {
        const dialog = sdk.getDialog();
        if (!dialog?.isOpen) {
            if (sawOpen || sdk.getState()?.bank?.isOpen) return;
            await sdk.waitForTicks(1);
            continue;
        }
        sawOpen = true;
        const bank = dialog.options?.find((o) => /bank account|access my bank/i.test(o.text));
        if (bank) {
            await sdk.sendClickDialog(bank.index);
            await sdk.waitForTicks(2);
            continue;
        }
        const cont = dialog.options?.find((o) => /continue|click here/i.test(o.text));
        await sdk.sendClickDialog(cont?.index ?? dialog.options[0]?.index ?? 0);
        await sdk.waitForTicks(1);
    }
}

async function openGundai(): Promise<boolean> {
    if (sdk.getState()?.bank?.isOpen) return true;
    if (!inMageBank()) return false;
    if (distTo(MAGE_BANK.x, MAGE_BANK.z) > 8) await hopToward(MAGE_BANK.x, MAGE_BANK.z, 4);
    const gundai = sdk.findNearbyNpc(/gundai/i);
    if (!gundai) {
        session.log('warn', 'Gundai not visible');
        return false;
    }
    intent('Talking to Gundai');
    const talk = gundai.optionsWithIndex.find((o) => /talk/i.test(o.text));
    await sdk.sendInteractNpc(gundai.index, talk?.opIndex ?? 1, { route: false });
    await clickThroughBanker();
    if (sdk.getState()?.bank?.isOpen) {
        session.noteProgress('bank', 'gundai');
        return true;
    }
    session.log('warn', 'Gundai did not open the bank');
    return false;
}

async function openBooth(tile: Tile): Promise<boolean> {
    await ui();
    if (sdk.getState()?.bank?.isOpen) return true;
    if (distTo(tile.x, tile.z) > 6) await walkSafe(tile.x, tile.z, 4);
    const opened = await bot.openBank();
    return opened.success || !!sdk.getState()?.bank?.isOpen;
}

function bankHas(pattern: RegExp): boolean {
    return !!sdk.findBankItem(pattern);
}

function bankHasRaw(): boolean {
    return (sdk.getBankItems() ?? []).some((i) => RAW.test(i.name) && (i.count ?? 0) > 0);
}

function hutWebs() {
    return (sdk.getNearbyLocs() ?? []).filter(
        (l) => l.x >= 3090 && l.x <= 3098 && l.z >= 3954 && l.z <= 3960 && /^web$/i.test(l.name)
    );
}

function hutSlashableWebs() {
    return hutWebs().filter((l) => (l.optionsWithIndex ?? []).some((o) => /slash/i.test(o.text)));
}

function hutSlashedWebs() {
    return (sdk.getNearbyLocs() ?? []).filter(
        (l) =>
            l.x >= 3090 &&
            l.x <= 3098 &&
            l.z >= 3954 &&
            l.z <= 3960 &&
            /^slashed web$/i.test(l.name)
    );
}

function blockingHutWebs(dir: 'in' | 'out') {
    return hutSlashableWebs()
        .filter((w) => (dir === 'in' ? w.x <= pos().x && w.x >= 3091 : w.x >= pos().x && w.x <= 3096))
        .sort((a, b) => (dir === 'in' ? b.x - a.x : a.x - b.x));
}

async function slashMageWebs(dir: 'in' | 'out'): Promise<boolean> {
    const goal = dir === 'in' ? MAGE_LADDER : MAGE_WEB_EAST;
    if (!wearingDlong()) {
        const sword = sdk.findInventoryItem(DLONG);
        if (sword) await bot.equipItem(sword);
    }
    const knife = sdk.findInventoryItem(/^knife$/i);
    if (!wearingDlong() && !knife) {
        session.log('warn', 'No slash weapon for the Mage Arena webs — waiting for a slashed web');
    }

    for (let i = 0; i < 28 && !pos().isDead; i++) {
        await eatIfNeeded();
        await sdk.scanNearbyLocs(14).catch(() => {});
        const atGoal = dir === 'in' ? pos().x <= 3092 : pos().x >= 3096;
        const blocking = blockingHutWebs(dir);
        if (!blocking.length) {
            if (atGoal) return true;
            await sdk.sendWalk(goal.x, goal.z, true);
            await sdk
                .waitForCondition((s) => {
                    const x = s.player?.worldX ?? 0;
                    return dir === 'in' ? x <= 3092 : x >= 3096;
                }, 5_000)
                .catch(() => {});
            if (dir === 'in' ? pos().x <= 3092 : pos().x >= 3096) return true;
            continue;
        }

        const web = blocking[0]!;
        const standX = dir === 'in' ? web.x + 1 : web.x - 1;
        if (Math.abs(pos().x - standX) > 1 || Math.abs(pos().z - 3957) > 1) {
            await sdk.sendWalk(standX, 3957, true);
            await sdk.waitForTicks(2).catch(() => {});
        }

        intent(`Slash Mage Arena web @ ${web.x},${web.z} (${dir})`);
        sdk.getNewChat({ types: [0] });
        if (knife) {
            await sdk.sendUseItemOnLoc(knife.slot, web.x, web.z, web.id);
        } else {
            const opt = web.optionsWithIndex.find((o) => /slash/i.test(o.text));
            if (opt) await sdk.sendInteractLoc(web.x, web.z, web.id, opt.opIndex);
        }
        await sdk.waitForTicks(2).catch(() => {});

        const chat = sdk.getNewChat({ types: [0] });
        if (chat.some((m) => /sharp blade/i.test(m.text))) {
            session.log('warn', 'Web wants a sharp blade — waiting for the pack to slash');
            await sdk.waitForTicks(3).catch(() => {});
        }
        if (chat.some((m) => /can't reach/i.test(m.text))) {
            await sdk.sendWalk(standX, 3957, true);
            await sdk.waitForTicks(2).catch(() => {});
        }

        await sdk.scanNearbyLocs(10).catch(() => {});
        const opened =
            chat.some((m) => /slash the web apart/i.test(m.text)) ||
            hutSlashedWebs().some((l) => Math.abs(l.x - web.x) <= 1 && Math.abs(l.z - web.z) <= 1) ||
            !hutSlashableWebs().some((l) => l.x === web.x && l.z === web.z);
        if (!opened) continue;

        const throughX = dir === 'in' ? web.x - 1 : web.x + 1;
        await sdk.sendWalk(throughX, 3957, true);
        await sdk.waitForTicks(2).catch(() => {});
        session.noteProgress('location', `web ${dir} ${web.x},${web.z}`);
    }

    await sdk.scanNearbyLocs(10).catch(() => {});
    return dir === 'in' ? pos().x <= 3092 : pos().x >= 3096;
}

async function climbIntoMageBank(): Promise<boolean> {
    if (inMageBank()) return true;
    if (pos().x > 3096 || distTo(MAGE_WEB_EAST.x, MAGE_WEB_EAST.z) > 8) {
        await hopToward(MAGE_WEB_EAST.x, MAGE_WEB_EAST.z, 2);
    }
    if (!(await slashMageWebs('in'))) return false;
    intent('Climbing down the Mage Arena ladder');
    await sdk.sendWalk(3092, 3957, true);
    await sdk.waitForCondition(() => distTo(3092, 3957) <= 2, 8_000).catch(() => {});
    await sdk.scanNearbyLocs(10).catch(() => {});
    const ladder = (sdk.getNearbyLocs() ?? []).find(
        (l) =>
            /ladder/i.test(l.name) &&
            (l.optionsWithIndex ?? []).some((o) => /climb-down/i.test(o.text)) &&
            l.x >= 3088 &&
            l.x <= 3094
    );
    if (ladder) {
        const down = ladder.optionsWithIndex.find((o) => /climb-down/i.test(o.text))!;
        await sdk.sendInteractLoc(ladder.x, ladder.z, ladder.id, down.opIndex);
    } else {
        await sdk.sendInteractLoc(MAGE_LADDER.x, MAGE_LADDER.z, 2871, 1);
    }
    await sdk.waitForCondition((s) => (s.player?.worldZ ?? 0) > 4500, 10_000).catch(() => {});
    if (inMageBank()) {
        log(`Mage Arena bank @ ${pos().x},${pos().z}`);
        return true;
    }
    return false;
}

async function climbOutOfMageBank(): Promise<boolean> {
    if (!inMageBank()) return true;
    await ui();
    intent('Climbing out of the Mage Arena bank');
    await sdk.scanNearbyLocs(12).catch(() => {});
    const ladder = (sdk.getNearbyLocs() ?? []).find(
        (l) => /ladder/i.test(l.name) && (l.optionsWithIndex ?? []).some((o) => /climb-up/i.test(o.text))
    );
    if (ladder) {
        const up = ladder.optionsWithIndex.find((o) => /climb-up/i.test(o.text))!;
        await sdk.sendInteractLoc(ladder.x, ladder.z, ladder.id, up.opIndex);
    } else {
        await sdk.sendInteractLoc(pos().x, pos().z, 2872, 1);
    }
    await sdk.waitForCondition((s) => (s.player?.worldZ ?? 99_999) < 4500, 10_000).catch(() => {});
    if (inMageBank()) return false;
    if (pos().x < 3096) {
        if (!(await slashMageWebs('out'))) return false;
        await sdk.sendWalk(MAGE_WEB_EAST.x, MAGE_WEB_EAST.z, true);
        await sdk.waitForCondition((s) => (s.player?.worldX ?? 0) >= 3096, 8_000).catch(() => {});
    }
    return !inMageBank();
}

async function passMembersGate(dir: 'north' | 'south'): Promise<void> {
    const stand = dir === 'north' ? { x: MEMBERS_GATE.x, z: 3902 } : { x: MEMBERS_GATE.x, z: 3912 };
    const land = dir === 'north' ? { x: MEMBERS_GATE.x, z: 3912 } : { x: MEMBERS_GATE.x, z: 3902 };
    if (distTo(stand.x, stand.z) > 6) await hopToward(stand.x, stand.z, 4);
    await openGateNear(MEMBERS_GATE.x, MEMBERS_GATE.z);
    await sdk.sendWalk(land.x, land.z, true);
    const want = dir === 'north' ? (z: number) => z >= 3906 : (z: number) => z <= 3903;
    await sdk.waitForCondition((s) => want(s.player?.worldZ ?? 0) || s.player?.isDead === true, 8_000).catch(() => {});
}

async function leaveIsleNorth(): Promise<void> {
    if (!onIsle() && pos().z >= 3858) return;
    if (distTo(DRAGON_GATE.x, 3852) > 6) await hopToward(DRAGON_GATE.x, 3852, 3);
    await openGateNear(DRAGON_GATE.x, DRAGON_GATE.z);
    await hopToward(GATE_NORTH.x, GATE_NORTH.z, 3);
}

async function enterIsle(): Promise<void> {
    if (onIsle()) return;
    if (distTo(GATE_NORTH.x, GATE_NORTH.z) > 6) await hopToward(GATE_NORTH.x, GATE_NORTH.z, 3);
    await openGateNear(DRAGON_GATE.x, DRAGON_GATE.z);
    await hopToward(GATE_SOUTH.x, GATE_SOUTH.z, 3);
    await hopToward(CAMP.x, CAMP.z, 6);
}

async function goToMageBank(): Promise<boolean> {
    if (inMageBank()) return true;
    if (onIsle() || (pos().z < 3858 && pos().x >= 3176 && pos().z > 3700)) await leaveIsleNorth();
    if (pos().z < 3906) {
        await hopPath(GATE_TO_MEMBERS);
        await passMembersGate('north');
    }
    await hopPath(MEMBERS_TO_MAGE);
    return climbIntoMageBank();
}

async function crossDitch(dir: 'north' | 'south'): Promise<boolean> {
    if (dir === 'north') {
        if (wildySurface()) return true;
        intent('Crossing the Edgeville ditch north');
        await walkSafe(DITCH_SOUTH.x, DITCH_SOUTH.z, 3);
        await sdk.sendWalk(DITCH_NORTH.x, DITCH_NORTH.z, true);
        await sdk.waitForCondition((s) => (s.player?.worldZ ?? 0) >= 3520 || s.player?.isDead === true, 12_000).catch(() => {});
        return wildySurface();
    }
    if (!wildySurface()) return true;
    intent('Crossing south out of the wilderness');
    await hopToward(DITCH_NORTH.x, DITCH_NORTH.z, 4);
    await sdk.sendWalk(DITCH_SOUTH.x, DITCH_SOUTH.z, true);
    await sdk.waitForCondition((s) => (s.player?.worldZ ?? 99_999) < 3520 || s.player?.isDead === true, 12_000).catch(() => {});
    return !wildySurface();
}

async function leaveWildySouth(): Promise<void> {
    if (inMageBank() && !(await climbOutOfMageBank())) return;
    if (pos().z >= 3906 && pos().x < 3220) {
        await hopToward(MEMBERS_GATE.x, 3912, 4);
    }
    if (pos().z >= 3906) await passMembersGate('south');
    if (onIsle() || (pos().z > 3800 && pos().z < 3860 && pos().x > 3170)) await leaveIsleNorth();
    if (wildySurface()) {
        await hopPath([
            { x: 3158, z: 3900 },
            { x: 3124, z: 3851 },
            { x: 3110, z: 3700 },
            { x: 3102, z: 3610 },
            { x: 3088, z: 3550 },
            DITCH_NORTH
        ]);
        await crossDitch('south');
    }
}

/** Climb the Lumbridge castle stairs (used to come back down after banking). */
async function climbCastle(want: 'up' | 'down'): Promise<boolean> {
    const opt = want === 'up' ? /climb-up|climb.up/i : /climb-down|climb.down/i;
    if (distTo(CASTLE_STAIRS.x, CASTLE_STAIRS.z) > 3) await walkSafe(CASTLE_STAIRS.x, CASTLE_STAIRS.z, 2);
    const before = pos().level;
    await sdk.scanNearbyLocs(8).catch(() => {});
    const loc = (sdk.getNearbyLocs() ?? [])
        .filter(
            (l) =>
                /stair|ladder/i.test(l.name) &&
                Math.hypot(l.x - CASTLE_STAIRS.x, l.z - CASTLE_STAIRS.z) <= 4 &&
                (l.optionsWithIndex ?? []).some((o) => opt.test(o.text))
        )
        .sort((a, b) => (a.distance ?? 99) - (b.distance ?? 99))[0];
    if (!loc) {
        log(`No castle stairs to climb ${want} @ ${pos().x},${pos().z} L${pos().level}`);
        return false;
    }
    const match = loc.optionsWithIndex.find((o) => opt.test(o.text));
    if (!match) return false;
    await sdk.sendInteractLoc(loc.x, loc.z, loc.id, match.opIndex);
    await sdk.waitForCondition((s) => (s.player?.level ?? before) !== before, 8_000).catch(() => {});
    return pos().level !== before;
}

async function descendCastle(): Promise<void> {
    if (inMageBank() || wildySurface()) return;
    if (pos().level <= 0) return;
    if (distTo(CASTLE_STAIRS.x, CASTLE_STAIRS.z) > 40) return;
    for (let i = 0; i < 3 && pos().level > 0; i++) {
        if (!(await climbCastle('down'))) break;
    }
}

async function goToIsle(): Promise<void> {
    await descendCastle();
    if (onIsle()) return;
    if (!wildySurface() && !inMageBank() && !wildyKitReady()) {
        session.log('warn', `Not entering the wilderness. Bag: ${bagSummary()}`);
        return;
    }
    if (inMageBank()) {
        if (!(await climbOutOfMageBank())) {
            session.log('warn', `Still in Mage bank @ ${pos().x},${pos().z} — holding for next loop`);
            return;
        }
        await passMembersGate('south');
        await hopPath([...GATE_TO_MEMBERS].reverse());
        await enterIsle();
        return;
    }
    if (wildySurface()) {
        if (pos().x >= HUNT.minX - 4 && pos().x <= HUNT.maxX + 8 && pos().z >= 3780 && pos().z < 3860) {
            await hopToward(CAMP.x, CAMP.z, 2);
            return;
        }
        if (pos().z >= 3906) await passMembersGate('south');
        if (pos().z >= 3860 && pos().x >= 3188) {
            await hopToward(GATE_NORTH.x, GATE_NORTH.z, 4);
            await enterIsle();
            return;
        }
        await hopPath(DITCH_TO_GATE);
        await enterIsle();
        return;
    }
    if (!(await crossDitch('north'))) return;
    await hopPath(DITCH_TO_GATE);
    await enterIsle();
}

async function reachCatherby(): Promise<void> {
    await descendCastle();
    if (distTo(CATHERBY_BANK.x, CATHERBY_BANK.z) <= 25 && pos().x < 2900) return;
    if (inMageBank() || wildySurface()) await leaveWildySouth();
    if (pos().x >= 2990) {
        intent('White Wolf to Catherby');
        await walkSendHops(sdk, WHITE_WOLF_TO_CATHERBY, WHITE_WOLF_TO_CATHERBY[WHITE_WOLF_TO_CATHERBY.length - 1]!, 6);
    }
    if (distTo(CATHERBY_BANK.x, CATHERBY_BANK.z) > 12) await walkSafe(CATHERBY_BANK.x, CATHERBY_BANK.z, 5);
}

async function reachDitchFromCatherby(): Promise<void> {
    if (pos().x >= 2990 && !wildySurface()) return;
    intent('Catherby to the Edgeville ditch');
    await walkKandarinToEdgeville(bot, sdk, { eat: eatIfNeeded });
}

async function dismissCookDialog(): Promise<void> {
    for (let i = 0; i < 6; i++) {
        const dialog = sdk.getDialog();
        if (!dialog?.isOpen) return;
        const cook = dialog.options.find((o) => /^(cook|make)\b/i.test(o.text));
        if (cook) {
            await sdk.sendClickDialog(cook.index);
            await sdk.waitForTicks(2);
            continue;
        }
        const cont = dialog.options.find((o) => /continue|click here/i.test(o.text));
        await sdk.sendClickDialog(cont?.index ?? dialog.options[0]?.index ?? 0);
        await sdk.waitForTicks(1);
    }
}

async function cookInventoryRaw(): Promise<number> {
    const start = foodCount();
    if (!sdk.getInventory().some((i) => RAW.test(i.name))) return 0;
    intent('Cooking at the Catherby range');
    if (distTo(RANGE_OUTSIDE.x, RANGE_OUTSIDE.z) > 4) await walkSafe(RANGE_OUTSIDE.x, RANGE_OUTSIDE.z, 3);
    const door = sdk.findNearbyLoc(/^door$/i, { withOption: /open/i });
    if (door && (door.distance ?? 99) <= 6) await bot.openDoor(door);
    if (distTo(RANGE_STAND.x, RANGE_STAND.z) > 2) await walkSafe(RANGE_STAND.x, RANGE_STAND.z, 1);
    let idle = 0;
    while (sdk.getInventory().some((i) => RAW.test(i.name)) && idle < 40) {
        await dismissCookDialog();
        if (sdk.getDialog()?.isOpen) {
            idle++;
            continue;
        }
        const raw = sdk.getInventory().find((i) => RAW.test(i.name));
        await sdk.scanNearbyLocs(8).catch(() => {});
        const range = (sdk.getNearbyLocs() ?? []).find((l) => /^range$/i.test(l.name));
        if (!raw || !range) {
            idle++;
            break;
        }
        const before = countInv(exactName(raw.name));
        await sdk.sendUseItemOnLoc(raw.slot, range.x, range.z, range.id);
        await sdk
            .waitForCondition((s) => {
                if (s.dialog.isOpen) return true;
                const now = s.inventory
                    .filter((i) => i.name === raw.name)
                    .reduce((n, i) => n + (i.count ?? 0), 0);
                return now < before;
            }, 5_000)
            .catch(() => {});
        await dismissCookDialog();
        const after = countInv(exactName(raw.name));
        if (after >= before && !sdk.getDialog()?.isOpen) idle++;
        else idle = 0;
    }
    await dismissCookDialog();
    const cooked = foodCount() - start;
    log(`Cooked batch +${cooked}, food now ${foodCount()}`);
    return cooked;
}

async function cookAllRaw(): Promise<void> {
    await reachCatherby();
    for (let load = 0; load < 30; load++) {
        if (sdk.getInventory().some((i) => RAW.test(i.name))) await cookInventoryRaw();
        if (!(await openBooth(CATHERBY_BANK))) {
            session.log('warn', 'Catherby bank did not open for cooking');
            return;
        }
        await equipWorn();
        await depositExcept((name) => DLONG.test(name) || FIRE_SHIELD.test(name) || /^harpoon$/i.test(name));
        if (!bankHasRaw()) {
            log('No raw food left in the bank');
            await bot.closeBank();
            return;
        }
        await withdrawRawToCook();
        await bot.closeBank();
        if (!sdk.getInventory().some((i) => RAW.test(i.name))) return;
        await cookInventoryRaw();
    }
}

function findSharkSpot() {
    const spots = (sdk.getNearbyNpcs() ?? []).filter((n) => /fishing spot/i.test(n.name));
    return (
        spots
            .filter(
                (s) =>
                    s.optionsWithIndex.some((o) => /^harpoon$/i.test(o.text)) &&
                    s.optionsWithIndex.some((o) => /^net$/i.test(o.text)) &&
                    !s.optionsWithIndex.some((o) => /^cage$/i.test(o.text))
            )
            .sort((a, b) => (a.distance ?? 99) - (b.distance ?? 99))[0] ?? null
    );
}

async function ensureHarpoon(): Promise<boolean> {
    if (sdk.findInventoryItem(/^harpoon$/i) || sdk.findEquipmentItem(/^harpoon$/i)) return true;
    if (await openBooth(CATHERBY_BANK)) {
        await bot.withdrawItem(/^harpoon$/i, 1, { asNote: false }).catch(() => {});
        await bot.closeBank();
    }
    if (sdk.findInventoryItem(/^harpoon$/i)) {
        log('Withdrew a harpoon');
        return true;
    }
    const coins = sdk.findInventoryItem(/^coins$/i)?.count ?? 0;
    if (coins < 5 && (await openBooth(CATHERBY_BANK))) {
        await withdrawPattern(/^coins$/i, 100);
        await bot.closeBank();
    }
    if ((sdk.findInventoryItem(/^coins$/i)?.count ?? 0) < 5) {
        session.log('warn', 'Need 5gp for a harpoon from Harry');
        return false;
    }
    intent("Buying a harpoon from Harry");
    if (distTo(HARRY.x, HARRY.z) > 6) await walkSafe(HARRY.x, HARRY.z, 3);
    const opened = await bot.openShop(/harry/i);
    if (!opened.success && !sdk.getState()?.shop?.isOpen) {
        const harry = sdk.findNearbyNpc(/harry/i);
        if (harry) await bot.interactNpc(harry, /trade/i);
    }
    if (sdk.getState()?.shop?.isOpen) {
        await bot.buyFromShop(/^harpoon$/i, 1);
        await bot.closeShop();
    }
    const have = !!sdk.findInventoryItem(/^harpoon$/i);
    log(have ? 'Bought a harpoon' : 'Harry had no harpoon');
    return have;
}

async function fishOneInventory(): Promise<void> {
    if (!(await ensureHarpoon())) return;
    if (distTo(PIER.x, PIER.z) > 15) await walkSafe(PIER.x, PIER.z, 6);
    let misses = 0;
    while (occupied() < 27 && misses < 25 && !pos().isDead) {
        await ui();
        let spot = findSharkSpot();
        if (!spot || (spot.distance ?? 99) > 10) {
            await walkSafe(spot?.x ?? PIER.x, spot?.z ?? PIER.z, 4);
            spot = findSharkSpot();
        }
        if (!spot) {
            misses++;
            await sdk.waitForTicks(2);
            continue;
        }
        misses = 0;
        const harpoon = spot.optionsWithIndex.find((o) => /^harpoon$/i.test(o.text));
        if (!harpoon) break;
        const before = occupied();
        const xpBefore = sdk.getSkillXp('Fishing') ?? 0;
        await sdk.sendInteractNpc(spot.index, harpoon.opIndex);
        await sdk
            .waitForCondition((s) => {
                if (s.dialog.isOpen) return true;
                const xp = s.skills.find((sk) => sk.name === 'Fishing')?.experience ?? 0;
                const slots = s.inventory.filter((i) => (i.count ?? 0) > 0).length;
                return xp > xpBefore || slots > before || slots >= 28;
            }, 12_000)
            .catch(() => {});
        const dialog = sdk.getDialog();
        if (dialog?.isOpen) {
            const text = dialog.options.map((o) => o.text).join(' ');
            if (/76 fishing|at least 76/i.test(text)) {
                session.log('warn', 'Fishing is under 76 — cannot harpoon sharks');
                await ui();
                return;
            }
            await ui();
        }
        if (occupied() === before) misses++;
    }
    log(`Fished, raw sharks ${countInv(/^raw shark$/i)} slots ${occupied()}`);
}

async function fishSharksUntilPacked(): Promise<void> {
    await reachCatherby();
    // OFFLINE-OBSERVED 2026-10-15: with no harpoon (none in bag/bank, no
    // coins for Harry's) every trip burns ~1 min failing spot scans before
    // giving up — 10 trips of nothing. Fail fast instead; the outer loop
    // retries cheaply until supplies exist.
    if (!sdk.findInventoryItem(/^harpoon$/i) && !(await ensureHarpoon())) {
        session.log('warn', 'No harpoon obtainable — skipping shark fishing');
        return;
    }
    for (let trip = 1; trip <= 10; trip++) {
        if (await openBooth(CATHERBY_BANK)) {
            const banked = bankTripFood();
            await bot.closeBank();
            if (banked >= FOOD_PACK) {
                log(`Food stocked (${banked}) after ${trip - 1} trips`);
                return;
            }
        }
        intent(`Shark trip ${trip}`);
        if (occupied() >= 20 && (await openBooth(CATHERBY_BANK))) {
            await depositExcept((name) => DLONG.test(name) || FIRE_SHIELD.test(name) || /^harpoon$/i.test(name));
            await bot.withdrawItem(/^harpoon$/i, 1, { asNote: false }).catch(() => {});
            await bot.closeBank();
        }
        await fishOneInventory();
        await cookInventoryRaw();
        if (!(await openBooth(CATHERBY_BANK))) continue;
        await depositExcept((name) => DLONG.test(name) || FIRE_SHIELD.test(name) || /^harpoon$/i.test(name));
        await bot.closeBank();
        session.noteProgress('inventory', `shark trip ${trip}`);
        log(`Banked shark trip ${trip}`);
    }
}

function holdsRaw(): boolean {
    return sdk.getInventory().some((i) => RAW.test(i.name) && (i.count ?? 0) > 0);
}

async function resupplyFood(): Promise<boolean> {
    await reachCatherby();
    if (!(await openBooth(CATHERBY_BANK))) return false;
    const stocked = bankTripFood();
    const raw = bankHasRaw() || holdsRaw();
    await bot.closeBank();
    if (stocked >= 1) return true;
    if (raw) {
        log('No sharks, swordfish, or tuna — cooking raw food at Catherby');
        await cookAllRaw();
        if (await openBooth(CATHERBY_BANK)) {
            const cooked = bankTripFood() >= 1;
            await bot.closeBank();
            if (cooked) return true;
        }
    }
    log('No raw food — fishing sharks at Catherby');
    await fishSharksUntilPacked();
    if (!(await openBooth(CATHERBY_BANK))) return false;
    const now = bankTripFood() >= 1;
    await bot.closeBank();
    return now;
}

async function reopenTripBank(): Promise<boolean> {
    if (sdk.getState()?.bank?.isOpen) return true;
    if (inMageBank()) return openGundai();
    return openBooth(VARROCK_EAST_BANK);
}

/** Deposit bag, strip worn gear into the bank, equip sword and shield, withdraw 20 food. */
async function fillTripBag(): Promise<number> {
    if (!(await reopenTripBank())) return tripFoodCount();
    await depositInventory();
    await bot.closeBank();
    await unequipAll();
    if (!(await reopenTripBank())) return tripFoodCount();
    await depositInventory();
    if (!wearingDlong() && !sdk.findInventoryItem(DLONG)) {
        if (!bankHas(DLONG)) session.log('warn', 'No dragon longsword in the bank');
        else await withdrawPattern(DLONG, 1);
    }
    if (!wearingShield() && !sdk.findInventoryItem(FIRE_SHIELD)) {
        if (!bankHas(FIRE_SHIELD)) {
            session.stop('no_shield', 'No dragonfire/anti-dragon shield in the bank or kit — refusing to start');
            return tripFoodCount();
        }
        await withdrawPattern(FIRE_SHIELD, 1);
    }
    await bot.closeBank();
    await equipWorn();
    if (!wearingDlong()) {
        const sword = sdk.findInventoryItem(DLONG);
        if (sword) {
            session.log('warn', `Retry equip dragon longsword (${sword.name})`);
            await bot.equipItem(sword);
        }
    }
    if (!(await reopenTripBank())) return tripFoodCount();
    await depositExcept((name) => isTripFood(name) || DLONG.test(name) || FIRE_SHIELD.test(name));
    while (tripFoodCount() > FOOD_PACK) {
        const extra = sdk.getInventory().find((i) => isTripFood(i.name) && (i.count ?? 0) > 0);
        if (!extra) break;
        const r = await bot.depositItem(extra, 1);
        if (!r.success) break;
    }
    let need = FOOD_PACK - tripFoodCount();
    for (const pattern of TRIP_FOOD) {
        if (need < 1) break;
        const got = await withdrawPattern(pattern, need);
        need -= got;
        if (got > 0) log(`Withdrew ${got} ${pattern.source.replace(/^\^|\$$/g, '')}`);
    }
    session.noteProgress('bank', `food ${tripFoodCount()}`);
    return tripFoodCount();
}

async function buyAllRunes(): Promise<void> {
    await ui();
    if (sdk.getState()?.bank?.isOpen) await bot.closeBank();
    const coinsItem = () => sdk.findInventoryItem(/^coins$/i)?.count ?? 0;
    if (!(await openGundai())) return;
    const bankCoins = sdk.findBankItem(/^coins$/i)?.count ?? 0;
    if (bankCoins > 0) {
        await bot.withdrawItem(/^coins$/i, bankCoins, { asNote: false });
        log(`Withdrew ${coinsItem()} coins`);
    }
    await bot.closeBank();
    if (coinsItem() < 1) {
        log('No coins for Lundail');
        return;
    }
    const opened = await bot.openShop(/lundail/i);
    if (!opened.success && !sdk.getState()?.shop?.isOpen) {
        const npc = sdk.findNearbyNpc(/lundail/i);
        if (npc) await bot.interactNpc(npc, /trade/i);
    }
    if (!sdk.getState()?.shop?.isOpen) {
        session.log('warn', 'Lundail shop did not open');
        return;
    }
    session.noteProgress('shop', 'lundail');
    for (const { pattern, label } of RUNE_BUY) {
        for (let n = 0; n < 80; n++) {
            const line = sdk.getState()?.shop?.shopItems.find((i) => pattern.test(i.name));
            if (!line || line.count <= 0) break;
            const price = line.buyPrice ?? 1;
            if (coinsItem() < price) {
                log(`Out of coins on ${label}`);
                break;
            }
            const stockBefore = line.count;
            const r = await sdk.sendShopBuy(line.slot, 10);
            if (!r.success) break;
            await sdk
                .waitForCondition(() => (sdk.getState()?.shop?.shopItems.find((i) => pattern.test(i.name))?.count ?? stockBefore) < stockBefore, 5_000)
                .catch(() => {});
            if ((sdk.getState()?.shop?.shopItems.find((i) => pattern.test(i.name))?.count ?? stockBefore) >= stockBefore) break;
        }
        const left = sdk.getState()?.shop?.shopItems.find((i) => pattern.test(i.name))?.count ?? 0;
        log(`${label} shelf ${left}, ${countInv(pattern)} in the bag, ${coinsItem()}gp`);
    }
    await bot.closeShop().catch(() => {});
    if (!(await openGundai())) return;
    for (const pattern of [/^coins$/i, /cosmic rune/i, /law rune/i, /nature rune/i]) {
        const item = sdk.findInventoryItem(pattern);
        if (item) await bot.depositItem(item, -1);
    }
    session.noteProgress('bank', 'runes deposited');
    log('Deposited coins and runes');
}

async function mageBankTrip(): Promise<void> {
    intent('Mage Arena bank');
    if (!(await goToMageBank())) {
        session.log('warn', `Could not reach the Mage Arena bank @ ${pos().x},${pos().z}`);
        return;
    }
    await equipWorn();
    if (!(await openGundai())) return;
    await depositInventory();
    log(`Deposited bag @ ${pos().x},${pos().z}`);
    await bot.closeBank();
    await buyAllRunes();
    if (!sdk.getState()?.bank?.isOpen && !(await openGundai())) return;
    await fillTripBag();
    await bot.closeBank();
    await equipWorn();
    log(`Leaving Mage Arena food=${tripFoodCount()} bag=${bagSummary()}`);
}

/** Empty the bag at Varrock east, wear sword and shield, withdraw sharks, swordfish, or tuna. */
async function prepareAtVarrockEast(): Promise<void> {
    await descendCastle();
    if (inMageBank() || wildySurface()) await leaveWildySouth();
    if (pos().x < 2900 && !wildySurface()) await reachDitchFromCatherby();
    intent('Depositing everything at Varrock east');
    if (distTo(VARROCK_EAST_BANK.x, VARROCK_EAST_BANK.z) > 6) {
        await walkSafe(VARROCK_EAST_BANK.x, VARROCK_EAST_BANK.z, 4);
    }
    if (!(await openBooth(VARROCK_EAST_BANK))) {
        session.log('warn', 'Varrock east bank did not open');
        return;
    }
    await fillTripBag();
    if (sdk.getState()?.bank?.isOpen) await bot.closeBank();
    await equipWorn();
    if (!bagIsTripFood() && (await openBooth(VARROCK_EAST_BANK))) {
        await depositExcept((name) => isTripFood(name));
        await bot.closeBank();
    }
    log(
        `Varrock east kit food=${tripFoodCount()} dlong=${wearingDlong() ? 'worn' : 'no'} ` +
            `shield=${wearingShield() ? 'worn' : 'no'} bag=${bagSummary()}`
    );
}

async function buryBones(): Promise<void> {
    for (let i = 0; i < 12; i++) {
        const bones = sdk.getInventory().find((it) => BONES.test(it.name));
        if (!bones) return;
        const bury = bones.optionsWithIndex.find((o) => /bury/i.test(o.text));
        if (!bury) return;
        const slot = bones.slot;
        await sdk.sendUseItem(slot, bury.opIndex);
        await sdk
            .waitForCondition((s) => !s.inventory.some((it) => it.slot === slot && BONES.test(it.name)), 3_000)
            .catch(() => {});
        session.noteProgress('xp', 'bury');
    }
}

/**
 * Death-pile recovery: a dragonfire/anti-dragon shield on the ground marks
 * where a pack mate died. Take the shield first, then sweep everything else
 * stacked on its tile (their food and kit) until the bag is full. Runs ahead
 * of normal loot so the pile survives.
 */
async function recoverDeathShield(): Promise<void> {
    const scanned = (await sdk.scanGroundItems(12).catch(() => null)) ?? [];
    const pushed = sdk.getGroundItems() ?? [];
    const shield = [...scanned, ...pushed]
        .filter((g) => FIRE_SHIELD.test(g.name) && inHuntBox(g.x, g.z))
        .sort((a, b) => (a.distance ?? 99) - (b.distance ?? 99))[0];
    if (!shield) return;
    if (occupied() >= 28) {
        await eatIfNeeded();
        if (occupied() >= 28) {
            log(`Death shield @ ${shield.x},${shield.z} — bag full, leaving it`);
            return;
        }
    }
    intent(`Recover death shield ${shield.name} @ ${shield.x},${shield.z}`);
    const picked = await bot.pickupItem(shield);
    await sdk.waitForTicks(1).catch(() => {});
    if (picked.success || countInv(FIRE_SHIELD) > 0) {
        session.noteProgress('inventory', 'recovered shield');
        log(`Recovered death shield (${shieldsOnPerson()} on me)`);
    }
    if (!wearingShield()) {
        const spare = sdk.findInventoryItem(FIRE_SHIELD);
        if (spare) {
            const r = await bot.equipItem(spare);
            log(`Equip recovered shield: ${r.success ? 'ok' : r.message}`);
        }
    }
    for (let i = 0; i < 16; i++) {
        if (occupied() >= 28) return;
        const pile = (await sdk.scanGroundItems(12).catch(() => null)) ?? [];
        const item = [...pile, ...(sdk.getGroundItems() ?? [])]
            .filter((g) => g.x === shield.x && g.z === shield.z && !FIRE_SHIELD.test(g.name))
            .sort((a, b) => (BONES.test(a.name) ? 1 : 0) - (BONES.test(b.name) ? 1 : 0))[0];
        if (!item) return;
        intent(`Recover ${item.name} @ ${item.x},${item.z}`);
        const before = occupied();
        await sdk.sendPickup(item.x, item.z, item.id);
        await sdk.waitForTicks(1).catch(() => {});
        if (occupied() <= before) return;
        session.noteProgress('inventory', item.name);
    }
    await buryBones();
}

async function lootGround(): Promise<void> {
    await recoverDeathShield();
    await buryBones();
    for (let i = 0; i < 10; i++) {
        await eatIfNeeded();
        if (foodCount() === 0 && pos().hp <= 50) return;
        if (occupied() >= 28) return;
        const scannedLoot = (await sdk.scanGroundItems(12).catch(() => null)) ?? [];
        const item = scannedLoot
            .filter((g) => inHuntBox(g.x, g.z) && (g.distance ?? 99) <= 1)
            .sort((a, b) => (BONES.test(a.name) ? 0 : 1) - (BONES.test(b.name) ? 0 : 1) || (a.distance ?? 99) - (b.distance ?? 99))[0];
        if (!item) return;
        intent(`Pickup ${item.name}`);
        const before = occupied();
        await sdk.sendPickup(item.x, item.z, item.id);
        await sdk.waitForTicks(1).catch(() => {});
        if (occupied() <= before) return;
        session.noteProgress('inventory', item.name);
        if (BONES.test(item.name)) await buryBones();
    }
}

function findFreshDragon() {
    const mine = pos().targetIndex;
    const lead = findLead();
    const ax = isLead() ? pos().x : (lead?.x ?? pos().x);
    const az = isLead() ? pos().z : (lead?.z ?? pos().z);
    return (
        (sdk.getNearbyNpcs() ?? [])
            .filter(
                (n) =>
                    DRAGON.test(n.name) &&
                    (n.hp === null || n.hp > 0) &&
                    !n.inCombat &&
                    (typeof n.targetIndex !== 'number' || n.targetIndex < 0) &&
                    n.optionsWithIndex.some((o) => /attack/i.test(o.text)) &&
                    inHuntBox(n.x, n.z)
            )
            .sort((a, b) => {
                const aMine = a.index === mine ? 0 : 1;
                const bMine = b.index === mine ? 0 : 1;
                if (aMine !== bMine) return aMine - bMine;
                return Math.hypot(a.x - ax, a.z - az) - Math.hypot(b.x - ax, b.z - az);
            })[0] ?? null
    );
}

/**
 * The dragon the tank is currently fighting: prefer the dragon targeting the
 * tank, then an engaged dragon closest to the tank, then anything engaged.
 * Null when the tank has no fight (DPS holds) or the tank is out of view
 * (DPS falls back to acting as the tank so the pack still progresses).
 */
function findTankDragon() {
    const lead = findLead();
    const mine = pos().targetIndex;
    const cands = (sdk.getNearbyNpcs() ?? []).filter(
        (n) =>
            DRAGON.test(n.name) &&
            (n.hp === null || n.hp > 0) &&
            n.optionsWithIndex.some((o) => /attack/i.test(o.text)) &&
            inHuntBox(n.x, n.z)
    );
    if (cands.length === 0) return null;
    if (!lead) {
        // Tank out of view — fall back to the closest engaged dragon, else closest.
        return (
            cands.sort((a, b) => {
                const aMine = a.index === mine ? 0 : 1;
                const bMine = b.index === mine ? 0 : 1;
                if (aMine !== bMine) return aMine - bMine;
                const aHit = a.inCombat ? 0 : 1;
                const bHit = b.inCombat ? 0 : 1;
                if (aHit !== bHit) return aHit - bHit;
                return (a.distance ?? 99) - (b.distance ?? 99);
            })[0] ?? null
        );
    }
    // Tank visible: only pile a dragon the tank is already fighting. A fresh
    // dragon returns null so DPS holds position instead of pulling aggro.
    const engaged = cands.filter((n) => n.inCombat || (typeof n.targetIndex === 'number' && n.targetIndex >= 0));
    if (engaged.length === 0) return null;
    return (
        engaged.sort((a, b) => {
            const aMine = a.index === mine ? 0 : 1;
            const bMine = b.index === mine ? 0 : 1;
            if (aMine !== bMine) return aMine - bMine;
            const aOnTank = a.targetIndex === lead.index ? 0 : 1;
            const bOnTank = b.targetIndex === lead.index ? 0 : 1;
            if (aOnTank !== bOnTank) return aOnTank - bOnTank;
            const aHit = a.inCombat ? 0 : 1;
            const bHit = b.inCombat ? 0 : 1;
            if (aHit !== bHit) return aHit - bHit;
            return Math.hypot(a.x - lead.x, a.z - lead.z) - Math.hypot(b.x - lead.x, b.z - lead.z);
        })[0] ?? null
    );
}

function findDragon() {
    const mine = pos().targetIndex;
    const lead = findLead();
    const ax = isLead() ? pos().x : (lead?.x ?? pos().x);
    const az = isLead() ? pos().z : (lead?.z ?? pos().z);
    return (
        (sdk.getNearbyNpcs() ?? [])
            .filter(
                (n) =>
                    DRAGON.test(n.name) &&
                    (n.hp === null || n.hp > 0) &&
                    n.optionsWithIndex.some((o) => /attack/i.test(o.text)) &&
                    inHuntBox(n.x, n.z)
            )
            .sort((a, b) => {
                const aMine = a.index === mine ? 0 : 1;
                const bMine = b.index === mine ? 0 : 1;
                if (aMine !== bMine) return aMine - bMine;
                const aLead = lead && a.targetIndex === lead.index ? 0 : 1;
                const bLead = lead && b.targetIndex === lead.index ? 0 : 1;
                if (aLead !== bLead) return aLead - bLead;
                const aHit = a.inCombat ? 0 : 1;
                const bHit = b.inCombat ? 0 : 1;
                if (aHit !== bHit) return aHit - bHit;
                return Math.hypot(a.x - ax, a.z - az) - Math.hypot(b.x - ax, b.z - az);
            })[0] ?? null
    );
}

function hasDragonTarget(): boolean {
    const p = pos();
    if (!p.inCombat || p.targetType !== 'npc' || p.targetIndex < 0) return false;
    const target = sdk.getNearbyNpcs().find((n) => n.index === p.targetIndex);
    return !!target && DRAGON.test(target.name) && (target.hp === null || target.hp > 0);
}

async function hitDragon(target: { index: number; optionsWithIndex: { text: string; opIndex: number }[] }): Promise<void> {
    const opt = target.optionsWithIndex.find((o) => /attack/i.test(o.text));
    if (!opt) return;
    await sdk.sendInteractNpc(target.index, opt.opIndex, { route: false });
}

function hpXp(): number {
    return sdk.getSkillXp('Hitpoints') ?? 0;
}

async function engageDragon(
    target: { index: number; x: number; z: number; optionsWithIndex: { text: string; opIndex: number }[] },
    label: string
): Promise<void> {
    intent(`${label} red dragon @ ${target.x},${target.z}`);
    sdk.getNewChat({ types: [0] });
    const specced = await enableDlongSpec();
    await hitDragon(target);
    noteSpecRejected();
    if (specced && specArmed) noteSpecUsed();
    await sdk
        .waitForCondition((s) => {
            if (s.player?.isDead) return true;
            if (s.player?.combat?.inCombat && s.player.combat.targetIndex === target.index) return true;
            return !s.nearbyNpcs.some((n) => n.index === target.index && (n.hp === null || n.hp > 0));
        }, 8_000)
        .catch(() => {});
    await waitFight();
}

async function attackDragon(): Promise<void> {
    if (hasDragonTarget()) {
        await waitFight();
        return;
    }
    if (isTank()) {
        // Tank grabs aggro first: closest fresh dragon, immediately.
        const target = findFreshDragon() ?? findDragon();
        if (!target || (target.distance ?? 99) > 1) return;
        await engageDragon(target, 'Tank attack');
        return;
    }
    // DPS piles only the tank's dragon, ~2 ticks after it engages, so the
    // dragon sticks on the tank. No tank fight yet: hold, don't pull.
    const tankDragon = findTankDragon();
    if (!tankDragon) return;
    if ((tankDragon.distance ?? 99) > 1) {
        session.setAnchor(tankDragon.x, tankDragon.z);
        intent(`To tank's dragon @ ${tankDragon.x},${tankDragon.z}`);
        await hopToward(tankDragon.x, tankDragon.z, 1);
        return;
    }
    if (DPS_DELAY_TICKS > 0 && findLead()) {
        await sdk.waitForTicks(DPS_DELAY_TICKS).catch(() => {});
        const still = (sdk.getNearbyNpcs() ?? []).find(
            (n) => n.index === tankDragon.index && (n.hp === null || n.hp > 0)
        );
        if (!still) return;
        if (hasDragonTarget()) {
            await waitFight();
            return;
        }
    }
    await engageDragon(tankDragon, 'DPS pile');
}

async function huntPack(): Promise<void> {
    if (!isLead()) {
        await stickTogether();
        if (!stackedWithLead()) return;
        if (hasDragonTarget()) {
            await waitFight();
            return;
        }
        await attackDragon();
        return;
    }

    const stacked = packStacked();
    if (hasDragonTarget()) {
        await waitFight();
        return;
    }
    // Tank holds for the pack before engaging, so DPS is stacked and ready
    // for the 2-tick follow. No solo pulls while the pack catches up.
    if (stacked < MIN_PACK) {
        if (distTo(CAMP.x, CAMP.z) > 1) {
            intent(`Rally camp (${stacked}/${MIN_PACK})`);
            await hopToward(CAMP.x, CAMP.z, 1);
        } else {
            intent(`Waiting for pack (${stacked}/${MIN_PACK})`);
            await sdk.waitForTicks(2);
        }
        return;
    }

    const target = findDragon();
    if (!target) {
        await patrolIsle();
        return;
    }
    if ((target.distance ?? 99) > 1) {
        session.setAnchor(target.x, target.z);
        intent(`Pack to red dragon @ ${target.x},${target.z}`);
        await hopToward(target.x, target.z, 1);
    }
    await attackDragon();
}

async function swingSpec(): Promise<void> {
    const armed = await enableDlongSpec();
    if (!armed || !specArmed) return;
    const target = sdk.getNearbyNpcs().find((n) => n.index === pos().targetIndex);
    if (target) await hitDragon(target);
    noteSpecRejected();
    if (specArmed) noteSpecUsed();
}

async function waitFight(): Promise<void> {
    const started = Date.now();
    const xpBefore = hpXp();
    while (hasDragonTarget() && !pos().isDead && Date.now() - started < 90_000) {
        await ui();
        await eatIfNeeded();
        await flickMelee();
        if (await fleePlayer()) return;
        if (foodCount() === 0 && pos().hp <= 50) return;
        if (!isLead() && !stackedWithLead()) {
            await stickTogether();
            break;
        }
        const target = sdk.getNearbyNpcs().find((n) => n.index === pos().targetIndex);
        if (isLead() && target && (target.distance ?? 99) > 1) {
            await hopToward(target.x, target.z, 1);
        } else if (!isLead()) {
            await stickTogether();
        }
        await swingSpec();
        await sdk.waitForTicks(1);
    }
    if (hpXp() > xpBefore) {
        session.noteProgress('xp', `hp +${hpXp() - xpBefore}`);
        log(`Kill red dragon +${hpXp() - xpBefore} hp xp | food=${foodCount()} slots=${occupied()}`);
    }
    await lootGround();
}

function isPackPlayer(index: number): boolean {
    const p = sdk.getNearbyPlayers().find((x) => x.index === index);
    return !!p && PACK_NAME.test(p.name);
}

function playerAttacking(): boolean {
    const foes = sdk.getNearbyPlayers().filter((p) => !PACK_NAME.test(p.name) && (p.distance ?? 99) <= 8);
    if (foes.length === 0) return false;
    const foeIdx = new Set(foes.map((p) => p.index));
    const me = pos();
    if (me.targetType === 'player' && me.inCombat && foeIdx.has(me.targetIndex) && !isPackPlayer(me.targetIndex)) {
        return true;
    }
    const tick = sdk.getState()?.tick ?? 0;
    return (sdk.getState()?.combatEvents ?? []).some(
        (e) =>
            e.type === 'damage_taken' &&
            e.sourceType === 'other_player' &&
            tick - e.tick <= 8 &&
            foeIdx.has(e.sourceIndex)
    );
}

async function tryLogout(): Promise<boolean> {
    await ui();
    await sdk.sendSetTab(LOGOUT_TAB).catch(() => {});
    await sdk.sendClickComponent(LOGOUT_BUTTON);
    const gone = await sdk.waitForCondition((s) => s.inGame !== true, 12_000).then(() => true, () => false);
    if (gone) return true;
    session.log('warn', 'Logout did not land (combat may be blocking it)');
    return false;
}

function stopLiteLogin(): void {
    const script = join(process.cwd(), '.cursor/skills/lite-client/scripts/lite-launchd.ts');
    spawn('bun', [script, 'stop', username], { detached: true, stdio: 'ignore' }).unref();
}

async function fleePlayer(): Promise<boolean> {
    if (!wildySurface()) return false;
    if (!playerAttacking()) return false;
    session.log('warn', `Player combat @ ${pos().x},${pos().z} — Protect Melee, run south, log out`);
    await bot.activatePrayer('protect_from_melee').catch(() => {});
    await eatIfNeeded();
    const southZ = Math.max(3524, pos().z - 48);
    for (let i = 0; i < 8 && playerAttacking(); i++) {
        await hopToward(pos().x, Math.max(southZ, pos().z - 12), 4);
        if (await tryLogout()) break;
    }
    if (!await tryLogout()) await hopToward(pos().x, southZ, 6);
    await tryLogout();
    stopLiteLogin();
    session.stop('pk_logout', `Attacked by a player at ${pos().x},${pos().z}`);
    return true;
}

async function waitRespawn(): Promise<void> {
    const life = pos().lifeId;
    log(`Died @ ${pos().x},${pos().z} — waiting respawn`);
    specEnergy = SPEC_MAX;
    specArmed = false;
    await sdk.waitForCondition((s) => !s.player.isDead && s.player.lifeId !== life, 60_000).catch(() => {});
    await ui();
}

session.registerRecovery([
    {
        name: 'back_to_isle',
        run: async () => {
            if (foodCount() === 0) return false;
            await goToIsle();
            return onIsle();
        }
    }
]);
session.setAnchor(CAMP.x, CAMP.z);

try {
    await bot.skipTutorial();
    await ui();
    log(
        `Red dragons (${role()}${isTank() ? '' : ` delay=${DPS_DELAY_TICKS}`}) @ ${pos().x},${pos().z} | ` +
            `Atk ${sdk.getSkill('Attack')?.baseLevel ?? '?'} food=${foodCount()} shields=${shieldsOnPerson()} ` +
            `dlong=${wearingDlong() ? 'worn' : 'no'}`
    );

    while (!session.isStopped()) {
        session.maybeHeartbeat();
        await ui();
        if (pos().isDead) {
            await waitRespawn();
            continue;
        }

        if (await fleePlayer()) {
            continue;
        }

        const hunting = onIsle() || wildySurface() || inMageBank();
        const needBank = bagFull() && hunting;
        const needGear = !wearingDlong() || !wearingShield();
        const needPack = !hunting && !wildyKitReady();
        if (tripFoodCount() < 1 || needGear || needBank || needPack) {
            if (hunting && (onIsle() || inMageBank() || bagIsTripFood())) {
                await mageBankTrip();
                if (tripFoodCount() < 1 || !bagIsTripFood()) {
                    const fed = await resupplyFood();
                    packed = false;
                    if (!fed) {
                        session.log('warn', 'Still no sharks, swordfish, or tuna after cooking and fishing');
                        await sdk.waitForTicks(8);
                    }
                }
            } else {
                await prepareAtVarrockEast();
                if (!wildyKitReady()) {
                    const fed = await resupplyFood();
                    if (!fed) {
                        session.log('warn', 'Still no sharks, swordfish, or tuna after cooking and fishing');
                        await sdk.waitForTicks(8);
                    } else {
                        await prepareAtVarrockEast();
                    }
                }
                packed = wildyKitReady();
                if (!packed) {
                    session.log('warn', `Not entering the wilderness. Bag: ${bagSummary()}`);
                    await sdk.waitForTicks(6);
                }
            }
            await equipWorn();
            continue;
        }

        if (!sdk.findEquipmentItem(FIRE_SHIELD)) {
            await equipWorn();
            if (!sdk.findEquipmentItem(FIRE_SHIELD)) {
                log('Shield is in the bag but would not equip');
                await sdk.waitForTicks(4);
                continue;
            }
        }

        if (!onIsle()) {
            if (!inMageBank() && !wildyKitReady()) {
                packed = false;
                await prepareAtVarrockEast();
                continue;
            }
            await goToIsle();
            continue;
        }

        if (session.metrics().phase !== 'hunt') await session.setPhase('hunt');
        session.setAnchor(pos().x, pos().z);
        await eatIfNeeded();
        await flickMelee();
        if (isLead() || stackedWithLead()) await lootGround();
        await huntPack();
    }
} catch (err) {
    session.stop('script_error', err instanceof Error ? err.message : String(err));
    console.error('Script error:', err);
} finally {
    await session.finalizeStop();
    await sdk.disconnect();
}
