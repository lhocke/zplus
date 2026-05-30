/**
 * Action registry — maps ZIL routine names to translated TypeScript handlers.
 *
 * Two distinct shapes live here, mirroring the two ways ZIL routines are
 * reached:
 *
 *   - ACTION routines (`ActionHandler`) are reached during PERFORM dispatch
 *     for a verb.  A room's `actionRoutine` and an object's `actionRoutine`
 *     both land here; the room handler branches on `rarg`, the object handler
 *     on `verb`.  Returning true is ZIL RTRUE — it short-circuits the rest of
 *     the dispatch chain.
 *
 *   - PER routines (`PerRoutine`) are reached when resolving an `Exit.per`
 *     during movement.  They print and return a destination room id (or
 *     undefined to block the move), mirroring a ZIL routine that returns a
 *     room object.
 *
 * Per-region files (e.g. above-ground.ts) export their own maps; this module
 * merges them into the two global lookups.  Adding a region is a one-line
 * import + spread here — the dispatch wiring never changes.
 */

import type { ActionContext, ActionHandler, ObjectId } from '../domain/game-object.js';
import { aboveGroundActions, aboveGroundPer } from './above-ground.js';
import { lightSourcesActions } from './light-sources.js';
import {
  preBoardHandler,
  preBurnHandler,
  preDropHandler,
  preFillHandler,
  preGiveHandler,
  preMoveHandler,
  preMungHandler,
  prePutHandler,
  preReadHandler,
  preSgiveHandler,
  preTakeHandler,
  preTurnHandler,
} from './preactions.js';

/**
 * An exit-resolution routine.  Returns the destination room id, or undefined
 * to leave the player where they are (the move is blocked).
 */
export type PerRoutine = (ctx: ActionContext) => ObjectId | undefined;

// ---------------------------------------------------------------------------
// Merged lookups.
// ---------------------------------------------------------------------------

const ACTIONS: Record<string, ActionHandler> = {
  ...aboveGroundActions,
  ...lightSourcesActions,
};

const PER_ROUTINES: Record<string, PerRoutine> = {
  ...aboveGroundPer,
};

// ---------------------------------------------------------------------------
// Lookup API.
// ---------------------------------------------------------------------------

/** Look up a translated ACTION routine by its ZIL name, or undefined. */
export function lookupAction(name: string): ActionHandler | undefined {
  return ACTIONS[name];
}

/** Look up a translated PER (exit-resolution) routine by its ZIL name. */
export function lookupPer(name: string): PerRoutine | undefined {
  return PER_ROUTINES[name];
}

// ---------------------------------------------------------------------------
// Pre-action (PRE-*) registry — B4 populates the bodies; the slot is open now.
// ---------------------------------------------------------------------------

/**
 * PRE-* preaction registry — Wave B4.
 *
 * Keys are the verbatim ZIL routine names (e.g. "PRE-TAKE").  Values are the
 * translated TypeScript handlers from preactions.ts.
 *
 * Populated per td4-perform-verbs-SPEC.md §6 and gverbs.zil (line citations
 * in each handler).
 */
const PRE_ACTIONS: Record<string, ActionHandler> = {
  'PRE-BOARD': preBoardHandler,
  'PRE-BURN':  preBurnHandler,
  'PRE-DROP':  preDropHandler,
  'PRE-FILL':  preFillHandler,
  'PRE-GIVE':  preGiveHandler,
  'PRE-MOVE':  preMoveHandler,
  'PRE-MUNG':  preMungHandler,
  'PRE-PUT':   prePutHandler,
  'PRE-READ':  preReadHandler,
  'PRE-SGIVE': preSgiveHandler,
  'PRE-TAKE':  preTakeHandler,
  'PRE-TURN':  preTurnHandler,
};

/**
 * Look up a translated PRE-* routine by its ZIL name (e.g. "PRE-TAKE"),
 * or undefined when no preaction has been registered for that name.
 *
 * PERFORM step 3 calls this at dispatch time using the `preAction` string
 * carried on the resolved `ParsedCommand`.  A truthy return from the handler
 * short-circuits the chain (BLOCKS the default V-* from running).
 */
export function lookupPreAction(name: string): ActionHandler | undefined {
  return PRE_ACTIONS[name];
}

/**
 * Register a PRE-* handler (used by region modules in Wave B4).
 */
export function registerPreAction(name: string, handler: ActionHandler): void {
  PRE_ACTIONS[name] = handler;
}
