/**
 * Goblin Diplomacy — reusable.
 *
 *   bun bots/quests/goblin-diplomacy.ts {botname}
 *
 * Bartender → 3 goblin mail + dyes → orange / blue / brown armour → Goblin Village.
 */
import { appendFileSync } from 'fs';
import { join } from 'path';
import { runScript } from '../../sdk/runner';
import { readJournalCheckpoint } from '../../quest-lab/journal-reader';
import type { JournalRule } from '../../quest-lab/evidence';
import { createRun, appendCheckpoint, summarizeRun, safeRunId } from '../../quest-lab/records';
import {
    buyAtShop,
    ensureCoins,
    withdrawFromBank,
    nearestBank,
    SHOPS,
    type SupplyCtx
} from './quest-supplies';

const BARTENDER = { x: 3045, z: 3257 };
const AGGIE = { x: 3086, z: 3259 };
const WYSON = { x: 3027, z: 3379 };
const GOBLINS = { x: 3252, z: 3230 };
const GOBLIN_VILLAGE = { x: 2957, z: 3511 };
const REDBERRIES = { x: 3268, z: 3370 };
const ONIONS = { x: 2950, z: 3251 };

const MAIL = /^goblin mail$/i;
const ORANGE_MAIL = /^orange goblin mail$/i;
const BLUE_MAIL = /^blue goblin mail$/i;
const RED_DYE = /^red dye$/i;
const YELLOW_DYE = /^yellow dye$/i;
const BLUE_DYE = /^blue dye$/i;
const ORANGE_DYE = /^orange dye$/i;
const REDBERRY = /^redberries?$/i;
const ONION = /^onion$/i;
const WOAD = /^woad leaf$/i;
const COINS = /^coins$/i;
const FOOD = /^(lobster|swordfish|tuna|shark|trout|salmon|bread|cake|wine)$/i;

const botName = process.argv.slice(2).find((a) => !a.startsWith('-')) ?? '';
const GRIND_LOG = join(process.cwd(), 'bots', botName, 'grind.log');

