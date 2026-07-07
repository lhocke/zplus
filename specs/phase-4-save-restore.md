# Phase 4 — Save / Restore / Restart

**Status:** FINALIZED 2026-06-13 — Amendment B folded; owner decisions: RNG=concrete-Rng+loud-fail, clock=aux-data. Ready for the post-world-verbs-merge build wave (re-measure the global/flag inventory first — §3.4).
**Date:** 2026-06-12
**Owner:** Dylan
**Repo:** lhocke/zork-workflow (private)
**Measured at:** `main 3d5c7f9` (HEAD on the spec branch; one commit ahead of the
`cb69d57` phase-3-dam-river merge). Every `file:line` below is pinned to this checkout —
re-grep before editing if HEAD has moved.

> Phase 4 closes the last deferral that has shadowed every prior phase: **the player
> cannot keep a game.** `V-SAVE` / `V-RESTORE` / `V-RESTART` sit in `META_ACTIONS` with no
> bodies (`verbs/index.ts:1149–1162`); `doFinish` documents RESTART/RESTORE as no-ops
> (`game.ts:281`); the FINISH prompt loop is omitted; and the death flow's
> `randomizeObjects` actively *destroys* recoverable state (`death.ts:43`, `:284`), which
> is precisely what makes a pre-death save valuable. The unifying spine, as in Phases 2–3,
> is **fidelity to ZIL** — the verb responses are transcribed verbatim from
> `gverbs.zil:71–82` (V-SAVE / V-RESTORE / V-RESTART), and dfrotz prints `Ok.` / `Failed.`
> on those verbs. But save UI semantics are **necessarily web-adapted**: there is no
> Z-machine save file, no `RESTART`/`RESTORE`/`QUIT` blocking READ loop, and no disk. This
> spec defines the **faithful-divergence boundary** — where the text stays byte-exact and
> where the mechanism is honestly web-native — and the **serialization surface** that makes
> a restored game provably continue identically to the one that was saved.

---

## 1. Goal & Scope

### What Phase 4 proves

A restored game is **byte-identical in its future** to the game that was saved. Concretely:
play N commands, `save`, play M more, `restore`, replay the same M commands — the two
transcripts must be byte-for-byte equal. This is the **save-correctness oracle** (§10.1),
and it is only true if *every* mutable byte of game state round-trips — including the two
RNG stream positions, without which a restored game diverges from its own future the first
time anything random fires (a grue check, a songbird chirp, a bat teleport, a combat blow).

Three clusters, in dependency order:

1. **The serialization surface** — define `SaveState`, the full enumerated snapshot of game
   state, and the `snapshot()` / `restore(state)` methods on `Game` that produce and consume
   it. This is the foundation; the verb bodies and the UI are thin layers over it. The
   highest-risk, least-obvious members are the **two RNG positions** and the **module-level
   ZIL globals** that live outside the `Game` instance (§2).
2. **The verbs** — `V-SAVE` / `V-RESTORE` / `V-RESTART` bodies wired into `ACTION_HANDLERS`,
   each emitting the **exact `gverbs.zil` text** (`Ok.` / `Failed.`), routed through a
   web-native persistence port rather than the Z-machine `SAVE`/`RESTORE` opcodes.
3. **The persistence layer + UI** — device-local `localStorage` (the sanctioned Phase-1
   mechanism per `shell.ts:1155–1157`), a slot model, a build-id version stamp, in-voice
   corruption / cross-version handling, and the shell affordance (verbs-first, with a
   minimal slot-argument convention and an optional slot picker).

### In scope

- **`SaveState` schema + `Game.snapshot()` / `Game.restore()`** (§3) — the complete,
  enumerated serialization surface: object-tree deltas (parent / flags / props / mutable
  desc-ldesc-fdesc), the `FlagStore`, the `Scoring` accumulators, every `Game` death/encumbrance/
  dam-river global, `moveCount`, the `visited` set, the stashed-command (M-END) fields, the
  `Clock` snapshot (already exists — `clock.ts:143–162`), the parser's `itRef`/continuation
  state, and — load-bearing — **both RNG stream positions** (main + combat).
- **The module-global capture/restore problem** (§3.4) — `thief-state.ts`, the
  `above-ground.ts` region globals, and `light-sources.ts` `MATCH-COUNT` hold mutable ZIL
  globals *outside* the `Game` instance, reachable today only through the `reset*()` functions
  `createSession` already enumerates (`session.ts:9–16,45–51`). Phase 4 makes each
  serializable (capture + restore), not just resettable.
- **The verb bodies** (§4) — `V-SAVE` (`gverbs.zil:78–82`), `V-RESTORE` (`:71–76`, including
  the `V-FIRST-LOOK` re-describe on success), `V-RESTART` (`:63–69`). Web-adapted prompt
  handling (§4.4); the `Ok.` / `Failed.` strings are byte-exact.
- **The persistence port + slot model** (§5) — a `SavePort` interface (capability boundary),
  a `localStorage`-backed implementation, **3 named manual slots + 1 autosave-on-death slot**
  (§6, recommended default), a **build-id version stamp** with graceful cross-version refusal
  (§5.3), corruption handling in-voice.
- **The shell affordance + telemetry** (§7) — verbs-first SAVE/RESTORE with a minimal
  `save <slot>` / `restore <slot>` argument convention; an optional slot picker modal;
  `PlaytestSink` events for save/restore (§7.2).
- **Verification** (§10) — the round-trip property tests (the oracle), corruption/version-skew
  unit tests, and the **no-hard-locks invariant must hold across a restore** (House Style:
  reachable ⇒ escapable ⇒ can-return must survive load).

### Explicitly out of scope (note the migration path; do not build)

- **Cross-device / server-side (D1) persistence.** `localStorage` is the sanctioned Phase-1
  mechanism (`shell.ts:1155–1157`); server-side is a *later* migration, with `localStorage`
  demoted to cache/fallback after that. Phase 4 builds the `SavePort` boundary **so that
  migration is a port swap, not a rewrite** — but ships only the `localStorage` adapter.
- **Cloud saves / account sync / save sharing.** Out.
- **Archipelago integration.** The AP multiworld save/seed coupling is its own decision
  (see the archipelago-connection memory); do not entangle it here.
- **A faithful Z-machine save file** (Quetzal / `.qzl`). The web port has no story file
  and no Z-machine; save is a JSON snapshot of *our* engine state. This is the headline
  faithful-divergence (§4.1) — the text is faithful, the substrate is not.

### Non-goals

- No new RNG path. Path B (Mulberry32) stands; Phase 4 only **reads and writes** the existing
  `Rng.state` (a serialization concern, not an RNG-design concern).
- No re-architecture of the parser, the clock, or the object tree. Phase 4 adds a
  snapshot/restore *traversal* over the existing structures; it does not reshape them.
- No undo / multi-step history. Save is a point-in-time snapshot, not a command journal
  (a journal is a possible future alternative — see OQ-7).

---

## 2. Current-State Reconciliation

Measured against `src/` at `main 3d5c7f9`. Legend: **NEW** = create; **EXTEND** = add to
existing, keep the rest; **DONE** = already built; **GAP** = a serialization hole that must
be closed before round-trip can hold.

### Verbs — EXTEND (META slots exist, no bodies)

`META_ACTIONS` (`verbs/index.ts:1149–1162`) already lists `V-SAVE`, `V-RESTORE`, `V-RESTART`
(alongside the other meta verbs). They are **correctly meta** (save/restore/restart consume no
game time — they are not CLOCKER-ticking verbs) and must **stay in `META_ACTIONS`**. But none
has an `ACTION_HANDLERS` body, so each currently falls through to the fabricated
`` I don't know how to "X". `` string (`verbs/index.ts:1170`) — a live fidelity bug identical
in shape to the Phase-3 CB5 meta-verb gap. Phase 4 adds the three bodies.

> **Ghost-mode seam (already handled):** `game.ts:92–93,338–341` routes SAVE/RESTORE/RESTART
> through `META_ACTIONS` pass-through in the dead/ghost dispatch — a dead player can still
> save/restore. The bodies must therefore be callable from ghost mode; the seam already
> passes them through, so no ghost-dispatch change is needed (verify with a test).

