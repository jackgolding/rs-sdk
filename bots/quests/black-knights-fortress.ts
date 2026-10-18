/**
 * Black Knights' Fortress — reusable.
 *
 *   bun bots/quests/black-knights-fortress.ts {botname}
 *
 * Requires 12 QP. Sir Amik → disguise → fortress → grill → cabbage in cauldron → return.
 */
import { appendFileSync } from 'fs';
import { join } from 'path';
import { runScript } from '../../sdk/runner';
import { readJournalCheckpoint } from '../../quest-lab/journal-reader';
import type { JournalRule } from '../../quest-lab/evidence';
import {
    buyAtShop,
    ensureCoins,
    ensureItem,
    nearestBank,
    SHOPS,
    type SupplyCtx
} from './quest-supplies';

const SIR_AMIK = { x: 2962, z: 3338 };
const FALADOR_CASTLE_STAIRS = { x: 2959, z: 3338 };
const FORTRESS = { x: 3016, z: 3513 };
const SECRET_WALL = { x: 3016, z: 3517 };
const INNER_LADDER = { x: 3015, z: 3519 };
const GRILL = { x: 3025, z: 3508 };
const HOLE = { x: 3031, z: 3507 };
const HOLE_WALL = { x: 3030, z: 3510 };
const HOLE_APPROACH = { x: 3029, z: 3511 };
const MONASTERY_GARDEN = { x: 3056, z: 3504 };
const CABBAGE_LOC_ID = 1161;
const CABBAGE_PICK_OP = 2;

const HELM = /^bronze med(ium)? (helm|helmet)$/i;
const CHAIN = /^iron chain(body|mail)$/i;
const CABBAGE = /^cabbage$/i;
const COINS = /^coins$/i;
const FOOD = /^(lobster|swordfish|tuna|shark|trout|salmon|bread|cake|wine|meat pie)$/i;

