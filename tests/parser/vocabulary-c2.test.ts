/**
 * Task C2 — Vocabulary REPLACE map unit tests.
 *
 * Verifies the corrected synonym table (loaded from vocabulary.json),
 * the new prep normalisation (UPPERCASE, byte-identical to syntax.json),
 * the DIRECTIONS set (LAND added, IN/OUT present), and the new
 * isDirection / isBuzzword exports.
 *
 * Tests are grouped as:
 *   1. Verbs that were WRONG in the old hand-written table (9 corrections)
 *   2. Verbs that were MISSING from the old table
 *   3. Prep lookups — UPPERCASE canonicals, aliases resolve correctly
 *   4. DIRECTIONS — LAND added, IN/OUT present, abbreviations work
 *   5. isDirection / isBuzzword new exports
 */

import { describe, test, expect } from 'vitest';
import {
  lookupVerb,
  normalizeDir,
  normalizePrep,
  isPreposition,
  isDirection,
  isBuzzword,
  DIRECTIONS,
  PREPOSITIONS,
} from '../../src/engine/parser/vocabulary.js';

// ---------------------------------------------------------------------------
// 1. Corrected synonym assignments (9 errors fixed vs old hand table)
// ---------------------------------------------------------------------------

describe('C2 — corrected synonym errors', () => {
  // Error 1: enter had ['board', 'through'] — neither is a ZIL ENTER synonym.
  // ENTER has no ZIL synonyms. 'board' must map to 'board' (separate verb).
  test('enter has no synonyms (BOARD is not an ENTER alias)', () => {
    // 'board' must map to its own canonical, not to 'enter'
    expect(lookupVerb('board')).toBe('board');
  });
  test('enter itself is still recognized as a verb', () => {
    expect(lookupVerb('enter')).toBe('enter');
  });
  test('through does not map to enter', () => {
    // 'through' is a PREP synonym for WITH, not a verb alias
    expect(lookupVerb('through')).toBeUndefined();
  });

  // Error 2: close had ['shut'] — SHUT is a TURN synonym, not CLOSE.
  // CLOSE has no ZIL synonyms.
  test('close is recognized without needing shut as alias', () => {
    expect(lookupVerb('close')).toBe('close');
  });
  test('shut maps to turn (not close)', () => {
    expect(lookupVerb('shut')).toBe('turn');
  });

  // Error 3: drop had many wrong aliases (discard/release/put down/leave/abandon/remove).
  // DROP has no ZIL synonyms; each of those is either a different verb or not in ZIL.
  test('drop itself is recognized', () => {
    expect(lookupVerb('drop')).toBe('drop');
  });
  test('discard does not map to drop', () => {
    // Not in ZIL vocabulary at all
    expect(lookupVerb('discard')).toBeUndefined();
  });
  test('release maps to untie (UNTIE synonym), not drop', () => {
    expect(lookupVerb('release')).toBe('untie');
  });
  test('leave maps to leave (separate ZIL verb with its own SYNTAX)', () => {
    expect(lookupVerb('leave')).toBe('leave');
  });
  test('remove maps to take (TAKE synonym REMOVE)', () => {
    expect(lookupVerb('remove')).toBe('take');
  });

  // Error 4: examine had ['x', 'describe', 'what', 'whats', 'inspect']
  // ZIL: only DESCRIBE WHAT WHATS are synonyms. X and INSPECT are NOT in ZIL.
  test('describe maps to examine', () => {
    expect(lookupVerb('describe')).toBe('examine');
  });
  test('what maps to examine', () => {
    expect(lookupVerb('what')).toBe('examine');
  });
  test('whats maps to examine', () => {
    expect(lookupVerb('whats')).toBe('examine');
  });
  test('x does NOT map to examine (not in ZIL vocabulary)', () => {
    expect(lookupVerb('x')).toBeUndefined();
  });
  test('inspect does NOT map to examine (not in ZIL vocabulary)', () => {
    expect(lookupVerb('inspect')).toBeUndefined();
  });

  // Error 5: extinguish had ['douse', 'quench'] — QUENCH is not in ZIL.
  test('douse maps to extinguish', () => {
    expect(lookupVerb('douse')).toBe('extinguish');
  });
  test('quench does NOT map to extinguish (not in ZIL)', () => {
    expect(lookupVerb('quench')).toBeUndefined();
  });

  // Error 6: inventory had ['i', 'inv'] — INV is not in ZIL.
  test('i maps to inventory', () => {
    expect(lookupVerb('i')).toBe('inventory');
  });
  test('inv does NOT map to inventory (not in ZIL)', () => {
    expect(lookupVerb('inv')).toBeUndefined();
  });

  // Error 7: take had ['get', 'hold', 'carry', 'grab', 'catch', 'pick']
  // PICK is a separate ZIL verb with its own SYNTAX forms; it must NOT map to take.
  test('get/hold/carry/grab/catch all map to take', () => {
    for (const alias of ['get', 'hold', 'carry', 'grab', 'catch']) {
      expect(lookupVerb(alias)).toBe('take');
    }
  });
  test('pick does NOT map to take (PICK is a separate ZIL verb)', () => {
    expect(lookupVerb('pick')).toBe('pick');
  });

  // Error 8: give was missing HAND (the Zork I synonym).
  test('hand maps to give (Zork I synonym from vocabulary.json)', () => {
    expect(lookupVerb('hand')).toBe('give');
  });
  test('donate/offer/feed still map to give', () => {
    for (const alias of ['donate', 'offer', 'feed']) {
      expect(lookupVerb(alias)).toBe('give');
    }
  });

  // Error 9: turn was missing SHUT; untie was missing RELEASE.
  test('shut maps to turn (ZIL: SYNONYM TURN SET FLIP SHUT)', () => {
    expect(lookupVerb('shut')).toBe('turn');
  });
  test('set and flip still map to turn', () => {
    expect(lookupVerb('set')).toBe('turn');
    expect(lookupVerb('flip')).toBe('turn');
  });
  test('release maps to untie (was missing from old table)', () => {
    expect(lookupVerb('release')).toBe('untie');
  });
  test('free/unfasten/unattach/unhook still map to untie', () => {
    for (const alias of ['free', 'unfasten', 'unattach', 'unhook']) {
      expect(lookupVerb(alias)).toBe('untie');
    }
  });
});

