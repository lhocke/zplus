import { describe, it, expect } from 'vitest';
import { fill } from '../../src/logic/fill.js';
import { computeReachable } from '../../src/logic/reachability.js';
import graphData from '../../src/logic/logic-graph.json' with { type: 'json' };
import type { LogicGraph } from '../../src/logic/logic-graph-types.js';

const graph = graphData as LogicGraph;
const SAMPLE_SEEDS = Array.from({ length: 500 }, (_, i) => i);

describe('fill property tests over the real graph (500 seeds)', () => {
  it('every seed fills successfully with no missing/duplicate placements', () => {
    // Event-created treasures (DIAMOND, BAUBLE) are `class: "filler",
    // isTreasure: true` entries in items[] with no corresponding location
    // (AMENDMENTS rule 4: fill() operates over PLACEABLE items only) — fill()
    // never places them, so the expected item set is every item with a
    // matching location, not the raw items[] list.
    const locationObjectIds = new Set(graph.locations.map(l => l.objectId));
    const shuffleEligibleItemIds = graph.items
      .filter(i => locationObjectIds.has(i.id))
      .map(i => i.id);
    for (const seed of SAMPLE_SEEDS) {
      const result = fill(graph, seed);
      const placedLocationIds = Object.keys(result.placements).sort();
      const allLocationIds = graph.locations.map(l => l.id).sort();
      expect(placedLocationIds, `seed ${seed}`).toEqual(allLocationIds);
      const placedItemIds = Object.values(result.placements).sort();
      expect(placedItemIds, `seed ${seed}`).toEqual([...shuffleEligibleItemIds].sort());
    }
  });

  it('every seed produces a fully solvable placement (every location reachable owning all progression)', () => {
    const progressionIds = new Set(graph.items.filter(i => i.class === 'progression').map(i => i.id));
    for (const seed of SAMPLE_SEEDS) {
      const result = fill(graph, seed);
      const owned = new Set(Object.values(result.placements).filter(item => progressionIds.has(item)));
      const r = computeReachable(graph, { ownedItems: owned, flags: new Set() });
      expect(r.reachableLocations.size, `seed ${seed}`).toBe(graph.locations.length);
    }
  });

  it('determinism: re-running the same seed twice matches exactly', () => {
    for (const seed of [0, 1, 42, 999, 123456]) {
      expect(fill(graph, seed)).toEqual(fill(graph, seed));
    }
  });
});

// Golden-seed pins: committed exact placements for a small, fixed seed set.
// If this test ever fails without an intentional graph change, the fill
// algorithm or the graph silently changed behavior — that's the point.
describe('golden-seed pins', () => {
  const GOLDEN_SEEDS = [1, 2, 3];
  it.each(GOLDEN_SEEDS)('seed %i matches its committed golden placement', (seed) => {
    const result = fill(graph, seed);
    // First run: this expect() intentionally fails so the implementer can
    // paste the actual output into tests/logic/__goldens__/fill-seed-<seed>.json.
    // Do NOT hand-author the golden file's content — generate it from a real
    // fill() run and commit exactly that.
    expect(result.placements).toMatchFileSnapshot(`__goldens__/fill-seed-${seed}.json`);
  });
});
