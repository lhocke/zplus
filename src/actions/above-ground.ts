/**
 * Above-ground region action routines.
 *
 * Hand-translations of ZIL ACTION/PER routines from 1actions.zil, covering
 * the white house and surrounding forest. See src/domain/game-object.ts for
 * the dispatch contract (ActionHandler / HandlerResult / PerRoutine).
 */

import type { ActionHandler } from '../domain/game-object.js';
import { Flag } from '../domain/flags.js';
import { M_LOOK, M_ENTER, M_END, M_BEG } from '../engine/messages.js';
import type { PerRoutine } from './registry.js';
import { pick, dummy, type PickRng } from '../engine/game-messages.js';

function pickDummy(rng: PickRng | undefined): string {
  if (rng !== undefined) return pick(dummy, rng);
  return dummy.entries[0] ?? 'Look around.';
}

// Module-level state — mirrors ZIL GLOBAL variables for this region.

/** KITCHEN-WINDOW-FLAG — ZIL <GLOBAL KITCHEN-WINDOW-FLAG <>> (1actions.zil:239). */
let kitchenWindowFlag = false;

/** Reset for test isolation. */
export function resetKitchenWindowFlag(): void {
  kitchenWindowFlag = false;
}

/** RUG-MOVED — ZIL <GLOBAL RUG-MOVED <>> (1actions.zil:447). */
let rugMoved = false;

/** Reset for test isolation. */
export function resetRugMoved(): void {
  rugMoved = false;
}

/** GRATE-REVEALED — ZIL <GLOBAL GRATE-REVEALED <>> (1actions.zil:771). */
let grateRevealed = false;

/** Reset for test isolation. */
export function resetGrateRevealed(): void {
  grateRevealed = false;
}

/** GRUNLOCK — ZIL <GLOBAL GRUNLOCK <>> (1actions.zil:772). */
let grunlock = false;

/** Reset for test isolation. */
export function resetGrunlock(): void {
  grunlock = false;
}

/** SING-SONG — ZIL <GLOBAL SING-SONG <>> (1actions.zil:2968). */
let singSong = false;

/** Read SING-SONG state — canonical module field; thief code reads via this. */
export function getSingSong(): boolean { return singSong; }

/** Reset for test isolation. */
export function resetSingSong(): void {
  singSong = false;
}

// Room ACTION routines

/** WEST-HOUSE — zil/1actions.zil:7 */
export const westHouse: ActionHandler = (ctx) => {
  if (ctx.rarg === M_LOOK) {
    let text =
      'You are standing in an open field west of a white house, with a boarded\n' +
      'front door.';
    if (ctx.getGlobal?.('WON-FLAG')) {
      text += ' A secret path leads southwest into the forest.';
    }
    ctx.tell(text);
    return true;
  }
  return false;
};

/** EAST-HOUSE — zil/1actions.zil:17 */
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

/** KITCHEN-FCN — zil/1actions.zil:385 */
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
 * LIVING-ROOM-FCN — zil/1actions.zil:449
 *
 * M-END (1actions.zil:477–485): recompute the trophy-case TVALUE component on
 * TAKE or PUT-to-TROPHY-CASE so the total score stays live.
 */
