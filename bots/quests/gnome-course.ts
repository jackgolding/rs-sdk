/**
 * Gnome Stronghold agility lap — fixed obstacle order and map coords (m38_53).
 * Linear step index only advances on observed progress; no mid-lap position sync.
 */
import type { BotActions } from '../../sdk/actions';
import type { ActivitySession, BotSDK } from '../../sdk/index';
import type { NearbyLoc } from '../../sdk/types';

export const GNOME_START = { x: 2474, z: 3436 };
const OBSTACLE_WAIT_MS = 18_000;
const STALL_LIMIT = 3;
const LAP_BONUS_XP = 300;
const WEST_X = 2478;

/**
 * Log balance (loc 2295, `gnome_log_balance1`, op1 Walk-across).
 *
 * m38_53.jm2 places it on PLANE 1 — `1 42 43: 2295 22`, with the rest of the
 * log (`log_balance3`/`loc_2292`) on 1 42 38..42. The engine resolves a loc
 * click at the PLAYER's plane only (`World.getLoc(x, z, player.level, id)`),
 * and scanNearbyLocs publishes the current plane only, so a plane-0 bot can
 * neither see nor click it: live at (2474,3436) the client lists 69 locs
 * (Obstacle net 2473,3425 / Obstacle pipe 2484,3435 included) and no log.
 *
 * `agility_force_move` on success walks the player 7 tiles in -z, so the
 * crossing test is `start.z - end.z >= 4` (same axis as `crossDz` below).
 */
const LOG_TILE = { x: 2474, z: 3435 };
const LOG_LOC_ID = 2295;
const LOG_BLIND_WAIT_MS = 4_000;
/** Re-probe the log this many 6-obstacle cycles after a miss, so a server-side
 *  map fix (log bridged to L0) turns full laps back on without a restart. */
const LOG_RETRY_CYCLES = 5;
const NET_UP_INDEX = 1;

type Step = {
    id: string;
    label: string;
    level: number;
    stand: { x: number; z: number };
    standTolerance?: number;
    name: RegExp;
    option: RegExp;
    optional?: boolean;
    valid?: (px: number, pz: number, lx: number, lz: number) => boolean;
    /** Server force-moves the player on success (XP lands after the walk):
     *  success = XP gain OR displacement of at least this far along the
     *  crossing axis. Log walks south, rope walks east. */
    crossDz?: number;
    crossDx?: number;
};

/** Physical lap order that matches the live map layout. */
const STEPS: Step[] = [
    {
        id: 'log',
        label: 'Log',
        level: 0,
        stand: GNOME_START,
        standTolerance: 4,
        name: /^log balance$/i,
        option: /walk-across/i,
        crossDz: 5
    },
    {
        id: 'net_up',
        label: 'Net up',
        level: 0,
        stand: GNOME_START,
        standTolerance: 0,
        name: /^obstacle net$/i,
        option: /climb-over/i,
        valid: (px, pz, lx, lz) => pz > lz && lx < WEST_X
    },
    {
        id: 'tree_up',
        label: 'Tree up',
        level: 1,
        stand: { x: 2473, z: 3423 },
        name: /^tree branch$/i,
        option: /^climb$/i
    },
    {
        id: 'rope',
        label: 'Rope',
        level: 2,
        stand: { x: 2478, z: 3420 },
        name: /^balancing rope$/i,
        option: /walk-on/i,
        valid: (px, _, lx) => px < 2482 && lx <= 2480,
        crossDx: 4
    },
    {
        id: 'tree_down',
        label: 'Tree down',
        level: 2,
        stand: { x: 2487, z: 3420 },
        name: /^tree branch$/i,
        option: /climb-down/i
    },
    {
        id: 'net_down',
        label: 'Net down',
        level: 0,
        // gnome_obstacle_net_2 sits on z=3426 east of x=2482; must stand north at z=3425 (server: player z < net z).
        stand: { x: 2483, z: 3425 },
        standTolerance: 0,
        name: /^obstacle net$/i,
        option: /climb-over/i,
        valid: (px, pz, lx, lz) => pz < lz && lx >= 2482
    },
    {
        id: 'pipe',
        label: 'Pipe',
        level: 0,
        stand: { x: 2484, z: 3430 },
        name: /^obstacle pipe$/i,
        option: /squeeze/i,
        valid: (px, pz, lx, lz) => pz <= lz && lx >= WEST_X - 1
    }
];

export type GnomeCourseDeps = {
    sdk: BotSDK;
    bot: BotActions;
    session: ActivitySession;
    log: (msg: string) => void;
    intent: (msg: string) => void;
    closeUi: () => Promise<void>;
    agilityXp: () => number;
    agilityLevel: () => number;
    pos: () => { x: number; z: number; level: number };
    distTo: (x: number, z: number) => number;
    isStopped: () => boolean;
};

