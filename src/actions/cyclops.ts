// cyclops.ts — CYCLOPS-FCN + CYCLOPS-ROOM-FCN.
//
// Transcription of:
//   CYCLOPS-FCN       1actions.zil:1515–1594
//   CYCLOPS-ROOM-FCN  1actions.zil:1616–1642
//
// C1 scope: the dispatch handlers + M-LOOK state branches + M-ENTER wrath enable.
// I-CYCLOPS wrath timer (C2) and V-ODYSSEUS (C3) are separate tasks.
//
// CYCLOPS-FLAG and MAGIC-FLAG are FlagStore keys (booleans gating exits);
// they are passed via the ctx getters/setters, consistent with the F1 decision.

import type { ActionContext, ActionHandler } from '../domain/game-object.js';
import { Flag } from '../domain/flags.js';
import { M_LOOK, M_ENTER } from '../engine/messages.js';
import { cyclowrath, setCyclowrath } from './thief-state.js';

// Minimal handle for objects CYCLOPS-FCN needs to touch.
export interface CyclopsObjHandle {
  readonly id: string;
  readonly parentId: string | null;
  hasFlag(f: Flag): boolean;
  setFlag(f: Flag): void;
  clearFlag(f: Flag): void;
  moveTo(destId: string): void;
  removeFromWorld(): void;
}

// Everything CYCLOPS-FCN and CYCLOPS-ROOM-FCN need at runtime.
export interface CyclopsCtx {
  /** ZIL HERE. */
  readonly hereId: string;
  /** ZIL PRSA — the parsed action, e.g. 'V-ATTACK', 'V-EXAMINE'. */
  readonly action: string;
  /** Surface verb word (e.g. 'kill', 'look') — use `action` for VERB? comparisons. */
  readonly verb: string;
  /** Direct object id (ZIL PRSO). */
  readonly prsoId?: string;
  /** Indirect object id (ZIL PRSI). */
  readonly prsiId?: string;
  /** Room rarg (M-LOOK / M-ENTER etc.); undefined for object actions. */
  readonly rarg?: number;
  /** ZIL WINNER — the acting creature (normally ADVENTURER; CYCLOPS on talk-to). */
  readonly winner: string;

  getCyclopsFlag(): boolean;
  setCyclopsFlag(v: boolean): void;
  getMagicFlag(): boolean;
  getCyclowrath(): number;
  setCyclowrath(v: number): void;

  getObj(id: string): CyclopsObjHandle | undefined;

  tell(s: string): void;
  enableClock(id: string): void;
  disableClock(id: string): void;
}

// ---------------------------------------------------------------------------
// CYCLOPS-FCN — 1actions.zil:1515–1594
//
// Object-action handler dispatched when CYCLOPS is PRSI (give) or PRSO
// (examine/attack/throw/etc.), or WINNER==CYCLOPS (talk-to).
// ---------------------------------------------------------------------------

