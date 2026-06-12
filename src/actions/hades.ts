/**
 * Hades region action routines — CC1.
 *
 * Hand-translations of ZIL routines from the "SUBTITLE LAND OF THE DEAD"
 * section of zil/1actions.zil:1058–1150, plus the object FCNs at:
 *   GHOSTS-F      1actions.zil:264–273
 *   BELL-F        1actions.zil:343–349
 *   HOT-BELL-F    1actions.zil:351–368
 *   BLACK-BOOK    1actions.zil:2187–2205
 *
 * Global flags:
 *   XB       — bell has been rung; ceremony is in progress
 *   XC       — candles held while XB; ready to read the prayer
 *   LLD-FLAG — exorcism complete; gate is open
 *
 * Clock slots registered by bootstrap.ts (parked); armed here:
 *   I-XB  (6 ticks)  — ceremony timeout; rings break on lapse
 *   I-XC  (3 ticks)  — window to read the prayer after candles held
 *   I-XBH (20 ticks) — bell cools down; BELL returns to gate
 */

import type { ActionHandler } from '../domain/game-object.js';
import { Flag } from '../domain/flags.js';
import { M_BEG, M_END, M_LOOK } from '../engine/messages.js';

// ---------------------------------------------------------------------------
// LLD-ROOM — 1actions.zil:1058–1125
// ---------------------------------------------------------------------------

