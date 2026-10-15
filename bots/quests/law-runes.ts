/**
 * Law runes for one account. Bank at Draynor, then sail to Entrana the way
 * `lost-city.ts` does: monk at (3045, 3236), "Yes, okay, I'm ready to go.",
 * do not close the ship modal, Cross the gangplank. Use a law talisman on
 * the ruins, craft, portal back, sail to Port Sarim, deposit at Draynor.
 *
 *   bun bots/quests/law-runes.ts jackthief
 */
import { ActivitySession, BotSDK, deriveGatewayUrl } from '../../sdk/index';
import { installGracefulShutdown } from '../../sdk/runner';
import { ensureBankStart, parkAtBank } from './safe-stops';
import { BotActions } from '../../sdk/actions';
import { initPathfinding } from '../../sdk/pathfinding';
import { existsSync, readFileSync } from 'fs';
import { dirname, join } from 'path';
import { walkKandarinToEdgeville, walkSendHops } from './movement';
import { findLongPath } from '../../sdk/pathfinding';

/** Lost City's Draynor booth stand and Port Sarim monk. */
const DRAYNOR_BOOTH = { x: 3092, z: 3243 };
const PORT_SARIM_MONK = { x: 3045, z: 3236 };
const ENTRANA_DOCK = { x: 2834, z: 3335 };
/** Lost City `DRAYNOR_TO_SARIM`. */
const DRAYNOR_TO_SARIM = [
    { x: 3075, z: 3240 },
    { x: 3058, z: 3238 },
    PORT_SARIM_MONK
];
/**
 * South from the White Wolf exit (south of the Edgeville ditch) to Draynor.
 * Hops north of the player are skipped, so this also works from Falador.
 * Do not sendWalk here from Kandarin — that chord never crosses the mountain.
 */
const EDGE_SOUTH_TO_DRAYNOR = [
    { x: 3094, z: 3492 },
    { x: 3088, z: 3468 },
    { x: 3079, z: 3419 },
    { x: 3088, z: 3360 },
    { x: 3104, z: 3291 },
    { x: 3093, z: 3244 },
    DRAYNOR_BOOTH
];
/** `runecraft_law` altar_coord `0_44_52_42_53`. */
const LAW_RUINS = { x: 2858, z: 3381 };
/** `runecraft_law` exit_coord `0_44_52_42_50`. */
const LAW_EXIT = { x: 2858, z: 3378 };
const DOCK_TO_RUINS = [
    { x: 2846, z: 3352 },
    { x: 2856, z: 3366 },
    LAW_EXIT,
    LAW_RUINS
];

const LAW_RC = 54;
const ESSENCE = /^rune essence$/i;
const TALISMAN = /^law talisman$/i;
const LAW = /^law rune$/i;
/** Same ban list as `lost-city.ts` `BANNED`. Entrana refuses weapons and armour. */
const BANNED =
    /axe|pickaxe|sword|scimitar|dagger|mace|spear|warhammer|battleaxe|halberd|bow|crossbow|arrow|bolt|javelin|dart|claws|whip|helm|plate|chain|legs|skirt|boots|gloves|gauntlet|shield|defender|kiteshield|cape|cloak|coif|vambrace|chaps|\bbody\b|\btop\b|robe/i;

const argv = process.argv.slice(2);
const botArg = argv.find((a) => !a.startsWith('-'));

function loadBotEnv(): void {
    const envPath = botArg
        ? join(process.cwd(), 'bots', botArg, 'bot.env')
        : join(dirname(import.meta.path), 'bot.env');
    if (!existsSync(envPath)) {
        throw new Error(`bot.env not found at ${envPath}. Usage: bun bots/quests/law-runes.ts {botname}`);
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
    name: 'law-runes',
    grindLogPath: GRIND_LOG,
    stallMs: 360_000,
    maxRecoveryTactics: 8
});

