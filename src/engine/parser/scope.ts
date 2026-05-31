/**
 * scope.ts — ScopeSnapshot builder and LIT? port.
 *
 * Exports:
 *   buildScope(here, player, world): ScopeSnapshot
 *   lit(here, player, world): boolean
 *
 * ScopeSnapshot is the build-once data structure that getObject uses for
 * object resolution. Built once per parse, it avoids redundant re-walking
 * of the containment tree.
 *
 * The four tiers mirror the ZIL GLOBAL-CHECK / DO-SL scope model:
 *   roomTier     — objects reachable from HERE (via DO-SL with SOG/SIR bits)
 *   invTier      — objects reachable from PLAYER (via DO-SL with SH/SC bits)
 *   localGlobals — objects referenced by room.props.GLOBAL (LOCAL-GLOBALS tier)
 *   globalObjects— parentless non-room world objects (GLOBAL-OBJECTS tier)
 *   pseudo       — room.pseudo entries (PSEUDO tier, gparser.zil:1178-1192)
 */

import type { GameObject } from '../../domain/game-object.js';
import type { Room } from '../../domain/room.js';
import type { PseudoEntry } from '../../domain/room.js';
import type { World } from '../../domain/world.js';
import { Flag } from '../../domain/flags.js';
import { searchList } from './search-list.js';
import { SRCALL } from './scope-bits.js';

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
  /** Global-objects: parentless non-room world objects. */
  globalObjects: GameObject[];
  /** Pseudo-object entries from room.pseudo. */
  pseudo: PseudoEntry[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Returns the object referenced by room.props.GLOBAL, if any.
 * The scalar GLOBAL prop is always a single ObjectId string in the data.
 * A future list fix is a one-line change here (globalsForRoom centralises it).
 */
function globalsForRoom(room: Room, world: World): GameObject[] {
  const globalId = room.props.get('GLOBAL');
  if (typeof globalId !== 'string') return [];
  const obj = world.get(globalId);
  return obj !== undefined ? [obj] : [];
}

/**
 * Collect all parentless non-room world objects.
 * These are the GLOBAL-OBJECTS tier (gparser.zil:1196 DO-SL ,GLOBAL-OBJECTS 1 1).
 * Derived from actual world state — not a hardcoded id list.
 */
function collectGlobalObjects(world: World): GameObject[] {
  const result: GameObject[] = [];
  for (const obj of world.all()) {
    if (obj.parent === null && !isRoom(obj)) {
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
 * ZIL LIT? logic:
 *   1. Room itself has Light flag (ONBIT) → true
 *   2. Any object reachable from PLAYER (inventory) has Light flag → true
 *   3. Any object reachable from HERE (room) has Light flag → true
 *   else → false
 *
 * Simplified from the full ZIL (which uses a P-MERGE table scan and sets
 * P-GWIMBIT to ONBIT during the scan). Here we simply walk known tiers.
 */
export function lit(here: Room, player: GameObject, _world: World): boolean {
  // Room itself is lit
  if (here.has(Flag.Light)) return true;

  // Check player inventory for a light source
  for (const child of player.children) {
    if (child.has(Flag.Light)) return true;
    // Check open containers in inventory
    if (child.has(Flag.Container) && (child.has(Flag.Open) || child.has(Flag.Transparent))) {
      for (const inner of child.children) {
        if (inner.has(Flag.Light)) return true;
      }
    }
  }

  // Check room contents for a light source
  for (const child of here.children) {
    if (child === player) continue;
    if (child.has(Flag.Light)) return true;
    if (child.has(Flag.Container) && (child.has(Flag.Open) || child.has(Flag.Transparent))) {
      for (const inner of child.children) {
        if (inner.has(Flag.Light)) return true;
      }
    }
  }

  return false;
}
