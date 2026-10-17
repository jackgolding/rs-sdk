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
export interface JournalRule {
  id: string;
  kind: 'unstarted' | 'active' | 'complete';
  /** Patterns asserted against the NORMALISED text (prose). */
  all: string[];
  none?: string[];
  /**
   * Patterns asserted against the RAW tagged text. Quest journals encode state
   * in emphasis, not words: "@str@I have an egg" (have it) versus
   * "@dbl@an @dre@egg" (still needed). A prose-only predicate cannot tell those
   * apart, and a raw-only predicate breaks on tags embedded mid-phrase
   * ("speaking to the @dre@Cook"), so both channels exist.
   */
  rawAll?: string[];
  rawNone?: string[];
}
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
  // The client wraps prose into separate components by PIXEL WIDTH, so a
  // sentence can be split mid-phrase and where the break lands depends on the
  // quest's wording, not on any rule (Rune Mysteries renders "...Duke Horacio
  // of" in one component and "Lumbridge, upstairs in ..." in the next). Those
  // boundaries are a rendering artifact, so a predicate is accepted against the
  // sentence however it is rejoined: as one prose stream (spaces) or with the
  // newlines the client actually sent.
  const journalProse = rawLines.map(line => line.text).join(' ');
  const result = (verdict: Verdict, reason: string): JournalVerdict => ({ checkpointId: rule.id, verdict, reason, journalText, rawLines });
  if (!observation.inGame || !observation.isOpen || observation.interfaceId !== spec.interfaceId) return result('UNKNOWN', 'quest journal not open');
  if (!Number.isFinite(observation.revision) || !Number.isFinite(afterRevision) || observation.revision <= afterRevision || !Number.isFinite(observation.stateAgeMs) || observation.stateAgeMs < 0 || observation.stateAgeMs > 5000) return result('UNKNOWN', 'stale journal publication');
  if (!rawLines.length || !rawLines.some(line => line.text.trim() === spec.title)) return result('UNKNOWN', 'missing journal text or wrong quest title');
  // Reject only a rule with no constraint at all on any channel — such a rule
  // would trivially pass. A raw-only emphasis rule, or a prohibition-only rule
  // (e.g. "the outstanding ingredient line must be absent"), is legitimate.
  const constrained = rule.all.length || rule.none?.length || rule.rawAll?.length || rule.rawNone?.length;
  if (!constrained) return result('UNKNOWN', 'empty checkpoint predicate');
  let required: RegExp[];
  let forbidden: RegExp[];
  try {
    required = rule.all.map(pattern => new RegExp(pattern, 'i'));
    forbidden = (rule.none ?? []).map(pattern => new RegExp(pattern, 'i'));
  } catch { return result('UNKNOWN', 'invalid checkpoint predicate'); }
  let rawRequired: RegExp[];
  let rawForbidden: RegExp[];
  try {
    rawRequired = (rule.rawAll ?? []).map(pattern => new RegExp(pattern, 'i'));
    rawForbidden = (rule.rawNone ?? []).map(pattern => new RegExp(pattern, 'i'));
  } catch { return result('UNKNOWN', 'invalid raw checkpoint predicate'); }
  const rawText = rawLines.map(line => line.rawText).join('\n');
  const rawProse = rawLines.map(line => line.rawText).join(' ');
  const complete = /QUEST COMPLETE!/i.test(journalText) || /QUEST COMPLETE!/i.test(rawText);
  if (rule.kind === 'complete' && !complete) return result('FAIL', 'explicit quest completion absent');
  if (rule.kind !== 'complete' && complete) return result('FAIL', 'quest already complete');
  // Match a pattern if it fits either rejoining of the same lines.
  const matches = (pattern: RegExp, joined: string, prose: string) => pattern.test(joined) || pattern.test(prose);
  if (!required.every(p => matches(p, journalText, journalProse))) return result('FAIL', 'required journal statement absent');
  if (forbidden.some(p => matches(p, journalText, journalProse))) return result('FAIL', 'forbidden journal statement present');
  if (!rawRequired.every(p => matches(p, rawText, rawProse))) return result('FAIL', 'required raw journal emphasis absent');
  if (rawForbidden.some(p => matches(p, rawText, rawProse))) return result('FAIL', 'forbidden raw journal emphasis present');
  return result('PASS', 'journal predicate satisfied');
}
