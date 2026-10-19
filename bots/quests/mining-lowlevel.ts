/**
 * Mining 1 -> --until (default 15) powermining copper/tin at Rimmington.
 *
 *   bun bots/quests/mining-lowlevel.ts {botname} [--until=15]
 *
 * Opens the Mining-10 gate rimmington-iron.ts needs (iron refuses below 10).
 * Powermine: ore is dropped in the field, so the only bank leg is the pickaxe
 * withdraw at Falador east (3012,3355), and it runs only when no pickaxe is
 * worn or carried. Log: bots/<bot>/grind.log (ActivitySession -> appendGrindLog).
 *
 * Restart-safe: Mining >= 10 on start logs `mining-lowlevel already <lvl>` and
 * exits 0 before banking, so a container restart is a no-op. Reaching the
 * target mid-run logs `stopped done` and idles instead of exiting 0.
 *
 * Rock tiles from server/content/maps/m46_50.jm2 (ids via loc.sym); each rock
 * tile is solid and each stand tile was confirmed walkable with
 * sdk/pathfinding isTileWalkable over collision-data.json:
 *   copper 2090/2091 @ 2976,3247 2977,3245 2977,3247 2978,3248 2979,3248
 *   tin    2094/2095 @ 2984,3237 2986,3235
 *   clay   2108/2109 @ 2986,3239 2987,3240 — present, skipped (5xp vs 17.5)
 */
import { join } from 'path';
import { ActivitySession, type NearbyLoc } from '../../sdk/index';
import { initPathfinding, isTileWalkable } from '../../sdk/pathfinding';
import { installGracefulShutdown, runScript } from '../../sdk/runner';

const IRON_GATE = 10; // rimmington-iron.ts needs this to mine iron
const FALADOR_EAST_BANK = { x: 3012, z: 3355 };
const FALADOR_SOUTH_EAST = { x: 3007, z: 3300 }; // hub on the bank <-> mine route
const MINE = { x: 2980, z: 3242 }; // walkable anchor between the two clusters

const PICKAXE = /^(bronze|iron|steel|mithril|adamant|rune) pickaxe$/i;
/** Best first: the roster's banks mostly hold a rune pickaxe. */
const PICKAXE_TIERS = [
    /^rune pickaxe$/i,
    /^adamant pickaxe$/i,
    /^mithril pickaxe$/i,
    /^steel pickaxe$/i,
    /^iron pickaxe$/i,
    /^bronze pickaxe$/i
];
const ORE = /^(copper ore|tin ore|clay)$/i;

/** Copper + tin only: the iron rocks 8 tiles west need Mining 15. */
const ROCK_TILES: Array<[number, number, number, string]> = [
    [2977, 3245, 2091, 'copper'],
    [2977, 3247, 2090, 'copper'],
    [2976, 3247, 2090, 'copper'],
    [2978, 3248, 2090, 'copper'],
    [2979, 3248, 2090, 'copper'],
    [2984, 3237, 2094, 'tin'],
    [2986, 3235, 2094, 'tin']
];

const botName = process.argv.slice(2).find((a) => !a.startsWith('-')) ?? '';
const parsedUntil = Number(process.argv.find((a) => a.startsWith('--until='))?.split('=')[1]);
const UNTIL = Math.min(99, Math.max(IRON_GATE, Number.isFinite(parsedUntil) && parsedUntil > 0 ? parsedUntil : 15));
const GRIND_LOG = join(process.cwd(), 'bots', botName, 'grind.log');

interface Rock {
    x: number;
    z: number;
    id: number;
    op: number;
    ore: string;
    score: number;
}

initPathfinding();
let exitCode = 0;
/** Idle-at-target still honours a container stop; 30s chunks would outlive the grace. */
let shutdownRequested = false;
for (const sig of ['SIGTERM', 'SIGINT', 'SIGHUP'] as const) process.once(sig, () => (shutdownRequested = true));

