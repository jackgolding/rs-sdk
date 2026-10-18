/**
 * Canonical quest catalogue, derived from the pinned server content.
 *
 * Source of truth: the `[proc,update_questlist]` block in
 * server/content/scripts/general/scripts/quests.rs2 plus each quest's
 * `[if_button,questlist:<id>]` journal handler.
 *
 * This file records what the content DEFINES. It never claims a quest is
 * playable: every entry starts `reviewed: false / runtimeVerified: false`
 * and carries its own blockers.
 *
 *   bun quest-lab/catalogue.ts --check   # fail if catalogue.json is stale
 *   bun quest-lab/catalogue.ts --write   # regenerate catalogue.json
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

export type ReviewStatus = 'unreviewed' | 'reviewed';

export interface QuestRegistration {
  /** Raw call text, e.g. `~send_quest_progress_colour(questlist:cook, %cookquest, ^cook_complete);` */
  raw: string;
  /** Progress varp / computed-progress expression. */
  progressExpression: string;
  /** Completion predicate, kept as written including nested calls. */
  completionExpression: string;
}

export interface QuestEntry {
  /** Quest-list component id, e.g. `cook`, `fortress`. */
  id: string;
  /**
   * Client-visible quest-list button text (questlist.if `text=`). Scripts click
   * the button by this label rather than a hardcoded component id, so the same
   * code works across content revisions.
   */
  name: string;
  /** The journal body's own heading, e.g. "The Cook's Quest". Verifies identity. */
  journalTitle: string | null;
  /** Quest source directory, resolved from the journal handler. */
  sourceDir: string;
  /** The journal handler file that registered this quest-list id. */
  journalFile: string | null;
  registrations: QuestRegistration[];
  /** Existing primary bot script, or null when none is written yet. */
  primaryScript: string | null;
  reviewStatus: ReviewStatus;
  runtimeVerified: boolean;
  blockers: string[];
}

const QUESTS_RS2 = 'server/content/scripts/general/scripts/quests.rs2';
const QUESTLIST_IF = 'server/content/scripts/player/interfaces/questlist.if';
const QUESTS_ROOT = 'server/content/scripts/quests';
const BOTS_QUESTS = 'bots/quests';

/** Primary quest scripts that already exist (adapt, do not trust). */
const KNOWN_PRIMARY_SCRIPTS: Record<string, string> = {
  fortress: 'black-knights-fortress',
  death: 'death-plateau',
  doric: 'dorics-quest',
  druid: 'druidic-ritual',
  gobdip: 'goblin-diplomacy',
  zanaris: 'lost-city',
  hunt: 'pirates-treasure',
  romeojuliet: 'romeo-and-juliet',
  runemysteries: 'rune-mysteries',
  sheep: 'sheep-shearer',
  troll: 'troll-stronghold',
  vampire: 'vampire-slayer',
  ball: 'witchs-house',
  cook: 'cooks-assistant',
  hetty: 'witchs-potion',
  priestperil: 'priest-in-peril',
};

/**
 * Split a call's argument list on top-level commas only, so nested calls
 * such as `sub(pow(2, ^elemental_workshop_complete), 1)` stay intact.
 */
export function splitTopLevelArgs(text: string): string[] {
  const args: string[] = [];
  let depth = 0;
  let current = '';
  for (const ch of text) {
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    if (ch === ',' && depth === 0) {
      args.push(current.trim());
      current = '';
      continue;
    }
    current += ch;
  }
  if (current.trim()) args.push(current.trim());
  return args;
}

/** Extract every balanced `...(...)` argument list following `marker`. */
function balancedCalls(source: string, marker: string): string[] {
  const found: string[] = [];
  let from = 0;
  for (;;) {
    const at = source.indexOf(marker, from);
    if (at === -1) break;
    const open = source.indexOf('(', at + marker.length);
    if (open === -1) break;
    let depth = 0;
    let end = -1;
    for (let i = open; i < source.length; i++) {
      const ch = source[i];
      if (ch === '(') depth++;
      else if (ch === ')') {
        depth--;
        if (depth === 0) { end = i; break; }
      }
    }
    if (end === -1) break;
    found.push(source.slice(open + 1, end));
    from = end + 1;
  }
  return found;
}

