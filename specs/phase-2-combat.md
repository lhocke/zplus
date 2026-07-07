# Phase 2 — Combat, Death, Scoring & Endgame

**Status:** RATIFIED 2026-06-09. Implementation-ready, locked.
**Date:** 2026-06-08; ratified 2026-06-09
**Owner:** Dylan
**Repo:** lhocke/zork-workflow (private)

> Phase 2 of the phased-playtest release. Builds the faithful Zork I combat engine
> and the full death / scoring-reconcile / endgame layer behind it, then wires the
> **troll** as the one live encounter — removing the Phase-1 troll-sign wall. Thief
> and cyclops behavior are deferred, but the engine is built complete so later phases
> only wire activation. RNG follows **Path B** (controlled Mulberry32, no dfrotz
> byte-parity), which reshapes verification: combat logic is proven against the ZIL
> fight tables with seeded/injected RNG, and the golden master anchors only the
> deterministic surfaces.

---

## 1. Goal & Scope

### What Phase 2 proves

Combat is the last logic wall in front of deep playtesting: the candles, the
matchbook, the temple treasures, and the whole eastern map sit on the far side of
the troll. Phase 1 stopped gracefully at a hand-lettered sign; Phase 2 replaces that
sign with the real fight and the death/resurrection/scoring machinery it depends on.

Concretely, Phase 2 delivers:

1. **The generic combat engine** — faithful to `1actions.zil:3232–4135`: strength
   formulas, the six raw DEF tables + their sliding-window resolution scheme, both
   blow directions (HERO-BLOW / VILLAIN-BLOW), the DO-FIGHT knock-out loop, the
   I-FIGHT demon + wake mechanic, I-CURE healing, all four MELEE message tables, and
   the PROB/ZPROB probability layer. Built **complete** (thief + cyclops tables and
   callbacks included) even though only the troll is wired live.
2. **The full death/endgame layer** — JIGS-UP with ghost/Hades resurrection,
   RANDOMIZE-OBJECTS, KILL-INTERRUPTS, DEAD-FUNCTION ghost dispatch, the scoring
   RECONCILE (most landed — see §2), WON-FLAG world effects, STONE-BARROW endgame,
   and FINISH.
3. **The troll wired live** — TROLL-FCN F-code callbacks, TROLL-FLAG double-duty,
   TROLL-ROOM exit gating, and the **removal of the Phase-1 troll-sign override**
   (the existing guard test flips this requirement into a hard gate — §10, §11).

### In scope

- The generic combat engine (all six DEF tables, all resolution windows, both blow
  directions, DO-FIGHT, I-FIGHT, I-CURE, AWAKEN, all four MELEE tables, PROB/ZPROB).
- Full strength model: FIGHT-STRENGTH (live-score-scaled), VILLAIN-STRENGTH
  (best-weapon advantage + THIEF-ENGROSSED cap — the engine carries both even though
  the thief is deferred).
- Death/resurrection: JIGS-UP, DEATHS counter (max 2), ghost/Hades vs FOREST-1,
  RANDOMIZE-OBJECTS, KILL-INTERRUPTS, DEAD-FUNCTION.
- Scoring reconcile: only the **deltas** the existing `scoring.ts` does not yet
  cover (§2) — the two-component model, ranks, otvalFrob, and WON-FLAG trigger are
  already built.
- WON-FLAG world effects (MAP reveal, WEST-OF-HOUSE re-description, whisper),
  STONE-BARROW endgame + FINISH.
- Troll wired live: TROLL-FCN callbacks, TROLL-FLAG, exit gating, **G1 = remove the
  Phase-1 override**.
- Clock primitives: a generic re-arm (`queue`) for I-CURE and a batch-disable
  (`killAll`) for KILL-INTERRUPTS.

### Explicitly deferred (engine built, behavior not wired)

- **Thief activation** — I-THIEF interrupt, THIEF-VS-ADVENTURER, WINNING? flee,
  THIEF-ENGROSSED set-on-give, DEPOSIT-BOOTY, stealing. The THIEF-MELEE table,
  ROBBER-FUNCTION F-code callbacks, the V-BEST=KNIFE advantage, and the
  THIEF-ENGROSSED **cap** in VILLAIN-STRENGTH are all transcribed/built so the engine
  is complete; only the thief's live wiring (the demon, the flee/steal/give behavior)
  is out of scope. A later phase wires behavior against the already-present engine.
- **Cyclops activation** — CYCLOWRATH wrath timer (I-CYCLOPS), the lunch/water
  puzzle, sleeping/waking. The CYCLOPS-MELEE table and CYCLOPS-FCN (all F-codes fall
  through to nil) are built; cyclops is never processed by DO-FIGHT (loop excludes
  index 3) and is unkillable by normal melee (DEF=10000) — both are faithful and
  require no wiring this phase.
- **Save slots / autosave** — still later (Phase 1 deferral stands).
- **dfrotz RNG byte-parity** — Path B (decided 2026-06-07). `FrotzRng` stays in the
  tree as the foundation for an eventual Path A once per-turn RNG consumers (the
  thief, chiefly) are implemented and draw-order can be aligned. Not pursued here.

### Non-goals

- No re-specification of the scoring rewrite — it is largely done (§2). This phase
  specs only the remaining scoring deltas and their wiring.
- No engine-wide Mulberry32 → FrotzRng flip; the 218-command golden stays
  byte-identical except where combat removal of the troll sign deliberately changes
  the troll-attack path (§11 reconciles this against the golden).

---

## 2. Current State Reconciliation

Measured against `src/` on 2026-06-08. The 2026-05-30 reconciliation plan's baseline
is **stale** — several pieces it lists as absent are now present. Trust this section.

Legend: **NEW** = create; **EXTEND** = add fields/methods, keep existing; **REWRITE**
= replace body; **DONE** = already built, no work; **DELTA** = mostly built, only the
listed gaps remain.

### Scoring — DONE (deltas only)

`src/engine/scoring.ts` is **already reworked** and exercised by
`tests/engine/td3-1-scoring-spine.test.ts` and `td3-2-ranks-vscore.test.ts`. Present
and correct today:

- The **8-rank table** (`RANKS`): `{exact:350}` Master Adventurer; the rest exclusive
  `>` lower bounds (330/300/200/100/50/25); Beginner default. (scoring.ts:7–16)
- `_baseScore`, `_score`, `_wonFlag` + getters; `scoreUpd(delta)` (adds to both
  accumulators, then WON-FLAG 350 check); `add()` legacy alias.
