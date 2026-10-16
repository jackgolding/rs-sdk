#!/usr/bin/env bun
/**
 * Jev router: automatic stuck-bot triage with learned fallback ranking.
 *
 * Every cycle: classify the fleet → match each stuck bot against prior
 * rules → rank candidate actions by posterior success rate (priors are just
 * the starting weights) → safety-gate → execute → record the attempt.
 * Later cycles attribute outcomes (producing within 4h = success) and the
 * ranking adapts. No LLM, no magic — counts that beat the priors over time.
 *
 * Autonomy boundary (honest, not aspirational):
 * - restart / pause / unpause / supply-runs execute directly (reversible,
 *   capped). Switches are PROPOSALS ONLY: the roster is tracked, the box
 *   key is read-only, and a rewrite would break pull --ff-only deploys.
 *   A proposal becomes a PR; the deploy rolls it.
 *
 *   bun fleet-router.ts --plan               (rank + print, change nothing)
 *   bun fleet-router.ts                      (live cycle)
 *   FLEET_SUPERVISOR=docker FLEET_BOTS_DIR=/srv/fleet/bots FLEET_STATE_DIR=/srv/fleet/state
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync, appendFileSync } from 'fs';
import { join } from 'path';
import { collectFleet } from './fleet-status';
import { supervisorKind } from './supervisor';
import { ROOT } from './roster';
import { STATE_DIR } from './fleet-shepherd';
import { skillLookup } from './fleet-rates';
import { readJsonlTail } from '../../../../sdk/grind-log';
import { setSkipList } from '../../../../tools/fleet-desk/roster-edit';
import type { VerdictRow } from './fleet-verdict';

const CTL = join(ROOT, '.cursor/skills/wake-fleet/scripts/fleet-ctl.ts');
const ROUTER_LOG = join(STATE_DIR, 'router.log');
const MEMORY_PATH = join(STATE_DIR, 'router-memory.json');
const LOCK_PATH = join(STATE_DIR, 'router.lock');
const LOCK_STALE_MS = 20 * 60 * 1000;
const OUTCOME_WINDOW_MS = 4 * 60 * 60 * 1000;
const ACTION_COOLDOWN_24H = 2;
const MAX_EXEC_PER_CYCLE = 4;
const SCORE_FLOOR = 0.4;

export type ActionKind = 'none' | 'restart' | 'pause' | 'unpause' | 'supply' | 'propose-switch' | 'notify';

export interface RouterAction {
    kind: ActionKind;
    /** switch target script, or supply script path */
    target?: string;
    /** supply script args */
    args?: string[];
    why: string;
}

export interface RankedAction {
    action: RouterAction;
    /** posterior mean: priors + observed (s, f) */
    score: number;
    key: string;
}

export interface Attempt {
    t: number;
    bot: string;
    /** stopCode ?? check — what we matched on */
    key: string;
    action: ActionKind;
    target?: string;
    resolved: null | 'success' | 'failure' | 'superseded';
    resolvedAt?: number;
}

export interface PauseMeta {
    t: number;
    why: string;
    /** bank-stock item name that would resolve this pause */
    item?: string;
}

export interface RouterMemory {
    attempts: Attempt[];
    pauses: Record<string, PauseMeta>;
    proposals: Record<string, { t: number; what: string }>;
    stats: Record<string, { s: number; f: number }>;
}

export interface Ctx {
    levels: Record<string, number> | null;
    bank: Map<string, number>;
}

interface Prior {
    /** what stuck signature this handles */
    stopCode?: string;
    check?: string;
    reasonRe?: RegExp;
    action: (row: VerdictRow) => RouterAction;
    /** gate the action on bot context; false = skip this prior */
    requires?: (ctx: Ctx) => boolean;
    prior: { s: number; f: number };
}

const levelAtLeast = (skill: string, n: number) => (ctx: Ctx) => {
    if (!ctx.levels) return false;
    return (skillLookup(ctx.levels, skill) ?? 0) >= n;
};

