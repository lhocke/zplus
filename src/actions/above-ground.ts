/**
 * Above-ground region action routines.
 *
 * Each entry is a hand-translation of a ZIL ACTION/PER routine from
 * 1actions.zil under "SUBTITLE THE WHITE HOUSE" and the surrounding forest
 * sections.  Handlers follow the dispatch contract in src/domain/game-object.ts:
 *
 *   - Object/room ACTION routines are `ActionHandler`s returning HandlerResult
 *     (true = ZIL RTRUE → suppress the remaining dispatch steps).
 *   - PER routines (exit-resolution functions) are `PerRoutine`s returning the
 *     destination room id, mirroring a ZIL routine that returns a room object.
 *
 * This file is the seed of the per-region pattern: registry.ts imports the
 * exported maps below and merges them into one lookup keyed by ZIL routine name.
 */

import type { ActionHandler } from '../domain/game-object.js';
import { Flag } from '../domain/flags.js';
import { M_LOOK, M_ENTER } from '../engine/messages.js';
import type { PerRoutine } from './registry.js';
import { pick, dummy, type PickRng } from '../engine/game-messages.js';

// ---------------------------------------------------------------------------
// Local helper: pick from a PICK-ONE table with optional RNG.
// When no RNG is available (test contexts), falls back to the first entry.
// ---------------------------------------------------------------------------

function pickDummy(rng: PickRng | undefined): string {
  if (rng !== undefined) return pick(dummy, rng);
  return dummy.entries[0] ?? 'Look around.';
}

// ---------------------------------------------------------------------------
// Module-level state — mirrors ZIL GLOBAL variables for this region.
// ---------------------------------------------------------------------------

/**
 * KITCHEN-WINDOW-FLAG — ZIL <GLOBAL KITCHEN-WINDOW-FLAG <>> (1actions.zil:239).
 * Set the first time the player opens or closes the kitchen window, enabling
 * normal EXAMINE text instead of the "slightly ajar" description.
 */
let kitchenWindowFlag = false;

/** Reset for test isolation. */
export function resetKitchenWindowFlag(): void {
  kitchenWindowFlag = false;
}

/**
 * RUG-MOVED — ZIL <GLOBAL RUG-MOVED <>> (1actions.zil:447).
 * True after the player has moved the oriental rug, revealing the trap door.
 */
let rugMoved = false;

/** Reset for test isolation. */
export function resetRugMoved(): void {
  rugMoved = false;
}

/**
 * GRATE-REVEALED — ZIL <GLOBAL GRATE-REVEALED <>> (1actions.zil:771).
 * True after the pile of leaves has been disturbed and the grate revealed.
 */
let grateRevealed = false;

/** Reset for test isolation. */
export function resetGrateRevealed(): void {
  grateRevealed = false;
}

/**
 * GRUNLOCK — ZIL <GLOBAL GRUNLOCK <>> (1actions.zil:772).
 * True when the grating has been unlocked with the keys.
 */
let grunlock = false;

/** Reset for test isolation. */
export function resetGrunlock(): void {
  grunlock = false;
}

/**
 * SING-SONG — ZIL <GLOBAL SING-SONG <>> (1actions.zil:2968).
 * True after the canary has been wound and summoned the songbird (once only).
 */
let singSong = false;

/** Reset for test isolation. */
export function resetSingSong(): void {
  singSong = false;
}

// ---------------------------------------------------------------------------
// Room ACTION routines (branch on ctx.rarg).
// ---------------------------------------------------------------------------

/**
 * WEST-HOUSE — the WEST-OF-HOUSE room action (zil/1actions.zil:7).
 *
 * M-LOOK prints the field description and appends the secret-path note when
 * WON-FLAG has been touched (post-endgame).
 */
export const westHouse: ActionHandler = (ctx) => {
  if (ctx.rarg === M_LOOK) {
    let text =
      'You are standing in an open field west of a white house, with a boarded\n' +
      'front door.';
    const wonFlag = ctx.world.get('WON-FLAG');
    if (wonFlag !== undefined && ctx.hasFlag(wonFlag, Flag.Touched)) {
      text += ' A secret path leads southwest into the forest.';
    }
    ctx.tell(text);
    return true;
  }
  return false;
};

/**
 * EAST-HOUSE — the EAST-OF-HOUSE (Behind House) room action (zil/1actions.zil:17).
 *
 * M-LOOK prints the rear-of-house description, noting the window state.
 */
export const eastHouse: ActionHandler = (ctx) => {
  if (ctx.rarg === M_LOOK) {
    const window = ctx.world.get('KITCHEN-WINDOW');
    const open = window !== undefined && ctx.hasFlag(window, Flag.Open);
    ctx.tell(
      'You are behind the white house. A path leads into the forest\n' +
        'to the east. In one corner of the house there is a small window\n' +
        'which is ' +
        (open ? 'open.' : 'slightly ajar.'),
    );
    return true;
  }
  return false;
};

/**
 * KITCHEN-FCN — the KITCHEN room action (zil/1actions.zil:385).
 *
 * M-LOOK prints the kitchen description with current window state.
 * M-BEG intercepts "climb stairs" to redirect upward.
 */
export const kitchenFcn: ActionHandler = (ctx) => {
  if (ctx.rarg === M_LOOK) {
    const window = ctx.world.get('KITCHEN-WINDOW');
    const open = window !== undefined && ctx.hasFlag(window, Flag.Open);
    ctx.tell(
      'You are in the kitchen of the white house. A table seems to\n' +
        'have been used recently for the preparation of food. A passage\n' +
        'leads to the west and a dark staircase can be seen leading\n' +
        'upward. A dark chimney leads down and to the east is a small\n' +
        'window which is ' +
        (open ? 'open.' : 'slightly ajar.'),
    );
    return true;
  }
  return false;
};

