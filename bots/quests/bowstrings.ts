/**
 * Seers flax → bowstrings → bank. Spins banked flax before picking more.
 * Flax needs Crafting 10 (sheep-shearer --until=10). Lost City needs 31.
 *
 *   bun bots/quests/bowstrings.ts {botname}
 *   bun bots/quests/bowstrings.ts {botname} --until=31
 */
import { ActivitySession, BotSDK, atSeersFlax, deriveGatewayUrl } from '../../sdk/index';
import { BotActions } from '../../sdk/actions';
import { initPathfinding } from '../../sdk/pathfinding';
import { resolveSkillDialogProduct } from '../../sdk/action-quantity';
import { existsSync, readFileSync } from 'fs';
import { dirname, join } from 'path';
import { travelToSeersFlax } from '../Jackpoo1/travel-to-flax';
import { installGracefulShutdown } from '../../sdk/runner';

const FLAX_FIELD = { x: 2744, z: 3444 };
const WHEEL_HOUSE = { x: 2715, z: 3471 };
const SEERS_BANK = { x: 2726, z: 3485 };

const FLAX = /^flax$/i;
const BOWSTRING = /^bow\s*string$/i;
const KEEP = /^(coins|(bronze|iron|steel|black|mithril|adamant|rune) axe)$/i;

const argv = process.argv.slice(2);
const botArg = argv.find((a) => !a.startsWith('-'));
const untilArg = argv.find((a) => a.startsWith('--until='));
const untilCraft = Number(untilArg?.split('=')[1]);
const CRAFT_UNTIL = Number.isFinite(untilCraft) && untilCraft > 0 ? untilCraft : 0;

