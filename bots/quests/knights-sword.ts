/**
 * The Knight's Sword — replayable, checkpoint-gated.
 *
 *   bun bots/quests/knights-sword.ts <botname>
 *
 * State machine (bank -> Squire -> Reldo -> Thurgo (pie) -> portrait ->
 * blurite+irons -> smith -> hand-in -> journal complete), resumed from the
 * account's real journal stage on every launch:
 *
 *   bank            Falador East bank: redberry pie x1, iron bar x2, pickaxe.
 *   start           Squire (White Knights' castle courtyard, Falador):
 *                     "And how is life as a squire?" -> "I can make a new
 *                     sword if you like..." -> "So would these dwarves make
 *                     another one?" -> "Ok, I'll give it a go."
 *   reldo           Reldo (Varrock Palace library): "What do you know about
 *                     the Imcando dwarves?"
 *   pie             Thurgo (hut on the Asgarnian southern peninsula, south of
 *                     Port Sarim) carrying the pie: "Would you like a redberry
 *                     pie?" (content deletes the pie on handover).
 *   sword-request   Thurgo again (no choice; his post-pie branch runs).
 *   portrait-tip    Squire again (no choice; status report advances the varp).
 *   portrait        Sir Vyvin's room, castle level 2: distract Vyvin
 *                     ("Can I distract you for a minute?"), open + search the
 *                     cupboard (content coord 2_46_52_40_8, requires
 *                     %squire >= 5 and Vyvin more than 1 tile away).
 *   materials       Thurgo "About that sword..." with the portrait, then mine
 *                     blurite ore in the caves below his house (needs 10
 *                     Mining + pickaxe; ice giants guard the rock — banked
 *                     food/weapon carried, no kiting) alongside the 2 iron bars.
 *   smith           Thurgo "About that sword..." with blurite + 2 irons
 *                     (content deletes them, adds the faladian sword).
 *   hand-in         Squire with the sword (fetched from the bank if banked).
 *
 * Every step that matters is gated on QUEST JOURNAL evidence, never on XP,
 * chat or a successful packet. The journal is the only client-visible record
 * of quest state: general quest varps are not exposed and most are never
 * transmitted, so it is the portable checkpoint channel.
 *
 * Route and door handling:
 *   - waypoints computed offline from the repo's collision data
 *     (`findLongPath`), single plane per leg, verified displacement
 *   - `bot.walkTo`/`talkTo` open blocking doors
 *   - staircases between planes are climbed via explicit interactLoc on a
 *     staircase loc with a climb option, with the level change verified
 */
import { existsSync, readFileSync, appendFileSync } from 'fs';
import { dirname, join } from 'path';

import { BotSDK, deriveGatewayUrl } from '../../sdk/index';
import { BotActions } from '../../sdk/actions';
import { initPathfinding, findLongPath, isTileWalkable } from '../../sdk/pathfinding';
import { ActivitySession } from '../../sdk/activity';
import { readJournalCheckpoint } from '../../quest-lab/journal-reader';
import { createRun, appendCheckpoint, summarizeRun, safeRunId } from '../../quest-lab/records';
import type { JournalRule } from '../../quest-lab/evidence';

// ── args / env ──────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const botArg = argv.find(a => !a.startsWith('-'));
const envPath = botArg
    ? join(process.cwd(), 'bots', botArg, 'bot.env')
    : join(dirname(import.meta.path), 'bot.env');
