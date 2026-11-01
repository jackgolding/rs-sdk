/**
 * Zero-drain protection prayers ("re-flick"), proven on the local fast engine (qlck1, 2026-11-01).
 *
 * Why it works (server content + engine):
 *   - skill_prayer/scripts/prayer.rs2: turning a prayer on starts the 5-tick `prayer_drain` timer only
 *     if none is running; turning the last one off clears it. Drain is charged only when it fires.
 *   - World cycle order: client input (prayer toggles) -> NPCs (attack + protect check) -> player
 *     timers. NPC melee/ranged/magic read the protect varp at swing time, before queueing damage.
 *   So OFF+ON sent together lands in one tick's input phase: the prayer is on when every NPC swings,
 *   and the drain timer restarts from 5. Every <= 4 ticks and it never fires.
 *
 * Measured (60ms engine, 150-200 ticks): held on 99 -> 70 points; re-flicked every 4t 99 -> 98, never
 * seen off; a man vs a Defence-1 player: 6 damaging hits without prayer, 0 re-flicked.
 *
 * Not proven at prod tick speed with lag: if a pair splits across ticks the prayer is off for a tick.
 * The flicker re-enables it at once, and after SPLIT_LIMIT splits it gives up flicking for the run and
 * holds the prayer on (the old behaviour), logging why.
 *
 * Special attacks that skip the protect check (dragonfire is shield-based) are unaffected either way.
 */
import type { BotSDK } from '../../sdk/index';
import type { PrayerName } from '../../sdk/types';

/** Every 3 ticks leaves a tick of margin under the 5-tick drain timer. */
const REFLICK_TICKS = 3;
/** Splits (prayer seen off while wanted) before falling back to holding it on. */
const SPLIT_LIMIT = 6;

export class PrayerFlicker {
    private want: PrayerName | null = null;
    private running = false;
    private lastFlick = 0;
    private splits = 0;
    private offReads = 0;
    /** True once flicking proved unreliable this run: the prayer is simply held on. */
    steady = false;

    constructor(
        private sdk: BotSDK,
        private log: (msg: string) => void
    ) {}

    /** Keep `prayer` up (re-flicked) or, with null, turn the protection off. Returns at once. */
    set(prayer: PrayerName | null): void {
        const prev = this.want;
        if (prev === prayer) return;
        this.want = prayer;
        // A fresh switch-on is not a split.
        this.lastFlick = 0;
        if (prev && prev !== prayer && this.sdk.isPrayerActive(prev)) void this.sdk.sendTogglePrayer(prev);
        if (!prayer && prev && this.sdk.isPrayerActive(prev)) void this.sdk.sendTogglePrayer(prev);
        if (prayer && !this.running) void this.loop();
    }

    get active(): PrayerName | null {
        return this.want;
    }

    private tick(): number {
        return this.sdk.getState()?.tick ?? 0;
    }

    private async loop(): Promise<void> {
        this.running = true;
        try {
            while (this.want) {
                const p = this.want;
                const points = this.sdk.getPrayerState()?.prayerPoints ?? 0;
                if (points <= 0) {
                    await this.sdk.waitForTicks(1).catch(() => {});
                    continue;
                }
                // A toggle is a toggle: an "off" read right after a pair, or from stale state (the
                // box under memory pressure publishes state late), would turn it back off. Only a
                // fresh state seen off on two checks in a row counts (prod, 2026-11-01: every KBD
                // account fell back to holding within minutes).
                const fresh = (this.sdk.getStateAge?.() ?? 0) < 500;
                const off = fresh && !this.sdk.isPrayerActive(p) && this.tick() - this.lastFlick >= 3;
                this.offReads = off ? this.offReads + 1 : 0;
                if (off && (this.offReads >= 2 || !this.lastFlick)) {
                    this.offReads = 0;
                    if (this.lastFlick && !this.steady && ++this.splits >= SPLIT_LIMIT) {
                        this.steady = true;
                        this.log(`prayer flick: ${p} seen off ${this.splits} times — holding it on for the rest of the run`);
                    }
                    await this.sdk.sendTogglePrayer(p);
                    this.lastFlick = this.tick();
                } else if (!off && !this.steady && this.tick() - this.lastFlick >= REFLICK_TICKS) {
                    // OFF and ON back to back: both decoded in the same tick's input phase.
                    await Promise.all([this.sdk.sendTogglePrayer(p), this.sdk.sendTogglePrayer(p)]);
                    this.lastFlick = this.tick();
                }
                await this.sdk.waitForTicks(1).catch(() => {});
            }
        } finally {
            this.running = false;
        }
    }
}
