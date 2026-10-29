/**
 * Vampire Slayer — Morgan's errand: Dr Harlow's stake, a hammer and garlic, then Count Draynor.
 *
 *   bun bots/quests/vampire-slayer.ts {botname}
 *
 * Journal rules from quest_vampire/scripts/vampire_journal.rs2; dialog from
 * area_draynor/scripts/morgan.rs2 and area_varrock/scripts/harlow.rs2; the fight
 * from quest_vampire.rs2 + count_draynor.rs2. The spoke-to-Harlow journal text
 * depends on the inventory: holding the stake reads "Dr Harlow gave me a stake",
 * which is the `armed` stage. Hammer, beer and garlic are lib/sources.ts; the
 * crypt is lib/draynor-manor.ts.
 *
 * The fight: opening the coffin spawns a Count that hunts whoever opened it
 * (p_delay(4), then npc_add). He only dies with a stake AND a hammer held ("You
 * hammer the stake into the vampire's chest!"), and the quest completes from a
 * player queue 3 ticks later — stay idle until it lands.
 */
import type { NearbyNpc } from '../../sdk/types';
import type { Quest } from './lib/run-quest';
import { runQuest } from './lib/run-quest';
import { enterCrypt, leaveManor } from './lib/draynor-manor';
import { tickNow, ticksToMs, untilTicks } from './lib/ticks';

const MORGAN = { x: 3098, z: 3268 };
/** Dr Harlow, Jolly Boar Inn, north-east of Varrock. */
const HARLOW = { x: 3277, z: 3492 };
/** The Count's spawn (npc_add 0_48_152_6_46) beside the coffin. */
const COUNT_SPAWN = { x: 3078, z: 9774 };
const COUNT = /^count draynor$/i;
/** Ticks the fight may take before the attempt is abandoned (a maxed account needs far fewer). */
const FIGHT_TICKS = 400;

const pos = (q: Quest) => {
    const p = q.sdk.getState()?.player;
    return { x: p?.worldX ?? 0, z: p?.worldZ ?? 0 };
};
const counts = (q: Quest): NearbyNpc[] => (q.sdk.getNearbyNpcs() ?? []).filter((n) => COUNT.test(n.name));

/** Newest game-message cursor: only lines after it answer an action sent now. */
function cursor(q: Quest): number {
    return Math.max(0, ...(q.sdk.getState()?.gameMessages ?? []).map((m) => m.observationId ?? m.tick));
}
function linesSince(q: Quest, since: number): string[] {
    return (q.sdk.getState()?.gameMessages ?? []).filter((m) => (m.observationId ?? m.tick) > since).map((m) => m.text);
}

/**
 * Open the coffin and return the Count it spawned for us. Other accounts open the
 * same coffin: its open form lasts 10 ticks (loc_change) and only the Open event
 * spawns a Count, so wait for it to shut, and tell ours apart as the new one.
 */
async function raiseCount(q: Quest, lost: Set<number>): Promise<NearbyNpc> {
    for (let attempt = 0; attempt < 6; attempt++) {
        if (Math.hypot(pos(q).x - COUNT_SPAWN.x, pos(q).z - COUNT_SPAWN.z) > 4) await q.bot.walkTo(COUNT_SPAWN.x, COUNT_SPAWN.z, 2);
        const locs = await q.sdk.scanNearbyLocs(12).catch(() => q.sdk.getNearbyLocs() ?? []);
        const coffin = locs
            .filter((l) => /^coffin$/i.test(l.name))
            .sort((a, b) => Math.hypot(a.x - COUNT_SPAWN.x, a.z - COUNT_SPAWN.z) - Math.hypot(b.x - COUNT_SPAWN.x, b.z - COUNT_SPAWN.z))[0];
        if (!coffin) throw new Error(`no coffin in the crypt near (${pos(q).x},${pos(q).z})`);
        if (!coffin.options?.some((o) => /^open$/i.test(o))) {
            q.log(`coffin is open [${coffin.options?.join('|')}] — waiting for it to shut`);
            await q.sdk.waitForTicks(4 + attempt);
            continue;
        }
        const seen = new Set(counts(q).map((n) => n.index));
        const since = cursor(q);
        await q.bot.interactLoc(coffin, /^open$/i);
        await untilTicks(q.sdk, () => counts(q).some((n) => !seen.has(n.index)), 15);
        const mine = counts(q)
            .filter((n) => !seen.has(n.index))
            .sort((a, b) => a.distance - b.distance)[0];
        if (mine) return mine;
        // The coffin raises nobody while our own Count is still alive (quest_vampire_coffin_open):
        // after a lost round he is the one beside us that we have not already lost.
        const ours = counts(q).filter((n) => !lost.has(n.index) && n.distance <= 3).sort((a, b) => a.distance - b.distance)[0];
        if (ours) return ours;
        q.log(`coffin opened, no new Count (${linesSince(q, since).join(' / ') || 'no messages'})`);
    }
    throw new Error('the coffin never raised a Count Draynor');
}

