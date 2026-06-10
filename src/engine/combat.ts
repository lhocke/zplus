// combat.ts — Zork I combat engine.
//
// Source spine: 1actions.zil:3232–4135.
// Tables and windows: 1actions.zil:3258–3317, patched by 1dungeon.zil:2644–2649.
// MELEE tables: 1actions.zil:3611–3788.

import type { VillainEntry } from '../domain/villain-entry.js';
import type { GameObject, ObjectId } from '../domain/game-object.js';

// FIND-WEAPON — 1actions.zil:3401–3409
//
// Walks the owner's children (ZIL FIRST?/NEXT?) looking for exactly one of
// the 5 canonical weapon object ids.  Returns the first match, or null.
//
// Containment (name-check), NOT WEAPONBIT — this is the spec-mandated form
// (spec §4.2, "FIND-WEAPON's weapon set is exactly [STILETTO, AXE, SWORD,
// KNIFE, RUSTY-KNIFE] by containment (FIRST?/NEXT?), NOT by WEAPONBIT").

/** The 5 canonical weapon object ids — 1actions.zil:3406–3408. */
export const WEAPON_NAMES: readonly ObjectId[] = [
  'STILETTO', 'AXE', 'SWORD', 'KNIFE', 'RUSTY-KNIFE',
];

/**
 * FIND-WEAPON — return the first weapon in `owner`'s immediate children,
 * or null if none found.  Walks children in insertion order (FIRST?/NEXT?).
 */
export function findWeapon(owner: GameObject): GameObject | null {
  for (const child of owner.children) {
    if (WEAPON_NAMES.includes(child.id)) return child;
  }
  return null;
}

// Minimal RNG interface used throughout combat — satisfied by both Rng (concrete)
// and ScriptedRng (test harness).  zprob is optional here because existing probe
// call sites that only use next/prob must still type-check.
export interface CombatRng {
  next(): number;
  nextInt(n: number): number;
  prob(base: number): boolean;
  zprob?(base: number, denom: number): boolean;
}

// Blow result codes — 1actions.zil:3244–3254

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

// Raw DEF tables — 1actions.zil:3258–3299 (PURE word tables; hand-transcribed)
//
// These are the six (PURE) GLOBAL tables.  Values are the blow-result constants
// above.  Each entry is one word in ZIL; REST(table, N) advances N bytes = N/2
// words, giving the element-index offsets used in DEF*_RES below.

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

// Table-selection algorithm — 1actions.zil:3429–3440 (HERO-BLOW) / :3510–3521
// (VILLAIN-BLOW).  The two call sites are identical; ATT/DEF are role-swapped
// by the caller (NM-2 — spec §3.4):
//
//   VILLAIN-BLOW: ATT = villain pStrength,       DEF = player FIGHT-STRENGTH
//   HERO-BLOW:    ATT = player FIGHT-STRENGTH,   DEF = villain pStrength
//
// Returns the blow-result constant from the chosen window.

