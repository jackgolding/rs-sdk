/**
 * Pure fleet verdict. One row per bot, first matching check wins.
 * No network, no launchctl, no log IO — callers gather those inputs.
 */
import type { RosterBot } from './roster';
import type { LaunchdInfo } from './launchd-info';
import type { ResolvedOwner } from '../../../../sdk/assignment';
import {
    computeRates,
    isValidSnapshot,
    lastEffectAt,
    relaunches1h,
    type ActivityEvent,
    type HeartbeatRecord,
} from './fleet-rates';

export const CHURN_MAX = 3;
export const SNAPSHOT_INTERVAL_MS = 5 * 60 * 1000;
export const TELEMETRY_SILENT_MS = 2 * SNAPSHOT_INTERVAL_MS;
export const NO_SNAPSHOT_GRACE_MS = 10 * 60 * 1000;
export const SUPPLY_WINDOW_MS = 30 * 60 * 1000;
export const SUPPLY_CODES = new Set(['missing_supplies', 'setup_gear']);
/** Expected trip-cycle failures. Not a stuck loop while the job is producing. */
export const CYCLE_FAILURE_CODES = new Set(['teleport', 'portal']);
const SUPPLY_RE = /no .+ in (bank|inventory)|Cannot restock|out of (food|supplies)/i;

export const VERDICT_KINDS = [
    'producing',
    'alive-not-producing',
    'churning',
    'capped',
    'needs-supplies',
    'needs-client',
    'foreign-owner',
    'finished',
    'restartable',
    'paused',
] as const;

export type VerdictKind = (typeof VERDICT_KINDS)[number];

export interface ShepherdView {
    capped: boolean;
    cappedAt: number | null;
    actions: { t: number; action: string }[];
    restarts?: number[];
}

export interface ClassifyInput {
    bot: RosterBot;
    now: number;
    /**
     * True when record pids live in a container namespace (Docker): the
     * quest script writes its container pid (often 1) while the owner
     * carries the host pid, so pid-matching would discard every record.
     * fleet-status sets this from the supervisor kind; default false
     * preserves the Mac shared-namespace matching.
     */
    containerPids?: boolean;
    gateway: {
        reachable: boolean;
        status?: string;
        inGame?: boolean;
        stateAge?: number | null;
        controllers?: number;
        x?: number | null;
        z?: number | null;
        fetchErr?: string;
    };
    owner: ResolvedOwner | null;
    /** Command from the ownership file even when that process is dead. */
    recordedCommand: string | null;
    launchd: LaunchdInfo;
    runsSamples: { t: number; runs: number }[];
    snapshots: HeartbeatRecord[];
    /** Null when events.log is missing. An empty array means the file exists. */
    events: ActivityEvent[] | null;
    grindTail: string[];
    shepherd: ShepherdView;
}

export interface VerdictRow {
    name: string;
    kind: VerdictKind;
    check: string;
    reason: string;
    restartCommand: string;
    owner: ResolvedOwner | null;
    drift: { owner: string } | null;
    controllers: number;
    stateAge: number | null;
    x: number | null;
    z: number | null;
    minutesSinceEffect: number | null;
    minutesSinceSnapshot: number | null;
    relaunches1h: number | null;
    lastExit: string | null;
    lastStop: { code: string; t: number } | null;
    xpPerHour: Record<string, number>;
    gpPerHour: number | null;
    /** Newest heartbeat's client `baseLevel`. Null when the snapshot has no `levels`. */
    levels: Record<string, number> | null;
    shepherd: { capped: boolean; cappedAt: number | null; actions: { t: number; action: string }[] };
    paused: boolean;
}

export interface FleetSummary {
    producing: string[];
    notProducing: string[];
    byKind: Record<VerdictKind, string[]>;
}

const DISPLAY_ORDER: VerdictKind[] = [
    'needs-client',
    'capped',
    'churning',
    'needs-supplies',
    'foreign-owner',
    'alive-not-producing',
    'finished',
    'restartable',
    'producing',
    'paused',
];

export function formatHeadline(producingCount: number, notProducing: string[], opts?: { names?: boolean }): string {
    const base = `${producingCount} producing, ${notProducing.length} not producing`;
    if (opts?.names && notProducing.length > 0) return `${base}: ${notProducing.join(', ')}`;
    return base;
}

export function summarize(rows: VerdictRow[]): FleetSummary {
    const byKind = Object.fromEntries(VERDICT_KINDS.map((kind) => [kind, [] as string[]])) as Record<VerdictKind, string[]>;
    for (const row of rows) byKind[row.kind].push(row.name);
    return {
        producing: byKind.producing,
        notProducing: rows.filter((row) => row.kind !== 'producing' && row.kind !== 'paused').map((row) => row.name),
        byKind,
    };
}

