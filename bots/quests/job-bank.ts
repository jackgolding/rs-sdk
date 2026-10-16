/**
 * Which bank a roster job uses, and the tiles that job walks to reach it.
 * Jobs with no bank fall through to the closest named bank.
 */
import {
    ARDOUGNE_BANK,
    ARDY_TO_CATHERBY,
    CATHERBY_BANK,
    CATHERBY_TO_ARDY,
    DRAYNOR_BANK,
    EDGEVILLE,
    FALADOR_EAST_BANK,
    SEERS_BANK,
    TO_FALADOR_EAST_FROM_HOBS,
    VARROCK_EAST_BANK,
    WILDY_SOUTH_TO_DITCH,
    YANILLE_BANK,
    closestFleetBank,
    type Tile,
} from './tiles';

export type NamedBank = Tile & { name: string };

export type BankClimb = 'edgeville-dungeon' | 'mining-guild';

export type BankPlan = {
    bank: NamedBank;
    /** Tiles to walk, in order, ending at the bank. */
    points: Tile[];
    climb: BankClimb | null;
    /** Surface wilderness: cross the Edgeville ditch before tiles south of it. */
    ditch: boolean;
    source: 'job' | 'closest';
};

const ARDOUGNE: NamedBank = { name: 'Ardougne', ...ARDOUGNE_BANK };
const CATHERBY: NamedBank = { name: 'Catherby', ...CATHERBY_BANK };
const DRAYNOR: NamedBank = { name: 'Draynor', ...DRAYNOR_BANK };
const FALADOR_EAST: NamedBank = { name: 'Falador east', ...FALADOR_EAST_BANK };
const EDGE: NamedBank = { name: 'Edgeville', ...EDGEVILLE };
const SEERS: NamedBank = { name: 'Seers', ...SEERS_BANK };
const YANILLE: NamedBank = { name: 'Yanille', ...YANILLE_BANK };
const VARROCK_EAST: NamedBank = { name: 'Varrock east', ...VARROCK_EAST_BANK };

const JOB_BANK: Record<string, NamedBank> = {
    'thieving-route.ts': ARDOUGNE,
    'fishing-route.ts': CATHERBY,
    'law-runes.ts': DRAYNOR,
    'mining-guild.ts': FALADOR_EAST,
    'seers-wc-fm.ts': SEERS,
    'magic-trees.ts': SEERS,
    'edgeville-dungeon-melee.ts': EDGE,
    'edgeville-range-druids.ts': EDGE,
    'wildy-range.ts': EDGE,
    'green-dragons.ts': EDGE,
    'hobgoblins.ts': FALADOR_EAST,
    'rune-rocks.ts': EDGE,
    'catherby-cook-bank.ts': CATHERBY,
    'essence.ts': VARROCK_EAST,
    'rimmington-iron.ts': FALADOR_EAST,
};

function scriptFile(script: string): string {
    const slash = script.lastIndexOf('/');
    return slash < 0 ? script : script.slice(slash + 1);
}

function closestOf(here: Tile, banks: NamedBank[]): NamedBank {
    let best = banks[0]!;
    let distance = Infinity;
    for (const bank of banks) {
        const d = Math.hypot(here.x - bank.x, here.z - bank.z);
        if (d < distance) {
            best = bank;
            distance = d;
        }
    }
    return best;
}

export function inEdgevilleDungeon(x: number, z: number): boolean {
    return z >= 9860 && z < 10050 && x >= 3075 && x <= 3155;
}

export function inMiningGuild(x: number, z: number): boolean {
    return x >= 3005 && x <= 3068 && z >= 9700 && z <= 9820;
}

function onSurfaceWildy(z: number): boolean {
    return z >= 3523 && z < 9000;
}

/** Road around the Ardougne market houses. A straight hop from the knights clips walls. */
export function ardougneApproach(x: number, z: number, bankX: number, bankZ: number): Tile[] {
    const points: Tile[] = [];
    if (z >= 3314) points.push({ x: Math.min(x, 2668), z: 3312 });
    if (x >= 2670 && z >= 3300 && z <= 3314) points.push({ x: 2666, z: Math.min(z, 3308) });
    if (z > 3292) points.push({ x: 2662, z: 3290 });
    points.push({ x: bankX, z: bankZ });
    return points;
}

