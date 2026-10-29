/**
 * Prince Ali Rescue — a disguise, a copied key, a drunk guard and a tied-up Keli.
 *
 *   bun bots/quests/prince-ali-rescue.ts {botname}
 *
 * Journal rules from quest_prince/scripts/prince_journal.rs2 (the complete text
 * restates the started sentence, so `started` excludes the later ones). Dialog
 * from area_alkharid/scripts/{hassan,osman}.rs2 and area_draynor/scripts/
 * {leela,lady_keli,ned,aggie,joe_guard,prince_ali}.rs2:
 *
 *   - Ned's wig, Aggie's skin paste and Keli's key print only open once Osman
 *     has briefed you (spoken_osman), so they are steps of that stage, not
 *     sources. Their inputs (wool, dye, paste ingredients, soft clay, bronze
 *     bar) are sources, made in prepare.
 *   - Osman (Al Kharid) turns the print and a bronze bar into a key that Leela
 *     hands over; Leela moves the stage once key, blond wig, skirt and paste are held.
 *   - Joe takes three beers at once; Keli is tied with a rope (a spare covers
 *     her respawn); the prison door opens with the key from the north side.
 *   - Plain and blond wigs are both "Wig": told apart by obj id.
 */
import type { Quest } from './lib/run-quest';
import { runQuest } from './lib/run-quest';
import { driveDialog } from './lib/dialog';
import { tickNow, ticksToMs, untilTicks } from './lib/ticks';

const HASSAN = { x: 3302, z: 3164 };
const OSMAN = { x: 3286, z: 3181 };
const LEELA = { x: 3113, z: 3264 };
const NED = { x: 3101, z: 3258 };
const AGGIE = { x: 3086, z: 3259 };
/**
 * Inside the jail, by Joe and Keli. From outside (3128,3248) talkTo spent the
 * dialog's first-page wait opening the jail door, and Keli's and Joe's talks
 * came back empty; walk in first.
 */
const JAIL = { x: 3125, z: 3244 };
/** North of the prison door (alidoor, 3123,3243): the key only works from z > 3243. */
const CELL_NORTH = { x: 3123, z: 3244 };
const CELL_DOOR = { x: 3123, z: 3243 };

const KELI = /^lady keli$/i;
const PLAIN_WIG = 2421;
const BLOND_WIG = 2419;

/**
 * Jail guards are aggressive (draynor.npc: huntmode=aggressive_melee, huntrange=5,
 * lineofsight) and every swing, hit or miss, runs if_close (npc_combat_melee.rs2
 * playerhit_n_melee): a guard on you ends any dialog after its first page. Keli's
 * key-print talk did that nine times running in the 2026-10-28 gate. The four guards
 * live outside the jail house (x 3121-3130, z 3240-3246); they get in, and see in, only
 * through its north door (3128,3246), which our own way in leaves open. So: put down
 * any guard already inside, shut that door, then talk. Killing every guard around
 * instead (2026-10-29) just pulled in respawns.
 */
const JAIL_DOOR = { x: 3128, z: 3246 };
const inHouse = (x: number, z: number) => x >= 3121 && x <= 3130 && z >= 3240 && z <= 3246;

