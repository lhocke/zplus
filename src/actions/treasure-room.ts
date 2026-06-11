// treasure-room.ts — TREASURE-ROOM-FCN, THIEF-IN-TREASURE, CHALICE-FCN,
// STILETTO-FUNCTION (via WEAPON-FUNCTION), LARGE-BAG-F, DUMB-CONTAINER.
//
// Transcription of:
//   STILETTO-FUNCTION    1actions.zil:626–627
//   WEAPON-FUNCTION      1actions.zil:629–638
//   LARGE-BAG-F          1actions.zil:2094–2112
//   CHALICE-FCN          1actions.zil:2123–2136
//   TREASURE-ROOM-FCN    1actions.zil:2138–2149
//   THIEF-IN-TREASURE    1actions.zil:2151–2161
//   DUMB-CONTAINER       1actions.zil:4154–4158
//
// ActionHandler wrappers (for registry.ts ACTIONS) adapt ActionContext → T4Ctx.
// The thief LDESC check reads thief-state.ts module state so it sees F_UNCONSCIOUS
// writes from robber-fcn.ts.

import type { ActionContext, ActionHandler } from '../domain/game-object.js';
import { Flag } from '../domain/flags.js';
import { M_ENTER } from '../engine/messages.js';
import { ROBBER_U_DESC, thiefLdesc } from './thief-state.js';

/** Minimal object handle the treasure-room routines need. */
export interface T4ObjHandle {
  readonly id: string;
  readonly parentId: string | null;
  readonly desc: string;
  readonly tvalue: number;
  /** Current LDESC, if any — read to detect unconscious thief. */
  readonly ldesc?: string;
  hasFlag(f: Flag): boolean;
  setFlag(f: Flag): void;
  clearFlag(f: Flag): void;
  moveTo(destId: string): void;
}

/** Context shared by all T4 routines. */
export interface T4Ctx {
  /** ZIL HERE — current player room. */
  readonly hereId: string;

  /** Current parsed verb (ZIL PRSA). */
  readonly verb: string;
  /** Direct object id (ZIL PRSO). */
  readonly prsoId?: string;
  /** Indirect object id (ZIL PRSI). */
  readonly prsiId?: string;
  /** Room-handler rarg (M-ENTER / M-LOOK etc.), undefined for object actions. */
  readonly rarg?: number;

  /** Whether I-THIEF is currently enabled (C-ENABLED? is 1). */
  isIThiefEnabled(): boolean;
  /** Whether the player is dead (DEAD global). */
  isDead(): boolean;

  getObj(id: string): T4ObjHandle | undefined;
  /** Ordered list of direct children ids of a container. */
  childrenOf(containerId: string): string[];

  tell(s: string): void;
}

// ---------------------------------------------------------------------------
// TREASURE-ROOM-FCN — 1actions.zil:2138–2149
//
// M-ENTER only.  Preconditions: I-THIEF enabled and player not dead.
// • If thief not already here: print scream, move thief to HERE.
// • FSET FIGHTBIT on thief; FCLEAR INVISIBLE on thief.
// • Run THIEF-IN-TREASURE.
// ---------------------------------------------------------------------------

export function treasureRoomFcn(ctx: T4Ctx): boolean {
  if (ctx.rarg !== M_ENTER) return false;
  if (!ctx.isIThiefEnabled()) return false;
  if (ctx.isDead()) return false;

  const thief = ctx.getObj('THIEF');

  if (thief !== undefined && thief.parentId !== ctx.hereId) {
    ctx.tell(
      'You hear a scream of anguish as you violate the robber\'s hideaway.\n' +
      'Using passages unknown to you, he rushes to its defense.',
    );
    thief.moveTo(ctx.hereId);
  }

  thief?.setFlag(Flag.Fight);
  thief?.clearFlag(Flag.Invisible);

  thiefInTreasure(ctx);
  return true;
}

// ---------------------------------------------------------------------------
// THIEF-IN-TREASURE — 1actions.zil:2151–2161
//
// When ≥2 children are in the room: print the "gestures mysteriously" message.
// Then walk ALL children: set INVISIBLE on each except CHALICE and THIEF.
// ---------------------------------------------------------------------------

