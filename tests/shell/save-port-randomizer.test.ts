import { describe, it, expect } from 'vitest';
import { validateSaveState, VALIDATION_OK } from '../../src/shell/save-port.js';
import { SAVE_FORMAT_VERSION } from '../../src/engine/save-state.js';
import { createGame } from '../../src/engine/bootstrap.js';

function baseVanillaSave(): Record<string, unknown> {
  // Minimal valid vanilla SaveState shape (mirrors the existing validator
  // test's fixture pattern — every KNOWN_TOP_LEVEL_KEYS field, no randomizer).
  return {
    formatVersion: SAVE_FORMAT_VERSION, buildId: 'test', savedAt: new Date().toISOString(),
    moveCount: 0, deaths: 0, dead: false, alwaysLit: false, gameOver: false, lucky: true,
    loadAllowed: 100, loadMax: 100, waterLevel: 0, beachDig: -1,
    hereId: 'WEST-OF-HOUSE', visited: [],
    lastVerb: 'look', lastAction: 'V-LOOK',
    rngMain: 1, rngCombat: 1,
    clock: [], scoring: { baseScore: 0, score: 0, wonFlag: false }, flagStore: [], objects: [],
    parser: {}, moduleGlobals: { thiefState: {}, aboveGroundState: {}, lightSourceState: {} },
  };
}

describe('save-port validator: randomizer block', () => {
  it('a vanilla save (no randomizer field) still validates OK — the format-2 bump does not break vanilla saves', () => {
    expect(validateSaveState(baseVanillaSave())).toBe(VALIDATION_OK);
  });

  it('a well-formed randomizer block validates OK', () => {
    const save = {
      ...baseVanillaSave(),
      randomizer: { seedString: 'ZR1.abc', placements: [['LAMP', 'ATTIC']], timerMs: 1234, firstCommandAt: null },
    };
    expect(validateSaveState(save)).toBe(VALIDATION_OK);
  });

  it('rejects a randomizer block with a non-string seedString', () => {
    const save = { ...baseVanillaSave(), randomizer: { seedString: 123, placements: [], timerMs: 0, firstCommandAt: null } };
    expect(validateSaveState(save)).not.toBe(VALIDATION_OK);
  });

  it('rejects a randomizer block whose placements entries are not [string,string] tuples', () => {
    const save = { ...baseVanillaSave(), randomizer: { seedString: 'ZR1.x', placements: [[1, 2]], timerMs: 0, firstCommandAt: null } };
    expect(validateSaveState(save)).not.toBe(VALIDATION_OK);
  });

  it('rejects a randomizer block with a negative timerMs', () => {
    const save = { ...baseVanillaSave(), randomizer: { seedString: 'ZR1.x', placements: [], timerMs: -5, firstCommandAt: null } };
    expect(validateSaveState(save)).not.toBe(VALIDATION_OK);
  });

  it('still rejects unknown top-level fields (tamper detection unchanged)', () => {
    const save = { ...baseVanillaSave(), injectedField: 'malicious' };
    expect(validateSaveState(save)).not.toBe(VALIDATION_OK);
  });

  it('a format-1 (pre-randomizer) save refuses with version reason, not corrupt', () => {
    const oldSave = { ...baseVanillaSave(), formatVersion: 1 };
    // validateSaveState only checks SHAPE, not version — this pins the
    // shape check passes so the CALLER's formatVersion !== SAVE_FORMAT_VERSION
    // branch (LocalStorageSavePort.readWithReason) is what actually refuses.
    // See phase-4 §5.3: shape validation and version-refusal are separate checks.
    expect(validateSaveState(oldSave)).toBe(VALIDATION_OK);
    expect(oldSave.formatVersion).not.toBe(SAVE_FORMAT_VERSION);
  });
});

describe('Game snapshot/restore: randomizer block', () => {
  it('a vanilla game (no setRandomizerRun call) snapshots with no randomizer field at all', () => {
    const game = createGame({ seed: 42 });
    const state = game.snapshot();
    expect(state.randomizer).toBeUndefined();
    expect(state.formatVersion).toBe(SAVE_FORMAT_VERSION);
  });

  it('a randomized game round-trips its seed string and placements through snapshot/restore', () => {
    const game = createGame({ seed: 42, placementMap: { LAMP: 'ATTIC' } });
    game.setRandomizerRun('ZR1.testseed', [['LAMP', 'ATTIC']]);
    const state = game.snapshot();
    expect(state.randomizer).toEqual({
      seedString: 'ZR1.testseed', placements: [['LAMP', 'ATTIC']], timerMs: 0, firstCommandAt: null,
    });

    const fresh = createGame({ seed: 1 }); // different game instance, vanilla bootstrap
    fresh.restore(state);
    const restoredState = fresh.snapshot();
    expect(restoredState.randomizer).toEqual(state.randomizer);
  });

  it('old (pre-randomizer, formatVersion 1) saves are refused, not silently upgraded', () => {
    const game = createGame({ seed: 42 });
    const state = game.snapshot();
    const tampered = { ...state, formatVersion: 1 };
    expect(() => game.restore(tampered)).toThrow(/formatVersion/);
  });
});
