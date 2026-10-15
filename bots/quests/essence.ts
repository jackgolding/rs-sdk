/**
 * Mine rune essence via Aubury teleport, then bank at Varrock east.
 * Assumes Rune Mysteries is already complete. Quest walkthrough lives in
 * bots/quests/rune-mysteries.ts and is not this loop.
 *
 * jackthief only: after every 5th banked trip, buy Zaff's battlestaves and
 * staves of fire plus Lowe's adamant arrows. After every 10th, also buy
 * Nurmof's rune pickaxes and Varrock-teleport back.
 *
 *   bun bots/quests/essence.ts {botname}
 *   bun bots/Jackpoo2/essence.ts
 */
import {
    ActivitySession,
    BotSDK,
    deriveGatewayUrl,
    inEssenceMine as inEssenceMineCoords,
    inMiningGuild as inMiningGuildCoords,
    npcHasTeleportOption,
    shopIsNotTeleport,
    Spells
} from '../../sdk/index';
import { BotActions } from '../../sdk/actions';
import { initPathfinding } from '../../sdk/pathfinding';
import { existsSync, readFileSync } from 'fs';
import { dirname, join } from 'path';
import { installGracefulShutdown } from '../../sdk/runner';

const AUBURY = { x: 3253, z: 3401 };
const VARROCK_EAST_BANK = { x: 3253, z: 3420 };
const WIZARD_TOWER = { x: 3109, z: 3162 };
const GUILD_LADDER_DOWN = { x: 3019, z: 9739 };
const TOWER_TO_VARROCK = [
    { x: 3109, z: 3162 },
    { x: 3105, z: 3290 },
    { x: 3080, z: 3420 },
    { x: 3180, z: 3430 },
    { x: 3253, z: 3401 }
];

/** jackthief supply cadence, counted on banked essence trips. */
const SUPPLY_EVERY = 5;
const PICK_EVERY = 10;
const SUPPLY_COINS = 200_000;
const ZAFF = { x: 3203, z: 3433 };
const LOWE = { x: 3232, z: 3423 };
const NURMOF = { x: 2998, z: 9844 };
const DWARF_STAIRS_DOWN = { x: 3059, z: 3376 };
const DWARF_STAIRS_UP = { x: 3058, z: 9776 };
const DWARF_DOOR = { x: 3063, z: 3380 };
const TO_DWARF_STAIRS = [
    { x: 3180, z: 3430 },
    { x: 3082, z: 3420 },
    { x: 3059, z: 3376 }
];
const FROM_DWARF_TO_VARROCK = [
    { x: 3082, z: 3420 },
    { x: 3180, z: 3430 },
    { x: 3253, z: 3420 }
];
const BATTLESTAFF = /^battlestaff$/i;
const FIRE_STAFF = /^staff of fire$/i;
const ADDY_ARROW = /^adamant arrow$/i;
const RUNE_PICK = /^rune pickaxe$/i;
const LAW_RUNE = /^law rune$/i;
const AIR_RUNE = /^air rune$/i;
const FIRE_RUNE = /^fire rune$/i;
const COINS = /^coins$/i;
const SHOP_LOOT = /^(battlestaff|staff of fire|adamant arrow|law rune|air rune|fire rune|coins)$/i;

const PICKAXE = /^(bronze|iron|steel|mithril|adamant|rune) pickaxe$/i;
const ESSENCE = /^(rune essence|pure essence)$/i;
/** Best-first. Mining level is the requirement to use that pick. */
const PICKAXE_TIERS = [
    { pattern: /^rune pickaxe$/i, level: 41, name: 'Rune pickaxe' },
    { pattern: /^adamant pickaxe$/i, level: 31, name: 'Adamant pickaxe' },
    { pattern: /^mithril pickaxe$/i, level: 21, name: 'Mithril pickaxe' },
    { pattern: /^steel pickaxe$/i, level: 6, name: 'Steel pickaxe' },
    { pattern: /^iron pickaxe$/i, level: 1, name: 'Iron pickaxe' },
    { pattern: /^bronze pickaxe$/i, level: 1, name: 'Bronze pickaxe' }
] as const;

/** Cardinal then diagonal steps used when a teleport lands in empty cavern. */
const MINE_WANDER: Array<[number, number]> = [
    [20, 0],
    [0, 20],
    [-20, 0],
    [0, -20],
    [16, 16],
    [-16, 16],
    [16, -16],
    [-16, -16]
];
let wanderDir = 0;

const argv = process.argv.slice(2);
const botArg = argv.find((a) => !a.startsWith('-'));

function loadBotEnv(): void {
    const envPath = botArg
        ? join(process.cwd(), 'bots', botArg, 'bot.env')
        : join(dirname(import.meta.path), 'bot.env');
    if (!existsSync(envPath)) {
        throw new Error(`bot.env not found at ${envPath}. Usage: bun bots/quests/essence.ts {botname}`);
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
    name: 'essence',
    grindLogPath: GRIND_LOG,
    maxRecoveryTactics: 8
});

installGracefulShutdown();

let lastLoggedMine = 0;

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
        isDead: p?.isDead ?? false
    };
}

function distTo(x: number, z: number): number {
    return Math.hypot(pos().x - x, pos().z - z);
}

