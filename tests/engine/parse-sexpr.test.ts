import { describe, test, expect } from 'vitest';
import { parseSexpr } from '../../tools/extract-zil/parse-sexpr.js';
import type { SAtom, SList, SString } from '../../tools/extract-zil/parse-sexpr.js';

// ---------------------------------------------------------------------------
// Node type helpers
// ---------------------------------------------------------------------------

function isAtom(n: unknown): n is SAtom {
  return typeof n === 'object' && n !== null && (n as SAtom).type === 'atom';
}

function isList(n: unknown): n is SList {
  return typeof n === 'object' && n !== null && (n as SList).type === 'list';
}

function isStr(n: unknown): n is SString {
  return typeof n === 'object' && n !== null && (n as SString).type === 'string';
}

// ---------------------------------------------------------------------------
// Basic atoms and strings
// ---------------------------------------------------------------------------

describe('atoms', () => {
  test('parses a bare atom', () => {
    const nodes = parseSexpr('HELLO');
    expect(nodes).toHaveLength(1);
    expect(isAtom(nodes[0])).toBe(true);
    expect((nodes[0] as SAtom).value).toBe('HELLO');
  });

  test('parses multiple atoms separated by whitespace', () => {
    const nodes = parseSexpr('FOO BAR BAZ');
    expect(nodes).toHaveLength(3);
    for (const n of nodes) expect(isAtom(n)).toBe(true);
    expect((nodes[1] as SAtom).value).toBe('BAR');
  });

  test('parses a quoted string', () => {
    const nodes = parseSexpr('"West of House"');
    expect(nodes).toHaveLength(1);
    expect(isStr(nodes[0])).toBe(true);
    expect((nodes[0] as SString).value).toBe('West of House');
  });

  test('handles escaped quotes inside strings', () => {
    const nodes = parseSexpr('"She said \\"hello\\""');
    expect(nodes).toHaveLength(1);
    expect((nodes[0] as SString).value).toBe('She said "hello"');
  });
});

// ---------------------------------------------------------------------------
// Round-bracket lists — (...)
// ---------------------------------------------------------------------------

describe('round-bracket lists', () => {
  test('parses an empty list', () => {
    const nodes = parseSexpr('()');
    expect(nodes).toHaveLength(1);
    expect(isList(nodes[0])).toBe(true);
    const list = nodes[0] as SList;
    expect(list.open).toBe('(');
    expect(list.items).toHaveLength(0);
  });

  test('parses (IN ROOMS)', () => {
    const nodes = parseSexpr('(IN ROOMS)');
    expect(nodes).toHaveLength(1);
    const list = nodes[0] as SList;
    expect(isList(list)).toBe(true);
    expect(list.open).toBe('(');
    expect(list.items).toHaveLength(2);
    expect((list.items[0] as SAtom).value).toBe('IN');
    expect((list.items[1] as SAtom).value).toBe('ROOMS');
  });

  test('parses (DESC "West of House")', () => {
    const nodes = parseSexpr('(DESC "West of House")');
    const list = nodes[0] as SList;
    expect(list.items).toHaveLength(2);
    expect((list.items[0] as SAtom).value).toBe('DESC');
    expect(isStr(list.items[1])).toBe(true);
    expect((list.items[1] as SString).value).toBe('West of House');
  });
});

// ---------------------------------------------------------------------------
// Angle-bracket forms — <...>
// ---------------------------------------------------------------------------

describe('angle-bracket forms', () => {
  test('parses a simple <FORM ATOM>', () => {
    const nodes = parseSexpr('<ROOM FOO>');
    expect(nodes).toHaveLength(1);
    const form = nodes[0] as SList;
    expect(isList(form)).toBe(true);
    expect(form.open).toBe('<');
    expect((form.items[0] as SAtom).value).toBe('ROOM');
    expect((form.items[1] as SAtom).value).toBe('FOO');
  });

  test('parses nested <FORM (LIST) (LIST)>', () => {
    const nodes = parseSexpr('<ROOM WEST-OF-HOUSE (IN ROOMS) (DESC "West of House")>');
    expect(nodes).toHaveLength(1);
    const form = nodes[0] as SList;
    expect(form.open).toBe('<');
    // head atom
    expect((form.items[0] as SAtom).value).toBe('ROOM');
    // room name atom
    expect((form.items[1] as SAtom).value).toBe('WEST-OF-HOUSE');
    // (IN ROOMS)
    const inRooms = form.items[2] as SList;
    expect(isList(inRooms)).toBe(true);
    expect(inRooms.open).toBe('(');
    expect((inRooms.items[0] as SAtom).value).toBe('IN');
    // (DESC "West of House")
    const desc = form.items[3] as SList;
    expect(isList(desc)).toBe(true);
    expect((desc.items[1] as SString).value).toBe('West of House');
  });
});

// ---------------------------------------------------------------------------
// Comment handling — ;"..."
// ---------------------------------------------------------------------------

