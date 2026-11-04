/**
 * Throne of Miscellania — peace with Etceteria (anthem, treaty, a giant pen), Princess Astrid's hand, the people's support.
 *
 *   bun bots/quests/throne-of-miscellania.ts {botname}
 *
 * Journal rules from quest_misc/scripts/misc_journal.rs2; the route is lib/miscellania.ts. Needs Heroes' Quest (the throne
 * room's guard) and The Fremennik Trials (the Rellekka longship). Gates: Herblore 35 (weeding for approval). Male characters
 * only (a female one courts Prince Brand: not built; the script stops with a clear error). Supplies: coins (flowers, a
 * sickle), an iron bar (Derrik's nib), logs (the pen), a bow and a gold (or gem) ring for Astrid. Reward: 1 QP, Managing
 * Miscellania.
 *
 * Staging (2026-11-04): QUEST COMPLETE (journal-verified) on qlqgms1 and qlqgms2 (fresh fixtures; each was restarted
 * mid-quest while the courting answers and the weeding count were fixed, which also exercised the island's leave hook).
 * Weeding is ~6-8 ticks a patch at Herblore 60; the coronation talk is the approval check.
 */
import { runQuest, type Quest, type Need } from './lib/run-quest';
import * as misc from './lib/miscellania';

const stage = (id: string, kind: 'unstarted' | 'active' | 'complete', all: string[], none: string[] = []) => ({
    id,
    rule: { id: `misc:${id}`, kind, all, none },
});

const journal = { label: 'Throne of Miscellania', title: 'Throne of Miscellania' };
// Each stage's line appears from that stage on (struck through later); the runner takes the last that passes.
const stages = [
    stage('unstarted', 'unstarted', ['I can start this quest by talking to']),
    stage('talked_king', 'active', ['I offered to become the new ruler']),
    stage('talked_queen', 'active', ['She wants King Vargas to recognise']),
    stage('recognise', 'active', ['will recognise Etceteria if it changes']),
    stage('bard', 'active', ['find a bard']),
    stage('awful', 'active', ['Prince Brand composed an anthem']),
    stage('corrected', 'active', ['Advisor Ghrim made a better version']),
    stage('treaty', 'active', ['Queen Sigrid gave me the treaty']),
    stage('gave_treaty', 'active', ['I gave the King the treaty']),
    stage('signed', 'active', ['I gave the King the giant pen']),
    stage('complete', 'complete', ['QUEST COMPLETE']),
];
const ORDER = stages.map((s) => s.id);
const before = (q: Quest, id: string) => ORDER.indexOf(q.stage) < ORDER.indexOf(id);

const BOWS = /^(magic|yew|maple|willow|oak)? ?(shortbow|longbow)$/i;
const RINGS = ['gold ring', 'sapphire ring', 'emerald ring', 'ruby ring', 'diamond ring'];
const has = (q: Quest, re: RegExp) => q.sdk.getInventory().some((i) => re.test(i.name)) || (q.sdk.isBankOpen() && !!q.sdk.findBankItem(re));
const BOW_HELD = (q: Quest) => q.sdk.getInventory().find((i) => BOWS.test(i.name))?.name.toLowerCase();

function kit(q: Quest): Need[] {
    // Coins at the hub bank only: flowers and a sickle spend some, and a short count mid-quest must not send us pickpocketing.
    const needs: Need[] = q.sdk.isBankOpen() ? [{ item: 'coins', count: 200 }] : [];
    if (before(q, 'signed') && !has(q, /^giant (pen|nib)$/i)) needs.push({ item: 'iron bar', count: 1 }, { item: 'logs', count: 1 });
    // Astrid's gifts until she has said yes (the journal is read in the steps; a held bow/ring is cheap to carry).
    // Courting is done in the step after Vargas' first talk; later (a resumed run) only gifts the account still has are
    // taken: the ones Astrid accepted are gone, and asking the mule for them again would stop the run with NEEDS STOCK.
    const courting = before(q, 'talked_queen');
    const bow = BOW_HELD(q) ?? (q.sdk.isBankOpen() ? q.sdk.getBankItems().find((b) => BOWS.test(b.name))?.name.toLowerCase() : undefined);
    if (bow || courting) needs.push({ item: bow ?? 'magic shortbow', count: 1 });
    const ring = RINGS.find((r) => has(q, new RegExp(`^${r}$`, 'i')));
    if (ring || courting) needs.push({ item: ring ?? 'gold ring', count: 1 });
    return needs;
}
const RING_RE = new RegExp(`^(${RINGS.join('|')})$`, 'i');

await runQuest({
    id: 'misc',
    hub: 'seers',
    journal,
    skills: { herblore: 35 },
    carry: ['awful anthem', 'good anthem', 'treaty', 'giant nib', 'giant pen', 'flowers'],
    // Vargas, Sigrid, Astrid and the herb patches serve everyone; the patches rest 50 ticks each after a weeding.
    maxConcurrent: 2,
    stages,
    transitions: [
        { from: 'unstarted', to: 'talked_king', needs: kit, run: async (q) => void (await misc.talkVargas(q, 'the throne', [/^if i may be so bold/i])) },
        {
            from: 'talked_king',
            to: 'talked_queen',
            needs: kit,
            run: async (q) => {
                await misc.court(q, BOWS, RING_RE);
                await misc.talkSigrid(q, 'peace');
            },
        },
        { from: 'talked_queen', to: 'recognise', needs: kit, run: async (q) => void (await misc.talkVargas(q, 'recognition')) },
        { from: 'recognise', to: 'bard', needs: kit, run: async (q) => void (await misc.talkSigrid(q, 'the anthem')) },
        { from: 'bard', to: 'awful', needs: kit, run: (q) => misc.brandAnthem(q) },
        { from: 'awful', to: 'corrected', needs: kit, run: (q) => misc.ghrimAnthem(q) },
        { from: 'corrected', to: 'treaty', needs: kit, run: async (q) => void (await misc.talkSigrid(q, 'the good anthem')) },
        { from: 'treaty', to: 'gave_treaty', needs: kit, run: async (q) => void (await misc.talkVargas(q, 'the treaty')) },
        {
            from: 'gave_treaty',
            to: 'signed',
            needs: kit,
            run: async (q) => {
                await misc.giantPen(q);
                await misc.talkVargas(q, 'the pen');
            },
        },
        {
            from: 'signed',
            to: 'complete',
            needs: kit,
            run: async (q) => {
                await misc.court(q, BOWS, RING_RE);
                await misc.supportAndCrown(q);
                await misc.leaveIsland(q);
            },
        },
    ],
});
