/**
 * Banked black dragonhide -> black d'hide armour, at Al Kharid:
 *
 *   bun bots/quests/dhide-craft.ts {botname}
 *
 *   travel   from the Ardougne hub, a ring of dueling (held, else one from the bank) rubbed
 *            to "Al Kharid Duel Arena"; with no ring the quest walker goes (toll gate and all)
 *   tanning  Ellis ("Tanner", 3275,3192): black dragonhide (#1747, the bank calls it
 *            "Dragonhide") -> black dragon leather, 20gp each from the bank, 27 a trip
 *   crafting needle + thread on leather at the Al Kharid bank: black d'hide bodies (3 leather,
 *            Crafting 84) by Make 10, 24 leather a pack; what is left under 3 goes to chaps
 *            (2, Crafting 82), then vambraces (1, Crafting 79). Needle and thread come from the
 *            bank, else Dommik (lib/sources.ts). Products are banked after every pack.
 *   return   Ardougne Teleport (Magic 51, 2 law + 2 water) or Camelot Teleport (Magic 45,
 *            1 law + 5 air) from banked runes when it can, then the epilogue walks to the
 *            Ardougne hub bank (walks the whole way when there are no runes)
 *
 * A task writes no run record, so a finish logs "already complete", the line todo-runner
 * marks done. Hides the coins do not cover and leather above the account's level stay banked
 * and are listed; neither fails the run.
 */
import { runTask, type Quest } from './lib/run-quest';
import { SAFE_BANKS } from './safe-stops';
import { tickNow, untilTicks } from './lib/ticks';
import { HIDES } from './lib/processing';

const ALK_BANK = SAFE_BANKS['al-kharid'];
const TANNER = { x: 3275, z: 3192 };
/** Ring of dueling teleport square (ring_of_dueling.rs2: map_findsquare 0_51_50_51_35, radius 2). */
const DUEL_ARENA = { x: 3315, z: 3235 };
const COINS = 995;
const NEEDLE = 1733;
const THREAD = 1734;
const HIDE = HIDES.find((h) => h.id === 1747)!;
const LEATHER = 2509;
/** ring_of_dueling_8 … _1 (obj.pack 2552-2566, certs between). Fewest charges first. */
const RINGS = [2566, 2564, 2562, 2560, 2558, 2556, 2554, 2552];
const LAW = 563;
const WATER = 555;
const AIR = 556;
const MAGIC_TAB = 6;
const ARDOUGNE_TELEPORT = 1540;
const CAMELOT_TELEPORT = 1174;
/** leather.dbrow craft_dragonhide_*_black; `label` is the skill_multi3 button text ("Black body"). */
const PRODUCTS = [
    { name: 'body', id: 2503, leather: 3, level: 84, label: /black body/i },
    { name: 'chaps', id: 2497, leather: 2, level: 82, label: /black chaps/i },
    { name: 'vambraces', id: 2491, leather: 1, level: 79, label: /black vambraces/i },
];
/** 26 free slots beside needle and thread. */
const FREE_SLOTS = 26;
/** One thread lasts 5 crafts (leather.rs2 %thread_used); 8 bodies a pack use 2. */
const THREAD_MIN = 3;
const THREAD_BUY = 10;
/** Ticks with no leather used before the crafting dialog is opened again. */
const REFIRE_TICKS = 8;
/** Opens of the crafting dialog in a row that use no leather before a pack is given up on. */
const MAX_DRY_FIRES = 4;

const summary: string[] = [];
const made = new Map<string, number>();

const invCount = (q: Quest, id: number) => q.sdk.getInventory().filter((i) => i.id === id).reduce((n, i) => n + (i.count ?? 1), 0);
const bankCount = (q: Quest, id: number) => q.sdk.getBankItems().filter((b) => b.id === id).reduce((n, b) => n + b.count, 0);
const pos = (q: Quest) => ({ x: q.sdk.getState()?.player?.worldX ?? 0, z: q.sdk.getState()?.player?.worldZ ?? 0 });
const away = (q: Quest, t: { x: number; z: number }) => Math.hypot(pos(q).x - t.x, pos(q).z - t.z);
const heldRing = (q: Quest) => q.sdk.getInventory().find((i) => RINGS.includes(i.id));

async function openBank(q: Quest): Promise<void> {
    if (q.sdk.getState()?.bank?.isOpen) return;
    if (away(q, ALK_BANK) > 6) await q.goTo(ALK_BANK, 4);
    let r = await q.bot.openBank();
    if (!r.success) {
        await q.goTo(ALK_BANK, 2);
        r = await q.bot.openBank();
    }
    if (!r.success) throw new Error(`dhide-craft: could not open the Al Kharid bank: ${r.message}`);
}

