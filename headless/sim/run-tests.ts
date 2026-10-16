// run-tests.ts - The gate (Atlas: batches of 6, labels OK/FAIL/PANIC/TIMEOUT).
// Usage: bun headless/sim/run-tests.ts [--timeout 30000]
// Exit 0 iff every batch OK. A panicked batch is split in half to isolate.

import { readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const dir = dirname(fileURLToPath(import.meta.url));
const BATCH = 6;
const timeoutMs = Number(process.argv.find((a) => a.startsWith('--timeout='))?.split('=')[1] ?? 30_000);

const files = readdirSync(dir)
    .filter((f) => f.endsWith('.test.ts'))
    .sort()
    .map((f) => join(dir, f));

if (files.length === 0) {
    console.log('sim gate: no test files — OK (nothing to run)');
    process.exit(0);
}

type Label = 'OK' | 'FAIL' | 'PANIC' | 'TIMEOUT';

async function runBatch(batch: string[]): Promise<{ label: Label; out: string }> {
    const proc = Bun.spawn(['bun', 'test', ...batch], {
        stdout: 'pipe',
        stderr: 'pipe'
    });
    const timer = setTimeout(() => {
        try {
            proc.kill();
        } catch { /* already dead */ }
    }, timeoutMs);
    const [stdout, stderr, code] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited
    ]);
    clearTimeout(timer);
    const out = stdout + stderr;
    if (code === null) return { label: 'TIMEOUT', out: out + '\n[killed after timeout]' };
    // Bun reports crashes / segfaults with non-zero + crash text; treat signal-ish exits as PANIC.
    if (/panic|segmentation|Segmentation|SIGSEGV|Segment fault/i.test(out) || code === 139 || code === 134) {
        return { label: 'PANIC', out };
    }
    if (code !== 0 || /\(fail\)/.test(out)) return { label: 'FAIL', out };
    return { label: 'OK', out };
}

let failures = 0;
const queue: string[][] = [];
for (let i = 0; i < files.length; i += BATCH) queue.push(files.slice(i, i + BATCH));

while (queue.length > 0) {
    const batch = queue.shift()!;
    const names = batch.map((f) => f.split('/').pop()).join(' ');
    const { label, out } = await runBatch(batch);
    if (label === 'PANIC' && batch.length > 1) {
        console.log(`PANIC  [${names}] — splitting`);
        const mid = Math.ceil(batch.length / 2);
        queue.unshift(batch.slice(mid), batch.slice(0, mid));
        failures++;
        continue;
    }
    console.log(`${label}  [${names}]`);
    if (label !== 'OK') {
        failures++;
        console.log(out.split('\n').slice(-25).join('\n'));
    }
}

console.log(failures === 0 ? `\nsim gate: ALL OK (${files.length} files)` : `\nsim gate: ${failures} batch(es) not OK`);
process.exit(failures === 0 ? 0 : 1);
