/**
 * Long-running activity supervisor: progress clock, bounded recovery,
 * log/warn/error grind lines. See specs/001-autonomous-recovery/.
 */
import type { BotSDK } from './index';
import type { BotActions } from './actions';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { recordScriptAssignment } from './assignment';
import { appendHourlyBankStock } from './bank-stock';
import { appendGrindLog } from './grind-log';
import { jobKeyFromArgv } from './job-key';
import { isIsolatedWalkableTile, isTileWalkable, nearestWalkableTile } from './pathfinding';
import { inWilderness } from './regions';

export type LogLevel = 'log' | 'warn' | 'error';
export type ProgressKind = 'inventory' | 'xp' | 'location' | 'bank' | 'shop' | 'dialog' | 'phase' | 'trade';
export type RecoveryOutcome = 'resumed' | 'exhausted';

export const RESTARTABLE_EXIT_CODE = 70;

/**
 * At most `maxStep` tiles from `from` toward `to`. One longer chord is the
 * walk the client accepts and then never starts.
 */
export function nextWalkStep(
    from: { x: number; z: number },
    to: { x: number; z: number },
    maxStep = 3
): { x: number; z: number } {
    const dx = to.x - from.x;
    const dz = to.z - from.z;
    const distance = Math.hypot(dx, dz);
    if (distance === 0 || distance <= maxStep) return { x: to.x, z: to.z };
    return {
        x: Math.round(from.x + (dx / distance) * maxStep),
        z: Math.round(from.z + (dz / distance) * maxStep),
    };
}

export interface RecoveryTactic {
    name: string;
    run: () => Promise<boolean>;
    /** Max consecutive invocations before advancing to the next tactic (default 2). */
    maxConsecutive?: number;
}

export interface StopReason {
    code: string;
    phase: string;
    lastError: string;
    location: { x: number; z: number; level: number };
    recoveries: number;
    restartable: boolean;
}

/**
 * Where a grind stopped, for the next job to route from. Written by
 * finalizeStop next to grind.log; read by safe-stops at startup. Stops only
 * ever end at a bank (banked: true) or wherever the drain timed out.
 */
export interface ParkRecord {
    x: number;
    z: number;
    level: number;
    banked: boolean;
    bank?: string;
    at: number;
}

export function parkPathFor(grindLogPath: string): string {
    return grindLogPath.replace(/grind\.log$/, 'park.json');
}

/** Last park record, or null when the bot never parked (or the file is gone). */
export function readParkRecord(grindLogPath: string): ParkRecord | null {
    try {
        const path = parkPathFor(grindLogPath);
        if (!existsSync(path)) return null;
        const parsed = JSON.parse(readFileSync(path, 'utf-8')) as ParkRecord;
        if (!Number.isFinite(parsed.x) || !Number.isFinite(parsed.z)) return null;
        return parsed;
    } catch {
        return null;
    }
}

export interface ActivityConfig {
    name: string;
    stallMs?: number;
    repeatFailCount?: number;
    repeatFailWindowMs?: number;
    maxRecoveryTactics?: number;
    recoveryBudgetMs?: number;
    grindLogPath?: string;
    /** Interval for progress snapshots (default 5 min). 0 disables. */
    heartbeatMs?: number;
    heartbeatPath?: string;
    /** Structured events file. Defaults to grind.log's sibling events.log. */
    eventsPath?: string;
    /** Test injection. When set, events are not also written to eventsPath. */
    eventsWrite?: (line: string) => void;
    /** Overrides the launch-command job key. Tests and unusual runners set this. */
    jobKey?: string;
    /** Named gain file. Defaults to grind.log's sibling gains.log. */
    gainsPath?: string;
    /** Test injection. When set, gains are not also written to gainsPath. */
    gainsWrite?: (line: string) => void;
    /** Repo root for hourly bank-stock lines. Tests point this at a temp directory. */
    stockRoot?: string;
    /** Test injection for the snapshot timer. Production uses the global timers. */
    timer?: {
        setInterval: (fn: () => void, ms: number) => unknown;
        clearInterval: (id: unknown) => void;
    };
    /**
     * How long the client may stay disconnected or stale before the grind
     * exits 70 (default 10 min). A short gateway or login blip used to exit
     * at 90s, launchd relaunched every 30s, and the 4/hour cap turned the
     * bot off for the rest of the hour.
     */
    reconnectGiveUpMs?: number;
    /**
     * State older than this is treated as a dead client (default 90s).
     * The process keeps waiting until `reconnectGiveUpMs`.
     */
    staleStateMs?: number;
    /** Test injection. Production calls `process.exit`. */
    exitProcess?: (code: number) => void;
    /** Optional safe-park step before a restartable exit (e.g. deposit loot). */
    park?: RecoveryTactic;
    now?: () => number;
    writeLog?: (line: string) => void;
}

export interface ActivityMetrics {
    phase: string;
    trips: number;
    itemsBanked: number;
    stallMs: number;
    recoveries: number;
    stopReason: StopReason | null;
    lastSeverity: LogLevel;
}

