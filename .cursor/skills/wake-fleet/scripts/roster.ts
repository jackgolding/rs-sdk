/**
 * Fleet roster: the one place that knows which bots exist and what each one
 * is supposed to run. Backed by bots/roster.json.
 *
 * Ownership records (bots/{name}/assignment.json) are written by BotSDK.connect
 * and re-exported here so fleet scripts share one import site. They are not a
 * restart source: the roster command always wins.
 *
 *   bun .cursor/skills/wake-fleet/scripts/roster.ts          # table
 *   bun .cursor/skills/wake-fleet/scripts/roster.ts json
 *   bun .cursor/skills/wake-fleet/scripts/roster.ts tmux     # eval'd by watch-fleet.sh
 */
import { existsSync, readFileSync } from 'fs';
import { homedir } from 'os';
import { dirname, join, resolve } from 'path';
import {
    assignmentPath,
    isOwnerLive,
    readOwnership,
    recordOwnership,
    resolveOwner,
    type OwnershipRecord,
    type ResolvedOwner,
} from '../../../../sdk/assignment';

export { assignmentPath, isOwnerLive, readOwnership, recordOwnership, resolveOwner };
export type { OwnershipRecord, ResolvedOwner };

export const ROOT = resolve(dirname(import.meta.path), '../../../..');
const ROSTER_PATH = join(ROOT, 'bots', 'roster.json');
const SKIP_PATH = join(ROOT, '.cursor/skills/wake-fleet/skip-bots.txt');
const HUB_LOCK_PATH = join(homedir(), 'Library', 'Logs', 'rs-sdk-fleet', 'abg-food-hub.lock');

export interface RosterView {
    name: string;
    columns: number;
}

export interface RosterBot {
    name: string;
    view: string;
    /** Repo-relative script path, e.g. bots/quests/thieving-route.ts */
    script: string;
    args: string[];
    /** Operator-facing command string, e.g. `bun bots/quests/thieving-route.ts ABGARMY01` */
    command: string;
    /** Temporary opt-out — never waken. */
    paused: boolean;
    /** skip-bots.txt (operator) or a live abg-food-hub.lock (pid still running). */
    pauseSource: 'skip-bots' | 'food-hub' | null;
    /** Mule/orchestrator jobs with legitimately bursty output — widens the no-effect window. */
    bursty: boolean;
    /**
     * Minutes without an effect before the bot is not producing.
     * Roster override when set, else 90 when bursty, else 15.
     */
    noEffectMinutes: number;
}

interface RawBot {
    name?: unknown;
    view?: unknown;
    script?: unknown;
    args?: unknown;
    bursty?: unknown;
    noEffectMinutes?: unknown;
}

function commandOf(script: string, args: string[]): string {
    return ['bun', script, ...args].join(' ');
}

function namesFromLines(text: string): string[] {
    return text
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l && !l.startsWith('#'));
}

function pidAlive(pid: number): boolean {
    if (!Number.isInteger(pid) || pid <= 1) return false;
    try {
        process.kill(pid, 0);
        return true;
    } catch {
        return false;
    }
}

/** One bot name per line; blanks and #comments ignored. */
function loadSkipBots(): Set<string> {
    if (!existsSync(SKIP_PATH)) return new Set();
    return new Set(namesFromLines(readFileSync(SKIP_PATH, 'utf-8')));
}

/**
 * Live food-hub lock: first line is the hub pid, remaining lines are bot names.
 * A stale file (dead pid) does not pause anyone — shepherd can wake them.
 */
function loadFoodHubPauses(): Set<string> {
    if (!existsSync(HUB_LOCK_PATH)) return new Set();
    const lines = readFileSync(HUB_LOCK_PATH, 'utf-8').split('\n').map((l) => l.trim());
    const pid = Number(lines[0]);
    if (!pidAlive(pid)) return new Set();
    return new Set(namesFromLines(lines.slice(1).join('\n')));
}

function pauseOf(name: string, skip: Set<string>, hub: Set<string>): Pick<RosterBot, 'paused' | 'pauseSource'> {
    if (skip.has(name)) return { paused: true, pauseSource: 'skip-bots' };
    if (hub.has(name)) return { paused: true, pauseSource: 'food-hub' };
    return { paused: false, pauseSource: null };
}

let cached: { views: RosterView[]; bots: RosterBot[] } | null = null;

