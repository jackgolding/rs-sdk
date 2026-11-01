/**
 * Dragonfire shields for the fleet: Duke Horacio hands one to a Dragon Slayer finisher holding
 * or wearing none, and never checks the bank (duke_horacio.rs2). So: ask him on the castle's
 * first floor, drop it, ask again — BATCH times — then pick them all up before they despawn
 * and bank them at Draynor (no bank in Lumbridge castle) (user, 2026-11-01).
 *
 *   bun bots/quests/duke-shield-farm.ts {botname} [--target=40]
 *
 * Exit 0 once the bank holds `target` shields; 1 when the Duke stops handing them over.
 */
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { BotSDK, deriveGatewayUrl } from '../../sdk/index';
import { BotActions } from '../../sdk/actions';
import { initPathfinding } from '../../sdk/pathfinding';
import { closeUi, walkNear } from './movement';
/** Shields dropped per batch: picked up well inside the ground-item lifetime, then banked. */
const BATCH = Number(process.argv.find((a) => a.startsWith('--batch='))?.split('=')[1] ?? 10);
const DUKE = { x: 3210, z: 3221 };

const SHIELD = /dragonfire shield|anti-?dragon/i;
const CASTLE_STAIRS = { x: 3205, z: 3209 };
/** Draynor bank booth stand (safe-stops DRAYNOR_BANK). */
const DRAYNOR_BANK = { x: 3092, z: 3243 };

const argv = process.argv.slice(2);
const name = argv.find((a) => !a.startsWith('-'))!;
const target = Number(argv.find((a) => a.startsWith('--target='))?.split('=')[1] ?? 40);
const envPath = join(process.cwd(), 'bots', name, 'bot.env');
if (!existsSync(envPath)) throw new Error(`bot.env not found at ${envPath}`);
for (const line of readFileSync(envPath, 'utf-8').split('\n')) {
    const t = line.trim();
    const eq = t.indexOf('=');
    if (t && !t.startsWith('#') && eq > 0) process.env[t.slice(0, eq)] = t.slice(eq + 1);
}

initPathfinding();
const sdk = new BotSDK({
    botUsername: process.env.BOT_USERNAME!,
    password: process.env.PASSWORD!,
    gatewayUrl: deriveGatewayUrl(process.env.SERVER),
    autoLaunchBrowser: false,
    readyTimeout: 45_000,
    connectTimeout: 60_000,
    showChat: false
});
await sdk.connect();
const bot = new BotActions(sdk);
const log = (m: string) => console.log(`${new Date().toISOString()} [duke-shield-farm ${name}] ${m}`);
const pos = () => ({ x: sdk.getState()?.player?.worldX ?? 0, z: sdk.getState()?.player?.worldZ ?? 0, level: sdk.getState()?.player?.level ?? 0 });

async function climbTo(want: number): Promise<boolean> {
    for (let i = 0; i < 6 && pos().level !== want; i++) {
        if (Math.hypot(pos().x - CASTLE_STAIRS.x, pos().z - CASTLE_STAIRS.z) > 4) await walkNear(bot, sdk, CASTLE_STAIRS.x, CASTLE_STAIRS.z, 2);
        await sdk.scanNearbyLocs(8).catch(() => undefined);
        const op = pos().level < want ? /^climb-up$/i : /^climb-down$/i;
        const stairs = (sdk.getNearbyLocs() ?? [])
            .filter((l) => /stair/i.test(l.name) && l.optionsWithIndex.some((o) => op.test(o.text)))
            .sort((a, b) => (a.distance ?? 99) - (b.distance ?? 99))[0];
        if (!stairs) return false;
        const before = pos().level;
        await bot.interactLoc(stairs, op).catch(() => undefined);
        await sdk.waitForCondition((s) => (s.player?.level ?? 0) !== before, 8_000).catch(() => undefined);
    }
    return pos().level === want;
}

