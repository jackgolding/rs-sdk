/**
 * Quests tab: per-account quest progress from the files todo-runner already
 * writes on the box. No game connection, no journal read — `todo.json` says
 * what is queued (with `done` mirrored in), each bot's `todo-state.json` says
 * failures and done markers, and `grind.log` says what is running now and when
 * quests completed.
 */
import { closeSync, existsSync, openSync, readFileSync, readSync, statSync } from 'fs';
import { join } from 'path';

export type QuestCell = 'done' | 'running' | 'queued' | 'retrying' | 'failed' | 'stock';

export interface QuestColumn {
    id: string;
    label: string;
    done: number;
    listed: number;
}

export interface QuestRow {
    name: string;
    cells: Record<string, { state: QuestCell; note?: string }>;
    running: string | null;
}

export interface QuestsPayload {
    generatedAt: string;
    since: string;
    columns: QuestColumn[];
    rows: QuestRow[];
    goal: {
        completedSince: number;
        completedLastHour: number;
        perHour: Array<{ hour: string; count: number }>;
        failedLastHour: number;
        running: number;
        queued: number;
        stock: number;
    };
}

/** The ids todo-runner uses (quest-lab varp keys) → what a person calls them. */
const LABELS: Record<string, string> = {
    sheep: "Sheep Shearer",
    cook: "Cook's Assistant",
    doric: "Doric's Quest",
    hetty: "Witch's Potion",
    priest: "Restless Ghost",
    druid: 'Druidic Ritual',
    gobdip: 'Goblin Diplomacy',
    imp: 'Imp Catcher',
    romeojuliet: 'Romeo & Juliet',
    runemysteries: 'Rune Mysteries',
    haunted: 'Ernest the Chicken',
    vampire: 'Vampire Slayer',
    ball: "Witch's House",
    fortress: "Black Knights' Fortress",
    demon: 'Demon Slayer',
    prince: 'Prince Ali Rescue',
    hunt: "Pirate's Treasure",
    drunkmonk: "Monk's Friend",
    death: 'Death Plateau',
    squire: "The Knight's Sword",
    priestperil: 'Priest in Peril',
};

export const questLabel = (id: string) => LABELS[id] ?? id;

interface TodoItem {
    questId: string;
    script?: string;
    done?: unknown;
}
interface ItemState {
    failures?: number;
    lastError?: string;
    lastAt?: string;
    done?: unknown;
}

function readJson<T>(path: string, fallback: T): T {
    try {
        return JSON.parse(readFileSync(path, 'utf-8')) as T;
    } catch {
        return fallback;
    }
}

/** Whole lines from the last `maxBytes` of a file. */
export function tailLines(path: string, maxBytes: number): string[] {
    if (!existsSync(path)) return [];
    let fd: number | null = null;
    try {
        const size = statSync(path).size;
        const bytes = Math.min(size, maxBytes);
        if (bytes === 0) return [];
        const buf = Buffer.allocUnsafe(bytes);
        fd = openSync(path, 'r');
        readSync(fd, buf, 0, bytes, size - bytes);
        let text = buf.toString('utf-8');
        if (bytes < size) text = text.slice(text.indexOf('\n') + 1);
        return text.split('\n').filter((l) => l.trim());
    } catch {
        return [];
    } finally {
        if (fd !== null) closeSync(fd);
    }
}

const LINE = /^(\d{4}-\d{2}-\d{2}T[\d:.]+Z) \[([a-z0-9]+)\] (.*)$/;
const COMPLETE = /QUEST COMPLETE \(journal-verified\)/;
/** A run that stopped for mule stock (run-quest NEEDS_STOCK_EXIT = 4). */
const STOCK_ERROR = /exited 4\b|NEEDS STOCK/;
/** How recent a quest-tagged log line has to be for the quest to count as running. */
const RUNNING_MS = 10 * 60_000;

export interface Completion {
    at: number;
    questId: string;
    account: string;
}

/**
 * One account's quest cells. `logLines` is the tail of its grind.log; `now` is
 * passed in so tests are deterministic.
 */
