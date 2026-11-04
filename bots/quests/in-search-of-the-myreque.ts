/**
 * In Search of the Myreque — Vanstrom's six steel weapons to the Myreque's hideout under the hollows, and his hellhound.
 *
 *   bun bots/quests/in-search-of-the-myreque.ts {botname}
 *
 * Journal rules from quest_routequest/scripts/routequest_journal.rs2; the route is lib/myreque.ts over lib/nature-spirit.ts's
 * way under the Salve. Needs Nature Spirit (its druid pouch, >= 5 charges for Cyreg, and the blessed sickle that refills it
 * with Prayer points). Gates: Agility 25 (the stalagmite), a level 97 Skeleton Hellhound (att 70, def 100, str 110; a melee
 * weapon and sharks). Supplies: a steel longsword, two steel swords and a dagger (Varrock Swords), a steel mace (Flynn,
 * Falador), a steel warhammer (smithed from 3 mule steel bars, Smithing 39), 3 planks for Cyreg, 10 coins for his boat.
 * The bridge's kit (3 more planks, 30 nails, a hammer) is not needed: the landing's boat rows back and the bot walks round
 * by Canifis to Curpile. Reward: 2 QP, Attack/Defence/Strength/Hitpoints/Crafting XP.
 *
 * Staging (2026-11-04): QUEST COMPLETE (journal-verified) on a fresh account (qlqhmy3: the four steel weapons bought, the
 * warhammer smithed, the pouch topped up from 3 charges). qlqhmy1 was restarted at Mort'ton's dock (out by the swamp) and
 * in the hollows north of the bridge (out by Canifis); both prologues reached the Varrock east bank.
 */
import { runQuest, type Quest, type Need } from './lib/run-quest';
import * as myq from './lib/myreque';
import { readJournalCheckpoint } from '../../quest-lab/journal-reader';

const stage = (id: string, kind: 'unstarted' | 'active' | 'complete', all: string[], none: string[] = [], optional = false) => ({
    id,
    rule: { id: `routequest:${id}`, kind, all, none },
    ...(optional ? { optional } : {}),
});

const journal = { label: 'In Search of the Myreque', title: 'In Search of the Myreque' };
const stages = [
    stage('unstarted', 'unstarted', ['I can start this quest by talking to a']),
    stage('started', 'active', ['asked me to take some']),
    // 10 and 15 pass inside Cyreg's one conversation.
    stage('boatman', 'active', ['have to be persuasive'], [], true),
    stage('agreed', 'active', ['persuaded the boatman to help me find'], [], true),
    stage('repaired', 'active', ['but I can use his']),
    stage('hollows', 'active', ["travelled to the 'Hollows'"]),
    // 52 is set only by the bridge's north tree, which this route never climbs.
    stage('guard', 'active', ['came across a guard called'], [], true),
    stage('answered', 'active', ['unlock the door for me now']),
    stage('underground', 'active', ['I entered an underground area']),
    stage('veliaf', 'active', ['I met Veliaf']),
    // 70: the cutscene runs at once and ends at 80.
    stage('cutscene', 'active', ['I tried talking to Veliaf'], [], true),
    // 80: auto-retaliate can kill the hound before the cutscene step's journal read.
    stage('ambush', 'active', ['mist cloud appeared'], [], true),
    stage('saved', 'active', ['I killed the hell hound']),
    stage('told', 'active', ['he says I can get into the']),
    stage('wall', 'active', ['I went through the secret wall']),
    stage('exit', 'active', ['to find myself in']),
    stage('complete', 'complete', ['QUEST COMPLETE']),
];
const ORDER = stages.map((s) => s.id);
const before = (q: Quest, id: string) => ORDER.indexOf(q.stage) < ORDER.indexOf(id);
type Sdk = Parameters<typeof readJournalCheckpoint>[0];
const passes = async (sdk: Sdk, id: string) => (await readJournalCheckpoint(sdk, journal, stages.find((s) => s.id === id)!.rule)).verdict?.verdict === 'PASS';
const passesAny = async (sdk: Sdk, from: string) => {
    for (const id of ORDER.slice(ORDER.indexOf(from)).reverse()) if (await passes(sdk, id)) return true;
    return false;
};

const banked = (q: Quest, item: string, count: number) => (q.sdk.isBankOpen() ? [{ item, count }] : []);
const hasWarhammer = (q: Quest) => q.count(/^steel warhammer$/i) > 0 || (q.sdk.isBankOpen() && !!q.sdk.findBankItem(/^steel warhammer$/i));

/**
 * Pack (28): six weapons, 3 planks, coins, the pouch, the sickle, the weapon until wielded, 10 sharks, and room for
 * the three bloomed pears of a pouch top-up (and the hammer the warhammer's smithing leaves behind).
 */
