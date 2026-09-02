/**
 * Doric's Quest: bank everything, mine ores, hand in at Doric.
 *
 *   bun bots/Jackpoo2/dorics.ts
 */
if (!process.argv.includes('Jackpoo2')) process.argv.push('Jackpoo2');
await import('../quests/dorics-quest.ts');
