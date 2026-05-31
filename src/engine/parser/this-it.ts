/**
 * this-it.ts — Port of THIS-IT? (gparser.zil:1357-1370).
 *
 * Determines whether an object matches the current parser name/adjective/gwim
 * constraints. Called during SEARCH-LIST walks.
 *
 * Order is EXACTLY as ZIL (each check short-circuits on false):
 *   1. Invisible → false
 *   2. pNam set AND noun NOT in obj.synonyms → false
 *   3. pAdj set AND adj NOT in obj.adjectives → false
 *   4. pGwimFlag set AND obj lacks that Flag → false
 *   else → true
 *
 * Note: synonym/adjective comparisons use UPPERCASE (vocab canonicalization
 * ensures stored synonyms/adjectives are UPPERCASE from the data extractor).
 */

import type { GameObject } from '../../domain/game-object.js';
import { Flag } from '../../domain/flags.js';

/**
 * Port of THIS-IT? — returns true iff obj matches the current parser search
 * constraints.
 *
 * @param obj       The candidate object.
 * @param pNam      P-NAM — the noun token in UPPERCASE (undefined if none set).
 * @param pAdj      P-ADJ — the adjective token in UPPERCASE (undefined if none set).
 * @param pGwimFlag P-GWIMBIT — the required Flag (undefined if GWIM bit is 0).
 */
export function thisItQ(
  obj: GameObject,
  pNam: string | undefined,
  pAdj: string | undefined,
  pGwimFlag: Flag | undefined,
): boolean {
  // (1) Invisible → false  (gparser.zil:1358)
  if (obj.has(Flag.Invisible)) return false;

  // (2) pNam set AND noun NOT in obj.synonyms → false  (gparser.zil:1359-1363)
  if (pNam !== undefined) {
    const namUpper = pNam.toUpperCase();
    if (!obj.synonyms.some(s => s.toUpperCase() === namUpper)) return false;
  }

  // (3) pAdj set AND adj NOT in obj.adjectives → false  (gparser.zil:1364-1367)
  if (pAdj !== undefined) {
    const adjUpper = pAdj.toUpperCase();
    if (obj.adjectives.length === 0 || !obj.adjectives.some(a => a.toUpperCase() === adjUpper)) {
      return false;
    }
  }

  // (4) pGwimFlag set AND obj lacks that Flag → false  (gparser.zil:1368-1369)
  if (pGwimFlag !== undefined && !obj.has(pGwimFlag)) return false;

  return true;
}
