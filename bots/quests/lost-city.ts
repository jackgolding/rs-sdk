/**
 * Lost City — a Dramen staff from Entrana's dungeon, and into Zanaris.
 *
 *   bun bots/quests/lost-city.ts {botname}
 *
 * Journal rules from quest_zanaris/scripts/zanaris_journal.rs2 (each stage's own
 * line). Dialog: warrior_zanaris.rs2 (the camp's "Looks like you don't know
 * either" starts it), shamus.rs2, monk_of_entrana.rs2, cave_monk.rs2. Needs
 * Crafting 31 and Woodcutting 36 (trained in the prologue by lib/training.ts) and
 * The tree spirit is fought in melee with the dungeon's bronze axe; Magic 31 for the teleport out. Items:
 *   - axe                         lib/sources.ts (Bob's) — for the leprechaun's tree
 *   - air/fire/chaos/earth runes  lib/sources.ts (Betty, Port Sarim)
 *   - law rune, sharks            mule stock (Lumbridge Teleport out of the dungeon; food)
 *   - knife                       lib/sources.ts (Lumbridge castle spawn)
 *   - bronze axe, branch, staff   from the dungeon (quest items; the staff is carried on resume)
 * Entrana and the dungeon are lib/lost-city.ts.
 */
import { runQuest, type Quest } from './lib/run-quest';
import { carveStaff, enterZanaris, inDungeon, meleeSpirit, spiritAndBranch, talkShamus, toDungeon, WARRIOR_CAMP } from './lib/lost-city';

/**
 * 20 sharks and Lumbridge Teleport (3 air, 1 earth, 1 law) out: the only way out on foot is the
 * Magic door into level-32 Wilderness. A strong account fights the tree spirit in melee with the
 * dungeon's bronze axe (no weapon may be brought to Entrana); a weaker one adds Wind Bolt's
 * 2 air + 1 chaos a cast (lib/lost-city.ts meleeSpirit). The knife carves the staff.
 */
const ENTRANA_KIT = (q: Quest) => [
    { item: 'air rune', count: meleeSpirit(q) ? 3 : 80 },
    ...(meleeSpirit(q) ? [] : [{ item: 'chaos rune', count: 30 }]),
    { item: 'earth rune', count: 1 },
    { item: 'law rune', count: 1 },
    // Wind Bolt used 2 sharks at jackquests' stats; 20 left no slot for the chaos runes (prod, 2026-11-01).
    { item: 'shark', count: meleeSpirit(q) ? 20 : 12 },
    { item: 'knife', count: 1 },
];
/** In the dungeon the kit is what is left of it; only the knife and the teleport still matter. */
const kit = (q: Quest) => (inDungeon(q) ? [{ item: 'knife', count: 1 }] : ENTRANA_KIT(q));

const stage = (id: string, kind: 'unstarted' | 'active' | 'complete', text: string, optional = false) => ({
    id,
    rule: { id: `zanaris:${id}`, kind, all: [text] },
    optional,
});

await runQuest({
    id: 'lostcity',
    hub: 'draynor',
    skills: { crafting: 31, woodcutting: 36, magic: 31 },
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
