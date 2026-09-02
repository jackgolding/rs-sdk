/** Named tiles and waypoint lists shared by the Kandarin grind routes. */
export type Tile = { x: number; z: number };

export const ARDOUGNE_BANK: Tile = { x: 2655, z: 3283 };
export const ARDOUGNE_MARKET: Tile = { x: 2662, z: 3312 };
export const HOUSE_DOOR: Tile = { x: 2672, z: 3311 };
export const HOUSE_DOOR_SOUTH: Tile = { x: 2672, z: 3305 };
export const HOUSE_STAND: Tile = { x: 2674, z: 3311 };
export const HOUSE_OUTSIDE: Tile = { x: 2669, z: 3311 };
/** East of Handelmort mansion yard — guard dogs at ~(2624,3319). */
export const HANDELMORT_SAFE_EAST: Tile = { x: 2656, z: 3305 };

/** Handelmort mansion yard + interior (west of the east fence ~2650). */
export function inHandelmortMansion(x: number, z: number): boolean {
    return x >= 2615 && x < 2645 && z >= 3290 && z <= 3325;
}
export const CATHERBY_BANK: Tile = { x: 2808, z: 3443 };
export const DRAYNOR_BANK: Tile = { x: 3092, z: 3243 };
export const FALADOR_EAST_BANK: Tile = { x: 3012, z: 3355 };
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
/** Jiminua's Jungle Store hut (west of Tai Bwo Wannai). Not the jungle at 2805,3114. */
export const JIMINUA_SHOP: Tile = { x: 2767, z: 3122 };
/** Stand SW of the 3x3 mysterious ruins at (2869, 3019). */
export const NATURE_RUINS: Tile = { x: 2867, z: 3017 };
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
