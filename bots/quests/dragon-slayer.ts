/**
 * Dragon Slayer — quest script (quest-lib framework).
 *
 *   bun bots/quests/dragon-slayer.ts {botname}
 *
 * Chain (server: server/content/scripts/quests/quest_dragon/):
 *   Guildmaster (Champions' Guild) -> Oziach (Edgeville hut, full briefing:
 *   maze key + oracle/goblin/shield flags) -> Duke of Lumbridge (anti-dragon
 *   shield) -> Oracle (Ice Mountain) -> Dwarven Mine magic door (wizard's mind
 *   bomb + unfired bowl + lobster pot + silk, all consumed) -> chest mappart3
 *   -> Wormbrain (Port Sarim jail, buy mappart2 for 10k or kill) -> Melzar's
 *   maze (maze key in, kill rat/ghost/skeleton/zombie/Melzar/demon for
 *   red/orange/yellow/blue/magenta/green keys, chest mappart1) -> combine 3
 *   parts -> buy Lady Lumbridge from Klarense (2000) -> repair hull (3 planks,
 *   4 nails + hammer each) -> Ned (Draynor, show map) -> board ship, sail with
 *   Ned aboard -> Crandor traverse (rock opening -> rope -> secret door ->
 *   gates) -> Elvarg (melee, anti-dragon shield EQUIPPED).
 *
 * Completion is gated ONLY on the server quest-complete message
 * (waitForQuestComplete inside questLoop). Stages are idempotent and resume by
 * re-detection (inventory + position + nearby NPCs/locs + recent chat).
 *
 * Assignment-level gates (NOT runtime): 32 QP, combat to kill Elvarg (lvl 83,
 * max fire hit 70 unshielded / 10 shielded), 10k coins path for Wormbrain.
 */
import { ActivitySession, BotSDK, deriveGatewayUrl } from '../../sdk/index';
import { installGracefulShutdown } from '../../sdk/runner';
import { ensureBankStart, nearestBank, parkAtBank } from './safe-stops';
import { BotActions } from '../../sdk/actions';
import { initPathfinding } from '../../sdk/pathfinding';
import { existsSync, readFileSync } from 'fs';
import { dirname, join } from 'path';
import { walkNear, walkSendHops } from './movement';
import {
    countItems,
    questLoop,
    talkAndChoose,
    visibleText,
    waitForQuestComplete,
    type QuestContext,
    type QuestStage
} from './quest-lib';
import { ensureSupplied, type SupplyNeed } from './supply';

/* ---------------- locations (walk targets; fine work via NPC/loc scan) ---------------- */

const DRAYNOR_BANK = { x: 3092, z: 3243 };
const NED_DRAYNOR = { x: 3100, z: 3258 };
const CHAMPIONS_GUILD = { x: 3191, z: 3362 }; // guildmaster spawn (wiki)
const OZIACH = { x: 3069, z: 3517 }; // hut west of Edgeville (wiki)
const DUKE_GROUND = { x: 3210, z: 3222 }; // Lumbridge castle; Duke is level 1
const KLARENSE = { x: 3047, z: 3204 }; // Port Sarim docks (wiki)
const SARIM_JAIL = { x: 3012, z: 3188 }; // Port Sarim jail (Wormbrain cell)
const ORACLE_HUT = { x: 3086, z: 3674 }; // Ice Mountain top
const DWARF_STAIRS_DOWN = { x: 3059, z: 3376 }; // surface (essence.ts)
const DWARF_STAIRS_UP = { x: 3058, z: 9776 }; // underground (essence.ts)
const DWARF_DOOR_SIDE = { x: 3055, z: 9770 }; // NE section anchor; door via scan
const MELZAR_DOOR = { x: 2926, z: 3355 }; // maze entrance, NW of Rimmington
const ELVARG_LAIR = { x: 2855, z: 9637 }; // server lair zone 44_150 31_28..47_46

const DRAYNOR_TO_SARIM = [
    { x: 3075, z: 3240 },
    { x: 3058, z: 3238 },
    { x: 3045, z: 3236 }
];
const DRAYNOR_TO_CHAMPIONS = [
    { x: 3108, z: 3258 },
    { x: 3130, z: 3280 },
    { x: 3150, z: 3310 },
    { x: 3170, z: 3335 },
    { x: 3185, z: 3352 },
    CHAMPIONS_GUILD
];
const CHAMPIONS_TO_OZIACH = [
    { x: 3180, z: 3390 },
    { x: 3165, z: 3420 },
    { x: 3145, z: 3450 },
    { x: 3120, z: 3475 },
    { x: 3095, z: 3495 },
    { x: 3075, z: 3508 },
    OZIACH
];
const EDGEVILLE_TO_ORACLE = [
    { x: 3090, z: 3520 },
    { x: 3085, z: 3560 },
    { x: 3085, z: 3600 },
    { x: 3086, z: 3635 },
    ORACLE_HUT
];
const SARIM_TO_MELZAR = [
    { x: 3030, z: 3250 },
    { x: 3010, z: 3280 },
    { x: 2985, z: 3310 },
    { x: 2960, z: 3330 },
    { x: 2935, z: 3345 },
    MELZAR_DOOR
];
const DRAYNOR_TO_DWARF = [
    { x: 3070, z: 3260 },
    { x: 3050, z: 3280 },
    { x: 3030, z: 3310 },
    { x: 3035, z: 3345 },
    { x: 3050, z: 3365 },
    DWARF_STAIRS_DOWN
];
const DRAYNOR_TO_LUMBY = [
    { x: 3110, z: 3255 },
    { x: 3140, z: 3245 },
    { x: 3170, z: 3235 },
    { x: 3195, z: 3228 },
    DUKE_GROUND
];

/* ---------------- items ---------------- */

