/**
 * The todo-runner's decisions, free of processes and the game so they can be tested. node:fs only:
 * a container mounts just /srv/fleet/bots (see run-grade.ts).
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';

/** lib/run-quest.ts NEEDS_STOCK_EXIT: mule-supplied stock is short; nothing went wrong. */
export const NEEDS_STOCK_EXIT = 4;
/** lib/run-quest.ts PREREQ_EXIT: the journal says a required quest is not complete. */
export const PREREQ_EXIT = 5;
/** lib/run-quest.ts OUTAGE_EXIT: the game client went away; says nothing about the quest. */
export const OUTAGE_EXIT = 6;

export interface PrereqItem {
    questId: string;
    script: string;
    after?: string[];
}

/** A script's name without its path, the identity of a quest: todo ids vary per push (`upass-r2`, `death-rel`). */
export const scriptKey = (script: string) => basename(script).replace(/\.ts$/, '');

/**
 * Quests that cannot finish before others (scripts, from each quest's game script; Heroes:
 * quest_hero.rs2 checks %zanaris, %dragonquest, %arthur and a gang). An item's own `after`
 * (quest ids) takes precedence. A prerequisite not on the account's list does not block here:
 * run-quest's `requires` reads the journal for those.
 */
export const SCRIPT_AFTER: Record<string, string[]> = {
    biohazard: ['plague-city'],
    'underground-pass': ['biohazard'],
    dragon: ['lost-city'],
    'heroes-quest': ['shield-of-arrav', 'lost-city', 'merlins-crystal', 'dragon'],
    'shilo-village': ['jungle-potion'],
    'legends-quest': ['heroes-quest', 'crest', 'shilo-village', 'underground-pass', 'waterfall'],
    'troll-stronghold': ['death-plateau'],
    'eadgars-ruse': ['troll-stronghold'],
    'holy-grail': ['merlins-crystal'],
    'monkey-madness': ['grand-tree', 'tree-gnome-village'],
};

/** Every script Legends' Quest depends on, itself included: a failure here retries at once. */
export const LEGENDS_PATH: ReadonlySet<string> = (() => {
    const seen = new Set<string>();
    const walk = (s: string) => {
        if (seen.has(s)) return;
        seen.add(s);
        for (const p of SCRIPT_AFTER[s] ?? []) walk(p);
    };
    walk('legends-quest');
    return seen;
})();

export const onLegendsPath = (item: PrereqItem) => LEGENDS_PATH.has(scriptKey(item.script));

/** The first unfinished prerequisite on this list, or undefined when the item may start. */
export function blockedBy<T extends PrereqItem>(item: T, queue: T[], isDone: (i: T) => boolean): string | undefined {
    if (item.after) {
        for (const q of item.after) {
            const pre = queue.find((x) => x.questId === q);
            if (pre && !isDone(pre)) return q;
        }
        return undefined;
    }
    for (const key of SCRIPT_AFTER[scriptKey(item.script)] ?? []) {
        // `upass` and `upass-r2` are one quest: done when any of them is.
        const same = queue.filter((x) => scriptKey(x.script) === key);
        if (same.length && !same.some(isDone)) return same[0]!.questId;
    }
    return undefined;
}

export type Outcome =
    | { kind: 'done'; how: string }
    | { kind: 'deferred' }
    | { kind: 'stock'; short: Array<{ item: string; count: number }> }
    | { kind: 'prereq'; missing: string }
    | { kind: 'outage' }
    | { kind: 'grade' }
    | { kind: 'fail'; why: string };

/** What a child's exit means, before any run record is read. */
export function classifyExit(code: number, tail: string, slotsFullExit = 75): Outcome {
    if (code === slotsFullExit) return { kind: 'deferred' };
    if (code === NEEDS_STOCK_EXIT) return { kind: 'stock', short: parseShort(tail) };
    if (code === PREREQ_EXIT) return { kind: 'prereq', missing: /prerequisite gate: ([^\n]+)/.exec(tail)?.[1] ?? 'unknown' };
    if (code === OUTAGE_EXIT) return { kind: 'outage' };
    if (code !== 0) return { kind: 'fail', why: `exited ${code}` };
    // The child read the journal itself; a resumed run can miss checkpoints the journal has already passed.
    if (/QUEST COMPLETE \(journal-verified\)/.test(tail)) return { kind: 'done', how: 'journal' };
    if (/already (been )?complete|already completed/i.test(tail)) return { kind: 'done', how: 'already-complete' };
    if (/^.*TASK DONE \S+/m.test(tail)) return { kind: 'done', how: 'task' };
    return { kind: 'grade' };
}

/** `NEEDS STOCK: opal ×1, rune axe ×1 — stock the account…` */
export function parseShort(tail: string): Array<{ item: string; count: number }> {
    const lines = tail.match(/NEEDS STOCK: [^\n]*/g);
    const line = lines?.[lines.length - 1];
    if (!line) return [];
    const body = line.slice('NEEDS STOCK: '.length).split(' — ')[0]!;
    const short: Array<{ item: string; count: number }> = [];
    for (const part of body.matchAll(/(.+?) ×(\d+)(?:, |$)/g)) short.push({ item: part[1]!.trim(), count: Number(part[2]) });
    return short;
}

/** Minutes to wait after the nth stock or prerequisite stop in a row: no failure counts, so this must not be busy. */
export function waitMinutes(attempt: number): number {
    return Math.min(240, 30 * 2 ** Math.max(0, attempt - 1));
}

export interface MuleStock {
    at: number;
    items: Record<string, number>;
}

/** Where a mule publishes its bank (quest-mule.ts). Every container mounts the same bots/. */
export const muleStockDir = (botsDir: string) => join(botsDir, '.mule-stock');
/** A snapshot older than this says nothing about now. */
export const MULE_STOCK_FRESH_MS = 30 * 60_000;

export function readMuleStocks(botsDir: string, now = Date.now()): MuleStock[] {
    const dir = muleStockDir(botsDir);
    if (!existsSync(dir)) return [];
    const out: MuleStock[] = [];
    for (const f of readdirSync(dir)) {
        if (!f.endsWith('.json')) continue;
        try {
            const s = JSON.parse(readFileSync(join(dir, f), 'utf-8')) as MuleStock;
            if (now - s.at <= MULE_STOCK_FRESH_MS) out.push(s);
        } catch {
            /* a torn file is just no information */
        }
    }
    return out;
}

/** True once one fresh mule holds every short line. An empty list can't be proven arrived. */
export function stockArrived(short: Array<{ item: string; count: number }>, stocks: MuleStock[]): boolean {
    if (short.length === 0) return false;
    return stocks.some((s) => short.every((l) => (s.items[l.item.toLowerCase()] ?? 0) >= l.count));
}