const THIEVING_ARGS = (row: VerdictRow) => [row.name];
const FISHING_ARGS = (row: VerdictRow) => [row.name, '--shark'];

/**
 * Prior table. Scores are starting weights only — observed outcomes move
 * them. Order matters: first match on stopCode (most specific), then check.
 */
export const PRIORS: Prior[] = [
    {
        stopCode: 'no_shield',
        action: (row) => ({ kind: 'propose-switch', target: 'bots/quests/thieving-route.ts', args: THIEVING_ARGS(row), why: 'no dragonfire shield supply exists; thieving needs none' }),
        requires: levelAtLeast('Thieving', 30),
        prior: { s: 3, f: 1 },
    },
    {
        stopCode: 'no_shield',
        action: (row) => ({ kind: 'propose-switch', target: 'bots/quests/fishing-route.ts', args: FISHING_ARGS(row), why: 'no dragonfire shield supply exists; shark fishing needs none' }),
        requires: levelAtLeast('Fishing', 30),
        prior: { s: 3, f: 1 },
    },
    { stopCode: 'no_shield', action: () => ({ kind: 'pause', why: 'no_shield: parked, no shield supply exists' }), prior: { s: 2, f: 1 } },
    {
        stopCode: 'no_pickaxe',
        action: (row) => ({ kind: 'supply', target: 'bots/quests/buy-nurmof-pick.ts', args: [row.name], why: 'bootstrap first pickaxe from Nurmof (32k)' }),
        prior: { s: 2, f: 1 },
    },
    { stopCode: 'no_pickaxe', action: () => ({ kind: 'pause', why: 'no_pickaxe: parked, supply run failed or unfunded' }), prior: { s: 2, f: 1 } },
    {
        check: 'supplies',
        reasonRe: /pickaxe/i,
        action: (row) => ({ kind: 'supply', target: 'bots/quests/buy-nurmof-pick.ts', args: [row.name], why: 'missing pickaxe supply' }),
        prior: { s: 2, f: 1 },
    },
    { check: 'supplies', action: () => ({ kind: 'pause', why: 'needs-supplies: parked for human restock' }), prior: { s: 2, f: 1 } },
    { check: 'no_controller', action: () => ({ kind: 'restart', why: 'container alive but no SDK control (usually transient)' }), prior: { s: 4, f: 1 } },
    { check: 'telemetry_silent', action: () => ({ kind: 'restart', why: 'supervised but silent; reattach control' }), prior: { s: 3, f: 2 } },
    { check: 'logged_out', action: () => ({ kind: 'restart', why: 'client down; docker restart starts it' }), prior: { s: 3, f: 1 } },
    { check: 'no_effect', action: () => ({ kind: 'restart', why: 'attached but idle; one restart to clear transient stalls' }), prior: { s: 2, f: 2 } },
    { check: 'churn', action: () => ({ kind: 'pause', why: 'churn: parked for human review' }), prior: { s: 3, f: 1 } },
    { check: 'repeat', action: () => ({ kind: 'none', why: 'repeat noise (stuns/fails) with a live owner — normal for thieving' }), prior: { s: 1, f: 0 } },
];

function matchKey(row: VerdictRow): string {
    return row.lastStop?.code ?? row.check;
}

/** All priors matching this row, with context gates applied. */
export function matchPriors(row: VerdictRow, ctx: Ctx): Prior[] {
    const key = matchKey(row);
    return PRIORS.filter((p) => {
        if (p.stopCode && p.stopCode !== row.lastStop?.code) return false;
        if (!p.stopCode && p.check && p.check !== key) return false;
        if (p.reasonRe && !p.reasonRe.test(row.reason)) return false;
        if (p.requires && !p.requires(ctx)) return false;
        return true;
    });
}

