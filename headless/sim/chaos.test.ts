import { describe, expect, test } from 'bun:test';

// RED: chaos.ts doesn't exist yet.
import { ChaosSwitchboard } from './chaos.js';
import { SimWorld } from './world.js';

describe('Chaos switchboard', () => {
    test('doors: random boot state + flip toggles ~10% every N ticks', () => {
        const world = new SimWorld({ seed: 7 });
        for (let i = 0; i < 20; i++) world.addLoc(i, 0, 1000 + i, ['Open']);
        const chaos = new ChaosSwitchboard(world, {
            doors: true,
            doorsFlipEvery: 10,
            doorsFlipFrac: 0.1,
            seed: 7
        });
        chaos.boot();
        const openAtBoot = chaos.doorsOpen;
        expect(openAtBoot).toBeGreaterThan(0);
        expect(openAtBoot).toBeLessThan(20);
        for (let t = 0; t < 10; t++) chaos.onTick(t);
        // After one flip interval the open set must have changed.
        expect(chaos.flips).toBe(1);
        expect(chaos.doorsOpen).not.toBe(openAtBoot);
    });

    test('drop: actions held for N ticks, order preserved, nothing lost', () => {
        const world = new SimWorld({ seed: 1 });
        const chaos = new ChaosSwitchboard(world, { dropTicks: 3 });
        chaos.startDrop(3);
        const held: string[] = [];
        for (let t = 0; t < 5; t++) {
            const res = chaos.gateAction({ type: 'walkTo', x: t, z: t } as any, t);
            if (res === null) held.push(`held${t}`);
            else held.push(`sent${t}`);
            chaos.onTick(t);
        }
        expect(held.slice(0, 3)).toEqual(['held0', 'held1', 'held2']);
        expect(held.slice(3)).toEqual(['sent3', 'sent4']);
        // Flushed queue preserves order.
        expect(chaos.flushed.map((a: any) => a.x)).toEqual([0, 1, 2]);
    });

    test('net-late: jitter holds ~2% of inputs 1-2 ticks, never drops', () => {
        const world = new SimWorld({ seed: 99 });
        const chaos = new ChaosSwitchboard(world, { netLateProb: 0.5, seed: 99 });
        const total = 50;
        let delayed = 0;
        const delivered: number[] = [];
        for (let t = 0; t < total + 5; t++) {
            // Jitter on: everything flows through the queue, collect via drain.
            if (t < total) chaos.gateAction({ type: 'wait', seq: t } as any, t);
            for (const a of chaos.drain(t)) delivered.push((a as any).seq);
            chaos.onTick(t);
        }
        // All 50 delivered exactly once, in order.
        expect(delivered).toEqual([...Array(total).keys()]);
        expect(chaos.delayedCount).toBeGreaterThan(0);
        delayed = chaos.delayedCount;
        expect(delayed).toBeLessThan(total);
    });

    test('deadline counter: ticks over budget are counted', () => {
        const world = new SimWorld({ seed: 1 });
        const chaos = new ChaosSwitchboard(world, { deadlineMs: 0 }); // everything over budget
        chaos.recordTick(5);
        chaos.recordTick(5);
        expect(chaos.deadlineTicks).toBe(2);
    });
});
