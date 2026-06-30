/**
 * SS6 — module-global capture/restore.
 *
 * Spec §3.4 / §9 Wave 0 / §10.3 SS-AUDIT.
 *
 * Done-criteria:
 *   1. Every global in the createSession reset list round-trips through
 *      captureModuleGlobals() / applyModuleGlobals().
 *   2. SS-AUDIT lockstep: the capture set ≡ the createSession reset set,
 *      compared at the variable level (not function-name level).
 *   3. Game.snapshot().moduleGlobals / Game.restore() wire through correctly.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createGame } from '../../src/engine/bootstrap.js';
import {
  captureModuleGlobals,
  applyModuleGlobals,
  SS6_VARIABLE_NAMES,
  SESSION_RESET_VARIABLE_NAMES,
} from '../../src/engine/module-globals.js';
import {
  thiefHere, setThiefHere,
  thiefEngrossed, setThiefEngrossed,
  eggSolve, setEggSolve,
  cyclowrath, setCyclowrath,
  thiefLdesc, setThiefLdesc,
  resetThiefState,
  ROBBER_C_DESC,
} from '../../src/actions/thief-state.js';
import {
  resetKitchenWindowFlag,
  resetRugMoved,
  resetGrateRevealed,
  resetGrunlock,
  resetSingSong,
  getSingSong,
  snapshotAboveGroundState,
  restoreAboveGroundState,
} from '../../src/actions/above-ground.js';
import {
  resetMatchCount,
  snapshotLightSourceState,
  restoreLightSourceState,
} from '../../src/actions/light-sources.js';
import {
  snapshotThiefState,
  restoreThiefState,
} from '../../src/actions/thief-state.js';

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function resetAll(): void {
  resetThiefState();
  resetKitchenWindowFlag();
  resetRugMoved();
  resetGrateRevealed();
  resetGrunlock();
  resetSingSong();
  resetMatchCount();
}

// ---------------------------------------------------------------------------
// 1. thief-state.ts snapshot / restore
// ---------------------------------------------------------------------------

describe('SS6 thief-state snapshot / restore', () => {
  beforeEach(resetAll);

  it('captures and restores all five thief globals', () => {
    // Mutate every field away from its reset value.
    setThiefHere(true);
    setThiefEngrossed(true);
    setEggSolve(true);
    setCyclowrath(3);
    setThiefLdesc('unconscious');

    const snap = snapshotThiefState();

    // Reset to defaults.
    resetThiefState();
    expect(thiefHere()).toBe(false);
    expect(thiefEngrossed()).toBe(false);
    expect(eggSolve()).toBe(false);
    expect(cyclowrath()).toBe(0);
    expect(thiefLdesc()).toBe(ROBBER_C_DESC);

    // Restore — must come back to the mutated values.
    restoreThiefState(snap);
    expect(thiefHere()).toBe(true);
    expect(thiefEngrossed()).toBe(true);
    expect(eggSolve()).toBe(true);
    expect(cyclowrath()).toBe(3);
    expect(thiefLdesc()).toBe('unconscious');
  });

  it('snapshot captures reset values correctly', () => {
    // After resetAll, every thief field is at its reset value.
    const snap = snapshotThiefState();
    expect(snap.thiefHere).toBe(false);
    expect(snap.thiefEngrossed).toBe(false);
    expect(snap.eggSolve).toBe(false);
    expect(snap.cyclowrath).toBe(0);
    expect(snap.thiefLdesc).toBe(ROBBER_C_DESC);
  });
});

// ---------------------------------------------------------------------------
// 2. above-ground.ts snapshot / restore
// ---------------------------------------------------------------------------

describe('SS6 above-ground snapshot / restore', () => {
  beforeEach(resetAll);

  it('captures and restores all five above-ground globals', () => {
    // Can't set these directly; they are private lets.
    // We go through the public seam: snapshot initially false, mutate via
    // restoreAboveGroundState with non-default values, then round-trip.
    const mutated = {
      kitchenWindowFlag: true,
      rugMoved: true,
      grateRevealed: true,
      grunlock: true,
      singSong: true,
    };
    restoreAboveGroundState(mutated);

    const snap = snapshotAboveGroundState();
    expect(snap.kitchenWindowFlag).toBe(true);
    expect(snap.rugMoved).toBe(true);
    expect(snap.grateRevealed).toBe(true);
    expect(snap.grunlock).toBe(true);
    expect(snap.singSong).toBe(true);

    // Reset and restore.
    resetAll();
    expect(getSingSong()).toBe(false);

    restoreAboveGroundState(snap);
    const snap2 = snapshotAboveGroundState();
    expect(snap2.kitchenWindowFlag).toBe(true);
    expect(snap2.rugMoved).toBe(true);
    expect(snap2.grateRevealed).toBe(true);
    expect(snap2.grunlock).toBe(true);
    expect(snap2.singSong).toBe(true);
  });

  it('snapshot captures reset values correctly', () => {
    const snap = snapshotAboveGroundState();
    expect(snap.kitchenWindowFlag).toBe(false);
    expect(snap.rugMoved).toBe(false);
    expect(snap.grateRevealed).toBe(false);
    expect(snap.grunlock).toBe(false);
    expect(snap.singSong).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 3. light-sources.ts snapshot / restore
// ---------------------------------------------------------------------------

describe('SS6 light-sources snapshot / restore', () => {
  beforeEach(resetAll);

  it('captures and restores matchCount', () => {
    // Restore with a mutated value.
    restoreLightSourceState({ matchCount: 2 });
    const snap = snapshotLightSourceState();
    expect(snap.matchCount).toBe(2);

    resetAll();
    const snap2 = snapshotLightSourceState();
    expect(snap2.matchCount).toBe(6);

    restoreLightSourceState(snap);
    expect(snapshotLightSourceState().matchCount).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// 4. captureModuleGlobals / applyModuleGlobals aggregate
// ---------------------------------------------------------------------------

describe('SS6 captureModuleGlobals / applyModuleGlobals', () => {
  beforeEach(resetAll);

  it('captures all globals at reset values', () => {
    const g = captureModuleGlobals();
    // Thief.
    expect(g.thiefState.thiefHere).toBe(false);
    expect(g.thiefState.cyclowrath).toBe(0);
    expect(g.thiefState.thiefLdesc).toBe(ROBBER_C_DESC);
    // Above-ground.
    expect(g.aboveGroundState.kitchenWindowFlag).toBe(false);
    expect(g.aboveGroundState.singSong).toBe(false);
    // Light.
    expect(g.lightSourceState.matchCount).toBe(6);
  });

  it('round-trips mutated state through capture/apply', () => {
    setThiefHere(true);
    setCyclowrath(5);
    restoreAboveGroundState({ kitchenWindowFlag: true, rugMoved: false, grateRevealed: false, grunlock: false, singSong: true });
    restoreLightSourceState({ matchCount: 1 });

    const snap = captureModuleGlobals();

    resetAll();
    // All back to defaults.
    expect(thiefHere()).toBe(false);
    expect(getSingSong()).toBe(false);

    applyModuleGlobals(snap);
    expect(thiefHere()).toBe(true);
    expect(cyclowrath()).toBe(5);
    expect(getSingSong()).toBe(true);
    expect(snapshotLightSourceState().matchCount).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 5. SS-AUDIT lockstep — variable-level list equality (spec §10.3)
//
// The capture list and the createSession reset list must enumerate the
// SAME concrete variable names.  A function like resetThiefState() clears
// multiple fields; the lockstep test must compare the per-variable names,
// not the reset-function names.
// ---------------------------------------------------------------------------

describe('SS-AUDIT lockstep — capture ≡ reset variable names', () => {
  it('SS6_VARIABLE_NAMES equals SESSION_RESET_VARIABLE_NAMES', () => {
    // Both exports are sorted arrays of concrete variable names.
    const capture = [...SS6_VARIABLE_NAMES].sort();
    const reset   = [...SESSION_RESET_VARIABLE_NAMES].sort();
    expect(capture).toEqual(reset);
  });
});

// ---------------------------------------------------------------------------
// 6. Game.snapshot().moduleGlobals round-trips through Game.restore()
// ---------------------------------------------------------------------------

describe('SS6 Game-level moduleGlobals round-trip', () => {
  beforeEach(resetAll);

  it('moduleGlobals is populated in snapshot() and restored in restore()', () => {
    // Mutate module globals before snapshotting.
    setThiefHere(true);
    setCyclowrath(7);
    restoreLightSourceState({ matchCount: 3 });

    const g = createGame({ seed: 42 });
    const snap = g.snapshot();

    // Verify captured.
    expect(snap.moduleGlobals.thiefState.thiefHere).toBe(true);
    expect(snap.moduleGlobals.thiefState.cyclowrath).toBe(7);
    expect(snap.moduleGlobals.lightSourceState.matchCount).toBe(3);

    // Reset and restore onto a fresh game.
    resetAll();
    expect(thiefHere()).toBe(false);
    expect(cyclowrath()).toBe(0);
    expect(snapshotLightSourceState().matchCount).toBe(6);

    const g2 = createGame({ seed: 42 });
    g2.restore(snap);

    // After restore the module globals must reflect the saved values.
    expect(thiefHere()).toBe(true);
    expect(cyclowrath()).toBe(7);
    expect(snapshotLightSourceState().matchCount).toBe(3);
  });

  it('moduleGlobals survive snapshot → restore → snapshot fixpoint', () => {
    setThiefEngrossed(true);
    setEggSolve(true);
    restoreAboveGroundState({ kitchenWindowFlag: false, rugMoved: true, grateRevealed: true, grunlock: false, singSong: false });

    const g1 = createGame({ seed: 42 });
    const snap1 = g1.snapshot();

    resetAll();
    const g2 = createGame({ seed: 42 });
    g2.restore(snap1);
    const snap2 = g2.snapshot();

    // Deep-compare the moduleGlobals sub-object.
    expect(snap2.moduleGlobals).toEqual(snap1.moduleGlobals);
  });
});
