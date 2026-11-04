/**
 * Bulk water or earth runes from one account's bank of rune essence.
 *
 *   bun bots/quests/elemental-runecraft.ts ABGARMY03 --rune=water [--target=30000]
 *   bun bots/quests/elemental-runecraft.ts fatpig --rune=earth
 *
 * One lap: stand at the bank booth with the talisman and 27 unnoted essence,
 * use the talisman on the mysterious ruins, craft at the altar, step through
 * the exit portal, walk back, deposit the runes, withdraw the next load.
 *
 *   water  Draynor booth 3092,3245 <-> ruins 3184,3164 (113 steps each way), RC 5, x2 at 19
 *   earth  Varrock east 3254,3420  <-> ruins 3305,3473 (69 out / 81 back),   RC 9, x2 at 26
 *
 * Below the level gate the account first crafts air runes at Falador east
 * (the `air-rune-craft.ts` route) with its air talisman, then walks to the
 * target bank. Coordinates and loc ids are from `runecraft.dbrow` and the
 * jm2 maps; see `rc-route.ts`. Runes per essence is `level / multiplier + 1`
 * (`runecraft.rs2`).
 *
 * Stops (all at a bank, exit 0): `--target` runes banked, out of essence, no
 * talisman. SIGTERM finishes the craft in hand, walks out and banks.
 */
import { existsSync, readFileSync } from 'fs';
import { dirname, join } from 'path';
import { ActivitySession, BotSDK, deriveGatewayUrl } from '../../sdk/index';
import { BotActions } from '../../sdk/actions';
import { installGracefulShutdown } from '../../sdk/runner';
import { closeUi, installWaitForTicksGuard, walkSendHops } from './movement';
import { ensureBankStart, parkAtBank, SAFE_BANKS, type SafeBankName } from './safe-stops';
import { ticksToMs, untilTicks } from './lib/ticks';
import { runesPerEssence } from './rc-trip';
import {
    AIR_ALTAR,
    AIR_ALTAR_ID,
    AIR_ENTER,
    AIR_PORTAL,
    AIR_PORTAL_ID,
    AIR_RUINS,
    AIR_RUINS_ID,
    EARTH_ALTAR,
    EARTH_ALTAR_ID,
    EARTH_ENTER,
    EARTH_PORTAL,
    EARTH_PORTAL_ID,
    EARTH_RUINS,
    EARTH_RUINS_ID,
    planAirRoute,
    planEarthRoute,
    planWaterRoute,
    WATER_ALTAR,
    WATER_ALTAR_ID,
    WATER_ENTER,
    WATER_PORTAL,
    WATER_PORTAL_ID,
    WATER_RUINS,
    WATER_RUINS_ID,
    type AltarRoute,
    type LocFootprint,
    type Tile
} from './rc-route';

type RuneKind = 'air' | 'water' | 'earth';

interface AltarSpec {
    kind: RuneKind;
    level: number;
    /** `runecraft_table:multiplier`: one extra rune per essence every `multiplier` levels. */
    multiplier: number;
    bank: SafeBankName;
    bankLabel: string;
    route: AltarRoute;
    ruins: LocFootprint;
    ruinsId: number;
    altar: LocFootprint;
    altarId: number;
    portal: LocFootprint;
    portalId: number;
    /** The interior is the whole map square of `enter_coord`. */
    enter: Tile;
    talisman: RegExp;
    rune: RegExp;
}

const SPECS: Record<RuneKind, () => AltarSpec> = {
    air: () => ({
        kind: 'air',
        level: 1,
        multiplier: 11,
        bank: 'falador-east',
        bankLabel: 'Falador east',
        route: planAirRoute(),
        ruins: AIR_RUINS,
        ruinsId: AIR_RUINS_ID,
        altar: AIR_ALTAR,
        altarId: AIR_ALTAR_ID,
        portal: AIR_PORTAL,
        portalId: AIR_PORTAL_ID,
        enter: AIR_ENTER,
        talisman: /^air talisman$/i,
        rune: /^air rune$/i
    }),
    water: () => ({
        kind: 'water',
        level: 5,
        multiplier: 19,
        bank: 'draynor',
        bankLabel: 'Draynor',
        route: planWaterRoute(),
        ruins: WATER_RUINS,
        ruinsId: WATER_RUINS_ID,
        altar: WATER_ALTAR,
        altarId: WATER_ALTAR_ID,
        portal: WATER_PORTAL,
        portalId: WATER_PORTAL_ID,
        enter: WATER_ENTER,
        talisman: /^water talisman$/i,
        rune: /^water rune$/i
    }),
    earth: () => ({
        kind: 'earth',
        level: 9,
        multiplier: 26,
        bank: 'varrock-east',
        bankLabel: 'Varrock east',
        route: planEarthRoute(),
        ruins: EARTH_RUINS,
        ruinsId: EARTH_RUINS_ID,
        altar: EARTH_ALTAR,
        altarId: EARTH_ALTAR_ID,
        portal: EARTH_PORTAL,
        portalId: EARTH_PORTAL_ID,
        enter: EARTH_ENTER,
        talisman: /^earth talisman$/i,
        rune: /^earth rune$/i
    })
};

