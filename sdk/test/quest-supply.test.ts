import { describe, expect, test } from 'bun:test';
import {
    DIALOG_SOURCES,
    GATHER_SOURCES,
    QUEST_STOCK,
    SHOP_SOURCES,
    parseSupplyRequest,
} from '../../bots/quests/supply';

const DRAGON_SLAYER_NEEDS = [
    "wizard's mind bomb",
    'unfired bowl',
    'lobster pot',
    'plank',
    'nails',
    'hammer',
    'rope',
    'silk',
];

const FREMENNIK_NEEDS = ['axe', 'knife', 'tinderbox', 'raw shark', 'cabbage', 'potato', 'onion', 'beer'];

function sourced(label: string): boolean {
    return (
        label in QUEST_STOCK ||
        label in SHOP_SOURCES ||
        label in DIALOG_SOURCES ||
        label in GATHER_SOURCES
    );
}

describe('supply parseSupplyRequest', () => {
    test('parses a mule DM', () => {
        const req = parseSupplyRequest('Jackpoo1', "quest-supply mind bomb x2, lobster pot x1");
        expect(req).not.toBeNull();
        expect(req!.from).toBe('Jackpoo1');
        expect(req!.needs).toEqual([
            { label: 'mind bomb', count: 2 },
            { label: 'lobster pot', count: 1 },
        ]);
    });

    test('rejects non-requests', () => {
        expect(parseSupplyRequest('Jackpoo1', 'hello')).toBeNull();
        expect(parseSupplyRequest('Jackpoo1', 'quest-supply')).toBeNull();
    });
});

describe('supply coverage', () => {
    test('every shop source has an npc, tile, and provenance', () => {
        for (const [label, sources] of Object.entries(SHOP_SOURCES)) {
            expect(sources.length).toBeGreaterThan(0);
            for (const s of sources) {
                expect(s.npc).toBeInstanceOf(RegExp);
                expect(Number.isFinite(s.tile.x)).toBe(true);
                expect(Number.isFinite(s.tile.z)).toBe(true);
                expect(s.source).toMatch(/\.md$/);
            }
        }
    });

    test('dragon slayer prep resolves to stock, shop, dialog, or gather', () => {
        const unsourced = DRAGON_SLAYER_NEEDS.filter((label) => !sourced(label));
        expect(unsourced).toEqual([]);
    });

    test('unfired bowl is stock-only (needs clay+wheel craft path next)', () => {
        expect('unfired bowl' in QUEST_STOCK).toBe(true);
        expect('unfired bowl' in SHOP_SOURCES).toBe(false);
        expect('unfired bowl' in DIALOG_SOURCES).toBe(false);
        expect('unfired bowl' in GATHER_SOURCES).toBe(false);
    });

    test('fremennik pack resolves to stock (mule-first)', () => {
        const unsourced = FREMENNIK_NEEDS.filter((label) => !sourced(label));
        expect(unsourced).toEqual([]);
    });

    test('dialog and gather sources carry provenance', () => {
        for (const sources of Object.values(DIALOG_SOURCES)) {
            for (const s of sources) {
                expect(s.npc).toBeInstanceOf(RegExp);
                expect(Number.isFinite(s.tile.x)).toBe(true);
                expect(s.source).toContain('.rs2');
            }
        }
        for (const sources of Object.values(GATHER_SOURCES)) {
            for (const s of sources) {
                expect(Number.isFinite(s.center.x)).toBe(true);
                expect(s.radius).toBeGreaterThan(0);
            }
        }
    });

    test('stock targets are speedrun-scale (50-100x)', () => {
        for (const [label, count] of Object.entries(QUEST_STOCK)) {
            if (label === 'coins') continue;
            expect(count).toBeGreaterThanOrEqual(50);
        }
    });
});
