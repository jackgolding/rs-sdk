/**
 * Eadgar's Ruse — Burntmeat's tasty human: a drunk parrot, a scarecrow, a troll truth potion, and the goutweed storeroom.
 *
 *   bun bots/quests/eadgars-ruse.ts {botname}
 *
 * Journal rules from quest_eadgar/scripts/eadgar_journal.rs2; the route is lib/eadgar.ts over lib/troll-stronghold.ts's
 * troll-country hops. Needs Druidic Ritual, Death Plateau and Troll Stronghold (Eadgar freed: an account whose Troll
 * Stronghold left him jailed frees him on the way, Thieving 30 or a kill). Gates: base Herblore 31 (Sanfew; the potion),
 * Agility 15 (the troll rocks). Protect from Melee (Prayer 43) through the stronghold's L2 hall when the account has it.
 * Supplies: vodka, a pineapple (Heckel Funch, Grand Tree), a knife, 2 logs, 5 raw chickens, 10 grain, a tinderbox, a pestle
 * and mortar, a ranarr weed (banked or jackthief), a vial of water, coins (climbing boots, the shop), a melee weapon,
 * sharks. Reward: 1 QP, Trollheim Teleport.
 *
 * Staging (2026-11-04): QUEST COMPLETE (journal-verified) on a fresh account (qlqgea2, ~10 min on the fast engine, goutweed
 * on the first try) and on qlqgea1 resumed at stage 70 after a death (the troll pass's mountain trolls: the troll country
 * is now crossed through the stronghold and the prison's back door, lib/troll-stronghold.ts assumeTrollStrongholdDone).
 */
import { runQuest, type Quest, type Need } from './lib/run-quest';
import * as ead from './lib/eadgar';
import * as troll from './lib/troll-stronghold';
import { ARDOUGNE_BANK, FALADOR_WEST_BANK } from './tiles';

// Every Troll Stronghold gate (Dad beaten, the prison door, the secret door) is open on this quest.
troll.assumeTrollStrongholdDone();

const stage = (id: string, kind: 'unstarted' | 'active' | 'complete', all: string[], none: string[] = []) => ({
    id,
    rule: { id: `eadgar:${id}`, kind, all, none },
});

const journal = { label: "Eadgar's Ruse", title: "Eadgar's Ruse" };
const stages = [
    stage('unstarted', 'unstarted', ['I can start this quest by speaking to']),
    stage('started', 'active', ['where to get Goutweed']),
    // 15: Eadgar first ("ask the Troll Cook"); the script talks to Burntmeat first, so only a resume sees it.
    { ...stage('spoke_eadgar', 'active', ['I should ask the']), optional: true },
    stage('tasty', 'active', ['I need to get a tasty human']),
    stage('needs_parrot', 'active', ['bring Eadgar a parrot']),
    stage('explained', 'active', ['hide the parrot somewhere']),
    stage('hid', 'active', ["rest of Mad Eadgar's plan"]),
    stage('needs_items', 'active', ['I still need to bring him']),
    stage('needs_potion', 'active', ['(make a troll truth potion|I should go give it to)']),
    stage('parrot_back', 'active', ['fetch the parrot back from the']),
    stage('got_parrot', 'active', ['I should go tell Eadgar']),
    stage('fake_man', 'active', ['give the fake man to the']),
    stage('burnt_meat', 'active', ['key to the storeroom and unlock it']),
    stage('unlocked', 'active', ['sneak in and get some']),
    // 100 with the goutweed held (the journal reads the pack).
    stage('goutweed', 'active', ['bring this to']),
    stage('complete', 'complete', ['QUEST COMPLETE']),
];
const ORDER = stages.map((s) => s.id);
const before = (q: Quest, id: string) => ORDER.indexOf(q.stage) < ORDER.indexOf(id);

const held = (q: Quest, re: RegExp) => q.sdk.getInventory().some((i) => re.test(i.name));
const hasBoots = (q: Quest) => q.count(/^climbing boots$/i) > 0 || q.sdk.getEquipment().some((i) => /^climbing boots$/i.test(i.name)) || !!q.sdk.findBankItem(/^climbing boots$/i);
/** Taken at the open hub bank only, so eating them never stops a transition with NEEDS STOCK. */
const banked = (q: Quest, item: string, count: number) => (q.sdk.isBankOpen() ? [{ item, count }] : []);