export function selectWindow(att: number, def: number, rng: CombatRng): number {
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

// Strength model — 1actions.zil:3375–3397

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

// REMARK message system — 1actions.zil:3363–3370
//
// A MELEE "slot" is a frob (length-prefixed LTABLE of variant LTABLEs):
//   slot[0]    = variant count N
//   slot[1..N] = variant LTABLE arrays
//
// Each variant LTABLE is [length, token0, token1, ...] where tokens are either
// string literals or the sentinel constants F_WEP (0) / F_DEF (1).
//
// Usage:
//   const ltable = randomElement(TROLL_MELEE[RES - 1], rng);
//   remark(ltable, defenderDesc, weaponDesc, emit);

/** Token type for MELEE variant LTABLEs. */
export type MeleeToken = string | typeof F_WEP | typeof F_DEF;

/**
 * A variant LTABLE: [length, token0, token1, ...].
 * length is the count of tokens that follow.
 */
export type MeleeLTable = readonly [number, ...MeleeToken[]];

/**
 * A MELEE slot frob: [count, ltable0, ltable1, ...].
 * count = number of variant LTABLEs that follow.
 */
export type MeleeSlot = readonly [number, ...MeleeLTable[]];

/**
 * REMARK — 1actions.zil:3363–3370.
 * Iterates ltable[1..ltable[0]], substituting F_WEP/F_DEF tokens with the
 * provided strings, and emitting all other tokens (string literals) as-is.
 * F_WEP emits weaponDesc (or '' when empty); F_DEF emits defenderDesc.
 */
export function remark(
  ltable: readonly (MeleeToken | number)[],
  defenderDesc: string,
  weaponDesc: string,
  emit: (s: string) => void,
): void {
  const len = ltable[0] as number;
  for (let i = 1; i <= len; i++) {
    const tok = ltable[i];
    if (tok === F_WEP)  { emit(weaponDesc);   }
    else if (tok === F_DEF) { emit(defenderDesc); }
    else                    { emit(tok as string); }
  }
}

/**
 * RANDOM-ELEMENT — 1actions.zil:3363 (implicit ZIL call form).
 * frob[0] = count N; returns frob[1 + rng.nextInt(N)].
 */
export function randomElement(frob: readonly (number | MeleeLTable)[], rng: CombatRng): MeleeLTable {
  const n = frob[0] as number;
  return frob[1 + rng.nextInt(n)] as MeleeLTable;
}

// HERO_MELEE — 1actions.zil:3611–3648
// 7 slots (RES 1–7: MISSED/UNCONSCIOUS/KILLED/LIGHT_WOUND/SERIOUS_WOUND/
//          STAGGER/LOSE_WEAPON); HERO-BLOW never produces HESITATE/SITTING_DUCK
// (NM-6 — OUT? is always false on the hero side).
// Variants per slot: 6,5,3,4,4,5,2 = 29 total.

export const HERO_MELEE: readonly MeleeSlot[] = [
  // Slot 0 — MISSED (6 variants) — 1actions.zil:3613–3619
  [6,
    [5, 'Your ', F_WEP, ' misses the ', F_DEF, ' by an inch.'],
    [3, 'A good slash, but it misses the ', F_DEF, ' by a mile.'],
    [3, 'You charge, but the ', F_DEF, ' jumps nimbly aside.'],
    [3, 'Clang! Crash! The ', F_DEF, ' parries.'],
    [3, 'A quick stroke, but the ', F_DEF, ' is on guard.'],
    [3, 'A good stroke, but it\'s too slow; the ', F_DEF, ' dodges.'],
  ],
  // Slot 1 — UNCONSCIOUS (5 variants) — 1actions.zil:3620–3625
  [5,
    [5, 'Your ', F_WEP, ' crashes down, knocking the ', F_DEF, ' into dreamland.'],
    [3, 'The ', F_DEF, ' is battered into unconsciousness.'],
    [3, 'A furious exchange, and the ', F_DEF, ' is knocked out!'],
    [5, 'The haft of your ', F_WEP, ' knocks out the ', F_DEF, '.'],
    [3, 'The ', F_DEF, ' is knocked out!'],
  ],
  // Slot 2 — KILLED (3 variants) — 1actions.zil:3626–3629
  [3,
    [5, 'It\'s curtains for the ', F_DEF, ' as your ', F_WEP, ' removes his head.'],
    [3, 'The fatal blow strikes the ', F_DEF, ' square in the heart: He dies.'],
    [3, 'The ', F_DEF, ' takes a fatal blow and slumps to the floor dead.'],
  ],
  // Slot 3 — LIGHT_WOUND (4 variants) — 1actions.zil:3630–3634
  [4,
    [3, 'The ', F_DEF, ' is struck on the arm; blood begins to trickle down.'],
    [5, 'Your ', F_WEP, ' pinks the ', F_DEF, ' on the wrist, but it\'s not serious.'],
    [1, 'Your stroke lands, but it was only the flat of the blade.'],
    [3, 'The blow lands, making a shallow gash in the ', F_DEF, '\'s arm!'],
  ],
  // Slot 4 — SERIOUS_WOUND (4 variants) — 1actions.zil:3635–3639
  [4,
    [3, 'The ', F_DEF, ' receives a deep gash in his side.'],
    [3, 'A savage blow on the thigh! The ', F_DEF, ' is stunned but can still fight!'],
    [1, 'Slash! Your blow lands! That one hit an artery, it could be serious!'],
    [1, 'Slash! Your stroke connects! This could be serious!'],
  ],
  // Slot 5 — STAGGER (5 variants) — 1actions.zil:3640–3645
  [5,
    [3, 'The ', F_DEF, ' is staggered, and drops to his knees.'],
    [3, 'The ', F_DEF, ' is momentarily disoriented and can\'t fight back.'],
    [3, 'The force of your blow knocks the ', F_DEF, ' back, stunned.'],
    [3, 'The ', F_DEF, ' is confused and can\'t fight back.'],
    [3, 'The quickness of your thrust knocks the ', F_DEF, ' back, stunned.'],
  ],
  // Slot 6 — LOSE_WEAPON (2 variants) — 1actions.zil:3646–3648
  [2,
    [3, 'The ', F_DEF, '\'s weapon is knocked to the floor, leaving him unarmed.'],
    [3, 'The ', F_DEF, ' is disarmed by a subtle feint past his guard.'],
  ],
];

// CYCLOPS_MELEE — 1actions.zil:3654–3683
// 9 slots (all RES 1–9); cyclops has no weapon so no F_WEP in most slots.
// Variants per slot: 2,1,1,2,2,2,2,1,1 = 14 total.

export const CYCLOPS_MELEE: readonly MeleeSlot[] = [
  // Slot 0 — MISSED (2 variants) — 1actions.zil:3656–3658
  [2,
    [1, 'The Cyclops misses, but the backwash almost knocks you over.'],
    [1, 'The Cyclops rushes you, but runs into the wall.'],
  ],
  // Slot 1 — UNCONSCIOUS (1 variant) — 1actions.zil:3659–3660
  [1,
    [1, 'The Cyclops sends you crashing to the floor, unconscious.'],
  ],
  // Slot 2 — KILLED (1 variant) — 1actions.zil:3661–3662
  [1,
    [1, 'The Cyclops breaks your neck with a massive smash.'],
  ],
  // Slot 3 — LIGHT_WOUND (2 variants) — 1actions.zil:3663–3665
  [2,
    [1, 'A quick punch, but it was only a glancing blow.'],
    [1, 'A glancing blow from the Cyclops\' fist.'],
  ],
  // Slot 4 — SERIOUS_WOUND (2 variants) — 1actions.zil:3666–3669
  [2,
    [1, 'The monster smashes his huge fist into your chest, breaking several\nribs.'],
    [1, 'The Cyclops almost knocks the wind out of you with a quick punch.'],
  ],
  // Slot 5 — STAGGER (2 variants) — 1actions.zil:3670–3673
  [2,
    [1, 'The Cyclops lands a punch that knocks the wind out of you.'],
    [1, 'Heedless of your weapons, the Cyclops tosses you against the rock\nwall of the room.'],
  ],
  // Slot 6 — LOSE_WEAPON (2 variants) — 1actions.zil:3674–3678
  [2,
    [3, 'The Cyclops grabs your ', F_WEP, ', tastes it, and throws it to the\nground in disgust.'],
    [3, 'The monster grabs you on the wrist, squeezes, and you drop your\n', F_WEP, ' in pain.'],
  ],
  // Slot 7 — HESITATE (1 variant) — 1actions.zil:3679–3681
  [1,
    [1, 'The Cyclops seems unable to decide whether to broil or stew his\ndinner.'],
  ],
  // Slot 8 — SITTING_DUCK (1 variant) — 1actions.zil:3682–3683
  [1,
    [1, 'The Cyclops, no sportsman, dispatches his unconscious victim.'],
  ],
];

// TROLL_MELEE — 1actions.zil:3689–3729
// 9 slots; variants per slot: 4,1,3,4,3,4,3,2,1 = 25 total.

export const TROLL_MELEE: readonly MeleeSlot[] = [
  // Slot 0 — MISSED (4 variants) — 1actions.zil:3691–3695
  [4,
    [1, 'The troll swings his axe, but it misses.'],
    [1, 'The troll\'s axe barely misses your ear.'],
    [1, 'The axe sweeps past as you jump aside.'],
    [1, 'The axe crashes against the rock, throwing sparks!'],
  ],
  // Slot 1 — UNCONSCIOUS (1 variant) — 1actions.zil:3696–3698
  [1,
    [1, 'The flat of the troll\'s axe hits you delicately on the head, knocking\nyou out.'],
  ],
  // Slot 2 — KILLED (3 variants) — 1actions.zil:3699–3702
  [3,
    [1, 'The troll neatly removes your head.'],
    [1, 'The troll\'s axe stroke cleaves you from the nave to the chops.'],
    [1, 'The troll\'s axe removes your head.'],
  ],
  // Slot 3 — LIGHT_WOUND (4 variants) — 1actions.zil:3703–3708
  [4,
    [1, 'The axe gets you right in the side. Ouch!'],
    [1, 'The flat of the troll\'s axe skins across your forearm.'],
    [1, 'The troll\'s swing almost knocks you over as you barely parry\nin time.'],
    [1, 'The troll swings his axe, and it nicks your arm as you dodge.'],
  ],
  // Slot 4 — SERIOUS_WOUND (3 variants) — 1actions.zil:3709–3712
  [3,
    [3, 'The troll charges, and his axe slashes you on your ', F_WEP, ' arm.'],
    [1, 'An axe stroke makes a deep wound in your leg.'],
    [1, 'The troll\'s axe swings down, gashing your shoulder.'],
  ],
  // Slot 5 — STAGGER (4 variants) — 1actions.zil:3713–3719
  [4,
    [1, 'The troll hits you with a glancing blow, and you are momentarily\nstunned.'],
    [1, 'The troll swings; the blade turns on your armor but crashes\nbroadside into your head.'],
    [1, 'You stagger back under a hail of axe strokes.'],
    [1, 'The troll\'s mighty blow drops you to your knees.'],
  ],
  // Slot 6 — LOSE_WEAPON (3 variants) — 1actions.zil:3720–3723
  [3,
    [3, 'The axe hits your ', F_WEP, ' and knocks it spinning.'],
    [3, 'The troll swings, you parry, but the force of his blow knocks your ', F_WEP, ' away.'],
    [3, 'The axe knocks your ', F_WEP, ' out of your hand. It falls to the floor.'],
  ],
  // Slot 7 — HESITATE (2 variants) — 1actions.zil:3724–3727
  [2,
    [1, 'The troll hesitates, fingering his axe.'],
    [1, 'The troll scratches his head ruminatively:  Might you be magically\nprotected, he wonders?'],
  ],
  // Slot 8 — SITTING_DUCK (1 variant) — 1actions.zil:3728–3729
  [1,
    [1, 'Conquering his fears, the troll puts you to death.'],
  ],
];

// THIEF_MELEE — 1actions.zil:3735–3788
// 9 slots; variants per slot: 4,2,3,4,4,3,3,3,2 = 28 total.

export const THIEF_MELEE: readonly MeleeSlot[] = [
  // Slot 0 — MISSED (4 variants) — 1actions.zil:3737–3742
  [4,
    [1, 'The thief stabs nonchalantly with his stiletto and misses.'],
    [1, 'You dodge as the thief comes in low.'],
    [1, 'You parry a lightning thrust, and the thief salutes you with\na grim nod.'],
    [1, 'The thief tries to sneak past your guard, but you twist away.'],
  ],
  // Slot 1 — UNCONSCIOUS (2 variants) — 1actions.zil:3743–3746
  [2,
    [1, 'Shifting in the midst of a thrust, the thief knocks you unconscious\nwith the haft of his stiletto.'],
    [1, 'The thief knocks you out.'],
  ],
  // Slot 2 — KILLED (3 variants) — 1actions.zil:3747–3752
  [3,
    [1, 'Finishing you off, the thief inserts his blade into your heart.'],
    [1, 'The thief comes in from the side, feints, and inserts the blade\ninto your ribs.'],
    [1, 'The thief bows formally, raises his stiletto, and with a wry grin,\nends the battle and your life.'],
  ],
  // Slot 3 — LIGHT_WOUND (4 variants) — 1actions.zil:3753–3760
  [4,
    [1, 'A quick thrust pinks your left arm, and blood starts to\ntrickle down.'],
    [1, 'The thief draws blood, raking his stiletto across your arm.'],
    [1, 'The stiletto flashes faster than you can follow, and blood wells\nfrom your leg.'],
    [1, 'The thief slowly approaches, strikes like a snake, and leaves\nyou wounded.'],
  ],
  // Slot 4 — SERIOUS_WOUND (4 variants) — 1actions.zil:3761–3767
  [4,
    [1, 'The thief strikes like a snake! The resulting wound is serious.'],
    [1, 'The thief stabs a deep cut in your upper arm.'],
    [1, 'The stiletto touches your forehead, and the blood obscures your\nvision.'],
    [1, 'The thief strikes at your wrist, and suddenly your grip is slippery\nwith blood.'],
  ],
  // Slot 5 — STAGGER (3 variants) — 1actions.zil:3768–3773
  [3,
    [1, 'The butt of his stiletto cracks you on the skull, and you stagger\nback.'],
    [1, 'The thief rams the haft of his blade into your stomach, leaving\nyou out of breath.'],
    [1, 'The thief attacks, and you fall back desperately.'],
  ],
  // Slot 6 — LOSE_WEAPON (3 variants) — 1actions.zil:3774–3779
  [3,
    [5, 'A long, theatrical slash. You catch it on your ', F_WEP, ', but the\nthief twists his knife, and the ', F_WEP, ' goes flying.'],
    [3, 'The thief neatly flips your ', F_WEP, ' out of your hands, and it drops\nto the floor.'],
    [3, 'You parry a low thrust, and your ', F_WEP, ' slips out of your hand.'],
  ],
  // Slot 7 — HESITATE (3 variants) — 1actions.zil:3780–3783
  [3,
    [1, 'The thief, a man of superior breeding, pauses for a moment to consider the propriety of finishing you off.'],
    [1, 'The thief amuses himself by searching your pockets.'],
    [1, 'The thief entertains himself by rifling your pack.'],
  ],
  // Slot 8 — SITTING_DUCK (2 variants) — 1actions.zil:3784–3788
  [2,
    [1, 'The thief, forgetting his essentially genteel upbringing, cuts your\nthroat.'],
    [1, 'The thief, a pragmatist, dispatches you as a threat to his\nlivelihood.'],
  ],
];

// WINNER-RESULT callback interface
//
// The blow functions mutate game state through an explicit callback bundle
// rather than taking the Game object directly, keeping them testable in
// isolation.

export interface WinnerResultCallbacks {
  getPlayerPStrength(): number;
  setPlayerPStrength(v: number): void;
  getScore(): number;
  jigsUp(msg: string): void;
  queueICure(period: number): void;
}

// VILLAIN-BLOW adds encumbrance + stagger + weapon-drop callbacks.
export interface VillainBlowCallbacks extends WinnerResultCallbacks {
  getLoadAllowed(): number;
  setLoadAllowed(v: number): void;
  getLoadMax(): number;
  getLucky(): boolean;
  /** Returns the id of the player's held weapon, or null. */
  findPlayerWeapon(): string | null;
  /** Returns the desc (display name) of the player's held weapon, or null. */
  findPlayerWeaponDesc(): string | null;
  dropPlayerWeapon(id: string): void;
  getVillainStaggered(): boolean;
  clearVillainStaggered(): void;
  setPlayerStaggered(): void;
  clearPlayerStaggered(): void;
  emit(text: string): void;
  /** Optional: called by doFight before each villainBlow to inform callbacks which villain
   *  is currently being processed.  Implementations that need per-villain stagger state
   *  use this to resolve the correct world object.  Test stubs may omit it. */
  setActiveVillain?(id: string): void;
}

// WINNER-RESULT — 1actions.zil:3552–3564
//
// Called at the end of VILLAIN-BLOW after applying the blow's state changes.
//   winner.pStrength = (DEF == 0) ? -10000 : (DEF - OD)     // NM-4
//   if DEF - OD < 0:  queue I-CURE  (no DEF!=0 guard)
//   if fightStrength() <= 0:  nudge pStrength to (1-base), call jigsUp
//
// NM-4: -10000 drives fightStrength deeply negative → triggers kill path.
// Nudge overwrites the -10000 so a resurrected player starts at FS=1.

export function winnerResult(
  def: number,
  od: number,
  cb: WinnerResultCallbacks,
): void {
  // NM-4: dead sentinel when DEF==0 (KILLED or SITTING_DUCK reduced DEF to 0)
  const newPs = def === 0 ? -10000 : def - od;
  cb.setPlayerPStrength(newPs);

  // Queue I-CURE whenever DEF-OD < 0 — no DEF!=0 exclusion (1actions.zil:3556)
  if (def - od < 0) {
    cb.queueICure(CURE_WAIT);
  }

  // Kill check — fightStrength(adjust=true) uses the just-set pStrength
  const fs = fightStrength(true, cb.getScore(), cb.getPlayerPStrength());
  if (fs <= 0) {
    // Nudge pStrength to 1-base: 1actions.zil:3559
    //   <PUTP ,WINNER ,P?STRENGTH <+ 1 <- <FIGHT-STRENGTH <>>>>
    //   = 1 + (-base) = 1 - base
    const nudged = 1 - fightStrength(false, cb.getScore(), 0);
    cb.setPlayerPStrength(nudged);
    cb.jigsUp(
      "It appears that that last blow was too much for you. I'm afraid you\nare dead.",
    );
  }
}

// VILLAIN-BLOW — 1actions.zil:3413–3474
//
// Called from DO-FIGHT for each active villain.
// Parameters:
//   villainId      — object id (for villainStrength THIEF check)
//   villainPs      — villain pStrength (for ATT computation via villainStrength)
//   entry          — VillainEntry metadata (vMsgs, vBest, etc.)
//   thiefEngrossed — THIEF-ENGROSSED flag (cap in villainStrength)
//   prsiId         — player's current PRSI weapon id (or null)
//   prsiIsWeapon   — whether PRSI is in the weapon set
//   out            — DO-FIGHT out counter (>0 → SITTING_DUCK transformation)
//   score          — current player score (for FIGHT-STRENGTH)
//   rng            — RNG instance
//   cb             — callback bundle for state reads/writes

export function villainBlow(
  villainId: ObjectId,
  villainPs: number,
  entry: VillainEntry,
  thiefEngrossed: boolean,
  prsiId: ObjectId | null,
  prsiIsWeapon: boolean,
  out: number,
  score: number,
  rng: CombatRng,
  cb: VillainBlowCallbacks,
): number {
  // unconditionally clear player STAGGERED (1actions.zil:3417)
  cb.clearPlayerStaggered();

  // if villain is STAGGERED, skip blow and clear (1actions.zil:3418–3422)
  if (cb.getVillainStaggered()) {
    const vDesc = villainId.toLowerCase().replace(/-/g, ' ');
    cb.emit(`The ${vDesc} slowly regains his feet.`);
    cb.clearVillainStaggered();
    return MISSED;  // regaining feet = effectively missed this turn
  }

  // compute ATT, DEF, OD (1actions.zil:3423–3425)
  const att = villainStrength(villainId, villainPs, entry, prsiId, prsiIsWeapon, thiefEngrossed);
  const playerPs = cb.getPlayerPStrength();
  const def = fightStrength(true,  score, playerPs);
  const od  = fightStrength(false, score, playerPs);

  // if player already dying, skip (1actions.zil:3424)
  if (def <= 0) return MISSED;

  // resolve RES (1actions.zil:3427–3451)
  let res: number;
  if (def < 0) {
    // Player unconscious → instant kill (1actions.zil:3427)
    res = KILLED;
  } else {
    res = selectWindow(att, def, rng);

    // out? transformation: STAGGER→HESITATE, else→SITTING_DUCK (1actions.zil:3441–3443)
    if (out > 0) {
      res = res === STAGGER ? HESITATE : SITTING_DUCK;
    }

    // STAGGER + weapon present → ZPROB(25,denom) chance of LOSE_WEAPON (1actions.zil:3444–3447).
    // NM-5: LUCKY? denom=100, else denom=300 (two-arg zprob form, spec §5).
    if (res === STAGGER && cb.findPlayerWeapon() !== null) {
      const denom = cb.getLucky() ? 100 : 300;
      if (rng.zprob!(25, denom)) res = LOSE_WEAPON;
    }

    // Emit REMARK (1actions.zil:3448–3451)
    const slot = (entry.vMsgs as readonly MeleeSlot[])[res - 1];
    if (slot !== undefined) {
      const ltable = randomElement(slot, rng);
      const dweaponDesc = cb.findPlayerWeaponDesc() ?? '';
      const parts: string[] = [];
      remark(ltable, 'you', dweaponDesc, (s) => parts.push(s));
      if (parts.length > 0) cb.emit(parts.join(''));
    }
  }

  // apply player state (1actions.zil:3452–3473)
  let defMod = def;  // local DEF, may be reduced by wound
  switch (res) {
    case MISSED:
    case HESITATE:
      break;
    case UNCONSCIOUS:
      // NM-8: DO-FIGHT loop handles out counter; no pStrength change here
      break;
    case KILLED:
    case SITTING_DUCK:
      defMod = 0;
      break;
    case LIGHT_WOUND:
      defMod = Math.max(0, def - 1);
      if (cb.getLoadAllowed() > 50) cb.setLoadAllowed(cb.getLoadAllowed() - 10);
      break;
    case SERIOUS_WOUND:
      defMod = Math.max(0, def - 2);
      if (cb.getLoadAllowed() > 50) cb.setLoadAllowed(cb.getLoadAllowed() - 20);
      break;
    case STAGGER:
      cb.setPlayerStaggered();
      break;
    case LOSE_WEAPON: {
      const wep = cb.findPlayerWeapon();
      if (wep !== null) {
        cb.dropPlayerWeapon(wep);
        // After dropping, check for another weapon by desc (1actions.zil:3460–3463)
        const nextWepDesc = cb.findPlayerWeaponDesc();
        if (nextWepDesc !== null) {
          cb.emit(`Fortunately, you still have a ${nextWepDesc}.`);
        }
      }
      break;
    }
  }

  // WINNER-RESULT (1actions.zil:3474)
  winnerResult(defMod, od, cb);
  return res;
}

// VILLAIN-RESULT callback interface

export interface VillainResultCallbacks {
  getVillainPStrength(): number;
  setVillainPStrength(v: number): void;
  /** FCLEAR villain FIGHTBIT — 1actions.zil:3569, called on villain death (DEF==0). */
  clearVillainFightBit(): void;
  applyVillainAction(fcode: number, villainId: ObjectId): void;
  removeVillain(villainId: ObjectId): void;
  emit(text: string): void;
}

// HERO-BLOW adds villain-side state queries.
export interface HeroBlowCallbacks extends VillainResultCallbacks {
  getPlayerPStrength(): number;
  getPlayerStaggered(): boolean;
  clearPlayerStaggered(): void;
  getScore(): number;
  findVillainWeapon(): string | null;
  disarmVillain(wepId: string): void;
  setVillainStaggered(): void;
  /** FSET villain FIGHTBIT — 1actions.zil:3484, called at start of HERO-BLOW. */
  setVillainFightBit(): void;
}

// VILLAIN-RESULT — 1actions.zil:3566–3580
//
//   villain.pStrength = DEF
//   if DEF == 0:
//     FCLEAR villain FIGHTBIT
//     emit fog-death message
//     removeCarefully(villain)
//     apply(villain.action, F_DEAD)
//   elif RES == UNCONSCIOUS:
//     apply(villain.action, F_UNCONSCIOUS)

export function villainResult(
  villainId: ObjectId,
  villainDesc: string,
  def: number,
  res: number,
  cb: VillainResultCallbacks,
): void {
  cb.setVillainPStrength(def);

  if (def === 0) {
    // 1actions.zil:3569: FCLEAR villain FIGHTBIT
    cb.clearVillainFightBit();
    // 1actions.zil:3570–3573: fog death message
    cb.emit(
      `Almost as soon as the ${villainDesc} breathes his last breath, a cloud\nof sinister black fog envelops him, ` +
      'and when the fog lifts, the\ncarcass has disappeared.',
    );
    // 1actions.zil:3574: REMOVE-CAREFULLY villain
    cb.removeVillain(villainId);
    // 1actions.zil:3575: APPLY villain.action F_DEAD
    cb.applyVillainAction(F_DEAD, villainId);
  } else if (res === UNCONSCIOUS) {
    // 1actions.zil:3578: APPLY villain.action F_UNCONSCIOUS
    cb.applyVillainAction(F_UNCONSCIOUS, villainId);
  }
}

// HERO-BLOW (player attacks villain) — 1actions.zil:3476–3548
//
// Parameters:
//   villainId        — object id of the villain (PRSO)
//   entry            — VillainEntry metadata (vMsgs, vBest, etc.)
//   prsiId           — id of PRSI (the weapon the player is using), or null
//   prsiIsWeapon     — whether PRSI carries WEAPONBIT (FIND-WEAPON check)
//   playerStaggered  — whether the player's STAGGERED bit is set
//   score            — current player score (for FIGHT-STRENGTH / ATT)
//   rng              — RNG instance
//   cb               — callback bundle
//
// Note: OUT? is always false for HERO-BLOW (only DO-FIGHT's villain loop uses
// the out counter, never the hero side), so HESITATE/SITTING_DUCK are never
// produced — NM-6: HERO_MELEE has only 7 slots, safe because OUT? is always false.

export function heroBlow(
  villainId: ObjectId,
  villainDesc: string,
  entry: VillainEntry,
  prsiId: ObjectId | null,
  prsiDesc: string,
  prsiIsWeapon: boolean,
  playerStaggered: boolean,
  score: number,
  rng: CombatRng,
  cb: HeroBlowCallbacks,
): void {
  // FSET villain FIGHTBIT (1actions.zil:3484)
  cb.setVillainFightBit();

  // player STAGGERED guard (1actions.zil:3485–3490)
  if (playerStaggered) {
    cb.emit(
      'You are still recovering from that last blow, so your attack is\nineffective.',
    );
    cb.clearPlayerStaggered();
    return;
  }

  // ATT = max(1, fightStrength(true)) (1actions.zil:3491–3492)
  const att = Math.max(1, fightStrength(true, score, cb.getPlayerPStrength()));

  // OD = DEF = villainStrength(villain) (1actions.zil:3495)
  //  villain pStrength may be negative if already KO'd
  const vilPs = cb.getVillainPStrength();
  let def = villainStrength(villainId, vilPs, entry, prsiId, prsiIsWeapon, false);

  // DEF == 0: pointless (1actions.zil:3495–3500)
  if (def === 0) {
    cb.emit(`Attacking the ${villainDesc} is pointless.`);
    return;
  }

  // find villain's weapon (1actions.zil:3501)
  const dweapon = cb.findVillainWeapon();

  // unarmed or KO'd villain: instant kill (1actions.zil:3502–3508)
  let res: number;
  if (!dweapon || def < 0) {
    const adj = def < 0 ? 'unconscious' : 'unarmed';
    cb.emit(`The ${adj} ${villainDesc} cannot defend himself: He dies.`);
    res = KILLED;
  } else {
    // roll the table (1actions.zil:3509–3529)
    // OUT? is always false here (NM-6) — no HESITATE/SITTING_DUCK possible
    res = selectWindow(att, def, rng);

    // STAGGER + villain has weapon → prob(25) → LOSE_WEAPON (one-arg, NM-5)
    // 1actions.zil:3525–3526: <COND (<AND <EQUAL? .RES ,STAGGER> .DWEAPON <PROB 25>>
    if (res === STAGGER && dweapon !== null) {
      if (rng.prob(25)) res = LOSE_WEAPON;
    }
    // NM-6: OUT? always false on hero side, so res <= LOSE_WEAPON (7 slots).
    if (res > LOSE_WEAPON) {
      throw new Error(`heroBlow: unexpected RES ${res} > LOSE_WEAPON — NM-6 violation`);
    }

    // Emit REMARK from HERO_MELEE (1actions.zil:3527–3530)
    const slot = HERO_MELEE[res - 1];
    if (slot !== undefined) {
      const ltable = randomElement(slot, rng);
      const parts: string[] = [];
      remark(ltable, villainDesc, prsiDesc, (s) => parts.push(s));
      if (parts.length > 0) cb.emit(parts.join(''));
    }
  }

  // apply villain state (1actions.zil:3531–3547)
  switch (res) {
    case MISSED:
    case HESITATE:
      // no villain state change
      break;
    case UNCONSCIOUS:
      // DEF = -DEF (KO flag, not death) — 1actions.zil:3532
      def = -def;
      break;
    case KILLED:
    case SITTING_DUCK:
      def = 0;
      break;
    case LIGHT_WOUND:
      def = Math.max(0, def - 1);
      break;
    case SERIOUS_WOUND:
      def = Math.max(0, def - 2);
      break;
    case STAGGER:
      cb.setVillainStaggered();
      break;
    case LOSE_WEAPON:
      // 1actions.zil:3544–3546: FCLEAR DWEAPON NDESC; FSET DWEAPON WEAPONBIT; MOVE DWEAPON HERE
      if (dweapon !== null) cb.disarmVillain(dweapon);
      break;
  }

  // villainResult (1actions.zil:3548)
  villainResult(villainId, villainDesc, def, res, cb);
}

// VillainTableEntry — one row of the VILLAINS LTABLE (1actions.zil:3801–3804)
//
// Used by DO-FIGHT and I-FIGHT to iterate the live villain table.
// Mutable fields (fightBit, pStrength, staggered) are read/written via
// the IFightCallbacks rather than through this record directly; this shape
// holds the per-call snapshot that the loop needs.

export interface VillainTableEntry {
  id: ObjectId;
  fightBit: boolean;
  pStrength: number;
  entry: VillainEntry;
  /** Whether the villain is currently in the player's room. */
  inHere: boolean;
  staggered: boolean;
}

// DO-FIGHT — 1actions.zil:3331–3357
//
// Iterates cnt=1..LEN-1 (ZIL is 1-based; we use 0-based array indexing so
// cnt maps to table[cnt-1]).  Stops when cnt == LEN (Cyclops at cnt=LEN is
// never processed — NM-7).
//
// The villainBlow return value is checked for UNCONSCIOUS to set the `out`
// counter.  With `out > 0` all subsequent blows transform:
//   STAGGER → HESITATE; anything else → SITTING_DUCK  (via the out? arg).

export function doFight(
  len: number,
  table: VillainTableEntry[],
  rng: CombatRng,
  cb: VillainBlowCallbacks,
): void {
  let out = 0;

  // Outer REPEAT — re-runs the inner villain loop while there are SITTING_DUCK
  // turns remaining (out > 0 after decrement).  Mirrors 1actions.zil:3331–3357.
  while (true) {
    let res: number | null = null;

    // Inner REPEAT — walk cnt=1..LEN-1 (ZIL 1-based; table is 0-based).
    // Stops when cnt == LEN (Cyclops excluded — NM-7).
    for (let cnt = 1; cnt < len; cnt++) {
      const entry = table[cnt - 1];
      if (entry === undefined) continue;

      // COND 1 (1actions.zil:3341): no FIGHTBIT → empty body, skip
      if (!entry.fightBit) continue;

      // COND 2: FIGHTBIT set — call action(F_BUSY); truthy return skips the blow
      if (entry.entry.action(F_BUSY)) continue;

      // Inform callbacks which villain is active (for per-villain stagger resolution).
      cb.setActiveVillain?.(entry.id);

      const blowRes = villainBlow(
        entry.id,
        entry.pStrength,
        entry.entry,
        false, // thiefEngrossed — handled in I-FIGHT before calling doFight
        null,  // prsiId — not available in clock context
        false,
        out,   // current out counter; >0 transforms STAGGER→HESITATE / else→SITTING_DUCK
        cb.getScore(),
        rng,
        cb,
      );

      // VILLAIN-BLOW returned nil/false in ZIL means it handled nothing; we use
      // MISSED as the "skip" sentinel, so only track actual results.
      res = blowRes;

      if (blowRes === UNCONSCIOUS) {
        out = 1 + rng.nextInt(3);
      }
    }
    // Inner loop done (cnt == len) — equivalent to ZIL <EQUAL? .CNT .LEN> RETURN T.
    if (res === null) res = 1;  // no villain processed → treat as "handled"

    // Outer loop check (1actions.zil:3349–3356):
    //   if RES is truthy: if OUT==0 → done; else OUT -= 1; if OUT==0 → done
    //   if RES is nil → done
    if (res !== 0) {
      if (out === 0) break;
      out -= 1;
      if (out === 0) break;
      // out > 0: loop back for another SITTING_DUCK pass
    } else {
      break;
    }
  }
}

// AWAKEN — 1actions.zil:3843–3847
//
// If the villain is unconscious (pStrength < 0), negate pStrength (restore
// health to the absolute value) and fire the F_CONSCIOUS callback.
// Returns { newPs } so callers can update the villain's state.

export function awaken(
  pStrength: number,
  action: (fcode: number) => boolean,
): { newPs: number } {
  if (pStrength < 0) {
    const newPs = -pStrength;
    action(F_CONSCIOUS);
    return { newPs };
  }
  return { newPs: pStrength };
}

// IFightCallbacks — context bundle for I-FIGHT
//
// Abstracts all game state I-FIGHT touches so the function is testable
// in isolation without a full Game instance.

export interface IFightCallbacks {
  /** Returns true when the player is dead (ghost mode). */
  getDead(): boolean;

  /** The villain table — read-only snapshot for the loop. */
  villainTable: VillainTableEntry[];

  /** Length of the villain table (LEN = VILLAINS[0] in ZIL). */
  len: number;

  /** Read villain pStrength by table index. */
  getVillainPs(idx: number): number;
  /** Write villain pStrength by table index. */
  setVillainPs(idx: number, v: number): void;

  /** Read V-PROB for wake-cycle logic. */
  getVProb(idx: number): number;
  /** Write V-PROB. */
  setVProb(idx: number, v: number): void;

  /** True if this villain is the THIEF. */
  isThief(idx: number): boolean;
  /** True if THIEF-ENGROSSED is currently set. */
  isThiefEngrossed(): boolean;
  /** Set/clear THIEF-ENGROSSED. */
  setThiefEngrossed(v: boolean): void;

  /** Apply the villain's F-code callback. Returns true if handled. */
  callVillainAction(idx: number, fcode: number): boolean;

  /** Clear FIGHTBIT on the villain. */
  clearFightBit(idx: number): void;
  /** Clear STAGGERED on the villain. */
  clearStaggered(idx: number): void;
  /** Clear STAGGERED on the player. */
  clearPlayerStaggered(): void;

  /** Awaken the villain (sets pStrength via callback internally). */
  onAwaken(idx: number): void;

  /** Signal that a fight should happen this turn. */
  triggerFight(): void;

  /** Whether villain at idx is in the player's current room. */
  isVillainInHere(idx: number): boolean;
  /** Whether the villain is currently INVISIBLE. */
  isVillainInvisible(idx: number): boolean;
}

// I-FIGHT — 1actions.zil:3810–3841
//
// Per-turn demon (turnsLeft = -1, fires every advance()).
// Returns false when dead (so the clock entry can no-op); otherwise
// processes the villain table and fires doFight when fight? is true.

export function iFight(ctx: IFightCallbacks, rng: CombatRng): boolean {
  if (ctx.getDead()) return false;

  let fightPending = false;

  // cnt=1..LEN-1 — mirrors ZIL: <EQUAL? .CNT .LEN> exits before reading cyclops (NM-7).
  for (let cnt = 1; cnt < ctx.len; cnt++) {
    const idx = cnt - 1;
    const row = ctx.villainTable[idx];
    if (row === undefined) continue;

    if (ctx.isVillainInHere(idx) && !ctx.isVillainInvisible(idx)) {
      // Villain is present and visible.
      if (ctx.isThief(idx) && ctx.isThiefEngrossed()) {
        // Thief engrossed reset (1actions.zil:3822)
        ctx.setThiefEngrossed(false);
      } else if (ctx.getVillainPs(idx) < 0) {
        // Unconscious — V-PROB wake check (1actions.zil:3823–3829, NM-9)
        const p = ctx.getVProb(idx);
        if (p !== 0 && rng.prob(p)) {
          // Wake: reset V-PROB and awaken the villain
          ctx.setVProb(idx, 0);
          ctx.onAwaken(idx);
        } else {
          // Ramp V-PROB by 25 each tick (0→25→50→75→100)
          ctx.setVProb(idx, p + 25);
        }
      } else if (row.fightBit || ctx.callVillainAction(idx, F_FIRST)) {
        // Villain is fighting or F_FIRST fired — mark fight pending
        fightPending = true;
      }
    } else {
      // Villain left the room — clear combat state (1actions.zil:3831–3839)
      if (row.fightBit) {
        ctx.callVillainAction(idx, F_BUSY);
      }
      if (ctx.isThief(idx)) {
        ctx.setThiefEngrossed(false);
      }
      ctx.clearPlayerStaggered();
      ctx.clearStaggered(idx);
      ctx.clearFightBit(idx);
      ctx.onAwaken(idx);
    }
  }

  if (fightPending) {
    ctx.triggerFight();
  }

  return true;
}

// ICureCallbacks — context bundle for I-CURE

export interface ICureCallbacks {
  getPlayerPStrength(): number;
  setPlayerPStrength(v: number): void;
  getLoadAllowed(): number;
  setLoadAllowed(v: number): void;
  getLoadMax(): number;
  /** Re-arm I-CURE for another CURE_WAIT turns. */
  queueICure(period: number): void;
  /** Permanently disable I-CURE (fully healed). */
  disableICure(): void;
}

// I-CURE — 1actions.zil:3593–3602
//
// Queued countdown entry (CURE_WAIT=30 turns).  Heals 1 pStrength per tick;
// re-queues itself until pStrength reaches 0, then restores LOAD_ALLOWED
// to LOAD_MAX and disables itself.

export function iCure(ctx: ICureCallbacks): void {
  let s = ctx.getPlayerPStrength();

  // Clamp positive over-heal to 0 (1actions.zil:3595)
  if (s > 0) {
    s = 0;
    ctx.setPlayerPStrength(0);
  }

  // Heal 1 point per tick (1actions.zil:3596)
  if (s < 0) {
    s += 1;
    ctx.setPlayerPStrength(s);
  }

  // Re-queue or disable (1actions.zil:3597–3602)
  if (s < 0) {
    // Still wounded — restore some encumbrance and re-queue
    if (ctx.getLoadAllowed() < ctx.getLoadMax()) {
      ctx.setLoadAllowed(ctx.getLoadAllowed() + 10);
    }
    ctx.queueICure(CURE_WAIT);
  } else {
    // Fully healed — restore all encumbrance and stop
    ctx.setLoadAllowed(ctx.getLoadMax());
    ctx.disableICure();
  }
}
