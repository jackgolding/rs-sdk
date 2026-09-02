/**
 * Lumbridge cows → Al Kharid tanner → bank leather.
 * Bronze pickaxe as weapon. Train Attack, Strength, and Defence equally.
 * Each bot keeps a private camp in the cow pen and picks nearby cows at random.
 *
 *   bun bots/quests/cow-leather-bank.ts jacklove1
 *   bun bots/jacklove1/script.ts
 */
import { appendFileSync } from 'fs';
import { join } from 'path';
import { runScript } from '../../sdk/runner';

const botName = process.argv.slice(2).find((a) => !a.startsWith('-')) ?? '';
const GRIND_LOG = join(process.cwd(), 'bots', botName, 'grind.log');

const FALADOR_EAST = { x: 3012, z: 3355 };
const COW_GATE = { x: 3253, z: 3266 };
const TOLL_WEST = { x: 3267, z: 3228 };
const TOLL_EAST = { x: 3277, z: 3227 };
const TANNER = { x: 3276, z: 3193 };
const ALKHARID_BANK = { x: 3269, z: 3167 };

/** Distinct corners of the Lumbridge cow pen so the five jackloves do not stack. */
const CAMPS = [
    { x: 3248, z: 3292 },
    { x: 3260, z: 3292 },
    { x: 3248, z: 3274 },
    { x: 3260, z: 3274 },
    { x: 3253, z: 3284 }
] as const;

const PICKAXE = /^bronze pickaxe$/i;
const HIDE = /^cow hide$/i;
const BONES = /^bones$/i;
const LEATHER = /^leather$/i;
const COINS = /^coins$/i;
const COW = /^cow$/i;
const KEEP = /^(bronze pickaxe|coins|cow hide|leather)$/i;
const TARGET_GP = 500;
const TOLL = 10;

function botIndex(name: string): number {
    const n = Number(name.replace(/\D/g, ''));
    if (Number.isFinite(n) && n > 0) return (n - 1) % CAMPS.length;
    let h = 0;
    for (const c of name) h = (h * 31 + c.charCodeAt(0)) | 0;
    return Math.abs(h) % CAMPS.length;
}

