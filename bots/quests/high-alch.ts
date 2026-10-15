/**
 * High Alchemy grind script.
 *
 * Requirements:
 * - Must be at a bank.
 * - Equips a fire staff (withdraws from bank if needed).
 * - Withdraws Nature runes into inventory.
 * - Withdraws noted Magic longbows (or Fire battlestaves) and casts High Alchemy on them.
 *
 * Usage:
 *   bun bots/quests/high-alch.ts jackthief
 */
import { runScript } from '../../sdk/runner';
import { BotSDK, Spells } from '../../sdk/index';
import { BotActions } from '../../sdk/actions';
import { playerPos, closeUi, walkNear, distTo } from './movement';
import {
    ARDOUGNE_BANK,
    CATHERBY_BANK,
    DRAYNOR_BANK,
    EDGEVILLE,
    FALADOR_EAST_BANK,
    FALADOR_WEST_BANK,
    SEERS_BANK,
    type Tile
} from './tiles';

const FIRE_STAFF_PATTERN = /^(staff of fire|fire battlestaff|mystic fire staff|lava battlestaff|mystic lava staff)$/i;
const NATURE_RUNE_PATTERN = /^nature rune$/i;
const ALCH_TARGETS_PATTERN = /^(magic longbow|fire battlestaff)$/i;
const MAGIC_LONGBOW_PATTERN = /^magic longbow$/i;
const FIRE_BATTLESTAFF_PATTERN = /^fire battlestaff$/i;

const KNOWN_BANKS: Tile[] = [
    CATHERBY_BANK,
    SEERS_BANK,
    ARDOUGNE_BANK,
    EDGEVILLE,
    DRAYNOR_BANK,
    FALADOR_EAST_BANK,
    FALADOR_WEST_BANK
];

const botName = process.argv.slice(2).find((a) => !a.startsWith('-')) ?? 'jackthief';

function getUsableBooth(sdk: BotSDK) {
    return (sdk.getNearbyLocs() ?? [])
        .filter((l) => /bank booth/i.test(l.name) && (l.optionsWithIndex?.length ?? 0) > 0)
        .sort((a, b) => (a.distance ?? 99) - (b.distance ?? 99))[0];
}

async function ensureAtBank(bot: BotActions, sdk: BotSDK): Promise<boolean> {
    const booth = getUsableBooth(sdk);
    if (booth && (booth.distance ?? 99) <= 4) {
        return true;
    }

    const p = playerPos(sdk);
    let closestBank = KNOWN_BANKS[0];
    let minDist = Infinity;
    for (const bank of KNOWN_BANKS) {
        const d = Math.hypot(p.x - bank.x, p.z - bank.z);
        if (d < minDist) {
            minDist = d;
            closestBank = bank;
        }
    }

    console.log(`[alch] Navigating to closest bank (${closestBank.x}, ${closestBank.z})...`);
    return await walkNear(bot, sdk, closestBank.x, closestBank.z, 3);
}

async function openBankReliable(bot: BotActions, sdk: BotSDK): Promise<boolean> {
    if (sdk.getState()?.bank?.isOpen) return true;

    await closeUi(bot, sdk);
    const res = await bot.openBank(8_000);
    if (res.success && sdk.getState()?.bank?.isOpen) {
        await sdk.waitForTicks(1);
        return true;
    }

    const booth = getUsableBooth(sdk);
    if (booth) {
        console.log(`[alch] openBank missed, interacting with booth at (${booth.x}, ${booth.z})`);
        await bot.interactLoc(booth, /use.quickly|bank/i);
        await sdk.waitForCondition((s) => s.bank?.isOpen === true, 6_000).catch(() => {});
    }

    const opened = sdk.getState()?.bank?.isOpen === true;
    if (opened) {
        await sdk.waitForTicks(1);
    }
    return opened;
}

