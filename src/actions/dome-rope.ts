/**
 * Dome / rope region action routines — CC2.
 *
 * Hand-translations of ZIL routines from the "SUBTITLE THE DOME" section of
 * zil/1actions.zil:1018–1050, plus the ROPE-FUNCTION at :3030–3078.
 *
 *   ROPE-FUNCTION    1actions.zil:3030  — object FCN on ROPE
 *   DOME-ROOM-FCN    1actions.zil:1030  — room FCN for DOME-ROOM
 *   TORCH-ROOM-FCN   1actions.zil:1018  — room FCN for TORCH-ROOM
 *
 * Global flag:
 *   DOME-FLAG — true when the rope is tied to the railing; gates the down
 *               exit from DOME-ROOM (rooms.json ifFlag:"DOME-FLAG") and
 *               controls the conditional rope-descend text.
 *
 * TIE seam (spec §4.3): ROPE-FUNCTION runs at PERFORM step 6 (PRSO P?ACTION)
 * for any command where ROPE is the direct object — BEFORE the V-TIE default
 * (step 7). It returns true (RTRUE) to suppress the default.
 */

import type { ActionHandler } from '../domain/game-object.js';
import type { Room } from '../domain/room.js';
import { M_ENTER, M_LOOK } from '../engine/messages.js';

// ---------------------------------------------------------------------------
// TORCH-ROOM-FCN — 1actions.zil:1018–1028
// ---------------------------------------------------------------------------

export const torchRoomFcn: ActionHandler = (ctx) => {
  if (ctx.rarg !== M_LOOK) return false;

  ctx.tell(
    'This is a large room with a prominent doorway leading to a down ' +
    'staircase. Above you is a large dome. Up around the edge of the ' +
    'dome (20 feet up) is a wooden railing. In the center of the room ' +
    'sits a white marble pedestal.',
  );

  // Rope-descend line: only when DOME-FLAG is set (rope tied at the railing above).
  if (ctx.getGlobal?.('DOME-FLAG')) {
    ctx.tell(
      'A piece of rope descends from the railing above, ending some ' +
      'five feet above your head.',
    );
  }

  return true;
};

// ---------------------------------------------------------------------------
// DOME-ROOM-FCN — 1actions.zil:1030–1050
// ---------------------------------------------------------------------------

export const domeRoomFcn: ActionHandler = (ctx) => {
  if (ctx.rarg === M_LOOK) {
    ctx.tell(
      'You are at the periphery of a large dome, which forms the ceiling ' +
      'of another room below. Protecting you from a precipitous drop is a ' +
      'wooden railing which circles the dome.',
    );

    // Rope-hanging line when the rope is tied to the railing.
    if (ctx.getGlobal?.('DOME-FLAG')) {
      ctx.tell(
        'Hanging down from the railing is a rope which ends about ten feet ' +
        'from the floor below.',
      );
    }

    return true;
  }

  if (ctx.rarg === M_ENTER) {
    // Dead player: pulled over railing and down to TORCH-ROOM.
    // 1actions.zil:1041–1047
    if (ctx.isDead?.()) {
      ctx.tell(
        'As you enter the dome you feel a strong pull as if from a wind ' +
        'drawing you over the railing and down.',
      );
      const torchRoom = ctx.world.get('TORCH-ROOM') as Room | undefined;
      if (torchRoom !== undefined) {
        ctx.actor.moveTo(torchRoom);
      }
      return true;
    }

    // LEAP into the dome → death. 1actions.zil:1048–1050
    if (ctx.action === 'V-LEAP') {
      ctx.jigsUp?.('I\'m afraid that the leap you attempted has done you in.');
      return true;
    }

    return false;
  }

  return false;
};

// ---------------------------------------------------------------------------
// ROPE-FUNCTION — 1actions.zil:3030–3078
//
// Runs as the object FCN on ROPE for any PERFORM where ROPE is PRSO.
// This is PERFORM step 6 — before the V-TIE default (step 7).
// ---------------------------------------------------------------------------

