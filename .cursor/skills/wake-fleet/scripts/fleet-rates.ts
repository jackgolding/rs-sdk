/**
 * Shared rate math for fleet-report and fleet-status.
 * Consumes heartbeat JSONL records; never reads whole log files.
 */

export interface HeartbeatRecord {
    t: number;
    session: number;
    job: string;
    xp: Record<string, number>;
    coins: number;
    x: number;
    z: number;
}

export interface RateResult {
    xpPerHour: Record<string, number>;
    gpPerHour: number;
    windowMs: number;
    recordCount: number;
    /** null when insufficient data */
    stallMinutes: number | null;
}

export const ZERO_RATE_MS = 30 * 60 * 1000;
export const BURSTY_ZERO_RATE_MS = 90 * 60 * 1000;
export const MAX_SKILL_XP = 13_034_431; // OSRS level 99 total xp threshold (approx)

export function xpAt99(skill: string, xp: number): boolean {
    return xp >= MAX_SKILL_XP;
}

/** Pick records within windowMs ending at `now`. */
export function recordsInWindow(records: HeartbeatRecord[], windowMs: number, now = Date.now()): HeartbeatRecord[] {
    const cutoff = now - windowMs;
    return records.filter((r) => r.t >= cutoff);
}

export function computeRates(
    records: HeartbeatRecord[],
    windowMs: number,
    now = Date.now()
): RateResult | null {
    const windowed = recordsInWindow(records, windowMs, now);
    if (windowed.length < 2) return null;
    const first = windowed[0]!;
    const last = windowed[windowed.length - 1]!;
    const elapsedMs = last.t - first.t;
    if (elapsedMs <= 0) return null;
    const hours = elapsedMs / 3_600_000;

    const xpPerHour: Record<string, number> = {};
    const allSkills = new Set([...Object.keys(first.xp), ...Object.keys(last.xp)]);
    for (const skill of allSkills) {
        const delta = (last.xp[skill] ?? 0) - (first.xp[skill] ?? 0);
        if (delta !== 0) xpPerHour[skill] = Math.round(delta / hours);
    }
    const gpPerHour = Math.round(((last.coins ?? 0) - (first.coins ?? 0)) / hours);

    return {
        xpPerHour,
        gpPerHour,
        windowMs: elapsedMs,
        recordCount: windowed.length,
        stallMinutes: null,
    };
}

/** True when two records span ≥ threshold with zero xp and coins delta. */
export function isZeroRate(
    records: HeartbeatRecord[],
    bursty: boolean,
    now = Date.now()
): boolean {
    if (records.length < 2) return false;
    const threshold = bursty ? BURSTY_ZERO_RATE_MS : ZERO_RATE_MS;
    const last = records[records.length - 1]!;
    for (let i = 0; i < records.length - 1; i++) {
        const first = records[i]!;
        if (last.t - first.t < threshold) continue;
        const xpUnchanged = Object.keys({ ...first.xp, ...last.xp }).every(
            (s) => (last.xp[s] ?? 0) === (first.xp[s] ?? 0)
        );
        const coinsUnchanged = (last.coins ?? 0) === (first.coins ?? 0);
        if (xpUnchanged && coinsUnchanged) return true;
    }
    return false;
}

export function stallMinutes(records: HeartbeatRecord[], now = Date.now()): number | null {
    if (records.length === 0) return null;
    const last = records[records.length - 1]!;
    return Math.round((now - last.t) / 60_000);
}

export interface ReassignmentFlag {
    reason: 'maxed_skill' | 'zero_value' | 'capped' | 'intervene';
    detail: string;
}

export function flagMaxedSkill(records: HeartbeatRecord[], trainedSkill?: string): ReassignmentFlag | null {
    if (!trainedSkill || records.length === 0) return null;
    const last = records[records.length - 1]!;
    const xp = last.xp[trainedSkill] ?? 0;
    if (xpAt99(trainedSkill, xp)) {
        return { reason: 'maxed_skill', detail: `${trainedSkill} at ${xp} xp (≥99)` };
    }
    return null;
}

export function flagZeroValue(rates: RateResult | null): ReassignmentFlag | null {
    if (!rates) return null;
    const totalXp = Object.values(rates.xpPerHour).reduce((a, b) => a + b, 0);
    if (totalXp === 0 && rates.gpPerHour === 0) {
        return { reason: 'zero_value', detail: '0 xp/hr and 0 gp/hr in window' };
    }
    return null;
}

/** Rough food estimate: fishing xp delta → fish count (lobster ~90 xp, shark ~110). */
export function estimateFishFromXp(xpDelta: number): number {
    if (xpDelta <= 0) return 0;
    return Math.round(xpDelta / 100);
}

export function parseWindowArg(raw: string | undefined, defaultMs: number): number {
    if (!raw) return defaultMs;
    const m = raw.match(/^(\d+)(h|d)$/i);
    if (!m) return defaultMs;
    const n = Number(m[1]);
    if (m[2]!.toLowerCase() === 'h') return n * 3_600_000;
    return n * 24 * 3_600_000;
}
