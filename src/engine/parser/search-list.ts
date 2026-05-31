/**
 * Port of SEARCH-LIST and DO-SL (gparser.zil:1202-1237).
 *
 * SEARCH-LIST walks children of a root, calling THIS-IT? on each and recursing
 * into containers per level (SRCTOP/SRCALL/SRCBOT). DO-SL dispatches to the
 * right level based on which bits are set in locBits.
 */

import type { GameObject } from '../../domain/game-object.js';
import type { World } from '../../domain/world.js';
import { Flag } from '../../domain/flags.js';
import { SRCTOP, SRCALL, SRCBOT, hasBit } from './scope-bits.js';
import { thisItQ } from './this-it.js';

/** Port of SEARCH-LIST (gparser.zil:1216-1237). */
export function searchList(
  root: GameObject,
  pNam: string | undefined,
  pAdj: string | undefined,
  pGwimFlag: Flag | undefined,
  skipObj: GameObject | null | undefined,
  level: number,
  found: string[],
  world: World,
  seen?: Set<string>,
): void {
  if (seen === undefined) seen = new Set<string>();

  for (const child of root.children) {
    if (skipObj !== null && skipObj !== undefined && child === skipObj) continue;

    // (gparser.zil:1219-1222) SRCTOP: only check if child has synonyms.
    // SRCBOT: skip the THIS-IT? check on the child, but still recurse.
    const hasSynonyms = child.synonyms.length > 0;

    if (level !== SRCBOT && hasSynonyms && thisItQ(child, pNam, pAdj, pGwimFlag)) {
      if (!seen.has(child.id)) {
        seen.add(child.id);
        found.push(child.id);
      }
    }

    // (gparser.zil:1223-1236)
    const canDescend =
      (level !== SRCTOP || child.has(Flag.Searchable) || child.has(Flag.Surface)) &&
      child.children.size > 0 &&
      (child.has(Flag.Open) || child.has(Flag.Transparent));

    if (canDescend) {
      // (gparser.zil:1232-1236) Surface/Searchable → SRCALL; else SRCTOP.
      const childLevel =
        child.has(Flag.Surface) || child.has(Flag.Searchable) ? SRCALL : SRCTOP;

      searchList(child, pNam, pAdj, pGwimFlag, skipObj, childLevel, found, world, seen);
    }
  }
}

/**
 * Port of DO-SL (gparser.zil:1202-1213).
 * Selects SRCALL/SRCTOP/SRCBOT from (bit1, bit2) and locBits, then calls searchList.
 * Neither bit set → no search. Both set → SRCALL. Only bit1 → SRCTOP. Only bit2 → SRCBOT.
 * locBits=-1 = all-scopes (wide pass).
 */
export function doSL(
  root: GameObject,
  bit1: number,
  bit2: number,
  locBits: number,
  pNam: string | undefined,
  pAdj: string | undefined,
  pGwimFlag: Flag | undefined,
  skipObj: GameObject | null | undefined,
  found: string[],
  world: World,
  seen?: Set<string>,
): void {
  const bothBits = bit1 + bit2;
  const hasBoth = hasBit(locBits, bothBits);
  const has1 = hasBit(locBits, bit1);
  const has2 = hasBit(locBits, bit2);

  if (hasBoth) {
    searchList(root, pNam, pAdj, pGwimFlag, skipObj, SRCALL, found, world, seen);
  } else if (has1) {
    searchList(root, pNam, pAdj, pGwimFlag, skipObj, SRCTOP, found, world, seen);
  } else if (has2) {
    searchList(root, pNam, pAdj, pGwimFlag, skipObj, SRCBOT, found, world, seen);
  }
  // else: neither bit → no search
}
