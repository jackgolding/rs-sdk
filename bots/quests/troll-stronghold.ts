/**
 * Troll Stronghold — reusable.
 *
 *   bun bots/quests/troll-stronghold.ts {botname}
 *
 * Denulth → climbing boots (Tenzing) → plateau rocks → Dad → ice-path cave
 * → Trollheim → stronghold → Troll General (prison key) → prison → Twig/Berry
 * → Godric + Eadgar → Dunstan.
 */
import { join } from 'path';
import { runScript } from '../../sdk/runner';
import { appendGrindLog } from '../../sdk/grind-log';

const DENULTH = { x: 2896, z: 3528 };
const DUNSTAN = { x: 2919, z: 3574 };
const TENZING = { x: 2820, z: 3556 };
const STILE = { x: 2817, z: 3562 };
const GUILD_EAST = { x: 2916, z: 3522 };
const ROCKS = { x: 2856, z: 3612 };
const ARENA_IN = { x: 2897, z: 3618 };
const DAD = { x: 2911, z: 3612 };
const ARENA_OUT = { x: 2916, z: 3629 };
const PASS_SOUTH = { x: 2903, z: 3644 };
const PASS_NORTH_INSIDE = { x: 2906, z: 10036 };
const TROLLHEIM = { x: 2908, z: 3654 };
const STRONGHOLD_DOOR = { x: 2839, z: 3689 };
const GENERAL = { x: 2831, z: 10086 };
const STAIRS_L2_N = { x: 2843, z: 10108 };
const PRISON_DOOR = { x: 2848, z: 10107 };
const STAIRS_L1_N = { x: 2852, z: 10107 };
const TWIG = { x: 2832, z: 10079 };
const BERRY = { x: 2832, z: 10083 };
const GODRIC_DOOR = { x: 2832, z: 10078 };
const EADGAR_DOOR = { x: 2832, z: 10082 };
const BACK_EXIT = { x: 2823, z: 10048 };
const SECRET_OUT = { x: 2827, z: 3646 };

const TO_TENZING = [
    { x: 2876, z: 3546 },
    { x: 2850, z: 3556 },
    { x: 2823, z: 3555 }
];
const TO_PLATEAU = [
    { x: 2816, z: 3576 },
    { x: 2816, z: 3592 },
    { x: 2832, z: 3604 },
    { x: 2864, z: 3608 }
];
const TO_FALLY_BANK = [
    GUILD_EAST,
    { x: 2918, z: 3488 },
    { x: 2936, z: 3488 },
    { x: 2965, z: 3451 },
    { x: 2965, z: 3392 },
    { x: 3012, z: 3355 }
];

const COINS = /^coins$/i;
const BOOTS = /^climbing boots$/i;
const PRISON_KEY = /^prison key$/i;
const CELL1 = /^cell key 1$/i;
const CELL2 = /^cell key 2$/i;
const LAW_TALI = /^law talisman$/i;
const FOOD = /^(swordfish|lobster|tuna|shark|salmon|trout|bass)$/i;
const COMBAT_GEAR =
    /^(dragon longsword|dragonhide body|dragonhide chaps|dragon vambraces|amulet of glory|ring of wealth|cape of saradomin|rune (full helm|kiteshield|med helm))$/i;

const botName = process.argv.slice(2).find((a) => !a.startsWith('-')) ?? '';
const GRIND_LOG = join(process.cwd(), 'bots', botName, 'grind.log');

