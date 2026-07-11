# Full Map Coverage — Regional Maps

**Status:** FINALIZED 2026-07-01 — decisions locked (legend-only seams; symmetric reveal via a direction-keyed MapState extension); full review panel + targeted re-review folded, including the `SMALL-CAVE`↔`ATLANTIS-ROOM` mixed-reciprocity fix (§6.6, §11 case 3). Ready for implementation planning. Data spine (partition, seam derivation, 10-pair reciprocal set) independently re-verified against `rooms.json`.
**Date:** 2026-06-30
**Owner:** Dylan
**Repo:** lhocke/zplus (private)
**Measured at:** `main 18489c8` — every `file:line` below is pinned to this checkout;
re-grep before editing if HEAD has moved.

> The live ASCII map today draws the ~20 rooms reachable before the troll wall and stops —
> the header comment on `map-layout.ts` says so outright, and the Known Issues modal
> apologizes for it. The engine has covered the full 110-room world for phases; the map
> never caught up. This spec closes that gap on the UI/shell side only (the engine is
> frozen) by replacing the single `surface`/`underground` plane with **nine regional maps**
> covering all 86 mapped rooms, an in-voice message for the 24 rooms in the two mazes that
> were never meant to be mapped, a **seam** system that tells the player where a region's
> edges lead, and paging so a player can browse any region they've already discovered. The
> stale Known Issues modal — four of whose five items are already false and whose fifth is
> obsoleted by this very work — is retired in the same pass.

---

## 1. Goal & Scope

### What this spec proves

Every one of the 110 rooms in `src/data/rooms.json` has a place on the map: the 86 rooms in
the nine mapped regions get a coordinate and render in a regional ASCII grid; the 24 rooms in
the two maze regions (Thief's Maze, Coal-Mine Maze) get a region assignment and an honest
"you are lost, no map will help" message instead of a grid. A player can see where they are,
see the paths out of the region they're in (including where a seam leads to a neighboring
region), and can flip through any region they've already set foot in.

### In scope

- **Regional data model** (§3) — `RoomLayout.level: 'surface' | 'underground'` replaced by
  `RoomLayout.region: RegionKey`, an 11-key union (9 mapped + 2 unmapped). Each mapped region
  gets its own `col`/`row` coordinate space, restarting at each region's own origin. The 5
  existing underground rooms (`CELLAR`, `TROLL-ROOM`, `EAST-OF-CHASM`, `GALLERY`, `STUDIO`)
  move into the `cellar-core` region with freshly authored coordinates (their current
  col/row values are not preserved — they belonged to the old single underground plane).
- **The validated region partition** (§4) — the canonical assignment of all 110 room ids to
  one of the 11 regions, re-derived from `rooms.json` and checked for completeness (no
  omissions, no duplicates).
- **Seam derivation and rendering** (§5, §6) — every exit whose destination room sits in a
  different region is a *seam*. The complete seam list (45 edges) is derived from
  `rooms.json` and given as a table (§5.3). Seams are rendered **legend-only**: there is no
  in-grid glyph or marker on any room box. A discovered seam produces exactly one line in a
  text legend beneath the grid, naming the neighboring region (§6.4).
- **Symmetric seam reveal** (§2, §6.6) — arriving in a new region through a reciprocal
  cross-region seam auto-credits the way-back `backtrack` exit record on arrival, the same as
  an intra-region reciprocal edge does today. `RoomSeam` gains a `reciprocal` flag (§3.3) and
  `map-state.ts`'s `RECIPROCAL_LOOKUP` widens to source reciprocal pairs from `ROOM_SEAMS` as
  well as `ROOM_CONNECTIONS`.
- **`renderMapGrid` generalization** (§6) — `levelFilter: 'surface' | 'underground'` becomes
  `regionFilter: RegionKey`. Box drawing, in-region connection drawing, and the `✕`
  blocked-stub mechanism are unchanged; the inter-level `⬇`/`⬆` stub mechanism is removed
  outright — the region model gives it no job to generalize into, since seams carry no
  in-grid glyph at all.
- **Maze rendering** (§7) — the two unmapped regions render no grid; a fixed in-voice string
  is shown instead.
- **View selection: auto-follow + paging** (§8) — the map (both the always-visible sidebar
  panel and the `map` modal) auto-follows the current room's region. The `map` modal
  additionally offers prev/next paging across every region the player has *discovered*
  (visited ≥1 room in), never a region they haven't reached — fog-of-war is preserved at the
  region-selection level, not just the room level.
- **Known Issues modal retirement** (§9) — `buildKnownIssuesDialog`, the `issuesBtn` button,
  the `openIssues` wiring, and the `data-open-issues` hook are removed, along with the one
  test that asserts the drawer's Known Issues button exists. "About & Credits" and "Send
  Feedback" are untouched.
- **Test guards** (§11) for partition completeness, coordinate-collision freedom, connection
  consistency, seam-legend correctness, reciprocal-seam backtrack crediting, maze rendering,
  paging fog-of-war, and the existing `map-state.ts` regression guards.

### Out of scope (note the path; do not build)

- **Any engine change.** `src/data/rooms.json`, the domain layer, and every subsystem under
  `src/engine`/`src/verbs`/`src/domain` are frozen for this work. This spec reads
  `rooms.json` as a static data source; it does not touch it.
- **`MapState`'s discovery-rule semantics.** The directed exit-record fog-of-war model
  (walked/backtrack/blocked, `exits[].known` never read) is not being redesigned — only its
  reciprocal-pair *source* widens to include reciprocal cross-region seams (§2, §6.6). That
  widening is the one narrow `map-state.ts` change this spec makes; the discovery rules
  themselves, and the §2.3 regression guards that pin them, stay unmodified and green (§11).
- **A world-scale or multi-region overview map.** Decision-locked: this is nine independent
  regional planes, not one big plane and not a zoomed-out meta-map showing all nine regions
  at once. A future overview map is a plausible follow-on, not part of this spec.
- **Save/restore interaction.** `MapState` (fog-of-war) and the new paging state are shell-side
  ephemeral UI state, outside `Game`'s `SaveState` (phase-4-save-restore.md §3) and outside
  this spec's scope. Neither survives nor needs to survive a save/restore round-trip; this
  spec does not touch `session.ts` or `SaveState`.
- **A minimap thumbnail, zoom controls, or click-to-navigate on the grid.** The grid stays
  read-only ASCII text, same interaction model as today.
- **Mobile-specific map layout.** The existing responsive drawer/sidebar split is unchanged;
  regions render through the same `buildMap` (sidebar) and `buildMapModal` (`map` command)
  paths that exist today.

### Non-goals

- No change to the fog-of-war discovery rules (walked/backtrack/blocked) — §2.3 of
  `map-state.ts`'s own header comment is the governing spec and is unchanged.
- No change to `buildPathsPanel`'s ("Paths from Here") direction-listing behavior — it lists
  exits by label and does not care about grid geometry; the only change it needs is a type
  update (`level: string` → structurally compatible with the new `RoomLayout` shape), not a
  logic change.
- No redesign of the ASCII box-drawing primitives (`drawRoom`, `drawConnection`, box
  dimensions `CELL_W`/`CELL_H`/`CON_W`/`CON_H`). Those stay exactly as authored.

---

## 2. Current-State Reconciliation

Measured against `src/` at `main 18489c8`. Legend: **DONE** = already correct, no change:
**EXTEND** = add to/generalize existing code, keep the rest; **NEW** = does not exist yet;
**GAP** = a real correctness/completeness hole this spec closes.

### `src/ui/map-layout.ts` — EXTEND (rewritten around the new schema; becomes a barrel — §10)

The file's own header comment (`map-layout.ts:1–4`) says: *"Hand-authored layout for the ~20
pre-troll rooms... Rooms past the troll wall are absent — the map can't depict the gated
region."* That is the gap this spec closes. Specifically:

- `RoomLayout` (`map-layout.ts:6–12`) has `level: 'surface' | 'underground'` — becomes
  `region: RegionKey` with `col`/`row` **optional** (§3.1). This type, `RegionKey`,
  `REGION_DISPLAY_NAMES`, and `MAPPED_REGIONS` are all defined directly in `map-layout.ts` and
  stay foundation-owned (§10).
- `ROOM_LAYOUT` (`map-layout.ts:28–56`) has exactly 20 entries, 15 `surface` +
  5 `underground` — grows to 110 entries: 86 with coordinates (one of 9 mapped regions),
  24 with a region key and no coordinates (one of 2 unmapped regions). Per §10's file split,
  `ROOM_LAYOUT`'s *contents* are no longer hand-typed directly in this file — `map-layout.ts`
  imports and aggregates each region's own module under `src/ui/map-regions/<region>.ts` (one
  per §4 region, each owning its rooms' `col`/`row`/`label` and intra-region connections) into
  the flat `ROOM_LAYOUT` array this section otherwise describes; every downstream reader
  (renderer, `MapState`, tests) sees the same aggregate shape as before.
