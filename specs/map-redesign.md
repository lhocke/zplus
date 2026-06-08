# Map Redesign — Directed Discovery Model + Modal

**Status:** APPROVED — pending implementation planning
**Date:** 2026-06-08
**Owner:** Dylan
**Repo:** lhocke/zork-workflow (private)

> Two focused deliverables: a richer fog-of-war discovery model in `MapState`,
> and a `map` command that opens a level-scoped modal. The engine is frozen for
> this change; all work is shell-side (`src/ui/`).

---

## 1. Scope

### What changes

- **`MapState`** (`src/ui/map-state.ts`) — replace undirected visited-room edge
  tracking with per-room directed exit records tagged by discovery kind.
- **Sidebar** — replace the full `renderMapGrid` panel with a "paths from here"
  text list showing only the current room's discovered exits.
- **`map` command** — intercepted by the shell before the engine; opens a
  level-scoped modal rendering the explored portion of the current level,
  centered on the current room.
- **`ROOM_LAYOUT`** (`src/ui/map-layout.ts`) — add a `level` field to
  `RoomLayout` classifying each room as `'surface'` or `'underground'`.

### Engine stays frozen

`src/engine/game.ts` is untouched. `view()` already exposes everything the
snapshot side needs: `view().here` (current room `ObjectId`) and `view().exits`
(array of `{ dir, known: e.to !== undefined, to? }`, used only as the `to`-match
fallback). The walked/blocked **direction** comes from the player's command — the
shell already has the raw input — so no new engine field (e.g. exposing the exit
flavor or the resolved walk direction) is required. No engine change is made.

### Phase-1 map coverage unchanged

The ~20 pre-troll rooms in `ROOM_LAYOUT` are the ceiling; rooms past the troll
wall are not added.

### Explicitly out of scope (YAGNI)

- Minimap or inline map in the status bar
- Pan / zoom in the modal
- Click-to-travel or any room-selection affordance
- In-modal level-switcher tabs (level context changes by moving in-game)
- Expansion past the ~20 pre-troll rooms

---

## 2. Discovery Model (MapState Redesign)

### 2.1 Three exit kinds

Every exit record the shell tracks for a given room carries one of three kinds:

| Kind | Meaning |
|---|---|
| `walked` | Player successfully moved in this direction (direction from input); destination room is known. |
| `backtrack` | On entering a room via a **reciprocal** edge, the compass-opposite return is auto-credited. Non-reciprocal terrain (forest, one-way drops) credits nothing. |
| `blocked` | Player typed a direction that failed; the stub records the direction but no destination. |

Nothing about a room's exits is shown until one of these fires. A room's sidebar
entry is empty on first entry, aside from any auto-credited backtrack.

### 2.2 Data structure

Replace `MapState`'s undirected `_edges: Set<string>` with a per-room map of
directed exit records:

```ts
type ExitKind = 'walked' | 'backtrack' | 'blocked';

interface ExitRecord {
  dir: Dir;           // engine direction token, e.g. 'north', 'up', 'in'
  kind: ExitKind;
  to?: string;        // destination ObjectId (walked / backtrack); absent for blocked
}

// Keyed by room ObjectId → direction → ExitRecord
private readonly _exits = new Map<string, Map<string, ExitRecord>>();
```

`MapState` retains `_visited: Set<string>` (for modal room-set enumeration) and
`_current: string | null`. The `_edges: Set<string>` and `edgeKey()` helper are
removed.

### 2.3 Discovery rules

**Direction is sourced from player input, NOT from the engine exit table.** The
engine has three exit flavors (`src/domain/game-object.ts` `Exit`): static `to`
(UEXIT), flag-gated `to` (CEXIT, `ifFlag`), and function-computed (`per`, FEXIT)
where `to` is **undefined**. `view().exits` only projects `{dir, known, to}` and
does not reveal the flavor. The two inter-level moves are *both* `per` exits with
no `to` (`STUDIO up → UP-CHIMNEY-FUNCTION`, `LIVING-ROOM down → TRAP-DOOR-EXIT`),
so deriving the walked direction by matching `to` to the destination would fail
on exactly the transitions this feature exists to show. Therefore the shell
parses the player's command to a canonical direction token; the engine `to` table
is used only as a *fallback* for non-compass room changes.

A shared helper `parseDirection(input): Dir | null` recognizes the direction
tokens (`n`/`north`, `s`/`south`, `e`/`east`, `w`/`west`, `ne`, `nw`, `se`, `sw`,
`u`/`up`, `d`/`down`, `in`, `out`) and common movement synonyms (`go north`,
etc.); it returns `null` for non-movement / non-compass commands.

