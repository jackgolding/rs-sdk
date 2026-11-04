/**
 * Per-account quest facts other quests depend on, in `bots/<Account>/quest-tags.json`.
 *
 *   arravGang: 'phoenix' | 'blackarm' — the gang the account joined in Shield of Arrav. It is
 *   permanent in game (blackarmgang_journal.rs2 keys every later line on %phoenixgang or
 *   %blackarmgang), and Heroes' Quest has to be run on the same side and paired with the other.
 *
 * Written by shield-of-arrav.ts when it runs; read by heroes-quest.ts. The file sits beside
 * todo-state.json, so it lives on the box's bots/ mount with the rest of the account's state.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'fs';
import { join } from 'path';

export type Gang = 'phoenix' | 'blackarm';
export interface QuestTags {
    arravGang?: Gang;
    arravGangAt?: string;
}

/** The account's bots/ directory, matched case-insensitively (the box has ABGARMY08, args may say abgarmy08). */
function accountDir(account: string): string {
    const root = join(process.cwd(), 'bots');
    const exact = join(root, account);
    if (existsSync(exact)) return exact;
    const hit = existsSync(root) ? readdirSync(root).find((d) => d.toLowerCase() === account.toLowerCase()) : undefined;
    return hit ? join(root, hit) : exact;
}

export function readTags(account: string): QuestTags {
    try {
        return JSON.parse(readFileSync(join(accountDir(account), 'quest-tags.json'), 'utf-8')) as QuestTags;
    } catch {
        return {};
    }
}

export function writeTags(account: string, patch: QuestTags): void {
    const dir = accountDir(account);
    mkdirSync(dir, { recursive: true });
    const path = join(dir, 'quest-tags.json');
    const tmp = `${path}.tmp-${process.pid}`;
    writeFileSync(tmp, `${JSON.stringify({ ...readTags(account), ...patch }, null, 2)}\n`);
    renameSync(tmp, path);
}

/** The Shield of Arrav gang on record, if any. */
export function arravGang(account: string): Gang | undefined {
    const g = readTags(account).arravGang;
    return g === 'phoenix' || g === 'blackarm' ? g : undefined;
}
