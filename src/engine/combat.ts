// combat.ts — Zork I combat engine.
//
// Source spine: 1actions.zil:3232–4135.
// Tables and windows: 1actions.zil:3258–3317, patched by 1dungeon.zil:2644–2649.

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
