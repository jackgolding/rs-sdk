/**
 * One-shot plane descender: get a bot standing on plane 0.
 *
 * Why this exists: walkTo never changes planes, so a bot parked upstairs (the
 * Seers wheel house on plane 1, or the bar next door) reports
 * `PATHFINDING FAILED ... path ends N tiles away` at its own tile forever and
 * every walk-based script stalls identically. seers-wc-fm's climbDown() falls
 * back to walking at the wheel house when no staircase is in scan range, and a
 * bot already ON the wheel floor makes that fallback a no-op.
 *
 * Scans for any staircase/ladder offering climb-down, walks to it in short
 * chords (upstairs bot.walkTo refuses long legs), interacts, and repeats until
 * the player reports plane 0. Then parks: the box relaunches an exit-0 script,
 * so a parked idle is the only safe terminal state.
 *
 *   bun bots/quests/climb-down.ts {botname}
 */
import { ActivitySession, BotSDK, deriveGatewayUrl } from '../../sdk/index';
import { BotActions } from '../../sdk/actions';
import { initPathfinding } from '../../sdk/pathfinding';
import { nextWalkStep } from '../../sdk/activity';
import { existsSync, readFileSync } from 'fs';
import { dirname, join } from 'path';
import { installGracefulShutdown } from '../../sdk/runner';

const DOWN = /climb-down|climb\.down|go-down|go\.down/i;
const STAIRS = /stair|ladder|staircase/i;
/** Where to search for a staircase when none is in the current scan. */
const SWEEP = [
    { x: 2715, z: 3471 }, // Seers wheel house, ground floor
    { x: 2716, z: 3472 },
    { x: 2713, z: 3471 },
    { x: 2728, z: 3462 }, // Seers bar (the classic wrong-house trap)
    { x: 2725, z: 3466 },
    { x: 2471, z: 3422 }, // gnome course landing
    { x: 2461, z: 3417 },
    { x: 2479, z: 3408 }
];

const botArg = process.argv.slice(2).find((a) => !a.startsWith('-'));

function loadBotEnv(): void {
    const envPath = botArg
        ? join(process.cwd(), 'bots', botArg, 'bot.env')
        : join(dirname(import.meta.path), 'bot.env');
    if (!existsSync(envPath)) {
        throw new Error(`bot.env not found at ${envPath}. Usage: bun bots/quests/climb-down.ts {botname}`);
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
const session = new ActivitySession(sdk, bot, { name: 'climb-down', grindLogPath: GRIND_LOG });
installGracefulShutdown();

function log(msg: string): void {
    session.log('log', msg);
}

function intent(msg: string): void {
    void session.showIntent(msg);
}

function pos() {
    const p = sdk.getState()?.player;
    return { x: p?.worldX ?? 0, z: p?.worldZ ?? 0, level: p?.level ?? 0 };
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function park(reason: string): Promise<void> {
    await session.setPhase('parked');
    session.setAnchor(pos().x, pos().z, pos().level);
    log(`PARKED ${reason}`);
    while (!session.stopRequested && !session.isStopped()) {
        await sleep(60_000);
        session.noteProgress('phase', 'parked');
    }
}

/** Short chord steps: upstairs bot.walkTo refuses long legs. */
async function stepTo(x: number, z: number, tol = 1): Promise<boolean> {
    for (let i = 0; i < 14 && !session.stopRequested; i++) {
        const p = pos();
        if (Math.hypot(p.x - x, p.z - z) <= tol) return true;
        const step = nextWalkStep(p, { x, z }, 3);
        if (step.x === p.x && step.z === p.z) return true;
        await sdk.sendWalk(step.x, step.z, true);
        await sdk
            .waitForCondition(
                (s) => (s.player?.worldX ?? p.x) !== p.x || (s.player?.worldZ ?? p.z) !== p.z,
                2_500
            )
            .catch(() => {});
    }
    return Math.hypot(pos().x - x, pos().z - z) <= tol;
}

function stairsDown() {
    return (sdk.getNearbyLocs() ?? [])
        .filter((l) => STAIRS.test(l.name) && l.optionsWithIndex.some((o) => DOWN.test(o.text)))
        .sort(
            (a, b) =>
                (a.reachable === false ? 1 : 0) - (b.reachable === false ? 1 : 0) ||
                (a.distance ?? 99) - (b.distance ?? 99)
        );
}

async function descendOnce(): Promise<boolean> {
    const before = pos().level;
    const stair = stairsDown()[0];
    if (!stair) return false;
    const match = stair.optionsWithIndex.find((o) => DOWN.test(o.text));
    intent(`Climbing down ${stair.name} @ ${stair.x},${stair.z}`);
    if ((stair.distance ?? 99) > 2) {
        await stepTo(stair.x, stair.z, 1);
    }
    if ((stair.distance ?? 99) <= 2 && match) {
        await sdk.sendInteractLoc(stair.x, stair.z, stair.id, match.opIndex);
    } else {
        await bot.interactLoc(stair, DOWN).catch(() => {});
    }
    await sdk.waitForCondition((s) => (s.player?.level ?? before) !== before, 8_000).catch(() => {});
    await bot.dismissBlockingUI().catch(() => {});
    return pos().level < before;
}

try {
    await bot.skipTutorial().catch(() => {});
    await bot.dismissBlockingUI().catch(() => {});
    const start = pos();
    log(`Climb-down start plane ${start.level} @ ${start.x},${start.z}`);

    if (start.level <= 0) {
        log(`CLIMB-DOWN already grounded @ ${start.x},${start.z} plane 0`);
        await park(`plane 0 — nothing to descend from @ ${start.x},${start.z}`);
    } else {
        let sweeps = 0;
        while (pos().level > 0 && sweeps < 3 && !session.stopRequested) {
            await sdk.scanNearbyLocs(12).catch(() => {});
            if (await descendOnce()) {
                if (pos().level <= 0) break;
                continue;
            }
            // No usable staircase in range: chord-walk toward the next sweep
            // point, which is the wheel house / bar floor plan.
            const here = SWEEP.reduce((best, s) =>
                Math.abs(s.x - pos().x) + Math.abs(s.z - pos().z) <
                Math.abs(best.x - pos().x) + Math.abs(best.z - pos().z)
                    ? s
                    : best
            );
            if (Math.hypot(here.x - pos().x, here.z - pos().z) < 2) {
                sweeps++;
                await stepTo(here.x + (sweeps % 2 === 0 ? 2 : -2), here.z, 1);
            } else {
                await stepTo(here.x, here.z, 1);
            }
            await sdk.scanNearbyLocs(12).catch(() => {});
        }

        const end = pos();
        if (end.level <= 0) {
            log(`CLIMB-DOWN done @ ${end.x},${end.z} plane 0`);
            await park(`plane 0 @ ${end.x},${end.z}`);
        } else {
            log(`CLIMB-DOWN failed — still plane ${end.level} @ ${end.x},${end.z}`);
            await park(`still plane ${end.level} @ ${end.x},${end.z} — no staircase found`);
        }
    }
} catch (err) {
    session.stopRestartable('script_error', err instanceof Error ? err.message : String(err));
    console.error('Script error:', err);
} finally {
    await session.finalizeStop();
    console.log('Disconnecting SDK; browser client can stay open.');
    await sdk.disconnect();
}
