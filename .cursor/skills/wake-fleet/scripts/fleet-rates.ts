/**
 * Shared rate math for fleet-report and fleet-status.
 * Consumes heartbeat JSONL records; never reads whole log files.
 */

export interface HeartbeatRecord {
    t: number;
    session: number;
    job: string;
    xp: Record<string, number>;
    /** Client `baseLevel`. Absent on snapshots written before this field existed. */
    levels?: Record<string, number>;
    coins: number;
    x: number;
    z: number;
    pid?: number;
    phase?: string;
    lastProgressAt?: number;
    lastEffectAt?: number | null;
    recoveries?: number;
    stopped?: string | null;
}

export interface ActivityEvent {
    t: number;
    pid?: number;
    session?: number;
    type: 'start' | 'progress' | 'failure' | 'recovery' | 'stop';
    kind?: string;
    code?: string;
    count?: number;
    tactic?: string;
    restartable?: boolean;
    phase?: string;
    x?: number;
    z?: number;
    message?: string;
}

export interface RateResult {
    xpPerHour: Record<string, number>;
    gpPerHour: number;
    windowMs: number;
    recordCount: number;
}

export const MIN_RATE_WINDOW_MS = 10 * 60 * 1000;
export const EFFECT_KINDS = new Set(['xp', 'inventory', 'bank', 'shop', 'trade']);

const LEVEL_SHORT: Array<[string, string]> = [
    ['Attack', 'Atk'],
    ['Strength', 'Str'],
    ['Defence', 'Def'],
    ['Hitpoints', 'HP'],
    ['Ranged', 'Rng'],
    ['Magic', 'Mag'],
    ['Fishing', 'Fish'],
    ['Cooking', 'Cook'],
    ['Thieving', 'Thv'],
    ['Mining', 'Mine'],
];

/** Case-insensitive lookup. Heartbeats use `Fishing`; some callers pass `fishing`. */
export function skillLookup<T>(map: Record<string, T> | undefined | null, name: string): T | undefined {
    if (!map) return undefined;
    if (Object.prototype.hasOwnProperty.call(map, name)) return map[name];
    const want = name.toLowerCase();
    for (const [key, value] of Object.entries(map)) {
        if (key.toLowerCase() === want) return value;
    }
    return undefined;
}

/** Newest valid snapshot's client levels, or null when the field is missing. */
export function latestLevels(records: HeartbeatRecord[]): Record<string, number> | null {
    const valid = records.filter(isValidSnapshot);
    const last = valid[valid.length - 1] ?? records[records.length - 1];
    if (!last?.levels || Object.keys(last.levels).length === 0) return null;
    return last.levels;
}

export function formatCompactLevels(levels: Record<string, number> | null | undefined): string {
    if (!levels) return '';
    const bits: string[] = [];
    const seen = new Set<string>();
    for (const [name, short] of LEVEL_SHORT) {
        const value = skillLookup(levels, name);
        if (value == null) continue;
        bits.push(`${short}${value}`);
        seen.add(name.toLowerCase());
    }
    for (const [name, value] of Object.entries(levels)) {
        if (seen.has(name.toLowerCase())) continue;
        if (value < 2) continue;
        bits.push(`${name.slice(0, 4)}${value}`);
    }
    return bits.join(' ');
}

/** Valid snapshots have Hitpoints XP and a real position. Empty startup records are dropped. */
export function isValidSnapshot(record: HeartbeatRecord): boolean {
    const hp = record.xp?.Hitpoints ?? record.xp?.hitpoints ?? 0;
    if (!(hp > 0)) return false;
    if (record.x === 0 && record.z === 0) return false;
    return true;
}

/** Pick records within windowMs ending at `now`. */
export function recordsInWindow(records: HeartbeatRecord[], windowMs: number, now = Date.now()): HeartbeatRecord[] {
    const cutoff = now - windowMs;
    return records.filter((r) => r.t >= cutoff);
}

function consider(best: number | null, t: number | null | undefined): number | null {
    if (t == null || !Number.isFinite(t) || t <= 0) return best;
    if (best == null || t > best) return t;
    return best;
}

/**
 * Newest effect time: snapshot `lastEffectAt`, an in-session XP or coins increase,
 * or an effect-kind progress event. Cross-session jumps are not effects.
 */
