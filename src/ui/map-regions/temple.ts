import type { RoomLayout, RoomConnection } from '../map-layout.js';

// Temple stack on the left (Dome over Torch over North Temple, Egypt Room
// east, South Temple below); Hades pair on the right. The two clusters join
// only through the mirror region's TINY-CAVE (cross-region seams), never by
// an intra-region edge.
export const ROOMS: RoomLayout[] = [
  { id: 'DOME-ROOM',           label: 'Dome Rm',   region: 'temple', col: 0, row: 0 },
  { id: 'TORCH-ROOM',          label: 'Torch Rm',  region: 'temple', col: 0, row: 1 },
  { id: 'NORTH-TEMPLE',        label: 'N Temple',  region: 'temple', col: 0, row: 2 },
  { id: 'EGYPT-ROOM',          label: 'Egypt Rm',  region: 'temple', col: 1, row: 2 },
  { id: 'SOUTH-TEMPLE',        label: 'S Temple',  region: 'temple', col: 0, row: 3 },
  { id: 'ENTRANCE-TO-HADES',   label: 'Hades Ent', region: 'temple', col: 3, row: 2 },
  { id: 'LAND-OF-LIVING-DEAD', label: 'Living Dd', region: 'temple', col: 3, row: 3 },
];

export const CONNECTIONS: RoomConnection[] = [
  { a: 'DOME-ROOM',         b: 'TORCH-ROOM',          reciprocal: false },
  { a: 'TORCH-ROOM',        b: 'NORTH-TEMPLE',        reciprocal: true  },
  { a: 'NORTH-TEMPLE',      b: 'EGYPT-ROOM',          reciprocal: true  },
  { a: 'NORTH-TEMPLE',      b: 'SOUTH-TEMPLE',        reciprocal: true  },
  { a: 'ENTRANCE-TO-HADES', b: 'LAND-OF-LIVING-DEAD', reciprocal: true  },
];
