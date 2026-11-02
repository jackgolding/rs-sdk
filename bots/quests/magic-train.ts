/**
 * Magic trainer: combat spells on cows (or teleport spam) from banked runes,
 * until a target Magic level. Built to lift fleet melee accounts from Magic
 * ~37-49 to Legends (56) / Family Crest (59).
 *
 *   bun bots/quests/magic-train.ts <bot> [--until=59] [--mode=auto|combat|tele]
 *       [--spell=wind-blast|wind-bolt|wind-strike|camelot|lumbridge] [--spot=ardougne|lumbridge]
 *       [--keep-gear]
 *
 * Content facts (server/content/scripts):
 *   - skill_combat/configs/magic/magic_combat_spells.dbrow: Wind Strike L1 (1 mind + 1 air, 5.5xp),
 *     Wind Bolt L17 (1 chaos + 2 air, 13.5xp), Wind Blast L41 (1 death + 3 air, 25.5xp).
 *   - player_magic.rs2 pvm_spell_cast: base xp on every cast (splash too) and %action_delay = +5
 *     ticks; a hit adds 2 xp per damage (combat.rs2 give_combat_experience), capped at the target's
 *     remaining HP. A cast sent early is re-queued (p_opnpct), never dropped.
 *   - Magic defence roll uses the NPC's magic level (cow: 1, magicdefence -21), the attack roll the
 *     player's magic attack bonus: rune armour (~-65 together) makes nearly every cast splash, so
 *     non-magic gear is banked first and put back on at the stop (--keep-gear skips that).
 *   - skill_magic/configs/magic_spells.dbrow: Lumbridge Teleport L31 (1 law + 3 air + 1 earth, 41xp),
 *     Camelot Teleport L45 (1 law + 5 air, 55.5xp, members). Falador/Varrock need water/fire,
 *     which the fleet barely has.
 *   - magic_staff.dbrow: a staff of air (Zaff, Varrock, 1500gp; Magic Guild needs 66) / air
 *     battlestaff / mystic air staff is an endless air rune source; wielded when banked (not bought:
 *     Zaff is a cross-map walk from the cow fields, and air runes are the fleet's biggest stack).
 *   - auto_cast.rs2: autocast exists (combat_staff_2 "Choose spell" -> staff_spells:ssbN) but needs
 *     a staff and the SDK has no wrapper; click-casting re-queues an early cast, so it loses nothing.
 *
 * Why cows: max hit 1 (no food, no HP drain with the armour off), never aggressive, ten of them
 * 60 tiles north of Ardougne bank (m41_52 spawns 2657-2672,3341-3354), and runes stack, so the bank
 * is only visited to restock. 8 HP caps the damage xp a little (Wind Blast max 13; 34 xp/cast vs
 * 38.5 uncapped). Cows respawn in 90 ticks, so one field carries about one account at full speed;
 * without --spot the field next to the nearest bank is used (Ardougne, or Lumbridge from Draynor).
 *
 * Cost on a 25x world (NODE_XPRATE 25: local engines and fly.toml): Magic 41 -> 59 is 44,700 xp
 * (engine curve, Player.ts levelExperience) = ~54 Wind Blasts = 54 death + 162 air runes, a few
 * minutes. 37 -> 41 is ~9 Wind Bolts. Withdraws are sized to the goal (+50 casts), not the stack.
 *
 * Exit codes: 0 = Magic reached --until, or stopped on SIGTERM (banked, gear back on);
 * 4 = NEEDS STOCK (no spell affordable from bank: the mule tops up runes); 70 = restartable error.
 */
import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'fs';
import { join } from 'path';
import { ActivitySession } from '../../sdk/index';
import type { BotSDK } from '../../sdk/index';
import type { NearbyNpc } from '../../sdk/types';
import { runScript } from '../../sdk/runner';
import { walkNear } from './movement';
import { requestFromMule } from './supply';
import { ensureBankStart, nearestBank, parkAtBank, SAFE_BANKS, type SafeBankName } from './safe-stops';
import { tickNow, untilTicks } from './lib/ticks';

// ------------------------------------------------------------------ args

function flag(name: string): string | undefined {
    const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
    return hit ? hit.slice(name.length + 3).trim() : undefined;
}

const botName = process.argv.slice(2).find((a) => !a.startsWith('-')) ?? '';
const UNTIL = Number(flag('until') ?? 59) || 59;
const MODE = (flag('mode') ?? 'auto') as 'auto' | 'combat' | 'tele';
const SPELL_ARG = flag('spell');
const SPOT_ARG = flag('spot');
const KEEP_GEAR = process.argv.includes('--keep-gear');
const GRIND_LOG = join(process.cwd(), 'bots', botName, 'grind.log');
const GEAR_FILE = join(process.cwd(), 'bots', botName, 'magic-train-gear.json');

const NEEDS_STOCK_EXIT = 4;

// ------------------------------------------------------------------ content

