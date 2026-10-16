/**
 * Sheep Shearer — reusable for any bot.
 *
 *   bun bots/quests/sheep-shearer.ts {botname}
 *   bun bots/quests/sheep-shearer.ts {botname} --until=10
 *   bun bots/quests/sheep-shearer.ts {botname} --quest-only
 *
 * Completes the quest (20 balls of wool → Fred), then keeps shearing and
 * spinning at the Lumbridge castle wheel until Crafting hits `--until`
 * (default 10). Quest reward is only 150 XP, so the extra spinning is what
 * actually reaches 10.
 */
import { BotSDK, deriveGatewayUrl } from '../../sdk/index';
import { BotActions } from '../../sdk/actions';
import { initPathfinding } from '../../sdk/pathfinding';
import { appendGrindLog } from '../../sdk/grind-log';
import { existsSync, readFileSync } from 'fs';
import { walkKandarinToEdgeville } from './movement';
import { dirname, join } from 'path';

const UNSHEERED_ID = 43;
const FRED = { x: 3190, z: 3274 };
const SHEEP_PEN = { x: 3203, z: 3266 };
const CASTLE_STAIRS = { x: 3205, z: 3208 };
const LUMBRIDGE_SHOP = { x: 3211, z: 3246 };
const EDGEVILLE_SHOP = { x: 3080, z: 3511 };
const EDGEVILLE_BANK = { x: 3094, z: 3492 };
const DRAYNOR_BANK = { x: 3092, z: 3245 };

const TO_FARM = [
    { x: 3105, z: 3420 },
    { x: 3135, z: 3355 },
    { x: 3175, z: 3308 },
    { x: 3190, z: 3274 }
];
const FARM_TO_CASTLE = [
    { x: 3210, z: 3248 },
    { x: 3205, z: 3214 },
    { x: 3205, z: 3208 }
];

const SHEARS = /^shears$/i;
const WOOL = /^wool$/i;
const BALL = /^ball of wool$/i;
const KEEP = /^(shears|coins|wool|ball of wool)$/i;
const FOOD = /^(shark|swordfish|lobster|tuna|salmon|trout|bread|cake|meat)$/i;

const argv = process.argv.slice(2);
const botArg = argv.find((a) => !a.startsWith('-'));
const questOnly = argv.includes('--quest-only');
const untilArg = argv.find((a) => a.startsWith('--until='));
const CRAFT_UNTIL = questOnly ? 0 : Number(untilArg?.split('=')[1] ?? 10);