/**
 * LIVING-ROOM-FCN — the LIVING-ROOM room action (zil/1actions.zil:449).
 *
 * M-LOOK produces the dynamic description that reflects the rug/trap-door state
 * and whether the cyclops has smashed the west door (MAGIC-FLAG).
 */
export const livingRoomFcn: ActionHandler = (ctx) => {
  if (ctx.rarg === M_LOOK) {
    const magicFlag = ctx.world.get('MAGIC-FLAG');
    const hasMagic = magicFlag !== undefined && ctx.hasFlag(magicFlag, Flag.Touched);
    const trapDoor = ctx.world.get('TRAP-DOOR');
    const trapOpen = trapDoor !== undefined && ctx.hasFlag(trapDoor, Flag.Open);

    let text = 'You are in the living room. There is a doorway to the east';
    if (hasMagic) {
      text +=
        '. To the\nwest is a cyclops-shaped opening in an old wooden door, above which is\n' +
        'some strange gothic lettering, ';
    } else {
      text +=
        ', a wooden\ndoor with strange gothic lettering to the west, which appears to be\nnailed shut, ';
    }
    text += 'a trophy case, ';

    if (rugMoved && trapOpen) {
      text += 'and a rug lying beside an open trap door.';
    } else if (rugMoved) {
      text += 'and a closed trap door at your feet.';
    } else if (trapOpen) {
      text += 'and an open trap door at your feet.';
    } else {
      text += 'and a large oriental rug in the center of the room.';
    }

    ctx.tell(text);
    return true;
  }
  return false;
};

/**
 * CELLAR-FCN — the CELLAR room action (zil/1actions.zil:531).
 *
 * M-LOOK prints the cellar description.
 * M-ENTER: if the trap door is open and hasn't been touched (first descent),
 * crash it shut and bar it.
 */
export const cellarFcn: ActionHandler = (ctx) => {
  if (ctx.rarg === M_LOOK) {
    ctx.tell(
      'You are in a dark and damp cellar with a narrow passageway leading\n' +
        'north, and a crawlway to the south. On the west is the bottom of a\n' +
        'steep metal ramp which is unclimbable.',
    );
    return true;
  }
  if (ctx.rarg === M_ENTER) {
    const trapDoor = ctx.world.get('TRAP-DOOR');
    if (
      trapDoor !== undefined &&
      ctx.hasFlag(trapDoor, Flag.Open) &&
      !ctx.hasFlag(trapDoor, Flag.Touched)
    ) {
      ctx.clearFlag(trapDoor, Flag.Open);
      ctx.setFlag(trapDoor, Flag.Touched);
      ctx.tell(
        'The trap door crashes shut, and you hear someone barring it.',
      );
    }
    return false;
  }
  return false;
};

/**
 * CLEARING-FCN — the GRATING-CLEARING room action (zil/1actions.zil:815).
 *
 * M-ENTER: hide the grate if it hasn't been revealed yet.
 * M-LOOK: print the clearing description with grate state.
 */
export const clearingFcn: ActionHandler = (ctx) => {
  if (ctx.rarg === M_ENTER) {
    if (!grateRevealed) {
      const grate = ctx.world.get('GRATE');
      if (grate !== undefined) ctx.setFlag(grate, Flag.Invisible);
    }
    return false;
  }
  if (ctx.rarg === M_LOOK) {
    const grate = ctx.world.get('GRATE');
    const grateOpen = grate !== undefined && ctx.hasFlag(grate, Flag.Open);
    let text =
      'You are in a clearing, with a forest surrounding you on all sides. A\npath leads south.';
    if (grateOpen) {
      text += '\nThere is an open grating, descending into darkness.';
    } else if (grateRevealed) {
      text += '\nThere is a grating securely fastened into the ground.';
    }
    ctx.tell(text);
    return true;
  }
  return false;
};

/**
 * MAZE-11-FCN — the room near the grating maze exit (zil/1actions.zil:833).
 *
 * M-ENTER: make the grate visible.
 * M-LOOK: describe with grate lock state.
 */
export const maze11Fcn: ActionHandler = (ctx) => {
  if (ctx.rarg === M_ENTER) {
    const grate = ctx.world.get('GRATE');
    if (grate !== undefined) ctx.clearFlag(grate, Flag.Invisible);
    return false;
  }
  if (ctx.rarg === M_LOOK) {
    const grate = ctx.world.get('GRATE');
    const grateOpen = grate !== undefined && ctx.hasFlag(grate, Flag.Open);
    let text =
      'You are in a small room near the maze. There are twisty passages\nin the immediate vicinity.';
    if (grateOpen) {
      text += '\nAbove you is an open grating with sunlight pouring in.';
    } else if (grunlock) {
      text += '\nAbove you is a grating.';
    } else {
      text += '\nAbove you is a grating locked with a skull-and-crossbones lock.';
    }
    ctx.tell(text);
    return true;
  }
  return false;
};

/**
 * TREE-ROOM — the UP-A-TREE room action (zil/1actions.zil:2880).
 *
 * M-LOOK: print the branch description and list anything on the ground below.
 * M-BEG: intercept climb-down/climb-up; handle drop of nest/egg from the tree.
 * M-ENTER: enable the I-FOREST-ROOM songbird ambient clock entry.
 */
