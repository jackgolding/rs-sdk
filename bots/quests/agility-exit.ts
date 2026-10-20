/**
 * Safe gnome agility exiter — finish the lap, clear the gate, walk on.
 *
 *   bun bots/quests/agility-exit.ts <bot> [--to=ardougne|camp|x,z]
 *
 * Why it exists: the gnome course is a cul-de-sac. A bot mid-lap cannot be
 * switched to a travel job — the course sits on its own plane and `findLongPath`
 * has no route off it (prod: `plan frontier stuck at (2483,3420) l2, 251 tiles
 * short`). And abandoning a lap wastes the run's bonus, so the exit is ordered:
 *
 *   1. if the bot is mid-course, tick obstacles until the step index wraps (the
 *      lap bonus included);
 *   2. walk to the gate stand and open it once — the gate is a wall loc, so the
 *      click comes from the walkable tile one south of it (2459,3383);
 *   3. verify the crossing by position (z < 3375), never by the click receipt;
 *   4. walk to the destination with the shared chained traveller, then idle.
 *
 * Standalone on purpose: it does NOT import agility-route.ts, because the
 * deployed copy of that file is a different (older) revision than dev's and a
 * whole-file replacement crashes on its imports.
 */
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

import { ActivitySession, BotSDK, deriveGatewayUrl } from '../../sdk/index';
import { BotActions } from '../../sdk/actions';
import { initPathfinding } from '../../sdk/pathfinding';
import { installGracefulShutdown } from '../../sdk/runner';
import { GnomeCourse } from './gnome-course';
import { travelTo } from './travel';
import { ARDOUGNE_BANK } from './tiles';

const argv = process.argv.slice(2);
const botArg = argv.find((a) => !a.startsWith('-'));
if (!botArg) throw new Error('usage: agility-exit.ts <bot> [--to=ardougne|camp|x,z]');
const toSpec = argv.find((a) => a.startsWith('--to='))?.slice('--to='.length) ?? 'ardougne';

const DESTINATIONS: Record<string, { x: number; z: number }> = {
    ardougne: ARDOUGNE_BANK,
    camp: { x: 2634, z: 3220 },
};
const explicit = /^(-?\d+),(-?\d+)$/.exec(toSpec);
const DEST = DESTINATIONS[toSpec] ?? (explicit ? { x: Number(explicit[1]), z: Number(explicit[2]) } : null);
if (!DEST) throw new Error(`unknown destination '${toSpec}' (ardougne | camp | x,z)`);

