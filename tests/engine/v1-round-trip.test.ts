/**
 * V1 — Round-trip property tests (the save-correctness oracle).
 *
 * Spec §10.1: for any command sequence, `play N → save → play M → restore →
 * replay M` produces a byte-identical second-M transcript.  Green only when
 * EVERY mutable field the continuation touches round-trips faithfully.
 *
 * A-F per §9 Wave 3:
 *   A — deterministic continuation: baseline proof
 *   B — both RNG streams fire in M: SS-RNG NM guard
 *   C — lamp fuel-stage fires in M: SS2 tableIndex guard
 *   D — module-global read after restore: SS6 NM guard
 *   E — mid-life save → restore onto a fresh game → view() matches
 *   F — snapshot/restore/snapshot fixpoint (idempotence)
 *
 * §10.5 suspicion discipline: B/C/D each include an assertion proving the
 * subsystem was actually exercised (non-thin continuation).
 *
 * Real Rng throughout — spec §3.2 forbids stubs in save-exercising tests.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createGame } from '../../src/engine/bootstrap.js';
import { Flag } from '../../src/domain/flags.js';
import type { SaveState } from '../../src/engine/save-state.js';
import {
  setThiefEngrossed,
  thiefEngrossed,
  resetThiefState,
} from '../../src/actions/thief-state.js';

/**
 * Play a sequence of commands, returning each turn's output.
 * Returns empty string for commands played on a dead game (gameOver).
 */
async function play(g: ReturnType<typeof createGame>, cmds: string[]): Promise<string[]> {
  const outputs: string[] = [];
  for (const cmd of cmds) {
    outputs.push((await g.turn(cmd)).output);
  }
  return outputs;
}

// ---------------------------------------------------------------------------
// A — Deterministic continuation
//
// N commands → save → M commands (no RNG draws, deterministic outputs)
// → restore → replay M → byte-identical.
// ---------------------------------------------------------------------------

describe('V1-A deterministic round-trip', () => {
  it('M-segment outputs are byte-identical after restore', async () => {
    const g = createGame({ seed: 42 });
    g.start();

    // N: navigate west of house (lit, no randomness)
    await g.turn('look');
    await g.turn('look');

    const snap = g.snapshot();

    // M: deterministic commands — all-text, no RNG draws
    const M = ['look', 'north', 'look'];
    const path1 = await play(g, M);

    // Restore and replay
    g.restore(snap);
    const path2 = await play(g, M);

    expect(path2).toEqual(path1);
  });

  it('move count, score, and room are restored identically', async () => {
    const g = createGame({ seed: 42 });
    g.start();

    await g.turn('look');  // move 1
    const snap = g.snapshot();

    await g.turn('look');  // move 2
    await g.turn('look');  // move 3

    g.restore(snap);

    const v = g.view();
    expect(v.moves).toBe(snap.moveCount);
    expect(v.here).toBe(snap.hereId);
    expect(v.score).toBe(snap.scoring.score);
  });
});

// ---------------------------------------------------------------------------
// B — Randomness-touching continuation
//
// M-segment draws from BOTH RNG streams:
//   - main (this.rng): grue check in the dark via rng.prob(80)
//   - combat (this.combatRng): villain blow + hero blow during troll fight
//
// NM: if a single position were saved and restored onto both streams, the two
// sequences would re-couple, diverging from the saved game.  A byte-identical
// replay with independent stream restoration proves the NM is prevented.
// ---------------------------------------------------------------------------

describe('V1-B dual-RNG-stream round-trip', () => {
  it('M-segment (combat + dark grue check) is byte-identical after restore', async () => {
    // Start at TROLL-ROOM with lit lamp + sword so combat is possible.
    const g = createGame({ seed: 42, startRoom: 'TROLL-ROOM' });
    g.start();

    const w = g.world;
    const player = w.get('PLAYER')!;
    const lamp = w.get('LAMP')!;
    const sword = w.get('SWORD')!;
    lamp.moveTo(player);
    lamp.set(Flag.OnFire);
    lamp.set(Flag.Light);
    sword.moveTo(player);

    // N: non-RNG setup (examines only)
    await g.turn('look');
    await g.turn('examine troll');

    const snapBefore = g.snapshot();
    const rngMainBefore = snapBefore.rngMain;
    const rngCombatBefore = snapBefore.rngCombat;

    // M: (1) attack troll — fires combatRng for villain/hero blows
    //    (2) turn off lamp — deterministic
    //    (3) north (no exit, dark) — fires main rng via prob(80) grue check
    const M = ['attack troll with sword', 'turn off lamp', 'north'];
    const path1 = await play(g, M);

    const snapAfter = g.snapshot();
    const rngMainAfter = snapAfter.rngMain;
    const rngCombatAfter = snapAfter.rngCombat;

    // §10.5 non-thin assertion: both streams must have advanced.
    // combat stream: attack troll fires combatRng (villain + hero blow).
    expect(rngCombatAfter).not.toBe(rngCombatBefore);
    // main stream: grue check in dark fires rng.prob(80).
    expect(rngMainAfter).not.toBe(rngMainBefore);

    // Restore and replay — outputs must be byte-identical.
    g.restore(snapBefore);
    const path2 = await play(g, M);

    expect(path2).toEqual(path1);
  });
});

