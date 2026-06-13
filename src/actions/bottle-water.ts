/**
 * Bottle/water action routines — CC7.
 *
 * Hand-translations of ZIL routines from zil/1actions.zil:1491–1507 and :157–237,
 * plus V-POUR-ON from gverbs.zil:1024–1044.
 *
 *   BOTTLE-FUNCTION  1actions.zil:1491  — THROW/MUNG/SHAKE the bottle
 *   WATER-F          1actions.zil:157   — DRINK gate check (bottle-open guard)
 *   V-POUR-ON        gverbs.zil:1024    — pour water onto FLAMING? / non-lit object
 *
 * FLAMING? (gmacros.zil:145): obj has FLAMEBIT (Flag.OnFire) AND ONBIT (Flag.Light).
 * V-POUR-ON fires when dobj=WATER and iobj=target (syntax.json: "POUR" prep2="ON").
 */

import type { ActionContext, ActionHandler } from '../domain/game-object.js';
import { Flag } from '../domain/flags.js';

// FLAMING? — gmacros.zil:145: FSET? FLAMEBIT AND FSET? ONBIT.
// Flag.OnFire = FLAMEBIT, Flag.Light = ONBIT (see find-bits.ts).
function isFlaming(obj: { has(f: Flag): boolean }): boolean {
  return obj.has(Flag.OnFire) && obj.has(Flag.Light);
}

// ---------------------------------------------------------------------------
// BOTTLE-FUNCTION — 1actions.zil:1491–1507
//
// Object FCN on the BOTTLE. Handles three verbs; on each the bottle or its
// water is destroyed.
// ---------------------------------------------------------------------------

export const bottleFunction: ActionHandler = (ctx) => {
  const bottle = ctx.self;
  const water  = ctx.world.get('WATER');

  let destroyed = false;

  // THROW bottle (prso == bottle) — :1492–1496
  if (ctx.action === 'V-THROW' && ctx.dobj === bottle) {
    bottle.moveTo(null);
    destroyed = true;
    ctx.tell('The bottle hits the far wall and shatters.');
  }

  // MUNG (break/smash/destroy) — :1496–1499
  if (!destroyed && ctx.action === 'V-MUNG') {
    destroyed = true;
    bottle.moveTo(null);
    ctx.tell('A brilliant maneuver destroys the bottle.');
  }

  // SHAKE open bottle with water — :1500–1502
  if (!destroyed && ctx.action === 'V-SHAKE') {
    if (bottle.has(Flag.Open) && water !== undefined && water.parent === bottle) {
      destroyed = true;
    }
  }

  // Spill water if it's still in the bottle (parent ref survives bottle.moveTo(null)) — :1503–1507
  if (destroyed) {
    if (water !== undefined && water.parent === bottle) {
      ctx.tell('The water spills to the floor and evaporates.');
      water.moveTo(null);
    }
    return true;
  }

  return false;
};

// ---------------------------------------------------------------------------
// WATER-F — 1actions.zil:157–237 (drink-gate portion)
//
// Full WATER-F handles TAKE/PUT/DROP/GIVE/THROW/FILL for the portable water
// object.  Phase 3 CC7 ports the drink-gate (V-DRINK / V-EAT) path because
// that is the only player-reachable mechanic that the parser routes through
// the object FCN: "drink water" fires V-DRINK with PRSO=WATER, so WATER's
// handler intercepts before the action table.
//
// The ZIL drink path lives in V-EAT (gverbs.zil:483–524); WATER-F itself
// returns false for DRINK (none of its final COND clauses match DRINK).  We
// implement the gate here in the object handler so the test suite can exercise
// the closed-bottle guard without wiring a separate V-DRINK action entry.
//
// Faithfulness: ZIL's V-EAT bottle-open gate — gverbs.zil:509–513:
//   (<NOT <FSET? .NOBJ ,OPENBIT>>
//    <TELL "You'll have to open the " D .NOBJ " first." CR>)
//   (T <HIT-SPOT>)
//
// HIT-SPOT — gverbs.zil:518–524:
//   <REMOVE-CAREFULLY ,PRSO>   ; if not global water
//   <TELL "Thank you very much. I was rather thirsty (from all this talking,
//   probably)." CR>
// ---------------------------------------------------------------------------

