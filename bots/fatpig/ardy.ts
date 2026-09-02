import { BotSDK, deriveGatewayUrl } from '../../sdk/index';
import { BotActions } from '../../sdk/actions';
import { initPathfinding } from '../../sdk/pathfinding';
import { readFileSync, appendFileSync } from 'fs';
import { dirname, join } from 'path';

const BOAT_GP = 60;
const LUMBRIDGE_MEN = { x: 3222, z: 3218 };
const DRAYNOR_BANK = { x: 3092, z: 3243 };
const PORT_SARIM_DOCK = { x: 3029, z: 3217 };
const BRIMHAVEN_CUSTOMS = { x: 2772, z: 3225 };
const ARDOUGNE_MARKET = { x: 2662, z: 3312 };
const MUSA_TO_BRIMHAVEN = [
    { x: 2864, z: 3154 },
    { x: 2812, z: 3176 },
    { x: 2772, z: 3225 }
];

function loadBotEnv(): void {
    const envPath = join(dirname(import.meta.path), 'bot.env');
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
const GRIND_LOG = join(dirname(import.meta.path), 'grind.log');

function log(msg: string): void {
    console.log(msg);
    try {
        appendFileSync(GRIND_LOG, `${new Date().toISOString()} ${msg}\n`);
    } catch {
        /* ignore */
    }
}

console.log('Warming pathfinder...');
initPathfinding();

const sdk = new BotSDK({
    botUsername: username,
    password,
    gatewayUrl: deriveGatewayUrl(server),
    autoLaunchBrowser: true,
    browserLaunchTimeout: 90_000,
    readyTimeout: 45_000,
    connectTimeout: 60_000,
    showChat: false
});

console.log('Opening/attaching the game client...');
await sdk.connect();
const bot = new BotActions(sdk);

let lastIntent = '';

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
        isDead: p?.isDead ?? false,
        inCombat: p?.combat?.inCombat ?? false
    };
}

function distTo(x: number, z: number): number {
    const p = pos();
    return Math.hypot(p.x - x, p.z - z);
}

function coinCount(): number {
    return sdk.findInventoryItem(/coins/i)?.count ?? 0;
}

function inArdougne(): boolean {
    const p = pos();
    return p.x < 2750 && p.x > 2500 && p.z > 3240;
}

function onKaramja(): boolean {
    const p = pos();
    return p.x > 2680 && p.x < 3010 && p.z > 3040 && p.z < 3270;
}

function onMusa(): boolean {
    return onKaramja() && pos().x >= 2815;
}