const LEVEL_TOKEN: Record<LogLevel, string> = {
    log: 'LOG',
    warn: 'WARN',
    error: 'ERROR',
};

const EFFECT_KINDS = new Set<ProgressKind>(['xp', 'inventory', 'bank', 'shop', 'trade']);
const PROGRESS_EVENT_KINDS = new Set<ProgressKind>(['xp', 'inventory', 'bank', 'shop', 'trade', 'location']);
const PROGRESS_EVENT_MIN_MS = 30_000;

export class ActivitySession {
    /**
     * Live sessions, so a process signal can ask every grind to drain to a
     * bank instead of dying mid-route. runner.ts calls requestStopAll on
     * SIGTERM/SIGINT; scripts observe stopRequested at stage boundaries.
     */
    private static readonly live = new Set<ActivitySession>();

    /** Ask every live session to finish its stage and bank. Never throws. */
    static requestStopAll(reason: string): void {
        for (const session of ActivitySession.live) {
            try {
                session.requestStop(reason);
            } catch {
                /* draining is best effort */
            }
        }
    }

    readonly name: string;
    private readonly stallMs: number;
    private readonly repeatFailCount: number;
    private readonly repeatFailWindowMs: number;
    private readonly maxRecoveryTactics: number;
    private readonly recoveryBudgetMs: number;
    private readonly grindLogPath?: string;
    private readonly heartbeatMs: number;
    private readonly heartbeatPath?: string;
    private readonly eventsPath?: string;
    private readonly eventsWrite?: (line: string) => void;
    readonly jobKey: string;
    private readonly gainsPath?: string;
    private readonly gainsWrite?: (line: string) => void;
    private readonly stockRoot?: string;
    private gainsWarned = false;
    private readonly timer: {
        setInterval: (fn: () => void, ms: number) => unknown;
        clearInterval: (id: unknown) => void;
    };
    private snapshotTimer: unknown = null;
    private pollTimer: unknown = null;
    private readonly parkTactic?: RecoveryTactic;
    private readonly sessionStart: number;
    private lastHeartbeatAt = 0;
    private heartbeatWarned = false;
    private readonly nowFn: () => number;
    private readonly writeLogFn?: (line: string) => void;
    private lastEffectAt: number | null = null;
    private readonly failureCounts = new Map<string, number>();
    private readonly progressEventAt = new Map<string, number>();

    private phaseName = '';
    private lastProgressAt: number;
    private lastFailure: { code: string; message: string; at: number } | null = null;
    private failureTimes = new Map<string, number[]>();
    private recoveryTacticsUsed = 0;
    private recoveryStartedAt: number | null = null;
    private stopReasonValue: StopReason | null = null;
    /** Set by requestStop (SIGTERM): finish the stage, bank, then exit. */
    private stopRequestedAt: number | null = null;
    private stopRequestedReason = '';
    /** True once drainToBank deposited (written to park.json by finalizeStop). */
    private bankedAtStop: { bank: string } | null = null;
    private tripCount = 0;
    private itemsBankedCount = 0;
    private stallAccumMs = 0;
    private lastSeverity: LogLevel = 'log';
    private tactics: RecoveryTactic[] = [];
    private nextTacticIndex = 0;
    private lastTacticName: string | null = null;
    private consecutiveTacticCount = 0;
    private anchor: { x: number; z: number } | null = null;
    /** Last tile that was allowed to count as location progress. */
    private lastLocationTile: { x: number; z: number; level: number } | null = null;
    private sampleCounts = new Map<string, number>();
    private unsubscribeConnection: (() => void) | null = null;
    private reconnectDeadline: unknown = null;
    private stalePoll: unknown = null;
    private controllerDownMessage: string | null = null;
    /** Set when tactics are used up. The grind stays up and should switch approach. */
    private fallbackPending = false;
    private readonly reconnectGiveUpMs: number;
    private readonly staleStateMs: number;
    private readonly exitProcess: (code: number) => void;

