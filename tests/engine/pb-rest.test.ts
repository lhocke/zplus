/**
 * PB-REST — V-RESTORE body.
 *
 * Done-criteria (spec §9 Wave 1 PB-REST):
 *   - valid slot → "Ok." + room re-describe (V-FIRST-LOOK)
 *   - empty slot → "Failed." (byte-exact gverbs.zil:76)
 *   - version mismatch → in-voice (never "Failed.")
 *   - corruption → in-voice (never "Failed.")
 *   - restore mutates nothing on refusal
 *   - V-RESTORE stays in META_ACTIONS (no clock tick)
 *
 * Real Game + real Rng throughout (spec §3.2).
 */

import { describe, it, expect } from 'vitest';
import { createGame } from '../../src/engine/bootstrap.js';
import { META_ACTIONS, executeVerb } from '../../src/engine/verbs/index.js';
import type { VerbContext } from '../../src/engine/verbs/index.js';
import { createSession } from '../../src/shell/session.js';
import { LocalStorageSavePort } from '../../src/shell/save-port.js';
import { nullSink } from '../../src/shell/sink.js';
import { SAVE_FORMAT_VERSION } from '../../src/engine/save-state.js';

// ---------------------------------------------------------------------------
// In-memory localStorage stub (mirrors pb-save.test.ts)
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
// 1. verbRestore via VerbContext — basic text contracts
// ---------------------------------------------------------------------------

describe('PB-REST verbRestore — text contracts', () => {
  it('emits exactly "Failed." when restoreGame is absent', () => {
    const ctx: VerbContext = {
      verb: 'restore',
      action: 'V-RESTORE',
      player: {} as VerbContext['player'],
      here: {} as VerbContext['here'],
      world: {} as VerbContext['world'],
    };
    const r = executeVerb(ctx, 'V-RESTORE');
    expect(r.output).toBe('Failed.');
  });

  it('emits "Ok." prefix + room description on success', () => {
    const roomDesc = 'West of House\nYou are standing in an open field.';
    const ctx: VerbContext = {
      verb: 'restore',
      action: 'V-RESTORE',
      player: {} as VerbContext['player'],
      here: {} as VerbContext['here'],
      world: {} as VerbContext['world'],
      restoreGame: (_slot) => roomDesc,
    };
    const r = executeVerb(ctx, 'V-RESTORE');
    expect(r.output).toContain('Ok.');
    expect(r.output).toContain('West of House');
  });

  it('emits exactly "Failed." when restoreGame returns undefined (empty slot)', () => {
    const ctx: VerbContext = {
      verb: 'restore',
      action: 'V-RESTORE',
      player: {} as VerbContext['player'],
      here: {} as VerbContext['here'],
      world: {} as VerbContext['world'],
      restoreGame: (_slot) => undefined,
    };
    const r = executeVerb(ctx, 'V-RESTORE');
    expect(r.output).toBe('Failed.');
  });

  it('emits in-voice message (not "Failed.") when restoreGame returns an inVoice error', () => {
    const inVoiceMsg = 'That saved game appears to be damaged.';
    const ctx: VerbContext = {
      verb: 'restore',
      action: 'V-RESTORE',
      player: {} as VerbContext['player'],
      here: {} as VerbContext['here'],
      world: {} as VerbContext['world'],
      restoreGame: (_slot) => ({ inVoice: inVoiceMsg }),
    };
    const r = executeVerb(ctx, 'V-RESTORE');
    expect(r.output).toBe(inVoiceMsg);
    expect(r.output).not.toBe('Failed.');
  });

  it('uses ctx.saveSlot for slot arg, defaulting to "1"', () => {
    const captured: string[] = [];
    const ctx: VerbContext = {
      verb: 'restore',
      action: 'V-RESTORE',
      player: {} as VerbContext['player'],
      here: {} as VerbContext['here'],
      world: {} as VerbContext['world'],
      restoreGame: (slot) => { captured.push(slot); return undefined; },
    };
    executeVerb(ctx, 'V-RESTORE');
    expect(captured).toEqual(['1']);
  });

  it('passes ctx.saveSlot "2" to restoreGame', () => {
    const captured: string[] = [];
    const ctx: VerbContext = {
      verb: 'restore',
      action: 'V-RESTORE',
      player: {} as VerbContext['player'],
      here: {} as VerbContext['here'],
      world: {} as VerbContext['world'],
      saveSlot: '2',
      restoreGame: (slot) => { captured.push(slot); return undefined; },
    };
    executeVerb(ctx, 'V-RESTORE');
    expect(captured).toEqual(['2']);
  });
});

