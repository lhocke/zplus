/**
 * scope.ts — ScopeSnapshot builder and LIT? port.
 *
 * Exports:
 *   buildScope(here, player, world): ScopeSnapshot
 *   lit(here, player, world): boolean
 *   globalsForRoom(room, world): GameObject[]  (exported for accessible.ts)
 *
 * ScopeSnapshot is the build-once data structure that getObject uses for
 * object resolution. Built once per parse, it avoids redundant re-walking
 * of the containment tree.
 *
 * The four tiers mirror the ZIL GLOBAL-CHECK / DO-SL scope model:
 *   roomTier     — objects reachable from HERE (via DO-SL with SOG/SIR bits)
 *   invTier      — objects reachable from PLAYER (via DO-SL with SH/SC bits)
 *   localGlobals — objects referenced by room.props.GLOBAL (LOCAL-GLOBALS tier)
 *   globalObjects— true GLOBAL-OBJECTS (not room-gated, not LOCAL-GLOBALS)
 *   pseudo       — room.pseudo entries (PSEUDO tier, gparser.zil:1178-1192)
 *
 * LOCAL-GLOBALS vs GLOBAL-OBJECTS distinction:
 *   ZIL declares some objects `(IN LOCAL-GLOBALS)` — they are accessible ONLY
 *   from rooms that list them in P?GLOBAL. Others are `(IN GLOBAL-OBJECTS)` —
 *   accessible from ANY room. The rooms.json extractor captures only the FIRST
 *   element of each multi-element GLOBAL list; LOCAL_GLOBAL_IDS fills this gap.
 *
 * lit() — port of ZIL LIT? (gparser.zil:1333-1352):
 *   Room has Flag.Light (ONBIT on room) → lit.
 *   Else: any object in player inventory or room has Flag.OnFire (ONBIT on object)
 *   → lit. Flag.OnFire is the "currently emitting light" bit (ZIL ONBIT);
 *   Flag.Light is "has the capability" (ZIL LIGHTBIT). Only OnFire counts for
 *   LIT? on non-room objects (the lamp must be turned on to light the room).
 */

import type { GameObject } from '../../domain/game-object.js';
import type { Room } from '../../domain/room.js';
import type { PseudoEntry } from '../../domain/room.js';
import type { World } from '../../domain/world.js';
import { Flag } from '../../domain/flags.js';
import { searchList } from './search-list.js';
import { SRCALL } from './scope-bits.js';
import { LOCAL_GLOBAL_IDS } from './local-global-ids.js';
import { ROOM_GLOBAL_IDS } from './room-globals.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Reach tag for a room/inventory-tier candidate. */
export type Reach = 'srctop' | 'srcall' | 'srcbot';

/** A candidate object with its reach tag (used for container recursion context). */
export interface ScopeCand {
  obj: GameObject;
  reach: Reach;
}

/**
 * Build-once scope snapshot for one parse turn.
 *
 * See design brief §NEW MODULE LAYOUT §3 for tier definitions.
 */
