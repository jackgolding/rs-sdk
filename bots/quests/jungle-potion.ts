/**
 * Jungle Potion — five jungle herbs for Trufitus in Tai Bwo Wannai (Karamja).
 *
 *   bun bots/quests/jungle-potion.ts {botname}
 *
 * Journal rules from quest_junglepotion/scripts/junglepotion_journal.rs2. Each herb has a
 * get/found pair of varp stages, but "found" prints the "get" text unless the clean herb is
 * held, so each pair is one stage here, keyed on the herbs already given (struck lines that
 * persist). Giving the Rogues Purse completes the quest in the same dialog (trufitus.rs2
 * found_rogues_purse → trufitus_finish_quest); `herbs` (11) is only a resumed run's stage.
 * Requires Druidic Ritual (trufitus.rs2 start check) and Herblore 3 to identify the herbs.
 * Items:
 *   - coins          lib/sources.ts — the Brimhaven boats both ways (30gp each)
 *   - the five herbs picked in their own stage (the locs yield nothing earlier), cleaned on
 *     the spot: lib/jungle-potion.ts
 * The boats, the jungle and the cave are lib/jungle-potion.ts.
 */
import { runQuest, type Quest } from './lib/run-quest';
import { deliverHerb, FARE, HERBS, homeFromJungle, onIslandNow, toJungle, TRUFITUS } from './lib/jungle-potion';

/** Both fares from the mainland; once on Karamja, the fare home. */
const coins = (q: Quest) => [{ item: 'coins', count: onIslandNow(q) ? FARE : 2 * FARE }];

const stage = (id: string, kind: 'unstarted' | 'active' | 'complete', all: string[], none: string[] = []) => ({
    id,
    rule: { id: `junglepotion:${id}`, kind, all, none },
});

await runQuest({
    id: 'junglepotion',
    // One at a time: with 3 accounts at Trufitus his dialog "did not open" for the others, 3 tries
    // running (jacklove7, ABGARMY20 failed 2/2 on the first transition, 2026-11-03).
    maxConcurrent: 1,
    hub: 'ardougne',
    skills: { herblore: 3 },
    carry: ['snake weed', 'ardrigal', 'sito foil', 'volencia moss', 'rogues purse'],
    journal: { label: 'Jungle Potion', title: 'Jungle Potion' },
    stages: [
        stage('unstarted', 'unstarted', ['I can start this quest by speaking to']),
        stage('snake', 'active', ['I spoke to Trufitus'], ["I've given Snakeweed", 'I have given Trufitus']),
        stage('ardrigal', 'active', ["I've given Snakeweed to Trufitus"]),
        stage('sito', 'active', ["I've given Snakeweed and Ardrigal"]),
        stage('moss', 'active', ['Ardrigal and Sito Foil']),
        stage('purse', 'active', ['and Volencia Moss to Trufitus']),
        // Passed through inside the Rogues Purse hand-in; seen only when a run stopped there.
        { ...stage('herbs', 'active', ['I have given Trufitus']), optional: true },
        stage('complete', 'complete', ['QUEST COMPLETE']),
    ],
    transitions: [
        {
            from: 'unstarted',
            to: 'snake',
            needs: coins,
            run: async (q) => {
                await toJungle(q, TRUFITUS, 6);
                await q.talk(/^trufitus$/i, [/where is everyone/i, /^me\? how can i help/i, /just the challenge for me/i], TRUFITUS);
            },
        },
        { from: 'snake', to: 'ardrigal', needs: coins, run: (q) => deliverHerb(q, HERBS.snake) },
        { from: 'ardrigal', to: 'sito', needs: coins, run: (q) => deliverHerb(q, HERBS.ardrigal) },
        { from: 'sito', to: 'moss', needs: coins, run: (q) => deliverHerb(q, HERBS.sito) },
        { from: 'moss', to: 'purse', needs: coins, run: (q) => deliverHerb(q, HERBS.moss) },
        {
            from: 'purse',
            to: 'complete',
            needs: coins,
            run: async (q) => {
                await deliverHerb(q, HERBS.purse);
                await homeFromJungle(q);
            },
        },
        {
            from: 'herbs',
            to: 'complete',
            needs: coins,
            run: async (q) => {
                await toJungle(q, TRUFITUS, 6);
                await q.talk(/^trufitus$/i, [], TRUFITUS);
                await homeFromJungle(q);
            },
        },
    ],
});
