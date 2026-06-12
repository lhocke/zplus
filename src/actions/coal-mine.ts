/**
 * Coal-mine shaft region action routines — CC3.
 *
 * Hand-translations of ZIL routines from zil/1actions.zil:
 *
 *   NO-OBJS          1actions.zil:2558  — LOWER-SHAFT room FCN: empty-handed check
 *                                         + LIGHT-SHAFT +13 award
 *   MACHINE-ROOM-FCN 1actions.zil:2488  — M-LOOK with dynamic lid state
 *   MACHINE-F        1actions.zil:2502  — OPEN/CLOSE machine lid, TAKE machine
 *   MSWITCH-FUNCTION 1actions.zil:2531  — TURN switch with screwdriver
 *   BASKET-F         1actions.zil:277   — RAISE/LOWER the basket (CAGE-TOP global)
 *   GUNK-FUNCTION    1actions.zil:2553  — slag crumbles on touch (already in above-ground.ts)
 *
 * CAGE-TOP global (1actions.zil:275: <GLOBAL CAGE-TOP T>):
 *   true  = basket is raised; RAISED-BASKET in SHAFT-ROOM, LOWERED-BASKET in LOWER-SHAFT.
 *   false = basket is lowered; RAISED-BASKET in LOWER-SHAFT, LOWERED-BASKET in SHAFT-ROOM.
 */

import type { ActionHandler, GameObject } from '../domain/game-object.js';
import { Flag } from '../domain/flags.js';
import { M_BEG, M_LOOK } from '../engine/messages.js';
import { pick, dummy, type PickRng } from '../engine/game-messages.js';
import { lit } from '../engine/parser/scope.js';
import type { Room } from '../domain/room.js';

function pickDummy(rng: PickRng | undefined): string {
  if (rng !== undefined) return pick(dummy, rng);
  return dummy.entries[0] ?? 'Huh?';
}

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

// ---------------------------------------------------------------------------
// MACHINE-ROOM-FCN — 1actions.zil:2488–2500
// ---------------------------------------------------------------------------

/** MACHINE-ROOM-FCN — M-LOOK produces the room description with dynamic lid state. */
export const machineRoomFcn: ActionHandler = (ctx) => {
  if (ctx.rarg !== M_LOOK) return false;

  const machine = ctx.world.get('MACHINE');
  const lidOpen = machine !== undefined && ctx.hasFlag(machine, Flag.Open);

  ctx.tell(
    'This is a large, cold room whose sole exit is to the north. In one corner there is a machine ' +
    'which is reminiscent of a clothes dryer. On its face is a switch which is labelled "START". ' +
    'The switch does not appear to be manipulable by any human hand (unless the fingers are about ' +
    '1/16 by 1/4 inch). On the front of the machine is a large lid, which is ' +
    (lidOpen ? 'open.' : 'closed.'),
  );

  return true;
};

// ---------------------------------------------------------------------------
// MACHINE-F — 1actions.zil:2502–2529
// ---------------------------------------------------------------------------

/**
 * MACHINE-F — object FCN on MACHINE.
 * Handles TAKE (too large), OPEN (with/without contents), CLOSE, and the
 * V-LAMP-ON synonym that re-dispatches to MSWITCH-FUNCTION.
 */
