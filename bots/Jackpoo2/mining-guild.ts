/**
 * Falador Mining Guild — south coal only.
 *
 *   bun bots/Jackpoo2/mining-guild.ts
 */
if (!process.argv.includes('Jackpoo2')) process.argv.push('Jackpoo2');
if (!process.argv.includes('--coal-only')) process.argv.push('--coal-only');
await import('../quests/mining-guild.ts');