    constructor(
        private readonly sdk: BotSDK,
        private readonly bot: BotActions,
        config: ActivityConfig
    ) {
        if (!config.name?.trim()) {
            throw new Error('ActivitySession requires a name');
        }
        this.name = config.name.trim();
        this.stallMs = config.stallMs ?? 120_000;
        this.repeatFailCount = config.repeatFailCount ?? 5;
        this.repeatFailWindowMs = config.repeatFailWindowMs ?? 120_000;
        this.maxRecoveryTactics = config.maxRecoveryTactics ?? 4;
        this.recoveryBudgetMs = config.recoveryBudgetMs ?? 180_000;
        this.grindLogPath = config.grindLogPath;
        this.nowFn = config.now ?? (() => Date.now());
        this.writeLogFn = config.writeLog;
        this.heartbeatMs = config.heartbeatMs ?? (config.grindLogPath ? 300_000 : 0);
        this.heartbeatPath =
            config.heartbeatPath ??
            (config.grindLogPath
                ? config.grindLogPath.replace(/grind\.log$/, 'heartbeat.log')
                : undefined);
        this.eventsPath =
            config.eventsPath ??
            (config.grindLogPath ? config.grindLogPath.replace(/grind\.log$/, 'events.log') : undefined);
        this.eventsWrite = config.eventsWrite;
        this.jobKey =
            config.jobKey?.trim() ||
            jobKeyFromArgv(process.argv, process.env.BOT_USERNAME) ||
            this.name;
        this.gainsPath =
            config.gainsPath ??
            (config.grindLogPath ? config.grindLogPath.replace(/grind\.log$/, 'gains.log') : undefined);
        this.gainsWrite = config.gainsWrite;
        this.stockRoot = config.stockRoot;
        this.timer = config.timer ?? {
            setInterval: (fn, ms) => setInterval(fn, ms),
            clearInterval: (id) => clearInterval(id as ReturnType<typeof setInterval>),
        };
        this.reconnectGiveUpMs = config.reconnectGiveUpMs ?? 10 * 60_000;
        this.staleStateMs = config.staleStateMs ?? 90_000;
        this.exitProcess = config.exitProcess ?? ((code) => process.exit(code));
        this.parkTactic = config.park;
        this.sessionStart = this.nowFn();
        this.lastProgressAt = this.nowFn();
        this.registerDefaultTactics();
        ActivitySession.live.add(this);
        // Production grind scripts pass grindLogPath; tests do not. Recording
        // here covers every ActivitySession caller without a per-script snippet.
        if (config.grindLogPath) recordScriptAssignment();
        this.emitEvent({ type: 'start', message: this.name });
        if (this.heartbeatPath && this.heartbeatMs > 0) {
            this.armSnapshotTimers();
        }
        this.armControllerWatch(config);
    }

    /** Extra tactics run after the defaults (close UI, step off, re-walk). */
    registerRecovery(tactics: RecoveryTactic[]): void {
        this.tactics.push(...tactics);
    }

    /** Phase re-walk target used by the default `rewalk` tactic. */
    setAnchor(x: number, z: number): void {
        this.anchor = { x, z };
    }

    /**
     * Sets the current step. A phase change refreshes the in-script stall
     * timer so a long walk is not interrupted. Repeating the same phase does
     * not: that is how a stuck loop used to look busy. Does not clear failure
     * counters, end a recovery, or count as an effect.
     */
    async setPhase(phase: string): Promise<void> {
        const changed = phase !== this.phaseName;
        this.phaseName = phase;
        await this.showIntent(phase.replace(/_/g, ' '));
        if (changed) this.lastProgressAt = this.nowFn();
        this.log('log', `phase ${phase}`);
    }

    /**
     * Records observed progress. A non-phase kind exits an in-progress recovery.
     * Effect kinds also move lastEffectAt. A location note whose tile has not
     * changed since the last credited location note is ignored.
     */
    noteProgress(kind: ProgressKind, detail?: string): void {
        if (kind === 'location' && !this.tileAdvanced()) return;
        this.creditProgress(kind, detail);
    }

    /** Stall refresh for a tactic that reported success, even if the tile did not change. */
    private creditProgress(kind: ProgressKind, detail?: string): void {
        this.lastProgressAt = this.nowFn();
        if (kind !== 'phase') {
            if (this.recoveryStartedAt !== null) {
                this.stallAccumMs += this.nowFn() - this.recoveryStartedAt;
            }
            this.recoveryStartedAt = null;
            this.recoveryTacticsUsed = 0;
            this.nextTacticIndex = 0;
            this.failureTimes.clear();
        }
        if (EFFECT_KINDS.has(kind)) this.lastEffectAt = this.nowFn();
        this.emitProgress(kind, detail);
    }

    /** True the first time, and whenever the player tile differs from the last credited location. */
    private tileAdvanced(): boolean {
        const player = this.sdk.getState()?.player;
        const tile = {
            x: player?.worldX ?? 0,
            z: player?.worldZ ?? 0,
            level: player?.level ?? 0,
        };
        const previous = this.lastLocationTile;
        this.lastLocationTile = tile;
        if (!previous) return true;
        return previous.x !== tile.x || previous.z !== tile.z || previous.level !== tile.level;
    }

    /** Records a failure; five identical codes in the window arm recovery. */
    noteFailure(code: string, message: string): void {
        const now = this.nowFn();
        this.lastFailure = { code, message, at: now };
        const times = (this.failureTimes.get(code) ?? []).filter((t) => now - t < this.repeatFailWindowMs);
        times.push(now);
        this.failureTimes.set(code, times);
        const count = (this.failureCounts.get(code) ?? 0) + 1;
        this.failureCounts.set(code, count);
        this.emitEvent({ type: 'failure', code, count, message });
        this.log('warn', `${code}: ${message}`);
    }

