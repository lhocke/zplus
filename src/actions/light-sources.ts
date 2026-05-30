/**
 * Light-source region action routines.
 *
 * Hand-translation of every routine under the
 * "SUBTITLE LET THERE BE LIGHT SOURCES" section of zil/1actions.zil.
 * Covers the brass LANTERN, the ivory TORCH, the pair of CANDLES, and the
 * MATCH (matchbook).
 *
 * The LANTERN fuel interrupt (I-LANTERN) is gated here: turning the lamp on
 * calls ctx.enableClock('I-LANTERN'); turning it off calls
 * ctx.disableClock('I-LANTERN').  Bootstrap registers the entry disabled so
 * drain only runs while the lamp is actively burning.
 *
 * Flag conventions (see src/domain/flags.ts and tools/extract-zil/extract.ts):
 *   Flag.OnFire   — object is currently lit/burning (ZIL ONBIT)
 *   Flag.Light    — object provides light (ZIL LIGHTBIT)
 *   Flag.Burned   — lamp has burned out beyond recovery (ZIL RMUNGBIT)
 *   Flag.Touched  — candles have been touched / extinguished at least once (ZIL TOUCHBIT)
 *   Flag.Flammable — object is flammable / can be ignited (ZIL BURNBIT)
 */

import type { ActionHandler } from '../domain/game-object.js';
import type { World } from '../domain/world.js';
import { Flag } from '../domain/flags.js';

// ---------------------------------------------------------------------------
// LANTERN — the brass battery-powered lantern (zil/1actions.zil:2230).
//
// ZIL routine LANTERN() branches on PRSA:
//   THROW    — smashes the lamp, disables I-LANTERN, moves BROKEN-LAMP here.
//   LAMP-ON  — if burned out, refuse; otherwise enable I-LANTERN and set lit.
//   LAMP-OFF — if burned out, refuse; otherwise disable I-LANTERN and clear lit.
//   EXAMINE  — describe current state.
//
// In ZIL, LAMP-ON and LAMP-OFF return RFALSE so the default verb handler can
// set or clear the ONBIT/LIGHTBIT.  In the TS engine the default verb layer
// has no concept of lamp-state flags, so we manage Flag.OnFire (ONBIT) and
// Flag.Light (LIGHTBIT) directly and return true (RTRUE) to suppress the
// fallthrough.
// ---------------------------------------------------------------------------

