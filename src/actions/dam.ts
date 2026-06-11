/**
 * Dam subsystem action routines — Phase 3b CB-DAM1 through CB-DAM4.
 *
 * Hand-translations of ZIL routines from 1actions.zil (dam/reservoir section).
 *
 * CB-DAM1 scope: BOLT-F, DAM-ROOM-FCN, DAM-FUNCTION, BUBBLE-F.
 * CB-DAM4 scope: RESERVOIR-SOUTH-FCN, RESERVOIR-FCN, RESERVOIR-NORTH-FCN, DEEP-CANYON-F.
 *
 * ZIL source refs:
 *   BOLT-F               1actions.zil:1187–1217
 *   DAM-ROOM-FCN         1actions.zil:1156–1185
 *   DAM-FUNCTION         1actions.zil:1400–1410
 *   BUBBLE-F             1actions.zil:1219–1221
 *   INTEGRAL-PART        1actions.zil:1223–1224
 *   RESERVOIR-SOUTH-FCN  1actions.zil:1415–1442
 *   RESERVOIR-FCN        1actions.zil:1444–1462
 *   RESERVOIR-NORTH-FCN  1actions.zil:1464–1485
 *   DEEP-CANYON-F        1actions.zil:1730–1745
 */

import type { ActionHandler } from '../domain/game-object.js';
import { Flag } from '../domain/flags.js';
import { M_LOOK, M_END } from '../engine/messages.js';

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

// ---------------------------------------------------------------------------
// BUTTON-F — 1actions.zil:1298–1330
//
// READ any button: "They're greek to you."
// PUSH:
//   BLUE   — if WATER-LEVEL==0: start leak, arm I-MAINT-ROOM. else "jammed".
//   RED    — toggle MAINTENANCE-ROOM ONBIT (lights on/off).
//   BROWN  — GATE-FLAG=false + clear DAM-ROOM TOUCHBIT + "Click."
//   YELLOW — GATE-FLAG=true  + clear DAM-ROOM TOUCHBIT + "Click."
// ---------------------------------------------------------------------------

export const buttonF: ActionHandler = (ctx) => {
  if (ctx.verb === 'read') {
    ctx.tell("They're greek to you.");
    return true;
  }

  if (ctx.verb !== 'push') return false;

  const id = ctx.self.id;

  if (id === 'BLUE-BUTTON') {
    const wl = ctx.getIntGlobal?.('WATER-LEVEL') ?? 0;
    if (wl === 0) {
      // :1304 — reveal the leak
      const leak = ctx.world.get('LEAK');
      if (leak) ctx.clearFlag(leak, Flag.Invisible);
      ctx.tell(
        'There is a rumbling sound and a stream of water appears to burst\n' +
        'from the east wall of the room (apparently, a leak has occurred in a\n' +
        'pipe).',
      );
      ctx.setIntGlobal?.('WATER-LEVEL', 1);
      // :1310 — ENABLE <QUEUE I-MAINT-ROOM -1> (every-turn demon)
      ctx.queueClock?.('I-MAINT-ROOM', -1, true);
    } else {
      // :1313 — already leaking or repaired
      ctx.tell('The blue button appears to be jammed.');
    }
    return true;
  }

  if (id === 'RED-BUTTON') {
    // :1315 — toggle ONBIT on HERE (lights).
    // ZIL uses two no-CR TELLs that concatenate inline; port merges into one call
    // so the joined-output path doesn't insert a newline between the two halves.
    if (ctx.hasFlag(ctx.here, Flag.On)) {
      ctx.clearFlag(ctx.here, Flag.On);
      ctx.tell('The lights within the room shut off.');
    } else {
      ctx.setFlag(ctx.here, Flag.On);
      ctx.tell('The lights within the room come on.');
    }
    return true;
  }

  if (id === 'BROWN-BUTTON') {
    // :1323
    const damRoom = ctx.world.get('DAM-ROOM');
    if (damRoom) ctx.clearFlag(damRoom, Flag.Touched);
    ctx.setGlobal?.('GATE-FLAG', false);
    ctx.tell('Click.');
    return true;
  }

  if (id === 'YELLOW-BUTTON') {
    // :1327
    const damRoom = ctx.world.get('DAM-ROOM');
    if (damRoom) ctx.clearFlag(damRoom, Flag.Touched);
    ctx.setGlobal?.('GATE-FLAG', true);
    ctx.tell('Click.');
    return true;
  }

  return false;
};

