/**
 * gwim.ts — Port of GWIM (Get What I Mean), gparser.zil:901-926.
 *
 * Called from SYNTAX-CHECK when a DRIVE1 or DRIVE2 candidate exists but the
 * player did not supply all required objects. GWIM tries to auto-supply the
 * missing object by searching scope using only the findBit flag (no noun, no adj).
 *
 * Results:
 *   'rooms'  — dobjFindBit was RMUNGBIT → return ROOMS sentinel (LOOK AROUND, CLIMB UP/DOWN).
 *              No parenthetical is printed. Caller uses ROOMS_SENTINEL as dobjId.
 *   'ok'     — exactly one candidate found → print parenthetical, return candidate id.
 *   'fail'   — 0 or 2+ candidates → caller proceeds to orphan/CANT-ORPHAN.
 *
 * Verbatim parenthetical (gparser.zil:908-924) — oracle-critical:
 *   Prep branch  (PREP non-zero AND NOT endOnPrep):
 *     "(<prep> the <desc>)"   e.g. "(with the sword)", "(in the trophy case)"
 *     Special: OUT → "out of" (printed as "out of the <desc>")
 *   Bare branch (PREP is undefined/null OR endOnPrep is true):
 *     "(<desc>)"              e.g. "(brass lantern)", "(sword)"
 *     NOTE: no "the" in the bare branch (gparser.zil:922: <TELL D .OBJ ")" CR>)
 *
 * Two-pass GET-OBJECT semantics (gparser.zil:1043-1137):
 *   Pass 1: wide (P-SLOCBITS=-1) — room (DO-SL HERE SOG SIR) + inventory (DO-SL PLAYER SH SC).
 *   If >1 candidates: retry with XBITS (the syntax form's locBits) — narrows to
 *   whichever scopes the syntax form permits (e.g., inventory-only for V-ATTACK iobj).
 *   ITAKE-CHECK (SHAVE/STAKE bits) is enforced AFTER the match by the caller, not here.
 *
 * RMUNGBIT is deliberately NOT in find-bits.ts (it is not a real Flag). GWIM
 * checks for it explicitly here as a string sentinel before converting to Flag.
 */

import type { GameObject } from '../../domain/game-object.js';
import type { Room } from '../../domain/room.js';
import type { World } from '../../domain/world.js';
import { Flag } from '../../domain/flags.js';
import type { ScopeSnapshot } from './scope.js';
import { SOG, SIR, SH, SC } from './scope-bits.js';
import { doSL } from './search-list.js';
import { thisItQ } from './this-it.js';
import { FINDBIT_TO_FLAG } from './find-bits.js';

/**
 * Sentinel returned when GWIM encounters RMUNGBIT (gparser.zil:902-903).
 * The engine's verb handlers treat this as "the current room tree".
 */
export const ROOMS_SENTINEL = '__ROOMS__';

export type GwimResult =
  | { kind: 'rooms'; text?: undefined }         // RMUNGBIT → ROOMS, no print
  | { kind: 'ok'; id: string; text: string }    // exactly 1 match; text is the parenthetical
  | { kind: 'fail' };                            // 0 or 2+ matches

/** Port of GWIM (gparser.zil:901-926) with GET-OBJECT two-pass semantics. */
export function gwim(
  findBitName: string | undefined,
  locBits: number,
  prep: string | undefined,
  endOnPrep: boolean,
  snap: ScopeSnapshot,
  here: Room,
  player: GameObject,
  world: World,
  isLit: boolean,
  excludeIds?: ReadonlySet<string>,
): GwimResult {
  // gparser.zil:902-903 — RMUNGBIT special case: return ROOMS immediately.
  if (findBitName === 'RMUNGBIT') {
    return { kind: 'rooms' };
  }

  // Convert findBit name to a domain Flag (undefined = no flag filter).
  const findFlag: Flag | undefined =
    findBitName !== undefined ? FINDBIT_TO_FLAG[findBitName] : undefined;

  // gparser.zil:1068-1097 — two-pass GET-OBJECT:
  //   Pass 1 (wide, P-SLOCBITS=-1): room + inventory + localGlobals/globals.
  //   If >1 found: retry with XBITS — only DO-SL calls (no globals in narrow pass).
  //   Pass 2 (narrow, P-SLOCBITS=XBITS): only the scopes the syntax form permits.
  //   ITAKE-CHECK (SHAVE/STAKE) is enforced by the caller after the match.
  let candidates = searchScope(findFlag, -1, snap, here, player, world, isLit, excludeIds, true);

  if (candidates.length > 1) {
    // gparser.zil:1091-1096: >1 in wide pass → retry with XBITS.
    // GLOBAL-CHECK is NOT re-run in the narrow pass (gparser.zil:1068-1137).
    candidates = searchScope(findFlag, locBits, snap, here, player, world, isLit, excludeIds, false);
  }

  if (candidates.length !== 1) {
    return { kind: 'fail' };
  }

  const obj = world.get(candidates[0]!)!;
  const text = buildParenthetical(obj, prep, endOnPrep);

  return { kind: 'ok', id: obj.id, text };
}

