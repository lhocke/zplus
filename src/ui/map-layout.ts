// Hand-authored layout for the ~20 pre-troll rooms (§3).
// Maps each room ObjectId to a grid position (col, row) for the rough map.
// Rooms past the troll wall are absent — the map can't depict the gated region.

export interface RoomLayout {
  id: string;
  label: string;
  col: number;
  row: number;
}

// Grid is roughly 7 wide × 8 tall.
// House exterior occupies cols 2-4, rows 0-2.
// Underground descends from row 3 downward.
// Forest/above-ground fills cols 0-1 and 5-6.
export const ROOM_LAYOUT: RoomLayout[] = [
  // ── Above-ground exterior ──────────────────────────────────────────────
  { id: 'NORTH-OF-HOUSE',  label: 'N of House',   col: 3, row: 0 },
  { id: 'WEST-OF-HOUSE',   label: 'W of House',   col: 2, row: 1 },
  { id: 'EAST-OF-HOUSE',   label: 'E of House',   col: 4, row: 1 },
  { id: 'SOUTH-OF-HOUSE',  label: 'S of House',   col: 3, row: 2 },

  // ── Forest / outdoor ──────────────────────────────────────────────────
  { id: 'FOREST-1',        label: 'Forest',       col: 1, row: 1 },
  { id: 'FOREST-2',        label: 'Forest',       col: 1, row: 0 },
  { id: 'FOREST-3',        label: 'Forest',       col: 2, row: 3 },
  { id: 'PATH',            label: 'Forest Path',  col: 1, row: 0 }, // same area as F2, offset
  { id: 'UP-A-TREE',       label: 'Up-a-Tree',    col: 0, row: 0 },
  { id: 'GRATING-CLEARING',label: 'Grating Clrg', col: 1, row: -1 },
  { id: 'CLEARING',        label: 'Clearing',     col: 5, row: 1 },
  { id: 'MOUNTAINS',       label: 'Mountains',    col: 6, row: 0 },

  // ── House interior ────────────────────────────────────────────────────
  { id: 'KITCHEN',         label: 'Kitchen',      col: 4, row: 1 }, // shares col w East
  { id: 'ATTIC',           label: 'Attic',        col: 4, row: 0 },
  { id: 'LIVING-ROOM',     label: 'Living Room',  col: 3, row: 1 },

  // ── Underground ───────────────────────────────────────────────────────
  { id: 'CELLAR',          label: 'Cellar',       col: 3, row: 3 },
  { id: 'TROLL-ROOM',      label: 'Troll Room',   col: 3, row: 4 },
  { id: 'EAST-OF-CHASM',   label: 'E of Chasm',   col: 3, row: 5 },
  { id: 'GALLERY',         label: 'Gallery',      col: 4, row: 5 },
  { id: 'STUDIO',          label: 'Studio',       col: 4, row: 4 },
];

// Indexed for O(1) lookup by id.
export const ROOM_BY_ID = new Map<string, RoomLayout>(
  ROOM_LAYOUT.map(r => [r.id, r]),
);
