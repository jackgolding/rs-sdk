/**
 * Wear an item: equip it straight from the pack if it is there, otherwise fetch
 * it from the nearest fleet bank and wear it.
 *
 *   bun bots/quests/wear-item.ts jackthief --item=Berserker helm [--bank=lumbridge]
 *
 * Written because the two existing routes to "put the helm on" both failed
 * silently for a bot parked away from its bank:
 *   - equip-item.ts walks with a bare `walkNear`, which the SDK accepts and then
 *     drops on long legs (a no-op with no error), and it throws if the bank will
 *     not open — so a run 500 tiles from the bank sat mute for seven minutes;
 *   - the quarry's own duty scripts bank-and-unequip everything by design, so a
 *     helm worn by an earlier job comes off again.
 *
 * Every step here logs, the walk is planned from the LIVE position and chunked,
 * the bank open is retried by stepping onto the booth, and the wear is confirmed
 * on the equipment slot rather than trusting the equip receipt. Ends in a DONE
 * hold, never an exit, so a container restart cannot re-run it.
 */
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { ActivitySession, BotSDK, deriveGatewayUrl } from '../../sdk/index';
import { BotActions } from '../../sdk/actions';
import { findLongPath, initPathfinding } from '../../sdk/pathfinding';
import { installGracefulShutdown } from '../../sdk/runner';
import { closeUi, playerPos, walkSendHops, waitForPlayerState } from './movement';
import { FLEET_BANKS, type Tile } from './tiles';

const argv = process.argv.slice(2);
const botArg = argv.find((a) => !a.startsWith('-'));
const itemArg = argv.find((a) => a.startsWith('--item='))?.slice('--item='.length);
const bankArg = argv.find((a) => a.startsWith('--bank='))?.slice('--bank='.length);
if (!botArg) throw new Error('usage: wear-item.ts <botname> --item=NAME [--bank=NAME]');
if (!itemArg) throw new Error('usage: wear-item.ts <botname> --item=NAME [--bank=NAME]');

function loadBotEnv(): void {
    const envPath = join(process.cwd(), 'bots', botArg!, 'bot.env');
    if (!existsSync(envPath)) throw new Error(`bot.env not found at ${envPath}`);
    for (const line of readFileSync(envPath, 'utf-8').split('\n')) {
        const t = line.trim();
        if (!t || t.startsWith('#')) continue;
        const eq = t.indexOf('=');
        if (eq > 0) process.env[t.slice(0, eq)] = t.slice(eq + 1);
    }
}
loadBotEnv();