export const machineF: ActionHandler = (ctx) => {
  const machine = ctx.self;

  // TAKE MACHINE — 1actions.zil:2503–2504.
  if (ctx.action === 'V-TAKE' && ctx.dobj === machine) {
    ctx.tell('It is far too large to carry.');
    return true;
  }

  // OPEN — 1actions.zil:2505–2515.
  if (ctx.action === 'V-OPEN') {
    if (ctx.hasFlag(machine, Flag.Open)) {
      // Already open: PICK-ONE DUMMY.
      ctx.tell(pickDummy(ctx.rng));
      return true;
    }
    // Has contents — reveal them.
    const first = [...machine.children].filter(c => !ctx.hasFlag(c, Flag.Invisible))[0];
    if (first !== undefined) {
      ctx.tell('The lid opens, revealing ');
      // PRINT-CONTENTS: list direct non-invisible children as "a X, a Y, and a Z".
      const items = [...machine.children].filter(c => !ctx.hasFlag(c, Flag.Invisible));
      const parts = items.map(c => 'a ' + c.desc);
      if (parts.length === 1) {
        ctx.tell(parts[0]! + '.');
      } else {
        ctx.tell(parts.slice(0, -1).join(', ') + ', and ' + parts[parts.length - 1]! + '.');
      }
    } else {
      ctx.tell('The lid opens.');
    }
    ctx.setFlag(machine, Flag.Open);
    return true;
  }

  // CLOSE — 1actions.zil:2516–2523.
  if (ctx.action === 'V-CLOSE') {
    if (ctx.hasFlag(machine, Flag.Open)) {
      ctx.tell('The lid closes.');
      ctx.clearFlag(machine, Flag.Open);
      return true;
    }
    // Already closed: PICK-ONE DUMMY.
    ctx.tell(pickDummy(ctx.rng));
    return true;
  }

  // V-LAMP-ON (the "turn it on" path) — re-dispatch to MSWITCH-FUNCTION.
  // 1actions.zil:2523–2529: <PERFORM ,V?TURN ,MACHINE-SWITCH ,PRSI>
  if (ctx.action === 'V-LAMP-ON') {
    if (ctx.iobj === undefined) {
      ctx.tell("It's not clear how to turn it on with your bare hands.");
      return true;
    }
    // Route to MSWITCH-FUNCTION via its handler if registered.
    const mswitch = ctx.world.get('MACHINE-SWITCH');
    if (mswitch?.handler !== undefined) {
      // Build a synthetic context with self=MACHINE-SWITCH, action=V-TURN.
      const synthCtx = { ...ctx, self: mswitch, action: 'V-TURN', dobj: mswitch };
      mswitch.handler(synthCtx);
    }
    return true;
  }

  return false;
};

// ---------------------------------------------------------------------------
// MSWITCH-FUNCTION — 1actions.zil:2531–2551
// ---------------------------------------------------------------------------

/**
 * MSWITCH-FUNCTION — object FCN on MACHINE-SWITCH.
 * TURN switch with SCREWDRIVER and lid closed + coal → DIAMOND; else → GUNK.
 * Without screwdriver: "It seems that a X won't do."
 */
export const mswitchFunction: ActionHandler = (ctx) => {
  if (ctx.action !== 'V-TURN') return false;

  const machine = ctx.world.get('MACHINE');
  if (machine === undefined) return false;

  const iobj = ctx.iobj;
  const screwdriver = ctx.world.get('SCREWDRIVER');

  if (iobj !== screwdriver || iobj === undefined) {
    // Wrong instrument — 1actions.zil:2549–2550.
    const instrDesc = iobj?.desc ?? 'that';
    ctx.tell(`It seems that a ${instrDesc} won't do.`);
    return true;
  }

  // Screwdriver used — check lid state.
  if (ctx.hasFlag(machine, Flag.Open)) {
    // Lid open: machine does nothing — 1actions.zil:2535–2536.
    ctx.tell("The machine doesn't seem to want to do anything.");
    return true;
  }

  // Lid closed — machine runs (1actions.zil:2537–2548).
  ctx.tell(
    'The machine comes to life (figuratively) with a dazzling display of\n' +
    'colored lights and bizarre noises. After a few moments, the\n' +
    'excitement abates.',
  );

  const coal = ctx.world.get('COAL');
  if (coal !== undefined && coal.parent === machine) {
    // Coal present: remove coal, place diamond — 1actions.zil:2541–2543.
    coal.moveTo(null);
    const diamond = ctx.world.get('DIAMOND');
    if (diamond !== undefined) diamond.moveTo(machine);
  } else {
    // No coal: clear all contents, place gunk — 1actions.zil:2544–2548.
    for (const child of [...machine.children]) {
      child.moveTo(null);
    }
    const gunk = ctx.world.get('GUNK');
    if (gunk !== undefined) gunk.moveTo(machine);
  }

  return true;
};

// ---------------------------------------------------------------------------
// BASKET-F — 1actions.zil:277–306
// ---------------------------------------------------------------------------

/**
 * BASKET-F — object FCN on RAISED-BASKET and LOWERED-BASKET.
 *
 * RAISE/LOWER move both basket objects between SHAFT-ROOM and LOWER-SHAFT
 * and toggle the CAGE-TOP global.  The pitch-black check (1actions.zil:298)
 * fires when lowering removes the only light source from SHAFT-ROOM.
 * TAKE is unconditionally blocked (chain-fastened).
 *
 * Intercepts before HACK-HACK (spec §4.5 seam).
 */