function loadBotEnv(): void {
    const envPath = botArg
        ? join(process.cwd(), 'bots', botArg, 'bot.env')
        : join(dirname(import.meta.path), 'bot.env');
    if (!existsSync(envPath)) {
        throw new Error(`bot.env not found at ${envPath}. Usage: bun bots/quests/sheep-shearer.ts {botname}`);
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

function log(msg: string, level: 'LOG' | 'WARN' | 'ERROR' = 'LOG'): void {
    console.log(msg);
    appendGrindLog(GRIND_LOG, `${new Date().toISOString()} ${level} ${msg}`);
}

console.log('Warming pathfinder...');
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

console.log('Opening/attaching the game client...');
await sdk.connect();
const bot = new BotActions(sdk);

let lastIntent = '';
let questComplete = false;
let lastLoggedCraft = 0;

function intent(msg: string): void {
    if (msg === lastIntent) return;
    lastIntent = msg;
    console.log(`> ${msg}`);
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

function craft(): number {
    return sdk.getSkill('Crafting')?.baseLevel ?? 1;
}

function craftXp(): number {
    return sdk.getSkill('Crafting')?.experience ?? 0;
}

function occupiedSlots(): number {
    return sdk.getInventory().filter((i) => (i.count ?? 0) > 0).length;
}

function count(pattern: RegExp): number {
    return sdk.getInventory().filter((i) => pattern.test(i.name)).reduce((n, i) => n + (i.count ?? 1), 0);
}

function hasShears(): boolean {
    return !!sdk.findInventoryItem(SHEARS);
}

function coinCount(): number {
    return sdk.findInventoryItem(/^coins$/i)?.count ?? 0;
}

async function closeUi(): Promise<void> {
    if (sdk.getState()?.shop?.isOpen || sdk.getState()?.bank?.isOpen || sdk.getState()?.interface?.isOpen) {
        await bot.closeInterface();
    }
    await bot.dismissBlockingUI();
}

/** Click continues; on a multi-option page pick the first matching choice. */
async function chat(choices: RegExp[] = [], max = 28): Promise<string[]> {
    const seen: string[] = [];
    for (let i = 0; i < max; i++) {
        const dialog = sdk.getDialog();
        if (!dialog?.isOpen) {
            await sdk.waitForTicks(1);
            if (!sdk.getDialog()?.isOpen) break;
        }
        const opts = sdk.getDialog()?.options ?? [];
        for (const o of opts) seen.push(o.text);
        if (opts.length <= 1) {
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

async function talkFred(): Promise<boolean> {
    await closeUi();
    for (let attempt = 0; attempt < 3; attempt++) {
        let fred = sdk.findNearbyNpc(/fred/i);
        if (!fred) {
            await goToFarm();
            fred = sdk.findNearbyNpc(/fred/i);
        }
        if (!fred) {
            log(
                `Fred not nearby @ ${pos().x},${pos().z} npcs=${(sdk.getNearbyNpcs() ?? []).map((n) => n.name).slice(0, 8).join(',')}`,
                'WARN'
            );
            await sdk.waitForTicks(3);
            continue;
        }
        // Standing in the farmhouse doorway with the door shut leaves Fred
        // unreachable from one tile away; talkTo will not open it for us.
        if (fred.reachable === false) {
            if (!(await openToward(fred.x, fred.z))) await openNearbyGate();
            await sdk.waitForTicks(2);
            fred = sdk.findNearbyNpc(/fred/i) ?? fred;
        }
        const talk = await bot.talkTo(fred);
        if (talk.success) {
            await sdk.waitForTicks(1);
            return true;
        }
        log(`talk Fred: ${talk.message} @ ${pos().x},${pos().z}`, 'WARN');
        await bot.walkTo(FRED.x, FRED.z, 2);
        await sdk.waitForTicks(3);
    }
    return false;
}

async function startOrCheckQuest(): Promise<void> {
    // Talking to Fred with balls in inv starts the give-loop; leave that to turnInWool
    // so we don't walk away mid-hand-in.
    if (count(BALL) > 0) return;
    for (let attempt = 0; attempt < 3 && !questComplete; attempt++) {
        if (!(await talkFred())) continue;
        const seen = await chat([
            /looking for a quest/i,
            /yes okay\.? i can do that/i,
            /yes okay/i
        ]);
        const leftover = sdk.getDialog();
        const opts = leftover?.options ?? [];
        log(`Fred options: ${opts.map((o) => o.text).join(' | ') || '(none)'} seen=${seen.join(' | ')}`);
        const questOpt = opts.find((o) => /looking for a quest/i.test(o.text));
        const lost = opts.find((o) => /i'?m lost/i.test(o.text));
        const kill = opts.find((o) => /something to kill/i.test(o.text));
        if (questOpt) {
            await sdk.sendClickDialog(questOpt.index);
            await sdk.waitForTicks(1);
            await chat([/yes okay\.? i can do that/i, /yes okay/i]);
            questComplete = false;
            log('Quest started');
            break;
        }
        if (lost && kill && !questOpt) {
            questComplete = true;
            await sdk.sendClickDialog(lost.index);
            await sdk.waitForTicks(2);
            log('Sheep Shearer already complete');
            break;
        }
        const text = seen.join(' | ');
        if (/looking for a quest/i.test(text) && /yes okay/i.test(text)) {
            questComplete = false;
            log('Quest started');
            break;
        }
        if (/see you when you have some wool|how are you doing getting those balls/i.test(text)) {
            questComplete = false;
            log('Quest already in progress');
            break;
        }
        if (/i guess i'd better pay you|completed the/i.test(text)) {
            questComplete = true;
            log('Sheep Shearer turned in');
            break;
        }
    }
    await bot.dismissBlockingUI();
    await closeUi();
}

async function clickContinue(): Promise<boolean> {
    const dialog = sdk.getDialog();
    if (!dialog?.isOpen) return false;
    const opts = dialog.options ?? [];
    if (opts.length === 0) {
        await sdk.sendClickDialog(0);
        return true;
    }
    if (opts.length === 1 || opts.every((o) => /click here to continue/i.test(o.text))) {
        await sdk.sendClickDialog(opts[0]!.index);
        return true;
    }
    return false;
}

async function turnInWool(): Promise<void> {
    if (questComplete || count(BALL) < 1) return;
    const xpBefore = craftXp();
    const coinsBefore = coinCount();
    intent(`Turning in ${count(BALL)} ball(s) of wool`);
    if (!(await talkFred())) return;

    // Fred silently takes one ball per tick (closes the chat each time). Walking
    // or closeUi aborts that. The 20th ball reopens chat: "I have your last ball
    // of wool." → "I guess I'd better pay you then."
    let lastBalls = count(BALL);
    let idle = 0;
    for (let i = 0; i < 50 && !questComplete; i++) {
        const clicked = await clickContinue();
        const balls = count(BALL);
        const xpGain = craftXp() - xpBefore;
        const coinGain = coinCount() - coinsBefore;
        if (xpGain >= 100 || coinGain >= 50) {
            questComplete = true;
            log(`QUEST COMPLETE Sheep Shearer | +${xpGain} crafting xp +${coinGain} gp | Crafting ${craft()}`);
            break;
        }
        if (balls < lastBalls) {
            log(`Fred took a ball (${balls} left)`);
            lastBalls = balls;
            idle = 0;
        } else if (!clicked) {
            idle++;
        } else {
            idle = 0;
        }
        if (!clicked && idle >= 5) break;
        await sdk.waitForTicks(1);
    }

    if (!questComplete) {
        log(`Gave wool to Fred | balls left ${count(BALL)} | +${craftXp() - xpBefore} xp`);
    }
    await bot.dismissBlockingUI();
}

async function walkWaypoints(points: { x: number; z: number }[]): Promise<void> {
    const dest = points[points.length - 1]!;
    for (const p of points) {
        if (distTo(p.x, p.z) <= 8) continue;
        if (Math.hypot(dest.x - p.x, dest.z - p.z) >= distTo(dest.x, dest.z) - 4) continue;
        await bot.walkTo(p.x, p.z, 3);
    }
    await bot.walkTo(dest.x, dest.z, 3);
}

/** Closed door we can actually open, nearest the destination — not nearest us. */
function doorToward(tx: number, tz: number) {
    return (
        (sdk.getNearbyLocs() ?? [])
            .filter(
                (l) =>
                    /door/i.test(l.name) &&
                    l.reachable !== false &&
                    l.optionsWithIndex.some((o) => /^open$/i.test(o.text))
            )
            .sort((a, b) => Math.hypot(a.x - tx, a.z - tz) - Math.hypot(b.x - tx, b.z - tz))[0] ?? null
    );
}

async function openToward(tx: number, tz: number): Promise<boolean> {
    const door = doorToward(tx, tz);
    if (!door) return false;
    intent(`Opening ${door.name} at ${door.x},${door.z} (toward ${tx},${tz})`);
    const r = await bot.openDoor(door);
    return r.success;
}

async function climbTo(targetLevel: number): Promise<boolean> {
    for (let i = 0; i < 8 && pos().level !== targetLevel; i++) {
        const wantUp = pos().level < targetLevel;
        const opt = wantUp ? /climb-up|climb.up|go-up|go.up/i : /climb-down|climb.down|go-down|go.down/i;

        if (distTo(CASTLE_STAIRS.x, CASTLE_STAIRS.z) > 2) {
            await openToward(CASTLE_STAIRS.x, CASTLE_STAIRS.z);
            await bot.walkTo(CASTLE_STAIRS.x, CASTLE_STAIRS.z, 1);
        }

        const stairs = (sdk.getNearbyLocs() ?? [])
            .filter((l) => /stair|ladder/i.test(l.name) && l.optionsWithIndex.some((o) => opt.test(o.text)))
            .sort(
                (a, b) =>
                    (a.reachable === false ? 1 : 0) - (b.reachable === false ? 1 : 0) ||
                    (a.distance ?? 99) - (b.distance ?? 99)
            )[0];

        if (!stairs || stairs.reachable === false) {
            await openToward(CASTLE_STAIRS.x, CASTLE_STAIRS.z);
            await bot.walkTo(CASTLE_STAIRS.x, CASTLE_STAIRS.z, 1);
            continue;
        }

        const before = pos().level;
        intent(`Climb ${wantUp ? 'up' : 'down'} ${stairs.name} (floor ${before} → ${targetLevel})`);
        const match = stairs.optionsWithIndex.find((o) => opt.test(o.text));
        // Click from the landing. walkTo(stair tile) aims at a blocked loc and
        // then opens the nearest unrelated castle door.
        if ((stairs.distance ?? 99) <= 2 && match) {
            await sdk.sendInteractLoc(stairs.x, stairs.z, stairs.id, match.opIndex);
        } else {
            const r = await bot.interactLoc(stairs, opt);
            if (!r.success) {
                console.log(`climb: ${r.message}`);
                await openToward(CASTLE_STAIRS.x, CASTLE_STAIRS.z);
            }
        }
        await sdk.waitForCondition((s) => (s.player?.level ?? before) !== before, 8_000).catch(() => {});
        await bot.dismissBlockingUI();
    }
    return pos().level === targetLevel;
}

async function openNearbyGate(): Promise<void> {
    const gate = (sdk.getNearbyLocs() ?? [])
        .filter((l) => /gate|door/i.test(l.name) && l.optionsWithIndex.some((o) => /^open$/i.test(o.text)))
        .sort((a, b) => (a.distance ?? 99) - (b.distance ?? 99))[0];
    if (!gate || (gate.distance ?? 99) > 8) return;
    intent(`Opening ${gate.name} at ${gate.x},${gate.z}`);
    await bot.openDoor(gate);
}

async function goToFarm(): Promise<void> {
    await closeUi();
    if (pos().level > 0 && !(await climbTo(0))) {
        log(`Still on floor ${pos().level}, not walking to Fred yet`);
        return;
    }
    if (distTo(FRED.x, FRED.z) <= 8 && sdk.findNearbyNpc(/fred/i)) return;
    intent(`Walking to Fred's farm @ ${FRED.x},${FRED.z} (now ${pos().x},${pos().z})`);
    if (pos().z > 3360) await walkWaypoints(TO_FARM);
    const r = await bot.walkTo(FRED.x, FRED.z, 3);
    if (!r.success) {
        log(`walk farm: ${r.message} now ${pos().x},${pos().z}`);
        await openNearbyGate();
        await bot.walkTo(FRED.x, FRED.z, 3);
    }
    await openNearbyGate();
}

async function goToCastleWheel(): Promise<boolean> {
    await closeUi();
    if (sdk.findNearbyLoc(/spinning wheel/i, { reachable: true })) return true;

    while (pos().level > 1 && !sdk.findNearbyLoc(/spinning wheel/i, { reachable: true })) {
        intent(`Wrong floor ${pos().level} — climbing down toward the wheel`);
        if (!(await climbTo(pos().level - 1))) break;
        if (sdk.findNearbyLoc(/spinning wheel/i, { reachable: true })) return true;
    }
    if (sdk.findNearbyLoc(/spinning wheel/i, { reachable: true })) return true;

    if (pos().level > 0) await climbTo(0);
    intent('Walking to Lumbridge castle spinning wheel');
    if (pos().z > 3360) await walkWaypoints([...TO_FARM, ...FARM_TO_CASTLE]);
    else await walkWaypoints(FARM_TO_CASTLE);
    await bot.walkTo(CASTLE_STAIRS.x, CASTLE_STAIRS.z, 2);

    if (!(await climbTo(1))) {
        log(`Could not reach 1st floor (on ${pos().level})`);
        return false;
    }
    if (!sdk.findNearbyLoc(/spinning wheel/i, { reachable: true })) {
        await openToward(3208, 3213);
        await bot.walkTo(3208, 3213, 2);
    }
    const found = !!sdk.findNearbyLoc(/spinning wheel/i, { reachable: true });
    if (!found) log(`No spinning wheel on floor ${pos().level} @ ${pos().x},${pos().z}`);
    return found;
}

function junkSlots(): number {
    return sdk.getInventory().filter((i) => (i.count ?? 0) > 0 && !KEEP.test(i.name)).length;
}

async function bankJunk(): Promise<void> {
    if (junkSlots() === 0 && hasShears() && coinCount() >= 1) return;
    const nearEdgeville = distTo(EDGEVILLE_BANK.x, EDGEVILLE_BANK.z) <= 20 && pos().z > 3450;
    if (!nearEdgeville && distTo(DRAYNOR_BANK.x, DRAYNOR_BANK.z) > 15) {
        if (pos().level > 0 && !(await climbTo(0))) return;
        intent(`Walking to Draynor bank to clear ${junkSlots()} junk slot(s)`);
        if (pos().z > 3360) await walkWaypoints(TO_FARM);
        await bot.walkTo(DRAYNOR_BANK.x, DRAYNOR_BANK.z, 3);
        if (distTo(DRAYNOR_BANK.x, DRAYNOR_BANK.z) > 15) {
            log(`Could not reach Draynor bank (now ${pos().x},${pos().z})`, 'WARN');
            return;
        }
    }
    intent('Banking at nearby bank');
    if (!(sdk.getState()?.bank?.isOpen || (await bot.openBank()).success)) {
        log(`openBank failed @ ${pos().x},${pos().z}`, 'WARN');
        return;
    }
    for (const item of [...sdk.getInventory()]) {
        if (KEEP.test(item.name)) continue;
        await bot.depositItem(item, -1);
    }
    if (coinCount() < 5) {
        const coins = sdk.findBankItem(/^coins$/i);
        if (coins) await bot.withdrawItem(coins, Math.min(25, coins.count));
    }
    const bankShears = sdk.findBankItem(SHEARS);
    if (!hasShears() && bankShears) await bot.withdrawItem(bankShears, 1);
    await bot.closeBank();
    log(`Banked junk | ${junkSlots()} junk slot(s) left | ${28 - occupiedSlots()} free`);
}

async function buyShears(): Promise<boolean> {
    if (hasShears()) return true;
    const ground = sdk.findGroundItem(SHEARS) ?? (await sdk.scanFindGroundItem(SHEARS, 15));
    if (ground) {
        const r = await bot.pickupItem(ground);
        log(`Pickup shears: ${r.success ? 'ok' : r.message}`);
        if (hasShears()) return true;
    }
    intent('Buying shears at Lumbridge general store');
    if (pos().z > 3360) await walkWaypoints(TO_FARM);
    await bot.walkTo(LUMBRIDGE_SHOP.x, LUMBRIDGE_SHOP.z, 2);
    let opened = await bot.openShop();
    if (!opened.success) {
        log(`openShop: ${opened.message} — retrying trade`);
        const r = await bot.interactNpc(/shop\s*(keeper|assistant)/i, /trade/i);
        log(`trade shop: ${r.success ? 'ok' : r.message}`);
        await sdk.waitForCondition((s) => s.shop?.isOpen, 8_000).catch(() => {});
        opened = { success: !!sdk.getState()?.shop?.isOpen, message: '' };
    }
    if (!sdk.getState()?.shop?.isOpen) {
        const npcs = (sdk.getNearbyNpcs() ?? [])
            .slice(0, 8)
            .map((n) => `${n.name}[${n.options.join(',')}]`)
            .join('; ');
        log(`Shop still closed. Nearby: ${npcs || 'none'}`);
        return false;
    }
    if (coinCount() < 1) {
        log('No coins for shears');
        await bot.closeShop();
        return false;
    }
    const bought = await bot.buyFromShop(SHEARS, 1);
    log(`Buy shears: ${bought.success ? 'ok' : bought.message}`);
    await bot.closeShop();
    return hasShears();
}

async function ensureShears(): Promise<boolean> {
    if (hasShears()) return true;
    await bankJunk();
    if (hasShears()) return true;
    return buyShears();
}

function findUnsheered() {
    return (sdk.getNearbyNpcs() ?? [])
        .filter((n) => n.id === UNSHEERED_ID && /^sheep$/i.test(n.name) && n.reachable !== false)
        .sort((a, b) => (a.distance ?? 99) - (b.distance ?? 99))[0] ?? null;
}

async function shearOne(): Promise<boolean> {
    await closeUi();
    const before = count(WOOL);
    let sheep = findUnsheered();
    if (!sheep) {
        await bot.walkTo(SHEEP_PEN.x, SHEEP_PEN.z, 3);
        sheep = findUnsheered();
    }
    if (!sheep) return false;
    const r = await bot.useItemOnNpc(SHEARS, sheep, { timeout: 6_000 });
    await bot.dismissBlockingUI();
    if (count(WOOL) > before) return true;
    const msgs = sdk.getState()?.gameMessages ?? [];
    if (msgs.some((m) => /get away/i.test(m.text))) return false;
    if (msgs.some((m) => /already been shorn/i.test(m.text))) return false;
    if (!r.success) return false;
    await sdk.waitForTicks(2);
    await bot.dismissBlockingUI();
    return count(WOOL) > before;
}

async function shearUntil(n: number): Promise<void> {
    await goToFarm();
    await bot.walkTo(SHEEP_PEN.x, SHEEP_PEN.z, 3);
    let misses = 0;
    while (count(WOOL) < n && occupiedSlots() < 28 && misses < 40) {
        intent(`Shearing ${count(WOOL)}/${n}`);
        const ok = await shearOne();
        if (ok) {
            misses = 0;
            log(`Wool ${count(WOOL)} | Crafting ${craft()}`);
        } else {
            misses++;
            await sdk.waitForTicks(2);
        }
    }
}

async function spinAllWool(): Promise<number> {
    if (count(WOOL) < 1) return 0;
    if (!(await goToCastleWheel())) return 0;
    let spun = 0;
    while (count(WOOL) > 0 && spun < 32) {
        const before = count(WOOL);
        const xpBefore = craftXp();
        intent(`Spinning wool (${before} left)`);
        const wheel = sdk.findNearbyLoc(/spinning wheel/i, { reachable: true });
        if (!wheel) {
            await openToward(3208, 3213);
            await bot.walkTo(3208, 3213, 2);
            if (!sdk.findNearbyLoc(/spinning wheel/i, { reachable: true })) {
                log('No reachable spinning wheel on this floor');
                break;
            }
            continue;
        }
        const r = await bot.useItemOnLoc(WOOL, /spinning wheel/i, { timeout: 8_000 });
        await bot.dismissBlockingUI();
        if (count(WOOL) < before || craftXp() > xpBefore) {
            spun++;
            continue;
        }
        if (!r.success) {
            console.log(`spin: ${r.message}`);
            await openToward(3208, 3213);
            await sdk.waitForTicks(1);
        }
    }
    log(`Spun ${spun} | balls ${count(BALL)} | Crafting ${craft()} (${craftXp()} xp)`);
    return spun;
}

try {
    lastLoggedCraft = craft();
    await bot.skipTutorial();
    await closeUi();
    log(
        `Sheep Shearer start Crafting ${lastLoggedCraft} (${craftXp()} xp) @ ${pos().x},${pos().z} ` +
            `until=${questOnly ? 'quest only' : CRAFT_UNTIL}`
    );

    if (!questOnly && CRAFT_UNTIL > 0 && craft() >= CRAFT_UNTIL) {
        log(`Crafting ${craft()} already at until=${CRAFT_UNTIL} — leaving sheep`);
    } else {
    if (pos().x < 2940 && pos().z < 6400 && distTo(SHEEP_PEN.x, SHEEP_PEN.z) > 50) {
        log('Leaving Kandarin for the Lumbridge sheep pen');
        await walkKandarinToEdgeville(bot, sdk, {
            eat: async () => {
                const food = sdk.findInventoryItem(FOOD);
                if (food && pos().hp < pos().maxHp - 20) await bot.eatFood(food);
            },
            walkNear: async (x, z, tol) => {
                const r = await bot.walkTo(x, z, tol);
                return r.success || distTo(x, z) <= tol + 2;
            }
        });
    }

    await ensureShears();
    if (!hasShears()) {
        log('Shears retry after walking to Lumbridge');
        await ensureShears();
    }
    if (!hasShears()) throw new Error('Could not get shears');
    log(`Shears ready | coins ${coinCount()}`);

    await startOrCheckQuest();

    const progress = () =>
        `${count(WOOL)}|${count(BALL)}|${craftXp()}|${questComplete}|${occupiedSlots()}|${pos().x},${pos().z},${pos().level}`;
    let lastProgress = '';
    let stalls = 0;
    let junkTrips = 0;

    while (true) {
        const now = progress();
        if (now === lastProgress) {
            stalls++;
            if (stalls % 10 === 0) log(`No progress for ${stalls} loops @ ${pos().x},${pos().z} (${now})`, 'WARN');
            if (stalls >= 40) throw new Error(`Stalled ${stalls} loops @ ${pos().x},${pos().z} (${now})`);
            await sdk.waitForTicks(Math.min(stalls, 10));
        } else {
            stalls = 0;
        }
        lastProgress = now;

        await closeUi();
        if (pos().isDead) {
            await sdk.waitForCondition((s) => !s.player.isDead, 45_000).catch(() => {});
            continue;
        }
        if (craft() !== lastLoggedCraft) {
            log(`LEVEL UP Crafting ${craft()}`);
            lastLoggedCraft = craft();
        }

        if (questComplete && (questOnly || craft() >= CRAFT_UNTIL)) {
            log(`Done. Crafting ${craft()} (${craftXp()} xp) questComplete=${questComplete}`);
            break;
        }

        if (!hasShears() && !(await ensureShears())) {
            await sdk.waitForTicks(5);
            continue;
        }

        if (junkSlots() > 0 && junkTrips < 3) {
            junkTrips++;
            await bankJunk();
        }

        const needForQuest = questComplete ? 0 : Math.max(0, 20 - count(BALL));
        const shearTarget = questComplete
            ? Math.max(1, 28 - occupiedSlots() + count(WOOL))
            : Math.min(27, Math.max(needForQuest, 1));

        if (count(WOOL) < (questComplete ? 1 : Math.min(needForQuest, 20)) && occupiedSlots() < 28) {
            await shearUntil(questComplete ? 27 : shearTarget);
        }

        if (count(WOOL) > 0) await spinAllWool();

        if (!questComplete && count(BALL) >= 1) {
            await climbTo(0);
            await turnInWool();
        }

        if (questComplete && craft() < CRAFT_UNTIL && count(WOOL) < 1) {
            await climbTo(0);
        }
    }
    }
} catch (err) {
    log(`Script error: ${err instanceof Error ? err.message : String(err)}`, 'ERROR');
    throw err;
} finally {
    console.log('Disconnecting SDK; browser client can stay open.');
    await sdk.disconnect();
}
