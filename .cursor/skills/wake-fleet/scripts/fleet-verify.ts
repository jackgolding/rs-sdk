/**
 * Pure check that a restart produced an effect from a new process.
 * Callers poll events.log and heartbeat.log and pass the tails in.
 */
import { isValidSnapshot, lastEffectAt, EFFECT_KINDS, type ActivityEvent, type HeartbeatRecord } from './fleet-rates';

export type VerifyOutcome =
    | { status: 'pending' }
    | { status: 'success'; evidence: string; elapsedMs: number; pid: number }
    | { status: 'failure'; reason: string };

export function formatElapsed(ms: number): string {
    const total = Math.max(0, Math.round(ms / 1000));
    const minutes = Math.floor(total / 60);
    const seconds = total % 60;
    return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

export function parseTimeout(raw: string | undefined, fallbackMs = 10 * 60 * 1000): number {
    if (!raw) return fallbackMs;
    const match = raw.trim().match(/^(\d+)\s*(ms|s|m|h)$/i);
    if (!match) return fallbackMs;
    const n = Number(match[1]);
    switch (match[2]!.toLowerCase()) {
        case 'ms':
            return n;
        case 's':
            return n * 1000;
        case 'h':
            return n * 3_600_000;
        default:
            return n * 60_000;
    }
}

function isNewPid(pid: number | undefined, oldPid: number | null, t: number, t0: number): pid is number {
    return pid != null && pid !== oldPid && t > t0;
}

/**
 * Success: an effect-kind progress event, or an in-session XP/coins increase,
 * from a pid other than oldPid with t > t0. A stop from that pid fails immediately.
 * Location-only progress never succeeds. Timeout fails with the newest failure reason.
 */
export function verifyOutcome(input: {
    events: ActivityEvent[];
    snapshots: HeartbeatRecord[];
    t0: number;
    oldPid: number | null;
    now: number;
    timeoutMs: number;
}): VerifyOutcome {
    const events = input.events.filter((event) => isNewPid(event.pid, input.oldPid, event.t, input.t0));
    const stop = events.find((event) => event.type === 'stop');
    if (stop) {
        const reason = stop.message ? `${stop.code ?? 'stop'}: ${stop.message}` : (stop.code ?? 'stop');
        return { status: 'failure', reason };
    }

    const progress = events.find((event) => event.type === 'progress' && !!event.kind && EFFECT_KINDS.has(event.kind));
    if (progress?.pid != null) {
        return {
            status: 'success',
            evidence: `progress ${progress.kind}`,
            elapsedMs: progress.t - input.t0,
            pid: progress.pid,
        };
    }

    const snaps = input.snapshots
        .filter((record) => isValidSnapshot(record) && isNewPid(record.pid, input.oldPid, record.t, input.t0))
        .sort((a, b) => a.t - b.t);
    const effectAt = lastEffectAt(snaps, []);
    if (effectAt != null) {
        const cur = snaps.find((record) => record.t === effectAt) ?? snaps[snaps.length - 1]!;
        const prev = snaps.filter((record) => record.session === cur.session && record.t < cur.t).at(-1);
        let evidence = 'xp/coins increased';
        if (prev) {
            const skill = Object.keys({ ...prev.xp, ...cur.xp }).find((name) => (cur.xp[name] ?? 0) > (prev.xp[name] ?? 0));
            if (skill) evidence = `${skill} +${(cur.xp[skill] ?? 0) - (prev.xp[skill] ?? 0)} xp`;
            else if ((cur.coins ?? 0) > (prev.coins ?? 0)) evidence = `coins +${(cur.coins ?? 0) - (prev.coins ?? 0)}`;
        }
        return {
            status: 'success',
            evidence,
            elapsedMs: cur.t - input.t0,
            pid: cur.pid!,
        };
    }

    if (input.now - input.t0 >= input.timeoutMs) {
        const failures = events.filter((event) => event.type === 'failure' || event.type === 'stop');
        const newest = failures.sort((a, b) => b.t - a.t)[0];
        const reason = newest
            ? newest.message
                ? `${newest.code ?? newest.type}: ${newest.message}`
                : (newest.code ?? newest.type)
            : 'timeout';
        return { status: 'failure', reason };
    }
    return { status: 'pending' };
}
