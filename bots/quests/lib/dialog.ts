/**
 * Dialog driving for run-quest: one click per page, and the next click only once
 * the page has changed.
 *
 * quest-lib's talkAndChoose clicks a continue every tick and gives up after 12
 * iterations. A click lands a tick or two later, so each page cost 2-3 of those
 * iterations and a dialog of ~9 pages (Wyson's woad sale) ran out before the
 * grant, and the repeat clicks on a page that had not moved yet are the resumes
 * the client latches on (2026-10-29, Goblin Diplomacy port).
 */
import type { BotActions } from '../../../sdk/actions';
import type { BotSDK } from '../../../sdk/index';
import { tickNow, untilTicks } from './ticks';

/** What identifies a page: consecutive continue pages share options, so include their text. */
function pageSig(sdk: BotSDK): string {
    const d = sdk.getDialog();
    if (!d?.isOpen) return '';
    const texts = (d.allComponents ?? []).map((c) => c.text).join('|');
    return `${(d.options ?? []).map((o) => `${o.index}:${o.componentId}:${o.text}`).join('|')}#${d.text ?? ''}#${texts}`;
}

function pageText(sdk: BotSDK): string {
    const d = sdk.getDialog();
    return (d?.allComponents ?? []).map((c) => c.text).filter(Boolean).join(' ');
}

/** Click option `index` once and wait for the page to move; re-click (spaced) only if it never does. */
async function clickAndWait(sdk: BotSDK, index: number): Promise<boolean> {
    for (let attempt = 0; attempt < 3; attempt++) {
        const before = pageSig(sdk);
        await sdk.sendClickDialog(index);
        if (await untilTicks(sdk, () => pageSig(sdk) !== before, 8)) return true;
    }
    return false;
}

/**
 * Drive the open dialog: continue pages are clicked through, a choice page takes
 * the first of `choices` that matches one of its options, and it stops when the
 * dialog closes (and stays closed for a few ticks), on a choice page none of
 * `choices` matches, when `done()` holds, or after `ticks`. Returns the text seen.
 */
export async function driveDialog(
    sdk: BotSDK,
    choices: Array<RegExp | string> = [],
    opts: { done?: () => boolean; ticks?: number; log?: (msg: string) => void } = {}
): Promise<string> {
    const seen: string[] = [];
    const t0 = tickNow(sdk);
    const patterns = choices.map((c) => (typeof c === 'string' ? new RegExp(c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') : c));
    while (tickNow(sdk) - t0 < (opts.ticks ?? 150)) {
        if (opts.done?.()) break;
        const d = sdk.getDialog();
        if (!d?.isOpen) {
            // Scripts pause between pages (p_delay, a queue): give it a moment to reopen.
            // The FIRST page needs longer: talkTo can return before the server opens the
            // dialog, and 3 ticks at 60 ms is shorter than a round trip (Reldo, squire port).
            if (!(await untilTicks(sdk, (s) => !!s.dialog?.isOpen, seen.length ? 5 : 10))) break;
            continue;
        }
        const text = pageText(sdk);
        if (text && seen[seen.length - 1] !== text) seen.push(text);
        const options = d.options ?? [];
        const cont = options.find((o) => /click here to continue/i.test(o.text));
        if (cont) {
            if (!(await clickAndWait(sdk, cont.index))) {
                opts.log?.(`dialog: continue did not advance (${text.slice(0, 80)})`);
                break;
            }
            continue;
        }
        if (!options.length) {
            await sdk.waitForTicks(1);
            continue;
        }
        const pick = patterns.map((p) => options.find((o) => p.test(o.text))).find(Boolean);
        if (!pick) {
            opts.log?.(`dialog: no choice for ${JSON.stringify(options.map((o) => o.text))}`);
            break;
        }
        seen.push(`> ${pick.text}`);
        if (!(await clickAndWait(sdk, pick.index))) {
            opts.log?.(`dialog: choice "${pick.text}" did not advance`);
            break;
        }
    }
    return seen.join(' || ');
}

/** Talk to the nearest `npc` (talkTo walks the rest of the way) and drive the dialog. */
export async function talkThrough(
    sdk: BotSDK,
    bot: BotActions,
    npc: RegExp,
    choices: Array<RegExp | string> = [],
    log?: (msg: string) => void
): Promise<string> {
    // Right after a climb or a long walk the npc list has not caught up yet: up
    // the stairs to Juliet it was empty for all three attempts (2026-10-29).
    await untilTicks(sdk, () => !!sdk.findNearbyNpc(npc), 10);
    const target = sdk.findNearbyNpc(npc, { reachable: true }) ?? sdk.findNearbyNpc(npc);
    if (!target) {
        log?.(`talk: no NPC matching ${String(npc)} nearby`);
        return '';
    }
    let res = await bot.talkTo(target);
    if (!res.success) {
        // A wandering npc can step behind a counter for a moment ("Cannot reach
        // Apothecary", Romeo & Juliet port): one more try once it has moved.
        log?.(`talk ${target.name}: ${res.message} — retrying`);
        await sdk.waitForTicks(3);
        res = await bot.talkTo(sdk.findNearbyNpc(npc, { reachable: true }) ?? target);
    }
    if (!res.success) {
        log?.(`talk ${target.name}: ${res.message}`);
        return '';
    }
    return driveDialog(sdk, choices, { log });
}
