/**
 * local-global-ids.ts — Compile-time registry of ZIL LOCAL-GLOBALS object IDs.
 *
 * In ZIL, objects declared `(IN LOCAL-GLOBALS)` are accessible ONLY from rooms
 * that list them in their P?GLOBAL property. This is distinct from GLOBAL-OBJECTS
 * (declared `(IN GLOBAL-OBJECTS)`), which are universally accessible.
 *
 * The rooms.json extractor captures only the FIRST element of each multi-element
 * GLOBAL list (a known extraction limitation). This module provides the complete
 * set of all object IDs that appear in ANY room's GLOBAL list in the ZIL source,
 * enabling scope.ts to correctly classify parentless objects as LOCAL-GLOBALS
 * (room-gated) vs GLOBAL-OBJECTS (universal).
 *
 * Source: zil/1dungeon.zil — all (GLOBAL ...) room property lists, plus
 * zil/gglobals.zil — objects declared (IN LOCAL-GLOBALS).
 *
 * This file is a parser-layer compile-time constant derived from the ZIL source.
 * It does NOT duplicate rooms.json; it fills the multi-element gap.
 *
 * To update: re-read zil/1dungeon.zil for all `(GLOBAL ...)` room property lists.
 */

/**
 * Set of all object IDs that appear in any room's GLOBAL list in the ZIL source.
 * Objects in this set are LOCAL-GLOBALS — accessible only from rooms that list
 * them explicitly, NOT from every room.
 *
 * Derived from zil/1dungeon.zil GLOBAL property lists (exhaustive):
 */
export const LOCAL_GLOBAL_IDS: ReadonlySet<string> = new Set<string>([
  // Above-ground / forest area globals
  'WHITE-HOUSE',
  'BOARD',
  'FOREST',
  'BOARDED-WINDOW',
  'KITCHEN-WINDOW',
  'TREE',
  'SONGBIRD',
  'GRATE',

  // Underground / cave area globals
  'CHIMNEY',
  'STAIRS',       // NOTE: STAIRS is referenced but NOT in objects.json (data gap)
  'TRAP-DOOR',
  'SLIDE',
  'CRACK',
  'BODIES',

  // Water / cliffs area globals
  'GLOBAL-WATER',
  'RIVER',
  'RAINBOW',
  'LADDER',
  'CLIMBABLE-CLIFF',
  'WHITE-CLIFF',
]);