/** Bank the shield(s) held at Draynor; returns the banked count. */
async function bankShields(): Promise<number> {
    if (pos().level > 0 && !(await climbTo(0))) throw new Error(`could not climb down from ${pos().x},${pos().z},L${pos().level}`);
    const r = await bot.walkTo(DRAYNOR_BANK.x, DRAYNOR_BANK.z, 3);
    if (!r.success) await walkNear(bot, sdk, DRAYNOR_BANK.x, DRAYNOR_BANK.z, 3);
    const opened = await bot.openBank();
    if (!opened.success) throw new Error(`castle bank: ${opened.message}`);
    for (let i = 0; i < 28; i++) {
        const item = sdk.getInventory().find((it) => (it.count ?? 0) > 0);
        if (!item) break;
        const r = await bot.depositItem(item, -1);
        if (!r.success && !r.partial) break;
    }
    const worn = sdk.findEquipmentItem(SHIELD);
    const banked = (sdk.getBankItems() ?? []).filter((b) => SHIELD.test(b.name)).reduce((n, b) => n + b.count, 0);
    await bot.closeBank();
    if (worn) log('note: a shield is worn — the Duke will refuse while it is; it stays worn');
    return banked;
}

/** One "I seek a shield" from the Duke; true when a shield lands in the pack. */
async function askDuke(): Promise<boolean> {
    if (Math.hypot(pos().x - DUKE.x, pos().z - DUKE.z) > 3) await bot.walkTo(DUKE.x, DUKE.z, 2).catch(() => undefined);
    const duke = sdk.findNearbyNpc(/^duke horacio$/i);
    if (!duke) return false;
    await bot.talkTo(duke).catch(() => undefined);
    for (let i = 0; i < 16 && !sdk.findInventoryItem(SHIELD); i++) {
        const d = sdk.getDialog();
        if (d?.isOpen && !d.isWaiting) {
            const ask = d.options.find((o) => /seek a shield/i.test(o.text));
            if (!ask && d.options.length > 1) break;
            await sdk.sendClickDialog(ask?.index ?? d.options[0]?.index ?? 0);
        }
        await sdk.waitForTicks(1).catch(() => undefined);
    }
    await bot.dismissBlockingUI().catch(() => undefined);
    return !!sdk.findInventoryItem(SHIELD);
}

/** Every dropped shield in view, before the ground items despawn. */
async function pickUpShields(): Promise<number> {
    let picked = 0;
    for (let i = 0; i < BATCH * 2 + 4; i++) {
        const g = sdk.findGroundItem(SHIELD, { reachable: true });
        if (!g || sdk.getInventory().length >= 28) break;
        const before = sdk.getInventory().filter((x) => SHIELD.test(x.name)).length;
        await bot.pickupItem(g).catch(() => undefined);
        await sdk.waitForCondition(() => sdk.getInventory().filter((x) => SHIELD.test(x.name)).length > before, 4_000).catch(() => {});
        if (sdk.getInventory().filter((x) => SHIELD.test(x.name)).length > before) picked++;
    }
    return picked;
}

let ok = false;
try {
    await closeUi(bot, sdk);
    log(`start @ ${pos().x},${pos().z},L${pos().level} target=${target}`);
    let banked = await bankShields();
    log(`bank holds ${banked} shields`);
    let misses = 0;
    while (banked < target && misses < 3) {
        if (Math.hypot(pos().x - CASTLE_STAIRS.x, pos().z - CASTLE_STAIRS.z) > 6 && pos().level === 0) {
            const r = await bot.walkTo(CASTLE_STAIRS.x, CASTLE_STAIRS.z, 2);
            if (!r.success) await walkNear(bot, sdk, CASTLE_STAIRS.x, CASTLE_STAIRS.z, 2);
        }
        if (!(await climbTo(1))) throw new Error('could not reach the Duke\'s floor');
        const batch = Math.min(BATCH, target - banked);
        let dropped = 0;
        for (let i = 0; i < batch && misses < 3; i++) {
            if (!(await askDuke())) {
                misses++;
                continue;
            }
            misses = 0;
            const shield = sdk.findInventoryItem(SHIELD);
            if (shield) {
                await sdk.sendDropItem(shield.slot);
                await sdk.waitForCondition(() => !sdk.findInventoryItem(SHIELD), 3_000).catch(() => {});
                dropped++;
            }
        }
        const picked = await pickUpShields();
        log(`batch: dropped ${dropped}, picked up ${picked}`);
        if (picked === 0 && dropped === 0) continue;
        banked = await bankShields();
        log(`shields banked — ${banked}/${target}`);
    }
    ok = banked >= target;
    log(ok ? `done: ${banked} shields banked` : `stopped: the Duke gave none ${misses} times (${banked} banked)`);
} catch (e) {
    log(`error: ${(e as Error).message}`);
} finally {
    await sdk.disconnect();
    process.exit(ok ? 0 : 1);
}