    /** True when stalled or repeat-failed, and the session has not stopped. */
    needsRecovery(): boolean {
        if (this.stopReasonValue) return false;
        const now = this.nowFn();
        if (now - this.lastProgressAt >= this.stallMs) return true;
        for (const times of this.failureTimes.values()) {
            const recent = times.filter((t) => now - t < this.repeatFailWindowMs);
            if (recent.length >= this.repeatFailCount) return true;
        }
        return false;
    }

    /**
     * Runs remaining tactics until progress, budget, or the list ends.
     * After exhaust, no further walk/interact/bank packets are sent.
     */
    /**
     * True once after tactics are used up. The session is still running;
     * the caller should switch to another productive approach.
     */
    consumeFallback(): boolean {
        const pending = this.fallbackPending;
        this.fallbackPending = false;
        return pending;
    }

    async recover(): Promise<RecoveryOutcome> {
        if (this.stopReasonValue) return 'exhausted';
        if (this.fallbackPending) return 'resumed';
        if (this.tactics.length === 0) {
            throw new Error(`ActivitySession "${this.name}" has no recovery tactics`);
        }
        const now = this.nowFn();
        if (this.recoveryStartedAt === null) {
            this.recoveryStartedAt = now;
            this.nextTacticIndex = 0;
            this.recoveryTacticsUsed = 0;
        }
        this.log('warn', `Recovering: ${this.lastFailure?.code ?? 'stall'} phase=${this.phaseName || 'idle'}`);

        while (this.nextTacticIndex < this.tactics.length) {
            if (this.budgetExhausted()) {
                return this.continueAfterRecovery(this.lastFailure?.message ?? 'recovery budget exhausted');
            }
            const tactic = this.tactics[this.nextTacticIndex]!;
            const maxConsecutive = tactic.maxConsecutive ?? 2;
            if (this.lastTacticName === tactic.name && this.consecutiveTacticCount >= maxConsecutive) {
                this.nextTacticIndex++;
                this.lastTacticName = null;
                this.consecutiveTacticCount = 0;
                continue;
            }
            if (this.lastTacticName === tactic.name) {
                this.consecutiveTacticCount++;
            } else {
                this.lastTacticName = tactic.name;
                this.consecutiveTacticCount = 1;
            }
            this.nextTacticIndex++;
            this.recoveryTacticsUsed++;
            await this.showIntent(`Recovering: ${tactic.name}`);
            this.log('warn', `recovery tactic ${tactic.name} (${this.recoveryTacticsUsed}/${this.maxRecoveryTactics})`);
            this.emitEvent({ type: 'recovery', tactic: tactic.name, message: tactic.name });
            const resumed = await tactic.run();
            if (this.stopReasonValue) return 'exhausted';
            if (resumed) {
                // Gate on actual tile advance: creditProgress bypasses the
                // tileAdvanced guard, so a tactic reporting success without
                // moving reset the stall clock while the bot never closed.
                this.noteProgress('location', `recovered:${tactic.name}`);
                this.lastTacticName = null;
                this.consecutiveTacticCount = 0;
                return 'resumed';
            }
        }

        return this.continueAfterRecovery(this.lastFailure?.message ?? 'no tactics left');
    }

    /**
     * Tactics failed. Stay on this process and let the route do something
     * else. Exiting 70 here relaunches the same stuck lap until the hourly
     * cap, which is how the fleet turns itself off.
     */
    private continueAfterRecovery(message: string): RecoveryOutcome {
        this.log('warn', `recovery exhausted (${message}) — staying up and switching approach`);
        this.emitEvent({ type: 'recovery', tactic: 'fallback', message });
        this.nextTacticIndex = 0;
        this.lastTacticName = null;
        this.consecutiveTacticCount = 0;
        this.recoveryTacticsUsed = 0;
        this.recoveryStartedAt = null;
        this.lastProgressAt = this.nowFn();
        this.failureTimes.clear();
        this.fallbackPending = true;
        return 'resumed';
    }

    /** Local game-chat intent; never sent to other players. */
    async showIntent(message: string): Promise<void> {
        await this.sdk.showIntent(message);
    }

    /** True after {@link stop} or a recovery exhaust. */
    isStopped(): boolean {
        return this.stopReasonValue !== null;
    }

    /** Records a terminal stop reason and writes an error grind-log line. */
    stop(code: string, message: string, opts?: { restartable?: boolean }): void {
        if (this.stopReasonValue) return;
        const p = this.sdk.getState()?.player;
        const restartable = opts?.restartable ?? code === 'script_error';
        this.stopReasonValue = {
            code,
            phase: this.phaseName,
            lastError: message,
            location: { x: p?.worldX ?? 0, z: p?.worldZ ?? 0, level: p?.level ?? 0 },
            recoveries: this.recoveryTacticsUsed,
            restartable,
        };
        this.emitEvent({ type: 'stop', code, restartable, message });
        this.log('error', `${code} ${message} phase=${this.phaseName} @ ${p?.worldX ?? 0},${p?.worldZ ?? 0}`);
    }

