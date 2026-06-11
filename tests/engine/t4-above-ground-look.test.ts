/**
 * T4 round-4 repair — above-ground handlers gate narrowing.
 *
 * Four handlers had bare `verb === 'look'` guards that preempt the generic
 * V-LOOK-UNDER/BEHIND/ON fall-throughs.  This file verifies:
 *
 *   KITCHEN-WINDOW-F  intercepts LOOK-INSIDE only   (1actions.zil:257–262)
 *   TRAP-DOOR-FCN     intercepts LOOK-UNDER only     (1actions.zil:514–518)
 *   RUG-FCN           intercepts LOOK-UNDER only     (1actions.zil:603–608)
 *   LEAF-PILE         intercepts LOOK-UNDER only     (1actions.zil:809–813)
 *
 * dfrotz verification performed 2026-06-10 against Zork I R119.
 *
 * Integration tests use createGame / newGameAt — no mocking.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { newGameAt } from '../helpers/new-game';
import { resetKitchenWindowFlag, resetRugMoved } from '../../src/actions/above-ground';

// ---------------------------------------------------------------------------
// KITCHEN-WINDOW-F — 1actions.zil:241
//
// ZIL: VERB? LOOK-INSIDE (line 257) => "You can see what appears to be a
//      kitchen." / "You can see a clear area leading towards a forest."
//      All other look-family verbs must fall through.
//
// dfrotz (2026-06-10, from BEHIND-HOUSE with window open):
//   look in window   → "You can see what appears to be a kitchen."
//   look behind window → "There is nothing behind the kitchen window."
//   look under window  → "There is nothing but dust there."
//   look on window     → "Look on a kitchen window???"
// ---------------------------------------------------------------------------

describe('KITCHEN-WINDOW-F: look family — LOOK-INSIDE intercept, others fall through', () => {
  beforeEach(() => resetKitchenWindowFlag());

  function makeWindowGame() {
    const g = newGameAt('EAST-OF-HOUSE');
    g.start();
    g.turn('open window');   // sets kitchenWindowFlag, OPENBIT
    return g;
  }

  it('look in window — positive intercept: shows what is beyond (dfrotz)', () => {
    const g = makeWindowGame();
    const r = g.turn('look in window');
    // From EAST-OF-HOUSE (BEHIND-HOUSE), the window looks into the kitchen.
    expect(r.output).toBe('You can see what appears to be a kitchen.');
  });

  it('look in window from kitchen — positive intercept: shows forest', () => {
    const g = makeWindowGame();
    g.turn('enter window');  // enter window → kitchen
    const r = g.turn('look in window');
    expect(r.output).toBe('You can see a clear area leading towards a forest.');
  });

  it('look behind window — falls through to V-LOOK-BEHIND (dfrotz)', () => {
    const g = makeWindowGame();
    const r = g.turn('look behind window');
    expect(r.output).toBe('There is nothing behind the kitchen window.');
  });

  it('look under window — falls through to V-LOOK-UNDER (dfrotz)', () => {
    const g = makeWindowGame();
    const r = g.turn('look under window');
    expect(r.output).toBe('There is nothing but dust there.');
  });

  it('look on window — falls through to V-LOOK-ON (dfrotz)', () => {
    const g = makeWindowGame();
    const r = g.turn('look on window');
    expect(r.output).toBe('Look on a kitchen window???');
  });
});

// ---------------------------------------------------------------------------
// TRAP-DOOR-FCN — 1actions.zil:504
//
// ZIL: VERB? LOOK-UNDER (line 514) gates on LIVING-ROOM.
//      LOOK-INSIDE, LOOK-BEHIND, LOOK-ON must fall through.
//
// dfrotz (2026-06-10, from LIVING-ROOM, rug moved, door closed):
//   look under trap door → "It's closed."   (LOOK-UNDER intercept)
//   look in trap door    → "The trap door is closed."   (V-LOOK-INSIDE generic)
//   look behind trap door → "There is nothing behind the trap door."
//   look on trap door    → "Look on a trap door???"
// ---------------------------------------------------------------------------

describe('TRAP-DOOR-FCN: look family — LOOK-UNDER intercept, others fall through', () => {
  beforeEach(() => resetRugMoved());

  function makeTrapDoorGame() {
    const g = newGameAt('LIVING-ROOM');
    g.start();
    g.turn('move rug');   // reveals trap door (rugMoved = true)
    return g;
  }

  it('look under trap door — positive intercept: "It\'s closed." (dfrotz)', () => {
    const g = makeTrapDoorGame();
    const r = g.turn('look under trap door');
    expect(r.output).toBe("It's closed.");
  });

  it('look under trap door (open) — "You see a rickety staircase..." (dfrotz)', () => {
    const g = makeTrapDoorGame();
    g.turn('open trap door');
    const r = g.turn('look under trap door');
    expect(r.output).toBe('You see a rickety staircase descending into darkness.');
  });

  it('look in trap door — falls through to V-LOOK-INSIDE (dfrotz: "The trap door is closed.")', () => {
    const g = makeTrapDoorGame();
    const r = g.turn('look in trap door');
    expect(r.output).toBe('The trap door is closed.');
  });

  it('look behind trap door — falls through to V-LOOK-BEHIND (dfrotz)', () => {
    const g = makeTrapDoorGame();
    const r = g.turn('look behind trap door');
    expect(r.output).toBe('There is nothing behind the trap door.');
  });

  it('look on trap door — falls through to V-LOOK-ON (dfrotz)', () => {
    const g = makeTrapDoorGame();
    const r = g.turn('look on trap door');
    expect(r.output).toBe('Look on a trap door???');
  });
});

// ---------------------------------------------------------------------------
// RUG-FCN — 1actions.zil:579
//
// ZIL: VERB? LOOK-UNDER (line 603), gated on !RUG-MOVED && !OPENBIT(TRAP-DOOR).
//      LOOK-INSIDE, LOOK-BEHIND, LOOK-ON must fall through at all times.
//
// dfrotz (2026-06-10, from LIVING-ROOM, rug in initial position):
//   look under rug  → "Underneath the rug is a closed trap door. As you drop
//                       the corner of the rug, the trap door is once again
//                       concealed from view."
//   look in rug     → "You can't look inside a carpet."  (V-LOOK-INSIDE generic)
//   look behind rug → "There is nothing behind the carpet."
//   look on rug     → "Look on a carpet???"
// After rug moved, look under rug falls through to V-LOOK-UNDER "dust" response.
// ---------------------------------------------------------------------------

describe('RUG-FCN: look family — LOOK-UNDER intercept (rug unmoved), others fall through', () => {
  beforeEach(() => resetRugMoved());

  it('look under rug (unmoved) — positive intercept: trap-door reveal (dfrotz)', () => {
    const g = newGameAt('LIVING-ROOM');
    g.start();
    const r = g.turn('look under rug');
    expect(r.output).toContain('Underneath the rug is a closed trap door.');
  });

  it('look under rug (moved) — falls through to V-LOOK-UNDER "dust" response', () => {
    const g = newGameAt('LIVING-ROOM');
    g.start();
    g.turn('move rug');
    const r = g.turn('look under rug');
    expect(r.output).toBe('There is nothing but dust there.');
  });

  it('look in rug — falls through to V-LOOK-INSIDE (dfrotz)', () => {
    const g = newGameAt('LIVING-ROOM');
    g.start();
    const r = g.turn('look in rug');
    expect(r.output).toBe("You can't look inside a carpet.");
  });

  it('look behind rug — falls through to V-LOOK-BEHIND (dfrotz)', () => {
    const g = newGameAt('LIVING-ROOM');
    g.start();
    const r = g.turn('look behind rug');
    expect(r.output).toBe('There is nothing behind the carpet.');
  });

  it('look on rug — falls through to V-LOOK-ON (dfrotz)', () => {
    const g = newGameAt('LIVING-ROOM');
    g.start();
    const r = g.turn('look on rug');
    expect(r.output).toBe('Look on a carpet???');
  });
});

// ---------------------------------------------------------------------------
// LEAF-PILE — 1actions.zil:786
//
// ZIL: VERB? LOOK-UNDER (line 809), gated on !GRATE-REVEALED.
//      LOOK-INSIDE, LOOK-BEHIND, LOOK-ON must fall through.
//
// dfrotz (2026-06-10, from GRATING-CLEARING with leaves visible):
//   look under leaves → "Underneath the pile of leaves is a grating. As you
//                         release the leaves, the grating is once again
//                         concealed from view."
//   look in leaves    → "You can't look inside a pile of leaves."
//   look behind leaves → "There is nothing behind the pile of leaves."
//   look on leaves    → "Look on a pile of leaves???"
// ---------------------------------------------------------------------------

describe('LEAF-PILE: look family — LOOK-UNDER intercept (grate not revealed), others fall through', () => {
  it('look under leaves — positive intercept: grating reveal (dfrotz)', () => {
    const g = newGameAt('GRATING-CLEARING');
    g.start();
    const r = g.turn('look under leaves');
    expect(r.output).toContain('Underneath the pile of leaves is a grating.');
  });

  it('look in leaves — falls through to V-LOOK-INSIDE (dfrotz)', () => {
    const g = newGameAt('GRATING-CLEARING');
    g.start();
    const r = g.turn('look in leaves');
    expect(r.output).toBe("You can't look inside a pile of leaves.");
  });

  it('look behind leaves — falls through to V-LOOK-BEHIND (dfrotz)', () => {
    const g = newGameAt('GRATING-CLEARING');
    g.start();
    const r = g.turn('look behind leaves');
    expect(r.output).toBe('There is nothing behind the pile of leaves.');
  });

  it('look on leaves — falls through to V-LOOK-ON (dfrotz)', () => {
    const g = newGameAt('GRATING-CLEARING');
    g.start();
    const r = g.turn('look on leaves');
    expect(r.output).toBe('Look on a pile of leaves???');
  });
});