async function quietJail(q: Quest): Promise<void> {
    await q.goTo(JAIL, 1);
    const me = () => q.sdk.getState()?.player;
    let kills = 0;
    for (let i = 0; i < 4; i++) {
        const guard = q.sdk
            .getNearbyNpcs()
            .filter((n) => /^jail guard$/i.test(n.name) && (n.hp ?? 1) > 0 && n.reachable !== false && (inHouse(n.tileX ?? n.x, n.tileZ ?? n.z) || (n.inCombat && n.distance <= 2)))
            .sort((a, b) => a.distance - b.distance)[0];
        if (!guard) break;
        const res = await q.bot.attack(guard, ticksToMs(15));
        if (!res.success) {
            q.log(`jail guard: ${res.message}`);
            break;
        }
        if (await untilTicks(q.sdk, () => !q.sdk.getNearbyNpcs().some((n) => n.index === guard.index && (n.hp ?? 1) > 0), 40)) kills++;
    }
    await q.sdk.scanNearbyLocs(8).catch(() => undefined);
    const door = (q.sdk.getNearbyLocs() ?? []).find((l) => /^door$/i.test(l.name) && Math.abs(l.x - JAIL_DOOR.x) <= 1 && Math.abs(l.z - JAIL_DOOR.z) <= 1);
    const open = !!door && door.options.some((o) => /close/i.test(o));
    if (door && open) {
        await q.bot.interactLoc(door, /close/i);
        await q.sdk.waitForTicks(2).catch(() => undefined);
    }
    await q.goTo(JAIL, 1);
    const p = me();
    q.log(`jail: ${kills} guard(s) inside put down, door ${!door ? 'not seen' : open ? 'closed' : 'already shut'}, combat ${p?.combat?.inCombat}`);
}

/**
 * Joe wanders outside the house, among the guards (z 3247-3249, by spawns 3121,3249 and
 * 3127,3248): shutting the door does not cover him. Put down the guards within their
 * hunt range of him, then talk while they respawn (60 ticks; his beer talk is ~8 pages).
 */
async function quietAroundJoe(q: Quest): Promise<void> {
    let kills = 0;
    for (let i = 0; i < 4; i++) {
        const joe = q.sdk.findNearbyNpc(/^joe$/i);
        if (!joe) break;
        const jx = joe.tileX ?? joe.x;
        const jz = joe.tileZ ?? joe.z;
        const guard = q.sdk
            .getNearbyNpcs()
            .filter((n) => /^jail guard$/i.test(n.name) && (n.hp ?? 1) > 0 && n.reachable !== false && Math.max(Math.abs((n.tileX ?? n.x) - jx), Math.abs((n.tileZ ?? n.z) - jz)) <= 6)
            .sort((a, b) => Number(b.inCombat) - Number(a.inCombat) || a.distance - b.distance)[0];
        if (!guard) break;
        const res = await q.bot.attack(guard, ticksToMs(15));
        if (!res.success) {
            q.log(`jail guard by Joe: ${res.message}`);
            break;
        }
        if (await untilTicks(q.sdk, () => !q.sdk.getNearbyNpcs().some((n) => n.index === guard.index && (n.hp ?? 1) > 0), 40)) kills++;
    }
    q.log(`Joe: ${kills} guard(s) near him put down, combat ${q.sdk.getState()?.player?.combat?.inCombat}`);
}

/** Run `fn` from inside the jail. */
async function inJail(q: Quest, fn: () => Promise<void>): Promise<void> {
    await q.goTo(JAIL, 1);
    await fn();
}

const wigs = (q: Quest, id: number) => q.sdk.getInventory().filter((i) => i.id === id).length;

/** Talk, then wait for the item to show up; logs when it does not. */
async function talkFor(q: Quest, npc: RegExp, choices: RegExp[], at: { x: number; z: number }, got: () => boolean, what: string): Promise<boolean> {
    await q.talk(npc, choices, at);
    if (!(await untilTicks(q.sdk, got, 6))) q.log(`${what}: not received`);
    return got();
}

/** Blond wig: Ned knits a plain one from three balls of wool, yellow dye on it. */
async function blondWig(q: Quest): Promise<void> {
    if (wigs(q, BLOND_WIG) > 0) return;
    if (wigs(q, PLAIN_WIG) < 1) {
        const ok = await talkFor(q, /^ned$/i, [/other things from wool/i, /some sort of wig/i, /please, make me a wig/i], NED, () => wigs(q, PLAIN_WIG) > 0, 'Ned wig');
        if (!ok) return;
    }
    await q.ensure('yellow dye', 1);
    const dye = q.sdk.findInventoryItem(/^yellow dye$/i);
    const wig = q.sdk.getInventory().find((i) => i.id === PLAIN_WIG);
    if (dye && wig) await q.sdk.sendUseItemOnItem(dye.slot, wig.slot);
    if (await untilTicks(q.sdk, () => wigs(q, BLOND_WIG) > 0, 5)) q.log('dyed the wig blond');
    else q.log('wig: yellow dye did not take');
}

