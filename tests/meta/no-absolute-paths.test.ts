import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

// Invariant: no tracked file may contain an absolute home-directory path.
// Absolute paths break when the repo moves AND leak the author's local file
// structure — everything must resolve relative to the project root.
//
// Forbidden patterns are assembled at runtime so this guard never trips on
// itself.
const FORBIDDEN: RegExp[] = [
  new RegExp(['', 'Users', ''].join('/')), // macOS: /Users/
  new RegExp(['', 'home', '\\w'].join('/')), // Linux: /home/<user>
];

const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
const SELF = join('tests', 'meta', 'no-absolute-paths.test.ts');
const NUL = String.fromCharCode(0); // null byte — marks a binary file

function trackedFiles(): string[] {
  return execFileSync('git', ['ls-files'], { cwd: repoRoot, encoding: 'utf8' })
    .split('\n')
    .filter(Boolean)
    .filter((f) => f !== SELF);
}

describe('project-root path invariant', () => {
  it('no tracked file contains an absolute home-directory path', () => {
    const offenders: string[] = [];
    for (const rel of trackedFiles()) {
      let content: string;
      try {
        content = readFileSync(join(repoRoot, rel), 'utf8');
      } catch {
        continue; // unreadable — skip
      }
      if (content.includes(NUL)) continue; // binary file (e.g. the z3) — skip
      content.split('\n').forEach((line, i) => {
        if (FORBIDDEN.some((re) => re.test(line))) {
          offenders.push(`${rel}:${i + 1}: ${line.trim().slice(0, 100)}`);
        }
      });
    }
    expect(
      offenders,
      `Absolute home paths must be repo-relative. Offenders:\n${offenders.join('\n')}`,
    ).toEqual([]);
  });
});
