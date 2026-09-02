/**
 * Food broadcast + gold reduction tree, then dump the winner → fatpig.
 *
 *   bun bots/quests/abg-tree-orchestrate.ts
 *   bun bots/quests/abg-tree-orchestrate.ts --skip=ABGARMY06 --dry-run
 *   bun bots/quests/abg-tree-orchestrate.ts --gold-only
 *   bun bots/quests/abg-tree-orchestrate.ts --gold-only --casket --skip=ABGARMY06
 *   bun bots/quests/abg-tree-orchestrate.ts --dump-only --skip=ABGARMY06
 *   bun bots/quests/abg-tree-orchestrate.ts --food-only
 */
import { homedir } from 'os';
import { join } from 'path';
import { mkdirSync, writeFileSync } from 'fs';
import { ROOT } from '../../.cursor/skills/wake-fleet/scripts/roster';
import {
    casketHolders,
    casketPlan,
    foodPlan,
    goldHolders,
    goldPlan,
    involvedBots,
    meetTile,
    type BroadcastPair,
    type Pair
} from './tree-trade-plan';

const LAUNCHD = join(ROOT, '.cursor/skills/wake-fleet/scripts/fleet-launchd.ts');
const WORKER = join(ROOT, 'bots/quests/tree-trade.ts');
const LOG_DIR = join(homedir(), 'Library/Logs/rs-sdk-fleet');
const ORCH_LOG = join(LOG_DIR, 'abg-tree.log');

const flags = new Map<string, string>();
for (const a of process.argv.slice(2)) {
    if (!a.startsWith('--')) continue;
    const eq = a.indexOf('=');
    if (eq === -1) flags.set(a.slice(2), 'true');
    else flags.set(a.slice(2, eq), a.slice(eq + 1));
}

const skip = (flags.get('skip') ?? 'ABGARMY06')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
const dryRun = flags.has('dry-run');
const foodOnly = flags.has('food-only');
const goldOnly = flags.has('gold-only');
const casketOnly = flags.has('casket-only');
const dumpOnly = flags.has('dump-only');
const casket = flags.has('casket') || casketOnly || dumpOnly;
const noRestart = flags.has('no-restart');

mkdirSync(LOG_DIR, { recursive: true });
writeFileSync(ORCH_LOG, '');

function log(msg: string): void {
    const line = `[${new Date().toISOString().slice(11, 19)}] ${msg}`;
    console.log(line);
    writeFileSync(ORCH_LOG, `${line}\n`, { flag: 'a' });
}

function launchd(cmd: 'stop' | 'start', name: string): Promise<number> {
    const proc = Bun.spawn(['bun', LAUNCHD, cmd, name], {
        cwd: ROOT,
        stdout: 'ignore',
        stderr: 'ignore'
    });
    return proc.exited;
}

async function stopAll(names: string[]): Promise<void> {
    log(`Stopping ${names.length} bots`);
    for (let i = 0; i < names.length; i += 4) {
        await Promise.all(names.slice(i, i + 4).map((n) => launchd('stop', n)));
    }
}

async function startAll(names: string[]): Promise<void> {
    log(`Restarting ${names.length} bots via launchd`);
    for (const name of names) {
        await launchd('start', name);
        await Bun.sleep(2_000);
    }
}

function pkillTree(name: string): void {
    Bun.spawnSync(['pkill', '-f', `tree-trade.ts ${name} `], { cwd: ROOT });
}

function spawnWorker(name: string, args: string[], logName: string): Bun.Subprocess {
    const path = join(LOG_DIR, logName);
    writeFileSync(path, '');
    const out = Bun.file(path);
    return Bun.spawn(['bun', WORKER, name, ...args], {
        cwd: ROOT,
        stdout: out,
        stderr: out
    });
}

async function waitExited(proc: Bun.Subprocess, ms: number, label: string): Promise<number> {
    let timedOut = false;
    const timer = setTimeout(() => {
        timedOut = true;
        proc.kill();
    }, ms);
    const code = await proc.exited;
    clearTimeout(timer);
    if (timedOut) log(`WARN ${label} timed out`);
    return code;
}

function meetArgs(a: string, b: string): string[] {
    const m = meetTile(a, b);
    return [`--meet=${m.x},${m.z}`];
}

