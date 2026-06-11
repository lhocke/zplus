/**
 * Boat subsystem action routines — Phase 3b CB-BOAT2 + CB-BOAT3.
 *
 * CB-BOAT2 scope: IBOAT-FUNCTION (inflate), RBOAT-FUNCTION DEFLATE branch,
 * DBOAT-FUNCTION (punctured-boat repair).
 * CB-BOAT3 scope: RBOAT-FUNCTION M-BEG (BOARD/LAUNCH/puncture/walk restriction).
 *
 * ZIL source refs:
 *   IBOAT-FUNCTION   1actions.zil:2820–2840
 *   RBOAT-FUNCTION   1actions.zil:2722–2815
 *   DBOAT-FUNCTION   1actions.zil:2652–2662
 *   FIX-BOAT         1actions.zil:2664–2667
 *   BREATHE          1actions.zil:2817–2818
 *   RIVER-LAUNCH     1actions.zil:2698–2706
 *   RIVER-SPEEDS     1actions.zil:2692–2693
 */

import type { ActionHandler } from '../domain/game-object.js';
import { Flag } from '../domain/flags.js';
import { M_BEG } from '../engine/messages.js';

// ---------------------------------------------------------------------------
// RIVER-LAUNCH — 1actions.zil:2698–2706
// Maps launch-site room ids to the RIVER-* destination they produce.
// ---------------------------------------------------------------------------

const RIVER_LAUNCH: Readonly<Record<string, string>> = {
  'DAM-BASE':          'RIVER-1',
  'WHITE-CLIFFS-NORTH':'RIVER-3',
  'WHITE-CLIFFS-SOUTH':'RIVER-4',
  'SHORE':             'RIVER-5',
  'SANDY-BEACH':       'RIVER-4',
  'RESERVOIR-SOUTH':   'RESERVOIR',
  'RESERVOIR-NORTH':   'RESERVOIR',
  'STREAM-VIEW':       'IN-STREAM',
};

// RIVER-SPEEDS — 1actions.zil:2692–2693
// Per-section drift period (turns until I-RIVER fires after re-arm).
const RIVER_SPEEDS: Readonly<Record<string, number>> = {
  'RIVER-1': 4,
  'RIVER-2': 4,
  'RIVER-3': 3,
  'RIVER-4': 2,
  'RIVER-5': 1,
};

// Sharp objects that puncture the boat on BOARD — 1actions.zil:2788–2793.
// Checked by EXPLICIT OBJECT IDENTITY (not WEAPONBIT).
const SHARP_OBJECT_IDS: ReadonlySet<string> = new Set([
  'SCEPTRE', 'KNIFE', 'SWORD', 'RUSTY-KNIFE', 'AXE', 'STILETTO',
]);

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
// punctureBoat — shared helper: swap inflated→punctured, ROB contents, eject
// player. Returns 'water' if HERE is NonLand (caller may then JIGS-UP).
// 1actions.zil:2763–2783
// ---------------------------------------------------------------------------

function punctureBoat(ctx: Parameters<ActionHandler>[0]): boolean {
  const inflated   = ctx.world.get('INFLATED-BOAT');
  const punctured  = ctx.world.get('PUNCTURED-BOAT');
  if (inflated === undefined || punctured === undefined) return false;

  // :2763 <REMOVE-CAREFULLY ,INFLATED-BOAT>
  inflated.moveTo(null);
  // :2764 <MOVE ,PUNCTURED-BOAT ,HERE>
  punctured.moveTo(ctx.here);
  // :2765 ROB: move all children of INFLATED-BOAT to HERE
  for (const child of [...inflated.children]) {
    child.moveTo(ctx.here);
  }
  // :2766 <MOVE ,WINNER ,HERE> — eject the player
  ctx.actor.moveTo(ctx.here);
  return ctx.here.has(Flag.NonLand);
}

