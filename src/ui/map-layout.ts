// Region-model map layout — schema + barrel (spec §3, §10).
// RoomLayout/RoomConnection/RoomSeam/RegionKey/REGION_DISPLAY_NAMES/
// MAPPED_REGIONS are defined here and are foundation-owned. ROOM_LAYOUT and
// ROOM_CONNECTIONS' *contents* are assembled from the per-region modules
// under src/ui/map-regions/ — this file never hand-types a room entry.

import type { Dir } from '../domain/game-object.js';
import * as surface from './map-regions/surface.js';
import * as cellarCore from './map-regions/cellar-core.js';
import * as dam from './map-regions/dam.js';
import * as mine from './map-regions/mine.js';
import * as river from './map-regions/river.js';
import * as mirror from './map-regions/mirror.js';
import * as temple from './map-regions/temple.js';
import * as canyon from './map-regions/canyon.js';
import * as cyclops from './map-regions/cyclops.js';
import * as thiefMaze from './map-regions/thief-maze.js';
import * as mineMaze from './map-regions/mine-maze.js';

export type MappedRegionKey =
  | 'surface'
  | 'cellar-core'
  | 'dam'
  | 'mine'
  | 'river'
  | 'mirror'
  | 'temple'
  | 'canyon'
  | 'cyclops';

export type UnmappedRegionKey = 'thief-maze' | 'mine-maze';

export type RegionKey = MappedRegionKey | UnmappedRegionKey;

export const REGION_DISPLAY_NAMES: Record<RegionKey, string> = {
  surface:       'Surface',
  'cellar-core': 'Cellar & Central Passages',
  dam:           'Dam & Reservoir',
  mine:          'Coal Mine',
  river:         'River',
  mirror:        'Mirror Rooms & Twisty Passages',
  temple:        'Temple & Hades',
  canyon:        'Canyon & Falls',
  cyclops:       'Cyclops & Treasure',
  'thief-maze':  "Thief's Maze",
  'mine-maze':   'Coal-Mine Maze',
};

// Regions that render a grid (have col/row). Order is the canonical paging
// order (spec §8.2).
export const MAPPED_REGIONS: MappedRegionKey[] = [
  'surface', 'cellar-core', 'dam', 'mine', 'river',
  'mirror', 'temple', 'canyon', 'cyclops',
];

export interface RoomLayout {
  id: string;
  label: string;
  region: RegionKey;
  col?: number;   // absent iff region is unmapped (thief-maze | mine-maze)
  row?: number;   // absent iff region is unmapped
}

export interface RoomConnection {
  a: string;
  b: string;
  // Reciprocal: true iff the direction from A->B and the return direction
  // from B->A are compass opposites (n/s, e/w, ne/sw, nw/se, u/d) per
  // rooms.json exits. Derived by inspection of rooms.json exit tables;
  // non-reciprocal links are one-way or disorienting.
  reciprocal: boolean;
}

export interface RoomSeam {
  from: string;         // room id, always in a MAPPED region
  dir: Dir;              // exit direction from `from` (any of the 12 Dir values)
  to: string;            // destination room id, in a DIFFERENT region
  toRegion: RegionKey;   // the neighboring region (mapped or unmapped)
  reciprocal: boolean;   // true iff ROOM_SEAMS also holds the return seam
                          // (to, opposite(dir), from) — spec §5.2 step 4
}

