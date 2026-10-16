import type { ActivitySession } from '../../sdk/activity';
import type { BotActions } from '../../sdk/actions';
import type { BotSDK } from '../../sdk/index';
import type { Tile } from './tiles';
import { MUSA_SHIP, EDGEVILLE_LEVER, EDGEVILLE, CATHERBY_TO_ARDY, WHITE_WOLF_TO_CATHERBY, WILDY_SOUTH_TO_DITCH } from './tiles';
import { findLongPath } from '../../sdk/pathfinding';
import { LAVA_MAZE_EAST, southOfLavaMaze } from './rune-rocks-route';

export function playerPos(sdk: BotSDK): { x: number; z: number; level: number } {
    const p = sdk.getState()?.player;
    return { x: p?.worldX ?? 0, z: p?.worldZ ?? 0, level: p?.level ?? 0 };
}

export function distTo(sdk: BotSDK, x: number, z: number): number {
    const p = playerPos(sdk);
    return Math.hypot(p.x - x, p.z - z);
}

export async function closeUi(bot: BotActions, sdk: BotSDK): Promise<void> {
    for (let i = 0; i < 8; i++) {
        await bot.dismissBlockingUI();
        const dialog = sdk.getDialog();
        if (dialog?.isOpen) {
            const cont = dialog.options?.find((o) => /continue|click here/i.test(o.text));
            if (cont?.componentId) {
                await sdk.sendClickComponent(cont.componentId);
            }
            await sdk.sendClickDialog(cont?.index ?? 0);
            await sdk.waitForTicks(1).catch(() => {});
            continue;
        }
        if (sdk.getState()?.shop?.isOpen || sdk.getState()?.bank?.isOpen || sdk.getState()?.interface?.isOpen) {
            await bot.closeInterface();
            await sdk.waitForTicks(1).catch(() => {});
            continue;
        }
        break;
    }
}

function adjacentClosedDoors(sdk: BotSDK) {
    return (sdk.getNearbyLocs() ?? []).filter((l) => {
        const named = /door|gate/i.test(l.name);
        const dist = l.distance ?? 99;
        const opts = l.optionsWithIndex ?? [];
        const openText = (l.options ?? []).some((t) => /^open$/i.test(t));
        const openIdx = opts.some((o) => /^open$/i.test(o.text));
        return named && dist <= 2 && (openIdx || openText);
    });
}

export async function walkNear(
    bot: BotActions,
    sdk: BotSDK,
    x: number,
    z: number,
    tolerance = 4
): Promise<boolean> {
    if (distTo(sdk, x, z) <= tolerance) return true;
    // Inside a random house (Lumbridge respawn, etc.) walkTo will not path
    // through a closed door — open anything adjacent and step out first.
    for (let i = 0; i < 5 && adjacentClosedDoors(sdk).length; i++) {
        if (await leaveAdjacentClosedDoor(sdk)) break;
        await sdk.waitForTicks(2).catch(() => {});
    }
    const result = await bot.walkTo(x, z, Math.min(tolerance, 3));
    return result.success || distTo(sdk, x, z) <= tolerance + 2;
}

/** Open a closed door within 2 tiles and walk through it. */
export async function leaveAdjacentClosedDoor(sdk: BotSDK): Promise<boolean> {
    const p = playerPos(sdk);
    const doors = adjacentClosedDoors(sdk);
    if (!doors.length) return false;
    for (const door of doors) {
        const open =
            (door.optionsWithIndex ?? []).find((o) => /^open$/i.test(o.text)) ??
            (door.options?.some((t) => /^open$/i.test(t)) ? { text: 'Open', opIndex: 1 } : undefined);
        if (!open) continue;
        console.log(
            `[leave-door] ${p.x},${p.z} → ${door.name} ${door.x},${door.z} id=${door.id} op=${open.opIndex}`
        );
        const clicked = await sdk.sendInteractLoc(door.x, door.z, door.id, open.opIndex);
        console.log(`[leave-door] interact ${clicked.success ? 'ok' : clicked.message}`);
        await sdk.waitForTicks(2).catch(() => {});
        const dx = door.x === p.x ? 0 : Math.sign(door.x - p.x);
        const dz = door.z === p.z ? 0 : Math.sign(door.z - p.z);
        await sdk.sendWalk(p.x + dx * 2, p.z + dz * 2, true);
        await sdk.waitForTicks(4).catch(() => {});
        const after = playerPos(sdk);
        if (after.x !== p.x || after.z !== p.z) {
            console.log(`[leave-door] stepped to ${after.x},${after.z}`);
            return true;
        }
    }
    return false;
}

