/**
 * Taverley dungeon: Velrak's Dusty key and the blue dragon scale spawns behind its gate.
 *
 * Recorded from the operator playing jacklove10 by hand (tools/observe-demo.ts,
 * demos/demo-jacklove10-2026-10-30T10-25-41-766Z.jsonl), checked against content:
 *   - jailer.rs2: the Jailer drops the Jail key. Spawn (2933,9693), map m45_151.
 *   - jail_doors.rs2: `dungeonjail` (Velrak's cell, 2931,9690) opens with the Jail key
 *     used on it; `deepdungeondoor` (the gate, 2924,9803) with the Dusty key. Going OUT
 *     through either needs no key ("... locks shut behind you").
 *   - velrak_the_explorer.rs2: no Dusty key held -> "So... do you know anywhere good to
 *     explore?" -> "Yes please!" gives one.
 *   - m45_153 OBJ: blue_dragon_scale (243) spawns at the five SCALE_SPAWNS tiles.
 * The operator prayed Protect from Magic beside the dragons (not in the recording). Kit
 * suggested by the operator for a full pack of scales: anti-dragon shield + 4 sharks.
 */

export interface Tile {
    x: number;
    z: number;
    level?: number;
}

/** Surface entrance (Taverley) and the ladder up from the dungeon. */
export const LADDER_SURFACE: Tile = { x: 2884, z: 3397 };
export const LADDER_DUNGEON: Tile = { x: 2884, z: 9797 };

/**
 * The cauldron room's Prison door (cauldrondoor, prison_doors.rs2), on the ladder-to-gate
 * route. The waypoint at this tile in the routes below means "cross the door". From the
 * ladder side the first opens wake the two suits of armour (0_45_153_7_37 / 7_40, back as
 * scenery after 500 ticks); the open after that lets you through.
 */
export const PRISON_DOOR: Tile = { x: 2889, z: 9830 };

export const JAILER_SPAWN: Tile = { x: 2933, z: 9693 };
export const VELRAK_CELL_DOOR: Tile = { x: 2931, z: 9690 };
export const VELRAK: Tile = { x: 2933, z: 9686 };
export const DUSTY_GATE: Tile = { x: 2924, z: 9803 };
/** Stand here (east side) to use the Dusty key on the gate; west of it is the dragon pen. */
export const DUSTY_GATE_OUTSIDE: Tile = { x: 2925, z: 9803 };

export const SCALE_SPAWNS: Tile[] = [
    { x: 2902, z: 9806 },
    { x: 2905, z: 9801 },
    { x: 2906, z: 9796 },
    { x: 2908, z: 9805 },
    { x: 2910, z: 9809 },
];

/**
 * The operator's walk from the ladder down to the jail (the way back up, reversed):
 * east and south around the dungeon's middle, not straight south.
 */
export const LADDER_TO_JAIL: Tile[] = [
    { x: 2885, z: 9808 },
    { x: 2887, z: 9823 },
    { x: 2889, z: 9830 },
    { x: 2896, z: 9831 },
    { x: 2912, z: 9827 },
    { x: 2928, z: 9831 },
    { x: 2936, z: 9833 },
    { x: 2939, z: 9819 },
    { x: 2942, z: 9805 },
    { x: 2949, z: 9795 },
    { x: 2951, z: 9780 },
    { x: 2942, z: 9777 },
    { x: 2934, z: 9768 },
    { x: 2929, z: 9756 },
    { x: 2924, z: 9749 },
    { x: 2911, z: 9742 },
    { x: 2908, z: 9725 },
    { x: 2908, z: 9703 },
    { x: 2908, z: 9695 },
    { x: 2916, z: 9692 },
    { x: 2923, z: 9691 },
];

/** Jail (Dusty key in hand) up to the gate, as walked. */
export const JAIL_TO_GATE: Tile[] = [
    { x: 2916, z: 9692 },
    { x: 2908, z: 9695 },
    { x: 2908, z: 9711 },
    { x: 2908, z: 9725 },
    { x: 2911, z: 9742 },
    { x: 2924, z: 9749 },
    { x: 2924, z: 9762 },
    { x: 2930, z: 9779 },
    { x: 2935, z: 9790 },
    { x: 2933, z: 9797 },
    { x: 2927, z: 9802 },
];

/** Out of the gate back to the ladder, as walked (south, then round the east and north sides). */
export const GATE_TO_LADDER: Tile[] = [
    { x: 2930, z: 9798 },
    { x: 2935, z: 9785 },
    { x: 2930, z: 9774 },
    { x: 2929, z: 9756 },
    { x: 2934, z: 9768 },
    { x: 2942, z: 9777 },
    { x: 2951, z: 9780 },
    { x: 2949, z: 9795 },
    { x: 2942, z: 9805 },
    { x: 2939, z: 9819 },
    { x: 2936, z: 9833 },
    { x: 2928, z: 9831 },
    { x: 2912, z: 9827 },
    { x: 2903, z: 9829 },
    { x: 2896, z: 9831 },
    // PRISON_DOOR. Without it walkTo stuck at (2886,9830) and fell back to a ~300-tick
    // travelTo (qlbds1, 2026-10-30).
    { x: 2889, z: 9830 },
    { x: 2887, z: 9823 },
    { x: 2885, z: 9808 },
    { x: 2885, z: 9796 },
];
