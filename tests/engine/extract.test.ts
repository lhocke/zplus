import { describe, test, expect } from 'vitest';
import { extractObjects } from '../../tools/extract-zil/extract.js';
import { parseSexpr } from '../../tools/extract-zil/parse-sexpr.js';

// ---------------------------------------------------------------------------
// Minimal ZIL fixture — the MAZE-1 room from 1dungeon.zil
//
// Source lines 1538-1546:
//   <ROOM MAZE-1
//     (IN ROOMS)
//     (LDESC "This is part of a maze of twisty little passages, all alike.")
//     (DESC "Maze")
//     (EAST TO TROLL-ROOM)
//     (NORTH TO MAZE-1)
//     (SOUTH TO MAZE-2)
//     (WEST TO MAZE-4)
//     (FLAGS RLANDBIT MAZEBIT)>
// ---------------------------------------------------------------------------

const MAZE_1_ZIL = `<ROOM MAZE-1
  (IN ROOMS)
  (LDESC "This is part of a maze of twisty little passages, all alike.")
  (DESC "Maze")
  (EAST TO TROLL-ROOM)
  (NORTH TO MAZE-1)
  (SOUTH TO MAZE-2)
  (WEST TO MAZE-4)
  (FLAGS RLANDBIT MAZEBIT)>`;

// A simple OBJECT fixture to verify object extraction alongside rooms
const LANTERN_ZIL = `<OBJECT LANTERN
  (IN LIVING-ROOM)
  (SYNONYM LAMP LANTERN)
  (ADJECTIVE BRASS)
  (DESC "brass lantern")
  (FLAGS TAKEBIT LIGHTBIT)
  (ACTION LANTERN-F)
  (VALUE 10)>`;

// An object with a PER exit (routine-based navigation)
const MAZE_2_ZIL = `<ROOM MAZE-2
  (IN ROOMS)
  (LDESC "This is part of a maze of twisty little passages, all alike.")
  (DESC "Maze")
  (SOUTH TO MAZE-1)
  (DOWN PER MAZE-DIODES)
  (EAST TO MAZE-3)
  (FLAGS RLANDBIT MAZEBIT)>`;

// ---------------------------------------------------------------------------
// extractObjects — parses ROOM and OBJECT forms into ObjectData records
// ---------------------------------------------------------------------------

