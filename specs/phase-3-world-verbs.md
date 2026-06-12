# Phase 3 — World Verbs, Puzzle Handlers & the Engine-Behavior Bug Sweep

**Status:** AMENDED 2026-06-12 (Amendment A: re-measured at main 230c07a; queued additions folded in — see §14). Locks on review-panel convergence; user review of autonomous ratifications (§13 OQ-7..9) pending.
**Date:** 2026-06-09 (amended 2026-06-12)
**Owner:** Dylan
**Repo:** lhocke/zork-workflow (private)

> Phase 3c — the **wide-shallow sweep**. Where Phase 2 drove one deep logic wall
> (combat/death/endgame), Phase 3 closes the breadth gap: the ~122 grammar actions that
> currently hit a *fabricated* unknown-verb fallback, the remaining puzzle/object handlers
> outside the dam/thief/cyclops deferrals, and the standing engine-behavior bug worklist the
> 2026-06-08 faithfulness audit confirmed. The unifying spine is **fidelity to ZIL**: every
> verb default is transcribed verbatim from `gverbs.zil` (never invented), every puzzle
> handler from `1actions.zil`. The single broadest item — **blocked moves not ticking the
> clock** — is fixed FIRST because it re-baselines every downstream timer against dfrotz; the
> 218-command golden master currently encodes the *pre-fix* timer phases and the V-INVENTORY
> bug, so this spec defines a **dfrotz-anchored re-baselining protocol** and a
> **DELIBERATE-GOLDEN-CHANGES register** — any golden delta NOT in that register is a regression.

---

## 1. Goal & Scope

### What Phase 3 proves

After Phase 2, combat is the last *deep* wall; Phase 3 is the breadth pass that makes the rest
of the world respond faithfully. Three clusters, in dependency order:

1. **The clock-desync fix + WAIT** — the broadest engine bug. Blocked moves currently skip
   CLOCKER, so every timer (lamp/candles/match) drifts +1 tick per blocked move from dfrotz.
   This is the FIRST task because fixing it re-baselines every timing-sensitive golden phase;
   nothing timer-touching downstream can be trusted until it lands. V-WAIT is the twin (it must
   *advance* the clock, not behave as a no-time meta).
2. **The verb priority cluster** — ~122 grammar actions hit `I don't know how to "X".`
   (`verbs/index.ts:761`, measured at phase-2-combat 4d8c252) — a fabricated, non-ZIL string. Phase 3 registers the ZIL default
   bodies for the high-traffic, move-1-reachable verbs (WAIT/CLIMB/PRAY/RING/TIE/BURN/THROW/
   GIVE/WEAR/MOVE/RAISE/LOWER/LOCK/UNLOCK/ENTER/EXIT) and the meta-verb bodies
   (VERBOSE/BRIEF/SUPERBRIEF/VERSION/DIAGNOSE/QUIT/SCRIPT), each with the exact gverbs.zil text.
3. **The puzzle/object handlers** — the region FCNs and object routines outside the deferred
   subsystems: Hades exorcism, rope/dome, coal-mine machine (completing the LIGHT-SHAFT story),
   bat/garlic, skeleton, mirror, bottle/water, the remaining weapon FCNs, granite-wall, cliffs,
   ambience, and the misc room FCNs.

### In scope

- **Clock fidelity:** blocked-move CLOCKER tick (the desync fix); V-WAIT clock-advance;
  the relit-match burnout re-arm; candle first-touch arming; the I-SWORD / I-FOREST-ROOM dead
  `enableClock` calls (slots never registered).
- **Verb priority cluster:** the verb bodies listed above, transcribed from `gverbs.zil`
  (§4), routed through the existing `ACTION_HANDLERS` dispatch (`verbs/index.ts:701`, measured at phase-2-combat 4d8c252).
- **Meta-verb bodies + the CLOCKER meta-suppression set:** `V-VERBOSE`/`V-BRIEF`/
  `V-SUPER-BRIEF` (and the room-revisit brief mode they gate), `V-VERSION`, `V-DIAGNOSE`
  (real wound readout off phase-2 `pStrength`), `V-QUIT`, `V-SCRIPT` (web no-op).
- **Puzzle/object handlers (§6):** the Hades bell-book-candle exorcism + I-XB/I-XC/I-XBH
  timers; ROPE-FUNCTION / DOME-ROOM-FCN / TORCH-ROOM-FCN; MACHINE-F / MSWITCH-FUNCTION /
  BASKET-F; BAT-F / FLY-ME / GARLIC-F; SKELETON; MIRROR-MIRROR; BOTTLE-FUNCTION / WATER-F;
  KNIFE-F / AXE-F / RUSTY-KNIFE-FCN (STILETTO caveat coordinated with the thief spec);
  GRANITE-WALL-F; CLIFF-OBJECT / WCLIF-OBJECT; WHITE-HOUSE-F / FOREST-F / SONGBIRD-F ambience;
  the misc room FCNs (BATS-ROOM, BOOM-ROOM, CAVE2-ROOM, DEEP-CANYON-F, SOUTH-TEMPLE-FCN,
  CANYON-VIEW-F, MACHINE-ROOM-FCN).
- **The confirmed engine-behavior bug worklist (§7):** lamp-off pitch-black line, dark-no-exit
  grue (PROB 80), V-INVENTORY format (article / "(providing light)" / nested recursion),
  V-PUT capacity/self-containment/already-in + TOUCHBIT/SCORE-OBJ, IT pronoun init/rebind,
  chimney-arrival verbose bug, disambiguation Oxford-comma format. *(TOUCHBIT-on-take /
  FDESC suppression: DONE-in-phase-2, commits 5f88eee + a7dbe5d — not a Phase-3 task.)*

### Explicitly out of scope (deferred; coordinate at the seam, do not build here)

- **Thief / cyclops** — full activation stays in the thief spec. The **STILETTO held-by-thief
  caveat** in the weapon FCNs is the one seam: RUSTY-KNIFE-FCN / weapon routines are built, but
  any branch that reads thief possession of the stiletto coordinates with the thief spec (§9).
- **Dam / reservoir / river / boat** — the whole FCD#3 + Old Man River subsystem. **LOUD-ROOM
  stays in the dam spec** (its read-loop is entangled with GATES-OPEN / LOW-TIDE).
- **Save / restore / restart** — day-3 decision stands; `V-SCRIPT` lands as a no-op only,
  `V-QUIT` renders score + sets `gameOver` (mirrors Phase-2 `finish()`), no prompt loop.
- **Full syntax.json-driven parser rework** — only the *listed* verbs are wired; the parser's
  grammar table is not re-architected. Verbs outside the priority cluster keep the fabricated
  fallback this phase (tracked, not fixed).

### Non-goals

- No re-derivation of combat — Phase 2 owns the melee engine; `V-DIAGNOSE` only *reads*
  `pStrength` + I-CURE state (§4.7).
- No new RNG path — Path B (Mulberry32) stands; the few RNG verbs here (SONGBIRD 15%, BAT FLY-ME,
  TROLL F-codes already in Phase 2) are seeded/structural, never golden-diffed on the draw.

---

## 2. Current-State Reconciliation

Measured against `src/` at the pinned checkout `/Users/lhocke/Code/zork-test-specdraft`
on 2026-06-09. **Superseded where it conflicts with §2-A below** — the thief/cyclops and
dam/river waves merged after this section was measured.

### 2-A. Re-measurement at main 230c07a (2026-06-12 — Amendment A; trust THIS block)

Line refs at main 230c07a: `ACTION_HANDLERS` declaration `verbs/index.ts:1082` (37 entries);
`HANDLERS` word-map `:1130` (15 entries); `META_ACTIONS` `:1149` (12 entries); fabricated
fallback `:1170`; `verbGo` blocked path `:338–339` (still `fatal:true`); turn-loop fatal break
`game.ts:668–674`; tick block `game.ts:856`; multi-CLOCKER wait branch `game.ts:857–885`.

Drift from the 2026-06-09 baseline — the wave MUST NOT rebuild any of these:

- **Already built since 06-09 (thief/dam waves):** `STILETTO-FUNCTION` (treasure-room.ts:228,
  registered), `RECOVER-STILETTO` (thief.ts:273 + game.ts:1260), **shared `rob()` /
  `stealJunk()` / `dropJunk()`** (thief.ts:80–251), `LOUD-ROOM-FCN` (dam.ts:646),
  `WHITE-CLIFFS-FUNCTION` (river-obj.ts:56), `DEEP-CANYON-F` (dam.ts:526, registered :645).
  Every §6/§9 clause that defers these "to the thief/dam spec" is OBSOLETE — those waves
  landed first; the seams inverted into reuse-don't-rebuild constraints.
- **V-WAIT is already 3-tick** — dam wave (949c37b) drives up to 3 CLOCKER advances from the
  turn loop (`maxClocks = isWait ? 3 : 1`, early-stop on interrupt), dfrotz-validated by the
  dam corpora. NOT in META_ACTIONS. CA2 is now an AUDIT/RECONCILE task (§3.2 amended).
- **V-PRAY has a real body** (verbPray :862–869, SOUTH-TEMPLE teleport + default) — CB3 is
  verify-plus-seam-test, not build. **V-DIAGNOSE has a full body** (:816–857) — CB6 is
  audit-against-ZIL, not rewrite.
- **V-RAISE (:1017–1019) and V-TIE-UP (:1108) are thin shells emitting FABRICATED non-ZIL
  strings** ("You can't raise that.") — live fidelity bugs. CB4 REPLACES them with HACK-HACK.
- **Meta verbs BRIEF/SUPER-BRIEF/VERSION/QUIT/SCRIPT are in META_ACTIONS with NO bodies** —
  they currently emit the fabricated fallback while consuming no time. CB5 builds them.
- **BD8 (disambiguation Oxford format) is FIXED** (parser-helpers.ts:273–287, matches
  WHICH-PRINT). **BD6 is substantially fixed** (itRef + bindPronouns, parser.ts:1175–1186);
  remaining scope = container-reveal rebind audit only.
- **Clock slots at main:** I-LANTERN, I-CANDLES, I-MATCH, I-SWORD, I-RFILL, I-REMPTY,
  I-MAINT-ROOM, I-RIVER (bootstrap) + I-FIGHT, I-THIEF, I-CURE, I-CYCLOPS (Game ctor).
  `queue`/`killAll` live (clock.ts:78–91). KILL-INTERRUPTS = I-XB, I-XC, I-CYCLOPS,
  I-LANTERN, I-CANDLES, I-SWORD, I-FOREST-ROOM, I-MATCH (death.ts:112–116) — dam/thief/fight
  slots intentionally absent pending the V3 ZIL-fidelity check (§11 amended).
