/**
 * Goblin Diplomacy — reusable.
 *
 *   bun bots/quests/goblin-diplomacy.ts {botname}
 *
 * Bartender → 3 goblin mail + dyes → orange / blue / brown armour → Goblin Village.
 */
import { appendFileSync } from 'fs';
import { join } from 'path';
import { runScript } from '../../sdk/runner';
import {
    buyAtShop,
    ensureCoins,
    ensureItem,
    SHOPS,
    type SupplyCtx
} from './quest-supplies';

const BARTENDER = { x: 3045, z: 3257 };
const AGGIE = { x: 3086, z: 3259 };
const WYSON = { x: 3027, z: 3379 };
const GOBLINS = { x: 3252, z: 3230 };
const GOBLIN_VILLAGE = { x: 2957, z: 3511 };
const REDBERRIES = { x: 3268, z: 3370 };
const ONIONS = { x: 2950, z: 3251 };

const MAIL = /^goblin mail$/i;
const ORANGE_MAIL = /^orange goblin mail$/i;
const BLUE_MAIL = /^blue goblin mail$/i;
const RED_DYE = /^red dye$/i;
const YELLOW_DYE = /^yellow dye$/i;
const BLUE_DYE = /^blue dye$/i;
const ORANGE_DYE = /^orange dye$/i;
const REDBERRY = /^redberries?$/i;
const ONION = /^onion$/i;
const WOAD = /^woad leaf$/i;
const COINS = /^coins$/i;
const FOOD = /^(lobster|swordfish|tuna|shark|trout|salmon|bread|cake|wine)$/i;

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
            hp: p?.hp ?? 10,
            maxHp: p?.maxHp ?? 10,
            isDead: p?.isDead ?? false
        };
    }

    function distTo(x: number, z: number): number {
        return Math.hypot(pos().x - x, pos().z - z);
    }

    function count(pattern: RegExp): number {
        return sdk.getInventory().reduce((n, i) => n + (pattern.test(i.name) ? (i.count ?? 1) : 0), 0);
    }

    function mailCount(): number {
        return count(MAIL) + count(ORANGE_MAIL) + count(BLUE_MAIL);
    }

    let sawComplete = false;

    function questText(): string {
        const game = (sdk.getState()?.gameMessages ?? []).map((m) => m.text);
        const chat = sdk.getChat({ limit: 80, types: [0, 1, 2, 3, 4, 5, 6, 7] }).map((m) => m.text);
        const dialog = sdk.getDialog();
        return [...game, ...chat, dialog?.text ?? '', ...(dialog?.options ?? []).map((o) => o.text)].join('\n');
    }

    function questDone(): boolean {
        if (sawComplete) return true;
        const text = questText();
        // Overlay is "You have completed the\nGoblin Diplomacy Quest!" — `.*` does
        // not span that newline. Do not treat a generic "Congratulations!" as
        // done: that line is still in chat from Romeo & Juliet.
        if (/completed the[\s\S]{0,80}goblin diplomacy/i.test(text)) {
            sawComplete = true;
            return true;
        }
        return false;
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

    async function chat(choices: RegExp[] = [], max = 36): Promise<string[]> {
        const seen: string[] = [];
        const isContinue = (opts: Array<{ text: string }>) =>
            opts.length > 0 &&
            opts.every((o) => /click here to continue/i.test(o.text)) &&
            !opts.some((o) => /coins/i.test(o.text));
        for (let i = 0; i < max; i++) {
            const dialog = sdk.getDialog();
            if (!dialog?.isOpen) {
                await sdk.waitForTicks(1);
                if (!sdk.getDialog()?.isOpen) break;
            }
            const opts = sdk.getDialog()?.options ?? [];
            log(
                `chat: ${opts.map((o) => `[${o.index}] ${o.text}`).join(' | ') || '(no options)'} text=${JSON.stringify(sdk.getDialog()?.text ?? '')}`
            );
            for (const o of opts) seen.push(o.text);
            if (isContinue(opts)) {
                await sdk.sendClickDialog(opts[0]?.index ?? 0);
                await sdk.waitForTicks(1);
                continue;
            }
            let match: (typeof opts)[number] | undefined;
            for (const c of choices) {
                match = opts.find((o) => c.test(o.text));
                if (match) break;
            }
            if (!match) {
                log(`chat unmatched wanted=${choices.map(String).join(', ')}`);
                break;
            }
            const before = opts.map((o) => o.text).join('|');
            log(`chat click [${match.index}] ${match.text}`);
            await sdk.sendClickDialog(match.index);
            for (let w = 0; w < 8; w++) {
                await sdk.waitForTicks(1);
                const now = sdk.getDialog()?.options ?? [];
                if (!sdk.getDialog()?.isOpen || now.map((o) => o.text).join('|') !== before) break;
            }
        }
        return seen;
    }

    async function walkNear(x: number, z: number, tolerance = 4): Promise<boolean> {
        if (distTo(x, z) <= tolerance) return true;
        const r = await bot.walkTo(x, z, Math.min(tolerance, 3));
        return r.success || distTo(x, z) <= tolerance + 2;
    }

    async function eatIfNeeded(): Promise<void> {
        if (pos().hp >= pos().maxHp - 3) return;
        const food = sdk.findInventoryItem(FOOD);
        if (food) await bot.eatFood(food);
    }

    async function startQuest(): Promise<void> {
        intent('Starting quest at Rusty Anchor bartender');
        await walkNear(BARTENDER.x, BARTENDER.z, 3);
        const bar = sdk.findNearbyNpc(/bartender/i);
        if (!bar) return;
        await bot.talkTo(bar);
        await chat([/not very busy/i]);
        await chat();
    }

    async function lootMail(): Promise<boolean> {
        const before = mailCount();
        const item =
            sdk.findGroundItem(MAIL, { reachable: true }) ??
            sdk.findGroundItem(MAIL) ??
            (await sdk.scanFindGroundItem(MAIL, 24).catch(() => null));
        if (!item) return false;
        intent(`Picking up goblin mail (${before}/3)`);
        const r = await bot.pickupItem(item);
        log(`Loot mail: ${r.success ? 'ok' : r.message} @ ${item.x},${item.z} now=${mailCount()}/3`);
        return mailCount() > before;
    }

    async function killForMail(): Promise<void> {
        while (mailCount() < 3) {
            await eatIfNeeded();
            if (pos().isDead) {
                await sdk.waitForCondition((s) => !s.player.isDead, 30_000).catch(() => {});
                continue;
            }
            if (await lootMail()) continue;
            intent(`Killing goblins for mail (${mailCount()}/3)`);
            await walkNear(GOBLINS.x, GOBLINS.z, 6);
            if (await lootMail()) continue;
            const gob = sdk.findNearbyNpc(/^goblin$/i, { reachable: true }) ?? sdk.findNearbyNpc(/^goblin$/i);
            if (!gob) {
                log(`No goblin @ ${pos().x},${pos().z}`);
                await sdk.waitForTicks(2);
                continue;
            }
            const atk = await bot.attack(gob, 12_000);
            if (!atk.success) log(`attack goblin: ${atk.message}`);
            await sdk.waitForCondition(() => !!sdk.findGroundItem(MAIL) || mailCount() >= 3, 8_000).catch(() => null);
            await lootMail();
            await sdk.waitForTicks(1);
        }
    }

    const supplyCtx = (): SupplyCtx => ({ bot, sdk, log, intent, walkNear, closeUi });

    async function ensureSupplies(): Promise<void> {
        const ctx = supplyCtx();
        await ensureCoins(ctx, 80);
        if (count(FOOD) < 3) {
            await buyAtShop(ctx, SHOPS.WYDIN, [
                { pattern: /^wine$/i, amount: 5, label: 'wine' },
                { pattern: /^bread$/i, amount: 3, label: 'bread' }
            ]);
        }
    }

    async function pickRedberries(): Promise<void> {
        if (count(REDBERRY) >= 3) return;
        intent('Picking redberries');
        await walkNear(REDBERRIES.x, REDBERRIES.z, 4);
        await sdk.scanNearbyLocs(8).catch(() => {});
        const bush = sdk.findNearbyLoc(/redberry/i) ?? sdk.findNearbyLoc(/berry/i);
        if (bush) {
            while (count(REDBERRY) < 3) {
                const r = await bot.interactLoc(bush, /pick/i);
                if (!r.success) break;
                await sdk.waitForTicks(2);
            }
        }
        if (count(REDBERRY) < 3) {
            await ensureCoins(supplyCtx(), 15);
            await buyAtShop(supplyCtx(), SHOPS.WYDIN, [
                { pattern: REDBERRY, amount: 3, label: 'redberries' }
            ]);
        }
    }

    async function pickOnions(): Promise<void> {
        if (count(ONION) >= 2) return;
        intent('Picking onions');
        await walkNear(ONIONS.x, ONIONS.z, 4);
        await sdk.scanNearbyLocs(8).catch(() => {});
        const plant = sdk.findNearbyLoc(/^onion$/i);
        if (!plant) return;
        while (count(ONION) < 2) {
            await bot.interactLoc(plant, /pick/i);
            await sdk.waitForTicks(2);
        }
    }

    async function buyWoad(): Promise<void> {
        if (count(WOAD) >= 2) return;
        await ensureCoins(supplyCtx(), 25);
        intent('Buying woad leaves from Wyson');
        for (let attempt = 1; attempt <= 12 && count(WOAD) < 2; attempt++) {
            log(`woad attempt ${attempt} @ ${pos().x},${pos().z} woad=${count(WOAD)} gp=${count(COINS)}`);
            await walkNear(WYSON.x, WYSON.z, 2);
            const wyson = sdk.findNearbyNpc(/wyson/i);
            if (!wyson) {
                log(`no Wyson @ ${pos().x},${pos().z}`);
                await sdk.waitForTicks(2);
                continue;
            }
            await bot.talkTo(wyson);
            const before = count(WOAD);
            for (let step = 0; step < 32 && count(WOAD) <= before; step++) {
                const opts = sdk.getDialog()?.options ?? [];
                const twenty = [...opts].reverse().find((o) => /how about 20 coins/i.test(o.text));
                if (twenty) {
                    log(`woad pay 20gp [${twenty.index}] ${twenty.text}`);
                    const r = await sdk.sendClickDialog(twenty.index);
                    if (!r.success && twenty.componentId) {
                        await sdk.sendClickComponent(twenty.componentId);
                    }
                    await sdk.waitForTicks(2);
                    continue;
                }
                const looking = opts.find((o) => /looking for woad/i.test(o.text));
                if (looking) {
                    await sdk.sendClickDialog(looking.index);
                    await sdk.waitForTicks(2);
                    continue;
                }
                if (opts.some((o) => /how about 5 coins/i.test(o.text))) {
                    log('woad price menu — not clicking 5gp');
                    await sdk.waitForTicks(1);
                    continue;
                }
                if (
                    opts.length > 0 &&
                    opts.every((o) => /click here to continue/i.test(o.text))
                ) {
                    await sdk.sendClickDialog(opts[0]!.index);
                    await sdk.waitForTicks(1);
                    continue;
                }
                if (opts.length === 0) {
                    await sdk.waitForTicks(1);
                    continue;
                }
                break;
            }
            log(`woad after talk=${count(WOAD)}`);
            if (count(WOAD) >= 2) break;
        }
        if (count(WOAD) < 2) throw new Error(`still no woad @ ${pos().x},${pos().z}`);
    }

    async function makeDyeAtAggie(color: 'red' | 'yellow' | 'blue'): Promise<void> {
        const have =
            (color === 'red' && count(RED_DYE) > 0) ||
            (color === 'yellow' && count(YELLOW_DYE) > 0) ||
            (color === 'blue' && count(BLUE_DYE) > 0);
        if (have) return;
        intent(`Getting ${color} dye from Aggie`);
        await walkNear(AGGIE.x, AGGIE.z, 3);
        const aggie = sdk.findNearbyNpc(/^aggie$/i);
        if (!aggie) return;
        await bot.talkTo(aggie);
        await chat([/make dyes for me/i, /can you make dyes/i]);
        const choice =
            color === 'red'
                ? [/make red dye/i, /okay.*red dye/i]
                : color === 'yellow'
                  ? [/make yellow dye/i, /okay.*yellow dye/i]
                  : [/make blue dye/i, /okay.*blue dye/i];
        await chat(choice);
        await chat(choice);
        await chat();
    }

    async function makeOrangeDye(): Promise<void> {
        if (count(ORANGE_DYE) > 0) return;
        if (count(RED_DYE) < 1) await makeDyeAtAggie('red');
        if (count(YELLOW_DYE) < 1) await makeDyeAtAggie('yellow');
        const red = sdk.findInventoryItem(RED_DYE);
        const yellow = sdk.findInventoryItem(YELLOW_DYE);
        if (!red || !yellow) return;
        intent('Mixing orange dye');
        await sdk.sendUseItemOnItem(red.slot, yellow.slot);
        await sdk.waitForTicks(2);
    }

    async function dyeMail(dye: RegExp, result: RegExp, label: string): Promise<void> {
        if (count(result) > 0) return;
        const plain = sdk.findInventoryItem(MAIL);
        const bottle = sdk.findInventoryItem(dye);
        if (!plain || !bottle) return;
        intent(`Dyeing goblin mail ${label}`);
        await sdk.sendUseItemOnItem(bottle.slot, plain.slot);
        await sdk.waitForTicks(2);
    }

    async function prepareArmour(): Promise<void> {
        await ensureSupplies();
        if (mailCount() < 3) await killForMail();
        await ensureCoins(supplyCtx(), 35);
        if (count(REDBERRY) < 3) await pickRedberries();
        if (count(ONION) < 2) await pickOnions();
        if (count(WOAD) < 2) await buyWoad();
        await makeDyeAtAggie('red');
        await makeDyeAtAggie('yellow');
        await makeDyeAtAggie('blue');
        await makeOrangeDye();
        await dyeMail(ORANGE_DYE, ORANGE_MAIL, 'orange');
        await dyeMail(BLUE_DYE, BLUE_MAIL, 'blue');
    }

    async function handInGenerals(): Promise<void> {
        intent('Handing in armour at Goblin Village');
        await walkNear(GOBLIN_VILLAGE.x, GOBLIN_VILLAGE.z, 4);
        const wart = sdk.findNearbyNpc(/wartface/i);
        if (!wart) {
            log(`No generals @ ${pos().x},${pos().z}`);
            return;
        }
        await bot.talkTo(wart);
        let seen = await chat([
            /pick an armour colour/i,
            /do you want me to pick/i,
            /i have some orange armour/i,
            /i have some blue armour/i,
            /ok i'?ve got brown armour/i
        ]);
        log(`Generals: ${seen.join(' | ') || '(none)'}`);
        if (count(ORANGE_MAIL) > 0) {
            await bot.talkTo(wart);
            seen = await chat([/i have some orange armour/i, /pick an armour colour/i]);
            log(`Orange: ${seen.join(' | ')}`);
        }
        if (count(BLUE_MAIL) > 0) {
            await bot.talkTo(wart);
            seen = await chat([/i have some blue armour/i]);
            log(`Blue: ${seen.join(' | ')}`);
        }
        if (count(MAIL) > 0) {
            await bot.talkTo(wart);
            seen = await chat([/ok i'?ve got brown armour/i, /brown armour/i]);
            log(`Brown: ${seen.join(' | ')}`);
        }
        await chat();
        for (let i = 0; i < 20 && !questDone(); i++) {
            if (/completed the[\s\S]{0,80}goblin diplomacy/i.test(questText())) {
                sawComplete = true;
                break;
            }
            await sdk.waitForTicks(1);
        }
    }

    await bot.skipTutorial();
    await closeUi();
    log(`Goblin Diplomacy start @ ${pos().x},${pos().z}`);

    const until = Date.now() + 20 * 60_000;
    while (Date.now() < until && !questDone()) {
        await closeUi();
        await ensureSupplies();
        if (count(ORANGE_MAIL) > 0 && count(BLUE_MAIL) > 0 && count(MAIL) > 0) {
            await handInGenerals();
            if (questDone()) break;
        } else {
            await startQuest();
            await prepareArmour();
        }
        log(
            `mail=${count(MAIL)} orange=${count(ORANGE_MAIL)} blue=${count(BLUE_MAIL)} dyes r/y/b/o=${count(RED_DYE)}/${count(YELLOW_DYE)}/${count(BLUE_DYE)}/${count(ORANGE_DYE)}`
        );
        await sdk.waitForTicks(2);
    }

    if (!questDone()) throw new Error(`Goblin Diplomacy unfinished @ ${pos().x},${pos().z}`);
    log('QUEST COMPLETE Goblin Diplomacy');
});
