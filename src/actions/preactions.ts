/**
 * PRE-* preaction handlers — Wave B4.
 *
 * These are the ZIL PRE-* routines registered by ZIL name in the PRE_ACTIONS
 * table (registry.ts).  They run at PERFORM step 3 (gmain.zil:213) when the
 * resolved syntax form carries a `preAction` string matching a registered name.
 *
 * Contract:
 *   - Return true (RTRUE) to BLOCK: the preaction's guard fired; the default V-*
 *     at step 7 is suppressed.
 *   - Return false (RFALSE) to ALLOW: guard did not fire; continue to step 4+.
 *   - Call ctx.fatal() AND return true for RFATAL outcomes (e.g. PRE-BOARD).
 *
 * Source: zil/gverbs.zil (routine citations in each handler).
 *
 * IMPORTANT: handler messages must be verbatim ZIL TELL strings.  Do NOT
 * paraphrase — the oracle harness does exact-string comparison.
 *
 * Flag mapping (ZIL → Port):
 *   CONTBIT   → Flag.Container
 *   OPENBIT   → Flag.Open
 *   WEARBIT   → Flag.Wearable
 *   WEAPONBIT → Flag.Weapon
 *   TURNBIT   → Flag.Turnable
 *   VEHBIT    → Flag.Vehicle
 *   FLAMEBIT  → Flag.Flammable
 *   ONBIT     → Flag.OnFire
 *   TRANSBIT  → Flag.Transparent
 *
 * HELD?(obj) in ZIL = obj is somewhere in the WINNER's ancestor chain.
 * Port: walk obj.parent chain upward until we reach the player or null.
 */

import type { ActionContext, ActionHandler, GameObject } from '../domain/game-object.js';
import { Flag } from '../domain/flags.js';

// ---------------------------------------------------------------------------
// Internal utility: HELD?
//
// ZIL: HELD?(CAN) — walks LOC chain until WINNER or FALSE.
// Port: walk .parent chain upward; if any ancestor is the player → true.
// ---------------------------------------------------------------------------

