// MortyGod servant: obeys player commands in local chat, Morty-style.
// Run: bun bots/MortyGod/godserve.ts (needs MortyGod lite runner up).
import { runScript } from '../../sdk/runner';

const GATEWAY = 'http://localhost:7780';
const ACCOUNTS = ['billpk', 'jackpk', 'guyspec', 'jenispec', 'ricklive'];

const PLACES: Record<string, string> = {
    bank: '0,39,73,44,44', 'mage bank': '0,39,73,44,44',
    lumbridge: '0,50,50,21,22', lumby: '0,50,50,21,22', rick: '0,50,50,21,22',
    arena: '0,48,61,22,52',
};

const ITEMS: [RegExp, string][] = [
    [/red party ?hat|^party ?hat$/, 'red_partyhat'], [/blue party ?hat$/, 'blue_partyhat'],
    [/green party ?hat$/, 'green_partyhat'], [/yellow party ?hat$/, 'yellow_partyhat'],
    [/purple party ?hat$/, 'purple_partyhat'], [/white party ?hat$/, 'white_partyhat'],
    [/rune full helm|full helm$/, 'rune_full_helm'], [/rune plate(body|legs)?$/, 'rune_platebody'],
    [/rune platelegs|platelegs$/, 'rune_platelegs'], [/rune kite|kiteshield$/, 'rune_kiteshield'],
    [/rune 2h|r2h$/, 'rune_2h_sword'], [/rune scim/, 'rune_scimitar'],
    [/oak ?bow|shortbow/, 'oak_shortbow'], [/iron arrows?$/, 'iron_arrow'],
    [/air staff|staff of air/, 'staff_of_air'], [/air ?runes?$/, 'airrune'],
    [/chaos ?runes?$/, 'chaosrune'], [/death ?runes?$/, 'deathrune'],
    [/str amulet|amulet of strength/, 'amulet_of_strength'], [/power amulet|amulet of power/, 'amulet_of_power'],
    [/monk ?top|monk robe top/, 'monkrobetop'], [/monk ?bottom|monk robe bottom/, 'monkrobebottom'],
    [/coif/, 'coif'], [/vambraces|vambs/, 'leather_vambraces'], [/gloves/, 'leather_gloves'],
    [/lobsters?$/, 'lobster'], [/sharks?$/, 'shark'], [/swordfish/, 'swordfish'],
    [/white apron/, 'white_apron'],
    [/red cape/, 'red_cape'], [/blue cape/, 'blue_cape'], [/green cape/, 'green_cape'], [/purple cape/, 'purple_cape'],
];

async function asPlayer(account: string, text: string) {
    const res = await fetch(`${GATEWAY}/say/${account}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }), signal: AbortSignal.timeout(10000),
    }).catch(() => null);
    return res?.ok ?? false;
}

function parseAmount(words: string): number {
    const m = words.match(/(\d+)\s*$/);
    if (m) return Math.min(500, Math.max(1, parseInt(m[1], 10)));
    if (/a lot|many|plenty/.test(words)) return 20;
    return 1;
}

await runScript(async ({ sdk }: any) => {
    const seen = new Set<number>();
    console.log('[godserve] Morty is listening. Oh geez.');
    for (;;) {
        await sdk.waitForTicks(4).catch(() => {});
        const st = sdk.getState();
        const msgs = (st?.gameMessages ?? []) as any[];
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

            // stay out of the other gods' business
            if ((/jerry|rick/.test(low)) && !low.includes('morty')) continue;

            // greeting
            if (/^(hi|hello|hey|yo|oh geez)[ ,!]*morty/.test(low) || /morty[?!.,]*$/.test(low) && /^(hi|hello|hey)/.test(low)) {
                await sdk.say(`Oh geez, hi ${m.sender}! Need anything? Just ask!`);
                continue;
            }
            // come here
            if (/morty.*come here|come here.*morty|come to me/.test(low)) {
                try {
                    const pos = await (await fetch(`${GATEWAY}/playerpositions`, { signal: AbortSignal.timeout(8000) }).then(r => r.json()) as Promise<any[]>);
                    const t = pos.find((p: any) => p.name.toLowerCase() === from);
                    if (t) {
                        const mx = t.x >> 6, mz = t.z >> 6, lx = t.x - (mx << 6), lz = t.z - (mz << 6);
                        await sdk.say(`Oh geez, coming ${m.sender}!`);
                        await sdk.say(`::tele ${t.level},${mx},${mz},${lx},${lz}`);
                    } else await sdk.say(`Oh geez, I can't see you ${m.sender}!`);
                } catch { await sdk.say(`Oh geez, that didn't work!`); }
                continue;
            }
            // take/tele me somewhere
            let mTele = low.match(/(?:take|tele(?:port)?)(?: me)? to ([\w ]+)/);
            if (mTele) {
                const where = Object.keys(PLACES).find(k => mTele![1].includes(k));
                if (where) {
                    await asPlayer(account, `::tele ${PLACES[where]}`);
                    await sdk.say(`Off to ${where}, ${m.sender}! Oh geez, have fun!`);
                } else await sdk.say(`Oh geez, I only know bank, lumbridge and arena, ${m.sender}!`);
                continue;
            }
            // max me
            if (/max me|99 all|all 99/.test(low)) {
                await sdk.say(`Oh geez, maxing you out ${m.sender}! One sec!`);
                for (const s of ['attack', 'defence', 'strength', 'hitpoints', 'ranged', 'prayer', 'magic']) {
                    await asPlayer(account, `::setstat ${s} 99`);
                    await sdk.waitForTicks(2).catch(() => {});
                }
                await sdk.say(`Done! You're 99 everything, ${m.sender}!`);
                continue;
            }
            // give me X
            let mGive = low.match(/give (?:me |us )?(.+)/);
            if (mGive) {
                const want = mGive[1].trim();
                const hit = ITEMS.find(([re]) => re.test(want));
                if (hit) {
                    const n = parseAmount(want);
                    await asPlayer(account, `::give ${hit[1]} ${n}`);
                    await sdk.say(`Here you go ${m.sender}, oh geez!`);
                } else await sdk.say(`Oh geez ${m.sender}, I don't know what "${want}" is!`);
                continue;
            }
        }
    }
}, { timeout: 6 * 3600_000 });
