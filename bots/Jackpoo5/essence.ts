/**
 * Mine rune essence via Aubury teleport, then bank at Varrock east.
 *
 *   bun bots/Jackpoo5/essence.ts
 */
if (!process.argv.includes('Jackpoo5')) process.argv.push('Jackpoo5');
await import('../quests/essence.ts');
