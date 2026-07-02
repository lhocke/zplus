/**
 * region-seam-derivation — re-derives the cross-region seam list directly
 * from rooms.json (spec §5.2, all 4 steps) and asserts it set-equals the
 * static ROOM_SEAMS export field-for-field, reciprocal included. This is the
 * strongest seam guard: it goes red the moment rooms.json drifts out from
 * under a hand-maintained seam list, rather than letting a stale seam or
 * reciprocal flag silently ship.
 *
 * Deliberately NOT named seam.test.ts — that name is already used by the
 * unrelated session/engine golden-transcript test convention (spec §2).
 */
import { describe, it, expect } from 'vitest';
import roomsData from '../../src/data/rooms.json';
import { ROOM_SEAMS, MAPPED_REGIONS, type RegionKey } from '../../src/ui/map-layout.js';
import { REGION_TABLE } from './region-table.js';

const MAPPED_SET = new Set<string>(MAPPED_REGIONS);

const OPPOSITE: Record<string, string> = {
  north: 'south', south: 'north', east: 'west', west: 'east',
  ne: 'sw', sw: 'ne', nw: 'se', se: 'nw', up: 'down', down: 'up', in: 'out', out: 'in',
};

interface RawRoom { id: string; exits?: Array<{ dir: string; to?: string }> }

function deriveSeams() {
  const rooms = roomsData as RawRoom[];
  const roomRegion = new Map<string, RegionKey>();
  for (const [region, ids] of Object.entries(REGION_TABLE)) {
    for (const id of ids) roomRegion.set(id, region as RegionKey);
  }

  const candidates: Array<{ from: string; dir: string; to: string; toRegion: RegionKey }> = [];
  for (const r of rooms) {
    const fromRegion = roomRegion.get(r.id);
    for (const exit of r.exits ?? []) {
      if (!exit.to) continue;
      const toRegion = roomRegion.get(exit.to);
      if (fromRegion && toRegion && fromRegion !== toRegion) {
        candidates.push({ from: r.id, dir: exit.dir, to: exit.to, toRegion });
      }
    }
  }
  const kept = candidates.filter(c => MAPPED_SET.has(roomRegion.get(c.from) as string));
  const keptKeys = new Set(kept.map(k => `${k.from}|${k.dir}|${k.to}`));
  return kept.map(k => ({
    from: k.from,
    dir: k.dir,
    to: k.to,
    toRegion: k.toRegion,
    reciprocal: keptKeys.has(`${k.to}|${OPPOSITE[k.dir]}|${k.from}`),
  }));
}

describe('ROOM_SEAMS matches the rooms.json re-derivation exactly', () => {
  it('set-equals the derived seam list, field-for-field including reciprocal', () => {
    const derived = deriveSeams();
    const toKey = (s: { from: string; dir: string; to: string; toRegion: string; reciprocal: boolean }) =>
      `${s.from}|${s.dir}|${s.to}|${s.toRegion}|${s.reciprocal}`;
    const derivedKeys = new Set(derived.map(toKey));
    const actualKeys = new Set(ROOM_SEAMS.map(toKey));
    expect(actualKeys.size, 'ROOM_SEAMS has duplicate entries').toBe(ROOM_SEAMS.length);
    expect([...actualKeys].sort()).toEqual([...derivedKeys].sort());
  });

  it('derives exactly 39 kept (mapped-origin) seams, 10 reciprocal pairs', () => {
    const derived = deriveSeams();
    expect(derived.length).toBe(39);
    expect(derived.filter(s => s.reciprocal).length).toBe(20);
  });
});
