/**
 * Bank at Catherby, buy 3 rune pickaxes from Nurmof, walk to Varrock east,
 * gift one to each of Jackpoo2 / Jackpoo4 / Jackpoo5.
 *
 *   bun bots/fatpig/rune-picks.ts
 */
import { appendFileSync } from 'fs';
import { dirname, join } from 'path';
import { runScript } from '../../sdk/runner';

const MINERS = ['Jackpoo2', 'Jackpoo4', 'Jackpoo5'] as const;
const CATHERBY_BANK = { x: 2808, z: 3443 };
const FALADOR_WEST_BANK = { x: 2945, z: 3368 };
const MINE_STAIRS = { x: 3059, z: 3376 };
const NURMOF = { x: 2998, z: 9844 };
const VARROCK_EAST = { x: 3253, z: 3420 };
const COIN_NEED = 96_000;
const COIN_WITHDRAW = 120_000;
const PICK_WANT = 3;

const COINS = /^coins$/i;
const RUNE_PICK = /^rune pickaxe$/i;
const ESSENCE = /^(rune essence|pure essence)$/i;
const FOOD = /^(swordfish|lobster|tuna|salmon|trout|cake|bread|shrimps?|anchovies)$/i;
const KEEP = /^(coins|rune pickaxe|swordfish|lobster|tuna|salmon|trout|cake|bread)$/i;

