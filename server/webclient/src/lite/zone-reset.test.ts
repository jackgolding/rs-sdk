// UPDATE_ZONE_FULL_FOLLOWS must revert pending loc changes, not just ground items.
//
// The browser zeroes the endTime of every locChange inside the reset zone
// (Client.ts ~9500); the lite equivalent is dropping the SceneLite overlay
// entries for those 64 tiles. Without it, a door opened via LOC_DEL and reverted
// server-side while the zone was untracked stays "deleted" forever, and
// ensureCollision - which rebuilds from the overlay - routes through a closed
// gate for the rest of the session.
//
// Needs no network: the loc index is stubbed and the interface baseline is
// stubbed empty when no earlier suite loaded the cache.

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';

import './dom-shim.js';

import IfType from '#/config/IfType.js';
import Packet from '#/io/Packet.js';
import { ServerProt } from '#/io/ServerProt.js';

import { captureBaseInterfaces, resetBaseInterfaces } from './interfaces.js';
import { LiteClient } from './LiteClient.js';
import { dispatch } from './protocol/incoming.js';

const BASE_X = 3200;
const BASE_Z = 3200;
/** Zone origin in build-area tiles, i.e. what the packet carries. */
const ZONE_X = 48;
const ZONE_Z = 48;
const ZONE_WORLD_X = BASE_X + ZONE_X; // 3248..3255 is inside the zone
const ZONE_WORLD_Z = BASE_Z + ZONE_Z;

function makeClient(name: string): LiteClient {
    const c = new LiteClient({
        connection: { out: Packet.alloc(1), isClosed: false } as never,
        // Static index that answers "nothing here" - overlay entries are the
        // only locs the scene will see, so their removal is observable.
        locIndex: { lookup: () => 0, mapFlags: () => 0 } as never,
        username: name,
        password: 'x'
    });
    c.mapBuildBaseX = BASE_X;
    c.mapBuildBaseZ = BASE_Z;
    c.world.setBase(BASE_X, BASE_Z);
    return c;
}

function zoneResetPacket(zoneX: number, zoneZ: number): Packet {
    const buf = Packet.alloc(1);
    buf.p1(zoneX);
    buf.p1(zoneZ);
    buf.pos = 0;
    return buf;
}

let stubbedBase = false;

beforeAll(() => {
    try {
        makeClient('probe');
    } catch {
        IfType.list = [];
        captureBaseInterfaces();
        stubbedBase = true;
    }
});

afterAll(() => {
    if (stubbedBase) {
        resetBaseInterfaces();
    }
});

describe('UPDATE_ZONE_FULL_FOLLOWS overlay reset', () => {
    test('drops overlay entries inside the zone, keeps the rest, and dirties collision', () => {
        const c = makeClient('botz');

        // A door "opened" inside the zone (wall deleted + scenery added)...
        c.world.delLoc(0, ZONE_WORLD_X + 2, ZONE_WORLD_Z + 2, 0); // WALL layer
        c.world.addLoc(0, ZONE_WORLD_X + 3, ZONE_WORLD_Z + 1, 1234, 10, 0); // GROUND layer
        // ...one loc change outside the zone...
        c.world.addLoc(0, BASE_X + 80, BASE_Z + 80, 500, 10, 0);
        // ...and one inside the zone's tiles but on another level, which the
        // browser's sweep skips (loc.level === minusedlevel) and so do we.
        c.world.delLoc(1, ZONE_WORLD_X + 2, ZONE_WORLD_Z + 2, 0);
        expect(c.world.overlayEntries.size).toBe(4);

        // The added loc is visible to nearbyLocs-style queries before the reset.
        expect(c.world.sceneType(0, ZONE_X + 3, ZONE_Z + 1)).not.toBe(0);

        c.world.collisionDirty = false; // pretend the router already rebuilt

        const buf = zoneResetPacket(ZONE_X, ZONE_Z);
        dispatch(c, ServerProt.UPDATE_ZONE_FULL_FOLLOWS, buf, 2);

        // In-zone current-level entries gone; out-of-zone and other-level survive.
        expect(c.world.overlayEntries.size).toBe(2);
        // nearbyLocs reflects the reset immediately: valueAt falls back to the
        // static index, which says nothing is here.
        expect(c.world.sceneType(0, ZONE_X + 3, ZONE_Z + 1)).toBe(0);
        // The out-of-zone change still reads back.
        expect(c.world.sceneType(0, 80, 80)).not.toBe(0);
        // Collision is a derived cache: marked dirty for the next routing call.
        expect(c.world.collisionDirty).toBe(true);
    });

    test('a reset that removes nothing does not force a collision rebuild', () => {
        const c = makeClient('botz2');

        c.world.addLoc(0, BASE_X + 80, BASE_Z + 80, 500, 10, 0); // outside the zone
        c.world.collisionDirty = false;

        const buf = zoneResetPacket(ZONE_X, ZONE_Z);
        dispatch(c, ServerProt.UPDATE_ZONE_FULL_FOLLOWS, buf, 2);

        expect(c.world.overlayEntries.size).toBe(1);
        expect(c.world.collisionDirty).toBe(false);
    });

    test('ground items in the zone are still cleared alongside the overlay', () => {
        const c = makeClient('botz3');

        // Drop a fake stack inside the zone on the current level.
        const objs = c.groundObj[0];
        objs[ZONE_X + 1][ZONE_Z + 1] = {} as never;
        objs[ZONE_X + 9][ZONE_Z + 1] = {} as never; // next zone over, untouched

        const buf = zoneResetPacket(ZONE_X, ZONE_Z);
        dispatch(c, ServerProt.UPDATE_ZONE_FULL_FOLLOWS, buf, 2);

        expect(objs[ZONE_X + 1][ZONE_Z + 1]).toBeNull();
        expect(objs[ZONE_X + 9][ZONE_Z + 1]).not.toBeNull();
    });
});