describe('extractObjects — MAZE-1 fixture', () => {
  const nodes = parseSexpr(MAZE_1_ZIL);
  const results = extractObjects(nodes);

  test('produces exactly one record', () => {
    expect(results).toHaveLength(1);
  });

  test('id is MAZE-1', () => {
    expect(results[0].id).toBe('MAZE-1');
  });

  test('kind is room', () => {
    expect(results[0].kind).toBe('room');
  });

  test('desc is "Maze"', () => {
    expect(results[0].desc).toBe('Maze');
  });

  test('ldesc is the full maze passage string', () => {
    expect(results[0].ldesc).toBe(
      'This is part of a maze of twisty little passages, all alike.'
    );
  });

  test('flags include Land and Maze', () => {
    expect(results[0].flags).toContain('Land');
    expect(results[0].flags).toContain('Maze');
    expect(results[0].flags).toHaveLength(2);
  });

  test('has four exits', () => {
    expect(results[0].exits).toHaveLength(4);
  });

  test('exit east → TROLL-ROOM', () => {
    const e = results[0].exits!.find(x => x.dir === 'east');
    expect(e).toBeDefined();
    expect(e!.to).toBe('TROLL-ROOM');
    expect(e!.per).toBeUndefined();
  });

  test('exit north → MAZE-1 (self-loop)', () => {
    const e = results[0].exits!.find(x => x.dir === 'north');
    expect(e).toBeDefined();
    expect(e!.to).toBe('MAZE-1');
  });

  test('exit south → MAZE-2', () => {
    const e = results[0].exits!.find(x => x.dir === 'south');
    expect(e).toBeDefined();
    expect(e!.to).toBe('MAZE-2');
  });

  test('exit west → MAZE-4', () => {
    const e = results[0].exits!.find(x => x.dir === 'west');
    expect(e).toBeDefined();
    expect(e!.to).toBe('MAZE-4');
  });

  test('synonyms and adjectives are empty arrays for a bare room', () => {
    expect(results[0].synonyms).toEqual([]);
    expect(results[0].adjectives).toEqual([]);
  });

  test('parent is undefined (rooms live in ROOMS, not a parent object)', () => {
    // ROOMS is the container category, not a parent game object
    expect(results[0].parent).toBeUndefined();
  });

  test('props is an empty record for MAZE-1 (no SIZE/VALUE etc.)', () => {
    expect(results[0].props).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// extractObjects — PER exit (MAZE-2 fixture)
// ---------------------------------------------------------------------------

describe('extractObjects — PER exit in MAZE-2', () => {
  const nodes = parseSexpr(MAZE_2_ZIL);
  const results = extractObjects(nodes);

  test('down exit uses per (not to)', () => {
    const e = results[0].exits!.find(x => x.dir === 'down');
    expect(e).toBeDefined();
    expect(e!.per).toBe('MAZE-DIODES');
    expect(e!.to).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// extractObjects — OBJECT form (LANTERN fixture)
// ---------------------------------------------------------------------------

describe('extractObjects — LANTERN object fixture', () => {
  const nodes = parseSexpr(LANTERN_ZIL);
  const results = extractObjects(nodes);

  test('produces exactly one record', () => {
    expect(results).toHaveLength(1);
  });

  test('id is LANTERN', () => {
    expect(results[0].id).toBe('LANTERN');
  });

  test('kind is thing (has TAKEBIT)', () => {
    expect(results[0].kind).toBe('thing');
  });

  test('desc is "brass lantern"', () => {
    expect(results[0].desc).toBe('brass lantern');
  });

  test('flags include Takeable and Light', () => {
    expect(results[0].flags).toContain('Takeable');
    expect(results[0].flags).toContain('Light');
  });

  test('synonyms include LAMP and LANTERN', () => {
    expect(results[0].synonyms).toContain('LAMP');
    expect(results[0].synonyms).toContain('LANTERN');
  });

  test('adjectives include BRASS', () => {
    expect(results[0].adjectives).toContain('BRASS');
  });

  test('parent is LIVING-ROOM', () => {
    expect(results[0].parent).toBe('LIVING-ROOM');
  });

  test('actionRoutine is LANTERN-F', () => {
    expect(results[0].actionRoutine).toBe('LANTERN-F');
  });

  test('props has VALUE=10', () => {
    expect(results[0].props['VALUE']).toBe(10);
  });

  test('exits is undefined for a non-room', () => {
    expect(results[0].exits).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// extractObjects — mixed ROOM + OBJECT input
// ---------------------------------------------------------------------------

describe('extractObjects — multiple forms', () => {
  const src = MAZE_1_ZIL + '\n' + LANTERN_ZIL;
  const nodes = parseSexpr(src);
  const results = extractObjects(nodes);

  test('returns one record per top-level ROOM/OBJECT form', () => {
    expect(results).toHaveLength(2);
  });

  test('first is the room', () => {
    expect(results[0].kind).toBe('room');
    expect(results[0].id).toBe('MAZE-1');
  });

  test('second is the thing', () => {
    expect(results[1].kind).toBe('thing');
    expect(results[1].id).toBe('LANTERN');
  });
});

// ---------------------------------------------------------------------------
// Flag mapping — ZIL BIT names → Flag enum string names
// ---------------------------------------------------------------------------

describe('flag name mapping', () => {
  const cases: Array<[string, string]> = [
    ['<ROOM R (FLAGS RLANDBIT)>', 'Land'],
    ['<ROOM R (FLAGS MAZEBIT)>', 'Maze'],
    ['<ROOM R (FLAGS LIGHTBIT)>', 'Light'],
    ['<OBJECT O (FLAGS TAKEBIT)>', 'Takeable'],
    ['<OBJECT O (FLAGS CONTBIT)>', 'Container'],
    ['<OBJECT O (FLAGS OPENBIT)>', 'Open'],
    ['<OBJECT O (FLAGS DOORBIT)>', 'Door'],
    ['<OBJECT O (FLAGS TRANSBIT)>', 'Transparent'],
    ['<OBJECT O (FLAGS FLAMEBIT)>', 'OnFire'],
    ['<OBJECT O (FLAGS BURNBIT)>', 'Burned'],
    ['<OBJECT O (FLAGS WEAPONBIT)>', 'Weapon'],
    ['<OBJECT O (FLAGS FOODBIT)>', 'Food'],
    ['<OBJECT O (FLAGS DRINKBIT)>', 'Drink'],
    ['<OBJECT O (FLAGS READBIT)>', 'Readable'],
    ['<OBJECT O (FLAGS TURNBIT)>', 'Turnable'],
    ['<OBJECT O (FLAGS CLIMBBIT)>', 'Climbable'],
    ['<OBJECT O (FLAGS SACREDBIT)>', 'Sacred'],
    ['<OBJECT O (FLAGS TOUCHBIT)>', 'Touched'],
    ['<OBJECT O (FLAGS VEHBIT)>', 'Vehicle'],
    ['<OBJECT O (FLAGS NDESCBIT)>', 'NonDescript'],
    ['<OBJECT O (FLAGS SEARCHBIT)>', 'Searchable'],
    ['<OBJECT O (FLAGS SURFACEBIT)>', 'Surface'],
  ];

  for (const [src, expected] of cases) {
    test(`${src.match(/FLAGS (\w+)/)?.[1]} → ${expected}`, () => {
      const nodes = parseSexpr(src);
      const results = extractObjects(nodes);
      expect(results[0].flags).toContain(expected);
    });
  }
});
