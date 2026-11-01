/**
 * Bring an account to a hub bank through the quest runner's walker, which knows the boats,
 * Karamja, the gnome gate, Melzar's Maze and the other escapes the grind scripts don't
 * (ABGARMY04 was stranded on Karamja after Jungle Potion, 2026-11-01).
 *
 *   bun bots/quests/hub-task.ts {botname} [--hub=ardougne|draynor|catherby|...]
 *
 * Queue it in todo.json ahead of a grind; it logs "already complete" when parked.
 */
import { runTask } from './lib/run-quest';

const hub = (process.argv.find((a) => a.startsWith('--hub='))?.split('=')[1] ?? 'ardougne') as Parameters<typeof runTask>[0]['hub'];

await runTask({
    id: 'hub-task',
    hub,
    task: async (q) => {
        q.log(`hub-task: at the ${hub} hub — already complete`);
    },
});
