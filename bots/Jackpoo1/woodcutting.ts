import { BotSDK, deriveGatewayUrl } from '../../sdk/index';
import { BotActions } from '../../sdk/actions';
import { initPathfinding } from '../../sdk/pathfinding';
import { readFileSync, appendFileSync } from 'fs';
import { dirname, join } from 'path';

const DRAYNOR_BANK = { x: 3092, z: 3243 };
const EDGEVILLE_BANK = { x: 3094, z: 3492 };

/** The oak immediately east of Draynor bank, west of the jail aggro. */
const OAK_STAND = { x: 3102, z: 3242 };
/** South of the bank, east of the dark-wizard willow tiles. */
const WILLOW_STAND = { x: 3091, z: 3228 };
/** Yews immediately south of Edgeville bank. */
const YEW_STAND = { x: 3087, z: 3472 };

const SOUTH_TO_LUMBRIDGE = [
    { x: 3088, z: 3220 },
    { x: 3110, z: 3214 },
    { x: 3140, z: 3208 },
    { x: 3175, z: 3208 },
    { x: 3210, z: 3212 },
    { x: 3224, z: 3202 }
];
const DRAYNOR_TO_EDGEVILLE = [
    { x: 3048, z: 3274 },
    { x: 3006, z: 3322 },
    { x: 2965, z: 3378 },
    { x: 2965, z: 3450 },
    { x: 3020, z: 3455 },
    { x: 3087, z: 3472 }
];

const AXE = /^(bronze|iron|steel|black|mithril|adamant|rune) axe$/i;
const STEEL_AXE = /^steel axe$/i;
const KEEP = /^(coins|(bronze|iron|steel|black|mithril|adamant|rune) axe)$/i;
const ANY_LOGS = /logs$/i;
const LETHAL = /jail\s*guard|^guard$|bear|dark wizard|wolf|highwayman/i;

function loadBotEnv(): void {
    const envPath = join(dirname(import.meta.path), 'bot.env');
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
const GRIND_LOG = join(dirname(import.meta.path), 'grind.log');

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
let lastLoggedWc = 0;
let steelReady = false;

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
        hp: p?.hp ?? 10,
        maxHp: p?.maxHp ?? 10,
        isDead: p?.isDead ?? false,
        inCombat: p?.combat?.inCombat ?? false
    };
}

function distTo(x: number, z: number): number {
    return Math.hypot(pos().x - x, pos().z - z);
}

function wc(): number {
    return sdk.getSkill('Woodcutting')?.baseLevel ?? 1;
}

function occupiedSlots(): number {
    return sdk.getInventory().filter((i) => (i.count ?? 0) > 0).length;
}

function invFull(): boolean {
    return occupiedSlots() >= 28;
}

function hasAxe(): boolean {
    return !!(sdk.findInventoryItem(AXE) || sdk.findEquipmentItem(AXE));
}

function hasSteel(): boolean {
    return !!(sdk.findInventoryItem(STEEL_AXE) || sdk.findEquipmentItem(STEEL_AXE));
}

type Phase = {
    id: 'oak' | 'willow' | 'yew';
    tree: RegExp;
    logs: RegExp;
    stand: { x: number; z: number };
    bank: { x: number; z: number };
    maxDrift: number;
};

function phase(): Phase {
    const wood = wc();
    if (wood >= 60) {
        return {
            id: 'yew',
            tree: /^yew$/i,
            logs: /^yew logs$/i,
            stand: YEW_STAND,
            bank: EDGEVILLE_BANK,
            maxDrift: 12
        };
    }
    if (wood >= 30) {
        return {
            id: 'willow',
            tree: /^willow$/i,
            logs: /^willow logs$/i,
            stand: WILLOW_STAND,
            bank: DRAYNOR_BANK,
            maxDrift: 8
        };
    }
    return {
        id: 'oak',
        tree: /^oak$/i,
        logs: /^oak logs$/i,
        stand: OAK_STAND,
        bank: DRAYNOR_BANK,
        maxDrift: 10
    };
}

