/**
 * Long-running activity supervisor: progress clock, bounded recovery,
 * log/warn/error grind lines. See specs/001-autonomous-recovery/.
 */
import type { BotSDK } from './index';
import type { BotActions } from './actions';
import { recordScriptAssignment } from './assignment';
import { appendGrindLog } from './grind-log';
import { isIsolatedWalkableTile, isTileWalkable, nearestWalkableTile } from './pathfinding';
import { inWilderness } from './regions';

export type LogLevel = 'log' | 'warn' | 'error';
export type ProgressKind = 'inventory' | 'xp' | 'location' | 'bank' | 'shop' | 'dialog' | 'phase';
export type RecoveryOutcome = 'resumed' | 'exhausted';

export const RESTARTABLE_EXIT_CODE = 70;

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

export class ActivitySession {
    readonly name: string;
    private readonly stallMs: number;
    private readonly repeatFailCount: number;
    private readonly repeatFailWindowMs: number;
    private readonly maxRecoveryTactics: number;
    private readonly recoveryBudgetMs: number;
    private readonly grindLogPath?: string;
    private readonly heartbeatMs: number;
    private readonly heartbeatPath?: string;
    private readonly parkTactic?: RecoveryTactic;
    private readonly sessionStart: number;
    private lastHeartbeatAt = 0;
    private heartbeatWarned = false;
    private readonly nowFn: () => number;
    private readonly writeLogFn?: (line: string) => void;

    private phaseName = '';
    private lastProgressAt: number;
    private lastFailure: { code: string; message: string; at: number } | null = null;
    private failureTimes = new Map<string, number[]>();
    private recoveryTacticsUsed = 0;
    private recoveryStartedAt: number | null = null;
    private stopReasonValue: StopReason | null = null;
    private tripCount = 0;
    private itemsBankedCount = 0;
    private stallAccumMs = 0;
    private lastSeverity: LogLevel = 'log';
    private tactics: RecoveryTactic[] = [];
    private nextTacticIndex = 0;
    private lastTacticName: string | null = null;
    private consecutiveTacticCount = 0;
    private anchor: { x: number; z: number } | null = null;
    private sampleCounts = new Map<string, number>();

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
        this.parkTactic = config.park;
        this.sessionStart = this.nowFn();
        this.lastProgressAt = this.nowFn();
        this.registerDefaultTactics();
        // Production grind scripts pass grindLogPath; tests do not. Recording
        // here covers every ActivitySession caller without a per-script snippet.
        if (config.grindLogPath) recordScriptAssignment();
        if (this.heartbeatPath && this.heartbeatMs > 0) {
            this.writeHeartbeat(true);
        }
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
     * Sets the current step, shows local intent, and counts as progress.
     */
    async setPhase(phase: string): Promise<void> {
        this.phaseName = phase;
        await this.showIntent(phase.replace(/_/g, ' '));
        this.noteProgress('phase', phase);
        this.log('log', `phase ${phase}`);
    }

    /** Records observed progress and exits an in-progress recovery. */
    noteProgress(kind: ProgressKind, detail?: string): void {
        this.lastProgressAt = this.nowFn();
        if (this.recoveryStartedAt !== null) {
            this.stallAccumMs += this.nowFn() - this.recoveryStartedAt;
        }
        this.recoveryStartedAt = null;
        this.recoveryTacticsUsed = 0;
        this.nextTacticIndex = 0;
        this.failureTimes.clear();
        void kind;
        void detail;
    }