export function cyclopsFcn(ctx: CyclopsCtx): boolean {
  const count = ctx.getCyclowrath();   // ZIL: SET COUNT ,CYCLOWRATH

  // ZIL branch 1: WINNER == CYCLOPS (player addressing it) — :1517–1526
  if (ctx.winner === 'CYCLOPS') {
    if (ctx.getCyclopsFlag()) {
      ctx.tell("No use talking to him. He's fast asleep.");
    } else if (ctx.action === 'V-ODYSSEUS') {
      // V-ODYSSEUS is C3; dispatch deferred — fall through (return false) so
      // the engine can route to V-ODYSSEUS via the verb table.
      return false;
    } else {
      ctx.tell('The cyclops prefers eating to making conversation.');
    }
    return true;
  }

  // ZIL branch 2: sleeping cyclops — :1527–1539
  // ZIL: <VERB? EXAMINE> and <VERB? ALARM KICK ATTACK BURN MUNG> test PRSA.
  if (ctx.getCyclopsFlag()) {
    if (ctx.action === 'V-EXAMINE') {
      ctx.tell('The cyclops is sleeping like a baby, albeit a very ugly one.');
      return true;
    }
    if (
      ctx.action === 'V-ALARM'  ||  // wake/awake/surprise/startle
      ctx.action === 'V-KICK'   ||  // kick/taunt
      ctx.action === 'V-ATTACK' ||  // attack/kill/stab/strike/knock-down
      ctx.action === 'V-BURN'   ||  // burn/incinerate/ignite
      ctx.action === 'V-MUNG'       // destroy/poke/puncture/damage/break/smash
    ) {
      ctx.tell('The cyclops yawns and stares at the thing that woke him up.');
      ctx.setCyclopsFlag(false);
      const cyclops = ctx.getObj('CYCLOPS');
      cyclops?.setFlag(Flag.Fight);
      // Restore wrath magnitude: if count was negative (thirsty), flip it; else keep.
      if (count < 0) {
        ctx.setCyclowrath(-count);
      } else {
        ctx.setCyclowrath(count);
      }
      return true;
    }
    // Unhandled while sleeping — fall through
    return false;
  }

  // ZIL branch 3: EXAMINE (awake) — :1540–1542
  // ZIL <VERB? EXAMINE>: V-EXAMINE covers both "examine X" and "look at X".
  if (ctx.action === 'V-EXAMINE') {
    ctx.tell('A hungry cyclops is standing at the foot of the stairs.');
    return true;
  }

  // ZIL branch 4: GIVE with PRSI == CYCLOPS — :1543–1574
  if (ctx.action === 'V-GIVE' && ctx.prsiId === 'CYCLOPS') {
    if (ctx.prsoId === 'LUNCH') {
      // Eat peppers only when count >= 0 (not yet thirsty)
      if (count >= 0) {
        ctx.getObj('LUNCH')?.removeFromWorld();
        ctx.tell(
          'The cyclops says "Mmm Mmm. I love hot peppers! But oh, could I use\n' +
          'a drink. Perhaps I could drink the blood of that thing."  From the\n' +
          'gleam in his eye, it could be surmised that you are "that thing".',
        );
        ctx.setCyclowrath(Math.min(-1, -count));
      }
      // I-CYCLOPS enabled unconditionally on the lunch path
      ctx.enableClock('I-CYCLOPS');
      return true;
    }

    // WATER — or BOTTLE containing WATER
    const isWater = ctx.prsoId === 'WATER';
    const isBottleWithWater =
      ctx.prsoId === 'BOTTLE' &&
      (ctx.getObj('WATER')?.parentId === 'BOTTLE');
    if (isWater || isBottleWithWater) {
      if (count < 0) {
        // Thirsty — cyclops drinks
        ctx.getObj('WATER')?.removeFromWorld();
        const bottle = ctx.getObj('BOTTLE');
        bottle?.moveTo(ctx.hereId);
        bottle?.setFlag(Flag.Open);
        ctx.getObj('CYCLOPS')?.clearFlag(Flag.Fight);
        ctx.tell(
          "The cyclops takes the bottle, checks that it's open, and drinks the water.\n" +
          'A moment later, he lets out a yawn that nearly blows you over, and then\n' +
          'falls fast asleep (what did you put in that drink, anyway?).',
        );
        ctx.setCyclopsFlag(true);
      } else {
        ctx.tell('The cyclops apparently is not thirsty and refuses your generous offer.');
      }
      return true;
    }

    if (ctx.prsoId === 'GARLIC') {
      ctx.tell('The cyclops may be hungry, but there is a limit.');
      return true;
    }

    ctx.tell('The cyclops is not so stupid as to eat THAT!');
    return true;
  }

  // ZIL branch 5: THROW / ATTACK / MUNG — :1575–1585
  // ZIL <VERB? THROW ATTACK MUNG> tests PRSA.
  //   V-THROW  covers "throw X at cyclops"
  //   V-ATTACK covers attack/kill/stab/strike/knock-down
  //   V-MUNG   covers destroy/poke/puncture/damage/break/smash
  if (
    ctx.action === 'V-THROW'  ||
    ctx.action === 'V-ATTACK' ||
    ctx.action === 'V-MUNG'
  ) {
    ctx.enableClock('I-CYCLOPS');
    if (ctx.action === 'V-MUNG') {
      ctx.tell('"Do you think I\'m as stupid as my father was?", he says, dodging.');
      return true;
    }
    ctx.tell('The cyclops shrugs but otherwise ignores your pitiful attempt.');
    if (ctx.action === 'V-THROW' && ctx.prsoId !== undefined) {
      ctx.getObj(ctx.prsoId)?.moveTo(ctx.hereId);
    }
    return true;
  }

  // ZIL branch 6: TAKE — :1586–1588
  if (ctx.action === 'V-TAKE') {
    ctx.tell("The cyclops doesn't take kindly to being grabbed.");
    return true;
  }

  // ZIL branch 7: TIE — :1589–1591
  if (ctx.action === 'V-TIE' || ctx.action === 'V-TIE-UP') {
    ctx.tell('You cannot tie the cyclops, though he is fit to be tied.');
    return true;
  }

  // ZIL branch 8: LISTEN — :1592–1594
  if (ctx.action === 'V-LISTEN') {
    ctx.tell('You can hear his stomach rumbling.');
    return true;
  }

  return false;
}