export function scoreOf(key: string, action: ActionKind, prior: { s: number; f: number }, stats: RouterMemory['stats']): number {
    const st = stats[`${key}::${action}`] ?? { s: 0, f: 0 };
    return (prior.s + st.s) / (prior.s + prior.f + st.s + st.f);
}

/** Rank matched priors by posterior mean. Empty = nothing matched (notify). */
export function rankOptions(row: VerdictRow, ctx: Ctx, memory: RouterMemory): RankedAction[] {
    const key = matchKey(row);
    const ranked = matchPriors(row, ctx).map((p) => {
        const action = p.action(row);
        return { action, score: scoreOf(key, action.kind, p.prior, memory.stats), key };
    });
    ranked.sort((a, b) => b.score - a.score);
    return ranked;
}

export function emptyMemory(): RouterMemory {
    return { attempts: [], pauses: {}, proposals: {}, stats: {} };
}

export function loadMemory(): RouterMemory {
    try {
        if (!existsSync(MEMORY_PATH)) return emptyMemory();
        const raw = JSON.parse(readFileSync(MEMORY_PATH, 'utf-8')) as Partial<RouterMemory>;
        return {
            attempts: Array.isArray(raw.attempts) ? raw.attempts : [],
            pauses: raw.pauses ?? {},
            proposals: raw.proposals ?? {},
            stats: raw.stats ?? {},
        };
    } catch {
        return emptyMemory();
    }
}

export function saveMemory(memory: RouterMemory): void {
    mkdirSync(STATE_DIR, { recursive: true });
    const tmp = `${MEMORY_PATH}.tmp`;
    writeFileSync(tmp, JSON.stringify(memory, null, 2));
    writeFileSync(MEMORY_PATH, readFileSync(tmp));
    try {
        unlinkSync(tmp);
    } catch {
        /* ignore */
    }
}

/** Drop attempts older than 7d; stats accumulate (they ARE the learning). */
export function pruneMemory(memory: RouterMemory, now: number): RouterMemory {
    const cutoff = now - 7 * 24 * 60 * 60 * 1000;
    return { ...memory, attempts: memory.attempts.filter((a) => a.t >= cutoff) };
}

function recordStat(memory: RouterMemory, key: string, action: ActionKind, success: boolean): void {
    const k = `${key}::${action}`;
    const st = memory.stats[k] ?? { s: 0, f: 0 };
    if (success) st.s++;
    else st.f++;
    memory.stats[k] = st;
}

/**
 * Attribute open attempts: producing now = success; a newer attempt on the
 * same bot supersedes; older than the window without producing = failure.
 */
export function attributeOutcomes(memory: RouterMemory, rows: VerdictRow[], now: number): RouterMemory {
    const byName = new Map(rows.map((r) => [r.name, r]));
    const next: Attempt[] = memory.attempts.map((a) => ({ ...a }));
    for (const a of next) {
        if (a.resolved) continue;
        const row = byName.get(a.bot);
        const newer = next.some((b) => b !== a && b.bot === a.bot && b.t > a.t && !b.resolved);
        if (newer) {
            a.resolved = 'superseded';
            a.resolvedAt = now;
            continue;
        }
        if (row?.kind === 'producing') {
            a.resolved = 'success';
            a.resolvedAt = now;
            recordStat(memory, a.key, a.action, true);
            continue;
        }
        if (now - a.t > OUTCOME_WINDOW_MS) {
            a.resolved = 'failure';
            a.resolvedAt = now;
            recordStat(memory, a.key, a.action, false);
        }
    }
    memory.attempts = next;
    return memory;
}

export function recentActions(memory: RouterMemory, bot: string, now: number): number {
    const cutoff = now - 24 * 60 * 60 * 1000;
    return memory.attempts.filter((a) => a.bot === bot && a.t >= cutoff && a.action !== 'notify' && !a.action.startsWith('propose')).length;
}

function hasOpenAttempt(memory: RouterMemory, bot: string, now: number): boolean {
    return memory.attempts.some((a) => a.bot === bot && !a.resolved && now - a.t < 30 * 60 * 1000);
}

