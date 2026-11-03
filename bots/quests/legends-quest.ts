/**
 * Legends' Quest — map the Kharazi jungle, free Ungadulu, grow a Yommi totem pole and bring the
 * Kharazi tribe's gilded totem back to Radimus Erkle (quest id legends).
 *
 *   bun bots/quests/legends-quest.ts {botname}
 *
 * Needs Heroes' Quest, Family Crest, Shilo Village, Underground Pass, Waterfall Quest and 107 quest
 * points (legends_guard.rs2), and Magic 56, Mining 52, Agility/Crafting/Smithing/Strength/Thieving/
 * Woodcutting 50, Herblore 45, Prayer 42 (legends_journal.rs2; each one gates its own step). Jungle
 * Potion (a Shilo prerequisite) is what makes the snake weed and ardrigal grow.
 * Journal rules from quest_legends/scripts/legends_journal.rs2, one distinct line per stage; 35 and 40
 * print the same text, so 40 is not a stage (the totem's replacement and Gujuo's gift are one step).
 * Items (lib/sources.ts; everything is withdrawn per phase at Shilo Village's bank, lib/legends-quest.ts restock):
 *   - coins, papyrus ×3, charcoal ×3     the boats, the map
 *   - rune axe                           mule stock — jungle, and the Yommi tree takes nothing less
 *   - gold bar ×2, hammer, vial of water the golden bowl; the bravery potion
 *   - lockpick, pickaxe, opal, jade, red topaz, sapphire, diamond, ruby, emerald, soul/mind/earth rune,
 *     law rune ×2                        the shaman caves' trials and the Book of Binding (mule stock)
 *   - unpowered orb, cosmic rune ×3, water rune ×30, rope   the magic gate and the winch
 *   - shark ×10, prayer potions (any held), a melee weapon  Nezikchened ×3, the three heroes
 *   - the notes, machete, bullroarer, bowl, book, seeds, crystals, daggers, totems: the quest's own
 * The magic trial gate needs sdk.sendSpellOnLoc (OPLOCT); without it the run stops there, saying so.
 * Route and mechanics: lib/legends-quest.ts.
 */
import { runQuest, type Quest } from './lib/run-quest';
import {
    askGujuoWater,
    askSource,
    bindUngadulu,
    collectWater,
    descend,
    dryPool,
    fillBowl,
    findCave,
    gearUp,
    forgeHeart,
    germinate,
    getBullroarer,
    growTotem,
    handIn,
    JOURNAL,
    leaveLegends,
    mapJungle,
    meetGujuo,
    meetSpirit,
    replaceTotem,
    setHeart,
    slayFinal,
    slayFirst,
    slaySecond,
    speakUngadulu,
    startQuest,
    stockCheck,
    train,
} from './lib/legends-quest';

const stage = (
    id: string,
    kind: 'unstarted' | 'active' | 'complete',
    all: string[],
    more: { none?: string[]; rawAll?: string[]; rawNone?: string[] } = {}
) => ({ id, rule: { id: `legends:${id}`, kind, all, ...more } });

/** The whole quest's mule-only stock is checked once, at the hub, before the first step. */
let checked = false;
const step = (fn: (q: Quest) => Promise<void>) => async (q: Quest) => {
    if (!checked) {
        checked = true;
        const p = q.sdk.getState()?.player;
        if (p && Math.hypot(p.worldX - 2655, p.worldZ - 3283) < 12) await stockCheck(q);
    }
    try {
        await gearUp(q);
        await fn(q);
    } catch (err) {
        // A failed step must not leave the account standing among the jungle's savages or the caves'
        // deathwings until the next attempt (two local deaths that way, 2026-11-04): out first.
        await leaveLegends(q, { x: 2655, z: 3283 }).catch((e) => q.log(`legends: could not get clear after the failure: ${(e as Error).message}`));
        throw err;
    }
};

