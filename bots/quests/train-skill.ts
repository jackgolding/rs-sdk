/**
 * Train a skill to a level on its own, with the same trainers quests use.
 *
 *   bun bots/quests/train-skill.ts {botname} mining 15
 *
 * Starts and ends naked at the hub bank like a quest run; the trainer gets its
 * own tools (a pickaxe for mining) through the shared sources.
 */
import { runTask } from './lib/run-quest';
import { TRAINERS } from './lib/training';

const [, , , skill = '', target = ''] = process.argv;
const level = Number(target);
if (!skill || !Number.isInteger(level) || level < 2) {
    console.error('usage: bun bots/quests/train-skill.ts <botname> <skill> <level>');
    process.exit(2);
}

await runTask({
    id: `train-${skill}`,
    hub: 'falador-east',
    needs: TRAINERS[skill]?.needs,
    task: (q) => q.ensureLevel(skill, level),
});
