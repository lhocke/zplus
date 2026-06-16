/**
 * Coal-mine shaft region action routines — CC3 + CC10.
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
 *   BATS-ROOM        1actions.zil:2478  — BAT-ROOM: M-LOOK description; M-ENTER bat-grab
 *   BOOM-ROOM        1actions.zil:2446  — GAS-ROOM M-END: lit flame → explosion + jigsUp
 *   CAVE2-ROOM       1actions.zil:2416  — TINY-CAVE M-END: candle blow-out (ZPROB 50)
 *
 * CAGE-TOP global (1actions.zil:275: <GLOBAL CAGE-TOP T>):
 *   true  = basket is raised; RAISED-BASKET in SHAFT-ROOM, LOWERED-BASKET in LOWER-SHAFT.
 *   false = basket is lowered; RAISED-BASKET in LOWER-SHAFT, LOWERED-BASKET in SHAFT-ROOM.
 */

import type { ActionHandler, GameObject } from '../domain/game-object.js';
import { Flag } from '../domain/flags.js';
import { M_BEG, M_END, M_ENTER, M_LOOK } from '../engine/messages.js';
import { pick, dummy, type PickRng } from '../engine/game-messages.js';
import { lit } from '../engine/parser/scope.js';
import type { Room } from '../domain/room.js';
import { flyMe } from './bat-garlic.js';

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
    // Has contents — reveal them on a single line (ZIL: sequential TELLs, no CR between).
    const items = [...machine.children].filter(c => !ctx.hasFlag(c, Flag.Invisible));
    if (items.length > 0) {
      // PRINT-CONTENTS: "a X" or "a X, and a Y" or "a X, a Y, and a Z".
      const parts = items.map(c => 'a ' + c.desc);
      const list = parts.length === 1
        ? parts[0]!
        : parts.slice(0, -1).join(', ') + ', and ' + parts[parts.length - 1]!;
      ctx.tell('The lid opens, revealing ' + list + '.');
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
  const cageTop = ctx.getGlobal?.('CAGE-TOP') ?? false;

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

// ---------------------------------------------------------------------------
// BATS-ROOM — 1actions.zil:2478–2486
// ---------------------------------------------------------------------------

/**
 * BATS-ROOM — room FCN for BAT-ROOM.
 *
 * M-LOOK: emit the room description.  BAT-D fires via the bat's descFcn during
 *         DESCRIBE-OBJECTS (wired in bootstrap), so the bat-presence text is
 *         produced there — this handler only owns the room's own ldesc.
 * M-ENTER: ZIL 1actions.zil:2482–2486 — when not dead and garlic is absent:
 *   <V-LOOK> emits the room description (already in verbResult.output via verbGo);
 *   <CRLF>   blank-line separator (emitted here, prepended by engine ordering fix);
 *   <FLY-ME> fweep × 3 + grab + teleport.
 *   The engine (game.ts) appends M-ENTER output after verbResult.output when
 *   M-ENTER itself moves the player, giving the correct ZIL ordering.
 */
export const batsRoom: ActionHandler = (ctx) => {
  if (ctx.rarg === M_LOOK) {
    ctx.tell('You are in a small room which has doors only to the east and south.');
    return true;
  }

  if (ctx.rarg === M_ENTER && !ctx.isDead?.()) {
    const garlic = ctx.world.get('GARLIC');
    // <NOT <EQUAL? <LOC ,GARLIC> ,WINNER ,HERE>> — garlic must not be in player or HERE.
    const garlicNearby =
      garlic !== undefined &&
      (garlic.parent === ctx.actor || garlic.parent === ctx.here);
    if (!garlicNearby) {
      // <CRLF> — blank line between V-LOOK output and the first Fweep!
      // (1actions.zil:2485).  The engine appends M-ENTER output after the
      // verbResult room description, so this blank line lands in the right spot.
      ctx.tell('');
      flyMe(ctx);
    }
  }

  return false;
};

// ---------------------------------------------------------------------------
// BOOM-ROOM — 1actions.zil:2446–2467
// ---------------------------------------------------------------------------

/**
 * BOOM-ROOM — GAS-ROOM M-END handler.
 *
 * Fires after each turn spent in the gas room.  If the player is carrying any
 * lit light source (candles, torch, or match with ONBIT set), the room explodes.
 *
 * DUMMY? branch (1actions.zil:2458–2461): fires when the CURRENT TURN's action
 * was V-LAMP-ON or V-BURN and PRSO was the ignited light source — the player
 * literally just lit a flame in the room.  Message is different from passive carry.
 */
export const boomRoom: ActionHandler = (ctx) => {
  if (ctx.rarg !== M_END) return false;

  // Check if this turn's action was lighting a flame object.
  // ZIL: <VERB? LAMP-ON BURN> AND <EQUAL? ,PRSO ,CANDLES ,TORCH ,MATCH>
  const isDummyAction =
    (ctx.action === 'V-LAMP-ON' || ctx.action === 'V-BURN') &&
    (ctx.dobj?.id === 'CANDLES' || ctx.dobj?.id === 'TORCH' || ctx.dobj?.id === 'MATCH');

  // Check carried lit objects — HELD? = parent is WINNER.
  const candles = ctx.world.get('CANDLES');
  const torch   = ctx.world.get('TORCH');
  const match   = ctx.world.get('MATCH');

  const hasLitFlame =
    (candles !== undefined && candles.parent === ctx.actor && ctx.hasFlag(candles, Flag.OnFire)) ||
    (torch   !== undefined && torch.parent   === ctx.actor && ctx.hasFlag(torch,   Flag.OnFire)) ||
    (match   !== undefined && match.parent   === ctx.actor && ctx.hasFlag(match,   Flag.OnFire));

  if (!hasLitFlame) return false;

  if (isDummyAction) {
    ctx.tell(
      `How sad for an aspiring adventurer to light a ${ctx.dobj!.desc} in a room which\n` +
      'reeks of gas. Fortunately, there is justice in the world.',
    );
  } else {
    ctx.tell(
      'Oh dear. It appears that the smell coming from this room was coal gas.\n' +
      'I would have thought twice about carrying flaming objects in here.',
    );
  }

  ctx.jigsUp?.('\n      ** BOOOOOOOOOOOM **');
  return true;
};

// ---------------------------------------------------------------------------
// CAVE2-ROOM — 1actions.zil:2416–2426
// ---------------------------------------------------------------------------

/**
 * CAVE2-ROOM — TINY-CAVE M-END handler.
 *
 * Each turn: if the player is carrying lit candles, roll ZPROB(50) (≈50% with
 * default LUCKY=T) to blow them out.  Disables the candle clock (I-CANDLES)
 * and clears ONBIT.  If the room goes dark, announces that too.
 *
 * ZPROB(50) — gmacros.zil:119–122: next()*100 < 50 when LUCKY=T.
 */
export const cave2Room: ActionHandler = (ctx) => {
  if (ctx.rarg !== M_END) return false;

  const candles = ctx.world.get('CANDLES');
  if (
    candles === undefined ||
    candles.parent !== ctx.actor ||
    !ctx.hasFlag(candles, Flag.OnFire)
  ) {
    return false;
  }

  // ZPROB(50): next()*100 < 50 (LUCKY=T assumed, matching default game state).
  const blow = ctx.rng !== undefined
    ? ctx.rng.next() * 100 < 50
    : false;
  if (!blow) return false;

  ctx.disableClock('I-CANDLES');
  ctx.clearFlag(candles, Flag.OnFire);

  ctx.tell('A gust of wind blows out your candles!');

  // <NOT <SETG LIT <LIT? ,HERE>>> — announce if room is now dark.
  if (!lit(ctx.here as Room, ctx.actor, ctx.world)) {
    ctx.tell('It is now completely dark.');
  }

  return false;
};

export const coalMineActions: Record<string, ActionHandler> = {
  'NO-OBJS':           noObjs,
  'MACHINE-ROOM-FCN':  machineRoomFcn,
  'MACHINE-F':         machineF,
  'MSWITCH-FUNCTION':  mswitchFunction,
  'BASKET-F':          basketF,
  'BATS-ROOM':         batsRoom,
  'BOOM-ROOM':         boomRoom,
  'CAVE2-ROOM':        cave2Room,
};