    /** Stop with restartable exit semantics (launchd KeepAlive will restart). */
    stopRestartable(code: string, message: string): void {
        this.stop(code, message, { restartable: true });
    }

    /**
     * External stop request (SIGTERM from launchd stop, job switch). Does NOT
     * stop the loop: the script finishes its current stage, banks via
     * drainToBank, then exits from a bank. Idempotent.
     */
    requestStop(reason: string): void {
        if (this.stopReasonValue || this.stopRequestedAt !== null) return;
        this.stopRequestedAt = this.nowFn();
        this.stopRequestedReason = reason;
        this.log('warn', `stop requested (${reason}) — finishing stage, then banking`);
    }

    /** True after requestStop and before stop. Check at stage boundaries. */
    get stopRequested(): boolean {
        return this.stopRequestedAt !== null && this.stopReasonValue === null;
    }

    /** Loop condition for drain-aware grinds: `while (!session.isStoppedOrRequested())`. */
    isStoppedOrRequested(): boolean {
        return this.stopReasonValue !== null || this.stopRequestedAt !== null;
    }

    /**
     * Interrupt-and-bank: run one more productive stage at a time (onStage),
     * then deposit via bank(), until banked or the deadline passes. The
     * stage callback lets a law run craft its essence before walking out —
     * stopping never strands a full inventory mid-route.
     *
     * Returns 'banked' (park.json records the bank), 'timeout', or 'failed'.
     * Never throws; a wedged drain must still exit, not hang the process.
     */
    async drainToBank(
        bank: () => Promise<boolean>,
        opts?: { deadlineMs?: number; onStage?: () => Promise<unknown> }
    ): Promise<'banked' | 'timeout' | 'failed'> {
        const deadlineMs = opts?.deadlineMs ?? 120_000;
        const start = this.nowFn();
        const remaining = () => deadlineMs - (this.nowFn() - start);
        try {
            for (;;) {
                if (remaining() <= 0) {
                    this.log('warn', `drain timed out after ${deadlineMs}ms @ ${this.tileText()}`);
                    return 'timeout';
                }
                // Banking needs a live controller. Waiting for the reconnect
                // beats spinning failed attempts through a dead socket — a
                // drain observed mid-flap used to burn its whole deadline
                // without sending a single packet.
                if (!this.sdk.isConnected()) {
                    try {
                        await this.sdk.waitForConnection(Math.max(0, remaining()));
                    } catch {
                        this.log('warn', `drain: SDK never reconnected @ ${this.tileText()}`);
                        return 'timeout';
                    }
                    continue;
                }
                let banked = false;
                try {
                    banked = await bank();
                } catch {
                    banked = false;
                }
                if (banked) {
                    this.bankedAtStop = { bank: this.phaseName || 'bank' };
                    this.noteProgress('bank', 'drain');
                    return 'banked';
                }
                if (!opts?.onStage || remaining() <= 0) {
                    if (!opts?.onStage) this.log('warn', `drain: bank not reached @ ${this.tileText()}`);
                    else this.log('warn', `drain timed out after ${deadlineMs}ms @ ${this.tileText()}`);
                    this.writeParkRecord();
                    return !opts?.onStage ? 'failed' : 'timeout';
                }
                try {
                    await opts.onStage();
                } catch {
                    /* one more stage is best effort */
                }
                // Checkpoint every stage: a kill mid-drain still leaves a
                // fresh (unbanked) position for the next job to route from.
                this.writeParkRecord();
            }
        } catch {
            return 'failed';
        }
    }

    private tileText(): string {
        const p = this.sdk.getState()?.player;
        return `${p?.worldX ?? 0},${p?.worldZ ?? 0}`;
    }

    /** Exit code scripts should honor before disconnect (70 = restartable, 0 = terminal). */
    exitCode(): number {
        if (!this.stopReasonValue) return 0;
        return this.stopReasonValue.restartable ? RESTARTABLE_EXIT_CODE : 0;
    }

    /**
     * Safe-park, final heartbeat, park record, and process.exitCode before
     * disconnect. Grind routes should call this after their main loop when
     * session.isStopped(). A graceful external stop exits 0 (stopped means
     * stopped — launchd must NOT relaunch it); only restartable reasons do.
     */
    async finalizeStop(): Promise<void> {
        ActivitySession.live.delete(this);
        if (!this.stopReasonValue) return;
        if (this.stopReasonValue.restartable) {
            await this.safePark();
        }
        this.writeParkRecord();
        this.clearSnapshotTimers();
        this.clearControllerWatch();
        this.writeHeartbeat();
        process.exitCode = this.exitCode();
    }

