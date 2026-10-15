/**
 * Walk every roster bot except jackthief to Yanille Bank (2613, 3094).
 * Bots already in Yanille skip walking and immediately accept incoming trades.
 *
 * Usage:
 *   bun bots/quests/converge-and-accept-trade.ts
 */
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { BotSDK, deriveGatewayUrl } from '../../sdk/index';
import { BotActions } from '../../sdk/actions';
import { initPathfinding } from '../../sdk/pathfinding';
import { playerPos, closeUi, distTo, walkNear } from './movement';
import { type Tile, PORT_SARIM_DOCK, LUMBRIDGE_MEN, BRIMHAVEN_CUSTOMS } from './tiles';

const TARGET_TILE: Tile = { x: 2613, z: 3094 }; // Yanille Bank stack tile
const YANILLE_RADIUS = 12;

const CATHERBY_WAYPOINTS: Tile[] = [
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
    { x: 2626, z: 3149 },
    { x: 2615, z: 3110 },
    TARGET_TILE
];

const SOUTH_WAYPOINTS: Tile[] = [
    { x: 2662, z: 3312 },
    { x: 2655, z: 3283 },
    { x: 2640, z: 3220 },
    { x: 2630, z: 3170 },
    { x: 2626, z: 3149 },
    { x: 2615, z: 3110 },
    TARGET_TILE
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

async function createBotClient(name: string): Promise<BotClient | null> {
    try {
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
    } catch (err: any) {
        console.warn(`[connect] Could not connect ${name}: ${err?.message ?? err}`);
        return null;
    }
}

function nearestWaypointIdx(waypoints: Tile[], x: number, z: number): number {
    let idx = 0;
    let best = Infinity;
    for (let i = 0; i < waypoints.length; i++) {
        const d = Math.hypot(waypoints[i].x - x, waypoints[i].z - z);
        if (d < best) {
            best = d;
            idx = i;
        }
    }
    return idx;
}

async function dismissLevelUps(bot: BotActions, sdk: BotSDK): Promise<void> {
    for (let i = 0; i < 10; i++) {
        await bot.dismissBlockingUI();
        const dialog = sdk.getDialog();
        if (!dialog?.isOpen) return;
        await sdk.clickDialogByText(/click here to continue/i).catch(() => sdk.sendClickDialog(0));
        await sdk.waitForTicks(1).catch(() => {});
    }
}

async function openDoor(sdk: BotSDK): Promise<void> {
    const door = (sdk.getNearbyLocs() ?? []).find(
        (l) => /door|gate/i.test(l.name) && (l.distance ?? 99) <= 3 && l.optionsWithIndex?.some((o) => /^open$/i.test(o.text))
    );
    if (!door) return;
    const open = door.optionsWithIndex?.find((o) => /^open$/i.test(o.text));
    if (!open) return;
    await Promise.race([
        sdk.sendInteractLoc(door.x, door.z, door.id, open.opIndex),
        Bun.sleep(1500)
    ]).catch(() => {});
    await sdk.waitForTicks(1).catch(() => {});
}

const PORT_SARIM_BOAT_GP = 30;
const BRIMHAVEN_BOAT_GP = 30;
const KARAMJA_MEN: Tile = { x: 2889, z: 3173 };
const MUSA_TO_BRIMHAVEN: Tile[] = [
    { x: 2864, z: 3154 },
    { x: 2812, z: 3176 },
    { x: 2772, z: 3225 }
];

function coins(sdk: BotSDK): number {
    return sdk.findInventoryItem(/^coins$/i)?.count ?? 0;
}

function inArdougne(sdk: BotSDK): boolean {
    const p = playerPos(sdk);
    return p.x < 2750 && p.x > 2500 && p.z > 3240 && p.z < 3355;
}

function onKaramja(sdk: BotSDK): boolean {
    const p = playerPos(sdk);
    return p.x > 2680 && p.x < 3010 && p.z > 3040 && p.z < 3270;
}

function onMusa(sdk: BotSDK): boolean {
    return onKaramja(sdk) && playerPos(sdk).x >= 2815;
}

function onDockedShip(sdk: BotSDK): boolean {
    if (inArdougne(sdk)) return false;
    const p = playerPos(sdk);
    if (p.level >= 1 && p.x >= 2948 && p.x <= 2962 && p.z >= 3138 && p.z <= 3148) return true;
    if (p.level < 1) return false;
    const locs = sdk.getNearbyLocs() ?? [];
    return locs.some((l) => /gangplank|ship's (ladder|wheel)|anchor/i.test(l.name));
}

async function clickBoatDialog(sdk: BotSDK): Promise<void> {
    for (let i = 0; i < 24; i++) {
        const dialog = sdk.getDialog();
        if (!dialog?.isOpen) {
            await Bun.sleep(250);
            if (!sdk.getDialog()?.isOpen) return;
            continue;
        }
        if (dialog.isWaiting) {
            await sdk.waitForTicks(1).catch(() => {});
            continue;
        }
        const opts = dialog.options ?? [];
        const pick =
            opts.find((o) => /search away|nothing to hide/i.test(o.text)) ||
            opts.find((o) => /can i journey|journey on this ship/i.test(o.text)) ||
            opts.find((o) => /yes please/i.test(o.text)) ||
            opts.find((o) => /pay (the )?(fare|30)|30 coins|30 gp/i.test(o.text)) ||
            opts.find((o) => /ardougne/i.test(o.text) && !/unusual|customs then/i.test(o.text)) ||
            opts.find((o) => /^ok\.?$/i.test(o.text)) ||
            opts.find((o) => /journey|ship/i.test(o.text) && !/customs|unusual/i.test(o.text)) ||
            opts.find((o) => /yes/i.test(o.text) && !/crandor|bother|miss/i.test(o.text));
        await sdk.sendClickDialog(pick?.index ?? 0);
        await sdk.waitForTicks(1).catch(() => {});
    }
}

async function crossGangplank(bot: BotActions, sdk: BotSDK): Promise<void> {
    const plank = sdk.findNearbyLoc(/gangplank/i);
    if (!plank) return;
    const opt = plank.optionsWithIndex?.find((o) => /cross|board/i.test(o.text));
    if (opt) await sdk.sendInteractLoc(plank.x, plank.z, plank.id, opt.opIndex);
    else await bot.interactLoc(plank, /cross|board/i);
    await sdk.waitForTicks(5).catch(() => {});
}

async function leaveDockedShip(bot: BotActions, sdk: BotSDK): Promise<void> {
    if (!onDockedShip(sdk)) return;
    for (let i = 0; i < 8 && onDockedShip(sdk); i++) {
        if (!sdk.findNearbyLoc(/gangplank/i)) await sdk.scanNearbyLocs(16).catch(() => {});
        await crossGangplank(bot, sdk);
        await sdk.waitForTicks(2).catch(() => {});
    }
}

async function pickpocketNearbyMen(
    bot: BotActions,
    sdk: BotSDK,
    name: string,
    need: number,
    walkTile: Tile
): Promise<void> {
    const deadline = Date.now() + 300_000;
    while (coins(sdk) < need && Date.now() < deadline && sdk.isConnected()) {
        await bot.dismissBlockingUI();
        let npc =
            sdk.findNearbyNpc(/^man$/i, { reachable: true }) ??
            sdk.findNearbyNpc(/^woman$/i, { reachable: true }) ??
            sdk.findNearbyNpc(/^(man|woman)$/i);
        if (!npc) {
            if (distTo(sdk, walkTile.x, walkTile.z) > 8) {
                console.log(`[thieve] ${name} walking to men @ ${walkTile.x},${walkTile.z}`);
                await walkNear(bot, sdk, walkTile.x, walkTile.z, 4);
            }
            npc =
                sdk.findNearbyNpc(/^man$/i, { reachable: true }) ??
                sdk.findNearbyNpc(/^woman$/i, { reachable: true }) ??
                sdk.findNearbyNpc(/^(man|woman)$/i);
        }
        if (!npc) {
            await sdk.waitForTicks(3).catch(() => {});
            continue;
        }
        console.log(`[thieve] ${name} pickpocket ${npc.name} (${coins(sdk)}/${need} gp)`);
        const result = await bot.pickpocketNpc(npc);
        if (result.reason === 'stunned') await sdk.waitForTicks(6).catch(() => {});
    }
}

async function walkToPortSarimDock(bot: BotActions, sdk: BotSDK, name: string): Promise<void> {
    let p = playerPos(sdk);
    if (distTo(sdk, PORT_SARIM_DOCK.x, PORT_SARIM_DOCK.z) <= 6) return;

    const hops: Tile[] =
        p.z >= 3330
            ? [
                  { x: 2965, z: 3340 },
                  { x: 2998, z: 3312 },
                  { x: 3015, z: 3272 },
                  { x: 3029, z: 3236 },
                  { x: 3029, z: 3217 }
              ]
            : [
                  { x: 3046, z: 3235 },
                  { x: 3029, z: 3217 }
              ];

    const startIdx = nearestWaypointIdx(hops, p.x, p.z);
    for (let i = startIdx; i < hops.length; i++) {
        const wp = hops[i];
        p = playerPos(sdk);
        if (p.x < 2880 || distTo(sdk, PORT_SARIM_DOCK.x, PORT_SARIM_DOCK.z) <= 6) return;
        if (distTo(sdk, wp.x, wp.z) <= 5) continue;
        console.log(`[dock-hop] ${name} ${p.x},${p.z} → ${wp.x},${wp.z}`);
        await hopToward(sdk, wp.x, wp.z, 40_000);
        if (distTo(sdk, wp.x, wp.z) > 8) {
            await Promise.race([bot.walkTo(wp.x, wp.z, 4), Bun.sleep(20_000)]).catch(() => {});
        }
        if (distTo(sdk, wp.x, wp.z) > 8) await walkNear(bot, sdk, wp.x, wp.z, 4);
    }
    await walkNear(bot, sdk, PORT_SARIM_DOCK.x, PORT_SARIM_DOCK.z, 3);
}

async function portSarimToMusa(bot: BotActions, sdk: BotSDK, name: string): Promise<void> {
    if (onKaramja(sdk) || inArdougne(sdk)) return;
    console.log(`[boat] ${name} Port Sarim → Musa Point (${coins(sdk)} gp)`);
    await walkNear(bot, sdk, PORT_SARIM_DOCK.x, PORT_SARIM_DOCK.z, 4);
    await dismissLevelUps(bot, sdk);
    const sailor =
        sdk.findNearbyNpc(/^captain tobias$/i) ??
        sdk.findNearbyNpc(/^seaman /i) ??
        sdk.findNearbyNpc(/sailor|seaman|captain tobias/i);
    if (!sailor) {
        console.warn(`[boat] ${name} no sailor at Port Sarim`);
        return;
    }
    const startX = playerPos(sdk).x;
    await bot.talkTo(sailor);
    await clickBoatDialog(sdk);
    for (let i = 0; i < 40 && !onKaramja(sdk); i++) {
        await crossGangplank(bot, sdk);
        if (sdk.getDialog()?.isOpen) await clickBoatDialog(sdk);
        if (Math.abs(playerPos(sdk).x - startX) > 40) break;
        await sdk.waitForTicks(2).catch(() => {});
    }
    await leaveDockedShip(bot, sdk);
    console.log(`[boat] ${name} after Musa boat: ${playerPos(sdk).x},${playerPos(sdk).z} gp=${coins(sdk)}`);
}

async function musaToBrimhaven(bot: BotActions, sdk: BotSDK, name: string): Promise<void> {
    await leaveDockedShip(bot, sdk);
    if (!onMusa(sdk)) return;
    console.log(`[walk] ${name} Musa Point → Brimhaven customs`);
    for (const wp of MUSA_TO_BRIMHAVEN) {
        if (!onMusa(sdk)) break;
        await walkNear(bot, sdk, wp.x, wp.z, 8);
    }
    await walkNear(bot, sdk, BRIMHAVEN_CUSTOMS.x, BRIMHAVEN_CUSTOMS.z, 5);
}

async function brimhavenToArdougne(bot: BotActions, sdk: BotSDK, name: string): Promise<void> {
    if (inArdougne(sdk)) return;
    if (!onKaramja(sdk) || onMusa(sdk)) return;
    await leaveDockedShip(bot, sdk);
    console.log(`[boat] ${name} Brimhaven → Ardougne (${coins(sdk)} gp)`);
    for (const wp of [
        { x: 2810, z: 3154 },
        { x: 2786, z: 3158 },
        { x: 2768, z: 3188 },
        { x: 2772, z: 3225 }
    ]) {
        if (inArdougne(sdk) || distTo(sdk, BRIMHAVEN_CUSTOMS.x, BRIMHAVEN_CUSTOMS.z) <= 6) break;
        await walkNear(bot, sdk, wp.x, wp.z, 6);
    }
    await walkNear(bot, sdk, BRIMHAVEN_CUSTOMS.x, BRIMHAVEN_CUSTOMS.z, 4);
    const customs = sdk.findNearbyNpc(/^customs officer$/i) ?? sdk.findNearbyNpc(/customs officer/i);
    if (!customs) {
        console.warn(`[boat] ${name} no customs officer at Brimhaven`);
        return;
    }
    await bot.talkTo(customs);
    await clickBoatDialog(sdk);
    for (let i = 0; i < 20 && !inArdougne(sdk); i++) {
        if (sdk.getDialog()?.isOpen) await clickBoatDialog(sdk);
        else if (onDockedShip(sdk)) await leaveDockedShip(bot, sdk);
        await sdk.waitForTicks(2).catch(() => {});
    }
    console.log(`[boat] ${name} Ardougne arrival ${playerPos(sdk).x},${playerPos(sdk).z} gp=${coins(sdk)}`);
}

async function asgarniaToKandarin(bot: BotActions, sdk: BotSDK, name: string): Promise<void> {
    let p = playerPos(sdk);
    if (p.x < 2880) return;

    await leaveBuildings(bot, sdk);
    console.log(`[route] ${name} Asgarnia → Kandarin via Karamja boats (gp=${coins(sdk)})`);

    const deadline = Date.now() + 600_000;
    while (Date.now() < deadline && sdk.isConnected() && !inArdougne(sdk)) {
        await dismissLevelUps(bot, sdk);
        p = playerPos(sdk);
        if (inArdougne(sdk)) break;

        if (onMusa(sdk)) {
            await musaToBrimhaven(bot, sdk, name);
            continue;
        }

        if (onKaramja(sdk)) {
            if (coins(sdk) < BRIMHAVEN_BOAT_GP) {
                await pickpocketNearbyMen(bot, sdk, name, BRIMHAVEN_BOAT_GP, KARAMJA_MEN);
                continue;
            }
            await brimhavenToArdougne(bot, sdk, name);
            continue;
        }

        if (p.x >= 2880) {
            await walkToPortSarimDock(bot, sdk, name);
            if (coins(sdk) < PORT_SARIM_BOAT_GP) {
                console.log(`[thieve] ${name} need ${PORT_SARIM_BOAT_GP}gp for Karamja boat`);
                await pickpocketNearbyMen(bot, sdk, name, PORT_SARIM_BOAT_GP, LUMBRIDGE_MEN);
                continue;
            }
            await portSarimToMusa(bot, sdk, name);
            continue;
        }

        await sdk.waitForTicks(2).catch(() => {});
    }

    p = playerPos(sdk);
    console.log(`[route] ${name} Kandarin leg done @ ${p.x},${p.z} gp=${coins(sdk)}`);
}

async function hopToward(sdk: BotSDK, x: number, z: number, maxMs = 25_000): Promise<void> {
    const deadline = Date.now() + maxMs;
    while (distTo(sdk, x, z) > 3 && Date.now() < deadline && sdk.isConnected()) {
        await openDoor(sdk);
        const p = playerPos(sdk);
        const dx = x - p.x;
        const dz = z - p.z;
        const dist = Math.hypot(dx, dz) || 1;
        const step = Math.min(8, dist);
        const nx = Math.round(p.x + (dx / dist) * step);
        const nz = Math.round(p.z + (dz / dist) * step);
        void sdk.sendWalk(nx, nz, true).catch(() => {});
        await Bun.sleep(550);
    }
}

async function leaveBuildings(bot: BotActions, sdk: BotSDK): Promise<void> {
    const p0 = playerPos(sdk);
    // Catherby range house — exit west to the road (south door is often blocked).
    if (p0.x >= 2814 && p0.x <= 2821 && p0.z >= 3440 && p0.z <= 3450) {
        console.log(`[leave] range ${p0.x},${p0.z}`);
        await openDoor(sdk);
        const door = sdk.findNearbyLoc(/^door$/i, { withOption: /^open$/i });
        if (door && (door.distance ?? 99) <= 6) await bot.openDoor(door);
        await sdk.sendWalk(2808, 3441, true);
        await sdk.waitForTicks(6).catch(() => {});
        await openDoor(sdk);
        await hopToward(sdk, 2804, 3441, 15_000);
        if (distTo(sdk, 2804, 3441) > 8) await walkNear(bot, sdk, 2804, 3441, 4);
    }
    const p1 = playerPos(sdk);
    // Catherby range / pier — herd onto the west road toward Seers.
    if (p1.x >= 2795 && p1.x <= 2825 && p1.z >= 3435 && p1.z <= 3450) {
        console.log(`[leave] catherby ${p1.x},${p1.z}`);
        const door = sdk.findNearbyLoc(/^door$/i, { withOption: /^open$/i });
        if (door && (door.distance ?? 99) <= 6) await bot.openDoor(door);
        await hopToward(sdk, 2790, 3445, 20_000);
        await hopToward(sdk, 2788, 3460, 30_000);
    }
    const p2 = playerPos(sdk);
    if (p2.x >= 2942 && p2.x <= 2950 && p2.z >= 3366 && p2.z <= 3372) {
        console.log(`[leave] falador-bank ${p2.x},${p2.z}`);
        const door = sdk.findNearbyLoc(/^door$/i, { withOption: /^open$/i });
        if (door && (door.distance ?? 99) <= 6) await bot.openDoor(door);
        await hopToward(sdk, 2949, 3368, 8_000);
        await hopToward(sdk, 2955, 3368, 8_000);
        await hopToward(sdk, 2965, 3341, 12_000);
        if (distTo(sdk, 2965, 3341) > 8) {
            await walkNear(bot, sdk, 2965, 3341, 4);
        }
    }
}

async function boatFromAsgarnia(bot: BotActions, sdk: BotSDK, name: string): Promise<void> {
    await asgarniaToKandarin(bot, sdk, name);
}

async function follow(bot: BotActions, sdk: BotSDK, name: string, waypoints: Tile[]): Promise<void> {
    let startIdx = 0;
    let closest = Infinity;
    for (let i = 0; i < waypoints.length; i++) {
        const d = distTo(sdk, waypoints[i].x, waypoints[i].z);
        if (d < closest) {
            closest = d;
            startIdx = i;
        }
    }
    for (let i = startIdx; i < waypoints.length; i++) {
        if (!sdk.isConnected()) return;
        if (distTo(sdk, TARGET_TILE.x, TARGET_TILE.z) <= YANILLE_RADIUS) return;
        const p0 = playerPos(sdk);
        if (p0.x >= 2880) {
            await boatFromAsgarnia(bot, sdk, name);
            return;
        }
        const wp = waypoints[i];
        while (distTo(sdk, wp.x, wp.z) > 6 && sdk.isConnected()) {
            if (distTo(sdk, TARGET_TILE.x, TARGET_TILE.z) <= YANILLE_RADIUS) return;
            if (playerPos(sdk).x >= 2880) {
                await boatFromAsgarnia(bot, sdk, name);
                return;
            }
            const p = playerPos(sdk);
            console.log(`[wp] ${name} ${p.x},${p.z} → ${wp.x},${wp.z}`);
            await hopToward(sdk, wp.x, wp.z, 30_000);
            if (distTo(sdk, wp.x, wp.z) > 8) {
                await Promise.race([bot.walkTo(wp.x, wp.z, 4), Bun.sleep(18_000)]).catch(() => {});
            }
            if (distTo(sdk, wp.x, wp.z) > 12) {
                const stuck = playerPos(sdk);
                if (stuck.x === p.x && stuck.z === p.z) {
                    await openDoor(sdk);
                    await leaveBuildings(bot, sdk);
                }
            }
        }
    }
}

async function walkToStack(client: BotClient): Promise<void> {
    const { bot, sdk, name } = client;
    try {
        if (!sdk.isConnected()) return;
        await bot.dismissBlockingUI();
        await closeUi(bot, sdk);
        await leaveBuildings(bot, sdk);

        let p = playerPos(sdk);
        if (distTo(sdk, TARGET_TILE.x, TARGET_TILE.z) <= YANILLE_RADIUS) {
            console.log(`[stack] ${name} already in Yanille (${p.x}, ${p.z}) — accept loop`);
            return;
        }

        console.log(`[move] ${name} (${p.x}, ${p.z}) -> Yanille Bank`);
        if (p.x >= 2880) await boatFromAsgarnia(bot, sdk, name);

        p = playerPos(sdk);
        if (distTo(sdk, TARGET_TILE.x, TARGET_TILE.z) <= YANILLE_RADIUS) return;

        if (p.x >= 2680 && p.z >= 3350 && p.x < 2880) {
            await follow(bot, sdk, name, CATHERBY_WAYPOINTS);
        } else if (p.x < 2880) {
            await follow(bot, sdk, name, SOUTH_WAYPOINTS);
        } else {
            await boatFromAsgarnia(bot, sdk, name);
        }

        p = playerPos(sdk);
        if (p.x >= 2880) await boatFromAsgarnia(bot, sdk, name);
        p = playerPos(sdk);
        if (p.x < 2880 && distTo(sdk, TARGET_TILE.x, TARGET_TILE.z) > YANILLE_RADIUS) {
            await follow(bot, sdk, name, SOUTH_WAYPOINTS);
        }

        const finalPos = playerPos(sdk);
        if (distTo(sdk, TARGET_TILE.x, TARGET_TILE.z) <= YANILLE_RADIUS) {
            console.log(`[stack-arrived] ${name} at (${finalPos.x}, ${finalPos.z})`);
        } else {
            console.warn(`[not-yet] ${name} still ${finalPos.x},${finalPos.z}`);
        }
    } catch (err: any) {
        console.warn(`[walk-err] ${name}: ${err?.message ?? err}`);
    }
}

async function serveTradesLoop(client: BotClient): Promise<void> {
    const { bot, sdk, name } = client;
    if (!sdk.isConnected()) {
        console.warn(`[trade-skip] ${name} disconnected — not serving`);
        return;
    }
    console.log(`[trade-server] ${name} accepting any incoming trades`);
    while (sdk.isConnected()) {
        try {
            await bot.dismissBlockingUI();
            await bot.serveTrades({
                timeout: 3600_000,
                tradeTimeout: 45_000,
                onTrade: (res) => {
                    if (res.success) {
                        const rec = (res.data?.received ?? []).map((i) => `${i.name} x${i.count}`).join(', ');
                        console.log(`[trade-accepted] ${name} from ${res.partner ?? '?'} [${rec || 'none'}]`);
                    }
                }
            });
        } catch {
            if (!sdk.isConnected()) break;
            await sdk.waitForTicks(2).catch(() => {});
        }
    }
}

async function runBotSession(client: BotClient): Promise<void> {
    if (ACCEPT_ONLY) {
        const p = playerPos(client.sdk);
        if (distTo(client.sdk, TARGET_TILE.x, TARGET_TILE.z) <= YANILLE_RADIUS) {
            console.log(`[stack] ${client.name} Yanille (${p.x},${p.z}) — accept loop`);
            await serveTradesLoop(client);
        } else {
            console.log(`[skip] ${client.name} not in Yanille (${p.x},${p.z}) — disconnect`);
            await client.sdk.disconnect().catch(() => {});
        }
        return;
    }
    for (let n = 0; n < 8 && client.sdk.isConnected(); n++) {
        if (distTo(client.sdk, TARGET_TILE.x, TARGET_TILE.z) <= YANILLE_RADIUS) break;
        await walkToStack(client);
    }
    if (distTo(client.sdk, TARGET_TILE.x, TARGET_TILE.z) <= YANILLE_RADIUS) {
        await serveTradesLoop(client);
    } else {
        console.warn(`[no-trade] ${client.name} not in Yanille — keep walking`);
        while (client.sdk.isConnected() && distTo(client.sdk, TARGET_TILE.x, TARGET_TILE.z) > YANILLE_RADIUS) {
            await walkToStack(client);
        }
        if (client.sdk.isConnected()) await serveTradesLoop(client);
    }
}

function flagList(flag: string): string[] {
    const idx = process.argv.indexOf(flag);
    if (idx === -1) return [];
    const out: string[] = [];
    for (let i = idx + 1; i < process.argv.length; i++) {
        const a = process.argv[i];
        if (a.startsWith('--')) break;
        out.push(a);
    }
    return out;
}

console.log('=== Starting Yanille Bank Convergence & Trade Server ===');
initPathfinding();

const ACCEPT_ONLY = process.argv.includes('--accept-only');
const EXCEPT = flagList('--except');
const ONLY = process.argv
    .slice(2)
    .filter((a) => !a.startsWith('-') && !EXCEPT.includes(a));

const rosterJson = JSON.parse(readFileSync(join(process.cwd(), 'bots', 'roster.json'), 'utf-8'));
let fleetBotNames: string[] = rosterJson.bots
    .map((b: any) => b.name)
    .filter((name: string) => name.toLowerCase() !== 'jackthief');

if (EXCEPT.length) {
    const ex = new Set(EXCEPT.map((n) => n.toLowerCase()));
    fleetBotNames = fleetBotNames.filter((n) => !ex.has(n.toLowerCase()));
}

if (ONLY.length) {
    const want = new Set(ONLY.map((n) => n.toLowerCase()));
    fleetBotNames = fleetBotNames.filter((n) => want.has(n.toLowerCase()));
}

if (ACCEPT_ONLY) {
    console.log(
        `Accept-only mode: ${fleetBotNames.length} bots (trade loop if already in Yanille${EXCEPT.length ? `, except ${EXCEPT.join(', ')}` : ''})`
    );
} else if (ONLY.length) {
    console.log(`Walk-only subset: ${fleetBotNames.join(', ')}`);
} else {
    console.log(`Connecting and routing all ${fleetBotNames.length} fleet accounts...`);
}

const BATCH_SIZE = 8;
const activeClients: BotClient[] = [];

for (let i = 0; i < fleetBotNames.length; i += BATCH_SIZE) {
    const batch = fleetBotNames.slice(i, i + BATCH_SIZE);
    const clients = await Promise.all(batch.map((name) => createBotClient(name)));
    const valid = clients.filter((c): c is BotClient => c !== null);
    activeClients.push(...valid);

    valid.forEach((client) => {
        runBotSession(client).catch(console.error);
    });

    await new Promise((r) => setTimeout(r, 400));
}

console.log(`\nActive: ${activeClients.length} bots (jackthief excluded). Yanille stack accepts trades; others walk then serve.`);

await new Promise(() => {});
