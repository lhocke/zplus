# Phase 3b — Dam / Reservoir & River / Boat Subsystem

**Status:** DRAFT 2026-06-09 for morning sign-off. Implementation-ready, NOT locked.
**Date:** 2026-06-09
**Owner:** Dylan
**Repo:** lhocke/zork-workflow (private)

> Phase 3b builds the Flood Control Dam #3 water-level machine and the Frigid River /
> magic-boat subsystem behind it. The dam controls a reservoir whose water level
> re-describes a half-dozen rooms, gates two N/S crossings, drowns the careless, and
> reveals the trunk of jewels on drain. The boat is a faithful VEHBIT vehicle: inflate
> with the pump, board, launch onto numbered river sections, drift on a per-section
> timer, land at the cliffs or the sandy beach, and pop on contact with anything sharp.
> The Loud Room's ECHO puzzle (platinum bar) lives here because its state machine is
> dam-coupled. **No combat dependency** — this is fully parallel to thief/cyclops work.
> Composes with the Phase-2 clock primitives (`queue` / `killAll`, landing F1 tonight),
> but depends on no combat code.

---

## 1. Goal & Scope

### What Phase 3b proves

The dam and river are the deterministic spine of the underground's southwest quadrant.
Everything downstream of the dam — the boat, the buoy/emerald, the white cliffs, the
sandy-beach scarab, the rainbow and the pot of gold — is gated on the player being able
to drain the reservoir, retrieve the trunk, inflate the boat, and run the river without
drowning. None of it is wired today (every handler in this subsystem is absent from the
registry — §2). Phase 3b delivers the full chain.

Concretely, Phase 3b delivers:

1. **The dam water-level state machine** — `GATE-FLAG` (panel unlocked), `GATES-OPEN`
   (sluice gates), `LOW-TIDE` (reservoir drained) and the `I-RFILL` / `I-REMPTY` 8-tick
   fill/drain timers, driven by `BOLT-F` + the wrench and the four `BUTTON-F` buttons in
   the Maintenance Room. Plus the independent Maintenance-Room leak (`WATER-LEVEL`,
   `I-MAINT-ROOM`, `LEAK-FUNCTION` putty repair).
