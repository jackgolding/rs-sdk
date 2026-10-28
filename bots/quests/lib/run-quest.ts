/**
 * run-quest — the one quest runner. A quest is a state machine:
 *
 *   states       journal stages, detected by JournalRules (unstarted → … → complete)
 *   transitions  "from stage A, at tile T, holding items I, talk/act → stage B"
 *
 * The runner fills in everything between states, the same way for every quest:
 *
 *   prologue   go to the quest's hub bank, deposit everything (naked), withdraw
 *              what the bank already holds toward the quest's items
 *   prepare    produce every remaining need that has a source (buy, gather,
 *              craft) before any quest dialog. Quest-only items (no source, or
 *              `spawnable: false`) are left to their transition
 *   transition ensure items (normally already held), go to `at`,
 *              talk or act, then confirm the journal moved to `to`
 *   epilogue   back to the hub, deposit everything, end where the run started
 *
 * Assisted runs (local only) replace travel with teleports and item sourcing with
 * spawning, so a new quest proves its dialog and journal transitions before
 * anyone works on the route:
 *
 *   QUEST_LAB_CHEATS=1 QUEST_ASSIST_HOOK=quest-lab/tools/assist.ts \
 *     [QUEST_ASSIST=travel,items] bun bots/quests/sheep-shearer.ts {account}
 *
 * `--prepare-only` stops after prepare and banks the items, so an account can
 * be stocked ahead of time; the next full run withdraws them in its prologue.
 *
 * An assisted run writes assisted.json beside its run record and exits 3: it
 * proves the steps, never the route, and can never grade as PASS.
 *
 * Deploy rule: this lives under bots/ (mounted on the fleet) and imports only
 * sdk/ and quest-lab/ modules that deployed quest scripts already import.
 * Do not add a newer sdk/ import here — the fleet image will not have it.
 */
import { appendFileSync, writeFileSync } from 'fs';
import { join, resolve } from 'path';
import type { BotActions } from '../../../sdk/actions';
import type { BotSDK } from '../../../sdk/index';
import { runScript } from '../../../sdk/runner';
import { ActivitySession } from '../../../sdk/activity';
import { readJournalCheckpoint } from '../../../quest-lab/journal-reader';
import { appendCheckpoint, createRun, safeRunId, summarizeRun, type RunHandle } from '../../../quest-lab/records';
import type { JournalRule } from '../../../quest-lab/evidence';
import { travelTo, type Tile } from '../travel';
import { closeUi } from '../movement';
import { countItems, requireSkills } from '../quest-lib';
import { depositAllInventory, type SupplyCtx } from '../quest-supplies';
import { SAFE_BANKS, type SafeBankName } from '../safe-stops';
import { GROUPS, itemPattern, needMet, SOURCES, type Need } from './sources';
import { TRAINERS } from './training';
import { talkThrough } from './dialog';
import { leaveStuckArea } from './doors';
import { tickNow, untilTicks } from './ticks';

export type { Need } from './sources';

export interface Quest {
    sdk: BotSDK;
    bot: BotActions;
    log: (msg: string) => void;
    /** Journal stage id, re-read after every transition. */
    stage: string;
    /** Held count. A GROUPS name ('pickaxe') counts the usable members held or worn. */
    count: (item: string | RegExp) => number;
    /** Base level of a skill ('mining'). */
    level: (skill: string) => number;
    /** Train `skill` to `level` with its trainer (lib/training.ts) if below it. Throws when it cannot. */
    ensureLevel: (skill: string, level: number) => Promise<void>;
    /**
     * Walk (or, assisted, teleport) to a tile, climbing to its plane first
     * (`level`, default 0 — the ground floor). Throws when it cannot get there.
     */
    goTo: (tile: Tile & { level?: number }, tolerance?: number) => Promise<void>;
    /**
     * Make a nearby loc reachable: open the closed doors nearest to IT (not to
     * the player) until the client can route there. Throws when none helps.
     * walkTo's tolerance can "arrive" on the wrong side of a wall, so use this
     * before interacting with a loc inside a room.
     */
    reach: (loc: RegExp, withOption?: RegExp) => Promise<void>;
    /** Climb stairs/ladders near the player until on `level`. Throws on failure. */
    climbTo: (level: number) => Promise<void>;
    /** Get near `at` if given, then talk (talkTo walks the rest) and pick `choices` in order. Returns all text seen. */
    talk: (npc: RegExp, choices?: Array<RegExp | string>, at?: Tile) => Promise<string>;
    /** Hold `count` of `item`: inventory, then its source procedure (assisted: spawn). Throws when it cannot. */
    ensure: (item: string, count: number) => Promise<void>;
    /** Context for quest-supplies helpers (buyAtShop, depositAllInventory, ...). */
    supply: SupplyCtx;
}