function heldByPlayer(obj: GameObject, player: GameObject): boolean {
  let cur: GameObject | null = obj.parent;
  while (cur !== null) {
    if (cur === player) return true;
    cur = cur.parent;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Internal utility: isFlaming?
//
// ZIL: FLAMING? OBJ = (FSET? OBJ FLAMEBIT) AND (FSET? OBJ ONBIT)
// Port: Flag.Flammable AND Flag.OnFire
// ---------------------------------------------------------------------------

function isFlaming(obj: GameObject): boolean {
  return obj.has(Flag.Flammable) && obj.has(Flag.OnFire);
}

// ---------------------------------------------------------------------------
// PRE-BOARD (gverbs.zil:201)
//
// Guards:
//   1. PRSO is VEHBIT:
//      a. PRSO not IN? HERE → "The <X> must be on the ground to be boarded." RFATAL
//      b. LOC(WINNER) is VEHBIT → "You are already in the <Y>!" RFATAL
//      c. else → RFALSE (board allowed)
//   2. PRSO is WATER or GLOBAL-WATER → perform V-SWIM, RTRUE
//   3. else → "You have a theory on how to board a <X>, perhaps?" RFATAL
//
// Note: RFATAL means ctx.fatal() + return true.
// ---------------------------------------------------------------------------

export const preBoardHandler: ActionHandler = (ctx: ActionContext): boolean => {
  const { dobj, actor, here, tell, fatal } = ctx;
  if (dobj === undefined) return false;

  if (dobj.has(Flag.Vehicle)) {
    // Guard 1a: vehicle not in current room
    if (dobj.parent !== here) {
      tell(`The ${dobj.desc} must be on the ground to be boarded.`);
      fatal();
      return true;
    }
    // Guard 1b: player already in a vehicle
    const playerParent = actor.parent;
    if (playerParent !== null && playerParent.has(Flag.Vehicle)) {
      tell(`You are already in the ${playerParent.desc}!`);
      fatal();
      return true;
    }
    // Guard 1c: allowed to board
    return false;
  }

  // Guard 3: non-vehicle target
  // (Guard 2: WATER check — WATER/GLOBAL-WATER objects not yet modeled for B4;
  //  treat as a non-vehicle fall-through to the RFATAL message.)
  tell(`You have a theory on how to board a ${dobj.desc}, perhaps?`);
  fatal();
  return true;
};

// ---------------------------------------------------------------------------
// PRE-BURN (gverbs.zil:243)
//
// Guards:
//   1. No PRSI         → "You didn't say with what!"  (RTRUE — blocks)
//   2. PRSI is FLAMING → RFALSE (allows V-BURN)
//   3. else            → "With a <X>??!?"             (RTRUE — blocks)
// ---------------------------------------------------------------------------

export const preBurnHandler: ActionHandler = (ctx: ActionContext): boolean => {
  const { iobj, tell } = ctx;
  if (iobj === undefined) {
    tell("You didn't say with what!");
    return true;
  }
  if (isFlaming(iobj)) {
    return false; // RFALSE — allow V-BURN
  }
  tell(`With a ${iobj.desc}??!?`);
  return true;
};

// ---------------------------------------------------------------------------
// PRE-DROP (gverbs.zil:474)
//
// Guard: PRSO == LOC(WINNER) (the vehicle the player is in).
// If so: perform V-DISEMBARK and RTRUE.
// Otherwise: RFALSE (normal V-DROP).
//
// Note: V-DISEMBARK is a deferred TD-4/D-wave body.  For Wave B we emit the
// "not applicable" path only (the vehicle-disembark scenario is rare; the
// no-op still occupies step 3's position for the common drop case).
// ---------------------------------------------------------------------------

export const preDropHandler: ActionHandler = (ctx: ActionContext): boolean => {
  const { dobj, actor } = ctx;
  if (dobj === undefined) return false;
  // "PRSO == LOC(WINNER)": dobj is the immediate parent of the player
  if (actor.parent === dobj) {
    // Deferred: V-DISEMBARK body belongs to Wave D (verbGo rewrite).
    // For Wave B, the handler fires (RTRUE) so the slot is live; the
    // disembark action body will be wired when verbGo is extended.
    return true;
  }
  return false; // normal drop
};

// ---------------------------------------------------------------------------
// PRE-FILL (gverbs.zil:646)
//
// Guards (in order):
//   No PRSI:
//     - GLOBAL-WATER in room's global list → perform V-FILL(PRSO, GLOBAL-WATER), RTRUE
//     - WATER in LOC(WINNER) → perform V-FILL(PRSO, WATER), RTRUE
//     - else → "There is nothing to fill it with." RTRUE
//   PRSI == WATER → RFALSE (allow V-FILL)
//   PRSI == GLOBAL-WATER → RFALSE (allow V-FILL)
//   else (non-water PRSI) → perform V-PUT(PRSI, PRSO), RTRUE
//
// Note: V-FILL and the GLOBAL-WATER/WATER objects are not yet fully modeled
// for Wave B.  We implement the "no instrument nearby" block message and the
// RFALSE pass-through so tests are meaningful.
// ---------------------------------------------------------------------------

export const preFillHandler: ActionHandler = (ctx: ActionContext): boolean => {
  const { dobj, iobj, world, here, tell } = ctx;
  if (dobj === undefined) return false;

  if (iobj === undefined) {
    // Look for WATER object in room or player's parent (LOC(WINNER))
    const water = world.get('WATER');
    const globalWater = world.get('GLOBAL-WATER');

    // Check GLOBAL-WATER in room's global list (simplified: check room prop)
    const roomGlobalId = here.props.get('GLOBAL');
    const hasGlobalWater = globalWater !== undefined &&
      (roomGlobalId === 'GLOBAL-WATER' || (water !== undefined && water.parent === here));

    if (hasGlobalWater || (water !== undefined && water.parent === here)) {
      // Deferred: V-FILL body not yet implemented; just RTRUE to hold the slot.
      return true;
    }
    tell('There is nothing to fill it with.');
    return true;
  }

  // PRSI is WATER or GLOBAL-WATER → allow V-FILL
  const water = world.get('WATER');
  const globalWater = world.get('GLOBAL-WATER');
  if (iobj === water || iobj === globalWater) {
    return false;
  }

  // Non-water PRSI → perform V-PUT (deferred for Wave D); hold slot with RTRUE.
  return true;
};

// ---------------------------------------------------------------------------
// PRE-GIVE (gverbs.zil:707)
//
// Guard: NOT HELD?(PRSO) → "That's easy for you to say since you don't
//        even have the <X>."  (RTRUE — blocks V-GIVE)
// Otherwise: RFALSE (player has it; allow V-GIVE to proceed).
// ---------------------------------------------------------------------------

export const preGiveHandler: ActionHandler = (ctx: ActionContext): boolean => {
  const { dobj, actor, tell } = ctx;
  if (dobj === undefined) return false;
  if (!heldByPlayer(dobj, actor)) {
    tell(
      `That's easy for you to say since you don't even have the ${dobj.desc}.`,
    );
    return true;
  }
  return false;
};

// ---------------------------------------------------------------------------
// PRE-MOVE (gverbs.zil:910)
//
// Guard: HELD?(PRSO) → "You aren't an accomplished enough juggler." (RTRUE)
// Otherwise: RFALSE (allow V-MOVE).
// ---------------------------------------------------------------------------

export const preMoveHandler: ActionHandler = (ctx: ActionContext): boolean => {
  const { dobj, actor, tell } = ctx;
  if (dobj === undefined) return false;
  if (heldByPlayer(dobj, actor)) {
    tell("You aren't an accomplished enough juggler.");
    return true;
  }
  return false;
};

// ---------------------------------------------------------------------------
// PRE-MUNG (gverbs.zil:923)
//
// Zork 1 compile-time conditional:
//   %<COND (<==? ,ZORK-NUMBER 3> ...) (T '(<NULL-F> <RTRUE>))>
//   In Zork 1: NULL-F always returns false → the first COND clause is false
//   → falls through to guard 2.
//
// Guard (Zork 1): PRSI missing OR not WEAPONBIT:
//   TELL "Trying to destroy the " D PRSO " with "
//   COND (<NOT PRSI> "your bare hands") (T "a " D PRSI)
//   TELL " is futile."
//   RTRUE (blocks V-MUNG)
//
// Allow (RFALSE): PRSI present AND PRSI has WEAPONBIT.
// ---------------------------------------------------------------------------

export const preMungHandler: ActionHandler = (ctx: ActionContext): boolean => {
  const { dobj, iobj, tell } = ctx;
  if (dobj === undefined) return false;

  if (iobj === undefined || !iobj.has(Flag.Weapon)) {
    // Build the verbatim ZIL message across three TELL calls (concatenated):
    const instrument = iobj === undefined ? 'your bare hands' : `a ${iobj.desc}`;
    tell(`Trying to destroy the ${dobj.desc} with ${instrument} is futile.`);
    return true;
  }
  return false; // PRSI present and is a weapon → allow V-MUNG
};

// ---------------------------------------------------------------------------
// PRE-PUT (gverbs.zil:1075)
//
// Zork 1 compile-time conditional (the ZORK-NUMBER 3 SHORT-POLE branch compiles
// away in Zork 1):
//   In Zork 1: NULL-F returns false → first COND clause false
//   → delegates to PRE-GIVE body.
//
// "That's easy for you to say since you don't even have the <X>."
// ---------------------------------------------------------------------------

export const prePutHandler: ActionHandler = (ctx: ActionContext): boolean => {
  // Zork 1: PRE-PUT is simply PRE-GIVE (gverbs.zil:1083: "<PRE-GIVE>").
  return preGiveHandler(ctx);
};

// ---------------------------------------------------------------------------
// PRE-READ (gverbs.zil:1137)
//
// Guards:
//   1. NOT LIT → "It is impossible to read in the dark." RTRUE
//   2. PRSI given AND NOT TRANSBIT(PRSI) → "How does one look through a <X>?" RTRUE
// Otherwise: RFALSE (allow V-READ).
//
// LIT: the current room has Flag.Light (or a light source in scope).
// Simplified: check Flag.Light on the room (matches the engine's current approach).
// ---------------------------------------------------------------------------

export const preReadHandler: ActionHandler = (ctx: ActionContext): boolean => {
  const { iobj, here, tell } = ctx;

  // Guard 1: dark room
  if (!here.has(Flag.Light)) {
    tell('It is impossible to read in the dark.');
    return true;
  }

  // Guard 2: PRSI given and not TRANSPARENT
  if (iobj !== undefined && !iobj.has(Flag.Transparent)) {
    tell(`How does one look through a ${iobj.desc}?`);
    return true;
  }

  return false; // RFALSE — allow V-READ
};

// ---------------------------------------------------------------------------
// PRE-SGIVE (gverbs.zil:1206)
//
// Always: perform V-GIVE with PRSI and PRSO swapped, then RTRUE.
//
// PRE-SGIVE is the handler for the "SGIVE" verb form where the syntax has the
// objects reversed (e.g. "give troll food" vs "give food to troll").  It
// re-dispatches as a standard GIVE with the objects in the correct order and
// blocks V-SGIVE (which just prints "Foo!").
//
// Wave B: nested PERFORM dispatch is complex (requires a re-entrant PERFORM
// call with swapped objects).  We hold the slot and return true (RTRUE) so the
// structure is correct; the nested V-GIVE call is a Wave D refinement.
// The key behavioral property — blocking V-SGIVE — is satisfied.
// ---------------------------------------------------------------------------

export const preSgiveHandler: ActionHandler = (_ctx: ActionContext): boolean => {
  // Deferred: the nested <PERFORM V?GIVE PRSI PRSO> body lands in Wave D
  // (re-entrant PERFORM with swapped objects).  For Wave B, RTRUE suppresses
  // V-SGIVE ("Foo!") and holds the slot.
  return true;
};

// ---------------------------------------------------------------------------
// PRE-TAKE (gverbs.zil:1353)
//
// Guards (in order):
//   1. PRSO IN? WINNER AND WEARBIT   → "You are already wearing it."  RTRUE
//   2. PRSO IN? WINNER               → "You already have that!"       RTRUE
//   3. LOC(PRSO) CONTBIT + not OPENBIT → "You can't reach something
//        that's inside a closed container."                            RTRUE
//   4. PRSI given AND PRSO not in PRSI → "The <X> isn't in the <Y>." RTRUE
//      (unless PRSI == GROUND → clear PRSI, RFALSE)
//   5. PRSO == LOC(WINNER)           → "You're inside of it!"         RTRUE
// Otherwise: RFALSE (allow V-TAKE / ITAKE).
// ---------------------------------------------------------------------------

export const preTakeHandler: ActionHandler = (ctx: ActionContext): boolean => {
  const { dobj, iobj, actor, tell } = ctx;
  if (dobj === undefined) return false;

  // Guard 1 & 2: PRSO IN? WINNER (direct child of player)
  if (dobj.parent === actor) {
    if (dobj.has(Flag.Wearable)) {
      // Guard 1: already wearing it
      tell('You are already wearing it.');
      return true;
    }
    // Guard 2: already have it
    tell('You already have that!');
    return true;
  }

  // Guard 3: LOC(PRSO) is a closed container (CONTBIT + not OPENBIT)
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

  // Guard 4: PRSI given and PRSO not in PRSI
  if (iobj !== undefined) {
    if (dobj.parent === iobj) {
      // PRSO IS in PRSI — clear PRSI and allow (SETG PRSI <> RFALSE)
      return false;
    }
    // "The <X> isn't in the <Y>."
    tell(`The ${dobj.desc} isn't in the ${iobj.desc}.`);
    return true;
  }

  // Guard 5: PRSO == LOC(WINNER) (player is inside PRSO)
  if (actor.parent === dobj) {
    tell("You're inside of it!");
    return true;
  }

  return false; // RFALSE — allow V-TAKE / ITAKE
};

// ---------------------------------------------------------------------------
// PRE-TURN (gverbs.zil:1488)
//
// Zork 1 compile-time: the ZORK-NUMBER 3 check compiles away; Zork 1 guard is:
//
//   Guard 1 (Zork 1): no PRSI AND PRSO != BOOK:
//     → "Your bare hands don't appear to be enough." RTRUE
//
//   Guard 2: PRSO not TURNBIT:
//     → "You can't turn that!" RTRUE
//
//   Otherwise: RFALSE (allow V-TURN).
//
// BOOK: the ZIL BOOK object is the "black book" in the dungeon (id 'BOOK').
// In port-native terms, we identify it by object id 'BOOK' from world data.
// ---------------------------------------------------------------------------

export const preTurnHandler: ActionHandler = (ctx: ActionContext): boolean => {
  const { dobj, iobj, world, tell } = ctx;
  if (dobj === undefined) return false;

  // Guard 1 (Zork 1): no PRSI AND PRSO is not the BOOK object
  if (iobj === undefined) {
    const bookObj = world.get('BOOK');
    if (dobj !== bookObj) {
      tell("Your bare hands don't appear to be enough.");
      return true;
    }
  }

  // Guard 2: PRSO not TURNBIT
  if (!dobj.has(Flag.Turnable)) {
    tell("You can't turn that!");
    return true;
  }

  return false; // allow V-TURN
};
