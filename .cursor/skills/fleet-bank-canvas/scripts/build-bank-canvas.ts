#!/usr/bin/env bun

import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'fs';
import { homedir, tmpdir } from 'os';
import { join } from 'path';
import { appendHourlyBankStock } from '../../../../sdk/bank-stock';
import { BotSDK, deriveGatewayUrl } from '../../../../sdk/index';
import type { BankItem, BotWorldState } from '../../../../sdk/types';
import { rosterBots, ROOT } from '../../wake-fleet/scripts/roster';

type BankSnapshot = {
    name: string;
    view: string;
    capturedAt: string;
    items: BankItem[];
};

type SnapshotStore = {
    version: 1;
    accounts: Record<string, BankSnapshot>;
};

type Observation = {
    name: string;
    captured: boolean;
    error: string | null;
};

type ItemHolding = {
    account: string;
    view: string;
    count: number;
    capturedAt: string;
};

type CombinedItem = {
    id: number;
    name: string;
    unitValue: number;
    holdings: ItemHolding[];
    atlasIndex: number;
};

const DEFAULT_WAIT_SECONDS = 180;
const STALE_AFTER_MS = 24 * 60 * 60 * 1000;

function parseNameSet(raw: string): Set<string> {
    return new Set(
        raw
            .split(',')
            .map((name) => name.trim().toLowerCase())
            .filter(Boolean)
    );
}

function parseArgs(argv: string[]) {
    let waitSeconds = DEFAULT_WAIT_SECONDS;
    let selectedNames: Set<string> | null = null;
    let exceptNames: Set<string> | null = null;
    let noIcons = false;

    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === '--wait-seconds') {
            const value = Number(argv[++i]);
            if (!Number.isFinite(value) || value < 0) throw new Error('--wait-seconds must be zero or greater');
            waitSeconds = value;
        } else if (arg === '--bots') {
            selectedNames = parseNameSet(argv[++i] || '');
        } else if (arg === '--except') {
            exceptNames = parseNameSet(argv[++i] || '');
        } else if (arg === '--no-icons') {
            noIcons = true;
        } else if (arg === '--help') {
            console.log(`Usage: bun ${process.argv[1]} [options]

Options:
  --wait-seconds N   Observe normal bank openings for N seconds (default: ${DEFAULT_WAIT_SECONDS})
  --bots a,b,c       Refresh only these roster accounts
  --except a,b       Omit these accounts from observe + combined totals
  --no-icons         Skip sprite rendering
  --help             Show this help`);
            process.exit(0);
        } else {
            throw new Error(`Unknown option: ${arg}`);
        }
    }

    return { waitSeconds, selectedNames, exceptNames, noIcons };
}

function projectDirectory(): string {
    const workspaceKey = ROOT.replace(/^\/+/, '').replaceAll('/', '-');
    return join(homedir(), '.cursor', 'projects', workspaceKey);
}

function loadStore(path: string): SnapshotStore {
    if (!existsSync(path)) return { version: 1, accounts: {} };
    try {
        const parsed = JSON.parse(readFileSync(path, 'utf8')) as SnapshotStore;
        return parsed.version === 1 && parsed.accounts ? parsed : { version: 1, accounts: {} };
    } catch {
        return { version: 1, accounts: {} };
    }
}

function loadEnv(name: string): Record<string, string> {
    const envPath = join(ROOT, 'bots', name, 'bot.env');
    const env: Record<string, string> = {};
    if (!existsSync(envPath)) return env;
    for (const line of readFileSync(envPath, 'utf8').split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const equals = trimmed.indexOf('=');
        if (equals > 0) env[trimmed.slice(0, equals).trim()] = trimmed.slice(equals + 1).trim();
    }
    return env;
}

function completeBank(state: BotWorldState | null): BankItem[] | null {
    if (!state?.bank?.isOpen) return null;
    return state.bank.items.map((item) => ({ ...item }));
}

