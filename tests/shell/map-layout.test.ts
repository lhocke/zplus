/**
 * map-layout — reciprocity flags and renderMapGrid helper.
 */

import { describe, it, expect } from 'vitest';
import { ROOM_CONNECTIONS, ROOM_BY_ID, ROOM_LAYOUT } from '../../src/ui/map-layout.js';
import { renderMapGrid } from '../../src/ui/shell.js';

const SURFACE_IDS = new Set([
  'NORTH-OF-HOUSE', 'WEST-OF-HOUSE', 'EAST-OF-HOUSE', 'SOUTH-OF-HOUSE',
  'FOREST-1', 'FOREST-2', 'FOREST-3', 'PATH', 'UP-A-TREE',
  'GRATING-CLEARING', 'CLEARING', 'MOUNTAINS',
  'KITCHEN', 'ATTIC', 'LIVING-ROOM',
]);

const UNDERGROUND_IDS = new Set([
  'CELLAR', 'TROLL-ROOM', 'EAST-OF-CHASM', 'GALLERY', 'STUDIO',
]);

describe('ROOM_LAYOUT — level field', () => {
  it('every room has a level field', () => {
    for (const r of ROOM_LAYOUT) {
      expect(r.level, `room ${r.id} missing level`).toMatch(/^(surface|underground)$/);
    }
  });

  it('surface rooms are classified surface', () => {
    for (const r of ROOM_LAYOUT) {
      if (SURFACE_IDS.has(r.id)) {
        expect(r.level, r.id).toBe('surface');
      }
    }
  });

  it('underground rooms are classified underground', () => {
    for (const r of ROOM_LAYOUT) {
      if (UNDERGROUND_IDS.has(r.id)) {
        expect(r.level, r.id).toBe('underground');
      }
    }
  });

  it('ROOM_LAYOUT covers exactly the 20 expected rooms', () => {
    expect(ROOM_LAYOUT.length).toBe(20);
  });
});

// Helper: find a connection by pair (order-insensitive).
function findConn(a: string, b: string) {
  return ROOM_CONNECTIONS.find(
    c => (c.a === a && c.b === b) || (c.a === b && c.b === a),
  );
}

describe('ROOM_CONNECTIONS — reciprocal flags', () => {
  it('FOREST-1 ↔ FOREST-3 is non-reciprocal (forest is disorienting)', () => {
    const c = findConn('FOREST-1', 'FOREST-3');
    expect(c).toBeDefined();
    expect(c!.reciprocal).toBe(false);
  });

  it('FOREST-1 ↔ GRATING-CLEARING is non-reciprocal', () => {
    const c = findConn('FOREST-1', 'GRATING-CLEARING');
    expect(c).toBeDefined();
    expect(c!.reciprocal).toBe(false);
  });

  it('WEST-OF-HOUSE ↔ FOREST-1 is non-reciprocal (no east exit from forest back)', () => {
    const c = findConn('WEST-OF-HOUSE', 'FOREST-1');
    expect(c).toBeDefined();
    expect(c!.reciprocal).toBe(false);
  });

  it('SOUTH-OF-HOUSE ↔ FOREST-3 is non-reciprocal', () => {
    const c = findConn('SOUTH-OF-HOUSE', 'FOREST-3');
    expect(c).toBeDefined();
    expect(c!.reciprocal).toBe(false);
  });

  it('KITCHEN ↔ LIVING-ROOM is reciprocal', () => {
    const c = findConn('KITCHEN', 'LIVING-ROOM');
    expect(c).toBeDefined();
    expect(c!.reciprocal).toBe(true);
  });

  it('PATH ↔ FOREST-2 is reciprocal', () => {
    const c = findConn('PATH', 'FOREST-2');
    expect(c).toBeDefined();
    expect(c!.reciprocal).toBe(true);
  });

  it('PATH ↔ UP-A-TREE is reciprocal (up/down pair)', () => {
    const c = findConn('PATH', 'UP-A-TREE');
    expect(c).toBeDefined();
    expect(c!.reciprocal).toBe(true);
  });

  it('CELLAR ↔ TROLL-ROOM is reciprocal', () => {
    const c = findConn('CELLAR', 'TROLL-ROOM');
    expect(c).toBeDefined();
    expect(c!.reciprocal).toBe(true);
  });

  it('LIVING-ROOM ↔ CELLAR is non-reciprocal (trapdoor: one-way per flag)', () => {
    const c = findConn('LIVING-ROOM', 'CELLAR');
    expect(c).toBeDefined();
    expect(c!.reciprocal).toBe(false);
  });

  it('KITCHEN ↔ STUDIO is non-reciprocal (chimney: down blocked, up via function)', () => {
    const c = findConn('KITCHEN', 'STUDIO');
    expect(c).toBeDefined();
    expect(c!.reciprocal).toBe(false);
  });

  it('every connection entry references rooms present in ROOM_BY_ID', () => {
    for (const c of ROOM_CONNECTIONS) {
      expect(ROOM_BY_ID.has(c.a), `${c.a} not in ROOM_BY_ID`).toBe(true);
      expect(ROOM_BY_ID.has(c.b), `${c.b} not in ROOM_BY_ID`).toBe(true);
    }
  });
});

