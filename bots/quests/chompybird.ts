/**
 * Big Chompy Bird Hunting — Rantz's stabbers, the fatsy toadies, the chompy and its seasonings (Feldip Hills).
 *
 *   bun bots/quests/chompybird.ts {botname}
 *
 * Journal rules from quest_chompybird/scripts/chompybird_journal.rs2; the route is lib/chompybird.ts. Gates: Fletching 5
 * and Crafting 5 (the ogre arrows), Cooking 30 (the spit-roast), Ranged 30 base (the ogre bow). Prayer 43 is used when
 * present (Protect from Melee at the swamp's wolves). Supplies: 48 feathers (Gerrant, Port Sarim), an onion (Rantz's
 * wish; Rimmington's patch), an axe for the achey trees, a melee weapon for the wolves' bones, sharks, coins (Bugs' knife
 * and chisel, 10gp). Equa leaves and the tomato are Feldip ground spawns. Reward: 2 QP, the ogre bow.
 */
import { runQuest, type Quest } from './lib/run-quest';
import * as chompy from './lib/chompybird';
import { readJournalCheckpoint } from '../../quest-lab/journal-reader';

const stage = (id: string, kind: 'unstarted' | 'active' | 'complete', all: string[], none: string[] = []) => ({
    id,
    rule: { id: `chompybird:${id}`, kind, all, none },
});

const journal = { label: 'Big Chompy Bird Hunting', title: 'Big Chompy Bird Hunting' };
const stages = [
    stage('unstarted', 'unstarted', ['I can start this quest by speaking to the ogre']),
    stage('started', 'active', ['I agreed to get Rants some']),
    // 5 -> 10 -> 15 in Rantz's one dialog (the arrows, then "How do we make the chompys come?").
    { ...stage('arrows', 'active', ['Rantz says I need to get some']), optional: true },
    stage('toadtalk', 'active', ["I need to bring Rantz a 'fatsy toady'"]),
    stage('shown', 'active', ['I should drop a toad']),
    // 30 -> 35 -> 40 by itself: the toad, the chompy, Rantz's miss.
    { ...stage('dropped', 'active', ['I should see how Rantz catches a Chompy Bird']), optional: true },
    // 40 (and 45 while the bow is worn or lost: the journal counts it in the pack only).
    stage('missed', 'active', ['should try to shoot a chompy for him']),
    stage('bow', 'active', ['has lent me an Ogre bow']),
    stage('killed', 'active', ["I've killed a chompy bird"]),
    stage('told', 'active', ['has asked me to cook']),
    stage('cooked', 'active', ["I'd better take it to them before they"]),
    stage('complete', 'complete', ['QUEST COMPLETE']),
];
type Sdk = Parameters<typeof readJournalCheckpoint>[0];
const passes = async (sdk: Sdk, id: string) => (await readJournalCheckpoint(sdk, journal, stages.find((s) => s.id === id)!.rule)).verdict?.verdict === 'PASS';

/** Ogre arrows banked by an earlier run: all of them, withdrawn at the open hub bank (carry takes one). */
const bankedArrows = (q: Quest) => {
    const b = q.sdk.findBankItem(/^ogre arrow$/i);
    return b ? [{ item: 'ogre arrow', count: b.count + q.count('ogre arrow') }] : [];
};
/** Sharks for the wolves: taken at the open hub bank only, so eating them never stops a transition with NEEDS STOCK. */
const food = (q: Quest) => (q.sdk.isBankOpen() ? [{ item: 'shark', count: 6 }] : []);
const kit = (q: Quest) => [{ item: 'melee weapon', count: 1 }, ...food(q), { item: 'coins', count: 60 }];
const hunt = (q: Quest) => [...kit(q), { item: 'onion', count: 1 }, ...bankedArrows(q)];
const fletch = (q: Quest) => [{ item: 'feather', count: chompy.FEATHERS }, { item: 'onion', count: 1 }, { item: 'axe', count: 1 }, ...kit(q)];

await runQuest({
    id: 'chompybird',
    hub: 'yanille',
    journal,
    skills: { fletching: 5, crafting: 5, cooking: 30, ranged: 30 },
    carry: ['ogre bellows', 'ogre bellows (1)', 'ogre bellows (2)', 'ogre bellows (3)', 'ogre bow', 'raw chompy', 'seasoned chompy', 'knife', 'chisel'],
    // Rantz, the swamp toads and the wolves are shared; each chompy belongs to the player whose toad called it.
    maxConcurrent: 2,
    stages,
    transitions: [
        { from: 'unstarted', to: 'started', needs: fletch, run: (q) => chompy.start(q) },
        {
            from: 'started',
            to: 'toadtalk',
            needs: fletch,
            run: async (q) => {
                await chompy.fletchArrows(q);
                await chompy.giveArrows(q);
            },
        },
        { from: 'arrows', to: 'toadtalk', needs: hunt, run: (q) => chompy.giveArrows(q) },
        {
            from: 'toadtalk',
            to: 'shown',
            needs: hunt,
            run: async (q) => {
                await chompy.getBellows(q);
                await chompy.showToad(q);
            },
        },
        { from: 'shown', to: 'missed', needs: hunt, run: (q) => chompy.watchRantz(q, () => passes(q.sdk, 'missed')) },
        { from: 'dropped', to: 'missed', needs: hunt, run: (q) => chompy.watchRantz(q, () => passes(q.sdk, 'missed')) },
        {
            from: 'missed',
            to: 'bow',
            needs: hunt,
            run: async (q) => {
                // Worn, the bow reads as stage 40 in the journal: hunt with it rather than ask again.
                if (chompy.hasBow(q)) return chompy.huntChompy(q);
                await chompy.borrowBow(q);
            },
        },
        { from: 'bow', to: 'killed', needs: hunt, run: (q) => chompy.huntChompy(q) },
        {
            from: 'killed',
            to: 'told',
            needs: hunt,
            run: async (q) => {
                const wish = await chompy.showChompy(q);
                q.log(`chompy: Rantz wants ${wish ?? '?'}`);
            },
        },
        {
            from: 'told',
            to: 'cooked',
            needs: hunt,
            run: async (q) => {
                // Rantz repeats his wish on every talk at 55; Bugs and Fycie set theirs when first asked.
                const rantz = /wants (potato|onion)/i.exec(await q.talk(/^rantz$/i, [], chompy.RANTZ))?.[1]?.toLowerCase();
                const family = await chompy.askFamily(q);
                await chompy.roast(q, { rantz, ...family }, () => passes(q.sdk, 'cooked'));
            },
        },
        { from: 'cooked', to: 'complete', needs: kit, run: (q) => chompy.handIn(q) },
    ],
});
