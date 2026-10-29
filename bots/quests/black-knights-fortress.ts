/**
 * Black Knights' Fortress — spy on the Black Knights for Sir Amik Varze.
 *
 *   bun bots/quests/black-knights-fortress.ts {botname}
 *
 * Journal rules from quest_blackknight/scripts/blackknight_journal.rs2 (each
 * later text keeps the earlier ones struck through, so the runner tries the later
 * rules first); dialog from area_falador/scripts/sir_amik_varze.rs2 ("I seek a
 * quest!" then "I laugh in the face of danger!"; needs 12 quest points). Items:
 *   - bronze med helm, iron chainbody  lib/sources.ts (Peksa, Wayne); worn as the
 *                                      guard disguise the fortress door checks
 *   - cabbage                          lib/sources.ts (Edgeville monastery garden)
 * The fortress interior — grill, hole, ladders and doors — is lib/fortress.ts.
 */
import { runQuest, type Quest } from './lib/run-quest';
import { cabbageDownHole, leaveFortress, listenAtGrill, wearDisguise } from './lib/fortress';
import { untilTicks } from './lib/ticks';

/** White Knights' Castle: the ground-floor spiral stairs (2954,3338), then (2960,3338) on L1 up to Sir Amik's floor. */
const CASTLE_STAIRS = { x: 2956, z: 3338 };
const AMIK = /^sir amik varze$/i;

async function goToAmik(q: Quest): Promise<void> {
    if ((q.sdk.getState()?.player?.level ?? 0) !== 2) {
        if ((q.sdk.getState()?.player?.level ?? 0) === 0) await q.goTo(CASTLE_STAIRS, 2);
        await q.climbTo(2);
    }
    if (!(await untilTicks(q.sdk, (s) => (s.nearbyNpcs ?? []).some((n) => AMIK.test(n.name)), 15))) q.log('Sir Amik not in view on his floor');
}

const HELM = { item: 'bronze med helm', count: 1 };
const CHAIN = { item: 'iron chainbody', count: 1 };
const CABBAGE = { item: 'cabbage', count: 1 };

const stage = (id: string, kind: 'unstarted' | 'active' | 'complete', all: string[], none: string[] = []) => ({
    id,
    rule: { id: `fortress:${id}`, kind, all, ...(none.length ? { none } : {}) },
});

await runQuest({
    id: 'fortress',
    hub: 'falador-east',
    journal: { label: "Black Knight's Fortress", title: "Black Knight's Fortress" },
    stages: [
        stage('unstarted', 'unstarted', ['I can start this quest', '12 Quest Points']),
        stage('started', 'active', ['Ice Mountain']),
        stage('eavesdropped', 'active', ['destroyed with a normal'], ['Now that I have sabotaged', 'QUEST COMPLETE']),
        stage('sabotaged', 'active', ['Now that I have sabotaged'], ['QUEST COMPLETE']),
        stage('complete', 'complete', ['QUEST COMPLETE']),
    ],
    transitions: [
        {
            from: 'unstarted',
            to: 'started',
            run: async (q) => {
                await goToAmik(q);
                await q.talk(AMIK, [/i seek a quest/i, /laugh in the face of danger/i]);
            },
        },
        {
            from: 'started',
            to: 'eavesdropped',
            // The cabbage is listed here too so prepare picks it on the same trip north.
            needs: [HELM, CABBAGE, CHAIN],
            run: async (q) => {
                await wearDisguise(q);
                await listenAtGrill(q);
            },
        },
        {
            from: 'eavesdropped',
            to: 'sabotaged',
            needs: [HELM, CHAIN, CABBAGE],
            run: async (q) => {
                await wearDisguise(q);
                await cabbageDownHole(q);
                await leaveFortress(q);
            },
        },
        {
            from: 'sabotaged',
            to: 'complete',
            run: async (q) => {
                await leaveFortress(q);
                await goToAmik(q);
                await q.talk(AMIK);
            },
        },
    ],
});
