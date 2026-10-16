/**
 * Multi-Bot Grand Finale: JackThief Final 99 Mining & Fleet Max Celebration!
 *
 * 1. JackThief equips his Rune Pickaxe and heads straight to Ardougne South Iron Mine (2626, 3149).
 * 2. Fleet bots walk DIRECTLY to their cheering tiles around the iron rocks (no banking detour).
 * 3. JackThief immediately begins power-mining iron ore until Level 99 (9,984,580 XP).
 * 4. The moment 99 is reached, JackThief & all fleet bots trigger synchronized emotes (cheer, dance, wave, clap)
 *    and colorful animated chat effects (flash1:wave:, glow2:wave:, cyan:scroll:, red:shake:, etc.)!
 *
 * Usage:
 *   bun bots/quests/max-mining-celebration.ts
 */
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { BotSDK, deriveGatewayUrl } from '../../sdk/index';
import { BotActions } from '../../sdk/actions';
import { initPathfinding, isTileWalkable } from '../../sdk/pathfinding';
import { playerPos, walkNear, closeUi, distTo } from './movement';
import {
    CATHERBY_BANK,
    type Tile
} from './tiles';

const TARGET_MINING_XP = 9_984_580; // Level 99
const MINE_CENTER: Tile = { x: 2626, z: 3149 }; // Ardougne South Iron Mine
const RUNE_PICKAXE = /^rune pickaxe$/i;
const IRON_ORE = /^iron ore$/i;

// RS2 Emote Component IDs
const EMOTE_CHEER = 171; // controls:com_23
const EMOTE_DANCE = 166; // controls:com_18
const EMOTE_WAVE = 163;  // controls:com_15
const EMOTE_CLAP = 172;  // controls:com_24
const EMOTE_BOW = 164;   // controls:com_16
const EMOTE_LAUGH = 170; // controls:com_22

const CELEBRATION_EFFECTS = [
    "flash1:wave:",
    "glow2:wave:",
    "cyan:scroll:",
    "red:shake:",
    "purple:wave2:",
    "green:wave:",
    "white:slide:",
    "glow1:wave:",
    "flash2:shake:",
    "cyan:wave:",
    "red:wave2:",
    "glow3:wave:",
    "flash3:wave:",
    "purple:scroll:",
    "green:wave2:",
    "flash1:shake:",
    "glow2:scroll:"
];

const CELEBRATION_MESSAGES = [
    "grats on max JackThief",
    "GZZZZ ON MAX JACKTHIEF!!!",
    "HUGE GZ JACKTHIEF 99/99 ALL STATS",
    "MAX CAPE TIME GZ JACKTHIEF",
    "GZ on max JackThief!! Absolute legend!",
    "grats on max JackThief! You did it!",
    "GZZZZZZZZ JACKTHIEF",
    "MAXED ACC GZ JACKTHIEF!!!",
    "ALL 99S GZ JACKTHIEF!",
    "Huge congrats JackThief on maxing!!",
    "GZ ON MAX JACKTHIEF",
    "LETS GOOO GZ ON MAX JACKTHIEF",
    "grats on 99 mining and maxing JackThief!",
    "GZ JACKTHIEF MAXED OUT",
    "MASSIVE GZ JACKTHIEF",
    "W GZ ON MAX JACKTHIEF",
    "grats on max JackThief!!!",
    "THE GRIND IS COMPLETE! GZ JACKTHIEF",
    "GZ JACKTHIEF 99 MINING & FULL MAX",
    "CONGRATS JACKTHIEF ON MAX",
    "GZZZZZZZZ ON MAX JACKTHIEF",
    "gz on max jackthief!",
    "grats on max JackThief legend",
    "GZ JACKTHIEF BEST IN THE GAME",
    "ALL 99S UNLOCKED GZ JACKTHIEF",
    "GZZZZZZ JACKTHIEF THE GOAT",
    "99 MINING COMPLETED! GZ JACKTHIEF",
    "CONGRATULATIONS ON FULL MAX JACKTHIEF!!",
    "GZ JACKTHIEF YOU ARE UNSTOPPABLE",
    "MAXED FLEET LEADER GZ JACKTHIEF!"
];