**walked** — fires after a `submit()` that changes `view().here`. The direction
is `parseDirection(command)`. If that is `null` (a non-compass transition such as
`enter window` or `climb tree`), fall back to the *prior* room's `view().exits`
entry whose `to` equals the new room id. Record on the prior room as
`{ kind: 'walked', dir, to: newRoom }`.

**backtrack** — reciprocal-gated, fires on entering a room. The forest is
deliberately non-reciprocal (`FOREST-1 —south→ FOREST-3` but the return is
`FOREST-3 —west→ FOREST-1`); auto-crediting a return there would pre-solve the
maze the forest is built to be. So a backtrack is auto-credited **only when the
traversed edge is reciprocal** per `ROOM_CONNECTIONS` (a true compass-opposite,
unconditional return — the house rooms, normal corridors). When reciprocal, record
on the new room `{ kind: 'backtrack', dir: opposite(walkedDir), to: priorRoom }`.

When the edge is **non-reciprocal** — the forest, and the one-way drops (trapdoor
`LIVING-ROOM↔CELLAR`, chimney `KITCHEN↔STUDIO`, both `reciprocal: false`) — **no
backtrack is auto-credited**. The player learns the way out only by actually
walking or trying it. This preserves both forest disorientation and one-way-drop
honesty in a single rule, and it sidesteps the CEXIT problem: gated returns like
`CELLAR up → LIVING-ROOM` (ifFlag `TRAP-DOOR`) are non-reciprocal, so they are
never auto-credited as open even though their `to` is statically present.

Reciprocity and `opposite()` are derived from layout data
(`ROOM_CONNECTIONS.reciprocal`) and the compass-opposite table
(`n/s, e/w, ne/sw, nw/se, u/d, in/out`). An edge absent from `ROOM_CONNECTIONS`
defaults to no auto-backtrack (conservative).

**blocked** — fires when `submit()` returns without a room change and
`parseDirection(command)` is non-null. Record `{ kind: 'blocked', dir }` on the
current room. This is the one case where direction *must* come from input, since
a failed move produces no room-change to infer from (e.g. `WEST-OF-HOUSE east`,
the boarded door — `{dir:'east', elseMessage:"The door is boarded…"}`, no `to`).

If a direction is already recorded as `walked` or `backtrack`, a subsequent block
does not overwrite it.

### 2.4 Public API additions to MapState

```ts
// Existing (retained)
update(snap: RoomSnap, dir?: Dir | null): void   // driven by view() after each turn
visitedRooms(): ReadonlySet<string>
currentRoom(): string | null
reset(): void

// New
recordBlocked(dir: Dir): void                            // failed-move direction
exitsFor(roomId: string): ReadonlyMap<string, ExitRecord>  // dir → record
```

`update()` is extended to implement the walked + backtrack rules. The caller
passes the player's parsed direction (`parseDirection(command)`, possibly `null`)
alongside the new snapshot. `MapState` retains the **prior** snapshot internally
(it already tracks `_current`; it additionally caches the prior snapshot's `exits`
array) so the `to`-match fallback can inspect the prior room's exit table without
the caller re-supplying it. The `RoomSnap` type is extended accordingly:

```ts
export interface RoomSnap {
  here: string;
  exits: ReadonlyArray<{ dir: string; known: boolean; to?: string }>;
}
```

(The `exits?: unknown` guard is removed; the caller always passes the full
`view()` exits array.)

`parseDirection(input): Dir | null` and `opposite(dir): Dir` are free helpers
(exported from a small `directions.ts`, or co-located in `map-state.ts`), shared
by the shell input handler (`map` intercept / blocked detection) and `MapState`.

---

## 3. Sidebar — "Paths from Here"

The sidebar map panel (currently `map.element` appended after `mapLabel` in the
sidebar mount, `shell.ts:913`) is replaced with a directional text list. The full
`buildMap` / `renderMapGrid` path is removed from the sidebar; `renderMapGrid` is
retained for use in the modal (§4).

The panel renders only the exits discovered from the **current room**. It calls
`mapState.exitsFor(mapState.currentRoom())` and lists each record as one line:

```
PATHS FROM HERE
──────────────────
  North  →  Kitchen
  East   →  Behind House
  West   →  ✕ blocked
```

Rendering rules:

- Direction labels are title-cased and left-padded to a fixed width for
  alignment.
- `walked` and `backtrack` records show `→  <destination room name>`. The
  destination is by definition already visited, so its label is always available
  from `ROOM_BY_ID`.
- `blocked` records show `→  ✕ blocked`.
- The list is empty (only the header and rule remain) at a freshly entered room
  before any exits are discovered, except any auto-credited backtrack.
- `refresh()` is called after each `submit()` and after `recordBlocked()`.

