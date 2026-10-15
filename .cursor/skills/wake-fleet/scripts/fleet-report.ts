#!/usr/bin/env bun
/**
 * Fleet production report from heartbeat JSONL files.
 *
 *   bun .cursor/skills/wake-fleet/scripts/fleet-report.ts [rates|supply|flags|yields|stock] [--window 6h] [--json]
 */
import { join } from 'path';
import { readJsonlTail } from '../../../../sdk/grind-log';
import { computeStockCheck, type BankStockLine, type StockGain } from '../../../../sdk/bank-stock';
import { rosterJobKey } from '../../../../sdk/job-key';
import { rosterBots } from './roster';
import { loadState } from './fleet-shepherd';
import { computeYields, type YieldGain, type YieldHeartbeat } from './fleet-yields';
import {
    computeRates,
    estimateFishFromXp,
    flagMaxedSkill,
    flagZeroValue,
    isValidSnapshot,
    latestLevels,
    parseWindowArg,
    skillLookup,
    type HeartbeatRecord,
} from './fleet-rates';

function heartbeatAgeMin(records: HeartbeatRecord[], now: number): number | null {
    const valid = records.filter(isValidSnapshot);
    const last = valid[valid.length - 1] ?? records[records.length - 1];
    if (!last) return null;
    return Math.round((now - last.t) / 60_000);
}

const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const view = (args[0] as 'rates' | 'supply' | 'flags' | 'yields' | 'stock' | undefined) ?? 'rates';
const jsonOut = process.argv.includes('--json');
const windowArg = process.argv.find((a) => a.startsWith('--window='))?.split('=')[1]
    ?? process.argv[process.argv.indexOf('--window') + 1];
const defaultWindow =
    view === 'yields' ? 24 * 3_600_000 : view === 'supply' || view === 'flags' ? 72 * 3_600_000 : 6 * 3_600_000;
const windowMs = parseWindowArg(windowArg, defaultWindow);
const now = Date.now();

const TAIL = { tailBytes: 2_000_000, maxRecords: 20_000 };

function botFile(name: string, file: string): string {
    return join(import.meta.dir, '../../../..', 'bots', name, file);
}

function heartbeatPath(name: string): string {
    return botFile(name, 'heartbeat.log');
}

function flagValue(flag: string): string | undefined {
    const inline = process.argv.find((arg) => arg.startsWith(`${flag}=`));
    if (inline) return inline.slice(flag.length + 1);
    const index = process.argv.indexOf(flag);
    if (index < 0) return undefined;
    const value = process.argv[index + 1];
    if (!value || value.startsWith('--')) return undefined;
    return value;
}

function loadHeartbeats(name: string): HeartbeatRecord[] {
    return readJsonlTail<HeartbeatRecord>(heartbeatPath(name));
}

function trainedSkill(script: string): string | undefined {
    if (script.includes('thieving')) return 'thieving';
    if (script.includes('fishing')) return 'fishing';
    if (script.includes('rune-rocks') || script.includes('mining')) return 'mining';
    if (script.includes('magic-trees') || script.includes('wc')) return 'woodcutting';
    if (script.includes('essence')) return 'mining';
    return undefined;
}