export const basketF: ActionHandler = (ctx) => {
  const cageTop = ctx.getGlobal?.('CAGE-TOP') ?? true;  // ZIL default: T

  if (ctx.action === 'V-RAISE') {
    if (cageTop) {
      // Already up: PICK-ONE DUMMY — 1actions.zil:280.
      ctx.tell(pickDummy(ctx.rng));
    } else {
      // Raise: move RAISED-BASKET to SHAFT-ROOM, LOWERED-BASKET to LOWER-SHAFT.
      // 1actions.zil:281–287.
      const raised = ctx.world.get('RAISED-BASKET');
      const lowered = ctx.world.get('LOWERED-BASKET');
      const shaftRoom = ctx.world.get('SHAFT-ROOM');
      const lowerShaft = ctx.world.get('LOWER-SHAFT');
      if (raised && shaftRoom) raised.moveTo(shaftRoom);
      if (lowered && lowerShaft) lowered.moveTo(lowerShaft);
      ctx.setGlobal?.('CAGE-TOP', true);
      // THIS-IS-IT RAISED-BASKET — bind pronoun to the newly-arrived basket.
      if (raised) ctx.thisIsIt?.(raised);
      ctx.tell('The basket is raised to the top of the shaft.');
    }
    return true;
  }

  if (ctx.action === 'V-LOWER') {
    if (!cageTop) {
      // Already down: PICK-ONE DUMMY — 1actions.zil:290.
      ctx.tell(pickDummy(ctx.rng));
    } else {
      // Lower: move RAISED-BASKET to LOWER-SHAFT, LOWERED-BASKET to SHAFT-ROOM.
      // 1actions.zil:291–300.
      const raised = ctx.world.get('RAISED-BASKET');
      const lowered = ctx.world.get('LOWERED-BASKET');
      const shaftRoom = ctx.world.get('SHAFT-ROOM');
      const lowerShaft = ctx.world.get('LOWER-SHAFT');

      // Capture lit state BEFORE moving (ZIL: ,LIT is the pre-move room-lit bool).
      // LIT here is not a stored global but the room's current lit state.
      const here = ctx.here as Room;
      const wasLit = lit(here, ctx.actor, ctx.world);

      if (raised && lowerShaft) raised.moveTo(lowerShaft);
      if (lowered && shaftRoom) lowered.moveTo(shaftRoom);

      // THIS-IS-IT LOWERED-BASKET.
      if (lowered) ctx.thisIsIt?.(lowered);

      ctx.tell('The basket is lowered to the bottom of the shaft.');
      ctx.setGlobal?.('CAGE-TOP', false);

      // Pitch-black check — 1actions.zil:298–299.
      // If room was lit and now is not, announce darkness.
      if (wasLit && !lit(here, ctx.actor, ctx.world)) {
        ctx.tell('It is now pitch black.');
      }
    }
    return true;
  }

  // LOWERED-BASKET referenced from wrong shaft end (PRSO or PRSI is LOWERED-BASKET).
  // 1actions.zil:301–303: basket is at the other end.
  const lowered = ctx.world.get('LOWERED-BASKET');
  if (
    (ctx.dobj === lowered || ctx.iobj === lowered) &&
    ctx.action !== 'V-TAKE'
  ) {
    ctx.tell('The basket is at the other end of the chain.');
    return true;
  }

  // TAKE RAISED-BASKET or LOWERED-BASKET — always blocked.
  // 1actions.zil:304–306.
  if (
    ctx.action === 'V-TAKE' &&
    (ctx.dobj === ctx.world.get('RAISED-BASKET') ||
     ctx.dobj === ctx.world.get('LOWERED-BASKET'))
  ) {
    ctx.tell('The cage is securely fastened to the iron chain.');
    return true;
  }

  return false;
};

export const coalMineActions: Record<string, ActionHandler> = {
  'NO-OBJS':           noObjs,
  'MACHINE-ROOM-FCN':  machineRoomFcn,
  'MACHINE-F':         machineF,
  'MSWITCH-FUNCTION':  mswitchFunction,
  'BASKET-F':          basketF,
};