/** Keli shows the key; touching it with soft clay takes the print. */
async function keyPrint(q: Quest): Promise<void> {
    await inJail(q, () => keyPrintTalk(q));
}

async function keyPrintTalk(q: Quest): Promise<void> {
    for (let i = 0; i < 4 && q.count('key print') < 1; i++) {
        await quietJail(q);
        await waitForKeli(q);
        const seen = await q.talk(KELI, [/famous in runescape/i, /latest plan/i, /not try to get him out/i, /see the key/i, /touch the key/i]);
        if (await untilTicks(q.sdk, () => q.count('key print') > 0, 6)) return;
        const p = q.sdk.getState()?.player;
        q.log(`Keli key print: none (soft clay ${q.count('soft clay')}, at ${p?.worldX},${p?.worldZ}, combat ${p?.combat?.inCombat ?? '?'}); dialog: …${seen.slice(-200)}`);
    }
}

/**
 * Tying Keli runs npc_del: she is gone for everyone until she respawns. With several
 * fleet bots at the jail (ABGARMY06, ABGARMY12 behind pigfat, 2026-10-29) the others
 * must wait for her rather than spend their tries on an empty room.
 */
const KELI_RESPAWN_TICKS = 400;
async function waitForKeli(q: Quest): Promise<void> {
    if (q.sdk.findNearbyNpc(KELI)) return;
    const t0 = tickNow(q.sdk);
    q.log('Lady Keli is not here (tied up by another player?) — waiting for her to respawn');
    if (!(await untilTicks(q.sdk, () => !!q.sdk.findNearbyNpc(KELI), KELI_RESPAWN_TICKS))) throw new Error(`Lady Keli did not respawn within ${KELI_RESPAWN_TICKS} ticks`);
    q.log(`Lady Keli back after ${tickNow(q.sdk) - t0}t`);
}

/** Tie Keli up with a rope (lady_keli opnpcu: mesbox, then npc_del). */
async function tieKeli(q: Quest): Promise<void> {
    await inJail(q, () => tieKeliRope(q));
}

async function tieKeliRope(q: Quest): Promise<void> {
    const start = q.count('rope');
    // A guard's hit cancelled the use once (2026-10-29: ropes 2 -> 2).
    for (let i = 0; i < 3 && q.count('rope') >= start && q.count('rope') > 0; i++) {
        await quietJail(q);
        await waitForKeli(q);
        const before = q.count('rope');
        const res = await q.bot.useItemOnNpc(/^rope$/i, KELI, { timeout: ticksToMs(30) });
        if (!res.success) q.log(`rope on Keli: ${res.message}`);
        await driveDialog(q.sdk, [], { ticks: 20, log: q.log });
        await untilTicks(q.sdk, () => q.count('rope') < before, 5);
        const p = q.sdk.getState()?.player;
        q.log(`rope on Keli: ropes ${before} -> ${q.count('rope')} (combat ${p?.combat?.inCombat ?? '?'}, Keli ${q.sdk.findNearbyNpc(KELI) ? 'seen' : 'not seen'})`);
    }
}

