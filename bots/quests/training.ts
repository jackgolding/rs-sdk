/**
 * Skill training registry: which grind job trains which skill, from which
 * level. The fleet levels accounts by scheduling trainer jobs (roster),
 * not by a runtime trainer — planTraining turns "need WC40" into an ordered
 * job list for assignment. Quest scripts fail fast via quest-lib
 * requireSkills; this file answers "how do we get there".
 *
 * Coverage gaps (no trainer yet): Prayer. Everything else 1+ trains to 99.
 */
export interface Trainer {
    /** Roster script. */
    script: string;
    /** Usable from this base level (quest/gear gates in notes). */
    minLevel: number;
    /** Trains well up to about this level (0 = uncapped). */
    maxLevel: number;
    notes: string;
}

export const TRAINERS: Record<string, Trainer[]> = {
    Attack: [
        { script: 'bots/quests/edgeville-dungeon-melee.ts', minLevel: 1, maxLevel: 0, notes: 'melee + HP/Str/Def via style' },
        { script: 'bots/quests/hobgoblins.ts', minLevel: 1, maxLevel: 60, notes: 'low-level melee option' },
    ],
    Strength: [
        { script: 'bots/quests/edgeville-dungeon-melee.ts', minLevel: 1, maxLevel: 0, notes: 'via aggressive style' },
    ],
    Defence: [
        { script: 'bots/quests/edgeville-dungeon-melee.ts', minLevel: 1, maxLevel: 0, notes: 'via defensive style' },
    ],
    Hitpoints: [
        { script: 'bots/quests/edgeville-dungeon-melee.ts', minLevel: 1, maxLevel: 0, notes: 'passive on any combat' },
        { script: 'bots/quests/green-dragons.ts', minLevel: 60, maxLevel: 0, notes: 'high-level combat + profit' },
    ],
    Ranged: [
        { script: 'bots/quests/edgeville-range-druids.ts', minLevel: 1, maxLevel: 70, notes: 'safe-spot druids' },
        { script: 'bots/quests/kbd-range.ts', minLevel: 70, maxLevel: 0, notes: 'needs KBD gear + prayer' },
        { script: 'bots/quests/green-dragons.ts', minLevel: 70, maxLevel: 0, notes: 'ranged/melee dragons' },
    ],
    Magic: [{ script: 'bots/quests/high-alch.ts', minLevel: 55, maxLevel: 0, notes: 'needs alchable stack + runes' }],
    Cooking: [
        { script: 'bots/quests/fishing-route.ts', minLevel: 1, maxLevel: 0, notes: 'cook-what-you-catch loop' },
        { script: 'bots/quests/catherby-cook-bank.ts', minLevel: 1, maxLevel: 0, notes: 'banked raw stock' },
    ],
    Woodcutting: [
        { script: 'bots/quests/seers-wc-fm.ts', minLevel: 1, maxLevel: 75, notes: 'willows + firemaking side' },
        { script: 'bots/quests/magic-trees.ts', minLevel: 75, maxLevel: 0, notes: 'magic trees' },
    ],
    Fletching: [
        { script: 'bots/quests/bowstrings.ts', minLevel: 10, maxLevel: 0, notes: 'needs flax stock' },
        { script: 'bots/quests/bank-fletch.ts', minLevel: 1, maxLevel: 0, notes: 'banked logs' },
    ],
    Fishing: [{ script: 'bots/quests/fishing-route.ts', minLevel: 1, maxLevel: 0, notes: 'nets to harpoons by level' }],
    Firemaking: [{ script: 'bots/quests/seers-wc-fm.ts', minLevel: 1, maxLevel: 0, notes: 'burn-what-you-chop loop' }],
    Crafting: [{ script: 'bots/quests/doric-iron-knives.ts', minLevel: 1, maxLevel: 0, notes: 'check job for craft coverage' }],
    Smithing: [{ script: 'bots/quests/doric-iron-knives.ts', minLevel: 1, maxLevel: 0, notes: 'iron knives grind' }],
    Mining: [
        { script: 'bots/quests/mining-guild.ts', minLevel: 60, maxLevel: 0, notes: 'guild coal/iron' },
        { script: 'bots/quests/rimmington-iron.ts', minLevel: 15, maxLevel: 60, notes: 'iron power-mining' },
    ],
    Herblore: [{ script: 'bots/quests/herblore.ts', minLevel: 1, maxLevel: 0, notes: 'needs herb/secondaries stock' }],
    Agility: [
        { script: 'bots/quests/gnome-course.ts', minLevel: 1, maxLevel: 35, notes: 'fail-safe starter course' },
        { script: 'bots/quests/agility-route.ts', minLevel: 35, maxLevel: 0, notes: 'wilderness course, sendWalk hops' },
    ],
    Thieving: [{ script: 'bots/quests/thieving-route.ts', minLevel: 1, maxLevel: 0, notes: 'stalls to knights by level' }],
    Runecraft: [{ script: 'bots/quests/essence.ts', minLevel: 1, maxLevel: 0, notes: 'essence running; law altar via law-runes.ts at 54' }],
};

export interface PlanStep {
    skill: string;
    from: number;
    to: number;
    script: string;
    notes: string;
}

/**
 * Ordered trainer jobs to lift `levels` to `goals`. One step per skill
 * (lowest level first — quest gates usually bind on the weakest skill).
 * Empty = already qualified. Skills with no trainer are listed with an
 * empty script so assignment never silently skips them.
 */
export function planTraining(
    levels: Record<string, number>,
    goals: Record<string, number>
): PlanStep[] {
    const steps: PlanStep[] = [];
    const lookup = (map: Record<string, number>, name: string): number | undefined => {
        if (Object.prototype.hasOwnProperty.call(map, name)) return map[name];
        const want = name.toLowerCase();
        for (const [key, value] of Object.entries(map)) {
            if (key.toLowerCase() === want) return value;
        }
        return undefined;
    };
    const needed = Object.entries(goals)
        .map(([skill, to]) => ({ skill, from: lookup(levels, skill) ?? 1, to }))
        .filter((g) => g.from < g.to)
        .sort((a, b) => a.from - b.from);
    for (const { skill, from, to } of needed) {
        const options = (TRAINERS[skill] ?? []).filter((t) => from >= t.minLevel);
        const pick = options.find((t) => t.maxLevel === 0 || to <= t.maxLevel) ?? options[0];
        steps.push({
            skill,
            from,
            to,
            script: pick?.script ?? '',
            notes: pick ? pick.notes : 'NO TRAINER — no grind covers this skill yet',
        });
    }
    return steps;
}