await runScript(async ({ bot, sdk }) => {
    const session = new ActivitySession(sdk, bot, {
        name: 'mining-lowlevel',
        grindLogPath: GRIND_LOG,
        stallMs: 150_000,
        maxRecoveryTactics: 8
    });
    installGracefulShutdown({ graceMs: 30_000 });

    const log = (msg: string) => session.log('log', msg);
    const intent = (msg: string) => void session.showIntent(msg);
    let oresMined = 0;
    let missStreak = 0;
    let lastLevel = 0;
    const depletedUntil = new Map<string, number>();

    const pos = () => {
        const p = sdk.getState()?.player;
        return { x: p?.worldX ?? 0, z: p?.worldZ ?? 0, level: p?.level ?? 0, isDead: p?.isDead ?? false };
    };
    const cheb = (a: { x: number; z: number }, b: { x: number; z: number }) =>
        Math.max(Math.abs(a.x - b.x), Math.abs(a.z - b.z));
    const distTo = (x: number, z: number) => cheb(pos(), { x, z });
    const mining = () => sdk.getSkill('Mining')?.baseLevel ?? 1;
    const miningXp = () => sdk.getSkill('Mining')?.experience ?? 0;
    const oreOf = (items: Array<{ name: string; count?: number }>) =>
        items.filter((i) => ORE.test(i.name)).reduce((n, i) => n + (i.count ?? 1), 0);
    const countOre = () => oreOf(sdk.getInventory());
    const hasPickaxe = () => !!(sdk.findInventoryItem(PICKAXE) || sdk.findEquipmentItem(PICKAXE));
    const junkSlots = () =>
        sdk.getInventory().filter((i) => (i.count ?? 0) > 0 && !PICKAXE.test(i.name) && !ORE.test(i.name)).length;
    const inMine = () => {
        const p = pos();
        return p.level === 0 && p.x >= 2962 && p.x <= 2994 && p.z >= 3226 && p.z <= 3254;
    };
    const crowd = (x: number, z: number) =>
        (sdk.getNearbyPlayers() ?? []).filter((p) => cheb({ x: p.worldX ?? 0, z: p.worldZ ?? 0 }, { x, z }) <= 1).length;

    /** Streaks only: one miss is RNG variance, a run of them is a stuck signal. */
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

    /** Leg gate is Chebyshev, the metric walkTo reports arrival in. */
    async function walkLeg(x: number, z: number, tolerance = 3): Promise<boolean> {
        if (distTo(x, z) <= tolerance) return true;
        const r = await bot.walkTo(x, z, tolerance);
        if (r.success || distTo(x, z) <= tolerance + 1) {
            session.noteProgress('location', `${x},${z}`);
            return true;
        }
        session.noteFailure('walk', `${x},${z}: ${r.message}`);
        return false;
    }

    async function goToBank(): Promise<boolean> {
        await closeUi();
        if (distTo(FALADOR_EAST_BANK.x, FALADOR_EAST_BANK.z) > 45) {
            await walkLeg(FALADOR_SOUTH_EAST.x, FALADOR_SOUTH_EAST.z, 5);
        }
        session.setAnchor(FALADOR_EAST_BANK.x, FALADOR_EAST_BANK.z);
        intent('Walking to Falador east bank');
        return walkLeg(FALADOR_EAST_BANK.x, FALADOR_EAST_BANK.z, 3);
    }

    async function goToMine(): Promise<boolean> {
        await closeUi();
        if (inMine()) return true;
        intent('Walking to Rimmington copper/tin');
        session.setAnchor(MINE.x, MINE.z);
        if (distTo(MINE.x, MINE.z) > 45) await walkLeg(FALADOR_SOUTH_EAST.x, FALADOR_SOUTH_EAST.z, 6);
        if (distTo(MINE.x, MINE.z) > 3) await walkLeg(MINE.x, MINE.z, 3);
        await sdk.scanNearbyLocs(16).catch(() => undefined);
        if (inMine() || distTo(MINE.x, MINE.z) <= 5) {
            session.noteProgress('location', 'rimmington mine');
            return true;
        }
        session.noteFailure('mine_walk', `Still ${pos().x},${pos().z}`);
        return false;
    }

    /** Bank items stream in a tick or two after isOpen flips, so settle before reading. */
    async function openBank(): Promise<boolean> {
        if (sdk.getState()?.bank?.isOpen) return true;
        const r = await bot.openBank();
        if (!r.success && !sdk.getState()?.bank?.isOpen) return false;
        await sdk.waitForTicks(2);
        return true;
    }

    async function withdrawPickaxe(): Promise<boolean> {
        for (const tier of PICKAXE_TIERS) {
            if (!(await openBank())) {
                session.noteFailure('bank_open', 'Falador east bank closed before withdraw');
                return false;
            }
            const banked = sdk.getBankItems().find((i) => tier.test(i.name) && (i.count ?? 0) > 0);
            if (!banked) continue;
            const r = await bot.withdrawItem(banked, 1);
            await sdk.waitForCondition(() => !!sdk.findInventoryItem(PICKAXE), 4_000).catch(() => undefined);
            if (sdk.findInventoryItem(PICKAXE)) {
                log(`Withdrew ${banked.name}`);
                break;
            }
            log(`WARN withdraw ${banked.name} failed: ${r.message}`);
        }
        return hasPickaxe();
    }

    /** 'ready' | 'no_pickaxe' | 'bank_failed'. Banks only when the run needs it. */
    async function prepare(): Promise<'ready' | 'no_pickaxe' | 'bank_failed'> {
        const junk = junkSlots();
        if (hasPickaxe() && junk <= 6) return 'ready';
        intent(hasPickaxe() ? `Banking ${junk} junk slots` : 'Banking for a pickaxe');
        await session.setPhase('bank');
        if (!(await goToBank()) || !(await openBank())) return 'bank_failed';
        if (!hasPickaxe() && !(await withdrawPickaxe())) {
            await bot.closeBank().catch(() => undefined);
            return 'no_pickaxe';
        }
        for (let i = 0; i < 40; i++) {
            const item = sdk.getInventory().find((it) => (it.count ?? 0) > 0 && !PICKAXE.test(it.name));
            if (!item || !(await bot.depositItem(item, -1)).success) break;
        }
        session.captureBankStock();
        await bot.closeBank().catch(() => undefined);
        const inv = sdk.findInventoryItem(PICKAXE);
        if (inv && !sdk.findEquipmentItem(PICKAXE)) {
            const eq = await bot.equipItem(inv);
            if (!eq.success) log(`WARN equip ${inv.name}: ${eq.message}`);
        }
        await session.setPhase('mine');
        return hasPickaxe() ? 'ready' : 'no_pickaxe';
    }

    /** Live rocks: scan hit by tile, else the known tile + id (scans drop rocks). */
    function rockCandidates(): Rock[] {
        const now = Date.now();
        const seen = new Map<string, NearbyLoc>((sdk.getNearbyLocs() ?? []).map((l) => [`${l.x},${l.z}`, l]));
        const out: Rock[] = [];
        for (const [x, z, id, ore] of ROCK_TILES) {
            const key = `${x},${z}`;
            if ((depletedUntil.get(key) ?? 0) > now) continue;
            const loc = seen.get(key);
            const op = loc?.optionsWithIndex.find((o) => /^mine$/i.test(o.text));
            if (loc && !op) {
                depletedUntil.set(key, now + 8_000); // mined out; it respawns
                continue;
            }
            out.push({ x, z, id: loc?.id ?? id, op: op?.opIndex ?? 1, ore, score: distTo(x, z) + crowd(x, z) * 2 });
        }
        return out.sort((a, b) => a.score - b.score);
    }

    /** Rock tiles are solid: stand on the nearest walkable neighbour (collision data). */
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

    async function dropOres(): Promise<number> {
        let dropped = 0;
        for (const item of sdk.getInventory()) {
            if (!ORE.test(item.name) || (item.count ?? 0) < 1) continue;
            const r = await bot.dropItem(item, 'all').catch(() => undefined);
            if (r?.success) dropped += r.slotsDropped ?? 1;
        }
        if (dropped > 0) {
            session.noteProgress('inventory', `dropped ${dropped} ore`);
            log(`Dropped ${dropped} ore | Mining ${mining()} (${miningXp()} xp)`);
        }
        return dropped;
    }

    async function mineOne(): Promise<boolean> {
        await closeUi();
        if (!inMine()) {
            await goToMine();
            return false;
        }
        if (countOre() >= 12) {
            await dropOres();
            return true;
        }
        let rock = rockCandidates()[0] ?? null;
        if (!rock) {
            await sdk.scanNearbyLocs(16).catch(() => undefined);
            rock = rockCandidates()[0] ?? null;
        }
        if (!rock) {
            noteMiss('rock', 'No live copper/tin rock');
            await sdk.waitForTicks(4).catch(() => undefined);
            return false;
        }
        const stand = standTile(rock.x, rock.z);
        if (cheb(pos(), stand) > 1) await walkLeg(stand.x, stand.z, 1);
        if (cheb(pos(), rock) > 2) {
            noteMiss('reach', `${rock.ore} rock ${rock.x},${rock.z} unreachable from ${pos().x},${pos().z}`);
            return false;
        }

        const oreBefore = countOre();
        const xpBefore = miningXp();
        intent(`Mine ${rock.ore} rock @ ${rock.x},${rock.z}`);
        session.setAnchor(rock.x, rock.z);
        const r = await sdk.sendInteractLoc(rock.x, rock.z, rock.id, rock.op);
        await sdk
            .waitForCondition(
                (s) =>
                    (s.skills.find((sk) => sk.name === 'Mining')?.experience ?? 0) > xpBefore ||
                    oreOf(s.inventory) > oreBefore,
                18_000
            )
            .catch(() => undefined);
        await closeUi();

        const gained = countOre() - oreBefore;
        if (gained > 0 || miningXp() > xpBefore) {
            missStreak = 0;
            depletedUntil.set(`${rock.x},${rock.z}`, Date.now() + 9_000);
            oresMined += Math.max(gained, 0);
            if (gained > 0) session.recordGain(`${rock.ore} ore`, gained);
            session.noteProgress('xp', `${rock.ore} rock`);
            if (mining() !== lastLevel) {
                lastLevel = mining();
                log(`Mining ${lastLevel} (${miningXp()} xp) | ${oresMined} ore mined`);
            }
            return true;
        }
        noteMiss('mine', `${rock.ore} rock ${rock.x},${rock.z}: ${r.message}`);
        depletedUntil.set(`${rock.x},${rock.z}`, Date.now() + 4_000);
        return false;
    }

    session.registerRecovery([
        { name: 'walk_mine', run: async () => (inMine() ? false : goToMine()) },
        {
            name: 'rescan_rocks',
            run: async () => {
                await sdk.scanNearbyLocs(16).catch(() => undefined);
                return inMine() && rockCandidates().length > 0;
            }
        },
        { name: 'drop_if_full', run: async () => (countOre() < 20 ? false : (await dropOres()) > 0) },
        { name: 'bank_pickaxe', run: async () => (!hasPickaxe() ? (await prepare()) === 'ready' : false) }
    ]);

    try {
        await bot.skipTutorial();
        await closeUi();
        lastLevel = mining();
        log(
            `mining-lowlevel start Mining ${mining()} (${miningXp()} xp) until=${UNTIL} @ ${pos().x},${pos().z} ` +
                `pick=${sdk.findEquipmentItem(PICKAXE)?.name ?? sdk.findInventoryItem(PICKAXE)?.name ?? 'none'}`
        );
        if (mining() >= IRON_GATE) {
            log(`mining-lowlevel already ${mining()}`);
            exitCode = 0;
            return;
        }

        const prep = await prepare();
        if (prep !== 'ready') {
            exitCode = 1;
            if (prep === 'bank_failed') session.stopRestartable('bank_open', 'Falador east bank unreachable');
            else session.stop('no_pickaxe', 'No pickaxe worn, carried, or banked at Falador east');
            return;
        }

        while (!session.isStoppedOrRequested()) {
            if (session.needsRecovery()) {
                if ((await session.recover()) === 'exhausted') break;
                session.consumeFallback();
                continue;
            }
            session.maybeHeartbeat();
            if (!sdk.isConnected()) {
                await sdk.waitForConnection(30_000).catch(() => undefined);
                continue;
            }
            if (pos().isDead) {
                await sdk.waitForCondition((s) => s.player?.isDead === false, 45_000).catch(() => undefined);
                continue;
            }
            if (mining() >= UNTIL) break;
            if (!hasPickaxe()) {
                const again = await prepare();
                if (again !== 'ready') {
                    exitCode = 1;
                    session.stop(again === 'bank_failed' ? 'bank_open' : 'no_pickaxe', 'Pickaxe lost mid-run');
                    break;
                }
                continue;
            }
            if (!inMine()) {
                await goToMine();
                continue;
            }
            if (session.metrics().phase !== 'mine') await session.setPhase('mine');
            await mineOne();
        }

        const stop = session.metrics().stopReason;
        if (stop) log(`stopped ${stop.code} @ ${stop.location.x},${stop.location.z}`);
        if (!stop && mining() >= UNTIL) {
            // Target reached: clean the bag, park, stay up. Exiting 0 here would
            // make every container restart re-run a finished grind.
            await session.setPhase('idle');
            await dropOres();
            log(`stopped done | Mining ${mining()} (${miningXp()} xp) after ${oresMined} ore — idling`);
            session.stop('done', `Mining ${mining()} >= ${UNTIL}`);
            await session.finalizeStop();
            while (!shutdownRequested && sdk.isConnected()) {
                await sdk.waitForTicks(5).catch(() => new Promise((r) => setTimeout(r, 3_000)));
            }
            return;
        }
        if (session.stopRequested) log(`stopped stop_requested @ ${pos().x},${pos().z}`);
        else if (!stop) session.stopRestartable('loop_exit', `Loop ended at Mining ${mining()} (until ${UNTIL})`);
    } catch (err) {
        exitCode = 1;
        session.stopRestartable('script_error', err instanceof Error ? err.message : String(err));
    } finally {
        await session.finalizeStop();
    }
});

// finalizeStop sets 70 for restartable stops; an explicit code (setup failure) wins.
process.exit(exitCode || process.exitCode || 0);
