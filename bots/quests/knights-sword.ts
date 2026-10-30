/**
 * The Knight's Sword — replace the Squire's lost sword with Thurgo's help.
 *
 *   bun bots/quests/knights-sword.ts {botname}
 *
 * Journal rules from quest_squire/scripts/squire_journal.rs2: one sentence unique
 * to each stage. NPC tiles are content placements (verified in the pre-runner
 * script, git history of this file). Items:
 *   - redberry pie   lib/sources.ts (Wydin's flour + redberries, palace pie dish,
 *                    Lumbridge jug of water, palace range; needs Cooking 10)
 *   - blurite ore    lib/mining.ts (cave under Thurgo's hut; Mining 10, trained first)
 *   - iron bar ×2    mule-supplied stock: a short bank stops the run with NEEDS STOCK
 *   - portrait       quest item, taken from Sir Vyvin's cupboard in this script
 */
import { runQuest, type Quest } from './lib/run-quest';
import { untilTicks } from './lib/ticks';
import { acquireQuestSlot } from './lib/no-client-waits';
import { join } from 'node:path';

const SQUIRE = { x: 2977, z: 3342 };
const RELDO = { x: 3209, z: 3495 };
/**
 * Outside the Varrock palace side door. Neither walkTo (stuck at 3211,3438) nor
 * travelTo (blocked at the south wall, 3212,3470) finds a way into the library
 * from the south; the pre-runner script went in through this door.
 */
const PALACE_SIDE_DOOR = { x: 3218, z: 3474 };
const THURGO = { x: 3001, z: 3144 };
/**
 * White Knights' castle tower: the courtyard ladder to level 1, then the staircase
 * (2984,3337) into the corridor north of Sir Vyvin's room on level 2. The room is
 * 2982-2985 x 3334-3336 behind the door at (2982,3337); the cupboard is (2984,3336).
 */
const TOWER_LADDER = { x: 2983, z: 3351 };
const TOWER_STAIRS_L1 = { x: 2984, z: 3337, level: 1 };
const VYVIN_ROOM = { x: 2983, z: 3335, level: 2 };
const CUPBOARD = { x: 2984, z: 3336 };
/** Tiles beside the cupboard the search can be made from. */
const CUPBOARD_SIDES = [
    { x: 2983, z: 3335 },
    { x: 2984, z: 3335 },
    { x: 2985, z: 3335 },
    { x: 2983, z: 3336 },
];
/** Back down: the staircase beside the room, then the level-1 end of the courtyard ladder. */
const TOWER_DOWN_L2 = { x: 2983, z: 3339, level: 2 };
const TOWER_DOWN_L1 = { x: 2983, z: 3350, level: 1 };
const PORTRAIT = /^(knights )?portrait$/i;
const SEARCH_ATTEMPTS = 15;
/** One account in Sir Vyvin's room at a time: each refused search freezes him by the cupboard in his
 * "HEY!" dialog, so two accounts kept him there for each other (jacklove17, jacklove20, 2026-10-30). */
const ACCOUNT = process.argv[2] ?? process.env.BOT_USERNAME ?? 'unknown';

const rule = (id: string, kind: 'unstarted' | 'active' | 'complete', text: string) => ({ id: `squire:${id}`, kind, all: [text] });

const cheb = (a: { x: number; z: number }, b: { x: number; z: number }) => Math.max(Math.abs(a.x - b.x), Math.abs(a.z - b.z));

/**
 * Take the portrait from Sir Vyvin's cupboard while he is not watching.
 * quest_squire.rs2 [proc,vyvin_distracted]: the search is refused while Vyvin is
 * within 1 tile of the PLAYER (npc_find(coord, sir_vyvin, 1, 0)); "Can I distract
 * you" is flavour and does not move him. He wanders the room, so: stand on the
 * cupboard side farthest from him and search once he is 2+ tiles away.
 */
async function takePortrait(q: Quest): Promise<void> {
    if (q.count(PORTRAIT) > 0) return;
    const release = await acquireQuestSlot('squire-portrait', 1, ACCOUNT, join(process.cwd(), 'bots', ACCOUNT, 'grind.log'));
    try {
        await searchForPortrait(q);
    } finally {
        release();
    }
}

