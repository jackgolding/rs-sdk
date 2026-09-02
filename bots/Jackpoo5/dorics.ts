/**
 * Doric's Quest: bank everything, mine ores, hand in at Doric.
 *
 *   bun bots/Jackpoo5/dorics.ts
 */
if (!process.argv.includes('Jackpoo5')) process.argv.push('Jackpoo5');
await import('../quests/dorics-quest.ts');
