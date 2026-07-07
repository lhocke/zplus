/**
 * Map state — directed exit-record model (§2 / §6.1).
 * Pure DOM-free: driven by scripted RoomSnap inputs, no rendering.
 */
import { describe, it, expect } from 'vitest';
import { MapState } from '../../src/ui/map-state.js';
import type { Dir } from '../../src/domain/game-object.js';

/** Minimal RoomSnap stub. */
function view(here: string, exits: Array<{ dir: string; known: boolean; to?: string }> = []) {
  return { here, exits };
}

// ── Retained: visited-room tracking ──────────────────────────────────────────

describe('MapState — room reveal', () => {
  it('newly created state has no visited rooms', () => {
    const ms = new MapState();
    expect(ms.visitedRooms().size).toBe(0);
  });

  it('visiting a room adds it to the visited set', () => {
    const ms = new MapState();
    ms.update(view('WEST-OF-HOUSE'), null);
    expect(ms.visitedRooms().has('WEST-OF-HOUSE')).toBe(true);
  });

  it('visiting the same room twice adds it only once', () => {
    const ms = new MapState();
    ms.update(view('WEST-OF-HOUSE'), null);
    ms.update(view('WEST-OF-HOUSE'), null);
    expect(ms.visitedRooms().size).toBe(1);
  });

  it('visiting multiple rooms adds all of them', () => {
    const ms = new MapState();
    ms.update(view('WEST-OF-HOUSE'), null);
    ms.update(view('NORTH-OF-HOUSE'), 'north');
    expect(ms.visitedRooms().has('WEST-OF-HOUSE')).toBe(true);
    expect(ms.visitedRooms().has('NORTH-OF-HOUSE')).toBe(true);
  });

  it('unknown room id (past troll, not in layout) is stored but causes no crash', () => {
    const ms = new MapState();
    expect(() => ms.update(view('EW-PASSAGE'), null)).not.toThrow();
    expect(ms.visitedRooms().has('EW-PASSAGE')).toBe(true);
  });
});

// ── Retained: current room ────────────────────────────────────────────────────

describe('MapState — current room', () => {
  it('currentRoom() returns null before any update', () => {
    const ms = new MapState();
    expect(ms.currentRoom()).toBeNull();
  });

  it('currentRoom() returns the most recently visited room', () => {
    const ms = new MapState();
    ms.update(view('WEST-OF-HOUSE'), null);
    expect(ms.currentRoom()).toBe('WEST-OF-HOUSE');
    ms.update(view('NORTH-OF-HOUSE'), 'north');
    expect(ms.currentRoom()).toBe('NORTH-OF-HOUSE');
  });
});

// ── Retained: reset ───────────────────────────────────────────────────────────

describe('MapState — reset', () => {
  it('reset() clears all state', () => {
    const ms = new MapState();
    ms.update(view('WEST-OF-HOUSE'), null);
    ms.update(view('NORTH-OF-HOUSE'), 'north');
    ms.reset();
    expect(ms.visitedRooms().size).toBe(0);
    expect(ms.currentRoom()).toBeNull();
    expect(ms.exitsFor('WEST-OF-HOUSE').size).toBe(0);
  });
});

// ── New: walked exits ─────────────────────────────────────────────────────────

