/**
 * Alfred Grimhand's Barcrawl (miniquest, no journal entry) — the route and mechanics.
 *
 * Content (quest_barcrawl/, area_barbarian_outpost/scripts/{outpost_gate,barbarian_outpost_guard}.rs2, each bar's
 * bartender.rs2); route cross-checked with rs-stun-toolkit's q-barcrawl.ts spec:
 *   - %barcrawl: 0 not started, 1 started, 2 complete; bits 3..12 are the ten bars. Nothing client-side shows the
 *     varp, but the card's Read (iop1) opens the `scroll` interface with one "<bar> - Completed!" / "Not Completed..."
 *     line per bar, so the card is the progress record.
 *   - Card: Open the outpost gate (2545,3569) from outside (the west; the outpost is east of it) with a guard (2544,3567/3571) within 5 tiles while
 *     %barcrawl != 2 and the gate runs the guard's dialog instead: "I want to come through this gate.",
 *     "Looks can be deceiving, I am in fact a barbarian." -> the card.
 *   - Each bartender's Talk-to offers "I'm doing Alfred Grimhand's Barcrawl." while its bit is clear and the card is
 *     held (Blurberry and Zambo straight in / third option); the drink costs coins, drains stats (Flying Horse also
 *     takes 25% of hitpoints) and sets the bit. Coins: 208 for the drinks, 60 for the two Karamja boats.
 *   - Hand-in: Open the gate again with every bit set -> the guard takes the card, %barcrawl = 2. From then on the
 *     gate lets you through (Horror from the Deep, Scorpion Catcher's third scorpion).
 *
 * Route from the Seers bank: the outpost (card), Blurberry (Grand Tree L1), the Flying Horse (Ardougne), the Dragon
 * Inn (Yanille), Barnaby's boat to Brimhaven (Dead Man's Chest), Zambo (Musa Point), the customs boat to Port Sarim
 * (Rusty Anchor), the Rising Sun (Falador), the Blue Moon and the Jolly Boar (Varrock), Camelot Teleport, the
 * Foresters Arms (Seers), the outpost (hand-in). About 1,600 walked tiles.
 */
import type { Quest } from './run-quest';
import { driveDialog } from './dialog';
import { untilTicks } from './ticks';
import { BLURBERRY_BAR, climbGrandTree, crossGnomeGate, leaveGrandTree } from './gnome-stronghold';
import { toJungle } from './jungle-potion';

interface Tile {
    x: number;
    z: number;
    level?: number;
}

const CARD = /^barcrawl card$/i;
/** The outpost gate's outer (west) side, and the gate's own tile: the outpost lies east of it (2546-2560). */
const GATE_OUTSIDE = { x: 2544, z: 3569 };
const GATE = { x: 2545, z: 3569 };
const CAMELOT_TELEPORT = 1174;

export interface Bar {
    /** The card's line for this bar ("BlueMoon Inn - Completed!"). */
    line: RegExp;
    npc: RegExp;
    at: Tile;
    price: number;
}

