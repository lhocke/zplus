/**
 * Phase-boundary invariant: a player may be BLOCKED from entering unbuilt
 * content (troll-wall style), but never trapped inside it. Computes
 * reachability over rooms.json under what the engine can actually do today
 * and asserts every reachable room has an exit and a path back to start.
 *
 * When a phase lands new flag-setting machinery, add its globals to
 * SETTABLE_GLOBALS. KNOWN_TRAPS entries must each name the wave that
 * retires them — and the test fails if an entry stops being a trap, so the
 * allowlist can only shrink.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');

// globals the live engine writes (grep flag-store writes before extending)
const SETTABLE_GLOBALS = new Set(['TROLL-FLAG', 'WON-FLAG']);

// reachable-but-inescapable rooms we know about, each tied to the wave that fixes it
const KNOWN_TRAPS: Record<string, string> = {
  'WHITE-CLIFFS-NORTH': 'phase-3-dam-river (WHITE-CLIFFS-FUNCTION M-END sets DEFLATE)',
};

// FEXIT routines and where they lead when they succeed
const PER_DEST: Record<string, string> = { 'TRAP-DOOR-EXIT': 'CELLAR' };

const START = 'WEST-OF-HOUSE';

type Exit = { dir: string; to?: string; per?: string; ifFlag?: string };
type Room = { id: string; exits?: Exit[] };

const rooms: Room[] = JSON.parse(fs.readFileSync(path.join(ROOT, 'src/data/rooms.json'), 'utf8'));
const objectIds = new Set(
  JSON.parse(fs.readFileSync(path.join(ROOT, 'src/data/objects.json'), 'utf8')).map((o: { id: string }) => o.id),
);
const byId = new Map(rooms.map(r => [r.id, r]));

// passable today: unconditional, door/object-gated (player can open), or a
// global the engine sets. FALSE-FLAG is the faithful never-exit.
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

const reachable = reach(START);

describe('no hard-locks: phase boundaries block entry, never exit', () => {
  it('every reachable room has at least one passable exit', () => {
    const traps = [...reachable].filter(id => dests(byId.get(id)!).length === 0 && !(id in KNOWN_TRAPS));
    expect(traps).toEqual([]);
  });

  it('every reachable room can get back to the start', () => {
    const pockets = [...reachable].filter(
      id => !(id in KNOWN_TRAPS) && !reach(id, START).has(START),
    );
    expect(pockets).toEqual([]);
  });

  it('KNOWN_TRAPS entries are still traps (remove them when their wave lands)', () => {
    for (const [id, owner] of Object.entries(KNOWN_TRAPS)) {
      if (!reachable.has(id)) continue; // not reachable yet — entry is premature but harmless
      expect(dests(byId.get(id)!).length, `${id} is no longer a trap — ${owner} landed; delete its allowlist entry`).toBe(0);
    }
  });
});
