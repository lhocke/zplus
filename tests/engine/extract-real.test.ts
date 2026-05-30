/**
 * Sanity tests for the generated src/data/objects.json and rooms.json.
 *
 * Run `npm run extract` before these tests to regenerate the data.
 * These tests verify the extractor produced a complete, plausible dataset
 * from the real ZIL source.
 */

import { describe, test, expect } from 'vitest';
import type { ObjectData } from '../../tools/extract-zil/extract.js';

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
