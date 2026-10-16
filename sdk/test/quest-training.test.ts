import { describe, expect, test } from 'bun:test';
import { requireSkills, type QuestContext } from '../../bots/quests/quest-lib';
import { planTraining } from '../../bots/quests/training';
import type { BotSDK } from '../index';
import type { BotActions } from '../actions';
import type { ActivitySession } from '../activity';

function ctxWith(levels: Record<string, number>): QuestContext {
    const logged: string[] = [];
    const sdk = {
        getSkill: (name: string) => {
            const want = name.toLowerCase();
            for (const [key, value] of Object.entries(levels)) {
                if (key.toLowerCase() === want) return { baseLevel: value };
            }
            return null;
        },
    } as unknown as BotSDK;
    return { sdk, bot: {} as BotActions, session: null as unknown as ActivitySession, log: (m: string) => logged.push(m) };
}

describe('quest-lib requireSkills', () => {
    test('passes when all gates met', () => {
        const ctx = ctxWith({ Woodcutting: 40, Crafting: 55, Fletching: 25 });
        const result = requireSkills(ctx, { Woodcutting: 40, Crafting: 40, Fletching: 25 });
        expect(result.ok).toBe(true);
        expect(result.missing).toEqual([]);
    });

    test('fails fast listing every missing gate', () => {
        const ctx = ctxWith({ Woodcutting: 12, Crafting: 40 });
        const result = requireSkills(ctx, { Woodcutting: 40, Crafting: 40, Fletching: 25 });
        expect(result.ok).toBe(false);
        expect(result.missing.map((m) => m.skill).sort()).toEqual(['Fletching', 'Woodcutting']);
    });
});

describe('training planTraining', () => {
    test('empty when already qualified', () => {
        expect(planTraining({ Woodcutting: 50 }, { Woodcutting: 40 })).toEqual([]);
    });

    test('picks trainers spanning from/to, weakest first', () => {
        const steps = planTraining({ Woodcutting: 12, Fishing: 1 }, { Woodcutting: 40, Fishing: 30 });
        expect(steps.map((s) => s.skill)).toEqual(['Fishing', 'Woodcutting']);
        expect(steps[0]!.script).toContain('fishing-route');
        expect(steps[1]!.script).toContain('seers-wc-fm');
    });

    test('uncovered skills are explicit, never silently skipped', () => {
        const steps = planTraining({ Prayer: 1 }, { Prayer: 42 });
        expect(steps).toHaveLength(1);
        expect(steps[0]!.script).toBe('');
        expect(steps[0]!.notes).toMatch(/NO TRAINER/);
    });
});