The sidebar label changes from `'Map'` to `'Paths from Here'`; the button that
formerly triggered the full map panel is repurposed or removed (the `map` command
opens the modal).

---

## 4. `map` Command — Full Modal

### 4.1 Shell intercept

The input handler in `shell.ts` intercepts `map` (case-insensitive, trimmed)
before passing the command to `session.submit()`. The engine never receives
`map`. This follows the same interception pattern used for the known-issues
dialog and feedback form.

**Design call:** `map` is a pure UI action. It does not call `session.submit()`,
does not increment `view().moves`, and is not emitted as a `TurnEvent` to the
sink. This differs from the engine's `inventory` verb (which does consume a
move); the difference is intentional and explicit.

### 4.2 Modal structure

Opens using the existing Tailwind Plus modal dialog pattern already in use for
the known-issues and feedback dialogs (`buildKnownIssuesDialog` /
`buildFeedbackDialog` in `shell.ts`). Close on Esc or a dismiss button.

Modal content: a `<pre>` or `<code>` block rendered with the same font-mono
class as the main map area, containing the output of a level-filtered, centered
call to `renderMapGrid`.

### 4.3 Level scoping

The modal renders only rooms on the same `level` as the current room. The `level`
field is added to `RoomLayout` in `map-layout.ts`:

```ts
export interface RoomLayout {
  id: string;
  label: string;
  col: number;
  row: number;
  level: 'surface' | 'underground';
}
```

**Level classification (explicit design call):**

| Level | Rooms |
|---|---|
| `surface` | `NORTH-OF-HOUSE`, `WEST-OF-HOUSE`, `EAST-OF-HOUSE`, `SOUTH-OF-HOUSE`, `FOREST-1`, `FOREST-2`, `FOREST-3`, `PATH`, `UP-A-TREE`, `GRATING-CLEARING`, `CLEARING`, `MOUNTAINS`, `KITCHEN`, `ATTIC`, `LIVING-ROOM` |
| `underground` | `CELLAR`, `TROLL-ROOM`, `EAST-OF-CHASM`, `GALLERY`, `STUDIO` |

Attic and Up-a-Tree are `surface` — reached by climbing but they sit on the
surface plane. Studio is `underground` — reached by the chimney descent from
Kitchen, but it belongs to the underground loop.

`renderMapGrid` is extended (or a wrapper is added) to accept a `level` filter:
only rooms whose `level` matches the current room's level are passed as the
`visited` and `rooms` sets. Rooms on the other level are excluded entirely from
the rendered grid; they do not appear even if visited.

### 4.4 Centering

"Centered on the current room" means the rendered character grid is
offset/scrolled so the current room sits in the middle of the visible viewport
in the modal. The grid itself is computed from the bounding box of all
discovered rooms on the current level (the existing `minCol`/`maxCol`/
`minRow`/`maxRow` logic in `renderMapGrid`); centering is achieved by
CSS `overflow: auto` on the modal container with the current room's character
offset used to set `scrollLeft`/`scrollTop` on open.

### 4.5 Inter-level stubs

There are two genuine inter-level edges, and they live on **different planes and
run in different directions** (per `map-layout.ts:84,86`):

- **Living Room ⬇ Cellar** — trapdoor, one-way *down*. Discovered going down from
  Living Room, so the ⬇ stub appears at Living Room on the **surface** plane.
  (Cellar→Living Room up is gated, not a free return.)
- **Studio ⬆ Kitchen** — chimney, one-way *up*. Discovered going up from Studio,
  so the ⬆ stub appears at Studio on the **underground** plane. The reverse
  (Kitchen→Studio down) is blocked, so it never produces an inter-level stub on
  the surface; trying it just yields a `blocked` stub at Kitchen.

Neither can be drawn inline in a level-scoped grid. When the relevant exit is
discovered, a labeled ⬆/⬇ stub is drawn at that room's boundary — in the gap
below (downward link) or above (upward link) the room box — replacing the normal
connection character, rather than drawing a line to the off-plane room.

Following the inter-level exit and typing `map` again re-renders the modal
centered on the new plane.

### 4.6 Edge-kind rendering in the modal

`renderMapGrid` is extended to accept per-connection kind data from
`MapState._exits`, and renders:

- `walked` / `backtrack` (reciprocal confirmed): solid line `───` / `│`
  (existing style).
- Non-reciprocal discovered connection: existing dashed style `╌╌╌` / `╎`.
- `blocked` stub: `✕` character at the relevant wall of the room box.

A connection is drawn in the modal only if the shell has a `walked` or
`backtrack` record for it on at least one endpoint. The old behavior of drawing
a connection whenever both endpoints are in `visited` is replaced.

