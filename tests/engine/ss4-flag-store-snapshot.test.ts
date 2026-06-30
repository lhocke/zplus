/**
 * SS4 — FlagStore snapshot() / restore() round-trip.
 *
 * TDD: written before implementation.
 *
 * Done-criteria (spec §9 SS4):
 *   1. Every FlagStore entry round-trips through snapshot/restore.
 *   2. restore() REPLACES the map entirely — a saved false beats a constructor-set true.
 *      (BUOY-FLAG and CAGE-TOP are both true in a fresh Game ctor; a save where they
 *      are false must come back false after restore, not true.)
 *   3. The flagStore field in SaveState is populated correctly end-to-end via
 *      Game.snapshot() and Game.restore().
 */

import { describe, it, expect } from 'vitest';
import { FlagStore } from '../../src/engine/flag-store.js';
import { createGame } from '../../src/engine/bootstrap.js';

// ---------------------------------------------------------------------------
// 1. FlagStore unit — snapshot/restore
// ---------------------------------------------------------------------------

describe('FlagStore snapshot / restore', () => {
  it('snapshot returns all entries as [string, boolean][]', () => {
    const s = new FlagStore();
    s.set('WON-FLAG');
    s.set('MAGIC-FLAG', false);
    s.set('CAGE-TOP', true);

    const snap = s.snapshot();
    // Should contain the three entries we set.
    expect(snap).toEqual(expect.arrayContaining([
      ['WON-FLAG', true],
      ['MAGIC-FLAG', false],
      ['CAGE-TOP', true],
    ]));
  });

  it('snapshot on an empty store returns []', () => {
    const s = new FlagStore();
    expect(s.snapshot()).toEqual([]);
  });

  it('restore re-populates all entries', () => {
    const s = new FlagStore();
    s.set('WON-FLAG');
    s.set('CYCLOPS-FLAG', false);
    const snap = s.snapshot();

    const s2 = new FlagStore();
    s2.restore(snap);
    expect(s2.get('WON-FLAG')).toBe(true);
    expect(s2.get('CYCLOPS-FLAG')).toBe(false);
    expect(s2.get('MAGIC-FLAG')).toBe(false);  // not in snap → default-false
  });

  it('restore REPLACES — a saved false beats any prior true in the map', () => {
    // Seed dest store with WON-FLAG=true, then restore a snap where it is false.
    const dest = new FlagStore();
    dest.set('WON-FLAG', true);

    const src = new FlagStore();
    src.set('WON-FLAG', false);
    dest.restore(src.snapshot());

    expect(dest.get('WON-FLAG')).toBe(false);
  });

  it('restore REPLACES — entries NOT in the snapshot are cleared', () => {
    const dest = new FlagStore();
    dest.set('OLD-FLAG', true);
    dest.set('ANOTHER-FLAG', true);

    // Snapshot from a store that has only MAGIC-FLAG.
    const src = new FlagStore();
    src.set('MAGIC-FLAG');
    dest.restore(src.snapshot());

    expect(dest.get('MAGIC-FLAG')).toBe(true);
    expect(dest.get('OLD-FLAG')).toBe(false);    // wiped by replace
    expect(dest.get('ANOTHER-FLAG')).toBe(false); // wiped by replace
  });
});

// ---------------------------------------------------------------------------
// 2. End-to-end: Game.snapshot().flagStore round-trips through Game.restore()
//    and a ctor-init true (BUOY-FLAG, CAGE-TOP) comes back false when saved false.
// ---------------------------------------------------------------------------

describe('SS4 — Game.snapshot/restore flagStore field', () => {
  it('flagStore is non-empty after game ctor (BUOY-FLAG + CAGE-TOP set true)', () => {
    const g = createGame({ seed: 42 });
    const snap = g.snapshot();
    const entries = new Map(snap.flagStore);
    expect(entries.get('BUOY-FLAG')).toBe(true);
    expect(entries.get('CAGE-TOP')).toBe(true);
  });

  it('flagStore round-trips arbitrary mutations', () => {
    const g = createGame({ seed: 42 });
    // Mutate some flags via the game's internal flag access.
    (g as unknown as { flags: FlagStore }).flags.set('WON-FLAG', true);
    (g as unknown as { flags: FlagStore }).flags.set('DOME-FLAG', true);
    (g as unknown as { flags: FlagStore }).flags.set('BUOY-FLAG', false);

    const snap = g.snapshot();
    const entries = new Map(snap.flagStore);
    expect(entries.get('WON-FLAG')).toBe(true);
    expect(entries.get('DOME-FLAG')).toBe(true);
    expect(entries.get('BUOY-FLAG')).toBe(false);

    // Restore onto fresh game.
    const g2 = createGame({ seed: 42 });
    g2.restore(snap);
    const snap2 = g2.snapshot();
    const entries2 = new Map(snap2.flagStore);
    expect(entries2.get('WON-FLAG')).toBe(true);
    expect(entries2.get('DOME-FLAG')).toBe(true);
    expect(entries2.get('BUOY-FLAG')).toBe(false);
  });

  it('a save where BUOY-FLAG=false restores to false even though fresh ctor sets it true', () => {
    // Build a snapshot where BUOY-FLAG is explicitly false.
    const g = createGame({ seed: 42 });
    (g as unknown as { flags: FlagStore }).flags.set('BUOY-FLAG', false);
    const snap = g.snapshot();

    // Restore onto a fresh game — ctor would have set BUOY-FLAG=true.
    const g2 = createGame({ seed: 42 });
    // Confirm it starts true.
    expect((g2 as unknown as { flags: FlagStore }).flags.get('BUOY-FLAG')).toBe(true);
    // After restore the saved false must win.
    g2.restore(snap);
    expect((g2 as unknown as { flags: FlagStore }).flags.get('BUOY-FLAG')).toBe(false);
  });

  it('a save where CAGE-TOP=false restores to false even though fresh ctor sets it true', () => {
    const g = createGame({ seed: 42 });
    (g as unknown as { flags: FlagStore }).flags.set('CAGE-TOP', false);
    const snap = g.snapshot();

    const g2 = createGame({ seed: 42 });
    expect((g2 as unknown as { flags: FlagStore }).flags.get('CAGE-TOP')).toBe(true);
    g2.restore(snap);
    expect((g2 as unknown as { flags: FlagStore }).flags.get('CAGE-TOP')).toBe(false);
  });
});