export function lastEffectAt(records: HeartbeatRecord[], events: ActivityEvent[] = []): number | null {
    let best: number | null = null;
    const valid = records.filter(isValidSnapshot);
    for (const record of valid) best = consider(best, record.lastEffectAt);

    const bySession = new Map<number, HeartbeatRecord[]>();
    for (const record of valid) {
        const list = bySession.get(record.session) ?? [];
        list.push(record);
        bySession.set(record.session, list);
    }
    for (const list of bySession.values()) {
        list.sort((a, b) => a.t - b.t);
        for (let i = 1; i < list.length; i++) {
            const prev = list[i - 1]!;
            const cur = list[i]!;
            const xpUp = Object.keys({ ...prev.xp, ...cur.xp }).some((skill) => (cur.xp[skill] ?? 0) > (prev.xp[skill] ?? 0));
            const coinsUp = (cur.coins ?? 0) > (prev.coins ?? 0);
            if (xpUp || coinsUp) best = consider(best, cur.t);
        }
    }

    for (const event of events) {
        if (event.type === 'progress' && event.kind && EFFECT_KINDS.has(event.kind)) {
            best = consider(best, event.t);
        }
    }
    return best;
}

/**
 * Per-session rates: drop invalid records, sum consecutive-step positive
 * deltas with a per-step plausibility cap, divide by the summed session
 * durations. Null when that duration is under 10 minutes.
 *
 * The cap matters: first->last math lets one corrupt endpoint snapshot
 * (e.g. a 2^31-1 XP sentinel) print billions of XP/hr and mark a stuck bot
 * productive. A step over ~50k XP per 5-min heartbeat gap (600k/hr, above
 * any real grind) or ~50M coins is dropped instead.
 */
export function computeRates(
    records: HeartbeatRecord[],
    windowMs: number,
    now = Date.now()
): RateResult | null {
    const windowed = recordsInWindow(records, windowMs, now).filter(isValidSnapshot);
    const bySession = new Map<number, HeartbeatRecord[]>();
    for (const record of windowed) {
        const list = bySession.get(record.session) ?? [];
        list.push(record);
        bySession.set(record.session, list);
    }

    let duration = 0;
    let count = 0;
    const xpDelta: Record<string, number> = {};
    let gpDelta = 0;
    for (const list of bySession.values()) {
        list.sort((a, b) => a.t - b.t);
        count += list.length;
        if (list.length < 2) continue;
        const first = list[0]!;
        const last = list[list.length - 1]!;
        const elapsed = last.t - first.t;
        if (elapsed <= 0) continue;
        duration += elapsed;
        for (let i = 1; i < list.length; i++) {
            const prev = list[i - 1]!;
            const cur = list[i]!;
            const stepMs = cur.t - prev.t;
            if (stepMs <= 0) continue;
            // Scale the cap by gap so a long offline gap doesn't false-drop.
            const xpCap = Math.max(50_000, (stepMs / 300_000) * 50_000);
            const coinsCap = Math.max(50_000_000, (stepMs / 300_000) * 50_000_000);
            const skills = new Set([...Object.keys(prev.xp), ...Object.keys(cur.xp)]);
            for (const skill of skills) {
                const delta = (cur.xp[skill] ?? 0) - (prev.xp[skill] ?? 0);
                if (delta > 0 && delta <= xpCap) xpDelta[skill] = (xpDelta[skill] ?? 0) + delta;
            }
            const coinsDelta = (cur.coins ?? 0) - (prev.coins ?? 0);
            if (coinsDelta > 0 && coinsDelta <= coinsCap) gpDelta += coinsDelta;
        }
    }
    if (duration < MIN_RATE_WINDOW_MS) return null;
    const hours = duration / 3_600_000;
    const xpPerHour: Record<string, number> = {};
    for (const [skill, delta] of Object.entries(xpDelta)) {
        xpPerHour[skill] = Math.round(delta / hours);
    }
    return {
        xpPerHour,
        gpPerHour: Math.round(gpDelta / hours),
        windowMs: duration,
        recordCount: count,
    };
}

export interface ReassignmentFlag {
    reason: 'maxed_skill' | 'zero_value' | 'capped' | 'intervene';
    detail: string;
}

export function flagMaxedSkill(records: HeartbeatRecord[], trainedSkill?: string): ReassignmentFlag | null {
    if (!trainedSkill || records.length === 0) return null;
    const levels = latestLevels(records);
    const level = skillLookup(levels, trainedSkill);
    if (level != null && level >= 99) {
        return { reason: 'maxed_skill', detail: `${trainedSkill} ${level}` };
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

/** Current launchd `runs` minus the baseline sample. Null when there are no samples. */
export function relaunches1h(
    samples: { t: number; runs: number }[],
    currentRuns: number | null,
    now: number
): number | null {
    if (currentRuns == null || samples.length === 0) return null;
    const cutoff = now - 60 * 60 * 1000;
    const oldEnough = samples.filter((sample) => sample.t <= cutoff);
    const pool = oldEnough.length > 0 ? oldEnough : samples;
    const baseline = pool.reduce((oldest, sample) => (sample.t < oldest.t ? sample : oldest));
    return Math.max(0, currentRuns - baseline.runs);
}
