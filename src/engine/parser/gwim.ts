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

/** Port of GWIM (gparser.zil:901-926). */
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

  const candidates = findGwimCandidates(findFlag, locBits, snap, here, player, world, isLit, excludeIds);

  if (candidates.length !== 1) {
    return { kind: 'fail' };
  }

  const obj = world.get(candidates[0]!)!;
  const text = buildParenthetical(obj, prep, endOnPrep);

  return { kind: 'ok', id: obj.id, text };
}

/**
 * Collect all objects in scope that pass the flag filter.
 * Room + inventory + local globals, then global objects only when nothing else matched.
 */
function findGwimCandidates(
  findFlag: Flag | undefined,
  locBits: number,
  snap: ScopeSnapshot,
  here: Room,
  player: GameObject,
  world: World,
  isLit: boolean,
  excludeIds?: ReadonlySet<string>,
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

  // Skip room search when locBits has no room bits (SIR=32 or SOG=16).
  // V-ATTACK iobj locBits = SH+SC+SHAVE — no SIR/SOG → inventory-only.
  // gparser.zil:909: room pass runs only when the syntax form requests it.
  const wantRoom = (locBits & (SIR | SOG)) !== 0;
  if (isLit && wantRoom) {
    const roomFound: string[] = [];
    const roomSeen = new Set<string>();
    doSL(here, SOG, SIR, -1, undefined, undefined, findFlag, player, roomFound, world, roomSeen);
    for (const id of roomFound) addIfMatch(id);
  }

  const invFound: string[] = [];
  const invSeen = new Set<string>();
  doSL(player, SH, SC, -1, undefined, undefined, findFlag, null, invFound, world, invSeen);
  for (const id of invFound) addIfMatch(id);

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
