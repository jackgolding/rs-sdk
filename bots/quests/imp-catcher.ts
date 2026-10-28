/**
 * Imp Catcher — four beads from imps for Wizard Mizgog.
 *
 *   bun bots/quests/imp-catcher.ts {botname}
 *
 * Journal rules from quest_imp/scripts/imp_journal.rs2; dialog from
 * area_wizard_tower/scripts/wizard_mizgog.rs2 ("Give me a quest!" then "Give me
 * a quest please." starts it; holding all four beads, talking hands them in).
 * The complete text repeats "I have spoken to Wizard Mizgog", so `active`
 * excludes QUEST COMPLETE. The beads are imp drops, hunted by lib/sources.ts in
 * prepare (the Wizards' Tower has no imps nearby).
 */
import type { Quest } from './lib/run-quest';
import { runQuest } from './lib/run-quest';
import { untilTicks } from './lib/ticks';

/** Inside the tower's ground floor, by the staircase at (3103,3159); walkTo opens the door at (3108,3160). */
const TOWER_INSIDE = { x: 3105, z: 3163 };
const MIZGOG = /^wizard mizgog$/i;
const BEADS = ['black bead', 'red bead', 'white bead', 'yellow bead'];

/** Up to Mizgog on the top floor (plane 2), waiting for the new plane's npcs before talking. */
async function goToMizgog(q: Quest): Promise<void> {
    if ((q.sdk.getState()?.player?.level ?? 0) !== 2) {
        if ((q.sdk.getState()?.player?.level ?? 0) === 0) await q.goTo(TOWER_INSIDE, 2);
        await q.climbTo(2);
    }
    if (!(await untilTicks(q.sdk, (s) => (s.nearbyNpcs ?? []).some((n) => MIZGOG.test(n.name)), 15))) {
        q.log('Wizard Mizgog not in view on the top floor');
    }
}

await runQuest({
    id: 'imp',
    hub: 'draynor',
    journal: { label: 'Imp Catcher', title: 'Imp Catcher' },
    stages: [
        { id: 'unstarted', rule: { id: 'imp:unstarted', kind: 'unstarted', all: ['I can start this quest by talking to'] } },
        { id: 'active', rule: { id: 'imp:active', kind: 'active', all: ['I have spoken to Wizard Mizgog'], none: ['QUEST COMPLETE'] } },
        { id: 'complete', rule: { id: 'imp:complete', kind: 'complete', all: ['QUEST COMPLETE'] } },
    ],
    transitions: [
        {
            from: 'unstarted',
            to: 'active',
            run: async (q) => {
                await goToMizgog(q);
                // "Just stop messing around and give me a quest!" also contains "give me a quest!".
                await q.talk(MIZGOG, [/give me a quest please/i, /^\s*give me a quest!/i]);
            },
        },
        {
            from: 'active',
            to: 'complete',
            needs: BEADS.map((item) => ({ item, count: 1 })),
            run: async (q) => {
                await goToMizgog(q);
                await q.talk(MIZGOG);
            },
        },
    ],
});
