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

/** Returns true if obj is in the LOCAL-GLOBALS list for here. */
function globalIn(obj: GameObject, here: Room): boolean {
  const tableIds = ROOM_GLOBAL_IDS.get(here.id);
  if (tableIds !== undefined) {
    return tableIds.includes(obj.id);
  }
  const globalProp = here.props.get('GLOBAL');
  if (Array.isArray(globalProp)) {
    return (globalProp as string[]).includes(obj.id);
  }
  return typeof globalProp === 'string' && globalProp === obj.id;
}

/** True if obj is a parentless non-room object (a GLOBAL-OBJECTS member). */
function isGlobalObject(obj: GameObject): boolean {
  return obj.parent === null && !('exits' in obj);
}

/**
 * Port of META-LOC (gparser.zil:1398-1407).
 * Walk parents up to the nearest room or GLOBAL-OBJECTS member.
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

/** Port of ACCESSIBLE? (gparser.zil:1372-1396). */
export function accessible(
  obj: GameObject,
  here: Room,
  player: GameObject,
  _world: World,
): boolean {
  if (obj.has(Flag.Invisible)) return false;

  // PSEUDO-OBJECT: handled by parser — if obj is the lastPseudoLoc pseudo,
  // caller returns true before calling us. We skip this check here.

  const parent = obj.parent;
  if (parent === null) {
    if (isGlobalObject(obj)) return true;
    return false;
  }

  if (isGlobalObject(parent)) return true;

  if (globalIn(obj, here)) return true;

  const ml = metaLoc(obj);
  const playerLoc = player.parent;
  if (ml !== here && ml !== playerLoc) return false;

  if (parent === player || parent === here || parent === playerLoc) return true;

  if (parent.has(Flag.Open) && accessible(parent, here, player, _world)) return true;

  return false;
}
