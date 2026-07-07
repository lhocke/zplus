/**
 * region-seam-legend — byte-exact legend format, sort order, fog-of-war gate,
 * no-dedup multi-seam cases (spec §6.4, §11). Synthetic fixtures throughout
 * so this file is green independent of any per-region task landing.
 */
import { describe, it, expect } from 'vitest';
import { renderMapGrid } from '../../src/ui/shell.js';
import type { ExitRecord } from '../../src/ui/map-state.js';
import type { RoomSeam, RegionKey } from '../../src/ui/map-layout.js';

const rooms = new Map<string, { id: string; label: string; region: RegionKey; col?: number; row?: number }>([
  ['SLIDE-ROOM', { id: 'SLIDE-ROOM', label: 'Slide Rm', region: 'mine' as RegionKey, col: 0, row: 0 }],
  ['RIVER-1', { id: 'RIVER-1', label: 'River 1', region: 'river' as RegionKey, col: 0, row: 0 }],
]);

const seams: RoomSeam[] = [
  { from: 'SLIDE-ROOM', dir: 'east', to: 'COLD-PASSAGE', toRegion: 'mirror' as RegionKey, reciprocal: true },
  { from: 'SLIDE-ROOM', dir: 'down', to: 'CELLAR', toRegion: 'cellar-core' as RegionKey, reciprocal: false },
  { from: 'RIVER-1', dir: 'west', to: 'DAM-BASE', toRegion: 'dam' as RegionKey, reciprocal: false },
  { from: 'RIVER-1', dir: 'out', to: 'DAM-BASE', toRegion: 'dam' as RegionKey, reciprocal: false },
];

function exitsMap(entries: Array<[string, string, ExitRecord]>) {
  const m = new Map<string, Map<string, ExitRecord>>();
  for (const [room, dir, rec] of entries) {
    if (!m.has(room)) m.set(room, new Map());
    m.get(room)!.set(dir, rec);
  }
  return m;
}

describe('renderMapGrid — seam legend', () => {
  it('a discovered seam produces exactly one byte-exact legend line', () => {
    const visited = new Set(['SLIDE-ROOM']);
    const exits = exitsMap([['SLIDE-ROOM', 'east', { kind: 'walked', dir: 'east', to: 'COLD-PASSAGE' }]]);
    const result = renderMapGrid(visited, 'SLIDE-ROOM', rooms, [], seams, exits, 'mine');
    expect(result).toContain('\n\n→ Mirror Rooms & Twisty Passages (via Slide Rm, east)');
  });

  it('two discovered seams from the same room, sorted by label then dir', () => {
    const visited = new Set(['SLIDE-ROOM']);
    const exits = exitsMap([
      ['SLIDE-ROOM', 'east', { kind: 'walked', dir: 'east', to: 'COLD-PASSAGE' }],
      ['SLIDE-ROOM', 'down', { kind: 'walked', dir: 'down', to: 'CELLAR' }],
    ]);
    const result = renderMapGrid(visited, 'SLIDE-ROOM', rooms, [], seams, exits, 'mine');
    const legend = result.split('\n\n')[1];
    expect(legend).toBe(
      '→ Cellar & Central Passages (via Slide Rm, down)\n' +
      '→ Mirror Rooms & Twisty Passages (via Slide Rm, east)',
    );
  });

  it('two seams to the same destination room via different exits both render, no dedup', () => {
    const visited = new Set(['RIVER-1']);
    const exits = exitsMap([
      ['RIVER-1', 'west', { kind: 'walked', dir: 'west', to: 'DAM-BASE' }],
      ['RIVER-1', 'out', { kind: 'walked', dir: 'out', to: 'DAM-BASE' }],
    ]);
    const result = renderMapGrid(visited, 'RIVER-1', rooms, [], seams, exits, 'river');
    const legend = result.split('\n\n')[1];
    expect(legend).toBe(
      '→ Dam & Reservoir (via River 1, out)\n' +
      '→ Dam & Reservoir (via River 1, west)',
    );
  });

  it('an undiscovered seam produces no line (fog-of-war gate)', () => {
    const visited = new Set(['SLIDE-ROOM']);
    const result = renderMapGrid(visited, 'SLIDE-ROOM', rooms, [], seams, exitsMap([]), 'mine');
    expect(result).not.toContain('→');
  });

  it('zero discovered seams: no legend block, no trailing blank line', () => {
    const visited = new Set(['SLIDE-ROOM']);
    const result = renderMapGrid(visited, 'SLIDE-ROOM', rooms, [], seams, exitsMap([]), 'mine');
    expect(result.endsWith('\n\n')).toBe(false);
    expect(result).not.toMatch(/\n\n$/);
  });

  it('a blocked exit record does not surface a seam line', () => {
    const visited = new Set(['SLIDE-ROOM']);
    const exits = exitsMap([['SLIDE-ROOM', 'east', { kind: 'blocked', dir: 'east' }]]);
    const result = renderMapGrid(visited, 'SLIDE-ROOM', rooms, [], seams, exits, 'mine');
    expect(result).not.toContain('→');
  });
});
