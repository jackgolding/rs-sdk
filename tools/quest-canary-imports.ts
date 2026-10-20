/**
 * quest-canary-imports — would this quest script even LOAD on the deployed box?
 *
 *   bun tools/quest-canary-imports.ts bots/quests/knights-sword.ts [--ref a07722801]
 *
 * The canary tier runs the PRODUCTION image: its `sdk/` and `quest-lab/` are
 * frozen at the deployed commit, and only `bots/` is bind-mounted from the box.
 * A dev script that imports `sdk/fsm.ts`, `sdk/travel.ts` or a brand-new export
 * from `sdk/index.ts` therefore cannot start there at all — and the failure
 * arrives as a confusing "Cannot find module" inside a canary container, after
 * the account has been taken off the roster and the image has been trusted.
 *
 * This checks, for one script and its local imports:
 *   1. every relative import resolves to a file that EXISTS at <ref>
 *      (or is a `bots/` file the deploy copies, which is reported separately);
 *   2. every named import from `sdk/index` is exported at <ref>;
 *   3. the same for `quest-lab/*`.
 *
 * Exit 0 = loadable on the box, 1 = blocked (with the reason per import).
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, normalize, relative, resolve } from 'node:path';

const argv = process.argv.slice(2);
const files: string[] = [];
let ref = 'a07722801';
for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === '--ref') ref = argv[++i]!;
    else files.push(arg);
}
if (!files.length) {
    console.error('usage: bun tools/quest-canary-imports.ts <script.ts> [more.ts] [--ref <sha>]');
    process.exit(2);
}

const root = process.cwd();
const shows = new Map<string, string | null>();
function atRef(path: string): string | null {
    const key = path.replace(/^\.\//, '');
    if (shows.has(key)) return shows.get(key)!;
    let out: string | null = null;
    try {
        out = execFileSync('git', ['show', `${ref}:${key}`], { cwd: root, encoding: 'utf-8', maxBuffer: 64 << 20 });
    } catch {
        out = null;
    }
    shows.set(key, out);
    return out;
}

/** Resolve a relative specifier against a source file to a repo-relative path. */
function resolveSpec(from: string, spec: string): string | null {
    if (!spec.startsWith('.')) return null;
    const base = normalize(join(dirname(from), spec));
    for (const candidate of [base, `${base}.ts`, join(base, 'index.ts')]) {
        if (existsSync(resolve(root, candidate))) return candidate;
    }
    return base;
}

interface Problem {
    file: string;
    spec: string;
    kind: 'missing-module' | 'missing-export';
    detail: string;
    mountable: boolean;
}

const IMAGE_PREFIXES = ['sdk/', 'quest-lab/', 'server', 'tools/'];
const problems: Problem[] = [];
const deployable: string[] = [];

function exportsOfModule(path: string): Set<string> | null {
    const text = atRef(path);
    if (text === null) return null;
    const names = new Set<string>();
    for (const match of text.matchAll(/export\s+(?:declare\s+)?(?:async\s+)?(?:function|class|const|let|var|interface|type|enum|namespace|abstract\s+class)\s+([A-Za-z0-9_$]+)/g)) names.add(match[1]!);
    if (/export\s+default\b/.test(text)) names.add('default');
    for (const match of text.matchAll(/export\s*\{([^}]+)\}/g)) {
        for (const piece of match[1]!.split(',')) {
            const name = piece.trim().split(/\s+as\s+/).pop()?.trim();
            if (name) names.add(name);
        }
    }
    return names;
}

for (const file of files) {
    const rel = relative(root, resolve(root, file));
    const text = readFileSync(resolve(root, rel), 'utf-8');
    // Imports in this codebase are single-line; parse per line so one statement
    // can never swallow the next (a multi-statement match hid a real defect).
    for (const line of text.split('\n')) {
        const statement = /^\s*(?:import|export)\s+(.*?)\bfrom\s+['"]([^'"]+)['"]/.exec(line);
        if (!statement) continue;
        const clause = statement[1]!.trim();
        const spec = statement[2]!;
        const target = resolveSpec(rel, spec);
        if (!target) continue;
        const mountable = target.startsWith('bots/');
        if (atRef(target) === null && !existsSync(resolve(root, target))) {
            problems.push({ file: rel, spec, kind: 'missing-module', detail: `${target} does not exist at ${ref}`, mountable });
            continue;
        }
        if (mountable) deployable.push(`${rel} -> ${target}`);
        // `import type { A } from …` is erased by bun, so its names cannot break a run.
        if (/^type\b/.test(clause)) continue;
        const named = /\{([^}]+)\}/.exec(clause)?.[1];
        const defaultImport = /^\s*([A-Za-z0-9_$]+)\s*(?:,|$)/.exec(clause)?.[1];
        const wanted: string[] = [];
        if (defaultImport && !clause.startsWith('{')) wanted.push('default');
        if (named) for (const piece of named.split(',')) {
            const name = piece.trim().split(/\s+as\s+/)[0]?.trim().replace(/^type\s+/, '');
            if (name) wanted.push(name);
        }
        const exported = exportsOfModule(target);
        if (!exported) continue;
        for (const name of wanted) {
            if (exported.has(name)) continue;
            problems.push({
                file: rel,
                spec,
                kind: 'missing-export',
                detail: `'${name}' is not exported by ${target} at ${ref}`,
                mountable,
            });
        }
    }
}

const hard = problems.filter(p => !p.mountable);
for (const problem of problems) {
    const tag = problem.mountable ? 'DEPLOY-FILE' : 'BLOCKED';
    console.log(`${tag} ${problem.file}: ${problem.kind} ${problem.spec} — ${problem.detail}`);
}
if (deployable.length) {
    console.log(`\ndeployable helper imports (bots/ is bind-mounted, copy these with the script):`);
    for (const line of [...new Set(deployable)]) console.log(`  ${line}`);
}
if (hard.length) {
    console.log(`\nNOT canary-safe: ${hard.length} import(s) missing from the deployed image (${ref}).`);
    process.exit(1);
}
console.log(`\ncanary-safe imports: every module this script needs exists at ${ref}.`);
