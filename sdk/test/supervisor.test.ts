import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, renameSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
    dockerContainerName,
    dockerNameFilter,
    parseDockerInspect,
    resolveSupervisorOwner,
    supervisorKind,
} from '../../.cursor/skills/wake-fleet/scripts/supervisor';

/** Captured shape of `docker inspect fleet-quest-abgarmy01-1` (compose project `fleet`). */
const INSPECT_RUNNING = [
    {
        Id: 'abc123',
        Name: '/fleet-quest-abgarmy01-1',
        Path: 'bun',
        Args: ['bots/quests/fishing-route.ts', 'ABGARMY01', '--bignet'],
        State: { Status: 'running', Running: true, Pid: 4242, ExitCode: 0 },
        RestartCount: 1,
        Config: { Entrypoint: null, Cmd: ['bun', 'bots/quests/fishing-route.ts', 'ABGARMY01', '--bignet'] },
    },
];

const INSPECT_EXITED = [
    {
        Id: 'def456',
        Name: '/fleet-quest-abgarmy02-1',
        Path: 'bun',
        Args: ['bots/quests/essence.ts', 'ABGARMY02'],
        State: { Status: 'exited', Running: false, Pid: 0, ExitCode: 70 },
        RestartCount: 3,
        Config: { Entrypoint: null, Cmd: ['bun', 'bots/quests/essence.ts', 'ABGARMY02'] },
    },
];

describe('docker supervisor backend', () => {
    test('container names mirror gen-compose.py quest services', () => {
        expect(dockerContainerName('ABGARMY01')).toBe('quest-abgarmy01');
        expect(dockerContainerName('Jackpoo1')).toBe('quest-jackpoo1');
        expect(dockerNameFilter('ABGARMY01')).toBe('quest-abgarmy01');
    });

    test('supervisor defaults to launchd, unknown values fall back', () => {
        delete process.env.FLEET_SUPERVISOR;
        expect(supervisorKind()).toBe('launchd');
        process.env.FLEET_SUPERVISOR = 'bogus';
        expect(supervisorKind()).toBe('launchd');
        process.env.FLEET_SUPERVISOR = 'docker';
        expect(supervisorKind()).toBe('docker');
        delete process.env.FLEET_SUPERVISOR;
    });

    test('running containers parse to a live supervisor', () => {
        expect(parseDockerInspect(INSPECT_RUNNING)).toEqual({
            loaded: true,
            pid: 4242,
            runs: 1,
            lastExit: '0',
            state: 'running',
            programArgs: ['bun', 'bots/quests/fishing-route.ts', 'ABGARMY01', '--bignet'],
        });
    });

    test('exited containers stay loaded with their exit code', () => {
        expect(parseDockerInspect(INSPECT_EXITED)).toEqual({
            loaded: true,
            pid: null,
            runs: 3,
            lastExit: '70',
            state: 'exited',
            programArgs: ['bun', 'bots/quests/essence.ts', 'ABGARMY02'],
        });
    });

    test('empty inspect output is not live', () => {
        expect(parseDockerInspect([])).toEqual({ loaded: false });
        expect(parseDockerInspect(null)).toEqual({ loaded: false });
        expect(parseDockerInspect([{ State: null }])).toEqual({ loaded: false });
    });

    test('matching record on a running container is a live supervised owner', () => {
        const root = mkdtempSync(join(tmpdir(), 'supervisor-live-'));
        const command = 'bun bots/quests/fishing-route.ts ABGARMY01 --bignet';
        writeFileSync(
            join(root, 'assignment.json'),
            JSON.stringify({
                name: 'ABGARMY01',
                pid: 7,
                argv: ['bots/quests/fishing-route.ts', 'ABGARMY01', '--bignet'],
                command,
                startedAt: '2026-10-15T00:00:00.000Z',
                source: 'connect',
            })
        );
        // assignmentPath joins root/bots/<name>/assignment.json.
        const scoped = join(root, 'bots', 'ABGARMY01');
        mkdirSync(scoped, { recursive: true });
        renameSync(join(root, 'assignment.json'), join(scoped, 'assignment.json'));
        const info = parseDockerInspect(INSPECT_RUNNING);
        expect(resolveSupervisorOwner('ABGARMY01', info, { root, expectedCommand: command })).toEqual({
            pid: 4242,
            command,
            supervised: true,
            startedAt: '2026-10-15T00:00:00.000Z',
            legacy: false,
        });
    });

    test('running container without a record is the legacy owner', () => {
        const root = mkdtempSync(join(tmpdir(), 'supervisor-legacy-'));
        const info = parseDockerInspect(INSPECT_RUNNING);
        const owner = resolveSupervisorOwner('ABGARMY01', info, {
            root,
            expectedCommand: 'bun bots/quests/fishing-route.ts ABGARMY01 --bignet',
        });
        expect(owner).toEqual({
            pid: 4242,
            command: 'bun bots/quests/fishing-route.ts ABGARMY01 --bignet',
            supervised: true,
            startedAt: null,
            legacy: true,
        });
    });

    test('no container means no owner', () => {
        expect(resolveSupervisorOwner('ABGARMY01', { loaded: false })).toBeNull();
    });
});
