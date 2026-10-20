/**
 * Cook's Assistant — the graph.
 *
 * The flow that used to be six `setPhase()` calls and a chain of throws is now
 * a declared machine. Every way this quest can end is an edge:
 *
 *   inspect ──complete──▶ already-done ──ok──▶ $done
 *      │                                   └──bad──▶ $failed
 *      ├──active/unstarted──▶ bank ──▶ travel ──(error, retried once)──┐
 *      └──unknown──▶ $failed                                          │
 *                                     ◀──────────────────────────────┘
 *                                     travel ──▶ start ──▶ handin ──▶ verify ──ok──▶ $done
 *                                                  └─gate-failed──▶ $failed
 *
 * The context is a set of VERBS, not the SDK: `readStage`, `bankForSupplies`,
 * `travelToCook`, `acceptQuest`, `handIn`, `checkpoint`, `promotionGate`. That is
 * what lets this file be validated and drawn without a client (and tested with
 * fakes), while the runner in `cooks-assistant.ts` keeps the real world code.
 */
import { DONE, FAILED, defineGraph } from '../../sdk/fsm';

export type CookStage = 'unstarted' | 'active' | 'complete' | 'unknown';

export interface CookCtx {
    /** Probe the quest journal for the account's real stage. */
    readStage: () => Promise<CookStage>;
    /** Journal checkpoint; false means the evidence did not support the claim. */
    checkpoint: (name: 'unstarted' | 'active' | 'complete', label: string) => Promise<boolean>;
    /** True when the three ingredients are already carried. */
    suppliesCarried: () => boolean;
    /** Deposit carry-over, withdraw what is missing, self-source a shortfall. Throws on a hard failure. */
    bankForSupplies: () => Promise<void>;
    /** Route to the Cook and verify arrival. Throws BLOCKED when the route cannot progress. */
    travelToCook: () => Promise<void>;
    /** Gate on `unstarted`, then run the accept dialog (which asserts `active`). */
    acceptQuest: () => Promise<{ started: boolean; reason?: string }>;
    /** Talk again and hand the ingredients over. */
    handIn: () => Promise<void>;
    /** Every declared checkpoint carries a PASS? */
    promotionGate: () => { ok: boolean; missing: string[] };
    log: (message: string) => void;
    /** Null until `inspect` has run. */
    stage: CookStage | null;
}

const TIMEOUT = {
    inspect: 120_000,
    bank: 900_000,
    travel: 600_000,
    start: 300_000,
    handIn: 300_000,
    verify: 120_000,
};

export const graph = defineGraph<CookCtx>({
    id: "cook's assistant",
    initial: 'inspect',
    // Insurance only: the flow is acyclic apart from the travel retry, which is
    // bounded by `maxVisits` below. A cap here turns a future regression into
    // `loop-limit` with the offending edge named.
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
            // A completed quest has nothing to do; an unreadable journal is not a
            // stage, so it fails instead of guessing.
            on: { complete: 'already-done', active: 'bank', unstarted: 'bank', unknown: FAILED },
            timeoutMs: TIMEOUT.inspect,
        },

        'already-done': {
            run: async (ctx) => {
                ctx.log("Cook's Assistant is already complete — nothing to do");
                // Record the evidence anyway: an exit with no checkpoint record is
                // indistinguishable from a run that never got started.
                return (await ctx.checkpoint('complete', 'journal reports QUEST COMPLETE')) ? 'ok' : 'bad';
            },
            on: { ok: DONE, bad: FAILED },
            timeoutMs: TIMEOUT.verify,
        },

        bank: {
            run: async (ctx) => {
                if (ctx.suppliesCarried()) {
                    ctx.log('Supplies already carried; skipping the bank leg');
                    return 'carried';
                }
                await ctx.bankForSupplies();
                return 'stocked';
            },
            on: { stocked: 'travel', carried: 'travel' },
            timeoutMs: TIMEOUT.bank,
        },

        travel: {
            run: async (ctx) => {
                await ctx.travelToCook();
                return 'arrived';
            },
            on: { arrived: 'start' },
            // A blocked leg is usually a door or a gate the walker did not get
            // through; one retry from the new position fixes it. Two failures is
            // a real route problem, so the visit cap ends the run there.
            onError: 'travel',
            maxVisits: 2,
            onVisitExceeded: FAILED,
            timeoutMs: TIMEOUT.travel,
        },

        start: {
            run: async (ctx) => {
                if (ctx.stage !== 'unstarted') {
                    ctx.log('Resuming mid-quest: the ingredients request is already journal-confirmed');
                    return 'resumed';
                }
                // Gate BEFORE acting: the dialog below assumes the quest has not
                // started, and acting on that assumption is how a start option gets
                // re-picked over an in-progress quest.
                if (!(await ctx.checkpoint('unstarted', 'quest not yet started'))) return 'gate-failed';
                const result = await ctx.acceptQuest();
                if (!result.started) return 'gate-failed';
                return 'started';
            },
            on: { started: 'handin', resumed: 'handin', 'gate-failed': FAILED },
            timeoutMs: TIMEOUT.start,
        },

        handin: {
            run: async (ctx) => {
                await ctx.handIn();
                return 'done';
            },
            on: { done: 'verify' },
            timeoutMs: TIMEOUT.handIn,
        },

        verify: {
            run: async (ctx) => {
                // Completion is proven by the journal, never by XP or a chat line.
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
            timeoutMs: TIMEOUT.verify,
        },
    },
});
