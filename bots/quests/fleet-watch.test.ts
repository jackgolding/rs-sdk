/** infra/pilot/fleet-watch.py against a fake bots/ and state/. */
import { afterEach, beforeEach, expect, test } from 'bun:test';
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { LEGENDS_PATH } from './todo-logic';

const SCRIPT = resolve(import.meta.dir, '../../infra/pilot/fleet-watch.py');
let root = '';
const bots = () => join(root, 'bots');
const state = () => join(root, 'state');
const alerts = () => (existsSync(join(state(), 'fleet-alerts.log')) ? readFileSync(join(state(), 'fleet-alerts.log'), 'utf-8') : '');
const run = async (running = 'a') => {
    const p = Bun.spawn(['python3', SCRIPT], { env: { ...process.env, FLEET_BOTS_DIR: bots(), FLEET_STATE_DIR: state(), FLEET_WATCH_RUNNING: running }, stdout: 'pipe', stderr: 'pipe' });
    expect(await p.exited).toBe(0);
};
const todo = (questId: string, script: string) =>
    writeFileSync(join(bots(), 'todo.json'), JSON.stringify({ accounts: { a: [{ questId, script: `bots/quests/${script}.ts` }] } }));
const todoState = (s: unknown) => writeFileSync(join(bots(), 'a', 'todo-state.json'), JSON.stringify(s));

beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'fleet-watch-'));
    mkdirSync(join(bots(), 'a'), { recursive: true });
    mkdirSync(state());
    writeFileSync(join(bots(), 'roster.json'), JSON.stringify({ bots: [{ name: 'a', args: [] }] }));
    writeFileSync(join(bots(), 'a', 'grind.log'), 'old\n');
    todo('x', 'other');
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

test('its Legends path list matches the runner', () => {
    const m = /LEGENDS_PATH = \{([^}]+)\}/.exec(readFileSync(SCRIPT, 'utf-8'))!;
    expect(new Set([...m[1]!.matchAll(/"([^"]+)"/g)].map((x) => x[1]))).toEqual(new Set(LEGENDS_PATH));
});

test('a death after the first look is flagged once; history is not', async () => {
    appendFileSync(join(bots(), 'a', 'grind.log'), '2026-01-01T00:00:00Z [x] Died @ 1,2\n');
    await run();
    expect(alerts()).toBe('');
    appendFileSync(join(bots(), 'a', 'grind.log'), '2026-01-01T00:00:09Z [legends] DEATH at (2809,9313,L0)\n');
    await run();
    await run();
    expect(alerts().match(/DEATH a:/g)?.length).toBe(1);
});

test('a real second failure on the path is only recorded, once', async () => {
    todo('upass', 'underground-pass');
    todoState({ upass: { failures: 2, lastError: 'exited 1', lastAt: new Date().toISOString() } });
    await run();
    await run();
    expect(alerts().match(/GAVE_UP a: upass/g)?.length).toBe(1);
    expect(existsSync(join(bots(), 'a', 'todo-rearm.json'))).toBe(false);
});

test('a stock-only failure is re-armed, twice a day at most, then recorded', async () => {
    todo('legends', 'legends-quest');
    todoState({ legends: { failures: 2, lastError: 'exited 4', lastAt: new Date().toISOString() } });
    await run();
    const rearm = join(bots(), 'a', 'todo-rearm.json');
    expect(JSON.parse(readFileSync(rearm, 'utf-8'))).toEqual(['legends']);
    rmSync(rearm);
    await run();
    rmSync(rearm);
    await run();
    expect(existsSync(rearm)).toBe(false);
    expect(alerts().match(/REARMED/g)?.length).toBe(2);
    expect(alerts()).toContain('GAVE_UP a: legends');
});

test('old failures and quests settled by a later copy or by Legends are left alone', async () => {
    const fresh = new Date().toISOString();
    todo('upass', 'underground-pass');
    todoState({ upass: { failures: 2, lastError: 'exited 4', lastAt: new Date(Date.now() - 7 * 3600_000).toISOString() } });
    await run();
    expect(alerts()).toBe('');
    writeFileSync(
        join(bots(), 'todo.json'),
        JSON.stringify({ accounts: { a: [{ questId: 'upass', script: 'bots/quests/underground-pass.ts' }, { questId: 'upass-2', script: 'bots/quests/underground-pass.ts', done: { at: fresh } }] } })
    );
    todoState({ upass: { failures: 2, lastError: 'exited 4', lastAt: fresh } });
    await run();
    expect(alerts()).toBe('');
    expect(existsSync(join(bots(), 'a', 'todo-rearm.json'))).toBe(false);
});

test('a quest off the path is left alone', async () => {
    todoState({ x: { failures: 2, lastError: 'exited 1' } });
    await run();
    expect(alerts()).toBe('');
});

test('stalled and down are flagged; skip-bots is not', async () => {
    const old = Date.now() / 1000 - 3600;
    utimesSync(join(bots(), 'a', 'grind.log'), old, old);
    await run();
    expect(alerts()).toContain('STALLED a');
    rmSync(join(state(), 'fleet-alerts.log'));
    await run('');
    expect(alerts()).toContain('DOWN a');
    rmSync(join(state(), 'fleet-alerts.log'));
    rmSync(join(state(), 'fleet-watch.json'));
    writeFileSync(join(state(), 'skip-bots.txt'), 'a\n');
    await run('');
    expect(alerts()).toBe('');
});

test('a long stock wait is flagged', async () => {
    todo('legends', 'legends-quest');
    todoState({ legends: { wait: { kind: 'stock', since: new Date(Date.now() - 3 * 3600_000).toISOString(), why: 'opal ×1' } } });
    await run();
    expect(alerts()).toContain('STOCK_WAIT a: legends');
});
