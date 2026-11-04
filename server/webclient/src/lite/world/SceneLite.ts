// A `World`-shaped façade over the static LocIndex.
//
// StateCollector and Client.locSceneInfo only ever ask the scene five questions:
//
//   sceneType(level, x, z)     -> typecode of the scenery loc whose ORIGIN is this tile
//   wallType(level, x, z)      -> typecode of the wall loc here
//   decorType(level, z, x)     -> typecode of the wall decoration here  (note: z,x order)
//   gdType(level, x, z)        -> typecode of the ground decoration here
//   typeCode2(level, x, z, tc) -> packed (angle<<6 | shape) for a typecode
//
// All five are answered from the static index plus an overlay of the loc mutations
// the server streams in zone packets. Coordinates coming in are BUILD-AREA tiles
// (0..103) relative to mapBuildBase*, matching what the real World stores.

import { LocLayer } from '#/dash3d/LocLayer.js';
import LocType from '#/config/LocType.js';
import { MapFlag } from '#/dash3d/MapFlag.js';

import { LocIndex, valueAngle, valueLocId, valueShape } from './LocIndex.js';

/** Sentinel overlay value meaning "the server deleted the static loc here". */
const DELETED = -1;

export class SceneLite {
    /** Build-area origin in world tiles, from REBUILD_NORMAL. */
    baseX = 0;
    baseZ = 0;

    /** Server-driven loc changes, keyed by layer<<32-ish packed coord. */
    private overlay = new Map<number, number>();

    /**
     * Set whenever the overlay changes, cleared when the CollisionMaps are
     * rebuilt from it. A door that opens must change ROUTING, not just what
     * `nearbyLocs` reports - see LiteClient.ensureCollision.
     */
    collisionDirty = false;

    constructor(private readonly index: LocIndex) {}

    setBase(baseX: number, baseZ: number): void {
        this.baseX = baseX;
        this.baseZ = baseZ;

        // Drop overrides outside the new build area. Everything that reads the
        // overlay - sceneType/wallType/decorType and the collision builder -
        // only ever asks about tiles 0..103 of the current area, so out-of-area
        // entries are unreachable; keeping them would grow the map for the life
        // of the session. This mirrors the browser client, which unlinks
        // locChanges that fall outside the rebuilt area.
        if (this.overlay.size > 0) {
            for (const key of this.overlay.keys()) {
                const x = Math.floor(key / 0x4000) & 0x3fff;
                const z = key & 0x3fff;
                if (x < baseX || z < baseZ || x >= baseX + 104 || z >= baseZ + 104) {
                    this.overlay.delete(key);
                }
            }
        }
    }

    // ------------------------------------------------------------- World shape

    sceneType(level: number, x: number, z: number): number {
        return this.typecodeAt(LocLayer.GROUND, level, x, z);
    }

    wallType(level: number, x: number, z: number): number {
        return this.typecodeAt(LocLayer.WALL, level, x, z);
    }

    /** Argument order matches World.decorType exactly: (level, z, x). */
    decorType(level: number, z: number, x: number): number {
        return this.typecodeAt(LocLayer.WALL_DECOR, level, x, z);
    }

    gdType(level: number, x: number, z: number): number {
        return this.typecodeAt(LocLayer.GROUND_DECOR, level, x, z);
    }

    typeCode2(level: number, x: number, z: number, typecode: number): number {
        const locId = (typecode >> 14) & 0x7fff;
        for (const layer of [LocLayer.WALL, LocLayer.WALL_DECOR, LocLayer.GROUND, LocLayer.GROUND_DECOR]) {
            const value = this.valueAt(layer, level, x, z);
            if (value > 0 && valueLocId(value) === locId) {
                return ((((valueAngle(value) << 6) + valueShape(value)) | 0) << 24) >> 24 & 0xff;
            }
        }
        return -1;
    }

    // --------------------------------------------------------- zone mutations

    /** LOC_ADD_CHANGE: server placed or replaced a loc at a world coord. */
    addLoc(level: number, worldX: number, worldZ: number, locId: number, shape: number, angle: number): void {
        const layer = layerOf(shape);
        this.overlay.set(overlayKey(layer, level, worldX, worldZ), (locId << 7) | ((shape & 0x1f) << 2) | (angle & 0x3));
        this.collisionDirty = true;
    }

    /** LOC_DEL: server removed whatever loc of this shape's layer was here. */
    delLoc(level: number, worldX: number, worldZ: number, shape: number): void {
        this.overlay.set(overlayKey(layerOf(shape), level, worldX, worldZ), DELETED);
        this.collisionDirty = true;
    }

    /** Static loc id at a world coord, ignoring the overlay - for LOC_DEL bookkeeping. */
    staticLocIdAt(layer: LocLayer, level: number, worldX: number, worldZ: number): number {
        const value = this.index.lookup(layer, staticLevel(this.index, level, worldX, worldZ), worldX, worldZ);
        return value ? valueLocId(value) : 0;
    }

