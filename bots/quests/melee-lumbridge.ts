/**
 * Melee from level 1 on the chickens in the Lumbridge coop — the safe, nearby
 * combat grind for a fresh low-combat account (jackquests) between quests.
 *
 *   bun bots/quests/melee-lumbridge.ts {botname} [--until=40]
 *
 * Trains Attack, Strength and Defence evenly: before each fight the combat style
 * switches to whichever of the three is lowest. It punches unless a melee weapon
 * is already in the pack (no bank trip). Chickens hit for at most 1, so at low HP
 * the bot steps back and waits to regenerate (no food on a fresh account).
 * Bones are buried for Prayer.
 *
 * Runs as todo-runner's `--then` grind: SIGTERM (a quest was queued) stops it
 * between fights. Reaching --until in all three idles instead of exiting, so a
 * container restart does not re-run a finished grind. Log: bots/<bot>/grind.log.
 */
import { join } from 'path';
import { ActivitySession } from '../../sdk/index';
import { installGracefulShutdown, runScript } from '../../sdk/runner';

const argv = process.argv.slice(2);
const BOT = argv.find((a) => !a.startsWith('-')) ?? process.env.BOT_USERNAME ?? '';
const UNTIL = Number(argv.find((a) => a.startsWith('--until='))?.split('=')[1] ?? 40);
const GRIND_LOG = join(process.cwd(), 'bots', BOT, 'grind.log');

/** Inside the Lumbridge chicken coop (cooks-assistant.ts, learnings/combat.md); fenced, walkTo opens the gate. */
const COOP = { x: 3230, z: 3297 };
const NEAR_COOP = 10;
const WEAPON = /(scimitar|longsword|sword|dagger|mace|battleaxe)$/i;
const SHIELD = /(sq shield|kiteshield|^wooden shield)$/i;
const CHICKEN = /^chicken$/i;
const BONES = /^bones$/i;
const REST_AT_HP = 4;
const RESUME_AT_HP = 9;

let shutdownRequested = false;
for (const sig of ['SIGTERM', 'SIGINT', 'SIGHUP'] as const) process.once(sig, () => (shutdownRequested = true));
let exitCode = 0;

