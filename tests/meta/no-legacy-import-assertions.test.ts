import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

// Invariant: no import may use the legacy `assert { ... }` attribute clause.
// V8 removed import assertions and Firefox never shipped them, so any module
// served with the clause intact kills the whole graph with a SyntaxError
// (blank page). Vite's build and vitest's transform both mask the clause,
// which is why only the dev-serve path exposes it — a test that greps the
// source is the only cheap net. Use `with { ... }` instead.
const LEGACY_ASSERT = /\bfrom\s+['"][^'"]+['"]\s*assert\s*\{/;

const CODE_EXTENSIONS = /\.(ts|tsx|js|mjs|cjs)$/;

const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
const SELF = join('tests', 'meta', 'no-legacy-import-assertions.test.ts');

function trackedCodeFiles(): string[] {
  return execFileSync('git', ['ls-files'], { cwd: repoRoot, encoding: 'utf8' })
    .split('\n')
    .filter(Boolean)
    .filter((f) => CODE_EXTENSIONS.test(f))
    .filter((f) => f !== SELF);
}

describe('import attribute syntax invariant', () => {
  it('no tracked code file uses a legacy `assert { ... }` import clause', () => {
    const offenders: string[] = [];
    for (const rel of trackedCodeFiles()) {
      let content: string;
      try {
        content = readFileSync(join(repoRoot, rel), 'utf8');
      } catch {
        continue; // unreadable — skip
      }
      content.split('\n').forEach((line, i) => {
        if (LEGACY_ASSERT.test(line)) {
          offenders.push(`${rel}:${i + 1}: ${line.trim().slice(0, 100)}`);
        }
      });
    }
    expect(
      offenders,
      `Legacy import assertions break in every browser — use \`with { type: '...' }\`. Offenders:\n${offenders.join('\n')}`,
    ).toEqual([]);
  });
});
