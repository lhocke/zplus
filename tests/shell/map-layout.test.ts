/**
 * map-layout — region-model schema guards (spec §3, §4, §11).
 * Synthetic-fixture-free: these guards quantify over whatever is currently
 * in ROOM_LAYOUT/ROOM_CONNECTIONS, so they are green on partial data during
 * the per-region build-out (Tasks 2-10) and only reach full strength once
 * every region task has landed.
 */
import { describe, it, expect } from 'vitest';
import roomsData from '../../src/data/rooms.json';
import {
  ROOM_LAYOUT,
  ROOM_CONNECTIONS,
  ROOM_BY_ID,
  MAPPED_REGIONS,
} from '../../src/ui/map-layout.js';

const MAPPED_SET = new Set<string>(MAPPED_REGIONS);

describe('ROOM_LAYOUT — region model shape', () => {
  it('every entry has a region field that is a known RegionKey', () => {
    const known = new Set<string>([
      'surface', 'cellar-core', 'dam', 'mine', 'river',
      'mirror', 'temple', 'canyon', 'cyclops', 'thief-maze', 'mine-maze',
    ]);
    for (const r of ROOM_LAYOUT) {
      expect(known.has(r.region), `room ${r.id} has unknown region ${r.region}`).toBe(true);
    }
  });

  it('mapped-region entries have both col and row; unmapped entries have neither', () => {
    for (const r of ROOM_LAYOUT) {
      if (MAPPED_SET.has(r.region)) {
        expect(r.col, `${r.id} (${r.region}) missing col`).not.toBeUndefined();
        expect(r.row, `${r.id} (${r.region}) missing row`).not.toBeUndefined();
      } else {
        expect(r.col, `${r.id} (${r.region}) unexpectedly has col`).toBeUndefined();
        expect(r.row, `${r.id} (${r.region}) unexpectedly has row`).toBeUndefined();
      }
    }
  });

  it('no duplicate room ids', () => {
    const ids = ROOM_LAYOUT.map(r => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('ROOM_LAYOUT — no intra-region coordinate collisions', () => {
  it('within each mapped region, no two rooms share a (col, row) pair', () => {
    const byRegion = new Map<string, Map<string, string>>();
    for (const r of ROOM_LAYOUT) {
      if (!MAPPED_SET.has(r.region) || r.col === undefined || r.row === undefined) continue;
      let cells = byRegion.get(r.region);
      if (!cells) { cells = new Map(); byRegion.set(r.region, cells); }
      const key = `${r.col},${r.row}`;
      const existing = cells.get(key);
      expect(existing, `${r.region}: ${r.id} collides with ${existing} at (${key})`).toBeUndefined();
      cells.set(key, r.id);
    }
  });
});

describe('ROOM_CONNECTIONS — intra-region only', () => {
  it('every connection endpoint pair resolves to the same region', () => {
    for (const c of ROOM_CONNECTIONS) {
      const a = ROOM_BY_ID.get(c.a);
      const b = ROOM_BY_ID.get(c.b);
      expect(a, `${c.a} not in ROOM_BY_ID`).toBeDefined();
      expect(b, `${c.b} not in ROOM_BY_ID`).toBeDefined();
      expect(a!.region, `${c.a}<->${c.b} spans regions (${a!.region} vs ${b!.region}) — belongs in ROOM_SEAMS, not ROOM_CONNECTIONS`).toBe(b!.region);
    }
  });

  it('every connection endpoint exists in ROOM_BY_ID', () => {
    for (const c of ROOM_CONNECTIONS) {
      expect(ROOM_BY_ID.has(c.a), `${c.a} not in ROOM_BY_ID`).toBe(true);
      expect(ROOM_BY_ID.has(c.b), `${c.b} not in ROOM_BY_ID`).toBe(true);
    }
  });

  it('every connection corresponds to a real rooms.json exit (a->b or b->a)', () => {
    interface RawRoom { id: string; exits?: Array<{ dir: string; to?: string }> }
    const exitPairs = new Set<string>();
    for (const room of roomsData as RawRoom[]) {
      for (const exit of room.exits ?? []) {
        if (exit.to) exitPairs.add(`${room.id}|${exit.to}`);
      }
    }
    for (const c of ROOM_CONNECTIONS) {
      const real = exitPairs.has(`${c.a}|${c.b}`) || exitPairs.has(`${c.b}|${c.a}`);
      expect(real, `${c.a}<->${c.b} does not correspond to any rooms.json exit`).toBe(true);
    }
  });
});

// NOTE: the partition-completeness guard (all 110 rooms placed, region equals
// the canonical §4 assignment, mapped-have-coords/unmapped-don't) is
// DEFERRED to Task 11 by design — it would be red-by-construction until all
// nine per-region tasks land, and every task in this plan must end
// full-suite-green. See Task 11's "Add the partition-completeness guard" step.
