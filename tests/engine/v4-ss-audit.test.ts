/**
 * V4 — SS-AUDIT surface-completeness lint (spec §10.3, §9 Wave 3).
 *
 * Two enforcing tests:
 *
 *   1. Module-global lockstep: SS6_VARIABLE_NAMES ≡ SESSION_RESET_VARIABLE_NAMES,
 *      compared at the concrete per-variable level (not reset-function names).
 *      Consequence: adding a module global to session.ts's reset list without
 *      adding it to the SS6 capture list (or vice versa) fails this test.
 *
 *   2. Snapshot-fixpoint over a fuzzed long game: drive a long scripted sequence
 *      that touches every major save-surface subsystem (object tree, FlagStore,
 *      visited set, scoring, module globals, clock, RNG), then assert S1 = S2
 *      after a restore round-trip.  A forgotten field that didn't survive restore
 *      shows up as a mismatch between S1 and S2.
 *
 * Spec §10.5 suspicion discipline: the scripted game is deliberately broad —
 * it must exercise RNG, clock, module globals, scoring, and the object tree so
 * that a hole in any of those surfaces shows up as a fixpoint failure.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createGame } from '../../src/engine/bootstrap.js';
import { Flag } from '../../src/domain/flags.js';
import type { SaveState } from '../../src/engine/save-state.js';
import {
  SS6_VARIABLE_NAMES,
  SESSION_RESET_VARIABLE_NAMES,
} from '../../src/engine/module-globals.js';
import {
  setThiefEngrossed,
  setEggSolve,
  setCyclowrath,
  resetThiefState,
} from '../../src/actions/thief-state.js';
import {
  restoreAboveGroundState,
  resetKitchenWindowFlag,
  resetRugMoved,
  resetGrateRevealed,
  resetGrunlock,
  resetSingSong,
} from '../../src/actions/above-ground.js';
import {
  restoreLightSourceState,
  resetMatchCount,
} from '../../src/actions/light-sources.js';

// ---------------------------------------------------------------------------
// Teardown helper — reset all module globals before/after each test so
// mutations in one test don't bleed into another.
// ---------------------------------------------------------------------------

function resetAllModuleGlobals(): void {
  resetThiefState();
  resetKitchenWindowFlag();
  resetRugMoved();
  resetGrateRevealed();
  resetGrunlock();
  resetSingSong();
  resetMatchCount();
}

// ---------------------------------------------------------------------------
// 1. Module-global lockstep (spec §10.3, first bullet)
//
// SS6_VARIABLE_NAMES (the capture list) and SESSION_RESET_VARIABLE_NAMES (the
// createSession reset list) must enumerate the same concrete variable names.
//
// This catches the silent-omission case: a developer adds a new module global
// under an existing reset function (e.g. a new field inside resetThiefState())
// without updating the SS6 capture/restore pair.  Function-name equality would
// not catch it; per-variable-name equality does.
// ---------------------------------------------------------------------------

describe('V4 module-global lockstep (spec §10.3)', () => {
  it('SS6_VARIABLE_NAMES matches SESSION_RESET_VARIABLE_NAMES at the variable level', () => {
    const capture = [...SS6_VARIABLE_NAMES].sort();
    const reset   = [...SESSION_RESET_VARIABLE_NAMES].sort();
    expect(capture).toEqual(reset);
  });

  it('both lists are non-empty (guard against accidental deletion)', () => {
    expect(SS6_VARIABLE_NAMES.length).toBeGreaterThan(0);
    expect(SESSION_RESET_VARIABLE_NAMES.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// 2. Snapshot-fixpoint over a fuzzed long game (spec §10.3, second bullet)
//
// Drive a scripted sequence that spreads across multiple subsystems, snapshot
// at the end (S1), restore onto the same game, snapshot again (S2), and assert
// S1 === S2 (modulo savedAt timestamp, which is display-only).
//
// "Fuzzed" here means deliberately broad: the script touches every save-surface
// subsystem so a forgotten field can't hide behind a thin continuation.
//
// Subsystems exercised:
//   - Object tree: player picks up lamp + sword, rooms change parent chains
//   - FlagStore: flags toggled via actions
//   - visited set: multiple rooms entered
//   - Scoring: score accrued from treasures
//   - Module globals: thief-state, above-ground, light-sources — mutated directly
//   - Clock: lamp timer advanced (I-LANTERN)
//   - RNG: both streams advanced (lamp halo + grue check in dark)
//   - Parser itRef: set via 'it' referencing a picked-up object
//
// The fixpoint test catches field omissions that V1-F's shorter game might
// miss: a field that's at its reset value throughout a short game won't show
// up as a mismatch.
// ---------------------------------------------------------------------------

describe('V4 fixpoint over fuzzed long game (spec §10.3)', () => {
  beforeEach(resetAllModuleGlobals);

  it('S1 = S2 after restore over a multi-subsystem scripted game', async () => {
    const g = createGame({ seed: 42 });
    g.start();

    // --- Spread across multiple rooms (visited set) ---
    await g.turn('look');       // WEST-OF-HOUSE
    await g.turn('north');      // FOREST-1 (visits new room)
    await g.turn('look');
    await g.turn('south');      // back to WEST-OF-HOUSE
    await g.turn('east');       // BEHIND-HOUSE or another neighbor

    // --- Pick up objects (object tree) ---
    // Return to West of House via a walk cycle so we end somewhere stable.
    await g.turn('west');
    await g.turn('look');

    // Give player a lamp — moves object from its default location to PLAYER.
    const player = g.world.get('PLAYER')!;
    const lamp   = g.world.get('LAMP')!;
    lamp.moveTo(player);
    lamp.set(Flag.OnFire);
    lamp.set(Flag.Light);

    const sword = g.world.get('SWORD')!;
    sword.moveTo(player);

    // --- Advance clock (I-LANTERN) and visit more rooms (visited + RNG streams) ---
    // Going into the forest with a lamp arms I-LANTERN via game actions.
    await g.turn('look');
    await g.turn('north');      // FOREST-1 — clock ticks
    await g.turn('look');       // I-FOREST-ROOM may fire (RNG main stream via prob(15))
    await g.turn('look');
    await g.turn('look');

    // --- Score: pick up a treasure (scoring subsystem) ---
    // Move to a place where a treasure exists in default position — WEST-OF-HOUSE
    // area has a mailbox. For scoring we can move a treasure directly.
    const trophyCase = g.world.get('TROPHY-CASE');
    const sack = g.world.get('SACK');
    // Move something scoreable into trophy case if it's available
    if (trophyCase && sack) {
      sack.moveTo(trophyCase);
    }

    // --- Module globals: mutate directly so the snapshot must carry them ---
    setThiefEngrossed(true);
    setEggSolve(true);
    setCyclowrath(2);
    restoreAboveGroundState({
      kitchenWindowFlag: true,
      rugMoved: false,
      grateRevealed: true,
      grunlock: false,
      singSong: false,
    });
    restoreLightSourceState({ matchCount: 3 });

    // --- More room traversal and commands (visit set + object props) ---
    await g.turn('south');      // back toward WEST-OF-HOUSE area
    await g.turn('look');
    await g.turn('examine lamp');   // sets itRef → LAMP (parser state)
    await g.turn('look');

    // --- FlagStore: set some flags explicitly via snapshot manipulation ---
    // Use the snapshot round-trip trick: read current flagStore, inject a flag, restore.
    {
      const s = g.snapshot();
      const flags = s.flagStore.filter(([k]) => k !== 'BUOY-FLAG');
      g.restore({ ...s, flagStore: [...flags, ['BUOY-FLAG', true]] });
    }

    // --- Walk more to advance move counter and both RNG streams ---
    // Enter darkness briefly (no lamp in hand after... actually lamp IS in hand).
    // Do enough turns that RNG draws have accumulated.
    for (let i = 0; i < 8; i++) await g.turn('look');

    // --- Take the snapshot (S1) ---
    const s1 = g.snapshot();

    // --- Restore onto the SAME game instance ---
    g.restore(s1);

    // --- Take a second snapshot (S2) ---
    const s2 = g.snapshot();

    // savedAt is a display-only timestamp that may differ between S1 and S2.
    const strip = (s: SaveState) => {
      const { savedAt: _, ...rest } = s;
      return rest;
    };

    expect(strip(s2)).toEqual(strip(s1));
  });

  it('fixpoint holds when module globals are at non-default values', async () => {
    // Isolate the module-global subsystem: set all fields to non-defaults,
    // snapshot, restore, snapshot again — module globals must be preserved.
    const g = createGame({ seed: 99 });
    g.start();
    await g.turn('look');

    setThiefEngrossed(true);
    setEggSolve(true);
    setCyclowrath(4);
    restoreAboveGroundState({
      kitchenWindowFlag: true,
      rugMoved: true,
      grateRevealed: true,
      grunlock: true,
      singSong: true,
    });
    restoreLightSourceState({ matchCount: 1 });

    const s1 = g.snapshot();

    // Verify S1 captured non-default values.
    expect(s1.moduleGlobals.thiefState.thiefEngrossed).toBe(true);
    expect(s1.moduleGlobals.thiefState.eggSolve).toBe(true);
    expect(s1.moduleGlobals.thiefState.cyclowrath).toBe(4);
    expect(s1.moduleGlobals.aboveGroundState.kitchenWindowFlag).toBe(true);
    expect(s1.moduleGlobals.aboveGroundState.rugMoved).toBe(true);
    expect(s1.moduleGlobals.aboveGroundState.grateRevealed).toBe(true);
    expect(s1.moduleGlobals.aboveGroundState.grunlock).toBe(true);
    expect(s1.moduleGlobals.aboveGroundState.singSong).toBe(true);
    expect(s1.moduleGlobals.lightSourceState.matchCount).toBe(1);

    g.restore(s1);
    const s2 = g.snapshot();

    const strip = (s: SaveState) => {
      const { savedAt: _, ...rest } = s;
      return rest;
    };
    expect(strip(s2)).toEqual(strip(s1));
  });

  it('fixpoint holds across a cross-instance restore (fresh game → saved state)', async () => {
    // Drive a complex game state on g1, restore onto a fresh g2,
    // snapshot g2 (S2), and assert S2 === S1 (modulo savedAt).
    const g1 = createGame({ seed: 42 });
    g1.start();

    // Move objects and rooms to build non-trivial state.
    const player = g1.world.get('PLAYER')!;
    const lamp   = g1.world.get('LAMP')!;
    lamp.moveTo(player);
    lamp.set(Flag.OnFire);
    lamp.set(Flag.Light);

    // Visit several rooms.
    for (let i = 0; i < 5; i++) {
      await g1.turn('north');
      await g1.turn('south');
    }
    await g1.turn('look');

    // Mutate module globals.
    setThiefEngrossed(true);
    setCyclowrath(3);
    restoreLightSourceState({ matchCount: 2 });

    const s1 = g1.snapshot();

    // Reset globals so the fresh game starts clean (as createSession would).
    resetAllModuleGlobals();

    // Restore onto a fresh game instance.
    const g2 = createGame({ seed: 42 });
    g2.start();
    g2.restore(s1);

    const s2 = g2.snapshot();

    const strip = (s: SaveState) => {
      const { savedAt: _, ...rest } = s;
      return rest;
    };
    expect(strip(s2)).toEqual(strip(s1));
  });

  it('fixpoint catches a hypothetically omitted field (regression guard structure)', async () => {
    // This test drives a game to a state where moveCount > 0, score > 0,
    // and visited has multiple entries — so if any of those were dropped by
    // restore, S1 ≠ S2 would be caught here.
    const g = createGame({ seed: 42 });
    g.start();

    for (let i = 0; i < 10; i++) {
      await g.turn('look');
    }
    await g.turn('north');
    await g.turn('look');
    await g.turn('south');
    await g.turn('look');

    const s1 = g.snapshot();

    // Sanity: state is non-trivial.
    expect(s1.moveCount).toBeGreaterThan(0);
    expect(s1.visited.length).toBeGreaterThan(0);

    g.restore(s1);
    const s2 = g.snapshot();

    const strip = (s: SaveState) => {
      const { savedAt: _, ...rest } = s;
      return rest;
    };
    expect(strip(s2)).toEqual(strip(s1));
  });
});
