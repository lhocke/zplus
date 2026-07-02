import type { RoomLayout, RoomConnection } from '../map-layout.js';

// PROVISIONAL coordinates — Task 3 re-authors this entire 13-room module,
// including these 5, from scratch. Kept here only so the barrel has
// something to aggregate at foundation time.
export const ROOMS: RoomLayout[] = [
  { id: 'CELLAR',        label: 'Cellar',     region: 'cellar-core', col: 3, row: 4 },
  { id: 'TROLL-ROOM',    label: 'Troll Room', region: 'cellar-core', col: 3, row: 5 },
  { id: 'EAST-OF-CHASM', label: 'E of Chasm', region: 'cellar-core', col: 3, row: 6 },
  { id: 'GALLERY',       label: 'Gallery',    region: 'cellar-core', col: 4, row: 6 },
  { id: 'STUDIO',        label: 'Studio',     region: 'cellar-core', col: 4, row: 5 },
];

export const CONNECTIONS: RoomConnection[] = [
  { a: 'CELLAR',         b: 'TROLL-ROOM',    reciprocal: true },
  { a: 'CELLAR',         b: 'EAST-OF-CHASM', reciprocal: true },
  { a: 'EAST-OF-CHASM',  b: 'GALLERY',       reciprocal: true },
  { a: 'GALLERY',        b: 'STUDIO',        reciprocal: true },
];
