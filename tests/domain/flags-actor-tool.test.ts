/**
 * Task A4 — Flag.Actor / Flag.Tool / Flag.TryTake
 *
 * TDD: these tests are written RED first, before any implementation changes.
 *
 * Coverage:
 *   1. Flag enum has Actor, Tool, TryTake members.
 *   2. Capability predicates isActor, isTool, isTryTake are exported and work.
 *   3. FLAG_MAP in extract.ts maps ACTORBIT→Actor, TOOLBIT→Tool, TRYTAKEBIT→TryTake.
 *   4. objects.json (post-extract) has Actor on troll/thief/cyclops/GHOSTS/BAT;
 *      Tool on shovel/pump/keys/screwdriver/wrench/putty/rusty-knife;
 *      TryTake on objects that had TRYTAKEBIT (cyclops/BAT have it, not TAKEBIT).
 */

import { describe, test, expect } from 'vitest';
import { Flag, isActor, isTool, isTryTake } from '../../src/domain/flags.js';
import { Thing } from '../../src/domain/thing.js';
import { extractObjects } from '../../tools/extract-zil/extract.js';
import { parseSexpr } from '../../tools/extract-zil/parse-sexpr.js';

import objectsRaw from '../../src/data/objects.json';
import roomsRaw from '../../src/data/rooms.json';

// ---------------------------------------------------------------------------
// 1. Flag enum members
// ---------------------------------------------------------------------------

describe('Flag enum — Actor, Tool, TryTake', () => {
  test('Flag.Actor is defined', () => {
    expect(Flag.Actor).toBeDefined();
  });

  test('Flag.Tool is defined', () => {
    expect(Flag.Tool).toBeDefined();
  });

  test('Flag.TryTake is defined', () => {
    expect(Flag.TryTake).toBeDefined();
  });

  test('Actor, Tool, TryTake are distinct numeric values', () => {
    expect(Flag.Actor).not.toBe(Flag.Tool);
    expect(Flag.Actor).not.toBe(Flag.TryTake);
    expect(Flag.Tool).not.toBe(Flag.TryTake);
  });
});

// ---------------------------------------------------------------------------
// 2. Capability predicates
// ---------------------------------------------------------------------------