function liveBotsDir(): string {
    return process.env.FLEET_BOTS_DIR ?? join(ROOT, 'bots');
}

function skipFile(): string {
    return process.env.FLEET_SKIP_FILE ?? join(ROOT, '.cursor/skills/wake-fleet/skip-bots.txt');
}

/** Latest bank-stock snapshot for preconditions. Empty map when unknown. */
export function readBank(ctx: Ctx, bot: string): Map<string, number> {
    void ctx;
    const path = join(liveBotsDir(), bot, 'bank-stock.log');
    const out = new Map<string, number>();
    try {
        const lines = readJsonlTail<{ items?: { id: number; name: string; count: number }[] }>(path, { maxRecords: 5 });
        const last = lines.filter((l) => Array.isArray(l.items)).pop();
        for (const item of last?.items ?? []) out.set(item.name.toLowerCase(), item.count);
    } catch {
        /* unknown bank */
    }
    return out;
}

export interface Decision {
    row: VerdictRow;
    ranked: RankedAction[];
    chosen: RankedAction | null;
    skipped: string | null;
}

/** Pure decision pass: match → rank → gate. No execution. */
export function decide(rows: VerdictRow[], memory: RouterMemory, now: number): Decision[] {
    const ctxOf = new Map<string, Ctx>();
    const ctxFor = (row: VerdictRow): Ctx => {
        let ctx = ctxOf.get(row.name);
        if (!ctx) {
            ctx = { levels: row.levels, bank: new Map() };
            ctx.bank = readBank(ctx, row.name);
            ctxOf.set(row.name, ctx);
        }
        return ctx;
    };
    let execBudget = MAX_EXEC_PER_CYCLE;
    return rows.map((row) => {
        const skip = (reason: string): Decision => ({ row, ranked: [], chosen: null, skipped: reason });
        if (row.kind === 'producing' || row.kind === 'finished' || row.kind === 'capped') return skip(`${row.kind}: owned by the game/shepherd`);
        if (row.kind === 'paused') return skip('paused: human-owned (unpause via desk)');
        if (hasOpenAttempt(memory, row.name, now)) return skip('awaiting outcome of a recent action');
        if (recentActions(memory, row.name, now) >= ACTION_COOLDOWN_24H) return skip('action cooldown (2/24h)');
        const ranked = rankOptions(row, ctxFor(row), memory);
        if (ranked.length === 0) return skip('no prior matches (notify only)');
        const top = ranked[0]!;
        if (top.action.kind === 'none') return { row, ranked, chosen: null, skipped: `none: ${top.action.why}` };
        if (top.score < SCORE_FLOOR) return { row, ranked, chosen: top, skipped: `below floor ${top.score.toFixed(2)}` };
        const execKinds: ActionKind[] = ['restart', 'pause', 'unpause', 'supply'];
        if (execKinds.includes(top.action.kind)) {
            if (execBudget <= 0) return { row, ranked, chosen: top, skipped: 'cycle exec budget spent' };
            execBudget--;
        }
        if (top.action.kind === 'propose-switch') {
            const what = `${top.action.target} ${top.action.args?.join(' ') ?? ''}`;
            const prev = memory.proposals[row.name];
            if (prev && prev.what === what && now - prev.t < 24 * 60 * 60 * 1000) {
                return { row, ranked, chosen: top, skipped: 'same proposal logged <24h' };
            }
        }
        return { row, ranked, chosen: top, skipped: null };
    });
}

function logBoth(line: string): void {
    console.log(line);
    try {
        mkdirSync(STATE_DIR, { recursive: true });
        appendFileSync(join(STATE_DIR, 'router.log'), `${new Date().toISOString()} ${line}\n`);
    } catch {
        /* console only */
    }
}

