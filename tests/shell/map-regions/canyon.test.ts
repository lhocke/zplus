import { describe, it, expect } from 'vitest';
import { ROOMS, CONNECTIONS } from '../../../src/ui/map-regions/canyon.js';

const EXPECTED_IDS = new Set([
  'CANYON-VIEW', 'CLIFF-MIDDLE', 'CANYON-BOTTOM',
  'END-OF-RAINBOW', 'ON-RAINBOW', 'ARAGAIN-FALLS',
]);

describe('canyon region', () => {
  it('has exactly the 6 rooms from spec §4', () => {
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

  it('has 5 connections, all intra-region', () => {
    expect(CONNECTIONS.length).toBe(5);
    for (const c of CONNECTIONS) {
      expect(EXPECTED_IDS.has(c.a), c.a).toBe(true);
      expect(EXPECTED_IDS.has(c.b), c.b).toBe(true);
    }
  });

  it('the cliff climb is reciprocal; the bottom-to-rainbow edge is not', () => {
    const climb = CONNECTIONS.find(c =>
      (c.a === 'CANYON-VIEW' && c.b === 'CLIFF-MIDDLE') ||
      (c.a === 'CLIFF-MIDDLE' && c.b === 'CANYON-VIEW'));
    expect(climb).toBeDefined();
    expect(climb!.reciprocal).toBe(true);
    const toRainbow = CONNECTIONS.find(c =>
      (c.a === 'CANYON-BOTTOM' && c.b === 'END-OF-RAINBOW') ||
      (c.a === 'END-OF-RAINBOW' && c.b === 'CANYON-BOTTOM'));
    expect(toRainbow).toBeDefined();
    expect(toRainbow!.reciprocal).toBe(false);
  });

  it('all labels are 9 characters or fewer', () => {
    for (const r of ROOMS) {
      expect(r.label.length, `${r.id}: "${r.label}"`).toBeLessThanOrEqual(9);
    }
  });
});
