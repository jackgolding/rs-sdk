/**
 * Witch's Potion — reusable.
 *
 *   bun bots/quests/witchs-potion.ts {botname}
 *
 * Starts Hetty in Rimmington, gathers onion / rat's tail / eye of newt /
 * burnt meat, hands in, drinks the cauldron. Jacklove5 is Cooking 99, so
 * burnt meat is cooked meat used on a range (always burns).
 */
import { appendFileSync } from 'fs';
import { join } from 'path';
import { runScript } from '../../sdk/runner';
import { leaveAltar, leaveMine } from './air-runes-shared';

const FALADOR_EAST = { x: 3012, z: 3355 };
const HETTY = { x: 2968, z: 3206 };
const ONIONS = { x: 2950, z: 3251 };
const RATS = { x: 2953, z: 3204 };
const BETTY = { x: 3012, z: 3259 };
const WYDIN = { x: 3014, z: 3204 };
const RANGE = { x: 2970, z: 3209 };

const TO_HETTY = [
    { x: 3008, z: 3325 },
    { x: 3010, z: 3275 },
    { x: 2968, z: 3206 }
];

const ONION = /^onion$/i;
const TAIL = /^rat'?s tail$/i;
const NEWT = /^eye of newt$/i;
const BURNT = /^burnt meat$/i;
const COOKED = /^cooked meat$/i;
const RAW_BEEF = /^raw beef$/i;
const RAW_CHICKEN = /^raw chicken$/i;
const COINS = /^coins$/i;
const FOOD = /^(swordfish|lobster|tuna|shark|salmon|trout|bass|anchovies|sardine|herring|bread|cake|wine)$/i;
const KEEP =
    /^(onion|rat'?s tail|eye of newt|burnt meat|cooked meat|raw beef|raw chicken|coins|swordfish|lobster|tuna|shark)$/i;

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
    }

    function pos() {
        const p = sdk.getState()?.player;
        return {
            x: p?.worldX ?? 0,
            z: p?.worldZ ?? 0,
            hp: p?.hp ?? 10,
            maxHp: p?.maxHp ?? 10,
            isDead: p?.isDead ?? false
        };
    }

    function distTo(x: number, z: number): number {
        return Math.hypot(pos().x - x, pos().z - z);
    }

    function count(pattern: RegExp): number {
        return sdk.getInventory().filter((i) => pattern.test(i.name)).reduce((n, i) => n + (i.count ?? 1), 0);
    }

    function magicXp(): number {
        return sdk.getSkill('Magic')?.experience ?? 0;
    }

    const startMagicXp = magicXp();
    let questStarted = false;

    function questDone(): boolean {
        if (magicXp() >= startMagicXp + 300) return true;
        const msgs = sdk.getState()?.recentMessages ?? [];
        return msgs.some((m) => /completed the.*witch|imbued with power/i.test(m));
    }

    async function closeUi(): Promise<void> {
        for (let i = 0; i < 8; i++) {
            await bot.dismissBlockingUI();
            const dialog = sdk.getDialog();
            if (dialog?.isOpen && (dialog.options?.length ?? 0) <= 1) {
                await sdk.sendClickDialog(dialog.options?.[0]?.index ?? 0);
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

    async function walkNear(x: number, z: number, tolerance = 4): Promise<boolean> {
        if (distTo(x, z) <= tolerance) return true;
        const r = await bot.walkTo(x, z, Math.min(tolerance, 3));
        return r.success || distTo(x, z) <= tolerance + 2;
    }

    async function walkRoute(points: Array<{ x: number; z: number }>): Promise<void> {
        for (const p of points) {
            await closeUi();
            await walkNear(p.x, p.z, 5);
        }
    }

    async function chat(choices: RegExp[] = [], max = 24): Promise<string[]> {
        const seen: string[] = [];
        for (let i = 0; i < max; i++) {
            const dialog = sdk.getDialog();
            if (!dialog?.isOpen) {
                await sdk.waitForTicks(1);
                if (!sdk.getDialog()?.isOpen) break;
            }
            const opts = sdk.getDialog()?.options ?? [];
            for (const o of opts) seen.push(o.text);
            if (opts.length <= 1) {
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

    async function eatIfNeeded(): Promise<void> {
        if (pos().hp >= pos().maxHp - 2) return;
        const food = sdk.findInventoryItem(FOOD);
        if (!food) return;
        intent(`Eating ${food.name} (hp ${pos().hp}/${pos().maxHp})`);
        await bot.eatFood(food);
    }

    async function prepBank(): Promise<void> {
        intent('Banking at Falador east');
        await closeUi();
        await walkNear(FALADOR_EAST.x, FALADOR_EAST.z, 3);
        if (!(sdk.getState()?.bank?.isOpen || (await bot.openBank()).success)) {
            throw new Error('Could not open Falador east bank');
        }
        for (let pass = 0; pass < 8; pass++) {
            const junk = sdk.getInventory().find((i) => (i.count ?? 0) > 0 && !KEEP.test(i.name));
            if (!junk) break;
            await bot.depositItem(junk, -1);
        }
        if (count(COINS) < 20) {
            const w = await bot.withdrawItem(COINS, 50);
            if (!w.success) log(`Coin withdraw: ${w.message}`);
        }
        if (!sdk.findInventoryItem(FOOD)) {
            const w = await bot.withdrawItem(FOOD, 5);
            if (!w.success) log(`Food withdraw: ${w.message}`);
        }
        for (const item of [ONION, TAIL, NEWT, BURNT, COOKED, RAW_BEEF]) {
            if (count(item) < 1) await bot.withdrawItem(item, 1);
        }
        await bot.closeBank();
        await eatIfNeeded();
        log(`Prepped @ ${pos().x},${pos().z} hp=${pos().hp} coins=${count(COINS)}`);
    }

    async function goHetty(): Promise<void> {
        if (distTo(HETTY.x, HETTY.z) <= 8 && sdk.findNearbyNpc(/^hetty$/i)) return;
        intent('Walking to Hetty');
        if (distTo(HETTY.x, HETTY.z) > 80) await walkRoute(TO_HETTY);
        await walkNear(HETTY.x, HETTY.z, 4);
    }

    async function talkHetty(): Promise<string[]> {
        await closeUi();
        await goHetty();
        let hetty = sdk.findNearbyNpc(/^hetty$/i) ?? sdk.findNearbyNpc(/hetty/i);
        if (!hetty) {
            await sdk.scanNearbyLocs(12).catch(() => {});
            hetty = sdk.findNearbyNpc(/^hetty$/i);
        }
        if (!hetty) {
            log(`Hetty not nearby @ ${pos().x},${pos().z}`);
            return [];
        }
        const talk = await bot.talkTo(hetty);
        if (!talk.success) {
            log(`talk Hetty: ${talk.message}`);
            return [];
        }
        await sdk.waitForTicks(1);
        return chat([
            /i am in search of a quest/i,
            /yes help me become one with my darker side/i,
            /yes i'?d like to improve my magic/i,
            /show me the mysteries of the dark arts/i
        ]);
    }

    async function startOrHandIn(): Promise<'complete' | 'drink' | 'started' | 'unknown'> {
        const seen = (await talkHetty()).join(' | ');
        log(`Hetty: ${seen || '(no dialog)'}`);
        await chat();
        await bot.dismissBlockingUI();
        if (/how'?s your magic coming along/i.test(seen)) return 'complete';
        if (/drink from the cauldron|going to drink the potion/i.test(seen)) return 'drink';
        if (/yes i have everything|puts them all into her cauldron/i.test(seen)) return 'drink';
        if (/eye of newt|rat'?s tail|burnt meat|darker side|darker self|found the things/i.test(seen)) return 'started';
        if (seen.length > 0 && !/i am in search of a quest/i.test(seen)) return 'started';
        return 'unknown';
    }

    async function drinkCauldron(): Promise<boolean> {
        intent('Drinking Hetty\'s cauldron');
        await closeUi();
        await goHetty();
        await sdk.scanNearbyLocs(10).catch(() => {});
        const pot = sdk.findNearbyLoc(/^cauldron$/i);
        if (!pot) {
            log('No cauldron nearby');
            return false;
        }
        const r = await bot.interactLoc(pot, /drink/i);
        if (!r.success) log(`cauldron: ${r.message}`);
        await sdk.waitForTicks(2);
        await chat();
        await bot.dismissBlockingUI();
        return questDone();
    }

    async function pickOnion(): Promise<void> {
        if (count(ONION) > 0) return;
        intent('Picking an onion');
        await closeUi();
        await walkNear(ONIONS.x, ONIONS.z, 4);
        await sdk.scanNearbyLocs(8).catch(() => {});
        const plant = sdk.findNearbyLoc(/^onion$/i, { reachable: true }) ?? sdk.findNearbyLoc(/^onion$/i);
        if (!plant) {
            log(`No onion loc @ ${pos().x},${pos().z}`);
            return;
        }
        const r = await bot.interactLoc(plant, /pick/i);
        if (!r.success) log(`pick onion: ${r.message}`);
        await sdk.waitForTicks(2);
    }

    async function getNewt(): Promise<void> {
        if (count(NEWT) > 0) return;
        intent('Buying eye of newt from Betty');
        await closeUi();
        await walkNear(BETTY.x, BETTY.z, 4);
        const shop = await bot.openShop(/betty/i);
        if (!shop.success) {
            log(`Betty shop: ${shop.message}`);
            return;
        }
        const buy = await bot.buyFromShop(NEWT, 1);
        if (!buy.success) log(`newt buy: ${buy.message}`);
        await bot.closeShop();
    }

    async function getMeat(): Promise<void> {
        if (count(BURNT) > 0) return;
        await closeUi();
        if (count(COOKED) < 1 && count(RAW_BEEF) < 1 && count(RAW_CHICKEN) < 1) {
            intent('Buying raw beef from Wydin');
            await walkNear(WYDIN.x, WYDIN.z, 4);
            const shop = await bot.openShop(/wydin/i);
            if (!shop.success) {
                log(`Wydin shop: ${shop.message}`);
                return;
            }
            let buy = await bot.buyFromShop(RAW_BEEF, 1);
            if (!buy.success) buy = await bot.buyFromShop(RAW_CHICKEN, 1);
            if (!buy.success) log(`meat buy: ${buy.message}`);
            await bot.closeShop();
        }
        if (count(BURNT) > 0) return;
        intent('Cooking meat on the Rimmington range');
        await walkNear(RANGE.x, RANGE.z, 4);
        await sdk.scanNearbyLocs(10).catch(() => {});
        const range = sdk.findNearbyLoc(/^range$/i);
        if (!range) {
            log(`No range @ ${pos().x},${pos().z}`);
            return;
        }
        if (count(COOKED) < 1) {
            const raw = sdk.findInventoryItem(RAW_BEEF) ?? sdk.findInventoryItem(RAW_CHICKEN);
            if (raw) {
                const cook = await bot.useItemOnLoc(raw, range);
                if (!cook.success) log(`cook: ${cook.message}`);
                await sdk.waitForTicks(3);
            }
        }
        const cooked = sdk.findInventoryItem(COOKED);
        if (cooked) {
            await sdk.scanNearbyLocs(8).catch(() => {});
            const rangeNow = sdk.findNearbyLoc(/^range$/i) ?? range;
            const burn = await bot.useItemOnLoc(cooked, rangeNow);
            if (!burn.success) log(`burn: ${burn.message}`);
            await sdk.waitForTicks(3);
        }
    }

    async function getTail(): Promise<void> {
        if (count(TAIL) > 0) return;
        const ground = sdk.findGroundItem(TAIL);
        if (ground) {
            intent('Picking up rat\'s tail');
            await bot.pickupItem(ground);
            return;
        }
        intent('Killing a rat for the tail');
        await closeUi();
        await eatIfNeeded();
        if (distTo(RATS.x, RATS.z) > 12) await walkNear(RATS.x, RATS.z, 5);
        const rat = sdk.findNearbyNpc(/^rat$/i, { reachable: true }) ?? sdk.findNearbyNpc(/^rat$/i);
        if (!rat) {
            log(`No rat @ ${pos().x},${pos().z}`);
            await walkNear(RATS.x, RATS.z, 4);
            return;
        }
        const atk = await bot.attack(rat, 8_000);
        if (!atk.success) log(`attack rat: ${atk.message}`);
        await sdk.waitForCondition(() => !!sdk.findGroundItem(TAIL), 8_000).catch(() => null);
        const item = sdk.findGroundItem(TAIL);
        if (item) await bot.pickupItem(item);
    }

    await closeUi();
    log(`Witch's Potion start @ ${pos().x},${pos().z} hp=${pos().hp}/${pos().maxHp} magicXp=${startMagicXp}`);
    await leaveAltar(bot, sdk, log);
    await leaveMine(bot, sdk, log);
    await prepBank();

    const until = Date.now() + 15 * 60_000;
    while (Date.now() < until && !questDone()) {
        await closeUi();
        await eatIfNeeded();
        if (pos().isDead) {
            await sdk.waitForTicks(3);
            continue;
        }

        const haveAll = count(ONION) > 0 && count(TAIL) > 0 && count(NEWT) > 0 && count(BURNT) > 0;
        if (haveAll) {
            const phase = await startOrHandIn();
            if (phase === 'complete' || questDone()) break;
            if (phase === 'drink' || sdk.findNearbyLoc(/^cauldron$/i)) {
                if (await drinkCauldron()) break;
            }
            continue;
        }

        if (count(NEWT) < 1) await getNewt();
        if (count(ONION) < 1) await pickOnion();
        if (count(BURNT) < 1) await getMeat();
        if (count(TAIL) < 1) {
            if (!questStarted) {
                const phase = await startOrHandIn();
                if (phase === 'complete') break;
                if (phase === 'drink') {
                    if (await drinkCauldron()) break;
                    continue;
                }
                if (phase === 'started') questStarted = true;
            }
            await getTail();
        }

        log(
            `have onion=${count(ONION)} tail=${count(TAIL)} newt=${count(NEWT)} burnt=${count(BURNT)} cooked=${count(COOKED)} @ ${pos().x},${pos().z}`
        );
        await sdk.waitForTicks(1);
    }

    if (questDone()) log(`Witch's Potion complete magicXp=${magicXp()}`);
    else throw new Error(`Quest unfinished @ ${pos().x},${pos().z} magicXp=${magicXp()}`);
});
