/**
 * run-grade — the evidence gate, self-contained.
 *
 *   import { gradeRun } from './run-grade';
 *
 * Why this exists next to quest-lab/canary.ts instead of using it: the fleet
 * image mounts only /srv/fleet/bots, so a script running IN a container cannot
 * import ../../quest-lab/* at all. `todo-runner` did exactly that and crash-looped
 * on the box with "Module not found bots/quests/todo-runner.ts" the moment it was
 * pointed at a real account — the image would have needed a full rollout to run
 * it. Everything here is node:fs so it deploys like any other bots/ script.
 *
 * The verdict rules are the ones the tier has always used, and they are strict
 * on purpose: a run with no record, an empty required list, or any required
 * checkpoint that did not PASS is a FAIL. "Exited 0" is never evidence.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

interface RunFile {
    questId?: string;
    runId?: string;
    requiredCheckpoints?: string[];
}
interface CheckpointRecord {
    checkpointId: string;
    verdict: 'PASS' | 'FAIL' | 'UNKNOWN';
    reason?: string;
    rawLines?: unknown[];
}

export interface RunGrade {
    verdict: 'PASS' | 'FAIL';
    reason: string;
    runId: string | null;
    required: number;
    passed: number;
    missing: string[];
    failed: string[];
}

function readRecords(directory: string): CheckpointRecord[] {
    const path = join(directory, 'checkpoints.jsonl');
    if (!existsSync(path)) return [];
    const out: CheckpointRecord[] = [];
    for (const line of readFileSync(path, 'utf-8').split('\n')) {
        if (!line.trim()) continue;
        try {
            out.push(JSON.parse(line) as CheckpointRecord);
        } catch {
            /* a torn final line must not hide the checkpoints before it */
        }
    }
    return out;
}

export function gradeRun(directory: string): RunGrade {
    const runPath = join(directory, 'run.json');
    if (!existsSync(runPath)) {
        return { verdict: 'FAIL', reason: 'no run.json — the run never started', runId: null, required: 0, passed: 0, missing: [], failed: [] };
    }
    let run: RunFile;
    try {
        run = JSON.parse(readFileSync(runPath, 'utf-8')) as RunFile;
    } catch (err) {
        return { verdict: 'FAIL', reason: `run.json is not readable: ${String(err)}`, runId: null, required: 0, passed: 0, missing: [], failed: [] };
    }
    const required = run.requiredCheckpoints ?? [];
    const latest = new Map(readRecords(directory).map((r) => [r.checkpointId, r]));
    const missing: string[] = [];
    const failed: string[] = [];
    let passed = 0;
    for (const id of required) {
        const record = latest.get(id);
        if (!record) missing.push(id);
        else if (record.verdict !== 'PASS') failed.push(id);
        else passed += 1;
    }
    // An empty required list proves nothing: it would let any exit-0 run pass.
    if (required.length === 0) {
        return { verdict: 'FAIL', reason: 'requiredCheckpoints is empty — a run that requires nothing proves nothing', runId: run.runId ?? null, required: 0, passed: 0, missing, failed };
    }
    if (missing.length || failed.length) {
        const parts = [];
        if (missing.length) parts.push(`missing ${missing.join(', ')}`);
        if (failed.length) parts.push(`failed ${failed.join(', ')}`);
        return {
            verdict: 'FAIL',
            reason: `${passed}/${required.length} checkpoints PASS (${parts.join('; ')})`,
            runId: run.runId ?? null,
            required: required.length,
            passed,
            missing,
            failed,
        };
    }
    return {
        verdict: 'PASS',
        reason: `${passed}/${required.length} checkpoints PASS`,
        runId: run.runId ?? null,
        required: required.length,
        passed,
        missing,
        failed,
    };
}
