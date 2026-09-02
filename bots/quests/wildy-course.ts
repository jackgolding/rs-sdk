/**
 * Wilderness agility lap — fixed obstacle order (pipe → rope → stones → log → rocks).
 * Ridge entry from the south door is handled in agility-route.ts.
 */
import type { BotActions } from '../../sdk/actions';
import type { ActivitySession, BotSDK } from '../../sdk/index';
import type { NearbyLoc } from '../../sdk/types';

const OBSTACLE_WAIT_MS = 6_000;
const LOG_WAIT_MS = 12_000;
const STALL_LIMIT = 1;
const LAP_BONUS_XP = 4989;
/** wilderness_log_balance — bridged L1 loc, interactable on plane 0. */
const LOG_LOC = { x: 3001, z: 3945, id: 2297 };
/** loc_1759 at (3005, 3963) is the pit entrance (z+6400), not the log. */
const PIT_SURFACE_LADDER = { x: 3005, z: 3963 };

type Step = {
    id: string;
    label: string;
    level: number;
    stand: { x: number; z: number };
    standTolerance?: number;
    name: RegExp;
    option: RegExp;
    valid?: (px: number, pz: number, lx: number, lz: number) => boolean;
};

/** Lap order matches wilderness_course.rs2 varp progression. */
const STEPS: Step[] = [
    {
        id: 'pipe',
        label: 'Pipe',
        level: 0,
        stand: { x: 3003, z: 3937 },
        name: /^obstacle pipe$/i,
        option: /squeeze/i,
        valid: (_px, pz, _lx, lz) => pz < lz
    },
    {
        id: 'rope',
        label: 'Ropeswing',
        level: 0,
        stand: { x: 3005, z: 3951 },
        name: /^ropeswing$/i,
        option: /swing/i,
        valid: (_px, pz, _lx, lz) => pz <= lz
    },
    {
        id: 'stones',
        label: 'Stepping stones',
        level: 0,
        stand: { x: 3001, z: 3959 },
        name: /^stepping stone$/i,
        option: /jump/i
    },
    {
        id: 'log',
        label: 'Log balance',
        // Map plane 1 + LINK_BELOW → registered on plane 0. Player stays L0.
        level: 0,
        stand: { x: 3002, z: 3945 },
        name: /^log balance$/i,
        option: /walk/i
    },
    {
        id: 'rocks',
        label: 'Rocks',
        level: 0,
        // North of the loc — climb is forcemove south. Standing south made valid() reject the loc.
        stand: { x: 2994, z: 3938 },
        name: /^rocks$/i,
        option: /climb/i,
        valid: (_px, pz, _lx, lz) => pz > lz
    }
];

