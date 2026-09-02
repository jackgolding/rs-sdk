/**
 * Druidic Ritual — reusable.
 *
 *   bun bots/quests/druidic-ritual.ts {botname}
 *
 * Needs all four raw meats (beef, chicken, rat, bear). Dips them in the
 * Cauldron of Thunder in Taverley dungeon, then hands the enchanted meats
 * to Sanfew and finishes with Kaqemeex.
 */
import { appendFileSync } from 'fs';
import { join } from 'path';
import { runScript } from '../../sdk/runner';

const KAQEMEEX = { x: 2925, z: 3486 };
const SANFEW = { x: 2899, z: 3428 };
const DUNGEON = { x: 2884, z: 3397 };
const DUNGEON_UNDER = { x: 2884, z: 9798 };
const CAULDRON = { x: 2893, z: 9831 };
const PRISON = { x: 2888, z: 9830 };

const COW_FARM = { x: 3027, z: 3307 };
const CHICKEN_FARM = { x: 3015, z: 3287 };
const RATS = { x: 2995, z: 3191 };
const BEAR = { x: 2965, z: 3465 };

const EDGE_TO_CIRCLE = [
    { x: 3072, z: 3455 },
    { x: 3018, z: 3452 },
    { x: 2965, z: 3465 },
    KAQEMEEX
];
const TO_FARM = [{ x: 3060, z: 3315 }, COW_FARM];
const FARM_TO_RATS = [{ x: 3020, z: 3250 }, { x: 3010, z: 3210 }, RATS];
const RATS_TO_BEAR = [
    { x: 3012, z: 3230 },
    { x: 3012, z: 3275 },
    { x: 3008, z: 3355 },
    { x: 2964, z: 3435 },
    BEAR
];
const BEAR_TO_CIRCLE = [KAQEMEEX];
const CIRCLE_TO_SANFEW = [{ x: 2910, z: 3455 }, SANFEW];
const SANFEW_TO_DUNGEON = [{ x: 2890, z: 3410 }, DUNGEON];

const RAW_BEEF = /^raw beef$/i;
const RAW_CHICKEN = /^raw chicken$/i;
const RAW_RAT = /^raw rat meat$/i;
const RAW_BEAR = /^raw bear meat$/i;
const ENC_BEEF = /^enchanted beef$/i;
const ENC_CHICKEN = /^enchanted chicken$/i;
const ENC_RAT = /^enchanted rat$/i;
const ENC_BEAR = /^enchanted bear$/i;

