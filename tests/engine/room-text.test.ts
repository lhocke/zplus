/**
 * room-text.test.ts
 *
 * Verifies that src/data/room-text.json is:
 *   1. Valid JSON that parses without error.
 *   2. An array covering EVERY room id in src/data/rooms.json.
 *   3. Correct for a selection of rooms with known static LDESC text that
 *      can be verified verbatim against the ZIL source.
 *
 * Text assertions compare against the exact string that appears in the ZIL,
 * after the frozen normalizer (pipe → newline, source newlines within
 * segments → single space) is applied — matching what the game would render.
 */

import { describe, test, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { RoomTextEntry } from '../../tools/extract-zil/extract-room-text.js';

const ROOT = resolve(import.meta.url.replace('file://', ''), '../../..');

function readJson<T>(rel: string): T {
  const src = readFileSync(join(ROOT, rel), 'utf8');
  return JSON.parse(src) as T;
}

const roomText = readJson<RoomTextEntry[]>('src/data/room-text.json');
const rooms = readJson<Array<{ id: string }>>('src/data/rooms.json');

// ---------------------------------------------------------------------------
// 1. Structural validity
// ---------------------------------------------------------------------------

describe('room-text.json structure', () => {
  test('is an array', () => {
    expect(Array.isArray(roomText)).toBe(true);
  });

  test('every entry has id, name, and source fields', () => {
    for (const entry of roomText) {
      expect(typeof entry.id, `${entry.id}.id`).toBe('string');
      expect(typeof entry.name, `${entry.id}.name`).toBe('string');
      expect(entry.source, `${entry.id}.source`).toBeTruthy();
      expect(typeof entry.source.file, `${entry.id}.source.file`).toBe('string');
      expect(typeof entry.source.line, `${entry.id}.source.line`).toBe('number');
    }
  });

  test('every entry has at least ldesc or mlook (no room has empty text)', () => {
    for (const entry of roomText) {
      const hasText =
        entry.ldesc !== undefined ||
        (Array.isArray(entry.mlook) && entry.mlook.length > 0);
      expect(hasText, `${entry.id} has no description text`).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// 2. Coverage — every room id in rooms.json must appear in room-text.json
// ---------------------------------------------------------------------------

describe('room-text.json coverage', () => {
  const textById = new Map(roomText.map(e => [e.id, e]));

  test(`covers all ${rooms.length} rooms from rooms.json`, () => {
    const missing: string[] = [];
    for (const room of rooms) {
      if (!textById.has(room.id)) missing.push(room.id);
    }
    expect(missing, `Missing room ids: ${missing.join(', ')}`).toHaveLength(0);
  });

  test('room-text.json entry count matches rooms.json entry count', () => {
    expect(roomText.length).toBe(rooms.length);
  });
});

// ---------------------------------------------------------------------------
// 3. Verbatim text verification for known static-LDESC rooms
//
// These strings are copied character-for-character from the LDESC field in
// zil/1dungeon.zil after applying the normalizer:
//   - '|' → '\n'
//   - source-level newlines within segments → single space
// ---------------------------------------------------------------------------

describe('verbatim ldesc for static-LDESC rooms', () => {
  const byId = new Map(roomText.map(e => [e.id, e]));

  test('NORTH-OF-HOUSE ldesc matches ZIL verbatim', () => {
    const entry = byId.get('NORTH-OF-HOUSE');
    expect(entry).toBeDefined();
    expect(entry!.ldesc).toBe(
      'You are facing the north side of a white house. There is no door here, ' +
      'and all the windows are boarded up. To the north a narrow path winds through the trees.',
    );
  });

  test('FOREST-1 ldesc matches ZIL verbatim', () => {
    const entry = byId.get('FOREST-1');
    expect(entry).toBeDefined();
    expect(entry!.ldesc).toBe(
      'This is a forest, with trees in all directions. To the east, there appears to be sunlight.',
    );
  });

  test('TROLL-ROOM ldesc matches ZIL verbatim', () => {
    const entry = byId.get('TROLL-ROOM');
    expect(entry).toBeDefined();
    expect(entry!.ldesc).toBe(
      'This is a small room with passages to the east and south and a forbidding hole leading west. ' +
      'Bloodstains and deep scratches (perhaps made by an axe) mar the walls.',
    );
  });

  test('ATTIC ldesc matches ZIL verbatim', () => {
    const entry = byId.get('ATTIC');
    expect(entry).toBeDefined();
    expect(entry!.ldesc).toBe(
      'This is the attic. The only exit is a stairway leading down.',
    );
  });

  test('MAZE-1 ldesc matches ZIL verbatim', () => {
    const entry = byId.get('MAZE-1');
    expect(entry).toBeDefined();
    expect(entry!.ldesc).toBe(
      'This is part of a maze of twisty little passages, all alike.',
    );
  });

  test('EAST-OF-CHASM ldesc matches ZIL verbatim', () => {
    const entry = byId.get('EAST-OF-CHASM');
    expect(entry).toBeDefined();
    expect(entry!.ldesc).toBe(
      'You are on the east edge of a chasm, the bottom of which cannot be seen. ' +
      'A narrow passage goes north, and the path you are on continues to the east.',
    );
  });
});

// ---------------------------------------------------------------------------
// 4. Action-driven rooms carry mlook candidates and a source citation
// ---------------------------------------------------------------------------

describe('action-driven rooms have mlook + source citation', () => {
  const byId = new Map(roomText.map(e => [e.id, e]));

  test('WEST-OF-HOUSE has mlook from WEST-HOUSE routine', () => {
    const entry = byId.get('WEST-OF-HOUSE');
    expect(entry).toBeDefined();
    expect(Array.isArray(entry!.mlook)).toBe(true);
    expect(entry!.mlook!.length).toBeGreaterThan(0);
    // The primary M-LOOK string (before the conditional WON-FLAG line)
    expect(entry!.mlook![0]).toBe(
      'You are standing in an open field west of a white house, with a boarded front door.',
    );
    expect(entry!.mlookSource).toBeDefined();
    expect(entry!.mlookSource!.file).toBe('zil/1actions.zil');
  });

  test('CELLAR has single clean mlook from CELLAR-FCN', () => {
    const entry = byId.get('CELLAR');
    expect(entry).toBeDefined();
    expect(entry!.mlook).toBeDefined();
    expect(entry!.mlook![0]).toBe(
      'You are in a dark and damp cellar with a narrow passageway leading ' +
      'north, and a crawlway to the south. On the west is the bottom of a ' +
      'steep metal ramp which is unclimbable.',
    );
    expect(entry!.needsReview).toBeUndefined();
  });

  test('MIRROR-ROOM-1 has mlook from MIRROR-ROOM routine', () => {
    const entry = byId.get('MIRROR-ROOM-1');
    expect(entry).toBeDefined();
    expect(entry!.mlook!.length).toBeGreaterThan(0);
    expect(entry!.mlook![0]).toContain('large square room');
  });
});

// ---------------------------------------------------------------------------
// 5. Source field points to zil/1dungeon.zil for every room
// ---------------------------------------------------------------------------

describe('source locations', () => {
  test('all room source files point to zil/1dungeon.zil', () => {
    for (const entry of roomText) {
      expect(entry.source.file, `${entry.id}.source.file`).toBe('zil/1dungeon.zil');
    }
  });

  test('all source line numbers are positive integers', () => {
    for (const entry of roomText) {
      expect(entry.source.line, `${entry.id}.source.line`).toBeGreaterThan(0);
    }
  });
});
