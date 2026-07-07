import { describe, it, expect } from 'vitest';
import { renderMapGrid } from '../../src/ui/shell.js';
import type { ExitRecord } from '../../src/ui/map-state.js';
import type { RegionKey, RoomSeam } from '../../src/ui/map-layout.js';

const rooms = new Map([
  ['A', { id: 'A', label: 'Room A', region: 'surface' as RegionKey, col: 0, row: 0 }],
  ['B', { id: 'B', label: 'Room B', region: 'surface' as RegionKey, col: 1, row: 0 }],
  ['C', { id: 'C', label: 'Room C', region: 'cellar-core' as RegionKey, col: 0, row: 1 }],
]);

const connections = [
  { a: 'A', b: 'B', reciprocal: true },
];

const noSeams: RoomSeam[] = [];

function exits(entries: Array<[string, string, ExitRecord]>): Map<string, Map<string, ExitRecord>> {
  const m = new Map<string, Map<string, ExitRecord>>();
  for (const [room, dir, rec] of entries) {
    if (!m.has(room)) m.set(room, new Map());
    m.get(room)!.set(dir, rec);
  }
  return m;
}

describe('renderMapGrid — basics (retained from the pre-region suite)', () => {
  it('returns empty string when nothing visited', () => {
    const result = renderMapGrid(new Set(), null, rooms, connections, noSeams, exits([]), 'surface');
    expect(result).toBe('');
  });

  it('marks the current room with ▶ and draws its box', () => {
    const result = renderMapGrid(new Set(['A']), 'A', rooms, connections, noSeams, exits([]), 'surface');
    expect(result).toContain('▶');
    expect(result).toContain('┌');
    expect(result).toContain('┘');
  });

  it('does not mark ▶ when the current room is elsewhere', () => {
    const result = renderMapGrid(new Set(['A']), 'B', rooms, connections, noSeams, exits([]), 'surface');
    expect(result).not.toContain('▶');
  });
});

describe('renderMapGrid — region filtering', () => {
  it('renders only rooms matching the target region', () => {
    const visited = new Set(['A', 'B', 'C']);
    const result = renderMapGrid(visited, 'A', rooms, connections, noSeams, exits([]), 'surface');
    expect(result).toContain('Room A');
    expect(result).toContain('Room B');
    expect(result).not.toContain('Room C');
  });

  it('a different region filter renders only that region\'s rooms', () => {
    const visited = new Set(['A', 'B', 'C']);
    const result = renderMapGrid(visited, 'C', rooms, connections, noSeams, exits([]), 'cellar-core');
    expect(result).not.toContain('Room A');
    expect(result).not.toContain('Room B');
    expect(result).toContain('Room C');
  });
});

describe('renderMapGrid — connection visibility gated by exit records', () => {
  it('connection between A and B renders when A has walked east to B', () => {
    const visited = new Set(['A', 'B']);
    const rec = exits([['A', 'east', { kind: 'walked', dir: 'east', to: 'B' }]]);
    const result = renderMapGrid(visited, 'A', rooms, connections, noSeams, rec, 'surface');
    expect(result).toMatch(/│───│/);
  });

  it('connection NOT rendered when both visited but no exit record', () => {
    const visited = new Set(['A', 'B']);
    const result = renderMapGrid(visited, 'A', rooms, connections, noSeams, exits([]), 'surface');
    expect(result).not.toMatch(/│───│/);
  });

  it('backtrack record also causes connection to render', () => {
    const visited = new Set(['A', 'B']);
    const rec = exits([['B', 'west', { kind: 'backtrack', dir: 'west', to: 'A' }]]);
    const result = renderMapGrid(visited, 'A', rooms, connections, noSeams, rec, 'surface');
    expect(result).toMatch(/│───│/);
  });
});

describe('renderMapGrid — blocked stub', () => {
  it('blocked east on room A renders ✕ in the gap to the right of A', () => {
    const visited = new Set(['A']);
    const rec = exits([['A', 'east', { kind: 'blocked', dir: 'east' }]]);
    const result = renderMapGrid(visited, 'A', rooms, connections, noSeams, rec, 'surface');
    expect(result).toContain('✕');
  });
});

// NOTE: inter-level stub tests are deleted, not generalized — drawInterLevelStub
// has no successor under legend-only cross-region seams (spec §6.3). A seam's
// only representation is the text legend, covered in region-seam-legend.test.ts.
