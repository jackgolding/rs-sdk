/**
 * Quest script framework: linear, dialog-driven quest state machines.
 *
 * Grind loops repeat; quests advance. There is no quest-varp accessor in
 * the SDK, so stages are detected the way lost-city.ts does it: dialog
 * text, chat messages, inventory, and position. Each quest is data (stages
 * + matchers) plus a few custom interactions (combat, puzzles).
 *
 * Conventions (see grind-scripts skill):
 * - Gate completion on the server's quest-complete chat message, never on
 *   "attempted the last step". waitForQuestComplete is the only finish line.
 * - Resume by re-running locate(): a restart re-detects the stage from
 *   dialog/chat/inventory instead of replaying from step one.
 * - Safe stops: questLoop honors session.stopRequested — it banks via
 *   safe-stops parkAtBank and stops (exit 0), so a job switch mid-quest
 *   parks at a bank with a park.json for the next job.
 * - Quest-point / prior-quest gates cannot be checked at runtime (no SDK
 *   accessor). They are enforced by ASSIGNMENT: the quest x account matrix
 *   only schedules quests the account qualifies for.
 */
import type { BotActions } from '../../sdk/actions';
import type { BotSDK } from '../../sdk/index';
import type { ActivitySession } from '../../sdk/activity';
import { parkAtBank, nearestBank } from './safe-stops';

export interface QuestContext {
    sdk: BotSDK;
    bot: BotActions;
    session: ActivitySession | null;
    log: (msg: string) => void;
}

export interface QuestStage {
    /** Stable id, also used in logs (e.g. 'start', 'maze-key', 'elvarg'). */
    id: string;
    /** True when dialog/chat/inventory/position says we are at this stage. */
    detect: (ctx: QuestContext) => boolean;
    /** Perform the stage. Should be idempotent — it may run twice. */
    run: (ctx: QuestContext) => Promise<void>;
}

/** Recent dialog text + options + recent chat, one searchable string. */
export function visibleText(sdk: BotSDK, chatLines = 30): string {
    const dialog = sdk.getDialog();
    const bits: string[] = [];
    if (dialog?.isOpen) {
        if (dialog.text) bits.push(String(dialog.text));
        for (const c of dialog.allComponents ?? []) if (c.text) bits.push(String(c.text));
        for (const o of dialog.options ?? []) bits.push(`[${o.text}]`);
    }
    const chat = sdk.getChat?.({ limit: chatLines } as never) as
        | Array<{ text?: string }>
        | undefined;
    if (Array.isArray(chat)) {
        for (const m of chat.slice(-chatLines)) if (m.text) bits.push(String(m.text));
    } else {
        const state = sdk.getState();
        for (const m of (state?.gameMessages ?? []).slice(-chatLines)) bits.push(m.text ?? '');
    }
    return bits.join(' | ');
}

/**
 * Talk to an NPC and click through choices. Returns everything seen
 * (dialog pages + options + resulting chat) for stage matchers.
 */