    /** Records a failure; five identical codes in the window arm recovery. */
    noteFailure(code: string, message: string): void {
        const now = this.nowFn();
        this.lastFailure = { code, message, at: now };
        const times = (this.failureTimes.get(code) ?? []).filter((t) => now - t < this.repeatFailWindowMs);
        times.push(now);
        this.failureTimes.set(code, times);
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
    async recover(): Promise<RecoveryOutcome> {
        if (this.stopReasonValue) return 'exhausted';
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
                this.stop('recovery_exhausted', this.lastFailure?.message ?? 'recovery budget exhausted', {
                    restartable: true,
                });
                return 'exhausted';
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
            const resumed = await tactic.run();
            if (this.stopReasonValue) return 'exhausted';
            if (resumed) {
                this.noteProgress('phase', `recovered:${tactic.name}`);
                this.lastTacticName = null;
                this.consecutiveTacticCount = 0;
                return 'resumed';
            }
        }

        this.stop('recovery_exhausted', this.lastFailure?.message ?? 'no tactics left', { restartable: true });
        return 'exhausted';
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
        this.log('error', `${code} ${message} phase=${this.phaseName} @ ${p?.worldX ?? 0},${p?.worldZ ?? 0}`);
    }

    /** Stop with restartable exit semantics (launchd KeepAlive will restart). */
    stopRestartable(code: string, message: string): void {
        this.stop(code, message, { restartable: true });
    }

    /** Exit code scripts should honor before disconnect (70 = restartable, 0 = terminal). */
    exitCode(): number {
        if (!this.stopReasonValue) return 0;
        return this.stopReasonValue.restartable ? RESTARTABLE_EXIT_CODE : 0;
    }

    /**
     * Safe-park, final heartbeat, and process.exitCode before disconnect.
     * Grind routes should call this after their main loop when session.isStopped().
     */
    async finalizeStop(): Promise<void> {
        if (!this.stopReasonValue) return;
        if (this.stopReasonValue.restartable) {
            await this.safePark();
        }
        this.writeHeartbeat(true);
        process.exitCode = this.exitCode();
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

    /** Emit a heartbeat if the interval has elapsed. Call from grind loops. */
    maybeHeartbeat(): void {
        if (!this.heartbeatPath || this.heartbeatMs <= 0 || this.stopReasonValue) return;
        const now = this.nowFn();
        if (this.lastHeartbeatAt === 0 || now - this.lastHeartbeatAt >= this.heartbeatMs) {
            this.writeHeartbeat(false);
        }
    }

    private writeHeartbeat(force: boolean): void {
        if (!this.heartbeatPath) return;
        const state = this.sdk.getState();
        if (!state?.player && !force) return;
        const now = this.nowFn();
        if (!force && this.lastHeartbeatAt > 0 && now - this.lastHeartbeatAt < this.heartbeatMs) return;

        const xp: Record<string, number> = {};
        for (const skill of this.sdk.getSkills()) {
            if (skill.experience > 0) xp[skill.name] = skill.experience;
        }
        const inv = this.sdk.getInventory();
        const coins = inv.find((i) => /coin/i.test(i.name ?? ''))?.count ?? 0;
        const record = {
            t: now,
            session: this.sessionStart,
            job: this.name,
            xp,
            coins,
            x: state?.player?.worldX ?? 0,
            z: state?.player?.worldZ ?? 0,
        };
        try {
            appendGrindLog(this.heartbeatPath, JSON.stringify(record));
            this.lastHeartbeatAt = now;
        } catch {
            if (!this.heartbeatWarned) {
                this.heartbeatWarned = true;
                this.log('warn', 'heartbeat write failed');
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
        this.lastSeverity = level;
        const key = `${level}:${message}`;
        const count = (this.sampleCounts.get(key) ?? 0) + 1;
        this.sampleCounts.set(key, count);
        const sampledAway = level !== 'error' && count > 1 && count % 10 !== 0;
        if (sampledAway) return;
        const suffix = count > 1 ? ` (×${count})` : '';
        const line = `${new Date(this.nowFn()).toISOString()} ${LEVEL_TOKEN[level]} ${message}${suffix}`;
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
                    if (p && inWilderness(p.worldX, p.worldZ)) {
                        await this.sdk.sendWalk(this.anchor.x, this.anchor.z, true);
                    } else {
                        await this.bot.walkTo(this.anchor.x, this.anchor.z, 2);
                    }
                    return false;
                },
            },
        ];
    }
}
