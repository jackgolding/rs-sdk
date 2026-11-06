/**
 * Heroes' Quest — a PAIR of accounts, one from each Shield of Arrav gang.
 *
 *   bun bots/quests/heroes-quest.ts {phoenixbot} --gang=phoenix  --partner={blackarmbot}
 *   bun bots/quests/heroes-quest.ts {blackarmbot} --gang=blackarm --partner={phoenixbot}
 *
 * `--gang` is the gang the account finished Shield of Arrav in. Run both at once (either order;
 * each waits for the other at the Brimhaven hand-offs, ~100 min max on the prod clock while the
 * partner keeps publishing, then fails and resumes on its next run). Mechanics: lib/heroes-quest.ts.
 *
 * The armband, together, in Brimhaven:
 *   1. Black Arm -> Phoenix: Grip's Miscellaneous key (opens Pete's side door from the garden).
 *   2. The kill: the Phoenix side Fire-Bolts Grip through the side room's arrow slit while the
 *      Black Arm side keeps luring him to it with his drinks cabinet; the Black Arm side picks up
 *      his keyring, opens the treasure room and takes both candlesticks.
 *   3. Black Arm -> Phoenix: one candlestick. Each hands its own to its gang leader in Varrock.
 * Then each, alone: Ice gloves (Ice Queen) -> firebird feather (Entrana); Gerrant's slime ->
 * blamish oil -> oily rod -> lava eel (Taverley, Dusty key) -> cooked; all three to Achietties.
 *
 * Journal rules from quests/quest_hero/scripts/hero_journal.rs2. The gang section shows only the
 * account's own gang's lines; the item sections are keyed on what is held, worn or banked.
 */
import { runQuest, type Need, type Quest, type StageDef, type Transition } from './lib/run-quest';
import { arravGang } from './lib/quest-tags';
import { readJournalCheckpoint } from '../../quest-lab/journal-reader';
import {
    askAlfonse,
    askCharlie,
    askGerrant,
    askKatrine,
    askStraven,
    candleToKatrine,
    candleToStraven,
    catchEel,
    cookEel,
    firebirdFeather,
    handIn,
    iceGloves,
    killGrip,
    lootTreasure,
    OBJ,
    oilyRod,
    passwordToGrubor,
    pastGarv,
    publish,
    reportToGrip,
    settleCandle,
    startAtAchietties,
    volunteerToTrobert,
    type Gang,
    type Pair,
} from './lib/heroes-quest';

const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const account = process.argv.slice(2).find((a) => !a.startsWith('-')) ?? process.env.BOT_USERNAME ?? '';
// --gang may be left out: the Shield of Arrav tag says which side (lib/quest-tags.ts). A --gang that
// disagrees with the tag, or a partner tagged the same gang, is refused before any walking.
const onRecord = arravGang(account);
const gang = (arg('gang') as Gang | undefined) ?? onRecord;
const partner = arg('partner') ?? '';
if ((gang !== 'phoenix' && gang !== 'blackarm') || !partner || !account || partner.toLowerCase() === account.toLowerCase()) {
    console.error('usage: bun bots/quests/heroes-quest.ts {account} [--gang=phoenix|blackarm] --partner={other account} (gang defaults to the account\'s Shield of Arrav tag)');
    process.exit(2);
}
if (onRecord && onRecord !== gang) {
    console.error(`heroes-quest: ${account} did Shield of Arrav as ${onRecord} (quest-tags.json), not ${gang} — refusing`);
    process.exit(2);
}
if (arravGang(partner) === gang) {
    console.error(`heroes-quest: partner ${partner} is also tagged ${gang}; a pair needs one Phoenix and one Black Arm`);
    process.exit(2);
}
const pair: Pair = { account, gang: gang as Gang, partner };

const stage = (id: string, kind: 'unstarted' | 'active' | 'complete', all: string[], none: string[] = []): StageDef => ({
    id,
    rule: { id: `heroes:${id}`, kind, all, none },
});

/**
 * Fares: Port Sarim -> Karamja and back (30gp each), with spare; on the island only the fare
 * home (a flat 100 sent the account off the island to source coins after paying the first fare).
 */
const fares = (q: Quest): Need => {
    const p = q.sdk.getState()?.player;
    const onKaramja = !!p && p.worldX >= 2740 && p.worldX <= 2990 && p.worldZ >= 2880 && p.worldZ <= 3240;
    return { item: 'coins', count: onKaramja ? 30 : 100 };
};
const FEATHER = 'An Entranan firebird feather - I now have one';
/** The armband section once the gang leader has handed it over (varp-keyed, stays). */
const ARMBAND_DONE = gang === 'phoenix' ? 'he gave me a Master Thieves Armband to prove my skills' : 'reward she gave me a master thief';

