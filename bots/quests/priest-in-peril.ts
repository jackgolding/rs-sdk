/**
 * Priest in Peril — replayable, checkpoint-gated (quest-lab standard).
 *
 *   bun bots/quests/priest-in-peril.ts <botname>
 *
 * State machine driven by the QUEST JOURNAL, not chat lines or XP deltas:
 * bank -> King Roald (start) -> knock temple door -> kill the temple guardian
 * -> King Roald (bollocking) -> Drezel through the cell door -> golden key from
 * a Monk of Zamorak -> monument swap for the iron key -> unlock the cell ->
 * Salve water blessed by Drezel -> pour it on the vampire's coffin -> meet
 * Drezel in the mausoleum -> 50 rune essence in trips -> journal complete.
 *
 * Quest facts (all read from server/content, never from a guide):
 *   - quest varp `priestperil`, list label + journal heading both
 *     "Priest in Peril" (quest_priestperil/scripts/priestperil_journal.rs2).
 *   - stages: not_started 0, started 1, agree_to_kill_dog 2, killed_dog 3,
 *     return_to_drezel 4, find_drezel_key 5, unlocked_drezel 6,
 *     poured_blessed_water 7, meet_in_mausoleum 8, begin_bring_essence 10,
 *     end_bring_essence 60 (priestperil.constant).
 *   - completion is the journal's own "@red@QUEST COMPLETE!" entry; the reward
 *     (wolfbane + 14060 Prayer xp) is NOT a predicate — a maxed account makes
 *     any XP threshold true before the quest starts.
 *   - no quest-prerequisite gate at King Roald (king_roald.rs2 switches on the
 *     varp alone). Rune Mysteries is set complete on the fixture because the
 *     essence phase assumes essence-mine economics.
 *   - the temple's Large doors only OPEN at varp >= 4; the first visit is a
 *     Knock-at, which is how the imposter-Drezel hands out the dog task.
 *   - rune essence does NOT stack and `drezel_give_blankrunes` consumes the
 *     WHOLE bag per hand-over, so the essence phase is bank -> mausoleum trips.
 *
 * Live-verified tiles (probe 2026-10-23, qlpcellp; the offline map pack
 * disagrees about the cell door, so every anchor below came from a client scan
 * and not from map data):
 *   King Roald (3222,3476) L0, palace Large door (3213,3470). Temple Large
 *   doors (3408,3488)/(3408,3489) [Open|Knock-at]. Temple stairs: Staircase
 *   (3417,3484) L0 -> L1, Ladder (3410,3485) L1 -> L2. Cell door (3415,3489)
 *   L2 [Open|Talk-through] with Drezel at (3416,3489) behind it; Coffin
 *   (3413,3486) L2. Mausoleum: surface trapdoor (3405,3507) descends to
 *   (3405,9906); the ONLY exit is the Ladder (3405,9907) [Climb-up]; the
 *   Temple guardian roams (3404,9904)+-3; monuments 3493..3499 at the tiles in
 *   MONUMENTS; Salve well (3423,9890); Gate 3444 (3405,9895) needs varp >= 5,
 *   Gate 3445 (3431,9897) needs varp >= 8 and guards Drezel's room (3440,9895).
 */
import { appendFileSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { runScript } from '../../sdk/runner';
import { ActivitySession } from '../../sdk/activity';
import { readJournalCheckpoint } from '../../quest-lab/journal-reader';
import { appendCheckpoint, createRun, safeRunId } from '../../quest-lab/records';
import type { JournalRule } from '../../quest-lab/evidence';
import {
    ensureCoins,
    ensureItem,
    SHOPS,
    withdrawFromBank,
    type SupplyCtx
} from './quest-supplies';
import { travelTo } from './travel';

const KING_ROALD = { x: 3222, z: 3476 };
const PALACE_DOOR = { x: 3213, z: 3470 };
const TEMPLE_DOOR = { x: 3408, z: 3493 };
const TEMPLE_INTERIOR = { x: 3412, z: 3486 };
const CELL_DOOR = { x: 3415, z: 3489 }; // L2
const CELL_APPROACH = { x: 3414, z: 3489 };
const COFFIN = { x: 3413, z: 3486 }; // L2, 2 tiles long
const MAUSOLEUM_TRAP = { x: 3405, z: 3507 };
const MAUSOLEUM_LANDING = { x: 3405, z: 9906 };
const MAUSOLEUM_LADDER = { x: 3405, z: 9907 };
const MAUSOLEUM_MONUMENTS = { x: 3417, z: 9892 };
const DOG_PIT = { x: 3405, z: 9902 };
const SALVE_WELL = { x: 3423, z: 9890 };
const MAUSOLEUM_GATE = { x: 3431, z: 9897 };
const MAUSOLEUM_DREZEL = { x: 3440, z: 9895 };
/**
 * Varrock's east wall has ONE opening: the gate pair at (3318,3467)/(3319,3467).
 * `findLongPath` happily plans a line that crosses the wall anywhere else and
 * the client then refuses every hop (`reached=false moved=1.0`, 25 hops a leg).
 * Live-verified: walking TO the gate tile from either side crosses it cleanly.
 */
const VARROCK_GATE_WEST = { x: 3315, z: 3467 };
const VARROCK_GATE_EAST = { x: 3320, z: 3467 };


/**
 * The seven monuments by loc id AND tile (live scan). `monuments.rs2` maps
 * each loc key to a grave number (base1..base7 = 1..7) and seeds which grave
 * item it displays, so the golden key only trades on the monument whose
 * displayed item IS the iron key. Walking the list costs at most 7 tries; a
 * scan-by-name cannot tell them apart at all.
 */
const MONUMENTS: { id: number; x: number; z: number }[] = [
    { id: 3493, x: 3416, z: 9890 },
    { id: 3499, x: 3418, z: 9894 },
    { id: 3496, x: 3423, z: 9884 },
    { id: 3494, x: 3423, z: 9895 },
    { id: 3498, x: 3427, z: 9885 },
    { id: 3497, x: 3427, z: 9894 },
    { id: 3495, x: 3428, z: 9890 }
];

const GOLD_KEY = /^golden key$/i;
const IRON_KEY = /^iron key$/i;
const BUCKET_EMPTY = /^bucket$/i;
const BUCKET_WATER = /^bucket of water$/i; // murky (2953) and blessed (2954) share this name
const ESSENCE = /^rune essence$/i;
const FOOD = /^(lobster|swordfish|tuna|shark|trout|salmon|bread|cake|meat pie)$/i;

const BUCKET_EMPTY_ID = 1925;
const BUCKET_MURKY_ID = 2953;
const BUCKET_BLESSED_ID = 2954;
/** Essence per bank trip: the hand-over eats the WHOLE bag, so trips are sized by the pack. */
const ESSENCE_PER_TRIP = 27;

const botName = process.argv.slice(2).find((a) => !a.startsWith('-')) ?? '';
const GRIND_LOG = join(process.cwd(), 'bots', botName, 'grind.log');

// ── journal checkpoint rules ────────────────────────────────────────────────
// Read from quest_priestperil/scripts/priestperil_journal.rs2. The journal is
// CUMULATIVE: struck (@str@) history persists into later stages, so every rule
// keys on phrases that appear ONLY in that stage's current (@dbl@) line.
// The complete entry restates the active task, so `complete` requires its own
// marker ("QUEST COMPLETE") and the essence rule requires its own "I need to
// bring Drezel" line, which the complete text drops.
const JOURNAL = { label: 'Priest in Peril', title: 'Priest in Peril' };

const RULES: Record<string, JournalRule> = {
    unstarted: {
        id: 'pip:unstarted',
        kind: 'unstarted',
        all: ['I can start this quest by speaking to', 'King Roald', 'level 30 enemy']
    },
    started: {
        id: 'pip:started',
        kind: 'active',
        all: ['lives in a', 'east', 'Varrock Palace', 'investigate']
    },
    agree_to_kill_dog: {
        id: 'pip:agree_to_kill_dog',
        kind: 'active',
        all: ['has asked me to', 'kill it for him'],
        none: ['which I did easily']
    },
    killed_dog: {
        id: 'pip:killed_dog',
        kind: 'active',
        all: ['which I did easily', 'claim my']
    },
    return_to_drezel: {
        id: 'pip:return_to_drezel',
        kind: 'active',
        all: ['must return to the', 'real', 'executed']
    },
    find_drezel_key: {
        id: 'pip:find_drezel_key',
        kind: 'active',
        all: ['I need to find the', 'key', 'to his cell and free him']
    },
    unlocked_drezel: {
        id: 'pip:unlocked_drezel',
        kind: 'active',
        all: ['but I still have to do something about that']
    },
    poured_blessed_water: {
        id: 'pip:poured_blessed_water',
        kind: 'active',
        all: ['I should speak to', 'again'],
        none: ['head downstairs']
    },
    meet_in_mausoleum: {
        id: 'pip:meet_in_mausoleum',
        kind: 'active',
        all: ['I should head downstairs to the', 'monument', 'assess what']
    },
    bringing_essence: {
        id: 'pip:bringing_essence',
        kind: 'active',
        all: ['I need to bring Drezel', 'rune essences', 'purify the Salve']
    },
    complete: {
        id: 'pip:complete',
        kind: 'complete',
        all: ['QUEST COMPLETE', 'I brought Drezel fifty rune essences']
    }
};
type Stage = keyof typeof RULES;
const STAGE_ORDER: Stage[] = [
    'unstarted',
    'started',
    'agree_to_kill_dog',
    'killed_dog',
    'return_to_drezel',
    'find_drezel_key',
    'unlocked_drezel',
    'poured_blessed_water',
    'meet_in_mausoleum',
    'bringing_essence',
    'complete'
];

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
    let sawDogKill = false;
    let sawCoffinPour = false;

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

    /** Chebyshev: the metric `walkTo` itself uses for arrival (rule 17). */
    function cheb(a: { x: number; z: number }, b: { x: number; z: number }): number {
        return Math.max(Math.abs(a.x - b.x), Math.abs(a.z - b.z));
    }

    function distTo(x: number, z: number): number {
        return Math.hypot(pos().x - x, pos().z - z);
    }

    function count(pattern: RegExp): number {
        return sdk.getInventory().reduce((n, i) => n + (pattern.test(i.name) ? (i.count ?? 1) : 0), 0);
    }

    /** Count by object id: murky and blessed water share one display name. */
    function countId(id: number): number {
        return sdk.getInventory().reduce((n, i) => n + (i.id === id ? (i.count ?? 1) : 0), 0);
    }

    function underground(): boolean {
        return pos().z > 6400;
    }

    function inMausoleum(): boolean {
        const p = pos();
        return underground() && p.z >= 9850 && p.z <= 9925;
    }

    /**
     * Palace interior INCLUDING the south wall/door line (z 3469-3470): a bot
     * that ends a leg on the frame is inside the sealed pocket for routing
     * purposes even though it is "outside" the room, and must take the door
     * exit rather than a plain walk.
     */
    function inPalace(): boolean {
        const p = pos();
        return p.level === 0 && p.x >= 3208 && p.x <= 3226 && p.z >= 3469 && p.z <= 3484;
    }

    function inTemple(): boolean {
        const p = pos();
        return !underground() && p.x >= 3395 && p.x <= 3435 && p.z >= 3478 && p.z <= 3515;
    }

    function bagSpace(): number {
        return 28 - (sdk.getInventory()?.length ?? 28);
    }

    function messages(): string {
        const msgs = sdk.getState()?.gameMessages ?? [];
        const chat = sdk.getChat({ limit: 60, types: [0] }).map((m) => m.text);
        return [...msgs.map((m) => m.text), ...chat].join('\n');
    }

    // ── session + durable run record ────────────────────────────────────────
    // stallMs is sized to the longest BLIND leg: a Varrock <-> Mausoleum trek is
    // 200+ tiles and produces no effect for minutes, so the 120s default would
    // park a working run as `stuck` mid-trek.
    const session = new ActivitySession(sdk, bot, {
        name: `${botName} priest in peril`,
        grindLogPath: GRIND_LOG,
        stallMs: 600_000,
        maxRecoveryTactics: 8
    });
    await session.setPhase('start');

    /** Credit effects, not just intent: the fleet verdict bounces effect-dead bots. */
    function progress(kind: 'location' | 'dialog' | 'inventory' | 'bank' | 'xp', detail: string): void {
        session.noteProgress(kind, detail);
    }

    const MODE = process.env.QUEST_LAB_MODE === 'staging' ? 'staging' : 'development';
    const run = createRun(join(process.cwd(), 'quest-lab', 'runs'), safeRunId('priestperil', botName, new Date().toISOString()), {
        questId: 'priestperil',
        account: botName,
        mode: MODE,
        scriptHash: Bun.hash(await Bun.file(import.meta.path).text()).toString(16),
        fixtureHash: process.env.QUEST_LAB_FIXTURE_HASH ?? 'unrecorded',
        contentHash: process.env.QUEST_LAB_CONTENT_HASH ?? 'unrecorded',
        // Provisional; rewritten from the probed stage before the first side
        // effect (rule 59: a resume can never re-demonstrate earlier stages).
        requiredCheckpoints: STAGE_ORDER.slice(1)
    });
    log(`Run record: ${run.directory} (mode=${MODE})`);

    function setRequired(ids: string[]): void {
        try {
            const path = join(run.directory, 'run.json');
            const record = JSON.parse(readFileSync(path, 'utf-8'));
            record.requiredCheckpoints = ids;
            writeFileSync(path, JSON.stringify(record, null, 2));
            log(`required checkpoints: ${ids.join(', ') || '(none)'}`);
        } catch (error) {
            log(`could not rewrite run.json: ${error}`);
        }
    }

    /** The stages a run probed at `stage` can still demonstrate. */
    function requiredAfter(stage: Stage | null): string[] {
        const index = STAGE_ORDER.indexOf(stage ?? 'unstarted');
        return STAGE_ORDER.slice(Math.max(0, index + 1));
    }

    const recorded = new Set<Stage>();

    function appendPass(name: Stage, reason: string, rawLines: unknown[]): void {
        if (recorded.has(name)) return;
        recorded.add(name);
        appendCheckpoint(run.directory, {
            checkpointId: name,
            verdict: 'PASS',
            reason,
            kind: RULES[name]!.kind,
            rawLines
        });
        log(`CHECKPOINT ${name} PASS — ${reason}`);
        session.log('log', `checkpoint ${name} PASS`);
    }

    // ── journal ────────────────────────────────────────────────────────────
    let lastStage: Stage | null = null;
    let sawComplete = false;

    /**
     * One freshly-read journal per pass, newest stage first. A PASS here IS the
     * evidence that the run reached that stage, so it is written to the record
     * immediately; the loop's own work then proves the next one.
     */
    async function readStage(): Promise<Stage | null> {
        for (const name of [...STAGE_ORDER].reverse()) {
            const read = await readJournalCheckpoint(sdk, JOURNAL, RULES[name]!);
            if (read.ok && read.verdict?.verdict === 'PASS') {
                if (name !== lastStage) log(`journal stage: ${name}`);
                lastStage = name;
                if (name === 'complete') sawComplete = true;
                appendPass(name, read.reason, read.rawLines);
                return name;
            }
        }
        // A journal read can come back UNKNOWN (modal closed, stale
        // publication) even after a real stage was observed. Never hand the
        // caller a null it will treat as "start over".
        if (lastStage) {
            log(`journal read UNKNOWN; keeping last stage ${lastStage}`);
            return lastStage;
        }
        log('journal stage: UNKNOWN (no rule passed)');
        return null;
    }

    /** Explicit checkpoint with bounded retries, for a stage the loop just earned. */
    async function checkpoint(name: Stage, label: string, attempts = 3): Promise<boolean> {
        for (let attempt = 1; attempt <= attempts; attempt++) {
            const read = await readJournalCheckpoint(sdk, JOURNAL, RULES[name]!);
            const verdict = read.verdict?.verdict ?? 'UNKNOWN';
            appendCheckpoint(run.directory, {
                checkpointId: name,
                verdict,
                reason: read.reason,
                kind: RULES[name]!.kind,
                rawLines: read.rawLines
            });
            if (verdict === 'PASS') {
                recorded.add(name);
                log(`CHECKPOINT ${name} PASS (${label}) — ${read.reason}`);
                session.log('log', `checkpoint ${name} PASS: ${label}`);
                return true;
            }
            log(`CHECKPOINT ${name} ${verdict} (attempt ${attempt}/${attempts}): ${read.reason}`);
            await sdk.waitForTicks(6);
        }
        session.log('warn', `checkpoint ${name} not proven`);
        return false;
    }

    // ── ui + dialog ────────────────────────────────────────────────────────
    async function closeUi(): Promise<void> {
        for (let i = 0; i < 10; i++) {
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

    /**
     * Drive a dialog to the end.
     *
     * Continue pages get exactly one click each and NO repeat guard: the client
     * renders consecutive "Click here to continue" pages with identical text
     * and component ids, so a text-key guard stalls the drain on page two
     * (observed: Drezel's lore chain re-started forever). Choice menus DO get a
     * repeat guard, because re-clicking a menu that is still rendering lands on
     * the option index of the page that already advanced. A briefly closed
     * dialog is given ~8 ticks to publish its next page before the drain ends.
     */
    async function chat(choices: RegExp[] = [], max = 120): Promise<string[]> {
        const seen: string[] = [];
        let lastChoiceKey = '';
        let sameChoice = 0;
        for (let i = 0; i < max; i++) {
            if (!sdk.getDialog()?.isOpen) {
                let reopened = false;
                for (let t = 0; t < 8; t++) {
                    await sdk.waitForTicks(1);
                    if (sdk.getDialog()?.isOpen) {
                        reopened = true;
                        break;
                    }
                }
                if (!reopened) break;
            }
            const opts = sdk.getDialog()?.options ?? [];
            for (const o of opts) if (!seen.includes(o.text)) seen.push(o.text);
            const isContinue = opts.length <= 1 || opts.every((o) => /^click here to continue$/i.test(o.text.trim()));
            if (isContinue) {
                await sdk.sendClickDialog(opts[0]?.index ?? 0);
                await sdk.waitForTicks(1);
                continue;
            }
            const key = opts.map((o) => `${o.componentId}:${o.text}`).join('|');
            if (key === lastChoiceKey) {
                if (++sameChoice > 2) {
                    log(`dialog: choice menu did not advance [${opts.map((o) => o.text.trim()).join(' | ')}]`);
                    break;
                }
                await sdk.waitForTicks(3);
                continue;
            }
            lastChoiceKey = key;
            // Option text arrives with whatever padding the renderer used, so
            // every match runs on the TRIMMED string (an anchored /^sure\.?$/
            // against "Sure. " never fires — observed on King Roald's menu).
            let pick: { index: number; text: string } | null = null;
            for (const pattern of choices) {
                const match = opts.find((o) => pattern.test(o.text.trim()));
                if (match) {
                    pick = match;
                    break;
                }
            }
            if (!pick) {
                // Quest menus are accept/decline pairs and scripted picks can
                // never cover every flavour branch (multi3/multi4 door menus).
                // Fall back to the first non-refusal option, then to the first.
                const refusal = /^(no|nope|not interested|i don'?t|i'd rather|never|leave|abort|cancel|goodbye)\b/i;
                pick = opts.find((o) => !refusal.test(o.text.trim())) ?? opts[0] ?? null;
                if (pick) log(`dialog: pick "${pick.text.trim()}" from [${opts.map((o) => o.text.trim()).join(' | ')}]`);
            }
            if (!pick) break;
            await sdk.sendClickDialog(pick.index);
            await sdk.waitForTicks(1);
        }
        progress('dialog', `drained ${seen.length} options`);
        return seen;
    }

    // ── movement ───────────────────────────────────────────────────────────
    async function walkNear(x: number, z: number, tolerance = 4): Promise<boolean> {
        if (cheb(pos(), { x, z }) <= tolerance) return true;
        const r = await bot.walkTo(x, z, Math.min(tolerance, 3));
        const arrived = r.success || cheb(pos(), { x, z }) <= tolerance + 1;
        progress('location', `${pos().x},${pos().z}->${x},${z}`);
        return arrived;
    }

    /**
     * Open the nearest closed gate/door. A blocked PLAN is often a closed gate
     * whose tile the offline grid treated as passable (door tiles are masked
     * for planning, but a fence "gate" loc is not), so the walker stops dead
     * one tile short of the frame. Cheap, and harmless when nothing is near.
     */
    async function openNearbyDoor(radius = 12): Promise<boolean> {
        await sdk.scanNearbyLocs(radius).catch(() => {});
        const door = (sdk.getNearbyLocs() ?? [])
            .filter((l) => /gate|door|fence/i.test(l.name) && l.optionsWithIndex.some((o) => /^open$/i.test(o.text)))
            .sort((a, b) => (a.distance ?? 99) - (b.distance ?? 99))[0];
        if (!door) return false;
        await bot.interactLoc(door, /^open$/i);
        await sdk.waitForTicks(3);
        log(`travel: opened ${door.name} (${door.x},${door.z})`);
        return true;
    }

    /**
     * Long leg through the shared traveller (truncated plans + re-plan).
     *
     * `via` waypoints are used for corridors the planner crosses badly. The
     * Varrock east wall is the live case: `findLongPath` sends the walker NE
     * through the gate line at (3318-3319,3467) and the client refuses every
     * hop there ("reached=false moved=1.0", 25 hops per leg). Live-verified
     * detour: south through (3320,3480) and round, which walks in one go.
     */
    async function travel(x: number, z: number, label: string, via: { x: number; z: number }[] = []): Promise<boolean> {
        intent(`Travelling to ${label}`);
        await ensureSurface();
        if (inPalace()) await leavePalace();
        await sdk.waitForTicks(2);
        // Cross Varrock's east wall at its only opening, before planning.
        const here = pos();
        if (Math.abs(here.z - 3467) < 70) {
            if (here.x <= 3317 && x >= 3320) {
                await walkNear(VARROCK_GATE_EAST.x, VARROCK_GATE_EAST.z, 2);
                log(`  via east gate -> ${pos().x},${pos().z}`);
            } else if (here.x >= 3320 && x <= 3317) {
                await walkNear(VARROCK_GATE_WEST.x, VARROCK_GATE_WEST.z, 2);
                log(`  via west gate -> ${pos().x},${pos().z}`);
            }
        }
        let r = await travelTo(sdk, bot, { x, z }, {
            log: (m) => log(`  travel(${label}): ${m}`),
            tolerance: 6,
            maxPlans: 20
        });
        if (!r.ok) {
            // ORDER (rule 24): open the gate in the way, then re-plan from
            // where the walker actually stands — never another identical lap.
            if (await openNearbyDoor()) {
                r = await travelTo(sdk, bot, { x, z }, {
                    log: (m) => log(`  travel(${label}): ${m}`),
                    tolerance: 6,
                    maxPlans: 20
                });
            }
        }
        if (!r.ok && cheb(pos(), PALACE_DOOR) <= 12) {
            log(`travel(${label}) refused near the palace — forcing the door exit and retrying`);
            await leavePalace();
            r = await travelTo(sdk, bot, { x, z }, {
                log: (m) => log(`  travel(${label}): ${m}`),
                tolerance: 6,
                maxPlans: 20
            });
        }
        progress('location', `travel ${label}`);
        if (!r.ok) log(`travel(${label}) stopped at ${r.at.x},${r.at.z} l${r.at.level}: ${r.reason}`);
        return r.ok;
    }

    /**
     * Step off a door/gate tile before doing anything else: an open gate reads
     * Close instead of Open, and the pathfinder refuses to route FROM the tile
     * (rule 18) — every later leg then stalls 3-4 tiles short.
     */
    async function stepOffDoor(): Promise<void> {
        await sdk.scanNearbyLocs(3).catch(() => {});
        const onDoor = (sdk.getNearbyLocs() ?? []).some(
            (l) => /door|gate/i.test(l.name) && (l.distance ?? 99) < 1
        );
        if (!onDoor) return;
        const p = pos();
        for (const [dx, dz] of [[0, 1], [0, -1], [1, 0], [-1, 0], [0, 2], [0, -2]]) {
            await sdk.sendWalk(p.x + dx, p.z + dz).catch(() => {});
            await sdk.waitForTicks(3);
            if (pos().x !== p.x || pos().z !== p.z) {
                log(`stepped off door tile -> ${pos().x},${pos().z}`);
                progress('location', 'stepped off door');
                return;
            }
        }
        log(`still on a door tile @ ${pos().x},${pos().z}`);
    }

    /** Climb the mausoleum ladder; the ONLY route back to the surface. */
    async function ensureSurface(): Promise<void> {
        if (!underground()) return;
        intent('Leaving the mausoleum');
        for (let attempt = 0; attempt < 3 && underground(); attempt++) {
            await walkNear(MAUSOLEUM_LADDER.x, MAUSOLEUM_LADDER.z, 2);
            await sdk.scanNearbyLocs(8).catch(() => {});
            const ladder = (sdk.getNearbyLocs() ?? []).find(
                (l) => /ladder|trapdoor|stair/i.test(l.name) && l.optionsWithIndex.some((o) => /climb-up|up/i.test(o.text))
            );
            if (!ladder) {
                log(`mausoleum: no climb-up found @ ${pos().x},${pos().z}`);
                await sdk.waitForTicks(4);
                continue;
            }
            await bot.interactLoc(ladder, /climb-up|up/i);
            await sdk.waitForCondition(() => !underground(), 12_000).catch(() => {});
            log(`mausoleum exit -> ${pos().x},${pos().z} L${pos().level}`);
            progress('location', 'mausoleum exit');
        }
        if (underground()) log('WARNING: still underground after the ladder attempts');
    }

    /**
     * Climb to a target plane one flight at a time, skipping a stair that did
     * not change the plane (a landing's only visible stair can be the flight
     * just used). A stair is a TELEPORT: wait for the plane, not a tick count.
     */
    async function climbTo(targetLevel: number): Promise<boolean> {
        const tried = new Set<string>();
        for (let hop = 0; hop < 6 && pos().level !== targetLevel; hop++) {
            const wantUp = pos().level < targetLevel;
            const opt = wantUp ? /climb-up|up/i : /climb-down|down/i;
            await sdk.scanNearbyLocs(12).catch(() => {});
            await sdk.waitForTicks(2);
            await sdk.scanNearbyLocs(12).catch(() => {});
            const stairs = (sdk.getNearbyLocs() ?? [])
                .filter((l) => /stair|ladder/i.test(l.name) && l.optionsWithIndex.some((o) => opt.test(o.text)))
                .filter((l) => !tried.has(`${l.x},${l.z}`))
                .sort((a, b) => (a.distance ?? 99) - (b.distance ?? 99))[0];
            if (!stairs) {
                log(`climb: no usable ${wantUp ? 'up' : 'down'} flight @ ${pos().x},${pos().z} L${pos().level}`);
                break;
            }
            tried.add(`${stairs.x},${stairs.z}`);
            await walkNear(stairs.x, stairs.z, 2);
            const before = pos().level;
            await bot.interactLoc(stairs, opt);
            await sdk.waitForCondition((s) => (s.player?.level ?? before) !== before, 10_000).catch(() => {});
            await closeUi();
            log(`climb ${stairs.name} (${stairs.x},${stairs.z}) -> ${pos().x},${pos().z} L${pos().level}`);
            progress('location', `climb to L${pos().level}`);
        }
        return pos().level === targetLevel;
    }

    // ── mausoleum ──────────────────────────────────────────────────────────
    async function enterMausoleum(): Promise<void> {
        if (inMausoleum()) return;
        if (underground()) await ensureSurface();
        if (pos().level > 0) await climbTo(0);
        intent('Entering the mausoleum');
        if (cheb(pos(), MAUSOLEUM_TRAP) > 12) {
            await travel(TEMPLE_DOOR.x, TEMPLE_DOOR.z, 'the mausoleum trapdoor');
        }
        await walkNear(MAUSOLEUM_TRAP.x, MAUSOLEUM_TRAP.z, 2);
        await sdk.scanNearbyLocs(8).catch(() => {});
        let trap = (sdk.getNearbyLocs() ?? []).find((l) => /trapdoor/i.test(l.name) && l.optionsWithIndex.some((o) => /^open$/i.test(o.text)));
        if (trap) {
            await bot.interactLoc(trap, /^open$/i);
            await sdk.waitForTicks(2);
        }
        await sdk.scanNearbyLocs(8).catch(() => {});
        trap = (sdk.getNearbyLocs() ?? []).find((l) => /trapdoor/i.test(l.name) && l.optionsWithIndex.some((o) => /climb-down/i.test(o.text)));
        if (trap) {
            await bot.interactLoc(trap, /climb-down/i);
            await sdk.waitForCondition(() => underground(), 12_000).catch(() => {});
        }
        if (!underground()) {
            log(`mausoleum: trapdoor did not descend @ ${pos().x},${pos().z}`);
            await walkNear(MAUSOLEUM_LANDING.x, MAUSOLEUM_LANDING.z, 4);
        }
        log(`mausoleum -> ${pos().x},${pos().z}`);
        progress('location', 'entered mausoleum');
    }

    /** Open a metal gate (gate 3444 needs varp >= 5, gate 3445 >= 8). */
    async function openGate(at: { x: number; z: number }): Promise<boolean> {
        for (let attempt = 0; attempt < 3; attempt++) {
            await sdk.scanNearbyLocs(10).catch(() => {});
            await sdk.waitForTicks(1);
            const gate = (sdk.getNearbyLocs() ?? [])
                .filter((l) => /^gate$/i.test(l.name) && cheb({ x: l.x, z: l.z }, at) <= 2)
                .sort((a, b) => (a.distance ?? 99) - (b.distance ?? 99))[0];
            if (!gate) {
                log(`gate: none found near ${at.x},${at.z} @ ${pos().x},${pos().z}`);
                await sdk.waitForTicks(4);
                continue;
            }
            if (!gate.optionsWithIndex.some((o) => /^open$/i.test(o.text))) return true; // already open
            await walkNear(gate.x, gate.z + (pos().z >= gate.z ? 1 : -1), 2);
            const r = await bot.interactLoc(gate, /^open$/i);
            await sdk.waitForTicks(4);
            log(`gate (${gate.x},${gate.z}): open ok=${r.success} ${r.message ?? r.reason ?? ''}`);
            const after = (sdk.getNearbyLocs() ?? []).find((l) => /^gate$/i.test(l.name) && cheb({ x: l.x, z: l.z }, at) <= 2);
            if (!after || !after.optionsWithIndex.some((o) => /^open$/i.test(o.text))) return true;
        }
        return false;
    }

    /** Fill an empty bucket from the Salve well (the only murky-water source). */
    async function fillBucket(): Promise<boolean> {
        if (countId(BUCKET_MURKY_ID) + countId(BUCKET_BLESSED_ID) > 0) return true;
        if (countId(BUCKET_EMPTY_ID) === 0) return false;
        const bucket = sdk.findInventoryItem(BUCKET_EMPTY);
        if (!bucket) return false;
        intent('Filling the bucket at the Salve well');
        if (!inMausoleum()) await enterMausoleum();
        await walkNear(SALVE_WELL.x, SALVE_WELL.z, 2);
        await sdk.scanNearbyLocs(8).catch(() => {});
        const well = (sdk.getNearbyLocs() ?? []).find((l) => /^well$/i.test(l.name) && cheb({ x: l.x, z: l.z }, SALVE_WELL) <= 2);
        if (!well) {
            log(`well not found @ ${pos().x},${pos().z}`);
            return false;
        }
        await bot.useItemOnLoc(bucket, well);
        await sdk.waitForTicks(3);
        const ok = countId(BUCKET_MURKY_ID) > 0;
        log(`well fill -> empty=${countId(BUCKET_EMPTY_ID)} murky=${countId(BUCKET_MURKY_ID)}`);
        progress('inventory', `bucket murky=${ok ? 1 : 0}`);
        return ok;
    }

    // ── Varrock: King Roald ────────────────────────────────────────────────
    // The palace is a SEALED interior as far as the static graph is concerned:
    // door tiles are masked, so `walkTo` back out gives no waypoints and the
    // bot stalls 4 tiles short of the frame (observed). Both directions are
    // door interactions plus a verified step, never a plain walk.
    const PALACE_OUTSIDE = { x: 3213, z: 3466 };

    async function enterPalace(): Promise<void> {
        if (inPalace()) return;
        await walkNear(PALACE_OUTSIDE.x, PALACE_OUTSIDE.z, 2);
        if (inPalace()) return;
        for (let attempt = 0; attempt < 3 && !inPalace(); attempt++) {
            await sdk.scanNearbyLocs(6).catch(() => {});
            const door = (sdk.getNearbyLocs() ?? []).find(
                (l) => /door/i.test(l.name) && cheb({ x: l.x, z: l.z }, PALACE_DOOR) <= 2 &&
                    l.optionsWithIndex.some((o) => /^open$/i.test(o.text))
            );
            if (!door) {
                await walkNear(PALACE_OUTSIDE.x, PALACE_OUTSIDE.z, 1);
                await sdk.waitForTicks(2);
                continue;
            }
            await bot.interactLoc(door, /^open$/i);
            await sdk.waitForTicks(4);
            log(`palace door (${door.x},${door.z}) -> ${pos().x},${pos().z}`);
            if (!inPalace()) await walkNear(KING_ROALD.x, KING_ROALD.z - 2, 2);
        }
        if (!inPalace()) log(`palace: still outside @ ${pos().x},${pos().z}`);
    }

    async function leavePalace(): Promise<boolean> {
        if (!inPalace()) return true;
        intent('Leaving the palace');
        for (let attempt = 0; attempt < 4 && inPalace(); attempt++) {
            // Try the raw step first (works when the door is already open and
            // the plan crosses it); then open the door and try again. Both are
            // judged by DISPLACEMENT, never by the interaction receipt.
            await sdk.sendWalk(PALACE_OUTSIDE.x, PALACE_OUTSIDE.z).catch(() => {});
            await sdk.waitForTicks(3);
            if (!inPalace()) break;
            await walkNear(PALACE_DOOR.x, PALACE_DOOR.z + 1, 3);
            await sdk.scanNearbyLocs(6).catch(() => {});
            const door = (sdk.getNearbyLocs() ?? []).find(
                (l) => /door/i.test(l.name) && cheb({ x: l.x, z: l.z }, PALACE_DOOR) <= 3 &&
                    l.optionsWithIndex.some((o) => /^open$/i.test(o.text))
            );
            if (door) {
                await bot.interactLoc(door, /^open$/i);
                await sdk.waitForTicks(3);
            }
            for (const [ex, ez] of [[PALACE_OUTSIDE.x, PALACE_OUTSIDE.z], [3214, 3467], [3211, 3467], [3213, 3468]]) {
                const before = pos();
                await sdk.sendWalk(ex, ez).catch(() => {});
                await sdk.waitForTicks(3);
                if (pos().x !== before.x || pos().z !== before.z) {
                    log(`palace exit step -> ${pos().x},${pos().z}`);
                    if (!inPalace()) break;
                }
            }
            log(`palace exit ${attempt + 1} -> ${pos().x},${pos().z}`);
        }
        if (inPalace()) log(`palace: still inside @ ${pos().x},${pos().z}`);
        await stepOffDoor();
        return !inPalace();
    }

    async function talkKingRoald(choices: RegExp[]): Promise<void> {
        intent('Talking to King Roald');
        await ensureSurface();
        if (pos().level > 0) await climbTo(0);
        if (!inPalace()) await enterPalace();
        await walkNear(KING_ROALD.x, KING_ROALD.z, 3);
        let roald = sdk.findNearbyNpc(/king roald/i);
        for (let t = 0; !roald && t < 25; t++) {
            await sdk.waitForTicks(4);
            roald = sdk.findNearbyNpc(/king roald/i);
        }
        if (!roald) {
            log(`King Roald not found @ ${pos().x},${pos().z} inPalace=${inPalace()}`);
            return;
        }
        const talk = await bot.talkTo(roald);
        if (!talk.success) log(`talk Roald: ${talk.message}`);
        await chat(choices);
        await chat([]);
    }

    // ── temple doors ───────────────────────────────────────────────────────
    async function templeDoorAction(mode: 'knock' | 'open'): Promise<boolean> {
        await ensureSurface();
        if (pos().level > 0) await climbTo(0);
        await stepOffDoor();
        if (cheb(pos(), TEMPLE_DOOR) > 12) await travel(TEMPLE_DOOR.x, TEMPLE_DOOR.z, 'the temple door');
        await walkNear(TEMPLE_DOOR.x, TEMPLE_DOOR.z, 2);
        const option = mode === 'knock' ? /knock/i : /^open$/i;
        for (let attempt = 0; attempt < 3; attempt++) {
            await sdk.scanNearbyLocs(8).catch(() => {});
            const door = (sdk.getNearbyLocs() ?? [])
                .filter((l) => /large door/i.test(l.name) && l.optionsWithIndex.some((o) => option.test(o.text)))
                .sort((a, b) => (a.distance ?? 99) - (b.distance ?? 99))[0];
            if (!door) {
                await sdk.waitForTicks(4);
                continue;
            }
            const r = await bot.interactLoc(door, option);
            await sdk.waitForTicks(3);
            log(`temple door ${mode} (${door.x},${door.z}) ok=${r.success}`);
            return true;
        }
        log(`temple door: no ${mode} option in range @ ${pos().x},${pos().z}`);
        return false;
    }

    async function knockTempleDoor(): Promise<void> {
        intent('Knocking at the temple door');
        if (!(await templeDoorAction('knock'))) return;
        await chat([
            /roald sent me/i,
            /^sure\.?$/i,
            /helpful person/i,
            /killed that dog/i,
            /what am i supposed to be doing/i
        ]);
        await chat([]);
    }

    async function openTempleDoor(): Promise<boolean> {
        if (inTemple() && pos().level === 0) return true;
        return templeDoorAction('open');
    }

    // ── combat ─────────────────────────────────────────────────────────────
    async function eatIfNeeded(): Promise<void> {
        if (pos().hp >= pos().maxHp - 20) return;
        const food = sdk.findInventoryItem(FOOD);
        if (food) {
            await bot.eatFood(food);
            progress('inventory', 'ate food');
        }
    }

    async function waitCombat(): Promise<void> {
        for (let i = 0; i < 40 && sdk.getState()?.player?.combat?.inCombat; i++) {
            await eatIfNeeded();
            await sdk.waitForTicks(1);
        }
    }

    async function fightDog(): Promise<void> {
        if (sawDogKill) return;
        intent('Killing the temple guardian');
        await enterMausoleum();
        await walkNear(DOG_PIT.x, DOG_PIT.z, 4);
        let misses = 0;
        for (let turn = 0; turn < 60 && !pos().isDead; turn++) {
            await eatIfNeeded();
            const dog = sdk.findNearbyNpc(/temple guardian|guard dog/i);
            if (!dog) {
                await sdk.waitForTicks(3);
                if (!sdk.findNearbyNpc(/temple guardian|guard dog/i) && ++misses >= 3) {
                    sawDogKill = true;
                    return;
                }
                continue;
            }
            misses = 0;
            // size 2: attack from the footprint edge, never the anchor tile.
            const r = await bot.attack(dog, 12_000);
            if (!r.success) {
                log(`attack dog: ${r.message ?? r.reason ?? 'failed'}`);
                if (/no reason to attack|helpless dog/i.test(messages())) {
                    sawDogKill = true;
                    return;
                }
                await sdk.waitForTicks(2);
            } else {
                progress('xp', 'dog fight');
            }
            await sdk.waitForTicks(1);
        }
        await waitCombat();
    }

    /** Monks of Zamorak: the LEVEL 30 one is the only key dropper (evil_monks.rs2). */
    async function fightMonk(): Promise<void> {
        if (count(GOLD_KEY) > 0 || count(IRON_KEY) > 0) return;
        if (!inTemple()) await openTempleDoor();
        if (pos().level !== 0) {
            await walkNear(TEMPLE_INTERIOR.x, TEMPLE_INTERIOR.z, 3);
            await climbTo(0);
        }
        await walkNear(TEMPLE_INTERIOR.x, TEMPLE_INTERIOR.z, 4);
        await eatIfNeeded();
        intent('Killing a Monk of Zamorak for the golden key');
        let misses = 0;
        for (let turn = 0; turn < 120 && !pos().isDead; turn++) {
            if (count(GOLD_KEY) > 0 || count(IRON_KEY) > 0) return;
            await eatIfNeeded();
            const monks = (sdk.getNearbyNpcs() ?? []).filter((n) => /monk of zamorak/i.test(n.name));
            if (!monks.length) {
                misses++;
                await walkNear(TEMPLE_INTERIOR.x, TEMPLE_INTERIOR.z, 3);
                await sdk.waitForTicks(2);
                if (misses > 6) {
                    log('no Monk of Zamorak in the temple — giving up this attempt');
                    return;
                }
                continue;
            }
            misses = 0;
            const target = monks.sort((a, b) => (b.combatLevel ?? 0) - (a.combatLevel ?? 0) || a.distance - b.distance)[0]!;
            const r = await bot.attack(target, 12_000);
            if (!r.success) log(`attack monk(l${target.combatLevel}): ${r.message ?? r.reason ?? 'failed'}`);
            else progress('xp', 'monk fight');
            await sdk.waitForTicks(1);
        }
        await waitCombat();
        if (count(GOLD_KEY) === 0) {
            const ground = sdk.findGroundItem(GOLD_KEY);
            if (ground) {
                await bot.pickupItem(ground);
                progress('inventory', 'golden key pickup');
            }
        }
    }

    // ── keys ───────────────────────────────────────────────────────────────
    /**
     * The monument swap is a seeded lottery: exactly ONE of the seven monuments
     * displays the iron key, and only that one trades the golden key for it
     * (monuments.rs2 `switch_monument_item`). Try each in turn from a walkable
     * neighbour within two tiles; the click itself must be adjacent or it dies
     * with "Timeout using Golden key on Monument".
     */
    async function swapForIronKey(): Promise<boolean> {
        if (count(IRON_KEY) > 0) return true;
        if (count(GOLD_KEY) < 1) return false;
        intent('Swapping the golden key for the iron key');
        await enterMausoleum();
        await walkNear(MAUSOLEUM_MONUMENTS.x, MAUSOLEUM_MONUMENTS.z, 6);
        for (const mon of MONUMENTS) {
            if (count(IRON_KEY) > 0) return true;
            const key = sdk.findInventoryItem(GOLD_KEY);
            if (!key) break;
            let stood = false;
            for (const [dx, dz] of [[0, 2], [0, -2], [2, 0], [-2, 0], [1, 1], [-1, 1], [1, -1], [-1, -1], [0, 1], [1, 0], [-1, 0], [0, -1]]) {
                const tx = mon.x + dx;
                const tz = mon.z + dz;
                await bot.walkTo(tx, tz, 1).catch(() => {});
                if (cheb(pos(), mon) <= 2) {
                    stood = true;
                    break;
                }
            }
            await sdk.scanNearbyLocs(6).catch(() => {});
            const loc = (sdk.getNearbyLocs() ?? []).find((l) => l.id === mon.id && cheb({ x: l.x, z: l.z }, mon) <= 2);
            if (!loc) {
                log(`monument ${mon.id} not in scan @ ${mon.x},${mon.z} (stood=${stood})`);
                continue;
            }
            const before = count(IRON_KEY);
            const r = await bot.useItemOnLoc(key, loc);
            await sdk.waitForTicks(3);
            if (count(IRON_KEY) > before) {
                log(`swapped golden -> iron key at monument ${mon.id} (${mon.x},${mon.z})`);
                progress('inventory', 'iron key');
                return true;
            }
            log(`monument ${mon.id} (${mon.x},${mon.z}): no swap (${r.message ?? r.reason ?? 'no change'})`);
        }
        return count(IRON_KEY) > 0;
    }

    async function getKeyAndUnlock(): Promise<void> {
        if (count(IRON_KEY) < 1 && count(GOLD_KEY) < 1) await fightMonk();
        if (count(IRON_KEY) < 1) await swapForIronKey();
        // Prepare the water on the same mausoleum trip: the well is here, and
        // the bucket must be murky before Drezel can bless it.
        if (count(IRON_KEY) > 0 && !(await fillBucket())) {
            log('bucket fill failed — will retry at the water stage');
        }
        if (count(IRON_KEY) < 1) return;
        await unlockCell();
    }

    // ── cell ───────────────────────────────────────────────────────────────
    /** Walk up to the cell and open the door if it is still shut. */
    async function openCellDoor(): Promise<boolean> {
        const reachable = () => {
            const d = sdk.findNearbyNpc(/^drezel$/i);
            return !!d && d.reachable !== false;
        };
        if (reachable()) return true;
        await ensureSurface();
        if (!inTemple()) await openTempleDoor();
        if (pos().level < 2) await climbTo(2);
        for (let attempt = 0; attempt < 4; attempt++) {
            await walkNear(CELL_APPROACH.x, CELL_APPROACH.z, 2);
            await sdk.scanNearbyLocs(8).catch(() => {});
            const door = (sdk.getNearbyLocs() ?? []).find(
                (l) => /cell door/i.test(l.name) && cheb({ x: l.x, z: l.z }, CELL_DOOR) <= 1
            );
            if (!door || !door.optionsWithIndex.some((o) => /^open$/i.test(o.text))) {
                if (reachable()) return true;
                await sdk.waitForTicks(4);
                continue;
            }
            const r = await bot.interactLoc(door, /^open$/i);
            await sdk.waitForTicks(5);
            log(`cell door: open ok=${r.success} drezelReach=${reachable()}`);
            if (reachable()) return true;
        }
        return reachable();
    }

    /** Drezel in the cell: talk-through before the unlock, in person after. */
    async function talkDrezelCell(choices: RegExp[]): Promise<void> {
        intent('Talking to Drezel');
        await ensureSurface();
        if (!inTemple()) await openTempleDoor();
        if (pos().level < 2) await climbTo(2);
        await stepOffDoor();
        await walkNear(CELL_APPROACH.x, CELL_APPROACH.z, 2);
        await sdk.scanNearbyLocs(8).catch(() => {});
        const door = (sdk.getNearbyLocs() ?? []).find(
            (l) => /cell door/i.test(l.name) && cheb({ x: l.x, z: l.z }, CELL_DOOR) <= 2
        );
        const unlocked = lastStage !== null && STAGE_ORDER.indexOf(lastStage) >= STAGE_ORDER.indexOf('unlocked_drezel');
        if (unlocked) {
            if (!(await openCellDoor())) log('cell door still shut — Drezel is unreachable');
            const talk = await bot.talkTo(/^drezel$/i);
            log(`talk Drezel (in person): ${talk.success ? 'opened' : talk.message}`);
            await chat(choices);
            await chat([]);
            return;
        }
        if (door && door.optionsWithIndex.some((o) => /talk-through/i.test(o.text))) {
            const r = await bot.interactLoc(door, /talk-through/i);
            await sdk.waitForTicks(3);
            log(`talk-through cell door ok=${r.success}`);
        } else {
            log(`talk Drezel: no cell door in range @ ${pos().x},${pos().z} L${pos().level}`);
        }
        await chat(choices);
        await chat([]);
    }

    /** Use the iron key on the cell door -> varp 6 (unlocked_drezel). */
    async function unlockCell(): Promise<void> {
        if (count(IRON_KEY) < 1) return;
        intent("Unlocking Drezel's cell");
        await ensureSurface();
        if (!inTemple()) await openTempleDoor();
        if (pos().level < 2) await climbTo(2);
        for (let attempt = 0; attempt < 3 && count(IRON_KEY) > 0; attempt++) {
            await stepOffDoor();
            await walkNear(CELL_APPROACH.x, CELL_APPROACH.z, 2);
            await sdk.scanNearbyLocs(8).catch(() => {});
            const door = (sdk.getNearbyLocs() ?? []).find(
                (l) => /cell door/i.test(l.name) && cheb({ x: l.x, z: l.z }, CELL_DOOR) <= 2
            );
            const key = sdk.findInventoryItem(IRON_KEY);
            if (!door || !key) {
                log(`unlock: door=${!!door} key=${!!key} @ ${pos().x},${pos().z} L${pos().level}`);
                await sdk.waitForTicks(4);
                continue;
            }
            await bot.useItemOnLoc(key, door);
            await sdk.waitForTicks(4);
            log(`unlock attempt ${attempt + 1}: iron key x${count(IRON_KEY)}`);
            progress('inventory', `iron key=${count(IRON_KEY)}`);
        }
    }

    // ── water ──────────────────────────────────────────────────────────────
    async function getBlessedWater(): Promise<boolean> {
        if (countId(BUCKET_BLESSED_ID) > 0) return true;
        if (countId(BUCKET_MURKY_ID) === 0 && !(await fillBucket())) {
            log(`no water and no bucket (empty=${countId(BUCKET_EMPTY_ID)})`);
            return false;
        }
        intent('Getting the water blessed');
        if (!(await openCellDoor())) {
            log('bless: cell door would not open');
            return false;
        }
        await walkNear(CELL_APPROACH.x, CELL_APPROACH.z, 2);
        const drezel = sdk.findNearbyNpc(/^drezel$/i);
        if (!drezel) {
            log(`bless: Drezel not visible @ ${pos().x},${pos().z} L${pos().level}`);
            return false;
        }
        // opnpcu (use murky on Drezel) is the direct route; his opnpc1 branch
        // also blesses it, so fall back to a talk if the use does not land.
        const bucket = sdk.findInventoryItem(BUCKET_WATER);
        if (bucket) await bot.useItemOnNpc(bucket, drezel);
        await sdk.waitForTicks(3);
        if (countId(BUCKET_BLESSED_ID) === 0) {
            const talk = await bot.talkTo(drezel);
            log(`bless talk: ${talk.success ? 'opened' : talk.message}`);
            await chat([]);
            await chat([]);
        }
        const ok = countId(BUCKET_BLESSED_ID) > 0;
        log(`bless -> murky=${countId(BUCKET_MURKY_ID)} blessed=${countId(BUCKET_BLESSED_ID)}`);
        if (ok) progress('inventory', 'blessed water');
        return ok;
    }

    /** Pour the blessed water on the vampire's coffin -> varp 7. */
    async function pourOnCoffin(): Promise<boolean> {
        if (sawCoffinPour) return true;
        intent('Pouring the blessed water on the coffin');
        await ensureSurface();
        if (!inTemple()) await openTempleDoor();
        if (pos().level < 2) await climbTo(2);
        await walkNear(COFFIN.x, COFFIN.z + 2, 2);
        await sdk.scanNearbyLocs(10).catch(() => {});
        const coffin = (sdk.getNearbyLocs() ?? []).find((l) => /^coffin$/i.test(l.name) && cheb({ x: l.x, z: l.z }, COFFIN) <= 2);
        const water = sdk.findInventoryItem(BUCKET_WATER);
        if (!coffin) {
            log(`coffin not found @ ${pos().x},${pos().z} L${pos().level}`);
            return false;
        }
        if (!water || countId(BUCKET_MURKY_ID) > 0) {
            log(`coffin: wrong water (murky=${countId(BUCKET_MURKY_ID)} blessed=${countId(BUCKET_BLESSED_ID)})`);
            return false;
        }
        await bot.useItemOnLoc(water, coffin);
        await sdk.waitForTicks(4);
        const poured = countId(BUCKET_BLESSED_ID) === 0 && countId(BUCKET_EMPTY_ID) > 0;
        log(`coffin pour -> blessed=${countId(BUCKET_BLESSED_ID)} empty=${countId(BUCKET_EMPTY_ID)}`);
        if (poured) {
            sawCoffinPour = true;
            progress('inventory', 'poured blessed water');
        }
        return poured;
    }

    async function waterPhase(): Promise<void> {
        if (!(await getBlessedWater())) return;
        await pourOnCoffin();
    }

    // ── mausoleum Drezel + essence ─────────────────────────────────────────
    async function findMausoleumDrezel(): Promise<boolean> {
        if (!(await openGate(MAUSOLEUM_GATE))) log('mausoleum gate did not open');
        let drezel = sdk.findNearbyNpc(/^drezel$/i);
        for (let t = 0; !drezel && t < 20; t++) {
            await walkNear(MAUSOLEUM_DREZEL.x, MAUSOLEUM_DREZEL.z, 3);
            await sdk.waitForTicks(3);
            drezel = sdk.findNearbyNpc(/^drezel$/i);
        }
        return !!drezel;
    }

    async function talkMausoleumDrezel(): Promise<void> {
        intent('Meeting Drezel by the monuments');
        await enterMausoleum();
        if (!(await findMausoleumDrezel())) {
            log(`Drezel not found in the mausoleum @ ${pos().x},${pos().z}`);
            return;
        }
        const talk = await bot.talkTo(/^drezel$/i);
        log(`talk mausoleum Drezel: ${talk.success ? 'opened' : talk.message}`);
        await chat([]);
        await chat([]);
    }

    /**
     * Rune essence is UNSTACKABLE: a single `withdrawItem(item, 25)` moves ONE.
     * Withdraw one at a time and verify the bag actually grew (rule 28).
     */
    async function withdrawEssence(wanted: number): Promise<number> {
        const before = count(ESSENCE);
        for (let i = 0; i < wanted; i++) {
            if (count(ESSENCE) - before >= wanted) break;
            if (!sdk.getState()?.bank?.isOpen) {
                if (!(await bot.openBank()).success) {
                    await sdk.waitForTicks(2);
                    if (!(await bot.openBank()).success) {
                        log('essence: bank will not open');
                        break;
                    }
                }
                await sdk.waitForTicks(2);
            }
            const item = sdk.findBankItem(ESSENCE);
            if (!item) {
                log(`essence: not in bank (bag=${count(ESSENCE)})`);
                break;
            }
            const r = await bot.withdrawItem(item, 1);
            await sdk.waitForTicks(1);
            if (!r.success) {
                log(`essence withdraw ${i + 1}/${wanted}: ${r.message ?? r.reason ?? 'failed'}`);
                break;
            }
        }
        await bot.closeBank().catch(() => {});
        const got = count(ESSENCE) - before;
        if (got > 0) progress('bank', `withdrew ${got} essence`);
        return got;
    }

    async function essenceTrips(): Promise<void> {
        for (let trip = 1; trip <= 5; trip++) {
            if ((await readStage()) === 'complete') return;
            if (count(ESSENCE) === 0) {
                if (bagSpace() < 1) {
                    log(`essence: no bag space (${sdk.getInventory().length} slots used)`);
                    return;
                }
                if (!(await travel(SHOPS.VARROCK_EAST_BANK.x, SHOPS.VARROCK_EAST_BANK.z, 'the bank'))) {
                    log('essence: could not reach the bank');
                    return;
                }
                const want = Math.min(ESSENCE_PER_TRIP, bagSpace());
                const got = await withdrawEssence(want);
                if (got === 0) {
                    log('essence: bank holds no rune essence — stopping');
                    return;
                }
                log(`essence trip ${trip}: withdrew ${got}`);
            }
            await enterMausoleum();
            if (!(await findMausoleumDrezel())) {
                log(`essence: Drezel not found @ ${pos().x},${pos().z}`);
                return;
            }
            intent('Giving rune essence to Drezel');
            // ONE use-on-npc consumes the WHOLE bag (drezel_give_blankrunes
            // loops inv_del per varp point); the loop only covers a refusal.
            for (let guard = 0; count(ESSENCE) > 0 && guard < 6; guard++) {
                const before = count(ESSENCE);
                const r = await bot.useItemOnNpc(sdk.findInventoryItem(ESSENCE)!, /^drezel$/i);
                await sdk.waitForTicks(3);
                if (count(ESSENCE) < before) {
                    progress('inventory', `handed over ${before - count(ESSENCE)} essence`);
                    continue;
                }
                log(`essence: Drezel did not take it (${r.message ?? r.reason ?? 'no change'})`);
                const talk = await bot.talkTo(/^drezel$/i);
                if (!talk.success) log(`essence talk: ${talk.message}`);
                await chat([]);
                await sdk.waitForTicks(2);
                if (count(ESSENCE) >= before) break;
            }
            log(`essence trip ${trip}: bag now ${count(ESSENCE)}`);
            // Drezel's finishing lines are still on screen after the hand-over,
            // and an OPEN dialog blanks the journal read (rule 71): drain it
            // before asking the journal whether the quest is done.
            await chat();
            await sdk.waitForTicks(4);
            if (await checkpoint('complete', 'journal reports QUEST COMPLETE', 2)) return;
            if ((await readStage()) === 'complete') return;
        }
    }

    // ── bank ───────────────────────────────────────────────────────────────
    const supplyCtx = (): SupplyCtx => ({ bot, sdk, log, intent, walkNear, closeUi });

    async function startBank(): Promise<void> {
        intent('Banking everything at Varrock East');
        await closeUi();
        await ensureSurface();
        if (pos().level > 0) await climbTo(0);
        if (distTo(SHOPS.VARROCK_EAST_BANK.x, SHOPS.VARROCK_EAST_BANK.z) > 40) {
            await travel(SHOPS.VARROCK_EAST_BANK.x, SHOPS.VARROCK_EAST_BANK.z, 'Varrock East bank');
        }
        await walkNear(SHOPS.VARROCK_EAST_BANK.x, SHOPS.VARROCK_EAST_BANK.z, 3);
        let opened = await bot.openBank();
        if (!opened.success) {
            await sdk.waitForTicks(2);
            opened = await bot.openBank();
        }
        if (!opened.success) {
            log(`start bank: could not open bank (${opened.message})`);
            return;
        }
        let moved = 0;
        for (const item of [...sdk.getInventory()]) {
            const r = await bot.depositItem(item, -1);
            if (r.success) moved++;
        }
        await sdk.waitForTicks(2);
        await bot.closeBank();
        log(`start bank: deposited ${moved} stacks, ${sdk.getInventory().length} slots left`);
        progress('bank', 'start bank');
    }

    async function ensureSupplies(): Promise<void> {
        const ctx = supplyCtx();
        await ensureCoins(ctx, 50);
        await withdrawFromBank(ctx, FOOD, 1, SHOPS.VARROCK_EAST_BANK);
        await ensureItem(ctx, BUCKET_EMPTY, 1, {
            label: 'bucket',
            shop: SHOPS.VARROCK_GEN,
            coinsNeeded: 5
        });
        progress('bank', 'supplies');
    }

    /**
     * Hand the account back clean. Runs AFTER the terminal checkpoint, so every
     * failure here is a WARN and exit 0 — a throw would discard a finished run.
     * Bounded by the attempt's remaining time: the gate's budget matters more
     * than a tidy pack.
     */
    async function bankOut(deadline: number): Promise<void> {
        if (Date.now() > deadline) {
            log('bank-out skipped: run is at its time budget');
            return;
        }
        try {
            await closeUi();
            await ensureSurface();
            if (pos().level > 0) await climbTo(0);
            await travel(SHOPS.VARROCK_EAST_BANK.x, SHOPS.VARROCK_EAST_BANK.z, 'the end bank');
            await walkNear(SHOPS.VARROCK_EAST_BANK.x, SHOPS.VARROCK_EAST_BANK.z, 3);
            const opened = await bot.openBank();
            if (!opened.success) {
                log(`WARN bank-out: bank would not open (${opened.message})`);
                return;
            }
            for (const worn of sdk.getEquipment() ?? []) {
                await bot.unequipItem(worn).catch(() => {});
            }
            let moved = 0;
            for (let i = 0; i < 32 && sdk.getInventory().length > 0; i++) {
                const item = sdk.getInventory().find((it) => (it.count ?? 0) > 0);
                if (!item) break;
                const r = await bot.depositItem(item, -1);
                if (r.success) moved++;
                await sdk.waitForTicks(1);
            }
            await bot.closeBank();
            log(`bank-out: deposited ${moved} stacks, ${sdk.getInventory().length} slots left`);
        } catch (error) {
            log(`WARN bank-out failed: ${error}`);
        }
    }

    // ── main ───────────────────────────────────────────────────────────────
    await bot.skipTutorial();
    await closeUi();

    // Stage probe BEFORE any side effect: banking first would report a stock
    // shortfall on an already-finished account instead of "already complete".
    // The quest-tab side interface streams in late after login, so poll bounded
    // rather than treating the first UNKNOWN as a real answer.
    let startStage = await readStage();
    for (let t = 0; startStage === null && t < 12; t++) {
        await sdk.waitForTicks(8);
        startStage = await readStage();
    }
    log(`Priest in Peril start stage=${startStage ?? 'UNKNOWN'} @ ${pos().x},${pos().z} L${pos().level}`);
    setRequired(requiredAfter(startStage));

    if (startStage === 'complete') {
        log('Priest in Peril already complete — nothing to do');
        await bankOut(Date.now() + 8 * 60_000);
        return;
    }

    await startBank();
    await ensureSupplies();

    const startedAt = Date.now();
    const until = startedAt + 32 * 60_000;
    let lastLoggedStage: Stage | null = null;
    let stalledPasses = 0;

    while (Date.now() < until) {
        if (pos().isDead) {
            log('died — waiting for respawn');
            await sdk.waitForCondition((s) => !s.player.isDead, 45_000).catch(() => {});
            progress('location', 'respawned');
            continue;
        }

        const stage = await readStage();
        if (stage === 'complete' || sawComplete) break;

        if (stage === lastLoggedStage) {
            stalledPasses++;
            if (stalledPasses % 6 === 0) {
                log(`stage ${stage} still current after ${stalledPasses} passes @ ${pos().x},${pos().z} L${pos().level} ` +
                    `(gold=${count(GOLD_KEY)} iron=${count(IRON_KEY)} ess=${count(ESSENCE)} blessed=${countId(BUCKET_BLESSED_ID)})`);
            }
        } else {
            lastLoggedStage = stage;
            stalledPasses = 0;
        }

        switch (stage) {
            case 'started':
                await knockTempleDoor();
                break;
            case 'agree_to_kill_dog':
                await fightDog();
                break;
            case 'killed_dog':
                await talkKingRoald([
                    /looking for a quest/i,
                    /^sure\.?$/i,
                    /spoke to the guys at the temple/i,
                    /okay.*going/i
                ]);
                break;
            case 'return_to_drezel':
                await talkDrezelCell([/tell me anyway/i, /^yes\.?$/i, /yes, of course/i]);
                break;
            case 'find_drezel_key':
                await getKeyAndUnlock();
                break;
            case 'unlocked_drezel':
                await waterPhase();
                break;
            case 'poured_blessed_water':
                await talkDrezelCell([/poured the blessed water/i, /^yes\.?$/i]);
                break;
            case 'meet_in_mausoleum':
                await talkMausoleumDrezel();
                break;
            case 'bringing_essence':
                await essenceTrips();
                break;
            case 'unstarted':
            case null:
            default:
                await talkKingRoald([/looking for a quest/i, /^sure\.?$/i, /^yes\.?$/i]);
                break;
        }
        log(`inv gold=${count(GOLD_KEY)} iron=${count(IRON_KEY)} ess=${count(ESSENCE)} ` +
            `murky=${countId(BUCKET_MURKY_ID)} blessed=${countId(BUCKET_BLESSED_ID)} @ ${pos().x},${pos().z} L${pos().level}`);
        await sdk.waitForTicks(2);
    }

    if (!(await checkpoint('complete', 'journal reports QUEST COMPLETE'))) {
        await sdk.waitForTicks(6);
        if (!(await checkpoint('complete', 'journal reports QUEST COMPLETE'))) {
            throw new Error(`Priest in Peril unfinished @ ${pos().x},${pos().z} stage=${lastStage}`);
        }
    }
    log(`QUEST COMPLETE Priest in Peril (journal verified, stage=${lastStage})`);
    await session.stop('done', 'Priest in Peril complete');
    await bankOut(startedAt + 35 * 60_000);
});
