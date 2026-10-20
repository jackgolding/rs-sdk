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
import { hopSend, playerPos, waitForPlayerState } from './movement';
import { walkRoute } from './walk-route';
import { FLEET_BANKS, type Tile } from './tiles';

const argv = process.argv.slice(2);
const botArg = argv.find((a) => !a.startsWith('-'));
const bankArg = argv.find((a) => a.startsWith('--bank='))?.slice('--bank='.length) ?? 'seers';
const bankSlugs = bankArg.split(',').map((s) => s.trim()).filter(Boolean);
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
const slug = (s: string): string => s.toLowerCase().replace(/\s+/g, '-');
const BANK_CANDIDATES = bankSlugs.map((s) => {
    const b = FLEET_BANKS.find((f) => slug(f.name) === s);
    if (!b) throw new Error(`unknown bank '${s}' (have: ${FLEET_BANKS.map((f) => slug(f.name)).join(', ')})`);
    return b;
});
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
log(`start @ ${here()} — banks=${BANK_CANDIDATES.map((b) => b.name).join(' -> ')} filter=${findArg ?? 'all'}`);
log(`pack (${packLines().length} slots): ${packLines().join(', ') || 'empty'}`);

// Canonical hop walker (skill: rs-sdk-movement). A single long sendWalk is
// silently dropped, and walkSendHops filters its list by distance-to-destination
// rather than verifying arrival per hop — which stranded this bot mid-route at
// (2961,3290) for minutes with no log line. walkRoute caps every hop, waits for
// each to land, measures displacement, and reports BLOCKED with the tile and
// bearing instead of looping.
const host = {
    getPos: () => playerPos(sdk),
    walk: (x: number, z: number) => hopSend(sdk, x, z, 10),
    waitTicks: (n: number) => sdk.waitForTicks(n),
};

let opened = false;
let usedBank = BANK_CANDIDATES[0]!;
for (const bank of BANK_CANDIDATES) {
    usedBank = bank;
    const wp = planRoute({ x: bank.x, z: bank.z });
    log(`walking to ${bank.name} (${bank.x},${bank.z}) via ${wp.length} waypoints @ ${here()}`);
    const res = await walkRoute(host, wp.length ? wp : [{ x: bank.x, z: bank.z }], {
        maxHop: 10,
        tolerance: 3,
        log: (l: string) => log(`   ${l}`),
    });
    log(`walk to ${bank.name}: ok=${res.ok} at (${res.at.x},${res.at.z}) l${res.at.level}${res.blocked ? ` blocked=${res.blocked}` : ''}`);

    for (let attempt = 0; attempt < 3 && !opened; attempt++) {
        if (sdk.getState()?.bank?.isOpen) {
            opened = true;
            break;
        }
        const r = await bot.openBank().catch((e: unknown) => ({ success: false, message: String(e) }));
        opened = r.success || !!sdk.getState()?.bank?.isOpen;
        log(`${bank.name} open attempt ${attempt + 1}: ${opened} ${r.message ?? ''} @ ${here()}`);
        if (!opened) await sdk.waitForTicks(4).catch(() => undefined);
    }
    if (opened) break;
    log(`${bank.name} unusable (no booth in view) — trying the next candidate`);
}

if (!opened) {
    log(`FAILED — could not open any of ${BANK_CANDIDATES.map((b) => b.name).join(', ')}; pack was: ${packLines().join(', ') || 'empty'}`);
} else {
    await sdk.waitForTicks(4).catch(() => undefined);
    const bank = (sdk.getBankItems() ?? []).filter((i) => (i.count ?? 0) > 0);
    log(`bank holds ${bank.length} distinct stacks (booth: ${usedBank.name})`);
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
