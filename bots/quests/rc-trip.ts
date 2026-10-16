/**
 * Tick model for a runecraft trip. Another altar reuses this with its own
 * step counts from `rc-route.ts`.
 *
 * Energy matches `Player.updateEnergy`: 10000 = 100%. A tick that takes two
 * steps drains; a tick that takes fewer than two steps recovers; a `p_delay`
 * tick does neither (`updateEnergy` returns while `delayed`).
 *
 * Run while energy is above 0. A run tick still moves two tiles when it
 * starts with a single point of energy, so it does not need a full drain
 * stored up first. Standing still to regenerate covers no tiles: one idle
 * tick plus one run tick is walk speed, while walking that same tick and
 * then running covers three tiles in two ticks. Once energy is above 0,
 * spending it immediately matches an exhaustive search of run-versus-walk.
 */

export const TICK_MS = 600;
export const ENERGY_MAX = 10_000;

/** Displayed Runecraft XP per essence. The dbrow stores tenths (`experience,50`). */
export const AIR_XP_TENTHS = 50;

export const ESSENCE_GRAMS = 2;
export const AIR_TALISMAN_GRAMS = 15;
export const AIR_RUNE_GRAMS = 2;
export const AIR_MULTIPLIER = 11;

export function runEnergyLoss(weightGrams: number): number {
    const kg = weightGrams / 1000;
    const clamp = Math.min(Math.max(kg, 0), 64);
    return (67 + (67 * clamp) / 64) | 0;
}

export function runEnergyRecover(agility: number): number {
    return ((agility / 6) | 0) + 8;
}

/**
 * Idle ticks before energy leaves 0. One is enough (`recover` is at least 8),
 * and that tick moves nothing. A walk tick enables the same run and also
 * covers a tile, so idling is never the faster choice.
 */
export function idlingEnablesARun(agility: number, weightGrams: number): boolean {
    return runEnergyRecover(agility) > 0 && runEnergyLoss(weightGrams) > 0;
}

export interface CoverResult {
    ticks: number;
    energy: number;
    runTicks: number;
    recoverTicks: number;
}

/**
 * Fastest way to cover `steps` single-tile steps. Run while energy is above
 * 0 at the start of the tick. The tick that hits 0 still takes two steps.
 * A leftover single step does not drain.
 */
export function coverSteps(
    steps: number,
    energy: number,
    agility: number,
    weightGrams: number
): CoverResult {
    const loss = runEnergyLoss(weightGrams);
    const recover = runEnergyRecover(agility);
    let left = Math.max(0, steps);
    let e = Math.max(0, Math.min(ENERGY_MAX, energy));
    let ticks = 0;
    let runTicks = 0;
    let recoverTicks = 0;
    while (left > 0) {
        if (e > 0 && left >= 2) {
            left -= 2;
            e = Math.max(0, e - loss);
            runTicks++;
        } else {
            left -= 1;
            e = Math.min(ENERGY_MAX, e + recover);
            recoverTicks++;
        }
        ticks++;
    }
    return { ticks, energy: e, runTicks, recoverTicks };
}

export type TripEvent =
    | { type: 'move'; steps: number; weightGrams: number }
    | { type: 'idle'; ticks: number }
    | { type: 'locked'; ticks: number };

export interface TripClock {
    ticks: number;
    ms: number;
    energy: number;
    runTicks: number;
    recoverTicks: number;
    lockedTicks: number;
    /** Every move tick was a 2-step run. A trailing single step still counts as recover. */
    ranEveryPair: boolean;
}

