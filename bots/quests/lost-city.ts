/**
 * Lost City — a Dramen staff from Entrana's dungeon, and into Zanaris.
 *
 *   bun bots/quests/lost-city.ts {botname}
 *
 * Journal rules from quest_zanaris/scripts/zanaris_journal.rs2 (each stage's own
 * line). Dialog: warrior_zanaris.rs2 (the camp's "Looks like you don't know
 * either" starts it), shamus.rs2, monk_of_entrana.rs2, cave_monk.rs2. Needs
 * Crafting 31 and Woodcutting 36 (trained in the prologue by lib/training.ts) and
 * Magic 17 for the tree spirit (Wind Bolt: the fleet holds ~250k air runes but under 800 fire). Items:
 *   - axe                         lib/sources.ts (Bob's) — for the leprechaun's tree
 *   - air/fire/chaos/earth runes  lib/sources.ts (Betty, Port Sarim)
 *   - law rune, sharks            mule stock (Lumbridge Teleport out of the dungeon; food)
 *   - knife                       lib/sources.ts (Lumbridge castle spawn)
 *   - bronze axe, branch, staff   from the dungeon (quest items; the staff is carried on resume)
 * Entrana and the dungeon are lib/lost-city.ts.
 */
import { runQuest, type Quest } from './lib/run-quest';
import { carveStaff, enterZanaris, inDungeon, spiritAndBranch, talkShamus, toDungeon, WARRIOR_CAMP } from './lib/lost-city';

/**
 * Wind Bolt (2 air, 1 chaos) for the spirit (85 hp, max hit 9: ~30 casts with misses),
 * Lumbridge Teleport (3 air, 1 earth, 1 law) out, food. Fire Bolt's 120 fire runes stalled
 * two accounts for an hour on Betty's stock (2026-11-01).
 */
const ENTRANA_KIT = [
    { item: 'air rune', count: 150 },
    { item: 'chaos rune', count: 60 },
    { item: 'earth rune', count: 2 },
    { item: 'law rune', count: 1 },
    { item: 'shark', count: 8 },
    { item: 'knife', count: 1 },
];
/** In the dungeon the kit is what is left of it; only the knife and the teleport still matter. */
const kit = (q: Quest) => (inDungeon(q) ? [{ item: 'knife', count: 1 }] : ENTRANA_KIT);

const stage = (id: string, kind: 'unstarted' | 'active' | 'complete', text: string, optional = false) => ({
    id,
    rule: { id: `zanaris:${id}`, kind, all: [text] },
    optional,
});

await runQuest({
    id: 'lostcity',
    hub: 'draynor',
    skills: { crafting: 31, woodcutting: 36, magic: 17 },
    carry: ['dramen branch', 'dramen staff'],
    journal: { label: 'Lost City', title: 'Lost City' },
    stages: [
        stage('unstarted', 'unstarted', 'I can start this quest by speaking to the Adventurers'),
        stage('started', 'active', 'who can tell me how to enter'),
        stage('spoken_shamus', 'active', 'I can find a Dramen Tree'),
        // The branch is cut right after the spirit dies.
        stage('spirit_defeated', 'active', 'defeated I can cut a', true),
        stage('tree_chopped', 'active', 'craft the branch from the tree into a'),
        stage('staff_made', 'active', 'while keeping the Dramen staff with me'),
        stage('complete', 'complete', 'QUEST COMPLETE'),
    ],
    transitions: [
        {
            from: 'unstarted',
            to: 'started',
            at: WARRIOR_CAMP,
            talk: {
                npc: /^warrior$/i,
                choices: [/what are you camped here for/i, /what makes you think it's out here/i, /if it's hidden how are you planning/i, /looks like you don't know either/i],
            },
        },
        { from: 'started', to: 'spoken_shamus', needs: [{ item: 'axe', count: 1 }], run: (q) => talkShamus(q) },
        {
            from: 'spoken_shamus',
            to: 'spirit_defeated',
            needs: kit,
            run: async (q) => {
                await toDungeon(q);
                await spiritAndBranch(q, true);
            },
        },
        { from: 'spirit_defeated', to: 'tree_chopped', needs: kit, run: (q) => spiritAndBranch(q, true) },
        { from: 'tree_chopped', to: 'staff_made', needs: [{ item: 'knife', count: 1 }], run: (q) => carveStaff(q) },
        // A staff lost after it was made (carry brings a banked one back) is made again.
        { from: 'staff_made', to: 'complete', needs: [{ item: 'dramen staff', count: 1 }], run: (q) => enterZanaris(q) },
    ],
});