export interface StageDef {
    id: string;
    rule: JournalRule;
}

export interface Transition {
    from: string;
    to: string;
    /** Where the transition happens. Walked near (talkTo finishes the approach); assisted runs land on it. */
    at?: Tile;
    /** Items to hold before acting. */
    needs?: Need[];
    talk?: { npc: RegExp; choices?: Array<RegExp | string> };
    /** Extra action after `talk` (or instead of it): use an item, kill an npc, pump a hand-in. */
    run?: (q: Quest) => Promise<void>;
}

export interface QuestDef {
    /** quest-lab id — the run record and todo-runner key. */
    id: string;
    /** Bank the quest starts and ends at, naked. */
    hub: SafeBankName;
    journal?: { label: string; title: string };
    /** In quest order: first is not-started, last is complete. */
    stages: StageDef[];
    transitions: Transition[];
    skills?: Record<string, number>;
    /** Attempts per transition before giving up (default 3). */
    retries?: number;
    /**
     * Task mode (no journal): run this between the hub prologue and epilogue
     * instead of transitions. For units like training that are not quests.
     */
    task?: (q: Quest) => Promise<void>;
}

/** A unit of work that is not a quest: same hub prologue/epilogue, no journal. */
export function runTask(def: { id: string; hub: SafeBankName; needs?: Need[]; task: (q: Quest) => Promise<void> }): Promise<void> {
    return runQuest({ id: def.id, hub: def.hub, stages: [], transitions: def.needs ? [{ from: '', to: '', needs: def.needs }] : [], task: def.task });
}

/** Arrival radius goTo asks travelTo for before bot.walkTo finishes the approach. */
const APPROACH = 15;
/** Where goTo lets travelTo stop: on the road, before a fenced or walled destination. */
const TRAVEL_ARRIVAL = 20;
/** Exit code for a run that completed with assistance: steps proven, route not. */
const ASSISTED_EXIT = 3;
/** Exit code for a run stopped because mule-supplied stock is missing: stock the account, not a script failure. */
export const NEEDS_STOCK_EXIT = 4;

/** Thrown when a mule-supplied need (Source.mule) is short; runQuest exits NEEDS_STOCK_EXIT. */
export class NeedsStock extends Error {
    constructor(readonly short: Need[]) {
        super(`NEEDS STOCK: ${short.map((n) => `${n.item} ×${n.count}`).join(', ')} — stock the account from the mule before this quest`);
    }
}

/** Local-dev assistance (QUEST_ASSIST_HOOK=path). Never set on the fleet. */
interface AssistHook {
    reason: string;
    travel?: (sdk: BotSDK, tile: Tile) => Promise<boolean>;
    give?: (sdk: BotSDK, obj: string, count: number) => Promise<boolean>;
}

