/**
 * Coal Trucks coal — uncontested coal for rune-pick accounts.
 *
 *   bun bots/quests/coal-trucks.ts {botname}
 *
 * 18 coal rocks at the Coal Trucks (2574-2581, 3474-3485), west of Seers and
 * next to the Dwarf Cannon start. Far enough off the beaten path that the
 * Mining Guild / Rimmington crowds never touch it.
 *
 * Trip: mine a full pack of coal, walk the Seers bank rune-pick route in
 * ~40-tile hops (a single long walkTo silently no-ops), bank, repeat.
 * Requires Mining 30 for coal; the user's rule is rune pick only, so a bot
 * without a rune pickaxe logs and idles instead of mining bronze-slow.
 */
import { join } from 'path';
import { ActivitySession } from '../../sdk/index';
import { initPathfinding, isTileWalkable } from '../../sdk/pathfinding';
import { installGracefulShutdown, runScript } from '../../sdk/runner';

const COAL_TRUCKS = { x: 2578, z: 3480 };
const SEERS_BANK = { x: 2726, z: 3485 };
/** Seers → trucks, BFS-verified offline (findLongPath, 88 waypoints sampled
 *  every 8th): the direct west road is fenced by McGrubor's Wood and stalls
 *  bots at ~2650,3465, so this goes south around the wood then back north. */
const SEERS_TO_TRUCKS = [
    { x: 2709, z: 3485, tol: 3 },
    { x: 2691, z: 3475, tol: 3 },
    { x: 2674, z: 3460, tol: 3 },
    { x: 2663, z: 3449, tol: 3 },
    { x: 2650, z: 3423, tol: 3 },
    { x: 2629, z: 3401, tol: 3 },
    { x: 2591, z: 3394, tol: 3 },
    { x: 2580, z: 3411, tol: 3 },
    { x: 2572, z: 3427, tol: 3 },
    { x: 2574, z: 3437, tol: 3 },
    { x: 2570, z: 3462, tol: 3 },
    { x: COAL_TRUCKS.x, z: COAL_TRUCKS.z, tol: 3 }
];
const TO_BANK = [...SEERS_TO_TRUCKS].reverse().map((h, i, arr) =>
    i === arr.length - 1 ? { x: SEERS_BANK.x, z: SEERS_BANK.z, tol: 3 } : h
);
/** Falador/Guild → trucks in ~45-tile legs (the approach from the east). */
const FALADOR_TO_TRUCKS = [
    { x: 3000, z: 3390, tol: 6 },
    { x: 2955, z: 3425, tol: 6 },
    { x: 2910, z: 3450, tol: 6 },
    { x: 2865, z: 3462, tol: 6 },
    { x: 2820, z: 3468, tol: 6 },
    { x: 2775, z: 3472, tol: 6 },
    { x: 2730, z: 3478, tol: 6 }
];
const TO_MINE = SEERS_TO_TRUCKS;

const PICKAXE = /^(bronze|iron|steel|mithril|adamant|rune) pickaxe$/i;
const RUNE_PICK = /^rune pickaxe$/i;
const COAL_ROCK = /^(rocks coal ore|coalrock\d?|coal rock)$/i;
const COAL = /^coal$/i;
const PACK = 26;

const botName = process.argv.slice(2).find((a) => !a.startsWith('-')) ?? '';
const GRIND_LOG = join(process.cwd(), 'bots', botName, 'grind.log');
const COAL_LEVEL = 30;

initPathfinding();

