/**
 * On a clean finish, point this bot's roster entry at the next `--then`
 * script and restart that launch agent. No-op when `--then` is absent.
 *
 *   args: ["Jackpoo5", "--then", "bots/quests/guam-irit-potions.ts", "--then", "bots/quests/black-unicorns.ts"]
 */
import { spawn } from 'child_process';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { assignRosterScript, scriptError } from '../../tools/fleet-desk/roster-edit';

export function scheduleHandoff(botName: string): boolean {
    const idx = process.argv.indexOf('--then');
    const next = idx >= 0 ? process.argv[idx + 1] : undefined;
    if (!botName || !next) return false;
    const err = scriptError(next, existsSync);
    if (err) {
        console.error(`handoff: ${err}`);
        return false;
    }
    const rest = process.argv.slice(idx + 2);
    const rosterPath = join(process.cwd(), 'bots/roster.json');
    const roster = JSON.parse(readFileSync(rosterPath, 'utf8')) as { bots?: unknown };
    const assigned = assignRosterScript(roster, botName, next, rest.join(' '));
    writeFileSync(rosterPath, `${JSON.stringify(roster, null, 4)}\n`);
    console.log(`handoff ${assigned.name} -> ${next} ${assigned.args.join(' ')}`);

    const code = `
      await Bun.sleep(2500);
      const proc = Bun.spawn(["bun", ".cursor/skills/wake-fleet/scripts/fleet-launchd.ts", "restart", ${JSON.stringify(assigned.name)}], {
        cwd: ${JSON.stringify(process.cwd())},
        stdout: "inherit",
        stderr: "inherit"
      });
      await proc.exited;
    `;
    const child = spawn(process.execPath, ['-e', code], {
        detached: true,
        stdio: 'ignore',
        cwd: process.cwd()
    });
    child.unref();
    return true;
}
