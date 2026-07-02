import type { RoomLayout, RoomConnection } from '../map-layout.js';

// Two clusters, genuinely disconnected within this region: the entrance
// cluster and the lower-shaft cluster join only through the Coal-Mine Maze
// (a different region), so no in-grid connector ever spans the col 2-3 gap.
export const ROOMS: RoomLayout[] = [
  // Entrance cluster
  { id: 'MINE-ENTRANCE', label: 'Mine Ent',  region: 'mine', col: 1, row: 2 },
  { id: 'SQUEEKY-ROOM',  label: 'Squeeky',   region: 'mine', col: 0, row: 2 },
  { id: 'BAT-ROOM',      label: 'Bat Room',  region: 'mine', col: 0, row: 1 },
  { id: 'SHAFT-ROOM',    label: 'Shaft Rm',  region: 'mine', col: 1, row: 1 },
  { id: 'SMELLY-ROOM',   label: 'Smelly Rm', region: 'mine', col: 1, row: 0 },
  { id: 'GAS-ROOM',      label: 'Gas Room',  region: 'mine', col: 0, row: 0 },
  { id: 'SLIDE-ROOM',    label: 'Slide Rm',  region: 'mine', col: 1, row: 3 },
  // Lower-shaft cluster (reached only through the coal-mine maze)
  { id: 'LADDER-TOP',    label: 'Ladder Tp', region: 'mine', col: 6, row: 0 },
  { id: 'LADDER-BOTTOM', label: 'Ladder Bt', region: 'mine', col: 6, row: 1 },
  { id: 'TIMBER-ROOM',   label: 'Timber Rm', region: 'mine', col: 5, row: 1 },
  { id: 'LOWER-SHAFT',   label: 'Lwr Shaft', region: 'mine', col: 4, row: 1 },
  { id: 'MACHINE-ROOM',  label: 'Machine',   region: 'mine', col: 4, row: 2 },
];

export const CONNECTIONS: RoomConnection[] = [
  { a: 'MINE-ENTRANCE', b: 'SLIDE-ROOM',    reciprocal: true },
  { a: 'MINE-ENTRANCE', b: 'SQUEEKY-ROOM',  reciprocal: true },
  { a: 'SQUEEKY-ROOM',  b: 'BAT-ROOM',      reciprocal: true },
  { a: 'BAT-ROOM',      b: 'SHAFT-ROOM',    reciprocal: true },
  { a: 'SHAFT-ROOM',    b: 'SMELLY-ROOM',   reciprocal: true },
  { a: 'SMELLY-ROOM',   b: 'GAS-ROOM',      reciprocal: true },
  { a: 'LADDER-TOP',    b: 'LADDER-BOTTOM', reciprocal: true },
  { a: 'LADDER-BOTTOM', b: 'TIMBER-ROOM',   reciprocal: true },
  { a: 'TIMBER-ROOM',   b: 'LOWER-SHAFT',   reciprocal: true },
  { a: 'LOWER-SHAFT',   b: 'MACHINE-ROOM',  reciprocal: true },
];
