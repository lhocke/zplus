/**
 * Boat subsystem action routines — Phase 3b CB-BOAT2.
 *
 * CB-BOAT2 scope: IBOAT-FUNCTION (inflate), RBOAT-FUNCTION DEFLATE branch,
 * DBOAT-FUNCTION (punctured-boat repair).  The board/launch/puncture/I-RIVER
 * behavior lives in CB-BOAT3.
 *
 * ZIL source refs:
 *   IBOAT-FUNCTION   1actions.zil:2820–2840
 *   RBOAT-FUNCTION   1actions.zil:2722–2815 (DEFLATE branch :2803–2815)
 *   DBOAT-FUNCTION   1actions.zil:2652–2662
 *   FIX-BOAT         1actions.zil:2664–2667
 *   BREATHE          1actions.zil:2817–2818
 */

import type { ActionHandler } from '../domain/game-object.js';
import { Flag } from '../domain/flags.js';

// ---------------------------------------------------------------------------
// FIX-BOAT — 1actions.zil:2664
//
// Shared repair path for both DBOAT-FUNCTION (putty repair) and any future
// putty-via-CONTFCN path.  Swaps PUNCTURED-BOAT → INFLATABLE-BOAT in place.
// ---------------------------------------------------------------------------

function fixBoat(ctx: Parameters<ActionHandler>[0]): void {
  ctx.tell('Well done. The boat is repaired.');
  const punctured  = ctx.world.get('PUNCTURED-BOAT');
  const inflatable = ctx.world.get('INFLATABLE-BOAT');
  if (punctured === undefined || inflatable === undefined) return;
  // Move INFLATABLE-BOAT to wherever the PUNCTURED-BOAT is, then remove the punctured one.
  // :2666 <MOVE ,INFLATABLE-BOAT <LOC ,PUNCTURED-BOAT>>
  const loc = punctured.parent;
  inflatable.moveTo(loc);
  // :2667 <REMOVE-CAREFULLY ,PUNCTURED-BOAT>
  punctured.moveTo(null);
}

// ---------------------------------------------------------------------------
// IBOAT-FUNCTION — 1actions.zil:2820
//
// INFLATE/FILL on the deflated pile of plastic.
//   pump  → inflate (seaworthy message + label hint if unseen + swap)
//   lungs → "not enough lung power" (NM-F)
//   other → "With a <iobj>? Surely you jest!" (NM-F)
//   boat not in room → "must be on the ground"
//
// Canonical verb token: 'inflat' (6-char ZIL truncation in syntax.json; 'inflate'
// maps to 'inflat' via verbSynonyms).  ZIL VERB? INFLATE FILL covers both.
// ---------------------------------------------------------------------------

export const iboatFcn: ActionHandler = (ctx) => {
  if (ctx.verb !== 'inflat' && ctx.verb !== 'fill') return false;

  const inflatable = ctx.world.get('INFLATABLE-BOAT');
  if (inflatable === undefined) return false;

  // :2822 — boat must be in current room
  if (inflatable.parent !== ctx.here) {
    ctx.tell('The boat must be on the ground to be inflated.');
    return true;
  }

  const pump = ctx.world.get('PUMP');

  if (ctx.iobj === pump && pump !== undefined) {
    // :2827 — pump inflates; inflated boat object must exist in world
    const inflated = ctx.world.get('INFLATED-BOAT');
    if (inflated === undefined) return false;

    ctx.tell('The boat inflates and appears seaworthy.');

    // :2828 — label hint if BOAT-LABEL has not yet been seen (TOUCHBIT clear)
    const label = ctx.world.get('BOAT-LABEL');
    if (label !== undefined && !ctx.hasFlag(label, Flag.Touched)) {
      ctx.tell('A tan label is lying inside the boat.');
    }

    // :2831 — DEFLATE = false (boat freshly inflated, not deflatable-flagged)
    ctx.setGlobal?.('DEFLATE', false);

    // :2832–2834 — swap: remove inflatable, place inflated in room; re-point "it"
    inflatable.moveTo(null);
    inflated.moveTo(ctx.here);
    ctx.thisIsIt?.(inflated);
    return true;
  }

  // :2835 — lungs branch (BREATHE routes here with PRSI=LUNGS)
  if (ctx.iobj !== undefined && ctx.iobj.id === 'LUNGS') {
    ctx.tell("You don't have enough lung power to inflate it.");
    return true;
  }

  // :2838 — anything else
  const prsiDesc = ctx.iobj?.desc ?? 'that';
  ctx.tell(`With a ${prsiDesc}? Surely you jest!`);
  return true;
};