---

## 5. Out of Scope (YAGNI)

Stated explicitly to bound the implementation:

- **Minimap** — no persistent ambient map widget outside the sidebar paths list.
- **Pan / zoom** — the modal is a static snapshot; no interactive viewport
  controls.
- **Click-to-travel** — rooms in the modal are not interactive.
- **In-modal level-switcher tabs** — level context follows the player's position;
  switching levels requires moving in-game.
- **Expansion past ~20 pre-troll rooms** — `ROOM_LAYOUT` coverage is unchanged.

---

## 6. Testing Plan

### 6.1 MapState unit tests

All tests drive `MapState` in isolation with scripted `RoomSnap` inputs; no DOM,
no engine.

- **walked from input direction** — `update(view('A'), null)` then
  `update(view('B'), 'north')`: `exitsFor('A')` has
  `{ kind: 'walked', dir: 'north', to: 'B' }`. Direction came from the passed
  `dir`, not the exit table.
- **walked fallback (non-compass move)** — move A→B with `dir = null` where A's
  cached `exits` has an entry `{ dir: 'east', to: 'B' }` (e.g. `enter window`):
  `exitsFor('A')` has `{ kind: 'walked', dir: 'east', to: 'B' }` via `to`-match.
- **walked on a function-exit** — move A→B with `dir = 'down'` where A's `exits`
  has **no** entry with `to: 'B'` (the `per` trapdoor): still recorded as
  `{ kind: 'walked', dir: 'down', to: 'B' }` — proves input-sourcing covers the
  `per`/FEXIT case the old `to`-match could not.
- **backtrack on reciprocal edge** — walk a reciprocal pair (e.g.
  `WEST-OF-HOUSE —north→ NORTH-OF-HOUSE`, `reciprocal: true`): `exitsFor` for the
  new room has `{ kind: 'backtrack', dir: 'south', to: 'WEST-OF-HOUSE' }`
  (`opposite('north')`).
- **NO backtrack on non-reciprocal forest edge** — walk `FOREST-1 —south→
  FOREST-3` (`reciprocal: false`): `exitsFor('FOREST-3')` has **no** backtrack
  record (forest disorientation preserved). This is the regression guard for the
  forest bug.
- **NO backtrack on one-way drop** — walk `LIVING-ROOM —down→ CELLAR`
  (`reciprocal: false`): `exitsFor('CELLAR')` has no auto-credited return, even
  though `CELLAR up → LIVING-ROOM` exists in the exit table (it is gated/CEXIT).
- **NO backtrack on unknown edge** — walk a pair absent from `ROOM_CONNECTIONS`:
  no backtrack credited (conservative default).
- **blocked** — `recordBlocked('north')` on current room: `exitsFor(current)` has
  `{ kind: 'blocked', dir: 'north' }`.
- **blocked does not overwrite walked/backtrack** — record `walked` north, then
  `recordBlocked('north')`: the record remains `walked`.
- **regression guard** — `MapState` never reads `exits[].known`; assert no
  reference to `.known` in `map-state.ts`.
- **`parseDirection` / `opposite`** — table-driven: token + synonym coverage for
  `parseDirection` (incl. `null` for `look`, `take lamp`, `enter window`); full
  compass-opposite pairs for `opposite`.

### 6.2 renderMapGrid unit tests

- **Level filtering** — pass a mixed-level visited set; assert only rooms
  matching the target level appear in the output string.
- **Centering** — assert `scrollLeft`/`scrollTop` target values for a known
  current room position in a known grid.
- **Blocked stubs** — pass an exits map with a `blocked` record; assert `✕`
  appears at the correct wall position in the output.
- **Connection visibility** — connections render only when at least one endpoint
  has a `walked` or `backtrack` record in that direction; a room pair that is
  both visited but has no exit records produces no connection line.

### 6.3 Shell integration tests (jsdom)

- **`map` intercept** — submitting `map` (mixed case) does not call
  `session.submit()`; `view().moves` is unchanged before and after; no
  `TurnEvent` is emitted to the sink.
- **Modal open/close** — typing `map` opens the modal element; pressing Esc (or
  clicking dismiss) removes it; `map` while modal is open closes and re-opens
  (idempotent).
- **`map` does not advance game clock** — `session.snapshot().moves` is identical
  before and after a `map` invocation.

### 6.4 Sidebar paths list

- After a `walked` move A→B, the sidebar list for the current room B shows
  the backtrack entry; the prior room A's entry is not shown (current room only).
- A `blocked` direction renders `✕ blocked` in the list.
- An unknown destination id (room not in `ROOM_BY_ID`) does not crash; row
  falls back to the raw id.
