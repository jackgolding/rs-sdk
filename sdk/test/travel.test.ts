import { describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { analyzeSource } from '../travel-check';
import { formatGaps, groupGaps, readTravelGaps, recordTravelGap } from '../travel';

const tmpFile = (name = 'gaps.jsonl') => join(mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), 'travel-')), name);
const tile = (x: number, z: number, level = 0) => ({ x, z, level });

describe('gap registry', () => {
  test('records append-only JSONL and reads back', () => {
    const path = tmpFile();
    recordTravelGap({ kind: 'blocked', from: tile(3102, 3161), to: tile(3115, 3160), script: 'bots/quests/a.ts', detail: 'no progress' }, path);
    recordTravelGap({ kind: 'no-waypoints', from: tile(1, 2), to: tile(3, 4), script: 'bots/quests/b.ts' }, path);

    const gaps = readTravelGaps(path);
    expect(gaps).toHaveLength(2);
    expect(gaps[0]!.kind).toBe('blocked');
    expect(gaps[0]!.script).toBe('bots/quests/a.ts');
    expect(gaps[0]!.at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    // Append-only: the first line is still there, unchanged.
    expect(readFileSync(path, 'utf-8').trim().split('\n')).toHaveLength(2);
  });

  test('a missing registry is empty, not an error', () => {
    expect(readTravelGaps(tmpFile('absent.jsonl'))).toEqual([]);
  });

  test('recording never throws when the path is unwritable', () => {
    // A directory where the file should be: append fails, and must be swallowed.
    const path = tmpFile('dir-in-the-way');
    expect(() => recordTravelGap({ kind: 'blocked', from: tile(0, 0), to: tile(1, 1), script: 'x' }, path)).not.toThrow();
  });

  test('torn lines and foreign records are skipped', () => {
    const path = tmpFile();
    writeFileSync(path, ['{"schemaVersion":1,"kind":"blocked","from":{"x":1,"z":2,"level":0},"to":{"x":3,"z":4,"level":0},"script":"s","at":"2026-01-01T00:00:00.000Z"}', '{"broken":', '{"schemaVersion":2,"from":{},"to":{}}'].join('\n'));
    expect(readTravelGaps(path)).toHaveLength(1);
  });
});

describe('gap grouping', () => {
  test('nearby hits of the same journey collapse into one work item', () => {
    const gaps = [
      { schemaVersion: 1 as const, at: '2026-01-01T00:00:00.000Z', kind: 'blocked' as const, from: tile(3102, 3161), to: tile(3105, 3161), script: 'a.ts' },
      { schemaVersion: 1 as const, at: '2026-01-01T00:01:00.000Z', kind: 'blocked' as const, from: tile(3103, 3161), to: tile(3105, 3161), script: 'b.ts' },
      { schemaVersion: 1 as const, at: '2026-01-01T00:02:00.000Z', kind: 'arrival-short' as const, from: tile(3200, 3200), to: tile(3210, 3210), script: 'c.ts' },
    ];
    const groups = groupGaps(gaps);
    expect(groups).toHaveLength(2);
    expect(groups[0]!.count).toBe(2);
    expect(groups[0]!.scripts).toEqual(['a.ts', 'b.ts']);
    expect(groups[0]!.lastAt).toBe('2026-01-01T00:01:00.000Z');
  });

  test('formatting names the coordinates an operator needs', () => {
    const groups = groupGaps([
      { schemaVersion: 1 as const, at: '2026-01-01T00:00:00.000Z', kind: 'blocked' as const, from: tile(3102, 3161), to: tile(3105, 3161), script: 'a.ts', detail: 'no progress' },
    ]);
    const text = formatGaps(groups);
    expect(text).toContain('3102,3161');
    expect(text).toContain('blocked');
    expect(text).toContain('no progress');
  });

  test('an empty registry says so', () => {
    expect(formatGaps([])).toContain('no travel gaps');
  });
});

describe('source analysis (the travel lint)', () => {
  test('a script that plans with the client and has no mover travels blind', () => {
    const source = `
      const p = await bot.walkTo(3200, 3200, 3);
      await sdk.sendWalk(3210, 3210);
    `;
    const analysis = analyzeSource(source);
    expect(analysis.walkToCalls).toBe(1);
    expect(analysis.sendWalkCalls).toBe(1);
    expect(analysis.usesSharedMover).toBe(false);
    expect(analysis.travelsBlind).toBe(true);
  });

  test('importing the shared walker clears the flag', () => {
    const source = `
      import { walkRoute } from './walk-route';
      await bot.walkTo(3200, 3200, 3);
    `;
    const analysis = analyzeSource(source);
    expect(analysis.usesSharedMover).toBe(true);
    expect(analysis.moverImports).toEqual(['./walk-route']);
    expect(analysis.travelsBlind).toBe(false);
  });

  test('route.ts and movement.ts count as shared movers too', () => {
    expect(analyzeSource("import { findDoorFreeRoute } from './route';\nbot.walkTo(1,1);").usesSharedMover).toBe(true);
    expect(analyzeSource("import { hopSend } from './movement';\nsdk.sendWalk(1,1);").usesSharedMover).toBe(true);
  });

  test('a script that never moves is not flagged', () => {
    expect(analyzeSource('const x = 1;').travelsBlind).toBe(false);
  });

  test('commented-out movement does not count', () => {
    const analysis = analyzeSource('// await bot.walkTo(1, 1, 3);\nconst y = 2;');
    expect(analysis.walkToCalls).toBe(0);
    expect(analysis.travelsBlind).toBe(false);
  });
});
