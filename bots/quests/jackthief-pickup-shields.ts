/**
 * Duke dragonfire-shield duty for jackthief.
 *
 *   bun bots/quests/jackthief-pickup-shields.ts jackthief
 *
 * First run from anywhere in Kandarin: banks EVERYTHING at Catherby, walks
 * to the Ardougne heroes and dies to one for a Lumbridge respawn (no air
 * runes needed), climbs to Duke Horacio's room. Then sweeps the floor for
 * dropped dragonfire shields, banks full loads at Draynor bank, and
 * returns to the Duke — a sustained duty loop. Switch him off when the
 * drops stop; shields stay banked at Draynor.
 *
 * Drop mode (`--drop`, jackthief): reverses the flow — repeatedly asks Duke
 * for a dragonfire shield ("shield that will protect me from the dragon")
 * and drops each one on the floor for the picker (pigfat) to bank. Waits
 * instead of farming while the picker is out of sight, and idles with a
 * visible log line when Duke stops handing shields out.
 */
import { appendFileSync } from 'fs';
import { join } from 'path';
import { runScript } from '../../sdk/runner';

const botName = process.argv.slice(2).find((a) => !a.startsWith('-')) ?? '';
const GRIND_LOG = join(process.cwd(), 'bots', botName, 'grind.log');

const FIRE_SHIELD = /dragonfire shield|anti-?dragon/i;
const DUKE_SHIELD_LINE = /shield that will protect me from the dragon/i;
const DROP_MODE = process.argv.includes('--drop');
const PICKER = /pigfat/i;
const MAX_MISSES = 3;