- `ROOM_CONNECTIONS` (`map-layout.ts:61–92`) has 26 entries, all intra-plane (both endpoints
  in the single 20-room layout) — becomes per-region intra-region connections only. A
  cross-region edge is never a `ROOM_CONNECTIONS` entry (§3.2); it is a `ROOM_SEAMS` entry
  (§3.3, NEW).
- `ROOM_BY_ID` (`map-layout.ts:95–97`) — mechanical, the `Map<string, RoomLayout>` shape
  follows the interface change; no logic change.

### `src/ui/map-state.ts` — EXTEND (reciprocal-source widening only)

`MapState` is already data-driven over arbitrary room ids — `_visited: Set<string>` and
`_exits: Map<string, Map<string, ExitRecord>>` (`map-state.ts:45–47`) never consult
`ROOM_LAYOUT`/region data directly. What this spec adds: a new **direction-keyed** `RECIPROCAL_SEAM_DIRS: Set<string>`
(keyed `` `${seam.from}|${seam.dir}` ``) built from the `reciprocal: true` entries of
`ROOM_SEAMS` (§3.3, §5.2) — so `map-state.ts` gains an import of `ROOM_SEAMS` alongside its
existing `ROOM_CONNECTIONS` import (`map-state.ts:17`). The existing pair-keyed
`RECIPROCAL_LOOKUP` (`map-state.ts:34–38`) and `isReciprocal()` (`map-state.ts:40–42`) are
**unchanged** — they keep serving intra-region `ROOM_CONNECTIONS` only. The backtrack-crediting
site inside `MapState.update()` (`map-state.ts:94–103`) gains **one** added `||` condition that
consults `RECIPROCAL_SEAM_DIRS`. §6.6 pins exactly why the seam source must be *direction*-keyed
and must NOT be folded into the pair-keyed `RECIPROCAL_LOOKUP` (the `SMALL-CAVE`↔`ATLANTIS-ROOM`
mixed-reciprocity pair would corrupt fog-of-war otherwise). The `§2.3` regression guard —
*"`exits[].known` is deliberately NEVER READ"* (`map-state.ts:13`, the field itself defined at
`map-state.ts:29`) — is a standing invariant this spec does not touch; §11 keeps that test
green unmodified and adds one new test for the widened reciprocal source.

### `src/ui/shell.ts` — EXTEND (renderer, modal, sidebar) + GAP retired (Known Issues)

- **`renderMapGrid`** (`shell.ts:319–520`) — signature at `shell.ts:319–326` takes
  `levelFilter: 'surface' | 'underground'` (`:325`) and a `rooms` map typed with
  `level: 'surface' | 'underground'` (`:322`); filters `visited` down to the current level at
  `:330`. `drawInterLevelStub` (`:453–468`) draws `⬇`/`⬆` for exits crossing levels, keyed off
  `destRoom.level !== levelFilter` (`:463`) with a `destRoom ? ... : true` fallback that
  treats an *absent* room (i.e. past the troll wall, not yet in `ROOM_LAYOUT`) as
  automatically cross-level. `drawBlockedStubs` (`:470–489`) has its own, unrelated
  per-direction edge/corner placement table (`:480–487`) for `east`/`west`/`north`/`south`/
  `up`/`down` — under legend-only seams (§6.3), that table is **not** generalized or reused
  for anything seam-related; `drawInterLevelStub` is simply deleted, with no glyph-drawing
  successor of any kind.
- **`buildPathsPanel`** (`shell.ts:524–559`) — takes `roomById` typed with `level: string`
  at `:526`; only reads `.label`. Type-only change (§2 non-goals), no logic change.
- **`buildMap`** (sidebar quick-view, `shell.ts:561–593`) and **`buildMapModal`**
  (`shell.ts:1032–1132`) both independently derive `currentLevel` from the current room
  (`:580`, `:1086`) and pass it straight through to `renderMapGrid` (`:586–587`, `:1093`).
  **Correction to the brief's framing:** there is no *manual* surface/underground toggle
  control anywhere in `shell.ts` (confirmed by grep — no button, no keybinding, no UI
  affordance). What exists is **auto-follow**: the rendered plane always matches the current
  room's `level`. §8 generalizes this auto-follow logic to regions and adds the one genuinely
  new capability — modal-only prev/next paging — which did not exist in any form before.
- **`buildKnownIssuesDialog`** (`shell.ts:601–678`) — GAP, retire (§9). Its five-item list
  (`shell.ts:646–652`) has one item that is this spec's own subject (`:648`,
  *"The map only covers the surface and the first rooms underground..."*) and three more that
  are stale post-feature-completion per the port-feature-complete project memory (no
  save/restore item — save/restore shipped in Phase 4; no "not fully wired" temple/Hades
  item — content landed; no partial-350-points item — scoring is complete). Wiring to retire:
  `openIssues`/`issuesDialog` destructuring (`:1500`), `issuesBtn` creation and its
  `data-open-issues` attribute (`:1529`), its click handler (`:1531`), its sidebar mount
  (`:1588`), the drawer re-wire (`:1608–1609`), and the modal's mount into `app`
  (`:1645`). `creditsBtn`/`openCredits` (`:1534–1536`) and `feedbackBtn`/`openFeedback`
  (`:1539–1541`) are untouched.

### `src/data/rooms.json` — DONE, source of truth, untouched

110 rooms confirmed by direct count. Each room's `exits[]` entries carry `dir` and,
where the exit leads somewhere, `to`; entries without `to` (a wall, an `elseMessage`-only
blocked direction) carry no destination and are not connections. §4 and §5 are both derived
mechanically from this file's `exits[].to` graph — see the derivation method in each section
for exact reproducibility.

### Tests — EXTEND / NEW / retire one assertion

- `tests/shell/map-layout.test.ts` (218 lines) — the `ROOM_LAYOUT covers exactly the 20
  expected rooms` assertion (`:43–45`) and the level-field tests (`:20–53`) are rewritten for
  the region model (§11). The reciprocal-flag tests (`:55–125`) keep their *pattern*
  (asserting specific room pairs) but move to the region files they now live in.
- `tests/shell/render-map-grid.test.ts` (98 lines) — the level-filtering tests (`:27–44`)
  generalize to region-filtering tests; the inter-level-stub tests (`:78–97`) are **deleted**,
  not generalized — `drawInterLevelStub` has no successor under legend-only seams (§6.3), and
  the new seam-legend assertions live in their own new file, `region-seam-legend.test.ts`
  (§11), not in this file.
- `tests/shell/map-state.test.ts` (212 lines) — EXTEND; its existing regression guard
  (`describe` at `:198`, *"exits\[\].known is never read"*) must keep passing exactly as
  written (§2, §11), and one new test is added for the widened reciprocal source: walking a
  reciprocal cross-region seam credits a `backtrack` record on arrival; walking a
  non-reciprocal seam does not (§6.6, §11).
