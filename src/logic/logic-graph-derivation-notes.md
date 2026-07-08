# Logic graph derivation notes

Not shipped, not imported by any code. This is the audit trail for why every
rule in `logic-graph.json` says what it says — one entry per location plus
the region-level rules, each citing the ZIL source (or, where the source is
this codebase's own port rather than the original ZIL, the TS file) that the
rule was derived from. Re-derive from `tools/logic/derive-location-pool.ts`
if `src/data/objects.json` / `src/data/rooms.json` change.

## Modeling decisions applied uniformly

- **Light gating.** A room's static lit/dark state is `rooms.json`'s
  `flags` array containing `"On"`. Darkness is enforced by the engine as a
  deterministic hard block on seeing/taking objects — `describeRoomShared`
  (`src/engine/verbs/index.ts:426-429`) returns the pitch-black message and
  skips `describeRoomObjects` entirely when `!lit(room, player, world)`, so
  an unlit dark room's contents are not just risky to interact with, they
  are structurally invisible to the parser. Every location whose room lacks
  `"On"` gets `needs: ["lamp"]` (or, in `GAS-ROOM`'s case, `lamp` doubles as
  the *safe* light source — see below). This is what makes `LAMP`
  `class: "progression"`, matching the design doc's explicit listing of lamp
  as a progression item.
  - **Deliberately NOT modeled:** grue-death risk from lingering in the dark
    while merely *walking through* a dark room toward a lit destination.
    `computeReachable`'s region-level topology is left ungated by light —
    only the specific location's item-pickup is gated. This mirrors the
    project's existing choice not to gate `TROLL-ROOM`'s passage on weapon
    possession (troll combat is winnable unarmed, just riskier) — neither
    mechanic is modeled as a hard block because neither is deterministic.
  - **Alternate light sources not modeled as `any` branches.** `TORCH` and
    `CANDLES` are also `Light`-flagged (`src/data/objects.json`), but both
    are only obtainable *after* already passing through lamp-gated dark
    areas (`TORCH-ROOM` itself needs light to reach; `CANDLES` need a lit
    `MATCH` for the exorcism specifically, not general-purpose carrying).
    `LAMP` is the only viable *first* light source, so every light gate in
    this graph is the single-item `needs: ["lamp"]`, not an `any` of
    alternatives — simpler and avoids overclaiming an independently-usable
    early alternate route that doesn't actually exist.
- **Combat and other RNG-driven mechanics are not modeled as item gates.**
  `TROLL-FLAG` (troll defeated) and `CYCLOPS-FLAG`/`MAGIC-FLAG` (cyclops
  routed) are both achievable through item-free means (troll: any combat
  outcome eventually clears him, `1actions.zil:640-680`; cyclops: the
  `ODYSSEUS`/`ULYSSES` magic word, `gverbs.zil:945-961`, is free and
  strictly better than the water-drinking alternative) — so neither
  contributes a `needs` entry, matching the design doc's own worked example
  for `GATE-FLAG` (achievable for free, omitted).
- **Temporary carry-state constraints are not modeled.** `TIMBER-ROOM` /
  `LOWER-SHAFT`'s `EMPTY-HANDED` exit gate (`rooms.json` TIMBER-ROOM west
  exit) and the inflatable boat's puncture-on-boarding-with-a-sharp-object
  rule (`1actions.zil:2787-2800`) both only constrain what you're *carrying
  at that exact moment* — a player can always set items down first and
  return for them later. Neither restricts which items must ever be
  *owned*, so neither appears as a `needs` entry (consistent with the
  design's "assumed fill" abstraction, which reasons about eventual item
  ownership, not turn-by-turn logistics).

## Region access rules

