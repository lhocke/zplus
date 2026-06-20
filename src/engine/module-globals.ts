/**
 * SS6 — aggregate capture/restore for all module-level ZIL globals.
 *
 * These globals live in module scope (not on Game), and are the only mutable
 * state not reachable through the Game instance.  createSession already
 * enumerates them in its reset list; this module makes them serializable by
 * adding capture/restore on top of the existing reset functions.
 *
 * SS-AUDIT invariant (spec §10.3): SS6_VARIABLE_NAMES and
 * SESSION_RESET_VARIABLE_NAMES must stay in lockstep — a test asserts they
 * are equal.  Add a new module global to BOTH or the audit test goes red.
 */

import {
  snapshotThiefState, restoreThiefState,
  type ThiefStateSnapshot,
} from '../actions/thief-state.js';
import {
  snapshotAboveGroundState, restoreAboveGroundState,
  type AboveGroundStateSnapshot,
} from '../actions/above-ground.js';
import {
  snapshotLightSourceState, restoreLightSourceState,
  type LightSourceStateSnapshot,
} from '../actions/light-sources.js';

export interface ModuleGlobals {
  thiefState: ThiefStateSnapshot;
  aboveGroundState: AboveGroundStateSnapshot;
  lightSourceState: LightSourceStateSnapshot;
}

export function captureModuleGlobals(): ModuleGlobals {
  return {
    thiefState:       snapshotThiefState(),
    aboveGroundState: snapshotAboveGroundState(),
    lightSourceState: snapshotLightSourceState(),
  };
}

export function applyModuleGlobals(s: ModuleGlobals): void {
  restoreThiefState(s.thiefState);
  restoreAboveGroundState(s.aboveGroundState);
  restoreLightSourceState(s.lightSourceState);
}

// ---------------------------------------------------------------------------
// SS-AUDIT lockstep lists (spec §10.3)
//
// Concrete per-variable names on each side.  These must remain identical.
// "resetThiefState" clears 5 variables — we enumerate all 5 here so a newly
// added field can't hide behind the function name.
// ---------------------------------------------------------------------------

/**
 * The concrete variable names captured by captureModuleGlobals().
 * Keep in sorted order so the lockstep diff is deterministic.
 */
export const SS6_VARIABLE_NAMES: readonly string[] = [
  // thief-state.ts
  '_cyclowrath',
  '_eggSolve',
  '_thiefEngrossed',
  '_thiefHere',
  '_thiefLdesc',
  // above-ground.ts
  'grateRevealed',
  'grunlock',
  'kitchenWindowFlag',
  'rugMoved',
  'singSong',
  // light-sources.ts
  'matchCount',
];

/**
 * The concrete variable names reset by createSession's reset list.
 * Must stay in sync with session.ts:45–51.
 */
export const SESSION_RESET_VARIABLE_NAMES: readonly string[] = [
  // resetKitchenWindowFlag
  'kitchenWindowFlag',
  // resetRugMoved
  'rugMoved',
  // resetGrateRevealed
  'grateRevealed',
  // resetGrunlock
  'grunlock',
  // resetSingSong
  'singSong',
  // resetMatchCount
  'matchCount',
  // resetThiefState
  '_cyclowrath',
  '_eggSolve',
  '_thiefEngrossed',
  '_thiefHere',
  '_thiefLdesc',
];