const CARRY: Array<string | number> = ['climbing boots', 'drunk parrot', 'alco-chunks', 'dirty robe', 'ground thistle', 'dried thistle', 'troll potion', ead.RANARR_UNF, 'fake man', 'storeroom key', 'goutweed'];

/**
 * The pack, by what is still ahead. The full start (28 slots): coins, weapon and boots (worn), vodka and chunks (the
 * parrot), 2 logs (scarecrow + fire), 5 chickens, 10 grain, tinderbox, pestle and mortar, ranarr + vial, and the rest
 * sharks. The thistle is ground and the ranarr potion made on the first trip, so the tools go early.
 */
function kit(q: Quest): Need[] {
    // Coins at the hub bank only (Tenzing's boots and the grocer spend some; a short count mid-quest is no reason to source).
    const needs: Need[] = [{ item: 'melee weapon', count: 1 }, ...banked(q, 'coins', hasBoots(q) ? 30 : 60)];
    const parrotInHand = held(q, ead.RE.parrot) || !!q.sdk.findBankItem(ead.RE.parrot) || held(q, ead.RE.alco);
    if (before(q, 'explained') && !parrotInHand) needs.push({ item: 'vodka', count: 1 }, { item: 'pineapple chunks', count: 1 });
    const thistleDone = held(q, ead.RE.ground) || held(q, ead.RE.potion) || !!q.sdk.findBankItem(ead.RE.ground);
    // Eadgar takes the logs, chickens and grain in the same talk that moves 60 -> 70.
    const scarecrow = before(q, 'needs_items');
    if (scarecrow) needs.push({ item: 'grain', count: 10 }, { item: 'raw chicken', count: 5 });
    if (before(q, 'parrot_back') && !thistleDone) needs.push({ item: 'tinderbox', count: 1 }, { item: 'pestle and mortar', count: 1 });
    const logs = (scarecrow ? 1 : 0) + (before(q, 'parrot_back') && !thistleDone ? 1 : 0);
    if (logs) needs.push({ item: 'logs', count: logs });
    const potionDone = held(q, ead.RE.potion) || ead.hasUnf(q) || q.sdk.getBankItems().some((b) => b.id === ead.RANARR_UNF);
    if (before(q, 'parrot_back') && !potionDone) needs.push({ item: 'ranarr weed', count: 1 }, { item: 'vial of water', count: 1 });
    // Coins, the weapon and the boots (worn once the first step starts) take a slot each in the bank's pack.
    // Quest items from an earlier run (the parrot, the potion...) are withdrawn after these needs: keep their slots free.
    const questItems = CARRY.filter((c) => c !== 'climbing boots').filter((c) => {
        const match = (i: { id: number; name: string }) => (typeof c === 'number' ? i.id === c : i.name.toLowerCase() === c);
        return q.sdk.getInventory().some(match) || q.sdk.getBankItems().some(match);
    }).length;
    const slots = 3 + questItems + needs.reduce((n, x) => n + (/^(coins|melee weapon)$/.test(x.item) ? 0 : x.count), 0);
    needs.push(...banked(q, 'shark', Math.max(2, 28 - slots)));
    return needs;
}

/** Wear the boots and wield the weapon; make the ranarr potion as soon as both halves are held (one slot less). */
const go = (run: (q: Quest) => Promise<void>) => async (q: Quest) => {
    await troll.ensureBoots(q);
    const boots = q.sdk.findInventoryItem(/^climbing boots$/i);
    if (boots) await q.bot.equipItem(boots).catch(() => undefined);
    await troll.wieldWeapon(q);
    if (held(q, ead.RE.ranarr) && held(q, ead.RE.vial)) await ead.makeUnf(q).catch((e: Error) => q.log(e.message));
    await run(q);
};

/**
 * Sharks into the free slots (but `spare`) at a bank on the way, the empties banked: the start's pack is full of
 * scarecrow parts, so the first top-up is Ardougne's after the zoo, the second Falador's on the robe trip.
 */
