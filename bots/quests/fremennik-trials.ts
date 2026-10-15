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
    talkAndChoose,
    questLoop,
    waitForQuestComplete,
    visibleText,
    countItems,
    withdrawNeeds,
    requireSkills,
    type ItemNeed,
} from './quest-lib';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';

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
const PROG_PATH = join(process.cwd(), 'bots', username, 'fremennik-trials.json');

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
if (!(await ensureBankStart(sdk, bot, 'catherby', GRIND_LOG))) {
    session.log('warn', `starting away from Catherby bank @ ${here()} — routing anyway`);
}

// ---------------------------------------------------------------------------
// Progress (vote) persistence: resume re-detects from this + chat, never replays.
// ---------------------------------------------------------------------------

type TrialId = 'peer' | 'olaf' | 'sigli' | 'reveller' | 'swensen' | 'sigmund' | 'thorvald';
const TRIALS: TrialId[] = ['peer', 'olaf', 'sigli', 'reveller', 'swensen', 'sigmund', 'thorvald'];

interface Prog {
    started: boolean;
    votes: Record<TrialId, boolean>;
    attempts: Record<string, number>;
}

function loadProg(): Prog {
    const blank: Prog = {
        started: false,
        votes: { peer: false, olaf: false, sigli: false, reveller: false, swensen: false, sigmund: false, thorvald: false },
        attempts: {},
    };
    try {
        if (!existsSync(PROG_PATH)) return blank;
        const raw = JSON.parse(readFileSync(PROG_PATH, 'utf-8')) as Partial<Prog>;
        return { ...blank, ...raw, votes: { ...blank.votes, ...(raw.votes ?? {}) }, attempts: raw.attempts ?? {} };
    } catch {
        return blank;
    }
}

let prog = loadProg();
function saveProg(): void {
    try {
        writeFileSync(PROG_PATH, JSON.stringify(prog, null, 2));
    } catch { /* ignore */ }
}

function voteCount(): number {
    return TRIALS.filter((t) => prog.votes[t]).length;
}

function bump(key: string, cap: number): boolean {
    prog.attempts[key] = (prog.attempts[key] ?? 0) + 1;
    saveProg();
    return (prog.attempts[key] ?? 0) <= cap;
}

