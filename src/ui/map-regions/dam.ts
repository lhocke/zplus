import type { RoomLayout, RoomConnection } from '../map-layout.js';

export const ROOMS: RoomLayout[] = [
  { id: 'RESERVOIR-SOUTH',   label: 'Res South', region: 'dam', col: 1, row: 3 },
  { id: 'RESERVOIR',         label: 'Reservoir', region: 'dam', col: 1, row: 2 },
  { id: 'RESERVOIR-NORTH',   label: 'Res North', region: 'dam', col: 1, row: 1 },
  { id: 'STREAM-VIEW',       label: 'Stream Vw', region: 'dam', col: 0, row: 3 },
  { id: 'IN-STREAM',         label: 'In Stream', region: 'dam', col: 0, row: 0 },
  { id: 'ATLANTIS-ROOM',     label: 'Atlantis',  region: 'dam', col: 1, row: 0 },
  { id: 'DAM-ROOM',          label: 'Dam Room',  region: 'dam', col: 2, row: 3 },
  { id: 'DAM-LOBBY',         label: 'Dam Lobby', region: 'dam', col: 2, row: 2 },
  { id: 'MAINTENANCE-ROOM',  label: 'Maint Rm',  region: 'dam', col: 2, row: 1 },
  { id: 'DAM-BASE',          label: 'Dam Base',  region: 'dam', col: 2, row: 4 },
];

export const CONNECTIONS: RoomConnection[] = [
  { a: 'RESERVOIR-SOUTH', b: 'DAM-ROOM',         reciprocal: true  },
  { a: 'RESERVOIR-SOUTH', b: 'STREAM-VIEW',      reciprocal: true  },
  { a: 'RESERVOIR-SOUTH', b: 'RESERVOIR',        reciprocal: true  },
  { a: 'RESERVOIR',       b: 'RESERVOIR-NORTH',  reciprocal: true  },
  { a: 'RESERVOIR',       b: 'IN-STREAM',        reciprocal: true  },
  { a: 'RESERVOIR-NORTH', b: 'ATLANTIS-ROOM',    reciprocal: true  },
  { a: 'IN-STREAM',       b: 'STREAM-VIEW',      reciprocal: false },
  { a: 'DAM-ROOM',        b: 'DAM-BASE',         reciprocal: true  },
  { a: 'DAM-ROOM',        b: 'DAM-LOBBY',        reciprocal: true  },
  { a: 'DAM-LOBBY',       b: 'MAINTENANCE-ROOM', reciprocal: true  },
];