const botName = process.argv.slice(2).find((a) => !a.startsWith('-')) ?? '';
const FINISH_ONLY = process.argv.includes('--finish');
const TO_FALLY = process.argv.includes('--to-fally');
const FALLY_EAST = { x: 3012, z: 3355 };
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
            level: p?.level ?? 0,
            hp: p?.hp ?? 10,
            maxHp: p?.maxHp ?? 10
        };
    }

    function distTo(x: number, z: number): number {
        return Math.hypot(pos().x - x, pos().z - z);
    }

    function atCastle(): boolean {
        return distTo(FALADOR_CASTLE_STAIRS.x, FALADOR_CASTLE_STAIRS.z) < 16;
    }

    function atFortress(): boolean {
        return distTo(FORTRESS.x, FORTRESS.z) < 40;
    }

    function inSecretRoom(): boolean {
        const p = pos();
        return p.level === 0 && p.x >= 3014 && p.x <= 3017 && p.z >= 3518 && p.z <= 3521;
    }

    function inEastInterior(): boolean {
        const p = pos();
        return p.x >= 3025 && p.x <= 3036 && p.z >= 3504 && p.z <= 3516;
    }

    function locAt(x: number, z: number, pattern: RegExp) {
        return (sdk.getNearbyLocs() ?? []).find((l) => l.x === x && l.z === z && pattern.test(l.name));
    }

    function count(pattern: RegExp): number {
        return sdk.getInventory().reduce((n, i) => n + (pattern.test(i.name) ? (i.count ?? 1) : 0), 0);
    }

    function coinCount(): number {
        return sdk.findInventoryItem(COINS)?.count ?? 0;
    }

    function messages(): string {
        const msgs = sdk.getState()?.gameMessages ?? [];
        const chatHist = sdk.getChat({ limit: 40, types: [0] }).map((m) => m.text);
        return [...msgs.map((m) => m.text), ...chatHist].join('\n');
    }

    /**
     * Black Knights' Fortress stage and completion, read from the QUEST JOURNAL.
     *
     * This used to be `coinCount() >= coinsBefore + 2400` plus a chat regex.
     * Coins are this quest's REWARD, so ANY coin gain read as completion, and
     * chat lines linger in history across restarts. Rules come from the quest's
     * own handler (quests/quest_blackknight/scripts/blackknight_journal.rs2);
     * the journal button label is `fortress` (questlist.if), NOT the script
     * dir name (quest_blackknight).
     */
    const FORT_JOURNAL = { label: "Black Knight's Fortress", title: "Black Knight's Fortress" };
    const FORT_STAGES: Record<string, JournalRule> = {
        not_started: {
            id: 'fort:not_started',
            kind: 'unstarted',
            all: ['I can start this quest', '12 Quest Points'],
        },
        started: {
            id: 'fort:started',
            kind: 'active',
            all: ['asked me to investigate', 'Ice Mountain'],
        },
        eavesdropped: {
            id: 'fort:eavesdropped',
            kind: 'active',
            all: ['invincibility potion can be', 'destroyed with a normal'],
        },
        sabotaged: {
            id: 'fort:sabotaged',
            kind: 'active',
            all: ['sabotaged the witch', 'claim my'],
        },
        complete: { id: 'fort:complete', kind: 'complete', all: ['QUEST COMPLETE'] },
    };

    /** The first stage rule that passes is the account's real stage. */
    async function readStage(): Promise<string> {
        for (const name of ['complete', 'sabotaged', 'eavesdropped', 'started', 'not_started']) {
            const read = await readJournalCheckpoint(sdk, FORT_JOURNAL, FORT_STAGES[name]!);
            log(`  stage probe ${name}: ${read.verdict?.verdict ?? 'UNKNOWN'} (${read.reason})`);
            if (read.verdict?.verdict === 'PASS') return name;
        }
        return 'unknown';
    }

    let journalComplete = false;
    let lastJournalCheck = 0;
    /** Journal-backed completion, throttled: opening the journal is not free. */
    async function questDone(): Promise<boolean> {
        if (Date.now() - lastJournalCheck < 5_000) return journalComplete;
        lastJournalCheck = Date.now();
        const read = await readJournalCheckpoint(sdk, FORT_JOURNAL, FORT_STAGES.complete!);
        journalComplete = read.verdict?.verdict === 'PASS';
        return journalComplete;
    }

    function sabotaged(): boolean {
        return /froth and bubble|witch groan|drop a cabbage down the hole|successfully sabotaged/i.test(messages());
    }

    function heardWitch(): boolean {
        return /invincibility potion|greldo|draynor manor cabbage/i.test(messages());
    }

    function grillAlreadyDone(): boolean {
        return heardWitch() || /can'?t hear much/i.test(messages());
    }

    function disguised(): boolean {
        const eq = sdk.getEquipment();
        return eq.some((i) => HELM.test(i.name)) && eq.some((i) => CHAIN.test(i.name));
    }

    function hasHelm(): boolean {
        return count(HELM) > 0 || sdk.getEquipment().some((i) => HELM.test(i.name));
    }

    function hasChain(): boolean {
        return count(CHAIN) > 0 || sdk.getEquipment().some((i) => CHAIN.test(i.name));
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

    async function eatIfLow(): Promise<void> {
        const p = pos();
        if (p.hp > p.maxHp - 12) return;
        const food = sdk.getInventory().find((i) => FOOD.test(i.name));
        if (food) {
            await bot.eatFood(food);
            await sdk.waitForTicks(1);
        }
    }

    async function waitCombat(): Promise<void> {
        for (let i = 0; i < 20 && sdk.getState()?.player?.combat?.inCombat; i++) {
            await eatIfLow();
            await sdk.waitForTicks(1);
        }
    }

    async function chat(choices: RegExp[] = [], max = 40): Promise<string[]> {
        const seen: string[] = [];
        for (let i = 0; i < max; i++) {
            const dialog = sdk.getDialog();
            if (!dialog?.isOpen) {
                await sdk.waitForTicks(1);
                if (!sdk.getDialog()?.isOpen) break;
            }
            const dlg = sdk.getDialog();
            if (dlg?.text) seen.push(dlg.text);
            const opts = dlg?.options ?? [];
            for (const o of opts) seen.push(o.text);
            if (opts.length <= 1 || opts.every((o) => /click here to continue/i.test(o.text))) {
                await sdk.sendClickDialog(opts[0]?.index ?? 0);
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

    async function walkNear(x: number, z: number, tolerance = 4): Promise<boolean> {
        if (distTo(x, z) <= tolerance) return true;
        const r = await bot.walkTo(x, z, Math.min(tolerance, 3));
        return r.success || distTo(x, z) <= tolerance + 2;
    }

    async function openNearbyDoors(): Promise<void> {
        await sdk.scanNearbyLocs(8).catch(() => {});
        const doors = (sdk.getNearbyLocs() ?? [])
            .filter((l) => /door|gate|wall/i.test(l.name) && l.optionsWithIndex.some((o) => /open|push/i.test(o.text)))
            .filter((l) => (l.distance ?? 99) <= 4)
            .sort((a, b) => (a.distance ?? 99) - (b.distance ?? 99));
        for (const door of doors.slice(0, 2)) {
            if (/push/i.test(door.optionsWithIndex.map((o) => o.text).join(' '))) {
                await bot.interactLoc(door, /push/i);
            } else {
                await bot.openDoor(door);
            }
            await sdk.waitForTicks(1);
        }
    }

    async function climbTo(targetLevel: number, hint?: { x: number; z: number }): Promise<boolean> {
        for (let i = 0; i < 10 && pos().level !== targetLevel; i++) {
            const wantUp = pos().level < targetLevel;
            const opt = wantUp ? /climb-up|climb.up|go-up|go.up/i : /climb-down|climb.down|go-down|go.down/i;
            await sdk.scanNearbyLocs(10).catch(() => {});
            const stairs = (sdk.getNearbyLocs() ?? [])
                .filter((l) => /stair|ladder/i.test(l.name) && l.optionsWithIndex.some((o) => opt.test(o.text)))
                .sort((a, b) => (a.distance ?? 99) - (b.distance ?? 99))[0];
            if (!stairs) {
                if (hint) await walkNear(hint.x, hint.z, 2);
                continue;
            }
            const before = pos().level;
            await bot.interactLoc(stairs, opt);
            await sdk.waitForCondition((s) => (s.player?.level ?? before) !== before, 8_000).catch(() => {});
            await closeUi();
        }
        return pos().level === targetLevel;
    }

    async function toGround(): Promise<void> {
        for (let i = 0; i < 8 && pos().level !== 0; i++) {
            await climbTo(0);
        }
    }

    const supplyCtx = (): SupplyCtx => ({ bot, sdk, log, intent, walkNear, closeUi });

    function keepForQuest(name: string): boolean {
        return HELM.test(name) || CHAIN.test(name) || CABBAGE.test(name) || COINS.test(name) || FOOD.test(name);
    }

    async function bankPrep(): Promise<void> {
        if (atFortress() && hasHelm() && hasChain() && count(CABBAGE) > 0) {
            log('Skipping bank — already supplied at the fortress');
            return;
        }
        const bank = nearestBank(pos().x, pos().z);
        intent('Banking junk before Black Knights\' Fortress');
        await walkNear(bank.x, bank.z, 3);
        if (!(sdk.getState()?.bank?.isOpen || (await bot.openBank()).success)) {
            log(`Bank open failed @ ${pos().x},${pos().z} — continuing with current inv`);
            return;
        }
        for (let i = 0; i < 32; i++) {
            const item = sdk.getInventory().find((it) => (it.count ?? 0) > 0 && !keepForQuest(it.name));
            if (!item) break;
            const r = await bot.depositItem(item, -1);
            log(`Deposit ${item.name}: ${r.success || r.partial ? 'ok' : r.message}`);
            if (!r.success && !r.partial) break;
        }
        const withdraw = async (pattern: RegExp, amount: number, label: string) => {
            if (count(pattern) >= amount) return;
            const item = sdk.findBankItem(pattern);
            if (!item) return;
            const r = await bot.withdrawItem(item, amount);
            log(`Withdraw ${label}: ${r.success ? 'ok' : r.message}`);
        };
        await withdraw(HELM, 1, 'bronze med helm');
        await withdraw(CHAIN, 1, 'iron chainbody');
        await withdraw(CABBAGE, 1, 'cabbage');
        if (count(FOOD) < 4) {
            const food = sdk.getBankItems().find((i) => FOOD.test(i.name));
            if (food) {
                const r = await bot.withdrawItem(food, Math.min(6, food.count ?? 6));
                log(`Withdraw ${food.name}: ${r.success ? 'ok' : r.message}`);
            }
        }
        if (coinCount() < 280) {
            const coins = sdk.findBankItem(COINS);
            if (coins) {
                const need = Math.min(500, coins.count ?? 500);
                const r = await bot.withdrawItem(coins, need);
                log(`Withdraw coins: ${r.success ? 'ok' : r.message}`);
            }
        }
        await bot.closeBank();
        log(
            `Bank prep done inv=${sdk
                .getInventory()
                .filter((i) => (i.count ?? 0) > 0)
                .map((i) => `${i.name}×${i.count ?? 1}`)
                .join(', ') || '(empty)'}`
        );
    }

    async function ensureSupplies(): Promise<void> {
        if (hasHelm() && hasChain()) return;
        const ctx = supplyCtx();
        if (!hasHelm() || !hasChain()) await ensureCoins(ctx, 280);
        if (!hasHelm()) {
            await ensureItem(ctx, HELM, 1, {
                label: 'bronze med helm',
                shop: SHOPS.PEKSA,
                coinsNeeded: 280,
                bankFirst: true
            });
        }
        if (!hasChain()) {
            await ensureItem(ctx, CHAIN, 1, {
                label: 'iron chainbody',
                shop: SHOPS.HORVIK,
                coinsNeeded: 280,
                bankFirst: true
            });
        }
    }

    async function equipDisguise(): Promise<void> {
        if (disguised()) return;
        await ensureSupplies();
        intent('Equipping bronze med helm + iron chainbody');
        const helm = sdk.findInventoryItem(HELM);
        const chain = sdk.findInventoryItem(CHAIN);
        if (helm) await bot.equipItem(helm);
        if (chain) await bot.equipItem(chain);
        await sdk.waitForTicks(1);
        if (!disguised()) log(`Disguise incomplete: ${sdk.getEquipment().map((i) => i.name).join(', ')}`);
    }

    async function goToAmik(): Promise<void> {
        intent('Walking to Sir Amik Varze');
        if (!atCastle()) await toGround();
        await walkNear(FALADOR_CASTLE_STAIRS.x, FALADOR_CASTLE_STAIRS.z, 2);
        if (pos().level < 2) await climbTo(2, FALADOR_CASTLE_STAIRS);
        await walkNear(SIR_AMIK.x, SIR_AMIK.z, 3);
    }

    async function leaveCastle(): Promise<void> {
        if (atCastle() && pos().level !== 0) {
            intent('Leaving White Knights\' Castle');
            await climbTo(0, FALADOR_CASTLE_STAIRS);
        }
    }

    type AmikPhase = 'unknown' | 'not-started' | 'qp-blocked' | 'spy1' | 'spy2' | 'spy3' | 'done';

    function phaseFromText(text: string): AmikPhase {
        if (/completed the[\s\S]{0,80}black knights|hello, friend|sir amik hands you 2500/i.test(text)) return 'done';
        if (/ruined the|withdraw their demands|you said you were going to pay/i.test(text)) return 'spy3';
        if (/potion of invincibility|froth and bubble|witch groan/i.test(text)) return 'spy2';
        if (/haven.?t managed to find|how'?s the mission going/i.test(text)) return 'spy1';
        if (/i seek a quest|laugh in the face of danger|give it a go/i.test(text) && /ok, i'?ll give it a try|secret weapon/i.test(text)) {
            return 'spy1';
        }
        if (/i seek a quest|laugh in the face of danger/i.test(text)) return 'not-started';
        return 'unknown';
    }

    function insideFortress(): boolean {
        const p = pos();
        if (p.level > 0) return true;
        if (inSecretRoom() || inEastInterior()) return true;
        // Entrance yard only — north ice / south slope is already outside.
        return p.x >= 3014 && p.x <= 3020 && p.z >= 3510 && p.z <= 3518;
    }

    async function leaveFortress(): Promise<void> {
        if (!insideFortress()) return;
        intent('Leaving Black Knights\' Fortress');
        await waitCombat();

        if (pos().level >= 1 && distTo(HOLE.x, HOLE.z) <= 12 && pos().z <= 3510) {
            await sdk.scanNearbyLocs(8).catch(() => {});
            const wall = locAt(3030, 3510, /wall/i) ?? sdk.findNearbyLoc(/wall/i, { withOption: /push/i });
            if (wall) {
                const r = await bot.interactLoc(wall, /push/i);
                log(`Exit hole-room wall: ${r.success ? 'ok' : r.message}`);
                await sdk.sendWalk(3029, 3511, true);
                await sdk.waitForCondition(() => pos().x <= 3029 && pos().z >= 3510, 6_000).catch(() => {});
            }
        }

        for (let i = 0; i < 24 && insideFortress(); i++) {
            await closeUi();
            await waitCombat();
            await sdk.scanNearbyLocs(10).catch(() => {});

            if (pos().level === 0 && distTo(FORTRESS.x, FORTRESS.z) <= 6 && !inSecretRoom() && !inEastInterior()) {
                break;
            }

            if (inSecretRoom()) {
                await sdk.sendInteractLoc(SECRET_WALL.x, SECRET_WALL.z, 2341, 1);
                await sdk.sendWalk(FORTRESS.x, FORTRESS.z, true);
                await sdk.waitForTicks(3);
                continue;
            }

            const down = (sdk.getNearbyLocs() ?? [])
                .filter(
                    (l) =>
                        /ladder|stair/i.test(l.name) &&
                        l.optionsWithIndex.some((o) => /climb-down/i.test(o.text)) &&
                        (l.reachable || (l.distance ?? 99) <= 3) &&
                        !(inEastInterior() && l.x === 3021 && l.z === 3510)
                )
                .sort((a, b) => (a.distance ?? 99) - (b.distance ?? 99))[0];
            if (down && pos().level > 0 && pos().x <= 3018) {
                await bot.interactLoc(down, /climb-down/i);
                await sdk.waitForCondition((s) => (s.player?.level ?? 1) < pos().level, 8_000).catch(() => {});
                continue;
            }

            const door = (sdk.getNearbyLocs() ?? [])
                .filter(
                    (l) =>
                        /^(door|sturdy door)$/i.test(l.name) &&
                        l.optionsWithIndex.some((o) => /open/i.test(o.text)) &&
                        (l.distance ?? 99) <= 5 &&
                        l.x < pos().x
                )
                .sort((a, b) => (a.x ?? 99) - (b.x ?? 99))[0];
            if (door) {
                await bot.openDoor(door);
                await sdk.waitForTicks(1);
            }

            const tx = pos().x - 1;
            const tz = pos().z;
            const before = { x: pos().x, z: pos().z };
            await sdk.sendWalk(tx, tz, true);
            await sdk.waitForTicks(3);
            if (pos().x === before.x && pos().z === before.z && pos().x >= 3029 && pos().z >= 3511) {
                log('Stuck north of hole wall — going back through and west inside');
                await sdk.scanNearbyLocs(8).catch(() => {});
                const wall = locAt(3030, 3510, /wall/i);
                if (wall) await bot.interactLoc(wall, /push/i);
                await sdk.sendWalk(3022, 3510, true);
                await sdk.waitForTicks(4);
            }
            log(`Leaving @ ${pos().x},${pos().z} L${pos().level}`);
        }

        if (pos().level !== 0) await toGround();
        await walkNear(FORTRESS.x, FORTRESS.z - 6, 5);
        log(`Left fortress @ ${pos().x},${pos().z} L${pos().level}`);
    }

    async function visitAmik(): Promise<AmikPhase> {
        await goToAmik();
        const amik = sdk.findNearbyNpc(/amik/i);
        if (!amik) {
            log(`Sir Amik not found @ ${pos().x},${pos().z} L${pos().level}`);
            return 'unknown';
        }
        await bot.talkTo(amik);
        const seen = await chat([
            /i seek a quest/i,
            /laugh in the face of danger/i,
            /give it a go/i,
            /oh, i suppose i'?ll give it a go/i
        ]);
        await chat();
        const text = `${seen.join(' | ')}\n${messages()}`;
        // 12-QP gate (sir_amik_varze.rs2: `%qp < 12` refuses the quest).
        // Refuse here instead of looping on a quest we can never start.
        if (/12 quest points|unexperienced quester/i.test(text)) {
            log(`Sir Amik refused: account below 12 QP :: ${seen.join(' | ')}`);
            await leaveCastle();
            return 'qp-blocked';
        }
        const phase = phaseFromText(text);
        log(`Sir Amik: ${phase} :: ${seen.join(' | ')}`);
        await leaveCastle();
        return phase;
    }

    async function tryPickCabbageLoc(cx: number, cz: number): Promise<boolean> {
        await walkNear(cx, cz, 3);
        for (let dx = -4; dx <= 4 && count(CABBAGE) < 1; dx++) {
            for (let dz = -4; dz <= 4 && count(CABBAGE) < 1; dz++) {
                await sdk.sendInteractLoc(cx + dx, cz + dz, CABBAGE_LOC_ID, CABBAGE_PICK_OP);
                if (count(CABBAGE) > 0 || /you pick a cabbage/i.test(messages())) return true;
            }
        }
        return count(CABBAGE) > 0;
    }

    async function pickCabbage(): Promise<void> {
        if (count(CABBAGE) > 0) return;
        intent('Getting a cabbage');
        if (await tryPickCabbageLoc(MONASTERY_GARDEN.x, MONASTERY_GARDEN.z)) return;
        const ctx = supplyCtx();
        await buyAtShop(ctx, SHOPS.WYDIN, [{ pattern: CABBAGE, amount: 1, label: 'cabbage' }]);
        if (count(CABBAGE) < 1) log(`Still no cabbage @ ${pos().x},${pos().z}`);
    }

    async function pushSecretWall(): Promise<boolean> {
        if (inSecretRoom()) return true;
        await walkNear(SECRET_WALL.x, SECRET_WALL.z, 2);
        await sdk.scanNearbyLocs(8).catch(() => {});
        const wall =
            sdk.findNearbyLoc(/wall/i, { withOption: /push/i }) ??
            sdk.findNearbyLoc(/wall|secret/i);
        if (!wall) {
            log(`No pushable wall @ ${pos().x},${pos().z}`);
            return false;
        }
        const r = await bot.interactLoc(wall, /push|search/i);
        log(`Push wall: ${r.success ? 'ok' : r.message} @ ${wall.x},${wall.z}`);
        await sdk.sendWalk(INNER_LADDER.x, INNER_LADDER.z, true);
        await sdk.waitForCondition(() => inSecretRoom(), 4_000).catch(() => {});
        log(`After push @ ${pos().x},${pos().z} L${pos().level}`);
        return inSecretRoom();
    }

    async function climbInnerLadder(): Promise<boolean> {
        if (pos().level >= 2 && pos().x >= 3014 && pos().x <= 3036 && pos().z >= 3505 && pos().z <= 3521) {
            return true;
        }
        if (pos().level === 0 && !inSecretRoom()) return false;
        await sdk.scanNearbyLocs(8).catch(() => {});
        if (pos().level === 0) {
            const ladder = locAt(INNER_LADDER.x, INNER_LADDER.z, /ladder/i) ??
                sdk.findNearbyLoc(/ladder/i, { withOption: /climb-up/i });
            if (!ladder) {
                log(`Inner ladder missing @ ${pos().x},${pos().z}`);
                return false;
            }
            const r = await bot.interactLoc(ladder, /climb-up/i);
            log(`Inner ladder L0: ${r.success ? 'ok' : r.message}`);
            await sdk.waitForCondition((s) => (s.player?.level ?? 0) > 0, 8_000).catch(() => {});
        }
        if (pos().level === 1) {
            await sdk.scanNearbyLocs(8).catch(() => {});
            const up = (sdk.getNearbyLocs() ?? []).find(
                (l) =>
                    /ladder/i.test(l.name) &&
                    l.optionsWithIndex.some((o) => /climb-up/i.test(o.text)) &&
                    (l.reachable || (l.distance ?? 99) <= 2)
            );
            if (up) {
                const r = await bot.interactLoc(up, /climb-up/i);
                log(`Inner ladder L1 @ ${up.x},${up.z}: ${r.success ? 'ok' : r.message}`);
                await sdk.waitForCondition((s) => (s.player?.level ?? 1) > 1, 8_000).catch(() => {});
            }
        }
        return pos().level >= 1;
    }

    async function infiltrateFortress(): Promise<void> {
        intent('Entering Black Knights\' Fortress');
        await equipDisguise();
        // Disguise gate (quest_blackknight.rs2: the entrance door checks bronze
        // med helm + iron chainbody WORN). Refuse entry, don't feed the guard.
        if (!disguised()) {
            throw new Error(
                `Black Knights' Fortress requires bronze med helm + iron chainbody disguise — could not equip (${sdk.getEquipment().map((i) => i.name).join(', ')})`
            );
        }
        if (inEastInterior()) {
            if (pos().level === 0) {
                await sdk.scanNearbyLocs(8).catch(() => {});
                const up = sdk.findNearbyLoc(/ladder/i, { withOption: /climb-up/i });
                if (up) {
                    await bot.interactLoc(up, /climb-up/i);
                    await sdk.waitForCondition((s) => (s.player?.level ?? 0) > 0, 8_000).catch(() => {});
                }
            }
            log(`Already in east interior @ ${pos().x},${pos().z} L${pos().level}`);
            return;
        }
        if (pos().level === 1 && atFortress() && pos().x >= 3014) {
            await climbInnerLadder();
            await sdk.scanNearbyLocs(12).catch(() => {});
            log(
                `Infiltrate done @ ${pos().x},${pos().z} L${pos().level} locs=${(sdk.getNearbyLocs() ?? [])
                    .slice(0, 12)
                    .map((l) => `${l.name}@${l.x},${l.z}${l.reachable ? '' : '(U)'}`)
                    .join('; ')}`
            );
            return;
        }
        if (!inSecretRoom()) {
            if (pos().level !== 0) await toGround();
            if (pos().x < 3014 && pos().z >= 3510) await walkNear(3016, 3510, 3);
            await walkNear(FORTRESS.x, FORTRESS.z, 3);
            await waitCombat();
            await sdk.scanNearbyLocs(8).catch(() => {});
            const door = sdk.findNearbyLoc(/sturdy door/i, { withOption: /open/i });
            if (door && (door.distance ?? 99) <= 4) {
                await bot.openDoor(door);
                await sdk.waitForTicks(1);
                await chat([/oh sorry/i]);
                // Guard rejection routes back to the disguise, not through the wall.
                if (/not a guard|proper guards uniform/i.test(messages())) {
                    log('Guard rejected entry — re-equipping disguise before retry');
                    await equipDisguise();
                    return;
                }
            }
            await pushSecretWall();
        }
        await climbInnerLadder();
        await sdk.scanNearbyLocs(12).catch(() => {});
        log(
            `Infiltrate done @ ${pos().x},${pos().z} L${pos().level} locs=${(sdk.getNearbyLocs() ?? [])
                .slice(0, 12)
                .map((l) => `${l.name}@${l.x},${l.z}${l.reachable ? '' : '(U)'}`)
                .join('; ')}`
        );
    }

    async function hop(x: number, z: number, ticks = 4): Promise<boolean> {
        if (pos().x === x && pos().z === z) return true;
        await sdk.sendWalk(x, z, true);
        await sdk.waitForCondition(() => pos().x === x && pos().z === z, ticks * 800).catch(() => {});
        if (pos().x !== x || pos().z !== z) {
            log(`Hop ${x},${z} landed ${pos().x},${pos().z}`);
        }
        return pos().x === x && pos().z === z;
    }

    async function openBanquetDoor(): Promise<boolean> {
        // Opening this door walks through it. If we are already on the banquet
        // side, clicking it again is the in-out loop.
        if (pos().x >= 3026) return true;
        if (pos().x === 3025 && pos().z === 3511) {
            await hop(3026, 3511);
            return pos().x >= 3026;
        }
        await sdk.scanNearbyLocs(10).catch(() => {});
        const door =
            locAt(3025, 3511, /sturdy door|door/i) ??
            sdk.findNearbyLoc(/sturdy door/i, { withOption: /open/i });
        if (!door || (door.distance ?? 99) > 6) return inEastInterior();
        if (!door.reachable) await hop(3024, 3511);
        const r = door.reachable
            ? await bot.openDoor(door)
            : await sdk.sendInteractLoc(door.x, door.z, door.id, 1);
        log(`Banquet door @ ${door.x},${door.z}: ${r.success ? 'ok' : r.message}`);
        await chat([/i don'?t care/i, /going in anyway/i]);
        await sdk.waitForTicks(2);
        if (pos().x < 3026) await hop(3026, 3511);
        return pos().x >= 3026;
    }

    async function crossToBanquet(): Promise<boolean> {
        if (inEastInterior()) return true;
        intent('Crossing to the east banquet / hole rooms');
        for (let i = 0; i < 10 && !inEastInterior(); i++) {
            await closeUi();
            await waitCombat();
            await sdk.scanNearbyLocs(12).catch(() => {});

            if (await openBanquetDoor()) return true;

            const up = (sdk.getNearbyLocs() ?? []).find(
                (l) =>
                    /ladder/i.test(l.name) &&
                    l.optionsWithIndex.some((o) => /climb-up/i.test(o.text)) &&
                    (l.reachable || (l.distance ?? 99) <= 2) &&
                    l.x >= 3022
            );
            if (pos().level === 1 && pos().x < 3025 && up) {
                await bot.interactLoc(up, /climb-up/i);
                await sdk.waitForCondition((s) => (s.player?.level ?? 1) > 1, 8_000).catch(() => {});
                continue;
            }

            if (pos().level >= 2 && pos().x < 3026) {
                const tx = Math.min(pos().x + 3, 3026);
                log(`L2 hop east @ ${pos().x},${pos().z} -> ${tx},3514`);
                await hop(tx, 3514);
                continue;
            }

            if (pos().level >= 2 && pos().x >= 3023) {
                const down = (sdk.getNearbyLocs() ?? []).find(
                    (l) =>
                        /ladder/i.test(l.name) &&
                        l.x >= 3023 &&
                        l.optionsWithIndex.some((o) => /climb-down/i.test(o.text)) &&
                        (l.reachable || (l.distance ?? 99) <= 2)
                );
                if (down) {
                    await bot.interactLoc(down, /climb-down/i);
                    await sdk.waitForCondition((s) => (s.player?.level ?? 2) < 2, 8_000).catch(() => {});
                    continue;
                }
            }

            await hop(Math.min(pos().x + 2, 3026), pos().z >= 3514 ? 3515 : pos().z);
            log(`Cross attempt @ ${pos().x},${pos().z} L${pos().level}`);
        }
        return inEastInterior();
    }

    async function openInteriorDoors(): Promise<void> {
        await sdk.scanNearbyLocs(10).catch(() => {});
        const doors = (sdk.getNearbyLocs() ?? [])
            .filter((l) => /^(door|sturdy door)$/i.test(l.name) && l.optionsWithIndex.some((o) => /open/i.test(o.text)))
            .filter((l) => !(l.x === 3025 && l.z === 3511 && pos().x >= 3026))
            .filter((l) => l.reachable && (l.distance ?? 99) <= 6)
            .sort((a, b) => (a.distance ?? 99) - (b.distance ?? 99));
        for (const door of doors.slice(0, 3)) {
            const r = await bot.openDoor(door);
            log(`Open ${door.name} @ ${door.x},${door.z}: ${r.success ? 'ok' : r.message}`);
            await chat([/i don'?t care/i, /going in anyway/i, /oh sorry/i]);
            await sdk.waitForTicks(1);
        }
    }

    async function listenGrill(): Promise<void> {
        intent('Listening at the grill');
        if (pos().level < 1 || !atFortress()) await infiltrateFortress();
        await crossToBanquet();
        for (let attempt = 0; attempt < 8 && !heardWitch(); attempt++) {
            await waitCombat();
            await openInteriorDoors();
            await sdk.scanNearbyLocs(12).catch(() => {});
            const grill =
                sdk.findNearbyLoc(/grill|grate/i, { withOption: /listen/i }) ??
                sdk.findNearbyLoc(/grill|grate/i);
            if (grill) {
                const r = await bot.interactLoc(grill, /listen|search/i);
                log(`Grill: ${r.success ? 'ok' : r.message} L${pos().level} @ ${grill.x},${grill.z} msgs=${messages().split('\n').slice(-4).join(' / ')}`);
                await sdk.waitForTicks(4);
                await chat();
                if (heardWitch()) return;
            }
            const down = (sdk.getNearbyLocs() ?? []).find(
                (l) =>
                    /ladder|stair/i.test(l.name) &&
                    !(l.x === INNER_LADDER.x && l.z === INNER_LADDER.z) &&
                    l.optionsWithIndex.some((o) => /climb-down/i.test(o.text)) &&
                    (l.distance ?? 99) <= 6
            );
            if (down && pos().level > 0 && distTo(GRILL.x, GRILL.z) <= 12) {
                await bot.interactLoc(down, /climb-down/i);
                await sdk.waitForCondition((s) => (s.player?.level ?? 1) === 0, 8_000).catch(() => {});
                continue;
            }
            const tx = Math.min(pos().x + 5, HOLE.x);
            const tz = pos().z > HOLE.z ? Math.max(pos().z - 4, HOLE.z) : pos().z;
            log(`Advancing inside @ ${pos().x},${pos().z} L${pos().level} -> ${tx},${tz}`);
            const before = { ...pos() };
            await sdk.sendWalk(tx, tz, true);
            await sdk.waitForTicks(3);
            if (pos().x === before.x && pos().z === before.z) await walkNear(tx, tz, 2);
        }
    }

    async function sabotageCauldron(): Promise<void> {
        if (count(CABBAGE) < 1) await pickCabbage();
        if (count(CABBAGE) < 1) return;
        intent('Dropping cabbage into the cauldron hole');
        if (inEastInterior() && pos().level === 0) {
            await sdk.scanNearbyLocs(8).catch(() => {});
            const up = locAt(3021, 3510, /ladder/i) ?? sdk.findNearbyLoc(/ladder/i, { withOption: /climb-up/i });
            if (up) {
                await bot.interactLoc(up, /climb-up/i);
                await sdk.waitForCondition((s) => (s.player?.level ?? 0) > 0, 8_000).catch(() => {});
            }
        } else if (pos().level < 1 || !atFortress() || pos().x < 3014) {
            await infiltrateFortress();
        }
        if (pos().x < 3026) await crossToBanquet();
        await waitCombat();
        // Secret wall 2341 sits at (3030,3510) facing south. Banquet tile
        // (3029,3511) is only diagonal to it; the engine then pathfinds
        // *through* the east castle wall and says I can't reach. Stand west
        // of the wall on the same z (around the armour) so the op is orthogonal.
        const toPushTile: Array<[number, number]> = [
            [3028, 3511],
            [3028, 3510],
            [3029, 3510]
        ];
        for (const [x, z] of toPushTile) {
            if (pos().x === 3029 && pos().z === 3510) break;
            await hop(x, z, 6);
            await waitCombat();
        }
        await sdk.scanNearbyLocs(10).catch(() => {});
        const walls = (sdk.getNearbyLocs() ?? []).filter((l) => /wall|door|hole/i.test(l.name));
        log(
            `Hole-room locs @ ${pos().x},${pos().z} L${pos().level}: ${walls
                .map((l) => `${l.name}#${l.id}@${l.x},${l.z}${l.reachable ? '' : '(U)'}[${l.options.join(',')}]`)
                .join('; ')}`
        );
        const inHoleRoom = () => pos().z <= 3509 && pos().x >= 3029;
        const holeWall = locAt(HOLE_WALL.x, HOLE_WALL.z, /wall/i) ?? walls.find((l) => /push/i.test(l.options.join(' ')));
        if (!inHoleRoom() && pos().z === HOLE_WALL.z) {
            const id = holeWall?.id ?? 2341;
            const pr = await sdk.sendInteractLoc(HOLE_WALL.x, HOLE_WALL.z, id, 1);
            log(`Push hole-room wall id=${id}: ${pr.success ? 'ok' : pr.message} from ${pos().x},${pos().z}`);
            await sdk.waitForCondition(() => inHoleRoom() || /secret passage/i.test(messages()), 6_000).catch(() => {});
        }
        if (inHoleRoom() || /secret passage/i.test(messages())) {
            await hop(HOLE.x, HOLE.z);
        }
        if (!inHoleRoom()) {
            log(`Still outside hole room @ ${pos().x},${pos().z} — not walking the hole (that loops the door)`);
            return;
        }
        const cabbage = sdk.findInventoryItem(CABBAGE);
        if (!cabbage) {
            log(`No cabbage @ ${pos().x},${pos().z} L${pos().level}`);
            return;
        }
        await sdk.scanNearbyLocs(8).catch(() => {});
        const hole = sdk.findNearbyLoc(/^hole$/i) ?? sdk.findNearbyLoc(/hole/i);
        const r =
            hole && hole.reachable
                ? await bot.useItemOnLoc(cabbage, hole)
                : await sdk.sendUseItemOnLoc(cabbage.slot, HOLE.x, HOLE.z, 2336);
        log(`Cabbage on hole: ${r.success ? 'ok' : r.message} @ ${pos().x},${pos().z} L${pos().level}`);
        await sdk.waitForTicks(4);
        await chat();
    }

    const coinsBefore = coinCount();
    await bot.skipTutorial();
    await closeUi();
    if (TO_FALLY) {
        log(`Leaving for Falador east bank @ ${pos().x},${pos().z} L${pos().level}`);
        await waitCombat();
        await leaveFortress();
        if (pos().level !== 0) await toGround();
        intent('Walking to Falador east bank');
        await walkNear(FALLY_EAST.x, FALLY_EAST.z, 3);
        log(`At Falador east bank @ ${pos().x},${pos().z}`);
        return;
    }
    // Ask the journal BEFORE banking: an account that already finished must
    // not be sent to deposit, shop, or disguise first.
    const startStage = await readStage();
    log(`Black Knights' Fortress journal stage at start: ${startStage}`);
    if (startStage === 'unknown') {
        throw new Error("could not determine the Black Knights' Fortress stage from the journal");
    }
    if (startStage === 'complete') {
        log("Black Knights' Fortress is already complete — nothing to do");
        return;
    }
    await bankPrep();
    await ensureSupplies();
    log(`Black Knights' Fortress start coins=${coinsBefore} @ ${pos().x},${pos().z} L${pos().level} disguise=${disguised()} finish=${FINISH_ONLY}`);

    if (FINISH_ONLY) {
        await leaveFortress();
        const phase = await visitAmik();
        if (phase === 'qp-blocked') throw new Error("Black Knights' Fortress requires 12 quest points — Sir Amik refused");
        if ((await questDone()) || phase === 'done' || phase === 'spy3') {
            if (!(await questDone())) await visitAmik();
        }
        if (!(await questDone())) throw new Error(`Black Knights' Fortress unfinished after hand-in @ ${pos().x},${pos().z}`);
        log(`QUEST COMPLETE Black Knights' Fortress (+${coinCount() - coinsBefore} gp)`);
        return;
    }

    const until = Date.now() + 18 * 60_000;
    let started = false;
    while (Date.now() < until && !(await questDone())) {
        await closeUi();
        await eatIfLow();

        if (sabotaged() || /ruined the/i.test(messages())) {
            await visitAmik();
            if (await questDone()) break;
        }

        if (!started) {
            if ((atFortress() && disguised() && count(CABBAGE) > 0) || inEastInterior() || inSecretRoom()) {
                log('Resuming at fortress with cabbage — skipping Sir Amik');
                started = true;
            } else {
                const phase = await visitAmik();
                started = true;
                if (phase === 'qp-blocked') throw new Error("Black Knights' Fortress requires 12 quest points — Sir Amik refused");
                if (phase === 'done' || phase === 'spy3' || (await questDone())) break;
            }
        }

        await equipDisguise();
        await pickCabbage();
        await infiltrateFortress();
        if (!grillAlreadyDone() && pos().x < 3026) await listenGrill();
        await sabotageCauldron();

        log(`helm=${disguised()} cabbage=${count(CABBAGE)} sabotaged=${sabotaged()} @ ${pos().x},${pos().z} L${pos().level}`);
        await sdk.waitForTicks(2);
    }

    if (!(await questDone())) throw new Error(`Black Knights' Fortress unfinished @ ${pos().x},${pos().z}`);
    log(`QUEST COMPLETE Black Knights' Fortress (+${coinCount() - coinsBefore} gp)`);
});
