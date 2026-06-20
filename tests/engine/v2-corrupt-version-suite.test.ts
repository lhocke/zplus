/**
 * V2 — Corruption / version / untrusted-input suite (spec §10.2).
 *
 * Tests every failure mode for save data that is absent, malformed,
 * schema-invalid, version-skewed, or hand-edited.  For each case the
 * suite asserts:
 *   (a) the exact player-visible outcome (Failed. vs in-voice)
 *   (b) the live game state is NOT mutated
 *   (c) no uncaught exception reaches the player
 *
 * Failure taxonomy (spec §5.3, OQ-3):
 *   empty slot       → "Failed." (faithful no-save)
 *   corruption       → in-voice "appears to be damaged"
 *   version mismatch → in-voice "incompatible version"
 *   buildId mismatch → warn-allow (OQ-1): restore succeeds on same formatVersion
 *
 * Test layers used:
 *   - game.turn()    — integration (real SavePort path, checks output text)
 *   - session.submit — integration with session-layer slot resolution
 *   - validateSaveState directly — unit tests for the untrusted-input validator
 */

import { describe, it, expect } from 'vitest';
import { createGame } from '../../src/engine/bootstrap.js';
import { createSession } from '../../src/shell/session.js';
import {
  LocalStorageSavePort,
  validateSaveState,
  VALIDATION_OK,
} from '../../src/shell/save-port.js';
import { SAVE_FORMAT_VERSION } from '../../src/engine/save-state.js';
import { nullSink } from '../../src/shell/sink.js';
import type { SaveState } from '../../src/engine/save-state.js';

// ---------------------------------------------------------------------------
// Shared infrastructure
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

function makeGame(storage: MapStorage) {
  const port = new LocalStorageSavePort(storage);
  const game = createGame({ seed: 42, savePort: port });
  game.start();
  return game;
}

function makeSession(storage: MapStorage) {
  const port = new LocalStorageSavePort(storage);
  const session = createSession({ sink: nullSink, savePort: port, seed: 42 });
  session.start();
  return session;
}

// Helpers to inject bad data directly into storage without going through write().
function rawSet(storage: MapStorage, slot: string, content: string) {
  storage.setItem(`zork-save-${slot}`, content);
}

function rawMangle(storage: MapStorage, slot: string, patch: (obj: Record<string, unknown>) => void) {
  const raw = storage.getItem(`zork-save-${slot}`)!;
  const obj = JSON.parse(raw) as Record<string, unknown>;
  patch(obj);
  storage.setItem(`zork-save-${slot}`, JSON.stringify(obj));
}

// ---------------------------------------------------------------------------
// 1. Empty slot → exactly "Failed." (spec OQ-3)
// ---------------------------------------------------------------------------

describe('V2 — empty slot', () => {
  it('restore from an empty slot prints exactly "Failed."', () => {
    const storage = new MapStorage();
    const game = makeGame(storage);
    // No save written to slot 1
    const r = game.turn('restore');
    expect(r.output).toBe('Failed.');
  });

  it('empty slot does not mutate move count', () => {
    const storage = new MapStorage();
    const game = makeGame(storage);
    game.turn('look');
    const before = game.view();
    game.turn('restore');
    expect(game.view().moves).toBe(before.moves);
  });

  it('empty slot does not mutate room', () => {
    const storage = new MapStorage();
    const game = makeGame(storage);
    game.turn('north');  // move to FOREST-1
    const here = game.view().here;
    game.turn('restore');
    expect(game.view().here).toBe(here);
  });

  it('session: "restore" on empty slot returns "Failed."', () => {
    const storage = new MapStorage();
    const session = makeSession(storage);
    const out = session.submit('restore');
    expect(out).toBe('Failed.');
  });
});

// ---------------------------------------------------------------------------
// 2. Truncated / non-JSON input → in-voice "damaged", live game untouched
//    (spec §10.2, §5.3, OQ-3 — distinct from empty-slot Failed.)
// ---------------------------------------------------------------------------

