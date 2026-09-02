/**
 * Drain Lundail of cosmics, law runes, and natures using Buy 10.
 *
 *   bun bots/quests/lundail-runes.ts jackthief
 */
import { runScript } from '../../sdk/runner';

const botName = process.argv.slice(2).find((a) => !a.startsWith('-')) ?? '';
if (!botName) throw new Error('Usage: bun bots/quests/lundail-runes.ts {name}');

const WANT: { pattern: RegExp; label: string }[] = [
    { pattern: /^cosmic rune$/i, label: 'cosmic' },
    { pattern: /^law rune$/i, label: 'law' },
    { pattern: /^nature rune$/i, label: 'nature' },
];
const COIN_WITHDRAW = 50_000;

await runScript(
    async ({ bot, sdk }) => {
        const coins = () => sdk.findInventoryItem(/^coins$/i)?.count ?? 0;
        const countItem = (pattern: RegExp) =>
            sdk.getInventory().filter((i) => pattern.test(i.name)).reduce((n, i) => n + (i.count ?? 0), 0);
        const shopLine = (pattern: RegExp) =>
            sdk.getState()?.shop?.shopItems.find((i) => pattern.test(i.name)) ?? null;

        async function clickThroughBankerChat(): Promise<void> {
            let sawOpen = false;
            for (let i = 0; i < 16; i++) {
                const dialog = sdk.getDialog();
                if (!dialog?.isOpen) {
                    if (sawOpen || sdk.getState()?.bank?.isOpen) return;
                    await sdk.waitForTicks(1).catch(() => {});
                    continue;
                }
                sawOpen = true;
                if (dialog.isWaiting) {
                    await sdk.waitForTicks(1).catch(() => {});
                    continue;
                }
                const bank = dialog.options?.find((o) => /bank account|access my bank/i.test(o.text));
                if (bank) {
                    await sdk.sendClickDialog(bank.index);
                    await sdk.waitForTicks(2).catch(() => {});
                    continue;
                }
                const cont = dialog.options?.find((o) => /continue/i.test(o.text));
                if (cont) {
                    await sdk.sendClickDialog(cont.index);
                    await sdk.waitForTicks(1).catch(() => {});
                    continue;
                }
                await sdk.sendClickDialog(dialog.options[0]?.index ?? 1);
                await sdk.waitForTicks(1).catch(() => {});
            }
        }

        async function ensureShop(): Promise<void> {
            await bot.dismissBlockingUI();
            if (sdk.getState()?.shop?.isOpen) return;
            const opened = await bot.openShop(/lundail/i);
            if (!opened.success && !sdk.getState()?.shop?.isOpen) {
                const npc = sdk.findNearbyNpc(/lundail/i);
                if (npc) await bot.interactNpc(npc, /trade/i);
            }
            if (!sdk.getState()?.shop?.isOpen) {
                throw new Error('Lundail shop is not open');
            }
        }

        async function restockCoins(): Promise<boolean> {
            const before = coins();
            if (sdk.getState()?.shop?.isOpen) await bot.closeShop();
            await bot.closeInterface();
            const gundai = sdk.findNearbyNpc(/gundai/i);
            if (!gundai) {
                console.log('Gundai not visible — cannot withdraw coins');
                return false;
            }
            const talk = gundai.optionsWithIndex.find((o) => /talk/i.test(o.text));
            await sdk.sendInteractNpc(gundai.index, talk?.opIndex ?? 1, { route: false });
            await clickThroughBankerChat();
            if (!sdk.getState()?.bank?.isOpen) {
                console.log('Gundai bank did not open');
                return false;
            }
            const bankCoins = sdk.findBankItem(/^coins$/i)?.count ?? 0;
            if (bankCoins < 1) {
                console.log(`Bank has no coins (inv ${before}gp)`);
                await bot.closeBank();
                return false;
            }
            const want = Math.min(COIN_WITHDRAW, bankCoins);
            const r = await bot.withdrawItem(/^coins$/i, want);
            console.log(`Withdraw coins: ${r.success || r.partial ? 'ok' : r.message} now ${coins()}gp (bank had ${bankCoins})`);
            await bot.closeBank();
            return coins() > before;
        }

        await ensureShop();

        const stockSnap = WANT.map(({ pattern, label }) => {
            const line = shopLine(pattern);
            return `${label} ${line?.count ?? 0}@${line?.buyPrice ?? '?'}gp`;
        }).join(' | ');
        console.log(`Lundail open | ${stockSnap} | ${coins()}gp`);

        if (coins() < 400) {
            if (!(await restockCoins())) throw new Error('Need more coins from Gundai');
            await ensureShop();
        }

        const bought: Record<string, number> = {};
        for (const { pattern, label } of WANT) {
            const before = countItem(pattern);
            let restocked = false;
            for (let n = 0; n < 80; n++) {
                const line = shopLine(pattern);
                if (!line || line.count <= 0) break;
                const price = line.buyPrice ?? 1;
                if (coins() < price) {
                    if (!restocked) {
                        restocked = true;
                        if (await restockCoins()) {
                            await ensureShop();
                            continue;
                        }
                    }
                    console.log(`Out of coins on ${label} (shelf ${line.count})`);
                    break;
                }
                const stockBefore = line.count;
                const invBefore = countItem(pattern);
                const r = await sdk.sendShopBuy(line.slot, 10);
                if (!r.success) {
                    console.log(`Buy-10 ${label} failed: ${r.message}`);
                    break;
                }
                await sdk
                    .waitForCondition(
                        () =>
                            (shopLine(pattern)?.count ?? stockBefore) < stockBefore ||
                            countItem(pattern) > invBefore ||
                            coins() < price,
                        5_000,
                    )
                    .catch(() => {});
                if (countItem(pattern) <= invBefore && (shopLine(pattern)?.count ?? 0) >= stockBefore) {
                    if (!restocked && coins() < price * 10) {
                        restocked = true;
                        if (await restockCoins()) {
                            await ensureShop();
                            continue;
                        }
                    }
                    console.log(`Buy-10 ${label} no progress (shelf ${shopLine(pattern)?.count ?? 0}, ${coins()}gp)`);
                    break;
                }
            }
            bought[label] = countItem(pattern) - before;
            const left = shopLine(pattern)?.count ?? 0;
            console.log(`+${bought[label]} ${label} | shelf ${left} | ${coins()}gp`);
        }

        await bot.closeShop().catch(() => {});
        console.log(
            `Done. +${WANT.map((w) => `${bought[w.label] ?? 0} ${w.label}`).join(' +')} | ` +
                `inv ${WANT.map((w) => `${countItem(w.pattern)} ${w.label}`).join(' ')} | ${coins()}gp`,
        );
    },
    { timeout: 180_000 },
);
