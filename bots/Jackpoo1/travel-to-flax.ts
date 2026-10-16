/**
 * Bank a slash weapon, take the thieving wildy-lever route to Ardougne,
 * then walk the Seers road to the flax field.
 *
 *   import { travelToSeersFlax } from './travel-to-flax';
 */
import { BotSDK } from '../../sdk/index';
import { BotActions } from '../../sdk/actions';
import { ActivitySession } from '../../sdk/activity';
import { atSeersFlax as atFlaxCoord } from '../../sdk/regions';
import { walkSendHops } from '../quests/movement';
import {
    CATHERBY_TO_ARDY,
    WHITE_WOLF_MIN_HP,
    WHITE_WOLF_TO_CATHERBY,
    WILDY_SOUTH_TO_DITCH
} from '../quests/tiles';

const SLASH = /^(bronze |iron |steel |mithril |adamant |rune )?(axe|sword|scimitar|dagger|claws|battleaxe|longsword|2h sword)$|^knife$/i;
const SWORD = /^(bronze |iron |steel )?sword$/i;

const EDGEVILLE = { x: 3094, z: 3492 };
const EDGEVILLE_BANK = { x: 3094, z: 3492 };
const DRAYNOR_BANK = { x: 3092, z: 3243 };
/** Same as woodcutting.ts — due-north Draynor→Edgeville walks through aggressive trees. */
const DRAYNOR_TO_EDGEVILLE = [
    { x: 3048, z: 3274 },
    { x: 3006, z: 3322 },
    { x: 2965, z: 3378 },
    { x: 2965, z: 3450 },
    { x: 3020, z: 3455 },
    { x: 3087, z: 3472 }
];
const FALADOR_ESCAPE = { x: 2965, z: 3378 };
const LUMBRIDGE_MEN = { x: 3222, z: 3218 };
const BOBS_AXES = { x: 3232, z: 3203 };
const LUMBY_KNIFE = { x: 3224, z: 3202 };
const ARDOUGNE_MARKET = { x: 2662, z: 3312 };
const FLAX = { x: 2744, z: 3444 };
const WILDY_LEVER = { x: 3154, z: 3924 };
const KEEP_WEB = { x: 3158, z: 3951 };
const WEB_STAND = { x: 3158, z: 3953 };
/** Members wildy gate east of the giant spiders — around the keep fence. */
const SPIDER_GATE = { x: 3224, z: 3904 };
const PORT_SARIM_DOCK = { x: 3029, z: 3217 };
const BRIMHAVEN_CUSTOMS = { x: 2772, z: 3225 };

const WILDY_TO_LEVER = [
    { x: 3088, z: 3525 },
    { x: 3102, z: 3610 },
    { x: 3110, z: 3700 },
    { x: 3125, z: 3790 },
    { x: 3135, z: 3865 },
    { x: 3135, z: 3954 },
    { x: 3158, z: 3953 }
];
/** Same as thieving ARDY_TO_CATHERBY, cut south at Seers to the flax field. */
const ARDY_TO_FLAX = [
    { x: 2662, z: 3336 },
    { x: 2662, z: 3375 },
    { x: 2695, z: 3375 },
    { x: 2726, z: 3485 },
    { x: 2744, z: 3444 }
];
/** Magic tree cluster NE of Legends Guild (map m42_53). */
export const LEGENDS_MAGIC = { x: 2696, z: 3410 };
const ARDY_TO_LEGENDS_MAGIC = [
    { x: 2662, z: 3336 },
    { x: 2662, z: 3375 },
    { x: 2695, z: 3375 },
    { x: LEGENDS_MAGIC.x, z: LEGENDS_MAGIC.z }
];
const MUSA_TO_BRIMHAVEN = [
    { x: 2864, z: 3154 },
    { x: 2836, z: 3188 },
    { x: 2798, z: 3208 },
    { x: 2772, z: 3225 }
];

let sdk!: BotSDK;
let bot!: BotActions;
let log!: (msg: string) => void;
let session: ActivitySession | undefined;
let username = 'bot';
let lastIntent = '';
let wildyLastPos = { x: 0, z: 0 };
let wildyStallTicks = 0;