| Region | Access | Citation |
|---|---|---|
| `surface` | `{}` | Start region. |
| `cellar-core` | `{"region":"surface"}` | `LIVING-ROOM` down → `CELLAR` via the trap door (`rooms.json` LIVING-ROOM `down` exit, `per: TRAP-DOOR-EXIT`). Moving the rug and opening the trap door are free actions (`1actions.zil:504-598` `TRAP-DOOR-FCN`/`TRAP-DOOR-EXIT`) — no item required. |
| `dam` | `{"region":"cellar-core"}` | `DEEP-CANYON` east → `DAM-ROOM` (`rooms.json` DEEP-CANYON `east` exit, no gate). |
| `mine` | `{"region":"mirror"}` | `COLD-PASSAGE` west → `SLIDE-ROOM` (`rooms.json` COLD-PASSAGE `west` exit, no gate; `ROOM_SEAMS` 'SLIDE-ROOM east → COLD-PASSAGE'). |
| `river` | `{"region":"cellar-core"}` | `DAMP-CAVE` east → `WHITE-CLIFFS-NORTH` (`rooms.json` DAMP-CAVE `east` exit, no gate). |
| `mirror` | `{"region":"cellar-core"}` | `ROUND-ROOM` south → `NARROW-PASSAGE` (`rooms.json` ROUND-ROOM `south` exit, no gate). |
| `temple` | `{"any":[{"region":"mirror"},{"all":[{"region":"cellar-core"},{"needs":["rope"]}]}]}` | Two independent routes. (a) `TINY-CAVE` (mirror region) down → `ENTRANCE-TO-HADES` (`rooms.json` TINY-CAVE `down` exit, no gate) — free, but this route is a dead end reaching only `ENTRANCE-TO-HADES`/`LAND-OF-LIVING-DEAD`, not the rest of the temple complex. (b) `ENGRAVINGS-CAVE` (cellar-core) east → `DOME-ROOM` (free) then down → `TORCH-ROOM`, which requires `DOME-FLAG` (`rooms.json` DOME-ROOM `down` exit `ifFlag=DOME-FLAG`) — set only by `TIE ROPE TO RAILING` while in Dome Room (`1actions.zil:3030-3049` `ROPE-FUNCTION`). |
| `canyon` | `{"region":"surface"}` | `CLEARING` east → `CANYON-VIEW` (`rooms.json` CLEARING `east` exit, no gate). |
| `cyclops` | `{"region":"thief-maze"}` | `CYCLOPS-ROOM` reached via `MAZE-15` (`ROOM_SEAMS` 'CYCLOPS-ROOM nw → MAZE-15', traversed in reverse); the only mapped-region entry into Cyclops Room. |
| `thief-maze` | `{"region":"cellar-core"}` | `TROLL-ROOM` west → `MAZE-1`, requires `TROLL-FLAG` (`rooms.json` TROLL-ROOM `west` exit `ifFlag=TROLL-FLAG`) — omitted as a `needs` entry because it's free (see "Combat" above). |
| `mine-maze` | `{"region":"mine","needs":["garlic","lamp"]}` | `GAS-ROOM` east → `MINE-1` (`rooms.json` GAS-ROOM `east` exit, no gate) — but reaching Gas Room requires passing `BAT-ROOM` (needs `garlic`, see JADE below) and Gas Room itself is lethal with an open flame (needs `lamp` specifically, see BRACELET below). |

## Locations

**LAMP** (`LIVING-ROOM`, surface) — `{}`. Design doc worked example, verbatim. `LIVING-ROOM` is `"On"` (`rooms.json`).

