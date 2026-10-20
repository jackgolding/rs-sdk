#!/usr/bin/env bun
/**
 * Render and validate a declared state machine.
 *
 *   bun sdk/fsm-cli.ts bots/quests/bank-report.graph.ts          # mermaid → stdout
 *   bun sdk/fsm-cli.ts bots/quests/bank-report.graph.ts --write   # …and a .mmd beside it
 *   bun sdk/fsm-cli.ts bots/quests/bank-report.graph.ts --check   # exit 1 if invalid
 *
 * `--check` is the CI hook: a graph with an unreachable state, a dangling edge
 * or a dead end fails the build instead of surfacing as a bot that walks in
 * circles. Graphs are data, so this needs no game, no gateway and no account.
 */
import { existsSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { toMermaid, validateGraph, type GraphSpec } from './fsm';

const argv = process.argv.slice(2);
const target = argv.find(arg => !arg.startsWith('--'));
if (!target) {
  console.error('usage: fsm-cli.ts <graph-module.ts> [--check] [--write] [--json]');
  process.exit(2);
}
const flags = new Set(argv.filter(arg => arg.startsWith('--')).map(arg => arg.slice(2)));
const path = resolve(target);
if (!existsSync(path)) {
  console.error(`fsm-cli: no such file: ${path}`);
  process.exit(2);
}

const module_ = (await import(path)) as { graph?: GraphSpec<unknown>; default?: GraphSpec<unknown> };
const graph = module_.graph ?? module_.default;
if (!graph || typeof graph !== 'object' || !('states' in graph)) {
  console.error(`fsm-cli: ${target} must export a graph (named \`graph\` or default) built with defineGraph()`);
  process.exit(2);
}

const problems = validateGraph(graph);
if (flags.has('json')) {
  console.log(JSON.stringify({ graph: graph.id, problems, valid: problems.length === 0, states: Object.keys(graph.states) }, null, 2));
} else if (problems.length) {
  console.error(`invalid graph '${graph.id}':`);
  for (const problem of problems) console.error(`  · ${problem}`);
} else {
  const diagram = toMermaid(graph);
  console.log(diagram);
  if (flags.has('write')) {
    const out = path.replace(/\.ts$/, '') + '.mmd';
    writeFileSync(out, diagram + '\n');
    console.error(`wrote ${out}`);
  }
}

if (flags.has('check') && problems.length) process.exit(1);
if (problems.length) process.exit(1);
process.exit(0);
