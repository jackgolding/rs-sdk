// replay-validate.ts - Live-vs-sim trust metric (Atlas: 1.04 ratio on every metric).
// Record lane metrics as JSON ({ticks, xp, ...}), replay the same scenario in
// the sim, then compare. PASS iff every metric's sim/live ratio is within
// tolerance (default 5%). Always compare logged-in clock, never wall total.
//
// Usage: bun headless/sim/replay-validate.ts live.json sim.json [--tol 0.05]

export interface RunMetrics {
    [k: string]: number;
}

export interface CompareResult {
    metric: string;
    live: number;
    sim: number;
    ratio: number;
    pass: boolean;
}

export function compareRuns(live: RunMetrics, sim: RunMetrics, tol = 0.05): CompareResult[] {
    const out: CompareResult[] = [];
    for (const k of Object.keys(live)) {
        if (!(k in sim)) {
            out.push({ metric: k, live: live[k], sim: NaN, ratio: NaN, pass: false });
            continue;
        }
        const ratio = live[k] === 0 ? (sim[k] === 0 ? 1 : Infinity) : sim[k] / live[k];
        out.push({ metric: k, live: live[k], sim: sim[k], ratio, pass: Math.abs(ratio - 1) <= tol });
    }
    return out;
}

if (import.meta.main) {
    const [livePath, simPath] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
    const tol = Number(process.argv.find((a) => a.startsWith('--tol='))?.split('=')[1] ?? 0.05);
    if (!livePath || !simPath) {
        console.error('usage: bun replay-validate.ts live.json sim.json [--tol 0.05]');
        process.exit(2);
    }
    const live = (await Bun.file(livePath).json()) as RunMetrics;
    const sim = (await Bun.file(simPath).json()) as RunMetrics;
    const rows = compareRuns(live, sim, tol);
    let allPass = true;
    for (const r of rows) {
        console.log(
            `${r.pass ? 'PASS' : 'FAIL'}  ${r.metric}: live=${r.live} sim=${r.sim} ratio=${Number.isFinite(r.ratio) ? r.ratio.toFixed(3) : r.ratio}`
        );
        if (!r.pass) allPass = false;
    }
    process.exit(allPass ? 0 : 1);
}