const envPath = join(process.cwd(), 'bots', botArg, 'bot.env');
if (!existsSync(envPath)) throw new Error(`bot.env not found at ${envPath}`);
for (const line of readFileSync(envPath, 'utf-8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq > 0) process.env[t.slice(0, eq)] = t.slice(eq + 1);
}
const username = process.env.BOT_USERNAME!;

// Geometry from the deployed agility-route (authoritative for the live world).
const GNOME_GATE = { x: 2459, z: 3383 };
const GNOME_GATE_STAND = { x: 2460, z: 3382 };
const GNOME_START = { x: 2474, z: 3436 };

initPathfinding();
const sdk = new BotSDK({
    botUsername: username,
    password: process.env.PASSWORD!,
    gatewayUrl: deriveGatewayUrl(process.env.SERVER),
    autoLaunchBrowser: false,
    readyTimeout: 45_000,
    connectTimeout: 60_000,
    autoReconnect: false,
    showChat: false,
});
await sdk.connect();
const bot = new BotActions(sdk);
const GRIND_LOG = join(process.cwd(), 'bots', username, 'grind.log');
const session = new ActivitySession(sdk, bot, { name: 'agility-exit', grindLogPath: GRIND_LOG, stallMs: 180_000, maxRecoveryTactics: 6 });
installGracefulShutdown({ graceMs: 120_000 });

const log = (message: string): void => {
    session.log('log', message);
    console.log(`[exit] ${message}`);
};
const intent = (message: string): void => void session.showIntent(message).catch(() => undefined);
const pos = () => {
    const p = sdk.getState()?.player;
    return { x: p?.worldX ?? 0, z: p?.worldZ ?? 0, level: p?.level ?? 0 };
};
const distTo = (x: number, z: number) => Math.hypot(pos().x - x, pos().z - z);
const agilityLevel = () => sdk.getSkills().find((s: { name: string }) => /agility/i.test(s.name))?.baseLevel ?? 1;
const agilityXp = () => (sdk.getSkills().find((s: { name: string }) => /agility/i.test(s.name)) as { experience?: number } | undefined)?.experience ?? 0;
const closeUi = async (): Promise<void> => {
    await bot.dismissBlockingUI().catch(() => undefined);
};

/** Inside the stronghold's grounds (the gate line is z=3383). */
const insideGnomeStronghold = (): boolean => {
    const p = pos();
    return p.z >= 3375 && p.x >= 2440 && p.x <= 2525 && p.z < 3445;
};
/** On the course itself (its obstacles start north of z=3400). */
const onGnomeCourse = (): boolean => pos().z >= 3400 && distTo(GNOME_START.x, GNOME_START.z) < 90;

const course = new GnomeCourse({
    sdk,
    bot,
    session,
    log,
    intent,
    closeUi,
    agilityXp,
    agilityLevel,
    pos,
    distTo,
    isStopped: () => session.isStopped(),
});

log(`start @ ${pos().x},${pos().z} l${pos().level} — agility ${agilityLevel()} — exit to ${toSpec} (${DEST.x},${DEST.z})`);

// 1. Finish the lap if we are mid-course.
if (onGnomeCourse()) {
    const stepAtStart = course.stepIndex;
    for (let i = 0; i < 40 && course.stepIndex !== 0; i++) {
        await course.tick();
        intent(`finishing lap: step ${course.stepIndex + 1}`);
        log(`lap step ${course.stepIndex + 1}/7 (laps ${course.laps})`);
    }
    log(`lap boundary reached (started at step ${stepAtStart + 1}, laps ${course.laps})`);
} else {
    log('not on the course — going straight to the exit');
}

// 2. Clear the gate: click it from the walkable stand, verify by position.
if (insideGnomeStronghold()) {
    session.setPhase('exit_gate').catch(() => undefined);
    const gateRes = await travelTo(sdk, bot, GNOME_GATE_STAND, { log, tolerance: 2 }).catch(() => null);
    log(`walked to the gate stand: ${gateRes?.ok ? 'ok' : gateRes?.reason}`);
    await closeUi();
    const gate = (sdk.getNearbyLocs() ?? []).find((l) => /^gate$/i.test(l.name) && Math.hypot(l.x - GNOME_GATE.x, l.z - GNOME_GATE.z) <= 3);
    if (gate) {
        const opened = await bot.interactLoc(gate, /open/i).catch((e: unknown) => ({ success: false, message: String(e) }));
        log(`gate open: ok=${opened.success}${opened.success ? '' : ` (${(opened as { message?: string }).message ?? '?'})`}`);
    } else {
        log('no gate loc in view — walking straight through');
    }
    const z0 = pos().z;
    await sdk.waitForCondition((s) => (s.player?.worldZ ?? z0) < 3375, 15_000).catch(() => undefined);
    if (insideGnomeStronghold()) await bot.walkTo(2458, 3368, 3).catch(() => undefined);
    log(`gate crossed: ${insideGnomeStronghold() ? 'NO — still inside' : 'yes'} @ ${pos().x},${pos().z}`);
}

// 3. Walk to the destination with the chained traveller.
session.setPhase('walk_out').catch(() => undefined);
const result = await travelTo(sdk, bot, DEST, { log });
if (!result.ok) {
    log(`could not reach ${toSpec}: ${result.reason}`);
    session.stop('stopped', `agility exit failed: ${result.reason}`, { restartable: false });
    while (true) await sdk.waitForTicks(100).catch(() => undefined);
}
log(`arrived at ${toSpec} (${result.at.x},${result.at.z}) l${result.at.level} in ${result.plans} plan(s)`);
session.noteProgress('location', `exited gnome to ${toSpec}`);
session.stop('done', `agility exit -> ${toSpec}`, { restartable: false });
// Idle: a quest container that exits 0 restarts and walks straight back in.
while (true) await sdk.waitForTicks(100).catch(() => undefined);