export async function runQuest(def: QuestDef): Promise<void> {
    const account = process.argv.slice(2).find((a) => !a.startsWith('-')) ?? process.env.BOT_USERNAME ?? '';
    const grindLog = join(process.cwd(), 'bots', account, 'grind.log');
    const hookPath = process.env.QUEST_ASSIST_HOOK;
    const hook: AssistHook | null = hookPath ? await import(resolve(process.cwd(), hookPath)) : null;
    const assist = new Set((process.env.QUEST_ASSIST ?? 'travel,items').split(',').map((s) => s.trim()));
    const teleport = hook?.travel && assist.has('travel') ? hook.travel : null;
    const spawn = hook?.give && assist.has('items') ? hook.give : null;
    const prepareOnly = process.argv.includes('--prepare-only');
    const stageIds = def.stages.map((s) => s.id);
    const completeId = stageIds[stageIds.length - 1] ?? '';
    const isTask = !!def.task;

    const result = await runScript(async ({ bot, sdk }) => {
        const log = (msg: string) => {
            console.log(msg);
            try {
                appendFileSync(grindLog, `${new Date().toISOString()} [${def.id}] ${msg}\n`);
            } catch {
                /* the log must never break a run */
            }
        };
        const session = new ActivitySession(sdk, bot, { name: def.id, grindLogPath: grindLog, maxRecoveryTactics: 8 });
        const pos = () => {
            const p = sdk.getState()?.player;
            return { x: p?.worldX ?? 0, z: p?.worldZ ?? 0, level: p?.level ?? 0 };
        };
        const away = (tile: Tile) => Math.hypot(pos().x - tile.x, pos().z - tile.z);

        /** The last stage whose rule PASSes is the account's real stage. */
        async function readStage(): Promise<string | null> {
            for (const stage of [...def.stages].reverse()) {
                const read = await readJournalCheckpoint(sdk, def.journal!, stage.rule);
                if (read.verdict?.verdict === 'PASS') return stage.id;
            }
            return null;
        }

        let run: RunHandle | null = null;
        const recorded = new Set<string>();
        async function checkpoint(id: string): Promise<boolean> {
            const rule = def.stages.find((s) => s.id === id)!.rule;
            const read = await readJournalCheckpoint(sdk, def.journal!, rule);
            const verdict = read.verdict?.verdict ?? 'UNKNOWN';
            if (run) {
                appendCheckpoint(run.directory, { checkpointId: id, verdict, reason: read.reason, kind: rule.kind, rawLines: read.rawLines });
            }
            log(`CHECKPOINT ${id} ${verdict} — ${read.reason}`);
            if (verdict === 'PASS') recorded.add(id);
            return verdict === 'PASS';
        }

        await bot.skipTutorial();
        await closeUi(bot, sdk);

        // The fleet image's journal reader does not retry; the quest tab streams in
        // late after login and a first read can come back empty.
        let start = isTask ? '' : await readStage();
        for (let i = 0; !isTask && !start && i < 3; i++) {
            await sdk.waitForTicks(5);
            start = await readStage();
        }
        if (start === null) throw new Error('could not read the quest stage from the journal');
        if (!isTask) log(`stage at start: ${start}`);

        // A resumed run can only demonstrate the stages still ahead of it.
        if (!isTask) run = createRun(join(process.cwd(), 'quest-lab', 'runs'), safeRunId(def.id, account, new Date().toISOString()), {
            questId: def.id,
            account,
            mode: process.env.QUEST_LAB_MODE === 'staging' ? 'staging' : 'development',
            scriptHash: Bun.hash(await Bun.file(process.argv[1]!).text()).toString(16),
            fixtureHash: process.env.QUEST_LAB_FIXTURE_HASH ?? 'unrecorded',
            contentHash: process.env.QUEST_LAB_CONTENT_HASH ?? 'unrecorded',
            requiredCheckpoints: stageIds.slice(stageIds.indexOf(start)),
        });
        if (run && (teleport || spawn)) {
            // Marked before anything happens so even a partial assisted run can never grade as PASS.
            const what = [teleport && 'travel', spawn && 'items'].filter(Boolean).join('+');
            writeFileSync(join(run.directory, 'assisted.json'), JSON.stringify({ assisted: true, what, reason: hook!.reason, hook: hookPath, at: new Date().toISOString() }) + '\n');
            log(`ASSISTED run (${what}): ${hook!.reason} — proves steps and dialog, not the route`);
        }
        if (run) await checkpoint(start);
        if (run && start === completeId) {
            log('already complete — nothing to do');
            return summarizeRun(run.directory).ok;
        }
        if (def.skills && !requireSkills({ sdk, bot, session, log }, def.skills).ok) {
            throw new Error('skill gate: account cannot do this quest yet');
        }

        const q: Quest = {
            sdk,
            bot,
            log,
            stage: start,
            count: (item) => {
                if (typeof item !== 'string') return countItems(sdk, item);
                const group = GROUPS[item];
                if (!group) return countItems(sdk, itemPattern(item));
                const usable = group.filter((m) => q.level(m.skill) >= m.level).map((m) => itemPattern(m.item));
                return [...sdk.getInventory(), ...sdk.getEquipment()].filter((i) => usable.some((p) => p.test(i.name))).length;
            },
            level: (skill) => sdk.getSkill(skill)?.baseLevel ?? 0,
            async ensureLevel(skill, level) {
                if (q.level(skill) >= level) return;
                const trainer = TRAINERS[skill];
                if (!trainer) throw new Error(`need ${skill} ${level}, have ${q.level(skill)}, and no trainer for it`);
                await session.setPhase(`train ${skill}`);
                const t0 = tickNow(sdk);
                log(`training ${skill} ${q.level(skill)} -> ${level}`);
                await trainer.train(q, level);
                if (q.level(skill) < level) throw new Error(`training left ${skill} at ${q.level(skill)}/${level}`);
                log(`trained ${skill} to ${q.level(skill)} in ${tickNow(sdk) - t0}t`);
            },
            async goTo(tile, tolerance = 4) {
                if (teleport) {
                    if (!(await teleport(sdk, tile)) || away(tile) > Math.max(tolerance, 2)) {
                        throw new Error(`assisted travel to (${tile.x},${tile.z}) did not land`);
                    }
                    session.noteProgress('location', `${tile.x},${tile.z}`);
                    return;
                }
                const t0 = tickNow(sdk);
                const from = pos();
                // walkTo cannot route between planes: from Sanfew's upstairs it reported
                // the ground-floor target "unroutable" and travelTo's fallback took ~270t
                // (druid, 2026-10-28). Change plane where we stand, then walk.
                if (pos().level !== (tile.level ?? 0)) await q.climbTo(tile.level ?? 0);
                // Buildings whose doorway the client map gets wrong (lib/doors.ts).
                if (away(tile) > tolerance) await leaveStuckArea(sdk, bot, tile, log);
                const viaTravel = async () => {
                    const res = await travelTo(sdk, bot, tile, { log, tolerance: TRAVEL_ARRIVAL });
                    if (!res.ok) log(`travel stopped ${Math.round(away(tile))} tiles short (${res.reason})`);
                };
                // bot.walkTo first at any distance: it pathfinds the whole mainland and opens
                // doors and gates. travelTo's hops cannot, and stalled 10-20s per leg at the
                // sheep pen, ~200 ticks at Falador's wall on Doric's mine leg, and looped at
                // the same wall on Druid's 276-tile rats -> bears leg (2026-10-28). travelTo
                // stays as the fallback for routes walkTo cannot find.
                if (away(tile) > tolerance) {
                    // walkTo measures arrival its own way; trust its success.
                    let res = await bot.walkTo(tile.x, tile.z, tolerance);
                    if (!res.success) {
                        log(`walkTo (${tile.x},${tile.z}) failed (${res.message}); trying travelTo`);
                        await viaTravel();
                        res = await bot.walkTo(tile.x, tile.z, tolerance);
                    }
                    if (!res.success) throw new Error(`approach to (${tile.x},${tile.z}) failed: ${res.message}`);
                }
                log(`goTo (${tile.x},${tile.z}) from (${from.x},${from.z}): ${tickNow(sdk) - t0}t`);
                session.noteProgress('location', `${tile.x},${tile.z}`);
            },
            async reach(pattern, withOption) {
                const find = async () => {
                    await sdk.scanNearbyLocs(15).catch(() => undefined);
                    return sdk.findNearbyLoc(pattern, withOption ? { withOption } : undefined);
                };
                for (let i = 0; i < 4; i++) {
                    const loc = await find();
                    if (!loc) throw new Error(`no ${pattern} near the player`);
                    if (loc.reachable !== false) return;
                    const door = (sdk.getNearbyLocs() ?? [])
                        .filter((l) => /door|gate/i.test(l.name) && l.reachable !== false && l.options?.some((o) => /^open$/i.test(o)))
                        .sort((a, b) => Math.hypot(a.x - loc.x, a.z - loc.z) - Math.hypot(b.x - loc.x, b.z - loc.z))[0];
                    if (!door) break;
                    log(`opening ${door.name} at (${door.x},${door.z}) toward ${loc.name}`);
                    await bot.openDoor(door);
                    await sdk.waitForTicks(2);
                }
                if ((await find())?.reachable === false) throw new Error(`${pattern} is not reachable`);
            },
            async climbTo(level) {
                for (let i = 0; i < 6; i++) {
                    const now = pos().level;
                    if (now === level) return;
                    // Draynor Manor's staircases say Walk-up / Walk-down.
                    const opt = now < level ? /climb-up|climb up|walk-up/i : /climb-down|climb down|walk-down/i;
                    // Only stairs/ladders beside us, reachable first. Opening doors toward
                    // "the nearest" one let the bot pick a ladder 24 tiles off and climb a
                    // castle tower instead of the stairs it stood at (sheep, 2026-10-28).
                    const near = async () => {
                        await sdk.scanNearbyLocs(12).catch(() => undefined);
                        return (sdk.getNearbyLocs() ?? [])
                            .filter((l) => /stair|ladder/i.test(l.name) && l.options?.some((o) => opt.test(o)) && (l.distance ?? 99) <= 12)
                            .sort((a, b) => (a.distance ?? 99) - (b.distance ?? 99));
                    };
                    let loc = (await near()).find((l) => l.reachable !== false);
                    if (!loc) {
                        // From a closed room (the castle wheel room) the stairs are behind a door.
                        await q.reach(/stair|ladder/i, opt).catch(() => undefined);
                        loc = (await near()).find((l) => l.reachable !== false);
                    }
                    if (!loc) throw new Error(`no stairs/ladder to climb ${now < level ? 'up' : 'down'} near the player`);
                    await bot.interactLoc(loc, opt);
                    await untilTicks(sdk, (s) => (s.player?.level ?? now) !== now, 30);
                }
                if (pos().level !== level) throw new Error(`could not reach plane ${level}`);
            },
            async talk(npc, choices = [], at) {
                await closeUi(bot, sdk);
                // Only get near: bot.talkTo routes to the NPC itself, gates and fences included.
                if (at) {
                    await q.goTo(at, teleport ? 2 : APPROACH);
                    // A wandering npc can be out of view from the edge of APPROACH: Romeo
                    // was not seen from 13 tiles off his square (2026-10-29). Close in on `at`.
                    if (!teleport && !(await untilTicks(sdk, () => !!sdk.findNearbyNpc(npc), 5))) await q.goTo(at, 3);
                }
                const seen = await talkThrough(sdk, bot, npc, choices, log);
                session.noteProgress('dialog', String(npc));
                return seen;
            },
            async ensure(item, count) {
                const have = q.count(item);
                if (have >= count) return;
                const source = SOURCES[item];
                if (spawn && source?.spawnable !== false) {
                    await closeUi(bot, sdk);
                    await spawn(sdk, source?.obj ?? item.toLowerCase().replace(/ /g, '_'), count - have);
                    if (q.count(item) < count) throw new Error(`assisted spawn of ${count - have} ${item} did not arrive`);
                    log(`spawned ${count - have} ${item}`);
                    session.noteProgress('inventory', item);
                    return;
                }
                if (source?.mule) throw new NeedsStock([{ item, count: count - have }]);
                if (!source?.get) throw new Error(`need ${count} ${item}, have ${have}, and no source procedure for it`);
                for (const [skill, level] of Object.entries(source.levels ?? {})) await q.ensureLevel(skill, level);
                log(`sourcing ${count - have} ${item}`);
                await source.get(q, count);
                if (q.count(item) < count) throw new Error(`source for ${item} left ${q.count(item)}/${count}`);
                session.noteProgress('inventory', item);
            },
            supply: {
                sdk,
                bot,
                log,
                intent: (msg) => void session.showIntent(msg),
                walkNear: async (x, z, tolerance = 3) => {
                    try {
                        await q.goTo({ x, z }, tolerance);
                        return true;
                    } catch (err) {
                        log(`walkNear (${x},${z}): ${err instanceof Error ? err.message : String(err)}`);
                        return false;
                    }
                },
                closeUi: () => closeUi(bot, sdk),
            },
        };

        // ── prologue: naked at the hub, bank stock withdrawn toward the quest's needs
        const hub = SAFE_BANKS[def.hub];
        if (pos().level !== 0) await q.climbTo(0);
        await q.goTo(hub, 4);
        const startAt = pos();
        await depositAllInventory(q.supply);
        if (!spawn) await withdrawTowardNeeds(q, def.transitions.slice(def.transitions.findIndex((t) => t.from === start)));
        await bot.closeBank().catch(() => undefined);
        log(`prologue: naked at ${def.hub} (${startAt.x},${startAt.z}); carrying ${describeInventory(sdk)}`);

        // ── prepare: every sourced item the rest of the quest needs, before any quest step
        const remaining = def.transitions.slice(def.transitions.findIndex((t) => t.from === start));
        // Mule-supplied stock first: the prologue has withdrawn what the bank holds, so a
        // shortfall now means the account was never stocked — stop before walking anywhere.
        const mule = mergeNeeds(remaining.flatMap((t) => t.needs ?? [])).filter((n) => SOURCES[n.item]?.mule);
        if (spawn) for (const need of mule) if (!needMet(q, need)) await q.ensure(need.item, need.count);
        const short = mule.filter((n) => !needMet(q, n)).map((n) => ({ item: n.item, count: n.count - q.count(n.item) }));
        if (short.length) throw new NeedsStock(short);
        const prep = preparableNeeds(remaining);
        if (prep.length) {
            await session.setPhase('prepare');
            log(`prepare: ${prep.map((n) => `${n.count} ${n.item}`).join(', ')}`);
            for (const need of prep) if (!needMet(q, need)) await q.ensure(need.item, need.count);
            log(`prepared; carrying ${describeInventory(sdk)}`);
        }

        if (def.task && !prepareOnly) {
            await session.setPhase(def.id);
            await def.task(q);
        }

        // ── transitions until the journal says complete
        const retries = def.retries ?? 3;
        let attempts = 0;
        while (!isTask && !prepareOnly && q.stage !== completeId) {
            if (session.stopRequested) {
                log('stop requested — returning to the hub');
                break;
            }
            const t = def.transitions.find((x) => x.from === q.stage);
            if (!t) throw new Error(`no transition from stage ${q.stage} — the quest definition is incomplete`);
            if (++attempts > retries) throw new Error(`transition ${t.from} → ${t.to} failed ${retries} times`);
            log(`transition ${t.from} → ${t.to} (attempt ${attempts})`);
            await session.setPhase(`${t.from}->${t.to}`);

            for (const need of t.needs ?? []) if (!needMet(q, need)) await q.ensure(need.item, need.count);
            if (t.talk) await q.talk(t.talk.npc, t.talk.choices ?? [], t.at);
            else if (t.at) await q.goTo(t.at, teleport ? 2 : 4);
            if (t.run) await t.run(q);
            await closeUi(bot, sdk);

            // The journal write can trail the dialog by a few ticks (Doric's hand-in
            // completes through a queue); settle before calling the attempt failed.
            let now = await readStage();
            for (let i = 0; i < 4 && now === q.stage; i++) {
                await sdk.waitForTicks(4);
                now = await readStage();
            }
            if (now && now !== q.stage) {
                if (now !== t.to) log(`WARN expected ${t.to}, journal says ${now}`);
                q.stage = now;
                attempts = 0;
                if (!recorded.has(now)) await checkpoint(now);
            }
        }

        // ── epilogue: back to the hub, naked, where the run started
        if (pos().level !== 0) await q.climbTo(0);
        await q.goTo(hub, 4);
        await depositAllInventory(q.supply);
        await bot.closeBank().catch(() => undefined);
        const end = pos();
        // At the hub bank, not on the prologue's exact tile: both stop anywhere near the booths.
        const endOk = Math.hypot(end.x - hub.x, end.z - hub.z) <= 6 && sdk.getInventory().length === 0 && sdk.getEquipment().length === 0;
        log(`epilogue: ${endOk ? 'END STATE OK' : 'WARN END STATE MISMATCH'} at (${end.x},${end.z}) carrying ${describeInventory(sdk)}`);

        if (prepareOnly) {
            log('PREPARED — items banked at the hub for the quest run');
            return 'prepared';
        }
        if (isTask) {
            log(`TASK DONE ${def.id}`);
            return 'prepared';
        }
        if (q.stage !== completeId || !run) return false;
        const summary = summarizeRun(run.directory);
        if (!summary.ok) throw new Error(`evidence gate failed: missing ${JSON.stringify(summary.missing)}`);
        if (teleport || spawn) {
            log(`ASSISTED COMPLETE (journal-verified) — exit ${ASSISTED_EXIT}; an unassisted run must still pass`);
            return 'assisted';
        }
        log('QUEST COMPLETE (journal-verified)');
        return true;
    });

    if (result.error instanceof NeedsStock) {
        console.log(result.error.message);
        process.exit(NEEDS_STOCK_EXIT);
    }
    if (result.success && result.result === 'assisted') process.exit(ASSISTED_EXIT);
    process.exit(result.success && (result.result === true || result.result === 'prepared') ? 0 : 1);
}