export const waterFunction: ActionHandler = (ctx) => {
  // V-DROP / "pour water" (no target) — 1actions.zil:219–233.
  // gsyntax.zil:360: POUR OBJECT = V-DROP PRE-DROP; WATER-F intercepts.
  if (ctx.action === 'V-DROP') {
    const water  = ctx.self;
    const bottle = ctx.world.get('BOTTLE');
    // Closed-bottle gate: if water is inside a closed bottle, refuse.
    if (bottle !== undefined && water.parent === bottle && !bottle.has(Flag.Open)) {
      ctx.tell('The bottle is closed.');
      return true;
    }
    // AV (vehicle): player's immediate parent if it has VEHBIT (Flag.Vehicle).
    const av = ctx.actor.parent?.has(Flag.Vehicle) ? ctx.actor.parent : null;
    water.moveTo(null);
    if (av !== null) {
      ctx.tell(`There is now a puddle in the bottom of the ${av.desc}.`);
      water.moveTo(av);
    } else {
      ctx.tell('The water spills to the floor and evaporates immediately.');
    }
    return true;
  }

  if (ctx.action !== 'V-DRINK' && ctx.action !== 'V-EAT') return false;

  const water  = ctx.dobj;
  if (water === undefined) return false;

  // The water's container (bottle, if any) — gverbs.zil:496 SET NOBJ <LOC ,PRSO>
  const container = water.parent;

  // Global-water or no container → drink freely (HIT-SPOT without container check).
  // gverbs.zil:497–500: <IN? ,PRSO ,GLOBAL-OBJECTS> or GLOBAL-IN? ...
  if (container === null || water.id === 'GLOBAL-WATER') {
    hitSpot(ctx, water);
    return true;
  }

  // Container must be held — gverbs.zil:505–508.
  const player = ctx.actor;
  let containerHeld = false;
  let cur: typeof container | null = container;
  while (cur !== null) {
    if (cur === player) { containerHeld = true; break; }
    cur = cur.parent;
  }
  if (!containerHeld) {
    ctx.tell(`You have to be holding the ${container.desc} first.`);
    return true;
  }

  // Container must be open — gverbs.zil:509–511.
  if (!container.has(Flag.Open)) {
    ctx.tell(`You'll have to open the ${container.desc} first.`);
    return true;
  }

  // All checks pass — HIT-SPOT.
  hitSpot(ctx, water);
  return true;
};

// HIT-SPOT — gverbs.zil:518–524.
function hitSpot(ctx: ActionContext, water: { id: string; moveTo(d: null): void }): void {
  // Remove portable water (not global-water pseudo).
  if (water.id !== 'GLOBAL-WATER') {
    water.moveTo(null);
  }
  ctx.tell(
    'Thank you very much. I was rather thirsty (from all this talking,\nprobably).',
  );
}

// ---------------------------------------------------------------------------
// V-POUR-ON — gverbs.zil:1024–1044
//
// Action handler registered in ACTION_HANDLERS['V-POUR-ON'].
// Fires when the player types "pour <dobj> on <iobj>".
// CC7 scope: PRSO == WATER (the water object or global water).
//
// ZIL:
//   (<EQUAL? ,PRSO ,WATER>
//     <REMOVE-CAREFULLY ,PRSO>
//     <COND (<FLAMING? ,PRSI>
//            "The " D ,PRSI " is extinguished." CR
//            <FCLEAR ,PRSI ,ONBIT>
//            <FCLEAR ,PRSI ,FLAMEBIT>)
//           (T "The water spills over the " D ,PRSI ", to the floor, and evaporates." CR)>)
//   (T "You can't pour that." CR)
// ---------------------------------------------------------------------------

export const verbPourOn: ActionHandler = (ctx) => {
  const dobj = ctx.dobj;
  const iobj = ctx.iobj;

  // Not water — "You can't pour that." — gverbs.zil:1043–1044.
  if (dobj === undefined || (dobj.id !== 'WATER' && dobj.id !== 'GLOBAL-WATER')) {
    ctx.tell("You can't pour that.");
    return true;
  }

  // Consume the water — gverbs.zil:1026.
  if (dobj.id !== 'GLOBAL-WATER') dobj.moveTo(null);

  if (iobj !== undefined && isFlaming(iobj)) {
    // FLAMING? target — extinguish — gverbs.zil:1027–1034.
    ctx.tell(`The ${iobj.desc} is extinguished.`);
    ctx.clearFlag(iobj, Flag.OnFire);
    ctx.clearFlag(iobj, Flag.Light);
    // Disable the candle timer if it's the candles — I-CANDLES tracks burn time.
    if (iobj.id === 'CANDLES') ctx.disableClock('I-CANDLES');
  } else {
    // Non-flaming target — evaporates — gverbs.zil:1035–1037.
    const target = iobj !== undefined ? `the ${iobj.desc}` : 'the floor';
    ctx.tell(`The water spills over ${target}, to the floor, and evaporates.`);
  }

  return true;
};

/** ACTION routines for the bottle/water region. */
export const bottleWaterActions: Record<string, ActionHandler> = {
  'BOTTLE-FUNCTION': bottleFunction,
  'WATER-F':         waterFunction,
};
