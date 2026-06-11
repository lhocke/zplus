/**
 * F1 — Thief/cyclops globals + flags
 *
 * Done-criteria:
 *   - THIEF-HERE, THIEF-ENGROSSED, EGG-SOLVE, CYCLOWRATH init to ZIL values
 *     (CYCLOWRATH=0, rest false/<>)
 *   - FlagStore round-trips MAGIC-FLAG and CYCLOPS-FLAG
 *   - LUCKY=true at Game construction
 *   - ROBBER-C-DESC and ROBBER-U-DESC string constants are present
 *   - Mutable thief LDESC starts at ROBBER-C-DESC (conscious)
 *   - SING-SONG reconciliation: singSong exported from above-ground.ts IS the
 *     canonical field; no parallel global created
 *   - All values reset cleanly for test isolation
 *
 * ZIL citations:
 *   THIEF-HERE:      1actions.zil:1754
 *   THIEF-ENGROSSED: 1actions.zil:1945
 *   EGG-SOLVE:       1actions.zil:1748
 *   CYCLOWRATH:      1actions.zil:1513  (<GLOBAL CYCLOWRATH 0>)
 *   SING-SONG:       1actions.zil:2968  (<GLOBAL SING-SONG <>>)
 *   ROBBER-C-DESC:   1actions.zil:2086
 *   ROBBER-U-DESC:   1actions.zil:2090
 *   MAGIC-FLAG:      1dungeon.zil:1231
 *   CYCLOPS-FLAG:    rooms.json exit ifFlag (1dungeon.zil:1343 region)
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  thiefHere, setThiefHere,
  thiefEngrossed, setThiefEngrossed,
  eggSolve, setEggSolve,
  cyclowrath, setCyclowrath,
  thiefLdesc, setThiefLdesc,
  ROBBER_C_DESC, ROBBER_U_DESC,
  resetThiefState,
} from '../../src/actions/thief-state.js';
import { getSingSong, resetSingSong } from '../../src/actions/above-ground.js';
import { FlagStore } from '../../src/engine/flag-store.js';
import { createGame } from '../../src/engine/bootstrap.js';

// ---------------------------------------------------------------------------
// 1. Plain game-state globals — init to ZIL values
// ---------------------------------------------------------------------------

describe('thief-state: initial values match ZIL', () => {
  beforeEach(() => { resetThiefState(); });

  it('THIEF-HERE starts false (<>)', () => {
    expect(thiefHere()).toBe(false);
  });

  it('THIEF-ENGROSSED starts false (<>)', () => {
    expect(thiefEngrossed()).toBe(false);
  });

  it('EGG-SOLVE starts false (<>)', () => {
    expect(eggSolve()).toBe(false);
  });

  it('CYCLOWRATH starts 0', () => {
    expect(cyclowrath()).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 2. Setters and round-trips
// ---------------------------------------------------------------------------

describe('thief-state: setters', () => {
  beforeEach(() => { resetThiefState(); });

  it('setThiefHere(true) makes thiefHere() return true', () => {
    setThiefHere(true);
    expect(thiefHere()).toBe(true);
  });

  it('setThiefEngrossed(true) makes thiefEngrossed() return true', () => {
    setThiefEngrossed(true);
    expect(thiefEngrossed()).toBe(true);
  });

  it('setEggSolve(true) makes eggSolve() return true', () => {
    setEggSolve(true);
    expect(eggSolve()).toBe(true);
  });

  it('setCyclowrath sets and reads back', () => {
    setCyclowrath(3);
    expect(cyclowrath()).toBe(3);
    setCyclowrath(-2);
    expect(cyclowrath()).toBe(-2);
  });
});

// ---------------------------------------------------------------------------
// 3. resetThiefState restores all to initial values
// ---------------------------------------------------------------------------

describe('thief-state: resetThiefState', () => {
  it('resets everything to ZIL init', () => {
    setThiefHere(true);
    setThiefEngrossed(true);
    setEggSolve(true);
    setCyclowrath(5);
    resetThiefState();
    expect(thiefHere()).toBe(false);
    expect(thiefEngrossed()).toBe(false);
    expect(eggSolve()).toBe(false);
    expect(cyclowrath()).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 4. ROBBER-C-DESC and ROBBER-U-DESC string constants (1actions.zil:2086/2090)
// ---------------------------------------------------------------------------

describe('ROBBER_C_DESC / ROBBER_U_DESC', () => {
  it('ROBBER_C_DESC contains the conscious thief description', () => {
    // 1actions.zil:2086–2088 verbatim fragment
    expect(ROBBER_C_DESC).toContain('suspicious-looking individual');
    expect(ROBBER_C_DESC).toContain('stiletto');
  });

  it('ROBBER_U_DESC contains the unconscious thief description', () => {
    // 1actions.zil:2090–2092 verbatim fragment
    expect(ROBBER_U_DESC).toContain('suspicious-looking individual');
    expect(ROBBER_U_DESC).toContain('unconscious');
  });
});

// ---------------------------------------------------------------------------
// 5. Mutable thief LDESC — starts at ROBBER_C_DESC, settable
// ---------------------------------------------------------------------------

describe('thief LDESC', () => {
  beforeEach(() => { resetThiefState(); });

  it('thiefLdesc() starts at ROBBER_C_DESC', () => {
    expect(thiefLdesc()).toBe(ROBBER_C_DESC);
  });

  it('setThiefLdesc updates the value', () => {
    setThiefLdesc(ROBBER_U_DESC);
    expect(thiefLdesc()).toBe(ROBBER_U_DESC);
  });

  it('resetThiefState restores LDESC to ROBBER_C_DESC', () => {
    setThiefLdesc(ROBBER_U_DESC);
    resetThiefState();
    expect(thiefLdesc()).toBe(ROBBER_C_DESC);
  });
});

// ---------------------------------------------------------------------------
// 6. SING-SONG reconciliation: singSong IS the canonical module field
//    (no parallel global — wired via export from above-ground.ts)
// ---------------------------------------------------------------------------

describe('SING-SONG reconciliation', () => {
  beforeEach(() => { resetSingSong(); });

  it('getSingSong() exported from above-ground.ts starts false', () => {
    expect(getSingSong()).toBe(false);
  });

  it('resetSingSong() restores to false', () => {
    // resetSingSong is already present; confirm exported read function exists
    resetSingSong();
    expect(getSingSong()).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 7. FlagStore round-trips MAGIC-FLAG and CYCLOPS-FLAG (FlagStore keys)
// ---------------------------------------------------------------------------

describe('FlagStore: MAGIC-FLAG and CYCLOPS-FLAG round-trips', () => {
  it('MAGIC-FLAG defaults false, sets true, resets false', () => {
    const store = new FlagStore();
    expect(store.get('MAGIC-FLAG')).toBe(false);
    store.set('MAGIC-FLAG');
    expect(store.get('MAGIC-FLAG')).toBe(true);
    store.reset();
    expect(store.get('MAGIC-FLAG')).toBe(false);
  });

  it('CYCLOPS-FLAG defaults false, sets true, resets false', () => {
    const store = new FlagStore();
    expect(store.get('CYCLOPS-FLAG')).toBe(false);
    store.set('CYCLOPS-FLAG');
    expect(store.get('CYCLOPS-FLAG')).toBe(true);
    store.reset();
    expect(store.get('CYCLOPS-FLAG')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 8. LUCKY=true at Game construction (guards every thief two-arg PROB)
//    1actions.zil:969 — <GLOBAL LUCKY T>
// ---------------------------------------------------------------------------

describe('Game.lucky=true at construction', () => {
  it('createGame() has lucky===true', () => {
    const g = createGame();
    expect((g as unknown as { lucky: boolean }).lucky).toBe(true);
  });
});
