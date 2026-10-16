/**
 * Shared rules for interpreting gateway /status snapshots.
 *
 * The gateway can report inGame:true with coords frozen for hours when no live
 * client is publishing ticks. Treat old snapshots as absent state, not truth.
 */

/** Fresh-enough to trust coords and wake decisions (matches fleet-status intervene). */
export const FRESH_STATE_MS = 8_000;

/** Old enough to label as stale in operator-facing output. */
export const LIVE_STATE_MS = 120_000;

export interface GatewaySnapshot {
    inGame?: boolean;
    stateAge?: number | null;
    status?: string;
    player?: { worldX?: number; worldZ?: number } | null;
}

export function formatStateAge(ms: number): string {
    if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
    if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m`;
    return `${(ms / 3_600_000).toFixed(1)}h`;
}

/** Gateway snapshot is from a client that is actively publishing ticks. */
export function isFreshGatewayState(gw: GatewaySnapshot | null | undefined): boolean {
    if (!gw?.inGame || gw.status === 'dead') return false;
    return (gw.stateAge ?? Infinity) < FRESH_STATE_MS;
}

/** Gateway snapshot is recent enough to trust player coords in tooling output. */
export function isLiveGatewayState(gw: GatewaySnapshot | null | undefined): boolean {
    if (!gw?.inGame || gw.status === 'dead') return false;
    return (gw.stateAge ?? Infinity) < LIVE_STATE_MS;
}

/** Pretty inGame column: true / false / STALE(19h). */
export function inGameLabel(gw: GatewaySnapshot | null | undefined): string {
    if (!gw?.inGame || gw.status === 'dead') return 'false';
    const age = gw.stateAge ?? 0;
    if (age >= LIVE_STATE_MS) return `STALE(${formatStateAge(age)})`;
    return 'true';
}

/** Another client (not our lite runner) likely holds a live session. */
export function hasForeignLiveSession(
    gw: GatewaySnapshot | null | undefined,
    opts?: { liteRunning?: boolean }
): boolean {
    if (opts?.liteRunning) return false;
    return isFreshGatewayState(gw);
}
