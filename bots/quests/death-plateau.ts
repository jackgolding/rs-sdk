/**
 * Death Plateau — reusable.
 *
 *   bun bots/quests/death-plateau.ts {botname}
 *   bun bots/quests/death-plateau.ts {botname} --deposit
 *
 * Denulth → Eohric → Harold (you gamble for the combination) → stone balls
 * → Saba → Tenzing → Dunstan → certificate → spiked boots → supplies → scout
 * → Denulth.
 */
import { join } from 'path';
import { runScript } from '../../sdk/runner';
import { appendGrindLog } from '../../sdk/grind-log';
import { readJournalCheckpoint } from '../../quest-lab/journal-reader';
import type { JournalRule } from '../../quest-lab/evidence';
import {
    ensureCoins,
    nearestBank,
    type SupplyCtx,
    withdrawFromBank
} from './quest-supplies';

const DENULTH = { x: 2896, z: 3528 };
const EOHRIC = { x: 2902, z: 3565 };
const HAROLD = { x: 2905, z: 3539 };
const TOSTIG = { x: 2906, z: 3537 };
const DUNSTAN = { x: 2919, z: 3574 };
const TENZING = { x: 2820, z: 3556 };
const SABA_CAVE = { x: 2857, z: 3578 };
const SABA_INSIDE = { x: 2270, z: 4759 };
const STILE = { x: 2817, z: 3562 };
const SCOUT = { x: 2864, z: 3608 };
const BARB_FISH = { x: 3109, z: 3433 };
const FALLY_FURNACE = { x: 2975, z: 3369 };
const FALLY_IRON = { x: 3058, z: 3376 };

const BALL_SPAWNS = [
    { id: 3111, color: 'yellow', x: 2893, z: 3561 },
    { id: 3113, color: 'green', x: 2893, z: 3562 },
    { id: 3112, color: 'purple', x: 2893, z: 3563 },
    { id: 3110, color: 'blue', x: 2893, z: 3564 },
    { id: 3109, color: 'red', x: 2893, z: 3565 }
];

const BALL_SLOTS: Array<{ id: number; color: string; x: number; z: number }> = [
    { id: 3110, color: 'blue', x: 2894, z: 3562 },
    { id: 3111, color: 'yellow', x: 2895, z: 3562 },
    { id: 3109, color: 'red', x: 2894, z: 3563 },
    { id: 3112, color: 'purple', x: 2895, z: 3563 },
    { id: 3113, color: 'green', x: 2895, z: 3564 }
];

const COINS = /^coins$/i;
const BREAD = /^bread$/i;
const TROUT = /^trout$/i;
const RAW_TROUT = /^raw trout$/i;
const IRON_BAR = /^iron bar$/i;
const IRON_ORE = /^iron ore$/i;
const IOU = /^iou$/i;
const COMBO = /^combination$/i;
const CERT = /^certificate$/i;
const BOOTS = /^climbing boots$/i;
const SPIKED = /^spiked boots$/i;
const MAP = /^secret way map$/i;
const CLAWS = /^steel claws$/i;
const FOOD = /^(swordfish|lobster|tuna|shark|salmon|trout|bread)$/i;
const COMBAT_GEAR =
    /^(dragon longsword|dragonhide body|dragonhide chaps|dragon vambraces|amulet of glory|ring of wealth|cape of saradomin|rune (full helm|kiteshield|med helm))$/i;

/** East of Heroes' Guild — the guild door at (2902, 3510) is quest-locked. */
const TO_BURTHORPE = [
    { x: 2965, z: 3392 },
    { x: 2965, z: 3451 },
    { x: 2936, z: 3488 },
    { x: 2918, z: 3524 },
    { x: 2896, z: 3528 }
];
const GUILD_EAST = { x: 2916, z: 3522 };
const CAMP_FIRE = { x: 2893, z: 3532 };
const GNOME_GATE = { x: 2459, z: 3383 };

/** Burthorpe → east of guild → Taverley → White Wolf → Catherby → Seers → gnome gate. */
const TO_GNOME = [
    GUILD_EAST,
    { x: 2936, z: 3488 },
    { x: 2884, z: 3451 },
    { x: 2872, z: 3427 },
    { x: 2848, z: 3440 },
    { x: 2816, z: 3444 },
    { x: 2757, z: 3477 },
    { x: 2662, z: 3375 },
    { x: 2550, z: 3410 },
    GNOME_GATE
];

const TO_SCOUT = [
    { x: 2817, z: 3562 },
    { x: 2816, z: 3576 },
    { x: 2816, z: 3592 },
    { x: 2832, z: 3604 },
    { x: 2864, z: 3608 }
];

/** Closing this interface forfeits Harold's game — never close it for the player. */
const HAROLD_DICE_IF = 6675;

const botName = process.argv.slice(2).find((a) => !a.startsWith('-')) ?? '';
const DEPOSIT_ONLY = process.argv.includes('--deposit');
const GRIND_LOG = join(process.cwd(), 'bots', botName, 'grind.log');

