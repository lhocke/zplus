/**
 * room-globals.ts — Compile-time ROOM → GLOBAL-IDS mapping from ZIL source.
 *
 * The rooms.json extractor captures only the FIRST element of each room's
 * P?GLOBAL property list (a known extraction limitation). This module provides
 * the complete multi-element GLOBAL lists from zil/1dungeon.zil for all rooms
 * that have them, enabling the LOCAL-GLOBALS tier to be fully populated.
 *
 * Source: zil/1dungeon.zil — all `(GLOBAL ...)` room property entries.
 *
 * USAGE: `globalsForRoom()` in scope.ts prefers this table over rooms.json
 * when the table has an entry for the current room, falling back to rooms.json
 * for any room not listed here (though all 60 rooms with GLOBAL props ARE
 * listed here from the authoritative ZIL source).
 *
 * This table lives in the parser layer only — NO src/data or src/domain change.
 */

/**
 * Full ROOM-ID → [OBJECT-ID, ...] mapping for the LOCAL-GLOBALS tier.
 * Derived exhaustively from zil/1dungeon.zil GLOBAL property lists.
 *
 * Key: room id (matches rooms.json "id" field)
 * Value: array of object ids in the room's P?GLOBAL list (in ZIL declaration order)
 *
 * Objects not in objects.json (e.g. STAIRS) are simply not resolvable and are
 * silently skipped during world lookup — this is the data-completeness gap,
 * not a parser bug.
 */
export const ROOM_GLOBAL_IDS: ReadonlyMap<string, readonly string[]> = new Map([
  ['WEST-OF-HOUSE',        ['WHITE-HOUSE', 'BOARD', 'FOREST']],
  ['NORTH-OF-HOUSE',       ['BOARDED-WINDOW', 'BOARD', 'WHITE-HOUSE', 'FOREST']],
  ['SOUTH-OF-HOUSE',       ['BOARDED-WINDOW', 'BOARD', 'WHITE-HOUSE', 'FOREST']],
  ['EAST-OF-HOUSE',        ['WHITE-HOUSE', 'KITCHEN-WINDOW', 'FOREST']],
  ['FOREST-1',             ['TREE', 'SONGBIRD', 'WHITE-HOUSE', 'FOREST']],
  ['FOREST-2',             ['TREE', 'SONGBIRD', 'WHITE-HOUSE', 'FOREST']],
  ['MOUNTAINS',            ['TREE', 'WHITE-HOUSE']],
  ['FOREST-3',             ['TREE', 'SONGBIRD', 'WHITE-HOUSE', 'FOREST']],
  ['PATH',                 ['TREE', 'SONGBIRD', 'WHITE-HOUSE', 'FOREST']],
  ['UP-A-TREE',            ['TREE', 'FOREST', 'SONGBIRD', 'WHITE-HOUSE']],
  ['GRATING-CLEARING',     ['WHITE-HOUSE', 'GRATE']],
  ['CLEARING',             ['TREE', 'SONGBIRD', 'WHITE-HOUSE', 'FOREST']],
  ['KITCHEN',              ['KITCHEN-WINDOW', 'CHIMNEY', 'STAIRS']],
  ['ATTIC',                ['STAIRS']],
  ['LIVING-ROOM',          ['STAIRS']],
  ['CELLAR',               ['TRAP-DOOR', 'SLIDE', 'STAIRS']],
  ['STUDIO',               ['CHIMNEY']],
  ['GRATING-ROOM',         ['GRATE']],
  ['CYCLOPS-ROOM',         ['STAIRS']],
  ['TREASURE-ROOM',        ['STAIRS']],
  ['RESERVOIR-SOUTH',      ['GLOBAL-WATER']],
  ['RESERVOIR',            ['GLOBAL-WATER']],
  ['RESERVOIR-NORTH',      ['GLOBAL-WATER', 'STAIRS']],
  ['STREAM-VIEW',          ['GLOBAL-WATER']],
  ['IN-STREAM',            ['GLOBAL-WATER']],
  ['SMALL-CAVE',           ['STAIRS']],
  ['TINY-CAVE',            ['STAIRS']],
  ['ATLANTIS-ROOM',        ['STAIRS']],
  ['EW-PASSAGE',           ['STAIRS']],
  ['DEEP-CANYON',          ['STAIRS']],
  ['DAMP-CAVE',            ['CRACK']],
  ['LOUD-ROOM',            ['STAIRS']],
  ['CHASM-ROOM',           ['CRACK', 'STAIRS']],
  ['ENTRANCE-TO-HADES',    ['BODIES']],
  ['LAND-OF-LIVING-DEAD',  ['BODIES']],
  ['EGYPT-ROOM',           ['STAIRS']],
  ['TORCH-ROOM',           ['STAIRS']],
  ['NORTH-TEMPLE',         ['STAIRS']],
  ['DAM-ROOM',             ['GLOBAL-WATER']],
  ['DAM-BASE',             ['GLOBAL-WATER', 'RIVER']],
  ['RIVER-1',              ['GLOBAL-WATER', 'RIVER']],
  ['RIVER-2',              ['GLOBAL-WATER', 'RIVER']],
  ['RIVER-3',              ['GLOBAL-WATER', 'RIVER']],
  ['WHITE-CLIFFS-NORTH',   ['GLOBAL-WATER', 'WHITE-CLIFF', 'RIVER']],
  ['WHITE-CLIFFS-SOUTH',   ['GLOBAL-WATER', 'WHITE-CLIFF', 'RIVER']],
  ['RIVER-4',              ['GLOBAL-WATER', 'RIVER']],
  ['RIVER-5',              ['GLOBAL-WATER', 'RIVER']],
  ['SHORE',                ['GLOBAL-WATER', 'RIVER']],
  ['SANDY-BEACH',          ['GLOBAL-WATER', 'RIVER']],
  ['ARAGAIN-FALLS',        ['GLOBAL-WATER', 'RIVER', 'RAINBOW']],
  ['ON-RAINBOW',           ['RAINBOW']],
  ['END-OF-RAINBOW',       ['GLOBAL-WATER', 'RAINBOW', 'RIVER']],
  ['CANYON-BOTTOM',        ['GLOBAL-WATER', 'CLIMBABLE-CLIFF', 'RIVER']],
  ['CLIFF-MIDDLE',         ['CLIMBABLE-CLIFF', 'RIVER']],
  ['CANYON-VIEW',          ['CLIMBABLE-CLIFF', 'RIVER', 'RAINBOW']],
  ['SMELLY-ROOM',          ['STAIRS']],
  ['GAS-ROOM',             ['STAIRS']],
  ['LADDER-TOP',           ['LADDER', 'STAIRS']],
  ['LADDER-BOTTOM',        ['LADDER']],
  ['SLIDE-ROOM',           ['SLIDE']],
]);