**SKULL** (`LAND-OF-LIVING-DEAD`, temple) — `{"region":"temple","needs":["bell","book","candles","match"]}`. `LAND-OF-LIVING-DEAD` is statically `ONBIT` (`zil/1dungeon.zil:2036` `<FLAGS RLANDBIT ONBIT>`) — lit even before the exorcism, so no `lamp` needed. No `rope` needed either: reachable via the free mirror-region route (`TINY-CAVE` down → `ENTRANCE-TO-HADES` → south, gated only by `LLD-FLAG`, `rooms.json` ENTRANCE-TO-HADES south exit), which never touches the roped Dome Room descent. Exorcism mechanic (ring bell → hold lit candles → read book) verified against `tests/actions/cc1-hades-exorcism.test.ts` and `1actions.zil:1058-1150` (`LLD-ROOM`). `match` is a hard prerequisite, not an example-inherited omission: `CANDLES-FCN` (`zil/1actions.zil:2354-2363`) is the only way to light the candles (`BURN CANDLES WITH MATCH`; using `TORCH` on them destroys them instead, `1actions.zil:2372-2378`), and `LLD-ROOM` (`1actions.zil:1058-1150`) extinguishes any candles the player is already holding lit when the bell rings, so the match must be struck again inside the ceremony window. Reclassified `MATCH` from `filler` to `class: "progression"` accordingly.

**TRUNK** (`RESERVOIR`, dam) — `{"needs":["wrench","lamp"],"region":"cellar-core"}`. `RESERVOIR` requires `LOW-TIDE` to enter from either `RESERVOIR-NORTH` or `RESERVOIR-SOUTH` (`rooms.json`, both `ifFlag=LOW-TIDE`) — set by turning the dam bolt with the `wrench` (`1actions.zil:1187-1211` `BOLT-F`, opens `GATES-OPEN`) and waiting for `I-REMPTY` to fire (`1actions.zil:1263-1269`), which requires `GATE-FLAG` already set (free via `PUSH YELLOW-BUTTON` in Maintenance Room, `1actions.zil:1327-1329`). `RESERVOIR` itself is not `"On"`, so `lamp` is needed too, matching every other dark-room location in this graph.

**ADVERTISEMENT** (`WEST-OF-HOUSE`, surface) — `{}`. Start room, no gate.

**BOTTLE, GARLIC, LUNCH, SANDWICH-BAG, WATER** (`KITCHEN`, surface) — `{}`. `KITCHEN` is `"On"`. Entered via `EAST-OF-HOUSE` west, gated on `KITCHEN-WINDOW` (`rooms.json`), set for free by `OPEN WINDOW` — no item.

**KNIFE, ROPE** (`ATTIC`, surface) — `{"needs":["lamp"]}`. `ATTIC` is not `"On"`. Reached via `KITCHEN` up, no gate beyond light.

**CANARY, EGG, NEST** (`UP-A-TREE`, surface) — `{}`. `UP-A-TREE` is `"On"`. Reached via climbing the tree from `PATH`/`FOREST-1`, no gate.

**LEAVES** (`GRATING-CLEARING`, surface) — `{}`. `"On"`.

**SWORD** (`LIVING-ROOM`, surface) — `{}`. `"On"`.

**AXE** (`TROLL-ROOM`, cellar-core) — `{"region":"cellar-core","needs":["lamp"]}`. Not `"On"`. `TROLL-FLAG` (needed to leave east/west) is free — see region table.

