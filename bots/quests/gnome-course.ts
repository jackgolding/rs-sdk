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
    private lastXp = 0;
    private fails = 0;
    private logStand: { x: number; z: number } | null = null;
    private logSwept = false;

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

    /** One-time sweep for the log along the entrance corridor, south of the
     *  start. The log (varp stage 1) sits somewhere on the approach; remember
     *  where so later laps go straight there. */
    private async sweepForLog(logStep: Step): Promise<NearbyLoc | null> {
        const stops = [
            { x: 2474, z: 3430 },
            { x: 2470, z: 3415 },
            { x: 2462, z: 3395 }
        ];
        for (const stop of stops) {
            if (this.d.isStopped()) return null;
            await this.walkTo(stop.x, stop.z, 4);
            // Let the scene settle: zones stream in while walking.
            await this.d.sdk.waitForTicks(3).catch(() => {});
            // Wide radius: the client holds full zone data, so one big scan
            // can cover the whole stronghold south half from the corridor.
            const scanned = await this.d.sdk.scanNearbyLocs(40).catch(() => []);
            const hit = this.findLoc(logStep, true);
            this.d.log(
                `Log sweep @ ${this.d.pos().x},${this.d.pos().z} (${scanned?.length ?? -1} locs): ${hit ? `${hit.name} @ ${hit.x},${hit.z} reach=${hit.reachable}` : 'nothing'}`
            );
            if (hit) {
                this.logStand = { x: hit.x, z: hit.z };
                return hit;
            }
        }
        return null;
    }

    private async doStep(step: Step): Promise<{ ok: boolean; xpGained: number }> {
        if (step.id === 'tree_down') await this.walkPlatformEast();

        const tol = step.standTolerance ?? 2;
        if (step.id === 'net_up' || step.id === 'net_down') {
            await this.ensureNetStand(step);
        } else if (step.id === 'log' && this.logStand) {
            await this.walkTo(this.logStand.x, this.logStand.z, 3);
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
            if (!loc && !this.logSwept) {
                this.logSwept = true;
                loc = await this.sweepForLog(step);
            } else if (!loc && this.logStand) {
                await this.walkTo(this.logStand.x, this.logStand.z, 3);
                await this.d.sdk.scanNearbyLocs(22).catch(() => {});
                loc = this.findLoc(step, true);
            }
            if (loc) {
                this.d.log(`Log target ${loc.name} @ ${loc.x},${loc.z} reach=${loc.reachable}`);
            } else {
                this.d.log(`Log absent near ${this.d.pos().x},${this.d.pos().z} L${this.d.pos().level}`);
            }
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
            // The corridor sweep runs on a still-loading scene after travel:
            // allow a re-sweep next cycle instead of skipping forever.
            this.logSwept = false;
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