describe('MapState — walked exits', () => {
  it('walked from input direction — records on prior room', () => {
    const ms = new MapState();
    ms.update(view('A'), null);
    ms.update(view('B'), 'north');
    const exits = ms.exitsFor('A');
    expect(exits.get('north')).toEqual({ kind: 'walked', dir: 'north', to: 'B' });
  });

  it('walked fallback (non-compass move) — uses to-match from cached exits', () => {
    const ms = new MapState();
    // A has an exit east → B in the engine table.
    ms.update(view('A', [{ dir: 'east', known: true, to: 'B' }]), null);
    // Player types "enter window" (parseDirection returns null); room changes A→B.
    ms.update(view('B'), null);
    const exits = ms.exitsFor('A');
    expect(exits.get('east')).toEqual({ kind: 'walked', dir: 'east', to: 'B' });
  });

  it('walked on a function-exit (per) — direction from input, no to in exit table', () => {
    // LIVING-ROOM down → CELLAR via TRAP-DOOR-EXIT (per, no to in exit table).
    const ms = new MapState();
    ms.update(view('LIVING-ROOM', [{ dir: 'down', known: false }]), null);
    ms.update(view('CELLAR'), 'down');
    const exits = ms.exitsFor('LIVING-ROOM');
    expect(exits.get('down')).toEqual({ kind: 'walked', dir: 'down', to: 'CELLAR' });
  });

  it('no exit record added when room does not change', () => {
    const ms = new MapState();
    ms.update(view('A'), null);
    ms.update(view('A'), null); // same room
    expect(ms.exitsFor('A').size).toBe(0);
  });
});

// ── New: backtrack exits ──────────────────────────────────────────────────────

describe('MapState — backtrack exits', () => {
  it('backtrack on reciprocal edge — auto-credits opposite on new room', () => {
    // WEST-OF-HOUSE —north→ NORTH-OF-HOUSE; reciprocal: true in ROOM_CONNECTIONS.
    const ms = new MapState();
    ms.update(view('WEST-OF-HOUSE'), null);
    ms.update(view('NORTH-OF-HOUSE'), 'north');
    const exits = ms.exitsFor('NORTH-OF-HOUSE');
    expect(exits.get('south')).toEqual({ kind: 'backtrack', dir: 'south', to: 'WEST-OF-HOUSE' });
  });

  it('NO backtrack on non-reciprocal forest edge — regression guard', () => {
    // FOREST-1 —south→ FOREST-3; reciprocal: false.
    const ms = new MapState();
    ms.update(view('FOREST-1'), null);
    ms.update(view('FOREST-3'), 'south');
    const exits = ms.exitsFor('FOREST-3');
    // Must have no backtrack or walked record for the return direction.
    expect(exits.has('north')).toBe(false);
  });

  it('NO backtrack on one-way drop (LIVING-ROOM→CELLAR, reciprocal: false)', () => {
    const ms = new MapState();
    ms.update(view('LIVING-ROOM'), null);
    ms.update(view('CELLAR'), 'down');
    const exits = ms.exitsFor('CELLAR');
    // No auto-credited up record even though CELLAR up → LIVING-ROOM exists in engine table.
    expect(exits.has('up')).toBe(false);
  });

  it('NO backtrack on edge absent from ROOM_CONNECTIONS — conservative default', () => {
    // Use rooms not in ROOM_CONNECTIONS to simulate an unknown edge.
    const ms = new MapState();
    ms.update(view('EW-PASSAGE'), null);
    ms.update(view('MAZE-1'), 'east');
    expect(ms.exitsFor('MAZE-1').has('west')).toBe(false);
  });
});

// ── New: blocked exits ────────────────────────────────────────────────────────

describe('MapState — blocked exits', () => {
  it('recordBlocked records a blocked record on current room', () => {
    const ms = new MapState();
    ms.update(view('WEST-OF-HOUSE'), null);
    ms.recordBlocked('east' as Dir);
    const exits = ms.exitsFor('WEST-OF-HOUSE');
    expect(exits.get('east')).toEqual({ kind: 'blocked', dir: 'east' });
  });

  it('blocked does not overwrite an existing walked record', () => {
    const ms = new MapState();
    ms.update(view('WEST-OF-HOUSE'), null);
    ms.update(view('NORTH-OF-HOUSE'), 'north');
    // Back to WEST-OF-HOUSE.
    ms.update(view('WEST-OF-HOUSE'), 'south');
    // Now attempt to re-block north (which was already walked).
    ms.recordBlocked('north' as Dir);
    expect(ms.exitsFor('WEST-OF-HOUSE').get('north')?.kind).toBe('walked');
  });

  it('blocked does not overwrite an existing backtrack record', () => {
    const ms = new MapState();
    ms.update(view('WEST-OF-HOUSE'), null);
    ms.update(view('NORTH-OF-HOUSE'), 'north');
    // Now at NORTH-OF-HOUSE; south was auto-credited as backtrack.
    ms.recordBlocked('south' as Dir);
    expect(ms.exitsFor('NORTH-OF-HOUSE').get('south')?.kind).toBe('backtrack');
  });

  it('recordBlocked is a no-op when currentRoom() is null', () => {
    const ms = new MapState();
    expect(() => ms.recordBlocked('north' as Dir)).not.toThrow();
  });
});

