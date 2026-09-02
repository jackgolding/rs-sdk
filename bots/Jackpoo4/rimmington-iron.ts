/**
 * Rimmington iron → Falador east bank.
 *
 *   bun bots/Jackpoo4/rimmington-iron.ts
 */
if (!process.argv.includes('Jackpoo4')) process.argv.push('Jackpoo4');
await import('../quests/rimmington-iron.ts');