    /** Where this stop ended, so the next job can route from here. Best effort. */
    private writeParkRecord(): void {
        if (!this.grindLogPath) return;
        const p = this.sdk.getState()?.player;
        const record: ParkRecord = {
            x: p?.worldX ?? this.stopReasonValue?.location.x ?? 0,
            z: p?.worldZ ?? 0,
            level: p?.level ?? 0,
            banked: this.bankedAtStop !== null,
            ...(this.bankedAtStop ? { bank: this.bankedAtStop.bank } : {}),
            at: this.nowFn(),
        };
        try {
            writeFileSync(parkPathFor(this.grindLogPath), `${JSON.stringify(record)}\n`);
        } catch {
            /* a missing park record only costs the next job a longer walk */
        }
    }

    /** Dismiss trade/modals and run optional park tactic before a restartable exit. */
    async safePark(): Promise<void> {
        try {
            await this.bot.declineTrade();
        } catch {
            /* no trade open */
        }
        try {
            await this.bot.closeInterface();
            await this.bot.dismissBlockingUI();
        } catch {
            /* best effort */
        }
        if (this.parkTactic) {
            try {
                await this.parkTactic.run();
            } catch {
                /* park failure never blocks exit */
            }
        }
    }

    /**
     * Compatibility no-op while the snapshot timer is running.
     * Grind loops may still call it; the timer owns the writes.
     */
    maybeHeartbeat(): void {
        if (this.snapshotTimer != null) return;
        if (!this.heartbeatPath || this.heartbeatMs <= 0 || this.stopReasonValue) return;
        this.writeHeartbeat();
    }

    private armSnapshotTimers(): void {
        let tries = 0;
        this.pollTimer = this.timer.setInterval(() => {
            tries++;
            if (this.writeHeartbeat() || tries >= 60) this.clearPoll();
        }, 1_000);
        this.snapshotTimer = this.timer.setInterval(() => {
            this.writeHeartbeat();
        }, this.heartbeatMs);
        this.unref(this.pollTimer);
        this.unref(this.snapshotTimer);
    }

    private unref(handle: unknown): void {
        const timer = handle as { unref?: () => void } | null;
        if (timer && typeof timer === 'object' && typeof timer.unref === 'function') timer.unref();
    }

    private clearPoll(): void {
        if (this.pollTimer != null) this.timer.clearInterval(this.pollTimer);
        this.pollTimer = null;
    }

    private clearSnapshotTimers(): void {
        this.clearPoll();
        if (this.snapshotTimer != null) this.timer.clearInterval(this.snapshotTimer);
        this.snapshotTimer = null;
        this.clearReconnectDeadline();
    }

    /**
     * Overnight grinds used to sit forever after the gateway dropped them:
     * BotSDK disabled reconnect on pre-emption, a failed reconnect did not
     * always schedule the next attempt, and `waitForCondition` never settled.
     * Launchd saw a live pid with no controller. Wait out a short blip on
     * this process. Exit 70 only after reconnectGiveUpMs so one outage
     * cannot spend the hourly restart cap.
     */
    private armControllerWatch(config: ActivityConfig): void {
        if (!config.grindLogPath && !config.exitProcess) return;
        const subscribe = this.sdk.onConnectionStateChange?.bind(this.sdk);
        if (typeof subscribe === 'function') {
            this.unsubscribeConnection = subscribe((state) => {
                if (this.stopReasonValue) return;
                if (state === 'connected') {
                    this.clearReconnectDeadline();
                    return;
                }
                if (state === 'reconnecting') {
                    this.armReconnectDeadline('SDK reconnect did not finish');
                    return;
                }
                if (state === 'disconnected') {
                    this.armReconnectDeadline('SDK controller disconnected');
                }
            });
        }
        this.stalePoll = this.timer.setInterval(() => this.checkStateLiveness(), 15_000);
        this.unref(this.stalePoll);
    }

    private checkStateLiveness(): void {
        if (this.stopReasonValue) return;
        const getAge = this.sdk.getStateAge?.bind(this.sdk);
        if (typeof getAge !== 'function') return;
        const receivedAt = this.sdk.getStateReceivedAt?.() ?? 0;
        if (receivedAt === 0) {
            if (this.nowFn() - this.sessionStart > this.staleStateMs) {
                this.armReconnectDeadline('SDK never received state');
            }
            return;
        }
        const age = getAge();
        if (age > this.staleStateMs) {
            this.armReconnectDeadline(`SDK state ${Math.round(age / 1000)}s stale`);
            return;
        }
        if (this.reconnectDeadline != null) {
            this.clearReconnectDeadline();
            this.log('log', 'controller back');
        }
    }

    private armReconnectDeadline(message: string): void {
        if (this.stopReasonValue || this.reconnectDeadline != null) return;
        this.controllerDownMessage = message;
        this.log(
            'warn',
            `controller down: ${message} — waiting ${Math.round(this.reconnectGiveUpMs / 1000)}s before relaunch`
        );
        this.reconnectDeadline = this.timer.setInterval(() => {
            this.clearReconnectDeadline();
            if (this.stopReasonValue) return;
            if (this.controllerIsLive()) return;
            this.loseController(this.controllerDownMessage ?? message);
        }, this.reconnectGiveUpMs);
        this.unref(this.reconnectDeadline);
    }

