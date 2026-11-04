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
import type { NearbyLoc } from '../../../sdk/types';
import { runScript } from '../../../sdk/runner';
import { ActivitySession } from '../../../sdk/activity';
import { readJournalCheckpoint } from '../../../quest-lab/journal-reader';
import { appendCheckpoint, createRun, safeRunId, summarizeRun, type RunHandle } from '../../../quest-lab/records';
import type { JournalRule } from '../../../quest-lab/evidence';
import { travelTo, type Tile } from '../travel';
import { crossAlKharidToll, TOLL_X } from '../alkharid-toll';
/** The Al Kharid border toll. Local: the fleet's alkharid-toll.ts does not export TOLL_FEE. */
const TOLL_FEE = 10;
import { closeUi } from '../movement';
import { countItems, requireSkills } from '../quest-lib';
import { depositAllInventory, type SupplyCtx } from '../quest-supplies';
import { requestFromMule } from '../supply';
import { SAFE_BANKS, type SafeBankName } from '../safe-stops';
import { GROUPS, itemPattern, mulesFor, needMet, SOURCES, type Need } from './sources';
import { TRAINERS } from './training';
import { talkThrough } from './dialog';
import { enterStuckArea, leaveStuckArea } from './doors';
import { escapeMaze, inLeverMaze, leaveManor, onManorGround } from './draynor-manor';
import { fortressRoom, leaveFortress } from './fortress';
import { inArenaCompound, leaveArena } from './fight-arena';
import { inSeerHouse, leaveSeerHouse } from './fremennik';
import { inEssenceMine, leaveEssenceMine } from './mining';
import { inDungeon as inEntranaDungeon, teleportOut as teleportOutOfEntranaDungeon } from './lost-city';
import { crossGnomeGate, inStronghold, leaveGrandTree } from './gnome-stronghold';
import { spiritTreeShortcut } from './spirit-trees';
import { inWaterfallArea, leaveWaterfall } from './waterfall';
import { inPlagueArea, leavePlagueCity } from './plague-city';
import { inJungleArea, leaveJungle, onIsland as onJungleIsland } from './jungle-potion';
import { inShiloArea, leaveShilo } from './shilo-village';
import { inUpassArea, leaveUpass } from './underground-pass';
import { inKeepArea, leaveKeep } from './merlins-crystal';
import { inArravBuilding, leaveBuildings as leaveArravBuildings } from './shield-of-arrav';
import { inHeroesArea, leaveHeroesAreas } from './heroes-quest';
import { inCrestUnderground, leaveCrestUnderground } from './crest';
import { inLegendsArea, leaveLegends } from './legends-quest';
import { inMelzarsMaze, leaveMelzarsMaze } from './melzars-maze';
import { inMansionUpstairs, leaveMansionUpstairs } from './sinclair-mansion';
import { inGrailArea, leaveGrail } from './holy-grail';
import { inContest, leaveContest } from './fishing-contest';
import { inCultCave, leaveCave as leaveCultCave } from './hazeel-cult';
import { inGnomeVillage, inKhazardStronghold, leaveGnomeVillage, leaveKhazardStronghold } from './tree-gnome-village';
import { inGrandTreeArea, leaveGrandTreeArea } from './grand-tree';
import { inMillYard, leaveMill } from './gertrudes-cat';
import { inCannonArea, leaveCannonArea } from './dwarf-cannon';
import { inWatchtowerArea, leaveWatchtowerArea } from './watchtower';
import { inObservatoryArea, leaveObservatory } from './observatory';
import { inTouristTrapArea, leaveTouristTrap } from './tourist-trap';
import { inDigShafts, leaveShafts as leaveDigShafts } from './dig-site';
import { inIkovArea, leaveIkov } from './temple-of-ikov';
import { inScorpionArea, leaveScorpionArea } from './scorpion-catcher';
import { inWorkshopArea, leaveWorkshop } from './elemental-workshop';
import { inNatureSpiritArea, leaveNatureSpirit } from './nature-spirit';
import { inMyrequeArea, leaveMyreque } from './myreque';
import { inRegicideArea, leaveRegicide } from './regicide';
import { inHorrorArea, leaveHorror } from './horror';
import { inChompyArea, leaveChompyCave } from './chompybird';
import { inTrollArea, leaveTrollArea } from './troll-stronghold';
import { inHauntedMineArea, leaveHauntedMine } from './haunted-mine';
import { inMiscArea, leaveIsland as leaveMiscellania } from './miscellania';
import { inRomanceArea, leaveRomanceArea } from './troll-romance';
import { inMorttonSouth, leaveMortton } from './shades-of-mortton';
import { inHuntCutscene, inTbwtIsland, leaveTbwt, waitOutCutscene } from './tai-bwo-wannai-trio';
import { tickNow, ticksToMs, untilTicks } from './ticks';
import { fmtTile } from './floors';
import { acquireQuestSlot, awaitQuestStartTurn, QUEST_SLOTS, sleepWithoutClient } from './no-client-waits';

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
    /** SIGTERM seen (the todo-runner's cap, a restart): a long task stops at its next bank and lets the epilogue run. */
    stopRequested: () => boolean;
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
    /** Up or down to `level` by the nearest stairs/ladder; `toward` is the destination, for the log. */
    climbTo: (level: number, toward?: { x: number; z: number }) => Promise<void>;
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
    /**
     * A stage the content can pass through in one dialog without the journal ever
     * showing it (Fight Arena: the ogre's death runs Khazard's "well done" and the
     * march to the cells when he is near). Still detected on resume; not a required
     * checkpoint.
     */
    optional?: boolean;
}

export interface Transition {
    from: string;
    to: string;
    /** Where the transition happens. Walked near (talkTo finishes the approach); assisted runs land on it. */
    at?: Tile;
    /** Items to hold before acting. */
    /**
     * Items this transition needs. A function is evaluated against the account (inventory,
     * and the bank while it is open): Demon Slayer drops the 25 bones once Traiborn's key is held.
     */
    needs?: Need[] | ((q: Quest) => Need[]);
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
    /**
     * Journal titles of quests that must be complete before an unstarted run begins (Holy Grail
     * without Merlin's Crystal looped on King Arthur's knight dialog; Myreque without Nature Spirit
     * died at the holy barrier, 2026-11-04). Checked only at the first stage; resumed runs skip it.
     */
    requires?: string[];
    /**
     * Quest items picked up along the way (Witch's House's magnet). A resumed run's
     * naked prologue banks them, and some quests will not hand out another while one
     * is banked, so the prologue withdraws these again.
     */
    carry?: Array<string | number>;
    /** Attempts per transition before giving up (default 3). */
    retries?: number;
    /** Stages at which the prologue skips the walk to the hub and its banking (the run carries on from where it stands). */
    noHubAt?: string[];
    /**
     * Fleet accounts allowed in this quest at once (default QUEST_SLOTS). Shared NPCs,
     * doors and drops (Keli, the maze, imps) break when a rollout puts many in together.
     */
    maxConcurrent?: number;
    /**
     * Task mode (no journal): run this between the hub prologue and epilogue
     * instead of transitions. For units like training that are not quests.
     */
    task?: (q: Quest) => Promise<void>;
}

/** A unit of work that is not a quest: same hub prologue/epilogue, no journal. */
export function runTask(def: { id: string; hub: SafeBankName; needs?: Need[]; maxConcurrent?: number; task: (q: Quest) => Promise<void> }): Promise<void> {
    return runQuest({ id: def.id, hub: def.hub, stages: [], transitions: def.needs ? [{ from: '', to: '', needs: def.needs }] : [], maxConcurrent: def.maxConcurrent, task: def.task });
}

