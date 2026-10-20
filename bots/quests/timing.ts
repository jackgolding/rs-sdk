/**
 * Timing budgets — one place, in WALL-CLOCK units, tuned for the slowest regime.
 *
 * Why wall-clock and not ticks: dev runs 400ms/tick, the demo server 300ms, and
 * `::speed` can put a session at 20ms. A wait expressed in ticks is therefore a
 * different amount of time in each place, which is how a script ends up tuned
 * for one world and flaky in the other. Budgets here are TIMEOUTS, not waits:
 * generous enough for 300ms/tick plus RTT, and a faster clock simply finishes
 * sooner. Nothing scales by clock — scaling is what creates divergence.
 *
 * Rule: never `waitForTicks(n)` to "let something settle". Wait on the
 * condition you actually need (see `settle.ts`), with one of these as the cap.
 */

export const TIMING = {
    /** Interface/packet round trip: one action and its echo. */
    actionMs: 2_000,
    /** Bank contents stream in a tick or two after `isOpen` flips. */
    bankSyncMs: 5_000,
    /** A move that should land within a couple of tiles. */
    stepMs: 3_000,
    /** A dialog page that should appear after a click. */
    dialogPageMs: 4_000,
    /** A plane change (stairs/ladder) and its scene rebuild. */
    planeChangeMs: 8_000,
    /** Scene rebuild after a teleport or long walk, before trusting a scan. */
    sceneSettleMs: 6_000,
    /** A grant behind `p_delay`s (items, journal writes). */
    grantMs: 12_000,
    /** Whole-quest stage budget for a single FSM state, when nothing narrower fits. */
    stageMs: 300_000,
} as const;

export type TimingKey = keyof typeof TIMING;
