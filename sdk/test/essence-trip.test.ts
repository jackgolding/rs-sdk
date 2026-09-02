import { describe, expect, test } from 'bun:test';
import { inEssenceMine, inMiningGuild, inMiningGuildSouth, npcHasTeleportOption, shopIsNotTeleport } from '../regions';

describe('essence trip predicates', () => {
    test('recognises the essence-mine interior and not Varrock', () => {
        expect(inEssenceMine(2926, 4818)).toBe(true);
        expect(inEssenceMine(3253, 3401)).toBe(false);
        expect(inEssenceMine(2744, 3444)).toBe(false);
    });

    test('shop open is not a teleport; Teleport option is required', () => {
        expect(shopIsNotTeleport(true)).toBe(true);
        expect(shopIsNotTeleport(false)).toBe(false);
        expect(npcHasTeleportOption([{ text: 'Talk-to' }, { text: 'Trade' }])).toBe(false);
        expect(npcHasTeleportOption([{ text: 'Talk-to' }, { text: 'Trade' }, { text: 'Teleport' }])).toBe(true);
    });
});

describe('mining guild predicates', () => {
    test('recognises the guild cavern and not surface Falador', () => {
        expect(inMiningGuild(3042, 9772)).toBe(true);
        expect(inMiningGuild(3019, 9739)).toBe(true);
        expect(inMiningGuild(3019, 3339)).toBe(false);
        expect(inMiningGuild(3012, 3355)).toBe(false);
    });

    test('south room is mithril/coal, not adamant-west or king-scorpion tiles', () => {
        expect(inMiningGuildSouth(3050, 9738)).toBe(true);
        expect(inMiningGuildSouth(3040, 9734)).toBe(true);
        expect(inMiningGuildSouth(3035, 9764)).toBe(false);
        expect(inMiningGuildSouth(3040, 9775)).toBe(false);
        expect(inMiningGuildSouth(3019, 3339)).toBe(false);
    });
});


describe('essence trip predicates', () => {
    test('recognises the essence-mine interior and not Varrock', () => {
        expect(inEssenceMine(2926, 4818)).toBe(true);
        expect(inEssenceMine(3253, 3401)).toBe(false);
        expect(inEssenceMine(2744, 3444)).toBe(false);
    });

    test('shop open is not a teleport; Teleport option is required', () => {
        expect(shopIsNotTeleport(true)).toBe(true);
        expect(shopIsNotTeleport(false)).toBe(false);
        expect(npcHasTeleportOption([{ text: 'Talk-to' }, { text: 'Trade' }])).toBe(false);
        expect(npcHasTeleportOption([{ text: 'Talk-to' }, { text: 'Trade' }, { text: 'Teleport' }])).toBe(true);
    });
});