const NO_EXITS = new Map<string, Map<string, import('../../src/ui/map-state.js').ExitRecord>>();

// Helper: build a one-entry exitRecords map for connection-visibility tests.
function oneExit(roomId: string, dir: string, to: string): typeof NO_EXITS {
  const rec: import('../../src/ui/map-state.js').ExitRecord = { kind: 'walked', dir: dir as import('../../src/domain/game-object.js').Dir, to };
  return new Map([[roomId, new Map([[dir, rec]])]]);
}

describe('renderMapGrid', () => {
  it('returns empty string when nothing visited', () => {
    const result = renderMapGrid(new Set(), null, ROOM_BY_ID, ROOM_CONNECTIONS, NO_EXITS, 'surface');
    expect(result).toBe('');
  });

  it('renders a single visited room as a box', () => {
    const result = renderMapGrid(
      new Set(['WEST-OF-HOUSE']),
      'WEST-OF-HOUSE',
      ROOM_BY_ID,
      ROOM_CONNECTIONS,
      NO_EXITS,
      'surface',
    );
    expect(result).toContain('┌');
    expect(result).toContain('┐');
    expect(result).toContain('└');
    expect(result).toContain('┘');
    expect(result).toContain('│');
  });

  it('marks the current room with ▶', () => {
    const result = renderMapGrid(
      new Set(['WEST-OF-HOUSE']),
      'WEST-OF-HOUSE',
      ROOM_BY_ID,
      ROOM_CONNECTIONS,
      NO_EXITS,
      'surface',
    );
    expect(result).toContain('▶');
  });

  it('does not mark the ▶ when room is not current', () => {
    const result = renderMapGrid(
      new Set(['WEST-OF-HOUSE']),
      'NORTH-OF-HOUSE',
      ROOM_BY_ID,
      ROOM_CONNECTIONS,
      NO_EXITS,
      'surface',
    );
    expect(result).not.toContain('▶');
  });

  it('draws a solid connector between two reciprocally-connected visited rooms', () => {
    // Connection visibility now requires an exit record — supply one.
    const result = renderMapGrid(
      new Set(['KITCHEN', 'LIVING-ROOM']),
      'KITCHEN',
      ROOM_BY_ID,
      ROOM_CONNECTIONS,
      oneExit('KITCHEN', 'west', 'LIVING-ROOM'),
      'surface',
    );
    // KITCHEN (col 4) and LIVING-ROOM (col 3) are horizontally adjacent; reciprocal → ───
    expect(result).toContain('───');
  });

  it('draws a dashed connector between two non-reciprocally-connected visited rooms', () => {
    // FOREST-1 (col 1, row 2) and FOREST-3 (col 2, row 4) differ by more than 1 row — skipped.
    // Use WEST-OF-HOUSE (col 2, row 2) and FOREST-1 (col 1, row 2): non-reciprocal, same row.
    const result2 = renderMapGrid(
      new Set(['WEST-OF-HOUSE', 'FOREST-1']),
      'WEST-OF-HOUSE',
      ROOM_BY_ID,
      ROOM_CONNECTIONS,
      oneExit('WEST-OF-HOUSE', 'west', 'FOREST-1'),
      'surface',
    );
    expect(result2).toContain('╌');
  });

  it('ignores rooms not in the layout (past troll)', () => {
    const result = renderMapGrid(
      new Set(['KITCHEN', 'EW-PASSAGE']),
      'KITCHEN',
      ROOM_BY_ID,
      ROOM_CONNECTIONS,
      NO_EXITS,
      'surface',
    );
    // EW-PASSAGE not in ROOM_BY_ID — should not throw, kitchen box should still render
    expect(result).toContain('┌');
  });
});
