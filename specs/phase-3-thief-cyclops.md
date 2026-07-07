# Phase 3a — Thief & Cyclops Activation

**Status:** DRAFT 2026-06-09 — for morning sign-off. Implementation-ready, NOT locked.
**Date:** 2026-06-09
**Owner:** Dylan
**Repo:** lhocke/zork-workflow (private)
**Depends on:** `specs/phase-2-combat.md` (RATIFIED — the combat engine, VillainEntry
record, DO-FIGHT, THIEF-MELEE/CYCLOPS-MELEE tables, the THIEF-ENGROSSED strength cap,
I-FIGHT demon, jigsUp/death.ts are all LANDED dependencies). This spec wires
**activation only** — it does not re-spec the engine.

> Phase 2 built the combat engine complete but wired only the troll live: the thief and
> cyclops tables, MELEE messages, and the THIEF-ENGROSSED cap are all transcribed and
> present, but I-THIEF and I-CYCLOPS were never scheduled and ROBBER-FUNCTION /
> CYCLOPS-FCN were never registered. Phase 3a turns both actors on: the thief's full
> wander/steal/deposit/flee state machine on top of the existing engine, and the cyclops
> hunger/wrath puzzle plus the ODYSSEUS east-wall break. It also owns a correctness debt
> Phase 2 deferred: the **353-vs-350 score reconciliation**, which only resolves once the
> thief-opens-egg path exists (the deposited egg in the canonical 350-point path is the
> *broken* egg, TVALUE 2, not the intact egg, TVALUE 5).
>
> Verification continues to honor the **Path B fence** (`phase-2-combat.md §11`): the
> thief is the single most RNG-entangled actor in the game (a PROB/RANDOM draw on nearly
> every tick — wander target, steal chance, drop chance, encounter, flee). Its behavior is
> proven with **seeded/injected RNG structural tests**; the golden master anchors only the
> deterministic surfaces (give-responses, treasure-room reveal, ODYSSEUS, the egg-solve
> score acceptance test).

---

## 1. Goal & Scope

### What Phase 3a proves

The thief and cyclops are the two remaining live-actor walls in the central map. With
them active, the egg/canary treasure chain closes (you can no longer reach an intact-egg
deposit that breaks the 350 total), the cyclops staircase and the ODYSSEUS shortcut into
the maze open, and the score reconciles exactly to 350 on the canonical path.

### In scope

- **Thief actor** — I-THIEF per-turn demon (the full wander/steal/deposit state machine:
  THIEF-VS-ADVENTURER, ROB, ROB-MAZE, STEAL-JUNK, DROP-JUNK, DEPOSIT-BOOTY,
  HACK-TREASURES, RECOVER-STILETTO), WINNING? flee logic, THIEF-ENGROSSED set-on-give,
  ROBBER-FUNCTION F-code callbacks (F-BUSY/F-DEAD/F-UNCONSCIOUS/F-CONSCIOUS/F-FIRST),
  TREASURE-ROOM-FCN + THIEF-IN-TREASURE defense, STILETTO-FUNCTION (via WEAPON-FUNCTION),
  LARGE-BAG-F.
- **Egg/canary thief path** — the thief-opens-egg branch (give egg → thief engrossed; or
  steal egg → DEPOSIT-BOOTY in TREASURE-ROOM sets EGG-SOLVE and OPENBIT). This is the
  egg/canary "good" path: a non-destructive open by the thief.
- **The 353→350 score reconciliation** (THIS SPEC OWNS IT) — the EGG TVALUE 5 vs
  BROKEN-EGG TVALUE 2 deposited-value swap; the canonical 350 path deposits the broken
  egg, not the intact one. Gets an explicit acceptance test (§7.1).
- **Cyclops actor** — CYCLOPS-FCN (give/attack/odysseus/sleeping/examine dispatch),
  I-CYCLOPS CYCLOWRATH wrath timer, the hot-pepper-lunch + water puzzle (feed LUNCH →
  thirsty; give WATER → sleep), ODYSSEUS/ULYSSES magic word → MAGIC-FLAG east-wall break,
  CYCLOPS-ROOM-FCN (M-LOOK state branches, M-ENTER wrath enable), CYCLOPS-FLAG
  sleep/wake.

### Out of scope (explicitly)

- Dam/river/boat, Hades exorcism, generic verb sweep, save/restore (Phase-1/2 deferrals
  stand).
- Any re-specification of the combat engine, DO-FIGHT, the DEF tables/windows, the MELEE
  tables, strength formulas, or the death/endgame layer — all RATIFIED in
  `phase-2-combat.md` and treated as landed.
- The I-SWORD glow demon (`1actions.zil:3851`) — RESOLVED (OQ-3 ratified 2026-06-10):
  I-SWORD is being built in the phase-2 hotfix H3 (registered clock entry, glow
  transitions, KILL-INTERRUPTS list updated). This phase inherits a working I-SWORD; no
  task needed here.

### Non-goals

- No Frotz byte-parity for the thief. Path B stands: the thief's RNG draws are seeded and
  internally deterministic, NEVER oracle-matched against dfrotz (the wander walk depends
  on the compiled ROOMS object-chain order, unrecoverable from ZIL).

---

## 2. Current State Reconciliation

Measured against a pinned checkout on 2026-06-09.
Combat engine judged against `phase-2-combat.md` (RATIFIED), not against `src/` (the
combat branch is mutating tonight).

Legend: **NEW** = create; **EXTEND** = add to existing, keep the rest; **WIRE** =
register/schedule an already-present-but-dormant piece; **DONE** = built, no work.

### Action registry — WIRE (the core gap)

`src/actions/registry.ts:33–37` merges `aboveGroundActions`, `lightSourcesActions`,
`coalMineActions` into `ACTIONS`. Confirmed **absent** from the merged map:
`ROBBER-FUNCTION`, `TREASURE-ROOM-FCN`, `CYCLOPS-FCN`, `CYCLOPS-ROOM-FCN`,
`STILETTO-FUNCTION`, `LARGE-BAG-F`, `CHALICE-FCN`. These are the wirings this phase adds
(a new `thief.ts` + `cyclops.ts` action module merged into `ACTIONS`, mirroring the
existing region-file pattern).

### Demons — WIRE / NEW

`I-THIEF` and `I-CYCLOPS` are **never scheduled** (confirmed). The clock supports the
demon convention directly: `turnsLeft < 0` fires every `advance()` and is never
decremented (`clock.ts:28, 95–99`) — exactly the ZIL `QUEUE I-* -1` form. I-THIEF is a
standing demon (enabled at world start, runs every tick); I-CYCLOPS is enabled on demand
(`ENABLE <QUEUE I-CYCLOPS -1>` from CYCLOPS-FCN/CYCLOPS-ROOM-FCN) and self-disables when
the player leaves CYCLOPS-ROOM or the cyclops sleeps.