function kit(q: Quest): Need[] {
    const needs: Need[] = [{ item: 'melee weapon', count: 1 }];
    if (before(q, 'cutscene')) {
        needs.push(
            { item: 'steel longsword', count: 1 },
            { item: 'steel sword', count: 2 },
            { item: 'steel dagger', count: 1 },
            { item: 'steel mace', count: 1 },
        );
        // The mule's bars (NEEDS STOCK when short) only while there is no warhammer to carry.
        if (!hasWarhammer(q)) needs.push({ item: 'steel bar', count: 3 });
        needs.push({ item: 'steel warhammer', count: 1 });
    }
    if (before(q, 'repaired')) needs.push({ item: 'plank', count: 3 });
    if (before(q, 'hollows')) needs.push({ item: 'coins', count: 20 });
    // Food at the bank only: the swamp's ghasts rot a few, and a restart tops up at the hub.
    needs.push(...banked(q, 'shark', 10));
    // The charged pouch is one stack: `carry` would withdraw one charge of it. Take the whole stack until the walk round to Curpile is done (ghasts take charges, not food).
    if (before(q, 'answered') && q.sdk.isBankOpen()) {
        const charges = q.sdk.getBankItems().filter((b) => b.id === myq.OBJ.pouch).reduce((n, b) => n + b.count, 0) + myq.pouchCharges(q);
        if (charges > 0) needs.push({ item: 'druid pouch', count: charges });
    }
    return needs;
}

/** The weapon on before the step (never a steel quest weapon). */
const go = (run: (q: Quest) => Promise<void>) => async (q: Quest) => {
    await myq.wieldWeapon(q);
    await run(q);
};

await runQuest({
    id: 'routequest',
    hub: 'varrock-east',
    journal,
    skills: { agility: 25 },
    // Nature Spirit's empty pouch and blessed sickle: the naked prologue banks them, so withdraw them again (the charged
    // pouch is a stack: kit takes all of it).
    carry: [myq.OBJ.pouchEmpty, myq.OBJ.sickleBlessed],
    // Cyreg, Curpile and the boat are shared; the hideout's cutscene has four rooms.
    maxConcurrent: 2,
    stages,
    transitions: [
        { from: 'unstarted', to: 'started', needs: kit, run: go((q) => myq.start(q, () => passesAny(q.sdk, 'started'))) },
        { from: 'started', to: 'repaired', needs: kit, run: go((q) => myq.cyreg(q, () => passesAny(q.sdk, 'repaired'))) },
        { from: 'boatman', to: 'repaired', needs: kit, run: go((q) => myq.cyreg(q, () => passesAny(q.sdk, 'repaired'))) },
        { from: 'agreed', to: 'repaired', needs: kit, run: go((q) => myq.cyreg(q, () => passesAny(q.sdk, 'repaired'))) },
        { from: 'repaired', to: 'hollows', needs: kit, run: go((q) => myq.boat(q, () => passesAny(q.sdk, 'hollows'))) },
        { from: 'hollows', to: 'answered', needs: kit, run: go((q) => myq.curpile(q, () => passesAny(q.sdk, 'answered'))) },
        { from: 'guard', to: 'answered', needs: kit, run: go((q) => myq.curpile(q, () => passesAny(q.sdk, 'answered'))) },
        { from: 'answered', to: 'underground', needs: kit, run: go((q) => myq.enterDoors(q)) },
        { from: 'underground', to: 'veliaf', needs: kit, run: go((q) => myq.meetVeliaf(q)) },
        { from: 'veliaf', to: 'saved', needs: kit, run: go((q) => myq.weaponsToVeliaf(q, () => passesAny(q.sdk, 'ambush'), () => passesAny(q.sdk, 'saved'))) },
        { from: 'cutscene', to: 'saved', needs: kit, run: go((q) => myq.weaponsToVeliaf(q, () => passesAny(q.sdk, 'ambush'), () => passesAny(q.sdk, 'saved'))) },
        { from: 'ambush', to: 'saved', needs: kit, run: go((q) => myq.killHound(q, () => passesAny(q.sdk, 'saved'))) },
        { from: 'saved', to: 'told', needs: kit, run: go((q) => myq.askWayOut(q)) },
        { from: 'told', to: 'wall', needs: kit, run: go((q) => myq.falseWall(q)) },
        { from: 'wall', to: 'exit', needs: kit, run: go((q) => myq.basementLadder(q)) },
        { from: 'exit', to: 'complete', needs: kit, run: go((q) => myq.stranger(q, () => passes(q.sdk, 'complete'))) },
    ],
});
