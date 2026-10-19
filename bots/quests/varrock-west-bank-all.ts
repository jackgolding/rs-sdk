/**
 * Walk to Varrock West bank, deposit everything in the inventory (worn gear stays on),
 * then close the bank and park. Safe-stop: restarts re-walk a near-zero leg and
 * deposit nothing, so it never over-delivers.
 *
 * Approach from the east side of the booths — crowded booths read UNREACHABLE
 * from the west side.
 *
 *   bun bots/quests/varrock-west-bank-all.ts ABGARMY10
 */
import { appendFileSync } from 'fs';
import { join } from 'path';
import { runScript } from '../../sdk/runner';

const botName = process.argv.slice(2).find((a) => !a.startsWith('-')) ?? '';
const GRIND_LOG = join(process.cwd(), 'bots', botName, 'grind.log');

/** Varrock west bank booths (south of the GE table). */
const BANK = { x: 3186, z: 3436 };
/** Open tile east of the booths. */
const BANK_EAST = { x: 3195, z: 3440 };
const CASTLE_STAIRS = { x: 3205, z: 3208 };
/** Climb-up just south of the Zanaris arrival tile. */
const ZANARIS_LADDER = { x: 3222, z: 9588 };
const ZANARIS_EAST_LADDER = { x: 3254, z: 9590 };
const SHED = { x: 3203, z: 3169 };

