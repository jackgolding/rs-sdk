/**
 * Game-tick time for quest code. Waits are counted in server ticks, so a script
 * behaves the same on a 60ms test clock, the 300ms prod clock or a 600ms world,
 * with or without network latency in front of it.
 *
 * SDK actions only take millisecond timeouts (and sdk/ is frozen on the fleet);
 * `ticksToMs` converts using the tick length measured live, plus a latency margin.
 */
import type { BotSDK } from '../../../sdk/index';
import type { BotWorldState } from '../../../sdk/types';

/** Consecutive tick waits with no tick arriving before a wait gives up: the client is gone. */
const STALLED_WAITS = 10;
/** Assumed tick length until enough ticks have been seen to measure it. Slowest clock we run. */
const DEFAULT_TICK_MS = 600;
/** Round trip allowance on top of the converted ticks (prod sees 200-300ms). */
const LATENCY_MARGIN_MS = 1_000;

let sample: { tick: number; at: number } | null = null;
let measuredTickMs: number | null = null;

export function tickNow(sdk: BotSDK): number {
    const tick = sdk.getState()?.tick ?? 0;
    const at = Date.now();
    if (!sample || tick < sample.tick) sample = { tick, at };
    else if (tick - sample.tick >= 20) measuredTickMs = (at - sample.at) / (tick - sample.tick);
    return tick;
}

/** Milliseconds for `ticks` at the measured clock, for SDK calls that only take ms. */
export function ticksToMs(ticks: number): number {
    return Math.round(ticks * (measuredTickMs ?? DEFAULT_TICK_MS) + LATENCY_MARGIN_MS);
}

/** Wait until `pred` holds or `ticks` server ticks pass. Returns whether `pred` held. */
export async function untilTicks(sdk: BotSDK, pred: (s: BotWorldState) => boolean, ticks: number): Promise<boolean> {
    const start = tickNow(sdk);
    for (let stalled = 0; stalled < STALLED_WAITS; ) {
        const s = sdk.getState();
        if (s && pred(s)) return true;
        const before = tickNow(sdk);
        if (before - start >= ticks) return false;
        await sdk.waitForTicks(1);
        stalled = tickNow(sdk) > before ? 0 : stalled + 1;
    }
    return false;
}
