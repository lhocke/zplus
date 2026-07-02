import { describe, it, expect } from 'vitest';
import { ROOMS, CONNECTIONS } from '../../../src/ui/map-regions/mirror.js';

const EXPECTED_IDS = new Set([
  'MIRROR-ROOM-1', 'MIRROR-ROOM-2', 'SMALL-CAVE', 'TINY-CAVE',
  'COLD-PASSAGE', 'NARROW-PASSAGE', 'WINDING-PASSAGE', 'TWISTING-PASSAGE',
]);

describe('mirror region', () => {
  it('has exactly the 8 rooms from spec §4', () => {
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

  it('has 8 connections, all intra-region', () => {
    expect(CONNECTIONS.length).toBe(8);
    for (const c of CONNECTIONS) {
      expect(EXPECTED_IDS.has(c.a), c.a).toBe(true);
      expect(EXPECTED_IDS.has(c.b), c.b).toBe(true);
    }
  });

  it('no connection bridges the two mirror clusters', () => {
    const cluster1 = new Set(['MIRROR-ROOM-1', 'SMALL-CAVE', 'COLD-PASSAGE', 'TWISTING-PASSAGE']);
    for (const c of CONNECTIONS) {
      expect(cluster1.has(c.a), `${c.a}<->${c.b} bridges the clusters`).toBe(cluster1.has(c.b));
    }
  });

  it('the disorienting mirror-room passages are flagged non-reciprocal', () => {
    const c = CONNECTIONS.find(c =>
      (c.a === 'MIRROR-ROOM-1' && c.b === 'TWISTING-PASSAGE') ||
      (c.a === 'TWISTING-PASSAGE' && c.b === 'MIRROR-ROOM-1'));
    expect(c).toBeDefined();
    expect(c!.reciprocal).toBe(false);
  });

  it('all labels are 9 characters or fewer', () => {
    for (const r of ROOMS) {
      expect(r.label.length, `${r.id}: "${r.label}"`).toBeLessThanOrEqual(9);
    }
  });
});
