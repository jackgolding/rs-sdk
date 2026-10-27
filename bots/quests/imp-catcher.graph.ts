/**
 * Imp Catcher — the graph.
 *
 * Same shape as Cook's Assistant, plus the part that used to be most opaque:
 * the bead hunt. `collect` is one state with a 50-minute budget; the loop inside
 * it (hunt → bank for food → return) stays in the runner because it is a
 * productive grind, not a control-flow decision. What the graph pins down is how
 * the run ENDS: every exit is an edge, and a hunt that runs out of time fails as
 * a timeout naming `collect`, not as a bot that idles at the camp.
 *
 *   inspect ──complete──▶ already-done ──▶ $done / $failed
 *      ├──active/unstarted──▶ bank ──▶ travel ──(error, retried once)──┐
 *      └──unknown──▶ $failed                                          │
 *                          ◀──────────────────────────────────────────┘
 *                          travel ──▶ start ──▶ collect ──▶ handin ──▶ verify ──▶ $done
 */
import { DONE, FAILED, defineGraph } from '../../sdk/fsm';

export type ImpStage = 'unstarted' | 'active' | 'complete' | 'unknown';

export interface ImpCtx {
    readStage: () => Promise<ImpStage>;
    checkpoint: (name: 'unstarted' | 'active' | 'complete', label: string) => Promise<boolean>;
    /** Deposit carry-over, top up food. Throws on a hard failure. */
    bankForSupplies: () => Promise<void>;
    /** Route to the top floor of the Wizards' Tower and verify arrival. */
    travelToMizgog: () => Promise<void>;
    /** Gate on `unstarted`, then run the accept dialog (which asserts `active`). */
    acceptQuest: () => Promise<{ started: boolean; reason?: string }>;
    /** Descend, reach the imp camp, and hunt until all four beads are held. */
    huntBeads: () => Promise<void>;
    /** Climb back to Mizgog and hand the beads over. */
    handIn: () => Promise<void>;
    promotionGate: () => { ok: boolean; missing: string[] };
    log: (message: string) => void;
    stage: ImpStage | null;
}

export const graph = defineGraph<ImpCtx>({
    id: 'imp catcher',
    initial: 'inspect',
    maxEdgeRepeats: 3,
    maxSteps: 24,
    states: {
        inspect: {
            run: async (ctx) => {
                const stage = await ctx.readStage();
                ctx.stage = stage;
                ctx.log(`Quest stage at start: ${stage}`);
                return stage;
            },
            on: { complete: 'already-done', active: 'bank', unstarted: 'bank', unknown: FAILED },
            timeoutMs: 120_000,
        },

        'already-done': {
            run: async (ctx) => {
                ctx.log('Imp Catcher is already complete — nothing to do');
                return (await ctx.checkpoint('complete', 'journal reports QUEST COMPLETE')) ? 'ok' : 'bad';
            },
            on: { ok: DONE, bad: FAILED },
            timeoutMs: 120_000,
        },

        bank: {
            run: async (ctx) => {
                await ctx.bankForSupplies();
                return 'stocked';
            },
            on: { stocked: 'travel' },
            timeoutMs: 900_000,
        },

        travel: {
            run: async (ctx) => {
                await ctx.travelToMizgog();
                return 'arrived';
            },
            on: { arrived: 'start' },
            // A blocked leg through the tower is usually a door or a stair the
            // walker missed; one retry from wherever it stands fixes that. Two
            // failures means the route is wrong, and the visit cap ends it.
            onError: 'travel',
            maxVisits: 2,
            onVisitExceeded: FAILED,
            timeoutMs: 900_000,
        },

        start: {
            run: async (ctx) => {
                if (ctx.stage !== 'unstarted') {
                    ctx.log('Resuming mid-quest: the bead request is already journal-confirmed');
                    return 'resumed';
                }
                if (!(await ctx.checkpoint('unstarted', 'quest not yet started'))) return 'gate-failed';
                const result = await ctx.acceptQuest();
                return result.started ? 'started' : 'gate-failed';
            },
            on: { started: 'collect', resumed: 'collect', 'gate-failed': FAILED },
            timeoutMs: 300_000,
        },

        collect: {
            run: async (ctx) => {
                await ctx.huntBeads();
                return 'collected';
            },
            on: { collected: 'handin' },
            // The hunt itself bounds its own time (45 min) and throws when it
            // expires; this budget is the outer envelope including travel.
            timeoutMs: 3_000_000,
        },

        handin: {
            run: async (ctx) => {
                await ctx.handIn();
                return 'done';
            },
            on: { done: 'verify' },
            timeoutMs: 900_000,
        },

        verify: {
            run: async (ctx) => {
                if (!(await ctx.checkpoint('complete', 'journal reports QUEST COMPLETE'))) return 'bad';
                const gate = ctx.promotionGate();
                if (!gate.ok) {
                    ctx.log(`promotion gate failed: missing/unpassed ${JSON.stringify(gate.missing)}`);
                    return 'gate-failed';
                }
                ctx.log(`Run record verified (${gate.missing.length} outstanding)`);
                return 'ok';
            },
            on: { ok: DONE, bad: FAILED, 'gate-failed': FAILED },
            timeoutMs: 120_000,
        },
    },
});
