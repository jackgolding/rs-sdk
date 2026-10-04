/**
 * Pure classification for the public map feed (`/playerpositions`).
 * `level` on that feed is the floor (0 = surface), not combat level.
 */
import { inEssenceMine } from '../../../../sdk/regions';

/**
 * `wilderness_zones.dbrow`. Coord pairs are level_mx_mz_lx_lz.
 * Main: 0_46_55_0_0 → 3_52_99_63_63. Edgeville dungeon: 0_46_155_0_0 → 0_52_199_63_63.
 */
const WILDERNESS_ZONES = [
    { levelMin: 0, levelMax: 3, xMin: 2944, xMax: 3391, zMin: 3520, zMax: 6399 },
    { levelMin: 0, levelMax: 0, xMin: 2944, xMax: 3391, zMin: 9920, zMax: 12799 }
] as const;

export interface WorldPlayer {
    name: string;
    x: number;
    z: number;
    /** Floor. 0 is the surface. */
    level: number;
}

export interface PriorFix {
    x: number;
    z: number;
    level: number;
    /** Epoch ms when this tile was first observed. */
    since: number;
}

export interface Snapshot {
    savedAt: number;
    fixes: Record<string, PriorFix>;
    /** Inventory and xp clocks, keyed like `fixes`. Absent on older files. */
    gains?: Record<string, GainFix>;
}

/** Ignore dwell across a gap this long — the bot may have moved while we were not looking. */
export const MAX_GAP_MS = 45 * 60_000;

const STATIONARY_JOB = /fish|thiev|mining|magic-trees|cook|fletch|smith|herblore|high-alch|bank-fletch|catherby/i;
const COMBAT_JOB = /green-dragons|kbd/i;

/** A standing grind. Travel with no gains is a problem for these jobs and not for a walker. */
export function isStationaryJob(command: string): boolean {
    return STATIONARY_JOB.test(command);
}
/** Roster jobs that are supposed to stand in the wilderness. */
const WILDY_JOB = /green-dragons|kbd|wildy|rune-rock|wilderness/i;

export function nameKey(name: string): string {
    return name.trim().toLowerCase();
}

/**
 * Wilderness level from `wilderness_level`: one level per 8 tiles north of the
 * zone's south edge. Null outside the wilderness rectangles, and in the
 * essence mine (that interior sits in the same z band).
 * `level` is the floor from `/playerpositions`, not combat level.
 */
export function wildernessLevel(x: number, z: number, level = 0): number | null {
    if (inEssenceMine(x, z)) return null;
    for (const zone of WILDERNESS_ZONES) {
        if (level < zone.levelMin || level > zone.levelMax) continue;
        if (x < zone.xMin || x > zone.xMax || z < zone.zMin || z > zone.zMax) continue;
        return Math.floor((z - zone.zMin) / 8) + 1;
    }
    return null;
}

/** How long the same tile may last before it counts as stuck, by roster command. */
export function stuckThresholdMs(command: string): number {
    if (STATIONARY_JOB.test(command)) return 25 * 60_000;
    if (COMBAT_JOB.test(command)) return 12 * 60_000;
    return 8 * 60_000;
}

export function expectsWilderness(command: string): boolean {
    return WILDY_JOB.test(command);
}

export function sameTile(a: { x: number; z: number; level: number }, b: { x: number; z: number; level: number }): boolean {
    return a.x === b.x && a.z === b.z && a.level === b.level;
}

/**
 * Fold one observation into the dwell clock.
 * `moved === null` means there is no trustworthy previous sample.
 */
export function nextFix(
    prior: PriorFix | undefined,
    now: number,
    priorSavedAt: number | null,
    player: { x: number; z: number; level: number }
): { fix: PriorFix; moved: boolean | null } {
    const fresh = !prior || priorSavedAt == null || now - priorSavedAt > MAX_GAP_MS;
    if (fresh || !prior) {
        return { fix: { x: player.x, z: player.z, level: player.level, since: now }, moved: null };
    }
    if (sameTile(prior, player)) return { fix: prior, moved: false };
    return { fix: { x: player.x, z: player.z, level: player.level, since: now }, moved: true };
}

export type MovementKind = 'seen' | 'moving' | 'still' | 'stuck';

export function movementKind(moved: boolean | null, dwellMs: number, stuckMs: number): MovementKind {
    if (moved === null) return 'seen';
    if (moved) return 'moving';
    if (dwellMs >= stuckMs) return 'stuck';
    return 'still';
}

export function tileDist(a: { x: number; z: number }, b: { x: number; z: number }): number {
    return Math.hypot(a.x - b.x, a.z - b.z);
}

export interface Nearby {
    fleet: string[];
    strangers: string[];
}

export function nearbyPlayers(
    self: { name: string; x: number; z: number; level: number },
    fleet: WorldPlayer[],
    strangers: WorldPlayer[],
    radius: number
): Nearby {
    const close = (list: WorldPlayer[]) =>
        list
            .filter((p) => p.level === self.level && nameKey(p.name) !== nameKey(self.name) && tileDist(self, p) <= radius)
            .sort((a, b) => tileDist(self, a) - tileDist(self, b))
            .map((p) => p.name);
    return { fleet: close(fleet), strangers: close(strangers) };
}

