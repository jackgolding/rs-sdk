/**
 * Quests tab: per-account quest progress from the files todo-runner already
 * writes on the box. No game connection, no journal read — `todo.json` says
 * what is queued (with `done` mirrored in), each bot's `todo-state.json` says
 * failures and done markers, and `grind.log` says what is running now and when
 * quests completed.
 *
 * Only real quests are shown (quest-catalog.ts): top-ups, mule handovers,
 * musters and grinds on the same todo list are left out, and variant ids
 * (`waterfall-rel`, `grail-pre2`) are merged into their quest. The same pass
 * gives each account's quest points.
 */
import { closeSync, existsSync, openSync, readdirSync, readFileSync, readSync, statSync } from 'fs';
import { join } from 'path';
import { MAX_QP, QUEST_BY_ID, questForId, questForItem, questPointsOf, QUESTS } from './quest-catalog';

export type QuestCell = 'done' | 'running' | 'queued' | 'retrying' | 'failed' | 'stock';

export interface QuestColumn {
    id: string;
    label: string;
    done: number;
    listed: number;
    qp: number;
    members: boolean;
    miniquest?: boolean;
}

export interface QuestCellInfo {
    state: QuestCell;
    note?: string;
    /** The todo ids merged into this quest (`waterfall`, `waterfall-rel`) when more than one. */
    ids?: string[];
}

export interface QuestRow {
    name: string;
    cells: Record<string, QuestCellInfo>;
    running: string | null;
    /** Quest points from the quests this row shows done. */
    qp: number;
    done: number;
}

/** One account's quest points, from the quests the fleet ran to completion. */
export interface AccountQuestPoints {
    qp: number;
    done: string[];
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
    questPoints: {
        /** Sum over accounts. */
        total: number;
        /** Most one account can get from the quest list. */
        max: number;
        /** Real quests in the catalog (miniquests not counted). */
        quests: number;
        /** Keyed by account name as the box spells it. */
        accounts: Record<string, AccountQuestPoints>;
        source: string;
    };
}

export const QP_SOURCE =
    'Quest points from completed quests the fleet ran (todo-runner done markers and journal-verified grind.log lines). Quests done by hand outside the fleet are not counted.';

/** Display name for a todo id; ids that are not quests keep their id. */
export const questLabel = (id: string) => questForId(id)?.label ?? id;

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

const LINE = /^(\d{4}-\d{2}-\d{2}T[\d:.]+Z) \[([a-z0-9_-]+)\] (.*)$/;
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

/** Which state wins when several todo ids are the same quest. */
const RANK: Record<QuestCell, number> = { done: 6, running: 5, retrying: 4, queued: 3, stock: 2, failed: 1 };

const isDoneMark = (value: unknown) => value != null && value !== false;

/**
 * One account's quest cells, keyed by base quest id. Non-quest todo items are
 * left out and variant ids are merged into their quest. A quest is done when
 * any of its ids has a done marker in todo.json or todo-state.json, or the log
 * tail has its `QUEST COMPLETE (journal-verified)` line — also for quests that
 * are no longer on the list.
 *
 * `logLines` is the tail of its grind.log; `now` is passed in so tests are
 * deterministic.
 */
export function accountRow(
    name: string,
    items: TodoItem[],
    state: Record<string, ItemState | null>,
    logLines: string[],
    now: number
): { row: QuestRow; completions: Completion[] } {
    const completions: Completion[] = [];
    const logDone = new Set<string>();
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
        if (COMPLETE.test(m[3]!)) {
            const quest = questForId(m[2]!);
            if (quest) logDone.add(quest.id);
            completions.push({ at, questId: quest?.id ?? m[2]!, account: name });
        }
    }
    const listed = new Set<string>();
    for (const item of items) {
        const quest = questForItem(item);
        if (quest) listed.add(quest.id);
    }
    const lastQuest = lastTag ? questForId(lastTag) : null;
    const running =
        lastQuest && listed.has(lastQuest.id) && now - lastAt < RUNNING_MS && !COMPLETE.test(lastText) && !/^epilogue/.test(lastText)
            ? lastQuest.id
            : null;
    const cells: QuestRow['cells'] = {};
    const firstId = new Map<string, string>();
    for (const item of items) {
        const quest = questForItem(item);
        if (!quest) continue;
        const st = state[item.questId] ?? {};
        const failures = st.failures ?? 0;
        let cell: QuestCellInfo;
        if (isDoneMark(item.done) || isDoneMark(st.done)) cell = { state: 'done' };
        else if (running === quest.id) cell = failures ? { state: 'running', note: `attempt ${failures + 1}` } : { state: 'running' };
        else if (st.lastError && STOCK_ERROR.test(st.lastError)) cell = { state: 'stock', note: st.lastError };
        else if (failures >= 2) cell = { state: 'failed', note: `${failures}/2 · ${st.lastError ?? '?'}` };
        else if (failures === 1) cell = { state: 'retrying', note: `1/2 · ${st.lastError ?? '?'}` };
        else cell = { state: 'queued' };
        if (!firstId.has(quest.id)) firstId.set(quest.id, item.questId);
        mergeCell(cells, quest.id, item.questId, cell, firstId);
    }
    // Done markers for ids no longer on the list, then journal-verified log lines.
    const onList = new Set(items.map((item) => item.questId));
    for (const [todoId, st] of Object.entries(state)) {
        if (!st || !isDoneMark(st.done) || onList.has(todoId)) continue;
        const quest = questForId(todoId);
        if (!quest) continue;
        if (!firstId.has(quest.id)) firstId.set(quest.id, todoId);
        mergeCell(cells, quest.id, todoId, { state: 'done' }, firstId);
    }
    for (const questId of logDone) {
        if (cells[questId]?.state === 'done') continue;
        if (!firstId.has(questId)) firstId.set(questId, questId);
        mergeCell(cells, questId, questId, { state: 'done', note: 'journal-verified in grind.log' }, firstId);
    }
    const doneIds = Object.keys(cells).filter((id) => cells[id]!.state === 'done');
    return { row: { name, cells, running, qp: questPointsOf(doneIds), done: doneIds.length }, completions };
}

