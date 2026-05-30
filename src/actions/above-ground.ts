/**
 * Above-ground region action routines.
 *
 * Each entry is a hand-translation of a ZIL ACTION/PER routine from
 * 1actions.zil.  Handlers follow the dispatch contract in
 * src/domain/game-object.ts:
 *
 *   - Object/room ACTION routines are `ActionHandler`s returning HandlerResult
 *     (true = ZIL RTRUE → suppress the remaining dispatch steps).
 *   - PER routines (exit-resolution functions) are `PerRoutine`s returning the
 *     destination room id, mirroring a ZIL routine that returns a room object.
 *
 * This file is the seed of the per-region pattern: registry.ts imports the
 * exported maps below and merges them into one lookup keyed by ZIL routine name.
 */

import type { ActionHandler } from '../domain/game-object.js';
import { Flag } from '../domain/flags.js';
import { M_LOOK } from '../engine/messages.js';
import type { PerRoutine } from './registry.js';

// ---------------------------------------------------------------------------
// Room ACTION routines (branch on ctx.rarg).
// ---------------------------------------------------------------------------

/**
 * WEST-HOUSE — the WEST-OF-HOUSE room action (zil/1actions.zil:7).
 *
 * Only the M-LOOK branch is faithful here: it prints the field description.
 * The original also appends a secret-path clause when WON-FLAG is set; that
 * global is post-endgame, so the clause stays gated behind the WON-FLAG object
 * being present and flagged (it never is pre-endgame, matching the original).
 */
export const westHouse: ActionHandler = (ctx) => {
  if (ctx.rarg === M_LOOK) {
    let text =
      'You are standing in an open field west of a white house, with a boarded\n' +
      'front door.';
    const wonFlag = ctx.world.get('WON-FLAG');
    if (wonFlag !== undefined && ctx.hasFlag(wonFlag, Flag.Touched)) {
      text += ' A secret path leads southwest into the forest.';
    }
    ctx.tell(text);
    return true;
  }
  return false;
};

// ---------------------------------------------------------------------------
// Object ACTION routines (branch on ctx.verb).
// ---------------------------------------------------------------------------

/**
 * MAILBOX-F — the small mailbox's action (zil/1actions.zil:2259).
 *
 *   <COND (<AND <VERB? TAKE> <EQUAL? ,PRSO ,MAILBOX>>
 *          <TELL "It is securely anchored." CR>)>
 *
 * The mailbox carries TAKEBIT, so without this PRSO-handler intercept the
 * default TAKE verb would happily pick it up.  Returning true short-circuits
 * the default verb — the whole point of the dispatch order.
 */
export const mailboxF: ActionHandler = (ctx) => {
  if (ctx.verb === 'take' && ctx.dobj === ctx.self) {
    ctx.tell('It is securely anchored.');
    return true;
  }
  return false;
};

// ---------------------------------------------------------------------------
// PER routines (exit resolution; return a destination room id).
// ---------------------------------------------------------------------------

/**
 * MAZE-DIODES — one-way maze passage (zil/1actions.zil:898).
 *
 * Prints the no-return warning, then maps the current room to its (fixed,
 * non-random) destination.  Returning undefined would block movement; every
 * MAZE-DIODES exit resolves to a real room.
 */
export const mazeDiodes: PerRoutine = (ctx) => {
  ctx.tell(
    "You won't be able to get back up to the tunnel you are going through\n" +
      'when it gets to the next room.\n',
  );
  switch (ctx.here.id) {
    case 'MAZE-2':
      return 'MAZE-4';
    case 'MAZE-7':
      return 'DEAD-END-1';
    case 'MAZE-9':
      return 'MAZE-11';
    case 'MAZE-12':
      return 'MAZE-5';
    default:
      return undefined;
  }
};

// ---------------------------------------------------------------------------
// Exported region maps — keyed by ZIL routine name.
// ---------------------------------------------------------------------------

/** ACTION routines (rooms + objects) for the above-ground region. */
export const aboveGroundActions: Record<string, ActionHandler> = {
  'WEST-HOUSE': westHouse,
  'MAILBOX-F': mailboxF,
};

/** PER (exit-resolution) routines for the above-ground region. */
export const aboveGroundPer: Record<string, PerRoutine> = {
  'MAZE-DIODES': mazeDiodes,
};
