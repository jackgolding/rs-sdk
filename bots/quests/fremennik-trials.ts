/**
 * The Fremennik Trials — dialog-driven council-vote quest.
 *
 *   bun bots/quests/fremennik-trials.ts {botname}
 *
 * Talk to Brundt in the Rellekka longhall, then earn 7 of 7 council votes
 * (every trial is required — there are exactly seven) and return to Brundt:
 *
 *   1. Peer the Seer — solve the door riddle (MIND/TREE/LIFE/FIRE/TIME/WIND,
 *      read from the riddle mesbox) then work the water puzzle inside with
 *      EMPTY hands (bank everything first): bookcase red herring -> cook it
 *      for the red goop -> paint the wooden disk -> both red disks on the
 *      mural -> vase lid; jug+bucket from the chest/cupboard; jug_3 on empty
 *      bucket -> bucket_3; refill jug; jug_3 on bucket_3 -> bucket_5 + jug_1;
 *      drain bucket_5; jug_1 on empty bucket -> bucket_1; refill jug; jug_3
 *      on bucket_1 -> bucket_4; bucket_4 on the scales chest -> vase; fill
 *      vase at tap; lid on; freeze the sealed vase on the frozen table ->
 *      key in ice; melt it on the range -> Seers' key; unlock the far door.
 *   2. Olaf the Bard — pet rock from Askeladden, show it to Lalli, stew
 *      (rock+cabbage+potato+onion in Lalli's cauldron) -> golden fleece,
 *      spin it (Seers wheel) -> golden wool, chop the swaying tree (WC 40),
 *      knife the branch (Craft 40) -> unstrung lyre, string it (Fletch 25),
 *      offer a RAW SHARK (not herring — small fish are refused) on the
 *      strange altar -> enchanted lyre, play it on the longhall stage.
 *   3. Sigli the Huntsman — take the uncharged Hunters' talisman, operate it
 *      and follow its directions to the Draugen (60 HP), kill it, trade the
 *      charged talisman back for the vote.
 *   4. Manni the Reveller — accept the drinking contest, pick up a keg, give
 *      a beer to the council workman (bridge south of town) for the strange
 *      object, buy the low-alcohol keg from the poison salesman in Seers
 *      (250 coins, needs the contest accepted), light the cracker, plant it
 *      in the longhall pipe, swap the keg, drink Manni under the table.
 *   5. Swensen the Navigator — climb down and walk his maze to the exit
 *      ladder (explored blind: visited-grid DFS with collision-aware hops;
 *      wrong portals only fire on click so they are never touched).
 *   6. Sigmund the Merchant — the full trade chain (needs 5000 coins for
 *      Askeladden): sailor -> Olaf -> Yrsa -> Brundt -> Sigli -> Skulgrimen
 *      -> fisherman -> Swensen -> Peer -> Thorvald -> Manni -> Thora ->
 *      Askeladden (note) -> back up the chain -> flower -> Sigmund's vote.
 *   7. Thorvald the Warrior — MUST come after the Sigmund chain (his
 *      bodyguard-contract trade is only offered while his trial is still
 *      open). Bank/destroy everything the arena gate bans (weapons, armour,
 *      runes, ammo, logs...), climb down unarmed and fight Koschei: killing
 *      him passes, and so does dying — the honour-death also grants the vote.
 *
 * Assignment-level gates (no SDK accessor exists, verified up front and
 * fail-fast): WC 40, Craft 40, Fletch 25, combat able to handle ~60-70s.
 * Bank must be pre-stocked: axe, knife, tinderbox, ~6000 coins, 2 raw shark,
 * cabbage+potato+onion, 2 beer, 8+ cooked food. Completion is gated ONLY on
 * the server quest-complete message (waitForQuestComplete), never on steps.
 */
import { ActivitySession, BotSDK, deriveGatewayUrl } from '../../sdk/index';
import { installGracefulShutdown } from '../../sdk/runner';
import { ensureBankStart, parkAtBank, nearestBank } from './safe-stops';
import { BotActions } from '../../sdk/actions';
import { initPathfinding, findLongPath } from '../../sdk/pathfinding';
import { CATHERBY_BANK, SEERS_BANK, type Tile } from './tiles';
import { walkSendHops, closeUi } from './movement';
import {
    type QuestContext,
    type QuestStage,
    questLoop,
    waitForQuestComplete,
    visibleText,
    countItems,
    withdrawNeeds,
    requireSkills,
    type ItemNeed,
} from './quest-lib';
import { ensureSupplied, buyFromShops, SHOP_SOURCES } from './supply';
import { existsSync, readFileSync } from 'fs';
import { dirname, join } from 'path';

import { QUEST_JOURNAL_TAB, readJournalCheckpoint, readSideInterface } from '../../quest-lab/journal-reader';
import { appendCheckpoint, createRun, safeRunId, summarizeRun } from '../../quest-lab/records';
import type { JournalRule } from '../../quest-lab/evidence';
import { isTileWalkable } from '../../sdk/pathfinding';

const argv = process.argv.slice(2);
const botArg = argv.find((a) => !a.startsWith('-'));

function loadBotEnv(): void {
    const envPath = botArg
        ? join(process.cwd(), 'bots', botArg, 'bot.env')
        : join(dirname(import.meta.path), 'bot.env');
    if (!existsSync(envPath)) {
        throw new Error(`bot.env not found at ${envPath}. Usage: bun bots/quests/fremennik-trials.ts {botname}`);
    }
    for (const line of readFileSync(envPath, 'utf-8').split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eq = trimmed.indexOf('=');
        if (eq > 0) process.env[trimmed.slice(0, eq)] = trimmed.slice(eq + 1);
    }
}

loadBotEnv();

const username = process.env.BOT_USERNAME!;
const password = process.env.PASSWORD!;
const server = process.env.SERVER;
const GRIND_LOG = join(process.cwd(), 'bots', username, 'grind.log');

initPathfinding();

const sdk = new BotSDK({
    botUsername: username,
    password,
    gatewayUrl: deriveGatewayUrl(server),
    autoLaunchBrowser: false,
    browserLaunchTimeout: 90_000,
    readyTimeout: 45_000,
    connectTimeout: 60_000,
    showChat: false,
});

await sdk.connect();
const bot = new BotActions(sdk);
const session = new ActivitySession(sdk, bot, {
    name: 'fremennik-trials',
    grindLogPath: GRIND_LOG,
    stallMs: 360_000,
    maxRecoveryTactics: 8,
});

installGracefulShutdown({ graceMs: 660_000 });

// ---------------------------------------------------------------------------
// Progress: the quest journal, read fresh — the only client-visible record of
// quest state (the viking varp never reaches the client). The previous
// chat-line/prog.json detector never matched Brundt's start lines, so the run
// replayed the start leg forever while the journal already read 'started';
// every gate below is therefore journal-backed and logged as evidence.
// ---------------------------------------------------------------------------

type TrialId = 'peer' | 'olaf' | 'sigli' | 'reveller' | 'swensen' | 'sigmund' | 'thorvald';
const TRIALS: TrialId[] = ['peer', 'olaf', 'sigli', 'reveller', 'swensen', 'sigmund', 'thorvald'];

const JOURNAL = { label: 'The Fremennik Trials', title: 'The Fremennik Trials' };

/** Patterns quoted from server/content .../quest_viking/scripts/viking_journal.rs2 */
const TRIAL_LINE: Record<TrialId, RegExp> = {
    peer: /I now have the Seer'?s vote/i,
    olaf: /I now have the Bard'?s vote/i,
    sigli: /I now have the Hunter'?s vote/i,
    reveller: /I now have the Reveller'?s vote/i,
    swensen: /I now have the Navigator'?s vote/i,
    sigmund: /I now have the Merchant'?s vote/i,
    thorvald: /I now have the Warrior'?s vote/i,
};

/** Per-trial in-progress lines (supporting evidence, used for diagnostics). */
const TRIAL_ACTIVE: Record<TrialId, RegExp> = {
    peer: /The Seer will vote for me if I can pass his trial/i,
    olaf: /The Bard will vote for me if I can pass his trial/i,
    sigli: /The Hunter will vote for me if I can pass his trial/i,
    reveller: /The Reveller will vote for me if I can pass his trial/i,
    swensen: /The Navigator will vote for me if I can pass his trial/i,
    sigmund: /The Merchant will vote for me if I can pass his trial/i,
    thorvald: /The Warrior will vote for me if I can pass his trial/i,
};

const RULES = {
    /**
     * Prohibition-only rule: constrained (so it cannot trivially pass) but it
     * asserts nothing, so it returns the journal as published whatever stage
     * the quest is at. `kind: 'active'` makes a completed quest answer with
     * "quest already complete", which the reader below turns into `complete`.
     */
    any: { id: 'any', kind: 'active', all: [], none: ['@@@ never @@@'] },
    unstarted: {
        id: 'unstarted',
        kind: 'unstarted',
        all: ['I can start this quest by speaking to Chieftain Brundt'],
    },
    started: { id: 'started', kind: 'active', all: ['I spoke to Brundt the Fremennik chieftan'] },
    complete: {
        id: 'complete',
        kind: 'complete',
        all: ['I managed to persuade seven of the twelve'],
    },
    peer: { id: 'peer', kind: 'active', all: ["I now have the Seer's vote at the council"] },
    olaf: { id: 'olaf', kind: 'active', all: ["I now have the Bard's vote at the council"] },
    sigli: { id: 'sigli', kind: 'active', all: ["I now have the Hunter's vote at the council"] },
    reveller: { id: 'reveller', kind: 'active', all: ["I now have the Reveller's vote at the council"] },
    swensen: { id: 'swensen', kind: 'active', all: ["I now have the Navigator's vote at the council"] },
    sigmund: { id: 'sigmund', kind: 'active', all: ["I now have the Merchant's vote at the council"] },
    thorvald: { id: 'thorvald', kind: 'active', all: ["I now have the Warrior's vote at the council"] },
} satisfies Record<string, JournalRule>;

interface Progress {
    unstarted: boolean;
    started: boolean;
    complete: boolean;
    votes: Record<TrialId, boolean>;
    /** Fresh journal text (raw + prose) from the last successful read. */
    text: string;
    /** When the last successful read landed. */
    at: number;
}

function blankVotes(): Record<TrialId, boolean> {
    return { peer: false, olaf: false, sigli: false, reveller: false, swensen: false, sigmund: false, thorvald: false };
}

let progress: Progress = { unstarted: false, started: false, complete: false, votes: blankVotes(), text: '', at: 0 };

/**
 * The reveller's keg swap leaves no visible trace (the low-alcohol keg is
 * consumed and a bit is set server-side), so remember it for the run instead of
 * re-buying a keg every pass and re-doing the pipe each time.
 */
let revellerSwapped = false;

/**
 * The quest-tab side interface streams in late after login, so park on the
 * quest tab until it is actually published (bounded: a broken tab must fail
 * loudly, not hang the run). Early UNKNOWNs are not-ready, not evidence.
 */
async function awaitQuestTab(why: string): Promise<void> {
    if (readSideInterface(sdk)) return;
    await sdk.sendSetTab(QUEST_JOURNAL_TAB).catch(() => undefined);
    try {
        await sdk.waitForCondition((s) => !!s.sideInterface && s.sideInterface.interfaceId !== -1, 20_000);
    } catch {
        log(`quest tab side interface never published for ${why} — journal reads will report UNKNOWN`);
    }
}

/**
 * One journal read decides everything: not started / active (plus which trials
 * carry their vote line) / complete. An unreadable journal keeps the previous
 * belief rather than regressing to "not started" — UNKNOWN is never progress.
 */
async function refreshProgress(why: string): Promise<Progress> {
    if (!sdk.isConnected()) {
        log(`journal skipped for ${why}: controller down`);
        return progress;
    }
    await awaitQuestTab(why);
    const read = await readJournalCheckpoint(sdk, JOURNAL, RULES.any, { timeoutMs: 8_000 });
    const verdict = read.verdict?.verdict ?? 'UNKNOWN';
    const text = [...read.rawLines.map((l) => l.rawText), ...read.rawLines.map((l) => l.text)].join('\n');
    if (verdict === 'PASS' || /quest already complete/i.test(read.reason)) {
        const next: Progress = {
            unstarted: false,
            started: false,
            complete: /quest already complete/i.test(read.reason),
            votes: blankVotes(),
            text,
            at: Date.now(),
        };
        next.started = /I spoke to Brundt the Fremennik chieftan/i.test(text) || next.complete;
        next.unstarted = !next.started && /I can start this quest by speaking to Chieftain Brundt/i.test(text);
        for (const t of TRIALS) next.votes[t] = TRIAL_LINE[t].test(text);
        progress = next;
        log(
            `journal: ${next.complete ? 'COMPLETE' : next.started ? 'active' : next.unstarted ? 'not started' : 'UNKNOWN stage'} ` +
                `votes=[${TRIALS.filter((t) => next.votes[t]).join(',')}]`
        );
        return next;
    }
    log(`journal UNREADABLE for ${why}: ${read.reason} (keeping previous stage)`);
    return progress;
}

function voteCount(): number {
    return TRIALS.filter((t) => progress.votes[t]).length;
}

/** Bounded per-stage attempt counter: replaced the old prog.json bump(). */
const attempts: Record<string, number> = {};
function noteAttempt(key: string): number {
    attempts[key] = (attempts[key] ?? 0) + 1;
    return attempts[key]!;
}

/** Re-scan the cached publication (no extra journal open) for new vote lines. */
function rescanVotes(): void {
    if (!progress.text) return;
    let changed = false;
    for (const t of TRIALS) {
        if (!progress.votes[t] && TRIAL_LINE[t].test(progress.text)) {
            progress.votes[t] = true;
            changed = true;
        }
    }
    if (changed) log(`vote line appeared in the open journal: ${voteCount()}/7 [${TRIALS.filter((t) => progress.votes[t]).join(',')}]`);
}

/** Journal checkpoint gate: PASS only on fresh, source-backed text. */
async function checkpoint(name: keyof typeof RULES, label: string): Promise<boolean> {
    await awaitQuestTab(name);
    const read = await readJournalCheckpoint(sdk, JOURNAL, RULES[name], { timeoutMs: 8_000 });
    const verdict = read.verdict?.verdict ?? 'UNKNOWN';
    try {
        appendCheckpoint(run.directory, {
            checkpointId: name,
            verdict,
            reason: read.reason,
            kind: RULES[name].kind,
            rawLines: read.rawLines,
        });
    } catch { /* record is best-effort; the verdict still gates the run */ }
    if (verdict !== 'PASS') {
        log(`CHECKPOINT ${name} ${verdict}: ${read.reason}`);
        session.log('warn', `checkpoint ${name} ${verdict}`);
        return false;
    }
    log(`CHECKPOINT ${name} PASS — ${label}`);
    session.log('log', `checkpoint ${name} PASS: ${label}`);
    // Mark the state this PASS just proved. Without it the stage's own detect()
    // stays true (progress is only refreshed at the TOP of a stage), so the stage
    // re-runs its whole body after passing — Sigli re-hunted, the merchant chain
    // re-walked, and the session eventually exhausted its recovery and parked as
    // 'stuck' with the vote already earned.
    if (name === 'complete') {
        progress.complete = true;
    } else if (name === 'started') {
        progress.started = true;
    } else if ((TRIALS as readonly string[]).includes(name)) {
        progress.votes[name as TrialId] = true;
    }
    // and fold in the freshly read journal lines so cached-text scans see them
    const fresh = [...read.rawLines.map((l) => l.rawText), ...read.rawLines.map((l) => l.text)].join('\n');
    if (fresh) progress.text = fresh;
    rescanVotes();
    return true;
}

/**
 * Legacy alias kept for the stage bodies: vote state now comes from the quest
 * journal, never from chat lines (a chat line is transient and the client's
 * message ring drops it — the old regex missed Brundt's opening entirely).
 */
function scanVotes(ctx: QuestContext): boolean {
    void ctx;
    rescanVotes();
    return false;
}

function log(msg: string): void {
    session.log('log', msg);
    // Also publish the line as an INTENT. ActivitySession flags a stall after
    // stallMs (120s) with no intent/progress, and this script speaks only in log
    // lines — so long legs (bank trips, the 12-link merchant chain) tripped the
    // stall clock, recovery exhausted, and the run parked as `stuck` with the
    // vote already earned. Every log line now refreshes that clock.
    void session.showIntent(msg).catch(() => undefined);
}

function pos() {
    const p = sdk.getState()?.player;
    return { x: p?.worldX ?? 0, z: p?.worldZ ?? 0, level: p?.level ?? 0, hp: p?.hp ?? 10, maxHp: p?.maxHp ?? 10, isDead: p?.isDead ?? false };
}

function here(): string {
    const p = pos();
    return `${p.x},${p.z},${p.level}`;
}

function count(re: RegExp): number {
    return countItems(sdk, re);
}

async function waitUntil(pred: () => boolean, ms: number): Promise<boolean> {
    try {
        await sdk.waitForCondition(() => pred(), ms);
        return true;
    } catch {
        return pred();
    }
}

async function ticks(n: number): Promise<void> {
    await sdk.waitForTicks(n).catch(() => undefined);
}

// ---------------------------------------------------------------------------
// Items (display names verified against quest_viking/configs/viking.obj).
// ---------------------------------------------------------------------------

const ANY_AXE = /^(bronze|iron|steel|black|mithril|adamant|rune) axe$/i;
const KNIFE = /^knife$/i;
const TINDERBOX = /^tinderbox$/i;
const COINS = /^coins$/i;
const PROMISSARY = /^promissory note/i;
/** Any of the merchant-chain goods (used to know a trade landed). */
function hasChainGood(): boolean {
    return (sdk.getInventory() ?? []).some((i) =>
        /promissory note|legendary cocktail|champion|token|sturdy boots|ballad|love song|rare flower|weather forecast|fishing spots|bowstring|unique fish|hunting|map/i.test(
            i.name ?? ''
        )
    );
}
const RAW_SHARK = /^raw shark$/i;
const CABBAGE = /^cabbage$/i;
const POTATO = /^potato$/i;
const ONION = /^onion$/i;
const BEER = /^beer$/i;
const FOOD = /^(shark|swordfish|lobster|tuna|salmon|trout|bass|bread|cake|wine|meat pie|plain pizza|pineapple pizza)$/i;
const PET_ROCK = /^pet rock$/i;
const BRANCH = /^branch$/i;
const UNSTRUNG_LYRE = /^unstrung lyre$/i;
const STRUNG_LYRE = /^lyre$/i;
const ENCHANTED_LYRE = /^enchanted lyre$/i;
const GOLDEN_FLEECE = /^golden fleece$/i;
const GOLDEN_WOOL = /^golden wool$/i;
const TALISMAN = /^hunters' talisman$/i;
const BEER_KEG = /^keg of beer$/i;
const LOW_KEG = /^low alcohol keg$/i;
const FIRECRACKER = /^strange object$/i;
const LIT_CRACKER = /^lit strange object$/i;
// Sigmund chain goods.
const FLOWER = /^exotic flower$/i;
const SONG = /^fremennik ballad$/i;
const BOOTS = /^sturdy boots$/i;
const HUNT_MAP = /^hunters map$/i;
const BOWSTRING = /^custom bow string$/i;
const RARE_FISH = /^unusual fish$/i;
const FISH_MAP = /^sea fishing map$/i;
const FORECAST = /^weather forecast$/i;
const TOKEN = /^champions token$/i;
const COCKTAIL = /^legendary cocktail$/i;
const TAX_NOTE = /^fiscal statement$/i;
const ASKE_NOTE = /^promissory note$/i;
const CONTRACT = /^warriors' contract$/i;
// Peer puzzle goods.
const RED_HERRING = /^red herring$/i;
const GOOP = /^sticky red goop$/i;
const WOOD_DISK = /^wooden disk$/i;
const RED_DISK = /^red disk$/i;
const JUG_EMPTY = /^empty jug$/i;
const JUG3 = /^full jug$/i;
const JUG1 = /^1\/3rds full jug$/i;
const JUG2 = /^2\/3rds full jug$/i;
const BUCKET_EMPTY = /^empty bucket$/i;
const BUCKET1 = /^1\/5ths full bucket$/i;
const BUCKET2 = /^2\/5ths full bucket$/i;
const BUCKET3 = /^3\/5ths full bucket$/i;
const BUCKET4 = /^4\/5ths full bucket$/i;
const BUCKET5 = /^full bucket$/i;
const VASE = /^vase$/i;
const VASE_WATER = /^vase of water$/i;
const VASE_LID = /^vase lid$/i;
const SEALED_WATER = /^sealed vase$/i;
const FROZEN_KEY = /^frozen key$/i;
const SEER_KEY = /^seers' key$/i;

