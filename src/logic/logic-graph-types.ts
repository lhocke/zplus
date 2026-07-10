/**
 * A rule clause. Fields present at the same level are implicitly ANDed
 * ({"region": "hades", "needs": ["bell","book","candles"]} means BOTH the
 * region is reachable AND all three items are owned). `any`/`all` are
 * explicit combinators for anything a flat AND can't express — `any` is a
 * logical OR over its sub-rules, `all` is an explicit AND (equivalent to
 * the flat form, useful when nesting a group under an `any`).
 * An empty object {} always evaluates true (no requirement).
 */
export interface AccessRule {
  needs?: string[];   // item ids — all must be in the owned-items set
  flags?: string[];   // engine FlagStore keys — all must be true
  region?: string;    // a single region id — must be reachable
  any?: AccessRule[]; // at least one sub-rule must hold
  all?: AccessRule[]; // every sub-rule must hold
}

/**
 * Fill-eligibility facet — orthogonal to `LogicItem.isTreasure` below.
 * `progression` items are the ones the assumed-fill algorithm (and the
 * reachability evaluator) must treat as access-granting; `filler` items
 * never gate anything. A treasure that also gates access (SCEPTRE gates
 * POT-OF-GOLD) is `class: "progression"` AND `isTreasure: true` — the two
 * facets are independent, so this single enum can no longer express
 * "treasure" as its own bucket (an earlier revision tried that and produced
 * unsolvable seeds whenever a gating treasure was placed after the location
 * it gates). Every item id cited in any access rule's `needs` MUST be
 * `class: "progression"` — mechanically enforced by the
 * logic-graph-validation suite's classification-invariant test.
 */
export type LogicItemClass = 'progression' | 'filler';

export interface LogicItem {
  /** Same string as the object's id in src/data/objects.json. */
  id: string;
  /** See `LogicItemClass` above. */
  class: LogicItemClass;
  /**
   * Goal-set facet: true for the 19 items that make up the vanilla win
   * condition (complete treasure set -> trophy case -> endgame). Independent
   * of `class` — most treasures are `filler` for fill purposes, but a
   * rule-cited treasure like SCEPTRE is `progression` and still
   * `isTreasure: true`. Downstream goal/tracker code must compute the
   * treasure set as `items.filter(i => i.isTreasure)`, never by `class` and
   * never as a hardcoded count.
   */
  isTreasure: boolean;
  /**
   * AMENDMENT 3 (vessel pinning): true for the six items that are also
   * containers of other checks (COFFIN, SANDWICH-BAG, BOTTLE, BUOY, EGG,
   * TUBE). A pinned item is never shuffled — it never enters a fill pool and
   * the engine placement seam never moves it, so it keeps its vanilla
   * position. This is what keeps a nested location's static `access` rule
   * (e.g. SCEPTRE's, containerId "COFFIN") true: the container it names is
   * guaranteed to still be exactly where the rule assumes. Absent/false for
   * every other item. The logic-graph-validation suite enforces the
   * converse: every location `containerId` that names an item id must name
   * a `pinned: true` item — the "vessel behind its own contents" cycle class
   * is thereby structurally impossible.
   */
  pinned?: boolean;
}