/** Al Kharid, behind the toll fence (x >= 3268) and south of the Varrock road. */
const inAlKharid = (t: Tile) => t.x >= TOLL_X && t.z > 3080 && t.z < 3300;

/** How long the prepare phase waits on a mule's trade (Source.muleSupply) before sourcing the item itself. */
// 600, not 200: jackthief serves one account at a time, and a 200-tick wait gave up on
// jacklove2's bread 1 s before the mule's trade opened (2026-11-02, Merlin's Crystal).
const MULE_WAIT_TICKS = 600;
/** Karamja: walkTo and travelTo have no way off the island. */
// Whole island, west to Brimhaven's side (jacklove13 at 2804,3179 was outside the old
// Musa Point box, 2026-10-29); the north edge stays below the Rimmington coast.
const onKaramja = (t: Tile) => t.x >= 2740 && t.x <= 2990 && t.z >= 2880 && t.z <= 3200;
/** Karamja customs officers (2953,3147)/(2955,3146): the boat back to Port Sarim, 30gp. */
const KARAMJA_CUSTOMS = { x: 2954, z: 3147 };
/** A man by the customs officers (npc spawn 2948,3146): pickpocketed for the fare when broke. */
const KARAMJA_MAN = { x: 2948, z: 3146 };
const KARAMJA_FARE = 30;
/** Entrana: the island side's sailing monks (shipmonk2 at 2830-2839,3335) take you back to Port Sarim. */
const onEntrana = (t: Tile) => t.x >= 2800 && t.x <= 2880 && t.z >= 3320 && t.z <= 3400;
const ENTRANA_DOCK = { x: 2835, z: 3336 };
/** Dungeons and cellars are mapped at z + 6400. */
const UNDERGROUND_Z = 6400;
const MAGIC_TAB = 6;
const FALADOR_TELEPORT = 1170;
const CAMELOT_TELEPORT = 1174;
const LUMBRIDGE_TELEPORT = 1167;
/** Ladders up that are out of view from much of their dungeon: the Taverley dungeon's (lib/taverley-dragons.ts). */
const KNOWN_LADDERS_UP: Tile[] = [{ x: 2884, z: 9797 }];
/** Arrival radius goTo asks travelTo for before bot.walkTo finishes the approach. */
const APPROACH = 15;
/** Where goTo lets travelTo stop: on the road, before a fenced or walled destination. */
const TRAVEL_ARRIVAL = 20;
/** Errors that mean the game client or gateway went away, not that the quest failed. */
const OUTAGE = /client disconnected|no game client is attached|gateway handshake|connection closed before/i;
const OUTAGE_RETRIES = 10;
const OUTAGE_WAIT_MS = 60_000;
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

    const body: Parameters<typeof runScript>[0] = async ({ bot, sdk }) => {
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
        /** Where we stand, plane included: a right-x,z-wrong-floor bug reads as (2984,3336,L1). */
        const whereAt = () => fmtTile(pos());

        /** Customs boat back to Port Sarim, then over the gangplank (pirates-treasure.ts sail). */
        async function sailFromKaramja(): Promise<void> {
            // Broke on the island (jacklove13 spent its coins on the rum and fare out, 2026-10-29):
            // pickpocket the man by the customs officers until the fare is in hand.
            if (q.count('coins') < KARAMJA_FARE) {
                await q.goTo(KARAMJA_MAN, 4);
                const t0 = tickNow(sdk);
                for (let tries = 0; q.count('coins') < KARAMJA_FARE && tries < 60 && tickNow(sdk) - t0 < 1500; tries++) {
                    const man = sdk.findNearbyNpc(/^man$/i);
                    if (!man) {
                        await q.goTo(KARAMJA_MAN, 2);
                        await sdk.waitForTicks(5);
                        continue;
                    }
                    const r = await bot.pickpocketNpc(man).catch((e) => ({ success: false, message: String(e) }));
                    if (!r.success && tries % 10 === 0) log(`Karamja fare pickpocket: ${r.message}`);
                    await sdk.waitForTicks(2);
                }
                log(`pickpocketed for the Karamja fare: ${q.count('coins')} coins in ${tickNow(sdk) - t0}t`);
            }
            for (let i = 0; i < 3 && onKaramja(pos()); i++) {
                await q.talk(/^customs officer$/i, [/can i journey on this ship/i, /search away/i, /^ok\.?$/i], KARAMJA_CUSTOMS);
                await untilTicks(sdk, () => !onKaramja(pos()), 30);
            }
            if (onKaramja(pos())) throw new Error(`the boat from Karamja never sailed (at ${pos().x},${pos().z}; coins ${q.count('coins')})`);
            for (let i = 0; i < 4 && pos().level !== 0; i++) {
                await sdk.scanNearbyLocs(8).catch(() => undefined);
                const plank = sdk.findNearbyLoc(/gangplank/i, { withOption: /cross/i });
                if (plank) await bot.interactLoc(plank, /cross/i);
                await untilTicks(sdk, (s) => (s.player?.level ?? 1) === 0, 10);
            }
            log(`sailed back from Karamja to (${pos().x},${pos().z})`);
        }

        /** The Entrana monks' boat back to Port Sarim (monk_of_entrana.rs2 shipmonk2), then over the gangplank. */
        async function sailFromEntrana(): Promise<void> {
            for (let i = 0; i < 3 && onEntrana(pos()); i++) {
                await q.talk(/^monk of entrana$/i, [/yes,? i'?m ready to go/i], ENTRANA_DOCK);
                await untilTicks(sdk, () => !onEntrana(pos()), 30);
            }
            if (onEntrana(pos())) throw new Error(`the Entrana monks did not sail us (at ${pos().x},${pos().z})`);
            for (let i = 0; i < 4 && pos().level !== 0; i++) {
                await sdk.scanNearbyLocs(8).catch(() => undefined);
                const plank = sdk.findNearbyLoc(/gangplank/i, { withOption: /cross/i });
                if (plank) await bot.interactLoc(plank, /cross/i).catch(() => undefined);
                await untilTicks(sdk, (s) => (s.player?.level ?? 1) === 0, 10);
            }
            log(`sailed back from Entrana to (${pos().x},${pos().z})`);
        }

        /** Falador Teleport (Magic 37: 1 law, 3 air, 1 water) when the pack holds the runes; true once above ground. */
        async function faladorTeleport(): Promise<boolean> {
            const magic = sdk.getSkill('magic')?.level ?? 1;
            // Falador (37: 1 law 3 air 1 water), else Camelot (45: 1 law 5 air) — the Brimhaven
            // dragon kit carries Camelot runes only, and a shepherd restart left ABGARMY08 in the
            // dungeon failing every quest at "no path" (2026-11-03). Then Lumbridge (31: 1 law 3 air 1 earth).
            const options = [
                { name: 'Falador', id: FALADOR_TELEPORT, ok: magic >= 37 && q.count('law rune') >= 1 && q.count('air rune') >= 3 && q.count('water rune') >= 1 },
                { name: 'Camelot', id: CAMELOT_TELEPORT, ok: magic >= 45 && q.count('law rune') >= 1 && q.count('air rune') >= 5 },
                { name: 'Lumbridge', id: LUMBRIDGE_TELEPORT, ok: magic >= 31 && q.count('law rune') >= 1 && q.count('air rune') >= 3 && q.count('earth rune') >= 1 },
            ].filter((o) => o.ok);
            for (const spell of options) {
                for (let attempt = 1; attempt <= 3 && pos().z >= UNDERGROUND_Z; attempt++) {
                    await sdk.sendSetTab(MAGIC_TAB).catch(() => undefined);
                    await sdk.waitForTicks(1);
                    await sdk.sendClickComponent(spell.id);
                    await untilTicks(sdk, () => pos().z < UNDERGROUND_Z, 7);
                }
                if (pos().z < UNDERGROUND_Z) {
                    log(`teleported out of the underground to ${spell.name} (${pos().x},${pos().z})`);
                    return true;
                }
            }
            return false;
        }

        /** Up the nearest reachable ladder/stairs until above ground; logs and returns if there is none in view. */
        async function climbOutOfUnderground(dest: Tile): Promise<void> {
            const up = /climb-up|climb up|walk-up/i;
            const ladderUp = async () => {
                await sdk.scanNearbyLocs(25).catch(() => undefined);
                return (sdk.getNearbyLocs() ?? [])
                    .filter((l) => /stair|ladder/i.test(l.name) && l.options?.some((o) => up.test(o)) && l.reachable !== false)
                    .sort((a, b) => (a.distance ?? 99) - (b.distance ?? 99))[0];
            };
            for (let i = 0; i < 4 && pos().z >= UNDERGROUND_Z; i++) {
                // A shut room (lib/doors.ts) first: the ladder is out of sight from inside it.
                for (let d = 0; d < 3 && (await leaveStuckArea(sdk, bot, dest, log)); d++);
                let loc = await ladderUp();
                if (!loc) {
                    // Shut in a room (the Wizards' Tower basement's side rooms, ABGARMY03
                    // 2026-10-29): open the doors toward the ladder, as climbTo does.
                    await q.reach(/stair|ladder/i, up).catch(() => undefined);
                    loc = await ladderUp();
                }
                if (!loc) {
                    // A job restarted mid-dungeon with its teleport runes still packed: cast out
                    // rather than walk a cave with no way up in view (jacklove10, Taverley
                    // dungeon after a deploy restart, 2026-10-31).
                    if (await faladorTeleport()) return;
                    // Out of runes: walk to a known way up on this level, then look again (jacklove10
                    // restarted at the Dusty-key gate with no teleport runes, 2026-10-31).
                    const known = KNOWN_LADDERS_UP.filter((t) => Math.hypot(t.x - pos().x, t.z - pos().z) < 250)
                        .sort((a, b) => Math.hypot(a.x - pos().x, a.z - pos().z) - Math.hypot(b.x - pos().x, b.z - pos().z))[0];
                    if (known && Math.hypot(known.x - pos().x, known.z - pos().z) > 3) {
                        log(`underground at (${pos().x},${pos().z}): no ladder up in view — walking to the known one at (${known.x},${known.z})`);
                        await q.goTo(known, 2).catch((e) => log(`walk to the ladder at (${known.x},${known.z}): ${(e as Error).message}`));
                        continue;
                    }
                    log(`underground at (${pos().x},${pos().z}): no reachable ladder/stairs up in view`);
                    return;
                }
                await bot.interactLoc(loc, up).catch(() => undefined);
                if (await untilTicks(sdk, () => pos().z < UNDERGROUND_Z, 30)) log(`climbed ${loc.name} out of the underground to (${pos().x},${pos().z})`);
            }
        }

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
            requiredCheckpoints: stageIds.slice(stageIds.indexOf(start)).filter((id, i) => i === 0 || !def.stages.find((st) => st.id === id)?.optional),
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
        // Skills with a trainer (lib/training.ts) are trained in the prologue; the rest gate the run.
        const untrainable = Object.fromEntries(Object.entries(def.skills ?? {}).filter(([skill]) => !TRAINERS[skill]));
        if (Object.keys(untrainable).length && !requireSkills({ sdk, bot, session, log }, untrainable).ok) {
            throw new Error(`skill gate: account cannot do this quest yet (needs ${Object.entries(untrainable).map(([s, l]) => `${s} ${l}`).join(', ')})`);
        }
        if (run && def.requires?.length && start === def.stages[0]!.id) {
            for (const title of def.requires) {
                const read = await readJournalCheckpoint(sdk, { label: title, title }, { id: `requires:${title}`, kind: 'complete', all: ['QUEST COMPLETE'] });
                await sdk.sendCloseModal().catch(() => undefined);
                if (read.verdict?.verdict !== 'PASS') throw new Error(`prerequisite gate: ${title} not complete (journal ${read.verdict?.verdict ?? 'unread'})`);
            }
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
            stopRequested: () => session.stopRequested,
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
                // The Underground Pass and Iban's cavern (level 1, no ladder): out by its own exits before any climb (lib/underground-pass.ts).
                if (inUpassArea(pos()) && !inUpassArea({ ...tile, level: tile.level ?? 0 })) await leaveUpass(q);
                // Regicide: the ruined temple's copy (level 1), the voyage temple and Tirannwn: teleport out (lib/regicide.ts).
                if (inRegicideArea(pos()) && !inRegicideArea({ ...tile, level: tile.level ?? 0 })) await leaveRegicide(q);
                // walkTo cannot route between planes: from Sanfew's upstairs it reported
                // the ground-floor target "unroutable" and travelTo's fallback took ~270t
                // (druid, 2026-10-28). Change plane where we stand, then walk.
                // Inside Black Knights' Fortress with a target away from it: its own room graph
                // out, before climbTo grabs whichever ladder is near (ABGARMY01/18, jacklove8
                // failed every quest from the grill and secret rooms, 2026-10-29).
                // Left in the rune essence mine (fatpig, after its essence grind, 2026-10-29): portal out.
                if (inEssenceMine(sdk.getState()!) && !inEssenceMine({ player: { worldX: tile.x, worldZ: tile.z } })) await leaveEssenceMine(q);
                const room = fortressRoom(q);
                if (room && room !== 'outside' && (Math.abs(tile.x - 3022) > 15 || Math.abs(tile.z - 3512) > 15)) await leaveFortress(q);
                // Fight Arena's pen, cells and corridor: out by their own doors first.
                if (inArenaCompound(pos()) && !inArenaCompound({ ...tile, level: tile.level ?? 0 })) await leaveArena(q);
                // Restarted inside Peer the Seer's house (pigfat, mid-puzzle in the mural room, 2026-10-30).
                if (inSeerHouse(pos()) && !inSeerHouse({ ...tile, level: tile.level ?? 0 })) await leaveSeerHouse(q);
                // Melzar's Maze: the east door wants the Maze key and climbTo would take any ladder in it
                // (ABGARMY09 stranded after Dragon Slayer, 2026-11-01). Out by its own rooms (lib/melzars-maze.ts).
                if (inMelzarsMaze(pos()) && !inMelzarsMaze({ ...tile, level: tile.level ?? 0 })) await leaveMelzarsMaze(bot, sdk, log);
                // The Sinclair Mansion's first floor: its doors hide the ladder from climbTo (lib/sinclair-mansion.ts).
                if (inMansionUpstairs(pos()) && !inMansionUpstairs({ ...tile, level: tile.level ?? 0 })) await leaveMansionUpstairs(q);
                // Holy Grail: the Fisher King's realms (whistle out) and the six heads' pocket north of Brimhaven (lib/holy-grail.ts).
                if (inGrailArea(pos()) && !inGrailArea(tile)) await leaveGrail(q, tile);
                // Fishing Contest: the Hemenster yard's gate teleports you out; walkTo cannot use it (lib/fishing-contest.ts).
                if (inContest(pos()) && !inContest(tile)) await leaveContest(q);
                // Hazeel Cult: the cult cave and the sewer to its hideout — a raft back, then its stairs (lib/hazeel-cult.ts).
                if (inCultCave(pos()) && !inCultCave(tile)) await leaveCultCave(q);
                // Tree Gnome Village: the village's loose railing and the Khazard stronghold's one-way door (lib/tree-gnome-village.ts).
                if (inGnomeVillage(pos()) && !inGnomeVillage({ ...tile, level: tile.level ?? 0 })) await leaveGnomeVillage(q);
                if (inKhazardStronghold(pos()) && !inKhazardStronghold(tile)) await leaveKhazardStronghold(q);
                // The Grand Tree quest: its roots, Glough's upstairs, the tree's top floors and the Karamja shipyard (lib/grand-tree.ts).
                if (inGrandTreeArea(pos()) && !inGrandTreeArea({ ...tile, level: tile.level ?? 0 })) await leaveGrandTreeArea(q);
                // Gertrude's Cat: the lumber mill's fence is climbed, walkTo has no way out (lib/gertrudes-cat.ts).
                if (inMillYard(pos()) && !inMillYard(tile)) await leaveMill(q);
                // Dwarf Cannon: the goblin cave (out by its mud pile) and the watchtower (lib/dwarf-cannon.ts).
                if (inCannonArea(pos()) && !inCannonArea({ ...tile, level: tile.level ?? 0 })) await leaveCannonArea(q);
                // Watchtower: Grew's island, Toban's plateau, the skavid caves, the shamans' enclave, the tower (lib/watchtower.ts).
                if (inWatchtowerArea(pos())) await leaveWatchtowerArea(q, { ...tile, level: tile.level ?? 0 });
                // Observatory: the goblin cavern and the dome on its cliff (lib/observatory.ts).
                if (inObservatoryArea(pos()) && !inObservatoryArea({ ...tile, level: tile.level ?? 0 })) await leaveObservatory(q);
                // Tourist Trap: the mining camp (key gate), its mine (slave clothes) and the desert past the Shantay Pass (lib/tourist-trap.ts).
                if (inTouristTrapArea(pos()) && !inTouristTrapArea({ ...tile, level: tile.level ?? 0 })) await leaveTouristTrap(q);
                // The Dig Site's two shafts: up their ropes (lib/dig-site.ts).
                if (inDigShafts(pos()) && !inDigShafts(tile)) await leaveDigShafts(q);
                // Elemental Workshop: under the Seers smithy, up its stairs and out through the odd wall (lib/elemental-workshop.ts).
                // Before Ikov's: its dungeon box (2620-2760,9730-9920) also covers the workshop.
                if (inWorkshopArea(pos()) && !inWorkshopArea({ ...tile, level: tile.level ?? 0 })) await leaveWorkshop(q);
                // Temple of Ikov's dungeon: gates, the dark stairs and the cellar ladder (lib/temple-of-ikov.ts).
                if (inIkovArea(pos()) && !inIkovArea(tile)) await leaveIkov(q);
                // Scorpion Catcher: the Barbarian Outpost (out by its gate), the Sorcerer's Tower, Taverley's secret room (lib/scorpion-catcher.ts).
                if (inScorpionArea(pos()) && !inScorpionArea({ ...tile, level: tile.level ?? 0 })) await leaveScorpionArea(q);
                // In Search of the Myreque: the hollows' landing (boat), north of the bridge, Mort'ton's dock, the tunnels and hideout (lib/myreque.ts).
                // Before Nature Spirit's: its swamp box covers the hollows, and its gate walk has no way out of the landing.
                if (inMyrequeArea(pos()) && !inMyrequeArea({ ...tile, level: tile.level ?? 0 })) await leaveMyreque(q);
                // Nature Spirit: Mort Myre, Filliman's camp and grotto, Morytania's bank and the mausoleum — back under the Salve (lib/nature-spirit.ts).
                if (inNatureSpiritArea(pos()) && !inNatureSpiritArea({ ...tile, level: tile.level ?? 0 })) await leaveNatureSpirit(q);
                // Horror from the Deep: the lighthouse, its caves, the causeway past the basalt rocks, the agility course's start (lib/horror.ts).
                // Tamayu's hunt cutscene (Tai Bwo Wannai Trio) plays inside the lighthouse box: wait for the teleport back, not Camelot.
                if (inHuntCutscene(pos())) await waitOutCutscene(q);
                if (inHorrorArea(pos()) && !inHorrorArea({ ...tile, level: tile.level ?? 0 })) await leaveHorror(q);
                // Big Chompy Bird Hunting: Rantz's cave, out by its own exit (lib/chompybird.ts).
                if (inChompyArea(pos()) && !inChompyArea({ ...tile, level: tile.level ?? 0 })) await leaveChompyCave(q);
                // Troll Romance: the ice cave, Trollweiss Mountain and the Rellekka cave, out by their tunnels (lib/troll-romance.ts).
                if (inRomanceArea(pos()) && !inRomanceArea({ ...tile, level: tile.level ?? 0 })) await leaveRomanceArea(q);
                // Troll Stronghold: past the Death Plateau rocks, the arena, the pass, Trollheim and the stronghold (lib/troll-stronghold.ts).
                if (inTrollArea(pos()) && !inTrollArea({ ...tile, level: tile.level ?? 0 })) await leaveTrollArea(q);
                // Haunted Mine: Mort'ton and the mine under Mort Ridge (not at z + 6400): teleport out (lib/haunted-mine.ts).
                if (inHauntedMineArea(pos()) && !inHauntedMineArea({ ...tile, level: tile.level ?? 0 })) await leaveHauntedMine(q);
                // Throne of Miscellania: the islands, off by the pier's longship to Rellekka (lib/miscellania.ts).
                if (inMiscArea(pos()) && !inMiscArea(tile)) await leaveMiscellania(q);
                // Shades of Mort'ton: the town's south half, outside Mort Myre's box — north into the swamp (lib/shades-of-mortton.ts).
                if (inMorttonSouth(pos()) && !inMorttonSouth({ ...tile, level: tile.level ?? 0 })) await leaveMortton(q);
                if (pos().level !== (tile.level ?? 0)) await q.climbTo(tile.level ?? 0, tile);
                // Underground (z + 6400) to the surface: walkTo cannot plan through a ladder
                // and travelTo re-plans on the spot forever. A Witch's House run resumed in
                // the cellar after a client drop looped on the prologue's walk to the bank
                // (ABGARMY08, 2026-10-29). Climb the ladder/stairs beside us first.
                // Draynor Manor's lever maze: its doors hide the ladder from a generic climb
                // (ABGARMY05/jacklove7/jacklove9 stranded there, 2026-10-29).
                if (inLeverMaze(q) && tile.z < UNDERGROUND_Z) await escapeMaze(q, tile);
                // Shut in the manor's bookcase nook or closet: walkTo has no way out of either
                // (ABGARMY04/07 sat in the nook through four quests, 2026-10-29).
                if (onManorGround(pos()) && !onManorGround(tile) && tile.z < UNDERGROUND_Z) await leaveManor(q);
                // Shilo Village's dungeons, Cairn Isle and the river valley: out by their own exits (lib/shilo-village.ts).
                if (inShiloArea(pos()) && !inShiloArea(tile)) await leaveShilo(q, tile);
                // Tai Bwo Wannai's jungle and the Rogues Purse cave: out by the hand holds, home by the Brimhaven boat (lib/jungle-potion.ts).
                if (inJungleArea(pos())) await leaveJungle(q, tile);
                // Tai Bwo Wannai Trio: Timfraku's upstairs, Brimhaven's west docks, the whole island: the Brimhaven boat (lib/tai-bwo-wannai-trio.ts).
                if (inTbwtIsland(pos()) && !inTbwtIsland({ ...tile, level: tile.level ?? 0 })) await leaveTbwt(q, tile);
                // Legends' Quest: the Kharazi jungle (chopped in and out), the shaman caves, the Viyeldi caves (lib/legends-quest.ts).
                if (inLegendsArea(pos()) && !inLegendsArea(tile)) await leaveLegends(q, tile);
                // Inside the Gnome Stronghold: walkTo has no route through Femi's gate (fatpig after a
                // client drop at the fishing spots, 2026-10-31). Before the Karamja check: with the Grand
                // Tree at 80 the crossing flies the glider to Karamja instead (jacklove16, 2026-11-04).
                // A long trip out of the stronghold: its spirit tree first, the gate if that is not on (lib/spirit-trees.ts).
                if (inStronghold(pos()) && !inStronghold(tile) && tile.z < UNDERGROUND_Z) await spiritTreeShortcut(q, tile);
                if (inStronghold(pos()) && !inStronghold(tile) && tile.z < UNDERGROUND_Z) await crossGnomeGate(q, false);
                // Left on Karamja by a failed Pirate's Treasure run (jacklove13, 2026-10-29).
                if (pos().level === 0 && onKaramja(pos()) && !onKaramja(tile)) await sailFromKaramja();
                // Left on Entrana (jacklove6 after a Lost City run, 2026-10-29): the monks' boat back.
                if (pos().level === 0 && onEntrana(pos()) && !onEntrana(tile) && tile.z < UNDERGROUND_Z) await sailFromEntrana();
                // The Entrana dungeon's ladder is one-way: Lumbridge Teleport out (lib/lost-city.ts), as
                // the quest does. jacklove18 sat at (2860,9730) failing every quest's first walk.
                if (inEntranaDungeon(q) && !(tile.z > 9700 && tile.z < 9800 && tile.x >= 2816 && tile.x <= 2879)) {
                    log(`in the Entrana dungeon at (${pos().x},${pos().z}): Lumbridge Teleport out`);
                    await teleportOutOfEntranaDungeon(q);
                }
                // Baxtorian Falls, its ledge and the raft's island: no ladder or path out (lib/waterfall.ts).
                if (inWaterfallArea(pos()) && !inWaterfallArea(tile)) await leaveWaterfall(q);
                // West Ardougne (walled until Biohazard), the plague sewer and cellar: manhole, mud pile (lib/plague-city.ts).
                if (inPlagueArea(pos()) && !inPlagueArea(tile)) await leavePlagueCity(q);
                // Keep Le Faye (and the crate that ships you there): out by its front door (lib/merlins-crystal.ts).
                if (inKeepArea(pos()) && !inKeepArea(tile)) await leaveKeep(q);
                // Shield of Arrav's hideout (past its self-opening door), weapon store and Black Arm
                // back rooms: their doors teleport you through, walkTo has no route out (lib/shield-of-arrav.ts).
                if (inArravBuilding(pos()) && !inArravBuilding({ ...tile, level: tile.level ?? 0 })) await leaveArravBuildings(q);
                // Heroes' Quest: Brimhaven's quest rooms, the ice caves' ladder pockets, Taverley's Dusty-key side (lib/heroes-quest.ts).
                if (inHeroesArea(pos()) && !inHeroesArea({ ...tile, level: tile.level ?? 0 })) await leaveHeroesAreas(q);
                // Family Crest's mines and the Edgeville dungeon: their ladders are out of a generic climb's sight (lib/crest.ts).
                if (inCrestUnderground(pos()) && !inCrestUnderground(tile)) await leaveCrestUnderground(q);
                if (pos().z >= UNDERGROUND_Z && tile.z < UNDERGROUND_Z) await climbOutOfUnderground(tile);
                // Buildings whose doorway the client map gets wrong (lib/doors.ts). Out of ours, then a long
                // trip takes the spirit trees once Tree Gnome Village is done (lib/spirit-trees.ts), then into theirs.
                if (away(tile) > tolerance) {
                    const left = await leaveStuckArea(sdk, bot, tile, log);
                    const hopped = await spiritTreeShortcut(q, tile);
                    if (!left || hopped) await enterStuckArea(sdk, bot, tile, log);
                }
                // Lumbridge side <-> Al Kharid: pay the border guard first. walkTo at the toll
                // gate blacklists it and detours around the fence (alkharid-toll.ts).
                const here = pos();
                if (away(tile) > tolerance && inAlKharid(here) !== inAlKharid(tile) && Math.min(here.x, tile.x) < TOLL_X) {
                    let crossed = await crossAlKharidToll(bot, sdk, inAlKharid(tile), { log });
                    // A naked prologue reaches the gate with no coins: Jackpoo5 sat at 3267,3227 for an
                    // hour on its way to the Al Kharid hub (2026-10-30). Get the fee, then try again.
                    if (!crossed && q.count('coins') < TOLL_FEE) {
                        // The fee from a bank on our side of the gate: the coin source pickpockets
                        // Lumbridge men, out of reach from the Al Kharid side (jacklove10 looped at
                        // 3269,3226 with 0 coins, 2026-10-30).
                        const sideBank = inAlKharid(here) ? SAFE_BANKS['al-kharid'] : SAFE_BANKS.draynor;
                        await q.goTo(sideBank, 4);
                        await bot.openBank().catch(() => undefined);
                        const banked = sdk.findBankItem(/^coins$/i);
                        if (banked && banked.count >= TOLL_FEE - q.count('coins')) {
                            if (sdk.getInventory().length >= 28) for (const it of sdk.getInventory()) await bot.depositItem(it.name, -1).catch(() => undefined);
                            await bot.withdrawItem(banked, TOLL_FEE - q.count('coins'));
                        }
                        await bot.closeBank().catch(() => undefined);
                        if (q.count('coins') < TOLL_FEE && !inAlKharid(here)) await q.ensure('coins', TOLL_FEE);
                        crossed = await crossAlKharidToll(bot, sdk, inAlKharid(tile), { log });
                    }
                    if (!crossed) log('toll: could not cross; walking around');
                }
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
                    // Died on the way: re-planning from the respawn walks the account back into
                    // whatever killed it (crest-nostock walked Lumbridge -> the Edgeville dungeon
                    // tile, 2026-11-01). The caller decides how to restart.
                    if (!res.success && /died en route/i.test(res.message)) throw new Error(`approach to (${tile.x},${tile.z}) failed: ${res.message}`);
                    if (!res.success) {
                        log(`walkTo (${tile.x},${tile.z}) failed (${res.message}); trying travelTo`);
                        await viaTravel();
                        res = await bot.walkTo(tile.x, tile.z, tolerance);
                    }
                    // Shut in a building whose door walkTo will not open (jacklove13 at 3035,3230 in
                    // Port Sarim, "unroutable … locked door or separate room?", 2026-10-29): open the
                    // nearest closed door or gate we can reach and walk again, a few times.
                    for (let d = 0; d < 3 && !res.success && away(tile) > tolerance; d++) {
                        await sdk.scanNearbyLocs(10).catch(() => undefined);
                        const door = (sdk.getNearbyLocs() ?? [])
                            .filter((l) => /door|gate/i.test(l.name) && l.options?.some((o) => /^open$/i.test(o)) && l.reachable !== false && (l.distance ?? 99) <= 10)
                            .sort((a, b) => (a.distance ?? 99) - (b.distance ?? 99))[0];
                        // A moored ship's hold (jacklove13 at 3035,3230 was below decks at Port
                        // Sarim): up the ship's ladder, then over the gangplank.
                        const shipLadder = door ? undefined : (sdk.getNearbyLocs() ?? []).find((l) => /ship's ladder/i.test(l.name) && l.options?.some((o) => /climb-up/i.test(o)) && l.reachable !== false);
                        if (!door && !shipLadder) break;
                        if (door) {
                            log(`opening ${door.name} at (${door.x},${door.z}) to get out of (${pos().x},${pos().z})`);
                            await bot.openDoor(door).catch(() => undefined);
                        } else if (shipLadder) {
                            log(`below decks at (${pos().x},${pos().z}): up the ship's ladder and over the gangplank`);
                            const lvl = pos().level;
                            await bot.interactLoc(shipLadder, /climb-up/i).catch(() => undefined);
                            await untilTicks(sdk, () => pos().level !== lvl, 15);
                            for (let i = 0; i < 4 && pos().level !== 0; i++) {
                                await sdk.scanNearbyLocs(10).catch(() => undefined);
                                const plank = sdk.findNearbyLoc(/gangplank/i, { withOption: /cross/i });
                                if (plank) await bot.interactLoc(plank, /cross/i).catch(() => undefined);
                                await untilTicks(sdk, () => pos().level === 0, 10);
                            }
                        }
                        res = await bot.walkTo(tile.x, tile.z, tolerance);
                    }
                    if (!res.success) throw new Error(`approach to (${tile.x},${tile.z}) failed: ${res.message}`);
                }
                // Right x,z on the wrong floor is not there: say so here, not 15 junk searches later.
                if (tile.level !== undefined && pos().level !== tile.level) {
                    throw new Error(`goTo ${fmtTile(tile)} arrived on the wrong floor: ${whereAt()}`);
                }
                log(`goTo ${fmtTile(tile)} from ${fmtTile(from)}: ${tickNow(sdk) - t0}t`);
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
            async climbTo(level, toward) {
                for (let i = 0; i < 6; i++) {
                    const now = pos().level;
                    if (now === level) return;
                    const next = now + (now < level ? 1 : -1);
                    // Draynor Manor's staircases say Walk-up / Walk-down.
                    const opt = now < level ? /climb-up|climb up|walk-up/i : /climb-down|climb down|walk-down/i;
                    const climbable = (radius: number) =>
                        (sdk.getNearbyLocs() ?? [])
                            .filter((l) => /stair|ladder/i.test(l.name) && l.options?.some((o) => opt.test(o)) && (l.distance ?? 99) <= radius)
                            .sort((a, b) => (a.distance ?? 99) - (b.distance ?? 99));
                    // Nearest stairs first. Judging staircases by the pathfinder's view of the next
                    // plane does not work: open air on upper planes reads as walkable, so a ladder in
                    // another building "connected" and the Blue Moon Inn's own stairs did not
                    // (jacklove3, Pirate's Treasure, 2026-10-30). goTo's wrong-floor check catches a miss.
                    let loc: NearbyLoc | undefined;
                    if (!loc) {
                        // Only stairs/ladders beside us, reachable first. Opening doors toward
                        // "the nearest" one let the bot pick a ladder 24 tiles off and climb a
                        // castle tower instead of the stairs it stood at (sheep, 2026-10-28).
                        await sdk.scanNearbyLocs(12).catch(() => undefined);
                        loc = climbable(12).find((l) => l.reachable !== false);
                    }
                    if (!loc) {
                        // From a closed room (the castle wheel room) the stairs are behind a door.
                        await q.reach(/stair|ladder/i, opt).catch(() => undefined);
                        await sdk.scanNearbyLocs(12).catch(() => undefined);
                        loc = climbable(12).find((l) => l.reachable !== false);
                    }
                    if (!loc && now > level) {
                        // Down only: the White Knights' tower ladder is 15 tiles from Vyvin's
                        // corridor on level 1 (ABGARMY05 stuck at 2984,3336, 2026-10-30).
                        await sdk.scanNearbyLocs(25).catch(() => undefined);
                        loc = climbable(25).find((l) => l.reachable !== false);
                    }
                    if (!loc) throw new Error(`no stairs/ladder to climb ${now < level ? 'up' : 'down'} near ${whereAt()}`);
                    log(`climb ${loc.name} at (${loc.x},${loc.z},L${now}) toward L${level}${toward ? ` (${toward.x},${toward.z})` : ''}`);
                    await bot.interactLoc(loc, opt);
                    await untilTicks(sdk, (s) => (s.player?.level ?? now) !== now, 30);
                }
                if (pos().level !== level) throw new Error(`could not reach plane ${level} (at ${whereAt()})`);
            },
            async talk(npc, choices = [], at) {
                await closeUi(bot, sdk);
                // Only get near: bot.talkTo routes to the NPC itself, gates and fences included.
                if (at) {
                    await q.goTo(at, teleport ? 2 : APPROACH);
                    // A wandering npc can be out of view from the edge of APPROACH: Romeo
                    // was not seen from 13 tiles off his square (2026-10-29). Close in on `at`.
                    if (!teleport && !(await untilTicks(sdk, () => !!sdk.findNearbyNpc(npc), 5))) await q.goTo(at, 3);
                    // Seen but behind a door another player shut (Alrena in her house: "not reachable",
                    // jacklove16 3x, 2026-11-02): walk right up — the walk opens doors on the way.
                    // goTo(at, 1) returned at once from 2 tiles off Edmond with an interior door between
                    // (jacklove5): walk to the npc's own tile — walkTo opens doors on the way.
                    for (let i = 0; i < 3; i++) {
                        const seenNpc = sdk.findNearbyNpc(npc);
                        if (teleport || !seenNpc || seenNpc.reachable !== false) break;
                        await bot.walkTo(seenNpc.x, seenNpc.z, 1).catch(() => undefined);
                        await sdk.waitForTicks(2).catch(() => undefined);
                    }
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
        // Up in the Grand Tree: climbTo finds no way down from its L1 (jacklove4 after a restart
        // mid-stock-run, 2026-10-31).
        if (inGrandTreeArea(pos())) await leaveGrandTreeArea(q);
        if (inStronghold(pos()) && pos().level !== 0) await leaveGrandTree(q);
        // Melzar's Maze, any floor or its basement: climbTo would take any of its ladders (lib/melzars-maze.ts).
        if (inMelzarsMaze(pos())) await leaveMelzarsMaze(bot, sdk, log);
        // Iban's cavern is level 1 with no ladder: out of the pass before any climb (lib/underground-pass.ts).
        if (inUpassArea(pos())) await leaveUpass(q);
        if (inRegicideArea(pos())) await leaveRegicide(q);
        // Upstairs in Peer the Seer's house: climbTo finds no way down (jacklove12, 2026-11-02).
        if (inSeerHouse(pos())) await leaveSeerHouse(q);
        // Shield of Arrav's hideout/weapon store/Black Arm rooms: their own doors and ladders out.
        if (inArravBuilding(pos())) await leaveArravBuildings(q);
        // Heroes' Quest's rooms, ice caves and the Dusty-key side: their own ways out.
        if (inHeroesArea(pos())) await leaveHeroesAreas(q);
        // Legends' Quest's jungle and caves: walkTo has no way out of either (lib/legends-quest.ts).
        if (inLegendsArea(pos())) await leaveLegends(q, hub);
        if (inMansionUpstairs(pos())) await leaveMansionUpstairs(q);
        if (inGrailArea(pos())) await leaveGrail(q, hub);
        // Watchtower's tower floors, caves, island and plateau; the Observatory's cavern and dome.
        if (inWatchtowerArea(pos())) await leaveWatchtowerArea(q, hub);
        if (inObservatoryArea(pos())) await leaveObservatory(q);
        if (inTouristTrapArea(pos())) await leaveTouristTrap(q);
        if (inDigShafts(pos())) await leaveDigShafts(q);
        if (inWorkshopArea(pos())) await leaveWorkshop(q);
        if (inIkovArea(pos())) await leaveIkov(q);
        if (inScorpionArea(pos())) await leaveScorpionArea(q);
        if (inMyrequeArea(pos())) await leaveMyreque(q);
        if (inNatureSpiritArea(pos())) await leaveNatureSpirit(q);
        if (inHuntCutscene(pos())) await waitOutCutscene(q);
        if (inHorrorArea(pos())) await leaveHorror(q);
        if (inChompyArea(pos())) await leaveChompyCave(q);
        if (inRomanceArea(pos())) await leaveRomanceArea(q);
        if (inTrollArea(pos())) await leaveTrollArea(q);
        if (inHauntedMineArea(pos())) await leaveHauntedMine(q);
        if (inMiscArea(pos())) await leaveMiscellania(q);
        if (inMorttonSouth(pos())) await leaveMortton(q);
        // Anywhere on Karamja with the Ardougne hub: the Brimhaven boat, not Musa Point and a walk across Asgarnia
        // (qltb1's Musa Point walk stalled in a Brimhaven house, 2026-11-04).
        if (inTbwtIsland(pos()) || (def.hub === 'ardougne' && pos().level === 0 && onJungleIsland(pos()))) await leaveTbwt(q, hub);
        if (pos().level !== 0) await q.climbTo(0);
        if (inShiloArea(pos())) await leaveShilo(q, hub);
        // Out of a dungeon first: the nearest bank below is measured on surface coordinates.
        if (pos().z >= UNDERGROUND_Z) await climbOutOfUnderground(hub);
        if (def.noHubAt?.includes(q.stage)) {
            // QuestDef.noHubAt: the quest leaves from where it stands at this stage (the Grand Tree at
            // 'released': the stronghold gate is held and the glider lands in a pocket of Karamja with
            // no walk to the customs boat — jacklove16 failed every restart on the hub walk, 2026-11-04).
            log(`prologue: no hub walk at stage ${q.stage}; carrying ${describeInventory(sdk)} at ${whereAt()}`);
        } else {
        // Naked before the walk, not only at the hub: a run that starts with a pack from the last
        // job banks it at the nearest bank first. jacklove10 set off from Al Kharid to Falador with
        // a pack of herbs, reached the toll with no coins and could not pickpocket the fee with a
        // full pack (2026-10-30).
        // Still underground (no ladder up and no teleport): distances on the underground z picked a
        // "nearest" bank at random (Draynor, Seers) and banked quest items where the quest never
        // withdraws them — a Scorpion Catcher shield and an Ikov pendant were lost that way in
        // staging (2026-11-04). Keep the pack; the walk to the hub banks it there.
        if (pos().z >= UNDERGROUND_Z) log(`prologue: still underground at (${pos().x},${pos().z}) — no side-bank stop`);
        else if (sdk.getInventory().length > 0 && away(hub) > 30) {
            // Never across the toll just to bank (jackquests, 0 coins at the gate, 2026-11-02).
            const nearest = (Object.keys(SAFE_BANKS) as SafeBankName[])
                .filter((name) => inAlKharid(pos()) === inAlKharid(SAFE_BANKS[name]))
                .map((name) => ({ name, d: away(SAFE_BANKS[name]) }))
                .sort((a, b) => a.d - b.d)[0]!;
            if (nearest.name !== def.hub && nearest.d < away(hub)) {
                log(`prologue: carrying ${describeInventory(sdk)} — banking at ${nearest.name} before the walk to ${def.hub}`);
                await q.goTo(SAFE_BANKS[nearest.name], 4);
                await depositAllInventory(q.supply);
                await bot.closeBank().catch(() => undefined);
            }
        }
        await q.goTo(hub, 4);
        const startAt = pos();
        await depositAllInventory(q.supply);
        // QuestDef.skills below their level: train them now, naked but for the trainers'
        // tools, then come back to the hub for the quest's own withdrawals.
        const toTrain = Object.entries(def.skills ?? {}).filter(([skill, level]) => TRAINERS[skill] && q.level(skill) < level);
        if (toTrain.length && !prepareOnly) {
            if (!spawn) await withdrawTowardNeeds(q, [{ from: '', to: '', needs: toTrain.flatMap(([skill]) => TRAINERS[skill]!.needs) }]);
            await bot.closeBank().catch(() => undefined);
            for (const [skill, level] of toTrain) await q.ensureLevel(skill, level);
            if (pos().level !== 0) await q.climbTo(0);
            await q.goTo(hub, 4);
            await depositAllInventory(q.supply);
        }
        if (!spawn) await withdrawTowardNeeds(q, def.transitions.slice(def.transitions.findIndex((t) => t.from === start)));
        for (const item of def.carry ?? []) {
            // A number is an obj id, for items that share a name (Demon Slayer's three "Key"s).
            const banked = typeof item === 'number' ? sdk.getBankItems().find((b) => b.id === item) : sdk.findBankItem(itemPattern(item));
            const held = typeof item === 'number' ? sdk.getInventory().some((i) => i.id === item) : q.count(item) > 0;
            if (!banked || held) continue;
            // One: carried items are single quest items, and a whole stack of unstackables
            // fills the pack (jacklove6 withdrew 16 Dragonfire shields, 2026-10-30).
            await bot.withdrawItem(banked, 1);
            await sdk.waitForTicks(2);
            log(`withdrew ${banked.name}${typeof item === 'number' ? ` #${item}` : ''} (quest item from an earlier run)`);
        }
        await bot.closeBank().catch(() => undefined);
        log(`prologue: naked at ${def.hub} (${startAt.x},${startAt.z}); carrying ${describeInventory(sdk)}`);
        }

        /**
         * Source.muleSupply, one round per position in its list: every line still short goes to
         * its first mule, what that mule could not hand over goes to its second (Jackpoo2 at
         * Draynor, then jackthief at Ardougne), and so on. `count` is the total wanted —
         * requestFromMule asks only for what is not held (passing the shortfall asked for it twice
         * over, so 5 nails held of 12 asked for 2).
         */
        const askMules = async (needs: Need[]): Promise<void> => {
            for (let round = 0; ; round++) {
                const byMule = new Map<string, Need[]>();
                for (const need of needs) {
                    const by = mulesFor(need.item)[round];
                    if (by && !needMet(q, need)) byMule.set(by, [...(byMule.get(by) ?? []), need]);
                }
                if (byMule.size === 0) return;
                for (const [by, list] of byMule) {
                    const asked = list.map((n) => ({ label: n.item, pattern: itemPattern(n.item), count: n.count }));
                    const ok = await requestFromMule({ sdk, bot, session: null, log }, asked, { mule: by, timeoutMs: ticksToMs(MULE_WAIT_TICKS) });
                    log(`mule ${by}: ${ok ? 'supplied' : 'not all supplied'}; carrying ${describeInventory(sdk)}`);
                }
            }
        };

        // ── prepare: every sourced item the rest of the quest needs, before any quest step
        const remaining = def.transitions.slice(def.transitions.findIndex((t) => t.from === start));
        // QuestDef.noHubAt: no bank and no mule can reach us here (jacklove16 in the Grand Tree's
        // Karamja pocket timed out asking jackthief for sharks, 2026-11-04). Go with what we carry; a
        // later step that runs short fails and its restart, past this stage, banks as usual.
        if (def.noHubAt?.includes(q.stage)) log(`prepare: skipped at stage ${q.stage} (no hub) — carrying ${describeInventory(sdk)}`);
        else {
        // Mule-supplied stock first: the prologue has withdrawn what the bank holds, so a
        // shortfall now means the account was never stocked — stop before walking anywhere.
        const mule = mergeNeeds(remaining.flatMap((t) => needsOf(t, q))).filter((n) => SOURCES[n.item]?.mule);
        if (spawn) for (const need of mule) if (!needMet(q, need)) await q.ensure(need.item, need.count);
        // A mule-only line with a serving mule (Source.muleSupply: Jackpoo2's iron bars) is asked
        // of that mule before the account counts as unstocked.
        await askMules(mule);
        const short = mule.filter((n) => !needMet(q, n)).map((n) => ({ item: n.item, count: n.count - q.count(n.item) }));
        if (short.length) throw new NeedsStock(short);
        const prep = preparableNeeds(q, remaining);
        if (prep.length) {
            await session.setPhase('prepare');
            log(`prepare: ${prep.map((n) => `${n.count} ${n.item}`).join(', ')}`);
            // Mule-served lines (Source.muleSupply): one request per mule; anything it does
            // not hand over in MULE_WAIT_TICKS (offline, mid-quest, out of stock) is sourced below.
            await askMules(prep);
            for (const need of prep) if (!needMet(q, need)) await q.ensure(need.item, need.count);
            log(`prepared; carrying ${describeInventory(sdk)}`);
        }
        }

        if (def.task && !prepareOnly) {
            await session.setPhase(def.id);
            await def.task(q);
        }

        // The prologue's own walk can move the quest on (Fight Arena: leaving the pen at
        // defeated_scorpion means fighting Bouncer first). Re-read before the first transition.
        if (!isTask && !prepareOnly) {
            const now = await readStage();
            if (now && now !== q.stage) {
                log(`stage after prologue: ${now} (was ${q.stage})`);
                q.stage = now;
                if (!recorded.has(now)) await checkpoint(now);
            }
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

            for (const need of needsOf(t, q)) if (!needMet(q, need)) await q.ensure(need.item, need.count);
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
        if (inUpassArea(pos())) await leaveUpass(q);
        if (inMelzarsMaze(pos())) await leaveMelzarsMaze(bot, sdk, log);
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
        if (!summary.ok) {
            // The gate (QUEST_LAB_MODE=staging) must see every stage. On the fleet a resumed run
            // can skip one an earlier attempt passed; the journal already says complete, so a
            // failure here only burned a retry (ABGARMY03 gobdip, ABGARMY07 drunkmonk, ABGARMY06 squire).
            if (process.env.QUEST_LAB_MODE === 'staging') throw new Error(`evidence gate failed: missing ${JSON.stringify(summary.missing)}`);
            log(`WARN evidence: stages not seen this run ${JSON.stringify(summary.missing)} — journal says complete`);
        }
        if (teleport || spawn) {
            log(`ASSISTED COMPLETE (journal-verified) — exit ${ASSISTED_EXIT}; an unassisted run must still pass`);
            return 'assisted';
        }
        log('QUEST COMPLETE (journal-verified)');
        return true;
    };

    // A game-server blip drops every client at once (13:34 and 14:01 on 2026-10-29): the
    // runner used to fail the quest and burn a retry on each account. Wait for the client
    // and resume from the journal stage instead; only a long outage counts as a failure.
    // The quest's slot first, then the start turn: a full quest is deferred without spending a
    // fleet-wide start window (ABGARMY11 won a turn, found Dragon Slayer full, and burned it).
    const releaseSlot = await acquireQuestSlot(def.id, def.maxConcurrent ?? QUEST_SLOTS, account, grindLog);
    // Quests (not tasks: those have no stages) start one fleet-wide every 5 minutes.
    if (def.stages.length > 0) await awaitQuestStartTurn(def.id, account, grindLog);
    process.once('exit', releaseSlot);
    let result = await runScript(body);
    for (let outage = 1; outage <= OUTAGE_RETRIES && !result.success && OUTAGE.test(result.error?.message ?? ''); outage++) {
        const line = `game client lost (${result.error?.message}); resuming in ${OUTAGE_WAIT_MS / 1000}s (${outage}/${OUTAGE_RETRIES})`;
        console.error(line);
        try {
            appendFileSync(grindLog, `${new Date().toISOString()} [${def.id}] ${line}\n`);
        } catch {
            /* the log must never break the retry */
        }
        // Wall-clock, not ticks: there is no game client to count ticks with.
        await sleepWithoutClient(OUTAGE_WAIT_MS);
        result = await runScript(body);
    }

    if (result.error instanceof NeedsStock) {
        console.log(result.error.message);
        process.exit(NEEDS_STOCK_EXIT);
    }
    if (result.success && result.result === 'assisted') process.exit(ASSISTED_EXIT);
    const ok = result.success && (result.result === true || result.result === 'prepared');
    if (!ok) {
        // The error must reach grind.log: on the fleet only that file survives, and a
        // run that died in the Draynor maze showed nothing but "controller disconnected".
        const err = result.error;
        const where = err?.stack?.split('\n').slice(1).find((l) => l.trim()) ?? '';
        const line = err ? `FATAL: ${err.message}${where ? ` | ${where.trim()}` : ''}` : `FATAL: run ended without completing (result ${JSON.stringify(result.result)})`;
        console.error(line);
        try {
            appendFileSync(grindLog, `${new Date().toISOString()} [${def.id}] ${line}\n`);
        } catch {
            /* the log must never break the exit */
        }
    }
    process.exit(ok ? 0 : 1);
}

/**
 * At the open hub bank: for each item the remaining transitions need, withdraw
 * what the bank holds; for any shortfall, withdraw the source's inputs instead
 * (shears for wool, coins for shears), recursively.
 */
async function withdrawTowardNeeds(q: Quest, transitions: Transition[]): Promise<void> {
    const want = mergeNeeds(transitions.flatMap((t) => needsOf(t, q)));

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

/** A transition's needs, evaluated now when they depend on the account. */
function needsOf(t: Transition, q: Quest): Need[] {
    return typeof t.needs === 'function' ? t.needs(q) : (t.needs ?? []);
}

/** Needs the prepare phase can produce: those with a source that is not quest-tracked. Max count per item. */
function preparableNeeds(q: Quest, transitions: Transition[]): Need[] {
    return mergeNeeds(transitions.flatMap((t) => needsOf(t, q))).filter((n) => {
        const source = SOURCES[n.item];
        return source?.get && source.spawnable !== false;
    });
}

function describeInventory(sdk: BotSDK): string {
    const inv = sdk.getInventory().map((i) => `${i.name}${(i.count ?? 1) > 1 ? ` x${i.count}` : ''}`);
    const worn = sdk.getEquipment().map((i) => i.name);
    return [inv.length ? inv.join(', ') : 'nothing', worn.length ? `wearing ${worn.join(', ')}` : ''].filter(Boolean).join('; ');
}
