/** Named tiles and waypoint lists shared by the Kandarin grind routes. */
export type Tile = { x: number; z: number };

export const ARDOUGNE_BANK: Tile = { x: 2655, z: 3283 };
export const ARDOUGNE_MARKET: Tile = { x: 2662, z: 3312 };
export const HOUSE_DOOR: Tile = { x: 2672, z: 3311 };
export const HOUSE_DOOR_SOUTH: Tile = { x: 2672, z: 3305 };
export const HOUSE_STAND: Tile = { x: 2674, z: 3311 };
export const HOUSE_OUTSIDE: Tile = { x: 2669, z: 3311 };
/** East of Handelmort mansion yard — guard dogs at ~(2624,3319). 2656,3305 is a wall; the road on z=3307 is open. */
export const HANDELMORT_SAFE_EAST: Tile = { x: 2658, z: 3307 };

/** Handelmort mansion yard + interior (west of the east fence ~2650). */
export function inHandelmortMansion(x: number, z: number): boolean {
    return x >= 2615 && x < 2645 && z >= 3290 && z <= 3325;
}
export const CATHERBY_BANK: Tile = { x: 2808, z: 3443 };
export const DRAYNOR_BANK: Tile = { x: 3092, z: 3243 };
export const FALADOR_EAST_BANK: Tile = { x: 3012, z: 3355 };
export const FALADOR_WEST_BANK: Tile = { x: 2945, z: 3368 };
export const FALADOR_FURNACE: Tile = { x: 2974, z: 3369 };
export const FALADOR_NORTH: Tile = { x: 2964, z: 3381 };
export const DORIC_ANVIL: Tile = { x: 2952, z: 3451 };
export const RIMMINGTON_IRON: Tile = { x: 2969, z: 3240 };
export const RIMMINGTON_BRONZE: Tile = { x: 2976, z: 3238 };
export const GUILD_LADDER: Tile = { x: 3019, z: 3339 };
export const GUILD_LADDER_DOWN: Tile = { x: 3019, z: 9739 };
export const GUILD_COAL: Tile = { x: 3046, z: 9735 };
/** North-room iron (same cluster as dwarven-mine stairs). */
export const GUILD_IRON: Tile = { x: 3040, z: 9774 };
export const DWARVEN_STAIRS_DOWN: Tile = { x: 3059, z: 3376 };
export const DWARVEN_STAIRS_UP: Tile = { x: 3058, z: 9776 };
export const DWARVEN_MINE_DOOR: Tile = { x: 3063, z: 3380 };
export const DITCH_NORTH: Tile = { x: 3088, z: 3525 };
export const DITCH_SOUTH: Tile = { x: 3088, z: 3518 };
/** Hobgoblin / snape-grass peninsula west of the Crafting Guild. */
export const CRAFTING_GUILD_HOBS: Tile = { x: 2905, z: 3295 };
/** East bank → south of Falador (3007, 3297) → west of guild → peninsula. */
export const TO_CRAFTING_GUILD_HOBS: Tile[] = [
    { x: 3012, z: 3355 },
    { x: 3007, z: 3297 },
    { x: 2919, z: 3273 },
    { x: 2905, z: 3295 }
];
export const TO_FALADOR_EAST_FROM_HOBS: Tile[] = [...TO_CRAFTING_GUILD_HOBS].reverse();
export const EDGEVILLE: Tile = { x: 3094, z: 3492 };
/** Musa Point ship tile — fleet-status intervene heuristic. */
export const MUSA_SHIP: Tile = { x: 2951, z: 3142 };
/** Edgeville wilderness lever (south of bank). */
export const EDGEVILLE_LEVER: Tile = { x: 3090, z: 3475 };
export const DESERTED_KEEP_LEVER: Tile = { x: 3154, z: 3924 };
/** East Ardougne castle hut — pulls to the deserted keep. Door is (2564, 3310). */
export const ARDOUGNE_WILDY_LEVER: Tile = { x: 2561, z: 3311 };
export const ARDOUGNE_LEVER_DOOR: Tile = { x: 2564, z: 3310 };
/** North keep web is a wall tile — never sendWalk onto it. */
export const KEEP_WEB: Tile = { x: 3158, z: 3951 };
export const KEEP_WEB_NORTH: Tile = { x: 3158, z: 3953 };
export const KEEP_WEB_SOUTH: Tile = { x: 3158, z: 3949 };
/** North-south road west of the keep fence. Stay on x=3135 past z 3895–3905. */
export const KEEP_ROAD_X = 3135;
export const YANILLE_BANK: Tile = { x: 2613, z: 3091 };
/** Stay z=3283 (south of Handelmort) until west of the mansion, then north to the hut. */
export const YANILLE_TO_ARDY_LEVER: Tile[] = [
    { x: 2615, z: 3110 },
    { x: 2630, z: 3170 },
    { x: 2640, z: 3220 },
    { x: 2662, z: 3283 },
    { x: 2580, z: 3283 },
    { x: 2565, z: 3308 },
    { x: 2561, z: 3311 }
];
export const LUMBRIDGE_MEN: Tile = { x: 3222, z: 3218 };
export const PORT_SARIM_DOCK: Tile = { x: 3029, z: 3217 };
export const BRIMHAVEN_CUSTOMS: Tile = { x: 2772, z: 3225 };
export const AEMAD_SHOP: Tile = { x: 2613, z: 3294 };
export const RANGING_GUILD_DOOR: Tile = { x: 2658, z: 3439 };
export const DARGAUD: Tile = { x: 2673, z: 3434 };
export const RANGING_CHICKENS: Tile = { x: 2650, z: 3441 };