const COINS = /^coins$/i;
const MELZAR_KEY = /^maze key$/i;
const MAP_PART = /^map part$/i;
const MAP_PART1 = MAP_PART; // parts are fungible by name; server tracks ids
const DRAGON_MAP = /crandor map|dragon ?map/i;
const SHIELD = /antidragon/i;
const SILK = /^silk$/i;
const MIND_BOMB = /mind bomb/i;
const UNFIRED_BOWL = /unfired bowl/i;
const LOBSTER_POT = /lobster pot/i;
const PLANK = /plank/i;
const NAILS = /nails/i;
const HAMMER = /^hammer$/i;
const ROPE = /^rope$/i;
const FOOD = /^(shark|lobster|swordfish|tuna|bass|monkfish|salmon|trout|meat pie|plain pizza|pineapple pizza|bread|cake)$/i;
const WEAPONS = [
    /^dragon longsword$/i,
    /^rune scimitar$/i,
    /^rune longsword$/i,
    /^rune sword$/i,
    /^adamant scimitar$/i,
    /^mithril scimitar$/i,
    /scimitar/i
];
const MAZE_KEY_DROP = /^(red|orange|yellow|blue|magenta|green) key$/i;

/* ---------------- bootstrap (law-runes.ts pattern) ---------------- */

const argv = process.argv.slice(2);
const botArg = argv.find((a) => !a.startsWith('-'));

function loadBotEnv(): void {
    const envPath = botArg
        ? join(process.cwd(), 'bots', botArg, 'bot.env')
        : join(dirname(import.meta.path), 'bot.env');
    if (!existsSync(envPath)) {
        throw new Error(`bot.env not found at ${envPath}. Usage: bun bots/quests/dragon-slayer.ts {botname}`);
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
    showChat: false
});

await sdk.connect();
const bot = new BotActions(sdk);
const session = new ActivitySession(sdk, bot, {
    name: 'dragon-slayer',
    grindLogPath: GRIND_LOG,
    stallMs: 360_000,
    maxRecoveryTactics: 8
});

installGracefulShutdown({ graceMs: 660_000 });
if (!(await ensureBankStart(sdk, bot, 'draynor', GRIND_LOG))) {
    session.log('warn', `starting away from Draynor bank @ ${here()} — routing anyway`);
}

const ctx: QuestContext = { sdk, bot, session, log: (m) => session.log('log', m) };

/* ---------------- helpers ---------------- */

function pos() {
    const p = sdk.getState()?.player;
    return {
        x: p?.worldX ?? 0,
        z: p?.worldZ ?? 0,
        level: p?.level ?? 0,
        hp: p?.hp ?? 10,
        maxHp: p?.maxHp ?? 10,
        isDead: p?.isDead ?? false,
        inCombat: (p as { combat?: { inCombat?: boolean } } | undefined)?.combat?.inCombat ?? false
    };
}

function here(): string {
    const p = pos();
    return `${p.x},${p.z}L${p.level}`;
}

function distTo(x: number, z: number): number {
    return Math.hypot(pos().x - x, pos().z - z);
}

function has(p: RegExp): boolean {
    return countItems(sdk, p) > 0;
}

function wornShield(): boolean {
    return sdk.getEquipment().some((i) => (i.count ?? 0) > 0 && SHIELD.test(i.name));
}

function coinCount(): number {
    return sdk.findInventoryItem(COINS)?.count ?? 0;
}

async function until(pred: () => boolean, ms: number): Promise<boolean> {
    try {
        await sdk.waitForCondition(() => pred(), ms);
        return true;
    } catch {
        return pred();
    }
}

function dialogSig(): string {
    const d = sdk.getDialog();
    if (!d?.isOpen) return '';
    return [d.text ?? '', ...(d.allComponents ?? []).map((c) => c.text ?? ''), ...(d.options ?? []).map((o) => `${o.componentId}:${o.text}`)].join('|');
}

async function clickAndAwaitPage(index: number): Promise<void> {
    const prev = dialogSig();
    await sdk.sendClickDialog(index);
    for (let i = 0; i < 12; i++) {
        await sdk.waitForTicks(1);
        const now = dialogSig();
        if (now !== prev && now !== '') return;
    }
}

async function closeUi(): Promise<void> {
    for (let i = 0; i < 6; i++) {
        await bot.dismissBlockingUI();
        const dialog = sdk.getDialog();
        const opts = dialog?.options ?? [];
        if (dialog?.isOpen && (opts.length <= 1 || opts.every((o) => /click here to continue/i.test(o.text)))) {
            await clickAndAwaitPage(opts[0]?.index ?? 0);
            continue;
        }
        const s = sdk.getState();
        if (s?.shop?.isOpen) {
            await bot.closeShop();
            continue;
        }
        const bankOpen = !!(s?.bank?.isOpen || s?.interface?.interfaceId === 5292);
        if (bankOpen || s?.interface?.isOpen) {
            if (bankOpen) await bot.closeBank();
            else await bot.closeInterface();
            continue;
        }
        break;
    }
}

function bankReady(): boolean {
    const s = sdk.getState();
    return !!(s?.bank?.isOpen || s?.interface?.interfaceId === 5292);
}

/** Path-aware travel: walkSendHops only (never long straight chords). */
async function hopTo(hops: Array<{ x: number; z: number }>, dest: { x: number; z: number }): Promise<void> {
    const before = distTo(dest.x, dest.z);
    await walkSendHops(sdk, hops, dest, 4);
    await until(() => distTo(dest.x, dest.z) <= 6, 10_000);
    const after = distTo(dest.x, dest.z);
    if (before <= 10) return;
    if (after >= before - 2) {
        session.noteFailure('no_movement', `hopTo no progress to ${dest.x},${dest.z} (was ${Math.round(before)}, now ${Math.round(after)} @ ${here()})`);
    } else {
        session.noteProgress('location', `hopTo closed to ${Math.round(after)} of ${dest.x},${dest.z}`);
    }
}

async function goto(x: number, z: number, tol = 4): Promise<void> {
    if (distTo(x, z) <= tol) return;
    await walkNear(bot, sdk, x, z, tol);
    if (distTo(x, z) > tol + 4) await hopTo([{ x, z }], { x, z });
}

async function eatIfLow(threshold = 50): Promise<void> {
    const p = pos();
    if (p.isDead || p.hp >= Math.min(threshold, p.maxHp - 4)) return;
    const food = sdk.findInventoryItem(FOOD);
    if (food) await bot.eatFood(food);
}

