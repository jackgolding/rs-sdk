/**
 * Lost City — Jackthief.
 *
 *   bun bots/jackthief/lost-city.ts
 */
if (!process.argv.includes('jackthief')) process.argv.push('jackthief');
await import('../quests/lost-city.ts');
