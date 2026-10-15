import { describe, expect, test } from 'bun:test';
import {
    formatStateAge,
    hasForeignLiveSession,
    inGameLabel,
    isFreshGatewayState,
    isLiveGatewayState,
    LIVE_STATE_MS,
} from '../gateway-state';

describe('gateway-state', () => {
    test('formatStateAge', () => {
        expect(formatStateAge(30_000)).toBe('30s');
        expect(formatStateAge(90_000)).toBe('2m');
        expect(formatStateAge(7_200_000)).toBe('2.0h');
    });

    test('isLiveGatewayState rejects old snapshots', () => {
        expect(isLiveGatewayState({ inGame: true, stateAge: LIVE_STATE_MS - 1 })).toBe(true);
        expect(isLiveGatewayState({ inGame: true, stateAge: LIVE_STATE_MS })).toBe(false);
        expect(isLiveGatewayState({ inGame: true, stateAge: 70_000_000 })).toBe(false);
    });

    test('inGameLabel shows STALE for zombie snapshots', () => {
        expect(inGameLabel({ inGame: true, stateAge: 5000 })).toBe('true');
        expect(inGameLabel({ inGame: true, stateAge: LIVE_STATE_MS })).toBe('STALE(2m)');
        expect(inGameLabel({ inGame: false })).toBe('false');
    });

    test('hasForeignLiveSession skips when lite owns session', () => {
        const gw = { inGame: true, stateAge: 1000 };
        expect(hasForeignLiveSession(gw, { liteRunning: true })).toBe(false);
        expect(hasForeignLiveSession(gw, { liteRunning: false })).toBe(true);
        expect(hasForeignLiveSession({ inGame: true, stateAge: LIVE_STATE_MS }, { liteRunning: false })).toBe(
            false
        );
    });

    test('isFreshGatewayState', () => {
        expect(isFreshGatewayState({ inGame: true, stateAge: 1000 })).toBe(true);
        expect(isFreshGatewayState({ inGame: true, stateAge: 9000 })).toBe(false);
    });
});
