#!/usr/bin/env bun
/**
 * Render route item-rate distributions as box plots.
 * Fishing routes show cooked swordfish, tuna, and shark only.
 * Does not connect to the game. Omits the file when nothing has been gained yet.
 *
 *   bun .cursor/skills/fleet-bank-canvas/scripts/build-yield-canvas.ts [--window 24h]
 */
import { writeFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { readJsonlTail } from '../../../../sdk/grind-log';
import { rosterJobKey } from '../../../../sdk/job-key';
import { parseWindowArg } from '../../wake-fleet/scripts/fleet-rates';
import { computeYields, type YieldGain, type YieldHeartbeat } from '../../wake-fleet/scripts/fleet-yields';
import { ROOT, rosterBots } from '../../wake-fleet/scripts/roster';

const TAIL = { tailBytes: 2_000_000, maxRecords: 20_000 };
const windowArg =
    process.argv.find((arg) => arg.startsWith('--window='))?.split('=')[1] ??
    process.argv[process.argv.indexOf('--window') + 1];
const windowMs = parseWindowArg(windowArg, 24 * 3_600_000);

function projectDirectory(): string {
    const workspaceKey = ROOT.replace(/^\/+/, '').replaceAll('/', '-');
    return join(homedir(), '.cursor', 'projects', workspaceKey);
}

const report = computeYields({
    now: Date.now(),
    windowMs,
    bots: rosterBots().map((bot) => ({
        name: bot.name,
        rosterJobKey: rosterJobKey(bot.script, bot.args, bot.name),
        gains: readJsonlTail<YieldGain>(join(ROOT, 'bots', bot.name, 'gains.log'), TAIL),
        heartbeats: readJsonlTail<YieldHeartbeat>(join(ROOT, 'bots', bot.name, 'heartbeat.log'), TAIL),
    })),
});

if (report.jobs.length === 0) {
    console.log(`No gain samples in the last ${Math.round(report.windowMs / 3_600_000)}h.`);
    if (report.noSamples.length > 0) console.log(report.noSamples.join('\n'));
    process.exit(0);
}

const source = `import { Divider, H1, H2, H3, Row, Stack, Stat, Table, Text, useHostTheme } from 'cursor/canvas';

const REPORT = ${JSON.stringify(report)};

const COOKED_FISH = ['swordfish', 'tuna', 'shark'];

type BoxStats = {
    n: number;
    q1: number;
    median: number;
    q3: number;
    whiskerLow: number;
    whiskerHigh: number;
    max: number;
    outliers: number[];
};

type DrawnRow = {
    label: string;
    stats: BoxStats;
};

function itemKey(item: string): string {
    return item.trim().toLowerCase();
}

function includeItem(jobKey: string, item: string): boolean {
    if (!jobKey.includes('fishing-route')) return true;
    return COOKED_FISH.indexOf(itemKey(item)) >= 0;
}

function routeLabel(jobKey: string): string {
    const base = jobKey.split('/').pop() ?? jobKey;
    return base.replace(/\.ts\b/, '');
}

function shortRoute(jobKey: string): string {
    if (jobKey.includes('--smallnet')) return 'small-net route';
    if (jobKey.includes('--shark')) return 'shark route';
    return routeLabel(jobKey);
}

function quantile(sorted: number[], p: number): number {
    if (sorted.length === 1) return sorted[0]!;
    const idx = (sorted.length - 1) * p;
    const lo = Math.floor(idx);
    const hi = Math.ceil(idx);
    if (lo === hi) return sorted[lo]!;
    const weight = idx - lo;
    return sorted[lo]! * (1 - weight) + sorted[hi]! * weight;
}

function boxStats(values: number[]): BoxStats | null {
    if (values.length === 0) return null;
    const sorted = [...values].sort((a, b) => a - b);
    const q1 = quantile(sorted, 0.25);
    const median = quantile(sorted, 0.5);
    const q3 = quantile(sorted, 0.75);
    const iqr = q3 - q1;
    const lowFence = q1 - 1.5 * iqr;
    const highFence = q3 + 1.5 * iqr;
    const inside = sorted.filter((value) => value >= lowFence && value <= highFence);
    return {
        n: sorted.length,
        q1,
        median,
        q3,
        whiskerLow: inside[0] ?? sorted[0]!,
        whiskerHigh: inside[inside.length - 1] ?? sorted[sorted.length - 1]!,
        max: sorted[sorted.length - 1]!,
        outliers: sorted.filter((value) => value < lowFence || value > highFence),
    };
}

function formatRate(n: number): string {
    const abs = Math.abs(n);
    if (abs >= 100) return String(Math.round(n));
    if (abs >= 10) return String(Math.round(n * 10) / 10);
    return String(Math.round(n * 100) / 100);
}

function niceMax(max: number): number {
    if (!(max > 0)) return 1;
    const padded = max * 1.05;
    const exp = Math.pow(10, Math.floor(Math.log10(padded)));
    const fraction = padded / exp;
    const nice = fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 5 ? 5 : 10;
    return nice * exp;
}

function domainOf(rows: DrawnRow[]): number {
    return niceMax(Math.max(0, ...rows.map((row) => row.stats.max)));
}

function drawRows(rows: { label: string; values: number[] }[]): DrawnRow[] {
    const drawn: DrawnRow[] = [];
    for (const row of rows) {
        const stats = boxStats(row.values);
        if (stats) drawn.push({ label: row.label, stats });
    }
    drawn.sort((a, b) => b.stats.median - a.stats.median || a.label.localeCompare(b.label));
    return drawn;
}

function BoxLegend() {
    const theme = useHostTheme();
    return (
        <Row gap={16} align="center" wrap>
            <Row gap={6} align="center">
                <svg width={44} height={16} aria-hidden>
                    <line x1={2} x2={42} y1={8} y2={8} stroke={theme.text.secondary} strokeWidth={1.5} />
                    <line x1={2} x2={2} y1={3} y2={13} stroke={theme.text.secondary} strokeWidth={1.5} />
                    <line x1={42} x2={42} y1={3} y2={13} stroke={theme.text.secondary} strokeWidth={1.5} />
                    <rect x={12} y={2} width={20} height={12} fill={theme.fill.secondary} stroke={theme.accent.primary} strokeWidth={1.5} />
                    <line x1={22} x2={22} y1={2} y2={14} stroke={theme.accent.primary} strokeWidth={2} />
                </svg>
                <Text size="small" tone="secondary">Box: middle half. Bar: median. Whiskers: 1.5 IQR.</Text>
            </Row>
            <Row gap={6} align="center">
                <svg width={12} height={12} aria-hidden>
                    <circle cx={6} cy={6} r={3} fill={theme.text.tertiary} />
                </svg>
                <Text size="small" tone="secondary">Dot: rate outside the whiskers.</Text>
            </Row>
        </Row>
    );
}

function BoxPlot({
    rows,
    yAxis,
    xAxis,
}: {
    rows: DrawnRow[];
    yAxis: string;
    xAxis: string;
}) {
    const theme = useHostTheme();
    const domainMax = domainOf(rows);
    const labelW = Math.max(120, Math.min(250, Math.ceil(Math.max(...rows.map((row) => row.label.length)) * 7.4)));
    const plotW = 520;
    const valueW = 76;
    const headerH = 18;
    const rowH = 44;
    const axisH = 40;
    const width = labelW + plotW + valueW;
    const height = headerH + rows.length * rowH + axisH;
    const xOf = (value: number) => labelW + (Math.max(0, value) / domainMax) * plotW;
    const ticks = [0, 1, 2, 3, 4].map((step) => (domainMax / 4) * step);

    return (
        <svg viewBox={'0 0 ' + width + ' ' + height} width="100%" role="img" style={{ width: '100%', height: 'auto', display: 'block' }}>
            <title>{yAxis + ' by ' + xAxis}</title>
            <text x={0} y={12} fill={theme.text.tertiary} fontSize={12}>
                {yAxis}
            </text>
            {ticks.map((tick, index) => {
                const anchor = index === 0 ? 'start' : index === ticks.length - 1 ? 'end' : 'middle';
                return (
                    <g key={tick}>
                        <line
                            x1={xOf(tick)}
                            x2={xOf(tick)}
                            y1={headerH}
                            y2={headerH + rows.length * rowH}
                            stroke={theme.stroke.tertiary}
                            strokeWidth={1}
                        />
                        <text x={xOf(tick)} y={headerH + rows.length * rowH + 16} textAnchor={anchor} fill={theme.text.tertiary} fontSize={11}>
                            {formatRate(tick)}
                        </text>
                    </g>
                );
            })}
            <text x={labelW + plotW / 2} y={height - 4} textAnchor="middle" fill={theme.text.secondary} fontSize={12}>
                {xAxis}
            </text>
            {rows.map((row, index) => {
                const y = headerH + index * rowH + rowH / 2;
                const stats = row.stats;
                const boxX = xOf(stats.q1);
                const boxW = Math.max(2, xOf(stats.q3) - boxX);
                return (
                    <g key={row.label}>
                        <text x={0} y={y} dominantBaseline="middle" fill={theme.text.primary} fontSize={13}>
                            {row.label}
                        </text>
                        <line x1={xOf(stats.whiskerLow)} x2={xOf(stats.whiskerHigh)} y1={y} y2={y} stroke={theme.text.secondary} strokeWidth={1.5} />
                        <line x1={xOf(stats.whiskerLow)} x2={xOf(stats.whiskerLow)} y1={y - 8} y2={y + 8} stroke={theme.text.secondary} strokeWidth={1.5} />
                        <line x1={xOf(stats.whiskerHigh)} x2={xOf(stats.whiskerHigh)} y1={y - 8} y2={y + 8} stroke={theme.text.secondary} strokeWidth={1.5} />
                        <rect x={boxX} y={y - 11} width={boxW} height={22} fill={theme.fill.secondary} stroke={theme.accent.primary} strokeWidth={1.5} />
                        <line x1={xOf(stats.median)} x2={xOf(stats.median)} y1={y - 11} y2={y + 11} stroke={theme.accent.primary} strokeWidth={2} />
                        {stats.outliers.map((value, outlierIndex) => (
                            <circle key={row.label + '-' + outlierIndex} cx={xOf(value)} cy={y} r={3} fill={theme.text.tertiary} />
                        ))}
                        <text x={labelW + plotW + 8} y={y} dominantBaseline="middle" fill={theme.text.primary} fontSize={12}>
                            {formatRate(stats.median)} /h
                        </text>
                    </g>
                );
            })}
        </svg>
    );
}

function rateTable(rows: DrawnRow[]) {
    return (
        <Table
            headers={['Route and item', 'Samples', 'Lower whisker', 'Q1', 'Median', 'Q3', 'Upper whisker']}
            columnAlign={['left', 'right', 'right', 'right', 'right', 'right', 'right']}
            rows={rows.map((row) => [
                row.label,
                String(row.stats.n),
                formatRate(row.stats.whiskerLow),
                formatRate(row.stats.q1),
                formatRate(row.stats.median),
                formatRate(row.stats.q3),
                formatRate(row.stats.whiskerHigh),
            ])}
        />
    );
}

export default function ScriptItemRates() {
    const hours = Math.round(REPORT.windowMs / 3_600_000);
    const jobs = REPORT.jobs
        .map((job) => ({
            jobKey: job.jobKey,
            items: job.items
                .filter((item) => includeItem(job.jobKey, item.item))
                .map((item) => ({
                    label: item.item,
                    values: item.points.map((point) => point.perHour),
                })),
        }))
        .filter((job) => job.items.length > 0);
    const fishingJobs = jobs.filter((job) => job.jobKey.includes('fishing-route'));
    const otherJobs = jobs.filter((job) => !job.jobKey.includes('fishing-route'));
    const fishingRows = drawRows(
        fishingJobs.flatMap((job) =>
            job.items.map((item) => ({
                label: shortRoute(job.jobKey) + ' · ' + item.label,
                values: item.values,
            }))
        )
    );
    const headline = fishingRows.filter((row) => row.stats.median > 0);

    return (
        <Stack gap={24}>
            <Stack gap={4}>
                <H1>Route rate distributions</H1>
                <Text tone="secondary" size="small">
                    Each sample is one character-hour, summarized so individual hours are not plotted. The box is the middle half of rates, the bar is the median, whiskers reach 1.5 IQR, and dots are outside that. Source: named gains and heartbeat presence, last {hours}h. Rates are items per hour.
                </Text>
            </Stack>
            <BoxLegend />
            {fishingRows.length > 0 ? (
                <Stack gap={12}>
                    <H2>Cooked fish per hour, last {hours}h</H2>
                    <Text tone="secondary" size="small">
                        Fishing routes only: swordfish, tuna, and shark. Raw fish are omitted. {fishingJobs.map((job) => routeLabel(job.jobKey)).join(' · ')}
                    </Text>
                    {headline.length > 0 ? (
                        <Stack gap={6}>
                            <Text weight="semibold">Median items per hour</Text>
                            <Row gap={16} wrap>
                                {headline.map((row) => (
                                    <Stat key={row.label} value={formatRate(row.stats.median) + ' /h'} label={row.label} />
                                ))}
                            </Row>
                        </Stack>
                    ) : null}
                    <BoxPlot rows={fishingRows} yAxis="Route and item" xAxis="Items per hour" />
                    <Text tone="secondary" size="small">
                        Y axis: route and cooked item. X axis: items per hour. A box on zero means nearly every sample produced none. Source: gains and heartbeat presence, last {hours}h.
                    </Text>
                    {rateTable(fishingRows)}
                </Stack>
            ) : null}
            {otherJobs.length > 0 ? (
                <Stack gap={16}>
                    <H2>Other routes</H2>
                    {otherJobs.map((job) => {
                        const rows = drawRows(job.items);
                        if (rows.length === 0) return null;
                        return (
                            <Stack key={job.jobKey} gap={8}>
                                <H3>{routeLabel(job.jobKey)} per hour, last {hours}h</H3>
                                <BoxPlot rows={rows} yAxis="Item" xAxis="Items per hour" />
                                <Text tone="secondary" size="small">
                                    Y axis: item. X axis: items per hour. Source: gains and heartbeat presence, last {hours}h.
                                </Text>
                                {rateTable(rows)}
                            </Stack>
                        );
                    })}
                </Stack>
            ) : null}
            {REPORT.noSamples.length > 0 ? (
                <Text tone="secondary" size="small">No samples: {REPORT.noSamples.join(', ')}</Text>
            ) : null}
            <Divider />
            <Text tone="tertiary" size="small">
                Shop price and bank balances are not this score.
            </Text>
        </Stack>
    );
}
`;


const canvasPath = join(projectDirectory(), 'canvases', 'script-item-rates.canvas.tsx');
writeFileSync(canvasPath, source);
console.log(canvasPath);
