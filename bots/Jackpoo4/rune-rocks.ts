/**
 * Wilderness rune rocks — suicide trips of 2, bank at Edgeville.
 * While rune rocks are down, mines hobgoblin adamant. No essence fallback.
 *
 *   bun bots/Jackpoo4/rune-rocks.ts
 */
if (!process.argv.includes('Jackpoo4')) process.argv.push('Jackpoo4');
await import('../quests/rune-rocks.ts');