export interface Pile {
    x: number;
    z: number;
    level: number;
    names: string[];
}

export function piles(players: WorldPlayer[], minCount: number): Pile[] {
    const groups = new Map<string, WorldPlayer[]>();
    for (const p of players) {
        const key = `${p.level}:${p.x}:${p.z}`;
        const list = groups.get(key);
        if (list) list.push(p);
        else groups.set(key, [p]);
    }
    const out: Pile[] = [];
    for (const list of groups.values()) {
        if (list.length < minCount) continue;
        const first = list[0]!;
        out.push({
            x: first.x,
            z: first.z,
            level: first.level,
            names: list.map((p) => p.name).sort((a, b) => a.localeCompare(b))
        });
    }
    out.sort((a, b) => b.names.length - a.names.length);
    return out;
}

export interface GainFix {
    xp: number | null;
    /** Sorted `id:count` pairs. Not coins alone. */
    inv: string | null;
    /** Epoch ms when inventory or xp last changed. */
    drySince: number;
}

export interface GainSample {
    xp: number;
    inv: string;
}

/**
 * Inventory signature. Order and empty slots do not count; id and stack do.
 */
export function inventorySig(items: { id: number; count: number }[]): string {
    return items
        .filter((item) => item.id > 0 && item.count > 0)
        .map((item) => `${item.id}:${item.count}`)
        .sort()
        .join(',');
}

export function xpTotal(skills: { experience: number }[]): number {
    return skills.reduce((sum, skill) => sum + (Number.isFinite(skill.experience) ? skill.experience : 0), 0);
}

/**
 * Compare this sample to the previous one.
 * A missing sample or a cold history leaves the changed-flags null — that is
 * not "no change".
 */
export function nextGains(
    prior: GainFix | undefined,
    now: number,
    priorSavedAt: number | null,
    sample: GainSample | null
): { gain: GainFix; inventoryChanged: boolean | null; xpChanged: boolean | null } {
    const fresh = !prior || priorSavedAt == null || now - priorSavedAt > MAX_GAP_MS;
    if (!sample) {
        return {
            gain: {
                xp: prior?.xp ?? null,
                inv: prior?.inv ?? null,
                drySince: fresh ? now : (prior?.drySince ?? now)
            },
            inventoryChanged: null,
            xpChanged: null
        };
    }
    if (fresh || !prior) {
        return {
            gain: { xp: sample.xp, inv: sample.inv, drySince: now },
            inventoryChanged: null,
            xpChanged: null
        };
    }
    const inventoryChanged = prior.inv == null ? null : prior.inv !== sample.inv;
    const xpChanged = prior.xp == null ? null : prior.xp !== sample.xp;
    const bothFlat = inventoryChanged === false && xpChanged === false;
    return {
        gain: {
            xp: sample.xp,
            inv: sample.inv,
            drySince: bothFlat ? prior.drySince : now
        },
        inventoryChanged,
        xpChanged
    };
}

export type ProgressKind = 'absent' | 'unknown' | 'working' | 'task' | 'flat' | 'stuck';

/**
 * Stuck is the flat cell held long enough: no inventory change, no xp, no movement.
 * Movement with neither gain is task-dependent. A standing job that stays there
 * past the threshold is stuck. Xp changing is the task happening.
 * Inventory changing without xp (bank, eat, trade, gear) stays task-dependent.
 * A null signal is unknown, never stuck.
 */
export function classifyProgress(opts: {
    onMap: boolean;
    inventoryChanged: boolean | null;
    xpChanged: boolean | null;
    moved: boolean | null;
    dryMs: number;
    thresholdMs: number;
    stationary: boolean;
}): ProgressKind {
    if (!opts.onMap) return 'absent';
    const { inventoryChanged, xpChanged, moved } = opts;
    if (inventoryChanged == null || xpChanged == null || moved == null) return 'unknown';
    if (xpChanged) return 'working';
    if (inventoryChanged) return 'task';
    if (!moved) return opts.dryMs >= opts.thresholdMs ? 'stuck' : 'flat';
    if (opts.stationary && opts.dryMs >= opts.thresholdMs) return 'stuck';
    return 'task';
}

export function progressDetail(kind: ProgressKind): string {
    switch (kind) {
        case 'stuck':
            return 'no inventory change and no xp, past the job threshold';
        case 'flat':
            return 'no inventory change, no xp, and no movement — under the time threshold';
        case 'task':
            return 'task-dependent: movement or inventory changed without xp';
        case 'working':
            return 'xp changed';
        case 'unknown':
            return 'inventory or xp was not observed';
        default:
            return 'not on the world map';
    }
}

export function indexPlayers(players: WorldPlayer[]): Map<string, WorldPlayer> {
    const map = new Map<string, WorldPlayer>();
    for (const p of players) {
        if (!p.name || !Number.isFinite(p.x) || !Number.isFinite(p.z) || !Number.isFinite(p.level)) continue;
        map.set(nameKey(p.name), p);
    }
    return map;
}