function loadBotEnv(): void {
    const envPath = botArg
        ? join(process.cwd(), 'bots', botArg, 'bot.env')
        : join(dirname(import.meta.path), 'bot.env');
    if (!existsSync(envPath)) {
        throw new Error(`bot.env not found at ${envPath}. Usage: bun bots/quests/bowstrings.ts {botname} [--until=31]`);
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
const session = new ActivitySession(sdk, bot, {
    name: 'bowstrings',
    grindLogPath: GRIND_LOG
});

installGracefulShutdown();

let lastLoggedCraft = 0;
/** Once the bank is empty of flax, skip the withdraw check until a restart. */
let bankFlaxDrained = false;

function log(msg: string): void {
    session.log('log', msg);
}

function intent(msg: string): void {
    void session.showIntent(msg);
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

function bankCount(pattern: RegExp): number {
    return sdk.getBankItems().filter((i) => pattern.test(i.name)).reduce((n, i) => n + (i.count ?? 0), 0);
}

async function openSeersBank(): Promise<boolean> {
    if (pos().level > 0) await climbTo(0);
    await closeUi();
    await bot.walkTo(SEERS_BANK.x, SEERS_BANK.z, 2);
    await closeUi();
    if (sdk.getState()?.bank?.isOpen) return true;
    const r = await bot.openBank();
    if (r.success || sdk.getState()?.bank?.isOpen) return true;
    session.noteFailure('bank_open', r.message || 'Could not open Seers bank');
    return false;
}

/** Field, wheel house, or Seers bank — grind from here; do not re-run wildy travel. */
function inFlaxCircuit(): boolean {
    const p = pos();
    if (atSeersFlax(p.x, p.z)) return true;
    if (sdk.findNearbyLoc(/^flax$/i) || sdk.findNearbyLoc(/spinning wheel/i)) return true;
    if (distTo(WHEEL_HOUSE.x, WHEEL_HOUSE.z) <= 24) return true;
    if (distTo(SEERS_BANK.x, SEERS_BANK.z) <= 24) return true;
    return p.x >= 2690 && p.x <= 2770 && p.z >= 3430 && p.z <= 3510;
}

async function closeUi(): Promise<void> {
    for (let i = 0; i < 25; i++) {
        const dialog = sdk.getDialog();
        const st = sdk.getState();
        if (dialog?.isOpen) {
            const opts = dialog.options ?? [];
            const skillDlg = opts.some((o) => /make \d+|make x|^wool$|^flax$/i.test(o.text));
            if (skillDlg) {
                await sdk.sendCloseModal();
                await sdk.waitForTicks(1);
                continue;
            }
            const cont = opts.find((o) => /continue|click here/i.test(o.text)) ?? (opts.length <= 1 ? opts[0] : undefined);
            if (cont) {
                await sdk.sendClickDialog(cont.index);
                await sdk.waitForTicks(1);
                continue;
            }
            await sdk.sendCloseModal();
            await sdk.waitForTicks(1);
            continue;
        }
        if (st?.interface?.isOpen && !st.bank?.isOpen && !st.shop?.isOpen) {
            await sdk.sendCloseModal();
            await sdk.waitForTicks(1);
            continue;
        }
        break;
    }
    await bot.dismissBlockingUI();
    if (sdk.getState()?.shop?.isOpen || sdk.getState()?.bank?.isOpen) {
        await bot.closeInterface();
    }
}

async function climbTo(targetLevel: number): Promise<boolean> {
    for (let i = 0; i < 8 && pos().level !== targetLevel; i++) {
        const wantUp = pos().level < targetLevel;
        const opt = wantUp ? /climb-up|climb.up|go-up|go.up/i : /climb-down|climb.down|go-down|go.down/i;
        if (distTo(WHEEL_HOUSE.x, WHEEL_HOUSE.z) > 6 && pos().level === 0) {
            await bot.walkTo(WHEEL_HOUSE.x, WHEEL_HOUSE.z, 2);
        }
        const stairs = (sdk.getNearbyLocs() ?? [])
            .filter((l) => /stair|ladder/i.test(l.name) && l.optionsWithIndex.some((o) => opt.test(o.text)))
            .sort(
                (a, b) =>
                    (a.reachable === false ? 1 : 0) - (b.reachable === false ? 1 : 0) ||
                    (a.distance ?? 99) - (b.distance ?? 99)
            )[0];
        if (!stairs || stairs.reachable === false) {
            const door = (sdk.getNearbyLocs() ?? []).find(
                (l) => /door/i.test(l.name) && l.reachable !== false && l.optionsWithIndex.some((o) => /^open$/i.test(o.text))
            );
            if (door) await bot.openDoor(door);
            await bot.walkTo(WHEEL_HOUSE.x, WHEEL_HOUSE.z, 1);
            continue;
        }
        const before = pos().level;
        intent(`Climb ${wantUp ? 'up' : 'down'} ${stairs.name} (floor ${before} → ${targetLevel})`);
        const match = stairs.optionsWithIndex.find((o) => opt.test(o.text));
        if ((stairs.distance ?? 99) <= 2 && match) {
            await sdk.sendInteractLoc(stairs.x, stairs.z, stairs.id, match.opIndex);
        } else {
            const r = await bot.interactLoc(stairs, opt);
            if (!r.success) session.noteFailure('climb', r.message);
        }
        await sdk.waitForCondition((s) => (s.player?.level ?? before) !== before, 8_000).catch(() => {});
        await bot.dismissBlockingUI();
    }
    return pos().level === targetLevel;
}

session.registerRecovery([
    {
        name: 'climb_floor',
        run: async () => {
            const phase = session.metrics().phase;
            const want = phase === 'spin' ? 1 : 0;
            return climbTo(want);
        }
    }
]);

async function pickFlax(): Promise<boolean> {
    await closeUi();
    const before = count(FLAX);
    let plant =
        sdk.findNearbyLoc(/^flax$/i, { reachable: true, withOption: /pick/i }) ??
        sdk.findNearbyLoc(/^flax$/i, { reachable: true });
    if (!plant) {
        await bot.walkTo(FLAX_FIELD.x, FLAX_FIELD.z, 3);
        await sdk.scanNearbyLocs(8).catch(() => {});
        plant =
            sdk.findNearbyLoc(/^flax$/i, { reachable: true, withOption: /pick/i }) ??
            sdk.findNearbyLoc(/^flax$/i, { reachable: true });
    }
    if (!plant) return false;
    const r = await bot.interactLoc(plant, /pick/i);
    await bot.dismissBlockingUI();
    if (count(FLAX) > before) {
        session.noteProgress('inventory', 'flax');
        return true;
    }
    if (!r.success) return false;
    await sdk.waitForCondition(() => count(FLAX) > before, 4_000).catch(() => {});
    if (count(FLAX) > before) {
        session.noteProgress('inventory', 'flax');
        return true;
    }
    return false;
}

async function fillFlax(): Promise<void> {
    if (pos().level > 0) await climbTo(0);
    if (distTo(FLAX_FIELD.x, FLAX_FIELD.z) > 12) {
        intent(`Walking to flax field @ ${FLAX_FIELD.x},${FLAX_FIELD.z}`);
        await bot.walkTo(FLAX_FIELD.x, FLAX_FIELD.z, 3);
    }
    let misses = 0;
    while (occupiedSlots() < 28 && misses < 40 && !session.isStopped()) {
        intent(`Picking flax ${count(FLAX)}/28`);
        if (await pickFlax()) misses = 0;
        else {
            misses++;
            if (misses % 5 === 0) session.noteFailure('pick', `no flax (${misses} misses)`);
            await bot.walkTo(
                FLAX_FIELD.x + ((misses * 2) % 7) - 3,
                FLAX_FIELD.z + ((misses * 3) % 7) - 3,
                2
            );
            await sdk.waitForTicks(1);
        }
    }
    log(`Picked ${count(FLAX)} flax`);
}

async function clickFlaxSpin(): Promise<boolean> {
    const dialog = sdk.getDialog();
    if (!dialog?.isOpen) return false;
    const opts = dialog.options ?? [];
    const flaxBtn = resolveSkillDialogProduct(opts, 'flax');
    if (!flaxBtn) return false;
    const make10 = opts.find((o) => o.index === flaxBtn.index - 2 && /make 10/i.test(o.text));
    const make5 = opts.find((o) => o.index === flaxBtn.index - 1 && /make 5/i.test(o.text));
    const click = count(FLAX) >= 10 ? make10 : count(FLAX) >= 5 ? make5 : flaxBtn;
    await sdk.sendClickDialog((click ?? flaxBtn).index);
    return true;
}

async function spinAllFlax(): Promise<number> {
    if (count(FLAX) < 1) return 0;
    await closeUi();
    if (pos().level === 0) {
        intent('Walking to Seers spinning wheel');
        await bot.walkTo(WHEEL_HOUSE.x, WHEEL_HOUSE.z, 2);
        const door = (sdk.getNearbyLocs() ?? []).find(
            (l) => /door/i.test(l.name) && l.reachable !== false && l.optionsWithIndex.some((o) => /^open$/i.test(o.text))
        );
        if (door) await bot.openDoor(door);
        if (!(await climbTo(1))) session.noteFailure('climb', `Could not reach wheel floor (on ${pos().level})`);
    }

    let spun = 0;
    let noWheel = 0;
    while (count(FLAX) > 0 && noWheel < 6 && !session.isStopped()) {
        await bot.dismissBlockingUI();
        const wheel = sdk.findNearbyLoc(/spinning wheel/i, { reachable: true });
        if (!wheel) {
            noWheel++;
            session.noteFailure('wheel', `no spinning wheel (${noWheel})`);
            await bot.walkTo(WHEEL_HOUSE.x, WHEEL_HOUSE.z, 1);
            continue;
        }
        noWheel = 0;
        const before = count(FLAX);
        const xpBefore = craftXp();
        intent(`Spinning flax (${before} left)`);

        const spunOpt = wheel.optionsWithIndex.find((o) => /spin/i.test(o.text));
        if (spunOpt) {
            if ((wheel.distance ?? 99) > 2) await bot.walkTo(wheel.x, wheel.z, 1);
            await sdk.sendInteractLoc(wheel.x, wheel.z, wheel.id, spunOpt.opIndex);
            await sdk.waitForCondition((s) => s.dialog?.isOpen, 5_000).catch(() => {});
            if (sdk.getDialog()?.isOpen) {
                const clicked = await clickFlaxSpin();
                if (clicked) {
                    await sdk.waitForCondition(() => count(FLAX) < before || craftXp() > xpBefore, 20_000).catch(() => {});
                    if (count(FLAX) < before || craftXp() > xpBefore) {
                        spun += Math.max(1, before - count(FLAX));
                        session.noteProgress('xp', 'spin');
                        continue;
                    }
                }
            }
        }

        const r = await bot.useItemOnLoc(FLAX, /spinning wheel/i, { timeout: 8_000 });
        await bot.dismissBlockingUI();
        if (count(FLAX) < before || craftXp() > xpBefore) {
            spun += Math.max(1, before - count(FLAX));
            session.noteProgress('xp', 'spin');
            continue;
        }
        if (!r.success) {
            session.noteFailure('spin', r.message);
            await sdk.waitForTicks(1);
        }
    }
    await closeUi();
    log(`Spun ${spun} | bowstrings ${count(BOWSTRING)} | Crafting ${craft()} (${craftXp()} xp)`);
    return spun;
}

async function bankStrings(): Promise<void> {
    if (count(BOWSTRING) < 1 && occupiedSlots() < 28) return;
    intent('Banking bowstrings at Seers');
    if (!(await openSeersBank())) return;
    let deposited = 0;
    for (const item of [...sdk.getInventory()]) {
        // Leave flax in the bag — it still needs spinning, not re-banking.
        if (KEEP.test(item.name) || FLAX.test(item.name)) continue;
        const n = item.count ?? 1;
        await bot.depositItem(item, -1);
        if (BOWSTRING.test(item.name)) deposited += n;
    }
    await bot.closeBank();
    session.recordTrip(deposited);
    session.noteProgress('bank', 'seers');
    log(`Crafting ${craft()} (${craftXp()} xp)`);
}

/** Withdraw one inventory of banked flax. Returns inv flax count, or -1 if the bank did not open. */
async function withdrawBankFlaxLoad(): Promise<number> {
    intent('Withdrawing banked flax to spin before picking');
    if (!(await openSeersBank())) return -1;
    for (const item of [...sdk.getInventory()]) {
        if (KEEP.test(item.name) || FLAX.test(item.name)) continue;
        await bot.depositItem(item, -1);
    }
    const space = 28 - occupiedSlots();
    const inBank = bankCount(FLAX);
    if (space > 0 && inBank > 0) {
        const take = Math.min(inBank, space);
        const r = await bot.withdrawItem(FLAX, take, { asNote: false });
        log(`Withdraw flax x${take} ${r.success ? 'ok' : r.message} | inv ${count(FLAX)} bank ${bankCount(FLAX)}`);
    } else {
        log(`Bank flax ${inBank} | inv flax ${count(FLAX)} space ${space}`);
    }
    await bot.closeBank();
    return count(FLAX);
}

try {
    lastLoggedCraft = craft();
    await bot.skipTutorial();
    await closeUi();
    log(`Bowstrings start Crafting ${lastLoggedCraft} (${craftXp()} xp) until=${CRAFT_UNTIL || 'none'} @ ${pos().x},${pos().z}`);

    if (CRAFT_UNTIL > 0 && craft() >= CRAFT_UNTIL) {
        session.stop('done', `Crafting ${craft()} — until ${CRAFT_UNTIL}`);
    } else if (CRAFT_UNTIL > 0 && craft() < 10) {
        session.stop('setup', `Crafting ${craft()} — flax needs 10. Run sheep-shearer.ts ${username} --until=10 first`);
    }

    if (!session.isStopped() && !inFlaxCircuit()) {
        await session.setPhase('travel');
        const travel = await travelToSeersFlax({ sdk, bot, log, session });
        if (travel !== 'arrived' && !inFlaxCircuit()) {
            if (!session.isStopped()) session.stop(travel, `travel ended ${travel}`);
        }
    }

    while (!session.isStopped()) {
        if (CRAFT_UNTIL > 0 && craft() >= CRAFT_UNTIL) {
            session.stop('done', `Crafting ${craft()} — until ${CRAFT_UNTIL}`);
            break;
        }
        if (session.needsRecovery()) {
            if ((await session.recover()) === 'exhausted') break;
            continue;
        }
        await closeUi();
        if (pos().isDead) {
            await sdk.waitForCondition((s) => !s.player.isDead, 45_000).catch(() => {});
            continue;
        }
        if (craft() !== lastLoggedCraft) {
            log(`LEVEL UP Crafting ${craft()}`);
            lastLoggedCraft = craft();
        }

        if (count(FLAX) > 0) {
            if (session.metrics().phase !== 'spin') await session.setPhase('spin');
            session.setAnchor(WHEEL_HOUSE.x, WHEEL_HOUSE.z);
            await spinAllFlax();
            continue;
        }
        if (count(BOWSTRING) > 0 || (occupiedSlots() >= 28 && count(FLAX) === 0)) {
            if (session.metrics().phase !== 'bank') await session.setPhase('bank');
            session.setAnchor(SEERS_BANK.x, SEERS_BANK.z);
            await bankStrings();
            continue;
        }
        if (!bankFlaxDrained) {
            if (session.metrics().phase !== 'bank') await session.setPhase('bank');
            session.setAnchor(SEERS_BANK.x, SEERS_BANK.z);
            const got = await withdrawBankFlaxLoad();
            if (got < 0) {
                await sdk.waitForTicks(2);
                continue;
            }
            if (got > 0) continue;
            bankFlaxDrained = true;
            log('Bank is empty of flax — picking from the field');
        }
        if (occupiedSlots() < 28 && count(BOWSTRING) === 0) {
            if (session.metrics().phase !== 'pick') await session.setPhase('pick');
            session.setAnchor(FLAX_FIELD.x, FLAX_FIELD.z);
            await fillFlax();
        }
    }

    const stop = session.metrics().stopReason;
    if (stop) log(`stopped ${stop.code} @ ${stop.location.x},${stop.location.z}`);
} catch (err) {
    session.stopRestartable('script_error', err instanceof Error ? err.message : String(err));
    console.error('Script error:', err);
} finally {
    const reachedUntil =
        CRAFT_UNTIL > 0 && craft() >= CRAFT_UNTIL && session.metrics().stopReason?.code === 'done';
    await session.finalizeStop();
    // 2 tells craft-to-31 the level goal was met (0 is also setup failure / no goal).
    if (reachedUntil) process.exitCode = 2;
    console.log('Disconnecting SDK; browser client can stay open.');
    await sdk.disconnect();
}
