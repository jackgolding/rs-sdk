/**
 * Vampire Slayer — reusable.
 *
 *   bun bots/quests/vampire-slayer.ts {botname}
 *
 * Morgan → garlic → Dr Harlow + beer → stake/hammer → Draynor Manor crypt → Count Draynor.
 * Avoids trapping via the one-way front door on exit (east wing route).
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

const MORGAN = { x: 3098, z: 3268 };
const GARLIC_CUPBOARD = { x: 3096, z: 3268 };
const HARLOW = { x: 3277, z: 3492 };
const MANOR_DOOR = { x: 3108, z: 3355 };
const MANOR_STAIRS = { x: 3115, z: 3357 };
const CRYPT = { x: 3077, z: 9771 };
const ESCAPE_DOOR_1 = { x: 3119, z: 3356 };
const ESCAPE_DOOR_2 = { x: 3123, z: 3360 };
const JOLLY_BOAR = { x: 3277, z: 3490 };

const GARLIC = /^garlic$/i;
const BEER = /^beer$/i;
const STAKE = /^stake$/i;
const HAMMER = /^hammer$/i;
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

    function attackXp(): number {
        return sdk.getSkill('Attack')?.experience ?? 0;
    }

    function inCrypt(): boolean {
        return pos().z > 6400;
    }

    function inManor(): boolean {
        const p = pos();
        return p.x >= 3088 && p.x <= 3130 && p.z >= 3348 && p.z <= 3380 && p.z < 6400;
    }

    function questDone(xpBefore: number): boolean {
        if (attackXp() >= xpBefore + 4000) return true;
        const msgs = sdk.getState()?.gameMessages ?? [];
        return msgs.some((m) => /completed the.*vampire slayer/i.test(m.text));
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

    async function chat(choices: RegExp[] = [], max = 32): Promise<string[]> {
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
            await sdk.scanNearbyLocs(10).catch(() => {});
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
        if (pos().hp >= pos().maxHp - 4) return;
        const food = sdk.findInventoryItem(FOOD);
        if (food) await bot.eatFood(food);
    }

    async function startMorgan(): Promise<void> {
        intent('Talking to Morgan');
        await walkNear(MORGAN.x, MORGAN.z, 3);
        if (pos().level < 1) await climbTo(1);
        const morgan = sdk.findNearbyNpc(/^morgan$/i);
        if (!morgan) return;
        await bot.talkTo(morgan);
        const seen = await chat([/up for an adventure/i, /tips on killing/i]);
        log(`Morgan: ${seen.join(' | ')}`);
        await chat([/up for an adventure/i]);
    }

    async function getGarlic(): Promise<void> {
        if (count(GARLIC) > 0) return;
        intent('Searching Morgan\'s cupboard for garlic');
        await walkNear(MORGAN.x, MORGAN.z, 3);
        if (pos().level < 1) await climbTo(1);
        await walkNear(GARLIC_CUPBOARD.x, GARLIC_CUPBOARD.z, 2);
        await sdk.scanNearbyLocs(6).catch(() => {});
        const cupboard = (sdk.getNearbyLocs() ?? []).find((l) => /cupboard/i.test(l.name));
        if (!cupboard) {
            log('No cupboard for garlic');
            return;
        }
        await bot.interactLoc(cupboard, /search|open/i);
        await sdk.waitForTicks(2);
        if (pos().level > 0) await climbTo(0);
    }

    const supplyCtx = (): SupplyCtx => ({ bot, sdk, log, intent, walkNear, closeUi });

    async function ensureSupplies(): Promise<void> {
        const ctx = supplyCtx();
        await ensureCoins(ctx, 20);
        await withdrawFromBank(ctx, FOOD, 8, SHOPS.DRAYNOR_BANK);
        if (count(FOOD) < 5) {
            await buyAtShop(ctx, SHOPS.WYDIN, [
                { pattern: /^wine$/i, amount: 8, label: 'wine' },
                { pattern: /^bread$/i, amount: 5, label: 'bread' }
            ]);
        }
        await ensureItem(ctx, HAMMER, 1, {
            label: 'hammer',
            shop: SHOPS.VARROCK_GEN,
            coinsNeeded: 5
        });
        await ensureItem(ctx, BEER, 1, {
            label: 'beer',
            shop: { x: JOLLY_BOAR.x, z: JOLLY_BOAR.z, npc: /bartender|barmaid/i },
            coinsNeeded: 5
        });
    }

    async function harlowStake(): Promise<void> {
        if (count(STAKE) > 0 && count(HAMMER) > 0) return;
        await ensureSupplies();
        intent('Getting stake from Dr Harlow');
        await walkNear(HARLOW.x, HARLOW.z, 3);
        let harlow = sdk.findNearbyNpc(/harlow/i);
        if (!harlow) {
            await walkNear(JOLLY_BOAR.x, JOLLY_BOAR.z, 2);
            harlow = sdk.findNearbyNpc(/harlow/i);
        }
        if (!harlow) return;
        await bot.talkTo(harlow);
        await chat([/morgan needs your help/i]);
        await bot.talkTo(harlow);
        await chat([/here you go/i, /ok mate/i]);
        await chat();
    }

    async function enterCrypt(): Promise<void> {
        if (inCrypt()) return;
        intent('Entering Draynor Manor crypt');
        if (!inManor()) {
            await walkNear(MANOR_DOOR.x, MANOR_DOOR.z, 2);
            const door = sdk.findNearbyLoc(/door/i);
            if (door) await bot.openDoor(door);
            await walkNear(MANOR_STAIRS.x, MANOR_STAIRS.z, 2);
        }
        await sdk.scanNearbyLocs(10).catch(() => {});
        const down = (sdk.getNearbyLocs() ?? []).find(
            (l) => /stair|ladder/i.test(l.name) && l.optionsWithIndex.some((o) => /down/i.test(o.text))
        );
        if (down) {
            await bot.interactLoc(down, /down/i);
            await sdk.waitForCondition(() => inCrypt(), 12_000).catch(() => {});
        }
        if (!inCrypt()) await walkNear(CRYPT.x, CRYPT.z, 4);
    }

    async function fightVampire(): Promise<void> {
        await enterCrypt();
        await eatIfNeeded();
        intent('Opening coffin / fighting Count Draynor');
        await sdk.scanNearbyLocs(12).catch(() => {});
        const coffin = sdk.findNearbyLoc(/coffin/i);
        if (coffin) {
            await bot.interactLoc(coffin, /open|search/i);
            await sdk.waitForTicks(4);
        }
        let turns = 0;
        while (turns < 80 && !pos().isDead) {
            await eatIfNeeded();
            const count = sdk.findNearbyNpc(/count draynor|draynor/i);
            if (!count) {
                await sdk.waitForTicks(2);
                if (!sdk.findNearbyNpc(/count draynor|draynor/i)) break;
            } else {
                await bot.attack(count, 8_000);
            }
            turns++;
        }
    }

    async function escapeManorIfNeeded(): Promise<void> {
        if (!inManor() && !inCrypt()) return;
        if (inCrypt()) {
            await climbTo(0);
            await sdk.waitForCondition(() => !inCrypt(), 10_000).catch(() => {});
        }
        if (!inManor()) return;
        intent('Escaping manor via east wing');
        for (const door of [ESCAPE_DOOR_1, ESCAPE_DOOR_2]) {
            await walkNear(door.x, door.z - 1, 1);
            await sdk.sendWalk(door.x, door.z - 1, true);
            await sdk.waitForTicks(2);
            const loc = (sdk.getNearbyLocs() ?? []).find((l) => l.x === door.x && l.z === door.z);
            if (loc) {
                const open = loc.optionsWithIndex.find((o) => /open/i.test(o.text));
                if (open) await sdk.sendInteractLoc(loc.x, loc.z, loc.id, open.opIndex);
                await sdk.waitForTicks(2);
                await sdk.sendWalk(door.x, door.z + 1, true);
                await sdk.waitForTicks(2);
            }
        }
    }

    const xpBefore = attackXp();
    await bot.skipTutorial();
    await closeUi();
    await ensureSupplies();
    log(`Vampire Slayer start Attack xp=${xpBefore} @ ${pos().x},${pos().z}`);

    const until = Date.now() + 15 * 60_000;
    while (Date.now() < until && !questDone(xpBefore)) {
        await closeUi();
        if (pos().hp < pos().maxHp - 4 && count(FOOD) < 2) await ensureSupplies();
        if (pos().isDead) {
            await sdk.waitForCondition((s) => !s.player.isDead, 45_000).catch(() => {});
            continue;
        }

        if (count(STAKE) > 0 && count(GARLIC) > 0) {
            await fightVampire();
            await escapeManorIfNeeded();
            if (questDone(xpBefore)) break;
            continue;
        }

        if (count(STAKE) < 1) {
            await startMorgan();
            await getGarlic();
            await harlowStake();
            continue;
        }

        if (count(GARLIC) < 1) await getGarlic();

        log(`garlic=${count(GARLIC)} stake=${count(STAKE)} hammer=${count(HAMMER)} beer=${count(BEER)} @ ${pos().x},${pos().z}`);
        await sdk.waitForTicks(2);
    }

    if (!questDone(xpBefore)) throw new Error(`Vampire Slayer unfinished @ ${pos().x},${pos().z} xp=${attackXp()}`);
    log(`QUEST COMPLETE Vampire Slayer (+${attackXp() - xpBefore} Attack xp)`);
});