export function sortRows(rows: VerdictRow[]): VerdictRow[] {
    const rank = new Map(DISPLAY_ORDER.map((kind, index) => [kind, index]));
    return [...rows].sort((a, b) => {
        const aNp = a.kind !== 'producing' && a.kind !== 'paused';
        const bNp = b.kind !== 'producing' && b.kind !== 'paused';
        if (aNp !== bNp) return aNp ? -1 : 1;
        return (rank.get(a.kind) ?? 99) - (rank.get(b.kind) ?? 99) || a.name.localeCompare(b.name);
    });
}

function normalizeLogLine(line: string): string {
    return line
        .replace(/^\d{4}-\d{2}-\d{2}T[\d:.Z]+\s*/, '')
        .replace(/^(LOG|WARN|ERROR)\s+/, '')
        .replace(/\s*\(×\d+\)\s*$/, '')
        .trim();
}

/** Identical lines in the last 12, after stripping severity tokens and `(×N)`. */
export function repeatHeavy(log: string[]): string | null {
    const last = log.slice(-12).map(normalizeLogLine).filter(Boolean);
    if (last.length < 6) return null;
    const counts = new Map<string, number>();
    for (const line of last) counts.set(line, (counts.get(line) ?? 0) + 1);
    let best = '';
    let n = 0;
    for (const [key, value] of counts) {
        if (value > n) {
            best = key;
            n = value;
        }
    }
    if (n >= 6 && /Walking Musa Point|PATHFINDING FAILED|Tomb loot amulet=0/i.test(best)) {
        return `${n}× "${best.slice(0, 80)}"`;
    }
    return null;
}

export function recoveryHigh(log: string[]): string | null {
    for (const line of log.slice().reverse()) {
        const m = line.match(/Recovering:.*?×(\d+)/i);
        if (m && Number(m[1]) >= 20) return `recovery loop ×${m[1]}`;
        const t = line.match(/recovery tactic .*?×(\d+)/i);
        if (t && Number(t[1]) >= 20) return `recovery tactic ×${t[1]}`;
    }
    return null;
}

export function pathfailBurst(log: string[]): boolean {
    return log.filter((line) => /PATHFINDING FAILED/i.test(line)).length >= 8;
}

export function supplyShortage(log: string[]): { count: number; sample: string } | null {
    const hits = log.slice(-40).filter((line) => SUPPLY_RE.test(line));
    if (hits.length < 5) return null;
    return { count: hits.length, sample: normalizeLogLine(hits[hits.length - 1]!).slice(0, 80) };
}

function thresholdMinutes(bot: Pick<RosterBot, 'noEffectMinutes' | 'bursty'>): number {
    if (bot.noEffectMinutes != null && bot.noEffectMinutes >= 1) return bot.noEffectMinutes;
    return bot.bursty ? 90 : 15;
}

function minutesBetween(now: number, at: number | null): number | null {
    if (at == null) return null;
    return (now - at) / 60_000;
}

function snapshotsFor(input: ClassifyInput): HeartbeatRecord[] {
    const valid = input.snapshots.filter(isValidSnapshot);
    if (!input.owner || input.containerPids) return valid;
    return valid.filter((record) => record.pid == null || record.pid === input.owner!.pid);
}

function eventsFor(input: ClassifyInput): ActivityEvent[] {
    const events = input.events ?? [];
    if (!input.owner || input.containerPids) return events;
    return events.filter((event) => event.pid == null || event.pid === input.owner!.pid);
}

function failurePeaks(events: ActivityEvent[], now: number): Map<string, { count: number; message: string }> {
    const cutoff = now - SUPPLY_WINDOW_MS;
    const peaks = new Map<string, { count: number; message: string }>();
    for (const event of events) {
        if (event.type !== 'failure' || !event.code || event.t < cutoff) continue;
        const count = event.count ?? 1;
        const prev = peaks.get(event.code);
        if (!prev || count >= prev.count) {
            peaks.set(event.code, { count, message: event.message ?? event.code });
        }
    }
    return peaks;
}

function scriptName(command: string): string {
    const parts = command.split(/\s+/);
    const script = parts.find((part) => part.endsWith('.ts')) ?? parts[1] ?? command;
    return script.split('/').pop() ?? script;
}

function ownerLabel(owner: ResolvedOwner | null): string {
    if (!owner) return 'no owner';
    return `owner pid ${owner.pid} (${owner.supervised ? 'supervised' : owner.legacy ? 'legacy' : 'manual'})`;
}

