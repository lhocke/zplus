# Phase 1 — Web-Shell Playtest

**Status:** PIPELINE COMPLETE (review round 1 + test strategy applied) — pending owner sign-off on convergence; ready for implementation planning
**Date:** 2026-06-07
**Owner:** Dylan
**Repo:** lhocke/zplus (private)

> Phase 1 of the phased-playtest release. Ships a deployable browser build that
> drives the real `Game` engine through a tested boundary, logs every turn to
> Cloudflare, and is playable up to the troll (the first logic wall), where it
> stops gracefully. Combat is Phase 2.

---

## 1. Goal & Scope

### What Phase 1 proves

Phase 1 exists to de-risk the **untested seam** in the project: the boundary
between the completed engine and a real frontend. The engine has 1393 tests and
a 218-command golden transcript, but it has never been driven by anything except
a CLI readline loop (`tools/play.ts`). `src/main.ts` is a `'boot'` stub. Pulling
the web frontend forward — *before* combat — forces that seam to be exercised,
tested, and deployed while the surface area is still small.

Concretely, Phase 1 proves three things:

1. **The engine↔UI boundary holds.** A browser terminal drives the real `Game`
   through a formalized, tested `start` / `turn` / `view` contract — the same
   API the CLI already uses, now promoted to a deliberate UI-facing interface.
2. **Live telemetry works end-to-end.** Every turn flows through a
   `PlaytestSink` to Cloudflare (R2) so we can review real play sessions during
   development.
3. **The deploy pipeline is real.** A static Vite build ships to Cloudflare
   Pages at `zork.lhocke.dev`, with a same-origin Function handling logging —
   the pipeline every future phase will re-use.

### In scope

- Browser terminal driving the real `Game` (input → output, scrollback).
- Status bar (room · score · moves), reusing `game.view()`.
- A **rough live map** of the explored area (fog-of-war reveal; pre-troll region
  only — no maze, since the maze is past the wall).
- **Theme switching** via Tailwind Plus (CRT / Literary / Parchment).
- `PlaytestSink` seam: `FileSink` (CLI, preserved) + `HttpSink` (browser).
- Cloudflare Pages + Function (`/api/log`) + R2 for transcripts.
- `zork.lhocke.dev` subdomain mapping and deploy.
- Graceful troll-wall (the troll-sign; see §6) bounding play to the pre-troll
  region.
- In-app feedback form (→ GitHub issue; see §7) and a known-issues list for
  testers.
- On-page notice that gameplay may be reviewed for debugging.
- Support links (Ko-fi / Patreon).

### Explicitly deferred

- **Combat / the troll fight** → Phase 2 (the wall is where Phase 1 ends).
- **Save slots + autosave** → later phase. Each page load is a fresh session.
- **Full map fidelity** (box-drawing vs. bracket-line selectable styles, maze
  breadcrumb reveal, curated whole-game layout) → later. Phase 1 ships only a
  rough pre-troll map.
- **Secret invocations** (`frotz`, `rezrov`) → later.
- **Disambiguation / pronouns / advanced parser polish** beyond what the engine
  already does → not a Phase 1 concern (engine is frozen here).
- **D1 / leaderboard** → broader release.
- **Public mirror + GitHub Sponsors** → Archipelago / Zork II–III era.

### Scope note

Phase 1 is deliberately **larger than an ideal phase**. The map and themes push
it past a minimal seam-test, but they're cheap with Tailwind Plus and make the
playtest feel like a real game rather than a bare terminal — worth the extra
surface for first impressions with testers.

## 2. The Boundary Contract

### The contract already exists — Phase 1 formalizes and tests it

The engine is **frozen** for Phase 1. The seam work is not extending the engine;
it is promoting the existing `Game` surface to a deliberate, documented,
tested UI-facing contract, and proving the browser drives it identically to the
CLI.

The surface (`src/engine/bootstrap.ts`, `src/engine/game.ts`):

```ts
createGame(opts?: { startRoom?; seed?; events?; rng? }): Game

game.start(): string                 // intro banner + first room description
game.turn(input: string): TurnResult // { output: string; moved: boolean }
game.view(): GameView                // read-only snapshot (below)
```

```ts
GameView {
  here: ObjectId
  hereName: string
  exits: ReadonlyArray<{ dir: Dir; known: boolean; to?: ObjectId }>
  visibleObjects: ReadonlyArray<{ id: ObjectId; name: string }>
  score: number
  maxScore: number
  moves: number
  inMaze: boolean
}
```

**Finding:** `GameView` carries what the Phase 1 UI needs for the status bar
(`hereName`/`score`/`maxScore`/`moves`), the current room (`here`), `inMaze`, and
the room's exit table (`exits[]`). No engine change is required to build the
shell.

> **Correction (review C-stage) — `exits[].known` is NOT a discovery signal.**
> `view()` computes `known: e.to !== undefined` (`game.ts:347`) — it's static
> ("this exit has a destination in the room data"), `true` from the moment you
> enter a room, regardless of whether the player has explored it. So the
> **fog-of-war map cannot be driven by `exits[].known`** (see §3 for the
> corrected client-side tracking design). The "no engine change required" claim
> still holds — the shell tracks discovery itself — but the map's reveal logic is
> shell-side state, not an engine field.

### Session freshness — reset module-level engine state (review C1)

The engine has **module-level mutable globals** that outlive any single `Game`
(`kitchenWindowFlag`, `rugMoved`, `grateRevealed`, `grunlock`, `singSong` in
`src/actions/above-ground.ts`; `matchCount` in `src/actions/light-sources.ts`).
Today only the golden **test** clears them (via the exported `reset*()` functions)
before each run; `createGame()` does not. So "fresh session per load" is only
true by luck of a full page reload re-executing the module.

**`createSession` must call the exported `reset*()` functions on construction**,
so every session starts genuinely clean regardless of module reuse. This is
additive wiring in the new `src/shell/` facade calling **already-exported** reset
hooks — the engine's logic is untouched (still "frozen"). It also forecloses the
silent corruption a future in-page "play again" (Phase 2) would otherwise hit.

### The session facade — the single integration point

Today `tools/play.ts` calls `createGame()` directly and hand-rolls the turn
loop + transcript. Phase 1 introduces one thin facade that both the browser and
the CLI drive, so the seam is exercised by *one* code path, not two:

```ts
// src/shell/session.ts (new)
interface GameSession {
  start(): string                    // delegates to game.start(); emits SessionStart
  submit(command: string): string    // runs game.turn(), emits a TurnEvent, returns output
  snapshot(): GameView               // delegates to game.view()
  close(): void                      // emits SessionEnd, flushes + closes the sink
}

createSession(opts: { sink: PlaytestSink; seed?: number }): GameSession
// On construction, createSession calls the exported reset*() hooks (above) so
// each session starts clean.
```

- `submit()` is the **one** place a turn becomes a `TurnEvent` (§4) and is
  handed to the injected `sink`. The engine never knows a sink exists — the
  `Game` stays pure; telemetry lives entirely in the facade.
- `tools/play.ts` is refactored onto `createSession({ sink: new FileSink() })`,
  preserving the existing `playtest-logs/session-*.log` behavior. The browser
  uses `createSession({ sink: new HttpSink() })`. **Instrument once, swap
  transport** (per `docs/hermes-log-gathering-note.md`).
- This deletes the stale "web shell arrives in Phase 4" comments in
  `tools/play.ts` and `src/main.ts`.

### Determinism

`createSession` passes through to `createGame` with the default seeded `Rng`
(`DEFAULT_SEED = 42`). Phase 1 keeps the live game on the injected `Rng` — **no
Mulberry32 → FrotzRng flip** — so the 218-command golden transcript stays
byte-identical (per the RNG-parity decision; combat oracle tests inject forced
RNG in Phase 2, not here).

### The seam test (the deliverable that proves the boundary)

A new integration test drives the **public contract** for I/O and asserts the
browser-facing path matches the known-good golden:

1. **Golden-through-the-facade.** Replay the existing 218-command golden through
   `createSession({ sink: nullSink }).submit()` and assert the output is
   **byte-identical** to the committed golden.
   - **`nullSink`** = a `PlaytestSink` whose `emit`/`close` are no-ops (defined in
     the test or a shared test util).
   - **Apples-to-apples (review H3):** the committed golden is produced by the
     oracle `runEngine()` harness, and `tools/play.ts` injects status-bar lines
     into its log that are **not** engine output. The seam test must compare the
     **engine output stream only**, using the **same normalization the committed
     golden uses** (intro banner via `start()`, no status-line injection). Pin
     which stream both sides represent so "byte-identical" is meaningful.
   - **Determinism (review C1):** the test resets module-level action state
     between runs the same way the golden test does. Since `createSession` now
     calls the `reset*()` hooks on construction (above), constructing a fresh
     session per replay is sufficient — the test does **not** reach past the
     facade for this.
2. **Snapshot contract.** After representative commands, assert `snapshot()`
   exposes the fields the UI binds to: `here`/`hereName`, `score`/`maxScore`/
   `moves`, `inMaze`, and the room's `exits[]` table. **Do not assert
   `exits[].known` "transitions"** — it doesn't (it's static per room, §2
   correction). This pins the view shape so an engine refactor can't silently
   break the UI's data source.
3. **Sink emission.** Assert `start()` emits one `SessionStart`, each `submit()`
   emits exactly one well-formed `TurnEvent` (shape per §4) with
   `command`/`output`/`score`/`moves`/`room` consistent with that turn's
   `submit()` return and `snapshot()`, and `close()` emits one `SessionEnd`.

## 3. Web Shell (UI)

The shell is a static Vite app (`src/main.ts` + modules under `src/shell/`,
`src/ui/`), vanilla TS, styled with **Tailwind + Tailwind Plus** components. It
drives the `GameSession` facade from §2. **Responsive** (desktop + mobile).

### Layout

- **Desktop (≥ lg):** two columns — terminal on the left (primary, flexible
  width), a **sidebar** on the right holding the status bar, the rough map, and
  controls (theme switcher, known-issues, feedback).
- **Mobile (< lg):** single column — terminal full-width; the sidebar collapses
  behind a toggle (Tailwind Plus **slide-over / drawer**). Status bar stays
  pinned (compact) above the terminal so score/moves are always visible.

### Terminal

- Scrollback region (monospace) + a single input line; **Enter** submits to
  `session.submit(cmd)`, output is appended.
- Output rendering **preserves the engine's whitespace and newlines verbatim**
  (the engine owns all formatting; the UI never reflows or re-wraps game text).
- **Command history** via ↑/↓ (in-memory, current session only — no persistence,
  consistent with no-saves).
- Auto-scroll to bottom on new output; clicking anywhere in the terminal focuses
  the input.
- The opening `session.start()` banner + first room render on load.

### Status bar

- Renders `hereName · score/maxScore · moves` from `session.snapshot()`,
  refreshed after every `submit()`. (This is the bare REPL's `status()` line
  from `tools/play.ts`, promoted to real UI chrome.)

### Rough map (curated box-drawing)

- A **hand-authored layout** of the ~12 pre-troll rooms: a small static dataset
  (`src/ui/map-layout.ts`) mapping each pre-troll room `ObjectId` → grid
  position + its drawn connections. Authored once from the known room graph.
- **Fog-of-war reveal is shell-side state — NOT `exits[].known`** (review H2/C
  correction). That engine field is static (`e.to !== undefined`, true on first
  entry to a room), so it cannot signal discovery. Instead the shell tracks
  discovery itself:
  - **Visited rooms:** maintain a `Set` of `view().here` values seen after each
    `submit()`; a room renders only once it's in the set.
  - **Discovered connections:** when `view().here` changes from room A to room B
    across a turn, mark the **A↔B edge** discovered and render it. (The shell
    knows both endpoints from consecutive snapshots; it doesn't need the engine
    to tell it which edges are "known.")
  - The **current room** (`view().here`) is highlighted; an adjacent-but-
    unvisited room shows as `?`.
  - This per-session discovery state is in-memory only (no persistence,
    consistent with no-saves).
- Box-drawing aesthetic (matches the eventual full-design map default), so this
  is a stepping stone, not a throwaway. **No maze** (past the wall) and **no
  selectable styles / breadcrumb** (deferred per §1).
- Rooms beyond the troll are not in the layout dataset — the map simply can't
  depict the gated region, reinforcing the wall.

### Themes (Tailwind)

- Three themes: **CRT (default)**, **Literary**, **Parchment**, implemented as
  Tailwind theme tokens toggled via a `data-theme` attribute on `<html>` (CSS
  custom properties for fg/bg/accent/font).
- A theme switcher control (Tailwind Plus toggle/segmented control) in the
  sidebar.