async function observeBank(
    rosterEntry: { name: string; view: string },
    waitMs: number,
    store: SnapshotStore
): Promise<Observation> {
    const env = loadEnv(rosterEntry.name);
    const sdk = new BotSDK({
        botUsername: env.BOT_USERNAME || rosterEntry.name,
        password: env.PASSWORD || '',
        gatewayUrl: env.GATEWAY_URL || deriveGatewayUrl(env.SERVER || 'rs-sdk-demo.fly.dev'),
        connectionMode: 'observe',
        autoReconnect: false,
        autoLaunchBrowser: false,
        readyTimeout: 0,
        connectTimeout: 8000
    });

    let unsubscribe: (() => void) | null = null;
    try {
        await Promise.race([
            sdk.connect(),
            new Promise<never>((_, reject) => setTimeout(() => reject(new Error('connect timeout')), 9000))
        ]);

        const save = (items: BankItem[]) => {
            store.accounts[rosterEntry.name.toLowerCase()] = {
                name: rosterEntry.name,
                view: rosterEntry.view,
                capturedAt: new Date().toISOString(),
                items
            };
            appendHourlyBankStock(
                rosterEntry.name,
                items.map((item) => ({ id: item.id, name: item.name, count: item.count })),
                Date.now()
            );
        };

        const initial = completeBank(sdk.getState());
        if (initial) {
            save(initial);
            return { name: rosterEntry.name, captured: true, error: null };
        }
        if (waitMs === 0) return { name: rosterEntry.name, captured: false, error: null };

        const items = await new Promise<BankItem[] | null>((resolve) => {
            const timer = setTimeout(() => {
                unsubscribe?.();
                resolve(null);
            }, waitMs);
            unsubscribe = sdk.onStateUpdate((state) => {
                const bank = completeBank(state);
                if (!bank) return;
                clearTimeout(timer);
                unsubscribe?.();
                resolve(bank);
            });
        });
        if (items) save(items);
        return { name: rosterEntry.name, captured: items !== null, error: null };
    } catch (error) {
        return {
            name: rosterEntry.name,
            captured: false,
            error: error instanceof Error ? error.message : String(error)
        };
    } finally {
        unsubscribe?.();
        try {
            sdk.disconnect();
        } catch {
            // Ignore disconnect cleanup.
        }
    }
}

function filesWithExtension(directory: string, extension: string): string[] {
    const output: string[] = [];
    const walk = (current: string) => {
        for (const entry of readdirSync(current, { withFileTypes: true })) {
            const path = join(current, entry.name);
            if (entry.isDirectory()) walk(path);
            else if (entry.name.endsWith(extension)) output.push(path);
        }
    };
    walk(directory);
    return output;
}

function itemCostsById(): Map<number, number> {
    const scripts = join(ROOT, 'server', 'content', 'scripts');
    const basePath = join(scripts, '_unpack', '225', 'all.obj');
    const costs = new Map<string, number>();
    const files = [basePath, ...filesWithExtension(scripts, '.obj').filter((path) => path !== basePath).sort()];

    for (const path of files) {
        let config = '';
        for (const rawLine of readFileSync(path, 'utf8').split('\n')) {
            const line = rawLine.trim();
            const section = line.match(/^\[([^\]]+)\]$/);
            if (section) {
                config = section[1];
                continue;
            }
            if (config && line.startsWith('cost=')) {
                const cost = Number.parseInt(line.slice(5), 10);
                if (Number.isFinite(cost)) costs.set(config, cost);
            }
        }
    }

    const byId = new Map<number, number>();
    const symbols = join(ROOT, 'server', 'engine', 'data', 'symbols', 'obj.sym');
    for (const line of readFileSync(symbols, 'utf8').split('\n')) {
        const [rawId, config] = line.trim().split(/\s+/, 2);
        const id = Number.parseInt(rawId, 10);
        if (Number.isInteger(id) && config) byId.set(id, costs.get(config) ?? 1);
    }
    return byId;
}

function combineItems(snapshots: BankSnapshot[], costs: Map<number, number>): CombinedItem[] {
    const items = new Map<number, Omit<CombinedItem, 'atlasIndex'>>();
    for (const snapshot of snapshots) {
        for (const item of snapshot.items) {
            if (item.count <= 0) continue;
            const combined = items.get(item.id) || {
                id: item.id,
                name: item.name,
                unitValue: costs.get(item.id) ?? 1,
                holdings: []
            };
            combined.holdings.push({
                account: snapshot.name,
                view: snapshot.view,
                count: item.count,
                capturedAt: snapshot.capturedAt
            });
            items.set(item.id, combined);
        }
    }

    return [...items.values()]
        .sort((a, b) => {
            const aCount = a.holdings.reduce((sum, holding) => sum + holding.count, 0);
            const bCount = b.holdings.reduce((sum, holding) => sum + holding.count, 0);
            return b.unitValue * bCount - a.unitValue * aCount || a.name.localeCompare(b.name);
        })
        .map((item, atlasIndex) => ({ ...item, atlasIndex }));
}

