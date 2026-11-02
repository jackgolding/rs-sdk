/**
 * A replacement dragonfire shield from Duke Horacio, Lumbridge castle first floor.
 *
 * duke_horacio.rs2 offers "I seek a shield that will protect me from the dragon's breath."
 * when Dragon Slayer is complete (or the shield step is known) and no shield is held or worn.
 * The bank is not checked, so a finished account can always replace one lost on a death,
 * and a death respawns in Lumbridge, next door to him.
 */
import type { BotSDK } from '../../sdk/index';
import type { BotActions } from '../../sdk/actions';
import { walkNear } from './movement';

const CASTLE_STAIRS = { x: 3205, z: 3209 };
const DUKE = { x: 3210, z: 3221 };
const SHIELD = /dragonfire shield|anti-?dragon/i;

type Log = (msg: string) => void;

function level(sdk: BotSDK): number {
    return sdk.getState()?.player?.level ?? 0;
}

function holding(sdk: BotSDK): boolean {
    return !!sdk.findInventoryItem(SHIELD) || !!sdk.findEquipmentItem(SHIELD);
}

async function climb(bot: BotActions, sdk: BotSDK, up: boolean): Promise<boolean> {
    const want = up ? 1 : 0;
    for (let i = 0; i < 4 && level(sdk) !== want; i++) {
        await sdk.scanNearbyLocs(8).catch(() => undefined);
        const op = up ? /^climb-up$/i : /^climb-down$/i;
        const stairs = (sdk.getNearbyLocs() ?? [])
            .filter((l) => /stair/i.test(l.name) && l.optionsWithIndex.some((o) => op.test(o.text)))
            .sort((a, b) => (a.distance ?? 99) - (b.distance ?? 99))[0];
        if (!stairs) return false;
        await bot.interactLoc(stairs, op).catch(() => undefined);
        await sdk.waitForCondition((s) => (s.player?.level ?? 0) === want, 8_000).catch(() => undefined);
    }
    return level(sdk) === want;
}

/** True when a shield is held afterwards. Safe to call when one is already held. */
export async function fetchDukeShield(bot: BotActions, sdk: BotSDK, log: Log): Promise<boolean> {
    if (holding(sdk)) return true;
    log('No dragonfire shield held — asking Duke Horacio for one');
    if (level(sdk) === 0) {
        await walkNear(bot, sdk, CASTLE_STAIRS.x, CASTLE_STAIRS.z, 2);
        if (!(await climb(bot, sdk, true))) {
            log('Duke shield: could not climb the castle stairs');
            return false;
        }
    }
    // Up to three asks: the Duke wanders his room, and a walk that stops short or a talk that
    // never opens gave "none given" to a Dragon Slayer finisher (ABGARMY17, twice on 2026-11-02).
    const seen: string[] = [];
    for (let attempt = 1; attempt <= 3 && !holding(sdk); attempt++) {
        await bot.walkTo(DUKE.x, DUKE.z, 2).catch(() => undefined);
        const duke = sdk.findNearbyNpc(/^duke horacio$/i);
        if (!duke) {
            seen.push(`#${attempt} no Duke in view at ${sdk.getState()?.player?.worldX},${sdk.getState()?.player?.worldZ} L${level(sdk)}`);
            await sdk.waitForTicks(5).catch(() => undefined);
            continue;
        }
        await bot.talkTo(duke).catch(() => undefined);
        let declined = false;
        for (let i = 0; i < 16 && !holding(sdk); i++) {
            const d = sdk.getDialog();
            if (d?.isOpen && !d.isWaiting) {
                const ask = d.options.find((o) => /seek a shield/i.test(o.text));
                if (!ask && d.options.length > 1) {
                    seen.push(`#${attempt} options: ${d.options.map((o) => o.text).join(' / ')}`);
                    declined = true;
                    break;
                }
                await sdk.sendClickDialog(ask?.index ?? d.options[0]?.index ?? 0);
            }
            await sdk.waitForTicks(1).catch(() => undefined);
        }
        await bot.dismissBlockingUI().catch(() => undefined);
        if (declined) break; // no shield on offer (Dragon Slayer not done)
        if (!holding(sdk)) seen.push(`#${attempt} talked, no shield`);
    }
    if (seen.length) log(`Duke shield: ${seen.join(' | ')}`);
    const got = holding(sdk);
    log(got ? 'Duke Horacio handed over a dragonfire shield' : 'Duke shield: none given (Dragon Slayer not complete?)');
    if (level(sdk) === 1) {
        await bot.walkTo(CASTLE_STAIRS.x, CASTLE_STAIRS.z + 1, 2).catch(() => undefined);
        await climb(bot, sdk, false);
    }
    return got;
}