async function closeBank(q: Quest): Promise<void> {
    if (q.sdk.getState()?.bank?.isOpen) await q.bot.closeBank();
}

/** Bank everything carried except `keep` (ids) and the ring. Bank must be open. */
async function depositAll(q: Quest, keep: number[] = []): Promise<void> {
    let misses = 0;
    for (let i = 0; i < 30; i++) {
        const item = q.sdk.getInventory().find((it) => !keep.includes(it.id) && !RINGS.includes(it.id));
        if (!item) return;
        const r = await q.bot.depositItem(item, -1);
        if (r.success || r.partial) continue;
        await q.sdk.waitForTicks(2);
        if (!q.sdk.getInventory().some((it) => it.id === item.id)) continue;
        if (++misses > 3) throw new Error(`dhide-craft: deposit ${item.name}: ${r.message}`);
        q.log(`dhide-craft: deposit ${item.name} missed (${r.message}); retrying`);
    }
}

/** Withdraw up to `amount` (-1 all) of a banked id; returns how many arrived. */
async function withdraw(q: Quest, id: number, amount: number): Promise<number> {
    const b = q.sdk.getBankItems().find((x) => x.id === id);
    if (!b || amount === 0) return 0;
    const before = invCount(q, id);
    await q.bot.withdrawItem(b, amount < 0 || amount >= b.count ? -1 : amount);
    await untilTicks(q.sdk, () => invCount(q, id) > before, 4);
    return invCount(q, id) - before;
}

// ── travel: Ardougne -> Al Kharid by ring of dueling, else on foot
async function toAlKharid(q: Quest): Promise<void> {
    if (away(q, ALK_BANK) < 60) return;
    if (!heldRing(q)) {
        const r = await q.bot.openBank();
        if (r.success) {
            const id = RINGS.find((x) => bankCount(q, x) > 0);
            if (id) await withdraw(q, id, 1);
            await closeBank(q);
        }
    }
    const ring = heldRing(q);
    const rub = ring?.optionsWithIndex?.find((o) => /rub/i.test(o.text));
    if (ring && rub) {
        const from = pos(q);
        await q.sdk.sendUseItem(ring.slot, rub.opIndex);
        for (let t = 0; t < 12 && away(q, from) < 50; t++) {
            const opt = q.sdk.getDialog()?.options.find((o) => /al kharid duel arena/i.test(o.text));
            if (opt) {
                await q.sdk.sendClickDialog(opt.index);
                break;
            }
            await q.sdk.waitForTicks(1);
        }
        const landed = await untilTicks(q.sdk, () => away(q, DUEL_ARENA) < 10, 15);
        await q.sdk.waitForTicks(2); // the ring's charge change lands after the move
        q.log(`travel: ring of dueling ${landed ? 'to the Duel Arena' : 'did not teleport'} (${pos(q).x},${pos(q).z}); ${heldRing(q)?.name ?? 'ring used up'}`);
    } else {
        q.log('travel: no ring of dueling — walking to Al Kharid');
    }
    await q.goTo(ALK_BANK, 4);
}

// ── tanning: Ellis, tan-All, 27 hides a trip
async function tan(q: Quest): Promise<number> {
    const t0 = tickNow(q.sdk);
    let total = 0;
    let stalls = 0;
    for (;;) {
        await openBank(q);
        await depositAll(q);
        const n = Math.min(bankCount(q, HIDE.id), 27, Math.floor(bankCount(q, COINS) / HIDE.cost));
        if (!n || q.stopRequested()) break;
        await withdraw(q, COINS, n * HIDE.cost);
        const got = await withdraw(q, HIDE.id, n);
        await closeBank(q);
        const tp = tickNow(q.sdk);
        if (away(q, TANNER) > 4) await q.goTo(TANNER, 3);
        const tanner = q.sdk.findNearbyNpc(/^tanner$/i);
        if (!tanner) throw new Error('dhide-craft: no tanner in Al Kharid');
        for (let i = 0; i < 3 && invCount(q, HIDE.id) > 0; i++) {
            await q.bot.interactNpc(tanner, /trade/i);
            if (!(await untilTicks(q.sdk, (s) => !!s.interface?.isOpen, 15))) continue;
            await q.sdk.sendClickComponent(HIDE.button);
            await untilTicks(q.sdk, () => invCount(q, HIDE.id) === 0, 8);
        }
        await q.bot.closeInterface().catch(() => undefined);
        const tanned = got - invCount(q, HIDE.id);
        total += tanned;
        q.log(`tanning: ${tanned}/${got} black dragonhide in ${tickNow(q.sdk) - tp}t`);
        if (tanned === 0 && ++stalls >= 2) {
            q.log('WARN tanning: two trips tanned nothing; leaving the hides banked');
            break;
        }
    }
    if (total) summary.push(`tanned ${total} in ${tickNow(q.sdk) - t0}t`);
    return total;
}

