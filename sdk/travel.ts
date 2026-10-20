/**
 * Travel gap registry — a shared record of "this movement did not work".
 *
 * Why: the same wall gets rediscovered by every script that walks past it. The
 * Wizards' Tower entry cost three full eval attempts, and each discovery died in
 * one script's own log; nothing accumulated, so nothing was ever fixed. A gap
 * recorded once, counted, and listed is a work item with an owner instead of a
 * surprise.
 *
 * What gets recorded: the failing movement (from/to, plane), the class of
 * failure, which script hit it, and the mover's own explanation. Not a stack
 * trace, not a guess — the coordinates are the join key.
 *
 * Reading it:
 *   bun sdk/travel-check.ts --gaps          # grouped, most-hit first
 *
 * Recording never throws: a mover that dies while logging a failure is worse
 * than one that logs nothing.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export type TravelGapKind =
  /** The planner produced no route at all (client pathfinder has no graph there). */
  | 'no-waypoints'
  /** A hop moved nothing: an obstacle, a closed door, a standing NPC. */
  | 'blocked'
  /** The walk finished short of its destination. */
  | 'arrival-short';

export interface TravelGapTile {
  x: number;
  z: number;
  level: number;
}

export interface TravelGap {
  schemaVersion: 1;
  at: string;
  kind: TravelGapKind;
  from: TravelGapTile;
  to: TravelGapTile;
  /** Script that hit it, for triage (e.g. `bots/quests/imp-catcher.ts`). */
  script: string;
  /** The mover's own explanation, verbatim. */
  detail?: string;
  /** Optional hub/route label the caller was aiming at ("Wizards Tower door"). */
  target?: string;
}

/** Registry location: repo root by default, overridable for tests/runs. */
export function defaultGapLog(repoRoot: string = process.cwd()): string {
  return process.env.TRAVEL_GAP_LOG ?? join(repoRoot, 'travel-gaps.jsonl');
}

export function recordTravelGap(
  gap: Omit<TravelGap, 'schemaVersion' | 'at'> & { at?: string },
  path: string = defaultGapLog(),
): void {
  try {
    const record: TravelGap = {
      schemaVersion: 1,
      at: gap.at ?? new Date().toISOString(),
      kind: gap.kind,
      from: gap.from,
      to: gap.to,
      script: gap.script,
      ...(gap.detail ? { detail: gap.detail.slice(0, 400) } : {}),
      ...(gap.target ? { target: gap.target } : {}),
    };
    mkdirSync(dirname(path), { recursive: true });
    appendFileSync(path, JSON.stringify(record) + '\n');
  } catch {
    /* never let diagnostics break a run */
  }
}

export function readTravelGaps(path: string = defaultGapLog()): TravelGap[] {
  try {
    if (!existsSync(path)) return [];
    const out: TravelGap[] = [];
    for (const line of readFileSync(path, 'utf-8').split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const parsed = JSON.parse(trimmed) as TravelGap;
        if (parsed?.schemaVersion === 1 && parsed.from && parsed.to) out.push(parsed);
      } catch {
        /* a torn append is not a reason to lose the rest */
      }
    }
    return out;
  } catch {
    return [];
  }
}

export interface GapGroup {
  /** Stable key: kind + rounded coordinates, so jitter nearby still groups. */
  key: string;
  kind: TravelGapKind;
  from: TravelGapTile;
  to: TravelGapTile;
  count: number;
  scripts: string[];
  lastAt: string;
  detail?: string;
}

const near = (t: TravelGapTile): string => `${Math.round(t.x / 4) * 4},${Math.round(t.z / 4) * 4},l${t.level}`;

/**
 * Group gaps into work items: same failure class, same rough journey. Rounding
 * to 4 tiles keeps "blocked at 3102,3161" and "blocked at 3103,3161" one item,
 * which is what an operator wants to fix.
 */
export function groupGaps(gaps: readonly TravelGap[]): GapGroup[] {
  const groups = new Map<string, GapGroup>();
  for (const gap of gaps) {
    const key = `${gap.kind}:${near(gap.from)}->${near(gap.to)}`;
    const existing = groups.get(key);
    if (existing) {
      existing.count += 1;
      if (!existing.scripts.includes(gap.script)) existing.scripts.push(gap.script);
      if (gap.at > existing.lastAt) existing.lastAt = gap.at;
      continue;
    }
    groups.set(key, {
      key,
      kind: gap.kind,
      from: gap.from,
      to: gap.to,
      count: 1,
      scripts: [gap.script],
      lastAt: gap.at,
      ...(gap.detail ? { detail: gap.detail } : {}),
    });
  }
  return [...groups.values()].sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
}

export function formatGaps(groups: readonly GapGroup[]): string {
  if (!groups.length) return 'no travel gaps recorded';
  const pad = (value: string, width: number) => value.padEnd(width);
  const lines = [`${pad('hits', 6)}${pad('kind', 15)}${pad('from', 16)}${pad('to', 16)}scripts`];
  for (const group of groups) {
    lines.push(
      `${pad(String(group.count), 6)}${pad(group.kind, 15)}${pad(`${group.from.x},${group.from.z},l${group.from.level}`, 16)}${pad(`${group.to.x},${group.to.z},l${group.to.level}`, 16)}${group.scripts.length > 2 ? `${group.scripts.slice(0, 2).join(', ')} +${group.scripts.length - 2}` : group.scripts.join(', ')}`,
    );
    if (group.detail) lines.push(`      └ ${group.detail.slice(0, 160)}`);
  }
  return lines.join('\n');
}
