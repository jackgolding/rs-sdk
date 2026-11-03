/**
 * Shield of Arrav — a PAIR of accounts, one in each gang, each ending with its own certificate.
 *
 *   bun bots/quests/shield-of-arrav.ts {phoenixbot} --gang=phoenix  --partner={blackarmbot}
 *   bun bots/quests/shield-of-arrav.ts {blackarmbot} --gang=blackarm --partner={phoenixbot}
 *
 * Run both at once (either order; each waits for the other at the trades, ~30 min max on the
 * prod clock per hand-off, then fails and resumes on its next run). Mechanics and coordinates:
 * lib/shield-of-arrav.ts. The hand-offs, all at Varrock square:
 *   1. Phoenix -> Black Arm: two Phoenix crossbows (the Phoenix account opens the weapon store
 *      with Straven's key and kills the Weaponsmaster) — Katrine's price for joining.
 *   2. Black Arm -> Phoenix: the Black Arm half (the cupboard upstairs in its house).
 *   3. Phoenix -> Black Arm: one of the curator's two certificates.
 * Each account then hands its certificate to King Roald.
 *
 * Journal rules from quests/quest_blackarmgang/scripts/blackarmgang_journal.rs2. Each gang has its
 * own section and its own stages (prefixed p_/b_); a section is hidden once the account has
 * joined the other gang. The later stages are keyed on what the account HOLDS (the journal
 * prints by inv_total): the shield halves, the crossbows and the certificates. So a resumed run
 * must have them back out of the bank before the stage is read — `carry` (one of each) and
 * `bankOpen(...)` needs (two crossbows, two certificates) below.
 *
 * An account already in the other gang cannot take this side: its journal matches no stage
 * here and the run stops at "could not read the quest stage".
 */
import { runQuest, type Need, type Quest, type StageDef, type Transition } from './lib/run-quest';
import {
    askReldoAgain,
    askTramp,
    blackArmJoined,
    blackArmSwap,
    bribeBaraek,
    claimReward,
    crossbowsToKatrine,
    giveCert,
    joinKatrine,
    killJonny,
    meetStraven,
    OBJ,
    publish,
    phoenixSwap,
    readBook,
    receiveCrossbows,
    reportToStraven,
    searchChest,
    startAtReldo,
    toCurator,
    type Gang,
    type Pair,
} from './lib/shield-of-arrav';

const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const account = process.argv.slice(2).find((a) => !a.startsWith('-')) ?? process.env.BOT_USERNAME ?? '';
const gang = arg('gang') as Gang | undefined;
const partner = arg('partner') ?? '';
if ((gang !== 'phoenix' && gang !== 'blackarm') || !partner || !account || partner.toLowerCase() === account.toLowerCase()) {
    console.error('usage: bun bots/quests/shield-of-arrav.ts {account} --gang=phoenix|blackarm --partner={other account}');
    process.exit(2);
}
const pair: Pair = { account, gang, partner };

const stage = (id: string, kind: 'unstarted' | 'active' | 'complete', all: string[], none: string[] = [], optional = false): StageDef => ({
    id,
    rule: { id: `arrav:${id}`, kind, all, none },
    ...(optional ? { optional: true } : {}),
});
/** Off this script's route (another start, a key, the reverse hand-off): detected on resume, never required. */
const offRoute = (id: string, kind: 'unstarted' | 'active', all: string[], none: string[] = []) => stage(id, kind, all, none, true);

/**
 * Needs that exist only while the prologue's bank is open: it withdraws up to `count` of a quest
 * item a resumed run banked (carry takes one of each), and the transition never tries to source
 * it (there is none) once the bank is shut.
 */
const bankOpen =
    (...needs: Need[]) =>
    (q: Quest): Need[] =>
        q.sdk.isBankOpen() ? needs : [];
const CROSSBOWS = bankOpen({ item: 'phoenix crossbow', count: 2 });
const CERTS = bankOpen({ item: 'certificate', count: 2 });

// Shared tail: the item-keyed sections read the same in both gangs (each in its own section).
const tail = (p: string) => [
    // The Black Arm side never holds both halves on this route (it hands its half over).
    stage(`${p}_both`, 'active', ['also found a\\s+Shield Half\\s+and gave it to', "see if they're genuine"], [], p === 'b'),
    stage(`${p}_certs2`, 'active', ['should now give\\s+one to a'], [], p === 'b'),
    stage(`${p}_cert1`, 'active', ['gave us a\\s+Certificate\\s+each']),
    stage('complete', 'complete', ['QUEST COMPLETE']),
];

