import type { BotActions } from './actions';
import type { BotSDK } from './index';

type StairLoc = {
    name: string;
    x: number;
    z: number;
    distance?: number;
    optionsWithIndex?: Array<{ text: string }>;
};

/**
 * Floor unstuck: compare the expected floor against the live floor and climb
 * toward it — down-stairs when above it, up-stairs when below. Re-scans for
 * stairs every attempt; a stale loc list is how bots get stranded a floor
 * away from their route. Shared by quest scripts and the ActivitySession
 * `climb_floor` recovery tactic — one implementation, every entry point.
 */
export async function climbTowardLevel(
    sdk: BotSDK,
    bot: BotActions,
    log: (msg: string) => void,
    expected: number,
    tries = 4
): Promise<boolean> {
    const pos = () => {
        const p = sdk.getState()?.player;
        return { x: p?.worldX ?? 0, z: p?.worldZ ?? 0, level: p?.level ?? 0 };
    };
    const tick = async (n = 2) => {
        try {
            await sdk.waitForTicks?.(n);
        } catch {
            /* client without tick wait — retry immediately */
        }
    };
    for (let i = 0; i < tries && pos().level !== expected; i++) {
        const goingDown = pos().level > expected;
        const dirRe = goingDown ? /climb-down|climb.down/i : /climb-up|climb.up/i;
        try {
            await sdk.scanNearbyLocs?.(10);
        } catch {
            /* scan is best-effort; fall through to the cached list */
        }
        const locs = ((sdk.getNearbyLocs?.() ?? []) as StairLoc[]).filter(
            (l) => /ladder|stair/i.test(l.name) && l.optionsWithIndex?.some((o) => dirRe.test(o.text))
        );
        locs.sort((a, b) => (a.distance ?? 99) - (b.distance ?? 99));
        const stairs = locs[0];
        if (!stairs) {
            log(`No ${goingDown ? 'down' : 'up'} stairs @ ${pos().x},${pos().z} lvl=${pos().level} (want ${expected})`);
            await tick();
            continue;
        }
        const before = pos().level;
        log(`Level unstuck: lvl ${before} -> want ${expected} via ${stairs.name} @ ${stairs.x},${stairs.z}`);
        if (Math.hypot(pos().x - stairs.x, pos().z - stairs.z) > 2) {
            await bot.walkTo?.(stairs.x, stairs.z, 2);
        }
        const r = await bot.interactLoc?.(stairs as never, dirRe);
        if (!r) {
            log(`Still on lvl ${pos().level} @ ${pos().x},${pos().z} (want ${expected})`);
            return false;
        }
        if (!r.success) log(`stairs: ${r.message}`);
        for (let w = 0; w < 20 && pos().level === before; w++) {
            await tick(1);
        }
    }
    if (pos().level !== expected) {
        log(`Still on lvl ${pos().level} @ ${pos().x},${pos().z} (want ${expected})`);
        return false;
    }
    return true;
}