/** West of Legends Guild and Keep Le Faye. Stay on the north road. */
export const ARDY_TO_CATHERBY: Tile[] = [
    { x: 2662, z: 3336 },
    { x: 2662, z: 3375 },
    { x: 2695, z: 3375 },
    { x: 2726, z: 3485 },
    { x: 2758, z: 3477 },
    { x: 2788, z: 3460 },
    { x: 2808, z: 3443 },
];

/** Current HP above this uses White Wolf instead of the wilderness lever. */
export const WHITE_WOLF_MIN_HP = 30;

/**
 * Moss-giant road (3135, 3806) south to the ditch, staying east of the green
 * dragons at 3078, 3810. Collision path; do not sendWalk toward 3088, 3525
 * from up here — that line goes through the dragons.
 */
export const WILDY_SOUTH_TO_DITCH: Tile[] = [
    { x: 3135, z: 3792 },
    { x: 3135, z: 3778 },
    { x: 3135, z: 3764 },
    { x: 3135, z: 3750 },
    { x: 3135, z: 3736 },
    { x: 3135, z: 3722 },
    { x: 3135, z: 3708 },
    { x: 3135, z: 3694 },
    { x: 3135, z: 3680 },
    { x: 3135, z: 3666 },
    { x: 3135, z: 3652 },
    { x: 3135, z: 3638 },
    { x: 3135, z: 3624 },
    { x: 3135, z: 3610 },
    { x: 3135, z: 3596 },
    { x: 3125, z: 3582 },
    { x: 3111, z: 3568 },
    { x: 3100, z: 3554 },
    { x: 3100, z: 3540 },
    { x: 3098, z: 3526 },
    { x: 3092, z: 3516 }
];

/** South of the Edgeville ditch, over White Wolf, to the Catherby bank street. */
export const WHITE_WOLF_TO_CATHERBY: Tile[] = [
    { x: 3088, z: 3512 },
    { x: 3074, z: 3518 },
    { x: 3060, z: 3532 },
    { x: 3046, z: 3532 },
    { x: 3032, z: 3538 },
    { x: 3018, z: 3546 },
    { x: 3004, z: 3543 },
    { x: 2993, z: 3529 },
    { x: 2980, z: 3515 },
    { x: 2979, z: 3501 },
    { x: 2973, z: 3487 },
    { x: 2968, z: 3473 },
    { x: 2957, z: 3459 },
    { x: 2944, z: 3455 },
    { x: 2930, z: 3451 },
    { x: 2916, z: 3453 },
    { x: 2902, z: 3447 },
    { x: 2888, z: 3433 },
    { x: 2874, z: 3430 },
    { x: 2867, z: 3444 },
    { x: 2866, z: 3458 },
    { x: 2855, z: 3472 },
    { x: 2857, z: 3486 },
    { x: 2861, z: 3500 },
    { x: 2849, z: 3508 },
    { x: 2841, z: 3496 },
    { x: 2849, z: 3482 },
    { x: 2844, z: 3468 },
    { x: 2846, z: 3454 },
    { x: 2855, z: 3440 },
    { x: 2841, z: 3438 },
    { x: 2827, z: 3439 },
    { x: 2816, z: 3439 }
];