### FINISH / doFinish — EXTEND (RESTART/RESTORE are documented no-ops)

`Game.doFinish` (`game.ts:286–295`) is the web-shell `FINISH` (Phase-2 B7): it renders
V-SCORE, prints the terminal string, sets `gameOver`. Its docstring states
*"RESTART/RESTORE are no-ops (save slots deferred)"* (`game.ts:281`). The ZIL `FINISH`
(`gverbs.zil:33–53`) runs a blocking `READ` loop offering `RESTART, RESTORE, or QUIT`.
**Phase 4 does NOT restore the blocking prompt loop** (the web shell has no synchronous
READ — Phase-2 B7 ratified omitting it). Instead, on `gameOver` the shell surfaces a
RESTART / RESTORE affordance (buttons or the slot picker) wired to the same `restore()` /
`restart()` substrate the verbs use (§4.4, §7). `doFinish`'s comment is updated; its
no-op nature at the engine level is retained (the shell drives the choice).

### Clock — DONE (snapshot/restore already present)

`Clock.snapshot()` (`clock.ts:143–150`) and `Clock.restore(snaps)` (`clock.ts:154–162`)
already exist, and `ClockSnapshot` (`clock.ts:41–45`) carries `{id, turnsLeft, enabled}`
per slot. **Coverage assessment:** this round-trips the three mutable per-slot fields
exactly, and `restore()` correctly re-binds onto the *registered* entries (so the tick
callbacks — which are closures over live game state, not serializable — survive). The 8
bootstrap/ctor slots (`I-LANTERN`, `I-CANDLES`, `I-MATCH`, `I-SWORD`, `I-RFILL`, `I-REMPTY`,
`I-MAINT-ROOM`, `I-RIVER`, plus the ctor's `I-FIGHT`/`I-THIEF`/`I-CURE`/`I-CYCLOPS`) are all
re-registered on a fresh `Game`, so a restore onto a freshly-bootstrapped game finds every
slot. **GAP — the `FuelInterrupt.tableIndex`:** `clock.ts:180` holds a *private*
`tableIndex` per fuel interrupt (lamp/candle stage position) that is **NOT** in
`ClockSnapshot`. Two saved games at the same `turnsLeft` but different `tableIndex` would
restore identically and then diverge on the next warning. This is a confirmed serialization
hole (§3.3, SS2). `clock.ts:39–40`'s own comment already anticipates a `SaveState.clock`
field — the type it references does not yet exist.

### RNG — GAP (state is private, no accessor)

`Rng` (`rng.ts`) is Mulberry32 with a single 32-bit `private state` field — trivially
serializable *in principle* (one integer), but there is **no public getter/setter**; only
`seed(s)` sets it (and `seed` is also the constructor arg name, so position ≠ seed once any
draw has happened). **There are TWO independent streams** on `Game`: `this.rng` (main —
grue, `randomizeObjects`, songbird, bat, mirror) and `this.combatRng` (combat blows),
constructed from the same seed but with **independent, diverging positions**
(`bootstrap.ts:245–248`, `game.ts:119–122`). **Both positions MUST round-trip** or a
restored game diverges from its own future the first time either stream fires. This is the
single most failure-prone member of the surface and the reason the round-trip oracle (§10.1)
exercises a randomness-touching continuation. SS-RNG (§3.2) adds `getState()/setState()`
to the concrete `Rng` class and serializes both stream positions (owner decision: §3.2).

### World / object tree — EXTEND (snapshot traversal is NEW)

`World.all()` (`world.ts:156–157`) returns every `GameObject` in insertion order;
`World.get(id)` (`:145`) fetches by id. Each `GameObject` (`game-object.ts:129–182`) carries
the mutable runtime state: `parent` (via `moveTo`, maintaining `children`), `flags: Set<Flag>`,
`props: Map<string,number|string>`, and the mutable `desc` / `ldesc` / `fdesc` (mutated at
runtime — rug→canvas `above-ground.ts:716`, troll/thief LDESC swaps, maint-room flooding
`game.ts:2008`, room ldesc rewrite `game.ts:979`). The id/synonyms/adjectives/handler/
actionRoutine are **immutable structure** (loaded from `objects.json`) and need NOT be
serialized — only the **delta** does. Snapshot iterates `World.all()` and records, per object,
`{parent: parentId|null, flags: Flag[], props: [k,v][], desc, ldesc, fdesc}`; restore replays
each delta and rebuilds the parent/children links via `moveTo`. This traversal is NEW.

### Scoring — GAP (accumulators are private, no setters)

`Scoring` (`scoring.ts:23–27`) holds `_baseScore`, `_score`, `_wonFlag` with **getters only**
(`:45–47`) — no setters. Restore needs to reinstate all three (you cannot replay them from
`scoreUpd` deltas without re-running the whole game). SS3 (§3.5) adds a guarded
`restoreState({baseScore, score, wonFlag})` to `Scoring` (NOT public mutators — a single
restore-shaped method) and `snapshotState()`.

### Game instance globals — EXTEND (enumerate every field)

`Game` (`game.ts:116–170`) holds, beyond the subsystems above: `moveCount` (`:132`),
`deaths`/`dead`/`alwaysLit`/`gameOver` (`:136–139`), `lucky` (`:144`), `loadAllowed`/`loadMax`
(`:147–148`), `waterLevel`/`beachDig` (`:153–154`), `fatalPending` (`:159` — transient,
cleared each turn; do NOT serialize), the stashed-command M-END fields `lastVerb`/`lastAction`/
`lastDobj`/`lastIobj`/`lastPrep` (`:164–168` — `lastDobj`/`lastIobj` are object *references*,
serialize as ids), `visited: Set<ObjectId>` (`:170`), and `here: Room` (serialize as
`here.id`; restore resolves via `world.get`). Every one is enumerated in §3.1.

### Parser — GAP (itRef + continuation are private)

`Parser` (`parser.ts:59–95`) holds `itRef` (the IT pronoun referent — `:59`), `orphan`
(`:65`), `lastInput`/`lastWon` (`:69,73`), and the `continuation` / `parsedQueue` segments
(`:79,84` — the P-CONT buffer). `itRef` MUST round-trip (the prompt names it explicitly:
`it` must mean the same object after restore). `continuation`/`parsedQueue`/`orphan` are
**mid-multi-command-line transient state**; a save mid-continuation is an edge case (§3.6,
OQ-5 — recommend: snapshot at a clean turn boundary where continuation is empty, and assert
it). `lastInput`/`lastWon` feed `V-AGAIN`; serialize `itRef` (required) and decide AGAIN
state per OQ-5.

### Persistence / UI — NEW

`localStorage` is used today only for the theme (`shell.ts:1158,1169`; `main.ts:6`), with the
explicit note that it is the Phase-1 stopgap and "save slots" are the future case
(`shell.ts:1155–1157`). The `SavePort`, the slot model, the version stamp, the corruption
handling, and the shell affordance are all NEW. The build-id stamp source already exists:
`__BUILD_ID__` (Vite-injected, falls back to `'dev'`) is read in `session.ts:22–29` — reuse it.

### Session / sink — EXTEND

`createSession` (`session.ts:43–55`) is the integration seam; it already enumerates the
module-global resets. Phase 4 threads the `SavePort` through `createSession` and adds
save/restore handling to `submit` (or a sibling method), plus the new `PlaytestSink` events.

The `GameSession` interface (`session.ts`) gains three explicit methods:

```ts
save(slot: string): void;
restore(slot: string): void;
restart(): void;
```

> **Name-collision note:** `Game.snapshot()` returns a `SaveState` (engine serialization);
> `GameSession.snapshot()` returns the existing `GameView` (telemetry / live view). These are
> different objects with different purposes — no real collision. State this explicitly in the
> interface docstring so a builder does not conflate them or attempt to unify them.

---

## 3. The Serialization Surface (the foundation)

> **Invariant (the whole spec rests on this):** `SaveState` is the **complete** set of bytes
> that differ between two games that have diverged. If a field that a future command reads is
> omitted, the round-trip oracle (§10.1) catches it *only if* the continuation exercises that
> field — so the enumeration here is the primary correctness artifact, and the oracle is the
> net under it. Treat any field added to `Game` / `Parser` / a module global *after* this spec
> as a save-surface candidate until proven transient (SS-AUDIT, §10.3).

### 3.1 `SaveState` schema (NEW — `src/engine/save-state.ts`)

```ts
interface SaveState {
  // --- versioning / integrity (§5.3) ---
  formatVersion: number;        // bump on any breaking schema change
  buildId: string;              // __BUILD_ID__ at save time; cross-build refusal key
  savedAt: string;              // ISO 8601 — display only
  // --- core counters / flags (game.ts) ---
  moveCount: number;
  deaths: number; dead: boolean; alwaysLit: boolean; gameOver: boolean;
  lucky: boolean;
  loadAllowed: number; loadMax: number;
  waterLevel: number; beachDig: number;
  hereId: ObjectId;
  visited: ObjectId[];
  // stashed-command M-END fields (object refs → ids)
  lastVerb: string; lastAction: string;
  lastDobjId?: ObjectId; lastIobjId?: ObjectId; lastPrep?: string;
  // --- subsystems ---
  rngMain: number;              // Rng.state (main stream)   [SS-RNG]
  rngCombat: number;            // Rng.state (combat stream) [SS-RNG]
  clock: ClockSnapshot[];       // clock.snapshot() — each entry carries aux?.tableIndex
                                // for FuelInterrupt slots (SS2; owner decision: Clock aux data)
  scoring: { baseScore: number; score: number; wonFlag: boolean };  // [SS3]
  flagStore: [string, boolean][];                    // FlagStore entries [SS4]
  objects: ObjectDelta[];                            // per-object delta [SS1]
  parser: { itRef?: ObjectId };                      // [SS5] (+OQ-5 AGAIN/continuation)
  moduleGlobals: ModuleGlobals;                      // [SS6] thief/region/match-count
}

interface ObjectDelta {
  id: ObjectId;
  parent: ObjectId | null;      // parentId; restore via moveTo
  flags: Flag[];                // Array.from(obj.flags)
  props: [string, number | string][];  // Array.from(obj.props)
  desc?: string; ldesc?: string; fdesc?: string;     // mutable text
  pStrength?: number;           // captured ONLY for Actor instances (player + villains carry
                                // combat wound state in this plain field, not in props)
}
```

> **Compactness is a non-goal (OQ-6):** the recommended default is a **full snapshot** of
> every object's delta, not a diff-against-bootstrap. Full snapshot is dumb, robust, and
> version-tolerant; a diff is smaller but couples the save format to the bootstrap world and
> re-introduces a "which fields changed" question every object FCN can silently break. Pin
> full snapshot; revisit only if `localStorage` quota (typically ~5 MB/origin) is threatened
> (the full Zork object tree is well under that — verify the serialized size in SS1's test).

### 3.2 SS-RNG — both stream positions (CRITICAL) — `rng.ts` EXTEND

**Owner decision: concrete-Rng + loud fail.** `Game.snapshot()` requires that both `this.rng`
and `this.combatRng` are instances of the concrete `Rng` class (an `instanceof` check).
If a non-serializable stream (e.g. a test stub such as `ScriptedRng`) is in play, `snapshot()`
**throws** a clear error immediately — it does not silently produce a broken save. Production
always uses the real `Rng`; tests that exercise save use the real `Rng` directly. `getState()`
and `setState()` are added to the concrete `Rng` class ONLY — they are NOT added to any `Rng`
or `CombatRng` interface, and NOT added to any test stub.

`Game.snapshot()` records `this.rng.getState()` and `this.combatRng.getState()` **separately**;
`restore` calls `setState` on both. Done-criteria: a test that draws K times from each stream,
snapshots (with real `Rng` instances), draws more, restores, and asserts the **next draw from
each stream matches** the post-snapshot draw exactly. The two-stream separation is the NM here —
a single saved position that restores onto both streams silently re-couples them (the exact
decoupling `bootstrap.ts:245–248` exists to prevent). A separate test asserts that
`snapshot()` called with a `ScriptedRng` in place of either stream throws with a descriptive
error message.

### 3.3 SS2 — clock fuel stage position — `clock.ts` EXTEND

**Owner decision: Clock aux data.** `FuelInterrupt.tableIndex` (`clock.ts:180`) is not in
`ClockSnapshot`. The approach is: `Clock` gains an optional per-entry aux blob
(`aux?: Record<string, number>`) on the per-slot snapshot entry. `FuelInterrupt` writes its
`tableIndex` into `aux.tableIndex` when snapshotting; reads it back in restore.
`clock.snapshot()` / `clock.restore()` carry the `aux` field generically (no special-casing
for fuel — any clock slot can write into aux). This requires NO change to the `Game`
constructor, bootstrap signature, or any field promotion. Done-criteria: save a game with the
lamp at "definitely dimmer" stage (tableIndex past the first warning), restore, advance one
warning's worth of ticks, assert the **next** warning is "nearly out" (not a repeat of an
earlier stage).

### 3.4 SS6 — module-level ZIL globals (the off-instance state) — `*-state.ts` EXTEND

These globals live in module scope, NOT on `Game`, reachable today only via getters/setters
and the `reset*()` functions `createSession` already calls (`session.ts:9–16,45–51`):

- **`thief-state.ts`** (`:22–58`): `_thiefHere`, `_thiefEngrossed`, `_eggSolve`, `_cyclowrath`
  (number), `_thiefLdesc` (string). (SING-SONG, CYCLOPS-FLAG, MAGIC-FLAG are deliberately
  *not* here — SING-SONG lives in `above-ground.ts`, the FLAGs in the FlagStore — per the
  module's own reconciliation note.)
- **`above-ground.ts`**: the region globals behind `resetKitchenWindowFlag` /
  `resetRugMoved` / `resetGrateRevealed` / `resetGrunlock` / `resetSingSong`.
- **`light-sources.ts`**: `MATCH-COUNT` (behind `resetMatchCount`).

Each module gains a `snapshot<Name>State()` / `restore<Name>State(s)` pair (mirroring its
existing reset). A central `captureModuleGlobals()` / `applyModuleGlobals(s)` in a new
`src/engine/module-globals.ts` aggregates them into the `ModuleGlobals` record (the same list
`createSession` resets — keep the two lists in lockstep; SS-AUDIT §10.3 enforces it). This is
the highest "looks-fine-but-diverges" risk after RNG: a forgotten module global restores to
its *reset* value (often a different game state) with no error.

> **Why not lift these onto `Game`?** Tempting, but out of scope and risky — they are read by
> region FCNs through module imports across the codebase. Phase 4 makes them *serializable*,
> not *relocated*. A future refactor may consolidate them; this spec does not.

### 3.5 SS3 — scoring accumulators — `scoring.ts` EXTEND

Add `snapshotState(): {baseScore, score, wonFlag}` and `restoreState(s)` (a single
restore-shaped method, NOT public field setters). Restore sets `_baseScore`/`_score`/`_wonFlag`
directly without re-firing `wonFlagHook` (the world effects already happened in the saved
game and are captured in the object/flag deltas — re-firing would double-emit the whisper).
NM: restoring must NOT re-run `checkWonFlag`'s side effects.

### 3.6 SS5 — parser state — `parser.ts` EXTEND

`itRef` round-trips (required by the prompt — `it` must rebind correctly). Add
`snapshotState()` / `restoreState()` to `Parser` exposing `itRef` (and per OQ-5, optionally
`lastInput`/`lastWon` for AGAIN). **Continuation/orphan are NOT serialized** — save is refused
(not silently dropped) in two mid-parse conditions:

1. **Mid-continuation:** `hasContinuation()` is true — a multi-command line has queued
   segments not yet dispatched. `snapshot()` asserts this is false; if not, it throws /
   refuses-to-save.
2. **Mid-disambiguation:** `isAwaitingInput()` is true — the parser is awaiting a
   disambiguation response (an "orphan" pending clarification). Save is refused or cleanly
   dropped here for symmetry with mid-continuation, as the orphan state is transient and
   non-serializable. `snapshot()` checks this condition and refuses identically.

See OQ-5 for the AGAIN-state decision. Done-criteria: `it` rebinds to the same object after
restore; mid-continuation save asserts/refuses; mid-disambiguation-await save also refuses.

### 3.7 `Game.snapshot()` / `Game.restore(state)` (NEW — `game.ts`)

`snapshot(): SaveState` gathers every member above. `restore(state: SaveState): void` is the
inverse, in a **fixed order** (subsystems before object tree, object tree before parser, so
e.g. `here` resolves against a restored world). `restore` mutates the *existing* `Game`
in place (it does not construct a new one) — so a restore onto a freshly-bootstrapped game
re-binds onto the already-registered clock closures, the live `World` registry, and the live
module globals. **Version/build guard runs first** (§5.3): a mismatched `formatVersion` or
`buildId` refuses the restore in-voice before mutating anything (no partial restore).

---

## 4. The Verbs (fidelity spine — exact `gverbs.zil` text)

All three already sit in `META_ACTIONS` (§2) and stay there. Each gets an `ACTION_HANDLERS`
body. The default-response strings are **verbatim from `gverbs.zil`** — never invented.

### 4.1 The faithful-divergence boundary (documented)

| Surface | Faithful (byte-exact) | Web-adapted (honest divergence) |
|---------|----------------------|--------------------------------|
| `V-SAVE` success/fail text | `Ok.` / `Failed.` (`gverbs.zil:80,82`) | substrate is a JSON snapshot to `localStorage`, not a Z-machine `SAVE` opcode to disk |
| `V-RESTORE` success | `Ok.` then re-describe room (`V-FIRST-LOOK`, `:73–74`) | re-describe = call the existing room-look path after `restore()` |
| `V-RESTORE` fail | `Failed.` (`:76`) | "fail" = no save in slot / corrupt / version-skew (§5.3) |
| `V-RESTART` | prompt + `Restarting.` (`:67`) | no blocking READ; web shell re-bootstraps the session (§4.4) |
| `FINISH` prompt loop | (text retained where shown) | no synchronous `READ` loop — shell affordance drives the choice (§2, Phase-2 B7) |

> dfrotz on `save` / `restore` prints `Ok.` / `Failed.` (verified against `gverbs.zil:71–82`;
> the surrounding Z-machine save-file dialog — filename prompt — is interpreter UI, not story
> text, and has no faithful web analog). **The `Ok.`/`Failed.` lines are oracle-anchored;
> the save UI around them is documented web-divergence, not a fidelity bug.**

### 4.2 V-SAVE — `gverbs.zil:78–82`

```zil
<ROUTINE V-SAVE ()
	 <COND (<SAVE>
	        <TELL "Ok." CR>)
	       (T
		<TELL "Failed." CR>)>>
```

Port: build a `SaveState` via `game.snapshot()`, write it through the `SavePort` to the target
slot (§5). On success → `Ok.`; on failure (quota exceeded, port error) → `Failed.`. The slot
is resolved from the command argument (§4.5) or the default slot. Meta (no time advance).
Done (PB-SAVE): `save` writes a readable `SaveState` to the slot and prints exactly `Ok.`; a
forced port failure prints exactly `Failed.`.

### 4.3 V-RESTORE — `gverbs.zil:71–76`

```zil
<ROUTINE V-RESTORE ()
	 <COND (<RESTORE>
		<TELL "Ok." CR>
		<V-FIRST-LOOK>)
	       (T
		<TELL "Failed." CR>)>>
```

Port: read the `SaveState` from the slot; if absent/corrupt/version-mismatched → `Failed.`
(§5.3 decides which failures are silent-`Failed.` vs in-voice — recommend: `Failed.` for
"no save here", in-voice line for corruption/version, see OQ-3). On success → `restore(state)`,
print `Ok.`, then **re-describe the current room** (the `V-FIRST-LOOK` faithful step — call the
existing look path, e.g. the same routine `start()` / `verbLook` uses). Meta. Done (PB-REST):
restore from a valid slot prints `Ok.` + the room description; restore from an empty slot prints
exactly `Failed.`.

### 4.4 V-RESTART — `gverbs.zil:63–69` (web-adapted)

ZIL `V-RESTART` runs `V-SCORE`, a `Y` prompt, then `<RESTART>` (re-initializes the world).
**Web shell:** there is no synchronous prompt (Phase-2 B7 omitted the blocking loop). Recommend:
`restart` triggers a session re-bootstrap (a fresh `createGame` + the module-global resets
`createSession` already runs) — equivalent to reloading. Confirmation is a **shell-side**
concern (a confirm dialog / "are you sure" affordance — OQ-4), not an engine prompt. The
faithful `Restarting.` line prints on confirm. Done (PB-RESTART): `restart` (confirmed)
returns the game to the opening room/score/moves with all module globals reset; the no-confirm
path leaves state unchanged.

> **`doFinish` reconciliation:** on `gameOver`, the shell surfaces RESTART / RESTORE wired to
> the same substrate (§7); `doFinish`'s engine-level no-op stands, its docstring is updated to
> point at the shell affordance instead of "deferred".

### 4.5 Slot-argument convention (minimal)

Verbs-first, faithful text, with a **minimal argument convention** parsed shell-side (NOT a
grammar.json change — out of scope per the parser non-goal):

- `save` / `restore` / `restart` (no arg) → the **default slot** (slot 1 / "quicksave" slot).
- `save 2` / `restore 3` / `save mygame` → a named/numbered slot (1–3, or a label).
- Out-of-range / unknown slot → in-voice "There is no save slot N." rather than
  `Failed.` (which should mean "the restore was attempted and the data was unusable"). OQ-3.

**Exact interception contract:** `session.submit()` pre-processes the raw command string with a
regex that strips a trailing slot number or label before the string reaches `META_ACTIONS`
dispatch. Example: `"save 2"` → slot `"2"`, command word `"save"`; `"restore"` → slot `"1"`
(default), command word `"restore"`. The session layer resolves the slot and passes it to the
verb body via `ctx.saveGame(slot)` / `ctx.restoreGame(slot)` (§4.6). An invalid or
out-of-range slot is intercepted at the session layer — the session emits the in-voice
"There is no save slot N." response directly and never dispatches the verb body. This keeps
the verb body slot-agnostic: it always receives a canonical, valid slot string or is never
called. See §4.6 for the exact plumbing that delivers the resolved slot into the verb body.

### 4.6 VerbContext wiring — `verbs/index.ts` + `game.ts`

`V-SAVE`, `V-RESTORE`, and `V-RESTART` bodies are implemented in `ACTION_HANDLERS` and receive
a `VerbContext`. However, the current `VerbContext` (`verbs/index.ts` curated callbacks) carries
no reference to `Game.snapshot()`, `Game.restore()`, or the `SavePort` — the verb bodies are
therefore unimplementable as written without this plumbing.

**Resolution:** add three callbacks to `VerbContext`:

```ts
saveGame(slot: string): void;     // write the current snapshot to slot via SavePort
restoreGame(slot: string): void;  // read from slot via SavePort, call game.restore()
restart(): void;                  // re-bootstrap via createSession reset path
```

These callbacks are populated in `game.ts`'s context construction, with the resolved `SavePort`
threaded through from the session layer. The verb body calls `ctx.saveGame(slot)` etc. — the
body itself never holds a `Game` reference or a `SavePort` directly. The slot argument is
already resolved by the session layer before the verb fires (§4.5); the callback receives the
canonical slot string, never the raw command text.

Done (PB-CTX): the three callbacks exist on `VerbContext` and are populated in context
construction; a test confirms a verb body can trigger save/restore/restart via the context
without holding a direct `Game` reference.

---

## 5. Persistence Layer + Slot Model

### 5.1 `SavePort` — the capability boundary (NEW — `src/shell/save-port.ts`)

```ts
interface SavePort {
  write(slot: string, state: SaveState): void;   // may throw on quota/IO
  read(slot: string): SaveState | undefined;     // undefined = no save / unreadable
  list(): SaveSlotMeta[];                          // for the picker (§7)
  remove(slot: string): void;
}
interface SaveSlotMeta { slot: string; savedAt: string; buildId: string; hereName: string; moves: number; }
```

> **Security / trust note:** `read()` deserializes
> *attacker-controllable* input — `localStorage` is editable by the user and any script on the
> origin. `restore()` must treat a parsed `SaveState` as **untrusted**: validate shape and
> types, clamp/reject unknown object ids and out-of-range numbers, and **never** `eval` or
> trust embedded function-like strings (there are none in the schema — keep it that way). A
> malformed save is a `Failed.` / in-voice corruption message, never a thrown stack trace to
> the player. The validator is a first-class deliverable (PB-PORT), not an afterthought.

### 5.2 `localStorage` adapter (NEW)

Keys namespaced `zork-save-<slot>` (parallel to the existing `zork-theme` convention). Value is
`JSON.stringify(SaveState)`. `write` wraps in try/catch (quota → surfaces as the verb's
`Failed.`). This is the **only** adapter shipped; the `SavePort` interface is the migration
seam to a D1 adapter later (out of scope, §1).

### 5.3 Version stamp + cross-version / corruption handling (in-voice)

Every `SaveState` carries `formatVersion` (schema version) + `buildId` (`__BUILD_ID__` at save
time). On `restore`:

- **`formatVersion` mismatch** → refuse, in-voice: e.g.
  *"This saved game is from an incompatible version of the story and cannot be restored."*
  (exact wording in PB-PORT; House Style: in the product's voice, never a bare error). Refuse
  **before** mutating any state (no partial restore).
- **`buildId` mismatch** → recommend a **soft warn, allow** within the same `formatVersion`
  (a content patch shouldn't brick saves), but refuse on `formatVersion` change. OQ-1 ratifies
  the strictness. The `buildId` is recorded and shown in the slot picker either way.
- **Corruption** (JSON parse error, schema validation failure, unknown object id) → in-voice
  *"That saved game appears to be damaged."* and leave the live game untouched. Distinct from
  `Failed.` "no save here" (OQ-3).

> **Faithful-divergence note:** the original game's `RESTORE` fails opaquely (`Failed.`) on a
> bad disk; the web port deliberately gives a *more informative, in-voice* message for
> version/corruption because the failure modes are web-native and the player has no disk to
> blame. This is a documented intentional divergence, paralleling Phase-3's house-style
> placeholder voice.

---

## 6. Slot Model + Death Autosave (recommended default)

**Recommend: 3 named manual slots + 1 autosave-on-death slot.** Rationale grounded in the
death flow:

`jigsUp` → `randomizeObjects` (`death.ts:43,284`) **scatters the player's inventory and zeroes
`SWORD.TVALUE`** (the seeded scatter walks the object chain). A player who dies has their
pre-death state *destroyed*, and the resurrection drops them in FOREST-1 / Hades minus their
treasures' positions. That makes the state at the start of the fatal turn the most valuable
recovery point in the game — and the original relies on the player having manually `save`d.

The autosave is a **rolling per-turn snapshot, taken at the START of `submit()` (pre-turn)**,
overwritten every turn. Restoring it puts the player at the **start of the turn they died on**
— not the moment before death. The critical behavioral consequence: **replaying the identical
command from that restored state re-kills the player deterministically** — the main RNG is at
the same position, so `randomizeObjects` scatters identically. The recovery affordance is
"you are alive at the start of that turn; do something different." This must be documented
in the `gameOver` affordance text so the player understands what they are restoring to.

A rolling per-turn autosave (overwrite each turn) is simpler and race-free than an
autosave-only-on-the-death-bound-turn (which would require look-ahead the engine does not
have). The autosave slot is restore-only from the death/`gameOver` affordance and the picker;
it is never written by `V-SAVE`.

- **Slots 1–3** — manual, `save`/`restore` targets, shown in the picker.
- **Autosave slot** — written automatically at the start of each `submit()` (pre-turn),
  surfaced on death as "restore your last position (start of that turn)".

> **Determinism caveat (Path B):** an autosave + restore must itself satisfy the round-trip
> oracle — restoring the autosave and replaying must reproduce the saved future. Because both
> RNG positions round-trip (§3.2), it does. The autosave is **not** a "rewind one move" (that
> would need a command journal — OQ-7); it is "reload the last pre-turn snapshot," which on
> a rolling per-turn autosave is the start of the turn the player is currently on. Replaying
> the fatal command re-kills deterministically; the player must choose a different action.

---

## 7. Shell Affordance + Telemetry

### 7.1 UI (verbs-first; optional picker)

> **File placement:** `SavePort` (a persistence capability) lives in `src/shell/save-port.ts`,
> alongside `sink.ts` / `http-sink.ts`. The slot picker modal / UI lives in
> `src/ui/shell.ts` (the existing UI file) — NOT in `src/shell/`. Do not place UI code in
> `src/shell/`; do not assume `shell.ts` lives at `src/shell/shell.ts`.

- **Primary:** the in-game verbs (`save`, `restore`, `restart`) — faithful, discoverable,
  zero new chrome. This is the recommended-default minimum.
- **Optional slot picker modal** (same `div`+`classList` pattern as the existing map /
  known-issues modals in `src/ui/shell.ts`): lists `SavePort.list()` metadata (room, moves,
  timestamp, build) for restore; offers save-to-slot. The picker is sugar over the verbs —
  it calls the same session substrate. Recommend building it but gating it behind the verbs
  landing first (it can be a follow-on task, PB-UI).
- **On `gameOver`:** a RESTORE (last position / pick a slot) + RESTART affordance (replaces the
  omitted FINISH prompt loop — §4.4).

### 7.2 Telemetry — `PlaytestSink` events (NEW)

Extend `sink.ts`'s `PlaytestEvent` union (`sink.ts:51`) with save/restore events so playtests
can see when testers save/restore (and detect restore-driven divergence in transcripts):

```ts
interface SaveEvent    { type: 'save';    sessionId: string; buildId: string; turn: number; slot: string; ok: boolean; ts: string; }
interface RestoreEvent { type: 'restore'; sessionId: string; buildId: string; slot: string; ok: boolean; reason?: 'ok'|'empty'|'corrupt'|'version'; ts: string; }
interface RestartEvent { type: 'restart'; sessionId: string; ts: string; }
```

`FileSink.emit` (`sink.ts:92`) gains rendering for the three (a one-line marker each, e.g.
`=== save slot 2 (ok) ===`). `createSession.submit` (`session.ts:79`) emits them. The `ok`
flag + `reason` make a save/restore visible as the boundary it is when reading a transcript —
without it, a restored game's transcript looks like an inexplicable state jump. Done (PB-TEL):
a save then restore emits the two events with correct `ok`/`reason`; the round-trip oracle's
transcript carries the markers.

> **Privacy:** unchanged from the existing sink contract (`sink.ts:5` — tester input + game
> state only). Slot names are tester-authored; treat a free-text label as tester input (it
> already flows through `command`). No new PII surface.

---

## 8. Coordinate Seams (cross-spec dependencies)

| Seam | Phase 4 side | Other side | Contract |
|------|--------------|-----------|----------|
| **Death autosave** | rolling pre-turn autosave at the start of `submit()` (§6) | **Phase 2 death.ts** | autosave reads state before any action runs; it does NOT change `jigsUp`/`randomizeObjects` — the scatter stays faithful; restoring the autosave puts the player at the start of the fatal turn (replaying the same command re-kills deterministically — same RNG position, same scatter) |
| **Ghost-mode SAVE/RESTORE** | verb bodies callable when `dead` | **Phase 2 ghost dispatch** | `game.ts:338–341` already passes META through ghost mode; verify, don't rebuild |
| **RNG dual stream** | serialize both positions (§3.2) | **Phase 2 combatRng split** | the two streams stay independent across restore; never collapse to one |
| **`doFinish` / RESTART** | shell affordance replaces prompt | **Phase 2 B7 FINISH** | engine `doFinish` stays a no-op driver; shell owns restart/restore on `gameOver` |
| **Module globals list** | capture/restore list (§3.4) | **`session.ts` reset list** | the SS6 capture list and the `createSession` reset list MUST stay identical — SS-AUDIT enforces |
| **`__BUILD_ID__`** | version stamp (§5.3) | **`session.ts:22` build-id** | reuse the existing injected build id; do not add a parallel version source |
| **Future D1 migration** | `SavePort` boundary only | **out of scope** | ship `localStorage` adapter; the interface is the only thing the D1 work inherits |
| **Archipelago** | none | **AP spec** | do not couple save format to AP seed/state here |

---

## 9. Build-Task DAG (authored for a staged build wave)

`foundation (serialization surface) → verbs + persistence (parallel) → UI + telemetry →
verification`. Each task: deps / files (verdict) / done-criteria. The serialization surface is
the foundation — nothing else can be correct until every byte round-trips.

### Wave 0 — Serialization surface (FIRST; foundation)

> **Post-merge re-measure checklist (do this before starting any build task):** The SS4
> (FlagStore) and SS6 (module globals) inventories MUST be re-measured against the merged
> world-verbs tree before build, because that wave added globals and flags that may not be
> in the enumeration below. Specifically, re-grep the merged code for:
> - **New globals:** `VERBOSE` / `SUPER-BRIEF` (verbosity mode globals).
> - **New clock slots:** `I-XB`, `I-XC`, `I-XBH`, `I-FOREST-ROOM`.
> - **New flags (FlagStore or module scope):** `XB-FLAG`, `XC-FLAG`, `LLD-FLAG`, `DOME-FLAG`,
>   `CAGE-TOP`.
> For each: determine whether it landed in the FlagStore (auto-covered once SS4 exists) or
> in module scope (needs an explicit SS6 entry and a matching reset in `createSession`). Do
> not assume the world-verbs spec placement was final — read the merged code.

- **SS1 — `SaveState` schema + object-tree snapshot/restore.** NEW `save-state.ts`; EXTEND
  `game.ts` with `snapshot()`/`restore()` object-delta traversal over `World.all()`. Deps:
  none. Done: every object's parent/flags/props/desc-ldesc-fdesc round-trips; restore rebuilds
  `children` via `moveTo`; serialized size measured (< localStorage quota, asserted).
  `ObjectDelta` captures `pStrength` for Actor instances; a mid-combat-save round-trip test
  asserts a wounded player/villain restores wounded, not at full strength.
- **SS-RNG — dual RNG state.** `rng.ts` EXTEND: add `getState()`/`setState()` to the concrete
  `Rng` class only (NOT to any interface or stub); `game.ts` `snapshot()` carries an
  `instanceof` guard and throws on a non-serializable stream; serializes both `rng` +
  `combatRng` positions. Deps: none. Done: §3.2 next-draw-matches test for BOTH streams
  independently (using real `Rng`); a test asserts `snapshot()` throws when a `ScriptedRng`
  is in play; the "single position re-couples streams" NM has an asserting test.
- **SS2 — clock fuel-stage position.** `clock.ts` EXTEND: add `aux?: Record<string, number>`
  to `ClockSnapshot`; `FuelInterrupt` writes `tableIndex` into `aux.tableIndex`; no
  Game-ctor/bootstrap change (owner decision: Clock aux data). Deps: none.
  Done: §3.3 lamp-stage round-trip test.
- **SS3 — scoring restore.** `scoring.ts` EXTEND (`snapshotState`/`restoreState`, no
  wonFlagHook re-fire). Deps: none. Done: score/baseScore/wonFlag round-trip; no double-whisper.
- **SS5 — parser state.** `parser.ts` EXTEND (`itRef` round-trip; refuse-save
  mid-continuation; refuse-save mid-disambiguation-await per §3.6). Deps: none. Done: `it`
  rebinds to the same object after restore; mid-continuation save refuses; mid-disambiguation
  save also refuses.
- **SS4 — FlagStore capture/restore.** `flag-store.ts` EXTEND: add `snapshot()` / `restore()`
  pair over the private flags Map. `restore()` MUST replace the map entirely, NOT merge —
  a fresh `Game` constructor sets some flags true (e.g. BUOY-FLAG at `game.ts:186`) and a
  saved `false` must win over the ctor default. Deps: none. Done: every FlagStore entry
  round-trips; a restore-onto-fresh-game test asserts that a flag the fresh ctor sets `true`
  but the save holds `false` ends up `false` after restore.
- **SS6 — module-global capture/restore.** NEW `module-globals.ts`; EXTEND `thief-state.ts`,
  `above-ground.ts`, `light-sources.ts` with snapshot/restore pairs. Deps: none. Done: every
  global in the `createSession` reset list (`session.ts:45–51`) round-trips; SS-AUDIT lockstep
  test (§10.3) green.

### Wave 1 — Verbs + persistence (parallel; deps: Wave 0)

- **PB-PORT — `SavePort` + localStorage adapter + validator.** NEW `save-port.ts`. Deps: SS1.
  Done: write/read/list/remove; the untrusted-input validator (§5.1) rejects malformed/foreign
  saves without throwing; quota failure surfaces cleanly.
- **PB-CTX — VerbContext save/restore/restart callbacks.** `verbs/index.ts` VerbContext
  interface + `game.ts` context construction. Deps: SS1, PB-PORT. Done: `saveGame(slot)`,
  `restoreGame(slot)`, `restart()` callbacks added to `VerbContext` and populated in
  `game.ts`'s context construction with the resolved `SavePort` threaded through; a verb body
  can trigger save/restore/restart via the context without holding a direct `Game` reference.
- **PB-SAVE — V-SAVE body.** `verbs/index.ts` EXTEND (`ACTION_HANDLERS['V-SAVE']`); slot
  resolution in the session layer. Deps: SS1, PB-PORT, PB-CTX. Done: `save` → `Ok.` (exact) +
  written slot; forced failure → `Failed.` (exact); stays in META_ACTIONS.
- **PB-REST — V-RESTORE body.** `verbs/index.ts` EXTEND. Deps: all Wave 0, PB-PORT, PB-CTX.
  Done: valid slot → `Ok.` + room re-describe (V-FIRST-LOOK); empty slot → `Failed.`;
  version/corrupt → in-voice (§5.3).
- **PB-RESTART — V-RESTART body + session re-bootstrap.** `verbs/index.ts` + `session.ts`.
  Deps: SS6, PB-CTX (reset path reused). Done: §4.4 criteria; `Restarting.` on confirm.
- **PB-VER — version/build stamp + cross-version refusal.** Folds into PB-PORT/PB-REST. Deps:
  PB-PORT. Done: §5.3 — formatVersion mismatch refuses before mutating; buildId policy per OQ-1.

### Wave 2 — UI + telemetry (parallel; deps: Wave 1)

- **PB-TEL — PlaytestSink save/restore/restart events.** `sink.ts` + `session.ts` EXTEND. Deps:
  PB-SAVE, PB-REST. Done: §7.2 events with `ok`/`reason`; FileSink renders markers.
- **PB-AUTOSAVE — death autosave slot.** `session.ts` (rolling per-turn autosave) + `gameOver`
  affordance hook. Deps: PB-SAVE. Done: §6 — autosave restorable after a death; round-trip
  oracle holds on the autosave.
- **PB-UI — slot picker modal + gameOver affordance.** `src/ui/shell.ts` EXTEND. Deps: PB-PORT,
  PB-REST. Done: picker lists slot metadata; restore/save from picker; RESTART/RESTORE on
  `gameOver`. (Optional sugar — verbs are the required surface.)

### Wave 3 — Verification consolidation

- **V1 — Round-trip property tests (the oracle).** §10.1. Deps: all Wave 0–2. Done: the
  byte-identical-continuation property holds over a randomness-touching sequence; the no-save
  field-omission NM is caught by a continuation that exercises it.
- **V2 — Corruption / version / untrusted-input suite.** §10.2. Deps: PB-PORT. Done: each
  failure mode → its specified message; no throw reaches the player.
- **V3 — No-hard-locks-across-restore invariant.** §10.4 + House Style. Deps: V1. Done: the
  reachable⇒escapable⇒can-return invariant holds after a restore (restore cannot strand a
  player).
- **V4 — SS-AUDIT lockstep.** §10.3. Deps: SS6. Done: a test asserts the SS6 capture list ≡
  the `createSession` reset list, so a future-added module global can't silently escape the
  save surface.

> **Sequencing note:** SS-RNG and SS6 are the two foundation tasks most likely to ship a silent
> "looks fine, diverges later" hole — they get the round-trip oracle (V1) pointed directly at
> them (a continuation that fires both RNG streams and reads a thief/region global after
> restore). Build the surface first; the verbs and UI are thin over it.

---

## 10. Verification Strategy

Three nets, mirroring the project's faithfulness discipline. The round-trip property test is
the **oracle** — it is the save analog of the golden master, and like the golden it must
exercise the surface to catch an omission.

### 10.1 Round-trip property tests (the save-correctness oracle)

> **The property:** for any command sequence, `play N → save → play M → restore → replay M`
> produces a **byte-identical** second-M transcript. This is the single proof that the
> serialization surface is complete *for the fields the continuation touches* — so the
> continuation must touch the risky fields (both RNG streams, a module global, the clock fuel
> stage, the object tree).

- **(A) Deterministic continuation** — N then M commands over a fixed seed, no save; capture
  the M-transcript. Then N, `save`, M, `restore`, replay M; assert byte-identical. The baseline
  proof.
- **(B) Randomness-touching continuation** — the M-segment includes commands that draw from
  **both** RNG streams (a grue check in the dark + a combat blow / songbird / bat), proving
  SS-RNG round-trips both positions (the NM that single-position restore would fail).
- **(C) Timer-touching continuation** — the M-segment spans a lamp/candle warning so the
  **fuel-stage** position (SS2) is exercised; assert the post-restore warning sequence matches.
- **(D) Module-global continuation** — the N-prefix sets a thief/region global (e.g. moves the
  rug → canvas ldesc, or sets THIEF-ENGROSSED), saves, restores, and the M-segment reads it;
  assert the restored game reflects the *saved* global, not the *reset* value (the SS6 NM).
- **(E) Mid-life save** — save at a non-trivial state (inventory moved, score accrued, rooms
  visited, a flag set), restore into a **freshly-bootstrapped** game, assert `view()` (room,
  score, moves, inventory, visited) matches the saved game exactly. Proves `restore` works
  onto a clean instance, not just a same-instance round-trip.
- **(F) Save/restore/save fixpoint** — `snapshot()` → `restore()` → `snapshot()` produces an
  **equal `SaveState`** (idempotence — the snapshot is a true fixpoint, no lossy field).

### 10.2 Corruption / version / untrusted-input unit tests

- Truncated JSON / non-JSON in a slot → in-voice "damaged", live game untouched.
- `formatVersion` bumped → refusal message; no state mutated (assert pre/post identical).
- `buildId` differs (same formatVersion) → policy per OQ-1 (warn-allow or refuse).
- Foreign / hand-edited save with an unknown object id, out-of-range number, or extra field →
  validator rejects or clamps; **never throws to the player** (the §5.1 untrusted-input rule).
- Empty slot → `Failed.` (the faithful no-save case), distinct from corruption.

### 10.3 SS-AUDIT — surface-completeness lint (the silent-omission net)

The structural risk is a field added to `Game` / `Parser` / a module global *after* this spec
that nobody adds to `SaveState`. Two enforcing tests:

- **Module-global lockstep:** assert the SS6 capture set ≡ the `createSession` reset set
  (`session.ts:45–51`), comparing the **actual global variable names** enumerated in each
  list — NOT the reset-function names. A single reset function such as `resetThiefState()`
  may clear multiple fields (`_thiefHere`, `_thiefEngrossed`, `_eggSolve`, `_cyclowrath`,
  `_thiefLdesc`); a new field added under that function would escape a function-name
  comparison. The lockstep test must enumerate and diff the concrete per-variable list on
  both sides. A new module global that is reset but not captured (or captured but not reset)
  fails the test.
- **Snapshot-fixpoint over a fuzzed game:** drive a long scripted game, then assert (F)
  idempotence holds — a forgotten field shows up as a snapshot that doesn't survive its own
  round-trip. (This is the cheapest catch-all; it cannot name the missing field, but it goes
  red, which is the point.)

### 10.4 No-hard-locks-across-restore (House Style invariant)

The standing House-Style invariant — **reachable ⇒ escapable ⇒ can-return** — must survive a
restore: a restored game state must not be one a fresh game could never reach, and restore must
not strand the player (e.g. restore `here` to a room whose exits depend on a flag that didn't
round-trip). The map/state-machine derivable invariant test (House Style) runs over a
post-restore state. Done: restoring any save reachable in normal play yields an escapable
position; the self-retiring trap allowlist (House Style) is consulted unchanged.

### 10.5 Suspicion discipline

Save/restore has **no dfrotz oracle** for the substrate (there is no Z-machine save file to
diff). The `Ok.`/`Failed.` *text* is dfrotz-anchorable; the *correctness* of the snapshot is
proven only by the round-trip property — which is self-referential against our own engine.
That makes the **completeness of the field enumeration (§3)** the load-bearing artifact and
the **breadth of the continuation in (B)–(D)** the real net. Green round-trip tests over a
*thin* continuation are the false-success trap here: a save test that never fires the combat
RNG, never crosses a fuel warning, and never reads a module global will pass while three holes
sit open. Weight the continuation breadth accordingly; "tests pass" does not retire save risk
until (B)–(D) all exercise their named subsystem.

---

## 11. Phase Gates

### G1 — Build / Merge
- [ ] `SaveState` enumerates every mutable member of §3; `Game.snapshot()`/`restore()` built.
- [ ] Both RNG stream positions round-trip (SS-RNG); the dual-stream NM has an asserting test.
- [ ] Clock fuel-stage (SS2), scoring (SS3), parser itRef (SS5), and every module global (SS6)
      round-trip; SS-AUDIT lockstep green.
- [ ] V-SAVE / V-RESTORE / V-RESTART bodies registered; `Ok.` / `Failed.` byte-exact from
      `gverbs.zil`; verbs stay in `META_ACTIONS`; version/corruption refusal is in-voice.
- [ ] `SavePort` + localStorage adapter + untrusted-input validator; quota failure clean.
- [ ] Round-trip property tests (V1, all of A–F) green, including the randomness/timer/module
      continuations; corruption/version suite (V2) green; no-hard-locks-across-restore (V3)
      green; SS-AUDIT (V4) green.
- [ ] Full suite green; merged to the working branch (human commit voice; never detach).

### G2 — Deploy + Smoke
- [ ] Deployed build: `save` prints `Ok.` and persists across a page reload; `restore` brings
      the game back to the saved room/score/inventory and re-describes the room; `restart`
      returns to the opening; a death autosave is restorable.

### G3 — Playtest-Ready
- [ ] Known-issues updated: save/restore now LIVE (retire the "save/restore still deferred /
      issue #11" line carried since Phase 2/3); note device-local localStorage scope (saves do
      not cross devices/browsers — the documented Phase-1 limit) and the cross-version refusal
      behavior; the slot model and any picker affordance documented.

---

## 12. Open Questions for Sign-off

1. **OQ-1 — `buildId` mismatch policy: warn-allow (same formatVersion) or always refuse?**
   §5.3 recommends **warn-allow within the same `formatVersion`, refuse on formatVersion
   change** — a content/build patch shouldn't brick saves, but a schema change must. Confirm
   the strictness (the conservative alternative: refuse on any buildId change — safer, but
   invalidates saves on every deploy). *(Recommended default: warn-allow same-version.)*

2. **OQ-2 — Default/quicksave slot + autosave timing.** **RESOLVED** — rolling pre-turn
   autosave at the start of `submit()`, overwriting each turn; restoring it puts the player at
   the start of the fatal turn (replaying the same command re-kills deterministically). See §6
   for the full statement of semantics including the re-death behavior.

3. **OQ-3 — Failure-message taxonomy: when `Failed.` vs in-voice?** Recommend `Failed.` ONLY
   for "restore attempted, data unusable in the faithful sense" — and reserve **in-voice**
   messages for web-native failure modes the original never had: empty slot ("There is no save
   in slot N."), corruption ("That saved game appears to be damaged."), version skew. Confirm
   the split, or collapse everything to faithful `Failed.` (more faithful, less helpful).
   *(Recommended default: `Failed.` for unusable data; in-voice for empty/corrupt/version.)*

4. **OQ-4 — RESTART confirmation: engine-level or shell-level?** §4.4 recommends **shell-level**
   (a confirm dialog), keeping the engine verb a clean re-bootstrap with no synchronous prompt
   (consistent with Phase-2 B7's omission of the FINISH READ loop). Confirm, or accept a
   no-confirm restart (faithful to nothing — the original prompts — and dangerous: an
   accidental `restart` nukes progress). *(Recommended default: shell-level confirm.)*

5. **OQ-5 — Mid-continuation / AGAIN parser state on save.** §3.6 recommends **refusing to save
   mid-continuation** (assert `hasContinuation()` is false at snapshot; a multi-command line is
   a transient boundary), and serializing only `itRef` (required) — leaving `lastInput`/
   `lastWon` (AGAIN) un-saved (AGAIN after a restore is a rare, low-value edge). Confirm, or
   include AGAIN state. *(Recommended default: refuse mid-continuation; serialize itRef only.)*

6. **OQ-6 — Full object snapshot vs diff-against-bootstrap.** **RESOLVED** — full per-object
   delta snapshot (robust, version-tolerant, dumb). Revisit only if a measured quota problem
   arises. See §3.1 compactness note.

7. **OQ-7 — Snapshot-only now, or leave room for a command journal (undo)?** Out of scope to
   build, but the `SavePort`/`SaveState` design should not *preclude* a future per-command
   journal (undo / rewind-one-move). Recommend: ship snapshot-only; note the journal as a
   future option the port can carry as a separate record type. Confirm we are not building undo
   this phase. *(Recommended default: snapshot-only; do not foreclose a journal.)*

8. **OQ-8 — Lift module globals onto `Game`, or only make them serializable?** §3.4 recommends
   **serializable-in-place** (capture/restore pairs per module) over relocating them onto the
   `Game` instance (a broad refactor touching every region FCN that imports them — out of scope
   and risky). Confirm the in-place approach; flag the consolidation as possible future
   cleanup. *(Recommended default: serializable in place, no relocation.)*

---

## 13. Faithful-Divergence Register (the documented intentional departures)

Mirrors Phase-3's DELIBERATE register — each is an *intended* departure from ZIL, named so it
cannot be mistaken for a fidelity bug. Anything not on this list that diverges from `gverbs.zil`
save/restore text IS a bug.

| ID | Faithful target | Web-adapted form | Why |
|----|-----------------|------------------|-----|
| **FD-1** | Z-machine `<SAVE>` opcode → disk file | JSON `SaveState` → `localStorage` slot | no story file, no Z-machine, no disk in a browser |
| **FD-2** | `Ok.` / `Failed.` (`gverbs.zil:80–82, 72–76`) | **byte-exact, unchanged** | this IS faithful — the text stays |
| **FD-3** | `RESTORE` opaque `Failed.` on bad disk | in-voice version/corruption messages | web failure modes (version skew, hand-edited storage) the original never had; player has no disk to blame |
| **FD-4** | `V-RESTART` / `FINISH` blocking `READ` prompt loop | shell affordance (confirm dialog / picker), no synchronous READ | the web shell has no synchronous READ (Phase-2 B7) |
| **FD-5** | single save file holds the whole VM image | 3 named slots + 1 death autosave | the original had one save; slots are a web-native quality-of-life affordance, no faithful text affected |
| **FD-6** | `RESTORE` filename/disk dialog (interpreter UI) | slot picker modal / `save <slot>` arg | interpreter chrome, not story text — no faithful analog |

---

## 14. Notes for the Review Panel

- **Primary correctness risk** is field-enumeration completeness (§3) — specifically the two
  RNG positions (§3.2) and the off-instance module globals (§3.4). The round-trip oracle
  (§10.1 B–D) is only a net if its continuation fires those subsystems; a thin continuation is
  the false-success trap (§10.5). Adversarial review should attack the *completeness of §3* and
  the *breadth of the continuation*, not just the verb text.
- **Faithful-divergence boundary** (§4.1, §13) is the spec's central judgment call: text exact,
  substrate web-native. Confirm the boundary is drawn correctly (e.g. is in-voice
  version/corruption messaging (FD-3) the right call, or should it be a flat `Failed.`?).
- **Untrusted-input handling** (§5.1) — `localStorage` is user-editable; `restore()`
  deserializes attacker-controllable input. Confirm the validator is treated as a first-class
  deliverable (PB-PORT), not an afterthought.
- **Death-autosave value** (§6) rests on `randomizeObjects` destroying pre-death state
  (`death.ts:43,284`); confirm the autosave is positioned to capture the *pre-scatter* state.
- **All eight OQs carry recommended defaults** — the wave should not need to re-derive them.

---

## Appendix: Panel Findings — Amendment B resolved log (2026-06-13)

Three-lens panel verdict (2026-06-12, overnight): "Yes with gaps" — serialization reasoning
strong, but the following MUST be resolved before any build task runs. Full reviews:
session task output wtt75isiu.

All items resolved and folded into the spec body as of 2026-06-13 (Amendment B).

**Schema blockers (all hit SS1, the foundation):**
1. **RESOLVED** — `pStrength` field added to `ObjectDelta` in §3.1 (Actor-only capture);
   mid-combat-save round-trip test added to SS1 done-criteria in §9 Wave 0.
2. **RESOLVED** — SS4 (FlagStore capture/restore) added as a subsection (see §3.1 `flagStore`
   schema field, which was already present) and as a build task in §9 Wave 0. Replace-not-merge
   semantics and the fresh-ctor-override test documented in the SS4 task.
3. **RESOLVED** — §3.2 SS-RNG rewritten to the concrete-Rng+loud-fail owner decision.
   `getState`/`setState` on the concrete `Rng` class only; `snapshot()` `instanceof` check
   throws on non-serializable streams; no interface or stub extension.
4. **RESOLVED** — §3.3 SS2 rewritten to the Clock-aux-data owner decision. `Clock` gains
   `aux?: Record<string, number>` per slot; `FuelInterrupt` writes `tableIndex` into
   `aux.tableIndex`; no Game-ctor or bootstrap signature change.
5. **RESOLVED** — §4.6 (VerbContext wiring) added as a new subsection; PB-CTX added as a
   build task in §9 Wave 1; PB-SAVE, PB-REST, PB-RESTART updated to depend on PB-CTX.
6. **RESOLVED (open action)** — Post-merge re-measure checklist added to §9 Wave 0 preamble.
   Lists VERBOSE/SUPER-BRIEF globals, I-XB/I-XC/I-XBH/I-FOREST-ROOM clock slots, and
   XB-FLAG/XC-FLAG/LLD-FLAG/DOME-FLAG/CAGE-TOP flags as items requiring re-measurement against
   the merged world-verbs tree before build starts. Resolution of placement (FlagStore vs
   module globals) is a pre-build step, not a pre-spec-finalization step.

**Design corrections:**
7. **RESOLVED** — §10.3 SS-AUDIT lockstep reworded to compare actual global variable names,
   not reset-function names. `resetThiefState()` example explicitly called out.
8. **RESOLVED** — §6 death-autosave semantics rewritten. "Moment before death" phrasing
   removed; semantics now explicitly state pre-turn snapshot at start of `submit()`, and that
   replaying the same command re-kills deterministically. §8 seam table row updated to match.
9. **RESOLVED** — §7.1 file placement note added. `SavePort` → `src/shell/save-port.ts`;
   slot picker modal → `src/ui/shell.ts`. PB-UI task in §9 Wave 2 updated to name
   `src/ui/shell.ts`. §5.1 `src/shell/save-port.ts` path was already correct.
10. **RESOLVED** — `GameSession` interface `save()`/`restore()`/`restart()` methods added to
    §2 Session/sink section. `snapshot()` name-collision note added there.
11. **RESOLVED** — §4.5 slot-arg contract rewritten with the exact regex-interception
    description: `session.submit()` pre-processes raw string, resolves slot, passes via
    `ctx.saveGame(slot)`; invalid slot intercepted at session layer before verb body fires.
12. **RESOLVED (partial)** — Mid-disambiguation-await refusal added to §3.6 SS5 done-criteria
    and behavior description. Autosave localStorage key literal and WON-FLAG double-write note
    are implementation details deferred to PB-AUTOSAVE and PB-PORT respectively; flag them
    during those build tasks.
13. **RESOLVED** — OQ-2 and OQ-6 marked RESOLVED in §12 with pointers to where decisions landed.
