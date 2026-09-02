/**
 * Air-rune runner for jacklove1–5.
 * Falador east → ruins → enter altar → trade Jackthief → portal out → repeat.
 *
 *   bun bots/quests/air-rune-runner.ts jacklove1
 */
import { appendFileSync } from 'fs';
import { join } from 'path';
import { runScript } from '../../sdk/runner';
import {
    AIR_ALTAR,
    ESSENCE,
    JACKTHIEF,
    LOAD,
    TALISMAN,
    closeUi,
    count,
    depositAll,
    dumpAtNearestBank,
    enterAltar,
    goFaladorEast,
    inAirAltar,
    leaveAltar,
    leaveMine,
    openFaladorBank,
    pos,
    walkNear
} from './air-runes-shared';

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

    async function restock(): Promise<void> {
        await closeUi(bot, sdk);
        await leaveAltar(bot, sdk, log);
        await goFaladorEast(bot, sdk, log);
        await openFaladorBank(bot, sdk);
        await depositAll(bot, sdk, TALISMAN);
        if (count(sdk, TALISMAN) < 1) {
            const t = await bot.withdrawItem(TALISMAN, 1);
            if (!t.success) throw new Error(`No air talisman at Falador east: ${t.message}`);
        }
        const need = LOAD - count(sdk, ESSENCE);
        if (need > 0) {
            const w = await bot.withdrawItem(ESSENCE, need);
            if (!w.success && count(sdk, ESSENCE) === 0) {
                throw new Error(`No rune essence at Falador east: ${w.message}`);
            }
        }
        await bot.closeBank();
        log(`Restocked @ Falador east talisman=${count(sdk, TALISMAN)} essence=${count(sdk, ESSENCE)}`);
    }

    log(`Air-rune runner start @ ${pos(sdk).x},${pos(sdk).z} ess=${count(sdk, ESSENCE)} talisman=${count(sdk, TALISMAN)}`);
    if (!inAirAltar(pos(sdk).x, pos(sdk).z) || count(sdk, ESSENCE) < 1) {
        await dumpAtNearestBank(bot, sdk, log);
        await restock();
    }

    for (;;) {
        await closeUi(bot, sdk);
        await leaveMine(bot, sdk, log);

        if (count(sdk, TALISMAN) < 1 || count(sdk, ESSENCE) < LOAD) {
            if (inAirAltar(pos(sdk).x, pos(sdk).z) && count(sdk, ESSENCE) > 0) {
                /* still have a load to hand in — don't bank yet */
            } else {
                await restock();
            }
        }
        if (count(sdk, ESSENCE) < 1) {
            log('No essence — waiting');
            await sdk.waitForTicks(5);
            continue;
        }

        if (!inAirAltar(pos(sdk).x, pos(sdk).z)) {
            log(`Running to altar ess=${count(sdk, ESSENCE)}`);
            if (!(await enterAltar(bot, sdk, log))) {
                await sdk.waitForTicks(3);
                continue;
            }
        }

        await walkNear(bot, sdk, AIR_ALTAR.x, AIR_ALTAR.z, 4);

        const before = count(sdk, ESSENCE);
        const trade = await bot.trade(JACKTHIEF, {
            give: [{ item: ESSENCE, amount: -1 }],
            retryOnBusy: true,
            requestTimeout: 90_000,
            timeout: 60_000
        });
        log(
            `Trade Jackthief: ${trade.success ? 'ok' : trade.message} gave ${before - count(sdk, ESSENCE)} ess @ ${pos(sdk).x},${pos(sdk).z}`
        );
        if (!trade.success) {
            await sdk.waitForTicks(3);
            continue;
        }

        await leaveAltar(bot, sdk, log);
    }
});