export const CATHERBY_TO_ARDY: Tile[] = [
    { x: 2808, z: 3443 },
    { x: 2788, z: 3460 },
    { x: 2758, z: 3477 },
    { x: 2726, z: 3485 },
    { x: 2695, z: 3375 },
    { x: 2662, z: 3375 },
    { x: 2662, z: 3336 },
    { x: 2662, z: 3312 },
];

export const ARDY_TO_RANGING: Tile[] = [
    { x: 2662, z: 3336 },
    { x: 2662, z: 3375 },
    { x: 2658, z: 3439 },
];

export const SEERS_BANK: Tile = { x: 2726, z: 3485 };
/** Magic tree cluster NE of Legends Guild. 2696,3410 sits on an oak 13 tiles south. */
export const LEGENDS_MAGICS: Tile = { x: 2696, z: 3423 };
/** Smithy immediately west of Seers bank. */
export const SEERS_ANVIL: Tile = { x: 2713, z: 3493 };
/** Willows NW of the bank (pond / Forester's Arms). */
export const SEERS_WILLOWS: Tile = { x: 2710, z: 3508 };
/** Maples immediately north of the bank. */
export const SEERS_MAPLES: Tile = { x: 2727, z: 3500 };
/** Churchyard yews south of the bank. */
export const SEERS_YEWS: Tile = { x: 2708, z: 3461 };
/** Regular trees immediately south of the bank. */
export const SEERS_TREES: Tile = { x: 2725, z: 3482 };
/** Oak next to the bank / willow cluster. */
export const SEERS_OAKS: Tile = { x: 2712, z: 3500 };
/** Open road south of the bank — firemaking line walks south from here. */
export const SEERS_FIRE_START: Tile = { x: 2724, z: 3478 };
export const ARHEIN_SHOP: Tile = { x: 2803, z: 3430 };
/** Fishing Guild door (Master fisher). Jackthief 99 Fishing can enter. */
export const FISHING_GUILD_DOOR: Tile = { x: 2611, z: 3393 };
/** Roachey — Fishing Guild Shop (feathers). */
export const FISHING_GUILD_SHOP: Tile = { x: 2596, z: 3400 };
/** Catherby bank → guild along the south coast (avoid White Wolf). */
export const CATHERBY_TO_FISHING_GUILD: Tile[] = [
    { x: 2808, z: 3443 },
    { x: 2774, z: 3436 },
    { x: 2728, z: 3428 },
    { x: 2672, z: 3416 },
    { x: 2612, z: 3394 }
];
/** Jiminua's Jungle Store hut (west of Tai Bwo Wannai). Not the jungle at 2805,3114. */
export const JIMINUA_SHOP: Tile = { x: 2767, z: 3122 };
/** East Ardougne south docks — Captain Barnaby to Brimhaven (30gp). */
export const CAPTAIN_BARNABY: Tile = { x: 2679, z: 3275 };
/** Customs hut south along the west coast to Jiminua. */
export const BRIMHAVEN_TO_JIMINUA: Tile[] = [
    BRIMHAVEN_CUSTOMS,
    { x: 2769, z: 3190 },
    { x: 2766, z: 3155 },
    JIMINUA_SHOP
];
/** Musa Point west to Jiminua (avoid the east jungle). */
export const MUSA_TO_JIMINUA: Tile[] = [
    { x: 2912, z: 3160 },
    { x: 2864, z: 3154 },
    { x: 2812, z: 3150 },
    { x: 2774, z: 3130 },
    JIMINUA_SHOP
];
/** Yanille bank → east Ardougne docks. */
export const YANILLE_TO_BARNABY: Tile[] = [
    { x: 2615, z: 3110 },
    { x: 2630, z: 3170 },
    { x: 2640, z: 3220 },
    { x: 2662, z: 3283 },
    CAPTAIN_BARNABY
];
/** Stand SW of the 3x3 mysterious ruins at (2869, 3019). */
export const NATURE_RUINS: Tile = { x: 2867, z: 3017 };
/** One tile off the runner stack so jackthief can target them. */
export const NATURE_CRAFTER_STAND: Tile = { x: 2864, z: 3016 };
/** Nature altar interior (enter spawn / crafting shrine). */
export const NATURE_ALTAR: Tile = { x: 2400, z: 4835 };
/** Jungle click-path: leave Jiminua east of the hut plants, south around TBW. */
export const JIMINUA_TO_NATURE: Tile[] = [
    { x: 2767, z: 3122 },
    { x: 2768, z: 3120 },
    { x: 2770, z: 3114 },
    { x: 2774, z: 3109 },
    { x: 2775, z: 3088 },
    { x: 2784, z: 3074 },
    { x: 2797, z: 3073 },
    { x: 2812, z: 3076 },
    { x: 2822, z: 3069 },
    { x: 2830, z: 3061 },
    { x: 2833, z: 3055 },
    { x: 2838, z: 3051 },
    { x: 2852, z: 3037 },
    { x: 2852, z: 3032 },
    { x: 2862, z: 3022 },
    { x: 2866, z: 3019 },
    { x: 2867, z: 3017 },
];
export const NATURE_TO_JIMINUA: Tile[] = [...JIMINUA_TO_NATURE].reverse();