/**
 * One scope pass: search room (when lit) + inventory.
 * Optionally includes localGlobals/globalObjects (wide pass only).
 *
 * pSlocBits=-1 (wide): DO-SL uses -1 → all sub-levels (SRCALL).
 * pSlocBits=XBITS (narrow): DO-SL uses XBITS → only scopes the syntax permits.
 * includeGlobals=true for wide pass; false for narrow (GLOBAL-CHECK not re-run).
 * gparser.zil:1068-1137, 1202-1213.
 */
function searchScope(
  findFlag: Flag | undefined,
  pSlocBits: number,
  snap: ScopeSnapshot,
  here: Room,
  player: GameObject,
  world: World,
  isLit: boolean,
  excludeIds: ReadonlySet<string> | undefined,
  includeGlobals: boolean,
): string[] {
  const found: string[] = [];
  const seen = new Set<string>();

  function addIfMatch(id: string): void {
    if (seen.has(id)) return;
    if (excludeIds !== undefined && excludeIds.has(id)) return;
    const obj = world.get(id);
    if (obj === undefined) return;
    if (!thisItQ(obj, undefined, undefined, findFlag)) return;
    seen.add(id);
    found.push(id);
  }

  // gparser.zil:1074-1077: room search, when lit.
  if (isLit) {
    const roomFound: string[] = [];
    const roomSeen = new Set<string>();
    doSL(here, SOG, SIR, pSlocBits, undefined, undefined, findFlag, player, roomFound, world, roomSeen);
    for (const id of roomFound) addIfMatch(id);
  }

  // gparser.zil:1078: inventory search.
  const invFound: string[] = [];
  const invSeen = new Set<string>();
  doSL(player, SH, SC, pSlocBits, undefined, undefined, findFlag, null, invFound, world, invSeen);
  for (const id of invFound) addIfMatch(id);

  // Local globals and global-objects fallback — wide pass only.
  // In the narrow pass (XBITS retry) GLOBAL-CHECK does not re-run
  // (gparser.zil:1068-1137: <AGAIN> loops back to the DO-SL block, not GLOBAL-CHECK).
  if (includeGlobals) {
    for (const obj of snap.localGlobals) {
      if (thisItQ(obj, undefined, undefined, findFlag)) {
        if (!seen.has(obj.id)) {
          seen.add(obj.id);
          found.push(obj.id);
        }
      }
    }

    if (found.length === 0) {
      for (const obj of snap.globalObjects) {
        if (thisItQ(obj, undefined, undefined, findFlag)) {
          if (!seen.has(obj.id)) {
            seen.add(obj.id);
            found.push(obj.id);
          }
        }
      }
    }
  }

  return found;
}

/**
 * Build the GWIM parenthetical text string (gparser.zil:908-924).
 * Prep branch: "(out of the X)" / "(with the X)" etc. — "out" prints as "out of".
 * Bare branch: "(X)" — no "the".
 */
function buildParenthetical(obj: GameObject, prep: string | undefined, endOnPrep: boolean): string {
  const desc = obj.desc;

  if (prep !== undefined && !endOnPrep) {
    const prepText = prep.toLowerCase() === 'out' ? 'out of' : prep.toLowerCase();  // gparser.zil:916
    return `(${prepText} the ${desc})`;
  }

  return `(${desc})`;
}