export const lldRoomFcn: ActionHandler = (ctx) => {
  if (ctx.rarg === M_LOOK) {
    // Gateway description — always printed.
    ctx.tell(
      'You are outside a large gateway, on which is inscribed\n' +
      '  Abandon every hope\n' +
      'all ye who enter here!\n\n' +
      'The gate is open; through it you can see a desolation, with a pile of\n' +
      'mangled bodies in one corner. Thousands of voices, lamenting some\n' +
      'hideous fate, can be heard.',
    );
    // Spirit-bar line: only if not yet exorcised and player is alive.
    if (!ctx.getGlobal?.('LLD-FLAG') && !ctx.isDead?.()) {
      ctx.tell(
        'The way through the gate is barred by evil spirits, who jeer at your\n' +
        'attempts to pass.',
      );
    }
    return true;
  }

  if (ctx.rarg === M_BEG) {
    // V-EXORCISE: equipped-check messages.
    if (ctx.action === 'V-EXORCISE') {
      if (!ctx.getGlobal?.('LLD-FLAG')) {
        const player = ctx.actor;
        const bell = ctx.world.get('BELL');
        const book = ctx.world.get('BOOK');
        const candles = ctx.world.get('CANDLES');
        const allEquipped = bell?.parent === player &&
                            book?.parent === player &&
                            candles?.parent === player;
        if (allEquipped) {
          ctx.tell('You must perform the ceremony.');
        } else {
          ctx.tell("You aren't equipped for an exorcism.");
        }
      }
      return true;
    }

    // RING BELL — 1actions.zil:1082–1101.
    const lldFlag = ctx.getGlobal?.('LLD-FLAG') ?? false;
    if (!lldFlag && ctx.action === 'V-RING') {
      const bell = ctx.world.get('BELL');
      if (bell !== undefined && ctx.dobj === bell) {
        ctx.setGlobal?.('XB', true);

        // REMOVE-CAREFULLY BELL: take it out of world.
        bell.moveTo(null);

        // Move HOT-BELL into room and bind pronoun.
        const hotBell = ctx.world.get('HOT-BELL');
        if (hotBell !== undefined) {
          hotBell.moveTo(ctx.here);
          ctx.thisIsIt?.(hotBell);
        }

        ctx.tell(
          'The bell suddenly becomes red hot and falls to the ground. The\n' +
          'wraiths, as if paralyzed, stop their jeering and slowly turn to face\n' +
          'you. On their ashen faces, the expression of a long-forgotten terror\n' +
          'takes shape.',
        );

        // Drop and extinguish carried candles — 1actions.zil:1094–1099.
        const candles = ctx.world.get('CANDLES');
        if (candles !== undefined && candles.parent === ctx.actor) {
          ctx.tell(
            'In your confusion, the candles drop to the ground (and they are out).',
          );
          candles.moveTo(ctx.here);
          ctx.clearFlag(candles, Flag.OnFire);
          ctx.disableClock('I-CANDLES');
        }

        // Arm ceremony timers — 1actions.zil:1100–1101.
        ctx.queueClock?.('I-XB', 6, true);
        ctx.queueClock?.('I-XBH', 20, true);

        return true;
      }
    }

    // READ BOOK (requires XC=T) — 1actions.zil:1102–1113.
    if (ctx.getGlobal?.('XC') &&
        ctx.action === 'V-READ' &&
        !ctx.getGlobal?.('LLD-FLAG')) {
      const book = ctx.world.get('BOOK');
      if (book !== undefined && ctx.dobj === book) {
        ctx.tell(
          'Each word of the prayer reverberates through the hall in a deafening\n' +
          'confusion. As the last word fades, a voice, loud and commanding,\n' +
          'speaks: "Begone, fiends!" A heart-stopping scream fills the cavern,\n' +
          'and the spirits, sensing a greater power, flee through the walls.',
        );

        // REMOVE-CAREFULLY GHOSTS.
        const ghosts = ctx.world.get('GHOSTS');
        if (ghosts !== undefined) ghosts.moveTo(null);

        ctx.setGlobal?.('LLD-FLAG', true);
        ctx.disableClock('I-XC');
        return true;
      }
    }

    return false;
  }

  if (ctx.rarg === M_END) {
    // Candles held and lit while XB active but XC not yet set — 1actions.zil:1115–1125.
    const xb = ctx.getGlobal?.('XB') ?? false;
    const xc = ctx.getGlobal?.('XC') ?? false;
    if (xb && !xc) {
      const candles = ctx.world.get('CANDLES');
      if (candles !== undefined &&
          candles.parent === ctx.actor &&
          ctx.hasFlag(candles, Flag.OnFire)) {
        ctx.setGlobal?.('XC', true);
        ctx.tell(
          'The flames flicker wildly and appear to dance. The earth beneath\n' +
          'your feet trembles, and your legs nearly buckle beneath you.\n' +
          'The spirits cower at your unearthly power.',
        );
        ctx.disableClock('I-XB');
        ctx.queueClock?.('I-XC', 3, true);
      }
    }
    return false;
  }

  return false;
};

// ---------------------------------------------------------------------------
// GHOSTS-F — 1actions.zil:264–273
// ---------------------------------------------------------------------------

export const ghostsFcn: ActionHandler = (ctx) => {
  if (ctx.action === 'V-TELL') {
    ctx.tell('The spirits jeer loudly and ignore you.');
    return true;
  }
  if (ctx.action === 'V-EXORCISE') {
    ctx.tell('Only the ceremony itself has any effect.');
    return true;
  }
  // ATTACK / MUNG with GHOSTS as dobj.
  if (ctx.action === 'V-ATTACK' || ctx.action === 'V-MUNG') {
    if (ctx.dobj === ctx.self) {
      ctx.tell('How can you attack a spirit with material objects?');
      return true;
    }
  }
  ctx.tell('You seem unable to interact with these spirits.');
  return true;
};

// ---------------------------------------------------------------------------
// BELL-F — 1actions.zil:343–349
//
// At ENTRANCE-TO-HADES without LLD-FLAG: fall through (RFALSE) to let
// LLD-ROOM M-BEG intercept the ring.  Everywhere else: "Ding, dong."
// ---------------------------------------------------------------------------