const PACK: ItemNeed[] = [
    { pattern: ANY_AXE, count: 1, label: 'axe' },
    { pattern: KNIFE, count: 1, label: 'knife' },
    { pattern: TINDERBOX, count: 1, label: 'tinderbox' },
    { pattern: COINS, count: 6000, label: 'coins' },
    { pattern: RAW_SHARK, count: 2, label: 'raw shark' },
    { pattern: CABBAGE, count: 1, label: 'cabbage' },
    { pattern: POTATO, count: 1, label: 'potato' },
    { pattern: ONION, count: 1, label: 'onion' },
    { pattern: BEER, count: 2, label: 'beer' },
    { pattern: FOOD, count: 8, label: 'food' },
];

function hasPack(): boolean {
    return PACK.every((n) => count(n.pattern) >= n.count);
}

// ---------------------------------------------------------------------------
// Anchors — every tile below is an in-game observation from the quest-lab
// recon sweep of this content revision (probe-viking-recon, 2026-10-18), not
// OSRS memory: the council members are scattered around Rellekka, Brundt /
// Thora / Manni inside the longhall, Peer in the house by the market.
// ---------------------------------------------------------------------------

const SEERS = { x: SEERS_BANK.x, z: SEERS_BANK.z };
const LONGHALL = { x: 2658, z: 3671 };
const STAGE = { x: 2657, z: 3670 };
const KEG_TABLE = { x: 2661, z: 3676 };
const REVELLER_SWAP_SPOT = { x: 2659, z: 3675 }; // inside the longhall keg-swap zone
const PIPE = { x: 2663, z: 3674 };
const SWENSEN_HOUSE = { x: 2646, z: 3660 }; // Swensen the Navigator's house (holds the maze ladder)
// Hallifred's ladder: top is at 2644,3658 (Climb-down), landing inside the
// labyrinth at 2631,10004; the two vote-granting exit ladders are at
// 2665,10037 and 2666,10012 (verified against the map data).
const MAZE_LADDER = { x: 2644, z: 3658 };
const MAZE_EXITS: Tile[] = [{ x: 2665, z: 10037 }, { x: 2666, z: 10012 }];
// Olaf-trial anchors (all swept in-game 2026-10-18)
const CAULDRON = { x: 2772, z: 3623 }; // Lalli's Stew
const SWAYING_TREE = { x: 2738, z: 3638 };
const STRANGE_ALTAR = { x: 2626, z: 3598 };
const SPINNING_WHEEL = { x: 2617, z: 3659 }; // Rellekka's — gated until %viking is complete
const WHEEL_HOUSE = { x: 2715, z: 3471 }; // Seers' Village wheel, upstairs (plane 1)
const LONGHALL_STAGE_SPOT = { x: 2658, z: 3683 }; // inside the longhall play zone
const PEER_HOUSE = { x: 2633, z: 3661 };
const NPC_ANCHOR: Record<string, Tile> = {
    brundt: { x: 2658, z: 3669 },
    manni: { x: 2660, z: 3675 },
    manni_sober: { x: 2660, z: 3675 }, // same spot: the sober reveller in the longhall
    barkeep: { x: 2662, z: 3673 },
    sigmund: { x: 2643, z: 3681 },
    olaf: { x: 2671, z: 3684 },
    sigli: { x: 2659, z: 3654 },
    thorvald: { x: 2666, z: 3692 },
    yrsa: { x: 2626, z: 3674 },
    skulgrimen: { x: 2663, z: 3693 },
    sailor: { x: 2629, z: 3693 },
    fisherman: { x: 2641, z: 3699 },
    askeladden: { x: 2658, z: 3660 },
    peer: { x: 2633, z: 3669 },
    swensen: { x: 2646, z: 3660 },
    workman: { x: 2655, z: 3592 },
    poison: { x: 2698, z: 3497 }, // Poison Salesman wanders the Seers tavern
    // Lalli's cave: NPC swept at 2768,3619 with Cave Entrance@2774,3619 and the
    // cauldron Lalli's Stew@2772,3623 (golden-sheep clearing east of Rellekka).
    lalli: { x: 2768, z: 3619 },
};
const NPC_RE: Record<string, RegExp> = {
    brundt: /brundt/i,
    // The reveller's NPC is respawned under different names as the trial moves:
    // viking_reveller="Bjorn", viking_reveller_2="Eldgrim",
    // viking_reveller_3="Manni the Reveller". Match all three or the drink
    // contest silently finds nobody and just loops.
    manni: /manni|bjorn|eldgrim|reveller/i,
    // The MERCHANT chain only exists on viking_reveller_3 ("Manni the Reveller",
    // the sober longhall drinker). viking_reveller / _2 are the drunk revellers
    // (Bjorn / Eldgrim) whose whole dialogue is hiccuping flavour — talking to
    // one of those left spoke_manni unset forever.
    manni_sober: /^manni/i,
    barkeep: /thora/i,
    sigmund: /sigmund/i,
    olaf: /olaf/i,
    sigli: /sigli/i,
    thorvald: /thorvald/i,
    yrsa: /^yrsa$/i,
    skulgrimen: /skulgrimen/i,
    sailor: /^sailor$/i,
    fisherman: /^fisherman$/i,
    askeladden: /askeladden/i,
    peer: /peer/i,
    // The maze-giver's npc key is viking_hallifred but its DISPLAY name is
    // "Swensen the Navigator" — and it had no entry here at all, so the accept
    // talk silently found nobody and the climb-down ladder stayed inert.
    swensen: /swensen|navigator|hallifred/i,
    lalli: /^lalli$/i,
    workman: /workman/i,
    poison: /poison/i,
};

/** Catherby bank -> Seers -> Rellekka longhall. Short hops, no long chords. */
const NORTH_ROAD: Tile[] = [
    { x: 2795, z: 3445 },
    { x: 2780, z: 3460 },
    { x: 2765, z: 3475 },
    { x: 2750, z: 3485 },
    SEERS,
    { x: 2715, z: 3495 },
    { x: 2705, z: 3510 },
    { x: 2698, z: 3530 },
    { x: 2692, z: 3550 },
    { x: 2688, z: 3570 },
    { x: 2680, z: 3590 },
    { x: 2672, z: 3610 },
    { x: 2665, z: 3630 },
    { x: 2660, z: 3650 },
    { x: 2660, z: 3665 },
    LONGHALL,
];

const cheb = (a: { x: number; z: number }, b: { x: number; z: number }) => Math.max(Math.abs(a.x - b.x), Math.abs(a.z - b.z));

/**
 * Route waypoints from the collision-aware pathfinder, in short chunks. A
 * single sendWalk leg (or even one walkTo) from Rellekka to the Seers bank is
 * ~200 tiles and silently no-ops — the first version of this script hung at the
 * seer door for four minutes waiting on a walk that was never issued.
 */
function planWaypoints(from: { x: number; z: number; level: number }, dest: Tile): Tile[] {
    try {
        const path = findLongPath(from.level, from.x, from.z, dest.x, dest.z) as Tile[] | null;
        if (!path || path.length === 0) return [{ x: dest.x, z: dest.z }];
        const out: Tile[] = [];
        for (let i = 0; i < path.length; i += 8) {
            const t = path[Math.min(i + 7, path.length - 1)]!;
            out.push({ x: t.x, z: t.z });
        }
        const last = out[out.length - 1];
        if (!last || last.x !== dest.x || last.z !== dest.z) out.push({ x: dest.x, z: dest.z });
        return out;
    } catch {
        return [{ x: dest.x, z: dest.z }];
    }
}

/** Plane change without a ctx (travel and puzzle steps both need it). */
async function planeChangeFree(target: number, prefer?: { x: number; z: number }): Promise<boolean> {
    for (let round = 0; round < 5; round++) {
        if (pos().level === target) return true;
        await sdk.scanNearbyLocs(14).catch(() => undefined);
        const goingUp = target > pos().level;
        const want = goingUp ? /climb[- ]up|open/i : /climb[- ]down/i;
        const candidates = (sdk.getNearbyLocs() ?? []).filter(
            (l) => /ladder|trapdoor|staircase/i.test(l.name ?? '') && (l.optionsWithIndex ?? []).some((o) => want.test(o.text))
        );
        const loc = prefer
            ? (candidates.find((l) => Math.abs((l.x ?? 0) - prefer.x) <= 1 && Math.abs((l.z ?? 0) - prefer.z) <= 1) ?? candidates[0])
            : candidates[0];
        if (!loc) {
            log(`plane: no ${goingUp ? 'upward' : 'downward'} route from plane ${pos().level} @ ${here()}`);
            return false;
        }
        await approachTile({ x: loc.x ?? 0, z: loc.z ?? 0 });
        await bot.interactLoc(loc as never, want as never).catch(() => undefined);
        await ticks(8);
        // A plane change empties and rebuilds the scene: settle and re-scan
        // before anything clicks on the new plane.
        await sdk.scanNearbyLocs(14).catch(() => undefined);
        await ticks(4);
    }
    return pos().level === target;
}

/**
 * Leave Peer's house from ANY room. The mural room (plane 0, x>=2634) has no
 * door to the outside — its own door at 2636,3667 is the locked exit door that
 * only the Seers' key opens. The way out is: ladder up (plane 2) -> WESTERN
 * trapdoor down into the pocket room (2631,3662) -> the combination door at
 * 2631,3667, whose "you will fail this trial" page is the exit confirmation.
 * A plain walk cannot route out, so every long trip must start with this.
 */
async function exitSeerHouseIfInside(): Promise<void> {
    if (pos().level !== 0 && pos().level !== 2) return;
    // Strictly inside: standing ON either door line (z == 3667) means we just
    // came out, and calling the exit routine there sends us hunting a ladder
    // from outside the house.
    const inside = Math.abs(pos().x - 2633) <= 9 && pos().z < SEER_DOOR.z && pos().z >= 3655;
    if (!inside) return;
    log(`house exit: inside at ${here()} — routing out`);
    if (pos().level === 0 && pos().x >= 2634) {
        await planeChangeFree(2);
    }
    if (pos().level === 2) {
        await planeChangeFree(0, { x: 2631, z: 3663 });
    }
    for (let round = 0; round < 4; round++) {
        if (pos().z >= SEER_DOOR.z) return;
        await sdk.scanNearbyLocs(12).catch(() => undefined);
        const door = (sdk.getNearbyLocs() ?? []).find(
            (l) => /^door$/i.test(l.name ?? '') && Math.abs((l.x ?? 0) - SEER_DOOR.x) <= 5 && Math.abs((l.z ?? 0) - SEER_DOOR.z) <= 1
        );
        if (!door) {
            await ticks(3);
            continue;
        }
        await approachTile({ x: door.x ?? 0, z: (door.z ?? 0) - 1 });
        await bot.interactLoc(door as never, /open/i as never).catch(() => undefined);
        await ticks(4);
        const dlg = sdk.getDialog();
        const cont = (dlg?.options ?? []).find((o) => /click here to continue/i.test(o.text));
        if (cont) {
            await sdk.sendClickDialog(cont.index).catch(() => undefined);
            await ticks(5);
        }
        log(`house exit round ${round}: ${here()}`);
    }
}

/** Anything long-range starts from the mainland: descend, then leave the house. */
async function preTravel(dest: Tile): Promise<void> {
    if (cheb(pos(), dest) < 30) return;
    if (pos().level !== 0) await planeChangeFree(0);
    await exitSeerHouseIfInside();
}

/** Long-range travel: chunked waypoints, per-leg displacement verified. */
async function travelTo(dest: Tile): Promise<boolean> {
    // Credit travel as progress so long legs (a Catherby bank trip is ~300 tiles)
    // never let ActivitySession's 120s stall clock fire. noteProgress('location')
    // ignores notes whose tile has not advanced, so this is free when it does not.
    session.noteProgress('location', `travel ${pos().x},${pos().z}`);
    await preTravel(dest);
    let stuck = 0;
    for (let round = 0; round < 40; round++) {
        if (cheb(pos(), dest) <= 3) return true;
        const from = pos();
        const wps = planWaypoints(from, dest);
        const wp = wps.find((w) => cheb(from, w) > 2) ?? dest;
        // No route at all (the pathfinder returns just the destination when it
        // cannot plan): shuffle a few tiles toward the target to break out of
        // the pocket, then re-plan. A sweep that ends in a nook leaves the bot
        // here, and without this it burns all 40 rounds logging "no waypoints".
        if (wps.length === 1 && ++stuck > 2) {
            const dx = Math.sign(dest.x - from.x);
            const dz = Math.sign(dest.z - from.z);
            const stepX = from.x + (Math.abs(dest.x - from.x) > Math.abs(dest.z - from.z) ? dx * 6 : 0);
            const stepZ = from.z + (Math.abs(dest.z - from.z) > Math.abs(dest.x - from.x) ? dz * 6 : 0);
            log(`travel: no route from ${from.x},${from.z} — shuffling toward ${stepX},${stepZ}`);
            await sdk.sendWalk(stepX, stepZ, true).catch(() => undefined);
            await ticks(4);
            if (cheb(from, pos()) >= 1) stuck = 0;
            continue;
        }
        const res = await bot.walkTo(wp.x, wp.z, 3).catch((e: unknown) => ({ success: false, message: String(e) }));
        await ticks(2);
        if (cheb(from, pos()) < 1 && cheb(pos(), wp) > 3) {
            log(`travel: blocked toward ${wp.x},${wp.z} from (${from.x},${from.z}) — ${(res as { message?: string })?.message ?? 'no movement'}`);
            await ticks(4);
        }
        if (cheb(pos(), dest) <= 3) return true;
    }
    log(`travel: gave up toward ${dest.x},${dest.z} @ ${here()}`);
    return false;
}

/**
 * Approach a tile: route there, then a short walkTo so blocking doors open
 * (the council members sit inside the longhall, Yrsa in the shop).
 */
async function approach(dest: Tile): Promise<void> {
    // travel credit on every approach (see travelTo)
    session.noteProgress('location', `approach ${pos().x},${pos().z}`);
    await closeUi(bot, sdk).catch(() => undefined);
    await travelTo(dest);
    for (let i = 0; i < 3 && cheb(pos(), dest) > 3; i++) {
        await bot.walkTo(dest.x, dest.z, 2).catch(() => undefined);
        await ticks(2);
    }
}

/** Kept for the stage bodies: the waypoint list is now planned, not hand-listed. */
async function go(ctx: QuestContext, hops: Tile[], dest: Tile): Promise<void> {
    void ctx;
    void hops;
    await approach(dest);
}

