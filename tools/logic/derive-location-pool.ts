// Deterministic derivation tool — NOT part of the shipped app. Run with
// `npx tsx tools/logic/derive-location-pool.ts` to print the current
// candidate location pool computed straight from src/data/objects.json
// and src/data/rooms.json. Re-run this whenever those data files change;
// never hand-maintain the pool list separately from what this script
// computes — the validation test (Step 6) enforces that logic-graph.json's
// locations[] matches this script's output exactly (minus the documented
// exclusion list it also prints).

import objectsData from '../../src/data/objects.json' with { type: 'json' };
import roomsData from '../../src/data/rooms.json' with { type: 'json' };

interface RawObject {
  id: string;
  flags?: string[];
  parent?: string;
}
interface RawRoom {
  id: string;
}

const objects = objectsData as RawObject[];
const rooms = roomsData as RawRoom[];
const byId = new Map(objects.map(o => [o.id, o]));
const roomIds = new Set(rooms.map(r => r.id));

/** Walk the parent chain to the nearest room ancestor. Returns undefined
 *  if the chain terminates in null/undefined before reaching a room
 *  (event-created objects with no bootstrap parent). */
export function resolveRoomId(objectId: string, seen = new Set<string>()): string | undefined {
  if (seen.has(objectId)) return undefined; // cycle guard
  seen.add(objectId);
  if (roomIds.has(objectId)) return objectId;
  const obj = byId.get(objectId);
  if (obj === undefined) return undefined;
  if (obj.parent === undefined) return undefined;
  return resolveRoomId(obj.parent, seen);
}

export interface LocationPoolEntry {
  objectId: string;
  containerId: string; // immediate parent — room OR container object
  roomId: string;       // resolved room ancestor (for region lookup)
}

/** Every Takeable object whose parent chain resolves to a room. */
export function computeLocationPool(): LocationPoolEntry[] {
  const out: LocationPoolEntry[] = [];
  for (const obj of objects) {
    if (!obj.flags?.includes('Takeable')) continue;
    if (obj.parent === undefined) continue;
    const roomId = resolveRoomId(obj.id);
    if (roomId === undefined) continue;
    out.push({ objectId: obj.id, containerId: obj.parent, roomId });
  }
  return out.sort((a, b) => a.objectId.localeCompare(b.objectId));
}

// Documented exclusions — objects that pass computeLocationPool()'s test
// but are not real shuffle targets. Each entry MUST cite the reason; the
// validation test (Task 1 Step 6) enforces that logic-graph.json's
// locations[] equals computeLocationPool() minus exactly this set.
export const DOCUMENTED_EXCLUSIONS: Record<string, string> = {
  STILETTO: 'thief\'s innate weapon (parent THIEF, room ROUND-ROOM) — not a normal placed ' +
    'pickup; recoverable only via the faithful thief-defeat mechanic, out of scope for ' +
    'relocation per the design doc\'s "faithful, untouched" thief decision.',
  MAP: 'starts Invisible; only revealed by wonFlagHook (src/engine/game.ts) after WON-FLAG ' +
    'fires — unreachable until the game is already won, not a meaningful mid-game check.',
  // AMENDMENT 3 (vessel pinning, repair task 3R2): these six items are also
  // containers of other checks (SCEPTRE inside COFFIN, WATER inside BOTTLE,
  // etc.) — static access rules cannot see where the shuffle put the vessel,
  // producing unbreakable cycles (e.g. bell inside the coffin, coffin behind
  // a bell-locked door). Fix: pin the vessel (items[].pinned: true, kept at
  // its vanilla position, never entering a fill pool), shuffle its contents.
  // The vessel's own pickup slot is occupied by definition and is no longer
  // a check; its interior locations remain checks with their existing
  // (now-correct-again) static access rules.
  COFFIN: 'container vessel, pinned (AMENDMENT 3) — its interior (SCEPTRE) remains a check.',
  'SANDWICH-BAG': 'container vessel, pinned (AMENDMENT 3) — its interior (GARLIC, LUNCH) remains a check.',
  BOTTLE: 'container vessel, pinned (AMENDMENT 3) — its interior (WATER) remains a check.',
  BUOY: 'container vessel, pinned (AMENDMENT 3) — its interior (EMERALD) remains a check.',
  EGG: 'container vessel, pinned (AMENDMENT 3) — its interior (CANARY) remains a check.',
  TUBE: 'container vessel, pinned (AMENDMENT 3) — its interior (PUTTY) remains a check.',
  // AMENDMENT 4 (troll slot, repair task 3R3): F_DEAD on TROLL (troll-fcn.ts,
  // 1actions.zil:665-670) only ever rescues AXE — drops it to the room if
  // the troll was holding it, nothing else. A different item shuffled into
  // the troll's inventory slot would be stranded/destroyed on the troll's
  // death, the same permanent-destruction class AMENDMENT 4 closes for the
  // thief. Fix: pin AXE at its vanilla slot (items[].pinned: true), same
  // treatment as the six AMENDMENT 3 vessels.
  AXE: 'troll-inventory slot, pinned (AMENDMENT 4) — the axe-only death handler ' +
    'destroys anything else placed there.',
};

if (import.meta.url === `file://${process.argv[1]}`) {
  const pool = computeLocationPool();
  console.log(`computeLocationPool(): ${pool.length} candidates`);
  for (const e of pool) {
    const excluded = DOCUMENTED_EXCLUSIONS[e.objectId];
    console.log(
      `  ${e.objectId.padEnd(20)} container=${e.containerId.padEnd(20)} room=${e.roomId}` +
      (excluded ? `  [EXCLUDED: ${excluded}]` : ''),
    );
  }
  const included = pool.filter(e => !(e.objectId in DOCUMENTED_EXCLUSIONS));
  console.log(`\n${included.length} locations after documented exclusions.`);
}
