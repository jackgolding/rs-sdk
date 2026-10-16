/**
 * Bank herblore: identify unids, make unfinished potions, mix secondaries.
 *
 *   bun bots/quests/herblore.ts jackthief
 *
 * Stays on the nearest Catherby/Edgeville bank. At 99 it still clears remaining
 * bank herbs, then idles until more show up.
 */
import { existsSync, readFileSync } from 'fs';
import { dirname, join } from 'path';
import { ActivitySession, BotSDK, deriveGatewayUrl } from '../../sdk/index';
import { BotActions } from '../../sdk/actions';
import { initPathfinding } from '../../sdk/pathfinding';
import { CATHERBY_BANK, EDGEVILLE } from './tiles';
import { distTo, playerPos, walkNear } from './movement';
import { installGracefulShutdown } from '../../sdk/runner';

const UNID_HERB = /^herb$/i;
const VIAL_WATER = /^vial of water$/i;
const UNF_POTION = /^unfinished potion$/i;

const UNID_LEVELS: Record<number, number> = {
    199: 3,
    201: 5,
    203: 11,
    205: 20,
    207: 25,
    3049: 30,
    209: 40,
    211: 48,
    213: 54,
    3051: 59,
    215: 65,
    2485: 67,
    217: 70,
    219: 75
};

