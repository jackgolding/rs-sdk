import { describe, expect, test } from 'bun:test';
import { ActivitySession, nextWalkStep } from '../activity';
import type { BotSDK } from '../index';
import type { BotActions } from '../actions';

function mockPair(pos = { worldX: 2744, worldZ: 3444 }) {
    const walks: Array<[number, number]> = [];
    const sendWalks: Array<[number, number]> = [];
    const walkTos: Array<[number, number]> = [];
    const sdk = {
        getState: () => ({
            player: { worldX: pos.worldX, worldZ: pos.worldZ, level: 0 },
        }),
        showIntent: async () => ({ success: true, message: 'ok' }),
        sendWalk: async (x: number, z: number) => {
            walks.push([x, z]);
            sendWalks.push([x, z]);
            return { success: true };
        },
    } as unknown as BotSDK;
    const bot = {
        closeInterface: async () => ({ success: true }),
        dismissBlockingUI: async () => {},
        walkTo: async (x: number, z: number) => {
            walks.push([x, z]);
            walkTos.push([x, z]);
            return { success: true, message: 'ok' };
        },
    } as unknown as BotActions;
    return { sdk, bot, walks, sendWalks, walkTos };
}

describe('ActivitySession', () => {
    test('stalls after 2 minutes without progress', () => {
        let now = 1_000;
        const { sdk, bot } = mockPair();
        const session = new ActivitySession(sdk, bot, {
            name: 'bowstrings',
            now: () => now,
            writeLog: () => {},
        });
        expect(session.needsRecovery()).toBe(false);
        now += 119_999;
        expect(session.needsRecovery()).toBe(false);
        now += 2;
        expect(session.needsRecovery()).toBe(true);
    });

    test('stalls after 5 identical failures in the window', () => {
        const { sdk, bot } = mockPair();
        const session = new ActivitySession(sdk, bot, {
            name: 'bowstrings',
            now: () => 5_000,
            writeLog: () => {},
        });
        for (let i = 0; i < 4; i++) session.noteFailure('bank', 'Could not open Seers bank');
        expect(session.needsRecovery()).toBe(false);
        session.noteFailure('bank', 'Could not open Seers bank');
        expect(session.needsRecovery()).toBe(true);
    });

    test('noteProgress clears the repeat-fail window so the loop can leave recovery', async () => {
        const { sdk, bot } = mockPair();
        const session = new ActivitySession(sdk, bot, {
            name: 'essence',
            maxRecoveryTactics: 8,
            now: () => 5_000,
            writeLog: () => {},
        });
        session.registerRecovery([{ name: 'ok', run: async () => true }]);
        for (let i = 0; i < 5; i++) session.noteFailure('mine', 'No essence rock nearby');
        expect(session.needsRecovery()).toBe(true);
        expect(await session.recover()).toBe('resumed');
        expect(session.needsRecovery()).toBe(false);
    });

    test('recover resumes when a tactic reports progress and exhausts otherwise', async () => {
        const { sdk, bot, walks } = mockPair();
        let now = 1_000;
        const session = new ActivitySession(sdk, bot, {
            name: 'bowstrings',
            stallMs: 10,
            maxRecoveryTactics: 8,
            recoveryBudgetMs: 60_000,
            now: () => now,
            writeLog: () => {},
        });
        session.registerRecovery([
            { name: 'ok', run: async () => true },
        ]);
        now = 20;
        const resumed = await session.recover();
        expect(resumed).toBe('resumed');
        expect(session.isStopped()).toBe(false);

        let t2 = 0;
        const session2 = new ActivitySession(sdk, bot, {
            name: 'bowstrings',
            stallMs: 10,
            maxRecoveryTactics: 1,
            now: () => t2,
            writeLog: () => {},
        });
        t2 = 20;
        session2.registerRecovery([{ name: 'fail', run: async () => false }]);
        const exhausted = await session2.recover();
        expect(exhausted).toBe('resumed');
        expect(session2.isStopped()).toBe(false);
        expect(session2.metrics().stopReason).toBeNull();
        expect(session2.consumeFallback()).toBe(true);

        walks.length = 0;
        const again = await session2.recover();
        expect(again).toBe('resumed');
        expect(walks).toEqual([]);
        expect(session2.isStopped()).toBe(false);
    });

    test('samples repeated warn lines and never drops error', () => {
        const lines: string[] = [];
        const { sdk, bot } = mockPair();
        const session = new ActivitySession(sdk, bot, {
            name: 'bowstrings',
            now: () => 1,
            writeLog: (line) => lines.push(line),
        });
        for (let i = 0; i < 12; i++) session.noteFailure('wheel', 'no wheel');
        const warns = lines.filter((l) => l.includes(' WARN '));
        expect(warns.length).toBeLessThan(12);
        expect(warns.length).toBeGreaterThanOrEqual(2);

        session.stop('recovery_exhausted', 'done');
        session.stop('recovery_exhausted', 'done');
        const errors = lines.filter((l) => l.includes(' ERROR '));
        expect(errors.length).toBe(1);
        expect(session.metrics().lastSeverity).toBe('error');
    });

    test('phase ping-pong does not clear repeat failures, and only a non-phase noteProgress ends recovery', async () => {
        const { sdk, bot } = mockPair();
        const session = new ActivitySession(sdk, bot, {
            name: 'bowstrings',
            now: () => 5_000,
            writeLog: () => {},
            maxRecoveryTactics: 8,
        });
        for (let i = 0; i < 5; i++) {
            await session.setPhase(i % 2 === 0 ? 'a' : 'b');
            session.noteFailure('x', 'x');
        }
        expect(session.needsRecovery()).toBe(true);

        let stillRecovering = false;
        session.registerRecovery([
            {
                name: 'mid',
                run: async () => {
                    await session.setPhase('b');
                    stillRecovering = session.needsRecovery();
                    session.noteProgress('inventory', 'banked');
                    return true;
                },
            },
        ]);
        expect(await session.recover()).toBe('resumed');
        expect(stillRecovering).toBe(true);
        expect(session.needsRecovery()).toBe(false);
    });

    test('setPhase refreshes the stall clock without counting as an effect', async () => {
        let now = 1_000;
        const lines: string[] = [];
        const { sdk, bot } = mockPair();
        const session = new ActivitySession(sdk, bot, {
            name: 'bowstrings',
            stallMs: 120_000,
            now: () => now,
            writeLog: () => {},
            eventsWrite: (line) => lines.push(line),
        });
        now = 50_000;
        await session.setPhase('walk');
        now = 50_000 + 119_000;
        expect(session.needsRecovery()).toBe(false);
        const progress = lines.map((line) => JSON.parse(line) as { type: string; kind?: string });
        expect(progress.some((event) => event.type === 'progress' && event.kind === 'phase')).toBe(false);
        session.noteProgress('xp', 'chop');
        const effects = lines.map((line) => JSON.parse(line) as { type: string; kind?: string });
        expect(effects.some((event) => event.type === 'progress' && event.kind === 'xp')).toBe(true);
    });

    test('repeating the same phase does not refresh the stall clock', async () => {
        let now = 1_000;
        const { sdk, bot } = mockPair();
        const session = new ActivitySession(sdk, bot, {
            name: 'air-craft',
            stallMs: 120_000,
            now: () => now,
            writeLog: () => {},
        });
        await session.setPhase('wildy');
        now = 60_000;
        await session.setPhase('wildy');
        now = 1_000 + 120_000;
        expect(session.needsRecovery()).toBe(true);
        await session.setPhase('bank');
        now = 60_000 + 119_000;
        expect(session.needsRecovery()).toBe(false);
    });

    test('a location note on an unchanged tile does not refresh the stall clock', () => {
        let now = 1_000;
        const pos = { worldX: 3102, worldZ: 3610 };
        const { sdk, bot } = mockPair(pos);
        const lines: string[] = [];
        const session = new ActivitySession(sdk, bot, {
            name: 'air-craft',
            stallMs: 120_000,
            now: () => now,
            writeLog: () => {},
            eventsWrite: (line) => lines.push(line),
        });
        session.noteProgress('location', '3088,3525');
        now = 60_000;
        session.noteProgress('location', '3088,3525');
        now = 1_000 + 120_000;
        expect(session.needsRecovery()).toBe(true);
        const locationNotes = lines
            .map((line) => JSON.parse(line) as { type: string; kind?: string })
            .filter((event) => event.type === 'progress' && event.kind === 'location');
        expect(locationNotes).toHaveLength(1);

        pos.worldX = 3100;
        pos.worldZ = 3600;
        session.noteProgress('location', '3100,3600');
        now = 1_000 + 120_000 + 119_000;
        expect(session.needsRecovery()).toBe(false);
    });

    test('wilderness rewalk steps three tiles toward the anchor', async () => {
        const { sdk, bot, sendWalks } = mockPair({ worldX: 3102, worldZ: 3610 });
        const session = new ActivitySession(sdk, bot, {
            name: 'air-craft',
            stallMs: 10,
            maxRecoveryTactics: 8,
            now: () => 20,
            writeLog: () => {},
        });
        session.setAnchor(3088, 3525);
        await session.recover();
        expect(sendWalks.length).toBeGreaterThan(0);
        const [x, z] = sendWalks[0]!;
        expect(Math.hypot(x - 3102, z - 3610)).toBeLessThanOrEqual(3.05);
        expect(Math.hypot(x - 3088, z - 3525)).toBeGreaterThan(10);
        const direct = nextWalkStep({ x: 3102, z: 3610 }, { x: 3088, z: 3525 }, 3);
        expect(direct).toEqual({ x, z });
    });

    test('log upgrades a WARN or ERROR prefix', () => {
        const lines: string[] = [];
        const { sdk, bot } = mockPair();
        const session = new ActivitySession(sdk, bot, {
            name: 'bowstrings',
            now: () => 1,
            writeLog: (line) => lines.push(line),
        });
        session.log('log', 'WARN x');
        session.log('log', 'ERROR y');
        expect(lines.some((line) => line.includes(' WARN x'))).toBe(true);
        expect(lines.some((line) => line.includes(' ERROR y'))).toBe(true);
        expect(lines.some((line) => line.includes(' LOG WARN'))).toBe(false);
        expect(lines.some((line) => line.includes(' LOG ERROR'))).toBe(false);
    });

    test('rewalk uses sendWalk in the wilderness instead of walkTo', async () => {
        const { sdk, bot, sendWalks, walkTos } = mockPair({ worldX: 3058, worldZ: 3814 });
        let now = 1_000;
        const session = new ActivitySession(sdk, bot, {
            name: 'rune-rocks',
            stallMs: 10,
            maxRecoveryTactics: 8,
            recoveryBudgetMs: 60_000,
            now: () => now,
            writeLog: () => {},
        });
        session.setAnchor(3058, 3884);
        session.registerRecovery([{ name: 'ok', run: async () => true }]);
        now = 20;
        expect(await session.recover()).toBe('resumed');
        expect(walkTos).toEqual([]);
        const step = nextWalkStep({ x: 3058, z: 3814 }, { x: 3058, z: 3884 }, 3);
        expect(sendWalks).toContainEqual([step.x, step.z]);
    });
});