- `scoreObj(obj)` (award VALUE once, then zero it).
- `otvalFrob(container)` — recursive TVALUE sum, with the non-double-count semantics
  (each container's TVALUE added by its parent loop) verified by test TD3-1-C/D.
- `recomputeTrophy(trophyCase)` — direct-assigns `score = baseScore + otvalFrob()`
  (no double-count), then the WON-FLAG check. Wired live: `above-ground.ts:155–160`
  fires it from LIVING-ROOM-FCN's M-END branch on TAKE / PUT-to-TROPHY-CASE.
- `checkWonFlag()` sets the `WON-FLAG` flag in the flag store.
- The M-END spine the old plan gated everything on is **live**: `M_END=6`
  (messages.ts:7) and `runActionChain`'s M-END call (game.ts:318) both exist.

**Remaining scoring DELTAs (the only scoring work this phase):**

1. **WON-FLAG *world effects*.** `checkWonFlag()` sets the boolean and the flag, but
   does NOT yet fire the side effects from `gverbs.zil:1854–1863`: clear
   `MAP.INVISIBLE` (reveal the ancient map in the trophy case), clear
   `WEST-OF-HOUSE.TOUCHBIT` (force re-description), and emit the whisper *"An almost
   inaudible voice whispers in your ear, \"Look to your treasures for the final
   secret.\""* These belong in the WON-FLAG trigger path (§9.1).
2. **The −10 death penalty is already applied** by `game.ts:620` (`scoreUpd(-10)`) —
   no scoring change needed; combat's death path routes through the same `jigsUp`.
3. **LIGHT-SHAFT +13** one-shot award: **WIRED** — `src/actions/coal-mine.ts` NO-OBJS
   handler, commit `240dc14`, 1652 tests green. No combat work needed.

No scoring rewrite. Treat scoring as a stable dependency combat reads per-blow.

### Death / resurrection — DELTA (skeleton present)

`game.ts` already carries `deaths`, `dead`, `alwaysLit`, `gameOver` state
(game.ts:77–81) and a **partial `jigsUp`** (game.ts:608–640) that handles: the
re-death "talented" guard, the death message + "You have died", the `scoreUpd(-10)`
penalty, the 3-strike `deaths >= 2 → suicidalManiac + gameOver`, the increment, and
the **simple FOREST-1 resurrection**. `tests/engine/f4-death-path.test.ts` covers
this via the grue path. Its own comment (game.ts:606–607) names what is **NOT yet
ported** — this is the death work this phase owns:

- **Ghost/Hades resurrection** — `SOUTH-TEMPLE` TOUCHBIT branch: `dead=true`,
  `trollFlag=true`, `alwaysLit=true`, install DEAD-FUNCTION, GOTO ENTRANCE-TO-HADES.
- **RANDOMIZE-OBJECTS** — lamp→LIVING-ROOM, coffin→EGYPT-ROOM, SWORD.TVALUE=0, seeded
  scatter. (NEW)
- **KILL-INTERRUPTS** — disable the 8 timer slots + extinguish MATCH. (NEW; needs the
  clock `killAll` primitive — §6.)
- **DEAD-FUNCTION** — the ghost verb-dispatch handler + PRAY-at-SOUTH-TEMPLE
  resurrection. (NEW)
- The **"Bad luck, huh?"** LUCKY=false branch, the vehicle-eject, and the **RFATAL
  short-circuit** (the killing turn must not continue chained commands / M-END).

**Decision (§14 OQ-2/OQ-3, RATIFIED):** lift the death machinery into a new
`src/engine/death.ts` (`jigsUp`, `randomizeObjects`, `killInterrupts`, `deadFunction`);
`game.ts`'s partial `jigsUp` is lifted there. I-FIGHT folds into `combat.ts`. The lift
must carry the `parser.clearContinuation()` / P-CONT dependency with it (see §9.1).

### Combat — NEW (genuinely unbuilt)

`src/engine/combat.ts`, `death.ts`, `i-fight.ts`, `endgame.ts` are all **absent**
(confirmed). The entire combat subsystem in §§3–8 is new code.

### Endgame — DELTA

The `WON-FLAG` exits to STONE-BARROW are data-driven (Phase-1 confirmed
`ifFlag:'WON-FLAG'` in `rooms.json`); `above-ground.ts:70` already reads `WON-FLAG`
for a room-description branch. STONE-BARROW-FCN endgame text + FINISH, and the
WON-FLAG world effects (above), are NEW.

### Clock — EXTEND

`src/engine/clock.ts` has `schedule` / `enable` / `disable` / `advance` / `snapshot`
/ `restore`, plus the demon convention (`turnsLeft < 0` fires every advance) that
**I-FIGHT** uses directly. It has the per-stage re-queue **inside** `FuelInterrupt`
(it rewrites `entry.turnsLeft` in `onFire`), but **no generic public re-arm
primitive** and **no batch disable**. Add:

- `queue(id, period, enabled)` (or `requeue(id, ticks)`) — generic re-arm so I-CURE
  can re-schedule itself every CURE-WAIT=30 turns from outside a bespoke class.
- `killAll(ids: string[])` — batch-disable for KILL-INTERRUPTS.

### Flags — EXTEND

`src/domain/flags.ts` has `Flag.Actor` (ACTORBIT) present (parser/PERFORM Wave A
landed). **Add** `Flag.Fight` (FIGHTBIT) and `Flag.Staggered` (STAGGERED). Do NOT
re-add `Flag.Actor`.

### Actor — EXTEND

`src/domain/actor.ts` is a bare `GameObject` subclass — **no `pStrength`**, no villain
metadata. Villain base strengths already live in `objects.json` as a `STRENGTH` prop
(CYCLOPS=10000 @ line 873, THIEF=5 @ 2146, TROLL=2 @ 2249), so the **base** value is
data; the mutable combat state and the per-villain metadata are not. Add:

- `pStrength: number` — mutable combat state; `0` healthy, negative = wounded /
  (when negated) unconscious, `-10000` = dead sentinel. Initialized from the
  `STRENGTH` prop at world load. Init value: `0` (not from STRENGTH; STRENGTH is the
  base for villains, not for the player/winner object — verified: `gglobals.zil:94`
  has no P-STRENGTH global; winner pStrength starts 0).
- Villain metadata **lives in a parallel `VillainEntry` record keyed by object id**
  (mirrors the ZIL VILLAINS LTABLE) — `vBest`, `vBestAdv`, `vProb`, `vMsgs`, and the
  F-code callback. **Only mutable `pStrength` goes on `Actor`.** Do NOT put villain
  metadata fields on Actor. (§14 OQ-1, RATIFIED — see D1.)

### RNG — DONE (Path B); EXTEND for zprob

`src/engine/rng.ts` is Mulberry32 with `next()` / `nextInt(n)` (returns `[0,n)`) and a
`prob(base)` method (`next()*100 < base`). `src/engine/frotz-rng.ts` exists (the
spike's `FrotzRng`) but is **not** used by combat — Path B. Map ZIL `RANDOM N` →
`rng.nextInt(N)`; the table roll is `rng.nextInt(9)` (a 0-based index into the
9-element window).

**EXTEND:** widen the `Rng` interface with `zprob(base, denom)` — draw form is
**CONTINUOUS `next()*denom < base`** (matching the existing `prob`), NOT `nextInt`.
Concretely: `zprob(base) -> lucky ? next()*100 < base : next()*300 < base`. Pin this
form in the spec and in tests. CB3 must confirm existing stubs / golden-RNG fixtures
still satisfy the widened interface (they only call `next`/`nextInt`/`prob`, so no
breakage expected, but verify explicitly). (§14, B5/B6 RATIFIED.)

### Messages — DONE

`M_END=6`, `M_BEG`, `M_ENTER`, `M_LOOK`, `M_FLASH`, `M_OBJDESC` all present
(messages.ts). The old plan's M-END cross-dependency is satisfied.

---

## 3. Combat Engine — Constants, Result Codes, Tables

Source spine: `1actions.zil:3232–4135`. All section/line refs below cite ZIL via the
combat-melee writeup (`docs/research/original/combat-melee.md`) and the TD-2 spec
(`docs/research/teardown/td2-combat-SPEC.md`).

### 3.1 Named constants (`1actions.zil:3236–3254`, :3323–3325)

```
// Villain callback (F-code) selectors
F_BUSY = 1   F_DEAD = 2   F_UNCONSCIOUS = 3   F_CONSCIOUS = 4   F_FIRST = 5

// Blow result codes
MISSED = 1   UNCONSCIOUS = 2   KILLED = 3   LIGHT_WOUND = 4
SERIOUS_WOUND = 5   STAGGER = 6   LOSE_WEAPON = 7   HESITATE = 8   SITTING_DUCK = 9

// Strength limits
STRENGTH_MAX = 7   STRENGTH_MIN = 2   CURE_WAIT = 30

// REMARK message-token selectors
F_WEP = 0   // print weapon DESC
F_DEF = 1   // print defender DESC
```

### 3.2 Raw outcome tables — EXACT, hand-transcribed (`1actions.zil:3258–3299`)

Six `(PURE)` tables, **67 elements total**. No extractor emits these — hand-transcribe
and verify element-by-element against ZIL (build task CB-1; near-miss NM-1). Values
are blow-result constants.

```
DEF1  (13): M M M M S S U U K K K K K
DEF2A (10): M M M M M S S L L U
DEF2B (12): M M M S S L L L U K K K
DEF3A (11): M M M M M S S L L SW SW
DEF3B (11): M M M S S L L L SW SW SW
DEF3C (10): M S S L L L L SW SW SW
```
(M=MISSED, S=STAGGER, U=UNCONSCIOUS, K=KILLED, L=LIGHT_WOUND, SW=SERIOUS_WOUND)

### 3.3 Resolution windows — the sliding-window scheme (TOP FAITHFULNESS RISK)

The ZIL declares three resolution tables as arrays of pointers, then `GO()`
(`1dungeon.zil:2644–2649`) patches each pointer to a `REST(TABLE, N)` view — a
9-element window starting at index `N` into the raw table. The roll is
**`window.table[window.offset + rng.nextInt(9)]`** — uniform over **exactly 9**
elements. **Never draw from the full raw table with a wider random** (NM-1: that
silently shifts every distribution).

Port form: each window is `{ table: readonly number[], offset: number }`.

**DEF1_RES** — `DEF == 1`, indexed `ATT-1` (ATT clamped to 3):

| ATT | window | distribution (verified by tool) |
|----:|--------|---------------------------------|
| 1 | `DEF1` @0  | 4M 2S 2U 1K |
| 2 | `DEF1` @2  | 2M 2S 2U 3K |
| 3 | `DEF1` @4  | 0M 2S 2U 5K |

**DEF2_RES** — `DEF == 2`, indexed `ATT-1` (ATT clamped to 4):

| ATT | window | distribution |
|----:|--------|--------------|
| 1 | `DEF2A` @0 | 5M 2S 2L |
| 2 | `DEF2B` @0 | 3M 2S 3L 1U |
| 3 | `DEF2B` @2 | 1M 2S 3L 1U 2K |
| 4 | `DEF2B` @3 | 0M 2S 3L 1U 3K |

**DEF3_RES** — `DEF >= 3`, indexed `net+2` where `net = clamp(ATT−DEF, −2, +2)`:

| net | window | distribution |
|----:|--------|--------------|
| −2 | `DEF3A` @0 | 5M 2S 2L |
| −1 | `DEF3A` @2 | 3M 2S 2L 2SW |
|  0 | `DEF3B` @0 | 3M 2S 3L 1SW |
| +1 | `DEF3B` @2 | 1M 2S 3L 3SW |
| +2 | `DEF3C` @0 | 1M 2S 4L 2SW |

> **SOURCE CONFLICT — resolve at build (OQ-5).** The two source docs disagree on the
> DEF window offsets. `td2-combat-SPEC.md §3` (offsets above: DEF1 @0/2/4, DEF2B
> @0/2/3, DEF3A @0/2, DEF3B @0/2) is **internally consistent** — its stated
> distributions match the windows exactly (re-verified by tool, 2026-06-08).
> `combat-melee.md §5b` instead lists DEF1 windows at @0/1/2 and a 4-row DEF2 with
> different distributions. The table above follows the TD-2 scheme. **CB-1 must
> re-derive the exact `REST(...)` offsets directly from `1dungeon.zil:2644–2649` and
> `1actions.zil:3301–3317`** and pin whichever the ZIL source actually encodes; do
> not trust either writeup over the ZIL. The distribution column is the acceptance
> oracle (CB-2 chi-square).

### 3.4 Table-selection algorithm (`1actions.zil:3429–3440`, :3510–3521)

Identical in both blow directions:

```
selectWindow(ATT, DEF):
  if DEF == 1:  if ATT > 2: ATT = 3;  return DEF1_RES[ATT-1]      // 0..2
  if DEF == 2:  if ATT > 3: ATT = 4;  return DEF2_RES[ATT-1]      // 0..3
  else (DEF>=3): net = ATT - DEF; if net < -1: net=-2; if net > 1: net=2
                 return DEF3_RES[net+2]                            // 0..4
roll = rng.nextInt(9)               // [0,8]
res  = window.table[window.offset + roll]
```

**ATT/DEF are role-swapped by direction (NM-2):**

| Routine | ATT (attacker str) | DEF (defender str) |
|---------|--------------------|--------------------|
| VILLAIN-BLOW | villain `pStrength` | player FIGHT-STRENGTH |
| HERO-BLOW    | player FIGHT-STRENGTH | villain `pStrength` |

---

## 4. Strength Model

### 4.1 FIGHT-STRENGTH — player (`1actions.zil:3375–3381`)

```
base = STRENGTH_MIN + floor(SCORE / floor(SCORE_MAX / (STRENGTH_MAX - STRENGTH_MIN)))
     = 2 + floor(SCORE / 70)        // integer division, SCORE_MAX = 350
fightStrength(adjust = true) = adjust ? base + winner.pStrength : base
```

| SCORE | 0–69 | 70–139 | 140–209 | 210–279 | 280–349 | 350 |
|-------|:----:|:------:|:-------:|:-------:|:-------:|:---:|
| base  | 2 | 3 | 4 | 5 | 6 | 7 |

Reads **live SCORE** every blow (the scoring → combat dependency; §2 scoring is the
source). The **adjusted** value (with `pStrength`) is the alive/dead check and the DEF
tier; the **unadjusted** value is `OD`, used only for the WINNER-RESULT wound delta
(NM-3 — they must be two distinct calls).

### 4.2 VILLAIN-STRENGTH (`1actions.zil:3383–3397`)

```
od = villain.pStrength                       // Troll 2, Thief 5, Cyclops 10000
if od < 0: return od                         // unconscious — return negative as-is
if villain is THIEF and thiefEngrossed:      // engine carries this though thief deferred
   if od > 2: od = 2
   thiefEngrossed = false
if prsi != null and isWeapon(prsi) and prsi == villain.vBest:
   od = max(1, od - villain.vBestAdv)        // best-weapon advantage
return od
```

VILLAINS metadata (`1actions.zil:3791–3804`): Troll `{vBest:SWORD, vBestAdv:1,
vProb:0, vMsgs:TROLL_MELEE}`; Thief `{vBest:KNIFE, vBestAdv:1, vProb:0,
vMsgs:THIEF_MELEE}`; Cyclops `{vBest:<none>, vBestAdv:0, vProb:0,
vMsgs:CYCLOPS_MELEE}`. FIND-WEAPON's weapon set is exactly
`[STILETTO, AXE, SWORD, KNIFE, RUSTY-KNIFE]` by **containment** (FIRST?/NEXT?), NOT by
WEAPONBIT (`1actions.zil:3401–3409`).

---

## 5. PROB / ZPROB + the LUCKY global (`gmacros.zil:115–122`)

```
prob(base)  -> next()*100 < base                    // one-arg, LUCKY-insensitive (existing)
zprob(base) -> lucky ? next()*100 < base            // two-arg form, CONTINUOUS draw
                     : next()*300 < base            // mirror-munged: ~1/3 as likely
```

`LUCKY` inits `true` (`1actions.zil:969`); set `false` only by munging the mirror
(`1actions.zil:1009`), never restored. **Bootstrap must init `LUCKY=true` explicitly**
(otherwise `zprob` silently runs at the unlucky ~1/3 rate from the start — B4, RATIFIED).
Fits cleanest in **F2 (bootstrap/flags init wave)** alongside other global inits.
`rng.prob()` already implements the one-arg form (golden-preserving) — **add `zprob`**
to the RNG interface (widened interface; draw form: CONTINUOUS `next()*denom < base`, NOT
nextInt — B5/B6 RATIFIED) for the two-arg sites.

Usage map: VILLAIN-BLOW LOSE-WEAPON → **ZPROB(25)** (the ZIL `PROB 25 <COND(.HERO? 10)
(T 50)>` reduces to a two-arg call; `.HERO?` is always falsy → ZPROB, NM-5).
HERO-BLOW LOSE-WEAPON → **one-arg `prob(25)`** (always 25%). TROLL F-BUSY axe recovery
→ **ZPROB(75)**. TROLL F-FIRST → `prob(33)`. THIEF F-FIRST → `prob(20)`. V-PROB wake →
`prob(V_PROB)`. WINNING? (thief flee) → all one-arg.

> **PORT semantics note:** ZIL `RANDOM N` is 1-based `[1,N]`; the engine's
> `rng.nextInt(100)` is `[0,99]`, so `25 > nextInt(100)` succeeds for 0..24 = exactly
> 25% (vs ZIL's strict 24%). Use the 0-based form consistently; the 1/100 difference
> is not oracle-visible under Path B (no byte-parity required).

---

## 6. Blow Resolution & State

### 6.1 VILLAIN-BLOW (villain attacks player) — `1actions.zil:3413–3474`

Called from DO-FIGHT as `villainBlow(oo, out?)`.

```
1. FCLEAR winner STAGGERED  (unconditional reset)
2. if villain STAGGERED: "The X slowly regains his feet."; clear; RTRUE (lose turn)
3. ATT = villainStrength(oo); DEF = fightStrength(true); OD = fightStrength(false)
   DWEAPON = findWeapon(winner)
4. if fightStrength() <= 0: RTRUE                    // already dying; skip
5. if DEF < 0: RES = KILLED                          // player unconscious -> instant kill
   else:
     RES = selectWindow(ATT, DEF).roll
     if out?:  RES = (RES == STAGGER) ? HESITATE : SITTING_DUCK
     if RES == STAGGER and DWEAPON:  if zprob(25): RES = LOSE_WEAPON   // two-arg, NM-5
     print REMARK(randomElement(villain.vMsgs[RES-1]), winner, DWEAPON)
6. apply (player state):
     MISSED|HESITATE: none
     UNCONSCIOUS: NO pStrength change here (DO-FIGHT loop handles it — NM-8)
     KILLED|SITTING_DUCK: DEF = 0
     LIGHT_WOUND:  DEF = max(0, DEF-1); if LOAD_ALLOWED > 50: LOAD_ALLOWED -= 10
     SERIOUS_WOUND:DEF = max(0, DEF-2); if LOAD_ALLOWED > 50: LOAD_ALLOWED -= 20
     STAGGER: FSET winner STAGGERED
     LOSE_WEAPON: MOVE DWEAPON here; if player has another weapon: "Fortunately, you still have a X."
7. winnerResult(DEF, RES, OD)
```

**Wound→encumbrance coupling is implemented faithfully this phase, NOT stubbed** (B1
RATIFIED). `LOAD-ALLOWED` and `LOAD-MAX` are globals (`gglobals.zil:94,92`, both init
`100`); weight checks in `verbTake` currently do NOT consult LOAD-ALLOWED (verified:
`src/engine/verbs/index.ts:328–354` has no capacity check). **CB5 must add the
LOAD-ALLOWED consultation to the take path** alongside wound application — specifically,
the check `if LOAD-ALLOWED > 50` before reducing on wound (§6.1 above) and the
LOAD-ALLOWED restore in I-CURE (§7.3). F3 must also init `LOAD-ALLOWED = 100` and
`LOAD-MAX = 100` in game state (parallel to the ZIL globals).

### 6.2 WINNER-RESULT (`1actions.zil:3552–3564`)

```
winner.pStrength = (DEF == 0) ? -10000 : (DEF - OD)          // -10000 dead sentinel, NM-4
if DEF - OD < 0:  clock.queue(I_CURE, CURE_WAIT, enabled=true)
if fightStrength() <= 0:
   winner.pStrength = 1 - fightStrength(false)               // nudge adjusted FS to exactly 1
   jigsUp("It appears that that last blow was too much for you. ... you are dead.")
```

The `-10000` sentinel drives FIGHT-STRENGTH deeply negative → the `<= 0` check →
`jigsUp` (the TD-2/TD-3 seam; test the full chain killing-blow → pStrength=−10000 →
FS<0 → jigsUp, not each side alone).

### 6.3 HERO-BLOW (player attacks villain) — `1actions.zil:3476–3548`

Entry from V-ATTACK.

```
1. find villain's VILLAINS entry where V-VILLAIN == PRSO
2. FSET PRSO FIGHTBIT
3. if winner STAGGERED: "You are still recovering ... ineffective."; clear; RTRUE
4. ATT = max(1, fightStrength(true))
5. OD = DEF = villainStrength(oo)                            // may be negative if KO'd
6. if DEF == 0: if PRSO == winner: jigsUp(suicide) else "Attacking the X is pointless."; RTRUE
7. DWEAPON = findWeapon(villain)
8. if !DWEAPON or DEF < 0: "The unconscious/unarmed X cannot defend himself: He dies."; RES = KILLED
   else:
     RES = selectWindow(ATT, DEF).roll                       // OUT? always false here
     if RES == STAGGER and DWEAPON: if prob(25): RES = LOSE_WEAPON   // one-arg, NM-5
     ASSERT RES <= LOSE_WEAPON                                // HERO_MELEE has only 7 slots, NM-6
     print REMARK(randomElement(HERO_MELEE[RES-1]), PRSO, PRSI)
9. apply (villain state):
     UNCONSCIOUS: DEF = -DEF                                  // negate = KO flag (not death)
     KILLED|SITTING_DUCK: DEF = 0
     LIGHT_WOUND: DEF=max(0,DEF-1); SERIOUS_WOUND: DEF=max(0,DEF-2)
     STAGGER: FSET PRSO STAGGERED
     LOSE_WEAPON: FCLEAR DWEAPON NDESC; FSET DWEAPON WEAPONBIT; MOVE DWEAPON here; THIS-IS-IT
10. villainResult(PRSO, DEF, RES)
```

### 6.4 VILLAIN-RESULT (`1actions.zil:3566–3580`)

```
villain.pStrength = DEF
if DEF == 0:
   FCLEAR villain FIGHTBIT
   "Almost as soon as the X breathes his last breath ... the carcass has disappeared."
   removeCarefully(villain); apply(villain.action, F_DEAD)
elif RES == UNCONSCIOUS:
   apply(villain.action, F_UNCONSCIOUS)
```

### 6.5 DO-FIGHT knock-out loop (`1actions.zil:3331–3357`)

```
out = 0
for cnt = 1; cnt < LEN; cnt++:                                // LEN = VILLAINS[0] = 3
   oo = villains[cnt]                                         // cnt=1 Troll, cnt=2 Thief; cnt=3 EXITS
   if !FIGHTBIT(oo.villain): continue                         //  -> Cyclops (idx 3) NEVER processed, NM-7
   if apply(oo.villain.action, F_BUSY): continue              // recovered weapon -> skip blow
   res = villainBlow(oo, out > 0)
   if res == UNCONSCIOUS: out = 1 + rng.nextInt(3)            // 1..3 SITTING_DUCK blows
   if out > 0: out -= 1
```

When `out > 0`, all blows transform via the `out?` branch in §6.1 (STAGGER→HESITATE,
else→SITTING_DUCK). This is loop-level, not per-villain.

---

## 7. Demons & Healing

### 7.1 I-FIGHT (`1actions.zil:3810–3841`) — per-turn demon (turnsLeft = −1)

```
if DEAD: return
fight? = false
for each villain oo (cnt = 1..LEN-1):
   if oo.villain IN here and not INVISIBLE:
      if THIEF and thiefEngrossed: thiefEngrossed = false        // one-time reset
      elif oo.villain.pStrength < 0:                              // unconscious -> wake check
         p = oo.vProb
         if p != 0 and prob(p): oo.vProb = 0; awaken(oo.villain)  // NM-9: guard p != 0
         else: oo.vProb = p + 25                                  // 0->25->50->75->100
      elif FIGHTBIT(oo.villain) or apply(oo.villain.action, F_FIRST): fight? = true
   else (not here): clear STAGGERED+FIGHTBIT; if THIEF: thiefEngrossed=false; awaken(oo.villain)
if fight?: doFight(LEN)
```

Registered as a clock demon (`turnsLeft = -1`, C-ENABLED, re-checks DEAD each tick) —
the existing clock demon convention (clock.ts:95–99) covers this directly.

**I-FIGHT / clock-context death (B3 RATIFIED):** I-FIGHT runs inside the clock advance
(not inside a verb handler), so it cannot call `ctx.fatal()` directly. Combat death
reuses the existing `ctx.fatal()` / M-FATAL path, EXTENDED: `jigsUp` must abort the
current turn when called from clock context. Implementation: `jigsUp` (in `death.ts`)
signals the M-FATAL abort through whatever channel the engine already supports (e.g.
throwing a typed exception or setting a shared `fatalPending` flag that `advance()`
checks on return). **Do NOT implement a separate death path** — extend M-FATAL so
the I-FIGHT→doFight→villainBlow→winnerResult→jigsUp chain terminates the turn cleanly.
Wording in CB8/DT1 must reflect this. (Affects §9.1/DT1 wording.)

### 7.2 AWAKEN (`1actions.zil:3843–3847`)

```
if villain.pStrength < 0: villain.pStrength = -villain.pStrength; apply(villain.action, F_CONSCIOUS)
```

### 7.3 I-CURE (`1actions.zil:3593–3602`) — queued, CURE_WAIT = 30

```
s = winner.pStrength
if s > 0: s = 0; winner.pStrength = 0
if s < 0: s += 1; winner.pStrength = s                          // heal 1 point/tick
if s < 0:  if LOAD_ALLOWED < LOAD_MAX: LOAD_ALLOWED += 10; clock.queue(I_CURE, CURE_WAIT, true)
else:      LOAD_ALLOWED = LOAD_MAX; clock.disable(I_CURE)
```

Needs the clock `queue` re-arm primitive (§6 / §2 clock DELTA).

---

## 8. REMARK Message System & the Four MELEE Tables

### 8.1 REMARK / RANDOM-ELEMENT (`1actions.zil:3363–3370`)

```
remark(ltable, defender, weapon):
   for token in ltable:
      if token == F_WEP: print(weapon ? weapon.desc : "")
      elif token == F_DEF: print(defender.desc)
      else: print(token)                                       // string literal
randomElement(frob): return frob[1 + rng.nextInt(frob[0])]     // length-prefixed LTABLE
```

### 8.2 The four MELEE tables (`1actions.zil:3611–3788`) — EXACT transcription (CB build task)

Hand-transcribe all four, **96 messages total** (verified). Each is an array indexed
by `RES-1`; each slot is an array of variant LTABLEs (string literals + `F_WEP`/`F_DEF`
tokens). Slot/variant counts to verify on transcription:

| Table (source) | slots | variants per slot (MISSED…SITTING_DUCK) | total |
|----------------|:-----:|------------------------------------------|:-----:|
| HERO_MELEE (`:3611`)   | **7** | 6,5,3,4,4,5,2 (no HESITATE/SITTING_DUCK — NM-6) | 29 |
| CYCLOPS_MELEE (`:3654`)| 9 | 2,1,1,2,2,2,2,1,1 | 14 |
| TROLL_MELEE (`:3689`)  | 9 | 4,1,3,4,3,4,3,2,1 | 25 |
| THIEF_MELEE (`:3735`)  | 9 | 4,2,3,4,4,3,3,3,2 | 28 |

HERO_MELEE has **only 7 slots** — HERO-BLOW must never index 7/8 (guaranteed because
OUT? is always false there; assert it anyway — NM-6). CYCLOPS_MELEE / THIEF_MELEE are
transcribed for engine-completeness though their villains are deferred.

---

## 9. Death, Resurrection & Endgame

### 9.1 JIGS-UP — lift from `game.ts` into `death.ts`; extend (`1actions.zil:4046–4099`)

**Lift** `game.ts:608–640` into `src/engine/death.ts` (D2/OQ-2/OQ-3, RATIFIED). The
lifted function must carry the `parser.clearContinuation()` / P-CONT dependency (the
`FCLEAR TRAP-DOOR TOUCHBIT; pCont = null` step below requires clearing parser continuation
state — verify the exact call site in `game.ts` and replicate in `death.ts`). The
Hades-vs-forest branch reads `visited.has('SOUTH-TEMPLE')` — the SAME visited-set check
used in PRAY resurrection (D4, RATIFIED; ZIL: TOUCHBIT on SOUTH-TEMPLE object).

Add the missing branches:

```
jigsUp(desc, player? = false):
   winner = ADVENTURER
   if dead: "It takes a talented person to be killed while already dead..."; finish(); return
   tell(desc)
   if not lucky: tell("Bad luck, huh?")                        // ADD
   scoreUpd(-10)                                               // present
   tell("****  You have died  ****")
   if winner in a vehicle: move winner -> here                 // ADD
   if deaths >= 2: tell("suicidal maniac..."); finish(); return   // present
   deaths += 1
   if visited.has('SOUTH-TEMPLE'):                             // ADD: ghost/Hades branch (§9.2, D4)
      ghostResurrect()
   else:                                                       // present: simple branch
      tell("Now, let's take a look here..."); goto(FOREST-1)
   FCLEAR TRAP-DOOR TOUCHBIT; pCont = null                     // ADD (P-CONT dependency)
   randomizeObjects()                                          // ADD (§9.3)
   killInterrupts()                                            // ADD (§9.4)
   RFATAL  // ADD: short-circuit via M-FATAL (ctx.fatal() path, extended for clock context — B3)
```

**WON-FLAG world effects (scoring DELTA §2.1):** fire inside the WON-FLAG trigger
(`scoring.checkWonFlag` path) — clear `MAP.INVISIBLE`, clear `WEST-OF-HOUSE.TOUCHBIT`,
emit the whisper. Sequenced here because it shares the death/endgame work unit, but it
is a scoring-side hook, not part of `jigsUp`.

### 9.2 Ghost-mode resurrection (`1actions.zil:4076–4088`) — NEW

```
ghostResurrect():
   tell("As you take your last breath... before the gates of Hell...")
   dead = true; trollFlag = true; alwaysLit = true
   winner.action = DEAD_FUNCTION
   goto(ENTRANCE-TO-HADES)
```

### 9.3 RANDOMIZE-OBJECTS (`1actions.zil:4101–4123`) — NEW; seeded

```
if LAMP in winner: move LAMP -> LIVING-ROOM
if COFFIN in winner: move COFFIN -> EGYPT-ROOM
SWORD.TVALUE = 0
for each F in winner's inventory (snapshot before moving):
   if F.TVALUE > 0:  scatter underground — walk ROOMS via NEXT? (cycling), accept each
                     RLANDBIT && !ONBIT room at 50% prob (biased, NOT uniform)
   else:             move F -> ABOVE_GROUND[rng.nextInt(11)]
```

ABOVE_GROUND (`1dungeon.zil:2630–2633`, 11 rooms): WEST/NORTH/EAST/SOUTH-OF-HOUSE,
FOREST-1/2/3, PATH, CLEARING, GRATING-CLEARING, CANYON-VIEW.

> **RNG determinism (Path B):** the scatter is seeded and internally deterministic,
> but is **NOT oracle-matched** — the underground walk depends on the compiled ROOMS
> object-chain order, unrecoverable from ZIL source. Tests are structural (items leave
> inventory, land in valid RLANDBIT/!ONBIT or ABOVE_GROUND rooms), never exact-room.

### 9.4 KILL-INTERRUPTS (`1actions.zil:4125–4135`) — NEW; needs clock.killAll

```
clock.killAll([I-XB, I-XC, I-CYCLOPS, I-LANTERN, I-CANDLES, I-SWORD, I-FOREST-ROOM, I-MATCH])
FCLEAR MATCH ONBIT
```
Does NOT disable I-FIGHT / I-THIEF (they re-check DEAD each tick).

**SD3 wording (D5, RATIFIED):** `killAll` disables every **REGISTERED** slot + MATCH
whose id is in the list above. Of the ZIL 8, the following are **registered today** in
`src/engine/bootstrap.ts` or `src/engine/clock.ts`: `I-LANTERN`, `I-CANDLES`,
`I-MATCH`. The following are **no-ops this phase** (referenced via `ctx.enableClock`
in above-ground.ts but not pre-registered): `I-SWORD`, `I-FOREST-ROOM`. The following
are **wholly unbuilt**: `I-XB`, `I-XC`, `I-CYCLOPS`. `killAll` must be a safe no-op
for unregistered ids — verify `clock.disable` does not throw on unknown ids. SD3
done-criteria: the 3 registered slots confirmed disabled; the 5 unbuilt/unregistered
slots no-op without error.

### 9.5 DEAD-FUNCTION ghost dispatch (`1actions.zil:3113–3173`) — NEW

**Ghost dispatch is a GAME-STATE BRANCH in `turn()` — NOT an `Actor.action` handler**
(OQ-4, RATIFIED — B8). The engine has no player-actor dispatch; do NOT model
DEAD-FUNCTION as an Actor.action handler. Instead: when `dead === true`, `turn()`
routes to a ghost-verb table check before normal parsing. The ghost verb table
(`1actions.zil:3113–3173`) is transcribed VERBATIM. Full table: pass-through for
movement/meta verbs; canned ghost responses for most actions; special ghost LOOK;
`alwaysLit` suppresses grue. **PRAY at SOUTH-TEMPLE** (`1actions.zil:3152–3168`):
clear LAMP.INVISIBLE, `dead = false`, `alwaysLit = false`, if TROLL in TROLL-ROOM
then `trollFlag = false` (same `visited.has('SOUTH-TEMPLE')` check — D4), trumpet
message, goto FOREST-1. PRAY elsewhere: "Your prayers are not heard."

### 9.6 WON-FLAG endgame & STONE-BARROW (`1actions.zil:403–430`) — NEW

```
STONE-BARROW-FCN(M-BEG):
   if verb ENTER or (WALK and PRSO is WEST|IN) or (THROUGH and PRSO is BARROW):
      tell(victory text)
      tell("ZORK: The Great Underground Empire.")   // standalone path — header bit never set
      finish()
```
FINISH (`gverbs.zil:33–53`): V-SCORE (final score + rank + moves + deaths), then
RESTART/RESTORE/QUIT prompt; sets `gameOver`.

**Web-shell `finish()` (B7, RATIFIED):** render V-SCORE output, set `gameOver = true`,
print the terminal string (*"ZORK: The Great Underground Empire."*). RESTORE is a no-op
for now (save slots deferred). RESTART is a no-op for now. The prompt loop is omitted;
setting `gameOver` halts the engine. (Affects DT2 done-criteria.)

---

## 10. Troll Wiring (the one live encounter)

### 10.1 TROLL-FCN F-code callbacks (`1actions.zil:640–764`)

| F-code | Behavior |
|--------|----------|
| F_BUSY | AXE in TROLL → no-op (false). AXE in HERE → `zprob(75)` pick up (set NDESC, clear WEAPONBIT, move to TROLL), update LDESC, "angered and humiliated, recovers his weapon", return T. AXE unavailable → cowering message, return T. |
| F_DEAD | drop AXE→HERE (restore axe flags); `trollFlag = true`. |
| F_UNCONSCIOUS | clear FIGHTBIT; drop AXE→HERE; LDESC → "An unconscious troll..."; `trollFlag = true`. |
| F_CONSCIOUS | if HERE: FSET FIGHTBIT, revival message; recover axe; `trollFlag = false`. |
| F_FIRST | `prob(33)` → FSET FIGHTBIT, clear P-CONT; return T. |

### 10.2 TROLL-FLAG double-duty & exit gating

`TROLL-FLAG = true` means troll dead-or-unconscious. It **both** (a) opens TROLL-ROOM's
east→EW-PASSAGE and west→MAZE-1 exits (`1dungeon.zil:1487–1490`, `ifFlag TROLL-FLAG`,
already data-driven — Phase 1 confirmed) **and** (b) short-circuits AXE-F to a no-op.
**`TROLL-FLAG` stays a FlagStore key** (exit-gating already reads it from there — D3,
RATIFIED). Do NOT make it an object flag. Carry it as `trollFlag` game state; the exit
messages stay the authentic *"The troll fends you off with a menacing gesture."* while
`trollFlag` is false.

### 10.3 G1 — REMOVE the Phase-1 troll-sign override (hard gate)

Phase 1 installed a temporary `V-ATTACK` override that produces a hand-lettered sign
instead of combat. **The first combat build task removes it.** Concretely, the override
lives in two places, both marked `// PHASE-1 TEMPORARY`:

- `src/engine/verbs/index.ts` — `verbAttackPhase1`, `TROLL_SIGN_TEXT`,
  `isBareAttackTroll` / `BARE_TROLL_ATTACK`, and the `'V-ATTACK': verbAttackPhase1`
  registration (lines ~591–645).
- `src/engine/game.ts` — the pre-parse bare-attack-troll intercept (~line 128).

**Guard test `tests/engine/troll-wall.test.ts` enforces this** (B2, RESOLVED AS BUILT).
The test at lines 202–237 scans **both** `verbs/index.ts` AND `game.ts` for the
`PHASE-1 TEMPORARY` marker (separate `it` cases at lines 203–207 and 209–213), plus the
coexistence guard at lines 221–236 (`!(hasMarker && hasCombatModule)`). All three cases
are present. The final case — *"PHASE-1 marker does not coexist with a Phase-2 combat
module"* — is true once `src/engine/combat.ts` exists. So **the moment CB-1 creates
`src/engine/combat.ts`, that test goes RED until the `PHASE-1 TEMPORARY` markers are
gone from both files.** This is the mechanical gate (Phase-1 spec §6 / §8
recurring-gate). G1 done-criteria: both markers removed, the real `V-ATTACK` → HERO-BLOW
handler registered, and the golden-preserving troll-wall assertions re-homed (§11). The
other troll-wall assertions (`examine troll` unchanged, east/west fend-off, no
TROLL-FLAG-without-kill) remain valid and must still pass against the real combat path.

---

## 11. Verification Strategy (Path B — the most important novel section)

The 2026-06-07 RNG-parity spike chose **Path B**: combat uses controlled Mulberry32,
not Frotz byte-parity. Gate 2 of the spike failed (1/4 seeds) on **draw-order**
desync, not PRNG correctness — real Zork consumes RANDOM at different sites/counts
per turn (the unbuilt thief demon, chiefly), so the same seed lands at a different LCG
position by the grue check. The consequence for combat verification is structural and
must be addressed head-on:

> **The byte-exact golden master CANNOT anchor any RNG-driven combat outcome.** A
> golden transcript through a fight would encode *our* RNG's draws, not real Zork's —
> a self-referential net (the exact failure mode that hid the fuel-timing bug). So
> combat correctness is proven against the **ZIL fight tables** with a forced/seeded/
> injected RNG, and the golden covers only the **deterministic surfaces**.

### 11.1 The fence (absolute)

Anything whose output depends on a combat/death RNG draw is **never** an exact-diff
golden case. The golden's job is the deterministic shell around combat; the seeded
unit tests are the combat interior.

### 11.2 What the golden master STILL covers (deterministic)

- **Entry guards (V-ATTACK):** ACTORBIT / HANDS / not-holding / WEAPONBIT rejections —
  fixed strings, no RNG.
- **Troll blocks exits:** east/west → *"The troll fends you off..."* while
  `trollFlag` false (data-driven `ifFlag`, no RNG). Already golden-adjacent
  (troll-wall test).
- **Death penalty & resurrection shell:** the −10, "You have died", DEATHS count,
  FOREST-1 vs Hades *destination*, the suicidal-maniac / talented branches — all
  deterministic given the death is forced.
- **"Pointless"/"unarmed cannot defend"/"already recovering" deterministic message
  branches** — reached without a table roll.
- **WON-FLAG → STONE-BARROW endgame** text + FINISH (deterministic given SCORE=350).
- **Scoring** remains fully oracle-diffable (it always was — BASE-SCORE pickups, room
  visits, trophy deposits, ranks); unchanged by combat.

### 11.3 Seeded / injected-RNG unit tests (the combat interior)

Inject a forced RNG via the existing `createGame({ rng })` seam, or a per-call stub
that returns a scripted sequence, so each behavior is deterministic under test.

- **(A) Per-tier distribution** — 10k rolls through `selectWindow(ATT,DEF)` for **each**
  of the 12 windows; assert the empirical distribution matches the §3.3 column within
  chi-square bounds. This is the proof the **DEF resolution windows are exact** (NM-1).
  Also assert each window is **exactly 9 elements** as a structural invariant.
- **(B) Forced-result state transitions** — inject an RNG that forces a specific
  `RES`, assert the state change: VILLAIN-BLOW LIGHT_WOUND → `pStrength -= 1` &
  LOAD_ALLOWED; KILLED → `pStrength = -10000` (NM-4); UNCONSCIOUS does **not** zero
  player pStrength (NM-8); HERO-BLOW UNCONSCIOUS → villain `DEF = -DEF` (KO not death);
  KILLED → villain removed + F_DEAD fired.
- **(C) OUT? knock-out loop** — force a player UNCONSCIOUS in DO-FIGHT, assert
  `out = 1 + nextInt(3)` and that subsequent blows transform (STAGGER→HESITATE,
  else→SITTING_DUCK).
- **(D) WINNER/VILLAIN-RESULT encoding** — the full killing-blow chain across the
  TD-2/TD-3 seam: forced KILLED → `pStrength = -10000` → `fightStrength() < 0` →
  `jigsUp` fires (one test, both sides).
- **(E) PROB / ZPROB / LUCKY** — VILLAIN-BLOW LOSE-WEAPON ~25% at LUCKY=true,
  ~8.3% at LUCKY=false (ZPROB 100-vs-300); HERO-BLOW LOSE-WEAPON ~25% LUCKY-insensitive
  (one-arg). Distribution test over forced STAGGER (NM-5).
- **(F) V-PROB wake cycle** — unconscious villain, advance I-FIGHT 5 turns with a seed,
  assert `vProb` 0→25→50→75→100 and AWAKEN fires by tick 5; assert the `p != 0` guard
  (NM-9: no wake on the turn it goes unconscious).
- **(G) I-CURE** — `pStrength = -2`, two ticks → `pStrength = 0`, LOAD_ALLOWED restored,
  re-queue stops at 0.
- **(H) Troll-kill walkthrough** — scripted sword fight, fixed seed, drive the troll to
  `DEF = 0`: assert F_DEAD fired, `trollFlag = true`, east/west **unblocked**. Structural
  (assert state + that *a* non-empty message printed from the right slot), not text-match.
- **(I) REMARK assembly** — `remark()` with a known LTABLE renders `F_WEP`/`F_DEF`
  tokens to the right DESCs and string literals verbatim; `randomElement` indexes
  `[1, frob[0]]`.

### 11.4 Near-miss guards as first-class tests (NM-1…NM-10)

Each wrong-but-plausible failure mode (combat-melee §19 / TD-2 §26) gets a dedicated
asserting test — these are the regression net against silent distribution/semantic
drift, because combat has no oracle: NM-1 window-size-9, NM-2 ATT/DEF role, NM-3
adjusted-vs-unadjusted OD distinct, NM-4 −10000 sentinel, NM-5 PROB-vs-ZPROB, NM-6
HERO_MELEE 7-slot guard, NM-7 Cyclops excluded from DO-FIGHT, NM-8 player UNCONSCIOUS
≠ DEF=0, NM-9 V-PROB zero-guard, NM-10 thief-flee-only-in-I-THIEF (engine-built,
asserted absent from DO-FIGHT).

### 11.5 New oracle/forced-RNG fixtures needed

- A **forced-RNG test harness** (scripted-sequence `Rng`) so a test can pin every draw
  in a blow — this is the load-bearing new test infrastructure for Path B.
- Golden corpus **extensions** for the deterministic surfaces only: V-ATTACK guard
  rejections, troll fend-off, death-penalty/resurrection shell, STONE-BARROW endgame.
- **No** combat-outcome golden fixtures (the fence, §11.1).

### 11.6 Suspicion discipline

Combat is the highest-risk subsystem in the port: no oracle diff, every check
self-authored, symptoms gradual (a wrong window or swapped role shifts *distributions*,
not crashes). **Green combat tests get more suspicion than green scoring tests** — the
suite is only as good as the NM enumeration. The element-by-element ZIL transcription
(CB-1), the chi-square window proofs (test A), and the explicit NM tests are the
mitigations; "tests pass" alone does not retire combat risk.

---

## 12. Build-Task DAG

Each task lists deps, files (verdict), and done-criteria. Authored to drive a
later staged build wave (foundation → parallel units → integrate). Independently verifiable.

### Wave 0 — Foundation (parallel; no combat logic)

- **F1 — Clock primitives.** `clock.ts` EXTEND: `queue(id, period, enabled)` re-arm +
  `killAll(ids[])` batch-disable. Deps: none. Done: unit tests — re-arm fires again
  after `period`; `killAll` disables every named slot; existing clock tests green.
- **F2 — Flags + LUCKY bootstrap.** `flags.ts` EXTEND: `Flag.Fight`, `Flag.Staggered`
  (do NOT re-add `Flag.Actor`). **Also init `LUCKY = true` in bootstrap** (`1actions.zil:969`
  — if omitted, `zprob` silently runs at ~1/3 rate from start — B4 RATIFIED). Deps: none.
  Done: flag round-trip tests; LUCKY=true confirmed in game state at construction.
- **F3 — Actor combat state + villain metadata + encumbrance globals.** `actor.ts`
  EXTEND: `pStrength: number` (init `0` — ZIL `gglobals.zil` has no P-STRENGTH
  global; winner starts healthy). Villain metadata (`vBest`, `vBestAdv`, `vProb`,
  `vMsgs`, F-code callback) lives in a **parallel `VillainEntry` record keyed by
  object id** — NOT on Actor (D1/OQ-1 RATIFIED). Add `LOAD-ALLOWED` and `LOAD-MAX`
  to game state (init `100`/`100` — `gglobals.zil:94,92`). Deps: none. Done:
  getters/setters tested; villain base strengths load from STRENGTH prop (Troll 2,
  Thief 5, Cyclops 10000); `pStrength` inits 0; LOAD-ALLOWED/LOAD-MAX init 100.
- **F4 — Forced-RNG test harness.** A scripted-sequence `Rng` for combat unit tests
  (§11.5). Deps: none. Done: harness returns a pinned draw sequence; used by a smoke
  test. *(This is test infra, foundational to every CB verification task.)*

### Wave 1 — Combat pure core (deps: F2, F3, F4)

- **CB1 — Raw tables + resolution windows.** `combat.ts` NEW: hand-transcribe
  DEF1…DEF3C (element-by-element vs `1actions.zil:3258–3299`) and the
  `{table,offset}` windows — **re-derive offsets directly from
  `1dungeon.zil:2644–2649` / `1actions.zil:3301–3317`, resolving OQ-5**. Done: each
  window asserts length 9 (NM-1); element-equality test vs ZIL.
  **NOTE: creating `combat.ts` trips the Phase-1 guard test RED — G1 (CB-gate, below)
  must land in the same wave/merge.**
- **CB2 — selectWindow + distributions.** `selectWindow(ATT,DEF)` three-tier. Done:
  10k-roll chi-square per window matches §3.3 (test A); NM-2 role assertion.
- **CB3 — Strength + probability.** `fightStrength(adjust)`, `villainStrength`,
  `prob`/`zprob` (widen `Rng` interface with `zprob`; draw form: CONTINUOUS
  `next()*denom < base` — B5/B6 RATIFIED). Confirm existing stubs/golden-RNG fixtures
  still satisfy the widened interface (they only call `next`/`nextInt`/`prob`).
  Done: score→strength table 2..7; adjusted≠unadjusted OD (NM-3); LUCKY split
  (test E); zprob draw confirmed CONTINUOUS not nextInt.
- **CB4 — REMARK + MELEE tables.** `remark`/`randomElement` + transcribe all four
  MELEE tables (slot/variant counts per §8.2). Done: test I; slot/variant counts
  asserted; 96-message total.

### Wave 2 — Scoring/death deltas (parallel with Wave 1; deps: F1)

- **SD1 — WON-FLAG world effects.** scoring trigger DELTA (§2.1): MAP reveal,
  WEST-OF-HOUSE re-describe, whisper. Done: drive SCORE→350, assert effects fire once.
- **SD2 — RANDOMIZE-OBJECTS.** death.ts/game.ts: lamp/coffin relocation, SWORD.TVALUE=0,
  seeded scatter. Deps: F1. Done: structural seeded tests (§9.3).
- **SD3 — KILL-INTERRUPTS.** `clock.killAll` 8 slots + MATCH extinguish. Deps: F1.
  Done: all 8 disabled; MATCH ONBIT cleared.

### Wave 3 — Blow resolution (deps: CB1–CB4, F1; SD-death for the death-chain test)

- **CB5 — VILLAIN-BLOW + WINNER-RESULT + take-path LOAD-ALLOWED check.** Done: NM-4/NM-8,
  I-CURE queue on net damage, killing-blow→jigsUp chain (test D). Also: add
  LOAD-ALLOWED consultation to `verbTake` — `src/engine/verbs/index.ts:328–354`
  currently has no capacity check; CB5 adds the encumbrance gate (B1 faithful coupling,
  not stubbed).
- **CB6 — HERO-BLOW + VILLAIN-RESULT.** Done: NM-6 7-slot guard, villain death→F_DEAD,
  unarmed/KO villain → instant KILLED.
- **CB7 — findWeapon + V-ATTACK guard.** 5-name containment (not WEAPONBIT);
  ACTORBIT/HANDS/holding/WEAPONBIT rejections (golden-diffable). Done: guard rejections
  match fixed strings.

### Wave 4 — Demons + death (deps: Wave 3)

- **CB8 — DO-FIGHT + I-FIGHT + AWAKEN + I-CURE.** I-FIGHT runs in clock context and
  routes death through the M-FATAL extension (B3 RATIFIED — see §7.1 note); the turn
  aborts via the extended `jigsUp` signal, not a separate path. Done: Cyclops excluded
  (NM-7); OUT? loop (test C); V-PROB cycle (test F, NM-9); I-CURE two-tick heal
  (test G); clock-context death aborts turn cleanly.
- **DT1 — JIGS-UP full (in `death.ts`).** Lift `game.ts:608–640` into `death.ts`,
  then extend: "Bad luck"/LUCKY, vehicle-eject, Hades branch (`visited.has('SOUTH-TEMPLE')`
  — D4), RFATAL extended for clock context (B3), P-CONT/`parser.clearContinuation()`
  dependency carried over. Deps: SD2, SD3. Done: first/second→FOREST-1, third→FINISH,
  death-while-dead→FINISH, Hades branch sets `dead=true` + installs ghost dispatch;
  clock-context RFATAL aborts turn; `game.ts` no longer contains `jigsUp`.
- **DT2 — Ghost dispatch + endgame.** Ghost verb table transcribed verbatim from
  `1actions.zil:3113–3173`; dispatch is a `dead === true` branch in `turn()` — NOT an
  Actor.action handler (B8/OQ-4 RATIFIED). PRAY resurrection at SOUTH-TEMPLE uses
  `visited.has('SOUTH-TEMPLE')` (D4). Web-shell `finish()`: render V-SCORE, set
  `gameOver = true`, print terminal string; RESTORE/RESTART no-ops (B7 RATIFIED).
  STONE-BARROW + FINISH. Deps: DT1, SD1. Done: each ghost-verb branch; PRAY at/away
  SOUTH-TEMPLE; `turn()` ghost-branch tested; STONE-BARROW endgame text + FINISH;
  `gameOver` set by `finish()`.

### Wave 5 — Troll wiring + G1 integration

- **TR1 — TROLL-FCN callbacks.** F_BUSY/F_DEAD/F_UNCONSCIOUS/F_CONSCIOUS/F_FIRST;
  TROLL-FLAG double-duty. Deps: CB5–CB8. Done: F_DEAD/F_UNCONSCIOUS set `trollFlag`,
  exits open; F_BUSY axe-recover (zprob 75).
- **G1 — Remove Phase-1 override + register real V-ATTACK + rework troll-wall tests.**
  Delete the `// PHASE-1 TEMPORARY` code in `verbs/index.ts` and `game.ts`; register
  V-ATTACK → HERO-BLOW. G1's scope **explicitly includes reworking
  `tests/engine/troll-wall.test.ts`** — the file pins Phase-1 behavior that goes red
  the moment G1 lands. Specifically: (a) the two marker-present tests (lines 203–213)
  must be **inverted or removed** (they assert the markers exist, which is now false);
  (b) the sign-behavior tests (attack/kill troll → sign, lines 61–91, 120–154) must be
  **replaced by real-combat expectations**; (c) the golden-preserving guards (`examine
  troll`, east/west fend-off pre-kill, no-TROLL-FLAG-without-kill) and the now-passing
  coexistence guard stay. **Without this rework G1 halts on its own pinned tests.**
  Deps: TR1. Done: coexistence guard passes (markers gone, combat.ts present); updated
  troll-wall tests pass against real combat path; troll-kill walkthrough (test H) green.

> **Sequencing note for the wave author:** CB1 and G1 are coupled by the guard test.
> The build harness supports per-task `expectedRed` allowances — tasks CB1 through
> TR1 carry an expected-red allowance for exactly the test *'PHASE-1 marker does not
> coexist with a Phase-2 combat module'*; the allowance expires at G1. Do not merge a
> half-built combat that leaves the guard red without this allowance declared.

### Wave 6 — Verification consolidation

- **V1 — NM guard suite.** A dedicated test per NM-1…NM-10 (§11.4). Deps: all CB/TR.
- **V2 — Golden deterministic-surface extensions.** Corpus additions for V-ATTACK
  guards, troll fend-off, death/resurrection shell, STONE-BARROW (§11.5). Deps: G1,
  DT2. Done: golden stays byte-identical except the deliberately-changed troll-attack
  path; full suite green.

---

## 13. Phase Gates

Re-enters the Phase-1 gate model at **G1** behind the live build.

### G1 — Build / Merge
- [ ] Foundation (clock primitives, flags, actor state, forced-RNG harness).
- [ ] Combat engine complete (tables, windows, blows, demons, MELEE tables); all NM
      guards have an asserting test; window chi-square proofs green.
- [ ] Death/endgame complete (JIGS-UP full, ghost/Hades, RANDOMIZE-OBJECTS,
      KILL-INTERRUPTS, DEAD-FUNCTION, WON-FLAG effects, STONE-BARROW, FINISH).
- [ ] Troll wired live; **Phase-1 `// PHASE-1 TEMPORARY` override removed from BOTH
      `verbs/index.ts` and `game.ts`** — the troll-wall guard test's coexistence case
      passes with `combat.ts` present.
- [ ] Golden-preserving troll-wall assertions still pass against the real combat path;
      the 218-command golden stays byte-identical except the deliberately-changed
      troll-attack path.
- [ ] Full suite green; faithfulness audit over the combat/death surface.
- [ ] Merged to the working branch (human commit voice; never detach).

### G2 — Deploy + Smoke
- [ ] Deployed build plays a real troll fight end-to-end; death/resurrection observed;
      score updates live through a fight.

### G3 — Playtest-Ready
- [ ] Known-issues list updated: combat live, thief/cyclops still deferred,
      RANDOMIZE-OBJECTS now active (was listed deferred in Phase 1).
- [ ] The troll fight, death, and (if reachable) endgame play correctly in the
      deployed build.

---

## 14. Open Questions for Sign-off

1. **OQ-1 — Villain metadata on `Actor` vs a parallel `VillainEntry` record.**
   Recommendation: a small `VillainEntry` record/table keyed by object id (mirrors the
   ZIL VILLAINS LTABLE), with only mutable `pStrength` on `Actor`.
   **RATIFIED (2026-06-09):** `VillainEntry` parallel record keyed by object id; only
   `pStrength` on Actor. Do NOT put villain metadata on Actor. (D1)

2. **OQ-2 — `combat.ts` monolith vs `combat.ts` + `i-fight.ts` (+ `death.ts`).**
   Recommendation: `combat.ts` (tables, blows, strength, MELEE) + `death.ts`
   (JIGS-UP, randomize, kill-interrupts, DEAD-FUNCTION); fold I-FIGHT into `combat.ts`.
   **RATIFIED (2026-06-09):** Split `combat.ts` + `death.ts`; I-FIGHT folds into
   `combat.ts`; `jigsUp` lifted out of `game.ts` into `death.ts` with
   `parser.clearContinuation()` / P-CONT dependency. (D2)

3. **OQ-3 — Extend `game.ts`'s `jigsUp` in place, or lift it into `death.ts`?**
   Tied to OQ-2.
   **RATIFIED (2026-06-09):** Lift into `death.ts`. (D2)

4. **OQ-4 — DEAD-FUNCTION as an `Actor.action` handler vs a game-level dispatch hook.**
   ZIL installs it as `WINNER.P?ACTION` (a PERFORM step-1 actor intercept). The engine
   has no player-actor dispatch infrastructure.
   **RATIFIED (2026-06-09):** Ghost/death-mode dispatch is a game-state branch in
   `turn()`. Do NOT model DEAD-FUNCTION as an Actor.action handler. Ghost verb table
   transcribed verbatim from `1actions.zil:3113–3173`. (B8)

5. **OQ-5 — DEF resolution-window offsets: the two source writeups disagree (§3.3).**
   The TD-2 scheme is internally consistent and is the spec's primary, but CB-1 MUST
   re-derive the offsets directly from `1dungeon.zil:2644–2649` /
   `1actions.zil:3301–3317` and pin the ZIL-true values. Flagging because a wrong
   offset is a silent distribution bug with no oracle to catch it. **Not a sign-off
   blocker — a build-time verification mandate — but surfaced so it isn't lost.**
   *(Unresolved — CB-1 build-time mandate stands.)*

6. **OQ-6 — LIGHT-SHAFT +13 ownership.**
   **RATIFIED (2026-06-09):** WIRED — `src/actions/coal-mine.ts` NO-OBJS handler,
   commit `240dc14`, 1652 tests green. No combat work needed.
