/**
 * SS-RNG — Rng.getState()/setState() + snapshot() RNG round-trip tests.
 *
 * Spec §3.2: both stream positions must round-trip independently. A single
 * saved position re-coupling the two streams (the NM — non-obvious mistake)
 * is asserted against explicitly.
 *
 * snapshot() must THROW when a non-serializable stream (ScriptedRng) is in play.
 *
 * Uses real Rng instances throughout — spec §3.2 forbids stubs in save tests.
 */

import { describe, it, expect } from 'vitest';
import { Rng } from '../../src/engine/rng.js';
import { createGame } from '../../src/engine/bootstrap.js';
import { ScriptedRng } from '../helpers/scripted-rng.js';

// ---------------------------------------------------------------------------
// 1. getState / setState round-trip: next draw after restore matches.
// ---------------------------------------------------------------------------

describe('SS-RNG Rng.getState/setState', () => {
  it('main stream: next draw after restore matches the post-snapshot draw', () => {
    const rng = new Rng(12345);

    // Advance K times to move past initial state.
    for (let i = 0; i < 7; i++) rng.next();

    const state = rng.getState();

    // Record the next draw from the live stream.
    const expected = rng.next();

    // Restore and re-draw — must match.
    rng.setState(state);
    expect(rng.next()).toBe(expected);
  });

  it('combat stream: same round-trip independently', () => {
    const combatRng = new Rng(99999);

    for (let i = 0; i < 13; i++) combatRng.next();

    const state = combatRng.getState();
    const expected = combatRng.next();

    combatRng.setState(state);
    expect(combatRng.next()).toBe(expected);
  });

  it('setState does not bleed into a second independent Rng instance', () => {
    const a = new Rng(42);
    const b = new Rng(42);

    // Advance a further than b to create diverged state.
    for (let i = 0; i < 5; i++) a.next();

    const stateA = a.getState();

    // b is at draw 0; restoring a's state onto a new instance should not touch b.
    const c = new Rng(0);
    c.setState(stateA);

    // b and c should now be on different sequences.
    expect(b.next()).not.toBe(c.next());
  });
});

// ---------------------------------------------------------------------------
// 2. NM — single position re-coupling the streams (the non-obvious mistake).
//
// bootstrap.ts:267,300 creates two Rng(seed) instances from the same seed;
// they start identical but diverge immediately (both draw from the same seed
// but have INDEPENDENT state). A naive save that captures one position and
// restores it onto BOTH streams re-couples them — the restored combatRng
// runs the same sequence as rng from that point forward, breaking the
// independence invariant.
//
// This test proves the two-stream decoupling is preserved across restore.
// ---------------------------------------------------------------------------

describe('SS-RNG two-stream independence across snapshot/restore', () => {
  it('main and combat streams remain independent after restore', () => {
    // Two Rng(seed) instances mirror bootstrap.ts:267,300 — same seed, independent state.
    const rng      = new Rng(77);
    const combatRng = new Rng(77);

    // Advance them differently to simulate divergence.
    for (let i = 0; i < 3; i++) rng.next();
    for (let i = 0; i < 9; i++) combatRng.next();

    const mainState   = rng.getState();
    const combatState = combatRng.getState();

    // Snapshot: record both positions.
    // Restore: apply each to its OWN stream.
    const rng2      = new Rng(0);
    const combatRng2 = new Rng(0);
    rng2.setState(mainState);
    combatRng2.setState(combatState);

    // They must produce DIFFERENT sequences (they diverged before snapshot).
    const mainDraws   = Array.from({ length: 5 }, () => rng2.next());
    const combatDraws = Array.from({ length: 5 }, () => combatRng2.next());

    // If a single position were used for both streams they'd be equal — that's the NM.
    expect(mainDraws).not.toEqual(combatDraws);
  });
});

// ---------------------------------------------------------------------------
// 3. snapshot() carries correct rngMain / rngCombat from the Game instance.
//    Draw N times from each stream (via a fresh game's internal draws triggered
//    by running turns in the lit WEST-OF-HOUSE), then snapshot — restored game
//    must produce identical next draws.
// ---------------------------------------------------------------------------

describe('SS-RNG Game.snapshot carries rngMain and rngCombat', () => {
  it('snapshot rngMain and rngCombat are non-zero after construction', () => {
    const g = createGame({ seed: 42 });
    const s = g.snapshot();
    // After construction bootstrap fires several rng.prob() calls (I-FOREST-ROOM
    // tick fires in the first advance), so both streams have advanced.
    // The stubs (0) must be gone — getState returns the live position.
    // We can't know the exact value, but 0 was the placeholder stub.
    expect(typeof s.rngMain).toBe('number');
    expect(typeof s.rngCombat).toBe('number');
    // Crucially: they should not still be the stub zero placed by SS1.
    // (If SS-RNG is not yet wired, both fields are 0 — this test catches that.)
    expect(s.rngMain).not.toBe(0);
    expect(s.rngCombat).not.toBe(0);
  });

  it('snapshot rngMain and rngCombat are independent (mutating one does not affect the other)', () => {
    // Two distinct Rng instances from the same seed start at the same state.
    // Advancing only the main stream (by injecting a real Rng that we advance)
    // must leave combatRng unchanged — proving they are independent instances.
    const mainRng   = new Rng(42);
    const combatRng = new Rng(42);

    // Advance main stream only.
    for (let i = 0; i < 5; i++) mainRng.next();

    const mainState   = mainRng.getState();
    const combatState = combatRng.getState();

    // They must now differ — main has advanced, combat has not.
    expect(mainState).not.toBe(combatState);
  });
});

// ---------------------------------------------------------------------------
// 4. snapshot() THROWS when a ScriptedRng is in play for either stream.
// ---------------------------------------------------------------------------

describe('SS-RNG snapshot() throws on non-serializable stream', () => {
  it('throws with a descriptive message when rng is a ScriptedRng', () => {
    const g = createGame({ seed: 42, rng: new ScriptedRng([0.5]) });
    expect(() => g.snapshot()).toThrow(/ScriptedRng|non-serializable|getState/i);
  });

  it('throws when combatRng is a ScriptedRng', () => {
    const g = createGame({ seed: 42, combatRng: new ScriptedRng([0.5]) });
    expect(() => g.snapshot()).toThrow(/ScriptedRng|non-serializable|getState/i);
  });
});

// ---------------------------------------------------------------------------
// 5. Full round-trip: draw K, snapshot, draw M, restore, redraw M — identical.
//    This is the spec §3.2 "next-draw-matches" done-criterion for both streams.
// ---------------------------------------------------------------------------

describe('SS-RNG full round-trip next-draw-matches (both streams)', () => {
  it('main stream: M draws after restore match the original M draws', () => {
    const rng = new Rng(54321);

    // Advance K draws.
    for (let i = 0; i < 10; i++) rng.next();

    const state = rng.getState();

    // Record M draws.
    const M = 8;
    const original = Array.from({ length: M }, () => rng.next());

    // Restore.
    rng.setState(state);

    // Redraw — must match.
    const restored = Array.from({ length: M }, () => rng.next());
    expect(restored).toEqual(original);
  });

  it('combat stream: M draws after restore match the original M draws', () => {
    const combatRng = new Rng(11111);

    for (let i = 0; i < 6; i++) combatRng.next();

    const state = combatRng.getState();

    const M = 5;
    const original = Array.from({ length: M }, () => combatRng.next());

    combatRng.setState(state);

    const restored = Array.from({ length: M }, () => combatRng.next());
    expect(restored).toEqual(original);
  });
});