await runScript(async ({ bot, sdk }) => {
    const log = (msg: string) => {
        const line = `${new Date().toISOString()} ${msg}`;
        console.log(msg);
        try {
            appendFileSync(GRIND_LOG, line + '\n');
        } catch {
            /* ignore */
        }
    };

    const pos = () => {
        const p = sdk.getState()?.player;
        return { x: p?.worldX ?? 0, z: p?.worldZ ?? 0, level: p?.level ?? 0 };
    };
    const distTo = (x: number, z: number) => {
        const p = pos();
        return Math.hypot(p.x - x, p.z - z);
    };

    function inZanaris(): boolean {
        const p = pos();
        return p.x >= 3050 && p.x <= 3400 && p.z >= 9400 && p.z < 9700;
    }

    function onSurface(): boolean {
        return pos().z < 9000;
    }

    async function hopTo(x: number, z: number): Promise<void> {
        if (distTo(x, z) <= 3) return;
        await sdk.sendWalk(x, z, true);
        await sdk
            .waitForCondition((s) => Math.hypot((s.player?.worldX ?? 0) - x, (s.player?.worldZ ?? 0) - z) <= 4, 12_000)
            .catch(() => {});
    }

    async function climbZanarisLadder(tile: { x: number; z: number }): Promise<boolean> {
        await hopTo(tile.x, tile.z);
        await sdk.scanNearbyLocs(6).catch(() => {});
        const ladder = (sdk.getNearbyLocs() ?? [])
            .filter(
                (l) =>
                    /ladder/i.test(l.name) &&
                    Math.hypot(l.x - tile.x, l.z - tile.z) <= 3 &&
                    l.optionsWithIndex?.some((o) => /climb-up|climb.up/i.test(o.text))
            )
            .sort((a, b) => (a.distance ?? 99) - (b.distance ?? 99))[0];
        if (!ladder) {
            log(`BANK-ALL no Zanaris ladder @ ${pos().x},${pos().z} (want ${tile.x},${tile.z})`);
            return false;
        }
        const r = await bot.interactLoc(ladder, /climb-up|climb.up/i);
        if (!r.success) log(`BANK-ALL zanaris ladder: ${r.message}`);
        await sdk.waitForCondition(() => onSurface(), 15_000).catch(() => {});
        await sdk.waitForTicks(3).catch(() => {});
        log(`BANK-ALL after Zanaris climb @ ${pos().x},${pos().z} surface=${onSurface()}`);
        return onSurface();
    }

    async function leaveZanaris(): Promise<boolean> {
        if (onSurface()) return true;
        if (!inZanaris()) return onSurface();
        await bot.closeBank().catch(() => {});
        const here = pos();
        if (here.x >= 3230 && here.z < 9580) await hopTo(3220, here.z);
        for (const hop of [
            { x: 3196, z: 9568 },
            { x: 3202, z: 9584 },
            { x: 3214, z: 9590 },
            { x: 3220, z: 9592 }
        ]) {
            if (onSurface()) return true;
            if (distTo(ZANARIS_LADDER.x, ZANARIS_LADDER.z) <= 3) break;
            await hopTo(hop.x, hop.z);
        }
        if (await climbZanarisLadder(ZANARIS_LADDER)) return true;
        if (!inZanaris()) return onSurface();
        for (const hop of [{ x: 3236, z: 9590 }, { x: 3246, z: 9590 }, ZANARIS_EAST_LADDER]) {
            if (onSurface()) return true;
            await hopTo(hop.x, hop.z);
        }
        return climbZanarisLadder(ZANARIS_EAST_LADDER);
    }

    /** The shed door is the Zanaris entrance; walk around it, do not click Open. */
    async function stepOutOfShed(): Promise<void> {
        if (!onSurface() || distTo(SHED.x, SHED.z) > 20) return;
        for (const hop of [
            { x: 3194, z: 3176 },
            { x: 3194, z: 3196 },
            { x: 3208, z: 3210 }
        ]) {
            if (pos().z >= 3205) return;
            await hopTo(hop.x, hop.z);
        }
    }

    log(`BANK-ALL start @ ${pos().x},${pos().z} L${pos().level} -> Varrock west`);

    // A bot left underground (e.g. in Zanaris when its last quest was swapped
    // out) cannot path to the surface bank — climb out first.
    if (inZanaris()) {
        log('BANK-ALL in Zanaris — exiting to the surface first');
        if (!(await leaveZanaris())) {
            log(`BANK-ALL still in Zanaris @ ${pos().x},${pos().z}`);
            return;
        }
        await stepOutOfShed();
    }

    // The Duke's room is upstairs in Lumbridge castle; the bank route starts on the ground floor.
    for (let i = 0; i < 3 && pos().level > 0; i++) {
        if (distTo(CASTLE_STAIRS.x, CASTLE_STAIRS.z) > 3) await bot.walkTo(CASTLE_STAIRS.x, CASTLE_STAIRS.z, 2);
        await sdk.scanNearbyLocs(8).catch(() => {});
        const loc = (sdk.getNearbyLocs() ?? [])
            .filter(
                (l) =>
                    /stair|ladder/i.test(l.name) &&
                    Math.hypot(l.x - CASTLE_STAIRS.x, l.z - CASTLE_STAIRS.z) <= 4 &&
                    (l.optionsWithIndex ?? []).some((o) => /climb-down|climb.down/i.test(o.text))
            )
            .sort((a, b) => (a.distance ?? 99) - (b.distance ?? 99))[0];
        if (!loc) {
            log(`BANK-ALL no castle stairs down near ${pos().x},${pos().z} L${pos().level}`);
            break;
        }
        const match = loc.optionsWithIndex.find((o) => /climb-down|climb.down/i.test(o.text));
        if (!match) break;
        const before = pos().level;
        await sdk.sendInteractLoc(loc.x, loc.z, loc.id, match.opIndex);
        await sdk.waitForCondition((s) => (s.player?.level ?? before) !== before, 8_000).catch(() => {});
    }

    if (distTo(BANK_EAST.x, BANK_EAST.z) > 4) {
        const walk = await bot.walkTo(BANK_EAST.x, BANK_EAST.z, 3);
        if (!walk.success && distTo(BANK_EAST.x, BANK_EAST.z) > 6) {
            log(`BANK-ALL walk failed: ${walk.message}`);
            return;
        }
    }

    let opened = await bot.openBank();
    if (!opened.success) {
        await bot.walkTo(BANK_EAST.x, BANK_EAST.z, 2).catch(() => undefined);
        await sdk.waitForTicks(2).catch(() => {});
        opened = await bot.openBank();
    }
    if (!opened.success) {
        log(`BANK-ALL could not open bank: ${opened.message}`);
        return;
    }

    let deposited = 0;
    for (let i = 0; i < 60; i++) {
        const item = sdk.getInventory().find((it) => (it.count ?? 0) > 0);
        if (!item) break;
        const r = await bot.depositItem(item, -1);
        if (!r.success && !r.partial) {
            log(`BANK-ALL deposit ${item.name} failed: ${r.message}`);
            break;
        }
        deposited++;
    }

    await bot.closeBank().catch(() => {});
    const left = sdk.getInventory().filter((it) => (it.count ?? 0) > 0).map((it) => it.name);
    log(`BANK-ALL done: ${deposited} stacks deposited, inventory left: ${left.length ? left.join(', ') : 'empty'}`);
});