export class GnomeCourse {
    stepIndex = 0;
    laps = 0;
    /** 6-obstacle cycles (net_up..pipe) run while the log is unreachable.
     *  The pipe only pays the 390 bonus on a log-first lap, so these are
     *  worth ~1000 xp each — but they still pay, which is the whole point. */
    partialLaps = 0;
    private lastXp = 0;
    private fails = 0;
    /** Log balance is a plane-1 loc on the live map; while it is unreachable,
     *  skip the step instead of stalling (a stall fires recovery tactics that
     *  walk the bot out of the stronghold). */
    private logUnavailable = false;
    /** Re-probe boundary in partialLaps (laps never advances while the log is
     *  missing, so a lap-based retry window would never reopen). */
    private logRetryAtCycle = 0;
    private logAttempts = 0;

    constructor(private readonly d: GnomeCourseDeps) {}

    resume(): void {
        this.stepIndex = this.inferStep();
        this.lastXp = this.d.agilityXp();
        this.d.log(`Gnome lap resume step ${this.stepIndex + 1}/${STEPS.length} (${STEPS[this.stepIndex]?.id}) L${this.d.pos().level}`);
    }

    private inferStep(): number {
        const p = this.d.pos();
        if (p.level === 2) return p.x >= 2484 ? 4 : 3;
        if (p.level === 1) return 2;
        if (p.level === 0) {
            if (p.x >= 2480 && p.z >= 3428) return 6;
            if (p.x >= WEST_X && p.z >= 3425) return 5;
            if (p.x >= 2480 && p.z < 3425) return 5;
            return 0;
        }
        return 0;
    }

    private async walkTo(x: number, z: number, tolerance = 2): Promise<void> {
        if (this.d.distTo(x, z) <= tolerance) return;
        const r = await this.d.bot.walkTo(x, z, tolerance);
        if (!r.success && this.d.distTo(x, z) > tolerance + 1) {
            await this.d.sdk.sendWalk(x, z, true);
            await this.d.sdk
                .waitForCondition((s) => {
                    const px = s.player?.worldX ?? 0;
                    const pz = s.player?.worldZ ?? 0;
                    return Math.hypot(px - x, pz - z) <= tolerance + 1;
                }, 12_000)
                .catch(() => {});
        }
    }

    /** Nets reject the op unless you are on the correct side (see gnome_course.rs2). */
    private async ensureNetStand(step: Step): Promise<void> {
        const tol = step.standTolerance ?? 2;
        const p = this.d.pos();

        if (step.id === 'net_down') {
            // Tree climb-down lands west (~2474,3426). net_2 is east on the z=3426 row.
            const p = this.d.pos();
            if (p.x < 2480) {
                this.d.intent('Walking east to net down');
                await this.d.bot.walkTo(2483, p.z, 2);
            }
            if (p.z >= 3426) {
                this.d.log(`net_down: step north from ${this.d.pos().x},${this.d.pos().z}`);
                await this.d.sdk.sendWalk(2483, 3425, true);
                await this.d.sdk
                    .waitForCondition((s) => (s.player?.worldZ ?? p.z) < 3426, 8000)
                    .catch(() => {});
            }
            await this.walkTo(2483, 3425, tol);
            return;
        }

        if (step.id === 'net_up' && p.z <= step.stand.z) {
            this.d.intent('Stepping north for net up');
            await this.d.sdk.sendWalk(step.stand.x, step.stand.z, true);
            await this.d.sdk
                .waitForCondition((s) => (s.player?.worldZ ?? p.z) >= step.stand.z, 8000)
                .catch(() => {});
        }
        await this.walkTo(step.stand.x, step.stand.z, tol);
    }

    private async walkPlatformEast(): Promise<void> {
        if (this.d.pos().level !== 2) return;
        this.d.intent('Walking east on rope platform');
        for (let x = Math.max(this.d.pos().x, 2478); x <= 2487; x++) {
            if (this.d.isStopped()) return;
            if (this.d.pos().x >= 2485) break;
            await this.d.sdk.sendWalk(x, 3420, true);
            const x0 = this.d.pos().x;
            await this.d.sdk
                .waitForCondition((s) => (s.player?.worldX ?? x0) >= x - 1, 8000)
                .catch(() => {});
            await this.d.sdk.waitForTicks(1).catch(() => {});
        }
    }