export const treeRoom: ActionHandler = (ctx) => {
  if (ctx.rarg === M_LOOK) {
    ctx.tell(
      'You are about 10 feet above the ground nestled among some large\n' +
        'branches. The nearest branch above you is above your reach.',
    );
    // Show anything visible on the ground at PATH.
    const path = ctx.world.get('PATH');
    if (path !== undefined) {
      const items = Array.from(path.children).filter(
        (o) => !ctx.hasFlag(o, Flag.Invisible),
      );
      if (items.length > 0) {
        ctx.tell(
          'On the ground below you can see:  ' + items.map((o) => o.desc).join(', ') + '.',
        );
      }
    }
    return true;
  }
  if (ctx.rarg === M_ENTER) {
    ctx.enableClock('I-FOREST-ROOM');
    return false;
  }
  return false;
};

/**
 * FOREST-ROOM — shared action for all above-ground forest rooms and PATH
 * (zil/1actions.zil:3004).
 *
 * M-BEG: intercept "climb tree" commands and redirect upward.
 * M-ENTER: enable the I-FOREST-ROOM songbird ambient clock entry.
 */
export const forestRoom: ActionHandler = (ctx) => {
  if (ctx.rarg === M_ENTER) {
    ctx.enableClock('I-FOREST-ROOM');
    return false;
  }
  if (ctx.rarg === M_LOOK) {
    // Rooms using FOREST-ROOM that have a static ldesc use the ldesc path;
    // rooms without (PATH, some clearings) need dynamic text. GRATING-CLEARING
    // has its own CLEARING-FCN; PATH's static ldesc is set in rooms.json.
    return false;
  }
  return false;
};

// ---------------------------------------------------------------------------
// Object ACTION routines (branch on ctx.verb).
// ---------------------------------------------------------------------------

/**
 * MAILBOX-F — the small mailbox's action (zil/1actions.zil:2259).
 *
 * The mailbox carries TAKEBIT; this intercepts TAKE on itself to refuse.
 */
export const mailboxF: ActionHandler = (ctx) => {
  if (ctx.verb === 'take' && ctx.dobj === ctx.self) {
    ctx.tell('It is securely anchored.');
    return true;
  }
  return false;
};

/**
 * BOARD-F — the boarded front door's boards (zil/1actions.zil:44).
 *
 * TAKE or EXAMINE prints "The boards are securely fastened."
 */
export const boardF: ActionHandler = (ctx) => {
  if (ctx.verb === 'take' || ctx.verb === 'examine') {
    ctx.tell('The boards are securely fastened.');
    return true;
  }
  return false;
};

/**
 * FRONT-DOOR-FCN — the front door of the white house (zil/1actions.zil:2163).
 *
 * OPEN, BURN, and MUNG all refuse.  LOOK-BEHIND also refuses.
 */
export const frontDoorFcn: ActionHandler = (ctx) => {
  if (ctx.verb === 'open') {
    ctx.tell('The door cannot be opened.');
    return true;
  }
  if (ctx.verb === 'burn') {
    ctx.tell('You cannot burn this door.');
    return true;
  }
  if (ctx.verb === 'destroy') {
    ctx.tell("You can't seem to damage the door.");
    return true;
  }
  return false;
};

/**
 * BOARDED-WINDOW-FCN — the boarded windows (zil/1actions.zil:370).
 *
 * OPEN: "The windows are boarded and can't be opened."
 * DESTROY: "You can't break the windows open."
 */
export const boardedWindowFcn: ActionHandler = (ctx) => {
  if (ctx.verb === 'open') {
    ctx.tell("The windows are boarded and can't be opened.");
    return true;
  }
  if (ctx.verb === 'destroy') {
    ctx.tell("You can't break the windows open.");
    return true;
  }
  return false;
};

/**
 * KITCHEN-WINDOW-F — the kitchen window (zil/1actions.zil:241).
 *
 * OPEN/CLOSE: delegate to OPEN-CLOSE logic with ZIL strings; set the flag.
 * EXAMINE (before flag): "slightly ajar, but not enough to allow entry."
 * WALK/BOARD/THROUGH/ENTER: move east (outside) or west (inside).
 * LOOK-INSIDE: describe what can be seen.
 */
export const kitchenWindowF: ActionHandler = (ctx) => {
  const win = ctx.self;

  if (ctx.verb === 'open' || ctx.verb === 'close') {
    kitchenWindowFlag = true;
    if (ctx.verb === 'open') {
      if (ctx.hasFlag(win, Flag.Open)) {
        // ZIL: <TELL <PICK-ONE ,DUMMY>> — generic "already done" response.
        // (OPEN-CLOSE uses DUMMY table: "Look around." / "Too late for that." / "Have your eyes checked.")
        ctx.tell(pickDummy(ctx.rng));
      } else {
        ctx.tell(
          'With great effort, you open the window far enough to allow entry.',
        );
        ctx.setFlag(win, Flag.Open);
      }
    } else {
      if (!ctx.hasFlag(win, Flag.Open)) {
        // ZIL: <TELL <PICK-ONE ,DUMMY>>
        ctx.tell(pickDummy(ctx.rng));
      } else {
        ctx.tell('The window closes (more easily than it opened).');
        ctx.clearFlag(win, Flag.Open);
      }
    }
    return true;
  }

  if (ctx.verb === 'examine' && !kitchenWindowFlag) {
    ctx.tell(
      'The window is slightly ajar, but not enough to allow entry.',
    );
    return true;
  }

  if (
    ctx.verb === 'walk' ||
    ctx.verb === 'enter' ||
    ctx.verb === 'climb'
  ) {
    // ZIL: <DO-WALK ,P?EAST> from kitchen, else <DO-WALK ,P?WEST>.
    // We model this by emitting a walk command in the appropriate direction.
    // The actual movement is handled by the exit system; here we just signal
    // which direction to walk by returning false so the default walk verb runs,
    // which will use the direction the player already parsed (in or west/east).
    // However, when the verb is "enter" or "through" with the window as dobj,
    // we need to push the player through the window.
    const dir = ctx.here.id === 'KITCHEN' ? 'east' : 'west';
    const exit = ctx.here.exits.find((e) => e.dir === dir);
    if (exit !== undefined) {
      if (exit.ifFlag !== undefined) {
        const gateObj = ctx.world.get(exit.ifFlag);
        if (gateObj === undefined || !ctx.hasFlag(gateObj, Flag.Open)) {
          ctx.tell('The window is closed.');
          return true;
        }
      }
      const dest = exit.to !== undefined ? ctx.world.get(exit.to) : undefined;
      if (dest !== undefined) {
        ctx.moveTo(ctx.actor, dest);
        return true;
      }
    }
    return false;
  }

  if (ctx.verb === 'look') {
    if (ctx.here.id === 'KITCHEN') {
      ctx.tell('You can see a clear area leading towards a forest.');
    } else {
      ctx.tell('You can see what appears to be a kitchen.');
    }
    return true;
  }

  return false;
};

