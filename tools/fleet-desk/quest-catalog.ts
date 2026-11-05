/**
 * Every real in-game quest, keyed by the id todo-runner uses for it, with the
 * quest points the server awards.
 *
 * Source of truth is the server content (this file is a copy; the test checks
 * it against the content when the repo has it):
 *   - names:  server/content/scripts/player/interfaces/questlist.if
 *   - points: server/content/scripts/general/configs/quest.constant (`^<key>_questpoints`)
 *             summed by `[proc,count_questpoints]` in scripts/general/scripts/quests.rs2
 *
 * `server` is the content key (quest_<server> directory / questlist component).
 * `scripts` are the bots/quests files that run it, so a todo item can be matched
 * by script even when its id is a one-off variant. `aliases` are other ids seen
 * for the same quest: QuestDef ids that differ from the todo id, log tags, and
 * the server key.
 */

export interface QuestInfo {
    id: string;
    label: string;
    qp: number;
    server: string;
    members: boolean;
    scripts: string[];
    aliases?: string[];
    /** Barcrawl: no quest points and not in the quest list. */
    miniquest?: boolean;
}

const q = (
    id: string,
    label: string,
    qp: number,
    server: string,
    members: boolean,
    scripts: string[],
    aliases: string[] = []
): QuestInfo => ({ id, label, qp, server, members, scripts, aliases });

