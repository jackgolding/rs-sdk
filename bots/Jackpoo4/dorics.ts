/**
 * Doric's Quest: bank everything, mine ores, hand in at Doric.
 *
 *   bun bots/Jackpoo4/dorics.ts
 */
if (!process.argv.includes('Jackpoo4')) process.argv.push('Jackpoo4');
await import('../quests/dorics-quest.ts');