/**
 * CHIMNEY-F — the dark chimney in the kitchen (zil/1actions.zil:545).
 *
 * EXAMINE: prints whether the chimney goes up or down (based on current room).
 */
export const chimneyF: ActionHandler = (ctx) => {
  if (ctx.verb === 'examine') {
    const dir = ctx.here.id === 'KITCHEN' ? 'down' : 'up';
    ctx.tell(`The chimney leads ${dir}ward, and looks climbable.`);
    return true;
  }
  return false;
};

/**
 * TROPHY-CASE-FCN — the trophy case (zil/1actions.zil:442).
 *
 * TAKE on the case itself is refused (fastened to the wall).
 * Scoring happens via M-END in the ZIL original; we handle it here when
 * the player puts a treasure in the case.
 */
export const trophyCaseFcn: ActionHandler = (ctx) => {
  if (ctx.verb === 'take' && ctx.dobj === ctx.self) {
    ctx.tell('The trophy case is securely fastened to the wall.');
    return true;
  }
  return false;
};

/**
 * RUG-FCN — the oriental rug in the living room (zil/1actions.zil:579).
 *
 * RAISE: "too heavy to lift" — first time also mentions the irregularity.
 * MOVE/PUSH: first time reveals the trap door; subsequent attempts refuse.
 * TAKE: "extremely heavy and cannot be carried."
 * LOOK-UNDER (before moved, not open): describe concealed trap door.
 * CLIMB-ON: mentions irregularity if rug still over door.
 */
export const rugFcn: ActionHandler = (ctx) => {
  if (ctx.verb === 'raise') {
    if (rugMoved) {
      ctx.tell('The rug is too heavy to lift.');
    } else {
      ctx.tell(
        'The rug is too heavy to lift, but in trying to take it you have\n' +
          'noticed an irregularity beneath it.',
      );
    }
    return true;
  }

  if (ctx.verb === 'move' || ctx.verb === 'push') {
    if (rugMoved) {
      ctx.tell(
        'Having moved the carpet previously, you find it impossible to move\nit again.',
      );
    } else {
      ctx.tell(
        'With a great effort, the rug is moved to one side of the room, revealing\n' +
          'the dusty cover of a closed trap door.',
      );
      const trapDoor = ctx.world.get('TRAP-DOOR');
      if (trapDoor !== undefined) ctx.clearFlag(trapDoor, Flag.Invisible);
      rugMoved = true;
    }
    return true;
  }

  if (ctx.verb === 'take') {
    ctx.tell('The rug is extremely heavy and cannot be carried.');
    return true;
  }

  if (ctx.verb === 'look') {
    if (!rugMoved) {
      const trapDoor = ctx.world.get('TRAP-DOOR');
      const trapOpen = trapDoor !== undefined && ctx.hasFlag(trapDoor, Flag.Open);
      if (!trapOpen) {
        ctx.tell(
          'Underneath the rug is a closed trap door. As you drop the corner of the\n' +
            'rug, the trap door is once again concealed from view.',
        );
        return true;
      }
    }
    return false;
  }

  if (ctx.verb === 'climb') {
    if (!rugMoved) {
      const trapDoor = ctx.world.get('TRAP-DOOR');
      const trapOpen = trapDoor !== undefined && ctx.hasFlag(trapDoor, Flag.Open);
      if (!trapOpen) {
        ctx.tell(
          'As you sit, you notice an irregularity underneath it. Rather than be\nuncomfortable, you stand up again.',
        );
        return true;
      }
    }
    ctx.tell("I suppose you think it's a magic carpet?");
    return true;
  }

  return false;
};

/**
 * TRAP-DOOR-FCN — the trap door in the living room / cellar (zil/1actions.zil:504).
 *
 * From LIVING-ROOM:
 *   RAISE → delegate to OPEN.
 *   OPEN/CLOSE: OPEN-CLOSE with appropriate ZIL strings.
 *   LOOK-UNDER: describe what's below.
 * From CELLAR:
 *   OPEN/UNLOCK: "locked from above."
 *   CLOSE (when already closed): set Touched, clear Open, "The door closes and locks."
 */