export const ropeFunction: ActionHandler = (ctx) => {
  const domeFlag = ctx.getGlobal?.('DOME-FLAG') ?? false;

  // Not in DOME-ROOM — rope can't be tied to anything meaningful.
  // 1actions.zil:3031–3034
  if (ctx.here.id !== 'DOME-ROOM') {
    ctx.setGlobal?.('DOME-FLAG', false);
    if (ctx.action === 'V-TIE') {
      ctx.tell("You can't tie the rope to that.");
      return true;
    }
    return false;
  }

  // --- All remaining branches require HERE == DOME-ROOM ---

  // V-TIE: tie rope to railing (PRSI == RAILING).
  // 1actions.zil:3035–3049
  if (ctx.action === 'V-TIE') {
    const railing = ctx.world.get('RAILING');
    if (ctx.iobj !== undefined && ctx.iobj === railing) {
      if (domeFlag) {
        ctx.tell('The rope is already tied to it.');
      } else {
        ctx.tell(
          'The rope drops over the side and comes within ten feet of the floor.',
        );
        ctx.setGlobal?.('DOME-FLAG', true);
        // FSET ROPE NDESCBIT: rope becomes non-descript (tied to railing).
        // Also move rope to DOME-ROOM if it's somewhere else.
        const rope = ctx.self;
        const rloc = rope.parent;
        if (rloc === null || rloc === undefined || rloc.id === 'PLAYER') {
          rope.moveTo(ctx.here);
        }
      }
    } else {
      ctx.tell("You can't tie the rope to that.");
    }
    return true;
  }

  // V-CLIMB-DOWN: climb down the rope — DO-WALK DOWN. 1actions.zil:3050–3051
  if ((ctx.action === 'V-CLIMB-DOWN' || ctx.action === 'V-CLIMB-FOO') &&
      domeFlag) {
    // Rope or bare climb-down with DOME-FLAG: descend to TORCH-ROOM.
    // DO-WALK P?DOWN: verbGo handles the actual descent via the rooms.json ifFlag exit.
    // The exit already gates on DOME-FLAG — just let V-WALK run by returning false.
    return false;
  }

  // V-TIE-UP: attempt to tie something to the rope. 1actions.zil:3052–3063
  if (ctx.action === 'V-TIE-UP') {
    const prso = ctx.dobj;
    if (prso !== undefined) {
      ctx.tell(`Why would you tie up a ${prso.desc}?`);
    }
    return true;
  }

  // V-UNTIE: untie the rope. 1actions.zil:3064–3070
  if (ctx.action === 'V-UNTIE') {
    if (domeFlag) {
      ctx.setGlobal?.('DOME-FLAG', false);
      ctx.tell('The rope is now untied.');
    } else {
      ctx.tell('It is not tied to anything.');
    }
    return true;
  }

  // V-DROP: drop rope in DOME-ROOM when not tied. 1actions.zil:3071–3075
  if (ctx.action === 'V-DROP') {
    if (!domeFlag) {
      const torchRoom = ctx.world.get('TORCH-ROOM');
      if (torchRoom !== undefined) ctx.self.moveTo(torchRoom);
      ctx.tell('The rope drops gently to the floor below.');
      return true;
    }
    return false;
  }

  // V-TAKE: can't take the rope when it's tied. 1actions.zil:3076–3078
  if (ctx.action === 'V-TAKE') {
    if (domeFlag) {
      ctx.tell('The rope is tied to the railing.');
      return true;
    }
    return false;
  }

  return false;
};

/** ACTION routines for the dome/rope region. */
export const domeRopeActions: Record<string, ActionHandler> = {
  'ROPE-FUNCTION':  ropeFunction,
  'DOME-ROOM-FCN':  domeRoomFcn,
  'TORCH-ROOM-FCN': torchRoomFcn,
};