/** Parse the quest-list registrations out of quests.rs2. */
export function parseQuestList(rs2Source: string): QuestEntry[] {
  const procAt = rs2Source.indexOf('[proc,update_questlist]');
  if (procAt === -1) throw new Error('quests.rs2: [proc,update_questlist] not found');
  const body = rs2Source.slice(procAt);

  const byId = new Map<string, QuestEntry>();
  for (const args of balancedCalls(body, 'send_quest_progress_colour')) {
    const parts = splitTopLevelArgs(args);
    if (parts.length < 3) continue;
    const [component, progressExpression, completionExpression] = parts as [string, string, string];
    const match = /^questlist:([a-z_]+)$/.exec(component.trim());
    if (!match) continue; // not a quest-list entry
    const id = match[1]!;
    const registration: QuestRegistration = {
      raw: `~send_quest_progress_colour(${args});`,
      progressExpression: progressExpression.trim(),
      completionExpression: completionExpression.trim(),
    };
    const existing = byId.get(id);
    if (existing) existing.registrations.push(registration);
    else {
      byId.set(id, {
        id,
        name: id,
        journalTitle: null,
        sourceDir: '',
        journalFile: null,
        registrations: [registration],
        primaryScript: null,
        reviewStatus: 'unreviewed',
        runtimeVerified: false,
        blockers: [],
      });
    }
  }

  // Alternate branches (Shield of Arrav gangs, Underground Pass start bit) are
  // the only entries that legitimately carry more than one registration.
  for (const entry of byId.values()) {
    if (entry.registrations.length > 1) {
      entry.blockers.push(`alternate completion branches: ${entry.registrations.length}`);
    }
  }

  return [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * Read a journal handler's own heading. Some handlers pass the title inline
 * (`~quest_journal("The Cook's Quest", $text)`), others assign it to a string
 * variable first (`def_string $n = "Heroes' Quest"; ~quest_journal($n, $x)`).
 */
export function parseJournalTitle(handlerSource: string): string | null {
  const call = /~quest_journal\(\s*(?:"([^"]+)"|\$(\w+))\s*,/.exec(handlerSource);
  if (!call) return null;
  if (call[1]) return call[1];
  const variable = call[2]!;
  const assigned = new RegExp(`def_string\\s+\\$${variable}\\s*=\\s*"([^"]+)"`).exec(handlerSource);
  return assigned?.[1] ?? null;
}

/** Map `questlist:<id>` -> `server/content/scripts/quests/<dir>` from journal handlers. */
export function resolveSourceDirs(repoRoot: string, entries: QuestEntry[]): void {
  const questsRoot = resolve(repoRoot, QUESTS_ROOT);
  const byId = new Map<string, { dir: string; file: string; title: string | null }>();
  for (const dir of readdirSync(questsRoot)) {
    const scriptsDir = join(questsRoot, dir, 'scripts');
    if (!existsSync(scriptsDir)) continue;
    for (const file of readdirSync(scriptsDir)) {
      if (!file.endsWith('.rs2')) continue;
      const rel = `${QUESTS_ROOT}/${dir}/scripts/${file}`;
      const source = readFileSync(join(scriptsDir, file), 'utf-8');
      for (const match of source.matchAll(/\[if_button,questlist:([a-z_]+)\]/g)) {
        const id = match[1]!;
        const previous = byId.get(id);
        if (previous && previous.dir !== rel.slice(0, previous.dir.length)) {
          throw new Error(`quest-list id '${id}' claimed by both ${previous.dir} and ${rel}`);
        }
        const title = parseJournalTitle(source);
        byId.set(id, { dir: `${QUESTS_ROOT}/${dir}`, file: rel, title });
      }
    }
  }
  for (const entry of entries) {
    const found = byId.get(entry.id);
    if (found) {
      entry.sourceDir = found.dir;
      entry.journalFile = found.file;
      entry.journalTitle = found.title;
    } else {
      entry.blockers.push('no [if_button,questlist:<id>] journal handler found');
    }
  }
}

/** Titles come from questlist.if section bodies. */
export function resolveTitles(repoRoot: string, entries: QuestEntry[]): void {
  const ui = readFileSync(resolve(repoRoot, QUESTLIST_IF), 'utf-8');
  const sections = new Map<string, string>();
  // questlist.if `text=` is what the client exposes as the clickable option.
  const parts = ui.split(/^\[([a-z0-9_]+)\]\s*$/m);
  for (let i = 1; i < parts.length; i += 2) {
    const id = parts[i]!;
    const bodyText = parts[i + 1] ?? '';
    const named = /\ntext=(.+)/.exec(bodyText)?.[1] ?? /\noption=(.+)/.exec(bodyText)?.[1];
    if (named) sections.set(id, named.trim());
  }
  for (const entry of entries) {
    const name = sections.get(entry.id);
    if (name) entry.name = name;
    else entry.blockers.push('no questlist.if UI section found');
    if (!entry.journalTitle) entry.blockers.push('journal heading not parsed from handler');
  }
}

/** Record which entries already have a primary script, and which do not. */
export function resolvePrimaryScripts(repoRoot: string, entries: QuestEntry[]): void {
  for (const entry of entries) {
    const name = KNOWN_PRIMARY_SCRIPTS[entry.id];
    const rel = name ? `${BOTS_QUESTS}/${name}.ts` : null;
    if (rel && existsSync(resolve(repoRoot, rel))) {
      entry.primaryScript = rel;
      entry.blockers.push('existing script needs completion-predicate audit');
    } else {
      entry.primaryScript = null;
    }
  }
}

/** Build the full catalogue from the pinned content. */
export function buildCatalogue(repoRoot: string): QuestEntry[] {
  const entries = parseQuestList(readFileSync(resolve(repoRoot, QUESTS_RS2), 'utf-8'));
  resolveSourceDirs(repoRoot, entries);
  resolveTitles(repoRoot, entries);
  resolvePrimaryScripts(repoRoot, entries);
  for (const entry of entries) {
    if (!entry.primaryScript) entry.blockers.push('no primary quest script yet');
    entry.blockers.push('no reviewed manifest (prerequisites/items/checkpoints)');
  }
  return entries;
}

/**
 * Validate a REVIEWED prerequisite mapping. Unknown, self-referential and
 * cyclic edges are rejected rather than guessed at.
 */
export function validateDependencies(
  deps: Record<string, string[]>,
  known: Iterable<string>,
): void {
  const knownSet = new Set(known);
  for (const [quest, requires] of Object.entries(deps)) {
    for (const dep of requires) {
      if (dep === quest) throw new Error(`self dependency: ${quest}`);
      if (!knownSet.has(dep)) throw new Error(`unknown dependency '${dep}' required by '${quest}'`);
    }
  }
  orderByDependencies(deps, knownSet);
}

/** Deterministic topological order: prerequisites before dependants. */
export function orderByDependencies(
  deps: Record<string, string[]>,
  known: Iterable<string>,
): string[] {
  const nodes = [...known].sort();
  const order: string[] = [];
  const state = new Map<string, 'visiting' | 'done'>();
  const visit = (node: string, stack: string[]): void => {
    const current = state.get(node);
    if (current === 'done') return;
    if (current === 'visiting') throw new Error(`dependency cycle: ${[...stack, node].join(' -> ')}`);
    state.set(node, 'visiting');
    for (const dep of (deps[node] ?? []).slice().sort()) visit(dep, [...stack, node]);
    state.set(node, 'done');
    order.push(node);
  };
  for (const node of nodes) visit(node, []);
  return order;
}

// ── CLI ─────────────────────────────────────────────────────────────────────

if (import.meta.main) {
  const repoRoot = resolve(import.meta.dir, '..');
  const outPath = resolve(repoRoot, 'quest-lab/catalogue.json');
  const serialized = JSON.stringify(buildCatalogue(repoRoot), null, 2) + '\n';
  if (process.argv.includes('--write')) {
    writeFileSync(outPath, serialized);
    const entries = JSON.parse(serialized) as QuestEntry[];
    console.log(`wrote ${outPath}: ${entries.length} quest-list entries`);
  } else {
    const current = existsSync(outPath) ? readFileSync(outPath, 'utf-8') : '';
    if (current !== serialized) {
      console.error('catalogue.json is stale — run: bun quest-lab/catalogue.ts --write');
      process.exit(1);
    }
    console.log('catalogue.json is current');
  }
  process.exit(0);
}
