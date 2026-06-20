/**
 * P1-3 — Room-type flag extraction: NONLANDBIT, SACREDBIT, ONBIT
 *
 * TDD: these tests are written RED first, before any implementation changes.
 *
 * Coverage:
 *   1. Flag enum has NonLand and On members (distinct from NonDescript and Light).
 *   2. Capability predicates isNonLand and isOn are exported and work.
 *   3. FLAG_MAP in extract.ts maps NONLANDBIT→NonLand, SACREDBIT→Sacred, ONBIT→On.
 *   4. rooms.json (post-extract) has the correct flags:
 *      - WEST-OF-HOUSE (RLANDBIT ONBIT SACREDBIT): Land, On, Sacred
 *      - RESERVOIR (NONLANDBIT): NonLand
 *      - RIVER-1 (NONLANDBIT SACREDBIT ONBIT): NonLand, Sacred, On
 *   5. rooms.json has NO room with both NonLand AND NonDescript (disambiguation).
 *   6. lit() for always-lit rooms uses Flag.On (not Flag.Light).
 *
 * ZIL reference: 1dungeon.zil FLAGS clauses.
 */

import { describe, test, expect } from 'vitest';
import { Flag, isNonLand, isOn } from '../../src/domain/flags.js';
import { Thing } from '../../src/domain/thing.js';
import { Room } from '../../src/domain/room.js';
import { extractObjects } from '../../tools/extract-zil/extract.js';
import { parseSexpr } from '../../tools/extract-zil/parse-sexpr.js';

import roomsRaw from '../../src/data/rooms.json';

type RoomData = { id: string; flags: string[] };
const rooms = roomsRaw as unknown as RoomData[];

// ---------------------------------------------------------------------------
// 1. Flag enum members
// ---------------------------------------------------------------------------

describe('Flag enum — NonLand and On', () => {
  test('Flag.NonLand is defined', () => {
    expect(Flag.NonLand).toBeDefined();
  });

  test('Flag.On is defined', () => {
    expect(Flag.On).toBeDefined();
  });

  test('NonLand and On are distinct numeric values', () => {
    expect(Flag.NonLand).not.toBe(Flag.On);
  });

  test('Flag.NonLand is distinct from Flag.NonDescript', () => {
    expect(Flag.NonLand).not.toBe(Flag.NonDescript);
  });

  test('Flag.On is distinct from Flag.Light', () => {
    expect(Flag.On).not.toBe(Flag.Light);
  });

  test('Flag.On is distinct from Flag.OnFire', () => {
    expect(Flag.On).not.toBe(Flag.OnFire);
  });
});

// ---------------------------------------------------------------------------
// 2. Capability predicates
// ---------------------------------------------------------------------------

