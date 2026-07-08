// tests/shell/tauri-fs-ops.test.ts
import { describe, it, expect, vi } from 'vitest';

// Mock the Tauri plugin so createTauriFsOps' dynamic import resolves here.
// What matters is the OPTIONS each wrapper passes through — the fresh-install
// bug was mkdir without recursive:true against an app-data dir Tauri never
// auto-creates (v2 plugin-fs docs: app dirs "must be manually created by the
// application at runtime").
const calls: Record<string, unknown[]> = {};
vi.mock('@tauri-apps/plugin-fs', () => {
  const record = (name: string) =>
    (...args: unknown[]) => { calls[name] = args; return Promise.resolve(undefined); };
  return {
    exists: record('exists'),
    mkdir: record('mkdir'),
    readDir: record('readDir'),
    readTextFile: record('readTextFile'),
    writeTextFile: record('writeTextFile'),
    remove: record('remove'),
    BaseDirectory: { AppData: 12 },
  };
});

import { createTauriFsOps } from '../../src/shell/tauri-fs-ops.js';

describe('createTauriFsOps — options passed to the real plugin', () => {
  it('mkdir creates missing parents (recursive) inside AppData', async () => {
    const ops = await createTauriFsOps();
    await ops.mkdir('saves');
    expect(calls.mkdir).toEqual(['saves', { baseDir: 12, recursive: true }]);
  });

  it('every op resolves against BaseDirectory.AppData', async () => {
    const ops = await createTauriFsOps();
    await ops.exists('saves');
    await ops.writeTextFile('saves/1.json', '{}');
    expect(calls.exists?.[1]).toEqual({ baseDir: 12 });
    expect(calls.writeTextFile?.[2]).toEqual({ baseDir: 12 });
  });
});
