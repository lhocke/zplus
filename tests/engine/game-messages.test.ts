/**
 * D1 — game-messages module tests.
 *
 * Verifies that:
 *   1. The module loads without error.
 *   2. Key verbatim strings match the ZIL source exactly (catalog cross-check).
 *   3. fmt() substitutes %s placeholders correctly.
 *   4. pick() returns a member of the target PICK-ONE table.
 *   5. Random tables contain the exact ZIL-sourced entries.
 */

import { describe, it, expect } from 'vitest';
import {
  MSG,
  fmt,
  pick,
  vTake,
  vOpen,
  vClose,
  vDrop,
  vInventory,
  vRead,
  vExamine,
  vWalk,
  yuks,
  dummy,
  hoHum,
  hellos,
  jumploss,
  wheeeee,
  preTake,
  itake,
  vPut,
  describeRoom,
  roomObject,
  parser,
} from '../../src/engine/game-messages';
import { Rng } from '../../src/engine/rng';

// ---------------------------------------------------------------------------
// 1. Module loads
// ---------------------------------------------------------------------------

describe('game-messages module', () => {
  it('loads without throwing', () => {
    expect(MSG).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// 2. Verbatim string spot-checks against catalog
//    Every string here must match verbatim-string-catalog.md exactly.
// ---------------------------------------------------------------------------

describe('verbatim spot-checks', () => {
  // gverbs.zil:1387 — V-TAKE "Taken."
  it('vTake.taken === "Taken."', () => {
    expect(vTake.taken).toBe('Taken.');
  });

  // gverbs.zil:1358 — PRE-TAKE "You already have that!"
  it('preTake.alreadyHaveIt === "You already have that!"', () => {
    expect(preTake.alreadyHaveIt).toBe('You already have that!');
  });

  // gverbs.zil:1356 — PRE-TAKE "You are already wearing it."
  it('preTake.alreadyWearing === "You are already wearing it."', () => {
    expect(preTake.alreadyWearing).toBe('You are already wearing it.');
  });

  // gverbs.zil:481 — V-DROP "Dropped."
  it('vDrop.dropped === "Dropped."', () => {
    expect(vDrop.dropped).toBe('Dropped.');
  });

  // gverbs.zil:31 — V-INVENTORY empty-handed
  it('vInventory.emptyHanded === "You are empty-handed."', () => {
    expect(vInventory.emptyHanded).toBe('You are empty-handed.');
  });

  // gverbs.zil:970 — V-OPEN already open
  it('vOpen.alreadyOpen === "It is already open."', () => {
    expect(vOpen.alreadyOpen).toBe('It is already open.');
  });

  // gverbs.zil:975 — V-OPEN opened (empty/transparent)
  it('vOpen.opened === "Opened."', () => {
    expect(vOpen.opened).toBe('Opened.');
  });

  // gverbs.zil:993-994 — V-OPEN not openable
  it('vOpen.notOpenable === "You must tell me how to do that to a %s."', () => {
    expect(vOpen.notOpenable).toBe('You must tell me how to do that to a %s.');
  });

  // gverbs.zil:349,355 — V-CLOSE already closed
  it('vClose.alreadyClosed === "It is already closed."', () => {
    expect(vClose.alreadyClosed).toBe('It is already closed.');
  });

  // gverbs.zil:344 — V-CLOSE closed (container)
  it('vClose.closed === "Closed."', () => {
    expect(vClose.closed).toBe('Closed.');
  });

  // gverbs.zil:353 — V-CLOSE door closed
  it('vClose.doorClosed === "The %s is now closed."', () => {
    expect(vClose.doorClosed).toBe('The %s is now closed.');
  });

  // gverbs.zil:1145 — V-READ not readable
  it('vRead.notReadable === "How does one read a %s?"', () => {
    expect(vRead.notReadable).toBe('How does one read a %s?');
  });

  // gverbs.zil:630 — V-EXAMINE nothing special
  it('vExamine.nothingSpecial === "There\'s nothing special about the %s."', () => {
    expect(vExamine.nothingSpecial).toBe("There's nothing special about the %s.");
  });

  // gverbs.zil:1548,1580 — V-WALK can't go that way
  it('vWalk.cantGoThatWay === "You can\'t go that way."', () => {
    expect(vWalk.cantGoThatWay).toBe("You can't go that way.");
  });

  // gverbs.zil:1638-1640 — DESCRIBE-ROOM dark no spray
  it('describeRoom.darkNoSpray', () => {
    expect(describeRoom.darkNoSpray).toBe(
      'It is pitch black. You are likely to be eaten by a grue.',
    );
  });

  // gverbs.zil:1114 — V-PUT "Done."
  it('vPut.done === "Done."', () => {
    expect(vPut.done).toBe('Done.');
  });

  // gverbs.zil:1093 — V-PUT "The %s isn't open."
  it('vPut.notOpen uses "isn\'t open" formulation', () => {
    expect(vPut.notOpen).toBe("The %s isn't open.");
  });

  // gverbs.zil:1969 — IDROP "You're not carrying the [PRSO]."
  it('MSG.idrop.notCarrying uses %s placeholder', () => {
    expect(MSG.idrop.notCarrying).toBe("You're not carrying the %s.");
  });

  // gverbs.zil:1934 — ITAKE load too heavy (normal)
  it('itake.loadTooHeavyNormal === "Your load is too heavy."', () => {
    expect(itake.loadTooHeavyNormal).toBe('Your load is too heavy.');
  });

  // gverbs.zil:1826 — FIRSTER "You are carrying:"
  it('roomObject.youAreCarrying === "You are carrying:"', () => {
    expect(roomObject.youAreCarrying).toBe('You are carrying:');
  });

  // gverbs.zil:1704 — DESCRIBE-OBJECT "There is a "
  it('roomObject.thereIsA === "There is a "', () => {
    expect(roomObject.thereIsA).toBe('There is a ');
  });

  // gverbs.zil:1704 — DESCRIBE-OBJECT " here."
  it('roomObject.hereS === " here."', () => {
    expect(roomObject.hereS).toBe(' here.');
  });

  // gparser.zil:155 — PARSER empty input
  it('parser.emptyInput === "I beg your pardon?"', () => {
    expect(parser.emptyInput).toBe('I beg your pardon?');
  });

  // gverbs.zil:1515 — V-WAIT "Time passes..."
  it('MSG.vWait.timePasses === "Time passes..."', () => {
    expect(MSG.vWait.timePasses).toBe('Time passes...');
  });
});

// ---------------------------------------------------------------------------
// 3. fmt() substitution
// ---------------------------------------------------------------------------

describe('fmt()', () => {
  it('substitutes a single %s', () => {
    expect(fmt('There is a %s here.', 'brass lantern')).toBe(
      'There is a brass lantern here.',
    );
  });

  it('substitutes multiple %s placeholders in order', () => {
    expect(fmt('Opening the %s reveals %s.', 'mailbox', 'a leaflet')).toBe(
      'Opening the mailbox reveals a leaflet.',
    );
  });

  it('leaves surplus %s intact when args run out', () => {
    expect(fmt('The %s is already in the %s.', 'sword')).toBe(
      'The sword is already in the %s.',
    );
  });

  it('handles zero substitutions', () => {
    expect(fmt('Taken.')).toBe('Taken.');
  });

  // Spot-check a real vOpen template
  it('vOpen.opens renders correctly via fmt', () => {
    const rendered = fmt(vOpen.opens, 'trapdoor');
    expect(rendered).toBe('The trapdoor opens.');
  });

  // vOpen.opensRevealing two-arg case
  it('vOpen.opensRevealing renders correctly via fmt', () => {
    const rendered = fmt(vOpen.opensRevealing, 'mailbox', 'a leaflet');
    expect(rendered).toBe('Opening the mailbox reveals a leaflet.');
  });
});

// ---------------------------------------------------------------------------
// 4. pick() — all results must be table members
// ---------------------------------------------------------------------------

describe('pick()', () => {
  const rng = new Rng(42);

  it('always returns a member of the YUKS table', () => {
    for (let i = 0; i < 40; i++) {
      const chosen = pick(yuks, rng);
      expect(yuks.entries).toContain(chosen);
    }
  });

  it('always returns a member of the DUMMY table', () => {
    for (let i = 0; i < 30; i++) {
      const chosen = pick(dummy, rng);
      expect(dummy.entries).toContain(chosen);
    }
  });

  it('always returns a member of the HO-HUM table', () => {
    for (let i = 0; i < 30; i++) {
      const chosen = pick(hoHum, rng);
      expect(hoHum.entries).toContain(chosen);
    }
  });

  it('always returns a member of the HELLOS table', () => {
    for (let i = 0; i < 40; i++) {
      const chosen = pick(hellos, rng);
      expect(hellos.entries).toContain(chosen);
    }
  });

  it('always returns a member of the JUMPLOSS table', () => {
    for (let i = 0; i < 30; i++) {
      const chosen = pick(jumploss, rng);
      expect(jumploss.entries).toContain(chosen);
    }
  });

  it('always returns a member of the WHEEEEE table', () => {
    for (let i = 0; i < 40; i++) {
      const chosen = pick(wheeeee, rng);
      expect(wheeeee.entries).toContain(chosen);
    }
  });

  it('returns different values across calls (not stuck on index 0)', () => {
    const rng2 = new Rng(1);
    const seen = new Set<string>();
    for (let i = 0; i < 50; i++) {
      seen.add(pick(yuks, rng2));
    }
    // With 50 draws from a 4-entry table, we must see more than 1 unique value.
    expect(seen.size).toBeGreaterThan(1);
  });
});

// ---------------------------------------------------------------------------
// 5. Random table contents — exact ZIL entry verification
// ---------------------------------------------------------------------------

describe('random table verbatim entries', () => {
  it('YUKS has all 4 ZIL entries (gverbs.zil:2206-2211)', () => {
    expect(yuks.entries).toEqual([
      'A valiant attempt.',
      "You can't be serious.",
      'An interesting idea...',
      'What a concept!',
    ]);
  });

  it('DUMMY has all 3 ZIL entries (gverbs.zil:2213-2216)', () => {
    expect(dummy.entries).toEqual([
      'Look around.',
      'Too late for that.',
      'Have your eyes checked.',
    ]);
  });

  it('HO-HUM has all 3 ZIL entries (gverbs.zil:2031-2036)', () => {
    expect(hoHum.entries).toEqual([
      " doesn't seem to work.",
      " isn't notably helpful.",
      ' has no effect.',
    ]);
  });

  it('HELLOS has all 4 ZIL entries (gverbs.zil:2199-2202)', () => {
    expect(hellos.entries).toEqual([
      'Hello.',
      'Good day.',
      "Nice weather we've been having lately.",
      'Goodbye.',
    ]);
  });

  it('JUMPLOSS has all 3 ZIL entries (gverbs.zil:844-848)', () => {
    expect(jumploss.entries).toEqual([
      'You should have looked before you leaped.',
      'In the movies, your life would be passing before your eyes.',
      'Geronimo...',
    ]);
  });

  it('WHEEEEE has all 4 ZIL entries (gverbs.zil:1272-1276)', () => {
    expect(wheeeee.entries).toEqual([
      'Very good. Now you can go to the second grade.',
      'Are you enjoying yourself?',
      'Wheeeeeeeeee!!!!!',
      'Do you expect me to applaud?',
    ]);
  });
});

// ---------------------------------------------------------------------------
// 6. MSG convenience bundle
// ---------------------------------------------------------------------------

describe('MSG convenience bundle', () => {
  it('MSG.fmt is the same as the exported fmt function', () => {
    expect(MSG.fmt).toBe(fmt);
  });

  it('MSG.pick is the same as the exported pick function', () => {
    expect(MSG.pick).toBe(pick);
  });

  it('MSG.vTake.taken === "Taken."', () => {
    expect(MSG.vTake.taken).toBe('Taken.');
  });

  it('MSG.yuks entries match YUKS table', () => {
    expect(MSG.yuks.entries).toEqual(yuks.entries);
  });

  it('MSG.dummy entries match DUMMY table', () => {
    expect(MSG.dummy.entries).toEqual(dummy.entries);
  });
});