/** sendWalk hops. Skips a hop that is farther from `dest` than the player already is. */
export async function walkSendHops(sdk: BotSDK, hops: Tile[], dest: Tile, tolerance = 5): Promise<void> {
    for (const hop of hops) {
        if (distTo(sdk, dest.x, dest.z) <= 8) return;
        const remaining = distTo(sdk, dest.x, dest.z);
        const via = Math.hypot(hop.x - dest.x, hop.z - dest.z);
        if (via > remaining + 6) continue;
        if (distTo(sdk, hop.x, hop.z) <= tolerance) continue;
        // Long straight chords through dense obstacles (forest, market stalls)
        // get dropped by the server with no message. Expand the leg into
        // <=6-tile sub-hops along the client path instead.
        const legs: Array<{ x: number; z: number }> = [hop];
        try {
            const p = playerPos(sdk);
            const path = findLongPath(p.level, p.x, p.z, hop.x, hop.z);
            if (path && path.length > 12) {
                legs.length = 0;
                for (let i = 6; i < path.length; i += 6) {
                    const step = path[i] as { x: number; z: number };
                    legs.push({ x: step.x, z: step.z });
                }
                legs.push(hop);
            }
        } catch {}
        for (const leg of legs) {
            if (distTo(sdk, dest.x, dest.z) <= 8) return;
            if (distTo(sdk, leg.x, leg.z) <= tolerance) continue;
            await sdk.sendWalk(leg.x, leg.z, true);
            await sdk
                .waitForCondition(
                    (s) =>
                        Math.hypot((s.player?.worldX ?? 0) - leg.x, (s.player?.worldZ ?? 0) - leg.z) <= tolerance + 2,
                    12_000
                )
                .catch(() => {});
        }
    }
}

/** False after `timeoutMs` with no player tile (gateway/lite reconnect). */
export async function waitForPlayerState(sdk: BotSDK, timeoutMs = 120_000): Promise<boolean> {
    if ((sdk.getState()?.player?.worldX ?? 0) > 0) return true;
    return sdk
        .waitForCondition((s) => (s?.player?.worldX ?? 0) > 0, timeoutMs)
        .then(() => true)
        .catch(() => false);
}

export async function walkWaypoints(
    bot: BotActions,
    sdk: BotSDK,
    wps: Tile[],
    opts?: {
        distTo?: (x: number, z: number) => number;
        walkNear?: (x: number, z: number, tolerance: number) => Promise<boolean>;
        beforeStep?: () => Promise<void>;
    }
): Promise<void> {
    const measure = opts?.distTo ?? ((x, z) => distTo(sdk, x, z));
    const step = opts?.walkNear ?? ((x, z, t) => walkNear(bot, sdk, x, z, t));
    const dest = wps[wps.length - 1];
    if (!dest) return;
    for (const wp of wps) {
        if (!(await waitForPlayerState(sdk))) return;
        if (opts?.beforeStep) await opts.beforeStep();
        if (measure(dest.x, dest.z) <= 8) return;
        const remaining = measure(dest.x, dest.z);
        const via = Math.hypot(wp.x - dest.x, wp.z - dest.z);
        if (via >= remaining - 6) continue;
        await step(wp.x, wp.z, 8);
    }
    if (measure(dest.x, dest.z) > 6) await step(dest.x, dest.z, 6);
}

/**
 * Ardougne / Catherby / Seers → White Wolf Mountain → south of the Edgeville
 * ditch. A long `walkTo` from Kandarin does not route east; this does.
 * Calls `eat` before every hop (White Wolves are aggressive to low levels).
 */
export async function walkKandarinToEdgeville(
    bot: BotActions,
    sdk: BotSDK,
    opts: {
        eat: () => Promise<void>;
        walkNear?: (x: number, z: number, tolerance: number) => Promise<boolean>;
    }
): Promise<boolean> {
    if (!(await waitForPlayerState(sdk))) return false;
    if (playerPos(sdk).x >= 2990 || playerPos(sdk).z > 6400) return true;
    if (playerPos(sdk).x < 2780) {
        await walkWaypoints(bot, sdk, [...CATHERBY_TO_ARDY].reverse(), {
            walkNear: opts.walkNear,
            beforeStep: opts.eat
        });
    }
    const hops = [...WHITE_WOLF_TO_CATHERBY].reverse();
    const dest = hops[hops.length - 1]!;
    for (const hop of hops) {
        if (!(await waitForPlayerState(sdk))) return false;
        if (sdk.getState()?.player?.isDead) return false;
        await opts.eat();
        await walkSendHops(sdk, [hop], dest, 5);
    }
    return playerPos(sdk).x >= 2990;
}

export async function crossGangplank(bot: BotActions, sdk: BotSDK): Promise<void> {
    const plank = sdk.findNearbyLoc(/gangplank/i);
    if (!plank) return;
    const opt = plank.optionsWithIndex.find((o) => /cross|board/i.test(o.text));
    if (opt) await sdk.sendInteractLoc(plank.x, plank.z, plank.id, opt.opIndex);
    else await bot.interactLoc(plank, /cross|board/i);
    await sdk.waitForTicks(5);
}

export async function recoverStun(sdk: BotSDK, eat: () => Promise<void>): Promise<void> {
    await eat();
    await sdk.waitForTicks(8);
    await eat();
}

/** Named recovery for Musa Point gangplank wedge. */
export async function recoverGangplank(bot: BotActions, sdk: BotSDK): Promise<boolean> {
    const p = playerPos(sdk);
    if (p.x !== MUSA_SHIP.x || p.z !== MUSA_SHIP.z) return false;
    await closeUi(bot, sdk);
    await crossGangplank(bot, sdk);
    await sdk.waitForTicks(8);
    return p.x !== MUSA_SHIP.x || p.z !== MUSA_SHIP.z;
}