// ---------------------------------------------------------------------------
// 2. Verbs that were MISSING from the old hand table (new in vocabulary.json)
// ---------------------------------------------------------------------------

describe('C2 — verbs missing from old table, now present', () => {
  test('answer is recognized (from vocabulary.json)', () => {
    expect(lookupVerb('answer')).toBe('answer');
  });
  test('reply maps to answer', () => {
    expect(lookupVerb('reply')).toBe('answer');
  });

  test('chomp is recognized', () => {
    expect(lookupVerb('chomp')).toBe('chomp');
  });
  test('lose/barf map to chomp', () => {
    expect(lookupVerb('lose')).toBe('chomp');
    expect(lookupVerb('barf')).toBe('chomp');
  });

  test('curse is recognized', () => {
    expect(lookupVerb('curse')).toBe('curse');
  });
  test('shit/fuck/damn map to curse', () => {
    for (const alias of ['shit', 'fuck', 'damn']) {
      expect(lookupVerb(alias)).toBe('curse');
    }
  });

  test('find is recognized', () => {
    expect(lookupVerb('find')).toBe('find');
  });
  test('where/seek/see map to find', () => {
    for (const alias of ['where', 'seek', 'see']) {
      expect(lookupVerb(alias)).toBe('find');
    }
  });

  test('rape is recognized', () => {
    expect(lookupVerb('rape')).toBe('rape');
  });
  test('molest maps to rape', () => {
    expect(lookupVerb('molest')).toBe('rape');
  });

  test('treasure is recognized', () => {
    expect(lookupVerb('treasure')).toBe('treasure');
  });
  test('temple maps to treasure', () => {
    expect(lookupVerb('temple')).toBe('treasure');
  });
});

// ---------------------------------------------------------------------------
// 3. Verbs in syntax.json without SYNONYM lines — must still be recognized
// ---------------------------------------------------------------------------

describe('C2 — syntax.json verbs without SYNONYM lines', () => {
  const standaloneVerbs = [
    'open', 'close', 'drop', 'enter', 'move', 'save', 'wind',
    'score', 'look', 'diagnose', 'verbose', 'brief', 'version',
    'board', 'pick', 'leave', 'light', 'lock', 'unlock',
  ];
  for (const v of standaloneVerbs) {
    test(`${v} is recognized as its own canonical`, () => {
      expect(lookupVerb(v)).toBe(v);
    });
  }
});

