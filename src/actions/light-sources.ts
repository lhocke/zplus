/**
 * Light-source region action routines.
 *
 * Hand-translations of ZIL routines from the "SUBTITLE LET THERE BE LIGHT
 * SOURCES" section of zil/1actions.zil: the brass lantern, ivory torch,
 * candles, and matchbook.
 *
 * Flag conventions (src/domain/flags.ts):
 *   Flag.OnFire    — currently lit/burning (ZIL ONBIT)
 *   Flag.Light     — provides light (ZIL LIGHTBIT)
 *   Flag.Burned    — lamp burned out beyond recovery (ZIL RMUNGBIT)
 *   Flag.Touched   — candles extinguished at least once (ZIL TOUCHBIT)
 *   Flag.Flammable — can be ignited (ZIL BURNBIT)
 */

import type { ActionHandler } from '../domain/game-object.js';
import { fmt, vLampOn, vLampOff } from '../engine/game-messages.js';
import type { World } from '../domain/world.js';
import { Flag } from '../domain/flags.js';

/** LANTERN — zil/1actions.zil:2230 */
export const lantern: ActionHandler = (ctx) => {
  const lamp = ctx.self;

  if (ctx.action === 'V-THROW') {
    ctx.tell('The lamp has smashed into the floor, and the light has gone out.');
    ctx.disableClock('I-LANTERN');
    ctx.clearFlag(lamp, Flag.OnFire);
    ctx.clearFlag(lamp, Flag.Light);

    const brokenLamp = ctx.world.get('BROKEN-LAMP');
    if (brokenLamp !== undefined) {
      brokenLamp.moveTo(ctx.here);
    }
    lamp.moveTo(null);
    return true;
  }

  if (ctx.action === 'V-LAMP-ON') {
    if (ctx.hasFlag(lamp, Flag.Burned)) {
      ctx.tell("A burned-out lamp won't light.");
      return true;
    }
    ctx.enableClock('I-LANTERN');
    ctx.setFlag(lamp, Flag.OnFire);
    ctx.setFlag(lamp, Flag.Light);
    // ZIL: V-LAMP-ON falls through to default "The [PRSO] is now on." (gverbs.zil:792)
    ctx.tell(fmt(vLampOn.turnedOn, lamp.desc));
    return true;
  }

  if (ctx.action === 'V-LAMP-OFF') {
    if (ctx.hasFlag(lamp, Flag.Burned)) {
      ctx.tell('The lamp has already burned out.');
      return true;
    }
    ctx.disableClock('I-LANTERN');
    ctx.clearFlag(lamp, Flag.OnFire);
    // ZIL: V-LAMP-OFF "The [PRSO] is now off." (gverbs.zil:779)
    ctx.tell(fmt(vLampOff.turnedOff, lamp.desc));
    return true;
  }

  if (ctx.action === 'V-EXAMINE') {
    if (ctx.hasFlag(lamp, Flag.Burned)) {
      ctx.tell('The lamp has burned out.');
    } else if (ctx.hasFlag(lamp, Flag.OnFire)) {
      ctx.tell('The lamp is on.');
    } else {
      ctx.tell('The lamp is turned off.');
    }
    return true;
  }

  return false;
};

// Mirrors ZIL's <GLOBAL MATCH-COUNT 6>. Module-level so state persists
// across turns; resetMatchCount() is provided for test isolation.
let matchCount = 6;

/** Reset to the ZIL default (6). Call from test setup. */
export function resetMatchCount(): void {
  matchCount = 6;
}

/** MATCH-FUNCTION — zil/1actions.zil:2265 */
export const matchFunction: ActionHandler = (ctx) => {
  const match = ctx.self;

  // Only the dobj branch handles lighting — when match is iobj (e.g. "burn
  // candles with match"), skip and let the candles handler take it.
  const matchIsDobj = ctx.dobj === match;

  // V-LAMP-ON covers turn-ON / activate / light; V-BURN covers burn/incinerate/ignite.
  const isLampOn = ctx.action === 'V-LAMP-ON';
  if (matchIsDobj && (ctx.action === 'V-BURN' || isLampOn)) {
    if (matchCount > 0) matchCount--;

    if (matchCount <= 0) {
      ctx.tell("I'm afraid that you have run out of matches.");
      return true;
    }

    // Drafty rooms blow out the match immediately.
    if (ctx.here.id === 'LOWER-SHAFT' || ctx.here.id === 'TIMBER-ROOM') {
      ctx.tell('This room is drafty, and the match goes out instantly.');
      return true;
    }

    ctx.setFlag(match, Flag.OnFire);
    ctx.setFlag(match, Flag.Light);
    // Re-arm the 2-tick countdown; idempotent if not yet burned (QUEUE I-MATCH 2 in ZIL).
    ctx.queueClock?.('I-MATCH', 2, true);
    ctx.tell('One of the matches starts to burn.');
    return true;
  }

  if (ctx.action === 'V-LAMP-OFF') {
    if (!ctx.hasFlag(match, Flag.OnFire)) return false;
    ctx.tell('The match is out.');
    ctx.clearFlag(match, Flag.OnFire);
    ctx.clearFlag(match, Flag.Light);
    ctx.disableClock('I-MATCH');
    return true;
  }

  // V-COUNT and V-OPEN both show the match count (ZIL: open matchbook = count).
  if (ctx.action === 'V-COUNT' || ctx.action === 'V-OPEN') {
    const cnt = matchCount - 1;
    if (cnt <= 0) {
      ctx.tell('You have no matches.');
    } else if (cnt === 1) {
      ctx.tell('You have 1 match.');
    } else {
      ctx.tell(`You have ${cnt} matches.`);
    }
    return true;
  }

  if (ctx.action === 'V-EXAMINE') {
    if (ctx.hasFlag(match, Flag.OnFire)) {
      ctx.tell('The match is burning.');
    } else {
      ctx.tell(
        "The matchbook isn't very interesting, except for what's written on it.",
      );
    }
    return true;
  }

  return false;
};

