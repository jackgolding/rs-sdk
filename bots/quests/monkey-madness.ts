/**
 * Monkey Madness — the 10th squad, Ape Atoll, Awowogei and the Jungle Demon.
 *
 *   bun bots/quests/monkey-madness.ts {botname}
 *
 * Journal rules from quest_mm/scripts/mm_journal.rs2; chapter 1 (Narnode, the shipyard, Daero, the
 * hangar's sliding puzzle, Waydar, Lumdo) is lib/monkey-madness.ts, chapters 2-4 (the jail, Garkor,
 * Zooknock, the warehouse, the temple, the monkey child, the greegree, Kruk, Awowogei, the zoo monkey,
 * the sigil, the Jungle Demon) lib/ape-atoll.ts.
 *
 * Requires The Grand Tree and Tree Gnome Village (journal-gated), and the lite client that sends OPHELD on
 * the hangar puzzle board (server/webclient useInventoryItem) and publishes state.interface.inventories.
 * Staged maxed (99s): the atoll as a human (archers, guards, the temple's gorillas, poison) eats ~10-20
 * sharks and ~5 prayer potions per chapter-2 pass on the 60 ms engine; the demon is meleed under Protect
 * from Magic. Kit from the bank (the mule's stock): a melee weapon, sharks, prayer potions, antipoison, a
 * gold bar, a ball of wool, 5 bananas and Karamja monkey bones. Atoll steps restock at the Grand Tree bank
 * when low (lib/ape-atoll.ts topUp). Reward: 3 QP, 10,000 coins, 3 diamonds (3 free slots). Daero's
 * combat training after QUEST COMPLETE is not taken.
 */
import { runQuest, type Quest } from './lib/run-quest';
import type { Need } from './lib/sources';
import { amuletItems, arm, awowogeiMission, FIGHT_WANTS, topUp, type Want, deliverMonkey, garkorSigil, greegreeItems, homeOnFoot, journalProse, jungleDemon, leaveAtoll, meetGarkor, seekAlliance, toAtoll, zooMonkey } from './lib/ape-atoll';
import { inTreeRoots, leaveGrandTreeArea, talkNarnode } from './lib/grand-tree';
import { daeroInHangar, daeroToHangar, flyToCrashIsland, getOrders, investigateShipyard, OBJ, reinitialise, startQuest, onApeAtoll, onCrashIsland, toApeAtoll, held, worn } from './lib/monkey-madness';

const stage = (id: string, kind: 'unstarted' | 'active' | 'complete', all: string[], none: string[] = [], optional = false) => ({
    id,
    optional,
    rule: { id: `mm:${id}`, kind, all, none },
});

const here = (q: Quest) => {
    const p = q.sdk.getState()?.player;
    return { x: p?.worldX ?? 0, z: p?.worldZ ?? 0, level: p?.level ?? 0 };
};
/** On the atoll (or on the way): the kit is whatever we carry; from the mainland it comes out of the bank. */
const offshore = (q: Quest) => onApeAtoll(here(q)) || onCrashIsland(here(q));
/** Ape Atoll as a human: Protect from Melee/Missiles, food, a weapon for the cave's mobs and the temple guards. */
const FIGHT: Need[] = [
    { item: 'melee weapon', count: 1 },
    { item: 'shark', count: 11 },
    { item: 'prayer potion', count: 5 },
    { item: 'antipoison(3)', count: 1 },
];
/** Set once a chapter 2-4 step runs: from then on topUp restocks, not the transition's needs (a death mid-run). */
let underway = false;
const kit = (extra: Need[]) => (q: Quest) => (underway || offshore(q) ? [] : [...FIGHT, ...extra]);
/** Quest items a restock also fetches when they are still to be used. */
const questWants = (q: Quest): Want[] => [
    { re: /^gold bar$/i, count: 1, min: 0, label: 'gold bar' },
    { re: /^ball of wool$/i, count: 1, min: held(q, OBJ.amulet) || worn(q, OBJ.amulet) ? 0 : 1, label: 'ball of wool' },
    { re: /^banana$/i, count: 5, min: 0, label: 'banana' },
    { re: /^monkey bones$/i, count: 1, min: held(q, OBJ.greegree) || worn(q, OBJ.greegree) ? 0 : 1, label: 'monkey bones' },
];
/** A step on the atoll: restock at the Grand Tree bank when low, then (back) to the atoll, then the step. */
const onAtoll = (step: (q: Quest) => Promise<void>, wants: (q: Quest) => Want[] = () => FIGHT_WANTS) => async (q: Quest) => {
    underway = true;
    await topUp(q, wants(q));
    await toAtoll(q);
    await arm(q);
    try {
        await step(q);
    } catch (e) {
        // Out of food (or the Aunt's jail ate the step's time): the transition's next attempt restocks first.
        if (!/out of food and prayer|no talisman from the monkey child|village walk|still boxed in|not down the temple trapdoor|no knockout at the ravine|still in the jail|needs monkey bones again/i.test((e as Error).message)) throw e;
        q.log(`${(e as Error).message} — retrying the step after a restock`);
    }
};
const ch2Wants = (q: Quest) => [...FIGHT_WANTS, ...questWants(q)];
const AMULET_ITEMS: Need[] = [
    { item: 'gold bar', count: 1 },
    { item: 'ball of wool', count: 1 },
    { item: 'banana', count: 5 },
    { item: 'monkey bones', count: 1 },
];
const missionGiven = async (q: Quest) => /asked to rescue one of the|rescued one of the monkeys/i.test(await journalProse(q));
const GREEGREE_ITEMS: Need[] = [
    { item: 'ball of wool', count: 1 },
    { item: 'banana', count: 5 },
    { item: 'monkey bones', count: 1 },
];

