/**
 * Romeo & Juliet — reusable.
 *
 *   bun bots/quests/romeo-and-juliet.ts {botname}
 *
 * Juliet → Romeo → Father Lawrence → Apothecary + cadava berry → Juliet → Romeo.
 * Resume-safe from inventory and NPC dialog state.
 */
import { appendFileSync } from 'fs';
import { join } from 'path';
import { runScript } from '../../sdk/runner';
import { ensureCoins, depositEverythingAtEdgeville, invCount, SHOPS, type SupplyCtx } from './quest-supplies';

const JULIET_HOUSE = { x: 3158, z: 3433 };
const JULIET_DOOR = { x: 3160, z: 3440 };
const JULIET = { x: 3158, z: 3425 };
const ROMEO = { x: 3211, z: 3425 };
const FATHER = { x: 3254, z: 3475 };
const APOTHECARY = { x: 3195, z: 3404 };
const CADAVA_BUSH = { x: 3274, z: 3370 };

const JULIET_EXIT_SOUTH = { x: 3162, z: 3445 };
const JULIET_EXIT_WEST = { x: 3150, z: 3438 };
const VARROCK_SQUARE = { x: 3213, z: 3425 };

const TO_JULIET = [
    { x: 3185, z: 3436 },
    { x: 3165, z: 3433 },
    JULIET_HOUSE
];
const TO_ROMEO = [
    JULIET_EXIT_SOUTH,
    { x: 3168, z: 3446 },
    { x: 3180, z: 3440 },
    { x: 3195, z: 3435 },
    { x: 3205, z: 3428 },
    ROMEO
];
const TO_FATHER = [
    VARROCK_SQUARE,
    { x: 3225, z: 3435 },
    { x: 3240, z: 3455 },
    FATHER
];
const TO_APOTHECARY = [
    { x: 3210, z: 3418 },
    { x: 3200, z: 3408 },
    APOTHECARY
];
const TO_APOTHECARY_FROM_SOUTH = [
    { x: 3255, z: 3395 },
    { x: 3225, z: 3400 },
    { x: 3205, z: 3408 },
    APOTHECARY
];
const TO_BERRIES = [
    { x: 3260, z: 3385 },
    { x: 3274, z: 3375 },
    CADAVA_BUSH
];

