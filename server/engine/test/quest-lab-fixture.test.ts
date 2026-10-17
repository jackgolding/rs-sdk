import { describe, expect, test } from 'bun:test';

const lib = await import('../tools/server/quest-lab-fixture-lib.ts');
const { parseFixture, fileKeyFor, assertFreshAccount, validateFixture } = lib;

const validFixture = {
  schemaVersion: 1,
  questId: 'cook',
  position: { x: 3208, z: 3213, level: 0 },
  skills: 'maxed' as const,
  tutorial: true as const,
  bank: [{ name: 'egg', count: 1 }, { name: 'bucket_milk', count: 1 }, { name: 'pot_flour', count: 1 }],
  worn: [],
  varps: { cookquest: 0 },
  target: { varp: 'cookquest', unstarted: 0 },
};

describe('fixture schema', () => {
  test('accepts a well-formed fixture and normalises the account key', () => {
    const fixture = parseFixture(JSON.stringify(validFixture));
    expect(fixture.questId).toBe('cook');
    expect(fixture.bank).toHaveLength(3);
    expect(fileKeyFor('QLCookDev')).toBe('qlcookdev');
    expect(fileKeyFor('ql-cook dev')).toBe('ql_cook_dev');
  });

  test('rejects malformed fixtures instead of guessing', () => {
    const bad = [
      { ...validFixture, schemaVersion: 2 },
      { ...validFixture, questId: '' },
      { ...validFixture, position: { x: 1.5, z: 3213, level: 0 } },
      { ...validFixture, position: { x: 3208, z: 3213, level: -1 } },
      { ...validFixture, skills: 'everything' },
      { ...validFixture, tutorial: false },
      { ...validFixture, bank: [{ name: 'egg', count: 0 }] },
      { ...validFixture, bank: [{ name: '', count: 1 }] },
      { ...validFixture, worn: [{ name: 'rune scimitar', slot: 99 }] },
      { ...validFixture, varps: { cookquest: -1 } },
      { ...validFixture, varps: { cookquest: 1.5 } },
      { ...validFixture, target: undefined },
      { ...validFixture, target: { varp: 'cookquest', unstarted: 1.5 } },
      { ...validFixture, target: { varp: '', unstarted: 0 } },
      { ...validFixture, bank: 'lots' },
    ];
    for (const fixture of bad) {
      expect(() => validateFixture(fixture as never)).toThrow();
    }
  });

  test('rejects non-JSON input and duplicate bank entries', () => {
    expect(() => parseFixture('not json')).toThrow();
    expect(() => parseFixture(JSON.stringify({ ...validFixture, bank: [{ name: 'egg', count: 1 }, { name: 'egg', count: 2 }] }))).toThrow(/duplicate/i);
  });
});

describe('fresh-only safety guards', () => {
  const clean = { username: 'qlcookdev', positions: [] as string[], savExists: false, checkpointOwners: [] as string[] };

  test('accepts a genuinely fresh identity', () => {
    expect(() => assertFreshAccount(clean)).not.toThrow();
  });

  test('refuses a username outside the reserved fresh namespace', () => {
    for (const username of ['Jackpoo3', 'jacklove2', 'qlab', 'ql' + 'x'.repeat(11), 'test123']) {
      expect(() => assertFreshAccount({ ...clean, username })).toThrow(/namespace/i);
    }
  });

  test('refuses when the character is online — presence must be proven, not assumed', () => {
    expect(() => assertFreshAccount({ ...clean, positions: ['QLCookDev'] })).toThrow(/online/i);
  });

  test('fails closed when presence could not be determined at all', () => {
    expect(() => assertFreshAccount({ ...clean, positions: null as never })).toThrow(/presence|could not/i);
  });

  test('refuses when a save file or a checkpoint row already exists', () => {
    expect(() => assertFreshAccount({ ...clean, savExists: true })).toThrow(/save file/i);
    expect(() => assertFreshAccount({ ...clean, checkpointOwners: ['qlcookdev'] })).toThrow(/checkpoint/i);
  });

  test('checkpoint comparison is case-insensitive so an existing row is never missed', () => {
    expect(() => assertFreshAccount({ ...clean, checkpointOwners: ['QLCookDev'] })).toThrow(/checkpoint/i);
  });
});