function untilBank(list: Tile[], bank: NamedBank): Tile[] {
    const idx = list.findIndex((tile) => tile.x === bank.x && tile.z === bank.z);
    return idx >= 0 ? list.slice(0, idx + 1) : [...list, bank];
}

function jobBank(file: string, here: Tile): NamedBank | null {
    if (file === 'kbd-range.ts') return closestOf(here, [ARDOUGNE, YANILLE, EDGE]);
    if (file === 'bank-fletch.ts') return closestOf(here, [ARDOUGNE, SEERS, CATHERBY, DRAYNOR, EDGE]);
    if (file === 'nature-essence-run.ts') {
        if (here.x > 2400 && here.x < 2944 && here.z > 3070 && here.z < 3600) return ARDOUGNE;
        return null;
    }
    return JOB_BANK[file] ?? null;
}

function jobPoints(file: string, here: Tile, bank: NamedBank): Tile[] {
    if (bank.name === 'Ardougne') return ardougneApproach(here.x, here.z, bank.x, bank.z);
    if (file === 'hobgoblins.ts') {
        if (here.x > 3120 && here.z < 3300) {
            return [
                { x: 3160, z: 3250 },
                { x: 3088, z: 3250 },
                { x: 3007, z: 3297 },
                bank,
            ];
        }
        return [...TO_FALADOR_EAST_FROM_HOBS, bank];
    }
    if (file === 'rimmington-iron.ts') {
        if (here.x > 3120 && here.z < 3300) {
            return [
                { x: 3160, z: 3250 },
                { x: 3088, z: 3250 },
                { x: 3065, z: 3370 },
                { x: 3012, z: 3372 },
                bank,
            ];
        }
        return [
            { x: 3010, z: 3265 },
            { x: 3007, z: 3340 },
            bank,
        ];
    }
    if (file === 'mining-guild.ts' && (here.z > 3400 || here.x < 2980)) {
        return [{ x: 2964, z: 3381 }, bank];
    }
    if (file === 'rune-rocks.ts') {
        return [
            { x: 3104, z: 3291 },
            { x: 3079, z: 3419 },
            bank,
        ];
    }
    if (file === 'edgeville-dungeon-melee.ts' && (here.x > 3120 || here.z < 3460)) {
        const via: Tile[] = [];
        if (here.z < 3320) via.push({ x: 3088, z: 3320 });
        if (here.z < 3420) via.push({ x: 3088, z: 3420 });
        via.push(bank);
        return via;
    }
    if (file === 'seers-wc-fm.ts' || file === 'magic-trees.ts') {
        if (here.x >= 2740) return untilBank([...CATHERBY_TO_ARDY].reverse(), bank);
        if (here.x <= 2695) return untilBank(ARDY_TO_CATHERBY, bank);
        return [bank];
    }
    if (file === 'essence.ts' && here.x < 3150 && here.z < 3300) {
        return [
            { x: 3109, z: 3162 },
            { x: 3105, z: 3290 },
            { x: 3080, z: 3420 },
            { x: 3180, z: 3430 },
            bank,
        ];
    }
    return [bank];
}

/**
 * Bank the roster job walks to, plus that path. `args` is the roster argv
 * after the account name. No distance cap: a far bank is still the plan.
 */
export function planBankWalk(job: { script: string; args: string[] }, here: Tile): BankPlan {
    const file = scriptFile(job.script);
    const surface = inMiningGuild(here.x, here.z) ? { x: here.x, z: here.z - 6400 } : here;
    const fromJob = jobBank(file, surface);
    const bank = fromJob ?? closestFleetBank(surface.x, surface.z).bank;
    let points = jobPoints(file, surface, bank);
    const ditch = onSurfaceWildy(surface.z) && bank.z < 3520;
    if (ditch) {
        const south = WILDY_SOUTH_TO_DITCH.filter((tile) => tile.z <= surface.z + 8);
        points = [...south, ...points];
    }
    const climb: BankClimb | null = inEdgevilleDungeon(here.x, here.z)
        ? 'edgeville-dungeon'
        : inMiningGuild(here.x, here.z)
          ? 'mining-guild'
          : null;
    return {
        bank,
        points,
        climb,
        ditch,
        source: fromJob ? 'job' : 'closest',
    };
}
