import type { BotActions } from '../../sdk/actions';
import type { BotSDK } from '../../sdk/index';
import type { Tile } from './tiles';
import { MUSA_SHIP, EDGEVILLE_LEVER, EDGEVILLE } from './tiles';

export function playerPos(sdk: BotSDK): { x: number; z: number; level: number } {
    const p = sdk.getState()?.player;
    return { x: p?.worldX ?? 0, z: p?.worldZ ?? 0, level: p?.level ?? 0 };
}

export function distTo(sdk: BotSDK, x: number, z: number): number {
    const p = playerPos(sdk);
    return Math.hypot(p.x - x, p.z - z);
}

export async function closeUi(bot: BotActions, sdk: BotSDK): Promise<void> {
    for (let i = 0; i < 8; i++) {
        await bot.dismissBlockingUI();
        const dialog = sdk.getDialog();
        if (dialog?.isOpen) {
            const cont = dialog.options?.find((o) => /continue|click here/i.test(o.text));
            if (cont?.componentId) {
                await sdk.sendClickComponent(cont.componentId);
            }
            await sdk.sendClickDialog(cont?.index ?? 0);
            await sdk.waitForTicks(1).catch(() => {});
            continue;
        }
        if (sdk.getState()?.shop?.isOpen || sdk.getState()?.bank?.isOpen || sdk.getState()?.interface?.isOpen) {
            await bot.closeInterface();
            await sdk.waitForTicks(1).catch(() => {});
            continue;
        }
        break;
    }
}

function adjacentClosedDoors(sdk: BotSDK) {
    return (sdk.getNearbyLocs() ?? []).filter((l) => {
        const named = /door|gate/i.test(l.name);
        const dist = l.distance ?? 99;
        const opts = l.optionsWithIndex ?? [];
        const openText = (l.options ?? []).some((t) => /^open$/i.test(t));
        const openIdx = opts.some((o) => /^open$/i.test(o.text));
        return named && dist <= 2 && (openIdx || openText);
    });
}

export async function walkNear(
    bot: BotActions,
    sdk: BotSDK,
    x: number,
    z: number,
    tolerance = 4
): Promise<boolean> {
    if (distTo(sdk, x, z) <= tolerance) return true;
    // Inside a random house (Lumbridge respawn, etc.) walkTo will not path
    // through a closed door — open anything adjacent and step out first.
    for (let i = 0; i < 5 && adjacentClosedDoors(sdk).length; i++) {
        if (await leaveAdjacentClosedDoor(sdk)) break;
        await sdk.waitForTicks(2).catch(() => {});
    }
    const result = await bot.walkTo(x, z, Math.min(tolerance, 3));
    return result.success || distTo(sdk, x, z) <= tolerance + 2;
}

/** Open a closed door within 2 tiles and walk through it. */
export async function leaveAdjacentClosedDoor(sdk: BotSDK): Promise<boolean> {
    const p = playerPos(sdk);
    const doors = adjacentClosedDoors(sdk);
    if (!doors.length) return false;
    for (const door of doors) {
        const open =
            (door.optionsWithIndex ?? []).find((o) => /^open$/i.test(o.text)) ??
            (door.options?.some((t) => /^open$/i.test(t)) ? { text: 'Open', opIndex: 1 } : undefined);
        if (!open) continue;
        console.log(
            `[leave-door] ${p.x},${p.z} → ${door.name} ${door.x},${door.z} id=${door.id} op=${open.opIndex}`
        );
        const clicked = await sdk.sendInteractLoc(door.x, door.z, door.id, open.opIndex);
        console.log(`[leave-door] interact ${clicked.success ? 'ok' : clicked.message}`);
        await sdk.waitForTicks(2).catch(() => {});
        const dx = door.x === p.x ? 0 : Math.sign(door.x - p.x);
        const dz = door.z === p.z ? 0 : Math.sign(door.z - p.z);
        await sdk.sendWalk(p.x + dx * 2, p.z + dz * 2, true);
        await sdk.waitForTicks(4).catch(() => {});
        const after = playerPos(sdk);
        if (after.x !== p.x || after.z !== p.z) {
            console.log(`[leave-door] stepped to ${after.x},${after.z}`);
            return true;
        }
    }
    return false;
}

export async function walkWaypoints(
    bot: BotActions,
    sdk: BotSDK,
    wps: Tile[],
    opts?: {
        distTo?: (x: number, z: number) => number;
        walkNear?: (x: number, z: number, tolerance: number) => Promise<boolean>;
        beforeStep?: () => Promise<void>;
    }
): Promise<void> {
    const measure = opts?.distTo ?? ((x, z) => distTo(sdk, x, z));
    const step = opts?.walkNear ?? ((x, z, t) => walkNear(bot, sdk, x, z, t));
    const dest = wps[wps.length - 1];
    if (!dest) return;
    for (const wp of wps) {
        if (opts?.beforeStep) await opts.beforeStep();
        if (measure(dest.x, dest.z) <= 8) return;
        const remaining = measure(dest.x, dest.z);
        const via = Math.hypot(wp.x - dest.x, wp.z - dest.z);
        if (via >= remaining - 6) continue;
        await step(wp.x, wp.z, 8);
    }
    if (measure(dest.x, dest.z) > 6) await step(dest.x, dest.z, 6);
}

export async function crossGangplank(bot: BotActions, sdk: BotSDK): Promise<void> {
    const plank = sdk.findNearbyLoc(/gangplank/i);
    if (!plank) return;
    const opt = plank.optionsWithIndex.find((o) => /cross|board/i.test(o.text));
    if (opt) await sdk.sendInteractLoc(plank.x, plank.z, plank.id, opt.opIndex);
    else await bot.interactLoc(plank, /cross|board/i);
    await sdk.waitForTicks(5);
}

export async function recoverStun(sdk: BotSDK, eat: () => Promise<void>): Promise<void> {
    await eat();
    await sdk.waitForTicks(8);
    await eat();
}

/** Named recovery for Musa Point gangplank wedge. */
export async function recoverGangplank(bot: BotActions, sdk: BotSDK): Promise<boolean> {
    const p = playerPos(sdk);
    if (p.x !== MUSA_SHIP.x || p.z !== MUSA_SHIP.z) return false;
    await closeUi(bot, sdk);
    await crossGangplank(bot, sdk);
    await sdk.waitForTicks(8);
    return p.x !== MUSA_SHIP.x || p.z !== MUSA_SHIP.z;
}

const leverHistory: Array<{ x: number; z: number }> = [];

/** Detect bank ↔ lever oscillation and force a walk north. */
export async function recoverLeverOscillation(bot: BotActions, sdk: BotSDK): Promise<boolean> {
    const p = playerPos(sdk);
    leverHistory.push({ x: p.x, z: p.z });
    if (leverHistory.length > 8) leverHistory.shift();
    const nearLever =
        Math.hypot(p.x - EDGEVILLE_LEVER.x, p.z - EDGEVILLE_LEVER.z) < 12 ||
        (p.x > 3085 && p.x < 3100 && p.z > 3468 && p.z < 3482);
    if (!nearLever || leverHistory.length < 6) return false;
    const uniq = new Set(leverHistory.map((t) => `${t.x},${t.z}`));
    if (uniq.size > 3) return false;
    await closeUi(bot, sdk);
    await bot.walkTo(EDGEVILLE.x, EDGEVILLE.z, 4);
    leverHistory.length = 0;
    return true;
}
