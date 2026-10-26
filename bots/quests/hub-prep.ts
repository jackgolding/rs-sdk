/**
 * hub-prep — put an account into the canonical quest STARTING STATE.
 *
 * A hub is a bank tile. After hub-prep the account is standing on that tile with
 * an EMPTY inventory and NOTHING equipped, and everything it was carrying is in
 * the bank. Quest scripts can then assume a deterministic start: hub → quest
 * start → quest, instead of "wherever the last run left the body" (which is how
 * a canary ends up underground with a broken path and six identical rewrites of
 * the same failure).
 *
 *   bun bots/quests/hub-prep.ts <bot>                 # nearest hub
 *   bun bots/quests/hub-prep.ts <bot> alkharid        # a named hub
 *
 * Legs are hub→hub BY CONSTRUCTION: asked for a named hub from a non-hub tile, it
 * first preps at the nearest reachable one. That is not tidiness — it is what
 * puts a travel float (coins) in the bag, which the Al Kharid toll gate and the
 * ferries demand. Without it a leg that starts mid-route dead-ends at a locked
 * gate holding nothing to pay with (observed: `Door at (3268,3227) cant_reach`).
 *
 * Exit 0 only when the account really is empty-handed on the destination tile;
 * the log line `HUB-READY <hub> @ x,z` is what the caller greps.
 */