// Shared tail (same text for both gangs, behind each gang's own armband line).
const p = gang === 'phoenix' ? 'p' : 'b';
const ITEM_STAGES: StageDef[] = [
    stage(`${p}_armband`, 'active', [ARMBAND_DONE]),
    stage(`${p}_gloves`, 'active', [ARMBAND_DONE, 'obtained ice gloves from the Ice Queen']),
    stage(`${p}_feather`, 'active', [ARMBAND_DONE, FEATHER]),
    stage(`${p}_slime`, 'active', [ARMBAND_DONE, FEATHER, "I can make an oily fishing rod with Gerrant's slime"]),
    stage(`${p}_rod`, 'active', [ARMBAND_DONE, FEATHER, 'I can catch a lava eel with my oily fishing rod']),
    stage(`${p}_raw`, 'active', [ARMBAND_DONE, FEATHER, 'I now have a raw lava eel']),
    stage(`${p}_items`, 'active', ['I have all required items']),
    stage('complete', 'complete', ['QUEST COMPLETE']),
];

/** The oil's inputs, unless a resumed run already has the oil or the unfinished potion. */
const OIL_NEEDS = (q: Quest): Need[] => {
    const has = (id: number) => q.sdk.getInventory().some((i) => i.id === id) || q.sdk.getBankItems().some((b) => b.id === id);
    if (has(OBJ.oilyRod)) return [];
    if (has(OBJ.blamishOil)) return [{ item: 'fishing rod', count: 1 }];
    if (has(OBJ.unfinished)) return [{ item: 'fishing rod', count: 1 }];
    return [
        { item: 'harralander', count: 1 },
        { item: 'vial of water', count: 1 },
        { item: 'fishing rod', count: 1 },
    ];
};

const ITEM_TRANSITIONS: Transition[] = [
    {
        from: `${p}_armband`,
        to: `${p}_gloves`,
        // Fares too: a Phoenix partner still owed its candlestick gets it in Brimhaven first.
        needs: (q) => [{ item: 'melee weapon', count: 1 }, { item: 'pickaxe', count: 1 }, { item: 'shark', count: 10 }, ...(gang === 'blackarm' ? [fares(q)] : [])],
        run: async (q) => {
            await settleCandle(q, pair);
            await iceGloves(q);
        },
    },
    { from: `${p}_gloves`, to: `${p}_feather`, run: firebirdFeather },
    { from: `${p}_feather`, to: `${p}_slime`, run: askGerrant },
    { from: `${p}_slime`, to: `${p}_rod`, needs: OIL_NEEDS, run: oilyRod },
    {
        from: `${p}_rod`,
        to: `${p}_raw`,
        needs: [
            { item: 'fishing bait', count: 20 },
            { item: 'dragonbreath shield', count: 1 },
            { item: 'melee weapon', count: 1 },
            { item: 'shark', count: 10 },
        ],
        run: catchEel,
    },
    { from: `${p}_raw`, to: `${p}_items`, run: cookEel },
    { from: `${p}_items`, to: 'complete', run: (q) => handIn(q, pair.gang) },
];

const PHOENIX: { stages: StageDef[]; transitions: Transition[] } = {
    stages: [
        stage('unstarted', 'unstarted', ['I can start this quest by speaking to']),
        stage('p_started', 'active', ['I worked with the Phoenix Gang'], ['I spoke to Straven about the Master']),
        stage('p_straven', 'active', ['I should use the password he gave me at']),
        stage('p_alfonse', 'active', ['He said I should speak to']),
        stage('p_charlie', 'active', ['help me get through this']),
        stage('p_grip', 'active', ['As soon as they have given me my']),
        ...ITEM_STAGES,
    ],
    transitions: [
        { from: 'unstarted', to: 'p_started', run: startAtAchietties },
        { from: 'p_started', to: 'p_straven', run: askStraven },
        { from: 'p_straven', to: 'p_alfonse', needs: (q) => [fares(q)], run: askAlfonse },
        { from: 'p_alfonse', to: 'p_charlie', needs: (q) => [fares(q)], run: askCharlie },
        {
            from: 'p_charlie',
            to: 'p_grip',
            needs: (q) => [fares(q), { item: 'fire staff', count: 1 }, { item: 'air rune', count: 90 }, { item: 'chaos rune', count: 30 }],
            // Done only on OUR credit (grip.rs2 gives it to whoever Grip was fighting, the keyring drops for anyone).
            run: (q) => killGrip(q, pair, async () => {
                const rule = PHOENIX.stages.find((st) => st.id === 'p_grip')!.rule;
                const read = await readJournalCheckpoint(q.sdk, { label: "Hero's Quest", title: "Heroes' Quest" }, rule);
                await q.sdk.sendCloseModal().catch(() => undefined);
                return read.verdict?.verdict === 'PASS';
            }),
        },
        { from: 'p_grip', to: 'p_armband', needs: (q) => [fares(q)], run: (q) => candleToStraven(q, pair) },
        ...ITEM_TRANSITIONS,
    ],
};

