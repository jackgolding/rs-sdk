/**
 * Edgeville dungeon melee — fatpig trapdoor / wildy-gate / loot / bank loop,
 * fighting with a dragon longsword (rune axe / pickaxe fallback).
 *
 *   bun bots/quests/edgeville-dungeon-melee.ts jacklove1 druids
 *   bun bots/quests/edgeville-dungeon-melee.ts jacklove3 thugs
 *
 * Bury bones. Loot herbs, nature/law runes, rares, then other runes/coins.
 * Train Attack, then Strength, then Defence, one level each. Skip a style at 99;
 * if Attack, Strength, and Defence are all 99, stay on Aggressive.
 */
import { appendFileSync } from 'fs';
import { join } from 'path';
import { runScript } from '../../sdk/runner';

const botName = process.argv.slice(2).find((a) => !a.startsWith('-') && !/^(druids|thugs)$/i.test(a)) ?? '';
const targetArg = process.argv.slice(2).find((a) => /^(druids|thugs)$/i.test(a)) ?? 'druids';
const HUNT_THUGS = /^thugs$/i.test(targetArg);
const GRIND_LOG = join(process.cwd(), 'bots', botName, 'grind.log');

const EDGEVILLE_BANK = { x: 3094, z: 3492 };
const TRAPDOOR = { x: 3095, z: 3468 };
const DUNGEON_LADDER = { x: 3096, z: 9867 };
const WILDY_GATE = { x: 3103, z: 9909 };
const DRUIDS = { x: 3114, z: 9929 };
const THUGS = { x: 3123, z: 9929 };
const CAMP = HUNT_THUGS ? THUGS : DRUIDS;
const NPC = HUNT_THUGS ? /^thug$/i : /^chaos druid$/i;
const SKELETON_LINE = 9940;
/** Underground wildy: z 9920 is level 1, every 8 tiles +1. Level 5 is z 9952. */
const WILDY_LEVEL_5 = 9952;
const FOOD_WITHDRAW = 2;
/** OSRS-style tolerance: 10 minutes in one 21×21 area, then NPCs stop hunting. */
const AGGRO_MS = 10 * 60 * 1000;
/** South of the camp's 21×21 box, at the wilderness gate — not red spiders / bone piles. */
const AGGRO_SOUTH = { x: 3108, z: 9914 };

const HERB =
    /^(herb|guam leaf|marrentill|tarromin|harralander|ranarr weed|toadflax|irit leaf|avantoe|kwuarm|cadantine|lantadyme|dwarf weed|torstol|.+ (leaf|weed))$/i;
const GOOD_RUNE = /^(nature|law|death|cosmic|blood|chaos) rune$/i;
const JUNK_RUNE = /^(air|mind|water|earth|fire|body) rune$/i;
const COINS = /^coins$/i;
const RARE =
    /^(uncut )?(sapphire|emerald|ruby|diamond|dragonstone)$|^snape grass$|^bronze longsword$|^iron med helm$|^iron battleaxe$|^steel axe$|^clue scroll|^loop half of a key$|^tooth half of a key$|^left half shield$|^dragon spear$/i;
const BONES = /^bones$/i;

function isLoot(name: string): boolean {
    if (JUNK_RUNE.test(name)) return false;
    return HERB.test(name) || GOOD_RUNE.test(name) || RARE.test(name) || COINS.test(name);
}

