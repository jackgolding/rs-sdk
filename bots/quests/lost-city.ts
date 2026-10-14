/**
 * Lost City — reusable.
 *
 *   bun bots/quests/lost-city.ts {botname}
 *
 * Bank an axe → Warrior camp → chop the leprechaun tree → Shamus → bank the axe
 * → Entrana → dungeon bronze axe → tree spirit → Dramen branch → carve staff
 * in the dungeon → Magic door (wilderness lvl 32) → walk south → swamp shed.
 *
 * Entrana bans weapons/armour, so the dungeon axe comes from the zombies.
 * The ladder down drains prayer to 0 and the dungeon has no ladder up; food
 * carries the spirit fight and the Magic door is the only way out.
 */
import { appendFileSync } from 'fs';
import { join } from 'path';
import { runScript } from '../../sdk/runner';

const DRAYNOR_BANK = { x: 3092, z: 3245 };
const EDGEVILLE_BANK = { x: 3094, z: 3492 };
const EDGE_DUNGEON_LADDER = { x: 3096, z: 9867 };
const EDGE_WILDY_GATE = { x: 3103, z: 9909 };
const CAMP = { x: 3145, z: 3202 };
const SHAMUS_TREE = { x: 3139, z: 3211 };
const PORT_SARIM_MONK = { x: 3045, z: 3236 };
const ENTRANA_DOCK = { x: 2834, z: 3335 };
const DUNGEON_LADDER = { x: 2822, z: 3374 };
const ZOMBIES = { x: 2842, z: 9766 };
const DRAMEN_TREE = { x: 2860, z: 9737 };
const MAGIC_DOOR = { x: 2874, z: 9750 };
const SHED = { x: 3203, z: 3169 };
/** Ground knife southeast of Lumbridge Castle. */
const KNIFE_SPAWN = { x: 3224, z: 3202 };

const TO_CAMP = [
    { x: 3108, z: 3230 },
    { x: 3130, z: 3215 },
    CAMP
];
const CAMP_TO_SARIM = [
    { x: 3105, z: 3215 },
    { x: 3080, z: 3220 },
    { x: 3060, z: 3230 },
    PORT_SARIM_MONK
];
const DRAYNOR_TO_SARIM = [
    { x: 3075, z: 3240 },
    { x: 3058, z: 3238 },
    PORT_SARIM_MONK
];
const LUMBY_TO_SHED = [
    { x: 3208, z: 3205 },
    { x: 3205, z: 3185 },
    SHED
];
const KNIFE = /^knife$/i;
const STEEL_AXE = /^steel axe$/i;
const ANY_AXE = /^(bronze|iron|steel|black|mithril|adamant|rune) axe$/i;
const BRONZE_AXE = /^bronze axe$/i;
const BRANCH = /^dramen branch$/i;
const STAFF = /^dramen staff$/i;
const FOOD =
    /^(shark|swordfish|lobster|tuna|salmon|trout|bass|anchovies|sardine|herring|bread|cake|wine|meat pie|plain pizza|pineapple pizza)$/i;
const KEEP_BANK =
    /^(knife|shark|swordfish|lobster|tuna|salmon|trout|bass|bread|cake|wine|meat pie|plain pizza|pineapple pizza|dramen branch|dramen staff)$/i;