// ---------------------------------------------------------------------------
// 2. V-RESTORE is in META_ACTIONS
// ---------------------------------------------------------------------------

describe('PB-REST — V-RESTORE stays in META_ACTIONS', () => {
  it('META_ACTIONS contains V-RESTORE', () => {
    expect(META_ACTIONS.has('V-RESTORE')).toBe(true);
  });

  it('RESTORE is meta — move count does not advance', () => {
    const storage = new MapStorage();
    const port = new LocalStorageSavePort(storage);
    const session = createSession({ sink: nullSink, savePort: port, seed: 42 });
    session.start();
    const before = session.snapshot().moves;
    session.submit('restore');  // empty slot — no save written
    const after = session.snapshot().moves;
    expect(after).toBe(before);
  });
});

// ---------------------------------------------------------------------------
// 3. End-to-end: save then restore via Game with wired SavePort
// ---------------------------------------------------------------------------

describe('PB-REST — end-to-end via Game with wired SavePort', () => {
  it('restore from a valid slot prints Ok. and room description', () => {
    const storage = new MapStorage();
    const port = new LocalStorageSavePort(storage);
    const game = createGame({ seed: 42, savePort: port });
    game.start();
    game.turn('save');

    const result = game.turn('restore');
    expect(result.output).toContain('Ok.');
    // V-FIRST-LOOK fires: room description must appear
    expect(result.output.length).toBeGreaterThan('Ok.'.length);
  });

  it('restore from empty slot prints exactly "Failed."', () => {
    const storage = new MapStorage();
    const port = new LocalStorageSavePort(storage);
    const game = createGame({ seed: 42, savePort: port });
    game.start();
    // No save written
    const result = game.turn('restore');
    expect(result.output).toBe('Failed.');
  });

  it('restore mutates nothing when slot is empty', () => {
    const storage = new MapStorage();
    const port = new LocalStorageSavePort(storage);
    const game = createGame({ seed: 42, savePort: port });
    game.start();
    const before = game.view();
    game.turn('restore');  // slot empty
    const after = game.view();
    expect(after.moves).toBe(before.moves);
    expect(after.score).toBe(before.score);
    expect(after.here).toBe(before.here);
  });
});

// ---------------------------------------------------------------------------
// 4. Version mismatch → in-voice, not "Failed."
// ---------------------------------------------------------------------------

describe('PB-REST — version mismatch gives in-voice message', () => {
  it('formatVersion mismatch: in-voice message, not "Failed."', () => {
    const storage = new MapStorage();
    const port = new LocalStorageSavePort(storage);
    const game = createGame({ seed: 42, savePort: port });
    game.start();
    game.turn('save');  // write slot 1

    // Corrupt the formatVersion
    const raw = storage.getItem('zork-save-1')!;
    const mangled = JSON.parse(raw);
    mangled.formatVersion = SAVE_FORMAT_VERSION + 99;
    storage.setItem('zork-save-1', JSON.stringify(mangled));

    const result = game.turn('restore');
    // Must NOT be "Failed." — must be in-voice
    expect(result.output).not.toBe('Failed.');
    // Must mention incompatibility in some form
    expect(result.output.toLowerCase()).toMatch(/version|incompatible/);
  });

  it('formatVersion mismatch: state not mutated', () => {
    const storage = new MapStorage();
    const port = new LocalStorageSavePort(storage);
    const game = createGame({ seed: 42, savePort: port });
    game.start();
    game.turn('look');   // advance to move 1
    game.turn('save');   // save at move 1

    game.turn('look');   // advance to move 2
    const beforeMoves = game.view().moves;

    // Corrupt the formatVersion in storage
    const raw = storage.getItem('zork-save-1')!;
    const mangled = JSON.parse(raw);
    mangled.formatVersion = SAVE_FORMAT_VERSION + 99;
    storage.setItem('zork-save-1', JSON.stringify(mangled));

    game.turn('restore');  // should refuse with in-voice, not mutate
    // move count should NOT have rewound to the saved value
    expect(game.view().moves).toBe(beforeMoves);
  });
});