### Egg / canary handlers — DONE (the thief hook is the EXTEND)

`EGG-OBJECT` and `CANARY-OBJECT` are present and registered (`above-ground.ts:747,837`;
registry entries `above-ground.ts:1029–1030`). They handle the *player-driven*
open/break paths (OPEN-with-tool, MUNG, THROW, CLIMB-ON → BAD-EGG). The **thief path is
absent**: DEPOSIT-BOOTY's `EGG-SOLVE T + FSET EGG OPENBIT` branch
(`1actions.zil:1906–1908`) and the `EGG-SOLVE` global do not exist. This phase adds the
thief side; it does NOT rewrite the existing player-side egg handler.

### Egg object data — DONE (no data edit)

`objects.json`: EGG `{VALUE:5, TVALUE:5}` (line 2486–2488), BROKEN-EGG `{TVALUE:2}`
(2515), CANARY `{VALUE:6, TVALUE:4}` (2558–2559), BROKEN-CANARY `{TVALUE:1}` (2582),
BAUBLE `{VALUE:1, TVALUE:1}` (2537–2538) — all match ZIL (`1dungeon.zil:1154–1217`)
exactly. **The 353→350 reconciliation is a BEHAVIOR fix (which egg gets deposited on the
canonical path), NOT a data edit** — see §6.

### Score / scoring engine — EXTEND (otvalFrob faithfulness fix)

`scoring.ts` is the RATIFIED Phase-2 model (WON-FLAG at 350, `maxScore` hardcoded 350 —
`tests/shell/seam.test.ts:358`). **EXCEPTION (OQ-2 ratification, 2026-06-10):** `otvalFrob`
in `scoring.ts` currently sums nested container TVALUEs recursively — this is UNFAITHFUL to
ZIL OTVAL-FROB, which discards the recursive result. R1 must fix `otvalFrob` to the
non-recursive behavior (egg+canary deposit = +5, not +9) with a dfrotz-anchored test.
All other scoring logic is read-only for this phase.

### Combat engine (VillainEntry, DO-FIGHT, MELEE, strength) — DONE (landed dependency)

Per `phase-2-combat.md`: the THIEF VillainEntry `{vBest:KNIFE, vBestAdv:1, vProb:0,
vMsgs:THIEF_MELEE}` and CYCLOPS `{vBest:none, vBestAdv:0, vProb:0, vMsgs:CYCLOPS_MELEE}`
are transcribed; THIEF_MELEE/CYCLOPS_MELEE tables are present; the THIEF-ENGROSSED cap is
in villainStrength; DO-FIGHT already excludes the cyclops (index 3, NM-7). This phase
supplies the **F-code callbacks** those VillainEntries dispatch to (ROBBER-FUNCTION,
CYCLOPS-FCN), and **schedules I-THIEF/I-CYCLOPS** — it does not touch the engine.

### Globals / flags — NEW

Add game-state globals (init values from ZIL): `THIEF-HERE` `<>`
(`1actions.zil:1754`), `THIEF-ENGROSSED` `<>` (`:1945`), `EGG-SOLVE` `<>` (`:1748`),
`CYCLOWRATH` `0` (`:1513`), `CYCLOPS-FLAG` `<>`, `MAGIC-FLAG` `<>` (`1dungeon.zil:1231`),
`SING-SONG` `<>` (`:2968` — gates the bauble drop; the egg/canary chain depends on it).
**SING-SONG reconciliation:** an existing `singSong` already lives in
`src/actions/above-ground.ts:55` with a `resetSingSong` wiring in `session.ts`. F1 must
reconcile with this existing field rather than creating a parallel global — see F1
done-criteria.
`CYCLOPS-FLAG` and `MAGIC-FLAG` stay **FlagStore keys** (exit-gating already reads
`MAGIC-FLAG` from there — `1dungeon.zil:1455,1733` — mirroring the Phase-2 TROLL-FLAG
decision D3). `THIEF-HERE`/`THIEF-ENGROSSED`/`EGG-SOLVE`/`CYCLOWRATH`/`SING-SONG` are
plain game-state values.

### ROBBER-C-DESC / ROBBER-U-DESC — NEW (string globals)

The thief's conscious/unconscious LDESCs (`1actions.zil:2086–2092`) drive F-conscious
revival, LARGE-BAG-F's "collapsed on the bag" message, and the give-while-KO recovery
branch. Carry both as string constants; the thief's current LDESC is a mutable game-state
field (ZIL `PUTP THIEF P?LDESC`).

---

## 3. Thief State Machine (transcription-oriented)

All citations `zil/1actions.zil` unless noted. The thief is a **transcription** of an
existing, fully-specified ZIL state machine onto the landed combat engine — fidelity to
the ZIL control flow and probability sites is the whole job.

### 3.1 I-THIEF per-turn demon (`:3890–3931`)

Standing clock demon (`turnsLeft = -1`, enabled at world start). `RM = LOC(THIEF)`;
`HERE? = not INVISIBLE(THIEF)` (and refresh `RM` when visible). Three top-level branches:

```
1. Thief in TREASURE-ROOM and player elsewhere (:3895–3897):
     if HERE?: hackTreasures(); HERE? = false       // reveal floor treasures
     depositBooty(TREASURE-ROOM)                     // silent — drop bag's valuables
2. Thief in HERE, room not lit (ONBIT), no troll here (:3898–3902):
     if thiefVsAdventurer(HERE?): return             // encounter resolved this tick
     if INVISIBLE(THIEF): HERE? = false
3. else (:3903–3914):
     if THIEF in RM and not INVISIBLE: FSET INVISIBLE; HERE? = false   // victim left
     if TOUCHBIT(RM):                                                  // hack belongings
        rob(RM, THIEF, 75)                                            // 75% per valuable
        FLG = (MAZEBIT(RM) and MAZEBIT(HERE)) ? robMaze(RM) : stealJunk(RM)
// then, once per tick when NOT here (:3915–3928): MOVE to next valid room + <AGAIN>
if (ONCE = !ONCE) and not HERE?:
   recoverStiletto()
   walk RM via NEXT?(ROOMS) cycling to FIRST?(ROOMS); accept first
     room that is !SACREDBIT and RLANDBIT; MOVE THIEF there;
     clear FIGHTBIT; FSET INVISIBLE; THIEF-HERE = false; <AGAIN>
// finally (:3929–3931):
if RM != TREASURE-ROOM: dropJunk(RM)
return FLG
```

