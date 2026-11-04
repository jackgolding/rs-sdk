/**
 * Haunted Mine — the Zealot's key, the points puzzle, the glowing fungus, the lift, Treus Dayth and the salve crystals.
 *
 *   bun bots/quests/haunted-mine.ts {botname}
 *
 * Journal rules from quest_hauntedmine/scripts/hauntedmine_journal.rs2; the route is lib/haunted-mine.ts. Gates: Priest
 * in Peril (Morytania: under the Salve, through Mort Myre), Agility 15 and Crafting 35 (journal), a level 95 fight.
 * Supplies: a melee weapon, a chisel, sharks (Mort Myre's ghasts rot a few on the way), Crumble Undead runes (chaos,
 * earth, air; Magic 39) and Varrock Teleport runes out of the mine (law, air, fire). Prayer 43 is used when present
 * (Protect from Missiles against the room's pickaxes). Reward: 2 QP, the salve shard.
 *
 * Staging (2026-11-04): QUEST COMPLETE (journal-verified) on a fresh account (qlqfhm3, Treus on his first life) and
 * from a stage-8 fixture (qlqfhm2, four lives: a kill that lands as he hops dies as the faded type and the stage stays
 * 8 — lib/haunted-mine.ts fightTreus takes the key again until the journal moves). Prayer 40+ and Magic 39 help;
 * Treus is fought in melee.
 */
import { runQuest, type Quest } from './lib/run-quest';
import { VARROCK_EAST_BANK } from './tiles';
import * as hm from './lib/haunted-mine';
import { readJournalCheckpoint } from '../../quest-lab/journal-reader';

const stage = (id: string, kind: 'unstarted' | 'active' | 'complete', all: string[], none: string[] = []) => ({
    id,
    rule: { id: `hauntedmine:${id}`, kind, all, none },
});

const journal = { label: 'Haunted Mine', title: 'Haunted Mine' };
const stages = [
    stage('unstarted', 'unstarted', ['I can start this quest by speaking to the Saradominist']),
    stage('started', 'active', ['other than the sealed main entrance']),
    stage('inside', 'active', ['lower levels where apparently the']),
    // 4: the valve touched; the lift ride (5) follows in the same step.
    { ...stage('liftfound', 'active', ['requires a key to be started']), optional: true },
    stage('liftused', 'active', ['I managed to start the lift']),
    // 6: down the dark stairs with no light (sent back up).
    { ...stage('dark', 'active', ['too dark to navigate at this level']), optional: true },
    // 7 and 8 (the key taken, Treus up) read the same.
    stage('stairs', 'active', ['I had to use a glowing fungus']),
    stage('defeated', 'active', ['I should now find where to use this key']),
    stage('reward', 'active', ['make use of them']),
    stage('complete', 'complete', ['QUEST COMPLETE']),
];
type Sdk = Parameters<typeof readJournalCheckpoint>[0];
const passes = async (sdk: Sdk, id: string) => (await readJournalCheckpoint(sdk, journal, stages.find((s) => s.id === id)!.rule)).verdict?.verdict === 'PASS';

/**
 * Consumables are claimed only until the first transition runs: the prologue withdraws them and prepare buys the
 * runes, but a later transition never walks back out of the mine to top up food or runes it is spending.
 */
let underway = false;
const SHARKS = 15;
const POTIONS = 2;
/**
 * Melee for Treus Dayth (lib/haunted-mine.ts fightTreus); Crumble Undead runes for when melee cannot reach him, and two
 * Varrock Teleports out of the mine (a failed step, and the end).
 */
const consumables = (q: Quest) => [
    // 15 sharks: the pack also holds the weapon, chisel, runes, potions, both keys, the fungus and the shard.
    { item: 'shark', count: SHARKS },
    { item: 'law rune', count: 2 },
    { item: 'air rune', count: 46 },
    { item: 'fire rune', count: 2 },
    // Crumble Undead (Magic 39) when melee cannot reach Treus: 20 casts (Aubury sells all three near the hub).
    { item: 'chaos rune', count: 20 },
    { item: 'earth rune', count: 40 },
    // Protect from Missiles against the pickaxes: banked potions only (no source procedure for them).
    ...(q.sdk.isBankOpen() && q.sdk.findBankItem(/^prayer potion\(\d\)$/i) ? [{ item: 'prayer potion', count: POTIONS }] : []),
];
const kit = (q: Quest) => [{ item: 'melee weapon', count: 1 }, { item: 'chisel', count: 1 }, ...(underway ? [] : consumables(q))];
/**
 * A failed step teleports out before it throws: left standing in the mine with auto-retaliate off, the skeletal
 * miners and possessed pickaxes killed a stopped staging account (qlqehm2, 2026-11-04).
 */
