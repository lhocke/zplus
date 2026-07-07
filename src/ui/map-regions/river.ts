import type { RoomLayout, RoomConnection } from '../map-layout.js';

// The river flows one way (down = +row = southward on the grid); the banks
// flank it. Most connections are deliberately non-reciprocal — the current
// can't be paddled against, so the dashed connector is truthful.
export const ROOMS: RoomLayout[] = [
  { id: 'RIVER-1',            label: 'River 1',   region: 'river', col: 1, row: 0 },
  { id: 'RIVER-2',            label: 'River 2',   region: 'river', col: 1, row: 1 },
  { id: 'RIVER-3',            label: 'River 3',   region: 'river', col: 1, row: 2 },
  { id: 'RIVER-4',            label: 'River 4',   region: 'river', col: 1, row: 3 },
  { id: 'RIVER-5',            label: 'River 5',   region: 'river', col: 1, row: 4 },
  { id: 'WHITE-CLIFFS-NORTH', label: 'Cliffs N',  region: 'river', col: 0, row: 2 },
  { id: 'WHITE-CLIFFS-SOUTH', label: 'Cliffs S',  region: 'river', col: 0, row: 3 },
  { id: 'SHORE',              label: 'Shore',     region: 'river', col: 2, row: 4 },
  { id: 'SANDY-BEACH',        label: 'Sandy Bch', region: 'river', col: 2, row: 3 },
  { id: 'SANDY-CAVE',         label: 'Sandy Cv',  region: 'river', col: 3, row: 2 },
];

export const CONNECTIONS: RoomConnection[] = [
  { a: 'RIVER-1',            b: 'RIVER-2',            reciprocal: false },
  { a: 'RIVER-2',            b: 'RIVER-3',            reciprocal: false },
  { a: 'RIVER-3',            b: 'RIVER-4',            reciprocal: false },
  { a: 'RIVER-3',            b: 'WHITE-CLIFFS-NORTH', reciprocal: false },
  { a: 'RIVER-4',            b: 'RIVER-5',            reciprocal: false },
  { a: 'RIVER-4',            b: 'WHITE-CLIFFS-SOUTH', reciprocal: false },
  { a: 'RIVER-4',            b: 'SANDY-BEACH',        reciprocal: false },
  { a: 'RIVER-5',            b: 'SHORE',              reciprocal: false },
  { a: 'WHITE-CLIFFS-NORTH', b: 'WHITE-CLIFFS-SOUTH', reciprocal: true  },
  { a: 'SHORE',              b: 'SANDY-BEACH',        reciprocal: true  },
  { a: 'SANDY-BEACH',        b: 'SANDY-CAVE',         reciprocal: true  },
];