export function loadRoster(): { views: RosterView[]; bots: RosterBot[] } {
    if (cached) return cached;
    if (!existsSync(ROSTER_PATH)) {
        throw new Error(`Fleet roster not found at ${ROSTER_PATH}`);
    }
    let parsed: { views?: unknown; bots?: unknown };
    try {
        parsed = JSON.parse(readFileSync(ROSTER_PATH, 'utf-8'));
    } catch (e) {
        throw new Error(`${ROSTER_PATH} is not valid JSON: ${e instanceof Error ? e.message : String(e)}`);
    }

    const views: RosterView[] = (Array.isArray(parsed.views) ? parsed.views : []).map((v: any, i: number) => {
        if (typeof v?.name !== 'string' || !v.name.trim()) {
            throw new Error(`${ROSTER_PATH}: views[${i}] needs a name`);
        }
        const columns = Number(v.columns);
        if (!Number.isInteger(columns) || columns < 1) {
            throw new Error(`${ROSTER_PATH}: view "${v.name}" needs an integer columns >= 1`);
        }
        return { name: v.name, columns };
    });

    const skip = loadSkipBots();
    const hubPause = loadFoodHubPauses();
    const seen = new Set<string>();
    const raw: RawBot[] = Array.isArray(parsed.bots) ? parsed.bots : [];
    if (raw.length === 0) throw new Error(`${ROSTER_PATH}: bots must be a non-empty array`);

    const bots: RosterBot[] = raw.map((b, i) => {
        const name = typeof b.name === 'string' ? b.name.trim() : '';
        if (!name) throw new Error(`${ROSTER_PATH}: bots[${i}] needs a name`);
        if (seen.has(name)) throw new Error(`${ROSTER_PATH}: duplicate bot "${name}"`);
        seen.add(name);

        const script = typeof b.script === 'string' ? b.script.trim() : '';
        if (!script) throw new Error(`${ROSTER_PATH}: ${name} needs a script`);
        if (!existsSync(join(ROOT, script))) {
            throw new Error(`${ROSTER_PATH}: ${name} script does not exist: ${script}`);
        }

        const args = Array.isArray(b.args) ? b.args.map(String) : [];
        const view = typeof b.view === 'string' ? b.view : '';
        if (view && !views.some((v) => v.name === view)) {
            throw new Error(`${ROSTER_PATH}: ${name} references unknown view "${view}"`);
        }

        const bursty = b.bursty === true;
        let noEffectMinutes: number;
        if (b.noEffectMinutes == null) {
            noEffectMinutes = bursty ? 90 : 15;
        } else if (typeof b.noEffectMinutes !== 'number' || !Number.isInteger(b.noEffectMinutes) || b.noEffectMinutes < 1) {
            throw new Error(`${ROSTER_PATH}: ${name} noEffectMinutes must be an integer >= 1`);
        } else {
            noEffectMinutes = b.noEffectMinutes;
        }
        return {
            name,
            view,
            script,
            args,
            command: commandOf(script, args),
            ...pauseOf(name, skip, hubPause),
            bursty,
            noEffectMinutes,
        };
    });

    cached = { views, bots };
    return cached;
}

/** Drop the in-process roster so the next read sees a just-written roster.json. */
export function invalidateRosterCache(): void {
    cached = null;
}

export function rosterBots(): RosterBot[] {
    return loadRoster().bots;
}

export function botNames(): string[] {
    return rosterBots().map((b) => b.name);
}

/** Case-insensitive lookup so `restart jackpoo1` matches `Jackpoo1`. */
export function findBot(rawName: string): RosterBot | undefined {
    const wanted = rawName.trim().toLowerCase();
    return rosterBots().find((b) => b.name.toLowerCase() === wanted);
}

/** Chunks a view's bots column-major, matching the tmux pane layout. */
export function viewColumns(viewName: string): string[][] {
    const { views, bots } = loadRoster();
    const view = views.find((v) => v.name === viewName);
    if (!view) throw new Error(`Unknown view "${viewName}"`);
    const names = bots.filter((b) => b.view === viewName).map((b) => b.name);
    const rows = Math.ceil(names.length / view.columns);
    const columns: string[][] = [];
    for (let i = 0; i < names.length; i += rows) {
        columns.push(names.slice(i, i + rows));
    }
    return columns;
}

function quote(value: string): string {
    return `'${value.replaceAll("'", `'\\''`)}'`;
}

if (import.meta.main) {
    const mode = process.argv[2] ?? 'table';
    const { views, bots } = loadRoster();

    if (mode === 'json') {
        console.log(JSON.stringify({ root: ROOT, views, bots }, null, 4));
    } else if (mode === 'names') {
        for (const bot of bots) console.log(bot.name);
    } else if (mode === 'tmux') {
        // Emitted as bash for watch-fleet.sh to eval; begin_view/add_tower are
        // defined there.
        for (const view of views) {
            const columns = viewColumns(view.name);
            const rows = columns[0]?.length ?? 0;
            console.log(`begin_view ${quote(view.name)} ${view.columns} ${rows}`);
            for (const column of columns) {
                console.log(`add_tower ${column.map(quote).join(' ')}`);
            }
            console.log(`end_view ${quote(view.name)}`);
        }
    } else {
        for (const bot of bots) {
            const flags = bot.paused ? ` [paused:${bot.pauseSource}]` : '';
            console.log(`${bot.name.padEnd(12)} ${bot.view.padEnd(6)} ${bot.command}${flags}`);
        }
        console.log(`\n${bots.length} bots, ${bots.filter((b) => b.paused).length} paused`);
    }
}