function randInt(min: number, max: number): number {
    return min + Math.floor(Math.random() * (max - min + 1));
}

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

    const home = CAMPS[botIndex(botName)]!;
    const pos = () => {
        const p = sdk.getState()?.player;
        return { x: p?.worldX ?? 0, z: p?.worldZ ?? 0 };
    };
    const distTo = (x: number, z: number) => {
        const p = pos();
        return Math.hypot(p.x - x, p.z - z);
    };
    const count = (pattern: RegExp) =>
        sdk.getInventory().filter((i) => pattern.test(i.name)).reduce((n, i) => n + (i.count ?? 1), 0);
    const occupied = () => sdk.getInventory().filter((i) => (i.count ?? 0) > 0).length;
    const emptySlots = () => 28 - occupied();
    const inCowPen = (x: number, z: number) => x >= 3244 && x <= 3264 && z >= 3268 && z <= 3297;
    const hasPickaxe = () => !!(sdk.findInventoryItem(PICKAXE) || sdk.findEquipmentItem(PICKAXE));

    function randomSpot(): { x: number; z: number } {
        return {
            x: Math.min(3262, Math.max(3246, home.x + randInt(-3, 3))),
            z: Math.min(3295, Math.max(3271, home.z + randInt(-4, 4)))
        };
    }

    async function closeUi(): Promise<void> {
        for (let i = 0; i < 8; i++) {
            await bot.dismissBlockingUI();
            const dialog = sdk.getDialog();
            if (dialog?.isOpen) {
                if (dialog.options.some((o) => /yes, ok/i.test(o.text))) break;
                const cont = dialog.options?.find((o) => /continue|click here/i.test(o.text));
                if (cont?.componentId) await sdk.sendClickComponent(cont.componentId);
                await sdk.sendClickDialog(cont?.index ?? 0);
                await sdk.waitForTicks(1).catch(() => {});
                continue;
            }
            if (sdk.getState()?.shop?.isOpen || sdk.getState()?.bank?.isOpen || sdk.getState()?.interface?.isOpen) {
                await bot.closeInterface();
                await sdk.waitForTicks(1).catch(() => {});
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

    async function clickYesOkOrContinue(): Promise<void> {
        for (let i = 0; i < 16; i++) {
            const dialog = sdk.getDialog();
            if (!dialog?.isOpen) {
                await sdk.waitForTicks(1).catch(() => {});
                continue;
            }
            if (dialog.isWaiting) {
                await sdk.waitForTicks(1);
                continue;
            }
            const yes = dialog.options.find((o) => /yes, ok/i.test(o.text));
            const yesPlease = dialog.options.find((o) => /^yes please/i.test(o.text));
            const pick = yes ?? yesPlease;
            if (pick) {
                await sdk.sendClickDialog(pick.index);
            } else if (dialog.options.length <= 1) {
                await sdk.sendClickDialog(0);
            } else {
                break;
            }
            await sdk.waitForTicks(1);
        }
    }

    async function crossToll(wantEast: boolean): Promise<boolean> {
        const east = pos().x >= 3272;
        if (wantEast === east) return true;
        if (count(COINS) < TOLL) {
            log(`Need ${TOLL}gp for the toll @ ${pos().x},${pos().z}`);
            return false;
        }
        await closeUi();
        await walkNear(wantEast ? TOLL_WEST.x : TOLL_EAST.x, wantEast ? TOLL_WEST.z : TOLL_EAST.z, 3);
        const guard = sdk.findNearbyNpc(/^border guard$/i);
        if (!guard) {
            log('No Border Guard nearby');
            return false;
        }
        await bot.talkTo(guard);
        await clickYesOkOrContinue();
        await walkNear(wantEast ? TOLL_EAST.x : TOLL_WEST.x, wantEast ? TOLL_EAST.z : TOLL_WEST.z, 2);
        for (let i = 0; i < 25 && (pos().x >= 3272) !== wantEast; i++) {
            if (sdk.getDialog()?.isOpen) await clickYesOkOrContinue();
            await walkNear(wantEast ? TOLL_EAST.x : TOLL_WEST.x, wantEast ? TOLL_EAST.z : TOLL_WEST.z, 2);
            await sdk.waitForTicks(1);
        }
        const ok = (pos().x >= 3272) === wantEast;
        log(ok ? `Toll ok @ ${pos().x},${pos().z}` : `Still ${pos().x},${pos().z} after toll`);
        return ok;
    }

    async function goFaladorEast(): Promise<boolean> {
        await closeUi();
        if (distTo(FALADOR_EAST.x, FALADOR_EAST.z) <= 6) return true;
        log('Walking to Falador east bank');
        return walkNear(FALADOR_EAST.x, FALADOR_EAST.z, 3);
    }

    async function restock(): Promise<boolean> {
        await closeUi();
        if (!(await goFaladorEast())) return false;
        if (!(sdk.getState()?.bank?.isOpen || (await bot.openBank()).success)) {
            log('Could not open Falador east bank');
            return false;
        }
        for (let i = 0; i < 8; i++) {
            const junk = sdk.getInventory().find((it) => (it.count ?? 0) > 0 && !KEEP.test(it.name));
            if (!junk) break;
            await bot.depositItem(junk, -1);
        }
        if (!hasPickaxe()) {
            const pick = sdk.findBankItem(PICKAXE);
            if (pick) await bot.withdrawItem(pick, 1);
        }
        const have = count(COINS);
        if (have < TARGET_GP) {
            const w = await bot.withdrawItem(COINS, TARGET_GP - have);
            log(`Withdraw coins: ${w.success ? 'ok' : w.message} now ${count(COINS)}gp`);
        }
        await bot.closeBank();
        const inv = sdk.findInventoryItem(PICKAXE);
        if (inv && !sdk.findEquipmentItem(PICKAXE)) await bot.equipItem(inv);
        return hasPickaxe() && count(COINS) >= 50;
    }

    async function goCows(): Promise<boolean> {
        await closeUi();
        const p = pos();
        const spot = randomSpot();
        if (inCowPen(p.x, p.z) && distTo(spot.x, spot.z) <= 6) return true;
        if (p.x >= 3272) {
            if (!(await crossToll(false))) return false;
        }
        if (distTo(spot.x, spot.z) > 40) {
            if (pos().x < 3100) await walkNear(3100, 3320, 8);
            if (pos().x < 3200) await walkNear(3180, 3300, 8);
        }
        // West of the pen is the chicken coop. Never path through it — go south to the cow gate.
        if (pos().x < 3244 && pos().z > 3266) {
            log(`Leaving chickens @ ${pos().x},${pos().z}`);
            await walkNear(3234, 3264, 4);
        }
        if (pos().z < 3268) await walkNear(COW_GATE.x, COW_GATE.z, 2);
        await walkNear(spot.x, spot.z, 3);
        log(`Camp ${spot.x},${spot.z} (home ${home.x},${home.z})`);
        return inCowPen(pos().x, pos().z) || distTo(spot.x, spot.z) <= 8;
    }

    async function trainMelee(): Promise<void> {
        const cs = sdk.getState()?.combatStyle;
        if (!cs?.known) return;
        const atk = sdk.getSkill('Attack')?.baseLevel ?? 1;
        const str = sdk.getSkill('Strength')?.baseLevel ?? 1;
        const def = sdk.getSkill('Defence')?.baseLevel ?? 1;
        const want = atk <= str && atk <= def ? 'Attack' : str <= def ? 'Strength' : 'Defence';
        const style =
            cs.styles.find((s) => s.trainsSkills.includes(want) && s.trainsSkills.length === 1) ??
            cs.styles.find((s) => s.trainsSkills.includes(want));
        if (!style || cs.currentStyle === style.index) return;
        await sdk.sendSetCombatStyle(style.index);
        await sdk.waitForCondition((s) => s.combatStyle?.currentStyle === style.index, 3_000).catch(() => {});
        log(`Style ${style.name} → ${want} (atk ${atk} str ${str} def ${def})`);
    }

    async function buryBones(): Promise<void> {
        for (let i = 0; i < 8; i++) {
            await bot.dismissBlockingUI();
            const bones = sdk.findInventoryItem(BONES);
            if (!bones) return;
            const buryOpt = bones.optionsWithIndex.find((o) => /bury/i.test(o.text));
            if (!buryOpt) return;
            await sdk.sendUseItem(bones.slot, buryOpt.opIndex);
            await sdk.waitForTicks(1);
        }
    }

    async function lootDrops(): Promise<void> {
        await buryBones();
        const here = pos();
        if (!inCowPen(here.x, here.z) || emptySlots() <= 0) return;
        const ground = await sdk.scanGroundItems();
        const loot = ground
            .filter((g) => (HIDE.test(g.name) || BONES.test(g.name)) && inCowPen(g.x, g.z) && g.distance < 6)
            .sort((a, b) => {
                const pri = (g: { name: string }) => (HIDE.test(g.name) ? 0 : 1);
                if (pri(a) !== pri(b)) return pri(a) - pri(b);
                return a.distance - b.distance;
            })
            .slice(0, 3);
        for (const item of loot) {
            if (!inCowPen(pos().x, pos().z)) break;
            if (emptySlots() <= 0) {
                await buryBones();
                if (emptySlots() <= 0) break;
            }
            await bot.pickupItem(item);
            if (BONES.test(item.name)) await buryBones();
        }
        await buryBones();
    }

    function pickCow() {
        const cows = (sdk.getNearbyNpcs() ?? [])
            .filter((n) => COW.test(n.name) && n.optionsWithIndex.some((o) => /attack/i.test(o.text)))
            .filter((n) => inCowPen(n.x, n.z))
            .sort((a, b) => a.distance - b.distance);
        if (cows.length === 0) return null;
        const pool = cows.slice(0, Math.min(5, cows.length));
        return pool[randInt(0, pool.length - 1)] ?? null;
    }

    async function tanHides(): Promise<boolean> {
        if (count(HIDE) < 1) return true;
        await closeUi();
        if (pos().x < 3272 && !(await crossToll(true))) return false;
        await walkNear(TANNER.x, TANNER.z, 3);
        const before = count(HIDE);
        const traded = await bot.interactNpc(/^tanner$/i, /trade/i);
        if (!traded.success) {
            log(`Tanner trade: ${traded.message}`);
            await bot.talkTo(/^tanner$/i);
            await clickYesOkOrContinue();
        }
        await sdk.waitForCondition((s) => s.interface?.isOpen === true, 8_000).catch(() => {});
        if (sdk.getState()?.interface?.isOpen) {
            const clicked = await sdk.clickInterfaceOption(/tan all.*soft leather/i);
            if (!clicked.success) log(`Tan all: ${clicked.message}`);
        }
        await sdk.waitForCondition(() => count(HIDE) < before, 8_000).catch(() => {});
        await closeUi();
        log(`Tanned ${before - count(HIDE)} hides, leather=${count(LEATHER)}`);
        return count(HIDE) === 0;
    }

    async function bankLeather(): Promise<boolean> {
        await closeUi();
        if (pos().x < 3272 && !(await crossToll(true))) return false;
        await walkNear(ALKHARID_BANK.x, ALKHARID_BANK.z, 3);
        if (!(sdk.getState()?.bank?.isOpen || (await bot.openBank()).success)) {
            log('Al Kharid bank open failed');
            return false;
        }
        if (count(LEATHER) > 0) await bot.depositItem(LEATHER, -1);
        if (count(HIDE) > 0) await bot.depositItem(HIDE, -1);
        const have = count(COINS);
        if (have < TARGET_GP) await bot.withdrawItem(COINS, TARGET_GP - have);
        if (!hasPickaxe()) {
            const pick = sdk.findBankItem(PICKAXE);
            if (pick) await bot.withdrawItem(pick, 1);
        }
        await bot.closeBank();
        const inv = sdk.findInventoryItem(PICKAXE);
        if (inv && !sdk.findEquipmentItem(PICKAXE)) await bot.equipItem(inv);
        log(`Banked leather @ Al Kharid gp=${count(COINS)}`);
        return true;
    }

    log(
        `cow-leather-bank start @ ${pos().x},${pos().z} gp=${count(COINS)} ` +
            `atk=${sdk.getSkill('Attack')?.baseLevel} str=${sdk.getSkill('Strength')?.baseLevel} def=${sdk.getSkill('Defence')?.baseLevel} ` +
            `home=${home.x},${home.z}`
    );
    await closeUi();
    if (!sdk.findEquipmentItem(PICKAXE) || count(COINS) < TARGET_GP) {
        if (!(await restock())) throw new Error('Could not restock pickaxe/500gp at Falador east');
    }
    await goCows();

    for (;;) {
        await closeUi();
        const p = pos();
        if (emptySlots() <= 0 && count(HIDE) > 0) {
            await buryBones();
            if (emptySlots() > 0) continue;
            log(`Inv full hides=${count(HIDE)} — tan and bank`);
            await tanHides();
            await bankLeather();
            await goCows();
            continue;
        }
        if (!inCowPen(p.x, p.z)) {
            await goCows();
            continue;
        }
        if (distTo(home.x, home.z) > 10 && !sdk.getState()?.player?.combat.inCombat) {
            const spot = randomSpot();
            await walkNear(spot.x, spot.z, 3);
        }
        await trainMelee();
        await lootDrops();
        if (!inCowPen(pos().x, pos().z)) continue;
        if (emptySlots() <= 0 && count(HIDE) > 0) continue;
        if (emptySlots() <= 0) {
            await buryBones();
            continue;
        }
        if (sdk.getState()?.player?.combat.inCombat) {
            await sdk.waitForTicks(2);
            continue;
        }
        const cow = pickCow();
        if (!cow) {
            await sdk.waitForTicks(2);
            continue;
        }
        try {
            const attack = await bot.attack(cow);
            if (!attack.success) {
                log(`Attack: ${attack.message}`);
                await sdk.waitForTicks(2);
            }
        } catch {
            await sdk.waitForTicks(1);
        }
    }
});
