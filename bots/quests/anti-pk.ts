/**
 * Anti-PK fight-back for wilderness-exposed fleet scripts.
 *
 * Proven pieces, all already running in production scripts:
 * - dlong Cleave spec via combat_hacksword:specbar (7587) — hobgoblins.ts,
 *   red-dragons.ts (25% / 250 energy, regen 100 per 50 ticks)
 * - protect_from_melee prayer flick — red-dragons.ts
 * - retaliation via bot.attackPlayer (OPPLAYER2) — sdk/actions.ts
 * - ground loot via scanGroundItems + bot.pickupItem — cow-leather-bank.ts
 *
 * Policy (per operator):
 * - worn-dlong only: never wields, never banks. No dlong equipped = no-op.
 * - prayers: best available per family by level (def + str + atk), plus
 *   protect_from_melee. activatePrayer already gates on level/points, so
 *   low-prayer accounts just get what they qualify for.
 * - retaliation is conservative: only a server-confirmed attacker
 *   (combat targetType=player) or a single nearby suspect after fresh
 *   damage. Never swings at a crowd — avoids skulling on innocents.
 * - loot: after the fight ends, vacuum ground items around the kill spot.
 *
 * Wiring (host script, e.g. law-runes.ts):
 *   import { createAntiPk } from './anti-pk';
 *   const antiPk = createAntiPk({ sdk, bot, log });
 *   // inside main loop, cheap poll every few seconds:
 *   const fb = await antiPk.fightBackIfPked();
 *   if (fb.fought) await antiPk.lootKill();
 */
const DLONG = /^dragon longsword$/i;
/** combat_hacksword:specbar — Cleave, 25% (250/1000). */
const HACKSWORD_SPECBAR = 7587;
const DLONG_SPEC_COST = 250;
/** combat_bow:specbar — Snapshot, 35% (350/1000). */
const BOW_SPECBAR = 7537;
const MSB_SPEC_COST = 350;
const SPEC_MAX = 1000;
const SPEC_REGEN = 100;
const SPEC_REGEN_TICKS = 50;

export interface WeaponProfile {
    pattern: RegExp;
    specbar: number;
    specCost: number;
    specName: string;
}

/** Dragon longsword: Cleave, 25%. Needs 60 Attack + Lost City. */
export const DLONG_PROFILE: WeaponProfile = {
    pattern: DLONG,
    specbar: HACKSWORD_SPECBAR,
    specCost: DLONG_SPEC_COST,
    specName: 'Cleave'
};

/** Magic shortbow: Snapshot, 35%. No quest gate (ranged level only). */
export const MSB_PROFILE: WeaponProfile = {
    pattern: /^magic shortbow/i,
    specbar: BOW_SPECBAR,
    specCost: MSB_SPEC_COST,
    specName: 'Snapshot'
};

const FOOD = /shark|lobster|swordfish|tuna|bass|monkfish|cake|bread|shrimp|anchov|trout|salmon|pike/i;

// One family member can be active at a time — try best first.
const DEF_FAMILY = ['steel_skin', 'rock_skin', 'thick_skin'] as const;
const STR_FAMILY = ['ultimate_strength', 'superhuman_strength', 'burst_of_strength'] as const;
const ATK_FAMILY = ['incredible_reflexes', 'improved_reflexes', 'clarity_of_thought'] as const;

export interface AntiPkDeps {
    sdk: any;
    bot: any;
    log?: (msg: string) => void;
    /** Fight-back weapon. Defaults to the dragon longsword. */
    weapon?: WeaponProfile;
    /**
     * Allow pray+retaliate with no spec weapon worn (spec silently stays off
     * — sa_enabled needs the weapon). Default false: worn-only policy for
     * the dlong crew.
     */
    allowUnarmed?: boolean;
}

/**
 * What a PK kill is worth looting. Default-deny: hobgoblin junk (bones,
 * herbs, limpwurt, feathers) stays on the ground. Takes named valuables
 * (rune/dragon/magic kit, sharks, prayer restores, high runes, clues,
 * splitdrops) plus any coin pile — coins stack and PK coin drops are the
 * prize. Everything else is left to rot.
 */
const PK_LOOT_TAKE =
    /rune|runite|dragon|magic shortbow|magic longbow|yew longbow|shark|prayer potion|restore potion|super |clue scroll|shield left half|half of a key|nature rune|law rune|death rune|blood rune|chaos rune|cosmic rune|adamant|diamond|dragonstone|uncut dragonstone|ring of |amulet of glory|dorgeshuun|granite/i;