    /**
     * UPDATE_ZONE_FULL_FOLLOWS: the server reset this 8x8 zone to its static
     * map state, so every pending loc change in it must be reverted - the
     * browser does the same by zeroing the endTime of every locChange in the
     * zone (Client.ts ~9500), and like the browser it only touches the current
     * level, because the packet carries no level byte and the engine sends it
     * for the player's own level. Without this, a door deleted via LOC_DEL and
     * later reverted server-side while the zone was untracked stays "deleted"
     * in the overlay forever, and ensureCollision keeps routing through it.
     *
     * `worldX`/`worldZ` are the zone origin in world tiles. Removing the
     * overlay entries is the whole fix for `nearbyLocs`, since valueAt falls
     * straight back to the static index; collision is a derived cache, so it is
     * marked dirty (only when something was actually removed - zone resets are
     * routine and a rebuild costs ~15ms) and rebuilt on the next routing call.
     */
    clearZoneOverlay(level: number, worldX: number, worldZ: number): void {
        if (this.overlay.size === 0) {
            return;
        }

        let removed = false;
        for (const layer of [LocLayer.WALL, LocLayer.WALL_DECOR, LocLayer.GROUND, LocLayer.GROUND_DECOR]) {
            for (let x = worldX; x < worldX + 8; x++) {
                for (let z = worldZ; z < worldZ + 8; z++) {
                    if (this.overlay.delete(overlayKey(layer, level, x, z))) {
                        removed = true;
                    }
                }
            }
        }

        if (removed) {
            this.collisionDirty = true;
        }
    }

    /** Read-only view for CollisionBuilder, which must see the same overrides. */
    get overlayEntries(): ReadonlyMap<number, number> {
        return this.overlay;
    }

    // ------------------------------------------------------------------ internals

    private valueAt(layer: LocLayer, level: number, sceneX: number, sceneZ: number): number {
        const worldX = this.baseX + sceneX;
        const worldZ = this.baseZ + sceneZ;

        const override = this.overlay.get(overlayKey(layer, level, worldX, worldZ));
        if (override !== undefined) {
            return override === DELETED ? 0 : override;
        }

        return this.index.lookup(layer, staticLevel(this.index, level, worldX, worldZ), worldX, worldZ);
    }

    /**
     * Rebuild the typecode the real World would have stored, so downstream bit
     * twiddling (`(tc >> 14) & 0x7fff`, `(tc >> 29) & 0x3`) behaves identically.
     * See ClientBuild.addLoc: base + 0x40000000, minus int.min when the loc is
     * inactive. Both variants leave `(tc >> 29) & 3 === 2`, which is what
     * World.sceneType filters on.
     */
    private typecodeAt(layer: LocLayer, level: number, sceneX: number, sceneZ: number): number {
        const value = this.valueAt(layer, level, sceneX, sceneZ);
        if (!value) {
            return 0;
        }

        const locId = valueLocId(value);
        let typecode = (sceneX + (sceneZ << 7) + (locId << 14) + 0x40000000) | 0;

        let active = true;
        try {
            active = LocType.list(locId).active;
        } catch {
            // Unknown loc id (cache/index skew) - treat as active; the caller
            // discards it anyway when LocType has no name.
        }
        if (!active) {
            typecode += -0x80000000;
        }

        return typecode | 0;
    }
}

/**
 * The map file level whose locs the scene shows at `level` on this tile. ClientBuild.finishBuild
 * calls World.pushDown on every LinkBelow tile (bridges, the fishing platform): the file's level 1
 * becomes scene level 0, 2 -> 1, 3 -> 2 and the file's level 0 goes to scene level 3. The browser's
 * world.sceneType/wallType/... read the pushed-down scene, and the server keys its locs (and every
 * LOC_ADD_CHANGE/LOC_DEL) by the same adjusted level (GameMap.loadLocations, `actualLevel`), so the
 * overlay needs no adjustment; only the static file lookup does.
 */
export function staticLevel(index: LocIndex, level: number, worldX: number, worldZ: number): number {
    if ((index.mapFlags(1, worldX, worldZ) & MapFlag.LinkBelow) === 0) {
        return level;
    }
    return level < 3 ? level + 1 : 0;
}

function layerOf(shape: number): LocLayer {
    if (shape < 4) return LocLayer.WALL;
    if (shape < 9) return LocLayer.WALL_DECOR;
    if (shape < 22) return LocLayer.GROUND;
    return LocLayer.GROUND_DECOR;
}

/**
 * Overlay keys must not collide across layers or levels. World coords fit in 14
 * bits each, level in 2, layer in 2 - 32 bits total, so build it as a float via
 * multiplication rather than `<<` to avoid sign issues at bit 31.
 */
function overlayKey(layer: LocLayer, level: number, worldX: number, worldZ: number): number {
    return ((layer & 0x3) * 0x40000000) + ((level & 0x3) * 0x10000000) + ((worldX & 0x3fff) * 0x4000) + (worldZ & 0x3fff);
}
