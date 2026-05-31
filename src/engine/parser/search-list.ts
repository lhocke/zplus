/**
 * search-list.ts — Port of SEARCH-LIST and DO-SL (gparser.zil:1202-1237).
 *
 * SEARCH-LIST walks the children of a root object, calling THIS-IT? on each
 * child and recursing into containers according to the level (SRCTOP/SRCALL/SRCBOT).
 *
 * DO-SL is the dispatcher that selects level based on which bits are set in
 * locBits for a given (bit1, bit2) pair.
 */

import type { GameObject } from '../../domain/game-object.js';
import type { World } from '../../domain/world.js';
import { Flag } from '../../domain/flags.js';
import { SRCTOP, SRCALL, SRCBOT, hasBit } from './scope-bits.js';
import { thisItQ } from './this-it.js';

/**
 * Port of SEARCH-LIST (gparser.zil:1216-1237).
 *
 * Walks children of `root`, calls thisItQ on each, and recurses into
 * containers. Matches are appended to `found` (by object id, with dedup via
 * the Set kept externally or by the caller checking the found array).
 *
 * @param root      Container to walk (a room, player, or sub-container).
 * @param pNam      P-NAM — UPPERCASE noun token for thisItQ (undefined if none).
 * @param pAdj      P-ADJ — UPPERCASE adjective token for thisItQ (undefined if none).
 * @param pGwimFlag P-GWIMBIT flag for thisItQ (undefined if 0).
 * @param skipObj   Player object — skip this object and do NOT recurse into it
 *                  during room-tier walks (PLAYER-TRANSBIT toggle equivalent).
 * @param level     SRCTOP / SRCALL / SRCBOT.
 * @param found     Output array — matched object ids are appended.
 * @param world     World for child resolution.
 * @param seen      Optional dedup Set (created if not provided).
 */
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
    // PLAYER-TRANSBIT toggle: skip the player object during room walks.
    if (skipObj !== null && skipObj !== undefined && child === skipObj) continue;

    // (gparser.zil:1219-1222)
    // At SRCTOP, the child node itself is checked only if it has synonyms AND
    // passes thisItQ. At SRCALL, every child is checked. At SRCBOT, skip the
    // THIS-IT? check on the root child but still recurse.
    const hasSynonyms = child.synonyms.length > 0;

    if (level !== SRCBOT && hasSynonyms && thisItQ(child, pNam, pAdj, pGwimFlag)) {
      if (!seen.has(child.id)) {
        seen.add(child.id);
        found.push(child.id);
      }
    }

    // Recurse into the child if it has children and is open/transparent.
    // (gparser.zil:1223-1236)
    //
    // Condition: (<AND <OR <NOT <EQUAL? .LVL ,P-SRCTOP>>   ; NOT top → always descend
    //                      <FSET? .OBJ ,SEARCHBIT>          ; OR has Searchable
    //                      <FSET? .OBJ ,SURFACEBIT>>         ; OR has Surface
    //                 <SET NOBJ <FIRST? .OBJ>>              ; AND has children
    //                 <OR <FSET? .OBJ ,OPENBIT>             ; AND is open
    //                     <FSET? .OBJ ,TRANSBIT>>>           ;     OR transparent
    //
    // "NOT SRCTOP OR Searchable OR Surface" AND "has children" AND "(open OR transparent)"
    const canDescend =
      (level !== SRCTOP || child.has(Flag.Searchable) || child.has(Flag.Surface)) &&
      child.children.size > 0 &&
      (child.has(Flag.Open) || child.has(Flag.Transparent));

    if (canDescend) {
      // Child recursion level: Surface/Searchable → SRCALL; else SRCTOP.
      // (gparser.zil:1232-1236)
      const childLevel =
        child.has(Flag.Surface) || child.has(Flag.Searchable) ? SRCALL : SRCTOP;

      searchList(child, pNam, pAdj, pGwimFlag, skipObj, childLevel, found, world, seen);
    }
  }
}

/**
 * Port of DO-SL (gparser.zil:1202-1213).
 *
 * Dispatcher: given (bit1, bit2) and locBits, selects SRCALL / SRCTOP / SRCBOT
 * and calls searchList accordingly.
 *
 * If NEITHER bit1 NOR bit2 is set in locBits → no search (RTRUE in ZIL = skip).
 * If BOTH bit1 AND bit2 are set → SRCALL.
 * If only bit1 is set → SRCTOP.
 * If only bit2 is set → SRCBOT.
 *
 * locBits=-1 means all bits are set (the "wide" all-scopes pass).
 *
 * @param root      Root object to walk.
 * @param bit1      First scope bit (e.g. SH or SOG).
 * @param bit2      Second scope bit (e.g. SC or SIR).
 * @param locBits   Current P-SLOCBITS value (-1 for all-scopes).
 * @param pNam      P-NAM noun token (UPPERCASE, undefined if none).
 * @param pAdj      P-ADJ adjective token (UPPERCASE, undefined if none).
 * @param pGwimFlag P-GWIMBIT flag (undefined if 0).
 * @param skipObj   Player object to skip during room walks.
 * @param found     Output array for matched ids.
 * @param world     World reference.
 * @param seen      Optional dedup Set.
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