// The complete cross-region seam list (spec §5.3) — 39 entries, every one
// with a mapped `from` region. Re-derived and set-equality-checked against
// rooms.json by tests/shell/region-seam-derivation.test.ts.
export const ROOM_SEAMS: RoomSeam[] = [
  { from: 'ARAGAIN-FALLS', dir: 'north', to: 'SHORE', toRegion: 'river', reciprocal: true },
  { from: 'ATLANTIS-ROOM', dir: 'up', to: 'SMALL-CAVE', toRegion: 'mirror', reciprocal: true },
  { from: 'CANYON-VIEW', dir: 'nw', to: 'CLEARING', toRegion: 'surface', reciprocal: false },
  { from: 'CANYON-VIEW', dir: 'west', to: 'FOREST-3', toRegion: 'surface', reciprocal: false },
  { from: 'CELLAR', dir: 'up', to: 'LIVING-ROOM', toRegion: 'surface', reciprocal: false },
  { from: 'CHASM-ROOM', dir: 'ne', to: 'RESERVOIR-SOUTH', toRegion: 'dam', reciprocal: true },
  { from: 'CLEARING', dir: 'east', to: 'CANYON-VIEW', toRegion: 'canyon', reciprocal: false },
  { from: 'COLD-PASSAGE', dir: 'west', to: 'SLIDE-ROOM', toRegion: 'mine', reciprocal: true },
  { from: 'CYCLOPS-ROOM', dir: 'nw', to: 'MAZE-15', toRegion: 'thief-maze', reciprocal: false },
  { from: 'DAM-ROOM', dir: 'south', to: 'DEEP-CANYON', toRegion: 'cellar-core', reciprocal: false },
  { from: 'DAMP-CAVE', dir: 'east', to: 'WHITE-CLIFFS-NORTH', toRegion: 'river', reciprocal: true },
  { from: 'DEEP-CANYON', dir: 'east', to: 'DAM-ROOM', toRegion: 'dam', reciprocal: false },
  { from: 'DEEP-CANYON', dir: 'nw', to: 'RESERVOIR-SOUTH', toRegion: 'dam', reciprocal: true },
  { from: 'DOME-ROOM', dir: 'west', to: 'ENGRAVINGS-CAVE', toRegion: 'cellar-core', reciprocal: true },
  { from: 'ENGRAVINGS-CAVE', dir: 'east', to: 'DOME-ROOM', toRegion: 'temple', reciprocal: true },
  { from: 'ENTRANCE-TO-HADES', dir: 'up', to: 'TINY-CAVE', toRegion: 'mirror', reciprocal: true },
  { from: 'GAS-ROOM', dir: 'east', to: 'MINE-1', toRegion: 'mine-maze', reciprocal: false },
  { from: 'GRATING-ROOM', dir: 'sw', to: 'MAZE-11', toRegion: 'thief-maze', reciprocal: false },
  { from: 'GRATING-ROOM', dir: 'up', to: 'GRATING-CLEARING', toRegion: 'surface', reciprocal: false },
  { from: 'KITCHEN', dir: 'down', to: 'STUDIO', toRegion: 'cellar-core', reciprocal: false },
  { from: 'LADDER-BOTTOM', dir: 'south', to: 'DEAD-END-5', toRegion: 'mine-maze', reciprocal: false },
  { from: 'LADDER-TOP', dir: 'up', to: 'MINE-4', toRegion: 'mine-maze', reciprocal: false },
  { from: 'LIVING-ROOM', dir: 'west', to: 'STRANGE-PASSAGE', toRegion: 'cyclops', reciprocal: true },
  { from: 'NARROW-PASSAGE', dir: 'north', to: 'ROUND-ROOM', toRegion: 'cellar-core', reciprocal: true },
  { from: 'RESERVOIR-SOUTH', dir: 'se', to: 'DEEP-CANYON', toRegion: 'cellar-core', reciprocal: true },
  { from: 'RESERVOIR-SOUTH', dir: 'sw', to: 'CHASM-ROOM', toRegion: 'cellar-core', reciprocal: true },
  { from: 'RIVER-1', dir: 'out', to: 'DAM-BASE', toRegion: 'dam', reciprocal: false },
  { from: 'RIVER-1', dir: 'west', to: 'DAM-BASE', toRegion: 'dam', reciprocal: false },
  { from: 'ROUND-ROOM', dir: 'south', to: 'NARROW-PASSAGE', toRegion: 'mirror', reciprocal: true },
  { from: 'SHORE', dir: 'south', to: 'ARAGAIN-FALLS', toRegion: 'canyon', reciprocal: true },
  { from: 'SLIDE-ROOM', dir: 'down', to: 'CELLAR', toRegion: 'cellar-core', reciprocal: false },
  { from: 'SLIDE-ROOM', dir: 'east', to: 'COLD-PASSAGE', toRegion: 'mirror', reciprocal: true },
  { from: 'SMALL-CAVE', dir: 'down', to: 'ATLANTIS-ROOM', toRegion: 'dam', reciprocal: true },
  { from: 'SMALL-CAVE', dir: 'south', to: 'ATLANTIS-ROOM', toRegion: 'dam', reciprocal: false },
  { from: 'SOUTH-TEMPLE', dir: 'down', to: 'TINY-CAVE', toRegion: 'mirror', reciprocal: false },
  { from: 'STRANGE-PASSAGE', dir: 'east', to: 'LIVING-ROOM', toRegion: 'surface', reciprocal: true },
  { from: 'TINY-CAVE', dir: 'down', to: 'ENTRANCE-TO-HADES', toRegion: 'temple', reciprocal: true },
  { from: 'TROLL-ROOM', dir: 'west', to: 'MAZE-1', toRegion: 'thief-maze', reciprocal: false },
  { from: 'WHITE-CLIFFS-NORTH', dir: 'west', to: 'DAMP-CAVE', toRegion: 'cellar-core', reciprocal: true },
];

const REGION_MODULES = [
  surface, cellarCore, dam, mine, river, mirror, temple, canyon, cyclops, thiefMaze, mineMaze,
];

export const ROOM_LAYOUT: RoomLayout[] = REGION_MODULES.flatMap(m => m.ROOMS);
export const ROOM_CONNECTIONS: RoomConnection[] = REGION_MODULES.flatMap(m => m.CONNECTIONS);

// Indexed for O(1) lookup by id.
export const ROOM_BY_ID = new Map<string, RoomLayout>(
  ROOM_LAYOUT.map(r => [r.id, r]),
);