function tail(): string {
    return visibleText(sdk, 40);
}

function questComplete(): boolean {
    return /quest complete: dragon slayer|completed the\s*dragon slayer|dragon slayer.*complete/i.test(tail());
}

/** On Crandor surface (post-crash) — west of the mainland, north of Karamja. */
function onCrandor(): boolean {
    const p = pos();
    return p.z < 6400 && p.x >= 2800 && p.x < 2900 && p.z >= 3200 && p.z <= 3320;
}

/** Crandor underground tunnels / Elvarg lair region (map 44_150). */
function inCrandorUnderground(): boolean {
    const p = pos();
    return p.x >= 2800 && p.x <= 2920 && p.z >= 9600 && p.z <= 9720;
}

function inElvargLair(): boolean {
    const p = pos();
    return p.x >= 2840 && p.x <= 2870 && p.z >= 9620 && p.z <= 9655;
}

function sailed(): boolean {
    return onCrandor() || inCrandorUnderground() || inElvargLair();
}

function inDwarvenMine(): boolean {
    const p = pos();
    return p.z >= 9600 && p.z <= 9920 && p.x >= 2930 && p.x <= 3072;
}

function inMelzarMaze(): boolean {
    // Maze interior is instanced/offset; detect by nearby maze NPCs instead.
    return !!sdk.findNearbyNpc(/melzar|giant rat|dragonslayer/i);
}

async function setStrengthStyle(): Promise<void> {
    try {
        const styles = sdk.getState()?.combatStyle?.styles ?? [];
        const str = styles.find((s) => s.trainsSkills?.includes('Strength')) ?? styles[0];
        if (str) await sdk.sendSetCombatStyle(str.index);
    } catch {}
}

/* ---------------- bank prep ---------------- */

async function openDraynorBank(): Promise<boolean> {
    if (bankReady()) return true;
    await closeUi();
    if (distTo(DRAYNOR_BANK.x, DRAYNOR_BANK.z) > 8) await hopTo([{ x: 3093, z: 3244 }], DRAYNOR_BANK);
    await sdk.scanNearbyLocs(8).catch(() => {});
    const booth = (sdk.getNearbyLocs() ?? [])
        .filter((l) => /^bank booth$/i.test(l.name) && (l.optionsWithIndex ?? []).some((o) => /use-quickly/i.test(o.text)))
        .sort((a, b) => (a.distance ?? 99) - (b.distance ?? 99))[0];
    if (!booth) return false;
    const quickly = (booth.optionsWithIndex ?? []).find((o) => /use-quickly/i.test(o.text));
    await Promise.race([sdk.sendInteractLoc(booth.x, booth.z, booth.id, quickly?.opIndex ?? 2), new Promise((r) => setTimeout(r, 8_000))]);
    return until(() => bankReady(), 8_000);
}

async function ensureWithdrawn(pattern: RegExp, n: number, label: string): Promise<boolean> {
    if (countItems(sdk, pattern) >= n) return true;
    const w = await bot.withdrawItem(pattern, n);
    await until(() => countItems(sdk, pattern) >= n, 12_000);
    if (countItems(sdk, pattern) < n) {
        session.log('warn', `${label} withdraw short: have=${countItems(sdk, pattern)} need=${n} (${w.message})`);
        return false;
    }
    return true;
}

async function prepAtBank(): Promise<void> {
    await session.setPhase('quest_bank_prep');
    if (sailed() || inElvargLair()) return;
    session.setAnchor(DRAYNOR_BANK.x, DRAYNOR_BANK.z);
    if (!(await openDraynorBank())) {
        session.log('warn', `bank did not open @ ${here()}`);
        return;
    }
    let ok = true;
    ok = (await ensureWithdrawn(COINS, 12_000, 'coins')) && ok;
    ok = (await ensureWithdrawn(SILK, 1, 'silk')) && ok;
    ok = (await ensureWithdrawn(MIND_BOMB, 1, "wizard's mind bomb")) && ok;
    ok = (await ensureWithdrawn(UNFIRED_BOWL, 1, 'unfired bowl')) && ok;
    ok = (await ensureWithdrawn(LOBSTER_POT, 1, 'lobster pot')) && ok;
    ok = (await ensureWithdrawn(PLANK, 3, 'planks')) && ok;
    ok = (await ensureWithdrawn(NAILS, 12, 'nails')) && ok;
    ok = (await ensureWithdrawn(HAMMER, 1, 'hammer')) && ok;
    ok = (await ensureWithdrawn(ROPE, 1, 'rope')) && ok;
    ok = (await ensureWithdrawn(FOOD, 12, 'food')) && ok;
    if (!WEAPONS.some((w) => has(w) || sdk.getEquipment().some((e) => w.test(e.name)))) {
        let armed = false;
        for (const w of WEAPONS) {
            const r = await bot.withdrawItem(w, 1);
            await until(() => has(w), 8_000);
            if (has(w)) {
                armed = true;
                break;
            }
            void r;
        }
        if (!armed) {
            session.log('warn', 'no melee weapon in bank — Elvarg fight needs one');
            ok = false;
        }
    }
    await bot.closeBank();
    await closeUi();
    // Full chain: own bank, then quest mule (QUEST_MULE), then verified shops,
    // dialogs, and ground spawns. Bowl/nails have no verified source — the
    // mule stockpile covers them (nails via smith-order, bowl uncraftable).
    const qctx = { sdk, bot, session, log: (m: string) => session.log('log', m) };
    const mule = process.env.QUEST_MULE || undefined;
    const shopNeeds: SupplyNeed[] = [];
    if (countItems(sdk, MIND_BOMB) < 1) shopNeeds.push({ pattern: MIND_BOMB, count: 1, label: "wizard's mind bomb" });
    if (countItems(sdk, LOBSTER_POT) < 1) shopNeeds.push({ pattern: LOBSTER_POT, count: 1, label: 'lobster pot' });
    if (countItems(sdk, ROPE) < 1) shopNeeds.push({ pattern: ROPE, count: 1, label: 'rope' });
    if (countItems(sdk, UNFIRED_BOWL) < 1) shopNeeds.push({ pattern: UNFIRED_BOWL, count: 1, label: 'unfired bowl' });
    if (countItems(sdk, PLANK) < 3) shopNeeds.push({ pattern: PLANK, count: 3, label: 'plank' });
    if (countItems(sdk, NAILS) < 12) shopNeeds.push({ pattern: NAILS, count: 12, label: 'nails' });
    if (shopNeeds.length > 0) {
        const stillMissing = await ensureSupplied(qctx, shopNeeds, mule ? { mule } : undefined);
        if (stillMissing.length > 0) {
            session.log('warn', `prep still missing: ${stillMissing.map((m) => m.label).join(', ')}`);
            ok = false;
        }
    }
    // Equip weapon now; shield comes from the Duke later.
    for (const w of WEAPONS) {
        const it = sdk.findInventoryItem(w);
        if (it) {
            await bot.equipItem(it);
            break;
        }
    }
    await setStrengthStyle();
    session.log('log', `prep ok=${ok} coins=${coinCount()} food=${countItems(sdk, FOOD)} plank=${countItems(sdk, PLANK)} nails=${countItems(sdk, NAILS)} @ ${here()}`);
}

