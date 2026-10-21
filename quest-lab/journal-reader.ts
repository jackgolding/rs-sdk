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

    // Opening the journal is retried, because a click that lands while another
    // modal is still closing produces no publication at all — observed right
    // after a quest completes: `send_quest_complete` shows its scroll, the
    // caller dismisses it, and the next tab click is swallowed. That is
    // indistinguishable from a stale journal, so try again rather than burn the
    // checkpoint. The evidence rule is unchanged: a retry must still open a NEW
    // publication (`revision` greater than before the click).
    const OPEN_ATTEMPTS = 3;
    let openedRevision: number | null = null;
    let lastReason = '';
    for (let attempt = 1; attempt <= OPEN_ATTEMPTS && openedRevision === null; attempt++) {
        if (attempt > 1) {
            const stray = sdk.getState();
            if (stray?.interface?.isOpen && stray.interface.interfaceId !== interfaceId) {
                await sdk.sendCloseModal().catch(() => undefined);
                await sdk.waitForStateChange(1000).catch(() => undefined);
            }
            await sdk.waitForTicks(4).catch(() => undefined);
        }

        await sdk.sendSetTab(QUEST_JOURNAL_TAB);
        // The side interface streams in late after login: an instant read sees
        // no interface and every rule returns UNKNOWN (observed on a freshly
        // relit lite runner). Poll bounded for it to appear before reading, and
        // only then treat a miss as a real miss.
        let side = readSideInterface(sdk);
        for (let i = 0; i < 8 && !side; i++) {
            await sdk.waitForTicks(8).catch(() => undefined);
            await sdk.sendSetTab(QUEST_JOURNAL_TAB).catch(() => undefined);
            await sdk.waitForTicks(4).catch(() => undefined);
            side = readSideInterface(sdk);
        }
        if (!side) {
            lastReason = 'no side interface on the quest tab';
            continue;
        }

        // The quest list streams in progressively (observed: 3 options on a
        // fresh login, 26 a minute later) — poll bounded for the button
        // instead of failing on the first partial read.
        let componentId: number | null = null;
        for (let i = 0; i < 10 && componentId === null; i++) {
            componentId = findJournalButton(readSideInterface(sdk)?.options ?? [], spec.label);
            if (componentId === null) await sdk.waitForTicks(8).catch(() => undefined);
        }
        if (componentId === null) {
            lastReason = `quest button "${spec.label}" not found in ${readSideInterface(sdk)?.options.length ?? 0} options`;
            continue;
        }

        // A journal click that does not open a NEW publication is not evidence.
        const beforeRevision = sdk.getState()?.revision ?? -1;
        await sdk.sendClickComponent(componentId);

        try {
            await sdk.waitForCondition(
                s => s.interface?.isOpen === true && s.interface.interfaceId === interfaceId && (s.revision ?? 0) > beforeRevision,
                timeoutMs
            );
            openedRevision = beforeRevision;
        } catch {
            lastReason = `journal ${interfaceId} did not open within ${timeoutMs}ms (attempt ${attempt}/${OPEN_ATTEMPTS})`;
        }
    }

    if (openedRevision === null) return { ok: false, reason: lastReason, verdict: null, rawLines: [] };

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

    const verdict = evaluateJournal({ label: spec.label, interfaceId, title: spec.title }, rule, observation, openedRevision);
    return {
        ok: verdict.verdict === 'PASS',
        reason: verdict.reason,
        verdict,
        rawLines: components.map(c => ({ componentId: c.componentId, rawText: c.rawText, text: c.text })),
    };
}