// ---------------------------------------------------------------------------
// CYCLOPS-ROOM-FCN — 1actions.zil:1616–1642
//
// Room action handler.  M-LOOK emits the base description + one state branch.
// M-ENTER enables I-CYCLOPS when CYCLOWRATH != 0.
// ---------------------------------------------------------------------------

export function cyclopsRoomFcn(ctx: CyclopsCtx): boolean {
  if (ctx.rarg === M_LOOK) {
    ctx.tell('This room has an exit on the northwest, and a staircase leading up.');

    if (ctx.getCyclopsFlag() && !ctx.getMagicFlag()) {
      ctx.tell('The cyclops is sleeping blissfully at the foot of the stairs.');
    } else if (ctx.getMagicFlag()) {
      ctx.tell(
        'The east wall, previously solid, now has a cyclops-sized opening in it.',
      );
    } else if (ctx.getCyclowrath() === 0) {
      ctx.tell(
        'A cyclops, who looks prepared to eat horses (much less mere\n' +
        'adventurers), blocks the staircase. From his state of health, and\n' +
        'the bloodstains on the walls, you gather that he is not very\n' +
        'friendly, though he likes people.',
      );
    } else if (ctx.getCyclowrath() > 0) {
      ctx.tell(
        "The cyclops is standing in the corner, eyeing you closely. I don't\n" +
        "think he likes you very much. He looks extremely hungry, even for a\n" +
        'cyclops.',
      );
    } else {
      // CYCLOWRATH < 0 — ate the peppers, gasping
      ctx.tell(
        'The cyclops, having eaten the hot peppers, appears to be gasping.\n' +
        'His enflamed tongue protrudes from his man-sized mouth.',
      );
    }

    return true;
  }

  if (ctx.rarg === M_ENTER) {
    // ZIL: <OR <0? ,CYCLOWRATH> <ENABLE <INT I-CYCLOPS>>>
    // Enable I-CYCLOPS only when CYCLOWRATH != 0.
    if (ctx.getCyclowrath() !== 0) {
      ctx.enableClock('I-CYCLOPS');
    }
    return false;  // ZIL <OR> short-circuits on truthy 1st arg; no RTRUE
  }

  return false;
}

// ---------------------------------------------------------------------------
// ActionContext → CyclopsCtx bridge
//
// Wires the ActionContext (from the engine) to the CyclopsCtx interface.
// Reads CYCLOPS-FLAG and MAGIC-FLAG from the FlagStore via getGlobal/setGlobal.
// ---------------------------------------------------------------------------

function makeCtxFromAction(ac: ActionContext): CyclopsCtx {
  return {
    hereId:  ac.here.id,
    action:  ac.action ?? ac.verb,   // ZIL PRSA; fall back to verb word when absent
    verb:    ac.verb,
    prsoId:  ac.dobj?.id,
    prsiId:  ac.iobj?.id,
    rarg:    ac.rarg,
    winner:  ac.actor.id,

    getCyclopsFlag: () => ac.getGlobal?.('CYCLOPS-FLAG') ?? false,
    setCyclopsFlag: (v) => ac.setGlobal?.('CYCLOPS-FLAG', v),
    getMagicFlag:   () => ac.getGlobal?.('MAGIC-FLAG') ?? false,
    getCyclowrath:  () => cyclowrath(),
    setCyclowrath:  (v) => setCyclowrath(v),

    getObj: (id) => {
      const obj = ac.world.get(id);
      if (obj === undefined) return undefined;
      return {
        get id()       { return obj.id; },
        get parentId() { return obj.parent?.id ?? null; },
        hasFlag:  (f) => ac.hasFlag(obj, f),
        setFlag:  (f) => ac.setFlag(obj, f),
        clearFlag:(f) => ac.clearFlag(obj, f),
        moveTo:   (destId) => {
          const dest = ac.world.get(destId);
          if (dest !== undefined) ac.moveTo(obj, dest);
        },
        removeFromWorld: () => obj.moveTo(null),
      };
    },

    tell:         (s) => ac.tell(s),
    enableClock:  (id) => ac.enableClock(id),
    disableClock: (id) => ac.disableClock(id),
  };
}

/** CYCLOPS-FCN ActionHandler — registered in ACTIONS. */
export const cyclopsFcnAction: ActionHandler = (ac) =>
  cyclopsFcn(makeCtxFromAction(ac));

/** CYCLOPS-ROOM-FCN ActionHandler — registered in ACTIONS. */
export const cyclopsRoomFcnAction: ActionHandler = (ac) =>
  cyclopsRoomFcn(makeCtxFromAction(ac));