const ESSENCE = /^rune essence$/i;
const ANY_ELEMENTAL_RUNE = /^(air|water|earth) rune$/i;
const LOAD = 27;

const argv = process.argv.slice(2);
const botArg = argv.find((a) => !a.startsWith('-'));
const flag = (name: string): string | undefined =>
    argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);

const runeArg = flag('rune');
if (runeArg !== 'water' && runeArg !== 'earth') {
    console.error('Usage: bun bots/quests/elemental-runecraft.ts <account> --rune=water|earth [--target=N]');
    process.exit(2);
}
const TARGET_RUNES = Math.max(1, parseInt(flag('target') ?? '30000', 10) || 30000);

function loadBotEnv(): void {
    const envPath = botArg
        ? join(process.cwd(), 'bots', botArg, 'bot.env')
        : join(dirname(import.meta.path), 'bot.env');
    if (!existsSync(envPath)) {
        throw new Error(`bot.env not found at ${envPath}. Usage: bun bots/quests/elemental-runecraft.ts {botname} --rune=water|earth`);
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

const TARGET = SPECS[runeArg]();
const AIR = SPECS.air();
const ALL_SPECS = [AIR, TARGET];

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
    name: `rc-${TARGET.kind}`,
    grindLogPath: GRIND_LOG,
    stallMs: 360_000,
    maxRecoveryTactics: 8
});

// The drain deadline below is 300s (one walk back from the ruins at worst).
installGracefulShutdown({ graceMs: 360_000 });
installWaitForTicksGuard(sdk, session);

function log(msg: string): void {
    session.log('log', msg);
}

function warn(msg: string): void {
    session.log('warn', msg);
}

function pos(): { x: number; z: number; dead: boolean } {
    const p = sdk.getState()?.player;
    return { x: p?.worldX ?? 0, z: p?.worldZ ?? 0, dead: p?.isDead ?? false };
}

function here(): string {
    const p = pos();
    return `${p.x},${p.z}`;
}

function dist(tile: Tile): number {
    const p = pos();
    return Math.hypot(p.x - tile.x, p.z - tile.z);
}

function count(pattern: RegExp): number {
    return sdk
        .getInventory()
        .filter((i) => pattern.test(i.name))
        .reduce((n, i) => n + (i.count ?? 1), 0);
}

function isUnnotedEssence(item: { name: string; count?: number }): boolean {
    return ESSENCE.test(item.name) && (item.count ?? 0) === 1;
}

function unnotedEssence(): number {
    return sdk.getInventory().filter(isUnnotedEssence).length;
}

function rcLevel(): number {
    return sdk.getSkill('Runecraft')?.baseLevel ?? 1;
}

function rcXp(): number {
    return sdk.getSkill('Runecraft')?.experience ?? 0;
}

function inInterior(spec: AltarSpec, x = pos().x, z = pos().z): boolean {
    return x >> 6 === spec.enter.x >> 6 && z >> 6 === spec.enter.z >> 6;
}

function interiorHere(): AltarSpec | null {
    return ALL_SPECS.find((s) => inInterior(s)) ?? null;
}

/** Air below the target's level gate, then the target. */
function active(): AltarSpec {
    return rcLevel() < TARGET.level ? AIR : TARGET;
}

function bankTile(spec: AltarSpec): Tile {
    return SAFE_BANKS[spec.bank];
}

/** Everything except one of the spec's talismans and unnoted essence. */
function foreignItems(spec: AltarSpec) {
    const kept = sdk.getInventory().find((i) => spec.talisman.test(i.name) && (i.count ?? 0) > 0);
    return sdk.getInventory().filter((i) => {
        if ((i.count ?? 0) <= 0) return false;
        if (i.slot === kept?.slot) return false;
        return !isUnnotedEssence(i);
    });
}