> **`<AGAIN>` semantics (faithfulness risk).** The ZIL `<AGAIN>` after the move re-runs
> I-THIEF from the top **once** in the thief's new room (the `ONCE` guard prevents an
> infinite walk — it flips true on the first pass, so the second pass skips the move
> block). Port this as a bounded re-entry (a `do { } while` capped at 2 passes), NOT a
> recursive demon re-dispatch. T-TASK done-criteria asserts at most 2 passes per tick.

### 3.2 THIEF-VS-ADVENTURER (`:1764–1873`) — the encounter probability tree

Returns true when the thief "finished" its interaction this tick. The branch order is
load-bearing (each PROB consumes a draw):

```
if not DEAD and HERE == TREASURE-ROOM: return false      // handled by TREASURE-ROOM-FCN
if not THIEF-HERE:                                        // first appearance
   if not DEAD and not HERE? and PROB(30):                // 30% materialize w/ stiletto
       FCLEAR THIEF INVISIBLE; print "Someone carrying a large bag…";
       THIEF-HERE = true; return true
   if HERE? and FIGHTBIT(THIEF) and not winning(THIEF):    // flee — see §3.3
       print "discretion … disappears"; FSET INVISIBLE; FCLEAR FIGHTBIT;
       recoverStiletto(); return true
   if HERE? and FIGHTBIT(THIEF) and PROB(90): return false // 90% stay & fight
   if HERE? and PROB(30):                                  // 30% leave empty-handed
       print "holder of the large bag just left…"; FSET INVISIBLE;
       recoverStiletto(); return true
   if PROB(70): return false                               // 70% idle
   if not DEAD:                                            // rob
       ROBBED? = rob(HERE, THIEF, 100) ? HERE
               : rob(WINNER, THIEF) ? PLAYER : nil
       THIEF-HERE = true
       … print the appropriate robbery narration (room vs you; here vs passing through);
       call stoleLight?(); FSET INVISIBLE as branch dictates; return true
else (THIEF-HERE already):                                 // :1848–1872
   if HERE? and PROB(30):
       ROBBED? = rob(HERE,THIEF,100) ? HERE : rob(WINNER,THIEF) ? PLAYER : nil
       … robbery narration; FSET INVISIBLE; HERE? = false; recoverStiletto()
return false
```

`stoleLight?` (`:1875–1880`): recompute LIT; if the room just went dark, print "The thief
seems to have left you in the dark."

### 3.3 WINNING? — flee decision (`:3584–3591`)

```
VS = villain.pStrength
PS = VS - fightStrength()                  // adjusted player strength
if PS > 3:  return prob(90)
if PS > 0:  return prob(75)
if PS == 0: return prob(50)
if VS > 1:  return prob(25)
return prob(10)
```

All **one-arg `prob`** (LUCKY-insensitive). The flee check runs **only in
THIEF-VS-ADVENTURER** (I-THIEF path), never in DO-FIGHT (Phase-2 NM-10 asserted this
absence; do not add a flee branch to the engine).

### 3.4 The booty routines (helpers)

| Routine | ZIL | Behavior (exact) |
|---|---|---|
| `ROB(what, where, prob?)` | `:3976–3989` | For each child of `what`: if !INVISIBLE && !SACREDBIT && TVALUE>0 && (no prob \|\| prob(prob)): MOVE to `where`, FSET TOUCHBIT; if where==THIEF FSET INVISIBLE; mark robbed. Returns robbed?. |
| `ROB-MAZE(rm)` | `:1917–1933` | First TAKEBIT && !INVISIBLE child at PROB(40): announce "I wonder what this fine X is doing here"; then PROB(60,80) → MOVE to THIEF + TOUCHBIT + INVISIBLE. (Two-arg PROB → zprob.) |
| `STEAL-JUNK(rm)` | `:3954–3974` | First TVALUE==0 && TAKEBIT && !SACREDBIT && !INVISIBLE child where (X==STILETTO \|\| prob(10,T)): MOVE to THIEF + TOUCHBIT + INVISIBLE; if X==ROPE clear DOME-FLAG; if rm==HERE announce "you suddenly notice the X vanished". |
| `DROP-JUNK(rm)` | `:3933–3947` | For each thief child (skip STILETTO/LARGE-BAG): if TVALUE==0 && prob(30,T): FCLEAR INVISIBLE, MOVE to rm; if first drop into HERE announce "rummaging through his bag, dropped a few items". |
| `DEPOSIT-BOOTY(rm)` | `:1897–1909` | For each thief child (skip STILETTO/LARGE-BAG): if TVALUE>0: MOVE to rm; **if X==EGG: EGG-SOLVE=true; FSET EGG OPENBIT** (the egg-solve hook — §6). Returns true if anything moved. |
| `HACK-TREASURES()` | `:1888–1895` | recoverStiletto(); FSET THIEF INVISIBLE; FCLEAR INVISIBLE on every TREASURE-ROOM child (reveal deposited loot on the floor). |
| `RECOVER-STILETTO()` | `:3949–3952` | if STILETTO in LOC(THIEF): FSET NDESCBIT; MOVE to THIEF. |
| `MOVE-ALL(from,to)` | `:2114–2121` | FCLEAR INVISIBLE + MOVE every child of `from` to `to`. |

> **`prob(10,T)` / `prob(30,T)` / `prob(60,80)` are two-arg → ZPROB** (Phase-2 §5). At
> LUCKY=true these run at the nominal rate; LUCKY only ever goes false on mirror-mung
> (out of scope this phase, but the bootstrap LUCKY=true init from Phase-2 F2 must be
> present or every thief two-arg PROB silently runs at ~1/3 — T-TASK verifies LUCKY=true
> at construction).

### 3.5 ROBBER-FUNCTION — F-code callbacks + verb dispatch (`:1947–2084`)

Dispatched two ways: as the THIEF VillainEntry callback with an F-code MODE (from
DO-FIGHT/I-FIGHT/VILLAIN-RESULT), and as the THIEF object-action with `MODE` absent (verb
dispatch). Both live in one routine.

**MODE absent (verb dispatch, `:1951–2024`):**
- `TELL` → "strong, silent type"; clear P-CONT.
- `HELLO` while unconscious-LDESC → "temporarily incapacitated".
- `THROW KNIFE` (thief not fighting) → MOVE knife HERE; `prob(10,0)` (zprob) → thief
  flees, bag contents spill (MOVE-ALL THIEF→HERE), stiletto/bag re-pocketed, FSET
  INVISIBLE; else "you missed … angered" + FSET FIGHTBIT.
