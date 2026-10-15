/**
 * Character-hour item rates. Presence comes from heartbeats; counts come from
 * gain lines. Skill XP is not consulted. See specs/004-script-item-rates.
 */
import { localHour, normalizeItemName } from '../../../../sdk/job-key';

const SEVEN_DAYS_MS = 7 * 24 * 3_600_000;
const MIN_PRESENCE_MS = 10 * 60_000;
const HEARTBEAT_INTERVAL_MS = 5 * 60_000;
const MAX_GAP_MS = 10 * 60_000;

export interface YieldGain {
    t: number;
    jobKey?: string;
    item?: string;
    count?: number;
}

export interface YieldHeartbeat {
    t: number;
    jobKey?: string;
    x?: number;
    z?: number;
    xp?: Record<string, number>;
}

export interface YieldBotInput {
    name: string;
    rosterJobKey: string;
    gains: YieldGain[];
    heartbeats: YieldHeartbeat[];
}

export interface YieldInput {
    now: number;
    windowMs: number;
    bots: YieldBotInput[];
    hourOf?: (t: number) => string;
}

export interface CharacterHour {
    name: string;
    jobKey: string;
    item: string;
    hour: string;
    presenceMs: number;
    count: number;
    perHour: number;
}

export interface ItemYield {
    item: string;
    median: number;
    points: CharacterHour[];
    byCharacter: { name: string; median: number; hours: number }[];
}

export interface JobYield {
    jobKey: string;
    drift: { name: string; rosterJobKey: string }[];
    items: ItemYield[];
}

export interface YieldReport {
    windowMs: number;
    jobs: JobYield[];
    noSamples: string[];
}

export function medianOf(values: number[]): number | null {
    if (values.length === 0) return null;
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    if (sorted.length % 2 === 1) return sorted[mid]!;
    return (sorted[mid - 1]! + sorted[mid]!) / 2;
}

function validHeartbeat(record: YieldHeartbeat): boolean {
    const hp = record.xp?.Hitpoints ?? record.xp?.hitpoints ?? 0;
    if (!(hp > 0)) return false;
    if ((record.x ?? 0) === 0 && (record.z ?? 0) === 0) return false;
    return typeof record.jobKey === 'string' && record.jobKey.length > 0 && Number.isFinite(record.t);
}

function presenceMs(times: number[]): number {
    if (times.length === 0) return 0;
    const sorted = [...times].sort((a, b) => a - b);
    let ms = 0;
    for (let i = 1; i < sorted.length; i++) {
        const gap = sorted[i]! - sorted[i - 1]!;
        if (gap > 0 && gap <= MAX_GAP_MS) ms += gap;
    }
    ms += HEARTBEAT_INTERVAL_MS;
    return Math.min(ms, 3_600_000);
}