const TO_MINE = [
    { x: 2808, z: 3443 },
    { x: 2870, z: 3420 },
    { x: 2928, z: 3432 },
    { x: 3010, z: 3408 },
    { x: 3059, z: 3376 }
];
const TO_VARROCK = [
    { x: 3059, z: 3376 },
    { x: 3082, z: 3420 },
    { x: 3180, z: 3430 },
    { x: 3253, z: 3420 }
];

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
    const intent = (msg: string) => {
        log(msg);
        void sdk.showIntent(msg);
    };
    const pos = () => {
        const p = sdk.getState()?.player;
        return { x: p?.worldX ?? 0, z: p?.worldZ ?? 0, hp: p?.hp ?? 0, maxHp: p?.maxHp ?? 10 };
    };
    const distTo = (x: number, z: number) => Math.hypot(pos().x - x, pos().z - z);
    const count = (pattern: RegExp) =>
        sdk.getInventory().filter((i) => pattern.test(i.name)).reduce((n, i) => n + (i.count ?? 1), 0);
    const inDwarvenMine = () => pos().z >= 9600 && pos().z < 10000;

    async function closeUi() {
        if (sdk.getState()?.shop?.isOpen || sdk.getState()?.bank?.isOpen || sdk.getState()?.interface?.isOpen) {
            await bot.closeInterface();
        }
        await bot.dismissBlockingUI();
    }

    async function eat() {
        while (pos().hp < pos().maxHp) {
            const food = sdk.findInventoryItem(FOOD);
            if (!food) break;
            await bot.eatFood(food);
            await sdk.waitForTicks(1);
        }
    }

    async function walkNear(x: number, z: number, tolerance = 4): Promise<boolean> {
        if (distTo(x, z) <= tolerance) return true;
        const life = sdk.getState()?.player?.lifeId;
        await eat();
        const r = await bot.walkTo(x, z, Math.min(tolerance, 3));
        const p = sdk.getState()?.player;
        if (p?.isDead || (life !== undefined && p?.lifeId !== undefined && p.lifeId !== life)) {
            throw new Error(`Died walking to ${x},${z} — stopping so coins stay put`);
        }
        return r.success || distTo(x, z) <= tolerance + 2;
    }

    async function walkWaypoints(points: { x: number; z: number }[]) {
        const dest = points[points.length - 1]!;
        for (const p of points) {
            if (distTo(p.x, p.z) <= 8) continue;
            if (Math.hypot(dest.x - p.x, dest.z - p.z) >= distTo(dest.x, dest.z) - 4) continue;
            await walkNear(p.x, p.z, 6);
        }
        if (distTo(dest.x, dest.z) > 6) await walkNear(dest.x, dest.z, 3);
    }

    async function openBankAt(x: number, z: number): Promise<boolean> {
        await closeUi();
        await walkNear(x, z, 3);
        if (sdk.getState()?.bank?.isOpen) return true;
        const r = await bot.openBank();
        return r.success || sdk.getState()?.bank?.isOpen === true;
    }

    async function climbMine(want: 'down' | 'up'): Promise<boolean> {
        const opt = want === 'down' ? /climb-down/i : /climb-up/i;
        const before = pos();
        for (let i = 0; i < 8; i++) {
            await sdk.scanNearbyLocs(8).catch(() => {});
            const loc = (sdk.getNearbyLocs() ?? [])
                .filter((l) => /stair/i.test(l.name) && l.optionsWithIndex.some((o) => opt.test(o.text)))
                .sort((a, b) => (a.distance ?? 99) - (b.distance ?? 99))[0];
            if (!loc) {
                await walkNear(want === 'down' ? MINE_STAIRS.x : 3058, want === 'down' ? MINE_STAIRS.z : 9776, 2);
                continue;
            }
            intent(`Climb ${want} ${loc.name} @ ${loc.x},${loc.z}`);
            if ((loc.distance ?? 99) > 2) await walkNear(loc.x, loc.z, 1);
            await bot.interactLoc(loc, opt);
            await sdk
                .waitForCondition(() => {
                    const p = pos();
                    return Math.abs(p.z - before.z) > 8;
                }, 8_000)
                .catch(() => {});
            if (want === 'down' ? inDwarvenMine() : !inDwarvenMine()) return true;
        }
        return want === 'down' ? inDwarvenMine() : !inDwarvenMine();
    }

    await bot.skipTutorial();
    await closeUi();
    log(`Rune-pick run start @ ${pos().x},${pos().z} HP ${pos().hp}/${pos().maxHp} picks=${count(RUNE_PICK)}`);

    if (count(RUNE_PICK) < PICK_WANT) {
        if (inDwarvenMine()) {
            intent('Already in the dwarven mine — heading to Nurmof');
        } else {
            if (count(COINS) >= COIN_NEED) {
                if (count(COINS) > COIN_WITHDRAW) {
                    intent('Parking extra coins at Falador west bank — keeping 120k for Nurmof');
                    const bank = distTo(FALADOR_WEST_BANK.x, FALADOR_WEST_BANK.z) <= distTo(CATHERBY_BANK.x, CATHERBY_BANK.z)
                        ? FALADOR_WEST_BANK
                        : CATHERBY_BANK;
                    if (!(await openBankAt(bank.x, bank.z))) {
                        throw new Error('Could not open bank to park extra coins');
                    }
                    await bot.depositItem(COINS, -1);
                    const inBank = sdk.findBankItem(COINS);
                    const gp = inBank?.count ?? 0;
                    log(`Banked extra; bank now ${gp} gp`);
                    if (gp < COIN_NEED) throw new Error(`Bank only has ${gp} gp`);
                    await bot.withdrawItem(inBank!, Math.min(COIN_WITHDRAW, gp));
                    if (count(FOOD) < 4) {
                        const food =
                            sdk.findBankItem(/^swordfish$/i) ??
                            sdk.findBankItem(/^lobster$/i) ??
                            sdk.findBankItem(/^tuna$/i) ??
                            sdk.findBankItem(FOOD);
                        if (food) await bot.withdrawItem(food, Math.min(8, food.count));
                    }
                    await bot.closeBank();
                    log(`Carrying ${count(COINS)} gp`);
                }
            } else {
                intent('Banking at Catherby for coins and food');
                if (!(await openBankAt(CATHERBY_BANK.x, CATHERBY_BANK.z))) {
                    throw new Error('Could not open Catherby bank');
                }
                for (;;) {
                    const junk = sdk.getInventory().find((i) => (i.count ?? 0) > 0 && !KEEP.test(i.name) && !FOOD.test(i.name));
                    if (!junk) break;
                    const r = await bot.depositItem(junk, -1);
                    if (!r.success) break;
                }
                const coins = sdk.findBankItem(COINS);
                const gp = coins?.count ?? 0;
                log(`Bank coins ${gp}`);
                if (gp < COIN_NEED && count(COINS) < COIN_NEED) {
                    throw new Error(`Need ${COIN_NEED} gp for 3 rune picks, bank has ${gp}`);
                }
                if (count(COINS) < COIN_NEED) {
                    await bot.withdrawItem(coins!, Math.min(COIN_WITHDRAW, gp));
                }
                if (count(FOOD) < 6) {
                    const food =
                        sdk.findBankItem(/^swordfish$/i) ??
                        sdk.findBankItem(/^lobster$/i) ??
                        sdk.findBankItem(/^tuna$/i) ??
                        sdk.findBankItem(FOOD);
                    if (food) await bot.withdrawItem(food, Math.min(8, food.count));
                }
                await bot.closeBank();
            }
            await eat();
            if (count(COINS) < COIN_NEED) {
                throw new Error(`Only ${count(COINS)} gp after withdraw`);
            }

            intent('Walking to Falador dwarven mine');
            await walkWaypoints(TO_MINE);
            if (!(await climbMine('down'))) {
                throw new Error(`Could not climb down into the dwarven mine @ ${pos().x},${pos().z}`);
            }
        }

        intent('Buying 3 rune pickaxes from Nurmof');
        await walkNear(NURMOF.x, NURMOF.z, 3);
        while (count(RUNE_PICK) < PICK_WANT) {
            await eat();
            if (!sdk.getState()?.shop?.isOpen) {
                const opened = await bot.openShop(/nurmof/i);
                if (!opened.success && !sdk.getState()?.shop?.isOpen) {
                    log(`openShop: ${opened.message}`);
                    await walkNear(NURMOF.x, NURMOF.z, 2);
                    await sdk.waitForTicks(2);
                    continue;
                }
            }
            const stock = sdk.getState()?.shop?.shopItems?.find((i) => RUNE_PICK.test(i.name));
            if (stock && stock.count > 0) {
                const before = count(RUNE_PICK);
                const bought = await bot.buyFromShop(RUNE_PICK, 1);
                log(
                    `Buy rune pick ${bought.success ? 'ok' : bought.message} stock=${stock.count} ` +
                        `price=${stock.buyPrice} now=${count(RUNE_PICK)} gp=${count(COINS)}`
                );
                if (count(RUNE_PICK) === before) await sdk.waitForTicks(3);
                continue;
            }
            log(`Waiting for Nurmof restock (${count(RUNE_PICK)}/${PICK_WANT})`);
            await sdk.waitForTicks(20);
        }
        await bot.closeShop();
        log(`Have ${count(RUNE_PICK)} rune pickaxes`);
    }

    if (inDwarvenMine()) {
        intent('Leaving the dwarven mine');
        await walkNear(3058, 9776, 3);
        if (!(await climbMine('up'))) {
            throw new Error(`Could not climb out of the dwarven mine @ ${pos().x},${pos().z}`);
        }
    }

    intent('Walking to Varrock east bank');
    await walkWaypoints(TO_VARROCK);
    await walkNear(VARROCK_EAST.x, VARROCK_EAST.z, 3);
    log(`ARRIVED Varrock east @ ${pos().x},${pos().z} picks=${count(RUNE_PICK)} — waiting to trade ${MINERS.join(', ')}`);

    const done = new Set<string>();
    const deadline = Date.now() + 30 * 60_000;
    while (done.size < MINERS.length && Date.now() < deadline) {
        await closeUi();
        await eat();
        if (distTo(VARROCK_EAST.x, VARROCK_EAST.z) > 8) {
            await walkNear(VARROCK_EAST.x, VARROCK_EAST.z, 3);
        }
        for (const name of MINERS) {
            if (done.has(name)) continue;
            if (count(RUNE_PICK) < 1) break;
            const player = sdk.findNearbyPlayer(new RegExp(`^${name}$`, 'i'));
            if (!player) continue;
            intent(`Trading rune pickaxe to ${name}`);
            const r = await bot.trade(name, {
                give: [{ item: RUNE_PICK, amount: 1 }],
                want: [{ item: ESSENCE, amount: 1 }],
                retryOnBusy: true,
                requestTimeout: 120_000,
                timeout: 120_000
            });
            log(`Trade ${name}: ${r.success ? 'ok' : r.message} (${r.reason ?? ''})`);
            if (r.success) done.add(name);
        }
        if (done.size < MINERS.length) {
            log(`Waiting for miners (${[...done].join(', ') || 'none'} done)`);
            await sdk.waitForTicks(10);
        }
    }

    log(`Trade done: ${[...done].join(', ') || 'none'} | picks left=${count(RUNE_PICK)}`);
    if (done.size < MINERS.length) {
        throw new Error(`Did not finish trades: missing ${MINERS.filter((n) => !done.has(n)).join(', ')}`);
    }
});