- **Golden master** (tests/golden/walkthrough-master.txt, 218 commands) was re-baselined
  several times since 06-09 and **still encodes the BD3 flat-list inventory bug**. The
  normalizer trailing-`;` false-diff (normalizer.ts:261) is **unfixed** — V2 precondition stands.
- **Corpus:** 14 files exist (6 dam c-*, 8 prior); NONE of §10.1's planned files exist yet.

Legend: **NEW** = create; **EXTEND** = add to existing; **REWRITE** = replace body;
**DONE** = built; **DELTA** = mostly built, listed gaps remain.

### Verb dispatch — EXTEND (the fabricated fallback is real)

`src/engine/verbs/index.ts` carries **26 verb-word handlers** and a `ACTION_HANDLERS` map
keyed on the ZIL action id (`verbs/index.ts:701`, measured at phase-2-combat 4d8c252). The unmatched path returns
``I don't know how to "${ctx.verb}".`` (`verbs/index.ts:761`) — a **fabricated, non-ZIL
string**. The VERIFIED BASELINE's "15 of 148 grammar actions have handlers; ~122 hit a
fabricated fallback" reconciles: the 26 word-keys collapse to ~15 distinct *grammar actions*,
and the ZIL library defines 149 V-* routines (`verb-library-defaults.md §2`). Phase 3 adds the
priority-cluster bodies to `ACTION_HANDLERS` and a parallel word-key entry; it does NOT touch
the dispatch shape (still dispatch on `cmd.action`, gmain.zil:283–284).

### Clock — EXTEND (no re-arm; blocked moves skip it)

`src/engine/clock.ts` has `schedule`/`enable`/`disable`/`advance`/`snapshot`/`restore`. **The
blocked-move desync is confirmed in source:** `verbGo` returns `fatal:true` for "You can't go
that way." (`verbs/index.ts:273`, measured at phase-2-combat 4d8c252); the fatal path in the turn loop `break`s
(`game.ts:516–527`) **before** the `if (segmentConsumesTime) { …clock.advance() }` block at
`game.ts:586–588`. So a blocked move never advances CLOCKER — +1 lost tick vs dfrotz on every
blocked move (clock-main-loop.md §14.1: a *failed parse* doesn't tick, but a **blocked move is
a successful parse of V-WALK** and MUST tick — ZIL calls CLOCKER for any non-meta verb whose
parse succeeded, regardless of RFATAL). Phase 3 reorders the tick so blocked-but-parsed moves
tick. The Phase-2 `queue`/`killAll` primitives (F1) **land tonight** — treat as available; the
match/candle re-arms (§7) consume `queue`.

### Bootstrap clock registrations — DELTA (dead enableClock calls)

`src/engine/bootstrap.ts` registers exactly **`I-LANTERN`, `I-CANDLES`, `I-MATCH`**
(bootstrap.ts:61–103). The VERIFIED BASELINE's "I-SWORD/I-FOREST-ROOM `enableClock` calls
exist but slots were never registered" is confirmed — `above-ground.ts` calls `ctx.enableClock`
for slots that `bootstrap.ts` never `schedule`d, so they no-op silently. Phase 3 registers
I-FOREST-ROOM (SONGBIRD ambience needs it — §6.8). **I-SWORD (OQ-2 ratified 2026-06-10):**
I-SWORD is registered and wired in the phase-2 hotfix H3 — it is no longer a dead call.
Do not remove it; the known-issues note is superseded. Verify I-SWORD is present in
`bootstrap.ts` (or registered from H3) before building CC9.

### Action registry — EXTEND

`src/actions/registry.ts` merges `aboveGroundActions`, `lightSourcesActions`,
`coalMineActions` into `ACTIONS`, plus 12 `PRE-*` handlers (registry.ts:33–56). The VERIFIED
BASELINE's "24 of 74 object routines, ~11 of 33 room routines registered" reconciles against
these three region files. Phase 3 adds new region files (`hades.ts`, `dome-rope.ts`,
`mirror.ts`, weapon/misc handlers) and merges them here — the merge point is the only
registry.ts edit.

### Meta-verb suppression — DONE (set exists)

`META_ACTIONS` (`verbs/index.ts:740`, measured at phase-2-combat 4d8c252) already lists the 12 CLOCKER-suppressed verbs
(clock-main-loop.md §14.2). The bodies for VERBOSE/BRIEF/SUPER-BRIEF/VERSION/QUIT/SCRIPT are
registered as keys but several lack faithful bodies — §4.6 transcribes them. **`V-WAIT` is NOT
in META_ACTIONS and must not be** (it ticks); confirm it stays out (§3.2).

### V-DIAGNOSE — DELTA (substrate lands tonight)

`verbDiagnose` is registered (`verbs/index.ts:713`, measured at phase-2-combat 4d8c252). The Phase-2 `pStrength` + I-CURE
substrate it must read **lands tonight**. Phase 3 rewrites the body to the exact
`1actions.zil:3993–4025` readout (§4.7) once `pStrength`/`C-ENABLED?`/`C-TICK` are live.

### Golden master — DELTA (encodes bugs; re-baseline protocol required)

The 218-command golden currently **encodes the V-INVENTORY buggy form and the
pre-clock-fix timer phases** (overnight report §2). It is self-referential for those lines.
Phase 3 MUST NOT diff against the existing golden for any line the register (§8) changes; it
re-baselines those lines against **dfrotz R119**, never against our own output.

---

## 3. Cluster A — Clock Fidelity (FIX FIRST; re-baselines everything)

> This cluster is the foundation. Every timer-sensitive golden phase re-baselines off it, so it
> lands before any verb or puzzle work that touches the clock (lamp, candles, match, exorcism
> timers). Build task **CA1** is the literal first task of the wave.

### 3.1 Blocked-move CLOCKER tick (the desync fix) — `game.ts` (fatal path: 516–527; clock advance: 586–588; measured at phase-2-combat 4d8c252)

**ZIL contract** (clock-main-loop.md §3.4, §14.1): CLOCKER runs when `P-WON` is truthy (parse
succeeded) AND the verb is not a meta-verb. A blocked move (`V-WALK` into a NEXIT) is a
**successful parse** — `P-WON` is true — so it ticks. RFATAL suppresses *M-END*, not CLOCKER.
The engine conflates the two: `verbGo`'s blocked path sets `fatal:true`, and the fatal handler
`break`s out before the tick.

**Fix (CA1):** in the turn loop, the CLOCKER advance must run for a parsed non-meta verb even
when the segment ended in RFATAL, *before* the loop `break`s. Concretely: move the
`segmentConsumesTime` tick so the fatal branch (game.ts:516–527, measured at phase-2-combat
4d8c252) advances the clock on the way out for parse-success fatals, but a *parse failure*
(`pr.kind !== 'ok'`, game.ts:387–391) still does NOT tick (matches clock-main-loop.md §14.1).
The distinction is parse-success-RFATAL (ticks) vs parse-failure (no tick) vs meta (no tick).

> **Re-baseline trigger (DGC-1, §8):** this shifts every timer phase that follows a blocked
> move in the golden walkthrough. The golden's lamp/candle warning lines re-baseline against
> dfrotz. This is the broadest deliberate golden change — do it first so downstream phases
> baseline on the corrected clock.

### 3.2 V-WAIT — `gverbs.zil:1514–1519` (the twin bug) — NEW body

```zil
<ROUTINE V-WAIT ("OPTIONAL" (NUM 3))
     <TELL "Time passes..." CR>
     <REPEAT ()
        <COND (<L? <SET NUM <- .NUM 1>> 0> <RETURN>)
              (<CLOCKER> <RETURN>)>>
     <SETG CLOCK-WAIT T>>
```

Port: `V-WAIT` prints `Time passes...`, then ticks CLOCKER up to 3 times (default), stopping
early if any interrupt fires (`advance()` returns non-empty). It is **NOT a meta-verb** — it is
the canonical let-time-pass verb. Each `<CLOCKER>` call here is a real tick; the segment's own
end-of-turn tick must NOT double-count. Two correct implementations: (a) `V-WAIT` calls
`clock.advance()` internally 1–3× and the verb is added to `META_ACTIONS` so the turn loop does
NOT also tick (the wait *is* the time); or (b) it advances 0–2 extra ticks and lets the loop's
single tick be the 3rd. **Pick (a)** — it matches ZIL precisely (V-WAIT owns all its ticks via
the internal REPEAT; CLOCK-WAIT=T tells the loop the wait consumed the turn). Done-criteria
(CA2): `wait` advances exactly 3 ticks with no pending interrupt; stops early when a lamp/candle
warning fires mid-wait; the loop does not add a 4th tick.

> Note `CLOCK-WAIT` (clock-main-loop.md §9): in ZIL a set `CLOCK-WAIT` makes the NEXT CLOCKER
> call skip one tick (the "wait already ticked this turn" guard). Port the flag faithfully or
> document the (a)-implementation's equivalent: V-WAIT in META_ACTIONS + internal advances = no
> double-tick. Verify against dfrotz `wait` from move 1 (DGC-2, §8).

**AMENDED (2026-06-12, §2-A):** the dam wave already implemented 3-tick wait — the turn loop
drives `maxClocks = isWait ? 3 : 1` with early-stop on interrupt (game.ts:857–885, commit
949c37b), dfrotz-validated by the dam corpora. This is a THIRD mechanism, neither (a) nor (b):
the loop owns all 3 ticks and V-WAIT is NOT in META_ACTIONS. **CA2 is therefore an
AUDIT/RECONCILE task, not a build:** (1) verify the loop-driven form against the ZIL edge set —
no-double-tick (the isWait branch must replace, never add to, the normal end-of-turn tick),
mid-wait interrupt early-stop, mid-wait death, `wait` in the dark; (2) author `wait.txt` vs
dfrotz; (3) if every edge matches, RATIFY loop-driven-equivalent here (OQ-8) and update OQ-1's
note — refactor to (a) ONLY if an edge diverges. Do not rip out a dfrotz-validated mechanism
on mechanism-purity grounds.

### 3.3 Relit-match burnout re-arm — `light-sources.ts` (I-MATCH) — EXTEND

**Bug (overnight §2):** the shared I-MATCH entry self-removes on burnout; re-lighting a match
cannot re-queue it (same root cause as the never-scheduled I-SWORD/I-FOREST-ROOM). ZIL re-arms
via `<QUEUE I-MATCH 2>` each light (clock-main-loop.md §10; the `INT` macro is idempotent, §13).
**Fix (CA3):** on each match-light, `clock.queue('I-MATCH', 2, true)` (the Phase-2 re-arm
primitive). Done: light match → 2-tick burnout; light again → burnout re-arms; respects
MATCH-COUNT=6 (1actions.zil light-source section).