export function timeTrip(events: TripEvent[], energy: number, agility: number): TripClock {
    let e = Math.max(0, Math.min(ENERGY_MAX, energy));
    let ticks = 0;
    let runTicks = 0;
    let recoverTicks = 0;
    let lockedTicks = 0;
    let ranEveryPair = true;
    for (const event of events) {
        if (event.type === 'locked') {
            const n = Math.max(0, event.ticks);
            ticks += n;
            lockedTicks += n;
            continue;
        }
        if (event.type === 'idle') {
            const n = Math.max(0, event.ticks);
            const recover = runEnergyRecover(agility);
            for (let i = 0; i < n; i++) e = Math.min(ENERGY_MAX, e + recover);
            ticks += n;
            recoverTicks += n;
            continue;
        }
        const covered = coverSteps(event.steps, e, agility, event.weightGrams);
        if (covered.recoverTicks > (event.steps % 2)) ranEveryPair = false;
        e = covered.energy;
        ticks += covered.ticks;
        runTicks += covered.runTicks;
        recoverTicks += covered.recoverTicks;
    }
    return { ticks, ms: ticks * TICK_MS, energy: e, runTicks, recoverTicks, lockedTicks, ranEveryPair };
}

/** Runes crafted per essence. `level / multiplier + 1` in `runecraft.rs2`. */
export function runesPerEssence(rcLevel: number, multiplier = AIR_MULTIPLIER): number {
    return Math.max(1, ((rcLevel / multiplier) | 0) + 1);
}

export function carriedGrams(essence: number, rcLevel: number, wornGrams = 0): { out: number; back: number } {
    const per = runesPerEssence(rcLevel);
    return {
        out: wornGrams + AIR_TALISMAN_GRAMS + essence * ESSENCE_GRAMS,
        back: wornGrams + AIR_TALISMAN_GRAMS + essence * per * AIR_RUNE_GRAMS
    };
}

export interface AirSteps {
    outboundSteps: number;
    toAltarSteps: number;
    toPortalSteps: number;
    returnSteps: number;
}

/**
 * Bot-visible gaps, counted from the op tick.
 *
 * `p_delay(n)` sets `delayedUntil = tick + 1 + n` and the script resumes on
 * that tick, before movement. The op tick and every tick before resume are
 * locked. The resume tick is spent standing while the next click is sent.
 *
 * Enter is `p_delay(1)` then the teleport. Craft is `p_delay(3)`. The exit
 * portal teleports on the op tick with no delay.
 */
export function airTripEvents(steps: AirSteps, grams: { out: number; back: number }): TripEvent[] {
    return [
        { type: 'idle', ticks: 1 },
        { type: 'move', steps: steps.outboundSteps, weightGrams: grams.out },
        { type: 'locked', ticks: 2 },
        { type: 'idle', ticks: 1 },
        { type: 'move', steps: steps.toAltarSteps, weightGrams: grams.out },
        { type: 'locked', ticks: 4 },
        { type: 'idle', ticks: 1 },
        { type: 'move', steps: steps.toPortalSteps, weightGrams: grams.back },
        { type: 'idle', ticks: 1 },
        { type: 'move', steps: steps.returnSteps, weightGrams: grams.back },
        { type: 'idle', ticks: 1 },
        { type: 'idle', ticks: 1 },
        { type: 'idle', ticks: 1 }
    ];
}

export interface AirCycle extends TripClock {
    essencePerHour: number;
    xpPerHour: number;
}

/** One lap from a closed bank back to the next withdrawn load. */
export function airCycle(
    steps: AirSteps,
    opts: { energy?: number; agility?: number; essence?: number; rcLevel?: number; wornGrams?: number } = {}
): AirCycle {
    const essence = opts.essence ?? 27;
    const rcLevel = opts.rcLevel ?? 1;
    const grams = carriedGrams(essence, rcLevel, opts.wornGrams ?? 0);
    const clock = timeTrip(airTripEvents(steps, grams), opts.energy ?? ENERGY_MAX, opts.agility ?? 1);
    const hours = clock.ms / 3_600_000;
    const xpEach = AIR_XP_TENTHS / 10;
    return {
        ...clock,
        essencePerHour: hours > 0 ? essence / hours : 0,
        xpPerHour: hours > 0 ? (essence * xpEach) / hours : 0
    };
}