const go = (run: (q: Quest) => Promise<void>) => async (q: Quest) => {
    underway = true;
    try {
        await run(q);
    } catch (e) {
        q.log(`hm: ${(e as Error).message} — teleporting out before the retry`);
        await hm.leaveHauntedMine(q).catch((err: Error) => q.log(`hm: ${err.message}`));
        // The retry re-enters the mine with this pack: top the food and potions back up at the hub first.
        await restock(q).catch((err: Error) => q.log(`hm: restock: ${err.message}`));
        throw e;
    }
};

/** Out of the mine after a failed step: back to the hub bank for sharks, potions and teleport runes. */
async function restock(q: Quest): Promise<void> {
    if (hm.inHauntedMineArea(pos(q))) return;
    await q.goTo(VARROCK_EAST_BANK, 4);
    if (!(await q.bot.openBank()).success) return;
    const top = async (re: RegExp, want: number) => {
        const have = q.count(re);
        const banked = q.sdk.getBankItems().find((b) => re.test(b.name));
        if (banked && have < want) await q.bot.withdrawItem(banked, Math.min(banked.count, want - have)).catch(() => undefined);
        await q.sdk.waitForTicks(1);
    };
    for (const junk of q.sdk.getInventory().filter((i) => /^(vial|rotten food|ashes|damp tinderbox|bones)$/i.test(i.name))) await q.bot.depositItem(junk, -1).catch(() => undefined);
    await top(/^shark$/i, SHARKS);
    await top(/^prayer potion\(4\)$/i, POTIONS);
    await top(/^law rune$/i, 2);
    await top(/^air rune$/i, 46);
    await top(/^chaos rune$/i, 20);
    await top(/^earth rune$/i, 40);
    await top(/^fire rune$/i, 2);
    await q.bot.closeBank().catch(() => undefined);
    q.log(`hm: restocked at the hub: ${q.count(/^shark$/i)} sharks, ${q.count(/^prayer potion\(\d\)$/i)} potions`);
}
const pos = (q: Quest) => {
    const p = q.sdk.getState()?.player;
    return { x: p?.worldX ?? 0, z: p?.worldZ ?? 0, level: p?.level ?? 0 };
};

await runQuest({
    id: 'hauntedmine',
    hub: 'varrock-east',
    journal,
    skills: { agility: 15, crafting: 35 },
    carry: ["zealot's key", 'crystal-mine key'],
    // The points levers and carts are per player; the Zealot, the lift and Treus' room are shared.
    maxConcurrent: 2,
    stages,
    transitions: [
        { from: 'unstarted', to: 'started', needs: kit, run: go((q) => hm.start(q)) },
        {
            from: 'started',
            to: 'inside',
            needs: kit,
            run: go(async (q) => {
                await hm.liftKey(q);
                await hm.intoMine(q);
            }),
        },
        { from: 'inside', to: 'liftused', needs: kit, run: go((q) => hm.fungusToLift(q)) },
        { from: 'liftfound', to: 'liftused', needs: kit, run: go((q) => hm.fungusToLift(q)) },
        { from: 'liftused', to: 'stairs', needs: kit, run: go((q) => hm.darkStairs(q)) },
        { from: 'dark', to: 'stairs', needs: kit, run: go((q) => hm.darkStairs(q)) },
        { from: 'stairs', to: 'defeated', needs: kit, run: go((q) => hm.fightTreus(q, () => passes(q.sdk, 'defeated'))) },
        { from: 'defeated', to: 'reward', needs: kit, run: go((q) => hm.rewardDoor(q)) },
        {
            from: 'reward',
            to: 'complete',
            needs: kit,
            run: go(async (q) => {
                await hm.cutCrystal(q, () => passes(q.sdk, 'complete'));
                if (await passes(q.sdk, 'complete')) await hm.leaveHauntedMine(q);
            }),
        },
    ],
});