// ---------------------------------------------------------------------------
// C — Timer-touching continuation
//
// Position the lamp clock at a stage near its next warning, then verify
// the warning fires in M at the right turn.  After restore, the same turn
// triggers the same warning — proving SS2 (tableIndex) round-trips.
// ---------------------------------------------------------------------------

describe('V1-C fuel-stage round-trip (SS2)', () => {
  it('lamp warning fires at the same turn after restore', async () => {
    const g = createGame({ seed: 42, startRoom: 'TROLL-ROOM' });
    g.start();

    const w = g.world;
    const player = w.get('PLAYER')!;
    const lamp = w.get('LAMP')!;
    lamp.moveTo(player);
    lamp.set(Flag.OnFire);
    lamp.set(Flag.Light);

    // Directly manipulate the clock snapshot to position the lamp at the
    // second warning stage (tableIndex=1, turnsLeft=2) so the warning
    // "The lamp is definitely dimmer now." fires after 2 more turns.
    // We do this by snapshotting, editing the clock entry, then restoring.
    const setupSnap = g.snapshot();
    const clockSnaps = setupSnap.clock.map(entry => {
      if (entry.id !== 'I-LANTERN') return entry;
      return {
        ...entry,
        enabled: true,
        turnsLeft: 2,      // 2 turns until next warning
        aux: { tableIndex: 1 },  // stage 1 = "definitely dimmer"
      };
    });
    g.restore({ ...setupSnap, clock: clockSnaps });

    // N: one look (1 of the 2 ticks drains)
    const r0 = await g.turn('look');
    expect(r0.output).not.toContain('dimmer');

    const snap = g.snapshot();

    // M: turn that fires the warning
    const M = ['look'];
    const path1 = await play(g, M);

    // §10.5 non-thin: the warning must appear in M (proves fuel stage fires).
    expect(path1[0]).toContain('dimmer');

    // Restore and replay
    g.restore(snap);
    const path2 = await play(g, M);

    expect(path2).toEqual(path1);
  });
});

// ---------------------------------------------------------------------------
// D — Module-global continuation (SS6 NM guard)
//
// The N-segment sets a thief-state global (_thiefEngrossed) that lives in
// module scope, not on Game.  After restore, the M-segment reads it via the
// exported getter and asserts the SAVED value (true), not the reset value (false).
//
// §10.5 non-thin: the assertion that thiefEngrossed() === true after restore
// is the proof the SS6 global was actually serialised and restored.
// ---------------------------------------------------------------------------

describe('V1-D module-global round-trip (SS6)', () => {
  beforeEach(() => {
    // Reset module globals before each test so isolation holds.
    resetThiefState();
  });

  it('thiefEngrossed survives snapshot/restore', async () => {
    const g = createGame({ seed: 42 });
    g.start();
    await g.turn('look');

    // N: set module-global to a non-default value, then snapshot.
    setThiefEngrossed(true);
    const snap = g.snapshot();
    // §10.5 non-thin: the snapshot must capture the SET value.
    expect(snap.moduleGlobals.thiefState.thiefEngrossed).toBe(true);

    // Reset to default (simulating what createSession or a fresh session would do).
    setThiefEngrossed(false);
    expect(thiefEngrossed()).toBe(false);

    // Restore — SS6 must reinstate the saved value.
    g.restore(snap);

    // §10.5 non-thin: restored value must be the SAVED value, not the reset value.
    expect(thiefEngrossed()).toBe(true);

    // Take a fixpoint snapshot and verify the field persisted.
    const snapPost = g.snapshot();
    expect(snapPost.moduleGlobals.thiefState.thiefEngrossed).toBe(true);
  });

  it('restore onto fresh game restores module global to the saved value', async () => {
    const g1 = createGame({ seed: 42 });
    g1.start();
    await g1.turn('look');

    // N on g1: set thief global.
    setThiefEngrossed(true);
    const snap = g1.snapshot();
    expect(snap.moduleGlobals.thiefState.thiefEngrossed).toBe(true);

    // Reset for the fresh-game restore scenario.
    setThiefEngrossed(false);

    // M commands: deterministic (thiefEngrossed doesn't affect room-look text).
    const M = ['look', 'look'];
    const path1 = await play(g1, M);

    // Restore onto a freshly bootstrapped game.
    const g2 = createGame({ seed: 42 });
    g2.start();
    g2.restore(snap);

    // §10.5: module global must reflect the SAVED value after cross-instance restore.
    expect(thiefEngrossed()).toBe(true);

    const path2 = await play(g2, M);
    expect(path2).toEqual(path1);
  });
});

