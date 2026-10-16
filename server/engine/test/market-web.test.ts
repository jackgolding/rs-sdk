import { afterAll, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import ObjType from '../src/cache/config/ObjType.js';
import { marketStore } from '../src/engine/market/MarketStore.js';
import { handleMarket } from '../src/web/pages/market.js';

const dir = mkdtempSync(join(tmpdir(), 'market-web-'));
const previousDatabase = process.env.GE_DATABASE;
process.env.GE_DATABASE = join(dir, 'market.sqlite');
ObjType.load(join(import.meta.dir, '../data/pack'));
afterAll(() => {
    marketStore().db.close();
    rmSync(dir, { recursive: true, force: true });
    if (previousDatabase === undefined) delete process.env.GE_DATABASE;
    else process.env.GE_DATABASE = previousDatabase;
});
const request = (path: string) => {
    const url = new URL('http://localhost' + path);
    return handleMarket(new Request(url), url)!;
};

const PACK = join(import.meta.dir, '../data/pack');

test.skipIf(!existsSync(PACK))('HTTP rankings, search, pagination and item details use the same period metrics', async () => {
    const now = Date.now(),
        logs = ObjType.getId('logs'),
        iron = ObjType.getId('iron_ore'),
        coal = ObjType.getId('coal');
    expect(logs).toBeGreaterThan(0);
    const insert = marketStore().db.query('INSERT INTO trades(item,buy_offer,sell_offer,quantity,price,gross,tax,time) VALUES(?,1,2,?,?,?,0,?)');
    for (const [id, oldPrice, price, quantity, age] of [
        [logs, 100, 120, 1, 3000],
        [iron, 200, 150, 50, 1000],
        [coal, 300, 450, 2, 2000]
    ]) {
        insert.run(id, 1, oldPrice, oldPrice, now - 8 * 86400000);
        insert.run(id, quantity, price, quantity * price, now - age);
    }
    marketStore().db.query("INSERT INTO offers(owner,slot,item,side,quantity,price,remaining,created) VALUES('private-owner',-1,?,'sell',3,500,3,?)").run(coal, now);
    const feather = ObjType.getId('feather');
    const buyOffer = marketStore().db.query("INSERT INTO offers(owner,slot,item,side,quantity,price,remaining,created) VALUES('private-buyer',-1,?,'buy',?,?,?,?)");
    buyOffer.run(feather, 50, 100, 50, now);
    buyOffer.run(logs, 10, 70, 10, now);
    buyOffer.run(iron, 20, 5, 20, now);
    const sellOffer = marketStore().db.query("INSERT INTO offers(owner,slot,item,side,quantity,price,remaining,created,state) VALUES('private-seller',-1,?,'sell',3,?,3,?,?)");
    sellOffer.run(logs, 1000, now - 2000, 'open');
    sellOffer.run(feather, 200, now - 1000, 'open');
    sellOffer.run(logs, 1200, now - 5000, 'open');
    sellOffer.run(iron, 100, now + 1000, 'cancelled');
    sellOffer.run(logs, 900, now + 2000, 'cancelled');
    sellOffer.run(logs, 800, now + 3000, 'completed');
    const ranked = async (sort: string, extra = '') => await request('/api/market/items?days=7&sort=' + sort + extra).json();
    expect((await ranked('recent')).items[0].id).toBe(iron);
    const buys = await ranked('buyValue');
    expect(buys.items.map((i: { id: number }) => i.id)).toEqual([feather, logs, iron]);
    expect(buys.items.map((i: { buyValue: number }) => i.buyValue)).toEqual([5000, 700, 100]);
    expect(buys.items[0].lastPrice).toBeNull();
    expect((await ranked('buyValue', '&limit=1&offset=1')).items[0].id).toBe(logs);
    expect((await ranked('buyValue', '&q=iron')).items[0].id).toBe(iron);
    expect((await request('/api/market/items?sort=buyValue&days=1').json()).items[0].buyValue).toBe(5000);
    expect((await request('/api/market/items/' + feather + '?days=7').json()).buyValue).toBe(5000);
    expect(JSON.stringify(buys)).not.toContain('private-buyer');

    const sells = await ranked('sellRecent');
    expect(sells.items.map((i: { id: number }) => i.id)).toEqual([coal, feather, logs]);
    expect(sells.items.map((i: { lastSellAt: number }) => i.lastSellAt)).toEqual([now, now - 1000, now - 2000]);
    expect(sells.items.map((i: { ask: number }) => i.ask)).toEqual([500, 200, 1000]);
    expect(sells.items[1].lastTradeAt).toBeNull();
    expect(sells.items[2].sellQuantity).toBe(6);
    expect(sells.items[2].sellValue).toBe(6600);
    expect((await ranked('sellRecent', '&limit=1&offset=1')).items[0].id).toBe(feather);
    expect((await ranked('sellRecent', '&q=logs')).items.map((i: { id: number }) => i.id)).toEqual([logs]);
    expect((await ranked('sellRecent', '&q=iron')).total).toBe(0);
    expect((await request('/api/market/items?sort=sellRecent&days=1').json()).items.map((i: { id: number }) => i.id)).toEqual([coal, feather, logs]);
    expect(JSON.stringify(sells)).not.toContain('private-seller');

    expect((await ranked('rises')).items[0].id).toBe(coal);
    const falls = await ranked('falls');
    expect(falls.items.map((i: { id: number }) => i.id)).toEqual([iron]);
    expect(falls.items[0].changePercent).toBe(-25);
    expect((await ranked('volume')).items[0].id).toBe(iron);
    expect((await ranked('price', '&limit=1&offset=1')).items[0].id).toBe(iron);
    const caps = await ranked('marketCap');
    expect(caps.items[0].id).toBe(coal);
    expect(caps.items[0].marketCap).toBe(1350);
    expect(caps.summary.volume).toBe(53);
    expect(caps.featured.id).toBe(iron);
    expect(JSON.stringify(caps)).not.toContain('private-owner');
    expect((await ranked('price', '&q=logs')).items.map((i: { id: number }) => i.id)).toEqual([logs]);
    expect((await ranked('price', '&q=nonexistent-item')).total).toBe(0);
    expect((await request('/api/market/items/' + coal + '?days=7').json()).changePercent).toBe(50);
    expect((await request('/api/market/items/' + coal + '/history?from=' + (now - 7 * 86400000) + '&to=' + now).json()).history[0].volume).toBe(2);
    expect((await ranked('rises', '&q=coal')).total).toBe(1);
    // A long period without an earlier price must not claim a percentage gain.
    expect((await request('/api/market/items?sort=rises&days=90').json()).total).toBe(0);
    expect(request('/api/market/items?sort=invalid').status).toBe(400);
    expect(request('/api/market/items?days=2').status).toBe(400);
    expect(request('/api/market/items?limit=101').status).toBe(400);
    expect(request('/api/market/items/999999').status).toBe(404);
    expect((await request('/api/market/items?q=logs').json()).items.length).toBeGreaterThan(1);
});
