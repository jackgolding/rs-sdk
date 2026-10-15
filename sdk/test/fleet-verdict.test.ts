import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
    classify,
    formatHeadline,
    summarize,
    type ClassifyInput,
    type VerdictKind,
} from '../../.cursor/skills/wake-fleet/scripts/fleet-verdict';
import type { RosterBot } from '../../.cursor/skills/wake-fleet/scripts/roster';
import type { HeartbeatRecord } from '../../.cursor/skills/wake-fleet/scripts/fleet-rates';

const NOW = 1_700_000_000_000;
const FIX = join(import.meta.dir, 'fixtures/telemetry');

function bot(partial: Partial<RosterBot> = {}): RosterBot {
    return {
        name: 'TestBot',
        view: 't',
        script: 'bots/quests/fishing-route.ts',
        args: ['TestBot'],
        command: 'bun bots/quests/fishing-route.ts TestBot',
        paused: false,
        pauseSource: null,
        bursty: false,
        noEffectMinutes: 15,
        ...partial,
    };
}

function snap(t: number, fishing: number, extra: Partial<HeartbeatRecord> = {}): HeartbeatRecord {
    return {
        t,
        session: 1,
        job: 'fishing-route',
        xp: { Hitpoints: 1154, fishing },
        coins: 100,
        x: 2840,
        z: 3430,
        pid: 100,
        lastEffectAt: t,
        ...extra,
    };
}

function base(over: Partial<ClassifyInput> = {}): ClassifyInput {
    return {
        bot: bot(),
        now: NOW,
        gateway: { reachable: true, status: 'ok', inGame: true, stateAge: 1000, controllers: 1, x: 2840, z: 3430 },
        owner: {
            pid: 100,
            command: 'bun bots/quests/fishing-route.ts TestBot',
            supervised: true,
            startedAt: new Date(NOW - 3 * 60 * 60 * 1000).toISOString(),
            legacy: false,
        },
        recordedCommand: 'bun bots/quests/fishing-route.ts TestBot',
        launchd: { loaded: true, pid: 100, runs: 1, lastExit: null, state: 'running', programArgs: [] },
        runsSamples: [{ t: NOW - 61 * 60 * 1000, runs: 1 }],
        snapshots: [snap(NOW - 20 * 60 * 1000, 1000), snap(NOW - 3 * 60 * 1000, 8000)],
        events: [],
        grindTail: [],
        shepherd: { capped: false, cappedAt: null, actions: [], restarts: [] },
        ...over,
    };
}

