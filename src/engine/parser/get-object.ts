/**
 * Port of GET-OBJECT (gparser.zil:1040-1140) and GLOBAL-CHECK
 * (gparser.zil:1169-1200).
 *
 * Two-pass retry (gparser.zil:1089-1097): wide pass first (locBits=-1), then
 * narrow (literal XBITS). GLOBAL-CHECK runs only when both local passes yield 0.
 */

import type { GameObject } from '../../domain/game-object.js';
import type { Room } from '../../domain/room.js';
import type { World } from '../../domain/world.js';
import { Flag } from '../../domain/flags.js';
import type { ScopeSnapshot } from './scope.js';
import { SOG, SIR, SH, SC } from './scope-bits.js';
import { doSL } from './search-list.js';
import { thisItQ } from './this-it.js';

/** Pseudo sentinel returned when GLOBAL-CHECK matches a pseudo entry. */
export interface PseudoMatch {
  kind: 'pseudo';
  action: string;
}

export type GetObjectResult =
  | { kind: 'ok'; ids: string[] }          // 1 or more (disambig if >1)
  | { kind: 'disambig'; ids: string[] }    // >1 after retry
  | { kind: 'not-here'; noun: string }     // 0 after GLOBAL-CHECK, room is lit
  | { kind: 'dark' }                       // 0 after GLOBAL-CHECK, room is dark
  | { kind: 'pseudo'; action: string }     // pseudo sentinel
  | { kind: 'missing-noun' }               // no noun, no adj, no gwim (vrb=true emits message)
  | { kind: 'none' }                       // nothing needed (numObjects=0 slot)
  ;

/** Port of GET-OBJECT (gparser.zil:1040-1140). */
export function getObject(
  snap: ScopeSnapshot,
  here: Room,
  player: GameObject,
  world: World,
  pNam: string | undefined,
  pAdj: string | undefined,
  findFlag: Flag | undefined,
  locBits: number,
  isLit: boolean,
  _vrb: boolean,
): GetObjectResult {
  // Adjective→noun promotion (gparser.zil:1046-1059): if no noun but adj is set,
  // treat the adj as the noun and clear adj.
  let resolvedNam = pNam;
  let resolvedAdj = pAdj;

  if (resolvedNam === undefined && resolvedAdj !== undefined) {
    resolvedNam = resolvedAdj;
    resolvedAdj = undefined;
  }

  // (gparser.zil:1060-1067)
  if (resolvedNam === undefined && resolvedAdj === undefined && findFlag === undefined) {
    return { kind: 'missing-noun' };
  }

  const xbits = locBits === 0 ? -1 : locBits;  // 0 = unconstrained → treat as -1
  const seen = new Set<string>();

  function runLocalPass(passLocBits: number): string[] {
    const found: string[] = [];
    const passSeen = new Set<string>();

    if (isLit) {
      // Room walk: SOG (outer container) and SIR (inner)
      doSL(here, SOG, SIR, passLocBits, resolvedNam, resolvedAdj, findFlag, player, found, world, passSeen);
    }
    // Inventory walk: SH (held) and SC (carried/contained)
    doSL(player, SH, SC, passLocBits, resolvedNam, resolvedAdj, findFlag, null, found, world, passSeen);

    return found.filter(id => {
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    });
  }

  const pass1Results = runLocalPass(-1);
  let len = pass1Results.length;
  let olen = 0;

  // (gparser.zil:1089-1097) retry with literal bits when ambiguous or empty
  const alreadyNarrow = xbits === -1;
  if (!alreadyNarrow && (len > 1 || len === 0)) {
    olen = len;
    seen.clear();
    const retryResults = runLocalPass(xbits);
    len = retryResults.length;
    if (len === 0) len = olen;  // restore for disambig count (gparser.zil:1099)

    if (len > 1) {
      // Still ambiguous after narrow pass — disambig
      const disambigIds = retryResults.length > 0 ? retryResults : pass1Results;
      return { kind: 'disambig', ids: disambigIds };
    }

    if (len === 1 && retryResults.length === 1) {
      return { kind: 'ok', ids: retryResults };
    }

    // len === 0 → fall through to GLOBAL-CHECK
  } else if (len > 1) {
    return { kind: 'disambig', ids: pass1Results };
  } else if (len === 1) {
    return { kind: 'ok', ids: pass1Results };
  }

  // len === 0 → GLOBAL-CHECK (gparser.zil:1169-1200)
  //
  // Arm order (gparser.zil:1172-1200):
  //   (a) LOCAL-GLOBALS — accumulate all matches
  //   (b) PSEUDO — name-only match; return immediately on first hit
  //   (c) GLOBAL-OBJECTS — only when (a)+(b) found nothing

  const globalFound: string[] = [];

  // (a) LOCAL-GLOBALS (gparser.zil:1174-1177)
  for (const globalObj of snap.localGlobals) {
    if (thisItQ(globalObj, resolvedNam, resolvedAdj, findFlag)) {
      globalFound.push(globalObj.id);
    }
  }

  // (b) PSEUDO — name-only match (gparser.zil:1182); return immediately on hit
  if (resolvedNam !== undefined) {
    for (const entry of snap.pseudo) {
      if (entry.word.toUpperCase() === resolvedNam.toUpperCase()) {
        return { kind: 'pseudo', action: entry.action };
      }
    }
  }

  // (c) GLOBAL-OBJECTS — only when nothing found yet (gparser.zil:1193-1197)
  if (globalFound.length === 0) {
    for (const globalObj of snap.globalObjects) {
      if (thisItQ(globalObj, resolvedNam, resolvedAdj, findFlag)) {
        globalFound.push(globalObj.id);
      }
    }
  }

  if (globalFound.length === 1) {
    return { kind: 'ok', ids: globalFound };
  }
  if (globalFound.length > 1) {
    return { kind: 'disambig', ids: globalFound };
  }

  // NOT-HERE / DARK (gparser.zil:1118-1135)
  if (isLit) {
    const noun = resolvedNam ?? (resolvedAdj ?? 'that');
    return { kind: 'not-here', noun };
  } else {
    return { kind: 'dark' };
  }
}
