#!/usr/bin/env bun
/**
 * Legends planner: run by legends-planner.timer every 30 minutes, so no account waits for a person to queue its
 * next Legends' Quest step. Research on 2026-11-09 found 67% of the finishers' time (1,087 of 1,633 idle hours)
 * was the next Legends-path quest not being on the account's list yet; the work itself was ~9 h an account.
 *
 * For each runner account (roster script todo-runner, not on the swarm or skip-bots, not a mule or excluded) that
 * hasn't finished Legends, closest first and up to `maxActive` at once, it keeps queued in bots/todo.json:
 *   - training the quest scripts can't do in their prologue: Magic (alch-train / magic-train --until) and Smithing
 *     (Knight's Sword: 12,725 Smithing XP, 50+ at the server's 25x). Mining, Woodcutting, Fletching and Crafting
 *     are trained by run-quest's prologue; any other skill short is reported, not queued.
 *   - the solo chain: Lost City, Merlin's Crystal, Jungle Potion, Plague City, Waterfall, Biohazard, Shilo Village,
 *     Underground Pass, Dragon Slayer, Family Crest — only what isn't done or already queued
 *   - quest-point fillers (the most reliable quests on the fleet) up to 107 QP + a margin, then Legends' Quest
 *   - Shield of Arrav and Hero's Quest as PAIRS (one Phoenix, one Black Arm): queued at the front of both lists at
 *     the same moment and both quest containers restarted together, so neither partner waits out the other's
 *     silence limit (three Arrav trade timeouts in 72 h came from partners started apart).
 * A Legends-path item that used its tries is re-added once 12 h later, at most twice (fleet-watch's GAVE_UP still
 * fires). The runner orders the rest: prerequisite and skill gates exit as waits, not failures.
 *
 *   bun infra/pilot/legends-planner.ts [--dry]        --dry: print the plan, write and restart nothing
 *
 * Under the cap it also brings swarm accounts onto the runner, closest first and at most PROMOTE_PER_RUN a run (the
 * user's rule: quests win over the swarm): off swarm.json, the swarm restarted once, off skip-bots, then the lite and
 * quest containers up. A skip-bots account that isn't on the swarm was paused on purpose and is only reported, unless
 * the config says `promoteSkipped`.
 *
 * Config /srv/fleet/state/legends-planner.json (optional):
 *   { "maxActive": 12, "exclude": ["jackthief", "jackquests"], "promote": true, "promoteSkipped": false }
 * Environment for tests: FLEET_BOTS_DIR, FLEET_STATE_DIR, FLEET_PLANNER_NO_DOCKER=1 (restarts only recorded).
 */
