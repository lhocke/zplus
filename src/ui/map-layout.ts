// Hand-authored layout for the ~20 pre-troll rooms (§3).
// Maps each room ObjectId to a grid position (col, row) for the rough map.
// Also lists the predefined connections between rooms (for box-drawing renderers).
// Rooms past the troll wall are absent — the map can't depict the gated region.

export interface RoomLayout {
  id: string;
  label: string;
  col: number;
  row: number;
}

export interface RoomConnection {
  a: string;
  b: string;
}

// Grid is roughly 7 wide × 9 tall.
// House exterior occupies cols 2-4, rows 1-3.
// Underground descends from row 4 downward.
// Forest/above-ground fills cols 0-1 and 5-6.
export const ROOM_LAYOUT: RoomLayout[] = [
  // ── Above-ground exterior ──────────────────────────────────────────────
  { id: 'NORTH-OF-HOUSE',  label: 'N of House',   col: 3, row: 1 },
  { id: 'WEST-OF-HOUSE',   label: 'W of House',   col: 2, row: 2 },
  { id: 'EAST-OF-HOUSE',   label: 'E of House',   col: 4, row: 2 },
  { id: 'SOUTH-OF-HOUSE',  label: 'S of House',   col: 3, row: 3 },

  // ── Forest / outdoor ──────────────────────────────────────────────────
  { id: 'FOREST-1',        label: 'Forest',       col: 1, row: 2 },
  { id: 'FOREST-2',        label: 'Forest',       col: 1, row: 0 },
  { id: 'FOREST-3',        label: 'Forest',       col: 2, row: 4 },
  { id: 'PATH',            label: 'Forest Path',  col: 1, row: 1 },
  { id: 'UP-A-TREE',       label: 'Up-a-Tree',    col: 0, row: 1 },
  { id: 'GRATING-CLEARING',label: 'Grating Clrg', col: 1, row: 0 }, // shares row w FOREST-2; both at north edge
  { id: 'CLEARING',        label: 'Clearing',     col: 5, row: 2 },
  { id: 'MOUNTAINS',       label: 'Mountains',    col: 6, row: 0 },

  // ── House interior ────────────────────────────────────────────────────
  { id: 'KITCHEN',         label: 'Kitchen',      col: 4, row: 1 },
  { id: 'ATTIC',           label: 'Attic',        col: 4, row: 0 },
  { id: 'LIVING-ROOM',     label: 'Living Room',  col: 3, row: 2 },

  // ── Underground ───────────────────────────────────────────────────────
  { id: 'CELLAR',          label: 'Cellar',       col: 3, row: 4 },
  { id: 'TROLL-ROOM',      label: 'Troll Room',   col: 3, row: 5 },
  { id: 'EAST-OF-CHASM',   label: 'E of Chasm',   col: 3, row: 6 },
  { id: 'GALLERY',         label: 'Gallery',      col: 4, row: 6 },
  { id: 'STUDIO',          label: 'Studio',       col: 4, row: 5 },
];

// Pre-troll room connections (undirected). Derived from rooms.json exit graph,
// filtered to pairs where both endpoints are in this layout.
// Only geographic connections are listed; resurrection teleports are not.
export const ROOM_CONNECTIONS: RoomConnection[] = [
  // House exterior ring
  { a: 'WEST-OF-HOUSE',   b: 'NORTH-OF-HOUSE' },
  { a: 'NORTH-OF-HOUSE',  b: 'EAST-OF-HOUSE' },
  { a: 'EAST-OF-HOUSE',   b: 'SOUTH-OF-HOUSE' },
  { a: 'SOUTH-OF-HOUSE',  b: 'WEST-OF-HOUSE' },
  // Forest / outdoor
  { a: 'WEST-OF-HOUSE',   b: 'FOREST-1' },
  { a: 'NORTH-OF-HOUSE',  b: 'PATH' },
  { a: 'EAST-OF-HOUSE',   b: 'CLEARING' },
  { a: 'SOUTH-OF-HOUSE',  b: 'FOREST-3' },
  { a: 'FOREST-1',        b: 'PATH' },
  { a: 'FOREST-1',        b: 'FOREST-3' },
  { a: 'FOREST-1',        b: 'GRATING-CLEARING' },
  { a: 'PATH',            b: 'FOREST-2' },
  { a: 'PATH',            b: 'GRATING-CLEARING' },
  { a: 'PATH',            b: 'UP-A-TREE' },
  { a: 'FOREST-2',        b: 'MOUNTAINS' },
  { a: 'FOREST-2',        b: 'CLEARING' },
  { a: 'FOREST-3',        b: 'CLEARING' },
  // House interior
  { a: 'EAST-OF-HOUSE',  b: 'KITCHEN' },
  { a: 'KITCHEN',        b: 'LIVING-ROOM' },
  { a: 'KITCHEN',        b: 'ATTIC' },
  { a: 'KITCHEN',        b: 'STUDIO' },  // down to Studio chimney
  // Underground
  { a: 'LIVING-ROOM',    b: 'CELLAR' },  // trapdoor
  { a: 'CELLAR',         b: 'TROLL-ROOM' },
  { a: 'CELLAR',         b: 'EAST-OF-CHASM' },
  { a: 'EAST-OF-CHASM',  b: 'GALLERY' },
  { a: 'GALLERY',        b: 'STUDIO' },
];

// Indexed for O(1) lookup by id.
export const ROOM_BY_ID = new Map<string, RoomLayout>(
  ROOM_LAYOUT.map(r => [r.id, r]),
);
