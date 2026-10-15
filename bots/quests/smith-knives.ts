/**
 * Bank smithing: turn adamantite and runite bars into knives at Doric's anvil.
 *
 *   bun bots/quests/smith-knives.ts Jackpoo2
 */
import { ActivitySession, BotSDK, deriveGatewayUrl } from '../../sdk/index';
import { BotActions } from '../../sdk/actions';
import { initPathfinding } from '../../sdk/pathfinding';
import { existsSync, readFileSync } from 'fs';
import { dirname, join } from 'path';
import { DORIC_ANVIL, FALADOR_NORTH, FALADOR_WEST_BANK } from './tiles';
import { closeUi, distTo, walkNear, walkWaypoints } from './movement';
import { installGracefulShutdown } from '../../sdk/runner';

const HAMMER = /^hammer$/i;
const ADDY_BAR = /^adamantite bar$/i;
const RUNE_BAR = /^runite bar$/i;
const KNIVES = /^(adamant|runite|rune) kni(fe|ves)$/i;

const TO_DORIC = [
    { x: 3018, z: 3450 },
    DORIC_ANVIL
];

const argv = process.argv.slice(2);
const botArg = argv.find((a) => !a.startsWith('-'));

function loadBotEnv(): void {
    const envPath = botArg
        ? join(process.cwd(), 'bots', botArg, 'bot.env')
        : join(dirname(import.meta.path), 'bot.env');
    if (!existsSync(envPath)) {
        throw new Error(`bot.env not found at ${envPath}. Usage: bun bots/quests/smith-knives.ts {botname}`);
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
    name: 'smith-knives',
    grindLogPath: GRIND_LOG,
    stallMs: 180_000,
    maxRecoveryTactics: 6
});

installGracefulShutdown({ graceMs: 30_000 });

function log(msg: string): void {
    session.log('log', msg);
}

function smithing(): number {
    return sdk.getSkill('Smithing')?.baseLevel ?? 1;
}

function smithXp(): number {
    return sdk.getSkill('Smithing')?.experience ?? 0;
}

function count(pattern: RegExp): number {
    return sdk.getInventory().filter((i) => pattern.test(i.name)).reduce((n, i) => n + (i.count ?? 1), 0);
}

function bankCount(pattern: RegExp): number {
    return sdk.findBankItem(pattern)?.count ?? 0;
}

function hasHammer(): boolean {
    return !!sdk.findInventoryItem(HAMMER);
}

function bankReady(): boolean {
    const s = sdk.getState();
    return !!(s?.bank?.isOpen && s?.interface?.isOpen);
}

function pos(): { x: number; z: number } {
    const p = sdk.getState()?.player;
    return { x: p?.worldX ?? 0, z: p?.worldZ ?? 0 };
}

function usableBooth() {
    return (sdk.getNearbyLocs() ?? [])
        .filter((l) => /bank booth/i.test(l.name) && (l.optionsWithIndex?.length ?? 0) > 0)
        .sort((a, b) => (a.distance ?? 99) - (b.distance ?? 99))[0];
}

async function clickBooth(): Promise<boolean> {
    const booth = usableBooth();
    if (!booth) return false;
    const opt =
        (booth.optionsWithIndex ?? []).find((o) => /use.quickly|^bank$/i.test(o.text)) ??
        (booth.optionsWithIndex ?? []).find((o) => /use/i.test(o.text));
    if (!opt) return false;
    log(`Clicking ${booth.name} @ ${booth.x},${booth.z} from ${pos().x},${pos().z}`);
    await sdk.sendInteractLoc(booth.x, booth.z, booth.id, opt.opIndex);
    await sdk.waitForCondition(() => bankReady(), 6_000).catch(() => {});
    return bankReady();
}

async function logBankStock(): Promise<void> {
    if (!bankReady()) return;
    log(
        `Bank stock: runite bar ${bankCount(RUNE_BAR)}, adamantite bar ${bankCount(ADDY_BAR)} | Smithing ${smithing()}`
    );
}

async function openWestBank(): Promise<boolean> {
    await closeUi(bot, sdk);
    // 2945,3368 is the notice board — hop onto the floor in front of the booths.
    if (distTo(sdk, FALADOR_WEST_BANK.x, FALADOR_WEST_BANK.z) > 8) {
        await walkNear(bot, sdk, 2946, 3368, 2);
    } else if (pos().x === FALADOR_WEST_BANK.x && pos().z === FALADOR_WEST_BANK.z) {
        await sdk.sendWalk(2946, 3368);
        await sdk.waitForCondition(() => pos().x !== 2945 || pos().z !== 3368, 4_000).catch(() => {});
    }
    if (bankReady()) return true;
    if (sdk.getState()?.bank?.isOpen || sdk.getState()?.interface?.isOpen) {
        await bot.closeInterface();
        await sdk.waitForTicks(1);
    }
    const opened = await bot.openBank();
    if (!opened.success) session.log('warn', `openBank: ${opened.message}`);
    if (bankReady()) return true;
    if (await clickBooth()) return true;
    session.log(
        'warn',
        `Bank not ready after open (bank=${!!sdk.getState()?.bank?.isOpen} iface=${!!sdk.getState()?.interface?.isOpen}) @ ${pos().x},${pos().z}`
    );
    return false;
}