export const QUESTS: QuestInfo[] = [
    // Free quests (questlist order)
    q('fortress', "Black Knights' Fortress", 3, 'blackknight', false, ['black-knights-fortress.ts'], ['blackknight']),
    q('cook', "Cook's Assistant", 1, 'cook', false, ['cooks-assistant.ts', 'cooks-assistant.graph.ts']),
    q('demon', 'Demon Slayer', 3, 'demon', false, ['demon-slayer.ts']),
    q('runemysteries', 'Rune Mysteries', 1, 'runemysteries', false, ['rune-mysteries-quest.ts']),
    q('doric', "Doric's Quest", 1, 'doric', false, ['dorics-quest.ts']),
    q('priest', 'The Restless Ghost', 1, 'priest', false, ['restless-ghost.ts']),
    q('gobdip', 'Goblin Diplomacy', 5, 'gobdip', false, ['goblin-diplomacy.ts', 'goblin-diplomacy-finish.ts']),
    q('haunted', 'Ernest the Chicken', 4, 'haunted', false, ['ernest-chicken.ts']),
    q('imp', 'Imp Catcher', 1, 'imp', false, ['imp-catcher.ts']),
    q('hunt', "Pirate's Treasure", 2, 'hunt', false, ['pirates-treasure.ts']),
    q('prince', 'Prince Ali Rescue', 3, 'prince', false, ['prince-ali-rescue.ts']),
    q('romeojuliet', 'Romeo & Juliet', 5, 'romeojuliet', false, ['romeo-and-juliet.ts']),
    q('sheep', 'Sheep Shearer', 1, 'sheep', false, ['sheep-shearer.ts']),
    q('arrav', 'Shield of Arrav', 1, 'blackarmgang', false, ['shield-of-arrav.ts'], ['shield-of-arrav', 'blackarmgang', 'phoenixgang']),
    q('squire', "The Knight's Sword", 1, 'squire', false, ['knights-sword.ts']),
    q('vampire', 'Vampire Slayer', 3, 'vampire', false, ['vampire-slayer.ts']),
    q('hetty', "Witch's Potion", 1, 'hetty', false, ['witchs-potion.ts']),
    // Members quests (questlist order)
    q('itwatchtower', 'Watchtower', 4, 'itwatchtower', true, ['watchtower.ts'], ['watchtower']),
    q('waterfall', 'Waterfall Quest', 1, 'waterfall', true, ['waterfall.ts']),
    q('ball', "Witch's House", 4, 'ball', true, ['witchs-house.ts']),
    q('biohazard', 'Biohazard', 3, 'biohazard', true, ['biohazard.ts']),
    q('cog', 'Clock Tower', 1, 'cog', true, ['clock-tower.ts']),
    q('itexam', 'The Dig Site', 2, 'itexam', true, ['dig-site.ts'], ['digsite']),
    q('chompybird', 'Big Chompy Bird Hunting', 2, 'chompybird', true, ['chompybird.ts']),
    q('mcannon', 'Dwarf Cannon', 1, 'mcannon', true, ['dwarf-cannon.ts']),
    q('crest', 'Family Crest', 1, 'crest', true, ['crest.ts']),
    q('arena', 'Fight Arena', 2, 'arena', true, ['fight-arena.ts']),
    q('fishingcompo', 'Fishing Contest', 1, 'fishingcompo', true, ['fishing-contest.ts']),
    q('fluffs', "Gertrude's Cat", 1, 'fluffs', true, ['gertrudes-cat.ts']),
    q('grandtree', 'The Grand Tree', 5, 'grandtree', true, ['grand-tree.ts']),
    q('hazeelcult', 'Hazeel Cult', 1, 'hazeelcult', true, ['hazeel-cult.ts']),
    q('heroes', "Heroes' Quest", 1, 'hero', true, ['heroes-quest.ts'], ['heroes-quest', 'hero']),
    q('junglepotion', 'Jungle Potion', 1, 'junglepotion', true, ['jungle-potion.ts']),
    q('legends', "Legends' Quest", 4, 'legends', true, ['legends-quest.ts']),
    q('lostcity', 'Lost City', 3, 'zanaris', true, ['lost-city.ts'], ['zanaris']),
    q('arthur', "Merlin's Crystal", 6, 'arthur', true, ['merlins-crystal.ts']),
    q('drunkmonk', "Monk's Friend", 1, 'drunkmonk', true, ['drunkmonk.ts']),
    q('murder', 'Murder Mystery', 3, 'murder', true, ['murder-mystery.ts']),
    q('itgronigen', 'Observatory Quest', 2, 'itgronigen', true, ['observatory.ts'], ['observatory']),
    q('elena', 'Plague City', 1, 'elena', true, ['plague-city.ts']),
    q('scorpcatcher', 'Scorpion Catcher', 1, 'scorpcatcher', true, ['scorpion-catcher.ts']),
    q('seaslug', 'Sea Slug', 1, 'seaslug', true, ['sea-slug.ts']),
    q('sheepherder', 'Sheep Herder', 4, 'sheepherder', true, ['sheep-herder.ts']),
    q('zombiequeen', 'Shilo Village', 2, 'zombiequeen', true, ['shilo-village.ts']),
    q('ikov', 'Temple of Ikov', 1, 'ikov', true, ['temple-of-ikov.ts']),
    q('touristtrap', 'The Tourist Trap', 2, 'desertrescue', true, ['tourist-trap.ts'], ['desertrescue']),
    q('tree', 'Tree Gnome Village', 2, 'tree', true, ['tree-gnome-village.ts']),
    q('totem', 'Tribal Totem', 1, 'totem', true, ['tribal-totem.ts']),
    q('upass', 'Underground Pass', 5, 'upass', true, ['underground-pass.ts']),
    q('dragon', 'Dragon Slayer', 2, 'dragon', true, ['dragon.ts']),
    q('elemental', 'Elemental Workshop', 1, 'elemental_workshop', true, ['elemental-workshop.ts'], ['elemental_workshop']),
    q('druid', 'Druidic Ritual', 4, 'druid', true, ['druidic-ritual.ts']),
    q('priestperil', 'Priest in Peril', 1, 'priestperil', true, ['priest-in-peril.ts']),
    q('druidspirit', 'Nature Spirit', 2, 'druidspirit', true, ['nature-spirit.ts']),
    q('death', 'Death Plateau', 1, 'death', true, ['death-plateau.ts']),
    q('troll', 'Troll Stronghold', 1, 'troll', true, ['troll-stronghold.ts']),
    q('eadgar', "Eadgar's Ruse", 1, 'eadgar', true, ['eadgars-ruse.ts']),
    q('tbwt', 'Tai Bwo Wannai Trio', 2, 'tbwt', true, ['tai-bwo-wannai-trio.ts']),
    q('regicide', 'Regicide', 3, 'regicide', true, ['regicide.ts']),
    q('mortton', 'Shades of Mortton', 3, 'mortton', true, ['shades-of-mortton.ts']),
    q('misc', 'Throne of Miscellania', 1, 'misc', true, ['throne-of-miscellania.ts']),
    q('viking', 'The Fremennik Trials', 3, 'viking', true, ['fremennik-trials.ts']),
    q('grail', 'Holy Grail', 2, 'grail', true, ['holy-grail.ts']),
    q('horror', 'Horror from the Deep', 2, 'horror', true, ['horror-from-the-deep.ts']),
    q('hauntedmine', 'Haunted Mine', 2, 'hauntedmine', true, ['haunted-mine.ts']),
    q('mm', 'Monkey Madness', 3, 'mm', true, ['monkey-madness.ts']),
    q('trollromance', 'Troll Romance', 2, 'troll_love', true, ['troll-romance.ts'], ['troll_love']),
    q('routequest', 'In Search of the Myreque', 2, 'routequest', true, ['in-search-of-the-myreque.ts']),
    // Miniquest: no quest points, not in the quest list.
    { ...q('barcrawl', "Alfred Grimhand's Barcrawl", 0, 'barcrawl', true, ['barcrawl.ts']), miniquest: true },
];

