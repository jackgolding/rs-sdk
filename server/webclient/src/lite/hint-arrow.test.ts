// HINT_ARROW is decoded the way Client.ts does it, so StateCollector can
// publish it from the lite client too (the Agility Arena's pillar arrow is the
// only way a bot can see which pillar pays).
import { describe, expect, test } from 'bun:test';

import './dom-shim.js';

import Packet from '#/io/Packet.js';
import { ServerProt } from '#/io/ServerProt.js';

import { dispatch } from './protocol/incoming.js';

function packet(write: (p: Packet) => void): Packet {
    const p = new Packet(new Uint8Array(6));
    write(p);
    p.pos = 0;
    return p;
}

function fakeClient(): any {
    return { activate() {}, hintType: 0, hintNpc: 0, hintPlayer: 0, hintTileX: 0, hintTileZ: 0, hintHeight: 0 };
}

describe('lite HINT_ARROW', () => {
    test('tile arrows (types 2-6) collapse to type 2 with absolute coords', () => {
        const c = fakeClient();
        dispatch(c, ServerProt.HINT_ARROW, packet((p) => { p.p1(2); p.p2(2783); p.p2(9568); p.p1(60); }), 6);
        expect(c).toMatchObject({ hintType: 2, hintTileX: 2783, hintTileZ: 9568, hintHeight: 60 });

        dispatch(c, ServerProt.HINT_ARROW, packet((p) => { p.p1(5); p.p2(3200); p.p2(3201); p.p1(0); }), 6);
        expect(c).toMatchObject({ hintType: 2, hintTileX: 3200, hintTileZ: 3201 });
    });

    test('npc, player and stop', () => {
        const c = fakeClient();
        dispatch(c, ServerProt.HINT_ARROW, packet((p) => { p.p1(1); p.p2(123); p.p2(0); p.p1(0); }), 6);
        expect(c).toMatchObject({ hintType: 1, hintNpc: 123 });
        dispatch(c, ServerProt.HINT_ARROW, packet((p) => { p.p1(10); p.p2(9); p.p2(0); p.p1(0); }), 6);
        expect(c).toMatchObject({ hintType: 10, hintPlayer: 9 });
        dispatch(c, ServerProt.HINT_ARROW, packet((p) => { p.p1(-1); p.p2(0); p.p2(0); p.p1(0); }), 6);
        expect(c.hintType).toBe(255);
    });
});
