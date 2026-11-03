/**
 * Tree Gnome Village — King Bolren's orbs of protection, the ballista and the Khazard warlord.
 *
 *   bun bots/quests/tree-gnome-village.ts {botname}
 *
 * Journal rules from quest_tree/scripts/tree_journal.rs2; the maze, the ballista, the stronghold and
 * the warlord are lib/tree-gnome-village.ts. No skill gates; the warlord is level 112 (170 hp), so a
 * melee weapon and food come out of the bank. Items: 6 logs (ground spawns west of the maze), a melee
 * weapon and sharks (mule stock when not banked). Reward: 2 QP, Attack XP, a gnome amulet.
 */
import { runQuest } from './lib/run-quest';
import { enterGnomeVillage, fireBallista, killWarlord, leaveGnomeVillage, leaveKhazardStronghold, MONTAI, OBJ, seeBolren, takeOrb } from './lib/tree-gnome-village';

const stage = (id: string, kind: 'unstarted' | 'active' | 'complete', all: string[], none: string[] = []) => ({
    id,
    rule: { id: `tree:${id}`, kind, all, none },
});

const montai = /^commander montai$/i;

await runQuest({
    id: 'tree',
    hub: 'ardougne',
    carry: [OBJ.orb, OBJ.orbs],
    journal: { label: 'Tree Gnome Village', title: 'Tree Gnome Village' },
    stages: [
        stage('unstarted', 'unstarted', ['I can start this quest by speaking to']),
        stage('started', 'active', ['can help me get it']),
        stage('montai', 'active', ['I need to bring Montai']),
        stage('logs', 'active', ['again and see what to do next']),
        stage('trackers', 'active', ['I need to head into the']),
        stage('fired', 'active', ['exposed I should get inside']),
        stage('orb', 'active', ['to King Bolren immediately']),
        stage('returned', 'active', ['two remaining orbs']),
        stage('warlord', 'active', ['I should return them now to'], ['QUEST COMPLETE']),
        stage('complete', 'complete', ['QUEST COMPLETE']),
    ],
    transitions: [
        // Bolren telejumps us out of the maze when we agree.
        { from: 'unstarted', to: 'started', run: (q) => seeBolren(q, [/can i help at all/i, /i would be glad to help/i]) },
        {
            from: 'started',
            to: 'montai',
            run: async (q) => {
                await leaveGnomeVillage(q);
                await q.talk(montai, [/ok,? i'?ll gather some wood/i], MONTAI);
            },
        },
        { from: 'montai', to: 'logs', needs: [{ item: 'logs', count: 6 }], run: (q) => q.talk(montai, [], MONTAI).then(() => undefined) },
        { from: 'logs', to: 'trackers', at: MONTAI, talk: { npc: montai, choices: [/i'?ll try my best/i] } },
        { from: 'trackers', to: 'fired', run: (q) => fireBallista(q) },
        {
            from: 'fired',
            to: 'orb',
            needs: [{ item: 'shark', count: 4 }],
            run: async (q) => {
                try {
                    await takeOrb(q);
                } finally {
                    await leaveKhazardStronghold(q);
                }
            },
        },
        {
            from: 'orb',
            to: 'returned',
            run: async (q) => {
                await leaveKhazardStronghold(q);
                await seeBolren(q, [/i will find the warlord/i]);
            },
        },
        {
            from: 'returned',
            to: 'warlord',
            needs: [{ item: 'melee weapon', count: 1 }, { item: 'shark', count: 10 }],
            run: async (q) => {
                await leaveGnomeVillage(q);
                await killWarlord(q);
            },
        },
        {
            from: 'warlord',
            to: 'complete',
            run: async (q) => {
                await enterGnomeVillage(q);
                await seeBolren(q, []);
            },
        },
    ],
});
