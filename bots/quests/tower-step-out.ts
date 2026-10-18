/**
 * Tower step-out one-shot: open adjacent closed doors and step through them
 * (Wizards Tower walk-trap rescue — the tower's double door plus fence gate
 * are masked in pathfinding, so bare walkTo can never route out), then walk
 * to open road toward the Draynor bank approach where the grind scripts'
 * own hops take over.
 *
 *   bun bots/quests/tower-step-out.ts jacklove14
 *
 * Restarts are no-ops: a bot already clear of the tower logs DONE without
 * moving. Switch back to the grind once DONE is in.
 */
import { join } from 'path';
import { runScript } from '../../sdk/runner';
import { appendGrindLog } from '../../sdk/grind-log';
import { closeUi, leaveAdjacentClosedDoor, playerPos, walkNear } from './movement';

const positional: string[] = [];
for (const a of process.argv.slice(2)) {
    if (!a.startsWith('-')) positional.push(a);
}

const botName = positional[0] ?? '';
if (!botName) {
    throw new Error('Usage: bun bots/quests/tower-step-out.ts {name}');
}
const GRIND_LOG = join(process.cwd(), 'bots', botName, 'grind.log');

/** Wizards Tower ground floor. Outside this radius counts as clear. */
const TOWER = { x: 3104, z: 3163 };
/** Melee script's first bank hop — open road south-east toward Draynor. */
const ROAD = { x: 3088, z: 3320 };

await runScript(async ({ bot, sdk }) => {
    const log = (level: 'LOG' | 'WARN' | 'ERROR', msg: string) => {
        console.log(`${level} ${msg}`);
        appendGrindLog(GRIND_LOG, `${new Date().toISOString()} ${level} ${msg}`);
    };

    async function idleDone(msg: string): Promise<never> {
        log('LOG', `DONE ${msg}`);
        for (;;) {
            await sdk.waitForTicks(600).catch(() => {});
            log('LOG', `DONE holding: ${msg}`);
        }
        throw new Error('unreachable');
    }

    await closeUi(bot, sdk);
    const at = () => {
        const p = playerPos(sdk);
        return { ...p, towerDist: Math.hypot(p.x - TOWER.x, p.z - TOWER.z) };
    };

    let p = at();
    log('LOG', `Tower step-out start @ ${p.x},${p.z} lv${p.level} towerDist=${Math.round(p.towerDist)}`);
    if (p.towerDist > 40) {
        return idleDone(`already clear of tower @ ${p.x},${p.z} — nothing to do`);
    }

    for (let i = 0; i < 4; i++) {
        const stepped = await leaveAdjacentClosedDoor(sdk).catch((e) => {
            log('WARN', `door step ${i} threw: ${(e as Error).message}`);
            return false;
        });
        p = at();
        log('LOG', `door step ${i}: ${stepped ? 'through' : 'no adjacent door'} @ ${p.x},${p.z}`);
        if (!stepped) break;
        await sdk.waitForTicks(2).catch(() => {});
    }

    p = at();
    if (p.towerDist > 40) {
        return idleDone(`step-out clear @ ${p.x},${p.z} — no road hop needed`);
    }
    const road = await walkNear(bot, sdk, ROAD.x, ROAD.z, 8);
    p = at();
    log('LOG', `road hop (${ROAD.x},${ROAD.z}): ${road ? 'ok' : 'FAILED'} @ ${p.x},${p.z}`);
    return idleDone(`step-out @ ${p.x},${p.z} towerDist=${Math.round(p.towerDist)} road=${road ? 'ok' : 'FAILED'}`);
});
