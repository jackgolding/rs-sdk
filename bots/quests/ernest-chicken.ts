/**
 * Ernest the Chicken — three machine parts for Professor Oddenstein.
 *
 *   bun bots/quests/ernest-chicken.ts {botname}
 *
 * Journal rules from quest_haunted/scripts/haunted_journal.rs2; dialog from
 * area_draynor/scripts/{veronica,professor_oddenstein}.rs2. The rubber tube,
 * pressure gauge and oil can do not depend on the quest stage, so prepare makes
 * them (lib/sources.ts → lib/draynor-manor.ts) before Veronica. Oddenstein is
 * on the manor's top floor (plane 2).
 */
import type { Quest } from './lib/run-quest';
import { runQuest } from './lib/run-quest';
import { enterManor, leaveManor } from './lib/draynor-manor';
import { driveDialog } from './lib/dialog';
import { untilTicks } from './lib/ticks';

/** Veronica, outside the manor gate. */
const VERONICA = { x: 3110, z: 3330 };
const ODDENSTEIN = /^professor oddenstein$/i;

async function goToOddenstein(q: Quest): Promise<void> {
    await enterManor(q);
    if ((q.sdk.getState()?.player?.level ?? 0) !== 2) await q.climbTo(2);
    await untilTicks(q.sdk, (s) => (s.nearbyNpcs ?? []).some((n) => ODDENSTEIN.test(n.name)), 15);
}

await runQuest({
    id: 'haunted',
    hub: 'draynor',
    // Shared NPCs/doors (Keli and the prince; the lever maze) break with many bots in at once.
    maxConcurrent: 2,
    journal: { label: 'Ernest the Chicken', title: 'Ernest the Chicken' },
    stages: [
        { id: 'unstarted', rule: { id: 'haunted:unstarted', kind: 'unstarted', all: ['I can start this quest by speaking to'] } },
        { id: 'started', rule: { id: 'haunted:started', kind: 'active', all: ['I need to find'], none: ['QUEST COMPLETE'] } },
        { id: 'parts', rule: { id: 'haunted:parts', kind: 'active', all: ['parts for his machine'], none: ['QUEST COMPLETE'] } },
        { id: 'complete', rule: { id: 'haunted:complete', kind: 'complete', all: ['QUEST COMPLETE'] } },
    ],
    transitions: [
        { from: 'unstarted', to: 'started', at: VERONICA, talk: { npc: /^veronica$/i, choices: [/sounds like a quest/i] } },
        {
            from: 'started',
            to: 'parts',
            run: async (q) => {
                await goToOddenstein(q);
                await q.talk(ODDENSTEIN, [/looking for a guy called ernest/i, /change him back this instant/i]);
            },
        },
        {
            from: 'parts',
            to: 'complete',
            needs: [
                { item: 'rubber tube', count: 1 },
                { item: 'pressure gauge', count: 1 },
                { item: 'oil can', count: 1 },
            ],
            run: async (q) => {
                await goToOddenstein(q);
                await q.talk(ODDENSTEIN, [/i have everything/i]);
                // The machine runs on server delays after the dialog closes; Ernest then talks.
                if (await untilTicks(q.sdk, (s) => !!s.dialog?.isOpen, 15)) await driveDialog(q.sdk, [], { log: q.log });
                await leaveManor(q);
            },
        },
    ],
});
