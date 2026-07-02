import type { RoomLayout, RoomConnection } from '../map-layout.js';

// The canyon climb runs vertically on the left (view at the page's south,
// where the surface trail arrives); the rainbow spans east along the top
// row, honoring CANYON-BOTTOM's north exit to End of Rainbow.
export const ROOMS: RoomLayout[] = [
  { id: 'END-OF-RAINBOW', label: 'End Rnbow', region: 'canyon', col: 0, row: 0 },
  { id: 'ON-RAINBOW',     label: 'On Rnbow',  region: 'canyon', col: 1, row: 0 },
  { id: 'ARAGAIN-FALLS',  label: 'Ar Falls',  region: 'canyon', col: 2, row: 0 },
  { id: 'CANYON-BOTTOM',  label: 'Cyn Btm',   region: 'canyon', col: 0, row: 1 },
  { id: 'CLIFF-MIDDLE',   label: 'Cliff Mid', region: 'canyon', col: 0, row: 2 },
  { id: 'CANYON-VIEW',    label: 'Cyn View',  region: 'canyon', col: 0, row: 3 },
];

export const CONNECTIONS: RoomConnection[] = [
  { a: 'CANYON-VIEW',    b: 'CLIFF-MIDDLE',   reciprocal: true  },
  { a: 'CLIFF-MIDDLE',   b: 'CANYON-BOTTOM',  reciprocal: true  },
  { a: 'CANYON-BOTTOM',  b: 'END-OF-RAINBOW', reciprocal: false },
  { a: 'END-OF-RAINBOW', b: 'ON-RAINBOW',     reciprocal: true  },
  { a: 'ON-RAINBOW',     b: 'ARAGAIN-FALLS',  reciprocal: true  },
];
