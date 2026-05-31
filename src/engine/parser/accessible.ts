/**
 * accessible.ts — Port of ACCESSIBLE? (gparser.zil:1372-1396).
 *
 * Used for IT-pronoun validation ONLY (not the primary scope filter).
 * Determines whether the player can currently touch/access an object.
 *
 * ZIL ACCESSIBLE? order (preserved exactly):
 *   1. Invisible → false
 *   2. [PSEUDO-OBJECT special case: lastPseudoLoc===HERE → true] — handled by caller
 *   3. parent null → false
 *   4. parent is a global-object (parentless non-room) → true
 *   5. parent is a local-global AND globalIn(obj,HERE) → true
 *   6. metaLoc(obj) ∉ {HERE, loc(WINNER)} → false
 *   7. parent ∈ {WINNER, HERE, loc(WINNER)} → true
 *   8. parent has Open AND accessible(parent) recursively → true
 *   9. else → false
 */

import type { GameObject } from '../../domain/game-object.js';
import type { Room } from '../../domain/room.js';
import type { World } from '../../domain/world.js';
import { Flag } from '../../domain/flags.js';
import { ROOM_GLOBAL_IDS } from './room-globals.js';

/**
 * Returns true if the object `obj` is in the GLOBAL list for `here`.
 *
 * Prefers the compile-time ROOM_GLOBAL_IDS table (full multi-element lists
 * from ZIL) over rooms.json room.props.GLOBAL (which has only the first element).
 * Falls back to room.props.GLOBAL for unit-test rooms not in the table.
 */
function globalIn(obj: GameObject, here: Room): boolean {
  // Prefer compile-time full list
  const tableIds = ROOM_GLOBAL_IDS.get(here.id);
  if (tableIds !== undefined) {
    return tableIds.includes(obj.id);
  }
  // Fallback: rooms.json scalar or array
  const globalProp = here.props.get('GLOBAL');
  if (Array.isArray(globalProp)) {
    return (globalProp as string[]).includes(obj.id);
  }
  return typeof globalProp === 'string' && globalProp === obj.id;
}

/**
 * Returns true if the object `obj` is a parentless non-room object
 * (i.e., a GLOBAL-OBJECTS member).
 */
function isGlobalObject(obj: GameObject): boolean {
  return obj.parent === null && !('exits' in obj);
}

/**
 * Port of META-LOC (gparser.zil:1398-1407).
 * Walk parents up until we hit a room or a global-object container.
 * Returns:
 *   - the immediate room ancestor, or
 *   - the object itself if it is in GLOBAL-OBJECTS (parentless non-room)
 * Depth-bounded to ~8 to prevent infinite loops on corrupt data.
 */
function metaLoc(obj: GameObject): GameObject | null {
  let cur: GameObject | null = obj;
  for (let i = 0; i < 8; i++) {
    if (cur === null) return null;
    if (isGlobalObject(cur)) return cur;
    if ('exits' in cur) return cur;  // it's a Room
    cur = cur.parent;
  }
  return null;
}

/**
 * Port of ACCESSIBLE? (gparser.zil:1372-1396).
 *
 * @param obj    The object to check (e.g. the current IT referent).
 * @param here   The current room (ZIL HERE).
 * @param player The player actor (ZIL WINNER/PLAYER).
 * @param world  The world.
 */
export function accessible(
  obj: GameObject,
  here: Room,
  player: GameObject,
  _world: World,
): boolean {
  // (1) Invisible → false
  if (obj.has(Flag.Invisible)) return false;

  // [PSEUDO-OBJECT: handled by parser — if obj is the lastPseudoLoc pseudo,
  //  caller returns true before calling us. We skip this check here.]

  // (3) parent null → false
  //     EXCEPTION: parentless non-room objects ARE global-objects → handled in step 4.
  const parent = obj.parent;
  if (parent === null) {
    // A parentless non-room object is a global-object → accessible (step 4).
    if (isGlobalObject(obj)) return true;
    return false;
  }

  // (4) parent is a global-object → true
  if (isGlobalObject(parent)) return true;

  // (5) parent is local-global AND globalIn(obj, HERE) → true
  //     Note: in the data, local-globals are the objects referenced by
  //     room.props.GLOBAL. The object's parent isn't literally LOCAL-GLOBALS;
  //     instead we check if obj's id matches room.props.GLOBAL.
  if (globalIn(obj, here)) return true;

  // (6) metaLoc(obj) ∉ {HERE, loc(WINNER)} → false
  const ml = metaLoc(obj);
  const playerLoc = player.parent;
  if (ml !== here && ml !== playerLoc) return false;

  // (7) parent ∈ {WINNER, HERE, loc(WINNER)} → true
  if (parent === player || parent === here || parent === playerLoc) return true;

  // (8) parent has Open AND accessible(parent) recursively → true
  if (parent.has(Flag.Open) && accessible(parent, here, player, _world)) return true;

  // (9) else → false
  return false;
}