export interface LogicLocation {
  /** Stable location id. 1:1 with the vanilla resident object's id (the
   *  location IS that object's vanilla starting slot — see 1.2). */
  id: string;
  /** The object whose vanilla starting parent defines this slot. Always
   *  equal to `id` in this graph (kept as a separate field so a future
   *  graph revision could split a location from a specific object without
   *  a breaking rename). */
  objectId: string;
  /** The vanilla immediate parent (room OR container object id) — this is
   *  fed straight into the engine placementMap seam (Task 6) as the new
   *  parent for whichever item the fill algorithm assigns here. */
  containerId: string;
  /** Region id — must be one of the RegionKey values from
   *  src/ui/map-layout.ts (cross-checked by the validation test, which is
   *  the ONLY place that imports map-layout.ts — this file and the fill/
   *  reachability modules stay logic-pure with zero engine/ui imports). */
  region: string;
  /** Requirement to reach and take this location's item. */
  access: AccessRule;
  /**
   * AMENDMENT 5 (destructible-interior exclusion, repair task 3R4): true for
   * a location whose container can destroy its own contents on a plausible
   * "clumsy open" attempt (EGG's force-open — a weapon/tool used to pry it
   * open, or MUNG/THROW/CLIMB-ON — moves EGG to nowhere and never relocates
   * a still-inside CANARY; src/actions/above-ground.ts `badEgg()`, mirroring
   * zil/1actions.zil:2919-2966). A progression item placed here could become
   * permanently unrecoverable through ordinary play, which the static
   * reachability evaluator has no way to model as "safe via the thief
   * route" — so fill() must never place a `class: "progression"` item at an
   * `excludeProgression: true` location (treasures/filler only; this is
   * Archipelago's EXCLUDED-location semantics, applied narrowly). Absent/
   * false everywhere else.
   *
   * The other five pinned vessels were re-audited (repair task 3R4-fix)
   * against the same "clumsy open destroys contents" pattern:
   *   - BOTTLE also matches: V-THROW and V-MUNG (src/actions/bottle-water.ts
   *     bottleFunction, mirroring zil/1actions.zil:1491-1499) unconditionally
   *     moveTo(null) the bottle, and only the literal WATER object is rescued
   *     -- any other item filling the WATER slot is orphaned. WATER is now
   *     excludeProgression: true.
   *   - SANDWICH-BAG also matches, and is worse: it is Flag.Flammable, and
   *     the generic V-BURN handler (src/engine/verbs/index.ts verbBurn)
   *     destroys any Flammable object on burn with zero rescue of contents
   *     (and kills the player if they were holding it). GARLIC and LUNCH are
   *     now excludeProgression: true.
   *   - COFFIN, BUOY, and TUBE have no matching action-routine behavior --
   *     no destructive path was found for these three.
   */
  excludeProgression?: boolean;
  /**
   * AMENDMENT 9 (early-light zone, repair 3R7): true for the shallow zone —
   * locations whose access chain requires none of the five deep mechanisms
   * (river chain, dam drain, Hades ritual, coal machine, cyclops passage).
   * Randomization broke vanilla's light economy: the torch arrives early in
   * vanilla and the 385-turn lamp is only a bridge, so the fill places TORCH
   * first, restricted to earlyLight locations (Archipelago early_items
   * precedent — a pure placement constraint, zero engine/fuel changes; fuel
   * itself stays unmodeled per the Amendment 8 boundary). The zone is
   * DERIVED from the access rules, never eyeballed — the logic-graph
   * validation suite recomputes it (own every progression item except the
   * mechanism-embodying ones, run the reachability fixpoint, drop mechanism
   * regions) and fails on any drift. Absent/false everywhere else.
   */
  earlyLight?: boolean;
}

export interface LogicRegion {
  id: string;
  /** Room ids in this region (informational — mirrors map-layout.ts's
   *  RoomLayout.region grouping; the validation test cross-checks this
   *  against ROOM_BY_ID so the two taxonomies can never silently drift). */
  rooms: string[];
  /** Requirement to reach ANY room in this region from the start room. */
  access: AccessRule;
}

export interface LogicGraph {
  /** Bumped whenever locations/items/regions/rules change. Forces every
   *  previously-issued seed string to refuse to decode against a new
   *  graph (seed-string.ts, Task 4) rather than silently producing a
   *  different placement than the one the sharer intended. */
  logicVersion: number;
  /** SHA-256 hex digest (first 16 hex chars) of the canonicalized
   *  {locations, items, regions} content, EXCLUDING logicVersion and this
   *  field itself. The validation test recomputes it and fails loudly if
   *  it doesn't match what's checked in — the failure message tells the
   *  implementer to bump logicVersion AND update checksum together. This
   *  is what makes "did you forget to bump the version" a hard test
   *  failure instead of a hoped-for review catch. */
  checksum: string;
  locations: LogicLocation[];
  items: LogicItem[];
  regions: LogicRegion[];
}