    private controllerIsLive(): boolean {
        const getAge = this.sdk.getStateAge?.bind(this.sdk);
        if (typeof getAge !== 'function') return false;
        const receivedAt = this.sdk.getStateReceivedAt?.() ?? 0;
        if (receivedAt === 0) return false;
        return getAge() <= this.staleStateMs;
    }

    private clearReconnectDeadline(): void {
        if (this.reconnectDeadline != null) this.timer.clearInterval(this.reconnectDeadline);
        this.reconnectDeadline = null;
    }

    private clearControllerWatch(): void {
        this.clearReconnectDeadline();
        if (this.stalePoll != null) this.timer.clearInterval(this.stalePoll);
        this.stalePoll = null;
        this.unsubscribeConnection?.();
        this.unsubscribeConnection = null;
    }

    private loseController(message: string): void {
        if (this.stopReasonValue) return;
        this.stopRestartable('controller_lost', message);
        this.exitProcess(RESTARTABLE_EXIT_CODE);
    }

    /** Writes one snapshot when skills and position are known. Returns whether it wrote. */
    private writeHeartbeat(): boolean {
        if (!this.heartbeatPath) return false;
        const state = this.sdk.getState();
        const player = state?.player;
        const xp: Record<string, number> = {};
        const levels: Record<string, number> = {};
        for (const skill of this.sdk.getSkills()) {
            if (skill.experience > 0) xp[skill.name] = skill.experience;
            const level = skill.baseLevel || skill.level;
            if (level > 0) levels[skill.name] = level;
        }
        const hp = xp.Hitpoints ?? xp.hitpoints ?? 0;
        if (!(hp > 0) || !player || (player.worldX === 0 && player.worldZ === 0)) return false;

        const now = this.nowFn();
        const inv = this.sdk.getInventory();
        const coins = inv.find((i) => /coin/i.test(i.name ?? ''))?.count ?? 0;
        const record = {
            t: now,
            session: this.sessionStart,
            pid: process.pid,
            job: this.name,
            jobKey: this.jobKey,
            xp,
            levels,
            coins,
            x: player.worldX,
            z: player.worldZ,
            phase: this.phaseName,
            lastProgressAt: this.lastProgressAt,
            lastEffectAt: this.lastEffectAt,
            recoveries: this.recoveryTacticsUsed,
            stopped: this.stopReasonValue?.code ?? null,
        };
        try {
            appendGrindLog(this.heartbeatPath, JSON.stringify(record));
            this.lastHeartbeatAt = now;
            return true;
        } catch {
            if (!this.heartbeatWarned) {
                this.heartbeatWarned = true;
                this.log('warn', 'heartbeat write failed');
            }
            return false;
        }
    }

    private emitProgress(kind: ProgressKind, detail?: string): void {
        if (!PROGRESS_EVENT_KINDS.has(kind)) return;
        const now = this.nowFn();
        const prev = this.progressEventAt.get(kind);
        if (prev != null && now - prev < PROGRESS_EVENT_MIN_MS) return;
        this.progressEventAt.set(kind, now);
        this.emitEvent({ type: 'progress', kind, message: detail ?? kind });
    }

    private emitEvent(partial: Record<string, unknown>): void {
        if (!this.eventsPath && !this.eventsWrite) return;
        const player = this.sdk.getState()?.player;
        const message = typeof partial.message === 'string' ? partial.message.slice(0, 200) : partial.message;
        const event = {
            t: this.nowFn(),
            pid: process.pid,
            session: this.sessionStart,
            phase: this.phaseName,
            x: player?.worldX ?? 0,
            z: player?.worldZ ?? 0,
            ...partial,
            message,
        };
        const line = JSON.stringify(event);
        if (this.eventsWrite) {
            this.eventsWrite(line);
            return;
        }
        if (this.eventsPath) {
            try {
                appendGrindLog(this.eventsPath, line);
            } catch {
                /* events must not crash the grind */
            }
        }
    }

    /** Snapshot of phase, trips, stalls, and the current stop reason. */
    metrics(): ActivityMetrics {
        return {
            phase: this.phaseName,
            trips: this.tripCount,
            itemsBanked: this.itemsBankedCount,
            stallMs: this.stallAccumMs,
            recoveries: this.recoveryTacticsUsed,
            stopReason: this.stopReasonValue,
            lastSeverity: this.lastSeverity,
        };
    }

    /**
     * Records one kept stack. Does not sample, and does not move the effect clock.
     * `at` defaults to now. Zero and non-integer counts are ignored.
     */
    recordGain(item: string, count: number, at?: number): void {
        const name = item.trim();
        if (!name || !Number.isInteger(count) || count < 1) return;
        if (!this.gainsPath && !this.gainsWrite) return;
        const record = {
            t: at ?? this.nowFn(),
            session: this.sessionStart,
            pid: process.pid,
            jobKey: this.jobKey,
            item: name,
            count,
        };
        const line = JSON.stringify(record);
        try {
            if (this.gainsWrite) {
                this.gainsWrite(line);
                return;
            }
            if (this.gainsPath) appendGrindLog(this.gainsPath, line);
        } catch {
            if (!this.gainsWarned) {
                this.gainsWarned = true;
                this.log('warn', 'gain write failed');
            }
        }
    }

