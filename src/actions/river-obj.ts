/**
 * River-object action routines — Phase 3b CB-RIVER-OBJ.
 *
 * Scope: TREASURE-INSIDE (buoy/emerald score), RIVR4-ROOM (buoy hint),
 * WHITE-CLIFFS-FUNCTION (DEFLATE gate), FALLS-ROOM (falls description).
 *
 * ZIL source refs:
 *   TREASURE-INSIDE       1dungeon.zil:793–796
 *   RIVR4-ROOM            1actions.zil:2844–2849
 *   WHITE-CLIFFS-FUNCTION 1actions.zil:2585–2590
 *   FALLS-ROOM            1actions.zil:2621–2636
 *   BUOY-FLAG global      1actions.zil:2842
 */

import type { ActionHandler } from '../domain/game-object.js';
import { M_END, M_LOOK } from '../engine/messages.js';

// ---------------------------------------------------------------------------
// TREASURE-INSIDE — 1dungeon.zil:793–796
//
// Called as the buoy's ACTION on OPEN.
// Awards the emerald's one-time VALUE via SCORE-OBJ, then returns RFALSE so
// the normal OPEN logic continues to reveal the contents.
// ---------------------------------------------------------------------------

export const treasureInside: ActionHandler = (ctx) => {
  if (ctx.verb !== 'open') return false;
  const emerald = ctx.world.get('EMERALD');
  if (emerald !== undefined) ctx.scoreObj(emerald);
  return false;  // RFALSE — normal OPEN proceeds
};

// ---------------------------------------------------------------------------
// RIVR4-ROOM — 1actions.zil:2844–2849
//
// M-END: first time the player holds the buoy at RIVER-4 (while BUOY-FLAG is
// set), print the hint and clear BUOY-FLAG so it never fires again.
// ---------------------------------------------------------------------------

export const rivr4Room: ActionHandler = (ctx) => {
  if (ctx.rarg !== M_END) return false;

  const buoyFlag = ctx.getGlobal?.('BUOY-FLAG') ?? false;
  if (!buoyFlag) return false;

  const buoy = ctx.world.get('BUOY');
  if (buoy !== undefined && buoy.parent === ctx.actor) {
    ctx.tell('You notice something funny about the feel of the buoy.');
    ctx.setGlobal?.('BUOY-FLAG', false);
  }

  return false;  // M-END always falls through
};

// ---------------------------------------------------------------------------
// WHITE-CLIFFS-FUNCTION — 1actions.zil:2585–2590
//
// M-END: sets DEFLATE based on whether the inflated boat is in the player's
// direct inventory.
//   IN? INFLATED-BOAT WINNER  → DEFLATE = false  (boat in hand; path blocked)
//   else                      → DEFLATE = true   (boat not in hand; path open)
//
// The two WHITE-CLIFFS rooms' exits are gated by ifFlag:"DEFLATE" in rooms.json,
// so toggling this flag controls whether the narrow paths are traversable.
// ---------------------------------------------------------------------------

export const whiteCliffsFcn: ActionHandler = (ctx) => {
  if (ctx.rarg !== M_END) return false;

  const inflated = ctx.world.get('INFLATED-BOAT');
  const boatInHand = inflated !== undefined && inflated.parent === ctx.actor;
  ctx.setGlobal?.('DEFLATE', !boatInHand);

  return false;  // M-END — fall through
};

// ---------------------------------------------------------------------------
// FALLS-ROOM — 1actions.zil:2621–2636
//
// M-LOOK: base falls description, then one of two rainbow-state lines keyed
// on RAINBOW-FLAG.
//   RAINBOW-FLAG = true  → "A solid rainbow spans the falls."
//   else                 → "A beautiful rainbow can be seen over the falls and to the west."
//
// Replaces the static ldesc in rooms.json (which bakes in the unflagged text).
// ---------------------------------------------------------------------------

export const fallsRoom: ActionHandler = (ctx) => {
  if (ctx.rarg !== M_LOOK) return false;

  // :2623–2625
  ctx.tell(
    'You are at the top of Aragain Falls, an enormous waterfall with a\n' +
    'drop of about 450 feet. The only path here is on the north end.',
  );

  const rainbowFlag = ctx.getGlobal?.('RAINBOW-FLAG') ?? false;
  if (rainbowFlag) {
    // :2628
    ctx.tell('A solid rainbow spans the falls.');
  } else {
    // :2631
    ctx.tell('A beautiful rainbow can be seen over the falls and to the west.');
  }

  return true;
};

export const riverObjActions: Record<string, ActionHandler> = {
  'TREASURE-INSIDE':      treasureInside,
  'RIVR4-ROOM':           rivr4Room,
  'WHITE-CLIFFS-FUNCTION': whiteCliffsFcn,
  'FALLS-ROOM':           fallsRoom,
};