describe('capability predicates — isActor, isTool, isTryTake', () => {
  test('isActor returns false when Actor not set', () => {
    const obj = new Thing('NPC', 'troll');
    expect(isActor(obj)).toBe(false);
  });

  test('isActor returns true when Actor is set', () => {
    const obj = new Thing('NPC', 'troll');
    obj.set(Flag.Actor);
    expect(isActor(obj)).toBe(true);
  });

  test('isTool returns false when Tool not set', () => {
    const obj = new Thing('SHOVEL', 'shovel');
    expect(isTool(obj)).toBe(false);
  });

  test('isTool returns true when Tool is set', () => {
    const obj = new Thing('SHOVEL', 'shovel');
    obj.set(Flag.Tool);
    expect(isTool(obj)).toBe(true);
  });

  test('isTryTake returns false when TryTake not set', () => {
    const obj = new Thing('SWORD', 'elvish sword');
    expect(isTryTake(obj)).toBe(false);
  });

  test('isTryTake returns true when TryTake is set', () => {
    const obj = new Thing('SWORD', 'elvish sword');
    obj.set(Flag.TryTake);
    expect(isTryTake(obj)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 3. Extractor FLAG_MAP — fixture-level tests
// ---------------------------------------------------------------------------

describe('extractor FLAG_MAP — ACTORBIT→Actor', () => {
  const src = `<OBJECT TROLL
    (FLAGS ACTORBIT OPENBIT TRYTAKEBIT)
    (DESC "troll")>`;

  const [obj] = extractObjects(parseSexpr(src));

  test('kind is actor (ACTORBIT infers actor kind)', () => {
    expect(obj.kind).toBe('actor');
  });

  test('flags include Actor', () => {
    expect(obj.flags).toContain('Actor');
  });

  test('flags do NOT include Takeable from ACTORBIT', () => {
    // ACTORBIT must not silently become Takeable any more
    // (the object may still get Takeable via TAKEBIT if present, but not from ACTORBIT)
    const flagsFromActorbit = obj.flags.filter(f => f === 'Takeable');
    // OPENBIT, TRYTAKEBIT are the other flags — TRYTAKEBIT should become TryTake
    // so 'Takeable' should not appear at all in this fixture
    expect(flagsFromActorbit).toHaveLength(0);
  });

  test('flags include TryTake (from TRYTAKEBIT)', () => {
    expect(obj.flags).toContain('TryTake');
  });
});

describe('extractor FLAG_MAP — TOOLBIT→Tool', () => {
  const src = `<OBJECT SHOVEL
    (FLAGS TAKEBIT TOOLBIT)
    (DESC "shovel")>`;

  const [obj] = extractObjects(parseSexpr(src));

  test('kind is thing (no ACTORBIT)', () => {
    expect(obj.kind).toBe('thing');
  });

  test('flags include Tool', () => {
    expect(obj.flags).toContain('Tool');
  });

  test('flags include Takeable (from TAKEBIT)', () => {
    expect(obj.flags).toContain('Takeable');
  });

  test('flags do NOT include Takeable duplicate from TOOLBIT', () => {
    // Takeable appears exactly once (from TAKEBIT, not doubled by TOOLBIT)
    expect(obj.flags.filter(f => f === 'Takeable')).toHaveLength(1);
  });
});

describe('extractor FLAG_MAP — TRYTAKEBIT→TryTake', () => {
  const src = `<OBJECT BAT
    (FLAGS ACTORBIT TRYTAKEBIT)
    (DESC "bat">`;

  const [obj] = extractObjects(parseSexpr(src));

  test('flags include TryTake', () => {
    expect(obj.flags).toContain('TryTake');
  });

  test('flags do not include Takeable (no TAKEBIT)', () => {
    expect(obj.flags).not.toContain('Takeable');
  });
});

// ---------------------------------------------------------------------------
// 4. objects.json real-data assertions (post-extract)
//
// These verify the regenerated data file has the correct flags.
// Run `npm run extract` to regenerate before running these tests.
// ---------------------------------------------------------------------------

type ObjData = { id: string; flags: string[]; kind: string };

const allObjects: ObjData[] = [
  ...(roomsRaw as unknown as ObjData[]),
  ...(objectsRaw as unknown as ObjData[]),
];

function findObj(id: string): ObjData {
  const o = allObjects.find(o => o.id === id);
  if (!o) throw new Error(`Object not found: ${id}`);
  return o;
}

describe('objects.json — Actor flag on NPC objects', () => {
  for (const id of ['TROLL', 'THIEF', 'CYCLOPS', 'GHOSTS', 'BAT']) {
    test(`${id} has Actor flag`, () => {
      expect(findObj(id).flags).toContain('Actor');
    });
  }
});

describe('objects.json — Tool flag on tool objects', () => {
  for (const id of ['SHOVEL', 'PUMP', 'KEYS', 'SCREWDRIVER', 'WRENCH', 'PUTTY']) {
    test(`${id} has Tool flag`, () => {
      expect(findObj(id).flags).toContain('Tool');
    });
  }

  test('RUSTY-KNIFE has Tool flag (also has TOOLBIT)', () => {
    expect(findObj('RUSTY-KNIFE').flags).toContain('Tool');
  });
});

describe('objects.json — TryTake flag on TRYTAKEBIT objects', () => {
  // These objects have TRYTAKEBIT in ZIL but NOT TAKEBIT (no unconditional take)
  // BAT: (FLAGS ACTORBIT TRYTAKEBIT)
  // CYCLOPS: (FLAGS ACTORBIT NDESCBIT TRYTAKEBIT)
  test('BAT has TryTake flag', () => {
    expect(findObj('BAT').flags).toContain('TryTake');
  });

  test('CYCLOPS has TryTake flag', () => {
    expect(findObj('CYCLOPS').flags).toContain('TryTake');
  });

  // TROLL: (FLAGS ACTORBIT OPENBIT TRYTAKEBIT)
  test('TROLL has TryTake flag', () => {
    expect(findObj('TROLL').flags).toContain('TryTake');
  });
});

describe('objects.json — Actor flag does NOT add spurious Takeable', () => {
  test('TROLL does not have Takeable flag (only had ACTORBIT+TRYTAKEBIT, no TAKEBIT)', () => {
    // TROLL ZIL: (FLAGS ACTORBIT OPENBIT TRYTAKEBIT) — no TAKEBIT
    expect(findObj('TROLL').flags).not.toContain('Takeable');
  });

  test('GHOSTS does not have Takeable flag', () => {
    // GHOSTS: (FLAGS ACTORBIT NDESCBIT) — no TAKEBIT or TRYTAKEBIT
    expect(findObj('GHOSTS').flags).not.toContain('Takeable');
  });
});
