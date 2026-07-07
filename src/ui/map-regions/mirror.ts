import type { RoomLayout, RoomConnection } from '../map-layout.js';

// Two mirror-image clusters with NO intra-region edge between them — they
// join only through cross-region seams. Laid out side by side, deliberately
// structurally identical. Non-reciprocal flags mark the disorienting
// passages (return exits use non-opposite directions per rooms.json).
export const ROOMS: RoomLayout[] = [
  // Cluster around Mirror Room 1
  { id: 'MIRROR-ROOM-1',    label: 'Mirror 1',  region: 'mirror', col: 1, row: 1 },
  { id: 'SMALL-CAVE',       label: 'Small Cv',  region: 'mirror', col: 2, row: 1 },
  { id: 'TWISTING-PASSAGE', label: 'Twisty P',  region: 'mirror', col: 0, row: 1 },
  { id: 'COLD-PASSAGE',     label: 'Cold Psg',  region: 'mirror', col: 1, row: 0 },
  // Cluster around Mirror Room 2
  { id: 'MIRROR-ROOM-2',    label: 'Mirror 2',  region: 'mirror', col: 6, row: 1 },
  { id: 'TINY-CAVE',        label: 'Tiny Cave', region: 'mirror', col: 7, row: 1 },
  { id: 'WINDING-PASSAGE',  label: 'Winding P', region: 'mirror', col: 5, row: 1 },
  { id: 'NARROW-PASSAGE',   label: 'Narrow Ps', region: 'mirror', col: 6, row: 0 },
];

export const CONNECTIONS: RoomConnection[] = [
  { a: 'MIRROR-ROOM-1',    b: 'COLD-PASSAGE',     reciprocal: true  },
  { a: 'MIRROR-ROOM-1',    b: 'TWISTING-PASSAGE', reciprocal: false },
  { a: 'MIRROR-ROOM-1',    b: 'SMALL-CAVE',       reciprocal: false },
  { a: 'SMALL-CAVE',       b: 'TWISTING-PASSAGE', reciprocal: true  },
  { a: 'MIRROR-ROOM-2',    b: 'WINDING-PASSAGE',  reciprocal: false },
  { a: 'MIRROR-ROOM-2',    b: 'NARROW-PASSAGE',   reciprocal: true  },
  { a: 'MIRROR-ROOM-2',    b: 'TINY-CAVE',        reciprocal: false },
  { a: 'TINY-CAVE',        b: 'WINDING-PASSAGE',  reciprocal: true  },
];