await runQuest({
    id: 'legends',
    hub: 'ardougne',
    skills: { magic: 56, mining: 52, agility: 50, crafting: 50, smithing: 50, strength: 50, thieving: 50, woodcutting: 50, herblore: 45, prayer: 42 },
    // One jungle, one octagram, one source: Gujuo and Nezikchened spawn per player, but two accounts
    // on the same boulder or tree would fight over it.
    maxConcurrent: 2,
    // Each step can take a long walk; three tries of a step are cheap next to restarting the quest.
    retries: 3,
    journal: JOURNAL,
    stages: [
        stage('unstarted', 'unstarted', ['I can start this quest by speaking to']),
        stage('started', 'active', ['To get in to the']),
        stage('mapped', 'active', ['I have mapped the Kharazi Jungle'], { none: ['A local forester took a copy'] }),
        stage('bullroarer', 'active', ['bullroarer which may attract a native']),
        stage('accepted', 'active', [], { rawAll: ['@dbl@I agreed to help'] }),
        stage('entrance', 'active', ['I need to get some Yommi tree seeds from Ungadulu'], { none: ['trapped in a flaming octagon'] }),
        stage('spoke', 'active', ['is acting weird and talking']),
        stage('asked', 'active', ['Ungadulu acted strange and mentioned sacred water'], { none: ['I have some sacred water', 'I used sacred water on flames'] }),
        stage('filled', 'active', ['I have some sacred water'], { none: ['I used sacred water on flames'] }),
        // The book raises the demon (11) and the same step fights it: a resumed run can still start here.
        { ...stage('summoned', 'active', ['I need to release Ungadulu so that']), optional: true },
        stage('freed', 'active', ['I then slew the demon'], { none: ['germinated Yommi tree seeds', 'I used sacred water to germinate'] }),
        stage('germinated', 'active', ['I have some germinated Yommi tree seeds']),
        stage('dried', 'active', ['I need to get some more sacred water in order']),
        stage('recipe', 'active', ['I used sacred water to germinate'], { none: ['I need to get some more sacred water', 'The Viyeldi caves are under the caves'] }),
        stage('viyeldi', 'active', ["I'm able to access the Viyeldi Caves"]),
        stage('smelted', 'active', ['I fixed chunks of crystal into dragon heart shape']),
        stage('recess', 'active', ['I made a glowing dragon heart stone']),
        // Echned's dialog sets 19 and, a few pages on, 20.
        { ...stage('spirit', 'active', ['A strange spirit seems to be guarding']), optional: true },
        // With Viyeldi slain (this route) the dagger line stays for good: 20 is the stage still seeking the water.
        stage('dagger', 'active', ['The spirit gave me a dagger and said', 'I need to find a way to get some sacred water']),
        stage('source', 'active', ['I found the source of the sacred water']),
        stage('water', 'active', ['I now have some pure sacred water']),
        stage('totem', 'active', ["I've got a Yommi tree totem pole"]),
        // The totem on the corrupted pole sets 32; the fight that follows is the same step.
        { ...stage('final', 'active', ['I have to defeat the demon Nezikchened']), optional: true },
        // Two texts: Viyeldi spared, or (this route) slain and his fighters summoned first.
        stage('slain', 'active', ['I fought Nezikchened and finally defeated him|I fought them all and eventually defeated Nezikchened'], { none: ['I replaced the evil totem'] }),
        stage('gilded', 'active', ['I replaced the evil totem with the good one'], { none: ['handed the totem pole and map'] }),
        stage('returned', 'active', ['asked me to join him inside the']),
        // Radimus' four trainings run in one dialog; 55-70 are passed through.
        { ...stage('training', 'active', ['training sessions with']), optional: true },
        stage('complete', 'complete', ['QUEST COMPLETE']),
    ],
    transitions: [
        { from: 'unstarted', to: 'started', run: step(startQuest) },
        { from: 'started', to: 'mapped', run: step(mapJungle) },
        { from: 'mapped', to: 'bullroarer', run: step(getBullroarer) },
        { from: 'bullroarer', to: 'accepted', run: step(meetGujuo) },
        { from: 'accepted', to: 'entrance', run: step(findCave) },
        { from: 'entrance', to: 'spoke', run: step(speakUngadulu) },
        { from: 'spoke', to: 'asked', run: step(askGujuoWater) },
        { from: 'asked', to: 'filled', run: step(fillBowl) },
        { from: 'filled', to: 'freed', run: step(bindUngadulu) },
        { from: 'summoned', to: 'freed', run: step(slayFirst) },
        { from: 'freed', to: 'germinated', run: step(germinate) },
        { from: 'germinated', to: 'dried', run: step(dryPool) },
        { from: 'dried', to: 'recipe', run: step(askSource) },
        { from: 'recipe', to: 'viyeldi', run: step(descend) },
        { from: 'viyeldi', to: 'smelted', run: step(forgeHeart) },
        { from: 'smelted', to: 'recess', run: step(setHeart) },
        { from: 'recess', to: 'dagger', run: step(meetSpirit) },
        { from: 'spirit', to: 'dagger', run: step(meetSpirit) },
        { from: 'dagger', to: 'source', run: step(slaySecond) },
        { from: 'source', to: 'water', run: step(collectWater) },
        { from: 'water', to: 'totem', run: step(growTotem) },
        { from: 'totem', to: 'slain', run: step(slayFinal) },
        { from: 'final', to: 'slain', run: step(slayFinal) },
        { from: 'slain', to: 'gilded', run: step(replaceTotem) },
        { from: 'gilded', to: 'returned', run: step(handIn) },
        { from: 'returned', to: 'complete', run: step(train) },
        { from: 'training', to: 'complete', run: step(train) },
    ],
});