export const BARS = {
    blurberry: { line: /blurberry's bar/i, npc: /^blurberry$/i, at: BLURBERRY_BAR, price: 10 },
    flyinghorse: { line: /flying horse inn/i, npc: /^bartender$/i, at: { x: 2575, z: 3320 }, price: 8 },
    dragoninn: { line: /dragon inn/i, npc: /^bartender$/i, at: { x: 2556, z: 3078 }, price: 12 },
    deadman: { line: /dead man's chest/i, npc: /^bartender$/i, at: { x: 2797, z: 3156 }, price: 15 },
    zambo: { line: /karamja spirits bar/i, npc: /^zambo$/i, at: { x: 2925, z: 3144 }, price: 7 },
    rustyanchor: { line: /rusty anchor inn/i, npc: /^bartender$/i, at: { x: 3045, z: 3256 }, price: 8 },
    risingsun: { line: /rising sun inn/i, npc: /^barmaid$/i, at: { x: 2957, z: 3371 }, price: 70 },
    bluemoon: { line: /bluemoon inn/i, npc: /^bartender$/i, at: { x: 3226, z: 3398 }, price: 50 },
    jollyboar: { line: /jolly boar inn/i, npc: /^bartender$/i, at: { x: 3277, z: 3489 }, price: 10 },
    foresters: { line: /foresters arms/i, npc: /^bartender$/i, at: { x: 2690, z: 3494 }, price: 18 },
} satisfies Record<string, Bar>;
export type BarKey = keyof typeof BARS;

/** Coins for the drinks still to go plus both Karamja boats. */
export const COINS = 300;

const pos = (q: Quest) => {
    const p = q.sdk.getState()?.player;
    return { x: p?.worldX ?? 0, z: p?.worldZ ?? 0, level: p?.level ?? 0 };
};
const where = (q: Quest) => `${pos(q).x},${pos(q).z},L${pos(q).level}`;
export const holdsCard = (q: Quest) => q.count(CARD) > 0;

/**
 * Read the card: the bars it shows signed. null when no card is held or the scroll never opened.
 */
export async function readCard(q: Quest): Promise<Set<BarKey> | null> {
    const card = q.sdk.getInventory().find((i) => CARD.test(i.name));
    if (!card) return null;
    if (q.sdk.getDialog()?.isOpen) await driveDialog(q.sdk, [], { ticks: 5 });
    for (let attempt = 1; attempt <= 3; attempt++) {
        const before = q.sdk.getState()?.revision ?? -1;
        await q.sdk.sendUseItem(card.slot, 1);
        const opened = await untilTicks(
            q.sdk,
            (s) => !!s.interface?.isOpen && (s.revision ?? 0) > before && (s.interface.textComponents ?? []).some((c) => /barcrawl/i.test(c.text ?? '')),
            8,
        );
        if (!opened) continue;
        const lines = (q.sdk.getState()!.interface.textComponents ?? []).map((c) => c.text ?? '');
        await q.bot.closeInterface().catch(() => undefined);
        const done = new Set<BarKey>();
        for (const [key, bar] of Object.entries(BARS) as Array<[BarKey, Bar]>) {
            if (lines.some((l) => bar.line.test(l) && /- completed!/i.test(l))) done.add(key);
        }
        return done;
    }
    // "You are too drunk to be able to read the barcrawl card" once all ten are signed (quest_barcrawl.rs2).
    if ((q.sdk.getState()?.gameMessages ?? []).slice(-5).some((m) => /too drunk to be able to read/i.test(m.text ?? ''))) {
        return new Set(Object.keys(BARS) as BarKey[]);
    }
    return null;
}

/** The closed outpost gate (Open) beside GATE. */
async function gateLoc(q: Quest) {
    await q.sdk.scanNearbyLocs(8).catch(() => undefined);
    return (q.sdk.getNearbyLocs() ?? []).find(
        (l) => /gate/i.test(l.name) && Math.abs(l.x - GATE.x) <= 1 && Math.abs(l.z - GATE.z) <= 1 && l.optionsWithIndex.some((o) => /^open$/i.test(o.text)),
    );
}

/** Open the outpost gate from where we stand and drive whatever dialog it starts. Returns the text seen. */
async function opGate(q: Quest, choices: RegExp[], done: () => boolean): Promise<string> {
    const gate = await gateLoc(q);
    if (!gate) {
        q.log(`barcrawl: no outpost gate in view at ${where(q)}`);
        return '';
    }
    const op = gate.optionsWithIndex.find((o) => /^open$/i.test(o.text))!;
    await q.sdk.sendInteractLoc(gate.x, gate.z, gate.id, op.opIndex);
    await untilTicks(q.sdk, (s) => !!s.dialog?.isOpen || done(), 20);
    return q.sdk.getDialog()?.isOpen ? driveDialog(q.sdk, choices, { done, ticks: 80, log: q.log }) : '';
}

// From the west the gate teleports you to GATE.x + 1; from inside, onto its own tile (outpost_gate.rs2).
const insideOutpost = (q: Quest) => pos(q).level === 0 && pos(q).x > GATE.x && pos(q).x <= 2560 && pos(q).z >= 3550 && pos(q).z <= 3580;

/** At the gate from outside: the card from the guard (or nothing to do once the barcrawl is complete). */
export async function getCard(q: Quest): Promise<'card' | 'complete'> {
    await q.goTo(GATE_OUTSIDE, 2);
    for (let attempt = 1; attempt <= 3 && !holdsCard(q); attempt++) {
        const seen = await opGate(q, [/^i want to come through this gate/i, /^looks can be deceiving/i], () => holdsCard(q) || insideOutpost(q));
        if (insideOutpost(q) || /'ello friend/i.test(seen)) {
            // %barcrawl = 2: the gate lets us through. Back out.
            q.log('barcrawl: the outpost gate let us in — the barcrawl is already complete');
            await leaveOutpost(q);
            return 'complete';
        }
        if (!holdsCard(q)) q.log(`barcrawl: no card yet (attempt ${attempt}): ${seen.slice(0, 160)}`);
    }
    if (!holdsCard(q)) throw new Error(`barcrawl: the guard never handed over the card (at ${where(q)})`);
    q.log('barcrawl: got the Barcrawl card');
    return 'card';
}

/** Back out west through the gate (it teleports you onto its own tile). */
export async function leaveOutpost(q: Quest): Promise<void> {
    for (let attempt = 1; attempt <= 3 && insideOutpost(q); attempt++) {
        await q.bot.walkTo(GATE.x + 1, GATE.z, 1).catch(() => undefined);
        await opGate(q, [], () => !insideOutpost(q));
        await untilTicks(q.sdk, () => !insideOutpost(q), 6);
    }
}

/** Into the stronghold and up the Grand Tree to Blurberry's bar. */
async function toBlurberry(q: Quest): Promise<void> {
    await crossGnomeGate(q, true);
    await climbGrandTree(q);
    await q.goTo(BLURBERRY_BAR, 3);
}

/** Talk to the bartender and take the barcrawl drink; true once the card shows it signed. */
export async function drink(q: Quest, key: BarKey, signed: Set<BarKey>): Promise<void> {
    if (signed.has(key)) return;
    const bar: Bar = BARS[key];
    if (q.count('coins') < bar.price) throw new Error(`barcrawl: ${key} costs ${bar.price}, holding ${q.count('coins')} coins`);
    if (!holdsCard(q)) throw new Error(`barcrawl: no card at ${key}`);
    if (key === 'blurberry') await toBlurberry(q);
    else if (key === 'deadman') await toJungle(q, bar.at, 3);
    for (let attempt = 1; attempt <= 3; attempt++) {
        const coins = q.count('coins');
        const seen = await q.talk(bar.npc, [/barcrawl/i], key === 'blurberry' ? undefined : bar.at);
        // The drink's own messages run through p_delays after the dialog closes.
        await untilTicks(q.sdk, () => q.count('coins') <= coins - bar.price, 10);
        await q.sdk.waitForTicks(6);
        if (q.sdk.getDialog()?.isOpen) await driveDialog(q.sdk, [], { ticks: 10 });
        const now = await readCard(q);
        if (now?.has(key)) {
            signed.add(key);
            q.log(`barcrawl: ${key} signed (${signed.size}/10; ${q.count('coins')} coins left)`);
            return;
        }
        q.log(`barcrawl: ${key} not signed yet (attempt ${attempt}, at ${where(q)}): ${seen.slice(0, 160)}`);
        await q.sdk.waitForTicks(3);
    }
    throw new Error(`barcrawl: ${key} would not sign the card (at ${where(q)})`);
}

/** Camelot Teleport (Magic 45, current level: the drinks drain it) when the runes are held; else walk. */
export async function toSeers(q: Quest): Promise<void> {
    const magic = q.sdk.getSkill('magic')?.level ?? 1;
    if (magic >= 45 && q.count('law rune') >= 1 && q.count('air rune') >= 5 && Math.hypot(pos(q).x - 2757, pos(q).z - 3478) > 100) {
        const from = pos(q);
        for (let attempt = 1; attempt <= 3; attempt++) {
            await q.sdk.sendSetTab(6).catch(() => undefined);
            await q.sdk.waitForTicks(1);
            await q.sdk.sendClickComponent(CAMELOT_TELEPORT);
            if (await untilTicks(q.sdk, () => Math.hypot(pos(q).x - from.x, pos(q).z - from.z) > 30, 8)) {
                q.log(`barcrawl: Camelot Teleport to ${where(q)}`);
                return;
            }
        }
        q.log(`barcrawl: Camelot Teleport did not take (magic ${magic}); walking`);
    }
}

/** Every bit set: Open the gate, the guard takes the card. */
export async function handIn(q: Quest): Promise<void> {
    await q.goTo(GATE_OUTSIDE, 2);
    for (let attempt = 1; attempt <= 3 && holdsCard(q); attempt++) {
        const seen = await opGate(q, [], () => !holdsCard(q) && !q.sdk.getDialog()?.isOpen);
        if (!holdsCard(q)) break;
        q.log(`barcrawl: the guard kept the card (attempt ${attempt}): ${seen.slice(0, 160)}`);
    }
    if (holdsCard(q)) throw new Error('barcrawl: the guard would not take the card');
    if (q.sdk.getDialog()?.isOpen) await driveDialog(q.sdk, [], { ticks: 10 });
    q.log('barcrawl: card handed in — the outpost gate is open to us');
}

/** Through the gate and back: proof the barcrawl is complete (the gate only teleports you once %barcrawl = 2). */
export async function proveGate(q: Quest): Promise<boolean> {
    if (!insideOutpost(q)) await q.goTo(GATE_OUTSIDE, 2);
    for (let attempt = 1; attempt <= 3 && !insideOutpost(q); attempt++) {
        await opGate(q, [], () => insideOutpost(q));
        // Just used, the gate is open (no Open option) for 3 ticks: look again after it shuts.
        if (!(await untilTicks(q.sdk, () => insideOutpost(q), 6))) await q.sdk.waitForTicks(3);
    }
    const ok = insideOutpost(q);
    if (ok) await leaveOutpost(q);
    return ok;
}

/** The whole crawl from whatever the card says, then the hand-in. */
export async function crawl(q: Quest): Promise<void> {
    if (!holdsCard(q) && (await getCard(q)) === 'complete') {
        q.log('BARCRAWL COMPLETE (the gate opens for us)');
        return;
    }
    const signed = (await readCard(q)) ?? new Set<BarKey>();
    q.log(`barcrawl: card shows ${signed.size}/10 signed${signed.size ? ` (${[...signed].join(', ')})` : ''}`);
    const order: BarKey[] = ['blurberry', 'flyinghorse', 'dragoninn', 'deadman', 'zambo', 'rustyanchor', 'risingsun', 'bluemoon', 'jollyboar'];
    for (const key of order) {
        if (q.stopRequested()) throw new Error('barcrawl: stop requested mid-crawl');
        await drink(q, key, signed);
        if (key === 'blurberry' && pos(q).level !== 0) await leaveGrandTree(q);
    }
    if (!signed.has('foresters')) {
        await toSeers(q);
        await drink(q, 'foresters', signed);
    }
    await handIn(q);
    if (!(await proveGate(q))) throw new Error('barcrawl: card handed in but the gate did not let us through');
    q.log('BARCRAWL COMPLETE (the gate opens for us)');
}
