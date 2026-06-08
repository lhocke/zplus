// Fog-of-war map state — tracks which rooms and edges the player has visited.
// Pure; no DOM, no rendering. Driven by view() snapshots after each turn.
//
// Discovery model (§3):
//   - Visited rooms: any room whose ObjectId has appeared as view().here.
//   - Discovered edges: when view().here changes from A to B across a turn,
//     the A↔B edge is marked discovered. Shell tracks both endpoints from
//     consecutive snapshots; the engine is not queried.
//   - exits[].known is deliberately IGNORED — it's a static field (always
//     true once the player enters a room) and cannot signal discovery.

export interface RoomSnap {
  here: string;
  // exits may be present but we deliberately do NOT read exits[].known.
  exits?: unknown;
}

function edgeKey(a: string, b: string): string {
  // Canonical undirected edge: alphabetically sorted so A↔B === B↔A.
  return [a, b].sort().join('--');
}

export class MapState {
  private readonly _visited = new Set<string>();
  private readonly _edges = new Set<string>();
  private _current: string | null = null;

  update(snap: RoomSnap): void {
    const prev = this._current;
    const next = snap.here;

    this._visited.add(next);

    if (prev !== null && prev !== next) {
      this._edges.add(edgeKey(prev, next));
    }

    this._current = next;
  }

  visitedRooms(): ReadonlySet<string> {
    return this._visited;
  }

  discoveredEdges(): ReadonlySet<string> {
    return this._edges;
  }

  currentRoom(): string | null {
    return this._current;
  }

  reset(): void {
    this._visited.clear();
    this._edges.clear();
    this._current = null;
  }
}
