import { describe, expect, test } from 'bun:test';
import { commandFromProgramArgs, parseLaunchctlPrint } from '../../.cursor/skills/wake-fleet/scripts/launchd-info';

/** Captured shape of `launchctl print gui/$UID/com.rs-sdk.bot.jackpoo1` (2026-10-04). */
const PRINT = `
gui/501/com.rs-sdk.bot.jackpoo1 = {
	active count = 1
	path = /Users/jackgolding/Library/LaunchAgents/com.rs-sdk.bot.jackpoo1.plist
	type = LaunchAgent
	state = running

	program = /usr/local/bin/bun
	arguments = {
		/usr/local/bin/bun
		bots/quests/magic-trees.ts
		Jackpoo1
	}

	runs = 4
	pid = 36569
	last exit code = 70
}
`;

describe('launchd print parser', () => {
    test('parses pid, runs, last exit, state, and program arguments', () => {
        expect(parseLaunchctlPrint(PRINT, true)).toEqual({
            loaded: true,
            pid: 36569,
            runs: 4,
            lastExit: '70',
            state: 'running',
            programArgs: ['/usr/local/bin/bun', 'bots/quests/magic-trees.ts', 'Jackpoo1'],
        });
    });

    test('unloaded agents are not live', () => {
        expect(parseLaunchctlPrint('Bad request.\nCould not find service "com.rs-sdk.bot.missing" in domain', false)).toEqual({
            loaded: false,
        });
    });

    test('commandFromProgramArgs drops the bun executable', () => {
        expect(commandFromProgramArgs(['/usr/local/bin/bun', 'bots/quests/magic-trees.ts', 'Jackpoo1'])).toBe(
            'bun bots/quests/magic-trees.ts Jackpoo1'
        );
    });
});
