/**
 * Plague City — find Edmond's daughter Elena in West Ardougne.
 *
 *   bun bots/quests/plague-city.ts {botname}
 *
 * Journal rules from quest_elena/scripts/elena_journal.rs2: each stage's own
 * line (earlier ones persist struck through, hence the `none`s). Two pairs of
 * stages print the same journal (the script's `> returned_book` strikes Jethick's
 * line only from 22): 20/21, so returning the book and asking Ted are one
 * transition, and 24/25, so the clerk's step runs inside `clearance`. Dialog and
 * mechanics from quest_elena/scripts/*.rs2; the route is lib/plague-city.ts.
 * Items, all from lib/sources.ts:
 *   - dwellberries, bucket of milk, chocolate dust   Hudo, Grand Tree (Gnome Stronghold)
 *   - 4 buckets of water                              Varrock general store + palace sink
 *   - rope                                            Ned, Draynor
 *   - snape grass                                     ground spawns, hobgoblin peninsula
 *   - spade, picture, gas mask (spare), book, warrant, key: the quest's own (garden
 *     spawn, Edmond's house, Alrena's cupboard, Jethick, Bravek, the barrel)
 */
import { runQuest, type Need, type Quest } from './lib/run-quest';
import {
    ALRENA,
    askMilli,
    askRehnisons,
    cureBravek,
    digIntoSewer,
    EDMOND,
    getPicture,
    holds,
    leavePlagueCity,
    OBJ,
    pullGrill,
    rescueElena,
    returnBook,
    seeBravek,
    showPicture,
    softenSoil,
    tieRope,
    tryPlagueHouse,
} from './lib/plague-city';

const stage = (id: string, kind: 'unstarted' | 'active' | 'complete', all: string[], none: string[] = [], rawAll: string[] = []) => ({
    id,
    rule: { id: `elena:${id}`, kind, all, none, ...(rawAll.length ? { rawAll } : {}) },
});

/**
 * Everything still to be sourced from stage `from` on, in the order prepare should gather it:
 * Ardougne -> the Gnome Stronghold (Hudo) -> Varrock (buckets, water) -> Draynor (rope) ->
 * the hobgoblin peninsula (snape grass) -> back to Ardougne.
 */
const ORDER = ['started', 'soften', 'tunnel', 'bravek'];
function kit(from: string) {
    const at = ORDER.indexOf(from);
    const ahead = (s: string) => at <= ORDER.indexOf(s);
    return (q: Quest): Need[] => {
        const cure = holds(q, OBJ.hangoverCure);
        const milk = holds(q, OBJ.chocolateyMilk);
        return [
            ...(ahead('started') ? [{ item: 'dwellberries', count: 1, or: 'gas mask' }] : []),
            ...(ahead('bravek') && !cure && !milk ? [{ item: 'bucket of milk', count: 1, or: 'hangover cure' }, { item: 'chocolate dust', count: 1, or: 'hangover cure' }] : []),
            ...(ahead('soften') ? [{ item: 'bucket of water', count: 4 }] : []),
            ...(ahead('tunnel') ? [{ item: 'rope', count: 1 }] : []),
            ...(ahead('bravek') && !cure ? [{ item: 'snape grass', count: 1, or: 'hangover cure' }] : []),
        ];
    };
}

await runQuest({
    id: 'elena',
    hub: 'ardougne',
    carry: ['gas mask', OBJ.picture, OBJ.book, OBJ.warrant, OBJ.smallKey, OBJ.hangoverCure, OBJ.chocolateyMilk],
    journal: { label: 'Plague City', title: 'Plague City' },
    stages: [
        stage('unstarted', 'unstarted', ['I can start this quest by speaking to']),
        stage('started', 'active', ['I need to get some Dwellberries'], ['Alrena has given me a Gasmask']),
        stage('gasmask', 'active', ['I need to talk to Edmond about getting into'], ["I've spoken to Edmond about getting into"]),
        stage('soften', 'active', ['to soften the ground in Edmond'], ["I've softened the ground"]),
        stage('softened', 'active', ['Now I need to dig a tunnel into'], ["I've dug a tunnel"]),
        stage('tunnel', 'active', ['I need to find a way out of the sewers'], ["I've managed to clear the way", "I've tied a rope"]),
        stage('tied', 'active', ["I've tied a rope to the sewer grill"], ["I've managed to clear the way"]),
        stage('pipe', 'active', ['look out for an old family friend'], ["I've spoken to Jethick"]),
        // 20 (shown the picture) and 21 (book returned) print the same journal.
        stage('jethick', 'active', ["I've spoken to Jethick"], ['daughter Milli', "I've spoken to Milli"], ["@dbl@I've spoken to"]),
        stage('rehnisons', 'active', ["Rehnisons' daughter Milli"], ["I've spoken to Milli"]),
        stage('milli', 'active', ['I need to get access to the Plague House'], ['I need clearance']),
        stage('clearance', 'active', ['I need clearance from either the Head Mourner'], ['Bravek might give me clearance']),
        stage('bravek', 'active', ['I need to bring Bravek the Hangover Cure'], ["I've given Bravek the Hangover Cure"]),
        stage('cured', 'active', ['Plague House and find Elena'], ["I've freed Elena"]),
        stage('freed', 'active', ['I should go and talk to Edmond again']),
        stage('complete', 'complete', ['QUEST COMPLETE']),
    ],
    transitions: [
        {
            from: 'unstarted',
            to: 'started',
            at: EDMOND,
            needs: kit('started'),
            talk: { npc: /^edmond$/i, choices: [/what's happened to her/i, /can i help find her/i] },
        },
        { from: 'started', to: 'gasmask', at: ALRENA, needs: kit('started'), talk: { npc: /^alrena$/i } },
        // The picture lies in the same house; Edmond moves the stage on whatever he is told.
        {
            from: 'gasmask',
            to: 'soften',
            needs: kit('soften'),
            run: async (q) => {
                await getPicture(q);
                await q.talk(/^edmond$/i, [], EDMOND);
            },
        },
        { from: 'soften', to: 'softened', needs: kit('soften'), run: (q) => softenSoil(q) },
        {
            from: 'softened',
            to: 'tunnel',
            needs: kit('tunnel'),
            run: async (q) => {
                await getPicture(q);
                await digIntoSewer(q);
            },
        },
        { from: 'tunnel', to: 'tied', needs: kit('tunnel'), run: (q) => tieRope(q) },
        { from: 'tied', to: 'pipe', needs: kit('bravek'), run: (q) => pullGrill(q) },
        { from: 'pipe', to: 'jethick', needs: kit('bravek'), run: (q) => showPicture(q) },
        {
            from: 'jethick',
            to: 'rehnisons',
            needs: kit('bravek'),
            run: async (q) => {
                await returnBook(q);
                await askRehnisons(q);
            },
        },
        { from: 'rehnisons', to: 'milli', needs: kit('bravek'), run: (q) => askMilli(q) },
        { from: 'milli', to: 'clearance', needs: kit('bravek'), run: (q) => tryPlagueHouse(q) },
        { from: 'clearance', to: 'bravek', needs: kit('bravek'), run: (q) => seeBravek(q) },
        { from: 'bravek', to: 'cured', needs: kit('bravek'), run: (q) => cureBravek(q) },
        { from: 'cured', to: 'freed', run: (q) => rescueElena(q) },
        {
            from: 'freed',
            to: 'complete',
            run: async (q) => {
                await leavePlagueCity(q);
                await q.talk(/^edmond$/i, [], EDMOND);
            },
        },
    ],
});