const PK_LOOT_SKIP = /^(bones|ashes|big bones|herb|unidentified herb|limpwurt root|snape grass|feather|raw (beef|rat meat|chicken)|cooked (chicken|meat)|burnt .*|spinach roll|jug of (wine|water)|beer|pot|vial|eye of newt|air rune|water rune|earth rune|fire rune|mind rune|body rune|iron arrow|bronze arrow|steel arrow|mithril arrow|bones.*|oyster|seaweed)$/i;

function worthLooting(name: string, count: number): boolean {
    if (!name) return false;
    if (PK_LOOT_SKIP.test(name)) return false;
    if (/^coins$/i.test(name)) return true;
    return PK_LOOT_TAKE.test(name);
}

export interface FightBackResult {
    fought: boolean;
    reason: string;
    attacker?: string;
    specced?: boolean;
    prayers?: string[];
}

export function createAntiPk({ sdk, bot, log, weapon = DLONG_PROFILE, allowUnarmed = false }: AntiPkDeps) {
    const say = (m: string) => log?.(m);
    let specEnergy = SPEC_MAX;
    let specArmed = false;
    let lastSpecRegenTick = -1;
    let killX = 0;
    let killZ = 0;
    let haveKillSpot = false;

    function wearingDlong(): boolean {
        return !!sdk.findEquipmentItem?.(weapon.pattern);
    }

    function tickSpecRegen(): void {
        const tick = sdk.getState?.()?.tick ?? 0;
        if (lastSpecRegenTick < 0) lastSpecRegenTick = tick;
        if (specEnergy >= SPEC_MAX) {
            lastSpecRegenTick = tick;
            return;
        }
        while (tick - lastSpecRegenTick >= SPEC_REGEN_TICKS && specEnergy < SPEC_MAX) {
            specEnergy = Math.min(SPEC_MAX, specEnergy + SPEC_REGEN);
            lastSpecRegenTick += SPEC_REGEN_TICKS;
        }
    }

    async function enableDlongSpec(): Promise<boolean> {
        tickSpecRegen();
        if (!wearingDlong()) return false;
        if (specEnergy < weapon.specCost) return false;
        if (specArmed) return true;
        await sdk.sendSetTab?.(0).catch?.(() => {});
        const r = await sdk.sendClickComponent?.(weapon.specbar);
        if (!r?.success) {
            say(`AntiPK: spec bar click failed: ${r?.message ?? 'no component API'}`);
            return false;
        }
        specArmed = true;
        say(`AntiPK: ${weapon.specName} armed ${Math.floor(specEnergy / 10)}%`);
        return true;
    }

    function noteSpecUsed(): void {
        if (!specArmed) return;
        specArmed = false;
        specEnergy = Math.max(0, specEnergy - weapon.specCost);
    }

    function noteSpecRejected(): void {
        const noPower = sdk.getNewChat?.({ types: [0] })?.some?.((m: any) => /enough power/i.test(m.text ?? ''));
        if (!noPower) return;
        specArmed = false;
        specEnergy = Math.min(specEnergy, weapon.specCost - 1);
        say(`AntiPK: spec rejected (no power) — tracked ${specEnergy}`);
    }

    /** Best-effort prayer stack; keeps whatever the level/points allow. */
    async function prayBestStack(): Promise<string[]> {
        const on: string[] = [];
        for (const family of [DEF_FAMILY, STR_FAMILY, ATK_FAMILY]) {
            for (const prayer of family) {
                const r = await bot.activatePrayer?.(prayer).catch?.(() => null);
                if (r?.success && r?.reason !== 'already_active') {
                    on.push(prayer);
                    break;
                }
                if (r?.reason === 'already_active') {
                    on.push(prayer);
                    break;
                }
                // level_too_low / no_prayer_points: fall through to weaker kin.
            }
        }
        const prot = await bot.activatePrayer?.('protect_from_melee').catch?.(() => null);
        if (prot?.success) on.push('protect_from_melee');
        return on;
    }

    async function eatOnce(): Promise<void> {
        const p = sdk.getState?.()?.player;
        const hp = p?.hp ?? 10;
        const maxHp = p?.maxHp ?? 10;
        if (hp > Math.floor(maxHp * 0.6)) return;
        const food = sdk.findInventoryItem?.(FOOD);
        if (!food) return;
        const r = await bot.eatFood?.(food).catch?.(() => null);
        if (r?.success) say(`AntiPK: ate ${food.name} ${hp}->${sdk.getState?.()?.player?.hp}`);
    }

    /** Resolve who is hitting us, conservatively. */
    function resolveAttacker(): any | null {
        const s = sdk.getState?.();
        const combat = s?.player?.combat;
        if (!combat) return null;
        const players: any[] = s?.nearbyPlayers ?? [];
        if (combat.inCombat && combat.targetType === 'player' && combat.targetIndex >= 0) {
            return players.find((p) => p.index === combat.targetIndex) ?? null;
        }
        // Taking damage but not yet retaliating: only trust a lone suspect.
        const tick = s?.tick ?? 0;
        const fresh = typeof combat.lastDamageTick === 'number' && tick - combat.lastDamageTick <= 4;
        if (fresh && players.length === 1 && (players[0].distance ?? 99) <= 4) return players[0];
        return null;
    }

    async function fightBackIfPked(): Promise<FightBackResult> {
        if (!allowUnarmed && !wearingDlong()) return { fought: false, reason: 'no_weapon_worn' };
        const attacker = resolveAttacker();
        if (!attacker) return { fought: false, reason: 'no_attacker' };
        const prayers = await prayBestStack();
        const specced = await enableDlongSpec();
        const p = sdk.getState?.()?.player;
        killX = p?.worldX ?? 0;
        killZ = p?.worldZ ?? 0;
        haveKillSpot = true;
        say(`AntiPK: fighting back vs ${attacker.name} (prayers: ${prayers.join(',') || 'none'} spec:${specced ? 'armed' : 'off'})`);
        const r = await bot.attackPlayer?.(attacker, 8_000).catch?.((e: any) => ({ success: false, message: String(e) }));
        noteSpecRejected();
        if (specced && specArmed) noteSpecUsed();
        await eatOnce();
        if (!r?.success) return { fought: true, reason: `retaliate_failed: ${r?.message}`, attacker: attacker.name, specced, prayers };
        return { fought: true, reason: `retaliating: ${r.message}`, attacker: attacker.name, specced, prayers };
    }

    /** Vacuum the kill spot after the fight. Valuables only — see worthLooting. */
    async function lootKill(maxPickups = 8, radius = 4): Promise<{ picked: number; names: string[] }> {
        const names: string[] = [];
        let scanned: any[] = [];
        try {
            scanned = (await sdk.scanGroundItems?.(radius)) ?? [];
        } catch {
            scanned = sdk.getGroundItems?.() ?? [];
        }
        const near = scanned
            .filter((g: any) => {
                if (!haveKillSpot) return (g.distance ?? 99) <= radius;
                const gx = g.x ?? g.worldX ?? 0;
                const gz = g.z ?? g.worldZ ?? 0;
                return Math.hypot(gx - killX, gz - killZ) <= radius + 1;
            })
            .filter((g: any) => worthLooting(g.name ?? '', g.count ?? 1))
            .slice(0, maxPickups);
        for (const g of near) {
            const r = await bot.pickupItem?.(g).catch?.(() => null);
            if (r?.success) names.push(g.name ?? 'item');
        }
        if (names.length) say(`AntiPK: looted ${names.join(', ')}`);
        haveKillSpot = false;
        return { picked: names.length, names };
    }

    function inPkFight(): boolean {
        const c = sdk.getState?.()?.player?.combat;
        return c?.inCombat === true && c?.targetType === 'player';
    }

    /**
     * PK pressure, confirmed OR suspected. Confirmed = our combat target is a
     * player. Suspected = fresh damage with a player standing next to us
     * while our target is something else (auto-retaliate vs the local NPCs).
     * Hosts pass whether they are in the wild (ditch-gated, like seePker).
     */
    function underAttack(inWildy: boolean): boolean {
        if (!inWildy) return false;
        const s = sdk.getState?.();
        const combat = s?.player?.combat;
        if (!combat) return false;
        if (combat.inCombat === true && combat.targetType === 'player') return true;
        const tick = s?.tick ?? 0;
        const lastDmg = combat.lastDamageTick ?? -1;
        if (lastDmg < 0 || tick - lastDmg > 4) return false;
        return (s?.nearbyPlayers ?? []).some((p: any) => (p.distance ?? 99) <= 4);
    }

    function resetSpec(): void {
        specEnergy = SPEC_MAX;
        specArmed = false;
        lastSpecRegenTick = -1;
    }

    return { fightBackIfPked, lootKill, inPkFight, underAttack, wearingDlong, resetSpec };
}