/**
 * At the open hub bank: for each item the remaining transitions need, withdraw
 * what the bank holds; for any shortfall, withdraw the source's inputs instead
 * (shears for wool, coins for shears), recursively.
 */
async function withdrawTowardNeeds(q: Quest, transitions: Transition[]): Promise<void> {
    const want = mergeNeeds(transitions.flatMap((t) => t.needs ?? []));

    // Consumed items add up across everything that claims them (Goblin Diplomacy:
    // the orange and the blue mail each use up one goblin mail, the hand-in needs a
    // third; each Aggie dye costs 5 coins). A tool is claimed once.
    const claimed = new Map<string, number>();
    const visit = async (item: string, count: number, depth: number) => {
        if (depth > 4 || count <= 0) return;
        const tool = !!SOURCES[item]?.tool || !!GROUPS[item];
        if (tool && claimed.has(item)) return;
        const target = tool ? count : (claimed.get(item) ?? 0) + count;
        claimed.set(item, target);
        // A group ('pickaxe') takes the best member the account can use.
        const names = GROUPS[item]?.filter((m) => q.level(m.skill) >= m.level).map((m) => m.item) ?? [item];
        const banked = names.map((n) => q.sdk.findBankItem(itemPattern(n))).find(Boolean);
        const take = Math.min(target - q.count(item), banked?.count ?? 0);
        if (banked && take > 0) {
            await q.bot.withdrawItem(banked, take);
            await q.sdk.waitForTicks(2);
            q.log(`withdrew ${take} ${item}`);
        }
        // Only this claim's part of the shortfall: earlier claims already visited their inputs.
        const short = Math.min(count, target - q.count(item));
        if (short <= 0) return;
        for (const input of SOURCES[item]?.inputs?.(short) ?? []) await visit(input.item, input.count, depth + 1);
    };
    for (const need of want) {
        // A quest-processed form already in the bank (a resumed run) counts first.
        if (need.or) await visit(need.or, need.count, 0);
        if (!needMet(q, need)) await visit(need.item, need.count, 0);
    }
}

/** One entry per item (highest count wins), in first-seen order — the order prepare gathers in. */
function mergeNeeds(needs: Need[]): Need[] {
    const out = new Map<string, Need>();
    for (const n of needs) {
        const prev = out.get(n.item);
        out.set(n.item, { ...n, count: Math.max(prev?.count ?? 0, n.count) });
    }
    return [...out.values()];
}

/** Needs the prepare phase can produce: those with a source that is not quest-tracked. Max count per item. */
function preparableNeeds(transitions: Transition[]): Need[] {
    return mergeNeeds(transitions.flatMap((t) => t.needs ?? [])).filter((n) => {
        const source = SOURCES[n.item];
        return source?.get && source.spawnable !== false;
    });
}

function describeInventory(sdk: BotSDK): string {
    const inv = sdk.getInventory().map((i) => `${i.name}${(i.count ?? 1) > 1 ? ` x${i.count}` : ''}`);
    const worn = sdk.getEquipment().map((i) => i.name);
    return [inv.length ? inv.join(', ') : 'nothing', worn.length ? `wearing ${worn.join(', ')}` : ''].filter(Boolean).join('; ');
}