const MESSAGE = /^message$/i;
const BERRIES = /^cadava berries?$/i;
const POTION = /^cadava( potion)?$/i;
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
        return { x: p?.worldX ?? 0, z: p?.worldZ ?? 0, level: p?.level ?? 0 };
    }

    function distTo(x: number, z: number): number {
        return Math.hypot(pos().x - x, pos().z - z);
    }

    function count(pattern: RegExp): number {
        return sdk.getInventory().reduce((n, i) => n + (pattern.test(i.name) ? (i.count ?? 1) : 0), 0);
    }

    function messages(): string {
        const s = sdk.getState();
        const recent = (s as { recentMessages?: string[] } | null)?.recentMessages ?? [];
        const game = (s?.gameMessages ?? []).map((m) => m.text);
        const chat = sdk
            .getChat({ limit: 80, types: [0, 1, 2, 3, 4, 5, 6, 7] })
            .map((m) => m.text);
        const dialog = sdk.getDialog();
        const dialogBits = [
            dialog?.text,
            ...(dialog?.options ?? []).map((o) => o.text),
            ...((dialog as { allComponents?: Array<{ text?: string }> } | null)?.allComponents ?? []).map(
                (c) => c.text ?? ''
            )
        ].filter(Boolean) as string[];
        return [...recent, ...game, ...chat, ...dialogBits].join('\n');
    }

    let sawComplete = false;

    function looksComplete(text: string): boolean {
        // Overlay copy is "You have completed the\nRomeo & Juliet Quest!" — `.*` does
        // not span that newline. Chat also emits a generic congratulations line.
        return (
            /congratulations!?\s*quest complete/i.test(text) ||
            /completed the[\s\S]{0,80}romeo[\s\S]{0,40}juliet/i.test(text)
        );
    }

    function questDone(): boolean {
        if (sawComplete) return true;
        if (looksComplete(messages())) {
            sawComplete = true;
            return true;
        }
        return false;
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
            const s = sdk.getState();
            if (s?.shop?.isOpen || s?.bank?.isOpen || s?.interface?.isOpen) {
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

    function inJulietCompound(): boolean {
        const p = pos();
        return p.level === 0 && p.x >= 3153 && p.x <= 3165 && p.z >= 3434 && p.z <= 3443;
    }

    async function openNearbyDoors(): Promise<void> {
        await sdk.scanNearbyLocs(12).catch(() => {});
        for (const door of (sdk.getNearbyLocs() ?? []).filter((l) => /door|gate/i.test(l.name))) {
            if (door.optionsWithIndex.some((o) => /^open$/i.test(o.text))) {
                await bot.openDoor(door);
                await sdk.waitForTicks(1);
            }
        }
    }

    async function walkNear(x: number, z: number, tolerance = 4): Promise<boolean> {
        if (distTo(x, z) <= tolerance) return true;
        for (let attempt = 0; attempt < 4; attempt++) {
            const r = await bot.walkTo(x, z, Math.min(tolerance, 3));
            if (r.success || distTo(x, z) <= tolerance + 2) return true;
            await openNearbyDoors();
            await sdk.waitForTicks(1);
        }
        return distTo(x, z) <= tolerance + 3;
    }

    async function walkRoute(points: Array<{ x: number; z: number }>): Promise<void> {
        for (const p of points) {
            await closeUi();
            if (sdk.getState()?.player?.combat?.inCombat) {
                await walkNear(pos().x + 3, pos().z + 3, 2);
                await sdk.waitForTicks(2);
            }
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
                await walkNear(JULIET_HOUSE.x, JULIET_HOUSE.z, 2);
                continue;
            }
            const before = pos().level;
            await bot.interactLoc(stairs, opt);
            await sdk.waitForCondition((s) => (s.player?.level ?? before) !== before, 8_000).catch(() => {});
            await closeUi();
        }
        return pos().level === targetLevel;
    }

    async function exitJulietCompound(): Promise<void> {
        if (!inJulietCompound() && pos().level === 0) return;
        if (pos().level !== 0) {
            intent('Climbing down');
            await climbTo(0);
        }
        intent('Leaving Juliet\'s yard');
        await walkNear(JULIET_DOOR.x, JULIET_DOOR.z, 2);
        await openNearbyDoors();
        if (!(await walkNear(JULIET_EXIT_SOUTH.x, JULIET_EXIT_SOUTH.z, 3))) {
            await openNearbyDoors();
            await walkNear(JULIET_EXIT_WEST.x, JULIET_EXIT_WEST.z, 3);
        }
        await walkNear(3168, 3446, 4);
    }

    async function exitUpperFloor(): Promise<void> {
        if (pos().level !== 0) {
            intent('Climbing down');
            await climbTo(0);
        }
        await exitJulietCompound();
    }

    function hasBerries(): boolean {
        return sdk.getInventory().some((i) => BERRIES.test(i.name) && (i.count ?? 0) > 0);
    }

    function spokeToFather(): boolean {
        return /father lawrence|tragic news|passed message|romeo sent me/i.test(messages());
    }

    function apothecaryWantsBerries(): boolean {
        return /bring him some cadava|bring.*cadava berries|find some cadava berries|told me to bring/i.test(messages());
    }

    function spokeToApothecary(): boolean {
        return apothecaryWantsBerries() || /went to the apothecary|make this cadava potion/i.test(messages());
    }

    function needsBerryRun(): boolean {
        if (questDone() || hasBerries() || count(POTION) > 0) return false;
        return spokeToApothecary() || (onlyCoins() && inVarrock());
    }

    function questInProgress(): boolean {
        return (
            count(MESSAGE) > 0 ||
            count(BERRIES) > 0 ||
            count(POTION) > 0 ||
            spokeToFather() ||
            /juliet gives you|deliver your message|spoken.*romeo/i.test(messages())
        );
    }

    async function leaveJulietArea(): Promise<void> {
        if (pos().level !== 0) await climbTo(0);
        if (inJulietCompound() || (pos().x >= 3153 && pos().x <= 3165 && pos().z >= 3420 && pos().z <= 3443)) {
            await exitJulietCompound();
        }
    }

    async function walkToApothecary(): Promise<void> {
        await leaveJulietArea();
        intent('Walking to Apothecary');
        const p = pos();
        const route = p.z < 3410 || p.x > 3230 ? TO_APOTHECARY_FROM_SOUTH : TO_APOTHECARY;
        await walkRoute(route);
        await walkNear(APOTHECARY.x, APOTHECARY.z, 3);
    }

    async function enterJulietHouse(): Promise<void> {
        if (pos().level === 1 && sdk.findNearbyNpc(/^juliet$/i)) return;
        await walkNear(JULIET_DOOR.x, JULIET_DOOR.z, 2);
        await sdk.scanNearbyLocs(6).catch(() => {});
        const door = sdk.findNearbyLoc(/^door$/i) ?? sdk.findNearbyLoc(/door/i);
        if (door) await bot.openDoor(door);
        await sdk.waitForTicks(1);
        if (pos().level !== 1) await climbTo(1);
    }

    async function talkNpc(pattern: RegExp, spot: { x: number; z: number }, choices: RegExp[] = []): Promise<string[]> {
        await closeUi();
        const nearby = sdk.findNearbyNpc(pattern);
        const needWalk =
            !nearby ||
            (pattern.source.includes('juliet') && pos().level !== 1) ||
            distTo(spot.x, spot.z) > 8;
        if (needWalk) {
            intent(`Walking to ${pattern}`);
            if (!pattern.source.includes('juliet')) await leaveJulietArea();
            if (pattern.source.includes('juliet')) {
                await walkRoute(TO_JULIET.slice(0, -1));
                await enterJulietHouse();
            } else if (pattern.source.includes('romeo')) await walkRoute(TO_ROMEO);
            else if (pattern.source.includes('lawrence')) await walkRoute(TO_FATHER);
            else if (pattern.source.includes('apothecary')) await walkToApothecary();
            else await walkNear(spot.x, spot.z, 3);
            if (!pattern.source.includes('juliet')) await walkNear(spot.x, spot.z, 3);
            else await walkNear(spot.x, spot.z, 3);
        }
        const npc = sdk.findNearbyNpc(pattern);
        if (!npc) {
            log(`NPC ${pattern} not found @ ${pos().x},${pos().z}`);
            return [];
        }
        const talk = await bot.talkTo(npc);
        if (!talk.success) {
            log(`talk ${pattern}: ${talk.message}`);
            return [];
        }
        await sdk.waitForTicks(1);
        return chat(choices);
    }

    async function pickCadava(): Promise<void> {
        if (hasBerries()) return;
        await leaveJulietArea();
        intent('Picking cadava berries');
        await walkNear(CADAVA_BUSH.x, CADAVA_BUSH.z, 4);
        for (let i = 0; i < 30 && !hasBerries(); i++) {
            let ground = sdk.findGroundItem(BERRIES);
            if (!ground) ground = (await sdk.scanFindGroundItem(BERRIES, 20)) ?? null;
            if (ground) {
                const r = await bot.pickupItem(ground);
                log(`Pickup cadava: ${r.success ? 'ok' : r.message}`);
                await sdk.waitForTicks(2);
                continue;
            }
            await sdk.scanNearbyLocs(14).catch(() => {});
            const bush =
                sdk.findNearbyLoc(/^cadava/i, { reachable: true }) ??
                sdk.findNearbyLoc(/^cadava/i);
            if (bush) {
                const r = await bot.interactLoc(bush, /pick/i);
                log(`Pick bush: ${r.success ? 'ok' : r.message} @ ${pos().x},${pos().z}`);
            } else {
                log(`No cadava bush @ ${pos().x},${pos().z} — walking closer`);
                await walkNear(CADAVA_BUSH.x, CADAVA_BUSH.z, 2);
            }
            await sdk.waitForTicks(2);
        }
        log(`Berries after pick: ${hasBerries()} inv=${sdk.getInventory().map((i) => i.name).join(', ')}`);
    }

    async function startApothecary(): Promise<void> {
        await walkToApothecary();
        const seen = await talkNpc(/^apothecary$/i, APOTHECARY, [
            /father lawrence sent me/i,
            /cadava potion/i
        ]);
        log(`Apothecary start: ${seen.join(' | ') || '(none)'}`);
        await chat([/father lawrence sent me/i, /cadava potion/i]);
    }

    async function handBerriesToApothecary(): Promise<void> {
        if (!hasBerries()) return;
        await walkToApothecary();
        const seen = await talkNpc(/^apothecary$/i, APOTHECARY);
        log(`Apothecary berries: ${seen.join(' | ') || '(none)'}`);
        await chat();
    }

    async function talkApothecary(): Promise<void> {
        if (hasBerries()) await handBerriesToApothecary();
        else await startApothecary();
    }

    async function startJuliet(): Promise<void> {
        const seen = await talkNpc(/^juliet$/i, JULIET, [
            /guess i could find him/i,
            /yes i have met him/i,
            /certainly.*straight away/i,
            /certainly.*deliver/i
        ]);
        log(`Juliet: ${seen.join(' | ') || '(none)'}`);
        await chat([/certainly.*straight away/i, /certainly.*deliver/i]);
    }

    async function deliverToRomeo(): Promise<void> {
        const seen = await talkNpc(/^romeo$/i, ROMEO, [
            /yes.*have seen her/i,
            /can i help find her/i,
            /yes.*tell her/i,
            /romeo.*message from juliet/i
        ]);
        log(`Romeo: ${seen.join(' | ') || '(none)'}`);
        if (count(MESSAGE) > 0) {
            await chat([/yes.*tell her/i, /message from juliet/i]);
        }
    }

    async function talkFather(): Promise<void> {
        await leaveJulietArea();
        const seen = await talkNpc(/father lawrence/i, FATHER, [/romeo sent me/i]);
        log(`Father Lawrence: ${seen.join(' | ') || '(none)'}`);
        await chat();
    }

    async function giveJulietPotion(): Promise<void> {
        const seen = await talkNpc(/^juliet$/i, JULIET);
        log(`Juliet hand-in: ${seen.join(' | ') || '(none)'}`);
        await chat();
    }

    async function finishRomeo(): Promise<void> {
        const seen = await talkNpc(/^romeo$/i, ROMEO, [/romeo.*all set|it'?s all set/i]);
        log(`Romeo finish: ${seen.join(' | ') || '(none)'}`);
        await chat();
        for (let i = 0; i < 20 && !questDone(); i++) {
            if (looksComplete(messages())) {
                sawComplete = true;
                break;
            }
            await sdk.waitForTicks(1);
        }
    }

    const supplyCtx = (): SupplyCtx => ({ bot, sdk, log, intent, walkNear, closeUi });

    function onlyCoins(): boolean {
        const items = sdk.getInventory().filter((i) => (i.count ?? 0) > 0);
        return items.length <= 1 && items.every((i) => /^coins$/i.test(i.name));
    }

    function inVarrock(): boolean {
        const p = pos();
        return p.x >= 3080 && p.x <= 3320 && p.z >= 3360 && p.z <= 3520 && p.level === 0;
    }

    async function maybeDepositAtStart(): Promise<void> {
        if (count(POTION) > 0 || count(BERRIES) > 0 || count(MESSAGE) > 0) return;
        if (questInProgress() || (onlyCoins() && inVarrock())) return;
        const gear = sdk.getInventory().filter((i) => (i.count ?? 0) > 0 && !/^coins$/i.test(i.name));
        if (gear.length === 0) return;
        await depositEverythingAtEdgeville(supplyCtx(), [MESSAGE, BERRIES, POTION]);
    }

    async function ensureSupplies(): Promise<void> {
        await ensureCoins(supplyCtx(), 5);
    }

    await bot.skipTutorial();
    await closeUi();
    if (pos().level !== 0 || pos().z > 6400) {
        await leaveJulietArea();
    }
    await maybeDepositAtStart();
    await ensureSupplies();
    log(`Romeo & Juliet start @ ${pos().x},${pos().z} L${pos().level}`);

    const until = Date.now() + 12 * 60_000;
    while (Date.now() < until && !questDone()) {
        await closeUi();

        if (questDone()) break;

        if (count(POTION) > 0) {
            await giveJulietPotion();
            if (count(POTION) === 0) await finishRomeo();
            continue;
        }

        if (hasBerries()) {
            await handBerriesToApothecary();
            continue;
        }

        if (needsBerryRun()) {
            await pickCadava();
            if (hasBerries()) await handBerriesToApothecary();
            else if (!spokeToApothecary()) await startApothecary();
            continue;
        }

        if (onlyCoins() && inVarrock()) {
            await startApothecary();
            continue;
        }

        if (spokeToFather() && !spokeToApothecary()) {
            await startApothecary();
            continue;
        }

        if (count(MESSAGE) > 0) {
            await leaveJulietArea();
            await deliverToRomeo();
            await talkFather();
            await startApothecary();
            continue;
        }

        if (count(MESSAGE) === 0 && /juliet gives you|deliver your message/i.test(messages())) {
            await leaveJulietArea();
            await deliverToRomeo();
            continue;
        }

        await startJuliet();
        if (count(MESSAGE) > 0) await deliverToRomeo();

        log(`inv berries=${hasBerries()} potion=${count(POTION)} @ ${pos().x},${pos().z}`);
        await sdk.waitForTicks(2);
    }

    if (!questDone()) throw new Error(`Romeo & Juliet unfinished @ ${pos().x},${pos().z}`);
    log('QUEST COMPLETE Romeo & Juliet');
});