export const trapDoorFcn: ActionHandler = (ctx) => {
  const door = ctx.self;

  // Fallback RNG for contexts where no rng is supplied (e.g. tests).
  // (rng is used indirectly via pickDummy below)

  if (ctx.verb === 'raise') {
    // Delegate to open.
    if (ctx.here.id === 'LIVING-ROOM') {
      if (!ctx.hasFlag(door, Flag.Open)) {
        ctx.tell(
          'The door reluctantly opens to reveal a rickety staircase descending into\ndarkness.',
        );
        ctx.setFlag(door, Flag.Open);
      } else {
        // ZIL: <TELL <PICK-ONE ,DUMMY>>
        ctx.tell(pickDummy(ctx.rng));
      }
      return true;
    }
  }

  if (ctx.here.id === 'LIVING-ROOM') {
    if (ctx.verb === 'open' || ctx.verb === 'close') {
      if (ctx.verb === 'open') {
        if (ctx.hasFlag(door, Flag.Open)) {
          // ZIL: <TELL <PICK-ONE ,DUMMY>>
          ctx.tell(pickDummy(ctx.rng));
        } else {
          ctx.tell(
            'The door reluctantly opens to reveal a rickety staircase descending into\ndarkness.',
          );
          ctx.setFlag(door, Flag.Open);
        }
      } else {
        if (!ctx.hasFlag(door, Flag.Open)) {
          // ZIL: <TELL <PICK-ONE ,DUMMY>>
          ctx.tell(pickDummy(ctx.rng));
        } else {
          ctx.tell('The door swings shut and closes.');
          ctx.clearFlag(door, Flag.Open);
        }
      }
      return true;
    }

    if (ctx.verb === 'look') {
      if (ctx.hasFlag(door, Flag.Open)) {
        ctx.tell('You see a rickety staircase descending into darkness.');
      } else {
        ctx.tell("It's closed.");
      }
      return true;
    }
  }

  if (ctx.here.id === 'CELLAR') {
    if ((ctx.verb === 'open' || ctx.verb === 'unlock') && !ctx.hasFlag(door, Flag.Open)) {
      ctx.tell('The door is locked from above.');
      return true;
    }
    if (ctx.verb === 'close' && !ctx.hasFlag(door, Flag.Open)) {
      ctx.clearFlag(door, Flag.Touched);
      ctx.clearFlag(door, Flag.Open);
      ctx.tell('The door closes and locks.');
      return true;
    }
  }

  return false;
};

/**
 * GRATE-FUNCTION — the grating in/above MAZE-11 / GRATING-CLEARING
 * (zil/1actions.zil:850).
 *
 * OPEN with KEYS: redirect to UNLOCK.
 * LOCK: lock the grate (sets GRUNLOCK false).
 * UNLOCK with KEYS from below: set GRUNLOCK true.
 * OPEN/CLOSE: open or close if unlocked; also reveal leaves if opening from below.
 */
export const grateFunction: ActionHandler = (ctx) => {
  const grate = ctx.self;
  const keys = ctx.world.get('KEYS');
  const iobj = ctx.iobj;

  if (ctx.verb === 'lock') {
    if (ctx.here.id === 'GRATING-ROOM') {
      grunlock = false;
      ctx.tell('The grate is locked.');
      return true;
    }
    if (ctx.here.id === 'GRATING-CLEARING') {
      ctx.tell("You can't lock it from this side.");
      return true;
    }
  }

  if (ctx.verb === 'unlock' && ctx.dobj === grate) {
    if (ctx.here.id === 'GRATING-ROOM' && iobj === keys) {
      grunlock = true;
      ctx.tell('The grate is unlocked.');
      return true;
    }
    if (ctx.here.id === 'GRATING-CLEARING' && iobj === keys) {
      ctx.tell("You can't reach the lock from here.");
      return true;
    }
    ctx.tell(`Can you unlock a grating with a ${iobj?.desc ?? 'that'}?`);
    return true;
  }

  if (ctx.verb === 'open' || ctx.verb === 'close') {
    if (!grunlock) {
      ctx.tell('The grating is locked.');
      return true;
    }
    if (ctx.verb === 'open') {
      if (ctx.hasFlag(grate, Flag.Open)) {
        // ZIL: <TELL <PICK-ONE ,DUMMY>>
        ctx.tell(pickDummy(ctx.rng));
      } else {
        const msg =
          ctx.here.id === 'GRATING-CLEARING'
            ? 'The grating opens.'
            : 'The grating opens to reveal trees above you.';
        ctx.tell(msg);
        ctx.setFlag(grate, Flag.Open);
        // When opened from below and leaves haven't been revealed yet, drop leaves.
        if (ctx.here.id !== 'GRATING-CLEARING' && !grateRevealed) {
          ctx.tell('A pile of leaves falls onto your head and to the ground.');
          grateRevealed = true;
          const leaves = ctx.world.get('LEAVES');
          if (leaves !== undefined) ctx.moveTo(leaves, ctx.here);
        }
        // Light the grating room.
        const gratingRoom = ctx.world.get('GRATING-ROOM');
        if (gratingRoom !== undefined) ctx.setFlag(gratingRoom, Flag.Light);
      }
    } else {
      if (!ctx.hasFlag(grate, Flag.Open)) {
        // ZIL: <TELL <PICK-ONE ,DUMMY>>
        ctx.tell(pickDummy(ctx.rng));
      } else {
        ctx.tell('The grating is closed.');
        ctx.clearFlag(grate, Flag.Open);
        const gratingRoom = ctx.world.get('GRATING-ROOM');
        if (gratingRoom !== undefined) ctx.clearFlag(gratingRoom, Flag.Light);
      }
    }
    return true;
  }

  if (ctx.verb === 'put' && ctx.iobj === grate) {
    const item = ctx.dobj;
    if (item !== undefined) {
      const size = item.props.get('SIZE');
      if (typeof size === 'number' && size > 20) {
        ctx.tell("It won't fit through the grating.");
      } else {
        const gratingRoom = ctx.world.get('GRATING-ROOM');
        if (gratingRoom !== undefined) ctx.moveTo(item, gratingRoom);
        ctx.tell(`The ${item.desc} goes through the grating into the darkness below.`);
      }
      return true;
    }
  }

  return false;
};