### 3.4 Candle first-touch arming — `light-sources.ts:196,218` (latent) — EXTEND

**Bug (overnight §3):** `CANDLES-FCN` (1actions.zil:2343) starts `I-CANDLES` on **first touch**
of the already-lit candles; the engine only arms it in burn/relight branches. Untestable until
combat opens the temple (Phase 2 unblocks). **Fix (CA3):** arm `I-CANDLES` on first touch of lit
candles, not only burn/relight. Done: `take candles` (lit) arms the burn timer; dfrotz-anchored
once the temple is reachable.

---

## 4. Cluster B — Verb Priority Bodies (transcribed from gverbs.zil)

All bodies below are **verbatim from `zil/gverbs.zil`** (cited per item). Default responses are
never invented. Each is added to `ACTION_HANDLERS` keyed on its V-* id; the dispatch already
routes there (game.ts:468–514 → executeVerb on `cmd.action`, measured at phase-2-combat 4d8c252).

### 4.1 V-CLIMB family — `gverbs.zil:279–335` (the egg/nest path)

`V-CLIMB-UP` (`:300`) is the core: resolve the directional exit (`GETPT HERE DIR`); if the
named object doesn't lead that way → ``The <obj> doesn't lead <up|down>ward.``; if it's a
climbable exit → `DO-WALK`; if the object is a WALL synonym → ``Climbing the walls is to no
avail.``; **Zork-1 tree branch (`:324`):** not at PATH, object is `<>`-or-TREE, and TREE is a
global in HERE → ``There are no climbable trees here.``; else `ROOMS` → ``You can't go that
way.``; final fallback → ``You can't do that!``. `V-CLIMB-DOWN` (`:279`) = `V-CLIMB-UP P?DOWN`.
`V-CLIMB-FOO` (`:281`, the bare CLIMB) → `V-CLIMB-UP P?UP`. `V-CLIMB-ON` (`:290`): VEHBIT →
`V?BOARD`; else ``You can't climb onto the <obj>.``

**Egg/nest seam:** `climb tree` from the FOREST/UP-A-TREE approach is the gateway to the egg/nest
(1actions-map.md §2 row 17, TREE-ROOM / EGG-OBJECT). Phase 3 wires the generic `V-CLIMB-UP`
faithfully; the TREE exit data + UP-A-TREE room must resolve (verify the tree exit exists in
`rooms.json`). Done (CB1): `climb tree` reaches UP-A-TREE; `climb` with no climbable exit →
exact ZIL string; `climb mailbox` → "You can't climb onto the mailbox." (object not VEHBIT).

### 4.2 V-PRAY — `gverbs.zil:1047–1054`

```zil
<COND (<EQUAL? ,HERE ,SOUTH-TEMPLE> <GOTO ,FOREST-1>)
      (T <TELL "If you pray enough, your prayers may be answered." CR>)>
```
At SOUTH-TEMPLE → teleport (GOTO) to FOREST-1. Elsewhere → the exact fallback string. **Seam
with Phase-2 ghost dispatch:** when `dead===true`, PRAY-at-SOUTH-TEMPLE resurrects (Phase-2
DT2 ghost table, `1actions.zil:3152–3168`); the *living* V-PRAY here is the teleport-only branch.
Coordinate: the ghost-mode branch (Phase 2) takes precedence when `dead`; this V-PRAY is the
not-dead path.

**AMENDED (2026-06-12, §2-A):** `verbPray` already exists with both branches
(verbs/index.ts:862–869). CB3 = verify the body against gverbs.zil:1047–1054 + add the
ghost-precedence seam test; build nothing new unless the audit finds a divergence.

### 4.3 V-RING / V-TIE / V-UNTIE / V-TIE-UP — exact one-liners

| Verb | ZIL | Default response |
|------|-----|------------------|
| V-RING (`:1162`) | one-line | `How, exactly, can you ring that?` |
| V-TIE (`:1465`) | PRSI=WINNER vs else | `You can't tie anything to yourself.` / `You can't tie the <obj> to that.` |
| V-UNTIE (`:1511`) | one-line | `This cannot be tied, so it cannot be untied!` |
| V-TIE-UP (`:1471`) | one-line | `You could certainly never tie it with that!` |

**RING seam:** the bell-ring in the exorcism is intercepted by `LLD-ROOM` M-BEG (§6.1) *before*
the default V-RING — the room FCN runs at PERFORM step 2/3, default verb at step 7. So `ring
bell` at ENTRANCE-TO-HADES fires the ceremony; `ring bell` anywhere else gets the V-RING default.
**TIE seam:** rope/dome (§6.2) intercepts `tie rope to railing` via ROPE-FUNCTION before V-TIE.

### 4.4 V-BURN (+ PRE-BURN) — `gverbs.zil:243–275`

`PRE-BURN` (`:243`): no PRSI → TELL-NO-PRSI ("You didn't say with what!"); PRSI not FLAMING? →
``With a <PRSI>??!?``; FLAMING? → allow. `V-BURN` (`:251`, Zork-1 branch): BURNBIT and
held-or-inside → `REMOVE-CAREFULLY` + ``The <obj> catches fire. Unfortunately, you were
[in|holding] it at the time.`` → `JIGS-UP`; BURNBIT not held → ``The <obj> catches fire and is
consumed.``; no BURNBIT → ``You can't burn a <obj>.`` **Death seam:** routes through Phase-2
`jigsUp` (the `ctx.jigsUp` already threaded, game.ts:487, measured at phase-2-combat 4d8c252).

### 4.5 V-THROW / V-GIVE / V-WEAR / V-MOVE / V-RAISE / V-LOWER

- **V-THROW** (`:1445`): `IDROP` then — PRSI=ME → ``A terrific throw! The <obj>`` + `JIGS-UP`
  (own-throw death, the long "break your neck" string); PRSI is ACTORBIT → ``The <PRSI> ducks
  as the <obj> flies by and crashes to the ground.``; else ``Thrown.`` (IDROP fail → ``Huh?``).
- **V-GIVE** (`:713`, + PRE-GIVE `:708`): PRE-GIVE blocks if not HELD → ``That's easy for you to
  say since you don't even have the <obj>.`` V-GIVE: PRSI not ACTORBIT → ``You can't give a
  <obj> to a <PRSI>!``; else ``The <PRSI> refuses it politely.``
- **V-WEAR** (`:1597`): not WEARBIT → ``You can't wear the <obj>.``; else `PERFORM V?TAKE`
  (Phase-1 V-TAKE prints "You are now wearing the X.").
- **V-MOVE** (`:914`, + PRE-MOVE `:910`): PRE-MOVE blocks if HELD → ``You aren't an accomplished
  enough juggler.`` V-MOVE: TAKEBIT → ``Moving the <obj> reveals nothing.``; else ``You can't
  move the <obj>.`` (Object FCNs like RUG-FCN override at step 6 — already registered.)
