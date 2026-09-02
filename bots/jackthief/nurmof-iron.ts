/**
 * Temporary: mine dwarven-mine iron, bank at Falador east (keep coins + 1 rune pick),
 * buy rune pickaxes from Nurmof until 5 extra are purchased.
 *
 *   bun bots/jackthief/nurmof-iron.ts
 */
import { appendFileSync } from 'fs';
import { dirname, join } from 'path';
import { runScript } from '../../sdk/runner';

const WANT = 5;
const IRON = { x: 3037, z: 9776 };
const STAIRS_UP = { x: 3058, z: 9776 };
const STAIRS_DOWN = { x: 3059, z: 3376 };
const HOUSE_DOOR = { x: 3063, z: 3380 };
const BANK = { x: 3012, z: 3355 };
const NURMOF = { x: 2998, z: 9844 };

const COINS = /^coins$/i;
const RUNE_PICK = /^rune pickaxe$/i;
const ANY_PICK = /pickaxe/i;
const IRON_ROCK = /rocks iron ore/i;

const GRIND_LOG = join(dirname(import.meta.path), 'grind.log');

await runScript(async ({ bot, sdk }) => {
    const log = (msg: string) => {
        console.log(msg);
        try {
            appendFileSync(GRIND_LOG, `${new Date().toISOString()} ${msg}\n`);
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
        return { x: p?.worldX ?? 0, z: p?.worldZ ?? 0 };
    };
    const distTo = (x: number, z: number) => Math.hypot(pos().x - x, pos().z - z);
    const inMine = () => pos().z >= 9600 && pos().z < 10000;
    const emptySlots = () => Math.max(0, 28 - sdk.getInventory().filter((i) => (i.count ?? 0) > 0).length);
    const invPicks = (pattern: RegExp = RUNE_PICK) =>
        sdk.getInventory().filter((i) => pattern.test(i.name)).reduce((n, i) => n + (i.count ?? 1), 0);
    const equippedPick = () => !!(sdk.findEquipmentItem(RUNE_PICK) ?? sdk.findEquipmentItem(ANY_PICK));
    const pickCount = () => invPicks(ANY_PICK) + (equippedPick() ? 1 : 0);

    async function closeUi() {
        if (sdk.getState()?.shop?.isOpen || sdk.getState()?.bank?.isOpen || sdk.getState()?.interface?.isOpen) {
            await bot.closeInterface();
        }
        await bot.dismissBlockingUI();
    }

    async function walkNear(x: number, z: number, tolerance = 3): Promise<boolean> {
        if (distTo(x, z) <= tolerance) return true;
        const r = await bot.walkTo(x, z, Math.min(tolerance, 3));
        return r.success || distTo(x, z) <= tolerance + 2;
    }

    async function climb(want: 'down' | 'up'): Promise<boolean> {
        const opt = want === 'down' ? /climb-down/i : /climb-up/i;
        const stand = want === 'down' ? STAIRS_DOWN : STAIRS_UP;
        for (let i = 0; i < 8; i++) {
            if (want === 'down' ? inMine() : !inMine()) return true;
            if (want === 'down' && !inMine() && distTo(STAIRS_DOWN.x, STAIRS_DOWN.z) <= 2) {
                await walkNear(HOUSE_DOOR.x, HOUSE_DOOR.z, 1);
            }
            await sdk.scanNearbyLocs(8).catch(() => {});
            const loc = (sdk.getNearbyLocs() ?? [])
                .filter(
                    (l) =>
                        /stair/i.test(l.name) &&
                        l.optionsWithIndex.some((o) => opt.test(o.text)) &&
                        l.reachable !== false
                )
                .sort((a, b) => (a.distance ?? 99) - (b.distance ?? 99))[0];
            if (!loc) {
                await walkNear(want === 'down' ? HOUSE_DOOR.x : stand.x, want === 'down' ? HOUSE_DOOR.z : stand.z, 1);
                continue;
            }
            intent(`Climb ${want} ${loc.name} @ ${loc.x},${loc.z}`);
            if ((loc.distance ?? 99) > 2) await walkNear(loc.x, loc.z, 1);
            const before = pos();
            await bot.interactLoc(loc, opt);
            await sdk
                .waitForCondition(() => Math.abs(pos().z - before.z) > 8, 8_000)
                .catch(() => {});
        }
        return want === 'down' ? inMine() : !inMine();
    }

    async function goSurface(): Promise<boolean> {
        if (!inMine()) return true;
        await walkNear(STAIRS_UP.x, STAIRS_UP.z, 2);
        return climb('up');
    }

    async function goMine(): Promise<boolean> {
        if (inMine()) return true;
        return climb('down');
    }

    async function openBankHere(): Promise<boolean> {
        await closeUi();
        if (!(await goSurface())) {
            log(`Could not climb out @ ${pos().x},${pos().z}`);
            return false;
        }
        await walkNear(BANK.x, BANK.z, 2);
        if (sdk.getState()?.bank?.isOpen) return true;
        const opened = await bot.openBank();
        if (!opened.success && !sdk.getState()?.bank?.isOpen) {
            log(`openBank: ${opened.message}`);
            return false;
        }
        return true;
    }

    async function withdrawWorkPick(): Promise<boolean> {
        if (pickCount() > 0) return true;
        const pick =
            sdk.findBankItem(RUNE_PICK) ??
            sdk.findBankItem(/^adamant pickaxe$/i) ??
            sdk.findBankItem(/^mithril pickaxe$/i) ??
            sdk.findBankItem(ANY_PICK);
        if (!pick) {
            log('No pickaxe in bank');
            return false;
        }
        const r = await bot.withdrawItem(pick, 1);
        log(`Withdraw ${pick.name}: ${r.success ? 'ok' : r.message}`);
        const inv = sdk.findInventoryItem(ANY_PICK);
        if (inv) await bot.equipItem(inv);
        return pickCount() > 0;
    }

    async function bankExceptCash(): Promise<boolean> {
        if (!(await openBankHere())) return false;

        for (;;) {
            const junk = sdk.getInventory().find((i) => {
                if ((i.count ?? 0) <= 0) return false;
                if (COINS.test(i.name)) return false;
                if (ANY_PICK.test(i.name)) return false;
                return true;
            });
            if (!junk) break;
            const r = await bot.depositItem(junk, -1);
            if (!r.success) {
                log(`deposit ${junk.name}: ${r.message}`);
                break;
            }
        }
        // depositItem(..., -1) dumps every matching id, so extras must go one at a time.
        while (invPicks(ANY_PICK) + (equippedPick() ? 1 : 0) > 1) {
            const extra = sdk.findInventoryItem(ANY_PICK);
            if (!extra) break;
            const r = await bot.depositItem(extra, 1);
            if (!r.success) {
                log(`deposit extra pick: ${r.message}`);
                break;
            }
        }
        await withdrawWorkPick();
        await bot.closeBank();
        log(`Banked. gp=${sdk.findInventoryItem(COINS)?.count ?? 0} picks=${invPicks()}${equippedPick() ? '+eq' : ''}`);
        return pickCount() > 0;
    }

    async function tryBuyRunePick(): Promise<boolean> {
        await closeUi();
        if (!(await goMine())) {
            log(`Could not climb down @ ${pos().x},${pos().z}`);
            return false;
        }
        await walkNear(NURMOF.x, NURMOF.z, 3);
        if (!sdk.getState()?.shop?.isOpen) {
            const opened = await bot.openShop(/nurmof/i);
            if (!opened.success && !sdk.getState()?.shop?.isOpen) {
                log(`openShop: ${opened.message}`);
                return false;
            }
        }
        const stock = sdk.getState()?.shop?.shopItems?.find((i) => RUNE_PICK.test(i.name));
        const n = stock?.count ?? 0;
        log(`Nurmof rune pickaxe stock=${n} price=${stock?.buyPrice ?? '?'}`);
        if (n <= 0) {
            await bot.closeShop();
            return false;
        }
        const before = invPicks() + (sdk.findEquipmentItem(RUNE_PICK) ? 1 : 0);
        const bought = await bot.buyFromShop(RUNE_PICK, 1);
        const after = invPicks() + (sdk.findEquipmentItem(RUNE_PICK) ? 1 : 0);
        log(
            `Buy rune pick ${bought.success ? 'ok' : bought.message} ` +
                `picks ${before}->${after} gp=${sdk.findInventoryItem(COINS)?.count ?? 0}`
        );
        await bot.closeShop();
        return after > before;
    }

    async function mineUntilFull(): Promise<void> {
        await closeUi();
        if (pickCount() === 0) {
            log('No pickaxe — skipping mine');
            return;
        }
        if (!(await goMine())) return;
        await walkNear(IRON.x, IRON.z, 4);
        while (emptySlots() > 0) {
            await bot.dismissBlockingUI();
            if (pickCount() === 0) return;
            await sdk.scanNearbyLocs(8).catch(() => {});
            const rock = (sdk.getNearbyLocs() ?? [])
                .filter(
                    (l) =>
                        IRON_ROCK.test(l.name) &&
                        l.optionsWithIndex.some((o) => /^mine$/i.test(o.text)) &&
                        l.reachable !== false
                )
                .sort((a, b) => (a.distance ?? 99) - (b.distance ?? 99))[0];
            if (!rock) {
                if (distTo(IRON.x, IRON.z) > 6) await walkNear(IRON.x, IRON.z, 3);
                else await sdk.waitForTicks(2);
                continue;
            }
            intent(`Mine iron @ ${rock.x},${rock.z} (${emptySlots()} empty)`);
            await bot.interactLoc(rock, /mine/i);
        }
    }

    await bot.skipTutorial();
    await closeUi();
    // Operator already bought 1 at Nurmof.
    let bought = 1;
    log(
        `nurmof-iron start @ ${pos().x},${pos().z} gp=${sdk.findInventoryItem(COINS)?.count ?? 0} ` +
            `empty=${emptySlots()} picks=${pickCount()} bought=${bought}/${WANT}`
    );

    if (pickCount() === 0) {
        intent('No pickaxe — checking Nurmof then bank');
        if (await tryBuyRunePick()) {
            bought++;
            intent(`Bought rune pickaxe ${bought}/${WANT}`);
        }
        if (pickCount() === 0 && !(await bankExceptCash())) {
            throw new Error('No pickaxe in inventory, equipment, Nurmof, or bank');
        }
    }

    while (bought < WANT) {
        if (emptySlots() === 0) {
            intent(`Inventory full — bank then Nurmof (${bought}/${WANT})`);
            await bankExceptCash();
            if (await tryBuyRunePick()) {
                bought++;
                intent(`Bought rune pickaxe ${bought}/${WANT}`);
            }
        }
        if (bought >= WANT) break;
        if (pickCount() === 0) {
            intent('Pickaxe missing — bank withdraw');
            if (!(await bankExceptCash())) throw new Error('Lost pickaxe and could not withdraw one');
        }
        intent(`Mining iron (${bought}/${WANT} picks)`);
        await mineUntilFull();
    }

    intent(`Done — bought ${bought} rune pickaxes`);
    if (emptySlots() === 0 || invPicks() > 1) await bankExceptCash();
});
