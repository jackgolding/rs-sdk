/**
 * Earth warriors — Jackthief.
 *
 *   bun bots/jackthief/earth-warriors.ts
 *
 * Edgeville bank → trapdoor → wildy gate → monkey bars → earth warriors.
 * Dragon longsword + black d'hide, 16 tuna/trip, spec when energy allows.
 * Cycle Attack → Strength → Defence one level at a time until each is 99.
 * Loot runes (incl. earth), herbs, gems, staff of earth, coins. Skip steel spears.
 * If combat goes quiet for a few hunt sessions, cross the bars to reset aggro.
 */
import { appendFileSync } from 'fs';
import { dirname, join } from 'path';
import { runScript } from '../../sdk/runner';

const GRIND_LOG = join(dirname(import.meta.path), 'grind.log');

const EDGEVILLE_BANK = { x: 3094, z: 3492 };
const TRAPDOOR = { x: 3095, z: 3468 };
const DUNGEON_LADDER = { x: 3096, z: 9867 };
const WILDY_GATE = { x: 3103, z: 9909 };
/** South end of the monkey bars (hill giant side). */
const BARS_SOUTH = { x: 3120, z: 9963 };
/** North end of the monkey bars (earth warrior side). */
const BARS_NORTH = { x: 3121, z: 9971 };
/** Between the two earth-warrior packs (3118,9974) and (3116,9992). */
const CAMP = { x: 3118, z: 9978 };
/** Hill-giant tiles south of the bars — outside the camp's 21×21 aggro box. */
const AGGRO_SOUTH = { x: 3118, z: 9955 };
const HUNT = { minX: 3108, maxX: 3132, minZ: 9969, maxZ: 9998 };
const BARS_LINE = 9968;
const FOOD_WITHDRAW = 16;
const IDLE_SESSIONS = 3;
const PACK_IDLE_MS = 12_000;
const AGGRO_MS = 10 * 60 * 1000;

/** combat_hacksword:specbar — Cleave, 25% (250/1000). */
const HACKSWORD_SPECBAR = 7587;
const DLONG_SPEC_COST = 250;
const SPEC_MAX = 1000;
const SPEC_REGEN = 100;
const SPEC_REGEN_TICKS = 50;

const BLACK_BODY_ID = 2503;
const BLACK_CHAPS_ID = 2497;
const DLONG_ID = 1305;