/**
 * iMatchTick — I-MATCH clock callback (zil/1actions.zil:2308).
 *
 * Receives world directly rather than an ActionContext because clock entries
 * fire outside the per-turn dispatch chain.
 */
export function iMatchTick(world: World, tell: (text: string) => void): void {
  const match = world.get('MATCH');
  if (match === undefined) return;
  tell('The match has gone out.');
  match.clear(Flag.OnFire);
  match.clear(Flag.Light);
}

/** CANDLES-FCN — zil/1actions.zil:2343 */
export const candlesFcn: ActionHandler = (ctx) => {
  const candles = ctx.self;

  // First-touch arming: if the candles have never been touched (no TOUCHBIT),
  // enable I-CANDLES so the burn countdown starts.  ZIL 1actions.zil:2343 —
  // this fires before the PRSI check, on any interaction with the candles.
  if (!ctx.hasFlag(candles, Flag.Touched)) {
    ctx.enableClock('I-CANDLES');
  }

  // When candles are the indirect object, fall through to the other handler.
  if (ctx.iobj === candles) return false;

  if (ctx.action === 'V-BURN' || ctx.action === 'V-LAMP-ON') {
    if (ctx.hasFlag(candles, Flag.Burned)) {
      ctx.tell(
        "Alas, there's not much left of the candles. Certainly not enough to burn.",
      );
      return true;
    }

    const iobj = ctx.iobj;

    if (iobj === undefined) {
      // Auto-light from a burning match if one is in scope.
      const match = ctx.world.get('MATCH');
      if (match !== undefined && ctx.hasFlag(match, Flag.OnFire)) {
        ctx.tell('(with the match)');
        if (ctx.hasFlag(candles, Flag.OnFire)) {
          ctx.tell('The candles are already lit.');
        } else {
          ctx.setFlag(candles, Flag.OnFire);
          ctx.setFlag(candles, Flag.Light);
          ctx.enableClock('I-CANDLES');
          ctx.tell('The candles are lit.');
        }
        return true;
      }
      ctx.tell('You should say what to light them with.');
      return true;
    }

    const match = ctx.world.get('MATCH');
    if (iobj === match) {
      if (!ctx.hasFlag(match, Flag.OnFire)) {
        ctx.tell(
          "You have to light them with something that's burning, you know.",
        );
        return true;
      }
      if (ctx.hasFlag(candles, Flag.OnFire)) {
        ctx.tell('The candles are already lit.');
      } else {
        ctx.setFlag(candles, Flag.OnFire);
        ctx.setFlag(candles, Flag.Light);
        ctx.enableClock('I-CANDLES');
        ctx.tell('The candles are lit.');
      }
      return true;
    }

    const torch = ctx.world.get('TORCH');
    if (iobj === torch) {
      if (ctx.hasFlag(candles, Flag.OnFire)) {
        ctx.tell(
          'You realize, just in time, that the candles are already lighted.',
        );
      } else {
        ctx.tell(
          'The heat from the torch is so intense that the candles are vaporized.',
        );
        candles.moveTo(null);
      }
      return true;
    }

    ctx.tell(
      "You have to light them with something that's burning, you know.",
    );
    return true;
  }

  if (ctx.action === 'V-COUNT') {
    ctx.tell(
      "Let's see, how many objects in a pair? Don't tell me, I'll get it.",
    );
    return true;
  }

  if (ctx.action === 'V-LAMP-OFF') {
    ctx.disableClock('I-CANDLES');
    if (ctx.hasFlag(candles, Flag.OnFire)) {
      ctx.clearFlag(candles, Flag.OnFire);
      ctx.setFlag(candles, Flag.Touched);
      ctx.tell("The flame is extinguished.");
      return true;
    }
    ctx.tell('The candles are not lighted.');
    return true;
  }

  // ZIL: <AND <VERB? PUT> <FSET? ,PRSI ,BURNBIT>> → "That wouldn't be smart."
  if (ctx.action === 'V-PUT' && ctx.iobj !== undefined &&
      ctx.hasFlag(ctx.iobj, Flag.Flammable)) {
    ctx.tell("That wouldn't be smart.");
    return true;
  }

  if (ctx.action === 'V-EXAMINE') {
    if (ctx.hasFlag(candles, Flag.OnFire)) {
      ctx.tell('The candles are burning.');
    } else {
      ctx.tell('The candles are out.');
    }
    return true;
  }

  return false;
};

/** TORCH-OBJECT — zil/1actions.zil:944 */
export const torchObject: ActionHandler = (ctx) => {
  const torch = ctx.self;

  if (ctx.action === 'V-EXAMINE') {
    ctx.tell('The torch is burning.');
    return true;
  }

  // ZIL: POUR water onto torch (PRSI = torch) → evaporates.
  // V-POUR-ON covers "pour X on Y"; torch is the iobj here.
  if (ctx.action === 'V-POUR-ON' && ctx.iobj === torch) {
    ctx.tell('The water evaporates before it gets close.');
    return true;
  }

  if (ctx.action === 'V-LAMP-OFF' && ctx.hasFlag(torch, Flag.OnFire)) {
    ctx.tell('You nearly burn your hand trying to extinguish the flame.');
    return true;
  }

  return false;
};

/** ACTION routines for the light-source objects. */
export const lightSourcesActions: Record<string, ActionHandler> = {
  'LANTERN': lantern,
  'MATCH-FUNCTION': matchFunction,
  'CANDLES-FCN': candlesFcn,
  'TORCH-OBJECT': torchObject,
};