function summary(items: Array<{ name: string; count?: number }>): string {
    const counts = new Map<string, number>();
    for (const item of items) counts.set(item.name, (counts.get(item.name) ?? 0) + (item.count ?? 1));
    return [...counts.entries()].map(([name, n]) => `${name} x${n}`).join(', ');
}

function craftLoad(spec: AltarSpec): boolean {
    return foreignItems(spec).length === 0 && count(spec.talisman) >= 1 && unnotedEssence() >= 1;
}

// --- level / multiplier bookkeeping ---------------------------------------

function multiplierText(spec: AltarSpec, level: number): string {
    const per = runesPerEssence(level, spec.multiplier);
    const next = (Math.floor(level / spec.multiplier) + 1) * spec.multiplier;
    return `${spec.kind} x${per}/essence (x${per + 1} at ${next})`;
}

let lastLevel = 0;
function noteLevel(): void {
    const level = rcLevel();
    if (level === lastLevel) return;
    const was = lastLevel;
    lastLevel = level;
    const gate = level < TARGET.level ? ` | training air until ${TARGET.level}` : '';
    if (was === 0) log(`Runecraft ${level} | ${multiplierText(TARGET, level)}${gate}`);
    else {
        log(`Runecraft ${was} -> ${level} | ${multiplierText(TARGET, level)}${gate}`);
        if (runesPerEssence(level, TARGET.multiplier) > runesPerEssence(was, TARGET.multiplier)) {
            log(`MULTIPLIER UP: ${TARGET.kind} now x${runesPerEssence(level, TARGET.multiplier)} runes per essence`);
        }
        if (was < TARGET.level && level >= TARGET.level) log(`Level gate met (${TARGET.level}) — switching to ${TARGET.kind}`);
    }
}

// --- walking ---------------------------------------------------------------

async function walkExact(tile: Tile): Promise<boolean> {
    session.setAnchor(tile.x, tile.z);
    if (dist(tile) === 0) return true;
    if (dist(tile) > 4) {
        await bot.walkTo(tile.x, tile.z, 0);
        if (dist(tile) > 4) {
            // walkTo gives up on some long legs; path-aware sendWalk hops finish them.
            await walkSendHops(sdk, [tile], tile, 3);
        }
        if (dist(tile) === 0) return true;
        if (dist(tile) > 4) return false;
    }
    await sdk.sendWalk(tile.x, tile.z, true);
    await untilTicks(sdk, (s) => (s.player?.worldX ?? 0) === tile.x && (s.player?.worldZ ?? 0) === tile.z, 8);
    return dist(tile) === 0;
}

/** Long transfer between banks (training at Falador, then the target bank). */
async function walkToBank(spec: AltarSpec): Promise<boolean> {
    const tile = bankTile(spec);
    if (dist(tile) <= 12) return true;
    await session.setPhase(`walk-${spec.bank}`);
    log(`Walking to ${spec.bankLabel} bank from ${here()}`);
    for (let attempt = 0; attempt < 4 && dist(tile) > 12; attempt++) {
        const before = dist(tile);
        await bot.walkTo(tile.x, tile.z, 2);
        if (dist(tile) > 12) await walkSendHops(sdk, [tile], tile, 4);
        if (dist(tile) < before - 2) session.noteProgress('location', here());
        else warn(`No progress toward ${spec.bankLabel} @ ${here()}`);
    }
    return dist(tile) <= 12;
}

// --- bank ------------------------------------------------------------------

let lapStartedAt = 0;
let lapStartTick = 0;
let laps = 0;
let lapEssence = 0;
let runesCrafted = 0;
let lastBankTotal = -1;

function bankCount(pattern: RegExp): number {
    return sdk.getBankItems().filter((i) => pattern.test(i.name)).reduce((n, i) => n + (i.count ?? 0), 0);
}

async function openBankAt(spec: AltarSpec): Promise<boolean> {
    if (sdk.getState()?.bank?.isOpen) return true;
    const booth = sdk.findNearbyLoc(/bank booth/i, { reachable: true });
    if (!(booth && (booth.distance ?? 99) <= 4) && !(await walkExact(spec.route.stand))) {
        if (!(await walkToBank(spec))) return false;
    }
    for (let attempt = 0; attempt < 3; attempt++) {
        const opened = await bot.openBank();
        if (opened.success || sdk.getState()?.bank?.isOpen) return true;
        warn(`${spec.bankLabel} bank did not open (${opened.message}) @ ${here()}`);
        await walkExact(spec.route.stand);
    }
    return false;
}