/** Rounds of coffin + fight before giving up: a round is lost when the Count we picked was another account's. */
const RAISES = 4;

/**
 * Fight one Count until the stake goes in (true) or he is gone without it (false:
 * another account's Count, staked or despawned under us — ours never leaves).
 */
async function fightCount(q: Quest, count: NearbyNpc, since: number): Promise<boolean> {
    const staked = () => linesSince(q, since).some((t) => /hammer the stake/i.test(t));
    const t0 = tickNow(q.sdk);
    let attacks = 0;
    while (!staked() && tickNow(q.sdk) - t0 < FIGHT_TICKS) {
        const npc = counts(q).find((n) => n.index === count.index);
        // The kill and the stake message land together; give the message a moment.
        if (!npc) return untilTicks(q.sdk, staked, 4);
        if (attacks === 0 || !q.sdk.getState()?.player?.combat?.inCombat) {
            attacks++;
            const res = await q.bot.attack(npc, ticksToMs(10));
            if (!res.success) q.log(`attack #${attacks} on Count Draynor: ${res.message}`);
        }
        await untilTicks(q.sdk, () => staked() || !q.sdk.getState()?.player?.combat?.inCombat, 6);
    }
    if (!staked()) throw new Error(`Count Draynor not staked after ${tickNow(q.sdk) - t0}t (${attacks} attacks; ${linesSince(q, since).slice(-4).join(' / ') || 'no messages'})`);
    return true;
}

/** Raise and stake a Count; then idle while the quest completes. */
async function slayCount(q: Quest): Promise<void> {
    const since = cursor(q);
    const t0 = tickNow(q.sdk);
    const lost = new Set<number>();
    for (let round = 1; round <= RAISES; round++) {
        const count = await raiseCount(q, lost);
        if (await fightCount(q, count, since)) {
            const lines = linesSince(q, since);
            q.log(`staked Count Draynor in ${tickNow(q.sdk) - t0}t (round ${round}${lines.some((t) => /seems to weaken/i.test(t)) ? ', garlic weakened him' : ''})`);
            // quest_vampire_complete is queued 3 ticks after the stake: no clicks until it lands.
            await untilTicks(q.sdk, () => linesSince(q, since).some((t) => /completed the|quest complete/i.test(t)) || !!q.sdk.getState()?.dialog?.isOpen, 12);
            await q.sdk.waitForTicks(2);
            return;
        }
        lost.add(count.index);
        q.log(`round ${round}: Count #${count.index} left without our stake (another account's) — raising another`);
    }
    throw new Error(`no Count Draynor staked in ${RAISES} rounds`);
}

await runQuest({
    id: 'vampire',
    hub: 'draynor',
    journal: { label: 'Vampire Slayer', title: 'Vampire Slayer' },
    stages: [
        { id: 'unstarted', rule: { id: 'vampire:unstarted', kind: 'unstarted', all: ['I can start this quest by speaking to'] } },
        { id: 'started', rule: { id: 'vampire:started', kind: 'active', all: ['I need to speak to'], none: ['QUEST COMPLETE'] } },
        { id: 'harlow', rule: { id: 'vampire:harlow', kind: 'active', all: ['I have spoken to Dr Harlow'], none: ['QUEST COMPLETE'] } },
        { id: 'armed', rule: { id: 'vampire:armed', kind: 'active', all: ['gave me a stake'], none: ['QUEST COMPLETE'] } },
        { id: 'complete', rule: { id: 'vampire:complete', kind: 'complete', all: ['QUEST COMPLETE'] } },
    ],
    transitions: [
        { from: 'unstarted', to: 'started', at: MORGAN, talk: { npc: /^morgan$/i, choices: [/up for an adventure/i] } },
        { from: 'started', to: 'harlow', at: HARLOW, talk: { npc: /^dr harlow$/i, choices: [/morgan needs your help/i] } },
        // With a beer held Harlow drinks it and hands over the stake (no choice page until you hold one).
        { from: 'harlow', to: 'armed', at: HARLOW, needs: [{ item: 'beer', count: 1 }], talk: { npc: /^dr harlow$/i, choices: [/ok mate/i] } },
        {
            from: 'armed',
            to: 'complete',
            needs: [
                { item: 'stake', count: 1 },
                { item: 'hammer', count: 1 },
                // Only weakens him (count_draynor_garlic); cheap insurance for weaker accounts.
                { item: 'garlic', count: 1 },
            ],
            run: async (q) => {
                try {
                    await enterCrypt(q);
                    await slayCount(q);
                } finally {
                    // The runner's walks cannot leave the crypt or the manor (its front door only lets you in).
                    await leaveManor(q);
                }
            },
        },
    ],
});