function intent(msg: string): void {
    if (msg === lastIntent) return;
    lastIntent = msg;
    console.log(`> ${msg}`);
    if (session) void session.showIntent(msg);
    else void sdk.showIntent(msg);
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

function coinCount(): number {
    return sdk.findInventoryItem(/^coins$/i)?.count ?? 0;
}

function occupiedSlots(): number {
    return sdk.getInventory().filter((i) => (i.count ?? 0) > 0).length;
}

function inArdougne(): boolean {
    const p = pos();
    return p.x > 2500 && p.x < 2720 && p.z > 3240 && p.z < 3355 && p.z < 6400;
}

function nearSeersCatherby(): boolean {
    const p = pos();
    return p.x >= 2680 && p.x <= 2878 && p.z >= 3320 && p.z < 3520 && p.z < 6400;
}

function inKeepLeFaye(): boolean {
    const p = pos();
    return p.x >= 2746 && p.x <= 2772 && p.z >= 3390 && p.z <= 3422 && p.z < 6400;
}

function inLegendsGuild(): boolean {
    const p = pos();
    return p.x >= 2714 && p.x <= 2742 && p.z >= 3344 && p.z <= 3388 && p.z < 6400;
}

export function nearLegendsMagic(x = pos().x, z = pos().z): boolean {
    return x >= 2685 && x <= 2715 && z >= 3388 && z <= 3435 && z < 6400;
}

function onKaramja(): boolean {
    const p = pos();
    return p.x > 2680 && p.x < 3010 && p.z > 3040 && p.z < 3270;
}

function onMusa(): boolean {
    return onKaramja() && pos().x >= 2815;
}

function inKandarin(): boolean {
    const p = pos();
    return (
        inArdougne() ||
        nearSeersCatherby() ||
        onKaramja() ||
        inKeepLeFaye() ||
        inLegendsGuild() ||
        (p.x > 2400 && p.x < 2878 && p.z > 3200 && p.z < 3550 && p.z < 6400)
    );
}

function inWilderness(): boolean {
    const p = pos();
    return p.z >= 3520 && p.z < 6400 && p.x >= 2944 && p.x < 3392;
}

function northOfDitch(): boolean {
    return pos().z >= 3520;
}

/** East slope of White Wolf. nearSeersCatherby() includes this, and walkNear from here dies. */
function onWhiteWolfSlope(): boolean {
    const p = pos();
    return p.x >= 2828 && p.x <= 2895 && p.z >= 3448 && p.z <= 3518 && p.z < 6400;
}

function useWhiteWolf(): boolean {
    return onWhiteWolfSlope() || pos().hp > WHITE_WOLF_MIN_HP;
}

/** East of the mountain: Falador, Edgeville, Lumbridge. Not Yanille or the gnome stronghold. */
function eastOfWhiteWolf(): boolean {
    return pos().x > 2890 && pos().z < 3520 && pos().z < 6400;
}

/** Aggressive Tree NPCs on the due-north road (~3103,3347). */
function inTreeBand(): boolean {
    const p = pos();
    return p.x > 3020 && p.x < 3160 && p.z > 3280 && p.z < 3420;
}

/** Pathfinder is fine south of the ditch; Falador first if already in the trees. */
async function walkToEdgeville(): Promise<void> {
    if (distTo(EDGEVILLE.x, EDGEVILLE.z) <= 12) return;
    intent('Walking Draynor → Falador → Edgeville (avoid trees)');
    if (inTreeBand()) {
        await walkNear(FALADOR_ESCAPE.x, FALADOR_ESCAPE.z, 8);
        if (pos().isDead) return;
    }
    for (const wp of DRAYNOR_TO_EDGEVILLE) {
        if (distTo(EDGEVILLE.x, EDGEVILLE.z) <= 12) return;
        if (pos().isDead) return;
        if (distTo(wp.x, wp.z) <= 8) continue;
        const remaining = distTo(EDGEVILLE.x, EDGEVILLE.z);
        const via = Math.hypot(wp.x - EDGEVILLE.x, wp.z - EDGEVILLE.z);
        if (via >= remaining - 6) continue;
        await walkNear(wp.x, wp.z, 8);
    }
    if (distTo(EDGEVILLE.x, EDGEVILLE.z) > 12) await walkNear(EDGEVILLE.x, EDGEVILLE.z, 6);
}

/** Raw sendWalk — pathfinder avoids wilderness and causes bank↔ditch loops. */
async function sendWalkTo(x: number, z: number, tolerance = 8): Promise<void> {
    if (distTo(x, z) <= tolerance) return;
    await sdk.sendWalk(x, z, true);
    await sdk.waitForCondition(
        (s) => Math.hypot((s.player?.worldX ?? 0) - x, (s.player?.worldZ ?? 0) - z) <= tolerance + 2,
        15_000
    ).catch(() => {});
    await sdk.waitForTicks(2);
}

async function crossWildyDitch(): Promise<boolean> {
    if (northOfDitch()) return true;
    const weapon = slashItem();
    if (weapon && !/^knife$/i.test(weapon.name) && !bot.findEquippedItem(SLASH)) {
        await bot.equipItem(weapon);
    }
    intent('Crossing the Edgeville wilderness ditch (sendWalk — no pathfinder)');
    await sdk.sendWalk(3088, 3525, true);
    await sdk.waitForCondition((s) => (s.player?.worldZ ?? 0) >= 3520, 12_000).catch(() => {});
    return northOfDitch();
}

function onDockedShip(): boolean {
    if (inArdougne()) return false;
    if (pos().level < 1) return false;
    return (sdk.getNearbyLocs() ?? []).some((l) => /gangplank|ship's (ladder|wheel)|anchor/i.test(l.name));
}

function slashItem() {
    return bot.findEquippedItem(SLASH) ?? sdk.findInventoryItem(SLASH);
}

function packedForWildy(): boolean {
    if (bot.findEquippedItem(/shield|defender/i)) return false;
    const extra = sdk.getInventory().filter((i) => (i.count ?? 0) > 0 && !SLASH.test(i.name));
    return extra.length === 0 && !!slashItem();
}

function atKeepWeb(): boolean {
    const p = pos();
    return p.z >= 3946 && distTo(KEEP_WEB.x, KEEP_WEB.z) <= 18;
}

function insideKeep(): boolean {
    const p = pos();
    return p.x >= 3148 && p.x <= 3165 && p.z >= 3918 && p.z <= 3948;
}

function nearLever(): boolean {
    return distTo(WILDY_LEVER.x, WILDY_LEVER.z) <= 10 || insideKeep();
}

function againstKeepFence(): boolean {
    const p = pos();
    if (atKeepWeb() || insideKeep() || nearLever()) return false;
    if (p.x >= 3162 && p.x <= 3196 && p.z >= 3908 && p.z <= 3956) return true;
    if (p.x >= 3144 && p.x <= 3176 && p.z >= 3906 && p.z <= 3922) return true;
    return false;
}

function eastOfKeep(): boolean {
    return againstKeepFence();
}

/** West of the members gate at the z≈3895–3905 blockage — NOT at the 3135,3865 north-road waypoint. */
function needsSpiderGateDetour(): boolean {
    const p = pos();
    return p.z >= 3895 && p.z < 3906 && p.x < 3140;
}

/** East of the north road, south of the members-gate fence — walk east to the gate, not north through the wall. */
function inMembersGateCorridor(): boolean {
    const p = pos();
    return p.x >= 3148 && p.z >= 3895 && p.z < 3906;
}

async function openNearbyWildyGate(): Promise<boolean> {
    await sdk.scanNearbyLocs(16).catch(() => {});
    const gate =
        sdk.findNearbyLoc(/^gate$/i, { withOption: /open/i }) ??
        (sdk.getNearbyLocs() ?? []).find(
            (l) => /gate/i.test(l.name) && l.optionsWithIndex.some((o) => /open/i.test(o.text))
        );
    if (!gate) return false;
    const open = gate.optionsWithIndex.find((o) => /open/i.test(o.text));
    if (open) await sdk.sendInteractLoc(gate.x, gate.z, gate.id, open.opIndex);
    else await bot.openDoor(gate);
    await sdk.waitForTicks(2);
    return true;
}

async function walkNorthPastMembersGate(): Promise<void> {
    intent('Members gate — walk east to gate, open if closed, walk north through');
    if (distTo(SPIDER_GATE.x, SPIDER_GATE.z) > 6) {
        await sdk.sendWalk(SPIDER_GATE.x, SPIDER_GATE.z, true);
        await sdk.waitForTicks(4);
    }
    await openNearbyWildyGate();
    await sdk.sendWalk(SPIDER_GATE.x, 3910, true);
    await sdk.waitForTicks(5);
    if (pos().z < 3906) {
        await sdk.sendWalk(SPIDER_GATE.x + 2, SPIDER_GATE.z, true);
        await sdk.waitForTicks(3);
        await openNearbyWildyGate();
        await sdk.sendWalk(SPIDER_GATE.x + 2, 3910, true);
        await sdk.waitForTicks(5);
    }
}

function noteWildyProgress(): void {
    const p = pos();
    if (Math.hypot(p.x - wildyLastPos.x, p.z - wildyLastPos.z) < 4) {
        wildyStallTicks++;
    } else {
        wildyStallTicks = 0;
        wildyLastPos = { x: p.x, z: p.z };
    }
}

async function recoverWildyStall(): Promise<void> {
    const p = pos();
    intent(`Wildy stalled ${wildyStallTicks}x @ ${p.x},${p.z} — forcing route waypoint`);
    if (p.z < 3700) await sendWalkTo(3110, 3700, 6);
    else if (p.z < 3895) await sendWalkTo(3135, 3865, 6);
    else if (inMembersGateCorridor() || needsSpiderGateDetour()) {
        await sendWalkTo(SPIDER_GATE.x, SPIDER_GATE.z, 3);
        await openNearbyWildyGate();
    } else if (p.z < 3945) await sendWalkTo(3135, 3954, 6);
    else await sendWalkTo(WEB_STAND.x, WEB_STAND.z, 2);
    wildyStallTicks = 0;
}

async function followWildyNorthRoad(untilZ = 3895): Promise<void> {
    for (const wp of WILDY_TO_LEVER) {
        if (pos().z >= untilZ) break;
        if (nearLever() || insideKeep() || atKeepWeb()) return;
        if (wp.z + 12 < pos().z) continue;
        if (distTo(wp.x, wp.z) <= 6) continue;
        await sendWalkTo(wp.x, wp.z, 6);
    }
}

function wildySpread(): { x: number; z: number } {
    const n = [...username].reduce((a, c) => a + c.charCodeAt(0), 0);
    return { x: (n % 5) - 2, z: (n % 3) - 1 };
}

function atFlax(): boolean {
    const p = pos();
    return atFlaxCoord(p.x, p.z) || !!sdk.findNearbyLoc(/^flax$/i, { reachable: true });
}

async function walkNear(x: number, z: number, tolerance = 6): Promise<boolean> {
    if (distTo(x, z) <= tolerance) return true;
    const result = await bot.walkTo(x, z, Math.min(tolerance, 3));
    return result.success || distTo(x, z) <= tolerance + 2;
}

async function dismissLegendsGuard(): Promise<void> {
    for (let i = 0; i < 16; i++) {
        const dialog = sdk.getDialog();
        if (!dialog?.isOpen) return;
        const opts = dialog.options ?? [];
        const pick =
            opts.find((o) => /ok thanks|it's ok thanks|some other time|no thanks/i.test(o.text)) ||
            opts.find((o) => /click here to continue/i.test(o.text));
        await sdk.sendClickDialog(pick?.index ?? 0);
        await sdk.waitForTicks(1);
    }
}

async function leaveLegendsGuild(): Promise<void> {
    if (!inLegendsGuild() && !sdk.getDialog()?.isOpen) return;
    intent('Leaving the Legends Guild gates — going around, not in');
    await dismissLegendsGuard();
    const inside = pos().z > 3349 && pos().x >= 2718 && pos().x <= 2736;
    if (inside) {
        await walkNear(2728, 3351, 1);
        const gate = sdk.findNearbyLoc(/gate/i, { withOption: /open/i });
        if (gate) await bot.openDoor(gate);
        await sdk.waitForTicks(2);
        await dismissLegendsGuard();
    }
    await sdk.sendWalk(2695, 3375, true);
    await sdk.waitForTicks(8);
    await dismissLegendsGuard();
    await walkNear(2695, 3375, 4);
}

async function leaveKeepLeFaye(): Promise<void> {
    if (!inKeepLeFaye()) return;
    intent('Leaving Keep Le Faye — bats, going west to Seers');
    const door = sdk.findNearbyLoc(/door|gate/i, { withOption: /open/i });
    if (door) await bot.openDoor(door);
    await sdk.sendWalk(2726, 3485, true);
    await sdk.waitForTicks(8);
    await walkNear(2726, 3485, 6);
}

async function walkWaypoints(wps: { x: number; z: number }[]): Promise<void> {
    await leaveLegendsGuild();
    await leaveKeepLeFaye();
    const dest = wps[wps.length - 1]!;
    for (const wp of wps) {
        if (inLegendsGuild()) await leaveLegendsGuild();
        if (inKeepLeFaye()) await leaveKeepLeFaye();
        if (distTo(dest.x, dest.z) <= 8) return;
        const remaining = distTo(dest.x, dest.z);
        const via = Math.hypot(wp.x - dest.x, wp.z - dest.z);
        if (via >= remaining - 6) continue;
        await walkNear(wp.x, wp.z, 8);
    }
    if (distTo(dest.x, dest.z) > 6) await walkNear(dest.x, dest.z, 6);
}

async function clickBoatDialog(): Promise<void> {
    let closedStreak = 0;
    for (let i = 0; i < 24; i++) {
        const dialog = sdk.getDialog();
        if (!dialog?.isOpen) {
            closedStreak++;
            if (closedStreak >= 4) return;
            await new Promise((r) => setTimeout(r, 250));
            continue;
        }
        closedStreak = 0;
        if (dialog.isWaiting) {
            await sdk.waitForTicks(1);
            continue;
        }
        const opts = dialog.options ?? [];
        const pick =
            opts.find((o) => /search away|nothing to hide/i.test(o.text)) ||
            opts.find((o) => /yes please|pay|30|ardougne|karamja/i.test(o.text)) ||
            opts.find((o) => /^ok\.?$/i.test(o.text)) ||
            opts.find((o) => /journey|ship/i.test(o.text)) ||
            opts.find((o) => /yes/i.test(o.text) && !/crandor|bother|miss/i.test(o.text));
        log(`Boat dialog -> ${pick?.text ?? 'continue'}`);
        await sdk.sendClickDialog(pick?.index ?? 0);
        await sdk.waitForTicks(1);
    }
}

async function crossGangplank(): Promise<void> {
    const plank = sdk.findNearbyLoc(/gangplank/i);
    if (!plank) return;
    const opt = plank.optionsWithIndex.find((o) => /cross|board/i.test(o.text));
    if (opt) await sdk.sendInteractLoc(plank.x, plank.z, plank.id, opt.opIndex);
    else await bot.interactLoc(plank, /cross|board/i);
    await sdk.waitForTicks(5);
}

async function leaveDockedShip(): Promise<void> {
    if (!onDockedShip()) return;
    log(`On a docked ship at (${pos().x},${pos().z}) — getting off`);
    for (let i = 0; i < 6 && onDockedShip(); i++) {
        await crossGangplank();
        await sdk.waitForTicks(2);
    }
}

async function pickpocketMen(): Promise<void> {
    if (distTo(LUMBRIDGE_MEN.x, LUMBRIDGE_MEN.z) > 8) {
        intent('Walking to Lumbridge men');
        await walkNear(LUMBRIDGE_MEN.x, LUMBRIDGE_MEN.z, 4);
    }
    await bot.dismissBlockingUI();
    const npc =
        sdk.findNearbyNpc(/^man$/i, { reachable: true }) ??
        sdk.findNearbyNpc(/^woman$/i, { reachable: true });
    if (!npc) return;
    await bot.pickpocketNpc(npc);
}

async function pickupLumbyKnife(): Promise<boolean> {
    if (sdk.findInventoryItem(/^knife$/i)) return true;
    intent('Picking up the Lumbridge knife spawn to slash the keep web');
    await walkNear(LUMBY_KNIFE.x, LUMBY_KNIFE.z, 2);
    for (let i = 0; i < 24; i++) {
        await sdk.scanGroundItems(8).catch(() => {});
        const knife = sdk.findGroundItem(/^knife$/i);
        if (knife) {
            const r = await bot.pickupItem(knife);
            if (r.success || sdk.findInventoryItem(/^knife$/i)) return true;
        }
        await sdk.waitForTicks(2);
    }
    return !!sdk.findInventoryItem(/^knife$/i);
}

async function ensureSlashWeapon(): Promise<boolean> {
    if (slashItem()) return true;
    const inv = sdk.findInventoryItem(SLASH);
    if (inv) {
        if (/^knife$/i.test(inv.name)) return true;
        await bot.equipItem(inv);
        return !!bot.findEquippedItem(SLASH);
    }
    intent('Need a slash weapon for the wildy web — checking Draynor bank');
    await walkNear(DRAYNOR_BANK.x, DRAYNOR_BANK.z, 5);
    const opened = await bot.openBank();
    if (opened.success) {
        await bot.withdrawItem(/bronze (axe|sword|dagger)$/i, 1).catch(() => {});
        await bot.closeBank();
    }
    const fromBank = sdk.findInventoryItem(SLASH);
    if (fromBank) {
        await bot.equipItem(fromBank);
        if (bot.findEquippedItem(SLASH)) return true;
    }
    if (coinCount() < 16) {
        await pickpocketMen();
        return false;
    }
    intent("Buying a bronze axe from Bob's");
    await walkNear(BOBS_AXES.x, BOBS_AXES.z, 4);
    const shop = await bot.openShop(/bob/i);
    if (!shop.success && !sdk.getState()?.shop?.isOpen) return false;
    await bot.buyFromShop(/^bronze axe$/i, 1);
    await bot.closeShop();
    const axe = sdk.findInventoryItem(/^bronze axe$/i);
    if (axe) await bot.equipItem(axe);
    return !!bot.findEquippedItem(SLASH);
}

async function bankForWildy(): Promise<boolean> {
    if (inWilderness() || northOfDitch()) return packedForWildy() || !!slashItem();
    if (inKandarin()) return false;
    // Packed at Edgeville — skip bank reopen (unreachable booths cause bank↔ditch loops).
    if (packedForWildy() && distTo(EDGEVILLE.x, EDGEVILLE.z) <= 16) return true;
    if (packedForWildy()) return true;

    const bank =
        distTo(DRAYNOR_BANK.x, DRAYNOR_BANK.z) <= distTo(EDGEVILLE_BANK.x, EDGEVILLE_BANK.z)
            ? DRAYNOR_BANK
            : EDGEVILLE_BANK;
    intent(`Banking at ${bank === DRAYNOR_BANK ? 'Draynor' : 'Edgeville'} — wildy run takes a slash weapon only`);
    await walkNear(bank.x, bank.z, 4);
    const opened = await bot.openBank();
    if (!opened.success && !sdk.getState()?.bank?.isOpen) {
        log(`Wildy bank open failed: ${opened.message}`);
        return false;
    }

    const shield = bot.findEquippedItem(/shield|defender/i);
    if (shield) await bot.unequipItem(shield);
    const wrongWep = bot.findEquippedItem(/bow|pickaxe|mace/i);
    if (wrongWep) await bot.unequipItem(wrongWep);

    for (let n = 0; n < 28; n++) {
        const junk = sdk.getInventory().find((i) => (i.count ?? 0) > 0 && !SLASH.test(i.name));
        if (!junk) break;
        await bot.depositItem(junk, -1);
        await sdk.waitForTicks(1);
    }
    const extraSlash = sdk.getInventory().filter((i) => SLASH.test(i.name));
    if (bot.findEquippedItem(SLASH) && extraSlash.length) {
        await bot.depositItem(extraSlash[0]!, extraSlash[0]!.count);
    } else if (extraSlash.length > 1) {
        await bot.depositItem(extraSlash[1]!, extraSlash[1]!.count);
    }

    if (!slashItem()) {
        const fromBank =
            sdk.findBankItem(SWORD) ??
            sdk.findBankItem(/iron axe/i) ??
            sdk.findBankItem(/bronze axe/i) ??
            sdk.findBankItem(/^knife$/i) ??
            sdk.findBankItem(SLASH);
        if (fromBank) {
            const r = await bot.withdrawItem(fromBank, 1);
            log(`Withdraw slash ${fromBank.name} ${r.success ? 'ok' : r.message}`);
        }
    }
    await bot.closeBank();

    if (!slashItem()) {
        const gotKnife = await pickupLumbyKnife();
        if (!gotKnife) await ensureSlashWeapon();
    }

    const weapon = slashItem();
    if (weapon && !/^knife$/i.test(weapon.name) && !bot.findEquippedItem(SLASH)) await bot.equipItem(weapon);
    const stillShield = bot.findEquippedItem(/shield|defender/i);
    if (stillShield) await bot.unequipItem(stillShield);

    const packed = packedForWildy();
    if (!slashItem()) {
        log(`Wildy pack cannot_pack slash=none inv=${occupiedSlots()}`);
        session?.stop('cannot_pack', 'no slash weapon for the wilderness web');
        return false;
    }
    log(`Wildy pack ${packed ? 'ok' : 'still has extras'} slash=${slashItem()?.name ?? 'none'} inv=${occupiedSlots()}`);
    return packed;
}

async function slashKeepWeb(): Promise<boolean> {
    if (insideKeep() || nearLever()) return true;
    await sdk.scanNearbyLocs(10).catch(() => {});
    if (sdk.findNearbyLoc(/^slashed web$/i)) return true;
    const web = sdk.findNearbyLoc(/^web$/i, { withOption: /slash/i }) ?? sdk.findNearbyLoc(/^web$/i);
    if (!web) return insideKeep() || distTo(WILDY_LEVER.x, WILDY_LEVER.z) < 8;
    if (!slashItem()) return false;
    const slash = slashItem();
    if (slash && !/^knife$/i.test(slash.name) && !bot.findEquippedItem(SLASH)) await bot.equipItem(slash);
    const opt = web.optionsWithIndex.find((o) => /slash/i.test(o.text));
    if ((web.distance ?? 99) > 2) {
        await sdk.sendWalk(WEB_STAND.x, WEB_STAND.z, true);
        await sdk.waitForTicks(2);
    }
    const knife = sdk.findInventoryItem(/^knife$/i);
    if (knife) await bot.useItemOnLoc(knife, web);
    else if (opt) await sdk.sendInteractLoc(web.x, web.z, web.id, opt.opIndex);
    else await bot.interactLoc(web, /slash/i);
    await sdk.waitForTicks(2);
    return !!sdk.findNearbyLoc(/^slashed web$/i) || !sdk.findNearbyLoc(/^web$/i, { withOption: /slash/i });
}

async function walkWildyToLever(): Promise<void> {
    if (nearLever() || insideKeep() || atKeepWeb()) return;

    noteWildyProgress();
    if (wildyStallTicks >= 4) {
        await recoverWildyStall();
        return;
    }

    // 1. North road first. Do not "rejoin" toward 3135,3954 while still south of
    //    the members-gate fence (3158,3902 walked into that wall forever).
    if (pos().z < 3895) {
        if (pos().z < 3860 && pos().x >= 3150 && !atKeepWeb()) {
            intent('Rejoining north road to keep web');
            await sendWalkTo(3135, pos().z, 6);
            return;
        }
        intent('Wildy north road — sendWalk waypoints');
        await followWildyNorthRoad();
        return;
    }

    if (inMembersGateCorridor()) {
        await walkNorthPastMembersGate();
        return;
    }

    if (needsSpiderGateDetour()) {
        intent('Fence west of keep — east through the gate past the spiders');
        await walkNorthPastMembersGate();
        return;
    }

    if (distTo(WEB_STAND.x, WEB_STAND.z) > 3 && !sdk.findNearbyLoc(/^slashed web$/i)) {
        intent('Approaching keep web');
        await sendWalkTo(WEB_STAND.x, WEB_STAND.z, 2);
    }
}

async function pullWildyLever(): Promise<boolean> {
    if (!nearLever() && (eastOfKeep() || (!atKeepWeb() && distTo(KEEP_WEB.x, KEEP_WEB.z) > 8))) {
        await walkWildyToLever();
        return inArdougne();
    }

    await sdk.scanNearbyLocs(10).catch(() => {});
    const webUp = !!sdk.findNearbyLoc(/^web$/i, { withOption: /slash/i });
    const slashed = !!sdk.findNearbyLoc(/^slashed web$/i);

    if (!nearLever() && webUp && !slashed) {
        if (!slashItem()) {
            intent('No slash weapon — waiting at the web for another bot to cut it');
            await sdk.waitForTicks(4);
            return inArdougne();
        }
        await slashKeepWeb();
        if (!insideKeep() && !sdk.findNearbyLoc(/^slashed web$/i)) {
            intent('Web still up — not walking to the lever (that paths around to 44 wild)');
            return inArdougne();
        }
    }

    if (!nearLever() && !insideKeep() && !slashed && webUp) return inArdougne();

    if (!nearLever()) {
        await sdk.sendWalk(WILDY_LEVER.x, WILDY_LEVER.z, true);
        await sdk.waitForTicks(3);
    }
    for (let i = 0; i < 8 && !inArdougne(); i++) {
        if (pos().inCombat && nearLever()) await sdk.sendWalk(WILDY_LEVER.x, WILDY_LEVER.z, true);
        const lever =
            sdk.findNearbyLoc(/^lever$/i, { withOption: /pull/i }) ?? sdk.findNearbyLoc(/^lever$/i);
        if (!lever || lever.reachable === false) {
            if (nearLever() || insideKeep()) {
                intent('In the keep — pulling the lever, not walking to the web');
                await sdk.waitForTicks(1);
                continue;
            }
            if (!slashItem()) {
                intent('Lever gated — waiting for the web to be slashed');
                await sdk.waitForTicks(3);
                break;
            }
            await slashKeepWeb();
            if (eastOfKeep()) break;
            continue;
        }
        intent('Pulling the wilderness lever to Ardougne');
        await bot.interactLoc(lever, /pull/i);
        const dialog = sdk.getDialog();
        if (dialog?.isOpen) {
            const pick =
                dialog.options.find((o) => /don't show|brave|yes please/i.test(o.text)) ||
                dialog.options.find((o) => /yes/i.test(o.text));
            await sdk.sendClickDialog(pick?.index ?? 0);
            await sdk.waitForTicks(2);
        }
        await sdk
            .waitForCondition((s) => {
                const x = s.player?.worldX ?? 0;
                const z = s.player?.worldZ ?? 0;
                return x < 2750 && x > 2500 && z > 3240;
            }, 8_000)
            .catch(() => {});
        if (inArdougne()) {
            log(`Wildy lever → Ardougne (${pos().x},${pos().z})`);
            return true;
        }
        await sdk.waitForTicks(1);
    }
    return inArdougne();
}

async function portSarimToMusa(): Promise<void> {
    if (onKaramja() || inArdougne()) return;
    intent('Port Sarim sailor → Musa Point (30gp)');
    await walkNear(PORT_SARIM_DOCK.x, PORT_SARIM_DOCK.z, 4);
    const sailor =
        sdk.findNearbyNpc(/^captain tobias$/i) ??
        sdk.findNearbyNpc(/^seaman /i) ??
        sdk.findNearbyNpc(/sailor|seaman|captain tobias/i);
    if (!sailor) return;
    const startX = pos().x;
    await bot.talkTo(sailor);
    await clickBoatDialog();
    for (let i = 0; i < 40 && !onKaramja(); i++) {
        await crossGangplank();
        if (sdk.getDialog()?.isOpen) await clickBoatDialog();
        if (Math.abs(pos().x - startX) > 40) break;
        await sdk.waitForTicks(2);
    }
}

async function leaveGruborHouse(): Promise<void> {
    const p = pos();
    if (p.x < 2792 || p.x > 2830 || p.z > 3194) return;
    if (sdk.getDialog()?.isOpen) {
        await sdk.sendClickDialog(sdk.getDialog()!.options[0]?.index ?? 0);
        await sdk.waitForTicks(1);
    }
    await sdk.sendWalk(2806, 3196, true);
    await sdk.waitForTicks(5);
    await walkNear(2798, 3208, 4);
}

async function musaToBrimhaven(): Promise<void> {
    if (!onMusa()) return;
    for (const wp of MUSA_TO_BRIMHAVEN) {
        if (!onMusa()) break;
        await walkNear(wp.x, wp.z, 8);
    }
    await leaveGruborHouse();
    await walkNear(BRIMHAVEN_CUSTOMS.x, BRIMHAVEN_CUSTOMS.z, 5);
}

async function brimhavenToArdougne(): Promise<void> {
    if (inArdougne()) return;
    if (!onKaramja() || onMusa()) return;
    await leaveDockedShip();
    await leaveGruborHouse();
    intent('Brimhaven customs → Ardougne (30gp)');
    await walkNear(BRIMHAVEN_CUSTOMS.x, BRIMHAVEN_CUSTOMS.z, 4);
    const customs =
        sdk.findNearbyNpc(/^customs officer$/i) ?? sdk.findNearbyNpc(/customs officer/i);
    if (!customs) return;
    await bot.talkTo(customs);
    await clickBoatDialog();
    for (let i = 0; i < 20 && !inArdougne(); i++) {
        if (sdk.getDialog()?.isOpen) await clickBoatDialog();
        else if (onDockedShip()) await leaveDockedShip();
        await sdk.waitForTicks(2);
    }
}

/** Same dispatcher as thieving.ts `returnToArdougne`. */
async function returnToArdougne(): Promise<void> {
    if (inArdougne()) {
        if (pos().z < 3271 && sdk.findNearbyLoc(/gangplank/i)) {
            await crossGangplank();
            await sdk.waitForTicks(3);
        }
        return;
    }
    const p = pos();
    if (p.x > 2500 && p.x < 2720 && p.z >= 3355 && p.z < 3480 && p.z < 6400) {
        intent('Walking south from ranging guild to Ardougne');
        await walkNear(ARDOUGNE_MARKET.x, ARDOUGNE_MARKET.z, 6);
        return;
    }
    await leaveDockedShip();
    if (inLegendsGuild() || sdk.getDialog()?.isOpen) {
        await leaveLegendsGuild();
        return;
    }
    if (onMusa()) {
        await musaToBrimhaven();
        return;
    }
    if (onKaramja()) {
        await brimhavenToArdougne();
        return;
    }
    if (useWhiteWolf() && (inWilderness() || northOfDitch())) {
        intent(`HP ${pos().hp} — leaving the wilderness for White Wolf`);
        await walkSendHops(sdk, WILDY_SOUTH_TO_DITCH, WILDY_SOUTH_TO_DITCH[WILDY_SOUTH_TO_DITCH.length - 1]!, 4);
        if (northOfDitch()) {
            await sdk.sendWalk(3088, 3510, true);
            await sdk.waitForCondition((s) => (s.player?.worldZ ?? 0) < 3520, 10_000).catch(() => {});
        }
        return;
    }
    if (useWhiteWolf() && (onWhiteWolfSlope() || eastOfWhiteWolf())) {
        intent(`HP ${pos().hp} — White Wolf Mountain to Catherby`);
        if (!inWilderness() && pos().x > 3030 && distTo(3088, 3512) > 25) {
            await walkToEdgeville();
            return;
        }
        await walkSendHops(sdk, WHITE_WOLF_TO_CATHERBY, WHITE_WOLF_TO_CATHERBY[WHITE_WOLF_TO_CATHERBY.length - 1]!, 5);
        if (distTo(2816, 3439) <= 12) await walkWaypoints(CATHERBY_TO_ARDY);
        return;
    }
    if (nearSeersCatherby()) return;
    if (inWilderness() || northOfDitch()) {
        if (distTo(WILDY_LEVER.x, WILDY_LEVER.z) > 12) await walkWildyToLever();
        await pullWildyLever();
        return;
    }
    if (!packedForWildy()) {
        await bankForWildy();
        return;
    }
    if (distTo(EDGEVILLE.x, EDGEVILLE.z) > 12) {
        await walkToEdgeville();
        return;
    }
    await crossWildyDitch();
}

async function walkToFlax(): Promise<void> {
    await leaveKeepLeFaye();
    await leaveLegendsGuild();
    intent('Walking Ardougne → Seers flax (thieving Catherby road)');
    await walkWaypoints(ARDY_TO_FLAX);
    await walkNear(FLAX.x, FLAX.z, 4);
    const plant = sdk.findNearbyLoc(/^flax$/i, { reachable: true }) ?? sdk.findNearbyLoc(/flax/i);
    if (plant && occupiedSlots() < 28) {
        await bot.interactLoc(plant, /pick/i);
        await sdk.waitForTicks(2);
    }
    log(`At flax ${pos().x},${pos().z} | flax=${sdk.findInventoryItem(/^flax$/i)?.count ?? 0}`);
}

async function walkToLegendsMagic(): Promise<void> {
    await leaveKeepLeFaye();
    await leaveLegendsGuild();
    intent('Walking Ardougne → Legends Guild magic trees');
    await walkWaypoints(ARDY_TO_LEGENDS_MAGIC);
    await walkNear(LEGENDS_MAGIC.x, LEGENDS_MAGIC.z, 3);
    log(`At legends magic ${pos().x},${pos().z}`);
}

function bindTravel(opts: {
    sdk: BotSDK;
    bot: BotActions;
    log: (msg: string) => void;
    session?: ActivitySession;
}): void {
    sdk = opts.sdk;
    bot = opts.bot;
    log = opts.log;
    session = opts.session;
    username = process.env.BOT_USERNAME ?? 'bot';
    lastIntent = '';
    wildyLastPos = { x: 0, z: 0 };
    wildyStallTicks = 0;
}

export type TravelToFlaxResult = 'arrived' | 'cannot_pack' | 'stuck';

/** Wildy-lever route to Ardougne — avoids White Wolf Mountain. */
export async function travelToArdougne(opts: {
    sdk: BotSDK;
    bot: BotActions;
    log: (msg: string) => void;
    session?: ActivitySession;
}): Promise<TravelToFlaxResult> {
    bindTravel(opts);
    await bot.skipTutorial();
    await bot.dismissBlockingUI();
    log(`to-ardy start @ ${pos().x},${pos().z} HP ${pos().hp}/${pos().maxHp} slash=${slashItem()?.name ?? 'none'}`);

    for (let n = 0; n < 80 && !inArdougne() && !nearLegendsMagic(); n++) {
        if (session?.isStopped()) {
            return session.metrics().stopReason?.code === 'cannot_pack' ? 'cannot_pack' : 'stuck';
        }
        await bot.dismissBlockingUI();
        if (pos().isDead) {
            await sdk.waitForCondition((s) => !s.player.isDead, 45_000).catch(() => {});
            continue;
        }
        if (inKeepLeFaye()) {
            await leaveKeepLeFaye();
            continue;
        }
        if (inLegendsGuild()) {
            await leaveLegendsGuild();
            continue;
        }
        if (onWhiteWolfSlope()) {
            await returnToArdougne();
            continue;
        }
        if (nearSeersCatherby() && !inArdougne()) {
            intent('Walking from Seers area back to Ardougne');
            await walkWaypoints(CATHERBY_TO_ARDY);
            continue;
        }
        if (inArdougne()) break;
        await returnToArdougne();
    }

    if (inArdougne() || nearLegendsMagic()) {
        log(`Done — at Ardougne ${pos().x},${pos().z}`);
        return 'arrived';
    }
    log(`Did not reach Ardougne (at ${pos().x},${pos().z}) — will retry`);
    return 'stuck';
}

export async function travelToLegendsMagic(opts: {
    sdk: BotSDK;
    bot: BotActions;
    log: (msg: string) => void;
    session?: ActivitySession;
}): Promise<TravelToFlaxResult> {
    const travel = await travelToArdougne(opts);
    if (travel !== 'arrived') return travel;
    bindTravel(opts);
    if (nearLegendsMagic()) return 'arrived';
    await walkToLegendsMagic();
    return nearLegendsMagic() ? 'arrived' : 'stuck';
}

export async function travelToSeersFlax(opts: {
    sdk: BotSDK;
    bot: BotActions;
    log: (msg: string) => void;
    session?: ActivitySession;
}): Promise<TravelToFlaxResult> {
    bindTravel(opts);

    await bot.skipTutorial();
    await bot.dismissBlockingUI();
    log(`to-flax start @ ${pos().x},${pos().z} HP ${pos().hp}/${pos().maxHp} slash=${slashItem()?.name ?? 'none'}`);

    for (let n = 0; n < 80 && !atFlax(); n++) {
        if (session?.isStopped()) {
            return session.metrics().stopReason?.code === 'cannot_pack' ? 'cannot_pack' : 'stuck';
        }
        await bot.dismissBlockingUI();
        if (pos().isDead) {
            await sdk.waitForCondition((s) => !s.player.isDead, 45_000).catch(() => {});
            continue;
        }
        if (inKeepLeFaye()) {
            await leaveKeepLeFaye();
            continue;
        }
        if (inLegendsGuild()) {
            await leaveLegendsGuild();
            continue;
        }
        if (inArdougne() || nearSeersCatherby() || inKandarin()) {
            await walkToFlax();
            continue;
        }
        await returnToArdougne();
    }

    if (atFlax()) {
        log('Done — at Seers flax');
        return 'arrived';
    }
    session?.stop('stuck', `Did not reach flax (at ${pos().x},${pos().z})`);
    return 'stuck';
}
