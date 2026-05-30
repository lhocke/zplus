/**
 * A1 extractor unit tests — SyntaxEntry schema normalization + bitmask math.
 *
 * These tests verify:
 *   1. HELD bit = 128 (SH constant from gparser.zil:1032), NOT 192.
 *   2. whereToBitmask() converts string arrays to correct integer bitmasks.
 *   3. normalizeSyntaxEntry() emits the new port-native schema:
 *      - preposition → prep1, preposition2 → prep2
 *      - directObject.find → dobjFindBit, directObject.where → dobjLocBits (int)
 *      - indirectObject.find → iobjFindBit, indirectObject.where → iobjLocBits (int)
 *      - explicit numObjects: 0 | 1 | 2
 *      - declaration order preserved (array index unchanged)
 *   4. Full bitmask assertions for ATTACK and DROP sample entries from the spec.
 *   5. Declaration-order assertion: first verb entry index unchanged.
 */

import { describe, test, expect } from 'vitest';
import {
  whereToBitmask,
  normalizeSyntaxEntry,
  HELD_BIT,
  CARRIED_BIT,
  IN_ROOM_BIT,
  ON_GROUND_BIT,
  TAKE_BIT,
  MANY_BIT,
  HAVE_BIT,
} from '../../tools/extract-zil/syntax-normalize.js';
import type { SyntaxEntryOut } from '../../tools/extract-zil/syntax-normalize.js';
import type { SyntaxEntryRaw } from '../../tools/extract-zil/extract.js';

// ---------------------------------------------------------------------------
// Section 1: Bit constant assertions
//
// The ZIL source (gparser.zil:1032-1038) defines:
//   SH=128, SC=64, SIR=32, SOG=16, STAKE=8, SMANY=4, SHAVE=2
//
// The reconciliation doc §3 C1 lists "HELD=192" which is contradicted by:
//   (a) gparser.zil constants, and
//   (b) the sample records in td1-grammar-spec.md §6:
//       ATTACK iobj: HELD(128)+CARRIED(64)+HAVE(2)=194  (not 256 or 256+something)
//       DROP dobj: HELD(128)+MANY(4)+HAVE(2)=134
// This assertion pins HELD=128 as the authoritative value.
// ---------------------------------------------------------------------------

