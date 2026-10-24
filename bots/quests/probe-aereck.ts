/**
 * probe-aereck — one-shot dialog archaeology for The Restless Ghost's accept.
 *
 *   bun bots/quests/probe-aereck.ts <botname>        (local)
 *   tools/canary.sh <acct> probe-aereck.ts           (on the demo server)
 *
 * WHY. The quest script starts the quest 4/4 in the local fixture and NEVER on
 * the live server: the dialog walks to the end (9 continue pages after the
 * "I'm looking for a quest!" choice) and `%prieststart` stays 0, so the journal
 * still reads "I can start this quest by speaking to Father Aereck". A pump that
 * clicks `sendClickDialog(index)` is the only difference from a human click, so
 * this dumps EVERY page with its option indices, component ids and button types,
 * clicks the quest option the way the script does, then prints the journal's raw
 * lines plus the dialog state after the click. Read the dump, then patch once.
 *
 * Non-mutating in spirit: it talks (which advances the character for real on
 * success — rule 20), but it never changes inventory or position beyond walking
 * to Aereck.
 */
import { existsSync, readFileSync } from 'fs';
import { dirname, join } from 'path';

import { BotSDK, deriveGatewayUrl } from '../../sdk/index';
import { BotActions } from '../../sdk/actions';
import { initPathfinding, findLongPath } from '../../sdk/pathfinding';
import { readJournalCheckpoint } from '../../quest-lab/journal-reader';
import type { JournalRule } from '../../quest-lab/evidence';

const argv = process.argv.slice(2);
const botArg = argv.find(a => !a.startsWith('-'));
const envPath = botArg ? join(process.cwd(), 'bots', botArg, 'bot.env') : join(dirname(import.meta.path), 'bot.env');
if (!existsSync(envPath)) throw new Error(`bot.env not found at ${envPath}`);
for (const line of readFileSync(envPath, 'utf-8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq > 0) process.env[t.slice(0, eq)] = t.slice(eq + 1);
}
const username = process.env.BOT_USERNAME!;

const AERECK = { x: 3244, z: 3206 };
const UNSTARTED: JournalRule = { id: 'probe:unstarted', kind: 'unstarted', all: ['I can start this quest by speaking to'] };
const STARTED: JournalRule = { id: 'probe:started', kind: 'active', all: ['Father Urhney'] };
const JOURNAL = { label: 'The Restless Ghost', title: 'The Restless Ghost' };

initPathfinding();
const sdk = new BotSDK({
    botUsername: username,
    password: process.env.PASSWORD ?? '',
    gatewayUrl: deriveGatewayUrl(process.env.SERVER),
    autoLaunchBrowser: true,
    browserLaunchTimeout: 90_000,
    readyTimeout: 45_000,
    connectTimeout: 60_000,
    showChat: false,
});
const bot = new BotActions(sdk);
await sdk.connect();
await sdk.waitForCondition(s => !!s.player, 60_000).catch(() => {});

const pos = () => {
    const p = sdk.getState()?.player;
    return { x: p?.worldX ?? 0, z: p?.worldZ ?? 0, level: p?.level ?? 0 };
};

console.log(`probe-aereck @ ${pos().x},${pos().z} l${pos().level}`);

// Walk to Aereck if we are not already next to him (arena-clear, no doors here).
if (Math.hypot(pos().x - AERECK.x, pos().z - AERECK.z) > 3) {
    const path = findLongPath(0, pos().x, pos().z, AERECK.x, AERECK.z) as { x: number; z: number }[] | null;
    console.log(`route points: ${path?.length ?? 0}`);
    for (const hop of path ?? []) {
        if (Math.hypot(pos().x - hop.x, pos().z - hop.z) <= 3) continue;
        await bot.walkTo(hop.x, hop.z, 3).catch(() => {});
    }
    console.log(`walked to ${pos().x},${pos().z}`);
}

const talk = await bot.talkTo(/father aereck/i);
console.log(`talkTo: success=${talk.success} ${talk.message ?? ''}`);

for (let i = 0; i < 40; i++) {
    const d = sdk.getDialog();
    if (!d?.isOpen) {
        await sdk.waitForTicks(2);
        if (!sdk.getDialog()?.isOpen && i > 3) { console.log('dialog closed'); break; }
        continue;
    }
    console.log(`PAGE ${i}: text=${JSON.stringify(d.text ?? '')} waiting=${d.isWaiting}`);
    console.log(`  options: ${(d.options ?? []).map(o => `i${o.index} bt${o.buttonType ?? '?'} cid${o.componentId ?? '?'} ${JSON.stringify(o.text)}`).join(' | ') || '(none)'}`);
    console.log(`  components: ${(d.allComponents ?? []).map(c => `${c.id}/t${c.type}/bt${c.buttonType} opt=${JSON.stringify(c.option)}`).join(' ; ') || '(none)'}`);
    const options = d.options ?? [];
    const pick = options.find(o => /looking for a quest/i.test(o.text))
        ?? (options.length === 1 ? options[0] : undefined);
    if (pick) {
        const res = await sdk.sendClickDialog(pick.index);
        console.log(`  CLICK sendClickDialog(${pick.index}) -> success=${res.success} ${(res as any).message ?? ''}`);
    } else if (options.length) {
        console.log('  (no pick on this page)');
    }
    await sdk.waitForTicks(3);
}

const after = await readJournalCheckpoint(sdk, JOURNAL, UNSTARTED);
console.log(`journal UNSTARTED rule: ${after.verdict?.verdict} — ${after.reason}`);
for (const line of after.rawLines ?? []) console.log(`  raw: ${JSON.stringify(line.rawText)}`);
const started = await readJournalCheckpoint(sdk, JOURNAL, STARTED);
console.log(`journal STARTED rule: ${started.verdict?.verdict} — ${started.reason}`);
console.log(`final pos ${pos().x},${pos().z} l${pos().level}`);
await sdk.disconnect();
