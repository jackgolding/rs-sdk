/**
 * Vampire Slayer — reusable.
 *
 *   bun bots/quests/vampire-slayer.ts {botname}
 *
 * Morgan → garlic → Dr Harlow + beer → stake/hammer → Draynor Manor crypt → Count Draynor.
 * Avoids trapping via the one-way front door on exit (east wing route).
 */
import { appendFileSync } from 'fs';
import { join } from 'path';
import { runScript } from '../../sdk/runner';
import { readJournalCheckpoint } from '../../quest-lab/journal-reader';
import type { JournalRule } from '../../quest-lab/evidence';
import {
    ensureCoins,
    ensureItem,
    SHOPS,
    type SupplyCtx,
    withdrawFromBank
} from './quest-supplies';

const MORGAN = { x: 3098, z: 3268 };
const GARLIC_CUPBOARD = { x: 3096, z: 3268 };
const HARLOW = { x: 3277, z: 3492 };
const MANOR_DOOR = { x: 3108, z: 3355 };
const MANOR_STAIRS = { x: 3115, z: 3357 };
const CRYPT = { x: 3077, z: 9771 };
const ESCAPE_DOOR_1 = { x: 3119, z: 3356 };
const ESCAPE_DOOR_2 = { x: 3123, z: 3360 };
const JOLLY_BOAR = { x: 3277, z: 3490 };