export function accountRow(
    name: string,
    items: TodoItem[],
    state: Record<string, ItemState>,
    logLines: string[],
    now: number
): { row: QuestRow; completions: Completion[] } {
    const completions: Completion[] = [];
    let lastTag: string | null = null;
    let lastAt = 0;
    let lastText = '';
    for (const line of logLines) {
        const m = LINE.exec(line);
        if (!m) continue;
        const at = Date.parse(m[1]!);
        lastTag = m[2]!;
        lastAt = at;
        lastText = m[3]!;
        if (COMPLETE.test(m[3]!)) completions.push({ at, questId: m[2]!, account: name });
    }
    const ids = new Set(items.map((i) => i.questId));
    const running =
        lastTag && ids.has(lastTag) && now - lastAt < RUNNING_MS && !COMPLETE.test(lastText) && !/^epilogue/.test(lastText)
            ? lastTag
            : null;
    const cells: QuestRow['cells'] = {};
    for (const item of items) {
        const st = state[item.questId] ?? {};
        const failures = st.failures ?? 0;
        let cell: QuestRow['cells'][string];
        if (item.done || st.done) cell = { state: 'done' };
        else if (running === item.questId) cell = { state: 'running', note: failures ? `attempt ${failures + 1}` : undefined };
        else if (st.lastError && STOCK_ERROR.test(st.lastError)) cell = { state: 'stock', note: st.lastError };
        else if (failures >= 2) cell = { state: 'failed', note: `${failures}/2 · ${st.lastError ?? '?'}` };
        else if (failures === 1) cell = { state: 'retrying', note: `1/2 · ${st.lastError ?? '?'}` };
        else cell = { state: 'queued' };
        cells[item.questId] = cell;
    }
    return { row: { name, cells, running }, completions };
}

/** Columns: every quest on any list, most-listed first, with done/listed counts. */
export function questColumns(rows: QuestRow[]): QuestColumn[] {
    const cols = new Map<string, QuestColumn>();
    for (const row of rows) {
        for (const [id, cell] of Object.entries(row.cells)) {
            const col = cols.get(id) ?? { id, label: questLabel(id), done: 0, listed: 0 };
            col.listed++;
            if (cell.state === 'done') col.done++;
            cols.set(id, col);
        }
    }
    return [...cols.values()].sort((a, b) => b.listed - a.listed || a.label.localeCompare(b.label));
}

export function goalSummary(rows: QuestRow[], completions: Completion[], since: number, now: number, states: Array<Record<string, ItemState>>) {
    const recent = completions.filter((c) => c.at >= since);
    const hours = new Map<string, number>();
    for (const c of recent) {
        const hour = new Date(Math.floor(c.at / 3_600_000) * 3_600_000).toISOString();
        hours.set(hour, (hours.get(hour) ?? 0) + 1);
    }
    const cells = rows.flatMap((r) => Object.values(r.cells));
    const failedLastHour = states
        .flatMap((s) => Object.values(s))
        .filter((s) => !s.done && (s.failures ?? 0) > 0 && s.lastAt && now - Date.parse(s.lastAt) < 3_600_000).length;
    return {
        completedSince: recent.length,
        completedLastHour: completions.filter((c) => now - c.at < 3_600_000).length,
        perHour: [...hours].sort(([a], [b]) => a.localeCompare(b)).map(([hour, count]) => ({ hour, count })),
        failedLastHour,
        running: cells.filter((c) => c.state === 'running').length,
        queued: cells.filter((c) => c.state === 'queued' || c.state === 'retrying').length,
        stock: cells.filter((c) => c.state === 'stock').length,
    };
}

/** Everything the tab shows, from FLEET_BOTS_DIR. Reads ~1MB of each grind.log. */
export function questsPayload(botsDir: string, since: number, now = Date.now()): QuestsPayload {
    const todo = readJson<{ accounts?: Record<string, TodoItem[]> }>(join(botsDir, 'todo.json'), {});
    const rows: QuestRow[] = [];
    const completions: Completion[] = [];
    const states: Array<Record<string, ItemState>> = [];
    for (const [name, items] of Object.entries(todo.accounts ?? {})) {
        const state = readJson<Record<string, ItemState>>(join(botsDir, name, 'todo-state.json'), {});
        states.push(state);
        const log = tailLines(join(botsDir, name, 'grind.log'), 1024 * 1024);
        const r = accountRow(name, items ?? [], state, log, now);
        rows.push(r.row);
        completions.push(...r.completions);
    }
    rows.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
    return {
        generatedAt: new Date(now).toISOString(),
        since: new Date(since).toISOString(),
        columns: questColumns(rows),
        rows,
        goal: goalSummary(rows, completions, since, now, states),
    };
}