// ---------------------------------------------------------------------------
// E — Mid-life save → restore onto a fresh game → view() matches
//
// Proves restore() works onto a clean instance (not just the same instance
// that was saved).  Checks room, score, moves, visited set, and inventory.
// ---------------------------------------------------------------------------

describe('V1-E restore onto a fresh game', () => {
  it('view() matches saved state after restoring onto a fresh game', async () => {
    const g1 = createGame({ seed: 42 });
    g1.start();

    // Advance to a non-trivial state.
    await g1.turn('look');
    await g1.turn('north');  // move to forest
    await g1.turn('look');

    const snap = g1.snapshot();
    const view1 = g1.view();

    // Restore onto a freshly bootstrapped game.
    const g2 = createGame({ seed: 42 });
    g2.start();
    g2.restore(snap);

    const view2 = g2.view();

    expect(view2.here).toBe(view1.here);
    expect(view2.moves).toBe(view1.moves);
    expect(view2.score).toBe(view1.score);
    expect(view2.gameOver).toBe(view1.gameOver);
  });

  it('inventory is restored: objects moved to player survive cross-instance restore', async () => {
    const g1 = createGame({ seed: 42 });
    g1.start();

    // Move lamp to player.
    const player1 = g1.world.get('PLAYER')!;
    const lamp1 = g1.world.get('LAMP')!;
    lamp1.moveTo(player1);

    await g1.turn('look');
    const snap = g1.snapshot();

    const g2 = createGame({ seed: 42 });
    g2.start();
    g2.restore(snap);

    // Lamp must be in player's inventory on the restored game.
    const player2 = g2.world.get('PLAYER')!;
    const lamp2 = g2.world.get('LAMP')!;
    expect(lamp2.parent).toBe(player2);
  });

  it('visited set survives cross-instance restore', async () => {
    const g1 = createGame({ seed: 42 });
    g1.start();

    await g1.turn('north');  // visit FOREST-1
    const snap = g1.snapshot();
    const visited1 = snap.visited;

    const g2 = createGame({ seed: 42 });
    g2.start();
    g2.restore(snap);

    const snap2 = g2.snapshot();
    // visited arrays must contain the same ids (order may differ — compare as sets).
    expect(new Set(snap2.visited)).toEqual(new Set(visited1));
  });
});

// ---------------------------------------------------------------------------
// F — Snapshot/restore/snapshot fixpoint
//
// snapshot() → restore() → snapshot() produces an equal SaveState.
// A lossy field (one that doesn't survive restore) shows up as a mismatch
// between S1 and S2.  This is the cheapest catch-all for forgotten fields.
// ---------------------------------------------------------------------------

describe('V1-F snapshot/restore/snapshot fixpoint', () => {
  it('S1 = S2 after restore (idempotence over all fields)', async () => {
    const g = createGame({ seed: 42 });
    g.start();

    // Advance to a state with some non-default values.
    await g.turn('look');
    await g.turn('north');

    const snap1 = g.snapshot();

    // Restore and re-snapshot.
    g.restore(snap1);
    const snap2 = g.snapshot();

    // Versioning and display fields are allowed to differ (savedAt is a timestamp).
    const strip = (s: SaveState) => {
      const { savedAt: _, ...rest } = s;
      return rest;
    };

    expect(strip(snap2)).toEqual(strip(snap1));
  });

  it('fixpoint holds after a more complex game state', async () => {
    const g = createGame({ seed: 42 });
    g.start();

    // Move rug, visit multiple rooms, mutate score.
    await g.turn('look');
    await g.turn('north');
    await g.turn('look');
    await g.turn('south');

    const snap1 = g.snapshot();
    g.restore(snap1);
    const snap2 = g.snapshot();

    const strip = (s: SaveState) => {
      const { savedAt: _, ...rest } = s;
      return rest;
    };

    expect(strip(snap2)).toEqual(strip(snap1));
  });
});
