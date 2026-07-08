// src/logic/fill.ts
import { Rng } from '../engine/rng.js';
import { computeReachable } from './reachability.js';
import type { LogicGraph } from './logic-graph-types.js';

export class FillError extends Error {}

export interface FillResult {
  /** locationId -> itemId placed there. */
  placements: Record<string, string>;
  /** Sphere-by-sphere progression placement order (one entry per progression
   *  item, in placement order) — the spoiler tool's primary output. */
  spheres: string[];
}

function shuffle<T>(arr: T[], rng: Rng): T[] {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = rng.nextInt(i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export function fill(graph: LogicGraph, seed: number): FillResult {
  const rng = new Rng(seed);

  // fill() operates over PLACEABLE items only — items whose id appears as
  // some location's objectId (plan AMENDMENTS rule 4). Event-created
  // treasures (DIAMOND, BAUBLE) are `class: "filler", isTreasure: true`
  // entries in items[] with no corresponding location — they keep their
  // vanilla creation mechanics (coal machine, canary) and exist solely for
  // goal/tracker accounting (`items.filter(i => i.isTreasure)`), never as
  // placement targets. AMENDMENT 3 (repair task 3R2): the six pinned vessel
  // items (COFFIN, SANDWICH-BAG, BOTTLE, BUOY, EGG, TUBE) never enter the
  // fill pool either — their own location entries were removed from the
  // graph (a pinned vessel's spot is occupied by definition), so they drop
  // out of `locationObjectIds` naturally; the explicit `!i.pinned` filter
  // below restates that invariant directly rather than relying only on the
  // graph shape. The count check asserts placeable.length ===
  // locations.length (43 === 43 against the real graph).
  const locationObjectIds = new Set(graph.locations.map(l => l.objectId));
  const shuffleEligible = graph.items.filter(i => locationObjectIds.has(i.id) && !i.pinned);

  const progression = shuffle(shuffleEligible.filter(i => i.class === 'progression').map(i => i.id), rng);
  const nonProgression = shuffle(
    shuffleEligible.filter(i => i.class !== 'progression').map(i => i.id),
    rng,
  );
  const allLocationIds = graph.locations.map(l => l.id);
  if (progression.length + nonProgression.length !== allLocationIds.length) {
    throw new FillError(
      `item count (${progression.length + nonProgression.length}) != location count (${allLocationIds.length})`,
    );
  }

  const placements: Record<string, string> = {};
  const spheres: string[] = [];
  const emptyLocations = new Set(allLocationIds);

  let remaining = [...progression];
  while (remaining.length > 0) {
    const item = remaining.pop()!;
    // AMENDMENT 2 (repair task 3R) — canonical assumed-fill ownership for
    // this placement step: assume every progression item NOT yet placed
    // except `item` itself (`remaining`, already popped, excludes it) —
    // never gate an item's own placement on itself. Already-placed items
    // are NOT folded in unconditionally: a placed item counts as owned
    // only once its own placed location is actually reachable under the
    // current owned set, discovered via a fixpoint sweep below. Blanket
    // "every placed item is owned" (the original bug) hides a genuine
    // circular placement — item A's spot needs B, item B's spot needs A —
    // behind an assumption that always resolves true.
    const assumedOwned = new Set(remaining);
    let sweepChanged = true;
    let reachableLocations = new Set<string>();
    while (sweepChanged) {
      sweepChanged = false;
      ({ reachableLocations } = computeReachable(graph, { ownedItems: assumedOwned, flags: new Set() }));
      for (const [locId, placedItemId] of Object.entries(placements)) {
        if (!assumedOwned.has(placedItemId) && reachableLocations.has(locId)) {
          assumedOwned.add(placedItemId);
          sweepChanged = true;
        }
      }
    }
    const candidates = [...reachableLocations].filter(id => emptyLocations.has(id));
    if (candidates.length === 0) {
      throw new FillError(`no reachable empty location for progression item "${item}" (seed ${seed})`);
    }
    const chosen = candidates[rng.nextInt(candidates.length)];
    placements[chosen] = item;
    emptyLocations.delete(chosen);
    spheres.push(item);
  }

  for (const item of nonProgression) {
    const remainingLocations = [...emptyLocations];
    if (remainingLocations.length === 0) {
      throw new FillError(`ran out of locations placing non-progression item "${item}" (seed ${seed})`);
    }
    const chosen = remainingLocations[rng.nextInt(remainingLocations.length)];
    placements[chosen] = item;
    emptyLocations.delete(chosen);
  }

  return { placements, spheres };
}

/** Bounded retry wrapper — Task 1's Step 4 note: should never actually retry
 *  against the real graph, but protects against a future graph edit that
 *  introduces a momentary unreachable-item edge case. */
export function fillWithRetry(graph: LogicGraph, seed: number, maxAttempts = 20): FillResult {
  let lastErr: unknown;
  for (let i = 0; i < maxAttempts; i++) {
    try {
      return fill(graph, seed + i);
    } catch (err) {
      if (!(err instanceof FillError)) throw err;
      lastErr = err;
    }
  }
  throw new FillError(`fillWithRetry exhausted ${maxAttempts} attempts starting at seed ${seed}: ${String(lastErr)}`);
}
