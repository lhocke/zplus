import { describe, it, expect } from 'vitest';
import { fill } from '../../src/logic/fill.js';
import { computeReachable } from '../../src/logic/reachability.js';
import graphData from '../../src/logic/logic-graph.json' with { type: 'json' };
import type { LogicGraph } from '../../src/logic/logic-graph-types.js';

const graph = graphData as LogicGraph;
const SAMPLE_SEEDS = Array.from({ length: 500 }, (_, i) => i);
const GOLDEN_SEEDS = [1, 2, 3];

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

// AMENDMENT 2 (repair task 3R): the "own everything, check all locations
// reachable" property above cannot see a fill that only *looks* solvable
// once full ownership is assumed but is not actually reachable by
// bootstrapping from nothing — e.g. a genuine circular placement (item A's
// spot needs B, item B's spot needs A), or — the bug this repair fixes — an
// item placed behind a rule that (directly or transitively) requires that
// same item. This test replays the run for real: start owned nothing,
// repeatedly collect whatever is currently reachable, until nothing new
// opens up, then assert the fixpoint actually collected every placed item
// (the complete set fill() shuffled into locations is genuinely
// collectible in play, not just "reachable if you already have it").
describe('progressive empty-inventory solver (AMENDMENT 2 repair task 3R)', () => {
  function progressiveFixpoint(placements: Record<string, string>) {
    const owned = new Set<string>();
    let changed = true;
    let reachableLocations = new Set<string>();
    while (changed) {
      changed = false;
      ({ reachableLocations } = computeReachable(graph, { ownedItems: owned, flags: new Set() }));
      for (const locId of reachableLocations) {
        const itemId = placements[locId];
        if (itemId !== undefined && !owned.has(itemId)) {
          owned.add(itemId);
          changed = true;
        }
      }
    }
    return { owned, reachableLocations };
  }

  it('for every property seed and golden seed, empty-inventory collection reaches every placed item', () => {
    const allSeeds = [...new Set([...SAMPLE_SEEDS, ...GOLDEN_SEEDS])];
    for (const seed of allSeeds) {
      const result = fill(graph, seed);
      const { owned, reachableLocations } = progressiveFixpoint(result.placements);
      expect(reachableLocations.size, `seed ${seed}`).toBe(graph.locations.length);
      const allPlacedItemIds = new Set(Object.values(result.placements));
      expect(owned, `seed ${seed}`).toEqual(allPlacedItemIds);
    }
  });
});

// Golden-seed pins: committed exact placements for a small, fixed seed set.
// If this test ever fails without an intentional graph change, the fill
// algorithm or the graph silently changed behavior — that's the point.
describe('golden-seed pins', () => {
  it.each(GOLDEN_SEEDS)('seed %i matches its committed golden placement', (seed) => {
    const result = fill(graph, seed);
    // First run: this expect() intentionally fails so the implementer can
    // paste the actual output into tests/logic/__goldens__/fill-seed-<seed>.json.
    // Do NOT hand-author the golden file's content — generate it from a real
    // fill() run and commit exactly that.
    expect(result.placements).toMatchFileSnapshot(`__goldens__/fill-seed-${seed}.json`);
  });
});
