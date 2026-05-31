/**
 * Port of THIS-IT? (gparser.zil:1357-1370).
 *
 * Returns true iff the object matches all active parser constraints
 * (name, adjective, gwim flag). Short-circuits on the first failure.
 */

import type { GameObject } from '../../domain/game-object.js';
import { Flag } from '../../domain/flags.js';

/** Port of THIS-IT? (gparser.zil:1357-1370). */
export function thisItQ(
  obj: GameObject,
  pNam: string | undefined,
  pAdj: string | undefined,
  pGwimFlag: Flag | undefined,
): boolean {
  if (obj.has(Flag.Invisible)) return false;  // (1) gparser.zil:1358

  // (2) gparser.zil:1359-1363
  if (pNam !== undefined) {
    const namUpper = pNam.toUpperCase();
    if (!obj.synonyms.some(s => s.toUpperCase() === namUpper)) return false;
  }

  // (3) gparser.zil:1364-1367
  if (pAdj !== undefined) {
    const adjUpper = pAdj.toUpperCase();
    if (obj.adjectives.length === 0 || !obj.adjectives.some(a => a.toUpperCase() === adjUpper)) {
      return false;
    }
  }

  // (4) gparser.zil:1368-1369
  if (pGwimFlag !== undefined && !obj.has(pGwimFlag)) return false;

  return true;
}
