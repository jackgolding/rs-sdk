/**
 * Mine rune essence via Aubury teleport, then bank at Varrock east.
 *
 *   bun bots/Jackpoo4/essence.ts
 */
if (!process.argv.includes('Jackpoo4')) process.argv.push('Jackpoo4');
await import('../quests/essence.ts');
