/**
 * Clock Tower — Brother Kojo's four cogs, south of East Ardougne.
 *
 *   bun bots/quests/clock-tower.ts {botname}
 *
 * Journal rules from quest_cog/scripts/cog_journal.rs2; the cellar and its side entrances are
 * lib/clock-tower.ts. The cogs go red, white, black, blue (one carried at a time). The black cog
 * sits in fire and needs Ice gloves worn: banked ones (Heroes' Quest) are carried, else the Ice
 * Queen is killed for a pair (lib/heroes-quest.ts). Ogres (lvl 48) guard the red cog: a melee
 * weapon and a few sharks. Reward: 1 QP, 500 coins.
 */
import { runQuest } from './lib/run-quest';
import { blackCog, blueCog, held, KOJO, OBJ, redCog, whiteCog } from './lib/clock-tower';
import { iceGloves } from './lib/heroes-quest';

const stage = (id: string, kind: 'unstarted' | 'active' | 'complete', all: string[], none: string[] = []) => ({
    id,
    rule: { id: `cog:${id}`, kind, all, none },
});

const fight = [{ item: 'melee weapon', count: 1 }, { item: 'shark', count: 5 }];

await runQuest({
    id: 'cog',
    hub: 'ardougne',
    carry: [OBJ.iceGloves, OBJ.red, OBJ.white, OBJ.black, OBJ.blue],
    journal: { label: 'Clock Tower', title: 'Clock Tower' },
    stages: [
        stage('unstarted', 'unstarted', ['I can start this quest by talking to']),
        stage('started', 'active', ["haven't placed the Red Cog"]),
        stage('red', 'active', ['successfully placed the Red Cog', "haven't placed the White Cog"]),
        stage('white', 'active', ['successfully placed the White Cog', "haven't placed the Black Cog"]),
        stage('black', 'active', ['successfully placed the Black Cog', "haven't placed the Blue Cog"]),
        stage('placed', 'active', ['claim my reward']),
        stage('complete', 'complete', ['QUEST COMPLETE']),
    ],
    transitions: [
        { from: 'unstarted', to: 'started', at: KOJO, talk: { npc: /^brother kojo$/i, choices: [/ok old monk,? what can i do/i] } },
        { from: 'started', to: 'red', needs: fight, run: (q) => redCog(q) },
        { from: 'red', to: 'white', run: (q) => whiteCog(q) },
        {
            from: 'white',
            to: 'black',
            // No Ice gloves yet: the Ice Queen is past the Burthorpe rockslide, which needs a pickaxe
            // (Jackpoo5, ABGARMY05 stopped there, 2026-11-04).
            needs: (q) => (held(q, OBJ.iceGloves) || q.sdk.getEquipment().some((i) => i.id === OBJ.iceGloves) ? fight : [...fight, { item: 'pickaxe', count: 1 }]),
            run: async (q) => {
                if (!held(q, OBJ.iceGloves) && !q.sdk.getEquipment().some((i) => i.id === OBJ.iceGloves)) await iceGloves(q);
                await blackCog(q);
            },
        },
        { from: 'black', to: 'placed', run: (q) => blueCog(q) },
        { from: 'placed', to: 'complete', at: KOJO, talk: { npc: /^brother kojo$/i } },
    ],
});
