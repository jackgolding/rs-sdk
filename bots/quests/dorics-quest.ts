/**
 * Doric's Quest — reusable for any bot.
 *
 *   bun bots/quests/dorics-quest.ts {botname}
 *   bun bots/Jackpoo2/dorics.ts
 *
 * Banks everything (inventory left empty except a pickaxe), mines
 * 6 clay + 4 copper ore + 2 iron ore, then starts and hands in at Doric.
 *
 * Copper/iron: SE Varrock mine. Clay: SW Varrock mine by Champions' Guild.
 * The dark-wizard circle sits between those two mines — always route north
 * through Varrock streets, never straight west along z=3368.
 */
import { BotSDK, deriveGatewayUrl, inEssenceMine as inEssenceMineCoords } from '../../sdk/index';
import { BotActions } from '../../sdk/actions';
import { initPathfinding } from '../../sdk/pathfinding';
import { existsSync, readFileSync, appendFileSync } from 'fs';
import { dirname, join } from 'path';
import { readJournalCheckpoint } from '../../quest-lab/journal-reader';
import type { JournalRule } from '../../quest-lab/evidence';

const VARROCK_EAST_BANK = { x: 3253, z: 3420 };
const SE_MINE = { x: 3285, z: 3366 };
const SW_MINE = { x: 3180, z: 3372 };
const DORIC = { x: 2952, z: 3451 };
const AUBURY = { x: 3253, z: 3401 };

const TO_DORIC = [
    { x: 3185, z: 3436 },
    { x: 3080, z: 3420 },
    { x: 3018, z: 3450 },
    { x: 2952, z: 3451 }
];
const SE_TO_SW = [
    { x: 3253, z: 3420 },
    { x: 3185, z: 3436 },
    { x: 3180, z: 3372 }
];
const TOWER_TO_VARROCK = [
    { x: 3109, z: 3162 },
    { x: 3105, z: 3290 },
    { x: 3080, z: 3420 },
    { x: 3180, z: 3430 },
    { x: 3253, z: 3420 }
];

const NEED = { clay: 6, copper: 4, iron: 2 } as const;
const PICKAXE = /^(bronze|iron|steel|mithril|adamant|rune) pickaxe$/i;
const PICKAXE_TIERS = [
    { pattern: /^rune pickaxe$/i, level: 41, name: 'Rune pickaxe' },
    { pattern: /^adamant pickaxe$/i, level: 31, name: 'Adamant pickaxe' },
    { pattern: /^mithril pickaxe$/i, level: 21, name: 'Mithril pickaxe' },
    { pattern: /^steel pickaxe$/i, level: 6, name: 'Steel pickaxe' },
    { pattern: /^iron pickaxe$/i, level: 1, name: 'Iron pickaxe' },
    { pattern: /^bronze pickaxe$/i, level: 1, name: 'Bronze pickaxe' }
] as const;
const CLAY = /^clay$/i;
const COPPER = /^copper ore$/i;
const IRON = /^iron ore$/i;
const ITEM = { clay: CLAY, copper: COPPER, iron: IRON } as const;
const ROCK = {
    clay: /rocks clay ore/i,
    copper: /rocks copper ore/i,
    iron: /rocks iron ore/i
} as const;

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
        throw new Error(`bot.env not found at ${envPath}. Usage: bun bots/quests/dorics-quest.ts {botname}`);
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

function log(msg: string): void {
    console.log(msg);
    try {
        appendFileSync(GRIND_LOG, `${new Date().toISOString()} ${msg}\n`);
    } catch {
        /* ignore */
    }
}

console.log('Warming pathfinder...');
initPathfinding();

const sdk = new BotSDK({
    botUsername: username,
    password,
    gatewayUrl: deriveGatewayUrl(server),
    autoLaunchBrowser: true,
    browserLaunchTimeout: 90_000,
    readyTimeout: 45_000,
    connectTimeout: 60_000,
    showChat: false
});

console.log('Opening/attaching the game client...');
await sdk.connect();
const bot = new BotActions(sdk);

let lastIntent = '';
let questComplete = false;
let bankedForQuest = false;