export function computeYields(input: YieldInput): YieldReport {
    const windowMs = Math.min(Math.max(0, input.windowMs), SEVEN_DAYS_MS);
    const since = input.now - windowMs;
    const retain = input.now - SEVEN_DAYS_MS;
    const hourOf = input.hourOf ?? localHour;
    const inWindow = (t: number) => Number.isFinite(t) && t >= since && t >= retain && t <= input.now;

    const driftByJob = new Map<string, { name: string; rosterJobKey: string }[]>();
    const noteDrift = (jobKey: string, name: string, rosterJobKey: string) => {
        if (jobKey === rosterJobKey) return;
        const list = driftByJob.get(jobKey) ?? [];
        if (!list.some((row) => row.name === name)) list.push({ name, rosterJobKey });
        driftByJob.set(jobKey, list);
    };

    const presence = new Map<string, number[]>();
    const presenceKey = (name: string, jobKey: string, hour: string) => `${name}\0${jobKey}\0${hour}`;
    const gainCounts = new Map<string, { item: string; count: number }>();
    const gainKey = (name: string, jobKey: string, hour: string, itemKey: string) =>
        `${name}\0${jobKey}\0${hour}\0${itemKey}`;
    const itemsByJob = new Map<string, Map<string, string>>();

    for (const bot of input.bots) {
        for (const beat of bot.heartbeats) {
            if (!inWindow(beat.t) || !validHeartbeat(beat)) continue;
            const jobKey = beat.jobKey!;
            noteDrift(jobKey, bot.name, bot.rosterJobKey);
            const hour = hourOf(beat.t);
            const key = presenceKey(bot.name, jobKey, hour);
            const times = presence.get(key) ?? [];
            times.push(beat.t);
            presence.set(key, times);
        }
        for (const gain of bot.gains) {
            if (!inWindow(gain.t)) continue;
            const item = gain.item?.trim() ?? '';
            const jobKey = gain.jobKey ?? '';
            if (!item || !jobKey) continue;
            if (!Number.isInteger(gain.count) || (gain.count ?? 0) < 1) continue;
            noteDrift(jobKey, bot.name, bot.rosterJobKey);
            const itemKey = normalizeItemName(item);
            const hour = hourOf(gain.t);
            const key = gainKey(bot.name, jobKey, hour, itemKey);
            const prev = gainCounts.get(key);
            gainCounts.set(key, { item: prev?.item ?? item, count: (prev?.count ?? 0) + gain.count! });
            const items = itemsByJob.get(jobKey) ?? new Map<string, string>();
            if (!items.has(itemKey)) items.set(itemKey, item);
            itemsByJob.set(jobKey, items);
        }
    }

    const pointsByJobItem = new Map<string, CharacterHour[]>();
    for (const [key, times] of presence) {
        const presenceMsValue = presenceMs(times);
        if (presenceMsValue < MIN_PRESENCE_MS) continue;
        const [name, jobKey, hour] = key.split('\0') as [string, string, string];
        const items = itemsByJob.get(jobKey);
        if (!items) continue;
        for (const [itemKey, display] of items) {
            const gained = gainCounts.get(gainKey(name, jobKey, hour, itemKey));
            const count = gained?.count ?? 0;
            const point: CharacterHour = {
                name,
                jobKey,
                item: gained?.item ?? display,
                hour,
                presenceMs: presenceMsValue,
                count,
                perHour: count / (presenceMsValue / 3_600_000),
            };
            const bucket = `${jobKey}\0${itemKey}`;
            const list = pointsByJobItem.get(bucket) ?? [];
            list.push(point);
            pointsByJobItem.set(bucket, list);
        }
    }

    const jobs: JobYield[] = [];
    const jobKeys = [...itemsByJob.keys()].sort();
    for (const jobKey of jobKeys) {
        const items: ItemYield[] = [];
        for (const [itemKey, display] of [...(itemsByJob.get(jobKey)?.entries() ?? [])].sort((a, b) =>
            a[1].localeCompare(b[1])
        )) {
            const points = (pointsByJobItem.get(`${jobKey}\0${itemKey}`) ?? []).sort((a, b) =>
                a.hour === b.hour ? a.name.localeCompare(b.name) : a.hour.localeCompare(b.hour)
            );
            if (points.length === 0) continue;
            const byName = new Map<string, number[]>();
            for (const point of points) {
                const rates = byName.get(point.name) ?? [];
                rates.push(point.perHour);
                byName.set(point.name, rates);
            }
            items.push({
                item: points[0]?.item ?? display,
                median: medianOf(points.map((point) => point.perHour))!,
                points,
                byCharacter: [...byName.entries()]
                    .sort((a, b) => a[0].localeCompare(b[0]))
                    .map(([name, rates]) => ({ name, median: medianOf(rates)!, hours: rates.length })),
            });
        }
        if (items.length === 0) continue;
        jobs.push({
            jobKey,
            drift: (driftByJob.get(jobKey) ?? []).sort((a, b) => a.name.localeCompare(b.name)),
            items,
        });
    }

    const rosterKeys = [...new Set(input.bots.map((bot) => bot.rosterJobKey))].sort();
    const seen = new Set(jobs.map((job) => job.jobKey));
    return {
        windowMs,
        jobs,
        noSamples: rosterKeys.filter((key) => !seen.has(key)),
    };
}
