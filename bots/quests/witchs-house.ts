/**
 * Witch's House — reusable.
 *
 *   bun bots/quests/witchs-house.ts {botname}
 *
 * Boy → door key → magnet/cheese/mouse → shed key → experiment → return ball.
 */
import { appendFileSync } from 'fs';
import { join } from 'path';
import { runScript } from '../../sdk/runner';
import {
    buyAtShop,
    ensureCoins,
    ensureItem,
    SHOPS,
    type SupplyCtx,
    withdrawFromBank
} from './quest-supplies';

const BOY = { x: 2928, z: 3456 };
const WITCH_DOOR = { x: 2933, z: 3459 };
const MOUSE_HOLE = { x: 2937, z: 3466 };
const FOUNTAIN = { x: 2943, z: 3454 };
const SHED = { x: 2943, z: 3450 };
const DRAYNOR_BANK = { x: 3092, z: 3245 };

const DOOR_KEY = /door key|witches.? door/i;
const MAGNET = /^magnet$/i;
const CHEESE = /^cheese$/i;
const SHED_KEY = /shed key|witches.? shed/i;
const BALL = /^ball$/i;
const GLOVES = /^leather gloves$/i;
const FOOD = /^(lobster|swordfish|tuna|shark|trout|salmon|bread|cake|wine|meat pie)$/i;

const botName = process.argv.slice(2).find((a) => !a.startsWith('-')) ?? '';
const GRIND_LOG = join(process.cwd(), 'bots', botName, 'grind.log');

