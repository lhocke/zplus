/**
 * Mirror region action routines — CC6.
 *
 * Hand-translations of ZIL routines from zil/1actions.zil:956–1012.
 *
 *   MIRROR-ROOM      1actions.zil:958   — room FCN for MIRROR-ROOM-1 and MIRROR-ROOM-2
 *   MIRROR-MIRROR    1actions.zil:971   — object FCN on MIRROR-1 and MIRROR-2
 *
 * Globals:
 *   MIRROR-MUNG — true when the mirror is broken; suppresses swap and adds
 *                 broken-mirror text to the M-LOOK description.
 *   LUCKY       — true (default); set false when mirror is broken. Phase-2
 *                 zprob reads this via getLucky(): denom shifts 100→300, so
 *                 LOSE-WEAPON fires at ~1/3 frequency after the break.
 *                 (1actions.zil:969, :1009; gverbs.zil:4055)
 *
 * RUB seam:
 *   MIRROR-MIRROR fires at PERFORM step 6 (PRSO P?ACTION) before V-RUB default
 *   (step 7). Returns true to suppress the HACK-HACK fallback.
 */

import type { ActionHandler } from '../domain/game-object.js';
import { M_LOOK } from '../engine/messages.js';

const MIRROR_ROOM_LDESC =
  'You are in a large square room with tall ceilings. On the south wall ' +
  'is an enormous mirror which fills the entire wall. There are exits ' +
  'on the other three sides of the room.';

const MIRROR_MUNG_ADDENDUM =
  'Unfortunately, the mirror has been destroyed by your recklessness.';

// ---------------------------------------------------------------------------
// MIRROR-ROOM — 1actions.zil:958–966
// Room FCN shared by MIRROR-ROOM-1 and MIRROR-ROOM-2.
// ---------------------------------------------------------------------------

export const mirrorRoomFcn: ActionHandler = (ctx) => {
  if (ctx.rarg !== M_LOOK) return false;

  ctx.tell(MIRROR_ROOM_LDESC);

  if (ctx.getGlobal?.('MIRROR-MUNG')) {
    ctx.tell(MIRROR_MUNG_ADDENDUM);
  }

  return true;
};

// ---------------------------------------------------------------------------
// MIRROR-MIRROR — 1actions.zil:971–1012
// Object FCN on MIRROR-1 (in MIRROR-ROOM-1) and MIRROR-2 (in MIRROR-ROOM-2).
// ---------------------------------------------------------------------------

export const mirrorMirrorFcn: ActionHandler = (ctx) => {
  const munged = ctx.getGlobal?.('MIRROR-MUNG') ?? false;

  // V-RUB: swap + teleport. 1actions.zil:972–993.
  if (!munged && ctx.action === 'V-RUB') {
    // Instrument guard: PRSI set and not HANDS → tingling message. 1actions.zil:973–976.
    const iobj = ctx.iobj;
    if (iobj !== undefined && iobj.id !== 'HANDS') {
      ctx.tell(`You feel a faint tingling transmitted through the ${iobj.desc}.`);
      return true;
    }

    // Determine the other room. RM2 starts as MIRROR-ROOM-2; if HERE==MIRROR-ROOM-2, swap to MIRROR-ROOM-1.
    // 1actions.zil:977–978.
    const here = ctx.here;
    const rm2Id = here.id === 'MIRROR-ROOM-2' ? 'MIRROR-ROOM-1' : 'MIRROR-ROOM-2';
    const rm2 = ctx.world.get(rm2Id);
    if (rm2 === undefined) return false;

    // Snapshot children before any moves (ZIL captures L1/L2 before the REPEAT loops).
    // 1actions.zil:979–990.
    const l1 = Array.from(here.children);
    const l2 = Array.from(rm2.children);

    // REPEAT: move all HERE children to RM2 (includes the player). 1actions.zil:981–985.
    for (const obj of l1) {
      obj.moveTo(rm2);
    }

    // REPEAT: move all RM2 children to HERE. 1actions.zil:986–990.
    for (const obj of l2) {
      obj.moveTo(here);
    }

    // GOTO .RM2 <> — V?=false suppresses V-FIRST-LOOK (gverbs.zil:2134–2136).
    // Signal the engine to skip the post-handler room description.
    // 1actions.zil:991.
    ctx.suppressArrivalLook?.();

    // Rumble message follows the GOTO in ZIL. 1actions.zil:992–993.
    ctx.tell('There is a rumble from deep within the earth and the room shakes.');
    return true;
  }

  // V-LOOK-INSIDE / V-EXAMINE. 1actions.zil:994–999.
  if (ctx.action === 'V-LOOK-INSIDE' || ctx.action === 'V-EXAMINE') {
    if (munged) {
      ctx.tell('The mirror is broken into many pieces.');
    } else {
      ctx.tell('There is an ugly person staring back at you.');
    }
    return true;
  }

  // V-TAKE. 1actions.zil:1000–1002.
  if (ctx.action === 'V-TAKE') {
    ctx.tell('The mirror is many times your size. Give up.');
    return true;
  }

  // V-MUNG / V-THROW / V-ATTACK: break the mirror. 1actions.zil:1003–1012.
  if (
    ctx.action === 'V-MUNG' ||
    ctx.action === 'V-THROW' ||
    ctx.action === 'V-ATTACK'
  ) {
    if (munged) {
      ctx.tell("Haven't you done enough damage already?");
    } else {
      ctx.setGlobal?.('MIRROR-MUNG', true);
      // LUCKY=<> — Phase-2 zprob reads this; flipping it shifts LOSE-WEAPON to ~1/3.
      // 1actions.zil:1009.
      ctx.setGlobal?.('LUCKY', false);
      ctx.tell(
        'You have broken the mirror. I hope you have a seven years\' supply of\n' +
        'good luck handy.',
      );
    }
    return true;
  }

  return false;
};

/** ACTION routines for the mirror region. */
export const mirrorActions: Record<string, ActionHandler> = {
  'MIRROR-ROOM':    mirrorRoomFcn,
  'MIRROR-MIRROR':  mirrorMirrorFcn,
};