const MEATS = [
    { raw: RAW_BEEF, enchanted: ENC_BEEF, npc: /^cow$/i, spot: COW_FARM, label: 'raw beef' },
    { raw: RAW_CHICKEN, enchanted: ENC_CHICKEN, npc: /^chicken$/i, spot: CHICKEN_FARM, label: 'raw chicken' },
    { raw: RAW_RAT, enchanted: ENC_RAT, npc: /^giant rat$/i, spot: RATS, label: 'raw rat meat' },
    { raw: RAW_BEAR, enchanted: ENC_BEAR, npc: /^bear$/i, spot: BEAR, label: 'raw bear meat' }
] as const;

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
            isDead: p?.isDead ?? false
        };
    }

    function distTo(x: number, z: number): number {
        return Math.hypot(pos().x - x, pos().z - z);
    }

    function count(pattern: RegExp): number {
        return sdk
            .getInventory()
            .filter((i) => pattern.test(i.name))
            .reduce((n, i) => n + (i.count ?? 1), 0);
    }

    function herbXp(): number {
        return sdk.getSkill('Herblore')?.experience ?? 0;
    }

    function questDone(): boolean {
        if (herbXp() >= 250) return true;
        const msgs = sdk.getState()?.gameMessages ?? [];
        return msgs.some((m) => /completed the.*druidic ritual/i.test(m.text));
    }

    function hasType(raw: RegExp, enchanted: RegExp): boolean {
        return count(raw) > 0 || count(enchanted) > 0;
    }

    function allRawOrEnchanted(): boolean {
        return MEATS.every((m) => hasType(m.raw, m.enchanted));
    }

    function allEnchanted(): boolean {
        return MEATS.every((m) => count(m.enchanted) > 0);
    }

    function underground(): boolean {
        return pos().z > 6400;
    }

    function inCauldronRoom(): boolean {
        const p = pos();
        return underground() && p.x >= 2889 && p.z >= 9826 && p.z <= 9836;
    }

    async function closeUi(): Promise<void> {
        for (let i = 0; i < 8; i++) {
            await bot.dismissBlockingUI();
            const dialog = sdk.getDialog();
            const opts = dialog?.options ?? [];
            if (dialog?.isOpen && opts.length === 1) {
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
            if (opts.length === 0) {
                await sdk.waitForTicks(1);
                continue;
            }
            if (opts.length === 1 || opts.every((o) => /click here to continue/i.test(o.text))) {
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

    async function openNearbyGate(): Promise<void> {
        const gate = (sdk.getNearbyLocs() ?? [])
            .filter(
                (l) =>
                    /gate|door/i.test(l.name) &&
                    l.reachable !== false &&
                    l.optionsWithIndex.some((o) => /^open$/i.test(o.text))
            )
            .sort((a, b) => (a.distance ?? 99) - (b.distance ?? 99))[0];
        if (!gate || (gate.distance ?? 99) > 6) return;
        await bot.openDoor(gate);
    }

    async function walkRoute(points: Array<{ x: number; z: number }>): Promise<void> {
        for (const p of points) {
            await closeUi();
            await openNearbyGate();
            await walkNear(p.x, p.z, 5);
        }
    }

    async function climbTo(targetLevel: number): Promise<boolean> {
        for (let i = 0; i < 8 && pos().level !== targetLevel; i++) {
            const wantUp = pos().level < targetLevel;
            const opt = wantUp ? /climb-up|climb.up|go-up|go.up/i : /climb-down|climb.down|go-down|go.down/i;
            await sdk.scanNearbyLocs(8).catch(() => {});
            const stairs = (sdk.getNearbyLocs() ?? [])
                .filter((l) => /stair|ladder/i.test(l.name) && l.optionsWithIndex.some((o) => opt.test(o.text)))
                .sort((a, b) => (a.distance ?? 99) - (b.distance ?? 99))[0];
            if (!stairs) {
                await walkNear(SANFEW.x, SANFEW.z, 2);
                await openNearbyGate();
                continue;
            }
            const before = pos().level;
            intent(`Climb ${wantUp ? 'up' : 'down'} ${stairs.name}`);
            await bot.interactLoc(stairs, opt);
            await sdk.waitForCondition((s) => (s.player?.level ?? before) !== before, 8_000).catch(() => {});
            await closeUi();
        }
        return pos().level === targetLevel;
    }

    async function openPrisonDoor(): Promise<void> {
        await sdk.scanNearbyLocs(8).catch(() => {});
        const door = sdk.findNearbyLoc(/^prison door$/i) ?? sdk.findNearbyLoc(/prison door/i);
        if (!door) return;
        intent('Opening prison door');
        await bot.interactLoc(door, /open/i);
        await sdk.waitForTicks(2);
    }

    async function climbDungeon(down: boolean): Promise<boolean> {
        const wantUnder = down;
        for (let i = 0; i < 8 && underground() !== wantUnder; i++) {
            if (!underground()) {
                await walkNear(DUNGEON.x, DUNGEON.z, 2);
            } else {
                if (inCauldronRoom()) {
                    await openPrisonDoor();
                    await walkNear(2878, 9828, 3);
                }
                await walkNear(DUNGEON_UNDER.x, DUNGEON_UNDER.z, 2);
            }
            await sdk.scanNearbyLocs(8).catch(() => {});
            const opt = down ? /climb-down|climb.down/i : /climb-up|climb.up/i;
            const ladder = (sdk.getNearbyLocs() ?? [])
                .filter((l) => /ladder/i.test(l.name) && l.optionsWithIndex.some((o) => opt.test(o.text)))
                .sort((a, b) => (a.distance ?? 99) - (b.distance ?? 99))[0];
            if (!ladder) {
                log(`No dungeon ladder @ ${pos().x},${pos().z} under=${underground()}`);
                continue;
            }
            intent(`${down ? 'Entering' : 'Leaving'} Taverley dungeon`);
            const beforeZ = pos().z;
            await bot.interactLoc(ladder, opt);
            await sdk
                .waitForCondition((s) => Math.abs((s.player?.worldZ ?? beforeZ) - beforeZ) > 8, 8_000)
                .catch(() => {});
            await closeUi();
        }
        return underground() === wantUnder;
    }

    async function lootMeat(pattern: RegExp): Promise<boolean> {
        const ground = sdk.findGroundItem(pattern);
        if (!ground) return count(pattern) > 0;
        const r = await bot.pickupItem(ground);
        if (!r.success) log(`pickup: ${r.message}`);
        return count(pattern) > 0;
    }

    async function hunt(npcPat: RegExp, meat: RegExp, spot: { x: number; z: number }, label: string): Promise<void> {
        if (count(meat) > 0) return;
        for (let attempt = 0; attempt < 8 && count(meat) < 1; attempt++) {
            await closeUi();
            if (await lootMeat(meat)) return;
            if (distTo(spot.x, spot.z) > 12) {
                intent(`Walking to ${label}`);
                await walkNear(spot.x, spot.z, 5);
                await openNearbyGate();
            }
            if (await lootMeat(meat)) return;
            const npc = sdk.findNearbyNpc(npcPat, { reachable: true });
            if (!npc) {
                log(`No ${label} npc @ ${pos().x},${pos().z} try=${attempt}`);
                await walkNear(spot.x + ((attempt % 3) - 1) * 6, spot.z + (attempt % 2 === 0 ? 4 : -4), 3);
                continue;
            }
            intent(`Killing ${npc.name} for ${label}`);
            const atk = await bot.attack(npc, 15_000);
            if (!atk.success) log(`attack ${npc.name}: ${atk.message}`);
            await sdk.waitForCondition(() => !!sdk.findGroundItem(meat), 12_000).catch(() => null);
            await lootMeat(meat);
        }
        if (count(meat) < 1) log(`Still missing ${label} @ ${pos().x},${pos().z}`);
    }

    async function gatherMeats(): Promise<void> {
        if (allRawOrEnchanted()) return;
        if (!hasType(RAW_BEEF, ENC_BEEF) || !hasType(RAW_CHICKEN, ENC_CHICKEN)) {
            if (distTo(COW_FARM.x, COW_FARM.z) > 40) await walkRoute(TO_FARM);
        }
        if (!hasType(RAW_BEEF, ENC_BEEF)) await hunt(/^cow$/i, RAW_BEEF, COW_FARM, 'raw beef');
        if (!hasType(RAW_CHICKEN, ENC_CHICKEN)) await hunt(/^chicken$/i, RAW_CHICKEN, CHICKEN_FARM, 'raw chicken');
        if (!hasType(RAW_RAT, ENC_RAT)) {
            if (distTo(RATS.x, RATS.z) > 20) await walkRoute(FARM_TO_RATS);
            await hunt(/^giant rat$/i, RAW_RAT, RATS, 'raw rat meat');
        }
        if (!hasType(RAW_BEAR, ENC_BEAR)) {
            if (distTo(BEAR.x, BEAR.z) > 20) await walkRoute(RATS_TO_BEAR);
            await hunt(/^bear$/i, RAW_BEAR, BEAR, 'raw bear meat');
        }
        log(
            `meats beef=${count(RAW_BEEF)} chicken=${count(RAW_CHICKEN)} rat=${count(RAW_RAT)} bear=${count(RAW_BEAR)} @ ${pos().x},${pos().z}`
        );
    }

    async function goKaqemeex(): Promise<void> {
        await closeUi();
        if (pos().level > 0) await climbTo(0);
        if (underground()) await climbDungeon(false);
        if (distTo(KAQEMEEX.x, KAQEMEEX.z) <= 10) return;
        intent('Walking to Kaqemeex');
        if (pos().x > 3000 || pos().z > 3500) await walkRoute(EDGE_TO_CIRCLE);
        else if (pos().z < 3400 && !underground()) await walkRoute(RATS_TO_BEAR);
        if (distTo(KAQEMEEX.x, KAQEMEEX.z) > 12) await walkRoute(BEAR_TO_CIRCLE);
        await walkNear(KAQEMEEX.x, KAQEMEEX.z, 4);
    }

    async function talkKaqemeex(): Promise<string[]> {
        await goKaqemeex();
        const npc = sdk.findNearbyNpc(/^kaqemeex$/i) ?? sdk.findNearbyNpc(/kaqemeex/i);
        if (!npc) {
            log(`Kaqemeex missing @ ${pos().x},${pos().z}`);
            return [];
        }
        const talk = await bot.talkTo(npc);
        if (!talk.success) {
            log(`talk Kaqemeex: ${talk.message}`);
            return [];
        }
        await sdk.waitForTicks(1);
        return chat([
            /search of a quest/i,
            /what about the stone circle/i,
            /ok, i will try and help/i,
            /ok, i will try to help/i,
            /ok, i will try and help/i,
            /is there anything in this for me/i
        ]);
    }

    async function goSanfew(): Promise<void> {
        await closeUi();
        if (underground()) await climbDungeon(false);
        if (distTo(SANFEW.x, SANFEW.z) <= 12 && pos().level === 1) return;
        intent('Walking to Sanfew');
        if (pos().level > 0 && distTo(SANFEW.x, SANFEW.z) > 20) await climbTo(0);
        if (distTo(SANFEW.x, SANFEW.z) > 12) {
            if (distTo(KAQEMEEX.x, KAQEMEEX.z) < 30) await walkRoute(CIRCLE_TO_SANFEW);
            else await walkNear(SANFEW.x, SANFEW.z, 3);
        }
        await openNearbyGate();
        await walkNear(SANFEW.x, SANFEW.z, 3);
        if (pos().level !== 1) await climbTo(1);
        await walkNear(SANFEW.x, SANFEW.z, 3);
    }

    async function talkSanfew(): Promise<string[]> {
        await goSanfew();
        const npc = sdk.findNearbyNpc(/^sanfew$/i) ?? sdk.findNearbyNpc(/sanfew/i);
        if (!npc) {
            log(`Sanfew missing @ ${pos().x},${pos().z} floor=${pos().level}`);
            return [];
        }
        const talk = await bot.talkTo(npc);
        if (!talk.success) {
            log(`talk Sanfew: ${talk.message}`);
            return [];
        }
        await sdk.waitForTicks(1);
        return chat([
            /sent to help purify/i,
            /sent to help purify/i,
            /ok, i['’]?ll do that then/i,
            /i['’]?ll get on with it then/i,
            /i['’]?ll do that then/i
        ]);
    }

    async function killSuits(): Promise<void> {
        for (let i = 0; i < 4; i++) {
            const suit =
                sdk.findNearbyNpc(/^suit of armour$/i, { reachable: true }) ??
                sdk.findNearbyNpc(/suit of armour/i);
            if (!suit) return;
            intent(`Killing ${suit.name}`);
            await bot.attack(suit, 15_000);
            await sdk.waitForCondition(() => !sdk.findNearbyNpc(/^suit of armour$/i), 12_000).catch(() => null);
            await sdk.waitForTicks(1);
        }
    }

    async function enterPrison(): Promise<boolean> {
        for (let i = 0; i < 8; i++) {
            if (allEnchanted() || inCauldronRoom()) return inCauldronRoom();
            await walkNear(PRISON.x, PRISON.z, 2);
            await killSuits();
            const door = sdk.findNearbyLoc(/^prison door$/i) ?? sdk.findNearbyLoc(/prison door/i);
            if (!door) {
                log(`No prison door @ ${pos().x},${pos().z}`);
                continue;
            }
            intent('Opening prison door');
            await bot.interactLoc(door, /open/i);
            await sdk.waitForTicks(2);
            await killSuits();
        }
        return inCauldronRoom();
    }

    async function dipMeats(): Promise<void> {
        if (allEnchanted()) return;
        intent('Going to the Cauldron of Thunder');
        if (!underground()) {
            if (pos().level > 0) await climbTo(0);
            if (distTo(DUNGEON.x, DUNGEON.z) > 8) await walkRoute(SANFEW_TO_DUNGEON);
            if (!(await climbDungeon(true))) {
                log(`Failed to enter dungeon @ ${pos().x},${pos().z}`);
                return;
            }
        }
        await walkNear(PRISON.x, PRISON.z, 3);
        if (!(await enterPrison())) {
            log(`Could not pass prison door @ ${pos().x},${pos().z}`);
            return;
        }
        await walkNear(CAULDRON.x, CAULDRON.z, 2);
        for (const m of MEATS) {
            if (count(m.enchanted) > 0 || count(m.raw) < 1) continue;
            const pot =
                sdk.findNearbyLoc(/^cauldron of thunder$/i) ?? sdk.findNearbyLoc(/cauldron of thunder/i);
            if (!pot) {
                log(`No cauldron @ ${pos().x},${pos().z}`);
                break;
            }
            intent(`Dipping ${m.label}`);
            const before = count(m.enchanted);
            const r = await bot.useItemOnLoc(m.raw, pot);
            if (!r.success) log(`dip ${m.label}: ${r.message}`);
            await sdk.waitForCondition(() => count(m.enchanted) > before, 8_000).catch(() => null);
        }
        log(
            `enchanted beef=${count(ENC_BEEF)} chicken=${count(ENC_CHICKEN)} rat=${count(ENC_RAT)} bear=${count(ENC_BEAR)}`
        );
    }

    const startXp = herbXp();
    log(
        `Druidic Ritual start @ ${pos().x},${pos().z} floor=${pos().level} herbXp=${startXp} gp=${count(/^coins$/i)}`
    );
    await closeUi();

    const until = Date.now() + 20 * 60_000;
    while (Date.now() < until && !questDone()) {
        await closeUi();
        if (pos().isDead) {
            await sdk.waitForTicks(3);
            continue;
        }

        if (allEnchanted()) {
            const seen = (await talkSanfew()).join(' | ');
            log(`Sanfew: ${seen || '(no dialog)'}`);
            await chat();
            await closeUi();
            if (questDone()) break;
        }

        if (!allRawOrEnchanted()) {
            const fin = (await talkKaqemeex()).join(' | ');
            log(`Kaqemeex: ${fin || '(no dialog)'}`);
            await chat();
            await closeUi();
            if (questDone()) break;
            await gatherMeats();
            continue;
        }

        const startSeen = (await talkKaqemeex()).join(' | ');
        log(`Kaqemeex: ${startSeen || '(no dialog)'}`);
        await chat();
        await closeUi();
        if (questDone()) break;

        const san = (await talkSanfew()).join(' | ');
        log(`Sanfew: ${san || '(no dialog)'}`);
        await chat();
        await closeUi();
        if (questDone()) break;

        await dipMeats();
    }

    if (questDone()) log(`Druidic Ritual complete herbloreXp=${herbXp()} (+${herbXp() - startXp})`);
    else throw new Error(`Quest unfinished @ ${pos().x},${pos().z} herbXp=${herbXp()}`);
});
