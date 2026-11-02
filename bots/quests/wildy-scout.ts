/**
 * Bait scout for the KBD route (user, 2026-11-02, after ABGARMY13 died unseen in the
 * wilderness): walk in from Edgeville carrying and wearing NOTHING, loiter on the KBD team's
 * route (the keep road down to the lesser-demon gate), and log every player seen — name, combat
 * level, where — and anyone who attacks. Nothing to lose; a death is just a respawn.
 *
 *   bun bots/quests/wildy-scout.ts {botname} [--minutes=20]
 *
 * Every sighting and attack goes to grind.log as "SCOUT …"; ends with "already complete".
 */
import { runTask, type Quest } from './lib/run-quest';
import { tickNow, untilTicks } from './lib/ticks';
import { DITCH_NORTH, DITCH_SOUTH, KEEP_ROAD_X } from './tiles';

const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const MINUTES = Number(arg('minutes') ?? 20);
/** Edgeville ditch → north up to the keep road, then the KBD team's own route to the gate. */
const IN_ROUTE = [
    { x: 3095, z: 3600 },
    { x: 3110, z: 3700 },
    { x: KEEP_ROAD_X, z: 3800 },
    { x: KEEP_ROAD_X, z: 3895 },
];
const LOOP = [
    { x: KEEP_ROAD_X, z: 3940 },
    { x: KEEP_ROAD_X, z: 3865 },
    { x: 3078, z: 3848 },
    { x: 3017, z: 3848 },
    { x: 3078, z: 3848 },
    { x: KEEP_ROAD_X, z: 3865 },
];

await runTask({
    id: 'wildy-scout',
    hub: 'edgeville',
    task: async (q: Quest) => {
        const { sdk, bot } = q;
        const p = () => sdk.getState()!.player!;
        const seen = new Map<string, { combat: number; first: string; where: string; times: number }>();
        const attackers = new Set<string>();
        let died = false;

        // Naked: everything worn and carried goes in the bank.
        const opened = await bot.openBank();
        if (opened.success) {
            for (const worn of sdk.getEquipment().filter(Boolean)) await bot.unequipItem(worn!).catch(() => undefined);
            for (let i = 0; i < 28; i++) {
                const it = sdk.getInventory().find((x) => (x.count ?? 0) > 0);
                if (!it) break;
                await bot.depositItem(it, -1).catch(() => undefined);
            }
            await bot.closeBank();
        }
        q.log(`SCOUT start naked: worn=${sdk.getEquipment().filter(Boolean).length} pack=${sdk.getInventory().length}, ${MINUTES} min on the KBD route`);

        const look = () => {
            const me = p();
            if (me.isDead && !died) {
                died = true;
                q.log(`SCOUT DIED at ${me.worldX},${me.worldZ}; attackers so far: ${[...attackers].join(', ') || 'none seen'}`);
            }
            for (const pl of sdk.getNearbyPlayers() ?? []) {
                const s = seen.get(pl.name);
                if (!s) {
                    seen.set(pl.name, { combat: pl.combatLevel, first: new Date().toISOString().slice(11, 19), where: `${pl.x},${pl.z}`, times: 1 });
                    q.log(`SCOUT sighted ${pl.name} (cb ${pl.combatLevel}) at ${pl.x},${pl.z}, ${Math.round(pl.distance)} tiles off; me at ${me.worldX},${me.worldZ}`);
                } else s.times++;
            }
            // A player hit: our combat target is that player (auto-retaliate) or damage with no npc fight.
            const c = me.combat;
            if (c.targetType === 'player') {
                const who = (sdk.getNearbyPlayers() ?? []).find((x) => x.index === c.targetIndex)?.name ?? `player#${c.targetIndex}`;
                if (!attackers.has(who)) {
                    attackers.add(who);
                    q.log(`SCOUT ATTACKED by ${who} at ${me.worldX},${me.worldZ} hp ${me.hp}/${me.maxHp}`);
                }
            }
        };

        const hop = async (x: number, z: number) => {
            for (let i = 0; i < 40 && !p().isDead; i++) {
                look();
                const d = Math.hypot(p().worldX - x, p().worldZ - z);
                if (d <= 4) return;
                const step = Math.min(12, d);
                const tx = Math.round(p().worldX + ((x - p().worldX) / d) * step);
                const tz = Math.round(p().worldZ + ((z - p().worldZ) / d) * step);
                const sx = p().worldX;
                const sz = p().worldZ;
                await sdk.sendWalk(tx, tz, true);
                await untilTicks(sdk, () => Math.hypot(p().worldX - tx, p().worldZ - tz) <= 2 || p().isDead, step * 2 + 4);
                if (p().worldX === sx && p().worldZ === sz) {
                    // Blocked straight line: side-step (alternating sides, growing) and re-aim.
                    const side = (i % 2 === 0 ? 1 : -1) * (4 + 2 * Math.floor(i / 2));
                    await sdk.sendWalk(sx + side, sz + (z > sz ? 3 : -3), true);
                    await sdk.waitForTicks(4).catch(() => undefined);
                }
            }
        };

        await q.goTo(DITCH_SOUTH, 3);
        for (let i = 0; i < 3 && p().worldZ < 3520; i++) {
            await sdk.sendWalk(DITCH_NORTH.x, DITCH_NORTH.z, true);
            await untilTicks(sdk, () => p().worldZ >= 3520, 20);
        }
        for (const wp of IN_ROUTE) {
            if (p().isDead) break;
            await hop(wp.x, wp.z);
        }
        const t0 = tickNow(sdk);
        const until = Date.now() + MINUTES * 60_000;
        let lap = 0;
        while (Date.now() < until && !p().isDead && !q.stopRequested()) {
            for (const wp of LOOP) {
                if (p().isDead || Date.now() > until) break;
                await hop(wp.x, wp.z);
                // Linger a little at each point: PKers come to where we stand.
                for (let t = 0; t < 10 && !p().isDead; t++) {
                    look();
                    await sdk.waitForTicks(3).catch(() => undefined);
                }
            }
            lap++;
        }
        look();
        const list = [...seen].map(([n, s]) => `${n}(cb ${s.combat}, first ${s.first} @ ${s.where}, seen ${s.times}x)`).join('; ');
        q.log(`SCOUT summary: ${lap} laps in ${tickNow(sdk) - t0}t, ${seen.size} players seen: ${list || 'none'} | attacked by: ${[...attackers].join(', ') || 'nobody'} | died: ${died}`);
        if (!p().isDead) {
            for (const wp of [...IN_ROUTE].reverse()) await hop(wp.x, wp.z);
            await hop(DITCH_NORTH.x, DITCH_NORTH.z + 2);
            await sdk.sendWalk(DITCH_SOUTH.x, DITCH_SOUTH.z, true);
            await untilTicks(sdk, () => p().worldZ < 3520 || p().isDead, 20);
        }
        q.log('wildy-scout: done — already complete');
    },
});
