import { describe, it, expect } from 'vitest';
import { ROOMS, CONNECTIONS } from '../../../src/ui/map-regions/surface.js';

const EXPECTED_IDS = new Set([
  'WEST-OF-HOUSE', 'NORTH-OF-HOUSE', 'SOUTH-OF-HOUSE', 'EAST-OF-HOUSE',
  'FOREST-1', 'FOREST-2', 'FOREST-3', 'PATH', 'UP-A-TREE',
  'GRATING-CLEARING', 'CLEARING', 'MOUNTAINS', 'KITCHEN', 'ATTIC',
  'LIVING-ROOM', 'STONE-BARROW',
]);

describe('surface region', () => {
  it('has exactly the 16 rooms from spec §4', () => {
    const ids = new Set(ROOMS.map(r => r.id));
    expect(ids).toEqual(EXPECTED_IDS);
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

  it('the STONE-BARROW connection is present and reciprocal (sw/ne pair)', () => {
    // Spot-checks only — the full connections-correspond-to-real-exits
    // cross-check against rooms.json lives in tests/shell/map-layout.test.ts.
    const c = CONNECTIONS.find(c => (c.a === 'WEST-OF-HOUSE' && c.b === 'STONE-BARROW') || (c.a === 'STONE-BARROW' && c.b === 'WEST-OF-HOUSE'));
    expect(c).toBeDefined();
    expect(c!.reciprocal).toBe(true);
  });

  it('the previously-omitted GRATING-CLEARING/FOREST-2 connection is present and non-reciprocal', () => {
    const c = CONNECTIONS.find(c => (c.a === 'GRATING-CLEARING' && c.b === 'FOREST-2') || (c.a === 'FOREST-2' && c.b === 'GRATING-CLEARING'));
    expect(c).toBeDefined();
    expect(c!.reciprocal).toBe(false);
  });

  it('all labels are 9 characters or fewer', () => {
    for (const r of ROOMS) {
      expect(r.label.length, `${r.id}: "${r.label}" is ${r.label.length} chars`).toBeLessThanOrEqual(9);
    }
  });
});