describe('V2 — truncated / non-JSON input', () => {
  it('truncated JSON: in-voice damaged message, not "Failed."', () => {
    const storage = new MapStorage();
    const game = makeGame(storage);
    game.turn('save');
    rawSet(storage, '1', '{"formatVersion":1,"buildId":"dev"');

    const r = game.turn('restore');
    expect(r.output).not.toBe('Failed.');
    expect(r.output.toLowerCase()).toMatch(/damaged|corrupt/);
  });

  it('non-JSON string: in-voice damaged message', () => {
    const storage = new MapStorage();
    const game = makeGame(storage);
    game.turn('save');
    rawSet(storage, '1', 'not-json-at-all');

    const r = game.turn('restore');
    expect(r.output).not.toBe('Failed.');
    expect(r.output.toLowerCase()).toMatch(/damaged|corrupt/);
  });

  it('empty string in slot: in-voice damaged message', () => {
    const storage = new MapStorage();
    const game = makeGame(storage);
    game.turn('save');
    rawSet(storage, '1', '');

    const r = game.turn('restore');
    // Empty string fails JSON.parse → corrupt
    expect(r.output).not.toBe('Failed.');
    expect(r.output.toLowerCase()).toMatch(/damaged|corrupt/);
  });

  it('truncated JSON: live game move count unchanged', () => {
    const storage = new MapStorage();
    const game = makeGame(storage);
    game.turn('look');
    game.turn('save');
    game.turn('look');
    const before = game.view();
    rawSet(storage, '1', '{"partial":true');
    game.turn('restore');
    expect(game.view().moves).toBe(before.moves);
  });

  it('truncated JSON: live game room unchanged', () => {
    const storage = new MapStorage();
    const game = makeGame(storage);
    game.turn('north');
    game.turn('save');
    const here = game.view().here;
    rawSet(storage, '1', '{"bad');
    game.turn('restore');
    expect(game.view().here).toBe(here);
  });
});

// ---------------------------------------------------------------------------
// 3. formatVersion mismatch → in-voice refusal, state not mutated
//    (spec §5.3, §10.2)
// ---------------------------------------------------------------------------

