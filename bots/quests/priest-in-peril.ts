/**
 * Priest in Peril — reusable.
 *
 *   bun bots/quests/priest-in-peril.ts {botname}
 *
 * King Roald → temple → mausoleum dog → Roald → monk (golden key) → Drezel
 * → monument swap (iron key) → blessed water on coffin → 50 rune essence.
 *
 * Needs Rune Mysteries complete (for essence access). Bring combat gear + food;
 * the script withdraws food, a bucket, and banked essence when possible.
 */
import { appendFileSync } from 'fs';
import { join } from 'path';
import { runScript } from '../../sdk/runner';
import {
    ensureCoins,
    ensureItem,
    SHOPS,
    withdrawFromBank,
    type SupplyCtx
} from './quest-supplies';

const KING_ROALD = { x: 3216, z: 3472 };
const CASTLE_STAIRS = { x: 3205, z: 3208 };
const TEMPLE_DOOR = { x: 3405, z: 3507 };
const MAUSOLEUM_TRAP = { x: 3405, z: 3506 };
const DOG_PIT = { x: 3405, z: 9902 };
const DREZEL_CELL = { x: 3417, z: 3489 };
const TEMPLE_INTERIOR = { x: 3410, z: 3484 };
const MAUSOLEUM_DREZEL = { x: 3440, z: 9895 };

const TO_TEMPLE = [
    { x: 3255, z: 3455 },
    { x: 3320, z: 3480 },
    { x: 3370, z: 3500 },
    TEMPLE_DOOR
];
const TO_ROALD = [
    { x: 3370, z: 3500 },
    { x: 3320, z: 3480 },
    { x: 3255, z: 3455 },
    { x: 3210, z: 3470 },
    KING_ROALD
];