// ---------------------------------------------------------------------------
// RBOAT-FUNCTION — combined handler for the inflated boat object (CB-BOAT2 + CB-BOAT3)
//
// 1actions.zil:2722–2815
// ---------------------------------------------------------------------------

export const rboatFcn: ActionHandler = (ctx) => {
  // :2723 — M-ENTER / M-END / M-LOOK — no-op
  if (ctx.rarg === M_BEG) {
    // M-BEG dispatch (LOC(WINNER).P?ACTION called with M-BEG)
    return rboatMBeg(ctx);
  }

  if (ctx.rarg !== undefined) return false;  // M-ENTER / M-END / M-LOOK

  // Object-level verb dispatch (no RARG = normal action dispatch)

  // :2787 — BOARD: sharp-object puncture check (NM-G)
  if (ctx.verb === 'board') {
    for (const id of SHARP_OBJECT_IDS) {
      const obj = ctx.world.get(id);
      if (obj !== undefined && obj.parent === ctx.actor) {
        // :2794–2799 — puncture message + swap
        ctx.tell(
          'Oops! Something sharp seems to have slipped and punctured the boat.\n' +
          'The boat deflates to the sounds of hissing, sputtering, and cursing.',
        );
        const inflated  = ctx.world.get('INFLATED-BOAT');
        const punctured = ctx.world.get('PUNCTURED-BOAT');
        if (inflated !== undefined) inflated.moveTo(null);
        if (punctured !== undefined) {
          punctured.moveTo(ctx.here);
          ctx.thisIsIt?.(punctured);
        }
        return true;  // :2800 T — board fails; PRE-BOARD's normal board path aborted
      }
    }
    // No sharp object — fall through to PRE-BOARD's normal vehicle-enter
    return false;
  }

  // :2785 — LAUNCH when player is NOT inside the boat (outer cond fallback)
  // The M-BEG LAUNCH branch only fires when LOC(WINNER)==INFLATED-BOAT.
  // This branch fires when LAUNCH targets INFLATED-BOAT directly (verb dispatch).
  if (ctx.verb === 'launch') {
    ctx.tell("You're not in the boat!");
    return true;
  }

  // :2801 — INFLATE/FILL fall-through
  if (rboatInflate(ctx)) return true;

  // :2803 — DEFLATE
  if (rboatDeflate(ctx)) return true;

  return false;
};

// ---------------------------------------------------------------------------
// rboatMBeg — M-BEG dispatch for RBOAT-FUNCTION (1actions.zil:2724–2786)
// Called when the player is inside the boat (LOC(WINNER) = INFLATED-BOAT).
// ---------------------------------------------------------------------------

