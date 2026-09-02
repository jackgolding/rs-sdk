/**
 * Falador Mining Guild — south coal only.
 *
 *   bun bots/Jackpoo4/mining-guild.ts
 */
if (!process.argv.includes('Jackpoo4')) process.argv.push('Jackpoo4');
if (!process.argv.includes('--coal-only')) process.argv.push('--coal-only');
await import('../quests/mining-guild.ts');