// ---------------------------------------------------------------------------
// LEAK-FUNCTION — 1actions.zil:1362–1370
//
// Only acts when WATER-LEVEL > 0 (active leak).
// PUT/PUT-ON PUTTY  or  PLUG LEAK WITH PUTTY → FIX-MAINT-LEAK.
// PLUG with other PRSI → WITH-TELL "With a <prsi>?"
// ---------------------------------------------------------------------------

function fixMaintLeak(ctx: Parameters<ActionHandler>[0]): void {
  // 1actions.zil:1372–1377
  ctx.setIntGlobal?.('WATER-LEVEL', -1);
  ctx.queueClock?.('I-MAINT-ROOM', 0, false);   // park the demon
  ctx.tell(
    'By some miracle of Zorkian technology, you have managed to stop the\n' +
    'leak in the dam.',
  );
}

export const leakFunction: ActionHandler = (ctx) => {
  const wl = ctx.getIntGlobal?.('WATER-LEVEL') ?? 0;
  if (wl <= 0) return false;  // no active leak — ignore

  const putty = ctx.world.get('PUTTY');

  // PUT PUTTY [ON LEAK] or PUT-ON PUTTY → PRSO==PUTTY check (:1364)
  if ((ctx.verb === 'put' || ctx.verb === 'put-on') && ctx.dobj === putty) {
    fixMaintLeak(ctx);
    return true;
  }

  // PLUG [LEAK] WITH <PRSI> (:1367)
  if (ctx.verb === 'plug') {
    if (ctx.iobj === putty) {
      fixMaintLeak(ctx);
      return true;
    }
    // WITH-TELL: "With a <prsi>?" — :1370
    const prsiDesc = ctx.iobj?.desc ?? 'that';
    ctx.tell(`With a ${prsiDesc}?`);
    return true;
  }

  return false;
};

// ---------------------------------------------------------------------------
// PUTTY-FCN — 1actions.zil:1379–1384
//
// (VERB? OIL)(EQUAL? PRSI PUTTY) → "all-purpose gunk isn't a lubricant."
// (VERB? PUT)(EQUAL? PRSO PUTTY) → same message (wrong target).
// ---------------------------------------------------------------------------

export const puttyFcn: ActionHandler = (ctx) => {
  const putty = ctx.self;

  // OIL <something> WITH PUTTY — putty as iobj
  if (ctx.verb === 'lubricate' && ctx.iobj === putty) {
    ctx.tell("The all-purpose gunk isn't a lubricant.");
    return true;
  }

  // PUT PUTTY (bare put, putty is dobj) — not the normal use; reject
  if (ctx.verb === 'put' && ctx.dobj === putty && ctx.iobj === undefined) {
    ctx.tell("The all-purpose gunk isn't a lubricant.");
    return true;
  }

  return false;
};

// ---------------------------------------------------------------------------
// TUBE-FUNCTION — 1actions.zil:1386–1398
//
// PUT <something> IN TUBE → "refuses to accept anything."
// SQUEEZE TUBE:
//   open + putty inside   → move putty to winner, "oozes into your hand."
//   open, empty            → "The tube is apparently empty."
//   closed                 → "The tube is closed."
// ---------------------------------------------------------------------------

export const tubeFunction: ActionHandler = (ctx) => {
  const tube = ctx.self;

  // :1387 — <VERB? PUT> matches only the PUT action (put X in Y), not PUT-ON (put X on Y).
  // In the port both share verb='put'; distinguish by prep: 'IN' = V-PUT, 'ON' = V-PUT-ON.
  // Let PUT-ON fall through to verbPutOn (no-surface message).
  if (ctx.verb === 'put' && ctx.prep !== 'ON' && ctx.iobj === tube) {
    ctx.tell('The tube refuses to accept anything.');
    return true;
  }

  // :1390 — SQUEEZE TUBE
  if (ctx.verb === 'squeeze') {
    const isOpen = ctx.hasFlag(tube, Flag.Open);
    if (isOpen) {
      // Find putty inside the tube
      const putty = ctx.world.get('PUTTY');
      if (putty !== undefined && putty.parent === tube) {
        // :1393
        putty.moveTo(ctx.actor);
        ctx.tell('The viscous material oozes into your hand.');
      } else {
        // :1395 — open but empty
        ctx.tell('The tube is apparently empty.');
      }
    } else {
      // :1397 — closed
      ctx.tell('The tube is closed.');
    }
    return true;
  }

  return false;
};

