/**
 * One timed loot→fish swap with ABGARMY01 while it is serving.
 * Stop the thief's launchd job first so only one controller owns them.
 *
 *   bun .cursor/skills/wake-fleet/scripts/fleet-launchd.ts stop ABGARMY19
 *   bun bots/quests/mule-swap-bench.ts ABGARMY19
 */
import { join } from 'path';
import { runScript } from '../../sdk/runner';
import { appendGrindLog } from '../../sdk/grind-log';
import { closeUi, walkNear } from './movement';
import { ARDOUGNE_BANK } from './tiles';
import { FOOD_MULE, usesFoodMule } from './tree-trade-plan';

const MULE_FOOD = /^(tuna|swordfish|lobster|shark|cod|bass|jug of wine)$/i;
const SLASH =
    /^(bronze |iron |steel |mithril |adamant |rune )?(axe|sword|scimitar|dagger|claws|battleaxe|longsword|2h sword)$|^knife$/i;

const botName = process.argv[2]?.toUpperCase();
if (!botName || !usesFoodMule(botName)) {
    throw new Error('Usage: bun bots/quests/mule-swap-bench.ts ABGARMY{02-20}');
}

const GRIND_LOG = join(process.cwd(), 'bots', botName, 'grind.log');

function isKeep(name: string): boolean {
    return MULE_FOOD.test(name) || SLASH.test(name) || /^kebab$/i.test(name);
}

function lootGive(sdk: import('../../sdk/index').BotSDK): { item: RegExp; amount: number }[] {
    const give: { item: RegExp; amount: number }[] = [];
    const seen = new Set<string>();
    for (const item of sdk.getInventory()) {
        const count = item.count ?? 0;
        if (count <= 0 || isKeep(item.name)) continue;
        const key = item.name.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        give.push({
            item: new RegExp(`^${item.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i'),
            amount: -1
        });
    }
    return give.slice(0, 12);
}

function benchLog(msg: string): void {
    const line = `${new Date().toISOString()} BENCH ${msg}`;
    console.log(line);
    appendGrindLog(GRIND_LOG, line);
}

await runScript(async ({ bot, sdk }) => {
    const t0 = Date.now();
    let step = t0;
    const mark = (label: string) => {
        const now = Date.now();
        benchLog(`+${now - t0}ms ${label} (step +${now - step}ms) @ ${sdk.getState()?.player?.worldX},${sdk.getState()?.player?.worldZ}`);
        step = now;
    };

    await closeUi(bot, sdk);
    await bot.declineTrade().catch(() => {});
    mark('ui closed');

    const nearby = (sdk.getNearbyPlayers() ?? []).map((p) => p.name).join(', ') || 'none';
    benchLog(`nearby=${nearby} inv=${sdk.getInventory().filter((i) => (i.count ?? 0) > 0).map((i) => `${i.count} ${i.name}`).join(', ') || 'empty'}`);

    await walkNear(bot, sdk, ARDOUGNE_BANK.x, ARDOUGNE_BANK.z, 3);
    mark('at bank');

    const give = lootGive(sdk);
    if (give.length === 0) {
        benchLog('no loot stacks in inventory — bench needs noted loot or run after pickpocketing');
        return;
    }

    benchLog(`trade → ${FOOD_MULE} give=${give.length} stack types`);
    const tradeStart = Date.now();
    const result = await bot.trade(FOOD_MULE, {
        give,
        want: [{ item: MULE_FOOD, amount: 1 }],
        requestTimeout: 30_000,
        timeout: 75_000,
        retryOnBusy: true
    });
    const t = result.timingsMs;
    benchLog(
        `trade ${result.success ? 'ok' : 'FAIL'} reason=${result.reason ?? '-'} +${Date.now() - tradeStart}ms` +
            ` request=${t?.requestMs ?? '?'} offer=${t?.offerMs ?? '?'} accept=${t?.acceptWaitMs ?? '?'} confirm=${t?.confirmMs ?? '?'} session=${t?.sessionMs ?? '?'}`
    );
    benchLog(`message: ${result.message}`);
    benchLog(`total ${Date.now() - t0}ms`);
});
