/**
 * Dragonfire shields for the fleet: Duke Horacio hands one to a Dragon Slayer finisher holding
 * or wearing none, and never checks the bank (duke_horacio.rs2). So: ask him on the castle's
 * first floor, bank the shield one floor up, ask again (user, 2026-11-01).
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
import { fetchDukeShield } from './duke-shield';

const SHIELD = /dragonfire shield|anti-?dragon/i;
const CASTLE_STAIRS = { x: 3205, z: 3209 };
/** Lumbridge castle bank, second floor (level 2). */
const CASTLE_BANK = { x: 3208, z: 3220 };

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

/** Bank the shield(s) held on the castle's top floor; returns the banked count. */
async function bankShields(): Promise<number> {
    if (!(await climbTo(2))) throw new Error(`could not climb to the castle bank from ${pos().x},${pos().z},L${pos().level}`);
    await walkNear(bot, sdk, CASTLE_BANK.x, CASTLE_BANK.z, 2);
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

let ok = false;
try {
    await closeUi(bot, sdk);
    log(`start @ ${pos().x},${pos().z},L${pos().level} target=${target}`);
    if (Math.hypot(pos().x - CASTLE_STAIRS.x, pos().z - CASTLE_STAIRS.z) > 30) {
        const r = await bot.walkTo(CASTLE_STAIRS.x, CASTLE_STAIRS.z, 3);
        if (!r.success) await walkNear(bot, sdk, CASTLE_STAIRS.x, CASTLE_STAIRS.z, 3);
    }
    let banked = await bankShields();
    log(`bank holds ${banked} shields`);
    let misses = 0;
    while (banked < target && misses < 3) {
        if (!(await climbTo(1))) throw new Error('could not reach the Duke\'s floor');
        const got = await fetchDukeShield(bot, sdk, log);
        if (!got) {
            misses++;
            continue;
        }
        misses = 0;
        banked = await bankShields();
        log(`shield banked — ${banked}/${target}`);
    }
    ok = banked >= target;
    log(ok ? `done: ${banked} shields banked` : `stopped: the Duke gave none ${misses} times (${banked} banked)`);
} catch (e) {
    log(`error: ${(e as Error).message}`);
} finally {
    await sdk.disconnect();
    process.exit(ok ? 0 : 1);
}
