import { describe, expect, test } from 'bun:test';
import { existsSync, readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { MAX_QP, QUESTS, questForId, questForItem, questPointsOf } from './quest-catalog';

const CONTENT = join(import.meta.dir, '../../server/content/scripts');
const CONSTANTS = join(CONTENT, 'general/configs/quest.constant');
const hasContent = existsSync(CONSTANTS);

describe('catalog vs server content', () => {
    test.skipIf(!hasContent)('every quest the server awards points for is here, with the same points', () => {
        const points = new Map<string, number>();
        for (const m of readFileSync(CONSTANTS, 'utf-8').matchAll(/^\^([a-z_]+)_questpoints = (\d+)/gm)) {
            points.set(m[1]!, Number(m[2]));
        }
        expect(points.size).toBeGreaterThan(60);
        const byServer = new Map(QUESTS.filter((quest) => !quest.miniquest).map((quest) => [quest.server, quest]));
        for (const [server, qp] of points) {
            expect({ server, qp: byServer.get(server)?.qp }).toEqual({ server, qp });
        }
        expect(byServer.size).toBe(points.size);
    });

    test.skipIf(!hasContent)('every quest directory is a catalog quest (barcrawl as a miniquest)', () => {
        const dirs = readdirSync(join(CONTENT, 'quests'))
            .filter((dir) => dir.startsWith('quest_'))
            .map((dir) => dir.slice('quest_'.length));
        const servers = new Set(QUESTS.map((quest) => quest.server));
        expect(dirs.filter((dir) => !servers.has(dir))).toEqual([]);
        expect(QUESTS.filter((quest) => quest.miniquest).map((quest) => quest.id)).toEqual(['barcrawl']);
    });

    test.skipIf(!hasContent)('every script named here exists in bots/quests', () => {
        const dir = join(import.meta.dir, '../../bots/quests');
        if (!existsSync(dir)) return;
        const missing = QUESTS.flatMap((quest) => quest.scripts).filter((script) => !existsSync(join(dir, script)));
        expect(missing).toEqual([]);
    });
});

describe('questForId', () => {
    test('variant suffixes fold into the base quest', () => {
        for (const id of ['waterfall-rel', 'grail-pre2', 'mortton-ns2', 'druidspirit-ns2', 'zombiequeen-v2', 'troll-pre', 'arthur-2', 'cog-r2', 'murder-qp', 'scorpcatcher-bar']) {
            expect(questForId(id)?.id).toBe(id.split('-')[0]!);
        }
    });

    test('aliases: QuestDef ids, log tags and server keys', () => {
        expect(questForId('shield-of-arrav')?.id).toBe('arrav');
        expect(questForId('desertrescue')?.id).toBe('touristtrap');
        expect(questForId('elemental_workshop')?.id).toBe('elemental');
        expect(questForId('digsite')?.id).toBe('itexam');
        expect(questForId('observatory')?.id).toBe('itgronigen');
        expect(questForId('watchtower')?.id).toBe('itwatchtower');
        expect(questForId('heroes-2')?.id).toBe('heroes');
        expect(questForId('zanaris')?.id).toBe('lostcity');
    });

    test('tasks are not quests', () => {
        for (const id of ['topup-alch', 'muster-ardougne-2', 'magic-59', 'magic-59-legends', 'mule-handover-pigfat', 'legends-stock-orb', 'arena-toadflax', 'processbank', 'air-restock', 'helms', 'death-plateau-stock', 'out-of-dungeon', 'thieving', 'crystalkeys', 'scales30', 'agility-50']) {
            expect(questForId(id)).toBeNull();
        }
    });
});

describe('questForItem', () => {
    test('the script decides when there is one', () => {
        expect(questForItem({ questId: 'digsite', script: 'bots/quests/dig-site.ts' })?.id).toBe('itexam');
        expect(questForItem({ questId: 'arena-toadflax', script: 'bots/quests/arena-tickets.ts' })).toBeNull();
        expect(questForItem({ questId: 'death-2', script: 'bots/quests/death-plateau-stock.ts' })).toBeNull();
        expect(questForItem({ questId: 'waterfall-rel' })?.id).toBe('waterfall');
    });
});

test('questPointsOf counts each quest once', () => {
    expect(questPointsOf(['cook', 'cook', 'romeojuliet', 'barcrawl'])).toBe(6);
    expect(MAX_QP).toBeGreaterThan(100);
});