const username = process.env.BOT_USERNAME!;
const password = process.env.PASSWORD!;
const server = process.env.SERVER;
const GRIND_LOG = join(process.cwd(), 'bots', username, 'grind.log');
const ITEM = new RegExp(`^${itemArg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i');
const BANKS = FLEET_BANKS.filter((b) => (bankArg ? b.name.toLowerCase().replace(/\s+/g, '-') === bankArg : true));
if (!BANKS.length) throw new Error(`unknown --bank=${bankArg}`);

initPathfinding();

const sdk = new BotSDK({
    botUsername: username,
    password,
    gatewayUrl: deriveGatewayUrl(server),
    autoLaunchBrowser: false,
    browserLaunchTimeout: 90_000,
    readyTimeout: 45_000,
    connectTimeout: 60_000,
    autoReconnect: false,
    showChat: false,
});
await sdk.connect();
const bot = new BotActions(sdk);
const session = new ActivitySession(sdk, bot, {
    name: 'wear-item',
    grindLogPath: GRIND_LOG,
    stallMs: 360_000,
    maxRecoveryTactics: 8,
});
installGracefulShutdown({ graceMs: 120_000 });

const log = (msg: string): void => {
    session.log('log', msg);
    void session.showIntent(msg).catch(() => undefined);
    console.log(`[wear] ${msg}`);
};
const here = (): string => {
    const p = playerPos(sdk);
    return `${p.x},${p.z},${p.level}`;
};
const inPack = (): number =>
    sdk.getInventory().filter((i) => ITEM.test(i.name)).reduce((n, i) => n + (i.count ?? 0), 0);
const worn = (): boolean => !!sdk.findEquipmentItem(ITEM);
const nearest = (): { name: string; x: number; z: number } => {
    const p = playerPos(sdk);
    return [...BANKS].sort(
        (a, b) =>
            Math.max(Math.abs(a.x - p.x), Math.abs(a.z - p.z)) -
            Math.max(Math.abs(b.x - p.x), Math.abs(b.z - p.z))
    )[0]!;
};

/** Route from where the bot actually stands (chunked; a single long leg no-ops). */
function planRoute(dest: Tile): Tile[] {
    try {
        const p = playerPos(sdk);
        const path = findLongPath(p.level, p.x, p.z, dest.x, dest.z) as Tile[] | null;
        if (!path || path.length === 0) return [];
        const out: Tile[] = [];
        for (let i = 0; i < path.length; i += 8) {
            const t = path[Math.min(i + 7, path.length - 1)]!;
            out.push({ x: t.x, z: t.z });
        }
        const last = out[out.length - 1];
        if (!last || last.x !== dest.x || last.z !== dest.z) out.push({ x: dest.x, z: dest.z });
        return out;
    } catch {
        return [];
    }
}

async function openBankAt(tile: Tile, label: string): Promise<boolean> {
    for (let attempt = 0; attempt < 4; attempt++) {
        if (sdk.getState()?.bank?.isOpen) return true;
        const r = await bot.openBank().catch((e: unknown) => ({ success: false, message: String(e) }));
        if (r.success || sdk.getState()?.bank?.isOpen) {
            log(`bank open at ${label} (try ${attempt + 1})`);
            return true;
        }
        log(`bank not open at ${label} (try ${attempt + 1}): ${r.message ?? ''} @ ${here()} — stepping to the booth`);
        await walkSendHops(sdk, [{ x: tile.x, z: tile.z }], tile, 2);
        await sdk.waitForTicks(4).catch(() => undefined);
    }
    return !!sdk.getState()?.bank?.isOpen;
}

if (!(await waitForPlayerState(sdk))) throw new Error('no fresh player state');
log(`start @ ${here()} — target ${ITEM.source} (pack=${inPack()} worn=${worn()})`);

if (!worn()) {
    if (inPack() === 0) {
        const bank = nearest();
        const route = planRoute({ x: bank.x, z: bank.z });
        log(`not in the pack — walking to ${bank.name} (${bank.x},${bank.z}) via ${route.length} waypoints @ ${here()}`);
        await walkSendHops(sdk, route.length ? route : [{ x: bank.x, z: bank.z }], { x: bank.x, z: bank.z }, 4);
        log(`arrived @ ${here()}`);
        if (await openBankAt({ x: bank.x, z: bank.z }, bank.name)) {
            const have = (sdk.getBankItems() ?? []).filter((i) => ITEM.test(i.name)).reduce((n, i) => n + (i.count ?? 0), 0);
            if (have > 0) {
                const w = await bot.withdrawItem(ITEM, 1).catch((e: unknown) => ({ success: false, message: String(e) }));
                log(`withdraw ${ITEM.source}: ${w.success} ${w.message ?? ''} pack=${inPack()}`);
                session.noteProgress('bank', `withdrew ${ITEM.source}`);
            } else {
                log(`bank holds none of ${ITEM.source} — cannot wear it`);
            }
            await closeUi(bot, sdk).catch(() => undefined);
            await bot.closeBank().catch(() => undefined);
        } else {
            log(`could not open ${bank.name} — cannot fetch it`);
        }
    }

    if (inPack() > 0) {
        const e = await bot.equipItem(ITEM).catch((err: unknown) => ({ success: false, message: String(err) }));
        await sdk.waitForTicks(3).catch(() => undefined);
        log(`equip ${ITEM.source}: success=${e.success} ${e.message ?? ''} — worn=${worn()}`);
        if (worn()) session.noteProgress('inventory', `wore ${ITEM.source}`);
    } else {
        log(`WARN ${ITEM.source} is neither worn nor in the pack`);
    }
}

const ok = worn();
log(
    `${ok ? 'DONE' : 'INCOMPLETE'} — ${ITEM.source} worn=${worn()} pack=${inPack()} bank=${BANKS[0]!.name} @ ${here()}`
);
session.stop(ok ? 'done' : 'incomplete', 'wear-item finished', { restartable: false });

// Idle rather than exit: a container that exits 0 is restarted by the supervisor,
// which would re-run this and is the reason one-shots over-deliver on the box.
log('idling with the item worn');
while (true) await sdk.waitForTicks(100).catch(() => undefined);
