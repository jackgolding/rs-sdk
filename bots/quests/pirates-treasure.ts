/**
 * Pirate's Treasure — reusable.
 *
 *   bun bots/quests/pirates-treasure.ts {botname}
 *
 * Frank → Karamja rum → smuggle via banana crate → Wydin → chest → Falador dig.
 */
import { appendFileSync } from 'fs';
import { join } from 'path';
import { runScript } from '../../sdk/runner';
import { readJournalCheckpoint } from '../../quest-lab/journal-reader';
import type { JournalRule } from '../../quest-lab/evidence';
import { appendCheckpoint, createRun, safeRunId, summarizeRun } from '../../quest-lab/records';
import {
    buyAtShop,
    ensureCoins,
    ensureItem,
    pickupGround,
    SHOPS,
    type SupplyCtx
} from './quest-supplies';

const FRANK = { x: 3053, z: 3250 };
const SAILOR = { x: 3028, z: 3216 };
const ZAMBO = { x: 2925, z: 3143 };
const LUTHAS = { x: 2939, z: 3154 };
const PLANTATION = { x: 2935, z: 3150 };
const CUSTOMS = { x: 2956, z: 3143 };
const WYDIN = { x: 3014, z: 3204 };
const BLUE_MOON = { x: 3222, z: 3398 };
const BLUE_MOON_STAIRS = { x: 3222, z: 3396 };
const DIG = { x: 2999, z: 3383 };