// ---------------------------------------------------------------------------
// 4. Prep lookups — UPPERCASE canonicals, byte-identical to syntax.json
// ---------------------------------------------------------------------------

describe('C2 — prep normalisation returns UPPERCASE (byte-identical to syntax.json)', () => {
  // Canonical preps pass through unchanged (already UPPERCASE)
  test('normalizePrep("in") → "IN"', () => {
    expect(normalizePrep('in')).toBe('IN');
  });
  test('normalizePrep("IN") → "IN"', () => {
    expect(normalizePrep('IN')).toBe('IN');
  });
  test('normalizePrep("with") → "WITH"', () => {
    expect(normalizePrep('with')).toBe('WITH');
  });
  test('normalizePrep("on") → "ON"', () => {
    expect(normalizePrep('on')).toBe('ON');
  });
  test('normalizePrep("under") → "UNDER"', () => {
    expect(normalizePrep('under')).toBe('UNDER');
  });
  test('normalizePrep("off") → "OFF" (canonical; appears in syntax.json)', () => {
    expect(normalizePrep('off')).toBe('OFF');
  });
  test('normalizePrep("about") → "ABOUT" (canonical; appears in syntax.json)', () => {
    expect(normalizePrep('about')).toBe('ABOUT');
  });

  // Aliases normalise to their canonical UPPERCASE form
  test('normalizePrep("into") → "IN"', () => {
    expect(normalizePrep('into')).toBe('IN');
  });
  test('normalizePrep("inside") → "IN"', () => {
    expect(normalizePrep('inside')).toBe('IN');
  });
  test('normalizePrep("onto") → "ON"', () => {
    expect(normalizePrep('onto')).toBe('ON');
  });
  test('normalizePrep("underneath") → "UNDER"', () => {
    expect(normalizePrep('underneath')).toBe('UNDER');
  });
  test('normalizePrep("beneath") → "UNDER"', () => {
    expect(normalizePrep('beneath')).toBe('UNDER');
  });
  test('normalizePrep("below") → "UNDER"', () => {
    expect(normalizePrep('below')).toBe('UNDER');
  });
  test('normalizePrep("using") → "WITH"', () => {
    expect(normalizePrep('using')).toBe('WITH');
  });
  test('normalizePrep("through") → "WITH"', () => {
    expect(normalizePrep('through')).toBe('WITH');
  });
  test('normalizePrep("thru") → "WITH"', () => {
    expect(normalizePrep('thru')).toBe('WITH');
  });

  // Non-ZIL preps that appeared in the old table must be ABSENT
  test('"out of" is NOT in the PREPOSITIONS set (multi-word, not in ZIL)', () => {
    expect(PREPOSITIONS.has('OUT OF')).toBe(false);
    expect(PREPOSITIONS.has('out of')).toBe(false);
  });
  test('"on top of" is NOT in the PREPOSITIONS set (not in ZIL)', () => {
    expect(PREPOSITIONS.has('ON TOP OF')).toBe(false);
  });
});

describe('C2 — isPreposition detects all canonical and alias preps', () => {
  const canonicals = ['in', 'out', 'on', 'off', 'with', 'under', 'about',
    'across', 'around', 'at', 'away', 'behind', 'down', 'for',
    'from', 'over', 'to', 'up'];
  for (const p of canonicals) {
    test(`isPreposition("${p}") is true`, () => {
      expect(isPreposition(p)).toBe(true);
    });
  }

  const aliases = ['into', 'inside', 'onto', 'underneath', 'beneath', 'below', 'using', 'through', 'thru'];
  for (const a of aliases) {
    test(`isPreposition("${a}") is true (alias)`, () => {
      expect(isPreposition(a)).toBe(true);
    });
  }
});

// ---------------------------------------------------------------------------
// 5. DIRECTIONS — LAND added, IN/OUT present, abbreviations normalise correctly
// ---------------------------------------------------------------------------