describe('V2 — formatVersion mismatch', () => {
  it('future formatVersion: in-voice version/incompatible message', () => {
    const storage = new MapStorage();
    const game = makeGame(storage);
    game.turn('save');
    rawMangle(storage, '1', o => { o.formatVersion = SAVE_FORMAT_VERSION + 99; });

    const r = game.turn('restore');
    expect(r.output).not.toBe('Failed.');
    expect(r.output.toLowerCase()).toMatch(/version|incompatible/);
  });

  it('past formatVersion (0): in-voice version/incompatible message', () => {
    const storage = new MapStorage();
    const game = makeGame(storage);
    game.turn('save');
    rawMangle(storage, '1', o => { o.formatVersion = 0; });

    const r = game.turn('restore');
    expect(r.output).not.toBe('Failed.');
    expect(r.output.toLowerCase()).toMatch(/version|incompatible/);
  });

  it('formatVersion mismatch: move count not rewound', () => {
    const storage = new MapStorage();
    const game = makeGame(storage);
    game.turn('look');  // move 1 — snapshot at this point
    game.turn('save');
    game.turn('look');  // move 2
    const before = game.view().moves;
    rawMangle(storage, '1', o => { o.formatVersion = SAVE_FORMAT_VERSION + 1; });
    game.turn('restore');
    expect(game.view().moves).toBe(before);  // still at move 2, not rewound to 1
  });

  it('formatVersion mismatch: room not changed', () => {
    const storage = new MapStorage();
    const game = makeGame(storage);
    game.turn('north');   // go to FOREST-1 — save here
    game.turn('save');
    game.turn('south');   // back to start
    const here = game.view().here;
    rawMangle(storage, '1', o => { o.formatVersion = SAVE_FORMAT_VERSION + 1; });
    game.turn('restore');
    expect(game.view().here).toBe(here);
  });

  it('version mismatch: no uncaught exception', () => {
    const storage = new MapStorage();
    const game = makeGame(storage);
    game.turn('save');
    rawMangle(storage, '1', o => { o.formatVersion = SAVE_FORMAT_VERSION + 5; });
    expect(() => game.turn('restore')).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// 4. buildId mismatch, same formatVersion → warn-allow (OQ-1)
//    "a content patch shouldn't brick saves" (spec §5.3)
// ---------------------------------------------------------------------------

describe('V2 — buildId mismatch (OQ-1 warn-allow)', () => {
  it('different buildId on same formatVersion: restore succeeds', () => {
    const storage = new MapStorage();
    const game = makeGame(storage);
    game.turn('look');
    game.turn('save');
    rawMangle(storage, '1', o => { o.buildId = 'old-build-xyz'; });

    const r = game.turn('restore');
    // Should succeed — returns "Ok." + room description
    expect(r.output).toContain('Ok.');
  });

  it('different buildId: move count is restored from the save', () => {
    const storage = new MapStorage();
    const game = makeGame(storage);
    game.turn('look');  // move 1
    game.turn('save');
    const savedMoves = game.view().moves;

    game.turn('look');  // move 2
    rawMangle(storage, '1', o => { o.buildId = 'other-build'; });

    game.turn('restore');
    // Should restore to savedMoves, not stay at move 2
    expect(game.view().moves).toBe(savedMoves);
  });

  it('empty buildId string: still warn-allow on same formatVersion', () => {
    const storage = new MapStorage();
    const game = makeGame(storage);
    game.turn('save');
    rawMangle(storage, '1', o => { o.buildId = ''; });

    const r = game.turn('restore');
    expect(r.output).toContain('Ok.');
  });
});

// ---------------------------------------------------------------------------
// 5. Foreign / hand-edited saves — schema validation rejects, never throws
//    (spec §5.1, §10.2 "unknown id / out-of-range number / extra field")
// ---------------------------------------------------------------------------

describe('V2 — foreign / hand-edited save (extra fields)', () => {
  it('extra top-level field: in-voice damaged, never throws', () => {
    const storage = new MapStorage();
    const game = makeGame(storage);
    game.turn('save');
    rawMangle(storage, '1', o => { o['__injected'] = 'evil-payload'; });

    expect(() => {
      const r = game.turn('restore');
      // Must not be "Failed." — must be in-voice corruption message
      expect(r.output).not.toBe('Failed.');
      expect(r.output.toLowerCase()).toMatch(/damaged|corrupt/);
    }).not.toThrow();
  });

  it('extra top-level field: state not mutated', () => {
    const storage = new MapStorage();
    const game = makeGame(storage);
    game.turn('look');
    game.turn('save');
    const savedMoves = game.view().moves;
    game.turn('look');
    const before = game.view().moves;

    rawMangle(storage, '1', o => { o['__evil'] = true; });
    game.turn('restore');
    expect(game.view().moves).toBe(before);
    void savedMoves;
  });

  it('prototype-pollution attempt (__proto__): validator does not throw', () => {
    const storage = new MapStorage();
    // Directly serialize an object that references __proto__ in a field key —
    // the actual __proto__ key doesn't appear in JSON.stringify output, but
    // a string "__proto__" could.
    const poisoned = JSON.stringify({ ...JSON.parse(storage.getItem('zork-save-1') ?? '{}'), '__proto__': 'evil' });
    rawSet(storage, '1', poisoned);
    // validateSaveState must not throw
    let threw = false;
    try {
      validateSaveState(JSON.parse(poisoned));
    } catch {
      threw = true;
    }
    expect(threw).toBe(false);
  });
});

describe('V2 — foreign / hand-edited save (bad field values)', () => {
  it('moveCount is a negative number: in-voice damaged, never throws', () => {
    const storage = new MapStorage();
    const game = makeGame(storage);
    game.turn('save');
    rawMangle(storage, '1', o => { o.moveCount = -999; });

    expect(() => {
      const r = game.turn('restore');
      expect(r.output).not.toBe('Failed.');
      expect(r.output.toLowerCase()).toMatch(/damaged|corrupt/);
    }).not.toThrow();
  });

  it('moveCount is a string: in-voice damaged, never throws', () => {
    const storage = new MapStorage();
    const game = makeGame(storage);
    game.turn('save');
    rawMangle(storage, '1', o => { o.moveCount = '5 is my move count'; });

    expect(() => {
      const r = game.turn('restore');
      expect(r.output).not.toBe('Failed.');
    }).not.toThrow();
  });

  it('hereId is a number: in-voice damaged, never throws', () => {
    const storage = new MapStorage();
    const game = makeGame(storage);
    game.turn('save');
    rawMangle(storage, '1', o => { o.hereId = 12345; });

    expect(() => {
      const r = game.turn('restore');
      expect(r.output).not.toBe('Failed.');
      expect(r.output.toLowerCase()).toMatch(/damaged|corrupt/);
    }).not.toThrow();
  });

  it('scoring is null: in-voice damaged, never throws', () => {
    const storage = new MapStorage();
    const game = makeGame(storage);
    game.turn('save');
    rawMangle(storage, '1', o => { o.scoring = null; });

    expect(() => {
      const r = game.turn('restore');
      expect(r.output).not.toBe('Failed.');
    }).not.toThrow();
  });

  it('rngMain is null: in-voice damaged, never throws', () => {
    const storage = new MapStorage();
    const game = makeGame(storage);
    game.turn('save');
    rawMangle(storage, '1', o => { o.rngMain = null; });

    expect(() => {
      const r = game.turn('restore');
      expect(r.output).not.toBe('Failed.');
    }).not.toThrow();
  });

  it('objects is not an array: in-voice damaged, never throws', () => {
    const storage = new MapStorage();
    const game = makeGame(storage);
    game.turn('save');
    rawMangle(storage, '1', o => { o.objects = 'not-an-array'; });

    expect(() => {
      const r = game.turn('restore');
      expect(r.output).not.toBe('Failed.');
    }).not.toThrow();
  });

  it('objects entry has a numeric id: in-voice damaged, never throws', () => {
    const storage = new MapStorage();
    const game = makeGame(storage);
    game.turn('save');
    rawMangle(storage, '1', o => {
      (o.objects as unknown[]).push({ id: 99999, parent: null, siblingOrder: null, flags: [], props: [] });
    });

    expect(() => {
      const r = game.turn('restore');
      expect(r.output).not.toBe('Failed.');
      expect(r.output.toLowerCase()).toMatch(/damaged|corrupt/);
    }).not.toThrow();
  });

  it('parser is an array (wrong type): in-voice damaged, never throws', () => {
    const storage = new MapStorage();
    const game = makeGame(storage);
    game.turn('save');
    rawMangle(storage, '1', o => { o.parser = ['bad-type']; });

    expect(() => {
      const r = game.turn('restore');
      expect(r.output).not.toBe('Failed.');
    }).not.toThrow();
  });

  it('moduleGlobals missing: in-voice damaged, never throws', () => {
    const storage = new MapStorage();
    const game = makeGame(storage);
    game.turn('save');
    rawMangle(storage, '1', o => { delete (o as Partial<typeof o>).moduleGlobals; });

    expect(() => {
      const r = game.turn('restore');
      expect(r.output).not.toBe('Failed.');
    }).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// 6. Validator unit tests — direct calls to validateSaveState
//    These mirror spec §10.2 "never throws to the player" at the unit level.
// ---------------------------------------------------------------------------

// Minimal valid SaveState for validator tests.
function minState(overrides: Partial<SaveState> = {}): SaveState {
  return {
    formatVersion: SAVE_FORMAT_VERSION,
    buildId: 'test',
    savedAt: '2026-01-01T00:00:00.000Z',
    moveCount: 0,
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
    rngMain: 1,
    rngCombat: 2,
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
      lightSourceState: { matchCount: 0 },
    },
    ...overrides,
  };
}

describe('V2 — validateSaveState unit coverage', () => {
  it('valid minimal state passes', () => {
    expect(validateSaveState(minState())).toBe(VALIDATION_OK);
  });

  // null / primitives
  it('null → fail (no throw)', () => { expect(() => validateSaveState(null)).not.toThrow(); expect(validateSaveState(null)).not.toBe(VALIDATION_OK); });
  it('number → fail', () => { expect(validateSaveState(42)).not.toBe(VALIDATION_OK); });
  it('string → fail', () => { expect(validateSaveState('save')).not.toBe(VALIDATION_OK); });
  it('array → fail', () => { expect(validateSaveState([])).not.toBe(VALIDATION_OK); });

  // Unknown extra fields
  it('extra field → fail', () => {
    expect(validateSaveState({ ...minState(), __evil__: 'yes' } as unknown as SaveState)).not.toBe(VALIDATION_OK);
  });

  // Required numeric fields
  it('missing moveCount → fail', () => {
    const { moveCount: _, ...rest } = minState();
    expect(validateSaveState(rest as SaveState)).not.toBe(VALIDATION_OK);
  });
  it('moveCount = -1 → fail', () => {
    expect(validateSaveState(minState({ moveCount: -1 }))).not.toBe(VALIDATION_OK);
  });
  it('missing rngMain → fail', () => {
    const s = minState() as Partial<SaveState>;
    delete s.rngMain;
    expect(validateSaveState(s as SaveState)).not.toBe(VALIDATION_OK);
  });
  it('rngMain = null → fail', () => {
    expect(validateSaveState({ ...minState(), rngMain: null } as unknown as SaveState)).not.toBe(VALIDATION_OK);
  });
  it('rngCombat = undefined → fail', () => {
    expect(validateSaveState({ ...minState(), rngCombat: undefined } as unknown as SaveState)).not.toBe(VALIDATION_OK);
  });

  // String fields
  it('hereId = number → fail', () => {
    expect(validateSaveState({ ...minState(), hereId: 42 } as unknown as SaveState)).not.toBe(VALIDATION_OK);
  });
  it('buildId = number → fail', () => {
    expect(validateSaveState({ ...minState(), buildId: 42 } as unknown as SaveState)).not.toBe(VALIDATION_OK);
  });

  // Boolean fields
  it('dead = 0 → fail', () => {
    expect(validateSaveState({ ...minState(), dead: 0 } as unknown as SaveState)).not.toBe(VALIDATION_OK);
  });

  // Scoring
  it('scoring missing → fail', () => {
    const { scoring: _, ...rest } = minState();
    expect(validateSaveState(rest as SaveState)).not.toBe(VALIDATION_OK);
  });
  it('scoring.score = "x" → fail', () => {
    expect(validateSaveState(minState({ scoring: { baseScore: 0, score: 'x' as unknown as number, wonFlag: false } }))).not.toBe(VALIDATION_OK);
  });
  it('scoring.wonFlag = 1 → fail', () => {
    expect(validateSaveState(minState({ scoring: { baseScore: 0, score: 0, wonFlag: 1 as unknown as boolean } }))).not.toBe(VALIDATION_OK);
  });

  // Arrays
  it('objects = string → fail', () => {
    expect(validateSaveState(minState({ objects: 'bad' as unknown as [] }))).not.toBe(VALIDATION_OK);
  });
  it('clock = {} → fail', () => {
    expect(validateSaveState(minState({ clock: {} as unknown as [] }))).not.toBe(VALIDATION_OK);
  });
  it('flagStore = null → fail', () => {
    expect(validateSaveState(minState({ flagStore: null as unknown as [] }))).not.toBe(VALIDATION_OK);
  });

  // Objects entries
  it('objects entry with numeric id → fail', () => {
    const bad = minState({ objects: [{ id: 99 as unknown as string, parent: null, siblingOrder: null, flags: [], props: [] }] });
    expect(validateSaveState(bad)).not.toBe(VALIDATION_OK);
  });

  // Parser
  it('parser missing → fail', () => {
    const { parser: _, ...rest } = minState();
    expect(validateSaveState(rest as SaveState)).not.toBe(VALIDATION_OK);
  });
  it('parser.itRef = number → fail', () => {
    expect(validateSaveState(minState({ parser: { itRef: 42 as unknown as string } }))).not.toBe(VALIDATION_OK);
  });
  it('parser.itRef = string → ok', () => {
    expect(validateSaveState(minState({ parser: { itRef: 'LAMP' } }))).toBe(VALIDATION_OK);
  });

  // moduleGlobals
  it('moduleGlobals missing → fail', () => {
    const { moduleGlobals: _, ...rest } = minState();
    expect(validateSaveState(rest as SaveState)).not.toBe(VALIDATION_OK);
  });
});

// ---------------------------------------------------------------------------
// 7. Restore never throws to the player — stress test
//    Arbitrary garbage must not produce an unhandled exception via game.turn().
// ---------------------------------------------------------------------------

describe('V2 — no throw guarantee (stress)', () => {
  const junkPayloads = [
    '{}',
    'null',
    '[]',
    '"hello"',
    '{"formatVersion":1}',
    '{"formatVersion":1,"buildId":"x","savedAt":"now","moveCount":-1}',
    '{"formatVersion":9999,"buildId":"x","savedAt":"now","moveCount":0,"evil":true}',
    // Deeply nested junk that could trigger recursive descent
    JSON.stringify({ formatVersion: SAVE_FORMAT_VERSION, buildId: 'x', scoring: { score: [[[1,2]]] } }),
  ];

  for (const payload of junkPayloads) {
    it(`does not throw for payload: ${payload.slice(0, 40)}`, () => {
      const storage = new MapStorage();
      const game = makeGame(storage);
      rawSet(storage, '1', payload);
      expect(() => game.turn('restore')).not.toThrow();
    });
  }
});

// ---------------------------------------------------------------------------
// 8. Typed-but-malformed array entries — the class the suite previously missed.
//    Each of flagStore / clock / visited allows Array.isArray() but the entries
//    themselves may carry wrong shapes that reach restore() and throw.
//    §10.2 "never throws to the player" + §5.1 hand-edited-localStorage threat.
// ---------------------------------------------------------------------------

describe('V2 — typed-but-malformed array entries (validator + no-throw)', () => {
  // flagStore — must be [string, boolean][] but any array passes isArray()
  it('flagStore with numeric entries: validator rejects', () => {
    expect(validateSaveState(minState({ flagStore: [12345, 'wat', null] as unknown as [] }))).not.toBe(VALIDATION_OK);
  });

  it('flagStore with bad entries: game.turn restore does not throw', () => {
    const storage = new MapStorage();
    const game = makeGame(storage);
    game.turn('save');
    rawMangle(storage, '1', o => { o.flagStore = [12345, 'wat', null]; });
    expect(() => game.turn('restore')).not.toThrow();
  });

  it('flagStore with bad entries: restore returns in-voice corrupt message', () => {
    const storage = new MapStorage();
    const game = makeGame(storage);
    game.turn('save');
    rawMangle(storage, '1', o => { o.flagStore = [12345, 'wat', null]; });
    const r = game.turn('restore');
    expect(r.output).not.toBe('Failed.');
    expect(r.output.toLowerCase()).toMatch(/damaged|corrupt/);
  });

  it('flagStore entry that is a plain object (not a pair): validator rejects', () => {
    expect(validateSaveState(minState({ flagStore: [{ key: 'WON-FLAG', val: true }] as unknown as [] }))).not.toBe(VALIDATION_OK);
  });

  it('flagStore entry where second element is not boolean: validator rejects', () => {
    expect(validateSaveState(minState({ flagStore: [['WON-FLAG', 1]] as unknown as [] }))).not.toBe(VALIDATION_OK);
  });

  it('flagStore entry where first element is not string: validator rejects', () => {
    expect(validateSaveState(minState({ flagStore: [[42, true]] as unknown as [] }))).not.toBe(VALIDATION_OK);
  });

  // clock — must be ClockSnapshot[] (objects with id/turnsLeft/enabled)
  it('clock with primitive entries: validator rejects', () => {
    expect(validateSaveState(minState({ clock: [99, 'bad'] as unknown as [] }))).not.toBe(VALIDATION_OK);
  });

  it('clock entry missing id: validator rejects', () => {
    expect(validateSaveState(minState({ clock: [{ turnsLeft: 1, enabled: true }] as unknown as [] }))).not.toBe(VALIDATION_OK);
  });

  it('clock entry with numeric id: validator rejects', () => {
    expect(validateSaveState(minState({ clock: [{ id: 42, turnsLeft: 1, enabled: true }] as unknown as [] }))).not.toBe(VALIDATION_OK);
  });

  it('clock entry with string-valued turnsLeft: validator rejects', () => {
    expect(validateSaveState(minState({ clock: [{ id: 'I-FIGHT', turnsLeft: 'bad', enabled: true }] as unknown as [] }))).not.toBe(VALIDATION_OK);
  });

  it('clock with bad entries: game.turn restore does not throw', () => {
    const storage = new MapStorage();
    const game = makeGame(storage);
    game.turn('save');
    rawMangle(storage, '1', o => { o.clock = [99, 'oops']; });
    expect(() => game.turn('restore')).not.toThrow();
  });

  // visited — must be string[]
  it('visited with numeric entries: validator rejects', () => {
    expect(validateSaveState(minState({ visited: [42, null] as unknown as string[] }))).not.toBe(VALIDATION_OK);
  });

  it('visited with non-string entries: game.turn restore does not throw', () => {
    const storage = new MapStorage();
    const game = makeGame(storage);
    game.turn('save');
    rawMangle(storage, '1', o => { o.visited = [42, null]; });
    expect(() => game.turn('restore')).not.toThrow();
  });

  // Unknown string hereId — §5.1 clamp: must not throw, room stays unchanged
  it('hereId with unknown string: game.turn restore does not throw', () => {
    const storage = new MapStorage();
    const game = makeGame(storage);
    game.turn('north');  // move away from start
    game.turn('save');
    rawMangle(storage, '1', o => { o.hereId = 'NONEXISTENT-ROOM-XYZ'; });
    expect(() => game.turn('restore')).not.toThrow();
  });

  // Unknown string object id — §5.1: skipped, never throws
  it('objects entry with unknown string id: game.turn restore does not throw', () => {
    const storage = new MapStorage();
    const game = makeGame(storage);
    game.turn('save');
    rawMangle(storage, '1', o => {
      (o.objects as unknown[]).push({ id: 'TOTALLY-FAKE-OBJ', parent: null, siblingOrder: null, flags: [], props: [] });
    });
    expect(() => game.turn('restore')).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// 9. Distinction: empty-slot Failed. vs corrupt in-voice (spec OQ-3)
// ---------------------------------------------------------------------------

describe('V2 — empty-slot vs corrupt distinction', () => {
  it('slot never written → "Failed." (faithful no-save behavior)', () => {
    const storage = new MapStorage();
    const game = makeGame(storage);
    const r = game.turn('restore');
    expect(r.output).toBe('Failed.');
  });

  it('slot written then corrupted → in-voice (not "Failed.")', () => {
    const storage = new MapStorage();
    const game = makeGame(storage);
    game.turn('save');
    rawSet(storage, '1', '{truncated');
    const r = game.turn('restore');
    expect(r.output).not.toBe('Failed.');
  });

  it('slot removed after write → "Failed." (slot is now empty)', () => {
    const storage = new MapStorage();
    const port = new LocalStorageSavePort(storage);
    const game = createGame({ seed: 42, savePort: port });
    game.start();
    game.turn('save');
    port.remove('1');
    const r = game.turn('restore');
    expect(r.output).toBe('Failed.');
  });
});
