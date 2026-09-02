/**
 * Finish Goblin Diplomacy from current inventory (mail + dyes).
 *
 *   bun bots/quests/goblin-diplomacy-finish.ts {botname}
 *
 * Does not leave Wyson until 2 woad leaves are in the pack.
 */
import { appendFileSync } from 'fs';
import { join } from 'path';
import { runScript } from '../../sdk/runner';

const AGGIE = { x: 3086, z: 3259 };
const WYSON = { x: 3027, z: 3379 };
const BARTENDER = { x: 3045, z: 3257 };
const GOBLIN_VILLAGE = { x: 2957, z: 3511 };
const DRAYNOR_BANK = { x: 3092, z: 3245 };

const MAIL = /^goblin mail$/i;
const ORANGE_MAIL = /^orange goblin mail$/i;
const BLUE_MAIL = /^blue goblin mail$/i;
const RED_DYE = /^red dye$/i;
const YELLOW_DYE = /^yellow dye$/i;
const BLUE_DYE = /^blue dye$/i;
const ORANGE_DYE = /^orange dye$/i;
const ONION = /^onion$/i;
const WOAD = /woad leaf/i;
const COINS = /^coins$/i;
const FOOD =
    /^(lobster|swordfish|tuna|shark|trout|salmon|bread|cake|wine|meat pie|cooked meat|chicken|herring|sardine|anchovies|cheese|tomato)$/i;

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
        return { x: p?.worldX ?? 0, z: p?.worldZ ?? 0, hp: p?.hp ?? 10, maxHp: p?.maxHp ?? 10 };
    }

    function count(pattern: RegExp): number {
        return sdk.getInventory().reduce((n, i) => n + (pattern.test(i.name) ? (i.count ?? 1) : 0), 0);
    }

    function inv(): string {
        return sdk
            .getInventory()
            .map((i) => `${i.name} x${i.count ?? 1}`)
            .join(', ');
    }

    function recentMsgs(): string {
        const s = sdk.getState() as { gameMessages?: Array<{ text: string }> } | null;
        const msgs = s?.gameMessages ?? [];
        return msgs.slice(-6).map((m) => m.text).join(' | ');
    }

    let done = false;
    function questDone(): boolean {
        if (done) return true;
        const game = recentMsgs();
        const chatHist = sdk.getChat({ limit: 80, types: [0] }).map((m) => m.text).join('\n');
        if (/completed the[\s\S]{0,80}goblin diplomacy/i.test(`${game}\n${chatHist}`)) {
            done = true;
            return true;
        }
        return false;
    }

    function isContinueOpts(opts: Array<{ text: string }>): boolean {
        // Empty option lists are "still loading", not continue. After a refused
        // 20gp click, treating them as continue (or clicking index 1) selects
        // Wyson's 5gp offer.
        return (
            opts.length > 0 &&
            opts.every((o) => /click here to continue/i.test(o.text)) &&
            !opts.some((o) => /coins/i.test(o.text))
        );
    }

    function dialogSnap(): string {
        const d = sdk.getDialog();
        if (!d?.isOpen) return 'dialog=closed';
        const opts = d.options ?? [];
        const bits = opts.map((o) => `[${o.index}] ${JSON.stringify(o.text)}`).join(' | ') || '(no options)';
        return `open wait=${d.isWaiting} text=${JSON.stringify(d.text ?? '')} opts=${bits}`;
    }

    async function closeUi(): Promise<void> {
        for (let i = 0; i < 10; i++) {
            await bot.dismissBlockingUI();
            const d = sdk.getDialog();
            const opts = d?.options ?? [];
            if (d?.isOpen && isContinueOpts(opts)) {
                await sdk.sendClickDialog(opts[0]?.index ?? 0);
                await sdk.waitForTicks(1);
                continue;
            }
            const s = sdk.getState();
            if (s?.shop?.isOpen || s?.bank?.isOpen || s?.interface?.isOpen) {
                await bot.closeInterface();
                await sdk.waitForTicks(1);
                continue;
            }
            break;
        }
    }

    async function chat(choices: RegExp[] = [], max = 40): Promise<string[]> {
        const seen: string[] = [];
        for (let i = 0; i < max; i++) {
            if (!sdk.getDialog()?.isOpen) {
                await sdk.waitForTicks(1);
                if (!sdk.getDialog()?.isOpen) break;
            }
            const opts = sdk.getDialog()?.options ?? [];
            log(`chat: ${dialogSnap()}`);
            for (const o of opts) seen.push(o.text);
            if (opts.length === 0) {
                await sdk.waitForTicks(1);
                continue;
            }
            if (isContinueOpts(opts)) {
                const idx = opts[0]?.index ?? 0;
                const r = await sdk.sendClickDialog(idx);
                log(`chat continue idx=${idx} ok=${r.success} ${r.message ?? ''}`);
                await sdk.waitForTicks(1);
                continue;
            }
            let picked: (typeof opts)[number] | undefined;
            for (const c of choices) {
                const matches = opts.filter((o) => c.test(o.text));
                picked =
                    [...matches].reverse().find((o) => o.buttonType === 1) ??
                    matches[matches.length - 1];
                if (picked) break;
            }
            if (!picked) {
                log(`chat unmatched wanted=${choices.map(String).join(', ')}`);
                break;
            }
            const before = opts.map((o) => o.text).join('|');
            log(`chat click idx=${picked.index} "${picked.text}"`);
            const r = await sdk.sendClickDialog(picked.index);
            log(`chat click result ok=${r.success} ${r.message ?? ''}`);
            if (!r.success && picked.componentId) {
                const r2 = await sdk.sendClickComponent(picked.componentId);
                log(`chat click component ${picked.componentId} ok=${r2.success} ${r2.message ?? ''}`);
            }
            await sdk
                .waitForCondition(
                    (s) =>
                        !s.dialog?.isOpen ||
                        (s.dialog.options ?? []).map((o) => o.text).join('|') !== before,
                    5_000
                )
                .catch(() => null);
            await sdk.waitForTicks(1);
        }
        return seen;
    }

    async function walkNear(x: number, z: number, tolerance = 4): Promise<boolean> {
        if (Math.hypot(pos().x - x, pos().z - z) <= tolerance) return true;
        const r = await bot.walkTo(x, z, Math.min(tolerance, 3));
        return r.success || Math.hypot(pos().x - x, pos().z - z) <= tolerance + 2;
    }

    async function eat(): Promise<void> {
        if (pos().hp > 20) return;
        const food = sdk.findInventoryItem(FOOD);
        if (food) {
            await bot.eatFood(food);
            log(`ate ${food.name} hp=${pos().hp}`);
        }
    }

    async function foodAndCoins(): Promise<void> {
        if (count(COINS) >= 20 && count(FOOD) >= 1) return;
        intent('Bank for coins/food');
        await walkNear(DRAYNOR_BANK.x, DRAYNOR_BANK.z, 3);
        await closeUi();
        const opened = sdk.getState()?.bank?.isOpen || (await bot.openBank()).success;
        if (!opened) {
            log('bank not open');
            return;
        }
        if (count(COINS) < 40) {
            const c = sdk.findBankItem(COINS);
            if (c) await bot.withdrawItem(c, Math.min(200, c.count ?? 200));
        }
        if (count(FOOD) < 3) {
            const f = sdk.findBankItem(FOOD);
            if (f) await bot.withdrawItem(f, Math.min(5, f.count ?? 5));
        }
        await closeUi();
        log(`after bank: ${inv()}`);
    }

    async function startBartender(): Promise<void> {
        intent('Rusty Anchor bartender');
        await walkNear(BARTENDER.x, BARTENDER.z, 3);
        const bar = sdk.findNearbyNpc(/bartender/i);
        if (!bar) {
            log('no bartender');
            return;
        }
        await bot.talkTo(bar);
        const seen = await chat([/not very busy/i, /heard any rumours/i]);
        if (seen.some((t) => /heard any rumours/i.test(t)) && !seen.some((t) => /not very busy/i.test(t))) {
            log('bartender: quest already started');
            await closeUi();
            return;
        }
        await chat();
        log(`bartender: ${seen.join(' | ') || '(none)'}`);
    }

    async function openParkGates(): Promise<void> {
        await sdk.scanNearbyLocs(12).catch(() => {});
        for (const loc of sdk.getNearbyLocs().filter((l) => /gate|door/i.test(l.name))) {
            if (loc.optionsWithIndex.some((o) => /^open$/i.test(o.text))) {
                log(`opening ${loc.name} @ ${loc.x},${loc.z}`);
                await bot.openDoor(loc);
                await sdk.waitForTicks(1);
            }
        }
    }

    async function buyWoad(): Promise<void> {
        if (count(WOAD) >= 2 || count(BLUE_DYE) > 0 || count(BLUE_MAIL) > 0) return;
        if (count(COINS) < 20) await foodAndCoins();
        if (count(COINS) < 20) throw new Error(`need 20gp for woad, have ${count(COINS)}`);

        intent('Wyson for woad leaves — staying until we have 2');
        for (let attempt = 1; attempt <= 16 && count(WOAD) < 2; attempt++) {
            log(
                `woad attempt ${attempt} @ ${pos().x},${pos().z} woad=${count(WOAD)} gp=${count(COINS)} inv=${inv()}`
            );
            for (const spot of [
                { x: 3008, z: 3374 },
                { x: 3016, z: 3382 },
                { x: 3027, z: 3379 }
            ]) {
                await walkNear(spot.x, spot.z, 2);
                await openParkGates();
            }
            await walkNear(WYSON.x, WYSON.z, 2);
            const nearby = sdk.getNearbyNpcs().map((n) => `${n.name}@${n.distance}`).join(', ');
            log(`npcs: ${nearby || '(none)'}`);
            const wyson = sdk.findNearbyNpc(/wyson/i);
            if (!wyson) {
                log(`no Wyson @ ${pos().x},${pos().z}`);
                await sdk.waitForTicks(3);
                continue;
            }
            const talk = await bot.talkTo(wyson);
            log(`talk Wyson: ${talk.success ? 'ok' : talk.message} ${dialogSnap()}`);
            await sdk.waitForTicks(1);
            const gpBefore = count(COINS);
            const before = count(WOAD);
            for (let step = 0; step < 40 && count(WOAD) <= before; step++) {
                const d = sdk.getDialog();
                const opts = d?.options ?? [];
                log(`woad step ${step} ${dialogSnap()}`);
                if (!d?.isOpen) {
                    await sdk.waitForTicks(1);
                    continue;
                }
                if (opts.length === 0) {
                    await sdk.waitForTicks(1);
                    continue;
                }
                const twenty = [...opts]
                    .reverse()
                    .find((o) => /how about 20 coins/i.test(o.text));
                if (twenty) {
                    log(`woad pay 20gp idx=${twenty.index} component=${twenty.componentId ?? 'none'}`);
                    const r = await sdk.sendClickDialog(twenty.index);
                    log(`woad 20gp click ok=${r.success} ${r.message ?? ''}`);
                    if (!r.success && twenty.componentId) {
                        const r2 = await sdk.sendClickComponent(twenty.componentId);
                        log(`woad 20gp component ok=${r2.success} ${r2.message ?? ''}`);
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
                    log(`woad price menu without 20gp — not clicking 5gp ${dialogSnap()}`);
                    await sdk.waitForTicks(1);
                    continue;
                }
                if (isContinueOpts(opts)) {
                    await sdk.sendClickDialog(opts[0]!.index);
                    await sdk.waitForTicks(1);
                    continue;
                }
                log(`woad unmatched ${dialogSnap()}`);
                break;
            }
            log(`woad gp ${gpBefore}->${count(COINS)} leaves=${count(WOAD)} msgs=${recentMsgs()}`);
            log(`woad after talk=${count(WOAD)} gp=${count(COINS)} msgs=${recentMsgs()}`);
            if (count(WOAD) < 2) await closeUi();
        }
        if (count(WOAD) < 2 && count(BLUE_DYE) < 1) {
            throw new Error(`still no woad @ ${pos().x},${pos().z} inv=${inv()} msgs=${recentMsgs()}`);
        }
        log(`woad done: ${count(WOAD)} leaves, inv=${inv()}`);
    }

    async function dyeAtAggie(item: RegExp, have: RegExp, label: string): Promise<void> {
        if (count(have) > 0) return;
        if (label === 'blue' && count(BLUE_MAIL) > 0) return;
        if (label === 'yellow' && (count(ORANGE_DYE) > 0 || count(ORANGE_MAIL) > 0)) return;
        if (sdk.findInventoryItem(item) == null) {
            log(`aggie ${label}: missing ingredient, not walking`);
            return;
        }
        intent(`Aggie ${label}`);
        await walkNear(AGGIE.x, AGGIE.z, 3);
        const aggie = sdk.findNearbyNpc(/^aggie$/i);
        const stuff = sdk.findInventoryItem(item);
        if (!aggie || !stuff) {
            log(`aggie ${label}: npc=${!!aggie} item=${!!stuff} inv=${inv()}`);
            return;
        }
        const r = await bot.useItemOnNpc(stuff, aggie);
        log(`use ${stuff.name} on Aggie: ${r.success ? 'ok' : r.message}`);
        await chat();
        await closeUi();
        log(`after ${label}: ${inv()}`);
    }

    async function mixAndDyeMail(): Promise<void> {
        if (count(ORANGE_DYE) < 1 && count(ORANGE_MAIL) < 1 && count(RED_DYE) > 0 && count(YELLOW_DYE) > 0) {
            const red = sdk.findInventoryItem(RED_DYE);
            const yellow = sdk.findInventoryItem(YELLOW_DYE);
            if (red && yellow) {
                intent('Mix orange dye');
                const r = await sdk.sendUseItemOnItem(red.slot, yellow.slot);
                log(`mix orange: ok=${r.success} ${r.message ?? ''}`);
                await sdk.waitForTicks(2);
                log(`mixed orange: ${inv()}`);
            }
        }
        if (count(ORANGE_MAIL) < 1 && count(ORANGE_DYE) > 0) {
            const dye = sdk.findInventoryItem(ORANGE_DYE);
            const mail = sdk.findInventoryItem(MAIL);
            if (dye && mail) {
                intent('Dye mail orange');
                await sdk.sendUseItemOnItem(dye.slot, mail.slot);
                await sdk.waitForTicks(2);
            }
        }
        if (count(BLUE_MAIL) < 1 && count(BLUE_DYE) > 0) {
            const dye = sdk.findInventoryItem(BLUE_DYE);
            const mail = sdk.findInventoryItem(MAIL);
            if (dye && mail) {
                intent('Dye mail blue');
                await sdk.sendUseItemOnItem(dye.slot, mail.slot);
                await sdk.waitForTicks(2);
            }
        }
        log(`mail after dye: orange=${count(ORANGE_MAIL)} blue=${count(BLUE_MAIL)} brown=${count(MAIL)}`);
    }

    async function handIn(): Promise<void> {
        intent('Goblin Village generals');
        await walkNear(GOBLIN_VILLAGE.x, GOBLIN_VILLAGE.z, 4);
        await eat();
        for (let i = 0; i < 6 && !questDone(); i++) {
            await eat();
            const wart = sdk.findNearbyNpc(/wartface/i) ?? sdk.findNearbyNpc(/bentnoze/i);
            if (!wart) {
                log(`no general @ ${pos().x},${pos().z}`);
                await walkNear(GOBLIN_VILLAGE.x, GOBLIN_VILLAGE.z, 3);
                continue;
            }
            await bot.talkTo(wart);
            const seen = await chat([
                /pick an armour colour/i,
                /do you want me to pick/i,
                /i have some orange armour/i,
                /i have some blue armour/i,
                /ok i'?ve got brown armour/i
            ]);
            log(`generals #${i}: ${seen.join(' | ') || '(none)'}`);
            await chat();
            await closeUi();
            if (questDone()) break;
        }
    }

    await bot.skipTutorial();
    await closeUi();
    log(`finish start @ ${pos().x},${pos().z} hp=${pos().hp} inv=${inv()}`);

    await mixAndDyeMail();
    await buyWoad();
    await eat();
    await dyeAtAggie(ONION, YELLOW_DYE, 'yellow');
    await dyeAtAggie(WOAD, BLUE_DYE, 'blue');
    await mixAndDyeMail();
    if (count(ORANGE_MAIL) < 1 || count(BLUE_MAIL) < 1 || count(MAIL) < 1) {
        throw new Error(`armour not ready @ ${pos().x},${pos().z} inv=${inv()}`);
    }
    await startBartender();
    await handIn();
    if (!questDone()) throw new Error(`Goblin Diplomacy unfinished @ ${pos().x},${pos().z} inv=${inv()}`);
    log('QUEST COMPLETE Goblin Diplomacy');
});
