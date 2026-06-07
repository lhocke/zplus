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