- `THROW`/`GIVE` X to thief (`:1986–2012`) — **the engrossed/egg hook**: if thief KO'd
  (pStrength<0), negate pStrength (revive), enable I-THIEF, recoverStiletto, set
  conscious LDESC, "victim suddenly recovers consciousness"; then MOVE X to THIEF and
  branch: X==STILETTO → salute; **TVALUE(X)>0 → `THIEF-ENGROSSED = true` + "taken aback
  by your unexpected generosity … stops to admire its beauty"**; else → "places the X in
  his bag and thanks you".
- `TAKE` → "what would you do with him?"; `EXAMINE`/`LOOK-INSIDE` → beady-eyes desc;
  `LISTEN` → "not been formally introduced".

**F-codes (MODE present):**

| F-code | ZIL | Behavior |
|---|---|---|
| `F-BUSY?` | `:2025–2034` | stiletto in THIEF → false. stiletto in LOC(THIEF) → MOVE to THIEF + NDESCBIT; if THIEF in HERE "nimbly retrieves his stiletto"; return T (skip blow). |
| `F-DEAD` | `:2035–2062` | MOVE stiletto→HERE (clear NDESCBIT); `depositBooty(HERE)`; if HERE==TREASURE-ROOM walk children, reveal each (≠CHALICE/THIEF/ADVENTURER) with "as the thief dies … his treasures reappear:" list, then "The chalice is now safe to take."; else if booty remained "His booty remains."; **DISABLE I-THIEF**. |
| `F-FIRST?` | `:2063–2069` | if THIEF-HERE && !INVISIBLE && prob(20): FSET FIGHTBIT; clear P-CONT; return T. |
| `F-UNCONSCIOUS` | `:2070–2075` | DISABLE I-THIEF; FCLEAR FIGHTBIT; MOVE stiletto→HERE (clear NDESCBIT); LDESC → unconscious. |
| `F-CONSCIOUS` | `:2076–2084` | if LOC(THIEF)==HERE: FSET FIGHTBIT, "robber revives … scrambles away"; ENABLE I-THIEF; LDESC → conscious; recoverStiletto. |

### 3.6 TREASURE-ROOM defense (`:2138–2161`)

`TREASURE-ROOM-FCN(M-ENTER)`: if I-THIEF enabled and not DEAD — if thief not already
here, "scream of anguish … rushes to its defense", MOVE thief here; FSET FIGHTBIT, FCLEAR
INVISIBLE; `thiefInTreasure()`. `THIEF-IN-TREASURE` (`:2151–2161`): if ≥2 children,
"gestures mysteriously, and the treasures … vanish"; FSET INVISIBLE on every child except
CHALICE and THIEF. (`CHALICE-FCN` `:2123–2136` blocks TAKE while a live thief guards the
room — "stabbed in the back first".)

### 3.7 STILETTO-FUNCTION / LARGE-BAG-F

`STILETTO-FUNCTION` (`:626–627`) → `WEAPON-FUNCTION(STILETTO, THIEF)` (`:629–638`): if
thief not here, fall through; on TAKE → "swings it out of reach" / "white-hot, can't hold
on", return T. `LARGE-BAG-F` (`:2094–2112`): TAKE → "collapsed on the bag" (KO'd) or
"taken over his dead body"; PUT-into-bag → "good trick"; OPEN/CLOSE → "getting close
enough"; EXAMINE → "underneath the thief".

---

## 4. Cyclops Puzzle Mechanics (transcription-oriented)

### 4.1 CYCLOPS-FCN dispatch (`:1515–1594`)

Object-action handler (no F-code MODE — CYCLOPS-FCN has no combat callbacks; cyclops is
never processed by DO-FIGHT, Phase-2 NM-7, so its VillainEntry F-codes fall through to
nil). Branch order:

```
COUNT = CYCLOWRATH
if WINNER == CYCLOPS:                          // "talk to cyclops" — player addressing it
   if CYCLOPS-FLAG: "fast asleep"
   elif VERB ODYSSEUS: WINNER = ADVENTURER; PERFORM V-ODYSSEUS; return  // §4.4
   else: "prefers eating to making conversation"
elif CYCLOPS-FLAG (asleep):
   EXAMINE → "sleeping like a baby"
   ALARM|KICK|ATTACK|BURN|MUNG → "yawns and stares", clear CYCLOPS-FLAG, FSET FIGHTBIT,
      CYCLOWRATH = (COUNT<0) ? -COUNT : COUNT       // wake to angry, preserve magnitude
elif VERB EXAMINE: "hungry cyclops at foot of stairs"
elif GIVE with PRSI==CYCLOPS:                  // the feed puzzle — §4.3
   PRSO==LUNCH:  if COUNT >= 0: REMOVE LUNCH; "Mmm hot peppers! … could use a drink…";
                    CYCLOWRATH = min(-1, -COUNT)
                 ENABLE I-CYCLOPS (-1)
   PRSO==WATER (or BOTTLE w/ WATER inside): if COUNT<0: REMOVE WATER; MOVE BOTTLE HERE,
                    FSET BOTTLE OPENBIT; FCLEAR CYCLOPS FIGHTBIT; "drinks … falls fast
                    asleep"; CYCLOPS-FLAG = true
                 else: "not thirsty, refuses"
   PRSO==GARLIC: "there is a limit"
   else: "not so stupid as to eat THAT!"
elif VERB THROW|ATTACK|MUNG: ENABLE I-CYCLOPS (-1);
   MUNG → "do you think I'm as stupid as my father" ; else "shrugs … pitiful attempt"
      (THROW → MOVE PRSO HERE); return
elif TAKE → "doesn't take kindly to being grabbed"; TIE → "fit to be tied";
   LISTEN → "stomach rumbling"
```

> **Combat note (composes with the engine):** Before FIGHTBIT is set, ATTACK/THROW/MUNG
> are intercepted here (start the wrath timer, do not enter melee). Once FIGHTBIT is set
> (waking a sleeping cyclops), the engine's I-FIGHT will run CYCLOPS-MELEE via
> VILLAIN-BLOW — but DO-FIGHT excludes the cyclops index, so it never takes a hero blow
> and is unkillable by normal melee (DEF=10000). This is faithful and requires no wiring;
> the puzzle (feed→sleep or ODYSSEUS) is the only way past. (Phase-2 NM-7.)

### 4.2 I-CYCLOPS wrath timer (`:1596–1614`)

On-demand demon (`turnsLeft = -1`, enabled by the feed/attack branches and CYCLOPS-ROOM
M-ENTER; self-disables off-room or asleep):

