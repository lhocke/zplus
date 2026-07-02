import type { RoomLayout, RoomConnection } from '../map-layout.js';

// GRATING-ROOM is an island here — both its exits are cross-region seams
// (sw into the thief's maze, up to the grating clearing), so it renders as
// a lone box with no connector. That is the honest picture.
export const ROOMS: RoomLayout[] = [
  { id: 'TREASURE-ROOM',   label: 'Treasure',  region: 'cyclops', col: 0, row: 0 },
  { id: 'CYCLOPS-ROOM',    label: 'Cyclops',   region: 'cyclops', col: 0, row: 1 },
  { id: 'STRANGE-PASSAGE', label: 'Strange P', region: 'cyclops', col: 1, row: 1 },
  { id: 'GRATING-ROOM',    label: 'Grate Rm',  region: 'cyclops', col: 3, row: 0 },
];

export const CONNECTIONS: RoomConnection[] = [
  { a: 'CYCLOPS-ROOM', b: 'STRANGE-PASSAGE', reciprocal: true },
  { a: 'CYCLOPS-ROOM', b: 'TREASURE-ROOM',   reciprocal: true },
];
