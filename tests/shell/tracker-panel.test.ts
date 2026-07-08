import { describe, it, expect } from 'vitest';
import { computeTrackerRows, computeObtainedProgression } from '../../src/ui/tracker-panel.js';
import type { LogicGraph } from '../../src/logic/logic-graph-types.js';

const GRAPH: LogicGraph = {
  logicVersion: 1, checksum: 'x',
  regions: [{ id: 'surface', rooms: ['A'], access: {} }],
  items: [
    { id: 'lamp', class: 'progression', isTreasure: false },
    { id: 'painting', class: 'filler', isTreasure: true },
  ],
  locations: [
    { id: 'loc-a', objectId: 'lamp', containerId: 'LIVING-ROOM', region: 'surface', access: {} },
    { id: 'loc-b', objectId: 'painting', containerId: 'GALLERY', region: 'surface', access: {} },
  ],
};

describe('tracker panel logic', () => {
  it('reports 0/N checked when every item is still at its shuffled container', () => {
    const parents = new Map([['lamp', 'LIVING-ROOM'], ['painting', 'GALLERY']]);
    const rows = computeTrackerRows(GRAPH, parents);
    expect(rows).toEqual([{ region: 'surface', label: 'Surface', checked: 0, total: 2 }]);
  });

  it('counts a location checked once its item has moved away from its shuffled container', () => {
    const parents = new Map([['lamp', 'PLAYER'], ['painting', 'GALLERY']]);
    const rows = computeTrackerRows(GRAPH, parents);
    expect(rows[0].checked).toBe(1);
  });

  it('a thief-moved item (parent = THIEF room, not PLAYER) still counts as checked', () => {
    const parents = new Map([['lamp', 'ROUND-ROOM'], ['painting', 'GALLERY']]);
    expect(computeTrackerRows(GRAPH, parents)[0].checked).toBe(1);
  });

  it('never exposes an unchecked location\'s target container (spoiler-free contract)', () => {
    const parents = new Map([['lamp', 'LIVING-ROOM'], ['painting', 'GALLERY']]);
    const rows = computeTrackerRows(GRAPH, parents);
    const serialized = JSON.stringify(rows);
    expect(serialized).not.toContain('LIVING-ROOM');
    expect(serialized).not.toContain('GALLERY');
  });

  it('computeObtainedProgression lists only progression items currently held by PLAYER', () => {
    const parents = new Map([['lamp', 'PLAYER'], ['painting', 'PLAYER']]);
    expect(computeObtainedProgression(GRAPH, parents)).toEqual(['lamp']);
  });
});