function run(cmd: string[], timeoutMs: number): { ok: boolean; out: string } {
    try {
        const proc = Bun.spawnSync(['timeout', String(Math.ceil(timeoutMs / 1000)), ...cmd], { stdout: 'pipe', stderr: 'pipe' });
        const text = new TextDecoder();
        return { ok: proc.exitCode === 0, out: `${text.decode(proc.stdout)}${text.decode(proc.stderr)}`.trim().slice(-2000) };
    } catch (e) {
        return { ok: false, out: e instanceof Error ? e.message : String(e) };
    }
}

function recordAttempt(memory: RouterMemory, attempt: Attempt): void {
    memory.attempts.push(attempt);
}

async function execute(decision: Decision, memory: RouterMemory, now: number, dryRun: boolean): Promise<void> {
    const { row, chosen } = decision;
    if (!chosen) return;
    const action = chosen.action;
    const describe = `${row.name}: ${action.kind}${action.target ? ` ${action.target}` : ''} — ${action.why} (score ${chosen.score.toFixed(2)})`;
    if (action.kind === 'notify' || action.kind === 'propose-switch') {
        logBoth(`${dryRun ? 'plan' : 'router'}: ${describe}`);
        if (!dryRun && action.kind === 'propose-switch') {
            memory.proposals[row.name] = { t: now, what: `${action.target} ${action.args?.join(' ') ?? ''}` };
        }
        return;
    }
    if (dryRun) {
        logBoth(`plan: ${describe}`);
        return;
    }
    const key = chosen.key;
    if (action.kind === 'restart') {
        const r = run(['bun', CTL, 'restart', row.name], 3 * 60 * 1000);
        logBoth(`router: restart ${row.name} ${r.ok ? 'launched' : `FAILED: ${r.out}`}`);
        if (r.ok) recordAttempt(memory, { t: now, bot: row.name, key, action: 'restart', resolved: null });
    } else if (action.kind === 'pause') {
        try {
            const cur = existsSync(skipFile()) ? readFileSync(skipFile(), 'utf-8') : '';
            writeFileSync(skipFile(), setSkipList(cur, row.name, true));
        } catch (e) {
            logBoth(`router: pause ${row.name} FAILED to write skip: ${(e as Error).message}`);
            return;
        }
        const r = run(['bun', CTL, 'stop', row.name, '--drain'], 5 * 60 * 1000);
        logBoth(`router: pause ${row.name} (${action.why}) ${r.ok ? 'parked' : `STOP FAILED: ${r.out}`}`);
        if (r.ok) {
            recordAttempt(memory, { t: now, bot: row.name, key, action: 'pause', resolved: null });
            memory.pauses[row.name] = { t: now, why: action.why, item: /pickaxe/i.test(action.why) ? 'pickaxe' : /shield/i.test(action.why) ? 'shield' : undefined };
        } else {
            try {
                writeFileSync(skipFile(), setSkipList(readFileSync(skipFile(), 'utf-8'), row.name, false));
            } catch {
                /* leave paused rather than loose */
            }
        }
    } else if (action.kind === 'unpause') {
        try {
            writeFileSync(skipFile(), setSkipList(readFileSync(skipFile(), 'utf-8'), row.name, false));
            delete memory.pauses[row.name];
            logBoth(`router: unpause ${row.name} (${action.why}) — shepherd wakes it`);
            recordAttempt(memory, { t: now, bot: row.name, key, action: 'unpause', resolved: null });
        } catch (e) {
            logBoth(`router: unpause ${row.name} FAILED: ${(e as Error).message}`);
        }
    } else if (action.kind === 'supply') {
        const script = action.target!;
        const stop = run(['bun', CTL, 'stop', row.name], 3 * 60 * 1000);
        if (!stop.ok) {
            logBoth(`router: supply ${row.name} FAILED to stop container: ${stop.out}`);
            return;
        }
        const r = run(['bun', join(ROOT, script), ...(action.args ?? [])], 20 * 60 * 1000);
        const start = run(['bun', CTL, 'start', row.name], 60 * 1000);
        logBoth(`router: supply ${row.name} ${script} ${r.ok ? 'done' : `FAILED: ${r.out}`} (container ${start.ok ? 'restarted' : 'RESTART FAILED'})`);
        if (r.ok) recordAttempt(memory, { t: now, bot: row.name, key, action: 'supply', target: script, resolved: null });
    }
}

