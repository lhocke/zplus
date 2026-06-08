/**
 * Map state — fog-of-war reveal logic (§3 / §9).
 *
 * Pure DOM-free module: driven by scripted view() snapshots, no rendering.
 */

import { describe, it, expect } from 'vitest';
import { MapState } from '../../src/ui/map-state.js';

// Minimal stub that satisfies the MapState API.
function view(here: string) {
  return { here };
}

describe('MapState — room reveal', () => {
  it('newly created state has no visited rooms', () => {
    const ms = new MapState();
    expect(ms.visitedRooms().size).toBe(0);
  });

  it('visiting a room adds it to the visited set', () => {
    const ms = new MapState();
    ms.update(view('WEST-OF-HOUSE'));
    expect(ms.visitedRooms().has('WEST-OF-HOUSE')).toBe(true);
  });

  it('visiting the same room twice adds it only once', () => {
    const ms = new MapState();
    ms.update(view('WEST-OF-HOUSE'));
    ms.update(view('WEST-OF-HOUSE'));
    expect(ms.visitedRooms().size).toBe(1);
  });

  it('visiting multiple rooms adds all of them', () => {
    const ms = new MapState();
    ms.update(view('WEST-OF-HOUSE'));
    ms.update(view('NORTH-OF-HOUSE'));
    expect(ms.visitedRooms().has('WEST-OF-HOUSE')).toBe(true);
    expect(ms.visitedRooms().has('NORTH-OF-HOUSE')).toBe(true);
  });

  it('unknown room id (past troll, not in layout) is stored but causes no crash', () => {
    const ms = new MapState();
    expect(() => ms.update(view('EW-PASSAGE'))).not.toThrow();
    // Still recorded in visited, even if not renderable.
    expect(ms.visitedRooms().has('EW-PASSAGE')).toBe(true);
  });
});

describe('MapState — edge reveal', () => {
  it('no edges discovered in fresh state', () => {
    const ms = new MapState();
    expect(ms.discoveredEdges().size).toBe(0);
  });

  it('traversing A → B discovers the A↔B edge', () => {
    const ms = new MapState();
    ms.update(view('WEST-OF-HOUSE'));
    ms.update(view('NORTH-OF-HOUSE'));
    const edges = ms.discoveredEdges();
    // Edge is stored as a canonical sorted key.
    const key = ['NORTH-OF-HOUSE', 'WEST-OF-HOUSE'].sort().join('--');
    expect(edges.has(key)).toBe(true);
  });

  it('re-traversing the same edge does not add a duplicate', () => {
    const ms = new MapState();
    ms.update(view('WEST-OF-HOUSE'));
    ms.update(view('NORTH-OF-HOUSE'));
    ms.update(view('WEST-OF-HOUSE')); // back
    ms.update(view('NORTH-OF-HOUSE')); // forward again
    const edges = ms.discoveredEdges();
    // Should still be exactly 1 edge.
    expect(edges.size).toBe(1);
  });

  it('non-linear teleport (resurrection → FOREST-1) adds a resurrection edge', () => {
    // After dying the player lands in FOREST-1 regardless of previous room.
    // The map state must handle this without crashing, even if the jump is
    // non-geographic (we record the edge; rendering may skip it if both aren't
    // in the layout, but it must not throw).
    const ms = new MapState();
    ms.update(view('CELLAR'));
    ms.update(view('FOREST-1')); // resurrection jump
    expect(() => ms.update(view('EAST-OF-CHASM'))).not.toThrow();
  });

  it('multiple distinct traversals discover multiple edges', () => {
    const ms = new MapState();
    ms.update(view('WEST-OF-HOUSE'));
    ms.update(view('NORTH-OF-HOUSE'));
    ms.update(view('EAST-OF-HOUSE'));
    expect(ms.discoveredEdges().size).toBe(2);
  });
});

describe('MapState — current room', () => {
  it('currentRoom() returns null before any update', () => {
    const ms = new MapState();
    expect(ms.currentRoom()).toBeNull();
  });

  it('currentRoom() returns the most recently visited room', () => {
    const ms = new MapState();
    ms.update(view('WEST-OF-HOUSE'));
    expect(ms.currentRoom()).toBe('WEST-OF-HOUSE');
    ms.update(view('NORTH-OF-HOUSE'));
    expect(ms.currentRoom()).toBe('NORTH-OF-HOUSE');
  });
});

describe('MapState — does NOT use exits[].known as a discovery signal', () => {
  it('update() only takes a { here: string } snapshot — exits[].known is not read', () => {
    const ms = new MapState();
    // Passing a snapshot that has exits with known:true should NOT auto-reveal any edges —
    // only actual traversal (here changing) reveals edges.
    const snapWithExits = {
      here: 'WEST-OF-HOUSE',
      exits: [
        { dir: 'north', known: true, to: 'NORTH-OF-HOUSE' },
        { dir: 'south', known: true, to: 'SOUTH-OF-HOUSE' },
      ],
    };
    ms.update(snapWithExits);
    // No traversal happened yet — no edges should be discovered.
    expect(ms.discoveredEdges().size).toBe(0);
  });
});

describe('MapState — reset', () => {
  it('reset() clears all state', () => {
    const ms = new MapState();
    ms.update(view('WEST-OF-HOUSE'));
    ms.update(view('NORTH-OF-HOUSE'));
    ms.reset();
    expect(ms.visitedRooms().size).toBe(0);
    expect(ms.discoveredEdges().size).toBe(0);
    expect(ms.currentRoom()).toBeNull();
  });
});