/** Through the prison door with the key, from its north side, and hand the prince his disguise. */
async function freePrince(q: Quest): Promise<void> {
    await q.goTo(CELL_NORTH, 1);
    // The door tile itself is inside: its wall is on the north edge (alidoor: locked when z > 3243).
    const inCell = () => (q.sdk.getState()?.player?.worldZ ?? 99_999) <= CELL_DOOR.z;
    const cursor = () => Math.max(0, ...(q.sdk.getState()?.gameMessages ?? []).map((m) => m.observationId ?? m.tick));
    const since = (c: number, re: RegExp) => (q.sdk.getState()?.gameMessages ?? []).some((m) => (m.observationId ?? m.tick) > c && re.test(m.text));
    for (let i = 0; i < 3 && !inCell(); i++) {
        await q.sdk.scanNearbyLocs(6).catch(() => undefined);
        const door = (q.sdk.getNearbyLocs() ?? []).find((l) => /prison door/i.test(l.name) && Math.abs(l.x - CELL_DOOR.x) <= 1 && Math.abs(l.z - CELL_DOOR.z) <= 1);
        if (!door) return q.log('prison door not in view');
        const c = cursor();
        await q.bot.useItemOnLoc(/^bronze key$/i, door, { timeout: ticksToMs(20) });
        await untilTicks(q.sdk, () => inCell() || since(c, /lady keli|door is locked/i), 10);
        if (since(c, /get rid of lady keli/i)) {
            q.log('Keli is back by the cell: tying her up again');
            if (q.count('rope') < 1) return q.log('no spare rope for Keli');
            await tieKeliRope(q);
            await q.goTo(CELL_NORTH, 1);
        }
    }
    if (!inCell()) return q.log('prison door did not let us in');
    // Another fleet bot freeing him first takes him away for a while too (jacklove15, 2026-10-29).
    if (!q.sdk.findNearbyNpc(/^prince ali$/i)) {
        q.log('Prince Ali is not in the cell (freed by another player?) — waiting for him');
        if (!(await untilTicks(q.sdk, () => !!q.sdk.findNearbyNpc(/^prince ali$/i), KELI_RESPAWN_TICKS))) throw new Error(`Prince Ali did not reappear within ${KELI_RESPAWN_TICKS} ticks`);
    }
    await q.talk(/^prince ali$/i);
    // Out again: walkTo blacklisted the locked door on the way in and finds no path out
    // of the cell. From inside, the door's Open works (quest_prince oploc1,alidoor).
    for (let i = 0; i < 3 && inCell(); i++) {
        await q.bot.walkTo(CELL_DOOR.x, CELL_DOOR.z, 0);
        await q.sdk.scanNearbyLocs(4).catch(() => undefined);
        const door = (q.sdk.getNearbyLocs() ?? []).find((l) => /prison door/i.test(l.name) && Math.abs(l.x - CELL_DOOR.x) <= 1 && Math.abs(l.z - CELL_DOOR.z) <= 1);
        if (door) await q.bot.interactLoc(door, /open/i);
        await untilTicks(q.sdk, () => !inCell(), 8);
    }
    if (inCell()) q.log('still inside the cell after freeing the prince');
}