// ── Regression guard ──────────────────────────────────────────────────────────

describe('MapState — regression: exits[].known is never read', () => {
  it('passing known:true in exits does not auto-reveal any exit records', () => {
    const ms = new MapState();
    const snapWithExits = {
      here: 'WEST-OF-HOUSE',
      exits: [
        { dir: 'north', known: true, to: 'NORTH-OF-HOUSE' },
        { dir: 'south', known: true, to: 'SOUTH-OF-HOUSE' },
      ],
    };
    ms.update(snapWithExits, null);
    // No traversal happened — no exit records should be present.
    expect(ms.exitsFor('WEST-OF-HOUSE').size).toBe(0);
  });
});

// ── NEW: reciprocal cross-region seam widening (spec §6.6, §11) ───────────────
// Synthetic fixtures — this test does not import ROOM_SEAMS/ROOM_LAYOUT, so it
// stays independent of any per-region task landing.

describe('MapState — reciprocal cross-region seam backtrack (spec §6.6)', () => {
  it('case 1 — reciprocal seam credits a backtrack record on arrival', () => {
    // ROUND-ROOM south -> NARROW-PASSAGE is a reciprocal seam (§6.6's table).
    const ms = new MapState();
    ms.update(view('ROUND-ROOM'), null);
    ms.update(view('NARROW-PASSAGE'), 'south');
    const exits = ms.exitsFor('NARROW-PASSAGE');
    expect(exits.get('north')).toEqual({ kind: 'backtrack', dir: 'north', to: 'ROUND-ROOM' });
  });

  it('case 2 — non-reciprocal uniform-pair seam credits nothing on arrival', () => {
    // RIVER-1 out -> DAM-BASE is non-reciprocal (outbound-only).
    const ms = new MapState();
    ms.update(view('RIVER-1'), null);
    ms.update(view('DAM-BASE'), 'out');
    const exits = ms.exitsFor('DAM-BASE');
    expect(exits.has('in')).toBe(false);
    expect(exits.size).toBe(0);
  });

  it('case 3 (mandatory regression guard) — the SMALL-CAVE/ATLANTIS-ROOM mixed pair is handled direction-precisely', () => {
    // SMALL-CAVE down -> ATLANTIS-ROOM is reciprocal (credits up).
    const msDown = new MapState();
    msDown.update(view('SMALL-CAVE'), null);
    msDown.update(view('ATLANTIS-ROOM'), 'down');
    expect(msDown.exitsFor('ATLANTIS-ROOM').get('up')).toEqual({ kind: 'backtrack', dir: 'up', to: 'SMALL-CAVE' });

    // SMALL-CAVE south -> ATLANTIS-ROOM is NOT reciprocal — must credit
    // nothing, and specifically must NOT phantom-credit north (ATLANTIS-ROOM
    // has no north exit; a pair-keyed implementation would wrongly credit it).
    const msSouth = new MapState();
    msSouth.update(view('SMALL-CAVE'), null);
    msSouth.update(view('ATLANTIS-ROOM'), 'south');
    const exits = msSouth.exitsFor('ATLANTIS-ROOM');
    expect(exits.has('north')).toBe(false);
    expect(exits.size).toBe(0);
  });
});