// Graceful shutdown: SIGTERM finishes the stage and banks instead of dying
// mid-route. Stops only ever end at Draynor bank (or a timed-out park).
// Grace covers the full temple->bank drain (deadline 600s below).
installGracefulShutdown({ graceMs: 660_000 });
if (!(await ensureBankStart(sdk, bot, 'draynor', GRIND_LOG))) {
    session.log('warn', `starting away from Draynor bank @ ${here()} — routing anyway`);
}

let crafted = 0;

/**
 * One-off rescue: walk to the Draynor booth in <=5-tile sendWalk hops and
 * exit. Run ONLY with the roster grind stopped (launchd stop jackthief),
 * otherwise this steals control from the live owner:
 *
 *   bun bots/quests/law-runes.ts jackthief --rescue
 */
async function runRescue(): Promise<boolean> {
    // Path-following rescue: the dead-tree forest drops long straight chords,
    // so recompute the client path each step and hop ~6 tiles along it.
    let wedged = 0;
    for (let i = 0; i < 80; i++) {
        const p = pos();
        if (distTo(DRAYNOR_BOOTH.x, DRAYNOR_BOOTH.z) <= 6) break;
        let target: { x: number; z: number } | null = null;
        try {
            const path = findLongPath(p.level, p.x, p.z, DRAYNOR_BOOTH.x, DRAYNOR_BOOTH.z);
            if (path && path.length > 0) target = path[Math.min(6, path.length - 1)] as { x: number; z: number };
        } catch {}
        target ??= DRAYNOR_BOOTH;
        await sdk.sendWalk(target.x, target.z, true).catch(() => null);
        const moved = await until(() => pos().x !== p.x || pos().z !== p.z, 8_000);
        session.log(moved ? 'log' : 'warn', `rescue step ${i + 1}: ${p.x},${p.z} -> ${here()} via ${target.x},${target.z} (booth ${Math.round(distTo(DRAYNOR_BOOTH.x, DRAYNOR_BOOTH.z))})`);
        if (!moved) {
            const sx = p.x + (p.x >= target.x ? 3 : -3);
            await sdk.sendWalk(sx, p.z, true).catch(() => null);
            await until(() => pos().x !== p.x || pos().z !== p.z, 8_000);
        }
        if (pos().x === p.x && pos().z === p.z) {
            if (++wedged >= 3) {
                session.log('warn', `rescue: wedged 3 steps @ ${here()}, aborting`);
                return false;
            }
        } else wedged = 0;
    }
    const arrived = distTo(DRAYNOR_BOOTH.x, DRAYNOR_BOOTH.z) <= 6;
    session.log(arrived ? 'log' : 'warn', `rescue: ${arrived ? 'arrived' : 'failed to reach booth'} @ ${here()}`);
    return arrived;
}

if (argv.includes('--rescue')) {
    const ok = await runRescue();
    await sdk.disconnect().catch(() => undefined);
    process.exit(ok ? 0 : 1);
}

function log(msg: string): void {
    session.log('log', msg);
}

function pos() {
    const p = sdk.getState()?.player;
    return {
        x: p?.worldX ?? 0,
        z: p?.worldZ ?? 0,
        level: p?.level ?? 0,
        hp: p?.hp ?? 10,
        maxHp: p?.maxHp ?? 10,
        isDead: p?.isDead ?? false
    };
}

function here(): string {
    const p = pos();
    return `${p.x},${p.z}`;
}

function distTo(x: number, z: number): number {
    const p = pos();
    return Math.hypot(p.x - x, p.z - z);
}

function count(pattern: RegExp): number {
    return sdk.getInventory().reduce((n, i) => n + (pattern.test(i.name) ? (i.count ?? 1) : 0), 0);
}

function unnotedEssence(): number {
    return sdk.getInventory().filter((i) => ESSENCE.test(i.name) && (i.count ?? 0) === 1).length;
}

function rcLevel(): number {
    return sdk.getSkill('Runecraft')?.baseLevel ?? 1;
}

/** Lost City `onEntrana`. */
function onEntrana(): boolean {
    const p = pos();
    return p.z < 6400 && p.x >= 2795 && p.x <= 2885 && p.z >= 3320 && p.z <= 3405;
}

