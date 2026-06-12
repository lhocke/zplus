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
import { riverObjActions } from './river-obj.js';
import { beachActions } from './beach.js';
import { rainbowActions } from './rainbow.js';
import { hadesActions } from './hades.js';
import {
  treasureRoomFcnAction,
  chaliceFcnAction,
  stilettoFunctionAction,
  largeBagFAction,
  dumbContainerAction,
} from './treasure-room.js';
import { cyclopsFcnAction, cyclopsRoomFcnAction } from './cyclops.js';
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
  'TREASURE-ROOM-FCN': treasureRoomFcnAction,
  'CHALICE-FCN':       chaliceFcnAction,
  'STILETTO-FUNCTION': stilettoFunctionAction,
  'LARGE-BAG-F':       largeBagFAction,
  'DUMB-CONTAINER':    dumbContainerAction,
  'CYCLOPS-FCN':       cyclopsFcnAction,
  'CYCLOPS-ROOM-FCN':  cyclopsRoomFcnAction,
  ...damActions,
  ...boatActions,
  ...riverObjActions,
  ...beachActions,
  ...rainbowActions,
  ...hadesActions,
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