// ---------------------------------------------------------------------------
// 5. Corruption → in-voice, not "Failed."
// ---------------------------------------------------------------------------

describe('PB-REST — corruption gives in-voice message', () => {
  it('truncated JSON: in-voice message, not "Failed."', () => {
    const storage = new MapStorage();
    const port = new LocalStorageSavePort(storage);
    const game = createGame({ seed: 42, savePort: port });
    game.start();
    game.turn('save');

    // Truncate to force a JSON parse error
    storage.setItem('zork-save-1', '{"formatVersion":1,"buildId":"dev"');

    const result = game.turn('restore');
    // Corrupt → in-voice (damaged message), not "Failed."
    expect(result.output).not.toBe('Failed.');
    expect(result.output.toLowerCase()).toMatch(/damaged|corrupt/);
  });

  it('schema-invalid save (unknown field): in-voice message', () => {
    const storage = new MapStorage();
    const port = new LocalStorageSavePort(storage);
    const game = createGame({ seed: 42, savePort: port });
    game.start();
    game.turn('save');

    // Inject an unknown field that the validator rejects
    const raw = storage.getItem('zork-save-1')!;
    const mangled = JSON.parse(raw);
    mangled.__injected = 'attack-field';
    storage.setItem('zork-save-1', JSON.stringify(mangled));

    const result = game.turn('restore');
    expect(result.output).not.toBe('Failed.');
    expect(result.output.toLowerCase()).toMatch(/damaged|corrupt/);
  });

  it('corruption: state not mutated', () => {
    const storage = new MapStorage();
    const port = new LocalStorageSavePort(storage);
    const game = createGame({ seed: 42, savePort: port });
    game.start();
    game.turn('look');
    game.turn('save');
    const atSave = game.view();

    game.turn('look');  // advance past save
    const beforeRestore = game.view();

    storage.setItem('zork-save-1', '{"truncated":"yes"');

    game.turn('restore');
    // moves should still be at beforeRestore, not rewound to atSave
    expect(game.view().moves).toBe(beforeRestore.moves);
    void atSave;  // ensure we measured something real
  });
});

// ---------------------------------------------------------------------------
// 6. Session-layer slot resolution for restore
// ---------------------------------------------------------------------------

describe('PB-REST — session-layer slot resolution via createSession', () => {
  function makeSession(storage: MapStorage) {
    const port = new LocalStorageSavePort(storage);
    const session = createSession({ sink: nullSink, savePort: port, seed: 42 });
    session.start();
    return session;
  }

  it('"restore" (no slot) reads from slot "1"', () => {
    const storage = new MapStorage();
    const session = makeSession(storage);
    session.submit('save');   // write slot 1
    const output = session.submit('restore');
    expect(output).toContain('Ok.');
  });

  it('"restore 2" reads from slot "2"', () => {
    const storage = new MapStorage();
    const session = makeSession(storage);
    session.submit('save 2');
    const output = session.submit('restore 2');
    expect(output).toContain('Ok.');
  });

  it('"restore 4" returns in-voice no-slot message (out of range)', () => {
    const storage = new MapStorage();
    const session = makeSession(storage);
    const output = session.submit('restore 4');
    expect(output).toContain('no save slot');
  });
});
