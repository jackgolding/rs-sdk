/**
 * Fight Arena — free the Servils from General Khazard's arena.
 *
 *   bun bots/quests/fight-arena.ts {botname}
 *
 * Journal rules from quest_arena/scripts/arena_journal.rs2: each stage's own
 * last line. Dialog and mechanics from quest_arena/scripts/*.rs2 and Hermes'
 * probe notes (quest-lab/PROBE-NOTES-arena.md, branch quest/arena). Items:
 *   - Khazard helmet + armour  the guards' chest (quest items, carried on resume)
 *   - Khali brew               bought from the barman inside the step (he only
 *                              sells it once the bored guard has talked)
 *   - Khazard cell keys        the drunk guard (quest item)
 *   - the fight kit for the ogre (63), the scorpion (44) and Bouncer (137), first
 *     that fits: melee (dragon longsword, sharks, Protect from Melee), magic (fire
 *     staff — bank or Zaff's — and Fire Bolt runes from Betty's), ranged (magic
 *     shortbow, rune arrows, sharks: mule stock)
 * The pen, doors and fights are lib/fight-arena.ts.
 */
import { runQuest } from './lib/run-quest';
import {
    buyBrew,
    freeJeremy,
    kitNeeds,
    LADY_SERVIL,
    leavePen,
    penFight,
    takeArmour,
    toPen,
    talkGuard2,
    talkJeremyArena,
} from './lib/fight-arena';

/** The pen fights' kit (melee, magic or ranged — lib/fight-arena.ts kitNeeds picks it in the prologue). */
const kit = kitNeeds;

const stage = (id: string, kind: 'unstarted' | 'active' | 'complete', text: string, optional = false) => ({
    id,
    rule: { id: `arena:${id}`, kind, all: [text] },
    optional,
});

await runQuest({
    id: 'arena',
    hub: 'yanille',
    // The pen's mobs and Jeremy's releases are shared: more than two in the arena trip over each other.
    maxConcurrent: 2,
    carry: ['khazard helmet', 'khazard armour', 'khazard cell keys'],
    journal: { label: 'Fight Arena', title: 'Fight Arena' },
    stages: [
        stage('unstarted', 'unstarted', 'I can start this quest by speaking to'),
        stage('started', 'active', 'I should go to the Fight Arena'),
        // Struck through from bored_guard on; 'disguise myself as a guard' follows it there. A
        // canary read 'armour' after the scorpion (a partial journal read): exclusive rules
        // make such a read match nothing, and the runner reads again.
        { id: 'armour', rule: { id: 'arena:armour', kind: 'active' as const, all: ['Luckily I found some Khazard armour'], none: ['disguise myself as a guard'] } },
        stage('bored_guard', 'active', 'really likes Khali Brew'),
        stage('keys', 'active', "Now I've got the keys"),
        stage('ogre_fight', 'active', 'protect Jeremy and his father'),
        // Passed through in the ogre's death dialog when Khazard is near (straight to the cells).
        stage('ogre_dead', 'active', 'I should talk to Jeremy in the Fight Arena', true),
        stage('jailed', 'active', "I'm going to have to fight in the Arena"),
        // Khazard sends Bouncer in as the scorpion dies; a quick kill passes it unseen.
        stage('scorpion_dead', 'active', "After I'd defeated the Scorpion", true),
        // Bouncer's death dialog (Khazard's agreement) usually sets 'freed' straight away.
        stage('bouncer_dead', 'active', 'wants to kill me himself', true),
        stage('freed', 'active', 'go and tell Lady Servil'),
        stage('complete', 'complete', 'QUEST COMPLETE'),
    ],
    transitions: [
        { from: 'unstarted', to: 'started', at: LADY_SERVIL, talk: { npc: /^lady servil$/i, choices: [/can i help you/i] } },
        { from: 'started', to: 'armour', run: (q) => takeArmour(q) },
        { from: 'armour', to: 'bored_guard', run: (q) => talkGuard2(q) },
        {
            from: 'bored_guard',
            to: 'keys',
            needs: [{ item: 'coins', count: 10 }],
            run: async (q) => {
                await buyBrew(q);
                await talkGuard2(q);
            },
        },
        { from: 'keys', to: 'ogre_fight', needs: kit, run: (q) => freeJeremy(q) },
        // The ogre's death handler runs Khazard's "well done" and the march to the cells when he is near.
        { from: 'ogre_fight', to: 'ogre_dead', needs: kit, run: (q) => penFight(q, /^khazard ogre$/i, 'ogre') },
        { from: 'ogre_dead', to: 'jailed', run: (q) => talkJeremyArena(q) },
        {
            from: 'jailed',
            to: 'scorpion_dead',
            needs: kit,
            run: async (q) => {
                await toPen(q);
                await penFight(q, /^khazard scorpion$/i, 'scorpion', /^bouncer$/i);
            },
        },
        // Bouncer's death chain (Khazard's agreement) sets 'freed' straight away.
        {
            from: 'scorpion_dead',
            to: 'bouncer_dead',
            needs: kit,
            run: async (q) => {
                await toPen(q);
                await penFight(q, /^bouncer$/i, 'Bouncer');
            },
        },
        {
            from: 'bouncer_dead',
            to: 'freed',
            run: async (q) => {
                await toPen(q);
                await talkJeremyArena(q);
            },
        },
        {
            from: 'freed',
            to: 'complete',
            run: async (q) => {
                await leavePen(q);
                await q.talk(/^lady servil$/i, [], LADY_SERVIL);
            },
        },
    ],
});