/** Lost City `onShip`: upstairs and still next to the Entrana dock. */
function onShip(): boolean {
    return pos().level >= 1 && distTo(ENTRANA_DOCK.x, ENTRANA_DOCK.z) < 30;
}

/** `runecraft_law` enter_coord is map square 38,75. */
function inLawTemple(): boolean {
    const p = pos();
    return p.x >= 2432 && p.x < 2496 && p.z >= 4800 && p.z < 4864;
}

function bannedName(): string | null {
    const inv = sdk.getInventory().find((i) => (i.count ?? 0) > 0 && BANNED.test(i.name));
    if (inv) return inv.name;
    const worn = sdk.getEquipment().find((i) => (i.count ?? 0) > 0 && BANNED.test(i.name));
    return worn?.name ?? null;
}

function bankReady(): boolean {
    const s = sdk.getState();
    return !!(s?.bank?.isOpen || s?.interface?.interfaceId === 5292);
}

async function until(pred: () => boolean, ms: number): Promise<boolean> {
    try {
        await sdk.waitForCondition(() => pred(), ms);
        return true;
    } catch {
        return pred();
    }
}

function dialogSig(): string {
    const d = sdk.getDialog();
    if (!d?.isOpen) return '';
    return [d.text ?? '', ...(d.allComponents ?? []).map((c) => c.text ?? ''), ...(d.options ?? []).map((o) => `${o.componentId}:${o.text}`)].join('|');
}

/** Lost City: a second click before the next page arrives hits the wrong button. */
async function clickAndAwaitPage(index: number): Promise<void> {
    const prev = dialogSig();
    await sdk.sendClickDialog(index);
    for (let i = 0; i < 12; i++) {
        await sdk.waitForTicks(1);
        const now = dialogSig();
        if (now !== prev && now !== '') return;
    }
}

async function closeUi(): Promise<void> {
    for (let i = 0; i < 6; i++) {
        await bot.dismissBlockingUI();
        const dialog = sdk.getDialog();
        const opts = dialog?.options ?? [];
        if (dialog?.isOpen && (opts.length <= 1 || opts.every((o) => /click here to continue/i.test(o.text)))) {
            await clickAndAwaitPage(opts[0]?.index ?? 0);
            continue;
        }
        const s = sdk.getState();
        if (s?.shop?.isOpen) {
            await bot.closeShop();
            continue;
        }
        if (bankReady() || s?.interface?.isOpen) {
            if (bankReady()) await bot.closeBank();
            else await bot.closeInterface();
            continue;
        }
        break;
    }
}

function monkChoiceOpen(): boolean {
    const opts = sdk.getDialog()?.options ?? [];
    const lines = opts.filter((o) => !/click here to continue/i.test(o.text));
    return lines.length >= 2 && lines.some((o) => /not right now|ready to go/i.test(o.text));
}

async function hopTo(hops: Array<{ x: number; z: number }>, dest: { x: number; z: number }): Promise<void> {
    const before = distTo(dest.x, dest.z);
    await walkSendHops(sdk, hops, dest, 4);
    const mid = distTo(dest.x, dest.z);
    if (mid > 6) {
        await Promise.race([
            sdk.sendWalk(dest.x, dest.z, true),
            new Promise((resolve) => setTimeout(resolve, 8_000))
        ]);
        await until(() => distTo(dest.x, dest.z) <= 6, 8_000);
    }
    // Fail loudly: a full pass with zero progress used to spin forever while
    // the fleet read the loop as healthy. This arms repeat×5 recovery instead.
    const after = distTo(dest.x, dest.z);
    if (before <= 8 + 2) return;
    if (after >= before - 2) {
        session.noteFailure('no_movement', `hopTo made no progress toward ${dest.x},${dest.z} (was ${Math.round(before)}, now ${Math.round(after)} @ ${here()})`);
    } else {
        session.noteProgress('location', `hopTo closed to ${Math.round(after)} of ${dest.x},${dest.z}`);
    }
}

