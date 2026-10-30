/**
 * Crystal keys: join every pair of key halves in the bank, then open the Taverley
 * crystal chest with every key, banking the loot at Falador west.
 *
 *   bun bots/quests/crystal-keys.ts {botname}
 *
 * Shown by the operator on jacklove10 (demos/demo-jacklove10-2026-10-30T10-33-41-496Z.jsonl)
 * and checked against content:
 *   - crystal_key.rs2: keyhalf1 (obj 985) used on keyhalf2 (987) makes crystal_key (989).
 *     Both halves are named "Half of a key", so they are told apart by id.
 *   - crystal_chest.rs2: the key used on crystal_chestclosed (loc 172, 2914,3452) opens it.
 *     Every opening gives an uncut dragonstone plus one roll; the widest roll is 11 rune
 *     stacks, so a key is only used with 12 slots free. Up to 10 keys a trip, as the
 *     operator does. One roll gives a key half back: the next trip joins it.
 * Queued in todo.json like a quest; every finish logs "already complete" for todo-runner.
 */
import { runTask, type Quest } from './lib/run-quest';
import { untilTicks } from './lib/ticks';
import { SAFE_BANKS } from './safe-stops';

const HALF_TOOTH = 985;
const HALF_LOOP = 987;
const KEY = 989;
const CHEST = { x: 2914, z: 3452 };
/** Into the chest's house the way the operator walked it (demo trail): round to the west side, in. */
const INTO_HOUSE = [
    { x: 2912, z: 3447 },
    { x: 2904, z: 3445 },
    { x: 2897, z: 3446 },
    { x: 2902, z: 3450 },
    { x: 2910, z: 3450 },
];
const CHEST_CLOSED = 172;
const KEYS_PER_TRIP = 10;
/** The rune roll adds 11 stacks next to the dragonstone. */
const SLOTS_PER_OPENING = 12;

const held = (q: Quest, id: number) => q.sdk.getInventory().filter((i) => i.id === id).reduce((n, i) => n + (i.count ?? 1), 0);
const banked = (q: Quest, id: number) => q.sdk.getBankItems().find((b) => b.id === id);
const freeSlots = (q: Quest) => 28 - q.sdk.getInventory().length;

async function bankAll(q: Quest): Promise<void> {
    await q.goTo(SAFE_BANKS['falador-west'], 3);
    await q.bot.openBank();
    for (const item of q.sdk.getInventory()) await q.bot.depositItem(item.name, -1);
}

/** Every pair of halves into keys, 13 pairs a pack. Leaves the bank open. */
async function joinHalves(q: Quest): Promise<number> {
    let made = 0;
    for (;;) {
        const tooth = banked(q, HALF_TOOTH);
        const loop = banked(q, HALF_LOOP);
        const pairs = Math.min(tooth?.count ?? 0, loop?.count ?? 0, 13);
        if (pairs < 1) return made;
        await q.bot.withdrawItem(tooth!, pairs);
        await q.bot.withdrawItem(loop!, pairs);
        await q.bot.closeBank();
        while (held(q, HALF_TOOTH) > 0 && held(q, HALF_LOOP) > 0) {
            const a = q.sdk.getInventory().find((i) => i.id === HALF_TOOTH)!;
            const b = q.sdk.getInventory().find((i) => i.id === HALF_LOOP)!;
            const before = held(q, KEY);
            await q.sdk.sendUseItemOnItem(a.slot, b.slot);
            if (!(await untilTicks(q.sdk, () => held(q, KEY) > before, 5))) throw new Error('keys: joining two halves made no key');
            made++;
        }
        await q.bot.openBank();
        for (const item of q.sdk.getInventory()) await q.bot.depositItem(item.name, -1);
    }
}

await runTask({
    id: 'crystal-keys',
    hub: 'falador-west',
    task: async (q) => {
        let opened = 0;
        let joined = 0;
        for (let trip = 1; ; trip++) {
            await bankAll(q);
            joined += await joinHalves(q);
            const keys = banked(q, KEY);
            if (!keys) break;
            await q.bot.withdrawItem(keys, Math.min(keys.count, KEYS_PER_TRIP));
            await q.bot.closeBank();
            q.log(`keys: trip ${trip}, carrying ${held(q, KEY)} crystal keys`);
            // goTo(CHEST) stopped outside the house and the chest refused the key (ABGARMY18).
            for (const wp of INTO_HOUSE) await q.goTo(wp, 1);
            let unseen = 0;
            while (held(q, KEY) > 0 && freeSlots(q) + 1 >= SLOTS_PER_OPENING) {
                await q.sdk.scanNearbyLocs(8).catch(() => undefined);
                const chest = (q.sdk.getNearbyLocs() ?? []).find((l) => l.x === CHEST.x && l.z === CHEST.z && l.id === CHEST_CLOSED);
                if (!chest) {
                    // Open for two ticks after each key; anything longer means we are not at it.
                    if (++unseen > 10) throw new Error(`keys: no closed chest at (${CHEST.x},${CHEST.z}) in view from (${q.sdk.getState()?.player?.worldX},${q.sdk.getState()?.player?.worldZ})`);
                    await q.sdk.waitForTicks(1);
                    continue;
                }
                unseen = 0;
                const before = held(q, KEY);
                let took = false;
                for (let attempt = 1; attempt <= 3 && !took; attempt++) {
                    const key = q.sdk.getInventory().find((i) => i.id === KEY)!;
                    const res = await q.bot.useItemOnLoc(key, chest);
                    took = await untilTicks(q.sdk, () => held(q, KEY) < before, 8);
                    if (!took) {
                        const said = (q.sdk.getState()?.gameMessages ?? []).slice(-2).map((m) => m.text).join(' | ');
                        q.log(`keys: chest refused a key (attempt ${attempt}): ${res.message}; game: "${said}" at (${q.sdk.getState()?.player?.worldX},${q.sdk.getState()?.player?.worldZ})`);
                        await q.reach(/chest/i).catch(() => undefined);
                    }
                }
                if (!took) throw new Error('keys: the chest did not take a key');
                opened++;
            }
        }
        await q.bot.closeBank();
        q.log(`keys: joined ${joined}, opened the chest ${opened} times — already complete for this account`);
    },
});
