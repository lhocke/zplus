import { describe, it, expect } from 'vitest';
import { fillOnce, FillError } from '../../src/logic/fill.js';
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

// A second start-region location gives the single progression item a real
// (non-forced) choice of candidate location, so seed-dependent variance can
// be observed. TINY_GRAPH alone cannot demonstrate variance post-repair:
// `key` has exactly one legal candidate (loc-a) on every seed, because the
// only other location (loc-b) sits behind a rule that needs `key` itself —
// which is exactly the self-gating AMENDMENT 2 forbids. That determinism is
// the correct, *intended* behavior (see the regression test below), not a
// gap; it just means TINY_GRAPH is the wrong fixture for a variance check.
const WIDER_GRAPH: LogicGraph = {
  logicVersion: 1,
  checksum: 'test',
  regions: [
    { id: 'start', rooms: ['A', 'C'], access: {} },
    { id: 'locked', rooms: ['B'], access: { needs: ['key'] } },
  ],
  items: [
    { id: 'key', class: 'progression', isTreasure: false },
    { id: 'treasure1', class: 'filler', isTreasure: true },
    { id: 'trinket', class: 'filler', isTreasure: false },
  ],
  locations: [
    { id: 'loc-a', objectId: 'key', containerId: 'A', region: 'start', access: {} },
    { id: 'loc-b', objectId: 'treasure1', containerId: 'B', region: 'locked', access: {} },
    { id: 'loc-c', objectId: 'trinket', containerId: 'C', region: 'start', access: {} },
  ],
};

describe('fill', () => {
  it('places every item into exactly one location', () => {
    const result = fillOnce(TINY_GRAPH, 42);
    expect(Object.keys(result.placements).sort()).toEqual(['loc-a', 'loc-b']);
    expect(new Set(Object.values(result.placements))).toEqual(new Set(['key', 'treasure1']));
  });

  it('is deterministic: same seed twice produces identical placements', () => {
    const a = fillOnce(TINY_GRAPH, 1234);
    const b = fillOnce(TINY_GRAPH, 1234);
    expect(a.placements).toEqual(b.placements);
    expect(a.spheres).toEqual(b.spheres);
  });

  it('never places a progression item behind a rule that (directly or via its own region) requires itself (AMENDMENT 2 repair task 3R)', () => {
    // Regression test for the fixed bug: loc-b sits in the 'locked' region,
    // which needs `key` — the only progression item. A fill that (like the
    // pre-repair code) assumes an item owns itself while choosing its own
    // location would sometimes place `key` at loc-b. The canonical fill
    // must never do this: `key` can only ever land at loc-a.
    for (let seed = 0; seed < 50; seed++) {
      const result = fillOnce(TINY_GRAPH, seed);
      expect(result.placements['loc-a'], `seed ${seed}`).toBe('key');
    }
  });

  it('different seeds usually produce different placements (not a hard guarantee, sanity only)', () => {
    const results = new Set(Array.from({ length: 20 }, (_, i) => JSON.stringify(fillOnce(WIDER_GRAPH, i).placements)));
    expect(results.size).toBeGreaterThan(1);
  });

  it('the resulting placement is solvable: reachability with owned progression items reaches every location', () => {
    const result = fillOnce(TINY_GRAPH, 7);
    const owned = new Set(Object.entries(result.placements).filter(([, item]) => item === 'key').map(() => 'key'));
    const r = computeReachable(TINY_GRAPH, { ownedItems: owned, flags: new Set() });
    expect(r.reachableLocations.size).toBe(TINY_GRAPH.locations.length);
  });

  it('places an early item (TORCH) only at earlyLight locations, and first (AMENDMENT 9 repair 3R7)', () => {
    // Two open start locations, only one flagged earlyLight: TORCH must land
    // on the flagged one on every seed, even though both are trivially
    // reachable — the constraint is the flag, not reachability.
    const earlyGraph: LogicGraph = {
      logicVersion: 1,
      checksum: 'test',
      regions: [{ id: 'start', rooms: ['A', 'B', 'C'], access: {} }],
      items: [
        { id: 'TORCH', class: 'progression', isTreasure: true },
        { id: 'trinket', class: 'filler', isTreasure: false },
        { id: 'bauble2', class: 'filler', isTreasure: false },
      ],
      locations: [
        { id: 'loc-a', objectId: 'TORCH', containerId: 'A', region: 'start', access: {}, earlyLight: true },
        { id: 'loc-b', objectId: 'trinket', containerId: 'B', region: 'start', access: {} },
        { id: 'loc-c', objectId: 'bauble2', containerId: 'C', region: 'start', access: {} },
      ],
    };
    for (let seed = 0; seed < 50; seed++) {
      const result = fillOnce(earlyGraph, seed);
      expect(result.placements['loc-a'], `seed ${seed}`).toBe('TORCH');
      expect(result.spheres[0], `seed ${seed}: TORCH must be placed first`).toBe('TORCH');
    }
  });

  it('throws FillError when item count does not match location count', () => {
    // A location whose objectId has no matching items[] entry — fillOnce()
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
    expect(() => fillOnce(broken, 1)).toThrow(FillError);
  });
});
