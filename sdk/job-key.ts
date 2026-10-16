/** Launch command identity for item-rate grouping. See specs/004-script-item-rates. */

export function normalizeItemName(name: string): string {
    return name.trim().replace(/\s+/g, ' ').toLowerCase();
}

/** Host-local clock hour, `YYYY-MM-DDTHH`. */
export function localHour(t: number): string {
    const d = new Date(t);
    const p = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}`;
}

export function hourStartMs(hour: string): number {
    const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2})$/.exec(hour);
    if (!m) return Number.NaN;
    return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4])).getTime();
}

/**
 * Repo-relative script path plus launch args that are not the character name.
 * `bots/quests/fishing-route.ts Jackpoo3 --shark` → `bots/quests/fishing-route.ts --shark`.
 */
export function jobKeyFromArgv(argv: string[], botName?: string): string {
    const idx = argv.findIndex((arg) => /(?:^|\/)bots\/.+\.ts$/.test(arg));
    if (idx < 0) return '';
    const script = argv[idx]!;
    const botsAt = script.lastIndexOf('bots/');
    const rel = botsAt >= 0 ? script.slice(botsAt) : script;
    const skip = (botName ?? '').toLowerCase();
    const rest = argv.slice(idx + 1).filter((arg) => !skip || arg.toLowerCase() !== skip);
    return [rel, ...rest].join(' ');
}

export function rosterJobKey(script: string, args: string[], botName: string): string {
    const skip = botName.toLowerCase();
    const rest = args.filter((arg) => arg.toLowerCase() !== skip);
    return [script, ...rest].join(' ');
}
