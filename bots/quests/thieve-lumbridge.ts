/**
 * Thieving from level 1 on the men and women around Lumbridge castle — the
 * safe, nearby grind for a fresh low-combat account (jackquests) between quests.
 *
 *   bun bots/quests/thieve-lumbridge.ts {botname} [--until=99]
 *
 * learnings/thieving.md: Lumbridge men take Thieving 1 → 43 in ~10 minutes.
 * A failed pickpocket stuns and hits for 1, so at low HP the bot steps back to
 * the castle courtyard and waits to regenerate before carrying on — there is
 * no food on a fresh account. Coins stay in the pack (one stack: kept on death).
 *
 * Runs as todo-runner's `--then` grind: SIGTERM (a quest was queued) stops it
 * between attempts. Reaching --until idles instead of exiting, so a container
 * restart does not re-run a finished grind. Log: bots/<bot>/grind.log.
 */
import { join } from 'path';
import { ActivitySession } from '../../sdk/index';
import { installGracefulShutdown, runScript } from '../../sdk/runner';

const argv = process.argv.slice(2);
const BOT = argv.find((a) => !a.startsWith('-')) ?? process.env.BOT_USERNAME ?? '';
const UNTIL = Number(argv.find((a) => a.startsWith('--until='))?.split('=')[1] ?? 99);
const GRIND_LOG = join(process.cwd(), 'bots', BOT, 'grind.log');

/** Courtyard east of the castle: the men and women wander here (learnings/thieving.md). */
const COURTYARD = { x: 3222, z: 3218 };
/** Stop and regenerate at or below this HP: a stun hits for 1, a run of stuns adds up. */
const REST_AT_HP = 4;
/** Resume once HP is back to at least this (or full, if max HP is lower). */
const RESUME_AT_HP = 8;

let shutdownRequested = false;
for (const sig of ['SIGTERM', 'SIGINT', 'SIGHUP'] as const) process.once(sig, () => (shutdownRequested = true));
let exitCode = 0;

await runScript(async ({ bot, sdk }) => {
    const session = new ActivitySession(sdk, bot, {
        name: 'thieve-lumbridge',
        grindLogPath: GRIND_LOG,
        stallMs: 150_000,
        maxRecoveryTactics: 8,
    });
    installGracefulShutdown({ graceMs: 30_000 });
    const log = (msg: string) => session.log('log', msg);
    const thieving = () => sdk.getSkill('thieving')?.baseLevel ?? 1;
    const hp = () => sdk.getSkill('hitpoints')?.level ?? 10;
    const maxHp = () => sdk.getSkill('hitpoints')?.baseLevel ?? 10;
    const pos = () => ({ x: sdk.getState()?.player?.worldX ?? 0, z: sdk.getState()?.player?.worldZ ?? 0 });
    const away = () => Math.hypot(pos().x - COURTYARD.x, pos().z - COURTYARD.z);
    const stopping = () => shutdownRequested || session.stopRequested || session.isStopped();

    let picks = 0;
    let stuns = 0;
    try {
        await bot.skipTutorial();
        log(`start | Thieving ${thieving()} (until ${UNTIL}) HP ${hp()}/${maxHp()} @ ${pos().x},${pos().z}`);
        if ((sdk.getState()?.player?.level ?? 0) > 0) log(`WARN on plane ${sdk.getState()?.player?.level} — walking may need stairs`);

        while (!stopping() && thieving() < UNTIL) {
            if (hp() <= REST_AT_HP) {
                await session.setPhase('rest');
                log(`resting at HP ${hp()}/${maxHp()}`);
                await bot.walkTo(COURTYARD.x, COURTYARD.z, 3).catch(() => undefined);
                const target = Math.min(RESUME_AT_HP, maxHp());
                while (!stopping() && hp() < target) await sdk.waitForTicks(10);
                continue;
            }
            if (away() > 15) {
                await session.setPhase('walk');
                const walked = await bot.walkTo(COURTYARD.x, COURTYARD.z, 4);
                if (!walked.success) log(`walk to the courtyard: ${walked.message}`);
                session.noteProgress('location', 'lumbridge courtyard');
                continue;
            }
            if (session.metrics().phase !== 'thieve') await session.setPhase('thieve');
            const mark = sdk.findNearbyNpc(/^(man|woman)$/i, { reachable: true });
            if (!mark) {
                await sdk.waitForTicks(3);
                continue;
            }
            const before = thieving();
            const r = await bot.pickpocketNpc(mark);
            if (r.success) {
                picks++;
                session.noteProgress('xp', 'pickpocket');
            } else if (r.reason === 'stunned') {
                stuns++;
            }
            if (thieving() > before) log(`Thieving ${thieving()} after ${picks} picks (${stuns} stuns), HP ${hp()}/${maxHp()}`);
        }

        if (!stopping() && thieving() >= UNTIL) {
            await session.setPhase('idle');
            log(`stopped done | Thieving ${thieving()} after ${picks} picks — idling`);
            session.stop('done', `Thieving ${thieving()} >= ${UNTIL}`);
            await session.finalizeStop();
            while (!shutdownRequested && sdk.isConnected()) await sdk.waitForTicks(10).catch(() => undefined);
            return;
        }
        log(`stopped stop_requested | Thieving ${thieving()} after ${picks} picks (${stuns} stuns)`);
    } catch (err) {
        exitCode = 1;
        session.stopRestartable('script_error', err instanceof Error ? err.message : String(err));
    } finally {
        await session.finalizeStop();
    }
});

process.exit(exitCode || process.exitCode || 0);
