/**
 * Lost City — reusable.
 *
 *   bun bots/quests/lost-city.ts {botname}
 *
 * Warrior camp → Shamus → Entrana (pray) → dungeon bronze axe → tree spirit
 * → Dramen branch → Lumbridge teleport → carve staff → swamp shed.
 *
 * Entrana bans weapons/armour. The dungeon ladder drains 95% prayer, so pray
 * on the island altar first, then tank the spirit with food.
 */
import { appendFileSync } from 'fs';
import { join } from 'path';
import { runScript } from '../../sdk/runner';
import { Spells } from '../../sdk/spells';

const DRAYNOR_BANK = { x: 3092, z: 3245 };
const CAMP = { x: 3145, z: 3202 };
const SHAMUS_TREE = { x: 3139, z: 3211 };
const PORT_SARIM_MONK = { x: 3045, z: 3236 };
const ENTRANA_DOCK = { x: 2834, z: 3335 };
const ENTRANA_ALTAR = { x: 2851, z: 3349 };
const DUNGEON_LADDER = { x: 2822, z: 3374 };
const DUNGEON_ENTRY = { x: 2822, z: 9774 };
const ZOMBIES = { x: 2842, z: 9766 };
const DRAMEN_TREE = { x: 2860, z: 9737 };
const SHED = { x: 3203, z: 3169 };
const KNIFE_SPAWN = { x: 3224, z: 3202 };
const LUMBRIDGE = { x: 3222, z: 3218 };

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
const DUNGEON_TO_TREE = [
    { x: 2835, z: 9765 },
    { x: 2848, z: 9755 },
    { x: 2855, z: 9742 },
    DRAMEN_TREE
];

const MAGIC_TAB = 6;
const KNIFE = /^knife$/i;
const STEEL_AXE = /^steel axe$/i;
const ANY_AXE = /^(bronze|iron|steel|black|mithril|adamant|rune) axe$/i;
const BRONZE_AXE = /^bronze axe$/i;
const BRANCH = /^dramen branch$/i;
const STAFF = /^dramen staff$/i;
const AIR = /^air rune$/i;
const EARTH = /^earth rune$/i;
const LAW = /^law rune$/i;
const FOOD =
    /^(shark|swordfish|lobster|tuna|salmon|trout|bass|anchovies|sardine|herring|bread|cake|wine|meat pie|plain pizza|pineapple pizza)$/i;