- Theme preference **is persisted to `localStorage`** — this is a UI preference,
  not a game save, so it's exempt from the no-saves deferral.

> **Persistence note (forward-looking) — `localStorage` is a stopgap, not the
> destination.** It's acceptable for Phase 1 (theme preference only), but it is
> device-local, clearable, and per-browser. It **must not** be relied on
> indefinitely: when real persistence arrives (save slots, and any
> cross-device/account state), it should **migrate to proper session/server-side
> storage** (tied to the deferred backend, e.g. D1), with `localStorage` at most
> a cache/fallback. Flagged now so the stopgap doesn't quietly calcify into the
> permanent mechanism.

### Tailwind Plus components in play

Skin-and-assemble rather than build from scratch: sidebar/panel layout, the
slide-over drawer (mobile), the theme switch, and the modal **dialog** reused
for both the known-issues list and the feedback form (§7).

> **License confirmed owned** (per project owner) — Tailwind Plus is available to
> this project; the UI component strategy is not blocked on procurement (review
> flagged this as unknown). Exact package name / install path / Tailwind config
> setup are **verified against current docs at implementation** (rule-18 — package
> names + versions are perishable; Tailwind + Tailwind Plus are not yet in
> `package.json` and there's no `tailwind.config.*` yet).
>
> **Build sourcing (2026-06-07):** basic Tailwind installs via npm (`tailwindcss`
> + `tailwind.config`). **Tailwind Plus** components ship as copy-in code (the
> owner's licensed `application-ui-v4` kit). Two-tier commit model:
> - **Components we USE** (the slide-over drawer, segmented theme control, modal
>   dialog) are **adapted into `src/ui` and committed** — unavoidable, since they
>   are served in the built `dist/` bundle. License-OK for in-product use; they
>   may ride along to the eventual public mirror (served to every visitor anyway).
> - **The full/raw kit is NOT committed** — no `vendor/` dir, no wholesale dump in
>   the repo; only the adapted in-use components. The raw kit is the only part
>   that must be scrub-excluded from a public mirror.
>
> Build order: the shell was first built on **plain Tailwind with
> `// TAILWIND-PLUS SWAP SEAM` markers**, then the Plus components were swapped in
> behind those seams as a localized change (keeps the swap a localized edit, not a
> rewrite).

### Page notice

A persistent, unobtrusive notice (footer line on desktop, inside the drawer on
mobile) stating that gameplay may be reviewed for debugging during development.
Exact copy and rationale in §4.

### Out of scope for the shell (deferred)

Save-slot UI, autosave indicator, secret-invocation affordances, full-game map,
selectable map styles — all per §1.

## 4. PlaytestSink + Telemetry

Telemetry follows the **instrument-once / swap-transport** seam from
`docs/hermes-log-gathering-note.md`. The game emits structured events through a
sink interface; the transport (file vs. HTTP) is a swappable detail the engine
never sees. Telemetry lives entirely in the §2 session facade.

### What we gather (and what we don't)

The scope is deliberately narrow: **the tester's input and the game's state —
nothing more.** Enough to replay a session and debug the engine, and nothing
about the player or their device.

**Gathered:**
- **Input** — the commands the tester types.
- **Game state** — engine output (verbatim), score, moves, current room.
- **Minimal envelope** to make the above usable — an anonymous per-load
  `sessionId`, the turn index, an ISO timestamp, and the `buildId` (which of
  *our* builds produced the output). None of these describe the player.

**Not gathered (explicit non-goals):**
- No `userAgent`, no browser/device/OS info, no fingerprinting.
- No IP stored in the event, no cookies, no localStorage identity.
- No name, email, account, or any user identity.
- No geolocation, no analytics/3rd-party trackers, no referrer.

**One scoped exception — UI bug reports (§7):** when a tester uses the feedback
form to report a *UI/visual* issue, the form may attach their **browser
information** (user agent, viewport, theme) to that report, so we can chase
rendering bugs. This is:
- **contextual** — collected only on a UI-issue report, not on gameplay;
- **disclosed** — the form states the browser info is being attached;
- **separate from telemetry** — it rides the feedback path (→ GitHub issue, §7),
  never the gameplay event stream.

The **default remains gameplay-only** (input + game state). Browser info is the
exception that proves the rule, and only on the feedback path.

### Event model

The base per-turn event from the note, extended with a `type` discriminator and
a `buildId` so logs are attributable to a specific deployed build during rapid
dev iteration:

```ts
interface TurnEvent {
  type: 'turn'
  sessionId: string   // anonymous, per page load
  buildId: string     // git short SHA / build stamp, injected at Vite build
  turn: number        // 1-based command index within the session
  command: string     // raw tester input (free text — see sanitization, §7)
  output: string      // engine output, verbatim
  score: number
  moves: number
  room: string        // view().here (room ObjectId)
  ts: string          // ISO 8601
}
```

Plus two lightweight lifecycle events on the same stream, so we can see sessions
that began but never issued a command, and where sessions drop off. These carry
**no client information** — only the anonymous envelope:

```ts
type SessionStart = { type: 'start'; sessionId; buildId; ts }
type SessionEnd   = { type: 'end';   sessionId; ts; lastTurn: number }

type PlaytestEvent = SessionStart | TurnEvent | SessionEnd
```

### Sink interface

```ts
interface PlaytestSink {
  emit(e: PlaytestEvent): void
  close(): void   // flush any pending events
}
```

- **`FileSink`** (CLI) — writes `playtest-logs/session-*.log`; `tools/play.ts`
  refactors onto it via the facade (§2).
  - **Format decision (review):** `FileSink` re-serializes each `PlaytestEvent`
    into the **existing human-readable flat-text format** (`> command`, verbatim
    output, the `[ room · score/max · moves ]` status line) — *not* JSON. This
    keeps the current log shape and reading habits intact ("behavior preserved").
  - **Synchronous append preserved (review L12):** keep `appendFileSync` per
    event — the existing crash-safety invariant (a Ctrl-C mid-session doesn't
    lose the tail). Don't switch to buffered/async writes.
- **`HttpSink`** (browser) — POSTs events to the same-origin Cloudflare Function
  `/api/log` (§5). **Best-effort, never blocks or breaks gameplay**: a failed
  POST is swallowed (logged to console in dev), the turn still renders. No hard
  delivery guarantee — R2 is a debugging aid, not a system of record.
  - Delivery: **one POST per event** (playtest volume is low; simplest correct
    option). A small in-memory queue retries transient failures a couple of
    times, then drops.
  - **Flush on exit (review M6):** on `pagehide`, drain the **entire pending
    queue** via `navigator.sendBeacon` (not just `SessionEnd`) — queued
    `TurnEvent`s would otherwise be lost, since async retries can't run during
    unload.
  - **`SessionEnd` must be idempotent/debounced (review M6):** fire it **once**,
    on real teardown (`pagehide`), **not** on `visibilitychange→hidden` — the
    latter fires on tab-switch (common on mobile) while the session is still
    alive, which would emit a premature/duplicate `end` and corrupt the
    drop-off signal these events exist to capture. `close()` is the single entry
    point and guards against double-emit.
- **`HermesSink`** — **explicitly out of scope.** Per the boundary rule in the
  hermes note: public/human player telemetry **never** touches the internal
  fleet bus. hermes is only for the future distributed *AI-agent* playtest case
  and needs deliberate hermes-side changes first. Not built here.

### Session identity & privacy

- **`sessionId` = `crypto.randomUUID()` generated per page load.** Anonymous; not
  tied to any user identity, not persisted across loads (consistent with
  no-saves). A reload starts a fresh session.
- The event stream contains **no PII**: no names, emails, accounts, or stored
  IPs. `command` is tester-controlled free text (they could type anything) — its
  handling on the feedback path is covered in §7; for telemetry it's stored
  as-is in the raw transcript.
- **Linkage caveat (review M5).** When a tester submits the feedback form, the
  report carries the `sessionId` (§7) — which is the join key to that session's
  full R2 transcript, and for UI-issue reports also to the attached browser info.
  So the "telemetry is fully separate from the feedback path" framing is not
  absolute: a feedback submission *does* let us tie a transcript to a report
  (still anonymous — `sessionId` names a session, not a person, and a tester may
  type self-identifying text in the free-text field). The feedback disclosure
  (§7) states this linkage; the gameplay notice covers the gameplay stream.

### On-page notice

A persistent, unobtrusive line (placement per §3 — footer on desktop, in the
drawer on mobile). Draft copy:

> *Gameplay in this playtest may be recorded and reviewed to help debug the game
> during development. Sessions are anonymous.*

Final copy is open to wordsmithing, but it must (a) disclose that gameplay is
recorded/reviewed and (b) state sessions are anonymous.

## 5. Cloudflare Deployment

The whole app is static + two small same-origin Functions. Same-origin is the
key choice: the page and its `/api/*` endpoints share `zork.lhocke.dev`, so
there is **no CORS** to configure and the browser never talks cross-domain.

> **Implementation note (rule-18):** exact `wrangler`/Pages binding syntax,
> Functions file conventions, and R2 API signatures must be **verified against
> current Cloudflare docs at build time** — the shapes below are the
> architecture, not pinned config to copy verbatim.

### Hosting — Cloudflare Pages

- Static Vite build: `vite build` → `dist/` is the Pages output directory.
- **Deploy via `wrangler pages deploy dist` — NOT Git-connected Pages.**
  Rationale: this repo is private and full of must-not-leak ops material
  (local tooling and notes directories, `docs/`). Git-connected would grant
  Cloudflare read access to the repo and clone it into CF's build environment on
  every push. Wrangler uploads **only `dist/`** — Cloudflare never sees the repo
  — and lets us inspect the exact artifact before it ships. This is the same
  posture already used for the pantheon site ("limit exactly what gets
  published / what the platform ever touches").
- **Riders (consequences of building locally for wrangler):**
  - **Disable production source maps** in the Vite build — sourcemaps would ship
    original TS into `dist/`. (Or consciously accept them; default = off.)
  - A small **deploy preflight** asserts `dist/` contains only built assets
    before `wrangler pages deploy`, so "inspect before ship" is enforced, not
    just available.
- **CI is deferred** — Phase 1 deploys are a deliberate local `wrangler` step;
  automating the deploy (still wrangler-based, still controlling exactly what's
  uploaded) is worked out as part of launch.
- **`buildId`** (§4): with local builds, derive the build stamp from the local
  git commit (e.g. inject `git rev-parse --short HEAD` via Vite `define` in
  `vite.config.ts`), since `CF_PAGES_COMMIT_SHA` is only populated in CF's own
  build environment, which we aren't using. The logged `buildId` is the commit
  that produced the deployed `dist/`. **TS note (review):** add a
  `declare const __BUILD_ID__: string` (in a `.d.ts` or `vite-env.d.ts`) so the
  injected global typechecks; `vite.config.ts` currently has no `define` block.

### Functions

Two same-origin endpoints under `functions/`:

1. **`functions/api/log.ts` → `POST /api/log`** — receives a `PlaytestEvent`
   (§4), validates shape + size, writes it to R2. Best-effort; returns `204`
   quickly and never makes the client wait.
2. **`functions/api/feedback.ts` → `POST /api/feedback`** — receives a feedback
   submission, sanitizes it, and creates a GitHub issue (§7). Holds the GitHub
   token as a **Pages secret** (`GITHUB_TOKEN`), never shipped to the client.

> **`GITHUB_TOKEN` scope is a hard requirement (review H4).** The "a token leak
> from the Worker can't touch code" rationale (§5/§7) is **only true if the token
> is scoped to the feedback repo alone.** Required: a **fine-grained PAT scoped to
> exactly `lhocke/zork-feedback`, permission `Issues: write` only** (or a GitHub
> App installation token with the equivalent single-repo, issues-only grant). A
> classic PAT or a broadly-scoped fine-grained token would reach the private code
> repo and **voids the blast-radius argument** — not acceptable.

### R2 — raw transcript storage

- One R2 bucket (e.g. `zork-playtest`), bound to the Pages project (binding name
  e.g. `PLAYTEST`).
- **Key layout — one object per event:** `sessions/<sessionId>/<seq>.json`,
  where `seq` is **zero-padded to a fixed width of 5 digits** (`00000` =
  `SessionStart`, then turn index; `SessionEnd` written at a reserved high key,
  e.g. `99999.json`, so it sorts last). Five digits handles 9,999 turns/session
  with margin and keeps lexicographic sort correct. R2 has no append, so
  per-event objects are the simplest correct model — no read-modify-write races,
  no data loss if a session never ends cleanly. Reconstruct a session by listing
  the `sessions/<sessionId>/` prefix and sorting by key.
- **Bounding growth (review M8).** A public write endpoint with one-object-per-
  event needs caps so a buggy retry loop or abuse can't fill the bucket silently:
  - **Per-session event cap** enforced in `/api/log` (reject events past a sane
    ceiling, e.g. a few thousand per `sessionId`);
  - an **R2 lifecycle/retention rule** (auto-expire objects after N days — these
    are dev debugging aids, not a system of record);
  - body-size + shape validation (already required below).
- Playtest volume is low; many small objects is fine. **D1 is deferred** (§1);
  R2 raw blobs are sufficient for "replay a session to debug." A later phase can
  batch-ingest R2 → D1 for querying/leaderboard.

### Custom domain — `zork.lhocke.dev`

- **`lhocke.dev` is owned; the `zork.` subdomain is not yet mapped — this is a
  Phase 1 task.** Add `zork.lhocke.dev` as a custom domain on the Pages project
  (Cloudflare provisions the cert + DNS automatically when the apex is already
  on Cloudflare).
- Verify TLS + same-origin `/api/*` resolution as part of G2 (§8).

### Abuse / hardening (public write endpoints)

Both Functions are **public and write-capable**, so they need basic protection
even for a small playtest:

- **`/api/log`:** cap request body size; validate the event is a well-formed
  `PlaytestEvent` and reject otherwise; basic per-`sessionId` rate sanity. Worst
  case is junk R2 objects — low blast radius, but don't leave it wide open.
- **`/api/feedback`:** higher risk — it creates GitHub issues, so it's an
  **issue-spam / injection vector.** Needs real throttling: a bot check
  (Cloudflare **Turnstile**) and/or strict rate limiting, hard size caps, and
  the sanitization in §7. This is called out again in §7 as a security
  requirement, not an afterthought.
- **Turnstile key management (review):** the **sitekey** is public and baked into
  the client at build (`VITE_TURNSTILE_SITEKEY` env var — distinct from, and not
  to be confused with, the secret); the **secret key** is a Pages secret used by
  the Function's **server-side token verification** call. The server-side verify
  step is the actual gate on issue creation — its request/response shape is
  **verified against current Cloudflare docs at implementation** (rule-18,
  extending the note above beyond just wrangler/R2 syntax).

## 6. Graceful Troll-Wall

The troll is Phase 1's content boundary: the first place where the missing
mechanic (combat, Phase 2) blocks progress. The goal is to make that boundary
**feel intentional and in-spirit**, not like a broken game.

### The wall already exists (keep it)

`TROLL-ROOM`'s onward exits are already gated faithfully:

```
east → EW-PASSAGE  (ifFlag TROLL-FLAG, else "The troll fends you off with a menacing gesture.")
west → MAZE-1      (ifFlag TROLL-FLAG, else "The troll fends you off with a menacing gesture.")
south → CELLAR     (always open — the way back)
```

`TROLL-FLAG` is only set by defeating the troll, which requires combat (Phase 2).
So in Phase 1 east/west stay blocked with the **authentic ZIL fend-off message**.
We keep this verbatim — it's correct, not a stopgap.

### The playable region

Everything reachable **without passing the troll**: above-ground (forest, the
house and its rooms, up-a-tree), and the underground loop the cellar opens —
Cellar, East-of-Chasm, Gallery (**the painting** — take + stash it), Studio, and
the chimney back up to the Kitchen. Plus the Troll Room itself. The maze (west)
and the rest of the Great Underground Empire (east) are gated.

### The broken edge to fix — `attack troll`

`ATTACK` parses (it's in `vocabulary.json` + `syntax.json` → `V-ATTACK`), but
`V-ATTACK` has no handler and `TROLL-FCN` is unregistered in Phase 1, so the
command currently falls through to an unimplemented-verb error. That reads as a
bug. Phase 1 must intercept attack/kill attempts on the troll with an
intentional, in-world response. (The exact current fallthrough string is
**confirmed at implementation** — review couldn't pin the literal text from the
spec, and it doesn't matter: the Phase-1 test asserts the **new sign output**, not
the old error, since we're replacing the behavior.)

### The troll-sign (deliberate fidelity break)

When the player tries to fight the troll (or examines it), the troll produces a
**sign** — a whimsical, in-the-spirit-of-Zork meta-response that signals "this is
the edge of the current content," not a failure. This is a **conscious fidelity
break**, scoped to Phase 1 and removed at the Phase 2 gate.

Draft copy (open to wordsmithing — the user's seed was *"Thanks for playing,
further adventures are under development"*):

> *The troll, bored, produces a hand-lettered sign and holds it up:*
> *"THANK YOU FOR PLAYING. FURTHER ADVENTURES ARE UNDER DEVELOPMENT."*
> *He seems disinclined to fight today.*

**Where the sign may surface — constrained by the byte-identical golden (review,
verified).** The 218-command golden contains `> examine troll` →
*"A nasty-looking troll, brandishing a bloody axe, blocks all passages out of the
room."* (golden line 328–329). `attack troll` / `kill troll` are **not** in the
golden (verified). Therefore:

- ✅ **`attack troll` / `kill troll (with X)`** → the sign response. **This is the
  only in-world surface for the sign.** These commands aren't in the golden, so
  adding behavior here is safe.
- ❌ **`examine troll`** must **NOT** change — it's in the golden. Do not add a
  sign-mention to the examine path.
- ❌ The **troll `ldesc` and the Troll Room description must NOT change** — both
  are emitted by golden commands (`examine troll`, entering the room). No
  description hint.

So a purely non-combative player won't see the in-world sign; the **known-issues
list (§7)** is their out-of-world signpost that content ends at the troll. This
keeps the frozen-engine / byte-identical invariant intact (§8 G1) — which §6's
earlier draft contradicted.

The authentic **"troll fends you off"** exit messages stay as-is — a player who
tries to walk past gets the real response.

### Implementation — minimal, clearly removable

A single **Phase-1-only `V-ATTACK` handler**, registered so attack/kill never
errors:
- target is the **troll** → the sign message;
- any other target → a graceful in-spirit deflection (no villains exist
  pre-troll, so this is just to avoid the raw "I don't know how to attack"
  anywhere).

Marked unambiguously as temporary (e.g. `// PHASE-1 TEMPORARY — replaced by real
combat in Phase 2`) so the Phase 2 combat work removes/replaces it wholesale.
(Exact PERFORM-chain placement — object handler vs. verb default — verified at
implementation; either way the troll case must intercept before the
unimplemented-verb fallthrough.)

### Preserving the real combat for Phase 2

The faithful troll fight is **designed but not yet built** (see the Phase 2
combat design). The fidelity break here must not lose that work:
- The sign override is **isolated and flagged**, so removing it is mechanical.
- The authentic combat-initiation behavior and narration (ZIL
  `1actions.zil` troll/melee text, captured in the Phase 2 design → `messages.json`)
  remain the source of truth for what replaces the sign.
- **Removing the Phase-1 sign override is an explicit checklist item in Phase 2's
  G1 gate** — the gate doesn't pass while the temporary override is still live.
- **Automated guard, not just a checklist (review M9).** A human ticking a box is
  weak enforcement ("make errors loud"). Add a **test/CI check that fails if the
  Phase-1 override marker is still present once real combat exists** — e.g. a test
  that greps for the `// PHASE-1 TEMPORARY` marker and fails when the Phase 2
  combat module is also present, or asserts that `attack troll` produces combat
  (not the sign) once Phase 2 lands. This makes a stale override a red build, not
  a forgotten checkbox.

### Out-of-world backstop

In-world, the sign carries the message. Out-of-world, the **known-issues list
(§7)** states plainly that Phase 1 content ends at the troll and combat is coming
— so a tester is never confused about whether they hit a bug or the edge of the
build.

## 7. Tester-Facing

Three things testers interact with: a **known-issues list** (so the edges read
as intentional), a **feedback form**, and **support links**.

### Known-issues / divergences list

Surfaced via a Tailwind Plus dialog (the same modal component as the form, §3).
Sets expectations so testers don't report the intentional edges as bugs:

- **Content ends at the troll.** Combat arrives in a later phase; the troll won't
  fight yet (the sign, §6).
- **No saving.** Each page load is a fresh game (§1).
- **The map is rough** and only covers the pre-troll area; no maze, no full-game
  map yet.
- **No thief, no cyclops, no combat** (deferred mechanics).
- **`RANDOMIZE-OBJECTS` is deferred** — object placement is deterministic.
- **Score is out of the full game's 350** (review L11) — `maxScore` is the whole
  game's total, so the pre-troll region only reaches a small fraction (e.g.
  "10/350"). That's expected, not a bug.
- Any other known engine divergences from canonical Zork found before launch
  (filled in at G3).

This list is **content authored at build time**, not generated.

### Feedback form

A Tailwind Plus dialog with:
- a **category** select (`bug` / `suggestion` / `UI issue` / `other`),
- a free-text **message**,
- optional "what were you doing?" context,
- on submit → `POST /api/feedback` (§5) → a sanitized **GitHub issue**.

**Correlate with the session.** The form auto-includes the current anonymous
`sessionId` so a report can be tied back to that session's R2 transcript (§5) for
debugging. Still anonymous — `sessionId` identifies a session, not a person.
**Disclose the linkage (review M5):** the form states that submitting links this
report to the session's gameplay transcript (and, for UI issues, to the attached
browser info) — so the "telemetry is separate" framing isn't oversold. Remind
testers not to type anything personal in the free-text field.

**UI-issue browser info (the §4 exception).** When category is **`UI issue`**,
the form attaches **browser info** (user agent, viewport size, active theme),
with a visible line stating it's being included. This is the *only* path that
collects client info, and only on a UI report — gameplay telemetry stays
gameplay-only (§4).

#### Repo target — DECIDED: separate private feedback repo

Issues are created in a **dedicated, separate, *private* feedback repo** —
**`lhocke/zork-feedback`** (created 2026-06-07; confirmed PRIVATE, issues
enabled) — not the code repo, not a public repo:
- **Not the code repo (`zplus`):** keeps tester-generated content out of
  the sensitive code repo, and scopes the GitHub token to a repo that holds
  **nothing sensitive** — so a token leak from the Worker can't touch code,
  history, or ops material. Smallest blast radius.
- **Not a public repo:** the mirror is deferred and a public issue tracker would
  expose raw tester text (and the project's existence) prematurely.
- Cheap to create, trivially promotable later. Creating it is a Phase 1 task.

#### Sanitization (security requirement, not polish)

All form fields are **untrusted input**. The Function (server-side; token never
reaches the client) must:

- **Wrap all user text in a fenced code block** in the issue body. Fenced code
  neutralizes GitHub-flavored markdown, HTML, **and** `@mentions` / `#refs`
  (GitHub doesn't autolink inside code fences) — so no notification-spam or
  cross-linking via crafted input.
- **Fence-selection algorithm must be explicit (review M7) — it's load-bearing
  security, not polish.** Wrapping is only safe if the user content can't close
  the fence:
  - Choose a **backtick fence longer than the longest backtick run in the
    content** (GitHub's own rule for nesting), not a fixed ```` ``` ````.
  - **Also handle `~~~` tilde fences** — GitHub honors them too; strip/escape
    them in the content (the spec's "neutralize backticks" alone was incomplete).
  - Ensure **every** interpolated user-or-derived value (including `sessionId`)
    sits **inside** a fence; never interpolate raw user text outside one.
- **Generate the issue title server-side** (e.g. `[playtest] <category> —
  <sessionId>`); never let user text control the title.
- **Validate the category against a fixed allow-list**; apply labels server-side.
- **Hard size caps** on every field; reject oversized payloads.
- **Abuse protection** (from §5): **Cloudflare Turnstile** on the form +
  rate-limiting on `/api/feedback`, since it creates issues (issue-spam /
  injection vector).
- Echo **nothing sensitive** back to the client; the Function returns only a
  success/failure status.

**Spam mitigation (layered).** The owner explicitly asked for spam-catching, and
it's sized for a **public endpoint**, not a closed one.

> **Threat-model correction (rebuttal to the "overkill for a closed playtest"
> review note).** There is **no access gate** on the site — an invite-checker
> would itself be the overkill, and it's out of scope. So the page and its
> `/api/feedback` endpoint are reachable and scrapeable by **anyone on the
> internet** (bots included) the moment they're live. *Promotion* is limited;
> *traffic* is not controlled. The full layered stack is therefore appropriate
> **from launch** — there is no "closed" phase to defer it behind.

- **Baseline (live from launch):** Turnstile + hard rate-limit + size caps +
  honeypot + content heuristics + duplicate detection (all quarantine-not-drop on
  heuristic hits).
- **Escalation only (genuine third-party cost/dependency):** an Akismet-style
  service — added only if observed volume warrants it.

Turnstile stops most bots up front; on top of it:

- **Honeypot field** — a hidden input real users never fill; a filled honeypot →
  silently reject. Cheap, catches naive bots Turnstile might miss.
- **Content heuristics** — cap the number of URLs/links, reject obvious
  link-spam / excessive repetition / known spam patterns, charset sanity.
- **Per-session/IP rate limit + duplicate detection** — reject near-identical
  resubmissions.
- **Quarantine, don't silently drop, on heuristic hits.** Turnstile/honeypot
  failures (high-confidence bot) are rejected outright; *heuristic* spam
  suspicion instead creates the issue with a **`suspected-spam` label** rather
  than dropping it — so a false positive doesn't lose a real tester's feedback.
- **Optional escalation:** if spam volume warrants it, add a third-party check
  (e.g. Akismet-style) behind the same endpoint — not built unless needed.

**Fallback:** if the GitHub-issue path is deferred or fails hardening in time,
fall back to a **Google Sheet** sink for the form (same `/api/feedback` endpoint,
different backend) so feedback collection isn't blocked on the issue integration.

### Support links

- **Ko-fi / Patreon** links (anchors only — no repo exposure), present in the
  sidebar/footer.
- **GitHub Sponsors is NOT included** — it waits for the public mirror (deferred,
  per project memory).

## 8. Phase Gates

Four gates. Phase 1 runs G0 → G3 once; **every future feature (Phase 2 combat,
etc.) re-runs G1 → G3 behind the live build.** A gate must fully pass before the
next begins.

### G0 — Design → Spec  *(this pipeline)*

- [ ] Spec authored (this document).
- [ ] Through the review panel (adversarial / implementer / neutral), findings
      resolved or explicitly deferred.
- [ ] Test strategy produced.
- [ ] **User sign-off** on the converged spec.

### G1 — Build / Merge

- [ ] `GameSession` facade implemented (incl. `close()` + on-construction
      `reset*()` wiring for session freshness, §2); `tools/play.ts` refactored
      onto `FileSink` (human-readable format + sync append preserved, §4).
- [ ] **Seam tests pass** (§2): golden-through-facade **byte-identical** (same
      normalization as the committed golden), snapshot contract (no
      `exits[].known` "transition" assertion), full lifecycle sink emission
      (`start`/`turn`/`close`).
- [ ] Web shell built — terminal, status bar, rough box-drawing map, Tailwind
      themes, responsive (§3).
- [ ] `PlaytestSink`: `FileSink` + `HttpSink` (§4).
- [ ] Phase-1 `V-ATTACK` troll-sign handler + tests, marked `// PHASE-1
      TEMPORARY` (§6). **Sign only on `attack`/`kill troll`** — `examine troll`,
      the troll `ldesc`, and the Troll Room description are unchanged (they're in
      the golden). Test asserts the new sign output, not the old error string.
- [ ] **All existing tests green** (1393+) **and the 218-command golden stays
      byte-identical** (the RNG-injection invariant held — no FrotzRng flip).
- [ ] **Faithfulness audit** over the troll-wall area touched by the sign handler
      (engine otherwise frozen).
- [ ] Stale "web shell arrives in Phase 4" comments removed (§2).
- [ ] Merged to **main** (human commit voice, no `feat:`/`fix:`, never detach —
      founding constraint).
- [ ] Production build: `dist/` produced, **source maps off**, deploy preflight
      asserts `dist/` is build-output-only (§5).

### G2 — Deploy + Log-Smoke

- [ ] `zork.lhocke.dev` subdomain mapped to the Pages project; **TLS valid**;
      same-origin `/api/*` resolves.
- [ ] Site deployed via `wrangler pages deploy dist` (§5).
- [ ] R2 bucket created + bound; **log-smoke: play a real session and confirm
      its `TurnEvent`s land in R2** under `sessions/<sessionId>/`.
- [ ] `buildId` in logged events matches the deployed commit.
- [ ] Feedback repo (`zork-feedback`, private) created; `GITHUB_TOKEN` secret
      set; **feedback-smoke: submit the form → a sanitized issue appears** in the
      feedback repo; Turnstile + rate-limit active.

### G3 — Playtest-Ready

- [ ] **Graceful troll-wall** verified in the deployed build: the sign on
      `attack`/`kill troll` (NOT `examine` — that stays golden-identical);
      authentic fend-off on east/west (§6).
- [ ] **Known-issues / divergences list** authored and reachable (§7).
- [ ] **Feedback form** works end-to-end, including the UI-issue browser-info
      path + its disclosure, and spam mitigations live (§7).
- [ ] **On-page notice** ("gameplay may be reviewed…") present (§4).
- [ ] Ko-fi / Patreon links present (§7).
- [ ] **Responsive check** on a real phone + desktop (§3).
- [ ] Shareable URL + a short tester onboarding note (URL, known-issues,
      how to give feedback).

### Recurring-gate note

Future features re-enter at **G1** behind the live build. **Phase 2 (combat)
specifically must clear "remove the Phase-1 `V-ATTACK` sign override" as a G1
item** (§6) — enforced by an **automated guard test** (fails if the
`// PHASE-1 TEMPORARY` override is still present once real combat exists), not
just a manual checkbox.

## 9. Test Strategy

Merged from two independent test-strategy reviews (behavior/correctness +
integration/operational lenses), grouped by section. Approach tag per item:
**U** = unit, **I** = integration, **M** = manual. New code lives in `src/shell/`,
`src/ui/`, `functions/` (none exist yet).

### §2 Boundary contract
- **U** `start`/`submit`/`snapshot`/`close` delegate verbatim; `submit` returns
  engine output unchanged (errors propagate untransformed).
- **I** **Golden-through-the-facade byte-identical** — replay all 218 commands via
  `createSession({sink:nullSink}).submit()` vs the committed golden. Compare the
  **engine-output-only stream** with the **same normalization the oracle uses**
  (intro via `start()`, no status-line injection). *Primary seam invariant.*
- **I** Snapshot contract: all seven `GameView` fields present/typed; **do NOT
  assert `exits[].known` transitions** (static field).
- **U** Module-state reset: a second `createSession()` in the same process starts
  clean (all six `reset*()` globals cleared) — the Phase-2 play-again guard.
- **U** Default seed = 42 → deterministic; no-FrotzRng invariant.
- **U** Sink emission: one `SessionStart` on `start`, one `TurnEvent` per `submit`
  (1-based `turn`, fields consistent with return + snapshot), one `SessionEnd` on
  `close`; `lastTurn` = submit count; **second `close()` does not double-emit**;
  `submit` after `close` emits nothing.
- **U** `nullSink` no-ops never throw.

### §3 Web shell (UI)
- **U** Fog-of-war map-state logic (in isolation, driven by scripted `view()`
  snapshots): room reveals only after `here` reaches it; A↔B edge reveals only
  after a traversal; **regression guard — the map module never reads
  `exits[].known`** as a discovery signal; unknown room id (past troll) ignored,
  no crash; resurrection→`FOREST-1` non-linear transition handled.
- **U** Theme init: missing/corrupt `localStorage` value → defaults to CRT, no
  crash. Empty `submit("")` emits no `TurnEvent`, no crash.
- **M** Core loop: start banner on load; Enter submits; status bar refreshes;
  whitespace preserved verbatim; ↑/↓ history; click-to-focus; auto-scroll; theme
  switch toggles `data-theme` + persists across reload; on-page notice visible;
  responsive (desktop two-col / mobile drawer) — phone check at G3.

### §4 PlaytestSink + telemetry
- **U** `TurnEvent` schema: all nine fields populated; `command` raw/untrimmed;
  `output` = engine output (not the status line); `room` = post-turn `here`;
  `ts` valid ISO + advances; `sessionId` a fresh UUID per session, consistent
  across a session's events.
- **U** **Privacy is structural** — `TurnEvent`/`SessionStart`/`SessionEnd` types
  have **no** `userAgent`/IP/geo fields (compile-time type assertion).
- **U** `FileSink`: re-serializes to the **human-readable flat-text** format (not
  JSON); uses **`appendFileSync`** (crash-safety); creates `playtest-logs/` if
  missing; writes a terminator on `close`.
- **U** `HttpSink`: one POST/event; failed POST swallowed (gameplay unblocked) +
  logged in dev; retries a few times then drops; **`pagehide` drains the whole
  queue via `sendBeacon`**; **`visibilitychange→hidden` does NOT emit
  `SessionEnd`** (only real teardown does); zero-command session still emits
  start+end; `buildId` = injected `__BUILD_ID__`.

### §5 Cloudflare deployment
- **I** `/api/log`: valid event → `204` + R2 object at
  `sessions/<id>/<seq>.json`; **U** key zero-pad width = 5 (`00000` start,
  `99999` end, lexicographic sort = emission order); malformed/oversized → `4xx`,
  no write; per-session cap → reject.
- **I** `/api/feedback`: valid+Turnstile → issue in `zork-feedback`; title is
  server-generated template (no user text); category allow-list → label, unlisted
  → `400`; honeypot → silent success-shaped reject, no issue; invalid Turnstile →
  reject, no issue; rate-limit → `429`; response echoes nothing sensitive.
- **U** `__BUILD_ID__` `declare const` typechecks; key-gen padding pure function.
- **M/preflight** no source maps in `dist/`; deploy preflight asserts `dist/` is
  build-output-only (no `.ts`/`.md`/hidden dirs).

### §6 Graceful troll-wall
- **U** `attack troll` / `kill troll` / `attack troll with sword` (GWIM) → the
  **sign** (not the unimplemented-verb error); `attack <non-troll>` → graceful
  deflection.
- **U** **Golden-preserving guards:** `examine troll`, troll `ldesc`, Troll Room
  description all **unchanged** vs golden; east/west → authentic fend-off;
  `attack troll` does **not** set `TROLL-FLAG` (wall stays up); no sign text bleeds
  into any describe path.
- **U** `// PHASE-1 TEMPORARY` marker present (the Phase-2 guard's trigger); the
  **guard test** (authored in Phase 1, passing now) fails if the marker coexists
  with a Phase-2 combat module.

### §7 Tester-facing
- **U** **Fence-selection algorithm** (load-bearing security): outer fence =
  longest backtick run + 1 (test N=0,1,2,3,max); `~~~` tilde fences
  stripped/escaped; every user value (incl. `sessionId`) sits inside a fence;
  oversized field rejected pre-API.
- **I** Form: all fields + `sessionId` sent; browser info attached **only** on
  `UI issue` (absent otherwise); disclosures visible (review/transcript linkage +
  no-personal-info reminder); heuristic spam → issue with `suspected-spam` label
  (quarantine, not drop).
- **I/M** Known-issues dialog lists all required items; Ko-fi/Patreon present,
  GitHub Sponsors absent; client category select constrained to four options.

### Coverage gaps (verify out-of-band; can't be CI-tested)
- `pagehide`+`sendBeacon` real-browser delivery (esp. iOS Safari) → **G2 manual
  smoke** (close tab mid-session, confirm final events + `SessionEnd` in R2).
- R2 durability/ordering + per-session cap under concurrency → **G2 log-smoke**;
  cap accepted non-atomic for a small playtest.
- Turnstile live verify → use Cloudflare test keys in I-tests + **G2 live smoke**.
- R2 lifecycle/retention rule, TLS + same-origin at `zork.lhocke.dev` → **G2
  manual**.
- **`GITHUB_TOKEN` scope** (fine-grained, `zork-feedback`-only, issues:write) —
  not code-verifiable → **G2 checklist item: inspect the PAT settings in GitHub**.
- `__BUILD_ID__` survives the production build → assert in deploy preflight.
- Cross-browser theme/box-drawing rendering, hand-authored map layout visual
  correctness, FileSink Ctrl-C crash-safety → **G3 manual**.

### Deliberate skips (with rationale)
- Re-testing frozen `Game` internals (1393 existing tests cover them).
- `exits[].known` "transitions" (spec forbids — static field).
- Tailwind Plus component internals + exact CSS token values (third-party; brittle).
- `HermesSink` absence, Google Sheet fallback, Akismet-style spam escalation,
  `RANDOMIZE-OBJECTS` — all explicitly deferred/unbuilt in Phase 1. (Note:
  content heuristics + duplicate detection are **baseline** now — public-endpoint
  threat model — so they DO get coverage under §7 above; only the third-party
  Akismet escalation is deferred.)
- External link liveness (Ko-fi/Patreon) — structural href check only.
