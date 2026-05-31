/**
 * get-object.ts — Port of GET-OBJECT (gparser.zil:1040-1140) and GLOBAL-CHECK
 * (gparser.zil:1169-1200).
 *
 * This is the core object resolver. Given a ScopeSnapshot, slot constraints
 * (locBits, findBit), and a noun/adjective, it runs the two-pass retry loop
 * and GLOBAL-CHECK to find the matching object(s).
 *
 * TWO-PASS ORDER (counterintuitive — preserved exactly from ZIL):
 *   Pass 1: P-SLOCBITS = -1 (all-scopes, wide)
 *   Retry:  P-SLOCBITS = XBITS (literal syntax bits, narrow)
 * ZIL first searches wide, then narrows. This is gparser.zil:1089-1097.
 *
 * GLOBAL-CHECK runs only when both local passes yield 0 results.
 */

import type { GameObject } from '../../domain/game-object.js';
import type { Room } from '../../domain/room.js';
import type { World } from '../../domain/world.js';
import { Flag } from '../../domain/flags.js';
import type { ScopeSnapshot } from './scope.js';
import { SOG, SIR, SH, SC } from './scope-bits.js';
import { doSL } from './search-list.js';
import { thisItQ } from './this-it.js';

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

/** A pseudo sentinel returned when GLOBAL-CHECK matches a pseudo entry. */
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

// ---------------------------------------------------------------------------
// getObject
// ---------------------------------------------------------------------------