function onDockedShip(): boolean {
    if (inArdougne()) return false;
    if (pos().level < 1) return false;
    const locs = sdk.getNearbyLocs() ?? [];
    return locs.some((l) => /gangplank|ship's (ladder|wheel)|anchor/i.test(l.name));
}

async function leaveDockedShip(): Promise<void> {
    if (!onDockedShip()) return;
    log(`On a docked ship at (${pos().x},${pos().z}) lv${pos().level} — getting off`);
    for (let i = 0; i < 6 && onDockedShip(); i++) {
        await crossGangplank();
        await sdk.waitForTicks(2);
    }
    log(`After leaving ship: (${pos().x},${pos().z}) lv${pos().level}`);
}

async function walkNear(x: number, z: number, tolerance = 6): Promise<boolean> {
    if (distTo(x, z) <= tolerance) return true;
    const result = await bot.walkTo(x, z, Math.min(tolerance, 3));
    return result.success || distTo(x, z) <= tolerance + 2;
}

async function clickBoatDialog(): Promise<void> {
    let closedStreak = 0;
    for (let i = 0; i < 24; i++) {
        const dialog = sdk.getDialog();
        if (!dialog?.isOpen) {
            closedStreak++;
            if (closedStreak >= 4) return;
            await new Promise((r) => setTimeout(r, 250));
            continue;
        }
        closedStreak = 0;
        if (dialog.isWaiting) {
            await sdk.waitForTicks(1);
            continue;
        }
        const opts = dialog.options ?? [];
        const pick =
            opts.find((o) => /search away|nothing to hide/i.test(o.text)) ||
            opts.find((o) => /yes please|pay|30|ardougne|karamja/i.test(o.text)) ||
            opts.find((o) => /^ok\.?$/i.test(o.text)) ||
            opts.find((o) => /journey|ship/i.test(o.text)) ||
            opts.find((o) => /yes/i.test(o.text) && !/crandor|bother|miss/i.test(o.text));
        log(`Boat dialog -> ${pick?.text ?? 'continue'} (${opts.map((o) => o.text).join(' | ')})`);
        await sdk.sendClickDialog(pick?.index ?? 0);
        await sdk.waitForTicks(1);
    }
}

async function crossGangplank(): Promise<void> {
    const plank = sdk.findNearbyLoc(/gangplank/i);
    if (!plank) return;
    const opt = plank.optionsWithIndex.find((o) => /cross|board/i.test(o.text));
    log('Crossing gangplank');
    if (opt) await sdk.sendInteractLoc(plank.x, plank.z, plank.id, opt.opIndex);
    else await bot.interactLoc(plank, /cross|board/i);
    await sdk.waitForTicks(5);
}

async function bankAtDraynor(): Promise<void> {
    intent('Banking at Draynor before the trip');
    await walkNear(DRAYNOR_BANK.x, DRAYNOR_BANK.z, 5);
    if (sdk.getState()?.dialog?.isOpen) await sdk.sendClickDialog(0);
    const opened = await bot.openBank();
    if (!opened.success) {
        console.log(`openBank failed: ${opened.message}`);
        return;
    }
    for (const item of [...sdk.getInventory()]) {
        if (/^coins$/i.test(item.name)) continue;
        await bot.depositItem(item, -1);
    }
    if (coinCount() < BOAT_GP) {
        await bot.withdrawItem(/^coins$/i, BOAT_GP).catch(() => {});
    }
    await bot.closeBank();
    log(`After bank: ${coinCount()} gp @ ${pos().x},${pos().z}`);
}

async function pickpocketMen(): Promise<void> {
    if (distTo(LUMBRIDGE_MEN.x, LUMBRIDGE_MEN.z) > 8) {
        intent('Walking to Lumbridge men');
        await walkNear(LUMBRIDGE_MEN.x, LUMBRIDGE_MEN.z, 4);
    }
    await bot.dismissBlockingUI();
    const npc =
        sdk.findNearbyNpc(/^man$/i, { reachable: true }) ??
        sdk.findNearbyNpc(/^woman$/i, { reachable: true }) ??
        sdk.findNearbyNpc(/^(man|woman)$/i);
    if (!npc) {
        await walkNear(LUMBRIDGE_MEN.x, LUMBRIDGE_MEN.z, 3);
        await sdk.waitForTicks(2);
        return;
    }
    intent(`Pickpocketing ${npc.name} (${coinCount()} gp)`);
    const result = await bot.pickpocketNpc(npc);
    console.log(
        `${result.success ? 'ok' : result.reason} ${npc.name} | ${coinCount()} gp`
    );
    if (result.reason === 'stunned') await sdk.waitForTicks(6);
}

async function portSarimToMusa(): Promise<void> {
    if (onKaramja() || inArdougne()) return;
    intent('Port Sarim sailor → Musa Point (30gp)');
    await walkNear(PORT_SARIM_DOCK.x, PORT_SARIM_DOCK.z, 4);
    const sailor =
        sdk.findNearbyNpc(/^captain tobias$/i) ??
        sdk.findNearbyNpc(/^seaman /i) ??
        sdk.findNearbyNpc(/sailor|seaman|captain tobias/i);
    if (!sailor) {
        log('No sailor at Port Sarim');
        return;
    }
    const startX = pos().x;
    await bot.talkTo(sailor);
    await clickBoatDialog();
    for (let i = 0; i < 40 && !onKaramja(); i++) {
        await crossGangplank();
        if (sdk.getDialog()?.isOpen) await clickBoatDialog();
        if (Math.abs(pos().x - startX) > 40) break;
        await sdk.waitForTicks(2);
    }
    log(`After Port Sarim boat: (${pos().x},${pos().z}) gp=${coinCount()}`);
}

async function musaToBrimhaven(): Promise<void> {
    if (!onMusa()) return;
    log('Walking Musa Point → Brimhaven (skip Musa customs)');
    for (const wp of MUSA_TO_BRIMHAVEN) {
        if (!onMusa()) break;
        await walkNear(wp.x, wp.z, 8);
    }
    await walkNear(BRIMHAVEN_CUSTOMS.x, BRIMHAVEN_CUSTOMS.z, 5);
}

async function brimhavenToArdougne(): Promise<void> {
    if (inArdougne()) return;
    if (!onKaramja() || onMusa()) return;
    // The Brimhaven ship does not sail from the gangplank — Customs Officer
    // teleports you. Crossing while docked just boards the empty boat.
    await leaveDockedShip();
    intent('Brimhaven customs → Ardougne (30gp)');
    await walkNear(BRIMHAVEN_CUSTOMS.x, BRIMHAVEN_CUSTOMS.z, 4);
    const customs =
        sdk.findNearbyNpc(/^customs officer$/i) ?? sdk.findNearbyNpc(/customs officer/i);
    if (!customs) {
        log('No Customs officer at Brimhaven');
        return;
    }
    const gpBefore = coinCount();
    await bot.talkTo(customs);
    await clickBoatDialog();
    for (let i = 0; i < 20 && !inArdougne(); i++) {
        if (sdk.getDialog()?.isOpen) await clickBoatDialog();
        else if (onDockedShip()) await leaveDockedShip();
        await sdk.waitForTicks(2);
    }
    log(`After Brimhaven boat: (${pos().x},${pos().z}) gp=${coinCount()} (was ${gpBefore})`);
}

async function leaveArdougneShip(): Promise<void> {
    if (pos().z < 3271 && sdk.findNearbyLoc(/gangplank/i)) {
        log('Leaving the Ardougne docks');
        await crossGangplank();
        await sdk.waitForTicks(3);
    }
    await walkNear(ARDOUGNE_MARKET.x, ARDOUGNE_MARKET.z, 8);
}

try {
    console.log(`Goal: ${BOAT_GP} gp from men, then Port Sarim → Karamja → Ardougne`);
    await bot.skipTutorial();
    await bot.dismissBlockingUI();
    if (!onKaramja() && !inArdougne()) {
        await bankAtDraynor();
    } else {
        log(`Resume at (${pos().x},${pos().z}) lv${pos().level} gp=${coinCount()}`);
        await leaveDockedShip();
    }

    while (coinCount() < BOAT_GP && !onKaramja() && !inArdougne()) {
        if (pos().isDead) {
            await sdk.waitForCondition((s) => !s.player.isDead, 45_000).catch(() => {});
            continue;
        }
        await pickpocketMen();
    }
    log(`Fare ready: ${coinCount()} gp`);

    while (!inArdougne() || distTo(ARDOUGNE_MARKET.x, ARDOUGNE_MARKET.z) > 25) {
        await bot.dismissBlockingUI();
        if (pos().isDead) {
            await sdk.waitForCondition((s) => !s.player.isDead, 45_000).catch(() => {});
            continue;
        }
        if (inArdougne()) {
            await leaveArdougneShip();
            if (distTo(ARDOUGNE_MARKET.x, ARDOUGNE_MARKET.z) <= 25) break;
            continue;
        }
        if (onMusa()) {
            await musaToBrimhaven();
            continue;
        }
        if (onKaramja()) {
            await brimhavenToArdougne();
            continue;
        }
        if (coinCount() < 30) {
            await pickpocketMen();
            continue;
        }
        await portSarimToMusa();
        if (!onKaramja()) await sdk.waitForTicks(3);
    }

    log(`Arrived Ardougne (${pos().x},${pos().z}) with ${coinCount()} gp`);
    console.log(`Done: (${pos().x},${pos().z}) | ${coinCount()} gp`);
} catch (err) {
    console.error('Script error:', err);
    throw err;
} finally {
    console.log('Disconnecting SDK; browser client can stay open.');
    await sdk.disconnect();
}
