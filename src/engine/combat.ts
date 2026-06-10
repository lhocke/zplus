// combat.ts — Zork I combat engine.
//
// Source spine: 1actions.zil:3232–4135.
// Tables and windows: 1actions.zil:3258–3317, patched by 1dungeon.zil:2644–2649.

import type { Rng } from './rng.js';
import type { VillainEntry } from '../domain/villain-entry.js';
import type { ObjectId } from '../domain/game-object.js';

// ---------------------------------------------------------------------------
// Blow result codes — 1actions.zil:3244–3254
// ---------------------------------------------------------------------------

export const MISSED        = 1;  // attacker missed
export const UNCONSCIOUS   = 2;  // defender knocked out
export const KILLED        = 3;  // defender killed
export const LIGHT_WOUND   = 4;  // defender lightly wounded
export const SERIOUS_WOUND = 5;  // defender seriously wounded
export const STAGGER       = 6;  // defender staggered (loses next turn)
export const LOSE_WEAPON   = 7;  // defender drops weapon
export const HESITATE      = 8;  // free-swing miss (SITTING_DUCK/out path)
export const SITTING_DUCK  = 9;  // open blow on a knocked-out defender

// Villain F-code selectors — 1actions.zil:3236–3242
export const F_BUSY        = 1;
export const F_DEAD        = 2;
export const F_UNCONSCIOUS = 3;
export const F_CONSCIOUS   = 4;
export const F_FIRST       = 5;

// REMARK token selectors — 1actions.zil:3323–3325
export const F_WEP = 0;  // print weapon DESC
export const F_DEF = 1;  // print defender DESC

// Strength limits — 1actions.zil:3323–3325
export const STRENGTH_MAX = 7;
export const STRENGTH_MIN = 2;
export const CURE_WAIT    = 30;

// ---------------------------------------------------------------------------
// Raw DEF tables — 1actions.zil:3258–3299 (PURE word tables; hand-transcribed)
//
// These are the six (PURE) GLOBAL tables.  Values are the blow-result constants
// above.  Each entry is one word in ZIL; REST(table, N) advances N bytes = N/2
// words, giving the element-index offsets used in DEF*_RES below.
// ---------------------------------------------------------------------------

/** DEF1 (13 elements) — 1actions.zil:3258–3263 */
export const DEF1: readonly number[] = [
  MISSED, MISSED, MISSED, MISSED,
  STAGGER, STAGGER,
  UNCONSCIOUS, UNCONSCIOUS,
  KILLED, KILLED, KILLED, KILLED, KILLED,
];

/** DEF2A (10 elements) — 1actions.zil:3265–3270 */
export const DEF2A: readonly number[] = [
  MISSED, MISSED, MISSED, MISSED, MISSED,
  STAGGER, STAGGER,
  LIGHT_WOUND, LIGHT_WOUND,
  UNCONSCIOUS,
];

/** DEF2B (12 elements) — 1actions.zil:3272–3278 */
export const DEF2B: readonly number[] = [
  MISSED, MISSED, MISSED,
  STAGGER, STAGGER,
  LIGHT_WOUND, LIGHT_WOUND, LIGHT_WOUND,
  UNCONSCIOUS,
  KILLED, KILLED, KILLED,
];

/** DEF3A (11 elements) — 1actions.zil:3280–3285 */
export const DEF3A: readonly number[] = [
  MISSED, MISSED, MISSED, MISSED, MISSED,
  STAGGER, STAGGER,
  LIGHT_WOUND, LIGHT_WOUND,
  SERIOUS_WOUND, SERIOUS_WOUND,
];

/** DEF3B (11 elements) — 1actions.zil:3287–3292 */
export const DEF3B: readonly number[] = [
  MISSED, MISSED, MISSED,
  STAGGER, STAGGER,
  LIGHT_WOUND, LIGHT_WOUND, LIGHT_WOUND,
  SERIOUS_WOUND, SERIOUS_WOUND, SERIOUS_WOUND,
];

/** DEF3C (10 elements) — 1actions.zil:3294–3299 */
export const DEF3C: readonly number[] = [
  MISSED,
  STAGGER, STAGGER,
  LIGHT_WOUND, LIGHT_WOUND, LIGHT_WOUND, LIGHT_WOUND,
  SERIOUS_WOUND, SERIOUS_WOUND, SERIOUS_WOUND,
];

// ---------------------------------------------------------------------------
// Resolution windows — {table, offset} pairs.
//
// Each window covers exactly 9 elements (NM-1: never draw from the full raw
// table with a wider random).  Roll is table[offset + rng.nextInt(9)].
//
// Offsets are element indices derived from ZIL byte offsets (÷2 per word size):
//   1dungeon.zil:2644: PUT DEF1-RES 1 REST(DEF1, 2)  → element 1
//   1dungeon.zil:2645: PUT DEF1-RES 2 REST(DEF1, 4)  → element 2
//   1dungeon.zil:2646: PUT DEF2-RES 2 REST(DEF2B,2)  → element 1
//   1dungeon.zil:2647: PUT DEF2-RES 3 REST(DEF2B,4)  → element 2
//   1dungeon.zil:2648: PUT DEF3-RES 1 REST(DEF3A,2)  → element 1
//   1dungeon.zil:2649: PUT DEF3-RES 3 REST(DEF3B,2)  → element 1
// ---------------------------------------------------------------------------

export interface Window {
  readonly table: readonly number[];
  readonly offset: number;
}

/**
 * DEF1-RES — DEF==1, indexed ATT-1 (ATT clamped to 3).
 * 1actions.zil:3301–3304, patched by 1dungeon.zil:2644–2645.
 *
 * [0] DEF1@0  4M 2S 2U 1K
 * [1] DEF1@1  3M 2S 2U 2K   (REST(DEF1,2) = element 1)
 * [2] DEF1@2  2M 2S 2U 3K   (REST(DEF1,4) = element 2)
 */
