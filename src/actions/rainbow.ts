/**
 * Rainbow subsystem action routines — Phase 3b CB-RAINBOW.
 *
 * Scope: SCEPTRE-FUNCTION (wave/raise), RAINBOW-FCN (cross/look-under).
 *
 * ZIL source refs:
 *   SCEPTRE-FUNCTION  1actions.zil:2592–2619
 *   RAINBOW-FCN       1actions.zil:2634–2650
 *   RAINBOW-FLAG      1dungeon.zil:1232
 *   ROB               1actions.zil:3976–3989 (implemented inline below)
 */

import type { ActionHandler } from '../domain/game-object.js';
import { Flag } from '../domain/flags.js';

// ---------------------------------------------------------------------------
// robToWall — 1actions.zil:3976 (inline for the rainbow-dismiss case only)
//
// ROB(ON-RAINBOW, WALL): move every non-invisible, non-sacred treasure item
// from ON-RAINBOW into the WALL limbo object.  ZIL's ROB guards:
//   - NOT INVISIBLE
//   - NOT SACREDBIT
//   - GETP(x, P?TVALUE) > 0   (has a treasure value)
//
// The PROB parameter is not passed here (falsy in ZIL → always rob).
// ---------------------------------------------------------------------------

function robToWall(ctx: Parameters<ActionHandler>[0]): void {
  const onRainbow = ctx.world.get('ON-RAINBOW');
  const wall      = ctx.world.get('WALL');
  if (onRainbow === undefined || wall === undefined) return;

  for (const item of [...onRainbow.children]) {
    if (item.has(Flag.Invisible)) continue;
    if (item.has(Flag.Sacred))    continue;
    const tvalue = item.props.get('TVALUE');
    if (typeof tvalue !== 'number' || tvalue <= 0) continue;
    item.moveTo(wall);
  }
}

// ---------------------------------------------------------------------------
// SCEPTRE-FUNCTION — 1actions.zil:2592–2619
//
// Dispatched as the sceptre's ACTION handler.
//
// VERB? WAVE RAISE:
//   HERE in {ARAGAIN-FALLS, END-OF-RAINBOW}:
//     !RAINBOW-FLAG:
//       clear POT-OF-GOLD.INVISIBLE; print rainbow-solid message; RAINBOW-FLAG=true
//       if HERE==END-OF-RAINBOW AND pot-of-gold in END-OF-RAINBOW: print pot-reveal msg
//     RAINBOW-FLAG (already solid → dismiss):
//       ROB ON-RAINBOW WALL; print run-of-the-mill msg; RAINBOW-FLAG=false; RTRUE
//   HERE == ON-RAINBOW:
//     RAINBOW-FLAG=false; JIGS-UP (structural integrity...)
//   else:
//     "A dazzling display of color..."
// ---------------------------------------------------------------------------

export const scepFcn: ActionHandler = (ctx) => {
  if (ctx.verb !== 'wave' && ctx.verb !== 'raise') return false;

  const hereId = ctx.here.id;

  // :2594–2611 — rainbow endpoints
  if (hereId === 'ARAGAIN-FALLS' || hereId === 'END-OF-RAINBOW') {
    const rainbowFlag = ctx.getGlobal?.('RAINBOW-FLAG') ?? false;

    if (!rainbowFlag) {
      // :2597 — reveal the pot
      const pot = ctx.world.get('POT-OF-GOLD');
      if (pot !== undefined) ctx.clearFlag(pot, Flag.Invisible);

      // :2598–2600
      ctx.tell(
        'Suddenly, the rainbow appears to become solid and, I venture,\n' +
        'walkable (I think the giveaway was the stairs and bannister).',
      );

      // :2601–2604 — pot announce only at END-OF-RAINBOW, and only if pot is still there
      if (hereId === 'END-OF-RAINBOW' && pot !== undefined) {
        if (pot.parent?.id === 'END-OF-RAINBOW') {
          ctx.tell('A shimmering pot of gold appears at the end of the rainbow.');
        }
      }

      // :2605
      ctx.setGlobal?.('RAINBOW-FLAG', true);
      return true;
    }

    // :2606–2611 — already solid; dismiss
    // :2607 <ROB ,ON-RAINBOW ,WALL>
    robToWall(ctx);
    // :2608–2609
    ctx.tell('The rainbow seems to have become somewhat run-of-the-mill.');
    // :2610
    ctx.setGlobal?.('RAINBOW-FLAG', false);
    return true;
  }

  // :2612–2616 — on the rainbow itself → fatal
  if (hereId === 'ON-RAINBOW') {
    ctx.setGlobal?.('RAINBOW-FLAG', false);
    ctx.jigsUp?.(
      'The structural integrity of the rainbow is severely compromised,\n' +
      'leaving you hanging in midair, supported only by water vapor. Bye.',
    );
    return true;
  }

  // :2617–2619 — elsewhere
  ctx.tell('A dazzling display of color briefly emanates from the sceptre.');
  return true;
};

// ---------------------------------------------------------------------------
// RAINBOW-FCN — 1actions.zil:2634–2650
//
// Dispatched as the RAINBOW object's ACTION handler.
// RAINBOW is a local-global present in ARAGAIN-FALLS, ON-RAINBOW,
// END-OF-RAINBOW, and CANYON-VIEW rooms.
//
// VERB? CROSS THROUGH:
//   HERE == CANYON-VIEW:  "From here?!?"; RTRUE (block)
//   RAINBOW-FLAG:
//     HERE == ARAGAIN-FALLS:  GOTO END-OF-RAINBOW
//     HERE == END-OF-RAINBOW: GOTO ARAGAIN-FALLS
//     else:                   "You'll have to say which way..."
//   !RAINBOW-FLAG:  "Can you walk on water vapor?"
// VERB? LOOK-UNDER:
//   "The Frigid River flows under the rainbow."
// ---------------------------------------------------------------------------

export const rainbowFcn: ActionHandler = (ctx) => {
  if (ctx.verb === 'cross' || ctx.verb === 'through') {
    const hereId = ctx.here.id;

    // :2636–2638 — CANYON-VIEW is a scenic dead-end
    if (hereId === 'CANYON-VIEW') {
      ctx.tell('From here?!?');
      return true;
    }

    const rainbowFlag = ctx.getGlobal?.('RAINBOW-FLAG') ?? false;

    if (rainbowFlag) {
      // :2639–2644 — teleport across
      if (hereId === 'ARAGAIN-FALLS') {
        const dest = ctx.world.get('END-OF-RAINBOW');
        if (dest !== undefined) ctx.moveTo(ctx.actor, dest);
        return true;
      }
      if (hereId === 'END-OF-RAINBOW') {
        const dest = ctx.world.get('ARAGAIN-FALLS');
        if (dest !== undefined) ctx.moveTo(ctx.actor, dest);
        return true;
      }
      // :2645 — other positions on the rainbow
      ctx.tell("You'll have to say which way...");
      return true;
    }

    // :2647–2648
    ctx.tell('Can you walk on water vapor?');
    return true;
  }

  // :2649–2650 — VERB? LOOK-UNDER (parser sets verb='look', prep='UNDER' uppercase)
  if (ctx.verb === 'look' && ctx.prep?.toUpperCase() === 'UNDER') {
    ctx.tell('The Frigid River flows under the rainbow.');
    return true;
  }

  return false;
};

export const rainbowActions: Record<string, ActionHandler> = {
  'SCEPTRE-FUNCTION': scepFcn,
  'RAINBOW-FCN':      rainbowFcn,
};