function nearJail(x = pos().x, z = pos().z): boolean {
    return x >= 3105 && x <= 3148 && z >= 3232 && z <= 3266;
}

function nearWizards(x = pos().x, z = pos().z): boolean {
    return x <= 3087 && z >= 3232 && z <= 3242;
}

function npcDist(n: { x?: number; tileX?: number; z?: number; tileZ?: number; distance?: number }): number {
    if (typeof n.distance === 'number') return n.distance;
    return Math.hypot(pos().x - (n.tileX ?? n.x ?? 0), pos().z - (n.tileZ ?? n.z ?? 0));
}

function nearestLethal(radius = 14) {
    return (sdk.getNearbyNpcs() ?? [])
        .filter((n) => LETHAL.test(n.name) && npcDist(n) <= radius)
        .sort((a, b) => npcDist(a) - npcDist(b))[0] ?? null;
}

function atBankOak(x = pos().x, z = pos().z): boolean {
    return x >= 3090 && x <= 3104 && z >= 3236 && z <= 3248;
}

function treeOk(loc: { x: number; z: number }, id: Phase['id']): boolean {
    if (nearJail(loc.x, loc.z) || nearWizards(loc.x, loc.z)) return false;
    if (id === 'oak') return loc.x <= 3104 && loc.z <= 3246 && loc.x >= 3088 && loc.z >= 3236;
    if (id === 'willow') return loc.x >= 3088 && loc.z <= 3231;
    return true;
}

function findTree(p: Phase) {
    return (sdk.getNearbyLocs() ?? [])
        .filter((l) => p.tree.test(l.name) && l.optionsWithIndex.some((o) => /chop/i.test(o.text)))
        .filter((l) => l.reachable !== false)
        .filter((l) => treeOk(l, p.id))
        .sort((a, b) => (a.distance ?? 99) - (b.distance ?? 99))[0] ?? null;
}

async function closeUi(): Promise<void> {
    if (sdk.getState()?.shop?.isOpen || sdk.getState()?.bank?.isOpen || sdk.getState()?.interface?.isOpen) {
        await bot.closeInterface();
    }
    await bot.dismissBlockingUI();
    if (sdk.getDialog()?.isOpen) {
        await sdk.sendClickDialog(0);
        await sdk.waitForTicks(1);
    }
}

async function leaveLumbridgeCastle(): Promise<boolean> {
    const p = pos();
    if (p.x < 3225 || p.x > 3242 || p.z < 3210 || p.z > 3228) return false;
    intent('Leaving Lumbridge courtyard through the west doors');
    const door = (sdk.getNearbyLocs() ?? []).find(
        (l) => /door/i.test(l.name) && l.optionsWithIndex.some((o) => /^open$/i.test(o.text)) && (l.distance ?? 99) <= 8
    );
    if (door) await bot.openDoor(door);
    await sdk.sendWalk(3216, 3218, true);
    await sdk.waitForTicks(5);
    if (pos().x >= 3226) {
        const door2 = (sdk.getNearbyLocs() ?? []).find(
            (l) => /door/i.test(l.name) && l.optionsWithIndex.some((o) => /^open$/i.test(o.text)) && (l.distance ?? 99) <= 6
        );
        if (door2) await bot.openDoor(door2);
        await sdk.sendWalk(3214, 3218, true);
        await sdk.waitForTicks(4);
    }
    return pos().x >= 3225;
}

async function walkNear(x: number, z: number, tolerance = 4): Promise<boolean> {
    if (distTo(x, z) <= tolerance) return true;
    await leaveLumbridgeCastle();
    if (nearJail() || nearWizards()) {
        await sdk.sendWalk(3088, 3224, true);
        await sdk.waitForTicks(4);
    }
    if (x <= 3110 && pos().x >= 3180) {
        await walkWaypoints([...SOUTH_TO_LUMBRIDGE].reverse());
        if (distTo(x, z) <= tolerance + 2) return true;
    }
    const result = await bot.walkTo(x, z, Math.min(tolerance, 2));
    return result.success || distTo(x, z) <= tolerance + 2;
}

