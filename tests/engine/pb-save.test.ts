/**
 * PB-SAVE — V-SAVE body + session-layer slot resolution.
 *
 * Done-criteria (spec §9 Wave 1 PB-SAVE):
 *   - `save` → "Ok." (byte-exact gverbs.zil:80)
 *   - forced port failure → "Failed." (byte-exact gverbs.zil:82)
 *   - V-SAVE stays in META_ACTIONS (no clock tick)
 *   - session layer resolves slot from command ("save 2" → slot "2")
 *   - slot written to the port at the correct key
 *
 * Real Game + real Rng used throughout (spec §3.2 forbids stubs when snapshot runs).
 */

import { describe, it, expect } from 'vitest';
import { createGame } from '../../src/engine/bootstrap.js';
import { META_ACTIONS, executeVerb } from '../../src/engine/verbs/index.js';
import type { VerbContext } from '../../src/engine/verbs/index.js';
import { createSession } from '../../src/shell/session.js';
import { LocalStorageSavePort } from '../../src/shell/save-port.js';
import { nullSink } from '../../src/shell/sink.js';

// ---------------------------------------------------------------------------
// Minimal in-memory localStorage stub (mirrors save-port.test.ts)
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

// ---------------------------------------------------------------------------
// 1. verbSave via VerbContext — byte-exact Ok. / Failed.
// ---------------------------------------------------------------------------

describe('PB-SAVE verbSave — Ok. / Failed. text (byte-exact)', () => {
  it('emits exactly "Ok." when saveGame succeeds', () => {
    let savedSlot: string | undefined;
    const ctx: VerbContext = {
      verb: 'save',
      action: 'V-SAVE',
      player: {} as VerbContext['player'],
      here: {} as VerbContext['here'],
      world: {} as VerbContext['world'],
      saveGame: (slot) => { savedSlot = slot; },
    };
    const result = executeVerb(ctx, 'V-SAVE');
    expect(result.output).toBe('Ok.');
    expect(savedSlot).toBeDefined();
  });

  it('emits exactly "Failed." when saveGame is absent', () => {
    const ctx: VerbContext = {
      verb: 'save',
      action: 'V-SAVE',
      player: {} as VerbContext['player'],
      here: {} as VerbContext['here'],
      world: {} as VerbContext['world'],
    };
    const result = executeVerb(ctx, 'V-SAVE');
    expect(result.output).toBe('Failed.');
  });

  it('emits exactly "Failed." when saveGame throws (quota/IO)', () => {
    const ctx: VerbContext = {
      verb: 'save',
      action: 'V-SAVE',
      player: {} as VerbContext['player'],
      here: {} as VerbContext['here'],
      world: {} as VerbContext['world'],
      saveGame: () => { throw new DOMException('QuotaExceededError'); },
    };
    const result = executeVerb(ctx, 'V-SAVE');
    expect(result.output).toBe('Failed.');
  });
});

// ---------------------------------------------------------------------------
// 2. V-SAVE is META (no clock tick)
// ---------------------------------------------------------------------------

