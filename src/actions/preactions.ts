/**
 * PRE-* preaction handlers (gverbs.zil).
 *
 * Run at PERFORM step 3 (gmain.zil:213) when the resolved syntax form carries
 * a matching `preAction` name. Return true (RTRUE) to block the default V-*,
 * false (RFALSE) to allow it. Call ctx.fatal() before returning true for RFATAL.
 *
 * Messages must be verbatim ZIL TELL strings — the oracle does exact-string comparison.
 */

import type { ActionContext, ActionHandler, GameObject } from '../domain/game-object.js';
import { Flag } from '../domain/flags.js';

// HELD? — ZIL HELD?(CAN): walks LOC chain until WINNER or FALSE.
function heldByPlayer(obj: GameObject, player: GameObject): boolean {
  let cur: GameObject | null = obj.parent;
  while (cur !== null) {
    if (cur === player) return true;
    cur = cur.parent;
  }
  return false;
}

// FLAMING? — ZIL: (FSET? OBJ FLAMEBIT) AND (FSET? OBJ ONBIT)
// Port: Flag.OnFire AND Flag.Light (a burning match or torch has both).
function isFlaming(obj: GameObject): boolean {
  return obj.has(Flag.OnFire) && obj.has(Flag.Light);
}

// PRE-BOARD (gverbs.zil:201)
export const preBoardHandler: ActionHandler = (ctx: ActionContext): boolean => {
  const { dobj, actor, here, tell, fatal } = ctx;
  if (dobj === undefined) return false;

  if (dobj.has(Flag.Vehicle)) {
    if (dobj.parent !== here) {
      tell(`The ${dobj.desc} must be on the ground to be boarded.`);
      fatal();
      return true;
    }
    const playerParent = actor.parent;
    if (playerParent !== null && playerParent.has(Flag.Vehicle)) {
      tell(`You are already in the ${playerParent.desc}!`);
      fatal();
      return true;
    }
    return false;
  }

  // WATER/GLOBAL-WATER check not yet modeled; fall through to RFATAL message.
  tell(`You have a theory on how to board a ${dobj.desc}, perhaps?`);
  fatal();
  return true;
};

// PRE-BURN (gverbs.zil:243)
export const preBurnHandler: ActionHandler = (ctx: ActionContext): boolean => {
  const { iobj, tell } = ctx;
  if (iobj === undefined) {
    tell("You didn't say with what!");
    return true;
  }
  if (isFlaming(iobj)) return false;
  tell(`With a ${iobj.desc}??!?`);
  return true;
};

// PRE-DROP (gverbs.zil:474)
// If PRSO == LOC(WINNER) (player is inside it), perform V-DISEMBARK (RTRUE).
// V-DISEMBARK: on land → move player to here, tell "You are on your own feet again."
//              over water → "Getting out here would be fatal."
export const preDropHandler: ActionHandler = (ctx: ActionContext): boolean => {
  const { dobj, actor, here, tell } = ctx;
  if (dobj === undefined) return false;
  if (actor.parent !== dobj) return false;
  // Player is inside the object being dropped — perform V-DISEMBARK.
  if (!here.has(Flag.Land)) {
    tell("Getting out here would be fatal.");
    ctx.fatal();
    return true;
  }
  ctx.moveTo(actor, here);
  tell("You are on your own feet again.");
  return true;
};

// PRE-FILL (gverbs.zil:646)
// V-FILL body is deferred; WATER/GLOBAL-WATER detection holds the slot.
export const preFillHandler: ActionHandler = (ctx: ActionContext): boolean => {
  const { dobj, iobj, world, here, tell } = ctx;
  if (dobj === undefined) return false;

  if (iobj === undefined) {
    const water = world.get('WATER');
    const globalWater = world.get('GLOBAL-WATER');

    const roomGlobalId = here.props.get('GLOBAL');
    const hasGlobalWater = globalWater !== undefined &&
      (roomGlobalId === 'GLOBAL-WATER' || (water !== undefined && water.parent === here));

    if (hasGlobalWater || (water !== undefined && water.parent === here)) {
      return true; // V-FILL body deferred
    }
    tell('There is nothing to fill it with.');
    return true;
  }

  const water = world.get('WATER');
  const globalWater = world.get('GLOBAL-WATER');
  if (iobj === water || iobj === globalWater) return false;

  return true; // non-water PRSI → V-PUT deferred
};

