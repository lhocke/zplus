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

// ---------------------------------------------------------------------------
// Sentinel for ROOMS pseudo-root (RMUNGBIT result)
// ---------------------------------------------------------------------------

/**
 * Sentinel object id returned when GWIM encounters RMUNGBIT.
 *
 * RMUNGBIT is the "go up a level" indicator for syntaxes like LOOK AROUND,
 * CLIMB UP, CLIMB DOWN (gparser.zil:902-903). GWIM returns the ZIL ROOMS
 * object directly; we use this string sentinel as its equivalent.
 * The engine's verb handlers should ignore dobjId when it equals ROOMS_SENTINEL
 * (or handle it as "the current room tree").
 */
export const ROOMS_SENTINEL = '__ROOMS__';

// ---------------------------------------------------------------------------
// GwimResult discriminated union
// ---------------------------------------------------------------------------

export type GwimResult =
  | { kind: 'rooms'; text?: undefined }         // RMUNGBIT → ROOMS, no print
  | { kind: 'ok'; id: string; text: string }    // exactly 1 match; text is the parenthetical
  | { kind: 'fail' };                            // 0 or 2+ matches

// ---------------------------------------------------------------------------
// gwim() — main entry point
// ---------------------------------------------------------------------------

/**
 * Port of GWIM (gparser.zil:901-926).
 *
 * @param findBitName  ZIL FIND bit name (e.g. "WEAPONBIT", "RMUNGBIT"). undefined = no filter.
 * @param locBits      Scope location bitmask from the syntax entry (dobjLocBits or iobjLocBits).
 * @param prep         UPPERCASE canonical prep (e.g. "WITH", "ON"), or undefined if none.
 * @param endOnPrep    True when the prep was typed with nothing following it (P-END-ON-PREP).
 *                     When true, forces the bare branch (no "the <prep> the <desc>").
 * @param snap         ScopeSnapshot for the current turn.
 * @param here         Current room.
 * @param player       Player actor.
 * @param world        The world.
 * @param isLit        Whether the room is currently lit.
 * @param excludeIds   Optional set of object ids to exclude from candidate search.
 *                     Used to prevent a drive2 iobj from being the same object as the dobj.
 */
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

  // GWIM runs GET-OBJECT with VRB=false (no "noun missing" error printing),
  // no noun, no adjective — pure flag-based search.
  // We replicate the two-pass logic using scope tiers directly.
  //
  // C7: Removed requireFlammable check.
  // The dobj-exclusion mechanism (excludeIds) already removes the dobj object from
  // iobj GWIM candidates. When "burn X" is typed, GWIM excludes X (the burnable
  // object) from the FLAMEBIT search, so burning candles/torch in scope are only
  // found if they are NOT the dobj. This means if only the match is burning (not the
  // dobj), GWIM finds exactly 1 → succeeds. The requireFlammable check incorrectly
  // required Flag.Flammable (BURNBIT) instead of distinguishing FLAMEBIT from ONBIT,
  // and broke the case where the burning match (OnFire only, no Flammable) is a
  // valid FLAMEBIT (flame source) for lighting candles.
  // ZIL: FLAMING? = FSET? FLAMEBIT AND FSET? ONBIT. In our port both map to
  // Flag.OnFire (merged). The dobj exclusion is the correct disambiguation mechanism.
  const candidates = findGwimCandidates(findFlag, locBits, snap, here, player, world, isLit, excludeIds);

  if (candidates.length !== 1) {
    // 0 matches → caller orphans; 2+ → ambiguous, caller orphans
    return { kind: 'fail' };
  }

  const obj = world.get(candidates[0]!)!;
  const text = buildParenthetical(obj, prep, endOnPrep);

  return { kind: 'ok', id: obj.id, text };
}

// ---------------------------------------------------------------------------
// Candidate search — flag-only search across scope tiers
// ---------------------------------------------------------------------------

/**
 * Find all objects matching the given flag (or all objects if findFlag is
 * undefined) across the current scope tiers.
 *
 * Mirrors the GET-OBJECT two-pass local search + GLOBAL-CHECK that GWIM
 * implicitly uses via GET-OBJECT(P-MERGE, false).
 *
 * Pass 1 = wide (locBits=-1 = all scopes, but we search all tiers).
 * We collect from: room tier + inventory tier + local globals + global objects.
 * Dedup by id.
 *
 * FLAMEBIT special case: ZIL FLAMEBIT (flame source capable of igniting) differs
 * from ONBIT (currently lit/on). Our data maps FLAMEBIT→Flag.OnFire for thisItQ,
 * but `isFlaming?` in ZIL requires BOTH FLAMEBIT and ONBIT simultaneously. When
 * searching for FLAMEBIT objects as GWIM candidates (flame sources), we require
 * that the object also has Flag.Flammable (BURNBIT) to match the ZIL FLAMING? test.
 * This prevents lit candles (ONBIT only, no BURNBIT) from appearing as flame sources.
 */
function findGwimCandidates(
  findFlag: Flag | undefined,
  _locBits: number,
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
    // Exclude explicitly requested ids (e.g., the dobj object for drive2).
    if (excludeIds !== undefined && excludeIds.has(id)) return;
    const obj = world.get(id);
    if (obj === undefined) return;
    // GWIM uses thisItQ with no noun/adj, only the gwimBit flag filter.
    if (!thisItQ(obj, undefined, undefined, findFlag)) return;
    seen.add(id);
    found.push(id);
  }

  // Local room walk (only when lit — same as GET-OBJECT)
  if (isLit) {
    const roomFound: string[] = [];
    const roomSeen = new Set<string>();
    doSL(here, SOG, SIR, -1, undefined, undefined, findFlag, player, roomFound, world, roomSeen);
    for (const id of roomFound) addIfMatch(id);
  }

  // Inventory walk (always)
  const invFound: string[] = [];
  const invSeen = new Set<string>();
  doSL(player, SH, SC, -1, undefined, undefined, findFlag, null, invFound, world, invSeen);
  for (const id of invFound) addIfMatch(id);

  // LOCAL-GLOBALS tier
  for (const obj of snap.localGlobals) {
    if (thisItQ(obj, undefined, undefined, findFlag)) {
      if (!seen.has(obj.id)) {
        seen.add(obj.id);
        found.push(obj.id);
      }
    }
  }

  // GLOBAL-OBJECTS tier (only when room+inventory+localGlobals found nothing)
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

// ---------------------------------------------------------------------------
// Parenthetical text builder
// ---------------------------------------------------------------------------

/**
 * Build the GWIM parenthetical text string.
 *
 * gparser.zil:908-924 verbatim logic:
 *   if PREP is non-zero AND NOT P-END-ON-PREP:
 *     "(" + PREP-text + " the " + desc + ")"   (prep branch)
 *     Special: PREP == W?OUT → print "out of" instead of "out"
 *   else:
 *     "(" + desc + ")"                           (bare branch — NO "the")
 */
function buildParenthetical(obj: GameObject, prep: string | undefined, endOnPrep: boolean): string {
  const desc = obj.desc; // P?DESC — the object's lowercase name

  // Prep branch: prep is present AND NOT end-on-prep
  if (prep !== undefined && !endOnPrep) {
    // OUT prints as "out of" (gparser.zil:916)
    const prepText = prep.toLowerCase() === 'out' ? 'out of' : prep.toLowerCase();
    return `(${prepText} the ${desc})`;
  }

  // Bare branch: no "the" (gparser.zil:922: <TELL D .OBJ ")" CR>)
  return `(${desc})`;
}
