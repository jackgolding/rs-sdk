/**
 * Death Plateau — the stone-ball combination and a secret way up for Denulth.
 *
 *   bun bots/quests/death-plateau.ts {botname}
 *
 * Journal rules from quest_death/scripts/death_journal.rs2. The quest has two
 * strands (the equipment room, the secret way) whose texts the journal stacks,
 * so this port does them one after the other: every stage below adds a phrase
 * the earlier ones never show, and the runner tries the later rules first.
 * Dialog from quest_death/scripts/*.rs2 (Denulth, Eohric, Harold, Saba,
 * Tenzing, Dunstan). Items:
 *   - asgarnian ale       lib/sources.ts (Tostig, the Toad and Chicken)
 *   - blurberry special   mule stock (premade; makes Harold drunk so every roll wins)
 *   - iron bar, bread ×10, trout ×10   mule stock
 *   - coins               the dice stake (above Harold's 100gp purse)
 *   - IOU/combination, certificate, climbing/spiked boots, map: quest items
 * Burthorpe's buildings and the hand-made steps are lib/death-plateau.ts.
 */
import { runQuest } from './lib/run-quest';
import {
    DENULTH,
    DUNSTAN,
    gambleForIou,
    leaveAnywhere,
    placeBalls,
    readIou,
    scoutSecretWay,
    talkSaba,
    toEohric,
    toHarold,
    toTenzing,
} from './lib/death-plateau';

const HAROLD = /^harold$/i;
const EOHRIC = /^eohric$/i;
const STAKE = 500;

const stage = (id: string, kind: 'unstarted' | 'active' | 'complete', text: string) => ({ id, rule: { id: `death:${id}`, kind, all: [text] } });