const CATHERBY_TO_MINE: Tile[] = [
    { x: 2804, z: 3441 },
    { x: 2788, z: 3460 },
    { x: 2758, z: 3477 },
    { x: 2726, z: 3485 },
    { x: 2695, z: 3375 },
    { x: 2662, z: 3375 },
    { x: 2662, z: 3336 },
    { x: 2662, z: 3312 },
    { x: 2655, z: 3283 },
    { x: 2640, z: 3220 },
    { x: 2630, z: 3170 },
    MINE_CENTER
];

interface BotClient {
    name: string;
    sdk: BotSDK;
    bot: BotActions;
}

function loadBotCredentials(name: string): { username: string; password: string; server?: string } {
    const envPath = join(process.cwd(), 'bots', name, 'bot.env');
    if (!existsSync(envPath)) throw new Error(`bot.env not found for ${name}`);
    const content = readFileSync(envPath, 'utf-8');
    const env: Record<string, string> = {};
    for (const line of content.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eq = trimmed.indexOf('=');
        if (eq > 0) env[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
    }
    return {
        username: env.BOT_USERNAME || name,
        password: env.PASSWORD!,
        server: env.SERVER
    };
}

async function createBotClient(name: string): Promise<BotClient> {
    const creds = loadBotCredentials(name);
    const sdk = new BotSDK({
        botUsername: creds.username,
        password: creds.password,
        server: creds.server,
        gatewayUrl: deriveGatewayUrl(creds.server),
        autoLaunchBrowser: false,
        connectTimeout: 30_000,
        readyTimeout: 20_000,
        showChat: false
    });
    await sdk.connect();
    const bot = new BotActions(sdk);
    return { name, sdk, bot };
}

function getCheeringTiles(count: number): Tile[] {
    const tiles: { x: number; z: number; dist: number }[] = [];
    for (let r = 2; r <= 6; r++) {
        for (let dx = -r; dx <= r; dx++) {
            for (let dz = -r; dz <= r; dz++) {
                if (Math.abs(dx) !== r && Math.abs(dz) !== r) continue;
                const tx = MINE_CENTER.x + dx;
                const tz = MINE_CENTER.z + dz;
                if (isTileWalkable(0, tx, tz)) {
                    tiles.push({ x: tx, z: tz, dist: Math.hypot(dx, dz) });
                }
            }
        }
    }
    tiles.sort((a, b) => a.dist - b.dist);
    return tiles.slice(0, count).map((t) => ({ x: t.x, z: t.z }));
}

async function walkWaypoints(bot: BotActions, sdk: BotSDK, waypoints: Tile[]): Promise<boolean> {
    for (const wp of waypoints) {
        if (!sdk.isConnected()) return false;
        if (distTo(sdk, wp.x, wp.z) <= 6) continue;
        await walkNear(bot, sdk, wp.x, wp.z, 4);
    }
    return true;
}

async function navigateToMine(bot: BotActions, sdk: BotSDK, targetTile: Tile): Promise<void> {
    const p = playerPos(sdk);
    if (distTo(sdk, targetTile.x, targetTile.z) <= 2) {
        return;
    }
    if (p.x > 2700 && p.z > 3350) {
        await walkWaypoints(bot, sdk, CATHERBY_TO_MINE);
    } else if (p.x >= 2600 && p.x <= 2700 && p.z >= 3100 && p.z <= 3350) {
        await walkNear(bot, sdk, targetTile.x, targetTile.z, 1);
    } else {
        await walkNear(bot, sdk, targetTile.x, targetTile.z, 2);
    }
}

async function prepareAndMoveFleetBot(client: BotClient, targetTile: Tile): Promise<void> {
    const { bot, sdk, name } = client;
    try {
        if (!sdk.isConnected()) return;
        await bot.dismissBlockingUI();

        // Directly walk to cheer position (no banking detour)
        if (distTo(sdk, targetTile.x, targetTile.z) > 1) {
            console.log(`[fleet] ${name} walking straight to cheer spot (${targetTile.x}, ${targetTile.z})...`);
            await navigateToMine(bot, sdk, targetTile);
            console.log(`[fleet] ${name} arrived at cheer position!`);
        }
    } catch (err: any) {
        console.warn(`[fleet] ${name} navigation notice: ${err?.message ?? err}`);
    }
}

async function prepareJackThief(client: BotClient): Promise<void> {
    const { bot, sdk } = client;
    console.log('[jackthief] Preparing JackThief for the final 99 grind...');
    await bot.dismissBlockingUI();

    // 1. Check if already at mine
    if (distTo(sdk, MINE_CENTER.x, MINE_CENTER.z) <= 5) {
        console.log('[jackthief] Already at mine!');
        return;
    }

    // 2. Check if Rune pickaxe is equipped
    const equippedPick = sdk.findEquipmentItem(RUNE_PICKAXE);
    if (!equippedPick) {
        console.log('[jackthief] Equipping Rune pickaxe from bank...');
        await walkNear(bot, sdk, CATHERBY_BANK.x, CATHERBY_BANK.z, 3);
        const openRes = await bot.openBank(8_000);
        if (openRes.success || sdk.getState()?.bank?.isOpen) {
            for (const item of sdk.getInventory()) {
                await bot.depositItem(item.slot, -1).catch(() => {});
            }
            const pick = sdk.findBankItem(RUNE_PICKAXE);
            if (pick) {
                await bot.withdrawItem(RUNE_PICKAXE, 1, { asNote: false });
            }
            await bot.closeBank();
            await sdk.waitForTicks(1);
            await bot.equipItem(RUNE_PICKAXE);
        }
    }

    // 3. Walk to Ardougne South iron mine center
    console.log('[jackthief] Walking to Ardougne South Iron Mine...');
    await navigateToMine(bot, sdk, MINE_CENTER);
    console.log('[jackthief] Arrived at Iron Mine center!');
}

console.log('=== JackThief Maxing Finale Celebration ===');
initPathfinding();

// Load roster bots
const rosterJson = JSON.parse(readFileSync(join(process.cwd(), 'bots', 'roster.json'), 'utf-8'));
const fleetBotNames: string[] = rosterJson.bots
    .map((b: any) => b.name)
    .filter((name: string) => name !== 'jackthief');

// 1. Connect JackThief
console.log('Connecting JackThief...');
const jackthiefClient = await createBotClient('jackthief');
const startMiningXp = jackthiefClient.sdk.getSkill('Mining')?.experience ?? 0;
const startMiningLvl = jackthiefClient.sdk.getSkill('Mining')?.baseLevel ?? 1;
console.log(`JackThief current Mining: Level ${startMiningLvl} (${startMiningXp.toLocaleString()} XP)`);

// 2. Prepare JackThief (walk to mine & equip pickaxe)
await prepareJackThief(jackthiefClient);

// 3. Connect and mobilize fleet bots directly to cheer formation
const fleetClients: BotClient[] = [];
const cheerTiles = getCheeringTiles(fleetBotNames.length);

(async () => {
    console.log('Mobilizing fleet bots straight to cheer spots...');
    const BATCH_SIZE = 8;
    for (let i = 0; i < fleetBotNames.length; i += BATCH_SIZE) {
        const batch = fleetBotNames.slice(i, i + BATCH_SIZE);
        await Promise.all(
            batch.map(async (name, batchIdx) => {
                const client = await createBotClient(name).catch((err) => {
                    console.warn(`Could not connect ${name}: ${err?.message ?? err}`);
                    return null;
                });
                if (client) {
                    fleetClients.push(client);
                    const tile = cheerTiles[i + batchIdx] || MINE_CENTER;
                    prepareAndMoveFleetBot(client, tile).catch(() => {});
                }
            })
        );
        await jackthiefClient.sdk.waitForTicks(1);
    }
    console.log(`Mobilized ${fleetClients.length} fleet cheering bots!`);
})().catch(console.error);

// 4. JackThief Power-Mining Iron to 99!
console.log('\n=== JackThief Starting Power-Mining to 99! ===');
const { bot, sdk } = jackthiefClient;

let minedOres = 0;
while (true) {
    await bot.dismissBlockingUI();
    const currentXp = sdk.getSkill('Mining')?.experience ?? 0;
    const currentLvl = sdk.getSkill('Mining')?.baseLevel ?? 1;

    if (currentXp >= TARGET_MINING_XP || currentLvl >= 99) {
        console.log(`\n🎉🎉 LEVEL 99 REACHED! (${currentXp.toLocaleString()} XP) 🎉🎉`);
        break;
    }

    // Drop any iron ore in inventory immediately
    for (const item of sdk.getInventory()) {
        if (IRON_ORE.test(item.name)) {
            await sdk.sendDropItem(item.slot);
        }
    }

    // Find iron rock nearby
    const rock = (sdk.getNearbyLocs() ?? [])
        .filter((l) => /rocks?/i.test(l.name) && l.optionsWithIndex?.some((o) => /^mine$/i.test(o.text)))
        .sort((a, b) => (a.distance ?? 99) - (b.distance ?? 99))[0];

    if (rock) {
        const xpBefore = sdk.getSkill('Mining')?.experience ?? 0;
        await bot.interactLoc(rock, /mine/i);
        await sdk
            .waitForCondition((s) => {
                const xp = s.skills.find((sk) => sk.name === 'Mining')?.experience ?? 0;
                return xp > xpBefore || s.inventory.some((i) => IRON_ORE.test(i.name));
            }, 3_500)
            .catch(() => {});

        const xpAfter = sdk.getSkill('Mining')?.experience ?? 0;
        if (xpAfter > xpBefore) {
            minedOres++;
            const xpNeeded = Math.max(0, TARGET_MINING_XP - xpAfter);
            console.log(
                `[mine] #${minedOres} +${xpAfter - xpBefore} XP | Total Mining XP: ${xpAfter.toLocaleString()} | Remaining to 99: ${xpNeeded.toLocaleString()} XP`
            );
        }
    } else {
        await sdk.waitForTicks(1);
    }
}

// 5. SYNCHRONIZED CELEBRATION CHAT & EMOTES!
console.log('\n🎉 Triggering synchronized fleet celebration chat & emotes! 🎉');

// JackThief announcement & cheer emote
await Promise.all([
    jackthiefClient.sdk.say('flash1:wave:99 MINING! I AM OFFICIALLY FULLY MAXED!!!'),
    jackthiefClient.sdk.sendClickComponent(EMOTE_CHEER)
]);

const EMOTE_ROTATION = [EMOTE_CHEER, EMOTE_DANCE, EMOTE_WAVE, EMOTE_CLAP, EMOTE_BOW, EMOTE_LAUGH];

// Fleet bots synchronized congratulations with animated colors & emotes
await Promise.all(
    fleetClients.filter(c => c.sdk.isConnected()).map(async (client, idx) => {
        const effect = CELEBRATION_EFFECTS[idx % CELEBRATION_EFFECTS.length];
        const msg = CELEBRATION_MESSAGES[idx % CELEBRATION_MESSAGES.length];
        const emote = EMOTE_ROTATION[idx % EMOTE_ROTATION.length];
        await client.sdk.sendClickComponent(emote).catch(() => {});
        await client.sdk.say(`${effect}${msg}`).catch(() => {});
    })
);

console.log('Celebration chat & emotes dispatched! Holding animated celebration for screenshots...');
for (let wave = 0; wave < 15; wave++) {
    await sdk.waitForTicks(8).catch(() => {});
    // Continuous lively animated emotes & cheer waves
    await Promise.all(
        fleetClients.filter(c => c.sdk.isConnected()).map(async (c, i) => {
            const nextEmote = EMOTE_ROTATION[(i + wave + 1) % EMOTE_ROTATION.length];
            const nextEffect = CELEBRATION_EFFECTS[(i + wave * 2 + 1) % CELEBRATION_EFFECTS.length];
            const nextMsg = CELEBRATION_MESSAGES[(i + wave * 3 + 1) % CELEBRATION_MESSAGES.length];
            await c.sdk.sendClickComponent(nextEmote).catch(() => {});
            await c.sdk.say(`${nextEffect}${nextMsg}`).catch(() => {});
        })
    );
    await jackthiefClient.sdk.sendClickComponent(wave % 2 === 0 ? EMOTE_DANCE : EMOTE_CHEER).catch(() => {});
}

console.log('=== Event Complete! Congratulations on Max JackThief! ===');
