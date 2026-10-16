/**
 * Retaliate-only PK at the rune rocks.
 *
 * `deserves_pk_skull` in server/content/.../pvp/pk_skull.rs2 skulls an attack
 * unless the target is already one of our last three predators (they hit us)
 * or we are still on their prey list. Auto-retaliate swings at the attacker
 * first and does not skull. A manual Attack is safe only while that same
 * target is still our combat target and the hit is fresh.
 *
 * Standing next to someone is not a reason to swing — that skulls.
 */

/** How long after we take a hit we may keep swinging at our current target. */
export const RETALIATE_TICKS = 24;

export type RetaliateTargetType = 'npc' | 'player' | 'none';

export type RetaliateInput = {
    skulled: boolean;
    tick: number;
    /** Tick we last took damage, or -1. */
    lastDamageTick: number;
    targetType: RetaliateTargetType;
    targetIndex: number;
    targetName: string;
    selfName: string;
    fleet: ReadonlySet<string>;
};

/**
 * True only when Attack on this player will not apply a PK skull.
 * Fleet accounts are never a target.
 */
export function mayRetaliate(input: RetaliateInput): boolean {
    if (input.skulled) return false;
    if (input.targetType !== 'player' || input.targetIndex < 0) return false;
    if (input.lastDamageTick < 0) return false;
    if (input.tick - input.lastDamageTick > RETALIATE_TICKS) return false;
    const name = input.targetName.trim().toLowerCase();
    if (!name || name === input.selfName.trim().toLowerCase()) return false;
    if (input.fleet.has(name)) return false;
    return true;
}