    /** Writes this hour's bank picture when a bank is already open. Does not open one. */
    captureBankStock(): void {
        const bank = this.sdk.getState()?.bank;
        if (!bank?.isOpen || !bank.items?.length) return;
        const name = process.env.BOT_USERNAME;
        if (!name) return;
        try {
            appendHourlyBankStock(
                name,
                bank.items.map((item) => ({ id: item.id, name: item.name, count: item.count })),
                this.nowFn(),
                this.stockRoot ? { root: this.stockRoot } : undefined
            );
        } catch {
            if (!this.gainsWarned) {
                this.gainsWarned = true;
                this.log('warn', 'bank stock write failed');
            }
        }
    }

    /** Counts a completed bank trip and notes inventory progress. */
    recordTrip(quantity: number): void {
        this.tripCount++;
        this.itemsBankedCount += quantity;
        this.noteProgress('inventory', `trip ${this.tripCount}`);
        this.log('log', `Banked ${quantity} | trip ${this.tripCount} total ${this.itemsBankedCount}`);
    }

    /**
     * Writes a grind-log line. Repeated log/warn lines are sampled; error is never dropped.
     */
    log(level: LogLevel, message: string): void {
        let effective = level;
        let text = message;
        if (level === 'log' && text.startsWith('WARN ')) {
            effective = 'warn';
            text = text.slice('WARN '.length);
        } else if (level === 'log' && text.startsWith('ERROR ')) {
            effective = 'error';
            text = text.slice('ERROR '.length);
        }
        this.lastSeverity = effective;
        const key = `${effective}:${text}`;
        const count = (this.sampleCounts.get(key) ?? 0) + 1;
        this.sampleCounts.set(key, count);
        const sampledAway = effective !== 'error' && count > 1 && count % 10 !== 0;
        if (sampledAway) return;
        const suffix = count > 1 ? ` (×${count})` : '';
        const line = `${new Date(this.nowFn()).toISOString()} ${LEVEL_TOKEN[effective]} ${text}${suffix}`;
        if (this.writeLogFn) {
            this.writeLogFn(line);
        } else {
            console.log(line);
            if (this.grindLogPath) {
                appendGrindLog(this.grindLogPath, line);
            }
        }
    }

    private budgetExhausted(): boolean {
        if (this.recoveryTacticsUsed >= this.maxRecoveryTactics) return true;
        if (this.recoveryStartedAt === null) return false;
        return this.nowFn() - this.recoveryStartedAt >= this.recoveryBudgetMs;
    }

    private registerDefaultTactics(): void {
        this.tactics = [
            {
                name: 'close_ui',
                run: async () => {
                    if (this.stopReasonValue) return false;
                    await this.bot.closeInterface();
                    await this.bot.dismissBlockingUI();
                    return false;
                },
            },
            {
                name: 'step_off',
                run: async () => {
                    if (this.stopReasonValue) return false;
                    const p = this.sdk.getState()?.player;
                    if (!p) return false;
                    const isolated = isIsolatedWalkableTile(p.level, p.worldX, p.worldZ);
                    if (isTileWalkable(p.level, p.worldX, p.worldZ) && !isolated) return false;
                    const step = nearestWalkableTile(p.level, p.worldX, p.worldZ, 8, true);
                    if (!step || (step.x === p.worldX && step.z === p.worldZ)) return false;
                    await this.sdk.sendWalk(step.x, step.z, true);
                    return false;
                },
            },
            {
                name: 'rewalk',
                run: async () => {
                    if (this.stopReasonValue) return false;
                    if (!this.anchor) return false;
                    const p = this.sdk.getState()?.player;
                    // Pathfinder routes wilderness walkTo back to Edgeville or into lava.
                    // One sendWalk across the whole anchor chord never leaves the tile.
                    if (p && inWilderness(p.worldX, p.worldZ)) {
                        const before = { x: p.worldX, z: p.worldZ };
                        const step = nextWalkStep(before, this.anchor, 3);
                        await this.sdk.sendWalk(step.x, step.z, true);
                        const wait = this.sdk.waitForCondition?.bind(this.sdk);
                        if (wait) {
                            await wait(
                                (s) =>
                                    (s.player?.worldX ?? before.x) !== before.x ||
                                    (s.player?.worldZ ?? before.z) !== before.z,
                                4_000
                            ).catch(() => {});
                        }
                        const after = this.sdk.getState()?.player;
                        return !!after && (after.worldX !== before.x || after.worldZ !== before.z);
                    }
                    await this.bot.walkTo(this.anchor.x, this.anchor.z, 2);
                    return false;
                },
            },
        ];
    }
}
