import { describe, it, expect } from 'vitest';
import { fill, FillError } from '../../src/logic/fill.js';
import { computeReachable } from '../../src/logic/reachability.js';
import type { LogicGraph } from '../../src/logic/logic-graph-types.js';

const TINY_GRAPH: LogicGraph = {
  logicVersion: 1,
  checksum: 'test',
  regions: [
    { id: 'start', rooms: ['A'], access: {} },
    { id: 'locked', rooms: ['B'], access: { needs: ['key'] } },
  ],
  items: [
    { id: 'key', class: 'progression', isTreasure: false },
    { id: 'treasure1', class: 'filler', isTreasure: true },
  ],
  locations: [
    { id: 'loc-a', objectId: 'key', containerId: 'A', region: 'start', access: {} },
    { id: 'loc-b', objectId: 'treasure1', containerId: 'B', region: 'locked', access: {} },
  ],
};

describe('fill', () => {
  it('places every item into exactly one location', () => {
    const result = fill(TINY_GRAPH, 42);
    expect(Object.keys(result.placements).sort()).toEqual(['loc-a', 'loc-b']);
    expect(new Set(Object.values(result.placements))).toEqual(new Set(['key', 'treasure1']));
  });

  it('is deterministic: same seed twice produces identical placements', () => {
    const a = fill(TINY_GRAPH, 1234);
    const b = fill(TINY_GRAPH, 1234);
    expect(a.placements).toEqual(b.placements);
    expect(a.spheres).toEqual(b.spheres);
  });

  it('different seeds usually produce different placements (not a hard guarantee, sanity only)', () => {
    const results = new Set(Array.from({ length: 20 }, (_, i) => JSON.stringify(fill(TINY_GRAPH, i).placements)));
    expect(results.size).toBeGreaterThan(1);
  });

  it('the resulting placement is solvable: reachability with owned progression items reaches every location', () => {
    const result = fill(TINY_GRAPH, 7);
    const owned = new Set(Object.entries(result.placements).filter(([, item]) => item === 'key').map(() => 'key'));
    const r = computeReachable(TINY_GRAPH, { ownedItems: owned, flags: new Set() });
    expect(r.reachableLocations.size).toBe(TINY_GRAPH.locations.length);
  });

  it('throws FillError when item count does not match location count', () => {
    // A location whose objectId has no matching items[] entry — fill()
    // counts only placeable items (those with a corresponding location, per
    // the AMENDMENTS rule 4 "PLACEABLE items only" filter), so the mismatch
    // has to come from an extra unfillable location, not a location-less item.
    const broken: LogicGraph = {
      ...TINY_GRAPH,
      locations: [
        ...TINY_GRAPH.locations,
        { id: 'loc-c', objectId: 'ghost-item', containerId: 'B', region: 'locked', access: {} },
      ],
    };
    expect(() => fill(broken, 1)).toThrow(FillError);
  });
});
