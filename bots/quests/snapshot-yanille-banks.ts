#!/usr/bin/env bun
/**
 * Yanille-only bank snapshot (no walk). Prefer snapshot-nearest-banks.ts to
 * walk each account along its job bank path.
 *
 *   bun bots/quests/snapshot-yanille-banks.ts Bot1 Bot2 ...
 */
const rest = process.argv.slice(2);
process.argv = [process.argv[0]!, process.argv[1]!, '--yanille-only', ...rest];
await import('./snapshot-nearest-banks.ts');