const GARLIC = /^garlic$/i;
const BEER = /^beer$/i;
const STAKE = /^stake$/i;
const HAMMER = /^hammer$/i;
const FOOD = /^(lobster|swordfish|tuna|shark|trout|salmon|bread|cake|wine|meat pie)$/i;

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
            isDead: p?.isDead ?? false,
            inCombat: p?.combat?.inCombat ?? false
        };
    }

    function distTo(x: number, z: number): number {
        return Math.hypot(pos().x - x, pos().z - z);
    }

    function count(pattern: RegExp): number {
        return sdk.getInventory().reduce((n, i) => n + (pattern.test(i.name) ? (i.count ?? 1) : 0), 0);
    }

    function attackXp(): number {
        return sdk.getSkill('Attack')?.experience ?? 0;
    }

    function inCrypt(): boolean {
        return pos().z > 6400;
    }

    function inManor(): boolean {
        const p = pos();
        return p.x >= 3088 && p.x <= 3130 && p.z >= 3348 && p.z <= 3380 && p.z < 6400;
    }

    /**
     * Vampire Slayer stage and completion, read from the QUEST JOURNAL.
     *
     * This used to be `attackXp() >= xpBefore + 4000` plus a chat regex. Attack
     * XP is this quest's REWARD, so ANY Attack XP — combat on the way to the
     * manor, or during the fight itself — read as completion, and a restart was
     * indistinguishable from a finish.
     *
     * Rules come from the quest's own handler
     * (quest_vampire/scripts/vampire_journal.rs2), each on a sentence unique to
     * its stage.
     */
    const VAMP_JOURNAL = { label: 'Vampire Slayer', title: 'Vampire Slayer' };
    const VAMP_STAGES: Record<string, JournalRule> = {
        not_started: {
            id: 'vamp:not_started',
            kind: 'unstarted',
            all: ['I can start this quest by speaking to Morgan who is in Draynor Village'],
        },
        started: {
            id: 'vamp:started',
            kind: 'active',
            all: ['I need to speak to Dr Harlow who can normally be found in the Jolly Boar Inn'],
        },
        // The spoke_to_harlow branch rewrites itself by inventory (stake /
        // garlic / hammer), so key it on the line present in EVERY variant.
        spoke_to_harlow: {
            id: 'vamp:spoke_to_harlow',
            kind: 'active',
            all: ['I have spoken to Dr Harlow. He seemed terribly drunk'],
        },
        complete: { id: 'vamp:complete', kind: 'complete', all: ['QUEST COMPLETE'] },
    };

    /** The first stage rule that passes is the account's real stage. */
    async function readStage(): Promise<string> {
        for (const name of ['complete', 'spoke_to_harlow', 'started', 'not_started']) {
            const read = await readJournalCheckpoint(sdk, VAMP_JOURNAL, VAMP_STAGES[name]!);
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
        const read = await readJournalCheckpoint(sdk, VAMP_JOURNAL, VAMP_STAGES.complete!);
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

    async function chat(choices: RegExp[] = [], max = 32): Promise<string[]> {
        const seen: string[] = [];
        for (let i = 0; i < max; i++) {
            if (!sdk.getDialog()?.isOpen) {
                // The dialog does not always open within ONE tick of talkTo. The
                // old one-tick check then broke out with an empty option list,
                // which reads exactly like "this NPC has nothing to say" and
                // silently skipped the choice that starts the quest (observed as
                // `Morgan: ` with no options, and as a quest that stayed
                // unstarted while the run cycled). Poll instead of sampling once.
                let opened = false;
                for (let t = 0; t < 12 && !opened; t++) {
                    await sdk.waitForTicks(2);
                    opened = sdk.getDialog()?.isOpen ?? false;
                }
                if (!opened) break;
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
        if (pos().hp >= pos().maxHp - 4) return;
        const food = sdk.findInventoryItem(FOOD);
        if (food) await bot.eatFood(food);
    }

    async function startMorgan(): Promise<void> {
        intent('Talking to Morgan');
        await walkNear(MORGAN.x, MORGAN.z, 3);
        // Morgan stands in Draynor Village on the GROUND floor. This used to
        // climb to level 1 first, which is a house interior (teleport-recon at
        // (3098,3268): level 0 shows Morgan 1-2 tiles away, level 1 shows only a
        // Woman upstairs among beds and a cupboard). Climbing made the find fail
        // and the function return silently, so the quest never started and the
        // loop just re-fetched supplies forever. The cupboard upstairs belongs
        // to the GARLIC step, not to this one.
        if (pos().level > 0) await climbTo(0);
// Settle-and-retry: climbing rebuilds the client scene and `nearbyNpcs` is
// EMPTY for the new level until it lands, so a single scan reads the NPC as
// missing while the bot is standing next to it.
        let morgan = sdk.findNearbyNpc(/^morgan$/i);
        for (let t = 0; !morgan && t < 40; t++) {
            await sdk.waitForTicks(4);
            morgan = sdk.findNearbyNpc(/^morgan$/i);
        }
        if (!morgan) {
            log(`Morgan missing @ ${pos().x},${pos().z} floor=${pos().level} (after settling)`);
            return;
        }
        await bot.talkTo(morgan);
        const seen = await chat([/up for an adventure/i, /tips on killing/i]);
        log(`Morgan: ${seen.join(' | ')}`);
        await chat([/up for an adventure/i]);
    }

    async function getGarlic(): Promise<void> {
        if (count(GARLIC) > 0) return;
        intent('Searching Morgan\'s cupboard for garlic');
        await walkNear(MORGAN.x, MORGAN.z, 3);
        if (pos().level < 1) await climbTo(1);
        await walkNear(GARLIC_CUPBOARD.x, GARLIC_CUPBOARD.z, 2);
        await sdk.scanNearbyLocs(6).catch(() => {});
        const cupboard = (sdk.getNearbyLocs() ?? []).find((l) => /cupboard/i.test(l.name));
        if (!cupboard) {
            log('No cupboard for garlic');
            return;
        }
        await bot.interactLoc(cupboard, /search|open/i);
        await sdk.waitForTicks(2);
        if (pos().level > 0) await climbTo(0);
    }

    const supplyCtx = (): SupplyCtx => ({ bot, sdk, log, intent, walkNear, closeUi });

    async function ensureSupplies(): Promise<void> {
        const ctx = supplyCtx();
        await ensureCoins(ctx, 20);
        // Food is a convenience, NOT a requirement: the quest only asks that you
        // can kill a level-34 Vampire, and a maxed account needs nothing to
        // survive him. Take whatever the bank already holds and do not detour to
        // buy more — Wydin's stocks neither wine ("item not found in shop") nor
        // bread ("out of stock") in this revision, so the old purchase walked to
        // Port Sarim and came back empty every time.
        await withdrawFromBank(ctx, FOOD, 8, SHOPS.DRAYNOR_BANK);
        await ensureItem(ctx, HAMMER, 1, {
            label: 'hammer',
            shop: SHOPS.VARROCK_GEN,
            coinsNeeded: 5
        });
        // Beer exists only to trade Dr Harlow for the stake. Once the stake is
        // already held, fetching another one is a ~300-tile round trip to the
        // Jolly Boar Inn for nothing — observed failing outright ("No matching
        // option on Bartender" / "Shop not open") while the quest completed
        // anyway, which is the proof it was never needed.
        if (count(STAKE) < 1) {
            await ensureItem(ctx, BEER, 1, {
                label: 'beer',
                shop: { x: JOLLY_BOAR.x, z: JOLLY_BOAR.z, npc: /bartender|barmaid/i },
                coinsNeeded: 5
            });
        }
    }

    async function harlowStake(): Promise<void> {
        if (count(STAKE) > 0 && count(HAMMER) > 0) return;
        await ensureSupplies();
        intent('Getting stake from Dr Harlow');
        await walkNear(HARLOW.x, HARLOW.z, 3);
        // Settle-and-retry, not a one-shot: the nearby set lags a plane change
        // or a fresh arrival, and the old code returned silently on a miss — so
        // a scan that simply ran early looked exactly like "Harlow is not here"
        // and the main loop re-ran the whole quest-start leg forever.
        let harlow = sdk.findNearbyNpc(/harlow/i);
        for (let attempt = 0; attempt < 2 && !harlow; attempt++) {
            if (attempt > 0) await walkNear(JOLLY_BOAR.x, JOLLY_BOAR.z, 2);
            for (let t = 0; !harlow && t < 12; t++) {
                harlow = sdk.findNearbyNpc(/harlow/i);
                if (!harlow) await sdk.waitForTicks(4);
            }
        }
        if (!harlow) {
            log(`Dr Harlow missing @ ${pos().x},${pos().z} floor=${pos().level} (after settling)`);
            return;
        }
        await bot.talkTo(harlow);
        await chat([/morgan needs your help/i]);
        await bot.talkTo(harlow);
        await chat([/here you go/i, /ok mate/i]);
        await chat();
    }

    async function enterCrypt(): Promise<void> {
        if (inCrypt()) return;
        intent('Entering Draynor Manor crypt');
        if (!inManor()) {
            await walkNear(MANOR_DOOR.x, MANOR_DOOR.z, 2);
            const door = sdk.findNearbyLoc(/door/i);
            if (door) await bot.openDoor(door);
            await walkNear(MANOR_STAIRS.x, MANOR_STAIRS.z, 2);
        }
        await sdk.scanNearbyLocs(10).catch(() => {});
        const down = (sdk.getNearbyLocs() ?? []).find(
            (l) => /stair|ladder/i.test(l.name) && l.optionsWithIndex.some((o) => /down/i.test(o.text))
        );
        if (down) {
            await bot.interactLoc(down, /down/i);
            await sdk.waitForCondition(() => inCrypt(), 12_000).catch(() => {});
        }
        if (!inCrypt()) await walkNear(CRYPT.x, CRYPT.z, 4);
    }

    async function fightVampire(): Promise<void> {
        await enterCrypt();
        await eatIfNeeded();
        intent('Opening coffin / fighting Count Draynor');
        await sdk.scanNearbyLocs(12).catch(() => {});
        const coffin = sdk.findNearbyLoc(/coffin/i);
        if (coffin) {
            await bot.interactLoc(coffin, /open|search/i);
            await sdk.waitForTicks(4);
        }
        let turns = 0;
        while (turns < 80 && !pos().isDead) {
            await eatIfNeeded();
            const count = sdk.findNearbyNpc(/count draynor|draynor/i);
            if (!count) {
                await sdk.waitForTicks(2);
                if (!sdk.findNearbyNpc(/count draynor|draynor/i)) break;
            } else {
                await bot.attack(count, 8_000);
            }
            turns++;
        }
    }

    async function escapeManorIfNeeded(): Promise<void> {
        if (!inManor() && !inCrypt()) return;
        if (inCrypt()) {
            await climbTo(0);
            await sdk.waitForCondition(() => !inCrypt(), 10_000).catch(() => {});
        }
        if (!inManor()) return;
        intent('Escaping manor via east wing');
        for (const door of [ESCAPE_DOOR_1, ESCAPE_DOOR_2]) {
            await walkNear(door.x, door.z - 1, 1);
            await sdk.sendWalk(door.x, door.z - 1, true);
            await sdk.waitForTicks(2);
            const loc = (sdk.getNearbyLocs() ?? []).find((l) => l.x === door.x && l.z === door.z);
            if (loc) {
                const open = loc.optionsWithIndex.find((o) => /open/i.test(o.text));
                if (open) await sdk.sendInteractLoc(loc.x, loc.z, loc.id, open.opIndex);
                await sdk.waitForTicks(2);
                await sdk.sendWalk(door.x, door.z + 1, true);
                await sdk.waitForTicks(2);
            }
        }
    }

    const xpBefore = attackXp();
    await bot.skipTutorial();
    await closeUi();
    // Ask the journal BEFORE shopping: an account that already finished must not
    // be sent to buy beer and stakes first.
    const startStage = await readStage();
    log(`Vampire Slayer journal stage at start: ${startStage}`);
    if (startStage === 'unknown') {
        throw new Error('could not determine the Vampire Slayer stage from the journal');
    }
    if (startStage === 'complete') {
        log('Vampire Slayer is already complete — nothing to do');
        return;
    }
    await ensureSupplies();
    log(`Vampire Slayer start Attack xp=${xpBefore} @ ${pos().x},${pos().z}`);

    const until = Date.now() + 15 * 60_000;
    while (Date.now() < until && !(await questDone())) {
        await closeUi();
        if (pos().hp < pos().maxHp - 4 && count(FOOD) < 2) await ensureSupplies();
        if (pos().isDead) {
            await sdk.waitForCondition((s) => !s.player.isDead, 45_000).catch(() => {});
            continue;
        }

        if (count(STAKE) > 0 && count(GARLIC) > 0) {
            await fightVampire();
            await escapeManorIfNeeded();
            if (await questDone()) break;
            continue;
        }

        if (count(STAKE) < 1) {
            await startMorgan();
            await getGarlic();
            await harlowStake();
            continue;
        }

        if (count(GARLIC) < 1) await getGarlic();

        log(`garlic=${count(GARLIC)} stake=${count(STAKE)} hammer=${count(HAMMER)} beer=${count(BEER)} @ ${pos().x},${pos().z}`);
        await sdk.waitForTicks(2);
    }

    if (!(await questDone())) throw new Error(`Vampire Slayer unfinished @ ${pos().x},${pos().z} xp=${attackXp()}`);
    log(`QUEST COMPLETE Vampire Slayer (+${attackXp() - xpBefore} Attack xp)`);
});
