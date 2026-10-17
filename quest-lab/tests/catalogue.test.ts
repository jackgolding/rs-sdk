import { beforeEach, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const repoRoot = resolve(import.meta.dir, '../..');
const catalogue = resolve(repoRoot, 'quest-lab/catalogue.ts');
const QUESTS_RS2 = 'server/content/scripts/general/scripts/quests.rs2';
const QUESTLIST_IF = 'server/content/scripts/player/interfaces/questlist.if';

const read = (rel: string) => readFileSync(resolve(repoRoot, rel), 'utf-8');
let mod: typeof import('../catalogue') | undefined;

beforeEach(async () => { mod = await import(catalogue); });

test('registers every quest-list entry exactly once, with duplicates grouped', () => {
  const entries = mod!.parseQuestList(read(QUESTS_RS2));
  const ids = entries.map(e => e.id);
  expect(new Set(ids).size).toBe(68);
  // 70 registration calls; the two extras are alternate branches of existing entries.
  expect(entries.reduce((n, e) => n + e.registrations.length, 0)).toBe(70);
  const shield = entries.find(e => e.id === 'blackarmgang')!;
  expect(shield.registrations.length).toBe(2);
  const upass = entries.find(e => e.id === 'upass')!;
  expect(upass.registrations.length).toBe(2);
});

test('resolves every entry to a UI section and a real quest source directory', () => {
  const ui = read(QUESTLIST_IF);
  for (const entry of mod!.buildCatalogue(repoRoot)) {
    expect(ui).toContain(`[${entry.id}]`);
    expect(entry.sourceDir).toBeTruthy();
    expect(entry.sourceDir.startsWith('server/content/scripts/quests/quest_')).toBe(true);
    // Unresolved button ids must be declared, never invented as a positive number.
    if (entry.journalButtonId === null) {
      expect(entry.blockers.some(b => b.includes('button component id'))).toBe(true);
    } else {
      expect(entry.journalButtonId).toBeGreaterThan(0);
    }
  }
  // fortress is the quest-list id for Black Knights' Fortress, whose dir is not quest_fortress
  expect(mod!.buildCatalogue(repoRoot).find(e => e.id === 'fortress')!.sourceDir)
    .toBe('server/content/scripts/quests/quest_blackknight');
});

test('keeps nested and computed completion expressions intact instead of truncating them', () => {
  const entries = mod!.parseQuestList(read(QUESTS_RS2));
  const elem = entries.find(e => e.id === 'elemental_workshop')!;
  expect(elem.registrations).toHaveLength(1);
  expect(elem.registrations[0]!.completionExpression).toBe('sub(pow(2, ^elemental_workshop_complete), 1)');
  const itexam = entries.find(e => e.id === 'itexam')!;
  expect(itexam.registrations[0]!.progressExpression).toBe('~itexam_progress');
  // multi-arg nesting must not be split into extra registrations
  expect(itexam.registrations).toHaveLength(1);
});

test('does not include miniquests or non-quest-list activity', () => {
  const ids = mod!.parseQuestList(read(QUESTS_RS2)).map(e => e.id);
  expect(ids).not.toContain('barcrawl');
});

test('never reports a quest as playable from source presence alone', () => {
  for (const entry of mod!.parseQuestList(read(QUESTS_RS2))) {
    expect(entry.reviewStatus).toBe('unreviewed');
    expect(entry.runtimeVerified).toBe(false);
    expect(Array.isArray(entry.blockers)).toBe(true);
  }
});

test('rejects unknown, self-referential and cyclic prerequisite mappings', () => {
  expect(() => mod!.validateDependencies({ hero: ['nope'] }, ['hero'])).toThrow(/unknown/);
  expect(() => mod!.validateDependencies({ hero: ['hero'] }, ['hero'])).toThrow(/self/);
  expect(() => mod!.validateDependencies({ a: ['b'], b: ['a'] }, ['a', 'b'])).toThrow(/cycle/);
});

test('titles come from questlist.if, not from the component id', () => {
  const entries = mod!.parseQuestList(read(QUESTS_RS2));
  mod!.resolveSourceDirs(repoRoot, entries);
  mod!.resolveTitles(repoRoot, entries);
  const cook = entries.find(e => e.id === 'cook')!;
  // questlist.if shows the UI name; the journal handler's own title differs
  expect(cook.title).toBe("Cook's Assistant");
  const fortress = entries.find(e => e.id === 'fortress')!;
  expect(fortress.title).toBe("Black Knight's Fortress");
});

test('orders reviewed dependencies so prerequisites precede dependants', () => {
  const order = mod!.orderByDependencies({ hero: ['zanaris', 'dragonquest'], zanaris: [], dragonquest: [] }, ['hero', 'zanaris', 'dragonquest']);
  expect(order.indexOf('zanaris')).toBeLessThan(order.indexOf('hero'));
  expect(order.indexOf('dragonquest')).toBeLessThan(order.indexOf('hero'));
  expect(order.length).toBe(3);
});