describe('semicolon-string comments', () => {
  test('skips a standalone ;"..." comment', () => {
    const nodes = parseSexpr(';"this is a comment" AFTER');
    // comment is stripped; only the atom after it survives
    expect(nodes).toHaveLength(1);
    expect((nodes[0] as SAtom).value).toBe('AFTER');
  });

  test('skips inline ;"..." inside a list', () => {
    // Real ZIL: (ADJECTIVE LARGE STORM ;"-TOSSED")
    const nodes = parseSexpr('(ADJECTIVE LARGE STORM ;"-TOSSED")');
    const list = nodes[0] as SList;
    // The comment token is stripped; three atoms remain
    expect(list.items).toHaveLength(3);
    expect((list.items[0] as SAtom).value).toBe('ADJECTIVE');
    expect((list.items[1] as SAtom).value).toBe('LARGE');
    expect((list.items[2] as SAtom).value).toBe('STORM');
  });

  test('skips a ;"..." comment after an atom on the same line', () => {
    // Real ZIL: <ROOM ENGRAVINGS-CAVE ;"was CAVE4"  ...rest...>
    const nodes = parseSexpr('<FOO BAR ;"was BAZ" BAZ>');
    const form = nodes[0] as SList;
    expect(form.items).toHaveLength(3);
    expect((form.items[2] as SAtom).value).toBe('BAZ');
  });
});

// ---------------------------------------------------------------------------
// Full <ROOM ...> fixture — mirrors the spec example from the plan
// ---------------------------------------------------------------------------

describe('ROOM fixture', () => {
  const src = `<ROOM WEST-OF-HOUSE
    (IN ROOMS)
    (DESC "West of House")
    (NORTH TO NORTH-OF-HOUSE)
    (WEST TO FOREST-1)
    (EAST "The door is boarded and you can't remove the boards.")
    (ACTION WEST-HOUSE)
    (FLAGS RLANDBIT ONBIT SACREDBIT)>`;

  test('parses the whole form without error', () => {
    const nodes = parseSexpr(src);
    expect(nodes).toHaveLength(1);
    const form = nodes[0] as SList;
    expect(form.open).toBe('<');
    expect((form.items[0] as SAtom).value).toBe('ROOM');
  });

  test('room name is the second item', () => {
    const form = parseSexpr(src)[0] as SList;
    expect((form.items[1] as SAtom).value).toBe('WEST-OF-HOUSE');
  });

  test('(IN ROOMS) sub-list is present', () => {
    const form = parseSexpr(src)[0] as SList;
    const inList = form.items.find(
      (n) => isList(n) && isAtom((n as SList).items[0]) && (n as SList).items[0] !== undefined &&
             ((n as SList).items[0] as SAtom).value === 'IN'
    ) as SList | undefined;
    expect(inList).toBeDefined();
    expect((inList!.items[1] as SAtom).value).toBe('ROOMS');
  });

  test('(DESC "West of House") carries the string value', () => {
    const form = parseSexpr(src)[0] as SList;
    const descList = form.items.find(
      (n) => isList(n) && ((n as SList).items[0] as SAtom).value === 'DESC'
    ) as SList | undefined;
    expect(descList).toBeDefined();
    expect((descList!.items[1] as SString).value).toBe('West of House');
  });

  test('(EAST ...) carries a string instead of TO', () => {
    const form = parseSexpr(src)[0] as SList;
    const eastList = form.items.find(
      (n) => isList(n) && ((n as SList).items[0] as SAtom).value === 'EAST'
    ) as SList | undefined;
    expect(eastList).toBeDefined();
    expect(isStr(eastList!.items[1])).toBe(true);
  });

  test('(FLAGS ...) has three flag atoms', () => {
    const form = parseSexpr(src)[0] as SList;
    const flagsList = form.items.find(
      (n) => isList(n) && ((n as SList).items[0] as SAtom).value === 'FLAGS'
    ) as SList | undefined;
    expect(flagsList).toBeDefined();
    // FLAGS + 3 flags = 4 items total
    expect(flagsList!.items).toHaveLength(4);
  });
});

// ---------------------------------------------------------------------------
// Multiple top-level forms in one source string
// ---------------------------------------------------------------------------

describe('multiple top-level forms', () => {
  test('returns one node per top-level form', () => {
    const src = '<ROOM A> <ROOM B>';
    const nodes = parseSexpr(src);
    expect(nodes).toHaveLength(2);
    expect((( nodes[0] as SList).items[1] as SAtom).value).toBe('A');
    expect(((nodes[1] as SList).items[1] as SAtom).value).toBe('B');
  });
});

// ---------------------------------------------------------------------------
// Numbers
// ---------------------------------------------------------------------------

describe('numbers', () => {
  test('parses integer atoms', () => {
    const nodes = parseSexpr('(CAPACITY 50)');
    const list = nodes[0] as SList;
    const num = list.items[1] as SAtom;
    expect(num.value).toBe('50');
  });
});
