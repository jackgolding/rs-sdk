import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PLANNER = join(import.meta.dir, 'legends-planner.ts');
const LV = (o: Record<string, number> = {}) => ({ Magic: 70, Mining: 60, Agility: 60, Crafting: 60, Smithing: 60, Strength: 99, Thieving: 99, Woodcutting: 99, Herblore: 60, Prayer: 60, Fishing: 99, Cooking: 99, Ranged: 60, Attack: 99, Defence: 99, Hitpoints: 99, ...o });
const DONE_HEROES_PREREQS = ['lostcity', 'arthur', 'dragon'];

function fleet(accounts: Array<{ name: string; done?: string[]; levels?: Record<string, number>; swarm?: boolean; skip?: boolean; gang?: string; items?: any[]; legendsLog?: boolean }>) {
    const root = mkdtempSync(join(tmpdir(), 'planner-'));
    const bots = join(root, 'bots'), state = join(root, 'state');
    mkdirSync(bots);
    mkdirSync(state);
    const todo: Record<string, any[]> = {};
    for (const a of accounts) {
        const dir = join(bots, a.name);
        mkdirSync(dir);
        const st: Record<string, any> = {};
        todo[a.name] = [...(a.items ?? [])];
        for (const id of a.done ?? []) st[id] = { done: { at: '2026-11-01T00:00:00Z', runId: 'x' } };
        writeFileSync(join(dir, 'todo-state.json'), JSON.stringify(st));
        writeFileSync(join(dir, 'heartbeat.log'), JSON.stringify({ levels: a.levels ?? LV() }) + '\n');
        writeFileSync(join(dir, 'grind.log'), a.legendsLog ? '2026-11-08T00:00:00.000Z [legends] QUEST COMPLETE (journal-verified)\n' : '');
        if (a.gang) writeFileSync(join(dir, 'quest-tags.json'), JSON.stringify({ arravGang: a.gang }));
    }
    writeFileSync(join(bots, 'roster.json'), JSON.stringify({ bots: accounts.map((a) => ({ name: a.name, script: 'bots/quests/todo-runner.ts', args: [a.name] })) }));
    writeFileSync(join(bots, 'todo.json'), JSON.stringify({ schemaVersion: 1, accounts: todo }));
    writeFileSync(join(bots, 'swarm.json'), JSON.stringify({ accounts: accounts.filter((a) => a.swarm).map((a) => ({ name: a.name, job: 'knights' })) }));
    writeFileSync(join(state, 'skip-bots.txt'), accounts.filter((a) => a.swarm || a.skip).map((a) => a.name).join('\n') + '\n');
    const run = (...args: string[]) => {
        const services = accounts.flatMap((a) => [`quest-${a.name.toLowerCase()}`, `lite-${a.name.toLowerCase()}`]).join(',');
        const r = Bun.spawnSync(['bun', PLANNER, ...args], { env: { ...process.env, FLEET_BOTS_DIR: bots, FLEET_STATE_DIR: state, FLEET_PLANNER_NO_DOCKER: '1', FLEET_PLANNER_SERVICES: services } });
        if (r.exitCode !== 0) throw new Error(r.stderr.toString());
        return r.stdout.toString();
    };
    const list = (name: string) => (JSON.parse(readFileSync(join(bots, 'todo.json'), 'utf8')).accounts[name] as any[]) ?? [];
    return { bots, state, run, list };
}

