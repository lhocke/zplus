/**
 * ScopeSnapshot builder and LIT? port.
 *
 * ScopeSnapshot is the build-once data structure getObject uses for object
 * resolution. The four tiers mirror the ZIL GLOBAL-CHECK / DO-SL scope model:
 *   roomTier     — objects reachable from HERE (via DO-SL with SOG/SIR bits)
 *   invTier      — objects reachable from PLAYER (via DO-SL with SH/SC bits)
 *   localGlobals — objects referenced by room.props.GLOBAL (LOCAL-GLOBALS tier)
 *   globalObjects— true GLOBAL-OBJECTS (not room-gated, not LOCAL-GLOBALS)
 *   pseudo       — room.pseudo entries (PSEUDO tier, gparser.zil:1178-1192)
 *
 * lit() — port of ZIL LIT? (gparser.zil:1333-1352):
 *   Room has Flag.Light (ONBIT on room) → lit.
 *   Else: any object in player inventory or room has Flag.OnFire (ONBIT on object)
 *   → lit.
 */

import type { GameObject } from '../../domain/game-object.js';
import type { Room } from '../../domain/room.js';
import type { PseudoEntry } from '../../domain/room.js';
import type { World } from '../../domain/world.js';
import { Flag } from '../../domain/flags.js';
import { searchList } from './search-list.js';
import { SRCALL } from './scope-bits.js';
import { ROOM_GLOBAL_IDS } from './room-globals.js';

// TEETH, WALL, GRANITE-WALL declared `(IN GLOBAL-OBJECTS)` in zil/1dungeon.zil.
// LUNGS declared in zil/gglobals.zil:208 — universally in-scope for BREATHE/inflate.
// All other parentless objects have parent===null due to extraction gaps and must
// NOT be treated as universally in-scope.
export const GLOBAL_OBJECT_IDS: ReadonlySet<string> = new Set<string>([
  'TEETH',
  'GRANITE-WALL',
  'WALL',
  'LUNGS',
]);

/** Reach tag for a room/inventory-tier candidate. */
export type Reach = 'srctop' | 'srcall' | 'srcbot';

/** A candidate object with its reach tag. */
export interface ScopeCand {
  obj: GameObject;
  reach: Reach;
}

/** Build-once scope snapshot for one parse turn. */
export interface ScopeSnapshot {
  roomTier: ScopeCand[];
  invTier: ScopeCand[];
  localGlobals: GameObject[];
  globalObjects: GameObject[];
  pseudo: PseudoEntry[];
}

/**
 * Returns the objects referenced by the room's LOCAL-GLOBALS list.
 *
 * Prefers the compile-time ROOM_GLOBAL_IDS table over room.props.GLOBAL —
 * the table has full multi-element lists; rooms.json stores only the first
 * element (see room-globals.ts). Falls back to room.props.GLOBAL for
 * unit-test rooms not in the table.
 */
export function globalsForRoom(room: Room, world: World): GameObject[] {
  const tableIds = ROOM_GLOBAL_IDS.get(room.id);
  if (tableIds !== undefined) {
    const result: GameObject[] = [];
    for (const id of tableIds) {
      const obj = world.get(id);
      if (obj !== undefined) result.push(obj);
    }
    return result;
  }

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

function collectGlobalObjects(world: World): GameObject[] {
  const result: GameObject[] = [];
  for (const id of GLOBAL_OBJECT_IDS) {
    const obj = world.get(id);
    if (obj !== undefined) result.push(obj);
  }
  return result;
}

/**
 * Build a ScopeSnapshot for the current location.
 *
 * The player is excluded from the room-tier walk (PLAYER-TRANSBIT toggle,
 * gparser.zil:1075-1077). Inventory walk starts from player directly.
 */
export function buildScope(here: Room, player: GameObject, world: World): ScopeSnapshot {
  // Room tier: SRCALL (widest walk); getObject narrows by locBits later.
  const roomFoundIds: string[] = [];
  const roomSeen = new Set<string>();
  searchList(here, undefined, undefined, undefined, player, SRCALL, roomFoundIds, world, roomSeen);

  const roomTier: ScopeCand[] = roomFoundIds.map(id => ({
    obj: world.get(id)!,
    reach: 'srcall' as Reach,
  }));

  // Inventory tier
  const invFoundIds: string[] = [];
  const invSeen = new Set<string>();
  searchList(player, undefined, undefined, undefined, null, SRCALL, invFoundIds, world, invSeen);

  const invTier: ScopeCand[] = invFoundIds.map(id => ({
    obj: world.get(id)!,
    reach: 'srcall' as Reach,
  }));

  const localGlobals = globalsForRoom(here, world);
  const globalObjects = collectGlobalObjects(world);
  const pseudo = (here as any).pseudo as PseudoEntry[] ?? [];

  return { roomTier, invTier, localGlobals, globalObjects, pseudo };
}

/**
 * Port of LIT? (gparser.zil:1333-1352).
 *
 * Rooms use Flag.On for ONBIT (outdoor/always-lit). Objects use Flag.OnFire
 * for ONBIT (currently emitting light — the lamp must be turned on).
 * An unlit lamp has Flag.Light (LIGHTBIT) but not Flag.OnFire, so it does not
 * make the room lit.
 */
export function lit(here: Room, player: GameObject, _world: World): boolean {
  if (here.has(Flag.On)) return true;

  for (const child of player.children) {
    if (child.has(Flag.OnFire)) return true;
    if (child.has(Flag.Container) && (child.has(Flag.Open) || child.has(Flag.Transparent))) {
      for (const inner of child.children) {
        if (inner.has(Flag.OnFire)) return true;
      }
    }
  }

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