function rboatMBeg(ctx: Parameters<ActionHandler>[0]): boolean {
  // :2725 — WALK (movement)
  if (ctx.verb === 'walk') {
    const dir = ctx.prep;
    // :2726 — LAND/EAST/WEST passes through (RFALSE → normal GOTO)
    if (dir === 'land' || dir === 'east' || dir === 'west') return false;
    // :2728 — N/S in RESERVOIR also passes through
    if (ctx.here.id === 'RESERVOIR' && (dir === 'north' || dir === 'south')) return false;
    // :2731 — S in IN-STREAM passes through
    if (ctx.here.id === 'IN-STREAM' && dir === 'south') return false;
    // :2735 — all other directions blocked
    ctx.tell("Read the label for the boat's instructions.");
    return true;
  }

  // :2738 — LAUNCH while inside the boat
  if (ctx.verb === 'launch') {
    const hereId = ctx.here.id;

    // :2739–2740 — already on river/reservoir/stream → blocked.
    // ZIL checks: RIVER-1, RIVER-2, RIVER-3, RIVER-4, RESERVOIR, IN-STREAM.
    // RIVER-5 is intentionally absent — at RIVER-5 launch falls through to
    // GO-NEXT(RIVER-LAUNCH), which has no RIVER-5 key → "can't launch it here."
    const onWater =
      hereId === 'RIVER-1' || hereId === 'RIVER-2' || hereId === 'RIVER-3' ||
      hereId === 'RIVER-4' || hereId === 'RESERVOIR' || hereId === 'IN-STREAM';

    if (onWater) {
      const where = hereId === 'RESERVOIR' ? 'reservoir'
                  : hereId === 'IN-STREAM'  ? 'stream'
                  : 'river';
      ctx.tell(`You are on the ${where}, or have you forgotten?`);
      return true;
    }

    // :2749 — GO-NEXT(RIVER-LAUNCH)
    const destId = RIVER_LAUNCH[hereId];
    if (destId !== undefined) {
      const dest = ctx.world.get(destId);
      if (dest !== undefined) {
        // Move the boat (the player is inside it; GOTO moves the vehicle)
        const inflated = ctx.world.get('INFLATED-BOAT');
        if (inflated !== undefined) inflated.moveTo(dest);
        // :2750 — arm I-RIVER at RIVER-SPEEDS[HERE] (the destination's speed)
        const speed = RIVER_SPEEDS[destId];
        if (speed !== undefined) {
          ctx.queueClock?.(I_RIVER_ID, speed, true);
        }
        return true;
      }
    }

    // :2752–2753 — not on a valid launch site
    ctx.tell("You can't launch it here.");
    return true;
  }

  // :2756 — DROP/PUT/ATTACK with WEAPONBIT → puncture + maybe drown
  if (
    (ctx.verb === 'drop' && ctx.dobj !== undefined && ctx.dobj.has(Flag.Weapon)) ||
    (ctx.verb === 'put'  && ctx.dobj !== undefined && ctx.dobj.has(Flag.Weapon) &&
     ctx.iobj === ctx.world.get('INFLATED-BOAT')) ||
    ((ctx.verb === 'attack' || ctx.verb === 'mung') &&
     ctx.iobj !== undefined && ctx.iobj.has(Flag.Weapon))
  ) {
    // :2768–2773 — weapon name + deflate message
    const weaponDesc = (ctx.verb === 'drop' || ctx.verb === 'put')
      ? (ctx.dobj?.desc ?? 'weapon')
      : (ctx.iobj?.desc ?? 'weapon');
    ctx.tell(
      `It seems that the ${weaponDesc} didn't agree with the boat, as evidenced\n` +
      'by the loud hissing noise issuing therefrom. With a pathetic sputter, the\n' +
      'boat deflates, leaving you without.',
    );
    const inWater = punctureBoat(ctx);
    if (inWater) {
      // :2774–2783 — on water: drown via JIGS-UP. Reservoir/stream vs river.
      const hereId = ctx.here.id;
      const isFalls = hereId !== 'RESERVOIR' && hereId !== 'IN-STREAM';
      if (isFalls) {
        ctx.jigsUp?.(
          'In other words, fighting the fierce currents of the Frigid River. You\n' +
          'manage to hold your own for a bit, but then you are carried over a\n' +
          'waterfall and into some nasty rocks. Ouch!',
        );
      } else {
        ctx.jigsUp?.('Another pathetic sputter, this time from you, heralds your drowning.');
      }
    }
    return true;
  }

  // :2785 — LAUNCH while NOT inside boat (handled here because M-BEG fires for
  // LOC(WINNER).P?ACTION; this branch is for bare LAUNCH when NOT in the boat).
  // This actually is in the outer verb dispatch (the cond at :2785), not M-BEG.
  // Guard: if verb is launch and we reach here, it means the player is outside.
  // (This path is unreachable in normal M-BEG flow since M-BEG only fires when
  //  the player IS inside the boat. The :2785 branch is the fallback for the
  //  outer RBOAT-FUNCTION cond when rarg is undefined and verb=launch.)

  return false;
}

// ---------------------------------------------------------------------------
// I-RIVER clock entry id — referenced by rboatFcn and game.ts.
// ---------------------------------------------------------------------------
export const I_RIVER_ID = 'I-RIVER';

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