describe('legends planner', () => {
    test('queues the chain, pairs Arrav at the front of both lists, and is idempotent', () => {
        const f = fleet([{ name: 'A1', done: DONE_HEROES_PREREQS }, { name: 'A2', done: DONE_HEROES_PREREQS }]);
        const out = f.run();
        expect(out).toContain('PAIR arrav: A1 (phoenix) + A2 (blackarm)');
        expect(out).toContain('(would restart: A1, A2)');
        const l1 = f.list('A1');
        expect(l1[0]).toMatchObject({ questId: 'arrav', script: 'bots/quests/shield-of-arrav.ts', args: ['--gang=phoenix', '--partner=A2'] });
        expect(f.list('A2')[0]).toMatchObject({ args: ['--gang=blackarm', '--partner=A1'] });
        const ids = l1.map((i) => i.questId);
        for (const id of ['crest', 'zombiequeen', 'upass', 'waterfall', 'junglepotion', 'biohazard', 'elena']) expect(ids).toContain(id);
        expect(ids).not.toContain('heroes'); // paired later, once Arrav is done
        // Legends: held, these fixture accounts are far short of 107 QP.
        expect(ids).not.toContain('legends');
        expect(out).toContain('Legends held until 107 QP');
        const before = JSON.stringify(f.list('A1'));
        const again = f.run();
        expect(JSON.stringify(f.list('A1'))).toBe(before);
        expect(again).not.toContain('PAIR');
    });

    test('Heroes pairs opposite gangs once the prerequisites are done', () => {
        const pre = ['arrav', ...DONE_HEROES_PREREQS];
        const f = fleet([
            { name: 'P1', done: pre, gang: 'phoenix' },
            { name: 'B1', done: pre, gang: 'blackarm' },
            { name: 'P2', done: pre, gang: 'phoenix' },
        ]);
        const out = f.run();
        expect(out).toContain('PAIR heroes: P1 (phoenix) + B1 (blackarm)');
        expect(out).toContain('P2: Heroes ready, waits for a Black Arm partner');
        expect(f.list('B1')[0]).toMatchObject({ questId: 'heroes', capMin: 300, args: ['--gang=blackarm', '--partner=P1'] });
    });

    test('training: Magic by alchemy and Smithing by Knight\'s Sword go first; untrainable skills are reported', () => {
        const f = fleet([{ name: 'T1', levels: LV({ Magic: 44, Smithing: 1, Herblore: 29 }) }]);
        const out = f.run();
        const l = f.list('T1');
        const at = (id: string) => l.findIndex((i) => i.questId === id);
        expect(l.find((i) => i.questId === 'alch-59')).toMatchObject({ script: 'bots/quests/alch-train.ts', args: ['--until=59'] });
        expect(at('squire')).toBeGreaterThanOrEqual(0);
        expect(at('alch-59')).toBeLessThan(at('crest'));
        expect(at('squire')).toBeLessThan(at('crest'));
        expect(out).toContain('herblore 29/45 (no trainer');
    });

    test('promotes swarm accounts under the cap, leaves skip-bots ones, skips finished accounts', () => {
        const f = fleet([{ name: 'S1', swarm: true }, { name: 'S2', swarm: true }, { name: 'K1', skip: true }, { name: 'D1', legendsLog: true }]);
        const out = f.run();
        expect(out).toContain('promoting from the swarm: S1, S2');
        expect(out).toContain('K1 (skip-bots');
        expect(out).not.toContain('D1');
        const swarm = JSON.parse(readFileSync(join(f.bots, 'swarm.json'), 'utf8')).accounts;
        expect(swarm).toEqual([]);
        expect(readFileSync(join(f.state, 'skip-bots.txt'), 'utf8').trim()).toBe('K1');
        expect(f.list('S1')[0]).toMatchObject({ questId: 'arrav', args: ['--gang=phoenix', '--partner=S2'] });
        // Promoted accounts start fresh: no restart for them.
        expect(out).not.toContain('would restart');
    });

    test('--dry writes nothing', () => {
        const f = fleet([{ name: 'A1' }, { name: 'A2' }, { name: 'S1', swarm: true }]);
        const todo = readFileSync(join(f.bots, 'todo.json'), 'utf8');
        const swarm = readFileSync(join(f.bots, 'swarm.json'), 'utf8');
        f.run('--dry');
        expect(readFileSync(join(f.bots, 'todo.json'), 'utf8')).toBe(todo);
        expect(readFileSync(join(f.bots, 'swarm.json'), 'utf8')).toBe(swarm);
    });

    test('an exhausted Legends-path quest is re-added only after 12 h', () => {
        const recent = new Date(Date.now() - 2 * 3600_000).toISOString();
        const old = new Date(Date.now() - 13 * 3600_000).toISOString();
        const f = fleet([
            { name: 'R1', items: [{ questId: 'crest', script: 'bots/quests/crest.ts' }] },
            { name: 'R2', items: [{ questId: 'crest', script: 'bots/quests/crest.ts' }] },
        ]);
        writeFileSync(join(f.bots, 'R1', 'todo-state.json'), JSON.stringify({ crest: { failures: 2, lastAt: recent } }));
        writeFileSync(join(f.bots, 'R2', 'todo-state.json'), JSON.stringify({ crest: { failures: 2, lastAt: old } }));
        f.run();
        expect(f.list('R1').map((i) => i.questId)).not.toContain('crest-lp1');
        expect(f.list('R2').map((i) => i.questId)).toContain('crest-lp1');
    });
});