await runScript(async ({ bot, sdk }) => {
    const log = (msg: string) => {
        console.log(msg);
        appendGrindLog(GRIND_LOG, `${new Date().toISOString()} ${msg}`);
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
            level: p?.level ?? 0,
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

    function hasId(id: number): boolean {
        return sdk.getInventory().some((i) => i.id === id && (i.count ?? 0) > 0);
    }

    function attackXp(): number {
        return sdk.getSkill('Attack')?.experience ?? 0;
    }

    function messages(): string {
        const msgs = sdk.getState()?.gameMessages ?? [];
        const chatHist = sdk.getChat({ limit: 50, types: [0] }).map((m) => m.text);
        return [...msgs.map((m) => m.text), ...chatHist].join('\n');
    }

    /**
     * Death Plateau stage and completion, read from the QUEST JOURNAL.
     *
     * This used to be `attackXp() >= xpBefore + 2500` plus a chat regex.
     * Attack XP is this quest's REWARD, so ANY Attack XP — combat crossing
     * White Wolf Mountain, or during the scout leg — reads as completion, and
     * a restart is indistinguishable from a finish. The chat regex had the
     * same blindness halfway: it never checked the OTHER track.
     *
     * Rules come from the quest's own handler
     * (quest_death/scripts/death_journal.rs2), each on a sentence unique to
     * its stage. The journal's complete branch only renders at
     * %death_equiproom = ^death_complete, but the predicate still names a
     * sentence from EACH track — equip-room ("unlocked the door") and map
     * ("safe for the Imperial Guard") — so a half-finished quest can never
     * satisfy it, even if the handler is ever reworded.
     *
     * The active text swaps its opening line once the path is scouted
     * ("offered to help" becomes "found another way"), so those are two
     * separate stage rules and the probe tries the later stage first.
     */
    const DEATH_JOURNAL = { label: 'Death Plateau', title: 'Death Plateau' };
    const DEATH_STAGES: Record<string, JournalRule> = {
        not_started: {
            id: 'death:not_started',
            kind: 'unstarted',
            all: ['I can start this quest by speaking to Denulth'],
        },
        started: {
            id: 'death:started',
            kind: 'active',
            all: ['I have offered to help Denulth'],
        },
        scouted: {
            id: 'death:scouted',
            kind: 'active',
            all: ['I have found another way up Death Plateau'],
        },
        complete: {
            id: 'death:complete',
            kind: 'complete',
            all: ['QUEST COMPLETE', 'unlocked the door', 'safe for the Imperial Guard'],
        },
    };

    /** The first stage rule that passes is the account's real stage. */
    async function readStage(): Promise<string> {
        for (const name of ['complete', 'scouted', 'started', 'not_started']) {
            const read = await readJournalCheckpoint(sdk, DEATH_JOURNAL, DEATH_STAGES[name]!);
            log(`  stage probe ${name}: ${read.verdict?.verdict ?? 'UNKNOWN'} (${read.reason})`);
            if (read.verdict?.verdict === 'PASS') return name;
        }
        return 'unknown';
    }

    let journalComplete = false;
    let lastJournalCheck = 0;
    /** Journal-backed completion, throttled: opening the journal is not free. */
    async function questDone(): Promise<boolean> {
        // Steel claws are Denulth's hand-in reward — holding them IS done.
        if (count(CLAWS) > 0) return true;
        if (Date.now() - lastJournalCheck < 5_000) return journalComplete;
        lastJournalCheck = Date.now();
        const read = await readJournalCheckpoint(sdk, DEATH_JOURNAL, DEATH_STAGES.complete!);
        journalComplete = read.verdict?.verdict === 'PASS';
        return journalComplete;
    }

    function doorUnlocked(): boolean {
        return /equipment room door has unlocked/i.test(messages());
    }

    function scouted(): boolean {
        return /no trolls on the secret path|far enough, i can see death plateau|you should go and speak to denulth/i.test(
            messages()
        );
    }

    function mapHandedIn(): boolean {
        return /you give denulth the map/i.test(messages());
    }

    function inGnomeStronghold(): boolean {
        const p = pos();
        return p.x >= 2400 && p.x <= 2505 && p.z >= 3388 && p.z <= 3530;
    }

    /** East bank / railings at Baxtorian Falls — walkTo routes onto the island. */
    function inWaterfallLedge(): boolean {
        const p = pos();
        return p.x >= 2505 && p.x <= 2575 && p.z >= 3448 && p.z <= 3515;
    }

    async function hopTo(x: number, z: number, timeout = 8_000): Promise<void> {
        await sdk.sendWalk(x, z, true);
        await sdk.waitForCondition(() => distTo(x, z) <= 4, timeout).catch(() => {});
    }

    async function leaveWhiteWolf(): Promise<void> {
        const p = pos();
        if (p.x < 2830 || p.x > 2885 || p.z < 3445 || p.z > 3515) return;
        await eatIfNeeded();
        intent('Crossing White Wolf west to Catherby');
        let guard = 0;
        while (pos().x > 2820 && pos().z > 3446 && guard++ < 24) {
            const n = pos();
            await hopTo(n.x - 2, Math.min(n.z, 3508) - 3);
            await eatIfNeeded();
        }
        if (pos().x > 2820) await hopTo(2816, 3444);
    }

    async function leaveWaterfall(): Promise<void> {
        if (!inWaterfallLedge()) return;
        intent('Leaving waterfall ledge (south to the road)');
        for (const hop of [
            { x: 2562, z: 3455 },
            { x: 2562, z: 3425 },
            { x: 2550, z: 3410 }
        ]) {
            await hopTo(hop.x, hop.z);
            if (pos().z <= 3415) break;
        }
    }

    function inSabaCave(): boolean {
        const p = pos();
        return p.x >= 2255 && p.x <= 2290 && p.z >= 4735 && p.z <= 4780;
    }

    function inHaroldRoom(): boolean {
        const p = pos();
        return p.level >= 1 && p.x >= 2903 && p.x <= 2908 && p.z >= 3537 && p.z <= 3542;
    }

    function isContinueDialog(): boolean {
        const dialog = sdk.getDialog();
        if (!dialog?.isOpen) return false;
        const opts = dialog.options ?? [];
        return opts.length === 0 || opts.every((o) => /click here to continue/i.test(o.text));
    }

    async function clickContinue(): Promise<void> {
        const dialog = sdk.getDialog();
        if (!dialog?.isOpen) return;
        if (dialog.isWaiting) return;
        const opts = dialog.options ?? [];
        const cont = opts.find((o) => /click here to continue/i.test(o.text));
        await sdk.sendClickDialog(cont?.index ?? 0);
        await sdk.waitForStateChange(2_000).catch(() => {});
    }

    async function closeUi(): Promise<void> {
        for (let i = 0; i < 10; i++) {
            await bot.dismissBlockingUI();
            if (isContinueDialog()) {
                await clickContinue();
                await sdk.waitForTicks(1);
                continue;
            }
            const iface = sdk.getState()?.interface;
            if (iface?.isOpen && iface.interfaceId === HAROLD_DICE_IF) break;
            if (sdk.getState()?.shop?.isOpen || sdk.getState()?.bank?.isOpen || iface?.isOpen) {
                await bot.closeInterface();
                await sdk.waitForTicks(1);
                continue;
            }
            break;
        }
    }

    async function chat(choices: RegExp[] = [], max = 48): Promise<string[]> {
        const seen: string[] = [];
        let idle = 0;
        for (let i = 0; i < max; i++) {
            const dialog = sdk.getDialog();
            if (!dialog?.isOpen) {
                idle++;
                if (idle >= 16) break;
                await sdk.waitForTicks(1);
                continue;
            }
            idle = 0;
            const d = sdk.getDialog();
            if (d?.isWaiting) {
                await sdk.waitForStateChange(2_000).catch(() => {});
                continue;
            }
            const opts = d?.options ?? [];
            for (const o of opts) seen.push(o.text);
            if (opts.length === 0 || opts.every((o) => /click here to continue/i.test(o.text))) {
                await clickContinue();
                await sdk.waitForTicks(1);
                continue;
            }
            let picked = false;
            for (const c of choices) {
                const match = opts.find((o) => c.test(o.text));
                if (match) {
                    await sdk.sendClickDialog(match.index);
                    picked = true;
                    break;
                }
            }
            if (!picked) break;
            await sdk.waitForTicks(1);
        }
        return seen;
    }

    function inBurthorpe(): boolean {
        const p = pos();
        return p.z >= 3518 && p.x >= 2860 && p.x <= 2945 && !inSabaCave();
    }

    function inInnUpstairs(): boolean {
        const p = pos();
        return p.level >= 1 && p.x >= 2900 && p.x <= 2916 && p.z >= 3534 && p.z <= 3548;
    }

    async function dismissMesbox(max = 12): Promise<void> {
        for (let i = 0; i < max; i++) {
            const dialog = sdk.getDialog();
            const opts = dialog?.options ?? [];
            if (!dialog?.isOpen) break;
            if (dialog.isWaiting) {
                await sdk.waitForStateChange(2_000).catch(() => {});
                continue;
            }
            if (opts.length === 0 || opts.every((o) => /click here to continue/i.test(o.text))) {
                await clickContinue();
                await sdk.waitForTicks(1);
                continue;
            }
            break;
        }
    }

    function inTenzingYard(): boolean {
        const p = pos();
        return p.x >= 2822 && p.x <= 2825 && p.z >= 3553 && p.z <= 3557;
    }

    async function openTenzingYardGates(): Promise<void> {
        await dismissMesbox();
        await sdk.scanNearbyLocs(8).catch(() => {});
        const gates = (sdk.getNearbyLocs() ?? []).filter(
            (l) =>
                /gate/i.test(l.name) &&
                l.x >= 2824 &&
                l.x <= 2826 &&
                l.optionsWithIndex.some((o) => /open/i.test(o.text))
        );
        for (const gate of gates) {
            const opt = gate.optionsWithIndex.find((o) => /open/i.test(o.text));
            log(`Opening Tenzing yard gate @ ${gate.x},${gate.z}`);
            await sdk.sendInteractLoc(gate.x, gate.z, gate.id, opt?.opIndex ?? 1);
            await sdk
                .waitForCondition(() => {
                    const now = (sdk.getNearbyLocs() ?? []).find((l) => l.x === gate.x && l.z === gate.z);
                    return !now || now.optionsWithIndex.some((o) => /close/i.test(o.text));
                }, 8_000)
                .catch(() => {});
        }
    }

    async function walkNear(x: number, z: number, tolerance = 4): Promise<boolean> {
        await dismissMesbox(6);
        if (inTenzingYard() && !(x >= 2818 && x <= 2822 && z >= 3552 && z <= 3558)) {
            await openTenzingYardGates();
        }
        if (distTo(x, z) <= tolerance) return true;
        if (x >= 2818 && x <= 2822 && z >= 3552 && z <= 3558) {
            if (!sdk.findNearbyNpc(/^tenzing$/i, { reachable: true })) {
                await enterTenzing();
                if (distTo(x, z) <= tolerance) return true;
            }
        }
        const destInHarold = x >= 2903 && x <= 2908 && z >= 3537 && z <= 3542;
        if (inInnUpstairs() && !destInHarold) {
            await leaveHaroldRoom();
            if (pos().level >= 1) await climbTo(0);
        }
        if (z >= 3518 && pos().z < 3516 && pos().x < 2914) {
            await bot.walkTo(GUILD_EAST.x, Math.max(pos().z, 3488), 5);
            await bot.walkTo(GUILD_EAST.x, GUILD_EAST.z, 4);
        }
        if (inBurthorpe() && z >= 3518 && x < 2914) {
            /* stay north of the guild; never walk south into the locked door */
        }
        if (inBurthorpe() && x >= 2940) {
            await bot.walkTo(GUILD_EAST.x, GUILD_EAST.z, 4);
        }
        if (inWaterfallLedge() && !(x >= 2505 && x <= 2575 && z >= 3448 && z <= 3515)) {
            await leaveWaterfall();
        }
        if (pos().x >= 2830 && pos().x <= 2885 && pos().z >= 3445 && pos().z <= 3515 && x < 2830) {
            await leaveWhiteWolf();
        }
        if (inBurthorpe() && x >= 2940) {
            await bot.walkTo(GUILD_EAST.x, GUILD_EAST.z, 4);
        }
        const r = await bot.walkTo(x, z, Math.min(tolerance, 3));
        return r.success || distTo(x, z) <= tolerance + 2;
    }

    async function walkPath(wps: Array<{ x: number; z: number }>, destTol = 6): Promise<boolean> {
        const dest = wps[wps.length - 1];
        if (!dest) return true;
        for (const wp of wps) {
            if (distTo(dest.x, dest.z) <= destTol) return true;
            const wpToDest = Math.hypot(wp.x - dest.x, wp.z - dest.z);
            if (wpToDest >= distTo(dest.x, dest.z) + 6) continue;
            await walkNear(wp.x, wp.z, 8);
        }
        return walkNear(dest.x, dest.z, destTol);
    }

    async function climbTo(targetLevel: number): Promise<boolean> {
        for (let i = 0; i < 8 && pos().level !== targetLevel; i++) {
            const wantUp = pos().level < targetLevel;
            const opt = wantUp ? /climb-up|climb.up|go-up|go.up/i : /climb-down|climb.down|go-down|go.down/i;
            await sdk.scanNearbyLocs(10).catch(() => {});
            const stairs = (sdk.getNearbyLocs() ?? [])
                .filter((l) => /stair|ladder/i.test(l.name) && l.optionsWithIndex.some((o) => opt.test(o.text)))
                .sort((a, b) => (a.distance ?? 99) - (b.distance ?? 99))[0];
            if (!stairs) return false;
            const before = pos().level;
            await bot.interactLoc(stairs, opt);
            await sdk.waitForCondition((s) => (s.player?.level ?? before) !== before, 8_000).catch(() => {});
            await closeUi();
        }
        return pos().level === targetLevel;
    }

    async function eatIfNeeded(): Promise<void> {
        if (pos().hp >= pos().maxHp - 8) return;
        const food = sdk.findInventoryItem(FOOD);
        if (food) await bot.eatFood(food);
    }

    async function waitNpcIdle(pat: RegExp, timeout = 15_000): Promise<void> {
        await sdk
            .waitForCondition(() => {
                const n = sdk.findNearbyNpc(pat);
                return !!n && !n.inCombat;
            }, timeout)
            .catch(() => {});
    }

    async function talk(npcPat: RegExp, choices: RegExp[] = []): Promise<string[]> {
        await closeUi();
        await waitNpcIdle(npcPat);
        const npc = sdk.findNearbyNpc(npcPat, { reachable: true }) ?? sdk.findNearbyNpc(npcPat);
        if (!npc) return [];
        await bot.talkTo(npc);
        return chat(choices);
    }

    const supplyCtx = (): SupplyCtx => ({ bot, sdk, log, intent, walkNear, closeUi });

    async function depositEverything(): Promise<void> {
        const bank = nearestBank(pos().x, pos().z);
        intent(`Depositing everything @ ${bank.x},${bank.z}`);
        await walkNear(bank.x, bank.z, 3);
        if (!(sdk.getState()?.bank?.isOpen || (await bot.openBank()).success)) {
            log(`Bank open failed @ ${pos().x},${pos().z}`);
            return;
        }
        for (const eq of [...sdk.getEquipment()]) {
            const r = await bot.unequipItem(eq);
            log(`Unequip ${eq.name}: ${r.success ? 'ok' : r.message}`);
            await sdk.waitForTicks(1);
        }
        if (!sdk.getState()?.bank?.isOpen) {
            await bot.closeInterface().catch(() => {});
            const reopened = await bot.openBank();
            if (!reopened.success) log(`Bank reopen after unequip: ${reopened.message}`);
            await sdk.waitForCondition((s) => !!s.bank?.isOpen, 8_000).catch(() => {});
        }
        if (!sdk.getState()?.bank?.isOpen) {
            log('Bank not open after unequip — cannot deposit');
            return;
        }
        for (let i = 0; i < 36; i++) {
            const item = sdk.getInventory().find((it) => (it.count ?? 0) > 0);
            if (!item) break;
            const r = await bot.depositItem(item, -1);
            log(`Deposit ${item.name}: ${r.success || r.partial ? 'ok' : r.message}`);
            if (!r.success && !r.partial) break;
        }
        await bot.closeBank();
        log(`Deposit done inv=${sdk.getInventory().filter((i) => (i.count ?? 0) > 0).length}`);
    }

    async function withdraw(pattern: RegExp, amount: number, label: string): Promise<boolean> {
        if (count(pattern) >= amount) return true;
        const item = sdk.findBankItem(pattern);
        if (!item) return false;
        const r = await bot.withdrawItem(item, amount);
        log(`Withdraw ${label}: ${r.success ? 'ok' : r.message}`);
        return count(pattern) >= amount;
    }

    async function withdrawSupplies(): Promise<void> {
        const bank = nearestBank(pos().x, pos().z);
        intent('Withdrawing Death Plateau supplies');
        await walkNear(bank.x, bank.z, 3);
        if (!(sdk.getState()?.bank?.isOpen || (await bot.openBank()).success)) {
            log('Could not reopen bank for supplies');
            return;
        }
        await withdraw(COINS, 2000, 'coins');
        await withdraw(BREAD, 10, 'bread');
        await withdraw(TROUT, 10, 'trout');
        await withdraw(IRON_BAR, 1, 'iron bar');
        if (count(FOOD) < 6) {
            const food = sdk.getBankItems().find((i) => /swordfish|lobster|shark|tuna/i.test(i.name));
            if (food) await bot.withdrawItem(food, Math.min(6, food.count ?? 6));
        }
        for (const gear of [
            /^dragon longsword$/i,
            /^dragonhide body$/i,
            /^dragonhide chaps$/i,
            /^dragon vambraces$/i,
            /^amulet of glory$/i,
            /^ring of wealth$/i,
            /^cape of saradomin$/i,
            /^rune kiteshield$/i,
            /^rune full helm$/i
        ]) {
            await withdraw(gear, 1, gear.source);
        }
        await bot.closeBank();

        for (const item of sdk.getInventory()) {
            if (COMBAT_GEAR.test(item.name) && item.optionsWithIndex.some((o) => /wear|wield/i.test(o.text))) {
                await bot.equipItem(item);
            }
        }
    }

    async function gatherMissing(): Promise<void> {
        const ctx = supplyCtx();
        await ensureCoins(ctx, 200);
        if (count(BREAD) < 10) {
            // Quest bread comes from the BANK, never a shop: the old Ardougne
            // baker detour was a full round trip for a quest-supply item.
            intent('Withdrawing bread from bank');
            await withdrawFromBank(ctx, BREAD, 10);
        }
        if (count(IRON_BAR) < 1) {
            if (count(IRON_ORE) < 1) {
                intent('Mining one iron for Dunstan');
                await walkNear(FALLY_IRON.x, FALLY_IRON.z, 3);
                for (let i = 0; i < 8 && count(IRON_ORE) < 1; i++) {
                    const rock = sdk.findNearbyLoc(/iron/i, { withOption: /mine/i });
                    if (rock) await bot.interactLoc(rock, /mine/i);
                    await sdk.waitForTicks(3);
                }
            }
            if (count(IRON_ORE) > 0 && count(IRON_BAR) < 1) {
                intent('Smelting iron bar');
                await walkNear(FALLY_FURNACE.x, FALLY_FURNACE.z, 2);
                const ore = sdk.findInventoryItem(IRON_ORE);
                const furnace = sdk.findNearbyLoc(/furnace/i, { withOption: /smelt/i });
                if (ore && furnace) {
                    await bot.useItemOnLoc(ore, furnace);
                    await sdk.waitForCondition(() => count(IRON_BAR) > 0, 12_000).catch(() => {});
                }
            }
        }
        if (count(TROUT) < 10) {
            intent('Fly-fishing trout');
            const bank = nearestBank(pos().x, pos().z);
            await walkNear(bank.x, bank.z, 3);
            if (sdk.getState()?.bank?.isOpen || (await bot.openBank()).success) {
                await withdraw(/^fly fishing rod$/i, 1, 'fly rod');
                await withdraw(/^feather$/i, 40, 'feathers');
                await bot.closeBank();
            }
            await walkNear(BARB_FISH.x, BARB_FISH.z, 3);
            for (let i = 0; i < 40 && count(RAW_TROUT) + count(TROUT) < 10; i++) {
                const spot = sdk.findNearbyNpc(/fishing spot/i);
                if (spot) await bot.interactNpc(spot, /lure/i);
                await sdk.waitForTicks(3);
            }
            await cookTrout();
        }
    }

    async function cookTrout(): Promise<void> {
        if (count(TROUT) >= 10) return;
        if (count(RAW_TROUT) < 1) return;
        intent('Cooking trout');
        for (const junk of [/^raw salmon$/i]) {
            const item = sdk.findInventoryItem(junk);
            if (item) {
                await sdk.sendDropItem(item.slot);
                await sdk.waitForTicks(1);
            }
        }
        if (inBurthorpe()) await walkNear(CAMP_FIRE.x, CAMP_FIRE.z, 2);
        else await walkNear(pos().x, pos().z, 8);
        await sdk.scanNearbyLocs(8).catch(() => {});
        for (let i = 0; i < 16 && count(TROUT) < 10 && count(RAW_TROUT) > 0; i++) {
            const raw = sdk.findInventoryItem(RAW_TROUT);
            const fire = sdk.findNearbyLoc(/^(range|fireplace|fire|cooking pot)$/i);
            if (!raw || !fire) {
                log(`No fire for trout @ ${pos().x},${pos().z}`);
                break;
            }
            await bot.useItemOnLoc(raw, fire);
            await chat();
            await sdk.waitForTicks(2);
        }
        log(`Cooked trout=${count(TROUT)} raw=${count(RAW_TROUT)}`);
        for (const extra of [/^fly fishing rod$/i, /^feather$/i]) {
            if (count(TROUT) >= 10) {
                const item = sdk.findInventoryItem(extra);
                if (item) await sdk.sendDropItem(item.slot);
            }
        }
    }

    async function toBurthorpe(): Promise<void> {
        if (inBurthorpe() || distTo(DENULTH.x, DENULTH.z) < 20 || inSabaCave()) return;
        if (pos().x < 2300 && pos().z > 4700) return;
        await leaveWaterfall();
        if (inGnomeStronghold()) await openGnomeGate();
        if (pos().z >= 3518 && pos().x >= 2790 && pos().x < 2865) {
            intent('Walking east along the plateau to Burthorpe');
            await walkNear(GUILD_EAST.x, GUILD_EAST.z, 6);
            return;
        }
        if (pos().x < 2860) {
            intent('Walking east from Kandarin (south of the waterfall)');
            await walkPath([...TO_GNOME].reverse(), 8);
        }
        intent('Walking to Burthorpe (east of Heroes\' Guild)');
        await walkPath(TO_BURTHORPE, 8);
    }

    async function startDenulth(): Promise<void> {
        await toBurthorpe();
        intent('Talking to Denulth');
        await walkNear(DENULTH.x, DENULTH.z, 3);
        const seen = await talk(/^denulth$/i, [
            /do you have any quests/i,
            /perhaps i could try and find one/i
        ]);
        log(`Denulth: ${seen.slice(0, 8).join(' | ')}`);
        await chat();
    }

    async function talkEohric(second = false): Promise<void> {
        await leaveHaroldRoom();
        await toBurthorpe();
        intent(second ? 'Eohric — Harold will not talk' : 'Talking to Eohric');
        await walkNear(EOHRIC.x, EOHRIC.z, 6);
        if (pos().level < 1) await climbTo(1);
        await walkNear(EOHRIC.x, EOHRIC.z, 3);
        const seen = await talk(/^eohric$/i, [
            /looking for the guard that was on last night/i,
            /where is the guard that was on last night/i
        ]);
        log(`Eohric: ${seen.slice(0, 8).join(' | ')}`);
        await chat();
        if (pos().level > 0) await climbTo(0);
    }

    async function openGnomeGate(): Promise<void> {
        await walkNear(GNOME_GATE.x, GNOME_GATE.z, 2);
        await sdk.scanNearbyLocs(8).catch(() => {});
        const gate = sdk.findNearbyLoc(/^gate$/i);
        if (!gate) return;
        const r = await bot.interactLoc(gate, /open/i);
        if (!r.success) {
            const opt = gate.optionsWithIndex.find((o) => /open/i.test(o.text));
            if (opt) await sdk.sendInteractLoc(gate.x, gate.z, gate.id, opt.opIndex);
        }
        await sdk.waitForTicks(3);
    }

    async function haroldDoor() {
        await sdk.scanNearbyLocs(6).catch(() => {});
        return (sdk.getNearbyLocs() ?? []).find((l) => /door/i.test(l.name) && l.x === 2906 && l.z === 3543);
    }

    async function clickHaroldDoor(): Promise<void> {
        await dismissMesbox();
        const door = await haroldDoor();
        if (!door) return;
        const opt = door.optionsWithIndex.find((o) => /open/i.test(o.text));
        await sdk.sendInteractLoc(door.x, door.z, door.id, opt?.opIndex ?? 1);
        await sdk.waitForCondition((s) => !!s.dialog?.isOpen, 8_000).catch(() => {});
        await dismissMesbox();
        await chat();
        await dismissMesbox();
    }

    async function leaveHaroldRoom(): Promise<void> {
        await dismissMesbox();
        if (pos().level < 1 || pos().z >= 3544) return;
        if (!inHaroldRoom() && pos().z >= 3543) return;
        intent('Leaving Harold\'s room');
        await clickHaroldDoor();
        await sdk.sendWalk(2906, 3545, true);
        await sdk.waitForCondition(() => pos().z >= 3544, 8_000).catch(() => {});
        if (pos().z < 3544) await sdk.sendWalk(2908, 3545, true);
        await dismissMesbox();
    }

    async function enterHaroldRoom(): Promise<boolean> {
        await toBurthorpe();
        if (inHaroldRoom()) {
            await dismissMesbox();
            return true;
        }
        if (pos().level < 1) {
            await walkNear(TOSTIG.x, TOSTIG.z, 3);
            await climbTo(1);
        }
        intent('Knocking on Harold\'s door');
        if (pos().z < 3544) {
            await sdk.sendWalk(2906, 3545, true);
            await sdk.waitForTicks(2);
        } else {
            await walkNear(2906, 3545, 1);
        }
        await clickHaroldDoor();
        await sdk.sendWalk(HAROLD.x, HAROLD.z, true);
        await sdk.waitForCondition(() => inHaroldRoom(), 8_000).catch(() => {});
        await dismissMesbox();
        return !!sdk.findNearbyNpc(/^harold$/i);
    }

    async function talkHarold(choices: RegExp[]): Promise<string[]> {
        if (!(await enterHaroldRoom())) {
            log('Harold room not open');
            return [];
        }
        return talk(/^harold$/i, choices);
    }

    async function waitForHaroldCombo(): Promise<void> {
        if (count(IOU) > 0 || count(COMBO) > 0) return;
        intent('Waiting for you to gamble Harold (need IOU or combination)');
        log('Gambling is manual — waiting until IOU or combination is in inventory');
        await sdk.waitForCondition(() => count(IOU) > 0 || count(COMBO) > 0, 10 * 60_000).catch(() => {});
        log(`After wait iou=${count(IOU)} combo=${count(COMBO)}`);
    }

    async function readIou(): Promise<void> {
        if (count(COMBO) > 0) return;
        const iou = sdk.findInventoryItem(IOU);
        if (!iou) return;
        intent('Reading IOU');
        const read = iou.optionsWithIndex.find((o) => /read/i.test(o.text));
        await sdk.sendUseItem(iou.slot, read?.opIndex ?? 1);
        await chat();
        await closeUi();
    }

    async function placeBalls(): Promise<void> {
        if (doorUnlocked() || count(COMBO) === 0) return;
        await toBurthorpe();
        if (pos().level > 0) await climbTo(0);
        intent('Placing stone balls');
        await walkNear(2894, 3563, 3);
        await sdk.scanNearbyLocs(8).catch(() => {});

        for (const item of sdk.getInventory()) {
            if (COMBAT_GEAR.test(item.name) && item.optionsWithIndex.some((o) => /wear|wield/i.test(o.text))) {
                await bot.equipItem(item);
            }
        }
        for (const junk of [/^(premade )?blurberry special$/i, /^asgarnian ale$/i, /^beer glass$/i]) {
            const item = sdk.findInventoryItem(junk);
            if (item) {
                await sdk.sendDropItem(item.slot);
                await sdk.waitForTicks(1);
            }
        }

        for (const spawn of BALL_SPAWNS) {
            if (hasId(spawn.id)) continue;
            const onSlot = BALL_SLOTS.find((s) => s.id === spawn.id);
            const already = (sdk.getGroundItems() ?? []).some(
                (g) => g.id === spawn.id && onSlot && g.x === onSlot.x && g.z === onSlot.z
            );
            if (already) continue;
            const ground =
                (sdk.getGroundItems() ?? []).find((g) => g.id === spawn.id) ??
                (await sdk.scanFindGroundItem(/^stone ball$/i, 12));
            if (ground && ground.id === spawn.id) {
                await bot.pickupItem(ground);
                await sdk.waitForTicks(2);
            }
        }

        for (const slot of BALL_SLOTS) {
            const correct = (sdk.getGroundItems() ?? []).some(
                (g) => g.id === slot.id && g.x === slot.x && g.z === slot.z
            );
            if (correct) continue;
            const wrong = (sdk.getGroundItems() ?? []).find(
                (g) => g.x === slot.x && g.z === slot.z && /^stone ball$/i.test(g.name) && g.id !== slot.id
            );
            if (wrong) {
                await bot.pickupItem(wrong);
                await sdk.waitForTicks(2);
            }
            const ball = sdk.getInventory().find((i) => i.id === slot.id);
            if (!ball) {
                log(`Missing ${slot.color} ball`);
                continue;
            }
            await walkNear(slot.x, slot.z, 1);
            await sdk.scanNearbyLocs(6).catch(() => {});
            const loc = (sdk.getNearbyLocs() ?? []).find(
                (l) => l.x === slot.x && l.z === slot.z && /stone mechanism/i.test(l.name)
            );
            if (!loc) {
                log(`No mechanism @ ${slot.x},${slot.z}`);
                continue;
            }
            const r = await bot.useItemOnLoc(ball, loc);
            log(`Place ${slot.color}: ${r.success ? 'ok' : r.message}`);
            await sdk.waitForTicks(2);
        }
        log(`Balls: ${doorUnlocked() ? 'door unlocked' : 'not unlocked yet'}`);
    }

    async function leaveSabaCave(): Promise<void> {
        if (!inSabaCave()) return;
        await sdk.scanNearbyLocs(10).catch(() => {});
        const exit = sdk.findNearbyLoc(/cave exit|exit/i);
        if (exit) {
            await bot.interactLoc(exit, /exit|enter/i);
            await sdk.waitForCondition(() => !inSabaCave(), 10_000).catch(() => {});
        }
    }

    async function talkSaba(): Promise<void> {
        if (count(BOOTS) > 0 || count(SPIKED) > 0 || count(MAP) > 0) return;
        intent('Talking to Saba');
        if (!inSabaCave()) {
            if (!(pos().z >= 3518 && pos().x >= 2790 && pos().x < 2945)) await toBurthorpe();
            await walkNear(SABA_CAVE.x, SABA_CAVE.z, 2);
            await sdk.scanNearbyLocs(8).catch(() => {});
            const cave = sdk.findNearbyLoc(/cave entrance/i);
            if (cave) {
                await bot.interactLoc(cave, /enter/i);
                await sdk.waitForCondition(() => inSabaCave(), 10_000).catch(() => {});
            }
        }
        if (!inSabaCave()) {
            log('Could not enter Saba cave');
            return;
        }
        await walkNear(SABA_INSIDE.x, SABA_INSIDE.z, 3);
        const seen = await talk(/^saba$/i, [/another way up death plateau/i]);
        log(`Saba: ${seen.slice(0, 8).join(' | ')}`);
        await chat();
        await leaveSabaCave();
    }

    async function enterTenzing(): Promise<boolean> {
        await leaveSabaCave();
        await dismissMesbox();
        if (sdk.findNearbyNpc(/^tenzing$/i, { reachable: true })) return true;

        const tenzingNpc = sdk.findNearbyNpc(/^tenzing$/i);
        if (tenzingNpc?.inCombat) {
            log('Waiting for Tenzing to leave combat before knocking');
            await sdk
                .waitForCondition(() => {
                    const t = sdk.findNearbyNpc(/^tenzing$/i);
                    return !!t && !t.inCombat;
                }, 20_000)
                .catch(() => {});
        }

        intent("Knocking on Tenzing's door");
        await walkNear(2823, 3555, 1);
        await sdk.scanNearbyLocs(8).catch(() => {});
        const door = (sdk.getNearbyLocs() ?? []).find(
            (l) => /door/i.test(l.name) && l.x === 2822 && l.z === 3555
        );
        if (!door) {
            log(`No Tenzing door @ ${pos().x},${pos().z}`);
            return false;
        }
        const opt = door.optionsWithIndex.find((o) => /open/i.test(o.text));
        if (opt) {
            await sdk.sendInteractLoc(door.x, door.z, door.id, opt.opIndex);
            await sdk.waitForCondition((s) => !!s.dialog?.isOpen, 8_000).catch(() => {});
            for (let i = 0; i < 24; i++) {
                if (sdk.findNearbyNpc(/^tenzing$/i, { reachable: true })) break;
                const d = sdk.getDialog();
                if (!d?.isOpen) {
                    await sdk.waitForTicks(1);
                    continue;
                }
                if (d.isWaiting) {
                    await sdk.waitForStateChange(3_000).catch(() => {});
                    continue;
                }
                const body =
                    (d.text && String(d.text).trim()) ||
                    (d.allComponents ?? [])
                        .map((c) => c.text)
                        .filter((t) => t && !/click here to continue/i.test(t))
                        .join(' | ');
                const page = `${body} :: ${d.options.map((o) => `${o.index}:${o.text}`).join(' | ')}`;
                log(`Tenzing door page: ${page.slice(0, 160)}`);
                const choice = d.options.find((o) =>
                    /need your help|not the milkman|come in|ok, i'll get those/i.test(o.text)
                );
                if (choice) await sdk.sendClickDialog(choice.index);
                else await clickContinue();
            }
            await dismissMesbox();
        }
        const doorAfter = (sdk.getNearbyLocs() ?? []).find(
            (l) => /door/i.test(l.name) && l.x === 2822 && l.z === 3555
        );
        const opened = !!doorAfter?.optionsWithIndex.some((o) => /close/i.test(o.text));
        if (!opened && !sdk.findNearbyNpc(/^tenzing$/i, { reachable: true })) {
            log(`Tenzing door still closed after knock @ ${pos().x},${pos().z}`);
            return false;
        }
        await sdk.sendWalk(TENZING.x, TENZING.z, true);
        await sdk
            .waitForCondition(() => !!sdk.findNearbyNpc(/^tenzing$/i, { reachable: true }), 8_000)
            .catch(() => {});
        const ok = !!sdk.findNearbyNpc(/^tenzing$/i, { reachable: true });
        log(`Tenzing reachable=${ok} @ ${pos().x},${pos().z}`);
        return ok;
    }

    async function talkTenzing(): Promise<void> {
        intent('Talking to Tenzing');
        if (!(await enterTenzing())) {
            log('Tenzing door blocked');
            return;
        }
        const seen = await talk(/^tenzing$/i, [/ok, i'll get those for you/i, /i'll get those/i]);
        log(`Tenzing: ${seen.slice(0, 8).join(' | ')}`);
        await chat([/ok, i'll get those for you/i]);
    }

    async function talkDunstan(): Promise<void> {
        await leaveSabaCave();
        if (pos().level > 0) await climbTo(0);
        intent('Talking to Dunstan');
        await walkNear(DUNSTAN.x, DUNSTAN.z, 3);
        const seen = await talk(/^dunstan$/i, [
            /yes, but i still want them/i,
            /spikes on my climbing boots/i
        ]);
        log(`Dunstan: ${seen.slice(0, 8).join(' | ')}`);
        await chat([/yes, but i still want them/i]);
    }

    async function denulthCertOrFinish(): Promise<void> {
        await leaveSabaCave();
        if (pos().level > 0) await climbTo(0);
        intent('Talking to Denulth');
        await walkNear(DENULTH.x, DENULTH.z, 3);
        await waitNpcIdle(/^denulth$/i);
        const handingIn = count(COMBO) > 0 || count(MAP) > 0 || mapHandedIn();
        if (sdk.getDialog()?.isOpen) await chat();
        const choices = handingIn
            ? []
            : [/do you have any quests/i, /perhaps i could try and find one/i, /remind me of the quest/i];
        const seen = await talk(/^denulth$/i, choices);
        log(
            `Denulth: ${seen.slice(0, 8).join(' | ')} combo=${count(COMBO)} map=${count(MAP)} claws=${count(CLAWS)}`
        );
        await chat();
    }

    async function scoutPath(): Promise<void> {
        if (scouted()) return;
        intent('Scouting Tenzing secret path');
        await enterTenzing();
        await sdk.scanNearbyLocs(8).catch(() => {});
        const back = (sdk.getNearbyLocs() ?? []).find((l) => /door/i.test(l.name) && l.x <= 2821 && l.z >= 3556);
        if (back) await bot.openDoor(back);
        await walkNear(STILE.x, STILE.z, 2);
        const stile = sdk.findNearbyLoc(/stile/i);
        if (stile) {
            await bot.interactLoc(stile, /climb/i);
            await sdk.waitForTicks(3);
        }
        await walkPath(TO_SCOUT, 4);
        await sdk.waitForTicks(3);
        log(`Scout @ ${pos().x},${pos().z} scouted=${scouted()}`);
    }

    const xpBefore = attackXp();
    await bot.skipTutorial();
    await closeUi();
    // Ask the journal BEFORE banking: an account that already finished must not
    // be sent to dump and re-withdraw supplies first.
    const startStage = await readStage();
    log(`Death Plateau journal stage at start: ${startStage}`);
    if (startStage === 'unknown') {
        throw new Error('could not determine the Death Plateau stage from the journal');
    }
    if (startStage === 'complete') {
        log('Death Plateau is already complete — nothing to do');
        return;
    }
    const resumeHere =
        !DEPOSIT_ONLY &&
        count(BREAD) >= 9 &&
        count(IRON_BAR) >= 1 &&
        (count(TROUT) >= 10 || count(RAW_TROUT) >= 10);
    if (resumeHere) {
        log(`Resume with supplies @ ${pos().x},${pos().z} — skip bank dump`);
    } else {
        await depositEverything();
        if (DEPOSIT_ONLY) {
            log(`Deposited. Empty inv @ ${pos().x},${pos().z}`);
            return;
        }
        await withdrawSupplies();
        if (count(BREAD) < 10 || count(TROUT) < 10 || count(IRON_BAR) < 1) {
            await gatherMissing();
        }
    }
    await cookTrout();
    log(
        `Death Plateau start Attack xp=${xpBefore} bread=${count(BREAD)} trout=${count(TROUT)} iron=${count(IRON_BAR)} @ ${pos().x},${pos().z}`
    );

    const until = Date.now() + 25 * 60_000;
    while (Date.now() < until && !(await questDone())) {
        await closeUi();
        await eatIfNeeded();
        if (pos().isDead) {
            await sdk.waitForCondition((s) => !s.player.isDead, 45_000).catch(() => {});
            continue;
        }

        if (
            (count(MAP) > 0 || mapHandedIn() || scouted()) &&
            (doorUnlocked() || count(COMBO) > 0)
        ) {
            if (count(MAP) > 0 && !scouted() && distTo(SCOUT.x, SCOUT.z) > 6) await scoutPath();
            await denulthCertOrFinish();
            if (await questDone()) break;
            continue;
        }

        if (count(MAP) > 0 && !scouted()) {
            await scoutPath();
            continue;
        }

        if (count(SPIKED) > 0 && count(BREAD) >= 10 && count(TROUT) >= 10) {
            await talkTenzing();
            continue;
        }

        if (count(CERT) > 0 || (count(BOOTS) > 0 && count(IRON_BAR) > 0 && count(SPIKED) === 0 && count(CERT) === 0)) {
            if (count(CERT) === 0 && count(BOOTS) > 0 && count(SPIKED) === 0) {
                await talkDunstan();
                if (count(CERT) === 0 && count(SPIKED) === 0) await denulthCertOrFinish();
            }
            if (count(CERT) > 0) await talkDunstan();
            continue;
        }

        if (count(BOOTS) > 0 && count(SPIKED) === 0) {
            await talkDunstan();
            if (count(SPIKED) === 0) await denulthCertOrFinish();
            continue;
        }

        if (count(COMBO) > 0 && !doorUnlocked()) {
            await placeBalls();
            continue;
        }

        if (count(IOU) > 0) {
            await readIou();
            continue;
        }

        if (count(BOOTS) === 0 && count(SPIKED) === 0 && count(MAP) === 0) {
            if (count(IOU) === 0 && count(COMBO) === 0) {
                const started =
                    count(BREAD) >= 9 &&
                    (inBurthorpe() ||
                        /remind me of the quest|toad and chicken|you give harold/i.test(messages()));
                if (!started) {
                    await startDenulth();
                    await talkEohric(false);
                    await talkHarold([/guard that was on duty last night/i]);
                    await talkEohric(true);
                }
                await waitForHaroldCombo();
                await readIou();
                await placeBalls();
                if (count(IOU) === 0 && count(COMBO) === 0) {
                    log('Still need combination — gamble Harold, then this continues');
                    continue;
                }
            }
            await talkSaba();
            await talkTenzing();
            continue;
        }

        await startDenulth();
        log(
            `loop iou=${count(IOU)} combo=${count(COMBO)} boots=${count(BOOTS)} spiked=${count(SPIKED)} cert=${count(CERT)} map=${count(MAP)} @ ${pos().x},${pos().z} L${pos().level}`
        );
        await sdk.waitForTicks(2);
    }

    if (!(await questDone())) {
        throw new Error(`Death Plateau unfinished @ ${pos().x},${pos().z} xp=${attackXp()}`);
    }
    log(`QUEST COMPLETE Death Plateau (+${attackXp() - xpBefore} Attack xp)`);
});