// ---------------------------------------------------------------------------
// RBOAT-FUNCTION — DEFLATE branch — 1actions.zil:2803
//
// Called when DEFLATE verb targets the inflated boat.
// Three guards (in ZIL order):
//   1. winner is IN the boat → "can't deflate while you're in it"
//   2. inflated boat is not directly in HERE → "must be on the ground"
//   3. else → deflate: set DEFLATE=true, swap inflated→inflatable
// ---------------------------------------------------------------------------

export const rboatDeflate: ActionHandler = (ctx) => {
  if (ctx.verb !== 'deflate') return false;

  const inflated   = ctx.world.get('INFLATED-BOAT');
  const inflatable = ctx.world.get('INFLATABLE-BOAT');
  if (inflated === undefined || inflatable === undefined) return false;

  // :2804 — player is inside the boat
  if (ctx.actor.parent === inflated) {
    ctx.tell("You can't deflate the boat while you're in it.");
    return true;
  }

  // :2807 — boat not directly in the current room
  if (inflated.parent !== ctx.here) {
    ctx.tell('The boat must be on the ground to be deflated.');
    return true;
  }

  // :2810 — deflate; re-point "it" to the pile of plastic now in room
  ctx.tell('The boat deflates.');
  ctx.setGlobal?.('DEFLATE', true);
  inflated.moveTo(null);
  inflatable.moveTo(ctx.here);
  ctx.thisIsIt?.(inflatable);
  return true;
};

// ---------------------------------------------------------------------------
// RBOAT-FUNCTION — INFLATE/FILL fall-through on the inflated boat — 1actions.zil:2801
//
// The inflated boat can't be inflated further.
// ---------------------------------------------------------------------------

const rboatInflate: ActionHandler = (ctx) => {
  if (ctx.verb !== 'inflat' && ctx.verb !== 'fill') return false;
  ctx.tell('Inflating it further would probably burst it.');
  return true;
};

// ---------------------------------------------------------------------------
// RBOAT-FUNCTION — combined handler for the inflated boat object
//
// CB-BOAT3 will extend this with M-BEG (BOARD/LAUNCH/puncture) and M-ENTER/M-END/M-LOOK.
// CB-BOAT2 wires the verb-only branches (INFLATE and DEFLATE) that live outside M-BEG.
// ---------------------------------------------------------------------------

export const rboatFcn: ActionHandler = (ctx) => {
  // M-ENTER / M-END / M-LOOK — no-op (CB-BOAT3 or future extension adds real behavior)
  // :2723 <COND (<EQUAL? .RARG ,M-ENTER ,M-END ,M-LOOK> <>)
  if (ctx.rarg !== undefined) return false;

  // Object-level verb dispatch (no RARG = normal action dispatch)
  if (rboatInflate(ctx)) return true;
  if (rboatDeflate(ctx)) return true;

  return false;
};

// ---------------------------------------------------------------------------
// DBOAT-FUNCTION — 1actions.zil:2652
//
// On the punctured boat:
//   PUT PUTTY [ON DBOAT] / PUT-ON PUTTY → FIX-BOAT
//   INFLATE/FILL → "No chance. Some moron punctured it."
//   PLUG with PUTTY → FIX-BOAT
//   PLUG with other → "With a <prsi>?"
// ---------------------------------------------------------------------------

export const dboatFcn: ActionHandler = (ctx) => {
  const putty = ctx.world.get('PUTTY');

  // :2653–2655 — PUT PUTTY or PUT-ON PUTTY (putty is the dobj)
  if ((ctx.verb === 'put' || ctx.verb === 'put-on') && ctx.dobj === putty) {
    fixBoat(ctx);
    return true;
  }

  // :2656–2658 — INFLATE/FILL (canonical verb token is 'inflat')
  if (ctx.verb === 'inflat' || ctx.verb === 'fill') {
    ctx.tell('No chance. Some moron punctured it.');
    return true;
  }

  // :2659–2662 — PLUG
  if (ctx.verb === 'plug') {
    if (ctx.iobj === putty && putty !== undefined) {
      fixBoat(ctx);
      return true;
    }
    // WITH-TELL: "With a <prsi>?"
    const prsiDesc = ctx.iobj?.desc ?? 'that';
    ctx.tell(`With a ${prsiDesc}?`);
    return true;
  }

  return false;
};

export const boatActions: Record<string, ActionHandler> = {
  'IBOAT-FUNCTION': iboatFcn,
  'RBOAT-FUNCTION': rboatFcn,
  'DBOAT-FUNCTION': dboatFcn,
};
