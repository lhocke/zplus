/**
 * Dam subsystem action routines — Phase 3b CB-DAM1.
 *
 * Hand-translations of ZIL routines from 1actions.zil (dam/reservoir section).
 *
 * CB-DAM1 scope: BOLT-F, DAM-ROOM-FCN, DAM-FUNCTION, BUBBLE-F.
 * Clock entries I-RFILL and I-REMPTY are registered (parked) in bootstrap.ts
 * and armed here by BOLT-F.
 *
 * ZIL source refs:
 *   BOLT-F         1actions.zil:1187–1217
 *   DAM-ROOM-FCN   1actions.zil:1156–1185
 *   DAM-FUNCTION   1actions.zil:1400–1410
 *   BUBBLE-F       1actions.zil:1219–1221
 *   INTEGRAL-PART  1actions.zil:1223–1224
 */

import type { ActionHandler } from '../domain/game-object.js';
import { Flag } from '../domain/flags.js';
import { M_LOOK } from '../engine/messages.js';

// ---------------------------------------------------------------------------
// INTEGRAL-PART — 1actions.zil:1223
// Shared by BOLT-F and BUBBLE-F: object is part of the control panel.
// ---------------------------------------------------------------------------

function integralPart(ctx: Parameters<ActionHandler>[0]): ReturnType<ActionHandler> {
  ctx.tell('It is an integral part of the control panel.');
  return true;
}

// ---------------------------------------------------------------------------
// BUBBLE-F — 1actions.zil:1219
// ---------------------------------------------------------------------------

export const bubbleFcn: ActionHandler = (ctx) => {
  if (ctx.verb === 'take') return integralPart(ctx);
  return false;
};

// ---------------------------------------------------------------------------
// BOLT-F — 1actions.zil:1187
// ---------------------------------------------------------------------------

export const boltF: ActionHandler = (ctx) => {
  if (ctx.verb === 'turn') {
    const wrench = ctx.world.get('WRENCH');
    if (ctx.iobj !== wrench) {
      // "The bolt won't turn using the <prsi>." — :1210
      const prsiDesc = ctx.iobj?.desc ?? 'that';
      ctx.tell(`The bolt won't turn using the ${prsiDesc}.`);
      return true;
    }

    if (!ctx.getGlobal?.('GATE-FLAG')) {
      // Control panel not unlocked — :1207
      ctx.tell("The bolt won't turn with your best effort.");
      return true;
    }

    // Panel unlocked: toggle the sluice gates — :1191
    const resSouth = ctx.world.get('RESERVOIR-SOUTH');
    if (resSouth) ctx.clearFlag(resSouth, Flag.Touched);

    if (ctx.getGlobal?.('GATES-OPEN')) {
      // Closing — :1192
      ctx.setGlobal?.('GATES-OPEN', false);
      const loudRoom = ctx.world.get('LOUD-ROOM');
      if (loudRoom) ctx.clearFlag(loudRoom, Flag.Touched);
      ctx.tell('The sluice gates close and water starts to collect behind the dam.');
      // ENABLE <QUEUE I-RFILL 8> + <QUEUE I-REMPTY 0> (park)
      ctx.queueClock?.('I-RFILL', 8, true);
      ctx.queueClock?.('I-REMPTY', 0, false);
    } else {
      // Opening — :1200
      ctx.setGlobal?.('GATES-OPEN', true);
      ctx.tell('The sluice gates open and water pours through the dam.');
      // ENABLE <QUEUE I-REMPTY 8> + <QUEUE I-RFILL 0> (park)
      ctx.queueClock?.('I-REMPTY', 8, true);
      ctx.queueClock?.('I-RFILL', 0, false);
    }
    return true;
  }

  if (ctx.verb === 'take') return integralPart(ctx);

  // ZIL <VERB? OIL> — "oil" canonicalises to "lubricate" in the port's verb table.
  if (ctx.verb === 'lubricate') {
    // :1215 — "Hmm. It appears the tube contained glue, not oil."
    ctx.tell(
      "Hmm. It appears the tube contained glue, not oil. Turning the bolt\nwon't get any easier....",
    );
    return true;
  }

  return false;
};

// ---------------------------------------------------------------------------
// DAM-ROOM-FCN — 1actions.zil:1156
//
// M-LOOK: the base location paragraph, then one of 4 water-level descriptions,
// then the control-panel line with optional "glowing serenely" bubble suffix.
// ---------------------------------------------------------------------------

export const damRoomFcn: ActionHandler = (ctx) => {
  if (ctx.rarg !== M_LOOK) return false;

  // Base paragraph — :1158
  ctx.tell(
    'You are standing on the top of the Flood Control Dam #3, which was\n' +
    'quite a tourist attraction in times far distant. There are paths to\n' +
    'the north, south, and west, and a scramble down.',
  );

  const gatesOpen = ctx.getGlobal?.('GATES-OPEN') ?? false;
  const lowTide   = ctx.getGlobal?.('LOW-TIDE')   ?? false;

  if (lowTide && gatesOpen) {
    // :1163 — S3 drained
    ctx.tell(
      'The water level behind the dam is low: The sluice gates have been\n' +
      'opened. Water rushes through the dam and downstream.',
    );
  } else if (gatesOpen) {
    // :1167 — S2 draining
    ctx.tell(
      'The sluice gates are open, and water rushes through the dam. The\n' +
      'water level behind the dam is still high.',
    );
  } else if (lowTide) {
    // :1171 — S4 refilling
    ctx.tell(
      'The sluice gates are closed. The water level in the reservoir is\n' +
      'quite low, but the level is rising quickly.',
    );
  } else {
    // :1175 — S0 sealed (default)
    ctx.tell(
      'The sluice gates on the dam are closed. Behind the dam, there can be\n' +
      'seen a wide reservoir. Water is pouring over the top of the now\n' +
      'abandoned dam.',
    );
  }

  // Control panel + bubble — :1179
  const gateFlag = ctx.getGlobal?.('GATE-FLAG') ?? false;
  const bubbleSuffix = gateFlag ? ' which is\nglowing serenely' : '';
  ctx.tell(
    'There is a control panel here, on which a large metal bolt is mounted.\n' +
    `Directly above the bolt is a small green plastic bubble${bubbleSuffix}.`,
  );

  return true;
};

// ---------------------------------------------------------------------------
// DAM-FUNCTION — 1actions.zil:1400
// Joke responses for OPEN/CLOSE/PLUG the dam itself.
// ---------------------------------------------------------------------------

export const damFunction: ActionHandler = (ctx) => {
  if (ctx.verb === 'open' || ctx.verb === 'close') {
    ctx.tell("Sounds reasonable, but this isn't how.");
    return true;
  }

  if (ctx.verb === 'plug') {
    const hands = ctx.world.get('HANDS');
    if (ctx.iobj === undefined || ctx.iobj === hands) {
      // :1404
      ctx.tell('Are you the little Dutch boy, then? Sorry, this is a big dam.');
    } else {
      // :1407 — "With a <prsi>? Do you know how big this dam is?"
      const prsiDesc = ctx.iobj.desc;
      ctx.tell(
        `With a ${prsiDesc}? Do you know how big this dam is? You could only\n` +
        'stop a tiny leak with that.',
      );
    }
    return true;
  }

  return false;
};

export const damActions: Record<string, ActionHandler> = {
  'BOLT-F':        boltF,
  'DAM-ROOM-FCN':  damRoomFcn,
  'DAM-FUNCTION':  damFunction,
  'BUBBLE-F':      bubbleFcn,
};