export const bellFcn: ActionHandler = (ctx) => {
  if (ctx.action === 'V-RING') {
    if (ctx.here.id === 'ENTRANCE-TO-HADES' &&
        !ctx.getGlobal?.('LLD-FLAG')) {
      // Let LLD-ROOM M-BEG handle it.
      return false;
    }
    ctx.tell('Ding, dong.');
    return true;
  }
  return false;
};

// ---------------------------------------------------------------------------
// HOT-BELL-F — 1actions.zil:351–368
// ---------------------------------------------------------------------------

export const hotBellFcn: ActionHandler = (ctx) => {
  if (ctx.action === 'V-TAKE') {
    ctx.tell('The bell is very hot and cannot be taken.');
    return true;
  }

  // RUB or RING with PRSI (instrument): check if PRSI burns.
  const isRub  = ctx.action === 'V-RUB';
  const isRing = ctx.action === 'V-RING' && ctx.iobj !== undefined;
  if (isRub || isRing) {
    const instr = ctx.iobj;
    if (instr !== undefined) {
      if (ctx.hasFlag(instr, Flag.Flammable)) {
        ctx.tell(`The ${instr.desc} burns and is consumed.`);
        instr.moveTo(null);  // REMOVE-CAREFULLY PRSI
        return true;
      }
      // PRSI = HANDS (no explicit object) — "too hot to touch".
      // In the engine HANDS is not an object; iobj being present means
      // the player specified something that isn't flammable.
      ctx.tell('The heat from the bell is too intense.');
      return true;
    }
    ctx.tell('The bell is too hot to touch.');
    return true;
  }

  // POUR-ON (water cools bell) — 1actions.zil:362–366.
  if (ctx.action === 'V-POUR-ON') {
    const water = ctx.dobj;
    if (water !== undefined) water.moveTo(null);  // REMOVE-CAREFULLY PRSO
    ctx.tell('The water cools the bell and is evaporated.');
    // Immediately cool down: re-arm I-XBH at 0 and fire it by queueing at 1.
    ctx.queueClock?.('I-XBH', 1, true);
    return true;
  }

  // RING with no instrument — "too hot to reach".
  if (ctx.action === 'V-RING') {
    ctx.tell('The bell is too hot to reach.');
    return true;
  }

  return false;
};

// ---------------------------------------------------------------------------
// BLACK-BOOK — 1actions.zil:2187–2205
// ---------------------------------------------------------------------------

export const blackBook: ActionHandler = (ctx) => {
  if (ctx.action === 'V-OPEN') {
    ctx.tell('The book is already open to page 569.');
    return true;
  }
  if (ctx.action === 'V-CLOSE') {
    ctx.tell('As hard as you try, the book cannot be closed.');
    return true;
  }
  // TURN page or READ-PAGE (non-569 page) — 1actions.zil:2192–2200.
  if (ctx.action === 'V-TURN' || ctx.action === 'V-READ-PAGE') {
    ctx.tell(
      'Beside page 569, there is only one other page with any legible printing on\n' +
      'it. Most of it is unreadable, but the subject seems to be the banishment of\n' +
      'evil. Apparently, certain noises, lights, and prayers are efficacious in this\n' +
      'regard.',
    );
    return true;
  }
  // BURN — 1actions.zil:2201–2205.
  if (ctx.action === 'V-BURN') {
    const book = ctx.self;
    book.moveTo(null);  // REMOVE-CAREFULLY PRSO
    ctx.jigsUp?.(
      'A booming voice says "Wrong, cretin!" and you notice that you have\n' +
      'turned into a pile of dust. How, I can\'t imagine.',
    );
    return true;
  }
  return false;
};

/** ACTION routines for the Hades region. */
export const hadesActions: Record<string, ActionHandler> = {
  'LLD-ROOM':    lldRoomFcn,
  'GHOSTS-F':    ghostsFcn,
  'BELL-F':      bellFcn,
  'HOT-BELL-F':  hotBellFcn,
  'BLACK-BOOK':  blackBook,
};
