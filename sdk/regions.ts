/** Shared world-region predicates for activity scripts and unit tests. */

export const SEERS_FLAX = { x: 2744, z: 3444 };

/** True when standing at the Seers flax field (not the spinning-wheel house). */
export function atSeersFlax(x: number, z: number, radius = 12): boolean {
    return Math.hypot(x - SEERS_FLAX.x, z - SEERS_FLAX.z) <= radius;
}

/**
 * Rune essence mine interior after an Aubury/Sedridor teleport.
 * Matches the live Jackpoo2 landings around (2926, 4818).
 */
export function inEssenceMine(x: number, z: number): boolean {
    return x >= 2860 && x <= 3040 && z >= 4760 && z <= 4940;
}

/**
 * Surface wilderness north of the Edgeville ditch. Excludes the essence
 * mine (same z-band as deep wildy) so callers still pathfind there.
 */
export function inWilderness(x: number, z: number): boolean {
    return z >= 3520 && z < 6400 && !inEssenceMine(x, z);
}

/**
 * Falador Mining Guild cavern (ladder at ~3019,9739). Not the rest of the
 * Dwarven Mine north of the guild door.
 */
export function inMiningGuild(x: number, z: number): boolean {
    return x >= 3014 && x <= 3058 && z >= 9728 && z <= 9788;
}

/**
 * South mithril/coal room of the Mining Guild. North of this (z 9750+) is
 * adamant plus king-scorpion wander around (3040, 9775).
 */
export function inMiningGuildSouth(x: number, z: number): boolean {
    return inMiningGuild(x, z) && z <= 9750;
}

export function npcHasTeleportOption(options: Array<{ text: string }>): boolean {
    return options.some((o) => /teleport/i.test(o.text));
}

/**
 * Opening Aubury's rune shop is not a teleport. Callers must close the shop
 * and use the Teleport option instead of Trade.
 */
export function shopIsNotTeleport(shopOpen: boolean): boolean {
    return shopOpen === true;
}
