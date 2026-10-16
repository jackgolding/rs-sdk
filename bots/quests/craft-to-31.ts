/**
 * Crafting path to 31 for Lost City, then back to thieving.
 *
 *   bun bots/quests/craft-to-31.ts {botname}
 *     sheep shearer until Crafting 10, then Seers flax until 31, then thieving
 *   bun bots/quests/craft-to-31.ts {botname} --sapphires
 *     cut banked uncut sapphires first; flax covers whatever is still short of 31
 *
 * Exit 2 from cut-sapphires or bowstrings means Crafting is already 31.
 * This process then points the roster at thieving-route and waits on it, so
 * launchd does not treat the level-31 stop as a finished job.
 */
import { spawn } from 'child_process';
import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'fs';
import { join } from 'path';

const name = process.argv.slice(2).find((a) => !a.startsWith('-'));
const sapphires = process.argv.includes('--sapphires');
if (!name) {
    throw new Error('Usage: bun bots/quests/craft-to-31.ts {botname} [--sapphires]');
}

const ROSTER = join(process.cwd(), 'bots/roster.json');
const ROSTER_LOCK = join(process.cwd(), 'bots/.roster-thieve.lock');

function run(script: string, args: string[]): Promise<number> {
    return new Promise((resolve, reject) => {
        const child = spawn(process.execPath, [join(process.cwd(), script), name!, ...args], {
            stdio: 'inherit',
            cwd: process.cwd()
        });
        child.on('error', reject);
        child.on('exit', (code) => resolve(code ?? 1));
    });
}

function withRosterLock(fn: () => void): void {
    const staleMs = 15_000;
    for (let i = 0; i < 40; i++) {
        try {
            mkdirSync(ROSTER_LOCK);
            try {
                fn();
            } finally {
                rmSync(ROSTER_LOCK, { recursive: true, force: true });
            }
            return;
        } catch (err) {
            const code = (err as NodeJS.ErrnoException).code;
            if (code !== 'EEXIST') throw err;
            try {
                if (Date.now() - statSync(ROSTER_LOCK).mtimeMs > staleMs) {
                    rmSync(ROSTER_LOCK, { recursive: true, force: true });
                }
            } catch {
                /* another handoff removed it */
            }
            Bun.sleepSync(100);
        }
    }
    throw new Error('timed out locking bots/roster.json');
}

/** Roster becomes the thieving job so the next launchd restart does not recraft. */
function assignThieving(botName: string): void {
    withRosterLock(() => {
        const text = readFileSync(ROSTER, 'utf8');
        const roster = JSON.parse(text) as { bots: { name: string; script: string; args: string[] }[] };
        const bot = roster.bots.find((b) => b.name.toLowerCase() === botName.toLowerCase());
        if (!bot) throw new Error(`roster has no ${botName}`);
        if (bot.script === 'bots/quests/thieving-route.ts' && bot.args.length === 1 && bot.args[0] === bot.name) return;
        const escaped = bot.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const blockRe = new RegExp(`("name": "${escaped}"[\\s\\S]*?"script": ")[^"]+("[\\s\\S]*?"args": )\\[[\\s\\S]*?\\]`);
        if (!blockRe.test(text)) throw new Error(`could not patch roster entry for ${bot.name}`);
        const next = text.replace(
            blockRe,
            `$1bots/quests/thieving-route.ts$2[\n                "${bot.name}"\n            ]`
        );
        const saved = (JSON.parse(next) as { bots: { name: string; script: string; args: string[] }[] }).bots.find(
            (b) => b.name === bot.name
        );
        if (!saved || saved.script !== 'bots/quests/thieving-route.ts' || saved.args.length !== 1 || saved.args[0] !== bot.name) {
            throw new Error(`roster patch for ${bot.name} did not apply`);
        }
        writeFileSync(ROSTER, next);
    });
}

async function handoffThieving(): Promise<number> {
    console.log(`${name}: Crafting 31 — handing off to thieving-route`);
    assignThieving(name!);
    return run('bots/quests/thieving-route.ts', []);
}

if (sapphires) {
    const cut = await run('bots/quests/cut-sapphires.ts', ['--until=31']);
    if (cut === 2) process.exit(await handoffThieving());
    if (cut !== 0) process.exit(cut);
} else {
    const sheep = await run('bots/quests/sheep-shearer.ts', ['--until=10']);
    if (sheep !== 0) process.exit(sheep);
}

const flax = await run('bots/quests/bowstrings.ts', ['--until=31']);
if (flax === 2) process.exit(await handoffThieving());
process.exit(flax);
