/**
 * Condition-based settles.
 *
 * Replaces `await sdk.waitForTicks(2)` used as "give the server a moment". A
 * fixed tick count is a different amount of wall-clock time on every world we
 * run (dev 400ms/tick, demo 300ms, `::speed` down to 20ms), so a script tuned
 * with tick counts works on one and races on another. These helpers wait for the
 * observable effect instead, capped by a wall-clock budget from `timing.ts`.
 *
 * Every helper returns a boolean and never throws: a settle that times out is
 * information the caller can log or act on, not a crash.
 */
import type { BotSDK } from '../../sdk/index';
import { TIMING } from './timing';

export interface SettleOptions {
    timeoutMs?: number;
    /** How often to look. Fine-grained enough for a 20ms tick, cheap otherwise. */
    pollMs?: number;
    log?: (message: string) => void;
}

async function pollUntil(sdk: BotSDK, label: string, predicate: () => boolean, options: SettleOptions = {}): Promise<boolean> {
    const timeoutMs = options.timeoutMs ?? TIMING.actionMs;
    const pollMs = options.pollMs ?? 120;
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        try {
            if (predicate()) return true;
        } catch {
            /* a state teardown mid-poll is not a failure of the settle */
        }
        // Poll on wall-clock only: advancing the world to check on it would make
        // the settle itself clock-dependent, which is the bug being removed.
        if (pollMs > 0) await new Promise<void>(resolve => setTimeout(resolve, pollMs));
    }
    options.log?.(`settle timed out after ${timeoutMs}ms: ${label}`);
    return false;
}

const bankItems = (sdk: BotSDK) => (sdk.getState()?.bank?.items ?? []).filter(i => (i.count ?? 0) > 0);

/** Bank is open AND its contents have streamed in (they lag `isOpen` by a tick). */
export function untilBankReady(sdk: BotSDK, options: SettleOptions = {}): Promise<boolean> {
    return pollUntil(sdk, 'bank ready', () => {
        const state = sdk.getState();
        return state?.bank?.isOpen === true && bankItems(sdk).length > 0;
    }, { timeoutMs: TIMING.bankSyncMs, ...options });
}

/**
 * Bank accepted an open but is genuinely empty. Distinguishes "empty bank" from
 * "contents not here yet": only true after the sync window has passed.
 */
export function untilBankOpen(sdk: BotSDK, options: SettleOptions = {}): Promise<boolean> {
    return pollUntil(sdk, 'bank open', () => sdk.getState()?.bank?.isOpen === true, { timeoutMs: TIMING.bankSyncMs, ...options });
}

export function untilBankClosed(sdk: BotSDK, options: SettleOptions = {}): Promise<boolean> {
    return pollUntil(sdk, 'bank closed', () => sdk.getState()?.bank?.isOpen !== true, { timeoutMs: TIMING.actionMs, ...options });
}

/** The inventory's shape changed (an item arrived, left, or its count moved). */
export function untilInventoryChange(sdk: BotSDK, before: readonly string[], options: SettleOptions = {}): Promise<boolean> {
    const signature = (items: readonly { name: string; count?: number }[]) => items.map(i => `${i.name}x${i.count ?? 1}`).sort().join('|');
    const wanted = signature([...before].map(name => ({ name })));
    return pollUntil(sdk, 'inventory change', () => {
        const now = signature(sdk.getInventory().filter(i => (i.count ?? 0) > 0));
        return now !== wanted;
    }, { timeoutMs: TIMING.grantMs, ...options });
}

/** Snapshot the bag for `untilInventoryChange`. */
export function inventorySignature(sdk: BotSDK): string[] {
    return sdk.getInventory().filter(i => (i.count ?? 0) > 0).map(i => i.name);
}

/** A plane change landed (stairs, ladder, trapdoor). */
export function untilPlane(sdk: BotSDK, level: number, options: SettleOptions = {}): Promise<boolean> {
    return pollUntil(sdk, `plane ${level}`, () => sdk.getState()?.player?.level === level, { timeoutMs: TIMING.planeChangeMs, ...options });
}

/** The dialog closed (the server finished its page run). */
export function untilDialogClosed(sdk: BotSDK, options: SettleOptions = {}): Promise<boolean> {
    return pollUntil(sdk, 'dialog closed', () => sdk.getState()?.dialog?.isOpen !== true, { timeoutMs: TIMING.dialogPageMs, ...options });
}

/** The player is not moving and not in combat — the world is quiescent for a scan. */
export function untilIdle(sdk: BotSDK, options: SettleOptions = {}): Promise<boolean> {
    return pollUntil(sdk, 'idle', () => {
        const player = sdk.getState()?.player;
        if (!player) return false;
        const moving = (player as { moving?: boolean; inCombat?: boolean });
        return moving.moving !== true && moving.inCombat !== true;
    }, { timeoutMs: TIMING.sceneSettleMs, ...options });
}