const CATHERBY_BANK = { x: 2808, z: 3443 };
const DRAYNOR_BANK = { x: 3092, z: 3243 };
const HEROES = { x: 2630, z: 3288 };
const CASTLE_STAIRS = { x: 3205, z: 3208 };
const DUKE = { x: 3212, z: 3220 };
const LUMBRIDGE_BANK = { x: 3208, z: 3220 };

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

    const pos = () => {
        const p = sdk.getState()?.player;
        return {
            x: p?.worldX ?? 0,
            z: p?.worldZ ?? 0,
            level: p?.level ?? 0,
            isDead: p?.isDead ?? false,
            inCombat: p?.combat?.inCombat ?? false,
            lifeId: p?.lifeId ?? 0
        };
    };
    const distTo = (x: number, z: number) => Math.hypot(pos().x - x, pos().z - z);

    async function closeUi(): Promise<void> {
        const dialog = sdk.getDialog();
        if (dialog?.isOpen) {
            if (
                dialog.options?.every((o) => /click here to continue|continue/i.test(o.text)) ||
                (dialog.options?.length ?? 0) <= 1
            ) {
                await sdk.sendClickDialog(dialog.options?.[0]?.index ?? 0);
                await sdk.waitForTicks(1).catch(() => {});
            }
        }
        if (sdk.getState()?.shop?.isOpen || sdk.getState()?.bank?.isOpen || sdk.getState()?.interface?.isOpen) {
            await bot.closeInterface();
        }
        await bot.dismissBlockingUI();
    }

    async function walkNear(x: number, z: number, tolerance = 4): Promise<boolean> {
        if (distTo(x, z) <= tolerance) return true;
        const result = await bot.walkTo(x, z, Math.min(tolerance, 3));
        return result.success || distTo(x, z) <= tolerance + 2;
    }

    async function openToward(tx: number, tz: number): Promise<void> {
        await sdk.scanNearbyLocs(8).catch(() => {});
        const door = (sdk.getNearbyLocs() ?? [])
            .filter(
                (l) =>
                    /door|gate/i.test(l.name) &&
                    l.reachable !== false &&
                    l.optionsWithIndex.some((o) => /^open$/i.test(o.text))
            )
            .sort((a, b) => Math.hypot(a.x - tx, a.z - tz) - Math.hypot(b.x - tx, b.z - tz))[0];
        if (door && (door.distance ?? 99) <= 10) await bot.openDoor(door);
    }

    async function climb(want: 'up' | 'down'): Promise<boolean> {
        const opt = want === 'up' ? /climb-up|climb.up|go-up/i : /climb-down|climb.down|go-down/i;
        const beforeLevel = pos().level;
        const beforeZ = pos().z;
        for (let i = 0; i < 6; i++) {
            const loc = (sdk.getNearbyLocs() ?? [])
                .filter((l) => /stair|ladder/i.test(l.name) && l.optionsWithIndex.some((o) => opt.test(o.text)))
                .sort(
                    (a, b) =>
                        (a.reachable === false ? 1 : 0) - (b.reachable === false ? 1 : 0) ||
                        (a.distance ?? 99) - (b.distance ?? 99)
                )[0];
            if (!loc) {
                await sdk.scanNearbyLocs(8).catch(() => {});
                await sdk.waitForTicks(1);
                continue;
            }
            if ((loc.distance ?? 99) > 2) await walkNear(loc.x, loc.z, 1);
            const match = loc.optionsWithIndex.find((o) => opt.test(o.text));
            if (match && (loc.distance ?? 99) <= 2) {
                await sdk.sendInteractLoc(loc.x, loc.z, loc.id, match.opIndex);
            } else {
                await bot.interactLoc(loc, opt);
            }
            await sdk
                .waitForCondition((s) => {
                    const p = s.player;
                    if (!p) return false;
                    return p.level !== beforeLevel || Math.abs((p.worldZ ?? 0) - beforeZ) > 8;
                }, 8_000)
                .catch(() => {});
            await closeUi();
            if (pos().level !== beforeLevel || Math.abs(pos().z - beforeZ) > 8) return true;
        }
        return false;
    }

    /** Lumbridge castle ground floor or Duke's floor. */
    function inLumbridgeZone(): boolean {
        if (sdk.findNearbyNpc(/duke/i)) return true;
        const p = pos();
        return p.x > 3180 && p.x < 3240 && p.z > 3200 && p.z < 3235 && p.z < 6400;
    }

    /** Unequip everything and deposit the whole bag at the given bank tile. */
    async function bankAllAt(bank: { x: number; z: number }, label: string): Promise<boolean> {
        await closeUi();
        if (distTo(bank.x, bank.z) > 8 && !(await walkNear(bank.x, bank.z, 4))) {
            log(`BANKALL ${label}: cannot reach bank @ ${pos().x},${pos().z}`);
            return false;
        }
        for (const w of bot.getEquipment().filter((i) => (i.count ?? 0) > 0)) {
            await bot.unequipItem(w).catch(() => undefined);
        }
        if (!(sdk.getState()?.bank?.isOpen || (await bot.openBank()).success)) {
            log(`BANKALL ${label}: bank did not open @ ${pos().x},${pos().z}`);
            return false;
        }
        for (;;) {
            const item = sdk.getInventory().filter((i) => (i.count ?? 0) > 0)[0];
            if (!item) break;
            const r = await bot.depositItem(item, -1);
            if (!r.success) break;
        }
        const left = sdk.getInventory().filter((i) => (i.count ?? 0) > 0).length;
        await bot.closeBank().catch(() => undefined);
        await closeUi();
        log(`BANKALL ${label}: ${left === 0 ? 'empty' : `${left} slots left`} @ ${pos().x},${pos().z}`);
        return left === 0;
    }

    function findSuicideNpc() {
        return (
            sdk.findNearbyNpc(/^hero$/i, { reachable: true }) ??
            sdk.findNearbyNpc(/^paladin$/i, { reachable: true }) ??
            sdk.findNearbyNpc(/^knight of ardougne$/i, { reachable: true }) ??
            sdk.findNearbyNpc(/^hero$/i) ??
            sdk.findNearbyNpc(/^paladin$/i) ??
            sdk.findNearbyNpc(/^knight of ardougne$/i)
        );
    }

    /** Die naked to a hero/paladin for a Lumbridge respawn. Zero loss, bag is empty. */
    async function suicideToLumbridge(): Promise<boolean> {
        if (pos().isDead) return false;
        if (pos().inCombat) {
            log(`SUICIDE waiting to die @ ${pos().x},${pos().z} — not eating`);
            await sdk.waitForCondition((s) => !!s.player?.isDead, 45_000).catch(() => {});
            return pos().isDead;
        }
        if (distTo(HEROES.x, HEROES.z) > 8) {
            log(`SUICIDE walking to heroes @ ${pos().x},${pos().z}`);
            await walkNear(HEROES.x, HEROES.z, 4);
            return false;
        }
        const npc = findSuicideNpc();
        if (!npc) {
            log('SUICIDE no hero/paladin/knight nearby');
            await sdk.scanNearbyLocs(10).catch(() => {});
            await sdk.waitForTicks(2);
            return false;
        }
        const life = pos().lifeId;
        log(`SUICIDE attacking ${npc.name} — Lumbridge respawn`);
        const r = await bot.attack(npc, 8_000);
        log(`SUICIDE attack ${npc.name}: ${r.success ? 'ok' : r.message}`);
        await sdk
            .waitForCondition((s) => !!s.player?.isDead || (s.player?.lifeId ?? life) !== life, 60_000)
            .catch(() => {});
        return pos().isDead || pos().lifeId !== life;
    }

    /** True only when standing at the duty station: level 1, by Duke's tile, Duke visible. */
    function atDukeStation(): boolean {
        const duke = sdk.findNearbyNpc(/duke/i) as { reachable?: boolean } | undefined;
        return !!duke && duke.reachable !== false && pos().level === 1 && distTo(DUKE.x, DUKE.z) <= 6;
    }

    async function goToDuke(): Promise<boolean> {
        await closeUi();
        for (let i = 0; i < 3; i++) {
            if (atDukeStation()) return true;
            if (pos().level > 1) {
                await climb('down');
                continue;
            }
            if (pos().level < 1) {
                if (distTo(CASTLE_STAIRS.x, CASTLE_STAIRS.z) > 6) {
                    await walkNear(CASTLE_STAIRS.x, CASTLE_STAIRS.z, 2);
                }
                await openToward(CASTLE_STAIRS.x, CASTLE_STAIRS.z);
                await climb('up');
                continue;
            }
            // Level 1 but away from the station (e.g. east tower rooms see Duke
            // through the wall): walk back through doors instead of declaring arrival.
            await openToward(DUKE.x, DUKE.z);
            await walkNear(DUKE.x, DUKE.z, 2);
            await sdk.waitForTicks(2).catch(() => {});
        }
        return atDukeStation();
    }

    const shieldsInBag = () =>
        sdk.getInventory().filter((i) => FIRE_SHIELD.test(i.name)).reduce((n, i) => n + (i.count ?? 1), 0);
    // getInventory() lists only occupied slots.
    const freeSlots = () => Math.max(0, 28 - sdk.getInventory().length);

    async function pickupSweep(): Promise<number> {
        let picked = 0;
        let misses = 0;
        while (freeSlots() > 0 && misses < MAX_MISSES && !pos().isDead) {
            const scanned = (await sdk.scanGroundItems(12).catch(() => null)) ?? [];
            const pushed = sdk.getGroundItems() ?? [];
            const pool = scanned.length ? scanned : pushed;
            const ground = pool
                .filter((g) => FIRE_SHIELD.test(g.name) && (g.reachable !== false || (g.distance ?? 99) === 0))
                .sort((a, b) => (a.distance ?? 99) - (b.distance ?? 99))[0];
            if (!ground) {
                misses++;
                await sdk.waitForTicks(2).catch(() => {});
                continue;
            }
            const before = shieldsInBag();
            const r = await bot.pickupItem(ground);
            await sdk.waitForTicks(1).catch(() => {});
            const gained = shieldsInBag() - before;
            if (gained > 0 || r.success) {
                picked += Math.max(gained, 1);
                misses = 0;
            } else {
                misses++;
                if (/inventory/i.test(r.message)) break;
            }
        }
        return picked;
    }

    /** Bank full shield loads at Draynor — probed: Lumbridge Castle has no
     * usable booth on any floor (level 2 is open battlements), and Draynor
     * is a straight walk west. While the picker treks, the dropper idles
     * (picker-gated), so nothing despawns. */
    async function bankShields(): Promise<boolean> {
        if (distTo(DRAYNOR_BANK.x, DRAYNOR_BANK.z) > 6) {
            if (pos().level !== 0) {
                while (pos().level > 0) {
                    if (!(await climb('down'))) break;
                }
            }
            await walkNear(DRAYNOR_BANK.x, DRAYNOR_BANK.z, 4);
        }
        if (!(sdk.getState()?.bank?.isOpen || (await bot.openBank()).success)) {
            log(`BANK shields: Draynor bank did not open @ ${pos().x},${pos().z},${pos().level}`);
            return false;
        }
        const before = shieldsInBag();
        for (;;) {
            const item = sdk.getInventory().filter((i) => (i.count ?? 0) > 0 && FIRE_SHIELD.test(i.name))[0];
            if (!item) break;
            const r = await bot.depositItem(item, -1);
            if (!r.success) break;
        }
        await bot.closeBank().catch(() => undefined);
        await closeUi();
        const banked = before - shieldsInBag();
        log(`BANK shields: banked ${banked} @ Draynor`);
        return banked > 0;
    }

    /** Ask Duke for a dragonfire shield. Returns true when one lands in the bag. */
    async function claimShieldFromDuke(): Promise<boolean> {
        if (sdk.findInventoryItem(FIRE_SHIELD)) return true;
        const duke = sdk.findNearbyNpc(/duke/i);
        if (!duke) return false;
        const talked = await bot.talkTo(duke);
        if (!talked.success && !sdk.getDialog()?.isOpen) {
            log(`DROP talk to Duke failed: ${talked.message}`);
            return false;
        }
        for (let i = 0; i < 16 && !sdk.findInventoryItem(FIRE_SHIELD); i++) {
            const dialog = sdk.getDialog();
            if (!dialog?.isOpen) {
                await sdk.waitForTicks(1).catch(() => {});
                continue;
            }
            const opts = dialog.options ?? [];
            const shieldLine = opts.find((o) => DUKE_SHIELD_LINE.test(o.text));
            if (shieldLine) {
                await sdk.sendClickDialog(shieldLine.index);
                await sdk.waitForTicks(1).catch(() => {});
                continue;
            }
            if (opts.length <= 1 || opts.every((o) => /click here to continue|please wait/i.test(o.text))) {
                await sdk.sendClickDialog(opts[0]?.index ?? 0);
                await sdk.waitForTicks(1).catch(() => {});
                continue;
            }
            log(`DROP Duke offers no shield (${opts.map((o) => o.text).join(' | ')})`);
            await closeUi();
            return false;
        }
        return !!sdk.findInventoryItem(FIRE_SHIELD);
    }

    /** Drop mode (jackthief): farm shields from Duke and drop them for the picker. */
    async function dropLoop(): Promise<never> {
        let dropped = 0;
        let refusals = 0;
        let waits = 0;
        log(`DROP-SHIELDS start @ ${pos().x},${pos().z},${pos().level}`);
        for (;;) {
            await closeUi();
            if (pos().isDead) {
                const life = pos().lifeId;
                await sdk.waitForCondition((s) => !s.player?.isDead && (s.player?.lifeId ?? life) !== life, 45_000).catch(() => {});
                await closeUi();
                continue;
            }
            if (!atDukeStation()) {
                await goToDuke();
                continue;
            }
            if (!sdk.findNearbyPlayer(PICKER)) {
                waits++;
                if (waits % 6 === 0) log(`DROP waiting for picker @ ${pos().x},${pos().z},${pos().level} — dropped so far ${dropped}`);
                await sdk.waitForTicks(10).catch(() => {});
                continue;
            }
            const shield = sdk.findInventoryItem(FIRE_SHIELD);
            if (!shield) {
                if (await claimShieldFromDuke()) {
                    refusals = 0;
                    continue;
                }
                refusals++;
                log(`DROP Duke refused (${refusals}) @ ${pos().x},${pos().z},${pos().level}`);
                await sdk.waitForTicks(50).catch(() => {});
                continue;
            }
            const r = await bot.dropItem(shield, 1);
            await sdk.waitForTicks(1).catch(() => {});
            if (r.success) {
                dropped++;
                if (dropped % 10 === 0) log(`DROP dropped ${dropped} shields @ ${pos().x},${pos().z},${pos().level}`);
            } else {
                log(`DROP drop failed: ${r.message}`);
                await sdk.waitForTicks(5).catch(() => {});
            }
        }
    }

    // ---- first leg: bank everything, die to Lumbridge, climb to the Duke ----
    let banked = 0;
    log(`PICKUP-SHIELDS start @ ${pos().x},${pos().z} shields=${shieldsInBag()}`);
    for (let leg = 0; leg < 40 && !inLumbridgeZone() && !pos().isDead; leg++) {
        await closeUi();
        const carrying = sdk.getInventory().filter((i) => (i.count ?? 0) > 0).length;
        if (carrying > 0) {
            if (!(await bankAllAt(CATHERBY_BANK, 'catherby'))) {
                await sdk.waitForTicks(3);
                continue;
            }
        }
        if (await suicideToLumbridge()) break;
        await sdk.waitForTicks(2);
    }
    if (pos().isDead) {
        const life = pos().lifeId;
        log('PICKUP-SHIELDS dead — waiting for Lumbridge respawn');
        await sdk.waitForCondition((s) => !s.player?.isDead && (s.player?.lifeId ?? life) !== life, 45_000).catch(() => {});
        await closeUi();
    }
    if (!inLumbridgeZone()) {
        log(`PICKUP-SHIELDS not in Lumbridge @ ${pos().x},${pos().z} — retry next restart`);
        await sdk.disconnect().catch(() => undefined);
        process.exit(1);
    }
    for (let i = 0; i < 6 && !(await goToDuke()); i++) {
        await sdk.waitForTicks(2);
    }
    log(`PICKUP-SHIELDS at Duke: duke=${sdk.findNearbyNpc(/duke/i) ? 'yes' : 'no'} @ ${pos().x},${pos().z},${pos().level}`);
    if (DROP_MODE) {
        await dropLoop();
    }

    // ---- duty loop: sweep, bank full loads at Lumbridge, return ----
    let idleSweeps = 0;
    for (;;) {
        await closeUi();
        if (pos().isDead) {
            const life = pos().lifeId;
            await sdk.waitForCondition((s) => !s.player?.isDead && (s.player?.lifeId ?? life) !== life, 45_000).catch(() => {});
            await closeUi();
            continue;
        }
        if (!atDukeStation()) {
            if (idleSweeps % 10 === 0) {
                log(`PICKUP-SHIELDS returning to Duke @ ${pos().x},${pos().z},${pos().level}`);
            }
            idleSweeps++;
            await goToDuke();
            continue;
        }
        const picked = await pickupSweep();
        banked += picked;
        if (shieldsInBag() > 0 && freeSlots() === 0) {
            log(`PICKUP-SHIELDS bag full (${shieldsInBag()}) — banking`);
            if (!(await bankShields())) await sdk.waitForTicks(10).catch(() => {});
            continue;
        }
        if (picked > 0) {
            idleSweeps = 0;
            log(`PICKUP-SHIELDS sweep: +${picked} (run total ${banked}, holding ${shieldsInBag()})`);
        } else {
            idleSweeps++;
            if (idleSweeps % 10 === 0) {
                log(`PICKUP-SHIELDS waiting at Duke @ ${pos().x},${pos().z},${pos().level} — floor clear, banked ${banked}`);
            }
            await sdk.waitForTicks(5).catch(() => {});
        }
    }
});
