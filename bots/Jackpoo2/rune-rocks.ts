/**
 * Wilderness rune rocks — suicide trips of 2, bank at Edgeville.
 * While rune rocks are down, mines hobgoblin adamant. No essence fallback.
 *
 *   bun bots/Jackpoo2/rune-rocks.ts
 */
if (!process.argv.includes('Jackpoo2')) process.argv.push('Jackpoo2');
await import('../quests/rune-rocks.ts');
