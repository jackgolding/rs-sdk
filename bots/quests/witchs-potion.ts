/**
 * Witch's Potion — replayable, checkpoint-gated (quest-lab standard).
 *
 *   bun bots/quests/witchs-potion.ts <botname>
 *
 * Starts Hetty in Rimmington, supplies onion / rat's tail / eye of newt /
 * burnt meat (bank first, gather only what the bank cannot give), hands them
 * in, then drinks the cauldron.
 *
 * Content this encodes (read from server/content, never from memory):
 *   areas/area_rimmington/scripts/hetty.rs2
 *     %hetty = ^hetty_not_started -> "What could you want with an old woman
 *       like me?" then p_choice2 "I am in search of a quest." and p_choice3
 *       "Yes help me become one with my darker side." -> ^hetty_started
 *     %hetty = ^hetty_started & all four ingredients in the pack -> mesbox
 *       "You pass the ingredients to Hetty and she puts them all into her
 *       cauldron..." -> inv_del x4 -> %hetty = ^hetty_objects_given
 *     %hetty = ^hetty_objects_given -> "Well are you going to drink the potion
 *       or not?"
 *     %hetty = ^hetty_complete -> "How's your magic coming along?"
 *   quests/quest_hetty/scripts/quest_hetty.rs2
 *     cauldron op1 "Drink From" (only while ^hetty_objects_given) ->
 *       queue hetty_quest_complete -> %hetty = ^hetty_complete,
 *       stat_advance(magic, 3250), send_quest_complete(questlist:hetty, ...)
 *   quests/quest_hetty/scripts/hetty_journal.rs2 -> four journal stages,
 *     heading "Witch's Potion"; player/interfaces/questlist.if [hetty] ->
 *     list label "Witch's Potion".
 *
 * Completion is the JOURNAL's own "QUEST COMPLETE!" line. It is never an XP
 * delta (this account is maxed, so Magic 99 exists before the quest starts),
 * never a chat line (the message ring drops it across a restart, so "never
 * started" and "no proof yet" read the same), and never an item count (the
 * ingredients are consumed by the hand-in, not by the completion).
 *
 * Movement notes:
 *   - route waypoints below are COMPUTED from the repo's collision data
 *     (`findLongPath`) every ~22 tiles, so a restart anywhere on the leg
 *     still routes.
 *   - the two long legs are walked waypoint by waypoint with displacement
 *     verified and a progress note per hop (a 150-tile leg is blind for
 *     minutes otherwise, and the stall clock parks a working run).
 *   - the bank leg starts inside/next to Hetty's hut, whose door tile
 *     (2965,3206) the planner masks: the first leg therefore aims at the hut's
 *     outside tiles, and every open door on the way is opened explicitly.
 */
import { appendFileSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

import { runScript } from '../../sdk/runner';
import { ActivitySession } from '../../sdk/activity';
import { readJournalCheckpoint } from '../../quest-lab/journal-reader';
import { appendCheckpoint, createRun, safeRunId, summarizeRun } from '../../quest-lab/records';
import type { JournalRule } from '../../quest-lab/evidence';
import { leaveAltar, leaveMine } from './air-runes-shared';

const FALADOR_EAST = { x: 3012, z: 3355 };
const HETTY = { x: 2968, z: 3206 };
/** Standable tile just outside Hetty's hut — the door tile itself is masked. */
const HETTY_DOORSTEP = { x: 2968, z: 3210 };
const ONIONS = { x: 2950, z: 3251 };
const RATS = { x: 2953, z: 3204 };
const BETTY = { x: 3012, z: 3259 };
const WYDIN = { x: 3014, z: 3204 };
const RANGE = { x: 2970, z: 3209 };

/** Planner output (findLongPath, ~22-tile spacing): Hetty's hut -> Falador east. */
const TO_BANK = [
    { x: 2970, z: 3236 },
    { x: 2981, z: 3259 },
    { x: 3001, z: 3281 },
    { x: 2998, z: 3304 },
    { x: 3005, z: 3330 },
    { x: 3006, z: 3355 },
    { x: 3012, z: 3355 }
];
/** Planner output (findLongPath, ~22-tile spacing): Falador east -> Hetty's hut. */
const TO_HETTY = [
    { x: 3008, z: 3318 },
    { x: 3007, z: 3288 },
    { x: 2989, z: 3268 },
    { x: 2980, z: 3241 },
    { x: 2968, z: 3218 },
    { x: 2968, z: 3210 }
];

const ONION = /^onion$/i;
const TAIL = /^rat'?s tail$/i;
const NEWT = /^eye of newt$/i;
const BURNT = /^burnt meat$/i;
const COOKED = /^cooked meat$/i;
const RAW_BEEF = /^raw beef$/i;
const RAW_CHICKEN = /^raw chicken$/i;
const COINS = /^coins$/i;
const FOOD = /^(swordfish|lobster|tuna|shark|salmon|trout|bass|anchovies|sardine|herring|bread|cake|wine)$/i;
const KEEP =
    /^(onion|rat'?s tail|eye of newt|burnt meat|cooked meat|raw beef|raw chicken|coins|swordfish|lobster|tuna|shark)$/i;

const JOURNAL = { label: "Witch's Potion", title: "Witch's Potion" };
type Stage = 'unstarted' | 'active' | 'given' | 'complete';
const STAGE_ORDER: Stage[] = ['unstarted', 'active', 'given', 'complete'];

/**
 * Journal rules, one sentence UNIQUE to each stage of
 * `hetty_journal.rs2` (verified in both directions):
 *   not_started  "I can start this quest by speaking to Hetty ..." — the only
 *                place that sentence exists.
 *   started      "Hetty needs me to bring her the following:" — absent from
 *                the objects-given and complete entries.
 *   objects_given "I should drink from the cauldron and improve my magic!" —
 *                the complete entry says "I drank", so "I should drink" only
 *                ever renders while the potion is waiting.
 *   complete     "@red@QUEST COMPLETE!" — the terminal entry, and nothing else.
 */
const RULES: Record<Stage, JournalRule> = {
    unstarted: { id: 'hetty:unstarted', kind: 'unstarted', all: ['I can start this quest by speaking to'] },
    active: { id: 'hetty:active', kind: 'active', all: ['Hetty needs me to bring her the following'] },
    given: { id: 'hetty:given', kind: 'active', all: ['I should drink from the'] },
    complete: { id: 'hetty:complete', kind: 'complete', all: ['QUEST COMPLETE'] }
};

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
        return sdk.getInventory().filter((i) => pattern.test(i.name)).reduce((n, i) => n + (i.count ?? 1), 0);
    }

    // ── session / durable run record ────────────────────────────────────────
    // stallMs is sized to the longest BLIND leg (the ~150-tile Falador<->Rimmington
    // trek emits no effect for minutes on a slow link); intent is not the clock.
    const session = new ActivitySession(sdk, bot, {
        name: "witch's potion",
        grindLogPath: GRIND_LOG,
        stallMs: 600_000,
        maxRecoveryTactics: 6
    });
    await session.setPhase('start');

    const username = process.env.BOT_USERNAME ?? 'unknown';
    const run = createRun(join(process.cwd(), 'quest-lab', 'runs'), safeRunId('hetty', username, new Date().toISOString()), {
        questId: 'hetty',
        account: username,
        mode: process.env.QUEST_LAB_MODE === 'staging' ? 'staging' : 'development',
        scriptHash: Bun.hash(await Bun.file(import.meta.path).text()).toString(16),
        fixtureHash: process.env.QUEST_LAB_FIXTURE_HASH ?? 'unrecorded',
        contentHash: process.env.QUEST_LAB_CONTENT_HASH ?? 'unrecorded',
        // Rewritten from the probed stage before the first side effect: a resume
        // can never re-demonstrate an earlier stage (rule: required must be what
        // the run can actually produce).
        requiredCheckpoints: [...STAGE_ORDER]
    });
    log(`Run record: ${run.directory}`);

    // ── journal state ───────────────────────────────────────────────────────
    let lastStage: Stage | null = null;
    let sawComplete = false;

    /** The first stage rule that PASSes is the account's real stage. */
    async function readStage(): Promise<Stage | null> {
        for (const name of [...STAGE_ORDER].reverse()) {
            const read = await readJournalCheckpoint(sdk, JOURNAL, RULES[name]);
            if (read.verdict?.verdict === 'PASS') {
                if (name !== lastStage) log(`journal stage: ${name}`);
                lastStage = name;
                if (name === 'complete') sawComplete = true;
                return name;
            }
        }
        // UNKNOWN is "not ready", never "start over": keep the last real stage.
        if (lastStage) log(`journal read UNKNOWN; keeping last stage ${lastStage}`);
        return lastStage;
    }

    /**
     * Record ONE checkpoint, judged only by a fresh journal read. A PASS also
     * marks the state it proved, so the caller never re-runs a finished stage
     * off a stale flag.
     */
    async function checkpoint(name: Stage, label: string): Promise<boolean> {
        let last = { verdict: 'UNKNOWN' as string, reason: 'not read', rawLines: [] as { componentId: number; rawText: string; text: string }[] };
        for (let attempt = 1; attempt <= 3; attempt++) {
            const read = await readJournalCheckpoint(sdk, JOURNAL, RULES[name]);
            last = { verdict: read.verdict?.verdict ?? 'UNKNOWN', reason: read.reason, rawLines: read.rawLines };
            if (last.verdict === 'PASS') {
                appendCheckpoint(run.directory, {
                    checkpointId: name,
                    verdict: 'PASS',
                    reason: read.reason,
                    kind: RULES[name].kind,
                    rawLines: read.rawLines
                });
                lastStage = name;
                if (name === 'complete') sawComplete = true;
                log(`CHECKPOINT ${name} PASS (${label}) — ${read.reason}`);
                session.log('log', `checkpoint ${name} PASS: ${label}`);
                session.noteProgress('dialog', `checkpoint ${name}`);
                return true;
            }
            log(`CHECKPOINT ${name} ${last.verdict} (attempt ${attempt}/3): ${last.reason}`);
            await sdk.waitForTicks(6);
        }
        appendCheckpoint(run.directory, {
            checkpointId: name,
            verdict: 'FAIL',
            reason: last.reason,
            kind: RULES[name].kind,
            rawLines: last.rawLines
        });
        for (const line of last.rawLines.slice(0, 12)) log(`    raw: ${JSON.stringify(line.rawText)}`);
        session.log('warn', `checkpoint ${name} FAILED: ${last.reason}`);
        return false;
    }

    async function requireStage(name: Stage, label: string): Promise<void> {
        if (await checkpoint(name, label)) return;
        throw new Error(`journal never showed stage '${name}' (${label}) @ ${pos().x},${pos().z}`);
    }

    // ── ui / dialog ─────────────────────────────────────────────────────────
    async function closeUi(): Promise<void> {
        for (let i = 0; i < 8; i++) {
            await bot.dismissBlockingUI();
            const dialog = sdk.getDialog();
            if (dialog?.isOpen && (dialog.options?.length ?? 0) <= 1) {
                await sdk.sendClickDialog(dialog.options?.[0]?.index ?? 0);
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

    /**
     * Click through a conversation. `choices` are preferred on real CHOICE
     * pages; a lone continue page (and a repeat of a page already advanced) is
     * clicked once. Bounded by a closed-dialog streak, not by page count, so a
     * long chain is not cut short.
     */
    async function chat(choices: RegExp[] = [], max = 40): Promise<string[]> {
        const seen: string[] = [];
        let closed = 0;
        for (let i = 0; i < max; i++) {
            const dialog = sdk.getDialog();
            if (!dialog?.isOpen) {
                if (++closed >= 3) break;
                await sdk.waitForTicks(2);
                continue;
            }
            closed = 0;
            const bits: string[] = [];
            if (dialog.text) bits.push(String(dialog.text));
            for (const c of dialog.allComponents ?? []) if (c.text) bits.push(String(c.text));
            for (const o of dialog.options ?? []) bits.push(`[${o.text}]`);
            const full = bits.join(' | ');
            if (full && seen[seen.length - 1] !== full) seen.push(full);

            const opts = dialog.options ?? [];
            if (opts.length <= 1) {
                await sdk.sendClickDialog(opts[0]?.index ?? 0);
                await sdk.waitForTicks(1);
                continue;
            }
            const match = choices.map((c) => opts.find((o) => c.test(o.text))).find(Boolean);
            if (!match) {
                log(`dialog choice page with no preferred answer: [${opts.map((o) => o.text).join(' / ')}]`);
                break;
            }
            await sdk.sendClickDialog(match.index);
            await sdk.waitForTicks(2);
        }
        return seen;
    }

    /** Clear any modal (the hand-in mesbox) and the remaining continue pages. */
    async function drainRest(): Promise<void> {
        for (let i = 0; i < 20; i++) {
            const dialog = sdk.getDialog();
            if (dialog?.isOpen) {
                const opts = dialog.options ?? [];
                if (opts.length > 1) break; // a real choice we did not mean to answer
                await sdk.sendClickDialog(opts[0]?.index ?? 0);
                await sdk.waitForTicks(1);
                continue;
            }
            const state = sdk.getState();
            if (state?.interface?.isOpen || state?.shop?.isOpen || state?.bank?.isOpen) {
                await bot.dismissBlockingUI();
                await sdk.waitForTicks(1);
                continue;
            }
            break;
        }
        await bot.dismissBlockingUI();
    }

    // ── movement ────────────────────────────────────────────────────────────
    async function openBlockingDoor(): Promise<void> {
        await sdk.scanNearbyLocs(8).catch(() => {});
        const door = (sdk.getNearbyLocs() ?? [])
            .filter((l) => /gate|door/i.test(l.name) && (l.distance ?? 99) <= 8 && l.optionsWithIndex.some((o) => /^open$/i.test(o.text)))
            .sort((a, b) => (a.distance ?? 99) - (b.distance ?? 99))[0];
        if (!door) return;
        log(`Opening ${door.name} @ (${door.x},${door.z})`);
        await bot.openDoor(door);
        await sdk.waitForTicks(2);
    }

    async function walkNear(x: number, z: number, tolerance = 4): Promise<boolean> {
        if (distTo(x, z) <= tolerance) return true;
        await openBlockingDoor();
        const r = await bot.walkTo(x, z, Math.min(tolerance, 3));
        const arrived = r.success || distTo(x, z) <= tolerance + 2;
        if (!arrived) log(`walk to (${x},${z}): ok=${r.success} ${r.message ?? ''} at (${pos().x},${pos().z}) dist=${distTo(x, z).toFixed(1)}`);
        return arrived;
    }

    async function walkRoute(points: Array<{ x: number; z: number }>, what: string): Promise<void> {
        for (let i = 0; i < points.length; i++) {
            const p = points[i]!;
            await closeUi();
            await walkNear(p.x, p.z, 5);
            // A 150-tile leg produces no effect for minutes: credit each hop.
            session.noteProgress('location', `${what} ${i + 1}/${points.length}`);
        }
    }

    // ── sources: bank first, world only for what the bank cannot give ───────
    async function eatIfNeeded(): Promise<void> {
        if (pos().hp >= pos().maxHp - 2) return;
        const food = sdk.findInventoryItem(FOOD);
        if (!food) return;
        intent(`Eating ${food.name} (hp ${pos().hp}/${pos().maxHp})`);
        await bot.eatFood(food);
    }

    async function openBankHere(what: string): Promise<boolean> {
        if (sdk.getState()?.bank?.isOpen) return true;
        await closeUi();
        for (let attempt = 1; attempt <= 2; attempt++) {
            const opened = await bot.openBank();
            if (opened.success) return true;
            log(`bank open failed (${what}, attempt ${attempt}/2): ${opened.message ?? '?'}`);
            if (attempt === 2) break;
            // Booth-adjacency: close, step toward the booth, retry once.
            await bot.closeInterface();
            await bot.walkTo(FALADOR_EAST.x - 1, FALADOR_EAST.z, 1);
            await sdk.waitForTicks(2);
        }
        return false;
    }

    async function prepBank(): Promise<void> {
        await session.setPhase('bank');
        intent('Banking at Falador east');
        await closeUi();
        if (distTo(FALADOR_EAST.x, FALADOR_EAST.z) > 8) await walkRoute(TO_BANK, 'Falador bank');
        if (!(await openBankHere('withdrawals'))) throw new Error(`could not open Falador east bank @ ${pos().x},${pos().z}`);
        // Contents stream a tick or two AFTER isOpen flips: settle before reading.
        await sdk.waitForTicks(2);

        for (let pass = 0; pass < 8; pass++) {
            const junk = sdk.getInventory().find((i) => (i.count ?? 0) > 0 && !KEEP.test(i.name));
            if (!junk) break;
            await bot.depositItem(junk, -1);
        }
        if (count(COINS) < 20) {
            const w = await bot.withdrawItem(COINS, 50);
            if (!w.success) log(`Coin withdraw: ${w.message}`);
        }
        if (!sdk.findInventoryItem(FOOD)) {
            const w = await bot.withdrawItem(FOOD, 5);
            if (!w.success) log(`Food withdraw: ${w.message}`);
        }
        const needs: Array<{ pattern: RegExp; name: string }> = [
            { pattern: ONION, name: 'onion' },
            { pattern: TAIL, name: "rat's tail" },
            { pattern: NEWT, name: 'eye of newt' },
            { pattern: BURNT, name: 'burnt meat' }
        ];
        const bankItems = sdk.getState()?.bank?.items ?? [];
        const inBank = (re: RegExp) => bankItems.filter((i) => re.test(i.name)).reduce((n, i) => n + (i.count ?? 0), 0);
        for (const need of needs) {
            if (count(need.pattern) > 0) continue;
            if (!sdk.getState()?.bank?.isOpen && !(await openBankHere(`withdraw ${need.name}`))) {
                throw new Error(`bank closed before withdrawing ${need.name}`);
            }
            if (inBank(need.pattern) < 1) {
                log(`BANK SHORTFALL: ${need.name}(inv=0 bank=0 need=1) — gathering it instead`);
                continue;
            }
            // Unstackables move one per call: loop until the count is met.
            for (let i = 0; i < 3 && count(need.pattern) < 1; i++) {
                const res = await bot.withdrawItem(need.pattern, 1);
                if (!res.success) log(`withdraw ${need.name}: ${res.message ?? '?'}`);
                await sdk.waitForTicks(1);
            }
        }
        await bot.closeBank();
        await eatIfNeeded();
        session.noteProgress('bank', 'supplies withdrawn');
        log(
            `Prepped @ ${pos().x},${pos().z} hp=${pos().hp} coins=${count(COINS)} ` +
                `onion=${count(ONION)} tail=${count(TAIL)} newt=${count(NEWT)} burnt=${count(BURNT)}`
        );
    }

    async function goHetty(): Promise<void> {
        if (distTo(HETTY.x, HETTY.z) <= 8 && sdk.findNearbyNpc(/hetty/i)) return;
        intent('Walking to Hetty');
        if (distTo(HETTY.x, HETTY.z) > 80) await walkRoute(TO_HETTY, 'Hetty');
        await walkNear(HETTY_DOORSTEP.x, HETTY_DOORSTEP.z, 3);
        await walkNear(HETTY.x, HETTY.z, 4);
    }

    async function talkHetty(choices: RegExp[]): Promise<string[]> {
        await closeUi();
        await goHetty();
        let hetty = sdk.findNearbyNpc(/hetty/i);
        for (let i = 0; i < 3 && !hetty; i++) {
            await sdk.scanNearbyLocs(12).catch(() => {});
            await sdk.waitForTicks(2);
            hetty = sdk.findNearbyNpc(/hetty/i);
        }
        if (!hetty) {
            log(`Hetty not nearby @ ${pos().x},${pos().z}`);
            return [];
        }
        const talk = await bot.talkTo(hetty);
        if (!talk.success) {
            log(`talk Hetty: ${talk.message}`);
            return [];
        }
        await sdk.waitForTicks(1);
        const seen = await chat(choices);
        await drainRest();
        return seen;
    }

    // ── stage actions ───────────────────────────────────────────────────────
    /** ^hetty_not_started -> ^hetty_started, judged on the journal. */
    async function acceptQuest(): Promise<void> {
        const choices = [
            /i am in search of a quest/i,
            /yes help me become one with my darker side/i,
            /yes i'?d like to improve my magic/i,
            /show me the mysteries of the dark arts/i
        ];
        for (let attempt = 1; attempt <= 3; attempt++) {
            await session.setPhase('accept');
            const seen = await talkHetty(choices);
            log(`Hetty (accept ${attempt}/3): ${seen.join(' | ').slice(0, 600) || '(no dialog)'}`);
            await sdk.waitForTicks(3);
            if (await checkpoint('active', 'Hetty asked for the four ingredients')) return;
            log(`accept attempt ${attempt}/3 did not move the journal; re-talking`);
        }
        throw new Error(`quest never started (journal has no "Hetty needs me to bring her the following") @ ${pos().x},${pos().z}`);
    }

    async function pickOnion(): Promise<void> {
        if (count(ONION) > 0) return;
        intent('Picking an onion');
        await closeUi();
        await walkNear(ONIONS.x, ONIONS.z, 4);
        await sdk.scanNearbyLocs(8).catch(() => {});
        const plant = sdk.findNearbyLoc(/^onion$/i, { reachable: true }) ?? sdk.findNearbyLoc(/^onion$/i);
        if (!plant) {
            log(`No onion loc @ ${pos().x},${pos().z}`);
            return;
        }
        const before = count(ONION);
        const r = await bot.interactLoc(plant, /pick/i);
        if (!r.success) log(`pick onion: ${r.message}`);
        await sdk.waitForTicks(2);
        if (count(ONION) > before) session.noteProgress('inventory', 'onion picked');
    }

    async function getNewt(): Promise<void> {
        if (count(NEWT) > 0) return;
        intent('Buying eye of newt from Betty');
        await closeUi();
        await walkNear(BETTY.x, BETTY.z, 4);
        const shop = await bot.openShop(/betty/i);
        if (!shop.success) {
            log(`Betty shop: ${shop.message}`);
            return;
        }
        const buy = await bot.buyFromShop(NEWT, 1);
        if (!buy.success) log(`newt buy: ${buy.message}`);
        await bot.closeShop();
        if (count(NEWT) > 0) session.noteProgress('inventory', 'eye of newt bought');
    }

    async function getMeat(): Promise<void> {
        if (count(BURNT) > 0) return;
        await closeUi();
        if (count(COOKED) < 1 && count(RAW_BEEF) < 1 && count(RAW_CHICKEN) < 1) {
            intent('Buying raw beef from Wydin');
            await walkNear(WYDIN.x, WYDIN.z, 4);
            const shop = await bot.openShop(/wydin/i);
            if (!shop.success) {
                log(`Wydin shop: ${shop.message}`);
                return;
            }
            let buy = await bot.buyFromShop(RAW_BEEF, 1);
            if (!buy.success) buy = await bot.buyFromShop(RAW_CHICKEN, 1);
            if (!buy.success) log(`meat buy: ${buy.message}`);
            await bot.closeShop();
        }
        if (count(BURNT) > 0) return;
        intent('Cooking meat on the Rimmington range');
        await walkNear(RANGE.x, RANGE.z, 4);
        await sdk.scanNearbyLocs(10).catch(() => {});
        const range = sdk.findNearbyLoc(/^range$/i);
        if (!range) {
            log(`No range @ ${pos().x},${pos().z}`);
            return;
        }
        if (count(COOKED) < 1) {
            const raw = sdk.findInventoryItem(RAW_BEEF) ?? sdk.findInventoryItem(RAW_CHICKEN);
            if (raw) {
                const cook = await bot.useItemOnLoc(raw, range);
                if (!cook.success) log(`cook: ${cook.message}`);
                await sdk.waitForTicks(3);
            }
        }
        const cooked = sdk.findInventoryItem(COOKED);
        if (cooked) {
            await sdk.scanNearbyLocs(8).catch(() => {});
            const rangeNow = sdk.findNearbyLoc(/^range$/i) ?? range;
            const burn = await bot.useItemOnLoc(cooked, rangeNow);
            if (!burn.success) log(`burn: ${burn.message}`);
            await sdk.waitForTicks(3);
        }
        if (count(BURNT) > 0) session.noteProgress('inventory', 'burnt meat');
    }

    async function getTail(): Promise<void> {
        if (count(TAIL) > 0) return;
        const ground = sdk.findGroundItem(TAIL);
        if (ground) {
            intent("Picking up rat's tail");
            await bot.pickupItem(ground);
            if (count(TAIL) > 0) session.noteProgress('inventory', "rat's tail picked up");
            return;
        }
        intent('Killing a rat for the tail');
        await closeUi();
        await eatIfNeeded();
        if (distTo(RATS.x, RATS.z) > 12) await walkNear(RATS.x, RATS.z, 5);
        const rat = sdk.findNearbyNpc(/^rat$/i, { reachable: true }) ?? sdk.findNearbyNpc(/^rat$/i);
        if (!rat) {
            log(`No rat @ ${pos().x},${pos().z}`);
            await walkNear(RATS.x, RATS.z, 4);
            return;
        }
        const atk = await bot.attack(rat, 8_000);
        if (!atk.success) log(`attack rat: ${atk.message}`);
        await sdk.waitForCondition(() => !!sdk.findGroundItem(TAIL), 8_000).catch(() => null);
        const item = sdk.findGroundItem(TAIL);
        if (item) await bot.pickupItem(item);
        if (count(TAIL) > 0) session.noteProgress('inventory', "rat's tail from a rat");
    }

    /** Bank stock is primary; the world only covers what the bank shorted. */
    async function gatherRemaining(): Promise<void> {
        await session.setPhase('gather');
        if (count(NEWT) < 1) await getNewt();
        if (count(ONION) < 1) await pickOnion();
        if (count(BURNT) < 1) await getMeat();
        if (count(TAIL) < 1) await getTail();
        const missing = [
            { pattern: ONION, name: 'onion' },
            { pattern: TAIL, name: "rat's tail" },
            { pattern: NEWT, name: 'eye of newt' },
            { pattern: BURNT, name: 'burnt meat' }
        ].filter((n) => count(n.pattern) < 1);
        if (missing.length) {
            throw new Error(`ingredients still missing after gathering: ${missing.map((m) => m.name).join(', ')} @ ${pos().x},${pos().z}`);
        }
        session.noteProgress('inventory', 'all four ingredients held');
        log(`Ingredients ready: onion=${count(ONION)} tail=${count(TAIL)} newt=${count(NEWT)} burnt=${count(BURNT)}`);
    }

    /** ^hetty_started -> ^hetty_objects_given, judged on the journal. */
    async function handIn(): Promise<void> {
        for (let attempt = 1; attempt <= 3; attempt++) {
            await session.setPhase('hand_in');
            const seen = await talkHetty([]);
            log(`Hetty (hand-in ${attempt}/3): ${seen.join(' | ').slice(0, 600) || '(no dialog)'}`);
            // The grant sits after a mesbox + p_delay: settle, then read.
            await sdk.waitForTicks(5);
            if (await checkpoint('given', 'ingredients accepted, cauldron ready')) return;
            log(`hand-in attempt ${attempt}/3: journal still not at 'given'`);
        }
        throw new Error(`Hetty never took the ingredients @ ${pos().x},${pos().z}`);
    }

    /** ^hetty_objects_given -> ^hetty_complete, judged on the journal. */
    async function drinkCauldron(): Promise<void> {
        for (let attempt = 1; attempt <= 3; attempt++) {
            await session.setPhase('drink');
            intent("Drinking Hetty's cauldron");
            await closeUi();
            await goHetty();
            await sdk.scanNearbyLocs(10).catch(() => {});
            const pot = sdk.findNearbyLoc(/^cauldron$/i, { reachable: true }) ?? sdk.findNearbyLoc(/^cauldron$/i);
            if (!pot) {
                log(`No cauldron nearby @ ${pos().x},${pos().z} (attempt ${attempt}/3)`);
                await sdk.waitForTicks(4);
                continue;
            }
            // Never click a loc from across the room: close to 2 tiles first.
            if ((pot.distance ?? 99) > 2) await walkNear(pot.x, pot.z, 2);
            const r = await bot.interactLoc(pot, /drink/i);
            log(`cauldron drink${attempt > 1 ? ` (attempt ${attempt}/3)` : ''}: ok=${r.success}${r.success ? '' : ` (${r.message ?? '?'})`}`);
            await sdk.waitForTicks(4);
            await drainRest();
            // The completion write lags the mesbox: poll before verdicting.
            for (let i = 0; i < 4; i++) {
                if (await checkpoint('complete', 'drank from the cauldron')) return;
                await sdk.waitForTicks(10);
            }
        }
        throw new Error(`cauldron never completed the quest @ ${pos().x},${pos().z}`);
    }

    /** Hand the account back clean. Non-fatal by design: the quest is done. */
    async function bankOut(): Promise<void> {
        try {
            await session.setPhase('bank_out');
            await closeUi();
            if (distTo(FALADOR_EAST.x, FALADOR_EAST.z) > 8) await walkRoute(TO_BANK, 'Falador bank (out)');
            if (!(await openBankHere('bank-out'))) {
                log('WARN bank-out: could not open Falador east bank');
                return;
            }
            for (const worn of sdk.getEquipment() ?? []) {
                try {
                    await bot.unequipItem(worn);
                } catch {
                    /* worn kit is best-effort */
                }
            }
            for (let pass = 0; pass < 12; pass++) {
                const stack = sdk.getInventory().find((i) => (i.count ?? 0) > 0);
                if (!stack) break;
                await bot.depositItem(stack, -1);
            }
            await bot.closeBank();
            session.noteProgress('bank', 'banked out');
            log(`Banked out @ ${pos().x},${pos().z} bag=${sdk.getInventory().length}`);
        } catch (error) {
            log(`WARN bank-out failed: ${(error as Error).message}`);
        }
    }

    // ── run ─────────────────────────────────────────────────────────────────
    await closeUi();
    log(`Witch's Potion start @ ${pos().x},${pos().z} hp=${pos().hp}/${pos().maxHp}`);
    await leaveAltar(bot, sdk, log);
    await leaveMine(bot, sdk, log);

    // Probe BEFORE the first side effect, bounded: a fresh login has not
    // streamed its quest tab yet, and UNKNOWN is "not ready", not "start over".
    await session.setPhase('probe');
    let stage: Stage | null = null;
    for (let attempt = 0; attempt < 12 && !stage; attempt++) {
        if (attempt > 0) await sdk.waitForTicks(8);
        stage = await readStage();
    }
    if (!stage) throw new Error(`quest journal unreadable after 12 probes @ ${pos().x},${pos().z}`);
    log(`Probed stage: ${stage}`);

    // Required checkpoints = this stage onwards. A resume cannot re-demonstrate
    // an earlier stage, and requiring one fails every resume after it passed.
    const from = STAGE_ORDER.indexOf(stage);
    const requiredCheckpoints = STAGE_ORDER.slice(from);
    const identityPath = join(run.directory, 'run.json');
    const identity = JSON.parse(readFileSync(identityPath, 'utf-8')) as Record<string, unknown>;
    writeFileSync(identityPath, JSON.stringify({ ...identity, requiredCheckpoints }, null, 2));
    log(`Required checkpoints: ${requiredCheckpoints.join(', ')}`);

    await requireStage(stage, `account is at stage ${stage}`);

    if (stage === 'complete') {
        log(`Witch's Potion already complete (journal) @ ${pos().x},${pos().z}`);
        await bankOut();
        session.stop('done', "Witch's Potion already complete", { restartable: false });
        return;
    }

    if (stage === 'given') {
        await drinkCauldron();
    } else {
        if (stage === 'unstarted') await acceptQuest();
        await prepBank();
        await gatherRemaining();
        await handIn();
        await drinkCauldron();
    }

    if (!sawComplete) throw new Error(`run ended without the journal's QUEST COMPLETE line @ ${pos().x},${pos().z}`);

    await bankOut();
    const summary = summarizeRun(run.directory);
    log(`Run record check: ok=${summary.ok} missing=[${summary.missing.join(',')}] failed=[${summary.failed.join(',')}]`);
    if (!summary.ok) throw new Error(`promotion gate failed: missing ${summary.missing.join(',')}`);
    session.log('log', "Witch's Potion verified complete (journal)");
    session.noteProgress('inventory', 'quest complete (journal-verified)');
    log(`DONE Witch's Potion verified via journal at (${pos().x},${pos().z})`);
    session.stop('done', "Witch's Potion complete", { restartable: false });
});
