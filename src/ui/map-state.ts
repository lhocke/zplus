// Fog-of-war map state — directed exit-record model.
// Tracks per-room discovered exits tagged by kind: walked / backtrack / blocked.
// Pure; no DOM, no rendering. Driven by view() snapshots after each turn.
//
// Discovery rules (spec §2.3):
//   walked   — player moved to a new room; direction from input (parseDirection),
//              falls back to to-match on the cached prior exits.
//   backtrack — on entering via a reciprocal edge (ROOM_CONNECTIONS.reciprocal),
//              auto-credit opposite(walkedDir) on the new room. Non-reciprocal
//              edges (forest, trapdoors) credit nothing.
//   blocked  — caller calls recordBlocked(dir) after a failed move.
//
// exits[].known is deliberately NEVER READ (spec §2.3 regression guard).

import type { Dir } from '../domain/game-object.js';
import { opposite } from './directions.js';
import { ROOM_CONNECTIONS } from './map-layout.js';

export type ExitKind = 'walked' | 'backtrack' | 'blocked';

export interface ExitRecord {
  dir: Dir;
  kind: ExitKind;
  to?: string; // destination ObjectId; absent for blocked
}

export interface RoomSnap {
  here: string;
  exits: ReadonlyArray<{ dir: string; known: boolean; to?: string }>;
}

// Pre-build a lookup: for a pair (a,b), is the edge reciprocal?
// Keyed as "a|b" and "b|a" for O(1) lookup regardless of direction.
const RECIPROCAL_LOOKUP = new Map<string, boolean>();
for (const conn of ROOM_CONNECTIONS) {
  RECIPROCAL_LOOKUP.set(`${conn.a}|${conn.b}`, conn.reciprocal);
  RECIPROCAL_LOOKUP.set(`${conn.b}|${conn.a}`, conn.reciprocal);
}

function isReciprocal(from: string, to: string): boolean {
  return RECIPROCAL_LOOKUP.get(`${from}|${to}`) === true;
}

export class MapState {
  private readonly _visited = new Set<string>();
  // Per-room exit records: roomId → direction → ExitRecord.
  private readonly _exits = new Map<string, Map<string, ExitRecord>>();
  private _current: string | null = null;
  // Cache the prior snapshot's exits for the to-match fallback.
  private _priorExits: ReadonlyArray<{ dir: string; known: boolean; to?: string }> = [];

  private exitsMapFor(roomId: string): Map<string, ExitRecord> {
    let m = this._exits.get(roomId);
    if (!m) {
      m = new Map();
      this._exits.set(roomId, m);
    }
    return m;
  }

  private setRecord(roomId: string, dir: Dir, record: ExitRecord): void {
    const m = this.exitsMapFor(roomId);
    // Priority order: walked > backtrack > blocked.
    // A higher-confidence record is never overwritten by a weaker one.
    const existing = m.get(dir);
    if (existing) {
      if (existing.kind === 'walked') return; // walked wins always
      if (existing.kind === 'backtrack' && record.kind === 'blocked') return;
    }
    m.set(dir, record);
  }

  update(snap: RoomSnap, dir: Dir | null | undefined): void {
    const prev = this._current;
    const prevExits = this._priorExits;
    const next = snap.here;

    this._visited.add(next);

    if (prev !== null && prev !== next) {
      // Determine walked direction.
      let walkedDir: Dir | null = dir ?? null;

      if (walkedDir === null) {
        // Fallback: find prior exit whose to === next.
        for (const e of prevExits) {
          if (e.to === next) {
            walkedDir = e.dir as Dir;
            break;
          }
        }
      }

      if (walkedDir !== null) {
        // Record walked on prior room.
        this.setRecord(prev, walkedDir, { kind: 'walked', dir: walkedDir, to: next });

        // Auto-credit backtrack on new room only when edge is reciprocal.
        if (isReciprocal(prev, next)) {
          const backDir = opposite(walkedDir);
          this.setRecord(next, backDir, { kind: 'backtrack', dir: backDir, to: prev });
        }
      }
    }

    this._current = next;
    // Cache this snapshot's exits for the next update's to-match fallback.
    this._priorExits = snap.exits;
  }

  recordBlocked(dir: Dir): void {
    if (this._current === null) return;
    this.setRecord(this._current, dir, { kind: 'blocked', dir });
  }

  exitsFor(roomId: string): ReadonlyMap<string, ExitRecord> {
    return this._exits.get(roomId) ?? new Map();
  }

  getAllExits(): ReadonlyMap<string, ReadonlyMap<string, ExitRecord>> {
    return this._exits as ReadonlyMap<string, ReadonlyMap<string, ExitRecord>>;
  }

  visitedRooms(): ReadonlySet<string> {
    return this._visited;
  }

  currentRoom(): string | null {
    return this._current;
  }

  reset(): void {
    this._visited.clear();
    this._exits.clear();
    this._current = null;
    this._priorExits = [];
  }
}
