import type { RoomLayout, RoomConnection } from '../map-layout.js';

export const ROOMS: RoomLayout[] = [
  { id: 'MINE-1',     label: 'Mine 1',   region: 'mine-maze' },
  { id: 'MINE-2',     label: 'Mine 2',   region: 'mine-maze' },
  { id: 'MINE-3',     label: 'Mine 3',   region: 'mine-maze' },
  { id: 'MINE-4',     label: 'Mine 4',   region: 'mine-maze' },
  { id: 'DEAD-END-5', label: 'Dd End 5', region: 'mine-maze' },
];

export const CONNECTIONS: RoomConnection[] = [];
