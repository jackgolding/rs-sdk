#!/usr/bin/env node

import { readFileSync, writeFileSync } from 'node:fs';
import puppeteer from 'puppeteer';

const [requestPath, resultPath] = process.argv.slice(2);
if (!requestPath || !resultPath) {
    throw new Error('Usage: node render-atlas.mjs <request.json> <result.json>');
}

const { ids, serverBase } = JSON.parse(readFileSync(requestPath, 'utf8'));
const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });

try {
    const page = await browser.newPage();
    page.setDefaultTimeout(120_000);
    await page.goto(serverBase, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    const result = await page.evaluate(async (itemIds) => {
        document.body.innerHTML = '<canvas id="canvas" width="256" height="256" style="display:none"></canvas>';
        const module = await import('/viewer/viewer.js');
        const viewer = new module.ItemViewer();
        await viewer.init('');

        const columns = 16;
        const atlas = document.createElement('canvas');
        atlas.width = columns * 32;
        atlas.height = Math.ceil(itemIds.length / columns) * 32;
        const context = atlas.getContext('2d');
        if (!context) throw new Error('Canvas 2D context unavailable');

        const failed = [];
        itemIds.forEach((id, index) => {
            const image = viewer.renderItemIconAsImageData(id);
            if (!image) {
                failed.push(id);
                return;
            }
            context.putImageData(image, (index % columns) * 32, Math.floor(index / columns) * 32);
        });
        return { dataUrl: atlas.toDataURL('image/png'), failed };
    }, ids);
    writeFileSync(resultPath, JSON.stringify(result));
} finally {
    await browser.close();
}