type Rune = 'air' | 'death' | 'chaos' | 'mind' | 'law' | 'earth';
const RUNE_RE: Record<Rune, RegExp> = {
    air: /^air rune$/i,
    death: /^death rune$/i,
    chaos: /^chaos rune$/i,
    mind: /^mind rune$/i,
    law: /^law rune$/i,
    earth: /^earth rune$/i,
};
const ANY_RUNE = /^(air|death|chaos|mind|law|earth) rune$/i;
const AIR_STAFF = /^(staff of air|air battlestaff|mystic air staff)$/i;

interface SpellDef {
    key: string;
    kind: 'combat' | 'tele';
    component: number;
    level: number;
    runes: Partial<Record<Rune, number>>;
    /** Base xp per cast (the dbrow value / 10). */
    xp: number;
    /** Measured content xp per cast (before the world multiplier), splashes and cow HP cap included. */
    xpPerCast: number;
    /** Measured game ticks per cast, walking/idle/restock included (fast engine, see RATES). */
    ticksPerCast: number;
}

/**
 * Preference order for --mode=auto: combat spells first (death and chaos runes are the fleet's
 * plentiful stock, ~48k / ~5.7k), teleports only when no combat runes are banked (law is ~7k and
 * quests spend it). On a 25x world any option takes minutes per level, so rune scarcity, not
 * xp/hour, decides.
 *
 * RATES — fast engine (60ms ticks), Magic 41/45 fixtures, rune armour banked, 700-835 casts:
 *   wind-blast  Ardougne cows  6.2 t/cast  34.1 xp/cast  (9% splash, 17% of ticks waiting for a cow)
 *   wind-bolt   Lumbridge cows 7.2 t/cast  20.0 xp/cast  (28% of ticks waiting for a cow)
 *   camelot     in place       5.0 t/cast  55.5 xp/cast
 *   lumbridge   in place       5.0 t/cast  41.0 xp/cast
 * content xp/hour = xpPerCast / ticksPerCast × ticks/hour (6000 at 600ms, 12000 at prod's 300ms),
 * then × the world multiplier (NODE_XPRATE 25 locally and in fly.toml).
 */
const SPELLS: SpellDef[] = [
    { key: 'wind-blast', kind: 'combat', component: 1172, level: 41, runes: { death: 1, air: 3 }, xp: 25.5, xpPerCast: 34.1, ticksPerCast: 6.2 },
    { key: 'wind-bolt', kind: 'combat', component: 1160, level: 17, runes: { chaos: 1, air: 2 }, xp: 13.5, xpPerCast: 20.0, ticksPerCast: 7.2 },
    { key: 'wind-strike', kind: 'combat', component: 1152, level: 1, runes: { mind: 1, air: 1 }, xp: 5.5, xpPerCast: 8.5, ticksPerCast: 7 },
    { key: 'camelot', kind: 'tele', component: 1174, level: 45, runes: { law: 1, air: 5 }, xp: 55.5, xpPerCast: 55.5, ticksPerCast: 5.0 },
    { key: 'lumbridge', kind: 'tele', component: 1167, level: 31, runes: { law: 1, air: 3, earth: 1 }, xp: 41, xpPerCast: 41, ticksPerCast: 5.0 },
];

/** NODE_XPRATE (WorldConfig.ts default, fly.toml) until the first casts measure it. */
const DEFAULT_XP_RATE = 25;
/** Spare casts withdrawn on top of what the goal needs (splash streaks, a level's rounding). */
const SPARE_CASTS = 50;

/** Engine levelExperience (Player.ts): xp needed for a level, in SDK (whole xp) units. */
function xpForLevel(level: number): number {
    let acc = 0;
    for (let l = 1; l < level; l++) acc += Math.floor(l + Math.pow(2, l / 10) * 300);
    return Math.floor(acc / 4);
}

interface Spot {
    bank: SafeBankName;
    /** Middle of the cow field, and how far from it a cow still counts as ours. */
    field: { x: number; z: number };
    radius: number;
}

const SPOTS: Record<string, Spot> = {
    /** m41_52: ten cows at 2657-2672,3341-3354, 60 tiles north of the bank. */
    ardougne: { bank: 'ardougne', field: { x: 2664, z: 3347 }, radius: 12 },
    /** m50_51 + m50_50: ten cows in the Lumbridge east pen (cow-leather-bank.ts's camps). */
    lumbridge: { bank: 'draynor', field: { x: 3254, z: 3282 }, radius: 16 },
};

/** Where a teleport lands, and the bank the session parks at when it stops. */
const TELE_BANK: Record<string, SafeBankName> = { camelot: 'seers', lumbridge: 'draynor' };

/** Worn items that never hurt magic accuracy: kept on. Everything else is banked. */
const KEEP_WORN = /(amulet|necklace|cape|cloak|ring|arrow|bolt|staff|wand|wizard|mystic|robe|hat)/i;

