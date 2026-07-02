/**
 * Known Issues retirement guard (spec §9, §11) — greps the shell source and
 * test tree for any remaining reference to the retired modal, comments
 * included (a dangling comment reference is exactly what a compile-time
 * check would miss).
 */
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';

const BANNED = /buildKnownIssuesDialog|data-open-issues|issuesBtn/;

function grepTree(dir: string): string[] {
  // git grep returns exit 1 on no-match, which execFileSync treats as an
  // error — catch and return empty (no matches is the passing case).
  try {
    const out = execFileSync(
      'git',
      ['grep', '-l', '-E', BANNED.source, '--', dir],
      { encoding: 'utf8' },
    );
    return out.trim().split('\n').filter(Boolean);
  } catch {
    return [];
  }
}

describe('Known Issues modal is fully retired', () => {
  it('no reference to the retired modal survives anywhere in src/', () => {
    expect(grepTree('src')).toEqual([]);
  });

  it('no reference survives anywhere in tests/ (except this guard itself)', () => {
    const hits = grepTree('tests').filter(f => !f.endsWith('known-issues-retired.test.ts'));
    expect(hits).toEqual([]);
  });
});
