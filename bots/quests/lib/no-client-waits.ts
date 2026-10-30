/**
 * Waits that run while no game client is attached, so there are no ticks to count:
 * claiming a per-quest slot before runScript connects, and sitting out a game-server
 * outage before reconnecting. Everything else in lib/ waits in ticks (ticks.ts);
 * this file is the conventions test's one other clock exemption.
 */
import { appendFileSync, closeSync, mkdirSync, openSync, readdirSync, readFileSync, statSync, unlinkSync, utimesSync, writeFileSync } from 'fs';
import { join } from 'path';

export const sleepWithoutClient = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Default accounts per quest at once; the fleet's containers share bots/, so the slots are files there. */
export const QUEST_SLOTS = 3;
/** Exit code of a quest skipped because its slots are full (QUEST_SLOT_NOWAIT=1): todo-runner defers it. */
export const SLOTS_FULL_EXIT = 75;
const SLOT_DIR = join(process.cwd(), 'bots', '.quest-slots');
/** A slot not refreshed this long belongs to a run that died without releasing it. */
const SLOT_STALE_MS = 10 * 60_000;
const SLOT_POLL_MS = 30_000;

/**
 * Claim one of `max` slots for quest `id`, waiting while all are taken; returns the release.
 * Wall-clock: this runs before the game client is attached. The slot file's mtime is
 * refreshed every minute while the run lives, and is reclaimed once it goes stale.
 */
export async function acquireQuestSlot(id: string, max: number, account: string, grindLog: string): Promise<() => void> {
    const dir = join(SLOT_DIR, id);
    const note = (msg: string) => {
        console.log(msg);
        try {
            appendFileSync(grindLog, `${new Date().toISOString()} [${id}] ${msg}\n`);
        } catch {
            /* the log must never break a run */
        }
    };
    try {
        mkdirSync(dir, { recursive: true });
    } catch {
        return () => undefined; // no shared dir (local dev without bots/): run unthrottled
    }
    // One account runs one quest at a time: a slot already under our name is a killed
    // earlier run's (ABGARMY01 held both haunted slots after a container restart).
    for (const f of readdirSync(dir)) {
        try {
            if (readFileSync(join(dir, f), 'utf-8').split(' ')[0] === account) unlinkSync(join(dir, f));
        } catch {
            /* gone already */
        }
    }
    const t0 = Date.now();
    let lastNote = 0;
    for (;;) {
        for (const f of readdirSync(dir)) {
            try {
                if (Date.now() - statSync(join(dir, f)).mtimeMs > SLOT_STALE_MS) unlinkSync(join(dir, f));
            } catch {
                /* another runner cleaned it up */
            }
        }
        for (let n = 0; n < max; n++) {
            const path = join(dir, `slot-${n}`);
            try {
                closeSync(openSync(path, 'wx'));
                writeFileSync(path, `${account} ${new Date().toISOString()}\n`);
                if (Date.now() - t0 > SLOT_POLL_MS) note(`quest slot ${n + 1}/${max} after ${Math.round((Date.now() - t0) / 1000)}s waiting`);
                const beat = setInterval(() => {
                    try {
                        utimesSync(path, new Date(), new Date());
                    } catch {
                        /* reclaimed as stale: keep running */
                    }
                }, 60_000);
                let released = false;
                return () => {
                    if (released) return;
                    released = true;
                    clearInterval(beat);
                    try {
                        unlinkSync(path);
                    } catch {
                        /* already gone */
                    }
                };
            } catch {
                /* taken */
            }
        }
        // Under todo-runner, a full quest is skipped, not waited on: the account does its next
        // quest or its grind and comes back (21 accounts sat idle on Knight's Sword, 2026-10-30).
        if (process.env.QUEST_SLOT_NOWAIT === '1') {
            const who = readdirSync(dir).map((f) => {
                try {
                    return readFileSync(join(dir, f), 'utf-8').split(' ')[0];
                } catch {
                    return '?';
                }
            });
            note(`all ${max} quest slots taken (${who.join(', ')}) — deferring`);
            process.exit(SLOTS_FULL_EXIT);
        }
        if (Date.now() - lastNote > 5 * 60_000) {
            const who = readdirSync(dir).map((f) => {
                try {
                    return readFileSync(join(dir, f), 'utf-8').split(' ')[0];
                } catch {
                    return '?';
                }
            });
            note(`all ${max} quest slots taken (${who.join(', ')}) — waiting`);
            lastNote = Date.now();
        }
        await new Promise((r) => setTimeout(r, SLOT_POLL_MS));
    }
}