async function restock(q: Quest, bank: { x: number; z: number }, spare = 2): Promise<void> {
    await q.goTo(bank, 4);
    if (!(await q.bot.openBank()).success) return;
    for (const junk of q.sdk.getInventory().filter((i) => /^(vial|burnt meat|ashes|bones|knife|feather)$/i.test(i.name))) await q.bot.depositItem(junk, -1).catch(() => undefined);
    await q.sdk.waitForTicks(1);
    // Protect from Melee through the stronghold's L2 hall: two doses' worth when the account has the prayer and the potions.
    const pots = q.sdk.findBankItem(/^prayer potion\(4\)$/i);
    const havePots = q.sdk.getInventory().filter((i) => /^prayer potion\(\d\)$/i.test(i.name)).length;
    if (pots && q.level('prayer') >= 43 && havePots < 2) await q.bot.withdrawItem(pots, Math.min(pots.count, 2 - havePots)).catch(() => undefined);
    await q.sdk.waitForTicks(1);
    const free = 28 - q.sdk.getInventory().length;
    const sharks = q.sdk.findBankItem(/^shark$/i);
    if (sharks && free > spare) await q.bot.withdrawItem(sharks, Math.min(sharks.count, free - spare)).catch(() => undefined);
    await q.sdk.waitForTicks(1);
    await q.bot.closeBank().catch(() => undefined);
    q.log(`eadgar: restocked: ${q.count(/^shark$/i)} sharks`);
}

await runQuest({
    id: 'eadgar',
    hub: 'falador-west',
    journal,
    skills: { herblore: 31, agility: 15 },
    carry: CARRY,
    // Burntmeat, Eadgar and the rack are per player; the storeroom's patrol and the thistle are shared.
    maxConcurrent: 2,
    stages,
    transitions: [
        {
            from: 'unstarted',
            to: 'started',
            needs: kit,
            run: go(async (q) => {
                if (!held(q, ead.RE.parrot)) {
                    await ead.catchParrot(q);
                    await restock(q, ARDOUGNE_BANK, 1);
                }
                await ead.start(q);
            }),
        },
        // 10 -> 20: Burntmeat first, so one Eadgar talk gives 30. The thistle is ground on the way (Trollheim).
        { from: 'started', to: 'tasty', needs: kit, run: go((q) => ead.talkCook(q, 'tasty human').then(() => undefined)) },
        { from: 'spoke_eadgar', to: 'tasty', needs: kit, run: go((q) => ead.talkCook(q, 'tasty human').then(() => undefined)) },
        {
            from: 'tasty',
            to: 'needs_parrot',
            needs: kit,
            run: go(async (q) => {
                await ead.catchParrot(q);
                await ead.groundThistle(q);
                await ead.talkEadgar(q, 'a plan');
            }),
        },
        {
            from: 'needs_parrot',
            to: 'explained',
            needs: kit,
            run: go(async (q) => {
                await ead.catchParrot(q);
                await ead.groundThistle(q);
                await ead.talkEadgar(q, 'the parrot');
            }),
        },
        { from: 'explained', to: 'hid', needs: kit, run: go((q) => ead.hideParrot(q)) },
        // 60 -> 70, and the logs, chickens and grain handed over in the same talk.
        { from: 'hid', to: 'needs_items', needs: kit, run: go((q) => ead.talkEadgar(q, 'the scarecrow').then(() => undefined)) },
        {
            from: 'needs_items',
            to: 'needs_potion',
            needs: kit,
            run: go(async (q) => {
                await ead.robe(q);
                await restock(q, FALADOR_WEST_BANK, 3);
                await ead.groundThistle(q);
                await ead.talkEadgar(q, 'the robe', () => !held(q, ead.RE.robe));
            }),
        },
        {
            from: 'needs_potion',
            to: 'parrot_back',
            needs: kit,
            run: go(async (q) => {
                await ead.groundThistle(q);
                await ead.mixPotion(q);
                await ead.talkEadgar(q, 'the potion');
            }),
        },
        { from: 'parrot_back', to: 'got_parrot', needs: kit, run: go((q) => ead.fetchParrot(q)) },
        {
            from: 'got_parrot',
            to: 'fake_man',
            needs: kit,
            run: go(async (q) => {
                await ead.talkEadgar(q, 'the fake man');
            }),
        },
        { from: 'fake_man', to: 'burnt_meat', needs: kit, run: go((q) => ead.talkCook(q, 'the fake man').then(() => undefined)) },
        {
            from: 'burnt_meat',
            to: 'unlocked',
            needs: kit,
            run: go(async (q) => {
                await ead.storeroomKey(q);
                await ead.intoStoreroom(q);
            }),
        },
        { from: 'unlocked', to: 'goutweed', needs: kit, run: go((q) => ead.takeGoutweed(q)) },
        { from: 'goutweed', to: 'complete', needs: kit, run: go((q) => ead.handIn(q)) },
    ],
});
