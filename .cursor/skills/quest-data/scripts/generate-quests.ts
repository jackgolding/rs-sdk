#!/usr/bin/env bun
/**
 * Wrapper: run wiki/generate-quests.ts from repo root.
 *
 *   bun .cursor/skills/quest-data/scripts/generate-quests.ts
 */

import { join } from 'path';

const repoRoot = join(import.meta.dir, '..', '..', '..', '..');
const generator = join(repoRoot, 'wiki', 'generate-quests.ts');

const proc = Bun.spawn(['bun', generator], {
    cwd: repoRoot,
    stdout: 'inherit',
    stderr: 'inherit',
});

const code = await proc.exited;
if (code !== 0) process.exit(code);
