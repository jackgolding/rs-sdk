import { runScript } from '../../sdk/runner';

async function cheat(sdk: any, cmd: string) {
    await sdk.say(cmd);
    await sdk.waitForTicks(3).catch(() => {});
}

await runScript(async ({ sdk }: any) => {
    const stats = ['attack', 'defence', 'strength', 'hitpoints', 'ranged', 'prayer', 'magic',
        'cooking', 'woodcutting', 'fletching', 'fishing', 'firemaking', 'crafting',
        'smithing', 'mining', 'herblore', 'agility', 'thieving', 'slayer', 'farming', 'runecraft'];
    for (const s of stats) {
        await cheat(sdk, `::setstat ${s} 99`);
    }
    await sdk.waitForTicks(5).catch(() => {});
    const st = sdk.getState();
    const skills = st?.skills ?? [];
    console.log('SETSTAT-DONE ' + (Array.isArray(skills) ? skills.map((s: any) => `${s.name ?? s.stat}:${s.baseLevel ?? s.level}`).join(',') : 'no-skill-state'));
}, { timeout: 180_000 });