describe('fleet verdict precedence', () => {
    const cases: Array<{ name: string; kind: VerdictKind; check: string; input: ClassifyInput }> = [
        {
            name: 'paused',
            kind: 'paused',
            check: 'paused',
            input: base({ bot: bot({ paused: true, pauseSource: 'skip-bots' }), gateway: { reachable: false, fetchErr: 'down' } }),
        },
        {
            name: 'needs-client unreachable',
            kind: 'needs-client',
            check: 'no_live_state',
            input: base({ gateway: { reachable: false, fetchErr: 'timeout' } }),
        },
        {
            name: 'needs-client logged out',
            kind: 'needs-client',
            check: 'logged_out',
            input: base({ gateway: { reachable: true, status: 'dead', inGame: false, stateAge: 0, controllers: 0 } }),
        },
        {
            name: 'needs-client stale',
            kind: 'needs-client',
            check: 'no_live_state',
            input: base({ gateway: { reachable: true, status: 'ok', inGame: true, stateAge: 9_000, controllers: 1 } }),
        },
        {
            name: 'capped',
            kind: 'capped',
            check: 'capped',
            input: base({ shepherd: { capped: true, cappedAt: NOW - 60_000, actions: [], restarts: [NOW - 1000] } }),
        },
        {
            name: 'churning',
            kind: 'churning',
            check: 'churn',
            input: base({
                bot: bot({ name: 'jacklove10' }),
                launchd: { loaded: true, pid: 100, runs: 6, lastExit: '70', state: 'running', programArgs: [] },
                runsSamples: [{ t: NOW - 61 * 60 * 1000, runs: 0 }],
            }),
        },
        {
            name: 'needs-supplies text',
            kind: 'needs-supplies',
            check: 'supplies',
            input: base({
                bot: bot({ name: 'jackthief', script: 'bots/quests/green-dragons.ts', command: 'bun bots/quests/green-dragons.ts jackthief', args: ['jackthief'] }),
                events: null,
                grindTail: readFileSync(join(FIX, 'grind-tail-green-dragons.txt'), 'utf-8').split('\n').filter(Boolean),
                owner: {
                    pid: 100,
                    command: 'bun bots/quests/green-dragons.ts jackthief',
                    supervised: true,
                    startedAt: new Date(NOW - 60 * 60 * 1000).toISOString(),
                    legacy: false,
                },
            }),
        },
        {
            name: 'foreign-owner',
            kind: 'foreign-owner',
            check: 'foreign_owner',
            input: base({
                bot: bot({ name: 'jacklove4', command: 'bun bots/quests/fishing-route.ts jacklove4', args: ['jacklove4'] }),
                owner: {
                    pid: 55,
                    command: 'bun bots/quests/converge-and-accept-trade.ts --accept-only',
                    supervised: false,
                    startedAt: new Date(NOW - 60 * 60 * 1000).toISOString(),
                    legacy: false,
                },
                snapshots: [snap(NOW - 30 * 60 * 1000, 1000, { lastEffectAt: NOW - 30 * 60 * 1000 })],
            }),
        },
        {
            name: 'alive telemetry silent',
            kind: 'alive-not-producing',
            check: 'telemetry_silent',
            input: base({
                bot: bot({ name: 'Jackpoo1', script: 'bots/quests/magic-trees.ts', command: 'bun bots/quests/magic-trees.ts Jackpoo1', args: ['Jackpoo1'] }),
                owner: {
                    pid: 36569,
                    command: 'bun bots/quests/magic-trees.ts Jackpoo1',
                    supervised: true,
                    startedAt: new Date(NOW - 5 * 60 * 60 * 1000).toISOString(),
                    legacy: false,
                },
                snapshots: [snap(NOW - 267 * 60 * 1000, 1000, { pid: 36569, lastEffectAt: NOW - 267 * 60 * 1000 })],
            }),
        },
        {
            name: 'alive no controller',
            kind: 'alive-not-producing',
            check: 'no_controller',
            input: base({ gateway: { reachable: true, status: 'ok', inGame: true, stateAge: 500, controllers: 0, x: 1, z: 2 } }),
        },
        {
            name: 'producing',
            kind: 'producing',
            check: 'ok',
            input: base(),
        },
        {
            name: 'finished',
            kind: 'finished',
            check: 'finished',
            input: base({
                owner: null,
                launchd: { loaded: true, pid: null, runs: 3, lastExit: '0', state: 'waiting', programArgs: [] },
                events: [],
            }),
        },
        {
            name: 'restartable',
            kind: 'restartable',
            check: 'restartable',
            input: base({
                owner: null,
                launchd: { loaded: true, pid: null, runs: 2, lastExit: '70', state: 'waiting', programArgs: [] },
            }),
        },
    ];

    for (const spec of cases) {
        test(`${spec.name} → ${spec.kind}/${spec.check}`, () => {
            const row = classify(spec.input);
            expect(row.kind).toBe(spec.kind);
            expect(row.check).toBe(spec.check);
        });
    }

    test('Jackpoo1 snapshot 267m old is telemetry_silent', () => {
        const row = classify(cases.find((c) => c.name === 'alive telemetry silent')!.input);
        expect(row.kind).toBe('alive-not-producing');
        expect(row.check).toBe('telemetry_silent');
        expect(row.minutesSinceSnapshot).toBe(267);
    });

    test('jacklove10 with 6 relaunches is churning', () => {
        const row = classify(cases.find((c) => c.name === 'churning')!.input);
        expect(row.relaunches1h).toBe(6);
        expect(row.kind).toBe('churning');
    });

    test('container pids: host-pid owner sees container-pid records only with containerPids', () => {
        // Docker: quest script writes its container pid while the owner carries the host pid.
        const docker = base({
            owner: { pid: 1230928, command: 'bun bots/quests/fishing-route.ts TestBot', supervised: true, startedAt: null, legacy: false },
            snapshots: [snap(NOW - 3 * 60 * 1000, 8000, { pid: 1 })],
        });
        const blind = classify(docker);
        expect(blind.kind).toBe('alive-not-producing');
        expect(blind.check).toBe('no_effect');
        const seeing = classify({ ...docker, containerPids: true });
        expect(seeing.kind).toBe('producing');
        expect(seeing.minutesSinceSnapshot).toBe(3);
    });

    test('headline counts exclude paused from notProducing', () => {
        const rows = [
            classify(base()),
            classify(base({ bot: bot({ name: 'Idle', paused: false }), gateway: { reachable: false, fetchErr: 'down' } })),
            classify(base({ bot: bot({ name: 'Hold', paused: true, pauseSource: 'skip-bots' }) })),
        ];
        const summary = summarize(rows);
        expect(summary.producing).toEqual(['TestBot']);
        expect(summary.notProducing).toEqual(['Idle']);
        expect(summary.notProducing).not.toContain('Hold');
        expect(formatHeadline(summary.producing.length, summary.notProducing)).toBe('1 producing, 1 not producing');
        expect(formatHeadline(summary.producing.length, summary.notProducing, { names: true })).toBe(
            '1 producing, 1 not producing: Idle'
        );
    });

    test('no-effect threshold: default 16m fails, override 45 holds, bursty 89 holds', () => {
        const staleEffect = [
            snap(NOW - 30 * 60 * 1000, 1000, { lastEffectAt: NOW - 16 * 60 * 1000 }),
            snap(NOW - 60 * 1000, 1000, { lastEffectAt: NOW - 16 * 60 * 1000 }),
        ];
        expect(classify(base({ snapshots: staleEffect })).kind).toBe('alive-not-producing');
        expect(classify(base({ snapshots: staleEffect })).check).toBe('no_effect');
        expect(classify(base({ bot: bot({ noEffectMinutes: 45 }), snapshots: staleEffect })).kind).toBe('producing');

        const burstySnaps = [
            snap(NOW - 100 * 60 * 1000, 1000, { lastEffectAt: NOW - 89 * 60 * 1000 }),
            snap(NOW - 60 * 1000, 1000, { lastEffectAt: NOW - 89 * 60 * 1000 }),
        ];
        expect(classify(base({ bot: bot({ bursty: true, noEffectMinutes: 90 }), snapshots: burstySnaps })).kind).toBe('producing');
    });
});