const leverHistory: Array<{ x: number; z: number }> = [];

/** Detect bank ↔ lever oscillation and force a walk north. */
export async function recoverLeverOscillation(bot: BotActions, sdk: BotSDK): Promise<boolean> {
    const p = playerPos(sdk);
    leverHistory.push({ x: p.x, z: p.z });
    if (leverHistory.length > 8) leverHistory.shift();
    const nearLever =
        Math.hypot(p.x - EDGEVILLE_LEVER.x, p.z - EDGEVILLE_LEVER.z) < 12 ||
        (p.x > 3085 && p.x < 3100 && p.z > 3468 && p.z < 3482);
    if (!nearLever || leverHistory.length < 6) return false;
    const uniq = new Set(leverHistory.map((t) => `${t.x},${t.z}`));
    if (uniq.size > 3) return false;
    await closeUi(bot, sdk);
    await bot.walkTo(EDGEVILLE.x, EDGEVILLE.z, 4);
    leverHistory.length = 0;
    return true;
}

/**
 * One wilderness hop. Waits until the hop finishes — re-issuing sendWalk on
 * the first step cancels run. `step` stays small next to lava.
 */
export async function hopSend(sdk: BotSDK, x: number, z: number, step = 10): Promise<boolean> {
    for (let i = 0; i < 40; i++) {
        const p = playerPos(sdk);
        const d = Math.hypot(p.x - x, p.z - z);
        if (d <= 4) return true;
        const s = Math.min(step, Math.max(1, d));
        const tx = Math.round(p.x + ((x - p.x) / d) * s);
        const tz = Math.round(p.z + ((z - p.z) / d) * s);
        const sx = p.x;
        const sz = p.z;
        await sdk.sendWalk(tx, tz, true);
        await sdk
            .waitForCondition((st) => {
                if (st.player?.isDead) return true;
                const px = st.player?.worldX ?? 0;
                const pz = st.player?.worldZ ?? 0;
                return Math.hypot(px - tx, pz - tz) <= 3 || Math.hypot(px - x, pz - z) <= 4;
            }, Math.max(4_000, s * 400))
            .catch(() => {});
        const now = playerPos(sdk);
        if (now.x === sx && now.z === sz) {
            await sdk.sendWalk(sx + (i % 2 === 0 ? 3 : -3), sz - 2, true);
            await sdk.waitForTicks(2).catch(() => {});
        }
    }
    return distTo(sdk, x, z) <= 6;
}

/**
 * South of the Edgeville ditch. From the lava maze, east onto the road
 * first — a chord toward 3088, 3525 walks through dragons and lava.
 * Waypoints north of the player are skipped.
 */
export async function leaveEdgevilleWilderness(sdk: BotSDK): Promise<boolean> {
    const here = () => playerPos(sdk);
    if (here().z < 3520 || here().z >= 6400) return true;
    const stepFor = (z: number) => (z >= 3780 ? 3 : 12);
    if (southOfLavaMaze(here().x, here().z)) {
        await hopSend(sdk, LAVA_MAZE_EAST.x, LAVA_MAZE_EAST.z, 3);
        await hopSend(sdk, 3115, 3780, 3);
    } else if (here().z >= 3860 && here().x < 3120) {
        await hopSend(sdk, 3130, Math.min(here().z, 3879), 3);
        await hopSend(sdk, LAVA_MAZE_EAST.x, LAVA_MAZE_EAST.z, 3);
        await hopSend(sdk, 3115, 3780, 3);
    }
    for (const wp of WILDY_SOUTH_TO_DITCH) {
        if (here().z < 3520 || here().z >= 6400) return true;
        if (wp.z > here().z + 4) continue;
        await hopSend(sdk, wp.x, wp.z, stepFor(Math.max(here().z, wp.z)));
    }
    if (here().z >= 3520 && here().z < 6400) await hopSend(sdk, 3092, 3516, 8);
    return here().z < 3520 || here().z >= 6400;
}

const WAIT_TICKS_NO_STATE_BACKOFF_MS = 2_000;

/**
 * A missing snapshot used to `stopRestartable` after 15s. Launchd then
 * relaunched into the same missing client until the hourly cap. Wait here
 * instead. The session's controller watch still exits 70 if the client
 * stays gone for the give-up window.
 */
export function installWaitForTicksGuard(sdk: BotSDK, session: ActivitySession): void {
    const origWait = sdk.waitForTicks.bind(sdk);
    sdk.waitForTicks = (async (ticks: number = 1) => {
        for (;;) {
            try {
                return await origWait(ticks);
            } catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                session.log('warn', `waitForTicks(${ticks}): ${message} — waiting for the client`);
                if (session.isStopped()) throw err;
                await new Promise((r) => setTimeout(r, WAIT_TICKS_NO_STATE_BACKOFF_MS));
            }
        }
    }) as typeof sdk.waitForTicks;
}
