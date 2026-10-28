/**
 * Sheep Shearer — 20 balls of wool for Farmer Fred.
 *
 *   bun bots/quests/sheep-shearer.ts {botname}
 *
 * Journal rules come from quest_sheep/scripts/sheep_journal.rs2. The complete
 * text also says "balls of wool", so `active` must exclude QUEST COMPLETE.
 * Wool, shears and spinning live in lib/sources.ts.
 */
import { runQuest } from './lib/run-quest';

const FRED = { x: 3190, z: 3274 };

await runQuest({
    id: 'sheep',
    hub: 'draynor',
    journal: { label: 'Sheep Shearer', title: 'Sheep Shearer' },
    stages: [
        { id: 'unstarted', rule: { id: 'sheep:unstarted', kind: 'unstarted', all: ['I can start this quest by speaking to'] } },
        { id: 'active', rule: { id: 'sheep:active', kind: 'active', all: ['balls of wool'], none: ['QUEST COMPLETE'] } },
        { id: 'complete', rule: { id: 'sheep:complete', kind: 'complete', all: ['QUEST COMPLETE'] } },
    ],
    transitions: [
        {
            from: 'unstarted',
            to: 'active',
            at: FRED,
            talk: { npc: /fred/i, choices: [/looking for a quest/i, /yes okay/i] },
        },
        {
            from: 'active',
            to: 'complete',
            at: FRED,
            needs: [{ item: 'ball of wool', count: 20 }],
            talk: { npc: /fred/i },
            // Fred takes one ball per tick and closes the chat each time; walking away aborts it.
            run: async (q) => {
                for (let idle = 0; idle < 5 && q.count('ball of wool') > 0; ) {
                    const before = q.count('ball of wool');
                    const dialog = q.sdk.getDialog();
                    if (dialog?.isOpen) await q.sdk.sendClickDialog(dialog.options?.[0]?.index ?? 0);
                    await q.sdk.waitForTicks(1);
                    idle = q.count('ball of wool') < before || dialog?.isOpen ? 0 : idle + 1;
                }
            },
        },
    ],
});