await runScript(async ({ bot, sdk }) => {
    const session = new ActivitySession(sdk, bot, {
        name: 'coal-trucks',
        grindLogPath: GRIND_LOG,
        stallMs: 600_000,
        maxRecoveryTactics: 6
    });
    installGracefulShutdown({ graceMs: 30_000 });

    const log = (m: string) => session.log('log', m);
    const intent = (m: string) => void session.showIntent(m);

    const pos = () => {
        const p = sdk.getState()?.player;
        return { x: p?.worldX ?? 0, z: p?.worldZ ?? 0, level: p?.level ?? 0, isDead: p?.isDead ?? false };
    };
    const cheb = (a: { x: number; z: number }, b: { x: number; z: number }) =>
        Math.max(Math.abs(a.x - b.x), Math.abs(a.z - b.z));
    const distTo = (x: number, z: number) => cheb(pos(), { x, z });
    const mining = () => sdk.getSkill('Mining')?.baseLevel ?? 1;
    const miningXp = () => sdk.getSkill('Mining')?.experience ?? 0;
    const coalCount = () => sdk.getInventory().filter((i) => COAL.test(i.name)).reduce((n, i) => n + (i.count ?? 1), 0);
    // 28 slots, one entry per slot: counting zero-count entries always read 0
    // free, so every loop tripped the "inventory full" branch and banked with nothing.
    const freeSlots = () => 28 - sdk.getInventory().length;
    const hasPick = () => !!(sdk.findInventoryItem(PICKAXE) || sdk.findEquipmentItem(PICKAXE));
    const inTrucks = () => {
        const p = pos();
        return p.level === 0 && p.x >= 2566 && p.x <= 2592 && p.z >= 3468 && p.z <= 3492;
    };
    const depletedUntil = new Map<string, number>();
    let trips = 0;
    let totalCoal = 0;
    let missStreak = 0;

    function noteMiss(code: string, message: string): void {
        missStreak++;
        if (missStreak === 1 || missStreak % 8 === 0) {
            session.noteFailure(code, `${message} (${missStreak} in a row @ ${pos().x},${pos().z})`);
        }
    }

    async function closeUi(): Promise<void> {
        await bot.dismissBlockingUI().catch(() => undefined);
        if (sdk.getState()?.bank?.isOpen || sdk.getState()?.interface?.isOpen) {
            await bot.closeInterface().catch(() => undefined);
        }
    }

    async function walkLeg(x: number, z: number, tol = 4): Promise<boolean> {
        if (distTo(x, z) <= tol) return true;
        const r = await bot.walkTo(x, z, tol);
        const ok = r.success || distTo(x, z) <= tol + 1;
        // The trucks are a ~200-tile walk; without a progress note the fleet
        // watchdog SIGTERMs the container mid-walk and the bot never arrives.
        if (ok) session.noteProgress('walk', `${x},${z}`);
        return ok;
    }

    /** Rock tiles are solid: stand on the nearest walkable neighbour. */
    function standTile(x: number, z: number): { x: number; z: number } {
        let best = { x: x + 1, z };
        let bestScore = Infinity;
        for (let dx = -1; dx <= 1; dx++) {
            for (let dz = -1; dz <= 1; dz++) {
                if (!dx && !dz) continue;
                if (!isTileWalkable(0, x + dx, z + dz)) continue;
                const score = Math.hypot(pos().x - x - dx, pos().z - z - dz) + (dx && dz ? 0.5 : 0);
                if (score < bestScore) {
                    bestScore = score;
                    best = { x: x + dx, z: z + dz };
                }
            }
        }
        return best;
    }

    function rockCandidates() {
        const now = Date.now();
        const out: Array<{ x: number; z: number; id: number; op: number; score: number }> = [];
        for (const loc of sdk.getNearbyLocs() ?? []) {
            if (!COAL_ROCK.test(loc.name) || (loc.distance ?? 99) > 18) continue;
            const key = `${loc.x},${loc.z}`;
            if ((depletedUntil.get(key) ?? 0) > now) continue;
            const op = loc.optionsWithIndex.find((o) => /^mine$/i.test(o.text));
            if (!op) {
                depletedUntil.set(key, now + 10_000);
                continue;
            }
            out.push({ x: loc.x, z: loc.z, id: loc.id, op: op.opIndex, score: distTo(loc.x, loc.z) });
        }
        return out.sort((a, b) => a.score - b.score);
    }

    /** The Mining Guild is underground; walk-only legs cannot leave a plane. */
    async function climbOut(): Promise<boolean> {
        if (pos().z <= 6400) return true;
        intent('Climbing out of the mine');
        await walkLeg(3019, 9739, 2);
        const ladder = sdk.findNearbyLoc(/^ladder$/i, { withOption: /climb-up/i });
        if (ladder) {
            await bot.interactLoc(ladder, /climb-up/i);
            await sdk.waitForCondition((s) => (s.player?.worldZ ?? 0) < 6400, 10_000).catch(() => undefined);
        }
        return pos().z <= 6400;
    }

    async function goBank(): Promise<boolean> {
        await closeUi();
        if (!(await climbOut())) return false;
        intent('Walking to Seers bank');
        for (const leg of TO_BANK) {
            if (session.isStopped()) return false;
            await walkLeg(leg.x, leg.z, leg.tol);
        }
        if (!(sdk.getState()?.bank?.isOpen || (await bot.openBank()).success)) return false;
        await sdk.waitForTicks(2);
        for (const item of [...sdk.getInventory()]) {
            if ((item.count ?? 0) > 0 && !PICKAXE.test(item.name)) await bot.depositItem(item, -1).catch(() => undefined);
        }
        session.captureBankStock();
        await bot.closeBank().catch(() => undefined);
        trips++;
        log(`Banked trip ${trips} | mining ${mining()} (${miningXp()} xp)`);
        return true;
    }

    async function goMine(): Promise<boolean> {
        await closeUi();
        if (inTrucks()) return true;
        if (!(await climbOut())) return false;
        intent('Walking to the Coal Trucks');
        const far = distTo(COAL_TRUCKS.x, COAL_TRUCKS.z) > 80;
        for (const leg of far ? [...FALADOR_TO_TRUCKS, ...TO_MINE] : TO_MINE) {
            if (session.isStopped()) return false;
            await walkLeg(leg.x, leg.z, leg.tol);
        }
        await sdk.scanNearbyLocs(18).catch(() => undefined);
        if (inTrucks() || rockCandidates().length > 0) return true;
        noteMiss('mine_walk', `Still @ ${pos().x},${pos().z}`);
        return false;
    }

    async function withdrawPick(): Promise<boolean> {
        if (hasPick()) return true;
        await goBank();
        if (!(sdk.getState()?.bank?.isOpen || (await bot.openBank()).success)) return false;
        const pick = sdk.getBankItems().find((i) => RUNE_PICK.test(i.name));
        if (pick) await bot.withdrawItem(pick, 1);
        await bot.closeBank().catch(() => undefined);
        const inv = sdk.findInventoryItem(RUNE_PICK);
        if (inv) await bot.equipItem(inv);
        return hasPick();
    }

    log(`Coal trucks start Mining ${mining()} (${miningXp()} xp) @ ${pos().x},${pos().z} pick=${hasPick()}`);
    if (mining() < COAL_LEVEL) {
        session.stop('too_low', `Mining ${mining()} < ${COAL_LEVEL} for coal`);
        return;
    }
    if (!(await withdrawPick())) {
        session.stop('no_rune_pick', 'No rune pickaxe worn, carried, or banked');
        return;
    }

    session.registerRecovery([
        { name: 'close_ui', run: async () => (await closeUi(), false) },
        {
            name: 'step_off',
            run: async () => {
                const p = pos();
                await sdk.sendWalk(p.x, p.z + 1, true);
                await sdk.waitForTicks(2);
                return false;
            }
        },
        { name: 'rewalk', run: async () => (await goMine(), false) },
        { name: 'bank_if_full', run: async () => (coalCount() >= PACK && (await goBank()), false) }
    ]);

    let lastLevel = mining();
    while (!session.isStopped()) {
        if (session.needsRecovery()) {
            if ((await session.recover()) === 'exhausted') break;
            continue;
        }
        await closeUi();
        if (pos().isDead) {
            await sdk.waitForCondition((s) => !s.player.isDead, 45_000).catch(() => undefined);
            continue;
        }
        if (mining() !== lastLevel) {
            log(`LEVEL UP Mining ${mining()} (${miningXp()} xp)`);
            lastLevel = mining();
        }
        if (coalCount() >= PACK || freeSlots() < 2) {
            if (await goBank()) continue;
        }
        if (!inTrucks()) {
            await goMine();
            continue;
        }
        let rock = rockCandidates()[0];
        if (!rock) {
            await sdk.scanNearbyLocs(18).catch(() => undefined);
            rock = rockCandidates()[0];
        }
        if (!rock) {
            noteMiss('rock', 'No live coal rock');
            await sdk.waitForTicks(4);
            continue;
        }
        const stand = standTile(rock.x, rock.z);
        if (cheb(pos(), stand) > 1) await walkLeg(stand.x, stand.z, 1);
        if (cheb(pos(), rock) > 2) {
            noteMiss('reach', `coal ${rock.x},${rock.z} unreachable`);
            continue;
        }
        const coalBefore = coalCount();
        const xpBefore = miningXp();
        intent(`Mine coal @ ${rock.x},${rock.z}`);
        session.setAnchor(rock.x, rock.z);
        await sdk.sendInteractLoc(rock.x, rock.z, rock.id, rock.op);
        await sdk
            .waitForCondition(
                (s) =>
                    (s.skills.find((sk) => sk.name === 'Mining')?.experience ?? 0) > xpBefore ||
                    s.inventory.filter((i) => COAL.test(i.name)).reduce((n, i) => n + (i.count ?? 1), 0) > coalBefore,
                20_000
            )
            .catch(() => undefined);
        await closeUi();
        if (coalCount() > coalBefore) {
            missStreak = 0;
            session.noteProgress('xp', `coal ${coalCount()}`);
        } else {
            noteMiss('mine', `Nothing from coal ${rock.x},${rock.z}`);
        }
    }

    const stop = session.metrics().stopReason;
    if (stop) log(`stopped ${stop.code} @ ${pos().x},${pos().z}`);
    await session.finalizeStop();
    await sdk.disconnect();
});
