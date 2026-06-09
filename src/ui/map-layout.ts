// Hand-authored layout for the ~20 pre-troll rooms (§3).
// Maps each room ObjectId to a grid position (col, row) for the rough map.
// Also lists the predefined connections between rooms (for box-drawing renderers).
// Rooms past the troll wall are absent — the map can't depict the gated region.

export interface RoomLayout {
  id: string;
  label: string;
  col: number;
  row: number;
  level: 'surface' | 'underground';
}

export interface RoomConnection {
  a: string;
  b: string;
  // Reciprocal: true iff the direction from A→B and the return direction from B→A
  // are compass opposites (n/s, e/w, ne/sw, nw/se, u/d) per rooms.json exits.
  // Derived by inspection of rooms.json exit tables; non-reciprocal links are
  // one-way or disorienting (e.g. the intentionally maze-like forest connections).
  reciprocal: boolean;
}

// Grid is roughly 7 wide × 9 tall.
// House exterior occupies cols 2-4, rows 1-3.
// Underground descends from row 4 downward.
// Forest/above-ground fills cols 0-1 and 5-6.
export const ROOM_LAYOUT: RoomLayout[] = [
  // ── Above-ground exterior ──────────────────────────────────────────────
  { id: 'NORTH-OF-HOUSE',  label: 'N of House',   col: 3, row: 1, level: 'surface' },
  { id: 'WEST-OF-HOUSE',   label: 'W of House',   col: 2, row: 2, level: 'surface' },
  { id: 'EAST-OF-HOUSE',   label: 'E of House',   col: 4, row: 2, level: 'surface' },
  { id: 'SOUTH-OF-HOUSE',  label: 'S of House',   col: 3, row: 3, level: 'surface' },

  // ── Forest / outdoor ──────────────────────────────────────────────────
  { id: 'FOREST-1',        label: 'Forest',       col: 1, row: 2, level: 'surface' },
  { id: 'FOREST-2',        label: 'Forest',       col: 1, row: 0, level: 'surface' },
  { id: 'FOREST-3',        label: 'Forest',       col: 2, row: 4, level: 'surface' },
  { id: 'PATH',            label: 'Forest Path',  col: 1, row: 1, level: 'surface' },
  { id: 'UP-A-TREE',       label: 'Up-a-Tree',    col: 0, row: 1, level: 'surface' },
  { id: 'GRATING-CLEARING',label: 'Grating Clrg', col: 1, row: 0, level: 'surface' }, // shares row w FOREST-2; both at north edge
  { id: 'CLEARING',        label: 'Clearing',     col: 5, row: 2, level: 'surface' },
  { id: 'MOUNTAINS',       label: 'Mountains',    col: 6, row: 0, level: 'surface' },

  // ── House interior ────────────────────────────────────────────────────
  { id: 'KITCHEN',         label: 'Kitchen',      col: 4, row: 1, level: 'surface' },
  { id: 'ATTIC',           label: 'Attic',        col: 4, row: 0, level: 'surface' },
  { id: 'LIVING-ROOM',     label: 'Living Room',  col: 3, row: 2, level: 'surface' },

  // ── Underground ───────────────────────────────────────────────────────
  { id: 'CELLAR',          label: 'Cellar',       col: 3, row: 4, level: 'underground' },
  { id: 'TROLL-ROOM',      label: 'Troll Room',   col: 3, row: 5, level: 'underground' },
  { id: 'EAST-OF-CHASM',   label: 'E of Chasm',   col: 3, row: 6, level: 'underground' },
  { id: 'GALLERY',         label: 'Gallery',      col: 4, row: 6, level: 'underground' },
  { id: 'STUDIO',          label: 'Studio',       col: 4, row: 5, level: 'underground' },
];

// Pre-troll room connections (undirected). Derived from rooms.json exit graph,
// filtered to pairs where both endpoints are in this layout.
// Only geographic connections are listed; resurrection teleports are not.
export const ROOM_CONNECTIONS: RoomConnection[] = [
  // House exterior ring
  { a: 'WEST-OF-HOUSE',   b: 'NORTH-OF-HOUSE',  reciprocal: true  },
  { a: 'NORTH-OF-HOUSE',  b: 'EAST-OF-HOUSE',   reciprocal: true  },
  { a: 'EAST-OF-HOUSE',   b: 'SOUTH-OF-HOUSE',  reciprocal: true  },
  { a: 'SOUTH-OF-HOUSE',  b: 'WEST-OF-HOUSE',   reciprocal: true  },
  // Forest / outdoor
  { a: 'WEST-OF-HOUSE',   b: 'FOREST-1',        reciprocal: false }, // W→FOREST-1 but FOREST-1 has no east exit back to W-OF-HOUSE
  { a: 'NORTH-OF-HOUSE',  b: 'PATH',            reciprocal: true  },
  { a: 'EAST-OF-HOUSE',   b: 'CLEARING',        reciprocal: true  },
  { a: 'SOUTH-OF-HOUSE',  b: 'FOREST-3',        reciprocal: false }, // S→FOREST-3 south; FOREST-3→S-OF-HOUSE is nw (not opposite)
  { a: 'FOREST-1',        b: 'PATH',            reciprocal: true  },
  { a: 'FOREST-1',        b: 'FOREST-3',        reciprocal: false }, // FOREST-1 south→FOREST-3; FOREST-3 west→FOREST-1 (not opposite)
  { a: 'FOREST-1',        b: 'GRATING-CLEARING',reciprocal: false }, // FOREST-1 north→GRATING; GRATING west→FOREST-1 (not opposite)
  { a: 'PATH',            b: 'FOREST-2',        reciprocal: true  },
  { a: 'PATH',            b: 'GRATING-CLEARING',reciprocal: true  },
  { a: 'PATH',            b: 'UP-A-TREE',       reciprocal: true  },
  { a: 'FOREST-2',        b: 'MOUNTAINS',       reciprocal: true  },
  { a: 'FOREST-2',        b: 'CLEARING',        reciprocal: true  },
  { a: 'FOREST-3',        b: 'CLEARING',        reciprocal: true  },
  // House interior
  { a: 'EAST-OF-HOUSE',  b: 'KITCHEN',         reciprocal: true  },
  { a: 'KITCHEN',        b: 'LIVING-ROOM',      reciprocal: true  },
  { a: 'KITCHEN',        b: 'ATTIC',            reciprocal: true  },
  { a: 'KITCHEN',        b: 'STUDIO',           reciprocal: false }, // KITCHEN down→STUDIO blocked; STUDIO up→KITCHEN via chimney function
  // Underground
  { a: 'LIVING-ROOM',    b: 'CELLAR',           reciprocal: false }, // trapdoor: LIVING-ROOM down via TRAP-DOOR-EXIT (per); CELLAR up→LIVING-ROOM ifFlag
  { a: 'CELLAR',         b: 'TROLL-ROOM',       reciprocal: true  },
  { a: 'CELLAR',         b: 'EAST-OF-CHASM',    reciprocal: true  },
  { a: 'EAST-OF-CHASM',  b: 'GALLERY',          reciprocal: true  },
  { a: 'GALLERY',        b: 'STUDIO',           reciprocal: true  },
];

// Indexed for O(1) lookup by id.
export const ROOM_BY_ID = new Map<string, RoomLayout>(
  ROOM_LAYOUT.map(r => [r.id, r]),
);