    private findLoc(step: Step, ignoreLevel = false): NearbyLoc | null {
        const p = this.d.pos();
        const matches = (this.d.sdk.getNearbyLocs() ?? []).filter((loc) => {
            if (!ignoreLevel && p.level !== step.level) return false;
            if (!step.name.test(loc.name)) return false;
            const opt = loc.optionsWithIndex.find((o) => step.option.test(o.text));
            if (!opt) return false;
            if (step.id === 'tree_up' && /climb-down/i.test(opt.text)) return false;
            if (step.valid && !step.valid(p.x, p.z, loc.x, loc.z)) return false;
            return true;
        });
        if (!matches.length) return null;
        return matches.sort((a, b) => this.d.distTo(a.x, a.z) - this.d.distTo(b.x, b.z))[0]!;
    }

    private async waitProgress(xp0: number, x0: number, z0: number, level0: number): Promise<boolean> {
        try {
            await this.d.sdk.waitForCondition((s) => {
                const xp = s.skills.find((sk) => sk.name === 'Agility')?.experience ?? 0;
                if (xp > xp0) return true;
                const dx = Math.abs((s.player?.worldX ?? x0) - x0);
                const dz = Math.abs((s.player?.worldZ ?? z0) - z0);
                if (dx > 3 || dz > 3) return true;
                if ((s.player?.level ?? 0) !== level0) return true;
                if (s.dialog?.isOpen) return true;
                return false;
            }, OBSTACLE_WAIT_MS);
            return true;
        } catch {
            return false;
        }
    }

    /** One blind click on the log tile before declaring it unavailable.
     *  Covers the case where the loc exists server-side on L0 but the client
     *  did not publish it (the previous sweep-based theory) — a 4s probe, and
     *  the only way to discover that a server map fix restored the lap bonus. */
    private async blindLogClick(): Promise<{ xp: number; x: number; z: number } | null> {
        // Land on a tile adjacent to the log even if the approach stopped wide
        // (standTolerance is 4): the engine resolves loc clicks from the tile
        // the player stands on, and the log tile itself is not walkable.
        if (this.d.distTo(LOG_TILE.x, LOG_TILE.z) > 4) {
            await this.walkTo(GNOME_START.x, GNOME_START.z, 1);
        }
        if (this.d.distTo(LOG_TILE.x, LOG_TILE.z) > 4) return null;
        const start = this.d.pos();
        const xp0 = this.d.agilityXp();
        this.logAttempts++;
        await this.d.sdk.sendInteractLoc(LOG_TILE.x, LOG_TILE.z, LOG_LOC_ID, 1).catch(() => {});
        try {
            await this.d.sdk.waitForCondition((s) => {
                const xp = s.skills.find((sk) => sk.name === 'Agility')?.experience ?? 0;
                if (xp > xp0) return true;
                // Walk-across force-moves 7 tiles in -z.
                return start.z - (s.player?.worldZ ?? start.z) >= 4;
            }, LOG_BLIND_WAIT_MS);
        } catch {
            return null;
        }
        const end = this.d.pos();
        return { xp: Math.max(0, this.d.agilityXp() - xp0), x: end.x, z: end.z };
    }

    /** Latch the log as unreachable (bounded by LOG_RETRY_CYCLES) and say why. */
    private markLogUnavailable(): void {
        this.logUnavailable = true;
        this.logRetryAtCycle = this.partialLaps + LOG_RETRY_CYCLES;
        const p = this.d.pos();
        this.d.log(
            `Log absent near ${p.x},${p.z} L${p.level} (scan + blind click @ ${LOG_TILE.x},${LOG_TILE.z} id ${LOG_LOC_ID} miss, try ${this.logAttempts}) — 6-obstacle cycles, retry after cycle ${this.logRetryAtCycle}`
        );
    }

    private logSkipped(): boolean {
        return this.logUnavailable && this.partialLaps < this.logRetryAtCycle;
    }