```
if CYCLOPS-FLAG or DEAD: return (stay scheduled, no-op)
if HERE != CYCLOPS-ROOM: DISABLE I-CYCLOPS
else:
   if abs(CYCLOWRATH) > 5: DISABLE I-CYCLOPS; jigsUp("the cyclops … grabs you firmly …")
   else:
      CYCLOWRATH += (CYCLOWRATH < 0) ? -1 : +1       // escalate magnitude each tick
      if not CYCLOPS-FLAG: tell CYCLOMAD[abs(CYCLOWRATH) - 1]    // 6-element table
```

`CYCLOMAD` (`:1644–1652`) — 6 escalating messages, 0-indexed by `abs(CYCLOWRATH)-1`;
transcribe verbatim. **jigsUp is the Phase-2 death path** (clock-context — routes through
the M-FATAL extension, B3 RATIFIED); I-CYCLOPS calling jigsUp from the clock advance is
the same seam I-FIGHT uses.

### 4.3 The hot-pepper / water puzzle (closed loop)

1. `give lunch to cyclops` (CYCLOWRATH ≥ 0) → eats peppers, becomes thirsty
   (CYCLOWRATH → `min(-1, -COUNT)`, i.e. negative), I-CYCLOPS enabled.
2. `give water to cyclops` (CYCLOWRATH < 0) → drinks, **CYCLOPS-FLAG = true (asleep)**,
   FIGHTBIT cleared, bottle returned + opened.
3. A sleeping cyclops unblocks the staircase (CYCLOPS-ROOM exits gated on CYCLOPS-FLAG —
   `1dungeon.zil`, data-driven). Provoking it (ALARM/KICK/ATTACK/BURN/MUNG) re-wakes it.

### 4.4 ODYSSEUS / ULYSSES → MAGIC-FLAG east-wall break (`gverbs.zil:945–961`)

`ODYSSEUS`/`ULYSSES` syntax → V-ODYSSEUS (`gsyntax.zil:334–335`). V-ODYSSEUS (Zork-1
branch): if HERE==CYCLOPS-ROOM && CYCLOPS in HERE && !CYCLOPS-FLAG → DISABLE I-CYCLOPS;
CYCLOPS-FLAG=true; "hearing the name of his father's deadly nemesis, flees … knocking
down the wall on the east"; **MAGIC-FLAG=true**; FCLEAR CYCLOPS FIGHTBIT;
REMOVE-CAREFULLY CYCLOPS. Else → "Wasn't he a sailor?".

