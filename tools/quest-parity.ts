#!/usr/bin/env bun
/**
 * Quest parity — how far has dev drifted from prod?
 *
 *   bun tools/quest-parity.ts --dev ~/rs-sdk-offline --prod ~/rs-sdk
 *   bun tools/quest-parity.ts --dev … --prod … --only 'cook|cannon|viking'
 *   bun tools/quest-parity.ts --dev … --prod … --json --strict
 *
 * Why: quest scripts get fixed in the place the failure showed up. Dwarf Cannon
 * and Fremennik Trials were hammered on in prod while the same quests were being
 * rewritten in dev, and nothing in either tree said so. Without a parity check,
 * "the script works" is a statement about one checkout, and a merge silently
 * reverts the other side's fixes.
 *
 * Classification per script:
 *   same       identical bytes — nothing to decide
 *   dev-only   exists in dev, not in prod (unmerged work)
 *   prod-only  exists in prod, not in dev (a fix dev never received - the dangerous one)
 *   differs    both sides changed it; needs a real reconciliation, not a copy
 *
 * Exit codes: 0 clean · 1 divergence found (with --strict) · 2 usage/IO error.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';

type Status = 'same' | 'dev-only' | 'prod-only' | 'differs';

interface Entry {
  script: string;
  status: Status;
  devLines?: number;
  prodLines?: number;
  /** Number of added / removed lines, when a diff could be computed. */
  added?: number;
  removed?: number;
}

interface Parsed {
  dev: string;
  prod: string;
  dir: string;
  only: RegExp | null;
  json: boolean;
  strict: boolean;
  show: string | null;
}

function parse(argv: string[]): Parsed {
  const flags = new Map<string, string>();
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (!arg.startsWith('--')) throw new Error(`unexpected argument: ${arg}`);
    const [key, inline] = arg.slice(2).split('=');
    if (inline !== undefined) flags.set(key!, inline);
    else if (argv[i + 1] && !argv[i + 1]!.startsWith('--')) flags.set(key!, argv[++i]!);
    else flags.set(key!, 'true');
  }
  const dev = flags.get('dev');
  const prod = flags.get('prod');
  if (!dev || !prod) throw new Error('usage: quest-parity.ts --dev <root> --prod <root> [--dir bots/quests] [--only re] [--json] [--strict]');
  const onlyRaw = flags.get('only');
  return {
    dev: resolve(dev),
    prod: resolve(prod),
    dir: flags.get('dir') ?? 'bots/quests',
    only: onlyRaw && onlyRaw !== 'true' ? new RegExp(onlyRaw, 'i') : null,
    json: flags.get('json') === 'true',
    strict: flags.get('strict') === 'true',
    show: flags.get('show') && flags.get('show') !== 'true' ? flags.get('show')! : null,
  };
}

function scriptsIn(root: string, dir: string): Map<string, string> {
  const full = join(root, dir);
  const out = new Map<string, string>();
  if (!existsSync(full)) return out;
  for (const name of readdirSync(full)) {
    if (!name.endsWith('.ts')) continue;
    if (name.endsWith('.test.ts')) continue;
    out.set(name, join(full, name));
  }
  return out;
}

/** Line counts via `git diff --no-index --numstat`, which is accurate and already installed. */
function diffCounts(a: string, b: string): { added: number; removed: number } | null {
  try {
    const result = Bun.spawnSync(['git', 'diff', '--no-index', '--numstat', a, b], { stdout: 'pipe', stderr: 'pipe' });
    const line = new TextDecoder().decode(result.stdout).trim().split('\n')[0] ?? '';
    const [added, removed] = line.split('\t');
    if (added === undefined || removed === undefined) return null;
    return { added: Number(added) || 0, removed: Number(removed) || 0 };
  } catch {
    return null;
  }
}

function compare(parsed: Parsed): Entry[] {
  const dev = scriptsIn(parsed.dev, parsed.dir);
  const prod = scriptsIn(parsed.prod, parsed.dir);
  const names = [...new Set([...dev.keys(), ...prod.keys()])].filter(name => !parsed.only || parsed.only.test(name)).sort();

  const entries: Entry[] = [];
  for (const script of names) {
    const devPath = dev.get(script);
    const prodPath = prod.get(script);
    if (devPath && !prodPath) {
      entries.push({ script, status: 'dev-only', devLines: readFileSync(devPath, 'utf-8').split('\n').length });
      continue;
    }
    if (!devPath && prodPath) {
      entries.push({ script, status: 'prod-only', prodLines: readFileSync(prodPath, 'utf-8').split('\n').length });
      continue;
    }
    const devText = readFileSync(devPath!, 'utf-8');
    const prodText = readFileSync(prodPath!, 'utf-8');
    if (devText === prodText) {
      entries.push({ script, status: 'same' });
      continue;
    }
    const counts = diffCounts(prodPath!, devPath!);
    entries.push({
      script,
      status: 'differs',
      devLines: devText.split('\n').length,
      prodLines: prodText.split('\n').length,
      ...(counts ?? {}),
    });
  }
  return entries;
}

function format(entries: readonly Entry[]): string {
  const pad = (value: string, width: number) => value.padEnd(width);
  const lines = [`${pad('script', 34)}${pad('status', 11)}${pad('dev', 6)}${pad('prod', 6)}change (prod -> dev)`];
  for (const entry of entries) {
    const change = entry.status === 'differs' ? `+${entry.added ?? '?'} / -${entry.removed ?? '?'}` : '';
    lines.push(
      `${pad(entry.script, 34)}${pad(entry.status, 11)}${pad(String(entry.devLines ?? '—'), 6)}${pad(String(entry.prodLines ?? '—'), 6)}${change}`,
    );
  }
  const count = (status: Status) => entries.filter(e => e.status === status).length;
  lines.push(
    '',
    `${count('same')} identical · ${count('differs')} diverged · ${count('dev-only')} dev-only · ${count('prod-only')} prod-only`,
  );
  if (count('prod-only')) lines.push('prod-only scripts are fixes dev never received — reconcile before any merge');
  if (count('differs')) lines.push('diverged scripts need a manual merge, never a copy in either direction');
  return lines.join('\n');
}

try {
  const parsed = parse(process.argv.slice(2));
  const entries = compare(parsed);

  if (parsed.show) {
    const match = entries.find(e => basename(e.script) === parsed.show || e.script === parsed.show);
    if (!match) throw new Error(`no script '${parsed.show}' in either tree`);
    const devPath = join(parsed.dev, parsed.dir, match.script);
    const prodPath = join(parsed.prod, parsed.dir, match.script);
    console.log(`# ${match.script} (${match.status}) — prod -> dev\n`);
    console.log(Bun.spawnSync(['git', 'diff', '--no-index', '--color=never', prodPath, devPath], { stdout: 'pipe' }).stdout.toString() || '(identical)');
    process.exit(0);
  }

  if (parsed.json) {
    console.log(JSON.stringify({ dev: parsed.dev, prod: parsed.prod, dir: parsed.dir, entries }, null, 2));
  } else {
    console.log(`dev  ${parsed.dev}`);
    console.log(`prod ${parsed.prod}\n`);
    console.log(format(entries));
  }
  const divergent = entries.filter(e => e.status === 'differs' || e.status === 'prod-only').length;
  process.exit(parsed.strict && divergent ? 1 : 0);
} catch (error) {
  console.error(`quest-parity: ${(error as Error).message}`);
  process.exit(2);
}
