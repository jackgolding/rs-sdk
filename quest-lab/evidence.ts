export type Verdict = 'PASS' | 'FAIL' | 'UNKNOWN';
export interface JournalSpec {
  /** Client-visible quest-list button text, e.g. "Cook's Assistant". */
  label: string;
  interfaceId: number;
  /** The journal body's own heading, e.g. "The Cook's Quest". */
  title: string;
}
/** The subset of a client interface option this layer needs. */
export interface InterfaceOptionLike { componentId: number; text: string }

/**
 * Resolve the quest-list button to click from the client's live interface
 * options. Matching is exact (case/whitespace-insensitive) and ambiguous or
 * absent matches return null so the caller reports UNKNOWN instead of clicking
 * a guessed component.
 */
export function findJournalButton(options: readonly InterfaceOptionLike[], label: string): number | null {
  const wanted = label.trim().toLowerCase();
  if (!wanted) return null;
  const matches = options.filter(o => o.text.trim().toLowerCase() === wanted);
  return matches.length === 1 ? matches[0]!.componentId : null;
}
export interface JournalRule { id: string; kind: 'unstarted' | 'active' | 'complete'; all: string[]; none?: string[] }
export interface JournalText { componentId: number; type: number; rawText: string; text: string }
export interface JournalObservation {
  inGame: boolean; isOpen: boolean; interfaceId: number; revision: number;
  stateAgeMs: number; textComponents?: JournalText[];
}
export interface JournalVerdict {
  checkpointId: string; verdict: Verdict; reason: string; journalText: string; rawLines: JournalText[];
}
export function evaluateJournal(spec: JournalSpec, rule: JournalRule, observation: JournalObservation, afterRevision: number): JournalVerdict {
  const rawLines = observation.textComponents ?? [];
  const journalText = rawLines.map(line => line.text).join('\n');
  const result = (verdict: Verdict, reason: string): JournalVerdict => ({ checkpointId: rule.id, verdict, reason, journalText, rawLines });
  if (!observation.inGame || !observation.isOpen || observation.interfaceId !== spec.interfaceId) return result('UNKNOWN', 'quest journal not open');
  if (!Number.isFinite(observation.revision) || !Number.isFinite(afterRevision) || observation.revision <= afterRevision || !Number.isFinite(observation.stateAgeMs) || observation.stateAgeMs < 0 || observation.stateAgeMs > 5000) return result('UNKNOWN', 'stale journal publication');
  if (!rawLines.length || !rawLines.some(line => line.text.trim() === spec.title)) return result('UNKNOWN', 'missing journal text or wrong quest title');
  if (!rule.all.length) return result('UNKNOWN', 'empty checkpoint predicate');
  let required: RegExp[];
  let forbidden: RegExp[];
  try {
    required = rule.all.map(pattern => new RegExp(pattern, 'i'));
    forbidden = (rule.none ?? []).map(pattern => new RegExp(pattern, 'i'));
  } catch { return result('UNKNOWN', 'invalid checkpoint predicate'); }
  const complete = /QUEST COMPLETE!/i.test(journalText);
  if (rule.kind === 'complete' && !complete) return result('FAIL', 'explicit quest completion absent');
  if (rule.kind !== 'complete' && complete) return result('FAIL', 'quest already complete');
  if (!required.every(pattern => pattern.test(journalText))) return result('FAIL', 'required journal statement absent');
  if (forbidden.some(pattern => pattern.test(journalText))) return result('FAIL', 'forbidden journal statement present');
  return result('PASS', 'journal predicate satisfied');
}
