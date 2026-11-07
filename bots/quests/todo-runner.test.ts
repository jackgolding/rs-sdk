/** The real runner against fake quest scripts in a temp cwd; no game involved. */
import { afterEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const RUNNER = resolve(import.meta.dir, 'todo-runner.ts');
let dir = '';
afterEach(() => dir && rmSync(dir, { recursive: true, force: true }));

interface Fake {
    id: string;
    /** Printed, then exit code; the n-th run takes the n-th entry (last repeats). */
    runs: Array<{ out?: string; code?: number }>;
    script?: string;
}
function setUp(items: Fake[], state: unknown = {}) {
    dir = mkdtempSync(join(tmpdir(), 'todo-runner-'));
    const bots = join(dir, 'bots');
    mkdirSync(join(bots, 'quests'), { recursive: true });
    mkdirSync(join(bots, 'acct'));
    writeFileSync(join(bots, 'acct', 'todo-state.json'), JSON.stringify(state));
    const list = items.map((f) => {
        const script = `bots/quests/${f.script ?? f.id}.ts`;
        writeFileSync(
            join(dir, script),
            `import { appendFileSync, readFileSync } from 'node:fs';
const log = ${JSON.stringify(join(dir, 'calls.log'))};
appendFileSync(log, ${JSON.stringify(f.id)} + '\\n');
const n = readFileSync(log, 'utf-8').split('\\n').filter((l) => l === ${JSON.stringify(f.id)}).length;
const runs = ${JSON.stringify(f.runs)};
const r = runs[Math.min(n, runs.length) - 1];
if (r.out) console.log(r.out);
process.exit(r.code ?? 0);
`
        );
        return { questId: f.id, script, addedAt: 'x', canaryRunId: 'x' };
    });
    writeFileSync(join(bots, 'todo.json'), JSON.stringify({ schemaVersion: 1, accounts: { acct: list } }));
}
/** Runs until the list is finished and the runner parks, then stops it. */
async function run(): Promise<{ calls: string[]; state: Record<string, any>; out: string }> {
    const proc = Bun.spawn(['bun', RUNNER, 'acct'], { cwd: dir, stdout: 'pipe', stderr: 'inherit' });
    let out = '';
    const reader = proc.stdout.getReader();
    const dec = new TextDecoder();
    for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        out += dec.decode(value);
        if (/nothing to hand over/.test(out)) break;
    }
    proc.kill('SIGKILL');
    await proc.exited;
    const calls = existsSync(join(dir, 'calls.log')) ? readFileSync(join(dir, 'calls.log'), 'utf-8').trim().split('\n') : [];
    return { calls, state: JSON.parse(readFileSync(join(dir, 'bots', 'acct', 'todo-state.json'), 'utf-8')), out };
}
const JOURNAL = { out: 'QUEST COMPLETE (journal-verified)' };

describe('todo-runner', () => {
    test('a journal-verified finish under another id passes (no false failure)', async () => {
        setUp([{ id: 'heroes', script: 'heroes-quest', runs: [JOURNAL] }]);
        const { state, calls } = await run();
        expect(calls).toEqual(['heroes']);
        expect(state.heroes.done).toBeTruthy();
        expect(state.heroes.failures).toBeUndefined();
    });

    test('Heroes does not start after Dragon Slayer gave up', async () => {
        setUp([
            { id: 'dragon', runs: [{ code: 1 }] },
            { id: 'cook', runs: [JOURNAL] },
            { id: 'heroes', script: 'heroes-quest', runs: [JOURNAL] },
        ]);
        const { calls, out } = await run();
        expect(calls).not.toContain('heroes');
        expect(out).toContain('heroes(blocked by dragon)');
    });

    test('a Legends prerequisite retries at once; other quests wait for the second pass', async () => {
        setUp([
            { id: 'upass', script: 'underground-pass', runs: [{ code: 1 }, JOURNAL] },
            { id: 'cook', runs: [{ code: 1 }, JOURNAL] },
            { id: 'tea', runs: [JOURNAL] },
        ]);
        const { calls } = await run();
        expect(calls).toEqual(['upass', 'upass', 'cook', 'tea', 'cook']);
    });

    test('an earlier failure on the Legends path runs first on a fresh start', async () => {
        setUp(
            [
                { id: 'cook', runs: [JOURNAL] },
                { id: 'upass', script: 'underground-pass', runs: [JOURNAL] },
            ],
            { upass: { failures: 1 } }
        );
        const { calls } = await run();
        expect(calls).toEqual(['upass', 'cook']);
    });

    test('NEEDS STOCK pauses without a failure and does not retry while waiting', async () => {
        setUp([{ id: 'legends', script: 'legends-quest', runs: [{ out: 'NEEDS STOCK: opal ×1 — stock', code: 4 }] }]);
        const { calls, state } = await run();
        expect(calls).toEqual(['legends']);
        expect(state.legends.failures).toBeUndefined();
        expect(state.legends.wait.kind).toBe('stock');
        expect(state.legends.wait.short).toEqual([{ item: 'opal', count: 1 }]);
    });

    test('a prerequisite gate pauses without a failure', async () => {
        setUp([{ id: 'heroes', script: 'heroes-quest', runs: [{ out: 'prerequisite gate: Dragon Slayer not complete', code: 5 }] }]);
        const { state } = await run();
        expect(state.heroes.failures).toBeUndefined();
        expect(state.heroes.wait.why).toContain('Dragon Slayer');
    });

    test('the mule showing the stock ends a wait once the floor has passed', async () => {
        const long = new Date(Date.now() + 3_600_000).toISOString();
        const old = new Date(Date.now() - 20 * 60_000).toISOString();
        setUp([{ id: 'legends', script: 'legends-quest', runs: [JOURNAL] }], {
            legends: { wait: { kind: 'stock', why: 'opal ×1', since: old, lastAt: old, until: long, attempts: 1, short: [{ item: 'opal', count: 1 }] } },
        });
        mkdirSync(join(dir, 'bots', '.mule-stock'));
        writeFileSync(join(dir, 'bots', '.mule-stock', 'jackthief.json'), JSON.stringify({ at: Date.now(), items: { opal: 2 } }));
        const { calls, state } = await run();
        expect(calls).toEqual(['legends']);
        expect(state.legends.wait).toBeUndefined();
    });

    test('todo-rearm.json clears failures and is consumed', async () => {
        setUp([{ id: 'cook', runs: [JOURNAL] }], { cook: { failures: 2, lastError: 'exited 4' } });
        writeFileSync(join(dir, 'bots', 'acct', 'todo-rearm.json'), JSON.stringify(['cook']));
        const { calls } = await run();
        expect(calls).toEqual(['cook']);
        expect(existsSync(join(dir, 'bots', 'acct', 'todo-rearm.json'))).toBe(false);
    });

    test('exit 0 with no evidence still fails', async () => {
        setUp([{ id: 'cook', runs: [{ out: 'bye' }] }]);
        const { state } = await run();
        expect(state.cook.failures).toBe(2);
        expect(state.cook.lastError).toContain('no run record');
    });
});