const RUM = /karamja rum/i;
const KEY = /chest key/i;
const MESSAGE = /pirate message/i;
const APRON = /^white apron$/i;
const BANANA = /^banana$/i;
const SPADE = /^spade$/i;
const COINS = /^coins$/i;

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
        return { x: p?.worldX ?? 0, z: p?.worldZ ?? 0, level: p?.level ?? 0 };
    }

    function distTo(x: number, z: number): number {
        return Math.hypot(pos().x - x, pos().z - z);
    }

    function count(pattern: RegExp): number {
        return sdk.getInventory().reduce((n, i) => n + (pattern.test(i.name) ? (i.count ?? 1) : 0), 0);
    }

    function coinCount(): number {
        return sdk.findInventoryItem(COINS)?.count ?? 0;
    }

    function onKaramja(): boolean {
        const p = pos();
        return p.x >= 2880 && p.x <= 2980 && p.z >= 3120 && p.z <= 3200;
    }

    /**
     * Pirate's Treasure stage and completion, read from the QUEST JOURNAL.
     *
     * This used to be `coinCount() >= coinsBefore + 400` plus a
     * `/completed the.*pirate/i` game-message regex. Coin gain is this quest's
     * REWARD, so ANY coin pickup — selling loot, a random drop — read as
     * completion, and the chat regex fired on any similarly-worded message.
     *
     * Rules come from the quest's own handler
     * (quest_hunt/scripts/hunt_journal.rs2), each on a sentence unique to its
     * stage. Journal label verified from the quest list
     * (questlist.if: `text=Pirate's Treasure`).
     */
    const HUNT_JOURNAL = { label: "Pirate's Treasure", title: "Pirate's Treasure" };
    const HUNT_STAGES: Record<string, JournalRule> = {
        not_started: {
            id: 'hunt:not_started',
            kind: 'unstarted',
            all: ['I can start this quest by speaking to Redbeard Frank'],
        },
        fetch_rum: {
            id: 'hunt:fetch_rum',
            kind: 'active',
            all: ['He has agreed to tell me the location of some treasure for some Karamja Rum'],
        },
        received_key: {
            id: 'hunt:received_key',
            kind: 'active',
            all: ['the treasure is hidden in the chest in the upstairs room of the Blue Moon Inn'],
        },
        read_note: {
            id: 'hunt:read_note',
            kind: 'active',
            all: ['Visit the city of the White Knights'],
        },
        complete: { id: 'hunt:complete', kind: 'complete', all: ['QUEST COMPLETE'] },
    };

    // Durable run record: checkpoint evidence is written verbatim as the run
    // proceeds, so an audit does not depend on stdout or sampled telemetry.
    const MODE = process.env.QUEST_LAB_MODE === 'staging' ? 'staging' : 'development';
    const run = createRun(join(process.cwd(), 'quest-lab', 'runs'), safeRunId('hunt', botName, new Date().toISOString()), {
        questId: 'hunt',
        account: botName,
        mode: MODE,
        scriptHash: Bun.hash(await Bun.file(import.meta.path).text()).toString(16),
        fixtureHash: process.env.QUEST_LAB_FIXTURE_HASH ?? 'unrecorded',
        contentHash: process.env.QUEST_LAB_CONTENT_HASH ?? 'unrecorded',
        requiredCheckpoints: ['not_started', 'fetch_rum', 'received_key', 'read_note', 'complete'],
    });
    log(`Run record: ${run.directory} (mode=${MODE})`);

    function record(checkpointId: string, verdict: 'PASS' | 'FAIL' | 'UNKNOWN', reason: string, kind?: string): void {
        try {
            appendCheckpoint(run.directory, { checkpointId, verdict, reason, kind });
        } catch (err) {
            log(`record ${checkpointId} failed: ${err instanceof Error ? err.message : String(err)}`);
        }
    }

    /** The first stage rule that passes is the account's real stage. */
    async function readStage(): Promise<string> {
        for (const name of ['complete', 'read_note', 'received_key', 'fetch_rum', 'not_started']) {
            const read = await readJournalCheckpoint(sdk, HUNT_JOURNAL, HUNT_STAGES[name]!);
            const verdict = read.verdict?.verdict ?? 'UNKNOWN';
            log(`  stage probe ${name}: ${verdict} (${read.reason})`);
            record(name, verdict, read.reason, HUNT_STAGES[name]!.kind);
            if (verdict === 'PASS') return name;
        }
        return 'unknown';
    }

    let journalComplete = false;
    let lastJournalCheck = 0;
    /** Journal-backed completion, throttled: opening the journal is not free. */
    async function questDone(): Promise<boolean> {
        if (Date.now() - lastJournalCheck < 5_000) return journalComplete;
        lastJournalCheck = Date.now();
        const read = await readJournalCheckpoint(sdk, HUNT_JOURNAL, HUNT_STAGES.complete!);
        journalComplete = read.verdict?.verdict === 'PASS';
        if (journalComplete) record('complete', 'PASS', read.reason, 'complete');
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

    async function chat(choices: RegExp[] = [], max = 36): Promise<string[]> {
        const seen: string[] = [];
        for (let i = 0; i < max; i++) {
            const dialog = sdk.getDialog();
            if (!dialog?.isOpen) {
                await sdk.waitForTicks(1);
                if (!sdk.getDialog()?.isOpen) break;
            }
            const opts = sdk.getDialog()?.options ?? [];
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

    async function climbTo(targetLevel: number): Promise<boolean> {
        for (let i = 0; i < 8 && pos().level !== targetLevel; i++) {
            const wantUp = pos().level < targetLevel;
            const opt = wantUp ? /climb-up|climb.up|go-up|go.up/i : /climb-down|climb.down|go-down|go.down/i;
            await sdk.scanNearbyLocs(8).catch(() => {});
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

    const supplyCtx = (): SupplyCtx => ({ bot, sdk, log, intent, walkNear, closeUi });

    async function ensureSupplies(): Promise<void> {
        const ctx = supplyCtx();
        await ensureCoins(ctx, 100);
        await ensureItem(ctx, APRON, 1, {
            label: 'white apron',
            shop: SHOPS.THESSALIA,
            coinsNeeded: 15
        });
        if (count(SPADE) < 1) {
            if (onKaramja()) {
                await ensureItem(ctx, SPADE, 1, {
                    label: 'spade',
                    shop: SHOPS.JIMINUA,
                    coinsNeeded: 15
                });
            }
            if (count(SPADE) < 1) {
                await pickupGround(ctx, SPADE);
            }
            if (count(SPADE) < 1) {
                await ensureItem(ctx, SPADE, 1, {
                    label: 'spade',
                    shop: SHOPS.FALADOR_GEN,
                    coinsNeeded: 15
                });
            }
            if (count(SPADE) < 1) {
                await ensureItem(ctx, SPADE, 1, {
                    label: 'spade',
                    shop: SHOPS.VARROCK_GEN,
                    coinsNeeded: 15
                });
            }
        }
    }

    async function ensureTools(): Promise<void> {
        await ensureSupplies();
    }

    async function startFrank(): Promise<void> {
        intent('Talking to Redbeard Frank');
        await walkNear(FRANK.x, FRANK.z, 3);
        const frank = sdk.findNearbyNpc(/redbeard|frank/i);
        if (!frank) return;
        await bot.talkTo(frank);
        const seen = await chat([/search of treasure/i, /in search of treasure/i]);
        log(`Frank: ${seen.join(' | ')}`);
        await chat([/search of treasure/i]);
    }

    async function sailToKaramja(): Promise<void> {
        if (onKaramja()) return;
        intent('Sailing to Karamja');
        await walkNear(SAILOR.x, SAILOR.z, 3);
        const sailor = sdk.findNearbyNpc(/tobias|sailor/i);
        if (!sailor) return;
        await bot.talkTo(sailor);
        await chat([/yes please/i]);
        await sdk.waitForCondition(() => onKaramja(), 20_000).catch(() => {});
    }

    async function sailToSarim(): Promise<void> {
        if (!onKaramja()) return;
        intent('Returning to Port Sarim');
        await walkNear(CUSTOMS.x, CUSTOMS.z, 3);
        const officer = sdk.findNearbyNpc(/customs/i);
        if (!officer) return;
        await bot.talkTo(officer);
        await chat([/journey on this ship/i, /can i journey/i, /^ok\.?$/i]);
        await sdk.waitForCondition(() => !onKaramja(), 20_000).catch(() => {});
    }

    async function buyRum(): Promise<void> {
        if (count(RUM) > 0) return;
        await ensureCoins(supplyCtx(), 40);
        intent('Buying Karamja rum from Zambo');
        await walkNear(ZAMBO.x, ZAMBO.z, 3);
        const shop = await bot.openShop(/zambo/i);
        if (!shop.success) {
            log(`Zambo shop: ${shop.message}`);
            return;
        }
        await bot.buyFromShop(RUM, 1);
        await bot.closeShop();
    }

    async function employLuthas(): Promise<void> {
        intent('Getting plantation work from Luthas');
        await walkNear(LUTHAS.x, LUTHAS.z, 3);
        const luthas = sdk.findNearbyNpc(/luthas/i);
        if (!luthas) return;
        await bot.talkTo(luthas);
        await chat([/offer me employment/i, /employment on your plantation/i]);
    }

    async function pickBananas(need: number): Promise<void> {
        while (count(BANANA) < need) {
            intent(`Picking bananas (${count(BANANA)}/${need})`);
            await walkNear(PLANTATION.x, PLANTATION.z, 6);
            await sdk.scanNearbyLocs(12).catch(() => {});
            const tree = sdk.findNearbyLoc(/banana/i);
            if (!tree) break;
            await bot.interactLoc(tree, /pick/i);
            await sdk.waitForTicks(2);
        }
    }

    async function smuggleRum(): Promise<void> {
        if (count(RUM) < 1) return;
        intent('Hiding rum in banana crate');
        await walkNear(PLANTATION.x, PLANTATION.z, 4);
        await sdk.scanNearbyLocs(10).catch(() => {});
        const crate = sdk.findNearbyLoc(/crate/i);
        const rum = sdk.findInventoryItem(RUM);
        if (crate && rum) {
            await bot.useItemOnLoc(rum, crate);
            await sdk.waitForTicks(2);
        }
        await pickBananas(10);
        const luthas = sdk.findNearbyNpc(/luthas/i);
        if (luthas) {
            await bot.talkTo(luthas);
            await chat([/filled a crate/i, /have you completed/i]);
        }
    }

    async function getRumFromWydin(): Promise<void> {
        if (count(RUM) > 0) return;
        intent('Retrieving smuggled rum from Wydin\'s store');
        const apron = sdk.findInventoryItem(APRON);
        if (apron) await bot.equipItem(apron);
        await walkNear(WYDIN.x, WYDIN.z, 2);
        await sdk.scanNearbyLocs(8).catch(() => {});
        const crate = sdk.findNearbyLoc(/crate/i);
        if (crate) {
            await bot.interactLoc(crate, /search/i);
            await sdk.waitForTicks(4);
        }
    }

    async function handRumToFrank(): Promise<void> {
        if (count(RUM) < 1) return;
        intent('Giving rum to Redbeard Frank');
        await walkNear(FRANK.x, FRANK.z, 3);
        const frank = sdk.findNearbyNpc(/redbeard|frank/i);
        if (!frank) return;
        const rum = sdk.findInventoryItem(RUM);
        if (rum) await bot.useItemOnNpc(rum, frank);
        else await bot.talkTo(frank);
        await chat();
    }

    async function openChest(): Promise<void> {
        if (count(MESSAGE) > 0) return;
        intent('Opening chest at Blue Moon Inn');
        await walkNear(BLUE_MOON_STAIRS.x, BLUE_MOON_STAIRS.z, 2);
        if (pos().level < 1) await climbTo(1);
        await sdk.scanNearbyLocs(8).catch(() => {});
        const chest = sdk.findNearbyLoc(/chest/i);
        const key = sdk.findInventoryItem(KEY);
        if (chest && key) {
            await bot.useItemOnLoc(key, chest);
            await sdk.waitForTicks(4);
        }
        const msg = sdk.findInventoryItem(MESSAGE);
        if (msg) await sdk.sendUseItem(msg.slot);
    }

    async function digTreasure(): Promise<void> {
        if (count(SPADE) < 1) await ensureTools();
        intent('Digging in Falador Park');
        await walkNear(DIG.x, DIG.z, 1);
        const spade = sdk.findInventoryItem(SPADE);
        if (spade) {
            await sdk.sendUseItem(spade.slot);
            await sdk.waitForTicks(6);
        }
    }

    const coinsBefore = coinCount();
    await bot.skipTutorial();
    await closeUi();
    // Ask the journal BEFORE shopping: an account that already finished must
    // not be sent to buy aprons and spades first.
    const startStage = await readStage();
    log(`Pirate's Treasure journal stage at start: ${startStage}`);
    if (startStage === 'unknown') {
        throw new Error('could not determine the Pirate\'s Treasure stage from the journal');
    }
    if (startStage === 'complete') {
        log('Pirate\'s Treasure is already complete — nothing to do');
        return;
    }
    await ensureTools();
    log(`Pirate's Treasure start coins=${coinsBefore} @ ${pos().x},${pos().z}`);

    const until = Date.now() + 25 * 60_000;
    while (Date.now() < until && !(await questDone())) {
        await closeUi();
        if (count(APRON) < 1 || count(SPADE) < 1) await ensureSupplies();

        if (count(KEY) > 0 && count(MESSAGE) === 0) {
            await openChest();
            if (count(MESSAGE) > 0) await digTreasure();
            continue;
        }

        if (count(MESSAGE) > 0 || /dig a hole|little bag of treasure/i.test((sdk.getState()?.gameMessages ?? []).map((m) => m.text).join(' '))) {
            await digTreasure();
            if (await questDone()) break;
            continue;
        }

        if (count(KEY) > 0) {
            await openChest();
            continue;
        }

        if (count(RUM) > 0 && !onKaramja()) {
            await handRumToFrank();
            continue;
        }

        if (!onKaramja() && count(RUM) === 0 && count(KEY) === 0) {
            const smuggled = /shipped|wydin|crate/i.test((sdk.getState()?.gameMessages ?? []).map((m) => m.text).join(' '));
            if (smuggled) {
                await getRumFromWydin();
                continue;
            }
        }

        if (onKaramja()) {
            if (count(RUM) < 1) await buyRum();
            else {
                await ensureSupplies();
                await employLuthas();
                await smuggleRum();
                await sailToSarim();
            }
            continue;
        }

        if (count(RUM) === 0 && count(KEY) === 0) {
            await startFrank();
            await sailToKaramja();
            continue;
        }

        log(`rum=${count(RUM)} key=${count(KEY)} msg=${count(MESSAGE)} karamja=${onKaramja()} @ ${pos().x},${pos().z}`);
        await sdk.waitForTicks(2);
    }

    if (!(await questDone())) throw new Error(`Pirate's Treasure unfinished @ ${pos().x},${pos().z}`);
    const summary = summarizeRun(run.directory);
    log(`Run checkpoints ok=${summary.ok} missing=[${summary.missing.join(',')}] failed=[${summary.failed.join(',')}]`);
    log(`QUEST COMPLETE Pirate's Treasure (+${coinCount() - coinsBefore} gp)`);
});