- `tests/shell/mobile-drawer.test.ts` (60 lines) — the `drawer Known Issues button opens the
  known-issues dialog` test, the full `it(...)` block at `:21–33` (not `:21–28` — verify by
  reading the file; the block's closing `});` is at line 33), is deleted as part of §9's
  retirement, along with the dangling `buildKnownIssuesDialog` comment reference at `:5`; no
  replacement assertion (the drawer simply has one fewer button).
- `tests/shell/seam.test.ts` (already exists, unrelated) — **naming collision to avoid**:
  this file's "seam" is the pre-existing session/engine integration-boundary test convention
  (golden-transcript, `GameSession.snapshot()` contract, sink lifecycle — nothing to do with
  the map). §11's new region-seam tests must NOT be added to this file and must not be named
  `seam.test.ts` — use `region-seam-derivation.test.ts` and `region-seam-legend.test.ts`
  (§11) to keep the two concepts visually distinct in the test tree.

---

## 3. Region Model & Data Schema

### 3.1 `RegionKey` and the updated `RoomLayout` (`src/ui/map-layout.ts`)

```ts
export type MappedRegionKey =
  | 'surface'
  | 'cellar-core'
  | 'dam'
  | 'mine'
  | 'river'
  | 'mirror'
  | 'temple'
  | 'canyon'
  | 'cyclops';

export type UnmappedRegionKey = 'thief-maze' | 'mine-maze';

export type RegionKey = MappedRegionKey | UnmappedRegionKey;

export const REGION_DISPLAY_NAMES: Record<RegionKey, string> = {
  surface:      'Surface',
  'cellar-core': 'Cellar & Central Passages',
  dam:          'Dam & Reservoir',
  mine:         'Coal Mine',
  river:        'River',
  mirror:       'Mirror Rooms & Twisty Passages',
  temple:       'Temple & Hades',
  canyon:       'Canyon & Falls',
  cyclops:      'Cyclops & Treasure',
  'thief-maze': "Thief's Maze",
  'mine-maze':  'Coal-Mine Maze',
};

// Regions that render a grid (have col/row). Order is the canonical paging order (§8.2).
export const MAPPED_REGIONS: MappedRegionKey[] = [
  'surface', 'cellar-core', 'dam', 'mine', 'river',
  'mirror', 'temple', 'canyon', 'cyclops',
];

export interface RoomLayout {
  id: string;
  label: string;
  region: RegionKey;
  col?: number;   // absent iff region is unmapped (thief-maze | mine-maze)
  row?: number;   // absent iff region is unmapped
}
```

`level` is removed entirely — not deprecated, not kept alongside `region`. Every reader of
`RoomLayout.level` in `shell.ts` (§2) is updated in the same foundation task that lands this
schema change, since the type change makes stale readers a compile error, not a silent bug.

Coordinate spaces are **per region**: `col`/`row` are meaningful only relative to other rooms
in the *same* region. Two rooms in different regions may legitimately share a `(col, row)`
pair — that is not a collision (§11's collision guard is intra-region only).

### 3.2 `RoomConnection` — unchanged shape, intra-region-only contents

```ts
export interface RoomConnection {
  a: string;
  b: string;
  reciprocal: boolean;   // same convention as today — see map-layout.ts:17-21
}
```

The interface is byte-identical to today's (`map-layout.ts:14–22`). What changes is scope:
every entry's `a` and `b` **must** resolve to rooms in the same region (§11 enforces this as
a guard — a `ROOM_CONNECTIONS` entry spanning two regions is a bug, not a seam). The
reciprocal-flag judgment call (does the return exit use the exact compass-opposite direction)
follows the same by-inspection convention already established in the current file's inline
comments (e.g. `map-layout.ts:85`'s `KITCHEN`↔`STUDIO` non-reciprocal note) — this spec does
not mechanize that judgment; each per-region authoring task (§10) makes it per pair, same as
today.

### 3.3 `RoomSeam` — NEW, the cross-region edge list

```ts
export interface RoomSeam {
  from: string;         // room id, always in a MAPPED region
  dir: Dir;              // exit direction from `from` (any of the 12 Dir values)
  to: string;            // destination room id, in a DIFFERENT region than `from`
  toRegion: RegionKey;   // the neighboring region (mapped or unmapped)
  reciprocal: boolean;   // true iff ROOM_SEAMS also holds the return seam
                          // (from: to, to: from, dir: opposite(this.dir)) — §5.2 step 4
}

export const ROOM_SEAMS: RoomSeam[] = [ /* 45 entries — §5.3 */ ];
```

Both halves of a reciprocal pair carry `reciprocal: true`. Since `ROOM_SEAMS` only holds
mapped-origin seams (§5.2 step 3), a seam whose only possible return half would originate in
an unmapped region (a maze) never reciprocates — that return half simply isn't in
`ROOM_SEAMS` to check against, so the correct, unambiguous answer is `reciprocal: false`, not
a special case. §6.6 walks through the exact reciprocal set this produces.

Every `RoomSeam.from` room is in a mapped region — a seam originating in an unmapped region
(e.g. `MAZE-1`'s return exit to `TROLL-ROOM`) is not represented in `ROOM_SEAMS`, because
unmapped regions never render a grid or a legend at all (§7's fixed in-voice message replaces
both). The *inbound* half of that same physical connection (`TROLL-ROOM`'s exit into
`MAZE-1`) **is** in `ROOM_SEAMS`, since `TROLL-ROOM` is in the mapped `cellar-core` region.
§5 states this filtering rule precisely and gives the full derivation.

---

## 4. The Region Partition (ground truth)

Re-derived directly from `src/data/rooms.json` and validated: **110/110 rooms placed, zero
duplicates, zero omissions** (every room id in `rooms.json` appears in exactly one region
below; every id in the partition below exists in `rooms.json`).

| Region key | Display name | Rooms | Mapped? |
|---|---|---|---|
| `surface` | Surface | 16 | yes |
| `cellar-core` | Cellar & Central Passages | 13 | yes |
| `dam` | Dam & Reservoir | 10 | yes |
| `mine` | Coal Mine | 12 | yes |
| `river` | River | 10 | yes |
| `mirror` | Mirror Rooms & Twisty Passages | 8 | yes |
| `temple` | Temple & Hades | 7 | yes |
| `canyon` | Canyon & Falls | 6 | yes |
| `cyclops` | Cyclops & Treasure | 4 | yes |
| `thief-maze` | Thief's Maze | 19 | no |
| `mine-maze` | Coal-Mine Maze | 5 | no |

Mapped total: 86. Unmapped total: 24. Grand total: 110.

Room membership (identical to the locked partition; restated here as the spec's own
ground-truth table, since §11's completeness guard tests against it directly):

- **`surface`** (16): `WEST-OF-HOUSE`, `NORTH-OF-HOUSE`, `SOUTH-OF-HOUSE`, `EAST-OF-HOUSE`,
  `FOREST-1`, `FOREST-2`, `FOREST-3`, `PATH`, `UP-A-TREE`, `GRATING-CLEARING`, `CLEARING`,
  `MOUNTAINS`, `KITCHEN`, `ATTIC`, `LIVING-ROOM`, `STONE-BARROW`
- **`cellar-core`** (13): `CELLAR`, `TROLL-ROOM`, `EAST-OF-CHASM`, `GALLERY`, `STUDIO`,
  `EW-PASSAGE`, `ROUND-ROOM`, `NS-PASSAGE`, `CHASM-ROOM`, `DEEP-CANYON`, `LOUD-ROOM`,
  `DAMP-CAVE`, `ENGRAVINGS-CAVE`
- **`dam`** (10): `RESERVOIR-SOUTH`, `RESERVOIR`, `RESERVOIR-NORTH`, `STREAM-VIEW`,
  `IN-STREAM`, `ATLANTIS-ROOM`, `DAM-ROOM`, `DAM-LOBBY`, `MAINTENANCE-ROOM`, `DAM-BASE`
- **`mine`** (12): `MINE-ENTRANCE`, `SQUEEKY-ROOM`, `BAT-ROOM`, `SHAFT-ROOM`, `SMELLY-ROOM`,
  `GAS-ROOM`, `LADDER-TOP`, `LADDER-BOTTOM`, `TIMBER-ROOM`, `LOWER-SHAFT`, `MACHINE-ROOM`,
  `SLIDE-ROOM`
- **`river`** (10): `RIVER-1`, `RIVER-2`, `RIVER-3`, `RIVER-4`, `RIVER-5`,
  `WHITE-CLIFFS-NORTH`, `WHITE-CLIFFS-SOUTH`, `SHORE`, `SANDY-BEACH`, `SANDY-CAVE`
- **`mirror`** (8): `MIRROR-ROOM-1`, `MIRROR-ROOM-2`, `SMALL-CAVE`, `TINY-CAVE`,
  `COLD-PASSAGE`, `NARROW-PASSAGE`, `WINDING-PASSAGE`, `TWISTING-PASSAGE`
- **`temple`** (7): `EGYPT-ROOM`, `DOME-ROOM`, `TORCH-ROOM`, `NORTH-TEMPLE`, `SOUTH-TEMPLE`,
  `ENTRANCE-TO-HADES`, `LAND-OF-LIVING-DEAD`
- **`canyon`** (6): `CANYON-VIEW`, `CLIFF-MIDDLE`, `CANYON-BOTTOM`, `END-OF-RAINBOW`,
  `ON-RAINBOW`, `ARAGAIN-FALLS`
- **`cyclops`** (4): `CYCLOPS-ROOM`, `STRANGE-PASSAGE`, `TREASURE-ROOM`, `GRATING-ROOM`
- **`thief-maze`** (19): `MAZE-1`…`MAZE-15`, `DEAD-END-1`…`DEAD-END-4`
- **`mine-maze`** (5): `MINE-1`…`MINE-4`, `DEAD-END-5`

**Derivation method (for the completeness test, §11):** build `roomRegion: Map<id, RegionKey>`
from the table above; assert `roomRegion.size === rooms.json.length` and that every
`rooms.json` room id is a key. This is a pure data-comparison test, no rendering involved.

---

## 5. Seam Derivation & the Seam Table

### 5.1 What counts as a seam

A **seam** is a directed exit `(fromRoom, dir, toRoom)` where `fromRoom` and `toRoom` are in
different regions, restricted to the direction where `fromRoom`'s region is **mapped**
(§3.3). An exit with no `to` (a wall or an `elseMessage`-only blocked direction) is never a
seam — only real destinations count.

### 5.2 Derivation method (reproducible)

1. Build `roomRegion: Map<id, RegionKey>` from §4.
2. For every room `r` in `rooms.json`, for every `exit` in `r.exits` with a truthy `exit.to`:
   if `roomRegion[r.id] !== roomRegion[exit.to]`, it is a seam candidate
   `{ from: r.id, dir: exit.dir, to: exit.to, toRegion: roomRegion[exit.to] }`.
3. Keep the candidate only if `roomRegion[r.id]` is one of the 9 `MAPPED_REGIONS` — this
   drops the maze-side halves of thief-maze/coal-mine-maze seams (e.g. `MAZE-1`'s exit back
   to `TROLL-ROOM` is dropped; `TROLL-ROOM`'s exit into `MAZE-1` is kept).
4. For each kept seam `(from, dir, to)`, set `reciprocal: true` iff the kept set also contains
   the return seam `(to, opposite(dir), from)` — i.e. `to`'s exit in the compass-opposite
   direction lands back on `from`. Both halves of a reciprocal pair get `reciprocal: true`; a
   one-way seam gets `reciprocal: false` — either because the far room has no matching
   return exit at all, because its return exit uses a different direction (e.g. `KITCHEN`
   ↓ `STUDIO` has no `STUDIO` ↑ `KITCHEN` return, per the existing non-reciprocal note at
   `map-layout.ts:85`), or because the far room is in an unmapped region and so has no
   `ROOM_SEAMS` entry to check against at all (step 3).

Running this over the current `rooms.json` (110 rooms, 308 directed exits with a destination)
produces **45 seam edges**, given verbatim in §5.3. Of those, 39 have a mapped `from` region
and are the actual `ROOM_SEAMS` entries; running step 4 over those 39 yields **10 reciprocal
pairs (20 of the 39 seams)** — the exact set is enumerated in §6.6.

### 5.3 The complete seam table

| From room | Dir | To room | From region | To region | Reciprocal |
|---|---|---|---|---|---|
| `ARAGAIN-FALLS` | north | `SHORE` | Canyon & Falls | River | yes |
| `CANYON-VIEW` | nw | `CLEARING` | Canyon & Falls | Surface | no |
| `CANYON-VIEW` | west | `FOREST-3` | Canyon & Falls | Surface | no |
| `CELLAR` | up | `LIVING-ROOM` | Cellar & Central Passages | Surface | no |
| `CHASM-ROOM` | ne | `RESERVOIR-SOUTH` | Cellar & Central Passages | Dam & Reservoir | yes |
| `DAMP-CAVE` | east | `WHITE-CLIFFS-NORTH` | Cellar & Central Passages | River | yes |
| `DEEP-CANYON` | nw | `RESERVOIR-SOUTH` | Cellar & Central Passages | Dam & Reservoir | yes |
| `DEEP-CANYON` | east | `DAM-ROOM` | Cellar & Central Passages | Dam & Reservoir | no |
| `ENGRAVINGS-CAVE` | east | `DOME-ROOM` | Cellar & Central Passages | Temple & Hades | yes |
| `ROUND-ROOM` | south | `NARROW-PASSAGE` | Cellar & Central Passages | Mirror Rooms & Twisty Passages | yes |
| `TROLL-ROOM` | west | `MAZE-1` | Cellar & Central Passages | Thief's Maze | no |
| `CYCLOPS-ROOM` | nw | `MAZE-15` | Cyclops & Treasure | Thief's Maze | no |
| `GRATING-ROOM` | sw | `MAZE-11` | Cyclops & Treasure | Thief's Maze | no |
| `GRATING-ROOM` | up | `GRATING-CLEARING` | Cyclops & Treasure | Surface | no |
| `STRANGE-PASSAGE` | east | `LIVING-ROOM` | Cyclops & Treasure | Surface | yes |
| `ATLANTIS-ROOM` | up | `SMALL-CAVE` | Dam & Reservoir | Mirror Rooms & Twisty Passages | yes |
| `DAM-ROOM` | south | `DEEP-CANYON` | Dam & Reservoir | Cellar & Central Passages | no |
| `RESERVOIR-SOUTH` | se | `DEEP-CANYON` | Dam & Reservoir | Cellar & Central Passages | yes |
| `RESERVOIR-SOUTH` | sw | `CHASM-ROOM` | Dam & Reservoir | Cellar & Central Passages | yes |
| `GAS-ROOM` | east | `MINE-1` | Coal Mine | Coal-Mine Maze | no |
| `LADDER-BOTTOM` | south | `DEAD-END-5` | Coal Mine | Coal-Mine Maze | no |
| `LADDER-TOP` | up | `MINE-4` | Coal Mine | Coal-Mine Maze | no |
| `SLIDE-ROOM` | east | `COLD-PASSAGE` | Coal Mine | Mirror Rooms & Twisty Passages | yes |
| `SLIDE-ROOM` | down | `CELLAR` | Coal Mine | Cellar & Central Passages | no |
| `COLD-PASSAGE` | west | `SLIDE-ROOM` | Mirror Rooms & Twisty Passages | Coal Mine | yes |
| `NARROW-PASSAGE` | north | `ROUND-ROOM` | Mirror Rooms & Twisty Passages | Cellar & Central Passages | yes |
| `SMALL-CAVE` | down | `ATLANTIS-ROOM` | Mirror Rooms & Twisty Passages | Dam & Reservoir | yes |
| `SMALL-CAVE` | south | `ATLANTIS-ROOM` | Mirror Rooms & Twisty Passages | Dam & Reservoir | no |
| `TINY-CAVE` | down | `ENTRANCE-TO-HADES` | Mirror Rooms & Twisty Passages | Temple & Hades | yes |
| `RIVER-1` | west | `DAM-BASE` | River | Dam & Reservoir | no |
| `RIVER-1` | out | `DAM-BASE` | River | Dam & Reservoir | no |
| `SHORE` | south | `ARAGAIN-FALLS` | River | Canyon & Falls | yes |
| `WHITE-CLIFFS-NORTH` | west | `DAMP-CAVE` | River | Cellar & Central Passages | yes |
| `CLEARING` | east | `CANYON-VIEW` | Surface | Canyon & Falls | no |
| `KITCHEN` | down | `STUDIO` | Surface | Cellar & Central Passages | no |
| `LIVING-ROOM` | west | `STRANGE-PASSAGE` | Surface | Cyclops & Treasure | yes |
| `DOME-ROOM` | west | `ENGRAVINGS-CAVE` | Temple & Hades | Cellar & Central Passages | yes |
| `ENTRANCE-TO-HADES` | up | `TINY-CAVE` | Temple & Hades | Mirror Rooms & Twisty Passages | yes |
| `SOUTH-TEMPLE` | down | `TINY-CAVE` | Temple & Hades | Mirror Rooms & Twisty Passages | no |
| `MAZE-1` | east | `TROLL-ROOM` | Thief's Maze | Cellar & Central Passages | n/a — dropped |
| `MAZE-11` | ne | `GRATING-ROOM` | Thief's Maze | Cyclops & Treasure | n/a — dropped |
| `MAZE-15` | se | `CYCLOPS-ROOM` | Thief's Maze | Cyclops & Treasure | n/a — dropped |
| `DEAD-END-5` | north | `LADDER-BOTTOM` | Coal-Mine Maze | Coal Mine | n/a — dropped |
| `MINE-1` | north | `GAS-ROOM` | Coal-Mine Maze | Coal Mine | n/a — dropped |
| `MINE-4` | down | `LADDER-TOP` | Coal-Mine Maze | Coal Mine | n/a — dropped |

45 rows. The `Reciprocal` column is `n/a — dropped` for the six rows whose `From region` is
unmapped (§5.2 step 3 excludes them from `ROOM_SEAMS` entirely, so there is no `reciprocal`
value to compute); every other row's `Reciprocal` value is the literal `reciprocal` field
that row's `ROOM_SEAMS` entry carries (§3.3, §5.2 step 4). Six of them originate in an unmapped region (`MAZE-1`, `MAZE-11`, `MAZE-15`,
`DEAD-END-5`, `MINE-1`, `MINE-4`) — these exist in this table for **completeness of the
derivation record** — §5.2 step 3 says these are *dropped from `ROOM_SEAMS`* because their
`from` region is unmapped. They are listed here so the table is self-verifying (every edge
`rooms.json` actually has is accounted for, either kept or explicitly dropped) but **only the
39 rows whose `From region` column is one of the 9 mapped regions are `ROOM_SEAMS`
entries.**

### 5.4 A room may have more than one discovered seam

Two rooms have more than one seam edge landing on the *identical destination room*:

- **`SMALL-CAVE`** → `ATLANTIS-ROOM` via both `down` and `south`.
- **`RIVER-1`** → `DAM-BASE` via both `west` and `out`.

Both directions are real, independent entries in `rooms.json` and both stay in `ROOM_SEAMS`
(§5.2 does not deduplicate by destination). Under legend-only rendering (§6.4) there is no
collision to handle: each seam is just a row in `roomRegion`'s neighbor list, and each
discovered seam produces its own legend line, independent of whatever other seams the same
room has. `SMALL-CAVE` with both exits discovered shows two legend lines (`down` and
`south`, both naming Dam & Reservoir); `RIVER-1` with both exits discovered likewise shows
two lines (`west` and `out`, both naming Dam & Reservoir). No dedup-by-neighbor is performed
— showing the same destination region twice for two genuinely different exits is honest, not
redundant, though collapsing same-neighbor lines is a plausible future polish (not part of
this spec).

---

## 6. Renderer Generalization (`src/ui/shell.ts`)

### 6.1 `renderMapGrid` signature

```ts
export function renderMapGrid(
  visited: ReadonlySet<string>,
  current: string | null,
  rooms: ReadonlyMap<string, { id: string; label: string; region: RegionKey; col?: number; row?: number }>,
  connections: ReadonlyArray<{ a: string; b: string; reciprocal: boolean }>,
  seams: ReadonlyArray<RoomSeam>,
  exitRecords: ReadonlyMap<string, ReadonlyMap<string, ExitRecord>>,
  regionFilter: MappedRegionKey,
): string
```

`levelFilter: 'surface' | 'underground'` (`shell.ts:325`) is replaced by
`regionFilter: MappedRegionKey` — the type is `MappedRegionKey`, not the full `RegionKey`,
because `renderMapGrid` is never called with an unmapped region (§7 routes those to a
different, grid-free render path before `renderMapGrid` is reached). `seams: ROOM_SEAMS` is a
new parameter — the caller passes the full static list; the function first narrows it to seams
whose `from` room is in `visibleVisited`, then applies the **authoritative per-exit-record
discovery gate of §6.3** (a seam is included only if that room has a `walked`/`backtrack` record
matching the seam's `dir`). The `visibleVisited` narrowing is a coarse pre-filter, not the
inclusion test — §6.3 is authoritative, so a seam whose `from` room is visited but whose
specific exit was never walked is correctly excluded. Under legend-only rendering (§6.3, §6.4),
`renderMapGrid` uses `seams` for exactly one purpose: emitting the legend block. There is no
glyph-placement pass over `seams` — the output is the grid text, optionally followed by the
legend.

Room filtering (`shell.ts:330`, `rooms.get(id)?.level === levelFilter`) becomes
`rooms.get(id)?.region === regionFilter`. Because every room — mapped or not — now has an
entry in `ROOM_BY_ID` (unlike today, where a past-the-troll room is simply absent), the old
defensive fallback in `drawInterLevelStub` (`destRoom ? destRoom.level !== levelFilter : true`
at `shell.ts:463`, which treated an absent room as automatically cross-plane) is no longer
reachable in normal operation and is moot besides — `drawInterLevelStub` itself is deleted,
not generalized (§6.3). Every `rec.to` in a discovered exit record now resolves to a real
`RoomLayout` entry, so the fog-of-war lookup that replaces it (§6.3) needs no defensive
"missing room" fallback at all; if a lookup ever misses under the completed partition, that
is a real bug, not a case to degrade gracefully from.

### 6.2 Box drawing, in-region connections, blocked stubs — unchanged in logic, not literally untouched

`drawRoom`, `drawConnection`, and the two-pass draw order (connections first, then room boxes
overdrawing the connector line at the junction, `shell.ts:491–509`) are untouched in logic.
`drawBlockedStubs` (`shell.ts:470–489`) is untouched outright — its per-direction edge/corner
table (`shell.ts:480–487`) has no successor under legend-only seams (§6.3 removes the
seam-marker mechanism that would have generalized it; blocked stubs keep their existing,
unrelated table).

**Correction to an earlier overclaim:** "unchanged" does not mean the bounding-box/
`cellOrigin` math compiles with zero edits. `RoomLayout.col`/`row` are now `number |
undefined` (§3.1, since unmapped-region rooms carry neither). Every call site that computes a
room's box origin — the bounding-box pass and `cellOrigin`-style helpers inside
`renderMapGrid` — only ever runs over rooms already filtered to `regionFilter:
MappedRegionKey` (§6.1), so `col`/`row` are non-null in practice at every such site, but the
type system doesn't know that automatically. Each site needs non-null narrowing (a guard, a
non-null assertion justified by the `regionFilter` filter having already run, or a re-typed
intermediate `{ col: number; row: number }` shape) — a small, mechanical, TypeScript-only
change, not a logic change.

### 6.3 Seam discovery gate (replaces `drawInterLevelStub`, `shell.ts:453–468`)

`drawInterLevelStub` is **deleted outright** — it is not generalized into a glyph-drawing
function, because under legend-only rendering there is no in-grid seam glyph for any function
to draw. A seam's cross-level "job" (§2's old framing) simply doesn't exist anymore under the
region model: seams are represented exclusively in the legend (§6.4).

The one piece of the old mechanism that does carry forward is fog-of-war:

**Discovery rule:** a `RoomSeam` is **discovered** iff `exitRecords.get(seam.from)` has an
entry whose `dir === seam.dir` and whose `kind` is `walked` or `backtrack` (not `blocked`).
This is the same fog-of-war gate the in-region connection drawing already uses
(`hasExitRecord`, `shell.ts:441–448`) — an undiscovered seam contributes nothing to the
legend, exactly as an undiscovered in-region connection draws nothing on the grid.

That is the entire mechanism. There is no placement-slot table, no seam-vs-connector
collision handling, no priority-order dedup, and no glyph. `renderMapGrid` collects the
discovered seams for the rooms visible under the current `regionFilter` and hands them to the
legend builder (§6.4); it does not otherwise touch the grid.

### 6.4 The seam legend (NEW, and the SOLE seam representation)

There is no in-grid seam marker of any kind (§6.3) — the legend below the grid is the only
place a seam is ever shown to the player. It is pinned precisely here so it is byte-testable:

- **Placement:** the legend appears below the grid, separated from it by exactly one blank
  line, and **only if** the current region has one or more discovered seams. If it has zero,
  `renderMapGrid` returns the grid text alone — no trailing blank line, no empty legend
  header.
- **Line count:** exactly one line per discovered seam, **no deduplication** — if a room has
  two discovered seams to the same neighboring region via two different exits (`RIVER-1`'s
  `west` and `out`, both to Dam & Reservoir, §5.4), both produce their own line.
- **Exact line format** (a literal template, not direction-coded):

  ```
  → <REGION_DISPLAY_NAMES[seam.toRegion]> (via <fromRoom.label>, <seam.dir>)
  ```

  `→` is a **literal constant prefix character** on every line — there is no dir→glyph table
  anywhere in the legend (or anywhere else in the seam system); the glyph never varies by
  direction, region, or anything else. The region name is always the **destination**
  (`seam.toRegion`), never the source region.
- **Sort order:** by `fromRoom.label` alphabetically, then by `seam.dir` alphabetically —
  fully deterministic, independent of grid position or discovery order (§11 tests this
  directly).
- **No padding or alignment.** Region names are variable width; there is a single space
  between tokens as shown in the template above, nothing more. (The old draft's "padded"
  language is deleted — it had no defined width formula and made the output impossible to
  assert byte-exact.)

**Worked example** (corrected — the draft's version named the wrong region, used a
direction-coded glyph, and violated its own sort order): for a player who has discovered both
of `SLIDE-ROOM`'s seams (`east` → `COLD-PASSAGE`, Coal Mine → Mirror Rooms & Twisty Passages;
`down` → `CELLAR`, Coal Mine → Cellar & Central Passages), viewing the Coal Mine region
produces:

```
→ Cellar & Central Passages (via Slide Room, down)
→ Mirror Rooms & Twisty Passages (via Slide Room, east)
```

Both lines share `fromRoom.label` (`Slide Room`), so the tiebreaker — `seam.dir` alphabetical
— decides the order: `down` sorts before `east`. Note the destination-region rule in action:
the `east` seam lands in Mirror Rooms & Twisty Passages, not Coal Mine (Coal Mine is where the
player already is — it would never appear as a legend line's region name from within its own
region).

### 6.5 Callers (`buildMap`, `buildMapModal`)

Both callers (`shell.ts:561–593`, `:1032–1132`) change `currentLevel` derivation
(`rooms.get(current)?.level`) to `currentRegion` (`rooms.get(current)?.region`), and both
must now branch on whether `currentRegion` is mapped or unmapped **before** calling
`renderMapGrid` — an unmapped `currentRegion` routes to §7's maze-message render instead.
`buildMapModal` additionally threads paging state through this branch (§8.3).

### 6.6 `MapState` reciprocal-source extension (`src/ui/map-state.ts`)

Decision-locked: crossing a *reciprocal* cross-region seam reveals the way-back seam
immediately on arrival, matching how an intra-region reciprocal connection already behaves.
This is the one `map-state.ts` change this spec makes (§2), and it is narrow:

- **Direction-keyed, NOT pair-keyed — this is load-bearing.** The existing `RECIPROCAL_LOOKUP`
  (`map-state.ts:34–38`) is keyed by unordered room *pair* (`` `${a}|${b}` ``) and
  `isReciprocal(prev, next)` (`map-state.ts:40–42`) is direction-blind. Folding reciprocal
  seams into that pair-keyed map is **incorrect**: `SMALL-CAVE`↔`ATLANTIS-ROOM` is the one seam
  pair with *mixed* reciprocity — `SMALL-CAVE down→ATLANTIS-ROOM` is reciprocal, `SMALL-CAVE
  south→ATLANTIS-ROOM` is not (§5.3, §5.4). A pair key set by the `down` seam would poison the
  `south` walk: crossing `south` would credit a phantom `north` backtrack on `ATLANTIS-ROOM`
  (which has no `north` exit), surfacing a nonexistent path in `buildPathsPanel` and hiding the
  real `up` return seam.
- Therefore the seam widening is **directed**: `map-state.ts` gains `import { ROOM_SEAMS } from
  './map-layout.js';` (alongside its `ROOM_CONNECTIONS` import, `map-state.ts:17`) and builds a
  separate `RECIPROCAL_SEAM_DIRS: Set<string>` keyed `` `${seam.from}|${seam.dir}` `` for every
  `ROOM_SEAMS` entry with `reciprocal: true`. Because a room has at most one exit per direction,
  `(from, dir)` uniquely identifies the exit, so this key can never conflate a reciprocal and a
  non-reciprocal edge of the same room pair.
- `MapState.update()`'s backtrack-crediting site (`map-state.ts:94–103`, inside the
  `walkedDir !== null` block) gains exactly one added condition: credit the `backtrack` record
  on the arrival room when `isReciprocal(prev, next)` (unchanged — intra-region
  `ROOM_CONNECTIONS`) **OR** `` RECIPROCAL_SEAM_DIRS.has(`${prev}|${walkedDir}`) `` (new — the
  reciprocal seam the player just walked). The credited direction is `opposite(walkedDir)`,
  exactly as today. `ROOM_CONNECTIONS` pair-keying and `isReciprocal()` are untouched — the seam
  path is a separate, direction-precise check, so no intra-region behavior changes.
- The §2.3 discovery-rule regression guards (walked/backtrack/blocked semantics,
  `exits[].known` never read, `map-state.ts:13`) are unaffected and stay green unmodified —
  this only widens which pairs are *sourced* as reciprocal, not how a reciprocal pair is
  *used*.

**The exact reciprocal-seam set** (re-derived from §5.2 step 4 against the 39 mapped-origin
`ROOM_SEAMS` entries — see §5.3's `Reciprocal` column): **10 pairs, 20 of the 39 seams.**
(The brief's own working estimate was "~6–8 pairs"; the actual re-derived count is 10 — noted
here rather than silently reconciled, since the seam table is the source of truth, not the
estimate.)

| Room A | dir A→B | Room B | dir B→A | Region A ↔ Region B |
|---|---|---|---|---|
| `ARAGAIN-FALLS` | north | `SHORE` | south | Canyon & Falls ↔ River |
| `CHASM-ROOM` | ne | `RESERVOIR-SOUTH` | sw | Cellar & Central Passages ↔ Dam & Reservoir |
| `DAMP-CAVE` | east | `WHITE-CLIFFS-NORTH` | west | Cellar & Central Passages ↔ River |
| `DEEP-CANYON` | nw | `RESERVOIR-SOUTH` | se | Cellar & Central Passages ↔ Dam & Reservoir |
| `ENGRAVINGS-CAVE` | east | `DOME-ROOM` | west | Cellar & Central Passages ↔ Temple & Hades |
| `ROUND-ROOM` | south | `NARROW-PASSAGE` | north | Cellar & Central Passages ↔ Mirror Rooms & Twisty Passages |
| `STRANGE-PASSAGE` | east | `LIVING-ROOM` | west | Cyclops & Treasure ↔ Surface |
| `ATLANTIS-ROOM` | up | `SMALL-CAVE` | down | Dam & Reservoir ↔ Mirror Rooms & Twisty Passages |
| `SLIDE-ROOM` | east | `COLD-PASSAGE` | west | Coal Mine ↔ Mirror Rooms & Twisty Passages |
| `ENTRANCE-TO-HADES` | up | `TINY-CAVE` | down | Temple & Hades ↔ Mirror Rooms & Twisty Passages |

Two of these pairs both touch `RESERVOIR-SOUTH` (one to `CHASM-ROOM`, one to `DEEP-CANYON`) —
that is expected, not a bug: `RESERVOIR-SOUTH` has two distinct reciprocal cross-region
exits, exactly as §5.4 already notes a room can carry more than one seam.

Everything else about §5.3's 39 kept seams behaves correctly under the direction-keyed source:
`RIVER-1`'s two exits to `DAM-BASE` are both non-reciprocal (uniform pair) and reveal
outbound-only. The mixed pair — `SMALL-CAVE`'s `down` (reciprocal) vs `south` (non-reciprocal)
to the same `ATLANTIS-ROOM` — is handled correctly *because* the key is `(from, dir)`, not the
room pair: walking `down` matches `` `SMALL-CAVE|down` `` and credits the real `up` return seam
on `ATLANTIS-ROOM`; walking `south` matches no key, so it credits nothing and no phantom `north`
record is ever created. §11's backtrack test exercises this exact `south` case as a mandatory
negative — a pair-keyed implementation passes the other cases but fails this one.

---

## 7. Maze Handling (unmapped regions)

`thief-maze` and `mine-maze` rooms have a `region` but no `col`/`row` (§3.1) and are never
passed to `renderMapGrid`. When the current room's region is unmapped, both `buildMap` (the
sidebar quick-view) and `buildMapModal` (the `map` command) render this exact string instead
of a grid:

```
You are hopelessly lost in a maze of twisting little passages. No map will help you here.
```

This is the entire in-voice payload — no seam legend, no partial grid, no room label. The
"Paths from Here" sidebar panel (`buildPathsPanel`) is unaffected by this rule: it lists
discovered exits by direction regardless of region, exactly as it does today, so a player
lost in the maze still sees what directions they've tried from their current room — only the
spatial grid is withheld, matching the intent ("no *map* will help," not "no information at
all"). The `map` modal's paging controls (§8) remain enabled while viewing the maze message
**whenever at least two mapped regions have been discovered** (§8.2, §8.3's disable
threshold) — letting the player page away to a discovered mapped region without needing to
physically leave the maze first. If the player has discovered only `surface` so far (e.g.
they went straight from the house into the thief's maze), paging is disabled per §8.3's rule
and there is nothing to page to yet — §7 does not promise paging-away in that case.

---

## 8. View Selection: Auto-Follow + Paging

### 8.1 Auto-follow (generalizes today's implicit behavior)

Both `buildMap` and `buildMapModal` compute `currentRegion = ROOM_BY_ID.get(current)?.region
?? 'surface'` (mirroring today's `?? 'surface'` fallback at `shell.ts:580`/`:1086`) and render
that region — or the maze message (§7) if it's unmapped. This is the direct generalization of
the level-follow logic already present; no new behavior here.

### 8.2 "Discovered" region

A region is **discovered** iff `MapState.visitedRooms()` contains at least one room whose
`region` equals that region key:

```ts
function discoveredMappedRegions(mapState: MapState): MappedRegionKey[] {
  const visited = mapState.visitedRooms();
  const found = new Set<MappedRegionKey>();
  for (const id of visited) {
    const r = ROOM_BY_ID.get(id);
    if (r && MAPPED_REGIONS.includes(r.region as MappedRegionKey)) found.add(r.region as MappedRegionKey);
  }
  // Canonical order, not discovery order — matches MAPPED_REGIONS (§3.1).
  return MAPPED_REGIONS.filter(k => found.has(k));
}
```

Unmapped regions are never in this list, even if visited — there is nothing to page to (§7).
Since the player always starts in `WEST-OF-HOUSE` (`surface`), `surface` is discovered from
the first rendered frame; the empty-list case is unreachable in normal play but the paging
controls (§8.3) degrade safely to disabled/hidden if it ever were empty.

### 8.3 Paging (`map` modal only — NEW capability)

The sidebar quick-view (`buildMap`) has no paging controls — it only ever auto-follows (§1
out-of-scope: no manual toggle existed before, none is added to the always-visible panel).
`buildMapModal` gains prev/next buttons and a region-name label in its header row:

- On `open()`, `pageRegion` (a closure-local variable, reset every time the modal opens — it
  does not persist across opens) is set by one rule, evaluated in order: **(1)**
  `currentRegion` if it is mapped; **(2)** otherwise `lastMappedRegion` (below) if one is
  recorded; **(3)** otherwise `'surface'`. This makes auto-follow the primary view whenever
  the player is standing in a mapped region, and falls back to the most recent mapped region
  they *were* standing in otherwise (e.g. while lost in a maze) rather than jumping straight
  to `'surface'`. Paging is a session-scoped override on top of this — once open, Prev/Next
  moves `pageRegion` away from wherever it was reset to; that override itself resets (goes
  back to auto-follow) the next time the modal opens, per this same rule.
- `lastMappedRegion` is a **separate variable from `pageRegion`**, persisted across modal
  opens and closes (it is not part of the reset-on-open behavior above). It is updated to
  `currentRegion` every time the current room's region is mapped, regardless of whether the
  modal is open — so it always holds the most recent mapped region the player actually stood
  in, ready for rule (2) above.
- **Prev / Next** cycle `pageRegion` through `discoveredMappedRegions()` (§8.2), wrapping at
  both ends. Both buttons are disabled (not hidden — same accessibility posture as the rest of
  the shell's controls) when `discoveredMappedRegions().length <= 1`.
- The header shows `REGION_DISPLAY_NAMES[pageRegion]` and, when there is more than one
  discovered region, a `(N of M discovered)` counter.
- Paging never mutates `MapState` or fog-of-war — it only changes which already-discovered
  region's already-recorded visited/exit data is rendered. A region the player has not
  visited never appears in the cycle, so paging cannot leak information about undiscovered
  territory (the fog-of-war invariant `map-state.ts:13` protects at the exit-record level;
  this is the equivalent invariant one level up, at the region-selection level, and §11 tests
  it explicitly).
- Centering-on-current-room behavior (`shell.ts:1097–1122`, scroll-to-current-room) applies
  only when `pageRegion === currentRegion` (i.e., while genuinely auto-following) — paging to
  a region the player isn't standing in has no "current room" to center on, so the modal
  just shows the region's discovered rooms without a scroll target.

---

## 9. Known Issues Modal Retirement

Remove entirely:

- `buildKnownIssuesDialog` (`shell.ts:601–678`, including its five-item issues array at
  `:646–652`).
- The `openIssues`/`issuesDialog` destructure (`shell.ts:1500`).
- `issuesBtn` — its creation, `data-open-issues` attribute, and text (`shell.ts:1529–1530`)
  and its click handler (`:1531`).
- Its sidebar mount (`shell.ts:1588`).
- The drawer re-wire block that looks up `[data-open-issues]` and re-binds it
  (`shell.ts:1608–1609`).
- Its mount into `app` (`shell.ts:1645`).
- The one test asserting the drawer's Known Issues button exists — the full `it(...)` block,
  `tests/shell/mobile-drawer.test.ts:21–33` (not `:21–28`; the block's closing `});` is at
  line 33, and cutting only through `:28` leaves an orphaned fragment and a syntax error —
  verify against the file before cutting, since line numbers drift).
- Three **dangling comment references** to `buildKnownIssuesDialog` that aren't part of the
  function itself but must be removed or updated so the "no dangling reference" guard (§11)
  doesn't go red: the `// Same div+classList pattern as buildKnownIssuesDialog.` comment
  above `buildCreditsDialog` (`shell.ts:682`), the equivalent comment above
  `buildFeedbackDialog` (`shell.ts:1030`), and the descriptive comment naming Known Issues in
  the mobile-drawer regression header (`tests/shell/mobile-drawer.test.ts:5`). Re-grep to
  confirm exact lines before cutting, same caveat as above.

Keep untouched: `buildCreditsDialog`/`creditsBtn`/`openCredits` (`shell.ts:683–798`,
`:1534–1536`, `:1501`, `:1606–1607`, `:1646`) and `buildFeedbackDialog`/`feedbackBtn`/
`openFeedback` (`:1539–1541`, `:1502–1505`, `:1610–1611`, `:1647`) — this spec does not touch
either.

**Rationale (from the brief, restated for the record):** of the modal's five items
(`shell.ts:646–652`), the map-coverage caveat (`:648`) is this spec's own subject and becomes
false the moment this work ships; the save/restore caveat is already false (Phase 4 shipped
it); the temple/Hades-puzzles-not-fully-wired caveat is already false (content landed); the
partial-350-points caveat is already false (scoring is complete per the port-feature-complete
project memory). A modal that is 100% stale is a liability, not a caveat list — retiring it
rather than editing it in place avoids leaving a half-true list that will drift again.

---

## 10. Implementation Shape

This spec is written to decompose cleanly into a foundation task, nine independent per-region
tasks, and one integration task — stated here for the benefit of whoever plans the build
wave; this section names the shape, it does not sequence or size the work.

**File split (decision-locked — resolves the shared-file/merge-conflict problem):** as
originally written, all nine per-region tasks would edit one shared `ROOM_LAYOUT` array in
`map-layout.ts` — nine parallel tasks racing to append to the same file is a guaranteed
merge-conflict generator, not a parallel-safe decomposition. Instead, layout data splits into
one module per region — `src/ui/map-regions/<region>.ts` (e.g. `dam.ts`, `mine.ts`,
`mirror.ts` — one file per §4 region key), each exporting that region's own rooms (with
`col`/`row`) and its own intra-region `ROOM_CONNECTIONS` entries. `map-layout.ts` becomes a
**barrel**: it imports every `src/ui/map-regions/<region>.ts` module and aggregates their
rooms/connections into the flat `ROOM_LAYOUT`/`ROOM_CONNECTIONS` arrays and the `ROOM_BY_ID`
map that the rest of the code (renderer, `MapState`, tests) already expects — so nothing
downstream of `map-layout.ts` needs to know the data is split across files.
`ROOM_SEAMS`/`REGION_DISPLAY_NAMES`/`MAPPED_REGIONS` stay **foundation-owned, directly in
`map-layout.ts`** — they are cross-region static data, not any one region's to author, and no
per-region task touches them. Under this split, the nine per-region tasks each edit a
*separate* file: parallel-safe, no merge conflicts. (§2 and §3.1's description of
`map-layout.ts` should be read with this file split in mind — `RoomLayout`/`RoomConnection`/
`RoomSeam`/`RegionKey`/`REGION_DISPLAY_NAMES`/`MAPPED_REGIONS` are defined in `map-layout.ts`
as described there; `ROOM_LAYOUT`/`ROOM_CONNECTIONS`'s *contents* are assembled from the nine
region modules rather than hand-typed in one file.)

1. **Foundation** — the `RoomLayout`/`RoomConnection`/`RoomSeam` schema change (§3), the
   `map-layout.ts` barrel + `src/ui/map-regions/` module scaffolding (above), the
   `renderMapGrid` `regionFilter` + legend generalization (§6), the maze in-voice render path
   (§7), auto-follow + paging (§8), and the `MapState` reciprocal-source extension (§6.6).
   Every per-region task depends on this landing first — it defines the types and the render
   contract they author against. **Foundation also authors all 24 unmapped-region
   `ROOM_LAYOUT` entries** (`thief-maze` + `mine-maze` rooms — id/label/region, no `col`/`row`,
   §3.1) — those rooms belong to no per-region task (§4's partition has no owner for them
   otherwise), so foundation must own them or the partition-completeness guard can never reach
   green. Note the completeness guard (§11) still stays **red until all nine per-region tasks
   land** — it asserts all 110 rooms are placed, and the 86 mapped rooms are per-region-owned;
   it is the final G1 gate, not a foundation-green check. Foundation authoring the 24 maze
   entries closes only the maze slice of that guard.
2. **Nine per-region layout-authoring tasks** (one per row of §4's mapped-region table) —
   each authors its own `src/ui/map-regions/<region>.ts` module: assigns `col`/`row` to its
   region's rooms, authors that region's `ROOM_CONNECTIONS` entries (intra-region only,
   §3.2), **and owns the `label` for its own rooms** (existing labels are hand-abbreviated,
   e.g. `"N of House"` — not mechanical from `rooms.json`, so authoring a good label is a
   named deliverable of the task, not an afterthought). These tasks have no dependency on
   each other and can run in parallel once the foundation task lands, since each edits its own
   file; `ROOM_SEAMS` (§5.3) is foundation-owned static data, not per-region — no region task
   needs to touch it.
3. **Integration** — the Known Issues modal retirement (§9) and any region-switcher UI
   polish beyond the minimum prev/next + label described in §8.3. Depends on the foundation
   task (shares `shell.ts`) but not on any individual per-region task completing — it can run
   once the foundation task's paging/auto-follow plumbing exists, using placeholder/partial
   region data if the per-region tasks are still in flight.

---

## 11. Test Guards

Following spec-traceability + prove-red discipline: each guard below names the property, the
file it lives in, and what a red run would mean before the fix lands.

**Test independence note (applies to every example-driven guard below):** the guards that
name specific rooms — `SMALL-CAVE`, `SLIDE-ROOM`, the reciprocal-seam-backtrack test — use
**synthetic, in-test fixtures** (fabricated rooms, connections, seams, and `MapState`
instances built inline in the test file), **not** the live `ROOM_LAYOUT`/`ROOM_CONNECTIONS`/
`ROOM_SEAMS` exports. This keeps the foundation task's own tests self-contained and greenable
before any per-region task lands — if they read the live exports instead, they couldn't go
green until the specific per-region tasks that place `SMALL-CAVE`/`SLIDE-ROOM`/etc. had
landed, which would silently break §10's parallel-independence claim.

- **Partition completeness** (`tests/shell/map-layout.test.ts`, replacing the `:43–45`
  20-room assertion) — every room id in `src/data/rooms.json` has a `RoomLayout` entry, and
  that entry's `region` **equals** the room's assignment in §4's ground-truth table (not just
  "has some region" — a room miscoded into the wrong region must go red, not just a room
  missing coordinates); every mapped-region entry has both `col` and `row` defined; every
  unmapped-region entry has neither. Both this guard and the seam-derivation guard below read
  their region assignment from the **same canonical `roomRegion` map**, built once from §4 and
  checked against the aggregated `ROOM_LAYOUT` (§10's barrel) — no duplicated hardcoded
  region table between the two tests. Red today (mid-build) because only 20 of 110 rooms have
  layout entries at all.
- **No intra-region coordinate collision** (`tests/shell/map-layout.test.ts`, NEW) — for each
  mapped region, no two rooms share a `(col, row)` pair. Scoped per-region, not global (§3.1
  — cross-region coordinate reuse is expected and fine).
- **`ROOM_CONNECTIONS` is intra-region only** (`tests/shell/map-layout.test.ts`, NEW) — every
  entry's `a` and `b` resolve to the same `region`. A cross-region entry here is a
  foundation-task bug (it belongs in `ROOM_SEAMS` instead) — red catches a per-region task
  that accidentally authors a seam as a plain connection.
- **`ROOM_CONNECTIONS` entries correspond to real exits** (`tests/shell/map-layout.test.ts`,
  existing pattern generalized from `:116–125`) — for every connection `{a, b}`, at least one
  of `a→b` or `b→a` exists as a real `exits[].to` edge in `rooms.json`. Catches an authored
  connection that doesn't correspond to an actual room exit.
- **`ROOM_SEAMS` matches the §5.3 derivation exactly, including `reciprocal`** (NEW file,
  `tests/shell/region-seam-derivation.test.ts` — deliberately not named `seam.test.ts`, §2's
  collision note) — re-run the full §5.2 derivation algorithm (all four steps, including the
  reciprocal computation of step 4) against `rooms.json` at test time and assert the result
  set-equals the static `ROOM_SEAMS` export **field-for-field, `reciprocal` included**, reading
  region assignment from the same canonical `roomRegion` map as the partition-completeness
  guard above. This is the strongest guard: it is immune to `rooms.json` drifting out from
  under a hand-maintained seam list or a stale `reciprocal` flag (if a future content change
  adds/removes/moves/redirects an exit, this test goes red instead of the seam list or its
  reciprocal flags silently going stale).
- **Seam legend: exactly one line per discovered seam, byte-exact format** (NEW file, `tests/
  shell/region-seam-legend.test.ts` — synthetic fixtures, see the independence note above) —
  given a fabricated `MapState` with specific discovered exit records, `renderMapGrid`'s
  output legend (§6.4) contains exactly one line per discovered seam, each byte-exact against
  the pinned template (`→ <region> (via <label>, <dir>)`, literal `→`, no padding), in the
  pinned sort order (`fromRoom.label` then `seam.dir`, both alphabetical); an undiscovered
  seam produces no line (fog-of-war gate, §6.3); the `SMALL-CAVE` and `RIVER-1` multi-seam
  cases (§5.4) each produce two legend lines, not one — there is no dedup of any kind; a
  region with zero discovered seams produces no legend block and no trailing blank line.
- **Reciprocal cross-region seam credits a backtrack record on arrival — and the mixed pair is
  handled direction-precisely** (`tests/shell/map-state.test.ts`, NEW test — synthetic
  fixtures) — three cases, all required:
  1. *Reciprocal:* walking `ROUND-ROOM south → NARROW-PASSAGE` (§6.6's table) credits a
     `backtrack` record for `north` on the arrival room, exactly as an intra-region reciprocal
     connection already does.
  2. *Non-reciprocal, uniform pair:* walking `RIVER-1 out → DAM-BASE` credits nothing on
     arrival (outbound-only reveal).
  3. *Mixed pair (the regression guard):* for `SMALL-CAVE`↔`ATLANTIS-ROOM`, walking
     `SMALL-CAVE down → ATLANTIS-ROOM` credits `up` (the real return seam), **and** walking
     `SMALL-CAVE south → ATLANTIS-ROOM` credits **nothing** — assert specifically that no
     `north` record appears on `ATLANTIS-ROOM` (it has no `north` exit; a `north` record would
     be a phantom path rendered by `buildPathsPanel`). **Case 3 is mandatory:** a pair-keyed
     implementation of §6.6 passes cases 1–2 but fails case 3, so omitting it lets the bug ship.
  Red before the `RECIPROCAL_SEAM_DIRS` widening (§6.6) lands; the existing `§2.3` regression
  guards (`tests/shell/map-state.test.ts:198–211`) are untouched and stay green alongside.
- **Maze rooms render the exact in-voice message, no grid** (NEW file, `tests/shell/
  maze-region-message.test.ts`) — a `MapState` current-room in `thief-maze` or `mine-maze`
  renders the §7 string byte-exact via both `buildMap` and `buildMapModal`'s render path, and
  produces no room boxes.
- **Paging only exposes discovered regions, and the reset-on-open rule holds**
  (`tests/shell/map-modal.test.ts`, extended) — a fabricated `MapState` that has visited
  `surface` and `cellar-core` but nothing else yields a 2-entry paging cycle; prev/next never
  lands on `dam`/`mine`/etc.; opening the modal fresh always sets `pageRegion` per §8.3's
  three-way rule (`currentRegion` if mapped, else `lastMappedRegion`, else `'surface'`) rather
  than whatever `pageRegion` the player had paged to before close; a case where the player is
  currently in an unmapped (maze) region exercises the `lastMappedRegion` fallback
  specifically, distinct from the always-reset `pageRegion`.
- **`MapState` EXTEND — §2.3 discovery guards stay green; new reciprocal-seam-backtrack test
  added** (`tests/shell/map-state.test.ts`) — this spec makes one narrow `map-state.ts` change
  (§2, §6.6: add a direction-keyed `RECIPROCAL_SEAM_DIRS` and one `||` in the backtrack-credit
  site; `RECIPROCAL_LOOKUP`/`isReciprocal` untouched), so the existing `§2.3` regression guards
  (`:198–211`, no edits) are a should-stay-green guard, not new tests — a red run there would
  mean the seam widening accidentally touched fog-of-war discovery-rule logic it wasn't supposed
  to. The new three-case reciprocal-seam-backtrack test (above) is the one addition.
- **`buildPathsPanel` type-only change is behavior-preserving**
  (`tests/shell/paths-panel.test.ts`, existing) — should stay green unmodified; it never reads
  `region`/`level`, only `label` (§2).
- **Known Issues retirement leaves no dangling reference**
  (`tests/shell/mobile-drawer.test.ts:21–33` deleted, plus the three dangling comment
  references at `shell.ts:682`, `shell.ts:1030`, `tests/shell/mobile-drawer.test.ts:5`, §9) —
  a grep-based or compile-time check (the TypeScript compiler itself, since
  `buildKnownIssuesDialog` deletion removes the export/usages) confirms no remaining reference
  to `buildKnownIssuesDialog`, `data-open-issues`, or `issuesBtn` anywhere in `src/` or
  `tests/` — comments included, since a dangling comment reference is exactly what a
  grep-based guard would otherwise miss if it only checked compiled code.

---

## 12. Phase Gates

### G1 — Build / Merge
- [ ] `RoomLayout`/`RoomConnection`/`RoomSeam` schema lands; `level` is fully removed (not
      deprecated) from `map-layout.ts` and every reader in `shell.ts`.
- [ ] All 110 rooms have a `region`; all 86 mapped-region rooms have `col`/`row`; all 24
      unmapped-region rooms have neither (§11 completeness guard green).
- [ ] `ROOM_SEAMS` set-equals the §5.2 derivation re-run against the live `rooms.json`,
      `reciprocal` flag included (§11 derivation guard green) — this is the guard against
      silent seam-list or reciprocal-flag drift.
- [ ] `renderMapGrid` takes `regionFilter`; there is no in-grid seam glyph anywhere; the
      legend renders per §6.4 (byte-exact format, sort order, no dedup); maze message renders
      per §7; no intra-region coordinate collisions (§11 guards green).
- [ ] Paging cycles discovered mapped regions only; modal resets `pageRegion` per §8.3's
      three-way rule on open (`currentRegion` → `lastMappedRegion` → `'surface'`) (§11 paging
      guard green).
- [ ] Known Issues modal, button, and wiring — including the three dangling comment
      references (§9, §11) — fully removed; no dangling reference; Credits and Feedback
      buttons unaffected (§11 retirement guard green).
- [ ] `map-state.ts`'s existing §2.3 regression guards pass unmodified, **and** the new
      reciprocal-seam-backtrack test is green: walking a reciprocal cross-region seam
      credits a `backtrack` record on arrival; walking a non-reciprocal one does not (§6.6,
      §11).
- [ ] Full suite green; merged to the working branch (human commit voice; never detach).

### G2 — Deploy + Smoke
- [ ] Deployed build: starting a fresh game and walking into the cellar renders the
      `cellar-core` region grid (not the old single-underground-plane grid); walking into the
      coal mine, dam, river, mirror rooms, temple, canyon, or cyclops region each renders that
      region's own grid; entering the thief's maze or the coal-mine maze shows the exact §7
      message and no grid.
- [ ] The `map` modal's prev/next buttons page through every region visited so far and no
      others; a fresh page load (nothing visited except the start) shows only `surface` as
      pageable.
- [ ] The Known Issues button no longer appears in the sidebar or the mobile drawer; About &
      Credits and Send Feedback still do.

### G3 — Playtest-Ready
- [ ] No open TODOs in the shipped map/region code; the per-region authoring tasks (§10) are
      all landed, not partially stubbed.
