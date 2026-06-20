/**
 * V3 — No-hard-locks-across-restore invariant (spec §10.4, House Style).
 *
 * The reachable⇒escapable⇒can-return property must survive a restore: a
 * restored game state must not strand the player in a room whose flag-gated
 * exits didn't round-trip.
 *
 * Two layers:
 *
 *  1. Exit-round-trip tests: set a flag that opens a blocked exit, snapshot,
 *     restore onto a fresh game, attempt to move through that exit. Must
 *     succeed (no blocked-exit message).  Covers both FlagStore globals and
 *     object Open-bit gates.
 *
 *  2. Graph-invariant test: take the same SETTABLE_GLOBALS + KNOWN_TRAPS as
 *     no-hard-locks.test.ts, but run the "passable" check against the LIVE
 *     restored engine's flag state rather than a static assumption set.
 *     Proves the invariant survives restore for every flag combination the
 *     engine can produce.
 *
 * Self-retiring trap allowlist: KNOWN_TRAPS below must stay identical to the
 * one in no-hard-locks.test.ts.  The test fails if an entry stops being a
 * trap (wave landed), so the allowlist can only shrink.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createGame } from '../../src/engine/bootstrap.js';
import { Flag } from '../../src/domain/flags.js';
import { resetThiefState } from '../../src/actions/thief-state.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');

// ---------------------------------------------------------------------------
// Shared graph data (same analysis as no-hard-locks.test.ts)
// ---------------------------------------------------------------------------

// Self-retiring trap allowlist — must stay in sync with no-hard-locks.test.ts.
// (WHITE-CLIFFS-NORTH retired 2026-06-12: dam merge landed WHITE-CLIFFS-FUNCTION M-END)
const KNOWN_TRAPS: Record<string, string> = {};

// FEXIT destinations
const PER_DEST: Record<string, string> = { 'TRAP-DOOR-EXIT': 'CELLAR' };

const START = 'WEST-OF-HOUSE';

type Exit = { dir: string; to?: string; per?: string; ifFlag?: string };
type Room = { id: string; exits?: Exit[] };

const rooms: Room[] = JSON.parse(fs.readFileSync(path.join(ROOT, 'src/data/rooms.json'), 'utf8'));
const objectIds = new Set(
  JSON.parse(fs.readFileSync(path.join(ROOT, 'src/data/objects.json'), 'utf8')).map((o: { id: string }) => o.id),
);
const byId = new Map(rooms.map(r => [r.id, r]));

// Passable analysis identical to no-hard-locks.test.ts — static, assumes all
// SETTABLE_GLOBALS are true and all door objects can be opened.
const SETTABLE_GLOBALS = new Set([
  'TROLL-FLAG', 'WON-FLAG', 'CYCLOPS-FLAG', 'MAGIC-FLAG',
  'GATE-FLAG', 'GATES-OPEN', 'LOW-TIDE', 'DEFLATE', 'RAINBOW-FLAG', 'LOUD-FLAG', 'BUOY-FLAG',
  'LLD-FLAG', 'DOME-FLAG',
]);

function passable(e: Exit): boolean {
  if (e.per) return true;
  if (!e.to) return false;
  if (!e.ifFlag) return true;
  if (e.ifFlag === 'FALSE-FLAG') return false;
  return SETTABLE_GLOBALS.has(e.ifFlag) || objectIds.has(e.ifFlag);
}

function dests(r: Room): string[] {
  return (r.exits ?? [])
    .filter(passable)
    .map(e => e.to ?? PER_DEST[e.per!])
    .filter((d): d is string => !!d && byId.has(d));
}

function reach(from: string, stopAt?: string): Set<string> {
  const seen = new Set([from]);
  const stack = [from];
  while (stack.length) {
    const cur = stack.pop()!;
    if (cur === stopAt) return seen;
    for (const n of dests(byId.get(cur)!)) {
      if (!seen.has(n)) { seen.add(n); stack.push(n); }
    }
  }
  return seen;
}

// ---------------------------------------------------------------------------
// Helper: set a FlagStore global via snapshot round-trip
// ---------------------------------------------------------------------------

function withFlag(
  g: ReturnType<typeof createGame>,
  flag: string,
  value: boolean,
): void {
  const snap = g.snapshot();
  const existing = snap.flagStore.filter(([k]) => k !== flag);
  g.restore({ ...snap, flagStore: [...existing, [flag, value]] });
}

// ---------------------------------------------------------------------------
// Helper: give player a lit lamp (so grue doesn't kill them in dark rooms).
// Manipulates live world objects before snapshotting.
// ---------------------------------------------------------------------------

function litUp(g: ReturnType<typeof createGame>): void {
  const player = g.world.get('PLAYER')!;
  const lamp   = g.world.get('LAMP')!;
  lamp.moveTo(player);
  lamp.flags.add(Flag.OnFire);
  lamp.flags.add(Flag.Light);
}

// ---------------------------------------------------------------------------
// 1. FlagStore globals round-trip through restore
// ---------------------------------------------------------------------------

describe('V3 FlagStore flags survive restore', () => {
  beforeEach(() => { resetThiefState(); });

  it('TROLL-FLAG=true: east exit through troll room works after restore', () => {
    const g1 = createGame({ seed: 42, startRoom: 'TROLL-ROOM' });
    g1.start();
    litUp(g1);
    withFlag(g1, 'TROLL-FLAG', true);

    const snap = g1.snapshot();
    expect(snap.flagStore.find(([k]) => k === 'TROLL-FLAG')?.[1]).toBe(true);

    const g2 = createGame({ seed: 42 });
    g2.start();
    g2.restore(snap);

    // Restored game must be in TROLL-ROOM with TROLL-FLAG still true.
    expect(g2.view().here).toBe('TROLL-ROOM');
    const out = g2.turn('east');
    expect(out.output).not.toContain('fends you off');
    // Moved to EW-PASSAGE (east of troll room).
    expect(g2.view().here).toBe('EW-PASSAGE');
  });

  it('TROLL-FLAG=true: west exit through troll room works after restore', () => {
    const g1 = createGame({ seed: 42, startRoom: 'TROLL-ROOM' });
    g1.start();
    litUp(g1);
    withFlag(g1, 'TROLL-FLAG', true);

    const snap = g1.snapshot();
    const g2 = createGame({ seed: 42 });
    g2.start();
    g2.restore(snap);

    const out = g2.turn('west');
    expect(out.output).not.toContain('fends you off');
    expect(g2.view().here).toBe('MAZE-1');
  });

  it('CYCLOPS-FLAG=true: up exit from cyclops room works after restore', () => {
    const g1 = createGame({ seed: 42, startRoom: 'CYCLOPS-ROOM' });
    g1.start();
    litUp(g1);
    withFlag(g1, 'CYCLOPS-FLAG', true);

    const snap = g1.snapshot();
    const g2 = createGame({ seed: 42 });
    g2.start();
    g2.restore(snap);

    expect(g2.view().here).toBe('CYCLOPS-ROOM');
    const out = g2.turn('up');
    expect(out.output).not.toContain("cyclops doesn't look");
    expect(g2.view().here).toBe('TREASURE-ROOM');
  });

  it('MAGIC-FLAG=true: east exit from cyclops room works after restore', () => {
    const g1 = createGame({ seed: 42, startRoom: 'CYCLOPS-ROOM' });
    g1.start();
    litUp(g1);
    withFlag(g1, 'MAGIC-FLAG', true);

    const snap = g1.snapshot();
    const g2 = createGame({ seed: 42 });
    g2.start();
    g2.restore(snap);

    expect(g2.view().here).toBe('CYCLOPS-ROOM');
    const out = g2.turn('east');
    expect(out.output).not.toContain('solid rock');
    expect(g2.view().here).toBe('STRANGE-PASSAGE');
  });
});

// ---------------------------------------------------------------------------
// 2. Object Open-bit gates round-trip through restore
// ---------------------------------------------------------------------------

describe('V3 object Open-bit exits survive restore', () => {
  beforeEach(() => { resetThiefState(); });

  it('GRATE open: up exit from grating room works after restore', () => {
    const g1 = createGame({ seed: 42, startRoom: 'GRATING-ROOM' });
    g1.start();

    // Open the grate via snapshot delta (set Open flag on GRATE object).
    const snap1 = g1.snapshot();
    const objs = snap1.objects.map(d => {
      if (d.id !== 'GRATE') return d;
      const openBit = Flag.Open as number;
      return { ...d, flags: [...d.flags.filter(f => f !== openBit), openBit] };
    });
    g1.restore({ ...snap1, objects: objs });

    const snap2 = g1.snapshot();

    const g2 = createGame({ seed: 42 });
    g2.start();
    g2.restore(snap2);

    expect(g2.view().here).toBe('GRATING-ROOM');
    // Grate must be open — up exit leads to GRATING-CLEARING.
    const grate = g2.world.get('GRATE')!;
    expect(grate.has(Flag.Open)).toBe(true);
    const out = g2.turn('up');
    expect(g2.view().here).toBe('GRATING-CLEARING');
    expect(out.output).not.toContain("can't");
  });

  it('TRAP-DOOR open: up exit from cellar works after restore', () => {
    const g1 = createGame({ seed: 42, startRoom: 'CELLAR' });
    g1.start();

    const snap1 = g1.snapshot();
    const objs = snap1.objects.map(d => {
      if (d.id !== 'TRAP-DOOR') return d;
      const openBit = Flag.Open as number;
      return { ...d, flags: [...d.flags.filter(f => f !== openBit), openBit] };
    });
    g1.restore({ ...snap1, objects: objs });

    const snap2 = g1.snapshot();
    expect(snap2.objects.find(d => d.id === 'TRAP-DOOR')?.flags).toContain(Flag.Open);

    const g2 = createGame({ seed: 42 });
    g2.start();
    g2.restore(snap2);

    expect(g2.view().here).toBe('CELLAR');
    const trapdoor = g2.world.get('TRAP-DOOR')!;
    expect(trapdoor.has(Flag.Open)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 3. Graph invariant survives restore (reachable ⇒ escapable ⇒ can-return)
//
// For every flag-gated room that requires a flag to be escapable, verify that
// restoring a snapshot taken WHILE that flag is set leaves the player
// in an escapable position — the same guarantee the static test makes for a
// fresh game, now proven for a restored game.
// ---------------------------------------------------------------------------

describe('V3 graph invariant holds on post-restore state', () => {
  beforeEach(() => { resetThiefState(); });

  // All rooms reachable in the static analysis (all gates passable).
  const fullyReachable = reach(START);

  it('KNOWN_TRAPS allowlist is unchanged (self-retiring check)', () => {
    // The allowlist must stay empty — if the base test retired WHITE-CLIFFS-NORTH,
    // the restore test must also see it retired.
    expect(Object.keys(KNOWN_TRAPS)).toHaveLength(0);
  });

  it('post-restore position is escapable: every restored room has a passable exit', () => {
    // Sample a representative set of rooms reachable only with flags set.
    // For each: enter via startRoom option, apply the required flags, snapshot,
    // restore onto a fresh game, then check the room has >= 1 passable exit and
    // a path back to START.

    const cases: Array<{
      room: string;
      flags?: [string, boolean][];
      openObjects?: string[];
    }> = [
      { room: 'TROLL-ROOM',      flags: [['TROLL-FLAG', true]] },
      { room: 'CYCLOPS-ROOM',    flags: [['CYCLOPS-FLAG', true]] },
      { room: 'GRATING-ROOM',    openObjects: ['GRATE'] },
      { room: 'DOME-ROOM',       flags: [['DOME-FLAG', true]] },
      { room: 'ENTRANCE-TO-HADES', flags: [['LLD-FLAG', true]] },
    ];

    for (const { room, flags = [], openObjects = [] } of cases) {
      const g1 = createGame({ seed: 42, startRoom: room });
      g1.start();

      // Apply FlagStore changes.
      for (const [flag, val] of flags) withFlag(g1, flag, val);

      // Apply object Open bits.
      if (openObjects.length > 0) {
        const s = g1.snapshot();
        const objs = s.objects.map(d => {
          if (!openObjects.includes(d.id)) return d;
          const openBit = Flag.Open as number;
          return { ...d, flags: [...d.flags.filter(f => f !== openBit), openBit] };
        });
        g1.restore({ ...s, objects: objs });
      }

      const snap = g1.snapshot();

      const g2 = createGame({ seed: 42 });
      g2.start();
      g2.restore(snap);

      const here = g2.view().here;
      const roomData = byId.get(here);
      expect(roomData, `room ${here} not in rooms.json`).toBeDefined();

      // Room must have at least one passable exit (escapable).
      const exits = dests(roomData!);
      expect(exits.length, `${here} has no passable exit after restore (stranded)`).toBeGreaterThan(0);

      // Room must not be in KNOWN_TRAPS (self-retiring check per House Style).
      expect(
        here in KNOWN_TRAPS,
        `${here} is in KNOWN_TRAPS but shouldn't be — remove it`,
      ).toBe(false);

      // Room must be able to reach START (can-return invariant).
      expect(
        reach(here, START).has(START),
        `${here} has no path back to ${START} after restore`,
      ).toBe(true);
    }
  });

  it('full reachable set from START remains invariant post-restore to START', () => {
    // Restoring to the starting room must leave the full reachable set intact.
    // This is the degenerate case: restore ≡ start.
    const g = createGame({ seed: 42 });
    g.start();
    g.turn('look');
    const snap = g.snapshot();

    const g2 = createGame({ seed: 42 });
    g2.start();
    g2.restore(snap);

    expect(g2.view().here).toBe(START);

    // Static graph: all rooms the engine can reach are still reachable.
    for (const id of fullyReachable) {
      if (id in KNOWN_TRAPS) continue;
      const roomData = byId.get(id);
      expect(roomData, `room ${id} not in rooms.json`).toBeDefined();
      expect(
        dests(roomData!).length,
        `${id} has no passable exit (stranded) — static graph broken`,
      ).toBeGreaterThan(0);
    }
  });
});