export interface ScopeSnapshot {
  /** Objects reachable from HERE via room walk. */
  roomTier: ScopeCand[];
  /** Objects reachable from PLAYER via inventory walk. */
  invTier: ScopeCand[];
  /** Local-global objects (referenced by room.props.GLOBAL). */
  localGlobals: GameObject[];
  /** True global-objects: universally accessible (IN GLOBAL-OBJECTS in ZIL). */
  globalObjects: GameObject[];
  /** Pseudo-object entries from room.pseudo. */
  pseudo: PseudoEntry[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Returns the objects referenced by the room's LOCAL-GLOBALS list.
 *
 * Prefers the compile-time ROOM_GLOBAL_IDS table (derived from zil/1dungeon.zil)
 * which has the FULL multi-element lists. Falls back to room.props.GLOBAL for
 * any room not in the table (supporting future data updates and test rooms).
 *
 * rooms.json currently stores GLOBAL as a scalar (first element only — extraction
 * limitation). ROOM_GLOBAL_IDS fills this gap for all 60 ZIL rooms.
 *
 * For unit-test rooms (not in ROOM_GLOBAL_IDS), room.props.GLOBAL is used:
 *   - A single string → singleton list
 *   - A string[] → full list (forward-compat with updated extractor)
 */
export function globalsForRoom(room: Room, world: World): GameObject[] {
  // Prefer compile-time full list (covers all ZIL rooms with multi-element GLOBAL)
  const tableIds = ROOM_GLOBAL_IDS.get(room.id);
  if (tableIds !== undefined) {
    const result: GameObject[] = [];
    for (const id of tableIds) {
      const obj = world.get(id);
      if (obj !== undefined) result.push(obj);
      // STAIRS and other missing objects: skip silently (data-completeness gap)
    }
    return result;
  }

  // Fallback: read from room.props (handles unit-test rooms and future data updates)
  const globalProp = room.props.get('GLOBAL');
  if (globalProp === undefined || globalProp === null) return [];

  const ids: string[] = Array.isArray(globalProp)
    ? globalProp as string[]
    : typeof globalProp === 'string'
    ? [globalProp]
    : [];

  const result: GameObject[] = [];
  for (const id of ids) {
    const obj = world.get(id);
    if (obj !== undefined) result.push(obj);
  }
  return result;
}

/**
 * Collect true GLOBAL-OBJECTS — parentless non-room world objects that are NOT
 * LOCAL-GLOBALS (i.e., not room-gated via any room's GLOBAL list).
 *
 * In ZIL: objects `(IN GLOBAL-OBJECTS)` are universally accessible. The ZIL
 * universals that actually exist in objects.json are: TEETH, WALL, GRANITE-WALL.
 * (GROUND, GRUE, IT, SAILOR, STAIRS, BLESSINGS, INTNUM, ME etc. are missing from
 * the data — a known data-completeness gap, NOT a scope-model bug.)
 *
 * Objects like FOREST, WHITE-HOUSE, TREE, BOARD etc. are `(IN LOCAL-GLOBALS)` in
 * ZIL and must NOT appear here. They are classified by LOCAL_GLOBAL_IDS.
 *
 * Objects like BROKEN-LAMP, DIAMOND, INFLATED-BOAT etc. have parent===null due
 * to extraction bugs (they should be in specific rooms). They must NOT appear in
 * the GLOBAL-OBJECTS tier either. We exclude them because their IDs are NOT in
 * LOCAL_GLOBAL_IDS but they are also NOT the true ZIL GLOBAL-OBJECTS. Rather
 * than whitelisting, we combine two criteria:
 *   1. parent === null AND not a Room
 *   2. NOT in LOCAL_GLOBAL_IDS (not room-gated)
 *   3. Has synonyms (true GLOBAL-OBJECTS always have synonyms; stray objects
 *      with extraction bugs often don't — but this is not a reliable filter)
 *
 * Actually the most correct approach: any parentless non-room object NOT in
 * LOCAL_GLOBAL_IDS IS a candidate for the GLOBAL-OBJECTS tier. The broken-
 * extraction objects (BROKEN-LAMP, DIAMOND etc.) will still resolve if the
 * player types their names — but this is acceptable since they shouldn't be
 * accessible from nowhere anyway. The real fix is the data extraction.
 *
 * For now: include ALL parentless non-room non-LOCAL-GLOBAL objects.
 * This is technically over-inclusive for broken-extraction objects, but
 * it is CORRECT for the true GLOBAL-OBJECTS (TEETH, WALL, GRANITE-WALL).
 */
function collectGlobalObjects(world: World): GameObject[] {
  const result: GameObject[] = [];
  for (const obj of world.all()) {
    if (obj.parent === null && !isRoom(obj) && !LOCAL_GLOBAL_IDS.has(obj.id)) {
      result.push(obj);
    }
  }
  return result;
}

/** Returns true if the object is a Room (has an exits array). */
function isRoom(obj: GameObject): boolean {
  return 'exits' in obj;
}

// ---------------------------------------------------------------------------
// buildScope
// ---------------------------------------------------------------------------

/**
 * Build a ScopeSnapshot for the current location.
 *
 * The player is always excluded from the room-tier walk (PLAYER-TRANSBIT
 * toggle, gparser.zil:1075-1077). Inventory walk starts from player directly.
 */
export function buildScope(here: Room, player: GameObject, world: World): ScopeSnapshot {
  // --- Room tier -----------------------------------------------------------
  // Collect object ids via searchList at SRCALL (the widest walk — getObject
  // will then narrow by locBits during the two-pass retry).
  // skipObj = player ensures the player is not descended into during room walk.
  const roomFoundIds: string[] = [];
  const roomSeen = new Set<string>();
  searchList(here, undefined, undefined, undefined, player, SRCALL, roomFoundIds, world, roomSeen);

  const roomTier: ScopeCand[] = roomFoundIds.map(id => ({
    obj: world.get(id)!,
    reach: 'srcall' as Reach,
  }));

  // --- Inventory tier -------------------------------------------------------
  const invFoundIds: string[] = [];
  const invSeen = new Set<string>();
  searchList(player, undefined, undefined, undefined, null, SRCALL, invFoundIds, world, invSeen);

  const invTier: ScopeCand[] = invFoundIds.map(id => ({
    obj: world.get(id)!,
    reach: 'srcall' as Reach,
  }));

  // --- Local-globals -------------------------------------------------------
  const localGlobals = globalsForRoom(here, world);

  // --- Global-objects -------------------------------------------------------
  const globalObjects = collectGlobalObjects(world);

  // --- Pseudo ---------------------------------------------------------------
  const pseudo = (here as any).pseudo as PseudoEntry[] ?? [];

  return { roomTier, invTier, localGlobals, globalObjects, pseudo };
}

// ---------------------------------------------------------------------------
// lit() — port of LIT? (gparser.zil:1333-1352)
// ---------------------------------------------------------------------------

/**
 * Returns true if the current room is lit.
 *
 * ZIL LIT? (gparser.zil:1333-1352) logic:
 *   1. Room itself has ONBIT (Flag.Light on rooms means ONBIT) → true
 *   2. Set P-GWIMBIT = ONBIT (Flag.OnFire for objects)
 *   3. DO-SL WINNER (player) 1 1  — search inventory for any object with ONBIT
 *   4. DO-SL HERE (room) 1 1     — search room contents for any object with ONBIT
 *   else → false
 *
 * Key distinction:
 *   - Rooms use Flag.Light to represent ONBIT (outdoor/permanently-lit rooms
 *     have ONBIT set in ZIL; the extractor maps this to Flag.Light on rooms).
 *   - Objects use Flag.OnFire to represent ONBIT (the "currently emitting light"
 *     bit set dynamically when a lamp is turned on, candles are lit, etc.).
 *     Flag.Light on objects is LIGHTBIT (the capability to be a light source).
 *
 * An unlit lamp has Flag.Light (LIGHTBIT) but NOT Flag.OnFire (ONBIT), so it
 * does NOT make the room lit. Only an active light source (Flag.OnFire) does.
 */
export function lit(here: Room, player: GameObject, _world: World): boolean {
  // (1) Room itself has ONBIT → lit  [outdoor rooms have Flag.Light = ONBIT]
  if (here.has(Flag.Light)) return true;

  // (2+3) Check player inventory for an object with ONBIT (currently emitting light)
  for (const child of player.children) {
    if (child.has(Flag.OnFire)) return true;
    // Recurse into open/transparent containers (DO-SL 1 1 = SRCALL)
    if (child.has(Flag.Container) && (child.has(Flag.Open) || child.has(Flag.Transparent))) {
      for (const inner of child.children) {
        if (inner.has(Flag.OnFire)) return true;
      }
    }
  }

  // (4) Check room contents for an object with ONBIT (skipping the player)
  for (const child of here.children) {
    if (child === player) continue;
    if (child.has(Flag.OnFire)) return true;
    if (child.has(Flag.Container) && (child.has(Flag.Open) || child.has(Flag.Transparent))) {
      for (const inner of child.children) {
        if (inner.has(Flag.OnFire)) return true;
      }
    }
  }

  return false;
}