`MAGIC-FLAG` opens the LIVING-ROOM↔STRANGE-PASSAGE west door (`1dungeon.zil:1455`) and the
CYCLOPS-ROOM east wall (`:1733`), and re-describes LIVING-ROOM (`1actions.zil:453`) and
CYCLOPS-ROOM (`:1623`). All data-driven `IF MAGIC-FLAG` exits — wiring is the FlagStore key
+ V-ODYSSEUS. **This phase ports V-ODYSSEUS** (confirm whether the verb routine is already
present in the engine's verb table; if absent it is NEW — flagged in C-TASK done-criteria).

### 4.5 CYCLOPS-ROOM-FCN (`:1616–1642`)

`M-LOOK`: base "exit on the northwest, staircase up", then a CYCLOWRATH/flag state branch
(asleep / MAGIC-FLAG opening / neutral hungry / angry / pepper-gasping — 5 mutually
exclusive descriptions, transcribe verbatim). `M-ENTER`: `if CYCLOWRATH != 0: ENABLE
I-CYCLOPS`.

---

## 5. The Egg/Canary Chain & the 350-Point Reconciliation

### 5.1 Why the runtime currently totals 353

The intact EGG has TVALUE 5 and contains the intact CANARY (TVALUE 4). The canonical
350-point Zork I solution **never deposits the intact egg**: the egg must be *opened*
(yielding access to the canary), and on the scored path the deposited egg is the
**BROKEN-EGG (TVALUE 2)**. The 3-point gap (5 − 2) is exactly 353 − 350.

The non-destructive open the player wants is **the thief's**: give the egg to the thief
(or let him steal it), and `DEPOSIT-BOOTY` opens it in the treasure room
(`EGG-SOLVE T + FSET EGG OPENBIT`, `:1906–1908`) without breaking it — so the player can
then `wind the canary` (intact, in the FOREST/UP-A-TREE) to get the BAUBLE
(`CANARY-OBJECT` `:2970–2990`, gated on `SING-SONG` + `FOREST-ROOM?`). The player then
deposits the **broken** egg (after the canary is wound and the egg is later damaged in
normal play) — the canonical max-score accounting lands on 350 because the egg counted at
deposit is the broken one (TVALUE 2), and the bauble (1) + intact-canary VALUE (find
award 6) close the chain.

> **This is a behavior wiring, not a data edit.** EGG TVALUE stays 5 in the data (it must
> — the intact egg IS worth 5 if you could deposit it). The reconciliation is that the
> *reachable canonical path* deposits the broken egg. Phase 3a's job is to make the
> thief-opens-egg path exist (so EGG-SOLVE fires and OPENBIT is set non-destructively),
> and to assert via acceptance test that the canonical solve totals exactly 350.

### 5.2 EGG-SOLVE hook

The only new egg behavior: `DEPOSIT-BOOTY` (§3.4) sets `EGG-SOLVE = true` and `FSET EGG
OPENBIT` when the egg is among the thief's deposited booty. The global `EGG-SOLVE`
(`:1748`) is otherwise read by the canary path. The existing player-side EGG-OBJECT
handler (BAD-EGG, break paths) is unchanged.

---

## 6. Composition with the Combat Seam (I-THIEF ↔ I-FIGHT ordering)

Both I-THIEF and I-FIGHT are per-turn clock demons (`turnsLeft = -1`). They run in the
clock `advance()` loop in **registration order**. The ordering matters and must match ZIL.

> **ZIL demon order (gclock C-TABLE / DEMONS):** I-FIGHT precedes I-THIEF (Phase-2
> registered I-FIGHT; this phase registers I-THIEF after it). On a given tick: I-FIGHT
> resolves any in-progress melee (a fighting thief trades blows), THEN I-THIEF runs its
> wander/steal/encounter logic (which may flee, move, or rob). **T-TASK must register
> I-THIEF AFTER I-FIGHT in the clock schedule** and assert the order in a test (the
> thief's flee-after-losing-a-blow behavior depends on I-FIGHT having run first that
> tick). I-CYCLOPS order is independent (it only fires in CYCLOPS-ROOM and never interacts
> with I-THIEF).

Shared concerns the wave author must hold:
- **FIGHTBIT / INVISIBLE / pStrength on the thief** are touched by BOTH demons and by
  ROBBER-FUNCTION F-codes — the single source of truth is the Actor + FlagStore (no
  duplicated thief-state). The Phase-2 VillainEntry for THIEF already exists; this phase
  must not create a second thief metadata record.
- **DISABLE/ENABLE I-THIEF** is driven from F-DEAD (disable), F-UNCONSCIOUS (disable),
  F-CONSCIOUS (enable), and the give-while-KO revive (enable). The clock's
  `enable`/`disable` (`clock.ts`) are the primitives; no new clock primitive needed
  (Phase-2 F1 added `queue`/`killAll` already).
- **clock-context jigsUp** (cyclops eating the player, I-CYCLOPS) reuses the Phase-2
  M-FATAL extension (B3) — do NOT add a second death path.

---

## 7. Verification Strategy (Path B fence honored)

The thief is the most RNG-entangled actor in the game. Per `phase-2-combat.md §11.1`, the
golden master CANNOT anchor any RNG-driven thief outcome (wander target, steal/drop/rob
probabilities, encounter, flee) — a golden through thief activity would encode *our* RNG's
draws, not real Zork's. Split the net:

### 7.1 Golden / oracle — deterministic surfaces ONLY

- **Give-responses (CYCLOPS-FCN, ROBBER-FUNCTION):** `give lunch to cyclops`,
  `give water to cyclops`, `give garlic to cyclops`, `give <treasure> to thief`
  (engrossed message), `give <junk> to thief` ("places in his bag") — all fixed strings,
  no RNG. Oracle-diffable.
- **ODYSSEUS / ULYSSES:** the wall-break message + LIVING-ROOM/CYCLOPS-ROOM
  re-description (MAGIC-FLAG set) — deterministic. Plus "Wasn't he a sailor?" off-room.
- **Treasure-room reveal on thief death:** the "as the thief dies … treasures reappear:"
  list + "The chalice is now safe to take." — deterministic given a forced F-DEAD.
- **Cyclops state descriptions (CYCLOPS-ROOM-FCN M-LOOK):** each of the 5 CYCLOWRATH/flag
  branches, driven by setting CYCLOWRATH/CYCLOPS-FLAG/MAGIC-FLAG directly — deterministic.
- **THE 350 ACCEPTANCE TEST (this spec owns it):** a scripted canonical egg-solve —
  thief opens egg (EGG-SOLVE set, OPENBIT set, egg NOT broken by the player), canary
  wound for bauble, all treasures deposited — assert final `score === 350` and rank
  "Master Adventurer", and assert WON-FLAG fires exactly once. This is the regression
  lock on the 353→350 reconciliation. Seed any thief RNG so the deposit is deterministic
  (or inject the EGG-SOLVE deposit directly and assert the otvalFrob arithmetic
  independently of the wander RNG).

### 7.2 Seeded / injected-RNG structural tests — the thief interior

Inject a forced/scripted `Rng` (the Phase-2 forced-RNG harness, F4) so each behavior is
deterministic under test. Assert **structure and state transitions**, never exact rooms:

- **(TS-A) Wander** — advance I-THIEF N ticks with a seed; assert the thief only ever
  lands in `!SACREDBIT && RLANDBIT` rooms, never above-ground (SACREDBIT), and that it
  moves at most once per tick (the `ONCE`/`<AGAIN>` bound, §3.1).
- **(TS-B) Steal** — seed PROB to force/deny: STEAL-JUNK takes only TVALUE==0 TAKEBIT
  !SACREDBIT items (stiletto always; others at the zprob(10) gate); ROB takes only
  TVALUE>0 !INVISIBLE !SACREDBIT items at the 75% gate; stolen items go INVISIBLE into
  the thief. Force the gate true and false; assert membership, not which item.
- **(TS-C) Drop** — DROP-JUNK drops only TVALUE==0 items at zprob(30); never the
  stiletto/bag; cleared INVISIBLE on drop.
- **(TS-D) Deposit + egg-solve** — thief carrying the egg in TREASURE-ROOM with player
  elsewhere → DEPOSIT-BOOTY moves the egg there, sets EGG-SOLVE=true, FSET OPENBIT, egg
  NOT converted to BROKEN-EGG. (Directly feeds 7.1's acceptance test.)
- **(TS-E) Encounter tree** — seed each PROB rung of THIEF-VS-ADVENTURER
  (30 materialize / 90 stay / 30 leave / 70 idle / rob) and assert the branch taken +
  THIEF-HERE/INVISIBLE/FIGHTBIT state after. Cover first-appearance vs already-here.
- **(TS-F) WINNING? flee** — for each PS rung (>3, >0, ==0, VS>1, else) force the prob
  true/false and assert stay-vs-flee; assert flee sets INVISIBLE + clears FIGHTBIT +
  recovers stiletto, and that the flee branch is reached ONLY via I-THIEF (NM-10).
- **(TS-G) Treasure-room defense** — enter TREASURE-ROOM with I-THIEF live: thief moves
  here, FIGHTBIT set, non-CHALICE/THIEF children go INVISIBLE; CHALICE TAKE blocked.
- **(TS-H) ROBBER F-codes** — forced F-DEAD (stiletto dropped, booty deposited, I-THIEF
  disabled, treasure-room reveal), F-UNCONSCIOUS (I-THIEF disabled, LDESC unconscious),
  F-CONSCIOUS (I-THIEF re-enabled, LDESC conscious), F-BUSY (stiletto recovery), F-FIRST
  (prob(20) → FIGHTBIT). Inject the F-code directly.
- **(TS-I) THIEF-ENGROSSED** — `give <treasure> to thief` sets THIEF-ENGROSSED;
  next villainStrength call caps thief ATT at 2 then clears the flag (the cap itself is
  Phase-2-built — assert the *set-on-give* wiring fires it).
- **(TS-J) Cyclops wrath** — set CYCLOWRATH=1, advance I-CYCLOPS in CYCLOPS-ROOM 5 ticks:
  assert magnitude escalates by 1/tick, CYCLOMAD message indexed correctly, and at
  abs>5 jigsUp fires + I-CYCLOPS disables. Assert off-room → I-CYCLOPS disables.
- **(TS-K) Feed puzzle** — lunch (rage≥0) → CYCLOWRATH negative + I-CYCLOPS enabled;
  water (rage<0) → CYCLOPS-FLAG true + FIGHTBIT cleared; water when not thirsty →
  refusal; wake-from-sleep restores FIGHTBIT + magnitude.
- **(TS-L) I-THIEF / I-FIGHT order** — assert I-THIEF is registered AFTER I-FIGHT and that
  on a tick with a fighting thief, the blow resolves before the wander logic (§6). **Mandated
  done-criteria (review finding, 2026-06-10): TS-L must assert the ADVANCE-TIME iteration
  order of all clock demons — specifically that demons fire in `advance()` iteration order,
  NOT in registration order if those differ. Assert this invariant holds (a) at world start,
  (b) after a `restore()` call that reloads snapshot state, and (c) after a runtime
  `schedule()` that enqueues a new demon mid-game. All three cases must be explicitly named
  in the test's done-criteria.**

### 7.3 Suspicion discipline

The thief has no oracle and its bugs are silent-distributional (a swapped PROB rung or a
wrong skip-list shifts *behavior frequency*, not crashes). Green thief tests get more
suspicion than green cyclops tests (the cyclops is mostly deterministic). The mitigations
are the explicit branch-by-branch seeded tests above and element-by-element transcription
of THIEF-VS-ADVENTURER's probability tree — "tests pass" alone does not retire thief risk.

---

## 8. Build-Task DAG

Authored to drive a later staged build wave (foundation → parallel units → integrate).
Each task: deps, files (verdict), done-criteria. Tasks that **touch the combat seam** are
marked ⚙.

### Wave 0 — Foundation (parallel)

- **F1 — Thief/cyclops globals + flags.** NEW game-state: `THIEF-HERE`,
  `THIEF-ENGROSSED`, `EGG-SOLVE`, `CYCLOWRATH`, `SING-SONG` (plain), `CYCLOPS-FLAG`,
  `MAGIC-FLAG` (FlagStore keys); ROBBER-C-DESC/ROBBER-U-DESC string constants + mutable
  thief LDESC field. Deps: none. Done: all init to ZIL values (`CYCLOWRATH=0`, rest
  `false`/`<>`); FlagStore round-trips MAGIC-FLAG/CYCLOPS-FLAG; **assert LUCKY=true at
  construction** (Phase-2 F2 — guards every thief two-arg PROB; if Phase-2 didn't land it,
  this task adds it). **SING-SONG reconciliation mandate (review finding, 2026-06-10):** F1
  MUST reconcile with the EXISTING module-level `singSong` in
  `src/actions/above-ground.ts:55` (and the `resetSingSong` wiring in `session.ts`) — wire
  into it or migrate it in one move; do NOT create a parallel `SING-SONG` game-state global
  (two sources of truth breaks the bauble/350 chain). Name the resolution in the done-criteria:
  either "`singSong` at `above-ground.ts:55` IS the canonical field, F1 wires into it" or
  "`singSong` migrated to game-state in F1, `above-ground.ts:55` + `session.ts` updated in
  the same commit."

### Wave 1 — Thief helpers (deps: F1; ⚙ shares Actor/VillainEntry with the engine)

- **T1 — Booty/steal helpers.** NEW `thief.ts`: ROB, ROB-MAZE, STEAL-JUNK, DROP-JUNK,
  DEPOSIT-BOOTY (incl. the EGG-SOLVE hook), HACK-TREASURES, RECOVER-STILETTO, MOVE-ALL,
  stoleLight?, WINNING?. Deps: F1. Done: TS-B/C/D/F structural tests; DEPOSIT-BOOTY egg
  branch sets EGG-SOLVE+OPENBIT without breaking the egg; skip-lists (STILETTO/LARGE-BAG)
  honored; two-arg PROBs confirmed routed through zprob.

### Wave 2 — Thief actor (deps: T1; ⚙ ROBBER-FUNCTION is the THIEF VillainEntry callback)

- **T2 ⚙ — THIEF-VS-ADVENTURER + I-THIEF demon.** NEW: the encounter tree (§3.2) and the
  per-turn demon (§3.1) with the bounded `<AGAIN>` re-entry. Deps: T1. Done: TS-A wander
  bounds; TS-E encounter branches; demon enabled at world start; ≤2 passes/tick. **The
  ≤2-pass bound MUST be enforced structurally in the loop code itself (a hard counter or
  loop-guard in the implementation), not only by a test — a test alone does not satisfy
  OQ-1's ratified condition (2026-06-10).**
- **T3 ⚙ — ROBBER-FUNCTION (F-codes + verb dispatch).** NEW: §3.5 — all five F-codes +
  the give/throw/examine/take verb branches incl. THIEF-ENGROSSED set-on-give. Register
  as the THIEF VillainEntry callback AND the THIEF object-action. Deps: T1. Done: TS-H all
  five F-codes; TS-I engrossed set-on-give fires the (Phase-2) cap; give-treasure /
  give-junk give-responses match fixed strings (golden-diffable).
- **T4 — TREASURE-ROOM-FCN + THIEF-IN-TREASURE + CHALICE-FCN + STILETTO/LARGE-BAG.**
  NEW: §3.6, §3.7. Register all in `ACTIONS`. Deps: T1. Done: TS-G defense; treasure-room
  reveal list (golden); chalice TAKE block; stiletto/bag verb messages.

### Wave 3 — Cyclops (parallel with Wave 1–2; deps: F1)

- **C1 — CYCLOPS-FCN + CYCLOPS-ROOM-FCN.** NEW `cyclops.ts`: §4.1, §4.5 — dispatch +
  M-LOOK state branches + M-ENTER wrath enable. Register in `ACTIONS`. Deps: F1. Done:
  give lunch/water/garlic responses (golden); 5 M-LOOK state branches (golden); sleeping
  wake on ALARM/KICK/ATTACK/BURN/MUNG.
- **C2 ⚙ — I-CYCLOPS wrath timer.** NEW: §4.2 — on-demand demon; abs>5 → clock-context
  jigsUp (reuse Phase-2 M-FATAL B3); CYCLOMAD verbatim. Deps: F1, C1. Done: TS-J escalate
  + eat-at-6 + off-room disable.
- **C3 — V-ODYSSEUS + MAGIC-FLAG.** Port V-ODYSSEUS (`gverbs.zil:945` — confirm
  present-or-NEW in the verb table) + ODYSSEUS/ULYSSES syntax; MAGIC-FLAG FlagStore key
  drives the (data-driven) wall/door exits. Deps: F1, C1. Done: wall-break message +
  re-descriptions (golden); "Wasn't he a sailor?" off-room; MAGIC-FLAG opens both exits.

### Wave 4 — Integration + score reconciliation

- **I1 ⚙ — Wire demons + registry.** Schedule I-THIEF (AFTER I-FIGHT — §6) and the
  I-CYCLOPS enable hooks; merge `thief.ts`/`cyclops.ts` into `registry.ts` ACTIONS. Deps:
  T2, T3, T4, C2, C3. Done: TS-L demon order asserted (including the ADVANCE-TIME iteration
  order mandate — see TS-L); registry resolves all new routine names; full suite green.
  Note: I-SWORD is already present (phase-2 hotfix H3); confirm it is scheduled and appears
  in the `advance()` iteration order when verifying TS-L.
- **R1 — 350-point acceptance test + reconciliation lock.** The canonical egg-solve
  acceptance test (§7.1) — `score === 350`, rank "Master Adventurer", WON-FLAG once;
  plus an independent otvalFrob unit assertion that a broken-egg deposit totals 350 and an
  intact-egg deposit would total 353 (documenting the swap). Deps: I1, T1 (DEPOSIT-BOOTY).
  Done: acceptance test green; reconciliation documented in-test. **otvalFrob faithfulness
  mandate (OQ-2 ratification, 2026-06-10):** R1 MUST also port `otvalFrob` to be faithful
  to ZIL OTVAL-FROB — the original discards the recursive result (nested container TVALUEs
  do NOT sum). Concretely: depositing the egg (TVALUE 5) that contains the canary (TVALUE 4)
  must score +5, not +9. Include a dfrotz-anchored test asserting egg+canary deposit = +5
  (matching dfrotz). The exact-350 acceptance test arithmetic must be derived under this
  faithful non-recursive model. R1 is not done until both the structural test (non-recursive
  behavior) and the acceptance test (total 350 under the faithful model) are green.

### Wave 5 — Verification consolidation

- **V1 — Thief/cyclops NM + structural suite.** Consolidate TS-A…TS-L; add a
  thief-flee-only-in-I-THIEF guard (NM-10 re-asserted at the activation layer). Deps: all.
- **V2 — Golden deterministic-surface extensions.** Corpus additions: give-responses,
  ODYSSEUS, treasure-room reveal, cyclops M-LOOK states, the egg-solve score line. Deps:
  I1, R1. Done: golden stays byte-identical except the deliberately-added thief/cyclops
  surfaces; full suite green; faithfulness audit over the thief/cyclops surface.

> **Sequencing note for the wave author:** the combat seam (⚙) tasks must compose with the
> Phase-2 branch's final landed interfaces — confirm the THIEF VillainEntry, I-FIGHT
> registration, and clock-context jigsUp signatures against the merged combat branch
> (not against this spec's summary) before T3/C2/I1 build. If Phase-2's branch renamed the
> VillainEntry callback field or the F-code constants, T3/C2 adapt to the landed names.

---

## 9. Open Questions for Sign-off

1. **OQ-1 — `<AGAIN>` re-entry bound.** I-THIEF's ZIL `<AGAIN>` re-runs the demon once in
   the thief's new room, with the `ONCE` local preventing a third pass. Recommendation:
   port as a bounded loop (≤2 passes), NOT a recursive demon re-dispatch — the clock
   demon contract fires once per `advance()` and re-entry must not re-enter the clock.
   Confirm this is acceptable (it changes nothing observable; it is an implementation
   shape decision that a reviewer should bless because it is the one place the port
   deviates structurally from the ZIL control flow).
   **RATIFIED (2026-06-10):** the ≤2-pass bounded loop is APPROVED. The pass bound MUST
   be asserted structurally in the loop — a hard counter/guard in the code itself, not
   only by a test. See T2 done-criteria below.

2. **OQ-2 — The 350 reconciliation as behavior, not data.** The spec asserts EGG TVALUE
   stays 5 in the data and the 353→350 fix is that the *canonical reachable path* deposits
   the broken egg (TVALUE 2). Confirm this matches your mental model — the alternative
   (editing EGG TVALUE to 2) would be unfaithful (the intact egg genuinely IS worth 5 if
   deposited intact, which is reachable only by an unusual play and correctly totals 353).
   The acceptance test (R1) locks the canonical 350; do we ALSO want a documented test
   asserting the intact-egg-deposit edge case totals 353 (proving it's a path property,
   not a bug)? Recommendation: yes (R1 includes it).
   **RATIFIED (2026-06-10):** the 353→350 reconciliation is a BEHAVIOR property — the
   canonical thief path deposits the broken egg (TVALUE 2); EGG data stays 5. R1's
   acceptance test ALSO covers the intact-egg-deposit edge case (deposits intact egg →
   total 353, proving it's a path property). ADDITIONALLY: `otvalFrob` must be made
   FAITHFUL to ZIL OTVAL-FROB — the original DISCARDS the recursive result (nested
   container TVALUEs do NOT sum; egg+canary deposit = +5 in dfrotz, not +9). The current
   port sums nested TVALUEs; this spec's scoring surface must include a task (extend R1 or
   add a sub-task) to reproduce the original non-recursive behavior with a dfrotz-anchored
   test, and R1's exact-350 arithmetic must be derived under the faithful non-recursive
   model. See R1 done-criteria below.

3. **OQ-3 — I-SWORD scope.** The sword-glow demon (`:3851`) reacts to nearby actors
   (INFESTED? scans for ACTORBIT). Activating the thief/cyclops makes more rooms
   "infested," so I-SWORD's glow becomes observable in more places. It is currently out of
   scope (Phase-2 listed I-SWORD as referenced-but-not-pre-registered). Confirm: leave
   I-SWORD out (the glow is cosmetic and its absence is not a faithfulness regression for
   *this* phase), or pull it in as a small C-wave task? Recommendation: leave out; file as
   a Phase-3b nicety unless you want it.
   **RATIFIED (2026-06-10):** RESOLVED — I-SWORD is being built NOW in the phase-2 hotfix
   H3 (registered clock entry, glow transitions, KILL-INTERRUPTS list updated). This OQ is
   closed. Task language that assumed I-SWORD absent has been updated throughout.

4. **OQ-4 — V-ODYSSEUS present or NEW?** I could not confirm from the pinned checkout
   whether the engine's verb table already carries V-ODYSSEUS (the ZIL routine exists at
   `gverbs.zil:945`; the engine's verb registry was not exhaustively read). C3's
   done-criteria treats it as confirm-or-create. Not a sign-off blocker — flagging so the
   wave author verifies against the merged branch rather than assuming.
   **RATIFIED (2026-06-10):** ratified as build-time check — the wave author verifies
   V-ODYSSEUS present-or-NEW against the merged branch (including the phase-2 hotfix H3
   branch) before building C3.