- **V-RAISE/V-LOWER** (`:1131`/`:902`): both route through `HACK-HACK` (`:2024`). V-RAISE =
  V-LOWER = `HACK-HACK "Playing in this way with the "`. HACK-HACK: PRSO in GLOBAL-OBJECTS and
  verb is WAVE/RAISE/LOWER → ``The <obj> isn't here!``; else ``<prefix><obj><HO-HUM>`` where
  HO-HUM (`:2031`) PICK-ONEs from 3 strings (" doesn't seem to work." / " isn't notably
  helpful." / " has no effect."). **BASKET raise/lower (§6.3) intercepts at the object FCN
  before HACK-HACK.** Port HACK-HACK as a shared helper; PICK-ONE = `rng.nextInt(3)` index.

> The full HACK-HACK family (KICK/PUSH/RUB/WAVE/RAISE/LOWER) is built once as the shared helper
> (CB4); each verb is a one-line call with its prefix string.

**AMENDED (2026-06-12, §2-A):** V-RAISE (verbs/index.ts:1017–1019, "You can't raise that.")
and V-TIE-UP (:1108) exist as thin shells emitting **fabricated non-ZIL strings** — live
fidelity bugs, not blanks. CB4 REPLACES these bodies with the HACK-HACK/ZIL forms; done-criteria
include a grep proving the fabricated strings are gone from src/.

### 4.6 Meta-verb bodies — `gverbs.zil:13–122`

- **V-VERBOSE** (`:13`): `VERBOSE=T, SUPER-BRIEF=<>`, ``Maximum verbosity.``
- **V-BRIEF** (`:18`): `VERBOSE=<>, SUPER-BRIEF=<>`, ``Brief descriptions.``
- **V-SUPER-BRIEF** (`:23`): `SUPER-BRIEF=T`, ``Superbrief descriptions.``
- **V-VERSION** (`:98`): ``ZORK I: The Great Underground Empire`` + the Infocom banner +
  ``Release <n> / Serial number <s>``. **Port note:** the release/serial come from the story-file
  header (`GET 0 1`, `GETB 0 17..23`) — there is no story file. Pin the faithful constants:
  **Revision 88 / Serial 840726** (OQ-5 ratified 2026-06-10). Transcribe the banner verbatim.
- **V-SCRIPT** (`:86`): web no-op — print ``Here begins a transcript of interaction with`` +
  V-VERSION banner (per ZIL), but the transcript bit is a no-op (no DIROUT). RTRUE (meta).
- **V-QUIT** (`:55`): calls `V-SCORE`, then prompts. **Web-shell:** render V-SCORE output + set
  `gameOver=true` (mirrors Phase-2 `finish()`); no Y/N prompt loop. The brief-mode room-revisit
  behavior (VERBOSE/SUPER-BRIEF gating whether a revisited room re-prints its LDESC) is part of
  this cluster — DESCRIBE-ROOM consults VERBOSE/SUPER-BRIEF (verb-library-defaults.md §5,
  DESCRIBE-ROOM step 4): first visit forces verbose; revisit prints name-only unless VERBOSE.
  Wire the VERBOSE/SUPER-BRIEF globals into the existing room-description path (CB5).

**AMENDED (2026-06-12) — CB5 expanded contract (BRIEF mode + room-description precedence):**

1. **Current reality (§2-A):** BRIEF/SUPER-BRIEF/VERSION/QUIT/SCRIPT sit in META_ACTIONS with
   no ACTION_HANDLERS bodies — `brief` today prints the fabricated fallback and consumes no
   time. CB5 builds all five bodies as spec'd above.
2. **Precedence ratification (OQ-7):** `describeCurrentRoom()` (game.ts:1145–1155) currently
   renders `ldesc` BEFORE the room handler, permanently shadowing every state-driven M-LOOK —
   the bug class commit 28bfc98 fixed for CYCLOPS-ROOM by *deleting* the ldesc. CB5 flips the
   precedence to **handler-wins-with-ldesc-fallback**, which is ZIL's own DESCRIBE-ROOM order
   (room ACTION gets M-LOOK first; LDESC prints only when the FCN returns false). Transcribe
   the order from `gverbs.zil` DESCRIBE-ROOM — do not improvise.
3. **ldesc-retirement contract (supersedes the 28bfc98 pattern):** under handler-wins, a
   default-state ldesc no longer breaks a maturing FCN — the 16 fallback ldescs from commit
   5d64188 STAY (they are the FCN-silent fallback), and future FCN tasks no longer carry an
   ldesc-deletion step. An ldesc is removed only when ZIL itself has none for the room.
4. **TOUCHBIT-gated revisit (brief mode):** `describeCurrentRoom()`/`describeRoom()` gain a
   `verbose` param — explicit LOOK always full; movement arrival brief (per gverbs.zil
   :1650–1678 semantics) when the room is Touched and VERBOSE is off. **Reference, not patch:**
   `stash@{1}` on phase-3-dam-river holds a correct *diagnosis* of this (param threading,
   precedence flip, maze-room re-describe, M-ENTER `\n\n` separator, golden deltas) but was an
   unauthorized half-implementation — re-derive each piece from gverbs.zil and dfrotz; use the
   stash only to anticipate the blast radius (its test deltas show which goldens move). The
   maze-room TOUCHBIT-clearing claim and the `\n\n` separator must each be CONFIRMED against
   ZIL/dfrotz before adoption — if unsupported, drop them.
5. **DGC-9 (new register row, §8):** every golden/oracle line that shifts under brief-mode
   revisit (movement arrivals after first visit stop re-printing ldesc) re-baselines against
   dfrotz R119 per the §8 single-transcript protocol. DGC-7 (chimney) is one instance of this
   class — keep both rows; BD7 closes as a side effect of CB5 if the chimney arrival passes
   through the same gated path.

### 4.7 V-DIAGNOSE — `1actions.zil:3993–4025` (real wound readout) — REWRITE

Reads Phase-2 `pStrength` (`P?STRENGTH`) and the I-CURE clock entry's `C-ENABLED?`/`C-TICK`.
Faithful body:

```
WD = winner pStrength (the wound accumulator, <= 0; 0 = healthy)
if I-CURE disabled: WD = 0   else: WD = -WD   (positive magnitude)
wound line:
  0          -> "You are in perfect health."
  1          -> "You have a light wound,"
  2          -> "...a serious wound,"
  3          -> "...several wounds,"
  >3         -> "...serious wounds,"
if WD != 0: " which will be cured after <CURE-WAIT*(WD-1) + I-CURE.C-TICK> moves."
RS = fightStrength(adjust=false) + pStrength   (survivability)
survival line ("You can "):
  0 -> "expect death soon"   1 -> "be killed by one more light wound"
  2 -> "be killed by a serious wound"  3 -> "survive one serious wound"
  >3 -> "survive several wounds"
if DEATHS != 0: "You have been killed once|twice."
```
Done (CB6): healthy player → "perfect health." + survival line off live score; wounded
(`pStrength=-2`, I-CURE enabled) → "a serious wound, which will be cured after N moves."; the
cure-moves arithmetic uses the live I-CURE `C-TICK` (verify against Phase-2 I-CURE re-queue).

**AMENDED (2026-06-12, §2-A):** a full `verbDiagnose` body already exists
(verbs/index.ts:816–857) reading the live pStrength/I-CURE substrate. CB6 = line-by-line audit
of that body against `1actions.zil:3993–4025`, fixing divergences in place — not a blind
rewrite. Keep whatever already matches.

### 4.8 V-LOCK / V-UNLOCK / V-ENTER / V-EXIT — exact

- **V-LOCK** (`:855`) / **V-UNLOCK** (`:1508` → calls V-LOCK): ``It doesn't seem to work.``
  (object FCNs like the grate/dam override; defaults here.)
- **V-ENTER** (`:620`): `DO-WALK P?IN`. **V-EXIT** (`:632`): in-vehicle → `V?DISEMBARK`; else
  `DO-WALK P?OUT`. Both delegate to the existing movement engine (verbGo / DO-WALK). Done (CB1):
  `enter` resolves the IN exit; `exit` resolves OUT; no-vehicle exit gives the walk result.

---

## 5. Verb-cluster dispatch & registration (how Cluster B lands)

All Cluster B bodies are pure functions of `VerbContext` and register in `ACTION_HANDLERS`
(`verbs/index.ts:1082`, re-measured at main 230c07a) + the word-key `HANDLERS` map. Shared helpers (HACK-HACK, the DO-WALK
delegate for ENTER/EXIT/CLIMB) live alongside. The fabricated fallback
(``I don't know how to "X".``) stays for verbs outside the cluster — it is narrowed, not
removed. **No parser/grammar rework** (out of scope). META_ACTIONS: V-WAIT's membership is
governed by the CA2 audit outcome (§3.2 amended — the loop-driven form keeps it OUT); confirm
no other cluster verb is mis-classified as meta (CLIMB/PRAY/BURN/THROW/etc. all tick).

### 5.1 CB0 — PRSA ratify + unify (NEW, 2026-06-12; prerequisite to all CB tasks)

**RATIFIED:** `ctx.action` (ZIL PRSA, e.g. `'V-ATTACK'`) is the canonical dispatch token in
every action/object/room handler — never the surface verb word (L38(b): `ctx.verb==='attack'`
silently missed kill/stab/strike). Two idioms currently coexist: the C1 `ctx.action` checks and
the T4 prep-predicate dispatch (`verb='look', prep='IN'`); `action` is populated inconsistently
(cyclops.ts:279 falls back to the verb word). CB0: (1) state the contract in the
ActionContext/VerbContext interface docs (game-object.ts:33 + verbs/index.ts); (2) make
`action` reliably populated at every dispatch site (no per-handler fallback); (3) sweep
existing handlers' `ctx.verb ===` string checks and migrate the action-dispatch ones to
`ctx.action` (prep-predicates remain for genuine preposition dispatch); (4) done-criteria:
≥1 test per non-primary synonym for every CB verb (kill/stab/strike-class coverage), and a
grep showing no remaining `ctx.verb ===` action-dispatch in src/actions + src/engine/verbs.
Deps: CA1. All CB1–CB6 dep CB0.

---

## 6. Cluster C — Puzzle / Object Handlers (grouped by region)

Each handler is transcribed from `1actions.zil` (cited). Grouped so each region is an
independently-verifiable build task. Region FCNs run at PERFORM step 2 (M-BEG) / via M-END /
M-ENTER / M-LOOK; object FCNs at step 6 (VERB? dispatch). The existing `runActionChain`
(game.ts:438–514, measured at phase-2-combat 4d8c252) + `runMEnd`/`onRoomEntered` already drive M-codes — these handlers slot into the
registry merge (§2).

### 6.1 Hades exorcism — `LLD-ROOM` + bell/book/candles + I-XB/I-XC/I-XBH (`1actions.zil:1058–1150`)

The strict bell→candles→book ceremony. `LLD-ROOM(RARG)`:
- **M-LOOK** (`:1059`): the gateway description + (if `NOT LLD-FLAG` and `NOT DEAD`) the
  "barred by evil spirits, who jeer" line.
- **M-BEG** (`:1072`): `EXORCISE` verb → equipped-check messages; **`RING BELL`** (not LLD-FLAG)
  → `XB=T`, remove BELL, reveal+move HOT-BELL to HERE, the "bell suddenly becomes red hot" text;
  if CANDLES carried → drop+extinguish them + `DISABLE I-CANDLES`; `ENABLE QUEUE I-XB 6` +
  `ENABLE QUEUE I-XBH 20`. **`READ BOOK`** (requires `XC`) → the "Begone, fiends!" prayer,
  `REMOVE-CAREFULLY GHOSTS`, `LLD-FLAG=T`, `DISABLE I-XC`.
- **M-END** (`:1116`): if `XB` and CANDLES carried and lit and `NOT XC` → `XC=T`, the "flames
  flicker / earth trembles" text, `DISABLE I-XB`, `ENABLE QUEUE I-XC 3`.

Timers: **I-XB** (`:1131`, 6 ticks): if not `XC` and at ENTRANCE-TO-HADES → "tension broken,
wraiths resume jeering"; `XB=<>`. **I-XC** (`:1139`, 3 ticks): `XC=<>` then calls `I-XB`.
**I-XBH** (`:1143`, 20 ticks): remove HOT-BELL, move BELL back to ENTRANCE-TO-HADES, "bell
appears to have cooled down" if present. `GHOSTS-F` (`:264`) + `BELL-F`/`HOT-BELL-F`
(`:343`/`:351`) + `BLACK-BOOK` (`:2187`) object FCNs handle direct interactions.

**New `queue` dependency:** I-XB/I-XC/I-XBH are NEW clock slots — register them in bootstrap (or
lazily `schedule` on first ring) and re-arm via the Phase-2 `queue` primitive. **Phase-2
KILL-INTERRUPTS already lists I-XB/I-XC** as no-op-if-unregistered (Phase-2 §9.4 SD3) — once
Phase 3 registers them, KILL-INTERRUPTS disables them for real on death. Coordinate: the
KILL-INTERRUPTS list does not change; the slots simply become live.
Done (CC1): ring→candles→read sequence sets LLD-FLAG and clears the spirit bar; ring-then-wait-6
breaks the ceremony (I-XB fires); 20-tick bell cooldown restores BELL. dfrotz-anchored corpus.

### 6.2 Rope / dome — `ROPE-FUNCTION` / `DOME-ROOM-FCN` / `TORCH-ROOM-FCN` (`1actions.zil:3030`, `:1030`, `:1018`)

`ROPE-FUNCTION` (`:3030`): TIE rope to railing in DOME-ROOM → set `DOME-FLAG`, lower rope into
TORCH-ROOM (the descent gateway); UNTIE / TAKE reverse it; context-gated messages.
`DOME-ROOM-FCN` (`:1030`): M-LOOK / M-ENTER for the dome — the "you cannot go down without a
rope" gating reads `DOME-FLAG`. `TORCH-ROOM-FCN` (`:1018`): the torch-room arrival. **TIE seam
(§4.3):** ROPE-FUNCTION intercepts `tie rope` before the V-TIE default. Done (CC2): tie rope at
dome → DOME-FLAG set, descent enabled; untie reverses; the dome exit gates on DOME-FLAG.

### 6.3 Coal-mine machine — `MACHINE-F` / `MSWITCH-FUNCTION` / `BASKET-F` (`1actions.zil:2502`, `:2531`, `:277`)

Completes the **LIGHT-SHAFT story** (Phase-2 wired the +13 award; Phase 3 wires the machinery
that makes the shaft reachable with the right inventory). `MACHINE-F` (`:2502`): the coal→diamond
machine — OPEN/CLOSE lid, PUT coal, the lid-state messages. `MSWITCH-FUNCTION` (`:2531`): TURN
switch with the screwdriver → if lid closed and coal inside, produce DIAMOND (transform);
context messages otherwise. `BASKET-F` (`:277`): RAISE/LOWER the basket between SHAFT-ROOM and
LOWER-SHAFT via `CAGE-TOP` global — RAISE when down moves RAISED-BASKET up + LOWERED-BASKET down,
sets CAGE-TOP; LOWER reverses; announces if the room goes dark. **RAISE/LOWER seam (§4.5):**
BASKET-F intercepts at the object FCN before HACK-HACK. Done (CC3): put coal + close lid + turn
switch → diamond; lower basket with the lamp aboard → basket descends; the LIGHT-SHAFT entry
condition (Phase-2 NO-OBJS handler) fires after the basket carries the load down.

### 6.4 Bat / garlic — `BAT-F` / `FLY-ME` / `GARLIC-F` (`1actions.zil:308`, `:317`, `:4160`)

`BAT-F` (`:308`): TAKE/ATTACK bat with no garlic nearby → `FWEEP` (prints "Fweep!" ×4) then
`FLY-ME`. `FLY-ME` (`:317`): teleport player to a random room from `BAT-DROPS` (8 rooms: MINE-1..4,
LADDER-TOP/BOTTOM, SQUEEKY-ROOM, MINE-ENTRANCE); if dropped at ENTRANCE-TO-HADES, no LOOK.
`GARLIC-F` (`:4160`): garlic in inventory or room repels the bat ("clinging to the ceiling").
**RNG:** `FLY-ME` destination = `rng.nextInt(8)` into BAT-DROPS — **seeded/structural, never
golden-diffed on the draw** (Path B fence). Done (CC4): bat with no garlic → teleport to a valid
BAT-DROPS room; garlic present → bat repelled (no teleport).

### 6.5 Skeleton curse — `SKELETON` (`1actions.zil:931`)

Any interaction (TAKE/RUB/MOVE/…) summons the ghost: `ROB HERE LAND-OF-LIVING-DEAD 100` +
`ROB ADVENTURER LAND-OF-LIVING-DEAD` — all valuables teleport to Land of Living Dead.

**AMENDED (2026-06-12, §2-A — supersedes OQ-4):** the thief wave landed first and built the
shared `rob()` (thief.ts:80–101, plus stealJunk/dropJunk). CC5 **reuses** `rob()` — building a
second minimal scatter helper is now forbidden duplication. OQ-4's minimal-cut ruling is
obsolete (its premise — thief wave not yet built — no longer holds; see OQ-9). Verify
`rob()`'s signature covers the SKELETON call shape (`prob=100` room scatter + unconditional
player scatter) and extend it there if not. Done (CC5): touch skeleton → carried + room
valuables relocate to LAND-OF-LIVING-DEAD, via the shared thief.ts `rob()`.

### 6.6 Mirror — `MIRROR-MIRROR` (`1actions.zil:971`)

RUB mirror (no instrument) → swap ALL contents of the two mirror rooms + teleport player to the
other room (no LOOK). MUNG/THROW/ATTACK → `MIRROR-MUNG=T`, `LUCKY=<>` (the "seven years' bad
luck" text). **`LUCKY` seam with Phase 2:** Phase-2 `zprob` reads `LUCKY` — breaking the mirror
here flips it false, which makes Phase-2 combat's LOSE-WEAPON ~1/3 as likely. Faithful and
intended; note it in the combat-interaction known-issues. Done (CC6): rub mirror → room contents
swap + teleport; break mirror → MIRROR-MUNG set, LUCKY false (assert Phase-2 zprob sees it).

### 6.7 Bottle / water — `BOTTLE-FUNCTION` / `WATER-F` (`1actions.zil:1491`, `:157`)

`BOTTLE-FUNCTION` (`:1491`): OPEN/CLOSE the bottle, the "empty?" state, SHAKE spills water.
`WATER-F` (`:157`): DRINK (HIT-SPOT: "Thank you very much. I was rather thirsty." + remove
portable water) / POUR (extinguish FLAMING? object or "evaporates") / TAKE-water context. **Seam
with V-EAT/V-DRINK (Phase-1):** the drink path is in gverbs V-EAT (verb-library-defaults.md §5,
HIT-SPOT `:518`) — WATER-F handles the object-side; ensure the bottle-open gate is respected.
Done (CC7): drink water from open bottle → thirst message + water consumed; pour water on lit
candle → extinguished; closed bottle blocks drinking.

### 6.8 Weapons — `KNIFE-F` / `AXE-F` / `RUSTY-KNIFE-FCN` (`1actions.zil:926`, `:622`, `:907`) — STILETTO seam

- `AXE-F` (`:622`): the troll's axe — its weapon-FCN behavior is mostly driven by Phase-2
  TROLL-FCN F-codes (Phase-2 §10.1). Phase 3 ports only the non-combat object responses.
- `KNIFE-F` (`:926`): the nasty knife object responses.
- `RUSTY-KNIFE-FCN` (`:907`): TAKE while carrying sword → sword blue-light pulse (feedback);
  ATTACK/SWING *with* rusty knife as weapon → kills player ("the knife slits your throat") via
  `jigsUp`. Death seam → Phase-2 `jigsUp`.
- **`STILETTO-FUNCTION` — DROPPED from CC8 (AMENDED 2026-06-12, §2-A):** the thief wave built
  it (treasure-room.ts:228, registered) along with RECOVER-STILETTO (thief.ts:273 +
  game.ts:1260). Phase 3 does NOT touch the stiletto. CC8 scope = KNIFE-F / AXE-F /
  RUSTY-KNIFE-FCN only, coordinating with the existing `weaponFunction` helper
  (treasure-room.ts) rather than a new pattern.
Done (CC8): rusty-knife attack → death; take rusty-knife with sword → blue pulse, no glow change;
KNIFE/AXE object responses faithful; stiletto untouched (already live).

### 6.9 Ambience + scenery — `WHITE-HOUSE-F` / `FOREST-F` / `SONGBIRD-F` / `GRANITE-WALL-F` / cliffs

- `WHITE-HOUSE-F` (`:92`) / `FOREST-F` (`:136`): the house/forest scenery responses (EXAMINE /
  directional flavor).
- `SONGBIRD-F` (`:82`) + `FOREST-ROOM` (`:3004`) + `I-FOREST-ROOM` (`:2996`, 15% chirp): the
  songbird ambience. **This is where the dead I-FOREST-ROOM `enableClock` call gets resolved —
  register the slot** so the 15% chirp fires (`prob(15)`). RNG seeded/structural. Note:
  I-SWORD is NOT handled here — it is wired in the phase-2 hotfix H3 (OQ-2 ratified).
- `GRANITE-WALL-F` (`:64`): the granite wall scenery (the temple/treasure-room wall).
- `CLIFF-OBJECT` (`:3015`) / `WCLIF-OBJECT` (`:3011`): the canyon/cliff scenery objects. **Cliff
  *movement* (climb down the cliff) is dam/river-adjacent** — port only the scenery EXAMINE/
  responses; the WHITE-CLIFFS-FUNCTION boat-deflate gating stays with the dam/river spec.
Done (CC9): examine house/forest/granite-wall/cliffs → faithful scenery text; songbird chirps at
~15% over a seeded run; I-FOREST-ROOM registered (no longer a dead call); I-SWORD confirmed
live from phase-2 hotfix H3 (no Phase-3 action needed).

### 6.10 Misc room FCNs — BATS-ROOM / BOOM-ROOM / CAVE2-ROOM / DEEP-CANYON-F / SOUTH-TEMPLE-FCN / CANYON-VIEW-F / MACHINE-ROOM-FCN

- `BATS-ROOM` (`:2478`): the bat-room M-ENTER/M-LOOK (bat presence gating).
- `BOOM-ROOM` (`:2446`): M-END gas-explosion check — open flame (lit candle/match/torch) in the
  gas room → explosion + `jigsUp`. **Death seam** → Phase-2 jigsUp. The "FLAME" detection reads
  carried lit FLAMEBIT/ONBIT objects.
- `CAVE2-ROOM` (`:2416`): M-END windy-corridor candle-extinguish (50–80% blow-out). Reads/extends
  the candle timer — **depends on Cluster A candle arming (§3.4)**.
- `DEEP-CANYON-F` — **DROPPED (AMENDED 2026-06-12, §2-A):** built by the dam wave
  (dam.ts:526, registered :645). `CANYON-VIEW`: only the CROSS verb exists (rainbow.ts:139,
  "From here?!?"); CC10 ports the M-LOOK description side if ZIL defines one — verify against
  1actions.zil before building (if ZIL has no CANYON-VIEW FCN beyond CROSS, there is nothing
  to add and the rooms.json ldesc stands).
- `SOUTH-TEMPLE-FCN` (`:2573`): the temple M-END / `COFFIN-CURE` exit-gate (carrying the coffin
  blocks the temple exit). **Phase-2 seam:** SOUTH-TEMPLE TOUCHBIT drives the Hades-vs-FOREST
  resurrection branch (Phase-2 §9.1, D4) — the *visit* sets TOUCHBIT; this FCN does the
  coffin-gate. Do not duplicate the resurrection logic.
- `MACHINE-ROOM-FCN` (`:2488`): the machine-room M-LOOK/M-ENTER (pairs with §6.3 MACHINE-F).
Done (CC10): each room's M-code response matches dfrotz; BOOM-ROOM explodes on lit flame;
CAVE2-ROOM blows out candles probabilistically; SOUTH-TEMPLE coffin-gate blocks the exit.

### 6.11 TROLL-ROOM-F (NEW — CC11, 2026-06-12)

`TROLL-ROOM-F` (`1actions.zil:4175–4178`) is the smallest FCN in the game: on M-ENTER with the
troll present, `<THIS-IS-IT ,TROLL>` — bind the IT pronoun to the troll so `attack it` works on
arrival. It is named in rooms.json:651 (`actionRoutine: "TROLL-ROOM-F"`) but never registered,
so bootstrap silently leaves the handler undefined. CC11: register it (fold into an existing
region file — no new file for four lines), wiring M-ENTER → `ctx.thisIsIt(TROLL)` via the
existing parser hook (parser.ts setItRef). **Coordinate with BD6's narrowed audit:** the parser
already binds pronouns post-parse (parser.ts:1175–1186) — add a test proving entry-binding and
post-parse binding don't fight (enter troll room → `it` = troll; then `take sword` → `it`
rebinds to sword per ZIL). Done (CC11): registered; `attack it` on first troll-room entry
targets the troll; no double-binding regression.

---

## 7. Cluster D — Confirmed Engine-Behavior Bug Worklist

Folded into the DAG from the 2026-06-08 faithfulness audit (fidelity-findings.md, overnight
§2). Each is a real engine-vs-dfrotz divergence; several change golden lines (→ register §8).

| # | Bug | Source | Fix | Golden? |
|---|-----|--------|-----|---------|
| BD1 | Lamp-off omits ``It is now pitch black.`` when it leaves the room dark | `light-sources.ts:52–62`; ZIL V-LAMP-OFF gverbs `:771` | append the pitch-black line when LIT goes false | DGC-3 |
| BD2 | Dark no-exit walk → always "You can't go that way."; ZIL is PROB 80 grue | `verbs/index.ts:273` (measured at phase-2-combat 4d8c252); GOTO grue gverbs `:2095`, clock-main §7 | in the dark, a blocked move is `prob(80)` grue death (not the canned string) | seeded — fence |
| BD3 | V-INVENTORY flat list: missing "A " article, "(providing light)", nested recursion | overnight §2; PRINT-CONT gverbs `:1750`, DESCRIBE-OBJECT `:1693` | rewrite to PRINT-CONT recursion + FIRSTER header | DGC-4 (golden encodes the bug) |
| BD4 | V-PUT missing capacity/self-containment/already-in + TOUCHBIT/SCORE-OBJ on put | overnight §2; V-PUT gverbs `:1085` | add the container checks + FSET TOUCHBIT + SCORE-OBJ | DGC-5 if a golden put-line shifts |
| BD5 | ~~TOUCHBIT not set on TAKE → FDESC wrongly suppressed/shown~~ **DONE-in-phase-2** (commits 5f88eee + a7dbe5d: `verbTake` sets `Flag.Touched` + clears `Flag.NonDescript` per `gverbs.zil:1948–1950`; regression test `verbtake-touchbit.test.ts`; 11 golden lines dfrotz-re-anchored) | fidelity-findings.md follow-up; ITAKE gverbs `:1900` | ~~FSET TOUCHBIT + FCLEAR NDESCBIT in the take path~~ Fixed | ~~DGC-6~~ golden lines already moved (see §8 note) |
| BD6 | ~~IT pronoun never initialized~~ **NARROWED (2026-06-12, §2-A):** itRef init + post-parse bindPronouns live (parser.ts:1175–1186); remaining scope = container-reveal rebind audit + the CC11 entry-binding interaction | overnight §2; gmain IT-tracking `:202` | audit reveal-path `thisIsIt` calls; fix gaps found | possible |
| BD7 | Chimney-arrival renders verbose (full Kitchen desc) instead of abbreviated revisit | overnight §3; UP-CHIMNEY-FUNCTION `1actions.zil:553` | the chimney→Kitchen arrival uses the already-visited brief view | DGC-7 |
| BD8 | ~~Disambiguation list not Oxford-comma format~~ **FIXED at main (2026-06-12, §2-A):** parser-helpers.ts:273–287 matches WHICH-PRINT. No Phase-3 work; DGC-8 moot unless V2's diff disagrees | overnight §2 | ~~match ZIL's form~~ Done | ~~DGC-8~~ |

**BD3 (V-INVENTORY) and BD7 (chimney) and BD1 (lamp-off) and BD6 are the headline
deliberate golden changes** — see §8. BD2's grue is seeded (Path B fence — never golden-diffed
on the draw; assert the *branch* fires, not a specific death). BD5 is **DONE-in-phase-2**
(commits 5f88eee + a7dbe5d): `verbTake` now sets `Flag.Touched` + clears `Flag.NonDescript`;
11 golden lines were dfrotz-re-anchored; `DGC-6` is therefore complete (the painting line
was already moved — do not re-schedule it here).