await runQuest({
    id: 'death',
    hub: 'falador-east',
    // Denulth only finishes the quest with the map in the pack (death_ig_commander.rs2): a resumed
    // run had banked it and talked to him three times for nothing (ABGARMY08, 2026-10-30).
    carry: ['secret way map', 'combination', 'spiked boots', 'climbing boots'],
    journal: { label: 'Death Plateau', title: 'Death Plateau' },
    stages: [
        stage('unstarted', 'unstarted', 'I can start this quest by speaking to'),
        stage('started', 'active', 'another way'),
        stage('spoken_eohric', 'active', 'is staying at the local inn'),
        stage('spoken_harold', 'active', "wouldn't talk to me"),
        stage('eohric_drink', 'active', 'says to buy the'),
        stage('given_ale', 'active', 'I bought the guard a drink'),
        stage('given_iou', 'active', 'gambled with the guard'),
        stage('found_combo', 'active', 'IOU was written on the back'),
        stage('unlocked', 'active', 'stone balls in the right places'),
        stage('spoken_saba', 'active', 'there is a sherpa'),
        stage('spoken_tenzing', 'active', "I found the sherpa's house"),
        stage('spoken_dunstan', 'active', 'if I get his son signed up'),
        stage('got_cert', 'active', 'gave me a certificate'),
        stage('gave_cert', 'active', 'I have given Dunstan the certificate'),
        stage('got_map', 'active', 'has given me a map of the secret way'),
        stage('scouted', 'active', 'I should go and tell'),
        stage('complete', 'complete', 'QUEST COMPLETE'),
    ],
    transitions: [
        { from: 'unstarted', to: 'started', at: DENULTH, talk: { npc: /^denulth$/i, choices: [/any quests for me/i, /perhaps i could try and find one/i] } },
        {
            from: 'started',
            to: 'spoken_eohric',
            run: async (q) => {
                await toEohric(q);
                await q.talk(EOHRIC, [/guard that was on last night/i]);
            },
        },
        {
            from: 'spoken_eohric',
            to: 'spoken_harold',
            run: async (q) => {
                await toHarold(q);
                await q.talk(HAROLD, [/guard that was on duty last night/i]);
            },
        },
        {
            from: 'spoken_harold',
            to: 'eohric_drink',
            run: async (q) => {
                await toEohric(q);
                await q.talk(EOHRIC);
            },
        },
        {
            from: 'eohric_drink',
            to: 'given_ale',
            needs: [
                { item: 'asgarnian ale', count: 1 },
                { item: 'blurberry special', count: 1 },
                { item: 'coins', count: STAKE },
            ],
            run: async (q) => {
                await toHarold(q);
                await q.talk(HAROLD);
            },
        },
        {
            from: 'given_ale',
            to: 'given_iou',
            needs: [
                { item: 'blurberry special', count: 1 },
                { item: 'coins', count: STAKE },
            ],
            run: async (q) => {
                await toHarold(q);
                // harold_drink2: at given_ale he asks for a Blurberry Special and drinks it.
                await q.talk(HAROLD, [/buy you a drink/i]);
                await gambleForIou(q, STAKE);
            },
        },
        { from: 'given_iou', to: 'found_combo', run: (q) => readIou(q) },
        { from: 'found_combo', to: 'unlocked', run: (q) => placeBalls(q) },
        { from: 'unlocked', to: 'spoken_saba', run: (q) => talkSaba(q) },
        {
            from: 'spoken_saba',
            to: 'spoken_tenzing',
            run: async (q) => {
                await toTenzing(q);
                await q.talk(/^tenzing$/i, [/ok, i'll get those for you/i]);
            },
        },
        {
            from: 'spoken_tenzing',
            to: 'spoken_dunstan',
            run: async (q) => {
                await leaveAnywhere(q);
                await q.talk(/^dunstan$/i, [], DUNSTAN);
            },
        },
        {
            from: 'spoken_dunstan',
            to: 'got_cert',
            run: async (q) => {
                await leaveAnywhere(q);
                await q.talk(/^denulth$/i, [], DENULTH);
            },
        },
        {
            from: 'got_cert',
            to: 'gave_cert',
            needs: [{ item: 'iron bar', count: 1 }],
            run: async (q) => {
                await leaveAnywhere(q);
                await q.talk(/^dunstan$/i, [], DUNSTAN);
            },
        },
        {
            from: 'gave_cert',
            to: 'got_map',
            needs: [
                { item: 'bread', count: 10 },
                { item: 'trout', count: 10 },
                // Spare bar for re-spiking: a resumed run that lost the spiked boots gets plain
                // climbing boots from Tenzing (death_sherpa.rs2) and Dunstan needs a bar again.
                { item: 'iron bar', count: 1 },
            ],
            run: async (q) => {
                await toTenzing(q);
                await q.talk(/^tenzing$/i);
                if (q.count('spiked boots') > 0 || q.count('climbing boots') === 0) return;
                q.log('Tenzing handed out new climbing boots; Dunstan re-spikes them');
                await leaveAnywhere(q);
                await q.talk(/^dunstan$/i, [], DUNSTAN);
                if (q.count('spiked boots') === 0) return;
                await toTenzing(q);
                await q.talk(/^tenzing$/i);
            },
        },
        {
            from: 'got_map',
            to: 'scouted',
            run: async (q) => {
                const zone = () => {
                    const p = q.sdk.getState()?.player;
                    return (p?.worldX ?? 0) >= 2864 && (p?.worldX ?? 0) <= 2871 && (p?.worldZ ?? 0) >= 3608 && (p?.worldZ ?? 0) <= 3615;
                };
                await scoutSecretWay(q, zone);
            },
        },
        {
            from: 'scouted',
            to: 'complete',
            run: async (q) => {
                // Map lost (not held or banked): Tenzing draws another (death_sherpa.rs2), else Denulth
                // only says "I don't have the map on me" (jacklove7, 6 attempts, 2026-11-05).
                if (q.count('secret way map') === 0) {
                    q.log('no secret way map — Tenzing draws another');
                    await toTenzing(q);
                    await q.talk(/^tenzing$/i);
                }
                // Denulth also takes the combination (death_ig_commander.rs2 denulth_has_map): lost,
                // Harold writes another (harold_reclaim_iou) — jacklove7 held the map only, 2026-11-05.
                if (q.count('combination') === 0) {
                    q.log('no combination — Harold writes another IOU');
                    await leaveAnywhere(q);
                    await toHarold(q);
                    await q.talk(HAROLD);
                }
                await leaveAnywhere(q);
                await q.talk(/^denulth$/i, [], DENULTH);
            },
        },
    ],
});