export function thiefInTreasure(ctx: T4Ctx): void {
  const children = ctx.childrenOf(ctx.hereId);

  // ZIL: <AND .F <NEXT? .F>> — true when at least 2 children exist
  if (children.length >= 2) {
    ctx.tell(
      'The thief gestures mysteriously, and the treasures in the room\nsuddenly vanish.',
    );
  }

  for (const childId of children) {
    if (childId === 'CHALICE' || childId === 'THIEF') continue;
    ctx.getObj(childId)?.setFlag(Flag.Invisible);
  }
}

// ---------------------------------------------------------------------------
// DUMB-CONTAINER — 1actions.zil:4154–4158
//
// Handles OPEN/CLOSE/LOOK-INSIDE with "You can't do that." and EXAMINE with
// "It looks pretty much like a <desc>."  Returns false for everything else.
//
// Exposed as a standalone export (and used as CHALICE-FCN's else fallthrough)
// so it can be registered as its own ACTIONS entry for the ivory torch.
// ---------------------------------------------------------------------------

export function dumbContainer(ctx: T4Ctx): boolean {
  const v = ctx.verb;
  if (v === 'open' || v === 'close' || v === 'look-inside') {
    ctx.tell("You can't do that.");
    return true;
  }
  if (v === 'examine') {
    const prso = ctx.prsoId !== undefined ? ctx.getObj(ctx.prsoId) : undefined;
    ctx.tell('It looks pretty much like a ' + (prso?.desc ?? 'that') + '.');
    return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// CHALICE-FCN — 1actions.zil:2123–2136
//
// 1. TAKE while a live, visible thief guards TREASURE-ROOM → "stabbed in the back"
// 2. PUT with PRSI==CHALICE → "not a very good chalice"
// 3. else → DUMB-CONTAINER
// ---------------------------------------------------------------------------

export function chaliceFcn(ctx: T4Ctx): boolean {
  const v = ctx.verb;

  if (v === 'take') {
    // Guard: PRSO in TREASURE-ROOM, THIEF in TREASURE-ROOM, FIGHTBIT,
    //        !INVISIBLE, !unconscious-LDESC  — 1actions.zil:2125–2131
    const prso  = ctx.prsoId !== undefined ? ctx.getObj(ctx.prsoId) : undefined;
    const thief = ctx.getObj('THIEF');

    if (
      prso !== undefined &&
      prso.parentId === 'TREASURE-ROOM' &&
      thief !== undefined &&
      thief.parentId === 'TREASURE-ROOM' &&
      thief.hasFlag(Flag.Fight) &&
      !thief.hasFlag(Flag.Invisible) &&
      thief.ldesc !== ROBBER_U_DESC
    ) {
      ctx.tell("You'd be stabbed in the back first.");
      return true;
    }
    // TAKE falls through to DUMB-CONTAINER (returns false there too)
    return false;
  }

  if (v === 'put' && ctx.prsiId === 'CHALICE') {
    ctx.tell("You can't. It's not a very good chalice, is it?");
    return true;
  }

  return dumbContainer(ctx);
}

// ---------------------------------------------------------------------------
// WEAPON-FUNCTION — 1actions.zil:629–638
//
// W = weapon object id; V = villain object id.
// • If V not in HERE: return false (no-op).
// • TAKE: if W in V → "V swings it out of reach"; else → "W white-hot"
// ---------------------------------------------------------------------------

function weaponFunction(ctx: T4Ctx, weaponId: string, villainId: string): boolean {
  const villain = ctx.getObj(villainId);
  if (villain === undefined || villain.parentId !== ctx.hereId) return false;

  if (ctx.verb === 'take') {
    const weapon = ctx.getObj(weaponId);
    if (weapon !== undefined && weapon.parentId === villainId) {
      ctx.tell('The ' + villain.desc + ' swings it out of your reach.');
    } else {
      ctx.tell("The " + (weapon?.desc ?? weaponId.toLowerCase()) + " seems white-hot. You can't hold on to it.");
    }
    return true;
  }

  return false;
}

// ---------------------------------------------------------------------------
// STILETTO-FUNCTION — 1actions.zil:626–627
//
// Delegates to WEAPON-FUNCTION(STILETTO, THIEF).
// ---------------------------------------------------------------------------

export function stilettoFunction(ctx: T4Ctx): boolean {
  return weaponFunction(ctx, 'STILETTO', 'THIEF');
}

// ---------------------------------------------------------------------------
// LARGE-BAG-F — 1actions.zil:2094–2112
// ---------------------------------------------------------------------------

export function largeBagF(ctx: T4Ctx): boolean {
  const v = ctx.verb;

  if (v === 'take') {
    const thief = ctx.getObj('THIEF');
    if (thief !== undefined && thief.ldesc === ROBBER_U_DESC) {
      ctx.tell(
        'Sadly for you, the robber collapsed on top of the bag. Trying to take\n' +
        'it would wake him.',
      );
    } else {
      ctx.tell('The bag will be taken over his dead body.');
    }
    return true;
  }

  if (v === 'put' && ctx.prsiId === 'LARGE-BAG') {
    ctx.tell('It would be a good trick.');
    return true;
  }

  if (v === 'open' || v === 'close') {
    ctx.tell('Getting close enough would be a good trick.');
    return true;
  }

  if (v === 'examine' || v === 'look-inside') {
    ctx.tell(
      "The bag is underneath the thief, so one can't say what, if anything, is\ninside.",
    );
    return true;
  }

  return false;
}

// ---------------------------------------------------------------------------
// ActionContext → T4Ctx bridge
//
// Each ActionHandler wrapper builds a T4Ctx from the incoming ActionContext
// and delegates to the corresponding T4 function.  These are the forms
// registered in ACTIONS.
// ---------------------------------------------------------------------------

function makeT4Ctx(ac: ActionContext): T4Ctx {
  return {
    hereId: ac.here.id,
    verb: ac.verb,
    prsoId: ac.dobj?.id,
    prsiId: ac.iobj?.id,
    rarg: ac.rarg,

    isIThiefEnabled: () => ac.isClockEnabled?.('I-THIEF') ?? false,
    isDead: () => ac.isDead?.() ?? false,

    getObj: (id) => {
      const obj = ac.world.get(id);
      if (obj === undefined) return undefined;
      return {
        get id()       { return obj.id; },
        get parentId() { return obj.parent?.id ?? null; },
        get desc()     { return obj.desc; },
        get tvalue()   { return (obj.props.get('TVALUE') ?? 0) as number; },
        // For THIEF: read the module-level ldesc from thief-state, since
        // F_UNCONSCIOUS writes it there — not to obj.ldesc.
        get ldesc()    {
          return id === 'THIEF' ? thiefLdesc() : obj.ldesc;
        },
        hasFlag: (f) => ac.hasFlag(obj, f),
        setFlag: (f) => ac.setFlag(obj, f),
        clearFlag: (f) => ac.clearFlag(obj, f),
        moveTo: (destId) => {
          const dest = ac.world.get(destId);
          if (dest !== undefined) ac.moveTo(obj, dest);
        },
      };
    },

    childrenOf: (containerId) => {
      return ac.world.contents(containerId).map((o) => o.id);
    },

    tell: (s) => ac.tell(s),
  };
}

/** TREASURE-ROOM-FCN ActionHandler — registered as a room action in ACTIONS. */
export const treasureRoomFcnAction: ActionHandler = (ac) =>
  treasureRoomFcn(makeT4Ctx(ac));

/** CHALICE-FCN ActionHandler. */
export const chaliceFcnAction: ActionHandler = (ac) =>
  chaliceFcn(makeT4Ctx(ac));

/** STILETTO-FUNCTION ActionHandler. */
export const stilettoFunctionAction: ActionHandler = (ac) =>
  stilettoFunction(makeT4Ctx(ac));

/** LARGE-BAG-F ActionHandler. */
export const largeBagFAction: ActionHandler = (ac) =>
  largeBagF(makeT4Ctx(ac));

/** DUMB-CONTAINER ActionHandler. */
export const dumbContainerAction: ActionHandler = (ac) =>
  dumbContainer(makeT4Ctx(ac));
