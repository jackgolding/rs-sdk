#!/usr/bin/env bun
/**
 * Fleet production report from heartbeat JSONL files.
 *
 *   bun .cursor/skills/wake-fleet/scripts/fleet-report.ts [rates|supply|flags] [--window 6h] [--json]
 */
import { join } from 'path';
import { readJsonlTail } from '../../../../sdk/grind-log';
import { rosterBots } from './roster';
import { loadState } from './fleet-shepherd';
import {
    computeRates,
    estimateFishFromXp,
    flagMaxedSkill,
    flagZeroValue,
    parseWindowArg,
    stallMinutes,
    type HeartbeatRecord,
} from './fleet-rates';

const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const view = (args[0] as 'rates' | 'supply' | 'flags' | undefined) ?? 'rates';
const jsonOut = process.argv.includes('--json');
const windowArg = process.argv.find((a) => a.startsWith('--window='))?.split('=')[1]
    ?? process.argv[process.argv.indexOf('--window') + 1];
const defaultWindow = view === 'supply' || view === 'flags' ? 72 * 3_600_000 : 6 * 3_600_000;
const windowMs = parseWindowArg(windowArg, defaultWindow);
const now = Date.now();

function heartbeatPath(name: string): string {
    return join(import.meta.dir, '../../../..', 'bots', name, 'heartbeat.log');
}

function loadHeartbeats(name: string): HeartbeatRecord[] {
    return readJsonlTail<HeartbeatRecord>(heartbeatPath(name));
}

function trainedSkill(script: string): string | undefined {
    if (script.includes('thieving')) return 'thieving';
    if (script.includes('fishing')) return 'fishing';
    if (script.includes('rune-rocks') || script.includes('mining')) return 'mining';
    if (script.includes('magic-trees') || script.includes('wc')) return 'woodcutting';
    if (script.includes('essence')) return 'runecrafting';
    return undefined;
}

if (view === 'rates') {
    const rows: Array<Record<string, unknown>> = [];
    let fleetXp = 0;
    let fleetGp = 0;
    for (const bot of rosterBots()) {
        const records = loadHeartbeats(bot.name);
        const rates = computeRates(records, windowMs, now);
        const age = stallMinutes(records, now);
        if (!rates) {
            rows.push({ name: bot.name, job: bot.command, status: 'no data', heartbeatAgeMin: age });
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
            const fishXp = rates.xpPerHour.fishing ?? 0;
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
} else {
    console.error(`Unknown view "${view}". Use rates, supply, or flags.`);
    process.exitCode = 1;
}
