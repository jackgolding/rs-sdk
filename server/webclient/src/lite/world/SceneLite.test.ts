// SceneLite on LinkBelow (bridged) tiles: the scene a level shows must be the
// pushed-down one the browser's World holds after ClientBuild.finishBuild, and the
// server's loc changes arrive keyed by that same adjusted level.
//
// The fishing platform west of Witchaven (Sea Slug) is one bridged map square: its
// lower deck is the map file's level 1, its upper deck level 2. Before the fix the
// lower deck (player level 0) showed the sea's file level 0 - no ladder, no cabin
// door - and the upper deck showed the lower deck's locs.
//
// Needs the game server for map data (cached on disk); set LITE_TEST_ORIGIN (e.g.
// http://localhost:8888). Skips when unreachable.

import { describe, expect, test } from 'bun:test';

import '../dom-shim.js';

import CollisionMap from '#/dash3d/CollisionMap.js';
import { LocLayer } from '#/dash3d/LocLayer.js';

import { loadCache } from '../cache.js';
import { buildCollision } from './CollisionBuilder.js';
import { LocIndex, valueLocId } from './LocIndex.js';
import { SceneLite } from './SceneLite.js';

const ORIGIN = process.env.LITE_TEST_ORIGIN ?? 'https://rs-sdk-demo.fly.dev';
const CACHE_DIR = process.env.LITE_TEST_CACHE ?? '/tmp/rs-sdk-lite-test-cache';

/** Platform locs (quest_seaslug placements, m43_51): ladder up on the lower deck, ladder down on the upper. */
const LADDER = { x: 2784, z: 3286 };
const LADDER_UP = 2517;
const LADDER_DOWN = 1746;

describe('SceneLite on bridged tiles', () => {
    test('the fishing platform decks show at the player levels the server uses', async () => {
        const reachable = await fetch(`${ORIGIN}/crc`).then(r => r.ok).catch(() => false);
        if (!reachable) {
            console.warn(`[lite] skipping bridged scene test - ${ORIGIN} unreachable`);
            return;
        }
        const { checksums } = await loadCache({ origin: ORIGIN, cacheDir: CACHE_DIR, quiet: true });
        const index = await LocIndex.load({ origin: ORIGIN, cacheDir: CACHE_DIR, versionlistCrc: checksums[5], quiet: true });

        const scene = new SceneLite(index);
        const baseX = LADDER.x - 52;
        const baseZ = LADDER.z - 52;
        scene.setBase(baseX, baseZ);
        const sx = LADDER.x - baseX;
        const sz = LADDER.z - baseZ;
        const locAt = (level: number) => (scene.sceneType(level, sx, sz) >> 14) & 0x7fff;

        expect(locAt(0)).toBe(LADDER_UP);
        expect(locAt(1)).toBe(LADDER_DOWN);

        // A server LOC_DEL on the lower deck (player level 0) hides the ladder there and only there.
        scene.delLoc(0, LADDER.x, LADDER.z, 10);
        expect(locAt(0)).toBe(0);
        expect(locAt(1)).toBe(LADDER_DOWN);
        expect(valueLocId(index.lookup(LocLayer.GROUND, 1, LADDER.x, LADDER.z))).toBe(LADDER_UP);

        // Collision honours the same keying: the deleted ladder no longer blocks level 0.
        const maps: (CollisionMap | null)[] = [null, null, null, null];
        buildCollision(index, baseX, baseZ, maps);
        const blocked = maps[0]!.flags[sx * 104 + sz];
        buildCollision(index, baseX, baseZ, maps, scene.overlayEntries);
        const opened = maps[0]!.flags[sx * 104 + sz];
        expect(blocked).not.toBe(0);
        expect(opened).toBe(0);
    }, 180_000);
});