export const DEF1_RES: readonly Window[] = [
  { table: DEF1, offset: 0 },
  { table: DEF1, offset: 1 },
  { table: DEF1, offset: 2 },
];

/**
 * DEF2-RES — DEF==2, indexed ATT-1 (ATT clamped to 4).
 * 1actions.zil:3306–3310, patched by 1dungeon.zil:2646–2647.
 *
 * [0] DEF2A@0  5M 2S 2L
 * [1] DEF2B@0  3M 2S 3L 1U
 * [2] DEF2B@1  2M 2S 3L 1U 1K  (REST(DEF2B,2) = element 1)
 * [3] DEF2B@2  1M 2S 3L 1U 2K  (REST(DEF2B,4) = element 2)
 */
export const DEF2_RES: readonly Window[] = [
  { table: DEF2A, offset: 0 },
  { table: DEF2B, offset: 0 },
  { table: DEF2B, offset: 1 },
  { table: DEF2B, offset: 2 },
];

/**
 * DEF3-RES — DEF>=3, indexed net+2 where net=clamp(ATT-DEF,-2,+2).
 * 1actions.zil:3312–3317, patched by 1dungeon.zil:2648–2649.
 *
 * [0] DEF3A@0  5M 2S 2L           net=-2
 * [1] DEF3A@1  4M 2S 2L 1SW       net=-1  (REST(DEF3A,2) = element 1)
 * [2] DEF3B@0  3M 2S 3L 1SW       net=0
 * [3] DEF3B@1  2M 2S 3L 2SW       net=+1  (REST(DEF3B,2) = element 1)
 * [4] DEF3C@0  1M 2S 4L 2SW       net=+2
 */
export const DEF3_RES: readonly Window[] = [
  { table: DEF3A, offset: 0 },
  { table: DEF3A, offset: 1 },
  { table: DEF3B, offset: 0 },
  { table: DEF3B, offset: 1 },
  { table: DEF3C, offset: 0 },
];

// ---------------------------------------------------------------------------
// Table-selection algorithm — 1actions.zil:3429–3440 (HERO-BLOW) / :3510–3521
// (VILLAIN-BLOW).  The two call sites are identical; ATT/DEF are role-swapped
// by the caller (NM-2 — spec §3.4):
//
//   VILLAIN-BLOW: ATT = villain pStrength,       DEF = player FIGHT-STRENGTH
//   HERO-BLOW:    ATT = player FIGHT-STRENGTH,   DEF = villain pStrength
//
// Returns the blow-result constant from the chosen window.
// ---------------------------------------------------------------------------

export function selectWindow(att: number, def: number, rng: Rng): number {
  let win: Window;
  if (def === 1) {
    if (att > 2) att = 3;
    win = DEF1_RES[att - 1]!;
  } else if (def === 2) {
    if (att > 3) att = 4;
    win = DEF2_RES[att - 1]!;
  } else {
    // DEF >= 3 — net = clamp(ATT - DEF, -2, +2)
    let net = att - def;
    if (net < -2) net = -2;
    if (net >  2) net =  2;
    win = DEF3_RES[net + 2]!;
  }
  return win.table[win.offset + rng.nextInt(9)]!;
}

// ---------------------------------------------------------------------------
// Strength model — 1actions.zil:3375–3397
// ---------------------------------------------------------------------------

// FIGHT-STRENGTH — 1actions.zil:3375–3381
// base = STRENGTH_MIN + floor(SCORE / floor(SCORE_MAX / (STRENGTH_MAX - STRENGTH_MIN)))
//      = 2 + floor(SCORE / 70)     (integer division, SCORE_MAX=350)
// adjust=true:  base + winner.pStrength  (used for DEF tier selection and alive check)
// adjust=false: base only              (OD — used for WINNER-RESULT wound delta, NM-3)
export function fightStrength(adjust: boolean, score: number, pStrength: number): number {
  const base = STRENGTH_MIN + Math.floor(score / 70);
  return adjust ? base + pStrength : base;
}

// VILLAIN-STRENGTH — 1actions.zil:3383–3397
// villainId: the object id of the villain (to detect THIEF for engrossed-cap)
// pStrength:  the villain's mutable combat state (Actor.pStrength)
// entry:      the VillainEntry metadata record (vBest, vBestAdv)
// prsiId:     id of PRSI (the weapon the player is attacking with), or null
// prsiIsWeapon: whether PRSI is in the weapon set (FIND-WEAPON containment check)
// thiefEngrossed: whether the thief-engrossed flag is currently set
//
// NB: thiefEngrossed is read-only here; callers (VILLAIN-BLOW / I-FIGHT) are
// responsible for clearing it after the cap fires (spec §4.2).
export function villainStrength(
  villainId: ObjectId,
  pStrength: number,
  entry: VillainEntry,
  prsiId: ObjectId | null,
  prsiIsWeapon: boolean,
  thiefEngrossed: boolean,
): number {
  let od = pStrength;
  // Unconscious → return negative value as-is (no further checks)
  if (od < 0) return od;
  // THIEF-ENGROSSED cap — engine carries this though thief is deferred (spec §1)
  if (villainId === 'THIEF' && thiefEngrossed) {
    if (od > 2) od = 2;
    // thiefEngrossed cleared by caller after this call returns
  }
  // Best-weapon advantage — reduces villain strength when player attacks with vBest
  if (prsiId !== null && prsiIsWeapon && entry.vBest !== null && prsiId === entry.vBest) {
    od = Math.max(1, od - entry.vBestAdv);
  }
  return od;
}
