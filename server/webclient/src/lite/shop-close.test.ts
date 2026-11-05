// A server-side shop close (a Mort'ton shade's swing runs if_close) sends
// UPDATE_INV_STOP_TRANSMIT for the shelf immediately, but IF_CLOSE only at the
// end of the next tick's batch - after PLAYER_INFO, where state is published.
// For that tick the shop read as open with an empty shelf, so every buy failed
// with "Item not found" / "Failed to buy from shop" (Razmire's store, 2026-11-05).
import { describe, expect, test } from 'bun:test';

import './dom-shim.js';

import Packet from '#/io/Packet.js';
import { ServerProt } from '#/io/ServerProt.js';

import { isShopOpen } from './actions.js';
import { dispatch } from './protocol/incoming.js';

const SHOP_MAIN = 3824;
const SHOP_INV = 3900;

function packet(write: (p: Packet) => void): { buf: Packet; size: number } {
    const p = new Packet(new Uint8Array(64));
    write(p);
    const size = p.pos;
    p.pos = 0;
    return { buf: p, size };
}

function fakeClient(): any {
    const shelf = { linkObjType: new Int32Array(40), linkObjNumber: new Int32Array(40) };
    return {
        activate() {},
        ifMutable: (id: number) => (id === SHOP_INV ? shelf : undefined),
        shelf,
        mainModalId: -1,
        sideModalId: -1,
        chatModalId: -1,
        invTransmitStopped: new Set<number>(),
    };
}

function send(c: any, opcode: number, write: (p: Packet) => void): void {
    const { buf, size } = packet(write);
    dispatch(c, opcode, buf, size);
}

const fullShelf = (p: Packet) => {
    p.p2(SHOP_INV);
    p.p2(2);
    p.p2(31 + 1); p.p1(3); // slot 0
    p.p2(3423 + 1); p.p1(150); // slot 1
};

describe('lite shop open/close', () => {
    test('an open shop with a transmitted shelf is open', () => {
        const c = fakeClient();
        send(c, ServerProt.UPDATE_INV_FULL, fullShelf);
        send(c, ServerProt.IF_OPENMAIN_SIDE, (p) => { p.p2(SHOP_MAIN); p.p2(3822); });
        expect(isShopOpen(c)).toBe(true);
        expect(c.shelf.linkObjType[1]).toBe(3424);
    });

    test('the shelf stopping closes the shop before IF_CLOSE arrives', () => {
        const c = fakeClient();
        send(c, ServerProt.UPDATE_INV_FULL, fullShelf);
        send(c, ServerProt.IF_OPENMAIN_SIDE, (p) => { p.p2(SHOP_MAIN); p.p2(3822); });
        send(c, ServerProt.UPDATE_INV_STOP_TRANSMIT, (p) => p.p2(SHOP_INV));
        expect(c.mainModalId).toBe(SHOP_MAIN); // IF_CLOSE still in flight
        expect(isShopOpen(c)).toBe(false);
        send(c, ServerProt.IF_CLOSE, () => {});
        expect(isShopOpen(c)).toBe(false);
    });

    test('reopening refills the shelf and the shop reads open again', () => {
        const c = fakeClient();
        send(c, ServerProt.UPDATE_INV_FULL, fullShelf);
        send(c, ServerProt.IF_OPENMAIN_SIDE, (p) => { p.p2(SHOP_MAIN); p.p2(3822); });
        send(c, ServerProt.UPDATE_INV_STOP_TRANSMIT, (p) => p.p2(SHOP_INV));
        send(c, ServerProt.IF_CLOSE, () => {});
        send(c, ServerProt.UPDATE_INV_FULL, fullShelf);
        send(c, ServerProt.IF_OPENMAIN_SIDE, (p) => { p.p2(SHOP_MAIN); p.p2(3822); });
        expect(isShopOpen(c)).toBe(true);
    });
});
