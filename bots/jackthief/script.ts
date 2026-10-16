/**
 * JackThief Final 99 Mining & Full Max Celebration Script.
 *
 * Runs the grand finale celebration:
 * - Equips Rune pickaxe
 * - Fleet banks all items and gathers in formation around the mine
 * - Power-mines iron to 99
 * - Fleet triggers simultaneous "grats on max JackThief" chat for the screenshot
 *
 * Usage:
 *   bun bots/jackthief/script.ts
 */
process.argv[2] = 'jackthief';
await import('../quests/max-mining-celebration.ts');
