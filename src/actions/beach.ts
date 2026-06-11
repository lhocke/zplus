/**
 * Beach-area action routines — Phase 3b CB-SAND.
 *
 * Scope: SAND-FUNCTION — sandy-cave dig counter + scarab reveal.
 *
 * ZIL source refs:
 *   SAND-FUNCTION   1actions.zil:2855–2869
 *   BDIGS           1actions.zil:2871–2874
 *   BEACH-DIG       1actions.zil:2851 (<GLOBAL BEACH-DIG -1>)
 *   SCARAB          1dungeon.zil:871
 */

import type { ActionHandler } from '../domain/game-object.js';
import { Flag } from '../domain/flags.js';

// BDIGS — 1actions.zil:2871–2874 (0-indexed, accessed by BEACH-DIG value 0/1/2)
const BDIGS: readonly string[] = [
  'You seem to be digging a hole here.',
  'The hole is getting deeper, but that\'s about it.',
  'You are surrounded by a wall of sand on all sides.',
];

// ---------------------------------------------------------------------------
// SAND-FUNCTION — 1actions.zil:2855–2869
//
// Fires on DIG with SHOVEL (dobj = SAND object, iobj = SHOVEL).
// BEACH-DIG starts at -1; incremented before branching:
//   → 0/1/2  : BDIGS[BEACH-DIG] progress message
//   → 3      : reveal scarab (if still INVISIBLE in SANDY-CAVE)
//   → 4+ (>3): fatal collapse, re-hide scarab if still in HERE, reset to -1
// ---------------------------------------------------------------------------

export const sandFunction: ActionHandler = (ctx) => {
  const shovel = ctx.world.get('SHOVEL');
  if (ctx.verb !== 'dig' || ctx.iobj !== shovel) return false;

  const cur = ctx.getIntGlobal?.('BEACH-DIG') ?? -1;
  const next = cur + 1;
  ctx.setIntGlobal?.('BEACH-DIG', next);

  if (next > 3) {
    // :2858–2861 — fatal collapse via JIGS-UP
    // State mutations before jigsUp (NM-L: must not be rolled back by fatal abort)
    ctx.setIntGlobal?.('BEACH-DIG', -1);
    // Re-hide scarab only if it's still in HERE — :2860 <IN? ,SCARAB ,HERE>
    const scarab = ctx.world.get('SCARAB');
    if (scarab !== undefined && scarab.parent === ctx.here) {
      ctx.setFlag(scarab, Flag.Invisible);
    }
    ctx.jigsUp?.('The hole collapses, smothering you.');
    return true;
  }

  if (next === 3) {
    // :2862–2867 — scarab reveal on 4th dig
    // <COND (<FSET? ,SCARAB ,INVISIBLE> ...)> — only if still invisible
    const scarab = ctx.world.get('SCARAB');
    if (scarab !== undefined && scarab.has(Flag.Invisible)) {
      ctx.tell('You can see a scarab here in the sand.');
      ctx.thisIsIt?.(scarab);
      ctx.clearFlag(scarab, Flag.Invisible);
    }
    return true;
  }

  // :2868–2869 — progress message (BEACH-DIG = 0, 1, or 2)
  const msg = BDIGS[next];
  if (msg !== undefined) ctx.tell(msg);
  return true;
};

export const beachActions: Record<string, ActionHandler> = {
  'SAND-FUNCTION': sandFunction,
};