export const livingRoomFcn: ActionHandler = (ctx) => {
  if (ctx.rarg === M_LOOK) {
    const hasMagic = ctx.getGlobal?.('MAGIC-FLAG') ?? false;
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

  if (ctx.rarg === M_END) {
    const isTake = ctx.action === 'V-TAKE';
    const isPutToCase =
      ctx.action === 'V-PUT' &&
      ctx.iobj !== undefined &&
      ctx.iobj.id === 'TROPHY-CASE';

    if (isTake || isPutToCase) {
      const trophyCase = ctx.world.get('TROPHY-CASE');
      if (trophyCase !== undefined) {
        ctx.recomputeTrophy(trophyCase);
      }
    }
    return false;
  }

  return false;
};

/** CELLAR-FCN — zil/1actions.zil:531 */
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

/** CLEARING-FCN — zil/1actions.zil:815 */
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

/** MAZE-11-FCN — zil/1actions.zil:833 */
export const maze11Fcn: ActionHandler = (ctx) => {
  if (ctx.rarg === M_ENTER) {
    const grate = ctx.world.get('GRATE');
    if (grate !== undefined) ctx.clearFlag(grate, Flag.Invisible);
    return false;
  }
  if (ctx.rarg === M_LOOK) {
    const grate = ctx.world.get('GRATE');
    const grateOpen = grate !== undefined && ctx.hasFlag(grate, Flag.Open);
    // ZIL source newline within a string segment normalizes to a single space.
    let text =
      'You are in a small room near the maze. There are twisty passages in the immediate vicinity.';
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

// Shared DO-WALK simulation for FOREST-ROOM / TREE-ROOM M-BEG climb intercepts.
// Finds the exit in `dir`, moves the actor if passable, prints elseMessage if blocked.
// Returns true (handled) when the exit exists; false to fall through to verb dispatch.
// Mirrors ZIL DO-WALK for simple to/elseMessage exits (per/ifFlag not needed here).
function doWalkSimple(dir: string, ctx: Parameters<ActionHandler>[0]): boolean {
  const exit = ctx.here.exits.find(e => e.dir === dir);
  if (exit === undefined) return false;
  if (exit.to !== undefined) {
    const dest = ctx.world.get(exit.to);
    if (dest !== undefined) ctx.moveTo(ctx.actor, dest);
  } else if (exit.elseMessage !== undefined) {
    ctx.tell(exit.elseMessage);
  }
  return true;
}

/** TREE-ROOM — zil/1actions.zil:2880 */
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
  // M-BEG: 1actions.zil:2890-2895
  // climb down + PRSO=TREE or PRSO=ROOMS → DO-WALK down
  // climb up/foo + PRSO=TREE → DO-WALK up
  if (ctx.rarg === M_BEG) {
    if (ctx.action === 'V-CLIMB-DOWN' &&
        (ctx.dobj?.id === 'TREE' || ctx.dobjIsRooms === true)) {
      return doWalkSimple('down', ctx);
    }
    if ((ctx.action === 'V-CLIMB-FOO' || ctx.action === 'V-CLIMB-UP') &&
        ctx.dobj?.id === 'TREE') {
      return doWalkSimple('up', ctx);
    }
  }
  return false;
};

/** FOREST-ROOM — zil/1actions.zil:3004 */
export const forestRoom: ActionHandler = (ctx) => {
  if (ctx.rarg === M_ENTER) {
    ctx.enableClock('I-FOREST-ROOM');
    return false;
  }
  if (ctx.rarg === M_LOOK) {
    return false;
  }
  // M-BEG: 1actions.zil:3006-3009
  // climb up/foo + PRSO=TREE → DO-WALK up (structured for CC9 to extend with SONGBIRD/I-FOREST-ROOM)
  if (ctx.rarg === M_BEG) {
    if ((ctx.action === 'V-CLIMB-FOO' || ctx.action === 'V-CLIMB-UP') &&
        ctx.dobj?.id === 'TREE') {
      return doWalkSimple('up', ctx);
    }
  }
  return false;
};

// Object ACTION routines

/** MAILBOX-F — zil/1actions.zil:2259 */
export const mailboxF: ActionHandler = (ctx) => {
  if (ctx.action === 'V-TAKE' && ctx.dobj === ctx.self) {
    ctx.tell('It is securely anchored.');
    return true;
  }
  return false;
};

/** BOARD-F — zil/1actions.zil:44 */
export const boardF: ActionHandler = (ctx) => {
  if (ctx.action === 'V-TAKE' || ctx.action === 'V-EXAMINE') {
    ctx.tell('The boards are securely fastened.');
    return true;
  }
  return false;
};

/** FRONT-DOOR-FCN — zil/1actions.zil:2163 */
export const frontDoorFcn: ActionHandler = (ctx) => {
  if (ctx.action === 'V-OPEN') {
    ctx.tell('The door cannot be opened.');
    return true;
  }
  if (ctx.action === 'V-BURN') {
    ctx.tell('You cannot burn this door.');
    return true;
  }
  if (ctx.action === 'V-MUNG') {
    ctx.tell("You can't seem to damage the door.");
    return true;
  }
  return false;
};

/** BOARDED-WINDOW-FCN — zil/1actions.zil:370 */
export const boardedWindowFcn: ActionHandler = (ctx) => {
  if (ctx.action === 'V-OPEN') {
    ctx.tell("The windows are boarded and can't be opened.");
    return true;
  }
  if (ctx.action === 'V-MUNG') {
    ctx.tell("You can't break the windows open.");
    return true;
  }
  return false;
};

/** KITCHEN-WINDOW-F — zil/1actions.zil:241 */
export const kitchenWindowF: ActionHandler = (ctx) => {
  const win = ctx.self;

  if (ctx.action === 'V-OPEN' || ctx.action === 'V-CLOSE') {
    kitchenWindowFlag = true;
    if (ctx.action === 'V-OPEN') {
      if (ctx.hasFlag(win, Flag.Open)) {
        ctx.tell(pickDummy(ctx.rng));
      } else {
        ctx.tell(
          'With great effort, you open the window far enough to allow entry.',
        );
        ctx.setFlag(win, Flag.Open);
      }
    } else {
      if (!ctx.hasFlag(win, Flag.Open)) {
        ctx.tell(pickDummy(ctx.rng));
      } else {
        ctx.tell('The window closes (more easily than it opened).');
        ctx.clearFlag(win, Flag.Open);
      }
    }
    return true;
  }

  if (ctx.action === 'V-EXAMINE' && !kitchenWindowFlag) {
    ctx.tell(
      'The window is slightly ajar, but not enough to allow entry.',
    );
    return true;
  }

  // V-WALK / V-ENTER / V-THROUGH — entering through the window.
  // "enter window" (ENTER + 1 obj) → V-THROUGH; bare "enter" (ENTER + 0 obj) → V-ENTER.
  // ZIL: VERB? WALK BOARD THROUGH (1actions.zil:251) — V-CLIMB-FOO not intercepted.
  if (
    ctx.action === 'V-WALK' ||
    ctx.action === 'V-ENTER' ||
    ctx.action === 'V-THROUGH'
  ) {
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

  // ZIL: VERB? LOOK-INSIDE only (1actions.zil:257) — look-under/behind/on fall through.
  if (ctx.action === 'V-LOOK-INSIDE') {
    if (ctx.here.id === 'KITCHEN') {
      ctx.tell('You can see a clear area leading towards a forest.');
    } else {
      ctx.tell('You can see what appears to be a kitchen.');
    }
    return true;
  }

  return false;
};

/** CHIMNEY-F — zil/1actions.zil:545 */
export const chimneyF: ActionHandler = (ctx) => {
  if (ctx.action === 'V-EXAMINE') {
    const dir = ctx.here.id === 'KITCHEN' ? 'down' : 'up';
    ctx.tell(`The chimney leads ${dir}ward, and looks climbable.`);
    return true;
  }
  return false;
};

/** TROPHY-CASE-FCN — zil/1actions.zil:442 */
export const trophyCaseFcn: ActionHandler = (ctx) => {
  if (ctx.action === 'V-TAKE' && ctx.dobj === ctx.self) {
    ctx.tell('The trophy case is securely fastened to the wall.');
    return true;
  }
  return false;
};

/** RUG-FCN — zil/1actions.zil:579 */
export const rugFcn: ActionHandler = (ctx) => {
  if (ctx.action === 'V-RAISE') {
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

  // V-MOVE covers "move"; V-PUSH covers "push/press".
  if (ctx.action === 'V-MOVE' || ctx.action === 'V-PUSH') {
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

  if (ctx.action === 'V-TAKE') {
    ctx.tell('The rug is extremely heavy and cannot be carried.');
    return true;
  }

  // ZIL: VERB? LOOK-UNDER only (1actions.zil:603) — look-in/behind/on fall through.
  if (ctx.action === 'V-LOOK-UNDER') {
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

  // V-CLIMB-FOO is the bare CLIMB (CLIMB ON is V-CLIMB-ON, but "sit" maps to V-CLIMB-FOO).
  if (ctx.action === 'V-CLIMB-FOO' || ctx.action === 'V-CLIMB-ON') {
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

/** TRAP-DOOR-FCN — zil/1actions.zil:504 */
export const trapDoorFcn: ActionHandler = (ctx) => {
  const door = ctx.self;

  if (ctx.action === 'V-RAISE') {
    if (ctx.here.id === 'LIVING-ROOM') {
      if (!ctx.hasFlag(door, Flag.Open)) {
        ctx.tell(
          'The door reluctantly opens to reveal a rickety staircase descending into\ndarkness.',
        );
        ctx.setFlag(door, Flag.Open);
      } else {
        ctx.tell(pickDummy(ctx.rng));
      }
      return true;
    }
  }

  if (ctx.here.id === 'LIVING-ROOM') {
    if (ctx.action === 'V-OPEN' || ctx.action === 'V-CLOSE') {
      if (ctx.action === 'V-OPEN') {
        if (ctx.hasFlag(door, Flag.Open)) {
          ctx.tell(pickDummy(ctx.rng));
        } else {
          ctx.tell(
            'The door reluctantly opens to reveal a rickety staircase descending into\ndarkness.',
          );
          ctx.setFlag(door, Flag.Open);
        }
      } else {
        if (!ctx.hasFlag(door, Flag.Open)) {
          ctx.tell(pickDummy(ctx.rng));
        } else {
          ctx.tell('The door swings shut and closes.');
          ctx.clearFlag(door, Flag.Open);
        }
      }
      return true;
    }

    // ZIL: VERB? LOOK-UNDER only (1actions.zil:514) — look-in/behind/on fall through.
    if (ctx.action === 'V-LOOK-UNDER') {
      if (ctx.hasFlag(door, Flag.Open)) {
        ctx.tell('You see a rickety staircase descending into darkness.');
      } else {
        ctx.tell("It's closed.");
      }
      return true;
    }
  }

  if (ctx.here.id === 'CELLAR') {
    if ((ctx.action === 'V-OPEN' || ctx.action === 'V-UNLOCK') && !ctx.hasFlag(door, Flag.Open)) {
      ctx.tell('The door is locked from above.');
      return true;
    }
    if (ctx.action === 'V-CLOSE' && !ctx.hasFlag(door, Flag.Open)) {
      ctx.clearFlag(door, Flag.Touched);
      ctx.clearFlag(door, Flag.Open);
      ctx.tell('The door closes and locks.');
      return true;
    }
  }

  return false;
};

/** GRATE-FUNCTION — zil/1actions.zil:850 */
export const grateFunction: ActionHandler = (ctx) => {
  const grate = ctx.self;
  const keys = ctx.world.get('KEYS');
  const iobj = ctx.iobj;

  if (ctx.action === 'V-LOCK') {
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

  if (ctx.action === 'V-UNLOCK' && ctx.dobj === grate) {
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

  if (ctx.action === 'V-OPEN' || ctx.action === 'V-CLOSE') {
    if (!grunlock) {
      ctx.tell('The grating is locked.');
      return true;
    }
    if (ctx.action === 'V-OPEN') {
      if (ctx.hasFlag(grate, Flag.Open)) {
        ctx.tell(pickDummy(ctx.rng));
      } else {
        const msg =
          ctx.here.id === 'GRATING-CLEARING'
            ? 'The grating opens.'
            : 'The grating opens to reveal trees above you.';
        ctx.tell(msg);
        ctx.setFlag(grate, Flag.Open);
        // When opened from below, drop the pile of leaves (once only).
        if (ctx.here.id !== 'GRATING-CLEARING' && !grateRevealed) {
          ctx.tell('A pile of leaves falls onto your head and to the ground.');
          grateRevealed = true;
          const leaves = ctx.world.get('LEAVES');
          if (leaves !== undefined) ctx.moveTo(leaves, ctx.here);
        }
        const gratingRoom = ctx.world.get('GRATING-ROOM');
        if (gratingRoom !== undefined) ctx.setFlag(gratingRoom, Flag.Light);
      }
    } else {
      if (!ctx.hasFlag(grate, Flag.Open)) {
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

  if (ctx.action === 'V-PUT' && ctx.iobj === grate) {
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

/** LEAF-PILE — zil/1actions.zil:786 */
export const leafPile: ActionHandler = (ctx) => {
  if (ctx.action === 'V-COUNT') {
    ctx.tell('There are 69,105 leaves here.');
    return true;
  }

  if (ctx.action === 'V-BURN') {
    leavesAppear(ctx);
    const item = ctx.dobj;
    if (item !== undefined) {
      item.moveTo(null);
      ctx.tell('The leaves burn.');
    }
    return true;
  }

  if (ctx.action === 'V-CUT') {
    ctx.tell('You rustle the leaves around, making quite a mess.');
    leavesAppear(ctx);
    return true;
  }

  if (ctx.action === 'V-MOVE' || ctx.action === 'V-TAKE') {
    if (ctx.action === 'V-MOVE') ctx.tell('Done.');
    if (grateRevealed) return ctx.action === 'V-TAKE' ? false : true;
    leavesAppear(ctx);
    return ctx.action === 'V-TAKE' ? false : true;
  }

  // ZIL: VERB? LOOK-UNDER only (1actions.zil:809) — look-in/behind/on fall through.
  if (ctx.action === 'V-LOOK-UNDER') {
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
    if (ctx.action === 'V-MOVE' || ctx.action === 'V-TAKE') {
      ctx.tell('In disturbing the pile of leaves, a grating is revealed.');
    } else {
      ctx.tell('With the leaves moved, a grating is revealed.');
    }
    if (grate !== undefined) ctx.clearFlag(grate, Flag.Invisible);
    grateRevealed = true;
  }
}

/** PAINTING-FCN — zil/1actions.zil:2207 */
export const paintingFcn: ActionHandler = (ctx) => {
  if (ctx.action === 'V-MUNG') {
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

/** SWORD-FCN — zil/1actions.zil:2432 */
export const swordFcn: ActionHandler = (ctx) => {
  if (ctx.action === 'V-TAKE') {
    ctx.enableClock('I-SWORD');
    return false; // let default TAKE execute
  }
  if (ctx.action === 'V-EXAMINE') {
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

/** GUNK-FUNCTION — zil/1actions.zil:2553 */
export const gunkFunction: ActionHandler = (ctx) => {
  ctx.self.moveTo(null);
  ctx.tell(
    'The slag was rather insubstantial, and crumbles into dust at your touch.',
  );
  return true;
};

/** EGG-OBJECT — zil/1actions.zil:2919 */
export const eggObject: ActionHandler = (ctx) => {
  const egg = ctx.self;

  if (
    (ctx.action === 'V-OPEN' || ctx.action === 'V-MUNG') &&
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

  // V-CLIMB-FOO = bare CLIMB, V-CLIMB-ON = "sit on/climb on".
  if (ctx.action === 'V-CLIMB-FOO' || ctx.action === 'V-CLIMB-ON') {
    ctx.tell(
      'There is a noticeable crunch from beneath you, and inspection reveals\n' +
        'that the egg is lying open, badly damaged.',
    );
    badEgg(ctx);
    return true;
  }

  // Second open/mung/throw branch: egg not dobj (e.g. thrown with egg nearby).
  if (ctx.action === 'V-OPEN' || ctx.action === 'V-MUNG' || ctx.action === 'V-THROW') {
    if (ctx.action === 'V-THROW' && ctx.dobj !== undefined) {
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

/** CANARY-OBJECT — zil/1actions.zil:2970 */
export const canaryObject: ActionHandler = (ctx) => {
  // V-WIND covers "wind"; V-TURN covers "turn/set/flip".
  if (ctx.action === 'V-WIND' || ctx.action === 'V-TURN') {
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

// Rooms adjacent to the white house — the four cardinal sides.
const HOUSE_SIDES = new Set(['WEST-OF-HOUSE', 'NORTH-OF-HOUSE', 'EAST-OF-HOUSE', 'SOUTH-OF-HOUSE']);

// Inside rooms (IN-HOUSE-AROUND table) — WALK-AROUND cycles through these.
const IN_HOUSE_AROUND = ['LIVING-ROOM', 'KITCHEN', 'ATTIC', 'KITCHEN'];

// Exterior house walk cycle (HOUSE-AROUND table from 1dungeon.zil:2620).
const HOUSE_AROUND = ['WEST-OF-HOUSE', 'NORTH-OF-HOUSE', 'EAST-OF-HOUSE', 'SOUTH-OF-HOUSE', 'WEST-OF-HOUSE'];

// Forest walk cycle (FOREST-AROUND table from 1dungeon.zil:2624).
const FOREST_AROUND = ['FOREST-1', 'FOREST-2', 'FOREST-3', 'PATH', 'CLEARING', 'FOREST-1'];

// ZIL GO-NEXT: find current room in table, move to the next entry.
// Returns true if moved, false if current room not in table.
function goNext(table: string[], ctx: Parameters<ActionHandler>[0]): boolean {
  const idx = table.indexOf(ctx.here.id);
  if (idx === -1) return false;
  const next = table[idx + 1];
  if (next === undefined) return false;
  const dest = ctx.world.get(next);
  if (dest !== undefined) ctx.moveTo(ctx.actor, dest);
  return true;
}

/** WHITE-HOUSE-F — zil/1actions.zil:92 */
export const whiteHouseF: ActionHandler = (ctx) => {
  const here = ctx.here.id;

  // Inside the house (KITCHEN, LIVING-ROOM, ATTIC) — walk around the interior.
  if (here === 'KITCHEN' || here === 'LIVING-ROOM' || here === 'ATTIC') {
    if (ctx.action === 'V-FIND') {
      ctx.tell('Why not find your brains?');
      return true;
    }
    if (ctx.action === 'V-WALK-AROUND') {
      goNext(IN_HOUSE_AROUND, ctx);
      return true;
    }
    return false;
  }

  // Not at a house-adjacent room (i.e., not one of the four sides).
  if (!HOUSE_SIDES.has(here)) {
    if (ctx.action === 'V-FIND') {
      if (here === 'CLEARING') {
        ctx.tell('It seems to be to the west.');
      } else {
        ctx.tell('It was here just a minute ago....');
      }
      return true;
    }
    // ZIL T catch-all (1actions.zil:106): every non-FIND verb at a non-side room
    // (walk-around, examine, knock, …) prints this, not a fall-through.
    ctx.tell("You're not at the house.");
    return true;
  }

  // At a house-adjacent room (the four cardinal sides).
  if (ctx.action === 'V-FIND') {
    ctx.tell("It's right here! Are you blind or something?");
    return true;
  }
  if (ctx.action === 'V-WALK-AROUND') {
    goNext(HOUSE_AROUND, ctx);
    return true;
  }
  if (ctx.action === 'V-EXAMINE') {
    ctx.tell(
      'The house is a beautiful colonial house which is painted white.\n' +
      'It is clear that the owners must have been extremely wealthy.',
    );
    return true;
  }
  // V-THROUGH + V-OPEN: enter the house via the kitchen window from the east.
  if (ctx.action === 'V-THROUGH' || ctx.action === 'V-OPEN') {
    if (here === 'EAST-OF-HOUSE') {
      const win = ctx.world.get('KITCHEN-WINDOW');
      if (win !== undefined && ctx.hasFlag(win, Flag.Open)) {
        const kitchen = ctx.world.get('KITCHEN');
        if (kitchen !== undefined) ctx.moveTo(ctx.actor, kitchen);
      } else {
        ctx.tell('The window is closed.');
        // ZIL: <THIS-IS-IT ,KITCHEN-WINDOW> — rebind "it" to window.
        const kwin = ctx.world.get('KITCHEN-WINDOW');
        if (kwin !== undefined) ctx.thisIsIt?.(kwin);
      }
    } else {
      ctx.tell("I can't see how to get in from here.");
    }
    return true;
  }
  if (ctx.action === 'V-BURN') {
    ctx.tell('You must be joking.');
    return true;
  }
  return false;
};

/** FOREST-F — zil/1actions.zil:136 */
export const forestF: ActionHandler = (ctx) => {
  const here = ctx.here.id;
  if (ctx.action === 'V-WALK-AROUND') {
    // House-side rooms: print the message, then fall through to GO-NEXT which
    // returns false (they're not in FOREST-AROUND) → routine returns false →
    // V-WALK-AROUND default ("Use compass directions for movement.") fires.
    // ZIL: no trailing T after <GO-NEXT ,FOREST-AROUND> (unlike WHITE-HOUSE-F).
    if (
      here === 'WEST-OF-HOUSE' || here === 'NORTH-OF-HOUSE' ||
      here === 'SOUTH-OF-HOUSE' || here === 'EAST-OF-HOUSE'
    ) {
      ctx.tell('You aren\'t even in the forest.');
    }
    return goNext(FOREST_AROUND, ctx);
  }
  if (ctx.action === 'V-DISEMBARK') {
    ctx.tell('You will have to specify a direction.');
    return true;
  }
  if (ctx.action === 'V-FIND') {
    ctx.tell('You cannot see the forest for the trees.');
    return true;
  }
  if (ctx.action === 'V-LISTEN') {
    ctx.tell('The pines and the hemlocks seem to be murmuring.');
    return true;
  }
  return false;
};

/** GRANITE-WALL-F — zil/1actions.zil:64 */
export const graniteWallF: ActionHandler = (ctx) => {
  const here = ctx.here.id;
  if (here === 'NORTH-TEMPLE') {
    if (ctx.action === 'V-FIND') {
      ctx.tell('The west wall is solid granite here.');
      return true;
    }
    if (ctx.action === 'V-TAKE' || ctx.action === 'V-RAISE' || ctx.action === 'V-LOWER') {
      ctx.tell("It's solid granite.");
      return true;
    }
    return false;
  }
  if (here === 'TREASURE-ROOM') {
    if (ctx.action === 'V-FIND') {
      ctx.tell('The east wall is solid granite here.');
      return true;
    }
    if (ctx.action === 'V-TAKE' || ctx.action === 'V-RAISE' || ctx.action === 'V-LOWER') {
      ctx.tell("It's solid granite.");
      return true;
    }
    return false;
  }
  if (here === 'SLIDE-ROOM') {
    if (ctx.action === 'V-FIND' || ctx.action === 'V-READ') {
      ctx.tell('It only SAYS "Granite Wall".');
      return true;
    }
    ctx.tell("The wall isn't granite.");
    return true;
  }
  ctx.tell('There is no granite wall here.');
  return true;
};

/** WCLIF-OBJECT (WHITE-CLIFF) — zil/1actions.zil:3011 */
export const wclifObject: ActionHandler = (ctx) => {
  if (
    ctx.action === 'V-CLIMB-UP' ||
    ctx.action === 'V-CLIMB-DOWN' ||
    ctx.action === 'V-CLIMB-FOO'
  ) {
    ctx.tell('The cliff is too steep for climbing.');
    return true;
  }
  return false;
};

/** CLIFF-OBJECT (CLIMBABLE-CLIFF) — zil/1actions.zil:3015 */
export const cliffObject: ActionHandler = (ctx) => {
  // V-LEAP or PUT-self-on-cliff → "very unwise"
  if (ctx.action === 'V-LEAP') {
    ctx.tell('That would be very unwise. Perhaps even fatal.');
    return true;
  }
  if (ctx.action === 'V-PUT' && ctx.dobj !== undefined && ctx.dobj === ctx.actor) {
    ctx.tell('That would be very unwise. Perhaps even fatal.');
    return true;
  }
  // PRSI = CLIMBABLE-CLIFF: throw/put something off the cliff into the river.
  if (ctx.iobj !== undefined && ctx.iobj === ctx.self) {
    if (ctx.action === 'V-PUT' || ctx.action === 'V-THROW-OFF') {
      const target = ctx.dobj;
      if (target !== undefined) {
        ctx.tell(`The ${target.desc} tumbles into the river and is seen no more.`);
        target.moveTo(null);  // REMOVE-CAREFULLY: remove from world
      }
      return true;
    }
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

/** SONGBIRD-F — zil/1actions.zil:82 */
export const songbirdF: ActionHandler = (ctx) => {
  if (ctx.action === 'V-FIND' || ctx.action === 'V-TAKE') {
    ctx.tell('The songbird is not here but is probably nearby.');
    return true;
  }
  if (ctx.action === 'V-LISTEN') {
    ctx.tell("You can't hear the songbird now.");
    return true;
  }
  if (ctx.action === 'V-FOLLOW') {
    ctx.tell("It can't be followed.");
    return true;
  }
  ctx.tell("You can't see any songbird here.");
  return true;
};

/** BARROW-DOOR-FCN — zil/1actions.zil:432 */
export const barrowDoorFcn: ActionHandler = (ctx) => {
  if (ctx.action === 'V-OPEN' || ctx.action === 'V-CLOSE') {
    ctx.tell('The door is too heavy.');
    return true;
  }
  return false;
};

/** BARROW-FCN — zil/1actions.zil:436 */
export const barrowFcn: ActionHandler = (ctx) => {
  if (ctx.action === 'V-ENTER') {
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

/** CRACK-FCN — zil/1actions.zil:381 */
export const crackFcn: ActionHandler = (ctx) => {
  if (ctx.action === 'V-ENTER') {
    ctx.tell("You can't fit through the crack.");
    return true;
  }
  return false;
};

// PER routines (exit resolution; return a destination room id).

/** MAZE-DIODES — zil/1actions.zil:898 */
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

/** TRAP-DOOR-EXIT — 1actions.zil:567 */
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

/** UP-CHIMNEY-FUNCTION — zil/1actions.zil:553 */
export const upChimneyFunction: PerRoutine = (ctx) => {
  const player = ctx.actor;
  const items = Array.from(player.children);
  if (items.length === 0) {
    ctx.tell('Going up empty-handed is a bad idea.');
    return undefined;
  }
  // At most two things, the lamp among them — no light-source test (1actions.zil:553-565).
  const lamp = ctx.world.get('LAMP');
  if (lamp !== undefined && items.includes(lamp) && items.length <= 2) {
    const trapDoor = ctx.world.get('TRAP-DOOR');
    if (trapDoor !== undefined && !ctx.hasFlag(trapDoor, Flag.Open)) {
      ctx.clearFlag(trapDoor, Flag.Touched);
    }
    return 'KITCHEN';
  }
  ctx.tell("You can't get up there with what you're carrying.");
  return undefined;
};

/** GRATING-EXIT — zil/1actions.zil (referenced in rooms.json) */
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

// Victory text — 1actions.zil:411–429 (standalone / header-bit-8 not set path).
const STONE_BARROW_VICTORY =
  'Inside the Barrow\n' +
  'As you enter the barrow, the door closes inexorably behind you. Around\n' +
  'you it is dark, but ahead is an enormous cavern, brightly lit. Through\n' +
  'its center runs a wide stream. Spanning the stream is a small wooden\n' +
  'footbridge, and beyond a path leads into a dark tunnel. Above the\n' +
  'bridge, floating in the air, is a large sign. It reads:  All ye who\n' +
  'stand before this bridge have completed a great and perilous adventure\n' +
  'which has tested your wit and courage. You have mastered\n' +
  'the first part of the ZORK trilogy. Those who pass over this bridge must be\n' +
  'prepared to undertake an even greater adventure that will severely test your\n' +
  'skill and bravery!\n' +
  '\n' +
  'The ZORK trilogy continues with "ZORK II: The Wizard of Frobozz" and\n' +
  'is completed in "ZORK III: The Dungeon Master."';

/**
 * STONE-BARROW-FCN — 1actions.zil:403–430.
 *
 * Fires on M-BEG for ENTER, WALK west/in, or THROUGH+BARROW.
 * Prints the victory text and calls finish() (web-shell: V-SCORE + gameOver).
 */
export const stoneBarrowFcn: ActionHandler = (ctx) => {
  if (ctx.rarg !== M_BEG) return false;

  const v = ctx.verb;
  const isEnter  = v === 'enter';
  const isWalkIn = v === 'walk' && (ctx.prep === 'west' || ctx.prep === 'in');
  const isThroughBarrow =
    v === 'through' &&
    ctx.dobj !== undefined &&
    (ctx.dobj.id === 'BARROW' || ctx.dobj.synonyms?.includes('barrow'));

  if (!isEnter && !isWalkIn && !isThroughBarrow) return false;

  ctx.tell(STONE_BARROW_VICTORY);
  ctx.finish?.();
  return true;
};

/** ACTION routines (rooms + objects) for the above-ground region. */
export const aboveGroundActions: Record<string, ActionHandler> = {
  'WEST-HOUSE': westHouse,
  'EAST-HOUSE': eastHouse,
  'KITCHEN-FCN': kitchenFcn,
  'LIVING-ROOM-FCN': livingRoomFcn,
  'CELLAR-FCN': cellarFcn,
  'CLEARING-FCN': clearingFcn,
  'MAZE-11-FCN': maze11Fcn,
  'TREE-ROOM': treeRoom,
  'FOREST-ROOM': forestRoom,
  'MAILBOX-F': mailboxF,
  'BOARD-F': boardF,
  'FRONT-DOOR-FCN': frontDoorFcn,
  'BOARDED-WINDOW-FCN': boardedWindowFcn,
  'KITCHEN-WINDOW-F': kitchenWindowF,
  'CHIMNEY-F': chimneyF,
  'TROPHY-CASE-FCN': trophyCaseFcn,
  'RUG-FCN': rugFcn,
  'TRAP-DOOR-FCN': trapDoorFcn,
  'GRATE-FUNCTION': grateFunction,
  'LEAF-PILE': leafPile,
  'PAINTING-FCN': paintingFcn,
  'SWORD-FCN': swordFcn,
  'GUNK-FUNCTION': gunkFunction,
  'EGG-OBJECT': eggObject,
  'CANARY-OBJECT': canaryObject,
  'SONGBIRD-F': songbirdF,
  'BARROW-DOOR-FCN': barrowDoorFcn,
  'BARROW-FCN': barrowFcn,
  'CRACK-FCN': crackFcn,
  'STONE-BARROW-FCN': stoneBarrowFcn,
  // CC9 — scenery/ambience
  'WHITE-HOUSE-F':  whiteHouseF,
  'FOREST-F':       forestF,
  'GRANITE-WALL-F': graniteWallF,
  'WCLIF-OBJECT':   wclifObject,
  'CLIFF-OBJECT':   cliffObject,
};

/** PER (exit-resolution) routines for the above-ground region. */
export const aboveGroundPer: Record<string, PerRoutine> = {
  'MAZE-DIODES': mazeDiodes,
  'TRAP-DOOR-EXIT': trapDoorExit,
  'UP-CHIMNEY-FUNCTION': upChimneyFunction,
  'GRATING-EXIT': gratingExit,
};
