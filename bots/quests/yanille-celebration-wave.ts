/**
 * Yanille Bank Celebration: All assembled bots shout congratulations and perform emotes!
 *
 * Usage:
 *   bun bots/quests/yanille-celebration-wave.ts
 */
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { BotSDK, deriveGatewayUrl } from '../../sdk/index';

const EMOTE_CHEER = 171;
const EMOTE_DANCE = 166;
const EMOTE_WAVE = 163;
const EMOTE_CLAP = 172;
const EMOTE_BOW = 164;
const EMOTE_LAUGH = 170;

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

async function createBotSdk(name: string): Promise<{ name: string; sdk: BotSDK } | null> {
    try {
        const creds = loadBotCredentials(name);
        const sdk = new BotSDK({
            botUsername: creds.username,
            password: creds.password,
            server: creds.server,
            gatewayUrl: deriveGatewayUrl(creds.server),
            autoLaunchBrowser: false,
            connectTimeout: 20_000,
            readyTimeout: 15_000,
            showChat: false
        });
        await sdk.connect();
        return { name, sdk };
    } catch {
        return null;
    }
}

console.log('=== Triggering Yanille Bank Celebration Waves! ===');

const rosterJson = JSON.parse(readFileSync(join(process.cwd(), 'bots', 'roster.json'), 'utf-8'));
const allBotNames: string[] = rosterJson.bots.map((b: any) => b.name);

const BATCH_SIZE = 10;
const clients: { name: string; sdk: BotSDK }[] = [];

for (let i = 0; i < allBotNames.length; i += BATCH_SIZE) {
    const batch = allBotNames.slice(i, i + BATCH_SIZE);
    const connected = await Promise.all(batch.map((n) => createBotSdk(n)));
    for (const c of connected) {
        if (c) clients.push(c);
    }
}

console.log(`Connected ${clients.length} bots for celebration chat & emotes!`);

const EMOTE_ROTATION = [EMOTE_CHEER, EMOTE_DANCE, EMOTE_WAVE, EMOTE_CLAP, EMOTE_BOW, EMOTE_LAUGH];

// JackThief hero shout
const jt = clients.find((c) => c.name.toLowerCase() === 'jackthief');
if (jt) {
    await jt.sdk.say('flash1:wave:99 MINING! I AM OFFICIALLY FULLY MAXED!!!').catch(() => {});
    await jt.sdk.sendClickComponent(EMOTE_CHEER).catch(() => {});
}

// Fleet shout wave 1
await Promise.all(
    clients.filter((c) => c.name.toLowerCase() !== 'jackthief').map(async (client, idx) => {
        const effect = CELEBRATION_EFFECTS[idx % CELEBRATION_EFFECTS.length];
        const msg = CELEBRATION_MESSAGES[idx % CELEBRATION_MESSAGES.length];
        const emote = EMOTE_ROTATION[idx % EMOTE_ROTATION.length];
        await client.sdk.sendClickComponent(emote).catch(() => {});
        await client.sdk.say(`${effect}${msg}`).catch(() => {});
    })
);

console.log('Wave 1 sent! Looping celebratory emote waves...');

for (let wave = 1; wave <= 6; wave++) {
    await new Promise((r) => setTimeout(r, 4500));
    await Promise.all(
        clients.map(async (c, i) => {
            const nextEmote = EMOTE_ROTATION[(i + wave) % EMOTE_ROTATION.length];
            const nextEffect = CELEBRATION_EFFECTS[(i + wave * 2) % CELEBRATION_EFFECTS.length];
            const nextMsg = CELEBRATION_MESSAGES[(i + wave * 3) % CELEBRATION_MESSAGES.length];
            await c.sdk.sendClickComponent(nextEmote).catch(() => {});
            if (c.name.toLowerCase() !== 'jackthief') {
                await c.sdk.say(`${nextEffect}${nextMsg}`).catch(() => {});
            } else {
                await c.sdk.say('flash2:wave:FULL MAX COMPLETE! THANK YOU EVERYONE!').catch(() => {});
            }
        })
    );
}

console.log('Celebration waves complete!');
