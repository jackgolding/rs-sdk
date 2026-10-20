#!/usr/bin/env bun
/**
 * Travel check — two views of the same problem: which scripts travel badly, and
 * which journeys are known to be broken.
 *
 *   bun sdk/travel-check.ts                     # lint bots/quests for client-planner travel
 *   bun sdk/travel-check.ts --gaps              # the gap registry, grouped, most-hit first
 *   bun sdk/travel-check.ts --strict            # exit 1 when a script travels blind (CI)
 *   bun sdk/travel-check.ts --json              # machine-readable
 *
 * The lint is deliberately narrow and honest about it. It flags one concrete
 * failure class, the one that cost the Wizards' Tower three eval attempts: a
 * script that plans cross-region movement with the CLIENT pathfinder
 * (`bot.walkTo` / `sdk.sendWalk`) and never touches a shared hop walker. The
 * client planner has no graph for stretches of the map and returns
 * "no waypoints" for walkable tiles; a script with no shared mover has no
 * fallback, so it dies there — and each discovery used to die in its own log.
 *
 * It does not claim those scripts are wrong: local steps (`walkTo` to the tile
 * next to an NPC) are correct and common. It claims they cannot recover, which
 * is a review question, not a verdict.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { defaultGapLog, formatGaps, groupGaps, readTravelGaps } from './travel';

export interface SourceAnalysis {
  walkToCalls: number;
  sendWalkCalls: number;
  usesSharedMover: boolean;
  /** True when the file plans movement with the client and has no shared fallback. */
  travelsBlind: boolean;
  moverImports: string[];
}

const SHARED_MOVER = /from\s+['"]\.\/(walk-route|route|movement)['"]/;

/** Pure source analysis so the lint itself is testable without a filesystem. */
export function analyzeSource(text: string): SourceAnalysis {
  const code = text
    .split('\n')
    .map(line => line.replace(/\/\/.*$/, ''))
    .join('\n');
  const walkToCalls = (code.match(/\bbot\.walkTo\s*\(/g) ?? []).length;
  const sendWalkCalls = (code.match(/\bsdk\.sendWalk\s*\(/g) ?? []).length;
  const moverImports = [...code.matchAll(/from\s+['"](\.\/(?:walk-route|route|movement))['"]/g)].map(m => m[1]!);
  const usesSharedMover = SHARED_MOVER.test(code);
  const plans = walkToCalls + sendWalkCalls;
  return {
    walkToCalls,
    sendWalkCalls,
    usesSharedMover,
    moverImports: [...new Set(moverImports)],
    travelsBlind: plans > 0 && !usesSharedMover,
  };
}

interface Finding {
  script: string;
  analysis: SourceAnalysis;
}

function lint(dir: string): Finding[] {
  if (!existsSync(dir)) throw new Error(`no such directory: ${dir}`);
  const findings: Finding[] = [];
  for (const name of readdirSync(dir).sort()) {
    if (!name.endsWith('.ts') || name.endsWith('.graph.ts') || name.endsWith('.test.ts')) continue;
    const path = join(dir, name);
    const analysis = analyzeSource(readFileSync(path, 'utf-8'));
    if (analysis.walkToCalls + analysis.sendWalkCalls === 0) continue;
    findings.push({ script: name, analysis });
  }
  return findings.sort((a, b) => b.analysis.walkToCalls + b.analysis.sendWalkCalls - (a.analysis.walkToCalls + a.analysis.sendWalkCalls));
}

function formatLint(findings: readonly Finding[]): string {
  const blind = findings.filter(f => f.analysis.travelsBlind);
  const pad = (value: string, width: number) => value.padEnd(width);
  const lines = [
    `${pad('script', 34)}${pad('walkTo', 8)}${pad('sendWalk', 10)}${pad('mover', 8)}verdict`,
  ];
  for (const finding of findings) {
    lines.push(
      `${pad(finding.script, 34)}${pad(String(finding.analysis.walkToCalls), 8)}${pad(String(finding.analysis.sendWalkCalls), 10)}${pad(finding.analysis.usesSharedMover ? 'yes' : 'NO', 8)}${finding.analysis.travelsBlind ? 'travels blind' : 'has a fallback'}`,
    );
  }
  lines.push('', `${blind.length} of ${findings.length} script(s) plan movement with the client pathfinder and have no shared fallback`);
  if (blind.length) {
    lines.push('review queue: give these a shared hop walker, or confirm every walk is a local step');
  }
  return lines.join('\n');
}

// Only run when invoked directly: importing this module (tests, other tools)
// must not lint the tree, print a table, or call process.exit.
if (import.meta.main) {
    const argv = process.argv.slice(2);
    const flags = new Set(argv.filter(a => a.startsWith('--')).map(a => a.slice(2)));
    const dirArg = argv.find(a => !a.startsWith('--')) ?? 'bots/quests';

    try {
      if (flags.has('gaps')) {
        const gapPath = defaultGapLog();
        const groups = groupGaps(readTravelGaps(gapPath));
        if (flags.has('json')) {
          console.log(JSON.stringify({ gapLog: gapPath, groups }, null, 2));
        } else {
          console.log(`travel gaps (${gapPath})`);
          console.log(formatGaps(groups));
        }
        process.exit(flags.has('strict') && groups.length ? 1 : 0);
      }

      const findings = lint(dirArg);
      if (flags.has('json')) {
        console.log(JSON.stringify({ directory: dirArg, findings }, null, 2));
      } else {
        console.log(formatLint(findings));
      }
      const blind = findings.filter(f => f.analysis.travelsBlind);
      process.exit(flags.has('strict') && blind.length ? 1 : 0);
    } catch (error) {
      console.error(`travel-check: ${(error as Error).message}`);
      process.exit(2);
    }
}
