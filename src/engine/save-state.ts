/**
 * SS1 — SaveState schema + per-object codec helpers.
 *
 * Pure types and serialization helpers; zero engine-runtime imports beyond
 * the domain types they deal with. No game logic lives here.
 *
 * SS-AUDIT note: any field added to Actor subclasses with mutable combat state
 * is a save-surface candidate; update captureObjectDelta accordingly.
 */

import type { ObjectId } from '../domain/game-object.js';
import { Actor } from '../domain/actor.js';
import type { Flag } from '../domain/flags.js';
import type { ClockSnapshot } from './clock.js';
import type { GameObject } from '../domain/game-object.js';
import type { ModuleGlobals } from './module-globals.js';

// Bumped 1 -> 2 for the randomizer save block (Spec 2). Per phase-4 §5.3,
// this is a BREAKING bump — old (format-1) saves refuse to restore rather
// than silently missing the new block. Vanilla saves made AFTER this bump
// simply omit `randomizer` (optional field); the absence IS the "not a
// randomizer run" signal, not a separate flag.
export const SAVE_FORMAT_VERSION = 2;

export interface RandomizerSaveBlock {
  seedString: string;
  /** objectId -> current parent id, the SAME shape createGame's
   *  placementMap consumes — restore re-applies it identically to how a
   *  fresh randomized new-game would have applied it, then the normal
   *  object-delta restore (Pass 1-3, unchanged) takes over from there. */
  placements: [string, string][];
  timerMs: number;
  /** ISO 8601 timestamp of the first submitted command, or null if the
   *  player has saved before their first command (timer not yet started —
   *  Task 8). */
  firstCommandAt: string | null;
}

// SS6 supplies the concrete type; re-export so consumers importing SaveState get it too.
export type { ModuleGlobals } from './module-globals.js';

/**
 * Per-object mutable-state delta. All immutable structure (id/synonyms/exits/
 * handler/actionRoutine) is excluded — those never change at runtime.
 */
export interface ObjectDelta {
  id: ObjectId;
  // parentId; restore via moveTo. null = no parent (top-level / detached).
  parent: ObjectId | null;
  // Position of this object in its parent's children Set (insertion order).
  // printCont reverses children to match ZIL's prepend-list iteration — so
  // sibling order is a fidelity-bearing observable. null when parent is null.
  siblingOrder: number | null;
  // Numeric flag enum values — JSON-safe, lossless (Flag is numeric enum).
  flags: Flag[];
  props: [string, number | string][];
  // Mutable text fields. desc is always captured (non-optional on GameObject).
  // ldesc/fdesc omitted entirely when undefined — exactOptionalPropertyTypes + fixpoint.
  desc?: string;
  ldesc?: string;
  fdesc?: string;
  // Captured ONLY for Actor instances (player + villains carry pStrength).
  // Do NOT duck-type — use instanceof Actor.
  pStrength?: number;
}

/**
 * Complete serialization surface for a saved game.
 *
 * Invariant: every field here must round-trip faithfully. A field omitted here
 * that a future command reads will cause a divergence the round-trip oracle
 * catches only if the continuation exercises it (spec §3, line 240).
 *
 * Fields marked with // SS1-SEAM:<task> are placeholder stubs that the named
 * sibling task fills in. SS1's own tests do NOT assert on those fields.
 */
export interface SaveState {
  // --- versioning / integrity (spec §5.3) ---
  formatVersion: number;
  buildId: string;
  savedAt: string;  // ISO 8601 — display only

  // --- core counters / flags (game.ts fields) ---
  moveCount: number;
  deaths: number;
  dead: boolean;
  alwaysLit: boolean;
  gameOver: boolean;
  lucky: boolean;
  loadAllowed: number;
  loadMax: number;
  waterLevel: number;
  beachDig: number;
  hereId: ObjectId;
  visited: ObjectId[];

  // Stashed command context for M-END (object refs → ids)
  lastVerb: string;
  lastAction: string;
  lastDobjId?: ObjectId;
  lastIobjId?: ObjectId;
  lastPrep?: string;

  // --- subsystems ---
  rngMain: number;    // Rng.getState() — main stream   [SS-RNG]
  rngCombat: number;  // Rng.getState() — combat stream [SS-RNG]
  clock: ClockSnapshot[];  // clock.snapshot()
  scoring: { baseScore: number; score: number; wonFlag: boolean };  // [SS3]
  flagStore: [string, boolean][];  // FlagStore entries [SS4]
  objects: ObjectDelta[];  // per-object delta — SS1 core
  parser: { itRef?: ObjectId };  // [SS5]
  moduleGlobals: ModuleGlobals;  // [SS6]
  randomizer?: RandomizerSaveBlock;
}

// ---------------------------------------------------------------------------
// Per-object codec helpers (co-located to minimize game.ts diff)
// ---------------------------------------------------------------------------

/**
 * Capture the mutable runtime delta for a single game object.
 *
 * Sorting flags numerically canonicalizes insertion order so the fixpoint
 * round-trip doesn't break if a Set re-insertion path differs between snapshots.
 */
export function captureObjectDelta(obj: GameObject): ObjectDelta {
  // Capture sibling index so restore can re-insert children in the same order.
  // children is a JS Set (insertion-ordered); indexOf gives the live position.
  const siblingOrder = obj.parent !== null
    ? Array.from(obj.parent.children).indexOf(obj)
    : null;

  const delta: ObjectDelta = {
    id: obj.id,
    parent: obj.parent?.id ?? null,
    siblingOrder,
    flags: Array.from(obj.flags).sort((a, b) => a - b),
    props: Array.from(obj.props.entries()),
    desc: obj.desc,
  };

  // Omit ldesc/fdesc when undefined — exactOptionalPropertyTypes + fixpoint equality.
  if (obj.ldesc !== undefined) delta.ldesc = obj.ldesc;
  if (obj.fdesc !== undefined) delta.fdesc = obj.fdesc;

  // pStrength only for Actor instances — not duck-typed.
  if (obj instanceof Actor) {
    delta.pStrength = obj.pStrength;
  }

  return delta;
}

/**
 * Apply an ObjectDelta back onto a live object (scalar reinstate, no link changes).
 * Pass 1 of restore — must run before the detach/relink passes.
 *
 * REPLACE semantics: flags and props are zeroed then re-populated so a same-instance
 * restore cannot leave stale state from the running game behind.
 *
 * Text fields: desc always came from capture so always wins. ldesc/fdesc: assign
 * unconditionally (including undefined) so a bootstrap value is replaced, not kept.
 */
export function applyObjectDelta(obj: GameObject, d: ObjectDelta): void {
  // Flags — full replace.
  obj.flags.clear();
  for (const f of d.flags) obj.flags.add(f);

  // Props — full replace.
  obj.props.clear();
  for (const [k, v] of d.props) obj.props.set(k, v);

  // Text — desc always captured; ldesc/fdesc replace-not-merge (undefined wins too).
  obj.desc = d.desc ?? obj.desc;
  obj.ldesc = d.ldesc;
  obj.fdesc = d.fdesc;

  // pStrength — Actor only; the mid-combat wound channel.
  if (obj instanceof Actor && d.pStrength !== undefined) {
    obj.pStrength = d.pStrength;
  }
}