await runQuest({
    id: 'mm',
    hub: 'ardougne',
    requires: ['The Grand Tree', 'Tree Gnome Village'],
    carry: [OBJ.seal, OBJ.dentures, OBJ.mould, OBJ.enchantedBar, OBJ.amuletUnstrung, OBJ.amulet, OBJ.talisman, OBJ.greegree, OBJ.backpackMonkey, OBJ.sigil],
    // Resumed on Ape Atoll or Crash Island: carry on from there (the way home and back is a jail escape,
    // Lumdo, Waydar, Daero and Waydar again); on the mainland bank at the hub as usual.
    // The demon fight banks first: its kit comes out of the bank and the sigil works from anywhere.
    noHubWhere: (p, stage) => stage !== 'sigil' && (onApeAtoll(p) || onCrashIsland(p)),
    journal: { label: 'Monkey Madness', title: 'Monkey Madness' },
    // An atoll step that runs short of food gives up and restocks on its retry (lib/ape-atoll.ts topUp);
    // the monkey child's Aunt jails us a few times before the talisman.
    retries: 8,
    stages: [
        stage('unstarted', 'unstarted', ['To start this quest I must check how']),
        stage('seal', 'active', ['Narnode has given me a copy of the Royal Seal'], ['I have investigated the Karamjan shipyard', 'Chapter 2:']),
        stage('shipyard', 'active', ['I have investigated the Karamjan shipyard'], ['handwritten orders', 'Chapter 2:']),
        stage('orders', 'active', ['Narnode has given me some handwritten orders'], ['I have taken the orders to Daero', 'Chapter 2:']),
        stage('daero', 'active', ['I have taken the orders to Daero'], ['Underground Military Glider Hangar', 'Chapter 2:'], true),
        stage('hangar', 'active', ['Underground Military Glider Hangar'], ['reinitialisation', 'Chapter 2:']),
        stage('reinit', 'active', ['until reinitialisation has been'], ['Chapter 2:']),
        stage('reinitDone', 'active', ['I have completed reinitialisation'], ['Waydar and I landed', 'Chapter 2:']),
        stage('crash', 'active', ['Waydar and I landed'], ['Chapter 2:']),
        stage('atoll', 'active', ['Chapter 2:'], ['I found Sergeant Gakor', 'I have made contact with the rest']),
        stage('garkor', 'active', ['I found Sergeant Gakor'], ['I found Zooknock', 'I have made contact with the rest']),
        stage('zooknock', 'active', ['I found Zooknock'], ['I am collecting items for', 'I have made contact with the rest'], true),
        stage('items', 'active', ['For the monkey amulet I still need to give him'], ['I have made contact with the rest']),
        stage('amulet', 'active', ['For the monkey amulet I needed to give him'], ['I have made contact with the rest']),
        stage('ch3', 'active', ['Chapter 3:'], ['Garkor wants me to seek audience', 'managed to slay']),
        stage('seek', 'active', ['Garkor wants me to seek audience'], ['asked to rescue one of the', 'rescued one of the monkeys', 'managed to slay']),
        stage('mission', 'active', ['asked to rescue one of the'], ['managed to slay']),
        stage('rescued', 'active', ['rescued one of the monkeys'], ['given me a sigil', 'managed to slay']),
        stage('sigil', 'active', ['given me a sigil'], ['managed to slay']),
        stage('demon', 'active', ['I must now report to'], ['QUEST COMPLETE']),
        stage('complete', 'complete', ['QUEST COMPLETE']),
    ],
    transitions: [
        { from: 'unstarted', to: 'seal', run: (q) => startQuest(q) },
        { from: 'seal', to: 'shipyard', run: (q) => investigateShipyard(q) },
        { from: 'shipyard', to: 'orders', run: (q) => getOrders(q) },
        { from: 'orders', to: 'hangar', run: (q) => daeroToHangar(q) },
        { from: 'daero', to: 'hangar', run: (q) => daeroToHangar(q) },
        {
            from: 'hangar',
            to: 'reinit',
            run: async (q) => {
                await daeroToHangar(q);
                await daeroInHangar(q);
            },
        },
        {
            from: 'reinit',
            to: 'reinitDone',
            run: async (q) => {
                await daeroToHangar(q);
                await reinitialise(q);
            },
        },
        { from: 'reinitDone', to: 'crash', needs: kit(AMULET_ITEMS), run: (q) => flyToCrashIsland(q) },
        { from: 'crash', to: 'atoll', needs: kit(AMULET_ITEMS), run: (q) => toApeAtoll(q) },
        // Into the village by the jail, Garkor's story.
        { from: 'atoll', to: 'garkor', needs: kit(AMULET_ITEMS), run: onAtoll(meetGarkor, ch2Wants) },
        // The warehouse's dentures, the cellar's mould, the beach, Zooknock's cave: the enchanted bar.
        { from: 'garkor', to: 'amulet', needs: kit(AMULET_ITEMS), run: onAtoll(amuletItems, ch2Wants) },
        { from: 'zooknock', to: 'amulet', needs: kit(AMULET_ITEMS), run: onAtoll(amuletItems, ch2Wants) },
        { from: 'items', to: 'amulet', needs: kit(AMULET_ITEMS), run: onAtoll(amuletItems, ch2Wants) },
        // The temple's wall of flame, the monkey child's talisman, Zooknock's greegree (chapter 3 cutscene).
        { from: 'amulet', to: 'ch3', needs: kit(GREEGREE_ITEMS), run: onAtoll(greegreeItems, ch2Wants) },
        // Chapter 3: a Karamja monkey (greegree + amulet worn: guards and archers leave us alone).
        { from: 'ch3', to: 'seek', needs: kit([]), run: onAtoll(seekAlliance) },
        { from: 'seek', to: 'mission', needs: kit([]), run: onAtoll((q) => awowogeiMission(q, () => missionGiven(q))) },
        {
            from: 'mission',
            to: 'rescued',
            needs: kit([]),
            run: async (q) => {
                underway = true;
                await zooMonkey(q);
                await homeOnFoot(q);
                await toAtoll(q);
                await deliverMonkey(q);
            },
        },
        // Chapter 4: Garkor's cutscene and the sigil, then the Jungle Demon from the bank.
        { from: 'rescued', to: 'sigil', needs: kit([]), run: onAtoll(garkorSigil) },
        // The demon's kit is fetched from the bank by the step itself (lib/ape-atoll.ts restock): carried from
        // the start it left no room for the chapter 2 items (28 slots).
        { from: 'sigil', to: 'demon', needs: [{ item: 'melee weapon', count: 1 }], run: (q) => jungleDemon(q) },
        {
            from: 'demon',
            to: 'complete',
            run: async (q) => {
                await leaveAtoll(q);
                // Narnode's reward: 10,000 coins and 3 diamonds need 3 free slots.
                for (let i = 0; i < 6 && q.sdk.getInventory().length > 25; i++) {
                    const junk = q.sdk.getInventory().find((it) => /^(shark|vial|monkey greegree|gnome royal seal)$/i.test(it.name));
                    if (!junk) break;
                    await q.sdk.sendDropItem(junk.slot);
                    await q.sdk.waitForTicks(1);
                }
                await talkNarnode(q, [/.*/]);
                // His reward talk can leave us in the roots under the tree (2464,9897): up its ladder.
                if (inTreeRoots(here(q))) await leaveGrandTreeArea(q);
            },
        },
    ],
});