async function searchForPortrait(q: Quest): Promise<void> {
    await q.goTo(TOWER_LADDER, 1);
    await q.climbTo(1);
    await q.goTo(TOWER_STAIRS_L1, 1);
    await q.climbTo(2);
    await q.goTo(VYVIN_ROOM, 1);

    const me = () => {
        const p = q.sdk.getState()!.player!;
        return { x: p.worldX, z: p.worldZ };
    };
    const vyvin = () => q.sdk.findNearbyNpc(/^sir vyvin$/i);
    for (let attempt = 1; attempt <= SEARCH_ATTEMPTS && q.count(PORTRAIT) < 1; attempt++) {
        const v0 = vyvin();
        const side = v0 ? [...CUPBOARD_SIDES].sort((a, b) => cheb(b, v0) - cheb(a, v0))[0]! : CUPBOARD_SIDES[0]!;
        if (cheb(me(), side) > 0) {
            await q.bot.walkTo(side.x, side.z, 0);
        }
        const clear = await untilTicks(q.sdk, () => {
            const v = vyvin();
            return !v || cheb(me(), v) > 1;
        }, 60);
        if (!clear) {
            // Searching beside him only starts his dialog, which holds him there.
            q.log(`cupboard #${attempt}: Sir Vyvin still beside (${me().x},${me().z}); waiting for him to wander`);
            continue;
        }
        await q.sdk.scanNearbyLocs(6).catch(() => undefined);
        const cupboard = (q.sdk.getNearbyLocs() ?? []).find((l) => /cupboard/i.test(l.name) && l.x === CUPBOARD.x && l.z === CUPBOARD.z);
        if (!cupboard) throw new Error(`no cupboard at (${CUPBOARD.x},${CUPBOARD.z}) from (${me().x},${me().z})`);
        const op = cupboard.options.find((o) => /^search$/i.test(o)) ?? cupboard.options.find((o) => /^open$/i.test(o));
        if (!op) throw new Error(`cupboard offers ${cupboard.options.join('/')}`);
        const v = vyvin();
        q.log(`cupboard ${op} #${attempt} from (${me().x},${me().z}); Vyvin ${v ? `(${v.x},${v.z}) gap ${cheb(me(), v)}` : 'not in view'}`);
        await q.bot.interactLoc(cupboard, new RegExp(`^${op}$`, 'i'));
        await untilTicks(q.sdk, () => q.count(PORTRAIT) > 0 || !!q.sdk.getState()?.dialog?.isOpen, 6);
        await q.bot.dismissBlockingUI();
        await untilTicks(q.sdk, () => q.count(PORTRAIT) > 0, 3);
    }
    if (q.count(PORTRAIT) < 1) throw new Error(`no portrait after ${SEARCH_ATTEMPTS} cupboard searches`);

    await q.goTo(TOWER_DOWN_L2, 2);
    await q.climbTo(1);
    await q.goTo(TOWER_DOWN_L1, 1);
    await q.climbTo(0);
}

await runQuest({
    id: 'squire',
    hub: 'falador-east',
    journal: { label: "The Knight's Sword", title: "The Knight's Sword" },
    stages: [
        { id: 'unstarted', rule: rule('not_started', 'unstarted', 'I can start this quest by talking to the Squire') },
        { id: 'started', rule: rule('started', 'active', 'The Squire suggests I speak to Reldo') },
        { id: 'spoken_reldo', rule: rule('spoken_reldo', 'active', "Reldo couldn't give me much information") },
        { id: 'given_pie', rule: rule('given_pie', 'active', 'gained his trust through pie') },
        { id: 'spoken_thurgo', rule: rule('spoken_thurgo', 'active', 'needs a picture of the sword before he can help') },
        { id: 'looking_portrait', rule: rule('looking_portrait', 'active', "portrait of Sir Vyvin's father") },
        { id: 'looking_blurite', rule: rule('looking_blurite', 'active', 'Blurite Ore can only be') },
        { id: 'smithed', rule: rule('smithed', 'active', 'has now smithed me a replica') },
        { id: 'complete', rule: rule('complete', 'complete', 'QUEST COMPLETE') },
    ],
    transitions: [
        {
            from: 'unstarted',
            to: 'started',
            at: SQUIRE,
            talk: {
                npc: /^squire$/i,
                choices: [/and how is life as a squire/i, /i can make a new sword/i, /would these dwarves make another one/i, /ok, i'll give it a go/i],
            },
        },
        {
            from: 'started',
            to: 'spoken_reldo',
            run: async (q) => {
                await q.goTo(PALACE_SIDE_DOOR, 2);
                await q.reach(/^door$/i, /^open$/i).catch(() => undefined);
                await q.sdk.scanNearbyLocs(6).catch(() => undefined);
                const door = q.sdk.findNearbyLoc(/^door$/i, { withOption: /^open$/i });
                if (door && Math.hypot(door.x - PALACE_SIDE_DOOR.x, door.z - PALACE_SIDE_DOOR.z) <= 4) {
                    await q.bot.openDoor(door);
                    await q.sdk.waitForTicks(3);
                }
                await q.talk(/^reldo$/i, [/imcando dwarves/i], RELDO);
            },
        },
        {
            from: 'spoken_reldo',
            to: 'given_pie',
            at: THURGO,
            needs: [{ item: 'redberry pie', count: 1 }],
            talk: { npc: /^thurgo$/i, choices: [/redberry pie/i] },
        },
        { from: 'given_pie', to: 'spoken_thurgo', at: THURGO, talk: { npc: /^thurgo$/i } },
        { from: 'spoken_thurgo', to: 'looking_portrait', at: SQUIRE, talk: { npc: /^squire$/i } },
        {
            from: 'looking_portrait',
            to: 'looking_blurite',
            run: async (q) => {
                await takePortrait(q);
                await q.talk(/^thurgo$/i, [/about that sword/i], THURGO);
            },
        },
        {
            from: 'looking_blurite',
            to: 'smithed',
            at: THURGO,
            needs: [
                { item: 'blurite ore', count: 1 },
                { item: 'iron bar', count: 2 },
            ],
            talk: { npc: /^thurgo$/i, choices: [/about that sword/i, /i have them right here/i] },
        },
        {
            from: 'smithed',
            to: 'complete',
            at: SQUIRE,
            needs: [{ item: 'blurite sword', count: 1, or: 'faladian sword' }],
            talk: { npc: /^squire$/i },
        },
    ],
});
