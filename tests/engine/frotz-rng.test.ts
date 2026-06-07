import { describe, it, expect } from 'vitest';
import { FrotzRng } from '../../src/engine/frotz-rng';

describe('FrotzRng: standard seeded LCG (seed >= 1000)', () => {
  it('reproduces the documented random(100) sequence for seed 1000', () => {
    const r = new FrotzRng(1000);
    const got = Array.from({ length: 6 }, () => r.random(100));
    expect(got).toEqual([26, 63, 96, 62, 1, 61]);
  });

  it('reproduces the sequence for seed 12345', () => {
    const r = new FrotzRng(12345);
    const got = Array.from({ length: 6 }, () => r.random(100));
    expect(got).toEqual([2, 97, 22, 78, 17, 87]);
  });
});

describe('FrotzRng: special sequential mode (seed < 1000)', () => {
  it('emits a rising sequence for a small seed', () => {
    const r = new FrotzRng(42);
    const got = Array.from({ length: 6 }, () => r.random(100));
    expect(got).toEqual([1, 2, 3, 4, 5, 6]);
  });
});

describe('FrotzRng: prob mirrors ZIL <PROB n> = <G? n <RANDOM 100>>', () => {
  it('matches the grue prob(80) outcomes for seed 1000', () => {
    const r = new FrotzRng(1000);
    const got = Array.from({ length: 6 }, () => r.prob(80));
    // 80 > random(100) for [26,63,96,62,1,61] => [T,T,F,T,T,T]
    expect(got).toEqual([true, true, false, true, true, true]);
  });
});