/**
 * LEAF-PILE — the pile of leaves covering the grating (zil/1actions.zil:786).
 *
 * COUNT: 69,105 leaves.
 * BURN: reveal grate, remove burning object.
 * CUT/MOVE/TAKE: reveal grate.
 * LOOK-UNDER (before revealed): describe hidden grate.
 */
export const leafPile: ActionHandler = (ctx) => {
  if (ctx.verb === 'count') {
    ctx.tell('There are 69,105 leaves here.');
    return true;
  }

  if (ctx.verb === 'burn') {
    leavesAppear(ctx);
    const item = ctx.dobj;
    if (item !== undefined) {
      // In ZIL this checks if the burner is in HERE; simplified here.
      item.moveTo(null);
      ctx.tell('The leaves burn.');
    }
    return true;
  }

  if (ctx.verb === 'cut') {
    ctx.tell('You rustle the leaves around, making quite a mess.');
    leavesAppear(ctx);
    return true;
  }

  if (ctx.verb === 'move' || ctx.verb === 'take') {
    if (ctx.verb === 'move') ctx.tell('Done.');
    if (grateRevealed) return ctx.verb === 'take' ? false : true;
    leavesAppear(ctx);
    return ctx.verb === 'take' ? false : true;
  }

  if (ctx.verb === 'look') {
    if (!grateRevealed) {
      ctx.tell(
        'Underneath the pile of leaves is a grating. As you release the leaves,\n' +
          'the grating is once again concealed from view.',
      );
      return true;
    }
  }

  return false;
};

function leavesAppear(ctx: Parameters<ActionHandler>[0]): void {
  const grate = ctx.world.get('GRATE');
  if (!grateRevealed) {
    if (ctx.verb === 'move' || ctx.verb === 'take') {
      ctx.tell('In disturbing the pile of leaves, a grating is revealed.');
    } else {
      ctx.tell('With the leaves moved, a grating is revealed.');
    }
    if (grate !== undefined) ctx.clearFlag(grate, Flag.Invisible);
    grateRevealed = true;
  }
}

/**
 * PAINTING-FCN — the painting in the gallery (zil/1actions.zil:2207).
 *
 * MUNG: destroy the painting's value, print the vandalism message.
 */
export const paintingFcn: ActionHandler = (ctx) => {
  if (ctx.verb === 'destroy') {
    ctx.self.props.set('TVALUE', 0);
    ctx.self.ldesc = 'There is a worthless piece of canvas here.';
    ctx.tell(
      'Congratulations! Unlike the other vandals, who merely stole the\n' +
        "artist's masterpieces, you have destroyed one.",
    );
    return true;
  }
  return false;
};

/**
 * SWORD-FCN — the elvish sword (zil/1actions.zil:2432).
 *
 * TAKE: enable the I-SWORD glow interrupt.
 * EXAMINE: report glow level (stored as TVALUE 1 = faint, 2 = very bright).
 */
export const swordFcn: ActionHandler = (ctx) => {
  if (ctx.verb === 'take') {
    ctx.enableClock('I-SWORD');
    return false; // let default TAKE execute
  }
  if (ctx.verb === 'examine') {
    const g = ctx.self.props.get('TVALUE');
    if (g === 1) {
      ctx.tell('Your sword is glowing with a faint blue glow.');
      return true;
    }
    if (g === 2) {
      ctx.tell('Your sword is glowing very brightly.');
      return true;
    }
  }
  return false;
};

/**
 * GUNK-FUNCTION — the small piece of vitreous slag (zil/1actions.zil:2553).
 *
 * Any interaction crumbles it to dust.
 */
export const gunkFunction: ActionHandler = (ctx) => {
  ctx.self.moveTo(null);
  ctx.tell(
    'The slag was rather insubstantial, and crumbles into dust at your touch.',
  );
  return true;
};

/**
 * EGG-OBJECT — the jewel-encrusted egg (zil/1actions.zil:2919).
 *
 * OPEN/MUNG on the egg (as PRSO):
 *   Already open → "already open."
 *   No iobj → "You have neither the tools nor the expertise."
 *   Hands → "I doubt you could do that without damaging it."
 *   Weapon or tool → open but damaged (BAD-EGG).
 *   Other → "The concept of using a X is certainly original."
 * CLIMB-ON/HATCH: crack open.
 * OPEN/MUNG/THROW (as fallback): damage while opening.
 */
export const eggObject: ActionHandler = (ctx) => {
  const egg = ctx.self;

  if (
    (ctx.verb === 'open' || ctx.verb === 'destroy') &&
    ctx.dobj === egg
  ) {
    if (ctx.hasFlag(egg, Flag.Open)) {
      ctx.tell('The egg is already open.');
      return true;
    }
    const iobj = ctx.iobj;
    if (iobj === undefined) {
      ctx.tell('You have neither the tools nor the expertise.');
      return true;
    }
    const hands = ctx.world.get('HANDS');
    if (iobj === hands) {
      ctx.tell('I doubt you could do that without damaging it.');
      return true;
    }
    if (ctx.hasFlag(iobj, Flag.Weapon) || ctx.hasFlag(iobj, Flag.Climbable)) {
      ctx.tell(
        'The egg is now open, but the clumsiness of your attempt has seriously\n' +
          'compromised its esthetic appeal.',
      );
      badEgg(ctx);
      return true;
    }
    if (ctx.hasFlag(egg, Flag.OnFire)) {
      ctx.tell(`Not to say that using the ${iobj.desc} isn't original too...`);
      return true;
    }
    ctx.tell(`The concept of using a ${iobj.desc} is certainly original.`);
    ctx.setFlag(egg, Flag.OnFire); // ZIL FIGHTBIT reuse — marks "tried once"
    return true;
  }

  if (ctx.verb === 'climb') {
    ctx.tell(
      'There is a noticeable crunch from beneath you, and inspection reveals\n' +
        'that the egg is lying open, badly damaged.',
    );
    badEgg(ctx);
    return true;
  }

  if (ctx.verb === 'open' || ctx.verb === 'destroy' || ctx.verb === 'throw') {
    if (ctx.verb === 'throw' && ctx.dobj !== undefined) {
      ctx.moveTo(ctx.dobj, ctx.here);
    }
    ctx.tell(
      'Your rather indelicate handling of the egg has caused it some damage,\n' +
        'although you have succeeded in opening it.',
    );
    badEgg(ctx);
    return true;
  }

  return false;
};