function lootPriority(name: string): number {
    if (GOOD_RUNE.test(name)) return 0;
    if (HERB.test(name)) return 1;
    if (RARE.test(name)) return 2;
    if (COINS.test(name)) return 3;
    if (BONES.test(name)) return 9;
    return 5;
}
const FOOD = /^tuna$/i;
const RUNE_AXE = /^rune axe$/i;
const RUNE_PICK = /^rune pickaxe$/i;
const DLONG = /^dragon longsword$/i;
const DDAGGER = /^dragon dagger/i;
const ESSENCE = /^(pure essence|rune essence)$/i;
const WEAPON = /^(dragon longsword|rune (axe|pickaxe))$/i;
const KEEP = /^(tuna|rune axe|rune pickaxe)$/i;
const JACKTHIEF = /^Jackthief$/i;
const CYCLE = ['Attack', 'Strength', 'Defence'] as const;

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
            hp: p?.hp ?? 10,
            maxHp: p?.maxHp ?? 10,
            isDead: p?.isDead ?? false,
            inCombat: p?.combat?.inCombat ?? false,
            targetType: p?.combat?.targetType ?? 'none',
            targetIndex: p?.combat?.targetIndex ?? -1
        };
    };
    const distTo = (x: number, z: number) => Math.hypot(pos().x - x, pos().z - z);
    const inDungeon = () => pos().z > 6400;
    const count = (pattern: RegExp) =>
        sdk.getInventory().filter((i) => pattern.test(i.name)).reduce((n, i) => n + (i.count ?? 1), 0);
    const occupied = () => sdk.getInventory().filter((i) => (i.count ?? 0) > 0).length;
    const canEat = (item: { optionsWithIndex?: { text: string }[] }) =>
        (item.optionsWithIndex ?? []).some((o) => /eat/i.test(o.text));
    const foodCount = () =>
        sdk
            .getInventory()
            .filter((i) => FOOD.test(i.name) && canEat(i))
            .reduce((n, i) => n + (i.count ?? 1), 0);
    const herbSlots = () => sdk.getInventory().filter((i) => HERB.test(i.name)).length;
    const skill = (name: (typeof CYCLE)[number]) => sdk.getSkill(name)?.baseLevel ?? 1;
    /** Lost City is required to wield dragon. False after a failed equip; stick to rune pickaxe. */
    let canWieldDlong = true;
    const hasWeapon = () =>
        !!(
            sdk.findEquipmentItem(RUNE_AXE) ||
            sdk.findEquipmentItem(RUNE_PICK) ||
            sdk.findEquipmentItem(DLONG) ||
            sdk.findInventoryItem(RUNE_AXE) ||
            sdk.findInventoryItem(RUNE_PICK) ||
            (canWieldDlong && sdk.findInventoryItem(DLONG))
        );
    const shouldKeep = (name: string) => KEEP.test(name) || (canWieldDlong && DLONG.test(name));

    function nextMeleeSkill(from: (typeof CYCLE)[number]): (typeof CYCLE)[number] {
        const start = CYCLE.indexOf(from);
        for (let i = 1; i <= CYCLE.length; i++) {
            const next = CYCLE[(start + i) % CYCLE.length]!;
            if (skill(next) < 99) return next;
        }
        return 'Strength';
    }

    let train: (typeof CYCLE)[number] = CYCLE.find((s) => skill(s) < 99) ?? 'Strength';
    let trainAt = skill(train);
    let aggroSince = Date.now();
    let packCalmSince: number | null = null;
    let resettingAggro = false;

    async function closeUi(): Promise<void> {
        await bot.dismissBlockingUI();
        if (sdk.getState()?.shop?.isOpen) await bot.closeShop();
        if (sdk.getState()?.bank?.isOpen) await bot.closeBank();
        if (sdk.getState()?.interface?.isOpen) await bot.closeInterface();
    }

    async function intent(msg: string): Promise<void> {
        await sdk.showIntent(msg).catch(() => {});
    }

    async function walkNear(x: number, z: number, tolerance = 6): Promise<boolean> {
        if (pos().hp <= Math.max(12, pos().maxHp - 10)) await eatIfNeeded();
        if (inDungeon() && z < 6400) await climbToSurface();
        if (inDungeon() && z >= SKELETON_LINE) z = SKELETON_LINE - 2;
        if (distTo(x, z) <= tolerance) return true;
        const r = await bot.walkTo(x, z, Math.min(tolerance, 3));
        if (!r.success) log(`walkTo(${x},${z}): ${r.message} @ ${pos().x},${pos().z}`);
        return r.success || distTo(x, z) <= tolerance + 2;
    }

    async function eatIfNeeded(): Promise<void> {
        const p = pos();
        if (p.hp > Math.max(18, p.maxHp - 10)) return;
        const food = sdk.findInventoryItem(FOOD);
        if (!food) return;
        const r = await bot.eatFood(food);
        if (r.success) log(`Ate tuna +${r.hpGained} HP ${pos().hp}/${pos().maxHp} left=${foodCount()}`);
        else log(`Eat failed: ${r.message} HP ${p.hp}/${p.maxHp}`);
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

    async function trainMelee(): Promise<void> {
        const all99 = CYCLE.every((s) => skill(s) >= 99);
        if (all99) {
            train = 'Strength';
            trainAt = skill(train);
        } else if (skill(train) >= 99 || skill(train) > trainAt) {
            const prev = train;
            train = nextMeleeSkill(train);
            trainAt = skill(train);
            log(`LEVEL UP ${prev} — next ${train} (atk ${skill('Attack')} str ${skill('Strength')} def ${skill('Defence')})`);
        }
        const cs = sdk.getState()?.combatStyle;
        if (!cs?.known) return;
        const style = all99
            ? (cs.styles.find((s) => /aggressive/i.test(s.type) || /aggressive/i.test(s.name)) ??
               cs.styles.find((s) => s.trainsSkills.includes('Strength') && s.trainsSkills.length === 1))
            : (cs.styles.find((s) => s.trainsSkills.includes(train) && s.trainsSkills.length === 1) ??
               cs.styles.find((s) => s.trainsSkills.includes(train)));
        if (!style || cs.currentStyle === style.index) return;
        await sdk.sendSetCombatStyle(style.index);
        await sdk.waitForCondition((s) => s.combatStyle?.currentStyle === style.index, 3_000).catch(() => {});
        log(`Style ${style.name} → ${train} (atk ${skill('Attack')} str ${skill('Strength')} def ${skill('Defence')})`);
    }

    async function equipWeapon(): Promise<void> {
        if (sdk.findEquipmentItem(DLONG)) return;
        if (canWieldDlong) {
            const dlong = sdk.findInventoryItem(DLONG);
            if (dlong) {
                const r = await bot.equipItem(dlong);
                if (sdk.findEquipmentItem(DLONG)) {
                    log('Equip dragon longsword: ok');
                    return;
                }
                canWieldDlong = false;
                log(`Cannot wield dragon longsword (${r.message}) — sticking to rune pickaxe`);
            }
        }
        if (sdk.findEquipmentItem(RUNE_AXE) || sdk.findEquipmentItem(RUNE_PICK)) return;
        const axe = sdk.findInventoryItem(RUNE_AXE);
        if (axe) {
            const r = await bot.equipItem(axe);
            log(`Equip rune axe: ${r.success ? 'ok' : r.message}`);
            if (r.success) return;
        }
        const pick = sdk.findInventoryItem(RUNE_PICK);
        if (pick) {
            const r = await bot.equipItem(pick);
            log(`Equip rune pickaxe: ${r.success ? 'ok' : r.message}`);
        }
    }

    async function openEdgevilleBank(): Promise<boolean> {
        if (inDungeon()) await climbToSurface();
        if (sdk.getState()?.shop?.isOpen) await bot.closeShop();
        if (sdk.getState()?.bank?.isOpen) {
            if (distTo(EDGEVILLE_BANK.x, EDGEVILLE_BANK.z) <= 10) return true;
            await bot.closeBank();
        }
        if (pos().x > 3120 || pos().z < 3460) {
            if (pos().z < 3320) await walkNear(3088, 3320, 8);
            if (pos().z < 3420) await walkNear(3088, 3420, 8);
        }
        await walkNear(EDGEVILLE_BANK.x, EDGEVILLE_BANK.z, 4);
        if (sdk.getState()?.bank?.isOpen) return true;
        const opened = await bot.openBank();
        if (!opened.success) {
            log(`openBank failed: ${opened.message}`);
            return false;
        }
        return true;
    }

    async function depositJunk(): Promise<void> {
        for (let i = 0; i < 40; i++) {
            const item = sdk.getInventory().find((it) => (it.count ?? 0) > 0 && !shouldKeep(it.name));
            if (!item) break;
            const r = await bot.depositItem(item, -1);
            log(`Deposit ${item.name}: ${r.success || r.partial ? 'ok' : r.message}`);
            if (!r.success && !r.partial) break;
        }
        for (let i = 0; i < 8; i++) {
            const noted = sdk.getInventory().find((it) => FOOD.test(it.name) && !canEat(it));
            if (!noted) break;
            const r = await bot.depositItem(noted, -1);
            log(`Deposit noted tuna: ${r.success || r.partial ? 'ok' : r.message}`);
            if (!r.success && !r.partial) break;
        }
        const extraFood = foodCount() - FOOD_WITHDRAW;
        if (extraFood > 0) {
            const r = await bot.depositItem(FOOD, extraFood);
            log(`Park extra tuna: ${r.success || r.partial ? 'ok' : r.message} now ${foodCount()}`);
        }
    }

    async function withdrawLoadout(): Promise<void> {
        if (!hasWeapon()) {
            if (canWieldDlong) {
                const bankDlong = sdk.findBankItem(DLONG);
                if (bankDlong) {
                    const r = await bot.withdrawItem(bankDlong, 1);
                    log(`Withdraw dragon longsword: ${r.success || r.partial ? 'ok' : r.message}`);
                }
            }
            if (!hasWeapon()) {
                const bankAxe = sdk.findBankItem(RUNE_AXE);
                if (bankAxe) {
                    const r = await bot.withdrawItem(bankAxe, 1);
                    log(`Withdraw rune axe: ${r.success || r.partial ? 'ok' : r.message}`);
                }
            }
            if (!hasWeapon()) {
                const bankPick = sdk.findBankItem(RUNE_PICK);
                if (bankPick) {
                    const r = await bot.withdrawItem(bankPick, 1);
                    log(`Withdraw rune pickaxe: ${r.success || r.partial ? 'ok' : r.message}`);
                }
            }
        }
        const need = FOOD_WITHDRAW - foodCount();
        if (need > 0) {
            const bankFood = sdk.findBankItem(FOOD)?.count ?? 0;
            if (bankFood > 0) {
                const r = await bot.withdrawItem(FOOD, Math.min(need, bankFood), { asNote: false });
                log(`Withdraw tuna: ${r.success || r.partial ? 'ok' : r.message} now ${foodCount()}`);
                const leftoverNotes = sdk.getInventory().find((it) => FOOD.test(it.name) && !canEat(it));
                if (leftoverNotes) {
                    log('Tuna came out noted — depositing and retrying unnoted');
                    await bot.depositItem(leftoverNotes, -1);
                    const retry = await bot.withdrawItem(FOOD, FOOD_WITHDRAW, { asNote: false });
                    log(`Retry tuna: ${retry.success || retry.partial ? 'ok' : retry.message} now ${foodCount()}`);
                }
            }
        }
    }

    async function prepareLoadout(): Promise<void> {
        await intent(canWieldDlong ? 'Edgeville bank — 2 tuna + dragon longsword' : 'Edgeville bank — 2 tuna + rune pickaxe');
        if (inDungeon()) await climbToSurface();
        if (!(await openEdgevilleBank())) return;
        await depositJunk();
        await withdrawLoadout();
        await bot.closeBank();
        await equipWeapon();
        log(
            `Loadout food=${foodCount()} weapon=${sdk.findEquipmentItem(WEAPON)?.name ?? sdk.findInventoryItem(WEAPON)?.name ?? 'none'}`
        );
    }

    function herbUnits(): number {
        return sdk.getInventory().filter((i) => HERB.test(i.name)).reduce((n, i) => n + (i.count ?? 1), 0);
    }

    function hasDlong(): boolean {
        return !!(sdk.findEquipmentItem(DLONG) || sdk.findInventoryItem(DLONG));
    }

    async function depositAll(): Promise<void> {
        for (let i = 0; i < 40; i++) {
            const item = sdk.getInventory().find((it) => (it.count ?? 0) > 0);
            if (!item) break;
            const r = await bot.depositItem(item, -1);
            log(`Deposit ${item.name}: ${r.success || r.partial ? 'ok' : r.message}`);
            if (!r.success && !r.partial) break;
        }
    }

    async function withdrawAllHerbs(): Promise<number> {
        // Leave 3 slots for the dragon kit coming back.
        for (let i = 0; i < 28 && occupied() < 25; i++) {
            const herb = sdk.findBankItem(HERB);
            if (!herb) break;
            const r = await bot.withdrawItem(herb, -1);
            log(`Withdraw ${herb.name}: ${r.success || r.partial ? 'ok' : r.message}`);
            if (!r.success && !r.partial) break;
        }
        return herbUnits();
    }

    async function swapHerbsForDragon(): Promise<void> {
        if (hasDlong()) return;
        await intent('Edgeville — herbs for dragon kit (jackthief)');
        if (inDungeon()) await climbToSurface();
        if (!(await openEdgevilleBank())) return;
        if (canWieldDlong && sdk.findBankItem(DLONG) && !hasDlong()) {
            const r = await bot.withdrawItem(DLONG, 1);
            log(`Already banked dlong: ${r.success || r.partial ? 'ok' : r.message}`);
            await bot.closeBank();
            await equipWeapon();
            return;
        }
        await depositAll();
        const herbs = await withdrawAllHerbs();
        await bot.closeBank();
        log(`Herbs for jackthief: ${herbs}`);
        if (herbs < 1) {
            log('No herbs to trade — continuing with current weapon');
            return;
        }

        const give = Array.from({ length: herbs }, () => ({ item: HERB, amount: 1 as const }));
        let traded = false;
        let attempt = 0;
        while (!traded) {
            attempt++;
            await intent(`waiting to trade jackthief — ${herbs} herbs (${attempt})`);
            const partner = sdk.findNearbyPlayer(JACKTHIEF);
            if (!partner) {
                log(`Waiting to trade jackthief (${attempt}) @ ${pos().x},${pos().z}`);
                if (distTo(EDGEVILLE_BANK.x, EDGEVILLE_BANK.z) > 6) {
                    await walkNear(EDGEVILLE_BANK.x, EDGEVILLE_BANK.z, 3);
                }
                await sdk.waitForTicks(10);
                continue;
            }
            log(`jackthief in range — sending trade (${attempt})`);
            const r = await bot.trade(partner, {
                give,
                want: [
                    { item: DLONG, amount: 1 },
                    { item: DDAGGER, amount: 1 },
                    { item: ESSENCE, amount: 1000 }
                ],
                retryOnBusy: true,
                requestTimeout: 90_000,
                timeout: 120_000
            });
            log(
                `Trade jackthief: ${r.success ? 'ok' : r.message} ` +
                    `got=${r.received.map((i) => `${i.count} ${i.name}`).join(', ') || '—'}`
            );
            traded = r.success;
            if (!traded) await sdk.waitForTicks(5);
        }

        if (!(await openEdgevilleBank())) return;
        await depositAll();
        if (canWieldDlong && sdk.findBankItem(DLONG)) {
            const r = await bot.withdrawItem(DLONG, 1);
            log(`Withdraw dlong: ${r.success || r.partial ? 'ok' : r.message}`);
        }
        await bot.closeBank();
        await equipWeapon();
        if (!canWieldDlong) log('Dragon longsword parked — melee continues on rune pickaxe');
    }

    async function climbIntoDungeon(): Promise<boolean> {
        if (inDungeon()) return true;
        await walkNear(TRAPDOOR.x, TRAPDOOR.z, 1);
        for (let attempt = 0; attempt < 4 && !inDungeon(); attempt++) {
            const trap = sdk.findNearbyLoc(/trapdoor/i);
            log(
                `Trapdoor try ${attempt}: ${trap ? `${trap.name} [${trap.optionsWithIndex.map((o) => o.text).join(', ')}]` : 'none'} @ ${pos().x},${pos().z}`
            );
            if (!trap) {
                await sdk.waitForTicks(1);
                continue;
            }
            if (trap.optionsWithIndex.some((o) => /^open$/i.test(o.text))) {
                await bot.interactLoc(trap, /^open$/i);
                await sdk
                    .waitForCondition(
                        (s) =>
                            (s.nearbyLocs ?? []).some(
                                (l) => /trapdoor/i.test(l.name) && l.optionsWithIndex.some((o) => /climb-down/i.test(o.text))
                            ),
                        6_000
                    )
                    .catch(() => {});
            }
            const down = sdk.findNearbyLoc(/trapdoor/i, { withOption: /climb-down/i });
            if (down) {
                await bot.interactLoc(down, /climb-down/i);
                await sdk.waitForCondition((s) => (s.player?.worldZ ?? 0) > 6400, 8_000).catch(() => {});
            }
        }
        log(`Dungeon ${inDungeon()} @ ${pos().x},${pos().z}`);
        return inDungeon();
    }

    async function climbToSurface(): Promise<boolean> {
        if (!inDungeon()) return true;
        await eatIfNeeded();
        if (pos().z >= WILDY_GATE.z) {
            await walkNear(WILDY_GATE.x, WILDY_GATE.z + 6, 3);
            const gate = sdk.findNearbyLoc(/gate/i, { withOption: /open/i });
            if (gate) await bot.openDoor(gate);
            await walkNear(WILDY_GATE.x, WILDY_GATE.z - 6, 3);
        }
        await walkNear(DUNGEON_LADDER.x, DUNGEON_LADDER.z, 2);
        const ladder = sdk.findNearbyLoc(/^ladder$/i, { withOption: /climb-up/i });
        if (ladder) {
            await bot.interactLoc(ladder, /climb-up/i);
            await sdk.waitForCondition((s) => (s.player?.worldZ ?? 0) < 6400, 10_000).catch(() => {});
        }
        log(`Surface ${!inDungeon()} @ ${pos().x},${pos().z}`);
        return !inDungeon();
    }

    async function goToCamp(): Promise<void> {
        if (!inDungeon() && !(await climbIntoDungeon())) return;
        if (pos().z < WILDY_GATE.z - 4) {
            await walkNear(WILDY_GATE.x, WILDY_GATE.z - 2, 3);
            const gate = sdk.findNearbyLoc(/gate/i, { withOption: /open/i });
            if (gate) await bot.openDoor(gate);
        }
        await walkNear(CAMP.x, CAMP.z, 6);
        aggroSince = Date.now();
        packCalmSince = null;
    }

    function nearbySkeleton() {
        return (
            (sdk.getNearbyNpcs() ?? []).find(
                (n) =>
                    /^skeleton$/i.test(n.name) &&
                    (n.hp === null || n.hp > 0) &&
                    (n.distance ?? 99) <= 8
            ) ?? null
        );
    }

    function fightingSkeleton(): boolean {
        const p = pos();
        if (!p.inCombat || p.targetType !== 'npc' || p.targetIndex < 0) return false;
        const target = sdk.getNearbyNpcs().find((n) => n.index === p.targetIndex);
        return !!target && /^skeleton$/i.test(target.name);
    }

    async function fleeSkeletons(): Promise<boolean> {
        const tooNorth = pos().z >= SKELETON_LINE || pos().z >= WILDY_LEVEL_5;
        const skel = nearbySkeleton();
        if (!tooNorth && !skel && !fightingSkeleton()) return false;
        log(
            `Backing south` +
                (skel ? ` (skeleton ${skel.x},${skel.z})` : '') +
                (fightingSkeleton() ? ' (in skeleton combat)' : '') +
                (tooNorth ? ` (z ${pos().z})` : '')
        );
        await walkNear(CAMP.x, CAMP.z - 8, 3);
        if (pos().z >= SKELETON_LINE) await walkNear(AGGRO_SOUTH.x, AGGRO_SOUTH.z, 3);
        return true;
    }

    function packIsCalmBesideUs(): boolean {
        if (pos().inCombat) return false;
        return (sdk.getNearbyNpcs() ?? []).some(
            (n) =>
                NPC.test(n.name) &&
                !n.inCombat &&
                (n.hp === null || n.hp > 0) &&
                (n.distance ?? 99) <= 3
        );
    }

    async function resetAggro(): Promise<void> {
        resettingAggro = true;
        log(`Aggro reset — south to gate (${AGGRO_SOUTH.x},${AGGRO_SOUTH.z})`);
        await eatIfNeeded();
        await walkNear(AGGRO_SOUTH.x, AGGRO_SOUTH.z, 3);
        await eatIfNeeded();
        await sdk.waitForTicks(2);
        await walkNear(CAMP.x, CAMP.z, 5);
        aggroSince = Date.now();
        packCalmSince = null;
        resettingAggro = false;
        log(`Back at camp after aggro reset @ ${pos().x},${pos().z}`);
    }

    async function maybeResetAggro(): Promise<boolean> {
        if (!inDungeon() || distTo(CAMP.x, CAMP.z) > 20) return false;
        if (pos().inCombat) {
            packCalmSince = null;
            return false;
        }
        if (packIsCalmBesideUs()) {
            packCalmSince ??= Date.now();
        } else {
            packCalmSince = null;
        }
        const timedOut = Date.now() - aggroSince >= AGGRO_MS;
        const lostEarly = packCalmSince !== null && Date.now() - packCalmSince >= 12_000;
        if (!timedOut && !lostEarly) return false;
        log(timedOut ? '10 min aggro timer — resetting' : 'Pack standing idle beside us — resetting');
        await resetAggro();
        return true;
    }

    async function lootGround(): Promise<void> {
        for (let i = 0; i < 12; i++) {
            await eatIfNeeded();
            await buryBones();
            if (occupied() >= 28) break;
            const scanned = await sdk.scanGroundItems(8).catch(() => sdk.getGroundItems() ?? []);
            const item = scanned
                .filter(
                    (g) =>
                        (isLoot(g.name) || BONES.test(g.name)) &&
                        g.reachable !== false &&
                        (g.distance ?? 99) <= 8 &&
                        (g.z ?? 0) < SKELETON_LINE
                )
                .sort((a, b) => {
                    const d = lootPriority(a.name) - lootPriority(b.name);
                    if (d !== 0) return d;
                    return (a.distance ?? 99) - (b.distance ?? 99);
                })[0];
            if (!item) return;
            const r = await bot.pickupItem(item);
            if (!r.success) {
                log(`Pickup ${item.name} failed: ${r.message}`);
                if (/full|no space|inventory/i.test(r.message ?? '')) break;
                continue;
            }
        }
        await buryBones();
    }

    function findTarget() {
        const mine = pos().targetIndex;
        const npcs = (sdk.getNearbyNpcs() ?? [])
            .filter(
                (n) =>
                    NPC.test(n.name) &&
                    (n.hp === null || n.hp > 0) &&
                    n.z < SKELETON_LINE &&
                    n.optionsWithIndex.some((o) => /attack/i.test(o.text)) &&
                    n.reachable !== false
            )
            .sort((a, b) => (a.distance ?? 99) - (b.distance ?? 99));
        const free = npcs.filter((n) => !n.inCombat || n.index === mine);
        return free[0] ?? null;
    }

    function hasValidNpcTarget(): boolean {
        const p = pos();
        if (!p.inCombat || p.targetType !== 'npc' || p.targetIndex < 0) return false;
        const target = sdk.getNearbyNpcs().find((n) => n.index === p.targetIndex);
        return (
            !!target &&
            NPC.test(target.name) &&
            target.z < SKELETON_LINE &&
            (target.hp === null || target.hp > 0)
        );
    }

    async function fight(): Promise<void> {
        if (hasValidNpcTarget()) {
            const until = Date.now() + 25_000;
            while (hasValidNpcTarget() && !pos().isDead && Date.now() < until) {
                await bot.dismissBlockingUI();
                await eatIfNeeded();
                await trainMelee();
                await lootGround();
            }
            return;
        }
        const target = findTarget();
        if (!target) {
            if (distTo(CAMP.x, CAMP.z) > 8) await walkNear(CAMP.x, CAMP.z, 5);
            else await sdk.waitForTicks(1);
            return;
        }
        const r = await bot.attack(target, 8_000);
        if (!r.success) log(`Attack ${target.name}: ${r.message}`);
    }

    log(
        `Edgeville melee ${HUNT_THUGS ? 'thugs' : 'chaos druids'} ` +
            `atk ${skill('Attack')} str ${skill('Strength')} def ${skill('Defence')} @ ${pos().x},${pos().z}`
    );
    await closeUi();
    await swapHerbsForDragon();
    await prepareLoadout();
    if (foodCount() < 1 || !hasWeapon()) {
        throw new Error(`Need tuna + weapon (food=${foodCount()} weapon=${hasWeapon()})`);
    }
    await goToCamp();
    await trainMelee();

    while (true) {
        await bot.dismissBlockingUI();
        if (pos().isDead) {
            log('Died — waiting to respawn');
            await sdk.waitForCondition((s) => !s.player.isDead, 60_000).catch(() => {});
            log(`Respawned @ ${pos().x},${pos().z}`);
            await prepareLoadout();
            await goToCamp();
            continue;
        }
        if (pos().targetType === 'player' && pos().inCombat) {
            log('Player combat — running to ladder');
            await walkNear(DUNGEON_LADDER.x, DUNGEON_LADDER.z, 4);
            await climbToSurface();
            await prepareLoadout();
            await goToCamp();
            continue;
        }

        await trainMelee();
        await eatIfNeeded();
        if (await fleeSkeletons()) continue;
        if (await maybeResetAggro()) continue;

        if (foodCount() === 0 || occupied() >= 28) {
            log(`Banking food=${foodCount()} herbs=${herbSlots()} slots=${occupied()}`);
            await prepareLoadout();
            if (foodCount() === 0) throw new Error('Out of tuna');
            await goToCamp();
            continue;
        }

        await lootGround();
        await intent(
            `${HUNT_THUGS ? 'thugs' : 'druids'} ${train} ` +
                `a${skill('Attack')} s${skill('Strength')} d${skill('Defence')} food ${foodCount()}`
        );
        await fight();
        await lootGround();
    }
});
