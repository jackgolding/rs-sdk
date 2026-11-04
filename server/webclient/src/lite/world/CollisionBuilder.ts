// Rebuild the build-area CollisionMaps from the static index.
//
// This is the collision half of ClientBuild - the part that matters for routing -
// with all the model construction stripped out. It calls the SAME CollisionMap
// class the browser client uses, so testWall/testWDecor/testLoc reach rules and
// the tryMove BFS behave identically.
//
// Called once per REBUILD_NORMAL. 104x104x4 tiles over ~5 mapsquares is a few
// milliseconds, versus the browser client's full scene rebuild.

import LocType from '#/config/LocType.js';
import CollisionMap, { BuildArea } from '#/dash3d/CollisionMap.js';
import { LocLayer } from '#/dash3d/LocLayer.js';
import { LocShape } from '#/dash3d/LocShape.js';
import { MapFlag } from '#/dash3d/MapFlag.js';

import { LocIndex, valueAngle, valueLocId, valueShape } from './LocIndex.js';

export function buildCollision(index: LocIndex, baseX: number, baseZ: number, maps: (CollisionMap | null)[], overlay?: ReadonlyMap<number, number>): void {
    for (let level = 0; level < BuildArea.LEVELS; level++) {
        if (!maps[level]) {
            maps[level] = new CollisionMap();
        }
        maps[level]!.reset();
    }

    // Terrain first (ClientBuild.finishBuild), so loc flags layer on top.
    for (let level = 0; level < BuildArea.LEVELS; level++) {
        for (let x = 0; x < BuildArea.SIZE; x++) {
            for (let z = 0; z < BuildArea.SIZE; z++) {
                const flags = index.mapFlags(level, baseX + x, baseZ + z);
                if ((flags & MapFlag.Block) === 0) {
                    continue;
                }

                let trueLevel = level;
                if ((index.mapFlags(1, baseX + x, baseZ + z) & MapFlag.LinkBelow) !== 0) {
                    trueLevel--;
                }
                if (trueLevel >= 0) {
                    maps[trueLevel]?.blockGround(x, z);
                }
            }
        }
    }

    // Note the 1..SIZE-2 bounds: ClientBuild.loadLocations clips locs on the
    // outer ring of the build area (`stx > 0 && stx < SIZE - 1`), and
    // CollisionMap.reset already marks that ring _BOUNDS. Matching the clip
    // keeps this byte-identical to the browser's map.
    for (let level = 0; level < BuildArea.LEVELS; level++) {
        for (let x = 1; x < BuildArea.SIZE - 1; x++) {
            for (let z = 1; z < BuildArea.SIZE - 1; z++) {
                const worldX = baseX + x;
                const worldZ = baseZ + z;

                // The collision map a loc lands on follows the same bridge
                // rule as ClientBuild.loadLocations: level 1 LinkBelow pushes
                // it down one.
                let trueLevel = level;
                if ((index.mapFlags(1, worldX, worldZ) & MapFlag.LinkBelow) !== 0) {
                    trueLevel--;
                }
                if (trueLevel < 0) {
                    continue;
                }

                for (const layer of [LocLayer.WALL, LocLayer.WALL_DECOR, LocLayer.GROUND, LocLayer.GROUND_DECOR]) {
                    // `level` is the map file's; server loc changes (the overlay) are keyed by
                    // the adjusted level the server keeps its locs on (GameMap `actualLevel`).
                    const value = readLoc(index, overlay, layer, level, trueLevel, worldX, worldZ);
                    if (!value) {
                        continue;
                    }

                    const map = maps[trueLevel];
                    if (map) {
                        applyLoc(map, x, z, valueLocId(value), valueShape(value), valueAngle(value));
                    }
                }
            }
        }
    }
}

function readLoc(index: LocIndex, overlay: ReadonlyMap<number, number> | undefined, layer: LocLayer, level: number, overlayLevel: number, worldX: number, worldZ: number): number {
    if (overlay) {
        const key = ((layer & 0x3) * 0x40000000) + ((overlayLevel & 0x3) * 0x10000000) + ((worldX & 0x3fff) * 0x4000) + (worldZ & 0x3fff);
        const override = overlay.get(key);
        if (override !== undefined) {
            return override === -1 ? 0 : override;
        }
    }
    return index.lookup(layer, level, worldX, worldZ);
}

/** The collision calls ClientBuild.addLoc makes, keyed the same way by shape. */
function applyLoc(map: CollisionMap, x: number, z: number, locId: number, shape: number, angle: number): void {
    let loc: LocType;
    try {
        loc = LocType.list(locId);
    } catch {
        return;
    }

    if (!loc.blockwalk) {
        return;
    }

    if (shape === LocShape.GROUND_DECOR) {
        // ClientBuild.addLoc requires `loc.active` here, not just blockwalk.
        // blockwalk defaults TRUE and active defaults FALSE, so dropping the
        // active check blocks every flower, path tile and floor decoration in
        // the world - which walls the player into their own tile.
        if (loc.active) {
            map.blockGround(x, z);
        }
        return;
    }

    if (shape === LocShape.CENTREPIECE_STRAIGHT || shape === LocShape.CENTREPIECE_DIAGONAL || shape >= LocShape.ROOF_STRAIGHT || shape === LocShape.WALL_DIAGONAL) {
        map.addLoc(x, z, loc.width, loc.length, angle, loc.blockrange);
        return;
    }

    if (shape <= LocShape.WALL_SQUARE_CORNER) {
        map.addWall(x, z, shape, angle, loc.blockrange);
    }

    // Wall decorations (shapes 4-8) never block.
}
