/**
 * Weapon FCNs — CC8.
 *
 * Hand-translations of:
 *   KNIFE-F          1actions.zil:926–929
 *   RUSTY-KNIFE-FCN  1actions.zil:907–924
 *   AXE-F            1actions.zil:622–624  (calls WEAPON-FUNCTION)
 *
 * STILETTO-FUNCTION is live in treasure-room.ts (thief wave) — not touched here.
 */

import type { ActionContext, ActionHandler } from '../domain/game-object.js';
import { Flag } from '../domain/flags.js';

// ---------------------------------------------------------------------------
// KNIFE-F — 1actions.zil:926–929
//
// On TAKE, clears NDESCBIT on ATTIC-TABLE so the table appears in subsequent
// room descriptions.  Returns false (RFALSE) — the take verb proceeds.
// ---------------------------------------------------------------------------

export const knifeFcn: ActionHandler = (ctx) => {
  if (ctx.action !== 'V-TAKE') return false;
  const table = ctx.world.get('ATTIC-TABLE');
  if (table !== undefined) table.clear(Flag.NonDescript);
  return false;
};

// ---------------------------------------------------------------------------
// WEAPON-FUNCTION — 1actions.zil:629–638
//
// Shared by AXE-F (and STILETTO-FUNCTION in treasure-room.ts, which is not
// touched here).  W = weapon id, V = villain id.
//
//   • Villain not in HERE → RFALSE (no-op).
//   • TAKE: weapon in villain → "V swings it out of your reach."
//           weapon elsewhere  → "The W seems white-hot. You can't hold on to it."
//           → RTRUE (handled).
// ---------------------------------------------------------------------------

function weaponFunction(ctx: ActionContext, weaponId: string, villainId: string): boolean {
  const villain = ctx.world.get(villainId);
  if (villain === undefined || villain.parent?.id !== ctx.here.id) return false;

  if (ctx.action === 'V-TAKE') {
    const weapon = ctx.world.get(weaponId);
    if (weapon !== undefined && weapon.parent?.id === villainId) {
      ctx.tell('The ' + villain.desc + ' swings it out of your reach.');
    } else {
      ctx.tell("The " + (weapon?.desc ?? weaponId.toLowerCase()) + " seems white-hot. You can't hold on to it.");
    }
    return true;
  }

  return false;
}

// ---------------------------------------------------------------------------
// AXE-F — 1actions.zil:622–624
//
// Gate on TROLL-FLAG: if truthy (troll dead/fled), do nothing.
// Otherwise delegate to WEAPON-FUNCTION(AXE, TROLL).
// ---------------------------------------------------------------------------

export const axeFcn: ActionHandler = (ctx) => {
  if (ctx.getGlobal?.('TROLL-FLAG')) return false;
  return weaponFunction(ctx, 'AXE', 'TROLL');
};

// ---------------------------------------------------------------------------
// RUSTY-KNIFE-FCN — 1actions.zil:907–924
//
// TAKE while player carries SWORD:
//   "As you touch the rusty knife, your sword gives a single pulse of
//    blinding blue light."  → RFALSE (take continues).
//
// ATTACK with PRSI==RUSTY-KNIFE, OR SWING PRSO==RUSTY-KNIFE with PRSI set:
//   REMOVE-CAREFULLY the knife, then JIGS-UP with the throat-slit message.
// ---------------------------------------------------------------------------

const RUSTY_KNIFE_DEATH =
  'As the knife approaches its victim, your mind is submerged by an\n' +
  'overmastering will. Slowly, your hand turns, until the rusty blade\n' +
  'is an inch from your neck. The knife seems to sing as it savagely\n' +
  'slits your throat.';

export const rustyKnifeFcn: ActionHandler = (ctx) => {
  if (ctx.action === 'V-TAKE') {
    const sword = ctx.world.get('SWORD');
    if (sword !== undefined && sword.parent?.id === ctx.actor.id) {
      ctx.tell(
        'As you touch the rusty knife, your sword gives a single pulse of blinding\n' +
        'blue light.',
      );
    }
    // RFALSE — take proceeds regardless.
    return false;
  }

  // ATTACK with rusty-knife as instrument (PRSI), OR SWING rusty-knife (PRSO) with a target.
  const rustKnifeIsInstr = ctx.action === 'V-ATTACK' && ctx.iobj?.id === 'RUSTY-KNIFE';
  const swingWithTarget  = ctx.action === 'V-SWING'  && ctx.dobj?.id === 'RUSTY-KNIFE' && ctx.iobj !== undefined;

  if (rustKnifeIsInstr || swingWithTarget) {
    const knife = ctx.world.get('RUSTY-KNIFE');
    if (knife !== undefined) knife.moveTo(null);  // REMOVE-CAREFULLY
    ctx.jigsUp?.(RUSTY_KNIFE_DEATH);
    ctx.fatal();
    return true;
  }

  return false;
};

export const weaponsActions: Record<string, ActionHandler> = {
  'KNIFE-F':         knifeFcn,
  'AXE-F':           axeFcn,
  'RUSTY-KNIFE-FCN': rustyKnifeFcn,
};
