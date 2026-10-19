/**
 * Cut banked uncut gems lowest-tier-first, then stop.
 *
 *   bun bots/quests/cut-gems.ts {botname} --until=40
 *
 * Pipeline slot: sheep-shearer -> cut-gems -> bowstrings (flax). Sheep hands
 * over ~Craft 10; gems cut whatever tiers the account's level allows
 * (sapphire -> emerald -> ruby -> diamond), each tier unlocking the next as
 * the level rises; flax finishes whatever is left to --until.
 *
 * Chisel: withdraws a banked one, else withdraws coins and buys from the
 * Edgeville general store (falling back to Arhein in Catherby).
 *
 * Exit 2 when Crafting reaches --until (parent should not start flax).
 * Exit 0 when no (more) cuttable gems are banked (parent should start flax).
 * Exit 1 on setup failure (no chisel obtainable).
 */
import { join } from 'path';
import { ActivitySession } from '../../sdk/index';
import { runScript } from '../../sdk/runner';
import { walkNear } from './movement';
import { ARHEIN_SHOP } from './tiles';

const botName = process.argv.slice(2).find((a) => !a.startsWith('-')) ?? '';
const untilArg = process.argv.find((a) => a.startsWith('--until='));
const untilCraft = Number(untilArg?.split('=')[1]);
const CRAFT_UNTIL = Number.isFinite(untilCraft) && untilCraft > 0 ? untilCraft : 40;
const GRIND_LOG = join(process.cwd(), 'bots', botName, 'grind.log');

const EDGEVILLE_BANK = { x: 3094, z: 3492 };
const EDGEVILLE_SHOP = { x: 3080, z: 3511 };

const CHISEL = /^chisel$/i;
const COINS = /^coins$/i;

/** Lowest first: each tier cut to exhaustion (or --until) unlocks the next. */
const TIERS = [
    { name: 'sapphire', uncut: /^uncut sapphire$/i },
    { name: 'emerald', uncut: /^uncut emerald$/i },
    { name: 'ruby', uncut: /^uncut ruby$/i },
    { name: 'diamond', uncut: /^uncut diamond$/i },
];

let exitCode = 0;