/** Deposit everything, talisman included. The handoff-clean state for a stop. */
async function depositEverything(): Promise<void> {
    for (let pass = 0; pass < 30; pass++) {
        const item = sdk.getInventory().find((i) => (i.count ?? 0) > 0);
        if (!item) return;
        const before = sdk.getInventory().filter((i) => (i.count ?? 0) > 0).length;
        await bot.depositItem(item, -1);
        if (sdk.getInventory().filter((i) => (i.count ?? 0) > 0).length >= before) return;
    }
}

/**
 * Terminal stop from an open bank. `stop` always logs at ERROR, so the LOG
 * line says it is a normal finish; the no-op drain marks park.json banked.
 */
async function finishAtBank(spec: AltarSpec, code: string, message: string): Promise<void> {
    await depositEverything();
    await bot.closeBank().catch(() => undefined);
    log(`FINISHED (${code}): ${message} | crafted ${runesCrafted} ${TARGET.kind} this run`);
    await session.setPhase(spec.bank);
    await session.drainToBank(async () => true);
    session.stop(code, message, { restartable: false });
}

/** Deposit runes and junk, check the target, withdraw talisman and 27 essence. */
async function bankLap(spec: AltarSpec): Promise<boolean> {
    await session.setPhase('bank');
    if (pos().x === 0 && pos().z === 0) {
        warn('No live position — waiting for the client before banking');
        await sdk.waitForTicks(5).catch(() => {});
        return false;
    }
    await closeUi(bot, sdk);
    if (dist(bankTile(spec)) > 20 && !(await walkToBank(spec))) {
        session.noteFailure('walk', `Could not reach ${spec.bankLabel} bank @ ${here()}`);
        return false;
    }
    if (!(await openBankAt(spec))) {
        session.noteFailure('bank', `Could not open ${spec.bankLabel} bank @ ${here()}`);
        return false;
    }

    // Runes first, so the trip is recorded even if a later deposit fails.
    for (let pass = 0; pass < 4 && count(ANY_ELEMENTAL_RUNE) > 0; pass++) {
        const stack = sdk.getInventory().find((i) => ANY_ELEMENTAL_RUNE.test(i.name) && (i.count ?? 0) > 0);
        if (!stack) break;
        const n = stack.count ?? 1;
        const deposited = await bot.depositItem(stack, -1);
        if (!deposited.success && count(new RegExp(`^${stack.name}$`, 'i')) > 0) {
            session.noteFailure('bank', `Could not deposit ${stack.name}: ${deposited.message}`);
            return false;
        }
        if (lapStartedAt > 0 && spec.rune.test(stack.name)) {
            laps++;
            session.recordTrip(n);
            const sec = (Date.now() - lapStartedAt) / 1000;
            const ticks = (sdk.getState()?.tick ?? 0) - lapStartTick;
            const per = lapEssence > 0 ? (n / lapEssence).toFixed(2) : '?';
            const banked = bankCount(spec.rune);
            log(
                `Lap ${laps} ${spec.kind}: ${n} runes from ${lapEssence} essence (x${per}) in ${sec.toFixed(1)}s / ${ticks} ticks ` +
                    `| ${(60 / sec).toFixed(2)} laps/min | bank ${banked} ${spec.kind} | rc ${rcLevel()}`
            );
            lapStartedAt = 0;
        }
    }
    const junk = foreignItems(spec);
    if (junk.length) log(`Depositing ${summary(junk)}`);
    for (let pass = 0; pass < 30 && foreignItems(spec).length > 0; pass++) {
        const item = foreignItems(spec)[0]!;
        // An extra talisman goes one at a time: -1 would bank the whole stack, kept one included.
        const amount = spec.talisman.test(item.name) ? 1 : -1;
        const before = foreignItems(spec).length;
        const deposited = await bot.depositItem(item, amount);
        if (foreignItems(spec).length < before) continue;
        session.noteFailure('bank', `Could not deposit ${item.name}: ${deposited.message}`);
        return false;
    }

    const total = bankCount(TARGET.rune) + count(TARGET.rune);
    if (total !== lastBankTotal) {
        lastBankTotal = total;
        if (spec === TARGET || laps === 0) log(`${TARGET.kind} runes held: ${total}/${TARGET_RUNES}`);
    }
    if (total >= TARGET_RUNES) {
        await finishAtBank(spec, 'target_reached', `${total} ${TARGET.kind} runes banked (target ${TARGET_RUNES})`);
        return false;
    }

    if (count(spec.talisman) < 1) {
        if (!sdk.findBankItem(spec.talisman)) {
            const why = spec === AIR ? ` — Runecraft ${rcLevel()} needs ${TARGET.level} for ${TARGET.kind} and air trains it` : '';
            await finishAtBank(spec, 'no_talisman', `No ${spec.kind} talisman in inventory or bank${why}`);
            return false;
        }
        const withdrawn = await bot.withdrawItem(spec.talisman, 1);
        if (!(await untilTicks(sdk, () => count(spec.talisman) >= 1, 6))) {
            session.noteFailure('bank', `${spec.kind} talisman withdraw failed: ${withdrawn.message}`);
            return false;
        }
    }
    if (unnotedEssence() < LOAD) {
        if (!sdk.findBankItem(ESSENCE) && unnotedEssence() === 0) {
            await finishAtBank(spec, 'out_of_essence', `No rune essence left | ${total} ${TARGET.kind} runes banked`);
            return false;
        }
        if (sdk.findBankItem(ESSENCE)) {
            // All fills the free slots; a typed 27 opens the X dialog (air-rune-craft.ts).
            const withdrawn = await bot.withdrawItem(ESSENCE, -1);
            if (!(await untilTicks(sdk, () => unnotedEssence() >= 1, 6))) {
                session.noteFailure('bank', `Essence withdraw failed: ${withdrawn.message}`);
                return false;
            }
        }
    }
    if (!craftLoad(spec)) {
        session.noteFailure('bank', `Not a craft load: ${summary(foreignItems(spec)) || 'missing essence or talisman'}`);
        return false;
    }
    session.captureBankStock();
    lapEssence = unnotedEssence();
    await bot.closeBank();
    session.noteProgress('bank', `essence ${lapEssence}`);
    lapStartedAt = Date.now();
    lapStartTick = sdk.getState()?.tick ?? 0;
    return true;
}

