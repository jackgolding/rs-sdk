import { closeSync, existsSync, openSync, readSync, statSync } from 'fs';

const DEFAULT_BYTES = 256 * 1024;

/** Last `maxLines` of a file, reading at most `maxBytes` from the end. */
export function tailFile(path: string, maxLines: number, maxBytes = DEFAULT_BYTES): string[] {
    if (!existsSync(path)) return [];
    const lines = Math.max(1, Math.min(maxLines, 400));
    let fd: number | null = null;
    try {
        const size = statSync(path).size;
        if (size === 0) return [];
        const bytes = Math.min(size, maxBytes);
        const buf = Buffer.allocUnsafe(bytes);
        fd = openSync(path, 'r');
        readSync(fd, buf, 0, bytes, size - bytes);
        let text = buf.toString('utf-8');
        if (bytes < size) {
            const nl = text.indexOf('\n');
            text = nl < 0 ? '' : text.slice(nl + 1);
        }
        return text
            .split('\n')
            .filter((line) => line.trim())
            .slice(-lines);
    } catch {
        return [];
    } finally {
        if (fd !== null) closeSync(fd);
    }
}
