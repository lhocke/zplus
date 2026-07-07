/**
 * LocalStorageSavePort — adapter-specific tests. The generic SavePort
 * contract (async write/read/list/remove round-trip, validator behavior)
 * lives in save-port-contract.ts and is shared with FsSavePort
 * (save-port-fs.test.ts).
 */
import { describe, it, expect } from 'vitest';
import { LocalStorageSavePort } from '../../src/shell/save-port.js';
import { SAVE_FORMAT_VERSION } from '../../src/engine/save-state.js';
import { runSavePortContract, runValidatorContract, minimalState } from './save-port-contract.js';

class MapStorage implements Storage {
  private store = new Map<string, string>();
  get length(): number { return this.store.size; }
  key(n: number): string | null { return [...this.store.keys()][n] ?? null; }
  getItem(k: string): string | null { return this.store.get(k) ?? null; }
  setItem(k: string, v: string): void { this.store.set(k, v); }
  removeItem(k: string): void { this.store.delete(k); }
  clear(): void { this.store.clear(); }
}

runSavePortContract('LocalStorageSavePort', () => new LocalStorageSavePort(new MapStorage()));
runValidatorContract();

describe('LocalStorageSavePort — quota failure', () => {
  it('write rejects when storage throws QuotaExceededError', async () => {
    const quota: Storage = {
      length: 0, key: () => null, getItem: () => null,
      setItem: () => { throw new DOMException('QuotaExceededError', 'QuotaExceededError'); },
      removeItem: () => {}, clear: () => {},
    };
    const port = new LocalStorageSavePort(quota);
    await expect(port.write('1', minimalState())).rejects.toThrow();
  });

  it('read resolves undefined on malformed JSON', async () => {
    const storage = new MapStorage();
    storage.setItem('zork-save-1', 'not-json{{{');
    const port = new LocalStorageSavePort(storage);
    expect(await port.read('1')).toBeUndefined();
  });
});

describe('LocalStorageSavePort — version guard on read', () => {
  it('resolves undefined for a foreign formatVersion', async () => {
    const storage = new MapStorage();
    const port = new LocalStorageSavePort(storage);
    storage.setItem('zork-save-1', JSON.stringify(minimalState({ formatVersion: SAVE_FORMAT_VERSION + 99 })));
    expect(await port.read('1')).toBeUndefined();
  });
});

describe('LocalStorageSavePort — buildId policy (OQ-1 warn-allow)', () => {
  it('read succeeds with a different buildId on same formatVersion', async () => {
    const storage = new MapStorage();
    const port = new LocalStorageSavePort(storage);
    storage.setItem('zork-save-1', JSON.stringify(minimalState({ buildId: 'old-build-xyz' })));
    expect((await port.read('1'))?.buildId).toBe('old-build-xyz');
  });
});

describe('LocalStorageSavePort — list() ignores non-save keys', () => {
  it('ignores zork-theme and other unrelated keys', async () => {
    const storage = new MapStorage();
    const port = new LocalStorageSavePort(storage);
    storage.setItem('zork-theme', 'dark');
    storage.setItem('unrelated-key', '{}');
    await port.write('1', minimalState());
    expect(await port.list()).toHaveLength(1);
  });
});