describe('restart command and drift', () => {
    test('restartCommand is always the roster command', () => {
        const row = classify(base());
        expect(row.restartCommand).toBe('bun bots/quests/fishing-route.ts TestBot');
        expect(row.drift).toBeNull();
    });

    test('drift is set when the owner command differs and null when it matches', () => {
        const drifted = classify(
            base({
                owner: {
                    pid: 100,
                    command: 'bun bots/quests/thieving-route.ts TestBot',
                    supervised: true,
                    startedAt: null,
                    legacy: false,
                },
            })
        );
        expect(drifted.restartCommand).toBe('bun bots/quests/fishing-route.ts TestBot');
        expect(drifted.drift).toEqual({ owner: 'bun bots/quests/thieving-route.ts TestBot' });
        expect(classify(base()).drift).toBeNull();
    });

    test('a stopped bot whose last owner ran a one-off shows the roster restart plus drift', () => {
        const row = classify(
            base({
                owner: null,
                recordedCommand: 'bun bots/quests/unstuck.ts TestBot',
                launchd: { loaded: true, pid: null, runs: 1, lastExit: '0', state: 'waiting', programArgs: [] },
            })
        );
        expect(row.restartCommand).toBe('bun bots/quests/fishing-route.ts TestBot');
        expect(row.drift).toEqual({ owner: 'bun bots/quests/unstuck.ts TestBot' });
    });

    test('an unsupervised owner with drift is foreign-owner', () => {
        const row = classify(
            base({
                owner: {
                    pid: 7,
                    command: 'bun bots/quests/converge-and-accept-trade.ts --accept-only',
                    supervised: false,
                    startedAt: new Date(NOW - 60_000).toISOString(),
                    legacy: false,
                },
            })
        );
        expect(row.kind).toBe('foreign-owner');
        expect(row.drift?.owner).toContain('converge-and-accept-trade');
    });
});

describe('event detectors', () => {
    test('supply and repeat failures come from events when the log exists', () => {
        const supply = classify(
            base({
                events: [
                    { t: NOW - 60_000, pid: 100, type: 'failure', code: 'missing_supplies', count: 5, message: 'no super attack in bank' },
                ],
                grindTail: [],
            })
        );
        expect(supply.kind).toBe('needs-supplies');

        const repeat = classify(
            base({
                events: [{ t: NOW - 60_000, pid: 100, type: 'failure', code: 'bank', count: 8, message: 'Could not open bank' }],
            })
        );
        expect(repeat.kind).toBe('alive-not-producing');
        expect(repeat.check).toBe('repeat');
    });

    test('essence teleport failures do not mark a producing miner as not-producing', () => {
        const row = classify(
            base({
                bot: bot({
                    name: 'jacklove2',
                    script: 'bots/quests/essence.ts',
                    args: ['jacklove2'],
                    command: 'bun bots/quests/essence.ts jacklove2',
                }),
                events: [{ t: NOW - 60_000, pid: 100, type: 'failure', code: 'teleport', count: 11, message: 'Nothing happened' }],
                snapshots: [
                    snap(NOW - 5 * 60 * 1000, 1000, {
                        levels: { Hitpoints: 75, Attack: 99, Mining: 83, Fishing: 99 },
                    }),
                    snap(NOW - 60 * 1000, 8000, {
                        lastEffectAt: NOW - 60 * 1000,
                        levels: { Hitpoints: 75, Attack: 99, Mining: 83, Fishing: 99 },
                    }),
                ],
            })
        );
        expect(row.kind).toBe('producing');
        expect(row.levels?.Attack).toBe(99);
        expect(row.levels?.Mining).toBe(83);
    });

    test('levels come from the newest snapshot, never from XP', () => {
        const row = classify(
            base({
                snapshots: [
                    snap(NOW - 3 * 60 * 1000, 8_000, {
                        xp: { Hitpoints: 1154, Attack: 1_075_292 },
                        levels: { Hitpoints: 75, Attack: 99 },
                    }),
                ],
            })
        );
        expect(row.levels).toEqual({ Hitpoints: 75, Attack: 99 });
    });

    test('text fallback is used only when events.log is missing', () => {
        const tail = readFileSync(join(FIX, 'grind-tail-green-dragons.txt'), 'utf-8').split('\n').filter(Boolean);
        const missing = classify(base({ events: null, grindTail: tail }));
        expect(missing.kind).toBe('needs-supplies');
        const present = classify(base({ events: [], grindTail: tail }));
        expect(present.kind).not.toBe('needs-supplies');
    });
});
