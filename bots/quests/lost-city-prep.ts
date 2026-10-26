/**
 * Lost City prep — skills first, then the quest, then the account's normal job.
 *
 *   bun bots/quests/lost-city-prep.ts {botname} [--wc=40] [--craft=40] [--fletch=25]
 *        [--then <script> [args…]]
 *
 * Legs run as CHILD processes, one at a time, so only one SDK controller ever
 * exists on the account (two pre-empt each other):
 *   1. Woodcutting to --wc      seers-wc-fm.ts --until-wc=N --exit-when-met
 *   2. Crafting to --craft      sheep-shearer.ts --until=10 (flax needs 10),
 *                               then bowstrings.ts --until=N
 *   3. Fletching to --fletch    seers-wc-fm.ts --fletch --until-fletch=N --exit-when-met
 *   4. lost-city.ts
 *   5. hand over to --then (the account's grind), else park forever
 *
 * Exit 2 from a leg means "level met". Every leg probes the level first and
 * exits 2 within seconds when it is already satisfied, so relaunching this
 * script is cheap and idempotent — it does not re-grind and does not fight the
 * container restart policy.
 *
 * A leg that fails twice is reported as PREP BLOCKED and the account goes back
 * to its grind instead of idling: a broken prep leg must not cost the account
 * its normal work.
 */

import { appendFileSync } from 'fs';
import { join } from 'path';

const argv = process.argv.slice(2);
const thenAt = argv.indexOf('--then');
const thenCmd = thenAt >= 0 ? argv.slice(thenAt + 1) : [];
const own = thenAt >= 0 ? argv.slice(0, thenAt) : argv;
const account = own.find((a) => !a.startsWith('-'));
if (!account) {
    console.error('usage: bun bots/quests/lost-city-prep.ts <botname> [--wc=40] [--craft=40] [--fletch=25] [--then <script> [args…]]');
    process.exit(2);
}

const numArg = (flag: string, dflt: number): number => {
    const hit = own.find((a) => a.startsWith(`${flag}=`));
    const n = Number(hit?.split('=')[1]);
    return Number.isFinite(n) && n > 0 ? n : dflt;
};
const WC_TARGET = numArg('--wc', 40);
const CRAFT_TARGET = numArg('--craft', 40);
const FLETCH_TARGET = numArg('--fletch', 25);
/** Flax spinning (bowstrings) needs Crafting 10 first. */
const FLAX_FLOOR = 10;
const MAX_ATTEMPTS = 2;

const GRIND_LOG = join(process.cwd(), 'bots', account, 'grind.log');
const log = (msg: string) => {
    const line = `${new Date().toISOString()} ${msg}`;
    console.log(line);
    try {
        appendFileSync(GRIND_LOG, `${line}\n`);
    } catch {
        /* grind.log is best-effort: a missing per-bot dir must not stop prep */
    }
};
const warn = (msg: string) => log(`WARN ${msg}`);

async function run(script: string, args: string[]): Promise<number> {
    const proc = Bun.spawn(['bun', script, ...args], { stdout: 'inherit', stderr: 'inherit' });
    const code = (await proc.exited) ?? 1;
    return code;
}

/** Run a leg up to MAX_ATTEMPTS times; exit 2 (or 0) means satisfied. */
async function leg(name: string, script: string, args: string[]): Promise<boolean> {
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        log(`LEG ${name} attempt ${attempt}/${MAX_ATTEMPTS}: ${script} ${args.join(' ')}`);
        const code = await run(script, args);
        if (code === 2) {
            log(`LEG ${name} met (exit 2)`);
            return true;
        }
        if (code === 0) {
            log(`LEG ${name} finished (exit 0)`);
            return true;
        }
        warn(`LEG ${name} exited ${code}`);
    }
    warn(`LEG ${name} FAILED after ${MAX_ATTEMPTS} attempts`);
    return false;
}

async function parkForever(why: string): Promise<void> {
    warn(`parking: ${why} — idling in place (exit 0 is relaunched by the box in seconds)`);
    for (;;) {
        await new Promise((r) => setTimeout(r, 300_000));
    }
}

for (const sig of ['SIGTERM', 'SIGINT'] as const) {
    process.on(sig, () => {
        log(`${sig} — prep stopping`);
        process.exit(0);
    });
}

log(
    `Lost City prep start — targets WC ${WC_TARGET} / Craft ${CRAFT_TARGET} / Fletch ${FLETCH_TARGET}` +
        `${thenCmd.length ? ` · then ${thenCmd.join(' ')}` : ' · then park'}`
);

const okWc = await leg('woodcutting', 'bots/quests/seers-wc-fm.ts', [
    account,
    `--until-wc=${WC_TARGET}`,
    '--exit-when-met'
]);

// Crafting: sheep shearing to the flax floor (it exits 0 when already there),
// then Seers flax to the target (exit 2 when met).
const okCraft =
    (await leg('crafting-sheep', 'bots/quests/sheep-shearer.ts', [account, `--until=${FLAX_FLOOR}`])) &&
    (await leg('crafting-flax', 'bots/quests/bowstrings.ts', [account, `--until=${CRAFT_TARGET}`]));

const okFletch = await leg('fletching', 'bots/quests/seers-wc-fm.ts', [
    account,
    '--fletch',
    `--until-fletch=${FLETCH_TARGET}`,
    '--exit-when-met'
]);

if (!okWc || !okCraft || !okFletch) {
    warn(
        `PREP BLOCKED — wc=${okWc} craft=${okCraft} fletch=${okFletch}; skipping Lost City and handing back to the grind`
    );
} else {
    const city = await leg('lost-city', 'bots/quests/lost-city.ts', [account]);
    if (!city) warn('PREP lost-city failed twice — handing back to the grind');
}

if (thenCmd.length > 0) {
    log(`prep done — handing over to ${thenCmd.join(' ')}`);
    // The grind runs as a child so this container never exits 0 (the box
    // relaunches exit-0 containers every ~16s).
    for (;;) {
        const code = await run(thenCmd[0]!, thenCmd.slice(1));
        warn(`grind exited ${code} — relaunching`);
        await new Promise((r) => setTimeout(r, 15_000));
    }
}
await parkForever('no --then grind configured');