async function eatIfLow(): Promise<void> {
    const p = pos();
    if (p.hp > Math.max(20, p.maxHp - 20)) return;
    const food = sdk.findInventoryItem(/shark|lobster|swordfish|tuna|bass|monkfish|pizza|cake|bread/i);
    if (food) await bot.eatFood(food);
}

/**
 * Kandarin does not pathfind east. Cross White Wolf to the Edgeville side,
 * then hop south to the Draynor booth.
 */
async function goToDraynor(): Promise<void> {
    if (distTo(DRAYNOR_BOOTH.x, DRAYNOR_BOOTH.z) <= 8) return;
    if (pos().x < 2940 && pos().z < 6400 && !onEntrana()) {
        log(`White Wolf toward Draynor from ${here()}`);
        const crossed = await walkKandarinToEdgeville(bot, sdk, { eat: eatIfLow });
        log(`White Wolf crossed=${crossed} @ ${here()}`);
        if (pos().x < 2940) return;
    }
    await hopTo(EDGE_SOUTH_TO_DRAYNOR, DRAYNOR_BOOTH);
}

/** Lost City `openNearestBooth`, aimed at the Draynor stand. */
async function openDraynorBooth(): Promise<boolean> {
    if (bankReady()) return true;
    await closeUi();
    if (distTo(DRAYNOR_BOOTH.x, DRAYNOR_BOOTH.z) > 8) await goToDraynor();
    await sdk.scanNearbyLocs(8).catch(() => {});
    const booth = (sdk.getNearbyLocs() ?? [])
        .filter(
            (l) =>
                /^bank booth$/i.test(l.name) &&
                (l.optionsWithIndex ?? []).some((o) => /use-quickly/i.test(o.text))
        )
        .sort((a, b) => (a.distance ?? 99) - (b.distance ?? 99))[0];
    if (!booth) {
        session.log('warn', `No Draynor booth @ ${here()}`);
        return false;
    }
    const quickly = (booth.optionsWithIndex ?? []).find((o) => /use-quickly/i.test(o.text));
    log(`Booth ${booth.x},${booth.z} use-quickly from ${here()}`);
    await Promise.race([
        sdk.sendInteractLoc(booth.x, booth.z, booth.id, quickly?.opIndex ?? 2),
        new Promise((resolve) => setTimeout(resolve, 8_000))
    ]);
    const open = await until(() => bankReady(), 8_000);
    if (!open) session.log('warn', `Draynor bank still closed @ ${here()}`);
    return open;
}

async function stripGear(): Promise<void> {
    for (const item of [...sdk.getEquipment()]) {
        if ((item.count ?? 0) <= 0) continue;
        if (!BANNED.test(item.name)) continue;
        log(`Unequipping ${item.name}`);
        await bot.unequipItem(item);
        await sdk.waitForTicks(1);
    }
}

async function bankAtDraynor(): Promise<boolean> {
    await session.setPhase('draynor_bank');
    // Anchor so the default `rewalk` recovery tactic walks toward the booth
    // instead of no-opping (it did nothing here since Oct 12).
    session.setAnchor(DRAYNOR_BOOTH.x, DRAYNOR_BOOTH.z);
    if (inLawTemple() || onEntrana() || onShip()) return false;
    await stripGear();
    if (!(await openDraynorBooth())) return false;
    for (let pass = 0; pass < 20; pass++) {
        const junk = sdk.getInventory().find((i) => {
            if ((i.count ?? 0) <= 0) return false;
            if (TALISMAN.test(i.name)) return false;
            if (ESSENCE.test(i.name) && (i.count ?? 0) === 1) return false;
            return true;
        });
        if (!junk) break;
        await bot.depositItem(junk, -1);
    }
    if (count(TALISMAN) < 1) {
        const withdrawn = await bot.withdrawItem(TALISMAN, 1);
        await until(() => count(TALISMAN) >= 1, 12_000);
        if (count(TALISMAN) < 1) session.log('warn', `law talisman withdraw: ${withdrawn.message}`);
    }
    const noted = sdk.getInventory().find((i) => ESSENCE.test(i.name) && (i.count ?? 0) > 1);
    if (noted) await bot.depositItem(noted, -1);
    if (unnotedEssence() < 1 && count(TALISMAN) >= 1) {
        const withdrawn = await bot.withdrawItem(ESSENCE, -1);
        await until(() => unnotedEssence() >= 1, 15_000);
        if (unnotedEssence() < 1) session.log('warn', `rune essence withdraw: ${withdrawn.message}`);
    }
    await bot.closeBank();
    log(
        `Draynor pack talisman=${count(TALISMAN)} essence=${unnotedEssence()} laws=${count(LAW)} rc=${rcLevel()} @ ${here()}`
    );
    return true;
}

