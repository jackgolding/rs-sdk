/**
 * alkharid-toll — the ONE way across the Lumbridge ⇄ Al Kharid border gate.
 *
 * Content (area_alkharid/scripts/border_gate.rs2) makes this a guard toll, not a
 * door you open:
 *   - The fence is a NORTH-SOUTH line at x=3268. West (x<3268) is Lumbridge, east
 *     (x>=3268) is Al Kharid. Decide sides by X — a z=3227 test puts Lumbridge and
 *     the Al Kharid bank on the same side and the return leg never pays.
 *   - Clicking a gate half only works when that side's guard is within ONE tile of
 *     the player (npc_find radius 1), so it fails silently most of the time. Talk
 *     to the Border Guard directly (opnpc1 → talk_to_border_guard(null)).
 *   - The guard asks p_choice3(No / Who / "Yes, ok."). Answer by TEXT. After paying,
 *     pass_toll_gate forcemoves to the fence and teleports ONE tile across
 *     (eastbound lands 3268,z; westbound 3267,z), so check the side, never the
 *     jump distance.
 *   - Never stay on the fence tile: the pathfinder has no exit from it. Step to the
 *     staging tile beyond.
 *   - Prince Ali Rescue done → the guard waves you through free (no choice shown).
 *
 * Proven: hub-prep 5/5 Lumbridge ⇄ Al Kharid round trips, 40-42s/leg, 10gp each way.
 */
import type { BotSDK } from '../../sdk/index';
import type { BotActions } from '../../sdk/actions';

export const TOLL_X = 3268;
export const TOLL_COST = 10;
/** Tiles one step clear of the fence on each side (also where we stand to pay). */
export const TOLL_STAGE = { west: { x: 3265, z: 3227 }, east: { x: 3271, z: 3227 } } as const;

type P = { x: number; z: number };

export const eastOfToll = (p: P) => p.x >= TOLL_X;
/** Al Kharid proper: east of the fence, south of the Varrock road. */
export const inAlKharidRegion = (p: P) => p.x >= TOLL_X && p.x < 3360 && p.z >= 3100 && p.z <= 3290;
/** The Lumbridge side of the same fence, same latitude band. */
export const westOfTollRegion = (p: P) => p.x < TOLL_X && p.x > 3150 && p.z >= 3150 && p.z <= 3290;
/** True when a walk from a to b has to go through the toll (rather than the long way north). */
export const needsTollCrossing = (a: P, b: P) =>
    (inAlKharidRegion(a) && westOfTollRegion(b)) || (westOfTollRegion(a) && inAlKharidRegion(b));

export type TollOpts = {
    log?: (msg: string) => void;
    /** Caller's own long-walk (e.g. hub-prep's scene-limited hop loop). Default: hopping bot.walkTo. */
    walk?: (x: number, z: number) => Promise<unknown>;
    attempts?: number;
};

/**
 * Cross the toll so we end on the requested side. Returns true when we are on that
 * side (including when we already were). Needs 10gp unless the prince quest is done.
 */
export async function crossAlKharidToll(
    bot: BotActions,
    sdk: BotSDK,
    wantEast: boolean,
    opts: TollOpts = {},
): Promise<boolean> {
    const log = opts.log ?? ((m: string) => console.log(m));
    const at = (): P => {
        const p = sdk.getState()?.player;
        return { x: p?.worldX ?? 0, z: p?.worldZ ?? 0 };
    };
    const coins = () =>
        sdk.getInventory().filter((i) => /^coins$/i.test(i.name)).reduce((n, i) => n + (i.count ?? 0), 0);
    const onSide = () => eastOfToll(at()) === wantEast;
    const dist = (t: P) => Math.hypot(at().x - t.x, at().z - t.z);
    const walk =
        opts.walk ??
        (async (x: number, z: number) => {
            // walkTo is scene-limited (~45 tiles): hop toward far targets.
            for (let i = 0; i < 8 && dist({ x, z }) > 3; i++) {
                const p = at();
                const d = Math.max(1, dist({ x, z }));
                const k = Math.min(1, 35 / d);
                await bot.walkTo(Math.round(p.x + (x - p.x) * k), Math.round(p.z + (z - p.z) * k), 2).catch(() => {});
            }
        });
    const dir = wantEast ? 'west→east' : 'east→west';
    const stageNear = wantEast ? TOLL_STAGE.west : TOLL_STAGE.east;
    const stageFar = wantEast ? TOLL_STAGE.east : TOLL_STAGE.west;

    for (let attempt = 1; attempt <= (opts.attempts ?? 3); attempt++) {
        if (onSide()) return true;
        if (coins() < TOLL_COST) {
            // One try only: free passage if Prince Ali Rescue is done, else the guard refuses.
            if (attempt > 1) return false;
            log(`toll ${dir}: only ${coins()}gp — trying once (free if Prince Ali is done)`);
        }
        if (dist(stageNear) > 4) await walk(stageNear.x, stageNear.z);
        if (sdk.getDialog()?.isOpen) await bot.dismissBlockingUI().catch(() => {});

        const before = coins();
        const guards = (sdk.getNearbyNpcs() ?? [])
            .filter((n) => /^border guard$/i.test(n.name))
            .sort((a, b) => (a.distance ?? 99) - (b.distance ?? 99));
        // Prefer the guard on OUR side (borderguard1 west, borderguard2 east); talking
        // to either runs pass_toll_gate from our own coord, so the other is a fallback.
        const guard = guards.find((n) => eastOfToll(n) === eastOfToll(at())) ?? guards[0];
        if (!guard) {
            log(`toll ${dir}: no Border Guard in view at ${at().x},${at().z} (attempt ${attempt})`);
            await sdk.waitForTicks(3).catch(() => {});
            continue;
        }
        const talk = await bot.talkTo(guard).catch((e) => ({ success: false, message: String(e) }));
        if (!talk.success) log(`toll ${dir}: talk failed — ${talk.message}`);

        // chatplayer → chatnpc → p_choice3 → chatplayer → "You pay the guard." → teleport.
        for (let i = 0; i < 30 && !onSide(); i++) {
            const d = sdk.getDialog();
            if (!d?.isOpen || d.isWaiting) {
                await sdk.waitForTicks(1).catch(() => {});
                continue;
            }
            const yes = d.options.find((o) => /yes,?\s*ok/i.test(o.text));
            if (yes) await sdk.sendClickDialog(yes.index).catch(() => {});
            else if (d.options.length <= 1) await sdk.sendClickDialog(d.options[0]?.index ?? 0).catch(() => {});
            else {
                log(`toll ${dir}: unexpected choice ${d.options.map((o) => o.text).join(' | ')}`);
                break;
            }
            await sdk.waitForTicks(1).catch(() => {});
        }
        for (let i = 0; i < 6 && !onSide(); i++) await sdk.waitForTicks(1).catch(() => {});
        if (sdk.getDialog()?.isOpen) await bot.dismissBlockingUI().catch(() => {});

        if (onSide()) {
            await bot.walkTo(stageFar.x, stageFar.z, 1).catch(() => {});
            log(`toll ${dir}: paid ${before - coins()}gp, through to ${at().x},${at().z} (coins ${coins()})`);
            return true;
        }
        log(`toll ${dir}: did not pass (still ${at().x},${at().z}, coins ${coins()}, attempt ${attempt})`);
    }
    return onSide();
}