/** Varrock west bank (booths south of the GE table). */
export const VARROCK_WEST_BANK: Tile = { x: 3186, z: 3436 };
export const VARROCK_EAST_BANK: Tile = { x: 3253, z: 3420 };
export const AL_KHARID_BANK: Tile = { x: 3269, z: 3167 };
/** Lumbridge castle bank. */
export const LUMBRIDGE_BANK: Tile = { x: 3208, z: 3220 };

export type NamedBank = Tile & { name: string };

/** Banks used to snapshot / return from a grind. Closest-by-tile, not path length. */
export const FLEET_BANKS: NamedBank[] = [
    { name: 'Yanille', ...YANILLE_BANK },
    { name: 'Ardougne', ...ARDOUGNE_BANK },
    { name: 'Catherby', ...CATHERBY_BANK },
    { name: 'Seers', ...SEERS_BANK },
    { name: 'Falador east', ...FALADOR_EAST_BANK },
    { name: 'Falador west', ...FALADOR_WEST_BANK },
    { name: 'Draynor', ...DRAYNOR_BANK },
    { name: 'Edgeville', ...EDGEVILLE },
    { name: 'Varrock west', ...VARROCK_WEST_BANK },
    { name: 'Varrock east', ...VARROCK_EAST_BANK },
    { name: 'Al Kharid', ...AL_KHARID_BANK },
    { name: 'Lumbridge', ...LUMBRIDGE_BANK }
];

/** Mining guild basement uses z ≈ surface + 6400 (ladder 3019,3339 ↔ 3019,9739). */
export function toSurfaceTile(x: number, z: number): Tile {
    if (x >= 3005 && x <= 3068 && z >= 9700 && z <= 9820) return { x, z: z - 6400 };
    return { x, z };
}

export function closestFleetBank(x: number, z: number): { bank: NamedBank; distance: number } {
    const at = toSurfaceTile(x, z);
    let best = FLEET_BANKS[0]!;
    let distance = Infinity;
    for (const bank of FLEET_BANKS) {
        const d = Math.hypot(at.x - bank.x, at.z - bank.z);
        if (d < distance) {
            best = bank;
            distance = d;
        }
    }
    return { bank: best, distance };
}