// ── tools: needle and thread, the bank's first, else Dommik's
async function ensureTools(q: Quest): Promise<void> {
    await openBank(q);
    if (invCount(q, NEEDLE) === 0) await withdraw(q, NEEDLE, 1);
    if (invCount(q, THREAD) < THREAD_MIN) await withdraw(q, THREAD, -1);
    const needNeedle = invCount(q, NEEDLE) === 0;
    const needThread = invCount(q, THREAD) < THREAD_MIN;
    if (!needNeedle && !needThread) return;
    q.log(`tools: buying ${[needNeedle && 'a needle', needThread && 'thread'].filter(Boolean).join(' and ')} from Dommik`);
    if (invCount(q, COINS) < 20) await withdraw(q, COINS, 20);
    await closeBank(q);
    if (needNeedle) await q.ensure('needle', 1);
    if (needThread) await q.ensure('thread', THREAD_BUY);
    await openBank(q);
    await depositAll(q, [NEEDLE, THREAD]);
}

/** A level-up (or any single-button) dialog: click it away. True when one was open. */
async function dismissLevelUp(q: Quest): Promise<boolean> {
    const d = q.sdk.getState()?.dialog;
    if (!d?.isOpen || d.options.length > 1) return false;
    await q.sdk.sendClickDialog(d.options[0]?.index ?? 0);
    return true;
}

/**
 * Needle on leather opens the skill_multi3 dialog (body, vambraces, chaps; Make X / Make 10 /
 * Make 5 / the label for each). Make 10 runs one weakqueue chain, 3 ticks an item, until the
 * leather runs short. Opened again only when the chain has gone quiet with leather left.
 */
async function craftPack(q: Quest, p: (typeof PRODUCTS)[number]): Promise<{ made: number; ok: boolean }> {
    const leather = () => invCount(q, LEATHER);
    const before = invCount(q, p.id);
    let seen = leather();
    let lastProgress = tickNow(q.sdk);
    let dry = 0;
    while (leather() >= p.leather && invCount(q, THREAD) > 0) {
        if (dry >= MAX_DRY_FIRES) return { made: invCount(q, p.id) - before, ok: false };
        await dismissLevelUp(q);
        const needle = q.sdk.getInventory().find((i) => i.id === NEEDLE);
        const hide = q.sdk.getInventory().find((i) => i.id === LEATHER);
        if (!needle || !hide) break;
        await q.sdk.sendUseItemOnItem(needle.slot, hide.slot);
        dry++;
        if (!(await untilTicks(q.sdk, (s) => !!s.dialog?.isOpen && s.dialog.options.some((o) => p.label.test(o.text)), 10))) continue;
        const opts = q.sdk.getDialog()?.options ?? [];
        const at = opts.findIndex((o) => p.label.test(o.text));
        const make10 = opts.slice(0, at).reverse().find((o) => /make 10/i.test(o.text));
        await q.sdk.sendClickDialog((make10 ?? opts[at]!).index);
        // Wait out the chain: leather keeps going down every ~3 ticks while it runs.
        while (leather() >= p.leather) {
            await q.sdk.waitForTicks(1);
            if (await dismissLevelUp(q)) break; // a level-up pauses the chain: open the dialog again
            const now = leather();
            if (now !== seen) {
                seen = now;
                lastProgress = tickNow(q.sdk);
                dry = 0;
            } else if (tickNow(q.sdk) - lastProgress > REFIRE_TICKS) break;
        }
    }
    return { made: invCount(q, p.id) - before, ok: true };
}

async function craft(q: Quest): Promise<void> {
    const t0 = tickNow(q.sdk);
    const xp0 = q.sdk.getSkill('crafting')?.experience ?? 0;
    const failed = new Set<string>();
    for (;;) {
        if (q.stopRequested()) break;
        await openBank(q);
        await depositAll(q, [NEEDLE, THREAD]);
        const banked = bankCount(q, LEATHER);
        const p = PRODUCTS.find((x) => banked >= x.leather && q.level('crafting') >= x.level && !failed.has(x.name));
        if (!p) break;
        await ensureTools(q);
        if (invCount(q, NEEDLE) === 0 || invCount(q, THREAD) === 0) throw new Error('dhide-craft: no needle or thread after ensureTools');
        await openBank(q);
        // Whole items only (24 leather for bodies): what is left under 3 waits for chaps, then vambraces.
        const take = Math.min(banked, FREE_SLOTS);
        const n = take - (take % p.leather);
        await withdraw(q, LEATHER, n);
        const rest = bankCount(q, LEATHER);
        await closeBank(q);
        const tp = tickNow(q.sdk);
        const res = await craftPack(q, p);
        made.set(p.name, (made.get(p.name) ?? 0) + res.made);
        q.log(`crafting: ${res.made} black d'hide ${p.name} in ${tickNow(q.sdk) - tp}t (Crafting ${q.level('crafting')}, ${rest} leather banked)`);
        if (!res.ok || res.made === 0) {
            failed.add(p.name);
            q.log(`WARN crafting: ${p.name} made nothing this pack; not trying it again this run`);
        }
    }
    const total = [...made.values()].reduce((a, b) => a + b, 0);
    if (total) summary.push(`crafted ${[...made].map(([k, v]) => `${v} ${k}`).join(', ')} in ${tickNow(q.sdk) - t0}t (+${(q.sdk.getSkill('crafting')?.experience ?? 0) - xp0} xp)`);
}

