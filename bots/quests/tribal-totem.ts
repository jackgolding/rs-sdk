/**
 * Tribal Totem — steal Kangai Mau's totem back from Lord Handelmort's mansion, East Ardougne.
 *
 *   bun bots/quests/tribal-totem.ts {botname}
 *
 * Journal rules from quest_totem/scripts/totem_journal.rs2; the depot, Cromperty and the mansion are
 * lib/tribal-totem.ts; the Brimhaven boats are lib/jungle-potion.ts. Thieving 21 (the stairs trap).
 * Items: coins for the Brimhaven boats (30 each way, two round trips). Reward: 1 QP, Thieving XP,
 * five swordfish.
 */
import { runQuest, type Quest } from './lib/run-quest';
import { homeFromJungle, toJungle } from './lib/jungle-potion';
import { CROMPERTY, held, inMansion, leaveMansion, OBJ, stealTotem, swapLabel, teleportIn } from './lib/tribal-totem';

/** Kangai Mau in the Shrimp & Parrot, Brimhaven (npc spawn 2791,3182). */
const KANGAI = { x: 2791, z: 3182 };
/** The R.P.D.T. depot's employees (npc spawns 2644-2647,3271-3276). */
const RPDT = { x: 2645, z: 3274 };

const stage = (id: string, kind: 'unstarted' | 'active' | 'complete', all: string[], none: string[] = []) => ({
    id,
    rule: { id: `totem:${id}`, kind, all, none },
});

const pos = (q: Quest) => {
    const p = q.sdk.getState()?.player;
    return { x: p?.worldX ?? 0, z: p?.worldZ ?? 0, level: p?.level ?? 0 };
};

/** Brimhaven and back: Kangai Mau, then the boat home (run-quest's own Karamja exit is Musa Point). */
async function kangai(q: Quest, choices: RegExp[]): Promise<void> {
    await toJungle(q, KANGAI, 4);
    await q.talk(/^kangai mau$/i, choices, KANGAI);
    await homeFromJungle(q);
}

const fares = [{ item: 'coins', count: 100 }];

await runQuest({
    id: 'totem',
    hub: 'ardougne',
    carry: [OBJ.label, OBJ.totem],
    skills: { thieving: 21 },
    journal: { label: 'Tribal Totem', title: 'Tribal Totem' },
    stages: [
        stage('unstarted', 'unstarted', ['I can start this quest by speaking to']),
        stage('started', 'active', ['I need to get into']),
        stage('marked', 'active', ['to deliver the crate now']),
        stage('delivered', 'active', ['to teleport me inside now']),
        stage('inside', 'active', ['teleported myself inside'], ['take the tribal totem back', 'QUEST COMPLETE']),
        stage('totem', 'active', ['take the tribal totem back'], ['QUEST COMPLETE']),
        stage('complete', 'complete', ['QUEST COMPLETE']),
    ],
    transitions: [
        { from: 'unstarted', to: 'started', needs: fares, run: (q) => kangai(q, [/i'?m in search of adventure/i, /ok,? i will get it back/i]) },
        { from: 'started', to: 'marked', run: (q) => swapLabel(q, () => false) },
        { from: 'marked', to: 'delivered', at: RPDT, talk: { npc: /^rpdt employee$/i, choices: [/when are you going to deliver this crate/i] } },
        { from: 'delivered', to: 'inside', at: CROMPERTY, run: (q) => teleportIn(q) },
        {
            from: 'inside',
            to: 'totem',
            run: async (q) => {
                // Resumed outside (the epilogue walked out): Cromperty puts us back in.
                if (!inMansion(pos(q)) && !held(q, OBJ.totem)) await teleportIn(q);
                try {
                    await stealTotem(q);
                } finally {
                    await leaveMansion(q);
                }
            },
        },
        {
            from: 'totem',
            to: 'complete',
            needs: fares,
            run: async (q) => {
                await leaveMansion(q);
                await kangai(q, []);
            },
        },
    ],
});
