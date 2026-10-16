import { runScript } from '../../sdk/runner';

await runScript(async ({ sdk }: any) => {
    await sdk.say('~maxme');
    await sdk.waitForTicks(8).catch(() => {});
    const st = sdk.getState();
    const skills = st?.skills ?? st?.player?.skills ?? [];
    console.log('MAXME-DONE skills=' + (Array.isArray(skills) ? skills.map((s: any) => `${s.name ?? s.stat}:${s.baseLevel ?? s.level}`).join(',') : JSON.stringify(skills).slice(0, 300)));
    console.log('MSGS ' + ((st?.gameMessages ?? []).slice(-3).map((m: any) => m.text ?? m.message ?? '').join(' | ')));
}, { timeout: 90_000 });