describe('Scope bit constants (gparser.zil:1032-1038)', () => {
  test('HELD_BIT is 128 (SH constant from gparser.zil:1032)', () => {
    expect(HELD_BIT).toBe(128);
  });

  test('CARRIED_BIT is 64 (SC constant from gparser.zil:1033)', () => {
    expect(CARRIED_BIT).toBe(64);
  });

  test('IN_ROOM_BIT is 32 (SIR constant from gparser.zil:1034)', () => {
    expect(IN_ROOM_BIT).toBe(32);
  });

  test('ON_GROUND_BIT is 16 (SOG constant from gparser.zil:1035)', () => {
    expect(ON_GROUND_BIT).toBe(16);
  });

  test('TAKE_BIT is 8 (STAKE constant from gparser.zil:1036)', () => {
    expect(TAKE_BIT).toBe(8);
  });

  test('MANY_BIT is 4 (SMANY constant from gparser.zil:1037)', () => {
    expect(MANY_BIT).toBe(4);
  });

  test('HAVE_BIT is 2 (SHAVE constant from gparser.zil:1038)', () => {
    expect(HAVE_BIT).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Section 2: whereToBitmask() — string array → integer bitmask
// ---------------------------------------------------------------------------

describe('whereToBitmask()', () => {
  test('empty array → 0 (unconstrained — search everywhere accessible)', () => {
    expect(whereToBitmask([])).toBe(0);
  });

  test('["HELD"] → 128', () => {
    expect(whereToBitmask(['HELD'])).toBe(128);
  });

  test('["CARRIED"] → 64', () => {
    expect(whereToBitmask(['CARRIED'])).toBe(64);
  });

  test('["IN-ROOM"] → 32', () => {
    expect(whereToBitmask(['IN-ROOM'])).toBe(32);
  });

  test('["ON-GROUND"] → 16', () => {
    expect(whereToBitmask(['ON-GROUND'])).toBe(16);
  });

  test('["TAKE"] → 8', () => {
    expect(whereToBitmask(['TAKE'])).toBe(8);
  });

  test('["MANY"] → 4', () => {
    expect(whereToBitmask(['MANY'])).toBe(4);
  });

  test('["HAVE"] → 2', () => {
    expect(whereToBitmask(['HAVE'])).toBe(2);
  });

  // Sample A from td1-grammar-spec.md §6: ATTACK dobj (ON-GROUND IN-ROOM)
  test('["ON-GROUND","IN-ROOM"] → 48 (ATTACK dobj)', () => {
    expect(whereToBitmask(['ON-GROUND', 'IN-ROOM'])).toBe(16 + 32);
  });

  // Sample A: ATTACK iobj (HELD CARRIED HAVE) → 128+64+2=194
  test('["HELD","CARRIED","HAVE"] → 194 (ATTACK iobj)', () => {
    expect(whereToBitmask(['HELD', 'CARRIED', 'HAVE'])).toBe(128 + 64 + 2);
  });

  // Sample B from td1-grammar-spec.md §6: TAKE dobj (ON-GROUND IN-ROOM MANY) → 16+32+4=52
  test('["ON-GROUND","IN-ROOM","MANY"] → 52 (TAKE dobj)', () => {
    expect(whereToBitmask(['ON-GROUND', 'IN-ROOM', 'MANY'])).toBe(16 + 32 + 4);
  });

  // Sample E: DROP dobj (HELD MANY HAVE) → 128+4+2=134
  test('["HELD","MANY","HAVE"] → 134 (DROP dobj)', () => {
    expect(whereToBitmask(['HELD', 'MANY', 'HAVE'])).toBe(128 + 4 + 2);
  });

  // All bits combined: 128+64+32+16+8+4+2 = 254
  test('all bits combined → 254', () => {
    expect(whereToBitmask(['HELD', 'CARRIED', 'IN-ROOM', 'ON-GROUND', 'TAKE', 'MANY', 'HAVE'])).toBe(254);
  });
});

// ---------------------------------------------------------------------------
// Section 3: normalizeSyntaxEntry() — raw → port-native schema
// ---------------------------------------------------------------------------

describe('normalizeSyntaxEntry() — field renames + bitmask conversion', () => {
  // Intransitive: verb-only (LOOK = V-LOOK)
  const lookRaw: SyntaxEntryRaw = {
    verb: 'LOOK',
    action: 'V-LOOK',
  };

  test('LOOK: numObjects is 0', () => {
    const out = normalizeSyntaxEntry(lookRaw);
    expect(out.numObjects).toBe(0);
  });

  test('LOOK: prep1 is null', () => {
    const out = normalizeSyntaxEntry(lookRaw);
    expect(out.prep1).toBeNull();
  });

  test('LOOK: prep2 is null', () => {
    const out = normalizeSyntaxEntry(lookRaw);
    expect(out.prep2).toBeNull();
  });

  test('LOOK: dobjFindBit is null', () => {
    const out = normalizeSyntaxEntry(lookRaw);
    expect(out.dobjFindBit).toBeNull();
  });

  test('LOOK: dobjLocBits is 0', () => {
    const out = normalizeSyntaxEntry(lookRaw);
    expect(out.dobjLocBits).toBe(0);
  });

  test('LOOK: iobjFindBit is null', () => {
    const out = normalizeSyntaxEntry(lookRaw);
    expect(out.iobjFindBit).toBeNull();
  });

  test('LOOK: iobjLocBits is 0', () => {
    const out = normalizeSyntaxEntry(lookRaw);
    expect(out.iobjLocBits).toBe(0);
  });

  test('LOOK: action preserved', () => {
    const out = normalizeSyntaxEntry(lookRaw);
    expect(out.action).toBe('V-LOOK');
  });

  test('LOOK: preAction is null', () => {
    const out = normalizeSyntaxEntry(lookRaw);
    expect(out.preAction).toBeNull();
  });

  // Transitive: TAKE OBJECT (FIND TAKEBIT) (ON-GROUND IN-ROOM MANY) = V-TAKE PRE-TAKE
  const takeRaw: SyntaxEntryRaw = {
    verb: 'TAKE',
    directObject: { find: 'TAKEBIT', where: ['ON-GROUND', 'IN-ROOM', 'MANY'] },
    action: 'V-TAKE',
    preAction: 'PRE-TAKE',
  };

  test('TAKE: numObjects is 1', () => {
    const out = normalizeSyntaxEntry(takeRaw);
    expect(out.numObjects).toBe(1);
  });

  test('TAKE: dobjFindBit is TAKEBIT', () => {
    const out = normalizeSyntaxEntry(takeRaw);
    expect(out.dobjFindBit).toBe('TAKEBIT');
  });

  test('TAKE: dobjLocBits is 52 (ON-GROUND+IN-ROOM+MANY)', () => {
    const out = normalizeSyntaxEntry(takeRaw);
    expect(out.dobjLocBits).toBe(52);
  });

  test('TAKE: iobjFindBit is null', () => {
    const out = normalizeSyntaxEntry(takeRaw);
    expect(out.iobjFindBit).toBeNull();
  });

  test('TAKE: iobjLocBits is 0', () => {
    const out = normalizeSyntaxEntry(takeRaw);
    expect(out.iobjLocBits).toBe(0);
  });

  test('TAKE: preAction is PRE-TAKE', () => {
    const out = normalizeSyntaxEntry(takeRaw);
    expect(out.preAction).toBe('PRE-TAKE');
  });

  // Ditransitive: ATTACK OBJECT (FIND ACTORBIT) (ON-GROUND IN-ROOM) WITH OBJECT (FIND WEAPONBIT) (HELD CARRIED HAVE) = V-ATTACK
  const attackRaw: SyntaxEntryRaw = {
    verb: 'ATTACK',
    directObject: { find: 'ACTORBIT', where: ['ON-GROUND', 'IN-ROOM'] },
    preposition2: 'WITH',
    indirectObject: { find: 'WEAPONBIT', where: ['HELD', 'CARRIED', 'HAVE'] },
    action: 'V-ATTACK',
  };

  test('ATTACK: numObjects is 2', () => {
    const out = normalizeSyntaxEntry(attackRaw);
    expect(out.numObjects).toBe(2);
  });

  test('ATTACK: prep2 is WITH', () => {
    const out = normalizeSyntaxEntry(attackRaw);
    expect(out.prep2).toBe('WITH');
  });

  test('ATTACK: dobjFindBit is ACTORBIT', () => {
    const out = normalizeSyntaxEntry(attackRaw);
    expect(out.dobjFindBit).toBe('ACTORBIT');
  });

  test('ATTACK: dobjLocBits is 48 (ON-GROUND+IN-ROOM)', () => {
    const out = normalizeSyntaxEntry(attackRaw);
    expect(out.dobjLocBits).toBe(48);
  });

  test('ATTACK: iobjFindBit is WEAPONBIT', () => {
    const out = normalizeSyntaxEntry(attackRaw);
    expect(out.iobjFindBit).toBe('WEAPONBIT');
  });

  test('ATTACK: iobjLocBits is 194 (HELD+CARRIED+HAVE = 128+64+2)', () => {
    const out = normalizeSyntaxEntry(attackRaw);
    expect(out.iobjLocBits).toBe(194);
  });

  test('ATTACK: prep1 is null (no particle before dobj)', () => {
    const out = normalizeSyntaxEntry(attackRaw);
    expect(out.prep1).toBeNull();
  });

  // Particle-verb with SHAVE: DROP OBJECT (HELD MANY HAVE) = V-DROP PRE-DROP
  const dropRaw: SyntaxEntryRaw = {
    verb: 'DROP',
    directObject: { find: undefined, where: ['HELD', 'MANY', 'HAVE'] },
    action: 'V-DROP',
    preAction: 'PRE-DROP',
  };

  test('DROP: dobjLocBits is 134 (HELD+MANY+HAVE = 128+4+2)', () => {
    const out = normalizeSyntaxEntry(dropRaw);
    expect(out.dobjLocBits).toBe(134);
  });

  test('DROP: dobjFindBit is null (no find constraint)', () => {
    const out = normalizeSyntaxEntry(dropRaw);
    expect(out.dobjFindBit).toBeNull();
  });

  // Particle preposition: LOOK IN OBJECT ... = V-LOOK-INSIDE
  const lookInRaw: SyntaxEntryRaw = {
    verb: 'LOOK',
    preposition: 'IN',
    directObject: { where: ['HELD', 'CARRIED', 'ON-GROUND', 'IN-ROOM', 'MANY'] },
    action: 'V-LOOK-INSIDE',
  };

  test('LOOK IN: numObjects is 1', () => {
    const out = normalizeSyntaxEntry(lookInRaw);
    expect(out.numObjects).toBe(1);
  });

  test('LOOK IN: prep1 is IN', () => {
    const out = normalizeSyntaxEntry(lookInRaw);
    expect(out.prep1).toBe('IN');
  });

  test('LOOK IN: prep2 is null', () => {
    const out = normalizeSyntaxEntry(lookInRaw);
    expect(out.prep2).toBeNull();
  });

  test('LOOK IN: dobjLocBits is 230 (HELD+CARRIED+ON-GROUND+IN-ROOM+MANY = 128+64+16+32+4)', () => {
    const out = normalizeSyntaxEntry(lookInRaw);
    expect(out.dobjLocBits).toBe(128 + 64 + 16 + 32 + 4);
  });
});

// ---------------------------------------------------------------------------
// Section 4: Output schema shape — SyntaxEntryOut fields
// ---------------------------------------------------------------------------

describe('SyntaxEntryOut schema shape', () => {
  const raw: SyntaxEntryRaw = {
    verb: 'TAKE',
    directObject: { find: 'TAKEBIT', where: ['ON-GROUND', 'IN-ROOM', 'MANY'] },
    action: 'V-TAKE',
    preAction: 'PRE-TAKE',
  };
  const out: SyntaxEntryOut = normalizeSyntaxEntry(raw);

  test('has verb field', () => {
    expect(out).toHaveProperty('verb');
  });

  test('has numObjects field (explicit 0|1|2)', () => {
    expect(out).toHaveProperty('numObjects');
    expect([0, 1, 2]).toContain(out.numObjects);
  });

  test('has prep1 field (not "preposition")', () => {
    expect(out).toHaveProperty('prep1');
    expect(out).not.toHaveProperty('preposition');
  });

  test('has prep2 field (not "preposition2")', () => {
    expect(out).toHaveProperty('prep2');
    expect(out).not.toHaveProperty('preposition2');
  });

  test('has dobjFindBit field (not "directObject")', () => {
    expect(out).toHaveProperty('dobjFindBit');
    expect(out).not.toHaveProperty('directObject');
  });

  test('has dobjLocBits as integer (not "directObject.where" array)', () => {
    expect(out).toHaveProperty('dobjLocBits');
    expect(typeof out.dobjLocBits).toBe('number');
    expect(out).not.toHaveProperty('directObject');
  });

  test('has iobjFindBit field (not "indirectObject")', () => {
    expect(out).toHaveProperty('iobjFindBit');
    expect(out).not.toHaveProperty('indirectObject');
  });

  test('has iobjLocBits as integer', () => {
    expect(out).toHaveProperty('iobjLocBits');
    expect(typeof out.iobjLocBits).toBe('number');
  });

  test('has action field', () => {
    expect(out).toHaveProperty('action');
  });

  test('has preAction field', () => {
    expect(out).toHaveProperty('preAction');
  });
});

// ---------------------------------------------------------------------------
// Section 5: Declaration-order preservation
//
// normalizeSyntaxEntry must not reorder fields within an entry.
// The output array index must be the same as the input array index.
// ---------------------------------------------------------------------------

describe('Declaration-order preservation', () => {
  const entries: SyntaxEntryRaw[] = [
    { verb: 'LOOK', action: 'V-LOOK' },
    { verb: 'LOOK', preposition: 'AROUND', directObject: { find: 'RMUNGBIT', where: [] }, action: 'V-LOOK' },
    { verb: 'LOOK', preposition: 'IN', directObject: { where: ['HELD', 'CARRIED', 'ON-GROUND', 'IN-ROOM', 'MANY'] }, action: 'V-LOOK-INSIDE' },
  ];

  const outs = entries.map(normalizeSyntaxEntry);

  test('first entry remains LOOK intransitive', () => {
    expect(outs[0].verb).toBe('LOOK');
    expect(outs[0].numObjects).toBe(0);
    expect(outs[0].action).toBe('V-LOOK');
  });

  test('second entry remains LOOK AROUND (RMUNGBIT dummy)', () => {
    expect(outs[1].verb).toBe('LOOK');
    expect(outs[1].prep1).toBe('AROUND');
    expect(outs[1].dobjFindBit).toBe('RMUNGBIT');
    expect(outs[1].numObjects).toBe(1);
  });

  test('third entry remains LOOK IN (transitive)', () => {
    expect(outs[2].verb).toBe('LOOK');
    expect(outs[2].prep1).toBe('IN');
    expect(outs[2].numObjects).toBe(1);
    expect(outs[2].action).toBe('V-LOOK-INSIDE');
  });

  test('array length is preserved (no entries added or dropped)', () => {
    expect(outs).toHaveLength(entries.length);
  });
});
