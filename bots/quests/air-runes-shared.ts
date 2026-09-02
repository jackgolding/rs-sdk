import type { BotActions } from '../../sdk/actions';
import type { BotSDK } from '../../sdk/index';
import { closeUi, walkNear } from './movement';
import { inEssenceMine } from '../../sdk/index';

export const FALADOR_EAST = { x: 3012, z: 3355 };
export const VARROCK_EAST = { x: 3253, z: 3420 };
export const AIR_RUINS = { x: 2985, z: 3293 };
/** Air altar interior, on the crafting altar. */
export const AIR_ALTAR = { x: 2841, z: 4830 };
export const ESSENCE = /^(rune essence|pure essence)$/i;
export const TALISMAN = /^air talisman$/i;
export const JACKTHIEF = /^Jackthief$/i;
export const RUNNERS = /^Jacklove[1-5]$/i;
export const LOAD = 26;

export function inAirAltar(x: number, z: number): boolean {
    return x >= 2800 && x <= 2870 && z >= 4780 && z <= 4880;
}

export function pos(sdk: BotSDK): { x: number; z: number } {
    const p = sdk.getState()?.player;
    return { x: p?.worldX ?? 0, z: p?.worldZ ?? 0 };
}

export function distTo(sdk: BotSDK, x: number, z: number): number {
    const p = pos(sdk);
    return Math.hypot(p.x - x, p.z - z);
}

export function count(sdk: BotSDK, pattern: RegExp): number {
    return sdk.getInventory().filter((i) => pattern.test(i.name)).reduce((n, i) => n + (i.count ?? 1), 0);
}

export function emptySlots(sdk: BotSDK): number {
    return 28 - sdk.getInventory().filter((i) => (i.count ?? 0) > 0).length;
}

export { closeUi, walkNear };

export async function leaveMine(bot: BotActions, sdk: BotSDK, log: (m: string) => void): Promise<void> {
    if (!inEssenceMine(pos(sdk).x, pos(sdk).z)) return;
    log('Leaving essence mine');
    for (let i = 0; i < 10 && inEssenceMine(pos(sdk).x, pos(sdk).z); i++) {
        await closeUi(bot, sdk);
        await sdk.scanNearbyLocs(12).catch(() => {});
        const portal = sdk.findNearbyLoc(/^portal$/i) ?? sdk.findNearbyLoc(/portal/i);
        if (!portal) {
            const p = pos(sdk);
            await walkNear(bot, sdk, p.x + 12, p.z, 3);
            continue;
        }
        await bot.interactLoc(portal, /use|enter|climb/i);
        await sdk.waitForCondition((s) => !inEssenceMine(s.player?.worldX ?? 0, s.player?.worldZ ?? 0), 10_000).catch(() => {});
    }
    if (inEssenceMine(pos(sdk).x, pos(sdk).z)) {
        throw new Error(`Still in essence mine @ ${pos(sdk).x},${pos(sdk).z}`);
    }
}

export async function enterAltar(bot: BotActions, sdk: BotSDK, log: (m: string) => void): Promise<boolean> {
    if (inAirAltar(pos(sdk).x, pos(sdk).z)) return true;
    await closeUi(bot, sdk);
    if (!(await walkNear(bot, sdk, AIR_RUINS.x, AIR_RUINS.z, 4))) {
        log(`Walk to ruins failed @ ${pos(sdk).x},${pos(sdk).z}`);
        return false;
    }
    await sdk.scanNearbyLocs(10).catch(() => {});
    const used = await bot.useItemOnLoc(TALISMAN, /mysterious ruins/i);
    if (!used.success) {
        log(`Enter ruins failed: ${used.message}`);
        return false;
    }
    await sdk.waitForCondition((s) => inAirAltar(s.player?.worldX ?? 0, s.player?.worldZ ?? 0), 12_000).catch(() => {});
    const ok = inAirAltar(pos(sdk).x, pos(sdk).z);
    if (ok) log(`Entered air altar @ ${pos(sdk).x},${pos(sdk).z}`);
    return ok;
}

export async function leaveAltar(bot: BotActions, sdk: BotSDK, log: (m: string) => void): Promise<void> {
    if (!inAirAltar(pos(sdk).x, pos(sdk).z)) return;
    log('Leaving air altar');
    for (let i = 0; i < 8 && inAirAltar(pos(sdk).x, pos(sdk).z); i++) {
        await closeUi(bot, sdk);
        await sdk.scanNearbyLocs(12).catch(() => {});
        const portal = sdk.findNearbyLoc(/^portal$/i);
        if (!portal) continue;
        await bot.interactLoc(portal, /use|enter/i);
        await sdk.waitForCondition((s) => !inAirAltar(s.player?.worldX ?? 0, s.player?.worldZ ?? 0), 10_000).catch(() => {});
    }
}

export async function depositAll(bot: BotActions, sdk: BotSDK, keep: RegExp = /(?!)/): Promise<void> {
    for (let pass = 0; pass < 8; pass++) {
        const junk = sdk.getInventory().find((i) => (i.count ?? 0) > 0 && !keep.test(i.name));
        if (!junk) break;
        const r = await bot.depositItem(junk, -1);
        if (!r.success) break;
    }
}

export async function dumpAtNearestBank(
    bot: BotActions,
    sdk: BotSDK,
    log: (m: string) => void,
    keep: RegExp = /(?!)/
): Promise<void> {
    await closeUi(bot, sdk);
    await leaveMine(bot, sdk, log);
    await leaveAltar(bot, sdk, log);
    const bank =
        distTo(sdk, VARROCK_EAST.x, VARROCK_EAST.z) <= distTo(sdk, FALADOR_EAST.x, FALADOR_EAST.z)
            ? VARROCK_EAST
            : FALADOR_EAST;
    log(`Dumping inventory at ${bank === VARROCK_EAST ? 'Varrock east' : 'Falador east'}`);
    if (!(await walkNear(bot, sdk, bank.x, bank.z, 3))) {
        throw new Error(`Could not reach bank @ ${pos(sdk).x},${pos(sdk).z}`);
    }
    if (!(sdk.getState()?.bank?.isOpen || (await bot.openBank()).success)) {
        throw new Error('Could not open bank to dump inventory');
    }
    await depositAll(bot, sdk, keep);
    await bot.closeBank();
}

export async function goFaladorEast(bot: BotActions, sdk: BotSDK, log: (m: string) => void): Promise<void> {
    if (distTo(sdk, FALADOR_EAST.x, FALADOR_EAST.z) <= 6) return;
    log('Walking to Falador east bank');
    if (!(await walkNear(bot, sdk, FALADOR_EAST.x, FALADOR_EAST.z, 3))) {
        throw new Error(`Could not reach Falador east @ ${pos(sdk).x},${pos(sdk).z}`);
    }
}

export async function openFaladorBank(bot: BotActions, sdk: BotSDK): Promise<void> {
    await goFaladorEast(bot, sdk, () => {});
    if (sdk.getState()?.bank?.isOpen) return;
    const opened = await bot.openBank();
    if (!opened.success) throw new Error(`Falador east bank: ${opened.message}`);
}
