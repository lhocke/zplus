import { describe, it, expect } from 'vitest';
import { ROOMS, CONNECTIONS } from '../../../src/ui/map-regions/cyclops.js';

const EXPECTED_IDS = new Set([
  'CYCLOPS-ROOM', 'STRANGE-PASSAGE', 'TREASURE-ROOM', 'GRATING-ROOM',
]);

describe('cyclops region', () => {
  it('has exactly the 4 rooms from spec §4', () => {
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

  it('has 2 connections, all intra-region — GRATING-ROOM is a seam-only island', () => {
    expect(CONNECTIONS.length).toBe(2);
    for (const c of CONNECTIONS) {
      expect(EXPECTED_IDS.has(c.a), c.a).toBe(true);
      expect(EXPECTED_IDS.has(c.b), c.b).toBe(true);
      expect(c.a).not.toBe('GRATING-ROOM');
      expect(c.b).not.toBe('GRATING-ROOM');
    }
  });

  it('all labels are 9 characters or fewer', () => {
    for (const r of ROOMS) {
      expect(r.label.length, `${r.id}: "${r.label}"`).toBeLessThanOrEqual(9);
    }
  });
});
