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

import { FsSavePort } from '../../src/shell/save-port-fs.js';
import { SAVE_FORMAT_VERSION } from '../../src/engine/save-state.js';
import { runSavePortContract, minimalState } from './save-port-contract.js';

runSavePortContract('FsSavePort', async () => {
  const { ops } = await makeTempFsOps();
  return new FsSavePort(ops);
});

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

describe('FsSavePort — write creates the saves directory and persists to disk', () => {
  it('write on a fresh directory creates saves/ and the slot file', async () => {
    const { ops, cleanup } = await makeTempFsOps();
    try {
      const port = new FsSavePort(ops);
      await port.write('1', minimalState({ moveCount: 7 }));
      expect(await ops.exists('saves/1.json')).toBe(true);
    } finally {
      await cleanup();
    }
  });

  it('write then read round-trips through the real filesystem', async () => {
    const { ops, cleanup } = await makeTempFsOps();
    try {
      const port = new FsSavePort(ops);
      await port.write('1', minimalState({ moveCount: 7 }));
      const back = await port.read('1');
      expect(back?.moveCount).toBe(7);
    } finally {
      await cleanup();
    }
  });

  it('a fresh FsSavePort over the same directory sees a prior port\'s write', async () => {
    const { ops, cleanup } = await makeTempFsOps();
    try {
      const portA = new FsSavePort(ops);
      await portA.write('2', minimalState({ hereId: 'FOREST-1', moveCount: 9 }));
      const portB = new FsSavePort(ops);
      const meta = (await portB.list()).find((s) => s.slot === '2');
      expect(meta?.hereName).toBe('FOREST-1');
      expect(meta?.moves).toBe(9);
    } finally {
      await cleanup();
    }
  });

  it('accepts a Promise<FsOps> and resolves it lazily (mountShell stays sync)', async () => {
    const { ops, cleanup } = await makeTempFsOps();
    try {
      const port = new FsSavePort(Promise.resolve(ops));
      await port.write('1', minimalState());
      expect((await port.read('1'))?.buildId).toBe('test-build');
    } finally {
      await cleanup();
    }
  });
});

describe('FsSavePort — Amendment A: a failing write REJECTS (never a silent Ok)', () => {
  it('write rejects when the underlying fs write fails', async () => {
    const { ops, cleanup } = await makeTempFsOps();
    try {
      const failing: FsOps = {
        ...ops,
        writeTextFile: async () => { throw new Error('disk full'); },
      };
      const port = new FsSavePort(failing);
      await expect(port.write('1', minimalState())).rejects.toThrow('disk full');
    } finally {
      await cleanup();
    }
  });
});

describe('FsSavePort — classifies bad on-disk files', () => {
  it('a corrupt JSON file on disk reads back as corrupt, not empty', async () => {
    const { ops, cleanup } = await makeTempFsOps();
    try {
      await ops.mkdir('saves');
      await ops.writeTextFile('saves/3.json', 'not-json{{{');
      const port = new FsSavePort(ops);
      expect(await port.readWithReason('3')).toBe('corrupt');
    } finally {
      await cleanup();
    }
  });

  it('a foreign formatVersion on disk reads back as version, not empty', async () => {
    const { ops, cleanup } = await makeTempFsOps();
    try {
      await ops.mkdir('saves');
      const foreign = minimalState({ formatVersion: SAVE_FORMAT_VERSION + 99 });
      await ops.writeTextFile('saves/4.json', JSON.stringify(foreign));
      const port = new FsSavePort(ops);
      expect(await port.readWithReason('4')).toBe('version');
    } finally {
      await cleanup();
    }
  });

  it('an empty slot reads back as empty (missing saves dir included)', async () => {
    const { ops, cleanup } = await makeTempFsOps();
    try {
      const port = new FsSavePort(ops);
      expect(await port.readWithReason('9')).toBe('empty');
    } finally {
      await cleanup();
    }
  });

  it('remove deletes the slot file and is a no-op on an absent slot', async () => {
    const { ops, cleanup } = await makeTempFsOps();
    try {
      const port = new FsSavePort(ops);
      await port.write('1', minimalState());
      await port.remove('1');
      expect(await ops.exists('saves/1.json')).toBe(false);
      await expect(port.remove('99')).resolves.toBeUndefined();
    } finally {
      await cleanup();
    }
  });
});