describe('PB-SAVE — V-SAVE is in META_ACTIONS', () => {
  it('META_ACTIONS contains V-SAVE', () => {
    expect(META_ACTIONS.has('V-SAVE')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 3. Slot resolution: verb body uses the slot threaded from context/session
// ---------------------------------------------------------------------------

describe('PB-SAVE — slot resolution from VerbContext', () => {
  it('uses saveSlot "1" (default) when no slot specified in ctx', () => {
    let capturedSlot: string | undefined;
    const ctx: VerbContext = {
      verb: 'save',
      action: 'V-SAVE',
      player: {} as VerbContext['player'],
      here: {} as VerbContext['here'],
      world: {} as VerbContext['world'],
      saveGame: (slot) => { capturedSlot = slot; },
      // no saveSlot provided → falls back to '1'
    };
    executeVerb(ctx, 'V-SAVE');
    expect(capturedSlot).toBe('1');
  });

  it('uses saveSlot from ctx when provided', () => {
    let capturedSlot: string | undefined;
    const ctx: VerbContext = {
      verb: 'save',
      action: 'V-SAVE',
      player: {} as VerbContext['player'],
      here: {} as VerbContext['here'],
      world: {} as VerbContext['world'],
      saveGame: (slot) => { capturedSlot = slot; },
      saveSlot: '2',
    };
    executeVerb(ctx, 'V-SAVE');
    expect(capturedSlot).toBe('2');
  });

  it('uses saveSlot "3" from ctx', () => {
    let capturedSlot: string | undefined;
    const ctx: VerbContext = {
      verb: 'save',
      action: 'V-SAVE',
      player: {} as VerbContext['player'],
      here: {} as VerbContext['here'],
      world: {} as VerbContext['world'],
      saveGame: (slot) => { capturedSlot = slot; },
      saveSlot: '3',
    };
    executeVerb(ctx, 'V-SAVE');
    expect(capturedSlot).toBe('3');
  });
});

// ---------------------------------------------------------------------------
// 4. Session-layer slot resolution: "save" / "save 2" / "save 3"
// ---------------------------------------------------------------------------

describe('PB-SAVE — session-layer slot resolution via createSession', () => {
  function makeSession(storage: MapStorage) {
    const port = new LocalStorageSavePort(storage);
    const session = createSession({ sink: nullSink, savePort: port, seed: 42 });
    session.start();
    return session;
  }

  it('"save" (no slot) writes to slot "1"', () => {
    const storage = new MapStorage();
    const session = makeSession(storage);
    const output = session.submit('save');
    expect(output).toBe('Ok.');
    expect(storage.getItem('zork-save-1')).not.toBeNull();
  });

  it('"save 2" writes to slot "2"', () => {
    const storage = new MapStorage();
    const session = makeSession(storage);
    const output = session.submit('save 2');
    expect(output).toBe('Ok.');
    expect(storage.getItem('zork-save-2')).not.toBeNull();
    // slot 1 should NOT be written
    expect(storage.getItem('zork-save-1')).toBeNull();
  });

  it('"save 3" writes to slot "3"', () => {
    const storage = new MapStorage();
    const session = makeSession(storage);
    const output = session.submit('save 3');
    expect(output).toBe('Ok.');
    expect(storage.getItem('zork-save-3')).not.toBeNull();
  });

  it('"save 1" writes to slot "1"', () => {
    const storage = new MapStorage();
    const session = makeSession(storage);
    const output = session.submit('save 1');
    expect(output).toBe('Ok.');
    expect(storage.getItem('zork-save-1')).not.toBeNull();
  });

  it('invalid slot "save 0" returns in-voice message, slot 0 not written', () => {
    const storage = new MapStorage();
    const session = makeSession(storage);
    const output = session.submit('save 0');
    // In-voice: "There is no save slot 0." — NOT "Ok." and NOT "Failed."
    expect(output).toContain('no save slot');
    // The invalid manual slot must not be written (autosave slot may be written by rolling autosave)
    expect(storage.getItem('zork-save-0')).toBeNull();
  });

  it('invalid slot "save 4" returns in-voice message, slot 4 not written', () => {
    const storage = new MapStorage();
    const session = makeSession(storage);
    const output = session.submit('save 4');
    expect(output).toContain('no save slot');
    expect(storage.getItem('zork-save-4')).toBeNull();
  });

  it('SAVE is meta — move count does not advance', () => {
    const storage = new MapStorage();
    const session = makeSession(storage);
    const beforeMoves = session.snapshot().moves;
    session.submit('save');
    const afterMoves = session.snapshot().moves;
    expect(afterMoves).toBe(beforeMoves);  // meta verb, no tick
  });
});

// ---------------------------------------------------------------------------
// 5. End-to-end: save via game with wired SavePort writes a readable SaveState
// ---------------------------------------------------------------------------

describe('PB-SAVE — end-to-end via Game with wired SavePort', () => {
  it('save produces a valid SaveState readable by the port', () => {
    const storage = new MapStorage();
    const port = new LocalStorageSavePort(storage);
    const game = createGame({ seed: 42, savePort: port });
    game.start();

    const result = game.turn('save');
    expect(result.output).toBe('Ok.');

    const saved = port.read('1');
    expect(saved).toBeDefined();
    expect(saved!.moveCount).toBeGreaterThanOrEqual(0);
  });
});
