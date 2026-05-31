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
import { ROOM_GLOBAL_IDS } from './room-globals.js';

// ---------------------------------------------------------------------------
// Compile-time allow-list of true GLOBAL-OBJECTS members
// ---------------------------------------------------------------------------

/**
 * Explicit allow-list of object IDs that are declared `(IN GLOBAL-OBJECTS)` in
 * the ZIL source (zil/1dungeon.zil).  Only these three objects are children of
 * the GLOBAL-OBJECTS pseudo-root and are therefore universally in scope from
 * any room without needing a room GLOBAL list entry.
 *
 * TEETH, WALL, GRANITE-WALL — the only objects in objects.json that carry this
 * ZIL declaration.  All other parentless objects in the data have parent===null
 * due to extraction gaps; they are NOT GLOBAL-OBJECTS and must not be resolved
 * from a room that does not contain them.
 *
 * Mirrors LOCAL_GLOBAL_IDS and ROOM_GLOBAL_IDS — a data-table fix, not an
 * algorithm change.
 */
export const GLOBAL_OBJECT_IDS: ReadonlySet<string> = new Set<string>([
  'TEETH',
  'GRANITE-WALL',
  'WALL',
]);

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
 * Collect true GLOBAL-OBJECTS — the objects listed in GLOBAL_OBJECT_IDS.
 *
 * In ZIL, objects declared `(IN GLOBAL-OBJECTS)` are children of the
 * GLOBAL-OBJECTS pseudo-root and are universally accessible from any room.
 * Only three such objects exist in objects.json: TEETH, WALL, GRANITE-WALL.
 *
 * All other parentless objects in the data (BROKEN-LAMP, DIAMOND, INFLATED-BOAT,
 * HOT-BELL, GUNK, PUNCTURED-BOAT, BROKEN-EGG, BAUBLE, MOUNTAIN-RANGE …) have
 * parent===null only because of extraction gaps — they should be in specific
 * rooms or under LOCAL-GLOBALS, and they must NOT be resolved from a room that
 * does not contain them.
 *
 * Fix: use the explicit GLOBAL_OBJECT_IDS allow-list instead of the old
 * heuristic (parent===null ∧ !isRoom ∧ !LOCAL_GLOBAL_IDS).  This is a
 * data-table fix, not an algorithm change.
 */
function collectGlobalObjects(world: World): GameObject[] {
  const result: GameObject[] = [];
  for (const id of GLOBAL_OBJECT_IDS) {
    const obj = world.get(id);
    if (obj !== undefined) result.push(obj);
  }
  return result;
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
 *   1. Room itself has ONBIT (Flag.On on rooms = always-lit/outdoor) → true
 *   2. Set P-GWIMBIT = ONBIT (Flag.OnFire for objects)
 *   3. DO-SL WINNER (player) 1 1  — search inventory for any object with ONBIT
 *   4. DO-SL HERE (room) 1 1     — search room contents for any object with ONBIT
 *   else → false
 *
 * Key distinction:
 *   - Rooms use Flag.On to represent ONBIT (P1-3: outdoor/permanently-lit rooms
 *     have ONBIT set in ZIL; the extractor maps this to Flag.On on rooms).
 *     Flag.Light on rooms is LIGHTBIT (capability) — not used for room illumination.
 *   - Objects use Flag.OnFire to represent ONBIT (the "currently emitting light"
 *     bit set dynamically when a lamp is turned on, candles are lit, etc.).
 *     Flag.Light on objects is LIGHTBIT (the capability to be a light source).
 *
 * An unlit lamp has Flag.Light (LIGHTBIT) but NOT Flag.OnFire (ONBIT), so it
 * does NOT make the room lit. Only an active light source (Flag.OnFire) does.
 */
export function lit(here: Room, player: GameObject, _world: World): boolean {
  // (1) Room itself has ONBIT (Flag.On) → lit  [outdoor/always-lit rooms]
  if (here.has(Flag.On)) return true;

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
