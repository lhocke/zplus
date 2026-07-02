import { describe, it, expect } from 'vitest';
import { ROOMS, CONNECTIONS } from '../../../src/ui/map-regions/mine.js';

const EXPECTED_IDS = new Set([
  'MINE-ENTRANCE', 'SQUEEKY-ROOM', 'BAT-ROOM', 'SHAFT-ROOM', 'SMELLY-ROOM',
  'GAS-ROOM', 'LADDER-TOP', 'LADDER-BOTTOM', 'TIMBER-ROOM', 'LOWER-SHAFT',
  'MACHINE-ROOM', 'SLIDE-ROOM',
]);

describe('mine region', () => {
  it('has exactly the 12 rooms from spec §4', () => {
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

  it('has 10 connections, all intra-region', () => {
    expect(CONNECTIONS.length).toBe(10);
    for (const c of CONNECTIONS) {
      expect(EXPECTED_IDS.has(c.a), c.a).toBe(true);
      expect(EXPECTED_IDS.has(c.b), c.b).toBe(true);
    }
  });

  it('no connection bridges the two clusters (they join only via the maze)', () => {
    const entrance = new Set(['MINE-ENTRANCE', 'SQUEEKY-ROOM', 'BAT-ROOM', 'SHAFT-ROOM', 'SMELLY-ROOM', 'GAS-ROOM', 'SLIDE-ROOM']);
    for (const c of CONNECTIONS) {
      expect(entrance.has(c.a), `${c.a}<->${c.b} bridges the clusters`).toBe(entrance.has(c.b));
    }
  });

  it('all labels are 9 characters or fewer', () => {
    for (const r of ROOMS) {
      expect(r.label.length, `${r.id}: "${r.label}"`).toBeLessThanOrEqual(9);
    }
  });
});