2. **The dam-coupled room re-descriptions** — `DAM-ROOM-FCN`, `RESERVOIR-FCN` /
   `RESERVOIR-NORTH-FCN` / `RESERVOIR-SOUTH-FCN`, `DEEP-CANYON-F` water-sound coupling,
   and `LOUD-ROOM-FCN` (the ECHO puzzle + the platinum bar's `SACREDBIT`). The trunk of
   jewels reveal/hide on drain/fill.
3. **The river/boat subsystem** — `IBOAT-FUNCTION` (inflate with pump), `RBOAT-FUNCTION`
   (board / launch / land / puncture), the `VEHBIT` / `NONLANDBIT` vehicle interlock in
   `GOTO`, the sharp-object puncture rule, `I-RIVER` per-section drift, the buoy +
   emerald, `WHITE-CLIFFS-FUNCTION`, `SAND-FUNCTION` + shovel dig + scarab,
   `SCEPTRE-FUNCTION` wave + `RAINBOW-FCN` + `RAINBOW-FLAG` + pot of gold, `FALLS-ROOM`,
   `RIVR4-ROOM` buoy hint.
4. **The verbs this subsystem needs** — `inflate`, `deflate`, `board`, `disembark`,
   `launch`, `land`, `dig`, `wave`, and `plug`/`pour`/`oil` where the leak and bolt flows
   reach for them. All currently hit the unknown-verb fallback (§2).

### In scope

- Dam machine: `BOLT-F` + wrench turn, `DAM-ROOM-FCN`, four `BUTTON-F` buttons,
  `LEAK-FUNCTION` + `PUTTY-FCN` / `TUBE-FUNCTION` leak repair, `I-RFILL` / `I-REMPTY`
  fill-drain timers, `I-MAINT-ROOM` leak timer, the three `RESERVOIR-*-FCN` room
  routines, trunk-of-jewels reveal on drain, `DEEP-CANYON` / `LOUD-ROOM` water-state
  coupling, `LOUD-ROOM-FCN` ECHO puzzle + platinum bar.
- River/boat: `IBOAT-FUNCTION`, `RBOAT-FUNCTION`, the `GOTO` `VEHBIT`/`NONLANDBIT`
  interlock, sharp-object puncture (`DBOAT`), `I-RIVER` drift, buoy + emerald,
  `WHITE-CLIFFS-FUNCTION`, `SAND-FUNCTION` + scarab, `SCEPTRE-FUNCTION` + `RAINBOW-FCN`
  + pot of gold, `FALLS-ROOM`, `RIVR4-ROOM`, RIVER4 landing.
- Verbs: `inflate`, `deflate`, `board`, `disembark`/`exit-vehicle`, `launch`, `land`,
  `dig`, `wave`, plus the `plug` / `pour` / `oil` flows these handlers consult.

### Non-goals

- **No combat dependency.** Phase 3b touches no `combat.ts` / `death.ts` / `i-fight.ts`
  code. The several `JIGS-UP` death calls in these handlers route through the existing
  `jigsUp` (Phase-2's `death.ts` lift) exactly as any other deterministic death; this
  spec consumes that surface, it does not modify it.
- No thief/cyclops, no Hades exorcism, no generic verb sweep beyond the eight verbs
  named above, no save/restore.
- No re-description of rooms/objects already hydrated in `rooms.json` / `objects.json`
  (confirmed present — §2). This phase wires the *handlers*, not the data.

---

## 2. Current State Reconciliation

Measured against a pinned checkout on
2026-06-09. Legend: **NEW** = create; **EXTEND** = add to existing; **DONE** = already
built; **DATA** = present in JSON, handler absent.

### Handlers — all NEW

Every routine this spec owns is **absent from the action registry** (verified baseline,
re-confirmed): `BOLT-F`, `DAM-ROOM-FCN`, `DAM-FUNCTION`, `BUTTON-F`, `LEAK-FUNCTION`,
`PUTTY-FCN`, `TUBE-FUNCTION`, `I-RFILL`, `I-REMPTY`, `I-MAINT-ROOM`, `RESERVOIR-FCN`,
`RESERVOIR-NORTH-FCN`, `RESERVOIR-SOUTH-FCN`, `LOUD-ROOM-FCN`, `DEEP-CANYON-F` (water
branch), `IBOAT-FUNCTION`, `RBOAT-FUNCTION`, `DBOAT-FUNCTION`, `RIVER-FUNCTION`,
`I-RIVER`, `WHITE-CLIFFS-FUNCTION`, `SAND-FUNCTION`, `SCEPTRE-FUNCTION`, `RAINBOW-FCN`,
`FALLS-ROOM`, `RIVR4-ROOM`, `TREASURE-INSIDE` (buoy). All new code.

### Timers — never scheduled

`I-RFILL`, `I-REMPTY`, `I-RIVER`, `I-MAINT-ROOM` are never queued. Unlike the Phase-1
lantern/candle timers (queued at GO), **none of these is queued at world init** — each
is enabled on demand by its trigger (BOLT-F, button, launch). Confirmed: GO
(`1dungeon.zil:2637`) queues only `I-FIGHT` / `I-SWORD` / `I-THIEF` / `I-CANDLES` /
`I-LANTERN`. This is the faithful behavior — do NOT pre-queue the Phase-3b timers.

### Rooms & objects — DATA (present)

Rooms (`DAM-ROOM`, `DAM-BASE`, `DAM-LOBBY`, `MAINTENANCE-ROOM`, `RESERVOIR`,
`RESERVOIR-NORTH`, `RESERVOIR-SOUTH`, `DEEP-CANYON`, `LOUD-ROOM`, `RIVER-1..5`,
`WHITE-CLIFFS-NORTH`, `WHITE-CLIFFS-SOUTH`, `SANDY-BEACH`, `SANDY-CAVE`, `SHORE`,
`STREAM-VIEW`, `IN-STREAM`, `ARAGAIN-FALLS`, `END-OF-RAINBOW`, `ON-RAINBOW`,
`CANYON-VIEW`) and objects (boat trio, `BUOY`, `EMERALD`, `SCEPTRE`, `SCARAB`, `SHOVEL`,
`POT-OF-GOLD`, `TRUNK`, `PUMP`, `WRENCH`, `PUTTY`, `TUBE`, `LEAK`, `BAR`, `BOAT-LABEL`,
the four buttons, `BOLT`, `BUBBLE`) are fully hydrated. **Verify at build (CB tasks)**
that the VTYPE/VEHBIT/NONLANDBIT props and the data-driven `ifFlag` exits survived
hydration — the handlers depend on them (D-A below).

### Verbs — DATA absent / EXTEND

`inflate`, `deflate`, `board`, `launch`, `land`, `dig` currently hit the fabricated
unknown-verb fallback (verified baseline). `wave` likewise. `disembark` may or may not
exist as a Phase-1 stub — **verify at build**. EXTEND the verb table with the eight
verbs; most are thin shells that delegate into the object `ACTION` handlers (the ZIL
default verb routines `V-INFLATE` / `V-DEFLATE` / `V-LAUNCH` / `V-DISEMBARK` / `V-DIG`
are mostly fall-through "Come on, now!" / "silly" messages — the real work is in the
object handlers, §5–§6).

### Clock primitives — DEPENDENCY (Phase-2 F1)

`I-RFILL` ↔ `I-REMPTY` and `I-RIVER` both re-arm themselves (`<ENABLE <QUEUE … N>>`) and
park the opposite timer (`<QUEUE … 0>` = tick-0 parked, never fires — clock-main-loop.md
§9/§14.5). This needs the generic `queue(id, period, enabled)` re-arm + tick-0 park and
`disable` — exactly the F1 primitives landing tonight. **No `killAll` use here.** Treat
F1 as available; if F1 has not landed at build start, the foundation task (F0 below)
blocks on it.

### Flags / globals — NEW (game state)

Add to game state, all faithful to the ZIL globals:

| Global | Init | Source | Meaning |
|--------|:----:|--------|---------|
| `GATE-FLAG` | `false` | `1actions.zil:1153` | control panel unlocked (yellow button) |
| `GATES-OPEN` | `false` | `1actions.zil:1154` | sluice gates open |
| `LOW-TIDE` | `false` | `1dungeon.zil:1230` | reservoir drained |
| `LOUD-FLAG` | `false` | `1actions.zil:1658` | ECHO solved (room quiet) |
| `RAINBOW-FLAG` | `false` | `1dungeon.zil:1232` | rainbow solid/walkable |
| `DEFLATE` | `false` | `1dungeon.zil:1226` | boat-may-be-deflated gate (set by white-cliffs M-END) |
| `BUOY-FLAG` | `true` | `1actions.zil:2842` | buoy hint not yet given |
| `WATER-LEVEL` | `0` (FIX) | `1actions.zil:1295` | Maintenance-Room leak depth (0–14) |
| `BEACH-DIG` | `-1` (FIX) | `1actions.zil:2851` | sandy-beach dig counter |

Several of these are read by the data-driven `ifFlag` exits already in `rooms.json`
(`LOW-TIDE` gates the reservoir N/S crossings — verified at `rooms.json:1424,1502`;
`RAINBOW-FLAG` gates the `ARAGAIN-FALLS`↔`END-OF-RAINBOW` walk). **Verify (D-A)** these
exits read the flag store under the same keys this spec writes.

---

## 3. The Dam Water-Level State Machine

The dam is a three-flag machine. The flags are independent booleans, but only certain
combinations are reachable, and each combination re-describes a fixed set of rooms.

### 3.1 The three flags and the reachable states

- **`GATE-FLAG`** — the control panel is unlocked. Set/cleared **only** by the yellow /
  brown buttons in the Maintenance Room (`BUTTON-F`, `1actions.zil:1327–1330`). The bolt
  (`BOLT-F`) refuses to turn unless `GATE-FLAG` is true.
- **`GATES-OPEN`** — the sluice gates are open (water flows downstream). Toggled by
  turning the bolt with the wrench (`BOLT-F`, `1actions.zil:1187–1217`).
- **`LOW-TIDE`** — the reservoir has finished draining. Set/cleared by the timers, NOT
  by the bolt: `I-REMPTY` sets it true (`:1269`), `I-RFILL` sets it false (`:1233`).

The transition is therefore **two-phase**: the bolt flips `GATES-OPEN` *immediately* and
schedules a timer; the timer flips `LOW-TIDE` 8 ticks later. Between bolt-turn and timer
fire the rooms describe an *in-progress* state ("dropping rapidly" / "rising quickly").

| State | GATE-FLAG | GATES-OPEN | LOW-TIDE | Reservoir crossable? | Trunk visible? |
|-------|:---------:|:----------:|:--------:|:--------------------:|:--------------:|
| S0 sealed (initial) | F | F | F | no (deep lake) | no |
| S1 panel unlocked | T | F | F | no | no |
| S2 draining | T | T | F | not yet | no |
| **S3 drained** | T | T | **T** | **yes** | **yes** |
| S4 refilling | T | F | T | still crossable, rising | yes→no on fire |
| S3'/cycle | T/F | F | F | no (back to S0-ish) | no |

The canonical solve path is S0 → (yellow button) S1 → (turn bolt) S2 → (8 ticks) S3,
drained, trunk revealed, reservoir crossable N↔S and boatable. Closing the gates again
runs S3 → S4 → S0-ish via `I-RFILL`.

### 3.2 BOLT-F — the gate toggle (`1actions.zil:1187–1217`)

`TURN BOLT WITH WRENCH`:

```
on TURN:
  if PRSI != WRENCH:  "The bolt won't turn using the <prsi>."; return handled
  if !gateFlag:       "The bolt won't turn with your best effort."; return handled
  clear RESERVOIR-SOUTH.TOUCHBIT                    // force re-describe
  if gatesOpen:                                     // closing
     gatesOpen = false; clear LOUD-ROOM.TOUCHBIT
     "The sluice gates close and water starts to collect behind the dam."
     queue(I-RFILL, 8, enabled=true); queue(I-REMPTY, 0, enabled=false)   // park empty
  else:                                             // opening
     gatesOpen = true
     "The sluice gates open and water pours through the dam."
     queue(I-REMPTY, 8, enabled=true); queue(I-RFILL, 0, enabled=false)   // park fill
  return handled
on TAKE:  "It is an integral part of the control panel."   // INTEGRAL-PART
on OIL:   "Hmm. It appears the tube contained glue, not oil..."
```

`<QUEUE I-x 0>` is the **park** idiom: tick 0 + enabled is *skipped, never fired*
(clock-main-loop.md §14.5). Faithful form is `queue(id, 0, enabled=false)` — set tick 0
and disable so the opposite timer can never fire mid-cycle. NM-A: do NOT leave the parked
timer enabled (a tick-0 enabled slot is benign in ZIL but the port's `queue` must match
the "won't fire" semantics; pin tick-0-never-fires in a test).

### 3.3 BUTTON-F — the four Maintenance-Room buttons (`1actions.zil:1298–1330`)

`PUSH <colour> BUTTON`:

| Button | Effect |
|--------|--------|
| **Blue** | If `WATER-LEVEL == 0`: clear `LEAK.INVISIBLE`, "a leak has occurred…", `WATER-LEVEL = 1`, `queue(I-MAINT-ROOM, -1, enabled=true)` (every-turn demon). Else: "The blue button appears to be jammed." |
| **Red** | Toggle `MAINTENANCE-ROOM.ONBIT` (lights). "The lights within the room shut off./come on." |
| **Brown** | clear `DAM-ROOM.TOUCHBIT`; `GATE-FLAG = false`; "Click." |
| **Yellow** | clear `DAM-ROOM.TOUCHBIT`; `GATE-FLAG = true`; "Click." |
| (READ any) | "They're greek to you." |

The brown/yellow buttons are the panel lock; the blue button is the leak trap (an
independent sub-puzzle, §3.6). Note the bug-faithful detail: the blue button leak is
**irreversible by button** — only putty repair (`FIX-MAINT-LEAK`) stops it.

### 3.4 I-RFILL / I-REMPTY — the 8-tick fill/drain timers

Both fire **once**, 8 ticks after being queued (tick count exact: `8`, from
`1actions.zil:1197,1204`). They are not self-re-arming; the single fire flips `LOW-TIDE`
and re-describes. Each also re-describes the room the player is *currently in* and can
kill.

**I-RFILL (`1actions.zil:1226–1259`)** — reservoir fills:

```
FSET RESERVOIR NONLANDBIT; FCLEAR RESERVOIR RLANDBIT      // becomes water again
clear DEEP-CANYON.TOUCHBIT; clear LOUD-ROOM.TOUCHBIT       // force re-describe
if TRUNK in RESERVOIR: FSET TRUNK INVISIBLE                // hide the jewels
lowTide = false
switch HERE:
  RESERVOIR:
     if winner in a VEHBIT vehicle: "The boat lifts gently out of the mud…"
     else: JIGS-UP("You are lifted up by the rising river!…tumble over the dam…")
  DEEP-CANYON: "A sound, like that of flowing water, starts to come from below."
  LOUD-ROOM:   "an alarmingly loud roaring sound fills the room…"; GOTO pickOne(LOUD-RUNS)
  RESERVOIR-NORTH | RESERVOIR-SOUTH: "the water level has risen…impossible to cross."
return true
```

**I-REMPTY (`1actions.zil:1263–1282`)** — reservoir drains:

```
FSET RESERVOIR RLANDBIT; FCLEAR RESERVOIR NONLANDBIT       // becomes mud (landable)
clear DEEP-CANYON.TOUCHBIT; clear LOUD-ROOM.TOUCHBIT
FCLEAR TRUNK INVISIBLE                                     // reveal the trunk of jewels
lowTide = true
switch HERE:
  RESERVOIR (and winner in VEHBIT): "the boat can no longer stay afloat. It sinks into the mud."
  DEEP-CANYON: "The roar of rushing water is quieter now."
  RESERVOIR-NORTH | RESERVOIR-SOUTH: "you could easily cross over to the other side."
return true
```

`LOUD-RUNS = [DAMP-CAVE, ROUND-ROOM, DEEP-CANYON]` (`1actions.zil:1261`), picked
randomly by `pickOne` — this is the one RNG draw in the dam subsystem (the loud-room
panic scramble). Path-B note: not oracle-matched; test the *destination set*, not the
exact room.

**NM-L — I-RFILL mutation ordering under death-abort semantics.** The `I-RFILL` timer
body performs `FSET RESERVOIR NONLANDBIT`, `FCLEAR RESERVOIR RLANDBIT`, clears
TOUCHBIT(s), and flips `lowTide = false` **before** the `HERE` switch that may call
`JIGS-UP` (the drowning death). In the port, `jigsUp` propagates via Phase-2's
`death.ts` extension (M-FATAL, phase-2 spec §12) — if the death path can unwind or
skip earlier mutations (e.g. via an exception or early-return that bypasses the flag
writes), the reservoir state will be left partially updated. **The trunk re-hide
(`FSET TRUNK INVISIBLE`) and `lowTide = false` flip must NOT be rolled back if
`jigsUp` is called later in the same timer body.** Implement the flag mutations as
unconditional writes that complete before the `switch HERE` / `jigsUp` call, and add
a test (NM-L): after a drowning death triggered by `I-RFILL`, assert `LOW-TIDE === false`
and `RESERVOIR` has `NONLANDBIT` set — the flags must stick despite the death.

### 3.5 The trunk-of-jewels reveal (D4 / §3.4)

`TRUNK` (treasure, `1dungeon.zil:1048`) sits in `RESERVOIR` with `INVISIBLE` set. The
drain (`I-REMPTY`) clears `INVISIBLE` → the trunk becomes describable/takable. A refill
(`I-RFILL`) re-sets `INVISIBLE` **only if the trunk is still in RESERVOIR** (the player
may have already taken it — the `<AND <IN? TRUNK RESERVOIR> …>` guard, `:1231`). NM-B:
the re-hide must be conditional on location; do not blanket-hide a trunk the player is
carrying.

### 3.6 The Maintenance-Room leak (`I-MAINT-ROOM`, `LEAK-FUNCTION`)

Independent of the reservoir; a self-contained drowning trap behind the blue button.

**I-MAINT-ROOM (`1actions.zil:1343–1360`)** — every-turn demon (tick -1), enabled by the
blue button:

```
hereFlag = (HERE == MAINTENANCE-ROOM)
if hereFlag: "The water level here is now <DROWNINGS[WATER-LEVEL / 2]>"
WATER-LEVEL += 1
if WATER-LEVEL >= 14:
   MUNG-ROOM(MAINTENANCE-ROOM, "The room is full of water and cannot be entered.")
   queue(I-MAINT-ROOM, 0, enabled=false)               // stop the timer
   if hereFlag: JIGS-UP("I'm afraid you have done drowned yourself.")
elif winner in INFLATED-BOAT and HERE in {MAINTENANCE-ROOM, DAM-ROOM, DAM-LOBBY}:
   JIGS-UP("The rising water carries the boat over the dam…over the falls. Tsk, tsk.")
return true
```

`DROWNINGS` is a 9-string table (`1actions.zil:1284–1293`), indexed `WATER-LEVEL / 2`
(integer). `WATER-LEVEL` runs 1→14 (14 turns to drown). NM-C: index is half the level
(two ticks per message); pin the index arithmetic.

**LEAK-FUNCTION (`1actions.zil:1362–1370`) + FIX-MAINT-LEAK (`:1372`)** — putty repair:

```
LEAK-FUNCTION (only when WATER-LEVEL > 0):
   if (PUT/PUT-ON PUTTY) or (PLUG with PRSI==PUTTY): FIX-MAINT-LEAK
   elif PLUG with other PRSI: "With a <prsi>?"            // WITH-TELL
FIX-MAINT-LEAK:
   WATER-LEVEL = -1; queue(I-MAINT-ROOM, 0, enabled=false)
   "By some miracle of Zorkian technology, you have managed to stop the leak in the dam."
```

`PUTTY-FCN` (`:1379`) and `TUBE-FUNCTION` (`:1386`) are the putty/tube object handlers —
putty rejects use as lubricant, the tube yields putty on `SQUEEZE` when open. The
`WATER-LEVEL = -1` sentinel after repair means a future blue-button push (`0?
WATER-LEVEL` is false) reports "jammed" — faithful one-shot. `DAM-FUNCTION` (`:1400`)
catches `OPEN`/`CLOSE`/`PLUG` on the dam itself with the joke fall-throughs.

### 3.7 Dam-coupled room re-descriptions

Each reservoir-adjacent room's `M-LOOK` reads the flag triple and prints one of four
descriptions. **EXTEND** the room-description path to dispatch these handlers; the text
is transcribed verbatim from ZIL (CB task; these are long literal strings).

| Room | Routine | Branches |
|------|---------|----------|
| DAM-ROOM | `DAM-ROOM-FCN` (`:1156`) | 4 water-level descriptions; control-panel text; bubble "glowing serenely" iff `GATE-FLAG` |
| RESERVOIR-SOUTH | `RESERVOIR-SOUTH-FCN` (`:1415`) | 4 (low+open / open / low / sealed); fixed exit text |
| RESERVOIR | `RESERVOIR-FCN` (`:1444`) | M-END peril warning (sealed+lowTide+on-foot); M-LOOK mud-vs-lake |
| RESERVOIR-NORTH | `RESERVOIR-NORTH-FCN` (`:1464`) | 4 descriptions; slimy-stairway exit text |
| DEEP-CANYON | `DEEP-CANYON-F` (`:1730`) | base text + water-roar suffix keyed on (GATES-OPEN, LOW-TIDE) |

`RESERVOIR-FCN`'s **M-END** branch (`:1445`) is a per-turn peril nag: if the player is on
foot in the (drained, gates-sealed, refilling-soon) reservoir, warn them the water is
rising — this is the "get out before I-RFILL fires and drowns you" tell. It fires every
turn the condition holds, not once.

### 3.8 LOUD-ROOM — the ECHO puzzle + platinum bar (`LOUD-ROOM-FCN`, `:1660`)

The Loud Room is dam-coupled: it is *quiet* when `LOUD-FLAG` is set OR when
`(!GATES-OPEN AND LOW-TIDE)`; otherwise it is deafeningly loud (the rushing-water roar).
The platinum bar (`BAR`, `1dungeon.zil:725`) carries `SACREDBIT` — it cannot be taken
while the room is loud (the thief-protection bit doubles as the puzzle lock here).

```
M-LOOK:  base description + (" eerie in its quietness." if quiet else " deafeningly loud…")
M-END (only when loud, i.e. GATES-OPEN && !LOW-TIDE):
   "It is unbearably loud here…you scramble out of the room."; GOTO pickOne(LOUD-RUNS); return false
M-ENTER:
   if quiet OR (gatesOpen && !lowTide quiet-variant): normal (RFALSE)
   else (loud): V-FIRST-LOOK, drop P-CONT with "lost in the noise",
                then a CAPTIVE READ LOOP: only GO W/E/U, SAVE, RESTORE, QUIT, ECHO obey;
                anything else → V-ECHO. Saying ECHO sets LOUD-FLAG, clears BAR.SACREDBIT,
                "The acoustics of the room change subtly.", breaks the loop.
```

**The captive-input loop is the faithfulness risk in this room (NM-D).** When the room
is loud and the player enters, ZIL takes over input: it `READ`s repeatedly and only
honors a tiny verb whitelist (the three exits, the meta-verbs, and `ECHO`); every other
word routes to `V-ECHO` ("echo… echo…"). Saying **ECHO** is the solve: it sets
`LOUD-FLAG`, clears the platinum bar's `SACREDBIT`, and the room goes permanently quiet.

> **PORT decision (OQ-1):** the ZIL captive `READ` loop is a synchronous inner
> read-eval loop inside `M-ENTER`. The web shell is turn-based / async — it cannot block
> on a nested synchronous read. The faithful behavior must be re-expressed as a
> **loud-room input mode**: while `HERE == LOUD-ROOM && loud`, the turn handler routes
> every command through the whitelist gate (exits/meta/ECHO obey; all else → V-ECHO and
> consume the turn) until ECHO is said or the player leaves. Recommend a small
> `loudRoomMode` predicate in `turn()` (mirrors the `dead`-ghost dispatch branch the
> Phase-2 spec ratified for DEAD-FUNCTION — same architectural seam). **Sign-off needed:
> confirm this mode-flag re-expression vs. a literal nested loop.**

---

## 4. The Boat as a Vehicle — VEHBIT / NONLANDBIT Interlock

The magic boat is the only player vehicle in Zork I. Its movement faithfulness lives in
`GOTO` (`gverbs.zil:2045–2092`), not in the boat handler — the handler does board /
launch / puncture; `GOTO` enforces *where a vehicle may go*.

### 4.1 The boat objects and their flags (`1dungeon.zil:595–723`)

| Object | Where | Flags | Notes |
|--------|-------|-------|-------|
| `INFLATABLE-BOAT` | DAM-BASE | TAKEBIT BURNBIT | "pile of plastic"; `IBOAT-FUNCTION` |
| `INFLATED-BOAT` | (nowhere; spawned) | TAKEBIT BURNBIT **VEHBIT** OPENBIT SEARCHBIT | CAPACITY 100, SIZE 20, **VTYPE NONLANDBIT**; `RBOAT-FUNCTION` |
| `PUNCTURED-BOAT` | (nowhere; spawned) | TAKEBIT BURNBIT | "punctured boat"; `DBOAT-FUNCTION` |

The three are a state triad: inflate swaps plastic→inflated, puncture swaps
inflated→punctured, putty-repair swaps punctured→inflatable. Only ONE is in the world at
a time. `VTYPE NONLANDBIT` is the load-bearing prop: it means the inflated boat may only
enter rooms flagged `NONLANDBIT` (water) — and, by the `GOTO` rules below, may *land* on
`RLANDBIT` rooms.

### 4.2 GOTO vehicle rules (`gverbs.zil:2050–2066`) — exact

```
WLOC = LOC(winner); AV = WLOC.VEHBIT ? WLOC.VTYPE : false      // AV = vehicle's allowed type
LB  = RM.RLANDBIT                                              // destination is land
reject (NO-GO-TELL) if:
  (1) !LB && !AV                  // on foot, destination not land  -> can't walk into water
  (2) !LB && !RM.(AV)             // in vehicle, destination lacks the vehicle's VTYPE bit
  (3) HERE.RLANDBIT && LB && AV && AV!=RLANDBIT && !RM.(AV)
                                  // in a water-vehicle on land, target is land but not the right water -> blocked
else move; if (LB && !HERE.RLANDBIT && !DEAD && WLOC.VEHBIT):
              "The <vehicle> comes to a rest on the shore."   // auto-landing message
```

In plain terms for the magic boat (`VTYPE = NONLANDBIT`): the boat may move **only into
`NONLANDBIT` rooms** (the river sections, the reservoir-as-lake, the stream) and may
**land on `RLANDBIT` rooms** (the shores, beaches), printing the rest-on-shore message.
On foot, the player cannot walk into a `NONLANDBIT` room at all (rule 1). NM-E: the three
rejection clauses must all be ported; dropping clause (3) silently lets a beached boat
walk onto the wrong land type.

### 4.3 Board / launch / land / disembark verbs

These delegate to `RBOAT-FUNCTION` (the boat's M-BEG/verb handler) and the generic verb
routines:

- **`board`** → `RBOAT-FUNCTION` M-BEG `BOARD` branch (§6.2): the puncture check (sharp
  object → pop) then normal boarding.
- **`launch`** → `RBOAT-FUNCTION` M-BEG `LAUNCH` branch (§6.2): `GO-NEXT` into the river
  via `RIVER-LAUNCH`, arm `I-RIVER`.
- **`disembark`/`exit-vehicle`** → `V-DISEMBARK` (`gverbs.zil:418–432`): if on land,
  "You are on your own feet again."; if over water, "getting out here would be fatal."
  (`RFATAL`).
- **`land`** → the boat lands by `GOTO` into an `RLANDBIT` room (the WALK branch of
  `RBOAT-FUNCTION` permits `P?LAND`/E/W; the rest-on-shore message comes from GOTO).
- **`inflate`/`deflate`** → `IBOAT-FUNCTION` / `RBOAT-FUNCTION` DEFLATE branch (§6.1).

`V-DIG` (`gverbs.zil:405–416`) and `V-DEFLATE` (`:402`) are mostly fall-through; the real
behavior is the object handlers. The verbs exist so the parser routes to them.

---

## 5–6. River / Boat Mechanics

### 5.1 IBOAT-FUNCTION — inflate (`1actions.zil:2820–2840`)

```
on INFLATE/FILL:
  if INFLATABLE-BOAT not in HERE: "The boat must be on the ground to be inflated."
  elif PRSI == PUMP:
     "The boat inflates and appears seaworthy."
     if !BOAT-LABEL.TOUCHBIT: "A tan label is lying inside the boat."
     DEFLATE = false
     removeCarefully(INFLATABLE-BOAT); move INFLATED-BOAT -> HERE; THIS-IS-IT INFLATED-BOAT
  elif PRSI == LUNGS:  "You don't have enough lung power to inflate it."
  else:                "With a <prsi>? Surely you jest!"
```

`BREATHE` (`:2817`) maps `inflate X with lungs`. NM-F: only the **pump** inflates; the
lungs branch is a distinct message, not a fall-through.

### 6.1 DEFLATE branch + DBOAT-FUNCTION (`RBOAT-FUNCTION` `:2803`, `DBOAT-FUNCTION` `:2652`)

```
RBOAT-FUNCTION DEFLATE:
  if LOC(winner) == INFLATED-BOAT: "You can't deflate the boat while you're in it."
  elif INFLATED-BOAT not in HERE:  "The boat must be on the ground to be deflated."
  else: "The boat deflates."; DEFLATE = true;
        removeCarefully(INFLATED-BOAT); move INFLATABLE-BOAT -> HERE; THIS-IS-IT INFLATABLE-BOAT
```

`DBOAT-FUNCTION` (the punctured boat) accepts putty repair (`FIX-BOAT` → swap back to
inflatable) and rejects re-inflation ("Some moron punctured it.").
`WHITE-CLIFFS-FUNCTION` (`:2585`) M-END sets `DEFLATE` true/false based on whether the
boat is carried — this is the gate that stops you deflating mid-cliffs.

### 6.2 RBOAT-FUNCTION — board / launch / puncture (`1actions.zil:2722–2815`)

`RBOAT-FUNCTION` is dispatched with an optional `RARG` (room message phase) and also as
the boat's verb handler. Phases:

- **M-ENTER / M-END / M-LOOK** → no-op (`<>`).
- **M-BEG** (verb pre-action while the boat is the actor's location):
  - **WALK**: allow `P?LAND`/E/W (RFALSE → normal move); allow N/S in `RESERVOIR`; allow
    S in `IN-STREAM`; else "Read the label for the boat's instructions." (block).
  - **LAUNCH** (`:2738`): if already on river/reservoir/stream → "you are on the …, or
    have you forgotten?"; else `GO-NEXT(RIVER-LAUNCH)` — if it returns 1 (moved),
    `queue(I-RIVER, RIVER-SPEEDS[HERE], enabled=true)`; if not 2, "You can't launch it
    here."
  - **puncture-on-drop/put/attack** (`:2756`): if a `WEAPONBIT` object is dropped/put in
    the boat, or boat attacked with a weapon → the boat deflates fatally: swap to
    PUNCTURED-BOAT, `ROB` the boat's contents to HERE, eject winner to HERE, "didn't
    agree with the boat…", and if `HERE.NONLANDBIT` → `JIGS-UP` (drown in reservoir/stream
    or over-the-falls on river).
  - **LAUNCH while not in boat** (`:2785`): "You're not in the boat!"
- **BOARD** (`:2787`): **the sharp-object puncture interlock** — if any of `SCEPTRE`,
  `KNIFE`, `SWORD`, `RUSTY-KNIFE`, `AXE`, `STILETTO` is in winner's inventory →
  "Something sharp seems to have slipped and punctured the boat…", swap to
  PUNCTURED-BOAT, `THIS-IS-IT`. (The boarding itself otherwise succeeds via the engine's
  vehicle-enter path.)
- **INFLATE/FILL** (`:2801`): "Inflating it further would probably burst it."
- **DEFLATE** (`:2803`): see §6.1.

**The sharp-object puncture rule (NM-G) is the single most error-prone interlock in this
spec.** The check is by **explicit object identity** — the six named sharp objects — NOT
by `WEAPONBIT` (contrast the drop/put puncture at `:2756`, which *is* `WEAPONBIT`-based).
The sceptre is sharp (it has `WEAPONBIT` *and* is in the named set), the knife set is
sharp; a non-weapon sharp object is not in scope. Port both checks distinctly: BOARD =
named-identity set; DROP/PUT/ATTACK = `WEAPONBIT`.

### 6.3 I-RIVER — the per-section drift timer (`1actions.zil:2708–2720`)

The boat drifts downstream automatically. `I-RIVER` is armed on launch and re-arms each
section with that section's speed.

```
I-RIVER:
  if HERE not in {RIVER-1..5}:  disable(I-RIVER); return      // left the river
  RM = RIVER-NEXT[HERE]
  if RM exists:
     "The flow of the river carries you downstream."
     GOTO RM
     queue(I-RIVER, RIVER-SPEEDS[HERE], enabled=true)         // re-arm at NEW here's speed
  else:                                                       // past RIVER-5 -> the falls
     JIGS-UP("…the magic boat doesn't provide protection from the rocks…at the bottom of waterfalls.")
```

**RIVER-SPEEDS (`1actions.zil:2692`):** `RIVER-1:4, RIVER-2:4, RIVER-3:3, RIVER-4:2,
RIVER-5:1` — exact tick counts. The river accelerates downstream (4→1 ticks between
auto-moves). **RIVER-NEXT (`:2695`):** `RIVER-1→2→3→4→5`. **RIVER-LAUNCH (`:2698`):** the
launch map (DAM-BASE→RIVER-1, WHITE-CLIFFS-NORTH→RIVER-3, WHITE-CLIFFS-SOUTH→RIVER-4,
SHORE→RIVER-5, SANDY-BEACH→RIVER-4, RESERVOIR-SOUTH/NORTH→RESERVOIR, STREAM-VIEW→IN-STREAM).

NM-H: the re-arm reads `RIVER-SPEEDS[HERE]` *after* the GOTO (the new section's speed),
not the old section's. NM-I: past RIVER-5 (no RIVER-NEXT entry) is the fatal waterfall —
do not silently disable; it must `JIGS-UP`.

### 6.4 The buoy + emerald (`RIVR4-ROOM` `:2844`, `BUOY`/`EMERALD`/`TREASURE-INSIDE`)

`BUOY` floats in `RIVER-4` (CONTBIT container, holds the `EMERALD`, `1dungeon.zil:556`).
`RIVR4-ROOM` M-END: the first turn the player holds the buoy with `BUOY-FLAG` still set,
"You notice something funny about the feel of the buoy." and clear `BUOY-FLAG` (the hint
that the buoy is worth opening). `TREASURE-INSIDE` (`:793`) on `OPEN BUOY` awards the
emerald's score via `SCORE-OBJ`. The emerald is a standard takeable treasure once the
buoy is opened.

### 6.5 WHITE-CLIFFS + landing (`WHITE-CLIFFS-FUNCTION` `:2585`)

`WHITE-CLIFFS-NORTH`/`-SOUTH` are `NONLANDBIT` river-adjacent rooms reachable only by
boat. The M-END sets `DEFLATE` based on whether the boat is carried (prevents deflating
where you'd be stranded). RIVER-4 is the landing for `SANDY-BEACH` (via RIVER-LAUNCH /
walk-to-land). The sandy beach is where the shovel and the dig puzzle live.

### 6.6 SAND-FUNCTION — dig the scarab (`1actions.zil:2855–2869`)

```
on DIG with SHOVEL:
  BEACH-DIG += 1
  if BEACH-DIG > 3:  BEACH-DIG = -1; if SCARAB in HERE: FSET SCARAB INVISIBLE;
                     JIGS-UP("The hole collapses, smothering you.")
  elif BEACH-DIG == 3: if SCARAB.INVISIBLE: "You can see a scarab here in the sand."; THIS-IS-IT; FCLEAR SCARAB INVISIBLE
  else: tell BDIGS[BEACH-DIG]          // dig-progress messages
```

The scarab (`SCARAB`, `1dungeon.zil:871`, INVISIBLE) surfaces on the **4th** dig
(BEACH-DIG reaches 3, `EQUAL? BEACH-DIG 3`); a **5th** dig (BEACH-DIG = 4,
`G? BEACH-DIG 3`) collapses the hole and kills you (and re-hides the scarab if
you hadn't grabbed it). `BDIGS` is a 3-string progress table (`:2871`), 0-indexed:
digs 1/2/3 print BDIGS[0/1/2] (BEACH-DIG = 0/1/2). `BEACH-DIG`
resets to -1 after the fatal collapse. NM-J: the counter runs -1 → 0 → 1 → 2 →
3 (reveal) → 4 (death); dig #4 reveals, dig #5 kills. Pin the counter boundaries exactly.

### 6.7 SCEPTRE wave + RAINBOW (`SCEPTRE-FUNCTION` `:2592`, `RAINBOW-FCN` `:2634`)

```
SCEPTRE-FUNCTION on WAVE/RAISE:
  if HERE in {ARAGAIN-FALLS, END-OF-RAINBOW}:
     if !RAINBOW-FLAG:
        FCLEAR POT-OF-GOLD INVISIBLE
        "Suddenly, the rainbow appears to become solid…walkable…"
        if HERE==END-OF-RAINBOW && POT-OF-GOLD in END-OF-RAINBOW: "A shimmering pot of gold appears…"
        RAINBOW-FLAG = true
     else:  ROB ON-RAINBOW WALL; "The rainbow seems to have become somewhat run-of-the-mill."; RAINBOW-FLAG=false
  elif HERE == ON-RAINBOW:  RAINBOW-FLAG=false; JIGS-UP("…hanging in midair, supported only by water vapor. Bye.")
  else: "A dazzling display of color briefly emanates from the sceptre."
```

`RAINBOW-FCN` on `CROSS`/`THROUGH`: from `CANYON-VIEW` → "From here?!?"; if `RAINBOW-FLAG`
then ARAGAIN-FALLS↔END-OF-RAINBOW cross; else "Can you walk on water vapor?".
`FALLS-ROOM` (`:2621`) M-LOOK describes the falls + the rainbow (solid iff RAINBOW-FLAG).
The pot of gold (`POT-OF-GOLD`, INVISIBLE until the wave) is the reward; waving while
standing **on** the rainbow drops you to your death. NM-K: waving on-rainbow is fatal;
waving at the endpoints toggles; the order (reveal pot only on the END-OF-RAINBOW side)
matters.

---

## 7. All Timers — Exact Tick Counts (consolidated)

| Timer | Initial tick | Re-arm | Source | Fires |
|-------|:------------:|--------|--------|-------|
| `I-RFILL` | **8** | one-shot (no re-arm) | `1actions.zil:1197` | fill reservoir, flip LOW-TIDE=false |
| `I-REMPTY` | **8** | one-shot | `1actions.zil:1204` | drain reservoir, flip LOW-TIDE=true, reveal trunk |
| `I-MAINT-ROOM` | **-1** (every turn) | demon; stops at WATER-LEVEL≥14 via `queue(…,0,off)` | `1actions.zil:1310` | leak rises; drown at 14 |
| `I-RIVER` | **RIVER-SPEEDS[HERE]** (4/4/3/2/1) | re-arms at new section's speed | `1actions.zil:2715,2750` | drift one section downstream |

The parked-opposite idiom (`queue(I-RFILL,0,off)` when opening, `queue(I-REMPTY,0,off)`
when closing) is NOT a timer that fires — it is the explicit cancel of the opposite phase
(clock-main-loop.md §14.5: tick-0 enabled is skipped; this spec disables it outright to
be unambiguous). Tick counts are exact and load-bearing — a wrong I-RIVER speed shifts
how many turns a player has to react before the next auto-move. NM-L (§3.4): `I-RFILL`'s
earlier flag mutations (NONLANDBIT set, `lowTide = false`, trunk re-hide) must survive the
port's death-abort semantics — they must complete before the `switch HERE` / `jigsUp` call
and must NOT be unwound if `jigsUp` aborts the tick.

---

## 8. Verification Strategy

**This subsystem is almost entirely DETERMINISTIC** — the only RNG draw is
`pickOne(LOUD-RUNS)` (loud-room panic scramble destination). Everything else (flag
transitions, timer fires, room re-descriptions, the boat interlock, the dig counter, the
rainbow toggle) is a pure function of game state. So unlike combat (Phase 2, no oracle),
this subsystem **leans hard on the dfrotz oracle corpus** — scripted walkthroughs whose
exact output we diff against real Zork.

### 8.1 dfrotz oracle corpus additions (the primary net)

Author these as new scripted walkthroughs in the oracle corpus (via
`zork-oracle-corpus-expand` machinery), engine-vs-dfrotz byte-diffed:

- **C-DAM — open/close cycle.** From DAM-LOBBY: push yellow button, go to DAM-ROOM, turn
  bolt with wrench, wait 8 turns (watch the in-progress descriptions), confirm drain
  message + trunk visible; cross RESERVOIR-NORTH↔SOUTH; turn bolt again, wait 8, confirm
  refill + trunk hidden + crossing blocked. Diffs every room re-description and timer
  message.
- **C-RIVER — full river run.** Inflate boat at DAM-BASE with pump, board, launch, drift
  RIVER-1→5 (observe the "carries you downstream" each section), grab the buoy at
  RIVER-4 (buoy hint), land at SANDY-BEACH, confirm no over-falls death when landing in
  time. A second variant: ride past RIVER-5 → confirm the waterfall death.
- **C-SAND — dig the scarab.** At SANDY-BEACH: take shovel, dig ×4 (BDIGS[0/1/2]
  progression on digs 1/2/3 + scarab reveal on dig 4), take scarab; separate variant:
  dig ×5 → fatal collapse.
- **C-RAINBOW — rainbow crossing.** At ARAGAIN-FALLS with sceptre: wave → rainbow solid;
  cross to END-OF-RAINBOW; wave → pot of gold appears; take pot; cross back. Variant:
  wave while ON-RAINBOW → death.
- **C-LEAK — maintenance leak.** Push blue button, watch DROWNINGS progression a few
  turns, repair with putty before level 14; variant: don't repair → drown at 14.
- **C-PUNCTURE — sharp-object puncture.** Board boat holding the sword → puncture
  message + punctured boat; repair with putty.

### 8.2 Golden master extensions (deterministic surfaces)

Extend the existing golden corpus with the dam/river deterministic surfaces that the
single 218-command golden path misses: the bolt-turn messages, the button clicks, the
boat inflate/deflate/board messages, the disembark messages, the dig progression. These
are byte-stable (no RNG) and belong in the golden.

### 8.3 Unit tests (state-machine interiors)

- **Dam state machine** — drive the flag triple through S0→S3→S4, assert each
  transition + which room TOUCHBITs were cleared (force re-describe) + trunk
  INVISIBLE toggles (NM-B conditional re-hide).
- **Timer arithmetic** — `I-RFILL`/`I-REMPTY` fire exactly 8 ticks after queue; the
  parked-opposite timer never fires (NM-A); `I-MAINT-ROOM` drowns at exactly
  WATER-LEVEL 14 and `DROWNINGS` indexes at `level/2` (NM-C); `I-RIVER` re-arms at the
  *new* section's speed (NM-H) and the past-RIVER-5 case is fatal (NM-I).
- **Vehicle interlock** — `GOTO` rejection clauses 1/2/3 (NM-E): on-foot into water
  blocked, boat into non-water blocked, beached boat onto wrong land blocked; landing
  prints rest-on-shore.
- **Sharp-object puncture** — BOARD with each of the six named objects punctures
  (NM-G); BOARD empty-handed succeeds; the DROP/PUT/ATTACK puncture is WEAPONBIT-based
  and distinct.
- **Dig counter** — BEACH-DIG boundaries: digs 1/2/3 → BDIGS[0/1/2], dig 4 → reveal,
  dig 5 → death + reset (NM-J).
- **Rainbow toggle** — wave at endpoints toggles RAINBOW-FLAG + reveals pot once;
  wave on-rainbow fatal (NM-K).
- **Loud-room mode** — loud-room input mode honors only the whitelist; ECHO sets
  LOUD-FLAG + clears BAR.SACREDBIT; bar takeable only when quiet (NM-D).
- **I-RFILL mutation ordering under death (NM-L)** — trigger a drowning death via
  `I-RFILL` (player on foot in reservoir when timer fires); after death, assert
  `LOW-TIDE === false` and `RESERVOIR` has `NONLANDBIT` set — the earlier mutations
  must not be unwound by the death-abort path.

### 8.4 Near-miss guards (NM-A…NM-L) as first-class tests

Each wrong-but-plausible failure mode above gets a dedicated asserting test. Because this
subsystem *does* have an oracle, a green oracle diff is strong evidence — but the NM
guards protect the non-oracle-visible internals (the parked-timer semantics, the trunk
re-hide condition, the puncture-set identity, and the mutation-ordering under death) that
a walkthrough might not exercise.

---

## 9. Build-Task DAG

Authored to drive a staged build wave (foundation → parallel units → integrate). Each task lists
deps, files, and done-criteria. No combat dependency anywhere.

### Wave 0 — Foundation (parallel)

- **F0 — Globals + verbs + clock-primitive confirm.** Add the nine globals (§2) to game
  state with exact inits; EXTEND the verb table with `inflate`/`deflate`/`board`/
  `disembark`/`launch`/`land`/`dig`/`wave` (thin shells delegating to object handlers).
  **Confirm Phase-2 F1 `queue(id,period,enabled)` is present** (this subsystem depends on
  it; no `killAll`). Deps: F1 (Phase-2 clock primitive). Done: globals round-trip at
  init values; the eight verbs route to handlers (not unknown-verb fallback); `queue`
  available + tick-0-park semantics confirmed by a test.
- **D-A — Data audit.** Verify (read-only, fold into F0's done-criteria or a quick
  task) that `INFLATED-BOAT` carries VEHBIT + VTYPE=NONLANDBIT post-hydration; the
  reservoir N/S `ifFlag` exits read `LOW-TIDE` from the flag store under the key F0 writes
  (`GATES-OPEN` does NOT gate these exits — only `LOW-TIDE` does, per `rooms.json:1424,1502`); `BAR` has SACREDBIT; `TRUNK`/`SCARAB`/`POT-OF-GOLD`/`EMERALD` have
  INVISIBLE. Done: a fixture test asserting these props; any mismatch is a data fix, not
  a handler bug.

### Wave 1 — Dam machine (deps: F0)

- **CB-DAM1 — BOLT-F + DAM-ROOM-FCN + DAM-FUNCTION.** Bolt turn (wrench gate, GATE-FLAG
  gate, queue I-RFILL/I-REMPTY + park opposite); dam-room 4-state description + bubble
  glow; dam joke verbs. Deps: F0. Done: bolt toggles GATES-OPEN + arms correct timer +
  parks opposite (NM-A); dam-room description matches each state; oracle C-DAM bolt
  messages green.
- **CB-DAM2 — I-RFILL / I-REMPTY.** The two 8-tick timers: flag flips, TOUCHBIT clears,
  trunk reveal/conditional-rehide (NM-B), per-room fire messages incl. the RESERVOIR
  on-foot drown + boat-float. Deps: CB-DAM1. Done: 8-tick timing exact; trunk toggles;
  drown-on-foot vs float-in-boat branch; LOUD-ROOM panic GOTO destination ∈ LOUD-RUNS.
- **CB-DAM3 — BUTTON-F + leak (I-MAINT-ROOM, LEAK-FUNCTION, PUTTY/TUBE).** Four buttons;
  blue-button leak trap; DROWNINGS progression; putty repair; WATER-LEVEL=-1 one-shot.
  Deps: F0. Done: each button effect; drown at level 14 (NM-C); putty repair stops timer;
  oracle C-LEAK green.
- **CB-DAM4 — Reservoir/canyon room re-descriptions.** `RESERVOIR-FCN` (M-END peril +
  M-LOOK), `RESERVOIR-NORTH-FCN`, `RESERVOIR-SOUTH-FCN`, `DEEP-CANYON-F` water suffix.
  Deps: CB-DAM2. Done: each 4-state description verbatim; M-END peril nag fires per-turn
  under the sealed+lowTide+on-foot condition.
- **CB-LOUD — LOUD-ROOM-FCN + ECHO mode.** The loud/quiet description coupling; the
  loud-room input mode honoring the whitelist; ECHO sets LOUD-FLAG + clears
  BAR.SACREDBIT; M-END loud-scramble GOTO. Deps: CB-DAM2 (LOUD-ROOM TOUCHBIT coupling).
  **OQ-1 gate CLEARED (2026-06-10):** `loudRoomMode` as a game-state branch in `turn()`
  is ratified — CB-LOUD may proceed without further sign-off on the input-mode design.
  Implement as `loudRoomMode` predicate in `turn()` (mirroring the B8 dead-ghost seam):
  while `HERE == LOUD-ROOM && loud`, route every command through the whitelist gate
  (exits/meta/ECHO obey; all else → V-ECHO + consume turn) until ECHO is said or the
  player leaves. Done: bar untakeable while loud, takeable after ECHO (NM-D); whitelist
  gate; mode exits on leave or ECHO; `pickOne(LOUD-RUNS)` panic scramble asserts
  destination ∈ LOUD-RUNS set (non-oracle-matched per OQ-2 ratification).

### Wave 2 — Boat + river (deps: F0; parallel with Wave 1)

- **CB-BOAT1 — GOTO vehicle interlock.** EXTEND `GOTO` with the three VEHBIT/NONLANDBIT
  rejection clauses + the rest-on-shore landing message (§4.2). Deps: F0, D-A. Done:
  clauses 1/2/3 (NM-E); on-foot-into-water blocked; landing message; existing golden
  movement unaffected (no regression on land-only moves).
- **CB-BOAT2 — IBOAT/RBOAT/DBOAT state triad.** Inflate (pump only, label reveal),
  deflate (3 guards), puncture-repair (putty), the boat-object swaps. Deps: F0. Done:
  inflate/deflate/repair swaps; lungs/other-tool inflate messages (NM-F); oracle
  C-PUNCTURE repair green.
- **CB-BOAT3 — RBOAT board/launch/puncture + I-RIVER.** BOARD sharp-object puncture set
  (NM-G); LAUNCH GO-NEXT + arm I-RIVER; drop/put/attack WEAPONBIT puncture + fatal-water
  JIGS-UP; I-RIVER drift + speeds + past-RIVER-5 death. Deps: CB-BOAT1, CB-BOAT2. Done:
  six-object puncture set; launch maps via RIVER-LAUNCH; I-RIVER re-arms at new speed
  (NM-H), waterfall death (NM-I); oracle C-RIVER green.
- **CB-RIVER-OBJ — buoy/emerald + white-cliffs + RIVR4.** `TREASURE-INSIDE` emerald
  score-on-open; `RIVR4-ROOM` buoy hint + BUOY-FLAG; `WHITE-CLIFFS-FUNCTION` DEFLATE
  gate; FALLS-ROOM description. Deps: CB-BOAT3. Done: buoy hint once; emerald scores on
  open; cliffs DEFLATE gate; falls description toggles on RAINBOW-FLAG.

### Wave 3 — Beach + rainbow (deps: Wave 2)

- **CB-SAND — SAND-FUNCTION dig.** Dig counter, BDIGS[0/1/2] progression on digs 1/2/3,
  scarab reveal on dig #4, fatal collapse on dig #5, reset. Deps: CB-RIVER-OBJ (beach
  reachable by boat). Done: dig boundaries (NM-J; dig #4 reveals, dig #5 kills);
  scarab reveal/re-hide; oracle C-SAND green.
- **CB-RAINBOW — SCEPTRE/RAINBOW/pot-of-gold.** Wave at endpoints (solid toggle + pot
  reveal once on END-OF-RAINBOW side); RAINBOW-FCN cross gating; on-rainbow fatal wave;
  RAINBOW-FLAG-driven exits + falls description. Deps: F0 (RAINBOW-FLAG), CB-RIVER-OBJ.
  Done: wave toggle + pot reveal (NM-K); cross gating; on-rainbow death; oracle C-RAINBOW
  green.

### Wave 4 — Verification consolidation

- **V1 — NM guard suite.** A dedicated asserting test per NM-A…NM-L (§8.4). Deps: all CB.
- **V2 — Oracle + golden integration.** All six oracle walkthroughs (§8.1) green
  engine-vs-dfrotz **under RNG-segment semantics (AMENDED 2026-06-11, owner-approved)**:
  routes that cross combat cannot byte-match end-to-end under the ratified Path B fence
  (engine Mulberry32 vs dfrotz's RNG produce different fight lengths — the original
  "all six byte-green" wording was unsatisfiable for the five troll-crossing routes).
  Corpus files therefore annotate RNG-variable turns (the fight segment): on those turns
  the harness compares structural landmarks only (room name, kill/death events, score),
  then RESYNCS both transcripts at a designated post-segment landmark line and resumes
  strict per-turn byte comparison. The fight interior remains proven the Path B way
  (seeded structural tests + chi-square — phase-2 spec §11). Deterministic surfaces —
  the point of these walkthroughs — stay byte-anchored to dfrotz. Path B itself is
  INVIOLATE: no draw-parity work, no rng.ts changes, in this task or any repair of it.
  Golden deterministic-surface extensions (§8.2) byte-identical; full suite green;
  faithfulness-audit pass over the dam/river surface. Deps: all CB.

---

## 10. Phase Gates

### G1 — Build / Merge
- [ ] Foundation: globals + verbs + clock-primitive (F1) confirmed; data audit clean.
- [ ] Dam machine complete: bolt/buttons/leak, both 8-tick timers, all reservoir/canyon
      re-descriptions, trunk reveal, loud-room ECHO + platinum bar.
- [ ] River/boat complete: vehicle interlock, inflate/deflate/board/launch/disembark,
      sharp-object puncture, I-RIVER drift, buoy/emerald, white-cliffs, sand/scarab,
      rainbow/sceptre/pot-of-gold, falls.
- [ ] All NM guards (A–L) have an asserting test; all six oracle walkthroughs green
      under the §9 V2 RNG-segment semantics (AMENDED 2026-06-11).
- [ ] Golden stays byte-identical except the new dam/river deterministic surfaces.
- [ ] Merged to the working branch (human commit voice; never detach).

### G2 — Deploy + Smoke
- [ ] Deployed build: drain the reservoir, take the trunk, inflate + run the river to
      the beach, dig the scarab, cross the rainbow, take the pot — end to end.

### G3 — Playtest-Ready
- [ ] Known-issues list updated: dam/river live; the loud-room input mode behavior
      documented for testers (it intentionally hijacks input until ECHO/exit).

---

## 11. Open Questions for Sign-off

1. **OQ-1 — Loud-room captive input loop → input-mode re-expression.** The ZIL
   `M-ENTER` runs a synchronous nested `READ` loop that the async web shell cannot block
   on. **Recommendation:** re-express as a `loudRoomMode` branch in `turn()` (whitelist
   exits/meta/ECHO obey; all else → V-ECHO + consume turn), mirroring the Phase-2
   `dead`-ghost dispatch seam. Confirm this is acceptable vs. attempting a literal loop.
   *(Behavior-equivalent but architecturally different; flagging because it changes how
   a turn is processed.)*
   **RATIFIED (2026-06-10):** `loudRoomMode` as a game-state branch in `turn()` is
   APPROVED (mirrors the ratified B8 dead-ghost dispatch seam). CB-LOUD's gate on this
   decision is now SATISFIED — see CB-LOUD task note below.

2. **OQ-2 — `pickOne(LOUD-RUNS)` and the over-the-dam-while-in-stream paths under Path
   B.** The loud-room scramble destination and a couple of drown messages are the only
   RNG-or-position-dependent surfaces. **Recommendation:** treat the LOUD-RUNS pick as
   non-oracle-matched (test the destination *set*, like Phase-2 RANDOMIZE-OBJECTS);
   everything else is deterministic and oracle-diffable. Confirm we are content leaving
   the one scramble pick out of the byte-exact golden.
   **RATIFIED (2026-06-10):** `pickOne(LOUD-RUNS)` is non-oracle-matched (Path B):
   destination-set property test; excluded from byte-exact golden.

3. **OQ-3 — Does `disembark`/`exit-vehicle` already exist as a Phase-1 stub?** F0 must
   verify before adding it (avoid a double-registration). Not a design question — a
   build-time check — but surfaced so it isn't lost. *(Resolve at F0.)*
   **RATIFIED (2026-06-10):** ratified as build-time check — resolve at F0 by verifying
   against the merged branch before adding.

4. **OQ-4 — Maintenance-leak `WATER-LEVEL = -1` sentinel vs. a separate `leakFixed`
   boolean.** ZIL overloads `WATER-LEVEL` (-1 = fixed, 0 = no leak, 1–14 = rising).
   **Recommendation:** keep the faithful single FIX global with the -1 sentinel (the
   blue-button `0?` re-push guard depends on it). Confirm we don't want to split it into
   two fields for clarity (would diverge from ZIL but read cleaner).
   **RATIFIED (2026-06-10):** keep the faithful `WATER-LEVEL = -1` overloaded sentinel;
   no `leakFixed` split.