function serverBase(): string {
    const firstBot = rosterBots()[0];
    const server = firstBot ? loadEnv(firstBot.name).SERVER || 'rs-sdk-demo.fly.dev' : 'rs-sdk-demo.fly.dev';
    if (/^https?:\/\//.test(server)) return server.replace(/\/+$/, '');
    return `${server.startsWith('localhost') || server.startsWith('127.') ? 'http' : 'https'}://${server}`;
}

async function renderAtlas(ids: number[]): Promise<{ dataUrl: string; failed: number[] }> {
    if (ids.length === 0) return { dataUrl: '', failed: [] };
    const directory = mkdtempSync(join(tmpdir(), 'fleet-bank-icons-'));
    const requestPath = join(directory, 'request.json');
    const resultPath = join(directory, 'result.json');
    writeFileSync(requestPath, JSON.stringify({ ids, serverBase: serverBase() }));
    try {
        const helper = join(import.meta.dir, 'render-atlas.mjs');
        const process = Bun.spawn(['node', helper, requestPath, resultPath], {
            stdout: 'inherit',
            stderr: 'inherit'
        });
        const exitCode = await process.exited;
        if (exitCode !== 0) throw new Error(`Icon renderer exited with code ${exitCode}`);
        return JSON.parse(readFileSync(resultPath, 'utf8')) as { dataUrl: string; failed: number[] };
    } finally {
        rmSync(directory, { recursive: true, force: true });
    }
}

function jsonForSource(value: unknown): string {
    return JSON.stringify(value).replaceAll('<', '\\u003c');
}

function canvasSource(
    items: CombinedItem[],
    snapshots: BankSnapshot[],
    roster: { name: string; view: string }[],
    atlas: string,
    generatedAt: string
): string {
    const accountRows = roster.map((entry) => {
        const snapshot = snapshots.find((candidate) => candidate.name.toLowerCase() === entry.name.toLowerCase());
        return {
            name: entry.name,
            view: entry.view,
            capturedAt: snapshot?.capturedAt ?? null,
            itemSlots: snapshot?.items.length ?? null
        };
    });

    return `import {
    Card,
    CardBody,
    CardHeader,
    Grid,
    H1,
    Pill,
    Row,
    Select,
    Stack,
    Stat,
    Text,
    TextInput,
    useCanvasState,
    useHostTheme,
    useMemo,
    useState
} from "cursor/canvas";

const ITEMS = ${jsonForSource(items)};
const ACCOUNTS = ${jsonForSource(accountRows)};
const ATLAS = ${jsonForSource(atlas)};
const GENERATED_AT = ${jsonForSource(generatedAt)};
const ATLAS_COLUMNS = 16;
const STALE_AFTER_MS = ${STALE_AFTER_MS};

function compact(value: number) {
    return new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(value);
}

function full(value: number) {
    return new Intl.NumberFormat("en").format(value);
}

function formatAge(ms: number) {
    if (ms < 60_000) return "just now";
    const minutes = Math.floor(ms / 60_000);
    if (minutes < 60) return minutes + "m ago";
    const hours = Math.floor(minutes / 60);
    const remMin = minutes % 60;
    if (hours < 48) return remMin ? hours + "h " + remMin + "m ago" : hours + "h ago";
    const days = Math.floor(hours / 24);
    const remHours = hours % 24;
    return remHours ? days + "d " + remHours + "h ago" : days + "d ago";
}

export default function FleetBank() {
    const theme = useHostTheme();
    const [query, setQuery] = useCanvasState("bank-query", "");
    const [view, setView] = useCanvasState("bank-view", "all");
    const [account, setAccount] = useCanvasState("bank-account", "all");
    const [sort, setSort] = useCanvasState("bank-sort", "value");
    const [hover, setHover] = useState<any>(null);

    const accountOptions = useMemo(() => {
        const names = ACCOUNTS.slice()
            .sort((a, b) => a.name.localeCompare(b.name))
            .map((row) => ({ value: row.name, label: row.name }));
        return [{ value: "all", label: "All accounts" }, ...names];
    }, []);

    const visibleItems = useMemo(() => {
        const needle = query.trim().toLowerCase();
        return ITEMS.map((item) => {
            const holdings = item.holdings.filter((holding) => {
                if (view !== "all" && holding.view !== view) return false;
                if (account !== "all" && holding.account.toLowerCase() !== account.toLowerCase()) return false;
                return true;
            });
            const count = holdings.reduce((sum, holding) => sum + holding.count, 0);
            const newest = holdings.reduce((max, holding) => {
                const at = new Date(holding.capturedAt).getTime();
                return Number.isFinite(at) && at > max ? at : max;
            }, 0);
            return { ...item, holdings, count, value: count * item.unitValue, newest };
        })
            .filter((item) => item.count > 0 && (!needle || item.name.toLowerCase().includes(needle)))
            .sort((a, b) => {
                if (sort === "name") return a.name.localeCompare(b.name);
                if (sort === "quantity") return b.count - a.count || a.name.localeCompare(b.name);
                if (sort === "freshness") return b.newest - a.newest || a.name.localeCompare(b.name);
                return b.value - a.value || a.name.localeCompare(b.name);
            });
    }, [query, view, account, sort]);

    const visibleAccounts = ACCOUNTS.filter((row) => {
        if (view !== "all" && row.view !== view) return false;
        if (account !== "all" && row.name.toLowerCase() !== account.toLowerCase()) return false;
        return true;
    });
    const capturedAccounts = visibleAccounts.filter((account) => account.capturedAt);
    const totalCount = visibleItems.reduce((sum, item) => sum + item.count, 0);
    const totalValue = visibleItems.reduce((sum, item) => sum + item.value, 0);

    return (
        <Stack gap={18} style={{ padding: 20, maxWidth: 1100, margin: "0 auto" }}>
            <div>
                <H1>Combined RuneScape bank</H1>
                <Text tone="secondary">
                    Bank-only snapshot across {capturedAccounts.length} of {visibleAccounts.length} accounts
                </Text>
            </div>

            <Grid columns={4} gap={10}>
                <Stat label="Base value" value={compact(totalValue) + " gp"} />
                <Stat label="Item quantity" value={compact(totalCount)} />
                <Stat label="Distinct items" value={full(visibleItems.length)} />
                <Stat label="Coverage" value={capturedAccounts.length + " / " + visibleAccounts.length} />
            </Grid>

            <Row gap={10} wrap>
                <TextInput
                    type="search"
                    value={query}
                    onChange={setQuery}
                    placeholder="Search bank items"
                    style={{ minWidth: 230 }}
                />
                <Select
                    value={view}
                    onChange={setView}
                    options={[
                        { value: "all", label: "All groups" },
                        { value: "fleet", label: "Fleet" },
                        { value: "loves", label: "Loves" },
                        { value: "army", label: "Army" }
                    ]}
                />
                <Select value={account} onChange={setAccount} options={accountOptions} />
                <Select
                    value={sort}
                    onChange={setSort}
                    options={[
                        { value: "value", label: "Sort by value" },
                        { value: "quantity", label: "Sort by quantity" },
                        { value: "freshness", label: "Sort by freshness" },
                        { value: "name", label: "Sort by name" }
                    ]}
                />
            </Row>

            <div
                style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fill, minmax(54px, 1fr))",
                    gap: 6,
                    padding: 12,
                    border: "1px solid " + theme.stroke.secondary,
                    borderRadius: 8,
                    background: theme.fill.quaternary
                }}
            >
                {visibleItems.map((item) => (
                    <div
                        key={item.id}
                        onMouseEnter={(event) => setHover({ item, x: event.clientX, y: event.clientY })}
                        onMouseMove={(event) => setHover({ item, x: event.clientX, y: event.clientY })}
                        onMouseLeave={() => setHover(null)}
                        style={{
                            minHeight: 52,
                            position: "relative",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            borderRadius: 6,
                            background: theme.bg.elevated,
                            border: "1px solid " + theme.stroke.tertiary,
                            cursor: "default"
                        }}
                    >
                        {ATLAS ? (
                            <div
                                aria-label={item.name}
                                style={{
                                    width: 32,
                                    height: 32,
                                    imageRendering: "pixelated",
                                    backgroundImage: "url(" + ATLAS + ")",
                                    backgroundRepeat: "no-repeat",
                                    backgroundPosition:
                                        "-" + ((item.atlasIndex % ATLAS_COLUMNS) * 32) + "px -" +
                                        (Math.floor(item.atlasIndex / ATLAS_COLUMNS) * 32) + "px"
                                }}
                            />
                        ) : (
                            <Text style={{ fontSize: 9, textAlign: "center" }}>{item.name}</Text>
                        )}
                        <span
                            style={{
                                position: "absolute",
                                right: 3,
                                bottom: 1,
                                color: theme.accent.primary,
                                fontSize: 10,
                                fontWeight: 700
                            }}
                        >
                            {compact(item.count)}
                        </span>
                    </div>
                ))}
            </div>

            {hover && (
                <div
                    style={{
                        position: "fixed",
                        left: Math.min(hover.x + 14, window.innerWidth - 280),
                        top: Math.min(hover.y + 14, window.innerHeight - 260),
                        zIndex: 100,
                        width: 260,
                        padding: 12,
                        borderRadius: 8,
                        border: "1px solid " + theme.stroke.primary,
                        background: theme.bg.elevated,
                        color: theme.text.primary,
                        pointerEvents: "none"
                    }}
                >
                    <Stack gap={7}>
                        <div>
                            <Text weight="semibold">{hover.item.name}</Text>
                            <Text tone="secondary">
                                {full(hover.item.count)} total · {full(hover.item.value)} gp
                            </Text>
                        </div>
                        <div style={{ borderTop: "1px solid " + theme.stroke.tertiary, paddingTop: 6 }}>
                            {hover.item.holdings
                                .slice()
                                .sort((a, b) => b.count - a.count)
                                .map((holding) => (
                                    <Row key={holding.account} justify="space-between" gap={8}>
                                        <Text>{holding.account}</Text>
                                        <Text weight="semibold">{full(holding.count)}</Text>
                                    </Row>
                                ))}
                        </div>
                        <Text tone="tertiary">Base value: {full(hover.item.unitValue)} gp each</Text>
                    </Stack>
                </div>
            )}

            <Card collapsible defaultOpen>
                <CardHeader trailing={<Pill>{capturedAccounts.length + " captured"}</Pill>}>
                    Account snapshot freshness
                </CardHeader>
                <CardBody>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 10 }}>
                        {visibleAccounts
                            .slice()
                            .sort((a, b) => {
                                if (!a.capturedAt && !b.capturedAt) return a.name.localeCompare(b.name);
                                if (!a.capturedAt) return 1;
                                if (!b.capturedAt) return -1;
                                return new Date(b.capturedAt).getTime() - new Date(a.capturedAt).getTime();
                            })
                            .map((row) => {
                            const age = row.capturedAt ? Date.now() - new Date(row.capturedAt).getTime() : null;
                            const status = age === null ? "Missing" : age > STALE_AFTER_MS ? "Stale" : "Fresh";
                            const ageLabel = age === null ? "never captured" : formatAge(age);
                            const capturedWhen = row.capturedAt
                                ? new Date(row.capturedAt).toLocaleString()
                                : null;
                            const selected = account !== "all" && account.toLowerCase() === row.name.toLowerCase();
                            return (
                                <div
                                    key={row.name}
                                    onClick={() => setAccount(selected ? "all" : row.name)}
                                    style={{
                                        cursor: "pointer",
                                        padding: 6,
                                        borderRadius: 6,
                                        border: selected ? "1px solid " + theme.stroke.primary : "1px solid transparent"
                                    }}
                                >
                                    <Stack gap={2}>
                                        <Row justify="space-between" gap={8}>
                                            <Text weight="semibold">{row.name}</Text>
                                            <Text tone={status === "Fresh" ? "secondary" : "tertiary"}>{ageLabel}</Text>
                                        </Row>
                                        <Text tone="tertiary">
                                            {status}
                                            {row.itemSlots === null ? "" : " · " + row.itemSlots + " slots"}
                                            {capturedWhen ? " · " + capturedWhen : ""}
                                        </Text>
                                    </Stack>
                                </div>
                            );
                        })}
                    </div>
                </CardBody>
            </Card>

            <Text tone="tertiary">
                Generated {new Date(GENERATED_AT).toLocaleString()} · Values are ObjType base values, not market prices.
            </Text>
        </Stack>
    );
}
`;
}

async function main() {
    const { waitSeconds, selectedNames, exceptNames, noIcons } = parseArgs(process.argv.slice(2));
    const roster = rosterBots()
        .filter((bot) => !exceptNames?.has(bot.name.toLowerCase()))
        .map((bot) => ({ name: bot.name, view: bot.view }));
    const selected = selectedNames
        ? roster.filter((bot) => selectedNames.has(bot.name.toLowerCase()))
        : roster;
    if (selectedNames && selected.length !== selectedNames.size) {
        const found = new Set(selected.map((bot) => bot.name.toLowerCase()));
        const missing = [...selectedNames].filter((name) => !found.has(name));
        throw new Error(`Not in roster: ${missing.join(', ')}`);
    }

    const projectDir = projectDirectory();
    const snapshotPath = join(projectDir, 'fleet-bank-snapshots.json');
    const canvasPath = join(projectDir, 'canvases', 'fleet-bank.canvas.tsx');
    const store = loadStore(snapshotPath);

    for (const bot of roster) {
        const cached = store.accounts[bot.name.toLowerCase()];
        if (cached) {
            cached.name = bot.name;
            cached.view = bot.view;
        }
    }

    console.error(
        `[fleet-bank] Observing ${selected.length} account(s) for up to ${waitSeconds}s; control connections are never used`
    );
    const waitMs = waitSeconds * 1000;
    const observations = await Promise.all(
        selected.map(async (bot, index) => {
            if (index > 0) await Bun.sleep(Math.min(index * 100, 5000));
            const result = await observeBank(bot, waitMs, store);
            const detail = result.error ? `error: ${result.error}` : result.captured ? 'captured' : 'not opened';
            console.error(`[fleet-bank] ${result.name}: ${detail}`);
            return result;
        })
    );

    writeFileSync(snapshotPath, `${JSON.stringify(store, null, 2)}\n`);

    const snapshots = roster
        .map((bot) => store.accounts[bot.name.toLowerCase()])
        .filter((snapshot): snapshot is BankSnapshot => Boolean(snapshot));
    if (snapshots.length === 0) {
        throw new Error('No bank snapshots yet. Keep normal fleet jobs running and retry with a longer --wait-seconds.');
    }

    const items = combineItems(snapshots, itemCostsById());
    let atlas = '';
    let iconFailure: string | null = null;
    if (!noIcons) {
        try {
            console.error(`[fleet-bank] Rendering ${items.length} item icon(s) from ${serverBase()}`);
            const rendered = await renderAtlas(items.map((item) => item.id));
            atlas = rendered.dataUrl;
            if (rendered.failed.length) iconFailure = `${rendered.failed.length} icon(s) could not be rendered`;
        } catch (error) {
            iconFailure = error instanceof Error ? error.message : String(error);
        }
    }

    const generatedAt = new Date().toISOString();
    writeFileSync(canvasPath, canvasSource(items, snapshots, roster, atlas, generatedAt));

    const stale = snapshots.filter((snapshot) => Date.now() - new Date(snapshot.capturedAt).getTime() > STALE_AFTER_MS);
    const missing = roster.filter((bot) => !store.accounts[bot.name.toLowerCase()]);
    const report = {
        canvasPath,
        snapshotPath,
        rosterAccounts: roster.length,
        capturedAccounts: snapshots.length,
        refreshedAccounts: observations.filter((result) => result.captured).map((result) => result.name),
        staleAccounts: stale.map((snapshot) => snapshot.name),
        missingAccounts: missing.map((bot) => bot.name),
        distinctItems: items.length,
        iconFailure
    };
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

await main();
