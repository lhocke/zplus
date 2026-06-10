/**
 * F2 — Flag.Fight / Flag.Staggered + LUCKY bootstrap
 *
 * TDD: written RED before implementation.
 *
 * Coverage:
 *   1. Flag enum has Fight (FIGHTBIT) and Staggered (STAGGERED) members.
 *   2. Fight and Staggered are distinct from each other and from Actor.
 *   3. Round-trip set/has/clear works for both.
 *   4. Rng.zprob(base, denom) is a continuous draw: next()*denom < base.
 *   5. Game.lucky is true at construction (1actions.zil:969 <GLOBAL LUCKY T>).
 *
 * ZIL refs: 1actions.zil:969 (<GLOBAL LUCKY T>), gmacros.zil:115–122 (ZPROB).
 */

import { describe, test, expect } from 'vitest';
import { Flag } from '../../src/domain/flags.js';
import { Thing } from '../../src/domain/thing.js';
import { Rng } from '../../src/engine/rng.js';
import { createGame } from '../../src/engine/bootstrap.js';

// ---------------------------------------------------------------------------
// 1 + 2. Flag enum members — Fight and Staggered
// ---------------------------------------------------------------------------

describe('Flag enum — Fight, Staggered', () => {
  test('Flag.Fight is defined', () => {
    expect(Flag.Fight).toBeDefined();
  });

  test('Flag.Staggered is defined', () => {
    expect(Flag.Staggered).toBeDefined();
  });

  test('Fight, Staggered, Actor are all distinct', () => {
    expect(Flag.Fight).not.toBe(Flag.Staggered);
    expect(Flag.Fight).not.toBe(Flag.Actor);
    expect(Flag.Staggered).not.toBe(Flag.Actor);
  });
});

// ---------------------------------------------------------------------------
// 3. Round-trip set / has / clear
// ---------------------------------------------------------------------------

describe('Flag.Fight round-trip', () => {
  test('has() false before set', () => {
    const obj = new Thing('TROLL', 'troll');
    expect(obj.has(Flag.Fight)).toBe(false);
  });

  test('has() true after set', () => {
    const obj = new Thing('TROLL', 'troll');
    obj.set(Flag.Fight);
    expect(obj.has(Flag.Fight)).toBe(true);
  });

  test('has() false after clear', () => {
    const obj = new Thing('TROLL', 'troll');
    obj.set(Flag.Fight);
    obj.clear(Flag.Fight);
    expect(obj.has(Flag.Fight)).toBe(false);
  });
});

describe('Flag.Staggered round-trip', () => {
  test('has() false before set', () => {
    const obj = new Thing('WINNER', 'adventurer');
    expect(obj.has(Flag.Staggered)).toBe(false);
  });

  test('has() true after set', () => {
    const obj = new Thing('WINNER', 'adventurer');
    obj.set(Flag.Staggered);
    expect(obj.has(Flag.Staggered)).toBe(true);
  });

  test('has() false after clear', () => {
    const obj = new Thing('WINNER', 'adventurer');
    obj.set(Flag.Staggered);
    obj.clear(Flag.Staggered);
    expect(obj.has(Flag.Staggered)).toBe(false);
  });

  test('Fight and Staggered flags are independent', () => {
    const obj = new Thing('TROLL', 'troll');
    obj.set(Flag.Fight);
    expect(obj.has(Flag.Staggered)).toBe(false);
    obj.set(Flag.Staggered);
    obj.clear(Flag.Fight);
    expect(obj.has(Flag.Staggered)).toBe(true);
    expect(obj.has(Flag.Fight)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 4. Rng.zprob(base, denom) — continuous draw: next()*denom < base
//    gmacros.zil:115–122 — ZPROB form is continuous, NOT nextInt.
// ---------------------------------------------------------------------------

describe('Rng.zprob — continuous draw', () => {
  test('zprob is defined on Rng', () => {
    const rng = new Rng(1);
    expect(typeof rng.zprob).toBe('function');
  });

  test('zprob always true when base >= denom', () => {
    const rng = new Rng(99);
    // next() is in [0,1); next()*100 < 100 is always true
    for (let i = 0; i < 20; i++) {
      expect(rng.zprob(100, 100)).toBe(true);
    }
  });

  test('zprob always false when base === 0', () => {
    const rng = new Rng(42);
    for (let i = 0; i < 20; i++) {
      expect(rng.zprob(0, 100)).toBe(false);
    }
  });

  test('zprob(25, 300) fires ~8.3% of the time (unlucky rate)', () => {
    // At 8.3% we expect ~83 hits out of 1000. Use a loose bound.
    const rng = new Rng(7);
    let hits = 0;
    for (let i = 0; i < 1000; i++) hits += rng.zprob(25, 300) ? 1 : 0;
    expect(hits).toBeGreaterThan(30);
    expect(hits).toBeLessThan(160);
  });

  test('zprob(25, 100) fires ~25% of the time (lucky rate)', () => {
    const rng = new Rng(7);
    let hits = 0;
    for (let i = 0; i < 1000; i++) hits += rng.zprob(25, 100) ? 1 : 0;
    expect(hits).toBeGreaterThan(180);
    expect(hits).toBeLessThan(320);
  });
});

// ---------------------------------------------------------------------------
// 5. Game.lucky === true at construction (1actions.zil:969 <GLOBAL LUCKY T>)
// ---------------------------------------------------------------------------

describe('Game LUCKY bootstrap', () => {
  test('game.lucky is true immediately after construction', () => {
    const g = createGame();
    expect(g.lucky).toBe(true);
  });
});
