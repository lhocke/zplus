import { describe, it, expect } from 'vitest';
import { renderMapGrid } from '../../src/ui/shell.js';
import type { ExitRecord } from '../../src/ui/map-state.js';

// Minimal room map with level info.
const rooms = new Map([
  ['A', { id: 'A', label: 'Room A', col: 0, row: 0, level: 'surface'     as const }],
  ['B', { id: 'B', label: 'Room B', col: 1, row: 0, level: 'surface'     as const }],
  ['C', { id: 'C', label: 'Room C', col: 0, row: 1, level: 'underground' as const }],
]);

const connections = [
  { a: 'A', b: 'B', reciprocal: true  },
  { a: 'A', b: 'C', reciprocal: false }, // inter-level
];

// Build an exitRecords map for the given room/dir/record pairs.
function exits(entries: Array<[string, string, ExitRecord]>): Map<string, Map<string, ExitRecord>> {
  const m = new Map<string, Map<string, ExitRecord>>();
  for (const [room, dir, rec] of entries) {
    if (!m.has(room)) m.set(room, new Map());
    m.get(room)!.set(dir, rec);
  }
  return m;
}

describe('renderMapGrid — level filtering', () => {
  it('renders only rooms matching the target level', () => {
    const visited = new Set(['A', 'B', 'C']);
    const result = renderMapGrid(visited, 'A', rooms, connections, exits([]), 'surface');
    expect(result).toContain('Room A');
    expect(result).toContain('Room B');
    expect(result).not.toContain('Room C');
  });

  it('underground filter renders only underground rooms', () => {
    const visited = new Set(['A', 'B', 'C']);
    const result = renderMapGrid(visited, 'C', rooms, connections, exits([]), 'underground');
    expect(result).not.toContain('Room A');
    expect(result).not.toContain('Room B');
    expect(result).toContain('Room C');
  });
});

describe('renderMapGrid — connection visibility gated by exit records', () => {
  it('connection between A and B renders when A has walked east to B', () => {
    const visited = new Set(['A', 'B']);
    const rec = exits([['A', 'east', { kind: 'walked', dir: 'east', to: 'B' }]]);
    const result = renderMapGrid(visited, 'A', rooms, connections, rec, 'surface');
    // The label row should have a solid connector between the two room boxes.
    expect(result).toMatch(/│───│/);
  });

  it('connection NOT rendered when both visited but no exit record', () => {
    const visited = new Set(['A', 'B']);
    const result = renderMapGrid(visited, 'A', rooms, connections, exits([]), 'surface');
    // No connector in the label row between rooms — gap stays spaces.
    expect(result).not.toMatch(/│───│/);
  });

  it('backtrack record also causes connection to render', () => {
    const visited = new Set(['A', 'B']);
    const rec = exits([['B', 'west', { kind: 'backtrack', dir: 'west', to: 'A' }]]);
    const result = renderMapGrid(visited, 'A', rooms, connections, rec, 'surface');
    expect(result).toMatch(/│───│/);
  });
});

describe('renderMapGrid — blocked stub', () => {
  it('blocked east on room A renders ✕ in the gap to the right of A', () => {
    const visited = new Set(['A']);
    const rec = exits([['A', 'east', { kind: 'blocked', dir: 'east' }]]);
    const result = renderMapGrid(visited, 'A', rooms, connections, rec, 'surface');
    expect(result).toContain('✕');
  });
});

describe('renderMapGrid — inter-level stubs', () => {
  it('walked down from LIVING-ROOM renders ⬇ stub on LIVING-ROOM in surface render', () => {
    const lrRooms = new Map([
      ['LIVING-ROOM', { id: 'LIVING-ROOM', label: 'Living Room', col: 3, row: 2, level: 'surface' as const }],
    ]);
    const visited = new Set(['LIVING-ROOM']);
    const rec = exits([['LIVING-ROOM', 'down', { kind: 'walked', dir: 'down', to: 'CELLAR' }]]);
    const result = renderMapGrid(visited, 'LIVING-ROOM', lrRooms, [], rec, 'surface');
    expect(result).toContain('⬇');
  });

  it('walked up from STUDIO renders ⬆ stub on STUDIO in underground render', () => {
    const stRooms = new Map([
      ['STUDIO', { id: 'STUDIO', label: 'Studio', col: 4, row: 5, level: 'underground' as const }],
    ]);
    const visited = new Set(['STUDIO']);
    const rec = exits([['STUDIO', 'up', { kind: 'walked', dir: 'up', to: 'KITCHEN' }]]);
    const result = renderMapGrid(visited, 'STUDIO', stRooms, [], rec, 'underground');
    expect(result).toContain('⬆');
  });
});
