import { describe, it, expect } from 'vitest';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { init, parse } from 'es-module-lexer';

// Invariant: every module the vite dev server serves must parse as valid ES.
// The build and vitest pipelines transform differently from dev-serve, so a
// module only the dev path breaks (e.g. a legacy `assert {}` clause vite 8
// passes through) ships a blank page while everything else stays green.
// This crawls the real dev transform output and parses each module with V8.
const repoRoot = fileURLToPath(new URL('../../', import.meta.url));

// Crawl floor: 90 modules at authoring time. A crawl that visits far fewer
// found a broken crawler, not a smaller app — fail rather than pass silently.
const MODULE_FLOOR = 80;

describe('dev-serve module graph', () => {
  it('every dev-served module parses as valid ES', async () => {
    expect(
      vm.SourceTextModule,
      'vm.SourceTextModule unavailable — vitest must pass --experimental-vm-modules (vitest.config.ts poolOptions)',
    ).toBeTypeOf('function');
    await init;

    const server = await createServer({
      root: repoRoot,
      appType: 'custom',
      server: { middlewareMode: true },
      logLevel: 'silent',
    });
    const failures: string[] = [];
    const seen = new Set<string>();
    const queue = ['/src/main.ts'];
    try {
      while (queue.length) {
        const url = queue.shift()!;
        if (seen.has(url)) continue;
        seen.add(url);
        const result = await server.transformRequest(url);
        if (!result) {
          failures.push(`${url}: transformRequest returned null`);
          continue;
        }
        try {
          // Parse-only: the module is never linked or evaluated.
          new vm.SourceTextModule(result.code, { identifier: url });
        } catch (e) {
          failures.push(`${url}: ${e}`);
          continue;
        }
        let imports: ReturnType<typeof parse>[0];
        try {
          [imports] = parse(result.code, url);
        } catch {
          continue; // lexer stricter than V8 here; the vm parse above is authoritative
        }
        for (const imp of imports) {
          const spec = imp.n;
          if (spec && spec.startsWith('/') && !spec.startsWith('/@')) {
            queue.push(spec);
          }
        }
      }
    } finally {
      await server.close();
    }

    expect(
      failures,
      `dev-served modules failed to parse:\n${failures.join('\n')}`,
    ).toEqual([]);
    expect(
      seen.size,
      `crawl visited only ${seen.size} modules (floor ${MODULE_FLOOR}) — crawler broken?`,
    ).toBeGreaterThanOrEqual(MODULE_FLOOR);
  }, 30_000);
});