if (view === 'rates') {
    const rows: Array<Record<string, unknown>> = [];
    let fleetXp = 0;
    let fleetGp = 0;
    for (const bot of rosterBots()) {
        const records = loadHeartbeats(bot.name);
        const rates = computeRates(records, windowMs, now);
        const age = heartbeatAgeMin(records, now);
        if (!rates) {
            rows.push({
                name: bot.name,
                job: bot.command,
                status: 'no data',
                levels: latestLevels(records),
                heartbeatAgeMin: age,
            });
            continue;
        }
        const totalXp = Object.values(rates.xpPerHour).reduce((a, b) => a + b, 0);
        fleetXp += totalXp;
        fleetGp += rates.gpPerHour;
        rows.push({
            name: bot.name,
            job: bot.script,
            xpPerHour: rates.xpPerHour,
            gpPerHour: rates.gpPerHour,
            levels: latestLevels(records),
            heartbeatAgeMin: age,
            records: rates.recordCount,
        });
    }
    if (jsonOut) {
        console.log(JSON.stringify({ view, windowMs, fleetXpPerHour: fleetXp, fleetGpPerHour: fleetGp, bots: rows }, null, 2));
    } else {
        console.log(`Fleet rates (window ${Math.round(windowMs / 3_600_000)}h) — fleet ~${fleetXp} xp/hr, ~${fleetGp} gp/hr\n`);
        for (const r of rows) {
            const xp = r.xpPerHour as Record<string, number> | undefined;
            const xpStr = xp ? Object.entries(xp).map(([k, v]) => `${k} ${v}`).join(', ') : String(r.status);
            console.log(`${String(r.name).padEnd(12)} ${xpStr} | gp/hr ${r.gpPerHour ?? '-'} | hb ${r.heartbeatAgeMin ?? '?'}m ago`);
        }
    }
} else if (view === 'supply') {
    let produced = 0;
    let consumed = 0;
    const days = windowMs / (24 * 3_600_000);
    for (const bot of rosterBots()) {
        const records = loadHeartbeats(bot.name);
        const rates = computeRates(records, windowMs, now);
        if (!rates) continue;
        if (bot.script.includes('fishing')) {
            const fishXp = skillLookup(rates.xpPerHour, 'fishing') ?? 0;
            produced += estimateFishFromXp(fishXp * days * 24) / Math.max(days, 0.01);
        }
        if (bot.script.includes('thieving') || bot.script.includes('wildy') || bot.script.includes('moss')) {
            consumed += 20 * days;
        }
    }
    const surplus = produced - consumed;
    const payload = { producedPerDay: Math.round(produced), consumedPerDay: Math.round(consumed), surplusPerDay: Math.round(surplus) };
    console.log(jsonOut ? JSON.stringify(payload, null, 2) : `Food supply (est.): produced ~${payload.producedPerDay}/day, consumed ~${payload.consumedPerDay}/day, surplus ${payload.surplusPerDay >= 0 ? '+' : ''}${payload.surplusPerDay}/day`);
} else if (view === 'flags') {
    const shepherd = loadState();
    const flags: Array<{ name: string; reason: string; detail: string }> = [];
    for (const bot of rosterBots()) {
        const records = loadHeartbeats(bot.name);
        const rates = computeRates(records, windowMs, now);
        const skill = trainedSkill(bot.script);
        const maxed = flagMaxedSkill(records, skill);
        if (maxed) flags.push({ name: bot.name, reason: maxed.reason, detail: maxed.detail });
        const zero = flagZeroValue(rates);
        if (zero) flags.push({ name: bot.name, reason: zero.reason, detail: zero.detail });
        if (shepherd.bots[bot.name]?.capped) {
            flags.push({ name: bot.name, reason: 'capped', detail: 'restart cap exceeded — manual start required' });
        }
    }
    if (jsonOut) {
        console.log(JSON.stringify({ flags }, null, 2));
    } else {
        console.log('Reassignment / attention flags:\n');
        if (flags.length === 0) console.log('(none)');
        for (const f of flags) console.log(`${f.name.padEnd(12)} ${f.reason}: ${f.detail}`);
    }
} else if (view === 'yields') {
    const report = computeYields({
        now,
        windowMs,
        bots: rosterBots().map((bot) => ({
            name: bot.name,
            rosterJobKey: rosterJobKey(bot.script, bot.args, bot.name),
            gains: readJsonlTail<YieldGain>(botFile(bot.name, 'gains.log'), TAIL),
            heartbeats: readJsonlTail<YieldHeartbeat>(heartbeatPath(bot.name), TAIL),
        })),
    });
    if (jsonOut) {
        console.log(JSON.stringify(report, null, 2));
    } else {
        const hours = Math.round(report.windowMs / 3_600_000);
        console.log(`Item yields (last ${hours}h)\n`);
        for (const job of report.jobs) {
            console.log(job.jobKey);
            for (const item of job.items) {
                console.log(`  ${item.item}: median ${item.median.toFixed(1)} /h`);
                for (const character of item.byCharacter) {
                    console.log(`    ${character.name.padEnd(12)} median ${character.median.toFixed(1)} /h over ${character.hours}h`);
                }
                for (const point of item.points) {
                    console.log(`    ${point.name} ${point.hour} ${point.perHour.toFixed(1)}`);
                }
            }
        }
        if (report.noSamples.length > 0) {
            console.log('\nno samples:');
            for (const job of report.noSamples) console.log(`  ${job}`);
        }
    }
} else if (view === 'stock') {
    const item = flagValue('--item');
    if (!item) {
        console.error('stock requires --item');
        process.exitCode = 1;
    } else {
        const hourToken = /^\d{4}-\d{2}-\d{2}T\d{2}$/;
        const fromFlag = flagValue('--from');
        const toFlag = flagValue('--to');
        if ((fromFlag && !hourToken.test(fromFlag)) || (toFlag && !hourToken.test(toFlag))) {
            console.error('--from and --to must be YYYY-MM-DDTHH');
            process.exitCode = 1;
        } else {
            const bots = rosterBots();
            const accounts = bots.map((bot) => ({
                name: bot.name,
                lines: readJsonlTail<BankStockLine>(botFile(bot.name, 'bank-stock.log'), TAIL),
            }));
            const gains: StockGain[] = bots.flatMap((bot) =>
                readJsonlTail<StockGain>(botFile(bot.name, 'gains.log'), TAIL)
            );
            const hours = [...new Set(accounts.flatMap((account) => account.lines.map((line) => line.hour)))].sort();
            const from = fromFlag ?? hours[0];
            const to = toFlag ?? hours[hours.length - 1];
            if (!from || !to || from >= to) {
                const payload = { item, from: from ?? null, to: to ?? null, accounts: [], excluded: bots.map((bot) => bot.name), stockFrom: 0, stockTo: 0, stockDelta: 0, gains: 0, gap: 0 };
                console.log(jsonOut ? JSON.stringify(payload, null, 2) : `${item}: need two different stock hours`);
            } else {
                const check = computeStockCheck(accounts, gains, item, from, to);
                if (jsonOut) console.log(JSON.stringify(check, null, 2));
                else {
                    console.log(`${check.item} ${check.from} → ${check.to}`);
                    console.log(`stock ${check.stockFrom} → ${check.stockTo} (${check.stockDelta >= 0 ? '+' : ''}${check.stockDelta})`);
                    console.log(`gains ${check.gains}  gap ${check.gap}`);
                    console.log(`accounts ${check.accounts.join(', ') || '(none)'}`);
                    if (check.excluded.length > 0) console.log(`excluded ${check.excluded.join(', ')}`);
                }
            }
        }
    }
} else {
    console.error(`Unknown view "${view}". Use rates, supply, flags, yields, or stock.`);
    process.exitCode = 1;
}
