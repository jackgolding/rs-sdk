import { describe, expect, test } from 'bun:test';
import { buildLiteScene } from './scene';
import type { BotWorldState } from '../../sdk/types';

function state(): BotWorldState {
    return {
        tick: 100,
        revision: 7,
        inGame: true,
        player: {
            name: 'Jackpoo1', combatLevel: 42, worldX: 3200, worldZ: 3200, level: 0,
            runEnergy: 80, runWeight: 12, hp: 40, maxHp: 45,
            animId: 123, spotanimId: -1, isDead: false,
            combat: { inCombat: false, targetIndex: -1, targetType: 'none' },
        } as unknown as BotWorldState['player'],
        skills: [{ name: 'Attack', level: 40, baseLevel: 40, experience: 37254 }],
        inventory: [{ slot: 0, id: 995, name: 'Coins', count: 1200, optionsWithIndex: [] }],
        equipment: [],
        nearbyNpcs: [
            { index: 3, id: 100, name: 'Guard', combatLevel: 21, x: 3205, z: 3202, size: 1, healthPercent: 100, animId: -1, targetIndex: -1, inCombat: false, options: ['Attack'], optionsWithIndex: [], distance: 5, hp: null, maxHp: null, lastCombatTick: null, kind: 'npc' },
            // Far away: excluded from the scene.
            { index: 4, id: 101, name: 'Rat', combatLevel: 1, x: 3400, z: 3400, size: 1, healthPercent: 100, animId: -1, targetIndex: -1, inCombat: false, options: [], optionsWithIndex: [], distance: 280, hp: null, maxHp: null, lastCombatTick: null, kind: 'npc' },
        ] as unknown as BotWorldState['nearbyNpcs'],
        nearbyPlayers: [],
        nearbyLocs: [
            { id: 1, name: 'Bank booth', x: 3198, z: 3201, level: 0, distance: 3, options: ['Bank'], optionsWithIndex: [] },
            { id: 1, name: 'Bank booth', x: 3198, z: 3201, level: 0, distance: 3, options: ['Bank'], optionsWithIndex: [] },
        ] as unknown as BotWorldState['nearbyLocs'],
        groundItems: [{ id: 526, name: 'Bones', count: 1, x: 3201, z: 3200, distance: 1 }],
        gameMessages: [{ type: 0, text: 'Welcome', sender: '', tick: 99, fromSelf: false }],
        recentDialogs: [],
        dialog: { isOpen: false, options: [], isWaiting: false },
        interface: { isOpen: false, interfaceId: 0, options: [] },
        shop: { isOpen: false, title: '', shopItems: [], playerItems: [] },
        bank: { isOpen: false, items: [], noteMode: false },
        modalOpen: false,
        modalInterface: -1,
        combatEvents: [],
        prayers: { activePrayers: [], prayerPoints: 0, prayerLevel: 1 },
    } as BotWorldState;
}

describe('buildLiteScene', () => {
    test('keeps nearby entities as compact tuples, drops far ones', () => {
        const scene = buildLiteScene(state(), { stateAgeMs: 1200 });
        expect(scene.me.x).toBe(3200);
        expect(scene.npcs.map((n) => n.n)).toEqual(['Guard']);
        expect(scene.locs).toHaveLength(1); // duplicate id:x:z deduped
        expect(scene.ground).toHaveLength(1);
        expect(scene.inv).toEqual([[0, 995, 1200]]);
        expect(scene.names).toEqual({ 995: 'Coins' });
        expect(scene.stats[0]).toEqual([40, 40, 37254]);
        expect(scene.ageMs).toBe(1200);
        expect(scene.chat).toHaveLength(1);
    });
});
