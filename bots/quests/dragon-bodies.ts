/**
 * Dragon leather -> bodies (chests first) -> bank.
 * Withdraws tanned Dragon leather + needle/thread from the shared fleet bank,
 * uses needle on leather, picks the body option, banks products.
 * Fleet can't wear green chaps-kit bodies (only 2-3 bodies banked vs 60 chaps),
 * so bodies first; chaps/vambraces later via --product=.
 *
 *   bun bots/quests/dragon-bodies.ts {botname}
 *   bun bots/quests/dragon-bodies.ts {botname} --product=body
 *   bun bots/quests/dragon-bodies.ts {botname} --product=chaps
 */
import { ActivitySession, BotSDK, deriveGatewayUrl } from '../../sdk/index';
import { BotActions } from '../../sdk/actions';
import { initPathfinding } from '../../sdk/pathfinding';
import { resolveSkillDialogProduct } from '../../sdk/action-quantity';
import { installGracefulShutdown } from '../../sdk/runner';
import { existsSync, readFileSync } from 'fs';
import { dirname, join } from 'path';

const CATHERBY_BANK = { x: 2808, z: 3443 };

const LEATHER = /^dragon leather$/i;
const NEEDLE = /^needle$/i;
const THREAD = /^thread$/i;
const BODY = /dragonhide body/i;
const CHAPS = /dragonhide chaps/i;
const VAMBRACES = /dragonhide vambraces|dragon vambraces/i;
const COINS = /^coins$/i;
const KEEP = /^(coins|needle|thread|dragon leather|dragonhide body|dragonhide chaps|dragon ?vambraces)$/i;

const argv = process.argv.slice(2);
const botArg = argv.find((a) => !a.startsWith('-'));
const productArg = argv.find((a) => a.startsWith('--product='))?.split('=')[1]?.toLowerCase() ?? 'body';
const PRODUCT_RE = productArg === 'chaps' ? CHAPS : productArg === 'vambraces' ? VAMBRACES : BODY;
const PRODUCT_LABEL = productArg === 'chaps' ? 'chaps' : productArg === 'vambraces' ? 'vambraces' : 'body';

function loadBotEnv(): void {
    const envPath = botArg
        ? join(process.cwd(), 'bots', botArg, 'bot.env')
        : join(dirname(import.meta.path), 'bot.env');
    if (!existsSync(envPath)) {
        throw new Error(`bot.env not found at ${envPath}. Usage: bun bots/quests/dragon-bodies.ts {botname} [--product=body]`);
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
    name: 'dragon-bodies',
    grindLogPath: GRIND_LOG
});

installGracefulShutdown();

function log(msg: string): void {
    session.log('log', msg);
}
function intent(msg: string): void {
    void session.showIntent(msg);
}
function count(re: RegExp): number {
    return sdk.getInventory().filter((i) => re.test(i.name)).reduce((n, i) => n + (i.count ?? 1), 0);
}
function bankCount(re: RegExp): number {
    return (sdk.getBankItems() ?? []).filter((i) => re.test(i.name)).reduce((n, i) => n + (i.count ?? 1), 0);
}

async function closeUi(): Promise<void> {
    for (let i = 0; i < 6; i++) {
        await bot.dismissBlockingUI();
        const dialog = sdk.getDialog();
        if (dialog?.isOpen) {
            const cont = dialog.options?.find((o) => /continue|click here/i.test(o.text));
            if (cont) {
                await sdk.sendClickDialog(cont.index);
                await sdk.waitForTicks(1).catch(() => {});
                continue;
            }
            await bot.closeInterface();
            await sdk.waitForTicks(1).catch(() => {});
            continue;
        }
        if (sdk.getState()?.shop?.isOpen || sdk.getState()?.bank?.isOpen || sdk.getState()?.interface?.isOpen) {
            await bot.closeInterface();
            await sdk.waitForTicks(1).catch(() => {});
            continue;
        }
        break;
    }
}

async function openBank(): Promise<boolean> {
    await closeUi();
    if (sdk.getState()?.bank?.isOpen) return true;
    await bot.walkTo(CATHERBY_BANK.x, CATHERBY_BANK.z, 2);
    const r = await bot.openBank();
    if (!r.success) {
        session.noteFailure('bank', r.message);
        return false;
    }
    return true;
}

async function bankPhase(): Promise<'craft' | 'done'> {
    if (!(await openBank())) return 'craft';
    // Deposit finished products, keep tools + materials.
    for (const item of [...sdk.getInventory()]) {
        if (KEEP.test(item.name)) continue;
        await bot.depositItem(item, -1);
    }
    if (BODY.test('') === false) { /* noop */ }
    for (const item of [...sdk.getInventory()]) {
        if (BODY.test(item.name) || CHAPS.test(item.name) || VAMBRACES.test(item.name)) {
            await bot.depositItem(item, -1);
        }
    }
    // Ensure tools.
    if (!sdk.findInventoryItem(NEEDLE) && bankCount(NEEDLE) > 0) {
        await bot.withdrawItem(NEEDLE, 1, { asNote: false });
    }
    const threadHave = count(THREAD);
    if (threadHave < 10 && bankCount(THREAD) > 0) {
        await bot.withdrawItem(THREAD, Math.min(50 - threadHave, bankCount(THREAD)), { asNote: false });
    }
    // Fill with leather.
    const space = 28 - sdk.getInventory().filter((i) => (i.count ?? 0) > 0).length;
    const leatherBank = bankCount(LEATHER);
    const leatherInv = count(LEATHER);
    if (space > 0 && leatherBank > 0) {
        const take = Math.min(space, leatherBank);
        const r = await bot.withdrawItem(LEATHER, take, { asNote: false });
        log(`Withdraw leather x${take} ${r.success ? 'ok' : r.message} | inv ${count(LEATHER)} bank ${bankCount(LEATHER)}`);
    }
    await bot.closeBank();
    const total = count(LEATHER);
    if (total < 1 && bankCount(LEATHER) < 1) {
        // Check bank value fresh: reopen once to confirm drained.
        if (await openBank()) {
            const again = bankCount(LEATHER);
            await bot.closeBank();
            if (again < 1) return 'done';
        } else {
            return 'done';
        }
    }
    if (!sdk.findInventoryItem(NEEDLE)) {
        log('WARN no needle in inv or bank — cannot craft, idling');
        return 'done';
    }
    return 'craft';
}

