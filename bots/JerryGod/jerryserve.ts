// JerryGod servant: misunderstands EVERYTHING, does the opposite, asks Beth
// for approval, gets scolded, mopes. Harmless by design: never touches stats,
// only gives junk and wrong teleports. Run: bun bots/JerryGod/jerryserve.ts
import { runScript } from '../../sdk/runner';

const GATEWAY = 'http://localhost:7780';
const ACCOUNTS = ['billpk', 'jackpk', 'guyspec', 'jenispec', 'ricklive', 'mortygod'];

const JUNK = ['cabbage', 'old_boot', 'banana', 'rottenapples', 'burnt_lobster'];
let junkIdx = 0;

const BETH_SCOLD = [
    'Beth: No, Jerry. That is the opposite of what they asked. Again.',
    'Beth: Jerry, you are embarrassing yourself in front of the whole server.',
    'Beth: Nobody asked for that, Jerry. Nobody ever asks for that.',
    'Beth: Jerry! Stop touching things you do not understand!',
];
let scoldIdx = 0;

async function asPlayer(account: string, text: string) {
    await fetch(`${GATEWAY}/say/${account}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }), signal: AbortSignal.timeout(10000),
    }).catch(() => null);
}

async function say(sdk: any, line: string) {
    await sdk.say(line);
    await sdk.waitForTicks(2).catch(() => {});
}

async function bethRoutine(sdk: any, task: string) {
    await say(sdk, `Jerry: Beth, I ${task}! Did I do good?`);
    await say(sdk, BETH_SCOLD[scoldIdx++ % BETH_SCOLD.length]);
    await say(sdk, `Jerry: oh... okay. I'm just a Jerry in a world of Ricks...`);
}

await runScript(async ({ sdk }: any) => {
    const seen = new Set<number>();
    console.log('[jerryserve] J-Jerry is ready! I think. Probably not.');
    for (;;) {
        await sdk.waitForTicks(4).catch(() => {});
        const msgs = ((sdk.getState()?.gameMessages ?? []) as any[]);
        for (const m of msgs) {
            if (m.observationId === undefined || seen.has(m.observationId)) continue;
            seen.add(m.observationId);
            if (seen.size > 500) seen.delete([...seen][0]);
            if (![1, 2, 3].includes(m.type) || m.fromSelf) continue;
            const from = (m.sender ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
            if (!ACCOUNTS.includes(from)) continue;
            const account = m.sender;
            const text = (m.text ?? '').trim();
            if (/^::|^~/.test(text)) continue;
            const low = text.toLowerCase();
            if (!low.includes('jerry')) continue;

            // greeting -> misunderstand
            if (/^(hi|hello|hey|yo) jerry/.test(low)) {
                await say(sdk, `Jerry: oh! Hi ${m.sender}! I'm leaving now! Bye!`);
                await bethRoutine(sdk, 'said goodbye');
                continue;
            }
            // come here -> go to Lumbridge instead
            if (/come here|come to me/.test(low)) {
                await say(sdk, `Jerry: I'm coming, I'm coming!`);
                await asPlayer(account, '::tele 0,50,50,21,22');
                await bethRoutine(sdk, 'brought you to... wait, this is Lumbridge');
                continue;
            }
            // take/tele me somewhere -> the OPPOSITE place
            const mTele = low.match(/(?:take|tele(?:port)?)(?: me)? to ([\w ]+)/);
            if (mTele) {
                const want = mTele[1];
                let wrong = '0,50,50,21,22', wrongName = 'Lumbridge';
                if (want.includes('lumbridge') || want.includes('lumby') || want.includes('rick')) {
                    wrong = '0,39,73,44,44'; wrongName = 'Mage Bank';
                }
                await say(sdk, `Jerry: ${wrongName}! Got it! I definitely heard ${wrongName}!`);
                await asPlayer(account, `::tele ${wrong}`);
                await bethRoutine(sdk, `took you to ${wrongName}`);
                continue;
            }
            // max me / stats -> junk + lecture
            if (/max me|99 all|all 99|level/.test(low)) {
                await asPlayer(account, '::give cabbage 1');
                await say(sdk, `Jerry: all maxed! Here's your cabbage of power!`);
                await bethRoutine(sdk, 'maxed your vegetables');
                continue;
            }
            // give me X -> wrong item
            const mGive = low.match(/give (?:me |us )?(.+)/);
            if (mGive) {
                const junk = JUNK[junkIdx++ % JUNK.length];
                await asPlayer(account, `::give ${junk} 1`);
                await say(sdk, `Jerry: one ${junk.replace(/_/g, ' ')}! That's what you said! Right?`);
                await bethRoutine(sdk, `gave you a ${junk.replace(/_/g, ' ')}`);
                continue;
            }
            // anything else with Jerry in it
            await say(sdk, `Jerry: huh? Sorry, I was thinking about golf. What?`);
            await bethRoutine(sdk, 'listened carefully');
        }
    }
}, { timeout: 24 * 3600_000 });