await runScript(async ({ bot, sdk }) => {
    const session = new ActivitySession(sdk, bot, {
        name: 'cut-gems',
        grindLogPath: GRIND_LOG
    });

    const log = (msg: string) => session.log('log', msg);

    function pos() {
        const p = sdk.getState()?.player;
        return { x: p?.worldX ?? 0, z: p?.worldZ ?? 0 };
    }

    function distTo(x: number, z: number): number {
        return Math.hypot(pos().x - x, pos().z - z);
    }

    function craft(): number {
        return sdk.getSkill('Crafting')?.baseLevel ?? 1;
    }

    function craftXp(): number {
        return sdk.getSkill('Crafting')?.experience ?? 0;
    }

    function count(pattern: RegExp): number {
        return sdk.getInventory().filter((i) => pattern.test(i.name)).reduce((n, i) => n + (i.count ?? 1), 0);
    }

    function bankCount(pattern: RegExp): number {
        return sdk.getBankItems().filter((i) => pattern.test(i.name)).reduce((n, i) => n + (i.count ?? 0), 0);
    }

    async function openEdgevilleBank(): Promise<boolean> {
        if (distTo(EDGEVILLE_BANK.x, EDGEVILLE_BANK.z) > 6) {
            await walkNear(bot, sdk, EDGEVILLE_BANK.x, EDGEVILLE_BANK.z, 4);
        }
        await bot.closeInterface().catch(() => undefined);
        if (sdk.getState()?.bank?.isOpen) return true;
        const r = await bot.openBank();
        return r.success || !!sdk.getState()?.bank?.isOpen;
    }

    async function buyChiselAt(shop: { x: number; z: number }, match: RegExp): Promise<boolean> {
        await walkNear(bot, sdk, shop.x, shop.z, 3);
        const opened = await bot.openShop(match);
        if (!opened.success && !sdk.getState()?.shop?.isOpen) return false;
        await bot.buyFromShop(CHISEL, 1).catch(() => undefined);
        await bot.closeShop().catch(() => undefined);
        return !!sdk.findInventoryItem(CHISEL);
    }

    async function ensureChisel(): Promise<boolean> {
        if (sdk.findInventoryItem(CHISEL)) return true;
        if (sdk.getState()?.bank?.isOpen) {
            const banked = sdk.findBankItem(CHISEL);
            if (banked) {
                await bot.withdrawItem(banked, 1).catch(() => undefined);
                if (sdk.findInventoryItem(CHISEL)) return true;
            }
            if ((sdk.findInventoryItem(COINS)?.count ?? 0) < 5) {
                const coins = sdk.findBankItem(COINS);
                if (coins) await bot.withdrawItem(coins, Math.min(coins.count, 50)).catch(() => undefined);
            }
            await bot.closeBank().catch(() => undefined);
        } else if ((sdk.findInventoryItem(COINS)?.count ?? 0) < 5) {
            return false;
        }
        if (sdk.findInventoryItem(CHISEL)) return true;
        log('Buying a chisel at the Edgeville general store');
        if (await buyChiselAt(EDGEVILLE_SHOP, /general/i)) return true;
        log('Edgeville had no chisel — walking to Arhein');
        if (await buyChiselAt(ARHEIN_SHOP, /arhein/i)) return true;
        return !!sdk.findInventoryItem(CHISEL);
    }

    async function cutLoad(tier: (typeof TIERS)[number]): Promise<number> {
        let cut = 0;
        while (count(tier.uncut) > 0 && craft() < CRAFT_UNTIL && !session.isStopped()) {
            const gem = sdk.findInventoryItem(tier.uncut);
            const chisel = sdk.findInventoryItem(CHISEL);
            if (!gem || !chisel) break;
            const before = count(tier.uncut);
            const xpBefore = craftXp();
            await sdk.sendUseItemOnItem(gem.slot, chisel.slot);
            await sdk.waitForCondition(() => count(tier.uncut) < before || craftXp() > xpBefore, 6_000).catch(() => {});
            if (count(tier.uncut) >= before && craftXp() <= xpBefore) {
                session.noteFailure('cut', `uncut ${tier.name} did not cut (level-gated?)`);
                break;
            }
            cut++;
            session.noteProgress('xp', tier.name);
        }
        return cut;
    }

    async function bankLeftovers(tier: (typeof TIERS)[number]): Promise<void> {
        if (count(tier.uncut) < 1) return;
        if (!sdk.getState()?.bank?.isOpen && !(await openEdgevilleBank())) return;
        const gem = sdk.findInventoryItem(tier.uncut);
        if (gem) await bot.depositItem(gem, -1).catch(() => undefined);
        await bot.closeBank().catch(() => undefined);
    }

    try {
        log(`Cut gems start Crafting ${craft()} (${craftXp()} xp) until=${CRAFT_UNTIL} @ ${pos().x},${pos().z}`);
        if (craft() >= CRAFT_UNTIL) {
            exitCode = 2;
            session.stop('done', `Crafting ${craft()} — until ${CRAFT_UNTIL}`);
            return;
        }

        await session.setPhase('bank');
        if (!(await openEdgevilleBank())) {
            exitCode = 1;
            session.stopRestartable('bank_open', 'Edgeville bank did not open');
            return;
        }
        const survey = TIERS.map((t) => `${t.name}=${bankCount(t.uncut)}`).join(' ');
        log(`Bank uncut survey: ${survey}`);
        if (TIERS.every((t) => bankCount(t.uncut) < 1)) {
            await bot.closeBank().catch(() => undefined);
            exitCode = 0;
            session.stop('done', 'No uncut gems in bank — flax next');
            return;
        }
        if (!(await ensureChisel())) {
            exitCode = 1;
            session.stop('setup', 'No chisel (bank, Edgeville, or Arhein)');
            return;
        }
        if (!sdk.getState()?.bank?.isOpen && !(await openEdgevilleBank())) {
            exitCode = 1;
            session.stop('setup', 'Bank closed before the gem withdraw');
            return;
        }

        let total = 0;
        for (const tier of TIERS) {
            if (craft() >= CRAFT_UNTIL) break;
            const n = bankCount(tier.uncut);
            if (n < 1) continue;
            const room = Math.max(0, 27 - sdk.getInventory().filter((i) => (i.count ?? 0) > 0).length);
            const take = Math.min(n, room);
            if (take > 0) {
                const w = await bot.withdrawItem(tier.uncut, take);
                log(`Withdraw uncut ${tier.name} x${take} ${w.success ? 'ok' : w.message}`);
            }
            await bot.closeBank().catch(() => undefined);
            await session.setPhase('cut');
            const cut = await cutLoad(tier);
            total += cut;
            log(`Cut ${cut} ${tier.name} | Crafting ${craft()} (${craftXp()} xp)`);
            await bankLeftovers(tier);
            if (cut < 1) {
                log(`${tier.name} locked at Crafting ${craft()} — higher tiers locked too`);
                break;
            }
            if (craft() >= CRAFT_UNTIL) break;
            if (!sdk.getState()?.bank?.isOpen && !(await openEdgevilleBank())) break;
        }

        log(`Cut ${total} gems total | Crafting ${craft()} (${craftXp()} xp)`);
        exitCode = craft() >= CRAFT_UNTIL ? 2 : 0;
        session.stop(
            'done',
            exitCode === 2
                ? `Crafting ${craft()} — until ${CRAFT_UNTIL}`
                : `Crafting ${craft()} after gems — flax next`
        );
    } catch (err) {
        exitCode = 1;
        session.stopRestartable('script_error', err instanceof Error ? err.message : String(err));
    } finally {
        await session.finalizeStop();
    }
});

process.exit(exitCode);