await runScript(async ({ bot, sdk }) => {
    const session = new ActivitySession(sdk, bot, { name: 'melee-lumbridge', grindLogPath: GRIND_LOG, stallMs: 150_000, maxRecoveryTactics: 8 });
    installGracefulShutdown({ graceMs: 30_000 });
    const log = (msg: string) => session.log('log', msg);
    const lvl = (s: string) => sdk.getSkill(s)?.baseLevel ?? 1;
    const hp = () => sdk.getSkill('hitpoints')?.level ?? 10;
    const maxHp = () => sdk.getSkill('hitpoints')?.baseLevel ?? 10;
    const pos = () => ({ x: sdk.getState()?.player?.worldX ?? 0, z: sdk.getState()?.player?.worldZ ?? 0 });
    const away = () => Math.hypot(pos().x - COOP.x, pos().z - COOP.z);
    const stopping = () => shutdownRequested || session.stopRequested || session.isStopped();
    const melee = () => `Att ${lvl('attack')} Str ${lvl('strength')} Def ${lvl('defence')} HP ${hp()}/${maxHp()}`;
    const done = () => lvl('attack') >= UNTIL && lvl('strength') >= UNTIL && lvl('defence') >= UNTIL;

    /** Combat style on whichever of Attack/Strength/Defence is lowest. */
    async function balanceStyle(): Promise<void> {
        const cs = sdk.getState()?.combatStyle;
        if (!cs?.known) return;
        const want = lvl('attack') <= lvl('strength') && lvl('attack') <= lvl('defence') ? 'Attack' : lvl('strength') <= lvl('defence') ? 'Strength' : 'Defence';
        const style = cs.styles.find((s) => s.trainsSkills.length === 1 && s.trainsSkills.includes(want)) ?? cs.styles.find((s) => s.trainsSkills.includes(want));
        if (!style || cs.currentStyle === style.index) return;
        await sdk.sendSetCombatStyle(style.index);
        await sdk.waitForCondition((s) => s.combatStyle?.currentStyle === style.index, 3_000).catch(() => undefined);
        log(`style ${style.name} → ${want} (${melee()})`);
    }

    async function buryBones(): Promise<void> {
        for (let i = 0; i < 8; i++) {
            const bones = sdk.findInventoryItem(BONES);
            const bury = bones?.optionsWithIndex.find((o) => /bury/i.test(o.text));
            if (!bones || !bury) return;
            await sdk.sendUseItem(bones.slot, bury.opIndex);
            await sdk.waitForTicks(2);
        }
    }

    let kills = 0;
    try {
        await bot.skipTutorial();
        // A weapon or shield already in the pack (a fresh account's starter kit) is worn; otherwise fists.
        for (const item of [...sdk.getInventory()]) {
            if (WEAPON.test(item.name) || SHIELD.test(item.name)) await bot.equipItem(item).catch(() => undefined);
        }
        log(`start | ${melee()} (until ${UNTIL}) wearing ${sdk.getEquipment().map((e) => e.name).join(', ') || 'nothing — punching'} @ ${pos().x},${pos().z}`);

        while (!stopping() && !done()) {
            if (hp() <= REST_AT_HP) {
                await session.setPhase('rest');
                log(`resting at HP ${hp()}/${maxHp()}`);
                const target = Math.min(RESUME_AT_HP, maxHp());
                while (!stopping() && hp() < target) await sdk.waitForTicks(10);
                continue;
            }
            if (away() > NEAR_COOP) {
                await session.setPhase('walk');
                const walked = await bot.walkTo(COOP.x, COOP.z, 3);
                if (!walked.success) log(`walk to the chicken coop: ${walked.message}`);
                session.noteProgress('location', 'lumbridge chicken coop');
                continue;
            }
            if (session.metrics().phase !== 'fight') await session.setPhase('fight');
            await balanceStyle();
            const chicken = sdk.findNearbyNpc(CHICKEN, { reachable: true });
            if (!chicken) {
                await sdk.waitForTicks(3);
                continue;
            }
            const before = lvl('attack') + lvl('strength') + lvl('defence');
            const r = await bot.attack(chicken);
            if (!r.success) {
                await sdk.waitForTicks(2);
                continue;
            }
            // attack() returns once the fight starts; wait for the chicken to die or the fight to end.
            await sdk
                .waitForCondition((s) => !s.nearbyNpcs?.some((n) => n.index === chicken.index && (n.healthPercent ?? 100) > 0) || s.player?.combat?.inCombat === false, 30_000)
                .catch(() => undefined);
            kills++;
            session.noteProgress('xp', 'chicken');
            await sdk.waitForTicks(2);
            const bones = sdk.findGroundItem(BONES);
            if (bones && bones.distance <= 3) await bot.pickupItem(bones).catch(() => undefined);
            await buryBones();
            if (lvl('attack') + lvl('strength') + lvl('defence') > before) log(`${melee()} after ${kills} fights`);
        }

        if (!stopping() && done()) {
            await session.setPhase('idle');
            log(`stopped done | ${melee()} after ${kills} fights — idling`);
            session.stop('done', `melee >= ${UNTIL}`);
            await session.finalizeStop();
            while (!shutdownRequested && sdk.isConnected()) await sdk.waitForTicks(10).catch(() => undefined);
            return;
        }
        log(`stopped stop_requested | ${melee()} after ${kills} fights`);
    } catch (err) {
        exitCode = 1;
        session.stopRestartable('script_error', err instanceof Error ? err.message : String(err));
    } finally {
        await session.finalizeStop();
    }
});

process.exit(exitCode || process.exitCode || 0);