function badEgg(ctx: Parameters<ActionHandler>[0]): void {
  const egg = ctx.world.get('EGG');
  const brokenEgg = ctx.world.get('BROKEN-EGG');
  const canary = ctx.world.get('CANARY');
  const brokenCanary = ctx.world.get('BROKEN-CANARY');

  if (canary !== undefined && egg !== undefined) {
    const eggLoc = egg.parent;
    if (brokenCanary !== undefined) {
      const fdesc = brokenCanary.fdesc;
      if (fdesc !== undefined) ctx.tell(' ' + fdesc);
    }
    if (brokenEgg !== undefined && eggLoc !== null && eggLoc !== undefined) {
      brokenEgg.moveTo(eggLoc);
    }
    egg.moveTo(null);
  } else {
    if (brokenCanary !== undefined) brokenCanary.moveTo(null);
    if (brokenEgg !== undefined && egg !== undefined) {
      const eggLoc = egg.parent;
      if (eggLoc !== null && eggLoc !== undefined) brokenEgg.moveTo(eggLoc);
    }
    if (egg !== undefined) egg.moveTo(null);
  }
}

/**
 * CANARY-OBJECT — the golden clockwork canary (zil/1actions.zil:2970).
 *
 * WIND with canary as dobj: if in a forest room and not sung yet, summon the
 * songbird and drop the brass bauble; otherwise chirp blithely.
 * WIND with something else as dobj: "unpleasant grinding noise."
 */
export const canaryObject: ActionHandler = (ctx) => {
  if (ctx.verb === 'wind' || ctx.verb === 'turn') {
    const canary = ctx.self;
    if (ctx.dobj === canary) {
      if (!singSong && isForestRoom(ctx.here.id)) {
        ctx.tell(
          'The canary chirps, slightly off-key, an aria from a forgotten opera.\n' +
            'From out of the greenery flies a lovely songbird. It perches on a\n' +
            'limb just over your head and opens its beak to sing. As it does so\n' +
            'a beautiful brass bauble drops from its mouth, bounces off the top of\n' +
            'your head, and lands glimmering in the grass. As the canary winds\n' +
            'down, the songbird flies away.',
        );
        singSong = true;
        const bauble = ctx.world.get('BAUBLE');
        if (bauble !== undefined) {
          const dest =
            ctx.here.id === 'UP-A-TREE'
              ? ctx.world.get('PATH')
              : ctx.world.get(ctx.here.id);
          if (dest !== undefined) ctx.moveTo(bauble, dest);
        }
        return true;
      }
      ctx.tell(
        'The canary chirps blithely, if somewhat tinnily, for a short time.',
      );
      return true;
    }
    ctx.tell('There is an unpleasant grinding noise from inside the canary.');
    return true;
  }
  return false;
};

function isForestRoom(id: string): boolean {
  return (
    id === 'FOREST-1' ||
    id === 'FOREST-2' ||
    id === 'FOREST-3' ||
    id === 'PATH' ||
    id === 'UP-A-TREE'
  );
}

/**
 * SONGBIRD-F — the invisible songbird pseudo-object (zil/1actions.zil:82).
 *
 * FIND/TAKE: "not here but probably nearby."
 * LISTEN: "You can't hear the songbird now."
 * FOLLOW: "It can't be followed."
 * Anything else: "You can't see any songbird here."
 */
export const songbirdF: ActionHandler = (ctx) => {
  if (ctx.verb === 'examine' || ctx.verb === 'take') {
    ctx.tell('The songbird is not here but is probably nearby.');
    return true;
  }
  if (ctx.verb === 'smell') {
    ctx.tell("You can't hear the songbird now.");
    return true;
  }
  if (ctx.verb === 'follow') {
    ctx.tell("It can't be followed.");
    return true;
  }
  ctx.tell("You can't see any songbird here.");
  return true;
};

/**
 * BARROW-DOOR-FCN — the stone door of the barrow (zil/1actions.zil:432).
 *
 * OPEN/CLOSE: "The door is too heavy."
 */
export const barrowDoorFcn: ActionHandler = (ctx) => {
  if (ctx.verb === 'open' || ctx.verb === 'close') {
    ctx.tell('The door is too heavy.');
    return true;
  }
  return false;
};

/**
 * BARROW-FCN — the stone barrow object (zil/1actions.zil:436).
 *
 * THROUGH: walk west into the barrow.
 */
export const barrowFcn: ActionHandler = (ctx) => {
  if (ctx.verb === 'enter') {
    const exit = ctx.here.exits.find((e) => e.dir === 'west');
    if (exit?.to !== undefined) {
      const dest = ctx.world.get(exit.to);
      if (dest !== undefined) {
        ctx.moveTo(ctx.actor, dest);
        return true;
      }
    }
  }
  return false;
};

/**
 * CRACK-FCN — the narrow crack (zil/1actions.zil:381).
 *
 * THROUGH: "You can't fit through the crack."
 */