// ---------------------------------------------------------------------------
// TOOL-CHEST-FCN — 1actions.zil:1332–1341
//
// EXAMINE → "The chests are all empty."
// TAKE/OPEN/PUT → remove chest, print crumble message.
// ---------------------------------------------------------------------------

export const toolChestFcn: ActionHandler = (ctx) => {
  if (ctx.verb === 'examine') {
    ctx.tell('The chests are all empty.');
    return true;
  }

  if (ctx.verb === 'take' || ctx.verb === 'open' || ctx.verb === 'put') {
    ctx.self.moveTo(null);   // REMOVE-CAREFULLY — chest crumbles
    ctx.tell(
      'The chests are so rusty and corroded that they crumble when you\n' +
      'touch them.',
    );
    return true;
  }

  return false;
};

// ---------------------------------------------------------------------------
// RESERVOIR-SOUTH-FCN — 1actions.zil:1415–1442
//
// M-LOOK: one of 4 water-level descriptions, then the fixed exit paragraph.
// ---------------------------------------------------------------------------

export const reservoirSouthFcn: ActionHandler = (ctx) => {
  if (ctx.rarg !== M_LOOK) return false;

  const gatesOpen = ctx.getGlobal?.('GATES-OPEN') ?? false;
  const lowTide   = ctx.getGlobal?.('LOW-TIDE')   ?? false;

  if (lowTide && gatesOpen) {
    // :1417 — S3 drained
    ctx.tell(
      'You are in a long room, to the north of which was formerly a lake.\n' +
      'However, with the water level lowered, there is merely a wide stream\n' +
      'running through the center of the room.',
    );
  } else if (gatesOpen) {
    // :1422 — S2 draining
    ctx.tell(
      'You are in a long room. To the north is a large lake, too deep\n' +
      'to cross. You notice, however, that the water level appears to be\n' +
      'dropping at a rapid rate. Before long, it might be possible to cross\n' +
      'to the other side from here.',
    );
  } else if (lowTide) {
    // :1428 — S4 refilling
    ctx.tell(
      'You are in a long room, to the north of which is a wide area which\n' +
      'was formerly a reservoir, but now is merely a stream. You notice,\n' +
      'however, that the level of the stream is rising quickly and that\n' +
      'before long it will be impossible to cross here.',
    );
  } else {
    // :1434 — S0 sealed (default)
    ctx.tell(
      'You are in a long room on the south shore of a large lake, far\n' +
      'too deep and wide for crossing.',
    );
  }

  // Fixed exit paragraph — :1439
  ctx.tell(
    'There is a path along the stream to the east or west, a steep pathway\n' +
    'climbing southwest along the edge of a chasm, and a path leading into a\n' +
    'canyon to the southeast.',
  );

  return true;
};

// ---------------------------------------------------------------------------
// RESERVOIR-FCN — 1actions.zil:1444–1462
//
// M-END: peril nag when player is on-foot, gates sealed, reservoir drained.
// M-LOOK: mud-pile (drained) or lake (full) description.
// ---------------------------------------------------------------------------

export const reservoirFcn: ActionHandler = (ctx) => {
  if (ctx.rarg === M_END) {
    // :1445 — fire if: winner not in a VEHBIT vehicle AND !GATES-OPEN AND LOW-TIDE
    const inVehicle = ctx.actor.parent !== null && ctx.actor.parent.has(Flag.Vehicle);
    const gatesOpen = ctx.getGlobal?.('GATES-OPEN') ?? false;
    const lowTide   = ctx.getGlobal?.('LOW-TIDE')   ?? false;
    if (!inVehicle && !gatesOpen && lowTide) {
      ctx.tell(
        'You notice that the water level here is rising rapidly. The currents\n' +
        'are also becoming stronger. Staying here seems quite perilous!',
      );
    }
    return false;  // M-END handlers return false to continue the chain
  }

  if (ctx.rarg === M_LOOK) {
    const lowTide = ctx.getGlobal?.('LOW-TIDE') ?? false;
    if (lowTide) {
      // :1453 — drained: mud pile
      ctx.tell(
        'You are on what used to be a large lake, but which is now a large\n' +
        'mud pile. There are "shores" to the north and south.',
      );
    } else {
      // :1457 — filled: lake
      ctx.tell(
        'You are on the lake. Beaches can be seen north and south.\n' +
        'Upstream a small stream enters the lake through a narrow cleft\n' +
        'in the rocks. The dam can be seen downstream.',
      );
    }
    return true;
  }

  return false;
};

