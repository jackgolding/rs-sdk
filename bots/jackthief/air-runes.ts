/**
 * Air-rune crafter: stay inside the air altar at the shrine.
 * Jacklove1–5 enter, trade essence, and leave. This bot only trades and crafts.
 *
 *   bun bots/Jackthief/air-runes.ts
 */
import { appendFileSync } from 'fs';
import { dirname, join } from 'path';
import { runScript } from '../../sdk/runner';
import {
    AIR_ALTAR,
    ESSENCE,
    LOAD,
    RUNNERS,
    TALISMAN,
    closeUi,
    count,
    dumpAtNearestBank,
    emptySlots,
    enterAltar,
    goFaladorEast,
    inAirAltar,
    leaveMine,
    openFaladorBank,
    pos,
    walkNear
} from '../quests/air-runes-shared';

const GRIND_LOG = join(dirname(import.meta.path), 'grind.log');

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

    async function ensureTalisman(): Promise<void> {
        if (count(sdk, TALISMAN) >= 1) return;
        log('Withdrawing air talisman at Falador east');
        await goFaladorEast(bot, sdk, log);
        await openFaladorBank(bot, sdk);
        const t = await bot.withdrawItem(TALISMAN, 1);
        await bot.closeBank();
        if (!t.success || count(sdk, TALISMAN) < 1) {
            throw new Error(`No air talisman at Falador east: ${t.message}`);
        }
    }

    async function stayAtAltar(): Promise<boolean> {
        await closeUi(bot, sdk);
        if (!inAirAltar(pos(sdk).x, pos(sdk).z) && !(await enterAltar(bot, sdk, log))) {
            return false;
        }
        return walkNear(bot, sdk, AIR_ALTAR.x, AIR_ALTAR.z, 3);
    }

    async function craft(): Promise<void> {
        if (!(await stayAtAltar())) return;
        const before = count(sdk, ESSENCE);
        if (before < 1) return;
        const xpBefore = sdk.getSkill('Runecraft')?.experience ?? 0;
        await sdk.scanNearbyLocs(10).catch(() => {});
        const crafted = await bot.interactLoc(/^altar$/i, /craft-rune/i);
        await sdk
            .waitForCondition(
                (s) =>
                    count(sdk, ESSENCE) < before ||
                    (s.skills.find((sk) => /runecraft/i.test(sk.name))?.experience ?? 0) > xpBefore,
                8_000
            )
            .catch(() => {});
        log(`Craft: ${crafted.success ? 'ok' : crafted.message} ess ${before} -> ${count(sdk, ESSENCE)} air=${count(sdk, /^air rune$/i)}`);
        await closeUi(bot, sdk);
    }

    async function takeEssence(): Promise<void> {
        if (!(await stayAtAltar())) {
            log(`Not at altar @ ${pos(sdk).x},${pos(sdk).z}`);
            return;
        }
        log(`Waiting for runners ess=${count(sdk, ESSENCE)} empty=${emptySlots(sdk)}`);
        const served = await bot.serveTrades({
            from: RUNNERS,
            give: [],
            want: [{ item: ESSENCE, amount: 1 }],
            maxTrades: 1,
            timeout: 120_000,
            tradeTimeout: 60_000,
            until: () => count(sdk, ESSENCE) >= LOAD || emptySlots(sdk) === 0
        });
        const last = served.trades.at(-1);
        log(
            `Serve: ${served.reason} ${last ? (last.success ? 'ok' : last.message) : served.message} ess=${count(sdk, ESSENCE)}`
        );
    }

    log(`Air-rune crafter start @ ${pos(sdk).x},${pos(sdk).z} ess=${count(sdk, ESSENCE)} talisman=${count(sdk, TALISMAN)}`);

    if (!inAirAltar(pos(sdk).x, pos(sdk).z)) {
        await leaveMine(bot, sdk, log);
        await dumpAtNearestBank(bot, sdk, log);
        await ensureTalisman();
        if (!(await enterAltar(bot, sdk, log))) {
            throw new Error(`Could not enter air altar @ ${pos(sdk).x},${pos(sdk).z}`);
        }
    }
    await stayAtAltar();

    for (;;) {
        await closeUi(bot, sdk);
        if (!inAirAltar(pos(sdk).x, pos(sdk).z)) {
            await leaveMine(bot, sdk, log);
            await ensureTalisman();
            await enterAltar(bot, sdk, log);
        }

        if (count(sdk, ESSENCE) >= LOAD || (count(sdk, ESSENCE) > 0 && emptySlots(sdk) === 0)) {
            await craft();
            continue;
        }

        await takeEssence();
        if (count(sdk, ESSENCE) >= LOAD || (count(sdk, ESSENCE) > 0 && emptySlots(sdk) === 0)) {
            await craft();
        }
    }
});