async function openMonkChoice(): Promise<boolean> {
    await closeUi();
    if (distTo(PORT_SARIM_MONK.x, PORT_SARIM_MONK.z) > 6) await hopTo(DRAYNOR_TO_SARIM, PORT_SARIM_MONK);
    const npc = sdk.findNearbyNpc(/monk of entrana/i);
    if (!npc) {
        session.log('warn', `Monk missing @ ${here()}`);
        return false;
    }
    const talk = await bot.talkTo(npc);
    if (!talk.success) session.log('warn', `talk monk: ${talk.message}`);
    for (let i = 0; i < 14; i++) {
        if (monkChoiceOpen()) return true;
        const d = sdk.getDialog();
        if (d?.isOpen) {
            const cont = (d.options ?? []).find((o) => /click here to continue/i.test(o.text));
            await clickAndAwaitPage(cont?.index ?? 0);
        } else {
            await sdk.waitForTicks(1);
        }
    }
    return monkChoiceOpen();
}

async function crossGangplank(): Promise<void> {
    if (pos().level === 0 && !onShip()) return;
    await sdk.scanNearbyLocs(10).catch(() => {});
    const plank = sdk.findNearbyLoc(/gangplank/i);
    if (!plank) {
        session.log('warn', `No gangplank @ ${here()} level=${pos().level}`);
        return;
    }
    log(`Crossing gangplank @ ${plank.x},${plank.z}`);
    await bot.interactLoc(plank, /cross/i);
    await until(() => pos().level === 0, 8_000);
}

/** Lost City `sailEntrana`, without the quest axe/knife pack. */
async function sailEntrana(): Promise<void> {
    if (onEntrana() || onShip()) return;
    await session.setPhase('sail_entrana');
    await stripGear();
    const banned = bannedName();
    if (banned) {
        session.log('warn', `Still holding ${banned} — Entrana will refuse`);
        return;
    }
    if (distTo(PORT_SARIM_MONK.x, PORT_SARIM_MONK.z) > 30) await hopTo(DRAYNOR_TO_SARIM, PORT_SARIM_MONK);
    const before = { x: pos().x, z: pos().z };
    if (!monkChoiceOpen() && !(await openMonkChoice())) {
        session.log('warn', `Monk choice never opened @ ${here()}`);
        return;
    }
    const yes = (sdk.getDialog()?.options ?? []).find((o) => /ready to go/i.test(o.text));
    if (!yes) {
        session.log('warn', `No "ready to go" [${(sdk.getDialog()?.options ?? []).map((o) => o.text).join(' | ')}]`);
        return;
    }
    log(`Monk -> ${yes.text}`);
    await clickAndAwaitPage(yes.index);
    for (let i = 0; i < 30; i++) {
        if (distTo(before.x, before.z) > 40 || onEntrana() || onShip()) break;
        const d = sdk.getDialog();
        const opts = d?.options ?? [];
        const text = [d?.text ?? '', ...(d?.allComponents ?? []).map((c) => c.text ?? '')].join(' ');
        if (/no weapons or armour/i.test(text)) {
            session.log('warn', `Monk refused banned gear @ ${here()}`);
            return;
        }
        if (d?.isOpen && opts.length <= 1) await clickAndAwaitPage(opts[0]?.index ?? 0);
        else await sdk.waitForTicks(1);
    }
    await until(() => distTo(before.x, before.z) > 40 || onEntrana() || onShip(), 20_000);
    if (onShip() || pos().level >= 1) await crossGangplank();
    log(`After sail @ ${here()} level=${pos().level} entrana=${onEntrana()}`);
}