describe('C2 — DIRECTIONS set', () => {
  test('LAND is in DIRECTIONS (gglobals.zil:5 — raft exit)', () => {
    expect(DIRECTIONS.has('land')).toBe(true);
  });

  test('IN is in DIRECTIONS', () => {
    expect(DIRECTIONS.has('in')).toBe(true);
  });

  test('OUT is in DIRECTIONS', () => {
    expect(DIRECTIONS.has('out')).toBe(true);
  });

  test('standard 8 compass directions are present', () => {
    for (const d of ['north', 'south', 'east', 'west', 'ne', 'nw', 'se', 'sw']) {
      expect(DIRECTIONS.has(d)).toBe(true);
    }
  });

  test('UP and DOWN are in DIRECTIONS', () => {
    expect(DIRECTIONS.has('up')).toBe(true);
    expect(DIRECTIONS.has('down')).toBe(true);
  });

  test('abbreviations n/s/e/w/u/d are in DIRECTIONS', () => {
    for (const abbr of ['n', 's', 'e', 'w', 'u', 'd']) {
      expect(DIRECTIONS.has(abbr)).toBe(true);
    }
  });

  test('ZIL direction synonym NORTHE (NE alias) is in DIRECTIONS', () => {
    expect(DIRECTIONS.has('northe')).toBe(true);
  });

  test('NORTHWEST is in DIRECTIONS (NW alias from vocabulary.json)', () => {
    expect(DIRECTIONS.has('northwest')).toBe(true);
  });
});

describe('C2 — normalizeDir', () => {
  test('n → north', () => expect(normalizeDir('n')).toBe('north'));
  test('s → south', () => expect(normalizeDir('s')).toBe('south'));
  test('e → east', () => expect(normalizeDir('e')).toBe('east'));
  test('w → west', () => expect(normalizeDir('w')).toBe('west'));
  test('u → up', () => expect(normalizeDir('u')).toBe('up'));
  test('d → down', () => expect(normalizeDir('d')).toBe('down'));
  test('northwest → nw', () => expect(normalizeDir('northwest')).toBe('nw'));
  test('northe → ne (ZIL alias)', () => expect(normalizeDir('northe')).toBe('ne'));
  test('north passes through unchanged', () => expect(normalizeDir('north')).toBe('north'));
  test('land passes through unchanged', () => expect(normalizeDir('land')).toBe('land'));
});

// ---------------------------------------------------------------------------
// 6. isDirection and isBuzzword new exports
// ---------------------------------------------------------------------------

describe('C2 — isDirection export', () => {
  test('isDirection("north") is true', () => expect(isDirection('north')).toBe(true));
  test('isDirection("N") is true (case-insensitive)', () => expect(isDirection('N')).toBe(true));
  test('isDirection("land") is true', () => expect(isDirection('land')).toBe(true));
  test('isDirection("mailbox") is false', () => expect(isDirection('mailbox')).toBe(false));
  test('isDirection("in") is true', () => expect(isDirection('in')).toBe(true));
  test('isDirection("out") is true', () => expect(isDirection('out')).toBe(true));
  test('isDirection("take") is false', () => expect(isDirection('take')).toBe(false));
});

describe('C2 — isBuzzword export', () => {
  test('isBuzzword("the") is true', () => expect(isBuzzword('the')).toBe(true));
  test('isBuzzword("THE") is true (case-insensitive)', () => expect(isBuzzword('THE')).toBe(true));
  test('isBuzzword("a") is true', () => expect(isBuzzword('a')).toBe(true));
  test('isBuzzword("an") is true', () => expect(isBuzzword('an')).toBe(true));
  test('isBuzzword("and") is true', () => expect(isBuzzword('and')).toBe(true));
  test('isBuzzword("then") is true', () => expect(isBuzzword('then')).toBe(true));
  test('isBuzzword("all") is true', () => expect(isBuzzword('all')).toBe(true));
  test('isBuzzword("again") is true', () => expect(isBuzzword('again')).toBe(true));
  test('isBuzzword("g") is true', () => expect(isBuzzword('g')).toBe(true));
  test('isBuzzword("but") is true', () => expect(isBuzzword('but')).toBe(true));
  test('isBuzzword("mailbox") is false', () => expect(isBuzzword('mailbox')).toBe(false));
  test('isBuzzword("take") is false', () => expect(isBuzzword('take')).toBe(false));
  test('isBuzzword(".") is true', () => expect(isBuzzword('.')).toBe(true));
  test('isBuzzword(",") is true', () => expect(isBuzzword(',')).toBe(true));
});