    private async doStep(step: Step): Promise<{ ok: boolean; xpGained: number; skipped?: boolean }> {
        if (step.id === 'tree_down') await this.walkPlatformEast();

        const tol = step.standTolerance ?? 2;
        if (step.id === 'net_up' || step.id === 'net_down') {
            await this.ensureNetStand(step);
        } else {
            await this.walkTo(step.stand.x, step.stand.z, tol);
        }
        await this.d.sdk.scanNearbyLocs(22).catch(() => {});

        let loc = this.findLoc(step);
        if (!loc && (step.id === 'log' || step.id === 'net_up')) {
            // Scene still streams in after travel/teleport: settle, then
            // rescan once before declaring the obstacle absent.
            await this.d.sdk.waitForTicks(5).catch(() => {});
            await this.d.sdk.scanNearbyLocs(22).catch(() => {});
            loc = this.findLoc(step);
        }
        if (step.id === 'log') {
            if (!loc) loc = this.findLoc(step, true);
            if (!loc) {
                const blind = await this.blindLogClick();
                if (!blind) {
                    this.markLogUnavailable();
                    // Not a failure: the step is unreachable on this map, and
                    // a fail here trips the stall clock into recovery tactics
                    // that walk the bot out of the stronghold.
                    return { ok: false, xpGained: 0, skipped: true };
                }
                this.logUnavailable = false;
                this.d.log(
                    `[${this.stepIndex + 1}/${STEPS.length}] log +${blind.xp}xp @ ${blind.x},${blind.z} (blind click)`
                );
                return { ok: true, xpGained: blind.xp };
            }
            this.logUnavailable = false;
            this.d.log(`Log target ${loc.name} @ ${loc.x},${loc.z} reach=${loc.reachable}`);
        }
        if (!loc || loc.reachable === false) return { ok: false, xpGained: 0 };

        const opt = loc.optionsWithIndex.find((o) => step.option.test(o.text))!;

        this.d.intent(`[${this.stepIndex + 1}/${STEPS.length}] ${step.label}: ${opt.text}`);
        await this.walkTo(loc.x, loc.z, 1);

        // Sample AFTER the approach walk: walking to the loc must not count
        // as crossing it.
        const a = this.d.pos();
        const ax0 = a.x;
        const az0 = a.z;
        const xp0 = this.d.agilityXp();

        const isCross = step.crossDx !== undefined || step.crossDz !== undefined;
        if (isCross) {
            // Raw click, no approach walk: bot.interactLoc walks to the loc
            // first, and that approach displacement would fake a crossing.
            // walkTo(loc, 1) above already put us adjacent.
            await this.d.sdk.sendInteractLoc(loc.x, loc.z, loc.id, opt.opIndex);
        } else {
            const interact = await this.d.bot.interactLoc(loc, opt.text);
            if (!interact.success) {
                await this.d.sdk.sendInteractLoc(loc.x, loc.z, loc.id, opt.opIndex);
            }
        }

        if (step.crossDx !== undefined || step.crossDz !== undefined) {
            // Force-move obstacles (log, rope): the server walks the player
            // first and grants XP after. Success = XP, or displacement along
            // the crossing axis (XP lands a few ticks later).
            try {
                await this.d.sdk.waitForCondition((s) => {
                    const xp = s.skills.find((sk) => sk.name === 'Agility')?.experience ?? 0;
                    if (xp > xp0) return true;
                    const px = s.player?.worldX ?? ax0;
                    const pz = s.player?.worldZ ?? az0;
                    if (step.crossDx !== undefined && px - ax0 >= step.crossDx) return true;
                    if (step.crossDz !== undefined && az0 - pz >= step.crossDz) return true;
                    return false;
                }, OBSTACLE_WAIT_MS);
            } catch {
                /* fall through to sampling */
            }
        } else if (step.id === 'pipe') {
            // Pipe pays its XP + the lap bonus after the teleport, so plain
            // movement is not evidence. Wait for the XP itself.
            try {
                await this.d.sdk.waitForCondition((s) => {
                    const xp = s.skills.find((sk) => sk.name === 'Agility')?.experience ?? 0;
                    return xp > xp0;
                }, 25_000);
            } catch {
                /* fall through to sampling */
            }
        } else {
            await this.waitProgress(xp0, ax0, az0, a.level);
        }
        await this.d.closeUi();

        let xp1 = this.d.agilityXp();
        if (xp1 <= xp0) {
            // Grace period: climbs/teleports grant XP server-side before the
            // move is observed, but the gateway may deliver the XP a tick
            // later than the position. Re-sample briefly before judging.
            try {
                await this.d.sdk.waitForCondition((s) => {
                    const xp = s.skills.find((sk) => sk.name === 'Agility')?.experience ?? 0;
                    return xp > xp0;
                }, 4_000);
            } catch {
                /* fall through to sampling */
            }
            xp1 = this.d.agilityXp();
        }
        const gained = Math.max(0, xp1 - xp0);
        const end = this.d.pos();
        const crossed =
            (step.crossDx !== undefined && end.x - ax0 >= step.crossDx) ||
            (step.crossDz !== undefined && az0 - end.z >= step.crossDz);
        // Strict: XP, or a completed force-move crossing. Walking around an
        // obstacle (or falling) grants neither — retry.
        const ok = xp1 > xp0 || crossed;
        if (ok) {
            this.d.log(
                `[${this.stepIndex + 1}/${STEPS.length}] ${step.id} +${gained}xp @ ${end.x},${end.z} L${end.level}`
            );
        }
        return { ok, xpGained: gained };
    }