import { appendFileSync, existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { runScript } from '../../sdk/runner';
import { findLongPath } from '../../sdk/pathfinding';
import { crossAlKharidToll, inAlKharidRegion, needsTollCrossing } from './alkharid-toll';

const botName = process.argv.slice(2).find((a) => !a.startsWith('-')) ?? '';
// `--then <script> [args…]` runs a quest script once the hub stop is clean. The bot
// name is implied when no args are given, so `hub-prep qlhub1 draynor --then
// bots/quests/sheepshearer.ts` is enough. See the handover at the end of the file.
const thenIdx = process.argv.indexOf('--then');
const thenArgs = thenIdx === -1 ? [] : process.argv.slice(thenIdx + 1);
const wantedHub = process.argv.slice(2).filter((a) => !a.startsWith('-'))[1] ?? '';
const GRIND_LOG = join(process.cwd(), 'bots', botName, 'grind.log');
const WALK_BUDGET_MS = Number(process.env.HUB_WALK_MS ?? 900_000);
const FLOAT = Number(process.env.HUB_FLOAT ?? 20);

/** Fallback when quest-lab/hubs.json is absent; also the names quests use. */
const FALLBACK_HUBS: Record<string, { x: number; z: number }> = {
    edgeville: { x: 3094, z: 3492 },
    draynor: { x: 3092, z: 3243 },
    'varrock-east': { x: 3253, z: 3420 },
    'varrock-west': { x: 3186, z: 3436 },
    catherby: { x: 2808, z: 3443 },
    ardougne: { x: 2655, z: 3283 },
    'falador-east': { x: 3012, z: 3355 },
    alkharid: { x: 3269, z: 3167 },
    seers: { x: 2726, z: 3485 },
};

/** `kind: 'point'` = a hub with no bank (Lumbridge courtyard): bank elsewhere first. */
type Hub = { x: number; z: number; kind?: 'bank' | 'point'; via?: { x: number; z: number }[]; toll?: string };
/** A hop the world cannot walk: a lever, a ship or a gate that changes zone. */
type Link = { from: string; to: string; kind: string; stand: { x: number; z: number }; loc: string; option: string };

/**
 * The hub table ships twice. A canary container mounts only /opt/fleet/bots, so
 * quest-lab/ does not exist in there — bots/hubs.json is the copy to prefer, and
 * quest-lab/hubs.json is the source it is generated from. Keeping both reachable
 * is what lets the same file be used on the Mac and inside the fleet image.
 */
function hubTablePath(): string {
    // bots/quests/hubs.json first: on the VPS /srv/fleet/bots is a bind mount and
    // the deploy only syncs bots/quests/, so a table anywhere else never arrives.
    for (const rel of [['bots', 'quests', 'hubs.json'], ['bots', 'hubs.json']]) {
        const p = join(process.cwd(), ...rel);
        if (existsSync(p)) return p;
    }
    return join(process.cwd(), 'quest-lab', 'hubs.json');
}

function loadLinks(): Link[] {
    try {
        const raw = JSON.parse(readFileSync(hubTablePath(), 'utf8')) as { links?: Link[] };
        return raw?.links ?? [];
    } catch {
        return [];
    }
}

function loadHubs(): Record<string, Hub> {
    try {
        const raw = JSON.parse(readFileSync(hubTablePath(), 'utf8')) as {
            hubs?: Record<string, Hub>;
        };
        if (raw?.hubs && Object.keys(raw.hubs).length) return { ...FALLBACK_HUBS, ...raw.hubs } as Record<string, Hub>;
    } catch {
        /* no generated hub table — use the hand-written one */
    }
    return { ...FALLBACK_HUBS };
}

const HUBS = loadHubs();
const LINKS = loadLinks();

/**
 * Trusted walking edges, measured by the travel test (patrol.json, verdict HUB).
 * Used to ROUTE AROUND a barrier instead of retrying the same straight line: if a
 * hub cannot be walked to directly, hop through hubs that are known to connect.
 */
function loadTrusted(): Array<{ from: string; to: string; s: number }> {
    try {
        const raw = JSON.parse(readFileSync(join(process.cwd(), 'quest-lab', 'patrol.json'), 'utf8')) as {
            legs?: Array<{ from: string; to: string; s: number; verdict: string }>;
        };
        return (raw?.legs ?? []).filter((l) => l.verdict === 'HUB' && l.from !== l.to);
    } catch {
        return [];
    }
}
const TRUSTED = loadTrusted();

await runScript(async ({ bot, sdk }) => {
    const log = (msg: string) => {
        const line = `${new Date().toISOString()} ${msg}`;
        console.log(msg);
        try {
            appendFileSync(GRIND_LOG, line + '\n');
        } catch {
            /* ignore */
        }
    };

    const pos = () => sdk.getState()?.player;
    const at = () => ({ x: pos()?.worldX ?? 0, z: pos()?.worldZ ?? 0, level: pos()?.level ?? 0 });
    const dist = (x: number, z: number) => {
        const p = at();
        return Math.hypot(p.x - x, p.z - z);
    };
    const coins = () => sdk.countInventoryItems(/^coins$/i);
    const byNearest = () =>
        (Object.entries(HUBS) as [string, Hub][])
            // A hub the world cannot walk to is never a candidate: build-hubs.py
            // derives them from map data, and the travel test is what proves which
            // ones are actually enterable (alkharid's gate: `cant_reach`, no toll
            // script in this revision).
            .filter(([name]) => (HUBS[name] as Hub & { reachable?: boolean }).reachable !== false)
            .sort((a, b) => dist(a[1].x, a[1].z) - dist(b[1].x, b[1].z));

    /**
     * A walkTo that makes no progress is usually a SHUT DOOR/GATE on the path:
     * collision data calls those tiles walkable, so the plan looks fine while the
     * server refuses every step ("The door is locked.", "cant_reach"). Refresh the
     * loc view and interact with everything shut within 6 tiles — Open, Pass, Pay,
     * Unlock — then let the next hop re-route.
     */
    const clearObstacles = async (): Promise<number> => {
        // Radius 6 was too tight for walled towns: Yanille's gate sits further than
        // that from where the walker strands itself, so the sweep found nothing and
        // the account could enter the town but never leave (observed: pinned at
        // 2685,3088 for six minutes, every walk "destination tile is blocked").
        await sdk.scanNearbyLocs(22).catch(() => {});
        const blocked = (sdk.getNearbyLocs() ?? [])
            .filter((l) => /door|gate|stile/i.test(l.name) && (l.distance ?? 99) <= 14)
            // Al Kharid toll gate: crossed via the guard (alkharid-toll.ts), never clicked.
            .filter((l) => !(l.x === 3268 && (l.z === 3227 || l.z === 3228)))
            .sort((a, b) => (a.distance ?? 99) - (b.distance ?? 99));
        let acted = 0;
        for (const loc of blocked) {
            const opts = loc.optionsWithIndex ?? [];
            // "Close" in the option list means the gate is ALREADY open — clicking
            // Open on it would shut it again.
            const alreadyOpen = opts.some((o) => /^(close|shut)$/i.test(o.text));
            const opt = opts.find((o) => /^(open|pass|pay|unlock|climb-over|squeeze)/i.test(o.text));
            if (!alreadyOpen && !opt) continue;

            const me = at();
            if (!alreadyOpen && opt) {
                await sdk.sendInteractLoc(loc.x, loc.z, loc.id, opt.opIndex).catch(() => {});
            }
            acted++;

            // The Al Kharid gate opens FINE for a human (a hand-walked trace goes
            // straight through at 3269,3233→3216), so the failure was here: we
            // clicked, waited 2 ticks, issued one sendWalk, and gave up when the
            // client still had the tile collided. Give the open a moment, then
            // push through with retries before declaring the near side.
            await new Promise((r) => setTimeout(r, 900));
            let moved = false;
            for (let attempt = 1; attempt <= 5 && !moved; attempt++) {
                const now = at();
                const dx = loc.x === now.x ? 0 : Math.sign(loc.x - now.x);
                const dz = loc.z === now.z ? 0 : Math.sign(loc.z - now.z);
                // aim 2 tiles past the gate, which is the far side
                await sdk.sendWalk(now.x + dx * 2, now.z + dz * 2, true).catch(() => {});
                await sdk.waitForTicks(3).catch(() => {});
                const after = at();
                moved = after.x !== now.x || after.z !== now.z;
            }
            log(
                `HUB-PREP ${loc.name} @ ${loc.x},${loc.z} ${alreadyOpen ? '(already open)' : (opt?.text ?? '')}: ` +
                    (moved ? `stepped through to ${at().x},${at().z}` : 'still on the near side'),
            );
        }
        if (acted) log(`HUB-PREP cleared ${acted} obstacle(s) at ${at().x},${at().z}`);
        return acted;
    };

    /**
     * walkTo is SCENE-LIMITED (~45 tiles): one call toward a far hub returns
     * without moving. Hop in ~35-tile steps instead. The door sweep fires on a
     * frozen hop AND on a hop that simply did not get closer, because the SDK
     * spends its retries "avoiding impassable door" while still twitching — that
     * never looked like a stall. Water or a fence line gets a sidestep instead.
     */
    const walk = async (x: number, z: number): Promise<boolean> => {
        const deadline = Date.now() + WALK_BUDGET_MS;
        let stalled = 0;
        let hop = 0;
        let best = dist(x, z);
        // Al Kharid's fence runs NORTH-SOUTH at x=3268: Lumbridge is west, Al Kharid
        // east. A leg that crosses it pays the border guard first, deterministically,
        // instead of walking into the gate tile and letting the pathfinder blacklist it.
        if (needsTollCrossing(at(), { x, z })) {
            if (!(await crossAlKharidToll(bot, sdk, inAlKharidRegion({ x, z }), { log: (m) => log(`HUB-PREP ${m}`), walk }))) return false;
            best = dist(x, z);
        }
        while (Date.now() < deadline) {
            if (dist(x, z) <= 3) return true;
            const from = at();
            const d = Math.max(1, dist(x, z));
            const step = Math.min(1, 35 / d);
            await bot
                .walkTo(Math.round(from.x + (x - from.x) * step), Math.round(from.z + (z - from.z) * step), 2)
                .catch(() => {});
            await new Promise((r) => setTimeout(r, 900));
            hop++;

            const moved = Math.hypot(at().x - from.x, at().z - from.z);
            const closer = dist(x, z) < best - 1;
            if (closer) best = dist(x, z);

            if (moved < 1 || !closer) {
                if (hop % 3 === 0 || moved < 1) {
                    if ((await clearObstacles()) > 0) {
                        stalled = 0;
                        hop = 0;
                        continue;
                    }
                }
                stalled++;
                // Standing ON or beside a blocking object (a door tile, a fence post)
                // leaves no route out in any direction — every walkTo fails from
                // there. Nudge 2 tiles in each cardinal direction until one takes.
                if (stalled >= 1) {
                    const me2 = at();
                    for (const [ox, oz] of [[2, 0], [-2, 0], [0, 2], [0, -2], [4, 0], [0, 4]] as const) {
                        await sdk.sendWalk(me2.x + ox, me2.z + oz, true).catch(() => {});
                        await sdk.waitForTicks(2).catch(() => {});
                        const now2 = at();
                        if (now2.x !== me2.x || now2.z !== me2.z) {
                            log(`HUB-PREP unstuck ${me2.x},${me2.z} → ${now2.x},${now2.z}`);
                            stalled = 0;
                            best = dist(x, z);
                            break;
                        }
                    }
                    if (stalled === 0) continue;
                }
                if (stalled >= 2) {
                    // Water / fence / one-way tile: sidestep perpendicular to the
                    // blocked line so the pathfinder can find the bridge, instead of
                    // walking the account onto a pier and stranding it there.
                    const nx = (z - at().z) / d;
                    const nz = -(x - at().x) / d;
                    const side = stalled % 2 === 0 ? 1 : -1;
                    const dx = Math.round(at().x + nx * 25 * side);
                    const dz = Math.round(at().z + nz * 25 * side);
                    log(`HUB-PREP blocked at ${at().x},${at().z} — sidestepping to ${dx},${dz}`);
                    await bot.walkTo(dx, dz, 2).catch(() => {});
                    await new Promise((r) => setTimeout(r, 1200));
                    stalled = 0;
                    hop = 0;
                    best = dist(x, z);
                }
            } else {
                stalled = 0;
            }
        }
        return dist(x, z) <= 4;
    };

    /**
     * Use a zone hop the pathfinder cannot walk: levers (Edgeville→mage bank,
     * Ardougne→Deserted Keep), ships and gates. The destination is whatever the
     * interaction actually does — a teleport is confirmed by a position jump, not
     * by trusting the click.
     */
    const tryLink = async (link: Link): Promise<boolean> => {
        if (!(await walk(link.stand.x, link.stand.z))) {
            log(`HUB-PREP link ${link.from}->${link.to}: cannot reach the stand tile`);
            return false;
        }
        await sdk.scanNearbyLocs(12).catch(() => {});
        const near = (sdk.getNearbyLocs() ?? [])
            .filter((l) => new RegExp(link.loc, 'i').test(l.name) && (l.distance ?? 99) <= 8)
            .sort((a, b) => (a.distance ?? 99) - (b.distance ?? 99));
        for (const loc of near) {
            const opt = (loc.optionsWithIndex ?? []).find((o) => new RegExp(link.option, 'i').test(o.text));
            if (!opt) continue;
            const before = at();
            await sdk.sendInteractLoc(loc.x, loc.z, loc.id, opt.opIndex).catch(() => {});
            await sdk.waitForTicks(6).catch(() => {});
            const after = at();
            const jumped = Math.hypot(after.x - before.x, after.z - before.z) > 30;
            log(
                `HUB-PREP link ${link.from}->${link.to} via ${loc.name} @ ${loc.x},${loc.z} ${opt.text}: ` +
                    (jumped ? `teleported to ${after.x},${after.z}` : `still at ${after.x},${after.z}`),
            );
            if (jumped) return true;
        }
        log(`HUB-PREP link ${link.from}->${link.to}: nothing to interact with at the stand tile`);
        return false;
    };

    /**
     * Shortest path over trusted edges + link edges, ending at `goal`. Empty when
     * the graph has no known way there. BFS because every edge is one hop whatever
     * it costs — the numbers only decide which of two equal-length paths to take.
     */
    const routeTo = (goal: string): string[] => {
        const start = Object.entries(HUBS).find(([, h]) => dist(h.x, h.z) <= 6)?.[0];
        if (!start || start === goal) return [];
        const adj = new Map<string, Array<{ to: string; cost: number }>>();
        const add = (a: string, b: string, cost: number) => {
            if (!adj.has(a)) adj.set(a, []);
            adj.get(a)!.push({ to: b, cost });
        };
        for (const e of TRUSTED) {
            add(e.from, e.to, e.s);
            add(e.to, e.from, e.s);
        }
        for (const l of LINKS) add(l.from, l.to, 60);
        // walk edges between hubs are also plausible hops even when untimed
        const seen = new Set([start]);
        const prev = new Map<string, string>();
        const queue = [start];
        while (queue.length) {
            const cur = queue.shift()!;
            if (cur === goal) break;
            for (const n of adj.get(cur) ?? []) {
                if (seen.has(n.to)) continue;
                seen.add(n.to);
                prev.set(n.to, cur);
                queue.push(n.to);
            }
        }
        if (!prev.has(goal)) return [];
        const path = [goal];
        let cur = goal;
        while (prev.has(cur)) {
            cur = prev.get(cur)!;
            path.unshift(cur);
            if (path.length > 8) break;
        }
        return path;
    };

    /** One hub stop: arrive, bank the bag and the worn gear, optionally take a float. */
    const prepAt = async (name: string, hub: Hub, takeFloat: boolean): Promise<boolean> => {
        if (dist(hub.x, hub.z) > 3) {
            let ok = await walk(hub.x, hub.z);
            if (!ok && hub.via?.length) {
                // Wall on the straight line (Al Kharid's gate, Yanille's north wall)
                // but a known road in: walk the waypoints, then the last leg.
                log(`HUB-PREP ${name}: straight line walled — taking the ${hub.via.length}-waypoint road`);
                let reached = true;
                for (const wp of hub.via) {
                    if (!(await walk(wp.x, wp.z))) {
                        log(`HUB-PREP ${name}: waypoint ${wp.x},${wp.z} unreachable from ${at().x},${at().z}`);
                        reached = false;
                        break;
                    }
                }
                if (reached) ok = await walk(hub.x, hub.z);
            }
            if (!ok) {
                // The straight line can be walled (Al Kharid's gate) while the town
                // is perfectly enterable from another side. Aim at an approach tile
                // off each compass point, then re-run the walk to the hub itself.
                for (const [ox, oz] of [[0, 70], [70, 0], [-70, 0], [0, -70], [0, 140], [140, 0]] as const) {
                    if (dist(hub.x, hub.z) <= 3) { ok = true; break; }
                    log(`HUB-PREP ${name}: direct line blocked at ${at().x},${at().z} — approaching via ${hub.x + ox},${hub.z + oz}`);
                    if (await walk(hub.x + ox, hub.z + oz)) {
                        ok = await walk(hub.x, hub.z);
                        if (ok) break;
                    }
                }
            }
            if (!ok) {
                log(`HUB-PREP cannot reach ${name} from ${at().x},${at().z}`);
                return false;
            }
        }
        // A POINT hub has no bank of its own (Lumbridge: a quest start, no booth in
        // this revision). The bag is banked at the last bank hub instead; here we
        // just confirm the tile and leave the account standing on it.
        if (hub.kind === 'point') {
            log(`HUB-PREP ${name} is a start point (no bank): standing at ${at().x},${at().z}, bag ${sdk.getInventory().length}`);
            return true;
        }
        const opened = await bot.openBank().catch(() => null);
        if (!opened || !opened.success) {
            log(`HUB-PREP could not open the ${name} bank: ${opened?.message ?? 'no bank'}`);
            return false;
        }

        // Float first, while the bank is open: gates and ferries want coins in the
        // bag, and this is the only moment we are standing at a bank.
        if (takeFloat && FLOAT > 0 && coins() < FLOAT) {
            await bot.withdrawItem(/^coins$/i, FLOAT - coins()).catch(() => {});
        }

        let removed = 0;
        for (let pass = 0; pass < 2; pass++) {
            for (let slot = 0; slot < 14; slot++) {
                if (!sdk.getEquipmentItem(slot)) continue;
                await sdk.sendUseEquipmentItem(slot, 1).catch(() => {});
                removed++;
            }
        }

        // A Remove lands on the NEXT tick: depositing immediately found an empty bag
        // and banked nothing ("2 removed, 0 deposited", axe still in the bag).
        const waitFor = async (fn: () => boolean, ms: number) => {
            const end = Date.now() + ms;
            while (Date.now() < end) {
                if (fn()) return true;
                await new Promise((r) => setTimeout(r, 250));
            }
            return fn();
        };
        const bagHasItems = () => sdk.getInventory().some((it) => (it.count ?? 0) > 0);
        if (removed > 0) await waitFor(bagHasItems, 6_000);

        // Keep the float: bank everything EXCEPT the coins we need for the road.
        const keep = takeFloat ? Math.min(coins(), FLOAT) : 0;
        let deposited = 0;
        for (let i = 0; i < 80; i++) {
            let item = sdk.getInventory().find((it) => (it.count ?? 0) > 0 && !(keep > 0 && /^coins$/i.test(it.name)));
            if (!item && i === 0) {
                await waitFor(bagHasItems, 3_000);
                item = sdk.getInventory().find((it) => (it.count ?? 0) > 0 && !(keep > 0 && /^coins$/i.test(it.name)));
            }
            if (!item) break;
            const r = await bot.depositItem(item, -1);
            if (!r.success && !r.partial) {
                log(`HUB-PREP deposit ${item.name} failed: ${r.message}`);
                break;
            }
            deposited++;
        }
        await bot.closeBank().catch(() => {});

        log(`HUB-PREP ${name} stop @ ${at().x},${at().z}: removed ${removed}, deposited ${deposited}, coins ${coins()}`);
        return true;
    };

    if (wantedHub && !HUBS[wantedHub]) throw new Error(`unknown hub '${wantedHub}' — one of ${Object.keys(HUBS).join(', ')}`);

    log(`HUB-PREP start @ ${at().x},${at().z} L${at().level} inv ${sdk.getInventory().length} worn ${sdk.getEquipment().length} coins ${coins()}`);

    const onHub = Object.entries(HUBS).find(([, h]) => dist(h.x, h.z) <= 3);

    if (wantedHub) {
        // hub → hub: get a clean bag and a float at the nearest bank before the hop.
        if (!onHub) {
            // Nearest-first, but the nearest bank can be the one BEHIND the very
            // gate we cannot open (standing at the Al Kharid toll gate, Al Kharid
            // is ~60 tiles away and unreachable). Try them in order; the first that
            // opens gives us the float that pays for the crossing.
            for (const [nm, h] of byNearest()) {
                if (nm === wantedHub) continue;
                log(`HUB-PREP mid-route: prepping at ${nm} before ${wantedHub}`);
                if (await prepAt(nm, h, true)) break;
            }
        } else if (onHub[0] !== wantedHub) {
            await prepAt(onHub[0], onHub[1], true);
        }
        let arrived = await prepAt(wantedHub, HUBS[wantedHub]!, false);

        // Route around the barrier: hop through hubs we have PROVEN connect. A
        // straight line into Varrock from the west has no gate, but varrock-2 is
        // 29s from it — the graph knows that even when the pathfinder does not.
        if (!arrived) {
            const path = routeTo(wantedHub);
            if (path.length > 1) {
                log(`HUB-PREP routing via ${path.slice(0, -1).join(' → ')}`);
                for (const hop of path) {
                    if (hop === wantedHub) break;
                    const h = HUBS[hop];
                    if (!h) break;
                    await prepAt(hop, h, true);
                }
                arrived = await prepAt(wantedHub, HUBS[wantedHub]!, false);
            }
        }
        if (!arrived) {
            // Some hubs cannot be walked to at all — the mage bank and Brimhaven are
            // behind levers and ships. Try every link that lands on the destination.
            for (const link of LINKS.filter((l) => l.to === wantedHub)) {
                log(`HUB-PREP trying the ${link.kind} link ${link.from}->${link.to}`);
                if ((await tryLink(link)) && (await prepAt(wantedHub, HUBS[wantedHub]!, false))) {
                    arrived = true;
                    break;
                }
            }
        }
        if (!arrived) throw new Error(`cannot reach ${wantedHub}`);
    } else {
        let done = false;
        for (const [name, hub] of byNearest()) {
            // Arrival stop: no float — a hub start is empty-handed, so the coins go
            // into the bank with everything else. (The float only exists to pay
            // gates on the way to a NAMED hub; it is banked there on arrival.)
            if (await prepAt(name, hub, false)) {
                done = true;
                break;
            }
        }
        if (!done) throw new Error('no reachable hub bank');
    }

    // A POINT hub has no bank, so the travel float stays in the bag — it is what
    // pays the toll on the way back out (Lumbridge → Al Kharid).
    const pointHub = !!wantedHub && HUBS[wantedHub]?.kind === 'point';
    const invLeft = sdk
        .getInventory()
        .filter((it) => (it.count ?? 0) > 0 && !(pointHub && /^coins$/i.test(it.name)))
        .map((it) => it.name);
    const wornLeft = sdk.getEquipment().map((it) => it.name);
    if (invLeft.length || wornLeft.length) {
        throw new Error(`hub not clean: inventory [${invLeft.join(', ')}] equipment [${wornLeft.join(', ')}]`);
    }

    log(`HUB-READY ${wantedHub || 'nearest'} @ ${at().x},${at().z}`);
});

/**
 * Hub → quest handover. `runScript` has already resolved, so this process's SDK
 * controller is closed: the child gets the account to itself, which is the whole
 * point of the rule that only one controller may drive a bot. Spawned rather than
 * imported so the quest script keeps its own controller, its own reconnect and its
 * own exit code — the same shape todo-runner.ts uses for quest lists.
 */
if (thenArgs.length) {
    const [script, ...rest] = thenArgs;
    const args = rest.length ? rest : [botName];
    console.log(`HUB-PREP handing over to ${script} ${args.join(' ')}`);
    const child = Bun.spawnSync(['bun', script!, ...args], { stdout: 'inherit', stderr: 'inherit' });
    process.exit(child.exitCode ?? 0);
}
