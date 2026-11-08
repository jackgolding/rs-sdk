/**
 * Magic by alchemy to a target level: Low Alchemy below 55, High Alchemy from 55, on a cheap stackable
 * item, nature runes and a fire staff from the bank or, short of them, from jackthief. A run-once task.
 * Family Crest needs Magic 59; on this server Imp Catcher and Witch's Potion (the quest XP) leave most
 * accounts at 44-56, and alchemy closes the rest (user, 2026-11-08).
 *
 *   bun bots/quests/alch-train.ts {botname} [--until=59] [--items='magic longbow,yew longbow,…'] [--mule=jackthief]
 *
 * Items in order of preference: the strung longbows pay far more coins a cast than arrows (user, 2026-11-08);
 * bronze arrows (1,700 at jackthief) cover the casts once the bows run out. Bows travel as bank notes.
 *
 * Spells (sdk/spells.ts; skill_magic magic_spells.dbrow): Low Alchemy L21, 3 fire + 1 nature; High Alchemy
 * L55, 5 fire + 1 nature. A staff of fire stands in for the fire runes. Logs "already complete" at the
 * target, so todo-runner marks it done.
 */
import { runTask, type Quest } from './lib/run-quest';
import { itemPattern } from './lib/sources';
import { requestFromMule } from './supply';
import { Spells } from '../../sdk/spells';

const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const UNTIL = Number(arg('until') ?? 59);
const ITEMS = (arg('items') ?? arg('item') ?? 'magic longbow,yew longbow,maple longbow,willow longbow,oak longbow,longbow,bronze arrow')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
const MULE = arg('mule') ?? 'jackthief';
/** Casts a supply run asks for: Low Alchemy's ~775 XP a cast on this server makes 60 enough for 44 -> 59. */
const BATCH = Number(arg('batch') ?? 80);

const STAFF = /^(staff of fire|fire battlestaff|mystic fire staff|lava battlestaff|mystic lava staff)$/i;
const NATURE = /^nature rune$/i;
const FIRE = /^fire rune$/i;
const PATTERNS = ITEMS.map((i) => itemPattern(i));
/** Any alch item, noted or not (a bank note keeps the item's name). */
const TARGET = { test: (name: string) => PATTERNS.some((p) => p.test(name)) } as RegExp;

const magic = (q: Quest) => q.sdk.getSkill('magic')?.baseLevel ?? q.level('magic');
const held = (q: Quest, re: RegExp) => q.sdk.getInventory().filter((i) => re.test(i.name)).reduce((n, i) => n + (i.count ?? 1), 0);
const worn = (q: Quest, re: RegExp) => q.sdk.getEquipment().some((i) => re.test(i.name));

/** From the bank (open) what it has: the staff, the natures, the item; true when a cast is possible. */
async function fromBank(q: Quest): Promise<void> {
    const opened = await q.bot.openBank();
    if (!opened.success && !q.sdk.getState()?.bank?.isOpen) throw new Error(`alch: bank did not open: ${opened.message}`);
    for (const [re, n, note] of [[STAFF, 1, false], [NATURE, -1, false], [FIRE, -1, false], ...PATTERNS.map((p) => [p, -1, true] as const)] as const) {
        if (re === STAFF && (worn(q, STAFF) || held(q, STAFF))) continue;
        const b = q.sdk.getBankItems().find((i) => re.test(i.name) && i.count > 0);
        if (b) await q.bot.withdrawItem(b, n, { asNote: note }).catch(() => undefined);
    }
    await q.sdk.waitForTicks(2);
    await q.bot.closeBank().catch(() => undefined);
}

await runTask({
    id: 'alch-train',
    hub: 'ardougne',
    task: async (q) => {
        if (magic(q) >= UNTIL) return void q.log(`alch: Magic ${magic(q)} is at the target ${UNTIL} — already complete`);
        if (magic(q) < 21) throw new Error(`alch: Magic ${magic(q)} is below Low Alchemy's 21`);
        let empty = 0;
        while (magic(q) < UNTIL && !q.stopRequested()) {
            await fromBank(q);
            const fireOk = () => worn(q, STAFF) || held(q, STAFF) || held(q, FIRE) >= 5;
            if (!held(q, NATURE) || !held(q, TARGET) || !fireOk()) {
                const ctx = { sdk: q.sdk, bot: q.bot, session: null, log: q.log } as never;
                const runes = [
                    { label: 'nature rune', pattern: NATURE, count: BATCH },
                    ...(fireOk() ? [] : [{ label: 'staff of fire', pattern: /^staff of fire$/i, count: 1 }]),
                ];
                if (!held(q, NATURE) || !fireOk()) await requestFromMule(ctx, runes, { mule: MULE, timeoutMs: 10 * 60_000 });
                // The items as notes, every line in one trade: the mule serves the bows it holds and skips the rest.
                if (!held(q, TARGET)) {
                    await requestFromMule(ctx, ITEMS.map((label, i) => ({ label, pattern: PATTERNS[i]!, count: BATCH })), { mule: MULE, timeoutMs: 10 * 60_000, noted: true });
                }
                if (!held(q, NATURE) || !held(q, TARGET) || !fireOk()) {
                    if (++empty >= 2) throw new Error(`alch: no ${!held(q, NATURE) ? 'nature runes' : !held(q, TARGET) ? 'alch items' : 'fire staff'} from the bank or ${MULE}`);
                    continue;
                }
            }
            const staff = q.sdk.getInventory().find((i) => STAFF.test(i.name));
            if (staff) await q.bot.equipItem(staff).catch(() => undefined);
            let misses = 0;
            for (let cast = 0; magic(q) < UNTIL && held(q, NATURE) && held(q, TARGET) && fireOk() && misses < 5 && !q.stopRequested(); cast++) {
                // The most valuable item held first: the list order.
                const item = PATTERNS.map((p) => q.sdk.getInventory().find((i) => p.test(i.name))).find(Boolean)!;
                const xp = q.sdk.getSkill('magic')?.experience ?? 0;
                const spell = magic(q) >= 55 ? Spells.HIGH_ALCHEMY : Spells.LOW_ALCHEMY;
                await q.sdk.sendSpellOnItem(item.slot, spell).catch(() => undefined);
                const gained = await q.sdk
                    .waitForCondition((s) => (s.skills.find((k) => k.name === 'Magic')?.experience ?? 0) > xp, 5_000)
                    .then(() => true)
                    .catch(() => false);
                if (!gained) misses++;
                else misses = 0;
                if (cast % 10 === 0) q.log(`alch: ${spell === Spells.HIGH_ALCHEMY ? 'high' : 'low'} alchemy, Magic ${magic(q)} (${q.sdk.getSkill('magic')?.experience} xp), ${held(q, NATURE)} natures`);
            }
            if (misses >= 5) throw new Error(`alch: five casts in a row gave no Magic XP (Magic ${magic(q)})`);
        }
        // The epilogue banks the pack, not what is worn: take the staff off so the account ends naked at the hub.
        const wornStaff = q.sdk.getEquipment().find((i) => STAFF.test(i.name));
        if (wornStaff) await q.bot.unequipItem(wornStaff).catch(() => undefined);
        q.log(`alch: Magic ${magic(q)} — already complete`);
    },
});