const KEEP_BANK =
    /^(knife|air rune|earth rune|law rune|shark|swordfish|lobster|tuna|salmon|trout|bass|bread|cake|wine|meat pie|plain pizza|pineapple pizza|dramen branch|dramen staff)$/i;
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

    function questDone(): boolean {
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
                await sdk.sendClickDialog(opts[0]?.index ?? 0);
                await sdk.waitForTicks(1);
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
                await sdk.sendClickDialog(continues[0]?.index ?? opts[0]?.index ?? 0);
                await sdk.waitForTicks(1);
                continue;
            }
            let picked = false;
            const skip = /please tell me|no, not right now|i don't think i'm strong enough/i;
            for (const c of choices) {
                // p_choice2 publishes 2 lines; the client often has 4
                // (CONTINUE + OK for each). sendClickDialog is 1-based into
                // that live list, so slot 2 hits CONTINUE-Yes (acts as No).
                // Prefer the last match, and if we only see 2 lines try slot 4.
                let last = -1;
                for (let i = 0; i < opts.length; i++) {
                    if (c.test(opts[i].text) && !skip.test(opts[i].text)) last = i;
                }
                if (last < 0) continue;
                const primary = last + 1;
                // Client p_choice2 is often 4 slots (CONTINUE, CONTINUE, OK, OK).
                // Slot 2 is CONTINUE-Yes and plays as No. Click 4 only, wait,
                // and only then fall back to 2.
                const tries = opts.length <= 2 ? [4, 4, primary] : [primary];
                log(
                    `Dialog -> ${opts[last].text} (slots ${tries.join(',')} / published ${opts.length}) [${opts.map((o) => o.text).join(' | ')}]`
                );
                for (const slot of tries) {
                    await sdk.sendClickDialog(slot);
                    await sdk.waitForTicks(3);
                    const now = sdk.getDialog();
                    if (!now?.isOpen) break;
                    const lines = now.options ?? [];
                    const stillChoice = lines.some((o) => c.test(o.text)) && lines.length > 1
                        && !lines.every((o) => /click here to continue/i.test(o.text));
                    if (!stillChoice) break;
                }
                picked = true;
                break;
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

    async function stripGear(): Promise<void> {
        for (const item of [...sdk.getEquipment()]) {
            if ((item.count ?? 0) <= 0) continue;
            intent(`Unequipping ${item.name}`);
            await bot.unequipItem(item);
            await sdk.waitForTicks(1);
        }
    }

    async function prepBank(takeAxe = false): Promise<boolean> {
        if (count(STAFF) > 0 || worn(STAFF) || count(BRANCH) > 0) return true;
        if (inDungeon() || onEntrana() || onShip()) return true;
        if (distTo(DRAYNOR_BANK.x, DRAYNOR_BANK.z) > 20) {
            intent('Walking to Draynor bank');
            await walkNear(DRAYNOR_BANK.x, DRAYNOR_BANK.z, 3);
        }
        intent(takeAxe ? 'Banking (knife, steel axe, lumby runes, food)' : 'Banking axe before Entrana');
        await stripGear();
        await closeUi();
        if (!(sdk.getState()?.bank?.isOpen || (await bot.openBank()).success)) {
            log('Could not open Draynor bank');
            return false;
        }
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
        }
        if (count(AIR) < 9) await bot.withdrawItem(AIR, 9);
        if (count(EARTH) < 3) await bot.withdrawItem(EARTH, 3);
        if (count(LAW) < 3) await bot.withdrawItem(LAW, 3);
        for (const food of sdk.getBankItems().filter((i) => FOOD.test(i.name))) {
            if (count(FOOD) >= 16 || occupied() >= 26) break;
            const room = Math.max(1, 26 - occupied());
            await bot.withdrawItem(food, Math.min(food.count ?? (food as { count?: number }).count ?? room, room));
        }
        await bot.closeBank();
        await closeUi();
        log(
            `Prepped knife=${count(KNIFE)} axe=${hasAxe()} air=${count(AIR)} earth=${count(EARTH)} law=${count(LAW)} food=${count(FOOD)} @ ${pos().x},${pos().z}`
        );
        return count(AIR) >= 3 && count(EARTH) >= 1 && count(LAW) >= 1 && (!takeAxe || hasAxe());
    }

    async function pickupKnife(): Promise<void> {
        if (count(KNIFE) > 0) return;
        intent('Picking up Lumbridge knife');
        await walkNear(KNIFE_SPAWN.x, KNIFE_SPAWN.z, 2);
        await sdk.scanGroundItems(8).catch(() => []);
        const ground = sdk.findGroundItem(KNIFE);
        if (ground) await bot.pickupItem(ground);
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

    async function startQuest(): Promise<boolean> {
        if (count(STAFF) + count(BRANCH) > 0 || worn(STAFF)) return true;
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
            const seen = (await talkNpc(/^warrior$/i, CAMP, choices)).join(' | ');
            log(`Warrior: ${seen || '(no dialog)'}`);
            await chat(choices, 24);
            if (/leprechaun/i.test(seen)) return true;
            if (/have you found anything yet|still searching for zanaris/i.test(seen)) return true;
            log(`Warrior did not start the quest (attempt ${attempt}) — need Looks like you don't know either, not Please tell me?`);
            await closeUi();
        }
        return false;
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
        await talkNpc(/monk of entrana/i, PORT_SARIM_MONK, [/yes,? okay,? i'?m ready to go/i]);
        await chat([/yes,? okay,? i'?m ready to go/i]);
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

    async function prayAltar(): Promise<void> {
        if (inDungeon()) return;
        if (prayerPoints() >= prayerBase() && prayerBase() > 1) return;
        intent('Praying at the Entrana altar');
        await walkNear(ENTRANA_ALTAR.x, ENTRANA_ALTAR.z, 3);
        await sdk.scanNearbyLocs(10).catch(() => []);
        const altar = sdk.findNearbyLoc(/^altar$/i) ?? sdk.findNearbyLoc(/altar/i);
        if (!altar) {
            log(`No altar @ ${pos().x},${pos().z}`);
            return;
        }
        const before = prayerPoints();
        await bot.interactLoc(altar, /pray/i);
        await waitUntil(() => prayerPoints() > before, 6_000);
        log(`Prayer ${prayerPoints()}/${prayerBase()}`);
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
        await walkRoute(DUNGEON_TO_TREE);
        if (!inDungeon()) {
            log('Walked through the wilderness Magic door — aborting tree');
            return;
        }
        await walkNear(DRAMEN_TREE.x, DRAMEN_TREE.z, 3);
        await meleeOn();
        for (let i = 0; i < 80 && count(BRANCH) < 1; i++) {
            await closeUi();
            await eatIfLow(55);
            if (!inDungeon()) {
                log('Left the dungeon (Magic door) before the Dramen tree');
                await meleeOff();
                return;
            }
            if (pos().isDead) {
                log('Died in dungeon — will retry from Lumbridge');
                await meleeOff();
                return;
            }
            const spirit = sdk.findNearbyNpc(/tree spirit/i);
            if (spirit) {
                intent('Killing the tree spirit');
                await meleeOn();
                if (!pos().inCombat) {
                    const atk = await bot.attack(spirit, 8_000);
                    if (!atk.success) log(`spirit: ${atk.message}`);
                }
                await sdk.waitForTicks(2);
                continue;
            }
            await sdk.scanNearbyLocs(10).catch(() => []);
            const magic = sdk.findNearbyLoc(/magic door/i);
            if (magic) log(`Ignoring Magic door @ ${magic.x},${magic.z}`);
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
        await meleeOff();
        log(`Branch=${count(BRANCH)} @ ${pos().x},${pos().z}`);
    }

    async function lumbyTele(): Promise<boolean> {
        if (pos().z < 3520 && distTo(LUMBRIDGE.x, LUMBRIDGE.z) < 40) return true;
        // Regular teles fail after wilderness 20 (z >= 3672 in the main wild).
        if (inWilderness() && pos().z >= 3672) {
            intent('Walking south out of high wilderness');
            await walkNear(pos().x, 3655, 4);
        }
        if (count(AIR) < 3 || count(EARTH) < 1 || count(LAW) < 1) {
            log('Missing Lumbridge teleport runes');
            return false;
        }
        intent('Casting Lumbridge teleport');
        await closeUi();
        await meleeOff();
        const before = { x: pos().x, z: pos().z };
        await sdk.sendSetTab(MAGIC_TAB);
        await sdk.waitForTicks(1);
        await sdk.sendClickComponent(Spells.LUMBRIDGE_TELEPORT);
        await waitUntil(() => distTo(before.x, before.z) > 40 || pos().z < 3520, 8_000);
        log(`After tele @ ${pos().x},${pos().z}`);
        return !inWilderness() && pos().z < 6400;
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
    }

    await closeUi();
    log(
        `Lost City start @ ${pos().x},${pos().z} hp=${pos().hp}/${pos().maxHp} pray=${prayerPoints()}/${prayerBase()} craft=${sdk.getSkill('Crafting')?.baseLevel} wc=${sdk.getSkill('Woodcutting')?.baseLevel}`
    );

    const until = Date.now() + 30 * 60_000;
    while (Date.now() < until && !questDone()) {
        await closeUi();
        await eatIfLow(40);
        if (pos().isDead) {
            await sdk.waitForTicks(4);
            continue;
        }

        if (inWilderness()) {
            log(`Wilderness @ ${pos().x},${pos().z} — Lumbridge teleport, then back to Entrana`);
            await lumbyTele();
            continue;
        }

        if (count(STAFF) > 0 || worn(STAFF)) {
            if (inDungeon() || onEntrana()) await lumbyTele();
            await enterShed();
            continue;
        }
        if (count(BRANCH) > 0) {
            if (inDungeon() || onEntrana()) await lumbyTele();
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
            await prayAltar();
            await enterDungeon();
            continue;
        }

        // Shamus is done — bank the axe (Entrana bans weapons) and sail.
        if (!(await prepBank(false))) {
            log('Need Lumbridge teleport runes in the bank');
            break;
        }
        if (count(KNIFE) < 1) await pickupKnife();
        if (hasAxe()) {
            log('Still holding an axe after bank — not sailing');
            break;
        }
        await sailEntrana();
    }

    if (questDone()) log(`Lost City complete @ ${pos().x},${pos().z}`);
    else throw new Error(`Lost City unfinished @ ${pos().x},${pos().z} branch=${count(BRANCH)} staff=${count(STAFF)}`);
});