async function walkWaypoints(points: { x: number; z: number }[]): Promise<void> {
    const dest = points[points.length - 1]!;
    for (const p of points) {
        if (nearJail(p.x, p.z) || nearWizards(p.x, p.z)) continue;
        if (distTo(p.x, p.z) <= 8) continue;
        if (Math.hypot(dest.x - p.x, dest.z - p.z) >= distTo(dest.x, dest.z) - 4) continue;
        await bot.walkTo(p.x, p.z, 3);
        if (await fleeIfNeeded()) return;
    }
}

async function fleeIfNeeded(): Promise<boolean> {
    if (pos().isDead) {
        intent('Dead — waiting to respawn');
        await sdk.waitForCondition((s) => !s.player.isDead, 45_000).catch(() => {});
        return true;
    }
    const { hp, maxHp, inCombat } = pos();
    // Stay planted on the bank oak unless actually in the jail or in combat.
    if (atBankOak() && !inCombat && !nearJail()) {
        if (hp <= Math.max(7, Math.floor(maxHp * 0.45))) {
            intent(`Healing ${hp}/${maxHp} on the oak`);
            await sdk.waitForTicks(12);
            return true;
        }
        return false;
    }
    const threat = nearestLethal(14);
    const wizard = threat && /dark wizard/i.test(threat.name);
    const guardOrBear = threat && /guard|bear/i.test(threat.name);
    const tooCloseGuard = guardOrBear && npcDist(threat!) <= 12;
    const tooCloseWizard = wizard && npcDist(threat!) <= 7;
    if (nearJail() || nearWizards() || tooCloseGuard || tooCloseWizard) {
        intent(`Away from ${threat?.name ?? 'jail/wizards'} — back to the oak`);
        await sdk.sendWalk(OAK_STAND.x, OAK_STAND.z, true);
        await sdk.waitForTicks(4);
        return true;
    }
    if (hp <= Math.max(7, Math.floor(maxHp * 0.45)) && !threat) {
        intent(`Healing ${hp}/${maxHp} at a safe tile`);
        await sdk.waitForTicks(12);
        return true;
    }
    return false;
}

async function openDraynorBank(): Promise<boolean> {
    if (pos().x > 3120) await walkWaypoints([...SOUTH_TO_LUMBRIDGE].reverse());
    await walkNear(DRAYNOR_BANK.x, DRAYNOR_BANK.z, 4);
    if (sdk.getState()?.shop?.isOpen) await bot.closeShop();
    if (sdk.getState()?.bank?.isOpen) return true;
    const opened = await bot.openBank();
    if (!opened.success) {
        console.log(`openBank: ${opened.message}`);
        return false;
    }
    return true;
}

async function bankLoad(): Promise<void> {
    const p = phase();
    intent(`Banking at ${p.bank === EDGEVILLE_BANK ? 'Edgeville' : 'Draynor'}`);
    if (p.bank === EDGEVILLE_BANK) {
        if (distTo(EDGEVILLE_BANK.x, EDGEVILLE_BANK.z) > 8) {
            if (pos().z < 3400) await walkWaypoints(DRAYNOR_TO_EDGEVILLE);
            await walkNear(EDGEVILLE_BANK.x, EDGEVILLE_BANK.z, 4);
        }
        if (sdk.getState()?.bank?.isOpen || (await bot.openBank()).success) {
            /* open */
        } else {
            console.log('Edgeville openBank failed');
            return;
        }
    } else if (!(await openDraynorBank())) {
        return;
    }
    for (const item of [...sdk.getInventory()]) {
        if (KEEP.test(item.name)) continue;
        await bot.depositItem(item, -1);
    }
    if (p.id !== 'oak') {
        const steel = sdk.findBankItem(STEEL_AXE);
        if (steel && !hasSteel()) {
            const r = await bot.withdrawItem(steel, 1);
            log(`Withdraw steel axe: ${r.success ? 'ok' : r.message}`);
            steelReady = r.success;
        }
    } else {
        const anyAxe = sdk.getBankItems().filter((i) => AXE.test(i.name));
        if (!hasAxe() && anyAxe[0]) await bot.withdrawItem(anyAxe[0], 1);
    }
    await bot.closeBank();
    await equipBestAxe();
}