/** Distinctive vote/completion lines per trial, from server/content quest_viking. */
const VOTE_RES: Array<{ trial: TrialId; re: RegExp }> = [
    { trial: 'peer', re: /solved my puzzle so quickly/i },
    { trial: 'olaf', re: /completed the bard'?s trial/i },
    { trial: 'sigli', re: /anyone brave enough to hunt and defeat the draugen/i },
    { trial: 'reveller', re: /completed the revellers'? trial/i },
    { trial: 'swensen', re: /you have finished my maze/i },
    { trial: 'sigmund', re: /recommend you to the council of elders/i },
    { trial: 'thorvald', re: /passed the warrior'?s trial|completed the warriors trial/i },
];

function scanVotes(ctx: QuestContext): boolean {
    const text = visibleText(ctx.sdk, 60);
    let changed = false;
    for (const { trial, re } of VOTE_RES) {
        if (!prog.votes[trial] && re.test(text)) {
            prog.votes[trial] = true;
            changed = true;
            ctx.log(`vote detected: ${trial} (${voteCount()}/7)`);
        }
    }
    if (!prog.started && /seven|seven council|council of elders|honorary fremennik/i.test(text)) {
        prog.started = true;
        changed = true;
    }
    if (changed) saveProg();
    return changed;
}

function log(msg: string): void {
    session.log('log', msg);
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
const BUCKET_EMPTY = /^empty bucket$/i;
const BUCKET1 = /^1\/5ths full bucket$/i;
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
// Anchors. Longhall/maze anchors are derived from script map squares
// (world = map*64+local, e.g. pipe 0_41_57_35_37 -> 2659,3685); the rest are
// OSRS-memory and marked UNSURE — every leg re-scans by name on arrival.
// ---------------------------------------------------------------------------

const SEERS = { x: SEERS_BANK.x, z: SEERS_BANK.z };
const LONGHALL = { x: 2660, z: 3680 };
const STAGE = { x: 2658, z: 3683 };
const KEG_TABLE = { x: 2660, z: 3676 };
const PIPE = { x: 2659, z: 3685 };
const SWENSEN_HOUSE = { x: 2644, z: 3658 };
const NPC_ANCHOR: Record<string, Tile> = {
    brundt: LONGHALL,
    manni: LONGHALL,
    barkeep: LONGHALL,
    sigmund: { x: 2664, z: 3675 }, // UNSURE: merchant stall by the longhall
    olaf: { x: 2670, z: 3683 }, // UNSURE
    sigli: { x: 2650, z: 3660 }, // UNSURE
    thorvald: { x: 2663, z: 3692 }, // UNSURE: warrior hut NE of longhall
    yrsa: { x: 2672, z: 3670 }, // UNSURE: clothes shop
    skulgrimen: { x: 2670, z: 3692 }, // UNSURE: battle gear shop
    sailor: { x: 2640, z: 3635 }, // UNSURE: docks west
    fisherman: { x: 2640, z: 3635 }, // UNSURE: docks west
    askeladden: { x: 2656, z: 3672 }, // UNSURE: outside the longhall
    peer: { x: 2682, z: 3620 }, // UNSURE: seer house SE of town
    lalli: { x: 2762, z: 3649 }, // UNSURE: troll cave mouth SE of town
    workman: { x: 2652, z: 3598 }, // UNSURE: bridge on the Seers road
    poison: { x: 2720, z: 3495 }, // UNSURE: Seers tavern area
};
const NPC_RE: Record<string, RegExp> = {
    brundt: /brundt/i,
    manni: /manni/i,
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

async function go(ctx: QuestContext, hops: Tile[], dest: Tile): Promise<void> {
    await closeUi(bot, sdk).catch(() => undefined);
    await walkSendHops(sdk, hops, dest, 5);
}

async function goNpc(ctx: QuestContext, key: string): Promise<boolean> {
    const anchor = NPC_ANCHOR[key]!;
    await go(ctx, [anchor], anchor);
    await sdk.scanNearbyLocs(12).catch(() => undefined);
    const npc = sdk.findNearbyNpc(NPC_RE[key]!);
    if (!npc) ctx.log(`${key}: no NPC matching ${String(NPC_RE[key])} @ ${here()}`);
    return !!npc;
}

async function talk(ctx: QuestContext, key: string, choices: Array<string | RegExp> = []): Promise<string> {
    if (!(await goNpc(ctx, key))) return '';
    return talkAndChoose(ctx, NPC_RE[key]!, choices);
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
    const a = invItem(useRe);
    const b = invItem(onRe);
    if (!a || !b) {
        ctx.log(`combine: missing ${!a ? String(useRe) : String(onRe)}`);
        return false;
    }
    await closeUi(bot, sdk).catch(() => undefined);
    await sdk.sendUseItemOnItem(a.slot, b.slot);
    await ticks(3);
    return true;
}

async function useOnLoc(ctx: QuestContext, itemRe: RegExp, locRe: RegExp, locOption?: RegExp): Promise<boolean> {
    await sdk.scanNearbyLocs(12).catch(() => undefined);
    const loc = findLoc(locRe, locOption);
    if (!loc) {
        const names = (sdk.getNearbyLocs() ?? []).map((l) => l.name).join(',');
        ctx.log(`useOnLoc: no loc ${String(locRe)} nearby (saw: ${names.slice(0, 160)})`);
        return false;
    }
    const r = await bot.useItemOnLoc(itemRe, loc as never, { timeout: 15_000 } as never).catch((e: unknown) => ({ success: false, message: String(e) }));
    if (!(r as { success?: boolean }).success) ctx.log(`useOnLoc ${(r as { message?: string }).message ?? 'failed'}`);
    await ticks(2);
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
    if (missing.length > 0) ctx.log(`pack still missing: ${missing.map((m) => m.label).join(',')}`);
    return missing.length === 0;
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
        detect: () => !prog.started,
        run: async (ctx) => {
            scanVotes(ctx);
            if (prog.started) return;
            if (!gate(ctx)) {
                ctx.log('stat gate: need WC40/Craft40/Fletch25 (assignment-level) — stuck');
                await ticks(20);
                return;
            }
            const seen = await talk(ctx, 'brundt', [/quests?/, /interested/, /want to become/]);
            if (/seven|twelve|become a fremennik/i.test(seen)) {
                prog.started = true;
                saveProg();
            }
        },
    },
    // -- Peer: riddle + water puzzle -----------------------------------------
    {
        id: 'peer',
        detect: () => prog.started && !prog.votes.peer,
        run: async (ctx) => {
            scanVotes(ctx);
            if (prog.votes.peer) return;
            if (!bump('peer', 30)) {
                ctx.log('peer: attempt cap reached, waiting');
                await ticks(30);
                return;
            }
            const snap = snapshotGear();
            if (!(await depositAll(ctx))) return;
            // Accept the challenge (banks via depositAll already done).
            await talk(ctx, 'peer', [/^yes$/i]);
            // Riddle door.
            await go(ctx, [NPC_ANCHOR.peer!], NPC_ANCHOR.peer!);
            await sdk.scanNearbyLocs(15).catch(() => undefined);
            const door = findLoc(/^door$/i);
            if (!door) {
                ctx.log(`peer: no house door @ ${here()}`);
                await restoreGear(ctx, snap);
                return;
            }
            await bot.interactLoc(door as never, 1 as never);
            await ticks(2);
            await sdk.clickDialogByText(/read the riddle/i).catch(() => undefined);
            await ticks(2);
            const riddle = visibleText(sdk, 10);
            const answer = riddleAnswer(riddle);
            ctx.log(`peer riddle: ${answer ?? 'UNREAD — interface dump follows'}`);
            if (!answer) {
                await bot.closeInterface().catch(() => undefined);
                await restoreGear(ctx, snap);
                return;
            }
            await sdk.clickDialogByText(/solve the riddle/i).catch(() => undefined);
            await ticks(3);
            if (!(await solveDial(ctx, answer))) {
                ctx.log('peer: dial solve failed — will retry');
                await bot.closeInterface().catch(() => undefined);
                await restoreGear(ctx, snap);
                return;
            }
            // Inside: work the fixed puzzle sequence.
            if (!(await peerPuzzle(ctx))) {
                await restoreGear(ctx, snap);
                return;
            }
            scanVotes(ctx);
            await restoreGear(ctx, snap);
        },
    },
    // -- Olaf: lyre chain -----------------------------------------------------
    {
        id: 'olaf',
        detect: () => prog.started && prog.votes.peer && !prog.votes.olaf,
        run: async (ctx) => {
            scanVotes(ctx);
            if (prog.votes.olaf) return;
            if (!(await ensurePack(ctx))) {
                ctx.log('olaf: pack incomplete and bank cannot supply it — stuck');
                await ticks(20);
                return;
            }
            if (!bump('olaf', 30)) {
                await ticks(30);
                return;
            }
            await talk(ctx, 'olaf', [/^yes$/i]); // accept
            // Pet rock + Lalli's stew -> golden fleece.
            if (count(GOLDEN_FLEECE) + count(GOLDEN_WOOL) + count(UNSTRUNG_LYRE) + count(STRUNG_LYRE) + count(ENCHANTED_LYRE) === 0) {
                await talk(ctx, 'lalli', [/other human/i]);
                await talk(ctx, 'askeladden', []);
                if (count(PET_ROCK) === 0) {
                    ctx.log('olaf: Askeladden gave no pet rock');
                    return;
                }
                await talk(ctx, 'lalli', []);
                for (const veg of [PET_ROCK, CABBAGE, POTATO, ONION]) {
                    await go(ctx, [NPC_ANCHOR.lalli!], NPC_ANCHOR.lalli!);
                    await useOnLoc(ctx, veg, /^lalli's stew$/i);
                }
                await talk(ctx, 'lalli', []);
            }
            // Spin fleece at the Seers wheel.
            if (count(GOLDEN_WOOL) === 0 && count(GOLDEN_FLEECE) > 0) {
                await go(ctx, [SEERS], { x: 2712, z: 3472 }); // UNSURE wheel tile
                await useOnLoc(ctx, GOLDEN_FLEECE, /spinning wheel/i);
            }
            // Chop the swaying tree east of town (WC 40, needs axe).
            if (count(BRANCH) === 0 && count(UNSTRUNG_LYRE) + count(STRUNG_LYRE) + count(ENCHANTED_LYRE) === 0) {
                await scanAround(ctx, { x: 2703, z: 3602 }); // UNSURE tree tile
                await sdk.scanNearbyLocs(15).catch(() => undefined);
                const tree = findLoc(/swaying tree/i, /chop/i) ?? findLoc(/swaying tree/i);
                if (tree) {
                    await bot.interactLoc(tree as never, /chop/i as never);
                    await waitUntil(() => count(BRANCH) > 0, 60_000);
                } else ctx.log('olaf: no swaying tree nearby');
            }
            // Knife + branch -> unstrung; wool + unstrung -> strung.
            if (count(UNSTRUNG_LYRE) === 0 && count(STRUNG_LYRE) + count(ENCHANTED_LYRE) === 0 && count(BRANCH) > 0) {
                await combine(ctx, KNIFE, BRANCH);
            }
            if (count(STRUNG_LYRE) + count(ENCHANTED_LYRE) === 0 && count(UNSTRUNG_LYRE) > 0) {
                await combine(ctx, GOLDEN_WOOL, UNSTRUNG_LYRE);
            }
            // Raw shark on the strange altar -> enchanted lyre.
            if (count(ENCHANTED_LYRE) === 0 && count(STRUNG_LYRE) > 0) {
                await scanAround(ctx, { x: 2612, z: 3608 }); // UNSURE altar tile
                await useOnLoc(ctx, RAW_SHARK, /strange altar/i);
            }
            // Perform on the longhall stage.
            if (count(ENCHANTED_LYRE) > 0) {
                await go(ctx, [LONGHALL, STAGE], STAGE);
                await sdk.scanNearbyLocs(12).catch(() => undefined);
                const stageDoor = findLoc(/^door$/i);
                if (stageDoor && Math.hypot(pos().x - STAGE.x, pos().z - STAGE.z) > 6) {
                    await bot.interactLoc(stageDoor as never, 1 as never);
                    await ticks(3);
                    await go(ctx, [STAGE], STAGE);
                }
                await operate(ctx, ENCHANTED_LYRE);
                await waitUntil(() => /completed the bard'?s trial/i.test(visibleText(sdk, 30)), 90_000);
            }
            scanVotes(ctx);
        },
    },
    // -- Sigli: Draugen hunt ---------------------------------------------------
    {
        id: 'sigli',
        detect: () => prog.started && prog.votes.peer && prog.votes.olaf && !prog.votes.sigli,
        run: async (ctx) => {
            scanVotes(ctx);
            if (prog.votes.sigli) return;
            if (!(await ensurePack(ctx))) return;
            if (!bump('sigli', 30)) {
                await ticks(30);
                return;
            }
            await talk(ctx, 'sigli', [/^yes$/i, /draugen/i]); // accept + talisman
            if (count(TALISMAN) === 0) {
                ctx.log('sigli: no talisman — re-talk');
                await talk(ctx, 'sigli', []);
                if (count(TALISMAN) === 0) return;
            }
            if (await huntDraugen(ctx)) {
                await talk(ctx, 'sigli', []);
                scanVotes(ctx);
            }
        },
    },
    // -- Manni: drinking contest -------------------------------------------------
    {
        id: 'reveller',
        detect: () => prog.started && prog.votes.peer && prog.votes.olaf && prog.votes.sigli && !prog.votes.reveller,
        run: async (ctx) => {
            scanVotes(ctx);
            if (prog.votes.reveller) return;
            if (!(await ensurePack(ctx))) return;
            if (!bump('reveller', 30)) {
                await ticks(30);
                return;
            }
            await talk(ctx, 'manni', [/^yes$/i]); // accept contest
            // Keg from the longhall table.
            if (count(BEER_KEG) === 0) {
                await go(ctx, [LONGHALL, KEG_TABLE], KEG_TABLE);
                const keg = await bot.pickupItem(BEER_KEG).catch(() => ({ success: false }));
                if (!(keg as { success?: boolean }).success) ctx.log('reveller: keg pickup failed');
            }
            // Strange object from the workman for a beer.
            if (count(FIRECRACKER) + count(LIT_CRACKER) === 0) {
                await go(ctx, [NPC_ANCHOR.workman!], NPC_ANCHOR.workman!);
                await sdk.scanNearbyLocs(10).catch(() => undefined);
                const man = sdk.findNearbyNpc(/workman/i);
                if (man) await bot.useItemOnNpc(BEER, man as never).catch(() => undefined);
                await ticks(3);
            }
            // Low-alcohol keg from the poison salesman (250 coins).
            if (count(LOW_KEG) === 0) {
                await go(ctx, [NPC_ANCHOR.poison!], NPC_ANCHOR.poison!);
                await talk(ctx, 'poison', [/fremennik trials/i, /^yes$/i]);
                if (count(LOW_KEG) === 0) await talk(ctx, 'poison', [/low alcohol/i, /^yes$/i]);
            }
            // Light, plant, swap — all inside the longhall.
            await go(ctx, [LONGHALL], LONGHALL);
            if (count(LIT_CRACKER) === 0 && count(FIRECRACKER) > 0) {
                await combine(ctx, TINDERBOX, FIRECRACKER);
            }
            if (count(LIT_CRACKER) > 0) {
                await sdk.scanNearbyLocs(12).catch(() => undefined);
                const pipe = findLoc(/^pipe$/i);
                if (pipe) {
                    await bot.interactLoc(pipe as never, 1 as never);
                    await ticks(3);
                }
            }
            if (count(LOW_KEG) > 0 && count(BEER_KEG) > 0) {
                await combine(ctx, BEER_KEG, LOW_KEG);
                await ticks(3);
            }
            // Drink.
            if (count(BEER_KEG) > 0) {
                await talk(ctx, 'manni', [/^yes$/i]);
                await waitUntil(() => /completed the revellers'? trial/i.test(visibleText(sdk, 30)), 60_000);
            }
            scanVotes(ctx);
        },
    },
    // -- Swensen: maze -----------------------------------------------------------
    {
        id: 'swensen',
        detect: () => prog.started && prog.votes.peer && prog.votes.olaf && prog.votes.sigli && prog.votes.reveller && !prog.votes.swensen,
        run: async (ctx) => {
            scanVotes(ctx);
            if (prog.votes.swensen) return;
            if (!(await ensurePack(ctx))) return;
            if (!bump('swensen', 10)) {
                await ticks(30);
                return;
            }
            await talk(ctx, 'swensen', [/^yes$/i]); // accept maze
            await go(ctx, [SWENSEN_HOUSE], SWENSEN_HOUSE);
            await sdk.scanNearbyLocs(12).catch(() => undefined);
            const down = findLoc(/^ladder$/i);
            if (down) {
                await bot.interactLoc(down as never, 1 as never);
                await ticks(4);
            }
            await exploreMaze(ctx);
            scanVotes(ctx);
        },
    },
    // -- Sigmund: merchant chain ---------------------------------------------------
    {
        id: 'sigmund',
        detect: () =>
            prog.started &&
            prog.votes.peer &&
            prog.votes.olaf &&
            prog.votes.sigli &&
            prog.votes.reveller &&
            prog.votes.swensen &&
            !prog.votes.sigmund,
        run: async (ctx) => {
            scanVotes(ctx);
            if (prog.votes.sigmund) return;
            if (!(await ensurePack(ctx))) return;
            if (!bump('sigmund', 30)) {
                await ticks(30);
                return;
            }
            const MERCH: Array<string | RegExp>[] = [[/merchant/i]];
            // Forward: advance every link's progress flag in chain order.
            await talk(ctx, 'sigmund', [/^yes$/i]);
            for (const key of ['sailor', 'olaf', 'yrsa', 'brundt', 'sigli', 'skulgrimen', 'fisherman', 'swensen', 'peer', 'thorvald', 'manni', 'barkeep'] as const) {
                await talk(ctx, key, MERCH[0]!);
            }
            // Askeladden sells the written promise for 5000 coins.
            await talk(ctx, 'askeladden', [/^yes$/i]);
            // Backward: trade each good up the chain.
            for (const key of ['barkeep', 'manni', 'thorvald', 'peer', 'swensen', 'fisherman', 'skulgrimen', 'sigli', 'brundt', 'yrsa', 'olaf', 'sailor', 'sigmund'] as const) {
                if (prog.votes.sigmund) break;
                await talk(ctx, key, MERCH[0]!);
                scanVotes(ctx);
            }
            scanVotes(ctx);
        },
    },
    // -- Thorvald: Koschei, unarmed (AFTER the chain trade) -------------------------
    {
        id: 'thorvald',
        detect: () => prog.started && prog.votes.sigmund && !prog.votes.thorvald,
        run: async (ctx) => {
            scanVotes(ctx);
            if (prog.votes.thorvald) return;
            if (!bump('thorvald', 20)) {
                await ticks(30);
                return;
            }
            const snap = snapshotGear();
            // Talk first (accept) while geared — deposit after, at Seers.
            await talk(ctx, 'thorvald', [/^yes$/i]);
            if (!(await depositAll(ctx))) return;
            await go(ctx, [NPC_ANCHOR.thorvald!], NPC_ANCHOR.thorvald!);
            await sdk.scanNearbyLocs(12).catch(() => undefined);
            const ladder = findLoc(/^ladder$/i);
            if (!ladder) {
                ctx.log(`thorvald: no arena ladder @ ${here()}`);
                await restoreGear(ctx, snap);
                return;
            }
            await bot.interactLoc(ladder as never, 1 as never);
            await ticks(5);
            const deadline = Date.now() + 15 * 60_000;
            while (Date.now() < deadline) {
                scanVotes(ctx);
                if (prog.votes.thorvald) break;
                if (pos().isDead) {
                    await waitUntil(() => !pos().isDead, 45_000);
                    continue;
                }
                const foe = sdk.findNearbyNpc(/koschei/i);
                if (foe) {
                    await bot.attack(foe as never).catch(() => undefined);
                } else {
                    // Knocked out of the arena (honour-death ports out) or waiting on a spawn.
                    await sdk.scanNearbyLocs(10).catch(() => undefined);
                    const up = findLoc(/^ladder$/i);
                    if (up && !sdk.findNearbyNpc(/thorvald/i)) {
                        await bot.interactLoc(up as never, 1 as never);
                        await ticks(4);
                    } else {
                        await talk(ctx, 'thorvald', []);
                        await ticks(5);
                    }
                }
                await ticks(5);
            }
            scanVotes(ctx);
            await restoreGear(ctx, snap);
        },
    },
    // -- Finish: Brundt completes at 7 votes ---------------------------------------
    {
        id: 'finish',
        detect: () => prog.started && voteCount() >= 7,
        run: async (ctx) => {
            await talk(ctx, 'brundt', []);
            await waitForQuestComplete(ctx, /fremennik/i, 10_000);
        },
    },
];

// ---------------------------------------------------------------------------
// Riddle + Peer puzzle + Draugen hunt + maze explorer.
// ---------------------------------------------------------------------------

function riddleAnswer(text: string): string | null {
    const t = text.toLowerCase();
    if (/mage.*goblin|powerful[\s\S]*tool/.test(t)) return 'MIND';
    if (/swamp.*camp.*eagle.*hate.*rings/.test(t)) return 'TREE';
    if (/well.*sea.*stolen[\s\S]*death/.test(t)) return 'LIFE';
    if (/fish.*birds.*doors.*everything.*food/.test(t)) return 'FIRE';
    if (/water.*tea.*mountains.*strike.*crushes/.test(t)) return 'TIME';
    if (/wizard.*jail.*anger.*drawing.*bread/.test(t)) return 'WIND';
    return null;
}

/**
 * Combination-lock door. UNSURE (blind): the dial letters live on
 * combolockdoor:com_43..46 and com_47..54 step the four dials. Parse the
 * published interface options for single letters + steppers, click each dial
 * up to its target, submit, verify. Every attempt is harmless (a wrong code
 * just says "failed to solve").
 */
async function solveDial(ctx: QuestContext, answer: string): Promise<boolean> {
    const target = [...answer].map((c) => c.charCodeAt(0) - 65); // 0-indexed A=0
    for (let attempt = 0; attempt < 3; attempt++) {
        const iface = sdk.getState()?.interface;
        const opts = (iface as { options?: Array<{ text?: string; componentId?: number }> } | null)?.options ?? [];
        ctx.log(`dial ui: ${opts.map((o) => `${o.componentId ?? '?'}:${(o.text ?? '').slice(0, 12)}`).join(' | ').slice(0, 300)}`);
        const letters = opts.filter((o) => /^[a-z]$/i.test((o.text ?? '').trim()));
        if (letters.length < 4) {
            await ticks(3);
            continue;
        }
        let ok = true;
        for (let d = 0; d < 4; d++) {
            const cur = (letters[d]!.text ?? 'A').trim().toUpperCase().charCodeAt(0) - 65;
            let need = (target[d]! - cur + 26) % 26;
            let guard = 30;
            while (need > 0 && guard-- > 0) {
                const steppers = ((sdk.getState()?.interface as never) as { options?: Array<{ text?: string }> } | null)?.options ?? [];
                const up = steppers.find((o) => /up|\+|>|▲/i.test(o.text ?? ''));
                if (!up) {
                    ok = false;
                    break;
                }
                await sdk.clickInterfaceOption(up as never).catch(() => undefined);
                await ticks(2);
                need--;
            }
            if (!ok) break;
        }
        if (!ok) continue;
        const submit = ((sdk.getState()?.interface as never) as { options?: Array<{ text?: string }> } | null)?.options?.find((o) =>
            /solv|confirm|enter|ok/i.test(o.text ?? '')
        );
        if (submit) await sdk.clickInterfaceOption(submit as never).catch(() => undefined);
        await ticks(3);
        if (/solved the riddle/i.test(visibleText(sdk, 10))) return true;
    }
    return /solved the riddle/i.test(visibleText(sdk, 20));
}

/** Fixed Peer-house sequence. Returns true when the exit door opens the vote. */
async function peerPuzzle(ctx: QuestContext): Promise<boolean> {
    const have = (re: RegExp) => count(re) > 0;
    // Collect room items.
    const pickups: Array<{ loc: RegExp; want: RegExp }> = [
        { loc: /^bookcase$/i, want: RED_HERRING },
        { loc: /^crate$/i, want: /small pick|toy ship/i },
        { loc: /^boxes$/i, want: /magnet|blue thread/i },
        { loc: /^chest$/i, want: JUG_EMPTY },
        { loc: /^cupboard$/i, want: BUCKET_EMPTY },
        { loc: /^bull's head$/i, want: WOOD_DISK },
        { loc: /^unicorn's head$/i, want: RED_DISK },
    ];
    for (const p of pickups) {
        if (have(p.want)) continue;
        await sdk.scanNearbyLocs(12).catch(() => undefined);
        const loc = findLoc(p.loc);
        if (!loc) {
            ctx.log(`puzzle: no ${String(p.loc)} nearby`);
            continue;
        }
        await bot.interactLoc(loc as never, /search|take|open/i as never).catch(() => undefined);
        await bot.interactLoc(loc as never, 1 as never).catch(() => undefined);
        await ticks(4);
    }
    // Cook the red herring -> herring + red goop; paint the wooden disk.
    if (have(RED_HERRING)) await useOnLoc(ctx, RED_HERRING, /cooking range/i);
    if (have(GOOP) && have(WOOD_DISK)) await combine(ctx, GOOP, WOOD_DISK);
    // Both red disks on the mural -> vase lid.
    for (let i = 0; i < 2 && count(RED_DISK) > 0; i++) {
        await useOnLoc(ctx, RED_DISK, /abstract mural/i);
    }
    // Water arithmetic: jug_3 on empty bucket -> bucket_3; jug_3 on
    // bucket_3 -> bucket_5 + jug_1; drain bucket_5; jug_1 on empty bucket ->
    // bucket_1; jug_3 on bucket_1 -> bucket_4.
    if (!have(JUG3) && have(JUG_EMPTY)) await useOnLoc(ctx, JUG_EMPTY, /^tap$/i);
    if (!have(BUCKET5) && !have(BUCKET4) && have(BUCKET_EMPTY)) await useOnLoc(ctx, BUCKET_EMPTY, /^tap$/i);
    if (have(JUG3) && have(BUCKET_EMPTY) && !have(BUCKET3)) await combine(ctx, JUG3, BUCKET_EMPTY);
    if (!have(JUG3) && have(JUG_EMPTY)) await useOnLoc(ctx, JUG_EMPTY, /^tap$/i);
    if (have(JUG3) && have(BUCKET3)) await combine(ctx, JUG3, BUCKET3);
    if (have(BUCKET5)) await useOnLoc(ctx, BUCKET5, /^drain$/i);
    if (have(JUG1) && have(BUCKET_EMPTY) && !have(BUCKET1)) await combine(ctx, JUG1, BUCKET_EMPTY);
    if (!have(JUG3) && have(JUG_EMPTY)) await useOnLoc(ctx, JUG_EMPTY, /^tap$/i);
    if (have(JUG3) && have(BUCKET1)) await combine(ctx, JUG3, BUCKET1);
    // bucket_4 on the scales chest -> vase. Two chests share a name; try both.
    if (have(BUCKET4)) {
        await sdk.scanNearbyLocs(12).catch(() => undefined);
        for (const loc of (sdk.getNearbyLocs() ?? []).filter((l) => /^chest$/i.test(l.name ?? ''))) {
            await bot.useItemOnLoc(BUCKET4, loc as never).catch(() => undefined);
            await ticks(3);
            if (have(VASE)) break;
        }
    }
    // Fill vase, seal with lid, freeze, melt, unlock.
    if (have(VASE)) await useOnLoc(ctx, VASE, /^tap$/i);
    if (have(VASE_WATER) && have(VASE_LID)) await combine(ctx, VASE_LID, VASE_WATER);
    if (have(SEALED_WATER)) await useOnLoc(ctx, SEALED_WATER, /frozen table/i);
    if (have(FROZEN_KEY)) await useOnLoc(ctx, FROZEN_KEY, /cooking range/i);
    if (have(SEER_KEY)) {
        await sdk.scanNearbyLocs(12).catch(() => undefined);
        for (const loc of (sdk.getNearbyLocs() ?? []).filter((l) => /^door$/i.test(l.name ?? ''))) {
            await bot.useItemOnLoc(SEER_KEY, loc as never).catch(() => undefined);
            await ticks(3);
            if (/solved my puzzle so quickly/i.test(visibleText(sdk, 10))) return true;
            await bot.interactLoc(loc as never, 1 as never).catch(() => undefined);
            await ticks(3);
            if (/solved my puzzle so quickly/i.test(visibleText(sdk, 10))) return true;
        }
    }
    return /solved my puzzle so quickly/i.test(visibleText(sdk, 20));
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
    while (Date.now() < deadline) {
        if (pos().isDead) {
            await waitUntil(() => !pos().isDead, 45_000);
            continue;
        }
        await eat(ctx);
        const before = visibleText(sdk, 5);
        if (!(await operate(ctx, TALISMAN))) return false;
        await waitUntil(() => visibleText(sdk, 5) !== before, 8_000);
        const text = visibleText(sdk, 8);
        if (/absorb the draugen'?s essence|already captured/i.test(text)) return true;
        if (/draugen is here|beware/i.test(text)) {
            const draugen = sdk.findNearbyNpc(/draugen/i);
            if (draugen) {
                await bot.attack(draugen as never).catch(() => undefined);
                const killed = await waitUntil(
                    () => /absorb the draugen'?s essence/i.test(visibleText(sdk, 8)),
                    120_000
                );
                if (killed) return true;
            } else {
                await go(ctx, [{ x: pos().x + 6, z: pos().z }], { x: pos().x + 6, z: pos().z });
            }
            continue;
        }
        const dir = (Object.keys(DIRS) as Array<keyof typeof DIRS>).find((d) =>
            new RegExp(`guides you ${d}`, 'i').test(text)
        );
        if (dir) {
            const v = DIRS[dir]!;
            const dest = { x: pos().x + v.dx * 12, z: pos().z + v.dz * 12 };
            await go(ctx, [dest], dest);
            continue;
        }
        // "moved elsewhere" (or unreadable): sweep the next butterfly ground.
        const next = BUTTERFLIES[spot++ % BUTTERFLIES.length]!;
        await go(ctx, [next], next);
    }
    return false;
}

/**
 * Blind maze DFS. UNSURE: layout unknown; wrong portals are click-only so
 * they are never touched, ladders are tried one by one (escape/entrance
 * ladders just resurface at the house and the search continues).
 */
async function exploreMaze(ctx: QuestContext): Promise<void> {
    const deadline = Date.now() + 12 * 60_000;
    const visited = new Set<string>();
    const key = (x: number, z: number, l: number) => `${l}:${Math.round(x / 4)},${Math.round(z / 4)}`;
    const triedLadders = new Set<string>();
    while (Date.now() < deadline) {
        scanVotes(ctx);
        if (prog.votes.swensen) return;
        const p = pos();
        if (p.level === 0) {
            // Surfaced without the vote (escape/entrance ladder): go back down.
            await go(ctx, [SWENSEN_HOUSE], SWENSEN_HOUSE);
            await sdk.scanNearbyLocs(12).catch(() => undefined);
            const down = findLoc(/^ladder$/i);
            if (!down) {
                await ticks(10);
                continue;
            }
            await bot.interactLoc(down as never, 1 as never);
            await ticks(4);
            continue;
        }
        visited.add(key(p.x, p.z, p.level));
        await sdk.scanNearbyLocs(15).catch(() => undefined);
        for (const loc of (sdk.getNearbyLocs() ?? []).filter((l) => /^ladder$/i.test(l.name ?? ''))) {
            const lk = `${Math.round((loc as { x?: number }).x ?? 0)},${Math.round((loc as { z?: number }).z ?? 0)}`;
            if (triedLadders.has(lk)) continue;
            triedLadders.add(lk);
            await bot.interactLoc(loc as never, 1 as never);
            await ticks(5);
            scanVotes(ctx);
            if (prog.votes.swensen) return;
            break;
        }
        // Step to an unvisited neighbour via the client pathfinder.
        let moved = false;
        for (const [dx, dz] of [[8, 0], [-8, 0], [0, 8], [0, -8], [8, 8], [-8, -8], [8, -8], [-8, 8]]) {
            const nx = p.x + (dx as number);
            const nz = p.z + (dz as number);
            if (visited.has(key(nx, nz, p.level))) continue;
            let path: Tile[] | null = null;
            try {
                path = findLongPath(p.level, p.x, p.z, nx, nz) as Tile[] | null;
            } catch { /* ignore */ }
            if (!path || path.length === 0) continue;
            await walkSendHops(sdk, path.slice(0, 8), path[Math.min(7, path.length - 1)] as Tile, 3);
            moved = true;
            break;
        }
        if (!moved) await sdk.sendWalk(p.x + 4, p.z, true).catch(() => undefined);
        await ticks(3);
    }
    ctx.log('maze: explorer timed out — will retry');
}

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
} else {
try {
    while (!session.isStoppedOrRequested()) {
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
        });
        if (outcome === 'complete') {
            session.stop('done', 'fremennik-trials complete', { restartable: false });
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
}