function mining(): number {
    return sdk.getSkill('Mining')?.baseLevel ?? 1;
}

function miningXp(): number {
    return sdk.getSkill('Mining')?.experience ?? 0;
}

function occupiedSlots(): number {
    return sdk.getInventory().filter((i) => (i.count ?? 0) > 0).length;
}

function count(pattern: RegExp): number {
    return sdk.getInventory().filter((i) => pattern.test(i.name)).reduce((n, i) => n + (i.count ?? 1), 0);
}

function hasPickaxe(): boolean {
    return !!(sdk.findInventoryItem(PICKAXE) || sdk.findEquipmentItem(PICKAXE));
}

function pickaxeRank(name: string): number {
    const i = PICKAXE_TIERS.findIndex((t) => t.pattern.test(name));
    return i < 0 ? -1 : PICKAXE_TIERS.length - i;
}

function heldPickaxes(): Array<{ name: string }> {
    const eq = sdk.findEquipmentItem(PICKAXE);
    return [...sdk.getInventory().filter((i) => PICKAXE.test(i.name)), ...(eq ? [eq] : [])];
}

function bestUsableName(items: Array<{ name: string }>): string | null {
    const lvl = mining();
    let best: { name: string; rank: number } | null = null;
    for (const it of items) {
        const tier = PICKAXE_TIERS.find((t) => t.pattern.test(it.name));
        if (!tier || lvl < tier.level) continue;
        const rank = pickaxeRank(it.name);
        if (!best || rank > best.rank) best = { name: it.name, rank };
    }
    return best?.name ?? null;
}

function bagFull(): boolean {
    return occupiedSlots() >= 28;
}

/** Full bag, or one free slot left while already outside the mine (dump coal/junk first). */
function shouldBank(): boolean {
    return bagFull() || (occupiedSlots() >= 27 && !inEssenceMine());
}

function inEssenceMine(): boolean {
    if (sdk.findNearbyLoc(/rune essence/i, { withOption: /mine/i })) return true;
    const p = pos();
    return inEssenceMineCoords(p.x, p.z);
}

function inWizardBasement(): boolean {
    const p = pos();
    return p.x >= 3088 && p.x <= 3124 && p.z >= 9520 && p.z <= 9610;
}

function inGuild(): boolean {
    return inMiningGuildCoords(pos().x, pos().z);
}

function findPortal() {
    return sdk.findNearbyLoc(/^portal$/i) ?? sdk.findNearbyLoc(/portal/i);
}