async function equipBestAxe(): Promise<void> {
    const wantSteel = phase().id !== 'oak';
    if (wantSteel) {
        const steel = sdk.findInventoryItem(STEEL_AXE);
        if (steel && !sdk.findEquipmentItem(STEEL_AXE)) {
            const r = await bot.equipItem(steel);
            log(`Equip steel axe: ${r.success ? 'ok' : r.message}`);
        }
        return;
    }
    const axe = sdk.findInventoryItem(AXE);
    if (axe && !sdk.findEquipmentItem(AXE)) {
        const r = await bot.equipItem(axe);
        log(`Equip ${axe.name}: ${r.success ? 'ok' : r.message}`);
    }
}

async function tick(): Promise<void> {
    await closeUi();
    if (await leaveLumbridgeCastle()) return;
    if (await fleeIfNeeded()) return;

    const p = phase();
    if (!hasAxe()) {
        await bankLoad();
        if (!hasAxe()) {
            await sdk.waitForTicks(5);
            return;
        }
    }
    if (p.id !== 'oak' && !hasSteel() && !steelReady) {
        await bankLoad();
    }
    await equipBestAxe();

    if (invFull() || (!!sdk.findInventoryItem(ANY_LOGS) && occupiedSlots() >= 27)) {
        intent(`Inventory full — banking ${p.id} logs`);
        await bankLoad();
        return;
    }

    if (p.id === 'yew' && pos().z < 3400) {
        intent('Walking Draynor → Falador → Edgeville yews');
        await bankLoad();
        await walkWaypoints(DRAYNOR_TO_EDGEVILLE);
        return;
    }

    let tree = findTree(p);
    if (!tree && distTo(p.stand.x, p.stand.z) <= p.maxDrift) {
        await sdk.waitForTicks(2);
        tree = findTree(p);
    }
    if (tree && (tree.distance ?? 99) <= 2) {
        // Already on the tree — do not walk the stand tile.
    } else if (distTo(p.stand.x, p.stand.z) > p.maxDrift) {
        intent(`${p.id} stand ${p.stand.x},${p.stand.z} (wc ${wc()})`);
        await walkNear(p.stand.x, p.stand.z, 2);
        return;
    }
    if (!tree) {
        intent(`Waiting for ${p.id} to respawn`);
        await sdk.waitForTicks(4);
        return;
    }

    intent(`Chop ${tree.name} at ${tree.x},${tree.z}`);
    const r = await bot.chopTree(tree);
    if (!r.success) console.log(`chop: ${r.message}`);
}

try {
    lastLoggedWc = wc();
    console.log('Goal: Chop and bank logs (no fletching). Oaks → willows → Edgeville yews.');
    await bot.skipTutorial();
    await closeUi();
    log(`Woodcut start WC ${lastLoggedWc} (bank logs) @ ${pos().x},${pos().z}`);

    if (pos().hp < 10) {
        intent('Healing before moving');
        while (pos().hp < 12 && !pos().isDead && !nearestLethal(12)) {
            await sdk.waitForTicks(10);
        }
    }
    if (!hasAxe()) await bankLoad();
    await equipBestAxe();
    log(`Tools axe=${sdk.findEquipmentItem(AXE)?.name ?? sdk.findInventoryItem(AXE)?.name ?? 'none'} phase=${phase().id}`);

    while (true) {
        await closeUi();
        if (pos().isDead) {
            await sdk.waitForCondition((s) => !s.player.isDead, 45_000).catch(() => {});
            continue;
        }
        if (wc() !== lastLoggedWc) {
            log(`LEVEL UP Woodcutting ${wc()} | ${phase().id}`);
            lastLoggedWc = wc();
        }
        await tick();
    }
} catch (err) {
    console.error('Script error:', err);
    throw err;
} finally {
    console.log('Disconnecting SDK; browser client can stay open.');
    await sdk.disconnect();
}
