import { describe, it, expect } from 'vitest';
import { ROOMS, CONNECTIONS } from '../../../src/ui/map-regions/river.js';

const EXPECTED_IDS = new Set([
  'RIVER-1', 'RIVER-2', 'RIVER-3', 'RIVER-4', 'RIVER-5',
  'WHITE-CLIFFS-NORTH', 'WHITE-CLIFFS-SOUTH', 'SHORE', 'SANDY-BEACH', 'SANDY-CAVE',
]);

describe('river region', () => {
  it('has exactly the 10 rooms from spec §4', () => {
    expect(new Set(ROOMS.map(r => r.id))).toEqual(EXPECTED_IDS);
  });

  it('every room has col and row, no collisions', () => {
    const seen = new Map<string, string>();
    for (const r of ROOMS) {
      expect(r.col, r.id).not.toBeUndefined();
      expect(r.row, r.id).not.toBeUndefined();
      const key = `${r.col},${r.row}`;
      expect(seen.has(key), `${r.id} collides with ${seen.get(key)}`).toBe(false);
      seen.set(key, r.id);
    }
  });

  it('has 11 connections, all intra-region', () => {
    expect(CONNECTIONS.length).toBe(11);
    for (const c of CONNECTIONS) {
      expect(EXPECTED_IDS.has(c.a), c.a).toBe(true);
      expect(EXPECTED_IDS.has(c.b), c.b).toBe(true);
    }
  });

  it('the river chain is non-reciprocal (one-way current)', () => {
    for (const [a, b] of [
      ['RIVER-1', 'RIVER-2'], ['RIVER-2', 'RIVER-3'],
      ['RIVER-3', 'RIVER-4'], ['RIVER-4', 'RIVER-5'],
    ]) {
      const c = CONNECTIONS.find(c => (c.a === a && c.b === b) || (c.a === b && c.b === a));
      expect(c, `${a}<->${b}`).toBeDefined();
      expect(c!.reciprocal, `${a}<->${b} must be one-way`).toBe(false);
    }
  });

  it('all labels are 9 characters or fewer', () => {
    for (const r of ROOMS) {
      expect(r.label.length, `${r.id}: "${r.label}"`).toBeLessThanOrEqual(9);
    }
  });
});