const HERB_RECIPES: { herbPattern: RegExp; secondaryPattern: RegExp; minLevel: number; name: string }[] = [
    { name: 'attack', herbPattern: /^guam leaf$/i, secondaryPattern: /^eye of newt$/i, minLevel: 3 },
    { name: 'antipoison', herbPattern: /^marrentill$/i, secondaryPattern: /^unicorn horn dust$/i, minLevel: 5 },
    { name: 'strength', herbPattern: /^tarromin$/i, secondaryPattern: /^limpwurt root$/i, minLevel: 12 },
    { name: 'restore', herbPattern: /^harralander$/i, secondaryPattern: /^red spiders'? eggs?$/i, minLevel: 22 },
    { name: 'prayer', herbPattern: /^ranarr weed$/i, secondaryPattern: /^snape grass$/i, minLevel: 38 },
    { name: 'super attack', herbPattern: /^irit leaf$/i, secondaryPattern: /^eye of newt$/i, minLevel: 45 },
    { name: 'fishing', herbPattern: /^avantoe$/i, secondaryPattern: /^snape grass$/i, minLevel: 50 },
    { name: 'super strength', herbPattern: /^kwuarm$/i, secondaryPattern: /^limpwurt root$/i, minLevel: 55 },
    { name: 'super defence', herbPattern: /^cadantine$/i, secondaryPattern: /^white berries$/i, minLevel: 66 },
    { name: 'antifire', herbPattern: /^lantadyme$/i, secondaryPattern: /^dragon scale dust$/i, minLevel: 69 },
    { name: 'ranging', herbPattern: /^dwarf weed$/i, secondaryPattern: /^wine of zamorak$/i, minLevel: 72 },
    { name: 'zamorak brew', herbPattern: /^torstol$/i, secondaryPattern: /^jangerberries$/i, minLevel: 78 }
];

const argv = process.argv.slice(2);
const botArg = argv.find((a) => !a.startsWith('-'));

function loadBotEnv(): void {
    const envPath = botArg
        ? join(process.cwd(), 'bots', botArg, 'bot.env')
        : join(dirname(import.meta.path), 'bot.env');
    if (!existsSync(envPath)) {
        throw new Error(`bot.env not found at ${envPath}. Usage: bun bots/quests/herblore.ts {botname}`);
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
    name: 'herblore',
    grindLogPath: GRIND_LOG,
    stallMs: 180_000,
    maxRecoveryTactics: 8
});

installGracefulShutdown({ graceMs: 30_000 });

function log(msg: string): void {
    session.log('log', msg);
}

function herbloreLevel(): number {
    return sdk.getSkill('Herblore')?.baseLevel ?? 1;
}

function herbloreXp(): number {
    return sdk.getSkill('Herblore')?.experience ?? 0;
}

function bankTile() {
    const p = playerPos(sdk);
    const catherby = Math.hypot(p.x - CATHERBY_BANK.x, p.z - CATHERBY_BANK.z);
    const edge = Math.hypot(p.x - EDGEVILLE.x, p.z - EDGEVILLE.z);
    return catherby <= edge ? CATHERBY_BANK : EDGEVILLE;
}

async function depositAllInventory(): Promise<void> {
    for (let i = 0; i < 40; i++) {
        const item = sdk.getInventory().find((it) => (it.count ?? 0) > 0);
        if (!item) break;
        const r = await bot.depositItem(item, -1);
        if (!r.success && !r.partial) break;
    }
}

async function openHerbBank(): Promise<boolean> {
    await bot.dismissBlockingUI();
    const dest = bankTile();
    if (distTo(sdk, dest.x, dest.z) > 6) await walkNear(bot, sdk, dest.x, dest.z, 3);
    if (sdk.getState()?.bank?.isOpen) return true;
    const opened = await bot.openBank();
    if (!opened.success && !sdk.getState()?.bank?.isOpen) {
        session.log('warn', `openBank: ${opened.message}`);
        return false;
    }
    return !!sdk.getState()?.bank?.isOpen;
}

async function identifyAllUnids(): Promise<boolean> {
    let identifiedAny = false;
    for (let loads = 0; loads < 40; loads++) {
        await bot.dismissBlockingUI();
        if (!(await openHerbBank())) break;
        await depositAllInventory();
        const currentLvl = herbloreLevel();
        const eligible = sdk
            .getBankItems()
            .find((i) => UNID_HERB.test(i.name) && (i.count ?? 0) > 0 && (UNID_LEVELS[i.id] ?? 99) <= currentLvl);
        if (!eligible) {
            await bot.closeBank();
            break;
        }
        log(
            `Withdrawing unids (${eligible.name} id ${eligible.id}, req ${UNID_LEVELS[eligible.id]}, ${eligible.count} in bank)`
        );
        await bot.withdrawItem(eligible, 28);
        await bot.closeBank();

        let slotIdentified = 0;
        for (const item of [...sdk.getInventory()]) {
            if (!UNID_HERB.test(item.name) || (item.count ?? 0) <= 0) continue;
            const xpBefore = herbloreXp();
            await sdk.sendUseItem(item.slot, 1);
            await sdk.waitForTicks(1);
            if (herbloreXp() > xpBefore) {
                slotIdentified++;
                identifiedAny = true;
                session.noteProgress('xp', 'identify');
            }
        }
        log(`Identified ${slotIdentified} herbs | Herblore ${herbloreLevel()} (${herbloreXp()} xp)`);
        if (await openHerbBank()) {
            await depositAllInventory();
            await bot.closeBank();
        }
        if (slotIdentified === 0) break;
    }
    return identifiedAny;
}

async function brewAvailablePotions(): Promise<boolean> {
    let brewedAny = false;
    for (const recipe of HERB_RECIPES) {
        if (herbloreLevel() < recipe.minLevel) continue;
        while (true) {
            await bot.dismissBlockingUI();
            if (!(await openHerbBank())) break;
            await depositAllInventory();
            const cleanHerb = sdk.findBankItem(recipe.herbPattern);
            const secondary = sdk.findBankItem(recipe.secondaryPattern);
            const vials = sdk.findBankItem(VIAL_WATER);
            const herbN = cleanHerb?.count ?? 0;
            const secN = secondary?.count ?? 0;
            const vialN = vials?.count ?? 0;
            const batchSize = Math.min(14, herbN, secN, vialN);
            if (batchSize <= 0) {
                await bot.closeBank();
                break;
            }
            await bot.withdrawItem(cleanHerb!, batchSize);
            await bot.withdrawItem(vials!, batchSize);
            await bot.closeBank();

            for (let i = 0; i < batchSize; i++) {
                const herb = sdk.findInventoryItem(recipe.herbPattern);
                const vial = sdk.findInventoryItem(VIAL_WATER);
                if (!herb || !vial) break;
                await sdk.sendUseItemOnItem(herb.slot, vial.slot);
                await sdk.waitForTicks(1);
            }

            if (!(await openHerbBank())) break;
            await bot.withdrawItem(secondary!, batchSize);
            await bot.closeBank();

            const xpBefore = herbloreXp();
            for (let i = 0; i < batchSize; i++) {
                const unf = sdk.findInventoryItem(UNF_POTION);
                const sec = sdk.findInventoryItem(recipe.secondaryPattern);
                if (!unf || !sec) break;
                await sdk.sendUseItemOnItem(sec.slot, unf.slot);
                await sdk.waitForTicks(1);
            }
            const xpGained = herbloreXp() - xpBefore;
            brewedAny = true;
            session.noteProgress('xp', recipe.name);
            log(
                `Brewed ${batchSize} ${recipe.name} | +${xpGained} XP | Herblore ${herbloreLevel()} (${herbloreXp()} xp)`
            );

            if (await openHerbBank()) {
                await depositAllInventory();
                await bot.closeBank();
            }
        }
    }
    return brewedAny;
}

session.registerRecovery([
    {
        name: 'close_ui',
        run: async () => {
            await bot.dismissBlockingUI();
            if (sdk.getState()?.shop?.isOpen || sdk.getState()?.interface?.isOpen) await bot.closeInterface();
            return true;
        }
    }
]);

try {
    await bot.skipTutorial();
    await bot.dismissBlockingUI();
    const dest = bankTile();
    session.setAnchor(dest.x, dest.z);
    log(`Herblore start ${herbloreLevel()} (${herbloreXp()} xp) @ ${playerPos(sdk).x},${playerPos(sdk).z}`);

    while (!session.isStopped()) {
        if (session.needsRecovery()) {
            if ((await session.recover()) === 'exhausted') break;
            continue;
        }
        session.maybeHeartbeat();
        const identified = await identifyAllUnids();
        const brewed = await brewAvailablePotions();
        if (identified || brewed) continue;
        await session.setPhase('idle');
        log(`No more identifiable unids or brewable potions | Herblore ${herbloreLevel()}`);
        await sdk.waitForTicks(50);
    }
} catch (err) {
    session.stop('script_error', err instanceof Error ? err.message : String(err));
    console.error('Script error:', err);
    throw err;
} finally {
    await session.finalizeStop();
    await sdk.disconnect();
}