const PHOENIX: { stages: StageDef[]; transitions: Transition[] } = {
    stages: [
        stage('p_unstarted', 'unstarted', ['I can start this quest by speaking to']),
        // Started on the Black Arm side only (the tramp; not yet Katrine's offer, whose line
        // persists): none of our own lines yet.
        offRoute('p_other_side', 'unstarted', [], ['I can start this quest', 'says there is a', 'Reldo told me', 'anything more about this', 'Baraek told me', 'spoke to Katrine in the Black Arm', 'QUEST COMPLETE']),
        stage('p_started', 'active', ['says there is a\\s+quest\\s+hidden']),
        stage('p_read_book', 'active', ['if he knows anything more about this']),
        stage('p_spoken_reldo', 'active', ['I should speak to\\s+him next']),
        stage('p_spoken_baraek', 'active', ['I should find them and join']),
        stage('p_straven', 'active', ['I can find\\s+Jonny\\s+in the\\s+Blue Moon Inn']),
        stage('p_report', 'active', ['should take this\\s+Report\\s+to\\s+Straven']),
        stage('p_joined', 'active', ['Gang Headquarters\\s+for the\\s+Shield of Arrav']),
        stage('p_half1', 'active', ['see if a\\s+Fellow Adventurer\\s+can find the other']),
        ...tail('p'),
    ],
    transitions: [
        { from: 'p_unstarted', to: 'p_started', run: startAtReldo },
        { from: 'p_other_side', to: 'p_started', run: startAtReldo },
        { from: 'p_started', to: 'p_read_book', run: readBook },
        { from: 'p_read_book', to: 'p_spoken_reldo', run: askReldoAgain },
        { from: 'p_spoken_reldo', to: 'p_spoken_baraek', needs: [{ item: 'coins', count: 20 }], run: bribeBaraek },
        { from: 'p_spoken_baraek', to: 'p_straven', run: meetStraven },
        { from: 'p_straven', to: 'p_report', run: killJonny },
        { from: 'p_report', to: 'p_joined', run: reportToStraven },
        { from: 'p_joined', to: 'p_half1', needs: CROSSBOWS, run: searchChest },
        { from: 'p_half1', to: 'p_both', needs: CROSSBOWS, run: (q) => phoenixSwap(q, pair) },
        { from: 'p_both', to: 'p_certs2', run: toCurator },
        { from: 'p_certs2', to: 'p_cert1', needs: CERTS, run: (q) => giveCert(q, pair) },
        { from: 'p_cert1', to: 'complete', needs: CERTS, run: claimReward },
    ],
};

const BLACKARM: { stages: StageDef[]; transitions: Transition[] } = {
    stages: [
        stage('b_unstarted', 'unstarted', ['I can start this quest by speaking to']),
        // Started on the Phoenix side only (Reldo, not yet past Straven's offer): no tramp line yet.
        offRoute('b_other_side', 'unstarted', [], ['I can start this quest', 'spoke to the Tramp', 'spoke to Straven', 'QUEST COMPLETE']),
        stage('b_started', 'active', ['(He directed me to speak to\\s+Katrine|speak to their\\s+leader, Katrine)']),
        stage('b_katrine', 'active', ['seek help by asking a\\s+Fellow Adventurer']),
        offRoute('b_key', 'active', ['should now be able to steal the\\s+Crossbows']),
        stage('b_crossbows', 'active', ['should now return them to\\s+Katrine']),
        stage('b_joined', 'active', ['Gang Headquarters\\s+for the\\s+Shield of Arrav']),
        stage('b_half2', 'active', ['see if a\\s+Fellow Adventurer\\s+can find the other']),
        ...tail('b'),
    ],
    transitions: [
        { from: 'b_unstarted', to: 'b_started', run: askTramp },
        { from: 'b_other_side', to: 'b_started', run: askTramp },
        { from: 'b_started', to: 'b_katrine', run: joinKatrine },
        { from: 'b_katrine', to: 'b_crossbows', needs: CROSSBOWS, run: (q) => receiveCrossbows(q, pair) },
        // A key from somewhere (not this script's route): the crossbows still come from the partner.
        { from: 'b_key', to: 'b_crossbows', needs: CROSSBOWS, run: (q) => receiveCrossbows(q, pair) },
        { from: 'b_crossbows', to: 'b_joined', needs: CROSSBOWS, run: crossbowsToKatrine },
        // -> b_half2 (the cupboard), or straight to b_cert1 when the partner already has our half.
        { from: 'b_joined', to: 'b_half2', needs: CERTS, run: (q) => blackArmJoined(q, pair) },
        { from: 'b_half2', to: 'b_cert1', needs: CERTS, run: (q) => blackArmSwap(q, pair) },
        { from: 'b_both', to: 'b_certs2', run: toCurator },
        {
            from: 'b_certs2',
            to: 'b_cert1',
            needs: CERTS,
            run: async () => {
                throw new Error('arrav: the Black Arm account holds both certificates; the Phoenix side only ever gives one — hand one over by hand');
            },
        },
        { from: 'b_cert1', to: 'complete', needs: CERTS, run: claimReward },
    ],
};

const side = gang === 'phoenix' ? PHOENIX : BLACKARM;
// Every transition publishes the stage first, so the partner's logs (and its hand-off checks)
// see where this account is all along, not only at the trades.
const transitions = side.transitions.map((t) => ({
    ...t,
    run: async (q: Quest) => {
        publish(q, pair);
        await t.run?.(q);
    },
}));

await runQuest({
    id: 'shield-of-arrav',
    hub: 'varrock-west',
    // The Phoenix side kills Jonny the Beard (lvl 2) and the Weaponsmaster (lvl 23, 20hp) naked.
    skills: gang === 'phoenix' ? { attack: 20, strength: 20, defence: 20, hitpoints: 20 } : undefined,
    // One of each; the journal reads the pack (see above). Crossbows and certificates come in twos.
    carry: [OBJ.key, OBJ.report, OBJ.half1, OBJ.half2, OBJ.certificate],
    journal: { label: 'Shield of Arrav', title: 'Shield of Arrav' },
    // Pairs: both halves of a pair must hold a slot at once, and Jonny, the Weaponsmaster and the
    // two crossbow spawns are single.
    maxConcurrent: 4,
    stages: side.stages,
    transitions,
});