const GOLD_KEY = /^golden key$/i;
const IRON_KEY = /^iron key$/i;
const BUCKET_EMPTY = /^bucket$/i;
const BUCKET_WATER = /^bucket of water$/i; // murky and blessed share the same name
const ESSENCE = /^(rune essence|pure essence)$/i;
const WOLFBANE = /^wolfbane$/i;
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
    let sawBlessedWater = false;
    let sawCoffinPour = false;
    let sawDogKill = false;

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

    function prayerXp(): number {
        return sdk.getSkill('Prayer')?.experience ?? 0;
    }

    function underground(): boolean {
        return pos().z > 6400;
    }

    function inTemple(): boolean {
        const p = pos();
        return p.x >= 3395 && p.x <= 3435 && p.z >= 3478 && p.z <= 3515 && p.z < 6400;
    }

    function inMausoleum(): boolean {
        const p = pos();
        return underground() && p.x >= 3388 && p.x <= 3460 && p.z >= 9880 && p.z <= 9920;
    }

    function messages(): string {
        const msgs = sdk.getState()?.gameMessages ?? [];
        const chat = sdk.getChat({ limit: 60, types: [0] }).map((m) => m.text);
        return [...msgs.map((m) => m.text), ...chat].join('\n');
    }

    function questDone(xpBefore: number): boolean {
        if (count(WOLFBANE) > 0 && prayerXp() >= xpBefore + 10_000) return true;
        return /completed the[\s\S]{0,80}priest in peril/i.test(messages());
    }

    function dogKilled(): boolean {
        if (sawDogKill) return true;
        if (/killed that dog|great job you did buddy|feeble intellect/i.test(messages())) sawDogKill = true;
        return sawDogKill;
    }

    function kingSentBack(): boolean {
        return /high treason|safeguard my kingdom|border with morytania is secure/i.test(messages());
    }

    function drezelFreed(): boolean {
        return /thank you.*found the key|key fitted the lock|unlocked the cell/i.test(messages());
    }

    function coffinDone(): boolean {
        if (sawCoffinPour) return true;
        if (/pour the blessed water|trapped him in there/i.test(messages())) sawCoffinPour = true;
        return sawCoffinPour;
    }

    function essencePhase(): boolean {
        return /fifty rune essence|bring me fifty|damage done by those zamorakians/i.test(messages());
    }

    async function closeUi(): Promise<void> {
        for (let i = 0; i < 10; i++) {
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

    async function chat(choices: RegExp[] = [], max = 40): Promise<string[]> {
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

    async function walkRoute(points: Array<{ x: number; z: number }>): Promise<void> {
        for (const p of points) await walkNear(p.x, p.z, 4);
    }

    async function climbTo(targetLevel: number): Promise<boolean> {
        for (let i = 0; i < 10 && pos().level !== targetLevel; i++) {
            const wantUp = pos().level < targetLevel;
            const opt = wantUp ? /climb-up|climb.up|go-up|go.up|up/i : /climb-down|climb.down|go-down|go.down|down/i;
            await sdk.scanNearbyLocs(12).catch(() => {});
            const stairs = (sdk.getNearbyLocs() ?? [])
                .filter((l) => /stair|ladder|trapdoor/i.test(l.name) && l.optionsWithIndex.some((o) => opt.test(o.text)))
                .sort((a, b) => (a.distance ?? 99) - (b.distance ?? 99))[0];
            if (!stairs) return false;
            const before = pos().level;
            await bot.interactLoc(stairs, opt);
            await sdk.waitForCondition((s) => (s.player?.level ?? before) !== before, 10_000).catch(() => {});
            await closeUi();
        }
        return pos().level === targetLevel;
    }

    async function eatIfNeeded(): Promise<void> {
        if (pos().hp >= pos().maxHp - 5) return;
        const food = sdk.findInventoryItem(FOOD);
        if (food) await bot.eatFood(food);
    }

    async function waitCombat(): Promise<void> {
        for (let i = 0; i < 30 && sdk.getState()?.player?.combat?.inCombat; i++) {
            await eatIfNeeded();
            await sdk.waitForTicks(1);
        }
    }

    const supplyCtx = (): SupplyCtx => ({ bot, sdk, log, intent, walkNear, closeUi });

    async function ensureSupplies(): Promise<void> {
        const ctx = supplyCtx();
        await ensureCoins(ctx, 50);
        await withdrawFromBank(ctx, FOOD, 10, SHOPS.VARROCK_EAST_BANK);
        // No food purchase: this quest needs none. Food buying is retained only
        // for death-plateau.ts (and any future holy-grail script), which really
        // do need it. The bank withdrawal above still takes what is banked.
        await ensureItem(ctx, BUCKET_EMPTY, 1, {
            label: 'bucket',
            shop: SHOPS.VARROCK_GEN,
            coinsNeeded: 5
        });
        if (count(ESSENCE) < 50) {
            await withdrawFromBank(ctx, ESSENCE, 50, SHOPS.VARROCK_EAST_BANK);
        }
    }

    async function talkKingRoald(): Promise<void> {
        intent('Talking to King Roald');
        if (pos().level < 1) {
            await walkNear(CASTLE_STAIRS.x, CASTLE_STAIRS.z, 3);
            await climbTo(1);
        }
        await walkNear(KING_ROALD.x, KING_ROALD.z, 3);
// Settle-and-retry: climbing rebuilds the client scene and `nearbyNpcs` is
// EMPTY for the new level until it lands, so a single scan reads the NPC as
// missing while the bot is standing next to it.
        let roald = sdk.findNearbyNpc(/king roald/i);
        for (let t = 0; !roald && t < 40; t++) {
            await sdk.waitForTicks(4);
            roald = sdk.findNearbyNpc(/king roald/i);
        }
        if (!roald) {
            log('King Roald not found');
            return;
        }
        await bot.talkTo(roald);
        await chat([/looking for a quest/i, /^sure\.?$/i, /spoke to the guys at the temple/i, /okay.*going/i]);
        await chat();
    }

    async function knockTempleDoor(): Promise<void> {
        intent('Knocking on temple door');
        await walkRoute(TO_TEMPLE);
        await walkNear(TEMPLE_DOOR.x, TEMPLE_DOOR.z, 2);
        await sdk.scanNearbyLocs(8).catch(() => {});
        const door = (sdk.getNearbyLocs() ?? []).find((l) => /large door|door/i.test(l.name) && l.optionsWithIndex.some((o) => /knock/i.test(o.text)));
        if (!door) {
            log('Temple door not found');
            return;
        }
        await bot.interactLoc(door, /knock/i);
        await chat([
            /roald sent me/i,
            /^sure\.?$/i,
            /helpful person/i,
            /killed that dog/i,
            /what am i supposed to be doing/i
        ]);
        await chat();
    }

    async function openTempleDoor(): Promise<void> {
        await walkRoute(TO_TEMPLE);
        await walkNear(TEMPLE_DOOR.x, TEMPLE_DOOR.z, 2);
        await sdk.scanNearbyLocs(8).catch(() => {});
        const door = (sdk.getNearbyLocs() ?? []).find((l) => /large door|door/i.test(l.name) && l.optionsWithIndex.some((o) => /open/i.test(o.text)));
        if (door) {
            await bot.interactLoc(door, /open/i);
            await sdk.waitForTicks(2);
        }
    }

    async function enterMausoleum(): Promise<void> {
        if (inMausoleum()) return;
        intent('Entering mausoleum');
        await walkNear(MAUSOLEUM_TRAP.x, MAUSOLEUM_TRAP.z, 3);
        await sdk.scanNearbyLocs(10).catch(() => {});
        let trap = (sdk.getNearbyLocs() ?? []).find((l) => /trapdoor/i.test(l.name) && l.optionsWithIndex.some((o) => /open/i.test(o.text)));
        if (trap) {
            await bot.interactLoc(trap, /open/i);
            await sdk.waitForTicks(2);
        }
        trap = (sdk.getNearbyLocs() ?? []).find((l) => /trapdoor/i.test(l.name) && l.optionsWithIndex.some((o) => /climb-down|down/i.test(o.text)));
        if (trap) {
            await bot.interactLoc(trap, /climb-down|down/i);
            await sdk.waitForCondition(() => underground(), 12_000).catch(() => {});
        }
        if (!underground()) await walkNear(DOG_PIT.x, DOG_PIT.z, 6);
    }

    async function fightDog(): Promise<void> {
        await enterMausoleum();
        await eatIfNeeded();
        intent('Killing temple guardian dog');
        await walkNear(DOG_PIT.x, DOG_PIT.z, 4);
        let turns = 0;
        while (turns < 60 && !pos().isDead) {
            await eatIfNeeded();
            const dog = sdk.findNearbyNpc(/guard dog|temple guardian/i);
            if (!dog) {
                await sdk.waitForTicks(2);
                if (!sdk.findNearbyNpc(/guard dog|temple guardian/i)) {
                    sawDogKill = true;
                    break;
                }
            } else {
                const r = await bot.attack(dog, 10_000);
                if (!r.success && /no reason to attack|helpless dog/i.test(messages())) {
                    sawDogKill = true;
                    break;
                }
            }
            turns++;
        }
        await waitCombat();
    }

    async function fightMonk(): Promise<void> {
        if (!inTemple()) await openTempleDoor();
        await walkNear(TEMPLE_INTERIOR.x, TEMPLE_INTERIOR.z, 4);
        if (pos().level < 1) await climbTo(1);
        await eatIfNeeded();
        intent('Killing Monk of Zamorak for golden key');
        let turns = 0;
        while (turns < 80 && count(GOLD_KEY) < 1 && !pos().isDead) {
            await eatIfNeeded();
            const monk = sdk.findNearbyNpc(/monk of zamorak|zamorak/i);
            if (!monk) {
                await walkNear(TEMPLE_INTERIOR.x, TEMPLE_INTERIOR.z, 3);
                await sdk.waitForTicks(2);
            } else {
                await bot.attack(monk, 12_000);
                if (count(GOLD_KEY) > 0) break;
            }
            turns++;
        }
        await waitCombat();
        if (count(GOLD_KEY) < 1) {
            const ground = sdk.findGroundItem(GOLD_KEY);
            if (ground) await bot.pickupItem(ground);
        }
    }

    async function talkDrezelCell(): Promise<void> {
        intent('Talking to Drezel in the cell');
        if (!inTemple()) await openTempleDoor();
        await walkNear(DREZEL_CELL.x, DREZEL_CELL.z, 3);
        if (pos().level < 2) await climbTo(2);
// Settle-and-retry: climbing rebuilds the client scene and `nearbyNpcs` is
// EMPTY for the new level until it lands, so a single scan reads the NPC as
// missing while the bot is standing next to it.
        let drezel = sdk.findNearbyNpc(/^drezel$/i);
        for (let t = 0; !drezel && t < 40; t++) {
            await sdk.waitForTicks(4);
            drezel = sdk.findNearbyNpc(/^drezel$/i);
        }
        if (!drezel) {
            log('Drezel not found upstairs');
            return;
        }
        await bot.talkTo(drezel);
        await chat([/tell me anyway/i, /^yes\.?$/i, /yes, of course/i]);
        await chat();
    }

    async function swapForIronKey(): Promise<void> {
        if (count(IRON_KEY) > 0) return;
        if (count(GOLD_KEY) < 1) return;
        intent('Swapping golden key for iron key at monument');
        if (!inMausoleum()) await enterMausoleum();
        await sdk.scanNearbyLocs(20).catch(() => {});
        const monuments = (sdk.getNearbyLocs() ?? []).filter((l) => /monument/i.test(l.name));
        for (const mon of monuments) {
            const before = count(IRON_KEY);
            const r = await bot.useItemOnLoc(GOLD_KEY, mon);
            if (count(IRON_KEY) > before) {
                log('Got iron key from monument');
                return;
            }
            if (!r.success) log(`monument use: ${r.message}`);
        }
    }

    async function unlockDrezel(): Promise<void> {
        if (count(IRON_KEY) < 1) return;
        intent('Unlocking Drezel\'s cell');
        if (!inTemple()) await openTempleDoor();
        await walkNear(DREZEL_CELL.x, DREZEL_CELL.z, 2);
        if (pos().level < 2) await climbTo(2);
        await sdk.scanNearbyLocs(10).catch(() => {});
        const door = (sdk.getNearbyLocs() ?? []).find((l) => /door|gate/i.test(l.name) && l.distance !== undefined && l.distance <= 6);
        if (door) {
            await bot.useItemOnLoc(IRON_KEY, door);
            await sdk.waitForTicks(3);
        }
        const drezel = sdk.findNearbyNpc(/^drezel$/i);
        if (drezel) {
            await bot.talkTo(drezel);
            await chat();
        }
    }

    async function fillAndBlessWater(): Promise<void> {
        if (/blesses the water/i.test(messages())) sawBlessedWater = true;
        if (sawBlessedWater) return;

        if (count(BUCKET_EMPTY) < 1 && count(BUCKET_WATER) < 1) {
            await ensureSupplies();
        }

        if (count(BUCKET_WATER) < 1 && count(BUCKET_EMPTY) > 0) {
            intent('Filling bucket at Salve well');
            if (!inTemple()) await openTempleDoor();
            if (pos().level < 2) await climbTo(2);
            await sdk.scanNearbyLocs(12).catch(() => {});
            const well = (sdk.getNearbyLocs() ?? []).find((l) => /^well$/i.test(l.name));
            if (well) {
                await bot.useItemOnLoc(BUCKET_EMPTY, well);
                await sdk.waitForTicks(3);
            }
        }

        if (count(BUCKET_WATER) > 0) {
            intent('Getting Drezel to bless the water');
            const drezel = sdk.findNearbyNpc(/^drezel$/i);
            if (drezel) {
                await bot.useItemOnNpc(BUCKET_WATER, drezel);
                await sdk.waitForTicks(2);
                if (/blesses the water/i.test(messages())) sawBlessedWater = true;
            }
        }
    }

    async function pourOnCoffin(): Promise<void> {
        if (coffinDone()) return;
        intent('Pouring blessed water on vampire coffin');
        if (!inTemple()) await openTempleDoor();
        if (pos().level < 2) await climbTo(2);
        await sdk.scanNearbyLocs(12).catch(() => {});
        const coffin = sdk.findNearbyLoc(/^coffin$/i);
        const water = sdk.findInventoryItem(/bucket/i);
        if (coffin && water && sawBlessedWater) {
            await bot.useItemOnLoc(water, coffin);
            await sdk.waitForTicks(3);
            if (/pour the blessed water/i.test(messages())) sawCoffinPour = true;
        }
        const drezel = sdk.findNearbyNpc(/^drezel$/i);
        if (drezel && coffinDone()) {
            await bot.talkTo(drezel);
            await chat();
        }
    }

    async function talkMausoleumDrezel(): Promise<void> {
        intent('Meeting Drezel in the mausoleum');
        if (!inMausoleum()) await enterMausoleum();
        await walkNear(MAUSOLEUM_DREZEL.x, MAUSOLEUM_DREZEL.z, 4);
        const drezel = sdk.findNearbyNpc(/^drezel$/i);
        if (!drezel) {
            log('Drezel not in mausoleum');
            return;
        }
        await bot.talkTo(drezel);
        await chat();
    }

    async function giveEssence(): Promise<void> {
        if (count(ESSENCE) < 1) {
            await ensureSupplies();
        }
        if (count(ESSENCE) < 1) {
            log('Need 50 unnoted rune essence in bank');
            return;
        }
        intent('Giving rune essence to Drezel');
        if (!inMausoleum()) await enterMausoleum();
        await walkNear(MAUSOLEUM_DREZEL.x, MAUSOLEUM_DREZEL.z, 4);
        const drezel = sdk.findNearbyNpc(/^drezel$/i);
        if (!drezel) return;
        while (count(ESSENCE) > 0 && !questDone(prayerXp())) {
            await bot.useItemOnNpc(ESSENCE, drezel);
            await sdk.waitForTicks(2);
            if (questDone(prayerXp())) break;
        }
        if (!questDone(prayerXp())) {
            await bot.talkTo(drezel);
            await chat([/brought you some rune essence/i]);
        }
    }

    const xpBefore = prayerXp();
    await bot.skipTutorial();
    await closeUi();
    await ensureSupplies();
    log(`Priest in Peril start Prayer xp=${xpBefore} @ ${pos().x},${pos().z}`);

    const until = Date.now() + 25 * 60_000;
    while (Date.now() < until && !questDone(xpBefore)) {
        await closeUi();
        if (pos().isDead) {
            await sdk.waitForCondition((s) => !s.player.isDead, 45_000).catch(() => {});
            continue;
        }
        if (pos().hp < pos().maxHp - 6 && count(FOOD) < 3) await ensureSupplies();

        if (count(WOLFBANE) > 0 || questDone(xpBefore)) break;

        if (essencePhase() || (coffinDone() && count(ESSENCE) > 0)) {
            await giveEssence();
            continue;
        }

        if (coffinDone()) {
            await talkMausoleumDrezel();
            await giveEssence();
            continue;
        }

        if (drezelFreed() || sawBlessedWater) {
            await fillAndBlessWater();
            await pourOnCoffin();
            continue;
        }

        if (count(IRON_KEY) > 0) {
            await unlockDrezel();
            await fillAndBlessWater();
            continue;
        }

        if (count(GOLD_KEY) > 0) {
            await swapForIronKey();
            if (count(IRON_KEY) > 0) continue;
            await talkDrezelCell();
            continue;
        }

        if (kingSentBack()) {
            await openTempleDoor();
            await fightMonk();
            if (count(GOLD_KEY) > 0) continue;
            await talkDrezelCell();
            continue;
        }

        if (dogKilled()) {
            if (!kingSentBack()) {
                await knockTempleDoor();
                await walkRoute(TO_ROALD);
                await talkKingRoald();
            }
            continue;
        }

        if (/horrible big dog|mausoleum out there|okey-dokey/i.test(messages())) {
            await fightDog();
            continue;
        }

        if (/temple east of here|check on drezel|many thanks adventurer/i.test(messages())) {
            await knockTempleDoor();
            continue;
        }

        if (inTemple() || underground()) {
            await knockTempleDoor();
            continue;
        }

        await talkKingRoald();
        log(`inv gold=${count(GOLD_KEY)} iron=${count(IRON_KEY)} ess=${count(ESSENCE)} @ ${pos().x},${pos().z} L${pos().level}`);
        await sdk.waitForTicks(2);
    }

    if (!questDone(xpBefore)) {
        throw new Error(`Priest in Peril unfinished @ ${pos().x},${pos().z} prayerXp=${prayerXp()}`);
    }
    log(`QUEST COMPLETE Priest in Peril (+${prayerXp() - xpBefore} Prayer xp)`);
});
