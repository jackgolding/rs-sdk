/**
 * Bounded grind-log writer. Append-only logs used to grow past a gigabyte
 * because nothing truncated them; fleet-status then tried to classify by
 * reading the tail. Keep the on-disk file capped so a seek stays cheap.
 */
import {
    appendFileSync,
    closeSync,
    existsSync,
    openSync,
    readSync,
    renameSync,
    statSync,
    unlinkSync,
    writeFileSync,
} from 'fs';

export const MAX_GRIND_LOG_BYTES = 8 * 1024 * 1024;
export const KEEP_GRIND_LOG_BYTES = 4 * 1024 * 1024;

export function appendGrindLog(
    path: string,
    line: string,
    opts?: { maxBytes?: number; keepBytes?: number }
): void {
    const text = line.endsWith('\n') ? line : `${line}\n`;
    try {
        appendFileSync(path, text);
    } catch {
        return;
    }
    rotateLogFile(path, opts);
}

/** If `path` is over maxBytes, rewrite it to the last keepBytes (aligned to a newline). */
export function rotateLogFile(
    path: string,
    opts?: { maxBytes?: number; keepBytes?: number }
): void {
    const maxBytes = opts?.maxBytes ?? MAX_GRIND_LOG_BYTES;
    const keepBytes = Math.min(opts?.keepBytes ?? KEEP_GRIND_LOG_BYTES, maxBytes);
    if (!existsSync(path)) return;

    let size = 0;
    try {
        size = statSync(path).size;
    } catch {
        return;
    }
    if (size <= maxBytes) return;

    const bytes = Math.min(size, keepBytes);
    const buf = Buffer.allocUnsafe(bytes);
    let fd: number | null = null;
    try {
        fd = openSync(path, 'r');
        readSync(fd, buf, 0, bytes, size - bytes);
    } catch {
        return;
    } finally {
        if (fd !== null) closeSync(fd);
    }

    let text = buf.toString('utf-8');
    if (bytes < size) {
        const nl = text.indexOf('\n');
        text = nl < 0 ? '' : text.slice(nl + 1);
    }

    const tmp = `${path}.rotating`;
    try {
        writeFileSync(tmp, text);
        renameSync(tmp, path);
    } catch {
        try {
            unlinkSync(tmp);
        } catch {
            /* ignore */
        }
    }
}

export interface ReadJsonlTailOptions {
    /** Max bytes to seek from end of file. */
    tailBytes?: number;
    /** Max parsed records to return (newest last). */
    maxRecords?: number;
}

/**
 * Bounded tail read of a JSONL file. Skips unparseable lines (e.g. after rotation).
 * Never reads the whole file.
 */
export function readJsonlTail<T = Record<string, unknown>>(
    path: string,
    opts?: ReadJsonlTailOptions
): T[] {
    const tailBytes = opts?.tailBytes ?? 256 * 1024;
    const maxRecords = opts?.maxRecords ?? 500;
    if (!existsSync(path)) return [];

    let fd: number | null = null;
    try {
        const size = statSync(path).size;
        if (size === 0) return [];
        const bytes = Math.min(size, tailBytes);
        const buf = Buffer.allocUnsafe(bytes);
        fd = openSync(path, 'r');
        readSync(fd, buf, 0, bytes, size - bytes);
        let text = buf.toString('utf-8');
        if (bytes < size) {
            const nl = text.indexOf('\n');
            text = nl < 0 ? '' : text.slice(nl + 1);
        }
        const out: T[] = [];
        for (const line of text.split('\n')) {
            const trimmed = line.trim();
            if (!trimmed) continue;
            try {
                out.push(JSON.parse(trimmed) as T);
            } catch {
                /* rotation may truncate the first line */
            }
        }
        return out.slice(-maxRecords);
    } catch {
        return [];
    } finally {
        if (fd !== null) closeSync(fd);
    }
}
