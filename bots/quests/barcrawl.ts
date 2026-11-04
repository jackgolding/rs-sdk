/**
 * Alfred Grimhand's Barcrawl (miniquest, no QP) — opens the Barbarian Outpost gate (Horror from the Deep, Scorpion
 * Catcher's third scorpion).
 *
 *   bun bots/quests/barcrawl.ts {botname}
 *
 * A miniquest has no journal entry, so this is a runner task: the card's Read scroll is the progress record (resumes
 * skip the bars it shows signed) and the proof of completion is the outpost gate letting us through. Route and
 * mechanics: lib/barcrawl.ts. Supplies: 300 coins (drinks 208, two Karamja boats 60); 1 law + 5 air for Camelot
 * Teleport back to the Foresters Arms (Magic 45 after the drinks' drain, else it walks). No skill gates.
 */
import { runQuest } from './lib/run-quest';
import { COINS, crawl } from './lib/barcrawl';

await runQuest({
    id: 'barcrawl',
    hub: 'seers',
    stages: [],
    transitions: [
        {
            from: '',
            to: '',
            needs: [
                { item: 'coins', count: COINS },
                { item: 'law rune', count: 1 },
                { item: 'air rune', count: 5 },
            ],
        },
    ],
    carry: ['barcrawl card'],
    // Bartenders and the gate guard serve everyone at once.
    maxConcurrent: 4,
    task: (q) => crawl(q),
});