async function runPairs(
    label: string,
    pairs: Pair[],
    kind: 'food' | 'loot',
    extraGive: (pair: Pair) => string[] = () => [],
    giverTimeoutMs = 5 * 60_000
): Promise<void> {
    if (pairs.length === 0) return;
    log(`${label}: ${pairs.map((p) => `${p.giver}→${p.receiver}`).join('  ')}`);
    if (dryRun) return;

    for (const p of pairs) {
        pkillTree(p.giver);
        pkillTree(p.receiver);
    }
    await Bun.sleep(1_000);

    const recvs = pairs.map((p, i) =>
        spawnWorker(
            p.receiver,
            ['receive', p.giver, kind, ...meetArgs(p.giver, p.receiver)],
            `tree-${label}-r${i}-${p.receiver}-recv.log`
        )
    );
    await Bun.sleep(12_000);
    const givers = pairs.map((p, i) =>
        spawnWorker(
            p.giver,
            ['give', p.receiver, kind, ...meetArgs(p.giver, p.receiver), ...extraGive(p)],
            `tree-${label}-r${i}-${p.giver}-give.log`
        )
    );
    await Promise.all(givers.map((proc, i) => waitExited(proc, giverTimeoutMs, `${label} ${pairs[i]!.giver}`)));
    await Bun.sleep(2_000);
    for (const proc of recvs) proc.kill();
    for (const p of pairs) pkillTree(p.receiver);
    await Bun.sleep(1_000);
}

async function packHolders(holders: string[]): Promise<void> {
    log(`Pack loot in waves of 4 (${holders.length} bots)`);
    if (dryRun) return;
    for (let i = 0; i < holders.length; i += 4) {
        const batch = holders.slice(i, i + 4);
        log(`  pack ${batch.join(', ')}`);
        const procs = batch.map((name) => spawnWorker(name, ['pack', 'loot'], `tree-pack-${name}.log`));
        await Promise.all(procs.map((proc, j) => waitExited(proc, 3 * 60_000, `pack ${batch[j]}`)));
        await Bun.sleep(2_000);
    }
}

async function runReduction(label: string, holders: string[], rounds: Pair[][]): Promise<void> {
    await packHolders(holders);
    for (const [i, round] of rounds.entries()) {
        await runPairs(`${label}${i + 1}`, round, 'loot');
    }
    log(`${label} tree done`);
}

async function dumpWinner(winner: string, meet: string, logName: string, collectWaitMs = 40_000): Promise<void> {
    log(`Dump ${winner} → fatpig @ ${meet} (collect wait ${Math.round(collectWaitMs / 1000)}s)`);
    if (dryRun) return;
    pkillTree('fatpig');
    pkillTree(winner);
    const collect = spawnWorker(
        'fatpig',
        ['collect', winner, `--meet=${meet}`],
        `tree-fatpig-collect-${logName}.log`
    );
    await Bun.sleep(collectWaitMs);
    const dump = spawnWorker(winner, ['dump', 'fatpig', 'loot', `--meet=${meet}`], `tree-dump-${logName}.log`);
    await waitExited(dump, 10 * 60_000, `dump ${winner}`);
    await Bun.sleep(15_000);
    collect.kill();
    pkillTree('fatpig');
}

const doFood = !goldOnly && !casketOnly && !dumpOnly;
const doGold = !foodOnly && !casketOnly;
const doCasket = casket || casketOnly;

const foodSources = ['jacklove1', 'jacklove2', 'jacklove3', 'jacklove4', 'jacklove5'];
const foodRounds = foodPlan(skip);
const gold = goldPlan(skip);
const chests = casketPlan(skip);
const involved = involvedBots(skip);
const names = new Set<string>();
if (dumpOnly) {
    if (gold.winner) names.add(gold.winner);
    if (chests.winner) names.add(chests.winner);
    const lastGold = gold.rounds[gold.rounds.length - 1] ?? [];
    const lastCasket = chests.rounds[chests.rounds.length - 1] ?? [];
    for (const p of [...lastGold, ...lastCasket]) {
        names.add(p.giver);
        names.add(p.receiver);
    }
    names.add('fatpig');
} else if (casketOnly) {
    for (const n of casketHolders(skip)) names.add(n);
    names.add('fatpig');
} else if (goldOnly) {
    for (const n of goldHolders(skip)) names.add(n);
    names.add('fatpig');
    if (doCasket) for (const n of casketHolders(skip)) names.add(n);
} else {
    for (const n of involved) names.add(n);
    if (doCasket) for (const n of casketHolders(skip)) names.add(n);
}
const namesToStop = [...names];

