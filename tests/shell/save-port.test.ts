/**
 * PB-PORT — SavePort + localStorage adapter + validator tests.
 *
 * localStorage is unavailable in Node/vitest — we inject a minimal Map-backed
 * stub.  The validator tests feed adversarial input directly to validateSaveState
 * so they exercise the rejection logic without needing a real game snapshot.
 *
 * Amendment A: SavePort is async end-to-end — write/read/readWithReason/list/
 * remove all return Promises; the localStorage adapter wraps its sync ops in
 * resolved promises (a synchronous throw becomes a rejection).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  LocalStorageSavePort,
  validateSaveState,
  VALIDATION_OK,
  type ValidationResult,
} from '../../src/shell/save-port.js';
import { SAVE_FORMAT_VERSION } from '../../src/engine/save-state.js';
import type { SaveState } from '../../src/engine/save-state.js';

// ---------------------------------------------------------------------------
// Minimal localStorage stub
// ---------------------------------------------------------------------------

class MapStorage implements Storage {
  private store = new Map<string, string>();
  get length(): number { return this.store.size; }
  key(n: number): string | null { return [...this.store.keys()][n] ?? null; }
  getItem(k: string): string | null { return this.store.get(k) ?? null; }
  setItem(k: string, v: string): void { this.store.set(k, v); }
  removeItem(k: string): void { this.store.delete(k); }
  clear(): void { this.store.clear(); }
}

// A minimal valid SaveState — only the fields the validator checks.
function minimalState(overrides: Partial<SaveState> = {}): SaveState {
  return {
    formatVersion: SAVE_FORMAT_VERSION,
    buildId: 'test-build',
    savedAt: '2026-01-01T00:00:00.000Z',
    moveCount: 5,
    deaths: 0,
    dead: false,
    alwaysLit: false,
    gameOver: false,
    lucky: false,
    loadAllowed: 5,
    loadMax: 5,
    waterLevel: 0,
    beachDig: 0,
    hereId: 'WEST-OF-HOUSE',
    visited: [],
    lastVerb: '',
    lastAction: '',
    rngMain: 12345,
    rngCombat: 67890,
    clock: [],
    scoring: { baseScore: 0, score: 0, wonFlag: false },
    flagStore: [],
    objects: [],
    parser: {},
    moduleGlobals: {
      thiefState: {
        thiefHere: false,
        thiefEngrossed: false,
        eggSolve: false,
        cyclowrath: 0,
        thiefLdesc: '',
      },
      aboveGroundState: {
        kitchenWindowFlag: false,
        rugMoved: false,
        grateRevealed: false,
        grunlock: false,
        singSong: false,
      },
      lightSourceState: {
        matchCount: 0,
      },
    },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// 0. Async interface (Amendment A) — the unambiguous red against a sync adapter
// ---------------------------------------------------------------------------

describe('SavePort — async interface (Amendment A)', () => {
  it('write/read/readWithReason/list/remove all return Promises', () => {
    const storage = new MapStorage();
    const port = new LocalStorageSavePort(storage);
    expect(port.write('1', minimalState())).toBeInstanceOf(Promise);
    expect(port.read('1')).toBeInstanceOf(Promise);
    expect(port.readWithReason('1')).toBeInstanceOf(Promise);
    expect(port.list()).toBeInstanceOf(Promise);
    expect(port.remove('1')).toBeInstanceOf(Promise);
  });
});

// ---------------------------------------------------------------------------
// 1. write / read / list / remove round-trip
// ---------------------------------------------------------------------------

describe('LocalStorageSavePort — basic write/read/list/remove', () => {
  let storage: MapStorage;
  let port: LocalStorageSavePort;

  beforeEach(() => {
    storage = new MapStorage();
    port = new LocalStorageSavePort(storage);
  });

  it('write then read returns the same state', async () => {
    const state = minimalState();
    await port.write('1', state);
    const back = await port.read('1');
    expect(back).toBeDefined();
    expect(back!.formatVersion).toBe(SAVE_FORMAT_VERSION);
    expect(back!.moveCount).toBe(5);
    expect(back!.buildId).toBe('test-build');
  });

  it('read on empty slot returns undefined', async () => {
    expect(await port.read('1')).toBeUndefined();
  });

  it('list returns one entry after one write', async () => {
    const state = minimalState({ moveCount: 7, hereId: 'FOREST-1' });
    await port.write('2', state);
    const slots = await port.list();
    expect(slots).toHaveLength(1);
    expect(slots[0].slot).toBe('2');
    expect(slots[0].moves).toBe(7);
    expect(slots[0].hereName).toBe('FOREST-1');
    expect(slots[0].buildId).toBe('test-build');
  });

  it('list returns entries for all written slots', async () => {
    await port.write('1', minimalState({ moveCount: 1 }));
    await port.write('2', minimalState({ moveCount: 2 }));
    await port.write('3', minimalState({ moveCount: 3 }));
    const slots = await port.list();
    expect(slots).toHaveLength(3);
    const moves = slots.map(s => s.moves).sort((a, b) => a - b);
    expect(moves).toEqual([1, 2, 3]);
  });

  it('remove clears the slot so read returns undefined', async () => {
    await port.write('1', minimalState());
    await port.remove('1');
    expect(await port.read('1')).toBeUndefined();
  });

  it('remove is a no-op on an absent slot', async () => {
    await expect(port.remove('99')).resolves.not.toThrow();
  });

  it('keys are namespaced zork-save-<slot>', async () => {
    await port.write('1', minimalState());
    expect(storage.getItem('zork-save-1')).not.toBeNull();
  });

  it('overwriting a slot replaces the previous save', async () => {
    await port.write('1', minimalState({ moveCount: 1 }));
    await port.write('1', minimalState({ moveCount: 99 }));
    expect((await port.read('1'))!.moveCount).toBe(99);
  });
});

// ---------------------------------------------------------------------------
// 2. Quota / IO failure — write surfaces cleanly, read returns undefined
// ---------------------------------------------------------------------------

describe('LocalStorageSavePort — quota failure', () => {
  it('write rejects when storage throws QuotaExceededError', async () => {
    const quota: Storage = {
      length: 0,
      key: () => null,
      getItem: () => null,
      setItem: () => { throw new DOMException('QuotaExceededError', 'QuotaExceededError'); },
      removeItem: () => {},
      clear: () => {},
    };
    const port = new LocalStorageSavePort(quota);
    // write() is expected to reject so the verb layer can surface Failed.
    await expect(port.write('1', minimalState())).rejects.toThrow();
  });

  it('read returns undefined on malformed JSON', async () => {
    const storage = new MapStorage();
    storage.setItem('zork-save-1', 'not-json{{{');
    const port = new LocalStorageSavePort(storage);
    expect(await port.read('1')).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 3. Validator — valid input passes
// ---------------------------------------------------------------------------

describe('validateSaveState — valid input', () => {
  it('accepts a minimal valid state', () => {
    const result = validateSaveState(minimalState());
    expect(result).toBe(VALIDATION_OK);
  });

  it('accepts optional fields absent (lastDobjId, lastIobjId, lastPrep)', () => {
    const state = minimalState();
    const result = validateSaveState(state);
    expect(result).toBe(VALIDATION_OK);
  });
});

// ---------------------------------------------------------------------------
// 4. Validator — rejects malformed / foreign input WITHOUT throwing
// ---------------------------------------------------------------------------

describe('validateSaveState — rejects bad input without throwing', () => {
  function bad(input: unknown): ValidationResult {
    // Must not throw — spec §5.1
    return validateSaveState(input as SaveState);
  }

  it('rejects null', () => {
    expect(bad(null)).not.toBe(VALIDATION_OK);
  });

  it('rejects non-object', () => {
    expect(bad('string')).not.toBe(VALIDATION_OK);
    expect(bad(42)).not.toBe(VALIDATION_OK);
    expect(bad([])).not.toBe(VALIDATION_OK);
  });

  it('rejects missing formatVersion', () => {
    const { formatVersion: _fv, ...rest } = minimalState();
    expect(bad(rest)).not.toBe(VALIDATION_OK);
  });

  it('rejects non-number formatVersion', () => {
    expect(bad({ ...minimalState(), formatVersion: 'v1' })).not.toBe(VALIDATION_OK);
  });

  it('rejects missing buildId', () => {
    const { buildId: _bi, ...rest } = minimalState();
    expect(bad(rest)).not.toBe(VALIDATION_OK);
  });

  it('rejects non-string buildId', () => {
    expect(bad({ ...minimalState(), buildId: 42 })).not.toBe(VALIDATION_OK);
  });

  it('rejects missing savedAt', () => {
    const { savedAt: _sa, ...rest } = minimalState();
    expect(bad(rest)).not.toBe(VALIDATION_OK);
  });

  it('rejects missing hereId', () => {
    const { hereId: _hi, ...rest } = minimalState();
    expect(bad(rest)).not.toBe(VALIDATION_OK);
  });

  it('rejects non-string hereId', () => {
    expect(bad({ ...minimalState(), hereId: 123 })).not.toBe(VALIDATION_OK);
  });

  it('rejects missing moveCount', () => {
    const { moveCount: _mc, ...rest } = minimalState();
    expect(bad(rest)).not.toBe(VALIDATION_OK);
  });

  it('rejects non-number moveCount', () => {
    expect(bad({ ...minimalState(), moveCount: '5' })).not.toBe(VALIDATION_OK);
  });

  it('rejects negative moveCount', () => {
    expect(bad({ ...minimalState(), moveCount: -1 })).not.toBe(VALIDATION_OK);
  });

  it('rejects non-number rngMain', () => {
    expect(bad({ ...minimalState(), rngMain: null })).not.toBe(VALIDATION_OK);
  });

  it('rejects non-number rngCombat', () => {
    expect(bad({ ...minimalState(), rngCombat: undefined })).not.toBe(VALIDATION_OK);
  });

  it('rejects non-array objects', () => {
    expect(bad({ ...minimalState(), objects: 'oops' })).not.toBe(VALIDATION_OK);
  });

  it('rejects non-array clock', () => {
    expect(bad({ ...minimalState(), clock: {} })).not.toBe(VALIDATION_OK);
  });

  it('rejects non-array flagStore', () => {
    expect(bad({ ...minimalState(), flagStore: null })).not.toBe(VALIDATION_OK);
  });

  it('rejects missing scoring', () => {
    const { scoring: _s, ...rest } = minimalState();
    expect(bad(rest)).not.toBe(VALIDATION_OK);
  });

  it('rejects scoring with non-number score', () => {
    expect(bad({ ...minimalState(), scoring: { baseScore: 0, score: 'x', wonFlag: false } })).not.toBe(VALIDATION_OK);
  });

  it('rejects scoring with non-boolean wonFlag', () => {
    expect(bad({ ...minimalState(), scoring: { baseScore: 0, score: 0, wonFlag: 1 } })).not.toBe(VALIDATION_OK);
  });

  it('rejects missing parser', () => {
    const { parser: _p, ...rest } = minimalState();
    expect(bad(rest)).not.toBe(VALIDATION_OK);
  });

  it('rejects missing moduleGlobals', () => {
    const { moduleGlobals: _mg, ...rest } = minimalState();
    expect(bad(rest)).not.toBe(VALIDATION_OK);
  });

  it('rejects extra top-level fields (unknown field injection)', () => {
    const evil = { ...minimalState(), __proto__: { evil: true }, injected: 'yes' };
    // Extra fields alone aren't necessarily fatal (the spec says clamp/reject
    // "unknown object ids and out-of-range numbers") — but we test the
    // validator still produces a result (no throw) and identify the exact
    // policy: this implementation accepts unknown extra fields because JSON
    // deserialization always produces those and clamping is per-field.
    // The important invariant is: it does NOT throw.
    let threw = false;
    let result: ValidationResult | undefined;
    try { result = validateSaveState(evil as unknown as SaveState); }
    catch { threw = true; }
    expect(threw).toBe(false);
    // Extra fields: our policy is reject to be safe.
    expect(result).not.toBe(VALIDATION_OK);
  });

  it('rejects objects array entry with non-string id', () => {
    const state = minimalState({
      objects: [{ id: 99 as unknown as string, parent: null, siblingOrder: null, flags: [], props: [] }],
    });
    expect(bad(state)).not.toBe(VALIDATION_OK);
  });
});

// ---------------------------------------------------------------------------
// 5. Version guard — formatVersion mismatch refuses before any mutation
// ---------------------------------------------------------------------------

describe('LocalStorageSavePort — version guard on read', () => {
  it('returns undefined for a foreign formatVersion', async () => {
    const storage = new MapStorage();
    const port = new LocalStorageSavePort(storage);
    // Write a state with a future format version directly.
    const foreign = minimalState({ formatVersion: SAVE_FORMAT_VERSION + 99 });
    storage.setItem('zork-save-1', JSON.stringify(foreign));
    expect(await port.read('1')).toBeUndefined();
  });

  it('read accepts same formatVersion', async () => {
    const storage = new MapStorage();
    const port = new LocalStorageSavePort(storage);
    await port.write('1', minimalState());
    expect(await port.read('1')).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// 6. BuildId policy (OQ-1): warn-allow on same formatVersion
// ---------------------------------------------------------------------------

describe('LocalStorageSavePort — buildId policy', () => {
  it('read succeeds with a different buildId on same formatVersion (warn-allow)', async () => {
    const storage = new MapStorage();
    const port = new LocalStorageSavePort(storage);
    // Simulate a save from an older build.
    const olderBuild = minimalState({ buildId: 'old-build-xyz' });
    storage.setItem('zork-save-1', JSON.stringify(olderBuild));
    // Should succeed — different buildId, same formatVersion = warn-allow.
    const result = await port.read('1');
    expect(result).toBeDefined();
    expect(result!.buildId).toBe('old-build-xyz');
  });
});

// ---------------------------------------------------------------------------
// 7. list() returns SaveSlotMeta fields correctly
// ---------------------------------------------------------------------------

describe('LocalStorageSavePort — list() metadata', () => {
  it('lists savedAt and slot fields', async () => {
    const storage = new MapStorage();
    const port = new LocalStorageSavePort(storage);
    const ts = '2026-06-01T12:00:00.000Z';
    await port.write('3', minimalState({ savedAt: ts, hereId: 'LIVING-ROOM', moveCount: 42 }));
    const [meta] = await port.list();
    expect(meta.slot).toBe('3');
    expect(meta.savedAt).toBe(ts);
    expect(meta.hereName).toBe('LIVING-ROOM');
    expect(meta.moves).toBe(42);
    expect(meta.buildId).toBe('test-build');
  });

  it('list returns empty array when no saves exist', async () => {
    const storage = new MapStorage();
    const port = new LocalStorageSavePort(storage);
    expect(await port.list()).toEqual([]);
  });

  it('list ignores non-save keys in storage', async () => {
    const storage = new MapStorage();
    const port = new LocalStorageSavePort(storage);
    storage.setItem('zork-theme', 'dark');
    storage.setItem('unrelated-key', '{}');
    await port.write('1', minimalState());
    expect(await port.list()).toHaveLength(1);
  });
});
