import { basename } from 'path';

/**
 * "Current activity" for the fleet desk, built from what is actually
 * assigned and logged instead of trusting a hand-written status file that
 * goes stale. Adapted from markeljan/rs-sdk-dashboard's
 * tools/dashboard/activity-summary.ts. Our bots write no tasks.json, so the
 * priority here is simpler:
 *
 *   1. paused -> "Paused ..."
 *   2. roster script + latest grind.log line -> "bowstrings: banking 12k ..."
 *   3. roster script, no log yet -> "bowstrings — starting..."
 *   4. no roster script -> "No roster script"
 */

export function scriptLeaf(script: string): string {
    return basename(script).replace(/\.(ts|sh|js|mjs)$/, '');
}

/** `[8:24 PM] [thief] bank (low food)` -> { tag: 'thief', text: 'bank (low food)' }; timestamps are dropped. */
export function splitLogLine(line: string | null): { tag: string | null; text: string | null } {
    let rest = (line ?? '').trim();
    // Bare ISO-8601 prefix, e.g. `2026-10-14T18:04:22.761Z WARN ...`.
    rest = rest.replace(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z?\s*/, '');
    let tag: string | null = null;
    for (let m = rest.match(/^\[([^\]]*)\]\s*/); m; m = rest.match(/^\[([^\]]*)\]\s*/)) {
        if (!/^[\d:.\sTZ/-]+(AM|PM)?$/i.test(m[1]!)) tag = m[1]!;
        rest = rest.slice(m[0].length);
    }
    return { tag, text: rest || null };
}

export function activityLabel(opts: {
    script: string;
    extra: string;
    paused: boolean;
    lastLogLine: string | null;
}): string {
    const leaf = scriptLeaf(opts.script);
    const running = opts.extra ? `${leaf} ${opts.extra}` : leaf;
    if (opts.paused) return `Paused · ${running}`;
    if (!opts.script) return 'No roster script';
    const { tag, text: lastLine } = splitLogLine(opts.lastLogLine);
    if (!lastLine) return `${running} — starting…`;
    const label = tag && !running.split(' ').includes(tag) ? `${running} · ${tag}` : running;
    return `${label}: ${lastLine}`;
}