export function classify(input: ClassifyInput): VerdictRow {
    const { bot, now, gateway, owner } = input;
    const snaps = snapshotsFor(input);
    const events = eventsFor(input);
    const newest = snaps.reduce<HeartbeatRecord | null>((best, record) => (!best || record.t > best.t ? record : best), null);
    const effectAt = lastEffectAt(snaps, events);
    const minutesSinceSnapshot = minutesBetween(now, newest?.t ?? null);
    const minutesSinceEffect = minutesBetween(now, effectAt);
    const fromRuns = relaunches1h(input.runsSamples, input.launchd.runs ?? null, now);
    const stopEvents = events.filter((event) => event.type === 'stop' && event.t >= now - 60 * 60 * 1000);
    const relaunches = fromRuns == null ? (input.events ? stopEvents.length : null) : Math.max(fromRuns, stopEvents.length);
    const lastStopEvent = [...events].reverse().find((event) => event.type === 'stop');
    const lastStop = lastStopEvent?.code ? { code: lastStopEvent.code, t: lastStopEvent.t } : null;
    const rates = computeRates(snaps, 6 * 3_600_000, now);
    const fresh = gateway.reachable && gateway.inGame === true && gateway.status !== 'dead' && (gateway.stateAge ?? Infinity) <= 8_000;
    const restartCommand = bot.command;
    const liveDrift = owner && owner.command && owner.command !== restartCommand ? owner.command : null;
    const recordedDrift =
        !owner && input.recordedCommand && input.recordedCommand !== restartCommand ? input.recordedCommand : null;
    const driftSource = liveDrift ?? recordedDrift;
    const hourAgo = now - 60 * 60 * 1000;
    const shepherdActions = (input.shepherd.actions ?? []).filter((action) => action.t >= hourAgo);

    const row: VerdictRow = {
        name: bot.name,
        kind: 'restartable',
        check: 'ok',
        reason: '',
        restartCommand,
        owner,
        drift: driftSource ? { owner: driftSource } : null,
        controllers: gateway.controllers ?? 0,
        stateAge: gateway.stateAge ?? null,
        x: fresh ? (gateway.x ?? null) : null,
        z: fresh ? (gateway.z ?? null) : null,
        minutesSinceEffect: minutesSinceEffect == null ? null : Math.round(minutesSinceEffect),
        minutesSinceSnapshot: minutesSinceSnapshot == null ? null : Math.round(minutesSinceSnapshot),
        relaunches1h: relaunches,
        lastExit: input.launchd.lastExit ?? null,
        lastStop,
        xpPerHour: rates?.xpPerHour ?? {},
        gpPerHour: rates?.gpPerHour ?? null,
        levels: newest?.levels && Object.keys(newest.levels).length > 0 ? newest.levels : null,
        shepherd: {
            capped: input.shepherd.capped,
            cappedAt: input.shepherd.cappedAt,
            actions: shepherdActions,
        },
        paused: bot.paused,
    };

    const set = (kind: VerdictKind, check: string, reason: string): VerdictRow => ({ ...row, kind, check, reason });

    if (bot.paused) {
        const why =
            bot.pauseSource === 'food-hub'
                ? 'abg-food-hub.lock (live hub — will not wake until it exits)'
                : 'skip-bots.txt — will not re-wake if stopped';
        return set('paused', 'paused', owner ? `${ownerLabel(owner)} (${why})` : why);
    }

    if (!gateway.reachable) {
        return set('needs-client', 'no_live_state', `gateway unreachable: ${gateway.fetchErr ?? 'no response'}`);
    }
    if (gateway.status === 'dead' || gateway.inGame === false) {
        return set('needs-client', 'logged_out', 'client logged out / session dead — need a browser or lite login');
    }
    if ((gateway.stateAge ?? Infinity) > 8_000) {
        const ageMin = Math.round((gateway.stateAge ?? 0) / 60_000);
        const age = (gateway.stateAge ?? 0) < 60_000 ? `${Math.round((gateway.stateAge ?? 0) / 1000)}s` : `${ageMin}m`;
        return set('needs-client', 'no_live_state', `no live state — gateway snapshot stale (${age} old)`);
    }

    if (input.shepherd.capped) {
        const starts = (input.shepherd.restarts ?? []).filter((t) => now - t < 60 * 60 * 1000).length;
        const when = input.shepherd.cappedAt ? new Date(input.shepherd.cappedAt).toISOString().slice(11, 16) : 'earlier';
        return set('capped', 'capped', `capped ${when}, ${starts} starts/1h; next start when budget allows`);
    }

    if (relaunches != null && relaunches > CHURN_MAX) {
        const stop = lastStop ? `, last stop ${lastStop.code}` : '';
        return set('churning', 'churn', `${relaunches} relaunches/1h${stop}`);
    }

    const peaks = failurePeaks(events, now);
    let supply: { count: number; sample: string } | null = null;
    for (const code of SUPPLY_CODES) {
        const peak = peaks.get(code);
        if (peak && peak.count >= 5) {
            supply = { count: peak.count, sample: peak.message.slice(0, 80) };
            break;
        }
    }
    if (!supply && input.events == null) supply = supplyShortage(input.grindTail);
    if (supply) {
        return set('needs-supplies', 'supplies', `missing_supplies ×${supply.count} "${supply.sample}"`);
    }

    if (owner && owner.supervised === false && row.drift) {
        return set(
            'foreign-owner',
            'foreign_owner',
            `owned by ${scriptName(owner.command)} (manual), roster: ${scriptName(restartCommand)}`
        );
    }

    if (owner) {
        if (row.controllers === 0) {
            return set('alive-not-producing', 'no_controller', `no controller attached, ${ownerLabel(owner)}`);
        }
        const silent = telemetrySilent(input, owner, minutesSinceSnapshot, newest);
        if (silent) return set('alive-not-producing', 'telemetry_silent', silent);
        const loop = detector(input);
        if (loop) return set('alive-not-producing', loop.check, `${loop.reason}, ${ownerLabel(owner)}`);
        const limit = thresholdMinutes(bot);
        if (minutesSinceEffect == null || minutesSinceEffect > limit) {
            const effect = minutesSinceEffect == null ? 'no effect recorded' : `no effect ${Math.round(minutesSinceEffect)}m`;
            const snap = minutesSinceSnapshot == null ? 'no snapshot' : `snapshot ${Math.round(minutesSinceSnapshot)}m old`;
            return set('alive-not-producing', 'no_effect', `${effect}, ${snap}, ${ownerLabel(owner)}`);
        }
        const skill = Object.entries(row.xpPerHour).sort((a, b) => b[1] - a[1])[0];
        const rate = skill ? `, ${skill[0]} ${Math.round(skill[1] / 1000)}k xp/h` : '';
        return set('producing', 'ok', `effect ${Math.round(minutesSinceEffect)}m ago${rate}, ${ownerLabel(owner)}`);
    }

    const exit0 = input.launchd.loaded && (input.launchd.lastExit === '0' || input.launchd.lastExit === '0 ');
    const stopRestartable = lastStopEvent?.restartable === true;
    if (exit0 && !stopRestartable) {
        const why = lastStop ? `stop ${lastStop.code}` : 'no restartable stop';
        return set('finished', 'finished', `last exit 0, ${why}`);
    }

    return set('restartable', 'restartable', 'in-game, no owner — restart roster job');
}

