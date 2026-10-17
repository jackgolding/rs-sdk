/**
 * Pure validation and safety guards for quest fixtures.
 *
 * No engine imports: this module is unit-testable on its own. All engine
 * interaction lives in quest-lab-fixture.ts.
 *
 * Safety model: fixtures are FRESH-ONLY. A fixture may only be built for a
 * username that is contained entirely inside the reserved `ql…` namespace, is
 * provably not online, has no save file, and has no Grand Exchange checkpoint
 * row. The checkpoint check matters most: `PlayerLoading.load` prefers the
 * market.sqlite row over the `.sav`, so writing a save file for an account that
 * already has a row produces work that the next login silently discards.
 */

/** Reserved namespace for disposable quest-lab fixtures. */
export const FRESH_ACCOUNT = /^ql[a-z0-9_]{3,10}$/;

/** Worn-equipment slots (server/content/scripts/player/scripts/equip.constant). */
export const WORN_SLOTS = 12;

/** Upper bound for a single bank stack. */
export const MAX_BANK_STACK = 2_147_483_647;

/** Highest plane index the engine stores. */
export const MAX_LEVEL = 3;

export interface BankEntry { name: string; count: number }
export interface WornEntry { name: string; slot: number }
export interface FixturePosition { x: number; z: number; level: number }

export interface Fixture {
  schemaVersion: 1;
  questId: string;
  position: FixturePosition;
  skills: 'maxed';
  tutorial: true;
  bank: BankEntry[];
  worn: WornEntry[];
  varps: Record<string, number>;
  target: { varp: string; unstarted: number };
}

/** Save filename the engine derives from a username (lowercase, non-alnum -> _). */
export function fileKeyFor(username: string): string {
  return username.toLowerCase().replace(/[^a-z0-9]/g, '_');
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireInteger(value: unknown, field: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new Error(`${field} must be an integer, got ${JSON.stringify(value)}`);
  }
  if (value < min || value > max) throw new Error(`${field} must be ${min}..${max}, got ${value}`);
  return value;
}

function requireName(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${field} must be a non-empty name`);
  }
  return value.trim();
}

/** Validate a parsed fixture. Throws with a specific reason on any problem. */
export function validateFixture(input: unknown): Fixture {
  if (!isPlainObject(input)) throw new Error('fixture must be a JSON object');
  const f = input as Record<string, unknown>;

  if (f.schemaVersion !== 1) throw new Error(`schemaVersion must be 1, got ${JSON.stringify(f.schemaVersion)}`);
  const questId = requireName(f.questId, 'questId');

  if (!isPlainObject(f.position)) throw new Error('position must be an object');
  const position: FixturePosition = {
    x: requireInteger(f.position.x, 'position.x', 0, 16_383),
    z: requireInteger(f.position.z, 'position.z', 0, 16_383),
    level: requireInteger(f.position.level, 'position.level', 0, MAX_LEVEL),
  };

  // Maxed-only for now: minimum-level accounts are a separate, untested claim.
  if (f.skills !== 'maxed') throw new Error(`skills must be "maxed", got ${JSON.stringify(f.skills)}`);
  if (f.tutorial !== true) throw new Error('tutorial must be true: fixtures start past Tutorial Island');

  if (!Array.isArray(f.bank)) throw new Error('bank must be an array');
  const seenBank = new Set<string>();
  const bank: BankEntry[] = f.bank.map((raw, i) => {
    if (!isPlainObject(raw)) throw new Error(`bank[${i}] must be an object`);
    const name = requireName(raw.name, `bank[${i}].name`);
    const count = requireInteger(raw.count, `bank[${i}].count`, 1, MAX_BANK_STACK);
    if (seenBank.has(name)) throw new Error(`duplicate bank entry '${name}'`);
    seenBank.add(name);
    return { name, count };
  });

  if (!Array.isArray(f.worn)) throw new Error('worn must be an array');
  const worn: WornEntry[] = f.worn.map((raw, i) => {
    if (!isPlainObject(raw)) throw new Error(`worn[${i}] must be an object`);
    return {
      name: requireName(raw.name, `worn[${i}].name`),
      slot: requireInteger(raw.slot, `worn[${i}].slot`, 0, WORN_SLOTS - 1),
    };
  });

  if (!isPlainObject(f.varps)) throw new Error('varps must be an object');
  const varps: Record<string, number> = {};
  for (const [name, value] of Object.entries(f.varps)) {
    requireName(name, 'varps key');
    varps[name] = requireInteger(value, `varps.${name}`, 0, MAX_BANK_STACK);
  }

  if (!isPlainObject(f.target)) throw new Error('target must be an object declaring the unstarted quest state');
  const target = {
    varp: requireName(f.target.varp, 'target.varp'),
    unstarted: requireInteger(f.target.unstarted, 'target.unstarted', 0, MAX_BANK_STACK),
  };
  if (varps[target.varp] !== undefined && varps[target.varp] !== target.unstarted) {
    throw new Error(`target.varp '${target.varp}' is ${varps[target.varp]} in varps but ${target.unstarted} in target`);
  }

  return { schemaVersion: 1, questId, position, skills: 'maxed', tutorial: true, bank, worn, varps, target };
}

/** Parse and validate fixture JSON text. */
export function parseFixture(text: string): Fixture {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new Error(`fixture is not valid JSON: ${(error as Error).message}`);
  }
  return validateFixture(parsed);
}

export interface FreshAccountObservation {
  username: string;
  /** Names currently online, or null when presence could not be determined. */
  positions: readonly string[] | null;
  savExists: boolean;
  checkpointOwners: readonly string[];
}

/**
 * Fail-closed guards. Throws rather than warning: a fixture written against the
 * wrong identity is worse than no fixture at all.
 */
export function assertFreshAccount(observation: FreshAccountObservation): void {
  const key = fileKeyFor(observation.username);

  if (!FRESH_ACCOUNT.test(key)) {
    throw new Error(
      `'${observation.username}' is outside the reserved fixture namespace: ` +
      `fixtures must be named ql… (3-10 chars after ql) so live accounts can never be targeted`,
    );
  }

  if (observation.positions === null || observation.positions === undefined) {
    throw new Error(`could not determine presence for '${key}': the engine did not answer /playerpositions`);
  }
  const online = observation.positions.some(name => fileKeyFor(name) === key);
  if (online) throw new Error(`'${key}' is online: fixtures are only built for offline accounts`);

  if (observation.savExists) throw new Error(`a save file already exists for '${key}': fixtures are fresh-only`);

  if (observation.checkpointOwners.some(owner => fileKeyFor(owner) === key)) {
    throw new Error(
      `a Grand Exchange checkpoint row already exists for '${key}': the engine would prefer it over ` +
      `any save file written here, so the fixture would be silently discarded at login`,
    );
  }
}