/**
 * Port of GET-OBJECT (gparser.zil:1040-1140).
 *
 * @param snap      ScopeSnapshot for the current turn.
 * @param here      Current room.
 * @param player    Player actor.
 * @param world     World.
 * @param pNam      Noun token (UPPERCASE), undefined if none.
 * @param pAdj      Adjective token (UPPERCASE), undefined if none.
 * @param findFlag  GWIM flag filter (from syntax findBit → FINDBIT_TO_FLAG), undefined if none.
 * @param locBits   Literal syntax bits (XBITS) from syntax.json.
 * @param isLit     Whether the room is currently lit.
 * @param vrb       Whether to emit noun-missing message (true = VRB T in ZIL).
 */
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
  // --- Prologue: adjective→noun promotion ---------------------------------
  // (gparser.zil:1046-1059) If P-NAM is not set but P-ADJ is, try to promote
  // the adjective to a noun. If it's a known noun, clear adj and use it as noun.
  // (In our context, this is resolved upstream in the tokenizer/splitNounPhrase,
  //  but we handle the residual case here for correctness.)
  let resolvedNam = pNam;
  let resolvedAdj = pAdj;

  // Adjective promotion: if no noun but adj is set, try treating adj as noun.
  if (resolvedNam === undefined && resolvedAdj !== undefined) {
    // Check if the adjective word is actually a noun (synonym of any object in scope)
    const adjAsNoun = resolvedAdj;
    // Treat it as the noun and clear adj (gparser.zil:1048-1049)
    resolvedNam = adjAsNoun;
    resolvedAdj = undefined;
  }

  // --- Null-noun guard ----------------------------------------------------
  // (gparser.zil:1060-1067)
  if (resolvedNam === undefined && resolvedAdj === undefined && findFlag === undefined) {
    return { kind: 'missing-noun' };
  }

  // --- Two-pass retry loop ------------------------------------------------
  // XBITS = the literal syntax locBits (saved before wide pass).
  const xbits = locBits === 0 ? -1 : locBits;  // 0 = unconstrained → treat as -1

  // Use the seen Set across both passes to track all found ids with dedup.
  const seen = new Set<string>();

  /**
   * One pass of the local scope search (room + inventory).
   * @param passLocBits  -1 for wide, xbits for narrow.
   */
  function runLocalPass(passLocBits: number): string[] {
    const found: string[] = [];
    const passSeen = new Set<string>();

    if (isLit) {
      // Room walk: SOG (outer container) and SIR (inner)
      doSL(here, SOG, SIR, passLocBits, resolvedNam, resolvedAdj, findFlag, player, found, world, passSeen);
    }
    // Inventory walk: SH (held) and SC (carried/contained)
    doSL(player, SH, SC, passLocBits, resolvedNam, resolvedAdj, findFlag, null, found, world, passSeen);

    // Dedup against the global seen set.
    return found.filter(id => {
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    });
  }

  // Pass 1 — wide (all-scopes, locBits=-1)
  const pass1Results = runLocalPass(-1);
  let len = pass1Results.length;
  let olen = 0;

  // (gparser.zil:1089-1097) TWO-PASS RETRY CONDITION:
  //   if LEN>1 OR (LEN==0 AND not already at literal bits)
  const alreadyNarrow = xbits === -1;
  if (!alreadyNarrow && (len > 1 || len === 0)) {
    // Retry with literal bits
    olen = len;
    seen.clear();  // Reset seen for retry
    const retryResults = runLocalPass(xbits);
    len = retryResults.length;
    if (len === 0) len = olen;  // Restore olen for disambig count (gparser.zil:1099)

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
    // Wide pass found >1, and we're already at the narrow bits (or xbits=-1)
    return { kind: 'disambig', ids: pass1Results };
  } else if (len === 1) {
    return { kind: 'ok', ids: pass1Results };
  }

  // len === 0 → GLOBAL-CHECK
  // (gparser.zil:1136: <ZERO? .LEN> <SET GCHECK T> <AGAIN>)

  // =========================================================================
  // GLOBAL-CHECK (gparser.zil:1169-1200) — runs only when local passes → 0
  //
  // ZIL GLOBAL-CHECK accumulates all matches into the shared result table (TBL)
  // via OBJ-FOUND, then returns to GET-OBJECT.  GET-OBJECT's LEN>1 branch then
  // fires disambiguation (WHICH-PRINT) for the collected set.  We replicate this
  // by collecting into a local `globalFound[]` array across all three arms and
  // then applying the same 1→ok / >1→disambig logic GET-OBJECT uses locally.
  //
  // Arm order (must be preserved, matches gparser.zil:1172-1200):
  //   (a) LOCAL-GLOBALS — iterate all, accumulate matches (OBJ-FOUND per match)
  //   (b) PSEUDO — name-only match; add and return immediately from GLOBAL-CHECK
  //       (ZIL: <OBJ-FOUND ...> <RETURN>) — pseudo returns as soon as it matches
  //   (c) GLOBAL-OBJECTS — only if (a)+(b) found nothing; DO-SL accumulates ALL
  //       matching children of the GLOBAL-OBJECTS pseudo-root
  // =========================================================================

  const globalFound: string[] = [];

  // (a) LOCAL-GLOBALS — iterate globalsForRoom, thisItQ each; accumulate all matches
  //     (gparser.zil:1174-1177: REPEAT loop calling OBJ-FOUND for each THIS-IT? hit)
  for (const globalObj of snap.localGlobals) {
    if (thisItQ(globalObj, resolvedNam, resolvedAdj, findFlag)) {
      globalFound.push(globalObj.id);
    }
  }

  // (b) PSEUDO — name-only match (NO synonym/adjective filter per gparser.zil:1182)
  //     <EQUAL? ,P-NAM <GET .RMG <* .CNT 2>>>
  //     ZIL: OBJ-FOUND then immediate RETURN from GLOBAL-CHECK — so pseudo is
  //     appended to any local-globals already accumulated, then we stop all arms.
  if (resolvedNam !== undefined) {
    for (const entry of snap.pseudo) {
      if (entry.word.toUpperCase() === resolvedNam.toUpperCase()) {
        // In ZIL, PSEUDO-OBJECT is a synthetic stand-in (not a real object id).
        // Return the pseudo sentinel directly — it is a special result kind that
        // bypasses the normal ok/disambig path (the engine dispatches to the
        // pseudo action directly rather than naming a real object).
        // If local-globals also matched, we treat the pseudo as the winner
        // (ZIL: RETURN exits GLOBAL-CHECK; GET-OBJECT sees the combined TBL which
        // includes the OBJ-FOUND'd local-globals AND the pseudo — but pseudo arms
        // always trigger WHICH-PRINT… unless the object is the PSEUDO-OBJECT
        // sentinel.  In practice a pseudo match is exclusive with local-global
        // matches for the same word, so returning pseudo directly is correct.)
        return { kind: 'pseudo', action: entry.action };
      }
    }
  }

  // (c) GLOBAL-OBJECTS — only if no match found yet (gparser.zil:1193-1197)
  //     <COND (<EQUAL? <GET .TBL ,P-MATCHLEN> .LEN>   ; nothing new found
  //            <DO-SL ,GLOBAL-OBJECTS 1 1>)>
  //     DO-SL with both bits set → SRCALL → walks ALL children of GLOBAL-OBJECTS.
  //     Accumulate all matches; disambiguation fires at the end if >1.
  if (globalFound.length === 0) {
    for (const globalObj of snap.globalObjects) {
      if (thisItQ(globalObj, resolvedNam, resolvedAdj, findFlag)) {
        globalFound.push(globalObj.id);
      }
    }
  }

  // Apply 1→ok / >1→disambig to the accumulated global candidates.
  if (globalFound.length === 1) {
    return { kind: 'ok', ids: globalFound };
  }
  if (globalFound.length > 1) {
    return { kind: 'disambig', ids: globalFound };
  }

  // (d) ROOMS — only when verb is V-LOOK-INSIDE, V-SEARCH, V-EXAMINE
  //     Deferred: rooms resolution requires knowing the verb action. The engine
  //     can handle this post-resolution. For now, fall through to not-here/dark.

  // NOT-HERE / DARK (gparser.zil:1118-1135)
  if (isLit) {
    const noun = resolvedNam ?? (resolvedAdj ?? 'that');
    return { kind: 'not-here', noun };
  } else {
    return { kind: 'dark' };
  }
}