const COW = /^cow$/i;
/** cow / cow2 hitpoints (all.npc), for when the state has not revealed maxHp yet. */
const COW_HP = 8;
/** How long a cast may take to show xp before it counts as missed (5-tick cooldown + walk). */
const CAST_WAIT_TICKS = 12;
/** Re-pick runes when fewer casts than this are left in the pack. */
const MIN_CASTS = 1;
/** Casts needed in the bank for a spell to be worth a trip. */
const MIN_BANK_CASTS = 20;
const RATE_EVERY = 100;

// ------------------------------------------------------------------ helpers

function count(sdk: BotSDK, re: RegExp): number {
    return sdk
        .getInventory()
        .filter((i) => re.test(i.name))
        .reduce((n, i) => n + (i.count ?? 1), 0);
}

function bankCount(sdk: BotSDK, re: RegExp): number {
    return sdk
        .getBankItems()
        .filter((i) => re.test(i.name))
        .reduce((n, i) => n + (i.count ?? 0), 0);
}

function magicXp(sdk: BotSDK): number {
    return sdk.getSkill('Magic')?.experience ?? 0;
}

function magicLevel(sdk: BotSDK): number {
    return sdk.getSkill('Magic')?.baseLevel ?? 1;
}

function hasAirStaff(sdk: BotSDK): boolean {
    return !!sdk.findEquipmentItem(AIR_STAFF);
}

/** Casts the given rune counts allow (air ignored with an air staff). */
function castsFrom(spell: SpellDef, have: (r: Rune) => number, staff: boolean): number {
    let n = Infinity;
    for (const [rune, per] of Object.entries(spell.runes) as Array<[Rune, number]>) {
        if (rune === 'air' && staff) continue;
        n = Math.min(n, Math.floor(have(rune) / per));
    }
    return n === Infinity ? 0 : n;
}

function here(sdk: BotSDK): string {
    const p = sdk.getState()?.player;
    return `${p?.worldX ?? 0},${p?.worldZ ?? 0}`;
}

// ------------------------------------------------------------------ main

let exitCode = 0;