**BAR** (`LOUD-ROOM`, cellar-core) — `{"region":"cellar-core","needs":["lamp"]}`. Not `"On"`. `LOUD-FLAG` (needed to take the bar without the room's restricted-input mode) is set for free by typing `ECHO` while trapped in the loud room's special input loop (`1actions.zil:1719-1725`) — no item.

**OWNERS-MANUAL** (`STUDIO`, cellar-core) — `{"region":"cellar-core","needs":["lamp"]}`. Not `"On"`. Reached via `EAST-OF-CHASM` → east → `GALLERY` → north → `STUDIO` (`rooms.json`, no gates).

**PAINTING** (`GALLERY`, cellar-core) — `{"region":"cellar-core"}`. `GALLERY` is `"On"`.

**GUIDE, MATCH** (`DAM-LOBBY`, dam) — `{"region":"dam"}`. `"On"`.

**INFLATABLE-BOAT** (`DAM-BASE`, dam) — `{"region":"dam"}`. `"On"`.

**PUTTY, SCREWDRIVER, TUBE, WRENCH** (`MAINTENANCE-ROOM`, dam) — `{"region":"dam","needs":["lamp"]}`. Not `"On"`. Reached via `DAM-LOBBY` (no gate) — the wrench itself doesn't require the wrench.

**PUMP** (`RESERVOIR-NORTH`, dam), **TRIDENT** (`ATLANTIS-ROOM`, dam) — `{"region":"dam","needs":["lamp"],"any":[{"needs":["wrench"],"region":"cellar-core"},{"region":"mirror"}]}`. Neither room is `"On"`. Two independent routes reach these two rooms (unlike `RESERVOIR` itself, which always needs `LOW-TIDE` regardless of approach — see TRUNK): (a) cross the drained reservoir from `RESERVOIR-SOUTH` (needs `wrench`, same mechanic as TRUNK), or (b) `SMALL-CAVE` (mirror region) down/south → `ATLANTIS-ROOM` → south → `RESERVOIR-NORTH` (`rooms.json`, no gates) — this route reaches `ATLANTIS-ROOM`/`RESERVOIR-NORTH` without crossing the `LOW-TIDE`-gated `RESERVOIR` room at all, so it doesn't need `wrench`.

**BRACELET** (`GAS-ROOM`, mine) — `{"region":"mine","needs":["garlic","lamp"]}`. Not `"On"`. `garlic` for `BAT-ROOM` passage (see JADE). `lamp` specifically (not just any light) because `GAS-ROOM` is lethal to enter with a lit `CANDLES`/`TORCH`/`MATCH` (`1actions.zil:2446-2467` `BOOM-ROOM`) — `LAMP` is the only safe light source.

**JADE** (`BAT-ROOM`, mine) — `{"region":"mine","needs":["garlic","lamp"]}`. Not `"On"`. Entering `BAT-ROOM` without `garlic` present on the player or in the room deterministically triggers `FLY-ME` before the player's next action (`1actions.zil:2469-2486` `BATS-ROOM`/`BAT-D`, checked via `<EQUAL? <LOC ,GARLIC> ,WINNER ,HERE>`) — not probabilistic, a hard block on lingering in the room at all.

**TIMBERS** (`TIMBER-ROOM`, mine) — `{"region":"mine","needs":["garlic","lamp"]}`. Not `"On"` (`Sacred`). Reached via `GAS-ROOM` → `MINE-1..4` (mine-maze) → down → `LADDER-TOP` → down → `LADDER-BOTTOM` → west → `TIMBER-ROOM` (`rooms.json` exits) — same `garlic`+`lamp` chain as Bat Room/Gas Room, plus the mine-maze's own darkness (covered by the same `lamp`).

**BUOY, EMERALD** (`RIVER-4`, river) — `{"region":"river","needs":["inflatable-boat","pump","lamp"]}`. `RIVER-4` is not `"On"`; it is `NonLand` (boat-only). Boat must be inflated with `PUMP` (`1actions.zil:2820-2840` `IBOAT-FUNCTION`, `INFLATE ... WITH PUMP`) and launched from `DAM-BASE` or another launch point (`1actions.zil:2698-2706` `RIVER-LAUNCH` table), then drifts `RIVER-1 → RIVER-2 → RIVER-3 → RIVER-4` (`1actions.zil:2708-2720` `I-RIVER`). `RIVER-4` has no walking-only entrance (`SANDY-BEACH`/`WHITE-CLIFFS-SOUTH` have no exit back into the river channel — `rooms.json`).

**SHOVEL** (`SANDY-BEACH`, river) — `{"region":"river","needs":["lamp"],"any":[{"needs":["inflatable-boat","pump"]},{"needs":["sceptre"]}]}`. Not `"On"`. Two independent routes: (a) boat, disembarking at `SANDY-BEACH` from `RIVER-4` (`rooms.json` RIVER-4 `east` exit); (b) wave `sceptre` at `END-OF-RAINBOW`/`ARAGAIN-FALLS` to solidify the rainbow (`1actions.zil:2592-2619` `SCEPTRE-FUNCTION`, sets `RAINBOW-FLAG`), cross to `ARAGAIN-FALLS` → north → `SHORE` → north → `SANDY-BEACH` (`rooms.json`, all free once `RAINBOW-FLAG` is set) — a walking route that reaches the beach/cave without ever needing the boat.

**SCARAB** (`SANDY-CAVE`, river) — `{"region":"river","needs":["SHOVEL"],"any":[{"needs":["inflatable-boat","pump"]},{"needs":["sceptre"]}]}`. Not `"On"`; same two route options as `SHOVEL` to reach `SANDY-CAVE` (ne of `SANDY-BEACH`, no further gate — `rooms.json`). **Found only via the Step 8 oracle-corpus cross-check** (`tools/oracle/corpus/c-sand.txt`): `SCARAB` starts `Invisible` and is only revealed after digging exactly four times with the `SHOVEL` in Sandy Cave (`1actions.zil:2855-2869` `SAND-FUNCTION`, `BEACH-DIG` counter; a fifth dig collapses the hole and re-hides it). This makes `SHOVEL` a genuine prerequisite for `SCARAB` — reclassified `SHOVEL` from `filler` to `class: "progression"` accordingly (it was not cited in any `needs` before this cross-check caught the gap).

**BELL** (`NORTH-TEMPLE`), **BOOK** (`SOUTH-TEMPLE`/`ALTAR`), **CANDLES** (`SOUTH-TEMPLE`) — `{"region":"temple","needs":["rope"]}`. Both rooms are `"On"`, but unlike `SKULL`/`LAND-OF-LIVING-DEAD` these rooms are only reachable via the roped Dome Room descent (`TORCH-ROOM` → `NORTH-TEMPLE` → `SOUTH-TEMPLE`, `rooms.json`) — the free mirror-region route into `ENTRANCE-TO-HADES` is a dead end that does not connect to this part of the temple complex.

**COFFIN, SCEPTRE** (`EGYPT-ROOM`, temple) — `{"region":"temple","needs":["lamp","rope"]}`. `EGYPT-ROOM` is not `"On"`, additionally needs `lamp`. `SCEPTRE`'s immediate container is `COFFIN` (an openable container, no lock — `src/data/objects.json`, no `Locked`/key requirement).

**TORCH** (`TORCH-ROOM`/`PEDESTAL`, temple) — `{"region":"temple","needs":["lamp","rope"]}`. `TORCH-ROOM` is not `"On"`. No additional gate on taking the torch itself (`1actions.zil:1018-1028` `TORCH-ROOM-FCN`, no special pickup restriction).

**POT-OF-GOLD** (`END-OF-RAINBOW`, canyon) — `{"region":"canyon","needs":["sceptre"]}`. `END-OF-RAINBOW` is `"On"` and reached freely via `CANYON-BOTTOM`, but `POT-OF-GOLD` itself is `Invisible` until `sceptre` is waved there (`1actions.zil:2592-2619` `SCEPTRE-FUNCTION`, `<FCLEAR ,POT-OF-GOLD ,INVISIBLE>`).

**CHALICE** (`TREASURE-ROOM`, cyclops) — `{"region":"cyclops","needs":["lamp"]}`. Not `"On"`. `CYCLOPS-FLAG` (needed for `CYCLOPS-ROOM` up → `TREASURE-ROOM`, `rooms.json`) is free via the `ODYSSEUS`/`ULYSSES` magic word (`gverbs.zil:945-961` `V-ODYSSEUS`, `gsyntax.zil:334-335`) — strictly better than the item-requiring water-drinking alternative (`1actions.zil:1543-1568`), so omitted as a `needs` entry.

**BAG-OF-COINS, BURNED-OUT-LANTERN, KEYS, RUSTY-KNIFE** (`MAZE-5`, thief-maze) — `{"region":"thief-maze","needs":["lamp"]}`. All maze rooms are dark. No item beyond light needed to navigate the (topologically fixed, once known) maze to `MAZE-5`.

**COAL** (`DEAD-END-5`, mine-maze) — `{"region":"mine-maze","needs":["garlic","lamp"]}`. Not `"On"`. Same `garlic`+`lamp` chain as the rest of the mine/mine-maze pocket (region access already requires both; restated here per the same "restate the real dependency at the location level" pattern the plan's TRUNK example uses).

## Item classification

**2026-07-08 repair (Task 1R):** the original derivation used a single
`class: "progression" | "treasure" | "filler"` enum. That enum cannot express
a treasure that also gates access — `SCEPTRE` is cited in `POT-OF-GOLD`'s and
`SCARAB`'s `needs`, so assumed fill must be able to pre-own it, but leaving
it `class: "treasure"` (as the original derivation did, on the theory that
treasure classification "takes priority") made some seeds unsolvable: if
`SCEPTRE` itself gets placed behind the very access it's supposed to grant,
the fill has no way to reach `POT-OF-GOLD`/`SCARAB`. The schema is now two
orthogonal facets — `class: "progression" | "filler"` (fill-eligibility: does
this item gate anything) and `isTreasure: boolean` (goal-set membership,
independent of `class`). Every item cited in any access rule's `needs` MUST
be `class: "progression"`, mechanically enforced by the
logic-graph-validation suite's classification-invariant test — the
`SCEPTRE`-class regression is thereby impossible to reintroduce silently.

- **isTreasure (19, fixed by TVALUE > 0 excluding SWORD, per Task 1.0):** `SKULL, SCEPTRE, CHALICE, TRIDENT, COFFIN, DIAMOND, JADE, BAG-OF-COINS, EMERALD, PAINTING, BAR, POT-OF-GOLD, BRACELET, SCARAB, TORCH, TRUNK, EGG, BAUBLE, CANARY`. All 19 default to `class: "filler"` for fill purposes EXCEPT `SCEPTRE`, which is `class: "progression"` because it's rule-cited (see above) — it is simultaneously `isTreasure: true` and `class: "progression"`.
- **progression (12, items cited in some location's or region's `needs`, mechanically verified against the graph and mechanically enforced by the classification-invariant test):** `BELL, BOOK, CANDLES, GARLIC, INFLATABLE-BOAT, LAMP, MATCH, PUMP, ROPE, SCEPTRE, SHOVEL, WRENCH`. `SCEPTRE` is also `isTreasure: true`; the other 11 are `isTreasure: false`.
- **filler (39, everything else, including the 18 non-gating treasures):** `ADVERTISEMENT, AXE, BAG-OF-COINS, BAR, BAUBLE, BOTTLE, BRACELET, BUOY, BURNED-OUT-LANTERN, CANARY, CHALICE, COAL, COFFIN, DIAMOND, EGG, EMERALD, GUIDE, JADE, KEYS, KNIFE, LEAVES, LUNCH, NEST, OWNERS-MANUAL, PAINTING, POT-OF-GOLD, PUTTY, RUSTY-KNIFE, SANDWICH-BAG, SCARAB, SCREWDRIVER, SKULL, SWORD, TIMBERS, TORCH, TRIDENT, TRUNK, TUBE, WATER`. Of these, `BAG-OF-COINS, BAR, BAUBLE, BRACELET, CANARY, CHALICE, COFFIN, DIAMOND, EGG, EMERALD, JADE, PAINTING, POT-OF-GOLD, SCARAB, SKULL, TORCH, TRIDENT, TRUNK` are `isTreasure: true`; the rest are `isTreasure: false`. `KEYS` is called out as a progression *example* in the design doc's prose, but the design doc itself says that list is illustrative and subject to revision during derivation ("Exact classification is derived during implementation... and verified against walkthrough dependencies"). It doesn't end up cited in any location's `needs` in this graph: `KEYS` unlocks the `GRATE` (`1actions.zil:851-865`), which gates no location in this 49-entry pool. `MATCH` was also called out as an example but, unlike `KEYS`, its citation gap is real — see the `SKULL` entry above; it is `progression` here.
