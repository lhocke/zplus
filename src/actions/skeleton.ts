/**
 * SKELETON — 1actions.zil:931–940
 *
 * Any interaction with the skeleton summons a ghost that curses the player's
 * valuables and banishes them to the Land of the Living Dead:
 *
 *   ROB HERE  → LAND-OF-LIVING-DEAD with PROB 100   (all visible room treasures)
 *   ROB ADVENTURER → LAND-OF-LIVING-DEAD             (all carried treasures)
 *
 * ADVENTURER (ZIL ,WINNER) = the player container; its direct children are the
 * player's carried inventory.
 *
 * ── ROB() COMPARISON (spec §6.5 A.1 requirement) ──────────────────────────
 * ZIL ROB (1actions.zil:3976–3989) checks per child of WHAT:
 *   [1] NOT (FSET? .X ,INVISIBLE)  → engine: child.hasFlag(Flag.Invisible) skip  ✓
 *   [2] NOT (FSET? .X ,SACREDBIT)  → engine: child.hasFlag(Flag.Sacred) skip      ✓
 *   [3] G? (GETP .X ,P?TVALUE) 0   → engine: child.tvalue <= 0 skip               ✓
 *   [4] OR NOT .PROB  PROB .PROB    → engine: prob===undefined → pass; else rng.prob(prob) ✓
 *   then: MOVE .X .WHERE; FSET .X ,TOUCHBIT                                        ✓
 *         EQUAL? .WHERE ,THIEF → FSET .X ,INVISIBLE                               ✓
 *           (WHERE is LAND-OF-LIVING-DEAD, never THIEF — branch does not fire)
 *
 * Conclusion: the engine's rob() faithfully transcribes ZIL ROB for the
 * WINNER (ADVENTURER) call. The tvalue>0 filter applies equally to both calls.
 * No extension flag is needed.
 *
 * The HERE call uses PROB 100: prob(100) is always true, so every eligible item
 * in the room moves unconditionally — identical behaviour to the no-PROB call.
 */

import type { ActionContext, ActionHandler } from '../domain/game-object.js';
import { Flag } from '../domain/flags.js';
import { rob, type ThiefCtx } from './thief.js';

const GHOST_MSG =
  'A ghost appears in the room and is appalled at your desecration of\n' +
  'the remains of a fellow adventurer. He casts a curse on your valuables\n' +
  'and banishes them to the Land of the Living Dead. The ghost leaves,\n' +
  'muttering obscenities.';

// Verbs that trigger the SKELETON curse — 1actions.zil:932.
const TRIGGER_ACTIONS = new Set([
  'V-TAKE', 'V-RUB', 'V-MOVE', 'V-PUSH', 'V-RAISE',
  'V-LOWER', 'V-ATTACK', 'V-KICK', 'V-KISS',
]);

// Build the minimal ThiefCtx slice that rob() needs from an ActionContext.
// rob() only calls: ctx.childrenOf, ctx.getObj (for has/setFlag/moveTo/tvalue),
// and ctx.rng.prob only when a prob argument is supplied.
// PROB 100 always passes, so we can return true unconditionally.
function makeRobCtx(ctx: ActionContext, tell: (s: string) => void): ThiefCtx {
  const world = ctx.world;
  return {
    hereId: ctx.here.id,
    rng: {
      prob: () => true,           // PROB 100 is always true
      zprob: () => true,          // unused by rob(); included for interface completeness
    },
    getLucky: () => false,        // unused by rob()
    getObj: (id: string) => {
      const obj = world.get(id);
      if (obj === undefined) return undefined;
      return {
        get id()       { return obj.id; },
        get desc()     { return obj.desc; },
        get parentId() { return obj.parent?.id ?? null; },
        get tvalue()   { return (obj.props.get('TVALUE') ?? 0) as number; },
        hasFlag:  (f: Flag) => obj.has(f),
        setFlag:  (f: Flag) => obj.set(f),
        clearFlag:(f: Flag) => obj.clear(f),
        moveTo: (destId: string) => {
          const dest = world.get(destId);
          if (dest !== undefined) obj.moveTo(dest);
        },
      };
    },
    childrenOf: (containerId: string) =>
      world.contents(containerId).map(o => o.id),
    isRoomLit:  () => false,      // unused by rob()
    getPrevLit: () => false,      // unused by rob()
    tell,
    getThiefStrength: () => 0,   // unused by rob()
    getScore: () => 0,            // unused by rob()
    fightStrength: () => 0,       // unused by rob()
  };
}

// ---------------------------------------------------------------------------
// SKELETON — 1actions.zil:931–940
// ---------------------------------------------------------------------------

export const skeletonFcn: ActionHandler = (ctx) => {
  if (!TRIGGER_ACTIONS.has(ctx.action ?? '')) return false;

  ctx.tell(GHOST_MSG);

  const robCtx = makeRobCtx(ctx, (s) => ctx.tell(s));
  const dest = 'LAND-OF-LIVING-DEAD';

  // ROB ,HERE ,LAND-OF-LIVING-DEAD 100 — room treasures; PROB 100 always passes.
  rob(robCtx, ctx.here.id, dest, 100);

  // ROB ,ADVENTURER ,LAND-OF-LIVING-DEAD — carried treasures; no prob gate.
  rob(robCtx, ctx.actor.id, dest);

  return true;
};

export const skeletonActions: Record<string, ActionHandler> = {
  'SKELETON': skeletonFcn,
};