export const crackFcn: ActionHandler = (ctx) => {
  if (ctx.verb === 'enter') {
    ctx.tell("You can't fit through the crack.");
    return true;
  }
  return false;
};

// ---------------------------------------------------------------------------
// PER routines (exit resolution; return a destination room id).
// ---------------------------------------------------------------------------

/**
 * MAZE-DIODES — one-way maze passage (zil/1actions.zil:898).
 *
 * Prints the no-return warning, then maps the current room to its destination.
 */
export const mazeDiodes: PerRoutine = (ctx) => {
  ctx.tell(
    "You won't be able to get back up to the tunnel you are going through\n" +
      'when it gets to the next room.\n',
  );
  switch (ctx.here.id) {
    case 'MAZE-2':
      return 'MAZE-4';
    case 'MAZE-7':
      return 'DEAD-END-1';
    case 'MAZE-9':
      return 'MAZE-11';
    case 'MAZE-12':
      return 'MAZE-5';
    default:
      return undefined;
  }
};

/**
 * TRAP-DOOR-EXIT — per-routine for the LIVING-ROOM's down exit (1actions.zil:567).
 *
 * Succeeds only when the rug has been moved AND the trap door is open.
 */
export const trapDoorExit: PerRoutine = (ctx) => {
  if (rugMoved) {
    const trapDoor = ctx.world.get('TRAP-DOOR');
    if (trapDoor !== undefined && ctx.hasFlag(trapDoor, Flag.Open)) {
      return 'CELLAR';
    }
    ctx.tell('The trap door is closed.');
    return undefined;
  }
  ctx.tell("You can't go that way.");
  return undefined;
};

/**
 * UP-CHIMNEY-FUNCTION — per-routine for going up the chimney from the kitchen
 * (zil/1actions.zil:553).
 *
 * The player must be carrying only the lamp (or nothing) to ascend.
 * On success, clears the trap-door's Touched flag if it isn't open (so the
 * door can crash shut again on the next descent).
 */
export const upChimneyFunction: PerRoutine = (ctx) => {
  const player = ctx.actor;
  const items = Array.from(player.children);
  if (items.length === 0) {
    ctx.tell('Going up empty-handed is a bad idea.');
    return undefined;
  }
  const lamp = ctx.world.get('LAMP');
  const onlyLamp =
    (items.length === 1 && items[0] === lamp) ||
    (items.length === 2 && items.some((i) => i === lamp) && items.every((i) => i === lamp || i.has(Flag.Light)));

  if (onlyLamp || (items.length === 1 && items[0] === lamp)) {
    const trapDoor = ctx.world.get('TRAP-DOOR');
    if (trapDoor !== undefined && !ctx.hasFlag(trapDoor, Flag.Open)) {
      ctx.clearFlag(trapDoor, Flag.Touched);
    }
    return 'KITCHEN';
  }
  ctx.tell("You can't get up there with what you're carrying.");
  return undefined;
};

/**
 * GRATING-EXIT — per-routine for going down through the grating from the
 * GRATING-CLEARING (zil/1actions.zil: referenced in rooms.json).
 *
 * Grate must be open (unlocked + opened) to descend.
 */
export const gratingExit: PerRoutine = (ctx) => {
  const grate = ctx.world.get('GRATE');
  if (grate !== undefined && ctx.hasFlag(grate, Flag.Open)) {
    return 'GRATING-ROOM';
  }
  if (!grunlock) {
    ctx.tell('The grating is locked.');
  } else {
    ctx.tell('The grating is closed.');
  }
  return undefined;
};

// ---------------------------------------------------------------------------
// Exported region maps — keyed by ZIL routine name.
// ---------------------------------------------------------------------------

/** ACTION routines (rooms + objects) for the above-ground region. */
export const aboveGroundActions: Record<string, ActionHandler> = {
  'WEST-HOUSE':         westHouse,
  'EAST-HOUSE':         eastHouse,
  'KITCHEN-FCN':        kitchenFcn,
  'LIVING-ROOM-FCN':    livingRoomFcn,
  'CELLAR-FCN':         cellarFcn,
  'CLEARING-FCN':       clearingFcn,
  'MAZE-11-FCN':        maze11Fcn,
  'TREE-ROOM':          treeRoom,
  'FOREST-ROOM':        forestRoom,
  'MAILBOX-F':          mailboxF,
  'BOARD-F':            boardF,
  'FRONT-DOOR-FCN':     frontDoorFcn,
  'BOARDED-WINDOW-FCN': boardedWindowFcn,
  'KITCHEN-WINDOW-F':   kitchenWindowF,
  'CHIMNEY-F':          chimneyF,
  'TROPHY-CASE-FCN':    trophyCaseFcn,
  'RUG-FCN':            rugFcn,
  'TRAP-DOOR-FCN':      trapDoorFcn,
  'GRATE-FUNCTION':     grateFunction,
  'LEAF-PILE':          leafPile,
  'PAINTING-FCN':       paintingFcn,
  'SWORD-FCN':          swordFcn,
  'GUNK-FUNCTION':      gunkFunction,
  'EGG-OBJECT':         eggObject,
  'CANARY-OBJECT':      canaryObject,
  'SONGBIRD-F':         songbirdF,
  'BARROW-DOOR-FCN':    barrowDoorFcn,
  'BARROW-FCN':         barrowFcn,
  'CRACK-FCN':          crackFcn,
};

/** PER (exit-resolution) routines for the above-ground region. */
export const aboveGroundPer: Record<string, PerRoutine> = {
  'MAZE-DIODES':         mazeDiodes,
  'TRAP-DOOR-EXIT':      trapDoorExit,
  'UP-CHIMNEY-FUNCTION': upChimneyFunction,
  'GRATING-EXIT':        gratingExit,
};
