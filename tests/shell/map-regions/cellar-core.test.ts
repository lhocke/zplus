import { describe, it, expect } from 'vitest';
import { ROOMS, CONNECTIONS } from '../../../src/ui/map-regions/cellar-core.js';

const EXPECTED_IDS = new Set([
  'CELLAR', 'TROLL-ROOM', 'EAST-OF-CHASM', 'GALLERY', 'STUDIO',
  'EW-PASSAGE', 'ROUND-ROOM', 'NS-PASSAGE', 'CHASM-ROOM', 'DEEP-CANYON',
  'LOUD-ROOM', 'DAMP-CAVE', 'ENGRAVINGS-CAVE',
]);

describe('cellar-core region', () => {
  it('has exactly the 13 rooms from spec §4', () => {
    expect(new Set(ROOMS.map(r => r.id))).toEqual(EXPECTED_IDS);
  });

  it('every room has col and row', () => {
    for (const r of ROOMS) {
      expect(r.col, r.id).not.toBeUndefined();
      expect(r.row, r.id).not.toBeUndefined();
    }
  });

  it('no coordinate collisions', () => {
    const seen = new Map<string, string>();
    for (const r of ROOMS) {
      const key = `${r.col},${r.row}`;
      expect(seen.has(key), `${r.id} collides with ${seen.get(key)} at (${key})`).toBe(false);
      seen.set(key, r.id);
    }
  });

  it('has 14 connections, all intra-region', () => {
    expect(CONNECTIONS.length).toBe(14);
    for (const c of CONNECTIONS) {
      expect(EXPECTED_IDS.has(c.a), c.a).toBe(true);
      expect(EXPECTED_IDS.has(c.b), c.b).toBe(true);
    }
  });

  it('all labels are 9 characters or fewer', () => {
    for (const r of ROOMS) {
      expect(r.label.length, `${r.id}: "${r.label}" is ${r.label.length} chars`).toBeLessThanOrEqual(9);
    }
  });
});