export const lantern: ActionHandler = (ctx) => {
  const lamp = ctx.self;

  if (ctx.verb === 'throw') {
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

  // ZIL verb LAMP-ON → player typed "turn on <lamp>" or "light <lamp>".
  if (ctx.verb === 'turn' && ctx.prep === 'on') {
    if (ctx.hasFlag(lamp, Flag.Burned)) {
      ctx.tell("A burned-out lamp won't light.");
      return true;
    }
    ctx.enableClock('I-LANTERN');
    ctx.setFlag(lamp, Flag.OnFire);
    ctx.setFlag(lamp, Flag.Light);
    ctx.tell('The lamp is now on.');
    return true;
  }

  // ZIL verb LAMP-OFF → player typed "turn off <lamp>" or "extinguish <lamp>".
  if (ctx.verb === 'extinguish' || (ctx.verb === 'turn' && ctx.prep === 'off')) {
    if (ctx.hasFlag(lamp, Flag.Burned)) {
      ctx.tell('The lamp has already burned out.');
      return true;
    }
    ctx.disableClock('I-LANTERN');
    ctx.clearFlag(lamp, Flag.OnFire);
    ctx.tell('The lamp is now off.');
    return true;
  }

  if (ctx.verb === 'examine') {
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

// ---------------------------------------------------------------------------
// MATCH-FUNCTION — the matchbook (zil/1actions.zil:2265).
//
// ZIL <GLOBAL MATCH-COUNT 6> — decrements with each lighting attempt.
// Branches on PRSA:
//   LAMP-ON / BURN  — attempt to light; check drafty rooms and count.
//   LAMP-OFF        — extinguish a burning match.
//   COUNT / OPEN    — report remaining matches.
//   EXAMINE         — describe the matchbook.
//
// The I-MATCH interrupt is queued for 2 turns on lighting; it extinguishes
// the match automatically.  We gate it through enableClock/disableClock on
// the clock entry registered by bootstrap.
// ---------------------------------------------------------------------------

// Mirrors ZIL's <GLOBAL MATCH-COUNT 6>.  Module-level so state persists
// within a game session; resetMatchCount() is provided for test isolation.
let matchCount = 6;

/** Reset to the ZIL default (6).  Call from test setup. */
export function resetMatchCount(): void {
  matchCount = 6;
}

export const matchFunction: ActionHandler = (ctx) => {
  const match = ctx.self;

  if (ctx.verb === 'burn' || (ctx.verb === 'turn' && ctx.prep === 'on')) {
    // ZIL decrements MATCH-COUNT before testing whether it hit zero.
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
    ctx.enableClock('I-MATCH');
    ctx.tell('One of the matches starts to burn.');
    return true;
  }

  if (ctx.verb === 'extinguish' || (ctx.verb === 'turn' && ctx.prep === 'off')) {
    if (!ctx.hasFlag(match, Flag.OnFire)) return false;
    ctx.tell('The match is out.');
    ctx.clearFlag(match, Flag.OnFire);
    ctx.clearFlag(match, Flag.Light);
    ctx.disableClock('I-MATCH');
    return true;
  }

  if (ctx.verb === 'count' || ctx.verb === 'open') {
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

  if (ctx.verb === 'examine') {
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

// ---------------------------------------------------------------------------
// iMatchTick — runtime callback for the I-MATCH clock entry.
//
// Mirrors <ROUTINE I-MATCH> from zil/1actions.zil:2308.  Called by the clock
// entry registered in bootstrap; receives the world directly (not an
// ActionContext) because the clock fires outside the per-turn dispatch chain.
// ---------------------------------------------------------------------------

export function iMatchTick(world: World, tell: (text: string) => void): void {
  const match = world.get('MATCH');
  if (match === undefined) return;
  tell('The match has gone out.');
  match.clear(Flag.OnFire);
  match.clear(Flag.Light);
}

// ---------------------------------------------------------------------------
// CANDLES-FCN — the pair of candles (zil/1actions.zil:2343).
//
// ZIL branches:
//   If PRSI is the candles → RFALSE (we are the iobj, not the dobj).
//   LAMP-ON / BURN  — light with an ignition source (match or torch).
//   COUNT           — a comedic non-answer.
//   LAMP-OFF        — extinguish.
//   PUT with flammable PRSI → warn.
//   EXAMINE         — describe.
//
// Candle-lighting sub-cases from the ZIL:
//   RMUNGBIT set    — spent; refuse.
//   No PRSI + match burning → light automatically (with the match).
//   No PRSI otherwise → "You should say what to light them with."
//   PRSI=MATCH lit  → light or "already lit."
//   PRSI=TORCH      → vaporize or "already lighted."
//   Any other PRSI  → "You have to light them with something that's burning."
// ---------------------------------------------------------------------------

export const candlesFcn: ActionHandler = (ctx) => {
  const candles = ctx.self;

  // If the candles are the indirect object for this command, fall through.
  if (ctx.iobj === candles) return false;

  if (ctx.verb === 'burn' || (ctx.verb === 'turn' && ctx.prep === 'on')) {
    if (ctx.hasFlag(candles, Flag.Burned)) {
      ctx.tell(
        "Alas, there's not much left of the candles. Certainly not enough to burn.",
      );
      return true;
    }

    const iobj = ctx.iobj;

    if (iobj === undefined) {
      // Check whether the match is already burning — auto-light from it.
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

    // Ignition source is the burning match.
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

    // Ignition source is the torch.
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

    // Unrecognised ignition source.
    ctx.tell(
      "You have to light them with something that's burning, you know.",
    );
    return true;
  }

  if (ctx.verb === 'count') {
    ctx.tell(
      "Let's see, how many objects in a pair? Don't tell me, I'll get it.",
    );
    return true;
  }

  if (ctx.verb === 'extinguish' || (ctx.verb === 'turn' && ctx.prep === 'off')) {
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
  // BURNBIT maps to Flag.Flammable in the TS data.
  if (ctx.verb === 'put' && ctx.iobj !== undefined &&
      ctx.hasFlag(ctx.iobj, Flag.Flammable)) {
    ctx.tell("That wouldn't be smart.");
    return true;
  }

  if (ctx.verb === 'examine') {
    if (ctx.hasFlag(candles, Flag.OnFire)) {
      ctx.tell('The candles are burning.');
    } else {
      ctx.tell('The candles are out.');
    }
    return true;
  }

  return false;
};

// ---------------------------------------------------------------------------
// TORCH-OBJECT — the ivory torch (zil/1actions.zil:944).
//
// The torch is permanently lit; it cannot be extinguished.
//   EXAMINE               — "The torch is burning."
//   POUR (with torch PRSI) — "The water evaporates before it gets close."
//   LAMP-OFF              — "You nearly burn your hand trying to extinguish…"
// ---------------------------------------------------------------------------

export const torchObject: ActionHandler = (ctx) => {
  const torch = ctx.self;

  if (ctx.verb === 'examine') {
    ctx.tell('The torch is burning.');
    return true;
  }

  if (ctx.verb === 'pour' && ctx.iobj === torch) {
    ctx.tell('The water evaporates before it gets close.');
    return true;
  }

  if (
    (ctx.verb === 'extinguish' || (ctx.verb === 'turn' && ctx.prep === 'off')) &&
    ctx.hasFlag(torch, Flag.OnFire)
  ) {
    ctx.tell('You nearly burn your hand trying to extinguish the flame.');
    return true;
  }

  return false;
};

// ---------------------------------------------------------------------------
// Exported region map — keyed by ZIL routine name.
// ---------------------------------------------------------------------------

/** ACTION routines for the light-source objects. */
export const lightSourcesActions: Record<string, ActionHandler> = {
  'LANTERN':        lantern,
  'MATCH-FUNCTION': matchFunction,
  'CANDLES-FCN':    candlesFcn,
  'TORCH-OBJECT':   torchObject,
};