describe('capability predicates — isNonLand, isOn', () => {
  test('isNonLand returns false when NonLand not set', () => {
    const obj = new Thing('BOAT', 'boat');
    expect(isNonLand(obj)).toBe(false);
  });

  test('isNonLand returns true when NonLand is set', () => {
    const obj = new Thing('RESERVOIR', 'reservoir');
    obj.set(Flag.NonLand);
    expect(isNonLand(obj)).toBe(true);
  });

  test('isOn returns false when On not set', () => {
    const obj = new Room('CELLAR', 'Cellar');
    expect(isOn(obj)).toBe(false);
  });

  test('isOn returns true when On is set', () => {
    const obj = new Room('WEST-OF-HOUSE', 'West of House');
    obj.set(Flag.On);
    expect(isOn(obj)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 3. Extractor FLAG_MAP — fixture-level tests
// ---------------------------------------------------------------------------

describe('extractor FLAG_MAP — NONLANDBIT→NonLand', () => {
  const src = `<ROOM RESERVOIR
    (FLAGS NONLANDBIT)
    (DESC "Reservoir">`;

  const [obj] = extractObjects(parseSexpr(src));

  test('flags include NonLand', () => {
    expect(obj.flags).toContain('NonLand');
  });

  test('flags do NOT include NonDescript from NONLANDBIT', () => {
    // NONLANDBIT was previously (incorrectly) mapped to NonDescript
    expect(obj.flags).not.toContain('NonDescript');
  });
});

describe('extractor FLAG_MAP — SACREDBIT→Sacred', () => {
  const src = `<ROOM LIVING-ROOM
    (FLAGS RLANDBIT SACREDBIT)
    (DESC "Living Room">`;

  const [obj] = extractObjects(parseSexpr(src));

  test('flags include Sacred', () => {
    expect(obj.flags).toContain('Sacred');
  });
});

describe('extractor FLAG_MAP — ONBIT→On', () => {
  const src = `<ROOM WEST-OF-HOUSE
    (FLAGS RLANDBIT ONBIT SACREDBIT)
    (DESC "West of House">`;

  const [obj] = extractObjects(parseSexpr(src));

  test('flags include On', () => {
    expect(obj.flags).toContain('On');
  });

  test('flags do NOT include Light from ONBIT on a room', () => {
    // ONBIT on rooms means always-lit (Flag.On), not LIGHTBIT (Flag.Light)
    expect(obj.flags).not.toContain('Light');
  });
});

describe('extractor FLAG_MAP — combined NONLANDBIT SACREDBIT ONBIT (river room)', () => {
  const src = `<ROOM RIVER-1
    (FLAGS NONLANDBIT SACREDBIT ONBIT)
    (DESC "Frigid River">`;

  const [obj] = extractObjects(parseSexpr(src));

  test('flags include NonLand', () => {
    expect(obj.flags).toContain('NonLand');
  });

  test('flags include Sacred', () => {
    expect(obj.flags).toContain('Sacred');
  });

  test('flags include On', () => {
    expect(obj.flags).toContain('On');
  });
});

// ---------------------------------------------------------------------------
// 4. rooms.json (post-extract) — key landmark rooms
// ---------------------------------------------------------------------------

describe('rooms.json flag extraction — WEST-OF-HOUSE', () => {
  const woh = rooms.find(r => r.id === 'WEST-OF-HOUSE');

  test('WEST-OF-HOUSE is present', () => {
    expect(woh).toBeDefined();
  });

  test('WEST-OF-HOUSE has Flag.On (from ONBIT)', () => {
    expect(woh!.flags).toContain('On');
  });

  test('WEST-OF-HOUSE has Flag.Sacred (from SACREDBIT)', () => {
    expect(woh!.flags).toContain('Sacred');
  });

  test('WEST-OF-HOUSE does NOT have Light from ONBIT', () => {
    // Light on a room from ONBIT extraction was semantically wrong
    // (LIGHTBIT = capability, ONBIT on rooms = always-lit = Flag.On)
    // Post-extraction, only objects that have LIGHTBIT should carry Flag.Light
    // WEST-OF-HOUSE has RLANDBIT ONBIT SACREDBIT in ZIL — no LIGHTBIT
    expect(woh!.flags).not.toContain('Light');
  });
});

describe('rooms.json flag extraction — RESERVOIR', () => {
  const reservoir = rooms.find(r => r.id === 'RESERVOIR');

  test('RESERVOIR is present', () => {
    expect(reservoir).toBeDefined();
  });

  test('RESERVOIR has Flag.NonLand (from NONLANDBIT)', () => {
    expect(reservoir!.flags).toContain('NonLand');
  });

  test('RESERVOIR does NOT have NonDescript from NONLANDBIT', () => {
    expect(reservoir!.flags).not.toContain('NonDescript');
  });
});

describe('rooms.json flag extraction — RIVER-1', () => {
  const river1 = rooms.find(r => r.id === 'RIVER-1');

  test('RIVER-1 is present', () => {
    expect(river1).toBeDefined();
  });

  test('RIVER-1 has Flag.NonLand (from NONLANDBIT)', () => {
    expect(river1!.flags).toContain('NonLand');
  });

  test('RIVER-1 has Flag.Sacred (from SACREDBIT)', () => {
    expect(river1!.flags).toContain('Sacred');
  });

  test('RIVER-1 has Flag.On (from ONBIT)', () => {
    expect(river1!.flags).toContain('On');
  });
});

// ---------------------------------------------------------------------------
// 5. Disambiguation — no room should have NonDescript where NONLANDBIT is the source
// ---------------------------------------------------------------------------

describe('rooms.json — NONLANDBIT rooms do not carry NonDescript', () => {
  // Rooms with NONLANDBIT in ZIL: RESERVOIR, IN-STREAM, RIVER-1..5
  const nonLandRoomIds = ['RESERVOIR', 'IN-STREAM', 'RIVER-1', 'RIVER-2', 'RIVER-3', 'RIVER-4', 'RIVER-5'];

  for (const id of nonLandRoomIds) {
    test(`${id} has NonLand, not NonDescript`, () => {
      const room = rooms.find(r => r.id === id);
      expect(room, `${id} must be present in rooms.json`).toBeDefined();
      expect(room!.flags).toContain('NonLand');
      expect(room!.flags).not.toContain('NonDescript');
    });
  }
});

// ---------------------------------------------------------------------------
// 6. lit() uses Flag.On for always-lit rooms (not Flag.Light)
// ---------------------------------------------------------------------------

describe('lit() — always-lit rooms use Flag.On', () => {
  test('a room with Flag.On is treated as always lit', async () => {
    const { lit } = await import('../../src/engine/parser/scope.js');
    const { World } = await import('../../src/domain/world.js');
    const { Actor } = await import('../../src/domain/actor.js');

    const room = new Room('OUTDOOR', 'Outdoor Room');
    room.set(Flag.On);  // ONBIT always-lit — outdoor room

    const player = new Actor('PLAYER', 'player');
    player.moveTo(room);

    const world = World.fromObjects([room, player]);
    expect(lit(room, player, world)).toBe(true);
  });

  test('a room with only Flag.Light (LIGHTBIT) is NOT treated as always-lit by rooms', async () => {
    // Flag.Light on a room is LIGHTBIT — that is an object capability, not ONBIT.
    // After P1-3, lit() checks Flag.On for rooms, not Flag.Light.
    const { lit } = await import('../../src/engine/parser/scope.js');
    const { World } = await import('../../src/domain/world.js');
    const { Actor } = await import('../../src/domain/actor.js');

    const room = new Room('INDOOR', 'Indoor Room');
    room.set(Flag.Light);   // only LIGHTBIT — no ONBIT
    // NOT setting Flag.On

    const player = new Actor('PLAYER', 'player');
    player.moveTo(room);

    const world = World.fromObjects([room, player]);
    // No light source present + no Flag.On on room → dark
    expect(lit(room, player, world)).toBe(false);
  });
});