/** Both candlesticks come back out of the bank on a resumed run (carry takes one). */
const CANDLES = (q: Quest): Need[] => (q.sdk.isBankOpen() ? [{ item: "pete's candlestick", count: 2 }] : []);

const BLACKARM: { stages: StageDef[]; transitions: Transition[] } = {
    stages: [
        stage('unstarted', 'unstarted', ['I can start this quest by speaking to']),
        stage('b_started', 'active', ['the leader of the Black Arm Gang']),
        stage('b_katrine', 'active', ['I should say the password she gave me']),
        stage('b_door', 'active', ['I should speak to other gang members in the hideout']),
        stage('b_papers', 'active', ['I need to disguise myself as']),
        stage('b_mansion', 'active', ['Now I need to present myself to']),
        stage('b_grip', 'active', ['help me discreetly defeat']),
        stage('b_chest', 'active', ['After rewarding the player who assisted me']),
        ...ITEM_STAGES,
    ],
    transitions: [
        { from: 'unstarted', to: 'b_started', run: startAtAchietties },
        { from: 'b_started', to: 'b_katrine', run: askKatrine },
        { from: 'b_katrine', to: 'b_door', needs: (q) => [fares(q)], run: passwordToGrubor },
        { from: 'b_door', to: 'b_papers', needs: (q) => [fares(q)], run: volunteerToTrobert },
        {
            from: 'b_papers',
            to: 'b_mansion',
            needs: (q) => [fares(q), { item: 'black full helm', count: 1 }, { item: 'black platebody', count: 1 }, { item: 'black platelegs', count: 1 }],
            run: pastGarv,
        },
        { from: 'b_mansion', to: 'b_grip', needs: (q) => [fares(q)], run: reportToGrip },
        { from: 'b_grip', to: 'b_chest', needs: (q) => [fares(q)], run: (q) => lootTreasure(q, pair) },
        { from: 'b_chest', to: 'b_armband', needs: (q) => [fares(q), ...CANDLES(q)], run: (q) => candleToKatrine(q, pair) },
        ...ITEM_TRANSITIONS,
    ],
};

const side = gang === 'phoenix' ? PHOENIX : BLACKARM;
// Every transition publishes the stage first, so the partner sees where this account is.
const transitions = side.transitions.map((t) => ({
    ...t,
    run: async (q: Quest) => {
        publish(q, pair);
        await t.run?.(q);
    },
}));

await runQuest({
    id: 'heroes-quest',
    hub: 'falador-west',
    // Mining 50 is the Ice Queen's rockslide; mining has a trainer (lib/training.ts), the rest gate the run.
    skills: { mining: 50, herblore: 25, fishing: 53, cooking: 53, ...(gang === 'phoenix' ? { magic: 35 } : {}) },
    // Quest items a resumed run banked (one of each; the journal reads the bank anyway).
    carry: [
        OBJ.idPapers,
        OBJ.miscKey,
        OBJ.gripKeys,
        OBJ.candlestick,
        OBJ.armband,
        OBJ.iceGloves,
        OBJ.feather,
        OBJ.slime,
        OBJ.unfinished,
        OBJ.blamishOil,
        OBJ.oilyRod,
        OBJ.dustyKey,
        OBJ.rawEel,
        OBJ.eel,
    ],
    journal: { label: "Hero's Quest", title: "Heroes' Quest" },
    // Pairs: both halves need a slot at once; Grip, the Ice Queen and the firebird are single.
    maxConcurrent: 6, // three pairs: a half waiting on a partner holds a slot (ABGARMY10 waited while ABGARMY08 was deferred at 4, 2026-11-03)
    stages: side.stages,
    transitions,
});
