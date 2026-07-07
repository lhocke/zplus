// tests/shell/save-port-contract.ts
//
// Shared SavePort contract — every adapter (localStorage, fs, and any future
// one) must satisfy this suite identically. Each adapter's own *.test.ts
// file calls runSavePortContract() and adds its adapter-specific tests
// (e.g. the localStorage quota rejection, or FsSavePort's on-disk checks)
// alongside it. All signatures are async per Amendment A.
import { describe, it, expect, beforeEach } from 'vitest';
import { validateSaveState, VALIDATION_OK } from '../../src/shell/save-port.js';
import type { SavePort, ValidationResult } from '../../src/shell/save-port.js';
import { SAVE_FORMAT_VERSION } from '../../src/engine/save-state.js';
import type { SaveState } from '../../src/engine/save-state.js';

export function minimalState(overrides: Partial<SaveState> = {}): SaveState {
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
      thiefState: { thiefHere: false, thiefEngrossed: false, eggSolve: false, cyclowrath: 0, thiefLdesc: '' },
      aboveGroundState: { kitchenWindowFlag: false, rugMoved: false, grateRevealed: false, grunlock: false, singSong: false },
      lightSourceState: { matchCount: 0 },
    },
    ...overrides,
  };
}

export function runSavePortContract(label: string, makePort: () => SavePort | Promise<SavePort>): void {
  describe(`${label} — SavePort contract`, () => {
    let port: SavePort;
    beforeEach(async () => { port = await makePort(); });

    it('write then read returns the same state', async () => {
      await port.write('1', minimalState({ moveCount: 5 }));
      const back = await port.read('1');
      expect(back).toBeDefined();
      expect(back!.moveCount).toBe(5);
      expect(back!.buildId).toBe('test-build');
    });

    it('read on empty slot resolves undefined', async () => {
      expect(await port.read('never-written')).toBeUndefined();
    });

    it('readWithReason on empty slot resolves "empty"', async () => {
      expect(await port.readWithReason('never-written')).toBe('empty');
    });

    it('list returns entries for all written slots', async () => {
      await port.write('1', minimalState({ moveCount: 1 }));
      await port.write('2', minimalState({ moveCount: 2 }));
      await port.write('3', minimalState({ moveCount: 3 }));
      const moves = (await port.list()).map((s) => s.moves).sort((a, b) => a - b);
      expect(moves).toEqual([1, 2, 3]);
    });

    it('remove clears the slot so read resolves undefined', async () => {
      await port.write('1', minimalState());
      await port.remove('1');
      expect(await port.read('1')).toBeUndefined();
    });

    it('remove is a no-op on an absent slot', async () => {
      await expect(port.remove('99')).resolves.toBeUndefined();
    });

    it('overwriting a slot replaces the previous save', async () => {
      await port.write('1', minimalState({ moveCount: 1 }));
      await port.write('1', minimalState({ moveCount: 99 }));
      expect((await port.read('1'))!.moveCount).toBe(99);
    });

    it('list() metadata fields match the written state', async () => {
      await port.write('3', minimalState({ hereId: 'LIVING-ROOM', moveCount: 42, savedAt: '2026-06-01T12:00:00.000Z' }));
      const meta = (await port.list()).find((s) => s.slot === '3');
      expect(meta?.hereName).toBe('LIVING-ROOM');
      expect(meta?.moves).toBe(42);
      expect(meta?.savedAt).toBe('2026-06-01T12:00:00.000Z');
    });

    it('every member returns a Promise (Amendment A interface shape)', () => {
      expect(port.write('p', minimalState())).toBeInstanceOf(Promise);
      expect(port.read('p')).toBeInstanceOf(Promise);
      expect(port.readWithReason('p')).toBeInstanceOf(Promise);
      expect(port.list()).toBeInstanceOf(Promise);
      expect(port.remove('p')).toBeInstanceOf(Promise);
    });
  });
}

export function runValidatorContract(): void {
  describe('validateSaveState — shared validator behavior', () => {
    it('accepts a minimal valid state', () => {
      expect(validateSaveState(minimalState())).toBe(VALIDATION_OK);
    });

    it('rejects null/non-object/array without throwing', () => {
      const check = (v: unknown): ValidationResult => validateSaveState(v as SaveState);
      expect(check(null)).not.toBe(VALIDATION_OK);
      expect(check('string')).not.toBe(VALIDATION_OK);
      expect(check([])).not.toBe(VALIDATION_OK);
    });

    it('rejects a missing required field without throwing', () => {
      const { formatVersion: _fv, ...rest } = minimalState();
      expect(validateSaveState(rest)).not.toBe(VALIDATION_OK);
    });
  });
}
