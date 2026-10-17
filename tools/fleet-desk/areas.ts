/**
 * Turn a world tile into the name a player would use.
 *
 * Towns whose world-map label sits off to one side of the buildings are
 * boxes. Everywhere else uses the nearest label from the game map
 * (`server/content/maps/labels.txt`). Kingdom-sized labels (size 2) only
 * win in the empty space between towns.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { inEssenceMine, inMiningGuild } from '../../sdk/regions';

export interface Place {
    name: string;
    x: number;
    z: number;
    size: number;
}

interface Box {
    name: string;
    x0: number;
    z0: number;
    x1: number;
    z1: number;
}

const LABELS_PATH = join(import.meta.dir, '../../server/content/maps/labels.txt');

/** Underground rooms the surface map does not label. */
const UNDERGROUND: Box[] = [
    { name: 'King Black Dragon', x0: 2640, z0: 9760, x1: 2765, z1: 9865 },
    { name: 'Edgeville dungeon', x0: 3040, z0: 9800, x1: 3220, z1: 10080 },
    { name: 'Zanaris', x0: 3080, z0: 9480, x1: 3320, z1: 9680 },
    { name: 'Dwarven Mine', x0: 2960, z0: 9600, x1: 3075, z1: 9799 },
];

/**
 * Town footprints. Checked before map labels so a bank on the east side of
 * a city is not named after the nearest sign (Ardougne's "Zoo", Yanille's
 * "Wizards' Guild", Draynor's "Market").
 */
const TOWNS: Box[] = [
    { name: 'Lumbridge Swamp', x0: 3135, z0: 3145, x1: 3255, z1: 3204 },
    { name: 'Lumbridge', x0: 3200, z0: 3205, x1: 3265, z1: 3305 },
    { name: 'Draynor Manor', x0: 3085, z0: 3320, x1: 3132, z1: 3372 },
    { name: 'Draynor Village', x0: 3065, z0: 3220, x1: 3145, z1: 3292 },
    { name: 'Al Kharid', x0: 3265, z0: 3155, x1: 3345, z1: 3268 },
    { name: 'Varrock', x0: 3160, z0: 3380, x1: 3290, z1: 3508 },
    { name: 'Barbarian Village', x0: 3045, z0: 3405, x1: 3098, z1: 3448 },
    { name: 'Edgeville', x0: 3065, z0: 3465, x1: 3135, z1: 3522 },
    { name: 'Falador', x0: 2935, z0: 3310, x1: 3068, z1: 3402 },
    { name: 'Port Sarim', x0: 3008, z0: 3205, x1: 3064, z1: 3258 },
    { name: 'Rimmington', x0: 2925, z0: 3190, x1: 3004, z1: 3268 },
    { name: 'Taverley', x0: 2875, z0: 3410, x1: 2938, z1: 3492 },
    { name: 'Catherby', x0: 2788, z0: 3412, x1: 2868, z1: 3468 },
    { name: "Seers' Village", x0: 2680, z0: 3456, x1: 2752, z1: 3518 },
    { name: 'Camelot', x0: 2753, z0: 3470, x1: 2795, z1: 3520 },
    { name: 'East Ardougne', x0: 2560, z0: 3265, x1: 2692, z1: 3342 },
    { name: 'West Ardougne', x0: 2460, z0: 3270, x1: 2555, z1: 3338 },
    { name: 'Yanille', x0: 2535, z0: 3065, x1: 2628, z1: 3128 },
    { name: 'Tree Gnome Stronghold', x0: 2375, z0: 3385, x1: 2508, z1: 3518 },
];

let cached: Place[] | null = null;

export function parsePlaces(text: string): Place[] {
    const places: Place[] = [];
    for (const line of text.split(/\r?\n/)) {
        if (!line.startsWith('=')) continue;
        const [raw, xs, zs, sizePart] = line.slice(1).split(',');
        if (!raw || xs == null || zs == null) continue;
        const name = raw
            .split('/')
            .map((part) => part.trim())
            .filter((part) => part && !/^\(.*\)$/.test(part) && !/^due\b/i.test(part))
            .join(' ');
        if (!name) continue;
        const x = Number(xs);
        const z = Number(zs);
        if (!Number.isFinite(x) || !Number.isFinite(z)) continue;
        places.push({ name, x, z, size: Number(sizePart ?? 0) || 0 });
    }
    return places;
}

export function loadPlaces(): Place[] {
    if (!cached) cached = parsePlaces(readFileSync(LABELS_PATH, 'utf8'));
    return cached;
}

function inBox(x: number, z: number, box: Box): boolean {
    return x >= box.x0 && x <= box.x1 && z >= box.z0 && z <= box.z1;
}

export function areaName(x: number, z: number, places: Place[] = loadPlaces()): string {
    if (inMiningGuild(x, z)) return 'Mining Guild';
    if (inEssenceMine(x, z)) return 'Rune essence mine';
    for (const box of UNDERGROUND) {
        if (inBox(x, z, box)) return box.name;
    }
    if (z >= 9000) return 'Underground';
    for (const box of TOWNS) {
        if (inBox(x, z, box)) return box.name;
    }

    let best: { name: string; score: number } | null = null;
    for (const place of places) {
        const dist = Math.hypot(place.x - x, place.z - z);
        const score = place.size >= 2 ? dist * 2.5 : dist;
        if (!best || score < best.score) best = { name: place.name, score };
    }
    return best?.name ?? `${Math.round(x)}, ${Math.round(z)}`;
}