await runScript(async ({ bot, sdk }) => {
    const session = new ActivitySession(sdk, bot, { name: 'magic-train', grindLogPath: GRIND_LOG });
    const log = (msg: string) => session.log('log', msg);
    const warn = (msg: string) => session.log('warn', msg);

    let spell: SpellDef | null = null;
    // No --spot: the field whose bank is nearest, so a start never begins with a cross-map walk.
    const startTile = sdk.getState()?.player;
    const nearestSpot = Object.values(SPOTS).sort((a, b) => {
        const d = (s: Spot) => Math.hypot(SAFE_BANKS[s.bank].x - (startTile?.worldX ?? 0), SAFE_BANKS[s.bank].z - (startTile?.worldZ ?? 0));
        return d(a) - d(b);
    })[0]!;
    let spot: Spot = (SPOT_ARG && SPOTS[SPOT_ARG]) || nearestSpot;
    let homeBank: SafeBankName = spot.bank;

    let phase = '';
    async function phaseTo(next: string): Promise<void> {
        if (next === phase) return;
        phase = next;
        await session.setPhase(next);
    }

    // Rate bookkeeping, per spell. Worlds run an xp multiplier (NODE_XPRATE, 25 on the local
    // engines): the smallest gain seen is a 0-damage cast = base xp × multiplier, so
    // `minGain / spell.xp` recovers it and the log can say what one cast is worth in content xp.
    let casts = 0;
    let hits = 0;
    let misses = 0;
    /** Ticks spent with no free cow to cast at (respawn wait / shared field). */
    let idleTicks = 0;
    let minGain = Infinity;
    let runStartTick = tickNow(sdk);
    let runStartXp = magicXp(sdk);
    let windowTick = runStartTick;
    let windowXp = runStartXp;
    let windowCasts = 0;
    const spent = new Map<Rune, number>();

    /** World xp multiplier: DEFAULT_XP_RATE until a 0-damage cast or a teleport measures it. */
    let worldMult = DEFAULT_XP_RATE;
    function xpMult(): number {
        return spell && Number.isFinite(minGain) ? Math.max(1, Math.round(minGain / spell.xp)) : worldMult;
    }

    function rateLine(tag: string): string {
        const t = tickNow(sdk);
        const xp = magicXp(sdk);
        const ticks = Math.max(1, t - runStartTick);
        const perTick = (xp - runStartXp) / ticks;
        const wTicks = Math.max(1, t - windowTick);
        const wPer = (xp - windowXp) / wTicks;
        const mult = xpMult();
        const used = [...spent.entries()].map(([r, n]) => `${r} ${Math.round(n * (6000 / ticks))}/h`).join(' ') || 'none';
        return (
            `${tag} ${spell?.key ?? '-'}: ${casts} casts (${hits} damaging, ${misses} missed, ${idleTicks}t no cow) +${xp - runStartXp}xp in ${ticks}t = ` +
            `${perTick.toFixed(2)} xp/t, ${(ticks / Math.max(1, casts)).toFixed(1)} t/cast, ${((xp - runStartXp) / Math.max(1, casts) / mult).toFixed(1)} content xp/cast (x${mult} world) | ` +
            `@600ms: ${Math.round(perTick * 6000)} xp/h, runes ${used} | last ${windowCasts} casts ${wPer.toFixed(2)} xp/t | Magic ${magicLevel(sdk)} (${xp})`
        );
    }

    function resetRates(): void {
        casts = hits = misses = windowCasts = idleTicks = 0;
        minGain = Infinity;
        runStartTick = windowTick = tickNow(sdk);
        runStartXp = windowXp = magicXp(sdk);
        spent.clear();
    }

    /** Book one landed cast: runes spent (air is free with a staff), the window line every RATE_EVERY. */
    function bookCast(gained: number): void {
        casts++;
        windowCasts++;
        minGain = Math.min(minGain, gained);
        // Teleports always give exactly the base; for combat the minimum settles after a few casts.
        if (spell!.kind === 'tele' || casts >= 20) worldMult = xpMult();
        for (const [r, n] of Object.entries(spell!.runes) as Array<[Rune, number]>) {
            if (r === 'air' && hasAirStaff(sdk)) continue;
            spent.set(r, (spent.get(r) ?? 0) + n);
        }
        session.noteProgress('xp', spell!.key);
        if (casts % RATE_EVERY === 0) {
            log(rateLine('rate'));
            windowTick = tickNow(sdk);
            windowXp = magicXp(sdk);
            windowCasts = 0;
        }
    }

    // -------------------------------------------------------------- bank

    async function openBankAt(name: SafeBankName): Promise<boolean> {
        if (sdk.getState()?.bank?.isOpen) return true;
        const tile = SAFE_BANKS[name];
        if (Math.hypot(tile.x - (sdk.getState()?.player?.worldX ?? 0), tile.z - (sdk.getState()?.player?.worldZ ?? 0)) > 8) {
            await ensureBankStart(sdk, bot, name, GRIND_LOG);
            await walkNear(bot, sdk, tile.x, tile.z, 4);
        }
        for (let i = 0; i < 3; i++) {
            const r = await bot.openBank();
            if (r.success || sdk.getState()?.bank?.isOpen) {
                await untilTicks(sdk, () => sdk.getBankItems().length > 0, 4);
                return true;
            }
            await sdk.waitForTicks(2);
        }
        return !!sdk.getState()?.bank?.isOpen;
    }

    function readGearFile(): string[] {
        try {
            if (!existsSync(GEAR_FILE)) return [];
            const parsed = JSON.parse(readFileSync(GEAR_FILE, 'utf8'));
            return Array.isArray(parsed) ? parsed.filter((n) => typeof n === 'string') : [];
        } catch {
            return [];
        }
    }

    /** Take off and remember everything that lowers magic accuracy. Bank must be closed. */
    async function stripGear(): Promise<string[]> {
        if (KEEP_GEAR) return [];
        const stripped = readGearFile();
        for (const item of sdk.getEquipment()) {
            if (KEEP_WORN.test(item.name)) continue;
            const r = await bot.unequipItem(item);
            if (r.success) stripped.push(item.name);
            else warn(`could not take off ${item.name}: ${r.message}`);
        }
        if (stripped.length) writeFileSync(GEAR_FILE, JSON.stringify([...new Set(stripped)]));
        return stripped;
    }

    /** Put the stripped gear back on (at a bank, after the deposit). Best effort. */
    async function restoreGear(): Promise<void> {
        const names = readGearFile();
        if (!names.length) return;
        if (!(await openBankAt(homeBank))) {
            warn(`gear restore: bank did not open @ ${here(sdk)}; ${names.join(', ')} stay banked`);
            return;
        }
        // The staff goes back in the bank so the melee weapon can go on.
        const staff = sdk.findEquipmentItem(AIR_STAFF);
        for (const name of names) {
            const re = new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i');
            if (sdk.findBankItem(re)) await bot.withdrawItem(re, 1).catch(() => undefined);
        }
        await bot.closeBank().catch(() => undefined);
        if (staff) await bot.unequipItem(staff).catch(() => undefined);
        const worn: string[] = [];
        for (const name of names) {
            const item = sdk.getInventory().find((i) => i.name.toLowerCase() === name.toLowerCase());
            if (!item) continue;
            const r = await bot.equipItem(item);
            if (r.success) worn.push(name);
        }
        // The staff, and anything the game would not let us wear, goes back in the bank: the
        // handoff is an empty pack.
        const leftover = sdk.getInventory().filter((i) => AIR_STAFF.test(i.name) || names.some((n) => n.toLowerCase() === i.name.toLowerCase()));
        if (leftover.length && (await openBankAt(homeBank))) {
            for (const item of leftover) await bot.depositItem(item, -1).catch(() => undefined);
            await bot.closeBank().catch(() => undefined);
        }
        const notWorn = names.filter((n) => !worn.includes(n));
        log(`gear back on: ${worn.join(', ') || 'none'}${notWorn.length ? ` | banked (could not wear): ${notWorn.join(', ')}` : ''}`);
        try {
            unlinkSync(GEAR_FILE);
        } catch {
            /* already gone */
        }
    }

    /** Bank is open. Pick the best spell this account can cast from bank + pack. */
    /** Rune counts the bank showed at the last visit: whether a level-up's better spell is worth a trip. */
    const lastBank = new Map<Rune, number>();

    /** Spells this run may use at the current level, most preferred first. */
    function allowedSpells(): SpellDef[] {
        const lvl = magicLevel(sdk);
        return SPELLS.filter((s) => {
            if (s.level > lvl) return false;
            if (SPELL_ARG) return s.key === SPELL_ARG;
            if (MODE === 'combat') return s.kind === 'combat';
            if (MODE === 'tele') return s.kind === 'tele';
            return true;
        });
    }

    /** Casts of `s` still needed to reach --until. */
    function castsToGoal(s: SpellDef): number {
        const left = Math.max(0, xpForLevel(UNTIL) - magicXp(sdk));
        return Math.ceil(left / (s.xpPerCast * worldMult));
    }

    /** Bank is open. Pick the most preferred spell this account can cast from bank + pack. */
    function pickSpell(): { spell: SpellDef | null; short: string } {
        const staffNow = hasAirStaff(sdk) || !!sdk.findInventoryItem(AIR_STAFF) || bankCount(sdk, AIR_STAFF) > 0;
        const have = (r: Rune) => count(sdk, RUNE_RE[r]) + bankCount(sdk, RUNE_RE[r]);
        const options = allowedSpells();
        const best = options.find((s) => castsFrom(s, have, staffNow) >= Math.min(MIN_BANK_CASTS, castsToGoal(s))) ?? null;
        // What the preferred spell is short of, to the goal, for the NEEDS STOCK line.
        const want = options[0];
        const short = want
            ? (Object.entries(want.runes) as Array<[Rune, number]>)
                  .filter(([r]) => !(r === 'air' && staffNow))
                  .map(([r, per]) => `${r} rune ×${Math.max(0, per * (castsToGoal(want) + SPARE_CASTS) - have(r))}`)
                  .filter((s) => !s.endsWith('×0'))
                  .join(', ') + ` (${want.key} to Magic ${UNTIL})`
            : 'no spell at this Magic level';
        return { spell: best, short: short || 'runes' };
    }

    /**
     * One bank visit: deposit everything but runes and the staff, wield an air staff if banked,
     * choose the spell, withdraw all of its runes. Returns false on NEEDS STOCK.
     */
    /** The last NEEDS STOCK shortfall, e.g. "air rune ×236 (wind-blast to Magic 59)". */
    let lastShort = '';
    async function restock(): Promise<'ok' | 'needs_stock' | 'bank_failed'> {
        await phaseTo('bank');
        if (!(await openBankAt(homeBank))) return 'bank_failed';
        for (const item of sdk.getInventory()) {
            if (ANY_RUNE.test(item.name) || AIR_STAFF.test(item.name)) continue;
            await bot.depositItem(item, -1).catch(() => undefined);
        }
        if (!hasAirStaff(sdk) && !sdk.findInventoryItem(AIR_STAFF) && sdk.findBankItem(AIR_STAFF)) {
            await bot.withdrawItem(AIR_STAFF, 1).catch(() => undefined);
        }
        const picked = pickSpell();
        if (!picked.spell) {
            await bot.closeBank().catch(() => undefined);
            lastShort = picked.short;
            session.log('error', `NEEDS STOCK: ${picked.short} (Magic ${magicLevel(sdk)}, mode ${MODE}${SPELL_ARG ? `, spell ${SPELL_ARG}` : ''})`);
            return 'needs_stock';
        }
        const next = picked.spell;
        // Runes another spell needs go back: they are fleet stock, not this job's.
        for (const item of sdk.getInventory()) {
            if (!ANY_RUNE.test(item.name)) continue;
            const rune = (Object.keys(RUNE_RE) as Rune[]).find((r) => RUNE_RE[r].test(item.name));
            if (rune && next.runes[rune]) continue;
            await bot.depositItem(item, -1).catch(() => undefined);
        }
        const staffHeld = !!sdk.findInventoryItem(AIR_STAFF) || hasAirStaff(sdk);
        for (const rune of Object.keys(next.runes) as Rune[]) {
            if (rune === 'air' && staffHeld) {
                if (count(sdk, RUNE_RE.air) > 0) await bot.depositItem(RUNE_RE.air, -1).catch(() => undefined);
                continue;
            }
            // Only what the goal needs (+spare): the rest stays banked for the mule's books.
            const want = next.runes[rune]! * (castsToGoal(next) + SPARE_CASTS) - count(sdk, RUNE_RE[rune]);
            const take = Math.min(want, bankCount(sdk, RUNE_RE[rune]));
            if (take > 0) {
                const w = await bot.withdrawItem(RUNE_RE[rune], take);
                if (!w.success) warn(`withdraw ${take} ${rune} runes: ${w.message}`);
            }
        }
        for (const r of Object.keys(RUNE_RE) as Rune[]) lastBank.set(r, bankCount(sdk, RUNE_RE[r]));
        await bot.closeBank().catch(() => undefined);
        await untilTicks(sdk, (s) => !s.bank?.isOpen, 4);
        const staffInv = sdk.findInventoryItem(AIR_STAFF);
        if (staffInv) {
            const r = await bot.equipItem(staffInv);
            if (!r.success) warn(`could not wield ${staffInv.name}: ${r.message}`);
        }
        if (spell?.key !== next.key) {
            spell = next;
            resetRates();
        }
        const have = (r: Rune) => count(sdk, RUNE_RE[r]);
        log(
            `Restocked for ${next.key} (L${next.level}, ${next.xp}xp base): ${castsFrom(next, have, hasAirStaff(sdk))} casts in the pack` +
                `${hasAirStaff(sdk) ? ' (air staff wielded)' : ''} | ` +
                (Object.keys(next.runes) as Rune[]).map((r) => `${r} ${count(sdk, RUNE_RE[r])}`).join(' ')
        );
        return 'ok';
    }

    /** Never fight on Defensive: magic would get 1.33 xp/damage instead of 2. */
    async function nonDefensiveStyle(): Promise<void> {
        const cs = sdk.getState()?.combatStyle;
        if (!cs?.known) return;
        const cur = cs.styles.find((s) => s.index === cs.currentStyle);
        if (cur && !/defensive/i.test(cur.type)) return;
        const pick = cs.styles.find((s) => !/defensive/i.test(s.type));
        if (pick) {
            await sdk.sendSetCombatStyle(pick.index);
            log(`combat style ${cur?.name ?? '?'} -> ${pick.name} (defensive casting halves magic xp)`);
        }
    }

    function packCasts(): number {
        if (!spell) return 0;
        return castsFrom(spell, (r) => count(sdk, RUNE_RE[r]), hasAirStaff(sdk));
    }

    // -------------------------------------------------------------- casting

    const unreachable = new Map<number, number>();
    /**
     * Damage dealt per cow (from the xp gain). The xp lands when the spell leaves; the hit lands
     * 2-3 ticks later, so the state still shows a cow alive that our last cast already killed.
     * Casting at it again wastes a whole wait.
     */
    const dealt = new Map<number, { damage: number; tick: number }>();
    /** A cow we stopped hitting this long ago is dead and gone; its npc index may be a new cow. */
    const DEALT_TTL_TICKS = 15;
    let current: number | null = null;

    function dealtTo(index: number): number {
        const d = dealt.get(index);
        if (!d) return 0;
        if (tickNow(sdk) - d.tick > DEALT_TTL_TICKS) {
            dealt.delete(index);
            return 0;
        }
        return d.damage;
    }

    function pickCow(): NearbyNpc | null {
        const t = tickNow(sdk);
        const cows = sdk
            .getNearbyNpcs()
            .filter((n) => COW.test(n.name) && n.hp !== 0 && n.reachable !== false)
            .filter((n) => Math.hypot(n.x - spot.field.x, n.z - spot.field.z) <= spot.radius + 4)
            .filter((n) => (unreachable.get(n.index) ?? -1) < t)
            .filter((n) => dealtTo(n.index) < (n.maxHp ?? COW_HP));
        const mine = current !== null ? cows.find((n) => n.index === current) : undefined;
        if (mine) return mine;
        // A cow next to us in combat is the one retaliating: single-way combat refuses any
        // other target ("I'm already under attack!") until it dies.
        const onUs = cows.filter((n) => n.inCombat && n.distance <= 2).sort((a, b) => a.distance - b.distance)[0];
        if (onUs) return onUs;
        // A cow already fighting someone else is theirs.
        const free = cows.filter((n) => !n.inCombat);
        const pool = free.length ? free : cows;
        pool.sort((a, b) => a.distance - b.distance);
        return pool[0] ?? null;
    }

    function messagesSince(msg0: number): string {
        return (
            sdk
                .getState()
                ?.gameMessages.filter((m) => (m.observationId ?? 0) > msg0)
                .map((m) => m.text)
                .join(' / ') ?? ''
        );
    }

    /** One cast at a cow. 'cast' = xp landed; 'none' = no cow in the field; 'miss' = nothing landed. */
    async function castOnce(): Promise<'cast' | 'none' | 'miss'> {
        const cow = pickCow();
        if (!cow) return 'none';
        current = cow.index;
        const xp0 = magicXp(sdk);
        const msg0 = sdk.getState()?.gameMessages.at(-1)?.observationId ?? 0;
        const r = await sdk.sendSpellOnNpc(cow.index, spell!.component);
        if (!r.success) {
            misses++;
            unreachable.set(cow.index, tickNow(sdk) + 20);
            current = null;
            return 'miss';
        }
        const landed = await untilTicks(
            sdk,
            (s) =>
                (s.skills.find((k) => k.name === 'Magic')?.experience ?? 0) > xp0 ||
                s.gameMessages.some((m) => (m.observationId ?? 0) > msg0 && /can't reach|not have enough|do not have enough|someone else|under attack/i.test(m.text)),
            CAST_WAIT_TICKS
        );
        const gained = magicXp(sdk) - xp0;
        if (!landed || gained <= 0) {
            misses++;
            const why = messagesSince(msg0);
            if (why) session.noteFailure('cast', why);
            unreachable.set(cow.index, tickNow(sdk) + 20);
            current = null;
            return 'miss';
        }
        bookCast(gained);
        const mult = xpMult();
        const damage = Math.max(0, Math.round((gained / mult - spell!.xp) / 2));
        if (damage > 0) hits++;
        const total = dealtTo(cow.index) + damage;
        dealt.set(cow.index, { damage: total, tick: tickNow(sdk) });
        if (total >= (cow.maxHp ?? COW_HP)) current = null;
        return 'cast';
    }

    async function castTele(): Promise<'cast' | 'miss'> {
        const xp0 = magicXp(sdk);
        const msg0 = sdk.getState()?.gameMessages.at(-1)?.observationId ?? 0;
        await sdk.sendClickComponent(spell!.component);
        const landed = await untilTicks(sdk, (s) => (s.skills.find((k) => k.name === 'Magic')?.experience ?? 0) > xp0, 8);
        if (!landed) {
            misses++;
            session.noteFailure('tele', messagesSince(msg0) || 'no xp');
            await sdk.waitForTicks(1);
            return 'miss';
        }
        bookCast(magicXp(sdk) - xp0);
        // Wait out the teleport (p_delay) so the next click is not swallowed mid-jump.
        await untilTicks(sdk, (s) => (s.player?.animId ?? -1) === -1, 4);
        return 'cast';
    }

    // -------------------------------------------------------------- stop paths

    async function parkAndRestore(reason: string): Promise<void> {
        // The phase name is what park.json records as the bank.
        await phaseTo(homeBank);
        const tile = SAFE_BANKS[homeBank];
        // safe-stops' goToBank is one send-hop: from a cow field 60 tiles out it never arrived.
        await walkNear(bot, sdk, tile.x, tile.z, 4);
        const banked = await parkAtBank(sdk, bot, homeBank, { timeoutMs: 240_000 });
        if (!banked) warn(`park at ${homeBank} incomplete (${reason}) @ ${here(sdk)}`);
        await restoreGear();
    }

    try {
        const lvl0 = magicLevel(sdk);
        log(`magic-train start Magic ${lvl0} (${magicXp(sdk)} xp) until ${UNTIL} mode=${MODE}${SPELL_ARG ? ` spell=${SPELL_ARG}` : ''} @ ${here(sdk)}`);
        if (lvl0 >= UNTIL) {
            console.log(`magic-train: already complete — Magic ${magicLevel(sdk)} >= ${UNTIL}`);
            session.stop('done', `Magic ${lvl0} >= ${UNTIL}`, { restartable: false });
            return;
        }
        // A teleport spell picks its own bank; for combat the spot does.
        // Teleport training restocks wherever it stands (the first cast moves it anyway); the
        // session parks at the bank by the landing spot.
        const teleOnly = (SPELL_ARG && TELE_BANK[SPELL_ARG]) || MODE === 'tele';
        if (teleOnly) homeBank = nearestBank(sdk);
        if (!(await ensureBankStart(sdk, bot, homeBank, GRIND_LOG))) warn(`not at ${homeBank} bank @ ${here(sdk)} — routing anyway`);

        // Strip with the bank closed (the bank modal hides the worn tab), then bank it all.
        if (!KEEP_GEAR) {
            await bot.closeInterface().catch(() => undefined);
            const stripped = await stripGear();
            if (stripped.length) log(`banking gear that spoils magic accuracy: ${stripped.join(', ')}`);
        }
        let stock = await restock();
        if (stock === 'needs_stock' && lastShort) {
            // Ask the Jackpoo2 mule (Draynor, the Lumbridge cows' bank) for the shortfall, then
            // try once more: 7 accounts stopped short of air runes only (2026-11-01).
            const lines = [...lastShort.matchAll(/(\w+) rune ×(\d+)/g)].map((m) => ({ label: `${m[1]} rune`, pattern: new RegExp(`^${m[1]} rune$`, 'i'), count: Number(m[2]) }));
            if (lines.length) {
                log(`asking jackthief for ${lines.map((l) => `${l.label}=${l.count}`).join(', ')}`);
                await bot.closeInterface().catch(() => undefined);
                const ok = await requestFromMule({ sdk, bot, session: null, log } as never, lines, { mule: 'jackthief', timeoutMs: 5 * 60_000 });
                log(`mule jackthief: ${ok ? 'served' : 'not all served'}`);
                stock = await restock();
            }
        }
        if (stock === 'needs_stock') {
            await parkAndRestore('needs stock');
            session.stop('needs_stock', 'NEEDS STOCK — mule tops up runes', { restartable: false });
            exitCode = NEEDS_STOCK_EXIT;
            return;
        }
        if (stock === 'bank_failed') {
            session.stopRestartable('bank', `${homeBank} bank did not open @ ${here(sdk)}`);
            return;
        }
        // Auto mode may have picked a teleport: its bank is where the session parks.
        if (spell!.kind === 'tele') homeBank = TELE_BANK[spell!.key] ?? homeBank;
        await nonDefensiveStyle();

        let idle = 0;
        let checkedLevel = magicLevel(sdk);
        while (!session.isStoppedOrRequested()) {
            if (magicLevel(sdk) >= UNTIL) {
                log(rateLine('final'));
                await parkAndRestore('done');
                console.log(`magic-train: already complete — Magic ${magicLevel(sdk)} >= ${UNTIL}`);
            session.stop('done', `Magic ${magicLevel(sdk)} reached (until ${UNTIL})`, { restartable: false });
                break;
            }
            // A level that unlocks a more preferred spell (Wind Bolt -> Blast at 41) is worth one
            // trip to the bank; checked once per level.
            const lvlNow = magicLevel(sdk);
            const preferred = allowedSpells()[0];
            const upgrade =
                lvlNow !== checkedLevel &&
                !!preferred &&
                preferred.key !== spell!.key &&
                castsFrom(preferred, (r) => count(sdk, RUNE_RE[r]) + (lastBank.get(r) ?? 0), hasAirStaff(sdk)) >= Math.min(MIN_BANK_CASTS, castsToGoal(preferred));
            checkedLevel = lvlNow;
            if (packCasts() < MIN_CASTS || upgrade) {
                log(`${upgrade ? `Magic ${lvlNow} unlocks ${allowedSpells()[0]?.key}` : `out of ${spell!.key} runes in the pack`} — restocking | ${rateLine('rate')}`);
                stock = await restock();
                if (stock === 'needs_stock') {
                    await parkAndRestore('needs stock');
                    session.stop('needs_stock', 'NEEDS STOCK — mule tops up runes', { restartable: false });
                    exitCode = NEEDS_STOCK_EXIT;
                    break;
                }
                if (stock === 'bank_failed') {
                    session.stopRestartable('bank', `${homeBank} bank did not open @ ${here(sdk)}`);
                    break;
                }
                continue;
            }
            const p = sdk.getState()?.player;
            if (p && p.maxHp > 0 && p.hp * 4 < p.maxHp) {
                warn(`HP ${p.hp}/${p.maxHp} — resting until 50%`);
                await untilTicks(sdk, (s) => (s.player?.hp ?? 0) * 2 >= (s.player?.maxHp ?? 1), 1000);
            }

            if (spell!.kind === 'tele') {
                await phaseTo('teleport');
                if ((await castTele()) === 'miss' && session.needsRecovery()) await session.recover();
                continue;
            }

            await phaseTo('cast');
            if (Math.hypot((p?.worldX ?? 0) - spot.field.x, (p?.worldZ ?? 0) - spot.field.z) > spot.radius) {
                await phaseTo('walk');
                const ok = await walkNear(bot, sdk, spot.field.x, spot.field.z, 4);
                if (!ok) session.noteFailure('walk', `field ${spot.field.x},${spot.field.z} not reached @ ${here(sdk)}`);
                if (session.needsRecovery()) await session.recover();
                continue;
            }
            const r = await castOnce();
            if (r === 'cast') {
                idle = 0;
                continue;
            }
            if (r === 'none') {
                // Every cow dead (90-tick respawn) or taken: wait in the middle of the field.
                idleTicks += 2;
                if (++idle === 30) warn(`no free cow for ${idle * 2} ticks @ ${here(sdk)} — field shared or wrong spot?`);
                if (idle % 10 === 0) await walkNear(bot, sdk, spot.field.x, spot.field.z, 3);
                await sdk.waitForTicks(2);
                session.noteProgress('location', 'waiting for cows');
                continue;
            }
            if (session.needsRecovery()) await session.recover();
        }

        if (session.stopRequested) {
            log(rateLine('final'));
            const outcome = await session.drainToBank(
                async () => {
                    await parkAndRestore('stop requested');
                    return true;
                },
                { deadlineMs: 300_000 }
            );
            session.stop('stopped', `drained to bank: ${outcome}`, { restartable: false });
        }
    } catch (err) {
        session.stopRestartable('script_error', err instanceof Error ? err.message : String(err));
    } finally {
        await session.finalizeStop();
        if (exitCode === NEEDS_STOCK_EXIT) process.exitCode = NEEDS_STOCK_EXIT;
        else exitCode = Number(process.exitCode ?? 0);
    }
});

process.exit(exitCode);
