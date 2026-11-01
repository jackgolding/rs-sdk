/**
 * Waterfall Quest — Baxtorian's treasure under the falls.
 *
 *   bun bots/quests/waterfall.ts {botname}
 *
 * Journal rules from quest_waterfall/scripts/waterfall_journal.rs2 (each stage's
 * own line; the earlier ones persist struck through, hence the `none`s). Dialog
 * and mechanics from quest_waterfall/scripts/*.rs2. Items:
 *   - rope                          lib/sources.ts (Ned, Draynor) — the rock and the dead tree
 *   - 6 air, 6 earth, 6 water runes lib/sources.ts (Betty, Port Sarim) — the pillars;
 *                                   banked at Ardougne for the tomb, which refuses runes
 *   - law rune + teleport runes   law: mule stock; the rest lib/sources.ts — the only way out of
 *                                 the falls (lib/waterfall.ts TELEPORTS: Camelot, Falador, Lumbridge, Varrock)
 *   - sharks                        mule stock — hobgoblins, the tomb's moss giants, fire giants
 *   - book, keys, pebble, amulet, urn  quest items (the book, pebble, amulet and urn carried on resume)
 * The river, the cave, the tomb and the falls are lib/waterfall.ts.
 */
import { runQuest, type Quest } from './lib/run-quest';
import { ALMERA, enterFalls, enterPuzzleRoom, enterTomb, FOOD, getPebble, meetHudon, pillarsAndStatue, readBook, runeNeeds, takeTreasure, tombItems } from './lib/waterfall';

const ROPE = { item: 'rope', count: 1 };
/** A full load of sharks from the bank; once some are eaten on the way, what is left will do. */
const food = (q: Quest) => (q.count('shark') >= 2 ? [] : [FOOD]);

const stage = (id: string, kind: 'unstarted' | 'active' | 'complete', text: string, none: string[] = []) => ({
    id,
    rule: { id: `waterfall:${id}`, kind, all: [text], none },
});

await runQuest({
    id: 'waterfall',
    hub: 'ardougne',
    // The falls have no way out on foot: Varrock Teleport (25) at least; Camelot (45) if castable.
    skills: { magic: 25 },
    // 298: Baxtorian's key ("A key", like Golrie's) opens the inner door both ways.
    carry: ['book on baxtorian', "glarial's pebble", "glarial's amulet", "glarial's urn", 298],
    journal: { label: 'Waterfall Quest', title: 'Waterfall Quest' },
    stages: [
        stage('unstarted', 'unstarted', 'I can start this quest by speaking to'),
        stage('started', 'active', 'Her son was missing', ['I found Hudon']),
        stage('hudon', 'active', 'I found Hudon', ['tourist office']),
        stage('book', 'active', 'tourist office', ['managed to enter the tomb']),
        stage('tomb', 'active', 'managed to enter the tomb', ['used it to']),
        stage('falls', 'active', 'used it to', ['Chalice']),
        stage('pillars', 'active', 'work out how to get to it'),
        stage('raised', 'active', 'retrieve the treasure from it'),
        stage('complete', 'complete', 'QUEST COMPLETE'),
    ],
    transitions: [
        { from: 'unstarted', to: 'started', at: ALMERA, talk: { npc: /^almera$/i, choices: [/how can i help/i] } },
        { from: 'started', to: 'hudon', run: (q) => meetHudon(q) },
        { from: 'hudon', to: 'book', run: (q) => readBook(q) },
        {
            from: 'book',
            to: 'tomb',
            needs: food,
            run: async (q) => {
                await getPebble(q);
                await enterTomb(q);
            },
        },
        // The runes wait in Ardougne's north bank through the tomb; enterFalls takes them back.
        {
            from: 'tomb',
            to: 'falls',
            needs: (q) => [ROPE, ...food(q)],
            run: async (q) => {
                await tombItems(q);
                await enterFalls(q);
            },
        },
        // A resumed run outside the falls walks the river route in again (rope, the amulet).
        { from: 'falls', to: 'pillars', needs: (q) => [ROPE, ...runeNeeds(q), ...food(q)], run: (q) => enterPuzzleRoom(q) },
        { from: 'pillars', to: 'raised', needs: (q) => [ROPE, ...runeNeeds(q)], run: (q) => pillarsAndStatue(q) },
        { from: 'raised', to: 'complete', needs: (q) => [ROPE, ...runeNeeds(q)], run: (q) => takeTreasure(q) },
    ],
});