/** Fold one todo id's cell into its quest's cell: the higher-ranked state wins, ids accumulate. */
function mergeCell(
    cells: Record<string, QuestCellInfo>,
    questId: string,
    todoId: string,
    cell: QuestCellInfo,
    firstId: Map<string, string>
): void {
    const prev = cells[questId];
    const ids = new Set(prev ? (prev.ids ?? [firstId.get(questId) ?? todoId]) : []);
    ids.add(todoId);
    const next: QuestCellInfo = { ...(!prev || RANK[cell.state] > RANK[prev.state] ? cell : prev) };
    delete next.ids;
    if (ids.size > 1) next.ids = [...ids];
    cells[questId] = next;
}

/** Columns: every quest on any list, most-listed first, with done/listed counts. */
export function questColumns(rows: QuestRow[]): QuestColumn[] {
    const cols = new Map<string, QuestColumn>();
    for (const row of rows) {
        for (const [id, cell] of Object.entries(row.cells)) {
            const quest = QUEST_BY_ID.get(id);
            let col = cols.get(id);
            if (!col) {
                col = { id, label: quest?.label ?? id, done: 0, listed: 0, qp: quest?.qp ?? 0, members: quest?.members ?? true };
                if (quest?.miniquest) col.miniquest = true;
                cols.set(id, col);
            }
            col.listed++;
            if (cell.state === 'done') col.done++;
        }
    }
    return [...cols.values()].sort((a, b) => b.listed - a.listed || a.label.localeCompare(b.label));
}

export function goalSummary(
    rows: QuestRow[],
    completions: Completion[],
    since: number,
    now: number,
    states: Array<Record<string, ItemState | null>>
) {
    const recent = completions.filter((c) => c.at >= since);
    const hours = new Map<string, number>();
    for (const c of recent) {
        const hour = new Date(Math.floor(c.at / 3_600_000) * 3_600_000).toISOString();
        hours.set(hour, (hours.get(hour) ?? 0) + 1);
    }
    const cells = rows.flatMap((r) => Object.values(r.cells));
    const failedLastHour = states
        .flatMap((s) => Object.entries(s))
        .filter(([id, s]) => s && questForId(id) && !s.done && (s.failures ?? 0) > 0 && s.lastAt && now - Date.parse(s.lastAt) < 3_600_000).length;
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

/** Accounts with a todo list, a todo-state.json, or both. */
function accountNames(botsDir: string, listed: string[]): string[] {
    const names = new Map(listed.map((name) => [name.toLowerCase(), name]));
    let dirs: string[] = [];
    try {
        dirs = readdirSync(botsDir);
    } catch {
        dirs = [];
    }
    for (const dir of dirs) {
        if (!names.has(dir.toLowerCase()) && existsSync(join(botsDir, dir, 'todo-state.json'))) names.set(dir.toLowerCase(), dir);
    }
    return [...names.values()];
}

/** Everything the tab shows, from FLEET_BOTS_DIR. Reads ~1MB of each grind.log. */
export function questsPayload(botsDir: string, since: number, now = Date.now()): QuestsPayload {
    const todo = readJson<{ accounts?: Record<string, TodoItem[]> }>(join(botsDir, 'todo.json'), {});
    const lists = todo.accounts ?? {};
    const rows: QuestRow[] = [];
    const completions: Completion[] = [];
    const states: Array<Record<string, ItemState | null>> = [];
    const accounts: Record<string, AccountQuestPoints> = {};
    for (const name of accountNames(botsDir, Object.keys(lists))) {
        const state = readJson<Record<string, ItemState | null>>(join(botsDir, name, 'todo-state.json'), {});
        states.push(state);
        const log = tailLines(join(botsDir, name, 'grind.log'), 1024 * 1024);
        const r = accountRow(name, lists[name] ?? [], state, log, now);
        completions.push(...r.completions);
        accounts[name] = { qp: r.row.qp, done: Object.keys(r.row.cells).filter((id) => r.row.cells[id]!.state === 'done') };
        // An account whose list holds no real quest (a mule, a grinder) has no row.
        if (Object.keys(r.row.cells).length) rows.push(r.row);
    }
    rows.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
    return {
        generatedAt: new Date(now).toISOString(),
        since: new Date(since).toISOString(),
        columns: questColumns(rows),
        rows,
        goal: goalSummary(rows, completions, since, now, states),
        questPoints: {
            total: Object.values(accounts).reduce((sum, a) => sum + a.qp, 0),
            max: MAX_QP,
            quests: QUESTS.filter((quest) => !quest.miniquest).length,
            accounts,
            source: QP_SOURCE,
        },
    };
}