export type WildyCourseDeps = {
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

export class WildyCourse {
    stepIndex = 0;
    laps = 0;
    private lastXp = 0;
    private fails = 0;

    needsLapReset = false;

    constructor(private readonly d: WildyCourseDeps) {}

    consumeLapReset(): boolean {
        const v = this.needsLapReset;
        this.needsLapReset = false;
        return v;
    }

    resume(): void {
        this.stepIndex = this.inferStep();
        this.lastXp = this.d.agilityXp();
        this.d.log(
            `Wildy lap resume step ${this.stepIndex + 1}/${STEPS.length} (${STEPS[this.stepIndex]?.id}) L${this.d.pos().level}`
        );
    }

    private inferStep(): number {
        const p = this.d.pos();
        if (p.z > 5000) return 3;
        // Mage Arena / cellar / Lumbridge are not the course. z≥3960 there used to
        // resume at log/stones and skip the pipe (no 4989 even if rocks later fire).
        if (p.x < 2988 || p.x > 3012 || p.z < 3928 || p.z > 3975) return 0;
        // North of stones / pit-exit platform — log is next, never recross lava.
        if (p.z >= 3960) return 3;
        // West end of the log (success / rocks approach). Fail slide is only -4 (x≈2997).
        if (p.z >= 3938 && p.z < 3955 && p.x <= 2995) return 4;
        // Log gap (west of the east wall), south of the stones.
        if (p.z >= 3938 && p.z < 3955 && p.x <= 3003) return 3;
        if (p.z >= 3955) return 2;
        if (p.z >= 3946) return 1;
        return 0;
    }

    /** After climbing out, land is north of the stones — do the log, don't recross lava. */
    afterPitFall(): void {
        this.stepIndex = this.inferStep();
        this.fails = 0;
        this.d.log(
            `Pit exit — resuming at ${STEPS[this.stepIndex]?.id} @ ${this.d.pos().x},${this.d.pos().z}`
        );
    }

    private async sendOp(loc: NearbyLoc, option: RegExp): Promise<void> {
        const opt = loc.optionsWithIndex.find((o) => option.test(o.text));
        if (!opt) return;
        await this.d.sdk.sendInteractLoc(loc.x, loc.z, loc.id, opt.opIndex);
    }

    /** Pit-exit / stones north side → log along the east wall. Never walk north; never west into trees. */
    private async walkToLogFromNorth(): Promise<void> {
        const p = this.d.pos();
        if (p.z < 3955) return;
        if (p.z > 5000) return;
        if (p.x < 3005) {
            this.d.intent('East to pit-ladder wall before the log');
            // Same z — do not walk north to 3962 (that hugs the pipe exit).
            await this.d.sdk.sendWalk(3006, p.z, true);
            await this.d.sdk
                .waitForCondition(
                    () => this.d.pos().x >= 3005 || this.d.pos().z > 5000 || this.d.pos().z < 3955,
                    8_000
                )
                .catch(() => {});
        }
        if (this.d.pos().x < 3005 && this.d.pos().z >= 3955) return;
        this.d.intent('Walking south to log — east of pit ladder');
        const hops = [
            { x: 3006, z: 3950 },
            { x: 3006, z: 3945 },
            { x: LOG_LOC.x + 1, z: LOG_LOC.z }
        ];
        for (const hop of hops) {
            if (this.d.isStopped() || this.d.pos().z > 5000) return;
            if (this.d.pos().z <= hop.z && this.d.distTo(hop.x, hop.z) <= 2) continue;
            await this.d.sdk.sendWalk(hop.x, hop.z, true);
            await this.d.sdk
                .waitForCondition(
                    () => this.d.distTo(hop.x, hop.z) <= 3 || this.d.pos().z > 5000,
                    6_000
                )
                .catch(() => {});
        }
    }

    private isPitSurfaceLadder(loc: NearbyLoc): boolean {
        return (
            loc.id === 1759 ||
            (Math.abs(loc.x - PIT_SURFACE_LADDER.x) <= 1 &&
                Math.abs(loc.z - PIT_SURFACE_LADDER.z) <= 1 &&
                /ladder/i.test(loc.name) &&
                loc.optionsWithIndex.some((o) => /climb-down/i.test(o.text)))
        );
    }

    /**
     * After the rocks (~2994,3933), get to the pipe mouth (3004,3937) with short
     * east hops. A single sendWalk(3004,3936) pathfinds north around the lava and
     * arrives at the pipe's north end (the exit — "can't enter from this side").
     */
    private async walkToPipeFromRocks(): Promise<void> {
        const p0 = this.d.pos();
        if (p0.z > 5000 || p0.z < 3926) return;
        if (p0.x >= 3002 && p0.z >= 3935 && p0.z <= 3940) return;

        if (p0.z >= 3941) {
            await this.walkSouthAlongEastWallToPipe();
            return;
        }

        this.d.intent('East along ridge to pipe mouth');
        for (let i = 0; i < 8 && this.d.pos().x < 3003; i++) {
            const p = this.d.pos();
            if (p.z > 5000 || p.z < 3928 || p.z > 3938) break;
            const nextX = Math.min(3004, p.x + 2);
            const { x: x0 } = p;
            await this.d.sdk.sendWalk(nextX, 3934, true);
            await this.d.sdk
                .waitForCondition(
                    () => this.d.pos().x > x0 || this.d.pos().z > 5000 || this.d.pos().z < 3926,
                    4_000
                )
                .catch(() => {});
            if (this.d.pos().x <= x0) {
                await this.d.sdk.sendWalk(nextX, 3935, true);
                await this.d.sdk.waitForTicks(3).catch(() => {});
            }
        }
        if (this.d.pos().z > 5000 || this.d.pos().z < 3926) return;
        await this.d.sdk.sendWalk(3004, 3937, true);
        await this.d.sdk
            .waitForCondition(() => this.d.distTo(3004, 3937) <= 2 || this.d.pos().z > 5000, 6_000)
            .catch(() => {});
    }

    /** Recover from a north-around-lava detour: south on x=3006 to the pipe mouth. */
    private async walkSouthAlongEastWallToPipe(): Promise<void> {
        this.d.intent('South along east wall to pipe — skip the lava loop');
        if (this.d.pos().x < 3004) {
            const z = this.d.pos().z;
            await this.d.sdk.sendWalk(3006, z, true);
            await this.d.sdk
                .waitForCondition(
                    () => this.d.pos().x >= 3004 || this.d.pos().z > 5000,
                    6_000
                )
                .catch(() => {});
        }
        for (const hop of [
            { x: 3006, z: 3950 },
            { x: 3006, z: 3942 },
            { x: 3004, z: 3937 }
        ]) {
            if (this.d.pos().z > 5000) return;
            if (this.d.pos().x >= 3002 && this.d.pos().z >= 3935 && this.d.pos().z <= 3940) return;
            await this.d.sdk.sendWalk(hop.x, hop.z, true);
            await this.d.sdk
                .waitForCondition(
                    () => this.d.distTo(hop.x, hop.z) <= 3 || this.d.pos().z > 5000,
                    6_000
                )
                .catch(() => {});
        }
    }

    private async leaveRidgeGate(): Promise<void> {
        const p = this.d.pos();
        if (p.z < 3926 || p.z > 3936) return;
        if (p.x > 3002) return;
        await this.walkToPipeFromRocks();
    }

    private async walkTo(x: number, z: number, tolerance = 2): Promise<void> {
        if (this.d.pos().z > 5000) return;
        if (this.d.distTo(x, z) <= tolerance) return;
        await this.d.sdk.sendWalk(x, z, true);
        await this.d.sdk
            .waitForCondition(() => this.d.distTo(x, z) <= tolerance + 2 || this.d.pos().z > 5000, 5_000)
            .catch(() => {});
    }

    private findLoc(step: Step): NearbyLoc | null {
        const p = this.d.pos();
        const matches = (this.d.sdk.getNearbyLocs() ?? []).filter((loc) => {
            if (this.isPitSurfaceLadder(loc)) return false;
            if (!step.name.test(loc.name)) return false;
            const opt = loc.optionsWithIndex.find((o) => step.option.test(o.text));
            if (!opt) return false;
            if (step.valid && !step.valid(p.x, p.z, loc.x, loc.z)) return false;
            return true;
        });
        if (!matches.length) return null;
        return matches.sort((a, b) => this.d.distTo(a.x, a.z) - this.d.distTo(b.x, b.z))[0]!;
    }

    private sawReachTheTop(sinceTick: number): boolean {
        const msgs = this.d.sdk.getState()?.gameMessages ?? [];
        return msgs.some((m) => m.tick >= sinceTick && /you reach the top/i.test(m.text ?? ''));
    }

    private async waitProgress(xp0: number, x0: number, z0: number, level0: number, stepId: string): Promise<boolean> {
        const timeout = stepId === 'log' ? LOG_WAIT_MS : OBSTACLE_WAIT_MS;
        try {
            await this.d.sdk.waitForCondition((s) => {
                if ((s.player?.worldZ ?? 0) > 5000) return true;
                const xp = s.skills.find((sk) => sk.name === 'Agility')?.experience ?? 0;
                if (xp > xp0) return true;
                if ((s.player?.level ?? 0) !== level0) return true;
                if (s.dialog?.isOpen) return true;
                const px = s.player?.worldX ?? x0;
                const pz = s.player?.worldZ ?? z0;
                // Fail slide is only -4 west; success is -8. Do not treat -4 as done.
                if (stepId === 'log') return px <= x0 - 7;
                if (Math.abs(px - x0) > 3 || Math.abs(pz - z0) > 3) return true;
                return false;
            }, timeout);
            return true;
        } catch {
            return false;
        }
    }

    private async doStep(step: Step): Promise<{ ok: boolean; xpGained: number; reachTop: boolean }> {
        if (this.d.pos().z > 5000) return { ok: false, xpGained: 0, reachTop: false };
        // Pit-exit platform is never the rocks. Clicking them from z≥3960 is a miss.
        if (step.id === 'rocks' && this.d.pos().z >= 3958) {
            this.stepIndex = 3;
            await this.walkToLogFromNorth();
            return { ok: false, xpGained: 0, reachTop: false };
        }
        if (step.id === 'pipe') await this.walkToPipeFromRocks();
        if (step.id === 'log') await this.walkToLogFromNorth();

        const tol = step.standTolerance ?? 4;
        if (step.id !== 'pipe' && this.d.distTo(step.stand.x, step.stand.z) > tol + 4) {
            await this.walkTo(step.stand.x, step.stand.z, tol);
        }
        if (this.d.pos().z > 5000) return { ok: false, xpGained: 0, reachTop: false };

        let loc = this.findLoc(step);
        if (!loc) {
            await this.d.sdk.scanNearbyLocs(16).catch(() => {});
            loc = this.findLoc(step);
        }
        if (!loc && step.id === 'pipe' && this.d.pos().z <= 3933) {
            await this.leaveRidgeGate();
            await this.d.sdk.scanNearbyLocs(25).catch(() => {});
            loc = this.findLoc(step);
        }

        const xp0 = this.d.agilityXp();
        const { x: x0, z: z0, level: level0 } = this.d.pos();
        const tick0 = this.d.sdk.getState()?.tick ?? 0;

        if (!loc && step.id === 'log') {
            this.d.intent(`[${this.stepIndex + 1}/${STEPS.length}] ${step.label}: Walk-across (id ${LOG_LOC.id})`);
            await this.d.sdk.sendInteractLoc(LOG_LOC.x, LOG_LOC.z, LOG_LOC.id, 1);
        } else if (!loc) {
            return { ok: false, xpGained: 0, reachTop: false };
        } else {
            const opt = loc.optionsWithIndex.find((o) => step.option.test(o.text))!;
            this.d.intent(`[${this.stepIndex + 1}/${STEPS.length}] ${step.label}: ${opt.text}`);
            if (step.id === 'pipe' && this.d.pos().x >= 3002 && this.d.distTo(loc.x, loc.z - 1) > 1) {
                await this.walkTo(loc.x, loc.z - 1, 1);
            }
            await this.sendOp(loc, step.option);
        }

        await this.waitProgress(xp0, x0, z0, level0, step.id);
        await this.d.closeUi();

        const xp1 = this.d.agilityXp();
        const p1 = this.d.pos();
        let reachTop = this.sawReachTheTop(tick0);
        if (p1.z > 5000) return { ok: false, xpGained: 0, reachTop: false };
        if (step.id === 'log') {
            const crossed = p1.x <= x0 - 7;
            return { ok: xp1 > xp0 || crossed, xpGained: Math.max(0, xp1 - xp0), reachTop };
        }
        // Rocks forcemove happens before the 4989 / "You reach the top." Sampling on
        // movement alone logged +0 xp and skipped the lap line.
        if (step.id === 'rocks') {
            await this.d.sdk
                .waitForCondition((s) => {
                    const xp = s.skills.find((sk) => sk.name === 'Agility')?.experience ?? 0;
                    if (xp >= xp0 + LAP_BONUS_XP) return true;
                    const msgs = s.gameMessages ?? [];
                    return msgs.some((m) => m.tick >= tick0 && /you reach the top/i.test(m.text ?? ''));
                }, 10_000)
                .catch(() => {});
            const xp2 = this.d.agilityXp();
            reachTop = reachTop || this.sawReachTheTop(tick0);
            const moved = Math.hypot(this.d.pos().x - x0, this.d.pos().z - z0) > 2;
            return {
                ok: xp2 > xp0 || reachTop || moved,
                xpGained: Math.max(0, xp2 - xp0),
                reachTop
            };
        }
        const moved = Math.hypot(p1.x - x0, p1.z - z0) > 3 || p1.level !== level0;
        return { ok: xp1 > xp0 || moved, xpGained: Math.max(0, xp1 - xp0), reachTop };
    }

    private advanceStep(step: Step, xpGained: number, reachTop: boolean): void {
        const xp = this.d.agilityXp();
        if (step.id === 'rocks') {
            const bonus = xpGained >= LAP_BONUS_XP || reachTop || xp - this.lastXp >= LAP_BONUS_XP;
            if (bonus) {
                this.laps++;
                this.d.log(`Wildy lap ${this.laps} | Agility ${this.d.agilityLevel()} (${xp} xp)`);
                this.lastXp = xp;
            } else {
                this.d.log(
                    `Wildy rocks done without lap bonus (+${xpGained} xp) — restarting at pipe`
                );
            }
            this.stepIndex = 0;
            this.needsLapReset = true;
            return;
        }
        this.stepIndex = (this.stepIndex + 1) % STEPS.length;
    }

    async tick(): Promise<void> {
        if (this.d.pos().z > 5000) return;

        await this.d.closeUi();
        await this.d.session.setPhase('wildy');

        const step = STEPS[this.stepIndex]!;
        const result = await this.doStep(step);
        if (result.ok) {
            this.fails = 0;
            this.d.session.noteProgress('xp', `wildy ${step.id}`);
            this.advanceStep(step, result.xpGained, result.reachTop);
            return;
        }

        this.d.session.noteProgress('xp', `wildy ${step.id} retry`);
        if (this.d.pos().z > 5000) return;

        this.fails++;
        if (this.fails < STALL_LIMIT) return;

        this.d.log(
            `Wildy stall ${step.id} (${this.stepIndex + 1}/${STEPS.length}) @ ${this.d.pos().x},${this.d.pos().z} L${this.d.pos().level}`
        );
        if (step.id === 'pipe') {
            await this.walkToPipeFromRocks();
            this.fails = 0;
            return;
        }
        // Stay on log/rocks after a miss — inferStep must not skip varp or the lap bonus.
        if (step.id === 'log' || step.id === 'rocks') {
            if (this.d.pos().z >= 3958) {
                this.stepIndex = 3;
                await this.walkToLogFromNorth();
            }
            this.fails = 0;
            return;
        }
        await this.walkTo(step.stand.x, step.stand.z, step.standTolerance ?? 3);
        this.stepIndex = this.inferStep();
        this.fails = 0;
    }
}
