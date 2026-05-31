/**
 * Compile-time registry of ZIL LOCAL-GLOBALS object IDs.
 *
 * Objects declared `(IN LOCAL-GLOBALS)` are accessible only from rooms that list
 * them in P?GLOBAL. Derived from zil/1dungeon.zil GLOBAL property lists.
 */

/** All object IDs that appear in any room's GLOBAL list (zil/1dungeon.zil). */
export const LOCAL_GLOBAL_IDS: ReadonlySet<string> = new Set<string>([
  'WHITE-HOUSE',
  'BOARD',
  'FOREST',
  'BOARDED-WINDOW',
  'KITCHEN-WINDOW',
  'TREE',
  'SONGBIRD',
  'GRATE',
  'CHIMNEY',
  'STAIRS',       // referenced in ZIL but absent from objects.json
  'TRAP-DOOR',
  'SLIDE',
  'CRACK',
  'BODIES',
  'GLOBAL-WATER',
  'RIVER',
  'RAINBOW',
  'LADDER',
  'CLIMBABLE-CLIFF',
  'WHITE-CLIFF',
]);
