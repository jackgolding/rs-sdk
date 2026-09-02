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
};

/** Physical lap order that matches the live map layout. */
const STEPS: Step[] = [
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
        valid: (px, _, lx) => px < 2482 && lx <= 2480
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

    constructor(private readonly d: GnomeCourseDeps) {}

    resume(): void {
        this.stepIndex = this.inferStep();
        this.lastXp = this.d.agilityXp();
        this.d.log(`Gnome lap resume step ${this.stepIndex + 1}/${STEPS.length} (${STEPS[this.stepIndex]?.id}) L${this.d.pos().level}`);
    }

    private inferStep(): number {
        const p = this.d.pos();
        if (p.level === 2) return p.x >= 2484 ? 4 : 3;
        if (p.level === 1) return 1;
        if (p.level === 0) {
            if (p.z >= 3432) return 0;
            if (p.x >= 2480 && p.z >= 3425) return 5;
            if (p.x < 2480 && p.z >= 3425 && p.z <= 3427) return 5;
            if (p.x >= WEST_X && p.z >= 3426) return 6;
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

    private findLoc(step: Step): NearbyLoc | null {
        const p = this.d.pos();
        const matches = (this.d.sdk.getNearbyLocs() ?? []).filter((loc) => {
            if (p.level !== step.level) return false;
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

    private async doStep(step: Step): Promise<{ ok: boolean; xpGained: number }> {
        if (step.id === 'tree_down') await this.walkPlatformEast();

        const tol = step.standTolerance ?? 2;
        if (step.id === 'net_up' || step.id === 'net_down') {
            await this.ensureNetStand(step);
        } else {
            await this.walkTo(step.stand.x, step.stand.z, tol);
        }
        await this.d.sdk.scanNearbyLocs(22).catch(() => {});

        const loc = this.findLoc(step);
        if (!loc || loc.reachable === false) return { ok: false, xpGained: 0 };

        const opt = loc.optionsWithIndex.find((o) => step.option.test(o.text))!;
        const p = this.d.pos();
        const xp0 = this.d.agilityXp();
        const { x: x0, z: z0, level: level0 } = p;

        this.d.intent(`[${this.stepIndex + 1}/${STEPS.length}] ${step.label}: ${opt.text}`);
        await this.walkTo(loc.x, loc.z, 1);

        const interact = await this.d.bot.interactLoc(loc, opt.text);
        if (!interact.success) {
            await this.d.sdk.sendInteractLoc(loc.x, loc.z, loc.id, opt.opIndex);
        }

        await this.waitProgress(xp0, x0, z0, level0);
        await this.d.closeUi();

        const xp1 = this.d.agilityXp();
        const level1 = this.d.pos().level;
        const moved = Math.hypot(this.d.pos().x - x0, this.d.pos().z - z0) > 3 || level1 !== level0;
        return { ok: xp1 > xp0 || moved, xpGained: Math.max(0, xp1 - xp0) };
    }

    private advanceStep(step: Step, xpGained: number): void {
        const xp = this.d.agilityXp();
        const lapBonus = xpGained >= LAP_BONUS_XP || step.id === 'pipe';
        if (lapBonus) {
            this.laps++;
            this.d.log(`Lap ${this.laps} | Agility ${this.d.agilityLevel()} (${xp} xp)`);
            this.lastXp = xp;
            this.stepIndex = this.inferStep();
            if (this.d.pos().level === 0) {
                void this.walkTo(GNOME_START.x, GNOME_START.z, 4);
            }
            return;
        }
        this.stepIndex = (this.stepIndex + 1) % STEPS.length;
    }

    async tick(): Promise<void> {
        await this.d.closeUi();
        await this.d.session.setPhase('gnome');

        const step = STEPS[this.stepIndex]!;

        if (this.d.pos().level !== step.level) {
            const inferred = this.inferStep();
            if (inferred !== this.stepIndex) {
                this.stepIndex = inferred;
                return;
            }
        }

        if (step.id === 'rope' && this.d.pos().level === 2 && this.d.pos().x >= 2483) {
            this.stepIndex = 4;
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
