import { BotSDK, deriveGatewayUrl } from '../../sdk/index';
import { BotActions } from '../../sdk/actions';
import { initPathfinding } from '../../sdk/pathfinding';
import { readFileSync, appendFileSync } from 'fs';
import { dirname, join } from 'path';

const TRAPDOOR = { x: 3097, z: 3468 };
const WILDY_GATE = { x: 3103, z: 9909 };
const PILE = { x: 3105, z: 9941 };

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
    showChat: true
});

console.log('Opening/attaching the game client...');
await sdk.connect();
const bot = new BotActions(sdk);

function pos() {
    const p = sdk.getState()?.player;
    return { x: p?.worldX ?? 0, z: p?.worldZ ?? 0, isDead: p?.isDead ?? false };
}

function distTo(x: number, z: number): number {
    const p = pos();
    return Math.hypot(p.x - x, p.z - z);
}

function inDungeon(): boolean {
    return pos().z > 6400;
}

function occupiedSlots(): number {
    return sdk.getInventory().filter((i) => (i.count ?? 0) > 0).length;
}

async function walkNear(x: number, z: number, tolerance = 6): Promise<boolean> {
    if (distTo(x, z) <= tolerance) return true;
    const result = await bot.walkTo(x, z, Math.min(tolerance, 3));
    log(`walkTo(${x},${z}): ${result.success ? 'ok' : result.message} @ ${pos().x},${pos().z}`);
    return result.success || distTo(x, z) <= tolerance + 2;
}

async function climbIntoDungeon(): Promise<boolean> {
    if (inDungeon()) return true;
    // Same tile that worked on the first trip — west of the trapdoor, not on it.
    await walkNear(3095, 3468, 1);
    for (let attempt = 0; attempt < 4 && !inDungeon(); attempt++) {
        const trap = sdk.findNearbyLoc(/trapdoor/i);
        log(`Trapdoor try ${attempt}: ${trap ? `${trap.name} (${trap.x},${trap.z}) [${trap.optionsWithIndex.map((o) => o.text).join(', ')}]` : 'none'} @ ${pos().x},${pos().z}`);
        if (!trap) {
            await sdk.waitForTicks(1);
            continue;
        }
        if (trap.optionsWithIndex.some((o) => /^open$/i.test(o.text))) {
            const opened = await bot.interactLoc(trap, /^open$/i);
            log(`Open trapdoor: ${opened.success} ${opened.message ?? ''}`);
            await sdk.waitForCondition(
                (s) => (s.nearbyLocs ?? []).some((l) => /trapdoor/i.test(l.name) && l.optionsWithIndex.some((o) => /climb-down/i.test(o.text))),
                6_000
            ).catch(() => {});
        }
        const down = sdk.findNearbyLoc(/trapdoor/i, { withOption: /climb-down/i });
        if (down) {
            const climbed = await bot.interactLoc(down, /climb-down/i);
            log(`Climb-down: ${climbed.success} ${climbed.message ?? ''}`);
            await sdk.waitForCondition((s) => (s.player?.worldZ ?? 0) > 6400, 8_000).catch(() => {});
        }
    }
    log(`Dungeon ${inDungeon()} @ ${pos().x},${pos().z}`);
    return inDungeon();
}

async function grabPile(): Promise<number> {
    let grabbed = 0;
    const deadline = Date.now() + 45_000;
    while (Date.now() < deadline) {
        const items = (sdk.getGroundItems() ?? [])
            .filter((g) => (g.reachable !== false) && Math.hypot((g.x - PILE.x), (g.z - PILE.z)) < 8)
            .sort((a, b) => {
                const aPri = /staff of fire|rune$/i.test(a.name) ? 0 : 1;
                const bPri = /staff of fire|rune$/i.test(b.name) ? 0 : 1;
                if (aPri !== bPri) return aPri - bPri;
                return (a.distance ?? 99) - (b.distance ?? 99);
            });
        if (items.length === 0) {
            if (grabbed > 0) break;
            await sdk.waitForTicks(1);
            continue;
        }
        if (occupiedSlots() >= 28) {
            log('Inventory full while looting pile');
            break;
        }
        const item = items[0]!;
        log(`Picking ${item.name} x${item.count} @ ${item.x},${item.z} d=${item.distance}`);
        const r = await bot.pickupItem(item);
        log(`Pickup ${item.name}: ${r.success} ${r.message ?? ''}`);
        if (r.success) grabbed++;
        else await sdk.waitForTicks(1);
    }
    return grabbed;
}

try {
    await bot.dismissBlockingUI();
    if (sdk.getState()?.shop?.isOpen) await bot.closeShop();
    if (sdk.getState()?.bank?.isOpen) await bot.closeBank();
    log(`Recover pile at ${PILE.x},${PILE.z}. Now ${pos().x},${pos().z} inv=${sdk.getInventory().map((i) => `${i.count} ${i.name}`).join(', ')}`);
    await sdk.showIntent('recover death pile').catch(() => {});

    if (pos().isDead) {
        await sdk.waitForCondition((s) => !s.player.isDead, 30_000).catch(() => {});
    }

    if (!inDungeon()) {
        if (!(await climbIntoDungeon())) {
            log('Failed to enter dungeon');
            return;
        }
    }
    if (pos().z < WILDY_GATE.z - 4) {
        await walkNear(WILDY_GATE.x, WILDY_GATE.z - 2, 3);
        const gate = sdk.findNearbyLoc(/gate/i, { withOption: /open/i });
        if (gate) await bot.openDoor(gate);
    }
    await walkNear(PILE.x, PILE.z, 2);

    const nearby = (sdk.getGroundItems() ?? []).map((g) => `${g.count} ${g.name} (${g.x},${g.z})`);
    log(`Ground: ${nearby.join(', ') || 'nothing'}`);
    const grabbed = await grabPile();
    log(`Grabbed ${grabbed}. Inv: ${sdk.getInventory().map((i) => `${i.count} ${i.name}`).join(', ')}`);
} catch (err) {
    console.error('Script error:', err);
    throw err;
} finally {
    console.log('Disconnecting SDK; browser client can stay open.');
    await sdk.disconnect();
}
