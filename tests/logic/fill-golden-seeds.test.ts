import { describe, it, expect } from 'vitest';
import { fillOnce, fillWithRetry, FillError } from '../../src/logic/fill.js';
import { computeReachable } from '../../src/logic/reachability.js';
import graphData from '../../src/logic/logic-graph.json' with { type: 'json' };
import type { LogicGraph } from '../../src/logic/logic-graph-types.js';

const graph = graphData as LogicGraph;
const SAMPLE_SEEDS = Array.from({ length: 500 }, (_, i) => i);
const GOLDEN_SEEDS = [1, 2, 3];
// AMENDMENT 6 (repair task 3R5): the retry-needing sample seeds, discovered
// by AMENDMENT 5's weapon gate (all obtainable Weapon-flagged items get
// consumed/placed behind the troll gate before KNIFE can land on raw
// seed 36 / 470). Retry derivation changed (decorrelated hash mix instead of
// `seed + i`), but WHICH raw seeds fail attempt 0 did not — that only
// depends on `fillOnce` itself, which AMENDMENT 6 leaves untouched.
const RETRY_NEEDING_SEEDS = [36, 470];

// AMENDMENT 6 (repair task 3R5): the property suite below re-targets the
// PUBLIC CONTRACT — `fillWithRetry` — everywhere, not raw `fillOnce`. The
// original suite tested `fillOnce` directly, which let seeds 36 and 470
// report a false "solver green" is wrong framing: those seeds don't have a
// solver problem, they have a raw-fill deadlock that `fillWithRetry` is
// SUPPOSED to paper over deterministically. Testing `fillOnce` bypassed the
// one piece of the contract meant to handle exactly this.
describe('fill property tests over the real graph (500 seeds, public contract)', () => {
  it('every seed fills successfully with no missing/duplicate placements', () => {
    // Event-created treasures (DIAMOND, BAUBLE) are `class: "filler",
    // isTreasure: true` entries in items[] with no corresponding location
    // (AMENDMENTS rule 4: fill operates over PLACEABLE items only) — fill
    // never places them, so the expected item set is every item with a
    // matching location, not the raw items[] list.
    const locationObjectIds = new Set(graph.locations.map(l => l.objectId));
    const shuffleEligibleItemIds = graph.items
      .filter(i => locationObjectIds.has(i.id))
      .map(i => i.id);
    for (const seed of SAMPLE_SEEDS) {
      const result = fillWithRetry(graph, seed);
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
      const result = fillWithRetry(graph, seed);
      const owned = new Set(Object.values(result.placements).filter(item => progressionIds.has(item)));
      const r = computeReachable(graph, { ownedItems: owned, flags: new Set() });
      expect(r.reachableLocations.size, `seed ${seed}`).toBe(graph.locations.length);
    }
  });

  it('determinism: re-running the same seed twice matches exactly (double-run placement equality)', () => {
    for (const seed of SAMPLE_SEEDS) {
      expect(fillWithRetry(graph, seed), `seed ${seed}`).toEqual(fillWithRetry(graph, seed));
    }
  });

  it('the retry-needing fraction of the sample stays at or below 2%, so drift is visible', () => {
    // Counts raw-seed (attempt 0 / fillOnce) failures directly — this is the
    // ceiling AMENDMENT 6 asks for, independent of what the retry derivation
    // does with those seeds afterward.
    let retryNeeded = 0;
    for (const seed of SAMPLE_SEEDS) {
      try {
        fillOnce(graph, seed);
      } catch (err) {
        if (!(err instanceof FillError)) throw err;
        retryNeeded++;
      }
    }
    expect(retryNeeded / SAMPLE_SEEDS.length).toBeLessThanOrEqual(0.02);
  });
});

