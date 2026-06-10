// Coal-mine shaft region action routines.
// ZIL: 1actions.zil:2558-2571

import type { ActionHandler, GameObject } from '../domain/game-object.js';
import { M_BEG } from '../engine/messages.js';
import { lit } from '../engine/parser/scope.js';

// LIGHT-SHAFT — ZIL <GLOBAL LIGHT-SHAFT 13> (1actions.zil:2578).
// The numeric global zeroes after the award; the once-only fire lives in the
// per-game FlagStore so it resets with each new game, not the isolate.
const LIGHT_SHAFT_SCORED = 'LIGHT-SHAFT-SCORED';

// WEIGHT — gverbs.zil:1988.
// SIZE(obj) + recursive sum over children.
// Player-worn branch (WEARBIT adds 1 instead of recursing) is irrelevant here:
// NO-OBJS only passes WINNER's direct inventory items, never WINNER itself.
function weight(obj: GameObject): number {
  const size = (obj.props.get('SIZE') as number | undefined) ?? 5;
  let w = size;
  for (const child of obj.children) {
    w += weight(child);
  }
  return w;
}

/** NO-OBJS — zil/1actions.zil:2558-2571 */
export const noObjs: ActionHandler = (ctx) => {
  if (ctx.rarg !== M_BEG) return false;

  let emptyHanded = true;
  for (const child of ctx.actor.children) {
    if (weight(child) > 4) {
      emptyHanded = false;
      break;
    }
  }
  ctx.setGlobal?.('EMPTY-HANDED', emptyHanded);

  if (
    ctx.here.id === 'LOWER-SHAFT' &&
    lit(ctx.here, ctx.actor, ctx.world) &&
    !ctx.getGlobal?.(LIGHT_SHAFT_SCORED)
  ) {
    ctx.score(13);
    ctx.setGlobal?.(LIGHT_SHAFT_SCORED, true);
  }

  return false;
};

export const coalMineActions: Record<string, ActionHandler> = {
  'NO-OBJS': noObjs,
};