function intent(msg: string): void {
    if (msg === lastIntent) return;
    lastIntent = msg;
    console.log(`> ${msg}`);
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

function coinCount(): number {
    return sdk.findInventoryItem(/^coins$/i)?.count ?? 0;
}

function hasPickaxe(): boolean {
    return !!(sdk.findInventoryItem(PICKAXE) || sdk.findEquipmentItem(PICKAXE));
}

function oreCount(kind: keyof typeof NEED): number {
    return count(ITEM[kind]);
}

function need(kind: keyof typeof NEED): number {
    return Math.max(0, NEED[kind] - oreCount(kind));
}

function hasAllOres(): boolean {
    return need('clay') === 0 && need('copper') === 0 && need('iron') === 0;
}

function inventoryIsPickaxeOnly(): boolean {
    const items = sdk.getInventory().filter((i) => (i.count ?? 0) > 0);
    if (items.length === 0) return !!sdk.findEquipmentItem(PICKAXE);
    return items.every((i) => PICKAXE.test(i.name)) && items.length <= 1;
}

function wornJunk() {
    return bot.getEquipment().filter((i) => (i.count ?? 0) > 0 && !PICKAXE.test(i.name));
}

function inEssenceMine(): boolean {
    const p = pos();
    return inEssenceMineCoords(p.x, p.z);
}

function inWizardBasement(): boolean {
    const p = pos();
    return p.x >= 3088 && p.x <= 3124 && p.z >= 9520 && p.z <= 9610;
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
            if (closed >= 3) break;
            await sdk.waitForTicks(1);
            continue;
        }
        closed = 0;
        if (dialog.isWaiting) {
            await sdk.waitForTicks(1);
            continue;
        }
        const opts = dialog.options ?? [];
        for (const o of opts) seen.push(o.text);
        if (opts.length <= 1 || opts.every((o) => /click here to continue/i.test(o.text))) {
            await sdk.sendClickDialog(opts[0]?.index ?? 0);
            await sdk.waitForTicks(1);
            continue;
        }
        let picked = false;
        for (const c of choices) {
            const match = opts.find((o) => c.test(o.text));
            if (match) {
                log(`Dialog -> ${match.text}`);
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

function clampEssenceMine(x: number, z: number): { x: number; z: number } {
    return {
        x: Math.min(3032, Math.max(2868, x)),
        z: Math.min(4932, Math.max(4768, z))
    };
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
            log(`No portal in view @ ${pos().x},${pos().z}`);
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

async function leaveEssenceAndTower(): Promise<void> {
    if (inEssenceMine()) {
        const left = await exitEssencePortal();
        if (!left) log(`Still in essence mine @ ${pos().x},${pos().z}`);
    }
    if (inWizardBasement()) await climb('up');
    if (pos().level > 0) await climb('down');
    await leaveWizardTower();
}

function bestBankPick() {
    const miningLevel = mining();
    for (const tier of PICKAXE_TIERS) {
        if (miningLevel < tier.level) continue;
        const item = sdk.findBankItem(tier.pattern);
        if (item) return item;
    }
    return sdk.findBankItem(PICKAXE);
}

async function equipBestPickaxe(): Promise<void> {
    if (sdk.findEquipmentItem(PICKAXE)) return;
    const inv = sdk.findInventoryItem(PICKAXE);
    if (!inv) return;
    const r = await bot.equipItem(inv);
    if (!r.success) log(`Equip ${inv.name}: ${r.message}`);
}

/** Deposit every inventory item and any worn junk. Leave only one usable pickaxe. */
async function bankPickaxeOnly(): Promise<boolean> {
    await closeUi();
    await leaveEssenceAndTower();
    intent('Banking everything at Varrock east — pickaxe only');
    if (distTo(VARROCK_EAST_BANK.x, VARROCK_EAST_BANK.z) > 20) {
        if (pos().x < 3150 && pos().z < 3300) await walkWaypoints(TOWER_TO_VARROCK);
        else if (sdk.findNearbyNpc(/aubury/i) || distTo(AUBURY.x, AUBURY.z) <= 12) {
            await openToward(VARROCK_EAST_BANK.x, VARROCK_EAST_BANK.z);
        }
    }
    await openToward(VARROCK_EAST_BANK.x, VARROCK_EAST_BANK.z);
    if (distTo(VARROCK_EAST_BANK.x, VARROCK_EAST_BANK.z) > 2) {
        await walkNear(VARROCK_EAST_BANK.x, VARROCK_EAST_BANK.z, 2);
    }
    await openToward(VARROCK_EAST_BANK.x, VARROCK_EAST_BANK.z);
    if (!(sdk.getState()?.bank?.isOpen || (await bot.openBank()).success)) {
        log(`Bank open failed @ ${pos().x},${pos().z}`);
        return false;
    }

    for (;;) {
        const item = sdk.getInventory().find((i) => (i.count ?? 0) > 0);
        if (!item) break;
        const r = await bot.depositItem(item, -1);
        if (!r.success) {
            log(`Deposit ${item.name}: ${r.message}`);
            break;
        }
    }

    await bot.closeBank();
    for (const worn of wornJunk()) {
        intent(`Unequipping ${worn.name}`);
        await bot.unequipItem(worn);
    }
    if (wornJunk().length > 0 || occupiedSlots() > 0) {
        if (!(sdk.getState()?.bank?.isOpen || (await bot.openBank()).success)) {
            log('Bank reopen failed after unequip');
            return false;
        }
        for (;;) {
            const item = sdk.getInventory().find((i) => (i.count ?? 0) > 0);
            if (!item) break;
            const r = await bot.depositItem(item, -1);
            if (!r.success) break;
        }
    }

    if (!sdk.getState()?.bank?.isOpen) {
        const opened = await bot.openBank();
        if (!opened.success) {
            log(`Bank open failed before pickaxe withdraw: ${opened.message}`);
            return false;
        }
    }

    if (!hasPickaxe()) {
        const pick = bestBankPick();
        if (!pick) {
            log('No pickaxe in bank or on character');
            await bot.closeBank();
            return false;
        }
        const r = await bot.withdrawItem(pick, 1);
        log(`Withdraw ${pick.name}: ${r.success ? 'ok' : r.message}`);
    }

    await bot.closeBank();
    await equipBestPickaxe();

    if (occupiedSlots() > 1 || !inventoryIsPickaxeOnly()) {
        if (sdk.getState()?.bank?.isOpen || (await bot.openBank()).success) {
            for (const item of [...sdk.getInventory()]) {
                if (PICKAXE.test(item.name) && !sdk.findEquipmentItem(PICKAXE)) continue;
                await bot.depositItem(item, -1);
            }
            if (!hasPickaxe()) {
                const pick = bestBankPick();
                if (pick) await bot.withdrawItem(pick, 1);
            }
            await bot.closeBank();
            await equipBestPickaxe();
        }
    }

    const inv = sdk
        .getInventory()
        .filter((i) => (i.count ?? 0) > 0)
        .map((i) => i.name)
        .join(', ');
    const worn = sdk.findEquipmentItem(PICKAXE)?.name ?? 'none';
    const ok = inventoryIsPickaxeOnly() && hasPickaxe();
    log(`Banked pickaxe-only worn=${worn} inv=${inv || '(empty)'} ok=${ok}`);
    bankedForQuest = ok;
    return ok;
}

function findOreRock(kind: keyof typeof NEED) {
    return (
        (sdk.getNearbyLocs() ?? [])
            .filter(
                (l) =>
                    ROCK[kind].test(l.name) &&
                    l.optionsWithIndex.some((o) => /^mine$/i.test(o.text)) &&
                    l.reachable !== false
            )
            .sort((a, b) => (a.distance ?? 99) - (b.distance ?? 99))[0] ?? null
    );
}

async function goToMine(spot: { x: number; z: number }, label: string): Promise<void> {
    await closeUi();
    if (distTo(spot.x, spot.z) <= 8) return;
    intent(`Walking to ${label} @ ${spot.x},${spot.z}`);
    if (spot === SW_MINE && pos().x > 3230 && pos().z < 3410) {
        await walkWaypoints(SE_TO_SW);
        return;
    }
    await walkNear(spot.x, spot.z, 4);
}

async function mineOne(kind: keyof typeof NEED): Promise<boolean> {
    await closeUi();
    const before = oreCount(kind);
    const xpBefore = miningXp();
    let rock = findOreRock(kind);
    if (!rock) {
        await sdk.scanNearbyLocs(15).catch(() => {});
        rock = findOreRock(kind);
    }
    if (!rock) return false;
    intent(`Mine ${rock.name} @ ${rock.x},${rock.z} (${oreCount(kind)}/${NEED[kind]} ${kind})`);
    const r = await bot.interactLoc(rock, /mine/i);
    await sdk
        .waitForCondition(
            (s) =>
                s.inventory.filter((i) => ITEM[kind].test(i.name)).reduce((n, i) => n + (i.count ?? 1), 0) > before ||
                (s.skills.find((sk) => sk.name === 'Mining')?.experience ?? 0) > xpBefore,
            16_000
        )
        .catch(() => {});
    await closeUi();
    if (oreCount(kind) > before) {
        log(`${kind} ${oreCount(kind)}/${NEED[kind]}`);
        return true;
    }
    if (!r.success) log(`mine ${kind}: ${r.message}`);
    await sdk.waitForTicks(2);
    return oreCount(kind) > before;
}

async function mineUntil(kind: keyof typeof NEED, spot: { x: number; z: number }, label: string): Promise<void> {
    let misses = 0;
    while (need(kind) > 0 && misses < 40) {
        if (distTo(spot.x, spot.z) > 12 && !findOreRock(kind)) await goToMine(spot, label);
        const ok = await mineOne(kind);
        if (ok) misses = 0;
        else {
            misses++;
            await sdk.waitForTicks(3);
            if (misses % 4 === 0) await goToMine(spot, label);
        }
    }
}

async function collectOres(): Promise<void> {
    if (hasAllOres()) return;
    if (need('copper') > 0 || need('iron') > 0) {
        await goToMine(SE_MINE, 'SE Varrock mine');
        if (need('copper') > 0) await mineUntil('copper', SE_MINE, 'SE Varrock mine');
        if (need('iron') > 0) await mineUntil('iron', SE_MINE, 'SE Varrock mine');
    }
    if (need('clay') > 0 || need('iron') > 0) {
        await goToMine(SW_MINE, 'Champions Guild mine');
        if (need('clay') > 0) await mineUntil('clay', SW_MINE, 'Champions Guild mine');
        if (need('iron') > 0) await mineUntil('iron', SW_MINE, 'Champions Guild mine');
    }
}

/**
 * Doric's Quest stage and completion, read from the QUEST JOURNAL
 * (server/content/scripts/quests/quest_doric/scripts/doric_journal.rs2,
 * questlist:doric, %doricquest vs ^doric_complete):
 *   %doricquest=0  -> "I can start this quest by talking to Doric ..."
 *   %doricquest=10 -> "I need to collect some items and bring them to Doric"
 *   else (complete)-> "QUEST COMPLETE!"
 *
 * This used to be `miningXp() - xpBefore >= 1000` / `coinCount() - coinsBefore`
 * plus a chat regex. Mining XP is this quest's REWARD, so any mining done
 * mid-run read as completion, and a restart was indistinguishable from a finish.
 */
const DORIC_JOURNAL = { label: "Doric's Quest", title: "Dorics' Quest" };
const DORIC_STAGES: Record<string, JournalRule> = {
    not_started: {
        id: 'doric:not_started',
        kind: 'unstarted',
        all: ['I can start this quest by talking to Doric']
    },
    started: {
        id: 'doric:started',
        kind: 'active',
        all: ['I need to collect some items and bring them to Doric']
    },
    complete: { id: 'doric:complete', kind: 'complete', all: ['QUEST COMPLETE'] }
};

/** The first stage rule that passes is the account's real stage. */
async function readStage(): Promise<string> {
    for (const name of ['complete', 'started', 'not_started']) {
        const read = await readJournalCheckpoint(sdk, DORIC_JOURNAL, DORIC_STAGES[name]!);
        log(`  stage probe ${name}: ${read.verdict?.verdict ?? 'UNKNOWN'} (${read.reason})`);
        if (read.verdict?.verdict === 'PASS') return name;
    }
    return 'unknown';
}

let journalComplete = false;
let lastJournalCheck = 0;
/** Journal-backed completion, throttled: opening the journal is not free. */
async function questDone(): Promise<boolean> {
    if (Date.now() - lastJournalCheck < 5_000) return journalComplete;
    lastJournalCheck = Date.now();
    const read = await readJournalCheckpoint(sdk, DORIC_JOURNAL, DORIC_STAGES.complete!);
    journalComplete = read.verdict?.verdict === 'PASS';
    return journalComplete;
}

async function goToDoric(): Promise<boolean> {
    await closeUi();
    if (sdk.findNearbyNpc(/^doric$/i)) return true;
    intent(`Walking to Doric @ ${DORIC.x},${DORIC.z}`);
    if (pos().x > 3000) await walkWaypoints(TO_DORIC);
    await openToward(DORIC.x, DORIC.z);
    await walkNear(DORIC.x, DORIC.z, 2);
    await openToward(DORIC.x, DORIC.z);
    if (!sdk.findNearbyNpc(/^doric$/i)) await walkNear(DORIC.x, DORIC.z, 1);
    return !!sdk.findNearbyNpc(/^doric$/i);
}

async function talkDoric(): Promise<boolean> {
    await closeUi();
    if (!(await goToDoric())) {
        log(`Doric not nearby @ ${pos().x},${pos().z}`);
        return false;
    }
    const doric = sdk.findNearbyNpc(/^doric$/i);
    if (!doric) return false;
    const r = await bot.talkTo(doric);
    if (!r.success) {
        log(`talk Doric: ${r.message}`);
        await openToward(DORIC.x, DORIC.z);
        return false;
    }
    await sdk.waitForTicks(1);
    return true;
}

async function startAndHandIn(): Promise<void> {
    for (let attempt = 0; attempt < 4 && !questComplete; attempt++) {
        if (!(await talkDoric())) continue;
        const seen = await chat([
            /i wanted to use your anvils/i,
            /yes, i will get you materials/i
        ]);
        const text = seen.join(' | ');
        log(`Doric: ${text || '(no dialog)'}`);
        if (await questDone()) {
            questComplete = true;
            break;
        }
        if (/sorry, i don't have them all yet|6 clay, 4 copper/i.test(text)) {
            log('Quest in progress but missing ores');
            break;
        }
        await closeUi();
        await sdk.waitForTicks(2);
    }
    await closeUi();
    if (await questDone()) questComplete = true;
    if (questComplete) {
        log(`QUEST COMPLETE Doric's Quest | journal %doricquest=^doric_complete | Mining ${mining()}`);
    }
}

try {
    await bot.skipTutorial();
    await closeUi();
    log(
        `Doric's Quest start Mining ${mining()} (${miningXp()} xp) @ ${pos().x},${pos().z} ` +
            `pick=${sdk.findEquipmentItem(PICKAXE)?.name ?? sdk.findInventoryItem(PICKAXE)?.name ?? 'none'} ` +
            `inv=${occupiedSlots()}`
    );

    // Stage probe BEFORE banking: a finished quest has nothing left to do, and
    // banking first made a completed quest report bank state instead of
    // "already complete".
    const STAGE = await readStage();
    log(`Quest stage at start: ${STAGE}`);
    if (STAGE === 'complete') {
        questComplete = true;
        log("Doric's Quest is already complete — nothing to do");
    }

    while (!questComplete) {
        await closeUi();
        if (pos().isDead) {
            await sdk.waitForCondition((s) => !s.player.isDead, 45_000).catch(() => {});
            continue;
        }

        if (!bankedForQuest) {
            const ores = oreCount('clay') + oreCount('copper') + oreCount('iron');
            if (hasPickaxe() && ores > 0) {
                bankedForQuest = true;
                log(
                    `Resume mid-quest clay=${oreCount('clay')}/${NEED.clay} copper=${oreCount('copper')}/${NEED.copper} iron=${oreCount('iron')}/${NEED.iron}`
                );
            } else {
                const ok = await bankPickaxeOnly();
                if (!ok) {
                    await sdk.waitForTicks(5);
                    continue;
                }
            }
        }

        if (!hasAllOres()) {
            await collectOres();
            continue;
        }

        await startAndHandIn();
        if (!questComplete && !hasAllOres()) continue;
        if (!questComplete) {
            log('Hand-in did not complete — retrying Doric');
            await sdk.waitForTicks(3);
        }
    }
} catch (err) {
    console.error('Script error:', err);
    throw err;
} finally {
    console.log('Disconnecting SDK; browser client can stay open.');
    await sdk.disconnect();
}