// AMENDMENT 6 (repair task 3R5): pinned regression for the two sample seeds
// that need a retry. Re-derived under the NEW decorrelated hash mix (NOT the
// old `seed + i` derivation) — the seed identities that need a retry are
// unchanged (they're a property of `fillOnce`, untouched here), but the
// specific placement each lands on after retry is not, since it now resolves
// via a different attempt-seed than before.
describe('decorrelated-retry pinned regression (AMENDMENT 6 repair task 3R5)', () => {
  it.each(RETRY_NEEDING_SEEDS)('seed %i still needs a retry under fillOnce (raw attempt 0 fails)', (seed) => {
    expect(() => fillOnce(graph, seed)).toThrow(FillError);
  });

  it.each(RETRY_NEEDING_SEEDS)('seed %i resolves via fillWithRetry and matches its committed golden', (seed) => {
    const result = fillWithRetry(graph, seed);
    // First run: this expect() intentionally fails so the implementer can
    // paste the actual output into tests/logic/__goldens__/fill-retry-seed-<seed>.json.
    // Do NOT hand-author the golden file's content — generate it from a real
    // fillWithRetry() run and commit exactly that.
    expect(result.placements).toMatchFileSnapshot(`__goldens__/fill-retry-seed-${seed}.json`);
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
      const result = fillWithRetry(graph, seed);
      const { owned, reachableLocations } = progressiveFixpoint(result.placements);
      expect(reachableLocations.size, `seed ${seed}`).toBe(graph.locations.length);
      const allPlacedItemIds = new Set(Object.values(result.placements));
      expect(owned, `seed ${seed}`).toEqual(allPlacedItemIds);
    }
  });
});

// AMENDMENT 5 (repair task 3R4): excludeProgression locations (EGG's
// interior, CANARY, at minimum) must never receive a progression-class
// item — the static reachability evaluator has no way to model "safe via
// the thief route," so a progression item stranded there would make the
// seed look solvable to computeReachable() while being unrecoverable in
// ordinary play. Checked across every property seed plus the golden seeds.
describe('excludeProgression fencing (AMENDMENT 5 repair task 3R4)', () => {
  it('no excludeProgression location ever receives a progression-class item', () => {
    const excludeProgressionLocationIds = graph.locations
      .filter(l => l.excludeProgression)
      .map(l => l.id);
    expect(excludeProgressionLocationIds.length, 'expected at least one excludeProgression location (e.g. CANARY)').toBeGreaterThan(0);
    const itemClassById = new Map(graph.items.map(i => [i.id, i.class]));
    const allSeeds = [...new Set([...SAMPLE_SEEDS, ...GOLDEN_SEEDS])];
    for (const seed of allSeeds) {
      const result = fillWithRetry(graph, seed);
      for (const locId of excludeProgressionLocationIds) {
        const itemId = result.placements[locId];
        expect(itemId, `seed ${seed}: excludeProgression location ${locId} has no placement`).toBeDefined();
        expect(
          itemClassById.get(itemId),
          `seed ${seed}: excludeProgression location ${locId} received progression item ${itemId}`,
        ).not.toBe('progression');
      }
    }
  });
});

// Golden-seed pins: committed exact placements for a small, fixed seed set.
// If this test ever fails without an intentional graph change, the fill
// algorithm or the graph silently changed behavior — that's the point.
describe('golden-seed pins', () => {
  it.each(GOLDEN_SEEDS)('seed %i matches its committed golden placement', (seed) => {
    // None of 1/2/3 are in RETRY_NEEDING_SEEDS, so fillWithRetry resolves at
    // attempt 0 (the raw seed) exactly like the old fillOnce/fill call did —
    // these goldens are unaffected by AMENDMENT 6's retry-derivation change.
    const result = fillWithRetry(graph, seed);
    // First run: this expect() intentionally fails so the implementer can
    // paste the actual output into tests/logic/__goldens__/fill-seed-<seed>.json.
    // Do NOT hand-author the golden file's content — generate it from a real
    // fillWithRetry() run and commit exactly that.
    expect(result.placements).toMatchFileSnapshot(`__goldens__/fill-seed-${seed}.json`);
  });
});