await runScript(async ({ bot, sdk }) => {
    const log = (msg: string) => {
        console.log(msg);
        try {
            appendFileSync(GRIND_LOG, `${new Date().toISOString()} ${msg}\n`);
        } catch {
            /* ignore */
        }
    };

    let lastIntent = '';
    function intent(msg: string): void {
        if (msg === lastIntent) return;
        lastIntent = msg;
        console.log(`> ${msg}`);
        void sdk.showIntent(msg);
    }

    function pos() {
        const p = sdk.getState()?.player;
        return {
            x: p?.worldX ?? 0,
            z: p?.worldZ ?? 0,
            hp: p?.hp ?? 10,
            maxHp: p?.maxHp ?? 10,
            isDead: p?.isDead ?? false
        };
    }

    function distTo(x: number, z: number): number {
        return Math.hypot(pos().x - x, pos().z - z);
    }

    function count(pattern: RegExp): number {
        return sdk.getInventory().reduce((n, i) => n + (pattern.test(i.name) ? (i.count ?? 1) : 0), 0);
    }

    function mailCount(): number {
        return count(MAIL) + count(ORANGE_MAIL) + count(BLUE_MAIL);
    }

    // Label from questlist.if [gobdip] option=, title from
    // ~quest_journal("Goblin Diplomacy", ...) in gobdip_journal.rs2.
    const JOURNAL = { label: 'Goblin Diplomacy', title: 'Goblin Diplomacy' };

    // Journal rules, read from the quest's own journal script
    // (server/content/scripts/quests/quest_gobdip/scripts/gobdip_journal.rs2):
    //   not_started -> "I can start this quest by talking to the Bartender in Port Sarim."
    //   complete    -> "... they're clearly not the smartest ... QUEST COMPLETE!"
    // Every journal stage, keyed on sentences UNIQUE in both directions
    // (later entries restate earlier ones as @str@, so later rules are tried
    // first and complete — the only one with its own marker — first of all).
    const RULES: Record<string, JournalRule> = {
        complete: {
            id: 'gobdip:complete',
            kind: 'complete',
            all: ['QUEST COMPLETE', 'their favourite']
        },
        gave_brown: {
            id: 'gobdip:gave_brown',
            kind: 'active',
            all: ['I should see if they liked the', 'Brown Goblin Armour']
        },
        gave_blue: {
            id: 'gobdip:gave_blue',
            kind: 'active',
            all: ['some of their original', 'Brown Goblin Armour', 'to try out instead']
        },
        gave_orange: {
            id: 'gobdip:gave_orange',
            kind: 'active',
            all: ['I gave some Orange Goblin Armour', 'Blue Goblin Armour', 'try out instead']
        },
        will_bring: {
            id: 'gobdip:will_bring',
            kind: 'active',
            all: ['I should bring the goblins some', 'Orange Goblin Armour']
        },
        started: {
            id: 'gobdip:started',
            kind: 'active',
            all: ['before it turns into a full blown war']
        },
        not_started: {
            id: 'gobdip:not_started',
            kind: 'unstarted',
            all: ['I can start this quest by talking to', 'Bartender', 'Port Sarim']
        }
    };
    const STAGE_ORDER = ['complete', 'gave_brown', 'gave_blue', 'gave_orange', 'will_bring', 'started', 'not_started'];

    /** The first stage rule that passes is the account's real stage. */
    async function readStage(): Promise<string> {
        for (const name of STAGE_ORDER) {
            const read = await readJournalCheckpoint(sdk, JOURNAL, RULES[name]!);
            log(`  stage probe ${name}: ${read.verdict?.verdict ?? 'UNKNOWN'} (${read.reason})`);
            if (read.verdict?.verdict === 'PASS') return name;
        }
        return 'unknown';
    }

    let journalComplete = false;
    let lastJournalCheck = 0;
    /**
     * Goblin Diplomacy completion, read from the QUEST JOURNAL.
     *
     * This used to be a chat/game-message regex ("completed the ... goblin
     * diplomacy"). Chat is transient: a restart loses it, and a generic
     * congratulations line from another quest reads as a false pass.
     */
    async function questDone(): Promise<boolean> {
        if (Date.now() - lastJournalCheck < 5_000) return journalComplete;
        lastJournalCheck = Date.now();
        const read = await readJournalCheckpoint(sdk, JOURNAL, RULES.complete!);
        journalComplete = read.verdict?.verdict === 'PASS';
        return journalComplete;
    }

    async function closeUi(): Promise<void> {
        for (let i = 0; i < 8; i++) {
            await bot.dismissBlockingUI();
            const dialog = sdk.getDialog();
            const opts = dialog?.options ?? [];
            if (dialog?.isOpen && (opts.length <= 1 || opts.every((o) => /click here to continue/i.test(o.text)))) {
                await sdk.sendClickDialog(opts[0]?.index ?? 0);
                await sdk.waitForTicks(1);
                continue;
            }
            if (sdk.getState()?.shop?.isOpen || sdk.getState()?.bank?.isOpen || sdk.getState()?.interface?.isOpen) {
                await bot.closeInterface();
                await sdk.waitForTicks(1);
                continue;
            }
            break;
        }
    }

    function dlgSig(): string {
        const d = sdk.getDialog();
        // Consecutive "Click here to continue" pages are byte-identical in
        // index+text, so the componentId is part of the key: without it a
        // working pump reads every advance as "changed nothing" and a stuck
        // pump is indistinguishable from a slow one.
        return d?.isOpen ? d.options.map((o) => `${o.index}:${o.componentId}:${o.text}`).join('|') : '<closed>';
    }

    /**
     * Click a dialog option ONCE, then wait for the page to change.
     * Double-clicking a continue page latches resumedPauseButton client-side
     * and pins the dialog forever (every later continue is refused while the
     * choice it raced never arrives), so a repeat click is never the retry —
     * re-talk is. Returns true only if the page actually moved.
     */
    async function clickOnce(idx: number, maxTicks = 12): Promise<boolean> {
        // One RESUME can be ignored (dialog still opening server-side), so
        // retry the same page a few times — but SPACED, never hammered: a
        // second RESUME while one is pending latches resumedPauseButton and
        // pins the dialog, while 5-tick gaps converge (proven live).
        for (let attempt = 1; attempt <= 4; attempt++) {
            const before = dlgSig();
            const r = await sdk.sendClickDialog(idx);
            if (!r.success) {
                log(`click ${idx} rejected: ${r.message}`);
                return false;
            }
            for (let i = 0; i < 6; i++) {
                await sdk.waitForTicks(1);
                if (dlgSig() !== before) return true;
            }
            log(`click ${idx} no change yet (try ${attempt}/4)`);
        }
        return false;
    }

    /**
     * Close any open dialog with ONE close packet and settle. Never hammer:
     * dismissBlockingUI re-clicks a lone continue while it waits for a state
     * change, and a second RESUME on the same page latches resumedPauseButton
     * client-side — every later continue is then refused and the talk loops
     * on a frozen page forever. Call this (never closeUi) before talks.
     */
    async function closeModalOnce(): Promise<void> {
        if (!sdk.getDialog()?.isOpen) return;
        await sdk.sendCloseModal().catch(() => {});
        await sdk.waitForTicks(2);
    }

    /**
     * Pump continue pages until the dialog shows want (settled: same page
     * across a 2-tick gap, since the client republishes stale pages briefly),
     * closes, or stops advancing. Never clicks a choice — the caller owns it.
     */
    async function pumpUntil(want: RegExp, maxPages = 14): Promise<'want' | 'closed' | 'stuck' | 'choice'> {
        for (let p = 0; p < maxPages; p++) {
            const d = sdk.getDialog();
            if (!d?.isOpen) {
                await sdk.waitForTicks(2);
                if (!sdk.getDialog()?.isOpen) return 'closed';
                continue;
            }
            const sig = dlgSig();
            if (want.test(sig)) {
                await sdk.waitForTicks(2);
                if (dlgSig() === sig) return 'want';
                continue;
            }
            const opts = d.options ?? [];
            if (opts.length > 0 && opts.every((o) => /click here to continue/i.test(o.text))) {
                if (!(await clickOnce(opts[0]!.index))) return 'stuck';
                continue;
            }
            if (opts.length > 0) return 'choice';
            await sdk.waitForTicks(1);
        }
        return 'stuck';
    }

    async function chat(choices: RegExp[] = [], max = 36): Promise<string[]> {
        const seen: string[] = [];
        const isContinue = (opts: Array<{ text: string }>) =>
            opts.length > 0 &&
            opts.every((o) => /click here to continue/i.test(o.text)) &&
            !opts.some((o) => /coins/i.test(o.text));
        for (let i = 0; i < max; i++) {
            const dialog = sdk.getDialog();
            if (!dialog?.isOpen) {
                await sdk.waitForTicks(1);
                if (!sdk.getDialog()?.isOpen) break;
            }
            const opts = sdk.getDialog()?.options ?? [];
            log(
                `chat: ${opts.map((o) => `[${o.index}] ${o.text}`).join(' | ') || '(no options)'} text=${JSON.stringify(sdk.getDialog()?.text ?? '')}`
            );
            for (const o of opts) seen.push(o.text);
            if (isContinue(opts)) {
                await clickOnce(opts[0]?.index ?? 0);
                continue;
            }
            let match: (typeof opts)[number] | undefined;
            for (const c of choices) {
                match = opts.find((o) => c.test(o.text));
                if (match) break;
            }
            if (!match) {
                log(`chat unmatched wanted=${choices.map(String).join(', ')}`);
                break;
            }
            log(`chat click [${match.index}] ${match.text}`);
            await clickOnce(match.index);
        }
        return seen;
    }

    async function walkNear(x: number, z: number, tolerance = 4): Promise<boolean> {
        if (distTo(x, z) <= tolerance) return true;
        const r = await bot.walkTo(x, z, Math.min(tolerance, 3));
        return r.success || distTo(x, z) <= tolerance + 2;
    }

    async function eatIfNeeded(): Promise<void> {
        if (pos().hp >= pos().maxHp - 3) return;
        const food = sdk.findInventoryItem(FOOD);
        if (food) await bot.eatFood(food);
    }

    async function startQuest(): Promise<void> {
        intent('Starting quest at Rusty Anchor bartender');
        for (let attempt = 1; attempt <= 3; attempt++) {
            await closeModalOnce();
            await walkNear(BARTENDER.x, BARTENDER.z, 3);
            const bar = sdk.findNearbyNpc(/bartender/i);
            if (!bar) {
                log(`no bartender @ ${pos().x},${pos().z}`);
                await sdk.waitForTicks(2);
                continue;
            }
            await bot.talkTo(bar);
            await sdk.waitForTicks(2);
            await chat([/not very busy/i]);
            // Consume to CLOSED: the start varp sets at the label end.
            for (let q = 0; q < 20 && sdk.getDialog()?.isOpen; q++) {
                await chat();
                await sdk.waitForTicks(1);
            }
            await sdk.waitForTicks(3);
            await closeModalOnce();
            const stage = await readStage();
            log(`start attempt ${attempt}: stage=${stage}`);
            if (stage !== 'not_started' && stage !== 'unknown') {
                await checkpointOnce('started');
                return;
            }
        }
        throw new Error(`bartender never started the quest @ ${pos().x},${pos().z}`);
    }

    async function lootMail(): Promise<boolean> {
        const before = mailCount();
        const item =
            sdk.findGroundItem(MAIL, { reachable: true }) ??
            sdk.findGroundItem(MAIL) ??
            (await sdk.scanFindGroundItem(MAIL, 24).catch(() => null));
        if (!item) return false;
        intent(`Picking up goblin mail (${before}/3)`);
        const r = await bot.pickupItem(item);
        log(`Loot mail: ${r.success ? 'ok' : r.message} @ ${item.x},${item.z} now=${mailCount()}/3`);
        return mailCount() > before;
    }

    async function killForMail(): Promise<void> {
        while (mailCount() < 3) {
            await eatIfNeeded();
            if (pos().isDead) {
                await sdk.waitForCondition((s) => !s.player.isDead, 30_000).catch(() => {});
                continue;
            }
            if (await lootMail()) continue;
            intent(`Killing goblins for mail (${mailCount()}/3)`);
            await walkNear(GOBLINS.x, GOBLINS.z, 6);
            if (await lootMail()) continue;
            const gob = sdk.findNearbyNpc(/^goblin$/i, { reachable: true }) ?? sdk.findNearbyNpc(/^goblin$/i);
            if (!gob) {
                log(`No goblin @ ${pos().x},${pos().z}`);
                await sdk.waitForTicks(2);
                continue;
            }
            const atk = await bot.attack(gob, 12_000);
            if (!atk.success) log(`attack goblin: ${atk.message}`);
            await sdk.waitForCondition(() => !!sdk.findGroundItem(MAIL) || mailCount() >= 3, 8_000).catch(() => null);
            await lootMail();
            await sdk.waitForTicks(1);
        }
    }

    const supplyCtx = (): SupplyCtx => ({ bot, sdk, log, intent, walkNear, closeUi });

    async function ensureSupplies(): Promise<void> {
        const ctx = supplyCtx();
        await ensureCoins(ctx, 80);
        // No food purchase: this quest needs none, and Wydin's stocks neither
        // wine ("item not found in shop") nor bread ("out of stock") in this
        // revision, so the call walked to Port Sarim and returned empty. Same
        // defect vampire-slayer.ts and witchs-house.ts had. Whatever the bank
        // already holds is used.
    }

    async function pickRedberries(): Promise<void> {
        if (count(REDBERRY) >= 3) return;
        // Bank-first: bushes and shop stock are shared world state that
        // depletes across runs; the field pick below is the live fallback.
        for (let i = 0; i < 2 && count(REDBERRY) < 3; i++) {
            if (!(await withdrawFromBank(supplyCtx(), REDBERRY, count(REDBERRY) + 1))) break;
        }
        if (count(REDBERRY) >= 3) {
            log(`redberries from bank: ${count(REDBERRY)}/3`);
            return;
        }
        intent('Picking redberries');
        await walkNear(REDBERRIES.x, REDBERRIES.z, 4);
        await sdk.scanNearbyLocs(8).catch(() => {});
        const bush = sdk.findNearbyLoc(/redberry/i) ?? sdk.findNearbyLoc(/berry/i);
        if (!bush) {
            log(`no redberry bush @ ${pos().x},${pos().z}`);
        }
        if (bush) {
            while (count(REDBERRY) < 3) {
                const had = count(REDBERRY);
                const r = await bot.interactLoc(bush, /pick/i);
                await sdk.waitForTicks(2);
                log(`berry pick: ${r.success ? 'ok' : r.message} now=${count(REDBERRY)}/3`);
                if (!r.success || count(REDBERRY) <= had) break;
            }
        }
        if (count(REDBERRY) < 3) {
            await ensureCoins(supplyCtx(), 15);
            await buyAtShop(supplyCtx(), SHOPS.WYDIN, [
                { pattern: REDBERRY, amount: 3, label: 'redberries' }
            ]);
        }
    }

    async function pickOnions(): Promise<void> {
        if (count(ONION) >= 2) return;
        for (let i = 0; i < 2 && count(ONION) < 2; i++) {
            if (!(await withdrawFromBank(supplyCtx(), ONION, count(ONION) + 1))) break;
        }
        if (count(ONION) >= 2) {
            log(`onions from bank: ${count(ONION)}/2`);
            return;
        }
        intent('Picking onions');
        await walkNear(ONIONS.x, ONIONS.z, 4);
        await sdk.scanNearbyLocs(8).catch(() => {});
        const plant = sdk.findNearbyLoc(/^onion$/i);
        if (!plant) {
            log(`no onion patch @ ${pos().x},${pos().z}`);
            return;
        }
        while (count(ONION) < 2) {
            const had = count(ONION);
            const r = await bot.interactLoc(plant, /pick/i);
            await sdk.waitForTicks(2);
            log(`onion pick: ${r.success ? 'ok' : r.message} now=${count(ONION)}/2`);
            if (!r.success || count(ONION) <= had) break;
        }
    }

    async function buyWoad(): Promise<void> {
        if (count(WOAD) >= 2) return;
        await ensureCoins(supplyCtx(), 25);
        intent('Buying woad leaves from Wyson');
        // Proven live: each page gets ONE click plus a change-wait. Clicking a
        // continue twice latches resumedPauseButton and pins the dialog, and
        // the grant sits two continues past the 20gp pick, so a fixed-tick
        // sample after the pick reads a working purchase as failed.
        for (let attempt = 1; attempt <= 4 && count(WOAD) < 2; attempt++) {
            const woadBefore = count(WOAD);
            log(`woad attempt ${attempt} @ ${pos().x},${pos().z} woad=${woadBefore} gp=${count(COINS)}`);
            await closeModalOnce();
            await walkNear(WYSON.x, WYSON.z, 2);
            const wyson = sdk.findNearbyNpc(/wyson/i);
            if (!wyson) {
                log(`no Wyson @ ${pos().x},${pos().z}`);
                await sdk.waitForTicks(2);
                continue;
            }
            await bot.talkTo(wyson);
            await sdk.waitForTicks(2);
            if ((await pumpUntil(/looking for woad/i)) !== 'want') {
                log(`woad talk ${attempt}: no woad choice (${dlgSig().slice(0, 120)})`);
                continue;
            }
            const looking = sdk.getDialog()!.options.find((o) => /looking for woad/i.test(o.text))!;
            if (!(await clickOnce(looking.index))) continue;
            const menu = await pumpUntil(/how about 20 coins/i);
            if (menu !== 'want') {
                log(`woad talk ${attempt}: no price menu (${menu} ${dlgSig().slice(0, 120)})`);
                continue;
            }
            if (!(await clickOnce(4))) continue;
            // Echo + "more than fair" + grant mes lines: pump everything.
            for (let q = 0; q < 12 && count(WOAD) <= woadBefore; q++) {
                const d = sdk.getDialog();
                if (!d?.isOpen) {
                    await sdk.waitForTicks(2);
                    continue;
                }
                const opts = d.options ?? [];
                if (opts.length > 0 && opts.every((o) => /click here to continue/i.test(o.text))) {
                    if (!(await clickOnce(opts[0]!.index))) break;
                    continue;
                }
                await sdk.waitForTicks(2);
            }
            await sdk.waitForTicks(3);
            log(`woad after talk ${attempt}: woad=${count(WOAD)} gp=${count(COINS)}`);
            await closeModalOnce();
        }
        if (count(WOAD) < 2) throw new Error(`still no woad @ ${pos().x},${pos().z} gp=${count(COINS)}`);
    }

    async function makeDyeAtAggie(color: 'red' | 'yellow' | 'blue'): Promise<void> {
        const dye = color === 'red' ? RED_DYE : color === 'yellow' ? YELLOW_DYE : BLUE_DYE;
        if (count(dye) > 0) return;
        // Use-item path ([opnpcu,aggie] in aggie.rs2): one use-item plus a
        // continue pump, instead of the 3-menu dialog chain. Same checks
        // (ingredients + 5gp), same grant, far fewer latchable pages.
        const src = color === 'red' ? REDBERRY : color === 'yellow' ? ONION : WOAD;
        const need = color === 'red' ? 3 : 2;
        if (count(src) < need) throw new Error(`cannot make ${color} dye: short ingredients`);
        await ensureCoins(supplyCtx(), 5);
        intent(`Getting ${color} dye from Aggie`);
        await closeModalOnce();
        await walkNear(AGGIE.x, AGGIE.z, 3);
        const aggie = sdk.findNearbyNpc(/^aggie$/i);
        if (!aggie) throw new Error(`Aggie not found @ ${pos().x},${pos().z}`);
        const item = sdk.findInventoryItem(src);
        if (!item) throw new Error(`lost ${color} dye ingredient in transit`);
        const before = count(dye);
        const use = await bot.useItemOnNpc(item, aggie);
        log(`use ${color} ingredient on Aggie: ${use.success ? 'ok' : use.message}`);
        for (let q = 0; q < 14 && count(dye) <= before; q++) {
            const d = sdk.getDialog();
            if (!d?.isOpen) {
                await sdk.waitForTicks(2);
                continue;
            }
            const opts = d.options ?? [];
            if (opts.length > 0 && opts.every((o) => /click here to continue/i.test(o.text))) {
                if (!(await clickOnce(opts[0]!.index))) break;
                continue;
            }
            log(`aggie ${color} page: ${dlgSig().slice(0, 160)}`);
            await sdk.waitForTicks(2);
        }
        await sdk.waitForTicks(3);
        await closeModalOnce();
        if (count(dye) <= before) throw new Error(`Aggie gave no ${color} dye @ ${pos().x},${pos().z}`);
        log(`${color} dye ok`);
    }

    async function makeOrangeDye(): Promise<void> {
        if (count(ORANGE_DYE) > 0) return;
        if (count(RED_DYE) < 1) await makeDyeAtAggie('red');
        if (count(YELLOW_DYE) < 1) await makeDyeAtAggie('yellow');
        intent('Mixing orange dye');
        // Slots lag gateway state: re-resolve per attempt, verify the effect.
        for (let i = 0; i < 2 && count(ORANGE_DYE) < 1; i++) {
            const red = sdk.findInventoryItem(RED_DYE);
            const yellow = sdk.findInventoryItem(YELLOW_DYE);
            if (!red || !yellow) break;
            await sdk.sendUseItemOnItem(red.slot, yellow.slot);
            await sdk.waitForTicks(3);
        }
        if (count(ORANGE_DYE) < 1) throw new Error('red+yellow did not mix');
    }

    async function dyeMail(dye: RegExp, result: RegExp, label: string): Promise<void> {
        if (count(result) > 0) return;
        intent(`Dyeing goblin mail ${label}`);
        for (let i = 0; i < 2 && count(result) < 1; i++) {
            const plain = sdk.findInventoryItem(MAIL);
            const bottle = sdk.findInventoryItem(dye);
            if (!plain || !bottle) break;
            await sdk.sendUseItemOnItem(bottle.slot, plain.slot);
            await sdk.waitForTicks(3);
        }
        if (count(result) < 1) throw new Error(`no ${label} mail after dyeing`);
    }

    async function prepareArmour(): Promise<void> {
        await ensureSupplies();
        // Bank-first: goblin mail is tradeable, so a stocked shelf beats the
        // ~4%-drop grind. Hunt only the remainder (unstackables withdraw one
        // per call, hence the loop).
        if (mailCount() < 3) {
            for (let i = 0; i < 4 && mailCount() < 3; i++) {
                if (!(await withdrawFromBank(supplyCtx(), MAIL, mailCount() + 1))) break;
            }
            log(`mail after bank: ${mailCount()}/3`);
        }
        if (mailCount() < 3) await killForMail();
        await ensureCoins(supplyCtx(), 35);
        if (count(REDBERRY) < 3) await pickRedberries();
        if (count(ONION) < 2) await pickOnions();
        if (count(WOAD) < 2) await buyWoad();
        await makeDyeAtAggie('red');
        await makeDyeAtAggie('yellow');
        await makeDyeAtAggie('blue');
        await makeOrangeDye();
        await dyeMail(ORANGE_DYE, ORANGE_MAIL, 'orange');
        await dyeMail(BLUE_DYE, BLUE_MAIL, 'blue');
    }

    async function handInGenerals(): Promise<void> {
        intent('Handing in armour at Goblin Village');
        // Wartface stage_1 offers the colour choice; stages 2-4 hand over
        // automatically on talk (nagging if the armour is missing). Grade on
        // the journal, never on clicks: poll settled after each talk.
        for (let round = 1; round <= 8 && !(await questDone()); round++) {
            await closeModalOnce();
            await walkNear(GOBLIN_VILLAGE.x, GOBLIN_VILLAGE.z, 4);
            const wart = sdk.findNearbyNpc(/wartface/i);
            if (!wart) {
                log(`No generals @ ${pos().x},${pos().z}`);
                await sdk.waitForTicks(3);
                continue;
            }
            await bot.talkTo(wart);
            await sdk.waitForTicks(2);
            for (let q = 0; q < 24 && sdk.getDialog()?.isOpen; q++) {
                const sig = dlgSig();
                const colour = sdk.getDialog()!.options.find((o) => /pick an armour colour/i.test(o.text));
                if (colour) {
                    log(`generals pick colour [${colour.index}]`);
                    await clickOnce(colour.index);
                    continue;
                }
                const opts = sdk.getDialog()!.options;
                if (opts.length > 0 && opts.every((o) => /click here to continue/i.test(o.text))) {
                    if (!(await clickOnce(opts[0]!.index))) break;
                    continue;
                }
                // Any other choice page: log it and stop this talk rather
                // than answering blindly (a wrong branch replays the trial).
                log(`generals page: ${sig.slice(0, 160)}`);
                break;
            }
            // The varp/journal write lands behind p_delay: settle, re-read.
            await sdk.waitForTicks(5);
            await closeModalOnce();
            const stage = await readStage();
            log(`generals round ${round}: stage=${stage} mail=${mailCount()}`);
        }
        for (let i = 0; i < 30 && !(await questDone()); i++) {
            await sdk.waitForTicks(1);
        }
    }

    const _seenCheckpoints = new Set<string>();
    async function checkpointOnce(name: string, ruleKey?: string): Promise<boolean> {
        const read = await readJournalCheckpoint(sdk, JOURNAL, RULES[ruleKey ?? name]!);
        const verdict = read.verdict?.verdict ?? 'UNKNOWN';
        appendCheckpoint(run.directory, {
            checkpointId: name,
            verdict,
            reason: read.reason,
            kind: RULES[ruleKey ?? name]!.kind,
            rawLines: read.rawLines,
        });
        _seenCheckpoints.add(name);
        log(`CHECKPOINT ${name} ${verdict}: ${read.reason}`);
        return verdict === 'PASS';
    }

    async function bankOutAndIdle(why: string): Promise<void> {
        try {
            const b = nearestBank(pos().x, pos().z);
            intent(`Banking out (${why})`);
            await closeModalOnce();
            await walkNear(b.x, b.z, 3);
            if (!(sdk.getState()?.bank?.isOpen || (await bot.openBank()).success)) {
                log(`bank-out: could not open bank @ ${pos().x},${pos().z}`);
                return;
            }
            await sdk.waitForTicks(2);
            for (const worn of sdk.getEquipment()) {
                if (worn) await bot.unequipItem(worn).catch(() => undefined);
            }
            let n = 0;
            for (let i = 0; i < 40; i++) {
                const item = sdk.getInventory().find((e) => (e.count ?? 0) > 0);
                if (!item) break;
                const r = await bot.depositItem(item, -1);
                if (!r.success) {
                    await sdk.waitForTicks(2);
                    continue;
                }
                n++;
                await sdk.waitForTicks(1);
            }
            await bot.closeBank().catch(() => undefined);
            log(`bank-out done (${why}): deposited ${n} stacks, bag=${sdk.getInventory().length}`);
        } catch (err) {
            log(`WARN bank-out failed (${why}): ${(err as Error).message}`);
        }
    }

    await bot.skipTutorial();
    await closeUi();
    log(`Goblin Diplomacy start @ ${pos().x},${pos().z}`);

    // Ask the journal BEFORE shopping: an account that already finished must
    // not be sent to fetch mail and dyes first.
    const startStage = await readStage();
    log(`Goblin Diplomacy journal stage at start: ${startStage}`);
    if (startStage === 'unknown') {
        throw new Error('could not determine the Goblin Diplomacy stage from the journal');
    }
    const MODE = process.env.QUEST_LAB_MODE === 'staging' ? 'staging' : 'development';
    const requiredCheckpoints =
        startStage === 'complete'
            ? ['complete']
            : startStage === 'not_started'
              ? ['unstarted', 'started', 'complete']
              : ['started', 'complete'];
    const run = createRun(join(process.cwd(), 'quest-lab', 'runs'), safeRunId('gobdip', botName, new Date().toISOString()), {
        questId: 'gobdip',
        account: botName,
        mode: MODE,
        scriptHash: Bun.hash(await Bun.file(import.meta.path).text()).toString(16),
        fixtureHash: process.env.QUEST_LAB_FIXTURE_HASH ?? 'unrecorded',
        contentHash: process.env.QUEST_LAB_CONTENT_HASH ?? 'unrecorded',
        requiredCheckpoints,
    });
    log(`Run record: ${run.directory} (mode=${MODE} required=${requiredCheckpoints.join(',')})`);
    if (startStage === 'complete') {
        await checkpointOnce('complete');
        await bankOutAndIdle('already complete');
        return;
    }
    if (startStage === 'not_started') {
        if (!(await checkpointOnce('unstarted', 'not_started'))) throw new Error('unstarted checkpoint did not PASS on a fresh account');
    } else {
        await checkpointOnce('started');
    }

    const until = Date.now() + 30 * 60_000;
    while (Date.now() < until && !(await questDone())) {
        await closeModalOnce();
        await ensureSupplies();
        if (count(ORANGE_MAIL) > 0 && count(BLUE_MAIL) > 0 && count(MAIL) > 0) {
            await handInGenerals();
            if (await questDone()) break;
        } else {
            await startQuest();
            await prepareArmour();
        }
        log(
            `mail=${count(MAIL)} orange=${count(ORANGE_MAIL)} blue=${count(BLUE_MAIL)} dyes r/y/b/o=${count(RED_DYE)}/${count(YELLOW_DYE)}/${count(BLUE_DYE)}/${count(ORANGE_DYE)}`
        );
        await sdk.waitForTicks(2);
    }

    if (!(await questDone())) throw new Error(`Goblin Diplomacy unfinished @ ${pos().x},${pos().z}`);
    if (!(await checkpointOnce('complete'))) throw new Error('completion checkpoint failed: journal does not report Goblin Diplomacy complete');
    const summary = summarizeRun(run.directory);
    if (!summary.ok) {
        throw new Error(`promotion gate failed: missing/unpassed ${JSON.stringify(summary.missing.concat(summary.failed))}`);
    }
    log(`Run record verified (${run.directory})`);
    await bankOutAndIdle('quest complete');
    log('QUEST COMPLETE Goblin Diplomacy');
});
