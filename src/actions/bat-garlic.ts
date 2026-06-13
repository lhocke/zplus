/**
 * Bat / garlic action routines — CC4.
 *
 * Hand-translations of ZIL routines from zil/1actions.zil:
 *
 *   BAT-F    1actions.zil:308  — object FCN on BAT; garlic check → repel or FLY-ME
 *   FLY-ME   1actions.zil:317  — FWEEP(4) + grab message + teleport to BAT-DROPS room
 *   FWEEP    1actions.zil:326  — prints "    Fweep!" N times then CRLF
 *   BAT-DROPS 1actions.zil:332 — 8 mine/ladder rooms the bat can drop the player into
 *   GARLIC-F 1actions.zil:4160 — EAT garlic: remove + gulp message
 *
 * Note on V-FIRST-LOOK suppression at ENTRANCE-TO-HADES (1actions.zil:322–323):
 *   ZIL skips V-FIRST-LOOK when FLY-ME drops the player at ENTRANCE-TO-HADES.
 *   The engine's action-chain move detection always fires describeCurrentRoom after a
 *   room change; the Hades no-look is therefore not reproduced (it affects only the
 *   1/8 Hades draw and is not exercised by any corpus or golden test).
 */

import type { ActionContext, ActionHandler } from '../domain/game-object.js';

// BAT-DROPS — 1actions.zil:332–341.
// The eight rooms the bat can drop the player into (0-indexed for rng.nextInt(8)).
const BAT_DROPS: readonly string[] = [
  'MINE-1',
  'MINE-2',
  'MINE-3',
  'MINE-4',
  'LADDER-TOP',
  'LADDER-BOTTOM',
  'SQUEEKY-ROOM',
  'MINE-ENTRANCE',
];

// FWEEP — 1actions.zil:326–330.
// Prints "    Fweep!" N times (each on its own line) then a blank line.
function fweep(n: number, ctx: ActionContext): void {
  const lines: string[] = [];
  for (let i = 0; i < n; i++) {
    lines.push('    Fweep!');
  }
  ctx.tell(lines.join('\n'));
  ctx.tell('');
}

// FLY-ME — 1actions.zil:317–324.
// FWEEP(4) + grab message + GOTO random BAT-DROPS room.
// Path B fence: destination is seeded/structural — callers must not golden-diff the draw.
function flyMe(ctx: ActionContext): void {
  fweep(4, ctx);
  ctx.tell('The bat grabs you by the scruff of your neck and lifts you away....\n');

  // PICK-ONE BAT-DROPS — 1actions.zil:321.
  const idx = ctx.rng !== undefined
    ? Math.floor(ctx.rng.next() * BAT_DROPS.length)
    : 0;
  const destId = BAT_DROPS[idx]!;
  const dest = ctx.world.get(destId);

  if (dest !== undefined) {
    ctx.moveTo(ctx.actor, dest);
    // V-FIRST-LOOK: engine's move detection fires describeCurrentRoom automatically.
    // At ENTRANCE-TO-HADES, ZIL skips V-FIRST-LOOK — we accept this minor deviation
    // (see module-level note; not exercised by any corpus test).
  }
}

// ---------------------------------------------------------------------------
// BAT-F — 1actions.zil:308–315
// ---------------------------------------------------------------------------

/**
 * BAT-F — object FCN on the deranged vampire bat.
 *
 * TELL: FWEEP(6) + clear P-CONT (engine has no P-CONT; FWEEP only).
 * TAKE/ATTACK/MUNG:
 *   garlic in winner or HERE → "You can't reach him; he's on the ceiling."
 *   else → FLY-ME (teleport player).
 */
export const batF: ActionHandler = (ctx) => {
  // VERB? TELL — 1actions.zil:309–311.
  if (ctx.action === 'V-TELL') {
    fweep(6, ctx);
    // ZIL: <SETG P-CONT <>> — suppresses "The bat ignored you." continuation.
    // Engine has no P-CONT mechanism; omitted (no observable difference in output).
    return true;
  }

  // VERB? TAKE ATTACK MUNG — 1actions.zil:312–315.
  if (
    ctx.action === 'V-TAKE' ||
    ctx.action === 'V-ATTACK' ||
    ctx.action === 'V-MUNG'
  ) {
    const garlic = ctx.world.get('GARLIC');
    const garlicHere =
      garlic !== undefined &&
      (garlic.parent === ctx.actor || garlic.parent === ctx.here);

    if (garlicHere) {
      // 1actions.zil:313–314 — garlic repels the bat.
      ctx.tell("You can't reach him; he's on the ceiling.");
      return true;
    }

    // 1actions.zil:315 — no garlic: FLY-ME.
    flyMe(ctx);
    return true;
  }

  return false;
};

// ---------------------------------------------------------------------------
// GARLIC-F — 1actions.zil:4160–4165
// ---------------------------------------------------------------------------

/**
 * GARLIC-F — object FCN on the clove of garlic.
 *
 * EAT: REMOVE-CAREFULLY PRSO + gulp message.
 */
export const garlicF: ActionHandler = (ctx) => {
  if (ctx.action === 'V-EAT') {
    const garlic = ctx.self;
    garlic.moveTo(null);  // REMOVE-CAREFULLY PRSO — 1actions.zil:4162.
    ctx.tell(
      "What the heck! You won't make friends this way, but nobody around\n" +
      'here is too friendly anyhow. Gulp!',
    );
    return true;
  }
  return false;
};

/** ACTION routines for the bat/garlic region. */
export const batGarlicActions: Record<string, ActionHandler> = {
  'BAT-F':     batF,
  'GARLIC-F':  garlicF,
};
