/**
 * Mine rune essence via Aubury teleport, then bank at Varrock east.
 *
 *   bun bots/Jackpoo2/essence.ts
 */
if (!process.argv.includes('Jackpoo2')) process.argv.push('Jackpoo2');
await import('../quests/essence.ts');
