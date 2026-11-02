/**
 * Druidic Ritual — four raw meats dipped in the Cauldron of Thunder for Sanfew.
 *
 *   bun bots/quests/druidic-ritual.ts {botname}
 *
 * Journal rules come from quest_druid/scripts/druid_journal.rs2; dialog from
 * area_taverly/scripts/{kaqemeex,sanfew}.rs2. The raw meats are prepare-phase
 * sources (lib/sources.ts). Dipping is quest-tracked: the cauldron only
 * enchants at druid_spoken_sanfew, so it lives in that transition.
 */
import type { Quest } from './lib/run-quest';
import { runQuest } from './lib/run-quest';
import { ticksToMs, untilTicks } from './lib/ticks';

const KAQEMEEX = { x: 2925, z: 3486 };
/** Sanfew is upstairs (plane 1) in his house in Taverley. */
const SANFEW_HOUSE = { x: 2899, z: 3428 };
const DUNGEON_LADDER = { x: 2884, z: 3397 };
const DUNGEON_LADDER_BELOW = { x: 2884, z: 9798 };
/** Outside the cauldron room's prison doors. */
const PRISON_DOORS = { x: 2888, z: 9830 };

const MEATS = [
    { raw: 'raw beef', enchanted: 'enchanted beef' },
    { raw: 'raw chicken', enchanted: 'enchanted chicken' },
    { raw: 'raw rat meat', enchanted: 'enchanted rat' },
    { raw: 'raw bear meat', enchanted: 'enchanted bear' },
];

const underground = (q: Quest) => (q.sdk.getState()?.player?.worldZ ?? 0) > 6400;

/** Taverley dungeon's entrance ladder, either way. */
async function useDungeonLadder(q: Quest, down: boolean): Promise<void> {
    const opt = down ? /climb-down/i : /climb-up/i;
    for (let i = 0; i < 4 && underground(q) !== down; i++) {
        await q.goTo(down ? DUNGEON_LADDER : DUNGEON_LADDER_BELOW, 3);
        await q.sdk.scanNearbyLocs(10).catch(() => undefined);
        const ladder = q.sdk.findNearbyLoc(/ladder/i, { withOption: opt });
        if (!ladder) throw new Error(`no dungeon ladder to ${down ? 'climb down' : 'climb up'} near the player`);
        await q.bot.interactLoc(ladder, opt);
        await untilTicks(q.sdk, (s) => ((s.player?.worldZ ?? 0) > 6400) === down, 15);
    }
    if (underground(q) !== down) throw new Error(`could not ${down ? 'enter' : 'leave'} Taverley dungeon`);
}

/** Up to Sanfew, waiting for the new plane's npcs to stream in before talking. */
async function goToSanfew(q: Quest): Promise<void> {
    if (underground(q)) await useDungeonLadder(q, false);
    if ((q.sdk.getState()?.player?.level ?? 0) !== 1) {
        await q.goTo(SANFEW_HOUSE, 3);
        await q.climbTo(1);
    }
    // nearbyNpcs is empty for a few ticks after a climb; talking then skipped his dialog
    // and the cauldron refused every dip (old script, jacklove7 2026-10-27).
    await untilTicks(q.sdk, (s) => (s.nearbyNpcs ?? []).some((n) => /^sanfew$/i.test(n.name)), 15);
}

async function killSuitsOfArmour(q: Quest): Promise<void> {
    for (let i = 0; i < 4; i++) {
        const suit = q.sdk.findNearbyNpc(/^suit of armour$/i);
        if (!suit) return;
        await q.bot.attack(suit, ticksToMs(20));
        await untilTicks(q.sdk, (s) => !(s.nearbyNpcs ?? []).some((n) => n.index === suit.index), 60);
    }
}

/**
 * Past the cauldron room's prison doors. Opening them from outside first wakes
 * each suit of armour beside them (prison_doors.rs2); the doors only open once
 * both have woken, and close behind the player.
 */
async function enterCauldronRoom(q: Quest): Promise<void> {
    const cauldronReachable = async () => {
        await q.sdk.scanNearbyLocs(12).catch(() => undefined);
        return q.sdk.findNearbyLoc(/^cauldron of thunder$/i)?.reachable === true;
    };
    await q.goTo(PRISON_DOORS, 2);
    for (let i = 0; i < 6 && !(await cauldronReachable()); i++) {
        await killSuitsOfArmour(q);
        const door = q.sdk.findNearbyLoc(/^prison door$/i, { withOption: /^open$/i });
        if (!door) throw new Error('no prison door outside the cauldron room');
        await q.bot.interactLoc(door, /^open$/i);
        await q.sdk.waitForTicks(3);
    }
    await killSuitsOfArmour(q);
    if (!(await cauldronReachable())) throw new Error('could not get into the cauldron room');
}

/** Dip each raw meat still held; skips meats already enchanted. */
async function dipMeats(q: Quest): Promise<void> {
    for (const m of MEATS) {
        if (q.count(m.enchanted) > 0) continue;
        const before = q.count(m.enchanted);
        await q.bot.useItemOnLoc(new RegExp(`^${m.raw}$`, 'i'), /^cauldron of thunder$/i, { timeout: ticksToMs(25) });
        await untilTicks(q.sdk, () => q.count(m.enchanted) > before, 10);
        if (q.count(m.enchanted) <= before) throw new Error(`the cauldron did not enchant the ${m.raw}`);
    }
}

await runQuest({
    id: 'druid',
    hub: 'falador-east',
    // Six accounts at once for the Herblore push (user, 2026-11-02): Kaqemeex and Sanfew serve everyone.
    maxConcurrent: 8,
    journal: { label: 'Druidic Ritual', title: 'Druidic Ritual' },
    stages: [
        { id: 'unstarted', rule: { id: 'druid:unstarted', kind: 'unstarted', all: ['I can start this quest by speaking to Kaqemeex'] } },
        { id: 'started', rule: { id: 'druid:started', kind: 'active', all: ['I should speak to Sanfew in the village to the South'] } },
        { id: 'spoken_sanfew', rule: { id: 'druid:spoken_sanfew', kind: 'active', all: ['Sanfew told me for the ritual they would need me to place'] } },
        { id: 'given', rule: { id: 'druid:given', kind: 'active', all: ['I should speak to Kaqemeex again and claim my reward'] } },
        { id: 'complete', rule: { id: 'druid:complete', kind: 'complete', all: ['QUEST COMPLETE'] } },
    ],
    transitions: [
        {
            from: 'unstarted',
            to: 'started',
            at: KAQEMEEX,
            talk: { npc: /^kaqemeex$/i, choices: [/in search of a quest/i, /ok, i will try and help/i] },
        },
        {
            from: 'started',
            to: 'spoken_sanfew',
            run: async (q) => {
                await goToSanfew(q);
                await q.talk(/^sanfew$/i, [/sent to help purify/i, /ok, i'll do that then/i]);
            },
        },
        {
            from: 'spoken_sanfew',
            to: 'given',
            needs: MEATS.map((m) => ({ item: m.raw, count: 1, or: m.enchanted })),
            run: async (q) => {
                if (MEATS.some((m) => q.count(m.enchanted) === 0)) {
                    await useDungeonLadder(q, true);
                    await enterCauldronRoom(q);
                    await dipMeats(q);
                }
                // Holding all four enchanted meats, Sanfew takes them as soon as he is spoken to.
                await goToSanfew(q);
                await q.talk(/^sanfew$/i);
            },
        },
        {
            from: 'given',
            to: 'complete',
            at: KAQEMEEX,
            talk: { npc: /^kaqemeex$/i },
        },
    ],
});