await runScript(async ({ bot, sdk }) => {
    console.log(`[alch] Starting High Alchemy script for ${botName}...`);
    let totalAlched = 0;
    const startMagicXp = sdk.getSkill('Magic')?.experience ?? 0;

    while (true) {
        await bot.dismissBlockingUI();

        // 1. Check if Fire Staff is equipped
        const equippedWeapon = sdk.findEquipmentItem(FIRE_STAFF_PATTERN);
        if (!equippedWeapon) {
            console.log('[alch] Fire staff not equipped. Checking inventory...');
            const invStaff = sdk.findInventoryItem(FIRE_STAFF_PATTERN);
            if (invStaff) {
                console.log(`[alch] Equipping ${invStaff.name} from inventory...`);
                await closeUi(bot, sdk);
                const equipRes = await bot.equipItem(FIRE_STAFF_PATTERN);
                if (!equipRes.success) {
                    console.error(`[alch] Failed to equip fire staff: ${equipRes.message}`);
                    break;
                }
            } else {
                console.log('[alch] Fire staff not in inventory. Opening bank to withdraw...');
                if (!(await ensureAtBank(bot, sdk))) {
                    console.error('[alch] Could not reach bank.');
                    break;
                }
                if (!(await openBankReliable(bot, sdk))) {
                    console.error('[alch] Could not open bank to retrieve fire staff.');
                    break;
                }

                const bankStaff = sdk.findBankItem(FIRE_STAFF_PATTERN);
                if (!bankStaff) {
                    console.error('[alch] No fire staff (Staff of fire / Fire battlestaff / Lava staff) found in bank!');
                    await bot.closeBank();
                    break;
                }

                console.log(`[alch] Withdrawing 1x ${bankStaff.name}...`);
                const withdrawStaffRes = await bot.withdrawItem(FIRE_STAFF_PATTERN, 1, { asNote: false });
                if (!withdrawStaffRes.success) {
                    console.error(`[alch] Failed to withdraw fire staff: ${withdrawStaffRes.message}`);
                    await bot.closeBank();
                    break;
                }

                await bot.closeBank();
                await sdk.waitForTicks(1);
                console.log(`[alch] Equipping ${bankStaff.name}...`);
                const equipRes = await bot.equipItem(FIRE_STAFF_PATTERN);
                if (!equipRes.success) {
                    console.error(`[alch] Failed to equip fire staff: ${equipRes.message}`);
                    break;
                }
            }
        }

        // 2. Check for Nature Runes in inventory
        let invNatures = sdk.findInventoryItem(NATURE_RUNE_PATTERN);
        if (!invNatures || invNatures.count <= 0) {
            console.log('[alch] No nature runes in inventory. Opening bank to withdraw...');
            if (!(await ensureAtBank(bot, sdk))) {
                console.error('[alch] Could not reach bank.');
                break;
            }
            if (!(await openBankReliable(bot, sdk))) {
                console.error('[alch] Could not open bank to withdraw nature runes.');
                break;
            }

            const bankNatures = sdk.findBankItem(NATURE_RUNE_PATTERN);
            if (!bankNatures || bankNatures.count <= 0) {
                console.error('[alch] Out of Nature runes in bank and inventory!');
                await bot.closeBank();
                break;
            }

            console.log(`[alch] Withdrawing ${bankNatures.count} Nature runes...`);
            const withdrawNatRes = await bot.withdrawItem(NATURE_RUNE_PATTERN, -1);
            if (!withdrawNatRes.success) {
                console.error(`[alch] Failed to withdraw nature runes: ${withdrawNatRes.message}`);
                await bot.closeBank();
                break;
            }
            invNatures = sdk.findInventoryItem(NATURE_RUNE_PATTERN);
        }

        // 3. Check for alchable items in inventory (Magic longbows or Fire battlestaves)
        let invAlchItems = sdk.getInventory().filter((i) => ALCH_TARGETS_PATTERN.test(i.name));
        if (invAlchItems.length === 0) {
            console.log('[alch] No Magic longbows or Fire battlestaves in inventory. Checking bank...');
            if (!(await ensureAtBank(bot, sdk))) {
                console.error('[alch] Could not reach bank.');
                break;
            }
            if (!(await openBankReliable(bot, sdk))) {
                console.error('[alch] Could not open bank to withdraw alch targets.');
                break;
            }

            const bankBows = sdk.findBankItem(MAGIC_LONGBOW_PATTERN);
            const bankStaves = sdk.findBankItem(FIRE_BATTLESTAFF_PATTERN);

            if (bankBows && bankBows.count > 0) {
                console.log(`[alch] Withdrawing ${bankBows.count} noted Magic longbows...`);
                const withdrawRes = await bot.withdrawItem(MAGIC_LONGBOW_PATTERN, -1, { asNote: true });
                if (!withdrawRes.success) {
                    console.error(`[alch] Failed to withdraw noted Magic longbows: ${withdrawRes.message}`);
                    await bot.closeBank();
                    break;
                }
            } else if (bankStaves && bankStaves.count > 0) {
                console.log(`[alch] Withdrawing ${bankStaves.count} noted Fire battlestaves...`);
                const withdrawRes = await bot.withdrawItem(FIRE_BATTLESTAFF_PATTERN, -1, { asNote: true });
                if (!withdrawRes.success) {
                    console.error(`[alch] Failed to withdraw noted Fire battlestaves: ${withdrawRes.message}`);
                    await bot.closeBank();
                    break;
                }
            } else {
                console.log('[alch] No Magic longbows or Fire battlestaves left in bank or inventory!');
                await bot.closeBank();
                break;
            }
        }

        // 4. Ensure bank and interfaces are closed before casting alchemy
        await closeUi(bot, sdk);

        // 5. Alching Loop
        console.log('[alch] Casting High Alchemy on items...');
        while (true) {
            await bot.dismissBlockingUI();

            const currentNatures = sdk.findInventoryItem(NATURE_RUNE_PATTERN);
            if (!currentNatures || currentNatures.count <= 0) {
                console.log('[alch] Out of nature runes in inventory, restocking from bank...');
                break;
            }

            const alchItem = sdk.getInventory().find((i) => ALCH_TARGETS_PATTERN.test(i.name));
            if (!alchItem || alchItem.count <= 0) {
                console.log('[alch] Finished alching current batch, checking bank for more...');
                break;
            }

            const xpBefore = sdk.getSkill('Magic')?.experience ?? 0;
            const coinsBefore = sdk.findInventoryItem(/^coins?$/i)?.count ?? 0;

            const castRes = await sdk.sendSpellOnItem(alchItem.slot, Spells.HIGH_ALCHEMY);
            if (!castRes.success) {
                console.warn(`[alch] Spell cast failed: ${castRes.message}`);
                await sdk.waitForTicks(1);
                continue;
            }

            // High Alchemy takes 5 ticks (~3s). Wait for Magic XP gain or tick delay.
            const gainedXp = await sdk
                .waitForCondition((s) => {
                    const currentXp = s.skills.find((sk) => sk.name === 'Magic')?.experience ?? 0;
                    return currentXp > xpBefore;
                }, 4000)
                .then(() => true)
                .catch(() => false);

            if (gainedXp) {
                totalAlched++;
                const xpAfter = sdk.getSkill('Magic')?.experience ?? 0;
                const coinsAfter = sdk.findInventoryItem(/^coins?$/i)?.count ?? 0;
                const remainingNats = sdk.findInventoryItem(NATURE_RUNE_PATTERN)?.count ?? 0;
                const remainingItem = sdk.getInventory().find((i) => i.slot === alchItem.slot)?.count ?? 0;

                console.log(
                    `[alch] Alched ${alchItem.name} (+${xpAfter - xpBefore} XP, +${(coinsAfter - coinsBefore).toLocaleString()} gp) | Total Alched: ${totalAlched} | Nature Runes left: ${remainingNats.toLocaleString()} | Stack left: ${remainingItem.toLocaleString()}`
                );
            } else {
                console.log('[alch] No XP gain detected on this tick, waiting...');
                await sdk.waitForTicks(1);
            }
        }
    }

    const endMagicXp = sdk.getSkill('Magic')?.experience ?? 0;
    const finalCoins = sdk.findInventoryItem(/^coins?$/i)?.count ?? 0;
    console.log('\n=== High Alchemy Finished ===');
    console.log(`Total Alched: ${totalAlched}`);
    console.log(`Magic XP Gained: +${(endMagicXp - startMagicXp).toLocaleString()}`);
    console.log(`Current Coins: ${finalCoins.toLocaleString()}`);
});
