/**
 * Skill training — how the runner raises a skill a source or quest needs.
 *
 * One trainer per skill, shared by every quest. `q.ensureLevel(skill, level)`
 * calls it from a source (iron ore needs Mining 15) or the prepare phase, and
 * bots/quests/train-skill.ts runs it on its own as a task. A trainer gets the
 * tools it needs through q.ensure (sources.ts), never by assuming the bank.
 */
import type { Quest } from './run-quest';
import { mineAtRimmington } from './mining';
import type { Need } from './sources';

export interface Trainer {
    /** Tools to take from the bank when training runs on its own (train-skill.ts). */
    needs: Need[];
    train: (q: Quest, level: number) => Promise<void>;
}

export const TRAINERS: Record<string, Trainer> = {
    /** Copper at the Rimmington mine (level 1, 17.5 xp), dropped as it is mined. */
    mining: {
        needs: [{ item: 'pickaxe', count: 1 }],
        train: async (q, level) => {
            await q.ensure('pickaxe', 1);
            // Ore the quest already holds is kept; only what training mines is dropped.
            const keep = q.count('copper ore');
            await mineAtRimmington(q, 'copper ore', { until: () => q.level('mining') >= level, dropAbove: keep });
        },
    },
};