// PRE-GIVE (gverbs.zil:707)
export const preGiveHandler: ActionHandler = (ctx: ActionContext): boolean => {
  const { dobj, actor, tell } = ctx;
  if (dobj === undefined) return false;
  if (!heldByPlayer(dobj, actor)) {
    tell(`That's easy for you to say since you don't even have the ${dobj.desc}.`);
    return true;
  }
  return false;
};

// PRE-MOVE (gverbs.zil:910)
export const preMoveHandler: ActionHandler = (ctx: ActionContext): boolean => {
  const { dobj, actor, tell } = ctx;
  if (dobj === undefined) return false;
  if (heldByPlayer(dobj, actor)) {
    tell("You aren't an accomplished enough juggler.");
    return true;
  }
  return false;
};

// PRE-MUNG (gverbs.zil:923)
// Zork 1: NULL-F always false, so the ZORK-NUMBER 3 branch compiles away.
// Guard: PRSI missing or not WEAPONBIT → block V-MUNG.
export const preMungHandler: ActionHandler = (ctx: ActionContext): boolean => {
  const { dobj, iobj, tell } = ctx;
  if (dobj === undefined) return false;
  if (iobj === undefined || !iobj.has(Flag.Weapon)) {
    const instrument = iobj === undefined ? 'your bare hands' : `a ${iobj.desc}`;
    tell(`Trying to destroy the ${dobj.desc} with ${instrument} is futile.`);
    return true;
  }
  return false;
};

// PRE-PUT (gverbs.zil:1075)
// Zork 1: the ZORK-NUMBER 3 branch compiles away; PRE-PUT delegates to PRE-GIVE.
// gverbs.zil:1083: "<PRE-GIVE>"
export const prePutHandler: ActionHandler = (ctx: ActionContext): boolean => {
  return preGiveHandler(ctx);
};

// PRE-READ (gverbs.zil:1137)
// LIT check simplified: Flag.On on the room.
export const preReadHandler: ActionHandler = (ctx: ActionContext): boolean => {
  const { iobj, here, tell } = ctx;
  if (!here.has(Flag.On)) {
    tell('It is impossible to read in the dark.');
    return true;
  }
  if (iobj !== undefined && !iobj.has(Flag.Transparent)) {
    tell(`How does one look through a ${iobj.desc}?`);
    return true;
  }
  return false;
};

// PRE-SGIVE (gverbs.zil:1206)
// Re-dispatches as V-GIVE with PRSI/PRSO swapped; blocks V-SGIVE ("Foo!").
// Nested PERFORM with swapped objects is deferred; RTRUE holds the slot.
export const preSgiveHandler: ActionHandler = (_ctx: ActionContext): boolean => {
  return true;
};

// PRE-TAKE (gverbs.zil:1353)
export const preTakeHandler: ActionHandler = (ctx: ActionContext): boolean => {
  const { dobj, iobj, actor, tell } = ctx;
  if (dobj === undefined) return false;

  // PRSO IN? WINNER (direct child of player)
  if (dobj.parent === actor) {
    if (dobj.has(Flag.Wearable)) {
      tell('You are already wearing it.');
      return true;
    }
    tell('You already have that!');
    return true;
  }

  // LOC(PRSO) is a closed container
  const dobjParent = dobj.parent;
  if (
    dobjParent !== null &&
    dobjParent !== undefined &&
    dobjParent.has(Flag.Container) &&
    !dobjParent.has(Flag.Open)
  ) {
    tell("You can't reach something that's inside a closed container.");
    return true;
  }

  // PRSI given: PRSO must be in PRSI, else block
  if (iobj !== undefined) {
    if (dobj.parent === iobj) return false; // SETG PRSI <> RFALSE
    tell(`The ${dobj.desc} isn't in the ${iobj.desc}.`);
    return true;
  }

  // PRSO == LOC(WINNER): player is inside it
  if (actor.parent === dobj) {
    tell("You're inside of it!");
    return true;
  }

  return false;
};

// PRE-TURN (gverbs.zil:1488)
// Zork 1: ZORK-NUMBER 3 branch compiles away.
// BOOK (id 'BOOK') is the one object you can turn without an instrument.
export const preTurnHandler: ActionHandler = (ctx: ActionContext): boolean => {
  const { dobj, iobj, world, tell } = ctx;
  if (dobj === undefined) return false;

  if (iobj === undefined) {
    const bookObj = world.get('BOOK');
    if (dobj !== bookObj) {
      tell("Your bare hands don't appear to be enough.");
      return true;
    }
  }

  if (!dobj.has(Flag.Turnable)) {
    tell("You can't turn that!");
    return true;
  }

  return false;
};
