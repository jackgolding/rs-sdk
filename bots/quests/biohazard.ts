/**
 * Biohazard — Elena's distillator from the mourners, and her plague sample to Guidor.
 *
 *   bun bots/quests/biohazard.ts {botname}
 *
 * Needs Plague City complete. Journal rules from quest_biohazard/scripts/biohazard_journal.rs2:
 * each stage's own line (earlier ones persist struck through, hence the `none`s; 5 and 6 both
 * print "Somewhere in this city"). Dialog and mechanics from quest_biohazard/scripts/*.rs2 and
 * the Ardougne area scripts; the route is lib/biohazard.ts (West Ardougne via lib/plague-city.ts).
 * Items:
 *   - priest gown top + bottom   lib/sources.ts ('priest gown' x2, Thessalia, Varrock) — Guidor's door
 *   - bird feed, pigeon cage, rotten apples, doctors' gown, the key, the distillator, Elena's
 *     vials, the touch paper: the quest's own (Jerico's cupboard, the cages behind his house, a
 *     West Ardougne spawn, the nurse's cupboard, a mourner, the HQ crate, Elena, the chemist)
 * Combat: one mourner upstairs in the HQ (level 13, not aggressive) must die for the gate key.
 * The run is naked; the combat gate below keeps weak accounts out rather than feeding them.
 */
import { runQuest, type Need } from './lib/run-quest';
import {
    ELENA,
    enterWestArdougne,
    feedTower,
    findDistillator,
    JERICO,
    OBJ,
    poisonStew,
    releasePigeons,
    reportToElena,
    returnDistillator,
    seeChemist,
    seeGuidor,
    seeLathas,
    smuggleVials,
    talkIndoors,
} from './lib/biohazard';

const stage = (id: string, kind: 'unstarted' | 'active' | 'complete', all: string[], none: string[] = []) => ({
    id,
    rule: { id: `biohazard:${id}`, kind, all, none },
});

/** Guidor's door: both halves of the priest's suit, bought before the first dialog. */
const ROBES: Need[] = [{ item: 'priest gown', count: 2 }];

await runQuest({
    id: 'biohazard',
    hub: 'ardougne',
    // The HQ mourner (level 13, 19hp) is fought naked.
    skills: { attack: 15, strength: 15, defence: 15, hitpoints: 20 },
    carry: [
        OBJ.birdFeed,
        OBJ.pigeons,
        OBJ.rottenApples,
        OBJ.doctorsGown,
        OBJ.key,
        OBJ.distillator,
        OBJ.ethenea,
        OBJ.liquidHoney,
        OBJ.sulphuricBroline,
        OBJ.plagueSample,
        OBJ.touchPaper,
        OBJ.priestGown,
        OBJ.priestRobe,
    ],
    journal: { label: 'Biohazard', title: 'Biohazard' },
    stages: [
        stage('unstarted', 'unstarted', ['I can start this quest by speaking to']),
        stage('started', 'active', ['about getting over the wall']),
        stage('jerico', 'active', ['will be able to get me over the wall']),
        stage('birdfeed', 'active', ["I've chucked some birdfeed"]),
        stage('pigeons', 'active', ['surrounded by flapping pigeons']),
        stage('crossed', 'active', ['Somewhere in this city is'], ['unkindly poisoned']),
        stage('poisoned', 'active', ['unkindly poisoned']),
        stage('found', 'active', ["I managed to find Elena's distillator"]),
        stage('given', 'active', ["Elena's asked me to take the following items"]),
        stage('chemist', 'active', ['The Varrock guards are out looking']),
        stage('secret', 'active', ['findings were very interesting']),
        stage('reported', 'active', ['I need to confront the']),
        stage('complete', 'complete', ['QUEST COMPLETE']),
    ],
    transitions: [
        { from: 'unstarted', to: 'started', needs: ROBES, run: async (q) => void (await talkIndoors(q, /^elena$/i, [/i'll try to retrieve it/i], ELENA)) },
        { from: 'started', to: 'jerico', needs: ROBES, run: async (q) => void (await talkIndoors(q, /^jerico$/i, [], JERICO)) },
        { from: 'jerico', to: 'birdfeed', needs: ROBES, run: (q) => feedTower(q) },
        { from: 'birdfeed', to: 'pigeons', needs: ROBES, run: (q) => releasePigeons(q) },
        { from: 'pigeons', to: 'crossed', needs: ROBES, run: (q) => enterWestArdougne(q) },
        { from: 'crossed', to: 'poisoned', needs: ROBES, run: (q) => poisonStew(q) },
        { from: 'poisoned', to: 'found', needs: ROBES, run: (q) => findDistillator(q) },
        // goTo leaves West Ardougne by the manhole and the mud pile (lib/plague-city.ts).
        { from: 'found', to: 'given', needs: ROBES, run: (q) => returnDistillator(q) },
        { from: 'given', to: 'chemist', needs: ROBES, run: (q) => seeChemist(q) },
        {
            from: 'chemist',
            to: 'secret',
            needs: ROBES,
            run: async (q) => {
                await smuggleVials(q);
                await seeGuidor(q);
            },
        },
        { from: 'secret', to: 'reported', run: (q) => reportToElena(q) },
        { from: 'reported', to: 'complete', run: (q) => seeLathas(q) },
    ],
});