    private advanceStep(step: Step, xpGained: number): void {
        const xp = this.d.agilityXp();
        if (step.id === 'pipe') {
            this.partialLaps++;
            if (xpGained >= LAP_BONUS_XP) {
                this.laps++;
                this.d.log(`Lap ${this.laps} | Agility ${this.d.agilityLevel()} (${xp} xp, +${xpGained} pipe)`);
                this.lastXp = xp;
                this.stepIndex = this.inferStep();
                if (this.d.pos().level === 0) {
                    void this.walkTo(GNOME_START.x, GNOME_START.z, 4);
                }
                return;
            }
            if (this.logUnavailable) {
                if (this.logSkipped()) {
                    // Log unreachable: loop net_up..pipe. Walking back to the
                    // log every cycle was ~30-60s of dead time per 1000 xp.
                    this.d.log(
                        `Cycle ${this.partialLaps} | Agility ${this.d.agilityLevel()} (${xp} xp, +${xpGained} pipe, no log)`
                    );
                    this.stepIndex = NET_UP_INDEX;
                    return;
                }
                // Retry window open: take one probe at the log next tick.
                this.d.log(`Log retry window @ cycle ${this.partialLaps} — probing the log again`);
                this.stepIndex = 0;
                return;
            }
            // Pipe without the lap bonus: an obstacle was skipped (the server
            // only pays the bonus for log→pipe in order). Not a lap — restart.
            this.d.log(`Pipe without lap bonus (+${xpGained} xp) — restarting at log`);
            this.stepIndex = 0;
            return;
        }
        this.stepIndex = (this.stepIndex + 1) % STEPS.length;
    }

    async tick(): Promise<void> {
        await this.d.closeUi();
        await this.d.session.setPhase('gnome');

        const step = STEPS[this.stepIndex];
        if (!step) {
            const p = this.d.pos();
            this.d.log(`Bad stepIndex ${this.stepIndex} @ ${p.x},${p.z} L${p.level} — resetting to log`);
            this.stepIndex = 0;
            this.fails = 0;
            return;
        }
        if (step.id === 'log' && this.logSkipped()) {
            // Loc absent from the live map: go straight to the net so cycles
            // keep flowing instead of walking back to an unreachable log.
            this.stepIndex = (this.stepIndex + 1) % STEPS.length;
            this.fails = 0;
            return;
        }

        if (this.d.pos().level !== step.level) {
            const inferred = this.inferStep();
            if (inferred !== this.stepIndex) {
                this.stepIndex = inferred;
                this.fails = 0;
                return;
            }
        }

        if (step.id === 'rope' && this.d.pos().level === 2 && this.d.pos().x >= 2483) {
            // Already across the rope on L2: next is the climb-down tree.
            this.stepIndex = 4;
            this.fails = 0;
            return;
        }

        const result = await this.doStep(step);
        if (result.ok) {
            this.fails = 0;
            this.d.session.noteProgress('xp', `gnome ${step.id}`);
            this.advanceStep(step, result.xpGained);
            return;
        }
        if (result.skipped) {
            // Unreachable obstacle (log on plane 1), not a failed attempt:
            // advancing here keeps the stall clock and recovery out of it.
            this.fails = 0;
            this.stepIndex = (this.stepIndex + 1) % STEPS.length;
            return;
        }

        this.fails++;
        if (step.optional && this.fails >= 2) {
            this.d.log(`Gnome skip optional ${step.id}`);
            this.stepIndex = (this.stepIndex + 1) % STEPS.length;
            this.fails = 0;
            return;
        }
        if (this.fails < STALL_LIMIT) return;

        this.d.log(
            `Gnome stall ${step.id} (${this.stepIndex + 1}/${STEPS.length}) @ ${this.d.pos().x},${this.d.pos().z} L${this.d.pos().level}`
        );
        if (step.id === 'tree_down') {
            await this.walkPlatformEast();
        } else if (step.id === 'log') {
            await this.walkTo(step.stand.x, step.stand.z, step.standTolerance ?? 2);
        } else if (step.id === 'net_down' || step.id === 'net_up') {
            await this.ensureNetStand(step);
        } else if (step.optional) {
            this.stepIndex = (this.stepIndex + 1) % STEPS.length;
        } else {
            await this.walkTo(step.stand.x, step.stand.z, step.standTolerance ?? 2);
            if (this.d.pos().level !== step.level) {
                this.stepIndex = this.inferStep();
            }
        }
        this.fails = 0;
    }
}