---

## 8. DELIBERATE-GOLDEN-CHANGES Register (the contract)

> **Any change to the 218-command golden master that is NOT in this register is a regression.**
> Each entry names the line(s) it touches and its **dfrotz-anchored re-baseline procedure**.
> The golden is NEVER re-baselined against our own output — only against **dfrotz R119**.

| ID | What changes | Why (ZIL) | Re-baseline procedure |
|----|--------------|-----------|------------------------|
| **DGC-1** | Every lamp/candle/match timer-warning line that follows a *blocked move* in the walkthrough shifts by the recovered tick(s) | §3.1 blocked-move CLOCKER tick | Re-run the exact golden command sequence through dfrotz R119; capture the lamp/candle warning lines at their new (correct) move numbers; replace ONLY those lines. |
| **DGC-2** | `wait` output / subsequent timer phase | §3.2 V-WAIT ticks | dfrotz `wait` from a known state; confirm 3 ticks + any mid-wait warning; re-baseline the wait line + downstream timer lines. |
| **DGC-3** | `turn off lamp` in a dark room gains ``It is now pitch black.`` | BD1 / V-LAMP-OFF | dfrotz `turn off lamp` in an unlit room; capture the appended line. |
| **DGC-4** | Every `inventory`/`i` line: "A " articles, "(providing light)", nested container contents | BD3 / PRINT-CONT | dfrotz `i` at each inventory state in the walkthrough; replace the flat list with dfrotz's exact rendering. **The golden currently encodes the BUG — this is the canonical case where the existing golden is wrong.** |
| **DGC-5** | `put X in Y` lines if capacity/scoring text shifts | BD4 / V-PUT | dfrotz the exact put command; capture full output incl. any "There's no room." |
| **DGC-6** | ~~The late `examine trophy case` / painting FDESC-vs-DESC line~~ **DONE-in-phase-2**: golden lines 871 + 900 already dfrotz-re-anchored by commits 5f88eee + a7dbe5d (11 total golden lines updated). No Phase-3 action needed. | BD5 / TOUCHBIT on take — fixed | Already applied. |
| **DGC-7** | Chimney→Kitchen arrival: abbreviated revisit view, not full description | BD7 / chimney | dfrotz climb chimney into already-visited Kitchen; capture the brief arrival. |
| **DGC-8** | ~~Disambiguation prompt Oxford-comma format~~ **moot** — BD8 fixed at main (§2-A); row retained so V2's diff audit can still map any disambig delta | BD8 | dfrotz a genuinely ambiguous command; capture the exact "the X, the Y, or the Z?" line. |
| **DGC-9** | Movement-arrival lines after first visit lose their ldesc re-print (TOUCHBIT-gated brief mode, CB5 §4.6); DGC-7 is one instance of this class | CB5 / gverbs.zil:1650–1678 | Re-run the golden command file through dfrotz R119; every revisit-arrival line re-baselines from that single transcript. The stash@{1} test deltas predict the blast radius (RESERVOIR-SOUTH, DAM room, +more) but are NOT a source — dfrotz is. |

