/**
 * Falador Mining Guild — south coal only.
 *
 *   bun bots/Jackpoo5/mining-guild.ts
 */
if (!process.argv.includes('Jackpoo5')) process.argv.push('Jackpoo5');
if (!process.argv.includes('--coal-only')) process.argv.push('--coal-only');
await import('../quests/mining-guild.ts');