export async function talkAndChoose(
    ctx: QuestContext,
    npc: RegExp | string,
    choices: Array<string | RegExp> = []
): Promise<string> {
    const seen: string[] = [];
    const target = ctx.sdk.findNearbyNpc(npc as RegExp);
    if (!target) {
        ctx.log(`talk: no NPC matching ${String(npc)} nearby`);
        return '';
    }
    const talk = await ctx.bot.talkTo(target);
    if (!talk.success) ctx.log(`talk: ${talk.message}`);
    for (let page = 0; page < 12; page++) {
        await ctx.sdk.waitForTicks(1).catch(() => undefined);
        seen.push(visibleText(ctx.sdk, 10));
        const dialog = ctx.sdk.getDialog();
        if (!dialog?.isOpen) break;
        const cont = (dialog.options ?? []).find((o) => /click here to continue/i.test(o.text));
        if (cont) {
            await ctx.sdk.sendClickDialog(cont.index);
            continue;
        }
        const next = choices.find((c) => {
            const re = typeof c === 'string' ? new RegExp(c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') : c;
            return (dialog.options ?? []).some((o) => re.test(o.text));
        });
        if (next === undefined) break;
        await ctx.bot.navigateDialog([next]);
    }
    seen.push(visibleText(ctx.sdk, 10));
    return seen.join(' || ');
}

/**
 * The only finish line: the server's quest-complete message. Resolves true
 * on match, false on timeout. Never treat "did the last click" as done.
 */
export async function waitForQuestComplete(
    ctx: QuestContext,
    questName: RegExp | string,
    timeoutMs = 120_000
): Promise<boolean> {
    const re =
        typeof questName === 'string'
            ? new RegExp(`completed?.*${questName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}|${questName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}.*complete`, 'i')
            : questName;
    try {
        await ctx.sdk.waitForChat({ matching: re, timeout: timeoutMs } as never);
        return true;
    } catch {
        const tail = visibleText(ctx.sdk, 40);
        return re.test(tail);
    }
}

/** Client baseLevel (permanent, not boosted) or null when unknown. */
export function skillLevel(sdk: BotSDK, name: string): number | null {
    const level = sdk.getSkill(name)?.baseLevel;
    return typeof level === 'number' ? level : null;
}

export interface SkillNeed {
    skill: string;
    need: number;
    have: number | null;
}

/**
 * Runtime skill gate. Fails fast with one log line per missing requirement
 * so a misassigned quest is obvious in the grind log instead of stalling
 * mid-route. QP and prior-quest gates have no SDK accessor and stay
 * assignment-side (the quest x account matrix).
 */
export function requireSkills(
    ctx: QuestContext,
    reqs: Record<string, number>
): { ok: boolean; missing: SkillNeed[] } {
    const missing: SkillNeed[] = [];
    for (const [skill, need] of Object.entries(reqs)) {
        const have = skillLevel(ctx.sdk, skill);
        if (have == null || have < need) missing.push({ skill, need, have });
    }
    if (missing.length > 0) {
        ctx.log(
            `skill gate: missing ${missing.map((m) => `${m.skill} ${m.have ?? '?'}/${m.need}`).join(', ')}`
        );
        return { ok: false, missing };
    }
    return { ok: true, missing };
}

/** Count inventory items matching pattern (count field, default 1 each). */
export function countItems(sdk: BotSDK, pattern: RegExp): number {
    return sdk
        .getInventory()
        .reduce((n, i) => n + ((i.count ?? 0) > 0 && pattern.test(i.name) ? (i.count ?? 1) : 0), 0);
}

export interface ItemNeed {
    pattern: RegExp;
    count: number;
    label: string;
}

/** Missing items from inventory. Caller banks first (safe-stops), then withdraws. */
export function missingItems(sdk: BotSDK, needs: ItemNeed[]): ItemNeed[] {
    return needs.filter((need) => countItems(sdk, need.pattern) < need.count);
}

/**
 * Withdraw needs from an OPEN bank. Returns the still-missing list
 * (empty = packed). Assumes the caller opened the bank at a safe stop.
 */
export async function withdrawNeeds(ctx: QuestContext, needs: ItemNeed[]): Promise<ItemNeed[]> {
    for (const need of needs) {
        if (countItems(ctx.sdk, need.pattern) >= need.count) continue;
        const match = (ctx.sdk.getBankItems?.() ?? []).find((i) => need.pattern.test(i.name));
        if (!match) continue;
        await ctx.bot.withdrawItem(match, need.count);
        await ctx.sdk.waitForTicks(2).catch(() => undefined);
    }
    return missingItems(ctx.sdk, needs);
}

/**
 * Run stages to completion. locate() re-detects on every pass, so restarts
 * resume mid-quest. Honors stopRequested: banks via safe-stops and returns
 * 'drained' (caller stops exit-0); 'complete' only after the quest varp —
 * verified by waitForQuestComplete at the end, never by step count.
 */
export async function questLoop(
    ctx: QuestContext,
    stages: QuestStage[],
    opts: {
        questName: string | RegExp;
        completeTimeoutMs?: number;
        maxPasses?: number;
        bankName?: Parameters<typeof parkAtBank>[2];
    }
): Promise<'complete' | 'drained' | 'stuck'> {
    const maxPasses = opts.maxPasses ?? 200;
    for (let pass = 0; pass < maxPasses; pass++) {
        if (ctx.session?.stopRequested) {
            const bank = opts.bankName ?? nearestBank(ctx.sdk);
            ctx.log(`quest ${String(opts.questName)}: stop requested — parking at ${bank}`);
            await parkAtBank(ctx.sdk, ctx.bot, bank);
            return 'drained';
        }
        if (ctx.session?.needsRecovery()) {
            const outcome = await ctx.session.recover();
            if (outcome === 'exhausted') return 'stuck';
            continue;
        }
        const idx = stages.findIndex((s) => {
            try {
                return s.detect(ctx);
            } catch {
                return false;
            }
        });
        if (idx < 0) {
            ctx.log(`quest ${String(opts.questName)}: no stage matched @ ${(ctx.sdk.getState()?.player?.worldX ?? 0)},${(ctx.sdk.getState()?.player?.worldZ ?? 0)}`);
            await ctx.sdk.waitForTicks(5).catch(() => undefined);
            continue;
        }
        const stage = stages[idx]!;
        ctx.log(`quest stage ${stage.id} (pass ${pass + 1})`);
        await ctx.session?.setPhase(`quest_${stage.id}`).catch(() => undefined);
        try {
            await stage.run(ctx);
        } catch (err) {
            ctx.log(`quest stage ${stage.id} error: ${err instanceof Error ? err.message : String(err)}`);
        }
        // Completion check only on the final stage or periodically — a 5s
        // chat wait every pass would stall fast stage turnover.
        if (idx === stages.length - 1 || pass % 10 === 9) {
            if (await waitForQuestComplete(ctx, opts.questName, 5_000)) return 'complete';
        }
    }
    // Final verdict with the full timeout before calling it stuck.
    if (await waitForQuestComplete(ctx, opts.questName, opts.completeTimeoutMs)) return 'complete';
    return 'stuck';
}