function telemetrySilent(
    input: ClassifyInput,
    owner: ResolvedOwner,
    minutesSinceSnapshot: number | null,
    newest: HeartbeatRecord | null
): string | null {
    if (minutesSinceSnapshot != null && minutesSinceSnapshot * 60_000 > TELEMETRY_SILENT_MS) {
        const rounded = Math.round(minutesSinceSnapshot);
        return `telemetry silent ${rounded}m, snapshot ${rounded}m old, ${ownerLabel(owner)}`;
    }
    if (!newest && owner.startedAt) {
        const uptime = input.now - Date.parse(owner.startedAt);
        if (uptime > NO_SNAPSHOT_GRACE_MS) {
            return `telemetry silent ${Math.round(uptime / 60_000)}m, no snapshot, ${ownerLabel(owner)}`;
        }
    }
    return null;
}

function detector(input: ClassifyInput): { check: string; reason: string } | null {
    const events = eventsFor(input);
    const peaks = failurePeaks(events, input.now);
    if (input.events != null) {
        for (const [code, peak] of peaks) {
            if (SUPPLY_CODES.has(code)) continue;
            if (CYCLE_FAILURE_CODES.has(code)) continue;
            if (peak.count >= 5) return { check: 'repeat', reason: `${code} ×${peak.count}` };
        }
    } else {
        const repeated = repeatHeavy(input.grindTail);
        if (repeated) return { check: 'repeat', reason: repeated };
    }
    const recovery = recoveryHigh(input.grindTail);
    if (recovery) return { check: 'recovery', reason: recovery };
    if (pathfailBurst(input.grindTail)) return { check: 'pathfinding', reason: 'pathfinding failed 8+ times in the last 40 log lines' };
    return null;
}
