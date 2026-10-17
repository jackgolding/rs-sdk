/** Pure roster / skip-list edits for the fleet desk. No process spawning. */

const SCRIPT_RE = /^bots\/quests\/[A-Za-z0-9][A-Za-z0-9._-]*\.ts$/;
const TOKEN_RE = /^[A-Za-z0-9_.=:@/-]{1,64}$/;

export function scriptError(script: string, exists: (path: string) => boolean): string | null {
    if (!SCRIPT_RE.test(script) || script.includes('..')) {
        return 'Script must be a file under bots/quests/';
    }
    if (!exists(script)) return `Script does not exist: ${script}`;
    return null;
}

export function parseExtraArgs(extra: string): string[] {
    const tokens = extra.trim().split(/\s+/).filter(Boolean);
    if (tokens.length > 8) throw new Error('At most 8 extra arguments');
    for (const token of tokens) {
        if (token.includes('..') || !TOKEN_RE.test(token)) throw new Error(`Bad argument: ${token}`);
    }
    return tokens;
}

export function assignRosterScript(
    roster: { bots?: unknown },
    name: string,
    script: string,
    extra: string
): { name: string; args: string[] } {
    if (!Array.isArray(roster.bots)) throw new Error('Roster has no bots array');
    const bot = roster.bots.find(
        (entry) =>
            entry != null &&
            typeof entry === 'object' &&
            typeof (entry as { name?: unknown }).name === 'string' &&
            (entry as { name: string }).name.toLowerCase() === name.toLowerCase()
    ) as { name: string; script?: string; args?: unknown } | undefined;
    if (!bot) throw new Error(`Unknown bot "${name}"`);
    bot.script = script;
    const args = [bot.name, ...parseExtraArgs(extra)];
    bot.args = args;
    return { name: bot.name, args };
}

/** Add or remove one name. Comments and other names stay put. */
export function setSkipList(text: string, name: string, paused: boolean): string {
    const lines = text.split('\n');
    const kept = lines.filter((line) => {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) return true;
        return trimmed.toLowerCase() !== name.toLowerCase();
    });
    while (kept.length > 0 && kept[kept.length - 1] === '') kept.pop();
    if (paused) kept.push(name);
    const body = kept.join('\n');
    return body.length === 0 ? '' : `${body}\n`;
}