export const QUEST_BY_ID = new Map(QUESTS.map((quest) => [quest.id, quest]));

const BY_ALIAS = new Map<string, QuestInfo>();
const BY_SCRIPT = new Map<string, QuestInfo>();
for (const quest of QUESTS) {
    for (const key of [quest.id, quest.server, ...(quest.aliases ?? [])]) BY_ALIAS.set(key.toLowerCase(), quest);
    for (const script of quest.scripts) BY_SCRIPT.set(script, quest);
}

/**
 * Suffixes todo.json puts on a re-queued quest: `-2`, `-r`, `-r2`, `-rel`, `-pre`,
 * `-pre2`, `-qp`, `-ns2`, `-v2`, `-bar`. A suffix outside this list (`arena-toadflax`)
 * is a different task, not a variant.
 */
const VARIANT = /^(\d+|r\d*|rel\d*|pre\d*|qp\d*|ns\d*|v\d+|bar|retry\d*|again\d*|fix\d*)$/;

/** The quest a todo id (or log tag) is, or null when it is not a quest. */
export function questForId(raw: string): QuestInfo | null {
    let id = raw.trim().toLowerCase();
    for (;;) {
        const hit = BY_ALIAS.get(id);
        if (hit) return hit;
        const dash = id.lastIndexOf('-');
        if (dash <= 0 || !VARIANT.test(id.slice(dash + 1))) return null;
        id = id.slice(0, dash);
    }
}

const leaf = (script: string) => script.split('/').pop() ?? script;

/**
 * The quest a todo item is. Its script decides when it has one: a quest script
 * makes any id that quest, and a non-quest script (top-up, mule handover, grind)
 * is never a quest whatever its id says.
 */
export function questForItem(item: { questId: string; script?: string }): QuestInfo | null {
    if (item.script) return BY_SCRIPT.get(leaf(item.script)) ?? null;
    return questForId(item.questId);
}

/** The quest points from a set of base quest ids. */
export function questPointsOf(ids: Iterable<string>): number {
    let qp = 0;
    for (const id of new Set(ids)) qp += QUEST_BY_ID.get(id)?.qp ?? 0;
    return qp;
}

/** Every quest point the fleet's quest list can award (miniquests award none). */
export const MAX_QP = QUESTS.reduce((sum, quest) => sum + quest.qp, 0);
