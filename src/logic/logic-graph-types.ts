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

export type LogicItemClass = 'progression' | 'treasure' | 'filler';

export interface LogicItem {
  /** Same string as the object's id in src/data/objects.json. */
  id: string;
  class: LogicItemClass;
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