**Provenance contract (L41, added 2026-06-12):** every oracle corpus file and golden baseline
carries a first-line header naming its generator — `# generated-by: dfrotz-r119 <date> <cmd>`
vs `# generated-by: engine <commit>` — and every consuming test ASSERTS the expected header
before comparing a byte. `UPDATE_GOLDEN=1` is BANNED for any file claiming dfrotz provenance
(it silently flips the anchor to a mirror — the V2-leg incident). The engine-golden
(walkthrough-master.txt) may regenerate under UPDATE_GOLDEN=1 only when the resulting diff is
audited line-by-line against the DGC register. Gate criteria that say "proven against dfrotz"
direct the gate to RUN dfrotz — never to inspect committed artifacts claiming it.

**Procedure invariant:** for every DGC entry, the new golden line is produced by a
**single `dfrotz R119` run of the pinned command file** — full-transcript capture, output
pasted verbatim. The replacement must be keyed on **(command, move#)** from that transcript,
never on raw line numbers (which drift with every golden edit). The §10.2 audit checks that
every changed line in the golden maps to a DGC row, and verifies each replacement against
**that single transcript** — not against our engine's output, and not against a prior golden
snapshot. Re-baselines are never self-referential. A reviewer audits: (1) diff golden vs
previous golden, (2) every changed line names a DGC row, (3) that row's dfrotz capture
contains the new line at the claimed (command, move#).

---

## 9. Coordinate Seams (explicit cross-spec dependencies)

| Seam | Phase 3 side | Other side | Contract |
|------|--------------|-----------|----------|
| **STILETTO** | STILETTO-FUNCTION loose/held-by-player responses (§6.8) | **thief spec** | thief-possession branches (RECOVER-STILETTO, drop-on-death) stay in thief spec; do not guess thief state |
| **LOUD-ROOM** | NOT built here | **dam spec** | LOUD-ROOM read-loop is entangled with GATES-OPEN/LOW-TIDE; stays in dam |
| **V-DIAGNOSE** | reads `pStrength` + I-CURE C-ENABLED?/C-TICK (§4.7) | **Phase 2 combat** | substrate lands tonight; Phase 3 only reads it |
| **V-PRAY / ghost mode** | living V-PRAY teleport (§4.2) | **Phase 2 DT2** | when `dead`, ghost dispatch takes precedence; V-PRAY here is the not-dead path |
| **jigsUp** (BURN, RUSTY-KNIFE, BOOM-ROOM, V-THROW@ME) | call the threaded `ctx.jigsUp` | **Phase 2 death.ts** | death routes through Phase-2 jigsUp; no separate death path |
| **LUCKY** (mirror break) | sets LUCKY=false (§6.6) | **Phase 2 zprob** | faithful — combat LOSE-WEAPON drops to ~1/3 once mirror broken |
| **I-XB/I-XC** registration | registers the slots (§6.1) | **Phase 2 KILL-INTERRUPTS** | the kill-list already names them as no-op-if-unregistered; they become live, list unchanged |
| **River-adjacent room text** | scenery M-LOOK for cliffs/canyon (§6.9/§6.10) | **dam/river spec** | current/boat behavior stays in river spec; Phase 3 ports only descriptions |

---

## 10. Verification Strategy

Three nets, per the project's faithfulness discipline. **Combat-style suspicion** applies to
every seeded/RNG handler (BAT FLY-ME, SONGBIRD, BD2 grue): assert the *branch and structure*,
never a specific RNG draw against the golden (Path B fence).

### 10.1 dfrotz oracle corpus, per cluster

A dedicated dfrotz-anchored corpus file per region — built with the
`zork-oracle-corpus-expand` tooling against **dfrotz R119**:
- `clock-blocked-move.txt` — blocked move then a timer check; proves the recovered tick (CA1).
- `wait.txt` — `wait` from a known state; 3 ticks + mid-wait warning (CA2).
- `verb-defaults.txt` — each priority verb default string (CLIMB/PRAY/RING/TIE/BURN/THROW/GIVE/
  WEAR/MOVE/RAISE/LOWER/LOCK/ENTER/EXIT) at a state where the default (not an FCN) fires.
- `hades-exorcism.txt` — ring→candles→read success + the 6-tick break + 20-tick cooldown (CC1).
- `dome-rope.txt`, `coal-machine.txt`, `bat-garlic.txt`, `mirror.txt`, `bottle-water.txt`,
  `boom-room.txt`, `cave2-candle.txt`, `south-temple-coffin.txt` — one per region (CC2–CC10).
- `lamp-off-dark.txt` (BD1), `inventory-format.txt` (BD3), `chimney-arrival.txt` (BD7).

Each corpus run classifies divergences; a clean run is the cluster's correctness gate.

### 10.2 Golden re-baseline protocol (never self-referential)

Run the existing 218-command golden through dfrotz R119; diff our engine's output against
dfrotz (NOT against the old golden). Every divergence must map to a **DGC row** (§8) — if it
does, patch that golden line from dfrotz's capture; if it does NOT, it is a regression and the
build halts. The normalizer's known false-diff (trailing `;` treated as paragraph terminator —
overnight §3) must be fixed or excluded so it doesn't mask a real diff.

### 10.3 Unit tests for timer re-arms (the silent-failure net)

The timer re-arms are the highest silent-failure risk (a missing re-queue looks fine until the
timer should fire a second time). Dedicated unit tests, forced/seeded clock:
- **Match re-arm (CA3):** light → 2-tick burnout; light again → burns out *again* (not
  permanently dead); MATCH-COUNT decrements, caps at 6.
- **Candle first-touch (CA3/§3.4):** touch lit candles → I-CANDLES armed (assert the slot is
  enabled with the correct tick), independent of burn/relight.
- **I-XB/I-XC/I-XBH (CC1):** ring arms I-XB(6)+I-XBH(20); candles-lit within 6 disables I-XB,
  arms I-XC(3); read within 3 sets LLD-FLAG; let I-XB lapse → ceremony breaks.
- **I-FOREST-ROOM (§6.9):** slot registered (no longer a dead enableClock); `prob(15)` chirp
  over a seeded run (structural — count in range, not a fixed draw).
- **Blocked-move tick (CA1):** a blocked move increments `moveCount` and advances every enabled
  timer by exactly 1; a *parse failure* does NOT (clock-main-loop.md §14.1).
- **V-WAIT no-double-tick (CA2):** `wait` advances exactly 3, the turn loop adds 0.

### 10.4 Test-authoring contract (L40, added 2026-06-12)

A test that can pass without the implementation existing is vacuously green. Binding rules for
every test this wave ships: (1) **world-state prerequisites assert-and-fail** — a missing
prerequisite is a setup bug, never an early-return (`if (!lungs) return` shipped a double
authoring error behind one guard); (2) guard/NM suites ban conditional early-returns outright
in done-criteria; (3) new task **V4** sweeps existing test files for the
`if (...) return`-above-an-expect pattern (known sightings: map-integration ×2,
villain-side-wiring ×3, NM-F) and converts each to assert-and-fail. Reviewers reject any task
whose tests violate (1)/(2) regardless of green.

---

## 11. Build-Task DAG (authored for a pod-wave)

`foundation (clock) → parallel verb/puzzle clusters → bug worklist → verification`. Each task
lists deps / files (verdict) / done-criteria, sized so clusters are independently verifiable.

### Wave 0 — Clock foundation (FIRST; re-baselines everything)

- **CA1 — Blocked-move CLOCKER tick.** `game.ts` EXTEND: parse-success RFATAL moves tick CLOCKER
  before `break`; parse-failure and meta still don't tick. Deps: none. Done: blocked-move tick
  unit test; `clock-blocked-move.txt` clean vs dfrotz; **DGC-1 golden re-baseline applied**.
- **CA2 — V-WAIT audit/reconcile (AMENDED 2026-06-12).** The dam wave already ships 3-tick
  loop-driven wait (game.ts:857–885, dfrotz-validated). Audit it against the ZIL edge set
  (§3.2 amended): no-double-tick, mid-wait early stop, mid-wait death, wait-in-dark; author
  `wait.txt`; ratify loop-driven-equivalent (OQ-8) or refactor to impl (a) ONLY on a proven
  edge divergence. Deps: CA1. Done: edge audit documented; `wait.txt` clean; DGC-2 applied
  only if remaining wait lines shift.
- **CA3 — Match re-arm + candle first-touch.** `light-sources.ts` EXTEND using Phase-2 `queue`.
  Deps: CA1 (and Phase-2 `queue` landed). Done: match re-arm test; candle first-touch arm test.

### Wave 1 — Verb priority cluster (parallel; deps: CA1 + CB0)

- **CB0 — PRSA ratify+unify (NEW 2026-06-12; §5.1).** The contract-layer prerequisite: canonical
  `ctx.action` dispatch, populated at every dispatch site; idiom unification (action-checks vs
  prep-predicates); handler sweep; ≥1 non-primary-synonym test per CB verb. Deps: CA1. Done:
  §5.1 criteria, incl. the no-`ctx.verb`-action-dispatch grep.
- **CB1 — Movement verbs.** CLIMB family (§4.1), ENTER/EXIT/LOCK/UNLOCK (§4.8). `verbs/index.ts`
  NEW. Done: `verb-defaults.txt` rows for these; `climb tree` reaches UP-A-TREE.
- **CB2 — Object verbs.** RING/TIE/UNTIE/TIE-UP (§4.3), BURN+PRE-BURN (§4.4), THROW/GIVE/WEAR/
  MOVE (§4.5). Deps: Phase-2 jigsUp (BURN/THROW death). Done: each default string exact; death
  branches route through jigsUp.
- **CB3 — PRAY (AMENDED: verify-only).** Body exists (§4.2 amended). Audit vs gverbs.zil:1047 +
  ghost-precedence seam test. Done: audit note; seam test green; no rebuild.
- **CB4 — HACK-HACK family.** Shared helper (§4.5) + RAISE/LOWER/KICK/PUSH/RUB/WAVE one-liners +
  HO-HUM PICK-ONE. Done: GLOBAL-OBJECTS "isn't here!" branch; 3-string PICK-ONE.
- **CB5 — Meta-verb bodies + brief mode.** VERBOSE/BRIEF/SUPER-BRIEF/VERSION/SCRIPT/QUIT (§4.6) +
  wire VERBOSE/SUPER-BRIEF into DESCRIBE-ROOM revisit. Done: verbosity globals flip; revisit
  brief view; V-QUIT renders score + gameOver (web-shell).
- **CB6 — V-DIAGNOSE audit (AMENDED: body exists, index.ts:816–857).** Line-by-line vs
  1actions.zil:3993–4025; fix divergences in place (§4.7 amended). Done: healthy/wounded
  readouts match ZIL; cure-moves arithmetic vs live I-CURE; divergence list documented.

### Wave 2 — Puzzle handlers (parallel; deps: CA1, CA3 for timer-touching ones)

- **CC1 — Hades exorcism.** `hades.ts` NEW: LLD-ROOM + GHOSTS-F/BELL-F/HOT-BELL-F/BLACK-BOOK +
  I-XB/I-XC/I-XBH (register slots). Deps: CA3 (candle disable on ring). Done: full ceremony +
  break + cooldown; KILL-INTERRUPTS now disables the live slots (seam §9).
- **CC2 — Rope/dome.** `dome-rope.ts` NEW: ROPE-FUNCTION/DOME-ROOM-FCN/TORCH-ROOM-FCN. Deps:
  CB2 (TIE seam). Done: tie→DOME-FLAG, descent gate.
- **CC3 — Coal-mine machine.** MACHINE-F/MSWITCH-FUNCTION/BASKET-F + MACHINE-ROOM-FCN. Deps: CB4
  (RAISE/LOWER seam). Done: coal→diamond; basket lower carries the LIGHT-SHAFT load (Phase-2 +13).
- **CC4 — Bat/garlic.** BAT-F/FLY-ME/GARLIC-F. Done: teleport (seeded structural) / repel.
- **CC5 — Skeleton (AMENDED: reuse thief.ts `rob()`, OQ-9).** SKELETON via the existing shared
  rob (§6.5 amended); no new helper. Done: valuables scatter through thief.ts:80.
- **CC6 — Mirror.** MIRROR-MIRROR. Done: swap+teleport; break sets LUCKY=false (assert Phase-2
  zprob reads it).
- **CC7 — Bottle/water.** BOTTLE-FUNCTION/WATER-F. Done: drink/pour/closed-gate.
- **CC8 — Weapons (AMENDED: stiletto dropped — already live).** KNIFE-F/AXE-F/RUSTY-KNIFE-FCN
  only, via existing `weaponFunction` (§6.8 amended). Deps: Phase-2 jigsUp + TROLL-FCN (AXE).
  Done: rusty-knife death; KNIFE/AXE responses; stiletto untouched.
- **CC9 — Ambience/scenery.** WHITE-HOUSE-F/FOREST-F/SONGBIRD-F + I-FOREST-ROOM register +
  GRANITE-WALL-F + CLIFF/WCLIF-OBJECT scenery (descriptions only, per OQ-3 ratification).
  Done: scenery text; chirp at ~15%; I-FOREST-ROOM dead enableClock resolved; I-SWORD
  confirmed live from phase-2 H3 (no additional work).
- **CC10 — Misc room FCNs (AMENDED: DEEP-CANYON-F dropped — dam built it).** BATS-ROOM/
  BOOM-ROOM/CAVE2-ROOM/SOUTH-TEMPLE-FCN + CANYON-VIEW only-if-ZIL-defines-it (§6.10 amended).
  Deps: CA3 (CAVE2 candle), Phase-2 jigsUp (BOOM). Done: per-room M-codes vs dfrotz; BOOM
  explosion; CAVE2 blow-out; coffin-gate.
- **CC11 — TROLL-ROOM-F (NEW, §6.11).** Register the M-ENTER THIS-IS-IT binding; no-double-
  binding test with parser bindPronouns. Deps: none (uses existing setItRef hook). Done: §6.11
  criteria.

### Wave 3 — Engine-behavior bug worklist (deps: relevant clusters)

- **BD-A — Display bugs.** BD1 (lamp-off pitch-black), BD3 (V-INVENTORY PRINT-CONT rewrite),
  BD7 (chimney brief arrival). Deps: none structural. Done: DGC-3/4/7 re-baselined from dfrotz.
- **BD-B — Object-state bugs.** BD4 (V-PUT checks + TOUCHBIT/SCORE-OBJ). *(BD5 DONE-in-phase-2
  — commits 5f88eee + a7dbe5d; DGC-6 already applied to the golden; no work here.)*
  Done: DGC-5 (V-PUT capacity/scoring lines dfrotz-confirmed).
- **BD-C — Parser/movement bugs (AMENDED).** BD2 (dark-no-exit grue PROB 80 — seeded, fence) +
  BD6 narrowed (container-reveal rebind audit only; coordinate CC11). BD8 dropped — fixed at
  main (§2-A). Done: grue branch test; reveal-rebind audit + fixes.

### Wave 4 — Verification consolidation

- **V1 — Per-cluster oracle corpora.** All §10.1 corpus files clean vs dfrotz R119. Deps: all CB/CC/BD.
- **V2 — Golden re-baseline + DGC audit.** Diff golden vs dfrotz; every changed line maps to a
  DGC row; no unregistered diff; normalizer trailing-`;` false-diff fixed (normalizer.ts:261 —
  still unfixed at main, §2-A); **provenance headers (L41/§8) added to every corpus + golden
  file and asserted by their tests; the gate RUNS dfrotz directly**. Deps: V1.
- **V3 — Timer re-arm unit suite.** §10.3 — the silent-failure net. PLUS: verify the
  KILL-INTERRUPTS list (death.ts:112–116) against ZIL's KILL-INTERRUPTS routine in
  1actions.zil — document why each dam/thief/fight slot is present or absent; fidelity rules.
  Deps: CA3, CC1, CC9.
- **V4 — Conditional-guard lint sweep (NEW, §10.4/L40).** Sweep all existing test files for
  early-return-above-expect guards; convert to assert-and-fail. Deps: none (parallel).

**Sequencing note:** CA1 is the literal first task — it shifts golden timer lines (DGC-1), so all
timer-touching corpora and the golden re-baseline must run *after* it. The verb and puzzle
clusters are mutually parallel once CA1 lands; the bug worklist is parallel except where it
depends on a cluster (BD-A V-INVENTORY is independent; CC10 BOOM needs Phase-2 jigsUp).

---

## 12. Phase Gates

### G1 — Build / Merge
- [ ] Clock fidelity: blocked-move tick, V-WAIT, match/candle re-arms — all corpus-clean.
- [ ] Verb priority cluster registered; every default string verbatim from gverbs.zil; the
      fabricated fallback narrowed (only non-cluster verbs still hit it).
- [ ] Puzzle handlers (Hades/dome/machine/bat/skeleton/mirror/bottle/weapons/ambience/misc)
      registered; per-region corpora clean.
- [ ] Bug worklist landed; **every golden change maps to a DGC register row** (no unregistered
      diff); golden re-baselined against dfrotz R119, never self-referentially.
- [ ] Timer re-arm unit suite green; I-FOREST-ROOM registered (dead enableClock resolved);
      I-SWORD dead call removed + noted in known-issues.
- [ ] Full suite green; merged to the working branch (human commit voice; never detach).

### G2 — Deploy + Smoke
- [ ] Deployed build: a blocked move ticks the lamp; `wait` passes time; the exorcism completes;
      the coal machine makes a diamond; a verb from the priority cluster gives its ZIL response.

### G3 — Playtest-Ready
- [ ] Known-issues updated (AMENDED 2026-06-12 — thief/cyclops/dam/river are LIVE, not
      deferred): priority verbs live, remaining non-cluster verbs still fall back (tracked);
      temple/Hades now functional (retire the "puzzles aren't fully wired" line shipped
      2026-06-12); save/restore still deferred (issue #11); the 2026-06-12 Known-Issues list
      in shell.ts is the baseline to amend.

---

## 13. Open Questions for Sign-off

1. **OQ-1 — V-WAIT clock implementation: (a) META + internal advances, or (b) loop's tick is
   the 3rd?** §3.2 recommends **(a)** (matches ZIL CLOCK-WAIT exactly; V-WAIT owns all its ticks).
   Confirm (a) so the wave author doesn't re-derive. *(Recommended default: (a).)*
   **RATIFIED (2026-06-10):** option (a) — V-WAIT is META + exactly THREE internal clock advances
   per ZIL. Additionally: a 1-tick V-WAIT was added during the phase-2 W1 repair (commit 93d96cc)
   — the wait task (CA2) RECONCILES that interim implementation to 3 ticks rather than building
   fresh; the golden/oracle lines around waits will shift accordingly under the DGC register
   (DGC-2). The wave author must not build CA2 as a net-new verb — audit the existing
   implementation first and adjust it to the 3-tick faithful form.

2. **OQ-2 — I-SWORD: register the slot or leave the dead call removed?** Sword glow is a
   combat-adjacent demon. Phase 3 recommends **removing the dead enableClock call** and noting
   I-SWORD as a deferred combat-demon seam (not wiring it this phase). Confirm — or pull it in if
   the sword glow is wanted now. *(Recommended default: remove + defer.)*
   **RATIFIED (2026-06-10):** RESOLVED — I-SWORD is registered NOW in the phase-2 hotfix H3
   (registered clock entry, glow transitions, KILL-INTERRUPTS list updated). This wave therefore
   inherits a working I-SWORD. Remove any task language that assumes the dead enableClock call
   needs to be removed; the call is live. The known-issues note about I-SWORD is no longer needed.

3. **OQ-3 — Cliff/canyon movement (climb down the cliff, river-adjacent navigation): port the
   movement now, or only the scenery descriptions?** §6.9/§6.10 scope this to *descriptions
   only*, deferring movement to the dam/river spec (WHITE-CLIFFS-FUNCTION boat-deflate gating is
   river-entangled). Confirm the description-only cut. *(Recommended default: descriptions only.)*
   **RATIFIED (2026-06-10):** cliff/canyon descriptions only; movement stays with the dam/river
   wave.

4. **OQ-4 — `rob` helper for SKELETON: minimal SKELETON-only scatter, or build the shared ROB
   now?** §6.5 recommends a **minimal scatter** to avoid pre-empting the thief spec's full ROB/
   STEAL-JUNK/DROP-JUNK. Confirm the minimal cut. *(Recommended default: minimal.)*
   **RATIFIED (2026-06-10):** SKELETON uses a minimal scatter helper; shared ROB arrives with the
   thief wave.

5. **OQ-5 — V-VERSION release/serial: pinned project constants vs faithful Infocom R119
   values?** There is no story-file header to read (`GET 0 1` / `GETB 0 17..23`). Recommend
   pinning the **faithful R119 release/serial** as constants so VERSION matches dfrotz exactly.
   Confirm the values to pin (or accept a project-version string). *(Recommended default: pin R119.)*
   **RATIFIED (2026-06-10):** V-VERSION pins the faithful Revision 88 / Serial 840726 constants.

6. **OQ-6 — Is the existing 218-command golden's V-INVENTORY line authoritative for ANY assertion
   until DGC-4 lands?** It currently encodes the bug (BD3). Recommend treating every
   inventory/`i` golden line as **provisionally wrong** and gating it behind DGC-4's dfrotz
   re-baseline — no test may assert the old flat-list form. Confirm. *(Recommended default: gate
   behind DGC-4; old form is not authoritative.)*
   **RATIFIED (2026-06-10):** the existing golden V-INVENTORY line is gated behind DGC-4's dfrotz
   re-baseline (single-transcript protocol per §8); no test may assert the old flat-list form
   until DGC-4 lands.

7. **OQ-7 — Room-description precedence: ldesc-wins (current code) or handler-wins (ZIL)?**
   **RATIFIED (2026-06-12, autonomous run — user review pending):** handler-wins-with-ldesc-
   fallback, transcribed from gverbs.zil DESCRIBE-ROOM (§4.6 amended, item 2). Supersedes the
   28bfc98 ldesc-deletion pattern; the 16 default-state ldescs stay as fallbacks.

8. **OQ-8 — V-WAIT mechanism: keep the dam wave's loop-driven 3-tick form, or refactor to
   OQ-1's option (a)?** **PROVISIONALLY RATIFIED (2026-06-12, autonomous run):** keep the
   loop-driven form IF the CA2 edge audit (§3.2 amended) passes all four edges; refactor to (a)
   only on a proven divergence. Rationale: the form is dfrotz-validated by six dam corpora;
   mechanism purity does not outrank behavioral anchoring.

9. **OQ-9 — SKELETON rob helper.** **RATIFIED (2026-06-12, autonomous run):** OQ-4 is obsolete —
   its premise (thief wave unbuilt) inverted when the thief wave merged first. CC5 reuses
   thief.ts `rob()`; building a parallel minimal helper is forbidden duplication.

---

## 14. Amendment Log

**Amendment A — 2026-06-12 (autonomous overnight run; evidence: two Explore sweeps at main
230c07a, stash@{1} diff, tooling-lessons L38/L40/L41, commits 5d64188/28bfc98/566b320/949c37b).**
Changes: §2-A re-measurement block (line refs re-pinned; stale deferrals inverted to
reuse-constraints); CA2 → audit/reconcile (dam's 3-tick wait); CB0 added (PRSA ratify+unify,
§5.1); CB3/CB6 → verify/audit (bodies exist); CB4 → replace fabricated V-RAISE/V-TIE-UP shells;
CB5 expanded (BRIEF mode, OQ-7 precedence flip, ldesc-retirement contract, stash@{1} as
reference-not-patch, DGC-9); CC5 → reuse shared rob (OQ-9); CC8 → stiletto dropped; CC10 →
DEEP-CANYON-F dropped, CANYON-VIEW verify-first; CC11 added (TROLL-ROOM-F); BD6 narrowed; BD8
closed (fixed at main); DGC-8 mooted; DGC-9 added; §8 provenance contract (L41); §10.4
test-authoring contract (L40); V2/V3 expanded; V4 added; G3 deferral list corrected;
OQ-7/8/9 ratified (autonomous — user review pending).
