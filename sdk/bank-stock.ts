/**
 * One bank picture per character per clock hour. Later captures in the same
 * hour do not replace the first. See specs/004-script-item-rates.
 */
import { mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { REPO_ROOT } from './assignment';
import { appendGrindLog, readJsonlTail } from './grind-log';
import { hourStartMs, localHour, normalizeItemName } from './job-key';

export interface BankStockItem {
    id: number;
    name: string;
    count: number;
}

export interface BankStockLine {
    t: number;
    hour: string;
    items: BankStockItem[];
}

export interface StockAccount {
    name: string;
    lines: BankStockLine[];
}

export interface StockGain {
    t: number;
    item: string;
    count: number;
}

export interface StockCheck {
    item: string;
    from: string;
    to: string;
    accounts: string[];
    excluded: string[];
    stockFrom: number;
    stockTo: number;
    stockDelta: number;
    gains: number;
    gap: number;
}

export function stockLogPath(name: string, root = REPO_ROOT): string {
    return join(root, 'bots', name, 'bank-stock.log');
}

/** Appends when this clock hour has no line yet. Returns whether a line was written. */
export function appendHourlyBankStock(
    name: string,
    items: BankStockItem[],
    now: number,
    opts?: { root?: string; hourOf?: (t: number) => string }
): boolean {
    if (!name || items.length === 0) return false;
    const hourOf = opts?.hourOf ?? localHour;
    const hour = hourOf(now);
    const path = stockLogPath(name, opts?.root);
    const last = readJsonlTail<BankStockLine>(path, { tailBytes: 64_000, maxRecords: 5 }).at(-1);
    if (last?.hour === hour) return false;
    const line: BankStockLine = {
        t: now,
        hour,
        items: items.map((item) => ({ id: item.id, name: item.name, count: item.count })),
    };
    try {
        mkdirSync(dirname(path), { recursive: true });
        appendGrindLog(path, JSON.stringify(line));
        return true;
    } catch {
        return false;
    }
}

function itemCount(items: BankStockItem[], item: string): number {
    const key = normalizeItemName(item);
    return items.reduce((sum, row) => (normalizeItemName(row.name) === key ? sum + (row.count ?? 0) : sum), 0);
}

function lineForHour(lines: BankStockLine[], hour: string): BankStockLine | null {
    return lines.find((line) => line.hour === hour && Array.isArray(line.items) && line.items.length > 0) ?? null;
}

/**
 * Fleet bank change between two hour buckets, beside summed gains.
 * Accounts missing either hour are excluded from both sums.
 */
export function computeStockCheck(
    accounts: StockAccount[],
    gains: StockGain[],
    item: string,
    from: string,
    to: string
): StockCheck {
    const included: string[] = [];
    const excluded: string[] = [];
    let stockFrom = 0;
    let stockTo = 0;
    for (const account of accounts) {
        const start = lineForHour(account.lines, from);
        const end = lineForHour(account.lines, to);
        if (!start || !end) {
            excluded.push(account.name);
            continue;
        }
        included.push(account.name);
        stockFrom += itemCount(start.items, item);
        stockTo += itemCount(end.items, item);
    }
    const fromMs = hourStartMs(from);
    const toMs = hourStartMs(to);
    const key = normalizeItemName(item);
    let gained = 0;
    for (const gain of gains) {
        if (normalizeItemName(gain.item) !== key) continue;
        if (!Number.isFinite(gain.t) || gain.t < fromMs || gain.t >= toMs) continue;
        if (!Number.isInteger(gain.count) || gain.count < 1) continue;
        gained += gain.count;
    }
    const stockDelta = stockTo - stockFrom;
    return {
        item,
        from,
        to,
        accounts: included,
        excluded,
        stockFrom,
        stockTo,
        stockDelta,
        gains: gained,
        gap: stockDelta - gained,
    };
}