/** Lost City `sailBackToSarim`. */
async function sailBackToSarim(): Promise<void> {
    if (!onEntrana() && !onShip()) return;
    await session.setPhase('sail_sarim');
    if (distTo(ENTRANA_DOCK.x, ENTRANA_DOCK.z) > 6) {
        await hopTo([LAW_EXIT, { x: 2846, z: 3352 }, ENTRANA_DOCK], ENTRANA_DOCK);
    }
    const npc = sdk.findNearbyNpc(/monk of entrana/i);
    if (!npc) {
        session.log('warn', `Return monk missing @ ${here()}`);
        return;
    }
    const talk = await bot.talkTo(npc);
    if (!talk.success) session.log('warn', `talk return monk: ${talk.message}`);
    for (let i = 0; i < 16; i++) {
        if (!onEntrana() && distTo(PORT_SARIM_MONK.x, PORT_SARIM_MONK.z) < 40) break;
        const d = sdk.getDialog();
        const opts = d?.options ?? [];
        const yes = opts.find((o) => /yes,? i'?m ready to go/i.test(o.text));
        if (yes) {
            log(`Return monk -> ${yes.text}`);
            await clickAndAwaitPage(yes.index);
            continue;
        }
        if (d?.isOpen && opts.length <= 1) await clickAndAwaitPage(opts[0]?.index ?? 0);
        else await sdk.waitForTicks(1);
    }
    await until(() => !onEntrana() || distTo(PORT_SARIM_MONK.x, PORT_SARIM_MONK.z) < 40, 25_000);
    if (onShip() || pos().level >= 1) await crossGangplank();
    log(`Back from Entrana @ ${here()} entrana=${onEntrana()}`);
}

async function enterRuins(): Promise<void> {
    await session.setPhase('law_ruins');
    if (distTo(LAW_RUINS.x, LAW_RUINS.z) > 4) await hopTo(DOCK_TO_RUINS, LAW_RUINS);
    await sdk.scanNearbyLocs(8).catch(() => {});
    const ruins = (sdk.getNearbyLocs() ?? [])
        .filter((l) => /mysterious ruins/i.test(l.name))
        .sort((a, b) => (a.distance ?? 99) - (b.distance ?? 99))[0];
    const tali = sdk.findInventoryItem(TALISMAN);
    if (!ruins || !tali) {
        session.log('warn', `Ruins or talisman missing @ ${here()}`);
        return;
    }
    log(`Using law talisman on ruins @ ${ruins.x},${ruins.z}`);
    const used = await bot.useItemOnLoc(tali, ruins);
    if (!used.success) session.log('warn', `talisman on ruins: ${used.message}`);
    await until(() => inLawTemple(), 10_000);
    if (!inLawTemple()) session.log('warn', `Still outside the law temple @ ${here()}`);
}

async function craftLaws(): Promise<void> {
    if (unnotedEssence() < 1) return;
    if (rcLevel() < LAW_RC) {
        session.log('warn', `Runecraft ${rcLevel()} — law runes need ${LAW_RC}`);
        return;
    }
    await sdk.scanNearbyLocs(12).catch(() => {});
    const altar = (sdk.getNearbyLocs() ?? [])
        .filter((l) => /^altar$/i.test(l.name) && (l.optionsWithIndex ?? []).some((o) => /craft-rune/i.test(o.text)))
        .sort((a, b) => (a.distance ?? 99) - (b.distance ?? 99))[0];
    if (!altar) {
        session.log('warn', `No law altar @ ${here()}`);
        return;
    }
    const before = count(LAW);
    const ess = unnotedEssence();
    log(`Crafting ${ess} essence @ ${altar.x},${altar.z}`);
    await bot.interactLoc(altar, /craft-rune/i);
    const made = await until(() => count(LAW) > before, 12_000);
    if (!made) {
        const msg = sdk.getState()?.gameMessages?.at(-1)?.text ?? '';
        session.log('warn', `Craft produced no law runes @ ${here()} ${msg}`.trim());
        return;
    }
    const gained = count(LAW) - before;
    crafted += gained;
    log(`Crafted law runes ${gained} (session ${crafted})`);
    session.noteProgress('inventory', 'law rune');
}

async function leaveTemple(): Promise<void> {
    if (!inLawTemple()) return;
    await session.setPhase('law_portal');
    await sdk.scanNearbyLocs(12).catch(() => {});
    const portal = (sdk.getNearbyLocs() ?? [])
        .filter((l) => /^portal$/i.test(l.name))
        .sort((a, b) => (a.distance ?? 99) - (b.distance ?? 99))[0];
    if (!portal) {
        session.log('warn', `No law portal @ ${here()}`);
        return;
    }
    await bot.interactLoc(portal, /^use$/i);
    await until(() => !inLawTemple(), 10_000);
    log(`Portal @ ${here()} temple=${inLawTemple()}`);
}

function packReady(): boolean {
    return count(TALISMAN) >= 1 && unnotedEssence() >= 1 && !bannedName() && rcLevel() >= LAW_RC;
}

/**
 * One more productive stage toward a bankable state. A stop during a law
 * run with full essence crafts first — the drain never strands value
 * mid-route, it banks it.
 */
async function drainOneStage(): Promise<void> {
    if (inLawTemple()) {
        await craftLaws();
        await leaveTemple();
    } else if (onEntrana()) {
        if (unnotedEssence() >= 1 && count(TALISMAN) >= 1 && count(LAW) === 0) await enterRuins();
        else await sailBackToSarim();
    } else if (onShip()) {
        await crossGangplank();
    }
    // Anywhere else the drain's own bank() walks to Draynor; nothing to do.
}

try {
    while (!session.isStoppedOrRequested()) {
        if (session.stopRequested) {
            // Interrupt-and-bank: finish the stage, deposit, exit 0 from the bank.
            const outcome = await session.drainToBank(
                () => parkAtBank(sdk, bot, 'draynor', { timeoutMs: 240_000 }),
                { deadlineMs: 600_000, onStage: drainOneStage }
            );
            session.stop('stopped', `drained to bank: ${outcome}`, { restartable: false });
            break;
        }
        if (session.needsRecovery()) {
            if ((await session.recover()) === 'exhausted') break;
            continue;
        }
        if (pos().isDead) {
            session.log('warn', `Died @ ${here()}`);
            await until(() => !pos().isDead, 45_000);
            continue;
        }
        if (inLawTemple()) {
            await craftLaws();
            await leaveTemple();
            continue;
        }
        if (onShip() || (pos().level >= 1 && (onEntrana() || distTo(PORT_SARIM_MONK.x, PORT_SARIM_MONK.z) < 40))) {
            await crossGangplank();
            continue;
        }
        if (onEntrana()) {
            if (unnotedEssence() >= 1 && count(TALISMAN) >= 1 && count(LAW) === 0) await enterRuins();
            else await sailBackToSarim();
            continue;
        }
        if (count(LAW) > 0 || !packReady()) {
            if (!(await bankAtDraynor())) {
                await sdk.waitForTicks(5);
                continue;
            }
        }
        if (rcLevel() < LAW_RC) {
            session.log('warn', `Runecraft ${rcLevel()} — law runes need ${LAW_RC}`);
            await sdk.waitForTicks(20);
            continue;
        }
        if (!packReady()) {
            session.log('warn', `Pack not ready talisman=${count(TALISMAN)} essence=${unnotedEssence()} banned=${bannedName() ?? 'none'} @ ${here()}`);
            await sdk.waitForTicks(10);
            continue;
        }
        await sailEntrana();
    }
} catch (err) {
    session.stop('script_error', err instanceof Error ? err.message : String(err), { restartable: true });
    throw err;
} finally {
    await session.finalizeStop().catch(() => undefined);
    await sdk.disconnect();
}
