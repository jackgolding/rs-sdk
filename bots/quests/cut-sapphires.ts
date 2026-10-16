/**
 * Cut banked uncut sapphires, then stop.
 *
 *   bun bots/quests/cut-sapphires.ts {botname} --until=31
 *
 * Exit 2 when Crafting reaches --until (parent should not start flax).
 * Exit 0 when the checked banks have no uncut sapphires, or some were cut
 * and Crafting is still short (parent should start flax).
 */
import { join } from 'path';
import { ActivitySession } from '../../sdk/index';
import { runScript } from '../../sdk/runner';
import { walkNear, walkWaypoints } from './movement';
import { ARDOUGNE_BANK, ARHEIN_SHOP, CATHERBY_BANK, SEERS_BANK } from './tiles';

const botName = process.argv.slice(2).find((a) => !a.startsWith('-')) ?? '';
const untilArg = process.argv.find((a) => a.startsWith('--until='));
const untilCraft = Number(untilArg?.split('=')[1]);
const CRAFT_UNTIL = Number.isFinite(untilCraft) && untilCraft > 0 ? untilCraft : 31;
const GRIND_LOG = join(process.cwd(), 'bots', botName, 'grind.log');

const UNCUT = /^uncut sapphire$/i;
const CHISEL = /^chisel$/i;
const COINS = /^coins$/i;
const BANKS = [SEERS_BANK, CATHERBY_BANK, ARDOUGNE_BANK];

let exitCode = 0;

await runScript(async ({ bot, sdk }) => {
    const session = new ActivitySession(sdk, bot, {
        name: 'cut-sapphires',
        grindLogPath: GRIND_LOG
    });

    const log = (msg: string) => session.log('log', msg);

    function pos() {
        const p = sdk.getState()?.player;
        return { x: p?.worldX ?? 0, z: p?.worldZ ?? 0, hp: p?.hp ?? 10, maxHp: p?.maxHp ?? 10 };
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

    async function openBankAt(bank: { x: number; z: number }): Promise<boolean> {
        if (distTo(bank.x, bank.z) > 6) {
            await walkWaypoints(bot, sdk, [bank], {
                walkNear: (x, z, tol) => walkNear(bot, sdk, x, z, tol)
            });
        }
        await bot.closeInterface();
        if (sdk.getState()?.bank?.isOpen) return true;
        const r = await bot.openBank();
        return r.success || !!sdk.getState()?.bank?.isOpen;
    }

    async function ensureChisel(): Promise<boolean> {
        if (sdk.findInventoryItem(CHISEL)) return true;
        if (sdk.getState()?.bank?.isOpen) {
            const banked = sdk.findBankItem(CHISEL);
            if (banked) {
                await bot.withdrawItem(banked, 1);
                if (sdk.findInventoryItem(CHISEL)) return true;
            }
            if ((sdk.findInventoryItem(COINS)?.count ?? 0) < 5) {
                const coins = sdk.findBankItem(COINS);
                if (coins) await bot.withdrawItem(coins, Math.min(coins.count, 50));
            }
            await bot.closeBank();
        }
        if (sdk.findInventoryItem(CHISEL)) return true;
        log("Buying a chisel from Arhein");
        await walkNear(bot, sdk, ARHEIN_SHOP.x, ARHEIN_SHOP.z, 3);
        const opened = await bot.openShop(/arhein/i);
        if (!opened.success && !sdk.getState()?.shop?.isOpen) {
            session.noteFailure('shop', opened.message || 'Arhein did not open');
            return false;
        }
        await bot.buyFromShop(CHISEL, 1);
        await bot.closeShop();
        return !!sdk.findInventoryItem(CHISEL);
    }

    async function cutLoad(): Promise<number> {
        let cut = 0;
        while (count(UNCUT) > 0 && craft() < CRAFT_UNTIL && !session.isStopped()) {
            const gem = sdk.findInventoryItem(UNCUT);
            const chisel = sdk.findInventoryItem(CHISEL);
            if (!gem || !chisel) break;
            const before = count(UNCUT);
            const xpBefore = craftXp();
            await sdk.sendUseItemOnItem(gem.slot, chisel.slot);
            await sdk.waitForCondition(() => count(UNCUT) < before || craftXp() > xpBefore, 6_000).catch(() => {});
            if (count(UNCUT) >= before && craftXp() <= xpBefore) {
                session.noteFailure('cut', 'uncut sapphire did not cut');
                break;
            }
            cut++;
            session.noteProgress('xp', 'sapphire');
        }
        return cut;
    }

    try {
        log(`Cut sapphires start Crafting ${craft()} (${craftXp()} xp) until=${CRAFT_UNTIL} @ ${pos().x},${pos().z}`);
        if (craft() >= CRAFT_UNTIL) {
            exitCode = 2;
            session.stop('done', `Crafting ${craft()} — until ${CRAFT_UNTIL}`);
            return;
        }

        const banks = [...BANKS].sort((a, b) => distTo(a.x, a.z) - distTo(b.x, b.z));
        let found = 0;
        for (const bank of banks) {
            await session.setPhase('bank');
            if (!(await openBankAt(bank))) {
                session.noteFailure('bank_open', `bank ${bank.x},${bank.z}`);
                continue;
            }
            const n = bankCount(UNCUT);
            log(`Bank ${bank.x},${bank.z} uncut sapphires ${n}`);
            if (n < 1) {
                await bot.closeBank();
                continue;
            }
            if (!(await ensureChisel())) {
                exitCode = 1;
                session.stop('setup', 'No chisel for uncut sapphires');
                return;
            }
            if (!sdk.getState()?.bank?.isOpen && !(await openBankAt(bank))) {
                exitCode = 1;
                session.stop('setup', 'Bank closed before the sapphire withdraw');
                return;
            }
            const room = Math.max(0, 27 - sdk.getInventory().filter((i) => (i.count ?? 0) > 0).length);
            const take = Math.min(n, room);
            if (take > 0) {
                const w = await bot.withdrawItem(UNCUT, take);
                log(`Withdraw uncut sapphire x${take} ${w.success ? 'ok' : w.message}`);
            }
            found = count(UNCUT);
            await bot.closeBank();
            if (found > 0) break;
        }

        if (found < 1) {
            exitCode = 0;
            session.stop('done', 'No uncut sapphires in Seers, Catherby, or Ardougne — flax next');
            return;
        }

        await session.setPhase('cut');
        let total = 0;
        while (craft() < CRAFT_UNTIL && !session.isStopped()) {
            if (count(UNCUT) < 1) break;
            const n = await cutLoad();
            total += n;
            if (n < 1) break;
        }
        log(`Cut ${total} sapphires | Crafting ${craft()} (${craftXp()} xp)`);
        exitCode = craft() >= CRAFT_UNTIL ? 2 : 0;
        session.stop(
            'done',
            exitCode === 2
                ? `Crafting ${craft()} — until ${CRAFT_UNTIL}`
                : `Crafting ${craft()} after sapphires — flax next`
        );
    } catch (err) {
        exitCode = 1;
        session.stopRestartable('script_error', err instanceof Error ? err.message : String(err));
    } finally {
        await session.finalizeStop();
    }
});

process.exit(exitCode);