async function closeUi(): Promise<void> {
    const dialog = sdk.getDialog();
    if (dialog?.isOpen) {
        const decline = dialog.options?.find((o) => /no thank you|i'?m not interested|never mind/i.test(o.text));
        if (decline) {
            await sdk.sendClickDialog(decline.index);
            await sdk.waitForTicks(1);
        }
    }
    if (sdk.getState()?.shop?.isOpen || sdk.getState()?.bank?.isOpen || sdk.getState()?.interface?.isOpen) {
        await bot.closeInterface();
    }
    await bot.dismissBlockingUI();
}

async function chat(choices: RegExp[] = [], max = 40): Promise<string[]> {
    const seen: string[] = [];
    let closed = 0;
    for (let i = 0; i < max; i++) {
        const dialog = sdk.getDialog();
        if (!dialog?.isOpen) {
            closed++;
            if (closed > 2) break;
            await sdk.waitForTicks(1);
            continue;
        }
        closed = 0;
        const text = dialog.text ?? '';
        if (text) seen.push(text);
        const opts = dialog.options ?? [];
        const cont = opts.find((o) => /continue|click here/i.test(o.text));
        if (cont) {
            await sdk.sendClickDialog(cont.index);
            await sdk.waitForTicks(1);
            continue;
        }
        let picked = false;
        for (const c of choices) {
            const match = opts.find((o) => c.test(o.text));
            if (match) {
                await sdk.sendClickDialog(match.index);
                picked = true;
                break;
            }
        }
        if (!picked) break;
        await sdk.waitForTicks(1);
    }
    return seen;
}

async function walkNear(x: number, z: number, tolerance = 4): Promise<boolean> {
    if (distTo(x, z) <= tolerance) return true;
    const result = await bot.walkTo(x, z, Math.min(tolerance, 3));
    return result.success || distTo(x, z) <= tolerance + 2;
}

async function walkWaypoints(points: { x: number; z: number }[]): Promise<void> {
    const dest = points[points.length - 1]!;
    for (const p of points) {
        if (distTo(p.x, p.z) <= 8) continue;
        if (Math.hypot(dest.x - p.x, dest.z - p.z) >= distTo(dest.x, dest.z) - 4) continue;
        await walkNear(p.x, p.z, 6);
    }
    if (distTo(dest.x, dest.z) > 6) await walkNear(dest.x, dest.z, 4);
}

async function openToward(tx: number, tz: number): Promise<void> {
    const door = (sdk.getNearbyLocs() ?? [])
        .filter(
            (l) =>
                /door|gate/i.test(l.name) &&
                l.reachable !== false &&
                l.optionsWithIndex.some((o) => /^open$/i.test(o.text))
        )
        .sort((a, b) => Math.hypot(a.x - tx, a.z - tz) - Math.hypot(b.x - tx, b.z - tz))[0];
    if (door && (door.distance ?? 99) <= 10) await bot.openDoor(door);
}

async function leaveWizardTower(): Promise<void> {
    if (pos().z >= 3172 || pos().x < 3088 || pos().x > 3124 || pos().z > 6400) return;
    intent('Leaving Wizards Tower');
    for (let i = 0; i < 8 && pos().z < 3172; i++) {
        await openToward(3104, 3210);
        const door = (sdk.getNearbyLocs() ?? [])
            .filter((l) => /door/i.test(l.name) && l.optionsWithIndex.some((o) => /^open$/i.test(o.text)))
            .sort((a, b) => (a.distance ?? 99) - (b.distance ?? 99))[0];
        if (door) await bot.openDoor(door);
        if (await walkNear(3104, 3210, 4)) return;
        await sdk.sendWalk(pos().x, pos().z + 2, true);
        await sdk.waitForTicks(2);
    }
}

async function climb(want: 'up' | 'down'): Promise<boolean> {
    const opt = want === 'up' ? /climb-up|climb.up|go-up/i : /climb-down|climb.down|go-down/i;
    const beforeZ = pos().z;
    const beforeLevel = pos().level;
    for (let i = 0; i < 6; i++) {
        const loc = (sdk.getNearbyLocs() ?? [])
            .filter((l) => /stair|ladder/i.test(l.name) && l.optionsWithIndex.some((o) => opt.test(o.text)))
            .sort(
                (a, b) =>
                    (a.reachable === false ? 1 : 0) - (b.reachable === false ? 1 : 0) ||
                    (a.distance ?? 99) - (b.distance ?? 99)
            )[0];
        if (!loc) {
            await sdk.scanNearbyLocs(8).catch(() => {});
            await sdk.waitForTicks(1);
            continue;
        }
        intent(`Climb ${want} ${loc.name} @ ${loc.x},${loc.z}`);
        if ((loc.distance ?? 99) > 2) await walkNear(loc.x, loc.z, 1);
        const match = loc.optionsWithIndex.find((o) => opt.test(o.text));
        if (match && (loc.distance ?? 99) <= 2) {
            await sdk.sendInteractLoc(loc.x, loc.z, loc.id, match.opIndex);
        } else {
            await bot.interactLoc(loc, opt);
        }
        await sdk
            .waitForCondition((s) => {
                const p = s.player;
                if (!p) return false;
                return p.level !== beforeLevel || Math.abs((p.worldZ ?? 0) - beforeZ) > 8;
            }, 8_000)
            .catch(() => {});
        await closeUi();
        if (pos().level !== beforeLevel || Math.abs(pos().z - beforeZ) > 8) return true;
    }
    return false;
}

async function leaveGuild(): Promise<boolean> {
    if (!inGuild()) return true;
    intent('Climbing out of Mining Guild');
    if (distTo(GUILD_LADDER_DOWN.x, GUILD_LADDER_DOWN.z) > 6) {
        await walkNear(GUILD_LADDER_DOWN.x, GUILD_LADDER_DOWN.z, 2);
    }
    const ok = await climb('up');
    if (ok || !inGuild()) {
        session.noteProgress('location', 'left guild');
        return true;
    }
    session.noteFailure('climb', 'Still in Mining Guild');
    return false;
}

async function goToAubury(): Promise<boolean> {
    await closeUi();
    if (sdk.findNearbyNpc(/aubury/i)) return true;
    if (inEssenceMine()) {
        await exitEssencePortal();
        return false;
    }
    if (inGuild() && !(await leaveGuild())) return false;
    if (inWizardBasement()) {
        await climb('up');
        return false;
    }
    if (pos().level > 0) await climb('down');
    await leaveWizardTower();
    intent('Walking to Aubury in Varrock');
    if (distTo(AUBURY.x, AUBURY.z) > 20) {
        if (pos().x < 3150 && pos().z < 3300) await walkWaypoints(TOWER_TO_VARROCK);
        else await walkNear(AUBURY.x, AUBURY.z, 3);
    }
    await openToward(AUBURY.x, AUBURY.z);
    await walkNear(AUBURY.x, AUBURY.z, 2);
    return !!sdk.findNearbyNpc(/aubury/i);
}

async function wanderMine(steps = 1): Promise<void> {
    if (!inEssenceMine()) return;
    for (let i = 0; i < steps; i++) {
        const p = pos();
        const [dx, dz] = MINE_WANDER[wanderDir % MINE_WANDER.length]!;
        wanderDir++;
        const dest = clampEssenceMine(p.x + dx, p.z + dz);
        intent(`Walking around mine toward ${dest.x},${dest.z}`);
        await walkNear(dest.x, dest.z, 3);
        await sdk.scanNearbyLocs(15).catch(() => {});
    }
}

async function exitEssencePortal(): Promise<boolean> {
    if (!inEssenceMine()) return true;
    for (let attempt = 0; attempt < 8; attempt++) {
        let portal = findPortal();
        if (!portal) {
            await sdk.scanNearbyLocs(15).catch(() => {});
            portal = findPortal();
        }
        if (!portal) {
            session.noteFailure('portal', `No portal in view @ ${pos().x},${pos().z}`);
            await wanderMine(1);
            continue;
        }
        intent('Stepping through the essence portal');
        await bot.interactLoc(portal, /use|enter|climb/i);
        await sdk
            .waitForCondition((s) => {
                const z = s.player?.worldZ ?? 0;
                const x = s.player?.worldX ?? 0;
                return !inEssenceMineCoords(x, z);
            }, 10_000)
            .catch(() => {});
        if (!inEssenceMine()) return true;
    }
    return !inEssenceMine();
}

async function teleportToEssence(): Promise<boolean> {
    if (inEssenceMine()) return true;
    if (shouldBank()) return false;
    if (shopIsNotTeleport(sdk.getState()?.shop?.isOpen === true)) {
        await bot.closeShop();
        await closeUi();
    }
    let teleporter =
        sdk.findNearbyNpc(/aubury/i) ??
        sdk.findNearbyNpc(/sedridor/i) ??
        sdk.findNearbyNpc(/cromperty/i);
    if (!teleporter) {
        if (!(await goToAubury())) return false;
        teleporter =
            sdk.findNearbyNpc(/aubury/i) ??
            sdk.findNearbyNpc(/sedridor/i) ??
            sdk.findNearbyNpc(/cromperty/i);
    }
    if (!teleporter) return false;
    const beforeTick = sdk.getState()?.tick ?? 0;
    if (npcHasTeleportOption(teleporter.optionsWithIndex)) {
        intent(`Teleport via ${teleporter.name}`);
        const r = await bot.interactNpc(teleporter, /teleport/i);
        if (!r.success) session.noteFailure('teleport', r.message);
    } else {
        await bot.talkTo(teleporter);
        await chat([/can you teleport me to the rune essence/i]);
    }
    await sdk.waitForCondition(() => inEssenceMine(), 12_000).catch(() => {});
    const refused = (sdk.getState()?.gameMessages ?? []).some(
        (m) => m.tick > beforeTick && /need to have completed the rune mysteries/i.test(m.text)
    );
    if (refused) {
        session.stop('quest_incomplete', 'Teleport refused — Rune Mysteries is not finished');
        return false;
    }
    if (inEssenceMine()) {
        session.noteProgress('location', 'essence mine');
        return true;
    }
    session.noteFailure('teleport', 'Nothing happened');
    return false;
}

function findEssenceRock() {
    const match = (l: { name: string; optionsWithIndex: { text: string }[]; distance?: number }) =>
        /rune essence/i.test(l.name) && l.optionsWithIndex.some((o) => /^mine$/i.test(o.text));
    return (
        (sdk.getNearbyLocs() ?? []).filter(match).sort((a, b) => (a.distance ?? 99) - (b.distance ?? 99))[0] ??
        sdk.findNearbyLoc(/rune essence/i, { withOption: /mine/i }) ??
        null
    );
}

function clampEssenceMine(x: number, z: number): { x: number; z: number } {
    return {
        x: Math.min(3032, Math.max(2868, x)),
        z: Math.min(4932, Math.max(4768, z))
    };
}

/** Walk around the cavern until a mineable rock is in view. */
async function wanderMineForRock(steps = 1): Promise<boolean> {
    if (!inEssenceMine()) return false;
    for (let i = 0; i < steps; i++) {
        const rock = findEssenceRock();
        if (rock) {
            session.setAnchor(rock.x, rock.z);
            if ((rock.distance ?? 99) > 1) await bot.walkTo(rock.x, rock.z, 1);
            return true;
        }
        await wanderMine(1);
    }
    const found = findEssenceRock();
    if (found) session.setAnchor(found.x, found.z);
    return !!found;
}

async function mineEssence(): Promise<boolean> {
    const before = count(ESSENCE);
    const xpBefore = miningXp();
    if (bagFull()) return false;
    let rock = findEssenceRock();
    if (!rock) {
        await sdk.scanNearbyLocs(15).catch(() => {});
        rock = findEssenceRock();
    }
    if (!rock) {
        session.noteFailure('mine', `No essence rock nearby @ ${pos().x},${pos().z}`);
        await wanderMineForRock(1);
        return false;
    }
    intent(`Mine ${rock.name} @ ${rock.x},${rock.z}`);
    const r = await bot.interactLoc(rock, /mine/i);
    await sdk
        .waitForCondition(
            (s) =>
                s.inventory.filter((i) => ESSENCE.test(i.name)).reduce((n, i) => n + (i.count ?? 1), 0) > before ||
                s.inventory.filter((i) => (i.count ?? 0) > 0).length >= 28 ||
                (s.skills.find((sk) => sk.name === 'Mining')?.experience ?? 0) > xpBefore,
            18_000
        )
        .catch(() => {});
    await closeUi();
    if (count(ESSENCE) > before || miningXp() > xpBefore) {
        session.noteProgress('xp', 'mine');
        return true;
    }
    if (!r.success) session.noteFailure('mine', r.message);
    await sdk.waitForTicks(2);
    return count(ESSENCE) > before;
}

async function bankEssence(): Promise<boolean> {
    if (inEssenceMine()) {
        if (session.metrics().phase !== 'portal') await session.setPhase('portal');
        session.setAnchor(pos().x, pos().z);
        const left = await exitEssencePortal();
        if (!left) {
            session.noteFailure('portal', 'Could not leave essence mine');
            return false;
        }
        session.noteProgress('location', 'left mine');
    }
    if (inGuild() && !(await leaveGuild())) return false;
    if (inWizardBasement()) {
        await climb('up');
        return false;
    }
    if (pos().level > 0) await climb('down');
    await leaveWizardTower();
    if (session.metrics().phase !== 'deposit') await session.setPhase('deposit');
    session.setAnchor(VARROCK_EAST_BANK.x, VARROCK_EAST_BANK.z);
    intent('Banking rune essence at Varrock east');
    if (distTo(VARROCK_EAST_BANK.x, VARROCK_EAST_BANK.z) > 20) {
        if (pos().x < 3150 && pos().z < 3300) await walkWaypoints(TOWER_TO_VARROCK);
    }
    await openToward(VARROCK_EAST_BANK.x, VARROCK_EAST_BANK.z);
    if (distTo(VARROCK_EAST_BANK.x, VARROCK_EAST_BANK.z) > 2) {
        await walkNear(VARROCK_EAST_BANK.x, VARROCK_EAST_BANK.z, 2);
    }
    await openToward(VARROCK_EAST_BANK.x, VARROCK_EAST_BANK.z);
    if (!(sdk.getState()?.bank?.isOpen || (await bot.openBank()).success)) {
        session.noteFailure('bank_open', 'Varrock east bank open failed');
        return false;
    }
    const before = count(ESSENCE);
    const essence = sdk.findInventoryItem(ESSENCE);
    if (essence && (essence.count ?? 0) > 0) session.recordGain(essence.name, essence.count);
    if (before > 0) await bot.depositItem(ESSENCE, -1);
    for (;;) {
        const junk = sdk.getInventory().find((i) => (i.count ?? 0) > 0 && !PICKAXE.test(i.name));
        if (!junk) break;
        const r = await bot.depositItem(junk, -1);
        if (!r.success) break;
    }
    const deposited = before - count(ESSENCE);
    await ensureBestPickaxeInOpenBank();
    session.captureBankStock();
    await bot.closeBank();
    if (deposited > 0) {
        session.recordTrip(deposited);
        session.noteProgress('bank', 'varrock east');
        log(`Mining ${mining()} (${miningXp()} xp)`);
        return true;
    }
    if (!bagFull()) {
        session.noteProgress('bank', 'varrock east');
        return true;
    }
    session.noteFailure('bank_deposit', 'Inventory still full after bank');
    return false;
}

async function ensureBestPickaxeInOpenBank(): Promise<void> {
    const bankPicks = (sdk.getBankItems() ?? []).filter((i) => PICKAXE.test(i.name));
    const bestName = bestUsableName([...heldPickaxes(), ...bankPicks]);
    if (!bestName) return;
    const exact = new RegExp(`^${bestName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i');
    if (!sdk.findInventoryItem(exact) && !sdk.findEquipmentItem(exact)) {
        const bank = sdk.findBankItem(exact);
        if (bank) await bot.withdrawItem(bank, 1);
    }
    await equipBestPickaxe();
    for (;;) {
        const worse = sdk.getInventory().find((i) => {
            const rank = pickaxeRank(i.name);
            return rank >= 0 && rank < pickaxeRank(bestName);
        });
        if (!worse) break;
        const r = await bot.depositItem(worse, -1);
        if (!r.success) break;
    }
}

async function withdrawPickaxe(): Promise<boolean> {
    session.setAnchor(VARROCK_EAST_BANK.x, VARROCK_EAST_BANK.z);
    await openToward(VARROCK_EAST_BANK.x, VARROCK_EAST_BANK.z);
    if (distTo(VARROCK_EAST_BANK.x, VARROCK_EAST_BANK.z) > 2) {
        await walkNear(VARROCK_EAST_BANK.x, VARROCK_EAST_BANK.z, 2);
    }
    if (!(sdk.getState()?.bank?.isOpen || (await bot.openBank()).success)) return false;
    await ensureBestPickaxeInOpenBank();
    await bot.closeBank();
    return hasPickaxe();
}

async function equipBestPickaxe(): Promise<void> {
    const bestName = bestUsableName(heldPickaxes());
    if (!bestName) return;
    const exact = new RegExp(`^${bestName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i');
    const equipped = sdk.findEquipmentItem(PICKAXE);
    if (equipped && exact.test(equipped.name)) return;
    const inv = sdk.findInventoryItem(exact);
    if (inv) await bot.equipItem(inv);
}

function jackthiefSupplies(): boolean {
    return username.toLowerCase() === 'jackthief';
}

function inDwarvenMine(): boolean {
    const p = pos();
    if (p.z < 9600 || p.z > 9920 || p.x < 2930 || p.x > 3072) return false;
    // South guild ladder room uses the existing leave-guild climb. The dwarf
    // stairs land on the guild's north edge (about 3058, 9776).
    if (p.x >= 3014 && p.x <= 3058 && p.z <= 9755) return false;
    return true;
}

function extraPickaxes(): number {
    const inv = sdk.getInventory().filter((i) => PICKAXE.test(i.name)).reduce((n, i) => n + (i.count ?? 1), 0);
    const equipped = sdk.findEquipmentItem(PICKAXE) ? 1 : 0;
    return Math.max(0, inv + equipped - 1);
}

function hasShopLoot(): boolean {
    return extraPickaxes() > 0 || sdk.getInventory().some((i) => (i.count ?? 0) > 0 && SHOP_LOOT.test(i.name));
}

async function openVarrockEastBank(): Promise<boolean> {
    await closeUi();
    if (inDwarvenMine() || inEssenceMine() || inGuild()) return false;
    await openToward(VARROCK_EAST_BANK.x, VARROCK_EAST_BANK.z);
    if (distTo(VARROCK_EAST_BANK.x, VARROCK_EAST_BANK.z) > 2) {
        await walkNear(VARROCK_EAST_BANK.x, VARROCK_EAST_BANK.z, 2);
    }
    await openToward(VARROCK_EAST_BANK.x, VARROCK_EAST_BANK.z);
    if (sdk.getState()?.bank?.isOpen) return true;
    const opened = await bot.openBank();
    if (!opened.success && !sdk.getState()?.bank?.isOpen) {
        session.noteFailure('bank_open', opened.message);
        return false;
    }
    return true;
}

/** Tops the inventory up to `amount`. Bank must already be open. */
async function withdrawUpTo(pattern: RegExp, amount: number): Promise<number> {
    const have = count(pattern);
    if (have >= amount) return have;
    const bank = sdk.findBankItem(pattern);
    if (!bank || (bank.count ?? 0) < 1) return have;
    await bot.withdrawItem(bank, Math.min(amount - have, bank.count));
    return count(pattern);
}

async function depositShopLoot(): Promise<boolean> {
    if (!hasShopLoot()) return true;
    intent('Depositing shop loot at Varrock east');
    if (!(await openVarrockEastBank())) return false;
    for (;;) {
        const junk = sdk.getInventory().find((i) => (i.count ?? 0) > 0 && !PICKAXE.test(i.name));
        if (!junk) break;
        const r = await bot.depositItem(junk, -1);
        if (!r.success) break;
    }
    await ensureBestPickaxeInOpenBank();
    await depositExtraPickaxes();
    session.captureBankStock();
    await bot.closeBank();
    session.noteProgress('bank', 'shop loot');
    return !hasShopLoot();
}

/** Bank keeps one usable pickaxe. Bought duplicates go in the bank. */
async function depositExtraPickaxes(): Promise<void> {
    await equipBestPickaxe();
    const equipped = !!sdk.findEquipmentItem(PICKAXE);
    for (let i = 0; i < 28; i++) {
        const picks = sdk.getInventory().filter((item) => PICKAXE.test(item.name) && (item.count ?? 0) > 0);
        const held = picks.reduce((n, item) => n + (item.count ?? 1), 0);
        if (held <= (equipped ? 0 : 1)) return;
        const extra = picks[0];
        if (!extra) return;
        const deposited = await bot.depositItem(extra, 1);
        if (!deposited.success) return;
    }
}

/** Buy the live shelf. Stops when the line is empty, coins run out, or the bag is full. */
async function buyShelf(pattern: RegExp, label: string): Promise<number> {
    let bought = 0;
    for (let i = 0; i < 40; i++) {
        const line = sdk.getState()?.shop?.shopItems?.find((it) => pattern.test(it.name));
        const stock = line?.count ?? 0;
        if (!line) {
            if (bought === 0) log(`${label}: not sold here`);
            break;
        }
        if (stock <= 0) {
            if (bought === 0) log(`${label}: none in stock`);
            break;
        }
        const stacks = !!sdk.findInventoryItem(pattern);
        if (28 - occupiedSlots() <= 0 && !stacks) {
            log(`${label}: inventory full, ${stock} still in the shop`);
            break;
        }
        const before = count(pattern);
        const result = await bot.buyFromShop(line, Math.min(stock, 1000));
        const got = Math.max(0, count(pattern) - before);
        bought += got;
        if (got <= 0) {
            log(`${label} buy stopped: ${result.message ?? 'no change'}`);
            break;
        }
        log(`Bought ${got} ${label} | ${count(COINS)} gp left`);
    }
    if (bought > 0) session.noteProgress('shop', label);
    return bought;
}

async function openNamedShop(npc: RegExp, x: number, z: number, label: string): Promise<boolean> {
    await closeUi();
    await openToward(x, z);
    if (distTo(x, z) > 4 || !sdk.findNearbyNpc(npc)) await walkNear(x, z, 3);
    await openToward(x, z);
    const opened = await bot.openShop(npc);
    if (!opened.success && !sdk.getState()?.shop?.isOpen) {
        session.noteFailure('shop', `${label}: ${opened.message}`);
        return false;
    }
    return true;
}

/** Every 5th trip: 200k, Zaff battlestaves + fire staves, Lowe adamant arrows, bank. */
async function buyVarrockSupplies(): Promise<void> {
    await session.setPhase('varrock-shops');
    intent('Withdrawing 200k for Zaff and Lowe');
    if (!(await openVarrockEastBank())) return;
    const gp = await withdrawUpTo(COINS, SUPPLY_COINS);
    await bot.closeBank();
    log(`Shop coins ${gp}`);
    if (gp < 1) {
        session.noteFailure('shop', 'No coins for Zaff and Lowe');
        return;
    }

    intent("Buying battlestaves and fire staves from Zaff");
    if (await openNamedShop(/zaff/i, ZAFF.x, ZAFF.z, 'Zaff')) {
        await buyShelf(BATTLESTAFF, 'battlestaff');
        await buyShelf(FIRE_STAFF, 'staff of fire');
        await bot.closeShop();
    }

    intent("Buying adamant arrows from Lowe");
    if (await openNamedShop(/lowe/i, LOWE.x, LOWE.z, 'Lowe')) {
        await buyShelf(ADDY_ARROW, 'adamant arrow');
        await bot.closeShop();
    }

    await depositShopLoot();
}

async function climbDwarf(want: 'down' | 'up'): Promise<boolean> {
    const opt = want === 'down' ? /climb-down/i : /climb-up/i;
    for (let i = 0; i < 8; i++) {
        if (want === 'down' ? inDwarvenMine() : !inDwarvenMine()) return true;
        if (want === 'down' && distTo(DWARF_STAIRS_DOWN.x, DWARF_STAIRS_DOWN.z) <= 2) {
            await walkNear(DWARF_DOOR.x, DWARF_DOOR.z, 1);
        }
        await sdk.scanNearbyLocs(8).catch(() => {});
        const loc = (sdk.getNearbyLocs() ?? [])
            .filter(
                (l) =>
                    /stair/i.test(l.name) &&
                    l.optionsWithIndex.some((o) => opt.test(o.text)) &&
                    l.reachable !== false
            )
            .sort((a, b) => (a.distance ?? 99) - (b.distance ?? 99))[0];
        if (!loc) {
            const stand = want === 'down' ? DWARF_DOOR : DWARF_STAIRS_UP;
            await walkNear(stand.x, stand.z, 2);
            continue;
        }
        intent(`Climb ${want} ${loc.name} @ ${loc.x},${loc.z}`);
        if ((loc.distance ?? 99) > 2) await walkNear(loc.x, loc.z, 1);
        const beforeZ = pos().z;
        await bot.interactLoc(loc, opt);
        await sdk.waitForCondition(() => Math.abs(pos().z - beforeZ) > 8, 8_000).catch(() => {});
    }
    return want === 'down' ? inDwarvenMine() : !inDwarvenMine();
}

async function castVarrockTeleport(): Promise<boolean> {
    const magic = sdk.getSkill('Magic')?.baseLevel ?? 1;
    if (magic < 25 || count(LAW_RUNE) < 1 || count(AIR_RUNE) < 3 || count(FIRE_RUNE) < 1) {
        log(
            `WARN Varrock teleport unavailable magic=${magic} law=${count(LAW_RUNE)} ` +
                `air=${count(AIR_RUNE)} fire=${count(FIRE_RUNE)}`
        );
        return false;
    }
    await closeUi();
    const before = pos();
    intent('Casting Varrock teleport');
    await sdk.sendSetTab(6);
    await sdk.waitForTicks(1);
    await sdk.sendClickComponent(Spells.VARROCK_TELEPORT);
    await sdk
        .waitForCondition(() => {
            const p = sdk.getState()?.player;
            return Math.hypot((p?.worldX ?? 0) - before.x, (p?.worldZ ?? 0) - before.z) > 40;
        }, 8_000)
        .catch(() => {});
    const moved = distTo(before.x, before.z) > 40;
    if (moved) {
        session.noteProgress('location', 'varrock teleport');
        log(`Varrock teleport landed @ ${pos().x},${pos().z}`);
    }
    return moved;
}

/** Every 10th trip: runes + 200k, buy Nurmof's rune pickaxes, teleport to Varrock. */
async function buyNurmofPicks(): Promise<void> {
    await session.setPhase('nurmof');
    intent('Withdrawing a law, three air, a fire, and 200k');
    if (!(await openVarrockEastBank())) return;
    const law = await withdrawUpTo(LAW_RUNE, 1);
    const air = await withdrawUpTo(AIR_RUNE, 3);
    const fire = await withdrawUpTo(FIRE_RUNE, 1);
    const gp = await withdrawUpTo(COINS, SUPPLY_COINS);
    await bot.closeBank();
    log(`Nurmof kit law=${law} air=${air} fire=${fire} gp=${gp}`);
    if (gp < 1) {
        session.noteFailure('shop', 'No coins for Nurmof');
        await depositShopLoot();
        return;
    }

    intent('Walking to the dwarven mine');
    await walkWaypoints(TO_DWARF_STAIRS);
    if (!(await climbDwarf('down'))) {
        session.noteFailure('nurmof', `Could not enter the dwarven mine @ ${pos().x},${pos().z}`);
        return;
    }
    if (await openNamedShop(/nurmof/i, NURMOF.x, NURMOF.z, 'Nurmof')) {
        await buyShelf(RUNE_PICK, 'rune pickaxe');
        await bot.closeShop();
    }

    if (!(await castVarrockTeleport())) {
        if (inDwarvenMine()) {
            intent('Climbing out of the dwarven mine');
            await walkNear(DWARF_STAIRS_UP.x, DWARF_STAIRS_UP.z, 3);
            await climbDwarf('up');
        }
        intent('Walking back to Varrock');
        await walkWaypoints(FROM_DWARF_TO_VARROCK);
    }
    await depositShopLoot();
}

session.registerRecovery([
    {
        name: 'leave_dwarven_mine',
        run: async () => inDwarvenMine() && (await climbDwarf('up'))
    },
    {
        name: 'close_shop',
        run: async () => {
            if (sdk.getState()?.shop?.isOpen) {
                await bot.closeShop();
            }
            return false;
        }
    },
    {
        name: 'portal_if_full',
        run: async () => {
            if (!inEssenceMine() || !shouldBank()) return false;
            return exitEssencePortal();
        }
    },
    {
        name: 'bank_if_full',
        run: async () => {
            if (!shouldBank()) return false;
            return bankEssence();
        }
    },
    {
        name: 'leave_guild',
        run: async () => inGuild() && (await leaveGuild())
    },
    {
        name: 'teleport_not_trade',
        run: async () => {
            if (inEssenceMine() || shouldBank()) return false;
            if (!sdk.findNearbyNpc(/aubury|sedridor|cromperty/i)) return false;
            return teleportToEssence();
        }
    },
    {
        name: 'wander_mine',
        run: async () => {
            if (!inEssenceMine() || shouldBank()) return false;
            return wanderMineForRock(8);
        }
    },
    {
        name: 'use_portal',
        run: async () => {
            if (!inEssenceMine()) return false;
            return exitEssencePortal();
        }
    },
    {
        name: 'rewalk_varrock_east',
        run: async () => {
            session.setAnchor(VARROCK_EAST_BANK.x, VARROCK_EAST_BANK.z);
            await openToward(VARROCK_EAST_BANK.x, VARROCK_EAST_BANK.z);
            await walkNear(VARROCK_EAST_BANK.x, VARROCK_EAST_BANK.z, 2);
            if (shouldBank()) return bankEssence();
            return sdk.getState()?.bank?.isOpen === true;
        }
    }
]);

try {
    lastLoggedMine = mining();
    await bot.skipTutorial();
    await closeUi();
    log(
        `Essence start Mining ${lastLoggedMine} (${miningXp()} xp) @ ${pos().x},${pos().z} lv${pos().level} ` +
            `pick=${sdk.findEquipmentItem(PICKAXE)?.name ?? sdk.findInventoryItem(PICKAXE)?.name ?? 'none'}`
    );

    while (!session.isStopped()) {
        if (session.needsRecovery()) {
            if ((await session.recover()) === 'exhausted') break;
            continue;
        }
        await closeUi();
        if (pos().isDead) {
            await sdk.waitForCondition((s) => !s.player.isDead, 45_000).catch(() => {});
            continue;
        }
        if (mining() !== lastLoggedMine) {
            log(`LEVEL UP Mining ${mining()}`);
            lastLoggedMine = mining();
        }

        if (shouldBank()) {
            const tripsBefore = session.metrics().trips;
            await bankEssence();
            if (jackthiefSupplies() && session.metrics().trips > tripsBefore && !inEssenceMine()) {
                const trips = session.metrics().trips;
                if (trips % PICK_EVERY === 0) await buyNurmofPicks();
                if (trips % SUPPLY_EVERY === 0 && !inDwarvenMine()) await buyVarrockSupplies();
            }
            continue;
        }

        if (inDwarvenMine()) {
            await walkNear(DWARF_STAIRS_UP.x, DWARF_STAIRS_UP.z, 3);
            await climbDwarf('up');
            continue;
        }

        if (jackthiefSupplies() && hasShopLoot() && !inEssenceMine()) {
            await depositShopLoot();
            continue;
        }

        if (!hasPickaxe()) {
            await withdrawPickaxe();
            if (!hasPickaxe()) {
                session.stop('no_pickaxe', 'No pickaxe in inventory, equipment, or Varrock east bank');
                break;
            }
        }
        await equipBestPickaxe();

        if (!inEssenceMine()) {
            if (inGuild()) {
                await leaveGuild();
                continue;
            }
            if (inWizardBasement()) {
                await climb('up');
                continue;
            }
            if (session.metrics().phase !== 'teleport') await session.setPhase('teleport');
            session.setAnchor(AUBURY.x, AUBURY.z);
            if (!sdk.findNearbyNpc(/aubury/i) && !sdk.findNearbyNpc(/sedridor/i) && !sdk.findNearbyNpc(/cromperty/i)) {
                await goToAubury();
                continue;
            }
            await teleportToEssence();
            continue;
        }

        if (session.metrics().phase !== 'mine') await session.setPhase('mine');
        const rock = findEssenceRock();
        if (rock) session.setAnchor(rock.x, rock.z);
        else session.setAnchor(pos().x, pos().z);
        await mineEssence();
    }

    const stop = session.metrics().stopReason;
    if (stop) log(`stopped ${stop.code} @ ${stop.location.x},${stop.location.z}`);
} catch (err) {
    console.error('Script error:', err);
    throw err;
} finally {
    console.log('Disconnecting SDK; browser client can stay open.');
    await sdk.disconnect();
}
