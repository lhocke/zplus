// tests/shell/save-port-fs.test.ts
import { describe, it, expect } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FsOps, FsDirEntry } from '../../src/shell/tauri-fs-ops.js';

/**
 * Real-filesystem fake for FsOps, backed by a fresh temp directory per test.
 * Mirrors the DI pattern the existing MapStorage stub uses for LocalStorageSavePort.
 */
async function makeTempFsOps(): Promise<{ ops: FsOps; root: string; cleanup: () => Promise<void> }> {
  const root = await mkdtemp(join(tmpdir(), 'zplus-save-test-'));
  const nodeFs = await import('node:fs/promises');

  const resolve = (p: string) => join(root, p);

  const ops: FsOps = {
    async exists(path) {
      try { await nodeFs.access(resolve(path)); return true; } catch { return false; }
    },
    async mkdir(path) {
      await nodeFs.mkdir(resolve(path), { recursive: true });
    },
    async readDir(path): Promise<FsDirEntry[]> {
      const entries = await nodeFs.readdir(resolve(path), { withFileTypes: true });
      return entries.map((e) => ({ name: e.name, isDirectory: e.isDirectory() }));
    },
    async readTextFile(path) {
      return nodeFs.readFile(resolve(path), 'utf8');
    },
    async writeTextFile(path, contents) {
      await nodeFs.writeFile(resolve(path), contents, 'utf8');
    },
    async remove(path) {
      await nodeFs.rm(resolve(path));
    },
  };

  return { ops, root, cleanup: () => rm(root, { recursive: true, force: true }) };
}

describe('makeTempFsOps test harness', () => {
  it('exists() is false before mkdir, true after', async () => {
    const { ops, cleanup } = await makeTempFsOps();
    try {
      expect(await ops.exists('saves')).toBe(false);
      await ops.mkdir('saves');
      expect(await ops.exists('saves')).toBe(true);
    } finally {
      await cleanup();
    }
  });

  it('writeTextFile then readTextFile round-trips', async () => {
    const { ops, cleanup } = await makeTempFsOps();
    try {
      await ops.mkdir('saves');
      await ops.writeTextFile('saves/1.json', '{"a":1}');
      expect(await ops.readTextFile('saves/1.json')).toBe('{"a":1}');
    } finally {
      await cleanup();
    }
  });
});