const BANNED =
    /axe|pickaxe|sword|scimitar|dagger|mace|spear|warhammer|battleaxe|halberd|bow|crossbow|arrow|bolt|javelin|dart|claws|whip|helm|plate|chain|legs|skirt|boots|gloves|gauntlet|shield|defender|kiteshield|cape|cloak|coif|vambrace|chaps|\bbody\b|\btop\b|robe/i;

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

    function occupied(): number {
        return sdk.getInventory().filter((i) => (i.count ?? 0) > 0).length;
    }

    function worn(pattern: RegExp) {
        return sdk.getEquipment().find((i) => pattern.test(i.name));
    }

    function hasAxe(): boolean {
        return count(ANY_AXE) > 0 || !!worn(ANY_AXE);
    }

    function prayerPoints(): number {
        return sdk.getPrayerState()?.prayerPoints ?? 0;
    }

    function prayerBase(): number {
        return sdk.getSkill('Prayer')?.baseLevel ?? 1;
    }

    function messages(): string {
        const s = sdk.getState();
        const recent = (s as { recentMessages?: string[] } | null)?.recentMessages ?? [];
        const game = (s?.gameMessages ?? []).map((m) => m.text);
        return [...recent, ...game].join(' | ');
    }

    let warriorSaysComplete = false;
    function questDone(): boolean {
        if (warriorSaysComplete) return true;
        if (/completed the.*lost city/i.test(messages())) return true;
        const p = pos();
        return p.z >= 9520 && p.z <= 9660 && p.x >= 3180 && p.x <= 3260;
    }

    function inDungeon(): boolean {
        const p = pos();
        return p.z >= 9680 && p.z <= 9800 && p.x >= 2790 && p.x <= 2900;
    }

    function inWilderness(): boolean {
        const p = pos();
        return p.z >= 3520 && p.z < 6400 && p.x >= 2944 && p.x <= 3392;
    }

    function onEntrana(): boolean {
        const p = pos();
        return p.z < 6400 && p.x >= 2795 && p.x <= 2885 && p.z >= 3320 && p.z <= 3405;
    }

    function onShip(): boolean {
        return pos().level >= 1 && distTo(ENTRANA_DOCK.x, ENTRANA_DOCK.z) < 30;
    }

    function isBanned(name: string): boolean {
        if (KEEP_BANK.test(name)) return false;
        return BANNED.test(name);
    }

    async function waitUntil(pred: () => boolean, ms: number): Promise<boolean> {
        try {
            await sdk.waitForCondition(() => pred(), ms);
            return true;
        } catch {
            return pred();
        }
    }

    async function closeUi(): Promise<void> {
        for (let i = 0; i < 8; i++) {
            await bot.dismissBlockingUI();
            const dialog = sdk.getDialog();
            const opts = dialog?.options ?? [];
            if (dialog?.isOpen && (opts.length <= 1 || opts.every((o) => /click here to continue/i.test(o.text)))) {
                await clickAndAwaitPage(opts[0]?.index ?? 0);
                continue;
            }
            const s = sdk.getState();
            if (s?.shop?.isOpen || s?.bank?.isOpen || s?.interface?.isOpen) {
                if (s.bank?.isOpen) await bot.closeBank();
                else await bot.closeInterface();
                await sdk.waitForTicks(1);
                continue;
            }
            break;
        }
    }

    function dialogSig(): string {
        const d = sdk.getDialog();
        if (!d?.isOpen) return '';
        return [d.text ?? '', ...(d.allComponents ?? []).map((c) => c.text ?? ''), ...(d.options ?? []).map((o) => `${o.componentId}:${o.text}`)].join('|');
    }

    /** A second click before the next page arrives lands on the wrong button (or re-picks the old choice). */
    async function clickAndAwaitPage(index: number): Promise<void> {
        const prev = dialogSig();
        await sdk.sendClickDialog(index);
        for (let i = 0; i < 12; i++) {
            await sdk.waitForTicks(1);
            const now = dialogSig();
            if (now !== prev && now !== '') return;
        }
    }

    async function chat(choices: RegExp[] = [], max = 36): Promise<string[]> {
        const seen: string[] = [];
        let closed = 0;
        for (let i = 0; i < max; i++) {
            const dialog = sdk.getDialog();
            if (!dialog?.isOpen) {
                closed++;
                if (closed >= 10) break;
                await sdk.waitForTicks(1);
                continue;
            }
            closed = 0;
            const d = sdk.getDialog();
            const opts = d?.options ?? [];
            if (d?.text) seen.push(d.text);
            for (const c of d?.allComponents ?? []) {
                if (c.text) seen.push(c.text);
            }
            for (const o of opts) seen.push(o.text);
            const continues = opts.filter((o) => /click here to continue/i.test(o.text));
            if (opts.length === 0 || (opts.length > 0 && continues.length === opts.length)) {
                await clickAndAwaitPage(continues[0]?.index ?? opts[0]?.index ?? 0);
                continue;
            }
            let picked = false;
            const skip = /please tell me|no, not right now|i don't think i'm strong enough/i;
            for (const c of choices) {
                let last = -1;
                for (let i = 0; i < opts.length; i++) {
                    if (c.test(opts[i].text) && !skip.test(opts[i].text)) last = i;
                }
                if (last < 0) continue;
                const opt = opts[last];
                log(
                    `Dialog -> ${opt.text} (index ${opt.index} / published ${opts.length}) [${opts.map((o) => `${o.index}:${o.text}`).join(' | ')}]`
                );
                await clickAndAwaitPage(opt.index);
                picked = true;
                break;
            }
            if (!picked) break;
        }
        return seen;
    }

    async function walkNear(x: number, z: number, tolerance = 4): Promise<boolean> {
        if (distTo(x, z) <= tolerance) return true;
        const r = await bot.walkTo(x, z, Math.min(tolerance, 3));
        return r.success || distTo(x, z) <= tolerance + 2;
    }

    async function walkRoute(points: Array<{ x: number; z: number }>): Promise<void> {
        for (const p of points) {
            await closeUi();
            await walkNear(p.x, p.z, 5);
        }
    }

    async function eatIfLow(threshold = 50): Promise<void> {
        if (pos().isDead) return;
        if (pos().hp >= Math.min(threshold, pos().maxHp - 6)) return;
        const food = sdk.findInventoryItem(FOOD);
        if (!food) return;
        intent(`Eating ${food.name} at ${pos().hp}/${pos().maxHp}`);
        await bot.eatFood(food);
    }

    async function stripGear(): Promise<void> {
        for (const item of [...sdk.getEquipment()]) {
            if ((item.count ?? 0) <= 0) continue;
            intent(`Unequipping ${item.name}`);
            await bot.unequipItem(item);
            await sdk.waitForTicks(1);
        }
    }

    async function climbEdgeDungeon(): Promise<void> {
        if (pos().z < 6400 || inDungeon()) return;
        intent('Climbing out of Edgeville dungeon');
        if (pos().z >= EDGE_WILDY_GATE.z) {
            await walkNear(EDGE_WILDY_GATE.x, EDGE_WILDY_GATE.z + 6, 3);
            const gate = sdk.findNearbyLoc(/gate/i, { withOption: /open/i });
            if (gate) await bot.openDoor(gate);
            await walkNear(EDGE_WILDY_GATE.x, EDGE_WILDY_GATE.z - 6, 3);
        }
        await walkNear(EDGE_DUNGEON_LADDER.x, EDGE_DUNGEON_LADDER.z, 2);
        const ladder = sdk.findNearbyLoc(/^ladder$/i, { withOption: /climb-up/i });
        if (ladder) {
            await bot.interactLoc(ladder, /climb-up/i);
            await waitUntil(() => pos().z < 6400, 10_000);
        }
        log(`Surface @ ${pos().x},${pos().z}`);
    }

    async function dropRunes(): Promise<void> {
        for (let n = 0; n < 8; n++) {
            const rune = sdk.getInventory().find((i) => /rune$/i.test(i.name) && (i.count ?? 0) > 0);
            if (!rune) return;
            await sdk.sendDropItem(rune.slot);
            await sdk.waitForTicks(1);
        }
    }

    function sailReady(): boolean {
        const banned = sdk.getInventory().find((i) => (i.count ?? 0) > 0 && isBanned(i.name));
        return count(KNIFE) >= 1 && count(FOOD) >= 1 && !hasAxe() && !banned;
    }

    async function openNearestBooth(): Promise<boolean> {
        if (sdk.getState()?.bank?.isOpen) return true;
        const findBooth = () =>
            sdk
                .getNearbyLocs()
                .filter(
                    (l) =>
                        /^bank booth$/i.test(l.name) &&
                        l.optionsWithIndex?.some((o) => /use-quickly/i.test(o.text)) &&
                        l.reachable !== false
                )
                .sort((a, b) => a.distance - b.distance)[0];
        await sdk.scanNearbyLocs(8).catch(() => []);
        let booth = findBooth();
        if (!booth) {
            await walkNear(3092, 3243, 1);
            await closeUi();
            await sdk.scanNearbyLocs(8).catch(() => []);
            booth = findBooth();
        }
        if (!booth) {
            log(`No booth @ ${pos().x},${pos().z}`);
            return false;
        }
        const quickly = booth.optionsWithIndex.find((o) => /use-quickly/i.test(o.text));
        log(`Booth ${booth.x},${booth.z} use-quickly`);
        const sent = await sdk.sendInteractLoc(booth.x, booth.z, booth.id, quickly?.opIndex ?? 2);
        if (!sent.success) log(`booth send: ${sent.message}`);
        const open = await waitUntil(() => sdk.getState()?.bank?.isOpen === true, 8_000);
        if (!open) log(`Bank still closed after booth ${booth.x},${booth.z}`);
        return open;
    }

    async function prepBank(takeAxe = false): Promise<boolean> {
        if (count(STAFF) > 0 || worn(STAFF) || count(BRANCH) > 0) return true;
        if (inDungeon() || onEntrana() || onShip()) return true;
        await dropRunes();
        if (!takeAxe && sailReady()) {
            log(`Pack ready knife=${count(KNIFE)} food=${count(FOOD)} — not opening the bank`);
            return true;
        }
        const bank =
            distTo(EDGEVILLE_BANK.x, EDGEVILLE_BANK.z) <= distTo(DRAYNOR_BANK.x, DRAYNOR_BANK.z)
                ? EDGEVILLE_BANK
                : DRAYNOR_BANK;
        if (distTo(bank.x, bank.z) > 20) {
            intent(`Walking to bank ${bank.x},${bank.z}`);
            await walkNear(bank.x, bank.z, 3);
        }
        intent(takeAxe ? 'Banking (knife, steel axe, food)' : 'Banking weapons before Entrana');
        await stripGear();
        await closeUi();
        if (!(await openNearestBooth())) return false;
        for (let pass = 0; pass < 16; pass++) {
            const junk = sdk.getInventory().find((i) => {
                if ((i.count ?? 0) <= 0) return false;
                if (KEEP_BANK.test(i.name)) return false;
                if (takeAxe && ANY_AXE.test(i.name)) return false;
                return true;
            });
            if (!junk) break;
            await bot.depositItem(junk, -1);
        }
        if (count(KNIFE) < 1) {
            const w = await bot.withdrawItem(KNIFE, 1);
            if (!w.success) log(`knife withdraw: ${w.message}`);
        }
        if (takeAxe && !hasAxe()) {
            const w = await bot.withdrawItem(STEEL_AXE, 1);
            if (!w.success) log(`steel axe withdraw: ${w.message}`);
            if (!hasAxe()) await bot.withdrawItem(ANY_AXE, 1);
        }
        for (const food of sdk.getBankItems().filter((i) => FOOD.test(i.name))) {
            if (count(FOOD) >= 16 || occupied() >= 26) break;
            const room = Math.max(1, 26 - occupied());
            await bot.withdrawItem(food, Math.min(food.count ?? (food as { count?: number }).count ?? room, room));
        }
        await bot.closeBank();
        await closeUi();
        if (!takeAxe && hasAxe()) await depositAxe();
        log(
            `Prepped knife=${count(KNIFE)} axe=${hasAxe()} food=${count(FOOD)} @ ${pos().x},${pos().z}`
        );
        return !takeAxe || hasAxe();
    }

    /** Entrana bans axes. A worn axe cannot be unequipped into a full inventory, so free a slot first. */
    async function depositAxe(): Promise<void> {
        if (!hasAxe()) return;
        intent('Depositing the axe before Entrana');
        if (!(await openNearestBooth())) return;
        if (worn(ANY_AXE) && occupied() >= 28) {
            const dump = sdk.getInventory().find((i) => (i.count ?? 0) > 0 && !KNIFE.test(i.name));
            if (dump) await bot.depositItem(dump, 1);
        }
        for (let n = 0; n < 4 && count(ANY_AXE) > 0; n++) {
            const axe = sdk.findInventoryItem(ANY_AXE);
            if (!axe) break;
            await bot.depositItem(axe, -1);
            await sdk.waitForTicks(1);
        }
        await bot.closeBank();
        await closeUi();
        const equipped = worn(ANY_AXE);
        if (!equipped) return;
        if (occupied() >= 28) {
            if (!(await openNearestBooth())) return;
            const dump = sdk.getInventory().find((i) => (i.count ?? 0) > 0 && !KNIFE.test(i.name));
            if (dump) await bot.depositItem(dump, 1);
            await bot.closeBank();
            await closeUi();
        }
        await bot.unequipItem(equipped);
        await sdk.waitForTicks(1);
        if (count(ANY_AXE) < 1) return;
        if (!(await openNearestBooth())) return;
        for (let n = 0; n < 4 && count(ANY_AXE) > 0; n++) {
            const axe = sdk.findInventoryItem(ANY_AXE);
            if (!axe) break;
            await bot.depositItem(axe, -1);
            await sdk.waitForTicks(1);
        }
        await bot.closeBank();
        await closeUi();
    }

    async function pickupKnife(): Promise<boolean> {
        if (count(KNIFE) > 0) return true;
        intent('Picking up the Lumbridge castle knife');
        await walkNear(KNIFE_SPAWN.x, KNIFE_SPAWN.z, 1);
        for (let i = 0; i < 20 && count(KNIFE) < 1; i++) {
            if (occupied() >= 28) {
                const food = sdk.findInventoryItem(FOOD);
                if (!food) break;
                await sdk.sendDropItem(food.slot);
                await sdk.waitForTicks(1);
            }
            const scanned = await sdk.scanGroundItems(8).catch(() => sdk.getGroundItems());
            const ground =
                scanned.find((g) => KNIFE.test(g.name) && (g.distance ?? 99) <= 8) ?? sdk.findGroundItem(KNIFE);
            if (ground) {
                const r = await bot.pickupItem(ground);
                if (!r.success && count(KNIFE) < 1) log(`knife pickup: ${r.message}`);
            }
            if (count(KNIFE) > 0) break;
            await sdk.waitForTicks(2);
        }
        log(`Knife=${count(KNIFE)} @ ${pos().x},${pos().z}`);
        return count(KNIFE) > 0;
    }

    async function talkNpc(pattern: RegExp, spot: { x: number; z: number }, choices: RegExp[]): Promise<string[]> {
        await closeUi();
        if (distTo(spot.x, spot.z) > 8) await walkNear(spot.x, spot.z, 4);
        const npc = sdk.findNearbyNpc(pattern);
        if (!npc) {
            log(`${pattern} missing @ ${pos().x},${pos().z}`);
            return [];
        }
        const talk = await bot.talkTo(npc);
        if (!talk.success) log(`talk ${npc.name}: ${talk.message}`);
        await sdk.waitForTicks(1);
        return chat(choices);
    }

    type Stage = 'not_started' | 'started' | 'spoken_shamus' | 'complete' | 'unknown';

    /** The warrior's opening line differs per %zanaris value; it is the only progress readout. */
    function warriorStage(seen: string): Stage {
        if (/thanks for all the information|keep that to myself/i.test(seen)) return 'complete';
        if (/have you found anything yet|still searching for zanaris/i.test(seen)) return 'spoken_shamus';
        if (/so a leprechaun knows|let me get this straight/i.test(seen)) return 'started';
        if (/hello there traveller/i.test(seen)) return 'not_started';
        return 'unknown';
    }

    async function startQuest(): Promise<Stage> {
        const choices = [
            /looks like you don'?t know either/i,
            /sounds like you don'?t know either/i,
            /what are you camped here for/i,
            /what makes you think it'?s out here/i,
            /who'?s zanaris/i,
            /if it'?s hidden how are you planning to find it/i,
            /so a leprechaun knows/i
        ];
        for (let attempt = 1; attempt <= 5; attempt++) {
            intent('Talking to the swamp Warrior');
            if (distTo(CAMP.x, CAMP.z) > 40) await walkRoute(TO_CAMP);
            await walkNear(CAMP.x, CAMP.z, 4);
            const seen = [...(await talkNpc(/^warrior$/i, CAMP, choices)), ...(await chat(choices, 24))].join(' | ');
            log(`Warrior: ${seen.replace(/\s+/g, ' ').slice(0, 300) || '(no dialog)'}`);
            const stage = warriorStage(seen);
            log(`Quest stage from warrior: ${stage}`);
            if (stage !== 'not_started' && stage !== 'unknown') return stage;
            log(`Warrior did not start the quest (attempt ${attempt}) — need Looks like you don't know either, not Please tell me?`);
            await closeUi();
        }
        return 'unknown';
    }

    async function chopShamusTree(): Promise<void> {
        if (!hasAxe()) {
            log('No axe for Shamus tree — banking steel axe');
            await prepBank(true);
        }
        intent('Chopping the unusual tree for Shamus');
        await walkNear(SHAMUS_TREE.x, SHAMUS_TREE.z, 2);
        await sdk.scanNearbyLocs(8).catch(() => []);
        const tree =
            sdk.getNearbyLocs().find(
                (l) =>
                    /^tree$/i.test(l.name) &&
                    distTo(l.x, l.z) <= 6 &&
                    l.optionsWithIndex?.some((o) => /^chop$/i.test(o.text) && !/chop down/i.test(o.text))
            ) ?? sdk.findNearbyLoc(/^tree$/i, { withOption: /^chop$/i });
        if (!tree) {
            log(`No Shamus tree @ ${pos().x},${pos().z}`);
            return;
        }
        const r = await bot.interactLoc(tree, /^chop$/i);
        if (!r.success) log(`chop tree: ${r.message}`);
        await sdk.waitForTicks(3);
    }

    async function talkShamus(): Promise<boolean> {
        const choices = [
            /i want to find zanaris/i,
            /how does it fit in a shed/i,
            /i'?ve been in that shed/i,
            /so where would i get a staff/i,
            /how do i get to zanaris again/i
        ];
        for (let attempt = 1; attempt <= 6; attempt++) {
            if (!sdk.findNearbyNpc(/^shamus$/i)) {
                await chopShamusTree();
                await sdk.waitForTicks(2);
            }
            if (!sdk.findNearbyNpc(/^shamus$/i)) {
                log(`Shamus not out (attempt ${attempt})`);
                continue;
            }
            intent('Talking to Shamus');
            const seen = [
                ...(await talkNpc(/^shamus$/i, SHAMUS_TREE, choices)),
                ...(await chat(choices, 48))
            ].join(' | ');
            log(`Shamus: ${seen || '(no dialog)'}`);
            if (/entrana|dramen/i.test(seen) || (/shed/i.test(seen) && !sdk.findNearbyNpc(/^shamus$/i))) {
                if (hasAxe()) {
                    intent('Banking the axe before Entrana');
                    await prepBank(false);
                }
                return true;
            }
            log('Shamus talk incomplete — trying again');
            await closeUi();
        }
        return false;
    }

    function monkChoiceOpen(): boolean {
        const opts = sdk.getDialog()?.options ?? [];
        const lines = opts.filter((o) => !/click here to continue/i.test(o.text));
        return lines.length >= 2 && lines.some((o) => /not right now|ready to go/i.test(o.text));
    }

    function dialogAfter(observationId: number): string {
        const recent = (sdk.getState()?.recentDialogs ?? [])
            .filter((e) => (e.observationId ?? 0) > observationId)
            .flatMap((e) => e.text);
        const d = sdk.getDialog();
        const live = [d?.text ?? '', ...(d?.allComponents ?? []).map((c) => c.text)];
        return [...recent, ...live].join(' | ');
    }

    async function openMonkChoice(): Promise<boolean> {
        await closeUi();
        await walkNear(PORT_SARIM_MONK.x, PORT_SARIM_MONK.z, 3);
        const npc = sdk.findNearbyNpc(/monk of entrana/i);
        if (!npc) {
            log(`Monk missing @ ${pos().x},${pos().z}`);
            return false;
        }
        const talk = await bot.talkTo(npc);
        if (!talk.success) log(`talk monk: ${talk.message}`);
        for (let i = 0; i < 14; i++) {
            if (monkChoiceOpen()) return true;
            const d = sdk.getDialog();
            if (d?.isOpen) {
                const cont = (d.options ?? []).find((o) => /click here to continue/i.test(o.text));
                await clickAndAwaitPage(cont?.index ?? 0);
            } else {
                await sdk.waitForTicks(1);
            }
        }
        return monkChoiceOpen();
    }

    async function sailEntrana(): Promise<void> {
        if (onEntrana() || inDungeon() || onShip()) return;
        intent('Sailing to Entrana');
        await stripGear();
        const leftover = sdk.getInventory().find((i) => (i.count ?? 0) > 0 && isBanned(i.name));
        if (leftover) {
            log(`Still holding banned ${leftover.name} — rebanking`);
            await prepBank(false);
        }
        if (distTo(PORT_SARIM_MONK.x, PORT_SARIM_MONK.z) > 30) {
            if (distTo(CAMP.x, CAMP.z) < 40) await walkRoute(CAMP_TO_SARIM);
            else await walkRoute(DRAYNOR_TO_SARIM);
        }
        await walkNear(PORT_SARIM_MONK.x, PORT_SARIM_MONK.z, 3);
        const before = { x: pos().x, z: pos().z };
        if (!monkChoiceOpen() && !(await openMonkChoice())) {
            log(`Monk choice never opened @ ${pos().x},${pos().z}`);
            return;
        }
        const yes = (sdk.getDialog()?.options ?? []).find((o) => /ready to go/i.test(o.text));
        if (!yes) {
            log(`No "ready to go" option [${(sdk.getDialog()?.options ?? []).map((o) => o.text).join(' | ')}]`);
            return;
        }
        log(`Monk -> ${yes.text} (index ${yes.index})`);
        const obs = (sdk.getState()?.recentDialogs ?? []).reduce((m, e) => Math.max(m, e.observationId ?? 0), 0);
        await clickAndAwaitPage(yes.index);
        // Click through the search pages only; the ship_journey modal must not be closed mid-voyage.
        for (let i = 0; i < 30; i++) {
            if (distTo(before.x, before.z) > 40 || onEntrana() || onShip()) break;
            const d = sdk.getDialog();
            const opts = d?.options ?? [];
            if (d?.isOpen && opts.length <= 1) await clickAndAwaitPage(opts[0]?.index ?? 0);
            else await sdk.waitForTicks(1);
        }
        const blob = dialogAfter(obs);
        if (/no weapons or armour/i.test(blob)) log(`Monk refused: banned item [${sdk.getInventory().map((i) => i.name).join(', ')}] worn [${sdk.getEquipment().map((i) => i.name).join(', ')}]`);
        await waitUntil(() => distTo(before.x, before.z) > 40 || onEntrana() || onShip(), 20_000);
        if (onShip() || pos().level >= 1) {
            intent('Crossing the gangplank');
            await sdk.scanNearbyLocs(10).catch(() => []);
            const plank = sdk.findNearbyLoc(/gangplank/i);
            if (plank) await bot.interactLoc(plank, /cross/i);
            await waitUntil(() => pos().level === 0, 8_000);
        }
        log(`After sail @ ${pos().x},${pos().z} lvl=${pos().level} entrana=${onEntrana()}`);
    }

    async function enterDungeon(): Promise<void> {
        if (inDungeon()) return;
        intent('Entering the Entrana dungeon');
        await walkNear(DUNGEON_LADDER.x, DUNGEON_LADDER.z, 3);
        await sdk.scanNearbyLocs(8).catch(() => []);
        const monk = sdk.findNearbyNpc(/cave monk/i);
        if (monk) {
            await bot.talkTo(monk);
            await chat([/well that is a risk i will have to take/i, /risk/i]);
        }
        const ladder = sdk.findNearbyLoc(/^ladder$/i);
        if (ladder && !inDungeon()) {
            await bot.interactLoc(ladder, /climb-down|climb.down/i);
            await chat([/well that is a risk i will have to take/i, /risk/i]);
        }
        await waitUntil(() => inDungeon(), 12_000);
        log(`Dungeon=${inDungeon()} prayer=${prayerPoints()} @ ${pos().x},${pos().z}`);
    }

    async function getBronzeAxe(): Promise<void> {
        if (count(BRONZE_AXE) > 0 || worn(BRONZE_AXE)) return;
        intent('Killing zombies for a bronze axe');
        await walkNear(ZOMBIES.x, ZOMBIES.z, 5);
        for (let i = 0; i < 40 && count(BRONZE_AXE) < 1 && !worn(BRONZE_AXE); i++) {
            await closeUi();
            await eatIfLow(40);
            await sdk.scanGroundItems(12).catch(() => []);
            const drop = sdk.findGroundItem(BRONZE_AXE);
            if (drop) {
                await bot.pickupItem(drop);
                continue;
            }
            const zombie =
                sdk.findNearbyNpc(/^zombie$/i, { reachable: true }) ?? sdk.findNearbyNpc(/^zombie$/i);
            if (!zombie) {
                await walkNear(ZOMBIES.x + ((i % 3) - 1) * 4, ZOMBIES.z + (i % 2 === 0 ? 3 : -3), 3);
                continue;
            }
            const atk = await bot.attack(zombie, 12_000);
            if (!atk.success) log(`zombie: ${atk.message}`);
            await waitUntil(() => !!sdk.findGroundItem(BRONZE_AXE) || !pos().inCombat, 15_000);
        }
        const axe = sdk.findInventoryItem(BRONZE_AXE);
        if (axe) {
            await bot.equipItem(axe);
            const styles = sdk.getState()?.combatStyle?.styles ?? [];
            const str = styles.find((s) => s.trainsSkills?.includes('Strength'));
            if (str) await sdk.sendSetCombatStyle(str.index);
        }
        log(`Axe inv=${count(BRONZE_AXE)} worn=${!!worn(BRONZE_AXE)}`);
    }

    async function fightSpirit(): Promise<void> {
        if (!inDungeon()) {
            log(`Not in the Entrana dungeon @ ${pos().x},${pos().z} — will not chase the tree`);
            return;
        }
        intent('Chopping the Dramen tree / fighting the tree spirit');
        await walkNear(DRAMEN_TREE.x, DRAMEN_TREE.z, 3);
        if (!inDungeon()) {
            log(`Teleported out through the Magic door @ ${pos().x},${pos().z} — aborting tree`);
            return;
        }
        for (let i = 0; i < 80 && count(BRANCH) < 1; i++) {
            await closeUi();
            await eatIfLow(60);
            if (!inDungeon()) {
                log(`Left the dungeon before the Dramen tree @ ${pos().x},${pos().z}`);
                return;
            }
            if (pos().isDead) {
                log('Died in dungeon');
                return;
            }
            const spirit = sdk.findNearbyNpc(/tree spirit/i);
            if (spirit) {
                intent('Killing the tree spirit');
                if (!pos().inCombat) {
                    const atk = await bot.attack(spirit, 8_000);
                    if (!atk.success) log(`spirit: ${atk.message}`);
                }
                await sdk.waitForTicks(2);
                continue;
            }
            await sdk.scanNearbyLocs(10).catch(() => []);
            const tree = sdk.findNearbyLoc(/dramen tree/i);
            if (!tree) {
                log(`No Dramen tree @ ${pos().x},${pos().z}`);
                await walkNear(DRAMEN_TREE.x, DRAMEN_TREE.z, 2);
                continue;
            }
            const r = await bot.interactLoc(tree, /chop/i);
            if (!r.success) log(`chop dramen: ${r.message}`);
            await sdk.waitForTicks(3);
            await chat();
        }
        log(`Branch=${count(BRANCH)} @ ${pos().x},${pos().z}`);
    }

    /** The dungeon has no ladder up; the Magic door teleports to level-32 wilderness. */
    async function exitViaMagicDoor(): Promise<void> {
        if (!inDungeon()) return;
        intent('Leaving the Entrana dungeon through the Magic door');
        await walkNear(MAGIC_DOOR.x - 1, MAGIC_DOOR.z, 2);
        await sdk.scanNearbyLocs(8).catch(() => []);
        const door = sdk.findNearbyLoc(/^magic door$/i);
        if (!door) {
            log(`No Magic door @ ${pos().x},${pos().z}`);
            return;
        }
        const r = await bot.interactLoc(door, /open/i);
        if (!r.success) log(`magic door: ${r.message}`);
        await waitUntil(() => !inDungeon(), 10_000);
        log(`Dungeon exit @ ${pos().x},${pos().z} dungeon=${inDungeon()}`);
    }

    async function sailBackToSarim(): Promise<void> {
        if (!onEntrana() && !onShip()) return;
        intent('Sailing back to Port Sarim');
        await walkNear(ENTRANA_DOCK.x, ENTRANA_DOCK.z, 4);
        const npc = sdk.findNearbyNpc(/monk of entrana/i);
        if (!npc) {
            log(`Return monk missing @ ${pos().x},${pos().z}`);
            return;
        }
        const talk = await bot.talkTo(npc);
        if (!talk.success) log(`talk return monk: ${talk.message}`);
        await chat([/yes,? i'?m ready to go/i]);
        await waitUntil(() => !onEntrana() || distTo(PORT_SARIM_MONK.x, PORT_SARIM_MONK.z) < 30, 25_000);
        log(`Back from Entrana @ ${pos().x},${pos().z} entrana=${onEntrana()}`);
    }

    async function leaveEntrana(): Promise<void> {
        if (inDungeon()) await exitViaMagicDoor();
        if (onEntrana() || onShip()) await sailBackToSarim();
    }

    async function walkOutOfWilderness(): Promise<void> {
        intent('Walking south out of the wilderness');
        await eatIfLow(60);
        const startZ = pos().z;
        await walkNear(pos().x, Math.max(3510, startZ - 30), 5);
        log(`Wilderness walk @ ${pos().x},${pos().z}`);
    }

    async function carveStaff(): Promise<void> {
        if (count(STAFF) > 0 || worn(STAFF)) return;
        if (count(BRANCH) < 1) return;
        if (count(KNIFE) < 1) await pickupKnife();
        const knife = sdk.findInventoryItem(KNIFE);
        const branch = sdk.findInventoryItem(BRANCH);
        if (!knife || !branch) {
            log(`Cannot carve knife=${!!knife} branch=${!!branch}`);
            return;
        }
        intent('Carving the Dramen staff');
        await closeUi();
        await sdk.sendUseItemOnItem(knife.slot, branch.slot);
        await waitUntil(() => count(STAFF) > 0, 5_000);
        const staff = sdk.findInventoryItem(STAFF);
        if (staff) await bot.equipItem(staff);
        log(`Staff inv=${count(STAFF)} worn=${!!worn(STAFF)}`);
    }

    async function enterShed(): Promise<void> {
        if (!count(STAFF) && !worn(STAFF)) return;
        if (!worn(STAFF)) {
            const staff = sdk.findInventoryItem(STAFF);
            if (staff) await bot.equipItem(staff);
        }
        intent('Entering the Zanaris shed');
        if (distTo(SHED.x, SHED.z) > 12) {
            if (pos().z > 3200) await walkRoute(LUMBY_TO_SHED);
            else await walkNear(SHED.x, SHED.z, 3);
        }
        await walkNear(SHED.x, SHED.z, 2);
        await sdk.scanNearbyLocs(8).catch(() => []);
        const door = sdk.findNearbyLoc(/^door$/i) ?? sdk.findNearbyLoc(/door/i);
        if (door) await bot.interactLoc(door, /open/i);
        else await bot.openDoor();
        await waitUntil(() => questDone(), 10_000);
        log(`Shed done=${questDone()} @ ${pos().x},${pos().z}`);
    };

    const ZANARIS_LADDER = { x: 3222, z: 9588 };
    const ZANARIS_EAST_LADDER = { x: 3254, z: 9590 };
    const ZANARIS_EXIT_HOPS = [
        { x: 3196, z: 9568 },
        { x: 3202, z: 9584 },
        { x: 3214, z: 9590 },
        { x: 3220, z: 9592 }
    ];

    function inZanaris(): boolean {
        const p = pos();
        return p.x >= 3050 && p.x <= 3400 && p.z >= 9400 && p.z < 9700;
    }

    function onSurface(): boolean {
        return pos().z < 9000;
    }

    async function climbZanarisLadder(tile: { x: number; z: number }): Promise<boolean> {
        await walkNear(tile.x, tile.z, 2);
        await sdk.scanNearbyLocs(6).catch(() => []);
        const ladder = (sdk.getNearbyLocs() ?? [])
            .filter(
                (l) =>
                    /ladder/i.test(l.name) &&
                    Math.hypot(l.x - tile.x, l.z - tile.z) <= 3 &&
                    l.optionsWithIndex?.some((o) => /climb-up|climb.up/i.test(o.text))
            )
            .sort((a, b) => (a.distance ?? 99) - (b.distance ?? 99))[0];
        if (!ladder) {
            log(`No Zanaris ladder @ ${pos().x},${pos().z} (want ${tile.x},${tile.z})`);
            return false;
        }
        log(`Climbing ${ladder.name} @ ${ladder.x},${ladder.z}`);
        const r = await bot.interactLoc(ladder, /climb-up|climb.up/i);
        if (!r.success) log(`zanaris ladder: ${r.message}`);
        await waitUntil(() => onSurface(), 15_000);
        await sdk.waitForTicks(3);
        log(`After Zanaris climb @ ${pos().x},${pos().z} surface=${onSurface()}`);
        return onSurface();
    }

    async function leaveZanaris(): Promise<boolean> {
        if (onSurface()) return true;
        if (!inZanaris()) return onSurface();
        intent('Leaving Zanaris');
        await closeUi();
        const here = pos();
        if (here.x >= 3230 && here.z < 9580) await walkNear(3220, here.z, 3);
        for (const hop of ZANARIS_EXIT_HOPS) {
            if (onSurface()) return true;
            if (distTo(ZANARIS_LADDER.x, ZANARIS_LADDER.z) <= 3) break;
            await walkNear(hop.x, hop.z, 4);
        }
        if (await climbZanarisLadder(ZANARIS_LADDER)) return true;
        if (!inZanaris()) return onSurface();
        for (const hop of [
            { x: 3236, z: 9590 },
            { x: 3246, z: 9590 },
            ZANARIS_EAST_LADDER
        ]) {
            if (onSurface()) return true;
            await walkNear(hop.x, hop.z, 3);
        }
        return climbZanarisLadder(ZANARIS_EAST_LADDER);
    }

    /**
     * The shed door is the Zanaris entrance while a dramen staff is worn.
     * Walk around it. Do not click Open.
     */
    async function stepOutOfShed(): Promise<void> {
        if (!onSurface() || distTo(SHED.x, SHED.z) > 20) return;
        for (const hop of [
            { x: 3194, z: 3176 },
            { x: 3194, z: 3196 },
            { x: 3208, z: 3210 }
        ]) {
            if (pos().z >= 3205) return;
            await walkNear(hop.x, hop.z, 3);
        }
    }

    await closeUi();
    log(
        `Lost City start @ ${pos().x},${pos().z} hp=${pos().hp}/${pos().maxHp} pray=${prayerPoints()}/${prayerBase()} craft=${sdk.getSkill('Crafting')?.baseLevel} wc=${sdk.getSkill('Woodcutting')?.baseLevel}`
    );

    /** Upstairs in the Seers spinning house. The ground-floor door is the way out. */
    function inWheelHouse(): boolean {
        const p = pos();
        return p.x >= 2706 && p.x <= 2724 && p.z >= 3464 && p.z <= 3480;
    }

    async function leaveWheelHouse(): Promise<void> {
        if (!inWheelHouse()) return;
        intent('Leaving the Seers spinning house');
        const jitter = (botName.charCodeAt(botName.length - 1) ?? 0) % 5;
        const exit = { x: 2736, z: 3472 + jitter };
        for (let i = 0; i < 6 && pos().level > 0; i++) {
            const ladder = sdk.getNearbyLocs().find(
                (l) => /ladder|stair/i.test(l.name) && l.optionsWithIndex?.some((o) => /climb-down|climb.down/i.test(o.text))
            );
            if (!ladder) {
                log(`No ladder down @ ${pos().x},${pos().z} lvl=${pos().level}`);
                break;
            }
            const opt = ladder.optionsWithIndex.find((o) => /climb-down|climb.down/i.test(o.text));
            log(`Climbing down from lvl ${pos().level} @ ${ladder.x},${ladder.z}`);
            if (distTo(ladder.x, ladder.z) > 1) {
                await sdk.sendWalk(ladder.x, ladder.z, true);
                await waitUntil(() => distTo(ladder.x, ladder.z) <= 1, 5_000);
            }
            await sdk.sendInteractLoc(ladder.x, ladder.z, ladder.id, opt?.opIndex ?? 1);
            await waitUntil(() => pos().level === 0, 8_000);
        }
        if (pos().level > 0) {
            log(`Still upstairs @ ${pos().x},${pos().z} lvl=${pos().level}`);
            return;
        }
        for (let i = 0; i < 8 && inWheelHouse(); i++) {
            const door = sdk
                .getNearbyLocs()
                .filter((l) => /door/i.test(l.name) && l.optionsWithIndex?.some((o) => /^open$/i.test(o.text)))
                .sort((a, b) => a.distance - b.distance)[0];
            if (door && door.distance <= 2) {
                const opt = door.optionsWithIndex.find((o) => /^open$/i.test(o.text));
                log(`Opening ${door.name} @ ${door.x},${door.z}`);
                await sdk.sendInteractLoc(door.x, door.z, door.id, opt?.opIndex ?? 1);
                await sdk.waitForTicks(2);
            }
            const stepX = Math.min(exit.x, pos().x + 3);
            const stepZ = pos().z + Math.sign(exit.z - pos().z);
            await sdk.sendWalk(stepX, stepZ, true);
            await waitUntil(() => pos().x >= stepX - 1 || !inWheelHouse(), 4_000);
            log(`House step @ ${pos().x},${pos().z}`);
        }
        log(`Seers house exit @ ${pos().x},${pos().z} lvl=${pos().level}`);
    }

    let stage: Stage = 'unknown';
    let stageTries = 0;
    const until = Date.now() + 90 * 60_000;
    while (Date.now() < until && !questDone()) {
        await closeUi();
        await eatIfLow(40);
        if (pos().z > 6400 && !inDungeon()) {
            await climbEdgeDungeon();
            continue;
        }
        if (pos().isDead) {
            await sdk.waitForTicks(4);
            continue;
        }

        if (inWheelHouse()) {
            await leaveWheelHouse();
            continue;
        }

        if (inWilderness()) {
            log(`Wilderness @ ${pos().x},${pos().z} — walking south`);
            await walkOutOfWilderness();
            continue;
        }

        if (count(STAFF) > 0 || worn(STAFF)) {
            if (inDungeon() || onEntrana() || onShip()) {
                await leaveEntrana();
                continue;
            }
            await enterShed();
            continue;
        }
        if (count(BRANCH) > 0) {
            await carveStaff();
            continue;
        }
        if (inDungeon()) {
            await getBronzeAxe();
            if (count(BRONZE_AXE) > 0 || worn(BRONZE_AXE)) await fightSpirit();
            continue;
        }
        if (onEntrana() || onShip()) {
            if (onShip()) {
                await sdk.scanNearbyLocs(10).catch(() => []);
                const plank = sdk.findNearbyLoc(/gangplank/i);
                if (plank) await bot.interactLoc(plank, /cross/i);
            }
            await enterDungeon();
            continue;
        }

        if (stage !== 'spoken_shamus') {
            if (++stageTries > 6) {
                log(`Gave up on warrior/Shamus after ${stageTries - 1} tries (stage=${stage})`);
                break;
            }
            // Shamus only appears when the leprechaun tree is chopped; bring the axe before the camp.
            if (!hasAxe() && !(await prepBank(true))) {
                log('No axe from the bank — cannot summon Shamus');
                break;
            }
            stage = await startQuest();
            if (stage === 'complete') {
                warriorSaysComplete = true;
                break;
            }
            if (stage === 'started' && (await talkShamus())) stage = 'spoken_shamus';
            continue;
        }

        // Shamus is done — bank the axe (Entrana bans weapons) and sail.
        if (!(await prepBank(false))) {
            const banned = sdk.getInventory().find((i) => (i.count ?? 0) > 0 && isBanned(i.name));
            if (count(KNIFE) >= 1 && !hasAxe() && !banned) {
                log('Bank stayed closed — knife is packed and nothing banned, sailing anyway');
            } else {
                log('Bank stayed closed and the pack is not ready to sail');
                break;
            }
        }
        if (count(KNIFE) < 1) await pickupKnife();
        if (hasAxe()) {
            log('Still holding an axe after bank — depositing it');
            await depositAxe();
        }
        if (hasAxe()) {
            log('Still holding an axe after bank — not sailing');
            break;
        }
        await sailEntrana();
    }

    if (questDone()) {
        log(`Lost City complete @ ${pos().x},${pos().z}`);
        const left = await leaveZanaris();
        await stepOutOfShed();
        log(`Left Zanaris ok=${left} @ ${pos().x},${pos().z} surface=${onSurface()}`);
    } else throw new Error(`Lost City unfinished @ ${pos().x},${pos().z} branch=${count(BRANCH)} staff=${count(STAFF)}`);
});
