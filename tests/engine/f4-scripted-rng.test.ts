/**
 * F4 — Forced-RNG test harness (§12 F4, §11.5)
 *
 * A scripted-sequence Rng for combat unit tests: next() pops draws from a
 * fixed list so every blow in a test is deterministic. Satisfies the full
 * widened Rng interface (next / nextInt / prob / zprob) so it can substitute
 * for the concrete Rng anywhere in the engine.
 *
 * ZIL refs:
 *   gmacros.zil:115–122  ZPROB — continuous draw next()*denom < base
 *   1actions.zil:969     LUCKY init
 */

import { describe, test, expect } from 'vitest';
import { ScriptedRng } from '../helpers/scripted-rng.js';

// ---------------------------------------------------------------------------
// 1. Basic draw sequence
// ---------------------------------------------------------------------------

describe('ScriptedRng — next()', () => {
  test('pops draws in order', () => {
    const rng = new ScriptedRng([0.1, 0.5, 0.9]);
    expect(rng.next()).toBe(0.1);
    expect(rng.next()).toBe(0.5);
    expect(rng.next()).toBe(0.9);
  });

  test('wraps around when the list is exhausted', () => {
    const rng = new ScriptedRng([0.2, 0.8]);
    rng.next(); // 0.2
    rng.next(); // 0.8
    expect(rng.next()).toBe(0.2); // wraps
  });

  test('single-element list always returns the same value', () => {
    const rng = new ScriptedRng([0.42]);
    for (let i = 0; i < 10; i++) {
      expect(rng.next()).toBe(0.42);
    }
  });
});

// ---------------------------------------------------------------------------
// 2. nextInt — derived from next()
// ---------------------------------------------------------------------------

describe('ScriptedRng — nextInt(n)', () => {
  test('floors next()*n', () => {
    // 0.5 * 9 = 4.5 → 4
    const rng = new ScriptedRng([0.5]);
    expect(rng.nextInt(9)).toBe(4);
  });

  test('0.0 → 0 for any n', () => {
    const rng = new ScriptedRng([0.0]);
    expect(rng.nextInt(6)).toBe(0);
  });

  test('0.999 → n-1 for any n', () => {
    const rng = new ScriptedRng([0.999]);
    expect(rng.nextInt(10)).toBe(9);
  });
});

// ---------------------------------------------------------------------------
// 3. prob(base) — continuous draw: next()*100 < base
// ---------------------------------------------------------------------------

describe('ScriptedRng — prob(base)', () => {
  test('true when next()*100 < base', () => {
    // 0.2 * 100 = 20 < 25 → true
    const rng = new ScriptedRng([0.2]);
    expect(rng.prob(25)).toBe(true);
  });

  test('false when next()*100 >= base', () => {
    // 0.9 * 100 = 90 >= 25 → false
    const rng = new ScriptedRng([0.9]);
    expect(rng.prob(25)).toBe(false);
  });

  test('boundary: exactly at base is false (strict <)', () => {
    // 0.25 * 100 = 25, 25 < 25 → false
    const rng = new ScriptedRng([0.25]);
    expect(rng.prob(25)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 4. zprob(base, denom) — continuous draw: next()*denom < base
//    gmacros.zil:115–122 — same form as prob but with caller-supplied denom.
//    LUCKY=true  → denom 100; LUCKY=false → denom 300.
// ---------------------------------------------------------------------------

describe('ScriptedRng — zprob(base, denom)', () => {
  test('true when next()*denom < base (lucky path, denom=100)', () => {
    // 0.2 * 100 = 20 < 25 → true
    const rng = new ScriptedRng([0.2]);
    expect(rng.zprob(25, 100)).toBe(true);
  });

  test('false when next()*denom >= base (lucky path)', () => {
    // 0.5 * 100 = 50 >= 25 → false
    const rng = new ScriptedRng([0.5]);
    expect(rng.zprob(25, 100)).toBe(false);
  });

  test('harder to pass when denom=300 (unlucky path)', () => {
    // 0.2 * 300 = 60 >= 25 → false  (would be true at denom=100)
    const rng = new ScriptedRng([0.2]);
    expect(rng.zprob(25, 300)).toBe(false);
  });

  test('true under unlucky denom when next() is tiny', () => {
    // 0.05 * 300 = 15 < 25 → true
    const rng = new ScriptedRng([0.05]);
    expect(rng.zprob(25, 300)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 5. Smoke — pinned draw sequence drives prob + zprob predictably
//    This is the "harness returns a pinned draw sequence" done-criterion.
// ---------------------------------------------------------------------------

describe('ScriptedRng — smoke: pinned draw sequence', () => {
  test('sequential calls across next / prob / zprob are all deterministic', () => {
    // Scripted draws:  0.1, 0.3, 0.08, 0.6, 0.01
    const rng = new ScriptedRng([0.1, 0.3, 0.08, 0.6, 0.01]);

    // draw 1: next() → 0.1
    expect(rng.next()).toBe(0.1);

    // draw 2: prob(25) → 0.3*100=30 >= 25 → false
    expect(rng.prob(25)).toBe(false);

    // draw 3: zprob(25, 100) → 0.08*100=8 < 25 → true  (LUCKY path)
    expect(rng.zprob(25, 100)).toBe(true);

    // draw 4: zprob(25, 300) → 0.6*300=180 >= 25 → false  (UNLUCKY path)
    expect(rng.zprob(25, 300)).toBe(false);

    // draw 5: prob(33) → 0.01*100=1 < 33 → true
    expect(rng.prob(33)).toBe(true);
  });

  test('counter exposed for assertion in complex blow tests', () => {
    const rng = new ScriptedRng([0.5, 0.5, 0.5]);
    rng.next();
    rng.next();
    expect(rng.drawCount).toBe(2);
  });
});