// ── return: a teleport toward Ardougne when the bank has the runes; the epilogue walks the rest
async function teleportHome(q: Quest): Promise<void> {
    const magic = q.level('magic');
    const spells = [
        { name: 'Ardougne Teleport', id: ARDOUGNE_TELEPORT, level: 51, runes: [[LAW, 2], [WATER, 2]] },
        { name: 'Camelot Teleport', id: CAMELOT_TELEPORT, level: 45, runes: [[LAW, 1], [AIR, 5]] },
    ];
    for (const s of spells) {
        if (magic < s.level) continue;
        await openBank(q);
        if (!s.runes.every(([id, n]) => bankCount(q, id!) + invCount(q, id!) >= n!)) continue;
        for (const [id, n] of s.runes) if (invCount(q, id!) < n!) await withdraw(q, id!, n! - invCount(q, id!));
        await closeBank(q);
        const from = pos(q);
        await q.sdk.sendSetTab(MAGIC_TAB).catch(() => undefined);
        await q.sdk.waitForTicks(1);
        await q.sdk.sendClickComponent(s.id);
        // Ardougne Teleport needs Plague City and its scroll read (teleport.rs2 %elenaquest); refused,
        // nothing moves, the runes stay held and the next spell is tried.
        if (await untilTicks(q.sdk, () => away(q, from) > 100, 10)) {
            q.log(`return: ${s.name} to (${pos(q).x},${pos(q).z})`);
            return;
        }
        q.log(`return: ${s.name} did not move us`);
    }
    await closeBank(q);
    q.log('return: no teleport — walking back to Ardougne');
}

await runTask({
    id: 'dhide-craft',
    hub: 'ardougne',
    maxConcurrent: 8,
    task: async (q) => {
        const t0 = tickNow(q.sdk);
        const r = await q.bot.openBank();
        if (!r.success) throw new Error(`dhide-craft: could not open the Ardougne bank: ${r.message}`);
        const hides = bankCount(q, HIDE.id);
        const leather = bankCount(q, LEATHER);
        const coins = bankCount(q, COINS);
        await closeBank(q);
        const tannable = Math.min(hides, Math.floor(coins / HIDE.cost));
        const craftable = (leather + tannable) >= 1 && q.level('crafting') >= 79;
        q.log(`dhide-craft: ${hides} black dragonhide, ${leather} black dragon leather, ${coins} coins banked; Crafting ${q.level('crafting')}`);
        if (!tannable && !craftable) {
            q.log(`dhide-craft: nothing to tan or craft${hides ? ` (${hides} hides, ${coins} coins)` : ''}${leather ? ` (${leather} leather, Crafting ${q.level('crafting')})` : ''} — already complete`);
            return;
        }
        await toAlKharid(q);
        await tan(q);
        await craft(q);
        await openBank(q);
        await depositAll(q);
        const left: string[] = [];
        const h = bankCount(q, HIDE.id);
        const l = bankCount(q, LEATHER);
        if (h) left.push(`${h} black dragonhide (20gp each, ${bankCount(q, COINS)} coins left)`);
        if (l) left.push(`${l} black dragon leather (Crafting ${q.level('crafting')})`);
        const products = PRODUCTS.map((p) => `${bankCount(q, p.id)} ${p.name}`).join(', ');
        q.log(`dhide-craft: ${summary.join('; ') || 'nothing done'} — ${tickNow(q.sdk) - t0}t; bank now holds ${products}`);
        if (left.length) q.log(`dhide-craft: left banked: ${left.join(', ')}`);
        await teleportHome(q);
        q.log(q.stopRequested() ? 'dhide-craft: stopped early — the rest stays banked' : 'dhide-craft: already complete — no black dragonhide or leather left this account can use');
    },
});