// --- ruins / altar / portal -------------------------------------------------

async function craftHere(spec: AltarSpec): Promise<boolean> {
    await session.setPhase('craft');
    if (rcLevel() < spec.level) {
        warn(`Runecraft ${rcLevel()} cannot craft ${spec.kind} (needs ${spec.level})`);
        return false;
    }
    const before = unnotedEssence();
    const runesBefore = count(spec.rune);
    const xp = rcXp();
    await sdk.scanNearbyLocs(10).catch(() => {});
    const altar = sdk.findNearbyLoc(/^altar$/i);
    if (altar) await bot.interactLoc(altar, /craft-rune/i);
    else await sdk.sendInteractLoc(spec.altar.x, spec.altar.z, spec.altarId, 1);
    const bound = await untilTicks(sdk, (s) => {
        const ess = s.inventory.filter((i) => isUnnotedEssence(i)).length;
        const gained = (s.skills.find((sk) => /runecraft/i.test(sk.name))?.experience ?? 0) > xp;
        return ess < before || gained;
    }, 12);
    if (!bound) {
        session.noteFailure('craft', `${spec.kind} altar did not bind essence @ ${here()}`);
        return false;
    }
    // p_delay(3): a portal click before the script resumes is dropped.
    await sdk.waitForTicks(4);
    const made = count(spec.rune) - runesBefore;
    if (made > 0) {
        runesCrafted += spec === TARGET ? made : 0;
        session.noteProgress('xp', `${spec.kind} ${made}`);
    }
    noteLevel();
    return unnotedEssence() < before;
}