/** Paused supply-class bots whose missing item reappeared get one unpause probe. */
export function reprobePauses(rows: VerdictRow[], memory: RouterMemory): { name: string; why: string }[] {
    const out: { name: string; why: string }[] = [];
    for (const row of rows) {
        if (row.kind !== 'paused') continue;
        const meta = memory.pauses[row.name];
        if (!meta?.item) continue;
        const bank = readBank({ levels: row.levels, bank: new Map() }, row.name);
        let count = 0;
        for (const [name, n] of bank) if (name.includes(meta.item)) count += n;
        if (count > 0) out.push({ name: row.name, why: `${meta.item} reappeared in bank-stock (${count})` });
    }
    return out;
}

function acquireLock(now: number): boolean {
    mkdirSync(STATE_DIR, { recursive: true });
    if (existsSync(LOCK_PATH)) {
        try {
            const age = now - Number(readFileSync(LOCK_PATH, 'utf-8'));
            if (Number.isFinite(age) && age < LOCK_STALE_MS) return false;
        } catch {
            /* stale */
        }
    }
    writeFileSync(LOCK_PATH, String(now));
    return true;
}

function releaseLockFile(): void {
    try {
        unlinkSync(LOCK_PATH);
    } catch {
        /* ignore */
    }
}

export async function runRouterCycle(now = Date.now(), opts?: { dryRun?: boolean }): Promise<void> {
    const dryRun = opts?.dryRun === true;
    if (!dryRun && !acquireLock(now)) {
        console.log('router: previous cycle still running — skip');
        return;
    }
    try {
        let memory = pruneMemory(loadMemory(), now);
        const { rows } = await collectFleet(now);
        if (!dryRun) {
            memory = attributeOutcomes(memory, rows, now);
            for (const probe of reprobePauses(rows, memory)) {
                logBoth(`router: unpause ${probe.name} (${probe.why}) — shepherd wakes it`);
                try {
                    writeFileSync(skipFile(), setSkipList(readFileSync(skipFile(), 'utf-8'), probe.name, false));
                    delete memory.pauses[probe.name];
                    recordAttempt(memory, { t: now, bot: probe.name, key: 'reprobe', action: 'unpause', resolved: null });
                } catch (e) {
                    logBoth(`router: unpause ${probe.name} FAILED: ${(e as Error).message}`);
                }
            }
        }
        const decisions = decide(rows, memory, now);
        let acted = 0;
        for (const d of decisions) {
            if (d.skipped && !d.chosen) {
                continue;
            }
            if (d.skipped && d.chosen) {
                logBoth(`${dryRun ? 'plan' : 'router'}: skip ${d.row.name} (${d.skipped}) top=${d.chosen.action.kind} ${d.chosen.score.toFixed(2)}`);
                continue;
            }
            await execute(d, memory, now, dryRun);
            acted++;
        }
        if (!dryRun) saveMemory(memory);
        logBoth(`router: cycle done, ${acted} actions (${decisions.filter((d) => d.chosen && !d.skipped).length} chosen)`);
    } finally {
        if (!dryRun) releaseLockFile();
    }
}

if (import.meta.main) {
    if (supervisorKind() !== 'docker' && !process.argv.includes('--plan')) {
        console.error('fleet-router is docker-only (it acts on containers); --plan elsewhere is meaningless without box data.');
        process.exit(1);
    }
    const dryRun = process.argv.includes('--plan');
    runRouterCycle(Date.now(), { dryRun }).catch((e) => {
        console.error(e);
        process.exitCode = 1;
    });
}