// ---------------------------------------------------------------------------
// RESERVOIR-NORTH-FCN — 1actions.zil:1464–1485
//
// M-LOOK: one of 4 water-level descriptions, then the fixed stairway line.
// ---------------------------------------------------------------------------

export const reservoirNorthFcn: ActionHandler = (ctx) => {
  if (ctx.rarg !== M_LOOK) return false;

  const gatesOpen = ctx.getGlobal?.('GATES-OPEN') ?? false;
  const lowTide   = ctx.getGlobal?.('LOW-TIDE')   ?? false;

  if (lowTide && gatesOpen) {
    // :1466 — S3 drained
    ctx.tell(
      'You are in a large cavernous room, the south of which was formerly\n' +
      'a lake. However, with the water level lowered, there is merely\n' +
      'a wide stream running through there.',
    );
  } else if (gatesOpen) {
    // :1471 — S2 draining
    ctx.tell(
      'You are in a large cavernous area. To the south is a wide lake,\n' +
      'whose water level appears to be falling rapidly.',
    );
  } else if (lowTide) {
    // :1475 — S4 refilling
    ctx.tell(
      'You are in a cavernous area, to the south of which is a very wide\n' +
      'stream. The level of the stream is rising rapidly, and it appears\n' +
      'that before long it will be impossible to cross to the other side.',
    );
  } else {
    // :1480 — S0 sealed (default)
    ctx.tell(
      'You are in a large cavernous room, north of a large lake.',
    );
  }

  // Fixed exit line — :1483
  ctx.tell('There is a slimy stairway leaving the room to the north.');

  return true;
};

// ---------------------------------------------------------------------------
// DEEP-CANYON-F — 1actions.zil:1730–1745
//
// M-LOOK: base text + water-sound suffix determined by the gate/tide flags.
//   GATES-OPEN && !LOW-TIDE  → "loud roaring sound, like that of rushing water"
//   !GATES-OPEN && LOW-TIDE  → no suffix (gates sealed, reservoir drained = quiet)
//   else                     → "sound of flowing water from below"
// ---------------------------------------------------------------------------

export const deepCanyonF: ActionHandler = (ctx) => {
  if (ctx.rarg !== M_LOOK) return false;

  // Base text — :1732
  ctx.tell(
    'You are on the south edge of a deep canyon. Passages lead off to the\n' +
    'east, northwest and southwest. A stairway leads down.',
  );

  const gatesOpen = ctx.getGlobal?.('GATES-OPEN') ?? false;
  const lowTide   = ctx.getGlobal?.('LOW-TIDE')   ?? false;

  if (gatesOpen && !lowTide) {
    // :1735 — gates open, water rushing = loud roar
    ctx.tell(
      ' You can hear a loud roaring sound, like that of rushing water, from\n' +
      'below.',
    );
  } else if (!gatesOpen && lowTide) {
    // :1739 — gates sealed, reservoir drained = quiet (no suffix)
    return true;
  } else {
    // :1742 — default: soft flow sound
    ctx.tell(' You can hear the sound of flowing water from below.');
  }

  return true;
};

export const damActions: Record<string, ActionHandler> = {
  'BOLT-F':               boltF,
  'DAM-ROOM-FCN':         damRoomFcn,
  'DAM-FUNCTION':         damFunction,
  'BUBBLE-F':             bubbleFcn,
  'BUTTON-F':             buttonF,
  'LEAK-FUNCTION':        leakFunction,
  'PUTTY-FCN':            puttyFcn,
  'TUBE-FUNCTION':        tubeFunction,
  'TOOL-CHEST-FCN':       toolChestFcn,
  'RESERVOIR-SOUTH-FCN':  reservoirSouthFcn,
  'RESERVOIR-FCN':        reservoirFcn,
  'RESERVOIR-NORTH-FCN':  reservoirNorthFcn,
  'DEEP-CANYON-F':        deepCanyonF,
};