/** Dialog choices: accept-style options first, refusals never chosen. */
const PICKS: RegExp[] = [
    /^yes$/i,
    /i want to become a fremennik/i,
    /yes, i am interested/i,
    /^ask about becoming a fremennik/i,
    /can you tell my future/i,
    /what'?s a draugen/i,
    /i was wondering/i,
    /ask for a new pet rock/i,
    /what do i have to do/i,
    /^ask about the merchant'?s trial/i,
    /pay/i,
];
const REFUSE = /^(no|don'?t|forget it|nothing|nothin|never mind|later|you'?re right|remind me|i don'?t need|i forget)/i;

/**
 * Drive a multi-page NPC dialog: continue pages advance, otherwise the first
 * matching accept-style pick, else the first non-refusal option. 40 rounds —
 * the start chain alone is 12 pages, which is what left the old 12-page
 * walker stuck before it ever reached "I want to become a Fremennik!".
 */
/** What the NPC actually said — dialog components only, never the stale chat ring. */
function dialogSaid(): string {
    const d = sdk.getDialog?.() as { isOpen?: boolean; text?: string; allComponents?: { text?: string }[] } | undefined;
    if (!d?.isOpen) return '';
    const bits: string[] = [];
    if (d.text) bits.push(String(d.text));
    for (const c of d.allComponents ?? []) if (c.text) bits.push(String(c.text));
    return bits.join(' ').replace(/\s+/g, ' ').trim();
}

async function driveDialog(picks: RegExp[] = PICKS, maxRounds = 70): Promise<string> {
    const seen: string[] = [];
    const said: string[] = [];
    let quiet = 0;
    let repeats = 0;
    let continuePages = 0;
    let lastSignature = '';
    for (let i = 0; i < maxRounds; i++) {
        const dialog = sdk.getDialog();
        if (!dialog?.isOpen) {
            await ticks(1);
            if (!sdk.getDialog()?.isOpen && ++quiet > 2) break;
            continue;
        }
        quiet = 0;
        seen.push(allText(sdk, 8));
        const line = dialogSaid();
        if (line && said[said.length - 1] !== line) said.push(line);
        const options = dialog.options ?? [];
        if (options.length === 0) {
            await ticks(1);
            continue;
        }
        // Only a repeated CHOICE menu means stuck. Consecutive "Click here to
        // continue" pages are all byte-identical to each other, so counting those
        // as repeats aborts every long NPC conversation (Sigli's accept chain is
        // 23 pages before it closes).
        const isContinueOnly = options.every((o) => /^click here to continue$/i.test(o.text));
        const signature = `${dialog.text ?? ''}|${options.map((o) => o.text).join('|')}`;
        if (!isContinueOnly && signature === lastSignature) {
            if (++repeats >= 3) {
                log(`dialog: page repeated ${repeats}x [${options.map((o) => o.text).join('|')}] — leaving it`);
                break;
            }
        } else {
            repeats = 0;
            lastSignature = signature;
        }
        if (isContinueOnly) {
            if (++continuePages > 90) {
                log('dialog: continue-page cap reached — leaving it');
                break;
            }
        } else {
            continuePages = 0;
        }
        log(`dialog options [${options.map((o) => o.text).join(' | ')}]`);
        const cont = options.find((o) => /click here to continue/i.test(o.text));
        if (cont) {
            await sdk.sendClickDialog(cont.index).catch(() => undefined);
            await ticks(1);
            continue;
        }
        const pick =
            picks.map((re) => options.find((o) => re.test(o.text))).find(Boolean) ??
            options.find((o) => !REFUSE.test(o.text)) ??
            options.find((o) => /^i don'?t need|^i forget|^forget it/i.test(o.text));
        if (!pick) {
            // Every option is a refusal/flavour line (Olaf's "Remind me…" menu
            // once the trial is open). Clicking one re-opens the same menu
            // forever — leave it and let the caller move on.
            log(`dialog: only refusal options [${options.map((o) => o.text).join('|')}] — leaving it`);
            break;
        }
        log(`dialog -> ${pick.text}`);
        await sdk.sendClickDialog(pick.index).catch(() => undefined);
        await ticks(2);
    }
    await bot.dismissBlockingUI().catch(() => undefined);
    // Prefer what the NPC said; the chat ring is only a fallback (it carries
    // minutes-old lines that made every chain check look identically stale).
    return said.join(' || ') || seen.join(' || ');
}

async function goNpc(ctx: QuestContext, key: string): Promise<boolean> {
    const anchor = NPC_ANCHOR[key]!;
    await approach(anchor);
    // Scene streams late: settle then retry the find rather than one-shot it.
    for (let i = 0; i < 4; i++) {
        const npc = sdk.findNearbyNpc(NPC_RE[key]!);
        if (npc) return true;
        if (cheb(pos(), anchor) > 12) await approach(anchor);
        await ticks(4);
    }
    ctx.log(`${key}: no NPC matching ${String(NPC_RE[key])} @ ${here()}`);
    return false;
}

async function talk(ctx: QuestContext, key: string, picks: RegExp[] = PICKS): Promise<string> {
    if (!(await goNpc(ctx, key))) {
        ctx.log(`talk ${key}: could not reach the anchor @${here()} — no conversation`);
        return '';
    }
    const npc = sdk.findNearbyNpc(NPC_RE[key]!);
    if (!npc) {
        ctx.log(`talk ${key}: no NPC matching ${String(NPC_RE[key])} @${here()} (anchor ${JSON.stringify(NPC_ANCHOR[key])})`);
        return '';
    }
    const t = await bot.talkTo(npc as never).catch((e: unknown) => ({ success: false, message: String(e) }));
    if (!t.success) ctx.log(`talk ${key}: ${t.message}`);
    await ticks(2);
    const said = await driveDialog(picks);
    // A drained conversation is real progress — and a non-phase note also exits
    // any recovery the stall clock started, which is what used to end as `stuck`.
    session.noteProgress('dialog', `talked to ${key}`);
    return said;
}

function findLoc(nameRe: RegExp, optionRe?: RegExp) {
    const locs = sdk.getNearbyLocs() ?? [];
    const hits = locs.filter((l) => nameRe.test(l.name ?? ''));
    if (optionRe) {
        const withOpt = hits.filter((l) => (l.optionsWithIndex ?? []).some((o) => optionRe.test(o.text)));
        if (withOpt.length > 0) return withOpt.sort((a, b) => (a.distance ?? 99) - (b.distance ?? 99))[0];
    }
    return hits.sort((a, b) => (a.distance ?? 99) - (b.distance ?? 99))[0];
}

async function scanAround(ctx: QuestContext, at: Tile): Promise<void> {
    await go(ctx, [at], at);
    await sdk.scanNearbyLocs(15).catch(() => undefined);
}

function invItem(re: RegExp) {
    return sdk.findInventoryItem(re) ?? sdk.getInventory().find((i) => re.test(i.name));
}

/** Operate (opheld1) an inventory item: talisman, lyre. */

/**
 * All readable text: dialog components PLUS the chat ring.
 * quest-lib's visibleText() reads sdk.getChat(), which returns empty on the lite
 * client — the live ring is state.gameMessages (verified: 46 talisman guidance
 * lines present there while getChat() returned ""). Without this every
 * message-gated step in this script is blind.
 */
function allText(sdkRef: BotSDK, chatLines = 8): string {
    const gm = (sdkRef.getState()?.gameMessages ?? []) as Array<{ text?: string }>;
    const ring = gm.slice(-chatLines).map((m) => m.text ?? '').join(' \u0001 ');
    return `${visibleText(sdkRef, chatLines)} ${ring}`;
}

async function operate(ctx: QuestContext, re: RegExp): Promise<boolean> {
    const item = invItem(re);
    if (!item) {
        ctx.log(`operate: no ${String(re)} in inventory`);
        return false;
    }
    await closeUi(bot, sdk).catch(() => undefined);
    await sdk.sendUseItem(item.slot).catch(() => undefined);
    await ticks(3);
    return true;
}

async function combine(ctx: QuestContext, useRe: RegExp, onRe: RegExp): Promise<boolean> {
    // Silent-and-once was the old shape, and it is why the live vase never got
    // its lid: slot numbers were resolved once, the client's slot cache lags
    // gateway state (a known fleet quirk — the first use-on-item after banking
    // fails on stale slots), and nothing was logged, so a no-op looked like
    // success. Re-resolve every attempt, retry, and log each one.
    const shape = (): string =>
        sdk
            .getInventory()
            .filter((i) => (i.count ?? 0) > 0)
            .map((i) => `${i.name}x${i.count}`)
            .join(',');
    for (let attempt = 0; attempt < 3; attempt++) {
        const a = invItem(useRe);
        const b = invItem(onRe);
        if (!a || !b) {
            ctx.log(`combine: missing ${!a ? String(useRe) : String(onRe)}`);
            return false;
        }
        const before = shape();
        await closeUi(bot, sdk).catch(() => undefined);
        await sdk.sendUseItemOnItem(a.slot, b.slot);
        await ticks(3);
        const changed = shape() !== before;
        ctx.log(
            `combine[${attempt}] ${String(useRe)}@${a.slot} -> ${String(onRe)}@${b.slot} changed=${changed}`
        );
        if (changed) return true;
        await ticks(2);
    }
    return false;
}

async function useOnLoc(ctx: QuestContext, itemRe: RegExp, locRe: RegExp, locOption?: RegExp): Promise<boolean> {
    await sdk.scanNearbyLocs(12).catch(() => undefined);
    const loc = findLoc(locRe, locOption);
    if (!loc) {
        const names = (sdk.getNearbyLocs() ?? []).map((l) => l.name).join(',');
        ctx.log(`useOnLoc: no loc ${String(locRe)} nearby (saw: ${names.slice(0, 160)})`);
        return false;
    }
    await approachLoc(loc);
    const r = await bot.useItemOnLoc(itemRe, loc as never, { timeout: 15_000 } as never).catch((e: unknown) => ({ success: false, message: String(e) }));
    if (!(r as { success?: boolean }).success) {
        ctx.log(`useOnLoc ${String(itemRe)} on ${String(locRe)} failed: ${(r as { message?: string }).message ?? '?'} @ ${here()}`);
    }
    await ticks(3);
    return !!(r as { success?: boolean }).success;
}

async function eat(ctx: QuestContext): Promise<void> {
    if (pos().hp > pos().maxHp * 0.55) return;
    const food = invItem(FOOD);
    if (!food) return;
    const before = pos().hp;
    await sdk.sendUseItem(food.slot).catch(() => undefined);
    await waitUntil(() => pos().hp > before, 5_000);
}

// ---------------------------------------------------------------------------
// Banking: pack withdrawal, deposit-all (unarmed segments), gear restore.
// ---------------------------------------------------------------------------

async function atSeersBank(): Promise<boolean> {
    return Math.hypot(pos().x - SEERS.x, pos().z - SEERS.z) <= 10;
}

async function openBankHere(ctx: QuestContext): Promise<boolean> {
    if (!sdk.getState()?.bank?.isOpen) {
        const r = await bot.openBank();
        if (!r.success && !sdk.getState()?.bank?.isOpen) {
            ctx.log(`openBank: ${r.message}`);
            return false;
        }
    }
    return true;
}

/** Withdraw the quest pack. Caller must already be at a bank booth. */
async function withdrawPack(ctx: QuestContext): Promise<boolean> {
    if (!(await openBankHere(ctx))) return false;
    const missing = await withdrawNeeds(ctx, PACK);
    await bot.closeBank().catch(() => undefined);
    if (missing.length > 0) {
        ctx.log(`pack still missing: ${missing.map((m) => m.label).join(',')} — sourcing`);
        await sourceMissing(ctx, missing);
    }
    const left = PACK.filter((n) => count(n.pattern) < n.count);
    if (left.length) ctx.log(`pack: giving up on ${left.map((m) => m.label).join(',')}`);
    return left.length === 0;
}

async function ensurePack(ctx: QuestContext): Promise<boolean> {
    if (hasPack()) return true;
    ctx.log('pack incomplete — banking');
    if (pos().z > 3460 || (await atSeersBank())) {
        await go(ctx, [SEERS], SEERS);
    } else {
        await parkAtBank(sdk, bot, 'catherby', { timeoutMs: 180_000 });
        await go(ctx, [CATHERBY_BANK, ...NORTH_ROAD.slice(0, 5)], SEERS);
    }
    return withdrawPack(ctx);
}

interface GearPiece {
    name: string;
    count: number;
    worn: boolean;
}

function snapshotGear(): GearPiece[] {
    const snap: GearPiece[] = [];
    for (const i of sdk.getInventory()) {
        if ((i.count ?? 0) > 0) snap.push({ name: i.name, count: i.count ?? 1, worn: false });
    }
    for (const e of sdk.getEquipment()) {
        if (e?.name) snap.push({ name: e.name, count: e.count ?? 1, worn: true });
    }
    return snap;
}

/** Deposit absolutely everything (Peer house needs empty inv+worn; the
 *  Thorvald gate bans weapons/armour/runes/ammo/logs). Keeps nothing. */

/**
 * Field patches for the stew vegetables — the ground beats the shop. Wydin's
 * stock is finite and shared with the whole fleet (the live run sat at
 * `could not open /^wydin$/i for cabbage` twice, then bought the potato on the
 * next pass), whereas these plants regrow. Anchors are the loc placements for
 * this content revision (`quest-lab-locfind.ts cabbage|potato|onion`), plus the
 * Rimmington-area onion tile the fleet's witchs-potion has used all along.
 */
const ONION_FIELD = { x: 2950, z: 3251 };

interface VegPatch {
    label: string;
    item: RegExp;
    loc: RegExp;
    anchors: Tile[];
}

const VEG_PATCHES: VegPatch[] = [
    {
        label: 'cabbage',
        item: CABBAGE,
        loc: /^cabbage$/i,
        anchors: [
            { x: 2674, z: 3651 },
            { x: 2676, z: 3667 },
            ONION_FIELD,
        ],
    },
    {
        label: 'potato',
        item: POTATO,
        loc: /^potato$/i,
        anchors: [
            { x: 2737, z: 3583 },
            ONION_FIELD,
        ],
    },
    {
        label: 'onion',
        item: ONION,
        loc: /^onion$/i,
        anchors: [
            { x: 2674, z: 3655 },
            { x: 2676, z: 3674 },
            ONION_FIELD,
        ],
    },
];

/** Pick `want` of a vegetable from its plant locs, trying each anchor in turn. */
async function pickVeg(ctx: QuestContext, patch: VegPatch, want: number): Promise<void> {
    for (const anchor of patch.anchors) {
        if (count(patch.item) >= want) break;
        await approach(anchor);
        for (let i = 0; i < want + 2 && count(patch.item) < want; i++) {
            const plant =
                sdk.findNearbyLoc(patch.loc, { reachable: true }) ?? sdk.findNearbyLoc(patch.loc);
            if (!plant) {
                ctx.log(
                    `pick ${patch.label}[${i}] @ ${pos().x},${pos().z}: no plant near ${anchor.x},${anchor.z}`
                );
                break;
            }
            const r = await bot
                .interactLoc(plant, /pick|take/i)
                .catch((e: unknown) => ({ success: false, message: String(e) }));
            ctx.log(
                `pick ${patch.label}[${i}] @ ${pos().x},${pos().z}: ok=${r.success} ${patch.label}=${count(patch.item)}`
            );
            await ticks(3);
        }
    }
}

/**
 * Whatever the bank could not cover, in the fleet's own order: quest mule ->
 * verified shops (Wydin's food store, Varrock bartender via dialogue) -> loc
 * pick. A live bot with an empty shelf must be able to finish the quest
 * unattended, otherwise "pre-stocked bank" is an undocumented prerequisite.
 */
async function sourceMissing(ctx: QuestContext, needs: ItemNeed[]): Promise<boolean> {
    const short0 = needs.filter((n) => count(n.pattern) < n.count);
    if (!short0.length) return true;
    ctx.log(`supply: sourcing ${short0.map((n) => n.label).join(',')}`);
    // The shop leg needs coins IN THE PACK: supply.ts's takeCoins() only
    // withdraws while the bank is already open, and ensureSupplied() closes the
    // bank before it shops — so a bot carrying 0gp can never buy anything and
    // every purchase logs `cannot afford`. Top up here, standing at the bank.
    if (count(COINS) < 10_000 && (await openBankHere(ctx))) {
        const bankCoins = (sdk.getBankItems() ?? []).find((i) => /^coins$/i.test(i.name));
        if (bankCoins) {
            await bot
                .withdrawItem(bankCoins, 10_000 - count(COINS))
                .catch(() => undefined);
            await ticks(2);
        }
        ctx.log(`supply: coins=${count(COINS)} after bank top-up`);
        await bot.closeBank().catch(() => undefined);
    }
    // Ground before shop: the patches regrow and are local to Rellekka, while
    // shop stock is finite and shared across the fleet.
    for (const patch of VEG_PATCHES) {
        const need = short0.find((n) => patch.item.source === n.pattern.source || patch.item.test(n.label));
        if (!need || count(patch.item) >= need.count) continue;
        ctx.log(`supply: picking ${patch.label} from the field`);
        await pickVeg(ctx, patch, need.count);
    }
    for (const n of short0.filter((x) => count(x.pattern) < x.count)) {
        if (!/cabbage|potato|onion/i.test(n.label)) continue;
        ctx.log(`supply: ${n.label} still short after the field — using shops`);
    }
    // Hudo (the only onion vendor) stands INSIDE the Grand Tree, and the tree's
    // interior is entered from the BOTTOM — by its roots — not by walking to
    // interior coordinates. A bare-walk shop leg can never reach him, so the
    // onion is field-only: pick it or wait for the next pass.
    const shopNeeds = short0.filter((n) => !/onion/i.test(n.label));
    const onionShort = short0.filter((n) => /onion/i.test(n.label));
    if (onionShort.length && onionShort.some((n) => count(n.pattern) < n.count)) {
        ctx.log('supply: onion is field-only (Hudo sits inside the Grand Tree) — not walking to shops');
    }
    let still: ItemNeed[] = shopNeeds;
    try {
        still = (await ensureSupplied(ctx, shopNeeds as never)) as unknown as ItemNeed[];
    } catch (e) {
        ctx.log(`supply: chain failed (${String(e)}) — trying loc picks`);
    }
    // supply.ts approaches shops with a bare hop sender, which stops short of
    // the shop INTERIOR: live, the bot sat 100+ tiles away and logged
    // `could not open /^wydin$/i for cabbage` without ever entering the store.
    // Re-approach with this script's door-aware travel, then retry the buy.
    for (const n of short0) {
        if (count(n.pattern) >= n.count) continue;
        if (/onion/i.test(n.label)) continue; // Hudo is inside the Grand Tree
        const sources = SHOP_SOURCES[(n.label ?? '').toLowerCase()] ?? [];
        for (const shop of sources) {
            if (count(n.pattern) >= n.count) break;
            ctx.log(`supply: re-approaching ${String(shop.npc)} @ ${shop.tile.x},${shop.tile.z} for ${n.label}`);
            await go(ctx, [shop.tile], shop.tile);
            await buyFromShops(ctx, n as never).catch(() => undefined);
            ctx.log(`supply: after re-approach ${n.label}=${count(n.pattern)}`);
        }
    }
    const left = needs.filter((n) => count(n.pattern) < n.count);
    if (left.length) ctx.log(`supply: STILL missing ${left.map((n) => n.label).join(',')}`);
    return left.length === 0;
}

/**
 * Withdraw just the listed items from the Seers bank — never deposit first.
 * The stage needs a tool, not a full pack reset: depositAll would bank the
 * golden fleece / lyre the previous steps just earned.
 */
async function ensureItems(ctx: QuestContext, needs: ItemNeed[]): Promise<boolean> {
    const missing = needs.filter((n) => count(n.pattern) < n.count);
    if (!missing.length) return true;
    ctx.log(`items: withdrawing ${missing.map((m) => m.label).join(',')}`);
    await approach(SEERS);
    if (!(await openBankHere(ctx))) {
        ctx.log('items: bank would not open — continuing with what we hold');
        return false;
    }
    const still = await withdrawNeeds(ctx, missing);
    await bot.closeBank().catch(() => undefined);
    if (still.length) {
        ctx.log(`items: bank short of ${still.map((m) => m.label).join(',')} — sourcing`);
        await sourceMissing(ctx, still);
    }
    return missing.every((n) => count(n.pattern) >= n.count);
}

async function depositAll(ctx: QuestContext): Promise<boolean> {
    await go(ctx, [SEERS], SEERS);
    if (!(await openBankHere(ctx))) return false;
    for (const item of sdk.getInventory()) {
        if ((item.count ?? 0) <= 0) continue;
        await bot.depositItem(item, -1);
    }
    for (const e of [...sdk.getEquipment()]) {
        if (!e?.name) continue;
        await bot.unequipItem(e.name as never).catch(() => undefined);
    }
    for (const item of sdk.getInventory()) {
        if ((item.count ?? 0) <= 0) continue;
        await bot.depositItem(item, -1);
    }
    await bot.closeBank().catch(() => undefined);
    const empty = sdk.getInventory().filter((i) => (i.count ?? 0) > 0).length === 0 && sdk.getEquipment().filter(Boolean).length === 0;
    ctx.log(`depositAll: empty=${empty}`);
    return empty;
}

function escRe(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function restoreGear(ctx: QuestContext, snap: GearPiece[]): Promise<void> {
    await go(ctx, [SEERS], SEERS);
    if (!(await openBankHere(ctx))) return;
    for (const piece of snap) {
        const have = count(new RegExp(`^${escRe(piece.name)}$`, 'i'));
        if (have >= piece.count) continue;
        await bot.withdrawItem(new RegExp(`^${escRe(piece.name)}$`, 'i'), piece.count - have).catch(() => undefined);
        await ticks(1);
    }
    await bot.closeBank().catch(() => undefined);
    for (const piece of snap.filter((p) => p.worn)) {
        if (!sdk.getEquipment().some((e) => e?.name === piece.name)) {
            await bot.equipItem(new RegExp(`^${escRe(piece.name)}$`, 'i')).catch(() => undefined);
        }
    }
}

// ---------------------------------------------------------------------------
// Stages.
// ---------------------------------------------------------------------------

function gate(ctx: QuestContext): boolean {
    void ctx;
    const wc = sdk.getSkill('Woodcutting')?.baseLevel ?? 1;
    const craft = sdk.getSkill('Crafting')?.baseLevel ?? 1;
    const fletch = sdk.getSkill('Fletching')?.baseLevel ?? 1;
    return wc >= 40 && craft >= 40 && fletch >= 25;
}

const stages: QuestStage[] = [
    // -- quest start ---------------------------------------------------------
    {
        id: 'start',
        detect: () => !progress.started && !progress.complete,
        run: async (ctx) => {
            // ONE fresh journal read per pass — the same contract every other
            // stage follows. Without it a FRESH account can never learn that the
            // accept landed: scanVotes/rescanVotes only re-test the cached text,
            // so the stage re-talked to Brundt and re-passed `started` forever
            // (invisible on a resume, where the flags were already true).
            await refreshProgress('start');
            if (progress.started) return;
            if (!gate(ctx)) {
                ctx.log('stat gate: need WC40/Craft40/Fletch25 (assignment-level) — stuck');
                await ticks(20);
                return;
            }
            await talk(ctx, 'brundt');
            await checkpoint('started', 'Brundt accepted the trials');
            // Bank the quest pack NOW: every later stage withdraws on demand,
            // and sourcing a missing item needs a bank plus coins. Doing it here
            // keeps those detours out of the Rellekka legs entirely.
            await ensurePack(ctx).catch((e: unknown) => ctx.log(`pack: ${String(e)}`));
        },
    },
    // -- Peer: riddle + water puzzle -----------------------------------------
    {
        id: 'peer',
        detect: () => progress.started && !progress.votes.peer,
        run: async (ctx) => {
            await refreshProgress('peer');
            if (progress.votes.peer) return;
            if (noteAttempt('peer') > 30) {
                ctx.log('peer: attempt cap reached, waiting');
                await ticks(30);
                return;
            }
            const snap = snapshotGear();
            if (!(await depositAll(ctx))) return;
            // Accept the challenge (banks via depositAll already done).
            await talk(ctx, 'peer', [/^yes$/i]);
            // Combination-lock door: the riddle menu hides behind the plaque
            // page, and the riddle itself is mesbox text in dialog.allComponents.
            if (!(await seerRiddle(ctx))) {
                await bot.closeInterface().catch(() => undefined);
                await restoreGear(ctx, snap);
                return;
            }
            // Inside: work the fixed puzzle sequence.
            if (!(await peerPuzzle(ctx))) {
                await restoreGear(ctx, snap);
                return;
            }
            if (!(await checkpoint('peer', "Seer's vote"))) {
                ctx.log('peer: vote line not in the journal yet — retrying');
                await ticks(10);
            }
            await restoreGear(ctx, snap);
        },
    },
    // -- Olaf: lyre chain (content: viking_olaf.rs2 / viking_troll.rs2) --------
    // Verified coordinates: Olaf 2671,3684 · Askeladden 2658,3660 · Lalli (troll)
    // 2768,3619 with the cauldron Lalli's Stew@2772,3623 · Swaying tree@2738,3638 ·
    // Spinning wheel@2617,3659 · Strange altar@2626,3598 (Fossegrimen). The play
    // that scores the vote must happen INSIDE the longhall zone
    // (0_41_57_31_34 .. 0_41_57_38_37 = x 2655-2662, z 3682-3685).
    {
        id: 'olaf',
        detect: () => progress.started && progress.votes.peer && !progress.votes.olaf,
        run: async (ctx) => {
            await refreshProgress('olaf');
            if (progress.votes.olaf) return;
            // Only the tools the REMAINING steps need: the pack's stew vegetables
            // are already eaten and demanding them again just loops.
            const olafNeeds: ItemNeed[] = [];
            if (count(STRUNG_LYRE) + count(ENCHANTED_LYRE) === 0) olafNeeds.push({ pattern: ANY_AXE, count: 1, label: 'axe' }, { pattern: KNIFE, count: 1, label: 'knife' });
            if (count(UNSTRUNG_LYRE) > 0 && count(STRUNG_LYRE) + count(ENCHANTED_LYRE) === 0) olafNeeds.push({ pattern: GOLDEN_WOOL, count: 1, label: 'golden wool' });
            if (count(STRUNG_LYRE) > 0 && count(ENCHANTED_LYRE) === 0) olafNeeds.push({ pattern: RAW_SHARK, count: 1, label: 'raw shark' });
            await ensureItems(ctx, olafNeeds);
            if (noteAttempt('olaf') > 40) {
                ctx.log('olaf: attempt cap reached, waiting');
                await ticks(40);
                return;
            }

            // 1. accept the trial
            if (count(PET_ROCK) === 0 && count(GOLDEN_FLEECE) + count(GOLDEN_WOOL) + count(UNSTRUNG_LYRE) + count(STRUNG_LYRE) + count(ENCHANTED_LYRE) === 0) {
                await talk(ctx, 'olaf', [/i was wondering/i, /^yes$/i]);
                ctx.log('olaf: trial accepted (or already started)');
            }

            // 2. Lalli first: his refusal is what sets olaf_spoken_lalli, which
            //    is the ONLY Askeladden branch that hands out the pet rock (the
            //    olaf_started branch is flavour only).
            if (count(PET_ROCK) === 0 && count(GOLDEN_FLEECE) + count(GOLDEN_WOOL) === 0) {
                await talk(ctx, 'lalli', [/golden wool/i, /^yes$/i]);
                ctx.log('olaf: lalli talked (refusal / plan stage)');
            }

            // 3. pet rock from Askeladden
            if (count(PET_ROCK) === 0 && count(GOLDEN_FLEECE) + count(GOLDEN_WOOL) === 0) {
                for (let i = 0; i < 3 && count(PET_ROCK) === 0; i++) {
                    await talk(ctx, 'askeladden', [/^ask about becoming a fremennik/i, /ask about things to do/i, /pet rock/i, /^yes$/i]);
                }
                ctx.log(`olaf: pet rock=${count(PET_ROCK)}`);
            }

            // 4. back to Lalli with the rock -> the "cunning plan" step
            if (count(PET_ROCK) > 0 && count(GOLDEN_FLEECE) + count(GOLDEN_WOOL) === 0) {
                await talk(ctx, 'lalli', [/^yes$/i, /golden wool/i]);
                ctx.log(`olaf: lalli plan step done (rock=${count(PET_ROCK)})`);
            }

            // 5. the stew: rock + cabbage + potato + onion into Lalli's cauldron
            //    (this is a distant loc — travel to it before every use)
            if (count(PET_ROCK) > 0 && count(GOLDEN_FLEECE) === 0) {
                await ensureItems(ctx, [
                    { pattern: CABBAGE, count: 1, label: 'cabbage' },
                    { pattern: POTATO, count: 1, label: 'potato' },
                    { pattern: ONION, count: 1, label: 'onion' },
                ]);
                await approach(CAULDRON);
                for (const [item, label] of [[PET_ROCK, 'pet rock'], [CABBAGE, 'cabbage'], [POTATO, 'potato'], [ONION, 'onion']] as Array<[RegExp, string]>) {
                    if (count(item) === 0) continue;
                    for (let i = 0; i < 2 && count(item) > 0; i++) {
                        await useOnLoc(ctx, item, /lalli'?s stew/i);
                    }
                    ctx.log(`olaf: stew got ${label} (left ${count(item)})`);
                }
                for (let i = 0; i < 4 && count(GOLDEN_FLEECE) === 0 && count(GOLDEN_WOOL) === 0; i++) {
                    await talk(ctx, 'lalli', [/^yes$/i, /golden wool/i]);
                    await ticks(3);
                }
                ctx.log(`olaf: fleece=${count(GOLDEN_FLEECE)} wool=${count(GOLDEN_WOOL)}`);
            }

            // 6. spin the fleece at the SEERS' VILLAGE wheel. Rellekka's own wheel
            //    is viking_spinningwheel, which answers "Only Fremenniks may use
            //    this spinning wheel" until %viking is complete — so the fleece
            //    has to make the trip. The Seers wheel is upstairs (plane 1) in
            //    the wheel house at 2715,3471.
            if (count(GOLDEN_FLEECE) > 0 && count(GOLDEN_WOOL) === 0) {
                await approach(WHEEL_HOUSE);
                if (!(await ensurePlane(1, ctx))) ctx.log('olaf: could not reach the wheel floor');
                await approach(WHEEL_HOUSE);
                for (let i = 0; i < 4 && count(GOLDEN_WOOL) === 0; i++) {
                    await useOnLoc(ctx, GOLDEN_FLEECE, /spinning wheel/i);
                    await waitUntil(() => count(GOLDEN_WOOL) > 0, 10_000);
                    if (count(GOLDEN_WOOL) === 0) {
                        await sdk.scanNearbyLocs(12).catch(() => undefined);
                        const wheel = (sdk.getNearbyLocs() ?? []).find((l) => /spinning wheel/i.test(l.name ?? ''));
                        ctx.log(`olaf: spin retry ${i + 1} — wheel=${wheel ? `${wheel.x},${wheel.z} plane ${pos().level}` : 'not in scan'}`);
                        if (!wheel) await approach(WHEEL_HOUSE);
                    }
                }
                ctx.log(`olaf: golden wool=${count(GOLDEN_WOOL)}`);
            }

            // 7. branch off the swaying tree (axe + Woodcutting 40)
            if (count(BRANCH) === 0 && count(UNSTRUNG_LYRE) + count(STRUNG_LYRE) + count(ENCHANTED_LYRE) === 0) {
                await approach(SWAYING_TREE);
                for (let i = 0; i < 3 && count(BRANCH) === 0; i++) {
                    await interactByName(ctx, /swaying tree/i, /cut[- ]?branch|chop/i, 'swaying tree');
                    await waitUntil(() => count(BRANCH) > 0, 12_000);
                }
                ctx.log(`olaf: branch=${count(BRANCH)}`);
            }

            // 8. knife + branch -> unstrung lyre; golden wool + unstrung -> lyre
            if (count(UNSTRUNG_LYRE) === 0 && count(STRUNG_LYRE) + count(ENCHANTED_LYRE) === 0 && count(BRANCH) > 0) {
                await combine(ctx, KNIFE, BRANCH);
                ctx.log(`olaf: unstrung lyre=${count(UNSTRUNG_LYRE)}`);
            }
            if (count(STRUNG_LYRE) + count(ENCHANTED_LYRE) === 0 && count(UNSTRUNG_LYRE) > 0 && count(GOLDEN_WOOL) > 0) {
                await combine(ctx, GOLDEN_WOOL, UNSTRUNG_LYRE);
                ctx.log(`olaf: strung lyre=${count(STRUNG_LYRE)}`);
            }

            // 9. raw shark on Fossegrimen's altar -> enchanted lyre
            if (count(ENCHANTED_LYRE) === 0 && count(STRUNG_LYRE) > 0) {
                // Fetch the shark HERE, not at stage entry: the stage's need list is
                // computed before the lyre chain has produced a strung lyre, so a
                // "raw shark" added at entry is never requested — the bot then
                // walks to the altar and the use dies with "Item not found".
                await ensureItems(ctx, [{ pattern: RAW_SHARK, count: 1, label: 'raw shark' }]);
                await approach(STRANGE_ALTAR);
                for (let i = 0; i < 3 && count(ENCHANTED_LYRE) === 0; i++) {
                    await useOnLoc(ctx, RAW_SHARK, /strange altar/i);
                    await waitUntil(() => count(ENCHANTED_LYRE) > 0, 8_000);
                }
                ctx.log(`olaf: enchanted lyre=${count(ENCHANTED_LYRE)}`);
            }

            // 10. play it inside the longhall zone (x 2655-2662, z 3682-3685)
            if (count(ENCHANTED_LYRE) > 0) {
                await approach(LONGHALL_STAGE_SPOT);
                await ticks(4);
                for (let i = 0; i < 3 && !progress.votes.olaf; i++) {
                    await operate(ctx, ENCHANTED_LYRE);
                    await ticks(8);
                    await refreshProgress('olaf play');
                }
                ctx.log(`olaf: played the lyre @ ${here()}`);
            }

            if (!(await checkpoint('olaf', "Bard's vote"))) {
                ctx.log('olaf: vote line not in the journal yet — retrying');
                await ticks(10);
            }
        },
    },
    // -- Sigli: Draugen hunt ---------------------------------------------------
    {
        id: 'sigli',
        detect: () => progress.started && progress.votes.peer && progress.votes.olaf && !progress.votes.sigli,
        run: async (ctx) => {
            await refreshProgress('sigli');
            if (progress.votes.sigli) return;
            // Supplies: only the fight food. The talisman comes from Sigli, and
            // ensurePack would demand the stew vegetables Olaf already ate.
            await ensureItems(ctx, [{ pattern: FOOD, count: 6, label: 'food' }]);
            if (noteAttempt('sigli') > 30) {
                ctx.log('sigli: attempt cap reached, waiting');
                await ticks(30);
                return;
            }
            // Accept the hunt + take the talisman. NOTE: the charged and
            // uncharged talismans share the display name "Hunters' talisman", so
            // the kill is detected from the absorb chat line, never from the item.
            if (count(TALISMAN) === 0) {
                await talk(ctx, 'sigli', [/^yes$/i, /what'?s a draugen/i]);
                ctx.log(`sigli: talisman=${count(TALISMAN)}`);
            }
            if (count(TALISMAN) === 0) {
                ctx.log('sigli: no talisman from Sigli yet — retrying next pass');
                await ticks(10);
                return;
            }
            const hunted = await huntDraugen(ctx);
            ctx.log(`sigli: hunt result=${hunted} charged=${count(TALISMAN)}`);
            if (hunted) {
                // hand the charged talisman back for the vote
                for (let i = 0; i < 3 && !progress.votes.sigli; i++) {
                    await talk(ctx, 'sigli', [/^yes$/i]);
                    await refreshProgress('sigli hand-in');
                }
                if (!(await checkpoint('sigli', "Hunter's vote"))) {
                    ctx.log('sigli: vote line not in the journal yet — retrying');
                    await ticks(10);
                }
            } else {
                await ticks(10);
            }
        },
    },
    // -- Manni (the Reveller): drinking contest --------------------------------
    // Content (viking_reveller.rs2): the keg swap is REJECTED unless the
    // firecracker has already been placed (Manni catches you cheating), and the
    // swap only works inside the longhall zone 0_41_57_31_17..0_41_57_38_33
    // (= x 2655-2662, z 3665-3681). Order: accept -> keg -> cracker -> low-alcohol
    // keg -> light -> pipe -> swap -> drink.
    {
        id: 'reveller',
        detect: () => progress.started && progress.votes.peer && progress.votes.olaf && progress.votes.sigli && !progress.votes.reveller,
        run: async (ctx) => {
            await refreshProgress('reveller');
            if (progress.votes.reveller) return;
            // Stage-scoped supplies: the workman wants a beer, the salesman 250 coins.
            await ensureItems(ctx, [
                { pattern: BEER, count: 1, label: 'beer' },
                { pattern: COINS, count: 250, label: 'coins' },
                { pattern: TINDERBOX, count: 1, label: 'tinderbox' },
            ]);
            if (noteAttempt('reveller') > 30) {
                ctx.log('reveller: attempt cap reached, waiting');
                await ticks(30);
                return;
            }
            // 1. Accept the contest — UNCONDITIONALLY. The old guard skipped this
            //    whenever any task item was already held, and the low-alcohol keg
            //    counts as one, so a bot that had bought the keg never started the
            //    trial: the longhall keg's take is content-guarded on
            //    `reveller_started`, so the take silently did nothing and the
            //    stage span. Talking again when already started is harmless.
            const before = progress.votes.reveller;
            await talk(ctx, 'manni_sober', [/^yes$/i]);
            ctx.log(`reveller: talked to Manni the Reveller (sober NPC — Bjorn/Eldgrim are drunk decoys) voteBefore=${before} keg=${count(BEER_KEG)} lowKeg=${count(LOW_KEG)}`);
            // 2. keg of beer off the longhall table
            if (count(BEER_KEG) === 0 && count(LIT_CRACKER) === 0) {
                // The keg is a GROUND SPAWN on the longhall table, so read its real
                // tile from the ground-item list instead of trusting a fixed tile:
                // a 1-tile error makes pickupItem fail silently-ish (pickup=false).
                await approach(KEG_TABLE);
                await takeGroundItem(ctx, /^keg of beer$/i, () => count(BEER_KEG), [3, 1]);
                ctx.log(`reveller: keg=${count(BEER_KEG)}`);
            }
            // 3. trade a beer to the Council workman for the firecracker
            if (count(FIRECRACKER) + count(LIT_CRACKER) === 0) {
                if (count(BEER) === 0) {
                    // The fixture's beer is spent and the bank is short — the
                    // longhall floor has Beer spawns right beside the keg table.
                    await approach(KEG_TABLE);
                    await takeGroundItem(ctx, /^beer$/i, () => count(BEER), [3, 1]);
                    ctx.log(`reveller: beer for the trade = ${count(BEER)}`);
                }
                await go(ctx, [NPC_ANCHOR.workman!], NPC_ANCHOR.workman!);
                await sdk.scanNearbyLocs(10).catch(() => undefined);
                const man = sdk.findNearbyNpc(/workman/i);
                if (man) {
                    const r = await bot.useItemOnNpc(BEER, man as never).catch((e: unknown) => ({ success: false, message: String(e) }));
                    ctx.log(`reveller: firecracker trade -> ${(r as { success?: boolean }).success} ${(r as { message?: string }).message ?? ''} cracker=${count(FIRECRACKER)}`);
                } else {
                    ctx.log('reveller: no Council workman in scan');
                }
                await ticks(3);
            }
            // 4. low-alcohol keg from the Seers Poison Salesman (250 coins)
            if (count(LOW_KEG) === 0 && count(LIT_CRACKER) === 0 && !revellerSwapped) {
                await go(ctx, [NPC_ANCHOR.poison!], NPC_ANCHOR.poison!);
                // The salesman's first menu is a p_choice2: "Talk about the Murder
                // Mystery Quest" (1) / "Talk about the Fremennik Trials" (2). Picking
                // by fallback grabs option 1 and talks about the murder instead —
                // name the Fremennik option explicitly (verified: index 2 takes the
                // Fremennik branch, next page "Hello.").
                await talk(ctx, 'poison', [/fremennik trials/i, /low alcohol/i, /^yes$/i]);
                if (count(LOW_KEG) === 0) await talk(ctx, 'poison', [/low alcohol/i, /^yes$/i]);
                ctx.log(`reveller: low alcohol keg=${count(LOW_KEG)} coins=${count(COINS)}`);
            }
            // 5. light the firecracker with the tinderbox
            if (count(FIRECRACKER) > 0 && count(LIT_CRACKER) === 0 && !revellerSwapped) {
                await combine(ctx, TINDERBOX, FIRECRACKER);
                ctx.log(`reveller: lit cracker=${count(LIT_CRACKER)}`);
            }
            // 6. put it in the longhall pipe — this sets firecracker_placed, which
            //    is what makes the swap legal
            if (count(LIT_CRACKER) > 0 && !revellerSwapped) {
                await go(ctx, [LONGHALL, PIPE], PIPE);
                await useOnLoc(ctx, LIT_CRACKER, /pipe/i);
                ctx.log(`reveller: lit cracker left=${count(LIT_CRACKER)} (placed in the pipe)`);
            }
            // 7. swap the keg (must be inside the longhall swap zone)
            if (count(LOW_KEG) > 0 && count(BEER_KEG) > 0) {
                await approach(REVELLER_SWAP_SPOT);
                await ticks(3);
                await combine(ctx, LOW_KEG, BEER_KEG);
                const swapped = count(LOW_KEG) === 0;
                if (swapped) revellerSwapped = true;
                ctx.log(`reveller: swap done=${swapped} @${here()}`);
                if (!swapped) {
                    ctx.log('reveller: swap refused — the pipe bang must land first');
                    await ticks(6);
                    return;
                }
            }
            // 8. drink: this is where the trial completes
            if (count(BEER_KEG) > 0) {
                session.noteProgress('inventory', 'reveller keg swapped');
                const reply = await talk(ctx, 'manni_sober', [/^yes$/i, /drinking contest/i, /start this drinking contest/i]);
                ctx.log(`reveller: drink talk -> ${reply.replace(/\s+/g, ' ').slice(-150)}`);
                const won = await waitUntil(() => /completed the revellers'? trial|completed the reveller/i.test(allText(sdk, 30)), 90_000);
                ctx.log(`reveller: contest won=${won}`);
                // The trial also completes without the chat line surviving the ring
                // (the queue fires ~5s after the drink and the message can scroll
                // out), and the journal write lands a beat later still — so read
                // the journal before the checkpoint rather than trusting the chat.
                await ticks(8);
                await refreshProgress('reveller drink');
                ctx.log(`reveller: after the drink, journal "${progress.text.slice(0, 0)}" votes.reveller=${progress.votes.reveller}`);
            }
            if (!(await checkpoint('reveller', "Reveller's vote"))) {
                ctx.log('reveller: vote line not in the journal yet — retrying');
                await ticks(10);
            }
        },
    },
    // -- Swensen: Hallifred's labyrinth (the vote comes from the EXIT ladder) ----
    // Content (viking_hallifred.rs2): the maze lives on its own map region around
    // z~10000 (plane 0). `vt_mazeladdertopentrance` (top of the ladder at
    // 2644,3658, op Climb-down) drops you in at ~2631,10004. Only
    // `vt_mazeladderexit` (Climb-up, at 2665,10037 or 2666,10012) runs
    // queue(complete_swensen_trial) -> the vote; the "Escape rope" locs and the
    // entrance ladder just put you back on the surface with nothing.
    {
        id: 'swensen',
        detect: () => progress.started && progress.votes.peer && progress.votes.olaf && progress.votes.sigli && progress.votes.reveller && !progress.votes.swensen,
        run: async (ctx) => {
            await refreshProgress('swensen');
            if (progress.votes.swensen) return;
            // No supplies needed — this one is pure navigation.
            if (noteAttempt('swensen') > 25) {
                ctx.log('swensen: attempt cap reached, waiting');
                await ticks(30);
                return;
            }
            if (!inMaze()) {
                await talk(ctx, 'swensen', [/^yes$/i]);
                await go(ctx, [MAZE_LADDER], MAZE_LADDER);
                await sdk.scanNearbyLocs(10).catch(() => undefined);
                const down = (sdk.getNearbyLocs() ?? []).find(
                    (l) => /^ladder$/i.test(l.name ?? '') && (l.optionsWithIndex ?? []).some((o) => /climb-down/i.test(o.text))
                );
                if (!down) {
                    ctx.log(`swensen: no Climb-down ladder at ${here()} — house may need the door first`);
                    await ticks(10);
                    return;
                }
                await bot.interactLoc(down as never, /climb-down/i as never).catch(() => undefined);
                await ticks(6);
                ctx.log(`swensen: descended -> ${here()} (inMaze=${inMaze()})`);
            }
            await solveMaze(ctx);
            if (!(await checkpoint('swensen', "Navigator's vote"))) {
                ctx.log('swensen: vote line not in the journal yet — retrying');
                await ticks(10);
            }
        },
    },
    // -- Sigmund: merchant chain ---------------------------------------------------
    {
        id: 'sigmund',
        detect: () =>
            progress.started &&
            progress.votes.peer &&
            progress.votes.olaf &&
            progress.votes.sigli &&
            progress.votes.reveller &&
            progress.votes.swensen &&
            !progress.votes.sigmund,
        run: async (ctx) => {
            await refreshProgress('sigmund');
            if (progress.votes.sigmund) return;
            // The merchant chain needs exactly one thing from the bank: the 5000
            // coins Askeladden charges for his written promise. Demanding the
            // whole pack here just re-banked the fleece and the lyre it earned.
            await ensureItems(ctx, [{ pattern: COINS, count: 5_000, label: 'coins' }]);
            if (noteAttempt('sigmund') > 60) {
                ctx.log('sigmund: attempt cap reached, waiting');
                await ticks(30);
                return;
            }
            ctx.log(`sigmund: chain pass @${here()} coins=${count(COINS)}`);
            // Forward: advance every link's progress flag in chain order.
            await talk(ctx, 'sigmund', [/merchant/i, /^yes$/i]);
            // The chain is strictly ordered: each link only advances from the
            // previous link's flag (sailor -> olaf -> yrsa -> brundt -> sigli ->
            // skulgrimen -> fisherman -> swensen -> peer -> thorvald -> manni ->
            // barkeep), and Sigmund's own recital names the item he currently
            // wants — so after every link, ask him and read the flag back.
            for (const key of ['sailor', 'olaf', 'yrsa', 'brundt', 'sigli', 'skulgrimen', 'fisherman', 'swensen', 'peer', 'thorvald', 'manni_sober', 'barkeep'] as const) {
                // Manni the Reveller's menu is his drinking contest, and picking
                // the non-refusal fallback there answers "Yes" and starts a
                // rematch instead of taking the merchant option — so offer the
                // decline explicitly and retry the merchant branch.
                let reply = await talk(ctx, key, [/merchant/i]);
                const wants = (reply.match(/where I could find ([^"?]{4,80})/i)?.[1] ?? reply.replace(/\s+/g, ' ').slice(-120)).trim();
                ctx.log(`sigmund: link ${key} replied: ${wants}`);
            }
            // Askeladden's 5000-coin sale is inside his MERCHANT label
            // ([label,viking_askelapen_merchant], case sigmund_spoke_thora), so it
            // needs the merchant option — his main body is Olaf/pet-rock flavour.
            for (let i = 0; i < 4 && !hasChainGood(); i++) {
                const r = await talk(ctx, 'askeladden', [/merchant/i, /^yes$/i]);
                const said = (r.match(/[^|]{10,120}/g) ?? []).join(' / ').replace(/\s+/g, ' ').slice(-150);
                ctx.log(`sigmund: askeladden pass ${i + 1} — note=${count(PROMISSARY)} coins=${count(COINS)} said: ${said}`);
            }
            // Backward: trade each good up the chain.
            for (const key of ['barkeep', 'manni_sober', 'thorvald', 'peer', 'swensen', 'fisherman', 'skulgrimen', 'sigli', 'brundt', 'yrsa', 'olaf', 'sailor', 'sigmund'] as const) {
                if (progress.votes.sigmund) break;
                await talk(ctx, key, [/merchant/i]);
                const said = allText(sdk, 6).replace(/\s+/g, ' ').slice(-170);
                const held = (sdk.getInventory() ?? [])
                    .filter((i) => /note|cocktail|token|boots|ballad|song|flower|forecast|map|bowstring|fish/i.test(i.name ?? ''))
                    .map((i) => `${i.name}x${i.count}`)
                    .join(',');
                ctx.log(`sigmund: trade-back ${key} -> "${said}" holding[${held || 'nothing'}]`);
                scanVotes(ctx);
            }
            if (!(await checkpoint('sigmund', "Merchant's vote"))) {
                ctx.log('sigmund: vote line not in the journal yet — retrying');
                await ticks(10);
            }
        },
    },
    // -- Thorvald: Koschei, unarmed (AFTER the chain trade) -------------------------
    {
        id: 'thorvald',
        detect: () => progress.started && progress.votes.sigmund && !progress.votes.thorvald,
        run: async (ctx) => {
            await refreshProgress('thorvald');
            if (progress.votes.thorvald) return;
            if (noteAttempt('thorvald') > 20) {
                await ticks(30);
                return;
            }
            const snap = snapshotGear();
            // Talk first (accept) while geared, then bank EVERYTHING: the arena
            // refuses entry with any armour or weaponry (can_enter_thorvald_trial
            // checks both the bag and the worn slots).
            await talk(ctx, 'thorvald', [/^yes$/i, /become a fremennik/i]);
            await depositAll(ctx);
            await go(ctx, [NPC_ANCHOR.thorvald!], NPC_ANCHOR.thorvald!);
            await sdk.scanNearbyLocs(12).catch(() => undefined);
            // The arena ladder is op2 = Climb-down. It has NO op1 at all (its op3
            // is Climb-up), so the old op1 click silently did nothing and the
            // stage looped forever.
            const arenaLadder = (sdk.getNearbyLocs() ?? []).find(
                (l) => /^ladder$/i.test(l.name ?? '') && (l.optionsWithIndex ?? []).some((o) => /climb-down/i.test(o.text))
            );
            if (!arenaLadder) {
                ctx.log(
                    `thorvald: no Climb-down arena ladder @ ${here()} — locs: ${(sdk.getNearbyLocs() ?? []).map((l) => `${l.name}@${(l as { x?: number }).x},${(l as { z?: number }).z}`).join(' ; ')}`
                );
                await restoreGear(ctx, snap);
                await ticks(10);
                return;
            }
            ctx.log(`thorvald: entering the arena via Ladder@${(arenaLadder as { x?: number }).x},${(arenaLadder as { z?: number }).z} (Climb-down)`);
            await bot.interactLoc(arenaLadder as never, /climb-down/i as never).catch(() => undefined);
            await ticks(8);

            const deadline = Date.now() + 25 * 60_000;
            let sweep = 0;
            let reentries = 0;
            while (Date.now() < deadline) {
                scanVotes(ctx);
                if (progress.votes.thorvald) break;
                if (pos().isDead) {
                    // Honour-death also completes the trial (viking_honour_death),
                    // so wait it out and let the journal decide.
                    ctx.log('thorvald: died in the arena — waiting to respawn');
                    await waitUntil(() => !pos().isDead, 60_000);
                    continue;
                }
                // Knocked out of the arena (a loss or an honour-death teleports us
                // back to the hall, and honour-death ALSO completes the trial) —
                // check the journal, then go back down if the vote is not there yet.
                if (!inArena()) {
                    scanVotes(ctx);
                    if (progress.votes.thorvald) break;
                    if (++reentries > 6) {
                        ctx.log('thorvald: kicked out of the arena too often — leaving it for the next pass');
                        break;
                    }
                    ctx.log(`thorvald: outside the arena @${here()} — re-entering (${reentries})`);
                    await go(ctx, [NPC_ANCHOR.thorvald!], NPC_ANCHOR.thorvald!);
                    await sdk.scanNearbyLocs(12).catch(() => undefined);
                    const again = (sdk.getNearbyLocs() ?? []).find(
                        (l) => /^ladder$/i.test(l.name ?? '') && (l.optionsWithIndex ?? []).some((o) => /climb-down/i.test(o.text))
                    );
                    if (!again) {
                        await ticks(10);
                        continue;
                    }
                    await bot.interactLoc(again as never, /climb-down/i as never).catch(() => undefined);
                    await ticks(8);
                    continue;
                }
                const foe = sdk.findNearbyNpc(/koschei/i);
                if (foe) {
                    ctx.log(`thorvald: Koschei in reach @${here()} — attacking`);
                    await bot.attack(foe as never).catch(() => undefined);
                    await waitUntil(() => progress.votes.thorvald || sdk.findNearbyNpc(/koschei/i) !== foe, 30_000);
                    await ticks(4);
                    continue;
                }
                // Koschei spawns at a RANDOM spot ("Explore this battleground and
                // find your foe"), so sweep the arena instead of standing still.
                const p = pos();
                const spots = [
                    { x: 2655, z: 10098 }, { x: 2668, z: 10098 }, { x: 2658, z: 10105 }, { x: 2666, z: 10105 },
                    { x: p.x + 10, z: p.z }, { x: p.x - 10, z: p.z }, { x: p.x, z: p.z + 10 }, { x: p.x, z: p.z - 10 },
                ];
                const dest = spots[sweep++ % spots.length]!;
                ctx.log(`thorvald: no foe in scan @${here()} — sweeping to ${dest.x},${dest.z}`);
                await go(ctx, [dest], dest);
                await ticks(5);
            }
            if (!(await checkpoint('thorvald', "Warrior's vote"))) {
                ctx.log('thorvald: vote line not in the journal yet — retrying');
                await ticks(10);
            }
            await restoreGear(ctx, snap);
        },
    },
    // -- Finish: Brundt completes at 7 votes ---------------------------------------
    {
        id: 'finish',
        // `!progress.complete` matters: checkpoint() now sets the flag on PASS, so
        // without it the loop re-selects this stage every pass and the run never
        // reaches its promotion gate.
        detect: () => progress.started && voteCount() >= 7 && !progress.complete,
        run: async (ctx) => {
            await talk(ctx, 'brundt');
            const done = await checkpoint('complete', 'journal reports QUEST COMPLETE');
            if (done) {
                // End the run here (see the detect comment: without this the stage
                // re-passes every loop). Report the promotion gate HERE too: the
                // loop's own exit path parks at a bank and returns 'drained', which
                // skips the gate block in main.
                const summary = summarizeRun(run.directory);
                log(
                    summary.ok
                        ? 'promotion gate: PASS — every required checkpoint is on the run record'
                        : `promotion gate: missing/unpassed ${JSON.stringify(summary.missing)}`
                );
                log('DONE Fremennik Trials verified via the quest journal');
                session.stop('done', 'fremennik-trials complete', { restartable: false });
                // Exit for real. Stopping the session alone left the loop spinning
                // (`no stage matched` ×210 — the finish stage's detect is false once
                // complete and nothing else matches), so the process had to be
                // SIGTERMed. Same shape as the other terminal paths in this script.
                await session.finalizeStop().catch(() => undefined);
                await sdk.disconnect().catch(() => undefined);
                process.exit(0);
            }
        },
    },
];

// Transport guard for every stage: a dead control channel must pause the run,
// not throw "Not connected" once per pass (questLoop catches and re-loops with
// no delay, which spammed 260 passes in two minutes and burned the recovery
// budget before anything could reconnect).
for (const stage of stages) {
    const inner = stage.run;
    stage.run = async (ctx) => {
        if (!sdk.isConnected()) {
            log(`${stage.id}: controller down — waiting for reconnect before acting`);
            const back = await waitUntil(() => sdk.isConnected(), 180_000);
            if (!back) log(`${stage.id}: controller still down after 3 minutes`);
            return;
        }
        await inner(ctx);
    };
}

// ---------------------------------------------------------------------------
// Riddle + Peer puzzle + Draugen hunt + maze explorer.
// ---------------------------------------------------------------------------

/** Riddle first lines -> dial word, quoted from viking_seer_read_riddle cases 0..5. */
const RIDDLES: Array<{ re: RegExp; word: string }> = [
    { re: /first is in mage, but not in wizard/i, word: 'MIND' },
    { re: /first is in tar, but not in a swamp/i, word: 'TREE' },
    { re: /first is in the well, but not at sea/i, word: 'LIFE' },
    { re: /first is in fish, but not in the sea/i, word: 'FIRE' },
    { re: /first is in water, and also in tea/i, word: 'TIME' },
    { re: /first is in wizard, but not in a mage/i, word: 'WIND' },
];

/** Recent chat straight from player state (visibleText's getChat path misses these). */
function chatText(n = 30): string {
    const msgs = (sdk.getState()?.gameMessages ?? []) as Array<{ text?: string }>;
    return msgs.slice(-n).map((m) => m.text ?? '').join(' | ');
}


/** Approach a tile without a ctx (used by the plane and loc helpers). */
async function approachTile(dest: Tile): Promise<void> {
    await approach(dest);
}

/**
 * Change plane through the nearest ladder/trapdoor. Peer's puzzle room is
 * plane 2 (Ladder@2631,3663 inside the house; the way back down is the
 * Trapdoor@2631,3663 on plane 2), so plane work is a first-class step.
 */
async function ensurePlane(target: number, ctx: QuestContext, prefer?: { x: number; z: number }): Promise<boolean> {
    for (let round = 0; round < 6; round++) {
        if (pos().level === target) return true;
        await sdk.scanNearbyLocs(14).catch(() => undefined);
        const goingUp = target > pos().level;
        const want = goingUp ? /climb[- ]up|open/i : /climb[- ]down/i;
        const candidates = (sdk.getNearbyLocs() ?? []).filter(
            (l) => /ladder|trapdoor|staircase/i.test(l.name ?? '') && (l.optionsWithIndex ?? []).some((o) => want.test(o.text))
        );
        const loc = prefer
            ? (candidates.find((l) => Math.abs((l.x ?? 0) - prefer.x) <= 1 && Math.abs((l.z ?? 0) - prefer.z) <= 1) ?? candidates[0])
            : candidates[0];
        if (!loc) {
            ctx.log(`plane: no ${goingUp ? 'upward' : 'downward'} route from plane ${pos().level} @ ${here()}`);
            return false;
        }
        await approachTile({ x: loc.x ?? 0, z: loc.z ?? 0 });
        const r = await bot.interactLoc(loc as never, want as never).catch(() => undefined);
        void r;
        await ticks(6);
        ctx.log(`plane: ${goingUp ? 'up' : 'down'} via ${loc.name}@${loc.x},${loc.z} -> ${here()}`);
    }
    ctx.log(`plane: could not reach plane ${target} (at ${here()})`);
    return pos().level === target;
}

/**
 * Stand within 2 tiles of a loc — and on its own approach side. Peer's chests,
 * cupboard and mounted heads are all `forceapproach=north` in viking.loc, so a
 * click from the south answers "Nothing happened interacting with Chest" and
 * looks like a dead loc.
 */
async function approachLoc(loc: unknown): Promise<void> {
    const l = loc as { x?: number; z?: number };
    if (typeof l.x !== 'number' || typeof l.z !== 'number') return;
    const p = pos();
    if (cheb(p, { x: l.x, z: l.z }) <= 2 && p.z >= l.z) return;
    // Try each neighbouring tile: these rooms have walls and furniture, so the
    // first candidate is often blocked and the click then dies with
    // "Cannot reach <loc>" even though the loc is right there.
    const sides: Array<{ x: number; z: number }> = [
        { x: l.x, z: l.z + 1 },
        { x: l.x - 1, z: l.z },
        { x: l.x + 1, z: l.z },
        { x: l.x, z: l.z - 1 },
    ];
    for (const side of sides) {
        await approachTile(side);
        if (cheb(pos(), { x: l.x, z: l.z }) <= 2) return;
    }
}

/** Find a loc by name AND option (decoys share names), then use it. */
async function interactByName(ctx: QuestContext, locRe: RegExp, optionRe: RegExp, label: string): Promise<boolean> {
    await sdk.scanNearbyLocs(14).catch(() => undefined);
    const hits = (sdk.getNearbyLocs() ?? []).filter(
        (l) => locRe.test(l.name ?? '') && (l.optionsWithIndex ?? []).length > 0
    );
    const withOpt = hits.filter((l) => (l.optionsWithIndex ?? []).some((o) => optionRe.test(o.text)));
    const loc = withOpt[0] ?? hits[0];
    if (!loc) {
        ctx.log(`${label}: no ${String(locRe)} nearby @ ${here()}`);
        return false;
    }
    await approachLoc(loc);
    const opt = (loc.optionsWithIndex ?? []).find((o) => optionRe.test(o.text)) ?? (loc.optionsWithIndex ?? [])[0];
    if (!opt) {
        ctx.log(`${label}: ${loc.name}@${loc.x},${loc.z} has no matching option`);
        return false;
    }
    const r = await bot.interactLoc(loc as never, optionRe as never).catch((e: unknown) => ({ success: false, message: String(e) }));
    ctx.log(`${label}: ${opt.text} on ${loc.name}@${loc.x},${loc.z} -> ${(r as { success?: boolean }).success} ${(r as { message?: string }).message ?? ''} inv=[${sdk
        .getInventory()
        .filter((i) => (i.count ?? 0) > 0)
        .map((i) => i.name)
        .join(',')}]`);
    await ticks(3);
    return !!(r as { success?: boolean }).success;
}

/** Use an item on a specific loc, approaching it first. */
async function useOnLocAt(ctx: QuestContext, itemRe: RegExp, loc: unknown): Promise<boolean> {
    await approachLoc(loc);
    const r = await bot.useItemOnLoc(itemRe, loc as never, { timeout: 15_000 } as never).catch((e: unknown) => ({ success: false, message: String(e) }));
    if (!(r as { success?: boolean }).success) {
        const l = loc as { name?: string; x?: number; z?: number };
        ctx.log(`useOnLocAt ${String(itemRe)} on ${l.name}@${l.x},${l.z}: ${(r as { message?: string }).message ?? 'failed'} @ ${here()}`);
    }
    await ticks(3);
    return !!(r as { success?: boolean }).success;
}

/** Mesbox text: the client publishes it in dialog.allComponents, not dialog.text. */
function dialogText(): string {
    const d = sdk.getDialog();
    const bits: string[] = [];
    for (const c of (d?.allComponents ?? []) as Array<{ text?: string }>) if (c.text) bits.push(c.text);
    return bits.join(' | ');
}

const SEER_DOOR = { x: 2631, z: 3667 }; // combination door (entrance/exit of the pocket room)
const SEER_EXIT_DOOR = { x: 2636, z: 3667 }; // viking_seers_door2: only the Seers' key opens it

/**
 * Click the seer door from the NORTH until we are through it. The scan sees the
 * room's locs through the wall from outside, so entry is proven by crossing the
 * door line (an open door steps the player from z=3667 to z=3666); clicking it
 * from inside answers with the "you will fail this trial" page instead.
 */
async function enterSeerHouse(ctx: QuestContext, door: unknown): Promise<boolean> {
    for (let round = 0; round < 4; round++) {
        if (pos().z <= SEER_DOOR.z - 1) {
            ctx.log(`peer: inside the seer house @ ${here()}`);
            return true;
        }
        await approach({ x: SEER_DOOR.x, z: SEER_DOOR.z + 2 });
        await sdk.scanNearbyLocs(12).catch(() => undefined);
        const d = (sdk.getNearbyLocs() ?? []).find(
            (l) => /^door$/i.test(l.name ?? '') && Math.abs((l.x ?? 0) - SEER_DOOR.x) <= 1 && Math.abs((l.z ?? 0) - SEER_DOOR.z) <= 1
        );
        await bot.interactLoc((d ?? door) as never, /open/i as never).catch(() => undefined);
        await ticks(5);
        const dlg = sdk.getDialog();
        if (dlg?.isOpen) {
            const cont = (dlg.options ?? []).find((o) => /click here to continue/i.test(o.text));
            const opts = (dlg.options ?? []).map((o) => o.text).join('|');
            ctx.log(`peer: door dialog [${opts}]`);
            if (cont) {
                await sdk.sendClickDialog(cont.index).catch(() => undefined);
                await ticks(5);
            }
        }
    }
    ctx.log(`peer: could not get through the seer door @ ${here()}`);
    return false;
}

/**
 * The Seer's combination-lock door (viking_seers_door1 at 2631,3667):
 * click door -> plaque page -> "Read the riddle" -> two mesbox pages (the
 * riddle) -> combolockdoor interface. Dial letters read live from the
 * interface, then the dials are stepped up to the answer word and ENTER is
 * clicked. Component ids come from the interface's own base: the `.if` file
 * numbers them com_43..com_57 and the client publishes them offset by
 * interfaceId + 1 (verified against a live dump, not guessed).
 */
async function seerRiddle(ctx: QuestContext): Promise<boolean> {
    await approach({ x: SEER_DOOR.x, z: SEER_DOOR.z + 1 }); // north side = entering
    await sdk.scanNearbyLocs(10).catch(() => undefined);
    const door = (sdk.getNearbyLocs() ?? []).find(
        (l) => /^door$/i.test(l.name ?? '') && Math.abs((l.x ?? 0) - SEER_DOOR.x) <= 1 && Math.abs((l.z ?? 0) - SEER_DOOR.z) <= 1
    );
    if (!door) {
        ctx.log(`peer: seer door not found @ ${here()}`);
        return false;
    }
    const before = pos();
    await bot.interactLoc(door as never, 1 as never).catch(() => undefined);
    await ticks(3);
    // Page 1 is the plaque blurb; the menu sits behind it. Stop the moment the
    // riddle menu is clicked: the pages AFTER it are the riddle, and clicking
    // them here silently swallows the text (the first version did exactly that
    // and reported UNREAD).
    let clicked = false;
    for (let page = 0; page < 6 && !clicked; page++) {
        if (!sdk.getDialog()?.isOpen) {
            await ticks(2);
            if (!sdk.getDialog()?.isOpen) break;
        }
        const opts = sdk.getDialog()?.options ?? [];
        const read = opts.find((o) => /read the riddle/i.test(o.text));
        if (read) {
            ctx.log(`dialog -> ${read.text}`);
            await sdk.sendClickDialog(read.index).catch(() => undefined);
            clicked = true;
            break;
        }
        const cont = opts.find((o) => /click here to continue/i.test(o.text));
        if (!cont) break;
        await sdk.sendClickDialog(cont.index).catch(() => undefined);
        await ticks(3);
    }
    if (!clicked) {
        // No riddle menu: the riddle is already solved (peer_completed_riddle),
        // so opening the door just walks in. Prove it by the room's own locs.
        ctx.log(`peer: no riddle menu @ ${here()} — treating the riddle as already solved`);
        await ticks(4);
        return enterSeerHouse(ctx, door);
    }
    // The menu page lingers for a tick or two after the click: wait until the
    // published page is NOT the menu before reading, or the reader captures
    // "What would you like to do?" and calls the riddle unread.
    for (let wait = 0; wait < 8; wait++) {
        const d = sdk.getDialog();
        const opts = d?.options ?? [];
        const stillMenu = opts.some((o) => /read the riddle|solve the riddle|forget it/i.test(o.text));
        if (d?.isOpen && !stillMenu) break;
        await ticks(2);
    }
    // Riddle mesbox pages: text lives in dialog.allComponents.
    let text = '';
    for (let page = 0; page < 6; page++) {
        if (!sdk.getDialog()?.isOpen) {
            await ticks(2);
            if (!sdk.getDialog()?.isOpen) {
                if (text) break;
                continue;
            }
        }
        const page_text = dialogText();
        if (page_text && !/what would you like to do/i.test(page_text)) text += ` ${page_text}`;
        const cont = (sdk.getDialog()?.options ?? []).find((o) => /click here to continue/i.test(o.text));
        if (!cont) break;
        await sdk.sendClickDialog(cont.index).catch(() => undefined);
        await ticks(3);
    }
    const hit = RIDDLES.find((r) => r.re.test(text));
    ctx.log(`peer riddle: ${hit?.word ?? 'UNREAD'} :: ${text.replace(/Click here to continue/g, '').trim().slice(0, 180)}`);
    if (!hit) return false;

    await waitUntil(() => !!sdk.getState()?.interface?.isOpen, 6_000);
    const ifaceId = sdk.getState()?.interface?.interfaceId ?? -1;
    if (ifaceId < 0) {
        ctx.log('peer: combination-lock interface never opened');
        return false;
    }
    const base = ifaceId + 1;
    // REVISION DUMP: the component offsets below came from a LOCAL interface
    // dump; the live combo-lock evidently differs (dials read back GJSE for
    // FIRE and the submit answers solved=false). Publish what the client
    // actually sends so the real ids can be derived from evidence.
    const ifaceComps = (): Array<{ componentId: number; text?: string }> =>
        ((sdk.getState()?.interface as unknown as Record<string, unknown> | undefined)?.textComponents ??
            []) as Array<{ componentId: number; text?: string }>;
    {
        const raw = sdk.getState()?.interface as unknown as Record<string, unknown> | undefined;
        ctx.log(`peer dump: ifaceId=${ifaceId} base=${base} keys=${Object.keys(raw ?? {}).join(',')}`);
        const comps = ifaceComps();
        ctx.log(`peer dump: textComponents=${comps.length}`);
        for (const c of comps.slice(0, 45)) {
            ctx.log(
                `peer dump: com off=${c.componentId - base} id=${c.componentId} text=${JSON.stringify((c.text ?? '').slice(0, 20))}`
            );
        }
    }
    const letters = () => {
        const comps = (sdk.getState()?.interface as unknown as { textComponents?: Array<{ componentId: number; text?: string }> } | undefined)?.textComponents ?? [];
        return [0, 1, 2, 3].map((i) => (comps.find((c) => c.componentId === base + 43 + i)?.text ?? 'A').trim().toUpperCase());
    };
    ctx.log(`peer dials before: ${letters().join('')}`);
    // Step a dial once and do not return until the read has actually moved.
    // A fixed 1-tick wait counts a stale read over a slow link and overshoots.
    const stepDial = async (i: number): Promise<void> => {
        const was = (letters()[i] ?? 'A').toUpperCase();
        await sdk.sendClickComponent(base + 48 + 2 * i).catch(() => undefined);
        for (let w = 0; w < 8; w++) {
            await ticks(1);
            if ((letters()[i] ?? 'A').toUpperCase() !== was) return;
        }
    };
    for (let i = 0; i < 4; i++) {
        const target = hit.word[i]!.toUpperCase();
        for (let guard = 0; guard < 40; guard++) {
            if ((letters()[i] ?? 'A').toUpperCase() === target) break;
            await stepDial(i);
        }
        const landed = (letters()[i] ?? 'A').toUpperCase();
        if (landed !== target) ctx.log(`peer dial ${i}: ${landed} != ${target}`);
    }
    ctx.log(`peer dial set: ${letters().join('')} (want ${hit.word})`);
    // ENTER is located by its own label, never by a guessed offset: the live
    // layout puts it at base+58 where the local dump had base+57.
    // ENTER: "E N T E R" is only the LABEL (offset 58) and clicking it is a
    // no-op — live it produced 'NO ANSWER' for 25s. The clickable button has no
    // text of its own and sits at offset 57, which DID draw a chat verdict when
    // the dials were still wrong. Try the button, then the label and its
    // neighbour, and stop at the first chat verdict.
    const labelId = ifaceComps().find((c) => /enter/i.test(c.text ?? ''))?.componentId ?? base + 58;
    const enterCandidates = [base + 57, labelId, labelId - 1].filter(
        (v, i, a) => a.indexOf(v) === i
    );
    let verdict = false;
    for (const id of enterCandidates) {
        ctx.log(`peer enter: clicking id=${id} (off=${id - base})`);
        await sdk.sendClickComponent(id).catch(() => undefined);
        verdict = await waitUntil(
            () => /solved the riddle|failed to solve the riddle/i.test(chatText(20)),
            20_000
        );
        if (verdict) break;
    }
    // The solve verdict is a chat line; give it a generous window and read the
    // player's own message ring (visibleText's chat path is not this one).
    const solved = /solved the riddle!/i.test(chatText(8)) && !/failed to solve/i.test(chatText(4));
    ctx.log(`peer: lock submit → ${verdict ? 'chat answered' : 'NO ANSWER'} solved=${solved}`);
    await bot.closeInterface().catch(() => undefined);
    if (!solved) return false;
    // Walk through the now-unlocked door into the puzzle room.
    return enterSeerHouse(ctx, door);
}

/**
 * Peer's puzzle room — verified live on 2026-10-18: the room is plane 2, up the
 * ladder at 2631,3663 inside the house, and the abstract mural stays on plane 0
 * downstairs. Loc inventory on plane 2 (name@x,z [options]):
 *   Bookcase@2634,3665 [Search]      -> red herring
 *   Chest@2632,3665 [Open] (op2)     -> empty jug   (jug with "3" painted)
 *   Cupboard@2629,3660 [Open] (op2)  -> empty bucket ("5" painted)
 *   Unicorn's head@2632,3660 [Study] -> red disk
 *   Bull's head@2634,3660 [Study]    -> wooden disk
 *   Tap@2629,3661 / Drain@2629,3662  -> fill / empty jug+bucket+vase
 *   Cooking range@2629,3663          -> red herring -> sticky red goop; key-in-ice -> key
 *   Frozen table@2638,3665           -> sealed vase -> key in ice
 *   Chest (scales)@2635,3660         -> bucket_4 on the scale -> vase
 *   Boxes/Crate                      -> decoys (magnet, thread, pick, toy ship)
 * Crate/boxes/chest locs are only edible while the twisty bits are missing, so
 * every step is gated on the ITEM it should have produced.
 */
/**
 * Descend into the mural room. Only the EASTERN trapdoor (2636,3663) lands
 * there — and it is a closed trapdoor whose single op is "Open", so a plain
 * "find a Climb-down" search picks the western one and drops into the pocket.
 */
async function descendToMuralRoom(ctx: QuestContext): Promise<boolean> {
    if (pos().level === 0 && pos().x >= 2634) return true;
    if (pos().level !== 2) {
        if (!(await planeChangeFree(2))) return false;
    }
    for (let round = 0; round < 5; round++) {
        await sdk.scanNearbyLocs(14).catch(() => undefined);
        const trap = (sdk.getNearbyLocs() ?? []).find(
            (l) => /trapdoor/i.test(l.name ?? '') && Math.abs((l.x ?? 0) - 2636) <= 1 && Math.abs((l.z ?? 0) - 3663) <= 1
        );
        if (!trap) {
            ctx.log(`mural room: eastern trapdoor not visible from ${here()}`);
            return false;
        }
        const opts = trap.optionsWithIndex ?? [];
        await approachLoc(trap);
        if (opts.some((o) => /^open$/i.test(o.text))) {
            await bot.interactLoc(trap as never, /^open$/i as never).catch(() => undefined);
            await ticks(5);
            continue;
        }
        if (opts.some((o) => /climb[- ]down/i.test(o.text))) {
            await bot.interactLoc(trap as never, /climb[- ]down/i as never).catch(() => undefined);
            await ticks(8);
            await sdk.scanNearbyLocs(14).catch(() => undefined);
            if (pos().level === 0) {
                ctx.log(`mural room: came down the eastern trapdoor @ ${here()}`);
                return true;
            }
        }
    }
    ctx.log(`mural room: could not descend the eastern trapdoor @ ${here()}`);
    return false;
}

async function peerPuzzle(ctx: QuestContext): Promise<boolean> {
    const have = (re: RegExp) => count(re) > 0;
    // Step 0: get into the house (plane 0) and up to the puzzle room.
    if (pos().level === 0) {
        // The stage's seerRiddle already solved the lock and stepped inside.
        if (!(await ensurePlane(2, ctx))) return false;
    } else if (pos().level !== 2) {
        ctx.log(`peer: unexpected plane ${pos().level} in the seer house`);
        return false;
    }
    ctx.log(`peer: puzzle room (plane ${pos().level}) @ ${here()}`);

    // Dismiss any modal an interaction opened. The Seer's room hands out its
    // items through ~mesbox pages (viking_peer.rs2: the unicorn head runs
    // `~mesbox("You notice there is something unusual about the left eye...")`
    // and only THEN inv_add(viking_red_wooden_coin) — the disk arrives when the
    // page is dismissed). A pick loop that immediately clicks the loc again
    // clicks the modal instead and never receives the item, which is why the
    // local run only ever succeeded on its SECOND attempt and the live run
    // never succeeded at all.
    const pumpModals = async (label: string): Promise<void> => {
        for (let round = 0; round < 8; round++) {
            const d = sdk.getDialog();
            if (!d?.isOpen) return;
            const text = dialogText();
            if (text) ctx.log(`${label}: modal ${JSON.stringify(text.replace(/\s+/g, ' ').slice(0, 130))}`);
            const opts = d.options ?? [];
            const cont =
                opts.find((o) => /click here to continue/i.test(o.text)) ??
                opts.find((o) => /continue/i.test(o.text)) ??
                opts[0];
            if (!cont) return;
            await sdk.sendClickDialog(cont.index).catch(() => undefined);
            await ticks(3);
        }
    };

    // Step 1: collect the room items (each gated on its own item).
    const grabs: Array<{ item: RegExp; loc: RegExp; option: RegExp; label: string }> = [
        { item: RED_HERRING, loc: /^bookcase$/i, option: /search/i, label: 'red herring' },
        { item: JUG_EMPTY, loc: /^chest$/i, option: /open/i, label: 'empty jug' },
        { item: BUCKET_EMPTY, loc: /^cupboard$/i, option: /open/i, label: 'empty bucket' },
        { item: RED_DISK, loc: /unicorn'?s head/i, option: /study/i, label: 'red disk' },
        { item: WOOD_DISK, loc: /bull'?s head/i, option: /study/i, label: 'wooden disk' },
    ];
    for (const g of grabs) {
        if (have(g.item)) continue;
        for (let attempt = 0; attempt < 5 && !have(g.item); attempt++) {
            ctx.log(
                `${g.label}: attempt ${attempt + 1} @ ${here()} inv=[${sdk
                    .getInventory()
                    .filter((i) => (i.count ?? 0) > 0)
                    .map((i) => `${i.name}x${i.count}`)
                    .join(',')}]`
            );
            await sdk.scanNearbyLocs(14).catch(() => undefined);
            const cands = (sdk.getNearbyLocs() ?? []).filter(
                (l) => g.loc.test(l.name ?? '') && (l.optionsWithIndex ?? []).length > 0
            );
            if (!cands.length) {
                ctx.log(`${g.label}: no ${String(g.loc)} with options nearby @ ${here()}`);
                break;
            }
            // Chests and cupboards only offer Search once they are open, and the
            // room holds a DECORATIVE chest (2632,3665) that answers every click
            // with no state change at all — so rotate the candidates instead of
            // hammering the first one (the jug chest is 2635,3660).
            const searchable = cands.find((l) => (l.optionsWithIndex ?? []).some((o) => /search/i.test(o.text)));
            const pool = searchable ? [searchable, ...cands.filter((c) => c !== searchable)] : [...cands];
            const target = pool[attempt % pool.length]!;
            const opts = target.optionsWithIndex ?? [];
            const opt = opts.find((o) => /search/i.test(o.text)) ?? opts.find((o) => /open/i.test(o.text)) ?? opts[0]!;
            ctx.log(`${g.label}: attempt ${attempt + 1} target ${target.name}@${target.x},${target.z} [${opts.map((o) => o.text).join('|')}] -> ${opt.text}`);
            await approachLoc(target);
            const r = await bot
                .interactLoc(target as never, new RegExp(`^${opt.text}$`, 'i') as never)
                .catch((e: unknown) => ({ success: false, message: String(e) }));
            ctx.log(
                `${g.label}: attempt ${attempt + 1} interact ${opt.text} on ${target.name}@${target.x},${target.z} -> ` +
                    `${(r as { success?: boolean }).success} ${(r as { message?: string }).message ?? ''} inv=[${sdk
                        .getInventory()
                        .filter((i) => (i.count ?? 0) > 0)
                        .map((i) => i.name)
                        .join(',')}]`
            );
            await ticks(3);
            await pumpModals(g.label);
            await ticks(1);
        }
        if (!have(g.item)) {
            // Decoys and already-placed items both land here: a head whose coin
            // is already on the mural answers "there is a hole where an eye
            // should be", and the bookcase stops giving herrings once
            // seerdoor_reddisk_2 is set. Treat it as done, not as a failure.
            ctx.log(`peer: no ${g.label} this pass (already placed, or taken) — continuing`);
            continue;
        }
        ctx.log(`peer: took ${g.label}`);
    }

    // Step 2: cook the herring into goop and paint the wooden disk red. Gated on
    // an unpainted disk, NOT on "no red disk" — the unicorn head already gave us
    // one red disk, and gating on that skipped the whole painting step.
    if (have(WOOD_DISK) || have(GOOP) || have(RED_HERRING)) {
        if (have(RED_HERRING)) await useOnLoc(ctx, RED_HERRING, /cooking range/i);
        if (have(GOOP) && have(WOOD_DISK)) await combine(ctx, GOOP, WOOD_DISK);
        if (have(GOOP) && have(WOOD_DISK)) await combine(ctx, GOOP, WOOD_DISK);
    }
    ctx.log(`peer: disks — red=${count(RED_DISK)} goop=${count(GOOP)} wood=${count(WOOD_DISK)}`);

    // Step 3: water arithmetic — the exact pour matrix from
    // viking_peer.rs2 [opheldu,*] handlers, i.e. the walkthrough's route:
    //   bucket on tap -> 5/5  ·  5/5 on empty jug -> bucket 2/5 + jug full
    //   jug on drain -> jug empty  ·  2/5 bucket on empty jug -> bucket empty + jug 2/3
    //   bucket on tap -> 5/5  ·  5/5 on 2/3 jug -> bucket 4/5 + jug full
    //   4/5 bucket on the scales chest -> vase
    // The old code poured jug-first and never produced a 4/5 bucket at all.
    if (!have(VASE) && !have(SEALED_WATER) && !have(FROZEN_KEY) && !have(SEER_KEY) && !have(BUCKET4)) {
        for (let cycle = 0; cycle < 12 && !have(BUCKET4); cycle++) {
            const before = `${count(BUCKET_EMPTY)}/${count(BUCKET1)}/${count(BUCKET2)}/${count(BUCKET3)}/${count(BUCKET4)}/${count(BUCKET5)} jug ${count(JUG_EMPTY)}/${count(JUG1)}/${count(JUG2)}/${count(JUG3)}`;
            if (have(BUCKET_EMPTY)) await useOnLoc(ctx, BUCKET_EMPTY, /^tap$/i);
            else if (have(BUCKET5) && have(JUG_EMPTY)) await combine(ctx, BUCKET5, JUG_EMPTY);
            else if (have(JUG3)) await useOnLoc(ctx, JUG3, /^drain$/i);
            else if (have(BUCKET2) && have(JUG_EMPTY)) await combine(ctx, BUCKET2, JUG_EMPTY);
            else if (have(BUCKET5) && have(JUG2)) await combine(ctx, BUCKET5, JUG2);
            else if (have(BUCKET4)) break;
            else {
                ctx.log(`peer water: nothing applicable (bucket=${before}) — recollecting containers`);
                if (!have(BUCKET_EMPTY) && !have(BUCKET1) && !have(JUG_EMPTY)) await interactByName(ctx, /^cupboard$/i, /open|search/i, 'empty bucket');
                if (!have(JUG_EMPTY) && !have(JUG2)) await interactByName(ctx, /^chest$/i, /open|search/i, 'empty jug');
            }
            await ticks(3);
            const after = `${count(BUCKET_EMPTY)}/${count(BUCKET1)}/${count(BUCKET2)}/${count(BUCKET3)}/${count(BUCKET4)}/${count(BUCKET5)} jug ${count(JUG_EMPTY)}/${count(JUG1)}/${count(JUG2)}/${count(JUG3)}`;
            if (before !== after) ctx.log(`peer water: ${before} -> ${after}`);
        }
        if (have(BUCKET4)) {
            ctx.log('peer: bucket_4 ready — balancing the scales chest');
            for (const chest of (sdk.getNearbyLocs() ?? []).filter((l) => /^chest$/i.test(l.name ?? ''))) {
                await useOnLocAt(ctx, BUCKET4, chest);
                if (have(VASE)) break;
            }
            ctx.log(`peer: vase=${count(VASE)}`);
        } else {
            ctx.log('peer water: could not reach a 4/5ths bucket this pass');
        }
    }

    // Step 4: the mural (plane 0) takes both red disks and gives the vase lid.
    if (!have(VASE_LID) && !have(SEALED_WATER) && !have(FROZEN_KEY) && !have(SEER_KEY)) {
        // Descend through the EASTERN trapdoor (2636,3663): the western one
        // (2631,3663) drops into a pocket walled off from the mural, where every
        // click answers "I can't reach that!" even from the adjacent tile.
        if (!(await descendToMuralRoom(ctx))) return false;
        // Clicking the mural also RETURNS the vase lid once both disks are in
        // place, so a pass that banked the lid can always get it back.
        if (count(VASE_LID) === 0 && count(SEALED_WATER) === 0 && count(SEER_KEY) === 0) {
            await interactByName(ctx, /abstract mural/i, /study/i, 'mural lid');
        }
        for (let attempt = 0; attempt < 6 && count(RED_DISK) > 0; attempt++) {
            const before = count(RED_DISK);
            await useOnLoc(ctx, RED_DISK, /abstract mural/i);
            await ticks(4);
            await sdk.scanNearbyLocs(12).catch(() => undefined);
            ctx.log(`murals: attempt ${attempt + 1} disks ${before} -> ${count(RED_DISK)} lid=${count(VASE_LID)} @ ${here()}`);
            if (count(RED_DISK) === 0) break;
            if (count(RED_DISK) === before && attempt >= 1) {
                // The trapdoor drop can land us where the mural is visible in the
                // scan but not clickable; the front door entry is the known-good
                // position in this room.
                ctx.log('murals: still unreachable — going back up and down the EASTERN trapdoor');
                await ensurePlane(2, ctx);
                await descendToMuralRoom(ctx);
            }
        }
    }

    // Step 5: seal the vase and freeze/melt it for the key.
    if (!have(SEER_KEY) && !have(FROZEN_KEY)) {
        if (!(await ensurePlane(2, ctx))) return false;
        if (have(VASE)) {
            await useOnLoc(ctx, VASE, /^tap$/i);
            if (!have(VASE_WATER) && have(JUG3)) await combine(ctx, JUG3, VASE);
            if (!have(VASE_WATER) && have(BUCKET3)) await combine(ctx, BUCKET3, VASE);
            if (!have(VASE_WATER) && have(BUCKET4)) await combine(ctx, BUCKET4, VASE);
        }
        if (have(VASE_WATER) && have(VASE_LID)) await combine(ctx, VASE_LID, VASE_WATER);
        if (have(SEALED_WATER)) await useOnLoc(ctx, SEALED_WATER, /frozen table/i);
        if (have(FROZEN_KEY)) await useOnLoc(ctx, FROZEN_KEY, /cooking range/i);
    }
    ctx.log(
        `peer: state vase=${count(VASE)} water=${count(VASE_WATER)} lid=${count(VASE_LID)} sealed=${count(SEALED_WATER)} ice=${count(FROZEN_KEY)} key=${count(SEER_KEY)} inv=[${sdk
            .getInventory()
            .filter((i) => (i.count ?? 0) > 0)
            .map((i) => i.name)
            .join(',')}]`
    );
    if (!have(SEER_KEY)) return false;

    // Step 6: down to plane 0 and unlock the exit door with the key.
    // Descend into the MURAL room and unlock viking_seers_door2 at 2636,3667.
    // It must be this door: clicking the combination door at 2631,3667 from
    // inside runs its leave branch, which CLEARS every peer trial item (the
    // Seers' key included) and fails the step with the key already earned.
    if (!(await descendToMuralRoom(ctx))) return false;
    ctx.log(`peer: unlocking the exit door with the seers key (key=${count(SEER_KEY)})`);
    for (let round = 0; round < 5 && count(SEER_KEY) > 0; round++) {
        await sdk.scanNearbyLocs(12).catch(() => undefined);
        const door = (sdk.getNearbyLocs() ?? []).find(
            (l) =>
                /^door$/i.test(l.name ?? '') &&
                Math.abs((l.x ?? 0) - SEER_EXIT_DOOR.x) <= 1 &&
                Math.abs((l.z ?? 0) - SEER_EXIT_DOOR.z) <= 1
        );
        if (!door) {
            ctx.log(`peer: exit door ${SEER_EXIT_DOOR.x},${SEER_EXIT_DOOR.z} not in scan @ ${here()}`);
            await ticks(3);
            continue;
        }
        await approachLoc(door);
        // carrying the key makes the door's own op unlock it; using the key on
        // it is the belt-and-braces path the content also accepts
        await useOnLocAt(ctx, SEER_KEY, door);
        await bot.interactLoc(door as never, /open/i as never).catch(() => undefined);
        await ticks(5);
    }
    ctx.log(`peer: exit door attempt done — key=${count(SEER_KEY)} @ ${here()}`);
    return true;
}

const DIRS: Record<string, { dx: number; dz: number }> = {
    north: { dx: 0, dz: 1 },
    south: { dx: 0, dz: -1 },
    east: { dx: 1, dz: 0 },
    west: { dx: -1, dz: 0 },
    'north-east': { dx: 1, dz: 1 },
    'north-west': { dx: -1, dz: 1 },
    'south-east': { dx: 1, dz: -1 },
    'south-west': { dx: -1, dz: -1 },
};

/** Butterfly spots from spawn_draugen_butterfly (world = map*64+local). */
const BUTTERFLIES: Tile[] = [
    { x: 2712, z: 3712 },
    { x: 2688, z: 3572 },
    { x: 2720, z: 3616 },
    { x: 2656, z: 3616 },
    { x: 2720, z: 3680 },
];

async function huntDraugen(ctx: QuestContext): Promise<boolean> {
    const deadline = Date.now() + 20 * 60_000;
    let spot = 0;
    let round = 0;
    while (Date.now() < deadline) {
        round++;
        if (pos().isDead) {
            ctx.log('hunt: died — waiting to respawn');
            await waitUntil(() => !pos().isDead, 45_000);
            continue;
        }
        await eat(ctx);
        const before = allText(sdk, 5);
        if (!(await operate(ctx, TALISMAN))) {
            ctx.log('hunt: talisman operate failed');
            return false;
        }
        await waitUntil(() => allText(sdk, 5) !== before, 8_000);
        const text = allText(sdk, 8);
        // The talisman is the only feedback this loop gets — log every reading.
        const tail = text.slice(-160).replace(/\s+/g, ' ');
        ctx.log(`hunt[${round}] @${here()} talisman: ${tail}`);
        if (/absorb the draugen'?s essence|already captured/i.test(text)) return true;

        if (/draugen is here|beware/i.test(text)) {
            // The Draugen spawns within a few tiles and is aggressive to us, but
            // it is INVISIBLE — the client's NPC list may never track it, so fall
            // back to waiting for it to engage us, then hitting whatever is on us.
            for (let attempt = 0; attempt < 6; attempt++) {
                const draugen = sdk.findNearbyNpc(/draugen/i);
                if (draugen) {
                    ctx.log(`hunt: attacking ${(draugen as { name?: string }).name} @${(draugen as { x?: number }).x},${(draugen as { z?: number }).z}`);
                    await bot.attack(draugen as never).catch(() => undefined);
                } else {
                    ctx.log(`hunt: draugen not in the npc list (invisible) — waiting for it to engage`);
                }
                const killed = await waitUntil(
                    () => /absorb the draugen'?s essence/i.test(allText(sdk, 8)),
                    20_000
                );
                if (killed) return true;
                await eat(ctx);
            }
            ctx.log('hunt: spawn window expired without a kill — re-locating');
            continue;
        }

        const dir = (Object.keys(DIRS) as Array<keyof typeof DIRS>).find((d) =>
            new RegExp(`guides you ${d}`, 'i').test(text)
        );
        if (dir) {
            const v = DIRS[dir]!;
            const dest = { x: pos().x + v.dx * 12, z: pos().z + v.dz * 12 };
            ctx.log(`hunt: guided ${dir} -> ${dest.x},${dest.z}`);
            await go(ctx, [dest], dest);
            continue;
        }
        // "moved elsewhere" (or unreadable): sweep the next butterfly ground.
        const next = BUTTERFLIES[spot++ % BUTTERFLIES.length]!;
        ctx.log(`hunt: moved elsewhere — sweeping butterfly spot ${spot % BUTTERFLIES.length} at ${next.x},${next.z}`);
        await go(ctx, [next], next);
    }
    ctx.log('hunt: 20-minute window expired');
    return false;
}

/**
 * Blind maze DFS. UNSURE: layout unknown; wrong portals are click-only so
 * they are never touched, ladders are tried one by one (escape/entrance
 * ladders just resurface at the house and the search continues).
 */

/**
 * Take a ground item, trying the options that actually have content handlers.
 * `pickupItem` dispatches the plain take (op1) and TIMES OUT on items whose
 * handler is `[opobj3,...]` (the longhall keg, for one), while the ground-item
 * interaction with an explicit option index works. Returns whether the bag grew.
 */
async function takeGroundItem(ctx: QuestContext, nameRe: RegExp, countBefore: () => number, ops: number[] = [1, 3]): Promise<boolean> {
    for (let round = 0; round < 4; round++) {
        const gi =
            (sdk.getState() as unknown as { groundItems?: Array<{ id?: number; name?: string; x?: number; z?: number }> })?.groundItems ?? [];
        const hit = gi.find((g) => nameRe.test(g.name ?? ''));
        if (!hit || hit.x === undefined || hit.z === undefined) {
            ctx.log(`take: no ${String(nameRe)} on the ground near ${here()}`);
            await ticks(3);
            continue;
        }
        await approach({ x: hit.x, z: hit.z });
        await ticks(2);
        for (const op of ops) {
            await sdk
                .sendAction({ type: 'interactGroundItem', x: hit.x, z: hit.z, itemId: hit.id ?? -1, optionIndex: op, reason: `fremennik-trials take ${String(nameRe)} op${op}` })
                .catch(() => undefined);
            const got = await waitUntil(() => countBefore() > 0, 6_000);
            if (got) {
                ctx.log(`take: ${String(nameRe)} taken with op${op} at ${hit.x},${hit.z}`);
                return true;
            }
        }
    }
    return countBefore() > 0;
}

/** Are we inside Thorvald's battleground? It lives on plane 2 at z~10100. */
function inArena(p: Tile = pos()): boolean {
    return p.level === 2 && p.z > 10050;
}

/** Are we inside Hallifred's labyrinth? It sits on its own map region at z~10000. */
function inMaze(p: Tile = pos()): boolean {
    return p.level === 0 && p.z > 9900;
}

/**
 * The maze, as established by probing the LIVE world (not the map cache):
 *
 *  - the client publishes the room's locs, and they include Portals
 *    (id 4157 = wrong, 4151/4152/4153 = real), "Escape rope" (id 4161 = climb
 *    out with no vote) and sometimes a "Ladder" (id 4160 = THE exit, which runs
 *    queue(complete_swensen_trial));
 *  - the rooms are pathfinder-disconnected — walkTo/findLongPath stop "9 tiles
 *    short ... separate room", so all movement here is raw single-tile sendWalk;
 *  - locs can be clicked by coordinate+id via sendInteractLoc (proved: the
 *    escape rope at 2665,10015 teleported the bot to the surface);
 *  - no exit ladder exists at the map-cache tile 2666,10012 — a wrong portal
 *    sits one tile west and nothing is clickable on the ladder's tile.
 *
 * So the exit room is found by LEARNING the portal graph at runtime: identify a
 * room by the tile-set of its locs, click each unseen portal, record where it
 * lands, and keep exploring until a room turns up with id 4160 in it.
 */
const LOC_PORTAL_WRONG = 4157;
const LOC_ESCAPE_ROPE = 4161;
const LOC_MAZE_EXIT = 4160;
/** The vote-granting exit ladder, live-confirmed in-scan at this tile. */
const MAZE_EXIT_TILE: Tile = { x: 2665, z: 10037 };
/**
 * Real (non-"wrong") portal destinations, read out of viking_hallifred.rs2:
 * tile -> landing. Used to steer the search toward the exit instead of wandering
 * — a portal whose landing is nearer 2665,10037 is the better bet.
 */
const REAL_PORTAL_LANDING: Record<string, [number, number]> = {
    '2630,10023': [2653, 10035],
    '2631,9998': [2653, 10035],
    '2631,10002': [2642, 10017],
    '2631,10041': [2642, 10017],
    '2639,10015': [2651, 10004],
    '2640,9990': [2651, 10004],
    '2656,10004': [2667, 10015],
    '2656,10043': [2667, 10015],
    '2657,10012': [2668, 10026],
    '2656,10037': [2668, 10026],
    '2665,10018': [2630, 10028],
    '2666,9993': [2630, 10028],
    '2666,10029': [2665, 10038],
    '2667,10004': [2665, 10038],
};

/** The room's identity: the sorted tiles of everything we can see in it. */
function roomKey(locs: Array<{ name?: string; x?: number; z?: number }>): string {
    return locs
        .map((l) => `${(l as { x: number }).x},${(l as { z: number }).z}`)
        .sort()
        .join('|');
}

/** Raw tile-by-tile walk. The client pathfinder has no graph for the maze. */
async function walkTiles(ctx: QuestContext, tiles: Array<[number, number]>): Promise<boolean> {
    for (const [x, z] of tiles) {
        const target = { x, z };
        if (cheb(pos(), target) <= 1) continue;
        await sdk.sendWalk(x, z, true).catch(() => undefined);
        await waitUntil(() => cheb(pos(), target) <= 1, 4_000);
    }
    return true;
}

/**
 * Get within 2 tiles of a loc so the click actually reaches it — raw steps only
 * (the maze rooms are disconnected in the pathfinder). Bursts toward the target
 * in the dominant axis, verifying movement each time; the previous version gave
 * up after one pass of the 8 neighbours and abandoned rooms whose exit ladder
 * was 7 tiles away.
 */
/**
 * Room-local path. The maze's collision IS available to the SDK (isTileWalkable
 * covers the region), but the CLIENT pathfinder has no graph for it: walkTo and
 * findLongPath stop "9 tiles short ... separate room", and naive straight bursts
 * walk into walls — which is why portals kept reporting "unreachable (6-7
 * tiles)". BFS over walkable tiles gives a real room path to raw-step along.
 */
function roomPath(from: Tile, to: Tile, maxNodes = 6000): Tile[] | null {
    const key = (x: number, z: number) => `${x},${z}`;
    const goals = new Set<string>();
    if (isTileWalkable(0, to.x, to.z)) goals.add(key(to.x, to.z));
    else
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) {
            const nx = to.x + (dx as number);
            const nz = to.z + (dz as number);
            if (isTileWalkable(0, nx, nz)) goals.add(key(nx, nz));
        }
    if (goals.size === 0) return null;
    const prev = new Map<string, string | null>();
    prev.set(key(from.x, from.z), null);
    const q: Array<[number, number]> = [[from.x, from.z]];
    let found: string | null = null;
    while (q.length && prev.size < maxNodes) {
        const [x, z] = q.shift()!;
        if (goals.has(key(x, z))) {
            found = key(x, z);
            break;
        }
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const nx = x + (dx as number);
            const nz = z + (dz as number);
            const k = key(nx, nz);
            if (prev.has(k) || !isTileWalkable(0, nx, nz)) continue;
            prev.set(k, key(x, z));
            q.push([nx, nz]);
        }
    }
    if (!found) return null;
    const out: Tile[] = [];
    let cur: string | null = found;
    while (cur) {
        const [x, z] = cur.split(',').map(Number) as [number, number];
        out.push({ x, z });
        cur = prev.get(cur) ?? null;
    }
    out.reverse();
    return out;
}

/** Walk a room path with raw sends, verifying each hop. */
async function followRoomPath(ctx: QuestContext, path: Tile[]): Promise<boolean> {
    for (let i = 0; i < path.length; i++) {
        const j = Math.min(i + 2, path.length - 1);
        const t = path[j]!;
        if (cheb(pos(), t) <= 1) {
            i = j;
            continue;
        }
        const before = pos();
        await sdk.sendWalk(t.x, t.z, true).catch(() => undefined);
        const ok = await waitUntil(() => cheb(before, pos()) >= 1, 3_000);
        if (!ok) {
            const n = path[Math.min(i + 1, path.length - 1)]!;
            await sdk.sendWalk(n.x, n.z, true).catch(() => undefined);
            const ok2 = await waitUntil(() => cheb(before, pos()) >= 1, 3_000);
            if (!ok2) {
                ctx.log(`maze: room walk stuck at ${here()} heading to ${t.x},${t.z}`);
                return false;
            }
        }
        i = j;
    }
    return true;
}

/** Get within 2 tiles of a loc so the click reaches it: BFS, then raw-step it. */
async function stepAdjacent(ctx: QuestContext, t: Tile, attempts = 4): Promise<boolean> {
    for (let i = 0; i < attempts; i++) {
        if (cheb(pos(), t) <= 2) return true;
        const path = roomPath(pos(), t);
        if (!path || path.length === 0) {
            ctx.log(`maze: no room path from ${here()} to ${t.x},${t.z} (${cheb(pos(), t)} tiles) — different room, needs a portal`);
            return false;
        }
        const ok = await followRoomPath(ctx, path);
        if (!ok) {
            ctx.log(`maze: room path to ${t.x},${t.z} (${path.length} tiles) walked short — stuck`);
            return false;
        }
    }
    return cheb(pos(), t) <= 2;
}

/** Explore the portal maze until the exit-ladder room turns up. */
/**
 * The maze solution, matching the route map (S -> 1 -> 2 -> 3 -> ... -> 7 -> F):
 * the seven REAL portals taken in numeric order, each landing in the next panel.
 * Ids come from the offline map dump (vt_mazeportal_N = 4150..4156), placements
 * from the map data, landings from the p_telejump targets in viking_hallifred.rs2.
 * The "wrong" portals (id 4157) are everywhere and just shuffle the bot, so the
 * order below is what actually solves the maze.
 */
const MAZE_PORTAL_ORDER: Array<{ id: number; tiles: Array<[number, number]>; lands: [number, number] }> = [
    { id: 4150, tiles: [[2631, 10002], [2631, 10041]], lands: [2642, 10017] },
    { id: 4151, tiles: [[2639, 10015], [2640, 9990]], lands: [2651, 10004] },
    { id: 4152, tiles: [[2656, 10004], [2656, 10043]], lands: [2667, 10015] },
    { id: 4153, tiles: [[2665, 10018], [2666, 9993]], lands: [2630, 10028] },
    { id: 4154, tiles: [[2630, 10023], [2631, 9998]], lands: [2653, 10035] },
    { id: 4155, tiles: [[2657, 10012], [2656, 10037]], lands: [2668, 10026] },
    { id: 4156, tiles: [[2666, 10029], [2667, 10004]], lands: [2665, 10038] },
];

/** Walk the numbered portal route start-to-finish. false = fall back to exploring. */
async function followPortalOrder(ctx: QuestContext): Promise<boolean> {
    for (const step of MAZE_PORTAL_ORDER) {
        scanVotes(ctx);
        if (progress.votes.swensen) return true;
        let stepped = false;
        for (const [x, z] of step.tiles) {
            const tile = { x, z };
            const path = cheb(pos(), tile) <= 2 ? [] : roomPath(pos(), tile);
            if (cheb(pos(), tile) > 2 && (!path || path.length === 0)) continue; // different room
            await stepAdjacent(ctx, tile, 4);
            if (cheb(pos(), tile) > 2) continue;
            const before = pos();
            await sdk.sendInteractLoc(x, z, step.id, 1).catch(() => undefined);
            const ok = await waitUntil(() => cheb(before, pos()) > 2, 10_000);
            const landed = cheb(pos(), { x: step.lands[0], z: step.lands[1] }) <= 3;
            ctx.log(
                `maze: portal ${step.id} @${x},${z} -> ${here()} moved=${ok} landedNearExpected=${landed}`
            );
            if (landed) {
                stepped = true;
                break;
            }
        }
        if (!stepped) {
            ctx.log(`maze: portal ${step.id} did not take from ${here()} — falling back to exploring`);
            return false;
        }
        await ticks(3);
    }
    // Route exhausted: the exit ladder should be within reach now.
    await sdk.scanNearbyLocs(10).catch(() => undefined);
    const exit = (sdk.getNearbyLocs() ?? []).find(
        (l) => (l as { id?: number }).id === LOC_MAZE_EXIT || /^ladder$/i.test(l.name ?? '')
    );
    if (!exit) {
        ctx.log(`maze: route complete @${here()} but no ladder in scan`);
        return false;
    }
    ctx.log(`maze: route complete — climbing the exit ladder @${(exit as { x?: number }).x},${(exit as { z?: number }).z}`);
    await bot.interactLoc(exit as never, /climb-up/i as never).catch(() => undefined);
    await ticks(8);
    scanVotes(ctx);
    return progress.votes.swensen;
}

async function solveMaze(ctx: QuestContext): Promise<void> {
    const deadline = Date.now() + 20 * 60_000;
    const visitedRooms = new Set<string>();
    const triedPortals = new Set<string>();
    const edges = new Map<string, string>(); // portal tile -> landing tile
    let clicks = 0;
    let reentries = 0;
    const MAX_CLICKS = 130;

    const scan = async () => {
        await sdk.scanNearbyLocs(12).catch(() => undefined);
        return (sdk.getNearbyLocs() ?? []) as Array<{ name?: string; id?: number; x?: number; z?: number }>;
    };

    // Deterministic first: the numbered portal route from the solution map
    // (S -> 1..7 -> F). The learning loop below is the fallback that earned the
    // vote before the map was available, and it stays as the safety net.
    if (inMaze()) {
        if (await followPortalOrder(ctx)) return;
        ctx.log('maze: numbered 1..7 route did not complete — falling back to exploring');
    }

    while (Date.now() < deadline && clicks < MAX_CLICKS) {
        scanVotes(ctx);
        if (progress.votes.swensen) return;

        if (!inMaze()) {
            if (++reentries > 12) {
                ctx.log('maze: re-entered too often — leaving it for the next pass');
                return;
            }
            ctx.log(`maze: on the surface @${here()} (no vote yet) — re-entering (${reentries})`);
            await go(ctx, [MAZE_LADDER], MAZE_LADDER);
            await sdk.scanNearbyLocs(10).catch(() => undefined);
            const down = (sdk.getNearbyLocs() ?? []).find(
                (l) => /^ladder$/i.test(l.name ?? '') && (l.optionsWithIndex ?? []).some((o) => /climb-down/i.test(o.text))
            );
            if (!down) {
                ctx.log('maze: no Climb-down ladder to re-enter');
                await ticks(10);
                continue;
            }
            await bot.interactLoc(down as never, /climb-down/i as never).catch(() => undefined);
            await ticks(6);
            continue;
        }

        const locs = await scan();
        const room = roomKey(locs);
        const portals = locs.filter((l) => (l as { id?: number }).id === LOC_PORTAL_WRONG || /^portal$/i.test(l.name ?? ''));
        // Only id 4160 is the vote-granting exit; the plain "Ladder" in here is
        // the entrance shaft back to the surface.
        const exitLadder = locs.find((l) => (l as { id?: number }).id === LOC_MAZE_EXIT);
        const rope = locs.find((l) => (l as { id?: number }).id === LOC_ESCAPE_ROPE);
        ctx.log(
            `maze: room[${room.length % 997}] @${here()} — ${locs.length} locs, ${portals.length} portals, exit=${!!exitLadder}, rope=${!!rope}, new=${!visitedRooms.has(room)} (click ${clicks})`
        );

        // 1. The vote-granting exit ladder, when one is in the room AND reachable.
        if (exitLadder) {
            const t = { x: (exitLadder as { x: number }).x, z: (exitLadder as { z: number }).z };
            const near = await stepAdjacent(ctx, t);
            if (near) {
                clicks++;
                const r = await sdk
                    .sendInteractLoc(t.x, t.z, LOC_MAZE_EXIT, 1)
                    .catch((e: unknown) => ({ success: false, message: String(e) }));
                ctx.log(`maze: CLICKED exit ladder @${t.x},${t.z} -> ${(r as { success?: boolean }).success}`);
                await ticks(8);
                scanVotes(ctx);
                if (progress.votes.swensen) return;
                ctx.log('maze: exit ladder did not grant the vote — continuing');
            } else {
                ctx.log(`maze: exit ladder @${t.x},${t.z} is out of reach (${cheb(pos(), t)} tiles) — continuing`);
            }
        }
        visitedRooms.add(room);

        // 2. Prefer an UNTRIED portal in this room, nearest first, and WALK to it
        //    with the room BFS — straight bursts used to fail, which is what left
        //    the bot re-clicking whatever portal happened to be next to it.
        const byDist = (a: unknown, b: unknown) =>
            cheb(pos(), { x: (a as { x: number }).x, z: (a as { z: number }).z }) -
            cheb(pos(), { x: (b as { x: number }).x, z: (b as { z: number }).z });
        const score = (l: unknown): number => {
            const tile = `${(l as { x: number }).x},${(l as { z: number }).z}`;
            const known = REAL_PORTAL_LANDING[tile];
            const land = known ?? edges.get(tile)?.split(',').map(Number);
            if (!land) return 1_000 + cheb(pos(), { x: (l as { x: number }).x, z: (l as { z: number }).z });
            const [lx, lz] = land as [number, number];
            // prefer landings closer to the exit; unknown-edge portals judged last
            return cheb({ x: lx, z: lz }, MAZE_EXIT_TILE);
        };
        // Real portals (known landings) beat everything else, and may be reused:
        // they are deterministic progress toward the exit, unlike the 87 wrong
        // portals which just shuffle the bot. Keep one recent-portal memory so a
        // real portal that brings us back isn't clicked twice in a row.
        const inThisRoom = (l: unknown): boolean =>
            cheb(pos(), { x: (l as { x: number }).x, z: (l as { z: number }).z }) <= 2 ||
            roomPath(pos(), { x: (l as { x: number }).x, z: (l as { z: number }).z }) !== null;
        const realInRoom = portals
            .filter((l) => !!REAL_PORTAL_LANDING[`${(l as { x: number }).x},${(l as { z: number }).z}`] && inThisRoom(l))
            .sort((a, b) => score(a) - score(b) || byDist(a, b));
        const untriedAll = portals.filter((l) => !triedPortals.has(`${(l as { x: number }).x},${(l as { z: number }).z}`));
        const untried = untriedAll
            .filter((l) => inThisRoom(l))
            .sort((a, b) => score(a) - score(b) || byDist(a, b));
        const realBest = realInRoom[0];
        const promising = realBest ?? untried[0];
        if (!promising && untriedAll.length > 0) {
            ctx.log(
                `maze: ${untriedAll.length} untried portals in this room's scan but none reachable from ${here()} — leaving the room instead`
            );
        }
        if (promising) {
            const tile = { x: (promising as { x: number }).x, z: (promising as { z: number }).z };
            const id = (promising as { id?: number }).id ?? LOC_PORTAL_WRONG;
            const key = `${tile.x},${tile.z}`;
            const kind = realBest ? 'REAL' : 'untried';
            ctx.log(
                `maze: heading for ${kind} portal ${key} (id ${id}, ${cheb(pos(), tile)} tiles, rank ${score(promising)} from the exit, ${untried.length} untried here)`
            );
            const near = await stepAdjacent(ctx, tile, 5);
            triedPortals.add(key);
            if (!near) {
                ctx.log(`maze: portal ${key} unreachable from ${here()} even after BFS walking — blacklisting it`);
                await ticks(2);
                continue;
            }
            clicks++;
            const before = pos();
            const r = await sdk
                .sendInteractLoc(tile.x, tile.z, id, 1)
                .catch((e: unknown) => ({ success: false, message: String(e) }));
            await waitUntil(() => cheb(before, pos()) > 2, 8_000);
            const after = pos();
            edges.set(key, `${after.x},${after.z}`);
            ctx.log(
                `maze: portal ${key}(id ${id}) -> ${after.x},${after.z} ${cheb(before, after) > 2 ? 'MOVED' : 'NO MOVE'} (click ${clicks}, success=${(r as { success?: boolean }).success})`
            );
            await ticks(4);
            continue;
        }

        // 2b. This room has nothing untried left: leave through any portal we can
        //     stand next to. (Only here — re-clicking a known portal as the FIRST
        //     choice is what had the bot hammering the nearest teleporter.)
        // Prefer a portal we have already mapped whose landing sits nearest the
        // exit ladder — once rooms are learnt, this turns wandering into progress.
        const reachable = portals.filter((l) => cheb(pos(), { x: (l as { x: number }).x, z: (l as { z: number }).z }) <= 2);
        const ranked = reachable
            .map((l) => {
                const tile = `${(l as { x: number }).x},${(l as { z: number }).z}`;
                const known = REAL_PORTAL_LANDING[tile];
                const learned = edges.get(tile)?.split(',').map(Number) as [number, number] | undefined;
                const land = known ?? learned;
                return { loc: l, dist: land ? cheb({ x: land[0], z: land[1] }, MAZE_EXIT_TILE) : 9_999 };
            })
            .sort((a, b) => a.dist - b.dist);
        const anyPortal = ranked[0]?.loc;
        if (anyPortal) {
            const tile = { x: (anyPortal as { x: number }).x, z: (anyPortal as { z: number }).z };
            const id = (anyPortal as { id?: number }).id ?? LOC_PORTAL_WRONG;
            clicks++;
            const before = pos();
            await sdk.sendInteractLoc(tile.x, tile.z, id, 1).catch(() => undefined);
            await waitUntil(() => cheb(before, pos()) > 2, 8_000);
            ctx.log(
                `maze: room has no untried portals — leaving via ${tile.x},${tile.z} (landing rank ${ranked[0]!.dist} from the exit) -> ${here()} (click ${clicks})`
            );
            await ticks(3);
            continue;
        }

        // 3. Nothing left to try in this room: take an escape rope back to the
        //    surface and restart from the landing with everything we have learnt.
        if (rope) {
            const t = { x: (rope as { x: number }).x, z: (rope as { z: number }).z };
            if (await stepAdjacent(ctx, t)) {
                ctx.log(`maze: room exhausted — taking the escape rope @${t.x},${t.z} to reset`);
                await sdk.sendInteractLoc(t.x, t.z, LOC_ESCAPE_ROPE, 1).catch(() => undefined);
                await waitUntil(() => !inMaze(), 10_000);
                await ticks(6);
                continue;
            }
        }
        ctx.log(`maze: room exhausted with no rope in reach @${here()} — backing off`);
        await ticks(8);
    }
    ctx.log(`maze: exploration budget spent (${clicks} clicks) — will retry`);
}
/** The vote-granting exit ladder (the other one, 2665,10037, is not on this route). */

// ---------------------------------------------------------------------------
// Main (law-runes bootstrap).
// ---------------------------------------------------------------------------

const ctx: QuestContext = { sdk, bot, session, log };

// Fail fast on a misassigned account: WC40/Craft40/Fletch25 are hard gates.
// QP has no SDK accessor and stays assignment-side.
const gated = requireSkills(ctx, { Woodcutting: 40, Crafting: 40, Fletching: 25 });
if (!gated.ok) {
    session.stop('cannot_gear', 'fremennik-trials: skill gates unmet', { restartable: false });
    await session.finalizeStop().catch(() => undefined);
    await sdk.disconnect().catch(() => undefined);
    process.exit(0);
}

// Stage probe BEFORE the first side effect: an account already past a stage is
// never re-run (and an already-complete account must not report a bank
// shortfall as its verdict, minutes of travel later).
await refreshProgress('startup probe');
if (progress.complete) {
    log('journal already reports the quest complete — not banking, not travelling');
    session.stop('done', 'fremennik-trials already complete', { restartable: false });
    await session.finalizeStop().catch(() => undefined);
    await sdk.disconnect();
    process.exit(0);
}

const MODE = process.env.QUEST_LAB_MODE === 'staging' ? 'staging' : 'development';
// Only require what this run can demonstrate: a resumed account can never
// produce an `unstarted` PASS, and a trial that already carries its vote line
// will not render its active stage again.
const requiredCheckpoints: string[] = progress.unstarted
    ? ['started', ...TRIALS, 'complete']
    : ['started', ...TRIALS.filter((t) => !progress.votes[t]), 'complete'];

const run = createRun(join(process.cwd(), 'quest-lab', 'runs'), safeRunId('viking', username, new Date().toISOString()), {
    questId: 'viking',
    account: username,
    mode: MODE,
    scriptHash: Bun.hash(await Bun.file(import.meta.path).text()).toString(16),
    fixtureHash: process.env.QUEST_LAB_FIXTURE_HASH ?? 'unrecorded',
    contentHash: process.env.QUEST_LAB_CONTENT_HASH ?? 'unrecorded',
    requiredCheckpoints,
});
log(`Run record: ${run.directory} (mode=${MODE})`);
log(`required checkpoints: ${requiredCheckpoints.join(',')}`);
if (!progress.unstarted) {
    // Resumed mid-quest: record the state we inherited, then keep going.
    await checkpoint('started', 'resumed with the quest already started');
}

// Banked start (quest-start-bank): the Catherby trip is skipped when the bot is
// already in the Seers/Rellekka region, because the first stage's depositAll
// banks everything at Seers anyway and a 300-tile round trip per pass is pure
// overhead on a resume.
const nearHome = pos().z > 3440; // anywhere north of Seers: Rellekka is ~200 tiles out
if (nearHome) {
    log('startup: already in the Seers/Rellekka region — the first stage banks at Seers');
} else if (!(await ensureBankStart(sdk, bot, 'catherby', GRIND_LOG))) {
    session.log('warn', `starting away from Catherby bank @ ${here()} — routing anyway`);
}

try {
    while (!session.isStoppedOrRequested()) {
        // Transport gate (quest-robustness 13): a dead control channel turns
        // every action into "Not connected" and, with the recovery budget, ends
        // the run in a crash. Wait for the controller instead of hammering.
        if (!sdk.isConnected()) {
            session.log('warn', `controller down @ ${here()} — waiting for reconnect`);
            const back = await waitUntil(() => sdk.isConnected(), 180_000);
            if (!back) {
                session.log('warn', 'controller did not return — stopping rather than looping');
                break;
            }
            session.log('log', 'controller back');
            continue;
        }
        if (pos().isDead) {
            session.log('warn', `Died @ ${here()}`);
            await waitUntil(() => !pos().isDead, 45_000);
            continue;
        }
        if (session.needsRecovery()) {
            if ((await session.recover()) === 'exhausted') break;
            continue;
        }
        const outcome = await questLoop(ctx, stages, {
            questName: /fremennik/i,
            completeTimeoutMs: 120_000,
            maxPasses: 400,
            bankName: 'catherby',
        }).catch((parkErr: unknown) => {
            // questLoop's exit path parks at a bank, and that walk can throw when
            // the run ends somewhere the pathfinder cannot route out of (the
            // Thorvald arena on plane 2, for instance). Never let that lose the
            // run: the checkpoints are already on disk.
            log(`quest loop ended with an error during its exit path: ${parkErr instanceof Error ? parkErr.message : String(parkErr)}`);
            return 'stuck' as const;
        });
        if (outcome === 'complete') {
            const summary = summarizeRun(run.directory);
            if (!summary.ok) {
                log(`promotion gate: missing/unpassed ${JSON.stringify(summary.missing)}`);
                session.stop('stuck', 'fremennik-trials: completion without full checkpoint evidence', {
                    restartable: true,
                });
            } else {
                log('DONE Fremennik Trials verified via the quest journal');
                session.stop('done', 'fremennik-trials complete', { restartable: false });
                // Exit for real. Stopping the session alone left the loop spinning
                // (`no stage matched` ×210 — the finish stage's detect is false once
                // complete and nothing else matches), so the process had to be
                // SIGTERMed. Same shape as the other terminal paths in this script.
                await session.finalizeStop().catch(() => undefined);
                await sdk.disconnect().catch(() => undefined);
                process.exit(0);
            }
        } else if (outcome === 'drained') {
            session.stop('stopped', 'drained to bank', { restartable: false });
        } else {
            await parkAtBank(sdk, bot, nearestBank(sdk), { timeoutMs: 240_000 }).catch(() => undefined);
            session.stop('stuck', 'fremennik-trials stuck', { restartable: true });
        }
        break;
    }
} catch (err) {
    session.stop('script_error', err instanceof Error ? err.message : String(err), { restartable: true });
    throw err;
} finally {
    await session.finalizeStop().catch(() => undefined);
    await sdk.disconnect();
}
