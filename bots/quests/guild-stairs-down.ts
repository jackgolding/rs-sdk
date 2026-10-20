/**
 * One-shot: climb down the Champions' Guild staircase (or any nearby
 * staircase) to plane 0 so trek scripts can take over.
 *
 *   bun bots/quests/guild-stairs-down.ts jackthief
 *
 * Idempotent: logs DONE and returns at once when already on plane 0
 * (restarts re-check and no-op). Switch the crew forward promptly anyway.
 */
import { appendFileSync } from 'fs';
import { join } from 'path';
import { runScript } from '../../sdk/runner';

const botName = process.argv.slice(2).find((a) => !a.startsWith('-')) ?? '';
const GRIND_LOG = join(process.cwd(), 'bots', botName, 'grind.log');

await runScript(async ({ bot, sdk }) => {
    const log = (msg: string) => {
        const line = `${new Date().toISOString()} ${msg}`;
        console.log(msg);
        try {
            appendFileSync(GRIND_LOG, line + '\n');
        } catch {
            /* ignore */
        }
    };

    const pos = () => {
        const p = sdk.getState()?.player;
        return { x: p?.worldX ?? 0, z: p?.worldZ ?? 0, level: p?.level ?? 0 };
    };

    const p0 = pos();
    log(`stairs-down start @ ${p0.x},${p0.z} plane ${p0.level}`);
    if (p0.level === 0) {
        log('STAIRS-DOWN done: already plane 0');
        return;
    }

    await sdk.scanNearbyLocs(12).catch(() => undefined);
    const stairs = (sdk.getNearbyLocs() ?? [])
        .filter(
            (l) =>
                /stair/i.test(l.name) &&
                (l.optionsWithIndex ?? []).some((o) => /climb-?down/i.test(o.text))
        )
        .sort((a, b) => (a.distance ?? 99) - (b.distance ?? 99))[0];
    if (!stairs) {
        log(`STAIRS-DOWN stuck: no climb-down staircase near ${p0.x},${p0.z}`);
        return;
    }
    const walk = await bot.walkTo(stairs.x, stairs.z, 2);
    if (!walk.success) log(`walk at stairs: ${walk.message}`);
    const r = await bot.interactLoc(stairs, /climb-?down/i).catch((e) => ({ success: false, message: String(e) }));
    log(`climb-down ${stairs.x},${stairs.z}: ${r && 'success' in r && r.success ? 'ok' : (r as { message?: string })?.message ?? 'sent'}`);
    await sdk
        .waitForCondition(() => pos().level === 0, 10_000)
        .catch(() => undefined);
    const p1 = pos();
    log(`STAIRS-DOWN ${p1.level === 0 ? 'done' : 'stuck'} @ ${p1.x},${p1.z} plane ${p1.level}`);
});