async function enterAndCraft(spec: AltarSpec): Promise<boolean> {
    if (!inInterior(spec)) {
        await session.setPhase('ruins');
        if (!(await walkExact(spec.route.approach))) {
            session.noteFailure('ruins', `${spec.kind} ruins approach failed @ ${here()}`);
            return false;
        }
        const tali = sdk.findInventoryItem(spec.talisman);
        if (!tali) {
            session.noteFailure('ruins', `${spec.kind} talisman missing at the ruins`);
            return false;
        }
        // A use sent while the last walk step is still settling can be dropped: resend once.
        let entered = false;
        for (let attempt = 0; attempt < 2 && !entered; attempt++) {
            await sdk.sendUseItemOnLoc(tali.slot, spec.ruins.x, spec.ruins.z, spec.ruinsId);
            entered = await untilTicks(sdk, (s) => inInterior(spec, s.player?.worldX ?? 0, s.player?.worldZ ?? 0), 10);
        }
        if (!entered) {
            session.noteFailure('ruins', `${spec.kind} talisman did not enter @ ${here()}`);
            return false;
        }
    }
    if (!(await walkExact(spec.route.altarStand))) {
        session.noteFailure('altar', `${spec.kind} altar stand failed @ ${here()}`);
        return false;
    }
    return craftHere(spec);
}

async function leaveAltar(spec: AltarSpec): Promise<boolean> {
    if (!inInterior(spec)) return true;
    await session.setPhase('portal');
    for (let attempt = 0; attempt < 3 && inInterior(spec); attempt++) {
        await walkExact(spec.route.portalStand);
        await sdk.scanNearbyLocs(8).catch(() => {});
        const portal = sdk.findNearbyLoc(/^portal$/i);
        if (portal) await bot.interactLoc(portal, /use/i);
        else await sdk.sendInteractLoc(spec.portal.x, spec.portal.z, spec.portalId, 1);
        await untilTicks(sdk, (s) => !inInterior(spec, s.player?.worldX ?? 0, s.player?.worldZ ?? 0), 10);
    }
    if (inInterior(spec)) {
        session.noteFailure('portal', `${spec.kind} portal did not exit @ ${here()}`);
        return false;
    }
    return true;
}

/** Drain stage: craft what is in hand inside a temple, then step out. Outside, the bank walk is the drain. */
async function drainOneStage(): Promise<void> {
    const inside = interiorHere();
    if (!inside) return;
    if (unnotedEssence() > 0 && rcLevel() >= inside.level) await craftHere(inside);
    await leaveAltar(inside);
}

// --- main loop -------------------------------------------------------------

try {
    noteLevel();
    log(
        `Elemental RC ${TARGET.kind} target ${TARGET_RUNES} | ${TARGET.bankLabel} stand ${TARGET.route.stand.x},${TARGET.route.stand.z} ` +
            `-> ruins ${TARGET.route.approach.x},${TARGET.route.approach.z} (${TARGET.route.outboundSteps} out / ${TARGET.route.returnSteps} back)`
    );
    const startBank = interiorHere() ? null : active().bank;
    if (startBank && !(await ensureBankStart(sdk, bot, startBank, GRIND_LOG))) {
        warn(`Starting away from ${active().bankLabel} bank @ ${here()} — routing anyway`);
    }
    while (!session.isStoppedOrRequested()) {
        if (session.needsRecovery()) {
            if ((await session.recover()) === 'exhausted') break;
            continue;
        }
        if (pos().dead) {
            warn(`Died @ ${here()}`);
            await untilTicks(sdk, (s) => s.player?.isDead !== true, 60);
            continue;
        }
        await closeUi(bot, sdk);
        const inside = interiorHere();
        if (inside) {
            if (unnotedEssence() > 0 && rcLevel() >= inside.level) await craftHere(inside);
            await leaveAltar(inside);
            continue;
        }
        const spec = active();
        if (!craftLoad(spec) || dist(spec.route.stand) > 20) {
            if (!(await bankLap(spec))) {
                if (!session.isStopped()) await sdk.waitForTicks(3);
            }
            continue;
        }
        if (session.stopRequested) break;
        if (!(await enterAndCraft(spec))) continue;
        await leaveAltar(spec);
    }
    if (session.stopRequested) {
        const outcome = await session.drainToBank(
            async () => {
                // park.json records the phase name as the bank.
                await session.setPhase(active().bank);
                return parkAtBank(sdk, bot, active().bank, { timeoutMs: 240_000 });
            },
            { deadlineMs: 300_000, onStage: drainOneStage }
        );
        session.stop('stopped', `drained to bank: ${outcome} | crafted ${runesCrafted} ${TARGET.kind} this run`, {
            restartable: false
        });
    }
} catch (err) {
    session.stopRestartable('script_error', err instanceof Error ? err.message : String(err));
} finally {
    await session.finalizeStop().catch(() => undefined);
    await sdk.disconnect();
}