await runScript(async ({ bot, sdk }) => {
    const log = (msg: string) => {
        console.log(msg);
        appendGrindLog(GRIND_LOG, `${new Date().toISOString()} ${msg}`);
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

    function worn(pattern: RegExp): boolean {
        return sdk.getEquipment().some((i) => pattern.test(i.name) && (i.count ?? 0) > 0);
    }

    function occupied(): number {
        return sdk.getInventory().filter((i) => (i.count ?? 0) > 0).length;
    }

    function prayerPoints(): number {
        return sdk.getPrayerState()?.prayerPoints ?? 0;
    }

    function prayerBase(): number {
        return sdk.getSkill('Prayer')?.baseLevel ?? 0;
    }

    function messages(): string {
        const msgs = sdk.getState()?.gameMessages ?? [];
        const chatHist = sdk.getChat({ limit: 50, types: [0] }).map((m) => m.text);
        return [...msgs.map((m) => m.text), ...chatHist].join('\n');
    }

    function questDone(): boolean {
        if (count(LAW_TALI) > 0) return true;
        return /completed[\s\S]{0,40}troll stronghold|you have completed\s*troll stronghold/i.test(
            messages()
        );
    }

    function dadBeaten(): boolean {
        return /stop! you win|not hurt dad|don't need to fight him again/i.test(messages());
    }

    function godricFreed(): boolean {
        return /thank you, my friend|you unlock the cell door|has godric returned home/i.test(messages());
    }

    function inArena(): boolean {
        const p = pos();
        return p.z < 6400 && p.x >= 2897 && p.x <= 2924 && p.z >= 3598 && p.z <= 3628;
    }

    function inPassCave(): boolean {
        const p = pos();
        return p.x >= 2895 && p.x <= 2935 && p.z >= 10010 && p.z <= 10045;
    }

    function inStronghold(): boolean {
        const p = pos();
        return p.x >= 2815 && p.x <= 2870 && p.z >= 10045 && p.z <= 10120;
    }

    function inBurthorpe(): boolean {
        const p = pos();
        return p.z >= 3518 && p.z < 3590 && p.x >= 2860 && p.x <= 2945 && p.z < 6400;
    }

    function inTenzingYard(): boolean {
        const p = pos();
        return p.x >= 2822 && p.x <= 2825 && p.z >= 3553 && p.z <= 3557;
    }

    function isContinueDialog(): boolean {
        const dialog = sdk.getDialog();
        if (!dialog?.isOpen) return false;
        const opts = dialog.options ?? [];
        return opts.length === 0 || opts.every((o) => /click here to continue/i.test(o.text));
    }

    async function clickContinue(): Promise<void> {
        const dialog = sdk.getDialog();
        if (!dialog?.isOpen) return;
        if (dialog.isWaiting) return;
        const opts = dialog.options ?? [];
        const cont = opts.find((o) => /click here to continue/i.test(o.text));
        await sdk.sendClickDialog(cont?.index ?? 0);
        await sdk.waitForStateChange(2_000).catch(() => {});
    }

    async function closeUi(): Promise<void> {
        for (let i = 0; i < 12; i++) {
            await bot.dismissBlockingUI();
            const dadTalk = sdk
                .getDialog()
                ?.options?.some((o) => /i'll be going now|prepare to die/i.test(o.text));
            if (dadTalk) break;
            if (isContinueDialog()) {
                await clickContinue();
                await sdk.waitForTicks(1);
                continue;
            }
            const iface = sdk.getState()?.interface;
            if (sdk.getState()?.shop?.isOpen || sdk.getState()?.bank?.isOpen || iface?.isOpen) {
                await sdk.sendClickDialog(0).catch(() => {});
                await bot.closeInterface();
                await sdk.sendCloseModal().catch(() => {});
                await sdk.waitForTicks(1);
                continue;
            }
            break;
        }
    }

    async function chat(choices: RegExp[] = [], max = 48): Promise<string[]> {
        const seen: string[] = [];
        let idle = 0;
        for (let i = 0; i < max; i++) {
            const dialog = sdk.getDialog();
            if (!dialog?.isOpen) {
                idle++;
                const iface = sdk.getState()?.interface;
                if (iface?.isOpen) {
                    await bot.closeInterface();
                    await sdk.sendClickDialog(0).catch(() => {});
                    idle = 0;
                }
                if (idle >= 16) break;
                await sdk.waitForTicks(1);
                continue;
            }
            idle = 0;
            const d = sdk.getDialog();
            if (d?.isWaiting) {
                await sdk.waitForStateChange(2_000).catch(() => {});
                continue;
            }
            const opts = d?.options ?? [];
            for (const o of opts) seen.push(o.text);
            if (opts.length === 0 || opts.every((o) => /click here to continue/i.test(o.text))) {
                await clickContinue();
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

    async function hopTo(x: number, z: number, timeout = 8_000): Promise<void> {
        await sdk.sendWalk(x, z, true);
        await sdk.waitForCondition(() => distTo(x, z) <= 4, timeout).catch(() => {});
    }

    async function hopToward(x: number, z: number, step = 3): Promise<void> {
        let guard = 0;
        while (distTo(x, z) > 3 && guard++ < 50) {
            const p = pos();
            const dx = x - p.x;
            const dz = z - p.z;
            const d = Math.max(1, Math.hypot(dx, dz));
            const nx = Math.round(p.x + (dx / d) * Math.min(step, d));
            const nz = Math.round(p.z + (dz / d) * Math.min(step, d));
            await hopTo(nx, nz, 6_000);
            await eatIfNeeded();
        }
    }

    function inTrollheimOverworld(): boolean {
        return pos().z >= 3648 && pos().z < 6400 && pos().x >= 2800 && pos().x < 2940;
    }

    async function walkNear(x: number, z: number, tolerance = 4): Promise<boolean> {
        await closeUi();
        if (inTenzingYard() && !(x >= 2818 && x <= 2822 && z >= 3552 && z <= 3558)) {
            await sdk.scanNearbyLocs(8).catch(() => {});
            const gates = (sdk.getNearbyLocs() ?? []).filter(
                (l) =>
                    /gate/i.test(l.name) &&
                    l.x >= 2824 &&
                    l.x <= 2826 &&
                    l.optionsWithIndex.some((o) => /open/i.test(o.text))
            );
            for (const gate of gates) {
                const opt = gate.optionsWithIndex.find((o) => /open/i.test(o.text));
                await sdk.sendInteractLoc(gate.x, gate.z, gate.id, opt?.opIndex ?? 1);
                await sdk.waitForTicks(2);
            }
        }
        if (distTo(x, z) <= tolerance) return true;
        if (inTrollheimOverworld() || (z >= 3648 && z < 6400 && pos().z >= 3610 && pos().z < 6400)) {
            await hopToward(x, z);
            return distTo(x, z) <= tolerance + 2;
        }
        if (z >= 3518 && pos().z < 3516 && pos().x < 2914 && pos().z < 6400) {
            await bot.walkTo(GUILD_EAST.x, Math.max(pos().z, 3488), 5);
            await bot.walkTo(GUILD_EAST.x, GUILD_EAST.z, 4);
        }
        const r = await bot.walkTo(x, z, Math.min(tolerance, 3));
        return r.success || distTo(x, z) <= tolerance + 2;
    }

    async function walkPath(wps: Array<{ x: number; z: number }>, destTol = 6): Promise<boolean> {
        const dest = wps[wps.length - 1];
        if (!dest) return true;
        for (const wp of wps) {
            await eatIfNeeded();
            if (distTo(dest.x, dest.z) <= destTol) return true;
            const wpToDest = Math.hypot(wp.x - dest.x, wp.z - dest.z);
            if (wpToDest >= distTo(dest.x, dest.z) + 6) continue;
            await walkNear(wp.x, wp.z, 8);
        }
        return walkNear(dest.x, dest.z, destTol);
    }

    async function climbTo(targetLevel: number): Promise<boolean> {
        for (let i = 0; i < 8 && pos().level !== targetLevel; i++) {
            const wantUp = pos().level < targetLevel;
            const opt = wantUp ? /climb-up|climb.up/i : /climb-down|climb.down/i;
            await sdk.scanNearbyLocs(12).catch(() => {});
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

    async function eatIfNeeded(floor = 55): Promise<void> {
        if (pos().isDead) return;
        if (pos().hp >= Math.min(floor, pos().maxHp - 8)) return;
        const food = sdk.findInventoryItem(FOOD);
        if (!food) return;
        intent(`Eating ${food.name} at ${pos().hp}/${pos().maxHp}`);
        await bot.eatFood(food);
    }

    async function meleeOn(): Promise<void> {
        if (prayerBase() < 43 || prayerPoints() <= 0) return;
        if (sdk.isPrayerActive('protect_from_melee')) return;
        const r = await bot.activatePrayer('protect_from_melee');
        if (r.success) log(`Protect from melee on (${prayerPoints()}/${prayerBase()})`);
    }

    async function meleeOff(): Promise<void> {
        if (!sdk.isPrayerActive('protect_from_melee')) return;
        await bot.deactivatePrayer('protect_from_melee');
    }

    async function missilesOn(): Promise<void> {
        if (prayerBase() < 40 || prayerPoints() <= 0) return;
        if (sdk.isPrayerActive('protect_from_missiles')) return;
        await bot.activatePrayer('protect_from_missiles');
    }

    async function talk(npcPat: RegExp, choices: RegExp[] = []): Promise<string[]> {
        await closeUi();
        // Denulth sits next to dummy training and is often flagged in-combat.
        if (!/denulth/i.test(npcPat.source)) {
            await sdk
                .waitForCondition(() => {
                    const n = sdk.findNearbyNpc(npcPat);
                    return !!n && !n.inCombat;
                }, 8_000)
                .catch(() => {});
        }
        const npc = sdk.findNearbyNpc(npcPat, { reachable: true }) ?? sdk.findNearbyNpc(npcPat);
        if (!npc) return [];
        await bot.talkTo(npc);
        const seen = await chat(choices);
        await closeUi();
        return seen;
    }

    async function useLoc(
        near: { x: number; z: number },
        name: RegExp,
        option: RegExp,
        radius = 12
    ): Promise<boolean> {
        await walkNear(near.x, near.z, 3);
        await sdk.scanNearbyLocs(radius).catch(() => {});
        const loc = (sdk.getNearbyLocs() ?? [])
            .filter((l) => name.test(l.name) && l.optionsWithIndex.some((o) => option.test(o.text)))
            .sort(
                (a, b) =>
                    Math.hypot(a.x - near.x, a.z - near.z) - Math.hypot(b.x - near.x, b.z - near.z)
            )[0];
        if (!loc) {
            log(`No ${name} / ${option} near ${near.x},${near.z} @ ${pos().x},${pos().z} L${pos().level}`);
            return false;
        }
        const opt = loc.optionsWithIndex.find((o) => option.test(o.text));
        intent(`${option} ${loc.name} @ ${loc.x},${loc.z}`);
        if (opt) await sdk.sendInteractLoc(loc.x, loc.z, loc.id, opt.opIndex);
        else await bot.interactLoc(loc, option);
        await sdk.waitForTicks(3);
        await closeUi();
        return true;
    }

    async function prepBank(): Promise<void> {
        if (count(FOOD) >= 12 && (worn(COMBAT_GEAR) || count(COMBAT_GEAR) > 0)) return;
        if (inStronghold() || inPassCave() || inArena()) return;
        const inNorth = pos().z >= 3360 && pos().x >= 2860 && pos().x <= 3100 && pos().z < 6400;
        intent('Banking food + gear at Falador east');
        if (inNorth) await walkPath(TO_FALLY_BANK, 4);
        else await walkNear(3012, 3355, 3);
        if (!(sdk.getState()?.bank?.isOpen || (await bot.openBank()).success)) {
            log(`Bank open failed @ ${pos().x},${pos().z}`);
            return;
        }
        for (const eq of [...sdk.getEquipment()]) {
            if (/dragon longsword/i.test(eq.name)) continue;
            await bot.unequipItem(eq);
            await sdk.waitForTicks(1);
        }
        for (const item of [...sdk.getInventory()]) {
            if ((item.count ?? 0) <= 0) continue;
            if (COINS.test(item.name) || BOOTS.test(item.name) || /dragon longsword/i.test(item.name)) {
                continue;
            }
            if (COMBAT_GEAR.test(item.name) || FOOD.test(item.name)) continue;
            await bot.depositItem(item, -1);
        }
        if (count(COINS) < 100) {
            const c = sdk.findBankItem(COINS);
            if (c) await bot.withdrawItem(c, 200);
        }
        for (const gear of [
            /^dragon longsword$/i,
            /^dragonhide body$/i,
            /^dragonhide chaps$/i,
            /^dragon vambraces$/i,
            /^amulet of glory$/i,
            /^ring of wealth$/i,
            /^cape of saradomin$/i,
            /^rune kiteshield$/i,
            /^rune full helm$/i,
            BOOTS
        ]) {
            if (count(gear) > 0 || worn(gear)) continue;
            const item = sdk.findBankItem(gear);
            if (item) await bot.withdrawItem(item, 1);
        }
        for (const food of sdk.getBankItems().filter((i) => FOOD.test(i.name))) {
            if (count(FOOD) >= 18 || occupied() >= 26) break;
            const room = Math.max(1, 26 - occupied());
            await bot.withdrawItem(food, Math.min(food.count ?? room, room, 18 - count(FOOD)));
        }
        await bot.closeBank();
        for (const item of sdk.getInventory()) {
            if (COMBAT_GEAR.test(item.name) && item.optionsWithIndex.some((o) => /wear|wield/i.test(o.text))) {
                await bot.equipItem(item);
            }
        }
        log(`Prepped food=${count(FOOD)} boots=${count(BOOTS) + (worn(BOOTS) ? 1 : 0)} @ ${pos().x},${pos().z}`);
    }

    async function wearBoots(): Promise<void> {
        if (worn(BOOTS)) return;
        const boots = sdk.findInventoryItem(BOOTS);
        if (!boots) return;
        const r = await bot.equipItem(boots);
        log(`Wear climbing boots: ${r.success ? 'ok' : r.message}`);
    }

    async function startDenulth(): Promise<void> {
        intent('Starting Troll Stronghold with Denulth');
        await walkNear(DENULTH.x, DENULTH.z, 3);
        const seen = await talk(/^denulth$/i, [
            /how goes your fight with the trolls/i,
            /is there anything i can do to help/i,
            /i'll get godric back/i
        ]);
        log(`Denulth: ${seen.slice(0, 10).join(' | ')}`);
        await chat([
            /i'll get godric back/i,
            /is there anything i can do to help/i,
            /how goes your fight with the trolls/i
        ]);
        await closeUi();
    }

    async function enterTenzing(): Promise<boolean> {
        if (sdk.findNearbyNpc(/^tenzing$/i, { reachable: true })) return true;
        intent("Opening Tenzing's door");
        await walkPath(TO_TENZING, 3);
        await walkNear(2823, 3555, 1);
        await sdk.scanNearbyLocs(8).catch(() => {});
        const door = (sdk.getNearbyLocs() ?? []).find((l) => /door/i.test(l.name) && l.x === 2822 && l.z === 3555);
        if (!door) {
            log(`No Tenzing door @ ${pos().x},${pos().z}`);
            return false;
        }
        const opt = door.optionsWithIndex.find((o) => /open/i.test(o.text));
        if (opt) {
            await sdk.sendInteractLoc(door.x, door.z, door.id, opt.opIndex);
            await sdk.waitForCondition((s) => !!s.dialog?.isOpen || !!sdk.findNearbyNpc(/^tenzing$/i), 8_000).catch(
                () => {}
            );
            await chat([/need your help|not the milkman|come in/i]);
        }
        await hopTo(TENZING.x, TENZING.z);
        return !!sdk.findNearbyNpc(/^tenzing$/i, { reachable: true });
    }

    async function buyBoots(): Promise<void> {
        if (count(BOOTS) > 0 || worn(BOOTS)) return;
        if (!(await enterTenzing())) return;
        const seen = await talk(/^tenzing$/i, [
            /can i buy some climbing boots/i,
            /ok, sounds good/i,
            /nothing, thanks/i
        ]);
        log(`Tenzing: ${seen.slice(0, 8).join(' | ')}`);
        await chat([/ok, sounds good/i, /nothing, thanks/i]);
        await wearBoots();
    }

    async function leaveTenzingToStile(): Promise<void> {
        // East of the yard gates — hop west through them, never walkTo the stile through the fence.
        if (pos().x >= 2825 && pos().z >= 3552 && pos().z <= 3558) {
            await hopTo(2824, 3555);
            await hopTo(2820, 3558);
        }
        await sdk.scanNearbyLocs(8).catch(() => {});
        const back = (sdk.getNearbyLocs() ?? []).find((l) => /door/i.test(l.name) && l.x <= 2821 && l.z >= 3556);
        if (back) {
            const opt = back.optionsWithIndex.find((o) => /open/i.test(o.text));
            if (opt) await sdk.sendInteractLoc(back.x, back.z, back.id, opt.opIndex);
            else await bot.openDoor(back);
            await sdk.waitForTicks(2);
        }
        await hopTo(STILE.x, STILE.z);
        await sdk.scanNearbyLocs(8).catch(() => {});
        const stile = sdk.findNearbyLoc(/stile/i);
        if (stile) {
            await bot.interactLoc(stile, /climb/i);
            await sdk.waitForTicks(3);
        }
    }

    async function climbPlateauRocks(): Promise<void> {
        await wearBoots();
        intent('Climbing Death Plateau rocks');
        await walkNear(ROCKS.x, ROCKS.z - 2, 2);
        for (let i = 0; i < 8 && pos().z < 3612; i++) {
            const before = pos().z;
            await useLoc(ROCKS, /^rocks$/i, /climb/i);
            await sdk.waitForCondition(() => pos().z !== before, 6_000).catch(() => {});
            if (/need a good reason|climbing boots to go that way/i.test(messages())) {
                log(messages().split('\n').slice(-2).join(' | '));
                break;
            }
            await eatIfNeeded(80);
        }
        log(`After rocks @ ${pos().x},${pos().z}`);
    }

    async function handleDadDialog(): Promise<boolean> {
        const d = sdk.getDialog();
        if (!d?.isOpen) return false;
        if (d.isWaiting) {
            await sdk.waitForStateChange(2_000).catch(() => {});
            return true;
        }
        const go = d.options.find((o) => /i'll be going now/i.test(o.text));
        if (go) {
            await sdk.sendClickDialog(go.index);
            log('Dad surrendered — leaving');
            await sdk.waitForTicks(2);
            return true;
        }
        if (isContinueDialog()) {
            await clickContinue();
            return true;
        }
        const accept = d.options.find((o) => /i accept your challenge|tiny human brave/i.test(o.text));
        if (accept) {
            await sdk.sendClickDialog(accept.index);
            return true;
        }
        return false;
    }

    async function fightDad(): Promise<void> {
        intent('Fighting Dad');
        await meleeOn();
        for (let i = 0; i < 90 && !dadBeaten(); i++) {
            await eatIfNeeded(50);
            if (pos().isDead) {
                log('Died fighting Dad');
                return;
            }
            if (await handleDadDialog()) {
                if (dadBeaten()) break;
                continue;
            }
            await meleeOn();
            const dad =
                sdk.findNearbyNpc(/^dad$/i, { reachable: true }) ?? sdk.findNearbyNpc(/^dad$/i);
            if (dad && !pos().inCombat) {
                const atk = await bot.attack(dad, 8_000);
                if (!atk.success) log(`Dad: ${atk.message}`);
            }
            await sdk.waitForTicks(2);
        }
        await chat([/i'll be going now/i]);
        await meleeOff();
        log(`Dad beaten=${dadBeaten()} @ ${pos().x},${pos().z}`);
    }

    async function fightGeneral(): Promise<void> {
        if (count(PRISON_KEY) > 0) return;
        intent('Killing a Troll General for the prison key');
        await walkNear(GENERAL.x, GENERAL.z, 6);
        await meleeOn();
        for (let i = 0; i < 100 && count(PRISON_KEY) < 1; i++) {
            await eatIfNeeded(50);
            await closeUi();
            if (pos().isDead) {
                log('Died fighting Troll General');
                return;
            }
            await sdk.scanGroundItems(12).catch(() => []);
            const key = sdk.findGroundItem(PRISON_KEY);
            if (key) {
                await bot.pickupItem(key);
                continue;
            }
            await meleeOn();
            const gen =
                sdk.findNearbyNpc(/^troll general$/i, { reachable: true }) ??
                sdk.findNearbyNpc(/^troll general$/i);
            if (gen && !pos().inCombat) {
                const atk = await bot.attack(gen, 8_000);
                if (!atk.success) log(`General: ${atk.message}`);
            }
            await sdk.waitForTicks(2);
        }
        await meleeOff();
        log(`Prison key=${count(PRISON_KEY)} @ ${pos().x},${pos().z} L${pos().level}`);
    }

    async function stealOrKill(name: RegExp, key: RegExp, spot: { x: number; z: number }): Promise<void> {
        if (count(key) > 0) return;
        intent(`Getting ${key.source} from ${name}`);
        await walkNear(spot.x, spot.z, 2);
        await meleeOn();
        for (let i = 0; i < 24 && count(key) < 1; i++) {
            await eatIfNeeded(50);
            await sdk.scanGroundItems(8).catch(() => []);
            const drop = sdk.findGroundItem(key);
            if (drop) {
                await bot.pickupItem(drop);
                continue;
            }
            const npc = sdk.findNearbyNpc(name, { reachable: true }) ?? sdk.findNearbyNpc(name);
            if (!npc) {
                await sdk.waitForTicks(2);
                continue;
            }
            const pick = npc.optionsWithIndex.find((o) => /pickpocket/i.test(o.text));
            if (pick && !npc.inCombat) {
                const r = await bot.pickpocketNpc(npc);
                log(`Pickpocket ${npc.name}: ${r.success ? 'ok' : r.message}`);
                await sdk.waitForTicks(2);
                continue;
            }
            if (!pos().inCombat) await bot.attack(npc, 8_000);
            await sdk.waitForTicks(2);
        }
        log(`${key.source}=${count(key)}`);
    }

    async function unlockCell(spot: { x: number; z: number }, key: RegExp): Promise<void> {
        if (count(key) < 1) return;
        const before = messages();
        await useLoc(spot, /cell door/i, /unlock|open/i);
        if (count(key) > 0) {
            const k = sdk.findInventoryItem(key);
            await sdk.scanNearbyLocs(8).catch(() => {});
            const door = (sdk.getNearbyLocs() ?? []).find(
                (l) => /cell door/i.test(l.name) && Math.hypot(l.x - spot.x, l.z - spot.z) <= 2
            );
            if (k && door) await bot.useItemOnLoc(k, door);
        }
        await chat();
        log(`Unlock @ ${spot.x},${spot.z} keyLeft=${count(key)} msg=${/unlock the cell/i.test(messages()) && !/unlock the cell/i.test(before)}`);
    }

    async function toStrongholdDoor(): Promise<void> {
        // Thrower ledge is z>=3694. Drop south in 3-tile hops before going west.
        if (pos().z >= 3692 && pos().z < 6400) {
            intent('Leaving thrower ledge south');
            await missilesOn();
            let guard = 0;
            while (pos().z >= 3692 && pos().z < 6400 && guard++ < 24) {
                await hopTo(pos().x, pos().z - 3);
            }
            await hopToward(Math.min(pos().x, 2875), 3676);
        }
        intent('Walking west to the Troll Stronghold door');
        await meleeOn();
        for (const hop of [
            { x: 2878, z: 3664 },
            { x: 2862, z: 3674 },
            { x: 2848, z: 3682 },
            { x: 2839, z: 3689 }
        ]) {
            if (distTo(STRONGHOLD_DOOR.x, STRONGHOLD_DOOR.z) <= 4) break;
            if (pos().z >= 3692) {
                await hopTo(pos().x, pos().z - 3);
            }
            if (hop.x > pos().x + 4) continue;
            await hopToward(hop.x, hop.z);
        }
        if (distTo(STRONGHOLD_DOOR.x, STRONGHOLD_DOOR.z) > 4) {
            await hopToward(STRONGHOLD_DOOR.x, STRONGHOLD_DOOR.z);
        }
    }

    async function toDunstan(): Promise<void> {
        await meleeOff();
        // West of the arena on Death Plateau — climb the secret-path rocks south.
        if (pos().z >= 3612 && pos().z < 3644 && pos().x >= 2834 && pos().z < 6400) {
            intent('Climbing south off Death Plateau');
            await hopToward(ROCKS.x, ROCKS.z + 1);
            for (let i = 0; i < 8 && pos().z >= 3612 && pos().z < 6400; i++) {
                const before = pos().z;
                await useLoc(ROCKS, /^rocks$/i, /climb/i);
                await sdk.waitForCondition(() => pos().z !== before, 6_000).catch(() => {});
            }
        }
        if (pos().z >= 3568 && pos().z < 6400 && pos().x < 2860) {
            intent('Hopping south to Tenzing stile');
            for (const hop of [
                { x: 2825, z: 3634 },
                { x: 2822, z: 3610 },
                { x: 2820, z: 3588 },
                { x: 2818, z: 3566 }
            ]) {
                if (pos().z <= 3566) break;
                if (hop.z > pos().z + 6) continue;
                await hopToward(Math.min(hop.x, pos().x), hop.z);
            }
        }
        await hopToward(STILE.x, STILE.z + 3);
        await walkNear(GUILD_EAST.x, 3570, 8);
        await walkNear(DUNSTAN.x, DUNSTAN.z, 3);
    }

    async function toBurthorpe(): Promise<void> {
        if (inBurthorpe() || distTo(DENULTH.x, DENULTH.z) < 16) return;
        if (inStronghold() || inPassCave()) return;
        if (pos().z >= 3518 && pos().x >= 2790 && pos().x < 2865 && pos().z < 6400) {
            await walkNear(GUILD_EAST.x, GUILD_EAST.z, 6);
            return;
        }
        if (pos().z < 3520 && pos().x >= 2920 && pos().z < 6400) {
            await walkPath([...TO_FALLY_BANK].reverse(), 8);
            return;
        }
        intent('Walking to Burthorpe (east of Heroes\' Guild)');
        await walkNear(GUILD_EAST.x, GUILD_EAST.z, 5);
        await walkNear(DENULTH.x, DENULTH.z, 6);
    }

    log(
        `Troll Stronghold start @ ${pos().x},${pos().z} L${pos().level} hp=${pos().hp}/${pos().maxHp} ` +
            `pray=${prayerPoints()}/${prayerBase()} food=${count(FOOD)} boots=${worn(BOOTS) ? 'worn' : count(BOOTS)}`
    );

    const until = Date.now() + 40 * 60_000;
    while (Date.now() < until && !questDone()) {
        await closeUi();
        await eatIfNeeded();
        if (pos().isDead) {
            await sdk.waitForCondition((s) => !s.player.isDead, 45_000).catch(() => {});
            continue;
        }

        if (inPassCave()) {
            intent('Crossing troll pass cave north to Trollheim');
            await meleeOn();
            await walkNear(PASS_NORTH_INSIDE.x, PASS_NORTH_INSIDE.z, 2);
            await useLoc(PASS_NORTH_INSIDE, /cave exit|exit/i, /exit|leave|enter/i);
            continue;
        }

        if (inStronghold()) {
            if (pos().level === 0) {
                await stealOrKill(/^twig$/i, CELL1, TWIG);
                await stealOrKill(/^berry$/i, CELL2, BERRY);
                await unlockCell(GODRIC_DOOR, CELL1);
                await unlockCell(EADGAR_DOOR, CELL2);
                const freed = /thank you, my friend|i'm off back home|unlock the cell door/i.test(messages());
                if (freed && count(CELL1) === 0) {
                    intent('Leaving via the prison back exit');
                    await meleeOff();
                    await useLoc(BACK_EXIT, /^exit$/i, /open|exit/i);
                }
                continue;
            }
            // Key is deleted on unlock — L1 with no key still has to climb down.
            if (pos().level === 1) {
                intent('Prison door / stairs down to the cells');
                await meleeOn();
                const door = sdk.findNearbyLoc(/prison door/i);
                if (door?.optionsWithIndex.some((o) => /unlock|open/i.test(o.text))) {
                    await useLoc(PRISON_DOOR, /prison door/i, /unlock|open/i);
                }
                // stairstop forceapproach=north
                await hopTo(STAIRS_L1_N.x, STAIRS_L1_N.z + 2);
                await useLoc(STAIRS_L1_N, /stone staircase|staircase/i, /climb-down|climb.down/i);
                continue;
            }
            if (count(PRISON_KEY) > 0 && pos().level >= 2) {
                intent('Prison key in hand — stairs down from the generals');
                await meleeOn();
                await useLoc(STAIRS_L2_N, /stone staircase|staircase/i, /climb-down|climb.down/i);
                continue;
            }
            await fightGeneral();
            continue;
        }

        if (
            (godricFreed() || inBurthorpe()) &&
            pos().z < 6400 &&
            !inStronghold() &&
            !inPassCave() &&
            !questDone()
        ) {
            intent(godricFreed() ? 'Godric freed — walking to Dunstan' : 'In Burthorpe — checking Dunstan');
            if (godricFreed() && !inBurthorpe()) await toDunstan();
            else {
                await meleeOff();
                await walkNear(DUNSTAN.x, DUNSTAN.z, 3);
            }
            const seen = await talk(/^dunstan$/i, [/has godric returned home/i]);
            log(`Dunstan: ${seen.slice(0, 8).join(' | ')}`);
            await chat();
            if (questDone() || godricFreed()) continue;
        }

        if (inArena() || (sdk.findNearbyNpc(/^dad$/i) && pos().z < 3640 && !godricFreed())) {
            if (!dadBeaten()) await fightDad();
            await useLoc(ARENA_OUT, /arena exit/i, /open/i);
            continue;
        }

        if (count(PRISON_KEY) > 0 && pos().z < 6400) {
            intent('Have prison key — entering the stronghold');
            await meleeOn();
            if (distTo(STRONGHOLD_DOOR.x, STRONGHOLD_DOOR.z) > 8) await toStrongholdDoor();
            await useLoc(STRONGHOLD_DOOR, /stronghold/i, /enter|open/i);
            continue;
        }

        if (!godricFreed() && (dadBeaten() || (pos().z >= 3630 && pos().z < 6400 && pos().x >= 2830))) {
            if (distTo(STRONGHOLD_DOOR.x, STRONGHOLD_DOOR.z) > 8 && pos().z < 3650) {
                intent('Entering the troll pass cave');
                await meleeOn();
                await useLoc(PASS_SOUTH, /cave entrance/i, /enter/i);
                continue;
            }
            await toStrongholdDoor();
            await useLoc(STRONGHOLD_DOOR, /stronghold/i, /enter|open/i);
            continue;
        }

        if (!godricFreed() && worn(BOOTS) && pos().z >= 3612 && pos().z < 6400 && pos().x >= 2868) {
            intent('Opening the arena');
            await meleeOn();
            await walkNear(ARENA_IN.x, ARENA_IN.z, 3);
            await useLoc(ARENA_IN, /arena entrance/i, /open/i);
            continue;
        }

        if (!godricFreed() && (count(BOOTS) > 0 || worn(BOOTS))) {
            await wearBoots();
            if (pos().z < 3560 || pos().x < 2830) {
                if (distTo(TENZING.x, TENZING.z) < 20 || inTenzingYard()) await leaveTenzingToStile();
                await walkPath(TO_PLATEAU, 4);
            }
            await climbPlateauRocks();
            if (pos().z >= 3612) await walkNear(ARENA_IN.x, ARENA_IN.z, 4);
            continue;
        }

        await prepBank();
        if (!inBurthorpe() && pos().z < 6400) await toBurthorpe();
        await startDenulth();
        await buyBoots();
        log(`loop boots=${count(BOOTS) || worn(BOOTS)} key=${count(PRISON_KEY)} food=${count(FOOD)} @ ${pos().x},${pos().z} L${pos().level}`);
        await sdk.waitForTicks(2);
    }

    await meleeOff();
    if (!questDone()) {
        throw new Error(`Troll Stronghold unfinished @ ${pos().x},${pos().z} L${pos().level}`);
    }
    log('QUEST COMPLETE Troll Stronghold');
});