const CYCLE = ['Attack', 'Strength', 'Defence'] as const;
const NPC = /^earth warrior$/i;
const FOOD = /^tuna$/i;
const DLONG = /^dragon longsword$/i;
const DHIDE_BODY =
    /^(black d'?hide (body|chest|top)|black dragonhide body|dragonhide body)$/i;
const DHIDE_CHAPS = /^(black d'?hide chaps|black dragonhide chaps|dragonhide chaps)$/i;
const HERB =
    /^(herb|guam leaf|marrentill|tarromin|harralander|ranarr weed|toadflax|irit leaf|avantoe|kwuarm|cadantine|lantadyme|dwarf weed|torstol|.+ (leaf|weed))$/i;
const RUNE = /^(earth|nature|chaos|law|death|blood|cosmic|air|mind|water|fire|body) rune$/i;
const COINS = /^coins$/i;
const STAFF = /^staff of earth$/i;
const GEM = /^(uncut )?(sapphire|emerald|ruby|diamond|dragonstone)$/i;
const STEEL_SPEAR = /^steel spear/i;

function isLoot(name: string): boolean {
    if (STEEL_SPEAR.test(name)) return false;
    return RUNE.test(name) || HERB.test(name) || GEM.test(name) || STAFF.test(name) || COINS.test(name);
}

function lootPriority(name: string): number {
    if (/^(nature|law|death|blood) rune$/i.test(name)) return 0;
    if (HERB.test(name)) return 1;
    if (STAFF.test(name) || GEM.test(name)) return 2;
    if (RUNE.test(name)) return 3;
    if (COINS.test(name)) return 4;
    return 6;
}

function isBody(it: { id?: number; name: string }): boolean {
    return it.id === BLACK_BODY_ID || DHIDE_BODY.test(it.name);
}
function isChaps(it: { id?: number; name: string }): boolean {
    return it.id === BLACK_CHAPS_ID || DHIDE_CHAPS.test(it.name);
}
function isDlong(it: { id?: number; name: string }): boolean {
    return it.id === DLONG_ID || DLONG.test(it.name);
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
    const northOfBars = () => inDungeon() && pos().z >= BARS_LINE;
    const inHuntBox = () => {
        const p = pos();
        return p.x >= HUNT.minX && p.x <= HUNT.maxX && p.z >= HUNT.minZ && p.z <= HUNT.maxZ;
    };
    const occupied = () => sdk.getInventory().filter((i) => (i.count ?? 0) > 0).length;
    const canEat = (item: { optionsWithIndex?: { text: string }[] }) =>
        (item.optionsWithIndex ?? []).some((o) => /eat/i.test(o.text));
    const foodCount = () =>
        sdk
            .getInventory()
            .filter((i) => FOOD.test(i.name) && canEat(i))
            .reduce((n, i) => n + (i.count ?? 1), 0);
    const skill = (name: (typeof CYCLE)[number]) => sdk.getSkill(name)?.baseLevel ?? 1;
    const agility = () => sdk.getSkill('Agility')?.baseLevel ?? 1;

    const wearingDlong = () => sdk.getEquipment().some(isDlong);
    const wearingBody = () => sdk.getEquipment().some(isBody);
    const wearingChaps = () => sdk.getEquipment().some(isChaps);
    const hasDlong = () => wearingDlong() || sdk.getInventory().some(isDlong);
    const hasBody = () => wearingBody() || sdk.getInventory().some(isBody);
    const hasChaps = () => wearingChaps() || sdk.getInventory().some(isChaps);
    const shouldKeep = (name: string, id?: number) => {
        const it = { id, name };
        return FOOD.test(name) || isDlong(it) || isBody(it) || isChaps(it);
    };

    const under99 = () => CYCLE.filter((s) => skill(s) < 99);
    const nextTrain = (from: (typeof CYCLE)[number]): (typeof CYCLE)[number] => {
        const open = under99();
        if (open.length === 0) return 'Strength';
        for (let i = 1; i <= CYCLE.length; i++) {
            const s = CYCLE[(CYCLE.indexOf(from) + i) % CYCLE.length]!;
            if (skill(s) < 99) return s;
        }
        return open[0]!;
    };
    const lowestTrain = (): (typeof CYCLE)[number] => {
        const open = under99();
        if (open.length === 0) return 'Strength';
        return open.reduce((a, b) => (skill(a) <= skill(b) ? a : b));
    };

    let train: (typeof CYCLE)[number] = lowestTrain();
    let trainAt = skill(train);
    let specEnergy = SPEC_MAX;
    let specArmed = false;
    let lastSpecRegenTick = -1;
    let aggroSince = Date.now();
    let packCalmSince: number | null = null;
    let idleSessions = 0;

    async function closeUi(): Promise<void> {
        await bot.dismissBlockingUI();
        if (sdk.getState()?.shop?.isOpen) await bot.closeShop();
        if (sdk.getState()?.bank?.isOpen) await bot.closeBank();
        if (sdk.getState()?.interface?.isOpen) await bot.closeInterface();
    }

    async function intent(msg: string): Promise<void> {
        await sdk.showIntent(msg).catch(() => {});
    }

    function tickSpecRegen(): void {
        const tick = sdk.getState()?.tick ?? 0;
        if (lastSpecRegenTick < 0) lastSpecRegenTick = tick;
        if (specEnergy >= SPEC_MAX) {
            lastSpecRegenTick = tick;
            return;
        }
        while (tick - lastSpecRegenTick >= SPEC_REGEN_TICKS && specEnergy < SPEC_MAX) {
            specEnergy = Math.min(SPEC_MAX, specEnergy + SPEC_REGEN);
            lastSpecRegenTick += SPEC_REGEN_TICKS;
        }
    }

    async function enableDlongSpec(): Promise<boolean> {
        tickSpecRegen();
        if (!wearingDlong()) return false;
        if (specEnergy < DLONG_SPEC_COST) return false;
        if (specArmed) return true;
        await sdk.sendSetTab(0).catch(() => {});
        const r = await sdk.sendClickComponent(HACKSWORD_SPECBAR);
        if (!r.success) {
            log(`Spec bar click failed: ${r.message}`);
            return false;
        }
        specArmed = true;
        return true;
    }

    function noteSpecUsed(): void {
        if (!specArmed) return;
        specArmed = false;
        specEnergy = Math.max(0, specEnergy - DLONG_SPEC_COST);
    }

    async function walkNear(x: number, z: number, tolerance = 6): Promise<boolean> {
        if (pos().hp <= Math.max(12, pos().maxHp - 10)) await eatIfNeeded();
        if (inDungeon() && z < 6400) await climbToSurface();
        if (distTo(x, z) <= tolerance) return true;
        const r = await bot.walkTo(x, z, Math.min(tolerance, 3));
        if (!r.success) log(`walkTo(${x},${z}): ${r.message} @ ${pos().x},${pos().z}`);
        return r.success || distTo(x, z) <= tolerance + 2;
    }

    async function eatIfNeeded(): Promise<void> {
        const p = pos();
        if (p.hp > 20 && p.hp > p.maxHp - 10) return;
        const food = sdk.getInventory().find((i) => FOOD.test(i.name) && canEat(i));
        if (!food) return;
        const r = await bot.eatFood(food);
        if (r.success) log(`Ate tuna +${r.hpGained} HP ${pos().hp}/${pos().maxHp} left=${foodCount()}`);
        else log(`Eat failed: ${r.message} HP ${p.hp}/${p.maxHp}`);
    }

    async function trainMelee(): Promise<void> {
        if (skill(train) > trainAt || skill(train) >= 99) {
            const prev = train;
            train = nextTrain(train);
            trainAt = skill(train);
            if (prev !== train) {
                log(
                    `LEVEL UP ${prev} — next ${train} (atk ${skill('Attack')} str ${skill('Strength')} def ${skill('Defence')})`
                );
            }
        }
        const cs = sdk.getState()?.combatStyle;
        if (!cs?.known) return;
        const style =
            cs.styles.find((s) => s.trainsSkills.includes(train) && s.trainsSkills.length === 1) ??
            cs.styles.find((s) => s.trainsSkills.includes(train));
        if (!style || cs.currentStyle === style.index) return;
        await sdk.sendSetCombatStyle(style.index);
        await sdk.waitForCondition((s) => s.combatStyle?.currentStyle === style.index, 3_000).catch(() => {});
        log(`Style ${style.name} → ${train} (atk ${skill('Attack')} str ${skill('Strength')} def ${skill('Defence')})`);
    }

    async function equipLoadout(): Promise<void> {
        if (!wearingDlong()) {
            const dlong = sdk.getInventory().find(isDlong);
            if (dlong) {
                const r = await bot.equipItem(dlong);
                log(`Equip dragon longsword: ${r.success ? 'ok' : r.message}`);
            }
        }
        if (!wearingBody()) {
            const body = sdk.getInventory().find(isBody);
            if (body) {
                const r = await bot.equipItem(body);
                log(`Equip d'hide body: ${r.success ? 'ok' : r.message}`);
            }
        }
        if (!wearingChaps()) {
            const chaps = sdk.getInventory().find(isChaps);
            if (chaps) {
                const r = await bot.equipItem(chaps);
                log(`Equip d'hide chaps: ${r.success ? 'ok' : r.message}`);
            }
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

    function bankById(id: number) {
        return sdk.getBankItems().find((i) => i.id === id);
    }

    async function depositJunk(): Promise<void> {
        for (let i = 0; i < 40; i++) {
            const item = sdk.getInventory().find((it) => (it.count ?? 0) > 0 && !shouldKeep(it.name, it.id));
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

    async function withdrawOne(id: number, pattern: RegExp, label: string): Promise<void> {
        const item = bankById(id) ?? sdk.findBankItem(pattern);
        if (!item) {
            log(`Bank missing ${label}`);
            return;
        }
        const r = await bot.withdrawItem(item, 1);
        log(`Withdraw ${item.name}: ${r.success || r.partial ? 'ok' : r.message}`);
    }

    async function withdrawLoadout(): Promise<void> {
        if (!hasDlong()) await withdrawOne(DLONG_ID, DLONG, 'dragon longsword');
        if (!hasBody()) await withdrawOne(BLACK_BODY_ID, DHIDE_BODY, "black d'hide body");
        if (!hasChaps()) await withdrawOne(BLACK_CHAPS_ID, DHIDE_CHAPS, "black d'hide chaps");
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
        await intent("Edgeville bank — dlong + black d'hide + 16 tuna");
        if (inDungeon()) await climbToSurface();
        if (!(await openEdgevilleBank())) return;
        await depositJunk();
        await withdrawLoadout();
        await bot.closeBank();
        await equipLoadout();
        await trainMelee();
        log(
            `Loadout food=${foodCount()} dlong=${wearingDlong()} body=${wearingBody()} chaps=${wearingChaps()} train=${train}`
        );
    }

    async function findBars() {
        return (
            sdk.findNearbyLoc(/monkey\s*bars/i, { withOption: /swing across/i }) ??
            sdk.findNearbyLoc(/monkey\s*bars/i)
        );
    }

    async function swingBars(dir: 'north' | 'south'): Promise<boolean> {
        const wantNorth = dir === 'north';
        if (wantNorth && northOfBars()) return true;
        if (!wantNorth && inDungeon() && !northOfBars()) return true;
        const stand = wantNorth ? BARS_SOUTH : BARS_NORTH;
        await walkNear(stand.x, stand.z, 2);
        for (let attempt = 0; attempt < 4; attempt++) {
            if (wantNorth === northOfBars()) return true;
            let bars = await findBars();
            if (!bars) {
                await sdk.scanNearbyLocs(10).catch(() => []);
                bars = await findBars();
            }
            log(
                `Monkey bars ${dir} try ${attempt}: ${
                    bars
                        ? `${bars.name} [${bars.optionsWithIndex.map((o) => o.text).join(', ')}] @ ${bars.x},${bars.z}`
                        : 'none'
                } player ${pos().x},${pos().z}`
            );
            if (!bars) {
                await sdk.waitForTicks(1);
                continue;
            }
            const startZ = pos().z;
            const r = await bot.interactLoc(bars, /swing across/i);
            if (!r.success) log(`Swing across: ${r.message}`);
            await sdk
                .waitForCondition(() => {
                    const z = sdk.getState()?.player?.worldZ ?? 0;
                    return wantNorth ? z >= BARS_LINE : z < BARS_LINE && z > 6400;
                }, 12_000)
                .catch(() => {});
            if (wantNorth === northOfBars()) {
                log(`Crossed monkey bars ${dir} @ ${pos().x},${pos().z}`);
                return true;
            }
            if (pos().z === startZ) await sdk.waitForTicks(2);
        }
        log(`Monkey bars ${dir} failed @ ${pos().x},${pos().z}`);
        return wantNorth === northOfBars();
    }

    async function climbIntoDungeon(): Promise<boolean> {
        if (inDungeon()) return true;
        await walkNear(TRAPDOOR.x, TRAPDOOR.z, 1);
        for (let attempt = 0; attempt < 4 && !inDungeon(); attempt++) {
            const trap = sdk.findNearbyLoc(/trapdoor/i);
            log(
                `Trapdoor try ${attempt}: ${
                    trap ? `${trap.name} [${trap.optionsWithIndex.map((o) => o.text).join(', ')}]` : 'none'
                } @ ${pos().x},${pos().z}`
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

    /** Red-spider pocket east of the hill giants — a straight walk to the wildy gate dies in the lava pit. */
    async function leaveEastCave(): Promise<void> {
        if (!inDungeon() || northOfBars() || pos().x < 3126) return;
        await walkNear(3124, 9948, 3);
        await walkNear(3116, 9952, 3);
        await walkNear(3108, 9936, 4);
    }

    async function climbToSurface(): Promise<boolean> {
        if (!inDungeon()) return true;
        for (let attempt = 0; attempt < 3 && inDungeon(); attempt++) {
            await eatIfNeeded();
            if (northOfBars()) await swingBars('south');
            await leaveEastCave();
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
        if (!northOfBars()) {
            await leaveEastCave();
            await walkNear(BARS_SOUTH.x, BARS_SOUTH.z, 2);
            await swingBars('north');
        }
        await walkNear(CAMP.x, CAMP.z, 6);
        aggroSince = Date.now();
        packCalmSince = null;
        idleSessions = 0;
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
        log(`Aggro reset — south across monkey bars to ${AGGRO_SOUTH.x},${AGGRO_SOUTH.z}`);
        await eatIfNeeded();
        await swingBars('south');
        await walkNear(AGGRO_SOUTH.x, AGGRO_SOUTH.z, 3);
        await eatIfNeeded();
        await sdk.waitForTicks(2);
        await swingBars('north');
        await walkNear(CAMP.x, CAMP.z, 5);
        aggroSince = Date.now();
        packCalmSince = null;
        idleSessions = 0;
        log(`Back at camp after aggro reset @ ${pos().x},${pos().z}`);
    }

    async function maybeResetAggro(): Promise<boolean> {
        if (!inDungeon() || !northOfBars()) return false;
        if (pos().inCombat) {
            packCalmSince = null;
            idleSessions = 0;
            return false;
        }
        if (packIsCalmBesideUs()) {
            packCalmSince ??= Date.now();
        } else {
            packCalmSince = null;
        }
        const timedOut = Date.now() - aggroSince >= AGGRO_MS;
        const lostEarly = packCalmSince !== null && Date.now() - packCalmSince >= PACK_IDLE_MS;
        const quietSessions = idleSessions >= IDLE_SESSIONS;
        if (!timedOut && !lostEarly && !quietSessions) return false;
        log(
            timedOut
                ? '10 min aggro timer — resetting'
                : quietSessions
                  ? `${IDLE_SESSIONS} hunt sessions with no combat — resetting aggro`
                  : 'Pack standing idle beside us — resetting'
        );
        await resetAggro();
        return true;
    }

    async function lootGround(): Promise<void> {
        for (let i = 0; i < 12; i++) {
            await eatIfNeeded();
            if (occupied() >= 28) break;
            const scanned = await sdk.scanGroundItems(8).catch(() => sdk.getGroundItems() ?? []);
            const item = scanned
                .filter(
                    (g) =>
                        isLoot(g.name) &&
                        g.reachable !== false &&
                        (g.distance ?? 99) <= 8 &&
                        (g.z ?? 0) >= HUNT.minZ
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
    }

    function findTarget() {
        const mine = pos().targetIndex;
        const npcs = (sdk.getNearbyNpcs() ?? [])
            .filter(
                (n) =>
                    NPC.test(n.name) &&
                    (n.hp === null || n.hp > 0) &&
                    n.z >= HUNT.minZ &&
                    n.z <= HUNT.maxZ &&
                    n.optionsWithIndex.some((o) => /attack/i.test(o.text)) &&
                    n.reachable !== false
            )
            .sort((a, b) => (a.distance ?? 99) - (b.distance ?? 99));
        return npcs.filter((n) => !n.inCombat || n.index === mine)[0] ?? null;
    }

    function hasValidNpcTarget(): boolean {
        const p = pos();
        if (!p.inCombat || p.targetType !== 'npc' || p.targetIndex < 0) return false;
        const target = sdk.getNearbyNpcs().find((n) => n.index === p.targetIndex);
        return !!target && NPC.test(target.name) && (target.hp === null || target.hp > 0);
    }

    async function fight(): Promise<void> {
        if (hasValidNpcTarget()) {
            idleSessions = 0;
            const until = Date.now() + 25_000;
            while (hasValidNpcTarget() && !pos().isDead && Date.now() < until) {
                await bot.dismissBlockingUI();
                await eatIfNeeded();
                await trainMelee();
                await enableDlongSpec();
                await lootGround();
                await sdk.waitForTicks(1);
            }
            noteSpecUsed();
            return;
        }
        const target = findTarget();
        if (!target) {
            idleSessions++;
            if (distTo(CAMP.x, CAMP.z) > 8) await walkNear(CAMP.x, CAMP.z, 5);
            else await sdk.waitForTicks(1);
            return;
        }
        idleSessions = 0;
        const specced = await enableDlongSpec();
        const r = await bot.attack(target, 8_000);
        const noPower = (sdk.getState()?.gameMessages ?? []).some((m) => /enough power/i.test(m.text));
        if (noPower) {
            specArmed = false;
            specEnergy = Math.min(specEnergy, DLONG_SPEC_COST - 1);
            log(`Spec not enough power — energy tracked ${specEnergy}`);
        } else if (specced) {
            noteSpecUsed();
        }
        if (!r.success) log(`Attack ${target.name}: ${r.message}`);
    }

    if (agility() < 15) {
        throw new Error(`Need Agility 15 for the monkey bars (have ${agility()})`);
    }

    log(
        `Earth warriors atk ${skill('Attack')} str ${skill('Strength')} def ${skill('Defence')} ` +
            `agility ${agility()} train ${train} @ ${pos().x},${pos().z}`
    );
    await closeUi();
    await prepareLoadout();
    if (foodCount() < 1 || !wearingDlong()) {
        throw new Error(`Need tuna + dragon longsword (food=${foodCount()} dlong=${wearingDlong()})`);
    }
    await goToCamp();
    await trainMelee();

    while (true) {
        await bot.dismissBlockingUI();
        if (pos().isDead) {
            log('Died — waiting to respawn');
            specEnergy = SPEC_MAX;
            specArmed = false;
            lastSpecRegenTick = -1;
            await sdk.waitForCondition((s) => !s.player.isDead, 60_000).catch(() => {});
            log(`Respawned @ ${pos().x},${pos().z}`);
            await prepareLoadout();
            await goToCamp();
            continue;
        }
        if (pos().targetType === 'player' && pos().inCombat) {
            log('Player combat — crossing bars to ladder');
            await swingBars('south');
            await climbToSurface();
            await prepareLoadout();
            await goToCamp();
            continue;
        }

        await trainMelee();
        await eatIfNeeded();
        if (await maybeResetAggro()) continue;

        if (foodCount() === 0 || occupied() >= 28) {
            log(`Banking food=${foodCount()} slots=${occupied()}`);
            await prepareLoadout();
            if (foodCount() === 0) throw new Error('Out of tuna');
            await goToCamp();
            continue;
        }

        if (inDungeon() && !northOfBars() && !inHuntBox()) {
            await goToCamp();
            continue;
        }

        await lootGround();
        await intent(
            `earth warriors ${train} food ${foodCount()} spec ${Math.floor(specEnergy / 10)}% idle ${idleSessions}`
        );
        await fight();
        await lootGround();
    }
});
