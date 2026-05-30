/**
 * Sanity tests for the generated src/data/objects.json and rooms.json.
 *
 * Run `npm run extract` before these tests to regenerate the data.
 * These tests verify the extractor produced a complete, plausible dataset
 * from the real ZIL source.
 */

import { describe, test, expect } from 'vitest';
import type { ObjectData, PseudoEntry } from '../../tools/extract-zil/extract.js';

import objectsData from '../../src/data/objects.json';
import roomsData from '../../src/data/rooms.json';

// objects.json holds non-room entries; rooms.json holds rooms.
// Together they form the complete world — the "object count" check covers both.
const allObjects = [
  ...(roomsData as unknown as ObjectData[]),
  ...(objectsData as unknown as ObjectData[]),
];

// ---------------------------------------------------------------------------
// Volume sanity — the full Zork I world has well over 200 objects and rooms
// ---------------------------------------------------------------------------

describe('objects.json volume', () => {
  test('total object + room count >= 200', () => {
    expect(allObjects.length).toBeGreaterThanOrEqual(200);
  });

  test('every entry has an id field', () => {
    for (const obj of allObjects) {
      expect(obj.id).toBeTruthy();
    }
  });

  test('every entry has a valid kind', () => {
    const validKinds = new Set(['room', 'thing', 'container', 'actor']);
    for (const obj of allObjects) {
      expect(validKinds.has(obj.kind)).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// Key landmark objects — WEST-OF-HOUSE and MAILBOX must be present
// ---------------------------------------------------------------------------

describe('landmark objects', () => {
  test('WEST-OF-HOUSE is present', () => {
    const woh = allObjects.find(o => o.id === 'WEST-OF-HOUSE');
    expect(woh).toBeDefined();
  });

  test('WEST-OF-HOUSE is a room', () => {
    const woh = allObjects.find(o => o.id === 'WEST-OF-HOUSE');
    expect(woh!.kind).toBe('room');
  });

  test('MAILBOX is present', () => {
    const mailbox = allObjects.find(o => o.id === 'MAILBOX');
    expect(mailbox).toBeDefined();
  });

  test('MAILBOX is a container', () => {
    const mailbox = allObjects.find(o => o.id === 'MAILBOX');
    expect(mailbox!.kind).toBe('container');
  });

  test('MAILBOX parent is WEST-OF-HOUSE', () => {
    const mailbox = allObjects.find(o => o.id === 'MAILBOX');
    expect(mailbox!.parent).toBe('WEST-OF-HOUSE');
  });
});

// ---------------------------------------------------------------------------
// Structural integrity
// ---------------------------------------------------------------------------

describe('structural integrity', () => {
  test('rooms have exits arrays', () => {
    const rooms = allObjects.filter(o => o.kind === 'room');
    for (const r of rooms) {
      if (r.exits !== undefined) {
        expect(Array.isArray(r.exits)).toBe(true);
      }
    }
  });

  test('objects have synonyms and adjectives arrays', () => {
    for (const obj of allObjects) {
      expect(Array.isArray(obj.synonyms)).toBe(true);
      expect(Array.isArray(obj.adjectives)).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// C3: PSEUDO extraction — 22-pair table from td1-grammar-spec.md §7.3
//
// Authoritative mapping (from 1dungeon.zil):
//   LIVING-ROOM:       NAILS→NAILS-PSEUDO, NAIL→NAILS-PSEUDO
//   EAST-OF-CHASM:     CHASM→CHASM-PSEUDO
//   STUDIO:            DOOR→DOOR-PSEUDO, PAINT→PAINT-PSEUDO
//   RESERVOIR-SOUTH:   LAKE→LAKE-PSEUDO, CHASM→CHASM-PSEUDO
//   RESERVOIR:         STREAM→STREAM-PSEUDO
//   RESERVOIR-NORTH:   LAKE→LAKE-PSEUDO
//   STREAM-VIEW:       STREAM→STREAM-PSEUDO
//   IN-STREAM:         STREAM→STREAM-PSEUDO
//   CHASM-ROOM:        CHASM→CHASM-PSEUDO
//   ENTRANCE-TO-HADES: GATE→GATE-PSEUDO, GATES→GATE-PSEUDO
//   DOME-ROOM:         DOME→DOME-PSEUDO
//   TORCH-ROOM:        DOME→DOME-PSEUDO
//   SHAFT-ROOM:        CHAIN→CHAIN-PSEUDO
//   SMELLY-ROOM:       ODOR→GAS-PSEUDO, GAS→GAS-PSEUDO
//   GAS-ROOM:          GAS→GAS-PSEUDO, ODOR→GAS-PSEUDO
//   LOWER-SHAFT:       CHAIN→CHAIN-PSEUDO
// Total: 22 pairs across 16 rooms
// ---------------------------------------------------------------------------

type RoomData = ObjectData & { pseudo?: PseudoEntry[] };

const rooms = roomsData as unknown as RoomData[];

function getRoom(id: string): RoomData {
  const r = rooms.find(r => r.id === id);
  if (!r) throw new Error(`Room not found: ${id}`);
  return r;
}

describe('C3 PSEUDO — 22-pair complete table', () => {
  const EXPECTED_TABLE: Array<{ roomId: string; pairs: Array<PseudoEntry> }> = [
    {
      roomId: 'LIVING-ROOM',
      pairs: [
        { word: 'NAILS', action: 'NAILS-PSEUDO' },
        { word: 'NAIL',  action: 'NAILS-PSEUDO' },
      ],
    },
    {
      roomId: 'EAST-OF-CHASM',
      pairs: [{ word: 'CHASM', action: 'CHASM-PSEUDO' }],
    },
    {
      roomId: 'STUDIO',
      pairs: [
        { word: 'DOOR',  action: 'DOOR-PSEUDO' },
        { word: 'PAINT', action: 'PAINT-PSEUDO' },
      ],
    },
    {
      roomId: 'RESERVOIR-SOUTH',
      pairs: [
        { word: 'LAKE',  action: 'LAKE-PSEUDO' },
        { word: 'CHASM', action: 'CHASM-PSEUDO' },
      ],
    },
    {
      roomId: 'RESERVOIR',
      pairs: [{ word: 'STREAM', action: 'STREAM-PSEUDO' }],
    },
    {
      roomId: 'RESERVOIR-NORTH',
      pairs: [{ word: 'LAKE', action: 'LAKE-PSEUDO' }],
    },
    {
      roomId: 'STREAM-VIEW',
      pairs: [{ word: 'STREAM', action: 'STREAM-PSEUDO' }],
    },
    {
      roomId: 'IN-STREAM',
      pairs: [{ word: 'STREAM', action: 'STREAM-PSEUDO' }],
    },
    {
      roomId: 'CHASM-ROOM',
      pairs: [{ word: 'CHASM', action: 'CHASM-PSEUDO' }],
    },
    {
      roomId: 'ENTRANCE-TO-HADES',
      pairs: [
        { word: 'GATE',  action: 'GATE-PSEUDO' },
        { word: 'GATES', action: 'GATE-PSEUDO' },
      ],
    },
    {
      roomId: 'DOME-ROOM',
      pairs: [{ word: 'DOME', action: 'DOME-PSEUDO' }],
    },
    {
      roomId: 'TORCH-ROOM',
      pairs: [{ word: 'DOME', action: 'DOME-PSEUDO' }],
    },
    {
      roomId: 'SHAFT-ROOM',
      pairs: [{ word: 'CHAIN', action: 'CHAIN-PSEUDO' }],
    },
    {
      roomId: 'SMELLY-ROOM',
      pairs: [
        { word: 'ODOR', action: 'GAS-PSEUDO' },
        { word: 'GAS',  action: 'GAS-PSEUDO' },
      ],
    },
    {
      roomId: 'GAS-ROOM',
      pairs: [
        { word: 'GAS',  action: 'GAS-PSEUDO' },
        { word: 'ODOR', action: 'GAS-PSEUDO' },
      ],
    },
    {
      roomId: 'LOWER-SHAFT',
      pairs: [{ word: 'CHAIN', action: 'CHAIN-PSEUDO' }],
    },
  ];

  test('exactly 16 rooms have pseudo arrays', () => {
    const roomsWithPseudo = rooms.filter(r => r.pseudo !== undefined);
    expect(roomsWithPseudo).toHaveLength(16);
  });

  test('total pseudo pairs across all rooms is 22', () => {
    const total = rooms
      .filter(r => r.pseudo !== undefined)
      .reduce((sum, r) => sum + r.pseudo!.length, 0);
    expect(total).toBe(22);
  });

  for (const { roomId, pairs } of EXPECTED_TABLE) {
    describe(`${roomId}`, () => {
      test(`has ${pairs.length} pseudo pair(s)`, () => {
        const room = getRoom(roomId);
        expect(room.pseudo).toHaveLength(pairs.length);
      });

      for (let i = 0; i < pairs.length; i++) {
        const { word, action } = pairs[i];
        test(`pair[${i}]: ${word} → ${action}`, () => {
          const room = getRoom(roomId);
          expect(room.pseudo![i]).toEqual({ word, action } satisfies PseudoEntry);
        });
      }
    });
  }

  test('no room has PSEUDO key in props (old schema gone)', () => {
    for (const room of rooms) {
      expect((room.props as Record<string, unknown>)['PSEUDO']).toBeUndefined();
    }
  });
});