if (!existsSync(envPath)) throw new Error(`bot.env not found at ${envPath}. Usage: bun bots/quests/knights-sword.ts <botname>`);
for (const line of readFileSync(envPath, 'utf-8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq > 0) process.env[t.slice(0, eq)] = t.slice(eq + 1);
}
const username = process.env.BOT_USERNAME!;
const password = process.env.PASSWORD!;
const GRIND_LOG = join(process.cwd(), 'bots', username, 'grind.log');
const log = (msg: string) => {
    console.log(msg);
    try { appendFileSync(GRIND_LOG, `${new Date().toISOString()} ${msg}\n`); } catch { /* ignore */ }
};

// ── constants ───────────────────────────────────────────────────────────────
// Approach tiles, not exact spawns: routes are planned at runtime from the
// live position and talkTo walks the last tiles itself.
const FALADOR_EAST_BANK = { x: 3013, z: 3355 };
const SQUIRE = { x: 2959, z: 3339, level: 0 };       // White Knights' castle courtyard, Falador
const RELDO = { x: 3211, z: 3359, level: 0 };        // Varrock Palace library
const THURGO = { x: 2997, z: 3147, level: 0 };       // hut on the Asgarnian southern peninsula
const VYVIN_ROOM = { x: 2961, z: 3339, level: 2 };   // Sir Vyvin's room, castle level 2
const BLURITE_CAVE = { x: 2997, z: 3147, level: 0 }; // caves below Thurgo's house (rock area)

const WAYPOINT_SPACING = 10;

function planWaypoints(from: { x: number; z: number }, to: { x: number; z: number }): { x: number; z: number }[] {
    const raw = findLongPath(0, from.x, from.z, to.x, to.z);
    if (raw.length === 0) return [to];
    const way: { x: number; z: number }[] = [{ x: raw[0]!.x, z: raw[0]!.z }];
    let last = raw[0]!;
    for (let i = 1; i < raw.length; i++) {
        const p = raw[i]!;
        if (Math.hypot(p.x - last.x, p.z - last.z) >= WAYPOINT_SPACING || i === raw.length - 1) {
            way.push({ x: p.x, z: p.z });
            last = p;
        }
    }
    return way;
}

/** Nearest standable tile to a target. */
function approachTo(t: { x: number; z: number }): { x: number; z: number } {
    if (isTileWalkable(0, t.x, t.z)) return { x: t.x, z: t.z };
    for (let r = 1; r <= 4; r++) {
        for (const cand of [{ x: t.x + r, z: t.z }, { x: t.x - r, z: t.z }, { x: t.x, z: t.z + r }, { x: t.x, z: t.z - r }]) {
            if (isTileWalkable(0, cand.x, cand.z)) return cand;
        }
    }
    return { x: t.x, z: t.z };
}

// questlist.if `[squire]` section, verified: text/option are "The Knight's
// Sword" (NOT the journal heading by assumption — they happen to match here).
// Journal heading from ~quest_journal("The Knight's Sword", ...) in
// server/content/scripts/quests/quest_squire/scripts/squire_journal.rs2.
const JOURNAL = { label: "The Knight's Sword", title: "The Knight's Sword" };

// Journal rules, one per stage, each keyed on a sentence UNIQUE to it
// (server/content/scripts/quests/quest_squire/scripts/squire_journal.rs2):
//   not_started      L5  "I can start this quest by talking to the Squire ..."
//   started          L20 "The Squire suggests I speak to Reldo ..."
//   spoken_reldo     L27 "Reldo couldn't give me much information ..."
//   given_pie        L38 "He will help me now I have gained his trust through pie."
//   spoken_thurgo    L44 "needs a picture of the sword before he can help."
//   looking_portrait L52 "The Squire told me about a portrait of Sir Vyvin's father ..."
//   looking_blurite  L65 "Blurite Ore can only be found deep in the caves below ..."
//   smithed          L62 substate of looking_blurite (same varp, sword in
//                      hand/bank): "Thurgo has now smithed me a replica ..."
//   complete         L77 "QUEST COMPLETE!"
const RULES: Record<string, JournalRule> = {
    not_started: { id: 'squire:not_started', kind: 'unstarted', all: ['I can start this quest by talking to the Squire'] },
    started: { id: 'squire:started', kind: 'active', all: ['The Squire suggests I speak to Reldo'] },
    spoken_reldo: { id: 'squire:spoken_reldo', kind: 'active', all: ["Reldo couldn't give me much information"] },
    given_pie: { id: 'squire:given_pie', kind: 'active', all: ['gained his trust through pie'] },
    spoken_thurgo: { id: 'squire:spoken_thurgo', kind: 'active', all: ['needs a picture of the sword before he can help'] },
    looking_portrait: { id: 'squire:looking_portrait', kind: 'active', all: ["portrait of Sir Vyvin's father"] },
    looking_blurite: { id: 'squire:looking_blurite', kind: 'active', all: ['Blurite Ore can only be'] },
    smithed: { id: 'squire:smithed', kind: 'active', all: ['has now smithed me a replica'] },
    complete: { id: 'squire:complete', kind: 'complete', all: ['QUEST COMPLETE'] },
};
type Stage = keyof typeof RULES;
const STAGE_ORDER: Stage[] = ['not_started', 'started', 'spoken_reldo', 'given_pie', 'spoken_thurgo', 'looking_portrait', 'looking_blurite', 'smithed', 'complete'];

// ── setup ───────────────────────────────────────────────────────────────────
console.log('Warming pathfinder...');
initPathfinding();

const sdk = new BotSDK({
    botUsername: username,
    password,
    gatewayUrl: deriveGatewayUrl(process.env.SERVER),
    autoLaunchBrowser: true,
    browserLaunchTimeout: 90_000,
    readyTimeout: 45_000,
    connectTimeout: 60_000,
    showChat: false,
});

console.log('Opening/attaching the game client...');
await sdk.connect();
const bot = new BotActions(sdk);

// ActivitySession needs the live sdk + bot, so it is built here, not up front.
const session = new ActivitySession(sdk, bot, {
    name: "the knight's sword",
    grindLogPath: GRIND_LOG,
    maxRecoveryTactics: 8,
});

await session.setPhase('start');

const pos = () => {
    const p = sdk.getState()?.player;
    return { x: p?.worldX ?? 0, z: p?.worldZ ?? 0, level: p?.level ?? 0 };
};
const distTo = (t: { x: number; z: number }) => Math.hypot(pos().x - t.x, pos().z - t.z);
const invCount = (pattern: RegExp) =>
    sdk.getInventory().filter(i => pattern.test(i.name)).reduce((n, i) => n + (i.count ?? 1), 0);
const bankCount = (pattern: RegExp) =>
    (sdk.getState()?.bank?.items ?? []).filter(i => pattern.test(i.name)).reduce((n, i) => n + (i.count ?? 0), 0);
const miningLevel = () => sdk.getSkill('Mining')?.baseLevel ?? 1;

// ── durable run record ──────────────────────────────────────────────────────
// Checkpoint evidence is written verbatim as the run proceeds, so an audit does
// not depend on the script's own stdout or on telemetry that sampling truncates.
const MODE = process.env.QUEST_LAB_MODE === 'staging' ? 'staging' : 'development';
const run = createRun(join(process.cwd(), 'quest-lab', 'runs'), safeRunId('squire', username, new Date().toISOString()), {
    questId: 'squire',
    account: username,
    mode: MODE,
    scriptHash: Bun.hash(await Bun.file(import.meta.path).text()).toString(16),
    fixtureHash: process.env.QUEST_LAB_FIXTURE_HASH ?? 'unrecorded',
    contentHash: process.env.QUEST_LAB_CONTENT_HASH ?? 'unrecorded',
    requiredCheckpoints: [...STAGE_ORDER],
});
log(`Run record: ${run.directory} (mode=${MODE})`);

/** Checkpoint gate. UNKNOWN is a failure like any other here: proceed on nothing. */
async function checkpoint(name: Stage, label: string): Promise<boolean> {
    const read = await readJournalCheckpoint(sdk, JOURNAL, RULES[name]!);
    const verdict = read.verdict?.verdict ?? 'UNKNOWN';
    appendCheckpoint(run.directory, {
        checkpointId: name,
        verdict,
        reason: read.reason,
        kind: RULES[name]!.kind,
        rawLines: read.rawLines,
    });
    if (verdict !== 'PASS') {
        log(`CHECKPOINT ${name} ${verdict}: ${read.reason}`);
        if (read.rawLines.length) {
            for (const line of read.rawLines) log(`    raw: ${JSON.stringify(line.rawText)}`);
        }
        session.log('warn', `checkpoint ${name} ${verdict}`);
        return false;
    }
    log(`CHECKPOINT ${name} PASS (${label}) — ${read.reason}`);
    session.log('log', `checkpoint ${name} PASS: ${label}`);
    return true;
}

// ── travel ──────────────────────────────────────────────────────────────────
/**
 * Walk to a destination via planned waypoints. Each leg is verified: a leg that
 * moves nothing is an obstacle, and retrying the same bearing cannot help.
 */
async function travelTo(dest: { x: number; z: number; level?: number }, what: string): Promise<void> {
    const target = approachTo(dest);
    const waypoints = planWaypoints(pos(), target);
    log(`Route to ${what}: ${waypoints.length} waypoint(s) from (${pos().x},${pos().z}) to (${target.x},${target.z})`);
    for (let i = 0; i < waypoints.length; i++) {
        const wp = waypoints[i]!;
        const before = pos();
        if (Math.hypot(before.x - wp.x, before.z - wp.z) <= 3) continue;

        let moved = false;
        for (let attempt = 0; attempt < 3 && !moved; attempt++) {
            const res = await bot.walkTo(wp.x, wp.z, 3);
            await sdk.waitForTicks(2);
            const after = pos();
            const step = Math.hypot(after.x - before.x, after.z - before.z);
            moved = step >= 1 || Math.hypot(after.x - wp.x, after.z - wp.z) <= 3;
            log(`leg ${i + 1}/${waypoints.length} -> (${wp.x},${wp.z}) moved=${step.toFixed(1)} at (${after.x},${after.z}) l${after.level} ok=${res.success}`);
        }
        if (!moved) {
            const now = pos();
            throw new Error(`BLOCKED leg ${i + 1} to ${what}: no progress at (${now.x},${now.z}) l${now.level}, ${Math.round(distTo(wp))} tiles short of (${wp.x},${wp.z})`);
        }
    }
    if (dest.level !== undefined && pos().level !== dest.level) await climbToLevel(dest.level, what);
    const at = pos();
    if (distTo(target) > 6) throw new Error(`did not reach ${what}: at (${at.x},${at.z}) l${at.level}, ${Math.round(distTo(target))} tiles short`);
    log(`Arrived ${what} at (${at.x},${at.z}) l${at.level}`);
}

/** Climb a staircase until the target plane is reached; the level change is the proof. */
async function climbToLevel(want: number, what: string): Promise<void> {
    for (let attempt = 0; attempt < 3 && pos().level !== want; attempt++) {
        const up = want > pos().level;
        const stair = sdk.findNearbyLoc(/staircase/i, { withOption: up ? /climb.?up|up/i : /climb.?down|down/i })
            ?? sdk.findNearbyLoc(/staircase/i);
        if (!stair) throw new Error(`no staircase near (${pos().x},${pos().z}) l${pos().level} for ${what} (need l${want})`);
        const opt = (stair.options ?? []).find(o => up ? /up/i.test(o) : /down/i.test(o)) ?? (up ? 'Climb-up' : 'Climb-down');
        const res = await bot.interactLoc(stair, opt);
        await sdk.waitForTicks(3);
        log(`stairs ${up ? 'up' : 'down'} for ${what}: ok=${res.success} now l${pos().level}${res.success ? '' : ` (${res.message ?? res.reason ?? '?'})`}`);
    }
    if (pos().level !== want) throw new Error(`could not reach level ${want} for ${what}: still l${pos().level}`);
}

// ── dialog ──────────────────────────────────────────────────────────────────
/**
 * Drain an open dialog to a close. Options are clicked through in order;
 * matchers are tried in order and the first hit wins. A dialog with options
 * that match nothing is evidence of a wrong branch, never something to click
 * through blindly: options[0] is frequently the DECLINE.
 */
async function drainDialog(matchers: RegExp[], who: string): Promise<void> {
    let unmatchedTicks = 0;
    let closedTicks = 0;
    for (let i = 0; i < 40; i++) {
        const dialog = sdk.getDialog();
        if (!dialog?.isOpen) {
            await sdk.waitForTicks(1);
            if (!sdk.getDialog()?.isOpen && ++closedTicks > 2) break;
            continue;
        }
        closedTicks = 0;
        const options = dialog.options ?? [];
        if (options.length === 0) {
            await sdk.sendClickDialog(0); // Continue line, no choice
            await sdk.waitForTicks(2);
            continue;
        }
        const pick = matchers.map(m => options.find(o => m.test(o.text))).find(Boolean);
        if (pick) {
            log(`dialog ${who} -> ${pick.text}`);
            await sdk.sendClickDialog(pick.index);
            unmatchedTicks = 0;
        } else {
            if (unmatchedTicks === 0) log(`dialog ${who} options (no matcher hit): ${options.map(o => JSON.stringify(o.text)).join(' | ')}`);
            if (++unmatchedTicks > 10) {
                throw new Error(`dialog ${who} stuck: no option matches ${matchers.map(String).join(', ')} (options: ${options.map(o => JSON.stringify(o.text)).join(' | ')})`);
            }
        }
        await sdk.waitForTicks(2);
    }
    await bot.dismissBlockingUI();
}

async function talkDrain(npc: RegExp, matchers: RegExp[], who: string): Promise<void> {
    const talked = await bot.talkTo(npc);
    if (!talked.success) throw new Error(`could not talk to ${who}: ${talked.message ?? '?'}`);
    await drainDialog(matchers, who);
    await bot.dismissBlockingUI();
}

// ── 1. what stage is this account actually at? ──────────────────────────────
// Read the journal BEFORE banking. A finished quest has nothing left to do, and
// a bot resumed mid-quest should bank only for what it still lacks. Banking
// first made a completed quest report "insufficient stock" instead of "already
// complete" — and walked to Falador East to do it.
await session.setPhase('inspect');

/** The first stage rule that PASSes is the account's real stage (late stages first). */
async function readStage(): Promise<Stage | 'unknown'> {
    for (const name of [...STAGE_ORDER].reverse()) {
        const read = await readJournalCheckpoint(sdk, JOURNAL, RULES[name]!);
        log(`  stage probe ${name}: ${read.verdict?.verdict ?? 'UNKNOWN'} (${read.reason})`);
        if (read.verdict?.verdict === 'PASS') return name;
    }
    return 'unknown';
}

let STAGE = await readStage();
log(`Quest stage at start: ${STAGE}`);
if (STAGE === 'complete') {
    log("The Knight's Sword is already complete — nothing to do");
    session.log('log', 'quest already complete; nothing to do');
    sdk.disconnect();
    process.exit(0);
}
if (STAGE === 'unknown') throw new Error('could not determine the quest stage from the journal');
const atLeast = (s: Stage) => STAGE_ORDER.indexOf(STAGE as Stage) >= STAGE_ORDER.indexOf(s);

// ── 2. bank, but only for supplies the remaining stages still need ──────────
await session.setPhase('bank');
await session.showIntent('banking quest supplies');
await bot.dismissBlockingUI();

// Content deletes these on handover, so a resume mid-quest re-needs them.
const needPie = !atLeast('given_pie') && invCount(/^redberry pie$/i) < 1;
const needIrons = !atLeast('smithed') && invCount(/^iron bar$/i) < 2;
const needPick = !atLeast('smithed') && invCount(/pickaxe/i) < 1;
if (needPie || needIrons || needPick) await bankForSupplies({ pie: needPie, irons: needIrons, pick: needPick });
else log('Supplies already carried; skipping the bank leg');

async function bankForSupplies(need: { pie: boolean; irons: boolean; pick: boolean }): Promise<void> {
    // A bot may be anywhere on restart, so travel to the bank first rather
    // than assuming the start tile.
    if (distTo(FALADOR_EAST_BANK) > 8) await travelTo(FALADOR_EAST_BANK, 'Falador East bank');

    // Pre-check total stock before the first withdraw: an empty bank must idle
    // cleanly, not throw mid-run. Verify the bank is open before reading it.
    if (!(await bot.openBank()).success) throw new Error(`could not open bank at ${pos().x},${pos().z}`);
    await sdk.waitForTicks(2);
    const want: { name: string; pattern: RegExp; n: number }[] = [];
    if (need.pie) want.push({ name: 'redberry pie', pattern: /^redberry pie$/i, n: 1 });
    if (need.irons) want.push({ name: 'iron bar', pattern: /^iron bar$/i, n: 2 });
    if (need.pick) want.push({ name: 'pickaxe', pattern: /pickaxe/i, n: 1 });
    const shortfall = want.filter(w => invCount(w.pattern) + bankCount(w.pattern) < w.n);
    if (shortfall.length) {
        const detail = shortfall.map(w => `${w.name}(inv=${invCount(w.pattern)} bank=${bankCount(w.pattern)} need=${w.n})`).join(' ');
        log(`INSUFFICIENT STOCK: ${detail} — idling instead of crash-looping`);
        session.log('warn', `insufficient stock: ${detail}`);
        await bot.closeInterface();
        process.exit(0);
    }

    for (const w of want) {
        while (invCount(w.pattern) < w.n) {
            // The interface can drop between the open check and the withdraw.
            if (!sdk.getState()?.bank?.isOpen && !(await bot.openBank()).success) {
                throw new Error(`bank closed before withdrawing ${w.name}`);
            }
            const res = await bot.withdrawItem(w.pattern, w.n - invCount(w.pattern));
            log(`withdrew ${w.name}: ${res.success}${res.success ? '' : ` (${res.message ?? '?'})`}`);
            if (!res.success) throw new Error(`could not withdraw ${w.name}`);
        }
    }
    await bot.closeInterface();
    log(`Bag: pie x${invCount(/^redberry pie$/i)} irons x${invCount(/^iron bar$/i)} pickaxe x${invCount(/pickaxe/i)}`);
}

// Mining gate: the journal demands level 10 and the blurite rock needs it too.
if (!atLeast('smithed') && miningLevel() < 10) {
    throw new Error(`Mining level ${miningLevel()} < 10: The Knight's Sword cannot proceed (journal prerequisite)`);
}

// ── 3. start: the Squire ────────────────────────────────────────────────────
if (!atLeast('started')) {
    if (!(await checkpoint('not_started', 'quest not yet started'))) {
        throw new Error('not_started checkpoint failed before starting the quest');
    }
    await session.setPhase('start-quest');
    await session.showIntent('starting the knight sword with the squire');
    await travelTo(SQUIRE, 'the Squire');
    await talkDrain(/^squire$/i, [
        /and how is life as a squire/i,
        /i can make a new sword/i,
        /would these dwarves make another one/i,
        /ok, i'll give it a go/i,
    ], 'squire-start');
    if (!(await checkpoint('started', 'accepted the quest, Reldo named'))) {
        throw new Error('started checkpoint failed after accepting the quest');
    }
    STAGE = 'started';
} else {
    log('Resuming: quest already started');
}

// ── 4. Reldo: what do you know about the Imcando dwarves? ───────────────────
if (!atLeast('spoken_reldo')) {
    await session.setPhase('reldo');
    await session.showIntent('asking reldo about the imcando dwarves');
    await travelTo(RELDO, 'Reldo');
    await talkDrain(/^reldo$/i, [/imcando dwarves/i], 'reldo');
    if (!(await checkpoint('spoken_reldo', 'Reldo named the pie-loving Imcando'))) {
        throw new Error('spoken_reldo checkpoint failed after talking to Reldo');
    }
    STAGE = 'spoken_reldo';
}

// ── 5. Thurgo + pie, then the sword request ─────────────────────────────────
// Handler order matters: with the pie carried, his opnpc1 offers the pie
// branch directly; without it he refuses (`thurgo_special_sword_pre_pie`).
if (!atLeast('given_pie')) {
    if (invCount(/^redberry pie$/i) < 1) throw new Error('no redberry pie in hand for Thurgo: restock at the bank');
    await session.setPhase('pie');
    await session.showIntent('bribing thurgo with a redberry pie');
    await travelTo(THURGO, 'Thurgo');
    await talkDrain(/^thurgo$/i, [/redberry pie/i], 'thurgo-pie');
    if (!(await checkpoint('given_pie', 'Thurgo ate the pie'))) {
        throw new Error('given_pie checkpoint failed after handing over the pie');
    }
    STAGE = 'given_pie';
}
if (!atLeast('spoken_thurgo')) {
    await session.setPhase('sword-request');
    await session.showIntent('asking thurgo for a replacement sword');
    await talkDrain(/^thurgo$/i, [], 'thurgo-sword-request');
    if (!(await checkpoint('spoken_thurgo', 'Thurgo asked for a picture'))) {
        throw new Error('spoken_thurgo checkpoint failed after the sword request');
    }
    STAGE = 'spoken_thurgo';
}

// ── 6. Squire: the portrait tip ─────────────────────────────────────────────
if (!atLeast('looking_portrait')) {
    await session.setPhase('portrait-tip');
    await session.showIntent('asking the squire about a picture');
    await travelTo(SQUIRE, 'the Squire');
    await talkDrain(/^squire$/i, [], 'squire-portrait-tip');
    if (!(await checkpoint('looking_portrait', 'Squire named the Vyvin portrait'))) {
        throw new Error('looking_portrait checkpoint failed after the Squire tip');
    }
    STAGE = 'looking_portrait';
}

// ── 7. the portrait: distract Vyvin, search his cupboard ────────────────────
// Content (general_use cupboards.rs2): the Vyvin-room cupboard yields the
// portrait only at %squire >= 5, only when Vyvin is NOT within 1 tile, and
// only when the portrait is neither carried nor banked.
if (invCount(/^knights portrait$/i) + bankCount(/^knights portrait$/i) < 1) {
    await session.setPhase('portrait');
    await session.showIntent('searching vyvin cupboard for the portrait');
    await travelTo(VYVIN_ROOM, "Sir Vyvin's room");
    const vyvin = sdk.findNearbyNpc(/sir vyvin/i);
    if (vyvin) {
        await talkDrain(/^sir vyvin$/i, [/distract you for a minute/i], 'vyvin-distract');
        await sdk.waitForTicks(2);
    }
    const shut = sdk.findNearbyLoc(/cupboard/i, { withOption: /open/i });
    if (shut) {
        const opened = await bot.interactLoc(shut, /open/i);
        log(`cupboard open: ok=${opened.success}${opened.success ? '' : ` (${opened.message ?? opened.reason ?? '?'})`}`);
        if (!opened.success) throw new Error(`could not open Vyvin's cupboard: ${opened.message ?? opened.reason ?? '?'}`);
        await sdk.waitForTicks(2);
    }
    const openBox = sdk.findNearbyLoc(/cupboard/i, { withOption: /search/i });
    if (!openBox) {
        const opts = (sdk.findNearbyLoc(/cupboard/i)?.options ?? []).join(',');
        throw new Error(`no searchable cupboard near (${pos().x},${pos().z}) l${pos().level} (nearest options: ${opts || 'none'})`);
    }
    const searched = await bot.interactLoc(openBox, /search/i);
    log(`cupboard search: ok=${searched.success}${searched.success ? '' : ` (${searched.message ?? searched.reason ?? '?'})`}`);
    await sdk.waitForTicks(2);
    await bot.dismissBlockingUI();
    if (invCount(/^knights portrait$/i) < 1) {
        throw new Error('cupboard search left no portrait: Vyvin may have been watching, or the stage gate failed');
    }
    log('Portrait secured');
    session.log('log', 'portrait secured from Vyvin cupboard');
} else if (bankCount(/^knights portrait$/i) > 0 && invCount(/^knights portrait$/i) < 1) {
    await travelTo(FALADOR_EAST_BANK, 'Falador East bank');
    if (!sdk.getState()?.bank?.isOpen && !(await bot.openBank()).success) throw new Error('bank closed before withdrawing the portrait');
    const res = await bot.withdrawItem(/^knights portrait$/i, 1);
    if (!res.success) throw new Error(`could not withdraw the portrait: ${res.message ?? '?'}`);
    await bot.closeInterface();
}

// ── 8. Thurgo: hand over the portrait (he names blurite + 2 irons) ──────────
if (!atLeast('looking_blurite')) {
    if (invCount(/^knights portrait$/i) < 1) throw new Error('no portrait in hand for Thurgo');
    await session.setPhase('materials-brief');
    await session.showIntent('showing thurgo the portrait');
    await travelTo(THURGO, 'Thurgo');
    await talkDrain(/^thurgo$/i, [/about that sword/i], 'thurgo-portrait');
    if (!(await checkpoint('looking_blurite', 'Thurgo named blurite and iron bars'))) {
        throw new Error('looking_blurite checkpoint failed after showing the portrait');
    }
    STAGE = 'looking_blurite';
}

// ── 9. materials: blurite ore + 2 iron bars ─────────────────────────────────
// Iron bars come from the bank leg; blurite must be mined in the caves below
// Thurgo's house. Ice giants guard the rock: food/weapon from the bank is
// carried, but there is no combat kiting — a death here reads as a missed
// material, not a checkpoint failure.
if (!atLeast('smithed')) {
    if (invCount(/^iron bar$/i) < 2) throw new Error('fewer than 2 iron bars in hand: restock at the bank');
    await session.setPhase('mine-blurite');
    await session.showIntent('mining blurite ore');
    await travelTo(BLURITE_CAVE, 'the blurite cave');
    if (invCount(/^blurite ore$/i) < 1) {
        if (invCount(/pickaxe/i) < 1) throw new Error('no pickaxe in hand for blurite: restock at the bank');
        let mined = false;
        for (let attempt = 0; attempt < 30 && !mined; attempt++) {
            const rock = sdk.findNearbyLoc(/blurite/i, { withOption: /mine/i })
                ?? sdk.findNearbyLoc(/rock/i, { withOption: /mine/i });
            if (!rock) {
                log(`no mineable rock near (${pos().x},${pos().z}) l${pos().level} (attempt ${attempt + 1}/30)`);
                await sdk.waitForTicks(3);
                continue;
            }
            const before = invCount(/^blurite ore$/i);
            const res = await bot.interactLoc(rock, /mine/i);
            await sdk.waitForTicks(4);
            const after = invCount(/^blurite ore$/i);
            log(`mine attempt ${attempt + 1}: ok=${res.success} blurite ${before}->${after}${res.success ? '' : ` (${res.message ?? res.reason ?? '?'})`}`);
            mined = after > before;
        }
        if (!mined) throw new Error('could not mine blurite ore in 30 attempts (rock absent, giants, or missing level)');
        session.log('log', 'blurite ore mined');
    }
}

// ── 10. smith: Thurgo forges the replacement ────────────────────────────────
if (!atLeast('smithed')) {
    await session.setPhase('smith');
    await session.showIntent('thurgo smithing the replacement sword');
    await talkDrain(/^thurgo$/i, [/about that sword/i, /i have them right here/i], 'thurgo-smith');
    if (!(await checkpoint('smithed', 'Thurgo smithed the replica'))) {
        throw new Error('smithed checkpoint failed after giving Thurgo the materials');
    }
    STAGE = 'smithed';
}

// ── 11. hand in: the Squire ─────────────────────────────────────────────────
// Content accepts the sword from the bag (or worn); a banked sword just earns
// a scolding, so fetch it first.
if (invCount(/^faladian sword$/i) < 1) {
    if (bankCount(/^faladian sword$/i) < 1) throw new Error('no replacement sword carried or banked: the smithing step left nothing');
    await session.setPhase('fetch-sword');
    await travelTo(FALADOR_EAST_BANK, 'Falador East bank');
    if (!sdk.getState()?.bank?.isOpen && !(await bot.openBank()).success) throw new Error('bank closed before withdrawing the sword');
    const res = await bot.withdrawItem(/^faladian sword$/i, 1);
    if (!res.success) throw new Error(`could not withdraw the sword: ${res.message ?? '?'}`);
    await bot.closeInterface();
}
await session.setPhase('hand-in');
await session.showIntent('returning the sword to the squire');
await travelTo(SQUIRE, 'the Squire');
await talkDrain(/^squire$/i, [], 'squire-hand-in');

// ── 12. completion is proven by the journal, never by XP or a chat line ────
await session.setPhase('verify');
if (!(await checkpoint('complete', 'journal reports QUEST COMPLETE'))) {
    throw new Error('completion checkpoint failed: journal does not report the quest complete');
}

session.log('log', "The Knight's Sword verified complete");
session.noteProgress('inventory', 'quest complete (journal-verified)');
const summary = summarizeRun(run.directory);
if (!summary.ok) {
    // Every declared checkpoint must carry a PASS before this counts as done.
    throw new Error(`promotion gate failed: missing/unpassed ${JSON.stringify(summary.missing)}`);
}
log(`Run record verified: ${summary.ok} (${summary.missing.length} outstanding)`);
log(`DONE The Knight's Sword verified via journal at (${pos().x},${pos().z})`);
log(`Metrics: ${JSON.stringify(session.metrics())}`);

sdk.disconnect();
process.exit(0);
