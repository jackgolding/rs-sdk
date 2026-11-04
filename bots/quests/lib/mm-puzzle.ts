/**
 * Monkey Madness's hangar reinitialisation board (mm_puzzle.rs2): a 5x5 sliding puzzle, tiles 1..24 in
 * slots 0..23 and the hole in slot 24 when solved. The server shuffles with a 255-step random walk of
 * the hole, so a weighted A* (Manhattan + linear conflict) finds a short solution in milliseconds.
 *
 * board[slot] = tile number (1..24), 0 = the hole. Returns the slots to click in order: each click
 * slides that slot's tile into the adjacent hole ([opheld5,_mm_reinit]).
 */
const N = 5;

function heuristic(b: Uint8Array): number {
    let d = 0;
    for (let s = 0; s < 25; s++) {
        const t = b[s]!;
        if (!t) continue;
        const g = t - 1;
        d += Math.abs((s % N) - (g % N)) + Math.abs(((s / N) | 0) - ((g / N) | 0));
    }
    for (let line = 0; line < N; line++) {
        for (let a = 0; a < N; a++) {
            const ra = b[line * N + a]!;
            if (ra && (((ra - 1) / N) | 0) === line) {
                for (let c = a + 1; c < N; c++) {
                    const rc = b[line * N + c]!;
                    if (rc && (((rc - 1) / N) | 0) === line && rc < ra) d += 2;
                }
            }
            const ca = b[a * N + line]!;
            if (ca && (ca - 1) % N === line) {
                for (let r = a + 1; r < N; r++) {
                    const cr = b[r * N + line]!;
                    if (cr && (cr - 1) % N === line && cr < ca) d += 2;
                }
            }
        }
    }
    return d;
}

export function solvePuzzle(board: number[], weight = 4, maxNodes = 3_000_000): number[] | null {
    const start = Uint8Array.from(board);
    const nodes: Array<{ b: Uint8Array; g: number; hole: number; parent: number; click: number }> = [];
    const f: number[] = [];
    const heap: number[] = [];
    const push = (id: number) => {
        heap.push(id);
        for (let i = heap.length - 1; i > 0; ) {
            const p = (i - 1) >> 1;
            if (f[heap[p]!]! <= f[id]!) break;
            heap[i] = heap[p]!;
            heap[p] = id;
            i = p;
        }
    };
    const pop = (): number => {
        const top = heap[0]!;
        const last = heap.pop()!;
        if (heap.length) {
            let i = 0;
            heap[0] = last;
            for (;;) {
                let c = 2 * i + 1;
                if (c >= heap.length) break;
                if (c + 1 < heap.length && f[heap[c + 1]!]! < f[heap[c]!]!) c++;
                if (f[heap[c]!]! >= f[last]!) break;
                heap[i] = heap[c]!;
                heap[c] = last;
                i = c;
            }
        }
        return top;
    };
    const key = (b: Uint8Array) => String.fromCharCode(...b);
    const best = new Map<string, number>();
    nodes.push({ b: start, g: 0, hole: start.indexOf(0), parent: -1, click: -1 });
    f[0] = weight * heuristic(start);
    best.set(key(start), 0);
    push(0);
    while (heap.length) {
        const id = pop();
        const n = nodes[id]!;
        if (n.hole === 24 && heuristic(n.b) === 0) {
            const out: number[] = [];
            for (let c = id; nodes[c]!.parent >= 0; c = nodes[c]!.parent) out.push(nodes[c]!.click);
            return out.reverse();
        }
        if (nodes.length > maxNodes) return null;
        const hx = n.hole % N;
        const hz = (n.hole / N) | 0;
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
            const x = hx + dx;
            const z = hz + dz;
            if (x < 0 || x >= N || z < 0 || z >= N) continue;
            const s = z * N + x;
            const b = n.b.slice();
            b[n.hole] = b[s]!;
            b[s] = 0;
            const k = key(b);
            const g = n.g + 1;
            const prev = best.get(k);
            if (prev !== undefined && nodes[prev]!.g <= g) continue;
            const nid = nodes.length;
            nodes.push({ b, g, hole: s, parent: id, click: s });
            best.set(k, nid);
            f[nid] = g + weight * heuristic(b);
            push(nid);
        }
    }
    return null;
}

/** The server's shuffle (a random walk of the hole from slot 24), for tests. */
export function shuffled(steps = 255, rnd = Math.random): number[] {
    const b = Array.from({ length: 25 }, (_, i) => (i < 24 ? i + 1 : 0));
    let hole = 24;
    for (let k = 0; k < steps; k++) {
        const x = hole % N;
        const z = (hole / N) | 0;
        const nb: number[] = [];
        if (x > 0) nb.push(hole - 1);
        if (x < 4) nb.push(hole + 1);
        if (z > 0) nb.push(hole - N);
        if (z < 4) nb.push(hole + N);
        const s = nb[Math.floor(rnd() * nb.length)]!;
        b[hole] = b[s]!;
        b[s] = 0;
        hole = s;
    }
    return b;
}

if (import.meta.main) {
    let worst = 0;
    let slowest = 0;
    for (let i = 0; i < 50; i++) {
        const b = shuffled();
        const t0 = performance.now();
        const sol = solvePuzzle(b);
        slowest = Math.max(slowest, performance.now() - t0);
        if (!sol) throw new Error(`no solution for ${b.join(',')}`);
        const c = b.slice();
        for (const s of sol) {
            const hole = c.indexOf(0);
            c[hole] = c[s]!;
            c[s] = 0;
        }
        if (!c.every((v, j) => v === (j < 24 ? j + 1 : 0))) throw new Error(`wrong solution for ${b.join(',')}`);
        worst = Math.max(worst, sol.length);
    }
    console.log(`50 boards solved: worst ${worst} moves, slowest ${slowest.toFixed(0)} ms`);
}
