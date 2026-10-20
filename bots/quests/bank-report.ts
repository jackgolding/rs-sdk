/**
 * Report what an account holds: dump the bank (optionally filtered) plus the
 * whole pack, then hold DONE.
 *
 *   bun bots/quests/bank-report.ts jackthief --bank=seers [--find="essence"]
 *
 * Written because the two obvious routes both came up short:
 *   - the desk's bank pass walks every account to its NEAREST fleet bank, and
 *     for an account parked at Lumbridge that is `Lumbridge` (3208,3220) — the
 *     castle's bank is UPSTAIRS, so the pass dies with "no booth in view";
 *   - the game-server status endpoint exposes only status/controllers/position,
 *     never inventory or bank contents.
 *
 * Banks are one global stock per account, so the booth chosen changes only the
 * walk, never the numbers. This takes an explicit fleet bank, plans the route
 * from the live position, retries the bank open by stepping onto the booth, and
 * logs both the matched bank lines and the full pack. Read-only: it never
 * deposits or withdraws.
 */
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { ActivitySession, BotSDK, deriveGatewayUrl } from '../../sdk/index';
import { BotActions } from '../../sdk/actions';
import { findLongPath, initPathfinding } from '../../sdk/pathfinding';
import { installGracefulShutdown } from '../../sdk/runner';
import { playerPos, walkSendHops, waitForPlayerState } from './movement';
import { FLEET_BANKS, type Tile } from './tiles';

const argv = process.argv.slice(2);
const botArg = argv.find((a) => !a.startsWith('-'));
const bankArg = argv.find((a) => a.startsWith('--bank='))?.slice('--bank='.length) ?? 'seers';
const findArg = argv.find((a) => a.startsWith('--find='))?.slice('--find='.length);
if (!botArg) throw new Error('usage: bank-report.ts <botname> [--bank=seers] [--find=essence]');

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
const BANK = FLEET_BANKS.find((b) => b.name.toLowerCase().replace(/\s+/g, '-') === bankArg);
if (!BANK) throw new Error(`unknown --bank=${bankArg}`);
const FIND = findArg ? new RegExp(findArg, 'i') : null;

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
    name: 'bank-report',
    grindLogPath: GRIND_LOG,
    stallMs: 360_000,
    maxRecoveryTactics: 8,
});
installGracefulShutdown({ graceMs: 120_000 });

const log = (msg: string): void => {
    session.log('log', msg);
    void session.showIntent(msg).catch(() => undefined);
    console.log(`[bank-report] ${msg}`);
};
const here = (): string => {
    const p = playerPos(sdk);
    return `${p.x},${p.z},${p.level}`;
};
const packLines = (): string[] =>
    sdk
        .getInventory()
        .filter((i) => (i.count ?? 0) > 0)
        .map((i) => `${i.name} x${i.count}`);

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

if (!(await waitForPlayerState(sdk))) throw new Error('no fresh player state');
log(`start @ ${here()} — bank=${BANK.name} (${BANK.x},${BANK.z}) filter=${findArg ?? 'all'}`);
log(`pack (${packLines().length} slots): ${packLines().join(', ') || 'empty'}`);

const route = planRoute({ x: BANK.x, z: BANK.z });
log(`walking to ${BANK.name} via ${route.length} waypoints @ ${here()}`);
await walkSendHops(sdk, route.length ? route : [{ x: BANK.x, z: BANK.z }], { x: BANK.x, z: BANK.z }, 4);
log(`arrived @ ${here()}`);

let opened = false;
for (let attempt = 0; attempt < 4 && !opened; attempt++) {
    if (sdk.getState()?.bank?.isOpen) {
        opened = true;
        break;
    }
    const r = await bot.openBank().catch((e: unknown) => ({ success: false, message: String(e) }));
    opened = r.success || !!sdk.getState()?.bank?.isOpen;
    log(`bank open attempt ${attempt + 1}: ${opened} ${r.message ?? ''} @ ${here()}`);
    if (!opened) {
        await walkSendHops(sdk, [{ x: BANK.x, z: BANK.z }], { x: BANK.x, z: BANK.z }, 2);
        await sdk.waitForTicks(4).catch(() => undefined);
    }
}

if (!opened) {
    log(`FAILED — could not open ${BANK.name}; pack was: ${packLines().join(', ') || 'empty'}`);
} else {
    await sdk.waitForTicks(4).catch(() => undefined);
    const bank = (sdk.getBankItems() ?? []).filter((i) => (i.count ?? 0) > 0);
    log(`bank holds ${bank.length} distinct stacks`);
    if (FIND) {
        const hits = bank.filter((i) => FIND.test(i.name));
        log(
            hits.length
                ? `MATCHES ${FIND.source}: ${hits.map((i) => `${i.name}=${i.count}`).join(', ')}`
                : `MATCHES ${FIND.source}: NONE`
        );
    }
    const runeish = bank.filter((i) => /essence|rune|talisman/i.test(i.name));
    log(`rune-ish stacks: ${runeish.map((i) => `${i.name}=${i.count}`).join(', ') || 'none'}`);
    log(`pack (${packLines().length} slots): ${packLines().join(', ') || 'empty'}`);
    await bot.closeBank().catch(() => undefined);
    session.noteProgress('bank', 'bank reported');
}

session.stop('done', 'bank-report finished', { restartable: false });
log('DONE — idling (read-only: nothing was deposited or withdrawn)');
while (true) await sdk.waitForTicks(100).catch(() => undefined);