log('=== ABG tree handover ===');
log(`Skip: ${skip.join(', ') || '(none)'}`);
if (dumpOnly) log('Mode: dump-only (last hops + pack winners + dump to fatpig)');
if (doFood) {
    log(`Food rounds: ${foodRounds.length} (peak ${Math.max(0, ...foodRounds.map((r) => r.length))} parallel)`);
    for (const [i, round] of foodRounds.entries()) {
        log(`  food r${i + 1} ${round.map((p) => `${p.giver}→${p.receiver} (${p.shares}/${p.shares + p.hold})`).join('  ')}`);
    }
}
if (doGold) {
    log(`Gold holders: ${goldHolders(skip).join(', ')}`);
    log(`Gold rounds: ${gold.rounds.length} winner=${gold.winner ?? '?'} (peak ${gold.rounds[0]?.length ?? 0} parallel)`);
    for (const [i, round] of gold.rounds.entries()) {
        log(`  gold r${i + 1} ${round.map((p) => `${p.giver}→${p.receiver}`).join('  ')}`);
    }
    log(`Then ${gold.winner ?? 'winner'} dumps → fatpig (Ardougne)`);
}
if (doCasket) {
    log(`Casket holders: ${casketHolders(skip).join(', ')}`);
    log(`Casket rounds: ${chests.rounds.length} winner=${chests.winner ?? '?'} (peak ${chests.rounds[0]?.length ?? 0} parallel)`);
    for (const [i, round] of chests.rounds.entries()) {
        log(`  casket r${i + 1} ${round.map((p) => `${p.giver}→${p.receiver}`).join('  ')}`);
    }
    log(`Then ${chests.winner ?? 'winner'} dumps → fatpig (Catherby)`);
}

if (dryRun) {
    log('Dry run — not touching bots');
    process.exit(0);
}

const firstFoodGive = new Set(
    foodRounds[0]?.filter((p) => p.giver.startsWith('jacklove')).map((p) => p.giver) ?? []
);

await stopAll(namesToStop);
await Bun.sleep(4_000);
for (const n of namesToStop) pkillTree(n);
await Bun.sleep(1_000);

if (dumpOnly) {
    const lastGold = gold.rounds[gold.rounds.length - 1] ?? [];
    const lastCasket = chests.rounds[chests.rounds.length - 1] ?? [];
    await Promise.all([
        lastGold.length ? runPairs('gold-last', lastGold, 'loot') : Promise.resolve(),
        lastCasket.length ? runPairs('casket-last', lastCasket, 'loot') : Promise.resolve()
    ]);
    const pack = [...new Set([gold.winner, chests.winner].filter(Boolean))] as string[];
    if (pack.length) await packHolders(pack);
    if (chests.winner) await dumpWinner(chests.winner, '2809,3441', 'casket', 45_000);
    if (gold.winner) await dumpWinner(gold.winner, '2662,3312', 'gold', 120_000);
} else {
    if (doFood) {
        for (const [i, round] of foodRounds.entries()) {
            await runPairs(
                `food${i + 1}`,
                round,
                'food',
                (p) => {
                    const args = [`--shares=${p.shares}`, `--hold=${(p as BroadcastPair).hold}`];
                    if (i === 0 && firstFoodGive.has(p.giver)) args.push('--pack');
                    return args;
                },
                7 * 60_000
            );
        }
        log('Food tree done');
        if (!foodOnly && !noRestart && !doCasket) {
            log('Restarting jackloves (fishing) while gold tree runs');
            await startAll(foodSources);
        }
    }

    if (doGold || doCasket) {
        const goldWork = doGold ? runReduction('gold', goldHolders(skip), gold.rounds) : Promise.resolve();
        const casketWork = doCasket ? runReduction('casket', casketHolders(skip), chests.rounds) : Promise.resolve();
        await Promise.all([goldWork, casketWork]);
        if (doCasket && chests.winner) await dumpWinner(chests.winner, '2809,3441', 'casket', 45_000);
        if (doGold && gold.winner) await dumpWinner(gold.winner, '2662,3312', 'gold', 120_000);
    }
}

if (!noRestart) {
    await startAll(namesToStop);
}

log('=== DONE ===');