function prepNeeded(): boolean {
    if (sailed() || questComplete()) return false;
    if (has(DRAGON_MAP)) return false; // past the point of banking bulk quest items
    return (
        coinCount() < 12_000 ||
        !has(SILK) ||
        !has(MIND_BOMB) ||
        !has(UNFIRED_BOWL) ||
        !has(LOBSTER_POT) ||
        countItems(sdk, PLANK) < 3 ||
        countItems(sdk, NAILS) < 12 ||
        !has(HAMMER) ||
        !has(ROPE) ||
        countItems(sdk, FOOD) < 8 ||
        !WEAPONS.some((w) => has(w) || sdk.getEquipment().some((e) => w.test(e.name)))
    );
}

/* ---------------- stages ---------------- */

const stages: QuestStage[] = [
    {
        id: 'bank-prep',
        detect: () => prepNeeded(),
        run: async () => {
            await prepAtBank();
        }
    },
    {
        id: 'start-guildmaster-oziach',
        // Before Oziach's briefing we hold no maze key and no map progress.
        detect: () => !questComplete() && !sailed() && !has(MELZAR_KEY) && !has(MAP_PART) && !has(DRAGON_MAP),
        run: async (c) => {
            await session.setPhase('quest_start');
            if (distTo(CHAMPIONS_GUILD.x, CHAMPIONS_GUILD.z) > 10) {
                await hopTo(DRAYNOR_TO_CHAMPIONS, CHAMPIONS_GUILD);
            }
            await goto(CHAMPIONS_GUILD.x, CHAMPIONS_GUILD.z, 5);
            let seen = await talkAndChoose(c, /guildmaster|guild master/i, [/rune plate/i]);
            c.log(`guildmaster: ${seen.replace(/\s+/g, ' ').slice(0, 300)}`);
            await closeUi();
            // Oziach full briefing: plate -> guildmaster -> prove -> dragon/fun ->
            // where-dragon -> first/second/third piece -> shield -> farewell.
            if (distTo(OZIACH.x, OZIACH.z) > 10) await hopTo(CHAMPIONS_TO_OZIACH, OZIACH);
            await goto(OZIACH.x, OZIACH.z, 5);
            seen = await talkAndChoose(c, /^oziach$/i, [
                /can you sell me some rune plate/i,
                /guildmaster of the champions/i,
                /master detective/i,
                /so how am i meant to prove that/i,
                /a dragon, that sounds like fun/i,
                /will i need anything/i,
                /so where can i find this dragon/i,
                /where is the first piece/i,
                /where is the second piece/i,
                /where is the third piece/i,
                /where can i get an antidragon shield/i,
                /ok i'll try and get everything together/i
            ]);
            c.log(`oziach: ${seen.replace(/\s+/g, ' ').slice(0, 400)}`);
            await closeUi();
            c.log(`after briefing key=${has(MELZAR_KEY)} @ ${here()}`);
            if (!has(MELZAR_KEY) && !has(MAP_PART)) {
                // Re-ask specifically for the key (talk/drop-safe: Oziach hands it).
                seen = await talkAndChoose(c, /^oziach$/i, [
                    /so where can i find this dragon/i,
                    /where is the first piece/i,
                    /ok i'll try and get everything together/i
                ]);
                c.log(`oziach retry: ${seen.replace(/\s+/g, ' ').slice(0, 300)}`);
                await closeUi();
            }
        }
    },
    {
        id: 'shield-duke',
        detect: () => !questComplete() && !sailed() && !has(SHIELD) && !wornShield() && !has(DRAGON_MAP),
        run: async (c) => {
            await session.setPhase('quest_shield');
            if (distTo(DUKE_GROUND.x, DUKE_GROUND.z) > 12) await hopTo(DRAYNOR_TO_LUMBY, DUKE_GROUND);
            await goto(DUKE_GROUND.x, DUKE_GROUND.z, 5);
            // Duke is upstairs (level 1): find a staircase up.
            if (pos().level < 1) {
                await sdk.scanNearbyLocs(10).catch(() => {});
                const stairs = (sdk.getNearbyLocs() ?? [])
                    .filter((l) => /staircase/i.test(l.name) && (l.optionsWithIndex ?? []).some((o) => /climb-up/i.test(o.text)))
                    .sort((a, b) => (a.distance ?? 99) - (b.distance ?? 99))[0];
                if (stairs) {
                    await bot.interactLoc(stairs, /climb-up/i);
                    await until(() => pos().level >= 1, 10_000);
                }
            }
            const seen = await talkAndChoose(c, /duke/i, [/shield that will protect me from the dragon/i]);
            c.log(`duke: ${seen.replace(/\s+/g, ' ').slice(0, 300)} shield=${has(SHIELD)} @ ${here()}`);
            await closeUi();
            if (!has(SHIELD) && !wornShield()) {
                c.log('duke gave no shield — Oziach shield flag may be missing; re-briefing');
                if (distTo(OZIACH.x, OZIACH.z) > 10) await hopTo(CHAMPIONS_TO_OZIACH, OZIACH);
                await goto(OZIACH.x, OZIACH.z, 5);
                const retry = await talkAndChoose(c, /^oziach$/i, [
                    /so how is thy quest going/i,
                    /where can i get an antidragon shield/i,
                    /ok i'll try and get everything together/i
                ]);
                c.log(`oziach shield retry: ${retry.replace(/\s+/g, ' ').slice(0, 300)}`);
                await closeUi();
            }
        }
    },
    {
        id: 'map-oracle-dwarven',
        // mappart3 from the oracle chest behind the Dwarven Mine magic door.
        detect: () =>
            !questComplete() && !sailed() && !has(DRAGON_MAP) && countItems(sdk, MAP_PART) < 3 && (has(SHIELD) || wornShield() || has(MELZAR_KEY)),
        run: async (c) => {
            await session.setPhase('quest_map_oracle');
            if (has(DRAGON_MAP)) return;
            // Skip if we already hold this leg's piece and others are pending:
            // pieces share a name, so only skip when all 3 are held (handled by combine).
            if (!inDwarvenMine() && distTo(ORACLE_HUT.x, ORACLE_HUT.z) > 60) {
                if (distTo(3094, 3492) > 30) {
                    // From the south head toward Edgeville first via Oziach side.
                    if (distTo(OZIACH.x, OZIACH.z) > 40) await hopTo(CHAMPIONS_TO_OZIACH, OZIACH);
                }
                await hopTo(EDGEVILLE_TO_ORACLE, ORACLE_HUT);
            }
            // 1) Oracle briefing (sets %dragon_oracle so the magic door opens).
            if (!inDwarvenMine()) {
                await goto(ORACLE_HUT.x, ORACLE_HUT.z, 5);
                const seen = await talkAndChoose(c, /oracle/i, [/piece of the map to the island of crandor/i]);
                c.log(`oracle: ${seen.replace(/\s+/g, ' ').slice(0, 350)}`);
                await closeUi();
                // 2) Down into the Dwarven Mine (essence.ts stairs).
                if (distTo(DWARF_STAIRS_DOWN.x, DWARF_STAIRS_DOWN.z) > 12) {
                    await hopTo(
                        [
                            { x: 3075, z: 3640 },
                            { x: 3065, z: 3600 },
                            { x: 3060, z: 3550 },
                            { x: 3060, z: 3500 },
                            { x: 3059, z: 3450 },
                            { x: 3059, z: 3410 }
                        ],
                        DWARF_STAIRS_DOWN
                    );
                }
                await goto(DWARF_STAIRS_DOWN.x, DWARF_STAIRS_DOWN.z, 3);
                await sdk.scanNearbyLocs(8).catch(() => {});
                const down =
                    sdk.findNearbyLoc(/stairs/i, { withOption: /climb-down/i }) ?? sdk.findNearbyLoc(/stairs/i);
                if (down) {
                    await bot.interactLoc(down, /climb-down|climb.down/i);
                    await until(() => inDwarvenMine(), 12_000);
                }
            }
            // 3) Magic door: consumes mind bomb + unfired bowl + lobster pot + silk.
            if (inDwarvenMine() && countItems(sdk, MAP_PART) < 3) {
                await goto(DWARF_DOOR_SIDE.x, DWARF_DOOR_SIDE.z, 6);
                await sdk.scanNearbyLocs(12).catch(() => {});
                const door = (sdk.getNearbyLocs() ?? [])
                    .filter((l) => /^door$/i.test(l.name) && (l.optionsWithIndex ?? []).some((o) => /^open$/i.test(o.text)))
                    .sort((a, b) => (a.distance ?? 99) - (b.distance ?? 99))[0];
                if (door) {
                    const before = { x: pos().x, z: pos().z };
                    await bot.interactLoc(door, /^open$/i);
                    await until(() => pos().x !== before.x || pos().z !== before.z, 10_000);
                    const msg = tail();
                    if (/locked/i.test(msg) && (!has(MIND_BOMB) || !has(UNFIRED_BOWL) || !has(LOBSTER_POT) || !has(SILK))) {
                        c.log('magic door locked and oracle items missing — re-prep at bank');
                        await closeUi();
                        return;
                    }
                } else {
                    c.log(`no magic door visible @ ${here()} — oracle flag or position?`);
                }
                // 4) Chest: open then search.
                await sdk.scanNearbyLocs(12).catch(() => {});
                const chest = (sdk.getNearbyLocs() ?? [])
                    .filter((l) => /^chest$/i.test(l.name))
                    .sort((a, b) => (a.distance ?? 99) - (b.distance ?? 99))[0];
                if (chest) {
                    const partsBefore = countItems(sdk, MAP_PART);
                    const openOpt = (chest.optionsWithIndex ?? []).some((o) => /^open$/i.test(o.text));
                    await bot.interactLoc(chest, openOpt ? /^open$/i : /search/i);
                    await sdk.waitForTicks(2);
                    await sdk.scanNearbyLocs(12).catch(() => {});
                    const open = (sdk.getNearbyLocs() ?? [])
                        .filter((l) => /^chest$/i.test(l.name))
                        .sort((a, b) => (a.distance ?? 99) - (b.distance ?? 99))[0];
                    if (open) await bot.interactLoc(open, /search/i);
                    await until(() => countItems(sdk, MAP_PART) > partsBefore, 10_000);
                    c.log(`chest parts=${countItems(sdk, MAP_PART)} @ ${here()}`);
                } else {
                    c.log(`no chest visible @ ${here()}`);
                }
                // Climb back out.
                await goto(DWARF_STAIRS_UP.x, DWARF_STAIRS_UP.z, 4);
                await sdk.scanNearbyLocs(8).catch(() => {});
                const up = sdk.findNearbyLoc(/stairs/i, { withOption: /climb-up/i }) ?? sdk.findNearbyLoc(/stairs/i);
                if (up) {
                    await bot.interactLoc(up, /climb-up|climb.up/i);
                    await until(() => !inDwarvenMine(), 12_000);
                }
            }
            await closeUi();
        }
    },
    {
        id: 'map-wormbrain',
        detect: () =>
            !questComplete() &&
            !sailed() &&
            !has(DRAGON_MAP) &&
            countItems(sdk, MAP_PART) >= 1 &&
            countItems(sdk, MAP_PART) < 3,
        run: async (c) => {
            await session.setPhase('quest_map_wormbrain');
            if (distTo(SARIM_JAIL.x, SARIM_JAIL.z) > 12) {
                if (distTo(3045, 3236) > 40) await hopTo(DRAYNOR_TO_SARIM, { x: 3045, z: 3236 });
                await hopTo([{ x: 3030, z: 3215 }, SARIM_JAIL], SARIM_JAIL);
            }
            await goto(SARIM_JAIL.x, SARIM_JAIL.z, 6);
            const partsBefore = countItems(sdk, MAP_PART);
            // Talk path: buy the piece for 10k.
            let seen = await talkAndChoose(c, /wormbrain/i, [
                /i believe you've got a piece of map/i,
                /i suppose i could pay you/i,
                /alright then, 10,000 it is/i
            ]);
            c.log(`wormbrain: ${seen.replace(/\s+/g, ' ').slice(0, 350)} parts=${countItems(sdk, MAP_PART)} coins=${coinCount()}`);
            await closeUi();
            if (countItems(sdk, MAP_PART) > partsBefore) return;
            // Fallback: server drops mappart2 on Wormbrain death — kill through the bars.
            if (coinCount() < 10_000) c.log('cannot afford Wormbrain (10k) — trying kill fallback');
            for (let i = 0; i < 6 && countItems(sdk, MAP_PART) <= partsBefore; i++) {
                await eatIfLow(60);
                const worm = sdk.findNearbyNpc(/wormbrain/i);
                if (!worm) {
                    c.log(`wormbrain missing @ ${here()}`);
                    break;
                }
                const atk = await bot.attack(worm, 10_000);
                if (!atk.success) c.log(`wormbrain attack: ${atk.message}`);
                await until(() => countItems(sdk, MAP_PART) > partsBefore, 8_000);
                await sdk.scanGroundItems(8).catch(() => {});
                const drop = sdk.findGroundItem(MAP_PART);
                if (drop) await bot.pickupItem(drop);
            }
            void seen;
            await closeUi();
        }
    },
    {
        id: 'map-melzar',
        detect: () =>
            !questComplete() &&
            !sailed() &&
            !has(DRAGON_MAP) &&
            countItems(sdk, MAP_PART) >= 2 &&
            countItems(sdk, MAP_PART) < 3 &&
            has(MELZAR_KEY),
        run: async (c) => {
            await session.setPhase('quest_map_melzar');
            if (distTo(MELZAR_DOOR.x, MELZAR_DOOR.z) > 10) {
                if (distTo(3045, 3236) > 60) await hopTo(DRAYNOR_TO_SARIM, { x: 3045, z: 3236 });
                await hopTo(SARIM_TO_MELZAR, MELZAR_DOOR);
            }
            await goto(MELZAR_DOOR.x, MELZAR_DOOR.z, 4);
            // Enter: use the maze key on the front door.
            if (!inMelzarMaze()) {
                await sdk.scanNearbyLocs(8).catch(() => {});
                const door = sdk.findNearbyLoc(/^door$/i) ?? sdk.findNearbyLoc(/door/i);
                const key = sdk.findInventoryItem(MELZAR_KEY);
                if (door && key) {
                    await bot.useItemOnLoc(key, door);
                    await until(() => inMelzarMaze(), 10_000);
                } else {
                    c.log(`maze entry missing door=${!!door} key=${!!key} @ ${here()}`);
                    return;
                }
            }
            // Maze loop: kill key-holders, loot keys, use on colored doors, loot chest.
            const deadline = Date.now() + 25 * 60_000;
            while (Date.now() < deadline && countItems(sdk, MAP_PART) < 3 && !questComplete()) {
                if (pos().isDead) {
                    await until(() => !pos().isDead, 45_000);
                    break;
                }
                await eatIfLow(60);
                await closeUi();
                await sdk.scanGroundItems(10).catch(() => {});
                const keyDrop = sdk.findGroundItem(MAZE_KEY_DROP);
                if (keyDrop) {
                    await bot.pickupItem(keyDrop);
                    continue;
                }
                const heldKey = sdk.getInventory().find((i) => MAZE_KEY_DROP.test(i.name) && (i.count ?? 0) > 0);
                if (heldKey) {
                    await sdk.scanNearbyLocs(12).catch(() => {});
                    const door =
                        (sdk.getNearbyLocs() ?? [])
                            .filter((l) => /^door$/i.test(l.name))
                            .sort((a, b) => (a.distance ?? 99) - (b.distance ?? 99))[0];
                    if (door) {
                        await goto(door.x, door.z, 2);
                        await bot.useItemOnLoc(heldKey, door);
                        await sdk.waitForTicks(2);
                        continue;
                    }
                }
                await sdk.scanNearbyLocs(12).catch(() => {});
                const chest = (sdk.getNearbyLocs() ?? [])
                    .filter((l) => /^chest$/i.test(l.name))
                    .sort((a, b) => (a.distance ?? 99) - (b.distance ?? 99))[0];
                if (chest && !sdk.findNearbyNpc(/melzar|lesser demon|zombie|skeleton|ghost|giant rat/i)) {
                    const partsBefore = countItems(sdk, MAP_PART);
                    const openOpt = (chest.optionsWithIndex ?? []).some((o) => /^open$/i.test(o.text));
                    await bot.interactLoc(chest, openOpt ? /^open$/i : /search/i);
                    await sdk.waitForTicks(2);
                    await sdk.scanNearbyLocs(12).catch(() => {});
                    const open = (sdk.getNearbyLocs() ?? [])
                        .filter((l) => /^chest$/i.test(l.name))
                        .sort((a, b) => (a.distance ?? 99) - (b.distance ?? 99))[0];
                    if (open) await bot.interactLoc(open, /search/i);
                    await until(() => countItems(sdk, MAP_PART) > partsBefore, 8_000);
                    if (countItems(sdk, MAP_PART) > partsBefore) break;
                }
                const foe =
                    sdk.findNearbyNpc(/melzar the mad/i) ??
                    sdk.findNearbyNpc(/lesser demon/i) ??
                    sdk.findNearbyNpc(/zombie/i) ??
                    sdk.findNearbyNpc(/skeleton/i) ??
                    sdk.findNearbyNpc(/ghost/i) ??
                    sdk.findNearbyNpc(/giant rat/i);
                if (!foe) {
                    c.log(`no maze foe visible @ ${here()} keys=${sdk.getInventory().filter((i) => MAZE_KEY_DROP.test(i.name)).map((i) => i.name).join(',')}`);
                    await sdk.waitForTicks(4);
                    continue;
                }
                const atk = await bot.attack(foe, 15_000);
                if (!atk.success) c.log(`maze foe ${foe.name}: ${atk.message}`);
                await sdk.waitForTicks(2);
            }
            await closeUi();
        }
    },
    {
        id: 'combine-map',
        detect: () => !questComplete() && !sailed() && !has(DRAGON_MAP) && countItems(sdk, MAP_PART) >= 3,
        run: async (c) => {
            await session.setPhase('quest_map_combine');
            await closeUi();
            const parts = sdk.getInventory().filter((i) => MAP_PART.test(i.name) && (i.count ?? 0) > 0);
            if (parts.length >= 2 && parts[0] && parts[1]) {
                // Server: use any part on another with all 3 present -> dragonmap.
                await sdk.sendUseItemOnItem(parts[0].slot, parts[1].slot);
                await until(() => has(DRAGON_MAP), 8_000);
            }
            c.log(`combine map=${has(DRAGON_MAP)} parts=${countItems(sdk, MAP_PART)}`);
        }
    },
    {
        id: 'ship-buy-repair-ned-sail',
        detect: () => !questComplete() && !sailed() && has(DRAGON_MAP),
        run: async (c) => {
            await session.setPhase('quest_ship');
            // 1) Buy from Klarense (dialog differs pre/post purchase; buy only once).
            if (distTo(KLARENSE.x, KLARENSE.z) > 8) {
                if (distTo(3045, 3236) > 40) await hopTo(DRAYNOR_TO_SARIM, { x: 3045, z: 3236 });
                await goto(KLARENSE.x, KLARENSE.z, 5);
            } else {
                await goto(KLARENSE.x, KLARENSE.z, 5);
            }
            let seen = await talkAndChoose(c, /klarense/i, [
                /i don't suppose i could buy it/i,
                /yep, sounds good/i,
                /so; what needs fixing on this ship/i,
                /can i board the ship now/i
            ]);
            c.log(`klarense: ${seen.replace(/\s+/g, ' ').slice(0, 350)} coins=${coinCount()}`);
            await closeUi();
            // 2) Board + repair hull: 3 planks, 4 nails + hammer each (server consumes).
            await sdk.scanNearbyLocs(12).catch(() => {});
            let plank = sdk.findNearbyLoc(/gangplank/i);
            if (plank && !sailed()) {
                await bot.interactLoc(plank, /cross|board/i);
                await sdk.waitForTicks(3);
            }
            await sdk.scanNearbyLocs(12).catch(() => {});
            let ladder = sdk.findNearbyLoc(/ladder/i, { withOption: /climb-down/i }) ?? sdk.findNearbyLoc(/ladder/i);
            if (ladder) {
                await bot.interactLoc(ladder, /climb-down|climb.down/i);
                await sdk.waitForTicks(3);
            }
            for (let i = 0; i < 3; i++) {
                await sdk.scanNearbyLocs(12).catch(() => {});
                const hole = sdk.findNearbyLoc(/hole/i);
                const wood = sdk.findInventoryItem(PLANK);
                if (!hole || !wood) {
                    c.log(`repair iter ${i}: hole=${!!hole} plank=${!!wood} nails=${countItems(sdk, NAILS)}`);
                    break;
                }
                await goto(hole.x, hole.z, 2);
                const r = await bot.useItemOnLoc(wood, hole);
                if (!r.success) c.log(`plank on hole: ${r.message}`);
                await sdk.waitForTicks(2);
            }
            await closeUi();
            // 3) Ned in Draynor: show the map (auto @give_map_to_ned when repaired).
            if (!sailed()) {
                if (distTo(NED_DRAYNOR.x, NED_DRAYNOR.z) > 8) {
                    // Off the ship first if needed.
                    await sdk.scanNearbyLocs(12).catch(() => {});
                    const off = sdk.findNearbyLoc(/gangplank/i);
                    if (off) {
                        await bot.interactLoc(off, /cross|disembark/i);
                        await sdk.waitForTicks(3);
                    }
                    await hopTo(
                        [
                            { x: 3058, z: 3238 },
                            { x: 3075, z: 3240 },
                            { x: 3090, z: 3250 },
                            NED_DRAYNOR
                        ],
                        NED_DRAYNOR
                    );
                }
                await goto(NED_DRAYNOR.x, NED_DRAYNOR.z, 5);
                seen = await talkAndChoose(c, /^ned$/i, [
                    /you're a sailor\? could you take me to the island of crandor/i,
                    /so are you going to take me to crandor island now then/i,
                    /so are you still up to sailing this ship/i
                ]);
                c.log(`ned: ${seen.replace(/\s+/g, ' ').slice(0, 350)} map=${has(DRAGON_MAP)}`);
                await closeUi();
            }
            // 4) Back to the ship, board, climb down, sail with Ned aboard.
            if (!sailed() && !has(DRAGON_MAP)) {
                // Map handed over (var 8) — sail.
                if (distTo(KLARENSE.x, KLARENSE.z) > 10) {
                    await hopTo(DRAYNOR_TO_SARIM, { x: 3045, z: 3236 });
                    await goto(KLARENSE.x, KLARENSE.z, 5);
                }
                await sdk.scanNearbyLocs(12).catch(() => {});
                plank = sdk.findNearbyLoc(/gangplank/i);
                if (plank) {
                    await bot.interactLoc(plank, /cross|board/i);
                    await sdk.waitForTicks(3);
                }
                await sdk.scanNearbyLocs(12).catch(() => {});
                ladder = sdk.findNearbyLoc(/ladder/i, { withOption: /climb-down/i }) ?? sdk.findNearbyLoc(/ladder/i);
                if (ladder) {
                    await bot.interactLoc(ladder, /climb-down|climb.down/i);
                    await until(() => !!sdk.findNearbyNpc(/ned/i), 10_000);
                }
                seen = await talkAndChoose(c, /ned/i, [/yep lets go/i, /not quite ready/i]);
                c.log(`ned aboard: ${seen.replace(/\s+/g, ' ').slice(0, 350)}`);
                // Do NOT close the ship_journey modal mid-voyage (law-runes pattern).
                await until(() => sailed(), 40_000);
                c.log(`after sail sailed=${sailed()} @ ${here()}`);
            } else if (!sailed()) {
                c.log(`map not yet handed over (map=${has(DRAGON_MAP)}) — repair/ned step needs retry`);
            }
            await closeUi();
        }
    },
    {
        id: 'crandor-traverse',
        detect: () => !questComplete() && sailed() && !inElvargLair(),
        run: async (c) => {
            await session.setPhase('quest_crandor');
            await eatIfLow(60);
            if (pos().isDead) {
                await until(() => !pos().isDead, 45_000);
                return;
            }
            // Crash site -> rock opening -> rope -> secret door -> Elvarg gates.
            await sdk.scanNearbyLocs(14).catch(() => {});
            const opening = sdk.findNearbyLoc(/rock.*opening|opening/i);
            const rope = sdk.findNearbyLoc(/climbing rope|rope/i);
            const door = sdk.findNearbyLoc(/secret door|door/i);
            const gate = sdk.findNearbyLoc(/gate/i);
            const target = opening ?? rope ?? gate ?? door;
            if (!target) {
                c.log(`nothing to traverse @ ${here()} — scanning wider`);
                await sdk.waitForTicks(4);
                return;
            }
            c.log(`traverse -> ${target.name} @ ${target.x},${target.z} from ${here()}`);
            await goto(target.x, target.z, 2);
            if (/opening/i.test(target.name)) {
                await bot.interactLoc(target, /enter|climb|open|search/i);
            } else if (/rope/i.test(target.name)) {
                await bot.interactLoc(target, /climb/i);
            } else if (/gate/i.test(target.name)) {
                await bot.interactLoc(target, /open/i);
            } else {
                await bot.interactLoc(target, /open/i);
            }
            await until(() => inElvargLair(), 12_000);
            await eatIfLow(60);
        }
    },
    {
        id: 'elvarg',
        detect: () => !questComplete() && inElvargLair(),
        run: async (c) => {
            await session.setPhase('quest_elvarg');
            // Anti-dragon shield MUST be worn: unshielded max fire hit is 70.
            if (!wornShield()) {
                const sh = sdk.findInventoryItem(SHIELD);
                if (sh) {
                    c.log('equipping anti-dragon shield');
                    await bot.equipItem(sh);
                    await sdk.waitForTicks(1);
                } else {
                    c.log('NO anti-dragon shield — fighting anyway is suicide; aborting pass');
                    return;
                }
            }
            if (!WEAPONS.some((w) => sdk.getEquipment().some((e) => w.test(e.name)))) {
                for (const w of WEAPONS) {
                    const it = sdk.findInventoryItem(w);
                    if (it) {
                        await bot.equipItem(it);
                        break;
                    }
                }
            }
            await setStrengthStyle();
            const deadline = Date.now() + 20 * 60_000;
            while (Date.now() < deadline && !questComplete()) {
                if (pos().isDead) {
                    c.log('died to Elvarg — will re-traverse on revive');
                    await until(() => !pos().isDead, 60_000);
                    break;
                }
                await eatIfLow(60);
                if (!wornShield()) {
                    const sh = sdk.findInventoryItem(SHIELD);
                    if (sh) await bot.equipItem(sh);
                }
                if (await waitForQuestComplete(ctx, 'Dragon Slayer', 5_000)) return;
                const elvarg = sdk.findNearbyNpc(/elvarg/i);
                if (!elvarg) {
                    // Lair antechamber: push toward the lair anchor.
                    if (distTo(ELVARG_LAIR.x, ELVARG_LAIR.z) > 6) await goto(ELVARG_LAIR.x, ELVARG_LAIR.z, 5);
                    await sdk.waitForTicks(3);
                    continue;
                }
                if (!pos().inCombat) {
                    c.log(`attacking Elvarg hp=${pos().hp}/${pos().maxHp} @ ${here()}`);
                    const atk = await bot.attack(elvarg, 8_000);
                    if (!atk.success) c.log(`elvarg attack: ${atk.message}`);
                }
                await sdk.waitForTicks(2);
            }
            if (await waitForQuestComplete(ctx, 'Dragon Slayer', 30_000)) {
                c.log('Elvarg dead — quest complete message seen');
            }
        }
    }
];

/* ---------------- main ---------------- */

try {
    while (pos().isDead) {
        session.log('warn', `dead @ ${here()} — waiting to revive`);
        await until(() => !pos().isDead, 60_000);
    }
    const outcome = await questLoop(ctx, stages, {
        questName: 'Dragon Slayer',
        completeTimeoutMs: 120_000,
        maxPasses: 300,
        bankName: 'draynor'
    });
    session.log('log', `dragon-slayer loop outcome=${outcome} @ ${here()}`);
    if (outcome === 'complete' || questComplete()) {
        session.stop('complete', 'Dragon Slayer complete (server message seen)', { restartable: false });
    } else if (outcome === 'drained') {
        const bank = nearestBank(sdk);
        await parkAtBank(sdk, bot, bank);
        session.stop('stopped', `drained to ${bank}`, { restartable: false });
    } else {
        session.stop('stuck', `no stage matched @ ${here()} tail=${tail().slice(0, 200)}`, { restartable: true });
    }
} catch (err) {
    session.stop('script_error', err instanceof Error ? err.message : String(err), { restartable: true });
    throw err;
} finally {
    await session.finalizeStop().catch(() => undefined);
    await sdk.disconnect();
}
