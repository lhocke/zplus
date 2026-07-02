import type { RoomLayout, RoomConnection } from '../map-layout.js';

export const ROOMS: RoomLayout[] = [
  { id: 'CELLAR',          label: 'Cellar',    region: 'cellar-core', col: 2, row: 2  },
  { id: 'TROLL-ROOM',      label: 'Troll Rm',  region: 'cellar-core', col: 2, row: 1  },
  { id: 'EAST-OF-CHASM',   label: 'E Chasm',   region: 'cellar-core', col: 2, row: 3  },
  { id: 'GALLERY',         label: 'Gallery',   region: 'cellar-core', col: 3, row: 3  },
  { id: 'STUDIO',          label: 'Studio',    region: 'cellar-core', col: 3, row: 2  },
  { id: 'EW-PASSAGE',      label: 'EW Pass',   region: 'cellar-core', col: 3, row: 1  },
  { id: 'ROUND-ROOM',      label: 'Round Rm',  region: 'cellar-core', col: 4, row: 1  },
  { id: 'NS-PASSAGE',      label: 'NS Pass',   region: 'cellar-core', col: 4, row: 0  },
  { id: 'CHASM-ROOM',      label: 'Chasm Rm',  region: 'cellar-core', col: 4, row: -1 },
  { id: 'DEEP-CANYON',     label: 'Deep Cyn',  region: 'cellar-core', col: 5, row: 0  },
  { id: 'LOUD-ROOM',       label: 'Loud Rm',   region: 'cellar-core', col: 5, row: 1  },
  { id: 'DAMP-CAVE',       label: 'Damp Cave', region: 'cellar-core', col: 6, row: 1  },
  { id: 'ENGRAVINGS-CAVE', label: 'Engr Cave', region: 'cellar-core', col: 5, row: 2  },
];

export const CONNECTIONS: RoomConnection[] = [
  { a: 'CELLAR',        b: 'TROLL-ROOM',       reciprocal: true },
  { a: 'CELLAR',        b: 'EAST-OF-CHASM',    reciprocal: true },
  { a: 'TROLL-ROOM',    b: 'EW-PASSAGE',       reciprocal: true },
  { a: 'EAST-OF-CHASM', b: 'GALLERY',          reciprocal: true },
  { a: 'GALLERY',       b: 'STUDIO',           reciprocal: true },
  { a: 'EW-PASSAGE',    b: 'ROUND-ROOM',       reciprocal: true },
  { a: 'EW-PASSAGE',    b: 'CHASM-ROOM',       reciprocal: true },
  { a: 'ROUND-ROOM',    b: 'LOUD-ROOM',        reciprocal: true },
  { a: 'ROUND-ROOM',    b: 'NS-PASSAGE',       reciprocal: true },
  { a: 'ROUND-ROOM',    b: 'ENGRAVINGS-CAVE',  reciprocal: true },
  { a: 'NS-PASSAGE',    b: 'CHASM-ROOM',       reciprocal: true },
  { a: 'NS-PASSAGE',    b: 'DEEP-CANYON',      reciprocal: true },
  { a: 'DEEP-CANYON',   b: 'LOUD-ROOM',        reciprocal: true },
  { a: 'LOUD-ROOM',     b: 'DAMP-CAVE',        reciprocal: true },
];