import { appendFileSync, copyFileSync, existsSync, openSync, readFileSync, readSync, closeSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { QUESTS, questForId, questForItem } from '../../tools/fleet-desk/quest-catalog.ts';

const BOTS = process.env.FLEET_BOTS_DIR ?? '/srv/fleet/bots';
const STATE = process.env.FLEET_STATE_DIR ?? '/srv/fleet/state';
const DRY = process.argv.includes('--dry');
const NO_DOCKER = DRY || process.env.FLEET_PLANNER_NO_DOCKER === '1';
const NOW = Date.now();
const NOW_ISO = new Date(NOW).toISOString();
const RUN_ID = 'legends-planner';

const J = <T>(p: string, f: T): T => {
    try {
        return JSON.parse(readFileSync(p, 'utf8')) as T;
    } catch {
        return f;
    }
};
const lines = (p: string) => (existsSync(p) ? readFileSync(p, 'utf8').split('\n').map((s) => s.trim()).filter(Boolean) : []);
function tail(p: string, bytes: number): string {
    if (!existsSync(p)) return '';
    const size = statSync(p).size, n = Math.min(size, bytes), b = Buffer.alloc(n), fd = openSync(p, 'r');
    readSync(fd, b, 0, n, size - n);
    closeSync(fd);
    return b.toString('utf8');
}

const config = J<{ maxActive?: number; exclude?: string[]; promote?: boolean; promoteSkipped?: boolean }>(join(STATE, 'legends-planner.json'), {});
const PROMOTE = config.promote !== false;
const PROMOTE_SKIPPED = config.promoteSkipped === true;
const PROMOTE_PER_RUN = 4;
const PILOT = process.env.FLEET_PILOT_DIR ?? '/srv/fleet/repo/infra/pilot';
const MAX_ACTIVE = config.maxActive ?? 12;
const EXCLUDE = new Set((config.exclude ?? ['jackthief', 'jackquests']).map((s) => s.toLowerCase()));
const QP_GOAL = 107;
const QP_MARGIN = 3;
const MAX_FAILURES = 2;
const READD_AFTER_MS = 12 * 3600_000;
const READD_MAX = 2;

/** Catalog id -> how a todo item runs it. Scripts and caps as the fleet's completed items ran them. */
const SCRIPT: Record<string, { script: string; capMin?: number }> = {
    arrav: { script: 'shield-of-arrav' },
    heroes: { script: 'heroes-quest', capMin: 300 },
    lostcity: { script: 'lost-city' },
    arthur: { script: 'merlins-crystal' },
    junglepotion: { script: 'jungle-potion' },
    elena: { script: 'plague-city' },
    waterfall: { script: 'waterfall' },
    biohazard: { script: 'biohazard' },
    zombiequeen: { script: 'shilo-village', capMin: 300 },
    upass: { script: 'underground-pass', capMin: 300 },
    dragon: { script: 'dragon' },
    crest: { script: 'crest', capMin: 300 },
    legends: { script: 'legends-quest', capMin: 300 },
    squire: { script: 'knights-sword' },
    // Fillers: the fleet's most reliable quests (2026-11-09 counts), in that order.
    priestperil: { script: 'priest-in-peril' },
    gobdip: { script: 'goblin-diplomacy' },
    demon: { script: 'demon-slayer' },
    doric: { script: 'dorics-quest' },
    murder: { script: 'murder-mystery' },
    itexam: { script: 'dig-site' },
    fishingcompo: { script: 'fishing-contest' },
    hazeelcult: { script: 'hazeel-cult' },
    totem: { script: 'tribal-totem' },
    chompybird: { script: 'chompybird' },
    mcannon: { script: 'dwarf-cannon' },
    fluffs: { script: 'gertrudes-cat' },
    ikov: { script: 'temple-of-ikov' },
    tree: { script: 'tree-gnome-village' },
    elemental: { script: 'elemental-workshop' },
    scorpcatcher: { script: 'scorpion-catcher' },
    druidspirit: { script: 'nature-spirit', capMin: 180 },
    cog: { script: 'clock-tower' },
    sheepherder: { script: 'sheep-herder' },
    touristtrap: { script: 'tourist-trap' },
    itgronigen: { script: 'observatory' },
    seaslug: { script: 'sea-slug', capMin: 180 },
    grandtree: { script: 'grand-tree' },
    romeojuliet: { script: 'romeo-and-juliet' },
    prince: { script: 'prince-ali-rescue' },
    hunt: { script: 'pirates-treasure' },
    vampire: { script: 'vampire-slayer' },
    fortress: { script: 'black-knights-fortress' },
    haunted: { script: 'ernest-chicken' },
};
const FILLERS = ['priestperil', 'gobdip', 'demon', 'doric', 'romeojuliet', 'murder', 'itexam', 'fishingcompo', 'hazeelcult', 'totem', 'vampire', 'prince', 'hunt', 'chompybird', 'mcannon', 'fluffs', 'ikov', 'tree', 'elemental', 'scorpcatcher', 'druidspirit', 'cog', 'sheepherder', 'touristtrap', 'itgronigen', 'seaslug', 'grandtree', 'fortress', 'haunted'];
/** Quest prerequisites (quest ids), from each script's `requires`, the runner's QUEST_AFTER and the game. */
const NEEDS: Record<string, string[]> = {
    legends: ['heroes', 'crest', 'zombiequeen', 'upass', 'waterfall'],
    heroes: ['arrav', 'lostcity', 'arthur', 'dragon'],
    zombiequeen: ['junglepotion'],
    upass: ['biohazard'],
    biohazard: ['elena'],
    druidspirit: ['priestperil', 'priest'],
    grandtree: ['tree'],
};
/** The solo chain, in the order queued (the runner holds anything whose prerequisite isn't done). */
const SOLO = ['lostcity', 'arthur', 'junglepotion', 'elena', 'waterfall', 'biohazard', 'zombiequeen', 'upass', 'dragon', 'crest'];
const LEGENDS_PATH = new Set([...SOLO, 'arrav', 'heroes', 'legends']);
/** Each chain quest's skills (the scripts' `skills:`), lower-case like heartbeat's keys lowered. */
const SKILLS: Record<string, Record<string, number>> = {
    legends: { magic: 56, mining: 52, agility: 50, crafting: 50, smithing: 50, strength: 50, thieving: 50, woodcutting: 50, herblore: 45, prayer: 42 },
    heroes: { mining: 50, herblore: 25, fishing: 53, cooking: 53 },
    crest: { mining: 40, crafting: 40, smithing: 40, magic: 59 },
    zombiequeen: { agility: 32, crafting: 20 },
    upass: { ranged: 25 },
    waterfall: { magic: 25 },
    lostcity: { crafting: 31, woodcutting: 36, magic: 31 },
    dragon: { attack: 60, prayer: 43, magic: 31 },
    biohazard: { attack: 15, strength: 15, defence: 15, hitpoints: 20 },
    junglepotion: { herblore: 3 },
};
/** run-quest's prologue trains these itself (bots/quests/lib/training.ts TRAINERS). */
const PROLOGUE_TRAINED = new Set(['mining', 'woodcutting', 'fletching', 'crafting']);

const qp = (id: string) => questForId(id)?.qp ?? 0;
const log: string[] = [];
const say = (s: string) => {
    log.push(s);
    console.log(s);
};

// ── Fleet state ───────────────────────────────────────────────────────────────────────────────────────────
const rosterRaw = J<any>(join(BOTS, 'roster.json'), {});
const roster: any[] = Array.isArray(rosterRaw) ? rosterRaw : rosterRaw.bots ?? [];
const todoDoc = J<any>(join(BOTS, 'todo.json'), null);
if (!todoDoc) throw new Error('legends-planner: bots/todo.json unreadable');
const todo: Record<string, any[]> = todoDoc.accounts;
const swarm = new Set((J<any>(join(BOTS, 'swarm.json'), { accounts: [] }).accounts as any[]).map((a) => String(a.name).toLowerCase()));
const skip = new Set(lines(join(STATE, 'skip-bots.txt')).map((s) => s.toLowerCase()));
const pstatePath = join(STATE, 'legends-planner-state.json');
const pstate = J<{ readded: Record<string, number[]>; pairs: Array<{ quest: string; a: string; b: string; at: string }> }>(pstatePath, { readded: {}, pairs: [] });

interface Acct {
    name: string;
    st: Record<string, any>;
    items: any[];
    done: Set<string>;
    levels: Record<string, number>;
    gang: 'phoenix' | 'blackarm' | null;
    running: string | null;
}
function load(name: string): Acct {
    const dir = join(BOTS, name);
    const st = J<Record<string, any>>(join(dir, 'todo-state.json'), {});
    const items = (todo[name] ??= []);
    const done = new Set<string>();
    for (const i of items) {
        const q = questForItem(i);
        if (q && (i.done || st[i.questId]?.done)) done.add(q.id);
    }
    for (const [k, v] of Object.entries(st)) if (v?.done) {
        const q = questForId(k);
        if (q) done.add(q.id);
    }
    const glog = existsSync(join(dir, 'grind.log')) ? readFileSync(join(dir, 'grind.log'), 'utf8') : '';
    for (const m of glog.matchAll(/\[([\w.-]+)\] QUEST COMPLETE \(journal-verified\)/g)) {
        const q = questForId(m[1]!);
        if (q) done.add(q.id);
    }
    // The run in progress: the last "stage at start" with no COMPLETE/FATAL after it.
    let running: string | null = null;
    for (const line of tail(join(dir, 'grind.log'), 300_000).split('\n')) {
        const m = /^\S+ \[([\w.-]+)\] (stage at start:|QUEST COMPLETE|ASSISTED COMPLETE|FATAL|TASK DONE)/.exec(line);
        if (!m) continue;
        running = m[2] === 'stage at start:' ? m[1]! : null;
    }
    let levels: Record<string, number> = {};
    for (const l of tail(join(dir, 'heartbeat.log'), 32768).trim().split('\n').reverse()) {
        try {
            const hb = JSON.parse(l);
            if (hb?.levels) {
                levels = Object.fromEntries(Object.entries(hb.levels as Record<string, number>).map(([k, v]) => [k.toLowerCase(), v]));
                break;
            }
        } catch {
            /* a torn line */
        }
    }
    const tags = J<any>(join(dir, 'quest-tags.json'), {});
    let gang: Acct['gang'] = tags.arravGang ?? null;
    if (!gang) for (const i of items) {
        const g = (i.args ?? []).join(' ').match(/--gang=(phoenix|blackarm)/)?.[1];
        if (g && questForItem(i)?.id === 'arrav' && (i.done || st[i.questId]?.done)) gang = g as Acct['gang'];
    }
    return { name, st, items, done, levels, gang, running };
}

/** An item for this quest that will still run: not done, tries left (or waiting). */
const live = (a: Acct, id: string) =>
    a.items.some((i) => questForItem(i)?.id === id && !i.done && !a.st[i.questId]?.done && ((a.st[i.questId]?.failures ?? 0) < MAX_FAILURES || a.st[i.questId]?.wait));
const exhausted = (a: Acct, id: string) => !a.done.has(id) && !live(a, id) && a.items.some((i) => questForItem(i)?.id === id);
const taskLive = (a: Acct, qid: string) => a.items.some((i) => i.questId === qid && !i.done && !a.st[qid]?.done && (a.st[qid]?.failures ?? 0) < MAX_FAILURES);
const taskDone = (a: Acct, qid: string) => a.items.some((i) => i.questId === qid && (i.done || a.st[qid]?.done));

/** The chain still to do, prerequisites first. */
function missingChain(a: Acct): string[] {
    const out: string[] = [];
    const walk = (q: string) => {
        for (const p of NEEDS[q] ?? []) walk(p);
        if (!a.done.has(q) && !out.includes(q)) out.push(q);
    };
    walk('legends');
    return out;
}
const qpDone = (a: Acct) => QUESTS.filter((q) => !q.miniquest && a.done.has(q.id)).reduce((s, q) => s + q.qp, 0);
/** Rough hours left: median-ish chain quest ~1 h, fillers ~0.5 h per QP short. */
function hoursLeft(a: Acct): number {
    const chain = missingChain(a);
    const after = qpDone(a) + chain.reduce((s, q) => s + qp(q), 0);
    return chain.length + Math.max(0, QP_GOAL - after) * 0.5;
}

function itemFor(id: string, qid: string, extra: { args?: string[]; capMin?: number; note?: string } = {}) {
    const s = SCRIPT[id];
    const it: any = { questId: qid, script: `bots/quests/${s?.script ?? id}.ts`, addedAt: NOW_ISO, canaryRunId: RUN_ID, note: extra.note ?? 'legends planner' };
    if (extra.args) it.args = extra.args;
    const cap = extra.capMin ?? s?.capMin;
    if (cap) it.capMin = cap;
    return it;
}
/** A fresh questId for this quest on this account (`crest`, then `crest-lp1`, ...). */
function freshId(a: Acct, base: string): string {
    const ids = new Set(a.items.map((i) => i.questId));
    if (!ids.has(base)) return base;
    for (let n = 1; ; n++) if (!ids.has(`${base}-lp${n}`)) return `${base}-lp${n}`;
}
/** May this exhausted quest be queued again? Records it when so. */
function mayReadd(a: Acct, id: string): boolean {
    const key = `${a.name}:${id}`;
    const at = pstate.readded[key] ?? [];
    const lastFail = Math.max(0, ...a.items.filter((i) => questForItem(i)?.id === id).map((i) => Date.parse(a.st[i.questId]?.lastAt ?? '') || 0));
    if (at.length >= READD_MAX || NOW - lastFail < READD_AFTER_MS) return false;
    pstate.readded[key] = [...at, NOW];
    return true;
}

const changed = new Set<string>();
const restart = new Set<string>();
function push(a: Acct, it: any, front = false) {
    if (front) a.items.splice(0, 0, it);
    else {
        // Before the account's Legends item, if one is already queued.
        const at = a.items.findIndex((i) => questForItem(i)?.id === 'legends' && !i.done && !a.st[i.questId]?.done);
        if (at >= 0) a.items.splice(at, 0, it);
        else a.items.push(it);
    }
    changed.add(a.name);
}

/** Queue one quest for a solo chain step or a filler; true if something was queued (or already will run). */
function ensure(a: Acct, id: string, added: string[]): boolean {
    if (a.done.has(id) || live(a, id)) return true;
    if (exhausted(a, id) && !mayReadd(a, id)) return false;
    const it = itemFor(id, freshId(a, id));
    push(a, it);
    added.push(it.questId);
    return true;
}

/** Skill gaps for the rest of the chain: queue Magic/Smithing training, report the rest. */
function planSkills(a: Acct, chain: string[], added: string[], notes: string[]) {
    const need: Record<string, number> = {};
    for (const q of chain) for (const [s, l] of Object.entries(SKILLS[q] ?? {})) need[s] = Math.max(need[s] ?? 0, l);
    if (chain.includes('heroes') && a.gang === 'phoenix') need.magic = Math.max(need.magic ?? 0, 35);
    for (const [skill, level] of Object.entries(need)) {
        const have = a.levels[skill] ?? 0;
        if (have >= level || PROLOGUE_TRAINED.has(skill)) continue;
        if (!Object.keys(a.levels).length) {
            notes.push('no heartbeat levels');
            return;
        }
        if (skill === 'magic') {
            const qid = `${have >= 21 ? 'alch' : 'magic'}-${level}`;
            if (taskLive(a, qid) || taskDone(a, qid)) continue;
            const it = itemFor(qid, qid, { note: `legends planner: Magic ${have} -> ${level}` });
            it.script = have >= 21 ? 'bots/quests/alch-train.ts' : 'bots/quests/magic-train.ts';
            it.args = [`--until=${level}`];
            it.capMin = 240;
            a.items.splice(0, 0, it);
            changed.add(a.name);
            added.push(qid);
        } else if (skill === 'smithing' && !a.done.has('squire')) {
            // Knight's Sword: 12,725 Smithing XP x25 — Smithing 1 to 60+ in one quest.
            if (!live(a, 'squire') && (!exhausted(a, 'squire') || mayReadd(a, 'squire'))) {
                const it = itemFor('squire', freshId(a, 'squire'), { note: `legends planner: Smithing ${have} -> ${level} (Knight's Sword XP)` });
                a.items.splice(0, 0, it);
                changed.add(a.name);
                added.push(it.questId);
            }
        } else notes.push(`${skill} ${have}/${level} (no trainer: train by hand)`);
    }
}

function fillers(a: Acct, chain: string[], added: string[]) {
    let qpAfter = qpDone(a) + chain.reduce((s, q) => s + qp(q), 0);
    // What's already queued and live counts too.
    for (const id of FILLERS) if (!a.done.has(id) && live(a, id)) qpAfter += qp(id);
    for (const id of FILLERS) {
        if (qpAfter >= QP_GOAL + QP_MARGIN) break;
        if (a.done.has(id) || live(a, id)) continue;
        // A filler whose own prerequisite isn't done or queued would only wait: skip it.
        if ((NEEDS[id] ?? []).some((p) => !a.done.has(p) && !live(a, p) && !added.includes(p))) continue;
        if (ensure(a, id, added)) qpAfter += qp(id);
    }
    return qpAfter;
}

// ── Plan ──────────────────────────────────────────────────────────────────────────────────────────────────
const eligible: Acct[] = [];
const reported: string[] = [];
const offRunner: Acct[] = [];
for (const bot of roster) {
    const name: string = bot.name;
    const low = name.toLowerCase();
    if (!/todo-runner\.ts$/.test(bot.script ?? '') || EXCLUDE.has(low) || (bot.args ?? []).join(' ').includes('quest-mule')) continue;
    const a = load(name);
    if (a.done.has('legends')) continue;
    if (swarm.has(low) || skip.has(low)) {
        if (swarm.has(low) || PROMOTE_SKIPPED) offRunner.push(a);
        else reported.push(`${name} (skip-bots, ~${hoursLeft(a).toFixed(0)} h left)`);
        continue;
    }
    eligible.push(a);
}
eligible.sort((x, y) => hoursLeft(x) - hoursLeft(y));
// Active: anything already on a planned (or hand-queued) Legends path. New chains only while under the cap.
const isActive = (a: Acct) => [...LEGENDS_PATH].some((id) => live(a, id));
let active = eligible.filter(isActive).length;
const chosen: Acct[] = [];
for (const a of eligible) {
    if (isActive(a)) chosen.push(a);
    else if (active < MAX_ACTIVE) {
        chosen.push(a);
        active++;
    }
}
/** Accounts with quest and lite services in the compose file (jacklove17 has none: release-1108 stopped on it). */
function composeServices(): Set<string> {
    if (process.env.FLEET_PLANNER_SERVICES !== undefined) return new Set(process.env.FLEET_PLANNER_SERVICES.split(',').filter(Boolean));
    const r = Bun.spawnSync(['docker', 'compose', '-f', 'compose.fleet.yml', 'config', '--services'], { cwd: PILOT });
    return new Set(r.stdout.toString().split('\n').map((s) => s.trim()).filter(Boolean));
}
offRunner.sort((x, y) => hoursLeft(x) - hoursLeft(y));
const promoted: Acct[] = [];
if (PROMOTE && active < MAX_ACTIVE && offRunner.length) {
    const services = composeServices();
    for (const a of offRunner) {
        if (promoted.length >= Math.min(PROMOTE_PER_RUN, MAX_ACTIVE - active)) break;
        const low = a.name.toLowerCase();
        if (!services.has(`quest-${low}`) || !services.has(`lite-${low}`)) {
            reported.push(`${a.name} (no compose service)`);
            continue;
        }
        promoted.push(a);
    }
    // Pairs need two: an odd last one waits for the next run rather than idling on Arrav alone.
    if (promoted.length % 2 && promoted.length > 1 && !chosen.some((c) => pairableLater(c))) promoted.pop();
    for (const a of promoted) chosen.push(a);
    active += promoted.length;
}
for (const a of offRunner) if (!promoted.includes(a)) reported.push(`${a.name} (${swarm.has(a.name.toLowerCase()) ? 'swarm' : 'skip-bots'}, ~${hoursLeft(a).toFixed(0)} h left)`);
/** A runner account still needing Arrav with no partner yet: an odd promotion can pair with it. */
function pairableLater(a: Acct): boolean {
    return !a.done.has('arrav') && !live(a, 'arrav');
}

say(`${NOW_ISO} legends-planner${DRY ? ' (dry)' : ''}: ${eligible.length} runner accounts short of Legends, ${chosen.length} planned (cap ${MAX_ACTIVE})`);
if (promoted.length) say(`  promoting from the swarm: ${promoted.map((a) => a.name).join(', ')}`);
for (const a of chosen) {
    const chain = missingChain(a).filter((q) => q !== 'legends');
    const added: string[] = [];
    const notes: string[] = [];
    planSkills(a, [...chain, 'legends'], added, notes);
    for (const id of SOLO) if (chain.includes(id)) if (!ensure(a, id, added)) notes.push(`${id} used its tries (re-added at most ${READD_MAX}x, ${READD_AFTER_MS / 3600_000} h apart)`);
    const qpAfter = fillers(a, chain, added);
    if (qpAfter < QP_GOAL) notes.push(`only ${qpAfter} QP reachable with the planner's fillers`);
    // Legends only at 107 QP by the planner's count, or once nothing else is left to run (a quest done outside the
    // runner is not counted; the guild guard decides then). Short of it, the guard refuses and a try is spent.
    const othersLive = [...SOLO, 'arrav', 'heroes', ...FILLERS].some((id) => !a.done.has(id) && live(a, id));
    const qpOk = qpDone(a) >= QP_GOAL || !othersLive;
    if (!qpOk && !live(a, 'legends')) notes.push(`Legends held until ${QP_GOAL} QP (now ${qpDone(a)})`);
    if (qpOk && !a.done.has('legends') && !live(a, 'legends') && (!exhausted(a, 'legends') || mayReadd(a, 'legends'))) {
        const it = itemFor('legends', freshId(a, 'legends'));
        a.items.push(it);
        changed.add(a.name);
        added.push(it.questId);
    }
    say(`  ${a.name}: QP ${qpDone(a)}, ~${hoursLeft(a).toFixed(0)} h left${added.length ? ` · queued ${added.join(' ')}` : ''}${notes.length ? ` · ${notes.join('; ')}` : ''}`);
}

// Pairs: Arrav for any two that need it; Heroes for two of opposite gangs whose Heroes prerequisites are done.
const pairable = (a: Acct, quest: string) =>
    !a.done.has(quest) && !live(a, quest) && (!exhausted(a, quest) || NOW - Math.max(0, ...a.items.filter((i) => questForItem(i)?.id === quest).map((i) => Date.parse(a.st[i.questId]?.lastAt ?? '') || 0)) >= READD_AFTER_MS) && a.running !== 'legends';
const heroesReady = (a: Acct) =>
    a.done.has('arrav') && a.gang && ['lostcity', 'arthur', 'dragon'].every((q) => a.done.has(q)) &&
    Object.entries({ ...SKILLS.heroes, ...(a.gang === 'phoenix' ? { magic: 35 } : {}) }).every(([s, l]) => PROLOGUE_TRAINED.has(s) || (a.levels[s] ?? 0) >= l);
function queuePair(quest: 'arrav' | 'heroes', phx: Acct, blk: Acct) {
    for (const [a, gang, partner] of [[phx, 'phoenix', blk], [blk, 'blackarm', phx]] as const) {
        const it = itemFor(quest, freshId(a, quest), { args: [`--gang=${gang}`, `--partner=${partner.name}`], note: `legends planner: ${quest} pair with ${partner.name}` });
        push(a, it, true);
        // A promoted account starts fresh below; only the runner's own accounts need the restart.
        if (!promoted.includes(a)) restart.add(a.name);
    }
    pstate.pairs.push({ quest, a: phx.name, b: blk.name, at: NOW_ISO });
    say(`  PAIR ${quest}: ${phx.name} (phoenix) + ${blk.name} (blackarm) — both queued first and restarted together`);
}
const arravWaiting = chosen.filter((a) => pairable(a, 'arrav'));
for (let i = 0; i + 1 < arravWaiting.length; i += 2) queuePair('arrav', arravWaiting[i]!, arravWaiting[i + 1]!);
if (arravWaiting.length % 2) say(`  ${arravWaiting[arravWaiting.length - 1]!.name}: Arrav waits for a partner`);
const heroesWaiting = chosen.filter((a) => pairable(a, 'heroes') && heroesReady(a));
const phoenixes = heroesWaiting.filter((a) => a.gang === 'phoenix');
const blackarms = heroesWaiting.filter((a) => a.gang === 'blackarm');
for (let i = 0; i < Math.min(phoenixes.length, blackarms.length); i++) queuePair('heroes', phoenixes[i]!, blackarms[i]!);
for (const a of [...phoenixes.slice(blackarms.length), ...blackarms.slice(phoenixes.length)]) say(`  ${a.name}: Heroes ready, waits for a ${a.gang === 'phoenix' ? 'Black Arm' : 'Phoenix'} partner`);
if (reported.length) say(`  not planned (off the runner): ${reported.join(', ')}`);

// ── Write ─────────────────────────────────────────────────────────────────────────────────────────────────
if (!DRY && changed.size) {
    const p = join(BOTS, 'todo.json');
    const day = NOW_ISO.slice(0, 10);
    const bak = join(STATE, `todo.json.bak-planner-${day}`);
    if (!existsSync(bak)) copyFileSync(p, bak);
    // Re-read and merge only our accounts' lists: another writer (fleet-capes) may have touched the file meanwhile.
    const fresh = J<any>(p, null) ?? todoDoc;
    for (const name of changed) {
        const ours = todo[name]!;
        const theirs: any[] = fresh.accounts[name] ?? [];
        const known = new Set(ours.map((i) => i.questId));
        fresh.accounts[name] = [...ours, ...theirs.filter((i) => !known.has(i.questId))];
    }
    writeFileSync(`${p}.tmp-planner`, JSON.stringify(fresh, null, 2));
    renameSync(`${p}.tmp-planner`, p);
}
if (!DRY) {
    pstate.pairs = pstate.pairs.slice(-200);
    writeFileSync(pstatePath, JSON.stringify(pstate, null, 1));
    try {
        appendFileSync(join(STATE, 'legends-planner.log'), log.join('\n') + '\n');
    } catch {
        /* the log is a convenience */
    }
}
// Promotions: off the swarm (one swarm restart for all), off skip-bots, then lite and quest containers up.
const sh = (cmd: string[], cwd?: string) => {
    const r = Bun.spawnSync(cmd, { cwd, stdout: 'pipe', stderr: 'pipe' });
    if (r.exitCode !== 0) say(`  FAILED: ${cmd.join(' ')}: ${r.stderr.toString().slice(0, 200)}`);
    return r.exitCode === 0;
};
if (promoted.length && !DRY) {
    const names = new Set(promoted.map((a) => a.name.toLowerCase()));
    const sp = join(BOTS, 'swarm.json');
    const sw = J<any>(sp, null);
    if (sw && sw.accounts.some((a: any) => names.has(String(a.name).toLowerCase()))) {
        copyFileSync(sp, join(STATE, `swarm.json.bak-planner-${NOW_ISO.slice(0, 10)}`));
        sw.accounts = sw.accounts.filter((a: any) => !names.has(String(a.name).toLowerCase()));
        writeFileSync(`${sp}.tmp-planner`, JSON.stringify(sw, null, 2));
        renameSync(`${sp}.tmp-planner`, sp);
        if (!NO_DOCKER) sh(['docker', 'restart', '-t', '150', 'fleet-swarm-1']);
    }
    const skp = join(STATE, 'skip-bots.txt');
    if (existsSync(skp)) writeFileSync(skp, lines(skp).filter((l) => !names.has(l.toLowerCase())).join('\n') + '\n');
    if (NO_DOCKER) say(`  (would start lite + quest containers: ${[...names].join(', ')})`);
    else {
        for (const n of names) sh(['docker', 'compose', '-f', 'compose.fleet.yml', 'up', '-d', '--timeout', '90', '--no-deps', `lite-${n}`], PILOT);
        await Bun.sleep(30_000);
        for (const n of names) sh(['docker', 'compose', '-f', 'compose.fleet.yml', 'up', '-d', '--timeout', '90', '--no-deps', `quest-${n}`], PILOT);
    }
}
// Restart each pair's containers together (graceful: a quest in progress resumes from its journal stage).
if (restart.size) {
    if (NO_DOCKER) say(`  (would restart: ${[...restart].join(', ')})`);
    else {
        const procs = [...restart].map((n) => Bun.spawn(['docker', 'restart', '-t', '150', `fleet-quest-${n.toLowerCase()}-1`], { stdout: 'ignore', stderr: 'pipe' }));
        const codes = await Promise.all(procs.map((p) => p.exited));
        const bad = [...restart].filter((_, i) => codes[i] !== 0);
        if (bad.length) say(`  RESTART FAILED: ${bad.join(', ')}`);
    }
}
