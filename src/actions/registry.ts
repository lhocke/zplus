/**
 * Action registry — maps ZIL routine names to translated TypeScript handlers.
 *
 * ACTION routines (`ActionHandler`): reached during PERFORM dispatch for a verb.
 * PER routines (`PerRoutine`): reached when resolving an `Exit.per` during movement,
 * returning a destination room id or undefined to block.
 *
 * Per-region files export their own maps; this module merges them.
 */

import type { ActionContext, ActionHandler, ObjectId } from '../domain/game-object.js';
import { aboveGroundActions, aboveGroundPer } from './above-ground.js';
import { lightSourcesActions } from './light-sources.js';
import { coalMineActions } from './coal-mine.js';
import { damActions } from './dam.js';
import { boatActions } from './boat.js';
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

/** Returns a destination room id, or undefined to block the move. */
export type PerRoutine = (ctx: ActionContext) => ObjectId | undefined;

const ACTIONS: Record<string, ActionHandler> = {
  ...aboveGroundActions,
  ...lightSourcesActions,
  ...coalMineActions,
  ...damActions,
  ...boatActions,
};

const PER_ROUTINES: Record<string, PerRoutine> = {
  ...aboveGroundPer,
};

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

export function lookupAction(name: string): ActionHandler | undefined {
  return ACTIONS[name];
}

export function lookupPer(name: string): PerRoutine | undefined {
  return PER_ROUTINES[name];
}

/** Look up a PRE-* handler by ZIL name (e.g. "PRE-TAKE"). */
export function lookupPreAction(name: string): ActionHandler | undefined {
  return PRE_ACTIONS[name];
}
