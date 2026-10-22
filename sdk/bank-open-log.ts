/**
 * Per-open bank picture. One line per successful openBank() call, no hourly
 * dedupe (unlike bank-stock.log which keeps the first line per clock hour).
 * See specs/004-script-item-rates for the hourly history; this file answers
 * "what did the bank hold every time the bot opened it".
 */
import { mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { REPO_ROOT } from './assignment';
import { appendGrindLog } from './grind-log';

export interface BankOpenItem {
    id: number;
    name: string;
    count: number;
}

export interface BankOpenLine {
    t: number;
    reason: string;
    items: BankOpenItem[];
}

export function bankOpenLogPath(name: string, root = REPO_ROOT): string {
    return join(root, 'bots', name, 'bank-opens.log');
}

/** Appends one line per bank open. Returns whether a line was written. */
export function appendBankOpen(
    name: string,
    items: BankOpenItem[],
    now: number,
    opts?: { root?: string; reason?: string }
): boolean {
    if (!name || items.length === 0) return false;
    const path = bankOpenLogPath(name, opts?.root);
    const line: BankOpenLine = {
        t: now,
        reason: opts?.reason ?? 'open',
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
