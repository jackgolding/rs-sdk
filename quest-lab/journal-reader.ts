/**
 * Quest journal reader.
 *
 * Opens a quest's journal and returns the evidence the checkpoint layer needs.
 * The journal is a main modal (`if_openmain(questjournal_scroll)`), but the
 * quest list you click to open it is a SIDE-TAB interface — lite `setTab` only
 * sets a local highlight and sends nothing to the server, so this reads the
 * active tab's root instead of assuming `interface.isOpen`.
 *
 * Matching the button by its VISIBLE LABEL keeps this free of hardcoded
 * component ids, which drift between content revisions.
 */
import type { BotSDK } from '../../sdk/index';
import { evaluateJournal, findJournalButton, type JournalObservation, type JournalRule, type JournalVerdict } from './evidence';

export const QUEST_JOURNAL_TAB = 2; // ^tab_quest_journal
export const QUEST_JOURNAL_INTERFACE = 8134; // questjournal_scroll

export interface JournalSpecLite {
    /** Client-visible quest-list button text, e.g. "Cook's Assistant". */
    label: string;
    /** The journal body's own heading, e.g. "The Cook's Quest". */
    title: string;
    interfaceId?: number;
}

export interface JournalRead {
    ok: boolean;
    reason: string;
    verdict: JournalVerdict | null;
    /** Raw journal lines, for evidence records and diagnostics. */
    rawLines: { componentId: number; rawText: string; text: string }[];
}

interface SideInterface {
    tabIndex: number;
    interfaceId: number;
    options: { text: string; componentId: number }[];
}

/** Read the active tab's side interface, or null if the server has not sent one. */
export function readSideInterface(sdk: BotSDK): SideInterface | null {
    const side = sdk.getState()?.sideInterface;
    if (!side || side.interfaceId === -1) return null;
    return side as SideInterface;
}

/**
 * Open a quest's journal and evaluate a checkpoint rule against it.
 * Never throws for an expected miss: a missing button, an unopened journal or a
 * stale publication all come back as ok=false with a reason.
 */
export async function readJournalCheckpoint(
    sdk: BotSDK,
    spec: JournalSpecLite,
    rule: JournalRule,
    opts: { timeoutMs?: number } = {}
): Promise<JournalRead> {
    const interfaceId = spec.interfaceId ?? QUEST_JOURNAL_INTERFACE;
    const timeoutMs = opts.timeoutMs ?? 8000;

    await sdk.sendSetTab(QUEST_JOURNAL_TAB);
    // Give the client a tick or two to publish the tab's interface.
    await sdk.waitForTicks(4);

    const side = readSideInterface(sdk);
    if (!side) return { ok: false, reason: 'no side interface on the quest tab', verdict: null, rawLines: [] };

    const componentId = findJournalButton(side.options, spec.label);
    if (componentId === null) {
        return { ok: false, reason: `quest button "${spec.label}" not found in ${side.options.length} options`, verdict: null, rawLines: [] };
    }

    // A journal click that does not open a NEW publication is not evidence.
    const beforeRevision = sdk.getState()?.revision ?? -1;
    await sdk.sendClickComponent(componentId);

    try {
        await sdk.waitForCondition(
            s => s.interface?.isOpen === true && s.interface.interfaceId === interfaceId && (s.revision ?? 0) > beforeRevision,
            timeoutMs
        );
    } catch {
        return { ok: false, reason: `journal ${interfaceId} did not open within ${timeoutMs}ms`, verdict: null, rawLines: [] };
    }

    const state = sdk.getState()!;
    const components = state.interface.textComponents ?? [];
    const observation: JournalObservation = {
        inGame: state.inGame,
        isOpen: state.interface.isOpen,
        interfaceId: state.interface.interfaceId,
        revision: state.revision ?? -1,
        stateAgeMs: sdk.getStateAge(),
        textComponents: components.map(c => ({ componentId: c.componentId, type: c.type, rawText: c.rawText, text: c.text })),
    };

    const verdict = evaluateJournal({ label: spec.label, interfaceId, title: spec.title }, rule, observation, beforeRevision);
    return {
        ok: verdict.verdict === 'PASS',
        reason: verdict.reason,
        verdict,
        rawLines: components.map(c => ({ componentId: c.componentId, rawText: c.rawText, text: c.text })),
    };
}