await runScript(async ({ bot, sdk }) => {
    const log = (msg: string) => {
        console.log(msg);
        try {
            appendFileSync(GRIND_LOG, `${new Date().toISOString()} ${msg}\n`);
        } catch {
            /* ignore */
        }
    };

    let lastIntent = '';
    function intent(msg: string): void {
        if (msg === lastIntent) return;
        lastIntent = msg;
        console.log(`> ${msg}`);
        void sdk.showIntent(msg);
    }

    function pos() {
        const p = sdk.getState()?.player;
        return {
            x: p?.worldX ?? 0,
            z: p?.worldZ ?? 0,
            level: p?.level ?? 0,
            hp: p?.hp ?? 10,
            maxHp: p?.maxHp ?? 10,
            isDead: p?.isDead ?? false,
            inCombat: p?.combat?.inCombat ?? false
        };
    }

    function distTo(x: number, z: number): number {
        return Math.hypot(pos().x - x, pos().z - z);
    }

    function count(pattern: RegExp): number {
        return sdk.getInventory().reduce((n, i) => n + (pattern.test(i.name) ? (i.count ?? 1) : 0), 0);
    }

    function hpXp(): number {
        return sdk.getSkill('Hitpoints')?.experience ?? 0;
    }

    function wearingGloves(): boolean {
        return !!sdk.getEquipment().find((i) => GLOVES.test(i.name));
    }

    function questDone(xpBefore: number): boolean {
        if (hpXp() >= xpBefore + 6000) return true;
        const msgs = sdk.getState()?.gameMessages ?? [];
        return msgs.some((m) => /completed the.*witch/i.test(m.text));
    }

    async function closeUi(): Promise<void> {
        for (let i = 0; i < 8; i++) {
            await bot.dismissBlockingUI();
            const dialog = sdk.getDialog();
            const opts = dialog?.options ?? [];
            if (dialog?.isOpen && (opts.length <= 1 || opts.every((o) => /click here to continue/i.test(o.text)))) {
                await sdk.sendClickDialog(opts[0]?.index ?? 0);
                await sdk.waitForTicks(1);
                continue;
            }
            if (sdk.getState()?.shop?.isOpen || sdk.getState()?.bank?.isOpen || sdk.getState()?.interface?.isOpen) {
                await bot.closeInterface();
                await sdk.waitForTicks(1);
                continue;
            }
            break;
        }
    }

    async function chat(choices: RegExp[] = [], max = 28): Promise<string[]> {
        const seen: string[] = [];
        for (let i = 0; i < max; i++) {
            const dialog = sdk.getDialog();
            if (!dialog?.isOpen) {
                await sdk.waitForTicks(1);
                if (!sdk.getDialog()?.isOpen) break;
            }
            const opts = sdk.getDialog()?.options ?? [];
            for (const o of opts) seen.push(o.text);
            if (opts.length <= 1 || opts.every((o) => /click here to continue/i.test(o.text))) {
                await sdk.sendClickDialog(opts[0]?.index ?? 0);
                await sdk.waitForTicks(1);
                continue;
            }
            let picked = false;
            for (const c of choices) {
                const match = opts.find((o) => c.test(o.text));
                if (match) {
                    await sdk.sendClickDialog(match.index);
                    picked = true;
                    break;
                }
            }
            if (!picked) break;
            await sdk.waitForTicks(1);
        }
        return seen;
    }

    async function walkNear(x: number, z: number, tolerance = 4): Promise<boolean> {
        if (distTo(x, z) <= tolerance) return true;
        const r = await bot.walkTo(x, z, Math.min(tolerance, 3));
        return r.success || distTo(x, z) <= tolerance + 2;
    }

    async function climbTo(targetLevel: number): Promise<boolean> {
        for (let i = 0; i < 8 && pos().level !== targetLevel; i++) {
            const wantUp = pos().level < targetLevel;
            const opt = wantUp ? /climb-up|climb.up|go-up|go.up/i : /climb-down|climb.down|go-down|go.down/i;
            await sdk.scanNearbyLocs(8).catch(() => {});
            const stairs = (sdk.getNearbyLocs() ?? [])
                .filter((l) => /stair|ladder/i.test(l.name) && l.optionsWithIndex.some((o) => opt.test(o.text)))
                .sort((a, b) => (a.distance ?? 99) - (b.distance ?? 99))[0];
            if (!stairs) return false;
            const before = pos().level;
            await bot.interactLoc(stairs, opt);
            await sdk.waitForCondition((s) => (s.player?.level ?? before) !== before, 8_000).catch(() => {});
            await closeUi();
        }
        return pos().level === targetLevel;
    }

    async function eatIfNeeded(): Promise<void> {
        if (pos().hp >= pos().maxHp - 5) return;
        const food = sdk.findInventoryItem(FOOD);
        if (food) await bot.eatFood(food);
    }

    const supplyCtx = (): SupplyCtx => ({ bot, sdk, log, intent, walkNear, closeUi });

    async function ensureSupplies(): Promise<void> {
        const ctx = supplyCtx();
        await ensureCoins(ctx, 30);
        await withdrawFromBank(ctx, GLOVES, 1, SHOPS.DRAYNOR_BANK);
        await withdrawFromBank(ctx, CHEESE, 1, SHOPS.DRAYNOR_BANK);
        await withdrawFromBank(ctx, FOOD, 5, SHOPS.DRAYNOR_BANK);
        await ensureItem(ctx, GLOVES, 1, {
            label: 'leather gloves',
            shop: SHOPS.THESSALIA,
            coinsNeeded: 10
        });
        await ensureItem(ctx, CHEESE, 1, {
            label: 'cheese',
            shop: SHOPS.WYDIN,
            coinsNeeded: 10
        });
        if (count(FOOD) < 5) {
            await buyAtShop(ctx, SHOPS.WYDIN, [
                { pattern: /^wine$/i, amount: 8, label: 'wine' },
                { pattern: /^bread$/i, amount: 5, label: 'bread' }
            ]);
        }
        const gloves = sdk.findInventoryItem(GLOVES);
        if (gloves) await bot.equipItem(gloves);
    }

    async function witchNearby(): boolean {
        return !!(sdk.findNearbyNpc(/nora|witch/i) && (sdk.findNearbyNpc(/nora|witch/i)?.distance ?? 99) < 8);
    }

    async function startBoy(): Promise<void> {
        intent('Talking to the boy');
        await walkNear(BOY.x, BOY.z, 3);
        const boy = sdk.findNearbyNpc(/^boy$/i);
        if (!boy) return;
        await bot.talkTo(boy);
        const seen = await chat([/what'?s the matter/i, /see what i can do/i, /ok.*see what/i]);
        log(`Boy: ${seen.join(' | ')}`);
    }

    async function getDoorKey(): Promise<void> {
        if (count(DOOR_KEY) > 0) return;
        intent('Searching flower pot for door key');
        await walkNear(WITCH_DOOR.x, WITCH_DOOR.z, 2);
        await sdk.scanNearbyLocs(6).catch(() => {});
        const pot = sdk.findNearbyLoc(/flower pot|pot/i) ?? sdk.findNearbyLoc(/witch/i);
        if (pot) {
            await bot.interactLoc(pot, /search/i);
            await sdk.waitForTicks(2);
        }
    }

    async function enterHouse(): Promise<void> {
        if (count(DOOR_KEY) < 1) return;
        await walkNear(WITCH_DOOR.x, WITCH_DOOR.z, 1);
        const door = sdk.findNearbyLoc(/door/i);
        if (door) {
            const key = sdk.findInventoryItem(DOOR_KEY);
            if (key) await bot.useItemOnLoc(key, door);
            else await bot.openDoor(door);
            await sdk.waitForTicks(2);
        }
        if (pos().level === 0) await climbTo(1);
        if (pos().level === 1) await climbTo(2);
    }

    async function getMagnet(): Promise<void> {
        if (count(MAGNET) > 0) return;
        intent('Getting magnet from basement cupboard');
        if (pos().level > 0) await climbTo(0);
        await sdk.scanNearbyLocs(8).catch(() => {});
        const cupboard = (sdk.getNearbyLocs() ?? []).find((l) => /cupboard/i.test(l.name));
        if (!cupboard) return;
        await bot.interactLoc(cupboard, /open|search/i);
        await sdk.waitForTicks(2);
        await bot.interactLoc(cupboard, /search/i);
        await sdk.waitForTicks(2);
    }

    async function mousePuzzle(): Promise<void> {
        if (count(SHED_KEY) > 0) return;
        intent('Cheese + magnet mouse puzzle');
        if (pos().level !== 0) await climbTo(0);
        await walkNear(MOUSE_HOLE.x, MOUSE_HOLE.z, 2);
        const cheese = sdk.findInventoryItem(CHEESE);
        let hole = sdk.findNearbyLoc(/mouse hole/i);
        // Settle-and-retry: a plane change empties the nearby set until the
        // client scene rebuilds, so one scan reads the hole as absent.
        for (let t = 0; !hole && t < 40; t++) {
            await sdk.waitForTicks(4);
            hole = sdk.findNearbyLoc(/mouse hole/i);
        }
        if (cheese && hole) {
            await bot.useItemOnLoc(cheese, hole);
            await sdk.waitForTicks(3);
        }
        const rat = sdk.findNearbyNpc(/mouse|rat/i);
        const magnet = sdk.findInventoryItem(MAGNET);
        if (rat && magnet) {
            await bot.useItemOnNpc(magnet, rat);
            await sdk.waitForTicks(4);
        }
    }

    async function getShedKey(): Promise<void> {
        if (count(SHED_KEY) > 0) return;
        if (witchNearby()) {
            log('Witch nearby — waiting');
            await sdk.waitForTicks(4);
            return;
        }
        intent('Searching fountain for shed key');
        await walkNear(FOUNTAIN.x, FOUNTAIN.z, 2);
        if (!wearingGloves()) {
            const gloves = sdk.findInventoryItem(GLOVES);
            if (gloves) await bot.equipItem(gloves);
        }
        const fountain = sdk.findNearbyLoc(/fountain/i);
        if (fountain) {
            await bot.interactLoc(fountain, /search/i);
            await sdk.waitForTicks(3);
        }
    }

    async function fightExperiment(): Promise<void> {
        if (count(BALL) > 0) return;
        intent('Fighting Witch\'s Experiment');
        await walkNear(SHED.x, SHED.z, 2);
        const shedDoor = sdk.findNearbyLoc(/shed|door/i);
        const key = sdk.findInventoryItem(SHED_KEY);
        if (shedDoor && key) {
            await bot.useItemOnLoc(key, shedDoor);
            await sdk.waitForTicks(3);
        }
        let phase = 0;
        while (phase < 60 && count(BALL) < 1 && !pos().isDead) {
            await eatIfNeeded();
            const foe = sdk.findNearbyNpc(/witch|experiment|shapeshifter/i);
            if (foe) {
                await bot.attack(foe, 10_000);
                phase++;
            } else {
                const ball = sdk.findGroundItem(BALL);
                if (ball) {
                    await bot.pickupItem(ball);
                    break;
                }
                await sdk.waitForTicks(2);
            }
        }
        if (count(BALL) < 1) {
            const ball = sdk.findGroundItem(BALL);
            if (ball) await bot.pickupItem(ball);
        }
    }

    async function returnBall(): Promise<void> {
        if (count(BALL) < 1) return;
        intent('Returning ball to boy');
        await walkNear(BOY.x, BOY.z, 3);
        const boy = sdk.findNearbyNpc(/^boy$/i);
        if (!boy) return;
        await bot.talkTo(boy);
        await chat();
    }

    const xpBefore = hpXp();
    await bot.skipTutorial();
    await closeUi();
    await ensureSupplies();
    log(`Witch's House start hp xp=${xpBefore} @ ${pos().x},${pos().z}`);

    const until = Date.now() + 20 * 60_000;
    while (Date.now() < until && !questDone(xpBefore)) {
        await closeUi();
        await ensureSupplies();
        if (pos().isDead) {
            await sdk.waitForCondition((s) => !s.player.isDead, 45_000).catch(() => {});
            await ensureSupplies();
            continue;
        }

        if (count(BALL) > 0) {
            await returnBall();
            if (questDone(xpBefore)) break;
            continue;
        }

        if (count(SHED_KEY) > 0) {
            await fightExperiment();
            continue;
        }

        if (count(MAGNET) > 0 || count(CHEESE) > 0) {
            await mousePuzzle();
            await getShedKey();
            continue;
        }

        if (count(DOOR_KEY) > 0) {
            await enterHouse();
            await getMagnet();
            continue;
        }

        await startBoy();
        await getDoorKey();

        log(`key=${count(DOOR_KEY)} magnet=${count(MAGNET)} shedKey=${count(SHED_KEY)} ball=${count(BALL)} @ ${pos().x},${pos().z}`);
        await sdk.waitForTicks(2);
    }

    if (!questDone(xpBefore)) throw new Error(`Witch's House unfinished @ ${pos().x},${pos().z}`);
    log(`QUEST COMPLETE Witch's House (+${hpXp() - xpBefore} HP xp)`);
});