await runQuest({
    id: 'prince',
    hub: 'draynor',
    // Shared NPCs/doors (Keli and the prince; the lever maze) break with many bots in at once.
    maxConcurrent: 2,
    journal: { label: 'Prince Ali Rescue', title: 'The Rescue Of Prince Ali' },
    stages: [
        { id: 'unstarted', rule: { id: 'prince:unstarted', kind: 'unstarted', all: ['start this quest by speaking to Hassan'] } },
        { id: 'started', rule: { id: 'prince:started', kind: 'active', all: ['speak to Osman for details'], none: ['QUEST COMPLETE', 'kidnapped'] } },
        { id: 'spoken_osman', rule: { id: 'prince:spoken_osman', kind: 'active', all: ['Talk to Leela near Draynor Village for advice'] } },
        { id: 'prep_finished', rule: { id: 'prince:prep_finished', kind: 'active', all: ['determine any weaknesses'] } },
        { id: 'guard_drunk', rule: { id: 'prince:guard_drunk', kind: 'active', all: ['use some Rope to tie her up'] } },
        { id: 'tied_keli', rule: { id: 'prince:tied_keli', kind: 'active', all: ['I can now free Prince Ali'] } },
        { id: 'saved', rule: { id: 'prince:saved', kind: 'active', all: ['return to Hassan to claim my reward'] } },
        { id: 'complete', rule: { id: 'prince:complete', kind: 'complete', all: ['QUEST COMPLETE'] } },
    ],
    transitions: [
        // Coins for the quest's own toll crossings (four paid at 10gp; free once the prince
        // is saved) and a lost key (15gp). Checked again after prepare spent its share.
        { from: 'unstarted', to: 'started', at: HASSAN, needs: [{ item: 'coins', count: 60 }], talk: { npc: /^hassan$/i, choices: [/can i help you/i] } },
        { from: 'started', to: 'spoken_osman', at: OSMAN, talk: { npc: /^osman$/i, choices: [/what is the first thing/i, /better go find some things/i] } },
        {
            from: 'spoken_osman',
            to: 'prep_finished',
            needs: [
                { item: 'soft clay', count: 1, or: 'bronze key' },
                { item: 'bronze bar', count: 1, or: 'bronze key' },
                { item: 'bucket of water', count: 1, or: 'paste' },
                { item: 'ball of wool', count: 3, or: 'wig', orCount: 1 },
                { item: 'yellow dye', count: 1, or: 'wig' },
                { item: 'pink skirt', count: 1 },
                { item: 'ashes', count: 1, or: 'paste' },
                { item: 'redberries', count: 1, or: 'paste' },
                { item: 'pot of flour', count: 1, or: 'paste' },
            ],
            run: async (q) => {
                const key = () => q.count('bronze key') > 0;
                // A key Osman already made waits with Leela (a resumed run).
                if (!key() && q.count('key print') < 1) await q.talk(/^leela$/i, [/rest of the escape equipment/i], LEELA);
                if (!key() && q.count('key print') < 1) await keyPrint(q);
                await blondWig(q);
                if (q.count('paste') < 1) {
                    await talkFor(q, /^aggie$/i, [/way to make skin paste/i, /mix me some skin paste/i], AGGIE, () => q.count('paste') > 0, 'Aggie paste');
                }
                if (!key() && q.count('key print') > 0) await q.talk(/^osman$/i, [/thank you\. i will try/i], OSMAN);
                // Leela hands over the key (once Osman has made it) and, with the kit, moves the stage.
                await q.talk(/^leela$/i, [/rest of the escape equipment/i], LEELA);
                q.log(`kit: key ${q.count('bronze key')}, blond wig ${wigs(q, BLOND_WIG)}, skirt ${q.count('pink skirt')}, paste ${q.count('paste')}`);
            },
        },
        {
            from: 'prep_finished',
            to: 'guard_drunk',
            needs: [{ item: 'beer', count: 3 }],
            run: async (q) => {
                await inJail(q, async () => {
                    await quietAroundJoe(q);
                    const seen = await q.talk(/^joe$/i, [/i have some beer here/i]);
                    if (q.count('beer') >= 3) q.log(`Joe kept the beer (beer ${q.count('beer')}); dialog: …${seen.slice(-200)}`);
                });
            },
        },
        // Two ropes: Keli respawns, and the cell door refuses while she is back.
        { from: 'guard_drunk', to: 'tied_keli', needs: [{ item: 'rope', count: 2 }], run: tieKeli },
        {
            from: 'tied_keli',
            to: 'saved',
            needs: [
                { item: 'bronze key', count: 1 },
                { item: 'wig', count: 1 },
                { item: 'pink skirt', count: 1 },
                { item: 'paste', count: 1 },
                // Keli can be back at the cell (another bot's wait respawned her): a rope to re-tie her.
                { item: 'rope', count: 1 },
            ],
            run: (q) => inJail(q, () => freePrince(q)),
        },
        // queue(prince_complete) runs after the dialog; the runner settles on the journal.
        { from: 'saved', to: 'complete', at: HASSAN, talk: { npc: /^hassan$/i } },
    ],
});
