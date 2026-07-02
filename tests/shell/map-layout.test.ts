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
import { REGION_TABLE } from './region-table.js';

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

// ── Partition completeness (spec §4, §11 — the G1 gate) ──────────────────────
// Reads the SAME canonical roomRegion table as region-seam-derivation.test.ts
// (spec §11: no duplicated hardcoded region table between the two tests).

describe('ROOM_LAYOUT — partition completeness (all 110 rooms)', () => {
  const roomRegion = new Map<string, string>();
  for (const [region, ids] of Object.entries(REGION_TABLE)) {
    for (const id of ids) roomRegion.set(id, region);
  }
  const roomsJsonIds = new Set((roomsData as Array<{ id: string }>).map(r => r.id));

  it('the canonical partition covers exactly the rooms.json id set', () => {
    expect(roomRegion.size).toBe(roomsJsonIds.size);
    for (const id of roomRegion.keys()) {
      expect(roomsJsonIds.has(id), `${id} in partition but not rooms.json`).toBe(true);
    }
  });

  it('every rooms.json room has a ROOM_LAYOUT entry with the canonical region', () => {
    for (const id of roomsJsonIds) {
      const entry = ROOM_BY_ID.get(id);
      expect(entry, `${id} missing from ROOM_LAYOUT`).toBeDefined();
      expect(entry!.region, id).toBe(roomRegion.get(id));
    }
  });

  it('ROOM_LAYOUT has exactly 110 entries — no extras', () => {
    expect(ROOM_LAYOUT.length).toBe(110);
  });

  it('all 86 mapped rooms have coords; all 24 unmapped rooms have neither', () => {
    let mapped = 0, unmapped = 0;
    for (const r of ROOM_LAYOUT) {
      if (MAPPED_SET.has(r.region)) {
        mapped++;
        expect(r.col, `${r.id} missing col`).not.toBeUndefined();
        expect(r.row, `${r.id} missing row`).not.toBeUndefined();
      } else {
        unmapped++;
        expect(r.col, `${r.id} has col`).toBeUndefined();
        expect(r.row, `${r.id} has row`).toBeUndefined();
      }
    }
    expect(mapped).toBe(86);
    expect(unmapped).toBe(24);
  });
});