async function goToDoric(): Promise<boolean> {
    await closeUi(bot, sdk);
    if (distTo(sdk, DORIC_ANVIL.x, DORIC_ANVIL.z) <= 6 && sdk.findNearbyLoc(/anvil/i)) return true;
    if (distTo(sdk, DORIC_ANVIL.x, DORIC_ANVIL.z) > 30) {
        await walkNear(bot, sdk, FALADOR_NORTH.x, FALADOR_NORTH.z, 4);
    }
    await walkWaypoints(bot, sdk, TO_DORIC);
    await walkNear(bot, sdk, DORIC_ANVIL.x, DORIC_ANVIL.z, 2);
    return distTo(sdk, DORIC_ANVIL.x, DORIC_ANVIL.z) <= 8 || !!sdk.findNearbyLoc(/anvil/i);
}

async function depositAll(): Promise<void> {
    for (let i = 0; i < 40; i++) {
        const item = sdk.getInventory().find((it) => (it.count ?? 0) > 0 && !HAMMER.test(it.name));
        if (!item) break;
        const r = await bot.depositItem(item, -1);
        if (!r.success && !r.partial) break;
    }
}

function pickBarPattern(): RegExp | null {
    if (bankCount(RUNE_BAR) > 0 || count(RUNE_BAR) > 0) return RUNE_BAR;
    if (bankCount(ADDY_BAR) > 0 || count(ADDY_BAR) > 0) return ADDY_BAR;
    return null;
}

async function withdrawTrip(): Promise<boolean> {
    if (!(await openWestBank())) return false;
    const barPattern = pickBarPattern();
    if (!barPattern) {
        await bot.closeBank();
        return false;
    }
    await depositAll();
    if (!hasHammer()) {
        const hammer = sdk.findBankItem(HAMMER);
        if (hammer) {
            const hr = await bot.withdrawItem(hammer, 1);
            if (!hr.success && !hr.partial) session.log('warn', `Withdraw hammer: ${hr.message}`);
        } else {
            session.log('warn', 'No hammer in bank');
        }
    }
    const inBank = barPattern === RUNE_BAR ? bankCount(RUNE_BAR) : bankCount(ADDY_BAR);
    const amount = Math.min(27, inBank);
    if (amount <= 0) {
        await bot.closeBank();
        return false;
    }
    const item = sdk.findBankItem(barPattern);
    if (!item) {
        await bot.closeBank();
        return false;
    }
    const wr = await bot.withdrawItem(item, amount);
    if (!wr.success && !wr.partial) session.log('warn', `Withdraw bars: ${wr.message}`);
    await bot.closeBank();
    if (count(barPattern) <= 0) return false;
    log(`Withdrew ${count(barPattern)} ${item.name} | Smithing ${smithing()}`);
    return true;
}

async function smithKnives(barPattern: RegExp): Promise<number> {
    if (!(await goToDoric())) return 0;
    let smithed = 0;
    while (count(barPattern) > 0 && !session.isStopped()) {
        const before = count(barPattern);
        const xpBefore = smithXp();
        const r = await bot.smithAtAnvil('knives', { barPattern, timeout: 30_000 });
        if (!r.success) {
            log(`Smith knives failed: ${r.message}`);
            break;
        }
        const used = before - count(barPattern);
        if (used > 0) {
            smithed += used;
            session.noteProgress('xp', 'knives');
            log(`Smithed ${used} knives | Smithing ${smithing()} (${smithXp()} xp)`);
        } else if (smithXp() <= xpBefore) {
            break;
        }
    }
    return smithed;
}

session.registerRecovery([
    {
        name: 'close_ui',
        run: async () => {
            await closeUi(bot, sdk);
            return true;
        }
    }
]);

try {
    await bot.skipTutorial();
    await closeUi(bot, sdk);
    log(`Smith-knives start Smithing ${smithing()} (${smithXp()} xp)`);

    while (!session.isStopped()) {
        if (session.needsRecovery()) {
            if ((await session.recover()) === 'exhausted') break;
            continue;
        }
        session.maybeHeartbeat();

        if (count(RUNE_BAR) === 0 && count(ADDY_BAR) === 0 && !(await withdrawTrip())) {
            if (!(await openWestBank())) {
                await sdk.waitForTicks(5);
                continue;
            }
            await logBankStock();
            const rune = bankCount(RUNE_BAR);
            const addy = bankCount(ADDY_BAR);
            await bot.closeBank();
            if (rune + addy <= 0) {
                await session.setPhase('idle');
                log(`No adamantite or runite bars left | Smithing ${smithing()}`);
                await sdk.waitForTicks(50);
                continue;
            }
            await sdk.waitForTicks(5);
            continue;
        }

        const pattern = count(RUNE_BAR) > 0 ? RUNE_BAR : ADDY_BAR;
        if (count(pattern) <= 0) {
            await sdk.waitForTicks(5);
            continue;
        }

        await session.setPhase('smith');
        const made = await smithKnives(pattern);
        if (made > 0 && (await openWestBank())) {
            await depositAll();
            await bot.closeBank();
        }
        if (made === 0) await sdk.waitForTicks(5);
    }
} catch (err) {
    session.stop('script_error', err instanceof Error ? err.message : String(err));
    console.error('Script error:', err);
    throw err;
} finally {
    await session.finalizeStop();
    await sdk.disconnect();
}