async function clickProduct(): Promise<boolean> {
    const dialog = sdk.getDialog();
    if (!dialog?.isOpen) return false;
    const opts = dialog.options ?? [];
    const btn = resolveSkillDialogProduct(opts, PRODUCT_LABEL);
    if (!btn) {
        // Fallback: match body/chaps/vambraces text directly.
        const direct = opts.find((o) => PRODUCT_RE.test(o.text));
        if (!direct) return false;
        await sdk.sendClickDialog(direct.index);
        return true;
    }
    // Prefer Make-10 / Make-5 when the bag holds enough leather.
    const leather = count(LEATHER);
    const make10 = opts.find((o) => o.index === btn.index - 2 && /make 10|make all/i.test(o.text));
    const make5 = opts.find((o) => o.index === btn.index - 1 && /make 5/i.test(o.text));
    const click = leather >= 10 ? (make10 ?? make5 ?? btn) : leather >= 5 ? (make5 ?? btn) : btn;
    await sdk.sendClickDialog(click.index);
    return true;
}

async function craftAll(): Promise<number> {
    let made = 0;
    let misses = 0;
    const xpBeforeRun = sdk.getSkill('Crafting')?.experience ?? 0;
    void xpBeforeRun;
    while (count(LEATHER) > 0 && misses < 10 && !session.isStopped()) {
        await bot.dismissBlockingUI();
        const needle = sdk.findInventoryItem(NEEDLE);
        const leather = sdk.findInventoryItem(LEATHER);
        if (!needle || !leather) break;
        const bodiesBefore = count(BODY) + count(CHAPS) + count(VAMBRACES);
        const leatherBefore = count(LEATHER);
        const craftXpBefore = sdk.getSkill('Crafting')?.experience ?? 0;
        intent(`Crafting ${PRODUCT_LABEL} (${count(LEATHER)} leather left)`);
        const r = await sdk.sendUseItemOnItem(needle.slot, leather.slot);
        if (!r.success) {
            session.noteFailure('craft-use', r.message);
            misses++;
            await sdk.waitForTicks(1).catch(() => {});
            continue;
        }
        await sdk.waitForCondition((s) => s.dialog?.isOpen === true, 5_000).catch(() => {});
        if (sdk.getDialog()?.isOpen) {
            const clicked = await clickProduct();
            if (!clicked) {
                log(`WARN no ${PRODUCT_LABEL} option in craft dialog: ${(sdk.getDialog()?.options ?? []).map((o) => o.text).join(' | ').slice(0, 200)}`);
                await closeUi();
                misses++;
                continue;
            }
            await sdk.waitForCondition(
                () => count(LEATHER) < leatherBefore || count(BODY) + count(CHAPS) + count(VAMBRACES) > bodiesBefore || (sdk.getSkill('Crafting')?.experience ?? 0) > craftXpBefore,
                15_000
            ).catch(() => {});
        } else {
            await sdk.waitForCondition(
                () => count(LEATHER) < leatherBefore || (sdk.getSkill('Crafting')?.experience ?? 0) > craftXpBefore,
                8_000
            ).catch(() => {});
        }
        await bot.dismissBlockingUI();
        const bodiesAfter = count(BODY) + count(CHAPS) + count(VAMBRACES);
        if (bodiesAfter > bodiesBefore || count(LEATHER) < leatherBefore) {
            made += Math.max(1, bodiesAfter - bodiesBefore);
            misses = 0;
            session.noteProgress('xp', 'craft');
            continue;
        }
        misses++;
        await sdk.waitForTicks(1).catch(() => {});
    }
    return made;
}

log(`Dragon-bodies start product=${PRODUCT_LABEL} Crafting=${sdk.getSkill('Crafting')?.baseLevel ?? 1} @ Catherby`);
let trips = 0;
for (;;) {
    if (session.isStopped()) break;
    const phase = await bankPhase();
    if (phase === 'done') {
        log(`CRAFT DONE product=${PRODUCT_LABEL} trips=${trips} — leather drained, idling`);
        session.noteProgress('bank', 'craft-done');
        // Idle (no exit) so the box container does not tight-restart.
        for (let i = 0; i < 360 && !session.isStopped(); i++) {
            await sdk.waitForTicks(100).catch(() => {});
            await new Promise((r) => setTimeout(r, 5_000));
        }
        break;
    }
    const made = await craftAll();
    trips++;
    session.recordTrip(made);
    log(`Trips=${trips} made~${made} this load | inv leather=${count(LEATHER)} bodies=${count(BODY)} chaps=${count(CHAPS)} thread=${count(THREAD)}`);
    if (made === 0 && count(LEATHER) > 0) {
        log('WARN craft loop made 0 with leather present — retrying bank before giving up');
        await closeUi();
    }
}
